import './styles.css';
import { h } from './ui/dom';
import { startRouter, type Route } from './ui/router';
import { metronome } from './ui/shared';
import { mountAnalysis } from './ui/views/analysis';
import { mountClickTrack } from './ui/views/clicktrack';
import { activeDroneCount, mountDrone, onDronesChange, stopAllDrones } from './ui/views/drone';
import { mountMetronome } from './ui/views/metronome';
import { applyTheme, mountPractice } from './ui/views/practice';
import { mountRecorder } from './ui/views/recorder';
import { mountTuner } from './ui/views/tuner';

const routes: Route[] = [
  { path: 'tuner', label: 'Tuner', icon: '\u{1F3AF}', mount: mountTuner },
  { path: 'metronome', label: 'Metronome', icon: '⏱', mount: mountMetronome },
  { path: 'drone', label: 'Drone', icon: '∿', mount: mountDrone },
  { path: 'clicktrack', label: 'Click track', icon: '≡', mount: mountClickTrack },
  { path: 'record', label: 'Record', icon: '●', mount: mountRecorder },
  { path: 'analysis', label: 'Analysis', icon: '\u{1F4C8}', mount: mountAnalysis },
  {
    path: 'sheet',
    label: 'Sheet music',
    icon: '\u{1D11E}',
    // pdf.js is large, so it only loads when this screen is opened.
    mount: (root) => {
      let cleanup: (() => void) | undefined;
      let cancelled = false;
      root.append(h('p', { class: 'muted' }, 'Loading sheet music reader…'));
      import('./ui/views/sheetmusic')
        .then(({ mountSheetMusic }) => {
          if (cancelled) return;
          root.replaceChildren();
          cleanup = mountSheetMusic(root);
        })
        .catch(() => {
          if (!cancelled) root.replaceChildren(h('p', { class: 'muted' }, 'Could not load the sheet music reader. Check your connection and reload.'));
        });
      return () => {
        cancelled = true;
        cleanup?.();
      };
    },
  },
  { path: 'practice', label: 'Practice', icon: '★', mount: mountPractice },
];

applyTheme();

const nav = h('nav', { class: 'tabs', 'aria-label': 'Sections' });
const heading = h('h1', { class: 'view-title' });
const outlet = h('main', { id: 'main', tabindex: '-1' });
const statusBar = h('div', { class: 'status-bar', 'aria-live': 'polite' });

function renderStatus() {
  const parts: HTMLElement[] = [];
  if (metronome.playing) {
    parts.push(h('button', { class: 'pill', onclick: () => metronome.stop() }, `⏱ ${metronome.settings.bpm} BPM · stop`));
  }
  const drones = activeDroneCount();
  if (drones) parts.push(h('button', { class: 'pill', onclick: stopAllDrones }, `∿ ${drones} drone${drones > 1 ? 's' : ''} · stop`));
  statusBar.replaceChildren(...parts);
  statusBar.hidden = parts.length === 0;
}
metronome.onState(renderStatus);
onDronesChange(renderStatus);
metronome.onBeat((e) => e.beat === 0 && e.sub === 0 && renderStatus());

nav.replaceChildren(
  ...routes.map((r) =>
    h('a', { href: `#/${r.path}`, 'data-path': r.path }, h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, r.icon), h('span', { class: 'tab-label' }, r.label)),
  ),
);

document.getElementById('app')!.replaceChildren(
  h('a', { class: 'skip', href: '#main', onclick: (e: Event) => { e.preventDefault(); outlet.focus(); } }, 'Skip to content'),
  h('header', { class: 'topbar' }, h('span', { class: 'brand' }, 'Resonare'), heading),
  statusBar,
  outlet,
  nav,
);

startRouter(routes, outlet, (route) => {
  heading.textContent = route.label;
  nav.querySelectorAll('a').forEach((a) => {
    const on = a.dataset.path === route.path;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  renderStatus();
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Offline support is optional; the app works without it.
    });
  });
}
