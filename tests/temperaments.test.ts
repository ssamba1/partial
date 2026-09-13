import { describe, expect, it } from 'vitest';
import {
  circleOfFifthsCents,
  noteName,
  prettyName,
  PYTHAGOREAN_COMMA,
  ratioToCents,
  temperamentOffset,
  WELL_TEMPERING,
} from '../src/core/notes';

describe('well temperaments', () => {
  it('Pythagorean comma is about 23.46 cents', () => {
    expect(PYTHAGOREAN_COMMA).toBeCloseTo(23.46, 2);
  });

  it('each well temperament distributes exactly one Pythagorean comma, so the circle closes', () => {
    for (const [name, t] of Object.entries(WELL_TEMPERING)) {
      const total = t.reduce((a, b) => a + b, 0);
      expect(total, name).toBeCloseTo(PYTHAGOREAN_COMMA, 9);
    }
  });

  it('with no tempering the circle gives Pythagorean tuning', () => {
    const cents = circleOfFifthsCents(new Array(12).fill(0));
    expect(cents[7]).toBeCloseTo(ratioToCents(3 / 2), 9);
    expect(cents[2]).toBeCloseTo(ratioToCents(9 / 8), 9);
  });

  it('Werckmeister III: C-G is a quarter comma narrow, E-B is pure', () => {
    // G above C
    expect(temperamentOffset('werckmeister3', 7)).toBeCloseTo(ratioToCents(3 / 2) - PYTHAGOREAN_COMMA / 4 - 700, 9);
    const e = temperamentOffset('werckmeister3', 4) + 400;
    const b = temperamentOffset('werckmeister3', 11) + 1100;
    expect(b - e).toBeCloseTo(ratioToCents(3 / 2), 9);
  });

  it('Vallotti: F-C narrowed by 1/6 comma, B-F# pure', () => {
    const f = temperamentOffset('vallotti', 5) + 500;
    expect(1200 - f).toBeCloseTo(ratioToCents(3 / 2) - PYTHAGOREAN_COMMA / 6, 9);
    const b = temperamentOffset('vallotti', 11) + 1100;
    const fs = temperamentOffset('vallotti', 6) + 600 + 1200;
    expect(fs - b).toBeCloseTo(ratioToCents(3 / 2), 9);
  });

  it('Young II differs from Vallotti by starting its tempered fifths on C', () => {
    // In Young II the F-C fifth is pure, in Vallotti it is tempered.
    const fYoung = temperamentOffset('young2', 5) + 500;
    expect(1200 - fYoung).toBeCloseTo(ratioToCents(3 / 2), 9);
  });
});

describe('notation', () => {
  it('solfege and German names', () => {
    expect(noteName(60, false, true, 'solfege')).toBe('Do4');
    expect(noteName(71, false, false, 'german')).toBe('H');
    expect(noteName(70, true, false, 'german')).toBe('B');
    expect(noteName(70, true, false, 'english')).toBe('Bb');
  });

  it('prettyName uses real accidentals and leaves German B alone', () => {
    expect(prettyName('C#4')).toBe('C♯4');
    expect(prettyName('Bb')).toBe('B♭');
    expect(prettyName('Eb3')).toBe('E♭3');
    expect(prettyName('Sib')).toBe('Si♭');
    expect(prettyName('B')).toBe('B');
    expect(prettyName('B4')).toBe('B4');
  });
});
