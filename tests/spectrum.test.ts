import { describe, expect, it } from 'vitest';
import { harmonicLevels, magnitudeSpectrum } from '../src/core/spectrum';

describe('magnitudeSpectrum', () => {
  it('full-scale sine on a bin centre peaks near 0 dB at the right bin', () => {
    const n = 4096;
    const sr = 48000;
    const bin = 100;
    const f = (bin * sr) / n;
    const frame = new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * f * i) / sr));
    const spec = magnitudeSpectrum(frame);
    let peak = 0;
    for (let i = 1; i < spec.length; i++) if (spec[i] > spec[peak]) peak = i;
    expect(peak).toBe(bin);
    expect(spec[peak]).toBeGreaterThan(-1);
    expect(spec[peak]).toBeLessThan(1);
  });

  it('harmonicLevels ranks a louder 2nd harmonic above the 1st', () => {
    const n = 4096;
    const sr = 48000;
    const f0 = 220;
    const frame = new Float32Array(n).map(
      (_, i) => 0.2 * Math.sin((2 * Math.PI * f0 * i) / sr) + 0.6 * Math.sin((2 * Math.PI * 2 * f0 * i) / sr),
    );
    const h = harmonicLevels(magnitudeSpectrum(frame), sr, f0, 3);
    expect(h[1].db).toBeGreaterThan(h[0].db + 6);
    expect(h[2].db).toBeLessThan(h[0].db - 20);
  });
});
