/**
 * Short non-speech cues for the tuner. Each returns its length in seconds so the
 * caller can keep the tracker from reading it.
 */

/** A 40 ms chirp: rising means play higher (flat), falling means play lower (sharp). */
export function playCue(ctx: BaseAudioContext, dest: AudioNode, when: number, rising: boolean, volume = 0.25): number {
  const duration = 0.04;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  const [from, to] = rising ? [700, 1100] : [1100, 700];
  osc.frequency.setValueAtTime(from, when);
  osc.frequency.exponentialRampToValueAtTime(to, when + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(volume * 0.3, when + 0.005);
  g.gain.linearRampToValueAtTime(0, when + duration);
  osc.connect(g);
  g.connect(dest);
  osc.start(when);
  osc.stop(when + duration + 0.01);
  return duration + 0.01;
}

/** A soft two-note chime for the in-tune lock. */
export function playChime(ctx: BaseAudioContext, dest: AudioNode, when: number, volume = 0.25): number {
  const notes = [1318.5, 1760];
  notes.forEach((f, i) => {
    const start = when + i * 0.09;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(volume * 0.2, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
    osc.connect(g);
    g.connect(dest);
    osc.start(start);
    osc.stop(start + 0.27);
  });
  return 0.09 + 0.27;
}
