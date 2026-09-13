import { MicError } from '../../audio/context';
import { NOTE_NAMES_SHARP, noteName, TEMPERAMENTS, TRANSPOSITIONS, transpose } from '../../core/notes';
import { formatCents } from '../../core/format';
import { getSettings, logPractice, subscribeSettings, updateSettings } from '../../store/settings';
import { cssVar, errorBox, field, fitCanvas, h, numberInput, select } from '../dom';
import { createTracker } from '../shared';

const HISTORY_SECONDS = 8;

export function mountTuner(root: HTMLElement) {
  const tracker = createTracker();
  const history: { t: number; cents: number | null }[] = [];
  let startedAt = 0;

  const nameEl = h('span', null, '–');
  const octaveEl = h('span', { class: 'tuner-octave' });
  const noteEl = h('div', { class: 'tuner-note', 'aria-live': 'polite' }, nameEl, octaveEl);
  const centsEl = h('div', { class: 'tuner-cents' }, '');
  const freqEl = h('div', { class: 'tuner-freq muted' }, 'Press start and play a note');
  const needle = h('div', { class: 'needle' });
  const band = h('div', { class: 'in-tune-band' });
  const gauge = h(
    'div',
    { class: 'gauge', role: 'img', 'aria-label': 'Tuning needle' },
    band,
    h('div', { class: 'gauge-ticks' }, ...[-50, -25, 0, 25, 50].map((c) => h('span', { style: `left:${50 + c}%` }, c === 0 ? '0' : String(c)))),
    needle,
  );
  const trace = h('canvas', { class: 'trace', 'aria-hidden': 'true' });
  const levelBar = h('div', { class: 'level-fill' });
  const errorSlot = h('div');

  const startBtn = h('button', { class: 'primary big', onclick: () => toggle() }, 'Start tuner');

  async function toggle() {
    errorSlot.replaceChildren();
    if (tracker.running) {
      tracker.stop();
      logPractice((performance.now() - startedAt) / 1000);
      startBtn.textContent = 'Start tuner';
      freqEl.textContent = 'Stopped';
      return;
    }
    try {
      await tracker.start();
      startedAt = performance.now();
      startBtn.textContent = 'Stop';
      freqEl.textContent = 'Listening…';
    } catch (err) {
      const msg = err instanceof MicError ? err.message : 'Could not start the microphone.';
      errorSlot.replaceChildren(errorBox(msg, () => void toggle()));
    }
  }

  function applyBand() {
    const tol = getSettings().tolerance;
    band.style.left = `${50 - tol}%`;
    band.style.width = `${tol * 2}%`;
  }
  applyBand();

  const offFrame = tracker.onFrame((f) => {
    const s = getSettings();
    levelBar.style.width = `${Math.min(100, Math.sqrt(f.level) * 250)}%`;
    history.push({ t: f.time, cents: f.note ? f.note.cents : null });
    while (history.length && f.time - history[0].t > HISTORY_SECONDS) history.shift();

    if (!f.note) {
      gauge.classList.remove('good');
      needle.classList.add('idle');
      drawTrace();
      return;
    }
    const semis = TRANSPOSITIONS.find((t) => t.id === s.transposition)?.semitones ?? 0;
    const written = transpose(f.note.midi, semis);
    nameEl.textContent = noteName(written, s.flats, false);
    octaveEl.textContent = String(Math.floor(written / 12) - 1);
    const cents = f.note.cents;
    centsEl.textContent = formatCents(cents);
    freqEl.textContent = `${f.frequency!.toFixed(1)} Hz · target ${f.note.target.toFixed(1)} Hz`;
    needle.classList.remove('idle');
    needle.style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
    const good = Math.abs(cents) <= s.tolerance;
    gauge.classList.toggle('good', good);
    centsEl.classList.toggle('good', good);
    centsEl.classList.toggle('sharp', cents > s.tolerance);
    centsEl.classList.toggle('flat', cents < -s.tolerance);
    drawTrace();
  });

  function drawTrace() {
    const ctx = fitCanvas(trace);
    const w = trace.clientWidth;
    const hgt = trace.clientHeight;
    ctx.clearRect(0, 0, w, hgt);
    const tol = getSettings().tolerance;
    const y = (c: number) => hgt / 2 - (c / 50) * (hgt / 2);
    ctx.fillStyle = cssVar('--good-soft');
    ctx.fillRect(0, y(tol), w, y(-tol) - y(tol));
    ctx.strokeStyle = cssVar('--border');
    ctx.beginPath();
    ctx.moveTo(0, hgt / 2);
    ctx.lineTo(w, hgt / 2);
    ctx.stroke();
    if (!history.length) return;
    const now = history[history.length - 1].t;
    ctx.strokeStyle = cssVar('--accent');
    ctx.lineWidth = 2;
    ctx.beginPath();
    let drawing = false;
    for (const p of history) {
      const x = w - ((now - p.t) / HISTORY_SECONDS) * w;
      if (p.cents === null) {
        drawing = false;
        continue;
      }
      const yy = y(Math.max(-50, Math.min(50, p.cents)));
      if (drawing) ctx.lineTo(x, yy);
      else ctx.moveTo(x, yy);
      drawing = true;
    }
    ctx.stroke();
  }

  const s = getSettings();
  const settingsPanel = h(
    'details',
    { class: 'panel' },
    h('summary', null, 'Tuner settings'),
    h(
      'div',
      { class: 'grid' },
      field('A4 reference (Hz)', numberInput(s.a4, (n) => updateSettings({ a4: Math.min(480, Math.max(400, n)) }), { min: 400, max: 480, step: 0.5 })),
      field('Instrument key', select(TRANSPOSITIONS.map((t) => ({ value: t.id, label: t.label })), s.transposition, (v) => updateSettings({ transposition: v }))),
      field('Temperament', select(TEMPERAMENTS.map((t) => ({ value: t.id, label: t.label })), s.temperament, (v) => updateSettings({ temperament: v as typeof s.temperament }))),
      field(
        'Tonic (for temperaments)',
        select(NOTE_NAMES_SHARP.map((n, i) => ({ value: i, label: n })), s.tonic, (v) => updateSettings({ tonic: Number(v) })),
        'Concert pitch key the temperament is built on',
      ),
      field('In-tune range (± cents)', numberInput(s.tolerance, (n) => updateSettings({ tolerance: Math.min(25, Math.max(1, n)) }), { min: 1, max: 25, step: 1 })),
      field(
        'Mic sensitivity',
        select(
          [
            { value: 0.002, label: 'Very high (quiet room)' },
            { value: 0.008, label: 'Normal' },
            { value: 0.02, label: 'Low (noisy room)' },
          ],
          s.sensitivity,
          (v) => updateSettings({ sensitivity: Number(v) }),
        ),
      ),
      field('Note names', select([{ value: 'sharp', label: 'Sharps (C#)' }, { value: 'flat', label: 'Flats (Db)' }], s.flats ? 'flat' : 'sharp', (v) => updateSettings({ flats: v === 'flat' }))),
    ),
  );

  const offSettings = subscribeSettings(applyBand);

  root.append(
    h(
      'section',
      { class: 'view tuner' },
      h('div', { class: 'tuner-display' }, noteEl, centsEl, gauge, freqEl, h('div', { class: 'level', title: 'Input level' }, levelBar)),
      trace,
      errorSlot,
      h('div', { class: 'row center' }, startBtn),
      settingsPanel,
    ),
  );
  drawTrace();

  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) {
      e.preventDefault();
      void toggle();
    }
  };
  window.addEventListener('keydown', onKey);

  return () => {
    window.removeEventListener('keydown', onKey);
    offFrame();
    offSettings();
    if (tracker.running) {
      tracker.stop();
      logPractice((performance.now() - startedAt) / 1000);
    }
  };
}
