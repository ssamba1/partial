import type { AccentLevel } from '../core/rhythm';

export type ClickSound =
  | 'beep'
  | 'digital'
  | 'wood'
  | 'clave'
  | 'rim'
  | 'tick'
  | 'sticks'
  | 'hihat'
  | 'shaker'
  | 'kick'
  | 'snare'
  | 'cowbell'
  | 'triangle'
  | 'marimba'
  | 'bell'
  | 'blip';

export const CLICK_SOUNDS: { id: ClickSound; label: string }[] = [
  { id: 'wood', label: 'Woodblock' },
  { id: 'clave', label: 'Clave' },
  { id: 'rim', label: 'Rimshot' },
  { id: 'sticks', label: 'Sticks' },
  { id: 'beep', label: 'Beep' },
  { id: 'digital', label: 'Digital' },
  { id: 'tick', label: 'Tick' },
  { id: 'blip', label: 'Blip' },
  { id: 'hihat', label: 'Hi-hat' },
  { id: 'shaker', label: 'Shaker' },
  { id: 'kick', label: 'Kick (best on headphones)' },
  { id: 'snare', label: 'Snare' },
  { id: 'cowbell', label: 'Cowbell' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'marimba', label: 'Marimba' },
  { id: 'bell', label: 'Bell' },
];

/**
 * Per-sound gain so every click peaks near the same level. Used for live synthesis
 * before a sound is pre-rendered, which then matches sounds by RMS instead. Measured by rendering
 * each sound offline (accent at volume 0.8) and scaling toward a 0.55 peak.
 */
const LOUDNESS: Record<ClickSound, number> = {
  wood: 1.24,
  clave: 0.91,
  rim: 0.57,
  sticks: 0.95,
  beep: 1.18,
  digital: 3.1,
  tick: 2.35,
  blip: 1,
  hihat: 0.48,
  shaker: 0.74,
  kick: 0.63,
  snare: 0.45,
  cowbell: 1.41,
  triangle: 1.49,
  marimba: 0.8,
  bell: 1.08,
};

/** A short pitched tone with an exponential decay and optional downward pitch sweep. */
function tone(ctx: BaseAudioContext, dest: AudioNode, when: number, freq: number, type: OscillatorType, peak: number, decay: number, sweepTo?: number) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, when);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, when + decay * 0.6);
  osc.connect(envelope(ctx, dest, when, peak, decay));
  osc.start(when);
  osc.stop(when + decay + 0.02);
}

/** A filtered noise burst. */
function noise(ctx: BaseAudioContext, dest: AudioNode, when: number, filter: BiquadFilterType, freq: number, q: number, peak: number, decay: number) {
  const src = ctx.createBufferSource();
  src.buffer = getNoise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  src.connect(f);
  f.connect(envelope(ctx, dest, when, peak, decay));
  src.start(when);
  src.stop(when + Math.min(0.099, decay + 0.02));
}

let noiseBuffer: AudioBuffer | null = null;
function getNoise(ctx: BaseAudioContext): AudioBuffer {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

function envelope(ctx: BaseAudioContext, dest: AudioNode, when: number, peak: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
  g.connect(dest);
  return g;
}

/** Gain of each accent level. `accentDb` is how much louder an accent is than a normal beat. */
export function levelGain(level: AccentLevel | 'sub', accentDb = DEFAULT_ACCENT_DB): number {
  const normal = Math.pow(10, -Math.min(12, Math.max(0, accentDb)) / 20);
  switch (level) {
    case 'accent':
      return 1;
    case 'medium':
      return Math.sqrt(normal);
    case 'normal':
      return normal;
    case 'soft':
      return normal * 0.6;
    case 'sub':
      return normal * 0.57;
    default:
      return 0;
  }
}

export const DEFAULT_ACCENT_DB = 6;

const PITCH_BY_LEVEL: Record<AccentLevel | 'sub', number> = { accent: 1.5, medium: 1.25, normal: 1, soft: 0.9, sub: 0.8, silent: 1 };
/** Filter brightness for unpitched sounds, which cannot use pitch to mark the accent. */
const BRIGHT_BY_LEVEL: Record<AccentLevel | 'sub', number> = { accent: 1.35, medium: 1.15, normal: 1, soft: 0.9, sub: 0.85, silent: 1 };

/** Draw one click with live nodes. Level changes pitch and colour; `peak` carries the gain. */
function synthClick(ctx: BaseAudioContext, dest: AudioNode, when: number, level: AccentLevel | 'sub', sound: ClickSound, peak: number): void {
  const p = PITCH_BY_LEVEL[level];
  const bright = BRIGHT_BY_LEVEL[level];
  const strong = level === 'accent' || level === 'medium';
  switch (sound) {
    case 'wood':
      noise(ctx, dest, when, 'bandpass', 1800 * p, 12, peak * 4, 0.06);
      tone(ctx, dest, when, 1250 * p, 'sine', peak * 0.25, 0.04);
      break;
    case 'clave':
      tone(ctx, dest, when, 2500 * p, 'sine', peak * 0.7, 0.07);
      tone(ctx, dest, when, 5000 * p, 'sine', peak * 0.08, 0.03);
      break;
    case 'rim':
      noise(ctx, dest, when, 'highpass', 2500 * bright, 1, peak * 0.9, strong ? 0.045 : 0.03);
      tone(ctx, dest, when, 1700 * p, 'triangle', peak * 0.5, 0.05, 900 * p);
      break;
    case 'sticks':
      noise(ctx, dest, when, 'bandpass', 3800 * p, 6, peak * 3, 0.035);
      noise(ctx, dest, when + 0.006, 'bandpass', 3000 * p, 6, peak * 1.6, 0.03);
      break;
    case 'digital':
      tone(ctx, dest, when, 2000 * p, 'square', peak * 0.22, 0.04);
      break;
    case 'blip':
      tone(ctx, dest, when, 1600 * p, 'sine', peak * 0.7, 0.09, 700 * p);
      break;
    case 'hihat':
      noise(ctx, dest, when, 'highpass', 7000 * Math.min(1.2, bright), 0.7, peak * (strong ? 1.1 : 0.7), level === 'accent' ? 0.09 : strong ? 0.06 : 0.04);
      // Accents get a bright stick transient on top, so they stand out without pitch.
      if (strong) noise(ctx, dest, when, 'bandpass', 4500, 3, peak * 0.8, 0.012);
      break;
    case 'shaker':
      noise(ctx, dest, when, 'bandpass', 6000 * p, 1.2, peak * 1.2, 0.06);
      if (strong) noise(ctx, dest, when, 'bandpass', 3000, 2, peak * 0.9, 0.015);
      break;
    case 'kick':
      tone(ctx, dest, when, 150 * p, 'sine', peak * 1.2, 0.18, 45);
      // Second harmonic and a beater transient, so phone speakers that cannot play the low sine still hear it.
      tone(ctx, dest, when, 300 * p, 'sine', peak * 0.45, 0.08, 110);
      noise(ctx, dest, when, 'bandpass', 3200 * bright, 1.5, peak * 0.9, 0.012);
      tone(ctx, dest, when, 1000, 'triangle', peak * 0.1, 0.01);
      break;
    case 'snare':
      noise(ctx, dest, when, 'highpass', 1500 * bright, 0.8, peak * 1.2, strong ? 0.099 : 0.09);
      tone(ctx, dest, when, 220 * p, 'triangle', peak * 0.5, 0.07, 160 * p);
      if (strong) noise(ctx, dest, when, 'bandpass', 5000, 2, peak * 0.6, 0.015);
      break;
    case 'triangle':
      tone(ctx, dest, when, 3100 * p, 'sine', peak * 0.35, 0.6);
      tone(ctx, dest, when, 4520 * p, 'sine', peak * 0.12, 0.45);
      break;
    case 'marimba':
      tone(ctx, dest, when, 880 * p, 'sine', peak * 0.8, 0.22);
      tone(ctx, dest, when, 880 * 3.9 * p, 'sine', peak * 0.12, 0.05);
      break;
    case 'bell':
      tone(ctx, dest, when, 1320 * p, 'sine', peak * 0.45, 0.8);
      tone(ctx, dest, when, 1320 * 2.76 * p, 'sine', peak * 0.15, 0.4);
      tone(ctx, dest, when, 1320 * 5.4 * p, 'sine', peak * 0.06, 0.2);
      break;
    case 'tick':
      tone(ctx, dest, when, 3000 * p, 'square', peak * 0.3, 0.015);
      break;
    case 'cowbell': {
      const g = envelope(ctx, dest, when, peak * 0.25, 0.25);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 800 * p;
      bp.connect(g);
      for (const f of [540, 800]) {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = f * p;
        osc.connect(bp);
        osc.start(when);
        osc.stop(when + 0.3);
      }
      break;
    }
    case 'beep':
    default: {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 1000 * p;
      osc.connect(envelope(ctx, dest, when, peak * 0.6, 0.05));
      osc.start(when);
      osc.stop(when + 0.07);
    }
  }
}

const RENDER_LEVELS: (AccentLevel | 'sub')[] = ['accent', 'medium', 'normal', 'soft', 'sub'];
const SLOT_SECONDS = 1;

const clickSets = new Map<string, Partial<Record<AccentLevel | 'sub', AudioBuffer>>>();
const clickRenders = new Map<string, Promise<void>>();

/** Energy-based level of a click: RMS over a 4-beat pattern at 120 BPM (one click per 0.5 s). */
export function patternRms(samples: Float32Array, sampleRate: number): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt((sum * 4) / (2 * sampleRate));
}

export function peakOf(samples: Float32Array): number {
  let m = 0;
  for (let i = 0; i < samples.length; i++) m = Math.max(m, Math.abs(samples[i]));
  return m;
}

/**
 * Gain that matches a click's pattern RMS to the reference, capped so its peak stays at or below `peakCap`.
 * Matching on energy rather than peak keeps long sounds (bell) from sounding much louder than short ones (tick).
 * This is plain RMS, not K-weighted loudness.
 */
export function loudnessGain(rms: number, peak: number, targetRms: number, peakCap = 0.9): number {
  if (!(rms > 0) || !(peak > 0)) return 1;
  return Math.min(targetRms / rms, peakCap / peak);
}

async function renderRaw(sampleRate: number, sound: ClickSound, gain: number): Promise<Float32Array[]> {
  const length = Math.ceil(sampleRate * SLOT_SECONDS * RENDER_LEVELS.length);
  const off = new OfflineAudioContext(1, length, sampleRate);
  RENDER_LEVELS.forEach((level, i) => synthClick(off, off.destination, i * SLOT_SECONDS + 0.001, level, sound, gain));
  const out = await off.startRendering();
  const data = out.getChannelData(0);
  const slot = Math.floor(sampleRate * SLOT_SECONDS);
  return RENDER_LEVELS.map((_, i) => {
    const seg = data.subarray(i * slot, (i + 1) * slot);
    let last = seg.length - 1;
    while (last > 0 && Math.abs(seg[last]) < 1e-4) last--;
    return seg.slice(0, last + 1);
  });
}

let referenceRms: Promise<number> | null = null;
let referenceRate = 0;

/**
 * Pre-render every level of a sound once into AudioBuffers, so each click is one
 * buffer source and one gain instead of 2 to 5 live nodes. Sounds are matched to
 * the woodblock by pattern RMS. Safe to call repeatedly.
 */
export function prepareClicks(ctx: BaseAudioContext, sounds: ClickSound[]): Promise<void> {
  if (typeof OfflineAudioContext === 'undefined') return Promise.resolve();
  const rate = ctx.sampleRate;
  if (!referenceRms || referenceRate !== rate) {
    referenceRate = rate;
    // The woodblock at its old peak-matched level is the reference, so overall loudness stays where it was.
    referenceRms = renderRaw(rate, 'wood', LOUDNESS.wood).then((segs) => patternRms(segs[0], rate));
  }
  const ref = referenceRms;
  return Promise.all(
    [...new Set(sounds)].map((sound) => {
      const key = `${rate}:${sound}`;
      let job = clickRenders.get(key);
      if (!job) {
        job = Promise.all([ref, renderRaw(rate, sound, 1)])
          .then(([target, segs]) => {
            const gain = loudnessGain(patternRms(segs[0], rate), peakOf(segs[0]), target);
            const buffers: Partial<Record<AccentLevel | 'sub', AudioBuffer>> = {};
            RENDER_LEVELS.forEach((level, i) => {
              const seg = segs[i];
              const buf = new AudioBuffer({ length: Math.max(1, seg.length), sampleRate: rate, numberOfChannels: 1 });
              const d = buf.getChannelData(0);
              for (let k = 0; k < seg.length; k++) d[k] = seg[k] * gain;
              buffers[level] = buf;
            });
            clickSets.set(key, buffers);
          })
          .catch(() => {
            // Rendering failed: keep using live synthesis.
            clickRenders.delete(key);
          });
        clickRenders.set(key, job);
      }
      return job;
    }),
  ).then(() => undefined);
}

export interface ClickOptions {
  /** Seconds until the next click; long sounds are cut at 80% of it so fast clicks do not smear. */
  gap?: number;
  /** How much louder accents are than normal beats, in dB (0 to 12). */
  accentDb?: number;
}

/** Schedule one click at AudioContext time `when`. */
export function playClick(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  level: AccentLevel | 'sub',
  sound: ClickSound,
  volume = 1,
  opts: ClickOptions = {},
): void {
  if (level === 'silent' || volume <= 0) return;
  const gain = levelGain(level, opts.accentDb) * volume;
  const buffer = clickSets.get(`${ctx.sampleRate}:${sound}`)?.[level];
  const cut = opts.gap && opts.gap > 0 ? opts.gap * 0.8 : Infinity;
  if (buffer) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    if (cut < buffer.duration) {
      g.gain.setValueAtTime(gain, when + cut);
      g.gain.linearRampToValueAtTime(0, when + cut + 0.005);
    }
    src.connect(g);
    g.connect(dest);
    src.start(when);
    src.stop(when + Math.min(buffer.duration, cut + 0.006));
    return;
  }
  // Not rendered yet (first tap): synthesize live and render in the background.
  void prepareClicks(ctx, [sound]);
  let out: AudioNode = dest;
  if (cut < 0.8) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, when + cut);
    g.gain.linearRampToValueAtTime(0, when + cut + 0.005);
    g.connect(dest);
    out = g;
  }
  synthClick(ctx, out, when, level, sound, gain * (LOUDNESS[sound] ?? 1));
}

export type DroneTimbre = 'sine' | 'triangle' | 'sawtooth' | 'square' | 'organ' | 'reed' | 'strings' | 'cello' | 'clarinet' | 'flute' | 'voice';

export const DRONE_TIMBRES: { id: DroneTimbre; label: string }[] = [
  { id: 'organ', label: 'Organ' },
  { id: 'cello', label: 'Cello' },
  { id: 'strings', label: 'Strings' },
  { id: 'clarinet', label: 'Clarinet' },
  { id: 'flute', label: 'Flute' },
  { id: 'voice', label: 'Voice (ah)' },
  { id: 'reed', label: 'Reed' },
  { id: 'sine', label: 'Pure (sine)' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'sawtooth', label: 'Sawtooth' },
  { id: 'square', label: 'Square' },
];

interface TimbreSpec {
  /** Harmonic amplitudes (1st harmonic first) or a basic oscillator type. */
  amps?: number[];
  type?: OscillatorType;
  lowpass: number;
  /** Vibrato depth in cents (0 = none) and rate in Hz. */
  vibrato: number;
  rate: number;
  /** Relative loudness so timbres sit at a similar level. */
  gain: number;
}

// Synthesised approximations of instrument spectra, not samples.
const TIMBRES: Record<DroneTimbre, TimbreSpec> = {
  sine: { type: 'sine', lowpass: 12000, vibrato: 0, rate: 0, gain: 1.4 },
  triangle: { type: 'triangle', lowpass: 12000, vibrato: 0, rate: 0, gain: 1.2 },
  sawtooth: { type: 'sawtooth', lowpass: 8000, vibrato: 0, rate: 0, gain: 0.55 },
  square: { type: 'square', lowpass: 8000, vibrato: 0, rate: 0, gain: 0.5 },
  organ: { amps: [1, 0.5, 0.3, 0.25, 0.1, 0.08, 0, 0.05], lowpass: 8000, vibrato: 0, rate: 0, gain: 1 },
  reed: { amps: [1, 0.05, 0.6, 0.04, 0.35, 0.03, 0.2, 0.02, 0.12], lowpass: 8000, vibrato: 0, rate: 0, gain: 1 },
  strings: { amps: Array.from({ length: 16 }, (_, i) => 1 / (i + 1)), lowpass: 3500, vibrato: 3, rate: 5.2, gain: 0.9 },
  cello: { amps: [1, 0.85, 0.65, 0.55, 0.4, 0.34, 0.24, 0.2, 0.14, 0.11, 0.08, 0.06], lowpass: 2600, vibrato: 5, rate: 5.4, gain: 0.8 },
  clarinet: { amps: [1, 0.02, 0.78, 0.02, 0.52, 0.02, 0.3, 0.02, 0.17, 0.01, 0.1], lowpass: 3800, vibrato: 0, rate: 0, gain: 0.95 },
  flute: { amps: [1, 0.32, 0.1, 0.04, 0.02], lowpass: 6000, vibrato: 4, rate: 5, gain: 1.2 },
  voice: { amps: [1, 0.65, 0.38, 0.52, 0.42, 0.16, 0.09, 0.05, 0.04], lowpass: 3200, vibrato: 6, rate: 5.6, gain: 0.95 },
};

const waveCache = new WeakMap<BaseAudioContext, Map<DroneTimbre, PeriodicWave>>();

function periodicWave(ctx: BaseAudioContext, amps: number[]): PeriodicWave {
  const real = new Float32Array(amps.length + 1);
  const imag = new Float32Array(amps.length + 1);
  amps.forEach((a, i) => (imag[i + 1] = a));
  return ctx.createPeriodicWave(real, imag);
}

function applyWave(ctx: BaseAudioContext, osc: OscillatorNode, timbre: DroneTimbre): TimbreSpec {
  const spec = TIMBRES[timbre] ?? TIMBRES.organ;
  if (spec.amps) {
    let cache = waveCache.get(ctx);
    if (!cache) waveCache.set(ctx, (cache = new Map()));
    let wave = cache.get(timbre);
    if (!wave) cache.set(timbre, (wave = periodicWave(ctx, spec.amps)));
    osc.setPeriodicWave(wave);
  } else {
    osc.type = spec.type!;
  }
  return spec;
}

/** A single scheduled note with attack and release, for exercises and previews. */
export function playTone(ctx: BaseAudioContext, dest: AudioNode, when: number, frequency: number, duration: number, timbre: DroneTimbre, volume: number): void {
  const osc = ctx.createOscillator();
  const spec = applyWave(ctx, osc, timbre);
  osc.frequency.value = frequency;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = spec.lowpass;
  const g = ctx.createGain();
  const level = Math.max(0, volume) * 0.28 * spec.gain;
  const attack = Math.min(0.03, duration / 4);
  const release = Math.min(0.12, duration / 3);
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(level, when + attack);
  g.gain.setValueAtTime(level, when + Math.max(attack, duration - release));
  g.gain.linearRampToValueAtTime(0, when + duration);
  osc.connect(filter);
  filter.connect(g);
  g.connect(dest);
  osc.start(when);
  osc.stop(when + duration + 0.02);
}

/** A sustained tone with smooth attack and release. */
export class Drone {
  private osc: OscillatorNode;
  private vibrato: OscillatorNode | null = null;
  private gain: GainNode;
  private filter: BiquadFilterNode;
  private stopped = false;

  constructor(
    private ctx: BaseAudioContext,
    dest: AudioNode,
    frequency: number,
    timbre: DroneTimbre,
    volume: number,
  ) {
    this.osc = ctx.createOscillator();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 8000;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.setTimbre(timbre);
    this.osc.frequency.value = frequency;
    this.osc.connect(this.filter);
    this.filter.connect(this.gain);
    this.gain.connect(dest);
    this.osc.start();
    this.setVolume(volume);
  }

  private spec: TimbreSpec = TIMBRES.organ;
  private volume = 0;

  setTimbre(timbre: DroneTimbre): void {
    this.spec = applyWave(this.ctx, this.osc, timbre);
    this.filter.frequency.value = this.spec.lowpass;
    if (this.vibrato) {
      this.vibrato.stop();
      this.vibrato.disconnect();
      this.vibrato = null;
    }
    if (this.spec.vibrato > 0) {
      this.vibrato = this.ctx.createOscillator();
      this.vibrato.frequency.value = this.spec.rate;
      const depth = this.ctx.createGain();
      // Oscillator detune is in cents, so the depth is in cents too.
      depth.gain.value = this.spec.vibrato;
      this.vibrato.connect(depth);
      depth.connect(this.osc.detune);
      this.vibrato.start();
    }
    this.setVolume(this.volume);
  }

  setFrequency(frequency: number): void {
    this.osc.frequency.setTargetAtTime(frequency, this.ctx.currentTime, 0.02);
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.gain.gain.setTargetAtTime(Math.max(0, volume) * 0.25 * this.spec.gain, this.ctx.currentTime, 0.05);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(0, t, 0.05);
    this.osc.stop(t + 0.4);
    this.vibrato?.stop(t + 0.4);
  }
}
