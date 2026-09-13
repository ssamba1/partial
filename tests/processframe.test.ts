import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../src/core/notes';
import { detectPitch } from '../src/core/pitch';
import { createFrameState, processFrame, recordingReader, SMOOTHING, type FrameOptions } from '../src/core/tracking';
import { STRING_INSTRUMENTS, stringSearchRange } from '../src/core/instruments';
import { analyzeTake } from '../src/core/intonation';

const SR = 48000;
const N = 4096;

/** A frame of a harmonic tone ending at time `t` seconds, so consecutive frames are continuous. */
function tone(freq: number, t: number, amps = [1, 0.5, 0.33], gain = 0.3): Float32Array {
  const out = new Float32Array(N);
  const start = Math.round(t * SR) - N;
  for (let i = 0; i < N; i++) {
    const x = (start + i) / SR;
    let v = 0;
    amps.forEach((a, k) => (v += a * Math.sin(2 * Math.PI * freq * (k + 1) * x)));
    out[i] = v * gain;
  }
  return out;
}
const silence = () => new Float32Array(N);
const opts = (extra: Partial<FrameOptions> = {}): FrameOptions => ({
  sampleRate: SR,
  tuning: DEFAULT_TUNING,
  profile: SMOOTHING.normal,
  minRms: 0.008,
  minFrequency: 30,
  ...extra,
});

describe('processFrame (01-109)', () => {
  it('reads a steady note and holds it through a short dropout, then lets go', () => {
    const st = createFrameState();
    let t = 0;
    for (let i = 0; i < 20; i++) processFrame(st, tone(440, (t += 1 / 60)), t * 1000, opts());
    const held = processFrame(st, silence(), (t += 1 / 60) * 1000, opts());
    expect(held.held).toBe(true);
    expect(held.note?.midi).toBe(69);
    const gone = processFrame(st, silence(), (t + 0.5) * 1000, opts());
    expect(gone.note).toBeNull();
    expect(gone.held).toBe(false);
  });

  it('does not analyse gated frames and holds the last reading through them', () => {
    const st = createFrameState();
    let t = 0;
    for (let i = 0; i < 10; i++) processFrame(st, tone(330, (t += 1 / 60)), t * 1000, opts());
    const r = processFrame(st, tone(330, (t += 1 / 60)), t * 1000, opts({ gated: true }));
    expect(r.analysed).toBe(false);
    expect(r.held).toBe(true);
  });

  it('analyses the first loud frame after silence, with no idle skipping (01-108)', () => {
    const st = createFrameState();
    let t = 0;
    for (let i = 0; i < 7; i++) expect(processFrame(st, silence(), (t += 1 / 60) * 1000, opts()).analysed).toBe(false);
    const first = processFrame(st, tone(440, (t += 1 / 60)), t * 1000, opts());
    expect(first.analysed).toBe(true);
    expect(first.note?.midi).toBe(69);
  });

  it('settles to within 2 cents in the same time at 60 and 120 frames per second', () => {
    const settle = (fps: number) => {
      const st = createFrameState();
      let t = 0;
      for (let i = 0; i < fps / 2; i++) processFrame(st, tone(440, (t += 1 / fps)), t * 1000, opts());
      const target = 440 * Math.pow(2, 20 / 1200);
      for (let i = 0; i < fps * 2; i++) {
        const r = processFrame(st, tone(target, (t += 1 / fps)), t * 1000, opts());
        if (Math.abs(r.displayCents - 20) <= 2) return (i + 1) / fps;
      }
      return Infinity;
    };
    const a = settle(60);
    const b = settle(120);
    expect(a).toBeLessThan(0.5);
    expect(Math.abs(a - b)).toBeLessThan(0.06);
  });

  it('keeps the note name through a wobble at the quarter tone (hysteresis)', () => {
    const st = createFrameState();
    let t = 0;
    const names = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const c = i < 10 ? 40 : i % 2 ? 48 : 53;
      const r = processFrame(st, tone(440 * Math.pow(2, c / 1200), (t += 1 / 60)), t * 1000, opts());
      if (r.note) names.add(r.note.midi);
    }
    expect([...names]).toEqual([69]);
  });

  it('gives the recorder the same readings as the live pipeline (01-107)', () => {
    const hop = 1024;
    const samples = new Float32Array(SR);
    const f = 440 * Math.pow(2, 25 / 1200);
    for (let i = 0; i < samples.length; i++) samples[i] = 0.3 * Math.sin((2 * Math.PI * f * i) / SR);
    const reader = recordingReader(SR, hop, { tuning: DEFAULT_TUNING, profile: SMOOTHING.normal, minRms: 0.008, minFrequency: 30 });
    const report = analyzeTake(samples, SR, reader, 5, N, hop);
    expect(report.notes[0].midi).toBe(69);
    expect(report.notes[0].meanCents).toBeCloseTo(25, 0);
  });
});

describe('strings mode search range (01-105)', () => {
  it('spans 0.7 x the lowest to 1.5 x the highest string', () => {
    const bass = STRING_INSTRUMENTS.find((i) => i.id === 'bass4')!;
    const r = stringSearchRange(bass, DEFAULT_TUNING, false);
    expect(r.min).toBeCloseTo(41.2 * 0.7, 0);
    expect(r.max).toBeCloseTo(98 * 1.5, 0);
  });

  it('reads a bass low E with strong upper harmonics at its fundamental', () => {
    const bass = STRING_INSTRUMENTS.find((i) => i.id === 'bass4')!;
    const r = stringSearchRange(bass, DEFAULT_TUNING, false);
    const e1 = 41.2034;
    // Weak fundamental, strong 2nd to 4th harmonics, as from a bright pickup.
    const frame = tone(e1, 1, [0.3, 1, 0.8, 0.6, 0.4], 0.2);
    const p = detectPitch(frame, { sampleRate: SR, minFrequency: r.min, maxFrequency: r.max });
    expect(p).not.toBeNull();
    expect(Math.abs(1200 * Math.log2(p!.frequency / e1))).toBeLessThan(5);
  });
});
