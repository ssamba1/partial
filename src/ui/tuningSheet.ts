import { a4Cents, A4_MAX, A4_MIN, clampA4, concertToWrittenPc, isWellTemperament, JUST_ALTERNATIVES, NOTATIONS, noteName, prettyName, TEMPERAMENTS, TRANSPOSITIONS, transpositionShort, writtenToConcertPc, type Notation, type OctaveStyle, type Spelling, type Temperament } from '../core/notes';
import { EDOS, parseScala, scalaToTwelve } from '../core/scales';
import { temperamentBeats } from '../core/tuningtools';
import { uid } from '../core/format';
import { signedCents } from '../core/display';
import { getSettings, sanitizeTuningPreset, subscribeSettings, tuningOf, updateSettings, type Settings } from '../store/settings';
import { holdButton, openSheet, segmented } from './components';
import { field, h, select } from './dom';
import { icon } from './icons';

export function tuningSummary(): string {
  const s = getSettings();
  const t = TEMPERAMENTS.find((x) => x.id === s.temperament)!;
  const short = transpositionShort(s.transposition);
  const key = short ? ` · ${short}` : '';
  const tonic = tuningOf(s).tonic;
  const follows = s.tonicFollowsDrone && s.temperament !== 'equal' ? ' (drone)' : '';
  if (s.edo !== 12) return `A${'₄'} ${s.a4 % 1 ? s.a4.toFixed(1) : s.a4} · ${s.edo} equal${key}`;
  const temperament = s.temperament === 'equal' ? 'Equal' : s.temperament === 'custom' ? (s.customScale?.name.slice(0, 24) ?? 'Imported') + ` in ${prettyName(noteName(tonic, s.flats, false))}` : `${t.label.split(' (')[0]} ${isWellTemperament(s.temperament) ? 'from' : 'in'} ${prettyName(noteName(tonic, s.flats, false))}${follows}`;
  return `A${'₄'} ${s.a4 % 1 ? s.a4.toFixed(1) : s.a4} · ${temperament}${key}`;
}

/**
 * Historical reference pitches. Values from Gamut Music, a string maker,
 * https://www.gamutmusic.com/understanding-tunings : 392 French Baroque, 415
 * Baroque, 430 Classical, 435 the French pitch of 1859, 440 modern, 466 Venice
 * and Italian early Baroque. 442 and 443 are common orchestra pitches the app
 * already offered. 432 and Highland pipe pitch are left out: no authoritative source found.
 */
export const A4_PRESETS: { group: string; values: number[] }[] = [
  { group: 'Baroque', values: [392, 415, 466] },
  { group: 'Classical', values: [430, 435] },
  { group: 'Modern', values: [440, 441, 442, 443] },
];

function semitonesOf(s: Settings): number {
  return TRANSPOSITIONS.find((t) => t.id === s.transposition)?.semitones ?? 0;
}

/** Reference pitch, instrument key, temperament and note names, reachable from every screen. */
export function openTuningSheet(): void {
  const s = getSettings();
  const a4Input = h('input', { type: 'number', class: 'a4-value compact', min: A4_MIN, max: A4_MAX, step: 0.1, 'aria-label': 'Reference A in hertz' });
  const a4CentsEl = h('small', { class: 'muted' });
  const setA4 = (v: number) => updateSettings({ a4: clampA4(v, getSettings().a4) });
  a4Input.addEventListener('change', () => {
    const n = Number(a4Input.value);
    if (a4Input.value.trim() === '' || !Number.isFinite(n)) {
      render();
      return;
    }
    setA4(n);
  });
  const stepA4 = (d: number) => setA4(getSettings().a4 + d);

  const extra = h('div', { class: 'stack tight' });
  const tonicLabel = h('span', { class: 'field-label' });
  const tonicHint = h('small', null);
  const tonicSelect = select([], 0, (v) => {
    const cur = getSettings();
    updateSettings({ tonic: writtenToConcertPc(Number(v), semitonesOf(cur)) });
  });
  const temperamentOptions = (cur: Settings) => TEMPERAMENTS.filter((t) => t.id !== 'custom' || cur.customScale).map((t) => ({ value: t.id, label: t.id === 'custom' ? `Imported: ${cur.customScale!.name.slice(0, 30)}` : t.label }));
  const temperamentSelect = select(temperamentOptions(s), s.temperament, (v) => {
    const t = v as Temperament;
    // Well temperaments are written from C, so start them there.
    updateSettings(isWellTemperament(t) ? { temperament: t, tonic: 0 } : { temperament: t });
  });
  const presetChips = h('div', { class: 'chips' });
  const scalaNote = h('small', { class: 'muted' });
  const scalaInput = h('input', { type: 'file', accept: '.scl,text/plain', class: 'visually-hidden', 'aria-label': 'Scala file' });
  scalaInput.addEventListener('change', async () => {
    const file = scalaInput.files?.[0];
    scalaInput.value = '';
    if (!file) return;
    const parsed = parseScala(await file.text());
    if (typeof parsed === 'string') {
      scalaNote.textContent = parsed;
      return;
    }
    const cents = scalaToTwelve(parsed);
    if (!cents) {
      scalaNote.textContent = `${parsed.cents.length} notes: only 12-note scales that repeat at the octave can be a temperament.`;
      return;
    }
    scalaNote.textContent = '';
    updateSettings({ customScale: { name: parsed.description || file.name.replace(/\.scl$/i, ''), cents }, temperament: 'custom' });
  });
  const scalaBtn = h('button', { class: 'chip', onclick: () => scalaInput.click() }, 'Import Scala file');
  const edoSelect = select(EDOS.map((n) => ({ value: n, label: n === 12 ? '12 (normal)' : `${n} equal` })), s.edo, (v) => updateSettings({ edo: Number(v) }), { 'aria-label': 'Notes per octave' });
  const presetName = h('input', { type: 'text', maxlength: 40, placeholder: 'Name, e.g. Baroque 415', 'aria-label': 'Preset name' });

  function render() {
    const cur = getSettings();
    const semis = semitonesOf(cur);
    if (document.activeElement !== a4Input) a4Input.value = cur.a4.toFixed(1);
    a4CentsEl.textContent = cur.a4 === 440 ? '' : `${cur.a4 % 1 ? cur.a4.toFixed(1) : cur.a4} Hz = ${signedCents(a4Cents(cur.a4), true)} from 440`;
    temperamentSelect.replaceChildren(...temperamentOptions(cur).map((o) => h('option', { value: o.value }, o.label)));
    temperamentSelect.value = cur.temperament;

    const well = isWellTemperament(cur.temperament);
    tonicLabel.textContent = well ? 'Starts on' : semis ? 'Key, as written' : 'Key (tonic)';
    tonicHint.textContent = well ? 'C gives the temperament as written.' : semis ? `Concert ${prettyName(noteName(cur.tonic, cur.flats, false))}.` : '';
    tonicHint.hidden = !tonicHint.textContent;
    tonicSelect.replaceChildren(...Array.from({ length: 12 }, (_, i) => h('option', { value: String(i) }, prettyName(noteName(i, cur.flats, false)))));
    tonicSelect.value = String(concertToWrittenPc(cur.tonic, semis));
    // The key also sets spelling by key and movable do, so it stays available for those in equal temperament.
    tonicSelect.disabled = (cur.temperament === 'equal' && cur.spelling !== 'key' && cur.notation !== 'movable') || cur.tonicFollowsDrone;

    extra.replaceChildren(...temperamentExtras(cur));
    presetChips.replaceChildren(
      ...cur.tuningPresets.map((p) =>
        h(
          'span',
          { class: 'chip preset-chip' },
          h('button', { class: 'chip-main', onclick: () => updateSettings({ a4: p.a4, temperament: p.temperament, tonic: p.tonic, transposition: p.transposition }) }, p.name),
          h('button', { class: 'chip-x', 'aria-label': `Delete preset ${p.name}`, onclick: () => updateSettings((st) => ({ tuningPresets: st.tuningPresets.filter((x) => x.id !== p.id) })) }, '×'),
        ),
      ),
    );
  }

  function temperamentExtras(cur: Settings): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (cur.temperament !== 'equal') {
      out.push(
        field(
          'Stays at the reference',
          select(
            [
              { value: 'a4', label: 'A4' },
              { value: 'tonic', label: 'The key note' },
            ],
            cur.temperamentAnchor,
            (v) => updateSettings({ temperamentAnchor: v as Settings['temperamentAnchor'] }),
          ),
          'A4 keeps you with an ensemble tuned to that A.',
        ),
        h(
          'label',
          { class: 'switch-row' },
          h('span', null, h('strong', null, 'Key follows the drone'), h('small', null, 'The lowest drone playing sets the key.')),
          h('input', { type: 'checkbox', role: 'switch', checked: cur.tonicFollowsDrone, onchange: (e: Event) => updateSettings({ tonicFollowsDrone: (e.target as HTMLInputElement).checked }) }),
        ),
      );
    }
    if (cur.temperament === 'just') {
      const rows = Object.entries(JUST_ALTERNATIVES).map(([degree, choices]) => {
        const d = Number(degree);
        return field(
          `${prettyName(noteName(d, cur.flats, false))} above C`,
          select(choices.map((c) => ({ value: c.ratio.join('/'), label: `${c.ratio.join('/')} ${c.name}` })), cur.justRatios[d] ?? choices[0].ratio.join('/'), (v) =>
            updateSettings((st) => ({ justRatios: { ...st.justRatios, [d]: v } })),
          ),
        );
      });
      out.push(
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Just ratios'), h('small', null, 'Intervals above the key note, named here as if the key were C.')),
        h('div', { class: 'grid two' }, ...rows),
        h(
          'div',
          { class: 'row wrap tight' },
          h('button', { class: 'chip', onclick: () => updateSettings((st) => ({ justRatios: { ...st.justRatios, 10: '7/4' } })) }, 'Harmonic 7th'),
          h('button', { class: 'chip', onclick: () => updateSettings({ justRatios: {} }) }, 'Reset ratios'),
        ),
      );
    }
    if (cur.temperament !== 'equal') {
      // Beat rates of thirds, fourths and fifths from F3 to F4, for setting the temperament by ear.
      const rows = temperamentBeats(tuningOf(cur), 53, 65).filter((b) => b.name === 'fifth' || b.name === 'major third');
      out.push(
        h(
          'details',
          { class: 'beat-list' },
          h('summary', null, 'Beat rates F3 to F4'),
          h('small', null, 'Beats per second between the partials the two notes share. Positive means the interval is wide.'),
          h(
            'table',
            { class: 'data-table' },
            h('tr', null, h('th', null, 'Interval'), h('th', null, 'Beats/s')),
            ...rows.map((b) => h('tr', null, h('td', null, `${prettyName(noteName(b.lower, cur.flats))} to ${prettyName(noteName(b.upper, cur.flats))} ${b.name}`), h('td', null, b.beats.toFixed(2)))),
          ),
        ),
      );
    }
    if (cur.temperament === 'meantone') {
      // Each chain has 12 notes; the wolf fifth sits between its last and first note.
      const options = Array.from({ length: 12 }, (_, flats) => {
        const first = ((-7 * flats) % 12 + 12) % 12;
        const last = (first + 7 * 11) % 12;
        return { value: flats, label: `${prettyName(noteName(first, true, false))} to ${prettyName(noteName(last, false, false))}` };
      });
      out.push(
        field('Notes in tune', select(options, cur.meantoneFlats, (v) => updateSettings({ meantoneFlats: Number(v) })), 'The wolf fifth falls between the last and first note. Named as if the key were C.'),
      );
    }
    return out;
  }

  const saveBtn = h(
    'button',
    {
      class: 'pill-btn',
      onclick: () => {
        const cur = getSettings();
        const preset = sanitizeTuningPreset({ id: uid(), name: presetName.value.trim() || tuningSummary(), a4: cur.a4, temperament: cur.temperament, tonic: cur.tonic, transposition: cur.transposition });
        if (!preset) return;
        presetName.value = '';
        updateSettings((st) => ({ tuningPresets: [...st.tuningPresets, preset] }));
      },
    },
    'Save current',
  );

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
        holdButton(icon('minus', 18), 'Lower A4 by 0.1 Hz', () => stepA4(-0.1), 'icon-btn'),
        a4Input,
        holdButton(icon('plus', 18), 'Raise A4 by 0.1 Hz', () => stepA4(0.1), 'icon-btn'),
      ),
      a4CentsEl,
      ...A4_PRESETS.map((g) =>
        h('div', { class: 'chips a4-group' }, h('span', { class: 'muted small' }, g.group), ...g.values.map((f) => h('button', { class: 'chip', onclick: () => setA4(f) }, String(f)))),
      ),
    ),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Presets'), presetChips, h('div', { class: 'row tight' }, presetName, saveBtn)),
    field(
      'Instrument key',
      select(TRANSPOSITIONS.map((t) => ({ value: t.id, label: t.label })), s.transposition, (v) => updateSettings({ transposition: v })),
      'Notes are shown as written for your instrument.',
    ),
    h('div', { class: 'grid two' }, field('Temperament', temperamentSelect), h('label', { class: 'field' }, tonicLabel, tonicSelect, tonicHint)),
    h('div', { class: 'row wrap tight' }, scalaBtn, scalaInput, scalaNote),
    extra,
    field('Notes per octave', edoSelect, 'For the chromatic tuner. With more than 12, the temperament is not used.'),
    h(
      'div',
      { class: 'grid two' },
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'Note names'),
        select(NOTATIONS.map((n) => ({ value: n.id, label: n.label })), s.notation, (v) => updateSettings({ notation: v as Notation }), { 'aria-label': 'Note naming system' }),
        h('small', null, 'Movable do names notes from the key.'),
      ),
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'Accidentals'),
        segmented(
          [
            { value: 'sharps', label: '♯ sharps' },
            { value: 'flats', label: '♭ flats' },
            { value: 'key', label: 'By key' },
          ],
          s.spelling,
          (v) => updateSettings({ spelling: v as Spelling }),
          'Accidentals',
        ),
      ),
    ),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Octaves'),
      segmented(
        [
          { value: 'scientific', label: 'C4' },
          { value: 'helmholtz', label: 'c′' },
        ],
        s.octaveStyle,
        (v) => updateSettings({ octaveStyle: v as OctaveStyle }),
        'Octave names',
      ),
    ),
  );
  render();
  // Re-render only when something the sheet shows has changed.
  let extrasKey = '';
  const off = subscribeSettings((cur) => {
    edoSelect.value = String(cur.edo);
    const key = `${cur.edo}|${cur.spelling}|${cur.customScale?.name}|${cur.temperament}|${cur.flats}|${cur.notation}|${cur.temperamentAnchor}|${cur.tonicFollowsDrone}|${JSON.stringify(cur.justRatios)}|${cur.meantoneFlats}|${cur.transposition}|${cur.tonic}|${cur.a4}|${cur.tuningPresets.length}`;
    if (key === extrasKey) return;
    extrasKey = key;
    render();
  });
  openSheet('Tuning', body, { onClose: off });
}
