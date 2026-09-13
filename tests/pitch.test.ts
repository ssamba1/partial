import { describe, expect, it } from 'vitest';
import {
  detectPitch,
  detectPitchAdaptive,
  differenceFunction,
  differenceFunctionDirect,
  frameSizeFor,
  median,
  pitchStats,
  PitchSmoother,
} from '../src/core/pitch';

const SR = 48000;
const N = 4096;

function tone(freq: number, harmonics: number[] = [1], amp = 0.5, phase = 0.3, sr = SR, n = N): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    harmonics.forEach((a, h) => {
      v += a * Math.sin((2 * Math.PI * freq * (h + 1) * i) / sr + phase * (h + 1));
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
  for (const sr of [44100, 48000, 88200, 96000]) {
    it(`pure sines from 41 Hz (E1) to 2093 Hz (C7) within 0.5 cent at ${sr} Hz`, () => {
      const n = frameSizeFor(sr);
      let worst = 0;
      for (let midi = 28; midi <= 96; midi++) {
        const f = 440 * Math.pow(2, (midi - 69) / 12);
        const r = detectPitch(tone(f, [1], 0.5, 0.3, sr, n), { sampleRate: sr });
        expect(r, `midi ${midi}`).not.toBeNull();
        worst = Math.max(worst, Math.abs(centsError(r!.frequency, f)));
      }
      expect(worst).toBeLessThan(0.5);
    });
  }

  it('frame size covers 30 Hz at every common rate', () => {
    expect(frameSizeFor(44100)).toBe(4096);
    expect(frameSizeFor(48000)).toBe(4096);
    expect(frameSizeFor(88200)).toBe(8192);
    expect(frameSizeFor(96000)).toBe(8192);
    expect(frameSizeFor(48000, 1)).toBe(32768);
  });

  it('5-string low B (30.87 Hz) at 44.1 kHz is exact or null, never a quantized lag', () => {
    const sr = 44100;
    const n = frameSizeFor(sr);
    for (const f of [30.87, 30.5, 30.2, 29.5, 25]) {
      const r = detectPitch(tone(f, [1], 0.5, 0.3, sr, n), { sampleRate: sr, minFrequency: 30 });
      if (r) expect(Math.abs(centsError(r.frequency, f)), `${f} Hz`).toBeLessThan(0.5);
    }
    expect(detectPitch(tone(30.87, [1], 0.5, 0.3, sr, n), { sampleRate: sr })).not.toBeNull();
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

  it('a DC offset on silence does not pass the level gate or run the lag search', () => {
    const before = pitchStats.differenceRuns;
    const rand = lcg(3);
    const frame = new Float32Array(N).map(() => 0.02 + (rand() * 2 - 1) * 0.0005);
    expect(detectPitch(frame, { sampleRate: SR, minRms: 0.008 })).toBeNull();
    expect(pitchStats.differenceRuns).toBe(before);
    // The same offset under a real tone still reads correctly.
    const withTone = tone(220).map((v) => v + 0.02);
    expect(Math.abs(centsError(detectPitch(withTone, { sampleRate: SR })!.frequency, 220))).toBeLessThan(0.5);
  });

  it('FFT difference function matches the direct sum', () => {
    const rand = lcg(11);
    const frame = tone(97.3, [1, 0.5, 0.25]).map((v) => v + (rand() * 2 - 1) * 0.1);
    const lags = 1601;
    const window = N - lags;
    const fast = new Float32Array(lags + 1);
    const slow = new Float32Array(lags + 1);
    differenceFunction(frame, window, lags, fast);
    differenceFunctionDirect(frame, window, lags, slow);
    for (let tau = 0; tau <= lags; tau++) {
      expect(Math.abs(fast[tau] - slow[tau]), `tau ${tau}`).toBeLessThan(1e-3 * Math.max(1, slow[tau]));
    }
  });

  it('FFT difference function is much faster on noise and a 41 Hz tone', () => {
    const rand = lcg(19);
    const lags = 1601;
    const window = N - lags;
    const out = new Float32Array(lags + 1);
    const msPerFrame = (fn: typeof differenceFunction, frame: Float32Array) => {
      for (let i = 0; i < 3; i++) fn(frame, window, lags, out);
      const runs = 20;
      const t0 = performance.now();
      for (let i = 0; i < runs; i++) fn(frame, window, lags, out);
      return (performance.now() - t0) / runs;
    };
    for (const [name, frame] of [['noise', new Float32Array(N).map(() => (rand() * 2 - 1) * 0.1)], ['41 Hz', tone(41.2)]] as const) {
      const before = msPerFrame(differenceFunctionDirect, frame);
      const after = msPerFrame(differenceFunction, frame);
      console.log(`difference function, ${name}: direct ${before.toFixed(2)} ms, FFT ${after.toFixed(2)} ms per frame`);
      // The measured gap is far larger than this; the margin keeps a loaded machine from failing the test.
      expect(after * 3).toBeLessThan(before);
    }
  });

  it('short second pass catches a step from A5 to B5 in fewer frames', () => {
    const a5 = 880;
    const b5 = 440 * Math.pow(2, 14 / 12);
    const total = 60000;
    const step = 20000;
    const signal = new Float32Array(total);
    let phase = 0;
    for (let i = 0; i < total; i++) {
      phase += (2 * Math.PI * (i < step ? a5 : b5)) / SR;
      signal[i] = 0.5 * Math.sin(phase);
    }
    const hop = 800; // one 60 Hz frame at 48 kHz
    const framesUntil = (detect: typeof detectPitch) => {
      let frames = 0;
      for (let end = N; end <= total; end += hop) {
        if (end <= step) continue;
        frames++;
        const r = detect(signal.subarray(end - N, end), { sampleRate: SR });
        if (r && Math.abs(centsError(r.frequency, b5)) < 30) return frames;
      }
      return Infinity;
    };
    const plain = framesUntil(detectPitch);
    const adaptive = framesUntil(detectPitchAdaptive);
    expect(adaptive).toBeLessThan(plain);
    // The fine pass needs 1024 new samples, which is the third 800-sample hop.
    expect(adaptive).toBeLessThanOrEqual(3);
  });

  it('second pass keeps accuracy on steady high notes', () => {
    for (const f of [440, 880, 1760]) {
      const r = detectPitchAdaptive(tone(f, [1, 0.4, 0.2]), { sampleRate: SR })!;
      expect(Math.abs(centsError(r.frequency, f))).toBeLessThan(1);
    }
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

  it('a single octave-error frame never reaches the output', () => {
    const s = new PitchSmoother(5, 3);
    const out = [440, 440, 440, 440, 440, 880, 440].map((v) => s.push(v));
    expect(out).not.toContain(880);
    expect(out[out.length - 1]).toBe(440);
  });

  it('a real jump is shown once it has lasted the confirm count', () => {
    const s = new PitchSmoother(5, 3);
    expect(s.push(440)).toBe(440);
    expect(s.push(660)).toBe(440);
    expect(s.push(660)).toBe(440);
    expect(s.push(660)).toBe(660);
  });

  it('even-length median averages the two middle values', () => {
    expect(median([440, 441])).toBe(440.5);
    expect(median([441, 439, 440])).toBe(440);
    const s = new PitchSmoother(5);
    s.push(440);
    expect(s.push(441)).toBe(440.5);
  });
});
