import type { Tendencies } from '../core/intonation';
import type { MidiAction } from '../core/midi';
import { clampA4, concertToWrittenPc, DEFAULT_MEANTONE_FLATS, NOTATIONS, sanitizeJustRatios, setNotation, spellWithFlats, TEMPERAMENTS, tonicFromDrones, TRANSPOSITIONS, type Notation, type OctaveStyle, type Spelling, type Temperament, type TuningSystem } from '../core/notes';
import { EDOS, type CapturedNote } from '../core/scales';
import type { TuningCheckEntry } from '../core/tuningtools';
import { dayKey } from '../core/practice';
import type { AccentLevel, ClickTrack } from '../core/rhythm';
import type { SubLayer } from '../core/metroseq';
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
  if (typeof p.id !== 'string' || typeof p.name !== 'string' || !temperament || temperament === 'custom' || !TRANSPOSITIONS.some((t) => t.id === p.transposition)) return null;
  const tonic = Number(p.tonic);
  if (!Number.isInteger(tonic) || tonic < 0 || tonic > 11) return null;
  return { id: p.id, name: p.name.slice(0, 40) || 'Tuning', a4: clampA4(p.a4), temperament, tonic, transposition: p.transposition! };
}

export type TunerMode = 'chromatic' | 'strings' | 'partials' | 'sa' | 'scale' | 'timpani' | 'bells';
export const TUNER_MODES: TunerMode[] = ['chromatic', 'strings', 'partials', 'sa', 'scale', 'timpani', 'bells'];

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  a4: number;
  temperament: Temperament;
  tonic: number;
  transposition: string;
  /** Spell with flats. Derived from `spelling` and the key; kept so readers stay simple. */
  flats: boolean;
  /** Sharps, flats, or follow the key signature of the key note. */
  spelling: Spelling;
  /** Scientific (C4) or Helmholtz (c′) octave names. */
  octaveStyle: OctaveStyle;
  /** Notes per octave of an equal division for the chromatic tuner; 12 is normal. */
  edo: number;
  /** An imported 12-note Scala scale, cents above the key note. */
  customScale: { name: string; cents: number[] } | null;
  /** Sa in hertz for the Sa tuner mode. */
  saHz: number;
  /** Notes captured from an instrument for the My scale mode. */
  capturedScale: CapturedNote[];
  /** Lowest and highest held notes found by the range finder (MIDI). */
  vocalRange: { low: number; high: number } | null;
  /** Ensemble tuning checks recorded by a teacher. */
  tuningChecks: TuningCheckEntry[];
  /** Vibrate short-short when sharp and long when flat. */
  hapticCues: boolean;
  /** Measured piano inharmonicity by MIDI note. */
  pianoB: Record<number, number>;
  /** Tune a piano to the stretch curve from the measured notes. */
  pianoStretch: boolean;
  /** Instrument whose known tuning tendencies are shown while playing. */
  tendencyInstrument: string;
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
  tunerMode: TunerMode;
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
    /** Beats per polyrhythm cycle (0 = one bar). */
    polyBeats: number;
    /** How much louder accents are than normal beats, in dB. */
    accentDb: number;
    /** Beat groups, for example [2, 2, 3]; empty = none. */
    grouping: number[];
    /** One click per group instead of per beat. */
    clickGroups: boolean;
    /** Note value BPM counts, in whole notes; 0 = the beat unit. */
    pulseNote: number;
    /** Levels of subdivision clicks per beat and cell. */
    pattern: (AccentLevel | 'sub')[][];
    subdivisionPerBeat: number[];
    figure: string;
    swing: number;
    layers: SubLayer[];
    timeline: string;
    /** Accent patterns remembered per meter ("7/8"), restored when you return to it. */
    accentMemory: Record<string, AccentLevel[]>;
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
  spelling: 'sharps',
  octaveStyle: 'scientific',
  edo: 12,
  customScale: null,
  saHz: 146.8,
  capturedScale: [],
  vocalRange: null,
  tuningChecks: [],
  hapticCues: false,
  pianoB: {},
  pianoStretch: false,
  tendencyInstrument: '',
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
    polyBeats: 0,
    accentDb: 6,
    grouping: [],
    clickGroups: false,
    pulseNote: 0,
    pattern: [],
    subdivisionPerBeat: [],
    figure: '',
    swing: 50,
    layers: [],
    timeline: '',
    accentMemory: {},
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
  return derive({
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
    partialFundamental: Number.isInteger(stored.partialFundamental) && stored.partialFundamental! >= 24 && stored.partialFundamental! <= 72 ? stored.partialFundamental! : DEFAULT_SETTINGS.partialFundamental,
    temperamentAnchor: stored.temperamentAnchor === 'tonic' ? 'tonic' : 'a4',
    justRatios: sanitizeJustRatios(stored.justRatios),
    meantoneFlats: Number.isInteger(stored.meantoneFlats) && stored.meantoneFlats! >= 0 && stored.meantoneFlats! <= 11 ? stored.meantoneFlats! : DEFAULT_MEANTONE_FLATS,
    tuningPresets: Array.isArray(stored.tuningPresets) ? stored.tuningPresets.map(sanitizeTuningPreset).filter((x): x is TuningPreset => x !== null) : [],
    tunerAutoStopMinutes: clampAutoStop(stored.tunerAutoStopMinutes),
    tunerMode: TUNER_MODES.includes(stored.tunerMode as TunerMode) ? (stored.tunerMode as TunerMode) : DEFAULT_SETTINGS.tunerMode,
    notation: NOTATIONS.some((n) => n.id === stored.notation) ? (stored.notation as Notation) : DEFAULT_SETTINGS.notation,
    transposition: TRANSPOSITIONS.some((x) => x.id === stored.transposition) ? stored.transposition! : 'C',
    temperament: TEMPERAMENTS.some((x) => x.id === stored.temperament) ? (stored.temperament as Temperament) : 'equal',
    spelling: (['sharps', 'flats', 'key'] as const).includes(stored.spelling as Spelling) ? (stored.spelling as Spelling) : stored.flats ? 'flats' : 'sharps',
    octaveStyle: stored.octaveStyle === 'helmholtz' ? 'helmholtz' : 'scientific',
    edo: (EDOS as readonly number[]).includes(Number(stored.edo)) ? Number(stored.edo) : 12,
    customScale: sanitizeCustomScale(stored.customScale),
    saHz: Number.isFinite(Number(stored.saHz)) && Number(stored.saHz) >= 50 && Number(stored.saHz) <= 1000 ? Math.round(Number(stored.saHz) * 10) / 10 : DEFAULT_SETTINGS.saHz,
    capturedScale: Array.isArray(stored.capturedScale) ? stored.capturedScale.filter((n) => n && Number(n.hz) > 20 && Number(n.hz) < 5000).map((n) => ({ hz: Number(n.hz), label: String(n.label ?? '').slice(0, 12) })).slice(0, 48) : [],
    vocalRange: stored.vocalRange && Number.isInteger(stored.vocalRange.low) && Number.isInteger(stored.vocalRange.high) ? { low: stored.vocalRange.low, high: stored.vocalRange.high } : null,
    tuningChecks: Array.isArray(stored.tuningChecks) ? stored.tuningChecks.filter((e) => e && typeof e.player === 'string' && Number.isFinite(e.cents) && Number.isFinite(e.time)) : [],
    pianoB: sanitizePianoB(stored.pianoB),
  });
}

/** Fills in values derived from others: flats from the spelling and the written key. */
export function derive(s: Settings): Settings {
  const semis = TRANSPOSITIONS.find((x) => x.id === s.transposition)?.semitones ?? 0;
  return { ...s, flats: spellWithFlats(s.spelling, concertToWrittenPc(s.tonic, semis)) };
}

function sanitizeCustomScale(v: unknown): Settings['customScale'] {
  if (!v || typeof v !== 'object') return null;
  const c = v as { name?: unknown; cents?: unknown };
  if (!Array.isArray(c.cents) || c.cents.length !== 12 || !c.cents.every((x) => Number.isFinite(x))) return null;
  return { name: String(c.name ?? 'Imported').slice(0, 60), cents: c.cents.map(Number) };
}

function sanitizePianoB(v: unknown): Record<number, number> {
  const out: Record<number, number> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, b] of Object.entries(v as Record<string, unknown>)) {
    const m = Number(k);
    if (Number.isInteger(m) && m >= 21 && m <= 108 && Number.isFinite(b) && (b as number) >= 0 && (b as number) < 0.1) out[m] = b as number;
  }
  return out;
}

function applyNaming(s: Settings): void {
  const semis = TRANSPOSITIONS.find((x) => x.id === s.transposition)?.semitones ?? 0;
  setNotation(s.notation, concertToWrittenPc(s.tonic, semis), s.octaveStyle);
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
applyNaming(current);
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)): Settings {
  const p = typeof patch === 'function' ? patch(current) : patch;
  // An old caller setting `flats` directly picks sharps or flats.
  const spelling = p.spelling ?? (p.flats !== undefined ? (p.flats ? 'flats' : 'sharps') : current.spelling);
  current = derive({ ...current, ...p, spelling });
  // Note names are read synchronously all over the UI, so update the naming system before notifying.
  applyNaming(current);
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
    customCents: s.temperament === 'custom' ? s.customScale?.cents : undefined,
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
