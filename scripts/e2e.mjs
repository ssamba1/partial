// End-to-end checks in a real headless Chromium-family browser, driven over the
// DevTools protocol with a synthesized microphone. Usage: npm run e2e
// Builds nothing itself: run against `npm run build` output via `vite preview`.
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4180;
const DEBUG_PORT = 9340;
const BASE = `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const candidates = [
    process.env.BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('No Chromium-family browser found. Set BROWSER=/path/to/chrome.');
  return found;
}

const server = spawn(`npx vite preview --port ${PORT} --strictPort`, { stdio: 'ignore', shell: true });
const profile = mkdtempSync(join(tmpdir(), 'partial-e2e-'));
const browser = spawn(findBrowser(), [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
  'about:blank',
]);

function shutdown(code) {
  try {
    browser.kill();
  } catch {}
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' });
    else server.kill();
  } catch {}
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  process.exit(code);
}

let page;
for (let i = 0; i < 100 && !page; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    page = targets.find((t) => t.type === 'page');
  } catch {}
  await sleep(200);
}
if (!page) {
  console.error('Browser did not start');
  shutdown(1);
}
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {}
  await sleep(250);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  }
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function run(expression) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluation failed');
  return r.result?.result?.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

const FAKE_MIC = `
  window.__fake = window.__fake || (() => {
    const c = new AudioContext(); const o = c.createOscillator(); o.type = 'sawtooth';
    const g = c.createGain(); g.gain.value = 0.25; o.connect(g); o.start();
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (cons) => {
      if (cons && cons.video) return real({ video: cons.video });
      const d = c.createMediaStreamDestination(); g.connect(d); return d.stream;
    };
    return { c, o, g };
  })();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
`;

async function open(hash) {
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(100);
  await send('Page.navigate', { url: `${BASE}#/${hash}` });
  await sleep(1200);
  await run(`const k = 'partial.settings.v1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); if (!s.seenIntro) { s.seenIntro = true; localStorage.setItem(k, JSON.stringify(s)); setTimeout(() => location.reload(), 0); }`);
  await sleep(600);
  // Wait until the screen has actually rendered (and any lazy chunk has loaded) instead of guessing a delay.
  for (let i = 0; i < 60; i++) {
    const ready = await run(`const m = document.querySelector('main'); return !!m && m.children.length > 0 && !m.querySelector('.loading') && !document.querySelector('.sheet-layer') && document.readyState === 'complete';`).catch(() => false);
    if (ready) break;
    await sleep(200);
  }
  await sleep(300);
}

const results = [];
async function check(name, fn) {
  const before = errors.length;
  try {
    const detail = await fn();
    const newErrors = errors.slice(before);
    if (newErrors.length) throw new Error(`page errors: ${newErrors.join(' | ')}`);
    results.push({ name, ok: true, detail });
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, detail: String(err.message ?? err) });
    console.log(`FAIL  ${name}  ${err.message ?? err}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

await check('all screens render', async () => {
  await open('tuner');
  const out = await run(`
    const titles = [];
    for (const r of ['tuner','metronome','sound','analysis','record','clicktrack','sheet','practice']) {
      location.hash = '#/' + r; await new Promise((res) => setTimeout(res, 900));
      titles.push(document.querySelector('.page-title').textContent + ':' + document.querySelector('main').children.length);
    }
    return titles;`);
  assert(out.every((t) => !t.endsWith(':0')), `empty screen in ${out}`);
  return out.length + ' screens';
});

await check('tuner reads a 14 cent sharp A', async () => {
  await open('tuner');
  const text = await run(`${FAKE_MIC} window.__fake.o.frequency.value = 440 * Math.pow(2, 14/1200); document.querySelector('.tuner-stage').click(); await wait(2500); return document.querySelector('.note-line').textContent + ' ' + document.querySelector('.big-cents').textContent;`);
  const cents = Number(text.match(/(\d+)\u00a2/)?.[1]);
  assert(text.startsWith('A4'), `note was ${text}`);
  // +-3 cents: the reading is smoothed, and a loaded machine can land a frame or two early.
  assert(text.includes('sharp') && Math.abs(cents - 14) <= 3, `reading was ${text}`);
  return text;
});

// 01-109: step response in the real loop. Records how long a note change takes to settle within 2 cents.
await check('tuner settles within 2 cents after a note change, and lays out two columns when wide', async () => {
  await open('tuner');
  const out = await run(`${FAKE_MIC} window.__fake.o.frequency.value = 440; document.querySelector('.tuner-stage').click(); await wait(2000);
    const t0 = performance.now(); window.__fake.o.frequency.value = 440 * Math.pow(2, 3/12);
    let ms = -1;
    while (performance.now() - t0 < 3000) {
      const note = document.querySelector('.note-line').textContent; const c = Number(document.querySelector('.big-cents').textContent.match(/(\\d+(?:\\.\\d+)?)/)?.[1] ?? 99);
      if (note.startsWith('C5') && c <= 2) { ms = Math.round(performance.now() - t0); break; }
      await new Promise((r) => requestAnimationFrame(r));
    }
    const a = document.querySelector('.tuner-main').getBoundingClientRect(); const b = document.querySelector('.tuner-side').getBoundingClientRect();
    return { ms, twoCols: b.left >= a.right - 1 };`);
  assert(out.ms >= 0 && out.ms < 1500, `settle time ${out.ms} ms`);
  assert(out.twoCols, 'tuner is not in two columns at 1280 px');
  return `settled in ${out.ms} ms`;
});

// The synthesized mic is electrical, so clicks never reach it: this proves the tuner
// runs alongside the metronome, not that click gating works (see the nearClick unit test).
await check('tuner reads correctly with the metronome running', async () => {
  await open('tuner');
  const out = await run(`${FAKE_MIC} window.__fake.o.frequency.value = 330; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' })); document.querySelector('.tuner-stage').click(); await wait(2500); const t = document.querySelector('.note-line').textContent;
    // Four clicks the mic never hears turn gating off, with a notice.
    let notice = false; for (let i = 0; i < 20 && !notice; i++) { notice = [...document.querySelectorAll('.mic-warning')].some((p) => !p.hidden && /not heard/.test(p.textContent)); if (!notice) await wait(200); }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' })); return { t, notice };`);
  assert(out.t.startsWith('E4'), `note was ${out.t}`);
  assert(out.notice, 'no notice that the click is not heard');
  return `${out.t}, gating off`;
});

await check('tuner pauses in the background and shows a threshold on the level meter', async () => {
  await open('tuner');
  const out = await run(`${FAKE_MIC} window.__fake.o.frequency.value = 440; document.querySelector('.tuner-stage').click(); await wait(1500);
    const tuner = () => document.querySelector('.tuner');
    const listening = tuner().classList.contains('listening');
    const tick = !!document.querySelector('.level .level-tick');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange')); await wait(300);
    const hidden = { listening: tuner().classList.contains('listening'), text: document.querySelector('.tuner-meta').textContent };
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange')); await wait(1500);
    const resumed = tuner().classList.contains('listening');
    if (resumed) document.querySelector('.tuner-stage').click();
    return { listening, tick, hidden, resumed };`);
  assert(out.listening, 'tuner did not start');
  assert(out.tick, 'no threshold tick');
  assert(!out.hidden.listening && /background/.test(out.hidden.text), `hidden state ${JSON.stringify(out.hidden)}`);
  return out.resumed ? 'paused, then resumed' : 'paused, waiting for a tap';
});

await check('tuner: fine range shows decimal cents on a ±10 scale and keeps the last note', async () => {
  await open('tuner');
  const setPrefs = (p) => run(`const k = 'partial.settings.v1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); Object.assign(s, ${JSON.stringify(p)}); localStorage.setItem(k, JSON.stringify(s));`);
  await setPrefs({ tolerance: 1, tunerScale: '10', keepLastNote: true, tunerDisplay: 'ring' });
  try {
    await open('tuner');
    const out = await run(`${FAKE_MIC} window.__fake.o.frequency.value = 440 * Math.pow(2, 3/1200); document.querySelector('.tuner-stage').click(); await wait(2500);
      const cents = document.querySelector('.big-cents').textContent;
      const labels = [...document.querySelectorAll('.bar-scale span')].map((s) => s.textContent);
      const ringLabels = [...document.querySelectorAll('.ring-scale text')].map((s) => s.textContent);
      window.__fake.o.disconnect(); await wait(2600);
      const stale = !!document.querySelector('.tuner.stale');
      const ago = document.querySelector('.ago').textContent;
      const kept = document.querySelector('.note-line').textContent;
      document.querySelector('.tuner-toggle').click();
      return { cents, labels, ringLabels, stale, ago, kept };`);
    assert(/^\d+\.\d¢ sharp$/.test(out.cents), `cents readout ${out.cents}`);
    assert(Math.abs(parseFloat(out.cents) - 3) <= 1.5, `cents value ${out.cents}`);
    assert(out.labels.join(' ') === '−10 −5 0 +5 +10', `bar labels ${out.labels}`);
    assert(out.ringLabels.join(' ') === '−10 −5 +5 +10', `ring labels ${out.ringLabels}`);
    assert(out.stale && /^[12] s ago$/.test(out.ago) && out.kept.startsWith('A4'), `kept note: ${JSON.stringify(out)}`);
    return `${out.cents}, kept ${out.kept} ${out.ago}`;
  } finally {
    await setPrefs({ tolerance: 5, tunerScale: '50', keepLastNote: false });
  }
});

await check('tuner partials mode names the partial, and stopping clears the reading', async () => {
  const setPrefs = (p) => run(`const k = 'partial.settings.v1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); Object.assign(s, ${JSON.stringify(p)}); localStorage.setItem(k, JSON.stringify(s));`);
  await open('tuner');
  await setPrefs({ tunerMode: 'partials', partialFundamental: 46, tunerDisplay: 'ring' });
  try {
    await open('tuner');
    const out = await run(`${FAKE_MIC} window.__fake.o.frequency.value = 440 * Math.pow(2, (46 - 69) / 12) * 5; document.querySelector('.tuner-toggle').click(); await wait(2500);
      const vs = document.querySelector('.vs-equal').textContent;
      const note = document.querySelector('.note-line').textContent;
      document.querySelector('.tuner-toggle').click(); await wait(300);
      return { vs, note, cleared: !document.querySelector('.tuner.has-note') && document.querySelector('.big-cents').textContent === '' };`);
    assert(out.vs === 'Partial 5, −13.7¢ vs equal', `partial text ${out.vs}`);
    assert(out.note.startsWith('D5'), `note ${out.note}`);
    assert(out.cleared, 'display not cleared after stop');
    return `${out.note}: ${out.vs}`;
  } finally {
    await setPrefs({ tunerMode: 'chromatic' });
  }
});

await check('tuner: written and concert pitch, quarter tones in 24 equal, and Sa mode', async () => {
  const setPrefs = (p) => run(`const k = 'partial.settings.v1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); Object.assign(s, ${JSON.stringify(p)}); localStorage.setItem(k, JSON.stringify(s));`);
  const read = (hz) => run(`${FAKE_MIC} window.__fake.o.frequency.value = ${hz}; document.querySelector('.tuner-toggle').click(); await wait(2200);
    const out = { note: document.querySelector('.note-line').textContent, concert: document.querySelector('.concert-line').hidden ? '' : document.querySelector('.concert-line').textContent };
    document.querySelector('.tuner-toggle').click(); await wait(200); return out;`);
  await open('tuner');
  try {
    await setPrefs({ tunerMode: 'chromatic', tunerDisplay: 'ring', transposition: 'Bb9', spelling: 'flats' });
    await open('tuner');
    const sax = await read(440 * Math.pow(2, -11 / 12));
    assert(sax.note.startsWith('C5') && sax.concert === 'concert B♭3', `tenor sax ${JSON.stringify(sax)}`);
    await setPrefs({ transposition: 'C', edo: 24 });
    await open('tuner');
    const q = await read(440 * Math.pow(2, 50 / 1200));
    assert(q.note.startsWith('A\u{1D132}4'), `24 equal ${q.note}`);
    await setPrefs({ edo: 12, tunerMode: 'sa', saHz: 146 });
    await open('tuner');
    const pa = await read(219);
    assert(pa.note.startsWith('Pa'), `Sa mode ${pa.note}`);
    return `${sax.note} (${sax.concert}), ${q.note}, ${pa.note}`;
  } finally {
    await setPrefs({ tunerMode: 'chromatic', transposition: 'C', edo: 12, spelling: 'sharps' });
  }
});

await check('tuner tools: measure 3 s, and timpani reads a struck note once', async () => {
  const setPrefs = (p) => run(`const k = 'partial.settings.v1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); Object.assign(s, ${JSON.stringify(p)}); localStorage.setItem(k, JSON.stringify(s));`);
  await open('tuner');
  try {
    const measured = await run(`${FAKE_MIC} window.__fake.o.frequency.value = 440 * Math.pow(2, 6/1200);
      document.querySelector('[aria-label="Tools"]').click(); await wait(300);
      const cards = document.querySelectorAll('.tool-card').length;
      const card = document.querySelector('.tool-card'); card.open = true;
      [...card.querySelectorAll('button')].find((b) => b.textContent === 'Measure 3 s').click();
      for (let i = 0; i < 40 && !/readings/.test(card.querySelector('.tool-result').textContent); i++) await wait(200);
      const text = card.querySelector('.tool-result').textContent;
      document.querySelector('.sheet-layer [aria-label="Close"]')?.click(); await wait(300);
      document.querySelector('.tuner-toggle').click(); await wait(200);
      return { cards, text };`);
    assert(measured.cards === 10, `tool cards ${measured.cards}`);
    assert(/^A4: 441\.\d\d Hz/.test(measured.text) && /\+[5-7]¢|\+[5-7]\.\d¢/.test(measured.text), `measure ${measured.text}`);
    await setPrefs({ tunerMode: 'timpani' });
    await open('tuner');
    const drum = await run(`${FAKE_MIC} const { c, o, g } = window.__fake; o.type = 'sine'; o.frequency.value = 130.81 * Math.pow(2, -8/1200);
      g.gain.setValueAtTime(0.0003, c.currentTime);
      document.querySelector('.tuner-toggle').click(); await wait(1000);
      const before = document.querySelector('.note-line').textContent;
      const t = c.currentTime; g.gain.setValueAtTime(0.3, t); g.gain.setTargetAtTime(0.03, t + 0.02, 1.5);
      await wait(1500);
      const after = document.querySelector('.note-line').textContent + ' ' + document.querySelector('.big-cents').textContent;
      document.querySelector('.tuner-toggle').click(); await wait(200);
      return { before, after };`);
    assert(drum.after.startsWith('C3') && /8¢ flat|[79]¢ flat/.test(drum.after), `timpani ${JSON.stringify(drum)}`);
    const all5 = (list) => list.some((t) => t.startsWith('A3'));
    await setPrefs({ tunerMode: 'bells' });
    await open('tuner');
    const bells = await run(`${FAKE_MIC} const { c, o, g } = window.__fake; g.gain.cancelScheduledValues(0); g.gain.value = 0.25; o.type = 'sawtooth'; o.frequency.value = 220;
      document.querySelector('.tuner-toggle').click(); await wait(2500);
      const all = [...document.querySelectorAll('.bell-peak')].map((x) => x.textContent);
      const idx = all.findIndex((t) => t.startsWith('A4 '));
      if (idx >= 0) document.querySelectorAll('.bell-peak')[idx]?.click();
      await wait(600);
      const out = { count: all.length, all, idx, note: document.querySelector('.note-line').textContent };
      document.querySelector('.tuner-toggle').click(); await wait(200);
      return out;`);
    assert(bells.count === 5 && all5(bells.all) && bells.all[0].startsWith('A3 ') && bells.idx >= 0 && bells.note.startsWith('A4'), `bells ${JSON.stringify(bells)}`);
    return `${measured.text}; timpani ${drum.after}; bells ${bells.count} peaks`;
  } finally {
    await run(`if (window.__fake) { window.__fake.o.type = 'sawtooth'; window.__fake.g.gain.cancelScheduledValues(0); window.__fake.g.gain.value = 0.25; }`);
    await setPrefs({ tunerMode: 'chromatic' });
  }
});

const strobeMotion = async () => {
  await open('tuner');
  const out = await run(`${FAKE_MIC}
    [...document.querySelectorAll('.seg-btn')].find((b) => b.dataset.value === 'strobe').click();
    const canvas = document.querySelector('.strobe-canvas');
    // Left edge of the first band on the top row, in CSS pixels, modulo one band period.
    const edge = () => {
      const ctx = canvas.getContext('2d'); const dpr = canvas.width / canvas.clientWidth;
      const y = Math.round((canvas.clientHeight / 6) * dpr);
      const row = ctx.getImageData(0, y, canvas.width, 1).data;
      for (let x = 1; x < canvas.width; x++) if (row[x * 4 + 3] > 127 && row[(x - 1) * 4 + 3] <= 127) return (x / dpr) % (canvas.clientWidth / 4);
      return null;
    };
    const spread = async () => {
      const xs = []; for (let i = 0; i < 12; i++) { await wait(120); xs.push(edge()); }
      const period = canvas.clientWidth / 4; let moved = 0;
      for (let i = 1; i < xs.length; i++) { let d = Math.abs(xs[i] - xs[i - 1]); d = Math.min(d, period - d); moved += d; }
      return moved;
    };
    window.__fake.o.frequency.value = 440; document.querySelector('.tuner-stage').click(); await wait(2000);
    const still = await spread();
    window.__fake.o.frequency.value = 440 * Math.pow(2, 2/1200); await wait(1500);
    const sharp = await spread();
    document.querySelector('.tuner-toggle').click();
    [...document.querySelectorAll('.seg-btn')].find((b) => b.dataset.value === 'ring').click();
    const note = [...document.querySelectorAll('.strobe-view small')].some((s) => !s.hidden && /Motion reduced/.test(s.textContent));
    return { still, sharp, note };`);
  return out;
};

await check('strobe stands still in tune and turns when sharp', async () => {
  const out = await strobeMotion();
  assert(out.still < 6, `in-tune bands moved ${out.still.toFixed(1)} px`);
  assert(out.sharp > 20, `sharp bands moved only ${out.sharp.toFixed(1)} px`);
  assert(!out.note, 'reduced motion note shown without the preference');
  return `moved ${out.still.toFixed(1)} px in tune, ${out.sharp.toFixed(1)} px at 2 cents sharp`;
});

await check('strobe bands stay still with reduced motion', async () => {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  try {
    const out = await strobeMotion();
    assert(out.sharp < 6 && out.note, `reduced motion: ${JSON.stringify(out)}`);
    return `moved ${out.sharp.toFixed(1)} px at 2 cents sharp, note shown`;
  } finally {
    await send('Emulation.setEmulatedMedia', { features: [] });
  }
});

await check('tuner strings fit one row at 320 px, with labels and a pressed Start button', async () => {
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 700, deviceScaleFactor: 1, mobile: true });
  try {
    await open('tuner');
    const out = await run(`${FAKE_MIC} window.__fake.o.frequency.value = 196;
      [...document.querySelectorAll('.seg-btn')].find((b) => b.dataset.value === 'strings').click(); await wait(300);
      document.querySelector('.tuner-toggle').click(); await wait(2000);
      const btns = [...document.querySelectorAll('.string-btn')];
      const tops = new Set(btns.map((b) => b.offsetTop));
      const right = Math.max(...btns.map((b) => b.getBoundingClientRect().right));
      const pressed = document.querySelector('.tuner-toggle').getAttribute('aria-pressed');
      const labels = btns.map((b) => b.getAttribute('aria-label'));
      document.querySelector('.tuner-toggle').click();
      [...document.querySelectorAll('.seg-btn')].find((b) => b.dataset.value === 'chromatic').click();
      return { count: btns.length, rows: tops.size, right, width: document.documentElement.clientWidth, pressed, labels, stageTag: document.querySelector('.tuner-stage').tagName };`);
    assert(out.count === 6 && out.rows === 1, `strings in ${out.rows} rows`);
    assert(out.right <= out.width, `strings overflow: ${out.right} > ${out.width}`);
    assert(out.pressed === 'true', `Start button pressed state ${out.pressed}`);
    assert(out.stageTag === 'DIV', `stage is ${out.stageTag}`);
    assert(out.labels.some((l) => /^G3 string, (in tune|\d+ cents (sharp|flat)), play reference$/.test(l)), `labels ${out.labels}`);
    return out.labels.find((l) => l.startsWith('G3'));
  } finally {
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  }
});

await check('forced colors: the in-tune zone is dashed in a system colour', async () => {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
  try {
    await open('tuner');
    const out = await run(`const z = getComputedStyle(document.querySelector('.ring-zone')); return { dash: z.strokeDasharray, stroke: z.stroke };`);
    assert(out.dash && out.dash !== 'none', `zone dash ${out.dash}`);
    return `${out.stroke}, dash ${out.dash}`;
  } finally {
    await send('Emulation.setEmulatedMedia', { features: [] });
  }
});

await check('metronome schedules exact 100 BPM triplets', async () => {
  await open('metronome');
  const gaps = await run(`
    const times = []; const orig = AudioBufferSourceNode.prototype.start; const origO = OscillatorNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (w, ...a) { if (this.context instanceof AudioContext) times.push(w); return orig.call(this, w, ...a); };
    [...document.querySelectorAll('.seg-btn')].find((b) => b.textContent === '3').click();
    await new Promise((r) => setTimeout(r, 200));
    document.querySelector('.play-btn').click(); await new Promise((r) => setTimeout(r, 1600)); document.querySelector('.play-btn').click();
    AudioBufferSourceNode.prototype.start = orig;
    [...document.querySelectorAll('.seg-btn')].find((b) => b.getAttribute('data-value') === '1').click();
    const uniq = [...new Set(times.map((t) => t.toFixed(4)))].map(Number).sort((a, b) => a - b);
    return uniq.slice(1).map((t, i) => +(t - uniq[i]).toFixed(4));`);
  assert(gaps.length >= 4 && gaps.every((g) => Math.abs(g - 0.2) < 0.0005), `gaps ${gaps}`);
  return `${gaps.length} gaps of 0.2 s`;
});

await check('metronome: a quick double tap leaves it stopped', async () => {
  await open('metronome');
  const out = await run(`
    const btn = document.querySelector('.play-btn');
    btn.click(); btn.click();
    await new Promise((r) => setTimeout(r, 1000));
    return document.querySelector('.metronome').classList.contains('playing');`);
  assert(out === false, 'metronome still playing after start+stop taps');
  return 'stopped';
});

await check('metronome: 7/8 beat groups, five accent levels and practice tools open', async () => {
  await open('metronome');
  const out = await run(`
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const closeSheet = async () => { document.querySelector('.sheet-layer [aria-label="Close"]').click(); await wait(350); };
    document.querySelector('.meter-btn').click(); await wait(300);
    [...document.querySelectorAll('.meter-tile')].find((b) => b.getAttribute('aria-label') === '7/8').click(); await wait(350);
    document.querySelector('.meter-btn').click(); await wait(300);
    [...document.querySelectorAll('.chips-row .chip')].find((b) => b.textContent === '2+2+3').click(); await wait(200);
    await closeSheet();
    const levels = [...document.querySelectorAll('.beat-block')].map((b) => b.classList[1]).join(',');
    const gaps = document.querySelectorAll('.beat-block.group-start').length;
    document.querySelector('[aria-label="Metronome options"]').click(); await wait(300);
    const grid = [...document.querySelectorAll('.sheet-layer button')].some((b) => b.textContent === 'Edit rhythm grid');
    await closeSheet();
    document.querySelector('.meter-btn').click(); await wait(300);
    [...document.querySelectorAll('.meter-tile')].find((b) => b.getAttribute('aria-label') === '4/4').click(); await wait(350);
    return levels + '|' + gaps + '|' + grid;`);
  assert(out === 'accent,normal,medium,normal,medium,normal,normal|2|true', `got ${out}`);
  return out;
});

await check('speed trainer tempo survives other settings writes', async () => {
  await open('metronome');
  const out = await run(`
    const k = 'partial.settings.v1';
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const s = JSON.parse(localStorage.getItem(k));
    s.metronome = { ...s.metronome, bpm: 240, beatsPerBar: 2, subdivision: 1, accents: ['accent', 'normal'], trainerBars: 1, trainerStep: 5, trainerMax: 300 };
    localStorage.setItem(k, JSON.stringify(s));
    location.reload();`).catch(() => null);
  await sleep(1500);
  const result = await run(`
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('.play-btn').click();
    // Hammer unrelated settings writes while the trainer is stepping.
    for (let i = 0; i < 25; i++) { document.querySelector('[aria-label="Metronome volume"]').dispatchEvent(new Event('input')); await wait(100); }
    document.querySelector('.play-btn').click(); await wait(200);
    const saved = JSON.parse(localStorage.getItem('partial.settings.v1')).metronome;
    const shown = Number(document.querySelector('.bpm-input').value);
    // restore defaults for later checks
    saved.trainerBars = 0; saved.bpm = 100; saved.beatsPerBar = 4; saved.accents = ['accent','normal','normal','normal'];
    const all = JSON.parse(localStorage.getItem('partial.settings.v1')); all.metronome = saved; localStorage.setItem('partial.settings.v1', JSON.stringify(all));
    return { shown };`);
  // 2.5 s at 240+ BPM in 2/4 is about 2.5 bars per second... expect several +5 steps.
  assert(result.shown >= 255, `tempo only reached ${result.shown}`);
  assert((result.shown - 240) % 5 === 0, `unexpected tempo ${result.shown}`);
  return `reached ${result.shown} BPM`;
});

await check('metronome preset saves and restores its drone', async () => {
  await open('sound');
  const out = await run(`
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const svg = document.querySelector('.wheel-svg'); const wedge = document.querySelectorAll('.wedge')[9].getBoundingClientRect();
    const ev = (t) => svg.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: wedge.left + wedge.width / 2, clientY: wedge.top + wedge.height / 2, pointerId: 3 }));
    ev('pointerdown'); ev('pointerup'); await wait(400);
    location.hash = '#/metronome'; await wait(900);
    [...document.querySelectorAll('.chip.add')].find((b) => b.textContent.includes('Save')).click(); await wait(300);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' })); await wait(300);
    const afterStop = document.querySelector('.dock-drone') ? 'still sounding' : 'stopped';
    const chips = [...document.querySelectorAll('.preset-chips .chip:not(.add):not(.ghost)')];
    chips[chips.length - 1].click(); await wait(600);
    location.hash = '#/sound'; await wait(900);
    return { afterStop, restored: document.querySelector('.sounding').innerText };`);
  assert(out.afterStop === 'stopped', `drone not stopped: ${JSON.stringify(out)}`);
  assert(/A3/.test(out.restored), `restored: ${out.restored}`);
  return out.restored.replace(/\n/g, ' ');
});

await check('interval trainer: pure major third reads 0 vs just', async () => {
  await open('analysis');
  const text = await run(`${FAKE_MIC} [...document.querySelectorAll('.seg-btn')].find((b) => b.textContent === 'Intervals').click(); [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Start listening')).click(); const c = 261.6256; for (const f of [c, c * 1.25]) { window.__fake.o.frequency.value = f; await wait(1000); } await wait(500); return document.querySelector('.interval-row').innerText.replace(/\\n/g, ' ');`);
  assert(/Major third/.test(text), text);
  assert(/vs just 5:4 [+\u2212]?[01]\u00a2/.test(text), text);
  return text;
});

await check('recorder saves a take and reports intonation', async () => {
  await open('record');
  const text = await run(`${FAKE_MIC} window.__fake.o.type = 'triangle'; window.__fake.o.frequency.value = 440 * Math.pow(2, 25/1200); document.querySelector('.record-btn').click(); await wait(2000); document.querySelector('.record-btn').click(); await wait(1500); const take = document.querySelector('.take'); [...take.querySelectorAll('button')].find((b) => b.textContent.includes('Check intonation')).click(); for (let i = 0; i < 40 && !take.querySelector('.report, .error-box'); i++) await wait(250); return take.querySelector('.take-analysis').innerText.replace(/\\n/g, ' ');`);
  assert(/A4 \+2[4-6]\u00a2/.test(text), text);
  return text.slice(0, 60);
});

await check('recorder transposes a take up two semitones', async () => {
  await open('record');
  const hz = await run(`${FAKE_MIC}
    window.__fake.o.type = 'sine'; window.__fake.o.frequency.value = 440;
    document.querySelector('.record-btn').click(); await wait(2000); document.querySelector('.record-btn').click(); await wait(1500);
    const take = document.querySelector('.take');
    [...take.querySelectorAll('.seg-btn')].find((b) => b.textContent === '+2').click();
    const audio = take.querySelector('audio');
    const original = audio.src;
    // The transposed copy replaces the source once it has been rendered.
    for (let i = 0; i < 60 && audio.src === original; i++) await wait(250);
    const buf = await new AudioContext().decodeAudioData(await (await fetch(audio.src)).arrayBuffer());
    const d = buf.getChannelData(0);
    // Count rising zero crossings over the middle of the take.
    const start = Math.floor(d.length * 0.3), end = Math.floor(d.length * 0.7);
    let crossings = 0; for (let i = start + 1; i < end; i++) if (d[i - 1] < 0 && d[i] >= 0) crossings++;
    return crossings / ((end - start) / buf.sampleRate);`);
  const expected = 440 * Math.pow(2, 2 / 12);
  const cents = 1200 * Math.log2(hz / expected);
  assert(Math.abs(cents) < 15, `measured ${hz.toFixed(1)} Hz, expected ${expected.toFixed(1)}`);
  return `${hz.toFixed(1)} Hz (expected ${expected.toFixed(1)})`;
});

await check('sheet music: import, annotate, half-page turn', async () => {
  await open('sheet');
  const out = await run(`
    function makePdf(pages) { const objs = ['<< /Type /Catalog /Pages 2 0 R >>']; objs.push('<< /Type /Pages /Kids [' + pages.map((_, i) => (3 + i * 2) + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>'); const fontId = 3 + pages.length * 2; pages.forEach((txt, i) => { const stream = 'BT /F1 28 Tf 100 700 Td (' + txt + ') Tj ET'; objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ' + fontId + ' 0 R >> >> /Contents ' + (4 + i * 2) + ' 0 R >>'); objs.push('<< /Length ' + stream.length + ' >>\\nstream\\n' + stream + '\\nendstream'); }); objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); let out = '%PDF-1.4\\n'; const offs = []; objs.forEach((o, i) => { offs.push(out.length); out += (i + 1) + ' 0 obj\\n' + o + '\\nendobj\\n'; }); const x = out.length; out += 'xref\\n0 ' + (objs.length + 1) + '\\n0000000000 65535 f \\n' + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \\n').join(''); out += 'trailer\\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\\nstartxref\\n' + x + '\\n%%EOF'; return out; }
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const dt = new DataTransfer(); dt.items.add(new File([makePdf(['one', 'two', 'three'])], 'E2E.pdf', { type: 'application/pdf' }));
    const input = document.getElementById('score-file'); input.files = dt.files; input.dispatchEvent(new Event('change'));
    for (let i = 0; i < 40 && !document.querySelector('.score-open'); i++) await wait(250);
    [...document.querySelectorAll('.score-card')].find((c) => c.textContent.includes('E2E')).querySelector('.score-open').click();
    for (let i = 0; i < 40 && !document.querySelector('canvas.page'); i++) await wait(250);
    document.querySelector('[title="Annotate"]').click(); await wait(600);
    const ov = document.querySelector('canvas.ink'); const r = ov.getBoundingClientRect();
    const ev = (t, x, y) => ov.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: r.left + x * r.width, clientY: r.top + y * r.height, pointerId: 9 }));
    ev('pointerdown', 0.2, 0.2); for (let i = 1; i < 10; i++) ev('pointermove', 0.2 + i * 0.03, 0.2); ev('pointerup', 0.5, 0.2);
    await wait(500);
    document.querySelector('[title="Annotate"]').click(); await wait(300);
    [...document.querySelectorAll('.seg-btn')].find((b) => b.textContent.includes('Half')).click(); await wait(300);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); await wait(1200);
    const label = document.querySelector('.page-label').textContent;
    const strokes = await new Promise((res) => { const q = indexedDB.open('partial'); q.onsuccess = () => { const g = q.result.transaction('annotations').objectStore('annotations').getAll(); g.onsuccess = () => res(g.result.reduce((n, a) => n + a.strokes.length, 0)); }; });
    return { label, strokes };`);
  assert(out.strokes >= 1, `strokes ${out.strokes}`);
  assert(out.label.startsWith('1\u00bd'), `label ${out.label}`);
  return `${out.strokes} stroke(s), ${out.label}`;
});

await check('sheet music remembers the tempo used with a piece', async () => {
  await open('sheet');
  const out = await run(`
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const card = () => [...document.querySelectorAll('.score-card')].find((c) => c.textContent.includes('E2E'));
    for (let i = 0; i < 40 && !card(); i++) await wait(250);
    card().querySelector('.score-open').click();
    for (let i = 0; i < 40 && !document.querySelector('canvas.page'); i++) await wait(250);
    const metro = document.querySelector('.viewer-tools .tool-btn');
    metro.click(); await wait(400); metro.click(); await wait(300);
    const saved = document.querySelector('.dock-bpm b')?.textContent;
    return saved;`);
  // Change the tempo, reload, reopen the piece.
  await run(`const k = 'partial.settings.v1'; const s = JSON.parse(localStorage.getItem(k)); s.metronome.bpm = 157; localStorage.setItem(k, JSON.stringify(s));`);
  await open('sheet');
  const restored = await run(`
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const card = () => [...document.querySelectorAll('.score-card')].find((c) => c.textContent.includes('E2E'));
    for (let i = 0; i < 40 && !card(); i++) await wait(250);
    card().querySelector('.score-open').click(); await wait(1500);
    return JSON.parse(localStorage.getItem('partial.settings.v1')).metronome.bpm;`);
  assert(String(restored) === String(out), `saved ${out}, restored ${restored}`);
  assert(restored !== 157, 'tempo was not restored');
  return `restored ${restored} BPM`;
});

await check('offline: app and lazy sheet reader load with the server down', async () => {
  await open('tuner');
  const ready = await run(`const reg = await navigator.serviceWorker.ready; await new Promise((r) => setTimeout(r, 1500)); return !!reg.active;`);
  assert(ready, 'service worker not active');
  if (process.platform === 'win32') execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' });
  else server.kill();
  await sleep(1500);
  await send('Page.navigate', { url: `${BASE}#/sheet` });
  await sleep(2500);
  const state = await run(`return { reader: !!document.querySelector('.drop-zone'), controlled: !!navigator.serviceWorker.controller };`);
  assert(state.controlled && state.reader, JSON.stringify(state));
  return 'served from cache';
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
ws.close();
shutdown(failed.length ? 1 : 0);
