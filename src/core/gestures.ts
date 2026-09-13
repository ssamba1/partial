/** Signed smallest difference between two angles in degrees, in (-180, 180]. */
export function angleDelta(fromDeg: number, toDeg: number): number {
  let d = (toDeg - fromDeg) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function pointAngle(cx: number, cy: number, x: number, y: number): number {
  // 0 degrees at 12 o'clock, increasing clockwise.
  return ((Math.atan2(x - cx, cy - y) * 180) / Math.PI + 360) % 360;
}

/**
 * Rotary dial accumulator: turning the dial clockwise raises the value one step
 * per `degreesPerStep`. Returns the whole steps to apply and the leftover degrees.
 */
export function dialSteps(accumulatedDeg: number, degreesPerStep: number): { steps: number; remainder: number } {
  const steps = Math.trunc(accumulatedDeg / degreesPerStep);
  return { steps, remainder: accumulatedDeg - steps * degreesPerStep };
}

/** Press-and-hold repeat: interval shrinks the longer a button is held. */
export function holdRepeatDelay(repeatCount: number): number {
  if (repeatCount < 4) return 260;
  if (repeatCount < 12) return 110;
  return 45;
}

/**
 * Times of clicks the app has scheduled (metronome, click tracks, exercise player),
 * kept sorted and pruned by time rather than a fixed-size ring, so a dense bar of
 * subdivisions and poly pulses cannot push out clicks that have not sounded yet.
 */
export class ClickLog {
  private list: number[] = [];

  constructor(private keepPast = 2) {}

  add(when: number): void {
    const l = this.list;
    let i = l.length;
    while (i > 0 && l[i - 1] > when) i--;
    if (l[i - 1] === when) return;
    l.splice(i, 0, when);
  }

  /** Drop clicks older than `keepPast` seconds before `now`. */
  prune(now: number): void {
    let n = 0;
    while (n < this.list.length && this.list[n] < now - this.keepPast) n++;
    if (n) this.list.splice(0, n);
  }

  /** Clicks after pruning to `now`, oldest first. */
  times(now: number): readonly number[] {
    this.prune(now);
    return this.list;
  }

  clear(): void {
    this.list = [];
  }
}

/**
 * True when a click is in the analysis frame that ends at `now`, used to ignore
 * the metronome in the mic. The frame holds the last `frameDuration` seconds of
 * audio, and a click reaches the mic `latency` seconds after it is scheduled, so
 * the frame is gated when a click time falls in
 * [now - frameDuration - latency - after, now - latency + before].
 */
export function nearClick(
  now: number,
  clickTimes: ArrayLike<number>,
  before = 0.01,
  after = 0.08,
  latency = 0,
  frameDuration = 0,
): boolean {
  const from = now - frameDuration - latency - after;
  const to = now - latency + before;
  for (let i = 0; i < clickTimes.length; i++) {
    const t = clickTimes[i];
    if (t >= from && t <= to) return true;
  }
  return false;
}
