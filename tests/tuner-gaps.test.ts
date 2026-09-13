import { describe, expect, it } from 'vitest';
import {
  addReading,
  addToBook,
  bookTendencies,
  LongToneWatcher,
  mergeTendencies,
  sanitizeBook,
  segmentNotes,
  StableNoteGate,
  summarize,
  TENDENCY_DAYS_KEPT,
  tendencyKey,
} from '../src/core/intonation';
import { clampTraceOffset, traceRuns } from '../src/core/display';
import {
  a4Cents,
  clampA4,
  concertToWrittenPc,
  DEFAULT_MEANTONE_FLATS,
  isWellTemperament,
  JUST_ALTERNATIVES,
  meantoneCents,
  midiToEqualFrequency,
  midiToFrequency,
  pitchClassOffsets,
  ratioToCents,
  sanitizeJustRatios,
  targetOffset,
  TEMPERAMENTS,
  temperamentOffset,
  tonicFromDrones,
  vsEqualCents,
  writtenToConcertPc,
} from '../src/core/notes';
import { nearestPartial, partialVsEqual } from '../src/core/partials';
import { VoicedClock } from '../src/core/practice';
import { micFailure, micHelpSteps } from '../src/core/mic';
import { clampAutoStop, mergeSettings, sanitizeTuningPreset, DEFAULT_SETTINGS } from '../src/store/settings';
import { A4_PRESETS } from '../src/ui/tuningSheet';

describe('long tones (01-51)', () => {
  it('reports a held note with its spread and drift when it ends', () => {
    const w = new LongToneWatcher(2, 0.25);
    let done = null;
    for (let i = 0; i <= 30; i++) done = w.push(i * 0.1, 69, i < 15 ? 0 : -4) ?? done;
    expect(done).toBeNull();
    done = w.push(3.1, 71, 0);
    expect(done?.midi).toBe(69);
    expect(done!.end - done!.start).toBeCloseTo(3, 5);
    expect(done!.drift).toBeLessThan(-3);
    expect(done!.spread).toBeGreaterThan(1.5);
  });

  it('ignores short notes and reports the note so far on flush', () => {
    const w = new LongToneWatcher(2, 0.25);
    for (let i = 0; i < 10; i++) w.push(i * 0.1, 60, 0);
    expect(w.push(1, 62, 0)).toBeNull();
    for (let i = 1; i <= 25; i++) w.push(1 + i * 0.1, 62, 1);
    expect(w.flush()?.midi).toBe(62);
  });

  it('segmentNotes spread is the standard deviation', () => {
    const [n] = segmentNotes([{ t: 0, midi: 60, cents: -2 }, { t: 0.1, midi: 60, cents: 2 }, { t: 0.2, midi: 60, cents: -2 }, { t: 0.3, midi: 60, cents: 2 }], 0.25);
    expect(n.spread).toBeCloseTo(2, 6);
  });
});

describe('trace (01-52)', () => {
  it('splits runs at note changes and silence, keeping the point before the window', () => {
    const pts = [
      { t: 0, cents: 1, midi: 69 },
      { t: 1, cents: 2, midi: 69 },
      { t: 2, cents: null, midi: null },
      { t: 3, cents: 3, midi: 71 },
      { t: 4, cents: 4, midi: 72 },
    ];
    const runs = traceRuns(pts, 4, 3.5);
    expect(traceRuns(pts, 4, 1.5).map((r) => r.midi)).toEqual([71, 72]);
    expect(runs.map((r) => r.midi)).toEqual([69, 71, 72]);
    expect(runs[0].points).toEqual([{ t: 0, cents: 1 }, { t: 1, cents: 2 }]);
  });

  it('clamps scroll offset to the buffer', () => {
    expect(clampTraceOffset(-3, 60, 0, 10)).toBe(0);
    expect(clampTraceOffset(100, 60, 0, 10)).toBe(50);
    expect(clampTraceOffset(NaN, 60, 0, 10)).toBe(0);
    expect(clampTraceOffset(5, 8, 0, 10)).toBe(0);
  });
});

describe('tendencies (01-53, 01-54, 01-55, 01-57)', () => {
  it('weights readings by seconds', () => {
    let t = addReading({}, 9, 10, 3);
    t = addReading(t, 9, -10, 1);
    const [s] = summarize(t);
    expect(s.count).toBe(4);
    expect(s.mean).toBeCloseTo(5, 6);
  });

  it('keys by tuning and ignores the tonic in equal temperament', () => {
    expect(tendencyKey({ a4: 440, temperament: 'equal', tonic: 5 })).toBe(tendencyKey({ a4: 440, temperament: 'equal', tonic: 0 }));
    expect(tendencyKey({ a4: 415, temperament: 'vallotti', tonic: 0 })).not.toBe(tendencyKey({ a4: 440, temperament: 'vallotti', tonic: 0 }));
  });

  it('sums recent days and all time separately, and prunes old day buckets', () => {
    let book = sanitizeBook(null);
    book = addToBook(book, 'k', '2026-01-01', addReading({}, 0, 10, 5));
    book = addToBook(book, 'k', '2026-03-01', addReading({}, 0, -10, 5));
    expect(bookTendencies(book, 'k', 7, new Date(2026, 2, 3))[0].sum).toBeCloseTo(-50);
    expect(bookTendencies(book, 'k', 'all', new Date(2026, 2, 3))[0].sum).toBeCloseTo(0);
    expect(bookTendencies(book, 'other', 'all', new Date())).toEqual({});
    for (let i = 0; i < TENDENCY_DAYS_KEPT + 5; i++) book = addToBook(book, 'k', `2027-01-${String(i % 28 + 1).padStart(2, '0')}x${i}`.slice(0, 10), { 1: { count: 1, sum: 0, sumSq: 0 } });
    expect(Object.keys(book.tunings.k.days).length).toBeLessThanOrEqual(TENDENCY_DAYS_KEPT);
  });

  it('sanitizes a stored book', () => {
    const book = sanitizeBook({ legacy: { 3: { count: 2, sum: 1, sumSq: 1 }, 14: { count: 1, sum: 0, sumSq: 0 } }, tunings: { k: { all: { 0: { count: 'x' } }, days: { bad: {}, '2026-01-01': {} } } } });
    expect(Object.keys(book.legacy)).toEqual(['3']);
    expect(book.tunings.k.all).toEqual({});
    expect(Object.keys(book.tunings.k.days)).toEqual(['2026-01-01']);
  });

  it('merges tendencies', () => {
    const m = mergeTendencies({ 0: { count: 1, sum: 2, sumSq: 4 } }, { 0: { count: 1, sum: 2, sumSq: 4 }, 1: { count: 1, sum: 0, sumSq: 0 } });
    expect(m[0].count).toBe(2);
    expect(m[1].count).toBe(1);
  });

  it('only credits a note once it has been steady for 300 ms', () => {
    const g = new StableNoteGate(0.3, 0.1);
    let total = 0;
    for (let i = 0; i <= 10; i++) total += g.update(69, i * 0.05);
    // Frames from 0.3 s to 0.5 s count, 0.05 s each: five frames.
    expect(total).toBeCloseTo(0.25, 6);
    expect(g.update(70, 0.55)).toBe(0);
    expect(g.update(null, 0.6)).toBe(0);
    expect(g.update(70, 0.65)).toBe(0);
  });
});

describe('practice time and auto stop (01-68)', () => {
  it('counts only voiced time and measures silence', () => {
    const c = new VoicedClock(0.25);
    c.start(0);
    c.frame(0.1, true);
    c.frame(0.2, true);
    c.frame(10, false);
    c.frame(10.1, true);
    expect(c.seconds).toBeCloseTo(0.3, 6);
    expect(c.silentFor(40.1)).toBeCloseTo(30, 6);
  });

  it('clamps the auto-stop minutes', () => {
    expect(clampAutoStop(-1)).toBe(0);
    expect(clampAutoStop(99)).toBe(60);
    expect(clampAutoStop('x')).toBe(DEFAULT_SETTINGS.tunerAutoStopMinutes);
  });
});

describe('mic errors (01-66)', () => {
  it('maps error names to reasons', () => {
    expect(micFailure('NotAllowedError').reason).toBe('denied');
    expect(micFailure('NotReadableError').reason).toBe('busy');
    expect(micFailure('NotFoundError').reason).toBe('notfound');
    expect(micFailure('OverconstrainedError').reason).toBe('constraints');
    expect(micFailure(undefined).reason).toBe('unavailable');
  });

  it('gives Chrome desktop specific steps and others general ones', () => {
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
    expect(micHelpSteps(chrome).join(' ')).toContain('Site settings');
    expect(micHelpSteps(`${chrome} Edg/130.0`).join(' ')).not.toContain('Chrome menu');
  });
});

describe('reference pitch (01-70, 01-71)', () => {
  it('accepts 350 to 500 Hz in tenths', () => {
    expect(clampA4(300)).toBe(350);
    expect(clampA4(510)).toBe(500);
    expect(clampA4(441.26)).toBe(441.3);
    expect(clampA4('x', 442)).toBe(442);
    expect(mergeSettings({ a4: 392 } as never).a4).toBe(392);
  });

  it('every preset chip is in range', () => {
    for (const g of A4_PRESETS) for (const v of g.values) expect(clampA4(v)).toBe(v);
  });

  it('shows the cents from 440', () => {
    expect(a4Cents(441)).toBeCloseTo(3.93, 2);
    expect(a4Cents(415)).toBeCloseTo(-101.3, 1);
  });
});

describe('temperament anchor (01-72)', () => {
  it('keeps A4 at the reference for every temperament and tonic', () => {
    for (const t of TEMPERAMENTS) {
      for (let tonic = 0; tonic < 12; tonic++) {
        expect(midiToFrequency(69, { a4: 440, temperament: t.id, tonic })).toBeCloseTo(440, 9);
        expect(midiToFrequency(81, { a4: 415, temperament: t.id, tonic })).toBeCloseTo(830, 9);
      }
    }
  });

  it('keeps the tonic equal tempered with the tonic anchor', () => {
    const f = midiToFrequency(60, { a4: 440, temperament: 'just', tonic: 0, anchor: 'tonic' });
    expect(f).toBeCloseTo(midiToEqualFrequency(60, 440), 9);
    // Just A above C is 5/3: 884.4 cents, 15.6 flat of equal.
    expect(targetOffset(69, { a4: 440, temperament: 'just', tonic: 0, anchor: 'tonic' })).toBeCloseTo(ratioToCents(5 / 3) - 900, 9);
  });

  it('keeps just intervals pure with the A anchor', () => {
    const tuning = { a4: 440, temperament: 'just' as const, tonic: 0 };
    expect(ratioToCents(midiToFrequency(64, tuning) / midiToFrequency(60, tuning))).toBeCloseTo(ratioToCents(5 / 4), 9);
  });
});

describe('well temperaments and written key (01-73, 01-74)', () => {
  it('knows which temperaments start from C', () => {
    expect(TEMPERAMENTS.filter((t) => isWellTemperament(t.id)).map((t) => t.id)).toEqual(['werckmeister3', 'vallotti', 'young2']);
  });

  it('converts a written key to concert and back', () => {
    // B flat instrument: written D is concert C.
    expect(writtenToConcertPc(2, 2)).toBe(0);
    expect(concertToWrittenPc(0, 2)).toBe(2);
    for (let pc = 0; pc < 12; pc++) expect(concertToWrittenPc(writtenToConcertPc(pc, 9), 9)).toBe(pc);
  });
});

describe('just ratio choices (01-75)', () => {
  it('uses the chosen ratio for a degree', () => {
    expect(temperamentOffset('just', 10, { justRatios: { 10: '7/4' } })).toBeCloseTo(ratioToCents(7 / 4) - 1000, 9);
    expect(temperamentOffset('just', 10, { justRatios: { 10: '7/4' } })).toBeCloseTo(-31.17, 2);
    expect(temperamentOffset('just', 2, { justRatios: { 2: '10/9' } })).toBeCloseTo(ratioToCents(10 / 9) - 200, 9);
    expect(temperamentOffset('just', 6, { justRatios: { 6: '64/45' } })).toBeCloseTo(ratioToCents(64 / 45) - 600, 9);
  });

  it('lists the default ratio first, matching the plain just table', () => {
    for (const [deg, alts] of Object.entries(JUST_ALTERNATIVES)) {
      const [n, d] = alts[0].ratio;
      expect(temperamentOffset('just', Number(deg))).toBeCloseTo(ratioToCents(n / d) - Number(deg) * 100, 9);
    }
  });

  it('drops ratios that are not offered', () => {
    expect(sanitizeJustRatios({ 10: '7/4', 4: '81/64', 2: '11/10', x: 1 })).toEqual({ 10: '7/4' });
  });
});

describe('meantone chain (01-76)', () => {
  it('default chain runs E flat to G sharp', () => {
    expect(temperamentOffset('meantone', 8)).toBeCloseTo(-27.37, 1);
    expect(meantoneCents(DEFAULT_MEANTONE_FLATS)).toEqual(meantoneCents());
  });

  it('with four flats the chain runs A flat to C sharp, so A flat is pure', () => {
    expect(temperamentOffset('meantone', 8, { meantoneFlats: 4 })).toBeCloseTo(13.69, 1);
    // A flat a pure major third below C: 5/4 down from the octave.
    expect(meantoneCents(4)[8]).toBeCloseTo(1200 - ratioToCents(5 / 4), 6);
  });
});

describe('temperament offsets on the ring (01-77)', () => {
  it('is empty in equal temperament', () => {
    expect(pitchClassOffsets({ a4: 440, temperament: 'equal', tonic: 0 }, 0)).toEqual([]);
    expect(vsEqualCents(3, 69, { a4: 440, temperament: 'equal', tonic: 0 })).toBeNull();
  });

  it('labels written pitch classes with their offset', () => {
    const tuning = { a4: 440, temperament: 'just' as const, tonic: 0, anchor: 'tonic' as const };
    const concert = pitchClassOffsets(tuning, 0);
    expect(concert[0]).toBe('');
    expect(concert[4]).toBe('−14');
    // B flat instrument: written F sharp is concert E.
    expect(pitchClassOffsets(tuning, 2)[6]).toBe('−14');
  });

  it('adds the target offset to get cents from equal', () => {
    const tuning = { a4: 440, temperament: 'just' as const, tonic: 0, anchor: 'tonic' as const };
    expect(vsEqualCents(0, 64, tuning)).toBeCloseTo(ratioToCents(5 / 4) - 400, 9);
  });
});

describe('tuning presets (01-78)', () => {
  it('keeps valid presets and drops broken ones', () => {
    const good = { id: 'a', name: 'Baroque', a4: 415, temperament: 'vallotti', tonic: 0, transposition: 'C' };
    expect(sanitizeTuningPreset(good)).toEqual(good);
    expect(sanitizeTuningPreset({ ...good, temperament: 'nope' })).toBeNull();
    expect(sanitizeTuningPreset({ ...good, tonic: 12 })).toBeNull();
    expect(mergeSettings({ tuningPresets: [good, { id: 1 }] } as never).tuningPresets).toEqual([good]);
  });
});

describe('tonic follows the drone (01-79)', () => {
  it('uses the lowest drone', () => {
    expect(tonicFromDrones(0, [])).toBe(0);
    expect(tonicFromDrones(0, [62, 69])).toBe(2);
  });

  it('with a D drone, F sharp is a pure 5/4 above D', () => {
    const tuning = { a4: 440, temperament: 'just' as const, tonic: tonicFromDrones(0, [50]) };
    expect(ratioToCents(midiToFrequency(66, tuning) / midiToFrequency(62, tuning))).toBeCloseTo(ratioToCents(5 / 4), 9);
  });
});

describe('partials (01-80)', () => {
  it('partials 5 and 7 sit below equal temperament', () => {
    expect(partialVsEqual(5)).toBeCloseTo(-13.69, 2);
    expect(partialVsEqual(7)).toBeCloseTo(-31.17, 2);
    expect(partialVsEqual(3)).toBeCloseTo(1.96, 2);
  });

  it('finds the nearest partial and the equal-tempered note it is near', () => {
    const r = nearestPartial(116.54 * 5 * Math.pow(2, 10 / 1200), 116.54)!;
    expect(r.n).toBe(5);
    expect(r.cents).toBeCloseTo(10, 6);
    expect(r.semitones).toBe(28);
    expect(nearestPartial(0, 100)).toBeNull();
  });
});
