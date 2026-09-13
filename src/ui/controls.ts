import { stopAll } from '../audio/droneBank';
import { midiTrigger, type MidiAction } from '../core/midi';
import { getSettings, subscribeSettings } from '../store/settings';
import { toast } from './components';
import { metronome } from './shared';

/* ---------- Keyboard ---------- */

function typingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);
}

/** App-wide shortcuts that work on every screen. Screen-specific keys (space, arrows) stay in each view. */
export function installGlobalShortcuts(routes: string[], openHelp: () => void): void {
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typingTarget(e.target)) return;
    if (document.querySelector('.sheet-layer')) return;
    const key = e.key.toLowerCase();
    const route = location.hash.replace(/^#\/?/, '');
    if (key === 'm' && route !== 'metronome') {
      e.preventDefault();
      metronome.toggle();
    } else if (key === 'd') {
      e.preventDefault();
      stopAll();
    } else if (key === '?') {
      e.preventDefault();
      openHelp();
    } else if (/^[1-9]$/.test(key) && Number(key) <= routes.length) {
      e.preventDefault();
      location.hash = `#/${routes[Number(key) - 1]}`;
    }
  });
}

/* ---------- MIDI and pedals ---------- */

type LearnCallback = (trigger: string) => void;
let access: MIDIAccess | null = null;
let learner: LearnCallback | null = null;
const deviceListeners = new Set<(names: string[]) => void>();

function dispatchKey(key: string, code = key) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }));
}

export function runAction(action: MidiAction): void {
  switch (action) {
    case 'next':
      dispatchKey('ArrowRight');
      break;
    case 'previous':
      dispatchKey('ArrowLeft');
      break;
    case 'toggle':
      dispatchKey(' ', 'Space');
      break;
    case 'metronome':
      metronome.toggle();
      break;
    case 'tap':
      dispatchKey('t', 'KeyT');
      break;
  }
}

function onMessage(e: MIDIMessageEvent) {
  if (!e.data) return;
  const trigger = midiTrigger(e.data);
  if (!trigger) return;
  if (learner) {
    const cb = learner;
    learner = null;
    cb(trigger);
    return;
  }
  const action = getSettings().midiMap[trigger];
  if (action) runAction(action);
}

function wire() {
  if (!access) return;
  const names: string[] = [];
  access.inputs.forEach((input) => {
    input.onmidimessage = onMessage;
    names.push(input.name ?? 'MIDI device');
  });
  deviceListeners.forEach((fn) => fn(names));
}

export async function enableMidi(): Promise<boolean> {
  if (access) return true;
  if (!('requestMIDIAccess' in navigator)) {
    toast('This browser does not support MIDI devices. Bluetooth page turners that act as a keyboard still work.');
    return false;
  }
  try {
    access = await navigator.requestMIDIAccess();
    access.onstatechange = wire;
    wire();
    return true;
  } catch {
    toast('MIDI access was not allowed.');
    return false;
  }
}

export function disableMidi(): void {
  if (!access) return;
  access.inputs.forEach((input) => (input.onmidimessage = null));
  access.onstatechange = null;
  access = null;
  deviceListeners.forEach((fn) => fn([]));
}

export function learnNextTrigger(cb: LearnCallback | null): void {
  learner = cb;
}

export function onMidiDevices(fn: (names: string[]) => void): () => void {
  deviceListeners.add(fn);
  if (access) wire();
  else fn([]);
  return () => deviceListeners.delete(fn);
}

/** Re-open MIDI on start if the user turned it on before (browsers remember the permission). */
export function restoreMidi(): void {
  if (getSettings().midiEnabled) void enableMidi();
  subscribeSettings((s) => {
    if (!s.midiEnabled && access) disableMidi();
  });
}

/* ---------- Screen reader announcements ---------- */

let liveRegion: HTMLElement | null = null;
let lastAnnounce = 0;
let lastText = '';

export function announce(text: string, force = false): void {
  if (!getSettings().announce) return;
  const now = performance.now();
  if (!force && (now - lastAnnounce < 1500 || text === lastText)) return;
  lastAnnounce = now;
  lastText = text;
  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.className = 'visually-hidden';
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('role', 'status');
    document.body.append(liveRegion);
  }
  liveRegion.textContent = text;
}
