import { describe, expect, it } from 'vitest';
import { LIMITER_CEILING, limiterCurve } from '../src/audio/context';
import { levelTrim } from '../src/audio/voices';
import { MetronomeSequence, unitOnsets, type SequenceSettings } from '../src/core/metroseq';
import type { ClickEvent } from '../src/core/rhythm';

export function settings(patch: Partial<SequenceSettings> = {}): SequenceSettings {
  return {
    bpm: 60,
    beatsPerBar: 4,
    beatUnit: 4,
    subdivision: 1,
    accents: undefined,
    countInBars: 0,
    poly: 0,
    polyBeats: 0,
    playBars: 0,
    muteBars: 0,
    randomMute: 0,
    stopAfterBars: 0,
    grouping: [],
    clickGroups: false,
    pulseNote: 0,
    pattern: [],
    subdivisionPerBeat: [],
    figure: '',
    swing: 50,
    layers: [],
    timeline: '',
    ...patch,
  };
}

export function drain(seq: MetronomeSequence, until: number): ClickEvent[] {
  const out: ClickEvent[] = [];
  for (;;) {
    const e = seq.next(until);
    if (e === null || e === 'wait') return out;
    out.push(e);
  }
}

export const main = (es: ClickEvent[]) => es.filter((e) => !e.layer);

describe('master limiter (02-16)', () => {
  it('the brickwall curve never exceeds the ceiling and is the identity below the knee', () => {
    const c = limiterCurve();
    let max = 0;
    for (let i = 0; i < c.length; i++) max = Math.max(max, Math.abs(c[i]));
    expect(max).toBeLessThanOrEqual(LIMITER_CEILING);
    expect(LIMITER_CEILING).toBeLessThan(1);
    const mid = (c.length - 1) / 2;
    // x = 0.5 sits at index mid * 1.5.
    expect(c[Math.round(mid * 1.5)]).toBeCloseTo(0.5, 3);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
  });
});

describe('rendered level order (02-19)', () => {
  it('lifts an accent that renders quieter than normal, and never lifts soft clicks', () => {
    expect(levelTrim(0.09, 0.1, 'accent')).toBeCloseTo(0.1 / 0.09, 12);
    expect(levelTrim(0.2, 0.1, 'accent')).toBe(1);
    expect(levelTrim(0.2, 0.1, 'sub')).toBeCloseTo(0.5, 12);
    expect(levelTrim(0.05, 0.1, 'soft')).toBe(1);
  });
});

describe('subdivisions follow the pulse note (02-24)', () => {
  it('2/2 with BPM counting quarters: two clicks per quarter give four per half', () => {
    expect(unitOnsets({ subdivision: 2, figure: '', swing: 50, pulseNote: 0.25, beatUnit: 2 }, 0)).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it('6/8 with BPM counting dotted quarters: three clicks per pulse land on the eighths', () => {
    // A step of one eighth coincides with every written beat, so no extra clicks.
    expect(unitOnsets({ subdivision: 3, figure: '', swing: 50, pulseNote: 0.375, beatUnit: 8 }, 1)).toEqual([0]);
    // Two per dotted quarter: one at the half pulse, 1.5 eighths in, which falls inside beat 2.
    expect(unitOnsets({ subdivision: 2, figure: '', swing: 50, pulseNote: 0.375, beatUnit: 8 }, 1)).toEqual([0, 0.5]);
    expect(unitOnsets({ subdivision: 2, figure: '', swing: 50, pulseNote: 0.375, beatUnit: 8 }, 0)).toEqual([0]);
  });

  it('the sequence times match the pulse grid', () => {
    // 6/8 at 60 BPM per dotted quarter: an eighth is 1/3 s, the half pulse 0.5 s.
    const seq = new MetronomeSequence(() => settings({ beatsPerBar: 6, beatUnit: 8, pulseNote: 0.375, subdivision: 2 }));
    const times = main(drain(seq, 1.99)).map((e) => +e.time.toFixed(6));
    expect(times).toEqual([0, 0.333333, 0.5, 0.666667, 1, 1.333333, 1.5, 1.666667]);
  });

  it('with the pulse equal to the beat nothing changes', () => {
    expect(unitOnsets({ subdivision: 3, figure: '', swing: 50, pulseNote: 0.25, beatUnit: 4 }, 2)).toEqual([0, 1 / 3, 2 / 3]);
  });
});
