import { describe, expect, it } from 'vitest';
import { distanceToSegment, hitStroke, simplify, stepHalfTurn, type Stroke } from '../src/core/ink';

describe('ink geometry', () => {
  it('distance to a segment clamps to the endpoints', () => {
    expect(distanceToSegment([0.5, 1], [0, 0], [1, 0])).toBeCloseTo(1, 12);
    expect(distanceToSegment([2, 0], [0, 0], [1, 0])).toBeCloseTo(1, 12);
    expect(distanceToSegment([0, 0], [0, 0], [0, 0])).toBe(0);
  });

  it('hitStroke finds the topmost stroke near the point', () => {
    const a: Stroke = { tool: 'pen', color: '#000', width: 0.004, points: [[0.1, 0.1], [0.9, 0.1]] };
    const b: Stroke = { tool: 'highlight', color: '#ff0', width: 0.02, points: [[0.5, 0.05], [0.5, 0.3]] };
    expect(hitStroke([a, b], [0.5, 0.1], 0.01)).toBe(1);
    expect(hitStroke([a, b], [0.2, 0.105], 0.01)).toBe(0);
    expect(hitStroke([a, b], [0.2, 0.5], 0.01)).toBe(-1);
  });

  it('simplify keeps endpoints and drops close points', () => {
    const pts: [number, number][] = [[0, 0], [0.001, 0], [0.002, 0], [0.05, 0], [0.051, 0]];
    expect(simplify(pts, 0.01)).toEqual([[0, 0], [0.05, 0], [0.051, 0]]);
  });
});

describe('half-page turns', () => {
  it('forward: page 1 -> half (2 over 1) -> page 2; stops at the last page', () => {
    let v = stepHalfTurn({ kind: 'single', page: 1 }, 1, 3);
    expect(v).toEqual({ kind: 'half', top: 2, bottom: 1 });
    v = stepHalfTurn(v, 1, 3);
    expect(v).toEqual({ kind: 'single', page: 2 });
    expect(stepHalfTurn({ kind: 'single', page: 3 }, 1, 3)).toEqual({ kind: 'single', page: 3 });
  });

  it('backward from a half view returns to the lower page', () => {
    expect(stepHalfTurn({ kind: 'half', top: 2, bottom: 1 }, -1, 3)).toEqual({ kind: 'single', page: 1 });
    expect(stepHalfTurn({ kind: 'single', page: 1 }, -1, 3)).toEqual({ kind: 'single', page: 1 });
  });
});
