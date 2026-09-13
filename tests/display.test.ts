import { describe, expect, it } from 'vitest';
import {
  agoText,
  AutoScale,
  barLabels,
  centsText,
  centsToDegrees,
  centsToPercent,
  centsToY,
  clampHoldSeconds,
  clampTolerance,
  formatHz,
  ringLabels,
  ringTicks,
  scaleRange,
  signedCents,
  signedLabel,
  useDecimalCents,
} from '../src/core/display';
import { InTuneLatch } from '../src/core/intonation';
import { mergeSettings } from '../src/store/settings';

describe('display scale', () => {
  it('maps the scale ends to the ring sweep, bar ends and trace edges', () => {
    expect(centsToDegrees(50, 50)).toBe(120);
    expect(centsToDegrees(-10, 10)).toBe(-120);
    expect(centsToDegrees(5, 10)).toBe(60);
    expect(centsToDegrees(30, 10)).toBe(120);
    expect(centsToPercent(0, 20)).toBe(50);
    expect(centsToPercent(-20, 20)).toBe(0);
    expect(centsToPercent(10, 20)).toBe(75);
    expect(centsToY(10, 10, 100, 4)).toBe(4);
    expect(centsToY(-99, 10, 100, 4)).toBe(96);
    expect(centsToY(0, 50, 100)).toBe(50);
  });

  it('at ±10 a 1 cent error moves the ring five times further than at ±50', () => {
    expect(centsToDegrees(1, 10) / centsToDegrees(1, 50)).toBeCloseTo(5, 9);
  });

  it('fixed settings give their range; auto starts wide', () => {
    expect(scaleRange('50')).toBe(50);
    expect(scaleRange('20')).toBe(20);
    expect(scaleRange('10')).toBe(10);
    expect(scaleRange('auto')).toBe(50);
  });

  it('auto zooms to ±10 after 500 ms within 10 cents and back out at once', () => {
    const auto = new AutoScale();
    expect(auto.update(4, 0)).toBe(50);
    expect(auto.update(-6, 0.3)).toBe(50);
    expect(auto.update(3, 0.5)).toBe(10);
    expect(scaleRange('auto', auto)).toBe(10);
    expect(auto.update(12, 0.6)).toBe(50);
    expect(auto.update(2, 0.7)).toBe(50);
    expect(auto.update(null, 1.3)).toBe(50);
    expect(auto.update(2, 1.4)).toBe(50);
  });

  it('ring ticks and labels follow the range', () => {
    expect(ringTicks(50).length).toBe(21);
    expect(ringTicks(50).filter((t) => t.long).map((t) => t.cents)).toEqual([-50, -25, 0, 25, 50]);
    expect(ringLabels(50)).toEqual([-50, -25, 25, 50]);
    expect(ringLabels(10)).toEqual([-10, -5, 5, 10]);
    expect(ringLabels(20)).toEqual([-20, -10, 10, 20]);
  });

  it('bar labels every 20 cents with a sign', () => {
    expect(barLabels(50)).toEqual([-40, -20, 0, 20, 40]);
    expect(barLabels(20)).toEqual([-20, -10, 0, 10, 20]);
    expect(barLabels(10)).toEqual([-10, -5, 0, 5, 10]);
    expect(barLabels(50).map(signedLabel)).toEqual(['−40', '−20', '0', '+20', '+40']);
  });
});

describe('readout precision', () => {
  it('decimal cents default on at 2 cents or finer', () => {
    expect(useDecimalCents('auto', 2)).toBe(true);
    expect(useDecimalCents('auto', 5)).toBe(false);
    expect(useDecimalCents('on', 10)).toBe(true);
    expect(useDecimalCents('off', 1)).toBe(false);
  });

  it('writes cents with or without a decimal', () => {
    expect(centsText(6.26, false)).toBe('6¢ sharp');
    expect(centsText(-0.44, true)).toBe('0.4¢ flat');
    expect(centsText(0.02, true)).toBe('0.0¢');
    expect(centsText(-0.3, false)).toBe('0¢');
  });

  it('keeps a signed number next to in tune', () => {
    expect(signedCents(0.44, true)).toBe('+0.4¢');
    expect(signedCents(-3.2, false)).toBe('−3¢');
    expect(signedCents(0.2, false)).toBe('0¢');
  });

  it('two decimals of Hz below 100 Hz', () => {
    expect(formatHz(41.2034)).toBe('41.20');
    expect(formatHz(99.996)).toBe('100.00');
    expect(formatHz(440.04)).toBe('440.0');
  });
});

describe('custom tolerance and hold time', () => {
  it('tolerance is clamped to 0.5 to 25 in half cents', () => {
    expect(clampTolerance(0.1)).toBe(0.5);
    expect(clampTolerance(3.3)).toBe(3.5);
    expect(clampTolerance(40)).toBe(25);
    expect(clampTolerance('x')).toBe(5);
  });

  it('hold time is clamped to 0.5 to 5 s', () => {
    expect(clampHoldSeconds(0)).toBe(0.5);
    expect(clampHoldSeconds(2.34)).toBe(2.3);
    expect(clampHoldSeconds(9)).toBe(5);
    expect(clampHoldSeconds(undefined)).toBe(1.2);
  });

  it('stored settings are brought into range', () => {
    const s = mergeSettings({ tolerance: 100, tunerHoldSeconds: 0.1 });
    expect(s.tolerance).toBe(25);
    expect(s.tunerHoldSeconds).toBe(0.5);
    expect(mergeSettings({}).tunerScale).toBe('50');
  });

  it('the lock fires after the chosen hold time', () => {
    const latch = new InTuneLatch(1.2);
    latch.setHoldSeconds(3);
    let firedAt: number | null = null;
    for (let t = 0; t <= 4; t += 0.05) {
      if (latch.update(1, 69, t, 5).fire) firedAt = t;
    }
    expect(firedAt).not.toBeNull();
    expect(firedAt!).toBeGreaterThanOrEqual(3 - 1e-9);
    expect(firedAt!).toBeLessThan(3.06);
  });

  it('kept readings say how long ago', () => {
    expect(agoText(2.7)).toBe('2 s ago');
    expect(agoText(-1)).toBe('0 s ago');
  });
});
