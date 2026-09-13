export interface TendencyTip {
  /** Written MIDI notes the tip is about; empty when the source names no specific notes. */
  notes: number[];
  /** Which way these notes tend to sit, when the source says. */
  direction: 'sharp' | 'flat' | null;
  text: string;
  source: string;
}

export interface TendencyReference {
  id: string;
  label: string;
  tips: TendencyTip[];
}

/**
 * Known tuning tendencies, in written pitch, only as the cited teachers state them.
 * Flute is left out: no source was verified.
 */
export const TENDENCY_REFERENCE: TendencyReference[] = [
  {
    id: 'trumpet',
    label: 'Trumpet',
    tips: [
      {
        // Dr. Jim Buckner: slide "extended about one-half inch ... for the valve combination 1-3" and "about one inch for ... 1-2-3".
        // http://www.hsutrumpets.com/tuning-and-valve-slides/
        notes: [62, 55],
        direction: 'sharp',
        text: 'Low D and G (valves 1 and 3): extend the third slide about half an inch.',
        source: 'http://www.hsutrumpets.com/tuning-and-valve-slides/',
      },
      {
        notes: [61, 54],
        direction: 'sharp',
        text: 'Low C♯ and F♯ (valves 1, 2 and 3): extend the third slide about an inch.',
        source: 'http://www.hsutrumpets.com/tuning-and-valve-slides/',
      },
    ],
  },
  {
    id: 'clarinet',
    label: 'Clarinet',
    tips: [
      {
        // Mitchell Estrin: "Throat tones are also generally sharp in pitch."
        notes: [],
        direction: 'sharp',
        text: 'Throat tones are generally sharp.',
        source: 'https://www.dansr.com/resources/resonance-fingerings-for-clarinet',
      },
    ],
  },
  {
    id: 'saxophone',
    label: 'Saxophone',
    tips: [
      // Dr. Shelley Jagow: flat "Third-space C♯"; sharp "Fourth-line D, D♯/E♭, E" and "Palm keys D, D♯/E♭, E, F".
      {
        notes: [73],
        direction: 'flat',
        text: 'Third-space C♯ tends to be flat.',
        source: 'https://www.dansr.com/resources/saxophone-intonation-tendencies-voicing-embouchure-and-alternate-fingerings',
      },
      {
        notes: [74, 75, 76],
        direction: 'sharp',
        text: 'Fourth-line D, D♯ and E tend to be sharp.',
        source: 'https://www.dansr.com/resources/saxophone-intonation-tendencies-voicing-embouchure-and-alternate-fingerings',
      },
      {
        notes: [86, 87, 88, 89],
        direction: 'sharp',
        text: 'Palm key D, D♯, E and F tend to be sharp.',
        source: 'https://www.dansr.com/resources/saxophone-intonation-tendencies-voicing-embouchure-and-alternate-fingerings',
      },
    ],
  },
];

/** The tip for a written note on an instrument, if the reference has one. */
export function tipFor(instrumentId: string, writtenMidi: number): TendencyTip | null {
  const ref = TENDENCY_REFERENCE.find((r) => r.id === instrumentId);
  return ref?.tips.find((t) => t.notes.includes(writtenMidi)) ?? null;
}

/** Notes to play in order for a guided check: every note with a tip, low to high. */
export function guidedNotes(instrumentId: string): number[] {
  const ref = TENDENCY_REFERENCE.find((r) => r.id === instrumentId);
  return ref ? [...new Set(ref.tips.flatMap((t) => t.notes))].sort((a, b) => a - b) : [];
}
