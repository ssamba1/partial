import { ensureRunning, getContext, getMaster } from '../../audio/context';
import { activeNotes, noteOn, stopAll } from '../../audio/droneBank';
import { CLICK_SOUNDS, playClick } from '../../audio/voices';
import { uid } from '../../core/format';
import { beatSeconds, BEAT_FEELS, GROOVES, groupingAccents, unitOnsets, groupingOptions, RHYTHM_FIGURES, RUDIMENTS, TIMELINES, validGrouping } from '../../core/metroseq';
import { conductorPoint, CONDUCTOR_PATTERNS } from '../../core/conductor';
import {
  ACCENT_LEVELS,
  barsPerMinute,
  DANCE_TEMPOS,
  defaultAccents,
  exactBpm,
  formatBpm,
  inMarking,
  MAX_BPM,
  MIN_BPM,
  nextAccent,
  noteLengthsMs,
  parseTempo,
  roundBpm,
  stepToMark,
  TEMPO_MARKINGS,
  tempoMarking,
  type AccentLevel,
  type RampCurve,
} from '../../core/rhythm';
import { getSettings, subscribeSettings, updateSettings, type BeatVisual, type Settings } from '../../store/settings';
import { dial, holdButton, iconButton, openSheet, segmented, toast } from '../components';
import { field, h, numberInput, select } from '../dom';
import { icon } from '../icons';
import { metronome, onTap, tapInput, tapper } from '../shared';
import { openListenSheet, openTimingSheet } from './metronomeListen';

const marking = tempoMarking;

const METERS: [number, number][] = [
  [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [2, 2], [3, 2], [3, 8], [5, 8], [6, 8], [7, 8], [9, 8], [11, 8], [12, 8], [15, 16],
];

export const MAX_BEATS = 32;
const BEAT_UNITS = [1, 2, 4, 8, 16, 32];

const LEVEL_NAMES: Record<AccentLevel, string> = { accent: 'Accent', medium: 'Medium', normal: 'Normal', soft: 'Soft', silent: 'Silent' };

/** Note values BPM can count, in whole notes. 0 = the beat. */
const PULSE_NOTES: { value: number; label: string; short: string }[] = [
  { value: 0, label: 'The beat', short: '' },
  { value: 0.125, label: 'Eighth', short: '♪' },
  { value: 0.25, label: 'Quarter', short: '♩' },
  { value: 0.375, label: 'Dotted quarter', short: '♩.' },
  { value: 0.5, label: 'Half', short: 'half' },
  { value: 0.75, label: 'Dotted half', short: 'dotted half' },
];

const SUBDIVISIONS = [
  { value: '1', label: '♩', ariaLabel: 'Quarter notes' },
  { value: '2', label: '♫', ariaLabel: 'Eighth notes' },
  { value: '3', label: '3', ariaLabel: 'Triplets' },
  { value: '4', label: '4', ariaLabel: 'Sixteenth notes' },
  { value: '5', label: '5', ariaLabel: 'Quintuplets' },
  { value: '6', label: '6', ariaLabel: 'Sextuplets' },
];

/** Restart an element's CSS animations without forcing a layout (no offsetWidth reflow). */
function restartAnimations(el: Element): void {
  const anims = typeof el.getAnimations === 'function' ? el.getAnimations({ subtree: true }) : [];
  for (const a of anims) {
    a.cancel();
    a.play();
  }
}

const meterKey = (beats: number, unit: number) => `${beats}/${unit}`;

/**
 * Update metronome settings. Changing meter remembers the accents of the meter
 * you leave and brings back the ones you had set for the meter you go to.
 * `defaultAccents` apply only when that meter has no remembered pattern.
 */
export function setMetronome(patch: Partial<Settings['metronome']>, opts: { defaultAccents?: AccentLevel[]; exact?: boolean } = {}): void {
  updateSettings((s) => {
    const old = s.metronome;
    const m = { ...old, ...patch };
    // Typed and stepped tempos keep 0.1 BPM; halving and doubling keep the exact value so they undo each other.
    m.bpm = patch.bpm !== undefined && opts.exact ? exactBpm(m.bpm) : roundBpm(m.bpm);
    m.beatsPerBar = Math.min(MAX_BEATS, Math.max(1, Math.round(m.beatsPerBar)));
    if (m.beatsPerBar !== old.beatsPerBar || m.beatUnit !== old.beatUnit) {
      const memory = { ...(old.accentMemory ?? {}), [meterKey(old.beatsPerBar, old.beatUnit)]: [...old.accents] };
      m.accentMemory = memory;
      const saved = memory[meterKey(m.beatsPerBar, m.beatUnit)];
      if (!patch.accents) {
        if (saved?.length === m.beatsPerBar) m.accents = [...saved];
        else if (opts.defaultAccents?.length === m.beatsPerBar) m.accents = [...opts.defaultAccents];
      }
      if (!validGrouping(m.grouping, m.beatsPerBar)) {
        m.grouping = [];
        m.clickGroups = false;
      }
    }
    if (m.accents.length !== m.beatsPerBar) {
      const def = defaultAccents(m.beatsPerBar);
      m.accents = Array.from({ length: m.beatsPerBar }, (_, i) => m.accents[i] ?? def[i]);
    }
    return { metronome: m };
  });
}

/** Next tempo for +/- steps: traditional marks when snapping is on, else 1 BPM (0.1 when fine). */
export function stepTempo(cur: number, steps: number, fine = false): number {
  const m = getSettings().metronome;
  if (m.snapMarks && !fine) {
    let v = cur;
    for (let i = 0; i < Math.abs(steps); i++) v = stepToMark(v, steps > 0 ? 1 : -1);
    return v;
  }
  return Math.round((cur + steps * (fine ? 0.1 : 1)) * 10) / 10;
}

function compoundAccents(beats: number, unit: number): AccentLevel[] {
  // 6/8, 9/8, 12/8: accent the start of every dotted-quarter group.
  if (unit === 8 && beats % 3 === 0 && beats > 3) {
    return Array.from({ length: beats }, (_, i) => (i === 0 ? 'accent' : i % 3 === 0 ? 'accent' : 'normal'));
  }
  return defaultAccents(beats);
}

function openMeterSheet() {
  let close = () => {};
  const body = h('div', { class: 'stack' });
  const draw = () => {
    const m = getSettings().metronome;
    const focused = document.activeElement;
    const keepFocus = focused instanceof HTMLElement && body.contains(focused) ? focused.dataset.focusKey : undefined;
    const custom = h(
      'div',
      { class: 'row tight' },
      numberInput(m.beatsPerBar, (n) => setMetronome({ beatsPerBar: n }), { min: 1, max: MAX_BEATS }),
      h('span', { class: 'meter-slash' }, '/'),
      select(BEAT_UNITS.map((v) => ({ value: v, label: String(v) })), m.beatUnit, (v) => setMetronome({ beatUnit: Number(v) }), { 'aria-label': 'Beat unit', 'data-focus-key': 'unit' }),
    );
    const grid = h(
      'div',
      { class: 'meter-grid' },
      METERS.map(([b, u]) => {
        const on = b === m.beatsPerBar && u === m.beatUnit;
        return h(
          'button',
          {
            class: `meter-tile${on ? ' on' : ''}`,
            'aria-pressed': on ? 'true' : 'false',
            'aria-label': `${b}/${u}`,
            onclick: () => {
              setMetronome({ beatsPerBar: b, beatUnit: u }, { defaultAccents: compoundAccents(b, u) });
              close();
            },
          },
          h('span', null, String(b)),
          h('span', null, String(u)),
        );
      }),
    );
    const options = groupingOptions(m.beatsPerBar);
    const children: HTMLElement[] = [grid, field('Custom', custom)];
    if (options.length) {
      children.push(
        h(
          'div',
          { class: 'field' },
          h('span', { class: 'field-label' }, 'Beat groups'),
          h(
            'div',
            { class: 'chips-row', role: 'group', 'aria-label': 'Beat groups' },
            h('button', { class: `chip${m.grouping.length ? '' : ' on'}`, 'aria-pressed': m.grouping.length ? 'false' : 'true', 'data-focus-key': 'g-none', onclick: () => setMetronome({ grouping: [], clickGroups: false }) }, 'None'),
            ...options.map((g) => {
              const on = g.join() === m.grouping.join();
              return h(
                'button',
                { class: `chip${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', 'data-focus-key': `g-${g.join('+')}`, onclick: () => setMetronome({ grouping: g, accents: groupingAccents(g, m.beatsPerBar) }) },
                g.join('+'),
              );
            }),
          ),
          h('small', null, 'Accents the first beat of each group.'),
        ),
      );
    }
    if (m.grouping.length) {
      children.push(
        h(
          'label',
          { class: 'switch-row' },
          h('span', null, h('strong', null, 'Click the groups'), h('small', null, 'One click per group, so 2+2+3 plays long and short beats. BPM still counts the small beats.')),
          h('input', { type: 'checkbox', role: 'switch', 'data-focus-key': 'cg', checked: m.clickGroups, onchange: (e: Event) => setMetronome({ clickGroups: (e.target as HTMLInputElement).checked }) }),
        ),
      );
    }
    children.push(
      field(
        'BPM counts',
        select(PULSE_NOTES.map((p) => ({ value: p.value, label: p.label })), m.pulseNote, (v) => setMetronome({ pulseNote: Number(v) }), { 'data-focus-key': 'pulse' }),
        'For example a dotted quarter in 6/8 or a half note in 2/2. Even clicks per beat then count per pulse.',
      ),
    );
    body.replaceChildren(...children);
    if (keepFocus) (body.querySelector(`[data-focus-key="${keepFocus}"]`) as HTMLElement | null)?.focus();
  };
  draw();
  // Redraw when settings change, so the highlighted tile and group chips follow custom edits.
  const m0 = getSettings().metronome;
  let lastKey = `${m0.beatsPerBar}/${m0.beatUnit}/${m0.grouping.join()}/${m0.clickGroups}/${m0.pulseNote}`;
  const off = subscribeSettings((s) => {
    const m = s.metronome;
    const key = `${m.beatsPerBar}/${m.beatUnit}/${m.grouping.join()}/${m.clickGroups}/${m.pulseNote}`;
    if (key === lastKey) return;
    lastKey = key;
    // Do not rebuild a number field while it is being typed in; just move the tile highlight.
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.type === 'number' && body.contains(active)) {
      body.querySelectorAll('.meter-tile').forEach((t, i) => t.classList.toggle('on', METERS[i][0] === m.beatsPerBar && METERS[i][1] === m.beatUnit));
      return;
    }
    draw();
  });
  close = openSheet('Time signature', body, { onClose: off });
}

/** Pick an accent level directly, and this beat's own subdivision. */
function openBeatSheet(i: number) {
  const m = getSettings().metronome;
  const level = segmented(
    ACCENT_LEVELS.map((l) => ({ value: l, label: LEVEL_NAMES[l] })),
    m.accents[i] ?? 'normal',
    (v) => {
      const accents = [...getSettings().metronome.accents];
      accents[i] = v as AccentLevel;
      setMetronome({ accents });
    },
    `Beat ${i + 1} level`,
  );
  const sub = select(
    [{ value: 0, label: 'Same as other beats' }, ...Array.from({ length: 9 }, (_, k) => ({ value: k + 1, label: String(k + 1) }))],
    m.subdivisionPerBeat[i] ?? 0,
    (v) => {
      const cur = getSettings().metronome;
      const per = Array.from({ length: cur.beatsPerBar }, (_, k) => cur.subdivisionPerBeat[k] ?? 0);
      per[i] = Number(v);
      setMetronome({ subdivisionPerBeat: per.some((x) => x > 0) ? per : [] });
    },
    { 'aria-label': `Clicks in beat ${i + 1}` },
  );
  openSheet(`Beat ${i + 1}`, h('div', { class: 'stack' }, field('Level', level), field('Clicks in this beat', sub)));
}

const CELL_CYCLE: (AccentLevel | 'sub')[] = ['sub', 'accent', 'normal', 'soft', 'silent'];

/** Grid editor for every click of every beat, so patterns like "and only" or "e and a" are possible. */
function openRhythmGrid() {
  const body = h('div', { class: 'rhythm-grid' });
  const draw = (focus?: string) => {
    const m = getSettings().metronome;
    body.replaceChildren(
      ...m.accents.map((beatLevel, b) => {
        const count = clicksInBeat(m, b);
        const cells = Array.from({ length: count }, (_, c) => {
          const level: AccentLevel | 'sub' = c === 0 ? beatLevel : m.pattern[b]?.[c] ?? (beatLevel === 'silent' ? 'silent' : 'sub');
          const label = c === 0 ? `Beat ${b + 1}` : `Beat ${b + 1} click ${c + 1}`;
          return h(
            'button',
            {
              class: `grid-cell ${level}`,
              'aria-label': `${label}, ${level === 'sub' ? 'subdivision' : LEVEL_NAMES[level]}. Tap to change.`,
              'data-cell': `${b}-${c}`,
              onclick: () => {
                const cur = getSettings().metronome;
                if (c === 0) {
                  const accents = [...cur.accents];
                  accents[b] = nextAccent(accents[b]);
                  setMetronome({ accents });
                } else {
                  const pattern = Array.from({ length: cur.beatsPerBar }, (_, k) => [...(cur.pattern[k] ?? [])]);
                  const now = pattern[b][c] ?? (cur.accents[b] === 'silent' ? 'silent' : 'sub');
                  pattern[b][c] = CELL_CYCLE[(CELL_CYCLE.indexOf(now) + 1) % CELL_CYCLE.length];
                  setMetronome({ pattern });
                }
                draw(`${b}-${c}`);
              },
            },
            c === 0 ? String(b + 1) : '',
          );
        });
        return h('div', { class: 'grid-row', role: 'group', 'aria-label': `Beat ${b + 1}` }, ...cells);
      }),
      h('button', { class: 'pill-btn', onclick: () => { setMetronome({ pattern: [] }); draw(); } }, 'Reset clicks'),
    );
    if (focus) (body.querySelector(`[data-cell="${focus}"]`) as HTMLElement | null)?.focus();
  };
  draw();
  openSheet('Rhythm grid', h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'Tap a click to change its level. The first column is the beat.'), body), { wide: true });
}

function soundGrid(current: string): HTMLElement {
  const grid = h('div', { class: 'sound-grid', role: 'radiogroup', 'aria-label': 'Click sound' });
  const draw = (selected: string) =>
    grid.replaceChildren(
      ...CLICK_SOUNDS.map((c) =>
        h(
          'button',
          {
            class: `sound-tile${c.id === selected ? ' on' : ''}`,
            role: 'radio',
            'aria-checked': c.id === selected ? 'true' : 'false',
            onclick: async () => {
              setMetronome({ sound: c.id });
              draw(c.id);
              // Preview: accent then a normal beat.
              const ctx = await ensureRunning();
              const m = getSettings().metronome;
              playClick(ctx, getMaster(), ctx.currentTime + 0.02, 'accent', c.id, m.volume, { accentDb: m.accentDb });
              playClick(ctx, getMaster(), ctx.currentTime + 0.32, 'normal', c.id, m.volume, { accentDb: m.accentDb });
            },
          },
          c.label,
        ),
      ),
    );
  draw(current);
  return grid;
}

function openTempoSheet() {
  const bpm = () => metronome.bpm;
  let close = () => {};
  const body = h('div', { class: 'stack' });
  const draw = () => {
    const m = getSettings().metronome;
    const cur = bpm();
    const target = m.targetBpm > 0 ? m.targetBpm : 0;
    const targetInput = h('input', {
      type: 'text',
      inputmode: 'decimal',
      class: 'target-input',
      value: target ? formatBpm(target) : '',
      placeholder: 'none',
      'aria-label': 'Target tempo',
      onchange: (e: Event) => {
        const el = e.target as HTMLInputElement;
        const n = parseTempo(el.value);
        if (el.value.trim() === '') setMetronome({ targetBpm: 0 });
        else if (n === null) el.value = target ? formatBpm(target) : '';
        else setMetronome({ targetBpm: roundBpm(n) });
        draw();
      },
    });
    const beats = Math.max(1, m.beatsPerBar);
    body.replaceChildren(
      h(
        'div',
        { class: 'tempo-jumps' },
        h('button', { class: 'pill-btn', onclick: () => { setMetronome({ bpm: bpm() / 2 }, { exact: true }); draw(); } }, '½ half time'),
        h('button', { class: 'pill-btn', onclick: () => { setMetronome({ bpm: bpm() - 10 }); draw(); } }, '-10'),
        h('button', { class: 'pill-btn', onclick: () => { setMetronome({ bpm: bpm() + 10 }); draw(); } }, '+10'),
        h('button', { class: 'pill-btn', onclick: () => { setMetronome({ bpm: bpm() * 2 }, { exact: true }); draw(); } }, '×2 double'),
      ),
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'Target tempo'),
        h(
          'div',
          { class: 'row tight wrap' },
          targetInput,
          ...[60, 70, 85, 100].map((pct) =>
            h('button', { class: 'pill-btn', disabled: !target, onclick: () => { setMetronome({ bpm: (target * pct) / 100 }); draw(); } }, `${pct}%`),
          ),
        ),
        h('small', null, 'Practise slower, then work up to the goal.'),
      ),
      h(
        'label',
        { class: 'switch-row' },
        h('span', null, h('strong', null, 'Snap to metronome marks'), h('small', null, 'The dial and +/- step 40, 42, 44 ... 208, like a pendulum metronome.')),
        h('input', { type: 'checkbox', role: 'switch', checked: m.snapMarks, onchange: (e: Event) => setMetronome({ snapMarks: (e.target as HTMLInputElement).checked }) }),
      ),
      h(
        'label',
        { class: 'switch-row' },
        h('span', null, h('strong', null, 'Show bars per minute'), h('small', null, 'Dance tempos are given in bars per minute.')),
        h('input', { type: 'checkbox', role: 'switch', checked: m.tempoUnit === 'bars', onchange: (e: Event) => { setMetronome({ tempoUnit: (e.target as HTMLInputElement).checked ? 'bars' : 'bpm' }); draw(); } }),
      ),
      m.tempoUnit === 'bars'
        ? h(
            'div',
            { class: 'marking-list', role: 'group', 'aria-label': 'Dance tempos' },
            DANCE_TEMPOS.map((d) => {
              const n = d.beats ?? beats;
              const bars = barsPerMinute(cur, n);
              const on = (d.beats === undefined || d.beats === beats) && bars >= d.min - 1e-9 && bars <= d.max + 1e-9;
              return h(
                'button',
                {
                  class: `marking-row${on ? ' on' : ''}`,
                  'aria-pressed': on ? 'true' : 'false',
                  onclick: () => {
                    const mid = (d.min + d.max) / 2;
                    const patch: Partial<Settings['metronome']> = { bpm: mid * n, pulseNote: 0 };
                    if (d.beats && d.beats !== beats) {
                      patch.beatsPerBar = d.beats;
                      patch.beatUnit = 4;
                    }
                    setMetronome(patch);
                    close();
                  },
                },
                h('b', null, d.name),
                h('span', null, `${d.min} to ${d.max} bars/min${d.beats ? ` in ${d.beats}/4` : ''}`),
              );
            }),
          )
        : '',
      h(
        'div',
        { class: 'marking-list' },
        TEMPO_MARKINGS.map((mk) => {
          const on = inMarking(mk, cur);
          const mid = Math.round((mk.min + mk.max) / 2);
          return h(
            'button',
            {
              class: `marking-row${on ? ' on' : ''}`,
              'aria-pressed': on ? 'true' : 'false',
              onclick: () => {
                setMetronome({ bpm: mid });
                close();
              },
            },
            h('b', null, mk.name),
            h('span', null, `${mk.min} to ${mk.max}`),
          );
        }),
      ),
      h('p', { class: 'muted small' }, `Ranges from Wikipedia's Tempo article, which calls them very rough. Where ranges overlap, the label shows two names. Tapping one jumps to the middle of its range.`),
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field-label' }, `Note lengths at ${formatBpm(cur)} BPM (quarter note)`),
        h('ul', { class: 'ms-list' }, noteLengthsMs(cur).map((n) => h('li', null, h('span', null, n.label), h('b', null, `${Math.round(n.ms)} ms`)))),
      ),
      h('button', { class: 'pill-btn', onclick: () => { close(); openListenSheet(); } }, icon('mic', 16), 'Listen for tempo'),
    );
  };
  draw();
  close = openSheet('Tempo', body);
}

const LAYER_NOTES = [
  { subdivision: 1, label: 'Quarters' },
  { subdivision: 2, label: 'Eighths' },
  { subdivision: 3, label: 'Triplets' },
  { subdivision: 4, label: 'Sixteenths' },
];

function openMetronomeOptions() {
  const m = getSettings().metronome;
  const num = (value: number, onChange: (n: number) => void, min: number, max: number, step = 1) =>
    numberInput(value, (n) => onChange(Math.min(max, Math.max(min, step < 1 ? Math.round(n / step) * step : Math.round(n)))), { min, max, step });
  const bpmNum = (value: number, onChange: (n: number) => void) => numberInput(value, (n) => onChange(roundBpm(n)), { min: MIN_BPM, max: MAX_BPM, step: 0.1 });
  const setMeterFor = (meter: [number, number], patch: Partial<Settings['metronome']>) => {
    const cur = getSettings().metronome;
    if (cur.beatsPerBar !== meter[0] || cur.beatUnit !== meter[1]) {
      setMetronome({ ...patch, beatsPerBar: meter[0], beatUnit: meter[1] }, { defaultAccents: compoundAccents(meter[0], meter[1]) });
      toast(`Meter set to ${meter[0]}/${meter[1]}`);
    } else setMetronome(patch);
  };
  const section = (title: string, text: string, ...controls: HTMLElement[]) =>
    h('div', { class: 'option-section' }, h('div', null, h('h3', null, title), h('p', { class: 'muted small' }, text)), h('div', { class: 'option-controls' }, ...controls));
  const range = (label: string, value: number, min: number, max: number, step: number, show: (v: number) => string, onChange: (v: number) => void) => {
    const out = h('output', null, show(value));
    const input = h('input', {
      type: 'range',
      min,
      max,
      step,
      value: String(value),
      'aria-label': label,
      oninput: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value);
        out.textContent = show(v);
        onChange(v);
      },
    });
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label, ' ', out), input);
  };
  const layerGain = (sub: number) => getSettings().metronome.layers.find((l) => l.subdivision === sub)?.gain ?? 0;
  const setLayer = (sub: number, gain: number) => {
    const rest = getSettings().metronome.layers.filter((l) => l.subdivision !== sub);
    setMetronome({ layers: gain > 0 ? [...rest, { subdivision: sub, gain }].sort((a, b) => a.subdivision - b.subdivision) : rest });
  };

  const trainerNote = h('p', { class: 'muted small', role: 'status' });
  const trainerWarn = () => {
    const cur = getSettings().metronome;
    trainerNote.textContent = cur.trainerBars > 0 && roundBpm(cur.trainerMax) === cur.bpm ? `The target equals the tempo (${formatBpm(cur.bpm)}), so nothing will change.` : '';
  };
  trainerWarn();
  const body = h(
    'div',
    { class: 'stack' },
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Click sound (tap to hear)'), soundGrid(m.sound)),
    section('Accent strength', 'How much louder an accented beat is than a normal one.', range('Accent', m.accentDb, 0, 12, 1, (v) => `${v} dB`, (v) => setMetronome({ accentDb: v }))),
    section(
      'Rhythm',
      'More clicks per beat, rhythm figures, swing, and a grid to set each click.',
      field('Clicks per beat', select(Array.from({ length: 9 }, (_, k) => ({ value: k + 1, label: String(k + 1) })), m.subdivision, (v) => setMetronome({ subdivision: Number(v), figure: '' }))),
      field('Figure', select([{ value: '', label: 'Even clicks' }, ...RHYTHM_FIGURES.map((f) => ({ value: f.id, label: f.label }))], m.figure, (v) => setMetronome({ figure: v }))),
      range('Swing', m.swing, 50, 75, 1, (v) => (v <= 50 ? 'straight' : `${v}%`), (v) => setMetronome({ swing: v })),
      h('button', { class: 'pill-btn', onclick: openRhythmGrid }, 'Edit rhythm grid'),
    ),
    section(
      'Layers',
      'Mix extra note values under the click, each at its own level.',
      ...LAYER_NOTES.map((l) => range(l.label, layerGain(l.subdivision), 0, 1, 0.05, (v) => (v > 0 ? `${Math.round(v * 100)}%` : 'off'), (v) => setLayer(l.subdivision, v))),
    ),
    section('Count-in', 'Bars of clicks before bar one, so you can breathe and come in on time.', field('Bars', num(m.countInBars, (n) => setMetronome({ countInBars: n }), 0, 4))),
    section(
      'Polyrhythm',
      'A second sound plays even pulses across a span of beats. 3 over a 4/4 bar gives 3 against 4; 4 over 3 beats spans three beats.',
      field('Pulses (0 off)', num(m.poly, (n) => setMetronome({ poly: n }), 0, 16)),
      field('Over beats (0 = one bar)', num(m.polyBeats, (n) => setMetronome({ polyBeats: n }), 0, 64)),
    ),
    section(
      'Timeline',
      'A clave or tresillo pattern on a second sound, repeating every bar.',
      field(
        'Pattern',
        select([{ value: '', label: 'Off' }, ...TIMELINES.map((t) => ({ value: t.id, label: `${t.label} (${t.meter[0]}/${t.meter[1]})` }))], m.timeline, (v) => {
          const t = TIMELINES.find((x) => x.id === v);
          const cur = getSettings().metronome;
          if (t && (cur.beatsPerBar !== t.meter[0] || cur.beatUnit !== t.meter[1])) {
            setMetronome({ timeline: v, beatsPerBar: t.meter[0], beatUnit: t.meter[1] }, { defaultAccents: compoundAccents(t.meter[0], t.meter[1]) });
            toast(`Meter set to ${t.meter[0]}/${t.meter[1]}`);
          } else setMetronome({ timeline: v });
        }),
      ),
    ),
    section(
      'Drum groove',
      'Kick, snare and hi-hat play a beat instead of the click. Swing applies to the hi-hat eighths.',
      field(
        'Groove',
        select([{ value: '', label: 'Off' }, ...GROOVES.map((g) => ({ value: g.id, label: `${g.label} (${g.meter[0]}/${g.meter[1]})` }))], m.groove, (v) => {
          const g = GROOVES.find((x) => x.id === v);
          if (g) setMeterFor(g.meter, { groove: v });
          else setMetronome({ groove: '' });
        }),
      ),
      field('Fill every (bars, 0 never)', num(m.grooveFill, (n) => setMetronome({ grooveFill: n }), 0, 16)),
      h(
        'label',
        { class: 'switch-row' },
        h('span', null, h('strong', null, 'Keep the click')),
        h('input', { type: 'checkbox', role: 'switch', checked: m.grooveClick, onchange: (e: Event) => setMetronome({ grooveClick: (e.target as HTMLInputElement).checked }) }),
      ),
    ),
    section(
      'Sticking',
      'Shows R and L over each click for rudiment practice. Set clicks per beat to fit the pattern.',
      field('Rudiment', select([{ value: '', label: 'Off' }, ...RUDIMENTS.map((r) => ({ value: r.id, label: `${r.label} (${r.sticking.split('').join(' ')})` }))], m.rudiment, (v) => setMetronome({ rudiment: v }))),
    ),
    section(
      'Feel',
      'Move the click off the beat, or make beats uneven.',
      field(
        'Click on',
        select(
          [
            { value: 0, label: 'The beat' },
            { value: 0.25, label: 'The "e" (1/4 beat late)' },
            { value: 0.5, label: 'The "and" (1/2 beat late)' },
            { value: 0.75, label: 'The "a" (3/4 beat late)' },
          ],
          m.offset,
          (v) => setMetronome({ offset: Number(v) }),
        ),
      ),
      field(
        'Beat lengths',
        select(
          [{ value: '', label: 'Even' }, ...BEAT_FEELS.map((f) => ({ value: f.id, label: `${f.label}: ${f.weights.join(' : ')}` }))],
          BEAT_FEELS.find((f) => f.weights.join() === m.beatWeights.join())?.id ?? '',
          (v) => {
            const f = BEAT_FEELS.find((x) => x.id === v);
            if (f) setMeterFor([f.beats, 4], { beatWeights: [...f.weights] });
            else setMetronome({ beatWeights: [] });
          },
        ),
        'Waltz ratios are means measured by Yang (2022) in recordings of The Blue Danube.',
      ),
    ),
    section(
      'Tempo ramp',
      'Speed up or slow down smoothly over some bars, then hold.',
      field('To BPM (0 off)', bpmNum(m.rampTo, (n) => setMetronome({ rampTo: n <= MIN_BPM ? 0 : n }))),
      field('Over bars', num(m.rampBars, (n) => setMetronome({ rampBars: n }), 1, 256)),
      field(
        'Curve',
        select(
          [
            { value: 'time', label: 'Steady change per second' },
            { value: 'beat', label: 'Same change every beat' },
            { value: 'exp', label: 'Same ratio per second' },
          ],
          m.rampCurve,
          (v) => setMetronome({ rampCurve: v as RampCurve }),
        ),
      ),
    ),
    section(
      'Gap trainer',
      'Play some bars with the click, then some in silence. Keeps your time honest without the metronome holding your hand.',
      field('Play bars', num(m.playBars, (n) => setMetronome({ playBars: n }), 0, 32)),
      field('Silent bars (0 off)', num(m.muteBars, (n) => setMetronome({ muteBars: n }), 0, 32)),
    ),
    section(
      'Random silence',
      'Drops random beats (never beat 1). The beat still lights up so you can check yourself.',
      field('Percent of beats', segmented([0, 10, 25, 50].map((p) => ({ value: String(p), label: p ? `${p}%` : 'Off' })), String(m.randomMute), (v) => setMetronome({ randomMute: Number(v) }), 'Random silence')),
    ),
    section(
      'Speed trainer',
      'Change the tempo step by step as you play. It goes up or down toward the target, and your saved tempo stays as it was unless you keep the new one.',
      field('Every', num(m.trainerEvery === 'seconds' ? m.trainerSeconds : m.trainerBars, (n) => setMetronome(getSettings().metronome.trainerEvery === 'seconds' ? { trainerSeconds: Math.max(1, n), trainerBars: n > 0 ? 1 : 0 } : { trainerBars: n }), 0, 600)),
      field('Counted in', select([{ value: 'bars', label: 'Bars (0 off)' }, { value: 'seconds', label: 'Seconds (0 off)' }], m.trainerEvery, (v) => setMetronome({ trainerEvery: v as 'bars' | 'seconds' }))),
      field('Step', num(m.trainerStep, (n) => setMetronome({ trainerStep: n }), 0.1, 50, 0.1)),
      field('Step in', select([{ value: 'bpm', label: 'BPM' }, { value: 'percent', label: 'Percent' }], m.trainerUnit, (v) => setMetronome({ trainerUnit: v as 'bpm' | 'percent' }))),
      field(
        'Pattern (optional)',
        h('input', {
          type: 'text',
          inputmode: 'text',
          value: m.trainerPattern.join(' '),
          placeholder: 'for example 4 4 -2',
          'aria-label': 'Step pattern',
          onchange: (e: Event) => {
            const el = e.target as HTMLInputElement;
            const steps = el.value.split(/[\s,]+/).filter(Boolean).map((x) => Number(x));
            if (steps.every((x) => Number.isFinite(x))) setMetronome({ trainerPattern: steps.slice(0, 16) });
            else el.value = getSettings().metronome.trainerPattern.join(' ');
          },
        }),
        'Steps in turn; a negative step goes back.',
      ),
      field('Target BPM', bpmNum(m.trainerMax, (n) => { setMetronome({ trainerMax: n }); trainerWarn(); })),
      field('At the target', select([{ value: 'hold', label: 'Hold it' }, { value: 'loop', label: 'Start over' }, { value: 'stop', label: 'Stop' }], m.trainerOnMax, (v) => setMetronome({ trainerOnMax: v as 'hold' | 'loop' | 'stop' }))),
      trainerNote,
    ),
    section(
      'Stopping',
      'End after a set number of bars, like a run-through, or finish the bar when you press stop.',
      field('Stop after bars (0 never)', num(m.stopAfterBars, (n) => setMetronome({ stopAfterBars: n }), 0, 999)),
      field('Stop button', select([{ value: 'now', label: 'Stops right away' }, { value: 'bar', label: 'Finishes the bar' }], m.stopMode, (v) => setMetronome({ stopMode: v as 'now' | 'bar' }))),
    ),
    section(
      'Listen to me',
      'Uses the microphone. Tap along by clapping, or check your timing against the click.',
      h('button', { class: 'pill-btn', onclick: () => openTimingSheet() }, icon('mic', 16), 'Timing check and hands-free tap'),
    ),
    h(
      'label',
      { class: 'switch-row' },
      h(
        'span',
        null,
        h('strong', null, 'Flash on the beat'),
        h('small', null, 'Works on every screen. Warning: flashing light can trigger seizures. It never flashes more than 3 times a second, and above 180 BPM only on beat 1.'),
      ),
      h('input', { type: 'checkbox', role: 'switch', checked: m.flashScreen, onchange: (e: Event) => setMetronome({ flashScreen: (e.target as HTMLInputElement).checked }) }),
    ),
    field(
      'Flash style',
      segmented(
        [
          { value: 'full', label: 'Full screen' },
          { value: 'edge', label: 'Edges' },
          { value: 'small', label: 'Small' },
        ],
        m.flashStyle,
        (v) => setMetronome({ flashStyle: v }),
        'Flash style',
      ),
    ),
    h('button', {
      class: 'pill-btn',
      onclick: () => {
        setMetronome({ countInBars: 0, poly: 0, playBars: 0, muteBars: 0, randomMute: 0, stopAfterBars: 0, trainerBars: 0, timeline: '', layers: [], groove: '', rudiment: '', offset: 0, beatWeights: [], rampTo: 0 });
        toast('Practice modes turned off');
      },
    }, 'Turn all practice modes off'),
  );
  openSheet('Metronome practice tools', body, { wide: true });
}

function openPresetManager(render: () => void) {
  const list = h('ul', { class: 'preset-list' });
  const draw = () => {
    const presets = getSettings().metronomePresets;
    list.replaceChildren(
      ...(presets.length
        ? presets.map((p) =>
            h(
              'li',
              null,
              h('input', {
                type: 'text',
                value: p.name,
                'aria-label': 'Preset name',
                onchange: (e: Event) => {
                  const name = (e.target as HTMLInputElement).value;
                  updateSettings((s) => ({ metronomePresets: s.metronomePresets.map((x) => (x.id === p.id ? { ...x, name } : x)) }));
                  render();
                },
              }),
              h('span', { class: 'muted small' }, `${p.bpm} · ${p.beatsPerBar}/${p.beatUnit}`),
              iconButton('trash', `Delete ${p.name}`, () => {
                updateSettings((s) => ({ metronomePresets: s.metronomePresets.filter((x) => x.id !== p.id) }));
                draw();
                render();
              }, 'danger'),
            ),
          )
        : [h('li', { class: 'muted' }, 'No presets yet. Set a tempo and meter, then tap Save.')]),
    );
  };
  draw();
  openSheet('Presets', list);
}

/** Number of main clicks drawn as dots above a beat. */
function clicksInBeat(m: Settings['metronome'], beat: number): number {
  return unitOnsets(m, beat).length;
}

/** Sticking letter for every click of the bar, in order; empty when no rudiment is set. */
export function stickingCells(rudiment: string, counts: number[]): string[][] {
  const r = RUDIMENTS.find((x) => x.id === rudiment);
  if (!r) return [];
  let k = 0;
  return counts.map((n) => Array.from({ length: n }, () => r.sticking[k++ % r.sticking.length]));
}

/** True when a button got focus from the keyboard, so Space should press it. */
function keyboardFocused(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

export function mountMetronome(root: HTMLElement) {
  /* ----- Dial ----- */
  const bpmInput = h('input', {
    class: 'bpm-input',
    type: 'text',
    inputmode: 'decimal',
    'aria-label': 'Tempo in beats per minute',
    onfocus: (e: Event) => (e.target as HTMLInputElement).select(),
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      if (e.key === 'Escape') {
        (e.target as HTMLInputElement).value = formatBpm(metronome.bpm);
        (e.target as HTMLInputElement).blur();
      }
      e.stopPropagation();
    },
    onchange: (e: Event) => {
      const el = e.target as HTMLInputElement;
      // Empty or non-numeric text keeps the old tempo instead of jumping to the minimum.
      const n = parseTempo(el.value);
      if (n === null) el.value = formatBpm(metronome.bpm);
      else setMetronome({ bpm: getSettings().metronome.tempoUnit === 'bars' ? n * Math.max(1, getSettings().metronome.beatsPerBar) : n });
    },
    onblur: (e: Event) => {
      const el = e.target as HTMLInputElement;
      if (parseTempo(el.value) === null) el.value = formatBpm(shownTempo());
    },
  });
  const markingEl = h('button', { class: 'bpm-marking', onclick: openTempoSheet, 'aria-label': 'Tempo names and quick jumps' });
  const bpmUnit = h('div', { class: 'bpm-unit' }, 'BPM');
  const shownTempo = () => {
    const m = getSettings().metronome;
    return m.tempoUnit === 'bars' ? metronome.bpm / Math.max(1, m.beatsPerBar) : metronome.bpm;
  };
  const tempoDial = dial({
    min: MIN_BPM,
    max: MAX_BPM,
    get: () => getSettings().metronome.bpm,
    set: (v) => setMetronome({ bpm: v }),
    step: (cur, steps, fine) => stepTempo(cur, steps, fine),
    valueText: (v) => `${formatBpm(v)} BPM, ${tempoMarking(v)}`,
    label: 'Tempo dial. Drag in a circle, scroll, or use arrow keys. Hold Shift while dragging for 0.1 steps.',
    degreesPerStep: 5,
    center: h('div', { class: 'bpm-stack' }, bpmInput, bpmUnit, markingEl),
  });

  const minus = holdButton(icon('minus', 22), 'Slower', () => setMetronome({ bpm: stepTempo(getSettings().metronome.bpm, -1) }), 'round-btn');
  const plus = holdButton(icon('plus', 22), 'Faster', () => setMetronome({ bpm: stepTempo(getSettings().metronome.bpm, 1) }), 'round-btn');

  /* ----- Beat blocks ----- */
  const beatsRow = h('div', { class: 'beat-blocks', role: 'group', 'aria-label': 'Beats. Tap a beat to change its accent; right-click or long-press to pick a level.' });
  const stickingRow = h('div', { class: 'sticking-row', 'aria-hidden': 'true' });
  const polyRow = h('div', { class: 'poly-row', 'aria-hidden': 'true' });
  const pendulum = h('div', { class: 'pendulum' }, h('div', { class: 'pendulum-arm' }, h('div', { class: 'pendulum-bob' })));
  const pulse = h('div', { class: 'pulse' }, h('div', { class: 'pulse-core' }), h('span', { class: 'pulse-count' }));
  const conductorBall = h('i', { class: 'conductor-ball' });
  const conductorNote = h('span', { class: 'conductor-note muted small' });
  const conductor = h('div', { class: 'conductor', 'aria-hidden': 'true' }, h('div', { class: 'conductor-floor' }), conductorBall, conductorNote);
  const visuals = h('div', { class: 'beat-visual' }, stickingRow, beatsRow, pendulum, pulse, conductor);

  /* ----- Transport ----- */
  const playBtn = h('button', { class: 'play-btn', 'aria-label': 'Start metronome', onclick: () => toggle() }, icon('play', 34));
  const pauseBtn = h('button', { class: 'round-btn labeled pause-btn', hidden: true, onclick: () => (metronome.paused ? void metronome.resumeFromPause() : metronome.pause()) });
  const tapCount = h('span', null, 'Tap');
  const tapBtn = h(
    'button',
    {
      class: 'round-btn labeled',
      'aria-label': 'Tap tempo (T)',
      // pointerdown with its own timestamp, so how long a press lasts does not matter.
      onpointerdown: (e: PointerEvent) => {
        if (e.button !== 0) return;
        tapPointer = true;
        tap(e.timeStamp);
      },
      onclick: (e: MouseEvent) => {
        // A click that follows a pointerdown was already counted; keyboard clicks have no pointerdown.
        if (tapPointer) tapPointer = false;
        else tap(e.timeStamp);
      },
    },
    icon('tap', 22),
    tapCount,
  );
  let tapPointer = false;
  const meterBtn = h('button', { class: 'meter-btn', onclick: openMeterSheet, 'aria-label': 'Time signature' });
  const trainerBadge = h('div', { class: 'mode-badges' });
  // Per-beat count is visual only; screen readers hear "Count-in" and "Go" once each.
  const countInLabel = h('div', { class: 'count-in-label', 'aria-hidden': 'true' });
  const liveRegion = h('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
  const say = (text: string) => {
    liveRegion.textContent = '';
    window.setTimeout(() => (liveRegion.textContent = text), 30);
  };

  const subSeg = segmented(SUBDIVISIONS, String(getSettings().metronome.subdivision), (v) => setMetronome({ subdivision: Number(v), figure: '' }), 'Subdivision');
  const visualSeg = segmented(
    [
      { value: 'blocks', label: 'Blocks', icon: 'blocks' },
      { value: 'pendulum', label: 'Swing', icon: 'pendulum' },
      { value: 'pulse', label: 'Pulse', icon: 'pulse' },
      { value: 'conductor', label: 'Conduct', icon: 'conductor' },
    ],
    getSettings().metronome.visual,
    (v) => setMetronome({ visual: v as BeatVisual }),
    'Beat display',
  );
  const volume = h('input', {
    type: 'range',
    min: 0,
    max: 1,
    step: 0.05,
    class: 'volume',
    'aria-label': 'Metronome volume',
    oninput: (e: Event) => setMetronome({ volume: Number((e.target as HTMLInputElement).value) }),
  });

  const presetsRow = h('div', { class: 'preset-chips' });

  function toggle() {
    // The engine's toggle also cancels a start that is still waiting for the audio context.
    metronome.toggle();
  }

  function tap(timeStamp: number) {
    tapBtn.classList.add('tapped');
    restartAnimations(tapBtn);
    tapInput(timeStamp);
  }

  const offTap = onTap((count, bpm) => {
    tapCount.textContent = bpm !== null ? `${formatBpm(bpm)} (${count})` : `Tap ${count}`;
    tapBtn.setAttribute('aria-label', bpm !== null ? `Tap tempo (T), ${count} taps, ${formatBpm(bpm)} BPM` : `Tap tempo (T), ${count} taps`);
    window.clearTimeout(tapReset);
    tapReset = window.setTimeout(() => {
      tapCount.textContent = 'Tap';
      tapBtn.setAttribute('aria-label', 'Tap tempo (T)');
    }, tapper.resetMs);
  });
  let tapReset = 0;

  function beatLabel(i: number, level: AccentLevel) {
    return `Beat ${i + 1}, ${LEVEL_NAMES[level]}. Tap to change.`;
  }

  /** Change one beat's accent in place, keeping focus, and say the new level. */
  function cycleAccent(i: number) {
    const accents = [...getSettings().metronome.accents];
    accents[i] = nextAccent(accents[i]);
    setMetronome({ accents });
    say(`Beat ${i + 1} ${LEVEL_NAMES[accents[i]]}`);
  }

  function renderBeats() {
    const m = getSettings().metronome;
    const n = m.accents.length;
    beatsRow.style.setProperty('--beats', String(n));
    beatsRow.classList.toggle('many', n > 8);
    const groupStarts = new Set<number>();
    if (validGrouping(m.grouping, m.beatsPerBar)) {
      let at = 0;
      for (const g of m.grouping) {
        if (at > 0) groupStarts.add(at);
        at += g;
      }
    }
    beatsRow.classList.toggle('grouped', groupStarts.size > 0);
    // On narrow screens more than 8 beats wrap into two rows, split at a group start near the middle when there is one.
    const half = Math.ceil(n / 2);
    const split = [...groupStarts].sort((a, b) => Math.abs(a - half) - Math.abs(b - half))[0] ?? half;
    beatsRow.style.setProperty('--row-split', String(n > 8 ? split : n));
    const counts = m.accents.map((_, i) => clicksInBeat(m, i));
    const sticking = stickingCells(m.rudiment, counts);
    stickingRow.hidden = sticking.length === 0;
    stickingRow.style.setProperty('--beats', String(n));
    stickingRow.replaceChildren(...sticking.map((cells) => h('span', null, ...cells.map((c) => h('b', { class: c === 'R' ? 'r' : 'l' }, c)))));
    const existing = [...beatsRow.children] as HTMLElement[];
    // Same beat count: update classes and labels in place, so focus and the hit state survive.
    if (existing.length === n) {
      existing.forEach((el, i) => {
        const level = m.accents[i];
        const hit = el.classList.contains('hit');
        const ghost = el.classList.contains('ghost');
        el.className = `beat-block ${level}${groupStarts.has(i) ? ' group-start' : ''}${i >= split && n > 8 ? ' row2' : ''}${hit ? ' hit' : ''}${ghost ? ' ghost' : ''}`;
        el.setAttribute('aria-label', beatLabel(i, level));
        const subs = el.querySelector('.beat-subs') as HTMLElement;
        const want = Math.max(0, counts[i] - 1);
        if (subs.children.length !== want) subs.replaceChildren(...Array.from({ length: want }, () => h('i', null)));
        subs.style.setProperty('--subs', String(want));
      });
      return;
    }
    beatsRow.replaceChildren(
      ...m.accents.map((level, i) => {
        let pressTimer = 0;
        let longPressed = false;
        const want = Math.max(0, counts[i] - 1);
        return h(
          'button',
          {
            class: `beat-block ${level}${groupStarts.has(i) ? ' group-start' : ''}${i >= split && n > 8 ? ' row2' : ''}`,
            'data-beat': i,
            'aria-label': beatLabel(i, level),
            onclick: () => {
              if (longPressed) {
                longPressed = false;
                return;
              }
              cycleAccent(i);
            },
            oncontextmenu: (e: Event) => {
              e.preventDefault();
              openBeatSheet(i);
            },
            onpointerdown: (e: PointerEvent) => {
              if (e.pointerType !== 'touch') return;
              pressTimer = window.setTimeout(() => {
                longPressed = true;
                openBeatSheet(i);
              }, 550);
            },
            onpointerup: () => window.clearTimeout(pressTimer),
            onpointercancel: () => window.clearTimeout(pressTimer),
            onpointerleave: () => window.clearTimeout(pressTimer),
          },
          h('span', { class: 'beat-fill' }),
          h('span', { class: 'beat-subs', style: `--subs:${want}` }, ...Array.from({ length: want }, () => h('i', null))),
          h('span', { class: 'beat-num' }, String(i + 1)),
        );
      }),
    );
  }

  function renderPoly() {
    const m = getSettings().metronome;
    const n = m.poly > 0 && m.poly <= 32 ? m.poly : 0;
    if (polyRow.children.length !== n) polyRow.replaceChildren(...Array.from({ length: n }, () => h('i', null)));
    polyRow.hidden = n === 0;
  }

  let lastPresetsKey = '';
  function renderPresets() {
    const presets = getSettings().metronomePresets;
    const m = getSettings().metronome;
    // Rebuild only when the presets or the tempo they match change, so a chip is never swapped out under a tap or focus.
    const key = JSON.stringify([presets.map((p) => [p.id, p.name, p.bpm]), m.bpm, m.beatsPerBar, m.beatUnit, m.subdivision]);
    if (key === lastPresetsKey) return;
    lastPresetsKey = key;
    const focusKey = presetsRow.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key : undefined;
    presetsRow.replaceChildren(
      ...presets.map((p) =>
        h(
          'button',
          {
            class: `chip${p.bpm === m.bpm && p.beatsPerBar === m.beatsPerBar && p.beatUnit === m.beatUnit && p.subdivision === m.subdivision ? ' on' : ''}`,
            'data-key': p.id,
            onclick: async () => {
              setMetronome({ bpm: p.bpm, beatsPerBar: p.beatsPerBar, beatUnit: p.beatUnit, subdivision: p.subdivision, accents: [...p.accents] });
              // Presets can carry a drone, like a tuning or intonation routine.
              if (p.drones?.length) {
                stopAll();
                for (const m of p.drones) await noteOn(m);
              }
            },
          },
          h('b', null, p.name),
          h('span', null, ` ${formatBpm(p.bpm)}`),
        ),
      ),
      h(
        'button',
        {
          class: 'chip add',
          'data-key': 'add',
          onclick: () => {
            const cur = getSettings().metronome;
            const name = `${marking(cur.bpm)} ${cur.beatsPerBar}/${cur.beatUnit}`;
            updateSettings((s) => ({
              metronomePresets: [
                ...s.metronomePresets,
                { id: uid(), name, bpm: cur.bpm, beatsPerBar: cur.beatsPerBar, beatUnit: cur.beatUnit, subdivision: cur.subdivision, accents: [...cur.accents], drones: activeNotes() },
              ],
            }));
            toast(activeNotes().length ? `Saved “${name}” with its drone` : `Saved preset “${name}”`);
          },
        },
        icon('save', 16),
        'Save',
      ),
      ...(presets.length ? [h('button', { class: 'chip ghost', 'data-key': 'manage', onclick: () => openPresetManager(() => { lastPresetsKey = ''; renderPresets(); }) }, icon('list', 16), 'Manage')] : []),
    );
    if (focusKey) (presetsRow.querySelector(`[data-key="${focusKey}"]`) as HTMLElement | null)?.focus();
  }

  let lastBeatsKey = '';
  let lastMeterKey = '';
  let lastBadgesKey = '';
  let lastPlaying: boolean | null = null;

  /** Cheap update for every bar and tempo change: text, dial and play state only. */
  function renderLive() {
    const m = getSettings().metronome;
    if (document.activeElement !== bpmInput) bpmInput.value = formatBpm(shownTempo());
    markingEl.textContent = marking(metronome.bpm);
    const pulseNote = PULSE_NOTES.find((p) => p.value === m.pulseNote && p.value > 0);
    bpmUnit.textContent = m.tempoUnit === 'bars' ? 'bars/min' : pulseNote ? `BPM ${pulseNote.short}` : 'BPM';
    tempoDial.refresh();
    const playing = metronome.playing;
    if (playing !== lastPlaying) {
      lastPlaying = playing;
      playBtn.replaceChildren(icon(playing ? 'stop' : 'play', 34));
      view.classList.toggle('playing', playing);
    }
    playBtn.setAttribute('aria-label', playing ? (metronome.stopping ? 'Stopping at the end of the bar. Press to stop now.' : 'Stop metronome') : metronome.paused ? 'Start again from bar 1' : 'Start metronome');
    view.classList.toggle('stopping', metronome.stopping);
    pauseBtn.hidden = !playing && !metronome.paused;
    const pauseLabel = metronome.paused ? 'Resume' : 'Pause';
    if (pauseBtn.textContent !== pauseLabel) {
      pauseBtn.replaceChildren(icon(metronome.paused ? 'play' : 'pause', 22), h('span', null, pauseLabel));
      pauseBtn.setAttribute('aria-label', metronome.paused ? `Resume from bar ${metronome.paused.bar + 1}` : 'Pause');
    }
    renderBadges();
  }

  function renderBadges() {
    const m = getSettings().metronome;
    const t = metronome.trainer;
    const key = JSON.stringify([m.countInBars, m.poly, m.polyBeats, m.beatsPerBar, m.timeline, m.swing, m.muteBars, m.playBars, m.randomMute, m.trainerBars, m.trainerStep, m.trainerMax, m.trainerUnit, m.trainerEvery, m.trainerSeconds, m.stopAfterBars, m.groove, m.rampTo, m.rampBars, m.offset, m.beatWeights, t]);
    if (key === lastBadgesKey) return;
    lastBadgesKey = key;
    const badges: HTMLElement[] = [];
    const badge = (name: Parameters<typeof icon>[0], text: string) => h('button', { class: 'mode-badge', onclick: openMetronomeOptions }, icon(name, 14), text);
    if (m.countInBars > 0) badges.push(badge('flag', `${m.countInBars}-bar count-in`));
    if (m.poly > 0) badges.push(badge('pulse', m.polyBeats > 0 ? `${m.poly} over ${m.polyBeats} beats` : `${m.poly} against ${m.beatsPerBar}`));
    if (m.timeline) badges.push(badge('pulse', TIMELINES.find((x) => x.id === m.timeline)?.label ?? m.timeline));
    if (m.groove) badges.push(badge('pulse', GROOVES.find((x) => x.id === m.groove)?.label ?? m.groove));
    if (m.swing > 50) badges.push(badge('sparkle', `Swing ${m.swing}%`));
    if (m.offset > 0) badges.push(badge('sparkle', `Click ${m.offset} beat late`));
    if (m.beatWeights.length) badges.push(badge('sparkle', `Beats ${m.beatWeights.join(' : ')}`));
    if (m.rampTo > 0) badges.push(badge('bolt', `Ramp to ${formatBpm(m.rampTo)} over ${m.rampBars} bars`));
    if (m.muteBars > 0 && m.playBars > 0) badges.push(badge('sustain', `${m.playBars} on, ${m.muteBars} silent`));
    if (m.randomMute > 0) badges.push(badge('sparkle', `${m.randomMute}% random silence`));
    if (m.trainerBars > 0) {
      const unit = m.trainerUnit === 'percent' ? '%' : '';
      const every = m.trainerEvery === 'seconds' ? `${m.trainerSeconds} s` : `${m.trainerBars} bars`;
      const text = t
        ? t.reached
          ? `Reached ${formatBpm(t.target)} (from ${formatBpm(t.startBpm)})`
          : `${formatBpm(t.startBpm)} to ${formatBpm(t.bpm)}, target ${formatBpm(t.target)}`
        : `${m.trainerStep}${unit} every ${every}, target ${formatBpm(m.trainerMax)}`;
      badges.push(badge('bolt', text));
    }
    if (m.stopAfterBars > 0) badges.push(badge('stop', `Stops after ${m.stopAfterBars} bars`));
    trainerBadge.replaceChildren(...badges);
    trainerBadge.hidden = badges.length === 0;
  }

  /** Full update when settings change. */
  function render() {
    const m = getSettings().metronome;
    renderLive();
    const beatsKey = `${m.accents.join()}|${m.subdivision}|${m.subdivisionPerBeat.join()}|${m.figure}|${m.grouping.join()}|${m.rudiment}|${m.pulseNote}|${m.beatUnit}|${m.swing}`;
    if (beatsKey !== lastBeatsKey) {
      lastBeatsKey = beatsKey;
      renderBeats();
    }
    renderPoly();
    const meterKey = `${m.beatsPerBar}/${m.beatUnit}`;
    if (meterKey !== lastMeterKey) {
      lastMeterKey = meterKey;
      meterBtn.replaceChildren(h('span', { class: 'meter-top' }, String(m.beatsPerBar)), h('span', { class: 'meter-bottom' }, String(m.beatUnit)));
    }
    subSeg.set(m.figure ? '' : String(m.subdivision));
    visualSeg.set(m.visual);
    view.dataset.visual = m.visual;
    conductorNote.textContent = CONDUCTOR_PATTERNS[m.beatsPerBar] ? '' : `No pattern for ${m.beatsPerBar} beats`;
    if (document.activeElement !== volume) volume.value = String(m.volume);
    renderPresets();
    if (!metronome.playing) {
      view.classList.remove('counting');
      countInLabel.textContent = '';
      beatsRow.querySelectorAll('.beat-block').forEach((b) => b.classList.remove('hit', 'ghost'));
      polyRow.querySelectorAll('i.on').forEach((d) => d.classList.remove('on'));
      stickingRow.querySelectorAll('b.on').forEach((d) => d.classList.remove('on'));
      pendulum.style.setProperty('--swing', '0deg');
      conductorBall.style.removeProperty('--x');
      conductorBall.style.removeProperty('--y');
    }
  }

  let swingSide = 1;
  let wasCounting = false;
  // Conductor ball: position from beat phase every frame.
  let lastBeat = { when: 0, dur: 1, beat: 0, beats: 4 };
  let raf = 0;
  const frame = () => {
    raf = 0;
    if (!metronome.playing || getSettings().metronome.visual !== 'conductor') return;
    const ctx = getContext();
    const phase = (ctx.currentTime - lastBeat.when) / lastBeat.dur;
    const p = conductorPoint(lastBeat.beats, lastBeat.beat, phase);
    if (p) {
      conductorBall.style.setProperty('--x', p.x.toFixed(3));
      conductorBall.style.setProperty('--y', p.y.toFixed(3));
    }
    raf = requestAnimationFrame(frame);
  };

  const offBeat = metronome.onBeat((e) => {
    const m = getSettings().metronome;
    if (e.layer === 'poly') {
      polyRow.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i === e.pulse));
      return;
    }
    if (e.layer) return;
    const block = beatsRow.children[e.beat] as HTMLElement | undefined;
    // Sticking letter of this click.
    if (!stickingRow.hidden) {
      const letters = stickingRow.querySelectorAll('b');
      let k = 0;
      for (let i = 0; i < e.beat; i++) k += stickingRow.children[i]?.children.length ?? 0;
      letters.forEach((l, i) => l.classList.toggle('on', i === k + Math.max(0, e.sub)));
    }
    if (e.sub === 0) {
      view.classList.toggle('counting', e.countIn);
      countInLabel.textContent = e.countIn ? `Count-in · ${e.beat + 1}` : e.muted ? 'silent' : '';
      if (e.countIn && !wasCounting) say('Count-in');
      if (!e.countIn && wasCounting) say('Go');
      wasCounting = e.countIn;
      beatsRow.querySelectorAll('.beat-block.hit').forEach((b) => b !== block && b.classList.remove('hit', 'ghost'));
      if (block) {
        block.classList.add('hit');
        block.classList.toggle('ghost', !!e.muted);
        restartAnimations(block);
      }
      // Pendulum reaches the far side exactly on the next beat.
      swingSide = -swingSide;
      pendulum.style.setProperty('--swing-ms', `${60000 / e.bpm}ms`);
      pendulum.style.setProperty('--swing', `${swingSide * 28}deg`);
      pulse.classList.add('beat');
      pulse.classList.toggle('accent', e.level === 'accent');
      restartAnimations(pulse);
      (pulse.querySelector('.pulse-count') as HTMLElement).textContent = e.level === 'silent' ? '' : String(e.beat + 1);
      lastBeat = { when: e.when, dur: beatSeconds(e.bpm, m.beatUnit, m.pulseNote), beat: e.beat, beats: m.beatsPerBar };
      if (m.visual === 'conductor' && !raf) raf = requestAnimationFrame(frame);
      if (e.beat === 0) renderLive();
    } else if (block) {
      const subs = block.querySelectorAll('.beat-subs i');
      subs.forEach((s, i) => s.classList.toggle('on', i === e.sub - 1));
      block.style.setProperty('--sub-at', String(e.sub));
    }
  });
  const offState = metronome.onState(() => {
    if (!metronome.playing) wasCounting = false;
    render();
  });
  const offTrainer = metronome.onTrainer(() => renderLive());

  const view = h(
    'section',
    { class: 'view metronome' },
    h('div', { class: 'toolbar' }, meterBtn, h('div', { class: 'toolbar-mid' }, subSeg), h('div', { class: 'toolbar-end' }, iconButton('gear', 'Metronome options', openMetronomeOptions))),
    h('div', { class: 'tempo-row' }, minus, tempoDial, plus),
    trainerBadge,
    h('div', { class: 'visual-wrap' }, countInLabel, visuals, polyRow),
    h('div', { class: 'transport' }, tapBtn, playBtn, pauseBtn, h('div', { class: 'volume-wrap' }, icon('sound', 18), volume)),
    h('div', { class: 'subtle-row' }, visualSeg),
    presetsRow,
    h('p', { class: 'hint-line' }, h('kbd', null, 'Space'), ' start/stop ', h('kbd', null, '↑'), h('kbd', null, '↓'), ' tempo ', h('kbd', null, 'T'), ' tap'),
    liveRegion,
  );
  root.append(view);
  render();
  const offSettings = subscribeSettings(render);

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    // Let open panels handle their own keys.
    if (document.querySelector('.sheet-layer.open')) return;
    const target = e.target instanceof Element ? e.target : null;
    if (e.code === 'Space' || e.key === 'Enter') {
      if (target instanceof HTMLButtonElement) {
        // A button focused from the keyboard presses itself. One focused by a mouse click does not
        // swallow Space: blur it and start or stop instead.
        if (e.key === 'Enter' || keyboardFocused(target)) return;
        target.blur();
      } else if (e.key === 'Enter') return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      // Holding Space must not flip start and stop over and over.
      if (e.repeat) return;
      toggle();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      // Arrow keys inside a radio group or slider move that control instead.
      if (target?.closest('[role="radiogroup"], [role="slider"]')) return;
      e.preventDefault();
      const dir = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : -1;
      setMetronome({ bpm: stepTempo(getSettings().metronome.bpm, dir * (e.shiftKey ? 10 : 1)) });
    } else if (e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (e.repeat) return;
      tap(e.timeStamp);
    }
  };
  window.addEventListener('keydown', onKey);

  return () => {
    offBeat();
    offState();
    offSettings();
    offTap();
    offTrainer();
    if (raf) cancelAnimationFrame(raf);
    window.clearTimeout(tapReset);
    window.removeEventListener('keydown', onKey);
  };
}
