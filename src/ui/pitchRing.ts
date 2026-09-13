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
  /** Pitch class to highlight on the outer ring (already transposed for display). */
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
}

/**
 * Chromatic ring tuner. Outer ring: the 12 pitch classes, current one lit.
 * Inner arc: deviation from the top (in tune) sweeping clockwise when sharp,
 * counter-clockwise when flat. Innermost ring fills while you hold the note in tune.
 */
export function createPitchRing(): PitchRing {
  const svg = svgEl('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'ring-svg', 'aria-hidden': 'true' });
  const defs = svgEl('defs', {});
  const glow = svgEl('filter', { id: 'ring-glow', x: '-50%', y: '-50%', width: '200%', height: '200%' });
  glow.append(svgEl('feGaussianBlur', { stdDeviation: 6, result: 'b' }));
  const merge = svgEl('feMerge', {});
  merge.append(svgEl('feMergeNode', { in: 'b' }), svgEl('feMergeNode', { in: 'SourceGraphic' }));
  glow.append(merge);
  defs.append(glow);
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
  const tip = svgEl('circle', { r: 9, class: 'ring-tip', filter: 'url(#ring-glow)' });
  // Small marker just inside the track pointing at the in-tune position.
  const topMark = svgEl('path', { d: `M ${C - 6} ${C - ARC_R + 20} L ${C + 6} ${C - ARC_R + 20} L ${C} ${C - ARC_R + 11} Z`, class: 'ring-topmark' });
  svg.append(zone, arc, tip, topMark);

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
  const labels: SVGTextElement[] = [];
  const dots: SVGCircleElement[] = [];
  // Place pitch classes like a clock with the detected note rotated to the top.
  for (let pc = 0; pc < 12; pc++) {
    const g = svgEl('g', { class: 'ring-note' });
    const dot = svgEl('circle', { r: 20, class: 'note-dot' });
    const text = svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'note-label' });
    g.append(dot, text);
    notes.append(g);
    labels.push(text);
    dots.push(dot);
  }
  const notesRotor = svgEl('g', { class: 'ring-notes-rotor' });
  notesRotor.append(notes);
  svg.append(notesRotor);

  const center = h('div', { class: 'ring-center' });
  const el = h('div', { class: 'pitch-ring' }, svg, center);

  let rotation = 0;
  let lastPc: number | null = null;

  const layoutNotes = (flats: boolean) => {
    for (let pc = 0; pc < 12; pc++) {
      const [x, y] = polar(NOTE_R, pc * 30);
      dots[pc].setAttribute('cx', String(x));
      dots[pc].setAttribute('cy', String(y));
      labels[pc].setAttribute('x', String(x));
      labels[pc].setAttribute('y', String(y));
      const name = prettyName(noteName(pc, flats, false));
      labels[pc].textContent = name;
      labels[pc].classList.toggle('long', name.length > 2);
    }
  };
  let lastKey = '';

  const update = (r: RingReading, tolerance: number, flats: boolean, range = 50) => {
    drawScale(range);
    el.dataset.range = String(range);
    const key = `${flats}|${noteName(0, flats, false)}`;
    if (key !== lastKey) {
      layoutNotes(flats);
      lastKey = key;
    }
    const tol = centsToDegrees(Math.max(0.5, tolerance), range);
    zone.setAttribute('d', arcPath(ARC_R, -tol, tol));

    if (r.pitchClass !== null && r.pitchClass !== lastPc) {
      // Rotate the shortest way so the detected note sits at the top.
      const target = -r.pitchClass * 30;
      let delta = (target - rotation) % 360;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      rotation += delta;
      notesRotor.style.transform = `rotate(${rotation}deg)`;
      // Counter-rotate labels with the same transition so they stay upright while the rotor turns.
      labels.forEach((l) => (l.style.transform = `rotate(${-rotation}deg)`));
      lastPc = r.pitchClass;
    }
    for (let pc = 0; pc < 12; pc++) {
      dots[pc].parentElement!.classList.toggle('active', pc === r.pitchClass);
    }

    const active = r.pitchClass !== null;
    el.classList.toggle('idle', !active);
    el.classList.toggle('in-tune', active && r.inTune);
    el.classList.toggle('sharp', active && !r.inTune && r.cents > 0);
    el.classList.toggle('flat', active && !r.inTune && r.cents < 0);
    el.classList.toggle('locked', active && r.hold >= 1);

    const deg = active ? centsToDegrees(r.cents, range) : 0;
    arc.setAttribute('d', active ? arcPath(ARC_R, Math.min(0, deg), Math.max(0, deg)) : '');
    const [tx, ty] = polar(ARC_R, deg);
    tip.setAttribute('cx', String(tx));
    tip.setAttribute('cy', String(ty));
    hold.setAttribute('stroke-dasharray', `${Math.max(0, Math.min(1, r.hold)) * holdCirc} ${holdCirc}`);
  };

  return { el, center, update };
}
