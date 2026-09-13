import { describe, expect, it } from 'vitest';
import { demodulate, PhaseStrobe, SampleClock } from '../src/core/strobe';

const SR = 48000;
const N = 4096;

/** A long signal and a reader that takes N-sample windows ending at given absolute positions. */
function signal(seconds: number, fn: (t: number) => number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = fn(i / SR);
  return out;
}

/** Unwrapped phase slope in cycles per second from (time, phase) pairs. */
function slope(points: { t: number; phase: number }[]): number {
  let acc = 0;
  const unwrapped = points.map((p, i) => {
    if (i > 0) {
      let d = p.phase - points[i - 1].phase;
      d -= Math.round(d);
      acc += d;
    }
    return { t: p.t, y: acc };
  });
  const n = unwrapped.length;
  const mt = unwrapped.reduce((s, p) => s + p.t, 0) / n;
  const my = unwrapped.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of unwrapped) {
    num += (p.t - mt) * (p.y - my);
    den += (p.t - mt) ** 2;
  }
  return num / den;
}

describe('sample clock', () => {
  it('recovers the exact shift between overlapping buffers from a wrong estimate', () => {
    const sig = signal(1, (t) => Math.sin(2 * Math.PI * 330 * t) + 0.01 * Math.sin(2 * Math.PI * 1234.5 * t * t));
    const clock = new SampleClock();
    let end = N;
    clock.advance(sig.slice(0, N), 0);
    const hops = [800, 768, 0, 1600, 131, 2048];
    for (const hop of hops) {
      end += hop;
      clock.advance(sig.slice(end - N, end), hop + 300);
      expect(clock.lastShift).toBe(hop);
      expect(clock.matched).toBe(true);
    }
    expect(clock.end).toBe(end - N);
  });

  it('falls back to the estimate when buffers do not overlap', () => {
    const clock = new SampleClock();
    const sig = signal(1, (t) => Math.sin(2 * Math.PI * 200 * t));
    clock.advance(sig.slice(0, N), 0);
    clock.advance(sig.slice(10000, 10000 + N), 10000);
    expect(clock.matched).toBe(false);
    expect(clock.lastShift).toBe(10000);
  });
});

describe('phase strobe', () => {
  it('a tone 0.3 cents sharp at A4 turns at 440 x (2^(0.3/1200) - 1) cycles per second', () => {
    const f = 440 * Math.pow(2, 0.3 / 1200);
    const sig = signal(4, (t) => 0.5 * Math.sin(2 * Math.PI * f * t + 0.7));
    const strobe = new PhaseStrobe();
    const pts: { t: number; phase: number }[] = [];
    let end = N;
    let prev = end;
    let k = 0;
    const hops = [800, 801, 799, 768, 832];
    while (end <= sig.length) {
      const rows = strobe.update(sig.slice(end - N, end), SR, 440, end - prev + (k % 3) * 64)!;
      pts.push({ t: end / SR, phase: rows[0].phase });
      expect(rows[0].strength).toBeGreaterThan(0.95);
      prev = end;
      end += hops[k++ % hops.length];
    }
    const expected = 440 * (Math.pow(2, 0.3 / 1200) - 1);
    expect(expected).toBeCloseTo(0.0762, 3);
    expect(slope(pts)).toBeCloseTo(expected, 3);
  });

  it('stands still in tune and turns backwards when flat', () => {
    for (const cents of [0, -2]) {
      const f = 196 * Math.pow(2, cents / 1200);
      const sig = signal(3, (t) => Math.sin(2 * Math.PI * f * t));
      const strobe = new PhaseStrobe();
      const pts: { t: number; phase: number }[] = [];
      for (let end = N, prev = N; end <= sig.length; prev = end, end += 800) {
        pts.push({ t: end / SR, phase: strobe.update(sig.slice(end - N, end), SR, 196, end - prev)![0].phase });
      }
      expect(slope(pts)).toBeCloseTo(196 * (Math.pow(2, cents / 1200) - 1), 3);
    }
  });

  it('each row follows its own partial: a second partial 3 cents sharp', () => {
    const f0 = 220;
    const f2 = 2 * f0 * Math.pow(2, 3 / 1200);
    const sig = signal(3, (t) => 0.6 * Math.sin(2 * Math.PI * f0 * t) + 0.3 * Math.sin(2 * Math.PI * f2 * t + 1));
    const strobe = new PhaseStrobe();
    const r0: { t: number; phase: number }[] = [];
    const r1: { t: number; phase: number }[] = [];
    let s2 = 0;
    for (let end = N, prev = N; end <= sig.length; prev = end, end += 800) {
      const rows = strobe.update(sig.slice(end - N, end), SR, f0, end - prev)!;
      r0.push({ t: end / SR, phase: rows[0].phase });
      r1.push({ t: end / SR, phase: rows[1].phase });
      s2 = rows[2].strength;
    }
    expect(slope(r0)).toBeCloseTo(0, 3);
    expect(slope(r1)).toBeCloseTo(f2 - 2 * f0, 2);
    expect(f2 - 2 * f0).toBeCloseTo(0.763, 2);
    // No 4th partial in the signal.
    expect(s2).toBeLessThan(0.01);
  });

  it('keeps sub-cycle precision far into a session', () => {
    const buf = new Float32Array(N);
    const start = SR * 3600 * 5;
    const f = 82.41;
    for (let i = 0; i < N; i++) buf[i] = Math.sin(2 * Math.PI * f * ((start + i) / SR) + 0.25 * 2 * Math.PI);
    const row = demodulate(buf, SR, f, start);
    // sin is cos shifted back a quarter cycle, so a 0.25 cycle sine phase reads as 0.
    expect(Math.min(row.phase, 1 - row.phase)).toBeLessThan(0.002);
  });
});
