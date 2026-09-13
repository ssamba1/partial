import { Metronome } from '../audio/metronome';
import { PitchTracker, type TrackerOptions } from '../audio/pitchTracker';
import { nearClick } from '../core/gestures';
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

export function createTracker(extra: Partial<TrackerOptions> = {}): PitchTracker {
  return new PitchTracker({
    tuning: () => tuningOf(getSettings()),
    sensitivity: () => getSettings().sensitivity,
    damping: () => getSettings().damping,
    gate: (t) => getSettings().ignoreClick && metronome.playing && nearClick(t, metronome.recentClicks),
    deviceId: () => getSettings().micDeviceId,
    channel: () => getSettings().micChannel,
    ...extra,
  });
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
