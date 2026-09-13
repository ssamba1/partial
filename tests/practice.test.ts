import { describe, expect, it } from 'vitest';
import { formatCents, formatDuration } from '../src/core/format';
import { bestStreak, dayKey, streak } from '../src/core/practice';

describe('streak', () => {
  // Local time, so the test means the same calendar day in every timezone.
  const today = new Date(2026, 8, 12, 23, 30);

  it('dayKey uses the local date, even late at night', () => {
    expect(dayKey(today)).toBe('2026-09-12');
  });

  it('best streak spans month boundaries', () => {
    expect(bestStreak({ '2026-08-30': 1, '2026-08-31': 1, '2026-09-01': 1, '2026-09-05': 1 })).toBe(3);
    expect(bestStreak({})).toBe(0);
  });

  it('counts consecutive days ending today', () => {
    expect(streak({ '2026-09-12': 60, '2026-09-11': 30, '2026-09-10': 5, '2026-09-08': 99 }, today)).toBe(3);
  });

  it('still counts when today has no practice yet', () => {
    expect(streak({ '2026-09-11': 30, '2026-09-10': 5 }, today)).toBe(2);
  });

  it('is zero after a missed day', () => {
    expect(streak({ '2026-09-10': 5 }, today)).toBe(0);
  });
});

describe('format', () => {
  it('durations and cents', () => {
    expect(formatDuration(125.9)).toBe('2:05');
    expect(formatDuration(-1)).toBe('0:00');
    expect(formatCents(12.4)).toBe('+12¢');
    expect(formatCents(-3.6)).toBe('−4¢');
    expect(formatCents(0.2)).toBe('0¢');
  });
});
