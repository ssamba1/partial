import { midiToFrequency } from '../core/notes';
import { getSettings, logPractice, subscribeSettings, tuningOf } from '../store/settings';
import { ensureRunning, getMaster } from './context';
import { Drone } from './voices';

/**
 * All sustained tones in the app. Lives at module scope so drones keep sounding
 * while you use the tuner or read sheet music, which is how drones are used.
 */
const active = new Map<number, Drone>();
const listeners = new Set<() => void>();
let soundingSince = 0;

function notify() {
  if (active.size && !soundingSince) soundingSince = performance.now();
  if (!active.size && soundingSince) {
    logPractice((performance.now() - soundingSince) / 1000, 'sound');
    soundingSince = 0;
  }
  listeners.forEach((fn) => fn());
}

subscribeSettings((s) => {
  const tuning = tuningOf(s);
  active.forEach((drone, midi) => {
    drone.setFrequency(midiToFrequency(midi, tuning));
    drone.setVolume(s.drone.volume);
  });
});

export function isOn(midi: number): boolean {
  return active.has(midi);
}

export async function noteOn(midi: number): Promise<void> {
  if (active.has(midi)) return;
  const ctx = await ensureRunning();
  if (active.has(midi)) return;
  const s = getSettings();
  active.set(midi, new Drone(ctx, getMaster(), midiToFrequency(midi, tuningOf(s)), s.drone.timbre, s.drone.volume));
  notify();
}

export function noteOff(midi: number): void {
  const d = active.get(midi);
  if (!d) return;
  d.stop();
  active.delete(midi);
  notify();
}

export async function toggleNote(midi: number): Promise<void> {
  if (active.has(midi)) noteOff(midi);
  else await noteOn(midi);
}

export function stopAll(): void {
  active.forEach((d) => d.stop());
  active.clear();
  notify();
}

export function activeNotes(): number[] {
  return [...active.keys()].sort((a, b) => a - b);
}

export function setTimbreAll(timbre: Parameters<Drone['setTimbre']>[0]): void {
  active.forEach((d) => d.setTimbre(timbre));
}

export function onDronesChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
