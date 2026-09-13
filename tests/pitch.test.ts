import { describe, expect, it } from 'vitest';
import { detectPitch, PitchSmoother } from '../src/core/pitch';

const SR = 48000;
const N = 4096;

function tone(freq: number, harmonics: number[] = [1], amp = 0.5, phase = 0.3): Float32Array {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let v = 0;
    harmonics.forEach((a, h) => {
      v += a * Math.sin((2 * Math.PI * freq * (h + 1) * i) / SR + phase * (h + 1));
    });
    out[i] = amp * v;
  }
  return out;
}

function centsError(measured: number, truth: number): number {
  return 1200 * Math.log2(measured / truth);
}

// Deterministic PRNG so noise tests are reproducible.
function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('YIN detector', () => {
  it('pure sines from 41 Hz (E1) to 2093 Hz (C7) within 0.5 cent', () => {
    let worst = 0;
    for (let midi = 28; midi <= 96; midi++) {
      const f = 440 * Math.pow(2, (midi - 69) / 12);
      const r = detectPitch(tone(f), { sampleRate: SR });
      expect(r, `midi ${midi}`).not.toBeNull();
      worst = Math.max(worst, Math.abs(centsError(r!.frequency, f)));
    }
    expect(worst).toBeLessThan(0.5);
  });

  it('detuned tones report the detuning', () => {
    const f = 440 * Math.pow(2, 7 / 1200);
    const r = detectPitch(tone(f), { sampleRate: SR })!;
    expect(centsError(r.frequency, 440)).toBeCloseTo(7, 0);
  });

  it('harmonic-rich tones do not jump an octave', () => {
    // Weak fundamental, strong 2nd and 3rd harmonics (brass / reed-like).
    for (const f of [98, 196.0, 261.63, 440, 880]) {
      const r = detectPitch(tone(f, [0.3, 1, 0.8, 0.5, 0.3]), { sampleRate: SR })!;
      expect(r).not.toBeNull();
      expect(Math.abs(centsError(r.frequency, f))).toBeLessThan(5);
    }
  });

  it('tolerates moderate noise', () => {
    const rand = lcg(42);
    const f = 329.63;
    const frame = tone(f);
    for (let i = 0; i < N; i++) frame[i] += (rand() * 2 - 1) * 0.05;
    const r = detectPitch(frame, { sampleRate: SR })!;
    expect(r).not.toBeNull();
    expect(Math.abs(centsError(r.frequency, f))).toBeLessThan(3);
  });

  it('returns null for silence and white noise', () => {
    expect(detectPitch(new Float32Array(N), { sampleRate: SR })).toBeNull();
    const rand = lcg(7);
    const noise = new Float32Array(N).map(() => (rand() * 2 - 1) * 0.5);
    expect(detectPitch(noise, { sampleRate: SR })).toBeNull();
  });
});

describe('PitchSmoother', () => {
  it('returns the median and resets on note changes', () => {
    const s = new PitchSmoother(3);
    s.push(440);
    s.push(441);
    expect(s.push(439)).toBe(440);
    expect(s.push(660)).toBe(660);
    expect(s.push(null)).toBeNull();
  });
});
