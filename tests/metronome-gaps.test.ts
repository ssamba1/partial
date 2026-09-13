import { afterEach, describe, expect, it, vi } from 'vitest';
import { LookaheadScheduler, STALE_VISUAL, type ScheduledEvent } from '../src/audio/scheduler';
import { levelGain, loudnessGain } from '../src/audio/voices';
import { ClickLog } from '../src/core/gestures';
import {
  beatOnsets,
  beatSeconds,
  cycleItemsIn,
  groupingAccents,
  groupingOptions,
  MetronomeSequence,
  TIMELINES,
  validGrouping,
  type SequenceSettings,
} from '../src/core/metroseq';
import { nextAccent, type ClickEvent } from '../src/core/rhythm';

function settings(patch: Partial<SequenceSettings> = {}): SequenceSettings {
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

/** Pull every event that starts before `until` seconds. */
function drain(seq: MetronomeSequence, until: number): ClickEvent[] {
  const out: ClickEvent[] = [];
  for (;;) {
    const e = seq.next(until);
    if (e === null || e === 'wait') return out;
    out.push(e);
  }
}

const main = (es: ClickEvent[]) => es.filter((e) => !e.layer);

describe('MetronomeSequence', () => {
  it('a tempo change mid-beat applies from the next beat (20 to 200 BPM)', () => {
    let s = settings({ bpm: 20 });
    const seq = new MetronomeSequence(() => s);
    const first = drain(seq, 0.5); // builds only beat 1 (3 s long)
    expect(main(first).map((e) => e.time)).toEqual([0]);
    s = settings({ bpm: 200 });
    const rest = main(drain(seq, 3.7));
    expect(rest[0].time).toBeCloseTo(3, 9);
    expect(rest[1].time - rest[0].time).toBeCloseTo(0.3, 9);
  });

  it('switching subdivision keeps times increasing', () => {
    let s = settings({ subdivision: 4 });
    const seq = new MetronomeSequence(() => s);
    const a = drain(seq, 0.1);
    s = settings({ subdivision: 3 });
    const b = drain(seq, 3);
    const times = main([...a, ...b]).map((e) => e.time);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
    expect(main(b).slice(0, 3).map((e) => +e.time.toFixed(6))).toEqual([1, 1.333333, 1.666667]);
  });

  it('meter changes wait for the barline', () => {
    let s = settings({ beatsPerBar: 4 });
    const seq = new MetronomeSequence(() => s);
    drain(seq, 1.5);
    s = settings({ beatsPerBar: 3 });
    const beats = main(drain(seq, 7.5)).map((e) => `${e.bar}:${e.beat}`);
    expect(beats).toEqual(['0:2', '0:3', '1:0', '1:1', '1:2', '2:0']);
  });

  it('poly pulses follow a tempo change', () => {
    let s = settings({ poly: 3 });
    const seq = new MetronomeSequence(() => s);
    const a = drain(seq, 0.1).filter((e) => e.layer === 'poly');
    expect(a.map((e) => e.time)).toEqual([0]);
    s = settings({ poly: 3, bpm: 120 });
    const b = drain(seq, 2.4).filter((e) => e.layer === 'poly');
    // Pulse 1 sits 4/3 beats in: beat 1 took 1 s, then 1/3 beat at 0.5 s per beat.
    expect(b[0].pulse).toBe(1);
    expect(b[0].time).toBeCloseTo(1 + 0.5 / 3, 9);
  });

  it('swing 66.7 lands within 1 ms of the triplet position', () => {
    expect(Math.abs(beatOnsets(2, '', 66.7)[1] - 2 / 3) * 1000).toBeLessThan(1);
    const seq = new MetronomeSequence(() => settings({ subdivision: 2, swing: 66.7 }));
    const e = main(drain(seq, 0.1));
    expect(Math.abs(e[1].time - 2 / 3)).toBeLessThan(0.001);
  });

  it('click groups play 2+2+3 as long and short beats', () => {
    const s = settings({ bpm: 120, beatsPerBar: 7, beatUnit: 8, grouping: [2, 2, 3], clickGroups: true, accents: groupingAccents([2, 2, 3], 7) });
    const seq = new MetronomeSequence(() => s);
    const e = main(drain(seq, 3.6));
    expect(e.slice(0, 4).map((x) => x.time)).toEqual([0, 1, 2, 3.5]);
    expect(e.slice(0, 3).map((x) => x.level)).toEqual(['accent', 'medium', 'medium']);
  });

  it('stops after N bars and count-in bars come first', () => {
    const seq = new MetronomeSequence(() => settings({ beatsPerBar: 2, stopAfterBars: 1 }), 1, 1);
    const e = main(drain(seq, Infinity));
    expect(e.map((x) => x.countIn)).toEqual([true, true, false, false]);
    expect(seq.next()).toBeNull();
  });

  it('timeline events follow the son clave grid', () => {
    const seq = new MetronomeSequence(() => settings({ timeline: 'son-32' }));
    const t = drain(seq, 4).filter((e) => e.layer === 'timeline');
    expect(t.map((e) => e.time * 4)).toEqual([0, 3, 6, 10, 12]);
  });
});

describe('metronome helpers', () => {
  it('groupings', () => {
    expect(groupingAccents([2, 2, 3], 7)).toEqual(['accent', 'normal', 'medium', 'normal', 'medium', 'normal', 'normal']);
    expect(groupingOptions(7)).toEqual([[2, 2, 3], [2, 3, 2], [3, 2, 2]]);
    expect(validGrouping([3, 3], 7)).toBe(false);
    expect(validGrouping([3, 4], 7)).toBe(true);
  });

  it('pulse note sets the beat length', () => {
    // 6/8 with BPM counting dotted quarters: an eighth is a third of 60 / bpm.
    expect(beatSeconds(60, 8, 0.375)).toBeCloseTo(1 / 3, 12);
    expect(beatSeconds(60, 2, 0.25)).toBeCloseTo(2, 12);
    expect(beatSeconds(90, 4)).toBeCloseTo(60 / 90, 12);
  });

  it('cycleItemsIn is exact at the edges', () => {
    expect(cycleItemsIn(3, 4, 0, 4).map((x) => x.index)).toEqual([0, 1, 2]);
    expect(cycleItemsIn(3, 3, 1, 1)).toEqual([{ index: 1, frac: 0 }]);
    expect(cycleItemsIn(4, 3, 2, 1).map((x) => x.index)).toEqual([3]);
  });

  it('timelines fill whole bars', () => {
    for (const t of TIMELINES) expect(t.cells.length % t.meter[0]).toBe(0);
  });

  it('accent levels cycle through all five', () => {
    expect([nextAccent('accent'), nextAccent('medium'), nextAccent('normal'), nextAccent('soft'), nextAccent('silent')]).toEqual(['medium', 'normal', 'soft', 'silent', 'accent']);
  });

  it('accents are at least the set dB louder', () => {
    const db = 20 * Math.log10(levelGain('accent', 6) / levelGain('normal', 6));
    expect(db).toBeGreaterThanOrEqual(6 - 1e-9);
    expect(levelGain('medium')).toBeLessThan(1);
    expect(levelGain('medium')).toBeGreaterThan(levelGain('normal'));
    expect(levelGain('soft')).toBeLessThan(levelGain('normal'));
  });

  it('loudness gain matches RMS but caps the peak', () => {
    expect(loudnessGain(0.1, 0.2, 0.2)).toBeCloseTo(2, 12);
    expect(loudnessGain(0.1, 0.8, 0.2)).toBeCloseTo(0.9 / 0.8, 12);
    expect(loudnessGain(0, 0, 0.2)).toBe(1);
  });

  it('ClickLog keeps every click of a dense bar', () => {
    const log = new ClickLog(2);
    for (let i = 0; i < 40; i++) log.add(10 + i * 0.025);
    log.add(10.5); // duplicate
    expect(log.times(10.9).length).toBe(40);
    expect(log.times(12.5).length).toBe(20);
  });
});

describe('LookaheadScheduler', () => {
  afterEach(() => vi.useRealTimers());

  it('moves the run forward after a stall instead of firing old clicks', () => {
    vi.useFakeTimers();
    const clock = { currentTime: 0 };
    const sched = new LookaheadScheduler(clock, { lookahead: 0.1 });
    const seq = new MetronomeSequence(() => settings({ bpm: 120 }));
    const got: ScheduledEvent[] = [];
    sched.start((h) => seq.next(h), (e) => got.push(e), undefined, undefined, 0.1);
    clock.currentTime = 0.05;
    vi.advanceTimersByTime(25);
    expect(got.map((e) => e.when)).toEqual([0.1]);
    clock.currentTime = 3; // timer frozen for 3 s
    vi.advanceTimersByTime(25);
    sched.stop();
    expect(sched.skipped).toBeGreaterThan(0);
    for (const e of got.slice(1)) expect(e.when).toBeGreaterThanOrEqual(3 - 0.02);
    const gaps = got.slice(1).map((e, i) => e.when - got[i].when);
    expect(gaps.filter((g) => g < 0.49).length).toBe(0);
  });

  it('drops stale visuals', () => {
    const clock = { currentTime: 1, getOutputTimestamp: () => ({ contextTime: 1, performanceTime: 1000 }) };
    const sched = new LookaheadScheduler(clock);
    const seen: number[] = [];
    const seq = [0, 0.02];
    sched.start(() => (seq.length ? ({ time: seq.shift()!, bar: 0, beat: 0, sub: 0, level: 'normal', bpm: 60, section: 0, countIn: false } as ClickEvent) : null), () => {}, (e) => seen.push(e.when), undefined, 0);
    // Page time 1000 ms is context time 1; flush at a time past both events by more than the stale limit for the first.
    sched.flushVisuals((e) => seen.push(e.when), 1000 + STALE_VISUAL * 1000 + 10);
    sched.stop();
    expect(seen).toEqual([1.02]);
  });
});
