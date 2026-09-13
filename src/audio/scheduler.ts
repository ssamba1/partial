import type { ClickEvent } from '../core/rhythm';

export interface ScheduledEvent extends ClickEvent {
  /** AudioContext time at which the event sounds. */
  when: number;
}

/** What a sequence returns: the next event, null at the end, or 'wait' when the next beat is past `horizon`. */
export type NextFn = (horizon: number) => ClickEvent | null | 'wait';

/** Minimal clock the scheduler needs, so tests can drive it with a fake. */
export interface SchedulerClock {
  currentTime: number;
  outputLatency?: number;
  baseLatency?: number;
  getOutputTimestamp?: () => AudioTimestamp;
  createGain?: () => GainNode;
  createConstantSource?: () => ConstantSourceNode;
}

/** Visual events older than this (seconds) are dropped instead of flashing in a burst. */
export const STALE_VISUAL = 0.05;

/** Late events more than this far in the past move the whole run forward instead of playing at once. */
export const LATE_LIMIT = 0.02;

type Tick = () => void;

/**
 * One timer for every scheduler. A dedicated Worker keeps ticking in background
 * tabs, where the page's own timers are throttled; plain timers are the fallback.
 */
class Ticker {
  private subs = new Set<Tick>();
  private worker: Worker | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private interval: number) {}

  add(fn: Tick): void {
    this.subs.add(fn);
    if (this.subs.size === 1) this.run();
  }

  delete(fn: Tick): void {
    this.subs.delete(fn);
    if (this.subs.size === 0) this.halt();
  }

  private fire = () => this.subs.forEach((fn) => fn());

  private run() {
    try {
      if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL?.createObjectURL === 'function') {
        const src = `setInterval(() => postMessage(0), ${this.interval});`;
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        this.worker = new Worker(url);
        URL.revokeObjectURL(url);
        this.worker.onmessage = this.fire;
        return;
      }
    } catch {
      this.worker = null;
    }
    this.timer = setInterval(this.fire, this.interval);
  }

  private halt() {
    this.worker?.terminate();
    this.worker = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}

const ticker = new Ticker(25);

const hidden = () => typeof document !== 'undefined' && document.hidden;

/**
 * Lookahead scheduler ("A Tale of Two Clocks" pattern): a coarse timer wakes up
 * often and schedules every event that falls inside the lookahead window on the
 * sample-accurate AudioContext clock. Visual callbacks run from one animation
 * frame loop mapped onto the audio output clock, so timer jitter never affects
 * the audio and a returning tab never replays a pile of old beats.
 */
export class LookaheadScheduler {
  private running = false;
  private tickFn: Tick | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private visualQueue: ScheduledEvent[] = [];
  private raf = 0;
  private output: GainNode | null = null;
  /** Events whose time had already passed when the timer woke, so the run was moved forward. */
  skipped = 0;
  /** Seconds the run was moved forward after stalls. */
  shifted = 0;
  private startAt = 0;

  constructor(
    private ctx: SchedulerClock,
    private readonly opts: { lookahead?: number; hiddenLookahead?: number; dest?: AudioNode } = {},
  ) {}

  /** Where this run's sounds should connect; it is faded out and dropped on stop so already scheduled clicks go silent. */
  get destination(): AudioNode | undefined {
    return this.output ?? this.opts.dest;
  }

  /** AudioContext time of sequence time 0 for the current run, including any stall shifts. */
  get origin(): number {
    return this.startAt;
  }

  /**
   * @param next returns the next event (times relative to the start), null when the sequence ends,
   *   or 'wait' when nothing starts before `horizon` (also relative to the start).
   */
  start(
    next: NextFn | (() => ClickEvent | null),
    onSchedule: (e: ScheduledEvent) => void,
    onVisual?: (e: ScheduledEvent) => void,
    onEnd?: () => void,
    startDelay?: number,
  ): number {
    this.stop();
    this.running = true;
    this.skipped = 0;
    this.shifted = 0;
    const ctx = this.ctx;
    if (this.opts.dest && ctx.createGain) {
      this.output = ctx.createGain();
      this.output.connect(this.opts.dest);
    }
    // Bluetooth and USB outputs can take a moment to wake: leave at least the output latency plus 50 ms.
    const latency = ctx.outputLatency || ctx.baseLatency || 0;
    const delay = startDelay ?? Math.max(0.08, latency + 0.05);
    this.startAt = ctx.currentTime + delay;
    if (ctx.createConstantSource && this.output) {
      // A silent source from now on wakes the output device before the first click.
      const warm = ctx.createConstantSource();
      warm.offset.value = 0;
      warm.connect(this.output);
      warm.start();
      warm.stop(ctx.currentTime + 0.1);
    }
    let pending: ClickEvent | null | undefined;
    let lastWhen = this.startAt;

    const tick = () => {
      if (!this.running) return;
      const lookahead = hidden() ? (this.opts.hiddenLookahead ?? 1) : (this.opts.lookahead ?? 0.12);
      const now = ctx.currentTime;
      const horizon = now + lookahead;
      for (;;) {
        if (pending === undefined) {
          const n = (next as NextFn)(horizon - this.startAt);
          if (n === 'wait') break;
          pending = n;
        }
        if (!pending) break;
        let when = this.startAt + pending.time;
        if (when < now - LATE_LIMIT) {
          // The timer stalled: move the rest of the run forward rather than firing old clicks together.
          const shift = now - when;
          this.startAt += shift;
          this.shifted += shift;
          this.skipped++;
          when = this.startAt + pending.time;
        }
        if (when >= horizon) break;
        const ev: ScheduledEvent = { ...pending, when };
        lastWhen = when;
        onSchedule(ev);
        if (onVisual) this.visualQueue.push(ev);
        pending = undefined;
      }
      if (onVisual) {
        this.flushVisuals(onVisual);
        this.ensureFrameLoop(onVisual);
      }
      if (pending === null) {
        ticker.delete(tick);
        this.tickFn = null;
        const endDelay = Math.max(0, (lastWhen - ctx.currentTime) * 1000 + 300);
        this.endTimer = setTimeout(() => {
          this.endTimer = null;
          if (onVisual) this.flushVisuals(onVisual);
          this.teardown(false);
          onEnd?.();
        }, endDelay);
      }
    };
    this.tickFn = tick;
    ticker.add(tick);
    tick();
    return this.startAt;
  }

  /** Page time (performance.now ms) at which an AudioContext time reaches the speakers. */
  private pageTime(when: number): number {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      return ts.performanceTime + (when - ts.contextTime) * 1000;
    }
    return performance.now() + (when - this.ctx.currentTime) * 1000;
  }

  /** Deliver due visual events; drop any that are already stale (tab was hidden or the page stalled). */
  flushVisuals(onVisual: (e: ScheduledEvent) => void, nowMs = performance.now()): void {
    let i = 0;
    while (i < this.visualQueue.length) {
      const ev = this.visualQueue[i];
      const at = this.pageTime(ev.when);
      if (at > nowMs) {
        i++;
        continue;
      }
      this.visualQueue.splice(i, 1);
      if (this.running && nowMs - at <= STALE_VISUAL * 1000) onVisual(ev);
    }
  }

  private ensureFrameLoop(onVisual: (e: ScheduledEvent) => void) {
    if (this.raf || typeof requestAnimationFrame === 'undefined' || hidden()) return;
    const frame = (t: number) => {
      this.raf = 0;
      if (!this.running || !this.visualQueue.length) return;
      this.flushVisuals(onVisual, t);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private teardown(fade: boolean) {
    this.running = false;
    if (this.tickFn) ticker.delete(this.tickFn);
    this.tickFn = null;
    if (this.endTimer !== null) clearTimeout(this.endTimer);
    this.endTimer = null;
    if (this.raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.visualQueue = [];
    const out = this.output;
    this.output = null;
    if (out) {
      if (fade) {
        const t = this.ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(out.gain.value, t);
        out.gain.linearRampToValueAtTime(0, t + 0.005);
        setTimeout(() => out.disconnect(), 30);
      } else {
        // Natural end: let the last sound ring out first.
        setTimeout(() => out.disconnect(), 1000);
      }
    }
  }

  stop(): void {
    if (!this.running && !this.output) return;
    this.teardown(true);
  }

  get isRunning(): boolean {
    return this.running;
  }
}
