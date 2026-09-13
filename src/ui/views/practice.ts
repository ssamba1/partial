import { bestStreak, dayKey, streak } from '../../core/practice';
import { getSettings, mergeSettings, subscribeSettings, updateSettings, type Activity } from '../../store/settings';
import { MIDI_ACTIONS, triggerLabel } from '../../core/midi';
import { iconButton, segmented, svgEl, toast } from '../components';
import { disableMidi, enableMidi, learnNextTrigger, onMidiDevices } from '../controls';
import { h } from '../dom';
import { icon, type IconName } from '../icons';

const ACTIVITIES: { id: Activity; label: string; color: string; icon: IconName }[] = [
  { id: 'tuner', label: 'Tuner', color: 'var(--ring-1)', icon: 'tuner' },
  { id: 'metronome', label: 'Metronome', color: 'var(--ring-2)', icon: 'metronome' },
  { id: 'sound', label: 'Sound', color: 'var(--ring-3)', icon: 'sound' },
  { id: 'record', label: 'Record', color: 'var(--ring-4)', icon: 'record' },
  { id: 'analysis', label: 'Analysis', color: 'var(--ring-5)', icon: 'analysis' },
];

function minutes(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

/** Concentric goal ring: outer ring is total time against the goal, inner rings are each activity's share. */
function rings(today: Partial<Record<Activity, number>>, total: number, goalSec: number): SVGSVGElement {
  const size = 220;
  const c = size / 2;
  const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, class: 'rings-svg', role: 'img', 'aria-label': `${minutes(total)} practised today of a ${minutes(goalSec)} goal` });
  const addRing = (r: number, frac: number, color: string, width: number) => {
    const circ = 2 * Math.PI * r;
    svg.append(svgEl('circle', { cx: c, cy: c, r, class: 'ring-bg', 'stroke-width': width }));
    // A zero-length arc with round caps would draw a stray dot.
    if (frac < 0.005) return;
    svg.append(
      svgEl('circle', {
        cx: c,
        cy: c,
        r,
        fill: 'none',
        stroke: color,
        'stroke-width': width,
        'stroke-linecap': 'round',
        'stroke-dasharray': `${Math.max(0.001, Math.min(1, frac)) * circ} ${circ}`,
        transform: `rotate(-90 ${c} ${c})`,
        class: 'ring-fg',
      }),
    );
  };
  addRing(96, total / goalSec, 'var(--brand)', 14);
  ACTIVITIES.forEach((a, i) => addRing(74 - i * 12, total ? (today[a.id] ?? 0) / Math.max(total, goalSec) : 0, a.color, 8));
  return svg;
}

function midiCard(): { el: HTMLElement; dispose: () => void } {
  const devices = h('div', { class: 'muted small' });
  const rows = h('div', { class: 'midi-rows' });
  const enable = h('input', {
    type: 'checkbox',
    role: 'switch',
    checked: getSettings().midiEnabled,
    onchange: async (e: Event) => {
      const on = (e.target as HTMLInputElement).checked;
      if (on && !(await enableMidi())) {
        (e.target as HTMLInputElement).checked = false;
        return;
      }
      if (!on) disableMidi();
      updateSettings({ midiEnabled: on });
      draw();
    },
  });

  function draw() {
    const map = getSettings().midiMap;
    rows.hidden = !getSettings().midiEnabled;
    rows.replaceChildren(
      ...MIDI_ACTIONS.map((a) => {
        const assigned = Object.entries(map).find(([, act]) => act === a.id)?.[0];
        const learnBtn = h('button', { class: 'chip' }, assigned ? triggerLabel(assigned) : 'Learn');
        learnBtn.addEventListener('click', () => {
          learnBtn.textContent = 'Press a pedal or key…';
          learnBtn.classList.add('on');
          learnNextTrigger((trigger) => {
            updateSettings((s) => {
              const next = Object.fromEntries(Object.entries(s.midiMap).filter(([k, act]) => act !== a.id && k !== trigger));
              return { midiMap: { ...next, [trigger]: a.id } };
            });
            toast(`${a.label}: ${triggerLabel(trigger)}`);
            draw();
          });
        });
        return h(
          'div',
          { class: 'midi-row' },
          h('span', null, a.label),
          h(
            'div',
            { class: 'row tight' },
            learnBtn,
            assigned
              ? iconButton('close', `Clear ${a.label}`, () => {
                  updateSettings((s) => ({ midiMap: Object.fromEntries(Object.entries(s.midiMap).filter(([, act]) => act !== a.id)) }));
                  draw();
                }, 'tool-btn plain')
              : null,
          ),
        );
      }),
    );
  }

  const off = onMidiDevices((names) => {
    devices.textContent = getSettings().midiEnabled ? (names.length ? `Connected: ${names.join(', ')}` : 'No MIDI devices found yet. Plug one in and it appears here.') : '';
  });
  draw();
  const card = h(
    'div',
    { class: 'card' },
    h('h3', null, 'Pedals and MIDI'),
    h('p', { class: 'muted small' }, 'Bluetooth page turners that type arrow keys work without setup. For MIDI pedals and controllers, turn this on and assign a control to each action.'),
    h('label', { class: 'switch-row' }, h('span', null, h('strong', null, 'Use MIDI devices'), devices), enable),
    rows,
  );
  return {
    el: card,
    dispose: () => {
      off();
      learnNextTrigger(null);
    },
  };
}

export function mountPractice(root: HTMLElement) {
  const view = h('section', { class: 'view practice' });
  root.append(view);
  let midi = midiCard();

  function render() {
    midi.dispose();
    midi = midiCard();
    const s = getSettings();
    const todayKey = dayKey(new Date());
    const todaySec = s.practiceLog[todayKey] ?? 0;
    const todayActs = s.activityLog[todayKey] ?? {};
    const goalSec = s.dailyGoalMinutes * 60;
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return s.practiceLog[dayKey(d)] ?? 0;
    }).reduce((a, b) => a + b, 0);

    // 12-week calendar heatmap ending this week.
    const cells: HTMLElement[] = [];
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - (7 * 12 - 1) - end.getDay());
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const sec = s.practiceLog[dayKey(d)] ?? 0;
      const level = sec <= 0 ? 0 : sec < goalSec * 0.34 ? 1 : sec < goalSec * 0.67 ? 2 : sec < goalSec ? 3 : 4;
      cells.push(h('i', { class: `heat l${level}${dayKey(d) === todayKey ? ' today' : ''}`, title: `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${minutes(sec)}` }));
    }

    view.replaceChildren(
      h(
        'div',
        { class: 'practice-hero' },
        h('div', { class: 'rings-wrap' }, rings(todayActs, todaySec, goalSec), h('div', { class: 'rings-center' }, h('b', null, minutes(todaySec)), h('span', null, `of ${s.dailyGoalMinutes}m goal`))),
        h(
          'div',
          { class: 'legend' },
          ACTIVITIES.map((a) => h('div', { class: 'legend-row' }, h('i', { style: `background:${a.color}` }), icon(a.icon, 16), h('span', null, a.label), h('b', null, minutes(todayActs[a.id] ?? 0)))),
        ),
      ),
      h(
        'div',
        { class: 'stat-cards' },
        h('div', { class: 'stat-card' }, icon('bolt', 18), h('b', null, String(streak(s.practiceLog))), h('span', null, 'day streak')),
        h('div', { class: 'stat-card' }, icon('flag', 18), h('b', null, String(bestStreak(s.practiceLog))), h('span', null, 'best streak')),
        h('div', { class: 'stat-card' }, icon('practice', 18), h('b', null, minutes(week)), h('span', null, 'last 7 days')),
      ),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, 'Last 12 weeks'), h('span', { class: 'muted small' }, 'Darker means closer to your goal')), h('div', { class: 'heatmap' }, cells)),
      h(
        'div',
        { class: 'card' },
        h('h3', null, 'Daily goal'),
        segmented(
          [10, 20, 30, 45, 60, 90].map((m) => ({ value: String(m), label: `${m}m` })),
          String(s.dailyGoalMinutes),
          (v) => updateSettings({ dailyGoalMinutes: Number(v) }),
          'Daily practice goal',
        ),
      ),
      h(
        'div',
        { class: 'card' },
        h('h3', null, 'Appearance'),
        segmented(
          [
            { value: 'system', label: 'Auto' },
            { value: 'light', label: 'Light', icon: 'sun' },
            { value: 'dark', label: 'Dark', icon: 'moon' },
          ],
          s.theme,
          (v) => {
            updateSettings({ theme: v as typeof s.theme });
            applyTheme();
          },
          'Theme',
        ),
      ),
      midi.el,
      h(
        'div',
        { class: 'card' },
        h('h3', null, 'Accessibility'),
        h(
          'label',
          { class: 'switch-row' },
          h('span', null, h('strong', null, 'Announce tuner readings'), h('small', null, 'Screen readers hear the note and how far off it is, at most every second and a half.')),
          h('input', { type: 'checkbox', role: 'switch', checked: s.announce, onchange: (e: Event) => updateSettings({ announce: (e.target as HTMLInputElement).checked }) }),
        ),
      ),
      h(
        'div',
        { class: 'card' },
        h('h3', null, 'Your data'),
        h('p', { class: 'muted small' }, 'Everything stays on this device. Export a backup to move settings, presets and history to another device.'),
        h(
          'div',
          { class: 'row wrap' },
          h(
            'button',
            {
              class: 'pill-btn',
              onclick: () => {
                const blob = new Blob([JSON.stringify(getSettings(), null, 2)], { type: 'application/json' });
                const a = h('a', { href: URL.createObjectURL(blob), download: `partial-backup-${dayKey(new Date())}.json` });
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
              },
            },
            icon('download', 16),
            'Export backup',
          ),
          h(
            'button',
            {
              class: 'pill-btn',
              onclick: () => {
                const st = getSettings();
                const days = Object.keys(st.practiceLog).sort();
                const cols: Activity[] = ['tuner', 'metronome', 'sound', 'record', 'analysis'];
                const rows = [['date', 'total_minutes', ...cols.map((c) => `${c}_minutes`)].join(',')];
                for (const d of days) {
                  const acts = st.activityLog[d] ?? {};
                  rows.push([d, (st.practiceLog[d] / 60).toFixed(1), ...cols.map((c) => ((acts[c] ?? 0) / 60).toFixed(1))].join(','));
                }
                const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
                const a = h('a', { href: URL.createObjectURL(blob), download: `partial-practice-${dayKey(new Date())}.csv` });
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
              },
            },
            icon('download', 16),
            'Practice log (CSV)',
          ),
          h(
            'label',
            { class: 'pill-btn' },
            icon('save', 16),
            'Import backup',
            h('input', {
              type: 'file',
              accept: 'application/json',
              class: 'visually-hidden',
              onchange: async (e: Event) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) return;
                try {
                  const data = JSON.parse(await file.text());
                  if (typeof data !== 'object' || data === null || !('a4' in data)) throw new Error('not a backup');
                  updateSettings(mergeSettings(data));
                  applyTheme();
                  toast('Backup restored');
                } catch {
                  toast('That file is not a Partial backup');
                }
              },
            }),
          ),
          h(
            'button',
            {
              class: 'pill-btn danger',
              onclick: () => {
                if (!confirm('Reset all settings, presets, click tracks and practice history? Recordings and sheet music are kept.')) return;
                updateSettings(mergeSettings({}));
                applyTheme();
                toast('Settings reset');
              },
            },
            icon('trash', 16),
            'Reset',
          ),
        ),
      ),
      h('p', { class: 'fineprint' }, 'Partial is free and open source under the MIT license. No accounts, no ads, no tracking. An independent project, not affiliated with TonalEnergy.'),
    );
  }

  render();
  let last = getSettings();
  const off = subscribeSettings((now) => {
    if (now.dailyGoalMinutes !== last.dailyGoalMinutes || now.theme !== last.theme || now.practiceLog !== last.practiceLog) render();
    last = now;
  });
  return () => {
    off();
    midi.dispose();
  };
}

export function applyTheme(): void {
  const theme = getSettings().theme;
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}
