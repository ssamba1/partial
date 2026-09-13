import { MicError } from '../../audio/context';
import { formatCents } from '../../core/format';
import { noteName, prettyName } from '../../core/notes';
import { harmonicLevels, magnitudeSpectrum } from '../../core/spectrum';
import { clefFor, staffNote, type Clef } from '../../core/staff';
import { getSettings } from '../../store/settings';
import { segmented } from '../components';
import { cssVar, errorBox, fitCanvas, h } from '../dom';
import { icon } from '../icons';
import { ActivityTimer, createTracker } from '../shared';

const WINDOW = 12;
type Tab = 'pitch' | 'staff' | 'spectrum' | 'harmonics' | 'wave';
const TABS: Tab[] = ['pitch', 'staff', 'spectrum', 'harmonics', 'wave'];

interface Point {
  t: number;
  midi: number | null;
  cents: number;
}

export function mountAnalysis(root: HTMLElement) {
  const tracker = createTracker();
  const timer = new ActivityTimer('analysis');
  const points: Point[] = [];
  let tab: Tab = 'pitch';
  let frozen = false;
  let lastSamples: Float32Array | null = null;
  let lastSampleRate = 48000;
  let lastF0: number | null = null;

  const canvas = h('canvas', { class: 'analysis-canvas', 'aria-label': 'Analysis chart' });
  const noteStat = h('b', null, '·');
  const centsStat = h('b', null, '·');
  const hzStat = h('b', null, '·');
  const tuneStat = h('b', null, '·');
  const stats = h(
    'div',
    { class: 'stat-strip' },
    h('div', null, h('span', null, 'Note'), noteStat),
    h('div', null, h('span', null, 'Cents'), centsStat),
    h('div', null, h('span', null, 'Frequency'), hzStat),
    h('div', null, h('span', null, `In tune (${WINDOW}s)`), tuneStat),
  );
  const errorSlot = h('div');
  const startBtn = h('button', { class: 'primary pill-btn', onclick: () => void toggle() }, icon('mic', 18), 'Start listening');
  const freezeBtn = h('button', { class: 'pill-btn', onclick: () => setFrozen(!frozen) }, 'Freeze');

  const tabSeg = segmented(
    [
      { value: 'pitch', label: 'Pitch' },
      { value: 'staff', label: 'Staff' },
      { value: 'spectrum', label: 'Spectrum' },
      { value: 'harmonics', label: 'Harmonics' },
      { value: 'wave', label: 'Wave' },
    ],
    tab,
    (v) => setTab(v as Tab),
    'Analysis view',
  );
  const caption = h('p', { class: 'chart-caption' });

  const CAPTIONS: Record<Tab, string> = {
    pitch: 'Every note you play over the last 12 seconds. The shaded band is your in-tune range around each note.',
    staff: 'Your playing written on a staff, coloured by intonation. Green is in tune, orange sharp, blue flat.',
    spectrum: 'Energy across frequencies. Dashed lines mark the harmonics of the note you are playing.',
    harmonics: 'Strength of each harmonic relative to the fundamental. This is the colour of your tone.',
    wave: 'The raw waveform, locked to the start of each cycle so a steady tone stands still.',
  };

  function setTab(t: Tab) {
    tab = t;
    tabSeg.set(t);
    caption.textContent = CAPTIONS[t];
    draw();
  }

  function setFrozen(v: boolean) {
    frozen = v;
    freezeBtn.textContent = frozen ? 'Resume' : 'Freeze';
    freezeBtn.classList.toggle('on', frozen);
  }

  async function toggle() {
    errorSlot.replaceChildren();
    if (tracker.running) {
      tracker.stop();
      timer.stop();
      startBtn.replaceChildren(icon('mic', 18), 'Start listening');
      startBtn.classList.add('primary');
      return;
    }
    try {
      await tracker.start();
      timer.start();
      startBtn.replaceChildren(icon('stop', 16), 'Stop');
      startBtn.classList.remove('primary');
    } catch (err) {
      errorSlot.append(errorBox(err instanceof MicError ? err.message : 'Could not start the microphone.', () => void toggle()));
    }
  }

  const off = tracker.onFrame((f) => {
    if (frozen) return;
    if (!f.gated) points.push({ t: f.time, midi: f.note?.midi ?? null, cents: f.note?.cents ?? 0 });
    while (points.length && f.time - points[0].t > WINDOW) points.shift();
    lastSamples = f.samples;
    lastSampleRate = f.sampleRate;
    lastF0 = f.frequency;

    const s = getSettings();
    if (f.note && f.frequency) {
      noteStat.textContent = prettyName(noteName(f.note.midi, s.flats));
      centsStat.textContent = formatCents(f.note.cents);
      hzStat.textContent = f.frequency.toFixed(1);
      centsStat.className = Math.abs(f.note.cents) <= s.tolerance ? 'good' : f.note.cents > 0 ? 'sharp' : 'flat';
    }
    const voiced = points.filter((p) => p.midi !== null);
    if (voiced.length > 10) {
      tuneStat.textContent = `${Math.round((voiced.filter((p) => Math.abs(p.cents) <= s.tolerance).length / voiced.length) * 100)}%`;
    }
    draw();
  });

  function draw() {
    const ctx = fitCanvas(canvas);
    const w = canvas.clientWidth;
    const hh = canvas.clientHeight;
    ctx.clearRect(0, 0, w, hh);
    if (tab === 'pitch') drawPitch(ctx, w, hh);
    else if (tab === 'staff') drawStaff(ctx, w, hh);
    else if (!lastSamples) drawEmpty(ctx, w, hh);
    else if (tab === 'spectrum') drawSpectrum(ctx, w, hh, magnitudeSpectrum(lastSamples));
    else if (tab === 'harmonics') drawHarmonics(ctx, w, hh);
    else drawWave(ctx, w, hh, lastSamples);
  }

  function drawEmpty(ctx: CanvasRenderingContext2D, w: number, hh: number) {
    ctx.fillStyle = cssVar('--muted');
    ctx.font = '500 14px Inter Variable, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Start listening to see your sound', w / 2, hh / 2);
    ctx.textAlign = 'left';
  }

  const colorFor = (cents: number) => {
    const tol = getSettings().tolerance;
    return Math.abs(cents) <= tol ? cssVar('--good') : cents > 0 ? cssVar('--sharp') : cssVar('--flat');
  };

  function drawPitch(ctx: CanvasRenderingContext2D, w: number, hh: number) {
    const voiced = points.filter((p) => p.midi !== null);
    if (!points.length) return drawEmpty(ctx, w, hh);
    const now = points[points.length - 1].t;
    const center = voiced.length ? voiced[voiced.length - 1].midi! : 60;
    const lo = center - 6;
    const hi = center + 6;
    const yOf = (m: number) => hh - 8 - ((m - lo) / (hi - lo)) * (hh - 16);
    const tol = getSettings().tolerance;
    const flats = getSettings().flats;
    const left = 44;
    ctx.font = '600 11px Inter Variable, system-ui, sans-serif';
    for (let m = lo; m <= hi; m++) {
      const isCenter = m === center && voiced.length > 0;
      if (isCenter) {
        // In-tune band only around the note being played, so the grid stays calm.
        ctx.fillStyle = cssVar('--good-soft');
        const top = yOf(m + Math.max(tol, 2) / 100);
        ctx.fillRect(left, top, w - left, yOf(m - Math.max(tol, 2) / 100) - top);
      }
      ctx.strokeStyle = cssVar('--line');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, Math.round(yOf(m)) + 0.5);
      ctx.lineTo(w, Math.round(yOf(m)) + 0.5);
      ctx.stroke();
      ctx.fillStyle = isCenter ? cssVar('--text') : cssVar('--faint');
      ctx.fillText(prettyName(noteName(m, flats)), 6, yOf(m) + 4);
    }
    // One continuous path per run of the same colour; gaps only where the sound actually stopped.
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const xOf = (t: number) => left + (1 - (now - t) / WINDOW) * (w - left);
    let runColor = '';
    let open = false;
    for (let i = 0; i < voiced.length; i++) {
      const p = voiced[i];
      const v = p.midi! + p.cents / 100;
      const color = colorFor(p.cents);
      const gap = i === 0 || p.t - voiced[i - 1].t > 0.25;
      if (gap || color !== runColor) {
        if (open) ctx.stroke();
        ctx.strokeStyle = color;
        ctx.beginPath();
        if (!gap && i > 0) {
          const q = voiced[i - 1];
          ctx.moveTo(xOf(q.t), yOf(q.midi! + q.cents / 100));
          ctx.lineTo(xOf(p.t), yOf(v));
        } else {
          ctx.moveTo(xOf(p.t), yOf(v));
        }
        runColor = color;
        open = true;
      } else {
        ctx.lineTo(xOf(p.t), yOf(v));
      }
    }
    if (open) ctx.stroke();
  }

  function drawStaff(ctx: CanvasRenderingContext2D, w: number, hh: number) {
    const voiced = points.filter((p) => p.midi !== null);
    // Group consecutive frames on the same note into note events.
    const events: { t0: number; t1: number; midi: number; cents: number[] }[] = [];
    for (const p of voiced) {
      const last = events[events.length - 1];
      if (last && last.midi === p.midi && p.t - last.t1 < 0.15) {
        last.t1 = p.t;
        last.cents.push(p.cents);
      } else {
        events.push({ t0: p.t, t1: p.t, midi: p.midi!, cents: [p.cents] });
      }
    }
    const notes = events.filter((e) => e.t1 - e.t0 > 0.08);
    const sortedMidis = notes.map((n) => n.midi).sort((a, b) => a - b);
    const clef: Clef = sortedMidis.length ? clefFor(sortedMidis[Math.floor(sortedMidis.length / 2)]) : 'treble';
    const gap = Math.max(12, Math.min(26, hh / 11));
    const bottom = hh / 2 + gap * 2;
    const yOf = (pos: number) => bottom - (pos * gap) / 2;
    const left = 64;

    ctx.strokeStyle = cssVar('--muted');
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    for (let l = 0; l <= 8; l += 2) {
      ctx.beginPath();
      ctx.moveTo(12, yOf(l));
      ctx.lineTo(w - 12, yOf(l));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = cssVar('--text');
    ctx.font = `${gap * 5.2}px "Noto Music", "Bravura", "Segoe UI Symbol", serif`;
    ctx.textBaseline = 'alphabetic';
    if (clef === 'treble') ctx.fillText('\u{1D11E}', 16, yOf(2) + gap * 1.5);
    else ctx.fillText('\u{1D122}', 18, yOf(6) + gap * 1.1);
    ctx.textBaseline = 'alphabetic';

    if (!points.length) {
      ctx.fillStyle = cssVar('--muted');
      ctx.font = '500 13px Inter Variable, system-ui, sans-serif';
      ctx.fillText('Notes you hold appear here', left + 20, yOf(-4) + 24);
      return;
    }
    const now = points[points.length - 1].t;
    const flats = getSettings().flats;
    for (const n of notes) {
      const x = left + (1 - (now - n.t1) / WINDOW) * (w - left - 20);
      if (x < left) continue;
      const len = Math.max(gap * 1.2, ((n.t1 - n.t0) / WINDOW) * (w - left - 20));
      const sn = staffNote(n.midi, clef, flats);
      const y = yOf(sn.position);
      const mean = n.cents.reduce((a, b) => a + b, 0) / n.cents.length;
      ctx.strokeStyle = cssVar('--muted');
      ctx.lineWidth = 1;
      for (const lp of sn.ledgers) {
        ctx.beginPath();
        ctx.moveTo(x - len - gap * 0.4, yOf(lp));
        ctx.lineTo(x + gap * 0.4, yOf(lp));
        ctx.stroke();
      }
      // Duration bar with the note head at its start.
      ctx.fillStyle = colorFor(mean);
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x - len, y - gap * 0.3, len, gap * 0.6);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.ellipse(x - len + gap * 0.55, y, gap * 0.62, gap * 0.45, -0.35, 0, Math.PI * 2);
      ctx.fill();
      if (sn.accidental) {
        ctx.font = `600 ${gap * 1.3}px Inter Variable, system-ui, sans-serif`;
        ctx.fillText(sn.accidental > 0 ? '♯' : '♭', x - len - gap * 0.9, y + gap * 0.45);
      }
    }
  }

  function drawSpectrum(ctx: CanvasRenderingContext2D, w: number, hh: number, spec: Float32Array) {
    const fMin = 30;
    const fMax = Math.min(10000, lastSampleRate / 2);
    const binHz = lastSampleRate / (spec.length * 2);
    const xOf = (f: number) => (Math.log(f / fMin) / Math.log(fMax / fMin)) * w;
    const yOf = (db: number) => hh - 18 - ((Math.max(-100, Math.min(0, db)) + 100) / 100) * (hh - 28);
    ctx.font = '500 11px Inter Variable, system-ui, sans-serif';
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      if (f > fMax) break;
      const x = xOf(f);
      ctx.strokeStyle = cssVar('--line');
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, hh - 18);
      ctx.stroke();
      ctx.fillStyle = cssVar('--muted');
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 3, hh - 4);
    }
    if (lastF0) {
      ctx.strokeStyle = cssVar('--good');
      ctx.setLineDash([3, 4]);
      for (let k = 1; k <= 16 && lastF0 * k < fMax; k++) {
        ctx.globalAlpha = k === 1 ? 1 : 0.5;
        ctx.beginPath();
        ctx.moveTo(xOf(lastF0 * k), 0);
        ctx.lineTo(xOf(lastF0 * k), hh - 18);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    }
    const grad = ctx.createLinearGradient(0, 0, 0, hh);
    grad.addColorStop(0, cssVar('--brand'));
    grad.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.moveTo(0, hh - 18);
    let lastX = -1;
    let maxDb = -Infinity;
    for (let b = Math.ceil(fMin / binHz); b < spec.length && b * binHz <= fMax; b++) {
      const x = Math.round(xOf(b * binHz));
      maxDb = Math.max(maxDb, spec[b]);
      if (x === lastX) continue;
      ctx.lineTo(x, yOf(maxDb));
      lastX = x;
      maxDb = -Infinity;
    }
    ctx.lineTo(w, hh - 18);
    ctx.closePath();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cssVar('--brand');
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawHarmonics(ctx: CanvasRenderingContext2D, w: number, hh: number) {
    if (!lastF0 || !lastSamples) return drawEmpty(ctx, w, hh);
    const harmonics = harmonicLevels(magnitudeSpectrum(lastSamples), lastSampleRate, lastF0, 12);
    const ref = harmonics[0]?.db ?? 0;
    const n = harmonics.length;
    const barW = (w - 24) / n;
    ctx.font = '600 12px Inter Variable, system-ui, sans-serif';
    ctx.textAlign = 'center';
    harmonics.forEach((hm, i) => {
      const rel = Math.max(-60, Math.min(12, hm.db - ref));
      const frac = (rel + 60) / 72;
      const bh = frac * (hh - 48);
      const x = 12 + i * barW;
      const grad = ctx.createLinearGradient(0, hh - 28 - bh, 0, hh - 28);
      grad.addColorStop(0, cssVar('--brand'));
      grad.addColorStop(1, cssVar('--brand-2'));
      ctx.fillStyle = grad;
      const bw = barW * 0.62;
      ctx.beginPath();
      ctx.roundRect(x + (barW - bw) / 2, hh - 28 - bh, bw, bh, [6, 6, 2, 2]);
      ctx.fill();
      ctx.fillStyle = cssVar('--muted');
      ctx.fillText(String(hm.number), x + barW / 2, hh - 10);
      if (i > 0) ctx.fillText(`${rel.toFixed(0)}`, x + barW / 2, hh - 34 - bh);
    });
    ctx.textAlign = 'left';
  }

  function drawWave(ctx: CanvasRenderingContext2D, w: number, hh: number, samples: Float32Array) {
    ctx.strokeStyle = cssVar('--line');
    ctx.beginPath();
    ctx.moveTo(0, hh / 2);
    ctx.lineTo(w, hh / 2);
    ctx.stroke();
    let start = 0;
    for (let i = 1; i < samples.length / 2; i++) {
      if (samples[i - 1] < 0 && samples[i] >= 0) {
        start = i;
        break;
      }
    }
    const span = Math.min(samples.length - start, 1600);
    let peak = 0.05;
    for (let i = start; i < start + span; i++) peak = Math.max(peak, Math.abs(samples[i]));
    ctx.strokeStyle = cssVar('--brand');
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const v = samples[start + Math.floor((x / w) * span)] / peak;
      const y = hh / 2 - v * (hh / 2) * 0.85;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Swipe between views on touch screens.
  let swipeX: number | null = null;
  canvas.addEventListener('pointerdown', (e) => (swipeX = e.clientX));
  canvas.addEventListener('pointerup', (e) => {
    if (swipeX === null) return;
    const dx = e.clientX - swipeX;
    swipeX = null;
    if (Math.abs(dx) < 50) {
      setFrozen(!frozen);
      return;
    }
    const i = TABS.indexOf(tab) + (dx < 0 ? 1 : -1);
    if (i >= 0 && i < TABS.length) setTab(TABS[i]);
  });

  root.append(
    h(
      'section',
      { class: 'view analysis' },
      h('div', { class: 'toolbar scroll-x' }, tabSeg),
      stats,
      h('div', { class: 'chart-card' }, canvas),
      caption,
      errorSlot,
      h('div', { class: 'action-row' }, freezeBtn, startBtn),
    ),
  );
  setTab('pitch');
  const onResize = () => draw();
  window.addEventListener('resize', onResize);

  return () => {
    off();
    tracker.stop();
    timer.stop();
    window.removeEventListener('resize', onResize);
  };
}
