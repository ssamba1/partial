/**
 * Pure mappings for the tuner displays: how many cents the ring, bar and trace
 * span, where a reading lands on each, and how numbers are written.
 */

export type TunerScale = '50' | '20' | '10' | 'auto';

/** Degrees of ring sweep at the edge of the scale, either side of the top. */
export const RING_SWEEP_DEGREES = 120;

/**
 * Auto scale: zooms from ±50 to ±10 once the reading has stayed within 10 cents
 * for `dwellSeconds`, and zooms back out as soon as it leaves or the note stops.
 */
export class AutoScale {
  private since: number | null = null;
  range = 50;

  constructor(
    private zoomCents = 10,
    private dwellSeconds = 0.5,
  ) {}

  update(cents: number | null, time: number): number {
    if (cents === null || !Number.isFinite(cents) || Math.abs(cents) > this.zoomCents) {
      this.since = null;
      this.range = 50;
      return this.range;
    }
    this.since ??= time;
    if (time - this.since >= this.dwellSeconds) this.range = this.zoomCents;
    return this.range;
  }

  reset(): void {
    this.since = null;
    this.range = 50;
  }
}

/** Cents either side of in tune that the displays span for a scale setting. */
export function scaleRange(scale: TunerScale, auto: AutoScale | null = null): number {
  if (scale === 'auto') return auto?.range ?? 50;
  const n = Number(scale);
  return n === 10 || n === 20 ? n : 50;
}

const clampTo = (cents: number, range: number) => Math.max(-range, Math.min(range, cents));

/** Ring angle for a reading: 0 at the top, clockwise when sharp. */
export function centsToDegrees(cents: number, range: number): number {
  return (clampTo(cents, range) / range) * RING_SWEEP_DEGREES;
}

/** Bar position in percent: 50 is in tune, 0 and 100 the scale ends. */
export function centsToPercent(cents: number, range: number): number {
  return 50 + (clampTo(cents, range) / range) * 50;
}

/** Trace height in pixels for a reading, with `pad` pixels kept clear at top and bottom. */
export function centsToY(cents: number, range: number, height: number, pad = 4): number {
  return height / 2 - (clampTo(cents, range) / range) * (height / 2 - pad);
}

export interface TracePoint {
  t: number;
  cents: number | null;
  /** Note shown for this reading, or null when there was none. */
  midi: number | null;
}

/**
 * Splits the trace points between `end - seconds` and `end` into runs of one
 * note, so the line breaks where the note changes or the sound stops and each
 * run can carry its note name. The point just before the window is kept so a
 * run enters from the left edge.
 */
export function traceRuns(points: readonly TracePoint[], end: number, seconds: number): { midi: number; points: { t: number; cents: number }[] }[] {
  const runs: { midi: number; points: { t: number; cents: number }[] }[] = [];
  let cur: { midi: number; points: { t: number; cents: number }[] } | null = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.t > end) break;
    const next = points[i + 1];
    if (p.t < end - seconds && !(next && next.t >= end - seconds)) continue;
    if (p.cents === null || p.midi === null || !Number.isFinite(p.cents)) {
      cur = null;
      continue;
    }
    if (!cur || cur.midi !== p.midi) {
      cur = { midi: p.midi, points: [] };
      runs.push(cur);
    }
    cur.points.push({ t: p.t, cents: p.cents });
  }
  return runs;
}

/** Keeps a scrolled-back trace inside the buffer: 0 is the newest window, and it never scrolls past the oldest point. */
export function clampTraceOffset(offset: number, newest: number, oldest: number, seconds: number): number {
  const max = Math.max(0, newest - oldest - seconds);
  return Math.max(0, Math.min(max, Number.isFinite(offset) ? offset : 0));
}

/** Tick positions around the ring: ten steps a side, long ticks at halves and ends. */
export function ringTicks(range: number): { cents: number; long: boolean }[] {
  const step = range / 10;
  const out: { cents: number; long: boolean }[] = [];
  for (let k = -10; k <= 10; k++) out.push({ cents: k * step, long: k % 5 === 0 });
  return out;
}

/** Numbered ticks on the ring: half and full scale either side. */
export function ringLabels(range: number): number[] {
  return [-range, -range / 2, range / 2, range];
}

/** Bar scale labels: every 20 cents at ±50, every half scale when zoomed. */
export function barLabels(range: number): number[] {
  const step = range === 50 ? 20 : range / 2;
  const out: number[] = [];
  for (let c = -Math.floor(range / step) * step; c <= range + 1e-9; c += step) out.push(Math.round(c * 10) / 10);
  return out;
}

/** A signed scale label such as "+20" or "−20", with a plain 0. */
export function signedLabel(cents: number): string {
  if (cents === 0) return '0';
  return `${cents > 0 ? '+' : '−'}${Math.abs(cents)}`;
}

export type DecimalCents = 'auto' | 'on' | 'off';

/** Decimal cents are on by default for fine tolerances. */
export function useDecimalCents(mode: DecimalCents, tolerance: number): boolean {
  return mode === 'on' || (mode === 'auto' && tolerance <= 2);
}

/** Size of a deviation in words, such as "6¢ sharp" or "0.4¢ flat". */
export function centsText(cents: number, decimals: boolean): string {
  const size = decimals ? Math.abs(cents).toFixed(1) : String(Math.abs(Math.round(cents)));
  if (Number(size) === 0) return decimals ? '0.0¢' : '0¢';
  return `${size}¢ ${cents > 0 ? 'sharp' : 'flat'}`;
}

/** Frequency with two decimals below 100 Hz, where one decimal is several cents. */
export function formatHz(hz: number): string {
  return hz < 100 ? hz.toFixed(2) : hz.toFixed(1);
}

/** Custom in-tune tolerance: 0.5 to 25 cents in half-cent steps. */
export function clampTolerance(v: unknown, fallback = 5): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0.5, Math.min(25, Math.round(n * 2) / 2));
}

/** Seconds a note must stay in tune before it locks: 0.5 to 5. */
export function clampHoldSeconds(v: unknown, fallback = 1.2): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0.5, Math.min(5, Math.round(n * 10) / 10));
}

/** "2 s ago" for a kept reading. */
export function agoText(seconds: number): string {
  return `${Math.max(0, Math.floor(seconds))} s ago`;
}

/** Signed deviation such as "+0.4¢" or "−3¢", for next to the "in tune" badge. */
export function signedCents(cents: number, decimals: boolean): string {
  const size = decimals ? Math.abs(cents).toFixed(1) : String(Math.abs(Math.round(cents)));
  if (Number(size) === 0) return `${size}¢`;
  return `${cents > 0 ? '+' : '−'}${size}¢`;
}
