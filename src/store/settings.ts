import type { Temperament } from '../core/notes';
import type { AccentLevel, ClickTrack } from '../core/rhythm';
import type { DroneTimbre, ClickSound } from '../audio/voices';

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  a4: number;
  temperament: Temperament;
  tonic: number;
  transposition: string;
  flats: boolean;
  /** In-tune tolerance in cents (needle turns green inside it). */
  tolerance: number;
  /** Mic gate as RMS. */
  sensitivity: number;
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
  };
  drone: {
    octave: number;
    timbre: DroneTimbre;
    volume: number;
  };
  clickTracks: ClickTrack[];
  practiceLog: Record<string, number>;
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
  },
  drone: { octave: 3, timbre: 'organ', volume: 0.6 },
  clickTracks: [],
  practiceLog: {},
};

function safeParse(raw: string | null): Partial<Settings> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Partial<Settings>;
  } catch {
    return {};
  }
}

function load(): Settings {
  let stored: Partial<Settings> = {};
  try {
    stored = safeParse(localStorage.getItem(KEY));
  } catch {
    // Storage blocked: run with defaults.
  }
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    metronome: { ...DEFAULT_SETTINGS.metronome, ...stored.metronome },
    drone: { ...DEFAULT_SETTINGS.drone, ...stored.drone },
  };
}

let current = load();
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)): Settings {
  const p = typeof patch === 'function' ? patch(current) : patch;
  current = { ...current, ...p };
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

/** Adds practice seconds to today's total. */
export function logPractice(seconds: number): void {
  if (seconds <= 0) return;
  const day = new Date().toISOString().slice(0, 10);
  updateSettings((s) => ({ practiceLog: { ...s.practiceLog, [day]: (s.practiceLog[day] ?? 0) + seconds } }));
}
