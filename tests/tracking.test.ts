import { describe, expect, it } from 'vitest';
import { InTuneLatch } from '../src/core/intonation';
import { DEFAULT_TUNING } from '../src/core/notes';
import { NoteLatch, ReadingSmoother, SMOOTHING } from '../src/core/tracking';

const cents = (c: number, base = 440) => base * Math.pow(2, c / 1200);

describe('NoteLatch', () => {
  it('holds the note while the pitch wobbles around the quarter tone', () => {
    const latch = new NoteLatch();
    latch.read(440, DEFAULT_TUNING);
    const midis = new Set<number>();
    for (let i = 0; i < 40; i++) midis.add(latch.read(cents(i % 2 ? 49 : 51), DEFAULT_TUNING).midi);
    expect([...midis]).toEqual([69]);
  });

  it('moves on after the pitch stays well away for three readings', () => {
    const latch = new NoteLatch();
    latch.read(440, DEFAULT_TUNING);
    expect(latch.read(cents(70), DEFAULT_TUNING).midi).toBe(69);
    expect(latch.read(cents(70), DEFAULT_TUNING).midi).toBe(69);
    expect(latch.read(cents(70), DEFAULT_TUNING).midi).toBe(70);
  });

  it('switches at once on a wide jump', () => {
    const latch = new NoteLatch();
    latch.read(440, DEFAULT_TUNING);
    expect(latch.read(cents(700), DEFAULT_TUNING).midi).toBe(76);
  });

  it('reports cents against the held note', () => {
    const latch = new NoteLatch();
    latch.read(440, DEFAULT_TUNING);
    const r = latch.read(cents(55), DEFAULT_TUNING);
    expect(r.midi).toBe(69);
    expect(r.cents).toBeCloseTo(55, 6);
  });
});

describe('ReadingSmoother', () => {
  // A slow glide within one note, sampled at the given frame rate.
  function run(fps: number, checkAtMs: number): number {
    const sm = new ReadingSmoother();
    const dt = 1000 / fps;
    let last = 0;
    for (let t = 0; t <= checkAtMs + 1e-6; t += dt) {
      const c = Math.min(40, (t / 1000) * 40);
      last = sm.push(cents(c), t, SMOOTHING.normal, DEFAULT_TUNING).displayCents;
    }
    return last;
  }

  it('display cents do not depend on the frame rate', () => {
    for (const at of [300, 600, 900]) {
      expect(Math.abs(run(60, at) - run(120, at)), `at ${at} ms`).toBeLessThan(0.2);
    }
    expect(Math.abs(run(30, 900) - run(120, 900))).toBeLessThan(0.5);
  });

  it('holds the old note through one octave-error frame', () => {
    const sm = new ReadingSmoother();
    let t = 0;
    const push = (f: number | null) => sm.push(f, (t += 16.7), SMOOTHING.normal, DEFAULT_TUNING);
    for (let i = 0; i < 6; i++) push(440);
    expect(push(880).note?.midi).toBe(69);
    expect(push(440).note?.midi).toBe(69);
    expect(push(null).note).toBeNull();
  });
});

describe('InTuneLatch', () => {
  it('does not chatter when readings jitter around the tolerance edge', () => {
    const latch = new InTuneLatch();
    let flips = 0;
    let prev = false;
    for (let i = 0; i < 100; i++) {
      const c = 5 + (i % 3 === 0 ? 0.9 : i % 3 === 1 ? -0.4 : 0.4);
      const { inTune } = latch.update(i === 0 ? 4 : c, 69, i / 60, 5);
      if (inTune !== prev) flips++;
      prev = inTune;
    }
    expect(flips).toBe(1);
  });

  it('leaves beyond tolerance + max(0.5, 0.3 x tolerance)', () => {
    const latch = new InTuneLatch();
    latch.update(0, 69, 0, 5);
    expect(latch.update(6.5, 69, 0.02, 5).inTune).toBe(true);
    expect(latch.update(6.6, 69, 0.04, 5).inTune).toBe(false);
    expect(latch.update(5.2, 69, 0.06, 5).inTune).toBe(false);
    const tight = new InTuneLatch();
    tight.update(0, 69, 0, 1);
    expect(tight.update(1.5, 69, 0.02, 1).inTune).toBe(true);
    expect(tight.update(1.6, 69, 0.04, 1).inTune).toBe(false);
  });

  it('short excursions keep the hold timer; long ones restart it', () => {
    const latch = new InTuneLatch(1.2, 0.15);
    latch.update(0, 69, 0, 5);
    latch.update(20, 69, 0.5, 5);
    const back = latch.update(0, 69, 0.6, 5);
    expect(back.hold).toBeCloseTo(0.6 / 1.2, 6);
    let fired = 0;
    for (let t = 0.6; t < 1.5; t += 0.05) if (latch.update(0, 69, t, 5).fire) fired++;
    expect(fired).toBe(1);

    const other = new InTuneLatch(1.2, 0.15);
    other.update(0, 69, 0, 5);
    other.update(20, 69, 0.5, 5);
    other.update(20, 69, 0.7, 5);
    expect(other.update(0, 69, 0.8, 5).hold).toBe(0);
  });

  it('resets on a new note or no reading', () => {
    const latch = new InTuneLatch();
    latch.update(0, 69, 0, 5);
    expect(latch.update(0, 70, 1, 5).hold).toBe(0);
    expect(latch.update(null, null, 1.1, 5).inTune).toBe(false);
  });
});
