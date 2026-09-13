import { describe, expect, it } from 'vitest';
import { trainerStep } from '../src/audio/metronome';
import { conductorPoint, CONDUCTOR_PATTERNS } from '../src/core/conductor';
import { estimateTempo, FlashLimiter, FluxOnsetDetector, KnockDetector, timingStats } from '../src/core/onsets';

describe('speed trainer steps', () => {
  it('steps up and stops at the target', () => {
    expect(trainerStep(100, 100, 110, 5)).toEqual({ bpm: 105, reached: false });
    expect(trainerStep(108, 100, 110, 5)).toEqual({ bpm: 110, reached: true });
  });
  it('steps down toward a lower target', () => {
    expect(trainerStep(120, 120, 100, 5)).toEqual({ bpm: 115, reached: false });
    expect(trainerStep(102, 120, 100, 5)).toEqual({ bpm: 100, reached: true });
  });
  it('steps in percent', () => {
    expect(trainerStep(100, 100, 200, 10, 'percent').bpm).toBe(110);
    expect(trainerStep(110, 100, 200, 10, 'percent').bpm).toBe(121);
  });
  it('a negative pattern step goes back but never past the start', () => {
    expect(trainerStep(110, 100, 150, -4).bpm).toBe(106);
    expect(trainerStep(102, 100, 150, -4)).toEqual({ bpm: 100, reached: false });
  });
  it('target equal to start is already reached', () => {
    expect(trainerStep(100, 100, 100, 5)).toEqual({ bpm: 100, reached: true });
  });
});

describe('conductor ball', () => {
  it('touches the bottom at each ictus and rises between', () => {
    for (const beats of [2, 3, 4, 6]) {
      for (let b = 0; b < beats; b++) {
        const p = conductorPoint(beats, b, 0)!;
        expect(p.y).toBeCloseTo(0, 9);
        expect(p.x).toBeCloseTo(CONDUCTOR_PATTERNS[beats][b], 9);
        expect(conductorPoint(beats, b, 1)!.x).toBeCloseTo(CONDUCTOR_PATTERNS[beats][(b + 1) % beats], 9);
        expect(conductorPoint(beats, b, 0.5)!.y).toBeCloseTo(1, 9);
      }
    }
  });
  it('has no pattern for 5 (not sourced)', () => {
    expect(conductorPoint(5, 0, 0)).toBeNull();
  });
});

describe('onset detection', () => {
  it('finds a clap in silence once, with a refractory period', () => {
    const d = new FluxOnsetDetector();
    const quiet = new Array(64).fill(0.001);
    const loud = new Array(64).fill(1);
    const hits: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t = i * 10;
      const frame = i === 50 || i === 52 || i === 80 ? loud : quiet;
      if (d.push(frame, t)) hits.push(t);
    }
    // 520 ms is inside the 150 ms refractory period of 500 ms.
    expect(hits).toEqual([500, 800]);
  });
  it('knock detector needs a jump above the threshold', () => {
    const k = new KnockDetector();
    expect(k.push(0, 0, 1, 0)).toBe(false);
    expect(k.push(0, 0, 20, 10)).toBe(true);
    expect(k.push(0, 0, 0, 20)).toBe(false);
    expect(k.push(0, 0, 30, 60)).toBe(false);
    expect(k.push(0, 0, 0, 300)).toBe(false);
    expect(k.push(0, 0, 30, 310)).toBe(true);
  });
});

describe('timing check', () => {
  const beats = Array.from({ length: 16 }, (_, i) => ({ time: i * 0.5, beat: i % 4 }));
  it('reports late playing, spread and per-beat offsets', () => {
    const onsets = beats.map((b) => b.time + 0.02);
    const s = timingStats(onsets, beats, 4);
    expect(s.count).toBe(16);
    expect(s.meanMs).toBeCloseTo(20, 6);
    expect(s.spreadMs).toBeCloseTo(0, 6);
    expect(s.perBeatMs.every((ms) => Math.abs(ms - 20) < 1e-6)).toBe(true);
    expect(s.driftMs).toBeCloseTo(0, 6);
  });
  it('subtracts latency, ignores far onsets and sees drift', () => {
    const onsets = beats.map((b, i) => b.time + 0.05 + i * 0.002);
    onsets.push(0.25);
    const s = timingStats(onsets, beats, 4, 0.05);
    expect(s.count).toBe(16);
    expect(s.meanMs).toBeCloseTo(15, 6);
    expect(s.driftMs).toBeGreaterThan(10);
  });
  it('early notes are negative', () => {
    expect(timingStats(beats.map((b) => b.time - 0.03), beats, 4).meanMs).toBeCloseTo(-30, 6);
  });
});

describe('tempo from an onset envelope', () => {
  const envelope = (bpm: number, seconds: number, rate: number) => {
    const out = new Array(Math.round(seconds * rate)).fill(0);
    const period = (60 * rate) / bpm;
    for (let t = 0; t < out.length; t += period) out[Math.round(t)] = 1;
    return out;
  };
  it.each([90, 120, 150])('finds %i BPM within 2 BPM', (bpm) => {
    const got = estimateTempo(envelope(bpm, 8, 100), 100)!;
    expect(Math.abs(got - bpm)).toBeLessThanOrEqual(2);
  });
  it('returns null for silence', () => {
    expect(estimateTempo(new Array(800).fill(0), 100)).toBeNull();
  });
});

describe('flash limiter (WCAG 2.3.1)', () => {
  it('never allows more than 3 flashes in any second', () => {
    const f = new FlashLimiter();
    const allowed: number[] = [];
    // 240 BPM with every beat a downbeat: 4 per second asked for.
    for (let t = 0; t < 5000; t += 250) if (f.allow(t, 170, true)) allowed.push(t);
    for (const t of allowed) expect(allowed.filter((u) => u > t - 1000 && u <= t).length).toBeLessThanOrEqual(3);
  });
  it('above 180 BPM flashes only downbeats', () => {
    const f = new FlashLimiter();
    expect(f.allow(0, 200, false)).toBe(false);
    expect(f.allow(0, 200, true)).toBe(true);
  });
});
