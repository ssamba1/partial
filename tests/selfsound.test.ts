import { describe, expect, it } from 'vitest';
import { nearClick } from '../src/core/gestures';
import { STRING_INSTRUMENTS, StringFollower, stringFrequency, suggestString, tuneHint } from '../src/core/instruments';
import { DEFAULT_TUNING, ratioToCents } from '../src/core/notes';
import { ClickAudibility, FollowState, matchesReference, referenceOctaves, SelfSounds } from '../src/core/selfsound';
import { OnsetGate, ReadingSmoother, SMOOTHING } from '../src/core/tracking';

const guitar = STRING_INSTRUMENTS.find((i) => i.id === 'guitar')!;
const cents = (c: number, base: number) => base * Math.pow(2, c / 1200);

describe('metronome gate with frame length and latency', () => {
  const frame = 4096 / 48000;

  it('gates a frame that still holds a click from 90 ms ago', () => {
    // The old window stopped 80 ms after the click, but the 85 ms frame still contains it.
    expect(nearClick(1.09, [1])).toBe(false);
    expect(nearClick(1.09, [1], 0.01, 0.08, 0, frame)).toBe(true);
    expect(nearClick(1.2, [1], 0.01, 0.08, 0, frame)).toBe(false);
  });

  it('waits for the output latency before gating', () => {
    const latency = 0.2; // Bluetooth output
    expect(nearClick(1.05, [1], 0.01, 0.08, latency, frame)).toBe(false);
    expect(nearClick(1.25, [1], 0.01, 0.08, latency, frame)).toBe(true);
    expect(nearClick(1.3, [1], 0.01, 0.08, latency, frame)).toBe(true);
  });

  it('gates any frame whose window overlaps a click', () => {
    for (let now = 0.8; now < 1.4; now += 0.005) {
      const frameStart = now - frame;
      const overlaps = 1 >= frameStart - 0.08 && 1 <= now + 0.01;
      expect(nearClick(now, [1], 0.01, 0.08, 0, frame), `now ${now}`).toBe(overlaps);
    }
  });
});

describe('ClickAudibility', () => {
  const clicks = [1, 1.6, 2.2, 2.8, 3.4];
  function run(levelAt: (t: number) => number, latency = 0) {
    const a = new ClickAudibility();
    for (let t = 0.9; t < 4; t += 1 / 60) a.observe(t, levelAt(t), clicks.filter((c) => c <= t), latency);
    return a.state;
  }

  it('stops gating when clicks never raise the mic level (headphones)', () => {
    expect(run(() => 0.05)).toBe('inaudible');
  });

  it('keeps gating when each click raises the level', () => {
    const level = (t: number) => (clicks.some((c) => t > c && t < c + 0.085) ? 0.2 : 0.02);
    expect(run(level)).toBe('heard');
  });

  it('looks for the rise after the output latency', () => {
    const latency = 0.15;
    const level = (t: number) => (clicks.some((c) => t > c + latency && t < c + latency + 0.085) ? 0.2 : 0.02);
    expect(run(level, latency)).toBe('heard');
  });

  it('is unknown until four clicks have been checked', () => {
    const a = new ClickAudibility();
    for (let t = 0.9; t < 1.5; t += 1 / 60) a.observe(t, 0.05, [1], 0);
    expect(a.state).toBe('unknown');
  });
});

describe('reference tones', () => {
  it('matches a clean reading within 3 cents of a sounding reference', () => {
    expect(matchesReference(cents(2, 440), 0.99, [440])).toBe(true);
    expect(matchesReference(cents(5, 440), 0.99, [440])).toBe(false);
    expect(matchesReference(440, 0.9, [440])).toBe(false);
    expect(matchesReference(440, 0.99, [0])).toBe(false);
  });

  it('raises low references by octaves', () => {
    expect(referenceOctaves(41.2, 'same')).toBe(0);
    expect(referenceOctaves(41.2, 'up1')).toBe(1);
    expect(referenceOctaves(41.2, 'up2')).toBe(2);
    expect(referenceOctaves(41.2, 'auto')).toBe(2); // 164.8 Hz
    expect(referenceOctaves(58.27, 'auto')).toBe(1); // 116.5 Hz
    expect(referenceOctaves(110, 'auto')).toBe(0);
  });

  it('gates frames that contain a short app sound', () => {
    const s = new SelfSounds();
    s.add(2, 0.2);
    expect(s.inFrame(2.1, 0.085)).toBe(true);
    expect(s.inFrame(2.28, 0.085)).toBe(true);
    expect(s.inFrame(2.3, 0.085)).toBe(false);
    expect(s.inFrame(1.99, 0.085)).toBe(false);
    expect(s.inFrame(2.05, 0.085, 0.1)).toBe(false);
  });
});

describe('FollowState', () => {
  it('starts after the note is held and releases 0.6 s after it stops', () => {
    const f = new FollowState();
    const starts: number[] = [];
    let stoppedAt: number | null = null;
    for (let t = 0; t < 3; t += 0.02) {
      const midi = t < 1 ? 69 : null;
      const step = f.update(midi, t);
      if (step.start !== undefined) starts.push(step.start);
      if (step.stop !== undefined && stoppedAt === null) stoppedAt = t;
    }
    expect(starts).toEqual([69]);
    expect(stoppedAt).not.toBeNull();
    expect(stoppedAt!).toBeGreaterThanOrEqual(1.58);
    expect(stoppedAt!).toBeLessThan(1.66);
    expect(f.midi).toBeNull();
  });

  it('moves to a new note and stops the old one', () => {
    const f = new FollowState();
    for (let t = 0; t < 0.5; t += 0.02) f.update(69, t);
    let step = {};
    for (let t = 0.5; t < 1; t += 0.02) {
      const s = f.update(71, t);
      if (s.start !== undefined) step = s;
    }
    expect(step).toEqual({ start: 71, stop: 69 });
  });
});

describe('strings mode', () => {
  it('a G string 260 cents flat stays the G string and says tune up', () => {
    const follower = new StringFollower();
    const g = stringFrequency(guitar, 3, DEFAULT_TUNING, false);
    follower.update(g, 0, guitar, DEFAULT_TUNING, false);
    const flat = cents(-260, g);
    // Nearest-string alone would read this as the D string, 240 cents sharp.
    const plain = ratioToCents(flat / stringFrequency(guitar, 2, DEFAULT_TUNING, false));
    expect(plain).toBeCloseTo(240, 0);
    let r = follower.update(flat, 1000, guitar, DEFAULT_TUNING, false);
    for (let t = 1000; t < 2000; t += 16) r = follower.update(flat, t, guitar, DEFAULT_TUNING, false);
    expect(r.index).toBe(3);
    expect(r.cents).toBeCloseTo(-260, 3);
    expect(tuneHint(r.cents)).toBe('Tune up 2.6 semitones');
  });

  it('switches after 300 ms near another string', () => {
    const follower = new StringFollower();
    const d = stringFrequency(guitar, 2, DEFAULT_TUNING, false);
    follower.update(stringFrequency(guitar, 3, DEFAULT_TUNING, false), 0, guitar, DEFAULT_TUNING, false);
    expect(follower.update(d, 1000, guitar, DEFAULT_TUNING, false).index).toBe(3);
    expect(follower.update(d, 1200, guitar, DEFAULT_TUNING, false).index).toBe(3);
    expect(follower.update(d, 1300, guitar, DEFAULT_TUNING, false).index).toBe(2);
  });

  it('tune hints only beyond 50 cents', () => {
    expect(tuneHint(40)).toBeNull();
    expect(tuneHint(80)).toBe('Tune down 80 cents');
    expect(tuneHint(-150)).toBe('Tune up 1.5 semitones');
  });

  it('suggests the string that is actually being played', () => {
    const d = stringFrequency(guitar, 2, DEFAULT_TUNING, false);
    expect(suggestString(cents(10, d), guitar, 3, DEFAULT_TUNING, false)).toBe(2);
    expect(suggestString(cents(-100, stringFrequency(guitar, 3, DEFAULT_TUNING, false)), guitar, 3, DEFAULT_TUNING, false)).toBeNull();
    expect(suggestString(cents(-250, stringFrequency(guitar, 3, DEFAULT_TUNING, false)), guitar, 3, DEFAULT_TUNING, false)).toBeNull();
  });

  it('smoothed frequency is steadier than the median-filtered one', () => {
    const smoother = new ReadingSmoother();
    let seed = 5;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296) * 2 - 1;
    const raw: number[] = [];
    const smooth: number[] = [];
    for (let i = 0; i < 300; i++) {
      const r = smoother.push(cents(rand() * 6, 196), i * (1000 / 60), SMOOTHING.normal, DEFAULT_TUNING);
      if (i < 30) continue;
      raw.push(ratioToCents(r.frequency! / 196));
      smooth.push(ratioToCents(r.displayFrequency! / 196));
    }
    const sd = (xs: number[]) => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
    };
    expect(sd(smooth)).toBeLessThan(sd(raw) * 0.7);
  });
});

describe('OnsetGate', () => {
  it('ignores the sharp start of a pluck for 120 ms', () => {
    const gate = new OnsetGate();
    const counted: number[] = [];
    for (let t = 0; t < 400; t += 1000 / 60) {
      // Silence, then a pluck at 100 ms whose pitch glides from +15 to 0 cents over 150 ms.
      const level = t < 100 ? 0.0005 : 0.2 * Math.exp(-(t - 100) / 2000);
      const c = t < 100 ? null : Math.max(0, 15 * (1 - (t - 100) / 150));
      const ignore = gate.update(level, t);
      if (c !== null && !ignore) counted.push(c);
    }
    expect(counted.length).toBeGreaterThan(0);
    // Only the tail of the glide reaches the stats.
    expect(Math.max(...counted)).toBeLessThan(5);
  });

  it('a steady note does not trigger it', () => {
    const gate = new OnsetGate();
    let any = false;
    for (let t = 0; t < 500; t += 16) any = gate.update(0.1 + 0.01 * Math.sin(t), t) || any;
    expect(any).toBe(false);
  });
});
