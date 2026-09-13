type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: string };

/** Minimal element builder: h('button', { class: 'x', onclick: fn }, 'Label'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2), value as EventListener);
      } else if (key === 'class') {
        el.className = String(value);
      } else if (key === 'style') {
        el.setAttribute('style', String(value));
      } else if (key in el && !key.includes('-')) {
        (el as unknown as Record<string, unknown>)[key] = value;
      } else {
        el.setAttribute(key, value === true ? '' : String(value));
      }
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: (Child | Child[])[]): void {
  for (const c of children) {
    if (Array.isArray(c)) append(el, c);
    else if (c === null || c === undefined || c === false) continue;
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function select<T extends string>(
  options: { value: T | number; label: string }[],
  value: T | number,
  onChange: (value: string) => void,
  props: Props = {},
): HTMLSelectElement {
  const el = h(
    'select',
    { ...props, onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) },
    options.map((o) => h('option', { value: String(o.value), selected: String(o.value) === String(value) }, o.label)),
  );
  return el;
}

export function field(label: string, control: HTMLElement, hint?: string): HTMLLabelElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('small', null, hint) : null);
}

export function numberInput(
  value: number,
  onChange: (n: number) => void,
  props: { min?: number; max?: number; step?: number; class?: string } = {},
): HTMLInputElement {
  return h('input', {
    type: 'number',
    value: String(value),
    ...props,
    onchange: (e: Event) => {
      const n = Number((e.target as HTMLInputElement).value);
      if (Number.isFinite(n)) onChange(n);
    },
  });
}

/** Resize a canvas backing store to its CSS size times devicePixelRatio. Returns the 2D context. */
export function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const hgt = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== hgt) {
    canvas.width = w;
    canvas.height = hgt;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function errorBox(message: string, retry?: () => void): HTMLElement {
  return h('div', { class: 'error-box', role: 'alert' }, h('p', null, message), retry ? h('button', { onclick: retry }, 'Try again') : null);
}
