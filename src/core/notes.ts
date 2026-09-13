export const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export type Temperament = 'equal' | 'just' | 'pythagorean' | 'meantone' | 'meantone6' | 'werckmeister3' | 'vallotti' | 'young2' | 'kirnberger3' | 'kellner' | 'neidhardt1' | 'custom';

export const TEMPERAMENTS: { id: Temperament; label: string }[] = [
  { id: 'equal', label: 'Equal' },
  { id: 'just', label: 'Just (5-limit)' },
  { id: 'pythagorean', label: 'Pythagorean' },
  { id: 'meantone', label: 'Meantone (1/4 comma)' },
  { id: 'meantone6', label: 'Meantone (1/6 comma)' },
  { id: 'werckmeister3', label: 'Werckmeister III' },
  { id: 'vallotti', label: 'Vallotti' },
  { id: 'young2', label: 'Young II' },
  { id: 'kirnberger3', label: 'Kirnberger III' },
  { id: 'kellner', label: 'Kellner' },
  { id: 'neidhardt1', label: 'Neidhardt I' },
  { id: 'custom', label: 'Imported scale' },
];

/**
 * Transposing instruments: semitones added to concert pitch to get the written pitch.
 * Sources for each interval, sounding relative to written:
 * saxophones: https://scholar.colorado.edu/downloads/w37637823 (soprano M2, alto M6, tenor M9, baritone octave plus M6 lower);
 * clarinets in Bb, A and Eb: https://www.vsl.co.at/academy/woodwinds/clarinet ;
 * bass clarinet (treble clef): https://www.vsl.co.at/academy/woodwinds/bass-clarinet ;
 * trumpets in Bb and D: https://www.vsl.co.at/academy/brass/trumpet-c ; Eb trumpet: https://www.paulmorellimusic.com/writing-for-the-trumpet.html ;
 * horn in F: https://www.vsl.co.at/academy/brass/horn-f ; English horn: https://www.vsl.co.at/academy/woodwinds/english-horn ;
 * alto flute: https://www.andrewhugill.com/OrchestraManual/flutes.html ; piccolo: https://www.vsl.co.at/academy/woodwinds/piccolo ;
 * double bass: https://www.vsl.co.at/academy/strings/double-bass ; contrabassoon: https://www.vsl.co.at/academy/woodwinds/contrabassoon ;
 * glockenspiel: https://www.vsl.co.at/academy/percussion/glockenspiel ;
 * euphonium in treble clef: https://pressbooks.palni.org/brasstechniquesandpedagogy/chapter/the-euphonium/
 * Ids already in use are kept so saved presets still load.
 */
export const TRANSPOSITIONS: { id: string; label: string; semitones: number }[] = [
  { id: 'C', label: 'Concert (C)', semitones: 0 },
  { id: 'Bb', label: 'B♭ (clarinet, trumpet, soprano sax)', semitones: 2 },
  { id: 'Bb9', label: 'B♭ low (tenor sax, bass clarinet, treble clef euphonium)', semitones: 14 },
  { id: 'A', label: 'A (clarinet in A)', semitones: 3 },
  { id: 'Eb', label: 'E♭ (alto sax)', semitones: 9 },
  { id: 'Eb13', label: 'E♭ low (baritone sax)', semitones: 21 },
  { id: 'EbHigh', label: 'E♭ high (E♭ clarinet, E♭ trumpet)', semitones: -3 },
  { id: 'D', label: 'D (D trumpet)', semitones: -2 },
  { id: 'F', label: 'F (horn, English horn)', semitones: 7 },
  { id: 'G', label: 'G (alto flute)', semitones: 5 },
  { id: 'C8va', label: 'Octave up (piccolo)', semitones: -12 },
  { id: 'C8vb', label: 'Octave down (double bass, contrabassoon)', semitones: 12 },
  { id: 'C15ma', label: 'Two octaves up (glockenspiel)', semitones: -24 },
];

/** Short label for a transposition, such as "B♭ low", or '' for concert pitch. */
export function transpositionShort(id: string): string {
  const t = TRANSPOSITIONS.find((x) => x.id === id);
  if (!t || t.id === 'C') return '';
  return t.label.split(' (')[0];
}

export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function ratioToCents(ratio: number): number {
  return 1200 * Math.log2(ratio);
}

const JUST_RATIOS = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8];
const PYTHAGOREAN_RATIOS = [1, 256 / 243, 9 / 8, 32 / 27, 81 / 64, 4 / 3, 729 / 512, 3 / 2, 128 / 81, 27 / 16, 16 / 9, 243 / 128];

/**
 * Other ratios players use for some degrees of just intonation, first entry the default.
 * Ratios and names from the Huygens-Fokker Foundation list of intervals:
 * https://www.huygens-fokker.org/docs/intervals.html
 */
export const JUST_ALTERNATIVES: Record<number, { ratio: [number, number]; name: string }[]> = {
  2: [
    { ratio: [9, 8], name: 'major whole tone' },
    { ratio: [10, 9], name: 'minor whole tone' },
  ],
  3: [
    { ratio: [6, 5], name: 'minor third' },
    { ratio: [7, 6], name: 'septimal minor third' },
  ],
  6: [
    { ratio: [45, 32], name: 'diatonic tritone' },
    { ratio: [64, 45], name: '2nd tritone' },
    { ratio: [7, 5], name: 'septimal tritone' },
  ],
  10: [
    { ratio: [9, 5], name: 'just minor seventh' },
    { ratio: [16, 9], name: 'Pythagorean minor seventh' },
    { ratio: [7, 4], name: 'harmonic seventh' },
  ],
};

/** Chosen just ratios by degree ("7/4"), keeping only choices listed in JUST_ALTERNATIVES. */
export function sanitizeJustRatios(v: unknown): Record<number, string> {
  const out: Record<number, string> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [deg, r] of Object.entries(v as Record<string, unknown>)) {
    const alts = JUST_ALTERNATIVES[Number(deg)];
    if (alts?.some((a) => `${a.ratio[0]}/${a.ratio[1]}` === r)) out[Number(deg)] = r as string;
  }
  return out;
}

function justCents(choices: Record<number, string> | undefined): number[] {
  return JUST_RATIOS.map((r, deg) => {
    const pick = choices?.[deg];
    if (!pick) return ratioToCents(r);
    const [n, d] = pick.split('/').map(Number);
    return n > 0 && d > 0 ? ratioToCents(n / d) : ratioToCents(r);
  });
}

/** Default meantone chain: 3 flats to 8 sharps of the tonic (E♭ to G♯ in C). */
export const DEFAULT_MEANTONE_FLATS = 3;

/**
 * Quarter-comma meantone: fifths of 5^(1/4). The chain runs from `flats` fifths
 * below the tonic to 11 - flats above, so the wolf sits between its two ends.
 */
export function meantoneCents(flats = DEFAULT_MEANTONE_FLATS): number[] {
  const f = Math.max(0, Math.min(11, Math.round(flats)));
  const fifth = ratioToCents(Math.pow(5, 0.25));
  const out = new Array<number>(12).fill(0);
  for (let n = -f; n <= 11 - f; n++) {
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

/**
 * Cents above C, from the Scala archive of the Huygens-Fokker Foundation,
 * https://www.huygens-fokker.org/docs/scales.zip : kirnberger.scl ("Kirnberger III,
 * letter to Forkel 1779"), meansixth.scl (1/6-comma meantone), kellner.scl
 * ("Kellner's Bach tuning") and neidhardt1.scl ("Neidhardt I temperament (1724)").
 */
export const SCALA_TEMPERAMENTS: Record<'kirnberger3' | 'meantone6' | 'kellner' | 'neidhardt1', number[]> = {
  kirnberger3: [0, 90.22, 193.16, 294.13, 386.31, 498.04, 590.22, 696.58, 792.18, 889.74, 996.09, 1088.27],
  meantone6: [0, 88.59, 196.74, 304.89, 393.48, 501.63, 590.22, 698.37, 786.96, 895.11, 1003.26, 1091.85],
  kellner: [0, 90.22, 194.53, 294.13, 389.05, 498.04, 588.27, 697.26, 792.18, 891.79, 996.09, 1091.01],
  neidhardt1: [0, 94.14, 196.09, 296.09, 392.18, 498.04, 592.18, 698.04, 796.09, 894.13, 996.09, 1092.18],
};

const TEMPERAMENT_CENTS: Record<Temperament, number[]> = {
  ...SCALA_TEMPERAMENTS,
  custom: Array.from({ length: 12 }, (_, i) => i * 100),
  equal: Array.from({ length: 12 }, (_, i) => i * 100),
  just: JUST_RATIOS.map(ratioToCents),
  pythagorean: PYTHAGOREAN_RATIOS.map(ratioToCents),
  meantone: meantoneCents(),
  werckmeister3: circleOfFifthsCents(WELL_TEMPERING.werckmeister3),
  vallotti: circleOfFifthsCents(WELL_TEMPERING.vallotti),
  young2: circleOfFifthsCents(WELL_TEMPERING.young2),
};

/** Options that change a temperament's shape. */
export interface TemperamentOptions {
  /** Just intonation ratio choices by degree, such as { 10: '7/4' }. */
  justRatios?: Record<number, string>;
  /** Flats in the meantone chain (0 to 11). */
  meantoneFlats?: number;
  /** Cents above the tonic of the 12 notes of an imported scale, for temperament 'custom'. */
  customCents?: number[];
}

/** Deviation in cents from equal temperament of the pitch class `interval` semitones above the tonic. */
export function temperamentOffset(temperament: Temperament, interval: number, opts: TemperamentOptions = {}): number {
  const i = mod(interval, 12);
  if (temperament === 'custom') return opts.customCents?.length === 12 ? opts.customCents[i] - i * 100 : 0;
  if (temperament === 'just' && opts.justRatios && Object.keys(opts.justRatios).length) return justCents(opts.justRatios)[i] - i * 100;
  if (temperament === 'meantone' && opts.meantoneFlats !== undefined && opts.meantoneFlats !== DEFAULT_MEANTONE_FLATS) return meantoneCents(opts.meantoneFlats)[i] - i * 100;
  return TEMPERAMENT_CENTS[temperament][i] - i * 100;
}

/** Well temperaments are defined from C; the others are built on the key's tonic. */
export function isWellTemperament(t: Temperament): boolean {
  return t === 'werckmeister3' || t === 'vallotti' || t === 'young2' || t === 'kirnberger3' || t === 'kellner' || t === 'neidhardt1';
}

export interface TuningSystem extends TemperamentOptions {
  a4: number;
  temperament: Temperament;
  /** Pitch class of the tonic (0 = C). Only matters for non-equal temperaments. */
  tonic: number;
  /** What stays at the reference: A4 (default), or the tonic stays equal tempered. */
  anchor?: 'a4' | 'tonic';
}

export const DEFAULT_TUNING: TuningSystem = { a4: 440, temperament: 'equal', tonic: 0 };

export function midiToEqualFrequency(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Cents between a note's tempered target and its equal-tempered pitch. By default
 * A4 stays exactly at the reference, so an ensemble tuned to that A agrees with
 * it; with anchor 'tonic' the tonic is equal tempered instead.
 */
export function targetOffset(midi: number, tuning: TuningSystem = DEFAULT_TUNING): number {
  if (tuning.temperament === 'equal') return 0;
  const offset = temperamentOffset(tuning.temperament, midi - tuning.tonic, tuning);
  return tuning.anchor === 'tonic' ? offset : offset - temperamentOffset(tuning.temperament, 9 - tuning.tonic, tuning);
}

/** Tempered target frequency for a MIDI note. */
export function midiToFrequency(midi: number, tuning: TuningSystem = DEFAULT_TUNING): number {
  return midiToEqualFrequency(midi, tuning.a4) * Math.pow(2, targetOffset(midi, tuning) / 1200);
}

/** Cents a reading sits from the equal-tempered note, given its cents from the tempered target. Null in equal temperament. */
export function vsEqualCents(cents: number, midi: number, tuning: TuningSystem): number | null {
  if (tuning.temperament === 'equal') return null;
  return cents + targetOffset(midi, tuning);
}

/**
 * Whole-cent offset of each written pitch class from equal temperament, for the
 * ring labels: '' for notes within half a cent, and an empty list in equal temperament.
 */
export function pitchClassOffsets(tuning: TuningSystem, semitones: number): string[] {
  if (tuning.temperament === 'equal') return [];
  return Array.from({ length: 12 }, (_, written) => {
    const c = Math.round(targetOffset(60 + writtenToConcertPc(written, semitones), tuning));
    return c === 0 ? '' : `${c > 0 ? '+' : '−'}${Math.abs(c)}`;
  });
}

/** Cents of a reference pitch from A4 = 440 Hz. */
export function a4Cents(a4: number): number {
  return ratioToCents(a4 / 440);
}

/** Reference pitch range the app accepts, in Hz, stored to a tenth. */
export const A4_MIN = 350;
export const A4_MAX = 500;

export function clampA4(v: unknown, fallback = 440): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(A4_MAX, Math.max(A4_MIN, n)) * 10) / 10;
}

/** Tonic stored as concert pitch class, from a key picked in written pitch for a transposing instrument. */
export function writtenToConcertPc(writtenPc: number, semitones: number): number {
  return mod(writtenPc - semitones, 12);
}

export function concertToWrittenPc(concertPc: number, semitones: number): number {
  return mod(concertPc + semitones, 12);
}

/** Tonic that follows the lowest sounding drone, when there is one. */
export function tonicFromDrones(stored: number, droneMidis: readonly number[]): number {
  return droneMidis.length ? mod(Math.min(...droneMidis), 12) : stored;
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
  return readingForNote(frequency, best, tuning);
}

/** Reading of a frequency against a given note, however far away it is. */
export function readingForNote(frequency: number, midi: number, tuning: TuningSystem = DEFAULT_TUNING): NoteReading {
  const target = midiToFrequency(midi, tuning);
  return {
    midi,
    pitchClass: mod(midi, 12),
    octave: Math.floor(midi / 12) - 1,
    cents: ratioToCents(frequency / target),
    target,
    frequency,
  };
}

export type Notation = 'english' | 'solfege' | 'italian' | 'movable' | 'german';

export const NOTATIONS: { id: Notation; label: string }[] = [
  { id: 'english', label: 'C D E' },
  { id: 'solfege', label: 'Do Ré Mi' },
  { id: 'italian', label: 'Do Re Mi' },
  { id: 'movable', label: 'Movable do' },
  { id: 'german', label: 'C D H' },
];

const SOLFEGE_SHARP = ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const SOLFEGE_FLAT = ['Do', 'Réb', 'Ré', 'Mib', 'Mi', 'Fa', 'Solb', 'Sol', 'Lab', 'La', 'Sib', 'Si'];
// Italian: do re mi fa sol la si, https://it.wikipedia.org/wiki/Nota_musicale ; diesis and bemolle shown as the signs.
const ITALIAN_SHARP = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const ITALIAN_FLAT = ['Do', 'Reb', 'Re', 'Mib', 'Mi', 'Fa', 'Solb', 'Sol', 'Lab', 'La', 'Sib', 'Si'];
// German: -is raises, -es lowers, B natural is H and B flat is B, Es and As contracted.
// https://de.wikipedia.org/wiki/Stammton
const GERMAN_SHARP = ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'Ais', 'H'];
const GERMAN_FLAT = ['C', 'Des', 'D', 'Es', 'E', 'F', 'Ges', 'G', 'As', 'A', 'B', 'H'];
// Chromatic movable do relative to the key note: https://en.wikipedia.org/wiki/Solf%C3%A8ge
const MOVABLE_SHARP = ['Do', 'Di', 'Re', 'Ri', 'Mi', 'Fa', 'Fi', 'Sol', 'Si', 'La', 'Li', 'Ti'];
const MOVABLE_FLAT = ['Do', 'Ra', 'Re', 'Me', 'Mi', 'Fa', 'Se', 'Sol', 'Le', 'La', 'Te', 'Ti'];

export type OctaveStyle = 'scientific' | 'helmholtz';

let currentNotation: Notation = 'english';
let currentKey = 0;
let currentOctaves: OctaveStyle = 'scientific';

/** App-wide note naming, set from settings: the system, the written key note for movable do, and the octave style. */
export function setNotation(n: Notation, key = currentKey, octaves: OctaveStyle = currentOctaves): void {
  currentNotation = n;
  currentKey = mod(key, 12);
  currentOctaves = octaves;
}

/**
 * Helmholtz octave marks, from https://en.wikipedia.org/wiki/Helmholtz_pitch_notation :
 * c′ is C4, c is C3, C is C2, C͵ is C1. Lower case from octave 3 up, one prime per octave above 3.
 */
export function helmholtz(name: string, octave: number): string {
  if (octave >= 3) return name.charAt(0).toLowerCase() + name.slice(1) + '′'.repeat(octave - 3);
  return name + '͵'.repeat(Math.max(0, 2 - octave));
}

function lettersInUse(notation: Notation): boolean {
  return notation === 'english' || notation === 'german';
}

export function noteName(midi: number, flats = false, withOctave = true, notation: Notation = currentNotation, key = currentKey): string {
  const pc = mod(midi, 12);
  let name: string;
  if (notation === 'movable') name = (flats ? MOVABLE_FLAT : MOVABLE_SHARP)[mod(pc - key, 12)];
  else {
    const table =
      notation === 'solfege' ? (flats ? SOLFEGE_FLAT : SOLFEGE_SHARP)
      : notation === 'italian' ? (flats ? ITALIAN_FLAT : ITALIAN_SHARP)
      : notation === 'german' ? (flats ? GERMAN_FLAT : GERMAN_SHARP)
      : flats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
    name = table[pc];
  }
  if (!withOctave) return name;
  const octave = Math.floor(midi / 12) - 1;
  if (currentOctaves === 'helmholtz' && lettersInUse(notation)) return helmholtz(name, octave);
  return `${name}${octave}`;
}

/** Octave shown after a name written without one: "4", or Helmholtz marks when that style is on. */
export function octaveText(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  if (currentOctaves !== 'helmholtz' || !lettersInUse(currentNotation)) return String(octave);
  return octave >= 3 ? '′'.repeat(octave - 3) : '͵'.repeat(Math.max(0, 2 - octave));
}

/** Name with the octave, as `noteName` gives it, from a name already made without one. */
export function withOctave(name: string, midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  if (currentOctaves === 'helmholtz' && lettersInUse(currentNotation)) return helmholtz(name, octave);
  return `${name}${octave}`;
}

/**
 * Major keys written with flats: F, B♭, E♭, A♭, D♭, G♭ (C♭ shares a pitch class with B and is spelled with sharps here).
 * https://en.wikipedia.org/wiki/Key_signature
 */
export const FLAT_KEYS = [5, 10, 3, 8, 1, 6];

export type Spelling = 'sharps' | 'flats' | 'key';

/** Whether to spell with flats, given the spelling choice and the written key note. */
export function spellWithFlats(spelling: Spelling, writtenKey: number): boolean {
  return spelling === 'flats' || (spelling === 'key' && FLAT_KEYS.includes(mod(writtenKey, 12)));
}

/** Pretty accidentals for display: C# -> C♯, Bb -> B♭ (never touches the German note B). */
export function prettyName(name: string): string {
  // Capture group instead of a lookbehind, which older Safari cannot parse.
  return name.replace('#', '♯').replace(/(\p{L})b(-?\d|$)/u, '$1♭$2');
}

/** Written note for a transposing instrument. */
export function transpose(midi: number, semitones: number): number {
  return midi + semitones;
}
