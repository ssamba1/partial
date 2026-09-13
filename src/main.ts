import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import './styles.css';
import { activeNotes, onDronesChange, stopAll } from './audio/droneBank';
import { noteName, transpositionShort } from './core/notes';
import { getSettings, subscribeSettings, updateSettings } from './store/settings';
import { holdButton, iconButton, openSheet, toast } from './ui/components';
import { installGlobalShortcuts, restoreMidi } from './ui/controls';
import { h } from './ui/dom';
import { icon, type IconName } from './ui/icons';
import { startRouter, type Route } from './ui/router';
import { metronome, onSession, resetSession } from './ui/shared';
import { openTuningSheet, tuningSummary } from './ui/tuningSheet';
import { mountAnalysis } from './ui/views/analysis';
import { mountClickTrack } from './ui/views/clicktrack';
import { mountMetronome, setMetronome } from './ui/views/metronome';
import { applyTheme, mountPractice } from './ui/views/practice';
import { mountRecorder } from './ui/views/recorder';
import { mountSound } from './ui/views/sound';
import { mountTuner } from './ui/views/tuner';

interface AppRoute extends Route {
  iconName: IconName;
  primary: boolean;
}

function lazySheetMusic(root: HTMLElement) {
  let cleanup: (() => void) | undefined;
  let cancelled = false;
  root.append(h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'Loading the sheet music reader…'));
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
}

const routes: AppRoute[] = [
  { path: 'tuner', label: 'Tuner', iconName: 'tuner', primary: true, mount: mountTuner },
  { path: 'metronome', label: 'Metronome', iconName: 'metronome', primary: true, mount: mountMetronome },
  { path: 'sound', label: 'Sound', iconName: 'sound', primary: true, mount: mountSound },
  { path: 'analysis', label: 'Analysis', iconName: 'analysis', primary: true, mount: mountAnalysis },
  { path: 'record', label: 'Record', iconName: 'record', primary: false, mount: mountRecorder },
  { path: 'clicktrack', label: 'Click tracks', iconName: 'clicktrack', primary: false, mount: mountClickTrack },
  { path: 'sheet', label: 'Sheet music', iconName: 'sheet', primary: false, mount: lazySheetMusic },
  { path: 'practice', label: 'Practice', iconName: 'practice', primary: false, mount: mountPractice },
];

// Old links from the first version.
if (location.hash === '#/drone') location.hash = '#/sound';

applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

/* ---------- Navigation ---------- */

const navLink = (r: AppRoute, cls: string) =>
  h('a', { href: `#/${r.path}`, class: cls, 'data-path': r.path }, icon(r.iconName, 22), h('span', null, r.label));

const rail = h(
  'nav',
  { class: 'rail', 'aria-label': 'Sections' },
  h('a', { class: 'rail-brand', href: '#/tuner', 'aria-label': 'Partial home' }, h('span', { class: 'logo-mark', 'aria-hidden': 'true' }), h('span', null, 'Partial')),
  h('div', { class: 'rail-group' }, routes.filter((r) => r.primary).map((r) => navLink(r, 'rail-link'))),
  h('div', { class: 'rail-label' }, 'Practice tools'),
  h('div', { class: 'rail-group' }, routes.filter((r) => !r.primary).map((r) => navLink(r, 'rail-link'))),
);

function openMore() {
  let close = () => {};
  const grid = h(
    'div',
    { class: 'more-grid' },
    routes
      .filter((r) => !r.primary)
      .map((r) =>
        h('a', { href: `#/${r.path}`, class: 'more-tile', onclick: () => close() }, h('span', { class: 'more-icon' }, icon(r.iconName, 26)), h('span', null, r.label)),
      ),
  );
  close = openSheet('More tools', grid);
}

const moreBtn = h('button', { class: 'tab-link', onclick: openMore, 'data-more': 'true' }, icon('more', 22), h('span', null, 'More'));
const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Sections' }, routes.filter((r) => r.primary).map((r) => navLink(r, 'tab-link')), moreBtn);

/* ---------- Top bar ---------- */

const title = h('h1', { class: 'page-title' });
const tuningLong = h('span', { class: 'long' });
const tuningShort = h('span', { class: 'short' });
const tuningChip = h('button', { class: 'tuning-chip', onclick: openTuningSheet, 'aria-label': 'Tuning settings' }, icon('tuner', 16), tuningLong, tuningShort);
function renderTuningChip() {
  tuningLong.textContent = tuningSummary();
  const s = getSettings();
  tuningShort.textContent = `${s.a4 % 1 ? s.a4.toFixed(1) : s.a4}${transpositionShort(s.transposition) ? ` ${transpositionShort(s.transposition)}` : ''}`;
}
const sessionFill = h('i');
const sessionText = h('span');
const sessionChip = h(
  'button',
  { class: 'session-chip', title: 'Share of notes in tune this session. Tap to reset.', onclick: () => resetSession() },
  h('span', { class: 'session-bar' }, sessionFill),
  sessionText,
);
onSession(({ voiced, inTune }) => {
  sessionChip.hidden = voiced < 30;
  const pct = voiced ? Math.round((inTune / voiced) * 100) : 0;
  sessionFill.style.width = `${pct}%`;
  sessionText.textContent = `${pct}% in tune`;
});

function openHelp() {
  const row = (keys: string[], text: string) => h('div', { class: 'shortcut' }, h('span', null, ...keys.map((k) => h('kbd', null, k))), h('span', null, text));
  openSheet(
    'Shortcuts and tips',
    h(
      'div',
      { class: 'stack' },
      row(['Space'], 'Start or stop the tuner, metronome, click track or analysis on the current screen'),
      row(['Enter'], 'Tuner: play the target of the last note'),
      row(['R', 'B', 'S'], 'Tuner: ring, bar or strobe display'),
      row(['[', ']'], 'Tuner: lower or raise A4 by 0.5 Hz'),
      row(['←', '→'], 'Tuner strings mode: previous or next string'),
      row(['M'], 'Metronome on or off from any screen'),
      row(['D'], 'Stop all drones'),
      row(['1', '9'], 'Jump to a screen, in the order of the menu'),
      row(['↑', '↓'], 'Change tempo (hold Shift for 10)'),
      row(['T'], 'Tap tempo'),
      row(['\u2190', '\u2192'], 'Turn pages in sheet music'),
      row(['Esc'], 'Close a panel'),
      h('p', { class: 'muted small' }, 'Every button that repeats when held (tempo, reference pitch, octave) also works with a single tap. The tempo dial can be spun with a finger, a mouse wheel or the arrow keys. Foot pedals and MIDI controllers can be assigned under Practice.'),
    ),
  );
}

const topbar = h(
  'header',
  { class: 'topbar' },
  h('span', { class: 'logo-mark small', 'aria-hidden': 'true' }),
  title,
  h('div', { class: 'topbar-end' }, sessionChip, tuningChip, iconButton('help', 'Shortcuts and tips', openHelp)),
);

/* ---------- Mini transport dock ---------- */

const dockPlay = h('button', { class: 'dock-play', onclick: () => metronome.toggle(), 'aria-label': 'Start metronome' });
const dockBpm = h('a', { class: 'dock-bpm', href: '#/metronome', 'aria-label': 'Open metronome' });
const dockBeats = h('div', { class: 'dock-beats', 'aria-hidden': 'true' });
const dockDrones = h('div', { class: 'dock-drones' });
const dock = h(
  'div',
  { class: 'dock', role: 'region', 'aria-label': 'Quick metronome' },
  dockPlay,
  holdButton(icon('minus', 16), 'Slower', () => setMetronome({ bpm: getSettings().metronome.bpm - 1 }), 'dock-step'),
  dockBpm,
  holdButton(icon('plus', 16), 'Faster', () => setMetronome({ bpm: getSettings().metronome.bpm + 1 }), 'dock-step'),
  dockBeats,
  dockDrones,
);

function renderDock() {
  const m = getSettings().metronome;
  dockPlay.replaceChildren(icon(metronome.playing ? 'stop' : 'play', 18));
  dockPlay.setAttribute('aria-label', metronome.playing ? 'Stop metronome' : 'Start metronome');
  dock.classList.toggle('playing', metronome.playing);
  dockBpm.replaceChildren(h('b', null, String(metronome.settings.bpm)), h('span', null, `BPM · ${m.beatsPerBar}/${m.beatUnit}`));
  if (dockBeats.children.length !== m.beatsPerBar) dockBeats.replaceChildren(...Array.from({ length: m.beatsPerBar }, () => h('i')));
  const notes = activeNotes();
  dockDrones.replaceChildren(
    ...(notes.length
      ? [h('button', { class: 'dock-drone', onclick: stopAll, 'aria-label': 'Stop all drones' }, icon('sound', 14), notes.slice(0, 3).map((n) => noteName(n, getSettings().flats)).join(' '), notes.length > 3 ? '…' : '', icon('close', 12))]
      : []),
  );
}
metronome.onState(renderDock);
metronome.onBeat((e) => {
  if (e.sub !== 0 || e.layer) return;
  [...dockBeats.children].forEach((c, i) => c.classList.toggle('on', i === e.beat));
  if (e.beat === 0) renderDock();
});
// The system can suspend audio mid-session (a phone call, another app). Say so and offer a resume.
const stallBanner = h(
  'button',
  { class: 'stall-banner', hidden: true, onclick: () => void metronome.resume() },
  'Audio paused by the system. Tap to resume.',
);
metronome.onStall((stalled) => {
  stallBanner.hidden = !stalled;
});
let silentTipShown = false;
metronome.onState((playing) => {
  // iOS before audioSession support mutes web audio with the silent switch.
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (playing && ios && !('audioSession' in navigator) && !silentTipShown) {
    silentTipShown = true;
    toast('No sound? Check the silent switch.');
  }
});
onDronesChange(() => {
  renderDock();
  // The key can follow the lowest drone.
  renderTuningChip();
});
subscribeSettings(() => {
  renderDock();
  renderTuningChip();
});

/* ---------- Mount ---------- */

const outlet = h('main', { id: 'main', tabindex: '-1' });
document.getElementById('app')!.replaceChildren(
  h('a', { class: 'skip', href: '#main', onclick: (e: Event) => { e.preventDefault(); outlet.focus(); } }, 'Skip to content'),
  rail,
  h('div', { class: 'app-main' }, topbar, outlet),
  dock,
  stallBanner,
  tabbar,
);
renderTuningChip();
renderDock();

startRouter(routes, outlet, (route) => {
  title.textContent = route.label;
  document.body.dataset.route = route.path;
  document.querySelectorAll<HTMLAnchorElement>('.rail-link, .tab-link[data-path]').forEach((a) => {
    const on = a.dataset.path === route.path;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  moreBtn.classList.toggle('active', !(route as AppRoute).primary);
});

installGlobalShortcuts(routes.map((r) => r.path), openHelp);
restoreMidi();

/* ---------- First run ---------- */

if (!getSettings().seenIntro) {
  const point = (name: IconName, head: string, text: string) => h('div', { class: 'intro-point' }, h('span', { class: 'intro-icon' }, icon(name, 22)), h('div', null, h('b', null, head), h('p', null, text)));
  openSheet(
    'Welcome to Partial',
    h(
      'div',
      { class: 'stack' },
      h('p', { class: 'lead' }, 'A free practice studio: tuner, metronome, drones, recording, analysis and sheet music. Nothing to sign up for, and nothing leaves your device.'),
      point('tuner', 'Tap the ring to tune', 'Hold a note in tune and the inner ring fills. It works while the metronome plays, too.'),
      point('metronome', 'Spin the dial', 'Drag around the tempo dial, tap beats to accent them, and keep the mini metronome handy on every screen.'),
      point('sound', 'Play drones', 'Tap notes on the wheel to sustain reference pitches for intonation practice.'),
      h('button', { class: 'primary pill-btn wide', onclick: () => document.querySelector<HTMLButtonElement>('.sheet-head .icon-btn')?.click() }, 'Start practising'),
    ),
    { onClose: () => updateSettings({ seenIntro: true }) },
  );
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Offline support is optional; the app works without it.
    });
  });
}
