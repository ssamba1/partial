import type { AccentLevel } from '../core/rhythm';

export type ClickSound = 'beep' | 'wood' | 'tick' | 'cowbell';

export const CLICK_SOUNDS: { id: ClickSound; label: string }[] = [
  { id: 'beep', label: 'Beep' },
  { id: 'wood', label: 'Woodblock' },
  { id: 'tick', label: 'Tick' },
  { id: 'cowbell', label: 'Cowbell' },
];

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
  const peak = gainByLevel * volume;

  switch (sound) {
    case 'wood': {
      const src = ctx.createBufferSource();
      src.buffer = getNoise(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800 * pitchByLevel;
      bp.Q.value = 12;
      src.connect(bp);
      bp.connect(envelope(ctx, dest, when, peak * 4, 0.06));
      src.start(when);
      src.stop(when + 0.08);
      break;
    }
    case 'tick': {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 3000 * pitchByLevel;
      osc.connect(envelope(ctx, dest, when, peak * 0.3, 0.015));
      osc.start(when);
      osc.stop(when + 0.03);
      break;
    }
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
