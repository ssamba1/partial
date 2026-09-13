import { ratioToCents } from './notes';

export interface PartialReading {
  /** Partial number: 1 is the fundamental. */
  n: number;
  /** Frequency of that partial. */
  target: number;
  /** Cents from the partial, positive = sharp. */
  cents: number;
  /** Cents the partial itself sits from the nearest equal-tempered note of the fundamental's tuning. */
  vsEqual: number;
  /** Semitones of that nearest equal-tempered note above the fundamental. */
  semitones: number;
}

/** Cents a natural partial sits from equal temperament: partial 5 is about -13.7, partial 7 about -31.2. */
export function partialVsEqual(n: number): number {
  const cents = ratioToCents(n);
  return cents - Math.round(cents / 100) * 100;
}

/** Nearest natural partial of `fundamental` to a played frequency, up to `maxPartial`. */
export function nearestPartial(frequency: number, fundamental: number, maxPartial = 16): PartialReading | null {
  if (!(frequency > 0) || !(fundamental > 0)) return null;
  const n = Math.max(1, Math.min(maxPartial, Math.round(frequency / fundamental)));
  // Round in cents too, so a note between two high partials picks the closer one on a log scale.
  let best = n;
  for (const k of [n - 1, n + 1]) {
    if (k >= 1 && k <= maxPartial && Math.abs(ratioToCents(frequency / (k * fundamental))) < Math.abs(ratioToCents(frequency / (best * fundamental)))) best = k;
  }
  const target = best * fundamental;
  return { n: best, target, cents: ratioToCents(frequency / target), vsEqual: partialVsEqual(best), semitones: Math.round(ratioToCents(best) / 100) };
}
