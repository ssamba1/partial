import { currentMicTrack, ensureRunning, getContext, getMaster, MicError } from '../../audio/context';
import { VoicedClock } from '../../core/practice';
import { nearestPartial, type PartialReading } from '../../core/partials';
import { MIN_FREQUENCY } from '../../audio/pitchTracker';
import { Drone, DRONE_TIMBRES, playTone, type DroneTimbre } from '../../audio/voices';
import { playChime, playCue } from '../../audio/cues';
import { agoText, AutoScale, barLabels, centsText, centsToPercent, centsToY, clampHoldSeconds, clampTolerance, clampTraceOffset, formatHz, scaleRange, signedCents, signedLabel, traceRuns, useDecimalCents, type DecimalCents, type TracePoint, type TunerScale } from '../../core/display';
import { PhaseStrobe, STROBE_PARTIALS, type StrobeRow } from '../../core/strobe';
import { icon } from '../icons';
import { formatCents, uid } from '../../core/format';
import { allInstruments, CUSTOM_TUNING_PREFIX, sanitizeTuning, StringFollower, stringFrequency, stringMidi, suggestString, tuneHint, type StringInstrument } from '../../core/instruments';
import { activeFrequencies, noteOff, noteOn } from '../../audio/droneBank';
import { FollowState, matchesReference, referenceOctaves, sonifyInterval, type ReferenceOctave } from '../../core/selfsound';
import { OnsetGate } from '../../core/tracking';
import { addReading, bookTendencies, InTuneLatch, LongToneWatcher, mergeTendencies, StableNoteGate, summarize, tendencyKey, traceSummary, type HeldNote, type Tendencies } from '../../core/intonation';
import { clearTendencies, getTendencyBook, saveTendencies } from '../../store/tendencies';
import { calibratedThreshold, meterPosition, micHelpSteps, micWarnings, SignalStatus, zeroCrossingRate } from '../../core/mic';
import { clampA4, midiToFrequency, noteName, pitchClassOffsets, prettyName, TRANSPOSITIONS, transpose, vsEqualCents } from '../../core/notes';
import { clampAutoStop, getSettings, logPractice, subscribeSettings, tuningOf, updateSettings, type Settings } from '../../store/settings';
import { haptic, iconButton, openSheet, segmented } from '../components';
import { cssVar, errorBox, fitCanvas, h, numberInput, select, setText } from '../dom';
import { announce } from '../controls';
import { createPitchRing } from '../pitchRing';
import { createTracker, recordTuningFrame, selfSounds } from '../shared';

/** Whether the tuner was listening when the view was last left, so coming back resumes it. */
let tunerWasRunning = false;

/** Seconds the trace shows at once. */
const HISTORY_SECONDS = 10;
/** Seconds kept for scrolling back through a paused trace. */
const TRACE_BUFFER_SECONDS = 60;

const RANGES: { value: string; label: string; cents: number }[] = [
  { value: '10', label: 'Wide ±10', cents: 10 },
  { value: '5', label: 'Normal ±5', cents: 5 },
  { value: '2', label: 'Fine ±2', cents: 2 },
  { value: '1', label: 'Ultra ±1', cents: 1 },
];

interface OptionsTools {
  /** Measures room noise for two seconds and returns the new threshold, or null if the mic could not start. */
  calibrate: () => Promise<number | null>;
  resetTendencies: () => void;
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
  const toleranceInput = numberInput(s.tolerance, (n) => {
    const v = clampTolerance(n);
    toleranceInput.value = String(v);
    rangeSeg.set(String(v));
    updateSettings({ tolerance: v });
  }, { min: 0.5, max: 25, step: 0.5, class: 'compact' });
  toleranceInput.setAttribute('aria-label', 'Custom in-tune range in cents');
  const rangeSeg = segmented(RANGES.map((r) => ({ value: r.value, label: r.label })), String(s.tolerance), (v) => {
    toleranceInput.value = v;
    updateSettings({ tolerance: Number(v) });
  }, 'In-tune range');
  const holdInput = numberInput(s.tunerHoldSeconds, (n) => {
    const v = clampHoldSeconds(n);
    holdInput.value = String(v);
    updateSettings({ tunerHoldSeconds: v });
  }, { min: 0.5, max: 5, step: 0.1, class: 'compact' });
  const body = h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'In-tune range'),
      rangeSeg,
      h('label', { class: 'row tight' }, h('span', null, 'Custom, cents'), toleranceInput),
    ),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Scale'),
      segmented(
        [
          { value: '50', label: '±50' },
          { value: '20', label: '±20' },
          { value: '10', label: '±10' },
          { value: 'auto', label: 'Auto' },
        ],
        s.tunerScale,
        (v) => updateSettings({ tunerScale: v as TunerScale }),
        'Scale',
      ),
      h('small', null, 'Cents shown either side of in tune. Auto zooms to ±10 while you hold a note close.'),
    ),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Decimal cents'),
      segmented(
        [
          { value: 'auto', label: 'Auto' },
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ],
        s.decimalCents,
        (v) => updateSettings({ decimalCents: v as DecimalCents }),
        'Decimal cents',
      ),
      h('small', null, 'Auto shows tenths of a cent when the range is ±2 or finer.'),
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'row tight' }, h('span', { class: 'field-label' }, 'Lock after, seconds'), holdInput),
      h('small', null, 'How long a note stays in tune before it locks.'),
    ),
    h(
      'label',
      { class: 'switch-row' },
      h('span', null, h('strong', null, 'Chime on lock'), h('small', null, 'A short soft chime when a note locks in tune.')),
      h('input', { type: 'checkbox', role: 'switch', checked: s.lockChime, onchange: (e: Event) => updateSettings({ lockChime: (e.target as HTMLInputElement).checked }) }),
    ),
    h(
      'label',
      { class: 'switch-row' },
      h('span', null, h('strong', null, 'Keep last note on screen'), h('small', null, 'After the sound stops, the last reading stays, greyed, until the next note.')),
      h('input', { type: 'checkbox', role: 'switch', checked: s.keepLastNote, onchange: (e: Event) => updateSettings({ keepLastNote: (e.target as HTMLInputElement).checked }) }),
    ),
    h(
      'label',
      { class: 'switch-row' },
      h('span', null, h('strong', null, 'Keep C at the top'), h('small', null, 'The ring stays still and the dot moves to the note, instead of turning the note to the top.')),
      h('input', { type: 'checkbox', role: 'switch', checked: s.ringFixed, onchange: (e: Event) => updateSettings({ ringFixed: (e.target as HTMLInputElement).checked }) }),
    ),
    h(
      'label',
      { class: 'switch-row' },
      h('span', null, h('strong', null, 'Start when opened'), h('small', null, 'Listens as soon as the tuner opens, once the microphone is allowed.')),
      h('input', { type: 'checkbox', role: 'switch', checked: s.tunerAutoStart, onchange: (e: Event) => updateSettings({ tunerAutoStart: (e.target as HTMLInputElement).checked }) }),
    ),
    h(
      'div',
      { class: 'field' },
      h(
        'label',
        { class: 'row tight' },
        h('span', { class: 'field-label' }, 'Stop after silence, minutes'),
        numberInput(s.tunerAutoStopMinutes, (n) => updateSettings({ tunerAutoStopMinutes: clampAutoStop(n) }), { min: 0, max: 60, step: 1, class: 'compact' }),
      ),
      h('small', null, 'Frees the microphone when nothing is played for this long. 0 never stops.'),
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
      'label',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Reference sound'),
      select(
        [{ value: 'drone', label: 'Same as drone' }, ...DRONE_TIMBRES.map((d) => ({ value: d.id, label: d.label }))],
        s.reference.timbre,
        (v) => updateSettings((cur) => ({ reference: { ...cur.reference, timbre: v as DroneTimbre | 'drone' } })),
        { 'aria-label': 'Reference sound' },
      ),
    ),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Reference length'),
      segmented(
        [
          { value: 'short', label: '4 seconds' },
          { value: 'hold', label: 'Until tapped' },
          { value: 'repeat', label: 'Pluck every 2 s' },
        ],
        s.reference.length,
        (v) => updateSettings((cur) => ({ reference: { ...cur.reference, length: v as Settings['reference']['length'] } })),
        'Reference length',
      ),
    ),
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Reference volume'),
      h('input', {
        type: 'range',
        min: 0.05,
        max: 1,
        step: 0.05,
        value: String(s.reference.volume),
        'aria-label': 'Reference volume',
        oninput: (e: Event) => updateSettings((cur) => ({ reference: { ...cur.reference, volume: Number((e.target as HTMLInputElement).value) } })),
      }),
    ),
    h(
      'label',
      { class: 'switch-row' },
      h('span', null, h('strong', null, 'Sound cues'), h('small', null, 'Ticks while you are out of tune: faster for bigger errors, rising when flat, falling when sharp, silent when in tune. Use headphones.')),
      h('input', { type: 'checkbox', role: 'switch', checked: s.sonify, onchange: (e: Event) => updateSettings({ sonify: (e.target as HTMLInputElement).checked }) }),
    ),
    h(
      'button',
      {
        class: 'pill-btn',
        onclick: () => {
          if (confirm('Clear your saved intonation tendencies?')) tools.resetTendencies();
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
  const voiced = new VoicedClock();
  const history: TracePoint[] = [];
  /** Paused trace: the time its window ends at, and how far it is scrolled back. */
  let traceFrozenAt: number | null = null;
  let traceOffset = 0;
  const stableGate = new StableNoteGate();
  const longTones = new LongToneWatcher();
  let longToneTimer = 0;
  // Created up front so frame handlers can use it instead of querying the DOM every frame.
  const view = h('section', { class: 'view tuner' });
  /** Theme colours for the canvases, read once and refreshed when settings or the colour scheme change. */
  let colors: Record<'good' | 'goodSoft' | 'sharp' | 'flat' | 'surface3' | 'muted', string> | null = null;
  const palette = () =>
    (colors ??= { good: cssVar('--good'), goodSoft: cssVar('--good-soft'), sharp: cssVar('--sharp'), flat: cssVar('--flat'), surface3: cssVar('--surface-3'), muted: cssVar('--muted') });
  const nameCache = new Map<string, { pretty: string; letter: string; accidental: string }>();
  const noteParts = (midi: number, flats: boolean) => {
    const key = noteName(midi, flats, false);
    let v = nameCache.get(key);
    if (!v) {
      const pretty = prettyName(noteName(midi, flats, false));
      const accidental = pretty.match(/[♯♭]/)?.[0] ?? '';
      v = { pretty, letter: pretty.replace(accidental, ''), accidental };
      nameCache.set(key, v);
    }
    return v;
  };
  const inTuneLatch = new InTuneLatch(getSettings().tunerHoldSeconds);
  const autoScale = new AutoScale();
  /** Cents either side of in tune that the ring, bar and trace span right now. */
  let range = scaleRange(getSettings().tunerScale);
  /** When the last note was on screen, for "Keep last note on screen". */
  let shownAt: number | null = null;
  const phaseStrobe = new PhaseStrobe();
  let strobeFrameTime: number | null = null;
  const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const signal = new SignalStatus();
  /** The one reference tone sounding: a string reference (index) or the hear-target tone (index null). */
  let refSound: { index: number | null; frequency: number; stop: () => void } | null = null;
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
  const barScale = h('div', { class: 'bar-scale' });
  let barScaleRange = 0;
  function renderBarScale() {
    if (barScaleRange === range) return;
    barScaleRange = range;
    barScale.replaceChildren(...barLabels(range).map((c) => h('span', { style: `left:${centsToPercent(c, range)}%`, class: c === 0 ? 'major' : '' }, signedLabel(c))));
  }
  const barMeter = h(
    'div',
    { class: 'bar-meter' },
    barZone,
    barScale,
    barNeedle,
  );
  const barView = h('div', { class: 'bar-view' }, h('div', { class: 'bar-head' }, barNote, barCents), barMeter, h('div', { class: 'bar-legend' }, h('span', null, '♭ flat'), h('span', null, 'sharp ♯')));

  /* ----- Strobe display ----- */
  const strobeCanvas = h('canvas', { class: 'strobe-canvas', 'aria-hidden': 'true' });
  const strobeNote = h('div', { class: 'bar-note' }, 'Play a note');
  const strobeCents = h('div', { class: 'bar-cents' });
  const strobeMotion = h('small', { class: 'muted', hidden: true }, 'Motion reduced: bands shift by the error instead of moving.');
  const strobeView = h(
    'div',
    { class: 'strobe-view' },
    h('div', { class: 'bar-head' }, strobeNote, strobeCents),
    h('div', { class: 'strobe-frame' }, strobeCanvas),
    h('div', { class: 'bar-legend' }, h('span', null, '← flat turns left'), h('span', null, 'still = in tune'), h('span', null, 'sharp turns right →')),
    h('small', { class: 'muted' }, 'Rows: fundamental, 2nd partial, 4th partial.'),
    strobeMotion,
  );
  let strobePhases: StrobeRow[] = STROBE_PARTIALS.map(() => ({ phase: 0, strength: 0 }));
  /**
   * Band phase comes from the signal itself (see core/strobe), so each row
   * turns at its own partial's offset from the target. With reduced motion the
   * bands stand still, shifted in proportion to the needle's cents.
   */
  function drawStrobe(rows: StrobeRow[] | null, cents: number | null) {
    const ctx = fitCanvas(strobeCanvas);
    const w = strobeCanvas.clientWidth;
    const hh = strobeCanvas.clientHeight;
    ctx.clearRect(0, 0, w, hh);
    const reduced = !!reducedMotion?.matches;
    strobeMotion.hidden = !reduced;
    if (rows) strobePhases = rows;
    const n = STROBE_PARTIALS.length;
    const rowH = hh / n;
    const tol = getSettings().tolerance;
    const c = palette();
    const color = cents === null ? c.surface3 : Math.abs(cents) <= tol ? c.good : cents > 0 ? c.sharp : c.flat;
    for (let r = 0; r < n; r++) {
      const bandW = w / (8 * STROBE_PARTIALS[r]);
      const phase = reduced ? (cents === null ? 0 : (Math.max(-range, Math.min(range, cents)) / range) * 0.5) : strobePhases[r].phase;
      const offset = (((phase % 1) + 1) % 1) * bandW * 2;
      ctx.fillStyle = color;
      // Faint rows mean that partial is weak or missing in the sound.
      ctx.globalAlpha = r === 0 || reduced ? 0.85 : 0.2 + 0.65 * Math.min(1, strobePhases[r].strength * 2);
      for (let x = -bandW * 2 + offset; x < w + bandW; x += bandW * 2) {
        ctx.fillRect(x, r * rowH + 3, bandW, rowH - 6);
      }
    }
    ctx.globalAlpha = 1;
  }

  // The readout spans are made once and only their text changes per frame.
  const freqMsg = h('span', null, 'Play a note to begin');
  const freqHz = h('b');
  const targetHz = h('b');
  const vsEqualEl = h('span', { class: 'vs-equal', hidden: true });
  const freqReading = h('span', { class: 'meta-reading', hidden: true }, h('span', null, freqHz, ' Hz'), h('span', { class: 'sep' }), h('span', null, 'target ', targetHz, ' Hz'), vsEqualEl);
  const freqEl = h('div', { class: 'tuner-meta' }, freqMsg, freqReading);
  const showFreqMessage = (text: string) => {
    freqReading.hidden = true;
    freqMsg.hidden = false;
    setText(freqMsg, text);
  };
  const longToneEl = h('p', { class: 'long-tone', role: 'status', hidden: true });
  let lastTarget: number | null = null;
  const refBtn = h(
    'button',
    {
      class: 'chip ref-btn',
      disabled: true,
      title: 'Play the in-tune pitch of the last note',
      'aria-pressed': 'false',
      onclick: () => {
        if (refSound && refSound.index === null) stopRef();
        else if (lastTarget) void startReference(lastTarget, null);
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
  const agoEl = h('span', { class: 'ago', hidden: true });
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

  // A plain area rather than a button, so screen readers reach the note and cents inside it; the Start button carries the on/off state.
  const display = h('div', { class: 'tuner-stage', onclick: () => void toggle() }, ring.el, barView, strobeView);
  const startBtn = h('button', { class: 'pill-btn tuner-toggle', 'aria-pressed': 'false', onclick: () => void toggle() }, 'Start');
  const traceText = h('p', { class: 'visually-hidden' }, 'Last 10 s: no note');
  let traceTextAt = 0;
  const tendTable = h('table', { class: 'visually-hidden' });
  let selectedTend: number | null = null;

  /* ----- Intonation tendencies ----- */
  // Seconds of steady sound for the current tuning, not yet saved; saved every 5 s to their own store.
  let pendingTend: Tendencies = {};
  let pendingKey = tendencyKey(tuningOf(getSettings()));
  let tendRange: 'week' | 'all' | 'legacy' = 'week';
  const tendBars = h('div', { class: 'tend-bars' });
  const tendCaption = h('span', { class: 'muted small' });
  const tendRangeSeg = segmented(
    [
      { value: 'week', label: 'Last 7 days' },
      { value: 'all', label: 'All time' },
      { value: 'legacy', label: 'Older' },
    ],
    tendRange,
    (v) => {
      tendRange = v;
      selectedTend = null;
      renderTendencies();
    },
    'Tendencies period',
  );
  tendRangeSeg.classList.add('tend-range');
  const tendPanel = h(
    'div',
    { class: 'trace-wrap tendencies' },
    h('div', { class: 'trace-label' }, h('span', null, 'Your tendencies'), tendCaption),
    tendRangeSeg,
    tendBars,
    tendTable,
  );
  function flushTendencies() {
    if (!Object.keys(pendingTend).length) return;
    saveTendencies(pendingKey, pendingTend);
    pendingTend = {};
    renderTendencies();
  }
  const flushTimer = window.setInterval(flushTendencies, 5000);
  function renderTendencies() {
    const s = getSettings();
    const book = getTendencyBook();
    const key = tendencyKey(tuningOf(s));
    const hasLegacy = Object.keys(book.legacy).length > 0;
    (tendRangeSeg.querySelector('[data-value="legacy"]') as HTMLElement).hidden = !hasLegacy;
    if (tendRange === 'legacy' && !hasLegacy) {
      tendRange = 'week';
      tendRangeSeg.set('week');
    }
    const legacy = tendRange === 'legacy';
    let combined: Tendencies;
    if (legacy) combined = book.legacy;
    else {
      combined = bookTendencies(book, key, tendRange === 'all' ? 'all' : 7, new Date());
      if (pendingKey === key) combined = mergeTendencies(combined, pendingTend);
    }
    // Live stats are seconds of steady sound by concert pitch class; older readings were frames by written pitch class.
    const stats = summarize(combined, legacy ? 20 : 2);
    const semis = legacy ? 0 : (TRANSPOSITIONS.find((t) => t.id === s.transposition)?.semitones ?? 0);
    const byPc = new Map(stats.map((x) => [((x.pitchClass + semis) % 12 + 12) % 12, x]));
    const amount = (n: number) => (legacy ? `${Math.round(n)} readings` : `${Math.round(n)} s`);
    const period = legacy ? 'older readings, mixed tunings' : tendRange === 'all' ? 'all time, this tuning' : 'last 7 days, this tuning';
    const detail = (pc: number) => {
      const st = byPc.get(pc);
      const name = prettyName(noteName(pc, s.flats, false));
      return st ? `${name}: ${formatCents(st.mean)} average, ±${st.spread.toFixed(1)}¢ spread, ${amount(st.count)}` : `${name}: not enough readings yet`;
    };
    tendCaption.textContent = selectedTend !== null ? detail(selectedTend) : stats.length ? `average cents per note, ${period}. Tap a note for details` : 'Play for a while to see which notes you tend to play sharp or flat';
    // The same numbers as a table for screen readers.
    tendTable.replaceChildren(
      h('caption', null, `Your tendencies, ${period}`),
      h('tr', null, h('th', null, 'Note'), h('th', null, 'Average'), h('th', null, 'Spread'), h('th', null, legacy ? 'Readings' : 'Seconds')),
      ...[...byPc.entries()].sort((a, b) => a[0] - b[0]).map(([pc, st]) => h('tr', null, h('td', null, prettyName(noteName(pc, s.flats, false))), h('td', null, formatCents(st.mean)), h('td', null, `±${st.spread.toFixed(1)}¢`), h('td', null, String(Math.round(st.count))))),
    );
    tendBars.replaceChildren(
      ...Array.from({ length: 12 }, (_, pc) => {
        const st = byPc.get(pc);
        const mean = st ? Math.max(-25, Math.min(25, st.mean)) : 0;
        const cls = !st ? 'none' : Math.abs(st.mean) <= s.tolerance ? 'good' : st.mean > 0 ? 'sharp' : 'flat';
        const clamped = st && Math.abs(st.mean) > 25 ? ` clamped ${st.mean > 0 ? 'up' : 'down'}` : '';
        return h(
          'button',
          {
            class: `tend ${cls}${clamped}${selectedTend === pc ? ' on' : ''}`,
            title: detail(pc),
            'aria-hidden': 'true',
            tabindex: -1,
            onclick: () => {
              selectedTend = selectedTend === pc ? null : pc;
              renderTendencies();
            },
          },
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
    allInstruments(getSettings().customTunings).map((i) => ({ value: i.id, label: i.label })),
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
  const editChip = h('button', { class: 'chip', onclick: () => openTuningEditor(instrument()) }, 'Edit tuning');
  const stringsPanel = h('div', { class: 'strings-panel' }, h('div', { class: 'row wrap tight' }, instrumentSelect, autoChip, pureChip, editChip, suggestChip), stringsRow);

  function instrument(): StringInstrument {
    const all = allInstruments(getSettings().customTunings);
    return all.find((i) => i.id === getSettings().stringInstrument) ?? all[0];
  }

  /** Editor for the player's own tunings: a copy of a built-in one, or an existing custom tuning. */
  function openTuningEditor(base: StringInstrument) {
    const s = getSettings();
    const existing = base.id.startsWith(CUSTOM_TUNING_PREFIX) ? base.id.slice(CUSTOM_TUNING_PREFIX.length) : null;
    const draft = {
      label: existing ? base.label : `My ${base.label}`,
      strings: [...base.strings],
      offsets: base.strings.map((_, k) => base.centOffsets?.[k] ?? 0),
      capo: base.capo ?? 0,
    };
    const notes = Array.from({ length: 97 }, (_, k) => 12 + k).map((m) => ({ value: String(m), label: prettyName(noteName(m, s.flats)) }));
    const list = h('div', { class: 'stack tight' });
    const labelled = <T extends HTMLElement>(el: T, label: string): T => (el.setAttribute('aria-label', label), el);
    const renderList = () =>
      list.replaceChildren(
        ...draft.strings.map((m, k) =>
          h(
            'div',
            { class: 'row tight tuning-string' },
            h('span', { class: 'muted small' }, `String ${k + 1}`),
            select(notes, m, (v) => (draft.strings[k] = Number(v)), { 'aria-label': `String ${k + 1} note`, class: 'compact' }),
            labelled(numberInput(draft.offsets[k], (n) => (draft.offsets[k] = n), { min: -50, max: 50, step: 0.5, class: 'compact' }), `String ${k + 1} offset in cents`),
            h('span', { class: 'muted small' }, '¢'),
            draft.strings.length > 1
              ? iconButton('trash', `Remove string ${k + 1}`, () => {
                  draft.strings.splice(k, 1);
                  draft.offsets.splice(k, 1);
                  renderList();
                })
              : null,
          ),
        ),
      );
    renderList();
    const labelInput = h('input', { type: 'text', value: draft.label, maxlength: 40, oninput: (e: Event) => (draft.label = (e.target as HTMLInputElement).value) });
    const capoInput = numberInput(draft.capo, (n) => (draft.capo = n), { min: 0, max: 12, step: 1 });
    let close = () => {};
    const save = () => {
      const tuning = sanitizeTuning({ id: existing ?? uid(), label: draft.label, strings: draft.strings, centOffsets: draft.offsets, capo: draft.capo });
      if (!tuning) return;
      manualString = null;
      stringFollower.reset();
      updateSettings((cur) => ({
        customTunings: existing ? cur.customTunings.map((x) => (x.id === existing ? tuning : x)) : [...cur.customTunings, tuning],
        stringInstrument: CUSTOM_TUNING_PREFIX + tuning.id,
      }));
      close();
    };
    const body = h(
      'div',
      { class: 'stack' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), labelInput),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Capo fret'), capoInput),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Strings, lowest first, with offsets in cents'), list),
      h(
        'div',
        { class: 'row wrap tight' },
        h('button', { class: 'pill-btn', onclick: () => { draft.strings.push(draft.strings[draft.strings.length - 1] ?? 40); draft.offsets.push(0); renderList(); } }, 'Add string'),
        h('button', { class: 'pill-btn primary', onclick: save }, 'Save'),
        existing
          ? h('button', {
              class: 'pill-btn danger',
              onclick: () => {
                if (!confirm('Delete this tuning?')) return;
                manualString = null;
                stringFollower.reset();
                updateSettings((cur) => ({ customTunings: cur.customTunings.filter((x) => x.id !== existing), stringInstrument: 'guitar' }));
                close();
              },
            }, 'Delete')
          : null,
      ),
    );
    close = openSheet(existing ? 'Edit tuning' : 'New tuning', body);
  }

  function renderStrings(activeIndex: number | null, cents: number | null) {
    const inst = instrument();
    const s = getSettings();
    pureChip.hidden = inst.pureFifthsFrom === undefined;
    autoChip.classList.toggle('on', manualString === null);
    const rowKey = `${inst.id}|${inst.strings.join(',')}|${inst.capo ?? 0}|${noteName(1, s.flats, false)}`;
    if (stringsRow.children.length !== inst.strings.length || stringsRow.dataset.inst !== rowKey) {
      stringsRow.dataset.inst = rowKey;
      stringsRow.style.setProperty('--strings', String(inst.strings.length));
      stringsRow.classList.toggle('many', inst.strings.length > 8);
      stringsRow.replaceChildren(
        ...inst.strings.map((_, i) => {
          const midi = stringMidi(inst, i);
          return h(
            'button',
            { class: 'string-btn', 'data-i': i, onclick: (e: Event) => { e.stopPropagation(); void pressString(i); } },
            h('span', { class: 'string-name' }, prettyName(noteName(midi, s.flats, false))),
            h('span', { class: 'string-oct' }, String(Math.floor(midi / 12) - 1)),
            h('span', { class: 'string-glyph', 'aria-hidden': 'true' }),
            h('span', { class: 'string-dot' }),
          );
        }),
      );
    }
    [...stringsRow.children].forEach((b, i) => {
      const el = b as HTMLElement;
      const on = i === activeIndex;
      const good = on && cents !== null && Math.abs(cents) <= s.tolerance;
      const sharp = on && cents !== null && cents > s.tolerance;
      const flat = on && cents !== null && cents < -s.tolerance;
      el.classList.toggle('active', on);
      el.classList.toggle('good', good);
      el.classList.toggle('close', on && cents !== null && Math.abs(cents) > s.tolerance && Math.abs(cents) <= 20);
      el.classList.toggle('is-sharp', sharp);
      el.classList.toggle('is-flat', flat);
      el.classList.toggle('manual', i === manualString);
      el.classList.toggle('sounding', refSound?.index === i);
      // Shape and words as well as colour: a check when in tune, an arrow for the way to turn the peg.
      const glyph = good ? '✓' : flat ? '↑' : sharp ? '↓' : '';
      const glyphEl = el.querySelector('.string-glyph');
      if (glyphEl && glyphEl.textContent !== glyph) glyphEl.textContent = glyph;
      const name = prettyName(noteName(stringMidi(inst, i), s.flats, true)).replace('♯', ' sharp').replace('♭', ' flat');
      const state = good ? ', in tune' : sharp || flat ? `, ${Math.abs(Math.round(cents!))} cents ${sharp ? 'sharp' : 'flat'}` : '';
      const label = `${name} string${state}, play reference`;
      if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
      const pressed = i === manualString ? 'true' : 'false';
      if (el.getAttribute('aria-pressed') !== pressed) el.setAttribute('aria-pressed', pressed);
    });
  }

  function pressString(i: number) {
    manualString = i;
    if (refSound?.index === i) {
      stopRef();
      return;
    }
    const s = getSettings();
    void startReference(stringFrequency(instrument(), i, tuningOf(s), s.pureFifths), i);
    renderStrings(i, null);
  }

  /** Plays a reference with the chosen sound, length, volume and octave, replacing any other reference. */
  async function startReference(frequency: number, index: number | null) {
    const ctx = await ensureRunning();
    if (disposed) return;
    // A second tap may have started a reference while this one was waiting; replace it rather than leak it.
    stopRef();
    const s = getSettings();
    const f = frequency * Math.pow(2, referenceOctaves(frequency, s.reference.octave));
    const timbre = s.reference.timbre === 'drone' ? s.drone.timbre : s.reference.timbre;
    const volume = s.reference.volume;
    let stop: () => void;
    if (s.reference.length === 'repeat') {
      const pluck = () => playTone(ctx, getMaster(), ctx.currentTime + 0.02, f, 1.6, timbre, volume);
      pluck();
      const interval = window.setInterval(pluck, 2000);
      stop = () => window.clearInterval(interval);
    } else {
      const drone = new Drone(ctx, getMaster(), f, timbre, volume);
      const timeout = s.reference.length === 'short' ? window.setTimeout(stopRef, 4000) : 0;
      stop = () => {
        window.clearTimeout(timeout);
        drone.stop();
      };
    }
    refSound = { index, frequency: f, stop };
    refBtn.setAttribute('aria-pressed', String(index === null));
    renderStrings(manualString, null);
  }

  function stopRef() {
    if (!refSound) return;
    refSound.stop();
    refSound = null;
    refBtn.setAttribute('aria-pressed', 'false');
    renderStrings(manualString, null);
  }

  /* ----- Start / stop ----- */
  /** Bumped by every start and cancel, so a start that finishes late does not touch the display. */
  let startToken = 0;
  let starting = false;

  function idleControls(hintText: string) {
    view.classList.remove('listening');
    startBtn.textContent = 'Start';
    startBtn.removeAttribute('aria-busy');
    startBtn.setAttribute('aria-pressed', 'false');
    hint.textContent = hintText;
  }

  /** Clears the last live reading so a stopped tuner does not look like it is still hearing a note. */
  function resetDisplay() {
    const s = getSettings();
    shownAt = null;
    clearStale();
    inTuneLatch.reset();
    ring.update({ pitchClass: null, cents: 0, inTune: false, hold: 0 }, s.tolerance, s.flats, range);
    view.classList.remove('has-note', 'in-tune', 'sharp', 'flat');
    placeNeedle(0);
    barMeter.classList.remove('good');
    setText(barNote, 'Play a note');
    setText(strobeNote, 'Play a note');
    setText(barCents, '');
    setText(strobeCents, '');
    setText(centsEl, '');
    vsEqualEl.hidden = true;
    if (s.tunerDisplay === 'strobe') drawStrobe(null, null);
  }

  function stopListening(message: string) {
    tracker.stop();
    logPractice(voiced.seconds, 'tuner');
    voiced.reset();
    stopFollow();
    signal.reset();
    onsets.reset();
    stableGate.reset();
    showLongTone(longTones.flush());
    flushTendencies();
    noticeSlot.replaceChildren();
    idleControls('Tap to start');
    showFreqMessage(message);
    resetDisplay();
  }

  function showMicError(err: unknown) {
    const message = err instanceof Error ? err.message : 'No microphone could be opened.';
    const box = errorBox(message, () => void toggle());
    if (err instanceof MicError && err.reason === 'denied') {
      const steps = h('ol', { class: 'mic-help', hidden: true }, ...micHelpSteps(navigator.userAgent).map((t) => h('li', null, t)));
      const helpBtn = h('button', { 'aria-expanded': 'false', onclick: () => { steps.hidden = !steps.hidden; helpBtn.setAttribute('aria-expanded', String(!steps.hidden)); } }, 'How to allow the microphone');
      box.append(helpBtn, steps);
    }
    errorSlot.replaceChildren(box);
    showFreqMessage('Microphone not available');
  }

  async function toggle() {
    errorSlot.replaceChildren();
    if (starting) {
      // A second tap while the permission prompt is up cancels the start.
      startToken++;
      starting = false;
      tracker.stop();
      idleControls('Tap to start');
      return;
    }
    if (tracker.running) {
      tunerWasRunning = false;
      stopListening('Paused');
      return;
    }
    const token = ++startToken;
    starting = true;
    startBtn.textContent = 'Starting';
    startBtn.setAttribute('aria-busy', 'true');
    hint.textContent = 'Waiting for microphone';
    try {
      await tracker.start();
      if (token !== startToken) return;
      starting = false;
      if (!tracker.running) {
        idleControls('Tap to start');
        return;
      }
      tunerWasRunning = true;
      shownAt = null;
      clearStale();
      phaseStrobe.reset();
      strobeFrameTime = null;
      voiced.start(performance.now() / 1000);
      view.classList.add('listening');
      startBtn.textContent = 'Stop';
      startBtn.removeAttribute('aria-busy');
      startBtn.setAttribute('aria-pressed', 'true');
      hint.textContent = 'Listening';
      showFreqMessage('Play a note');
      noticeSlot.replaceChildren(...micWarningList().map((w) => h('p', { class: 'mic-warning', role: 'note' }, w)));
    } catch (err) {
      if (token !== startToken) return;
      starting = false;
      idleControls('Tap to start');
      showMicError(err);
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
      stopListening('Paused while in background. Tap to resume.');
      return;
    }
    if (!pausedHidden || disposed) return;
    pausedHidden = false;
    if (!tracker.running && (await micGranted()) && !disposed && document.visibilityState === 'visible') await toggle();
  };
  document.addEventListener('visibilitychange', onVisibility);

  /* ----- Sound cues ----- */
  let nextCueAt = 0;
  /** Ticks faster the further out of tune; the tracker skips frames that contain them. */
  function sonify(cents: number | null, tolerance: number) {
    const interval = sonifyInterval(cents, tolerance);
    if (interval === null || cents === null) {
      nextCueAt = 0;
      return;
    }
    const now = performance.now() / 1000;
    if (now < nextCueAt) return;
    nextCueAt = now + interval;
    void ensureRunning().then((ctx) => {
      const when = ctx.currentTime + 0.01;
      selfSounds.add(when, playCue(ctx, getMaster(), when, cents < 0));
    });
  }

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
    const oneShotRefs = refSound ? [refSound.frequency] : [];
    refBadge.hidden = !refSound && !activeFrequencies().length;
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
    let partial: PartialReading | null = null;

    if (note && f.frequency) {
      if (s.tunerMode === 'partials') {
        // Natural partials of the chosen fundamental: brass without valves, harmonics on strings.
        const freq = f.displayFrequency ?? f.frequency;
        partial = nearestPartial(freq, midiToFrequency(s.partialFundamental, tuningOf(s)));
        if (partial) {
          target = partial.target;
          cents = Math.max(-50, Math.min(50, partial.cents));
          displayMidi = transpose(s.partialFundamental + partial.semitones, semis);
        }
      } else if (s.tunerMode === 'strings') {
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
        displayMidi = stringMidi(inst, index);
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
      const text = `Sounds like the ${prettyName(noteName(stringMidi(instrument(), suggested), s.flats, false))} string`;
      if (suggestChip.textContent !== text) suggestChip.textContent = text;
    }

    const nowSec = nowMs / 1000;
    const clean = !held && !f.gated && !hearingSelf && !transient;
    if (clean) recordTuningFrame(cents);
    // Tendencies count seconds of a note held steady for 300 ms, by concert pitch class for this tuning, so slides and attacks do not count.
    const chromaticNote = s.tunerMode === 'chromatic' && clean && note ? note : null;
    const weight = stableGate.update(chromaticNote?.midi ?? null, nowSec);
    if (chromaticNote && weight > 0) {
      const key = tendencyKey(tuningOf(s));
      if (key !== pendingKey) {
        flushTendencies();
        pendingKey = key;
      }
      pendingTend = addReading(pendingTend, chromaticNote.pitchClass, chromaticNote.cents, weight);
    }
    // Long tones: when a held note ends, say how steady it was.
    if (s.tunerMode === 'chromatic' && !f.gated && !hearingSelf) showLongTone(longTones.push(nowSec, note && displayMidi !== null && !held ? displayMidi : null, note?.cents ?? 0));
    voiced.frame(nowSec, !!note);
    const stopAfter = s.tunerAutoStopMinutes;
    if (stopAfter > 0 && voiced.silentFor(nowSec) >= stopAfter * 60) {
      stopListening(`Stopped after ${stopAfter} ${stopAfter === 1 ? 'minute' : 'minutes'} of silence`);
      return;
    }
    followNote(note && !held ? note.midi : null, f.time);
    if (s.tunerDisplay === 'strobe') {
      const estimate = strobeFrameTime === null ? 0 : (f.time - strobeFrameTime) * f.sampleRate;
      strobeFrameTime = f.time;
      // Clicks and held frames would disturb the phase; the clock still advances.
      drawStrobe(phaseStrobe.update(f.samples, f.sampleRate, cents !== null && !f.gated && !held ? target : null, estimate), cents);
    } else {
      strobeFrameTime = null;
    }
    history.push({ t: f.time, cents, midi: cents === null ? null : displayMidi });
    while (history.length && f.time - history[0].t > TRACE_BUFFER_SECONDS) history.shift();

    // Hysteresis keeps the in-tune state from flickering at the edge of the range.
    const { inTune, hold, fire } = transient ? { inTune: false, hold: 0, fire: false } : inTuneLatch.update(cents, displayMidi, nowMs / 1000, s.tolerance);
    if (fire) {
      haptic(12);
      if (s.lockChime) {
        void ensureRunning().then((ctx) => {
          const when = ctx.currentTime + 0.01;
          selfSounds.add(when, playChime(ctx, getMaster(), when));
        });
      }
    }
    range = s.tunerScale === 'auto' ? autoScale.update(cents, nowMs / 1000) : scaleRange(s.tunerScale);
    renderBarScale();
    placeBarZone(s.tolerance);
    sonify(s.sonify && tracker.running ? cents : null, s.tolerance);

    const ringShown = s.tunerDisplay === 'ring';
    if (displayMidi === null || cents === null) {
      if (s.keepLastNote && shownAt !== null) {
        // Leave the last reading up, greyed, with its age.
        view.classList.add('stale');
        agoEl.hidden = false;
        setText(agoEl, agoText((nowMs - shownAt) / 1000));
        drawTrace();
        return;
      }
      clearStale();
      if (ringShown) ring.update({ pitchClass: null, cents: 0, inTune: false, hold: 0 }, s.tolerance, s.flats, range);
      view.classList.remove('has-note');
      placeNeedle(0);
      vsEqualEl.hidden = true;
      drawTrace();
      return;
    }

    view.classList.add('has-note');
    clearStale();
    shownAt = nowMs;
    const parts = noteParts(displayMidi, s.flats);
    const octave = String(Math.floor(displayMidi / 12) - 1);
    setText(noteEl, parts.letter);
    noteEl.classList.toggle('long', parts.letter.length > 1);
    setText(accidentalEl, parts.accidental);
    setText(octaveEl, octave);
    // Words as well as colour, so the state reads without relying on colour vision.
    const decimals = useDecimalCents(s.decimalCents, s.tolerance);
    const direction = centsText(cents, decimals);
    // The number stays next to "in tune", so fine work can still see it.
    const centsLine = hint ?? (inTune ? `${signedCents(cents, decimals)} in tune` : direction);
    setText(centsEl, centsLine);
    setText(barNote, `${parts.pretty}${octave}`);
    setText(barCents, centsLine);
    if (!held) announce(`${parts.pretty.replace('♯', ' sharp').replace('♭', ' flat')}, ${hint ?? (inTune ? 'in tune' : direction.replace('¢', ' cents'))}`);
    setText(strobeNote, `${parts.pretty}${octave}`);
    setText(strobeCents, centsLine);
    if (s.tunerDisplay === 'bar') placeNeedle(cents);
    barMeter.classList.toggle('good', inTune);

    if (ringShown) ring.update({ pitchClass: ((displayMidi % 12) + 12) % 12, cents, inTune, hold }, s.tolerance, s.flats, range);
    view.classList.toggle('in-tune', inTune);
    view.classList.toggle('sharp', !inTune && cents > 0);
    view.classList.toggle('flat', !inTune && cents < 0);
    if (!held) {
      lastTarget = target;
      refBtn.disabled = false;
    }
    freqMsg.hidden = true;
    freqReading.hidden = false;
    setText(freqHz, formatHz(f.frequency!));
    setText(targetHz, formatHz(target));
    // In a non-equal temperament, how far the reading is from the equal-tempered note as well.
    if (partial) {
      vsEqualEl.hidden = false;
      setText(vsEqualEl, `Partial ${partial.n}, ${signedCents(partial.vsEqual, true)} vs equal`);
    } else {
      const vsEqual = s.tunerMode === 'chromatic' && note ? vsEqualCents(cents, note.midi, tuningOf(s)) : null;
      vsEqualEl.hidden = vsEqual === null;
      if (vsEqual !== null) setText(vsEqualEl, `vs equal ${signedCents(vsEqual, decimals)}`);
    }
    drawTrace();
  });

  function clearStale() {
    view.classList.remove('stale');
    agoEl.hidden = true;
  }

  /** Bar needle position by transform, from the meter width measured when it resizes. */
  let meterWidth = 0;
  let needleX = '';
  const meterObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => (meterWidth = barMeter.clientWidth)) : null;
  meterObserver?.observe(barMeter);
  function placeNeedle(cents: number) {
    const width = meterWidth || barMeter.clientWidth;
    const x = `translateX(${(((centsToPercent(cents, range) - 50) / 100) * width).toFixed(1)}px)`;
    if (x !== needleX) {
      needleX = x;
      barNeedle.style.transform = x;
    }
  }

  let longToneShownAt = 0;
  function showLongTone(note: HeldNote | null) {
    if (!note) return;
    const s = getSettings();
    const parts = noteParts(note.midi, s.flats);
    const seconds = (note.end - note.start).toFixed(1);
    const drift = Math.round(note.drift);
    longToneEl.textContent = `${parts.pretty}${Math.floor(note.midi / 12) - 1} held ${seconds} s, ±${note.spread.toFixed(1)}¢ spread, ${drift === 0 ? 'no drift' : `drifted ${drift > 0 ? '+' : '−'}${Math.abs(drift)}¢`}`;
    longToneEl.hidden = false;
    longToneShownAt = performance.now();
    window.clearTimeout(longToneTimer);
    longToneTimer = window.setTimeout(() => {
      if (performance.now() - longToneShownAt >= 5900) longToneEl.hidden = true;
    }, 6000);
  }

  function placeBarZone(tolerance: number) {
    const left = `${centsToPercent(-tolerance, range)}%`;
    const width = `${centsToPercent(tolerance, range) - centsToPercent(-tolerance, range)}%`;
    if (barZone.style.left !== left) barZone.style.left = left;
    if (barZone.style.width !== width) barZone.style.width = width;
  }

  let traceDrawnAt = 0;
  /** Draws the trace at up to 30 frames a second (every call when `force`), one path per colour. */
  function drawTrace(force = false) {
    const nowMs = performance.now();
    if (!force && nowMs - traceDrawnAt < 33) return;
    traceDrawnAt = nowMs;
    const ctx = fitCanvas(trace);
    const w = trace.clientWidth;
    const hh = trace.clientHeight;
    ctx.clearRect(0, 0, w, hh);
    const s = getSettings();
    const tol = s.tolerance;
    const colours = palette();
    const y = (c: number) => centsToY(c, range, hh);
    ctx.fillStyle = colours.goodSoft;
    ctx.fillRect(0, y(Math.max(tol, 1)), w, y(-Math.max(tol, 1)) - y(Math.max(tol, 1)));
    if (!history.length) return;
    const newest = history[history.length - 1].t;
    if (traceFrozenAt !== null) traceOffset = clampTraceOffset(traceOffset, traceFrozenAt, history[0].t, HISTORY_SECONDS);
    const end = (traceFrozenAt ?? newest) - traceOffset;
    if (nowMs - traceTextAt > 1000) {
      traceTextAt = nowMs;
      setText(traceText, traceSummary(history.filter((p) => p.t > end - HISTORY_SECONDS && p.t <= end), tol, HISTORY_SECONDS));
    }
    const paths = { good: new Path2D(), sharp: new Path2D(), flat: new Path2D() };
    const labels: { x: number; y: number; text: string }[] = [];
    for (const run of traceRuns(history, end, HISTORY_SECONDS)) {
      let prev: { x: number; y: number } | null = null;
      for (const p of run.points) {
        const x = w - ((end - p.t) / HISTORY_SECONDS) * w;
        const c = Math.max(-range, Math.min(range, p.cents));
        const yy = y(c);
        if (prev) {
          const path = Math.abs(c) <= tol ? paths.good : c > 0 ? paths.sharp : paths.flat;
          path.moveTo(prev.x, prev.y);
          path.lineTo(x, yy);
        } else {
          labels.push({ x: Math.max(2, x), y: yy, text: `${noteParts(run.midi, s.flats).pretty}${Math.floor(run.midi / 12) - 1}` });
        }
        prev = { x, y: yy };
      }
    }
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = colours.good;
    ctx.stroke(paths.good);
    ctx.strokeStyle = colours.sharp;
    ctx.stroke(paths.sharp);
    ctx.strokeStyle = colours.flat;
    ctx.stroke(paths.flat);
    // Each note's name where its line starts, so a change from A to B reads as two notes.
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillStyle = colours.muted;
    let lastLabelX = -Infinity;
    for (const l of labels) {
      if (l.x - lastLabelX < 26) continue;
      lastLabelX = l.x;
      ctx.fillText(l.text, l.x, l.y > hh / 2 ? l.y - 6 : l.y + 13);
    }
  }

  /* ----- Trace: tap to pause, drag to scroll back ----- */
  let traceDrag: { x: number; offset: number; moved: boolean } | null = null;
  trace.addEventListener('pointerdown', (e) => {
    traceDrag = { x: e.clientX, offset: traceOffset, moved: false };
  });
  trace.addEventListener('pointermove', (e) => {
    if (!traceDrag || !history.length) return;
    const dx = e.clientX - traceDrag.x;
    if (!traceDrag.moved && Math.abs(dx) < 6) return;
    traceDrag.moved = true;
    traceFrozenAt ??= history[history.length - 1].t;
    traceOffset = traceDrag.offset + (dx / Math.max(1, trace.clientWidth)) * HISTORY_SECONDS;
    renderTraceLabel();
    drawTrace(true);
  });
  const endTraceDrag = () => {
    if (!traceDrag) return;
    if (!traceDrag.moved) {
      // A tap pauses the trace, or resumes it at the newest reading.
      traceFrozenAt = traceFrozenAt === null && history.length ? history[history.length - 1].t : null;
      traceOffset = 0;
      renderTraceLabel();
      drawTrace(true);
    }
    traceDrag = null;
  };
  trace.addEventListener('pointerup', endTraceDrag);
  trace.addEventListener('pointercancel', () => (traceDrag = null));
  const traceTitle = h('span', null, 'Last 10 seconds');
  function renderTraceLabel() {
    setText(traceTitle, traceFrozenAt === null ? 'Last 10 seconds' : traceOffset > 0.5 ? `Paused, ${Math.round(traceOffset)} s back` : 'Paused. Drag to scroll back, tap to resume');
  }

  /* ----- Partials mode ----- */
  // The fundamental is stored in concert pitch and listed in written pitch.
  const partialSelect = select([], getSettings().partialFundamental, (v) => updateSettings({ partialFundamental: Number(v) }), { 'aria-label': 'Fundamental', class: 'compact' });
  const partialsPanel = h(
    'div',
    { class: 'strings-panel partials-panel' },
    h('label', { class: 'row wrap tight' }, h('span', { class: 'muted small' }, 'Fundamental'), partialSelect),
    h('small', { class: 'muted' }, 'Shows which natural partial you are playing and how far that partial sits from equal temperament.'),
  );
  function renderPartialOptions(s: Settings) {
    const semis = TRANSPOSITIONS.find((t) => t.id === s.transposition)?.semitones ?? 0;
    const key = `${semis}|${s.flats}|${s.notation}`;
    if (partialSelect.dataset.key !== key) {
      partialSelect.dataset.key = key;
      partialSelect.replaceChildren(
        ...Array.from({ length: 49 }, (_, k) => 24 + k).map((m) => {
          const w = transpose(m, semis);
          return h('option', { value: String(m) }, `${prettyName(noteName(w, s.flats, false))}${Math.floor(w / 12) - 1}`);
        }),
      );
    }
    partialSelect.value = String(s.partialFundamental);
  }

  /* ----- Layout ----- */
  const s0 = getSettings();
  const modeSeg = segmented(
    [
      { value: 'chromatic', label: 'Chromatic', icon: 'tuner' },
      { value: 'strings', label: 'Strings', icon: 'strings' },
      { value: 'partials', label: 'Partials' },
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

  const resetTendencies = () => {
    pendingTend = {};
    clearTendencies();
    renderTendencies();
  };
  view.append(
    h('div', { class: 'toolbar' }, modeSeg, h('div', { class: 'toolbar-end' }, displaySeg, iconButton('gear', 'Tuner options', () => openTunerOptions({ calibrate, resetTendencies })))),
    stringsPanel,
    partialsPanel,
    display,
    h('div', { class: 'level-row' }, h('div', { class: 'level', role: 'meter', 'aria-label': 'Input level' }, levelFill, levelTick), clipLight, levelStatus),
    h('div', { class: 'meta-row' }, startBtn, freqEl, agoEl, refBadge, refBtn),
    longToneEl,
    errorSlot,
    noticeSlot,
    clickNotice,
    h('div', { class: 'trace-wrap' }, h('div', { class: 'trace-label' }, traceTitle, h('span', { class: 'muted' }, 'sharp ↑  flat ↓')), trace, traceText),
    tendPanel,
  );
  root.append(view);

  let micKey = `${s0.micDeviceId}|${s0.micChannel}`;
  /** Settings that change what the tendencies panel shows; other writes (tempo, practice log) skip rebuilding it. */
  let tendKey = '';
  const onColourScheme = () => {
    colors = null;
    drawTrace(true);
  };
  const schemeQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  schemeQuery?.addEventListener?.('change', onColourScheme);
  function applySettings() {
    const s = getSettings();
    const key = `${s.micDeviceId}|${s.micChannel}`;
    if (key !== micKey) {
      micKey = key;
      if (tracker.running) void toggle().then(() => toggle());
    }
    // The theme may have changed; read colours again on the next draw.
    colors = null;
    levelTick.style.left = `${meterPosition(s.sensitivity) * 100}%`;
    view.dataset.display = s.tunerDisplay;
    view.dataset.mode = s.tunerMode;
    view.dataset.damping = s.damping;
    ring.setFixed(s.ringFixed);
    ring.setOffsets(pitchClassOffsets(tuningOf(s), TRANSPOSITIONS.find((t) => t.id === s.transposition)?.semitones ?? 0));
    stringsPanel.hidden = s.tunerMode !== 'strings';
    partialsPanel.hidden = s.tunerMode !== 'partials';
    renderPartialOptions(s);
    modeSeg.set(s.tunerMode);
    displaySeg.set(s.tunerDisplay);
    inTuneLatch.setHoldSeconds(s.tunerHoldSeconds);
    if (s.tunerScale !== 'auto') range = scaleRange(s.tunerScale);
    else if (!tracker.running) range = autoScale.range;
    renderBarScale();
    placeBarZone(s.tolerance);
    if (!s.keepLastNote) clearStale();
    const tuningsKey = s.customTunings.map((x) => `${x.id}:${x.label}`).join('|');
    if (instrumentSelect.dataset.key !== tuningsKey) {
      instrumentSelect.dataset.key = tuningsKey;
      instrumentSelect.replaceChildren(...allInstruments(s.customTunings).map((i) => h('option', { value: i.id }, i.label)));
    }
    instrumentSelect.value = instrument().id;
    editChip.textContent = s.stringInstrument.startsWith(CUSTOM_TUNING_PREFIX) ? 'Edit tuning' : 'New tuning';
    if (s.tunerMode === 'strings') renderStrings(manualString, null);
    // Only reset the display when idle; settings also change while tuning (e.g. tempo changes from the trainer).
    if (!tracker.running && !view.classList.contains('stale')) ring.update({ pitchClass: null, cents: 0, inTune: false, hold: 0 }, s.tolerance, s.flats, range);
    tendPanel.hidden = s.tunerMode !== 'chromatic';
    const tk = `${tendencyKey(tuningOf(s))}|${s.transposition}|${s.flats}|${s.notation}|${s.tolerance}|${s.tunerMode}`;
    if (tk !== tendKey) {
      tendKey = tk;
      renderTendencies();
    }
    drawTrace(true);
    if (s.tunerDisplay === 'strobe') drawStrobe(null, null);
  }
  applySettings();
  const offSettings = subscribeSettings(applySettings);

  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable)) return;
    if (document.querySelector('.sheet-layer.open')) return;
    // A button focused from the keyboard keeps Space and Enter; one that was just clicked does not swallow them.
    const keyboardButton = t instanceof HTMLButtonElement && t.matches(':focus-visible');
    const s = getSettings();
    const key = e.key.toLowerCase();
    if (e.code === 'Space') {
      if (keyboardButton) return;
      e.preventDefault();
      void toggle();
    } else if (e.key === 'Enter') {
      if (keyboardButton || !lastTarget) return;
      e.preventDefault();
      refBtn.click();
    } else if (key === 'r' || key === 'b' || key === 's') {
      e.preventDefault();
      updateSettings({ tunerDisplay: key === 'r' ? 'ring' : key === 'b' ? 'bar' : 'strobe' });
    } else if (e.key === '[' || e.key === ']') {
      e.preventDefault();
      updateSettings((cur) => ({ a4: clampA4(cur.a4 + (e.key === ']' ? 0.5 : -0.5)) }));
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && s.tunerMode === 'strings') {
      e.preventDefault();
      const count = instrument().strings.length;
      const from = manualString ?? (e.key === 'ArrowRight' ? -1 : count);
      manualString = Math.max(0, Math.min(count - 1, from + (e.key === 'ArrowRight' ? 1 : -1)));
      renderStrings(manualString, null);
    }
  };
  window.addEventListener('keydown', onKey);
  const onResize = () => drawTrace(true);
  window.addEventListener('resize', onResize);

  let cleanupGesture = () => {};
  // Start straight away when asked to, or when the tuner was listening when you left it, if the mic is already allowed.
  void (async () => {
    const s = getSettings();
    if (!(s.tunerAutoStart || tunerWasRunning) || !(await micGranted()) || disposed || tracker.running || document.visibilityState !== 'visible') return;
    const ctx = getContext();
    if (ctx.state !== 'running') {
      void ctx.resume().catch(() => {});
      await new Promise((r) => window.setTimeout(r, 300));
    }
    if (disposed || tracker.running) return;
    if (ctx.state === 'running') {
      await toggle();
      return;
    }
    // The browser wants a gesture before audio runs: start on the first touch or key anywhere.
    hint.textContent = 'Tap anywhere to start';
    const onGesture = () => {
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
      if (!disposed && !tracker.running && !starting) void toggle();
    };
    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
    cleanupGesture = () => {
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
    };
  })();

  return () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
    schemeQuery?.removeEventListener?.('change', onColourScheme);
    meterObserver?.disconnect();
    cleanupGesture();
    offFrame();
    offSettings();
    stopRef();
    startToken++;
    tracker.stop();
    logPractice(voiced.seconds, 'tuner');
    voiced.reset();
    window.clearInterval(flushTimer);
    window.clearTimeout(longToneTimer);
    flushTendencies();
    stopFollow();
    disposed = true;
  };
}
