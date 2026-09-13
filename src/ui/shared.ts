import { Metronome } from '../audio/metronome';
import { PitchTracker } from '../audio/pitchTracker';
import { getSettings, logPractice, subscribeSettings, tuningOf, updateSettings } from '../store/settings';

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
  logPractice((performance.now() - metronomeStartedAt) / 1000);
  // Persist the tempo reached by the speed trainer.
  updateSettings((s) => ({ metronome: { ...s.metronome, bpm: metronome.settings.bpm } }));
});

// Keep the settings screen in sync when the speed trainer raises the tempo.
metronome.onBeat((e) => {
  if (e.sub === 0 && e.beat === 0 && getSettings().metronome.bpm !== metronome.settings.bpm) {
    updateSettings((s) => ({ metronome: { ...s.metronome, bpm: metronome.settings.bpm } }));
  }
});

subscribeSettings((s) => {
  const m = s.metronome;
  const cur = metronome.settings;
  if (
    m.bpm !== cur.bpm ||
    m.beatsPerBar !== cur.beatsPerBar ||
    m.subdivision !== cur.subdivision ||
    m.sound !== cur.sound ||
    m.volume !== cur.volume ||
    m.accents !== cur.accents ||
    m.trainerBars !== cur.trainerBars ||
    m.trainerStep !== cur.trainerStep ||
    m.trainerMax !== cur.trainerMax ||
    m.beatUnit !== cur.beatUnit
  ) {
    metronome.update(m);
  }
});

export function createTracker(): PitchTracker {
  return new PitchTracker(
    () => tuningOf(getSettings()),
    () => getSettings().sensitivity,
  );
}
