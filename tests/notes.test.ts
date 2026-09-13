import { describe, expect, it } from 'vitest';
import {
  frequencyToNote,
  midiToFrequency,
  noteName,
  ratioToCents,
  temperamentOffset,
  transpose,
} from '../src/core/notes';

describe('equal temperament', () => {
  it('maps A4 and middle C', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 10);
    // 440 * 2^(-9/12)
    expect(midiToFrequency(60)).toBeCloseTo(440 * Math.pow(2, -9 / 12), 10);
  });

  it('honours the A4 reference', () => {
    expect(midiToFrequency(69, { a4: 442, temperament: 'equal', tonic: 0 })).toBeCloseTo(442, 10);
  });

  it('reads note and cents from frequency', () => {
    const r = frequencyToNote(440 * Math.pow(2, 10 / 1200));
    expect(noteName(r.midi)).toBe('A4');
    expect(r.cents).toBeCloseTo(10, 6);
    const low = frequencyToNote(440 * Math.pow(2, -30 / 1200));
    expect(noteName(low.midi)).toBe('A4');
    expect(low.cents).toBeCloseTo(-30, 6);
  });

  it('rounds to the nearer note at +60 cents', () => {
    const r = frequencyToNote(440 * Math.pow(2, 60 / 1200));
    expect(noteName(r.midi)).toBe('A#4');
    expect(r.cents).toBeCloseTo(-40, 6);
  });
});

describe('temperaments', () => {
  it('just major third is 5/4 above the tonic', () => {
    // 1200*log2(5/4) - 400
    expect(temperamentOffset('just', 4)).toBeCloseTo(ratioToCents(5 / 4) - 400, 10);
    expect(temperamentOffset('just', 4)).toBeCloseTo(-13.686, 2);
  });

  it('pythagorean fifth is 3/2', () => {
    expect(temperamentOffset('pythagorean', 7)).toBeCloseTo(ratioToCents(3 / 2) - 700, 10);
  });

  it('quarter-comma meantone major third is pure', () => {
    // Four meantone fifths (5^(1/4))^4 = 5, folded down two octaves = 5/4.
    expect(temperamentOffset('meantone', 4)).toBeCloseTo(ratioToCents(5 / 4) - 400, 8);
  });

  it('tonic is untouched in every temperament', () => {
    for (const t of ['equal', 'just', 'pythagorean', 'meantone'] as const) {
      expect(temperamentOffset(t, 0)).toBeCloseTo(0, 10);
    }
  });

  it('a pure E over a C tonic reads 0 cents in just intonation', () => {
    const tuning = { a4: 440, temperament: 'just' as const, tonic: 0 };
    const c4 = midiToFrequency(60, tuning);
    const r = frequencyToNote(c4 * 1.25, tuning);
    expect(noteName(r.midi)).toBe('E4');
    expect(r.cents).toBeCloseTo(0, 6);
  });
});

describe('names and transposition', () => {
  it('names with flats', () => {
    expect(noteName(70, true)).toBe('Bb4');
    expect(noteName(61, false, false)).toBe('C#');
  });

  it('Bb instrument reads concert Bb as written C', () => {
    expect(noteName(transpose(70, 2), false, false)).toBe('C');
  });

  it('Eb instrument reads concert C as written A', () => {
    expect(noteName(transpose(60, 9), false, false)).toBe('A');
  });
});
