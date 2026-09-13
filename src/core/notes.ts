export const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export type Temperament = 'equal' | 'just' | 'pythagorean' | 'meantone' | 'werckmeister3' | 'vallotti' | 'young2';

export const TEMPERAMENTS: { id: Temperament; label: string }[] = [
  { id: 'equal', label: 'Equal' },
  { id: 'just', label: 'Just (5-limit)' },
  { id: 'pythagorean', label: 'Pythagorean' },
  { id: 'meantone', label: 'Meantone (1/4 comma)' },
  { id: 'werckmeister3', label: 'Werckmeister III' },
  { id: 'vallotti', label: 'Vallotti' },
  { id: 'young2', label: 'Young II' },
];

/** Transposing instruments: semitones added to concert pitch to get the written pitch. */
export const TRANSPOSITIONS: { id: string; label: string; semitones: number }[] = [
  { id: 'C', label: 'Concert (C)', semitones: 0 },
  { id: 'Bb', label: 'B♭ (clarinet, trumpet, tenor sax)', semitones: 2 },
  { id: 'Eb', label: 'E♭ (alto sax, E♭ clarinet)', semitones: 9 },
  { id: 'F', label: 'F (horn, English horn)', semitones: 7 },
  { id: 'G', label: 'G (alto flute)', semitones: 5 },
  { id: 'A', label: 'A (clarinet in A)', semitones: 3 },
];

export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function ratioToCents(ratio: number): number {
  return 1200 * Math.log2(ratio);
}

const JUST_RATIOS = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8];
const PYTHAGOREAN_RATIOS = [1, 256 / 243, 9 / 8, 32 / 27, 81 / 64, 4 / 3, 729 / 512, 3 / 2, 128 / 81, 27 / 16, 16 / 9, 243 / 128];

function meantoneCents(): number[] {
  // Quarter-comma meantone: fifths of 5^(1/4), chain from 3 flats to 8 sharps of the tonic.
  const fifth = ratioToCents(Math.pow(5, 0.25));
  const out = new Array<number>(12).fill(0);
  for (let n = -3; n <= 8; n++) {
    out[mod(7 * n, 12)] = mod(n * fifth, 1200);
  }
  return out;
}

/** Pythagorean comma: twelve pure fifths overshoot seven octaves by this much (about 23.46 cents). */
export const PYTHAGOREAN_COMMA = ratioToCents(Math.pow(3, 12) / Math.pow(2, 19));

/**
 * Well temperaments defined by how much each fifth around the circle is narrowed.
 * `tempering[i]` is the narrowing (cents) of fifth i, where fifth 0 is C-G,
 * 1 is G-D, ... 11 is F-C. Returns cents above the tonic for each pitch class.
 */
export function circleOfFifthsCents(tempering: number[]): number[] {
  const pure = ratioToCents(3 / 2);
  const out = new Array<number>(12).fill(0);
  let cents = 0;
  for (let k = 0; k < 12; k++) {
    out[mod(7 * k, 12)] = mod(cents, 1200);
    cents += pure - tempering[k];
  }
  return out;
}

function tempered(fifths: number[], fraction: number): number[] {
  const t = new Array<number>(12).fill(0);
  fifths.forEach((i) => (t[i] = PYTHAGOREAN_COMMA * fraction));
  return t;
}

// Sources: Werckmeister III narrows C-G, G-D, D-A and B-F# by 1/4 Pythagorean comma.
// Modern Vallotti narrows F-C, C-G, G-D, D-A, A-E, E-B by 1/6 Pythagorean comma;
// Young's second temperament uses the same six but starting from C (C-G ... B-F#).
export const WELL_TEMPERING: Record<'werckmeister3' | 'vallotti' | 'young2', number[]> = {
  werckmeister3: tempered([0, 1, 2, 5], 1 / 4),
  vallotti: tempered([11, 0, 1, 2, 3, 4], 1 / 6),
  young2: tempered([0, 1, 2, 3, 4, 5], 1 / 6),
};

const TEMPERAMENT_CENTS: Record<Temperament, number[]> = {
  equal: Array.from({ length: 12 }, (_, i) => i * 100),
  just: JUST_RATIOS.map(ratioToCents),
  pythagorean: PYTHAGOREAN_RATIOS.map(ratioToCents),
  meantone: meantoneCents(),
  werckmeister3: circleOfFifthsCents(WELL_TEMPERING.werckmeister3),
  vallotti: circleOfFifthsCents(WELL_TEMPERING.vallotti),
  young2: circleOfFifthsCents(WELL_TEMPERING.young2),
};

/** Deviation in cents from equal temperament of the pitch class `interval` semitones above the tonic. */
export function temperamentOffset(temperament: Temperament, interval: number): number {
  const i = mod(interval, 12);
  return TEMPERAMENT_CENTS[temperament][i] - i * 100;
}

export interface TuningSystem {
  a4: number;
  temperament: Temperament;
  /** Pitch class of the tonic (0 = C). Only matters for non-equal temperaments. */
  tonic: number;
}

export const DEFAULT_TUNING: TuningSystem = { a4: 440, temperament: 'equal', tonic: 0 };

export function midiToEqualFrequency(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Tempered target frequency for a MIDI note. The A4 reference is honoured for
 * the A pitch class in equal temperament; other temperaments are anchored so
 * the tonic is equal-tempered relative to A4.
 */
export function midiToFrequency(midi: number, tuning: TuningSystem = DEFAULT_TUNING): number {
  const offset = temperamentOffset(tuning.temperament, midi - tuning.tonic);
  return midiToEqualFrequency(midi, tuning.a4) * Math.pow(2, offset / 1200);
}

export interface NoteReading {
  midi: number;
  pitchClass: number;
  octave: number;
  /** Deviation from the tempered target in cents, positive = sharp. */
  cents: number;
  target: number;
  frequency: number;
}

export function frequencyToNote(frequency: number, tuning: TuningSystem = DEFAULT_TUNING): NoteReading {
  const approx = Math.round(69 + 12 * Math.log2(frequency / tuning.a4));
  let best = approx;
  let bestCents = Infinity;
  for (let m = approx - 1; m <= approx + 1; m++) {
    const c = ratioToCents(frequency / midiToFrequency(m, tuning));
    if (Math.abs(c) < Math.abs(bestCents)) {
      bestCents = c;
      best = m;
    }
  }
  return {
    midi: best,
    pitchClass: mod(best, 12),
    octave: Math.floor(best / 12) - 1,
    cents: bestCents,
    target: midiToFrequency(best, tuning),
    frequency,
  };
}

export type Notation = 'english' | 'solfege' | 'german';

export const NOTATIONS: { id: Notation; label: string }[] = [
  { id: 'english', label: 'C D E' },
  { id: 'solfege', label: 'Do Ré Mi' },
  { id: 'german', label: 'C D H' },
];

const SOLFEGE_SHARP = ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const SOLFEGE_FLAT = ['Do', 'Réb', 'Ré', 'Mib', 'Mi', 'Fa', 'Solb', 'Sol', 'Lab', 'La', 'Sib', 'Si'];
// German: B natural is H, B flat is B.
const GERMAN_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B', 'H'];
const GERMAN_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'B', 'H'];

let currentNotation: Notation = 'english';

/** App-wide note naming system, set from settings. */
export function setNotation(n: Notation): void {
  currentNotation = n;
}

export function noteName(midi: number, flats = false, withOctave = true, notation: Notation = currentNotation): string {
  const table =
    notation === 'solfege'
      ? flats
        ? SOLFEGE_FLAT
        : SOLFEGE_SHARP
      : notation === 'german'
        ? flats
          ? GERMAN_FLAT
          : GERMAN_SHARP
        : flats
          ? NOTE_NAMES_FLAT
          : NOTE_NAMES_SHARP;
  const name = table[mod(midi, 12)];
  return withOctave ? `${name}${Math.floor(midi / 12) - 1}` : name;
}

/** Pretty accidentals for display: C# -> C♯, Bb -> B♭ (never touches the German note B). */
export function prettyName(name: string): string {
  return name.replace('#', '♯').replace(/(?<=\p{L})b(?=-?\d|$)/u, '♭');
}

/** Written note for a transposing instrument. */
export function transpose(midi: number, semitones: number): number {
  return midi + semitones;
}
