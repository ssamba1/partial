import { ensureRunning, getMaster } from '../../audio/context';
import { LookaheadScheduler } from '../../audio/scheduler';
import { playClick } from '../../audio/voices';
import { formatDuration, uid } from '../../core/format';
import { clampBpm, defaultAccents, expandClickTrack, type ClickSection, type ClickTrack } from '../../core/rhythm';
import { getSettings, logPractice, updateSettings } from '../../store/settings';
import { h, numberInput, select } from '../dom';
import { metronome } from '../shared';

function newSection(): ClickSection {
  return { name: '', bars: 8, bpm: 100, beatsPerBar: 4, beatUnit: 4, subdivision: 1, accents: defaultAccents(4) };
}

function newTrack(): ClickTrack {
  return { id: uid(), name: 'New click track', countInBars: 1, sections: [newSection()] };
}

function saveTrack(track: ClickTrack) {
  updateSettings((s) => {
    const others = s.clickTracks.filter((t) => t.id !== track.id);
    return { clickTracks: [...others, structuredClone(track)] };
  });
}

export function mountClickTrack(root: HTMLElement) {
  let track: ClickTrack = structuredClone(getSettings().clickTracks[0] ?? newTrack());
  let scheduler: LookaheadScheduler | null = null;
  let playStartedAt = 0;

  const library = h('div', { class: 'row wrap' });
  const editor = h('div', { class: 'sections' });
  const nameInput = h('input', {
    type: 'text',
    class: 'track-name',
    'aria-label': 'Click track name',
    oninput: (e: Event) => {
      track.name = (e.target as HTMLInputElement).value;
    },
    onchange: () => persist(),
  });
  const countInInput = numberInput(
    track.countInBars,
    (n) => {
      track.countInBars = Math.max(0, Math.round(n));
      persist();
    },
    { min: 0, max: 8 },
  );
  const summary = h('div', { class: 'muted small' });
  const nowPlaying = h('div', { class: 'now-playing', 'aria-live': 'polite' });
  const playBtn = h('button', { class: 'primary big', onclick: () => void togglePlay() }, 'Play');

  function persist() {
    saveTrack(track);
    renderLibrary();
    renderSummary();
  }

  function renderSummary() {
    const { events, duration } = expandClickTrack(track);
    const bars = track.sections.reduce((n, s) => n + s.bars, 0);
    summary.textContent = `${track.sections.length} section(s), ${bars} bars, ${formatDuration(duration)} including count-in, ${events.filter((e) => e.sub === 0).length} beats`;
  }

  function renderLibrary() {
    const tracks = getSettings().clickTracks;
    library.replaceChildren(
      ...tracks.map((t) =>
        h(
          'button',
          {
            class: `chip${t.id === track.id ? ' on' : ''}`,
            onclick: () => {
              stop();
              track = structuredClone(t);
              renderAll();
            },
          },
          t.name || 'Untitled',
        ),
      ),
      h(
        'button',
        {
          class: 'chip add',
          onclick: () => {
            stop();
            track = newTrack();
            persist();
            renderAll();
          },
        },
        '+ New',
      ),
    );
  }

  function sectionRow(section: ClickSection, index: number): HTMLElement {
    const update = (patch: Partial<ClickSection>) => {
      Object.assign(section, patch);
      if (patch.beatsPerBar !== undefined) section.accents = defaultAccents(section.beatsPerBar);
      persist();
    };
    const ramp = section.endBpm !== undefined;
    return h(
      'div',
      { class: 'section-card' },
      h(
        'div',
        { class: 'row between' },
        h('input', {
          type: 'text',
          placeholder: `Section ${index + 1}`,
          value: section.name ?? '',
          'aria-label': 'Section name',
          onchange: (e: Event) => update({ name: (e.target as HTMLInputElement).value }),
        }),
        h(
          'div',
          { class: 'row tight' },
          h('button', { class: 'icon', title: 'Move up', 'aria-label': 'Move section up', disabled: index === 0, onclick: () => move(index, -1) }, '↑'),
          h('button', { class: 'icon', title: 'Move down', 'aria-label': 'Move section down', disabled: index === track.sections.length - 1, onclick: () => move(index, 1) }, '↓'),
          h('button', { class: 'icon', title: 'Duplicate', 'aria-label': 'Duplicate section', onclick: () => duplicate(index) }, '⧉'),
          h('button', { class: 'icon danger', title: 'Remove', 'aria-label': 'Remove section', disabled: track.sections.length === 1, onclick: () => remove(index) }, '✕'),
        ),
      ),
      h(
        'div',
        { class: 'section-fields' },
        h('label', null, 'Bars', numberInput(section.bars, (n) => update({ bars: Math.max(1, Math.round(n)) }), { min: 1, max: 999 })),
        h('label', null, 'BPM', numberInput(section.bpm, (n) => update({ bpm: clampBpm(n) }), { min: 20, max: 400 })),
        h(
          'label',
          null,
          h('span', null, h('input', { type: 'checkbox', checked: ramp, onchange: (e: Event) => update({ endBpm: (e.target as HTMLInputElement).checked ? section.bpm : undefined }) }), ' Ramp to'),
          numberInput(section.endBpm ?? section.bpm, (n) => update({ endBpm: clampBpm(n) }), { min: 20, max: 400, class: ramp ? '' : 'disabled' }),
        ),
        h(
          'label',
          null,
          'Meter',
          h(
            'span',
            { class: 'row tight' },
            numberInput(section.beatsPerBar, (n) => update({ beatsPerBar: Math.min(16, Math.max(1, Math.round(n))) }), { min: 1, max: 16 }),
            '/',
            select([2, 4, 8, 16].map((v) => ({ value: v, label: String(v) })), section.beatUnit, (v) => update({ beatUnit: Number(v) })),
          ),
        ),
        h(
          'label',
          null,
          'Subdivision',
          select([1, 2, 3, 4, 6].map((v) => ({ value: v, label: String(v) })), section.subdivision, (v) => update({ subdivision: Number(v) })),
        ),
      ),
    );
  }

  function move(i: number, d: number) {
    const [s] = track.sections.splice(i, 1);
    track.sections.splice(i + d, 0, s);
    persist();
    renderEditor();
  }
  function duplicate(i: number) {
    track.sections.splice(i + 1, 0, structuredClone(track.sections[i]));
    persist();
    renderEditor();
  }
  function remove(i: number) {
    track.sections.splice(i, 1);
    persist();
    renderEditor();
  }

  function renderEditor() {
    editor.replaceChildren(...track.sections.map(sectionRow));
  }

  function renderAll() {
    nameInput.value = track.name;
    countInInput.value = String(track.countInBars);
    renderLibrary();
    renderEditor();
    renderSummary();
    nowPlaying.textContent = '';
  }

  async function togglePlay() {
    if (scheduler?.isRunning) {
      stop();
      return;
    }
    metronome.stop();
    const ctx = await ensureRunning();
    scheduler ??= new LookaheadScheduler(ctx);
    const { events } = expandClickTrack(track);
    let i = 0;
    const sound = getSettings().metronome.sound;
    const volume = getSettings().metronome.volume;
    playStartedAt = performance.now();
    playBtn.textContent = 'Stop';
    scheduler.start(
      () => events[i++] ?? null,
      (e) => playClick(ctx, getMaster(), e.when, e.level, sound, volume),
      (e) => {
        if (e.sub !== 0) return;
        const section = track.sections[e.section];
        nowPlaying.textContent = e.countIn
          ? `Count-in ${e.beat + 1}`
          : `${section?.name || `Section ${e.section + 1}`} · bar ${e.bar + 1} · beat ${e.beat + 1} · ${Math.round(e.bpm)} BPM`;
      },
      () => {
        finish();
        nowPlaying.textContent = 'Finished';
      },
    );
  }

  function finish() {
    if (playStartedAt) logPractice((performance.now() - playStartedAt) / 1000);
    playStartedAt = 0;
    playBtn.textContent = 'Play';
  }

  function stop() {
    if (!scheduler?.isRunning) return;
    scheduler.stop();
    finish();
    nowPlaying.textContent = 'Stopped';
  }

  root.append(
    h(
      'section',
      { class: 'view clicktrack' },
      h('p', { class: 'muted' }, 'Build a click track from sections with their own tempo, meter and optional tempo ramp. Saved on this device.'),
      library,
      h('div', { class: 'row between wrap' }, nameInput, h('label', { class: 'row tight' }, 'Count-in bars', countInInput)),
      summary,
      editor,
      h(
        'div',
        { class: 'row wrap' },
        h('button', { onclick: () => { track.sections.push(newSection()); persist(); renderEditor(); } }, '+ Add section'),
        h(
          'button',
          {
            class: 'danger',
            onclick: () => {
              if (!confirm(`Delete "${track.name}"?`)) return;
              stop();
              updateSettings((s) => ({ clickTracks: s.clickTracks.filter((t) => t.id !== track.id) }));
              track = structuredClone(getSettings().clickTracks[0] ?? newTrack());
              renderAll();
            },
          },
          'Delete track',
        ),
      ),
      h('div', { class: 'sticky-play' }, nowPlaying, playBtn),
    ),
  );
  if (!getSettings().clickTracks.some((t) => t.id === track.id)) saveTrack(track);
  renderAll();

  return () => stop();
}
