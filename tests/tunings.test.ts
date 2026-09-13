import { describe, expect, it } from 'vitest';
import { allInstruments, CUSTOM_TUNING_PREFIX, sanitizeTuning, STRING_INSTRUMENTS, stringFrequency, stringMidi } from '../src/core/instruments';
import { traceSummary } from '../src/core/intonation';
import { DEFAULT_TUNING, midiToFrequency, ratioToCents } from '../src/core/notes';
import { sonifyInterval } from '../src/core/selfsound';
import { mergeSettings } from '../src/store/settings';

const guitar = STRING_INSTRUMENTS.find((i) => i.id === 'guitar')!;

describe('custom tunings', () => {
  it('a capo raises every string by its fret', () => {
    const capo2 = { ...guitar, capo: 2 };
    for (let i = 0; i < guitar.strings.length; i++) {
      expect(stringMidi(capo2, i)).toBe(guitar.strings[i] + 2);
      expect(stringFrequency(capo2, i, DEFAULT_TUNING, false)).toBeCloseTo(midiToFrequency(guitar.strings[i] + 2), 9);
    }
  });

  it('per-string offsets move each target by that many cents', () => {
    const sweet = { ...guitar, centOffsets: [0, 0, 0, 0, -2, 1.5] };
    expect(ratioToCents(stringFrequency(sweet, 4, DEFAULT_TUNING, false) / stringFrequency(guitar, 4, DEFAULT_TUNING, false))).toBeCloseTo(-2, 9);
    expect(ratioToCents(stringFrequency(sweet, 5, DEFAULT_TUNING, false) / stringFrequency(guitar, 5, DEFAULT_TUNING, false))).toBeCloseTo(1.5, 9);
    expect(stringFrequency(sweet, 0, DEFAULT_TUNING, false)).toBeCloseTo(stringFrequency(guitar, 0, DEFAULT_TUNING, false), 9);
  });

  it('offsets add to pure fifths on bowed strings', () => {
    const violin = STRING_INSTRUMENTS.find((i) => i.id === 'violin')!;
    const pureG = stringFrequency(violin, 0, DEFAULT_TUNING, true);
    const shifted = stringFrequency({ ...violin, centOffsets: [3, 0, 0, 0] }, 0, DEFAULT_TUNING, true);
    expect(ratioToCents(shifted / pureG)).toBeCloseTo(3, 9);
  });

  it('sanitizes stored tunings', () => {
    expect(sanitizeTuning(null)).toBeNull();
    expect(sanitizeTuning({ id: 'x', strings: [] })).toBeNull();
    const t = sanitizeTuning({ id: 'x', label: '  Open D  ', strings: [38.2, 45, 200], centOffsets: [0, 99, Number.NaN], capo: 30 })!;
    expect(t).toEqual({ id: 'x', label: 'Open D', strings: [38, 45, 108], centOffsets: [0, 50, 0], capo: 12 });
    expect(sanitizeTuning({ id: 'y', label: '', strings: [40] })).toEqual({ id: 'y', label: 'My tuning', strings: [40] });
  });

  it('lists custom tunings after the built-in ones with a prefixed id', () => {
    const all = allInstruments([{ id: 'abc', label: 'Mine', strings: [40, 45] }]);
    expect(all.length).toBe(STRING_INSTRUMENTS.length + 1);
    expect(all[all.length - 1].id).toBe(`${CUSTOM_TUNING_PREFIX}abc`);
  });

  it('settings drop malformed custom tunings from a backup', () => {
    const s = mergeSettings({ customTunings: [{ id: 'a', label: 'A', strings: [40] }, { id: '', strings: [1] }, null] as never });
    expect(s.customTunings).toEqual([{ id: 'a', label: 'A', strings: [40] }]);
  });

  it('mandolin is not offered pure fifths, since its frets are equal tempered', () => {
    const mandolin = STRING_INSTRUMENTS.find((i) => i.id === 'mandolin')!;
    expect(mandolin.pureFifthsFrom).toBeUndefined();
    expect(stringFrequency(mandolin, 0, DEFAULT_TUNING, true)).toBeCloseTo(stringFrequency(mandolin, 0, DEFAULT_TUNING, false), 9);
  });
});

describe('trace summary', () => {
  const pts = (xs: (number | null)[]) => xs.map((cents) => ({ cents }));
  it('describes the last readings in words', () => {
    expect(traceSummary(pts([]), 5)).toBe('Last 10 s: no note');
    expect(traceSummary(pts([6, 7, 5, null, 6]), 2)).toBe('Last 10 s: mostly 6 cents sharp');
    expect(traceSummary(pts([-1, 1, 0, 2]), 5)).toBe('Last 10 s: mostly in tune');
    expect(traceSummary(pts([-1, -1, -1]), 0.5)).toBe('Last 10 s: mostly 1 cent flat');
  });
});

describe('sound cues', () => {
  it('silent in tune, faster ticks for bigger errors', () => {
    expect(sonifyInterval(null, 5)).toBeNull();
    expect(sonifyInterval(4, 5)).toBeNull();
    const near = sonifyInterval(8, 5)!;
    const far = sonifyInterval(-40, 5)!;
    expect(far).toBeLessThan(near);
    expect(sonifyInterval(50, 5)).toBeCloseTo(0.3, 9);
    expect(sonifyInterval(90, 5)).toBeCloseTo(0.3, 9);
  });
});
