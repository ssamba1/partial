/**
 * Conductor beat patterns as the horizontal place of each beat's ictus (the point where
 * the beat lands), from -1 (far left) to 1 (far right), all at the bottom of the pattern.
 * The numbers are this app's reading of word descriptions, not measured positions:
 * 2, 3 and 4 from Toby Rush, https://www.tobyrush.com/book/text/beg/beg01.html
 * ("both ictus points slightly to the right" in 2; in 3 "beat one middle, beat two far right,
 * beat three in between"; in 4 the second beat "to the left of the first", then sweeping right
 * for beats three and four).
 * 6 (Italian style) from Tim Reynish, http://timreynish.com/conducting/conducting-articles/directing-techniques.php
 * ("Down - left - left Right - right - centre (and up)").
 * 5 is not included: no source describing it was found.
 */
export const CONDUCTOR_PATTERNS: Record<number, number[]> = {
  2: [0.15, 0.35],
  3: [0, 0.9, 0.45],
  4: [0, -0.7, 0.8, 0.35],
  6: [0, -0.4, -0.8, 0.4, 0.8, 0.1],
};

/**
 * Ball position during a beat: x moves from this beat's ictus to the next one while
 * y rebounds up and falls back, so the ball touches the bottom exactly on each beat.
 * `phase` is 0 at the beat and 1 at the next. y is 0 at the bottom and 1 at the top.
 */
export function conductorPoint(beats: number, beat: number, phase: number): { x: number; y: number } | null {
  const pattern = CONDUCTOR_PATTERNS[beats];
  if (!pattern) return null;
  const p = Math.min(1, Math.max(0, phase));
  const from = pattern[beat % beats];
  const to = pattern[(beat + 1) % beats];
  // Ease the sideways move so the ball slows into each ictus.
  const e = p * p * (3 - 2 * p);
  return { x: from + (to - from) * e, y: Math.sin(Math.PI * p) };
}
