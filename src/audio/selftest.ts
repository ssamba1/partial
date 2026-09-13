/**
 * Offline audio measurements for the end-to-end checks. Loaded only when the page
 * is opened with ?selftest, so it never ships in the normal start-up path.
 */
import type { AccentLevel } from '../core/rhythm';
import { buildMasterChain, LIMITER_CEILING } from './context';
import { CLICK_SOUNDS, Drone, levelGain, playClick, prepareClicks, renderedClick, synthClick, type ClickSound } from './voices';

const RATE = 48000;
const SOUNDS = CLICK_SOUNDS.map((c) => c.id);

function peak(d: Float32Array): number {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  return m;
}

function rms(d: Float32Array): number {
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i] * d[i];
  return Math.sqrt(s / Math.max(1, d.length));
}

const db = (ratio: number) => 20 * Math.log10(ratio);

/**
 * Loudest case: every sound's accent at full volume on the same instant, a
 * subdivision click of each on top, and eight full-volume drones. Returns the
 * peak with and without the master limiter.
 */
export async function limiterPeaks(): Promise<{ raw: number; limited: number; ceiling: number }> {
  const render = async (limit: boolean) => {
    const off = new OfflineAudioContext(1, RATE, RATE);
    await prepareClicks(off, SOUNDS);
    const dest = limit ? buildMasterChain(off, off.destination) : off.destination;
    for (const s of SOUNDS) {
      playClick(off, dest, 0.3, 'accent', s, 1, { accentDb: 12 });
      playClick(off, dest, 0.3, 'sub', s, 1, { accentDb: 0 });
    }
    for (let i = 0; i < 8; i++) new Drone(off, dest, 110 * Math.pow(2, i / 4), 'sawtooth', 1);
    const out = await off.startRendering();
    return peak(out.getChannelData(0));
  };
  return { raw: await render(false), limited: await render(true), ceiling: LIMITER_CEILING };
}

/** How far each pre-rendered click is from live synthesis at the same gain, in dB relative to the click (lower is closer). */
export async function renderMatch(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const probe = new OfflineAudioContext(1, 1, RATE);
  await prepareClicks(probe, SOUNDS);
  for (const sound of SOUNDS) {
    for (const level of ['accent', 'normal', 'sub'] as (AccentLevel | 'sub')[]) {
      const pre = renderedClick(RATE, sound, level);
      if (!pre) {
        out[`${sound}:${level}`] = Infinity;
        continue;
      }
      const a = pre.buffer.getChannelData(0);
      // The render slot starts the click 1 ms in, so the live copy does too.
      const off = new OfflineAudioContext(1, a.length, RATE);
      synthClick(off, off.destination, 0.001, level, sound, pre.gain);
      const b = (await off.startRendering()).getChannelData(0);
      const diff = new Float32Array(a.length);
      for (let i = 0; i < a.length; i++) diff[i] = a[i] - b[i];
      out[`${sound}:${level}`] = db(rms(diff) / rms(b));
    }
  }
  return out;
}

/** Rendered level of an accent over a normal beat through the real playClick path, in dB (RMS and peak). */
export async function accentLift(accentDb = 6): Promise<Record<string, { rms: number; peak: number }>> {
  const out: Record<string, { rms: number; peak: number }> = {};
  for (const sound of SOUNDS) {
    const off = new OfflineAudioContext(1, RATE * 2, RATE);
    await prepareClicks(off, [sound]);
    playClick(off, off.destination, 0.01, 'accent', sound, 0.8, { accentDb });
    playClick(off, off.destination, 1.01, 'normal', sound, 0.8, { accentDb });
    const d = (await off.startRendering()).getChannelData(0);
    const acc = d.subarray(0, RATE);
    const nor = d.subarray(RATE, RATE * 2);
    out[sound] = { rms: db(rms(acc) / rms(nor)), peak: db(peak(acc) / peak(nor)) };
  }
  return out;
}

/**
 * Energy above 300 Hz of a normal click, in dB relative to full scale RMS over
 * the click. Filtered with two cascaded 300 Hz high-pass biquads (24 dB per octave).
 */
export async function energyAbove300(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const sound of SOUNDS as ClickSound[]) {
    const off = new OfflineAudioContext(1, RATE / 2, RATE);
    await prepareClicks(off, [sound]);
    const hp1 = off.createBiquadFilter();
    const hp2 = off.createBiquadFilter();
    hp1.type = hp2.type = 'highpass';
    hp1.frequency.value = hp2.frequency.value = 300;
    hp1.connect(hp2);
    hp2.connect(off.destination);
    playClick(off, hp1, 0.01, 'normal', sound, 0.8);
    const d = (await off.startRendering()).getChannelData(0);
    // RMS over the first 100 ms, where every click has its body.
    out[sound] = db(rms(d.subarray(0, RATE / 10)));
  }
  return out;
}

export { levelGain };
