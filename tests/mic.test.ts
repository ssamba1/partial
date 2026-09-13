import { describe, expect, it } from 'vitest';
import {
  calibratedThreshold,
  channelIndex,
  meterPosition,
  micWarnings,
  peakAbs,
  routeChannels,
  SignalStatus,
  zeroCrossingRate,
} from '../src/core/mic';
import { acRms, detectPitch, rms } from '../src/core/pitch';

function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('channel choice', () => {
  it('picks one input of a stereo interface, and the mix for mono inputs', () => {
    expect(channelIndex('mix', 2)).toBeNull();
    expect(channelIndex('left', 2)).toBe(0);
    expect(channelIndex('right', 2)).toBe(1);
    expect(channelIndex('right', 1)).toBeNull();
    expect(channelIndex('left', undefined)).toBeNull();
  });

  it('an instrument on input 1 with input 2 silent loses half its level in the mix but not when picked', () => {
    const left = new Float32Array(4096).map((_, i) => 0.4 * Math.sin((2 * Math.PI * 196 * i) / 48000));
    const right = new Float32Array(4096);
    const mixed = routeChannels([left, right], 'mix');
    const picked = routeChannels([left, right], 'left');
    expect(rms(mixed) / rms(left)).toBeCloseTo(0.5, 3);
    expect(picked).toBe(left);
    // Out-of-phase inputs cancel in the mix; one side still reads.
    const inverted = left.map((v) => -v);
    expect(detectPitch(routeChannels([left, inverted], 'mix'), { sampleRate: 48000 })).toBeNull();
    expect(detectPitch(routeChannels([left, inverted], 'right'), { sampleRate: 48000 })).not.toBeNull();
  });
});

describe('mic warnings', () => {
  it('flags processing the browser left on', () => {
    expect(micWarnings({ label: 'Built-in Microphone', settings: { autoGainControl: false, noiseSuppression: false, echoCancellation: false, sampleRate: 48000 } })).toEqual([]);
    const w = micWarnings({ label: 'Mic', settings: { autoGainControl: true, noiseSuppression: true } });
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('automatic gain');
    expect(w[0]).toContain('noise suppression');
  });

  it('flags Bluetooth headsets by name or narrowband sample rate', () => {
    expect(micWarnings({ label: 'AirPods Pro', settings: {} })[0]).toContain('Bluetooth');
    expect(micWarnings({ label: 'Headset (WH-1000XM4 Hands-Free AG Audio)', settings: {} })[0]).toContain('Bluetooth');
    expect(micWarnings({ label: 'USB Audio', settings: { sampleRate: 16000 } })[0]).toContain('Bluetooth');
    expect(micWarnings({ label: 'USB Audio', settings: { sampleRate: 44100 } })).toEqual([]);
  });
});

describe('room calibration', () => {
  it('sets the threshold to three times the noise RMS', () => {
    const rand = lcg(5);
    const levels: number[] = [];
    for (let f = 0; f < 120; f++) {
      const frame = new Float32Array(4096).map(() => (rand() * 2 - 1) * 0.004);
      levels.push(acRms(frame));
    }
    const noise = 0.004 / Math.sqrt(3);
    expect(calibratedThreshold(levels)).toBeCloseTo(3 * noise, 4);
  });

  it('never goes below 0.001', () => {
    expect(calibratedThreshold([0, 0, 0])).toBe(0.001);
    expect(calibratedThreshold([])).toBe(0.001);
  });
});

describe('level meter', () => {
  it('maps RMS to a -60 to 0 dB scale', () => {
    expect(meterPosition(1)).toBe(1);
    expect(meterPosition(0.001)).toBeCloseTo(0, 6);
    expect(meterPosition(0.01)).toBeCloseTo(1 / 3, 6);
    expect(meterPosition(0)).toBe(0);
  });

  it('peak and zero-crossing helpers', () => {
    expect(peakAbs([0.1, -0.995, 0.3])).toBe(0.995);
    const sine = new Float32Array(48000).map((_, i) => Math.sin((2 * Math.PI * 20 * i) / 48000 + 0.1) + 0.3 * 0);
    expect(zeroCrossingRate(sine, 48000)).toBeCloseTo(20, 0);
  });

  it('explains silence, quiet input, too-low pitch and clipping', () => {
    const st = new SignalStatus();
    const base = { level: 0, peak: 0, threshold: 0.008, hasPitch: false };
    expect(st.update({ ...base, time: 0 }).message).toBe('');
    expect(st.update({ ...base, time: 3.1 }).message).toBe('No signal');

    st.reset();
    st.update({ ...base, level: 0.005, time: 10 });
    expect(st.update({ ...base, level: 0.005, time: 10.5 }).message).toBe('');
    expect(st.update({ ...base, level: 0.005, time: 11.1 }).message).toBe('Too quiet');
    expect(st.update({ ...base, level: 0.001, time: 11.2 }).message).toBe('');

    st.reset();
    st.update({ ...base, level: 0.05, roughHz: 20, time: 20 });
    expect(st.update({ ...base, level: 0.05, roughHz: 20, time: 21.2 }).message).toBe('Too low for the tuner');
    expect(st.update({ ...base, level: 0.05, hasPitch: true, time: 21.3 }).message).toBe('');

    expect(st.update({ ...base, peak: 0.99, level: 0.3, hasPitch: true, time: 30 }).clip).toBe(true);
    expect(st.update({ ...base, level: 0.3, hasPitch: true, time: 30.8 }).clip).toBe(true);
    expect(st.update({ ...base, level: 0.3, hasPitch: true, time: 31.1 }).clip).toBe(false);
  });
});
