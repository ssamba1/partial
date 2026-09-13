import { acquireMic, currentMicTrack, ensureRunning, MicError, releaseMic } from '../../audio/context';
import { estimateTempo, FluxOnsetDetector, KnockDetector, timingStats } from '../../core/onsets';
import { formatBpm } from '../../core/rhythm';
import { getSettings, updateSettings } from '../../store/settings';
import { openSheet } from '../components';
import { h } from '../dom';
import { metronome, outputLatency, tapInput } from '../shared';

/** Frames per second of the onset analysis. */
const RATE = 100;

interface MicListener {
  stop: () => void;
  /** Seconds the input adds, where the browser reports it. */
  inputLatency: number;
}

/**
 * Listen to the microphone and report onsets (AudioContext time and performance.now() time)
 * and the onset strength of every 10 ms frame.
 */
async function listenMic(onOnset: (ctxTime: number, perfMs: number) => void, onFrame?: (strength: number) => void): Promise<MicListener> {
  const ctx = await ensureRunning();
  const stream = await acquireMic({ deviceId: getSettings().micDeviceId });
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0;
  src.connect(analyser);
  const bins = new Float32Array(analyser.frequencyBinCount);
  const mags = new Float32Array(analyser.frequencyBinCount);
  const detector = new FluxOnsetDetector();
  // The analysis window ends now, so its centre is half a window earlier.
  const half = analyser.fftSize / 2 / ctx.sampleRate;
  const timer = window.setInterval(() => {
    analyser.getFloatFrequencyData(bins);
    for (let i = 0; i < bins.length; i++) mags[i] = Number.isFinite(bins[i]) ? 10 ** (bins[i] / 20) : 0;
    const perf = performance.now();
    const f = detector.flux(mags);
    onFrame?.(f);
    if (detector.pushFlux(f, perf)) onOnset(ctx.currentTime - half, perf - half * 1000);
  }, 1000 / RATE);
  const settings = currentMicTrack()?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined;
  return {
    inputLatency: settings?.latency ?? 0,
    stop: () => {
      window.clearInterval(timer);
      src.disconnect();
      releaseMic();
    },
  };
}

/** Knocks on the phone from the motion sensor. iOS asks for permission first. */
async function listenMotion(onKnock: (perfMs: number) => void): Promise<(() => void) | string> {
  if (typeof DeviceMotionEvent === 'undefined') return 'This device has no motion sensor.';
  const withPermission = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
  if (typeof withPermission.requestPermission === 'function') {
    const answer = await withPermission.requestPermission().catch(() => 'denied');
    if (answer !== 'granted') return 'Motion access was not allowed.';
  }
  const knock = new KnockDetector();
  const onMotion = (e: DeviceMotionEvent) => {
    const a = e.acceleration;
    if (a && knock.push(a.x ?? 0, a.y ?? 0, a.z ?? 0, e.timeStamp)) onKnock(e.timeStamp);
  };
  window.addEventListener('devicemotion', onMotion);
  return () => window.removeEventListener('devicemotion', onMotion);
}

const micMessage = (err: unknown) => (err instanceof MicError ? err.message : 'No microphone could be opened.');

/** Listen for 8 seconds and propose a tempo from the playing. */
export function openListenSheet(): void {
  const status = h('p', { role: 'status' }, 'Play or clap steadily for 8 seconds.');
  const result = h('div', { class: 'row tight wrap' });
  let listener: MicListener | null = null;
  let timer = 0;
  const stop = () => {
    window.clearTimeout(timer);
    listener?.stop();
    listener = null;
  };
  const start = async () => {
    stop();
    result.replaceChildren();
    const envelope: number[] = [];
    try {
      listener = await listenMic(() => {}, (f) => envelope.push(f));
    } catch (err) {
      status.textContent = micMessage(err);
      return;
    }
    status.textContent = 'Listening...';
    timer = window.setTimeout(() => {
      stop();
      const bpm = estimateTempo(envelope, RATE);
      if (bpm === null) {
        status.textContent = 'No steady beat heard. Try again, louder or closer.';
        return;
      }
      status.textContent = `About ${formatBpm(bpm)} BPM. Half or double may also fit.`;
      result.replaceChildren(
        ...[bpm / 2, bpm, bpm * 2]
          .filter((b) => b >= 20 && b <= 400)
          .map((b) => h('button', { class: `pill-btn${b === bpm ? ' on' : ''}`, onclick: () => { updateSettings((s) => ({ metronome: { ...s.metronome, bpm: Math.round(b * 10) / 10 } })); close(); } }, `Use ${formatBpm(Math.round(b * 10) / 10)}`)),
      );
    }, 8000);
  };
  const body = h('div', { class: 'stack' }, h('button', { class: 'pill-btn', onclick: () => void start() }, 'Start listening'), status, result);
  const close = openSheet('Listen for tempo', body, { onClose: stop });
}

/** Hands-free tap and a timing check against the click. */
export function openTimingSheet(): void {
  const tapStatus = h('p', { role: 'status', class: 'muted small' });
  const stats = h('div', { class: 'timing-stats', role: 'status' });
  let clap: MicListener | null = null;
  let knockOff: (() => void) | null = null;
  let check: MicListener | null = null;
  let offBeat: (() => void) | null = null;

  const stopAll = () => {
    clap?.stop();
    clap = null;
    knockOff?.();
    knockOff = null;
    check?.stop();
    check = null;
    offBeat?.();
    offBeat = null;
  };

  const clapBox = h('input', {
    type: 'checkbox',
    role: 'switch',
    onchange: async (e: Event) => {
      const on = (e.target as HTMLInputElement).checked;
      clap?.stop();
      clap = null;
      if (!on) return (tapStatus.textContent = '');
      try {
        clap = await listenMic((_t, perf) => tapInput(perf));
        tapStatus.textContent = 'Clap on the beat. The tempo sets from the third clap.';
      } catch (err) {
        (e.target as HTMLInputElement).checked = false;
        tapStatus.textContent = micMessage(err);
      }
    },
  });
  const knockBox = h('input', {
    type: 'checkbox',
    role: 'switch',
    onchange: async (e: Event) => {
      const on = (e.target as HTMLInputElement).checked;
      knockOff?.();
      knockOff = null;
      if (!on) return (tapStatus.textContent = '');
      const res = await listenMotion((perf) => tapInput(perf));
      if (typeof res === 'string') {
        (e.target as HTMLInputElement).checked = false;
        tapStatus.textContent = res;
      } else {
        knockOff = res;
        tapStatus.textContent = 'Knock on the phone or the table it lies on, on the beat.';
      }
    },
  });

  const checkBtn = h('button', {
    class: 'pill-btn',
    onclick: async () => {
      if (check) {
        check.stop();
        check = null;
        offBeat?.();
        offBeat = null;
        checkBtn.textContent = 'Start timing check';
        return;
      }
      const onsets: number[] = [];
      // Scheduled beat times, muted and silent-bar beats included, so silent bars still count.
      const beats: { time: number; beat: number }[] = [];
      try {
        check = await listenMic((t) => onsets.push(t));
      } catch (err) {
        stats.textContent = micMessage(err);
        return;
      }
      checkBtn.textContent = 'Stop timing check';
      const latency = () => outputLatency() + (check?.inputLatency ?? 0);
      offBeat = metronome.onBeat((e) => {
        if (e.layer || e.sub !== 0 || e.countIn) return;
        // e.when is when the click leaves the output; it is heard outputLatency later.
        beats.push({ time: e.when + outputLatency(), beat: e.beat });
        const recent = beats.slice(-64);
        const s = timingStats(onsets.filter((t) => t > recent[0].time - 0.5), recent, getSettings().metronome.beatsPerBar, latency() - outputLatency());
        if (s.count < 2) {
          stats.textContent = 'Play along on the beat...';
          return;
        }
        const side = (ms: number) => (Math.abs(ms) < 1 ? 'on time' : `${Math.round(Math.abs(ms))} ms ${ms > 0 ? 'late' : 'early'}`);
        stats.replaceChildren(
          h('p', null, h('b', null, side(s.meanMs)), ` on average, spread ${Math.round(s.spreadMs)} ms, ${s.count} notes`),
          h('p', { class: 'muted small' }, 'By beat: ', s.perBeatMs.map((ms, i) => `${i + 1}: ${Number.isNaN(ms) ? '-' : side(ms)}`).join(', ')),
          h('p', { class: 'muted small' }, `Drift: ${Math.abs(s.driftMs) < 3 ? 'steady' : `getting ${s.driftMs > 0 ? 'later' : 'earlier'} by ${Math.round(Math.abs(s.driftMs))} ms`}`),
        );
      });
      if (!metronome.playing) void metronome.start();
    },
  }, 'Start timing check');

  const body = h(
    'div',
    { class: 'stack' },
    h('p', { class: 'muted small' }, 'Use headphones, so the microphone hears you and not the click. Timing is approximate: the analysis runs every 10 ms and input delay is only known on some browsers.'),
    h('label', { class: 'switch-row' }, h('span', null, h('strong', null, 'Clap to tap'), h('small', null, 'Claps into the microphone set the tempo.')), clapBox),
    h('label', { class: 'switch-row' }, h('span', null, h('strong', null, 'Knock to tap'), h('small', null, 'Uses the motion sensor on phones.')), knockBox),
    tapStatus,
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Timing check'), h('small', null, 'Compares each note you play with the nearest beat, silent beats included.'), checkBtn, stats),
  );
  openSheet('Listen to me', body, { onClose: stopAll, wide: true });
}
