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
const profile = mkdtempSync(join(tmpdir(), 'resonare-e2e-'));
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
    return { c, o };
  })();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
`;

async function open(hash) {
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(100);
  await send('Page.navigate', { url: `${BASE}#/${hash}` });
  await sleep(1200);
  await run(`const k = 'resonare.settings.v1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); if (!s.seenIntro) { s.seenIntro = true; localStorage.setItem(k, JSON.stringify(s)); setTimeout(() => location.reload(), 0); }`);
  await sleep(1300);
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
  assert(text.includes('sharp') && Math.abs(cents - 14) <= 1, `reading was ${text}`);
  return text;
});

// The synthesized mic is electrical, so clicks never reach it: this proves the tuner
// runs alongside the metronome, not that click gating works (see the nearClick unit test).
await check('tuner reads correctly with the metronome running', async () => {
  await open('tuner');
  const text = await run(`${FAKE_MIC} window.__fake.o.frequency.value = 330; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' })); document.querySelector('.tuner-stage').click(); await wait(2500); const t = document.querySelector('.note-line').textContent; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' })); return t;`);
  assert(text.startsWith('E4'), `note was ${text}`);
  return text;
});

await check('metronome schedules exact 100 BPM triplets', async () => {
  await open('metronome');
  const gaps = await run(`
    const times = []; const orig = AudioBufferSourceNode.prototype.start; const origO = OscillatorNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (w, ...a) { times.push(w); return orig.call(this, w, ...a); };
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
    const strokes = await new Promise((res) => { const q = indexedDB.open('resonare'); q.onsuccess = () => { const g = q.result.transaction('annotations').objectStore('annotations').getAll(); g.onsuccess = () => res(g.result.reduce((n, a) => n + a.strokes.length, 0)); }; });
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
  await run(`const k = 'resonare.settings.v1'; const s = JSON.parse(localStorage.getItem(k)); s.metronome.bpm = 157; localStorage.setItem(k, JSON.stringify(s));`);
  await open('sheet');
  const restored = await run(`
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const card = () => [...document.querySelectorAll('.score-card')].find((c) => c.textContent.includes('E2E'));
    for (let i = 0; i < 40 && !card(); i++) await wait(250);
    card().querySelector('.score-open').click(); await wait(1500);
    return JSON.parse(localStorage.getItem('resonare.settings.v1')).metronome.bpm;`);
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
