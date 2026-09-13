import { ensureRunning, getMaster } from '../../audio/context';
import { activeNotes, isOn, noteOff, noteOn, onDronesChange, setTimbreAll, stopAll, toggleNote } from '../../audio/droneBank';
import { LookaheadScheduler } from '../../audio/scheduler';
import { DRONE_TIMBRES, playClick, playTone, type DroneTimbre } from '../../audio/voices';
import { buildExercise, PATTERNS, type Direction, type Pattern } from '../../core/exercises';
import { angleDelta, pointAngle } from '../../core/gestures';
import { midiToFrequency, mod, noteName, prettyName } from '../../core/notes';
import { getSettings, subscribeSettings, tuningOf, updateSettings, type Settings } from '../../store/settings';
import { capturePointer, holdButton, segmented, svgEl } from '../components';
import { field, h, select } from '../dom';
import { icon } from '../icons';

const CHORDS: { id: string; label: string; intervals: number[] }[] = [
  { id: 'root', label: 'Single', intervals: [0] },
  { id: 'fifth', label: 'Fifth', intervals: [0, 7] },
  { id: 'octave', label: 'Octave', intervals: [0, 12] },
  { id: 'major', label: 'Major', intervals: [0, 4, 7] },
  { id: 'minor', label: 'Minor', intervals: [0, 3, 7] },
];

const BLACK = new Set([1, 3, 6, 8, 10]);

export function mountSound(root: HTMLElement) {
  let sustain = true;
  const s0 = getSettings();

  const chordIntervals = () => (CHORDS.find((c) => c.id === getSettings().drone.chord) ?? CHORDS[0]).intervals;
  const octave = () => getSettings().drone.octave;

  /** Press a root note: toggles in sustain mode, momentary otherwise. */
  async function press(rootMidi: number) {
    const targets = chordIntervals().map((i) => rootMidi + i);
    if (sustain) {
      const anyOn = targets.some(isOn);
      for (const m of targets) if (anyOn === isOn(m)) await toggleNote(m);
    } else {
      for (const m of targets) await noteOn(m);
    }
  }
  function release(rootMidi: number) {
    if (sustain) return;
    chordIntervals().forEach((i) => noteOff(rootMidi + i));
  }

  /* ----- Chromatic wheel ----- */
  const SIZE = 340;
  const C = SIZE / 2;
  const R_OUT = 164;
  const R_IN = 78;
  const wheelSvg = svgEl('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'wheel-svg' });
  const wedges: SVGGElement[] = [];
  const pt = (r: number, deg: number) => [C + Math.sin((deg * Math.PI) / 180) * r, C - Math.cos((deg * Math.PI) / 180) * r];
  for (let pc = 0; pc < 12; pc++) {
    const a0 = pc * 30 - 15 + 1.2;
    const a1 = pc * 30 + 15 - 1.2;
    const [x0, y0] = pt(R_OUT, a0);
    const [x1, y1] = pt(R_OUT, a1);
    const [x2, y2] = pt(R_IN, a1);
    const [x3, y3] = pt(R_IN, a0);
    const g = svgEl('g', { class: `wedge${BLACK.has(pc) ? ' black' : ''}`, 'data-pc': pc });
    g.append(svgEl('path', { d: `M ${x0} ${y0} A ${R_OUT} ${R_OUT} 0 0 1 ${x1} ${y1} L ${x2} ${y2} A ${R_IN} ${R_IN} 0 0 0 ${x3} ${y3} Z`, class: 'wedge-shape' }));
    const [tx, ty] = pt((R_OUT + R_IN) / 2 + 8, pc * 30);
    g.append(svgEl('text', { x: tx, y: ty, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'wedge-label' }));
    const [fx, fy] = pt((R_OUT + R_IN) / 2 - 22, pc * 30);
    g.append(svgEl('text', { x: fx, y: fy, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'wedge-freq' }));
    wheelSvg.append(g);
    wedges.push(g);
  }
  const octLabel = h('div', { class: 'wheel-oct' });
  const wheelCenter = h(
    'div',
    { class: 'wheel-center' },
    holdButton(icon('minus', 18), 'Octave down', () => setOctave(octave() - 1), 'icon-btn'),
    octLabel,
    holdButton(icon('plus', 18), 'Octave up', () => setOctave(octave() + 1), 'icon-btn'),
  );
  const wheel = h('div', { class: 'wheel', role: 'group', 'aria-label': 'Chromatic wheel. Tap a note, or drag around the wheel to glide between notes.' }, wheelSvg, wheelCenter);

  // Drag across wedges to glide; crossing from B to C clockwise moves up an octave.
  let dragPc: number | null = null;
  let dragOct = 0;
  let dragAngle = 0;
  const pcAt = (e: PointerEvent) => {
    const rect = wheelSvg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dist = Math.hypot(e.clientX - cx, e.clientY - cy) * (SIZE / rect.width);
    const ang = pointAngle(cx, cy, e.clientX, e.clientY);
    return { pc: dist >= R_IN - 6 && dist <= R_OUT + 12 ? mod(Math.round(ang / 30), 12) : null, ang };
  };
  wheelSvg.addEventListener('pointerdown', (e) => {
    const { pc, ang } = pcAt(e);
    if (pc === null) return;
    capturePointer(wheelSvg, e.pointerId);
    dragPc = pc;
    dragOct = octave();
    dragAngle = ang;
    void press((dragOct + 1) * 12 + pc);
  });
  wheelSvg.addEventListener('pointermove', (e) => {
    if (dragPc === null) return;
    const { pc, ang } = pcAt(e);
    const d = angleDelta(dragAngle, ang);
    dragAngle = ang;
    if (pc === null || pc === dragPc) return;
    const fromRoot = (dragOct + 1) * 12 + dragPc;
    if (d > 0 && dragPc === 11 && pc === 0) dragOct++;
    if (d < 0 && dragPc === 0 && pc === 11) dragOct--;
    dragOct = Math.max(0, Math.min(7, dragOct));
    // Glide: the chord moves to the new note in both modes.
    chordIntervals().forEach((i) => noteOff(fromRoot + i));
    dragPc = pc;
    if (dragOct !== octave()) setOctave(dragOct);
    const toRoot = (dragOct + 1) * 12 + pc;
    chordIntervals().forEach((i) => void noteOn(toRoot + i));
  });
  const endDrag = () => {
    if (dragPc === null) return;
    if (!sustain) release((dragOct + 1) * 12 + dragPc);
    dragPc = null;
  };
  wheelSvg.addEventListener('pointerup', endDrag);
  wheelSvg.addEventListener('pointercancel', endDrag);

  /* ----- Piano keyboard ----- */
  const keys = h('div', { class: 'piano', role: 'group', 'aria-label': 'Piano keyboard' });
  const pianoScroll = h('div', { class: 'piano-scroll' }, keys);
  const pressedKeys = new Map<number, number>();

  function buildPiano() {
    const s = getSettings();
    const tuning = tuningOf(s);
    const start = 24; // C1
    const end = 96; // C7
    const whites: HTMLElement[] = [];
    const blacks: HTMLElement[] = [];
    let whiteIndex = 0;
    for (let m = start; m <= end; m++) {
      const pc = mod(m, 12);
      const isBlack = BLACK.has(pc);
      const key = h(
        'button',
        {
          class: `key ${isBlack ? 'black' : 'white'}`,
          'data-midi': m,
          'aria-label': `${noteName(m, s.flats)} ${midiToFrequency(m, tuning).toFixed(1)} Hz`,
          style: isBlack ? `--x:${whiteIndex}` : '',
        },
        !isBlack ? h('span', { class: 'key-label' }, pc === 0 ? prettyName(noteName(m, s.flats)) : '') : null,
      );
      key.addEventListener('pointerdown', (e) => {
        capturePointer(key, e.pointerId);
        pressedKeys.set(e.pointerId, m);
        void press(m);
      });
      const up = (e: PointerEvent) => {
        const mm = pressedKeys.get(e.pointerId);
        if (mm === undefined) return;
        pressedKeys.delete(e.pointerId);
        release(mm);
      };
      key.addEventListener('pointerup', up);
      key.addEventListener('pointercancel', up);
      key.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void toggleNote(m);
        }
      });
      if (isBlack) blacks.push(key);
      else {
        whites.push(key);
        whiteIndex++;
      }
    }
    keys.style.setProperty('--whites', String(whites.length));
    keys.replaceChildren(...whites, ...blacks);
    requestAnimationFrame(() => scrollPianoToOctave());
  }

  function scrollPianoToOctave() {
    const c = keys.querySelector(`[data-midi="${(octave() + 1) * 12}"]`) as HTMLElement | null;
    if (c) pianoScroll.scrollLeft = c.offsetLeft - 24;
  }

  /* ----- Status and controls ----- */
  const sounding = h('div', { class: 'sounding', 'aria-live': 'polite' });
  const sustainBtn = h('button', { class: 'chip toggle on', 'aria-pressed': 'true', onclick: () => {
    sustain = !sustain;
    sustainBtn.classList.toggle('on', sustain);
    sustainBtn.setAttribute('aria-pressed', String(sustain));
    if (!sustain) stopAll();
  } }, icon('sustain', 16), 'Sustain');

  function setOctave(o: number) {
    const next = Math.max(0, Math.min(7, o));
    updateSettings((s) => ({ drone: { ...s.drone, octave: next } }));
  }

  function render() {
    const s = getSettings();
    const tuning = tuningOf(s);
    const names = Array.from({ length: 12 }, (_, pc) => prettyName(noteName(pc, s.flats, false)));
    const on = new Set(activeNotes().map((m) => m));
    wedges.forEach((g, pc) => {
      const midi = (s.drone.octave + 1) * 12 + pc;
      (g.children[1] as SVGTextElement).textContent = names[pc];
      (g.children[2] as SVGTextElement).textContent = midiToFrequency(midi, tuning).toFixed(0);
      const anyOctave = [...on].some((m) => mod(m, 12) === pc);
      g.classList.toggle('on', on.has(midi));
      g.classList.toggle('on-other', !on.has(midi) && anyOctave);
    });
    octLabel.replaceChildren(h('span', { class: 'muted small' }, 'Octave'), h('b', null, String(s.drone.octave)));
    keys.querySelectorAll<HTMLElement>('.key').forEach((k) => k.classList.toggle('on', on.has(Number(k.dataset.midi))));
    const list = activeNotes();
    sounding.replaceChildren(
      ...(list.length
        ? list.map((m) => h('button', { class: 'note-pill', onclick: () => noteOff(m), 'aria-label': `Stop ${noteName(m, s.flats)}` }, h('b', null, prettyName(noteName(m, s.flats))), h('span', null, `${midiToFrequency(m, tuning).toFixed(2)} Hz`), icon('close', 14)))
        : [h('span', { class: 'muted' }, sustain ? 'Tap a note to start a drone. Tap again to stop it.' : 'Notes sound while you hold them.')]),
    );
    view.dataset.view = s.drone.view;
  }

  const viewSeg = segmented(
    [
      { value: 'wheel', label: 'Wheel', icon: 'wheel' },
      { value: 'keys', label: 'Keyboard', icon: 'keyboard' },
    ],
    s0.drone.view,
    (v) => {
      updateSettings((s) => ({ drone: { ...s.drone, view: v as Settings['drone']['view'] } }));
      if (v === 'keys') requestAnimationFrame(scrollPianoToOctave);
    },
    'Sound view',
  );
  const chordSeg = segmented(CHORDS.map((c) => ({ value: c.id, label: c.label })), s0.drone.chord, (v) => updateSettings((s) => ({ drone: { ...s.drone, chord: v } })), 'Play as');

  const exercise = exercisePlayer((midi) => {
    wedges.forEach((g, pc) => g.classList.toggle('exercise', midi !== null && mod(midi, 12) === pc));
    keys.querySelectorAll<HTMLElement>('.key').forEach((k) => k.classList.toggle('exercise', Number(k.dataset.midi) === midi));
  });

  const view = h(
    'section',
    { class: 'view sound' },
    h('div', { class: 'toolbar' }, viewSeg, h('div', { class: 'toolbar-end' }, sustainBtn, h('button', { class: 'chip ghost', onclick: stopAll }, icon('stop', 14), 'Stop all'))),
    h('div', { class: 'sound-stage' }, wheel, pianoScroll),
    sounding,
    h('div', { class: 'field center-field' }, h('span', { class: 'field-label' }, 'Play as'), chordSeg),
    h(
      'div',
      { class: 'grid two' },
      field(
        'Timbre',
        select(DRONE_TIMBRES.map((t) => ({ value: t.id, label: t.label })), s0.drone.timbre, (v) => {
          updateSettings((s) => ({ drone: { ...s.drone, timbre: v as DroneTimbre } }));
          setTimbreAll(v as DroneTimbre);
        }),
      ),
      field(
        'Volume',
        h('input', {
          type: 'range',
          min: 0,
          max: 1,
          step: 0.05,
          value: String(s0.drone.volume),
          oninput: (e: Event) => updateSettings((s) => ({ drone: { ...s.drone, volume: Number((e.target as HTMLInputElement).value) } })),
        }),
      ),
    ),
    h('p', { class: 'hint-line' }, 'Drones follow the reference pitch and temperament, and keep sounding on other screens.'),
    exercise.el,
  );
  root.append(view);
  buildPiano();
  render();

  let pianoKey = `${s0.flats}|${s0.a4}|${s0.notation}|${s0.temperament}|${s0.tonic}`;
  const offSettings = subscribeSettings((s) => {
    const key = `${s.flats}|${s.a4}|${s.notation}|${s.temperament}|${s.tonic}`;
    if (key !== pianoKey) {
      pianoKey = key;
      buildPiano();
    }
    render();
  });
  const offDrones = onDronesChange(render);

  return () => {
    offSettings();
    offDrones();
    exercise.dispose();
    if (!sustain) stopAll();
  };
}

/* ---------- Exercise player ---------- */

function exercisePlayer(onNote: (midi: number | null) => void): { el: HTMLElement; dispose: () => void } {
  let pattern: Pattern = 'major';
  let rootPc = 0;
  let octave = 4;
  let octaves = 1;
  let direction: Direction = 'upDown';
  let noteBeats = 1;
  let droneOn = true;
  let clickOn = false;
  let loop = false;
  let scheduler: LookaheadScheduler | null = null;
  let droneMidi: number | null = null;

  const status = h('span', { class: 'muted small' });
  const playBtn = h('button', { class: 'transport-play', 'aria-label': 'Play exercise', onclick: () => void toggle() }, icon('play', 20));
  const s0 = getSettings();

  let starting = false;
  let cancelled = false;

  function stop() {
    cancelled = true;
    scheduler?.stop();
    finish();
  }

  function finish() {
    playBtn.replaceChildren(icon('play', 20));
    onNote(null);
    // Only stop the root drone if the exercise started it; a drone the user was already playing stays on.
    if (droneMidi !== null) noteOff(droneMidi);
    droneMidi = null;
    status.textContent = '';
  }

  async function toggle() {
    if (scheduler?.isRunning || starting) return stop();
    starting = true;
    cancelled = false;
    const ctx = await ensureRunning();
    if (cancelled) {
      starting = false;
      return;
    }
    scheduler ??= new LookaheadScheduler(ctx);
    const root = (octave + 1) * 12 + rootPc;
    const notes = buildExercise(pattern, root, octaves, direction);
    const bpm = getSettings().metronome.bpm;
    const dur = (60 / bpm) * noteBeats;
    const s = getSettings();
    const tuning = tuningOf(s);
    if (droneOn) {
      const midi = root - 12;
      const created = await noteOn(midi);
      if (cancelled) {
        if (created) noteOff(midi);
        starting = false;
        return;
      }
      droneMidi = created ? midi : null;
    }
    starting = false;
    let i = 0;
    const lead = 2; // two clicks of count-in so you can come in
    playBtn.replaceChildren(icon('stop', 18));
    scheduler.start(
      () => {
        if (i >= notes.length + lead) return null;
        const idx = i++;
        return { time: idx * dur, bar: idx - lead, beat: 0, sub: 0, level: idx < lead ? 'accent' : 'normal', bpm, section: 0, countIn: idx < lead };
      },
      (e) => {
        if (e.countIn) {
          playClick(ctx, getMaster(), e.when, 'accent', 'tick', s.metronome.volume);
          return;
        }
        const midi = notes[e.bar];
        playTone(ctx, getMaster(), e.when, midiToFrequency(midi, tuning), dur * 0.92, s.drone.timbre, Math.max(0.35, s.drone.volume));
        if (clickOn) playClick(ctx, getMaster(), e.when, 'normal', s.metronome.sound, s.metronome.volume * 0.7);
      },
      (e) => {
        if (e.countIn) {
          status.textContent = `Count-in ${e.bar + lead + 1}`;
          return;
        }
        const midi = notes[e.bar];
        onNote(midi);
        status.textContent = `${prettyName(noteName(midi, getSettings().flats))} · ${e.bar + 1} of ${notes.length}`;
      },
      () => {
        finish();
        if (loop) void toggle();
      },
    );
  }

  const el = h(
    'div',
    { class: 'card exercise-card' },
    h('div', { class: 'card-head' }, h('h3', null, 'Exercise player'), h('span', { class: 'muted small' }, 'Plays at the metronome tempo')),
    h(
      'div',
      { class: 'grid exercise-grid' },
      field('Pattern', select(PATTERNS.map((p) => ({ value: p.id, label: p.label })), pattern, (v) => (pattern = v as Pattern))),
      field('Root', select(Array.from({ length: 12 }, (_, i) => ({ value: i, label: prettyName(noteName(i, s0.flats, false)) })), rootPc, (v) => (rootPc = Number(v)))),
      field('Starting octave', select([2, 3, 4, 5].map((o) => ({ value: o, label: String(o) })), octave, (v) => (octave = Number(v)))),
      field('Range', segmented(['1', '2', '3'].map((o) => ({ value: o, label: `${o} oct` })), String(octaves), (v) => (octaves = Number(v)), 'Range')),
      field('Direction', segmented([{ value: 'up', label: 'Up' }, { value: 'down', label: 'Down' }, { value: 'upDown', label: 'Up & down' }], direction, (v) => (direction = v as Direction), 'Direction')),
      field('Note length', segmented([{ value: '2', label: 'Half' }, { value: '1', label: 'Beat' }, { value: '0.5', label: 'Half beat' }], String(noteBeats), (v) => (noteBeats = Number(v)), 'Note length')),
    ),
    h(
      'div',
      { class: 'row wrap' },
      h('label', { class: 'chip toggle' }, h('input', { type: 'checkbox', checked: droneOn, onchange: (e: Event) => (droneOn = (e.target as HTMLInputElement).checked) }), 'Drone on root'),
      h('label', { class: 'chip toggle' }, h('input', { type: 'checkbox', checked: clickOn, onchange: (e: Event) => (clickOn = (e.target as HTMLInputElement).checked) }), 'Click'),
      h('label', { class: 'chip toggle' }, h('input', { type: 'checkbox', checked: loop, onchange: (e: Event) => (loop = (e.target as HTMLInputElement).checked) }), 'Loop'),
    ),
    h('div', { class: 'exercise-transport' }, playBtn, status),
  );
  return {
    el,
    dispose: () => {
      loop = false;
      stop();
    },
  };
}
