import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, midiToFrequency } from '../src/core/notes';
import {
  beatCents,
  BeatMeter,
  beatRate,
  driftText,
  fitInharmonicity,
  HAPTIC_FLAT,
  HAPTIC_SHARP,
  HapticCues,
  matchPartials,
  measure,
  RangeFinder,
  sortTuningChecks,
  spectrumPeaks,
  StrikeWatcher,
  strikePitch,
  stretchCurve,
  stretchedOctaveCents,
  temperamentBeats,
  tuningChecksCsv,
} from '../src/core/tuningtools';

const SR = 48000;
function sines(parts: { hz: number; amp: number }[], seconds: number, decay = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    let v = 0;
    for (const p of parts) v += p.amp * Math.sin(2 * Math.PI * p.hz * t);
    out[i] = v * Math.exp(-decay * t);
  }
  return out;
}

describe('haptic direction cues (01-104)', () => {
  it('pulses short-short when sharp, long when flat, nothing in tune, at most once a second', () => {
    const h = new HapticCues(1000);
    expect(h.next(2, 5, 0)).toBeNull();
    expect(h.next(12, 5, 0)).toEqual(HAPTIC_SHARP);
    expect(h.next(-12, 5, 500)).toBeNull();
    expect(h.next(-12, 5, 1000)).toEqual(HAPTIC_FLAT);
    expect(h.next(null, 5, 5000)).toBeNull();
  });
});

describe('measure (01-98)', () => {
  it('gives mean and standard deviation', () => {
    const m = measure([
      { hz: 440, cents: 0 },
      { hz: 441, cents: 2 },
      { hz: 442, cents: 4 },
    ])!;
    expect(m.meanHz).toBeCloseTo(441, 6);
    expect(m.meanCents).toBeCloseTo(2, 6);
    expect(m.sdCents).toBeCloseTo(2, 6);
    expect(measure([{ hz: 440, cents: 0 }])).toBeNull();
  });
});

describe('vocal range finder (01-100)', () => {
  it('counts only notes held for half a second', () => {
    const r = new RangeFinder(0.5);
    let t = 0;
    const hold = (m: number | null, s: number) => {
      for (let i = 0; i < s * 60; i++) r.push(m, (t += 1 / 60));
    };
    hold(48, 1);
    hold(40, 0.3);
    hold(null, 0.2);
    hold(72, 0.7);
    expect(r.low).toBe(48);
    expect(r.high).toBe(72);
  });
});

describe('choir drift (01-101)', () => {
  it('reports how far the end is from the reference', () => {
    expect(driftText(440, 440 * Math.pow(2, -35 / 1200))).toBe('ended 35¢ flat');
    expect(driftText(440, 441, 5)).toBe('ended in tune (+4¢)');
  });
});

describe('ensemble tuning log (01-102)', () => {
  const entries = [
    { player: 'Sam', instrument: 'Trumpet', note: 'B♭4', cents: -8, time: 2 },
    { player: 'Ana, jr', instrument: 'Flute', note: 'A4', cents: 3, time: 1 },
  ];
  it('sorts by player, time or worst first', () => {
    expect(sortTuningChecks(entries, 'player')[0].player).toBe('Ana, jr');
    expect(sortTuningChecks(entries, 'cents')[0].player).toBe('Sam');
    expect(sortTuningChecks(entries, 'time')[0].time).toBe(1);
  });
  it('exports CSV with quoting', () => {
    const csv = tuningChecksCsv(entries).split('\n');
    expect(csv[0]).toBe('time,player,instrument,note,cents');
    expect(csv[2]).toContain('"Ana, jr",Flute,A4,3.0');
  });
});

describe('spectrum peaks (01-92, 01-91)', () => {
  it('finds bell-like inharmonic partials to within a cent', () => {
    const parts = [
      { hz: 250, amp: 0.5 },
      { hz: 500, amp: 0.7 },
      { hz: 597, amp: 0.4 },
      { hz: 750, amp: 0.3 },
      { hz: 1000, amp: 0.9 },
    ];
    const peaks = spectrumPeaks(sines(parts, 0.5, 2), SR, { count: 5, minHz: 100, maxHz: 3000 });
    expect(peaks).toHaveLength(5);
    peaks.forEach((p, i) => expect(Math.abs(1200 * Math.log2(p.hz / parts[i].hz))).toBeLessThan(1));
    expect(peaks[4].db).toBe(0);
  });

  it('reads a decaying struck tone once, 400 ms after the strike', () => {
    const w = new StrikeWatcher();
    let readyAt: number | null = null;
    for (let t = 0; t < 1000; t += 16) {
      const level = t < 200 ? 0.001 : 0.3 * Math.exp(-(t - 200) / 800);
      if (w.update(level, t).ready) {
        expect(readyAt).toBeNull();
        readyAt = t;
      }
    }
    expect(readyAt).toBeGreaterThanOrEqual(600);
    expect(readyAt).toBeLessThan(620);
    const hz = strikePitch(sines([{ hz: 131.3, amp: 1 }, { hz: 196.8, amp: 0.4 }], 0.35, 3), SR, 60, 500)!;
    expect(Math.abs(1200 * Math.log2(hz / 131.3))).toBeLessThan(1);
  });
});

describe('beat rate (01-94)', () => {
  it('measures two sines 1 Hz apart as 1 beat per second', () => {
    const r = beatRate(sines([{ hz: 440, amp: 0.3 }, { hz: 441, amp: 0.3 }], 4), SR)!;
    expect(r.hz).toBeCloseTo(1, 1);
    expect(beatCents(440.5, 1)).toBeCloseTo(3.93, 1);
  });

  it('measures 2.5 beats per second from per-frame levels at an uneven frame rate', () => {
    const m = new BeatMeter(6, 60);
    let t = 0;
    for (let i = 0; i < 400; i++) {
      t += i % 3 ? 0.016 : 0.018;
      m.push(t, Math.abs(Math.cos(Math.PI * 2.5 * t)));
    }
    expect(m.read()!.hz).toBeCloseTo(2.5, 1);
  });

  it('finds no beats in a steady tone', () => {
    expect(beatRate(sines([{ hz: 440, amp: 0.3 }], 3), SR)).toBeNull();
  });
});

describe('temperament beat rates (01-95)', () => {
  it('matches |q f2 - p f1| for each interval', () => {
    const list = temperamentBeats(DEFAULT_TUNING, 53, 65);
    const fifth = list.find((b) => b.name === 'fifth' && b.lower === 53)!;
    const f1 = midiToFrequency(53);
    const f2 = midiToFrequency(60);
    expect(fifth.beats).toBeCloseTo(2 * f2 - 3 * f1, 9);
    expect(fifth.beats).toBeLessThan(0);
    const third = list.find((b) => b.name === 'major third' && b.lower === 60)!;
    expect(third.beats).toBeCloseTo(4 * midiToFrequency(64) - 5 * midiToFrequency(60), 9);
    expect(third.beats).toBeGreaterThan(0);
    // A pure just fifth does not beat.
    const just = temperamentBeats({ a4: 440, temperament: 'just', tonic: 0, anchor: 'tonic' }, 60, 67).find((b) => b.name === 'fifth' && b.lower === 60)!;
    expect(Math.abs(just.beats)).toBeLessThan(1e-9);
  });
});

describe('piano inharmonicity (01-93)', () => {
  it('recovers B from partials of a stiff string', () => {
    const f0 = 110;
    const B = 0.0004;
    const partials = [1, 2, 3, 4, 5, 6].map((n) => ({ n, hz: n * f0 * Math.sqrt(1 + B * n * n) }));
    const fit = fitInharmonicity(partials)!;
    expect(fit.B).toBeCloseTo(B, 7);
    expect(fit.f0).toBeCloseTo(f0, 6);
  });

  it('matches partials from a spectrum', () => {
    const f0 = 220;
    const B = 0.0008;
    const parts = [1, 2, 3, 4, 5, 6].map((n) => ({ hz: n * f0 * Math.sqrt(1 + B * n * n), amp: 1 / n }));
    const peaks = spectrumPeaks(sines(parts, 1), SR, { count: 12, minHz: 100, maxHz: 3000 });
    const matched = matchPartials(peaks, parts[0].hz, 6);
    expect(matched.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(fitInharmonicity(matched)!.B).toBeCloseTo(B, 4);
  });

  it('stretches a 4:2 octave only when the strings are stiff', () => {
    expect(stretchedOctaveCents(0, 0)).toBeCloseTo(0, 9);
    const c = stretchedOctaveCents(0.0004, 0.0004);
    // Worked by hand: 1200 log2(sqrt((1 + 16B) / (1 + 4B))) for equal B, first partials cancelling.
    expect(c).toBeCloseTo(1200 * Math.log2(Math.sqrt((1 + 16 * 0.0004) / (1 + 4 * 0.0004))), 9);
    const curve = stretchCurve({ 45: 0.0002, 69: 0.0004, 93: 0.002 });
    expect(curve[69]).toBe(0);
    expect(curve[93]).toBeGreaterThan(curve[81]);
    expect(curve[81]).toBeGreaterThan(0);
    expect(curve[45]).toBeLessThan(curve[57]);
    expect(curve[57]).toBeLessThan(0);
  });
});
