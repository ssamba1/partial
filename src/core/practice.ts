/** Local calendar date as YYYY-MM-DD, so practice after dark still counts for today. */
export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
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
