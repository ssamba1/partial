import { ensureRunning, getMaster } from '../../audio/context';
import { LookaheadScheduler } from '../../audio/scheduler';
import { playClick } from '../../audio/voices';
import { formatDuration, uid } from '../../core/format';
import { clampBpm, defaultAccents, MAX_BPM, MIN_BPM, type RampCurve, expandClickTrack, sectionSpans, type ClickSection, type ClickTrack } from '../../core/rhythm';
import { getSettings, logPractice, updateSettings } from '../../store/settings';
import { holdButton, iconButton, openSheet, toast } from '../components';
import { h, select } from '../dom';
import { icon } from '../icons';
import { claimTransport, registerClick, releaseTransport } from '../shared';

const section = (name: string, bars: number, bpm: number, beatsPerBar = 4, extra: Partial<ClickSection> = {}): ClickSection => ({
  name,
  bars,
  bpm,
  beatsPerBar,
  beatUnit: 4,
  subdivision: 1,
  accents: defaultAccents(beatsPerBar),
  ...extra,
});

const TEMPLATES: { name: string; build: () => ClickTrack }[] = [
  { name: 'Blank', build: () => ({ id: uid(), name: 'New click track', countInBars: 1, sections: [section('', 8, 100)] }) },
  {
    name: 'Accelerando 60 to 120',
    build: () => ({ id: uid(), name: 'Accelerando', countInBars: 1, sections: [section('Build', 16, 60, 4, { endBpm: 120 }), section('Hold', 8, 120)] }),
  },
  {
    name: 'Song form',
    build: () => ({
      id: uid(),
      name: 'Song form',
      countInBars: 1,
      sections: [section('Intro', 4, 96), section('Verse', 16, 96), section('Chorus', 8, 100), section('Bridge', 8, 90, 3), section('Outro', 4, 96, 4, { endBpm: 80 })],
    }),
  },
  {
    name: 'Tempo ladder',
    build: () => ({ id: uid(), name: 'Tempo ladder', countInBars: 1, sections: [70, 80, 90, 100, 110].map((b) => section(`${b} BPM`, 4, b)) }),
  },
];

function saveTrack(track: ClickTrack) {
  updateSettings((s) => {
    const idx = s.clickTracks.findIndex((t) => t.id === track.id);
    const list = [...s.clickTracks];
    if (idx >= 0) list[idx] = structuredClone(track);
    else list.push(structuredClone(track));
    return { clickTracks: list };
  });
}

export function mountClickTrack(root: HTMLElement) {
  let track: ClickTrack = structuredClone(getSettings().clickTracks[0] ?? TEMPLATES[0].build());
  let scheduler: LookaheadScheduler | null = null;
  let playStartedAt = 0;
  let playStartAudio = 0;
  let loop = false;
  let raf = 0;
  let starting = false;
  let disposed = false;

  const library = h('div', { class: 'track-chips' });
  const nameInput = h('input', {
    type: 'text',
    class: 'track-name',
    'aria-label': 'Click track name',
    oninput: (e: Event) => (track.name = (e.target as HTMLInputElement).value),
    onchange: () => persist(),
  });
  const countIn = select([0, 1, 2].map((n) => ({ value: n, label: n ? `${n} bar count-in` : 'No count-in' })), track.countInBars, (v) => {
    track.countInBars = Number(v);
    persist();
  }, { class: 'compact', 'aria-label': 'Count-in' });
  const summary = h('div', { class: 'track-summary' });
  const timeline = h('div', { class: 'timeline', role: 'img', 'aria-label': 'Click track timeline' });
  const playhead = h('div', { class: 'playhead', hidden: true });
  const editor = h('div', { class: 'section-list' });
  const nowPlaying = h('div', { class: 'now-playing', 'aria-live': 'polite' }, 'Ready');
  const playBtn = h('button', { class: 'transport-play', 'aria-label': 'Play click track', onclick: () => void togglePlay() }, icon('play', 22));
  const loopBtn = h('button', { class: 'tool-btn', 'aria-pressed': 'false', title: 'Loop', onclick: () => { loop = !loop; loopBtn.setAttribute('aria-pressed', String(loop)); } }, icon('undo', 16), 'Loop');

  function persist() {
    saveTrack(track);
    renderLibrary();
    renderSummary();
  }

  function renderSummary() {
    const { spans, countIn: ci, duration } = sectionSpans(track);
    const bars = track.sections.reduce((n, s) => n + s.bars, 0);
    summary.replaceChildren(
      h('span', null, h('b', null, String(track.sections.length)), ' sections'),
      h('span', null, h('b', null, String(bars)), ' bars'),
      h('span', null, h('b', null, formatDuration(duration)), ' total'),
    );
    const total = duration || 1;
    timeline.replaceChildren(
      ...(ci > 0 ? [h('div', { class: 'tl-seg count', style: `flex:${ci / total}`, title: 'Count-in' }, h('span', null, 'In'))] : []),
      ...spans.map((sp) => {
        const s = track.sections[sp.section];
        const ramp = s.endBpm !== undefined && s.endBpm !== s.bpm;
        return h(
          'button',
          {
            class: `tl-seg${ramp ? ' ramp' : ''}`,
            style: `flex:${(sp.end - sp.start) / total};--hue:${(sp.section * 47) % 360}`,
            title: `${s.name || `Section ${sp.section + 1}`}: ${s.bars} bars, ${ramp ? `${s.bpm} to ${s.endBpm}` : s.bpm} BPM, ${s.beatsPerBar}/${s.beatUnit}`,
            onclick: () => editor.children[sp.section]?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
          },
          h('b', null, s.name || `${sp.section + 1}`),
          h('span', null, ramp ? `${s.bpm}→${s.endBpm}` : String(s.bpm)),
        );
      }),
      playhead,
    );
  }

  function renderLibrary() {
    const tracks = getSettings().clickTracks;
    library.replaceChildren(
      ...tracks.map((t) =>
        h('button', { class: `chip${t.id === track.id ? ' on' : ''}`, onclick: () => { stop(); track = structuredClone(t); renderAll(); } }, icon('clicktrack', 14), t.name || 'Untitled'),
      ),
      h('button', { class: 'chip add', onclick: openTemplates }, icon('plus', 14), 'New'),
    );
  }

  function openTemplates() {
    let close = () => {};
    const list = h(
      'div',
      { class: 'template-list' },
      TEMPLATES.map((tpl) =>
        h(
          'button',
          {
            class: 'template',
            onclick: () => {
              stop();
              track = tpl.build();
              persist();
              renderAll();
              close();
            },
          },
          h('b', null, tpl.name),
          h('span', null, (() => {
            const t = tpl.build();
            return `${t.sections.length} section${t.sections.length > 1 ? 's' : ''} · ${formatDuration(expandClickTrack(t).duration)}`;
          })()),
        ),
      ),
    );
    close = openSheet('New click track', list);
  }

  const stepper = (label: string, value: number, min: number, max: number, set: (n: number) => void) => {
    const out = h('output', null, String(value));
    const change = (d: number) => {
      const next = Math.min(max, Math.max(min, Number(out.textContent) + d));
      out.textContent = String(next);
      set(next);
    };
    return h(
      'div',
      { class: 'mini-stepper' },
      h('span', null, label),
      h('div', null, holdButton(icon('minus', 14), `${label} down`, () => change(-1), 'step'), out, holdButton(icon('plus', 14), `${label} up`, () => change(1), 'step')),
    );
  };

  function sectionCard(s: ClickSection, index: number): HTMLElement {
    const update = (patch: Partial<ClickSection>, rerender = false) => {
      Object.assign(s, patch);
      if (patch.beatsPerBar !== undefined) s.accents = defaultAccents(s.beatsPerBar);
      persist();
      if (rerender) renderEditor();
    };
    const ramp = s.endBpm !== undefined;
    return h(
      'div',
      { class: 'section-card v2', style: `--hue:${(index * 47) % 360}` },
      h(
        'div',
        { class: 'section-top' },
        h('span', { class: 'section-index' }, String(index + 1)),
        h('input', { type: 'text', class: 'section-name', placeholder: `Section ${index + 1}`, value: s.name ?? '', 'aria-label': 'Section name', onchange: (e: Event) => update({ name: (e.target as HTMLInputElement).value }) }),
        h(
          'div',
          { class: 'row tight' },
          iconButton('chevronLeft', 'Move earlier', () => move(index, -1), 'tool-btn plain rot'),
          iconButton('chevronRight', 'Move later', () => move(index, 1), 'tool-btn plain rot'),
          iconButton('pages', 'Duplicate', () => duplicate(index), 'tool-btn plain'),
          iconButton('trash', 'Remove section', () => remove(index), 'tool-btn plain danger'),
        ),
      ),
      h(
        'div',
        { class: 'section-grid' },
        stepper('Bars', s.bars, 1, 999, (n) => update({ bars: n })),
        stepper('BPM', s.bpm, MIN_BPM, MAX_BPM, (n) => update({ bpm: clampBpm(n) })),
        stepper('Beats', s.beatsPerBar, 1, 16, (n) => update({ beatsPerBar: n })),
        h(
          'div',
          { class: 'mini-stepper' },
          h('span', null, 'Beat unit'),
          select([2, 4, 8, 16].map((v) => ({ value: v, label: `/${v}` })), s.beatUnit, (v) => update({ beatUnit: Number(v) }), { class: 'compact' }),
        ),
        h(
          'div',
          { class: 'mini-stepper' },
          h('span', null, 'Subdivide'),
          select([1, 2, 3, 4, 6].map((v) => ({ value: v, label: v === 1 ? 'None' : `×${v}` })), s.subdivision, (v) => update({ subdivision: Number(v) }), { class: 'compact' }),
        ),
        h(
          'label',
          { class: 'mini-stepper ramp-toggle' },
          h('span', null, 'Tempo ramp'),
          h('input', { type: 'checkbox', role: 'switch', checked: ramp, onchange: (e: Event) => update({ endBpm: (e.target as HTMLInputElement).checked ? Math.min(MAX_BPM, s.bpm + 20) : undefined }, true) }),
        ),
        ramp ? stepper('Ends at', s.endBpm!, MIN_BPM, MAX_BPM, (n) => update({ endBpm: clampBpm(n) })) : null,
        ramp
          ? h(
              'div',
              { class: 'mini-stepper' },
              h('span', null, 'Ramp shape'),
              select(
                [
                  { value: 'beat', label: 'Same change every beat' },
                  { value: 'time', label: 'Steady change per second' },
                  { value: 'exp', label: 'Same ratio per second' },
                ],
                s.curve ?? 'beat',
                (v) => update({ curve: v as RampCurve }),
                { class: 'compact', 'aria-label': 'Ramp shape' },
              ),
            )
          : null,
      ),
    );
  }

  function move(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= track.sections.length) return;
    const [s] = track.sections.splice(i, 1);
    track.sections.splice(j, 0, s);
    persist();
    renderEditor();
  }
  function duplicate(i: number) {
    track.sections.splice(i + 1, 0, structuredClone(track.sections[i]));
    persist();
    renderEditor();
  }
  function remove(i: number) {
    if (track.sections.length === 1) return toast('A click track needs at least one section');
    track.sections.splice(i, 1);
    persist();
    renderEditor();
  }

  function renderEditor() {
    editor.replaceChildren(...track.sections.map(sectionCard));
    renderSummary();
  }

  function renderAll() {
    nameInput.value = track.name;
    countIn.value = String(track.countInBars);
    renderLibrary();
    renderEditor();
    nowPlaying.textContent = 'Ready';
  }

  async function togglePlay() {
    if (scheduler?.isRunning) {
      stop();
      return;
    }
    // A second tap while the audio context is starting cancels the first.
    if (starting) {
      starting = false;
      return;
    }
    starting = true;
    const ctx = await ensureRunning();
    if (!starting || disposed) return;
    starting = false;
    scheduler ??= new LookaheadScheduler(ctx, { dest: getMaster() });
    claimTransport('clicktrack', stop);
    const { events, duration } = expandClickTrack(track);
    let i = 0;
    const s = getSettings().metronome;
    playStartedAt = performance.now();
    playBtn.replaceChildren(icon('stop', 20));
    view.classList.add('playing');
    playhead.hidden = false;
    playStartAudio = scheduler.start(
      () => events[i++] ?? null,
      (e) => {
        if (e.level !== 'silent') registerClick(e.when);
        playClick(ctx, scheduler?.destination ?? getMaster(), e.when, e.level, e.countIn ? 'tick' : s.sound, s.volume, { accentDb: s.accentDb });
      },
      (e) => {
        if (e.sub !== 0) return;
        const sec = track.sections[e.section];
        nowPlaying.replaceChildren(
          e.countIn
            ? h('b', null, `Count-in ${e.beat + 1}`)
            : h('span', null, h('b', null, sec?.name || `Section ${e.section + 1}`), ` · bar ${e.bar + 1} · beat ${e.beat + 1}`),
          h('span', { class: 'np-bpm' }, `${Math.round(e.bpm)} BPM`),
        );
        editor.querySelectorAll('.section-card').forEach((c, idx) => c.classList.toggle('current', idx === e.section));
      },
      () => {
        finish();
        if (loop) void togglePlay();
        else nowPlaying.textContent = 'Finished';
      },
    );
    const tick = () => {
      if (!scheduler?.isRunning) return;
      const t = Math.max(0, ctx.currentTime - playStartAudio);
      playhead.style.left = `${Math.min(100, (t / duration) * 100)}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function finish() {
    releaseTransport('clicktrack');
    if (playStartedAt) logPractice((performance.now() - playStartedAt) / 1000, 'metronome');
    playStartedAt = 0;
    cancelAnimationFrame(raf);
    playBtn.replaceChildren(icon('play', 22));
    view.classList.remove('playing');
    playhead.hidden = true;
    editor.querySelectorAll('.section-card.current').forEach((c) => c.classList.remove('current'));
  }

  function stop() {
    if (!scheduler?.isRunning) return;
    scheduler.stop();
    finish();
    nowPlaying.textContent = 'Stopped';
  }

  const view = h(
    'section',
    { class: 'view clicktrack' },
    library,
    h(
      'div',
      { class: 'card track-card' },
      h('div', { class: 'track-head' }, nameInput, countIn),
      summary,
      h('div', { class: 'timeline-wrap' }, timeline),
    ),
    editor,
    h(
      'div',
      { class: 'row wrap center' },
      h('button', { class: 'pill-btn', onclick: () => { track.sections.push(structuredClone(track.sections[track.sections.length - 1]) ?? section('', 8, 100)); persist(); renderEditor(); } }, icon('plus', 16), 'Add section'),
      h(
        'button',
        {
          class: 'pill-btn danger',
          onclick: () => {
            if (!confirm(`Delete "${track.name}"?`)) return;
            stop();
            updateSettings((s) => ({ clickTracks: s.clickTracks.filter((t) => t.id !== track.id) }));
            track = structuredClone(getSettings().clickTracks[0] ?? TEMPLATES[0].build());
            renderAll();
          },
        },
        icon('trash', 16),
        'Delete track',
      ),
    ),
    h('div', { class: 'sticky-play' }, playBtn, nowPlaying, loopBtn),
  );
  root.append(view);
  if (!getSettings().clickTracks.some((t) => t.id === track.id)) saveTrack(track);
  renderAll();

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement) return;
    if (e.code === 'Space') {
      e.preventDefault();
      void togglePlay();
    }
  };
  window.addEventListener('keydown', onKey);

  return () => {
    disposed = true;
    starting = false;
    window.removeEventListener('keydown', onKey);
    stop();
  };
}
