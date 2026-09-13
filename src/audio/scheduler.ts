import type { ClickEvent } from '../core/rhythm';

export interface ScheduledEvent extends ClickEvent {
  /** AudioContext time at which the event sounds. */
  when: number;
}

/**
 * Lookahead scheduler ("A Tale of Two Clocks" pattern): a coarse JS timer wakes
 * up often and schedules every event that falls inside the lookahead window on
 * the sample-accurate AudioContext clock. UI callbacks fire close to the audible
 * time via setTimeout, so visual jitter never affects the audio.
 */
export class LookaheadScheduler {
  private timer: number | null = null;
  private visualTimers = new Set<number>();
  private running = false;

  constructor(
    private ctx: AudioContext,
    private readonly opts: { lookahead?: number; interval?: number } = {},
  ) {}

  /**
   * @param next returns the next event (times relative to `startAt`), or null when the sequence ends.
   */
  start(
    next: () => ClickEvent | null,
    onSchedule: (e: ScheduledEvent) => void,
    onVisual?: (e: ScheduledEvent) => void,
    onEnd?: () => void,
    startDelay = 0.08,
  ): number {
    this.stop();
    this.running = true;
    const lookahead = this.opts.lookahead ?? 0.12;
    const interval = this.opts.interval ?? 25;
    const startAt = this.ctx.currentTime + startDelay;
    let pending = next();
    let lastWhen = startAt;

    const tick = () => {
      if (!this.running) return;
      const horizon = this.ctx.currentTime + lookahead;
      while (pending && startAt + pending.time < horizon) {
        const ev: ScheduledEvent = { ...pending, when: startAt + pending.time };
        lastWhen = ev.when;
        onSchedule(ev);
        if (onVisual) {
          const delay = Math.max(0, (ev.when - this.ctx.currentTime) * 1000);
          const id = window.setTimeout(() => {
            this.visualTimers.delete(id);
            if (this.running) onVisual(ev);
          }, delay);
          this.visualTimers.add(id);
        }
        pending = next();
      }
      if (!pending) {
        const endDelay = Math.max(0, (lastWhen - this.ctx.currentTime) * 1000 + 300);
        this.timer = window.setTimeout(() => {
          this.running = false;
          this.timer = null;
          onEnd?.();
        }, endDelay);
        return;
      }
      this.timer = window.setTimeout(tick, interval);
    };
    tick();
    return startAt;
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.visualTimers.forEach((id) => window.clearTimeout(id));
    this.visualTimers.clear();
  }

  get isRunning(): boolean {
    return this.running;
  }
}
