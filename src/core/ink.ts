export type InkTool = 'pen' | 'highlight';

export interface Stroke {
  tool: InkTool;
  color: string;
  /** Line width as a fraction of the page width, so ink scales with zoom. */
  width: number;
  /** Points normalised to the page: [x, y] with 0..1 on each axis. */
  points: [number, number][];
}

/** Distance from point p to segment ab, all in the same units. */
export function distanceToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Index of the topmost stroke within `radius` of the point, or -1. */
export function hitStroke(strokes: Stroke[], p: [number, number], radius: number): number {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const pts = strokes[i].points;
    const reach = radius + strokes[i].width / 2;
    if (pts.length === 1 && Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) <= reach) return i;
    for (let j = 1; j < pts.length; j++) {
      if (distanceToSegment(p, pts[j - 1], pts[j]) <= reach) return i;
    }
  }
  return -1;
}

/** Drops points closer than `minDistance` to the previous kept point, keeping the last point. */
export function simplify(points: [number, number][], minDistance: number): [number, number][] {
  if (points.length <= 2) return points.slice();
  const out: [number, number][] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(points[i][0] - last[0], points[i][1] - last[1]) >= minDistance) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

export type PageView = { kind: 'single'; page: number } | { kind: 'half'; top: number; bottom: number };

/**
 * Half-page turning: moving forward from page n first shows the top half of
 * n+1 above the bottom half of n, then the whole of n+1. Backward reverses it.
 */
export function stepHalfTurn(view: PageView, direction: 1 | -1, pageCount: number): PageView {
  if (view.kind === 'single') {
    if (direction === 1) return view.page < pageCount ? { kind: 'half', top: view.page + 1, bottom: view.page } : view;
    return view.page > 1 ? { kind: 'half', top: view.page, bottom: view.page - 1 } : view;
  }
  return { kind: 'single', page: direction === 1 ? view.top : view.bottom };
}
