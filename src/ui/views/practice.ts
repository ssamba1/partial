import { formatDuration } from '../../core/format';
import { dayKey, streak } from '../../core/practice';
import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../../store/settings';
import { field, h, select } from '../dom';

export function mountPractice(root: HTMLElement) {
  const s = getSettings();
  const log = s.practiceLog;
  const days: { key: string; seconds: number; label: string }[] = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = dayKey(d);
    days.push({ key, seconds: log[key] ?? 0, label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
  }
  const max = Math.max(60, ...days.map((d) => d.seconds));
  const week = days.slice(-7).reduce((a, d) => a + d.seconds, 0);
  const total = Object.values(log).reduce((a, v) => a + v, 0);

  root.append(
    h(
      'section',
      { class: 'view practice' },
      h(
        'div',
        { class: 'stats' },
        h('div', { class: 'stat' }, h('strong', null, String(streak(log))), h('span', null, 'day streak')),
        h('div', { class: 'stat' }, h('strong', null, formatDuration(week)), h('span', null, 'last 7 days')),
        h('div', { class: 'stat' }, h('strong', null, formatDuration(total)), h('span', null, 'all time')),
      ),
      h('p', { class: 'muted small' }, 'Time counts while the tuner, metronome, click track or recorder is running. Stored only on this device.'),
      h(
        'div',
        { class: 'bars', role: 'img', 'aria-label': 'Practice minutes over the last 28 days' },
        ...days.map((d) =>
          h('div', { class: 'bar', title: `${d.label}: ${formatDuration(d.seconds)}` }, h('div', { class: 'bar-fill', style: `height:${(d.seconds / max) * 100}%` })),
        ),
      ),
      h('h2', null, 'Settings'),
      h(
        'div',
        { class: 'grid' },
        field(
          'Theme',
          select(
            [
              { value: 'system', label: 'Match system' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ],
            s.theme,
            (v) => {
              updateSettings({ theme: v as typeof s.theme });
              applyTheme();
            },
          ),
        ),
      ),
      h(
        'div',
        { class: 'row wrap' },
        h(
          'button',
          {
            onclick: () => {
              const blob = new Blob([JSON.stringify(getSettings(), null, 2)], { type: 'application/json' });
              const a = h('a', { href: URL.createObjectURL(blob), download: 'resonare-settings.json' });
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            },
          },
          'Export settings and click tracks',
        ),
        h(
          'label',
          { class: 'button' },
          'Import settings',
          h('input', {
            type: 'file',
            accept: 'application/json',
            class: 'visually-hidden',
            onchange: async (e: Event) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (!file) return;
              try {
                const data = JSON.parse(await file.text());
                if (typeof data !== 'object' || data === null) throw new Error('not an object');
                updateSettings({ ...DEFAULT_SETTINGS, ...data });
                location.reload();
              } catch {
                alert('That file is not a Resonare settings export.');
              }
            },
          }),
        ),
        h(
          'button',
          {
            class: 'danger',
            onclick: () => {
              if (!confirm('Reset all settings, click tracks and the practice log? Recordings and sheet music are kept.')) return;
              updateSettings(DEFAULT_SETTINGS);
              location.reload();
            },
          },
          'Reset settings',
        ),
      ),
      h(
        'p',
        { class: 'muted small' },
        'Resonare is free and open source under the MIT license. No accounts, no ads, no tracking. It is an independent project and is not affiliated with TonalEnergy.',
      ),
    ),
  );
}

export function applyTheme(): void {
  const theme = getSettings().theme;
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}
