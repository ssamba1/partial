import { acquireMic, ensureRunning, getContext, MicError, releaseMic } from '../../audio/context';
import { formatCents, formatDuration, uid } from '../../core/format';
import { analyzeTake, type TakeReport } from '../../core/intonation';
import { encodeWav, pitchShift } from '../../core/pitchshift';
import { noteName, prettyName } from '../../core/notes';
import { frameSizeFor, rms } from '../../core/pitch';
import { recordingReader, SMOOTHING } from '../../core/tracking';
import { MIN_FREQUENCY } from '../../audio/pitchTracker';
import { db, type RecordingEntry } from '../../store/db';
import { getSettings, logPractice, tuningOf } from '../../store/settings';
import { iconButton, segmented, toast } from '../components';
import { cssVar, errorBox, fitCanvas, h } from '../dom';
import { icon } from '../icons';
import { metronome } from '../shared';

function pickMime(video: boolean): string {
  const candidates = video
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    : ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
  return candidates.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? '';
}

function extensionFor(mime: string): string {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.startsWith('video/mp4')) return 'mp4';
  if (mime.includes('mp4')) return 'm4a';
  return 'webm';
}

async function decode(blob: Blob): Promise<AudioBuffer> {
  const ctx = getContext();
  return ctx.decodeAudioData(await blob.arrayBuffer());
}

function mono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / buffer.numberOfChannels;
  }
  return out;
}

export function mountRecorder(root: HTMLElement) {
  let recorder: MediaRecorder | null = null;
  let starting = false;
  let disposed = false;
  /** Only stop the metronome at the end of a take if this take started it. */
  let startedMetronome = false;
  let startedAt = 0;
  let timer = 0;
  let meterRaf = 0;
  let analyser: AnalyserNode | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  const urls = new Set<string>();
  const levels: number[] = [];

  const recBtn = h('button', { class: 'record-btn', 'aria-label': 'Start recording', onclick: () => void toggle() });
  const time = h('div', { class: 'rec-time' }, '0:00');
  const liveWave = h('canvas', { class: 'live-wave', 'aria-hidden': 'true' });
  const withClick = h('input', { type: 'checkbox', role: 'switch', id: 'rec-click' });
  const withVideo = h('input', { type: 'checkbox', role: 'switch', id: 'rec-video' });
  const preview = h('video', { class: 'rec-preview', muted: true, playsInline: true, autoplay: true, hidden: true }) as HTMLVideoElement;
  let camStream: MediaStream | null = null;
  const errorSlot = h('div');
  const list = h('div', { class: 'take-list' });
  const recState = h('div', { class: 'rec-state' }, 'Ready');

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
      if (disposed) {
        // Left the screen while the permission prompt was up.
        releaseMic();
        starting = false;
        return;
      }
      sourceNode = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      sourceNode.connect(analyser);
    } catch (err) {
      starting = false;
      errorSlot.append(errorBox(err instanceof MicError ? err.message : 'Could not open the microphone.', () => void toggle()));
      return;
    }
    let recordStream = stream;
    if (withVideo.checked) {
      try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } });
        recordStream = new MediaStream([...camStream.getVideoTracks(), ...stream.getAudioTracks()]);
        preview.srcObject = camStream;
        preview.hidden = false;
      } catch {
        toast('Camera unavailable, recording audio only');
        camStream = null;
      }
      if (disposed) {
        starting = false;
        teardown();
        return;
      }
    }
    starting = false;
    const mime = pickMime(!!camStream);
    const rec = new MediaRecorder(recordStream, mime ? { mimeType: mime } : undefined);
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
    levels.length = 0;
    startedMetronome = withClick.checked && !metronome.playing;
    if (startedMetronome) void metronome.start();
    view.classList.add('recording');
    recState.textContent = 'Recording';
    recBtn.setAttribute('aria-label', 'Stop recording');
    timer = window.setInterval(() => (time.textContent = formatDuration((performance.now() - startedAt) / 1000)), 250);
    const buf = new Float32Array(1024);
    const loop = () => {
      if (!analyser) return;
      analyser.getFloatTimeDomainData(buf);
      levels.push(rms(buf));
      if (levels.length > 240) levels.shift();
      drawLive();
      meterRaf = requestAnimationFrame(loop);
    };
    loop();
  }

  function drawLive() {
    const ctx = fitCanvas(liveWave);
    const w = liveWave.clientWidth;
    const hh = liveWave.clientHeight;
    ctx.clearRect(0, 0, w, hh);
    if (!levels.length) {
      // Idle: a quiet centre line instead of a stale waveform.
      ctx.fillStyle = cssVar('--line-2');
      ctx.fillRect(0, hh / 2 - 1, w, 2);
      return;
    }
    const barW = w / 240;
    ctx.fillStyle = cssVar('--danger');
    levels.forEach((l, i) => {
      const v = Math.min(1, Math.sqrt(l) * 2.4);
      const bh = Math.max(2, v * hh);
      ctx.fillRect(w - (levels.length - i) * barW, (hh - bh) / 2, Math.max(1, barW - 1), bh);
    });
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
    camStream?.getTracks().forEach((t) => t.stop());
    camStream = null;
    preview.srcObject = null;
    preview.hidden = true;
    levels.length = 0;
    drawLive();
    view.classList.remove('recording');
    recState.textContent = 'Ready';
    recBtn.setAttribute('aria-label', 'Start recording');
  }

  async function finish(rec: MediaRecorder, recChunks: Blob[], recStartedAt: number) {
    const duration = (performance.now() - recStartedAt) / 1000;
    const mime = rec.mimeType || 'audio/webm';
    if (recorder === rec) {
      recorder = null;
      teardown();
      if (startedMetronome) metronome.stop();
      startedMetronome = false;
      time.textContent = '0:00';
    }
    logPractice(duration, 'record');
    const blob = new Blob(recChunks, { type: mime });
    if (blob.size === 0) {
      errorSlot.replaceChildren(errorBox('Nothing was recorded. The microphone may have been disconnected.', () => void toggle()));
      return;
    }
    const entry: RecordingEntry = {
      id: uid(),
      name: `Take ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
      created: Date.now(),
      duration,
      mime,
      blob,
    };
    try {
      await db.put('recordings', entry);
      toast('Take saved');
    } catch (err) {
      errorSlot.replaceChildren(errorBox(`Could not save the recording: ${(err as Error).message}`));
    }
    await renderList();
  }

  function takeCard(item: RecordingEntry): HTMLElement {
    const url = URL.createObjectURL(item.blob);
    urls.add(url);
    const isVideo = item.mime.startsWith('video/');
    const audio = (isVideo
      ? h('video', { src: url, preload: 'metadata', playsInline: true, class: 'take-video' })
      : h('audio', { src: url, preload: 'metadata' })) as HTMLMediaElement;
    audio.preservesPitch = true;
    // Safari before 17.2 only knows the prefixed name; without it slower playback also drops in pitch.
    (audio as HTMLMediaElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
    const playBtn = h('button', { class: 'take-play', 'aria-label': `Play ${item.name}` }, icon('play', 18));
    const progress = h('input', { type: 'range', min: 0, max: 1000, value: '0', class: 'take-progress', 'aria-label': 'Playback position' }) as HTMLInputElement;
    const clock = h('span', { class: 'take-clock' }, `0:00 / ${formatDuration(item.duration)}`);
    const analysisSlot = h('div', { class: 'take-analysis' });

    playBtn.addEventListener('click', () => {
      if (audio.paused) {
        document.querySelectorAll<HTMLMediaElement>('.take audio, .take video').forEach((a) => a !== audio && a.pause());
        void audio.play();
      } else audio.pause();
    });
    audio.addEventListener('play', () => playBtn.replaceChildren(icon('stop', 16)));
    audio.addEventListener('pause', () => playBtn.replaceChildren(icon('play', 18)));
    audio.addEventListener('ended', () => playBtn.replaceChildren(icon('play', 18)));
    audio.addEventListener('timeupdate', () => {
      const dur = Number.isFinite(audio.duration) ? audio.duration : item.duration;
      progress.value = String(Math.round((audio.currentTime / dur) * 1000));
      clock.textContent = `${formatDuration(audio.currentTime)} / ${formatDuration(dur)}`;
    });
    progress.addEventListener('input', () => {
      const dur = Number.isFinite(audio.duration) ? audio.duration : item.duration;
      audio.currentTime = (Number(progress.value) / 1000) * dur;
    });

    const speed = segmented(
      ['0.5', '0.75', '1', '1.25'].map((v) => ({ value: v, label: `${v}×` })),
      '1',
      (v) => (audio.playbackRate = Number(v)),
      'Playback speed',
    );

    // Transpose playback without changing speed: render a shifted copy once per setting.
    const shifted = new Map<number, string>();
    let shiftToken = 0;
    const transpose = segmented(
      ['-2', '-1', '0', '1', '2'].map((v) => ({ value: v, label: v === '0' ? '0 st' : `${Number(v) > 0 ? '+' : '−'}${Math.abs(Number(v))}` })),
      '0',
      async (v) => {
        const semis = Number(v);
        const token = ++shiftToken;
        const wasPlaying = !audio.paused;
        const at = audio.currentTime;
        const rate = audio.playbackRate;
        let src = url;
        if (semis !== 0) {
          src = shifted.get(semis) ?? '';
          if (!src) {
            toast('Transposing this take…');
            try {
              const buffer = await decode(item.blob);
              await new Promise((r) => setTimeout(r, 20));
              const wav = encodeWav(pitchShift(mono(buffer), semis, buffer.sampleRate), buffer.sampleRate);
              src = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
              urls.add(src);
              shifted.set(semis, src);
            } catch (err) {
              toast(`Could not transpose: ${(err as Error).message}`);
              return;
            }
          }
        }
        if (token !== shiftToken) return;
        audio.src = src;
        audio.playbackRate = rate;
        audio.currentTime = at;
        if (wasPlaying) void audio.play();
      },
      'Transpose playback',
    );

    const name = h('input', {
      type: 'text',
      class: 'take-name',
      value: item.name,
      'aria-label': 'Take name',
      onchange: async (e: Event) => {
        item.name = (e.target as HTMLInputElement).value;
        await db.put('recordings', item);
      },
    });

    const analyzeBtn = h('button', { class: 'pill-btn', onclick: () => void analyze() }, icon('analysis', 16), 'Check intonation');

    async function analyze() {
      analyzeBtn.disabled = true;
      analysisSlot.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'Listening back…'));
      try {
        const buffer = await decode(item.blob);
        const samples = mono(buffer);
        const tuning = tuningOf(getSettings());
        const tol = getSettings().tolerance;
        // Yield to the browser before the heavy loop so the spinner paints.
        await new Promise((r) => setTimeout(r, 30));
        // The same per-frame processor and settings as the live tuner, so both give the same in-tune share.
        const s = getSettings();
        const frameSize = frameSizeFor(buffer.sampleRate, MIN_FREQUENCY);
        const hop = Math.round(frameSize / 4);
        const reader = recordingReader(buffer.sampleRate, hop, { tuning, profile: SMOOTHING[s.damping], minRms: s.sensitivity, minFrequency: MIN_FREQUENCY });
        const report = analyzeTake(samples, buffer.sampleRate, reader, tol, frameSize, hop);
        analysisSlot.replaceChildren(reportView(report, buffer.duration, tol));
      } catch (err) {
        analysisSlot.replaceChildren(errorBox(`Could not analyse this take: ${(err as Error).message}`));
      } finally {
        analyzeBtn.disabled = false;
      }
    }

    return h(
      'article',
      { class: 'take' },
      h('div', { class: 'take-head' }, name, h('span', { class: 'muted small' }, `${formatDuration(item.duration)} · ${new Date(item.created).toLocaleDateString()}`)),
      isVideo ? audio : null,
      h('div', { class: 'take-player' }, playBtn, progress, clock),
      h(
        'div',
        { class: 'take-actions' },
        h('div', { class: 'row tight wrap' }, speed, isVideo ? null : transpose),
        h(
          'div',
          { class: 'row tight' },
          analyzeBtn,
          h('a', { class: 'icon-btn', href: url, download: `${item.name.replace(/[^\w\- ]+/g, '_')}.${extensionFor(item.mime)}`, 'aria-label': 'Download', title: 'Download' }, icon('download', 18)),
          iconButton('trash', `Delete ${item.name}`, async () => {
            if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
            audio.pause();
            await db.delete('recordings', item.id);
            await renderList();
          }, 'danger'),
        ),
      ),
      analysisSlot,
      isVideo ? null : audio,
    );
  }

  function reportView(report: TakeReport, duration: number, tol: number): HTMLElement {
    const canvas = h('canvas', { class: 'take-chart', 'aria-label': 'Intonation over the take' });
    const flats = getSettings().flats;
    const worst = [...report.notes].sort((a, b) => Math.abs(b.meanCents) - Math.abs(a.meanCents)).slice(0, 5);
    const el = h(
      'div',
      { class: 'report' },
      h(
        'div',
        { class: 'stat-strip' },
        h('div', null, h('span', null, 'In tune'), h('b', { class: report.inTune >= 0.7 ? 'good' : 'sharp' }, `${Math.round(report.inTune * 100)}%`)),
        h('div', null, h('span', null, 'Average'), h('b', null, formatCents(report.meanCents))),
        h('div', null, h('span', null, 'Held notes'), h('b', null, String(report.notes.length))),
        h('div', null, h('span', null, 'Sounding'), h('b', null, formatDuration(report.voicedSeconds))),
      ),
      canvas,
      report.notes.length
        ? h(
            'div',
            { class: 'worst' },
            h('span', { class: 'field-label' }, 'Furthest from centre'),
            h(
              'div',
              { class: 'chips' },
              worst.map((n) =>
                h(
                  'span',
                  { class: `note-chip ${Math.abs(n.meanCents) <= tol ? 'good' : n.meanCents > 0 ? 'sharp' : 'flat'}`, title: `at ${formatDuration(n.start)}, drift ${formatCents(n.drift)}` },
                  h('b', null, prettyName(noteName(n.midi, flats))),
                  ` ${formatCents(n.meanCents)} at ${formatDuration(n.start)}`,
                ),
              ),
            ),
          )
        : h('p', { class: 'muted small' }, 'No sustained notes were found in this take.'),
    );
    requestAnimationFrame(() => {
      const ctx = fitCanvas(canvas);
      const w = canvas.clientWidth;
      const hh = canvas.clientHeight;
      const y = (c: number) => hh / 2 - (Math.max(-50, Math.min(50, c)) / 50) * (hh / 2 - 6);
      ctx.fillStyle = cssVar('--good-soft');
      ctx.fillRect(0, y(tol), w, y(-tol) - y(tol));
      ctx.strokeStyle = cssVar('--line');
      ctx.beginPath();
      ctx.moveTo(0, hh / 2);
      ctx.lineTo(w, hh / 2);
      ctx.stroke();
      for (const r of report.readings) {
        if (r.midi === null) continue;
        ctx.fillStyle = Math.abs(r.cents) <= tol ? cssVar('--good') : r.cents > 0 ? cssVar('--sharp') : cssVar('--flat');
        ctx.fillRect((r.t / duration) * w - 1, y(r.cents) - 1.5, 2.5, 3);
      }
    });
    return el;
  }

  async function renderList() {
    let items: RecordingEntry[];
    try {
      items = await db.list('recordings');
    } catch (err) {
      list.replaceChildren(errorBox((err as Error).message));
      return;
    }
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls.clear();
    items.sort((a, b) => b.created - a.created);
    list.replaceChildren(
      ...(items.length
        ? items.map(takeCard)
        : [h('div', { class: 'empty' }, icon('mic', 28), h('b', null, 'No takes yet'), h('span', null, 'Record a passage, then check its intonation or slow it down to listen closely.'))]),
    );
  }

  const view = h(
    'section',
    { class: 'view recorder' },
    h(
      'div',
      { class: 'rec-panel' },
      recState,
      recBtn,
      time,
      liveWave,
      preview,
      h('label', { class: 'switch-row compact', for: 'rec-video' }, h('span', null, h('strong', null, 'Record video'), h('small', null, 'Film your posture and bowing along with the sound.')), withVideo),
      h('label', { class: 'switch-row compact', for: 'rec-click' }, h('span', null, h('strong', null, 'Metronome while recording'), h('small', null, 'Use headphones so the click stays out of the take.')), withClick),
    ),
    errorSlot,
    h('div', { class: 'card-head section-head' }, h('h2', null, 'Takes'), h('span', { class: 'muted small' }, 'Stored only on this device')),
    list,
  );
  root.append(view);
  requestAnimationFrame(drawLive);
  void renderList();

  return () => {
    disposed = true;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    else if (!starting) teardown();
    document.querySelectorAll<HTMLMediaElement>('.take audio, .take video').forEach((a) => a.pause());
    urls.forEach((u) => URL.revokeObjectURL(u));
  };
}
