import { CLICK_SOUNDS } from '../../audio/voices';
import { uid } from '../../core/format';
import { clampBpm, defaultAccents, MAX_BPM, MIN_BPM, tapTempo, TEMPO_MARKINGS, tempoMarking, type AccentLevel } from '../../core/rhythm';
import { getSettings, subscribeSettings, updateSettings, type BeatVisual, type Settings } from '../../store/settings';
import { dial, holdButton, iconButton, openSheet, segmented, toast } from '../components';
import { field, h, numberInput, select } from '../dom';
import { icon } from '../icons';
import { metronome } from '../shared';

const marking = tempoMarking;

const NEXT_ACCENT: Record<AccentLevel, AccentLevel> = { normal: 'accent', accent: 'silent', silent: 'normal' };

const METERS: [number, number][] = [
  [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [2, 2], [3, 8], [5, 8], [6, 8], [7, 8], [9, 8], [12, 8],
];

const SUBDIVISIONS = [
  { value: '1', label: '♩' },
  { value: '2', label: '♫' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5', label: '5' },
  { value: '6', label: '6' },
];

export function setMetronome(patch: Partial<Settings['metronome']>): void {
  updateSettings((s) => {
    const m = { ...s.metronome, ...patch };
    m.bpm = clampBpm(Math.round(m.bpm));
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
  const m = getSettings().metronome;
  const custom = h('div', { class: 'row tight' },
    numberInput(m.beatsPerBar, (n) => setMetronome({ beatsPerBar: Math.min(16, Math.max(1, Math.round(n))) }), { min: 1, max: 16 }),
    h('span', { class: 'meter-slash' }, '/'),
    select([2, 4, 8, 16].map((v) => ({ value: v, label: String(v) })), m.beatUnit, (v) => setMetronome({ beatUnit: Number(v) })),
  );
  let close = () => {};
  const grid = h(
    'div',
    { class: 'meter-grid' },
    METERS.map(([b, u]) =>
      h(
        'button',
        {
          class: `meter-tile${b === m.beatsPerBar && u === m.beatUnit ? ' on' : ''}`,
          onclick: () => {
            setMetronome({ beatsPerBar: b, beatUnit: u, accents: compoundAccents(b, u) });
            close();
          },
        },
        h('span', null, String(b)),
        h('span', null, String(u)),
      ),
    ),
  );
  close = openSheet('Time signature', h('div', { class: 'stack' }, grid, field('Custom', custom)));
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

function openMetronomeOptions() {
  const m = getSettings().metronome;
  const num = (value: number, onChange: (n: number) => void, min: number, max: number) =>
    numberInput(value, (n) => onChange(Math.min(max, Math.max(min, Math.round(n)))), { min, max });
  const section = (title: string, text: string, ...controls: HTMLElement[]) =>
    h('div', { class: 'option-section' }, h('div', null, h('h3', null, title), h('p', { class: 'muted small' }, text)), h('div', { class: 'option-controls' }, ...controls));

  const body = h(
    'div',
    { class: 'stack' },
    field('Click sound', segmented(CLICK_SOUNDS.map((c) => ({ value: c.id, label: c.label })), m.sound, (v) => setMetronome({ sound: v as typeof m.sound }), 'Click sound')),
    section('Count-in', 'Bars of clicks before bar one, so you can breathe and come in on time.', field('Bars', num(m.countInBars, (n) => setMetronome({ countInBars: n }), 0, 4))),
    section(
      'Polyrhythm',
      'A second sound plays this many even pulses across each bar. 3 in a 4/4 bar gives 3 against 4.',
      field('Pulses per bar (0 off)', num(m.poly, (n) => setMetronome({ poly: n }), 0, 16)),
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
        setMetronome({ countInBars: 0, poly: 0, playBars: 0, muteBars: 0, randomMute: 0, stopAfterBars: 0, trainerBars: 0 });
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
  const tempoDial = dial({
    min: MIN_BPM,
    max: MAX_BPM,
    get: () => getSettings().metronome.bpm,
    set: (v) => setMetronome({ bpm: v }),
    label: 'Tempo dial. Drag in a circle, scroll, or use arrow keys.',
    degreesPerStep: 5,
    center: h('div', { class: 'bpm-stack' }, bpmInput, h('div', { class: 'bpm-unit' }, 'BPM'), markingEl),
  });

  const minus = holdButton(icon('minus', 22), 'Slower', () => setMetronome({ bpm: getSettings().metronome.bpm - 1 }), 'round-btn');
  const plus = holdButton(icon('plus', 22), 'Faster', () => setMetronome({ bpm: getSettings().metronome.bpm + 1 }), 'round-btn');

  /* ----- Beat blocks ----- */
  const beatsRow = h('div', { class: 'beat-blocks', role: 'group', 'aria-label': 'Beats. Tap a beat to change its accent.' });
  const pendulum = h('div', { class: 'pendulum' }, h('div', { class: 'pendulum-arm' }, h('div', { class: 'pendulum-bob' })));
  const pulse = h('div', { class: 'pulse' }, h('div', { class: 'pulse-core' }), h('span', { class: 'pulse-count' }));
  const visuals = h('div', { class: 'beat-visual' }, beatsRow, pendulum, pulse);

  /* ----- Transport ----- */
  const playBtn = h('button', { class: 'play-btn', 'aria-label': 'Start metronome', onclick: () => toggle() }, icon('play', 34));
  const tapBtn = h('button', { class: 'round-btn labeled', onclick: () => tap(), 'aria-label': 'Tap tempo (T)' }, icon('tap', 22), h('span', null, 'Tap'));
  const meterBtn = h('button', { class: 'meter-btn', onclick: openMeterSheet, 'aria-label': 'Time signature' });
  const trainerBadge = h('div', { class: 'mode-badges' });
  const countInLabel = h('div', { class: 'count-in-label', 'aria-live': 'polite' });

  const subSeg = segmented(SUBDIVISIONS, String(getSettings().metronome.subdivision), (v) => setMetronome({ subdivision: Number(v) }), 'Subdivision');
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
    if (metronome.playing) metronome.stop();
    else void metronome.start();
  }

  function tap() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    tapBtn.classList.remove('tapped');
    void tapBtn.offsetWidth;
    tapBtn.classList.add('tapped');
    const bpm = tapTempo(taps);
    if (bpm) setMetronome({ bpm });
  }

  function renderBeats() {
    const m = getSettings().metronome;
    beatsRow.style.setProperty('--beats', String(m.accents.length));
    beatsRow.replaceChildren(
      ...m.accents.map((level, i) =>
        h(
          'button',
          {
            class: `beat-block ${level}`,
            'data-beat': i,
            'aria-label': `Beat ${i + 1}, ${level}. Tap to change.`,
            onclick: () => {
              const accents = [...getSettings().metronome.accents];
              accents[i] = NEXT_ACCENT[accents[i]];
              setMetronome({ accents });
            },
          },
          h('span', { class: 'beat-fill' }),
          h('span', { class: 'beat-subs' }, ...Array.from({ length: Math.max(0, m.subdivision - 1) }, () => h('i', null))),
          h('span', { class: 'beat-num' }, String(i + 1)),
        ),
      ),
    );
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
            onclick: () => setMetronome({ bpm: p.bpm, beatsPerBar: p.beatsPerBar, beatUnit: p.beatUnit, subdivision: p.subdivision, accents: [...p.accents] }),
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
              metronomePresets: [...s.metronomePresets, { id: uid(), name, bpm: cur.bpm, beatsPerBar: cur.beatsPerBar, beatUnit: cur.beatUnit, subdivision: cur.subdivision, accents: [...cur.accents] }],
            }));
            toast(`Saved preset “${name}”`);
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
    tempoDial.refresh();
    const beatsKey = `${m.accents.join()}|${m.subdivision}`;
    if (beatsKey !== lastBeatsKey) {
      lastBeatsKey = beatsKey;
      renderBeats();
    }
    meterBtn.replaceChildren(h('span', { class: 'meter-top' }, String(m.beatsPerBar)), h('span', { class: 'meter-bottom' }, String(m.beatUnit)));
    subSeg.set(String(m.subdivision));
    visualSeg.set(m.visual);
    view.dataset.visual = m.visual;
    volume.value = String(m.volume);
    playBtn.replaceChildren(icon(metronome.playing ? 'stop' : 'play', 34));
    playBtn.setAttribute('aria-label', metronome.playing ? 'Stop metronome' : 'Start metronome');
    view.classList.toggle('playing', metronome.playing);
    const badges: HTMLElement[] = [];
    const badge = (name: Parameters<typeof icon>[0], text: string) => h('button', { class: 'mode-badge', onclick: openMetronomeOptions }, icon(name, 14), text);
    if (m.countInBars > 0) badges.push(badge('flag', `${m.countInBars}-bar count-in`));
    if (m.poly > 0) badges.push(badge('pulse', `${m.poly} against ${m.beatsPerBar}`));
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
      pendulum.style.setProperty('--swing', '0deg');
    }
  }

  let swingSide = 1;
  const offBeat = metronome.onBeat((e) => {
    const m = getSettings().metronome;
    const block = beatsRow.children[e.beat] as HTMLElement | undefined;
    if (e.sub === 0) {
      view.classList.toggle('counting', e.countIn);
      countInLabel.textContent = e.countIn ? `Count-in · ${e.beat + 1}` : e.muted ? 'silent' : '';
      beatsRow.querySelectorAll('.beat-block.hit').forEach((b) => b.classList.remove('hit', 'ghost'));
      if (block) {
        void block.offsetWidth;
        block.classList.add('hit');
        block.classList.toggle('ghost', !!e.muted);
      }
      // Pendulum reaches the far side exactly on the next beat.
      swingSide = -swingSide;
      pendulum.style.setProperty('--swing-ms', `${60000 / e.bpm}ms`);
      pendulum.style.setProperty('--swing', `${swingSide * 28}deg`);
      pulse.classList.remove('beat', 'accent');
      void pulse.offsetWidth;
      pulse.classList.add('beat');
      if (e.level === 'accent') pulse.classList.add('accent');
      (pulse.querySelector('.pulse-count') as HTMLElement).textContent = e.level === 'silent' ? '' : String(e.beat + 1);
      if (m.flashScreen && e.level !== 'silent') {
        flash.classList.remove('go', 'accent');
        void flash.offsetWidth;
        flash.classList.add('go');
        if (e.level === 'accent') flash.classList.add('accent');
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
    h('div', { class: 'visual-wrap' }, countInLabel, visuals),
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
