import { currentMicTrack, ensureRunning, getMaster, MicError } from '../../audio/context';
import { MIN_FREQUENCY } from '../../audio/pitchTracker';
import { Drone, DRONE_TIMBRES, playTone, type DroneTimbre } from '../../audio/voices';
import { playChime, playCue } from '../../audio/cues';
import { agoText, AutoScale, barLabels, centsText, centsToPercent, centsToY, clampHoldSeconds, clampTolerance, formatHz, scaleRange, signedCents, signedLabel, useDecimalCents, type DecimalCents, type TunerScale } from '../../core/display';
import { PhaseStrobe, STROBE_PARTIALS, type StrobeRow } from '../../core/strobe';
import { icon } from '../icons';
import { formatCents, uid } from '../../core/format';
import { allInstruments, CUSTOM_TUNING_PREFIX, sanitizeTuning, StringFollower, stringFrequency, stringMidi, suggestString, tuneHint, type StringInstrument } from '../../core/instruments';
import { activeFrequencies, noteOff, noteOn } from '../../audio/droneBank';
import { FollowState, matchesReference, referenceOctaves, sonifyInterval, type ReferenceOctave } from '../../core/selfsound';
import { OnsetGate } from '../../core/tracking';
import { addReading, InTuneLatch, summarize, traceSummary, type Tendencies } from '../../core/intonation';
import { calibratedThreshold, meterPosition, micWarnings, SignalStatus, zeroCrossingRate } from '../../core/mic';
import { midiToFrequency, noteName, prettyName, TRANSPOSITIONS, transpose } from '../../core/notes';
import { getSettings, subscribeSettings, tuningOf, updateSettings, type Settings } from '../../store/settings';
import { haptic, iconButton, openSheet, segmented } from '../components';
import { cssVar, errorBox, fitCanvas, h, numberInput, select } from '../dom';
import { announce } from '../controls';
import { createPitchRing } from '../pitchRing';
import { ActivityTimer, createTracker, recordTuningFrame, selfSounds } from '../shared';

const HISTORY_SECONDS = 10;

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
  let lastTendencyAt = 0;
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
    const color = cents === null ? cssVar('--surface-3') : Math.abs(cents) <= tol ? cssVar('--good') : cents > 0 ? cssVar('--sharp') : cssVar('--flat');
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

  const freqEl = h('div', { class: 'tuner-meta' }, h('span', null, 'Play a note to begin'));
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
  let pendingTend: Tendencies = {};
  let pendingCount = 0;
  const tendBars = h('div', { class: 'tend-bars' });
  const tendCaption = h('span', { class: 'muted small' });
  const tendPanel = h(
    'div',
    { class: 'trace-wrap tendencies' },
    h('div', { class: 'trace-label' }, h('span', null, 'Your tendencies'), tendCaption),
    tendBars,
    tendTable,
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
    const detail = (pc: number) => {
      const st = byPc.get(pc);
      const name = prettyName(noteName(pc, s.flats, false));
      return st ? `${name}: ${formatCents(st.mean)} average, ±${st.spread.toFixed(1)}¢ spread, ${st.count} readings` : `${name}: not enough readings yet`;
    };
    tendCaption.textContent = selectedTend !== null ? detail(selectedTend) : stats.length ? 'average cents per note, all sessions. Tap a note for details' : 'Play for a while to see which notes you tend to play sharp or flat';
    // The same numbers as a table for screen readers.
    tendTable.replaceChildren(
      h('caption', null, 'Your tendencies, all sessions'),
      h('tr', null, h('th', null, 'Note'), h('th', null, 'Average'), h('th', null, 'Spread'), h('th', null, 'Readings')),
      ...stats.map((st) => h('tr', null, h('td', null, prettyName(noteName(st.pitchClass, s.flats, false))), h('td', null, formatCents(st.mean)), h('td', null, `±${st.spread.toFixed(1)}¢`), h('td', null, String(st.count)))),
    );
    tendBars.replaceChildren(
      ...Array.from({ length: 12 }, (_, pc) => {
        const st = byPc.get(pc);
        const mean = st ? Math.max(-25, Math.min(25, st.mean)) : 0;
        const cls = !st ? 'none' : Math.abs(st.mean) <= s.tolerance ? 'good' : st.mean > 0 ? 'sharp' : 'flat';
        return h(
          'button',
          {
            class: `tend ${cls}${selectedTend === pc ? ' on' : ''}`,
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
      startBtn.textContent = 'Start';
      startBtn.setAttribute('aria-pressed', 'false');
      hint.textContent = 'Tap to start';
      freqEl.replaceChildren(h('span', null, 'Paused'));
      return;
    }
    try {
      await tracker.start();
      if (!tracker.running) return;
      shownAt = null;
      clearStale();
      phaseStrobe.reset();
      strobeFrameTime = null;
      timer.start();
      root.querySelector('.tuner')?.classList.add('listening');
      startBtn.textContent = 'Stop';
      startBtn.setAttribute('aria-pressed', 'true');
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
    if (s.tunerDisplay === 'strobe') {
      const estimate = strobeFrameTime === null ? 0 : (f.time - strobeFrameTime) * f.sampleRate;
      strobeFrameTime = f.time;
      // Clicks and held frames would disturb the phase; the clock still advances.
      drawStrobe(phaseStrobe.update(f.samples, f.sampleRate, cents !== null && !f.gated && !held ? target : null, estimate), cents);
    } else {
      strobeFrameTime = null;
    }
    history.push({ t: f.time, cents });
    while (history.length && f.time - history[0].t > HISTORY_SECONDS) history.shift();

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

    if (displayMidi === null || cents === null) {
      if (s.keepLastNote && shownAt !== null) {
        // Leave the last reading up, greyed, with its age.
        root.querySelector('.tuner')?.classList.add('stale');
        agoEl.hidden = false;
        const ago = agoText((nowMs - shownAt) / 1000);
        if (agoEl.textContent !== ago) agoEl.textContent = ago;
        drawTrace();
        return;
      }
      clearStale();
      ring.update({ pitchClass: null, cents: 0, inTune: false, hold: 0 }, s.tolerance, s.flats, range);
      root.querySelector('.tuner')?.classList.remove('has-note');
      barNeedle.style.left = '50%';
      drawTrace();
      return;
    }

    root.querySelector('.tuner')?.classList.add('has-note');
    clearStale();
    shownAt = nowMs;
    const pretty = prettyName(noteName(displayMidi, s.flats, false));
    const accidental = pretty.match(/[♯♭]/)?.[0] ?? '';
    noteEl.textContent = pretty.replace(accidental, '');
    noteEl.classList.toggle('long', noteEl.textContent.length > 1);
    accidentalEl.textContent = accidental;
    octaveEl.textContent = String(Math.floor(displayMidi / 12) - 1);
    // Words as well as colour, so the state reads without relying on colour vision.
    const decimals = useDecimalCents(s.decimalCents, s.tolerance);
    const direction = centsText(cents, decimals);
    // The number stays next to "in tune", so fine work can still see it.
    centsEl.textContent = hint ?? (inTune ? `${signedCents(cents, decimals)} in tune` : direction);
    barNote.textContent = `${pretty}${Math.floor(displayMidi / 12) - 1}`;
    barCents.textContent = hint ?? (inTune ? `${signedCents(cents, decimals)} in tune` : direction);
    if (!held) announce(`${pretty.replace('♯', ' sharp').replace('♭', ' flat')}, ${hint ?? (inTune ? 'in tune' : direction.replace('¢', ' cents'))}`);
    strobeNote.textContent = barNote.textContent;
    strobeCents.textContent = barCents.textContent;
    barNeedle.style.left = `${centsToPercent(cents, range)}%`;
    barMeter.classList.toggle('good', inTune);

    ring.update({ pitchClass: ((displayMidi % 12) + 12) % 12, cents, inTune, hold }, s.tolerance, s.flats, range);
    const stage = root.querySelector('.tuner');
    stage?.classList.toggle('in-tune', inTune);
    stage?.classList.toggle('sharp', !inTune && cents > 0);
    stage?.classList.toggle('flat', !inTune && cents < 0);
    if (!held) {
      lastTarget = target;
      refBtn.disabled = false;
    }
    freqEl.replaceChildren(
      h('span', null, h('b', null, formatHz(f.frequency!)), ' Hz'),
      h('span', { class: 'sep' }),
      h('span', null, 'target ', h('b', null, formatHz(target)), ' Hz'),
    );
    drawTrace();
  });

  function clearStale() {
    root.querySelector('.tuner')?.classList.remove('stale');
    agoEl.hidden = true;
  }

  function placeBarZone(tolerance: number) {
    const left = `${centsToPercent(-tolerance, range)}%`;
    const width = `${centsToPercent(tolerance, range) - centsToPercent(-tolerance, range)}%`;
    if (barZone.style.left !== left) barZone.style.left = left;
    if (barZone.style.width !== width) barZone.style.width = width;
  }

  function drawTrace() {
    const ctx = fitCanvas(trace);
    const w = trace.clientWidth;
    const hh = trace.clientHeight;
    ctx.clearRect(0, 0, w, hh);
    const tol = getSettings().tolerance;
    const y = (c: number) => centsToY(c, range, hh);
    ctx.fillStyle = cssVar('--good-soft');
    ctx.fillRect(0, y(Math.max(tol, 1)), w, y(-Math.max(tol, 1)) - y(Math.max(tol, 1)));
    if (performance.now() - traceTextAt > 1000) {
      traceTextAt = performance.now();
      const text = traceSummary(history, tol, HISTORY_SECONDS);
      if (traceText.textContent !== text) traceText.textContent = text;
    }
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
      const c = Math.max(-range, Math.min(range, p.cents));
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
    h('div', { class: 'meta-row' }, startBtn, freqEl, agoEl, refBadge, refBtn),
    errorSlot,
    noticeSlot,
    clickNotice,
    h('div', { class: 'trace-wrap' }, h('div', { class: 'trace-label' }, h('span', null, 'Last 10 seconds'), h('span', { class: 'muted' }, 'sharp ↑  flat ↓')), trace, traceText),
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
    // Only reset the display when idle; settings also change while tuning (e.g. saving tendencies).
    if (!tracker.running && !root.querySelector('.tuner.stale')) ring.update({ pitchClass: null, cents: 0, inTune: false, hold: 0 }, s.tolerance, s.flats, range);
    tendPanel.hidden = s.tunerMode !== 'chromatic';
    renderTendencies();
    drawTrace();
    if (s.tunerDisplay === 'strobe') drawStrobe(null, null);
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
