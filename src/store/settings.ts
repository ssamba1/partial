import type { Tendencies } from '../core/intonation';
import type { MidiAction } from '../core/midi';
import { setNotation, type Notation, type Temperament } from '../core/notes';
import { dayKey } from '../core/practice';
import type { AccentLevel, ClickTrack } from '../core/rhythm';
import type { Damping } from '../audio/pitchTracker';
import type { DroneTimbre, ClickSound } from '../audio/voices';

export type Activity = 'tuner' | 'metronome' | 'sound' | 'record' | 'analysis';

export interface MetronomePreset {
  id: string;
  name: string;
  bpm: number;
  beatsPerBar: number;
  beatUnit: number;
  subdivision: number;
  accents: AccentLevel[];
}

export type BeatVisual = 'blocks' | 'pendulum' | 'pulse';

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  a4: number;
  temperament: Temperament;
  tonic: number;
  transposition: string;
  flats: boolean;
  /** In-tune tolerance in cents. */
  tolerance: number;
  /** Mic gate as RMS. */
  sensitivity: number;
  damping: Damping;
  tunerDisplay: 'ring' | 'bar' | 'strobe';
  notation: Notation;
  /** Sound the reference drone for the note you are holding. */
  followDrone: boolean;
  /** All-time intonation statistics per written pitch class. */
  tendencies: Tendencies;
  tunerMode: 'chromatic' | 'strings';
  stringInstrument: string;
  pureFifths: boolean;
  /** Ignore the metronome click in the tuner. */
  ignoreClick: boolean;
  metronome: {
    bpm: number;
    beatsPerBar: number;
    beatUnit: number;
    subdivision: number;
    accents: AccentLevel[];
    sound: ClickSound;
    volume: number;
    trainerBars: number;
    trainerStep: number;
    trainerMax: number;
    countInBars: number;
    poly: number;
    playBars: number;
    muteBars: number;
    randomMute: number;
    stopAfterBars: number;
    visual: BeatVisual;
    flashScreen: boolean;
  };
  metronomePresets: MetronomePreset[];
  drone: {
    octave: number;
    timbre: DroneTimbre;
    volume: number;
    view: 'wheel' | 'keys';
    chord: string;
  };
  clickTracks: ClickTrack[];
  /** Seconds per local day. */
  practiceLog: Record<string, number>;
  /** Seconds per local day per activity. */
  activityLog: Record<string, Partial<Record<Activity, number>>>;
  dailyGoalMinutes: number;
  seenIntro: boolean;
  /** MIDI trigger key ("note:60", "cc:64") to action. */
  midiMap: Record<string, MidiAction>;
  midiEnabled: boolean;
  /** Announce tuner readings through a live region for screen readers. */
  announce: boolean;
}

const KEY = 'resonare.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  a4: 440,
  temperament: 'equal',
  tonic: 0,
  transposition: 'C',
  flats: false,
  tolerance: 5,
  sensitivity: 0.008,
  damping: 'normal',
  tunerDisplay: 'ring',
  notation: 'english',
  followDrone: false,
  tendencies: {},
  tunerMode: 'chromatic',
  stringInstrument: 'guitar',
  pureFifths: true,
  ignoreClick: true,
  metronome: {
    bpm: 100,
    beatsPerBar: 4,
    beatUnit: 4,
    subdivision: 1,
    accents: ['accent', 'normal', 'normal', 'normal'],
    sound: 'wood',
    volume: 0.8,
    trainerBars: 0,
    trainerStep: 2,
    trainerMax: 160,
    countInBars: 0,
    poly: 0,
    playBars: 0,
    muteBars: 0,
    randomMute: 0,
    stopAfterBars: 0,
    visual: 'blocks',
    flashScreen: false,
  },
  metronomePresets: [],
  drone: { octave: 3, timbre: 'organ', volume: 0.6, view: 'wheel', chord: 'root' },
  clickTracks: [],
  practiceLog: {},
  activityLog: {},
  dailyGoalMinutes: 30,
  seenIntro: false,
  midiMap: {},
  midiEnabled: false,
  announce: false,
};

function safeParse(raw: string | null): Partial<Settings> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return typeof v === 'object' && v !== null ? (v as Partial<Settings>) : {};
  } catch {
    return {};
  }
}

export function mergeSettings(stored: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    metronome: { ...DEFAULT_SETTINGS.metronome, ...stored.metronome },
    drone: { ...DEFAULT_SETTINGS.drone, ...stored.drone },
  };
}

function load(): Settings {
  try {
    return mergeSettings(safeParse(localStorage.getItem(KEY)));
  } catch {
    // Storage blocked: run with defaults.
    return mergeSettings({});
  }
}

let current = load();
setNotation(current.notation);
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)): Settings {
  const p = typeof patch === 'function' ? patch(current) : patch;
  current = { ...current, ...p };
  // Note names are read synchronously all over the UI, so update the naming system before notifying.
  setNotation(current.notation);
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Quota or blocked storage: keep in memory only.
  }
  listeners.forEach((fn) => fn(current));
  return current;
}

export function subscribeSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function tuningOf(s: Settings) {
  return { a4: s.a4, temperament: s.temperament, tonic: s.tonic };
}

/** Adds practice seconds to today's total and to the activity's total. */
export function logPractice(seconds: number, activity: Activity): void {
  if (!(seconds > 0) || seconds > 24 * 3600) return;
  const day = dayKey(new Date());
  updateSettings((s) => {
    const dayActivities = s.activityLog[day] ?? {};
    return {
      practiceLog: { ...s.practiceLog, [day]: (s.practiceLog[day] ?? 0) + seconds },
      activityLog: { ...s.activityLog, [day]: { ...dayActivities, [activity]: (dayActivities[activity] ?? 0) + seconds } },
    };
  });
}
