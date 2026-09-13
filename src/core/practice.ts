export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Consecutive UTC days with any practice, ending today (or yesterday, if today has none yet). */
export function streak(log: Record<string, number>, today = new Date()): number {
  const d = new Date(today);
  if (!log[dayKey(d)]) d.setUTCDate(d.getUTCDate() - 1);
  let n = 0;
  while (log[dayKey(d)]) {
    n++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return n;
}
