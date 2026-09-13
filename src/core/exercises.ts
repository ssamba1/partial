export type Pattern = 'major' | 'naturalMinor' | 'harmonicMinor' | 'melodicMinor' | 'chromatic' | 'majorArpeggio' | 'minorArpeggio' | 'thirds' | 'pentatonic';

export const PATTERNS: { id: Pattern; label: string; steps: number[] }[] = [
  { id: 'major', label: 'Major scale', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'naturalMinor', label: 'Natural minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'harmonicMinor', label: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'melodicMinor', label: 'Melodic minor (ascending)', steps: [0, 2, 3, 5, 7, 9, 11] },
  { id: 'pentatonic', label: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  { id: 'chromatic', label: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { id: 'majorArpeggio', label: 'Major arpeggio', steps: [0, 4, 7] },
  { id: 'minorArpeggio', label: 'Minor arpeggio', steps: [0, 3, 7] },
  { id: 'thirds', label: 'Major scale in thirds', steps: [0, 2, 4, 5, 7, 9, 11] },
];

export type Direction = 'up' | 'down' | 'upDown';

/** Notes of a pattern ascending from the root over `octaves`, ending on the top root. */
function ascending(pattern: Pattern, root: number, octaves: number): number[] {
  const steps = PATTERNS.find((p) => p.id === pattern)!.steps;
  const notes: number[] = [];
  for (let o = 0; o < octaves; o++) for (const s of steps) notes.push(root + o * 12 + s);
  notes.push(root + octaves * 12);
  if (pattern !== 'thirds') return notes;
  // In thirds: each scale degree followed by the degree two above it (C E, D F, E G ...).
  const out: number[] = [];
  for (let i = 0; i + 2 < notes.length; i++) out.push(notes[i], notes[i + 2]);
  out.push(notes[notes.length - 1]);
  return out;
}

/** MIDI note sequence for an exercise. Up-down does not repeat the top note. */
export function buildExercise(pattern: Pattern, root: number, octaves: number, direction: Direction): number[] {
  const up = ascending(pattern, root, Math.max(1, Math.min(3, Math.floor(octaves))));
  if (direction === 'up') return up;
  const down = [...up].reverse();
  if (direction === 'down') return down;
  return [...up, ...down.slice(1)];
}
