import { MicError } from '../../audio/context';
import { formatCents } from '../../core/format';
import { noteName } from '../../core/notes';
import { harmonicLevels, magnitudeSpectrum } from '../../core/spectrum';
import { getSettings } from '../../store/settings';
import { cssVar, errorBox, fitCanvas, h } from '../dom';
import { createTracker } from '../shared';

const PITCH_WINDOW = 12;

export function mountAnalysis(root: HTMLElement) {
  const tracker = createTracker();
  const pitchHistory: { t: number; midi: number | null; cents: number }[] = [];
  let paused = false;

  const waveCanvas = h('canvas', { class: 'chart', 'aria-label': 'Waveform' });
  const specCanvas = h('canvas', { class: 'chart tall', 'aria-label': 'Spectrum' });
  const pitchCanvas = h('canvas', { class: 'chart tall', 'aria-label': 'Pitch over time' });
  const readout = h('div', { class: 'readout', 'aria-live': 'polite' }, 'Press start to analyse the microphone');
  const harmonicsEl = h('div', { class: 'harmonics' });
  const statsEl = h('div', { class: 'muted small' });
  const errorSlot = h('div');
  const startBtn = h('button', { class: 'primary big', onclick: () => void toggle() }, 'Start analysis');
  const pauseBtn = h('button', { class: 'big', onclick: () => { paused = !paused; pauseBtn.textContent = paused ? 'Resume view' : 'Freeze view'; } }, 'Freeze view');

  async function toggle() {
    errorSlot.replaceChildren();
    if (tracker.running) {
      tracker.stop();
      startBtn.textContent = 'Start analysis';
      return;
    }
    try {
      await tracker.start();
      startBtn.textContent = 'Stop';
    } catch (err) {
      errorSlot.append(errorBox(err instanceof MicError ? err.message : 'Could not start the microphone.', () => void toggle()));
    }
  }

  const off = tracker.onFrame((f) => {
    pitchHistory.push({ t: f.time, midi: f.note?.midi ?? null, cents: f.note?.cents ?? 0 });
    while (pitchHistory.length && f.time - pitchHistory[0].t > PITCH_WINDOW) pitchHistory.shift();
    if (paused) return;

    const s = getSettings();
    drawWave(f.samples);
    const spec = magnitudeSpectrum(f.samples);
    const harmonics = f.frequency ? harmonicLevels(spec, f.sampleRate, f.frequency, 10) : [];
    drawSpectrum(spec, f.sampleRate, f.frequency);
    drawPitch(s.tolerance);

    if (f.note && f.frequency) {
      readout.textContent = `${noteName(f.note.midi, s.flats)} · ${formatCents(f.note.cents)} · ${f.frequency.toFixed(2)} Hz · clarity ${(f.clarity * 100).toFixed(0)}%`;
      const ref = harmonics[0]?.db ?? 0;
      harmonicsEl.replaceChildren(
        ...harmonics.map((hm) => {
          const rel = Math.max(-60, hm.db - ref);
          return h(
            'div',
            { class: 'harmonic', title: `Harmonic ${hm.number}: ${hm.frequency.toFixed(0)} Hz, ${rel.toFixed(1)} dB relative to fundamental` },
            h('div', { class: 'harmonic-bar', style: `height:${((rel + 60) / 60) * 100}%` }),
            h('span', null, String(hm.number)),
          );
        }),
      );
    } else {
      readout.textContent = 'Listening…';
    }

    const voiced = pitchHistory.filter((p) => p.midi !== null);
    if (voiced.length > 10) {
      const inTune = voiced.filter((p) => Math.abs(p.cents) <= s.tolerance).length;
      const mean = voiced.reduce((a, p) => a + p.cents, 0) / voiced.length;
      statsEl.textContent = `Last ${PITCH_WINDOW}s: ${Math.round((inTune / voiced.length) * 100)}% within ±${s.tolerance}¢, average ${formatCents(mean)}`;
    }
  });

  function drawWave(samples: Float32Array) {
    const ctx = fitCanvas(waveCanvas);
    const w = waveCanvas.clientWidth;
    const hh = waveCanvas.clientHeight;
    ctx.clearRect(0, 0, w, hh);
    ctx.strokeStyle = cssVar('--border');
    ctx.beginPath();
    ctx.moveTo(0, hh / 2);
    ctx.lineTo(w, hh / 2);
    ctx.stroke();
    // Trigger on a rising zero crossing so periodic waves stand still.
    let start = 0;
    for (let i = 1; i < samples.length / 2; i++) {
      if (samples[i - 1] < 0 && samples[i] >= 0) {
        start = i;
        break;
      }
    }
    const span = Math.min(samples.length - start, 2048);
    ctx.strokeStyle = cssVar('--accent');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const v = samples[start + Math.floor((x / w) * span)];
      const y = hh / 2 - v * (hh / 2) * 0.95;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function drawSpectrum(spec: Float32Array, sampleRate: number, f0: number | null) {
    const ctx = fitCanvas(specCanvas);
    const w = specCanvas.clientWidth;
    const hh = specCanvas.clientHeight;
    ctx.clearRect(0, 0, w, hh);
    const fMin = 30;
    const fMax = Math.min(10000, sampleRate / 2);
    const binHz = sampleRate / (spec.length * 2);
    const xOf = (f: number) => (Math.log(f / fMin) / Math.log(fMax / fMin)) * w;
    const yOf = (db: number) => hh - ((Math.max(-100, Math.min(0, db)) + 100) / 100) * hh;

    ctx.fillStyle = cssVar('--muted');
    ctx.font = '11px system-ui, sans-serif';
    ctx.strokeStyle = cssVar('--border');
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      if (f > fMax) break;
      const x = xOf(f);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, hh);
      ctx.stroke();
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 2, hh - 4);
    }

    if (f0) {
      ctx.strokeStyle = cssVar('--good');
      ctx.setLineDash([3, 3]);
      for (let k = 1; k <= 20 && f0 * k < fMax; k++) {
        const x = xOf(f0 * k);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, hh);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = cssVar('--accent');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    let lastX = -1;
    let maxDb = -Infinity;
    for (let b = Math.ceil(fMin / binHz); b < spec.length && b * binHz <= fMax; b++) {
      const x = Math.round(xOf(b * binHz));
      maxDb = Math.max(maxDb, spec[b]);
      if (x === lastX) continue;
      const y = yOf(maxDb);
      if (!started) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      started = true;
      lastX = x;
      maxDb = -Infinity;
    }
    ctx.stroke();
  }

  function drawPitch(tolerance: number) {
    const ctx = fitCanvas(pitchCanvas);
    const w = pitchCanvas.clientWidth;
    const hh = pitchCanvas.clientHeight;
    ctx.clearRect(0, 0, w, hh);
    const voiced = pitchHistory.filter((p) => p.midi !== null);
    if (!pitchHistory.length) return;
    const now = pitchHistory[pitchHistory.length - 1].t;
    const values = voiced.map((p) => p.midi! + p.cents / 100);
    const center = values.length ? values[values.length - 1] : 60;
    const lo = Math.floor(center) - 6;
    const hi = Math.floor(center) + 6;
    const yOf = (m: number) => hh - ((m - lo) / (hi - lo)) * hh;
    const flats = getSettings().flats;

    ctx.font = '11px system-ui, sans-serif';
    for (let m = lo; m <= hi; m++) {
      const y = yOf(m);
      ctx.fillStyle = cssVar('--good-soft');
      ctx.fillRect(0, yOf(m + tolerance / 100), w, yOf(m - tolerance / 100) - yOf(m + tolerance / 100));
      ctx.strokeStyle = cssVar('--border');
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillStyle = cssVar('--muted');
      ctx.fillText(noteName(m, flats), 4, y - 2);
    }

    ctx.fillStyle = cssVar('--accent');
    for (const p of voiced) {
      const x = w - ((now - p.t) / PITCH_WINDOW) * w;
      const v = p.midi! + p.cents / 100;
      if (v < lo || v > hi) continue;
      ctx.fillRect(x - 1, yOf(v) - 1, 2.5, 2.5);
    }
  }

  root.append(
    h(
      'section',
      { class: 'view analysis' },
      readout,
      h('h3', null, 'Pitch over time'),
      pitchCanvas,
      statsEl,
      h('h3', null, 'Spectrum'),
      specCanvas,
      h('h3', null, 'Harmonics (relative to fundamental)'),
      harmonicsEl,
      h('h3', null, 'Waveform'),
      waveCanvas,
      errorSlot,
      h('div', { class: 'sticky-play' }, pauseBtn, startBtn),
    ),
  );

  return () => {
    off();
    tracker.stop();
  };
}
