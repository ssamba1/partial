/** In-place iterative radix-2 FFT. `re` and `im` must have the same power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n & (n - 1)) throw new Error('FFT length must be a power of two');
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Hann-windowed magnitude spectrum in dBFS (full-scale sine ~ 0 dB). Length = frame.length / 2. */
export function magnitudeSpectrum(frame: ArrayLike<number>): Float32Array {
  let n = 1;
  while (n * 2 <= frame.length) n *= 2;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    re[i] = frame[i] * w;
  }
  fft(re, im);
  const out = new Float32Array(n / 2);
  // Hann coherent gain is 0.5, so a full-scale sine peaks at n/4.
  const scale = 4 / n;
  for (let i = 0; i < n / 2; i++) {
    const mag = Math.hypot(re[i], im[i]) * scale;
    out[i] = 20 * Math.log10(mag + 1e-12);
  }
  return out;
}

export interface Harmonic {
  number: number;
  frequency: number;
  db: number;
}

/** Level of each harmonic of f0, taking the max bin within +-2 bins of the expected position. */
export function harmonicLevels(spectrumDb: Float32Array, sampleRate: number, f0: number, count = 8): Harmonic[] {
  const binHz = sampleRate / (spectrumDb.length * 2);
  const out: Harmonic[] = [];
  for (let h = 1; h <= count; h++) {
    const f = f0 * h;
    const bin = Math.round(f / binHz);
    if (bin >= spectrumDb.length - 2) break;
    let db = -Infinity;
    for (let b = Math.max(0, bin - 2); b <= bin + 2; b++) db = Math.max(db, spectrumDb[b]);
    out.push({ number: h, frequency: f, db });
  }
  return out;
}
