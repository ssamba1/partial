import { describe, expect, it } from 'vitest';
import { detectPitch } from '../src/core/pitch';
import { encodeWav, pitchShift, resample, timeStretch } from '../src/core/pitchshift';

const SR = 48000;
const tone = (f: number, seconds: number, harmonics = [1, 0.5, 0.25]) =>
  new Float32Array(Math.round(SR * seconds)).map((_, i) => harmonics.reduce((a, amp, h) => a + 0.3 * amp * Math.sin((2 * Math.PI * f * (h + 1) * i) / SR), 0));

const pitchAt = (x: Float32Array, start: number) => detectPitch(x.subarray(start, start + 4096), { sampleRate: SR })?.frequency ?? NaN;
const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

describe('encodeWav', () => {
  it('writes a valid mono 16-bit header and clamps samples', () => {
    const buf = encodeWav(new Float32Array([0, 1, -1, 2]), 44100);
    const v = new DataView(buf);
    const str = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    expect(str(0)).toBe('RIFF');
    expect(str(8)).toBe('WAVE');
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(40, true)).toBe(8);
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32768);
    expect(v.getInt16(50, true)).toBe(32767);
    expect(buf.byteLength).toBe(52);
  });
});

describe('resample', () => {
  it('keeps endpoints and length', () => {
    const r = resample(new Float32Array([0, 1, 2, 3]), 7);
    expect(r).toHaveLength(7);
    expect(r[0]).toBe(0);
    expect(r[6]).toBeCloseTo(3, 9);
    expect(r[3]).toBeCloseTo(1.5, 9);
  });
});

describe('timeStretch', () => {
  it('changes length but keeps pitch', () => {
    const x = tone(220, 1);
    const y = timeStretch(x, 1.5, SR);
    expect(y.length).toBe(Math.round(x.length * 1.5));
    expect(Math.abs(cents(pitchAt(y, 20000), 220))).toBeLessThan(5);
  });
});

describe('pitchShift', () => {
  it('shifts a harmonic tone up two semitones and keeps the duration', () => {
    const x = tone(220, 1.2);
    const y = pitchShift(x, 2, SR);
    expect(y.length).toBe(x.length);
    const expected = 220 * Math.pow(2, 2 / 12);
    for (const at of [8000, 24000, 40000]) expect(Math.abs(cents(pitchAt(y, at), expected))).toBeLessThan(8);
  });

  it('shifts down three semitones', () => {
    const y = pitchShift(tone(440, 1.2), -3, SR);
    expect(Math.abs(cents(pitchAt(y, 20000), 440 * Math.pow(2, -3 / 12)))).toBeLessThan(8);
  });

  it('zero is a copy', () => {
    const x = tone(330, 0.2);
    const y = pitchShift(x, 0, SR);
    expect(y).not.toBe(x);
    expect(y[100]).toBe(x[100]);
  });
});
