/**
 * Offline pitch shifting that keeps duration: stretch time with WSOLA
 * (waveform-similarity overlap-add), then resample back to the original length.
 * Good enough for practice listening (hearing a take a semitone or two up or down);
 * not a studio-quality shifter.
 */

/** Linear-interpolation resample to `outLength` samples. */
export function resample(input: Float32Array, outLength: number): Float32Array {
  const out = new Float32Array(outLength);
  if (!input.length || !outLength) return out;
  const ratio = (input.length - 1) / Math.max(1, outLength - 1);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const j = Math.floor(pos);
    const frac = pos - j;
    const a = input[j];
    const b = input[Math.min(input.length - 1, j + 1)];
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/**
 * WSOLA time stretch. `factor` > 1 makes the signal longer.
 * frameSize and overlap are in samples; searchRadius limits how far we look
 * for the best-aligned segment, which keeps waveforms phase-continuous.
 */
export function timeStretch(input: Float32Array, factor: number, sampleRate: number): Float32Array {
  const frame = Math.round(sampleRate * 0.04); // 40 ms
  const hopOut = Math.round(frame / 2);
  const hopIn = hopOut / factor;
  const search = Math.round(sampleRate * 0.012); // 12 ms
  const outLength = Math.round(input.length * factor);
  const out = new Float32Array(outLength + frame);
  const norm = new Float32Array(outLength + frame);
  const window = new Float32Array(frame);
  for (let i = 0; i < frame; i++) window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frame - 1)));

  let prevEnd = 0; // input position following the last copied frame, for similarity matching
  for (let outPos = 0, k = 0; outPos < outLength; outPos += hopOut, k++) {
    const nominal = Math.round(k * hopIn);
    let best = nominal;
    if (k > 0) {
      // Find the offset whose start best matches the natural continuation of the previous frame.
      let bestScore = -Infinity;
      const from = Math.max(0, nominal - search);
      const to = Math.min(input.length - frame, nominal + search);
      for (let cand = from; cand <= to; cand += 2) {
        let score = 0;
        for (let i = 0; i < hopOut; i += 4) {
          const ref = prevEnd + i < input.length ? input[prevEnd + i] : 0;
          score += ref * input[cand + i];
        }
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
    }
    if (best + frame > input.length) break;
    for (let i = 0; i < frame; i++) {
      out[outPos + i] += input[best + i] * window[i];
      norm[outPos + i] += window[i];
    }
    prevEnd = best + hopOut;
  }
  for (let i = 0; i < outLength; i++) if (norm[i] > 1e-6) out[i] /= norm[i];
  return out.subarray(0, outLength);
}

/** Mono 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const text = (offset: number, s: string) => [...s].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/** Shift pitch by `semitones` while keeping the same number of samples. */
export function pitchShift(input: Float32Array, semitones: number, sampleRate: number): Float32Array {
  if (semitones === 0) return input.slice();
  const ratio = Math.pow(2, semitones / 12);
  const stretched = timeStretch(input, ratio, sampleRate);
  return resample(stretched, input.length);
}
