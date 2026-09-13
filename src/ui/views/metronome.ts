import { ensureRunning, getMaster } from '../../audio/context';
import { activeNotes, noteOn, stopAll } from '../../audio/droneBank';
import { CLICK_SOUNDS, playClick } from '../../audio/voices';
import { uid } from '../../core/format';
import { beatOnsets, groupingAccents, groupingOptions, RHYTHM_FIGURES, TIMELINES, validGrouping } from '../../core/metroseq';
import { ACCENT_LEVELS, clampBpm, defaultAccents, MAX_BPM, MIN_BPM, nextAccent, tapTempo, TEMPO_MARKINGS, tempoMarking, type AccentLevel } from '../../core/rhythm';
import { getSettings, subscribeSettings, updateSettings, type BeatVisual, type Settings } from '../../store/settings';
import { dial, holdButton, iconButton, openSheet, segmented, toast } from '../components';
import { field, h, numberInput, select } from '../dom';
import { icon } from '../icons';
import { metronome } from '../shared';

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
  { value: '1', label: '♩' },
  { value: '2', label: '♫' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5', label: '5' },
  { value: '6', label: '6' },
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
export function setMetronome(patch: Partial<Settings['metronome']>, opts: { defaultAccents?: AccentLevel[] } = {}): void {
  updateSettings((s) => {
    const old = s.metronome;
    const m = { ...old, ...patch };
    m.bpm = clampBpm(Math.round(m.bpm));
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
        'For example a dotted quarter in 6/8 or a half note in 2/2. Subdivisions stay per written beat.',
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
        const per = m.subdivisionPerBeat[b] ?? 0;
        const count = per > 0 ? per : beatOnsets(m.subdivision, m.figure, m.swing).length;
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
  const bpm = () => getSettings().metronome.bpm;
  let close = () => {};
  const body = h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'tempo-jumps' },
      h('button', { class: 'pill-btn', onclick: () => setMetronome({ bpm: bpm() / 2 }) }, '½  half time'),
      h('button', { class: 'pill-btn', onclick: () => setMetronome({ bpm: bpm() - 10 }) }, '−10'),
      h('button', { class: 'pill-btn', onclick: () => setMetronome({ bpm: bpm() + 10 }) }, '+10'),
      h('button', { class: 'pill-btn', onclick: () => setMetronome({ bpm: bpm() * 2 }) }, '×2  double'),
    ),
    h(
      'div',
      { class: 'marking-list' },
      TEMPO_MARKINGS.map((mk) => {
        const mid = Math.round((mk.min + Math.min(mk.max, 240)) / 2);
        return h(
          'button',
          {
            class: `marking-row${bpm() >= mk.min && bpm() < mk.max ? ' on' : ''}`,
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
    h('p', { class: 'muted small' }, 'Tempo names cover overlapping ranges; tapping one jumps to the middle of its range.'),
  );
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
  const num = (value: number, onChange: (n: number) => void, min: number, max: number) =>
    numberInput(value, (n) => onChange(Math.min(max, Math.max(min, Math.round(n)))), { min, max });
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
      'Raise the tempo automatically as you play.',
      field('Every (bars, 0 off)', num(m.trainerBars, (n) => setMetronome({ trainerBars: n }), 0, 64)),
      field('Add BPM', num(m.trainerStep, (n) => setMetronome({ trainerStep: n }), 1, 20)),
      field('Stop at', num(m.trainerMax, (n) => setMetronome({ trainerMax: clampBpm(n) }), MIN_BPM, MAX_BPM)),
    ),
    section('Stop after', 'End automatically after a set number of bars, like a performance run-through.', field('Bars (0 never)', num(m.stopAfterBars, (n) => setMetronome({ stopAfterBars: n }), 0, 999))),
    h(
      'label',
      { class: 'switch-row' },
      h('span', null, h('strong', null, 'Flash the screen'), h('small', null, 'A full-screen flash on every beat, for loud rooms or ensembles.')),
      h('input', { type: 'checkbox', role: 'switch', checked: m.flashScreen, onchange: (e: Event) => setMetronome({ flashScreen: (e.target as HTMLInputElement).checked }) }),
    ),
    h('button', {
      class: 'pill-btn',
      onclick: () => {
        setMetronome({ countInBars: 0, poly: 0, playBars: 0, muteBars: 0, randomMute: 0, stopAfterBars: 0, trainerBars: 0, timeline: '', layers: [] });
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
  const per = m.subdivisionPerBeat[beat] ?? 0;
  return per > 0 ? per : beatOnsets(m.subdivision, m.figure, m.swing).length;
}

export function mountMetronome(root: HTMLElement) {
  const taps: number[] = [];

  /* ----- Dial ----- */
  const bpmInput = h('input', {
    class: 'bpm-input',
    type: 'text',
    inputmode: 'numeric',
    'aria-label': 'Tempo in beats per minute',
    onfocus: (e: Event) => (e.target as HTMLInputElement).select(),
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      e.stopPropagation();
    },
    onchange: (e: Event) => {
      const n = Number((e.target as HTMLInputElement).value);
      if (Number.isFinite(n)) setMetronome({ bpm: n });
      else render();
    },
  });
  const markingEl = h('button', { class: 'bpm-marking', onclick: openTempoSheet, 'aria-label': 'Tempo names and quick jumps' });
  const bpmUnit = h('div', { class: 'bpm-unit' }, 'BPM');
  const tempoDial = dial({
    min: MIN_BPM,
    max: MAX_BPM,
    get: () => getSettings().metronome.bpm,
    set: (v) => setMetronome({ bpm: v }),
    label: 'Tempo dial. Drag in a circle, scroll, or use arrow keys.',
    degreesPerStep: 5,
    center: h('div', { class: 'bpm-stack' }, bpmInput, bpmUnit, markingEl),
  });

  const minus = holdButton(icon('minus', 22), 'Slower', () => setMetronome({ bpm: getSettings().metronome.bpm - 1 }), 'round-btn');
  const plus = holdButton(icon('plus', 22), 'Faster', () => setMetronome({ bpm: getSettings().metronome.bpm + 1 }), 'round-btn');

  /* ----- Beat blocks ----- */
  const beatsRow = h('div', { class: 'beat-blocks', role: 'group', 'aria-label': 'Beats. Tap a beat to change its accent; right-click or long-press to pick a level.' });
  const polyRow = h('div', { class: 'poly-row', 'aria-hidden': 'true' });
  const pendulum = h('div', { class: 'pendulum' }, h('div', { class: 'pendulum-arm' }, h('div', { class: 'pendulum-bob' })));
  const pulse = h('div', { class: 'pulse' }, h('div', { class: 'pulse-core' }), h('span', { class: 'pulse-count' }));
  const visuals = h('div', { class: 'beat-visual' }, beatsRow, pendulum, pulse);

  /* ----- Transport ----- */
  const playBtn = h('button', { class: 'play-btn', 'aria-label': 'Start metronome', onclick: () => toggle() }, icon('play', 34));
  const tapBtn = h('button', { class: 'round-btn labeled', onclick: () => tap(), 'aria-label': 'Tap tempo (T)' }, icon('tap', 22), h('span', null, 'Tap'));
  const meterBtn = h('button', { class: 'meter-btn', onclick: openMeterSheet, 'aria-label': 'Time signature' });
  const trainerBadge = h('div', { class: 'mode-badges' });
  const countInLabel = h('div', { class: 'count-in-label', 'aria-live': 'polite' });

  const subSeg = segmented(SUBDIVISIONS, String(getSettings().metronome.subdivision), (v) => setMetronome({ subdivision: Number(v), figure: '' }), 'Subdivision');
  const visualSeg = segmented(
    [
      { value: 'blocks', label: 'Blocks', icon: 'blocks' },
      { value: 'pendulum', label: 'Swing', icon: 'pendulum' },
      { value: 'pulse', label: 'Pulse', icon: 'pulse' },
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
  const flash = h('div', { class: 'screen-flash', 'aria-hidden': 'true' });

  function toggle() {
    // The engine's toggle also cancels a start that is still waiting for the audio context.
    metronome.toggle();
  }

  function tap() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    tapBtn.classList.add('tapped');
    restartAnimations(tapBtn);
    const bpm = tapTempo(taps);
    if (bpm) setMetronome({ bpm });
  }

  function renderBeats() {
    const m = getSettings().metronome;
    beatsRow.style.setProperty('--beats', String(m.accents.length));
    const groupStarts = new Set<number>();
    if (validGrouping(m.grouping, m.beatsPerBar)) {
      let at = 0;
      for (const g of m.grouping) {
        if (at > 0) groupStarts.add(at);
        at += g;
      }
    }
    beatsRow.classList.toggle('grouped', groupStarts.size > 0);
    beatsRow.replaceChildren(
      ...m.accents.map((level, i) => {
        let pressTimer = 0;
        let longPressed = false;
        return h(
          'button',
          {
            class: `beat-block ${level}${groupStarts.has(i) ? ' group-start' : ''}`,
            'data-beat': i,
            'aria-label': `Beat ${i + 1}, ${LEVEL_NAMES[level]}. Tap to change.`,
            onclick: () => {
              if (longPressed) {
                longPressed = false;
                return;
              }
              const accents = [...getSettings().metronome.accents];
              accents[i] = nextAccent(accents[i]);
              setMetronome({ accents });
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
          h('span', { class: 'beat-subs' }, ...Array.from({ length: Math.max(0, clicksInBeat(m, i) - 1) }, () => h('i', null))),
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

  function renderPresets() {
    const presets = getSettings().metronomePresets;
    const m = getSettings().metronome;
    presetsRow.replaceChildren(
      ...presets.map((p) =>
        h(
          'button',
          {
            class: `chip${p.bpm === m.bpm && p.beatsPerBar === m.beatsPerBar && p.beatUnit === m.beatUnit && p.subdivision === m.subdivision ? ' on' : ''}`,
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
          h('span', null, ` ${p.bpm}`),
        ),
      ),
      h(
        'button',
        {
          class: 'chip add',
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
      ...(presets.length ? [h('button', { class: 'chip ghost', onclick: () => openPresetManager(renderPresets) }, icon('list', 16), 'Manage')] : []),
    );
  }

  let lastBeatsKey = '';
  function render() {
    const m = getSettings().metronome;
    const bpm = metronome.settings.bpm;
    if (document.activeElement !== bpmInput) bpmInput.value = String(bpm);
    markingEl.textContent = marking(bpm);
    const pulseNote = PULSE_NOTES.find((p) => p.value === m.pulseNote && p.value > 0);
    bpmUnit.textContent = pulseNote ? `BPM ${pulseNote.short}` : 'BPM';
    tempoDial.refresh();
    const beatsKey = `${m.accents.join()}|${m.subdivision}|${m.subdivisionPerBeat.join()}|${m.figure}|${m.grouping.join()}`;
    if (beatsKey !== lastBeatsKey) {
      lastBeatsKey = beatsKey;
      renderBeats();
    }
    renderPoly();
    meterBtn.replaceChildren(h('span', { class: 'meter-top' }, String(m.beatsPerBar)), h('span', { class: 'meter-bottom' }, String(m.beatUnit)));
    subSeg.set(m.figure ? '' : String(m.subdivision));
    visualSeg.set(m.visual);
    view.dataset.visual = m.visual;
    volume.value = String(m.volume);
    playBtn.replaceChildren(icon(metronome.playing ? 'stop' : 'play', 34));
    playBtn.setAttribute('aria-label', metronome.playing ? 'Stop metronome' : 'Start metronome');
    view.classList.toggle('playing', metronome.playing);
    const badges: HTMLElement[] = [];
    const badge = (name: Parameters<typeof icon>[0], text: string) => h('button', { class: 'mode-badge', onclick: openMetronomeOptions }, icon(name, 14), text);
    if (m.countInBars > 0) badges.push(badge('flag', `${m.countInBars}-bar count-in`));
    if (m.poly > 0) badges.push(badge('pulse', m.polyBeats > 0 ? `${m.poly} over ${m.polyBeats} beats` : `${m.poly} against ${m.beatsPerBar}`));
    if (m.timeline) badges.push(badge('pulse', TIMELINES.find((t) => t.id === m.timeline)?.label ?? m.timeline));
    if (m.swing > 50) badges.push(badge('sparkle', `Swing ${m.swing}%`));
    if (m.muteBars > 0 && m.playBars > 0) badges.push(badge('sustain', `${m.playBars} on, ${m.muteBars} silent`));
    if (m.randomMute > 0) badges.push(badge('sparkle', `${m.randomMute}% random silence`));
    if (m.trainerBars > 0) badges.push(badge('bolt', `+${m.trainerStep} every ${m.trainerBars} bars → ${m.trainerMax}`));
    if (m.stopAfterBars > 0) badges.push(badge('stop', `Stops after ${m.stopAfterBars} bars`));
    trainerBadge.replaceChildren(...badges);
    trainerBadge.hidden = badges.length === 0;
    renderPresets();
    if (!metronome.playing) {
      view.classList.remove('counting');
      countInLabel.textContent = '';
      beatsRow.querySelectorAll('.beat-block').forEach((b) => b.classList.remove('hit', 'ghost'));
      polyRow.querySelectorAll('i.on').forEach((d) => d.classList.remove('on'));
      pendulum.style.setProperty('--swing', '0deg');
    }
  }

  let swingSide = 1;
  const offBeat = metronome.onBeat((e) => {
    const m = getSettings().metronome;
    if (e.layer === 'poly') {
      polyRow.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i === e.pulse));
      return;
    }
    if (e.layer) return;
    const block = beatsRow.children[e.beat] as HTMLElement | undefined;
    if (e.sub === 0) {
      view.classList.toggle('counting', e.countIn);
      countInLabel.textContent = e.countIn ? `Count-in · ${e.beat + 1}` : e.muted ? 'silent' : '';
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
      if (m.flashScreen && e.level !== 'silent') {
        flash.classList.add('go');
        flash.classList.toggle('accent', e.level === 'accent');
        restartAnimations(flash);
      }
      if (e.beat === 0) render();
    } else if (block) {
      const subs = block.querySelectorAll('.beat-subs i');
      subs.forEach((s, i) => s.classList.toggle('on', i === e.sub - 1));
    }
  });
  const offState = metronome.onState(render);

  const view = h(
    'section',
    { class: 'view metronome' },
    h('div', { class: 'toolbar' }, meterBtn, h('div', { class: 'toolbar-mid' }, subSeg), h('div', { class: 'toolbar-end' }, iconButton('gear', 'Metronome options', openMetronomeOptions))),
    h('div', { class: 'tempo-row' }, minus, tempoDial, plus),
    trainerBadge,
    h('div', { class: 'visual-wrap' }, countInLabel, visuals, polyRow),
    h('div', { class: 'transport' }, tapBtn, playBtn, h('div', { class: 'volume-wrap' }, icon('sound', 18), volume)),
    h('div', { class: 'subtle-row' }, visualSeg),
    presetsRow,
    h('p', { class: 'hint-line' }, h('kbd', null, 'Space'), ' start/stop ', h('kbd', null, '↑'), h('kbd', null, '↓'), ' tempo ', h('kbd', null, 'T'), ' tap'),
    flash,
  );
  root.append(view);
  render();
  const offSettings = subscribeSettings(render);

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    // Let focused buttons and open panels handle their own keys.
    if (document.querySelector('.sheet-layer.open')) return;
    if (e.target instanceof HTMLButtonElement && (e.code === 'Space' || e.key === 'Enter')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      toggle();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      setMetronome({ bpm: getSettings().metronome.bpm + (e.shiftKey ? 10 : 1) });
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setMetronome({ bpm: getSettings().metronome.bpm - (e.shiftKey ? 10 : 1) });
    } else if (e.key.toLowerCase() === 't' && !e.metaKey && !e.ctrlKey) {
      tap();
    }
  };
  window.addEventListener('keydown', onKey);

  return () => {
    offBeat();
    offState();
    offSettings();
    window.removeEventListener('keydown', onKey);
  };
}
