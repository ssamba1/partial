/**
 * Sounds the app makes itself (metronome clicks, reference tones, chimes and
 * cues) reach the microphone too. These helpers decide when the tuner should
 * not trust what it hears.
 */

export type ClickHearing = 'unknown' | 'heard' | 'inaudible';

/**
 * Learns whether the mic hears the metronome at all. For each of the first
 * `clicks` clicks it compares the frame level just before the click arrives with
 * the loudest frame in the 30 ms after. Fewer than two rises over 3 dB means the
 * click is not reaching the mic (headphones), so gating only costs readings.
 */
export class ClickAudibility {
  private levels: { t: number; level: number }[] = [];
  private checked = new Set<number>();
  private rises = 0;
  private startedAt: number | null = null;
  state: ClickHearing = 'unknown';

  constructor(
    private clicks = 4,
    private riseDb = 3,
    private windowSeconds = 0.03,
  ) {}

  /** Feed one analysis frame: its end time, level, the recent click times and the output latency. */
  observe(now: number, level: number, clickTimes: ArrayLike<number>, latency = 0): ClickHearing {
    this.startedAt ??= now;
    this.levels.push({ t: now, level });
    while (this.levels.length && now - this.levels[0].t > 1) this.levels.shift();
    if (this.state !== 'unknown') return this.state;
    for (let i = 0; i < clickTimes.length; i++) {
      const click = clickTimes[i];
      if (click < this.startedAt || this.checked.has(click)) continue;
      const arrival = click + latency;
      // Wait until the frames covering the window have arrived.
      if (now < arrival + this.windowSeconds + 0.02) continue;
      this.checked.add(click);
      let before: number | null = null;
      let after = 0;
      for (const f of this.levels) {
        if (f.t <= arrival && f.t > arrival - 0.15) before = f.level;
        else if (f.t > arrival && f.t <= arrival + this.windowSeconds + 0.02) after = Math.max(after, f.level);
      }
      if (before === null) continue;
      if (after >= Math.max(before, 1e-5) * Math.pow(10, this.riseDb / 20)) this.rises++;
      if (this.checked.size >= this.clicks) {
        this.state = this.rises >= 2 ? 'heard' : 'inaudible';
        break;
      }
    }
    return this.state;
  }

  reset(): void {
    this.levels = [];
    this.checked.clear();
    this.rises = 0;
    this.startedAt = null;
    this.state = 'unknown';
  }
}

/**
 * True when a reading is almost certainly the app's own reference tone: within
 * `cents` of a sounding reference and cleaner than a played note usually is.
 */
export function matchesReference(frequency: number, clarity: number, references: readonly number[], cents = 3, minClarity = 0.97): boolean {
  if (clarity < minClarity) return false;
  return references.some((r) => r > 0 && Math.abs(1200 * Math.log2(frequency / r)) <= cents);
}

/** Short app sounds by audio time, so the tracker can skip frames that contain them. */
export class SelfSounds {
  private spans: { start: number; end: number }[] = [];

  add(start: number, duration: number): void {
    this.spans.push({ start, end: start + duration });
    if (this.spans.length > 32) this.spans.shift();
  }

  /** True when any sound overlaps the frame ending at `now` (after `latency` to reach the mic). */
  inFrame(now: number, frameDuration: number, latency = 0): boolean {
    const from = now - frameDuration - latency;
    const to = now - latency;
    return this.spans.some((s) => s.start <= to && s.end >= from);
  }
}

export type ReferenceOctave = 'same' | 'up1' | 'up2' | 'auto';

/** Octaves to raise a reference tone so small speakers can play it. Auto lifts it to at least 110 Hz. */
export function referenceOctaves(frequency: number, mode: ReferenceOctave): number {
  if (mode === 'up1') return 1;
  if (mode === 'up2') return 2;
  if (mode === 'same' || !(frequency > 0)) return 0;
  let k = 0;
  while (k < 3 && frequency * Math.pow(2, k) < 110) k++;
  return k;
}

/**
 * The drone that follows the note you hold: starts once a note has lasted
 * `confirmSeconds`, and stops once no note has been heard for
 * `releaseSeconds`, so it cannot keep itself going through the speakers after
 * you stop playing.
 */
export class FollowState {
  midi: number | null = null;
  private candidate: number | null = null;
  private candidateSince = 0;
  private lastVoiced = 0;

  constructor(
    private confirmSeconds = 0.35,
    private releaseSeconds = 0.6,
  ) {}

  update(midi: number | null, time: number): { start?: number; stop?: number } {
    if (midi === null) {
      if (this.midi !== null && time - this.lastVoiced >= this.releaseSeconds) return this.reset();
      return {};
    }
    this.lastVoiced = time;
    if (midi !== this.candidate) {
      this.candidate = midi;
      this.candidateSince = time;
      return {};
    }
    if (time - this.candidateSince >= this.confirmSeconds && this.midi !== midi) {
      const stop = this.midi ?? undefined;
      this.midi = midi;
      return { start: midi, stop };
    }
    return {};
  }

  reset(): { stop?: number } {
    const stop = this.midi ?? undefined;
    this.midi = null;
    this.candidate = null;
    return { stop };
  }
}

/**
 * Sonified tuner: seconds between cue ticks, or null when in tune or silent.
 * Ticks come faster as the error grows, from `slow` at the tolerance edge to
 * `fast` at 50 cents. Kept slow enough that gating the ticks leaves readings.
 */
export function sonifyInterval(cents: number | null, tolerance: number, slow = 0.9, fast = 0.3): number | null {
  if (cents === null || !Number.isFinite(cents)) return null;
  const off = Math.abs(cents);
  if (off <= tolerance) return null;
  const x = Math.min(1, (off - tolerance) / Math.max(1, 50 - tolerance));
  return slow + (fast - slow) * x;
}
