import { describe, expect, it } from 'vitest';
import { angleDelta, dialSteps, holdRepeatDelay, nearClick, pointAngle } from '../src/core/gestures';
import { nearestString, STRING_INSTRUMENTS, stringFrequency } from '../src/core/instruments';
import { DEFAULT_TUNING, ratioToCents } from '../src/core/notes';
import { midiTrigger, triggerLabel } from '../src/core/midi';
import { staffNote } from '../src/core/staff';

const byId = (id: string) => STRING_INSTRUMENTS.find((i) => i.id === id)!;

describe('string instruments', () => {
  it('guitar low E is 82.41 Hz and high E two octaves up', () => {
    const g = byId('guitar');
    expect(stringFrequency(g, 0, DEFAULT_TUNING, false)).toBeCloseTo(440 * Math.pow(2, -29 / 12), 6);
    expect(stringFrequency(g, 5, DEFAULT_TUNING, false) / stringFrequency(g, 0, DEFAULT_TUNING, false)).toBeCloseTo(4, 6);
  });

  it('violin in pure fifths: G-D and D-A are exactly 3:2, A stays at A4', () => {
    const v = byId('violin');
    const f = (i: number) => stringFrequency(v, i, DEFAULT_TUNING, true);
    expect(f(2)).toBeCloseTo(440, 9);
    expect(f(2) / f(1)).toBeCloseTo(1.5, 9);
    expect(f(1) / f(0)).toBeCloseTo(1.5, 9);
    expect(f(3) / f(2)).toBeCloseTo(1.5, 9);
    // Pure G is about 3.9 cents below equal temperament.
    expect(ratioToCents(f(0) / stringFrequency(v, 0, DEFAULT_TUNING, false))).toBeCloseTo(-3.91, 2);
  });

  it('picks the nearest string', () => {
    const g = byId('guitar');
    const r = nearestString(112, g, DEFAULT_TUNING, false); // A2 is 110 Hz
    expect(r.index).toBe(1);
    expect(r.cents).toBeCloseTo(ratioToCents(112 / 110), 6);
  });
});

describe('gestures', () => {
  it('angleDelta wraps across 12 o’clock', () => {
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(-20);
    expect(angleDelta(0, 180)).toBe(180);
  });

  it('pointAngle is clockwise from the top', () => {
    expect(pointAngle(0, 0, 0, -1)).toBeCloseTo(0, 9);
    expect(pointAngle(0, 0, 1, 0)).toBeCloseTo(90, 9);
    expect(pointAngle(0, 0, 0, 1)).toBeCloseTo(180, 9);
    expect(pointAngle(0, 0, -1, 0)).toBeCloseTo(270, 9);
  });

  it('dialSteps keeps the remainder, both directions', () => {
    expect(dialSteps(25, 6)).toEqual({ steps: 4, remainder: 1 });
    const neg = dialSteps(-13, 6);
    expect(neg.steps).toBe(-2);
    expect(neg.remainder).toBeCloseTo(-1, 9);
  });

  it('hold repeat speeds up', () => {
    expect(holdRepeatDelay(0)).toBeGreaterThan(holdRepeatDelay(8));
    expect(holdRepeatDelay(8)).toBeGreaterThan(holdRepeatDelay(20));
  });

  it('nearClick window', () => {
    expect(nearClick(1.05, [1])).toBe(true);
    expect(nearClick(0.995, [1])).toBe(true);
    expect(nearClick(1.2, [1])).toBe(false);
    expect(nearClick(0.5, [])).toBe(false);
  });
});

describe('midi triggers', () => {
  it('note on, note off, control change', () => {
    expect(midiTrigger([0x90, 60, 100])).toBe('note:60');
    expect(midiTrigger([0x93, 60, 100])).toBe('note:60');
    expect(midiTrigger([0x90, 60, 0])).toBeNull(); // note on with velocity 0 is a note off
    expect(midiTrigger([0x80, 60, 64])).toBeNull();
    expect(midiTrigger([0xb0, 64, 127])).toBe('cc:64');
    expect(midiTrigger([0xb0, 64, 10])).toBeNull();
    expect(midiTrigger([0xf8])).toBeNull();
    expect(triggerLabel('cc:64')).toBe('Controller 64');
  });
});

describe('staff', () => {
  it('treble: E4 bottom line, F5 top line, middle C one ledger below', () => {
    expect(staffNote(64, 'treble').position).toBe(0);
    expect(staffNote(77, 'treble').position).toBe(8);
    const c4 = staffNote(60, 'treble');
    expect(c4.position).toBe(-2);
    expect(c4.ledgers).toEqual([-2]);
  });

  it('bass: G2 bottom line, middle C one ledger above', () => {
    expect(staffNote(43, 'bass').position).toBe(0);
    const c4 = staffNote(60, 'bass');
    expect(c4.position).toBe(10);
    expect(c4.ledgers).toEqual([10]);
  });

  it('accidentals follow the spelling preference', () => {
    expect(staffNote(61, 'treble')).toMatchObject({ position: -2, accidental: 1 });
    expect(staffNote(61, 'treble', true)).toMatchObject({ position: -1, accidental: -1 });
  });
});
