import { ensureRunning, getMaster } from '../../audio/context';
import { Drone, DRONE_TIMBRES } from '../../audio/voices';
import { midiToFrequency, noteName } from '../../core/notes';
import { getSettings, subscribeSettings, tuningOf, updateSettings } from '../../store/settings';
import { field, h, select } from '../dom';

const CHORDS: { id: string; label: string; intervals: number[] }[] = [
  { id: 'root', label: 'Root only', intervals: [0] },
  { id: 'fifth', label: 'Root + fifth', intervals: [0, 7] },
  { id: 'octave', label: 'Root + octave', intervals: [0, 12] },
  { id: 'major', label: 'Major triad', intervals: [0, 4, 7] },
  { id: 'minor', label: 'Minor triad', intervals: [0, 3, 7] },
];

/**
 * Drones live at module scope so they keep sounding while you use the tuner
 * or read sheet music, which is how drones are used for intonation practice.
 */
const active = new Map<number, Drone>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

function retune() {
  const tuning = tuningOf(getSettings());
  active.forEach((drone, midi) => drone.setFrequency(midiToFrequency(midi, tuning)));
}

subscribeSettings(() => {
  retune();
  const d = getSettings().drone;
  active.forEach((drone) => drone.setVolume(d.volume));
});

export async function toggleDrone(midi: number): Promise<void> {
  const existing = active.get(midi);
  if (existing) {
    existing.stop();
    active.delete(midi);
  } else {
    const ctx = await ensureRunning();
    const s = getSettings();
    active.set(midi, new Drone(ctx, getMaster(), midiToFrequency(midi, tuningOf(s)), s.drone.timbre, s.drone.volume));
  }
  notify();
}

export function stopAllDrones(): void {
  active.forEach((d) => d.stop());
  active.clear();
  notify();
}

export function onDronesChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function activeDroneCount(): number {
  return active.size;
}

export function mountDrone(root: HTMLElement) {
  const s = getSettings();
  let octave = s.drone.octave;
  let chord = 'root';

  const grid = h('div', { class: 'note-grid', role: 'group', 'aria-label': 'Drone notes' });
  const status = h('div', { class: 'muted center small' });

  async function pressNote(pc: number) {
    const intervals = CHORDS.find((c) => c.id === chord)!.intervals;
    const root = (octave + 1) * 12 + pc;
    const targets = intervals.map((i) => root + i);
    const anyOn = targets.some((m) => active.has(m));
    for (const m of targets) {
      if (anyOn === active.has(m)) await toggleDrone(m);
    }
  }

  function render() {
    const tuning = tuningOf(getSettings());
    const flats = getSettings().flats;
    grid.replaceChildren(
      ...Array.from({ length: 12 }, (_, pc) => {
        const midi = (octave + 1) * 12 + pc;
        const on = active.has(midi);
        return h(
          'button',
          {
            class: `note-key${on ? ' on' : ''}${[1, 3, 6, 8, 10].includes(pc) ? ' black' : ''}`,
            'aria-pressed': on ? 'true' : 'false',
            onclick: () => void pressNote(pc),
          },
          h('span', { class: 'note-key-name' }, noteName(midi, flats)),
          h('span', { class: 'note-key-freq' }, `${midiToFrequency(midi, tuning).toFixed(1)}`),
        );
      }),
    );
    const names = [...active.keys()].sort((a, b) => a - b).map((m) => noteName(m, flats));
    status.textContent = names.length ? `Sounding: ${names.join(', ')}` : 'Tap a note to start a drone. Tap again to stop.';
  }

  listeners.add(render);
  const offSettings = subscribeSettings(render);

  root.append(
    h(
      'section',
      { class: 'view drone' },
      h('p', { class: 'muted' }, 'Sustained reference pitches. They follow the A4, temperament and tonic set in the tuner, and keep playing when you switch screens.'),
      grid,
      status,
      h('div', { class: 'row center' }, h('button', { class: 'big', onclick: stopAllDrones }, 'Stop all')),
      h(
        'div',
        { class: 'grid' },
        field(
          'Octave',
          select(
            [1, 2, 3, 4, 5, 6].map((o) => ({ value: o, label: `Octave ${o}` })),
            octave,
            (v) => {
              octave = Number(v);
              updateSettings((st) => ({ drone: { ...st.drone, octave } }));
              render();
            },
          ),
        ),
        field('Play as', select(CHORDS.map((c) => ({ value: c.id, label: c.label })), chord, (v) => (chord = v))),
        field(
          'Sound',
          select(DRONE_TIMBRES.map((t) => ({ value: t.id, label: t.label })), s.drone.timbre, (v) => {
            updateSettings((st) => ({ drone: { ...st.drone, timbre: v as typeof st.drone.timbre } }));
            active.forEach((d) => d.setTimbre(v as typeof s.drone.timbre));
          }),
        ),
        field(
          'Volume',
          h('input', {
            type: 'range',
            min: 0,
            max: 1,
            step: 0.05,
            value: String(s.drone.volume),
            oninput: (e: Event) => updateSettings((st) => ({ drone: { ...st.drone, volume: Number((e.target as HTMLInputElement).value) } })),
          }),
        ),
      ),
    ),
  );
  render();

  return () => {
    listeners.delete(render);
    offSettings();
  };
}
