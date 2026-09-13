import { describe, expect, it } from 'vitest';
import { readInterval } from '../src/core/intervals';
import { ratioToCents } from '../src/core/notes';

describe('readInterval', () => {
  it('a pure 5:4 major third reads about 13.7 cents flat of equal and 0 from just', () => {
    const r = readInterval(261.6256, 261.6256 * 1.25);
    expect(r.def.short).toBe('M3');
    expect(r.direction).toBe(1);
    expect(r.vsJust).toBeCloseTo(0, 6);
    expect(r.vsEqual).toBeCloseTo(ratioToCents(1.25) - 400, 6);
    expect(r.vsEqual).toBeCloseTo(-13.69, 2);
  });

  it('equal-tempered fifth downward is about 1.96 cents narrow of just', () => {
    const r = readInterval(440, 440 * Math.pow(2, -7 / 12));
    expect(r.def.short).toBe('P5');
    expect(r.direction).toBe(-1);
    expect(r.vsEqual).toBeCloseTo(0, 6);
    expect(r.vsJust).toBeCloseTo(700 - ratioToCents(1.5), 6);
  });

  it('compound intervals keep the octave count', () => {
    const r = readInterval(220, 220 * 2 * 1.5);
    expect(r.def.short).toBe('P5');
    expect(r.octaves).toBe(1);
    expect(r.vsJust).toBeCloseTo(0, 6);
  });

  it('unison', () => {
    const r = readInterval(440, 441);
    expect(r.def.short).toBe('P1');
    expect(r.direction).toBe(0);
  });
});
