import { midiToEqualFrequency, mod, ratioToCents } from './notes';

/* ---------- Scala .scl files (01-81) ---------- */

export interface ScalaScale {
  description: string;
  /** Cents of each listed degree above 1/1, in file order. The last one is the period (usually 1200). */
  cents: number[];
}

/**
 * Parses a Scala .scl file. Format from the Huygens-Fokker Foundation,
 * https://www.huygens-fokker.org/scala/scl_format.html : lines starting with "!"
 * are comments, the first other line is the description (may be empty), the
 * second the number of notes, then one pitch per line. A value containing a
 * period is cents, otherwise a ratio ("2" means 2/1). 1/1 is implied, not listed.
 */
export function parseScala(text: string): ScalaScale | string {
  const lines = text.split(/\r?\n/).filter((l) => !l.startsWith('!'));
  if (lines.length < 2) return 'Not a Scala file.';
  const description = lines[0].trim();
  const count = Number(lines[1].trim().split(/\s+/)[0]);
  if (!Number.isInteger(count) || count < 1 || count > 1000) return 'Could not read the number of notes.';
  const cents: number[] = [];
  for (const raw of lines.slice(2)) {
    const token = raw.trim().split(/\s+/)[0];
    if (!token) continue;
    let c: number;
    if (token.includes('.')) c = Number(token);
    else {
      const [n, d = '1'] = token.split('/');
      const num = Number(n);
      const den = Number(d);
      if (!(num > 0) || !(den > 0)) return `Could not read pitch "${token}".`;
      c = ratioToCents(num / den);
    }
    if (!Number.isFinite(c)) return `Could not read pitch "${token}".`;
    cents.push(c);
    if (cents.length === count) break;
  }
  if (cents.length !== count) return `Expected ${count} notes, found ${cents.length}.`;
  return { description, cents };
}

/** Cents above the tonic for the 12 pitch classes, for a scale of 12 notes repeating at the octave; null otherwise. */
export function scalaToTwelve(scale: ScalaScale): number[] | null {
  if (scale.cents.length !== 12 || Math.abs(scale.cents[11] - 1200) > 0.5) return null;
  const out = [0, ...scale.cents.slice(0, 11)];
  for (let i = 1; i < 12; i++) if (!(out[i] > out[i - 1])) return null;
  return out;
}

/* ---------- Equal divisions of the octave (01-82, 01-83) ---------- */

export const EDOS = [12, 19, 24, 31] as const;

// Unicode names verified at https://www.unicode.org/charts/nameslist/n_1D100.html :
// U+1D132 MUSICAL SYMBOL QUARTER TONE SHARP, U+1D133 MUSICAL SYMBOL QUARTER TONE FLAT.
export const HALF_SHARP = '\u{1D132}';
export const HALF_FLAT = '\u{1D133}';

const NATURALS: [string, number][] = [
  ['F', -1],
  ['C', 0],
  ['G', 1],
  ['D', 2],
  ['A', 3],
  ['E', 4],
  ['B', 5],
];

/** Steps of the fifth nearest 3/2 in an equal division. */
export function edoFifth(n: number): number {
  return Math.round(n * Math.log2(1.5));
}

/**
 * Names for each step of an equal division, C = step 0, spelled from the chain of
 * fifths: a sharp raises by 7 fifths less 4 octaves. Where a sharp is two steps
 * (24 and 31) the step between is a half sharp or half flat.
 */
export function edoNames(n: number): string[] {
  const fifth = edoFifth(n);
  const sharp = 7 * fifth - 4 * n;
  const naturals = NATURALS.map(([name, k]) => [name, mod(k * fifth, n)] as [string, number]);
  const names: string[] = new Array(n).fill('');
  const place = (name: string, step: number) => {
    const s = mod(step, n);
    if (!names[s]) names[s] = name;
  };
  // Order of preference: natural, sharp, flat, half sharp, half flat.
  naturals.forEach(([nm, s]) => place(nm, s));
  if (sharp > 0) {
    naturals.forEach(([nm, s]) => place(`${nm}♯`, s + sharp));
    naturals.forEach(([nm, s]) => place(`${nm}♭`, s - sharp));
    if (sharp % 2 === 0) {
      naturals.forEach(([nm, s]) => place(`${nm}${HALF_SHARP}`, s + sharp / 2));
      naturals.forEach(([nm, s]) => place(`${nm}${HALF_FLAT}`, s - sharp / 2));
    }
  }
  return names.map((nm, i) => nm || `${i}`);
}

export interface StepReading {
  /** Steps from C0 counted in this division. */
  absolute: number;
  step: number;
  octave: number;
  cents: number;
  target: number;
}

/** Nearest step of an n-note equal division, with A4 at the reference and C on the step nearest 900 cents below A. */
export function edoReading(frequency: number, a4: number, n: number): StepReading {
  const aStep = Math.round((n * 9) / 12);
  const fromA = Math.round(n * Math.log2(frequency / a4));
  const absolute = fromA + aStep + 4 * n;
  const target = a4 * Math.pow(2, fromA / n);
  return { absolute, step: mod(absolute, n), octave: Math.floor(absolute / n), cents: ratioToCents(frequency / target), target };
}

/* ---------- Hindustani svaras and shrutis (01-84) ---------- */

/**
 * The 22 shrutis as frequency ratios above Sa, from D. S. Thakur, "The Notion of
 * Twenty-Two Shrutis", Resonance 20(6), 2015, table of frequency ratios:
 * https://www.ias.ac.in/public/Volumes/reso/020/06/0515-0531.pdf
 * `name` is the plain svara for the ratios of the shuddha (Bilawal) scale in the
 * same paper (1, 9/8, 5/4, 4/3, 3/2, 27/16, 15/8); others carry the paper's label.
 */
export const SHRUTIS: { label: string; ratio: [number, number]; name?: string }[] = [
  { label: 'S', ratio: [1, 1], name: 'Sa' },
  { label: 'R11', ratio: [256, 243] },
  { label: 'R12', ratio: [16, 15] },
  { label: 'R21', ratio: [10, 9] },
  { label: 'R22', ratio: [9, 8], name: 'Re' },
  { label: 'G11', ratio: [32, 27] },
  { label: 'G12', ratio: [6, 5] },
  { label: 'G21', ratio: [5, 4], name: 'Ga' },
  { label: 'G22', ratio: [81, 64] },
  { label: 'M11', ratio: [4, 3], name: 'Ma' },
  { label: 'M12', ratio: [27, 20] },
  { label: 'M21', ratio: [45, 32] },
  { label: 'M22', ratio: [729, 512] },
  { label: 'P', ratio: [3, 2], name: 'Pa' },
  { label: 'D11', ratio: [128, 81] },
  { label: 'D12', ratio: [8, 5] },
  { label: 'D21', ratio: [5, 3] },
  { label: 'D22', ratio: [27, 16], name: 'Dha' },
  { label: 'N11', ratio: [16, 9] },
  { label: 'N12', ratio: [9, 5] },
  { label: 'N21', ratio: [15, 8], name: 'Ni' },
  { label: 'N22', ratio: [243, 128] },
];

/** Short name shown for a shruti: the svara name, or the label with its ratio. */
export function shrutiName(i: number): string {
  const s = SHRUTIS[i];
  return s.name ?? s.label;
}

export interface SvaraReading {
  index: number;
  /** Octaves from the Sa that was set: 0 is the middle octave. */
  octave: number;
  cents: number;
  target: number;
}

/** Nearest of the 22 shrutis to a frequency, with Sa given in hertz. */
export function svaraReading(frequency: number, saHz: number): SvaraReading {
  const above = ratioToCents(frequency / saHz);
  let best = { index: 0, octave: 0, cents: Infinity, target: saHz };
  const base = Math.floor(above / 1200);
  for (let o = base - 1; o <= base + 1; o++) {
    for (let i = 0; i < SHRUTIS.length; i++) {
      const [n, d] = SHRUTIS[i].ratio;
      const target = saHz * (n / d) * Math.pow(2, o);
      const c = ratioToCents(frequency / target);
      if (Math.abs(c) < Math.abs(best.cents)) best = { index: i, octave: o, cents: c, target };
    }
  }
  return best;
}

/* ---------- A captured scale (01-85) ---------- */

export interface CapturedNote {
  hz: number;
  label: string;
}

export interface ScaleReading {
  index: number;
  /** Octaves above or below the captured note. */
  octave: number;
  cents: number;
  target: number;
}

/** Nearest captured note, allowing it in other octaves, or null for an empty scale. */
export function nearestCaptured(frequency: number, notes: readonly CapturedNote[]): ScaleReading | null {
  let best: ScaleReading | null = null;
  notes.forEach((n, index) => {
    const octave = Math.round(Math.log2(frequency / n.hz));
    for (const o of [octave - 1, octave, octave + 1]) {
      const target = n.hz * Math.pow(2, o);
      const cents = ratioToCents(frequency / target);
      if (!best || Math.abs(cents) < Math.abs(best.cents)) best = { index, octave: o, cents, target };
    }
  });
  return best;
}

/* ---------- Note lock (01-90) ---------- */

/** Whole semitones and remaining cents from a locked target, such as "−3 st +12¢". */
export function lockOffset(frequency: number, target: number): { semitones: number; cents: number; text: string } {
  const total = ratioToCents(frequency / target);
  const semitones = Math.round(total / 100);
  const cents = total - semitones * 100;
  const sign = (v: number) => (v < 0 ? '−' : '+');
  const text = semitones === 0 ? `${sign(cents)}${Math.abs(Math.round(cents))}¢` : `${sign(semitones)}${Math.abs(semitones)} st ${sign(cents)}${Math.abs(Math.round(cents))}¢`;
  return { semitones, cents, text };
}

/** Equal-tempered MIDI note nearest a frequency. */
export function nearestMidi(frequency: number, a4: number): number {
  return Math.round(69 + 12 * Math.log2(frequency / a4));
}

/** Frequency of a pitch class tapped on the ring, in the octave nearest a reference frequency. */
export function pitchClassNear(pc: number, near: number | null, a4: number, tuningFreq: (midi: number) => number = (m) => midiToEqualFrequency(m, a4)): number {
  const around = near ? nearestMidi(near, a4) : 69;
  return tuningFreq(pitchClassMidiNear(pc, around));
}

/** MIDI note of a pitch class nearest another MIDI note. */
export function pitchClassMidiNear(pc: number, around: number): number {
  const d = mod(pc - around + 6, 12) - 6;
  return around + d;
}

/* ---------- Bell partials (01-92) ---------- */

/**
 * Partials of a true-harmonic bell in cents from the nominal, from Bill Hibbert,
 * https://www.hibberts.co.uk/basic-principles-of-bell-tuning/
 */
export const BELL_PARTIALS: { name: string; cents: number }[] = [
  { name: 'hum', cents: -2400 },
  { name: 'prime', cents: -1200 },
  { name: 'tierce', cents: -900 },
  { name: 'quint', cents: -500 },
  { name: 'nominal', cents: 0 },
];

/** Name and error of the bell partial a peak most likely is, measured from a chosen nominal, or null when none is within 100 cents. */
export function bellPartial(hz: number, nominalHz: number): { name: string; error: number } | null {
  const c = ratioToCents(hz / nominalHz);
  let best: { name: string; error: number } | null = null;
  for (const p of BELL_PARTIALS) {
    const e = c - p.cents;
    if (Math.abs(e) <= 100 && (!best || Math.abs(e) < Math.abs(best.error))) best = { name: p.name, error: e };
  }
  return best;
}
