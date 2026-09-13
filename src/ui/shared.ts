import { Metronome } from '../audio/metronome';
import { PitchTracker, type TrackerOptions } from '../audio/pitchTracker';
import { getContext } from '../audio/context';
import { TapTempo } from '../core/rhythm';
import { ClickLog, nearClick } from '../core/gestures';
import { ClickAudibility, SelfSounds } from '../core/selfsound';
import { getSettings, logPractice, subscribeSettings, tuningOf, updateSettings, type Activity } from '../store/settings';

/** One metronome for the whole app, so it keeps playing while you switch screens. */
export const metronome = new Metronome({
  ...getSettings().metronome,
});

/* ---------- Transport: only one timing engine plays at a time ---------- */

type TransportOwner = 'metronome' | 'clicktrack' | 'exercise';
let transport: { owner: TransportOwner; stop: () => void } | null = null;

/**
 * Called by each timing engine when it starts. Whichever engine held the
 * transport is stopped, so two clicks never play out of phase.
 */
export function claimTransport(owner: TransportOwner, stop: () => void): void {
  const prev = transport;
  transport = { owner, stop };
  if (prev && prev.owner !== owner) prev.stop();
}

/** Called when an engine stops; does nothing if another engine has taken over. */
export function releaseTransport(owner: TransportOwner): void {
  if (transport?.owner === owner) transport = null;
}

/** Which engine is playing, if any. */
export function transportOwner(): TransportOwner | null {
  return transport?.owner ?? null;
}

/* ---------- Click times, so trackers can ignore the app's own clicks in the mic ---------- */

export const clickLog = new ClickLog();

/** Every engine that schedules an audible click reports its AudioContext time here. */
export function registerClick(when: number): void {
  clickLog.add(when);
}

metronome.onClick = registerClick;

let metronomeStartedAt = 0;
metronome.onState((playing) => {
  if (playing) {
    claimTransport('metronome', () => metronome.stop());
    // A resume after an interruption keeps counting the same session.
    metronomeStartedAt ||= performance.now();
    return;
  }
  releaseTransport('metronome');
  if (metronomeStartedAt) logPractice((performance.now() - metronomeStartedAt) / 1000, 'metronome');
  metronomeStartedAt = 0;
});

/* ---------- Tap tempo, shared by the tap button, the dock, the T key, MIDI and hands-free taps ---------- */

export const tapper = new TapTempo();
const tapListeners = new Set<(count: number, bpm: number | null) => void>();

/** Taps so far and the tempo shown on tap buttons. */
export function onTap(fn: (count: number, bpm: number | null) => void): () => void {
  tapListeners.add(fn);
  return () => tapListeners.delete(fn);
}

/**
 * One tap at `timeMs` (event.timeStamp, on the performance.now() clock). From the third tap the tempo
 * is set. While playing, the fourth tap lines the beat up: the next bar starts one tapped beat
 * after the last tap, earlier by the output latency so it is heard on time.
 */
export function tapInput(timeMs: number): void {
  const bpm = tapper.add(timeMs);
  if (bpm !== null) updateSettings((s) => ({ metronome: { ...s.metronome, bpm } }));
  tapListeners.forEach((fn) => fn(tapper.count, bpm));
  const interval = tapper.intervalMs();
  if (tapper.count === 4 && interval && metronome.playing) {
    const ctx = getContext();
    const stamp = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
    const perfNow = stamp?.performanceTime ?? performance.now();
    const ctxNow = stamp?.contextTime ?? ctx.currentTime;
    let at = timeMs + interval;
    while (at < perfNow + 60) at += interval;
    const when = ctxNow + (at - perfNow) / 1000 - outputLatency();
    void metronome.alignTo(when);
  }
}

subscribeSettings((s) => {
  const m = s.metronome;
  const cur = metronome.settings;
  const keys = Object.keys(m) as (keyof typeof m)[];
  if (keys.some((k) => m[k] !== (cur as unknown as typeof m)[k])) metronome.update(m);
});

/** Seconds from scheduling a sound to it leaving the speakers. */
export function outputLatency(): number {
  const ctx = getContext();
  return ctx.outputLatency || ctx.baseLatency || 0;
}

/** Short cues the app plays itself (lock chime, sonified tuner); trackers skip frames that contain them. */
export const selfSounds = new SelfSounds();

export type AppTracker = PitchTracker & {
  /** Whether the mic hears the metronome; gating stops once it is known not to. */
  clickHearing: ClickAudibility;
};

export function createTracker(extra: Partial<TrackerOptions> = {}): AppTracker {
  const hearing = new ClickAudibility();
  const tracker = new PitchTracker({
    tuning: () => tuningOf(getSettings()),
    sensitivity: () => getSettings().sensitivity,
    damping: () => getSettings().damping,
    gate: (t, frameSeconds, level) => {
      const latency = outputLatency();
      if (selfSounds.inFrame(t, frameSeconds, latency)) return true;
      if (!getSettings().ignoreClick || !transportOwner()) {
        hearing.reset();
        return false;
      }
      const clicks = clickLog.times(t - frameSeconds - latency);
      // With headphones the click never reaches the mic, so gating would only throw readings away.
      if (hearing.observe(t, level, clicks, latency) === 'inaudible') return false;
      return nearClick(t, clicks, 0.01, 0.08, latency, frameSeconds);
    },
    deviceId: () => getSettings().micDeviceId,
    channel: () => getSettings().micChannel,
    ...extra,
  });
  return Object.assign(tracker, { clickHearing: hearing });
}

/** Tracks how long an activity runs and logs it to the practice history. */
export class ActivityTimer {
  private startedAt = 0;
  constructor(private activity: Activity) {}
  start(): void {
    this.startedAt = performance.now();
  }
  stop(): void {
    if (!this.startedAt) return;
    logPractice((performance.now() - this.startedAt) / 1000, this.activity);
    this.startedAt = 0;
  }
}

/* ---------- Session in-tune tracker (shown in the top bar) ---------- */

type SessionListener = (s: { voiced: number; inTune: number }) => void;
const session = { voiced: 0, inTune: 0 };
const sessionListeners = new Set<SessionListener>();

export function recordTuningFrame(cents: number | null): void {
  if (cents === null) return;
  session.voiced++;
  if (Math.abs(cents) <= getSettings().tolerance) session.inTune++;
  if (session.voiced % 6 === 0) sessionListeners.forEach((fn) => fn(session));
}

export function resetSession(): void {
  session.voiced = 0;
  session.inTune = 0;
  sessionListeners.forEach((fn) => fn(session));
}

export function onSession(fn: SessionListener): () => void {
  sessionListeners.add(fn);
  fn(session);
  return () => sessionListeners.delete(fn);
}
