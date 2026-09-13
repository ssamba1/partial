import { describe, expect, it } from 'vitest';
import { buildExercise } from '../src/core/exercises';

describe('buildExercise', () => {
  it('C major one octave up', () => {
    expect(buildExercise('major', 60, 1, 'up')).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
  });

  it('up and down does not repeat the top note', () => {
    expect(buildExercise('majorArpeggio', 60, 1, 'upDown')).toEqual([60, 64, 67, 72, 67, 64, 60]);
  });

  it('two octaves of A harmonic minor down', () => {
    const notes = buildExercise('harmonicMinor', 57, 2, 'down');
    expect(notes[0]).toBe(81);
    expect(notes[notes.length - 1]).toBe(57);
    expect(notes).toHaveLength(15);
    expect(notes).toContain(80); // G sharp
  });

  it('scale in thirds pairs each degree with the third above', () => {
    expect(buildExercise('thirds', 60, 1, 'up').slice(0, 6)).toEqual([60, 64, 62, 65, 64, 67]);
    expect(buildExercise('thirds', 60, 1, 'up').at(-1)).toBe(72);
  });

  it('clamps octaves to 1..3', () => {
    expect(buildExercise('chromatic', 60, 9, 'up')).toHaveLength(37);
    expect(buildExercise('chromatic', 60, 0, 'up')).toHaveLength(13);
  });
});
