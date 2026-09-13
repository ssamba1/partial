// Original 24px stroke icons. Each value is the inner SVG markup.
const PATHS = {
  tuner: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-6"/><circle cx="12" cy="16" r="1.5"/>',
  metronome: '<path d="M8 3h8l3 18H5L8 3z"/><path d="M12 17l5-10"/><path d="M7 14h10"/>',
  sound: '<path d="M3 12h2M7 7v10M11 4v16M15 8v8M19 10v4M21 12h0"/>',
  analysis: '<path d="M3 20h18"/><path d="M4 16l4-6 4 3 4-8 4 5"/>',
  sheet: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 11h6M9 14h6M9 17h4"/>',
  clicktrack: '<path d="M4 6h10M4 12h16M4 18h7"/><circle cx="17" cy="6" r="2"/><circle cx="14" cy="18" r="2"/>',
  record: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
  practice: '<path d="M12 21a9 9 0 1 1 9-9"/><path d="M12 7v5l3 2"/><path d="M17 17l2 2 3-4"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>',
  play: '<path d="M8 5l11 7-11 7z" fill="currentColor"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  chevronDown: '<path d="M5 9l7 7 7-7"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  tap: '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M12 10.5a1.5 1.5 0 0 1 3 0V12a1.5 1.5 0 0 1 3 0v3a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5-2.7L4 14.5a1.5 1.5 0 0 1 2.5-1.6L9 16"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  blocks: '<rect x="3" y="10" width="4" height="10" rx="1"/><rect x="10" y="5" width="4" height="15" rx="1"/><rect x="17" y="10" width="4" height="10" rx="1"/>',
  pendulum: '<path d="M12 3v2"/><path d="M12 5l5 12"/><circle cx="17" cy="17" r="2.5"/><path d="M4 21h16"/>',
  pulse: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7" opacity=".5"/><circle cx="12" cy="12" r="10.5" opacity=".25"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M7 5v8M12 5v8M17 5v8M5 13h4M10 13h4M15 13h4"/>',
  wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3v5.5M12 15.5V21M3 12h5.5M15.5 12H21"/>',
  strings: '<path d="M6 3v18M10 3v18M14 3v18M18 3v18"/><path d="M4 8h16" opacity=".5"/>',
  ring: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 7.8 4.5" stroke-width="3"/>',
  bar: '<path d="M3 12h18"/><path d="M12 7v10" stroke-width="3"/>',
  strobe: '<path d="M4 5h3M10 5h3M16 5h3M3 12h2M8 12h2M13 12h2M18 12h2M5 19h4M13 19h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/>',
  sustain: '<path d="M4 17c3-8 13-8 16 0"/><path d="M4 17h16"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  sparkle: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 22, className = ''): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
  return tpl.content.firstElementChild as SVGSVGElement;
}
