import { describe, expect, it } from 'vitest';
import { addReading, advanceStrobe, analyzeTake, segmentNotes, summarize } from '../src/core/intonation';
import { beatNoise, isBarMuted, isBeatRandomlyMuted, polyOffsets, tempoMarking } from '../src/core/rhythm';

describe('gap trainer and random muting', () => {
  it('2 bars on, 1 bar off', () => {
    expect([0, 1, 2, 3, 4, 5].map((b) => isBarMuted(b, 2, 1))).toEqual([false, false, true, false, false, true]);
    expect(isBarMuted(5, 2, 0)).toBe(false);
  });

  it('random muting is reproducible, spares beat 1, and roughly matches the percentage', () => {
    expect(isBeatRandomlyMuted(3, 0, 100, 1)).toBe(false);
    expect(isBeatRandomlyMuted(3, 2, 30, 7)).toBe(isBeatRandomlyMuted(3, 2, 30, 7));
    let muted = 0;
    const total = 4000;
    for (let bar = 0; bar < 1000; bar++) for (let beat = 1; beat <= 4; beat++) if (isBeatRandomlyMuted(bar, beat, 25, 42)) muted++;
    expect(muted / total).toBeGreaterThan(0.2);
    expect(muted / total).toBeLessThan(0.3);
  });

  it('beatNoise stays in [0,1)', () => {
    for (let i = 0; i < 500; i++) {
      const v = beatNoise(i, i * 3, 99);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('polyrhythm', () => {
  it('3 against a 2-second bar', () => {
    const o = polyOffsets(2, 3);
    expect(o).toHaveLength(3);
    expect(o[1]).toBeCloseTo(2 / 3, 12);
    expect(polyOffsets(2, 0)).toEqual([]);
  });
});

describe('tempo markings', () => {
  it('names common tempos', () => {
    expect(tempoMarking(60)).toBe('Larghetto');
    expect(tempoMarking(100)).toBe('Andante');
    expect(tempoMarking(130)).toBe('Allegro');
    expect(tempoMarking(390)).toBe('Prestissimo');
  });
});

describe('strobe', () => {
  it('stands still in tune and drifts by direction', () => {
    expect(advanceStrobe(0.3, 0, 1)).toBeCloseTo(0.3, 12);
    // Short step so the phase does not wrap around.
    expect(advanceStrobe(0.3, 5, 0.1)).toBeGreaterThan(0.3);
    expect(advanceStrobe(0.3, -5, 0.1)).toBeLessThan(0.3);
    expect(advanceStrobe(0.95, 10, 1)).toBeLessThan(1);
  });
});

describe('tendencies', () => {
  it('mean and spread per pitch class, ignoring wild readings', () => {
    let t = {};
    for (const c of [8, 12, 10]) t = addReading(t, 4, c);
    t = addReading(t, 4, 400);
    t = addReading(t, 9, -3);
    const s = summarize(t);
    const e = s.find((x) => x.pitchClass === 4)!;
    expect(e.count).toBe(3);
    expect(e.mean).toBeCloseTo(10, 9);
    expect(e.spread).toBeCloseTo(Math.sqrt(8 / 3), 9);
    expect(summarize(t, 2).map((x) => x.pitchClass)).toEqual([4]);
  });
});

describe('analyzeTake', () => {
  it('reports a sharp A then an in-tune C from a synthetic recording', async () => {
    const { detectPitch } = await import('../src/core/pitch');
    const { frequencyToNote } = await import('../src/core/notes');
    const sr = 48000;
    const seg = sr; // 1 s each
    const samples = new Float32Array(seg * 2);
    const fA = 440 * Math.pow(2, 20 / 1200);
    const fC = 523.2511306;
    for (let i = 0; i < seg; i++) samples[i] = 0.5 * Math.sin((2 * Math.PI * fA * i) / sr);
    for (let i = 0; i < seg; i++) samples[seg + i] = 0.5 * Math.sin((2 * Math.PI * fC * i) / sr);
    const report = analyzeTake(
      samples,
      sr,
      (frame) => {
        const p = detectPitch(frame, { sampleRate: sr });
        if (!p) return null;
        const n = frequencyToNote(p.frequency);
        return { midi: n.midi, cents: n.cents };
      },
      5,
    );
    const midis = report.notes.map((n) => n.midi);
    expect(midis).toEqual([69, 72]);
    expect(report.notes[0].meanCents).toBeCloseTo(20, 0);
    expect(Math.abs(report.notes[1].meanCents)).toBeLessThan(1);
    // Roughly half the voiced frames are in tune (the C), allowing for frames straddling the boundary.
    expect(report.inTune).toBeGreaterThan(0.4);
    expect(report.inTune).toBeLessThan(0.6);
  });
});

describe('segmentNotes', () => {
  it('splits held notes, measures drift, drops short blips', () => {
    const r: { t: number; midi: number | null; cents: number }[] = [];
    for (let i = 0; i <= 30; i++) r.push({ t: i * 0.02, midi: 69, cents: i / 3 }); // 0..10 cents over 0.6 s
    r.push({ t: 0.64, midi: null, cents: 0 });
    for (let i = 0; i < 4; i++) r.push({ t: 0.7 + i * 0.02, midi: 71, cents: 0 }); // 0.06 s blip
    const notes = segmentNotes(r);
    expect(notes).toHaveLength(1);
    expect(notes[0].midi).toBe(69);
    expect(notes[0].drift).toBeGreaterThan(5);
  });
});
