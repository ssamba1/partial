export type MicChannel = 'mix' | 'left' | 'right';

/**
 * Which input channel to analyse: null means use the browser's mono mix. A
 * one-channel input always uses the mix, since its "right" side is silent.
 */
export function channelIndex(mode: MicChannel, channelCount: number | undefined): number | null {
  if (mode === 'mix' || !channelCount || channelCount < 2) return null;
  return mode === 'left' ? 0 : 1;
}

/** Mix a set of channel buffers down the same way the analyser would, or pick one channel. */
export function routeChannels(channels: Float32Array[], mode: MicChannel): Float32Array {
  const index = channelIndex(mode, channels.length);
  if (index !== null) return channels[index];
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

export interface MicTrackInfo {
  label: string;
  settings: Pick<MediaTrackSettings, 'echoCancellation' | 'noiseSuppression' | 'autoGainControl' | 'sampleRate'>;
}

/** Plain-language warnings about a mic track that will make the tuner less accurate. */
export function micWarnings(info: MicTrackInfo): string[] {
  const out: string[] = [];
  const s = info.settings;
  const on = [
    s.autoGainControl === true ? 'automatic gain' : '',
    s.noiseSuppression === true ? 'noise suppression' : '',
    s.echoCancellation === true ? 'echo cancellation' : '',
  ].filter(Boolean);
  if (on.length) out.push(`The browser kept ${on.join(', ')} on. Readings may be less steady.`);
  if (/bluetooth|airpods|hands-?free|\bbuds\b/i.test(info.label) || (s.sampleRate !== undefined && s.sampleRate <= 16000)) {
    out.push('Bluetooth mic detected. Use the built-in mic for better accuracy.');
  }
  return out;
}

/** Mic gate from frame levels measured in a quiet room: three times the noise RMS, at least 0.001. */
export function calibratedThreshold(levels: readonly number[]): number {
  if (!levels.length) return 0.001;
  const meanSq = levels.reduce((a, l) => a + l * l, 0) / levels.length;
  const value = Math.max(0.001, 3 * Math.sqrt(meanSq));
  return Math.round(value * 100000) / 100000;
}

/** Position of an RMS level on a meter from `floorDb` to 0 dBFS, 0..1. */
export function meterPosition(level: number, floorDb = -60): number {
  if (!(level > 0)) return 0;
  const db = 20 * Math.log10(level);
  return Math.max(0, Math.min(1, (db - floorDb) / -floorDb));
}

export function peakAbs(samples: ArrayLike<number>): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  return peak;
}

/** Rough fundamental from zero crossings of the mean-removed signal, in Hz. */
export function zeroCrossingRate(samples: ArrayLike<number>, sampleRate: number): number {
  const n = samples.length;
  if (n < 2) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples[i];
  mean /= n;
  let crossings = 0;
  let prev = samples[0] - mean;
  for (let i = 1; i < n; i++) {
    const v = samples[i] - mean;
    if ((prev < 0 && v >= 0) || (prev >= 0 && v < 0)) crossings++;
    prev = v;
  }
  return crossings / 2 / (n / sampleRate);
}

export type SignalMessage = '' | 'No signal' | 'Too quiet' | 'Too low for the tuner';

export interface SignalFrame {
  /** Seconds. */
  time: number;
  level: number;
  peak: number;
  threshold: number;
  hasPitch: boolean;
  /** Zero-crossing estimate of the fundamental, only needed when there is signal but no pitch. */
  roughHz?: number;
  lowestHz?: number;
}

/** Explains why the tuner shows nothing, and holds the clip light on for a second after any sample at or above 0.99. */
export class SignalStatus {
  private zeroSince: number | null = null;
  private quietSince: number | null = null;
  private lowSince: number | null = null;
  private clipUntil = -Infinity;

  update(f: SignalFrame): { message: SignalMessage; clip: boolean } {
    if (f.peak >= 0.99) this.clipUntil = f.time + 1;
    const clip = f.time < this.clipUntil;
    const since = (cond: boolean, start: number | null) => (cond ? (start ?? f.time) : null);

    this.zeroSince = since(f.level === 0, this.zeroSince);
    this.quietSince = since(!f.hasPitch && f.level > f.threshold / 2 && f.level < f.threshold, this.quietSince);
    const low = !f.hasPitch && f.level >= f.threshold && f.roughHz !== undefined && f.roughHz > 0 && f.roughHz < (f.lowestHz ?? 30);
    this.lowSince = since(low, this.lowSince);

    let message: SignalMessage = '';
    if (this.zeroSince !== null && f.time - this.zeroSince >= 3) message = 'No signal';
    else if (this.lowSince !== null && f.time - this.lowSince >= 1) message = 'Too low for the tuner';
    else if (this.quietSince !== null && f.time - this.quietSince >= 1) message = 'Too quiet';
    return { message, clip };
  }

  reset(): void {
    this.zeroSince = this.quietSince = this.lowSince = null;
    this.clipUntil = -Infinity;
  }
}
