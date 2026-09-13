import { describe, expect, it } from 'vitest';
import { STRING_INSTRUMENTS } from '../src/core/instruments';

describe('sourced instrument tunings (01-33)', () => {
  const byId = (id: string) => STRING_INSTRUMENTS.find((i) => i.id === id)!;
  it('has the added instruments with unique ids', () => {
    const ids = STRING_INSTRUMENTS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['guitar7', 'guitar8', 'guitar12', 'bass6', 'ukulele-lowg', 'mandola', 'oud', 'erhu', 'gamba-bass', 'doublebass-solo']) expect(byId(id)).toBeTruthy();
  });
  it('builds a 34-string lever harp from C2 to A6 on white keys', () => {
    const harp = byId('harp-lever34').strings;
    expect(harp).toHaveLength(34);
    expect(harp[0]).toBe(36);
    expect(harp[33]).toBe(93);
    expect(harp.every((m) => [0, 2, 4, 5, 7, 9, 11].includes(m % 12))).toBe(true);
  });
  it('tunes the solo bass a whole tone above orchestral', () => {
    expect(byId('doublebass-solo').strings).toEqual([30, 35, 40, 45]);
  });
});
