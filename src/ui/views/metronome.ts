import { CLICK_SOUNDS } from '../../audio/voices';
import { clampBpm, defaultAccents, MAX_BPM, MIN_BPM, tapTempo, type AccentLevel } from '../../core/rhythm';
import { getSettings, subscribeSettings, updateSettings, type Settings } from '../../store/settings';
import { field, h, numberInput, select } from '../dom';
import { metronome } from '../shared';

const TEMPO_MARKINGS: [number, string][] = [
  [40, 'Grave'],
  [60, 'Largo'],
  [66, 'Larghetto'],
  [76, 'Adagio'],
  [108, 'Andante'],
  [120, 'Moderato'],
  [156, 'Allegro'],
  [176, 'Vivace'],
  [200, 'Presto'],
  [Infinity, 'Prestissimo'],
];

function marking(bpm: number): string {
  return TEMPO_MARKINGS.find(([max]) => bpm < max)![1];
}

const NEXT_ACCENT: Record<AccentLevel, AccentLevel> = { normal: 'accent', accent: 'silent', silent: 'normal' };

export function setMetronome(patch: Partial<Settings['metronome']>): void {
  updateSettings((s) => {
    const m = { ...s.metronome, ...patch };
    m.bpm = clampBpm(Math.round(m.bpm));
    if (m.accents.length !== m.beatsPerBar) {
      m.accents = Array.from({ length: m.beatsPerBar }, (_, i) => m.accents[i] ?? defaultAccents(m.beatsPerBar)[i]);
    }
    return { metronome: m };
  });
}

export function mountMetronome(root: HTMLElement) {
  const taps: number[] = [];

  const bpmValue = h('input', {
    class: 'bpm-value',
    type: 'number',
    min: MIN_BPM,
    max: MAX_BPM,
    'aria-label': 'Tempo in beats per minute',
    onchange: (e: Event) => setMetronome({ bpm: Number((e.target as HTMLInputElement).value) }),
  });
  const markingEl = h('div', { class: 'muted' });
  const slider = h('input', {
    type: 'range',
    min: MIN_BPM,
    max: 300,
    class: 'bpm-slider',
    'aria-label': 'Tempo slider',
    oninput: (e: Event) => setMetronome({ bpm: Number((e.target as HTMLInputElement).value) }),
  });
  const beatsRow = h('div', { class: 'beats', role: 'group', 'aria-label': 'Beats. Tap a beat to change its accent.' });
  const playBtn = h('button', { class: 'primary big play', onclick: () => toggle() }, 'Start');
  const trainerStatus = h('div', { class: 'muted small' });

  function toggle() {
    if (metronome.playing) {
      metronome.stop();
    } else {
      void metronome.start();
    }
  }

  function bump(delta: number) {
    setMetronome({ bpm: getSettings().metronome.bpm + delta });
  }

  function tap() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    const bpm = tapTempo(taps);
    if (bpm) setMetronome({ bpm });
  }

  function renderBeats() {
    const m = getSettings().metronome;
    beatsRow.replaceChildren(
      ...m.accents.map((level, i) =>
        h(
          'button',
          {
            class: `beat ${level}`,
            'data-beat': i,
            title: `Beat ${i + 1}: ${level}`,
            'aria-label': `Beat ${i + 1}, ${level}`,
            onclick: () => {
              const accents = [...getSettings().metronome.accents];
              accents[i] = NEXT_ACCENT[accents[i]];
              setMetronome({ accents });
            },
          },
          String(i + 1),
        ),
      ),
    );
  }

  function render() {
    const m = getSettings().metronome;
    if (document.activeElement !== bpmValue) bpmValue.value = String(metronome.settings.bpm);
    slider.value = String(metronome.settings.bpm);
    markingEl.textContent = marking(metronome.settings.bpm);
    if (beatsRow.children.length !== m.accents.length || [...beatsRow.children].some((c, i) => !c.classList.contains(m.accents[i]))) {
      renderBeats();
    }
    if (!metronome.playing) for (const c of beatsRow.children) c.classList.remove('flash');
    playBtn.textContent = metronome.playing ? 'Stop' : 'Start';
    playBtn.classList.toggle('active', metronome.playing);
    trainerStatus.textContent =
      m.trainerBars > 0 ? `Speed trainer: +${m.trainerStep} BPM every ${m.trainerBars} bars, up to ${m.trainerMax}` : '';
  }

  const offBeat = metronome.onBeat((e) => {
    if (e.sub !== 0) return;
    const el = beatsRow.children[e.beat] as HTMLElement | undefined;
    if (!el) return;
    for (const c of beatsRow.children) c.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    el.addEventListener('animationend', () => el.classList.remove('flash'), { once: true });
    if (e.beat === 0) render();
  });
  const offState = metronome.onState(render);

  const m = getSettings().metronome;
  const meterSelect = select(
    [2, 3, 4, 5, 6, 7, 9, 11, 12].map((n) => ({ value: n, label: String(n) })),
    m.beatsPerBar,
    (v) => setMetronome({ beatsPerBar: Number(v) }),
    { 'aria-label': 'Beats per bar' },
  );
  const unitSelect = select(
    [2, 4, 8, 16].map((n) => ({ value: n, label: String(n) })),
    m.beatUnit,
    (v) => setMetronome({ beatUnit: Number(v) }),
    { 'aria-label': 'Beat unit' },
  );

  const view = h(
    'section',
    { class: 'view metronome' },
    h(
      'div',
      { class: 'bpm-display' },
      h('button', { class: 'round', onclick: () => bump(-1), 'aria-label': 'Slower' }, '−'),
      h('div', { class: 'bpm-center' }, bpmValue, h('div', { class: 'bpm-label' }, 'BPM'), markingEl),
      h('button', { class: 'round', onclick: () => bump(1), 'aria-label': 'Faster' }, '+'),
    ),
    slider,
    beatsRow,
    h('p', { class: 'muted small center' }, 'Tap a beat to cycle: normal → accent → silent'),
    h('div', { class: 'row center' }, playBtn, h('button', { class: 'big', onclick: tap }, 'Tap tempo')),
    trainerStatus,
    h(
      'div',
      { class: 'grid' },
      field('Time signature', h('div', { class: 'row tight' }, meterSelect, h('span', null, '/'), unitSelect)),
      field(
        'Subdivision',
        select(
          [
            { value: 1, label: 'Beats only' },
            { value: 2, label: 'Eighths (2)' },
            { value: 3, label: 'Triplets (3)' },
            { value: 4, label: 'Sixteenths (4)' },
            { value: 5, label: 'Quintuplets (5)' },
            { value: 6, label: 'Sextuplets (6)' },
          ],
          m.subdivision,
          (v) => setMetronome({ subdivision: Number(v) }),
        ),
      ),
      field('Sound', select(CLICK_SOUNDS.map((c) => ({ value: c.id, label: c.label })), m.sound, (v) => setMetronome({ sound: v as typeof m.sound }))),
      field(
        'Volume',
        h('input', {
          type: 'range',
          min: 0,
          max: 1,
          step: 0.05,
          value: String(m.volume),
          oninput: (e: Event) => setMetronome({ volume: Number((e.target as HTMLInputElement).value) }),
        }),
      ),
    ),
    h(
      'details',
      { class: 'panel' },
      h('summary', null, 'Speed trainer'),
      h(
        'div',
        { class: 'grid' },
        field('Every N bars (0 = off)', numberInput(m.trainerBars, (n) => setMetronome({ trainerBars: Math.max(0, Math.round(n)) }), { min: 0, max: 64 })),
        field('Add BPM', numberInput(m.trainerStep, (n) => setMetronome({ trainerStep: Math.max(1, Math.round(n)) }), { min: 1, max: 20 })),
        field('Stop at BPM', numberInput(m.trainerMax, (n) => setMetronome({ trainerMax: clampBpm(n) }), { min: MIN_BPM, max: MAX_BPM })),
      ),
    ),
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
      bump(e.shiftKey ? 10 : 1);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      bump(e.shiftKey ? -10 : -1);
    } else if (e.key.toLowerCase() === 't') {
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
