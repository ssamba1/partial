import { NOTE_NAMES_SHARP, TEMPERAMENTS, TRANSPOSITIONS } from '../core/notes';
import { getSettings, updateSettings } from '../store/settings';
import { holdButton, openSheet, segmented } from './components';
import { field, h, select } from './dom';
import { icon } from './icons';

export function tuningSummary(): string {
  const s = getSettings();
  const t = TEMPERAMENTS.find((x) => x.id === s.temperament)!;
  const key = s.transposition === 'C' ? '' : ` · ${s.transposition.replace('b', '♭')}`;
  const temperament = s.temperament === 'equal' ? 'Equal' : `${t.label.split(' ')[0]} in ${NOTE_NAMES_SHARP[s.tonic]}`;
  return `A${'₄'} ${s.a4 % 1 ? s.a4.toFixed(1) : s.a4} · ${temperament}${key}`;
}

/** Reference pitch, instrument key, temperament and note names, reachable from every screen. */
export function openTuningSheet(): void {
  const s = getSettings();
  const a4Value = h('output', { class: 'a4-value' });
  const renderA4 = () => (a4Value.textContent = `${getSettings().a4.toFixed(1)} Hz`);
  const stepA4 = (d: number) => {
    updateSettings((st) => ({ a4: Math.round(Math.min(480, Math.max(400, st.a4 + d)) * 10) / 10 }));
    renderA4();
  };
  renderA4();

  const body = h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'a4-row' },
      h('span', { class: 'field-label' }, 'Reference A'),
      h(
        'div',
        { class: 'stepper' },
        holdButton(icon('minus', 18), 'Lower A4 by 0.5 Hz', () => stepA4(-0.5), 'icon-btn'),
        a4Value,
        holdButton(icon('plus', 18), 'Raise A4 by 0.5 Hz', () => stepA4(0.5), 'icon-btn'),
      ),
      h(
        'div',
        { class: 'chips' },
        [415, 430, 440, 441, 442, 443].map((f) =>
          h('button', { class: 'chip', onclick: () => { updateSettings({ a4: f }); renderA4(); } }, String(f)),
        ),
      ),
    ),
    field(
      'Instrument key',
      select(TRANSPOSITIONS.map((t) => ({ value: t.id, label: t.label })), s.transposition, (v) => updateSettings({ transposition: v })),
      'Notes are shown as written for your instrument.',
    ),
    h(
      'div',
      { class: 'grid two' },
      field('Temperament', select(TEMPERAMENTS.map((t) => ({ value: t.id, label: t.label })), s.temperament, (v) => updateSettings({ temperament: v as typeof s.temperament }))),
      field('Key (tonic)', select(NOTE_NAMES_SHARP.map((n, i) => ({ value: i, label: n })), s.tonic, (v) => updateSettings({ tonic: Number(v) }))),
    ),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Note names'),
      segmented(
        [
          { value: 'sharp', label: 'C♯ D♯' },
          { value: 'flat', label: 'D♭ E♭' },
        ],
        s.flats ? 'flat' : 'sharp',
        (v) => updateSettings({ flats: v === 'flat' }),
        'Note names',
      ),
    ),
  );
  openSheet('Tuning', body);
}
