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
  { id: 'kick', label: 'Kick' },
  { id: 'snare', label: 'Snare' },
  { id: 'cowbell', label: 'Cowbell' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'marimba', label: 'Marimba' },
  { id: 'bell', label: 'Bell' },
];

/**
 * Per-sound gain so every click peaks near the same level. Measured by rendering
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

/** Schedule one click at AudioContext time `when`. */
export function playClick(
  ctx: BaseAudioContext,
  dest: AudioNode,
  when: number,
  level: AccentLevel | 'sub',
  sound: ClickSound,
  volume = 1,
): void {
  if (level === 'silent' || volume <= 0) return;
  const gainByLevel = { accent: 1, normal: 0.7, sub: 0.4 }[level];
  const pitchByLevel = { accent: 1.5, normal: 1, sub: 0.8 }[level];
  const peak = gainByLevel * volume * (LOUDNESS[sound] ?? 1);

  const p = pitchByLevel;
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
      noise(ctx, dest, when, 'highpass', 2500, 1, peak * 0.9, 0.03);
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
      noise(ctx, dest, when, 'highpass', 7000, 0.7, peak * (level === 'accent' ? 1.1 : 0.7), level === 'accent' ? 0.09 : 0.04);
      break;
    case 'shaker':
      noise(ctx, dest, when, 'bandpass', 6000 * p, 1.2, peak * 1.2, 0.06);
      break;
    case 'kick':
      tone(ctx, dest, when, 150 * p, 'sine', peak * 1.2, 0.18, 45);
      tone(ctx, dest, when, 1000, 'triangle', peak * 0.1, 0.01);
      break;
    case 'snare':
      noise(ctx, dest, when, 'highpass', 1500, 0.8, peak * 1.2, 0.09);
      tone(ctx, dest, when, 220 * p, 'triangle', peak * 0.5, 0.07, 160 * p);
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
      bp.frequency.value = 800 * pitchByLevel;
      bp.connect(g);
      for (const f of [540, 800]) {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = f * pitchByLevel;
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
      osc.frequency.value = 1000 * pitchByLevel;
      osc.connect(envelope(ctx, dest, when, peak * 0.6, 0.05));
      osc.start(when);
      osc.stop(when + 0.07);
    }
  }
}

export type DroneTimbre = 'sine' | 'triangle' | 'sawtooth' | 'square' | 'organ' | 'reed' | 'strings';

export const DRONE_TIMBRES: { id: DroneTimbre; label: string }[] = [
  { id: 'sine', label: 'Pure (sine)' },
  { id: 'organ', label: 'Organ' },
  { id: 'reed', label: 'Reed (odd harmonics)' },
  { id: 'strings', label: 'Strings' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'sawtooth', label: 'Sawtooth' },
  { id: 'square', label: 'Square' },
];

function periodicWave(ctx: BaseAudioContext, amps: number[]): PeriodicWave {
  const real = new Float32Array(amps.length + 1);
  const imag = new Float32Array(amps.length + 1);
  amps.forEach((a, i) => (imag[i + 1] = a));
  return ctx.createPeriodicWave(real, imag);
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

  setTimbre(timbre: DroneTimbre): void {
    switch (timbre) {
      case 'organ':
        this.osc.setPeriodicWave(periodicWave(this.ctx, [1, 0.5, 0.3, 0.25, 0.1, 0.08, 0, 0.05]));
        break;
      case 'reed':
        this.osc.setPeriodicWave(periodicWave(this.ctx, [1, 0.05, 0.6, 0.04, 0.35, 0.03, 0.2, 0.02, 0.12]));
        break;
      case 'strings': {
        const amps = Array.from({ length: 16 }, (_, i) => 1 / (i + 1));
        this.osc.setPeriodicWave(periodicWave(this.ctx, amps));
        this.filter.frequency.value = 3500;
        if (!this.vibrato) {
          this.vibrato = this.ctx.createOscillator();
          this.vibrato.frequency.value = 5.2;
          const depth = this.ctx.createGain();
          depth.gain.value = 3; // cents-ish detune depth via detune param
          this.vibrato.connect(depth);
          depth.connect(this.osc.detune);
          this.vibrato.start();
        }
        return;
      }
      default:
        this.osc.type = timbre;
    }
    this.filter.frequency.value = 8000;
    if (this.vibrato) {
      this.vibrato.stop();
      this.vibrato.disconnect();
      this.vibrato = null;
    }
  }

  setFrequency(frequency: number): void {
    this.osc.frequency.setTargetAtTime(frequency, this.ctx.currentTime, 0.02);
  }

  setVolume(volume: number): void {
    // Square and sawtooth are much louder than sine at equal amplitude.
    this.gain.gain.setTargetAtTime(Math.max(0, volume) * 0.25, this.ctx.currentTime, 0.05);
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
