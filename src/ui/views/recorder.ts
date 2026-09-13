import { acquireMic, ensureRunning, MicError, releaseMic } from '../../audio/context';
import { formatDuration, uid } from '../../core/format';
import { rms } from '../../core/pitch';
import { db, type RecordingEntry } from '../../store/db';
import { logPractice } from '../../store/settings';
import { errorBox, h } from '../dom';
import { metronome } from '../shared';

function pickMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
  return candidates.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? '';
}

function extensionFor(mime: string): string {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'm4a';
  return 'webm';
}

export function mountRecorder(root: HTMLElement) {
  let recorder: MediaRecorder | null = null;
  let starting = false;
  let startedAt = 0;
  let timer = 0;
  let meterRaf = 0;
  let analyser: AnalyserNode | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  const urls = new Set<string>();

  const recBtn = h('button', { class: 'record-btn', 'aria-label': 'Start recording', onclick: () => void toggle() });
  const time = h('div', { class: 'rec-time' }, '0:00');
  const meter = h('div', { class: 'level' }, h('div', { class: 'level-fill' }));
  const withClick = h('input', { type: 'checkbox', id: 'rec-click' });
  const errorSlot = h('div');
  const list = h('ul', { class: 'rec-list' });

  async function toggle() {
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      return;
    }
    if (starting) return;
    errorSlot.replaceChildren();
    if (typeof MediaRecorder === 'undefined') {
      errorSlot.append(errorBox('Recording is not supported in this browser.'));
      return;
    }
    let stream: MediaStream;
    starting = true;
    try {
      const ctx = await ensureRunning();
      stream = await acquireMic();
      sourceNode = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      sourceNode.connect(analyser);
    } catch (err) {
      errorSlot.append(errorBox(err instanceof MicError ? err.message : 'Could not open the microphone.', () => void toggle()));
      return;
    } finally {
      starting = false;
    }
    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const recChunks: Blob[] = [];
    const recStartedAt = performance.now();
    rec.ondataavailable = (e) => {
      if (e.data.size) recChunks.push(e.data);
    };
    // Each recording keeps its own chunks and start time, so a late stop event can never mix two takes.
    rec.onstop = () => void finish(rec, recChunks, recStartedAt);
    recorder = rec;
    rec.start(1000);
    startedAt = recStartedAt;
    if (withClick.checked && !metronome.playing) void metronome.start();
    recBtn.classList.add('on');
    recBtn.setAttribute('aria-label', 'Stop recording');
    timer = window.setInterval(() => (time.textContent = formatDuration((performance.now() - startedAt) / 1000)), 250);
    const buf = new Float32Array(1024);
    const fill = meter.firstElementChild as HTMLElement;
    const loop = () => {
      if (!analyser) return;
      analyser.getFloatTimeDomainData(buf);
      fill.style.width = `${Math.min(100, Math.sqrt(rms(buf)) * 250)}%`;
      meterRaf = requestAnimationFrame(loop);
    };
    loop();
  }

  function teardown() {
    window.clearInterval(timer);
    cancelAnimationFrame(meterRaf);
    if (sourceNode) {
      sourceNode.disconnect();
      releaseMic();
    }
    analyser = null;
    sourceNode = null;
    recBtn.classList.remove('on');
    recBtn.setAttribute('aria-label', 'Start recording');
  }

  async function finish(rec: MediaRecorder, recChunks: Blob[], recStartedAt: number) {
    const duration = (performance.now() - recStartedAt) / 1000;
    const mime = rec.mimeType || 'audio/webm';
    if (recorder === rec) {
      recorder = null;
      teardown();
      if (withClick.checked) metronome.stop();
      time.textContent = '0:00';
    }
    logPractice(duration);
    const blob = new Blob(recChunks, { type: mime });
    if (blob.size === 0) {
      errorSlot.replaceChildren(errorBox('Nothing was recorded. The microphone may have been disconnected.', () => void toggle()));
      return;
    }
    const entry: RecordingEntry = {
      id: uid(),
      name: `Recording ${new Date().toLocaleString()}`,
      created: Date.now(),
      duration,
      mime,
      blob,
    };
    try {
      await db.put('recordings', entry);
    } catch (err) {
      errorSlot.replaceChildren(errorBox(`Could not save the recording: ${(err as Error).message}`));
    }
    await renderList();
  }

  async function renderList() {
    let items: RecordingEntry[];
    try {
      items = await db.list<RecordingEntry>('recordings');
    } catch (err) {
      list.replaceChildren(h('li', null, errorBox((err as Error).message)));
      return;
    }
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls.clear();
    items.sort((a, b) => b.created - a.created);
    if (!items.length) {
      list.replaceChildren(h('li', { class: 'muted' }, 'No recordings yet.'));
      return;
    }
    list.replaceChildren(
      ...items.map((item) => {
        const url = URL.createObjectURL(item.blob);
        urls.add(url);
        const name = h('input', {
          type: 'text',
          value: item.name,
          'aria-label': 'Recording name',
          onchange: async (e: Event) => {
            item.name = (e.target as HTMLInputElement).value;
            await db.put('recordings', item);
          },
        });
        return h(
          'li',
          { class: 'rec-item' },
          h('div', { class: 'row between wrap' }, name, h('span', { class: 'muted small' }, `${formatDuration(item.duration)} · ${new Date(item.created).toLocaleDateString()}`)),
          h('audio', { controls: true, src: url, preload: 'metadata' }),
          h(
            'div',
            { class: 'row tight' },
            h('a', { class: 'button', href: url, download: `${item.name.replace(/[^\w\- ]+/g, '_')}.${extensionFor(item.mime)}` }, 'Download'),
            h(
              'button',
              {
                class: 'danger',
                onclick: async () => {
                  if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
                  await db.delete('recordings', item.id);
                  await renderList();
                },
              },
              'Delete',
            ),
          ),
        );
      }),
    );
  }

  root.append(
    h(
      'section',
      { class: 'view recorder' },
      h('div', { class: 'rec-panel' }, recBtn, time, meter, h('label', { class: 'row tight', for: 'rec-click' }, withClick, 'Play metronome while recording')),
      h('p', { class: 'muted small center' }, 'Recordings are stored only on this device. Use headphones if you record with the metronome.'),
      errorSlot,
      h('h2', null, 'Recordings'),
      list,
    ),
  );
  void renderList();

  return () => {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    else teardown();
    urls.forEach((u) => URL.revokeObjectURL(u));
  };
}
