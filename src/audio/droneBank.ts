import { midiToFrequency } from '../core/notes';
import { getSettings, logPractice, setDroneNotesSource, subscribeSettings, tuningOf } from '../store/settings';
import { ensureRunning, getMaster } from './context';
import { Drone } from './voices';

/**
 * All sustained tones in the app. Lives at module scope so drones keep sounding
 * while you use the tuner or read sheet music, which is how drones are used.
 */
const active = new Map<number, Drone>();
const listeners = new Set<() => void>();
let soundingSince = 0;

function retune() {
  const s = getSettings();
  const tuning = tuningOf(s);
  active.forEach((drone, midi) => {
    drone.setFrequency(midiToFrequency(midi, tuning));
    drone.setVolume(s.drone.volume);
  });
}

// The temperament tonic can follow the lowest drone (settings reads it through this).
setDroneNotesSource(() => activeNotes());

function notify() {
  // A new lowest drone moves the tonic, so every drone is retuned to it.
  if (getSettings().tonicFollowsDrone) retune();
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

/**
 * Starts a drone. Resolves true only if this call created it, so features that
 * add a drone (exercises, follow-drone) know whether they own it and may stop it.
 */
export async function noteOn(midi: number): Promise<boolean> {
  if (active.has(midi)) return false;
  const ctx = await ensureRunning();
  if (active.has(midi)) return false;
  const s = getSettings();
  active.set(midi, new Drone(ctx, getMaster(), midiToFrequency(midi, tuningOf(s)), s.drone.timbre, s.drone.volume));
  notify();
  return true;
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

/** Frequencies of every sounding drone, so the tuner can tell it is hearing one. */
export function activeFrequencies(): number[] {
  const tuning = tuningOf(getSettings());
  return [...active.keys()].map((midi) => midiToFrequency(midi, tuning));
}

export function setTimbreAll(timbre: Parameters<Drone['setTimbre']>[0]): void {
  active.forEach((d) => d.setTimbre(timbre));
}

export function onDronesChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
