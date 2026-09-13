import { describe, expect, it } from 'vitest';
import { formatCents, formatDuration } from '../src/core/format';
import { streak } from '../src/core/practice';

describe('streak', () => {
  const today = new Date('2026-09-12T15:00:00Z');

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
