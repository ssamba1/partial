import type { TrackerFrame } from '../audio/pitchTracker';
import { formatHz, signedCents } from '../core/display';
import { dayKey } from '../core/practice';
import { frequencyToNote, noteName, prettyName, ratioToCents, TRANSPOSITIONS, transpose } from '../core/notes';
import { nearestMidi } from '../core/scales';
import { guidedNotes, TENDENCY_REFERENCE, tipFor } from '../core/tendencyref';
import {
  BeatMeter,
  beatCents,
  driftText,
  fitInharmonicity,
  matchPartials,
  measure,
  medianHz,
  RangeFinder,
  sortTuningChecks,
  spectrumPeaks,
  StrikeWatcher,
  stretchCurve,
  tuningChecksCsv,
  type TuningCheckSort,
} from '../core/tuningtools';
import { getSettings, tuningOf, updateSettings } from '../store/settings';
import { openSheet, segmented } from './components';
import { h, select, setText } from './dom';

export interface ToolsHost {
  onFrame: (fn: (f: TrackerFrame) => void) => () => void;
  wideSamples: () => { samples: Float32Array; sampleRate: number } | null;
  /** Starts the tuner if needed; false if the mic could not open. */
  ensureListening: () => Promise<boolean>;
  /** Makes a second tracker on one input of a stereo interface. */
  channelTracker: (channel: 'left' | 'right') => { onFrame: (fn: (f: TrackerFrame) => void) => () => void; start: () => Promise<void>; stop: () => void };
}

const semis = () => TRANSPOSITIONS.find((t) => t.id === getSettings().transposition)?.semitones ?? 0;
const written = (concertMidi: number) => prettyName(noteName(transpose(concertMidi, semis()), getSettings().flats));

/** Collects frame readings for `ms`, then calls `done` with them. Returns a cancel function. */
function collect(host: ToolsHost, ms: number, onEach: (f: TrackerFrame, elapsed: number) => void, done: () => void): () => void {
  const start = performance.now();
  let finished = false;
  const off = host.onFrame((f) => {
    const elapsed = performance.now() - start;
    onEach(f, elapsed);
    if (elapsed >= ms && !finished) {
      finished = true;
      off();
      done();
    }
  });
  return () => {
    finished = true;
    off();
  };
}

function card(title: string, hint: string, ...body: (HTMLElement | null)[]): HTMLElement {
  return h('details', { class: 'tool-card' }, h('summary', null, title), h('small', { class: 'muted' }, hint), ...body);
}

/** Median frequency of steady readings over `ms`. */
function captureHz(host: ToolsHost, ms: number, out: (hz: number | null) => void): () => void {
  const hz: number[] = [];
  return collect(
    host,
    ms,
    (f) => {
      if (f.frequency && !f.held && !f.gated) hz.push(f.frequency);
    },
    () => out(medianHz(hz)),
  );
}

/* ----- Measure (01-98) ----- */
function measureTool(host: ToolsHost): HTMLElement {
  const result = h('p', { class: 'tool-result', role: 'status' });
  const btn = h('button', {
    class: 'pill-btn',
    onclick: async () => {
      if (!(await host.ensureListening())) return setText(result, 'Microphone not available.');
      btn.disabled = true;
      setText(result, 'Measuring for 3 seconds. Hold the note.');
      const readings: { hz: number; cents: number; midi: number }[] = [];
      collect(
        host,
        3000,
        (f) => {
          if (f.frequency && f.note && !f.held && !f.gated) readings.push({ hz: f.frequency, cents: f.note.cents, midi: f.note.midi });
        },
        () => {
          btn.disabled = false;
          const m = measure(readings);
          if (!m) return setText(result, 'No steady note heard.');
          const midi = frequencyToNote(m.meanHz, tuningOf(getSettings())).midi;
          setText(result, `${written(midi)}: ${m.meanHz.toFixed(2)} Hz ± ${m.sdHz.toFixed(2)}, ${signedCents(m.meanCents, true)} ± ${m.sdCents.toFixed(1)}¢ (${m.count} readings)`);
        },
      );
    },
  }, 'Measure 3 s');
  return card('Measure', 'Averages 3 seconds of a held note: mean and standard deviation.', btn, result);
}

/* ----- Beat meter (01-94) ----- */
function beatTool(host: ToolsHost): HTMLElement {
  const result = h('p', { class: 'tool-result', role: 'status' });
  let cancel: (() => void) | null = null;
  const meter = new BeatMeter(6, 60);
  const btn = h('button', {
    class: 'pill-btn',
    onclick: async () => {
      if (cancel) {
        cancel();
        cancel = null;
        btn.textContent = 'Start';
        return;
      }
      if (!(await host.ensureListening())) return setText(result, 'Microphone not available.');
      meter.reset();
      btn.textContent = 'Stop';
      let shownAt = 0;
      cancel = host.onFrame((f) => {
        meter.push(performance.now() / 1000, f.level);
        const now = performance.now();
        if (now - shownAt < 500) return;
        shownAt = now;
        const r = meter.read();
        if (!r) return setText(result, 'Listening. Play two notes together for a few seconds.');
        const hz = f.frequency ?? 0;
        setText(result, `${r.hz.toFixed(2)} beats per second${hz ? `, about ${beatCents(hz, r.hz).toFixed(1)}¢ apart at ${formatHz(hz)} Hz` : ''}`);
      });
    },
  }, 'Start');
  return card('Beat meter', 'Counts beats between two sounds, such as a unison or a string against a fork. Slow beats up to about 6 per second read best.', btn, result);
}

/* ----- Choir drift (01-101) ----- */
function driftTool(host: ToolsHost): HTMLElement {
  const result = h('p', { class: 'tool-result', role: 'status' });
  let startHz: number | null = null;
  const run = async (which: 'start' | 'end', btn: HTMLButtonElement) => {
    if (!(await host.ensureListening())) return setText(result, 'Microphone not available.');
    btn.disabled = true;
    setText(result, 'Listening for 2 seconds.');
    captureHz(host, 2000, (hz) => {
      btn.disabled = false;
      if (!hz) return setText(result, 'No steady note heard.');
      if (which === 'start') {
        startHz = hz;
        endBtn.disabled = false;
        setText(result, `Start pitch ${formatHz(hz)} Hz. Sing the piece, then check the end on the same note.`);
      } else if (startHz) setText(result, driftText(startHz, hz, getSettings().tolerance));
    });
  };
  const startBtn: HTMLButtonElement = h('button', { class: 'pill-btn', onclick: () => void run('start', startBtn) }, 'Set start pitch');
  const endBtn: HTMLButtonElement = h('button', { class: 'pill-btn', disabled: true, onclick: () => void run('end', endBtn) }, 'Check end');
  return card('Choir drift', 'Sing the key note at the start and again at the end to see how far the pitch moved.', h('div', { class: 'row wrap tight' }, startBtn, endBtn), result);
}

/* ----- Vocal range (01-100) ----- */
function rangeTool(host: ToolsHost): HTMLElement {
  const finder = new RangeFinder(0.5);
  const s = getSettings();
  const result = h('p', { class: 'tool-result', role: 'status' }, s.vocalRange ? `Saved: ${written(s.vocalRange.low)} to ${written(s.vocalRange.high)}` : '');
  let cancel: (() => void) | null = null;
  const show = () => setText(result, finder.low === null ? 'Hold each note for half a second.' : `${written(finder.low)} to ${written(finder.high!)}`);
  const btn = h('button', {
    class: 'pill-btn',
    onclick: async () => {
      if (cancel) {
        cancel();
        cancel = null;
        btn.textContent = 'Find my range';
        if (finder.low !== null && finder.high !== null) {
          updateSettings({ vocalRange: { low: finder.low, high: finder.high } });
          setText(result, `Saved: ${written(finder.low)} to ${written(finder.high)}`);
        }
        return;
      }
      if (!(await host.ensureListening())) return setText(result, 'Microphone not available.');
      finder.reset();
      btn.textContent = 'Done';
      show();
      cancel = host.onFrame((f) => {
        finder.push(f.note && !f.held && !f.gated ? f.note.midi : null, performance.now() / 1000);
        show();
      });
    },
  }, 'Find my range');
  return card('Vocal range', 'Slide down to your lowest comfortable note and up to your highest. Notes count once held for half a second.', btn, result);
}

/* ----- Ensemble tuning check (01-102) ----- */
function checkTool(host: ToolsHost): HTMLElement {
  const player = h('input', { type: 'text', maxlength: 40, placeholder: 'Player', 'aria-label': 'Player' });
  const inst = h('input', { type: 'text', maxlength: 40, placeholder: 'Instrument', 'aria-label': 'Instrument' });
  const status = h('p', { class: 'tool-result', role: 'status' });
  let sort: TuningCheckSort = 'time';
  const table = h('table', { class: 'data-table' });
  const render = () => {
    const rows = sortTuningChecks(getSettings().tuningChecks, sort);
    table.replaceChildren(
      h('tr', null, h('th', null, 'Player'), h('th', null, 'Instrument'), h('th', null, 'Note'), h('th', null, 'Cents')),
      ...rows.map((e) => h('tr', null, h('td', null, e.player), h('td', null, e.instrument), h('td', null, e.note), h('td', null, signedCents(e.cents, true)))),
    );
  };
  render();
  const record = h('button', {
    class: 'pill-btn primary',
    onclick: async () => {
      if (!player.value.trim()) return setText(status, 'Enter the player first.');
      if (!(await host.ensureListening())) return setText(status, 'Microphone not available.');
      record.disabled = true;
      setText(status, 'Listening for 2 seconds.');
      const readings: { hz: number; cents: number; midi: number }[] = [];
      collect(
        host,
        2000,
        (f) => {
          if (f.frequency && f.note && !f.held && !f.gated) readings.push({ hz: f.frequency, cents: f.note.cents, midi: f.note.midi });
        },
        () => {
          record.disabled = false;
          const m = measure(readings);
          if (!m) return setText(status, 'No steady note heard.');
          const midi = frequencyToNote(m.meanHz, tuningOf(getSettings())).midi;
          const entry = { player: player.value.trim(), instrument: inst.value.trim(), note: written(midi), cents: Math.round(m.meanCents * 10) / 10, time: Date.now() };
          updateSettings((cur) => ({ tuningChecks: [...cur.tuningChecks, entry] }));
          setText(status, `${entry.player}: ${entry.note} ${signedCents(entry.cents, true)}`);
          player.value = '';
          render();
        },
      );
    },
  }, 'Record check');
  const exportBtn = h('button', {
    class: 'pill-btn',
    onclick: () => {
      const blob = new Blob([tuningChecksCsv(getSettings().tuningChecks)], { type: 'text/csv' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `partial-tuning-checks-${dayKey(new Date())}.csv` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
  }, 'Export CSV');
  const clear = h('button', { class: 'pill-btn danger', onclick: () => { if (confirm('Clear all tuning checks?')) { updateSettings({ tuningChecks: [] }); render(); } } }, 'Clear');
  const sortSeg = segmented(
    [
      { value: 'time', label: 'Time' },
      { value: 'player', label: 'Player' },
      { value: 'cents', label: 'Worst first' },
    ],
    sort,
    (v) => {
      sort = v as TuningCheckSort;
      render();
    },
    'Sort checks',
  );
  return card('Tuning checks', 'For a section or class: each player plays their tuning note and the result is logged.', h('div', { class: 'row wrap tight' }, player, inst, record), status, sortSeg, h('div', { class: 'table-wrap' }, table), h('div', { class: 'row wrap tight' }, exportBtn, clear));
}

/* ----- Guitar intonation (01-97) ----- */
function intonationTool(host: ToolsHost): HTMLElement {
  const result = h('p', { class: 'tool-result', role: 'status' });
  let harmonic: number | null = null;
  const step = async (which: 'harmonic' | 'fretted', btn: HTMLButtonElement) => {
    if (!(await host.ensureListening())) return setText(result, 'Microphone not available.');
    btn.disabled = true;
    setText(result, 'Listening for 2 seconds.');
    captureHz(host, 2000, (hz) => {
      btn.disabled = false;
      if (!hz) return setText(result, 'No steady note heard.');
      if (which === 'harmonic') {
        harmonic = hz;
        fretBtn.disabled = false;
        setText(result, `Harmonic ${formatHz(hz)} Hz. Now fret the same string at the 12th fret.`);
        return;
      }
      if (!harmonic) return;
      const c = ratioToCents(hz / harmonic);
      const tol = Math.max(2, getSettings().tolerance / 2);
      // Fender support: "If sharp, lengthen the string by adjusting the saddle back" and "If flat, shorten the string by moving the saddle forward."
      // https://support.fender.com/hc/en-us/articles/42584764005019
      const advice = Math.abs(c) <= tol ? 'Intonation is good on this string.' : c > 0 ? 'Fretted note is sharp: move the saddle back, away from the neck.' : 'Fretted note is flat: move the saddle forward, toward the neck.';
      setText(result, `Fretted ${signedCents(c, true)} from the harmonic. ${advice}`);
    });
  };
  const harmBtn: HTMLButtonElement = h('button', { class: 'pill-btn', onclick: () => void step('harmonic', harmBtn) }, '1. Play 12th fret harmonic');
  const fretBtn: HTMLButtonElement = h('button', { class: 'pill-btn', disabled: true, onclick: () => void step('fretted', fretBtn) }, '2. Play 12th fret note');
  return card('Guitar intonation', 'Compares the 12th fret note with the harmonic on the same string and says which way to move the saddle. Tune the open string first.', h('div', { class: 'row wrap tight' }, harmBtn, fretBtn), result);
}

/* ----- Piano stretch (01-93) ----- */
function pianoTool(host: ToolsHost): HTMLElement {
  const result = h('p', { class: 'tool-result', role: 'status' });
  const list = h('p', { class: 'muted small' });
  const renderList = () => {
    const b = getSettings().pianoB;
    const keys = Object.keys(b).map(Number).sort((x, y) => x - y);
    if (!keys.length) return setText(list, 'No notes measured yet.');
    const curve = keys.length >= 2 ? stretchCurve(b) : null;
    setText(list, keys.map((m) => `${prettyName(noteName(m, getSettings().flats))} B ${b[m].toExponential(1)}${curve ? `, stretch ${signedCents(curve[m], true)}` : ''}`).join('; '));
  };
  renderList();
  let cancel: (() => void) | null = null;
  const btn = h('button', {
    class: 'pill-btn',
    onclick: async () => {
      if (cancel) return;
      if (!(await host.ensureListening())) return setText(result, 'Microphone not available.');
      setText(result, 'Strike one key firmly and let it ring.');
      const watcher = new StrikeWatcher();
      cancel = host.onFrame((f) => {
        const { ready } = watcher.update(f.level, performance.now());
        if (!ready) return;
        cancel?.();
        cancel = null;
        const wide = host.wideSamples();
        const f1 = f.frequency;
        if (!wide || !f1) return setText(result, 'Could not read the note. Try again.');
        const peaks = spectrumPeaks(wide.samples, wide.sampleRate, { count: 16, minHz: f1 * 0.8, maxHz: Math.min(5000, f1 * 8), padTo: 65536 });
        const fit = fitInharmonicity(matchPartials(peaks, f1, 6));
        const midi = nearestMidi(f1, getSettings().a4);
        if (!fit || fit.B < 0) return setText(result, 'Too few partials found. Try a note below C6.');
        updateSettings((cur) => ({ pianoB: { ...cur.pianoB, [midi]: fit.B } }));
        setText(result, `${prettyName(noteName(midi, getSettings().flats))}: B = ${fit.B.toExponential(2)}`);
        renderList();
      });
    },
  }, 'Measure a note');
  const s = getSettings();
  const stretch = h('label', { class: 'switch-row' }, h('span', null, h('strong', null, 'Tune to the stretch'), h('small', null, 'Chromatic targets follow the curve from measured notes, A4 unchanged. Measure at least two notes an octave or more apart.')), h('input', { type: 'checkbox', role: 'switch', checked: s.pianoStretch, onchange: (e: Event) => updateSettings({ pianoStretch: (e.target as HTMLInputElement).checked }) }));
  const clear = h('button', { class: 'pill-btn danger', onclick: () => { updateSettings({ pianoB: {} }); renderList(); } }, 'Clear');
  return card('Piano stretch', 'Measures how inharmonic each string is from its partials and builds a stretched tuning from matching 4:2 octaves.', h('div', { class: 'row wrap tight' }, btn, clear), result, list, stretch);
}

/* ----- Capture my scale (01-85) ----- */
function scaleTool(host: ToolsHost): HTMLElement {
  const result = h('p', { class: 'tool-result', role: 'status' });
  const list = h('div', { class: 'chips' });
  const render = () =>
    list.replaceChildren(
      ...getSettings().capturedScale.map((n, i) =>
        h('span', { class: 'chip preset-chip' }, h('span', { class: 'chip-main' }, `${n.label || i + 1} ${formatHz(n.hz)}`), h('button', { class: 'chip-x', 'aria-label': `Remove note ${i + 1}`, onclick: () => { updateSettings((c) => ({ capturedScale: c.capturedScale.filter((_, k) => k !== i) })); render(); } }, '×')),
      ),
    );
  render();
  const label = h('input', { type: 'text', maxlength: 12, placeholder: 'Name, e.g. Sa', 'aria-label': 'Note name' });
  const add = h('button', {
    class: 'pill-btn',
    onclick: async () => {
      if (!(await host.ensureListening())) return setText(result, 'Microphone not available.');
      add.disabled = true;
      setText(result, 'Listening for 1.5 seconds.');
      captureHz(host, 1500, (hz) => {
        add.disabled = false;
        if (!hz) return setText(result, 'No steady note heard.');
        updateSettings((c) => ({ capturedScale: [...c.capturedScale, { hz, label: label.value.trim() }].sort((a, b) => a.hz - b.hz) }));
        label.value = '';
        setText(result, `Added ${formatHz(hz)} Hz.`);
        render();
      });
    },
  }, 'Add note');
  const use = h('button', { class: 'pill-btn primary', onclick: () => updateSettings({ tunerMode: 'scale' }) }, 'Tune to this scale');
  return card('My scale', 'Play each note of an instrument you tune to, such as a harmonium or a fixed-pitch keyboard. The My scale mode then tunes to these notes in any octave.', h('div', { class: 'row wrap tight' }, label, add, use), result, list);
}

/* ----- Dual tuner (01-103) ----- */
function dualTool(host: ToolsHost): HTMLElement {
  const left = h('p', { class: 'tool-result' }, 'Left: -');
  const right = h('p', { class: 'tool-result' }, 'Right: -');
  let running: { stop: () => void }[] = [];
  const btn = h('button', {
    class: 'pill-btn',
    onclick: async () => {
      if (running.length) {
        running.forEach((r) => r.stop());
        running = [];
        btn.textContent = 'Start both inputs';
        return;
      }
      btn.textContent = 'Stop';
      for (const [channel, el] of [['left', left], ['right', right]] as const) {
        const t = host.channelTracker(channel);
        const off = t.onFrame((f) => {
          const name = channel === 'left' ? 'Left' : 'Right';
          if (!f.note || f.held) return;
          setText(el, `${name}: ${written(f.note.midi)} ${signedCents(f.displayCents, false)}`);
        });
        running.push({ stop: () => { off(); t.stop(); } });
        try {
          await t.start();
        } catch {
          setText(el, 'Could not open this input.');
        }
      }
    },
  }, 'Start both inputs');
  return card('Dual tuner', 'Two instruments on the two inputs of a stereo interface, read at once. Stop the main tuner first.', btn, left, right);
}

/* ----- Tendency guide (01-96) ----- */
function tendencyTool(host: ToolsHost): HTMLElement {
  const s = getSettings();
  const tips = h('ul', { class: 'tool-list' });
  const guide = h('p', { class: 'tool-result', role: 'status' });
  const render = (id: string) => {
    const ref = TENDENCY_REFERENCE.find((r) => r.id === id);
    tips.replaceChildren(...(ref?.tips ?? []).map((t) => h('li', null, t.text, ' ', h('a', { href: t.source, target: '_blank', rel: 'noopener' }, 'source'))));
  };
  render(s.tendencyInstrument);
  let cancel: (() => void) | null = null;
  const startGuide = h('button', {
    class: 'pill-btn',
    onclick: async () => {
      if (cancel) {
        cancel();
        cancel = null;
        startGuide.textContent = 'Guided check';
        return;
      }
      const notes = guidedNotes(getSettings().tendencyInstrument);
      if (!notes.length) return setText(guide, 'No specific notes listed for this instrument.');
      if (!(await host.ensureListening())) return setText(guide, 'Microphone not available.');
      let i = 0;
      const results: string[] = [];
      const say = () => setText(guide, `Play written ${prettyName(noteName(notes[i], getSettings().flats))}. ${tipFor(getSettings().tendencyInstrument, notes[i])?.text ?? ''}`);
      say();
      startGuide.textContent = 'Stop';
      const readings: number[] = [];
      cancel = host.onFrame((f) => {
        if (!f.note || f.held || f.gated) return;
        if (transpose(f.note.midi, semis()) !== notes[i]) return;
        readings.push(f.note.cents);
        if (readings.length < 60) return;
        const sorted = [...readings].sort((a, b) => a - b);
        results.push(`${prettyName(noteName(notes[i], getSettings().flats))} ${signedCents(sorted[sorted.length >> 1], true)}`);
        readings.length = 0;
        i++;
        if (i >= notes.length) {
          cancel?.();
          cancel = null;
          startGuide.textContent = 'Guided check';
          setText(guide, `Done: ${results.join(', ')}`);
        } else say();
      });
    },
  }, 'Guided check');
  const pick = select([{ value: '', label: 'Instrument' }, ...TENDENCY_REFERENCE.map((r) => ({ value: r.id, label: r.label }))], s.tendencyInstrument, (v) => {
    updateSettings({ tendencyInstrument: v });
    render(v);
  }, { 'aria-label': 'Instrument for tendencies' });
  return card('Known tendencies', 'Notes teachers say run sharp or flat, shown while you play them. Set the instrument key to match.', h('div', { class: 'row wrap tight' }, pick, startGuide), tips, guide);
}

/** Measuring tools that run on the tuner's microphone. */
export function openTunerTools(host: ToolsHost): void {
  // Tools listen through these wrappers, so closing the sheet removes every listener and stops the dual trackers.
  const stops: (() => void)[] = [];
  const wrapped: ToolsHost = {
    ...host,
    onFrame: (fn) => {
      const off = host.onFrame(fn);
      stops.push(off);
      return off;
    },
    channelTracker: (channel) => {
      const t = host.channelTracker(channel);
      stops.push(() => t.stop());
      return t;
    },
  };
  const body = h(
    'div',
    { class: 'stack tools' },
    measureTool(wrapped),
    beatTool(wrapped),
    driftTool(wrapped),
    rangeTool(wrapped),
    checkTool(wrapped),
    intonationTool(wrapped),
    pianoTool(wrapped),
    scaleTool(wrapped),
    tendencyTool(wrapped),
    dualTool(wrapped),
  );
  openSheet('Tools', body, { onClose: () => stops.forEach((s) => s()), wide: true });
}
