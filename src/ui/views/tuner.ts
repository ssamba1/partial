import { currentMicTrack, ensureRunning, getMaster, MicError } from '../../audio/context';
import { MIN_FREQUENCY } from '../../audio/pitchTracker';
import { Drone, playTone } from '../../audio/voices';
import { icon } from '../icons';
import { formatCents } from '../../core/format';
import { STRING_INSTRUMENTS, StringFollower, stringFrequency, suggestString, tuneHint } from '../../core/instruments';
import { activeFrequencies, noteOff, noteOn } from '../../audio/droneBank';
import { FollowState, matchesReference, referenceOctaves, type ReferenceOctave } from '../../core/selfsound';
import { OnsetGate } from '../../core/tracking';
import { addReading, advanceStrobe, InTuneLatch, summarize, type Tendencies } from '../../core/intonation';
import { calibratedThreshold, meterPosition, micWarnings, SignalStatus, zeroCrossingRate } from '../../core/mic';
import { midiToFrequency, noteName, prettyName, TRANSPOSITIONS, transpose } from '../../core/notes';
import { getSettings, subscribeSettings, tuningOf, updateSettings, type Settings } from '../../store/settings';
import { haptic, iconButton, openSheet, segmented } from '../components';
import { cssVar, errorBox, fitCanvas, h, select } from '../dom';
import { announce } from '../controls';
import { createPitchRing } from '../pitchRing';
import { ActivityTimer, createTracker, recordTuningFrame } from '../shared';

const HISTORY_SECONDS = 10;
const HOLD_SECONDS = 1.2;

const RANGES: { value: string; label: string; cents: number }[] = [
  { value: '10', label: 'Wide ±10', cents: 10 },
  { value: '5', label: 'Normal ±5', cents: 5 },
  { value: '2', label: 'Fine ±2', cents: 2 },
  { value: '1', label: 'Ultra ±1', cents: 1 },
];

interface OptionsTools {
  /** Measures room noise for two seconds and returns the new threshold, or null if the mic could not start. */
  calibrate: () => Promise<number | null>;
}

const SENSITIVITY_PRESETS = ['0.002', '0.008', '0.02'];

function micWarningList(): string[] {
  const track = currentMicTrack();
  return track ? micWarnings({ label: track.label, settings: track.getSettings() }) : [];
}

function openTunerOptions(tools: OptionsTools) {
  const s = getSettings();
  const deviceSelect = select([{ value: '', label: 'Default' }], s.micDeviceId, (v) => updateSettings({ micDeviceId: v }), { 'aria-label': 'Input' });
  // Device names are only available after mic permission; before that the list may be blank.
  void navigator.mediaDevices?.enumerateDevices?.().then((devices) => {
    const inputs = devices.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default');
    deviceSelect.replaceChildren(
      h('option', { value: '' }, 'Default'),
      ...inputs.map((d, i) => h('option', { value: d.deviceId, selected: d.deviceId === getSettings().micDeviceId }, d.label || `Microphone ${i + 1}`)),
    );
    if (!inputs.some((d) => d.deviceId === getSettings().micDeviceId)) deviceSelect.value = '';
  }).catch(() => {});
  const customNote = h('small', null);
  const showCustom = () => {
    const v = getSettings().sensitivity;
    customNote.textContent = SENSITIVITY_PRESETS.includes(String(v)) ? 'Calibrating measures 2 seconds of room noise. Stay quiet.' : `Calibrated: ${v}`;
  };
  showCustom();
  const sensitivitySeg = segmented(
    [
      { value: '0.002', label: 'Quiet room' },
      { value: '0.008', label: 'Normal' },
      { value: '0.02', label: 'Noisy room' },
    ],
    String(s.sensitivity),
    (v) => {
      updateSettings({ sensitivity: Number(v) });
      showCustom();
    },
    'Microphone sensitivity',
  );
  const calibrateBtn = h(
    'button',
    {
      class: 'pill-btn',
      onclick: async () => {
        calibrateBtn.disabled = true;
        calibrateBtn.textContent = 'Measuring, stay quiet';
        const value = await tools.calibrate();
        calibrateBtn.disabled = false;
        calibrateBtn.textContent = 'Calibrate to this room';
        if (value === null) {
          customNote.textContent = 'Could not open the microphone.';
          return;
        }
        sensitivitySeg.set(String(value));
        showCustom();
      },
    },
    'Calibrate to this room',
  );
  const warnings = micWarningList();
  const body = h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'In-tune range'),
      segmented(RANGES.map((r) => ({ value: r.value, label: r.label })), String(s.tolerance), (v) => updateSettings({ tolerance: Number(v) }), 'In-tune range'),
    ),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Steadiness'),
      segmented(
        [
          { value: 'fast', label: 'Responsive' },
          { value: 'normal', label: 'Balanced' },
          { value: 'slow', label: 'Steady' },
        ],
        s.damping,
        (v) => updateSettings({ damping: v as Settings['damping'] }),
        'Steadiness',
      ),
      h('small', null, 'Steady smooths the reading for sustained notes (winds, voice). Responsive follows fast passages and plucked strings.'),
    ),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Microphone'),
      sensitivitySeg,
      h('div', { class: 'row wrap tight' }, calibrateBtn),
      customNote,
    ),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Input'), deviceSelect),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Input channel'),
      segmented(
        [
          { value: 'mix', label: 'Mix' },
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
        ],
        s.micChannel,
        (v) => updateSettings({ micChannel: v as Settings['micChannel'] }),
        'Input channel',
      ),
      h('small', null, 'For a two-input interface, pick the input your instrument is plugged into.'),
    ),
    ...warnings.map((w) => h('p', { class: 'mic-warning', role: 'note' }, w)),
    h(
      'label',
      { class: 'switch-row' },
      h('span', null, h('strong', null, 'Drone follows you'), h('small', null, 'Plays the in-tune reference for the note you are holding, so you can hear the beats against it. Use headphones.')),
      h('input', { type: 'checkbox', role: 'switch', checked: s.followDrone, onchange: (e: Event) => updateSettings({ followDrone: (e.target as HTMLInputElement).checked }) }),
    ),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Reference octave'),
      segmented(
        [
          { value: 'same', label: 'Same' },
          { value: 'up1', label: 'Up 1' },
          { value: 'up2', label: 'Up 2' },
          { value: 'auto', label: 'Auto' },
        ],
        s.reference.octave,
        (v) => updateSettings((cur) => ({ reference: { ...cur.reference, octave: v as ReferenceOctave } })),
        'Reference octave',
      ),
      h('small', null, 'Phone speakers barely play low notes. Auto raises references below 110 Hz by octaves.'),
    ),
    h(
      'button',
      {
        class: 'pill-btn',
        onclick: () => {
          if (confirm('Clear your saved intonation tendencies?')) updateSettings({ tendencies: {} });
        },
      },
      'Reset tendencies',
    ),
    h(
      'label',
      { class: 'switch-row' },
      h('span', null, h('strong', null, 'Ignore the metronome'), h('small', null, 'Skips the instant each click sounds, so the tuner keeps reading your note while the metronome plays.')),
      h('input', { type: 'checkbox', role: 'switch', checked: s.ignoreClick, onchange: (e: Event) => updateSettings({ ignoreClick: (e.target as HTMLInputElement).checked }) }),
    ),
  );
  openSheet('Tuner options', body);
}

export function mountTuner(root: HTMLElement) {
  const tracker = createTracker({
    lowestFrequency: () => {
      const s = getSettings();
      if (s.tunerMode !== 'strings') return MIN_FREQUENCY;
      const inst = instrument();
      let lowest = Infinity;
      for (let i = 0; i < inst.strings.length; i++) lowest = Math.min(lowest, stringFrequency(inst, i, tuningOf(s), s.pureFifths));
      return lowest;
    },
  });
  const timer = new ActivityTimer('tuner');
  const history: { t: number; cents: number | null }[] = [];
  const inTuneLatch = new InTuneLatch(HOLD_SECONDS);
  const signal = new SignalStatus();
  let lastTendencyAt = 0;
  let refDrone: { drone: Drone; index: number; frequency: number; timeout: number } | null = null;
  /** The "Hear target" tone while it sounds. */
  let targetTone: { frequency: number; until: number } | null = null;
  let manualString: number | null = null;
  const stringFollower = new StringFollower();
  const onsets = new OnsetGate();
  let disposed = false;

  /* ----- Display elements ----- */
  const ring = createPitchRing();
  const noteEl = h('span', { class: 'big-note' });
  const accidentalEl = h('span', { class: 'big-acc' });
  const octaveEl = h('span', { class: 'big-oct' });
  const centsEl = h('div', { class: 'big-cents' }, '');
  const hint = h('div', { class: 'ring-hint' }, 'Tap to start');
  ring.center.append(h('div', { class: 'note-line' }, noteEl, h('span', { class: 'note-sup' }, accidentalEl, octaveEl)), centsEl, hint);

  const barNeedle = h('div', { class: 'bar-needle' });
  const barZone = h('div', { class: 'bar-zone' });
  const barNote = h('div', { class: 'bar-note' }, 'Play a note');
  const barCents = h('div', { class: 'bar-cents' });
  const barMeter = h(
    'div',
    { class: 'bar-meter' },
    barZone,
    h('div', { class: 'bar-scale' }, ...[-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50].map((c) => h('span', { style: `left:${50 + c}%`, class: c % 50 === 0 || c === 0 ? 'major' : '' }, c % 25 === 0 ? String(Math.abs(c)) : ''))),
    barNeedle,
  );
  const barView = h('div', { class: 'bar-view' }, h('div', { class: 'bar-head' }, barNote, barCents), barMeter, h('div', { class: 'bar-legend' }, h('span', null, '♭ flat'), h('span', null, 'sharp ♯')));

  /* ----- Strobe display ----- */
  const strobeCanvas = h('canvas', { class: 'strobe-canvas', 'aria-hidden': 'true' });
  const strobeNote = h('div', { class: 'bar-note' }, 'Play a note');
  const strobeCents = h('div', { class: 'bar-cents' });
  const strobeView = h(
    'div',
    { class: 'strobe-view' },
    h('div', { class: 'bar-head' }, strobeNote, strobeCents),
    h('div', { class: 'strobe-frame' }, strobeCanvas),
    h('div', { class: 'bar-legend' }, h('span', null, '← flat drifts left'), h('span', null, 'still = in tune'), h('span', null, 'sharp drifts right →')),
  );
  const strobePhases = [0, 0, 0];
  let strobeLast = 0;
  function drawStrobe(cents: number | null, now: number) {
    const dt = strobeLast ? Math.min(0.1, (now - strobeLast) / 1000) : 0;
    strobeLast = now;
    const ctx = fitCanvas(strobeCanvas);
    const w = strobeCanvas.clientWidth;
    const hh = strobeCanvas.clientHeight;
    ctx.clearRect(0, 0, w, hh);
    const rows = 3;
    const rowH = hh / rows;
    const tol = getSettings().tolerance;
    const color = cents === null ? cssVar('--surface-3') : Math.abs(cents) <= tol ? cssVar('--good') : cents > 0 ? cssVar('--sharp') : cssVar('--flat');
    for (let r = 0; r < rows; r++) {
      // Each row shows a higher partial: it moves 2x and 4x faster, like a multi-band strobe.
      if (cents !== null) strobePhases[r] = advanceStrobe(strobePhases[r], cents * Math.pow(2, r), dt, 0.12);
      const bandW = w / (8 * Math.pow(2, r));
      const offset = strobePhases[r] * bandW * 2;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85 - r * 0.2;
      for (let x = -bandW * 2 + offset; x < w + bandW; x += bandW * 2) {
        ctx.fillRect(x, r * rowH + 3, bandW, rowH - 6);
      }
    }
    ctx.globalAlpha = 1;
  }

  const freqEl = h('div', { class: 'tuner-meta' }, h('span', null, 'Play a note to begin'));
  let lastTarget: number | null = null;
  const refBtn = h(
    'button',
    {
      class: 'chip ref-btn',
      disabled: true,
      title: 'Play the in-tune pitch of the last note',
      onclick: async () => {
        if (!lastTarget) return;
        const ctx = await ensureRunning();
        const s = getSettings();
        const frequency = lastTarget * Math.pow(2, referenceOctaves(lastTarget, s.reference.octave));
        playTone(ctx, getMaster(), ctx.currentTime + 0.02, frequency, 1.6, s.drone.timbre, Math.max(0.5, s.drone.volume));
        targetTone = { frequency, until: performance.now() + 1700 };
      },
    },
    icon('sound', 14),
    'Hear target',
  );
  const levelFill = h('div', { class: 'level-fill' });
  const levelTick = h('div', { class: 'level-tick', title: 'Sensitivity threshold' });
  const clipLight = h('span', { class: 'clip-light', title: 'Input clipping' });
  const levelStatus = h('span', { class: 'level-status', 'aria-live': 'polite' });
  const noticeSlot = h('div');
  const clickNotice = h('p', { class: 'mic-warning', role: 'note', hidden: true }, 'Metronome not heard by mic, reading continuously.');
  const refBadge = h('span', { class: 'ref-badge', hidden: true }, 'Reference playing');
  let suggested: number | null = null;
  const suggestChip = h('button', {
    class: 'chip',
    hidden: true,
    onclick: () => {
      if (suggested === null) return;
      manualString = suggested;
      suggested = null;
      suggestChip.hidden = true;
      renderStrings(manualString, null);
    },
  });
  const trace = h('canvas', { class: 'trace', 'aria-hidden': 'true' });
  const errorSlot = h('div');

  const display = h('button', { class: 'tuner-stage', 'aria-label': 'Start or stop the tuner', onclick: () => void toggle() }, ring.el, barView, strobeView);

  /* ----- Intonation tendencies ----- */
  let pendingTend: Tendencies = {};
  let pendingCount = 0;
  const tendBars = h('div', { class: 'tend-bars' });
  const tendCaption = h('span', { class: 'muted small' });
  const tendPanel = h(
    'div',
    { class: 'trace-wrap tendencies' },
    h('div', { class: 'trace-label' }, h('span', null, 'Your tendencies'), tendCaption),
    tendBars,
  );
  function flushTendencies() {
    if (!pendingCount) return;
    const add = pendingTend;
    pendingTend = {};
    pendingCount = 0;
    updateSettings((s) => {
      const merged: Tendencies = { ...s.tendencies };
      for (const [pc, st] of Object.entries(add)) {
        const cur = merged[Number(pc)] ?? { count: 0, sum: 0, sumSq: 0 };
        merged[Number(pc)] = { count: cur.count + st.count, sum: cur.sum + st.sum, sumSq: cur.sumSq + st.sumSq };
      }
      return { tendencies: merged };
    });
  }
  const flushTimer = window.setInterval(flushTendencies, 5000);
  function renderTendencies() {
    const s = getSettings();
    const combined: Tendencies = { ...s.tendencies };
    for (const [pc, st] of Object.entries(pendingTend)) {
      const cur = combined[Number(pc)] ?? { count: 0, sum: 0, sumSq: 0 };
      combined[Number(pc)] = { count: cur.count + st.count, sum: cur.sum + st.sum, sumSq: cur.sumSq + st.sumSq };
    }
    const stats = summarize(combined, 20);
    const byPc = new Map(stats.map((x) => [x.pitchClass, x]));
    tendCaption.textContent = stats.length ? 'average cents per note, all sessions' : 'Play for a while to see which notes you tend to play sharp or flat';
    tendBars.replaceChildren(
      ...Array.from({ length: 12 }, (_, pc) => {
        const st = byPc.get(pc);
        const mean = st ? Math.max(-25, Math.min(25, st.mean)) : 0;
        const cls = !st ? 'none' : Math.abs(st.mean) <= s.tolerance ? 'good' : st.mean > 0 ? 'sharp' : 'flat';
        return h(
          'div',
          { class: `tend ${cls}`, title: st ? `${noteName(pc, s.flats, false)}: ${formatCents(st.mean)} average, ±${st.spread.toFixed(1)}¢ spread, ${st.count} readings` : `${noteName(pc, s.flats, false)}: not enough readings yet` },
          h('div', { class: 'tend-track' }, h('i', { style: `height:${(Math.abs(mean) / 25) * 50}%;${mean >= 0 ? 'bottom:50%' : 'top:50%'}` })),
          h('span', null, prettyName(noteName(pc, s.flats, false))),
          h('b', null, st ? formatCents(st.mean) : ''),
        );
      }),
    );
  }

  /* ----- Drone that follows you ----- */
  const follow = new FollowState();
  /** The drone note actually sounding (after any octave shift), and whether the follow drone created it. */
  let followSounding: number | null = null;
  let followOwned = false;
  function release(midi: number | undefined) {
    if (midi === undefined || followSounding === null) return;
    if (followOwned) noteOff(followSounding);
    followSounding = null;
    followOwned = false;
  }
  function stopFollow() {
    release(follow.reset().stop);
  }
  function followNote(concertMidi: number | null, time: number) {
    if (!getSettings().followDrone) {
      stopFollow();
      return;
    }
    const step = follow.update(concertMidi, time);
    release(step.stop);
    if (step.start === undefined) return;
    const s = getSettings();
    const midi = step.start + 12 * referenceOctaves(midiToFrequency(step.start, tuningOf(s)), s.reference.octave);
    followSounding = midi;
    followOwned = false;
    void noteOn(midi).then((created) => {
      if (followSounding === midi) followOwned = created;
      else if (created) noteOff(midi); // moved on to another note while this one was starting
    });
  }

  /* ----- Strings mode ----- */
  const stringsRow = h('div', { class: 'strings-row', role: 'group', 'aria-label': 'Strings' });
  const instrumentSelect = select(
    STRING_INSTRUMENTS.map((i) => ({ value: i.id, label: i.label })),
    getSettings().stringInstrument,
    (v) => {
      manualString = null;
      stringFollower.reset();
      updateSettings({ stringInstrument: v });
    },
    { 'aria-label': 'Instrument', class: 'compact' },
  );
  const autoChip = h('button', { class: 'chip', onclick: () => { manualString = null; stringFollower.reset(); renderStrings(null, null); } }, 'Auto');
  const pureChip = h('label', { class: 'chip toggle' }, h('input', { type: 'checkbox', checked: getSettings().pureFifths, onchange: (e: Event) => updateSettings({ pureFifths: (e.target as HTMLInputElement).checked }) }), 'Pure fifths');
  const stringsPanel = h('div', { class: 'strings-panel' }, h('div', { class: 'row wrap tight' }, instrumentSelect, autoChip, pureChip, suggestChip), stringsRow);

  function instrument() {
    return STRING_INSTRUMENTS.find((i) => i.id === getSettings().stringInstrument) ?? STRING_INSTRUMENTS[0];
  }

  function renderStrings(activeIndex: number | null, cents: number | null) {
    const inst = instrument();
    const s = getSettings();
    pureChip.hidden = inst.pureFifthsFrom === undefined;
    autoChip.classList.toggle('on', manualString === null);
    const rowKey = `${inst.id}|${noteName(1, s.flats, false)}`;
    if (stringsRow.children.length !== inst.strings.length || stringsRow.dataset.inst !== rowKey) {
      stringsRow.dataset.inst = rowKey;
      stringsRow.replaceChildren(
        ...inst.strings.map((midi, i) =>
          h(
            'button',
            { class: 'string-btn', 'data-i': i, onclick: (e: Event) => { e.stopPropagation(); void pressString(i); } },
            h('span', { class: 'string-name' }, prettyName(noteName(midi, s.flats, false))),
            h('span', { class: 'string-oct' }, String(Math.floor(midi / 12) - 1)),
            h('span', { class: 'string-dot' }),
          ),
        ),
      );
    }
    [...stringsRow.children].forEach((b, i) => {
      const el = b as HTMLElement;
      const on = i === activeIndex;
      el.classList.toggle('active', on);
      el.classList.toggle('good', on && cents !== null && Math.abs(cents) <= s.tolerance);
      el.classList.toggle('close', on && cents !== null && Math.abs(cents) > s.tolerance && Math.abs(cents) <= 20);
      el.classList.toggle('is-sharp', on && cents !== null && cents > s.tolerance);
      el.classList.toggle('is-flat', on && cents !== null && cents < -s.tolerance);
      el.classList.toggle('manual', i === manualString);
      el.classList.toggle('sounding', refDrone?.index === i);
    });
  }

  async function pressString(i: number) {
    manualString = i;
    const inst = instrument();
    const s = getSettings();
    if (refDrone) {
      const wasSame = refDrone.index === i;
      stopRef();
      if (wasSame) {
        renderStrings(i, null);
        return;
      }
    }
    const ctx = await ensureRunning();
    if (disposed) return;
    // A second tap may have started a reference while this one was waiting; replace it rather than leak it.
    if (refDrone) stopRef();
    const base = stringFrequency(inst, i, tuningOf(s), s.pureFifths);
    const frequency = base * Math.pow(2, referenceOctaves(base, s.reference.octave));
    const drone = new Drone(ctx, getMaster(), frequency, 'strings', 0.7);
    refDrone = { drone, index: i, frequency, timeout: window.setTimeout(stopRef, 4000) };
    renderStrings(i, null);
  }

  function stopRef() {
    if (!refDrone) return;
    window.clearTimeout(refDrone.timeout);
    refDrone.drone.stop();
    refDrone = null;
    renderStrings(manualString, null);
  }

  /* ----- Start / stop ----- */
  async function toggle() {
    errorSlot.replaceChildren();
    if (tracker.running) {
      tracker.stop();
      timer.stop();
      stopFollow();
      signal.reset();
      onsets.reset();
      noticeSlot.replaceChildren();
      root.querySelector('.tuner')?.classList.remove('listening');
      hint.textContent = 'Tap to start';
      freqEl.replaceChildren(h('span', null, 'Paused'));
      return;
    }
    try {
      await tracker.start();
      if (!tracker.running) return;
      timer.start();
      root.querySelector('.tuner')?.classList.add('listening');
      hint.textContent = 'Listening';
      noticeSlot.replaceChildren(...micWarningList().map((w) => h('p', { class: 'mic-warning', role: 'note' }, w)));
    } catch (err) {
      const msg = err instanceof MicError ? err.message : 'Could not start the microphone.';
      errorSlot.replaceChildren(errorBox(msg, () => void toggle()));
    }
  }

  /** Two seconds of room noise while the player stays quiet, turned into a mic threshold. */
  async function calibrate(): Promise<number | null> {
    const wasRunning = tracker.running;
    if (!wasRunning) {
      await toggle();
      if (!tracker.running) return null;
    }
    const levels: number[] = [];
    const off = tracker.onFrame((f) => levels.push(f.level));
    await new Promise((r) => window.setTimeout(r, 2000));
    off();
    if (!wasRunning && tracker.running) await toggle();
    const value = calibratedThreshold(levels);
    updateSettings({ sensitivity: value });
    return value;
  }

  /* ----- Pause in the background ----- */
  // requestAnimationFrame stops in hidden tabs, so release the mic rather than keep it open unanalysed.
  let pausedHidden = false;
  async function micGranted(): Promise<boolean> {
    try {
      const p = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
      return p?.state === 'granted';
    } catch {
      return false;
    }
  }
  const onVisibility = async () => {
    if (document.visibilityState === 'hidden') {
      if (!tracker.running) return;
      pausedHidden = true;
      await toggle();
      freqEl.replaceChildren(h('span', null, 'Paused while in background. Tap to resume.'));
      return;
    }
    if (!pausedHidden || disposed) return;
    pausedHidden = false;
    if (!tracker.running && (await micGranted()) && !disposed && document.visibilityState === 'visible') await toggle();
  };
  document.addEventListener('visibilitychange', onVisibility);

  /* ----- Frame handling ----- */
  const offFrame = tracker.onFrame((f) => {
    const s = getSettings();
    levelFill.style.transform = `scaleX(${meterPosition(f.level)})`;
    const threshold = s.sensitivity;
    const noPitch = !f.note && !f.gated;
    const status = signal.update({
      time: performance.now() / 1000,
      level: f.level,
      peak: f.peak,
      threshold,
      hasPitch: !noPitch,
      roughHz: noPitch && f.level >= threshold ? zeroCrossingRate(f.samples, f.sampleRate) : undefined,
      lowestHz: MIN_FREQUENCY,
    });
    if (levelStatus.textContent !== status.message) levelStatus.textContent = status.message;
    clipLight.classList.toggle('on', status.clip);
    const semis = TRANSPOSITIONS.find((t) => t.id === s.transposition)?.semitones ?? 0;
    const nowMs = performance.now();

    // The tuner's own reference tones reach the mic too: say so, and drop readings that are clearly the reference.
    if (targetTone && nowMs > targetTone.until) targetTone = null;
    const oneShotRefs = [refDrone?.frequency ?? 0, targetTone?.frequency ?? 0];
    refBadge.hidden = !oneShotRefs.some((x) => x > 0) && !activeFrequencies().length;
    const hearingSelf = !!f.frequency && !f.held && matchesReference(f.frequency, f.clarity, oneShotRefs);
    const note = hearingSelf ? null : f.note;
    const held = !hearingSelf && f.held;
    clickNotice.hidden = tracker.clickHearing.state !== 'inaudible';
    // A pluck starts sharp: skip its first moments for the in-tune hold and the session score.
    const transient = onsets.update(f.level, nowMs) && s.tunerMode === 'strings';

    let cents: number | null = null;
    let displayMidi: number | null = null;
    let target = 0;
    let hint: string | null = null;

    if (note && f.frequency) {
      if (s.tunerMode === 'strings') {
        const inst = instrument();
        const tuning = tuningOf(s);
        // The smoothed frequency, so the needle is as steady here as in chromatic mode.
        const freq = f.displayFrequency ?? f.frequency;
        let index: number;
        if (manualString !== null) {
          index = manualString;
          target = stringFrequency(inst, index, tuning, s.pureFifths);
          if (!held) suggested = suggestString(freq, inst, index, tuning, s.pureFifths);
        } else {
          const reading = stringFollower.update(freq, nowMs, inst, tuning, s.pureFifths);
          index = reading.index;
          target = reading.target;
        }
        cents = 1200 * Math.log2(freq / target);
        displayMidi = inst.strings[index];
        renderStrings(index, cents);
        hint = tuneHint(cents);
        if (Math.abs(cents) > 50) cents = Math.sign(cents) * 50;
      } else {
        cents = f.displayCents;
        target = note.target;
        displayMidi = transpose(note.midi, semis);
      }
    } else if (s.tunerMode === 'strings') {
      renderStrings(manualString, null);
    }
    if (s.tunerMode !== 'strings' || manualString === null) suggested = null;
    suggestChip.hidden = suggested === null;
    if (suggested !== null) {
      const text = `Sounds like the ${prettyName(noteName(instrument().strings[suggested], s.flats, false))} string`;
      if (suggestChip.textContent !== text) suggestChip.textContent = text;
    }

    if (!held && !f.gated && !hearingSelf && !transient) {
      recordTuningFrame(cents);
      // At most 30 readings a second, so a 120 Hz screen does not count double.
      const nowSec = nowMs / 1000;
      if (s.tunerMode === 'chromatic' && note && displayMidi !== null && nowSec - lastTendencyAt >= 1 / 30) {
        lastTendencyAt = nowSec;
        pendingTend = addReading(pendingTend, ((displayMidi % 12) + 12) % 12, note.cents);
        pendingCount++;
        if (pendingCount % 30 === 0) renderTendencies();
      }
    }
    followNote(note && !held ? note.midi : null, f.time);
    if (s.tunerDisplay === 'strobe') drawStrobe(cents, nowMs);
    history.push({ t: f.time, cents });
    while (history.length && f.time - history[0].t > HISTORY_SECONDS) history.shift();

    // Hysteresis keeps the in-tune state from flickering at the edge of the range.
    const { inTune, hold, fire } = transient ? { inTune: false, hold: 0, fire: false } : inTuneLatch.update(cents, displayMidi, nowMs / 1000, s.tolerance);
    if (fire) haptic(12);

    if (displayMidi === null || cents === null) {
      ring.update({ pitchClass: null, cents: 0, inTune: false, hold: 0 }, s.tolerance, s.flats);
      root.querySelector('.tuner')?.classList.remove('has-note');
      barNeedle.style.left = '50%';
      drawTrace();
      return;
    }

    root.querySelector('.tuner')?.classList.add('has-note');
    const pretty = prettyName(noteName(displayMidi, s.flats, false));
    const accidental = pretty.match(/[♯♭]/)?.[0] ?? '';
    noteEl.textContent = pretty.replace(accidental, '');
    noteEl.classList.toggle('long', noteEl.textContent.length > 1);
    accidentalEl.textContent = accidental;
    octaveEl.textContent = String(Math.floor(displayMidi / 12) - 1);
    // Words as well as colour, so the state reads without relying on colour vision.
    const direction = `${Math.abs(Math.round(cents))}¢ ${cents > 0 ? 'sharp' : 'flat'}`;
    centsEl.textContent = hint ?? (inTune ? 'in tune' : direction);
    barNote.textContent = `${pretty}${Math.floor(displayMidi / 12) - 1}`;
    barCents.textContent = hint ?? (inTune ? `${formatCents(cents)} in tune` : direction);
    if (!held) announce(`${pretty.replace('♯', ' sharp').replace('♭', ' flat')}, ${hint ?? (inTune ? 'in tune' : direction.replace('¢', ' cents'))}`);
    strobeNote.textContent = barNote.textContent;
    strobeCents.textContent = barCents.textContent;
    barNeedle.style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
    barMeter.classList.toggle('good', inTune);

    ring.update({ pitchClass: ((displayMidi % 12) + 12) % 12, cents, inTune, hold }, s.tolerance, s.flats);
    const stage = root.querySelector('.tuner');
    stage?.classList.toggle('in-tune', inTune);
    stage?.classList.toggle('sharp', !inTune && cents > 0);
    stage?.classList.toggle('flat', !inTune && cents < 0);
    if (!held) {
      lastTarget = target;
      refBtn.disabled = false;
    }
    freqEl.replaceChildren(
      h('span', null, h('b', null, f.frequency!.toFixed(1)), ' Hz'),
      h('span', { class: 'sep' }),
      h('span', null, 'target ', h('b', null, target.toFixed(1)), ' Hz'),
    );
    drawTrace();
  });

  function drawTrace() {
    const ctx = fitCanvas(trace);
    const w = trace.clientWidth;
    const hh = trace.clientHeight;
    ctx.clearRect(0, 0, w, hh);
    const tol = getSettings().tolerance;
    const y = (c: number) => hh / 2 - (c / 50) * (hh / 2 - 4);
    ctx.fillStyle = cssVar('--good-soft');
    ctx.fillRect(0, y(Math.max(tol, 1)), w, y(-Math.max(tol, 1)) - y(Math.max(tol, 1)));
    if (!history.length) return;
    const now = history[history.length - 1].t;
    const good = cssVar('--good');
    const sharp = cssVar('--sharp');
    const flat = cssVar('--flat');
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    let prev: { x: number; y: number } | null = null;
    for (const p of history) {
      const x = w - ((now - p.t) / HISTORY_SECONDS) * w;
      if (p.cents === null) {
        prev = null;
        continue;
      }
      const c = Math.max(-50, Math.min(50, p.cents));
      const yy = y(c);
      if (prev) {
        ctx.strokeStyle = Math.abs(c) <= tol ? good : c > 0 ? sharp : flat;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(x, yy);
        ctx.stroke();
      }
      prev = { x, y: yy };
    }
  }

  /* ----- Layout ----- */
  const s0 = getSettings();
  const modeSeg = segmented(
    [
      { value: 'chromatic', label: 'Chromatic', icon: 'tuner' },
      { value: 'strings', label: 'Strings', icon: 'strings' },
    ],
    s0.tunerMode,
    (v) => updateSettings({ tunerMode: v as Settings['tunerMode'] }),
    'Tuner mode',
  );
  const displaySeg = segmented(
    [
      { value: 'ring', label: 'Ring', icon: 'ring' },
      { value: 'bar', label: 'Bar', icon: 'bar' },
      { value: 'strobe', label: 'Strobe', icon: 'strobe' },
    ],
    s0.tunerDisplay,
    (v) => updateSettings({ tunerDisplay: v as Settings['tunerDisplay'] }),
    'Display style',
  );

  const view = h(
    'section',
    { class: 'view tuner' },
    h('div', { class: 'toolbar' }, modeSeg, h('div', { class: 'toolbar-end' }, displaySeg, iconButton('gear', 'Tuner options', () => openTunerOptions({ calibrate })))),
    stringsPanel,
    display,
    h('div', { class: 'level-row' }, h('div', { class: 'level', role: 'meter', 'aria-label': 'Input level' }, levelFill, levelTick), clipLight, levelStatus),
    h('div', { class: 'meta-row' }, freqEl, refBadge, refBtn),
    errorSlot,
    noticeSlot,
    clickNotice,
    h('div', { class: 'trace-wrap' }, h('div', { class: 'trace-label' }, h('span', null, 'Last 10 seconds'), h('span', { class: 'muted' }, 'sharp ↑  flat ↓')), trace),
    tendPanel,
  );
  root.append(view);

  let micKey = `${s0.micDeviceId}|${s0.micChannel}`;
  function applySettings() {
    const s = getSettings();
    const key = `${s.micDeviceId}|${s.micChannel}`;
    if (key !== micKey) {
      micKey = key;
      if (tracker.running) void toggle().then(() => toggle());
    }
    levelTick.style.left = `${meterPosition(s.sensitivity) * 100}%`;
    view.dataset.display = s.tunerDisplay;
    view.dataset.mode = s.tunerMode;
    stringsPanel.hidden = s.tunerMode !== 'strings';
    modeSeg.set(s.tunerMode);
    displaySeg.set(s.tunerDisplay);
    barZone.style.left = `${50 - s.tolerance}%`;
    barZone.style.width = `${s.tolerance * 2}%`;
    instrumentSelect.value = s.stringInstrument;
    if (s.tunerMode === 'strings') renderStrings(manualString, null);
    // Only reset the display when idle; settings also change while tuning (e.g. saving tendencies).
    if (!tracker.running) ring.update({ pitchClass: null, cents: 0, inTune: false, hold: 0 }, s.tolerance, s.flats);
    tendPanel.hidden = s.tunerMode !== 'chromatic';
    renderTendencies();
    drawTrace();
    if (s.tunerDisplay === 'strobe') drawStrobe(null, performance.now());
  }
  applySettings();
  const offSettings = subscribeSettings(applySettings);

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement) return;
    if (e.code === 'Space') {
      e.preventDefault();
      void toggle();
    }
  };
  window.addEventListener('keydown', onKey);
  const onResize = () => drawTrace();
  window.addEventListener('resize', onResize);

  return () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
    offFrame();
    offSettings();
    stopRef();
    tracker.stop();
    timer.stop();
    window.clearInterval(flushTimer);
    flushTendencies();
    stopFollow();
    disposed = true;
  };
}
