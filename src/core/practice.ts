/** Local calendar date as YYYY-MM-DD, so practice after dark still counts for today. */
export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Counts only the time a note is sounding, so a tuner left open on a music
 * stand does not log an hour of practice, and says how long it has been silent.
 */
export class VoicedClock {
  seconds = 0;
  private last: number | null = null;
  private lastVoiced: number | null = null;

  constructor(private maxStep = 0.25) {}

  start(time: number): void {
    this.seconds = 0;
    this.last = time;
    this.lastVoiced = time;
  }

  frame(time: number, voiced: boolean): void {
    if (this.last === null) this.start(time);
    if (voiced) {
      this.seconds += Math.max(0, Math.min(this.maxStep, time - this.last!));
      this.lastVoiced = time;
    }
    this.last = time;
  }

  silentFor(time: number): number {
    return this.lastVoiced === null ? 0 : Math.max(0, time - this.lastVoiced);
  }

  reset(): void {
    this.seconds = 0;
    this.last = null;
    this.lastVoiced = null;
  }
}

/** Consecutive local days with any practice, ending today (or yesterday, if today has none yet). */
export function streak(log: Record<string, number>, today = new Date()): number {
  const d = new Date(today);
  if (!log[dayKey(d)]) d.setDate(d.getDate() - 1);
  let n = 0;
  while (log[dayKey(d)]) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** Longest run of consecutive days in the log. */
export function bestStreak(log: Record<string, number>): number {
  const days = Object.keys(log)
    .filter((k) => log[k] > 0)
    .sort();
  let best = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const k of days) {
    const [y, m, d] = k.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    if (prev) {
      const next = new Date(prev);
      next.setDate(next.getDate() + 1);
      run = dayKey(next) === k ? run + 1 : 1;
    } else {
      run = 1;
    }
    best = Math.max(best, run);
    prev = date;
  }
  return best;
}
