import { describe, expect, it } from 'vitest';
import { grooveBar, GROOVES, MetronomeSequence, RUDIMENTS, weightedBeats } from '../src/core/metroseq';
import {
  barsPerMinute,
  clampBpm,
  exactBpm,
  expandClickTrack,
  formatBpm,
  MAX_BPM,
  METRONOME_MARKS,
  MIN_BPM,
  nearestMark,
  noteLengthsMs,
  parseTempo,
  rampBeatTime,
  roundBpm,
  stepToMark,
  TapTempo,
  tempoMarking,
  tempoMarkings,
  type RampCurve,
} from '../src/core/rhythm';
import { drain, main, settings } from './metronome-gaps2.test';

describe('drum grooves (02-36)', () => {
  it('rock plays hi-hat eighths, kick on 1 and 3, snare on 2 and 4', () => {
    const seq = new MetronomeSequence(() => settings({ groove: 'rock' }));
    const es = drain(seq, 3.99).filter((e) => e.layer === 'groove');
    const at = (v: string) => es.filter((e) => e.voice === v).map((e) => +e.time.toFixed(3));
    expect(at('hihat')).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    expect(at('kick')).toEqual([0, 2]);
    expect(at('snare')).toEqual([1, 3]);
    // The groove replaces the click, which stays silent so the beats still show.
    expect(main(es).length).toBe(0);
    expect(main(drain(new MetronomeSequence(() => settings({ groove: 'rock' })), 3.99)).every((e) => e.level === 'silent')).toBe(true);
  });

  it('a fill replaces the last bar of every N bars, and swing moves the off-beat eighths', () => {
    const fill = grooveBar('rock', true)!;
    expect(fill.snare).toBe('....xxxx');
    const seq = new MetronomeSequence(() => settings({ groove: 'rock', grooveFill: 2, swing: 66 }));
    const es = drain(seq, 7.99).filter((e) => e.layer === 'groove');
    const snare = es.filter((e) => e.voice === 'snare').map((e) => +e.time.toFixed(2));
    expect(snare).toEqual([1, 3, 6, 6.66, 7, 7.66]);
    expect(es.filter((e) => e.voice === 'hihat').map((e) => +e.time.toFixed(2)).slice(0, 2)).toEqual([0, 0.66]);
  });

  it('every groove has voices that fill its meter evenly', () => {
    for (const g of GROOVES) for (const cells of Object.values(g.voices)) expect(cells!.length % g.meter[0]).toBe(0);
  });
});

describe('rudiments (02-37)', () => {
  it('stickings use only R and L and paradiddles end on a double', () => {
    for (const r of RUDIMENTS) expect(r.sticking).toMatch(/^[RL]+$/);
    expect(RUDIMENTS.find((r) => r.id === 'paradiddle')!.sticking).toBe('RLRRLRLL');
  });
});

describe('offset (02-39)', () => {
  it('moves every click later without changing bar and beat numbers', () => {
    const es = main(drain(new MetronomeSequence(() => settings({ offset: 0.5 })), 1.9));
    expect(es.map((e) => [e.time, e.beat])).toEqual([
      [0.5, 0],
      [1.5, 1],
    ]);
  });
});

describe('uneven beats (02-40)', () => {
  it('weights set the beat lengths and keep the bar length', () => {
    const spans = weightedBeats([1, 1.37, 1.28], 3);
    expect(spans.reduce((a, s) => a + s.len, 0)).toBeCloseTo(3, 12);
    expect(spans[1].len / spans[0].len).toBeCloseTo(1.37, 12);
    const es = main(drain(new MetronomeSequence(() => settings({ beatsPerBar: 3, beatWeights: [1, 1.37, 1.28] })), 2.99));
    expect(es.map((e) => +e.time.toFixed(4))).toEqual([0, +((3 * 1) / 3.65).toFixed(4), +((3 * 2.37) / 3.65).toFixed(4)]);
    expect(weightedBeats([1, 2], 3)).toEqual([0, 1, 2].map((i) => ({ start: i, len: 1 })));
  });
});

describe('tempo numbers (02-41 to 02-44)', () => {
  it('keeps 0.1 BPM steps and the wider range', () => {
    expect(roundBpm(72.54)).toBe(72.5);
    expect(MIN_BPM).toBe(10);
    expect(MAX_BPM).toBe(600);
    expect(clampBpm(5)).toBe(10);
    expect(formatBpm(72.5)).toBe('72.5');
    expect(formatBpm(100)).toBe('100');
  });

  it('empty text is not a number', () => {
    expect(parseTempo('')).toBeNull();
    expect(parseTempo('  ')).toBeNull();
    expect(parseTempo('abc')).toBeNull();
    expect(parseTempo('72,5')).toBe(72.5);
  });

  it('half then double returns to the same tempo', () => {
    for (const bpm of [101, 99.9, 333, 21]) expect(exactBpm(exactBpm(bpm / 2) * 2)).toBe(bpm);
  });
});

describe('tempo names (02-45)', () => {
  it('overlapping ranges give both names, and a single range gives one', () => {
    expect(tempoMarkings(170)).toEqual(['Vivace', 'Presto']);
    expect(tempoMarking(170)).toBe('Vivace or Presto');
    expect(tempoMarking(130)).toBe('Allegro');
    expect(tempoMarking(MAX_BPM)).toBe('Prestissimo');
    expect(tempoMarking(MIN_BPM)).toBe('Larghissimo');
  });
});

describe('tempo ramps (02-46)', () => {
  const integrate = (b0: number, b1: number, T: number, curve: RampCurve) => {
    // Beats played by time T with tempo b(t), by the midpoint rule.
    const steps = 200000;
    let beats = 0;
    for (let i = 0; i < steps; i++) {
      const t = ((i + 0.5) / steps) * T;
      const bpm = curve === 'exp' ? b0 * (b1 / b0) ** (t / T) : b0 + ((b1 - b0) * t) / T;
      beats += (bpm / 60) * (T / steps);
    }
    return beats;
  };

  it('linear in time and exponential ramps last T and play exactly n beats in it (within 1 ms)', () => {
    for (const curve of ['time', 'exp'] as const) {
      for (const [b0, b1, n] of [
        [60, 120, 32],
        [180, 90, 16],
      ]) {
        const T = rampBeatTime(n, b0, b1, n, curve);
        if (curve === 'time') expect(Math.abs(T - (120 * n) / (b0 + b1))).toBeLessThan(0.001);
        expect(Math.abs(integrate(b0, b1, T, curve) - n)).toBeLessThan(0.001 * (Math.max(b0, b1) / 60));
      }
    }
  });

  it('beat times match the tempo curve at every beat, then hold at the end tempo', () => {
    const b0 = 60;
    const b1 = 120;
    const n = 8;
    const T = rampBeatTime(n, b0, b1, n, 'time');
    for (let k = 0; k <= n; k++) {
      const t = rampBeatTime(k, b0, b1, n, 'time');
      const beats = (b0 * t + ((b1 - b0) * t * t) / (2 * T)) / 60;
      expect(Math.abs(beats - k)).toBeLessThan(1e-9);
    }
    expect(rampBeatTime(n + 2, b0, b1, n, 'time') - T).toBeCloseTo(1, 12);
  });

  it('linear in time spends less time at the slow end than linear per beat', () => {
    expect(rampBeatTime(16, 60, 120, 16, 'time')).toBeLessThan(rampBeatTime(16, 60, 120, 16, 'beat'));
  });

  it('the metronome ramps and holds, and click-track sections can choose a curve', () => {
    const es = main(drain(new MetronomeSequence(() => settings({ bpm: 60, rampTo: 120, rampBars: 1, rampCurve: 'time' })), 100)).slice(0, 8);
    expect(es[4].time).toBeCloseTo((120 * 4) / 180, 9);
    expect(es[5].time - es[4].time).toBeCloseTo(0.5, 9);
    const { events } = expandClickTrack({ id: 't', name: 't', countInBars: 0, sections: [{ bars: 2, bpm: 60, endBpm: 120, curve: 'time', beatsPerBar: 4, beatUnit: 4, subdivision: 1 }] });
    expect(events[7].time).toBeCloseTo(rampBeatTime(7, 60, 120, 8, 'time'), 9);
  });
});

describe('metronome marks, dance units and note lengths (02-53 to 02-55)', () => {
  it('steps between the traditional marks', () => {
    expect(METRONOME_MARKS[0]).toBe(40);
    expect(METRONOME_MARKS[METRONOME_MARKS.length - 1]).toBe(208);
    expect(stepToMark(60, 1)).toBe(63);
    expect(stepToMark(61, -1)).toBe(60);
    expect(stepToMark(208, 1)).toBe(209);
    expect(nearestMark(101)).toBe(100);
  });

  it('bars per minute and milliseconds per note', () => {
    expect(barsPerMinute(87, 3)).toBe(29);
    const ms = noteLengthsMs(120);
    expect(ms.find((x) => x.label === 'Quarter')!.ms).toBe(500);
    expect(ms.find((x) => x.label === 'Eighth triplet')!.ms).toBeCloseTo(166.667, 3);
  });
});

describe('tap tempo (02-56 to 02-58)', () => {
  const rand = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  it('shows from the third tap, not the second', () => {
    const t = new TapTempo();
    expect(t.add(0)).toBeNull();
    expect(t.add(500)).toBeNull();
    expect(t.add(1000)).toBe(120);
  });

  it('works below 30 BPM (a 2.4 s gap does not reset)', () => {
    const t = new TapTempo();
    [0, 2400, 4800].forEach((ms) => t.add(ms));
    expect(t.bpm()).toBe(25);
  });

  it('drops an outlier interval', () => {
    const t = new TapTempo();
    [0, 500, 1000, 1700, 2200, 2700].forEach((ms) => t.add(ms));
    expect(t.bpm()).toBe(120);
  });

  it('with +-20 ms jitter lands within 1 BPM after 6 taps at 60 and 120 BPM', () => {
    for (const bpm of [60, 120]) {
      for (let seed = 1; seed <= 50; seed++) {
        const r = rand(seed);
        const t = new TapTempo();
        for (let i = 0; i < 6; i++) t.add(1000 + (i * 60000) / bpm + (r() * 40 - 20));
        expect(Math.abs(t.bpm()! - bpm)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('at 240 BPM the same jitter is mostly within 2 BPM after 6 taps', () => {
    let within = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const r = rand(seed);
      const t = new TapTempo();
      for (let i = 0; i < 6; i++) t.add(1000 + i * 250 + (r() * 40 - 20));
      if (Math.abs(t.bpm()! - 240) <= 2) within++;
    }
    expect(within).toBeGreaterThan(25);
  });
});
