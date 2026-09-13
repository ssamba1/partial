export const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export type Temperament = 'equal' | 'just' | 'pythagorean' | 'meantone';

export const TEMPERAMENTS: { id: Temperament; label: string }[] = [
  { id: 'equal', label: 'Equal' },
  { id: 'just', label: 'Just (5-limit)' },
  { id: 'pythagorean', label: 'Pythagorean' },
  { id: 'meantone', label: 'Meantone (1/4 comma)' },
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

const TEMPERAMENT_CENTS: Record<Temperament, number[]> = {
  equal: Array.from({ length: 12 }, (_, i) => i * 100),
  just: JUST_RATIOS.map(ratioToCents),
  pythagorean: PYTHAGOREAN_RATIOS.map(ratioToCents),
  meantone: meantoneCents(),
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

export function noteName(midi: number, flats = false, withOctave = true): string {
  const names = flats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
  const name = names[mod(midi, 12)];
  return withOctave ? `${name}${Math.floor(midi / 12) - 1}` : name;
}

/** Written note for a transposing instrument. */
export function transpose(midi: number, semitones: number): number {
  return midi + semitones;
}
