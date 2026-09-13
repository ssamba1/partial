import { centsToDegrees, ringLabels, ringTicks, signedLabel } from '../core/display';
import { noteName, prettyName } from '../core/notes';
import { svgEl } from './components';
import { h } from './dom';

const SIZE = 360;
const C = SIZE / 2;
const NOTE_R = 162;
const ARC_R = 120;
const HOLD_R = 96;

function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [C + Math.sin(a) * r, C - Math.cos(a) * r];
}

function arcPath(r: number, fromDeg: number, toDeg: number): string {
  if (Math.abs(toDeg - fromDeg) < 0.01) return '';
  const [x1, y1] = polar(r, fromDeg);
  const [x2, y2] = polar(r, toDeg);
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  const sweep = toDeg > fromDeg ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} ${sweep} ${x2} ${y2}`;
}

export interface RingReading {
  /** Slot to highlight on the outer ring: the pitch class (already transposed for display), or the step of a non-12 tuning. */
  pitchClass: number | null;
  cents: number;
  inTune: boolean;
  /** 0..1 progress of holding in tune. */
  hold: number;
}

export interface PitchRing {
  el: HTMLElement;
  center: HTMLElement;
  /** `range` is the cents either side of the top that the arc spans. */
  update: (r: RingReading, tolerance: number, flats: boolean, range?: number) => void;
  /** Keep C at the top instead of turning the detected note to the top. */
  setFixed: (fixed: boolean) => void;
  /** Small text under each pitch class label (index = pitch class), or empty strings for none. */
  setOffsets: (texts: string[]) => void;
  /** Names of the slots for a tuning with other than 12 notes, or null for the 12 note names. */
  setDivisions: (names: string[] | null) => void;
  /** Called with the slot tapped or long-pressed, for note lock and hearing a note. */
  onNote: (fn: (slot: number, long: boolean) => void) => void;
}

/**
 * Chromatic ring tuner. Outer ring: the pitch classes (12, or the steps of
 * another equal division), current one lit. Inner arc: deviation from the top
 * (in tune) sweeping clockwise when sharp, counter-clockwise when flat.
 * Innermost ring fills while you hold the note in tune.
 */
export function createPitchRing(): PitchRing {
  const svg = svgEl('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'ring-svg', 'aria-hidden': 'true' });
  // A soft halo drawn with a gradient rather than a blur filter, which would repaint on every frame the tip moves.
  const defs = svgEl('defs', {});
  const halo = svgEl('radialGradient', { id: 'ring-halo' });
  halo.append(svgEl('stop', { offset: '0', class: 'halo-stop', 'stop-opacity': '0.55' }), svgEl('stop', { offset: '1', class: 'halo-stop', 'stop-opacity': '0' }));
  defs.append(halo);
  svg.append(defs);

  // Cents scale ticks around the arc radius, numbered at half and full scale.
  const scale = svgEl('g', { class: 'ring-scale' });
  let scaleRange = 0;
  const drawScale = (range: number) => {
    if (range === scaleRange) return;
    scaleRange = range;
    scale.replaceChildren();
    for (const t of ringTicks(range)) {
      const deg = centsToDegrees(t.cents, range);
      const [x1, y1] = polar(ARC_R + 12, deg);
      const [x2, y2] = polar(ARC_R + (t.long ? 22 : 17), deg);
      scale.append(svgEl('line', { x1, y1, x2, y2, class: t.long ? 'tick long' : 'tick' }));
    }
    for (const c of ringLabels(range)) {
      const [x, y] = polar(ARC_R - 17, centsToDegrees(c, range));
      const label = svgEl('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'scale-label' });
      label.textContent = signedLabel(c);
      scale.append(label);
    }
  };
  drawScale(50);
  svg.append(scale);

  svg.append(svgEl('circle', { cx: C, cy: C, r: ARC_R, class: 'ring-track' }));
  const zone = svgEl('path', { class: 'ring-zone' });
  const arc = svgEl('path', { class: 'ring-arc' });
  const haloDot = svgEl('circle', { r: 22, class: 'ring-halo', fill: 'url(#ring-halo)' });
  const tip = svgEl('circle', { r: 9, class: 'ring-tip' });
  // Small marker just inside the track pointing at the in-tune position.
  const topMark = svgEl('path', { d: `M ${C - 6} ${C - ARC_R + 20} L ${C + 6} ${C - ARC_R + 20} L ${C} ${C - ARC_R + 11} Z`, class: 'ring-topmark' });
  svg.append(zone, arc, haloDot, tip, topMark);

  const holdTrack = svgEl('circle', { cx: C, cy: C, r: HOLD_R, class: 'hold-track' });
  const holdCirc = 2 * Math.PI * HOLD_R;
  const hold = svgEl('circle', {
    cx: C,
    cy: C,
    r: HOLD_R,
    class: 'hold-fill',
    'stroke-dasharray': `0 ${holdCirc}`,
    transform: `rotate(-90 ${C} ${C})`,
  });
  svg.append(holdTrack, hold);

  const notes = svgEl('g', { class: 'ring-notes' });
  /** Label groups (name plus optional offset), counter-rotated so they stay upright. */
  let labels: SVGGElement[] = [];
  let names: SVGTextElement[] = [];
  let offsets: SVGTextElement[] = [];
  let dots: SVGCircleElement[] = [];
  let divisions = 12;
  let customNames: string[] | null = null;
  const step = () => 360 / divisions;
  let noteHandler: ((slot: number, long: boolean) => void) | null = null;

  const buildSlots = () => {
    notes.replaceChildren();
    labels = [];
    names = [];
    offsets = [];
    dots = [];
    // Smaller dots when the ring holds more than 12 notes.
    const r = divisions > 12 ? Math.max(8, Math.round((20 * 12) / divisions)) : 20;
    for (let pc = 0; pc < divisions; pc++) {
      const g = svgEl('g', { class: 'ring-note' });
      const dot = svgEl('circle', { r, class: 'note-dot' });
      const text = svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'note-label' });
      const offset = svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'note-offset' });
      const textGroup = svgEl('g', { class: 'note-text' });
      textGroup.append(text, offset);
      g.append(dot, textGroup);
      // Tap a note to lock the tuner to it; hold to hear it.
      let pressTimer = 0;
      let longFired = false;
      g.addEventListener('pointerdown', (e) => {
        if (!noteHandler) return;
        e.stopPropagation();
        longFired = false;
        pressTimer = window.setTimeout(() => {
          longFired = true;
          noteHandler?.(pc, true);
        }, 550);
      });
      const cancel = () => window.clearTimeout(pressTimer);
      g.addEventListener('pointerup', cancel);
      g.addEventListener('pointerleave', cancel);
      g.addEventListener('pointercancel', cancel);
      g.addEventListener('click', (e) => {
        if (!noteHandler) return;
        e.stopPropagation();
        if (!longFired) noteHandler(pc, false);
      });
      notes.append(g);
      labels.push(textGroup);
      names.push(text);
      offsets.push(offset);
      dots.push(dot);
    }
  };
  buildSlots();
  const notesRotor = svgEl('g', { class: 'ring-notes-rotor' });
  notesRotor.append(notes);
  svg.append(notesRotor);

  const center = h('div', { class: 'ring-center' });
  const el = h('div', { class: 'pitch-ring' }, svg, center);

  let rotation = 0;
  let offsetsOn = false;
  let lastPc: number | null = null;
  let lastTurnAt = -Infinity;
  let fixed = false;
  // Last written values, so an unchanged frame writes nothing to the DOM.
  let zoneKey = '';
  let activePc: number | null = -1;
  let stateKey = '';
  let arcKey = '';
  let holdKey = '';

  const layoutNotes = (flats: boolean) => {
    for (let pc = 0; pc < divisions; pc++) {
      const [x, y] = polar(NOTE_R, pc * step());
      dots[pc].setAttribute('cx', String(x));
      dots[pc].setAttribute('cy', String(y));
      names[pc].setAttribute('x', String(x));
      names[pc].setAttribute('y', String(y - (offsetsOn ? 5 : 0)));
      offsets[pc].setAttribute('x', String(x));
      offsets[pc].setAttribute('y', String(y + 8));
      const name = customNames ? customNames[pc] : prettyName(noteName(pc, flats, false));
      names[pc].textContent = name;
      names[pc].classList.toggle('long', name.length > 2);
      labels[pc].style.transform = `rotate(${-rotation}deg)`;
    }
    el.classList.toggle('many-notes', divisions > 12);
  };
  let lastKey = '';

  const update = (r: RingReading, tolerance: number, flats: boolean, range = 50) => {
    drawScale(range);
    el.dataset.range = String(range);
    const key = `${flats}|${noteName(0, flats, false)}|${noteName(1, flats, false)}|${divisions}|${customNames?.join(',') ?? ''}`;
    if (key !== lastKey) {
      layoutNotes(flats);
      lastKey = key;
    }
    const tol = centsToDegrees(Math.max(0.5, tolerance), range);
    const zk = `${tol}`;
    if (zk !== zoneKey) {
      zoneKey = zk;
      zone.setAttribute('d', arcPath(ARC_R, -tol, tol));
    }

    const slot = r.pitchClass !== null && r.pitchClass < divisions ? r.pitchClass : null;
    if (slot !== null && slot !== lastPc) {
      // Rotate the shortest way so the detected note sits at the top.
      const target = fixed ? 0 : -slot * step();
      let delta = (target - rotation) % 360;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      // In a fast passage the ring would always be mid-turn: jump straight to the note instead.
      const now = performance.now();
      el.classList.toggle('snap', now - lastTurnAt < 300);
      lastTurnAt = now;
      if (delta !== 0) {
        rotation += delta;
        notesRotor.style.transform = `rotate(${rotation}deg)`;
        // Counter-rotate labels with the same transition so they stay upright while the rotor turns.
        labels.forEach((l) => (l.style.transform = `rotate(${-rotation}deg)`));
      }
      lastPc = slot;
    }
    if (slot !== activePc) {
      if (activePc !== null && activePc >= 0) dots[activePc]?.parentElement!.classList.remove('active');
      if (slot !== null) dots[slot].parentElement!.classList.add('active');
      activePc = slot;
    }

    const active = slot !== null;
    const state = !active ? 'idle' : r.inTune ? 'in-tune' : r.cents > 0 ? 'sharp' : r.cents < 0 ? 'flat' : '';
    const sk = `${state}|${active && r.hold >= 1}`;
    if (sk !== stateKey) {
      stateKey = sk;
      el.classList.toggle('idle', !active);
      el.classList.toggle('in-tune', state === 'in-tune');
      el.classList.toggle('sharp', state === 'sharp');
      el.classList.toggle('flat', state === 'flat');
      el.classList.toggle('locked', active && r.hold >= 1);
    }

    const deg = active ? centsToDegrees(r.cents, range) : 0;
    const ak = `${active}|${deg.toFixed(2)}`;
    if (ak !== arcKey) {
      arcKey = ak;
      arc.setAttribute('d', active ? arcPath(ARC_R, Math.min(0, deg), Math.max(0, deg)) : '');
      const [tx, ty] = polar(ARC_R, deg);
      tip.setAttribute('cx', String(tx));
      tip.setAttribute('cy', String(ty));
      haloDot.setAttribute('cx', String(tx));
      haloDot.setAttribute('cy', String(ty));
    }
    const hk = (Math.max(0, Math.min(1, r.hold)) * holdCirc).toFixed(1);
    if (hk !== holdKey) {
      holdKey = hk;
      hold.setAttribute('stroke-dasharray', `${hk} ${holdCirc}`);
    }
  };

  /** Fixed ring: C stays at the top and the detected note lights up where it is. */
  const setFixed = (on: boolean) => {
    if (on === fixed) return;
    fixed = on;
    lastPc = null;
    if (on) {
      rotation = 0;
      notesRotor.style.transform = 'rotate(0deg)';
      labels.forEach((l) => (l.style.transform = 'rotate(0deg)'));
    }
  };

  /** Small text under each pitch class label, such as the temperament's offset from equal. Empty strings hide it. */
  const setOffsets = (texts: string[]) => {
    const any = divisions === 12 && texts.some((t) => t);
    for (let pc = 0; pc < divisions; pc++) {
      const t = any ? (texts[pc] ?? '') : '';
      if (offsets[pc].textContent !== t) offsets[pc].textContent = t;
      // Lift the name to make room for the offset under it.
      const y = String(polar(NOTE_R, pc * step())[1] - (any ? 5 : 0));
      if (names[pc].getAttribute('y') !== y) names[pc].setAttribute('y', y);
    }
    offsetsOn = any;
    el.classList.toggle('with-offsets', any);
  };

  const setDivisions = (list: string[] | null) => {
    const n = list?.length ?? 12;
    const same = n === divisions && (list?.join(',') ?? '') === (customNames?.join(',') ?? '');
    if (same) return;
    const rebuild = n !== divisions;
    divisions = n;
    customNames = list && list.length ? list : null;
    if (rebuild) {
      buildSlots();
      activePc = -1;
    }
    lastPc = null;
    lastKey = '';
    if (!fixed) {
      rotation = 0;
      notesRotor.style.transform = 'rotate(0deg)';
    }
  };

  const onNote = (fn: (slot: number, long: boolean) => void) => {
    noteHandler = fn;
  };

  return { el, center, update, setFixed, setOffsets, setDivisions, onNote };
}
