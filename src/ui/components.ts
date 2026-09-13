import { angleDelta, dialSteps, holdRepeatDelay, pointAngle } from '../core/gestures';
import { h } from './dom';
import { icon, type IconName } from './icons';

/** Short vibration on devices that support it, only after the user has interacted (browsers block it otherwise). */
export function haptic(ms: number | number[]): void {
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (activation && !activation.hasBeenActive) return;
  navigator.vibrate?.(ms);
}

/** Pointer capture that never throws (it rejects pointers that are no longer active). */
export function capturePointer(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Pointer already released; the gesture still works without capture.
  }
}

/* ---------- Segmented control ---------- */

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export function segmented<T extends string>(
  options: SegmentOption<T>[],
  value: T,
  onChange: (v: T) => void,
  ariaLabel: string,
): HTMLElement & { set: (v: T) => void } {
  const buttons = options.map((o) =>
    h(
      'button',
      {
        class: 'seg-btn',
        role: 'radio',
        'aria-checked': o.value === value ? 'true' : 'false',
        'data-value': o.value,
        onclick: () => {
          set(o.value);
          onChange(o.value);
        },
      },
      o.icon ? icon(o.icon, 18) : null,
      h('span', null, o.label),
    ),
  );
  const el = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': ariaLabel }, buttons) as unknown as HTMLElement & { set: (v: T) => void };
  function set(v: T) {
    buttons.forEach((b) => b.setAttribute('aria-checked', b.dataset.value === v ? 'true' : 'false'));
  }
  el.set = set;
  return el;
}

/* ---------- Icon button ---------- */

export function iconButton(name: IconName, label: string, onclick: (e: MouseEvent) => void, cls = ''): HTMLButtonElement {
  return h('button', { class: `icon-btn ${cls}`, 'aria-label': label, title: label, onclick }, icon(name, 20));
}

/* ---------- Press-and-hold repeat button ---------- */

export function holdButton(content: Node, label: string, onStep: () => void, cls = ''): HTMLButtonElement {
  let timer = 0;
  let count = 0;
  let firedByPointer = false;
  const stop = () => {
    window.clearTimeout(timer);
    timer = 0;
  };
  const tick = () => {
    onStep();
    count++;
    timer = window.setTimeout(tick, holdRepeatDelay(count));
  };
  const btn = h('button', {
    class: cls,
    'aria-label': label,
    title: `${label} (hold to repeat)`,
    onpointerdown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      firedByPointer = true;
      count = 0;
      capturePointer(e.currentTarget as HTMLElement, e.pointerId);
      onStep();
      timer = window.setTimeout(tick, 420);
    },
    onpointerup: stop,
    onpointercancel: stop,
    onlostpointercapture: stop,
    onclick: () => {
      // Keyboard activation (Enter/Space) arrives as a click without pointer events.
      if (!firedByPointer) onStep();
      firedByPointer = false;
    },
  });
  btn.append(content);
  return btn;
}

/* ---------- Bottom sheet / popover ---------- */

let openSheetClose: (() => void) | null = null;

export function openSheet(title: string, content: HTMLElement, opts: { onClose?: () => void; wide?: boolean } = {}): () => void {
  openSheetClose?.();
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const panel = h(
    'div',
    { class: `sheet${opts.wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
    h('header', { class: 'sheet-head' }, h('h2', null, title), iconButton('close', 'Close', () => close())),
    h('div', { class: 'sheet-body' }, content),
  );
  const scrim = h('div', { class: 'scrim', onclick: () => close() });
  const layer = h('div', { class: 'sheet-layer' }, scrim, panel);
  document.body.append(layer);
  requestAnimationFrame(() => layer.classList.add('open'));

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener('keydown', onKey, true);
  (panel.querySelector('button, input, select') as HTMLElement | null)?.focus();

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKey, true);
    layer.classList.remove('open');
    setTimeout(() => layer.remove(), 220);
    if (openSheetClose === close) openSheetClose = null;
    previouslyFocused?.focus?.();
    opts.onClose?.();
  }
  openSheetClose = close;
  return close;
}

/* ---------- Toast ---------- */

export function toast(message: string): void {
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2200);
}

/* ---------- Rotary dial ---------- */

export interface DialOptions {
  min: number;
  max: number;
  get: () => number;
  set: (v: number) => void;
  degreesPerStep?: number;
  label: string;
  center: HTMLElement;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Circular drag control: spin clockwise to raise the value, like a jog wheel. Also wheel and arrow keys. */
export function dial(opts: DialOptions): HTMLElement & { refresh: () => void } {
  const size = 280;
  const r = 124;
  const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, class: 'dial-svg', 'aria-hidden': 'true' });
  const ticks = svgEl('g', { class: 'dial-ticks' });
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const long = i % 5 === 0;
    const r1 = r - (long ? 14 : 8);
    ticks.append(
      svgEl('line', {
        x1: size / 2 + Math.sin(a) * r1,
        y1: size / 2 - Math.cos(a) * r1,
        x2: size / 2 + Math.sin(a) * (r - 2),
        y2: size / 2 - Math.cos(a) * (r - 2),
        class: long ? 'tick long' : 'tick',
      }),
    );
  }
  const track = svgEl('circle', { cx: size / 2, cy: size / 2, r: r + 10, class: 'dial-track' });
  const circumference = 2 * Math.PI * (r + 10);
  const progress = svgEl('circle', {
    cx: size / 2,
    cy: size / 2,
    r: r + 10,
    class: 'dial-progress',
    'stroke-dasharray': `0 ${circumference}`,
    transform: `rotate(-90 ${size / 2} ${size / 2})`,
  });
  const rotor = svgEl('g', { class: 'dial-rotor' });
  rotor.append(ticks, svgEl('circle', { cx: size / 2, cy: size / 2 - r + 28, r: 7, class: 'dial-knob' }));
  svg.append(track, progress, rotor);

  const el = h(
    'div',
    {
      class: 'dial',
      role: 'slider',
      tabindex: '0',
      'aria-label': opts.label,
      'aria-valuemin': String(opts.min),
      'aria-valuemax': String(opts.max),
    },
    svg,
    h('div', { class: 'dial-center' }, opts.center),
  ) as unknown as HTMLElement & { refresh: () => void };

  const per = opts.degreesPerStep ?? 4;
  let rotation = 0;
  let accum = 0;
  let lastAngle = 0;
  let dragging = false;

  const apply = (steps: number) => {
    if (!steps) return;
    const next = Math.min(opts.max, Math.max(opts.min, opts.get() + steps));
    if (next !== opts.get()) {
      opts.set(next);
      haptic(4);
    }
  };

  el.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.dial-center button, .dial-center input')) return;
    dragging = true;
    capturePointer(el, e.pointerId);
    const rect = el.getBoundingClientRect();
    lastAngle = pointAngle(rect.left + rect.width / 2, rect.top + rect.height / 2, e.clientX, e.clientY);
    accum = 0;
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const rect = el.getBoundingClientRect();
    const a = pointAngle(rect.left + rect.width / 2, rect.top + rect.height / 2, e.clientX, e.clientY);
    const d = angleDelta(lastAngle, a);
    lastAngle = a;
    rotation += d;
    rotor.setAttribute('transform', `rotate(${rotation} ${size / 2} ${size / 2})`);
    const { steps, remainder } = dialSteps(accum + d, per);
    accum = remainder;
    apply(steps);
  });
  const end = () => {
    dragging = false;
    el.classList.remove('dragging');
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const steps = e.deltaY < 0 ? 1 : -1;
      rotation += steps * per;
      rotor.setAttribute('transform', `rotate(${rotation} ${size / 2} ${size / 2})`);
      apply(steps);
    },
    { passive: false },
  );
  el.addEventListener('keydown', (e) => {
    const big = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') apply(big);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') apply(-big);
    else if (e.key === 'PageUp') apply(10);
    else if (e.key === 'PageDown') apply(-10);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  el.refresh = () => {
    const v = opts.get();
    const frac = (v - opts.min) / (opts.max - opts.min);
    progress.setAttribute('stroke-dasharray', `${frac * circumference} ${circumference}`);
    el.setAttribute('aria-valuenow', String(v));
  };
  el.refresh();
  return el;
}

export { svgEl };
