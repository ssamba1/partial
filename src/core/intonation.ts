/**
 * Strobe display phase. A strobe tuner shows a pattern that drifts right when
 * sharp and left when flat, and stands still when exactly in tune; the drift
 * speed is proportional to the error. Returns the new phase in [0, 1).
 */
export function advanceStrobe(phase: number, cents: number, dtSeconds: number, bandsPerSecondPerCent = 0.08): number {
  const next = phase + cents * bandsPerSecondPerCent * dtSeconds;
  return ((next % 1) + 1) % 1;
}

export interface NoteStat {
  count: number;
  sum: number;
  sumSq: number;
}

export type Tendencies = Record<number, NoteStat>;

/** Adds one in-range reading (|cents| <= 50) for a pitch class. Returns a new object. */
export function addReading(t: Tendencies, pitchClass: number, cents: number): Tendencies {
  if (!Number.isFinite(cents) || Math.abs(cents) > 50) return t;
  const cur = t[pitchClass] ?? { count: 0, sum: 0, sumSq: 0 };
  return { ...t, [pitchClass]: { count: cur.count + 1, sum: cur.sum + cents, sumSq: cur.sumSq + cents * cents } };
}

export interface TendencySummary {
  pitchClass: number;
  count: number;
  mean: number;
  /** Standard deviation in cents: how steady the note is. */
  spread: number;
}

export function summarize(t: Tendencies, minCount = 1): TendencySummary[] {
  return Object.entries(t)
    .map(([pc, s]) => {
      const mean = s.sum / s.count;
      const variance = Math.max(0, s.sumSq / s.count - mean * mean);
      return { pitchClass: Number(pc), count: s.count, mean, spread: Math.sqrt(variance) };
    })
    .filter((s) => s.count >= minCount)
    .sort((a, b) => a.pitchClass - b.pitchClass);
}

export interface HeldNote {
  midi: number;
  start: number;
  end: number;
  meanCents: number;
  /** Cents drift from the first to the last third of the note. */
  drift: number;
}

/**
 * Groups a stream of (time, midi, cents) readings into held notes, like a
 * "sustained pitch history". Notes shorter than `minSeconds` are dropped.
 */
export function segmentNotes(
  readings: { t: number; midi: number | null; cents: number }[],
  minSeconds = 0.25,
  maxGap = 0.15,
): HeldNote[] {
  const notes: HeldNote[] = [];
  let cur: { midi: number; points: { t: number; cents: number }[] } | null = null;
  const flush = () => {
    if (!cur || cur.points.length < 2) return;
    const start = cur.points[0].t;
    const end = cur.points[cur.points.length - 1].t;
    if (end - start < minSeconds) return;
    const third = Math.max(1, Math.floor(cur.points.length / 3));
    const avg = (arr: { cents: number }[]) => arr.reduce((a, p) => a + p.cents, 0) / arr.length;
    notes.push({
      midi: cur.midi,
      start,
      end,
      meanCents: avg(cur.points),
      drift: avg(cur.points.slice(-third)) - avg(cur.points.slice(0, third)),
    });
  };
  for (const r of readings) {
    const last = cur?.points[cur.points.length - 1];
    if (r.midi === null || !cur || r.midi !== cur.midi || (last && r.t - last.t > maxGap)) {
      flush();
      cur = r.midi === null ? null : { midi: r.midi, points: [] };
    }
    cur?.points.push({ t: r.t, cents: r.cents });
  }
  flush();
  return notes;
}
