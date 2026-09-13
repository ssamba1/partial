import type { Tendencies } from '../core/intonation';
import type { MidiAction } from '../core/midi';
import { clampA4, DEFAULT_MEANTONE_FLATS, sanitizeJustRatios, setNotation, TEMPERAMENTS, tonicFromDrones, TRANSPOSITIONS, type Notation, type Temperament, type TuningSystem } from '../core/notes';
import { dayKey } from '../core/practice';
import type { AccentLevel, ClickTrack } from '../core/rhythm';
import type { Damping } from '../core/tracking';
import type { MicChannel } from '../core/mic';
import type { ReferenceOctave } from '../core/selfsound';
import { sanitizeTuning, type CustomTuning } from '../core/instruments';
import { clampHoldSeconds, clampTolerance, type DecimalCents, type TunerScale } from '../core/display';
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
  /** MIDI notes of drones sounding when the preset was saved. */
  drones?: number[];
}

export type BeatVisual = 'blocks' | 'pendulum' | 'pulse';

export interface TuningPreset {
  id: string;
  name: string;
  a4: number;
  temperament: Temperament;
  tonic: number;
  transposition: string;
}

export function sanitizeTuningPreset(v: unknown): TuningPreset | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Partial<TuningPreset>;
  const temperament = TEMPERAMENTS.find((t) => t.id === p.temperament)?.id;
  if (typeof p.id !== 'string' || typeof p.name !== 'string' || !temperament || !TRANSPOSITIONS.some((t) => t.id === p.transposition)) return null;
  const tonic = Number(p.tonic);
  if (!Number.isInteger(tonic) || tonic < 0 || tonic > 11) return null;
  return { id: p.id, name: p.name.slice(0, 40) || 'Tuning', a4: clampA4(p.a4), temperament, tonic, transposition: p.transposition! };
}

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
  /** Chosen input device, or empty for the browser default. */
  micDeviceId: string;
  /** Which input of a stereo interface the tuner listens to. */
  micChannel: MicChannel;
  damping: Damping;
  tunerDisplay: 'ring' | 'bar' | 'strobe';
  notation: Notation;
  /** Sound the reference drone for the note you are holding. */
  followDrone: boolean;
  /** Old all-time statistics per written pitch class; moved to store/tendencies on first load and then left empty. */
  tendencies: Tendencies;
  tunerMode: 'chromatic' | 'strings' | 'partials';
  /** Concert MIDI note of the fundamental in partials mode. */
  partialFundamental: number;
  /** What stays at the reference in non-equal temperaments. */
  temperamentAnchor: 'a4' | 'tonic';
  /** Just intonation ratio choices by degree, such as { 10: '7/4' }. */
  justRatios: Record<number, string>;
  /** Flats in the quarter-comma meantone chain: where the wolf fifth falls. */
  meantoneFlats: number;
  /** Take the temperament tonic from the lowest sounding drone. */
  tonicFollowsDrone: boolean;
  /** Saved combinations of reference pitch, temperament, key and instrument key. */
  tuningPresets: TuningPreset[];
  /** Keep C at the top of the tuner ring. */
  ringFixed: boolean;
  /** Start listening when the tuner opens, if the mic is already allowed. */
  tunerAutoStart: boolean;
  /** Stop listening after this many minutes with no note; 0 never stops. */
  tunerAutoStopMinutes: number;
  stringInstrument: string;
  pureFifths: boolean;
  /** Ignore the metronome click in the tuner. */
  ignoreClick: boolean;
  /** Reference tones played by the tuner (string references, hear target, follow drone). */
  reference: {
    /** Raise low references so phone speakers can play them. */
    octave: ReferenceOctave;
    /** Sound of the reference; 'drone' uses the drone timbre. */
    timbre: DroneTimbre | 'drone';
    /** A few seconds, until tapped again, or a pluck every 2 s until tapped. */
    length: 'short' | 'hold' | 'repeat';
    volume: number;
  };
  /** String tunings made by the player. */
  customTunings: CustomTuning[];
  /** Audio cues for tuning without looking: faster ticks for bigger errors. */
  sonify: boolean;
  /** Cents either side of in tune shown by the ring, bar and trace. */
  tunerScale: TunerScale;
  /** Cents to one decimal; auto turns them on at a tolerance of 2 or less. */
  decimalCents: DecimalCents;
  /** Seconds in tune before the lock. */
  tunerHoldSeconds: number;
  /** Soft chime when a note locks in tune. */
  lockChime: boolean;
  /** Keep the last note on screen, greyed, after the sound stops. */
  keepLastNote: boolean;
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

const KEY = 'partial.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  a4: 440,
  temperament: 'equal',
  tonic: 0,
  transposition: 'C',
  flats: false,
  tolerance: 5,
  sensitivity: 0.008,
  micDeviceId: '',
  micChannel: 'mix',
  damping: 'normal',
  tunerDisplay: 'ring',
  notation: 'english',
  followDrone: false,
  tendencies: {},
  tunerMode: 'chromatic',
  partialFundamental: 46,
  temperamentAnchor: 'a4',
  justRatios: {},
  meantoneFlats: DEFAULT_MEANTONE_FLATS,
  tonicFollowsDrone: false,
  tuningPresets: [],
  ringFixed: false,
  tunerAutoStart: false,
  tunerAutoStopMinutes: 5,
  stringInstrument: 'guitar',
  pureFifths: true,
  ignoreClick: true,
  reference: { octave: 'same', timbre: 'drone', length: 'short', volume: 0.7 },
  customTunings: [],
  sonify: false,
  tunerScale: '50',
  decimalCents: 'auto',
  tunerHoldSeconds: 1.2,
  lockChime: false,
  keepLastNote: false,
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
    reference: { ...DEFAULT_SETTINGS.reference, ...stored.reference },
    tolerance: clampTolerance(stored.tolerance, DEFAULT_SETTINGS.tolerance),
    tunerHoldSeconds: clampHoldSeconds(stored.tunerHoldSeconds, DEFAULT_SETTINGS.tunerHoldSeconds),
    tunerScale: (['50', '20', '10', 'auto'] as const).includes(stored.tunerScale as TunerScale) ? (stored.tunerScale as TunerScale) : DEFAULT_SETTINGS.tunerScale,
    customTunings: Array.isArray(stored.customTunings) ? stored.customTunings.map(sanitizeTuning).filter((x): x is CustomTuning => x !== null) : [],
    a4: clampA4(stored.a4, DEFAULT_SETTINGS.a4),
    tunerMode: (['chromatic', 'strings', 'partials'] as const).includes(stored.tunerMode as Settings['tunerMode']) ? (stored.tunerMode as Settings['tunerMode']) : DEFAULT_SETTINGS.tunerMode,
    partialFundamental: Number.isInteger(stored.partialFundamental) && stored.partialFundamental! >= 24 && stored.partialFundamental! <= 72 ? stored.partialFundamental! : DEFAULT_SETTINGS.partialFundamental,
    temperamentAnchor: stored.temperamentAnchor === 'tonic' ? 'tonic' : 'a4',
    justRatios: sanitizeJustRatios(stored.justRatios),
    meantoneFlats: Number.isInteger(stored.meantoneFlats) && stored.meantoneFlats! >= 0 && stored.meantoneFlats! <= 11 ? stored.meantoneFlats! : DEFAULT_MEANTONE_FLATS,
    tuningPresets: Array.isArray(stored.tuningPresets) ? stored.tuningPresets.map(sanitizeTuningPreset).filter((x): x is TuningPreset => x !== null) : [],
    tunerAutoStopMinutes: clampAutoStop(stored.tunerAutoStopMinutes),
  };
}

/** Minutes of silence before the tuner stops: 0 (never) to 60. */
export function clampAutoStop(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.tunerAutoStopMinutes;
  return Math.max(0, Math.min(60, Math.round(n)));
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

let droneNotes: () => readonly number[] = () => [];

/** The drone bank registers here, so the tonic can follow the lowest drone without settings importing audio code. */
export function setDroneNotesSource(fn: () => readonly number[]): void {
  droneNotes = fn;
}

export function tuningOf(s: Settings): TuningSystem {
  return {
    a4: s.a4,
    temperament: s.temperament,
    tonic: s.tonicFollowsDrone && s.temperament !== 'equal' ? tonicFromDrones(s.tonic, droneNotes()) : s.tonic,
    anchor: s.temperamentAnchor,
    justRatios: s.justRatios,
    meantoneFlats: s.meantoneFlats,
  };
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
