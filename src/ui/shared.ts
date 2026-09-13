import { Metronome } from '../audio/metronome';
import { PitchTracker, type TrackerOptions } from '../audio/pitchTracker';
import { getContext } from '../audio/context';
import { nearClick } from '../core/gestures';
import { ClickAudibility, SelfSounds } from '../core/selfsound';
import { getSettings, logPractice, subscribeSettings, tuningOf, updateSettings, type Activity } from '../store/settings';

/** One metronome for the whole app, so it keeps playing while you switch screens. */
export const metronome = new Metronome({
  ...getSettings().metronome,
});

let metronomeStartedAt = 0;
metronome.onState((playing) => {
  if (playing) {
    metronomeStartedAt = performance.now();
    return;
  }
  if (metronomeStartedAt) logPractice((performance.now() - metronomeStartedAt) / 1000, 'metronome');
  metronomeStartedAt = 0;
});

// Write speed-trainer tempo changes to settings the moment they happen, so no
// other settings write in between can push the old tempo back into the engine.
metronome.onTempo((bpm) => {
  updateSettings((s) => ({ metronome: { ...s.metronome, bpm } }));
});

subscribeSettings((s) => {
  const m = s.metronome;
  const cur = metronome.settings;
  const keys = [
    'bpm', 'beatsPerBar', 'beatUnit', 'subdivision', 'sound', 'volume', 'accents',
    'trainerBars', 'trainerStep', 'trainerMax', 'countInBars', 'poly', 'playBars', 'muteBars', 'randomMute', 'stopAfterBars',
  ] as const;
  if (keys.some((k) => m[k] !== cur[k])) metronome.update(m);
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
      if (!getSettings().ignoreClick || !metronome.playing) {
        hearing.reset();
        return false;
      }
      // With headphones the click never reaches the mic, so gating would only throw readings away.
      if (hearing.observe(t, level, metronome.recentClicks, latency) === 'inaudible') return false;
      return nearClick(t, metronome.recentClicks, 0.01, 0.08, latency, frameSeconds);
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
