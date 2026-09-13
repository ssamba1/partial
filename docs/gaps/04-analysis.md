# Analysis

This file lists 111 gaps. I ran out of real ones there, and the rest would have been padding. Nothing overlaps the 78 items in `C:\Users\Sri\TE\docs\gap-analysis.md`. Where an item sits next to one of them, I name the number and say what's different.

The eight most urgent are the first eight: correctness bugs in the Analysis screen itself. The frozen-view bug, the held-readings bug and the missing transposition show wrong data today.

Evidence labels: file:line is code I read this session. [unverified] marks competitor features and standards details I recalled but didn't look up. Formulas are standard DSP. The colour luminance numbers are my own hand calculation, not a tool's output.

### Frozen Spectrum, Harmonics and Wave views redraw live audio
Evidence: `analysis.ts:111` keeps `lastSamples = f.samples` without copying. `pitchTracker.ts:15` says the buffer is reused ("copy if you keep it"), and `pitchTracker.ts:93` refills it every frame while the tracker keeps running. So after Freeze, switching tabs (`setTab` to `draw`) or resizing draws the current mic buffer, while `lastF0` stays frozen. The harmonic markers then don't match the spectrum.
Fix: in the `onFrame` handler keep a private `Float32Array` and `copy.set(f.samples)`, and draw only from the copy. Test: e2e freezes on a 220 Hz tone, switches the synthetic mic to 330 Hz, changes tab, and checks the spectrum peak is still at the 220 Hz bin.
Effort: S

### Held readings are stored as real pitch data
Evidence: `analysis.ts:109` skips only `f.gated`. `pitchTracker.ts:122-124` re-emits the last note for 150, 350 or 700 ms after the sound stops, with `held = true`. The pitch trace grows a flat tail, staff durations stretch, intervals mis-segment, and the in-tune % counts fake frames.
Fix: `if (!f.gated && !f.held) push(...)`, and push `midi: null` when held. Test: a unit test on a frame stream with a 400 ms dropout has no points in the dropout.
Effort: S

### Analysis plots the tuner's smoothed pitch, not the measured pitch
Evidence: `pitchTracker.ts:110` median-filters the frequency (3, 5 or 9 frames, set by the tuner's steadiness setting, `pitchTracker.ts:7-11`) before `frequencyToNote`. Analysis only gets smoothed values, so onsets lag, vibrato gets flattened and short notes vanish, depending on a setting from a different screen.
Fix: add `rawFrequency` and `rawNote` (computed from `result.frequency`) to `TrackerFrame`. Analysis uses the raw values, with its own optional smoothing toggle. Test: a 5.5 Hz, ±30 cent vibrato fed through the tracker keeps at least 90% of its peak-to-peak width in `points` with "slow" damping.
Effort: S

### Analysis ignores the transposition setting
Evidence: `tuner.ts:384-405` shows written pitch via `transpose(f.note.midi, semis)`. `analysis.ts:117`, `:218` and `:302` use concert `f.note.midi` and import no transposition. A B-flat trumpeter sees different note names on Tuner and Analysis.
Fix: shared `displayMidi(midi, settings)` helper used by the stat strip, pitch axis labels, `staffNote` and interval note names, plus a "Written / Concert" chip on the Analysis toolbar. Test: with B-flat set, a concert C4 shows as D4 on the staff.
Effort: S

### Stat strip keeps showing the last note after silence
Evidence: `analysis.ts:116-121` only updates note, cents and Hz when `f.note` exists, and never clears them or the colour class. `tuneStat` (`analysis.ts:123`) freezes when there are 10 or fewer voiced points.
Fix: an else branch resets to "·" and removes the class. Show "·" for in-tune when there aren't enough voiced points.
Effort: S

### Frequency readout has no unit and too little precision for low notes
Evidence: `analysis.ts:44` labels it "Frequency" and `:119` prints `toFixed(1)` with no "Hz". At 41.2 Hz a 0.1 Hz step is 1200·log2(41.3/41.2) ≈ 4.2 cents, coarser than the cents readout next to it.
Fix: append " Hz", and use `toFixed(2)` below 100 Hz.
Effort: S

### Frame timestamps are the end of the analysis window, not its centre
Evidence: `pitchTracker.ts:130` stamps `ctx.currentTime`, but the frame covers the previous 4096 samples (`pitchTracker.ts:83`): 85 ms at 48 kHz. Offline takes are stamped at the frame centre (`intonation.ts:69`), so live and recorded timelines disagree by about 43 ms. Rhythm analysis against the metronome would inherit that bias.
Fix: `time = ctx.currentTime - fftSize / (2 * sampleRate) - (ctx.baseLatency ?? 0)`. Keep `audioTime` separately for gating. Test: a unit test checks a synthetic onset lands within 5 ms of the true time.
Effort: S

### Metronome gate is shorter than the analysis frame
Evidence: `gestures.ts:31` gates from 10 ms before to 80 ms after a click, but the analyser frame is 85.3 ms at 48 kHz and 92.9 ms at 44.1 kHz (4096 samples). Frames from 80 to 93 ms after a click still contain its attack. Item 45 is about measuring and shortening the window. This is the opposite problem: the window can't cover the frame.
Fix: `after = fftSize / sampleRate + clickDecay(sound)` and `before = 0.01 + outputLatency`. Pass fftSize and sampleRate from `createTracker`. Unit test: the gate stays on for any frame whose window overlaps a click.
Effort: S

### No marker where frames were gated out
Evidence: gated frames push nothing (`analysis.ts:109`), so the pitch trace simply breaks. With a subdivided metronome, users can read the gaps as detection failures.
Fix: store `{t, gated: true}` points and draw a faint tick along the bottom axis at each one. The caption explains the ticks when any exist.
Effort: S

### The 10k spectrum label is drawn off the canvas
Evidence: `analysis.ts:330-332` maps fMax to x = w. For 10000 (any sample rate at or above 20 kHz), `fillText` runs at `x + 3` (`analysis.ts:344`), past the right edge.
Fix: reserve right and bottom margins in `xOf` (`w - 28`), and right-align the last label.
Effort: S

### Spectrum has no dB axis and a fixed -100 to 0 range
Evidence: `analysis.ts:333` clamps to -100..0 dBFS with no gridlines or numbers. Quiet signals squash into the bottom third.
Fix: horizontal gridlines every 20 dB with labels in a 36 px left gutter, an auto-range button (top = max peak + 6 dB, floor = top − 80 dB), and a "dBFS" label.
Effort: S

### Pitch chart has no time axis
Evidence: `analysis.ts:224` maps 12 s onto the width with no ticks, and the caption states the span only as text.
Fix: vertical ticks every 2 s labelled "-10s ... now" along the bottom, and rescale the tick step with zoom (see the zoom item).
Effort: S

### Pitch chart range jumps on every note change and draws notes off the chart
Evidence: `analysis.ts:195-197` centres ±6 semitones on the latest voiced MIDI note, so a new note shifts the whole grid. Earlier notes more than 6 semitones away plot beyond `hh` or over the label gutter, with no clipping.
Fix: fit the range to the min and max of the visible voiced points ±1 semitone (at least 7 semitones span), and ease changes over 300 ms. Clip with `ctx.rect(left, 0, w-left, hh); ctx.clip()`.
Effort: S

### Cents detail is unreadable on the pitch chart
Evidence: 12 semitones over a canvas at most 420 px tall (`styles.css:2649`, `analysis.ts:198`) gives about 35 px per 100 cents. A 5 cent error is under 2 px, hidden under a 3 px line (`analysis.ts:221`). Tunable's pitch history has a cents-scale view [unverified].
Fix: a "Cents" mode that plots `p.cents` on a ±50 scale, gridlines at ±tolerance, ±10 and ±25, note names as segment labels, and a 1.5 px line. Toggle on the chart.
Effort: S

### In-tune band only shows around the current note
Evidence: `analysis.ts:204-209` shades only the latest note's row, so earlier notes in the 12 s history have no band to judge against.
Fix: draw the band per held-note segment (from `segmentNotes`) across that segment's time span.
Effort: S

### Pitch trace and staff show intonation by colour alone
Evidence: `analysis.ts:186-189`, `:230` and `:314`. The README says states appear "in words and arrows as well as colour" for the tuner only (README:19).
Fix: dashed stroke `[6,3]` for sharp and dotted `[2,3]` for flat on the pitch trace. On the staff, a "+12" or "-8" cents label under each note head and ▲ or ▼ glyphs. Test: a screenshot in grayscale still separates the three states.
Effort: S

### "In tune" green and "sharp" orange have almost the same luminance
Evidence: light theme `--good #0a7d55` and `--sharp #b45309` (`styles.css:21`, `:23`). My hand WCAG calculation gives relative luminance 0.154 versus 0.159, a contrast of about 1.03:1. People with red-green colour vision deficiency lean on lightness, so they may not tell these apart. The CVD confusion itself is unverified; I didn't run a simulator.
Fix: test script converts each pair through the Machado 2009 deuteranopia and protanopia matrices and asserts CIEDE2000 above 20. Adjust `--sharp` lightness (or use an orange / blue / near-black-with-pattern scheme) until it passes, in both themes.
Effort: S

### getComputedStyle is called for every point on every frame
Evidence: `colorFor` (`analysis.ts:186-189`) calls `cssVar` (`dom.ts:87-89`, `getComputedStyle`) up to three times per voiced point inside the draw loop (`analysis.ts:230`). That's up to 720 points × 60 fps, plus more per grid line and harmonic bar.
Fix: resolve a `palette` object once per draw, or cache it and invalidate on theme change with a `MutationObserver` on `documentElement` attributes and `matchMedia('(prefers-color-scheme)')`. Measure frame time before and after in the performance panel.
Effort: S

### History is rescanned and shifted in O(n) every frame
Evidence: `analysis.ts:110` (`points.shift()` in a loop), `:122`, `:192` and `:253` (three full `filter` passes per frame), and `:132` (`segmentNotes` over all points every frame on the Intervals tab).
Fix: a ring buffer (preallocated typed arrays t, midi, cents, clarity, rms), running voiced and in-tune counters updated on push and evict, and a segmented-note cache extended incrementally.
Effort: M

### Spectrum allocates buffers and recomputes the window every frame
Evidence: `spectrum.ts:40-44` allocates two `Float64Array(n)` and recomputes Hann coefficients each call. `drawSpectrum` runs at 60 fps (`analysis.ts:173`). The Harmonics tab repeats it (`analysis.ts:387`).
Fix: cache the window, re, im and out per n in module scope, like `pitch.ts:25-26` does. Or read `AnalyserNode.getFloatFrequencyData` (browser-side FFT) when the window choice allows it.
Effort: S

### Harmonic levels leak from neighbouring partials on low notes
Evidence: `harmonicLevels` takes the max within ±2 bins (`spectrum.ts:69-72`). The bin width is 48000/4096 = 11.72 Hz. For E1 (41.2 Hz) partials are 3.5 bins apart, so the ±2 search windows overlap and the Hann skirt of the neighbour can win. The test covers only f0 = 220 Hz (`tests/spectrum.test.ts:22`).
Fix: search radius = `min(2, floor(0.5 * f0 / binHz) - 1)`, require a local maximum, and use an 8192 or 16384 frame when f0 < 100 Hz. Test: a harmonic series at 41.2 Hz with a known −20 dB 3rd partial reads within 1 dB.
Effort: S

### Harmonic levels carry Hann scalloping error
Evidence: `spectrum.ts:72` uses the raw maximum bin. A partial halfway between bins reads low (about 1.4 dB for Hann by my recollection, unverified here). The test only uses a bin-centred sine (`tests/spectrum.test.ts:5`).
Fix: quadratic interpolation on dB values α, β, γ around the peak bin: `p = 0.5(α−γ)/(α−2β+γ)`, `peak = β − 0.25(α−γ)p`, and frequency `(k+p)·binHz`. Test: a sine at bin 100.5 reads within 0.3 dB of 0 dBFS.
Effort: S

### Harmonic analysis assumes exact integer multiples
Evidence: `spectrum.ts:68` and `analysis.ts:349` place partials at `f0 * h`. Piano and string partials are stretched (roughly `f_k = k·f0·sqrt(1 + B·k²)`), so higher partials drift outside the ±2 bin window.
Fix: track each partial by peak search near the previous partial's measured ratio. Report measured frequency, deviation in cents from `k·f0`, and a least-squares estimate of B. Test: a synthetic stretched series with B = 0.0004 recovers B within 10%.
Effort: M

### Harmonic bars clip silently when the fundamental is weak
Evidence: `analysis.ts:388` references the fundamental and `:394` clamps to −60..+12 dB. Instruments with a weak fundamental (low brass, bassoon, voice) pin several bars at +12 with no sign of clipping.
Fix: reference the strongest partial (0 dB at top), mark clipped bars with an arrow cap, and put "dB" on the value labels.
Effort: S

### Harmonic bars: no dB unit, no fundamental value, fixed count of 12
Evidence: `analysis.ts:409` labels only `i > 0` with bare numbers. `:387` hardcodes 12 partials, so low notes hide useful partials and high notes stop at Nyquist without saying so.
Fix: label "0 dB" on the reference and "−18 dB" style elsewhere. Partial count = `min(32, floor(0.45·fs / f0))`, with a note when it's limited by Nyquist.
Effort: S

### Harmonic and spectrum views flicker from single-frame analysis
Evidence: `analysis.ts:173` and `:387` analyse one 85 ms frame per animation frame, with no averaging or peak hold.
Fix: per-bin power averaging `P̄ = a·P̄ + (1−a)·P` with `a = exp(−Δt/τ)`, τ selectable (0, 0.25, 1 s). For harmonics, reset the average on note change so each note gets its own profile. Add a peak-hold trace that decays 20 dB/s.
Effort: S

### Waveform trigger is unstable
Evidence: `analysis.ts:420-426` triggers on the first raw negative-to-positive crossing. Harmonic-rich tones cross zero several times per period, noise adds false crossings, and a DC offset can remove crossings altogether. The display then jumps instead of "standing still" as the caption claims (`analysis.ts:72`).
Fix: DC-block `y[n] = x[n] − x[n−1] + 0.995·y[n−1]`. When f0 is known, choose the start in [0, T) that maximises correlation with the previously displayed cycle (T = fs/f0). Otherwise use a hysteresis trigger (cross −0.1·peak, then +0.1·peak).
Effort: S

### Waveform shows a fixed 1600 samples regardless of pitch
Evidence: `analysis.ts:427`: 33 ms at 48 kHz is 1.4 cycles of E1 but 70 cycles of A5. Item 23 adds a manual timespan; this is automatic cycle framing.
Fix: default span = 3·fs/f0 clamped to [256, frame length − start], with an "Auto cycles / Manual" toggle alongside item 23's slider.
Effort: S

### No input level meter or clipping warning
Evidence: `f.level` (`pitchTracker.ts:101`) is never shown in Analysis. The waveform auto-normalises (`analysis.ts:428-429`), so a clipped mic looks normal. Clipping creates false harmonics in the Spectrum and Harmonics views.
Fix: a thin meter in the stat strip (dBFS = 20·log10(rms), plus sample peak). Red "Clipping" chip when any |x| ≥ 0.99 in the last 500 ms, and a warning text on the Harmonics tab.
Effort: S

### No noise floor or signal-to-noise indicator
Evidence: nothing estimates room noise, yet spectrum, harmonic and clarity readings all depend on it.
Fix: running 10th percentile of RMS over unvoiced frames = noise floor. SNR = 20·log10(rms_voiced / floor). Show it on the meter, and grey out timbre metrics when SNR < 20 dB.
Effort: S

### Staff clef glyph depends on fonts the app doesn't ship
Evidence: `analysis.ts:284` asks for "Noto Music", "Bravura", "Segoe UI Symbol". package.json only bundles Inter and Space Grotesk, and there is no @font-face for a music font. On devices without these fonts, U+1D11E and U+1D122 can render as boxes.
Fix: draw the treble and bass clefs as `Path2D` from SVG path data, or bundle a SMuFL font subset after confirming its licence.
Effort: S

### Auto clef flips back and forth
Evidence: `analysis.ts:266-267` re-chooses the clef every frame from the median of visible notes, with a hard threshold at MIDI 57 (`staff.ts:24-26`). A melody around A3 redraws the whole staff between clefs. Item 26 adds a clef selector; this is the auto mode's stability.
Fix: hysteresis. Switch to bass only when the median < 55 for 2 s, and back to treble when > 59 for 2 s.
Effort: S

### Staff spelling ignores key
Evidence: `staff.ts:6-11` and `:29` pick sharps or flats from a global `flats` flag. In F major a B-flat shows as A-sharp unless flats is on globally, and there's no key signature.
Fix: a key setting (or detected key, see key detection below) that spells by line of fifths. Draw the key signature after the clef, and show accidentals only where a note differs from the key, with courtesy naturals. Unit test spellings in C, F, D, B-flat and E major.
Effort: M

### Staff has no rhythm values or bar lines
Evidence: `analysis.ts:313-320` draws a duration bar and a head, with no note values and no bars, even when the metronome is running.
Fix: when `metronome.playing`, quantise note start and end to the metronome grid: beats = Δt·bpm/60, rounded to 1/subdivision. Bar lines at bar starts from `recentClicks` and the accent pattern; note heads and flags (or beams) by quantised value.
Effort: L

### Three different note segmentation rules in one screen
Evidence: the staff uses a 0.08 s minimum and 0.15 s gap (`analysis.ts:258`, `:265`). Intervals use a 0.3 s minimum (`analysis.ts:132`). Take reports use 0.25 s (`intonation.ts:91`). The same playing yields different note lists per tab.
Fix: one `SEGMENT` config in `intonation.ts` used by the staff, intervals and `analyzeTake`. The staff calls `segmentNotes` instead of its own loop.
Effort: S

### Out-of-tune notes near ±50 cents get split up and dropped
Evidence: `segmentNotes` starts a new note whenever `r.midi !== cur.midi` (`intonation.ts:114`). A note wobbling around 50 cents flips MIDI and breaks into fragments under `minSeconds`, which `flush` discards (`intonation.ts:101`). The worst intonation disappears from take reports and the interval list, biasing toward in tune.
Fix: segment on continuous pitch `p = midi + cents/100`. Start a new note only when |p − running median| > 0.7 semitone for 3 or more consecutive readings. Assign midi = round(median). Test: a tone at +48 ± 5 cents jitter for 1 s yields one note with meanCents near 48.
Effort: S

### Held-note mean includes the scoop and the release
Evidence: `intonation.ts:108` averages all points. A 100 ms scoop from −40 cents shifts the mean of a 0.5 s note by about 8 cents. This feeds the interval deviations (`analysis.ts:138`) and take reports.
Fix: `meanCents` = median of the middle 60% of points, or of points where the frame-to-frame change is under 3 cents. Keep `onsetCents` and `releaseCents` as separate fields. Test with a synthetic scoop.
Effort: S

### Latest interval reading freezes while the note continues
Evidence: the cache key uses only `midi:start` (`analysis.ts:133-134`), so the row for the currently held note keeps the `meanCents` it had at 0.3 s.
Fix: include `end.toFixed(1)` and `meanCents.toFixed(0)` for the last note in the key, or re-render only the latest row each 200 ms.
Effort: S

### Intervals pair notes across long rests
Evidence: `analysis.ts:139` pairs consecutive held notes regardless of the gap. Notes 10 s apart count as an interval, which says nothing about intonation.
Fix: skip pairs where `b.start − a.end > maxRest` (default 1.5 s, adjustable), and show an "after rest" separator instead.
Effort: S

### Only one just ratio per interval
Evidence: `intervals.ts:12-24` fixes m7 = 9:5, M2 = 9:8, m2 = 16:15, TT = 45:32. Players also use 16:9 or 7:4 for the minor seventh, 10:9 for the major second and 64:45 for the tritone, depending on context.
Fix: `just: [n,d][]` alternatives. Show the nearest alternative and its cents, with a preference setting. Unit test every ratio's cents.
Effort: S

### Interval rows don't compare with the selected temperament
Evidence: rows show "vs equal" and "vs just" only (`analysis.ts:154-155`), although the app supports Pythagorean, meantone and well temperaments (`notes.ts:81-89`).
Fix: a third column "vs <temperament>": expected = (temperament cents of pitch class b − that of a) + 1200·octaves, from `TEMPERAMENT_CENTS` relative to the tonic.
Effort: S

### No interval reading against a sounding drone
Evidence: `readInterval` is only used between consecutive played notes (`analysis.ts:139-147`). Just intonation practice is mostly tuning against a drone, and the drone bank already knows its active notes (`main.ts:172`, `activeNotes()`).
Fix: when drones are on, a live row "vs drone <note>": `readInterval(droneHz, playedHz)` updated every 100 ms, with a large vs-just readout.
Effort: S

### Beat rate between played note and drone isn't shown
Evidence: nothing computes beats, yet players tune just intervals by removing beats.
Fix: for the nearest ratio p:q (f2/f1 ≈ p/q), the coinciding partials beat at `|q·f2 − p·f1|` Hz. Show "beating 1.8 Hz" and a pulsing bar at that rate, with a unit test for a 2 cent wide fifth at 220 Hz.
Effort: S

### The "interval trainer" is passive
Evidence: README:54-55 calls it an interval trainer, but `renderIntervals` (`analysis.ts:131-159`) only reports what was played. There are no targets, prompts or scores.
Fix: a Trainer mode. Pick a target (interval, direction, just or equal), play the first note via the drone bank, the user plays the second, score |cents error|, keep streaks, then move on. Deterministic seed for tests. E2E with the synthetic mic.
Effort: M

### No per-interval statistics
Evidence: rows are transient (`analysis.ts:139`, last six only). Nothing aggregates "your ascending major thirds average +9 cents".
Fix: accumulate `NoteStat` keyed `${short}${direction}` (the same `addReading` math as `intonation.ts:20-24`), persist like tendencies, and add a sortable table under the list.
Effort: S

### Ambiguous intervals are forced to the nearest semitone
Evidence: `intervals.ts:44` rounds played cents, so 349 cents reads "Minor third +49", 351 reads "Major third −49".
Fix: when |vsEqual| > 35, label "between m3 and M3" and show both deviations.
Effort: S

### Interval list shows six rows with no history
Evidence: `analysis.ts:139` uses `notes.slice(-7)`, within a 12 s window.
Fix: keep the session's intervals in a bounded array (500), make the list scrollable, and add a Clear button.
Effort: S

### Empty and waiting states are wrong or missing
Evidence: Harmonics says "Start listening to see your sound" even while listening with no pitch (`analysis.ts:386`). The pitch chart with only unvoiced points draws an unlabelled grid around C4 (`analysis.ts:195`). The staff shows a blank staff when points exist but no notes pass the filter (`analysis.ts:290`). The interval empty state doesn't mention starting the mic.
Fix: states per tab. Not listening: "Start listening". Listening with no pitch: "Play a steady note". Pitch present but too short: "Hold notes a little longer".
Effort: S

### Staff ledger lines span the whole duration bar
Evidence: `analysis.ts:307-311` draws ledgers from `x − len` to `x + gap·0.4`, so long high notes show long ledger stripes.
Fix: draw ledgers only across the note head (`headX ± gap·0.9`).
Effort: S

### Staff has no octave shift for extreme notes
Evidence: `staff.ts:33-34` emits every ledger. A piccolo C7 needs 6 or more ledgers, and pedal tones below the bass staff pile up too.
Fix: when position > 13 or < −5, draw 8va or 8vb brackets (15ma past 20 or −12) and shift the position by 7 or 14. Unit tests.
Effort: S

### No export of the captured notes as MIDI or MusicXML
Evidence: the staff is canvas-only (`analysis.ts:252-326`).
Fix: `core/midiFile.ts` writes SMF type 0 (header MThd, one MTrk, delta times from quantised starts, note on and off, pitch bend from mean cents at 8192/200 per cent for a ±2 semitone range). Plus a minimal MusicXML writer. Download or share button. Unit test by byte comparison against a hand-built file.
Effort: M

### No spectrogram or sonogram view
Evidence: the tabs are fixed at six (`analysis.ts:16`). Spectroid, n-Track, Sonic Visualiser and Praat all show one [unverified].
Fix: a "Sonogram" tab. Each frame, compute the magnitude spectrum, map bins to log-frequency rows, colour via a 256-entry viridis or magma lookup (perceptually ordered and CVD-safe), write a 1 px column into an offscreen canvas, and blit-scroll it. dB floor and ceiling sliders. The history length matches the pitch window.
Effort: M

### No pitch trace over the spectrogram
Evidence: no combined view. Sonic Visualiser and Praat overlay f0 on the spectrogram [unverified].
Fix: in the Sonogram tab, draw the voiced points as a line at `yOfFreq(f0)` with the intonation colour and pattern, plus optional harmonic lines at k·f0.
Effort: S

### FFT size is fixed and frequency resolution is never shown
Evidence: the analyser is fixed at 4096 (`pitchTracker.ts:83`), giving 11.7 Hz bins at 48 kHz, which can't resolve partials of notes below about 50 Hz.
Fix: size choice 2048 to 32768 for spectrum and sonogram (separate from the pitch analyser). Show "Δf = fs/N Hz, window = N/fs ms" in the caption. Keep YIN's frame independent. Confirm AnalyserNode's maximum fftSize on MDN before offering sizes above 32768.
Effort: S

### No window function choice
Evidence: Hann is hardcoded (`spectrum.ts:43`).
Fix: window options Hann (general), Blackman-Harris 4-term (low leakage, for weak partials next to strong ones), flat-top (level accuracy), rectangular. Store coherent gain per window for the dBFS scaling, `scale = 2/(N·CG)`. Test each window gives 0 dBFS ± 0.1 for a bin-centred sine.
Effort: S

### No cursor readout on the spectrum
Evidence: no pointer handling beyond swipe and tap (`analysis.ts:443-455`).
Fix: on hover or drag, a crosshair showing frequency (from the inverse log map), nearest note plus cents from `frequencyToNote`, and interpolated dB. Drag must not trigger the tab swipe (use a dedicated two-finger or long-press mode on touch).
Effort: S

### No peak labels on the spectrum
Evidence: only dashed harmonic markers without labels (`analysis.ts:346-358`). Item 25 labels the Harmonics bars, not spectrum peaks.
Fix: find local maxima more than 12 dB above a 1/3-octave median-smoothed floor. Label the top 5 with frequency and note, and pull labels apart so they don't collide.
Effort: S

### Spectrum axis is fixed at log 30 Hz to 10 kHz
Evidence: `analysis.ts:329-332`. There's no linear mode, no zoom, and brightness above 10 kHz is hidden.
Fix: log or linear toggle, pinch or drag to zoom the frequency range (clamped to [fs/N, fs/2]), double-tap to reset, and fMax up to fs/2.
Effort: M

### No note-name axis on the spectrum
Evidence: tick labels are Hz only (`analysis.ts:335`).
Fix: optional piano strip under the x axis with C labels at `midiToFrequency(12·k, tuning)`. Highlight the key nearest the detected f0.
Effort: S

### No target frequency marker on the spectrum
Evidence: markers follow the detected f0 (`analysis.ts:346-357`) with no reference line for where the note should be.
Fix: a solid thin line at `f.note.target` (`notes.ts:126`) and its multiples. The gap between the dashed and solid lines shows the error (enlarge in zoom).
Effort: S

### No cepstrum view
Evidence: no cepstral analysis exists.
Fix: `c(q) = |FFT(log(|X(f)| + ε))|`. Plot quefrency 1/fMax to 1/fMin as "period ms" with an equivalent Hz axis, and mark the YIN period. It also gives a second opinion on octave errors (a view, not the detector change in item 46).
Effort: S

### No formant tracking for singers
Evidence: no LPC or formant code. Praat and several singing apps show F1 and F2 [unverified].
Fix: `core/formants.ts`. Low-pass and decimate to 10 kHz, pre-emphasis `y[n] = x[n] − 0.97·x[n−1]`, Hamming window 25 ms, LPC order 12 via autocorrelation plus Levinson-Durbin, polynomial roots (Durand-Kerner). Formant F = θ·fs/(2π), bandwidth B = −(fs/π)·ln|r|; keep F > 90 Hz with B < 400 Hz. Show F1 to F3 tracks. Unit test with a synthetic formant filter bank. Note that LPC is unreliable when f0 is above about 350 Hz (sopranos), and say so in the UI.
Effort: L

### No vowel chart
Evidence: nothing plots F1 against F2.
Fix: a chart with F2 on a reversed horizontal axis and F1 on a reversed vertical axis, a live dot and trail, and the user's own reference vowels captured by "record my /a/". Don't ship textbook vowel regions without citing a source for each voice type.
Effort: M

### No singer's formant or ring measurement
Evidence: no band-energy metrics.
Fix: live ratio of energy 2 to 4 kHz versus 0 to 2 kHz in dB (a singing-power-ratio style metric; look up the published definition and bands before naming it after one). Plot it over time next to the pitch.
Effort: S

### No spectral centroid or brightness trend
Evidence: harmonic bars only, and no scalar tone metrics.
Fix: centroid `C = Σ f_k·P_k / Σ P_k` over 50 Hz to 8 kHz, shown in Hz and as C/f0 ("harmonic brightness"). Plot it per note over time so players can see brightness change with dynamics.
Effort: S

### No breathiness or noise measure
Evidence: YIN clarity is computed (`pitch.ts:98`) but never shown in Analysis.
Fix: spectral flatness `SF = exp(mean(ln P)) / mean(P)` over 1 to 8 kHz, and harmonics-to-noise `HNR = 10·log10(r / (1 − r))` where r is the normalised autocorrelation peak at the period (the Boersma autocorrelation method; verify the citation before quoting). Plot both per held note.
Effort: M

### No tristimulus or odd/even harmonic balance
Evidence: `harmonicLevels` returns raw levels only (`spectrum.ts:64-76`).
Fix: tristimulus T1 = A1/ΣA, T2 = (A2+A3+A4)/ΣA, T3 = ΣA5..n/ΣA (linear amplitudes), and odd/even ratio = ΣA_odd(k≥3)/ΣA_even. A small ternary plot, which shows clarinet-like odd dominance, for example.
Effort: S

### No jitter or shimmer for voice
Evidence: no cycle-level analysis. Praat reports both [unverified].
Fix: extract glottal-cycle periods T_i by zero-crossing refined with the YIN period. Local jitter = mean|T_i − T_{i+1}| / mean T. Shimmer in dB = mean|20·log10(A_{i+1}/A_i)|. Only on held notes longer than 0.5 s with SNR above 25 dB. Unit test with synthetic 1% jitter.
Effort: M

### No attack time measurement
Evidence: nothing measures articulation onset quality.
Fix: RMS envelope at a 5 ms hop. Attack time = t(90% of the note's peak) − t(10%). Pitch settle time = first time |cents − stableMean| ≤ tolerance for 50 ms after onset. Show both per note in a table and as markers on the pitch chart.
Effort: M

### Scoops and end drift aren't shown live
Evidence: `HeldNote.drift` exists (`intonation.ts:83`, `:109`) but Analysis never shows it. Scoop direction isn't computed.
Fix: an `onsetCents` field (median of the first 80 ms) plus drift. On the pitch chart, draw a small ↗ or ↘ glyph and "+14" beside notes whose |onset − mean| > 15 or |drift| > 10 cents.
Effort: S

### No dynamics graph
Evidence: `f.level` is available (`pitchTracker.ts:101`, `:133`) but `Point` stores only t, midi and cents (`analysis.ts:18-22`).
Fix: store rms in `Point`. Draw a dB lane under the pitch chart (`20·log10(rms)`, −60 to 0 dBFS), shared time axis.
Effort: S

### No loudness in LUFS
Evidence: no weighting or loudness code.
Fix: K-weighting (two biquads) plus mean square over 400 ms (momentary) and 3 s (short-term): `L = −0.691 + 10·log10(z)`. Take the filter coefficients and constants from the ITU-R BS.1770 PDF itself (my recollection of them is unverified). Label it relative, since the mic is uncalibrated, with an optional SPL calibration offset entered from a meter.
Effort: M

### No crescendo or decrescendo smoothness measure
Evidence: nothing analyses level shape.
Fix: per held note, fit `dB(t) = a + b·t` by least squares. Report the slope b (dB/s) and residual standard deviation (unevenness). Flag swells whose residual is above 1.5 dB. A "messa di voce" mode fits two lines split at the maximum.
Effort: S

### No long-tone steadiness score
Evidence: tendencies give per-pitch-class spread across sessions (`intonation.ts:26-43`), not a per-long-tone pitch and level stability report.
Fix: for notes longer than 2 s, report pitch standard deviation (cents, after removing a vibrato-band component if item 44 lands), level standard deviation (dB) and drift. A long-tones card lists the last 10 with trend arrows.
Effort: S

### No vibrato graph over time
Evidence: item 44 uses vibrato only to steady the tuner's centre. Analysis has no per-note vibrato rate, width or regularity.
Fix: per held note, detrend cents with a 150 ms moving average. Rate from zero crossings, `rate = crossings / (2·duration)`. Extent = half the median peak-to-peak. Regularity = standard deviation of cycle periods / mean. Plot rate (Hz) and extent (cents) lanes, with a 4.5 to 6.5 Hz shaded guide band only if a pedagogy source is cited.
Effort: M

### No onset detection
Evidence: nothing detects note starts apart from pitch segmentation, which misses repeated notes on the same pitch.
Fix: spectral flux `SF(n) = Σ_k max(0, |X_n(k)| − |X_{n−1}(k)|)` on a 1024 frame with 256 hop (needs sample capture, see the capture item below). Adaptive threshold `median(SF[n−W..n+W]) + δ`, 50 ms refractory. Combine with pitch-change onsets for legato. Test on synthetic repeated notes.
Effort: M

### No rhythm accuracy against the metronome
Evidence: `metronome.recentClicks` stores scheduled click times (`metronome.ts:46`, `:74`) but only for gating (`shared.ts:42`).
Fix: for each onset, error = onset − nearest scheduled click (or subdivision), after subtracting input latency. Show a timeline of early and late ticks, a histogram, mean ± standard deviation in ms, and % within ±30 ms. Keep a longer click history than 24 entries.
Effort: M

### No input latency calibration for rhythm analysis
Evidence: item 50 calibrates output and tap latency, not the microphone path, which onset timing needs.
Fix: loopback test. Play 8 clicks, detect each in the mic by cross-correlating with the known click waveform, latency = median(detected − scheduled). Store it per input and output device pair. Warn when echo is too weak to measure.
Effort: S

### No articulation analysis
Evidence: none.
Fix: for consecutive onsets, articulation ratio = sounding duration / inter-onset interval (legato ≈ 1, staccato < 0.5), with sounding time where rms > peak − 20 dB. Show it per note and as an average against a chosen target ("staccato"). Include attack slope in dB/ms.
Effort: M

### No tempo tracking without the metronome
Evidence: nothing estimates the tempo of free playing.
Fix: BPM(t) = 60 / median(IOI over the last 8 onsets), with octave folding into 40 to 240. A lane graph shows rushing and dragging, and "tap to set the intended tempo" draws a reference line.
Effort: S

### No scoring against a target melody or score
Evidence: no import or alignment. Sing Sharp, Smule and KORG cortosia score against targets [unverified].
Fix: import MIDI (SMF parser) or MusicXML notes. Align the played pitch sequence to the score with DTW on cost `|p − s|` capped at 2 semitones plus onset proximity. Report per-note cents error, timing error, and missed or extra notes, with a coloured score view.
Effort: XL

### Playing isn't scored against the app's own exercises
Evidence: `src/core/exercises.ts` produces exact note sequences and the exercise player knows the tempo, but Analysis never compares against them.
Fix: while the exercise player runs, expected timeline = the exercise's notes × beat times. Match each detected held note within ±½ beat and report cents and ms error per note. An end-of-loop summary with the worst three notes.
Effort: M

### No pitch-matching trainer
Evidence: none. Sing-back pitch matching is common in singing apps [unverified].
Fix: play a random note in the user's range via `noteOn`, wait for a held note, and score cents error with a matching time limit. Adaptive difficulty narrows tolerance after 5 hits.
Effort: M

### No overall tone quality score
Evidence: none. KORG cortosia scores tone quality [unverified, including its method].
Fix: publish our own composite with stated weights. Pitch stability 40%, level stability 30%, timbre consistency 30% (1 − normalised standard deviation of spectral centroid). Show the parts next to the score and never claim equivalence to cortosia. Validate by checking that ratings from a few teachers track the score before calling it meaningful.
Effort: M

### No comparison between takes or against a reference recording
Evidence: item 24 compares frozen spectra; nothing overlays two pitch curves. The take report is per take only (`recorder.ts:335`).
Fix: pick two takes (or import a teacher's recording). Run `analyzeTake` on both, align by first onset or DTW on pitch, and overlay the curves in two colours with a dash pattern for the second. Show the per-note difference in cents and timing.
Effort: M

### Live pitch history can't scroll or zoom
Evidence: `WINDOW = 12` (`analysis.ts:14`) and data older than 12 s is discarded (`analysis.ts:110`). Tunable keeps a longer sustained history [unverified].
Fix: keep 10 minutes in the ring buffer. Pinch or wheel zooms the time range (2 s to 10 min), drag pans when frozen, a "live" button snaps back. Item 17 is timed events and reports, not browsing.
Effort: M

### No way to clear the history
Evidence: points survive stop and start within the session. There's no Clear button (`analysis.ts:466`).
Fix: a Clear button that empties the points and interval cache and resets the stat strip.
Effort: S

### Freeze throws data away
Evidence: `analysis.ts:108` returns early while frozen, so nothing played during a freeze is kept and resuming leaves a hole.
Fix: always collect. Frozen means the view stops following "now". Combined with pan, the user can study a moment while recording continues.
Effort: S

### Tapping the chart freezes it with no visible sign
Evidence: any pointer-up movement under 50 px toggles freeze (`analysis.ts:449-451`), including a mouse click. The only indicator is the button label below the chart.
Fix: a "Frozen" badge drawn in the chart corner. Require a 300 ms press on touch (or double-click with a mouse) to freeze, with a hint in the caption.
Effort: S

### Swipe handling breaks after a scroll gesture
Evidence: `touch-action: pan-y` (`styles.css:2650`) lets vertical scrolling fire `pointercancel`, which isn't handled (`analysis.ts:443-455`). `swipeX` stays set, so the next pointer-up computes dx from the old gesture and can switch tabs or freeze unexpectedly.
Fix: listen for `pointercancel` and `pointerleave` and reset `swipeX`. Also check vertical movement (ignore when |dy| > |dx|).
Effort: S

### No keyboard control in Analysis
Evidence: shortcuts cover Space start and stop only (`main.ts:127`). There's no key for freeze, tab changes, zoom or clear.
Fix: F to freeze, ← and → to change tab, + and − to zoom time, C to clear. Add them to the shortcuts sheet.
Effort: S

### Chart has no text alternative
Evidence: `aria-label: 'Analysis chart'` is static (`analysis.ts:34`), so a screen reader gets nothing about the content.
Fix: `role="img"` plus `aria-describedby` pointing at a visually hidden summary updated once a second ("Last 12 seconds: 8 notes, 62% in tune, tending 6 cents sharp; latest A4 +3"). For the spectrum: "strongest partials 1, 2, 4". Add a "data table" toggle.
Effort: S

### Chart doesn't redraw on theme change or container resize
Evidence: only `window` resize triggers `draw` (`analysis.ts:470-471`), and drawing otherwise happens only on tracker frames. After Stop, switching theme leaves old colours, and a layout change without a window resize leaves a stretched bitmap.
Fix: `ResizeObserver` on `.chart-card` plus a theme-change listener (same observer as the palette cache item) calling `draw()`.
Effort: S

### Selected tab isn't remembered
Evidence: `setTab('pitch')` runs on every mount (`analysis.ts:469`).
Fix: store `analysisTab` in settings and restore it on mount.
Effort: S

### No choice of input device
Evidence: `getUserMedia` uses the default device only (`context.ts:45`). Analysing a USB interface or external mic needs a picker.
Fix: `enumerateDevices()` after permission. A selector in the Analysis toolbar passes `deviceId: { exact }`, remembers the choice by label, and handles `devicechange`.
Effort: S

### Capture depends on requestAnimationFrame, so frames get lost
Evidence: analysis reads the analyser once per animation frame (`pitchTracker.ts:90-93`, `:142`). Throttled, busy or background tabs lose data and the hop varies with display refresh rate. Item 53 raises AudioWorklet for battery; this is about data completeness for timing analysis.
Fix: an AudioWorklet posts fixed hops (e.g. 512 samples) with exact sample-frame timestamps into a SharedArrayBuffer or port. Analysis consumes all hops, and the display renders at its own rate. Test: a simulated 30 fps render loses no readings.
Effort: L

### Fast passages blur in the 85 ms analysis window
Evidence: fixed 4096 frame (`pitchTracker.ts:46`, `:83`) plus median smoothing. A sixteenth note at 160 BPM lasts 94 ms, so neighbouring notes share frames.
Fix: adaptive frame for analysis. `frame = max(2·maxTau_needed, 1024)` where maxTau follows the last detected note (fs/(0.7·f0)), falling back to 4096 when no note is present. Test a synthetic 12 notes/s scale is segmented correctly.
Effort: M

### Drone and keyboard sound bleed into the analysis
Evidence: gating exists only for metronome clicks (`shared.ts:42`). Drones played through the speakers are detected as the user's pitch.
Fix: when `activeNotes()` is non-empty and a detected f0 sits within 10 cents of a drone partial for more than 1 s with the user silent, show "Hearing the drone, use headphones". Optionally suppress those readings. Longer term, subtract the known drone signal the same way item 45 proposes for clicks.
Effort: S

### Analysis readings don't count toward tendencies or the session meter
Evidence: the tuner feeds `recordTuningFrame` and `addReading` (`tuner.ts:412-414`). Analysis doesn't, so practice in Analysis never appears in tendencies or the top-bar in-tune meter.
Fix: feed the same functions from the Analysis `onFrame` (non-held, non-gated frames), behind a setting "Count Analysis in tendencies".
Effort: S

### Analysis doesn't say what cents are measured against
Evidence: cents come from the tempered target (`notes.ts:130-148`), but Analysis doesn't show the temperament or tonic. The top bar chip shows A4 and transposition only (`main.ts:103`).
Fix: a subtitle under the stat strip, "A4 440 · Werckmeister III on C · written B♭", tappable to open the tuning sheet.
Effort: S

### Pitch chart y axis bends under non-equal temperaments
Evidence: `analysis.ts:229` plots `midi + cents/100` with cents relative to each note's tempered target. Under meantone, the vertical distance between two notes is 100 cents × semitones, not their real interval, and grid lines hide the temperament's uneven steps.
Fix: y = cents from A4 = `1200·log2(f/a4) + 6900`, with grid lines at the tempered targets `midiToFrequency(m, tuning)`, which then show uneven spacing.
Effort: S

### No confidence shown for readings
Evidence: `Point` drops clarity (`analysis.ts:18-22`), so low-confidence readings draw the same as clean ones. Item 47 adds a threshold setting to the tuner; this is about visualisation.
Fix: store clarity and draw alpha = `0.3 + 0.7·clamp((clarity − 0.8)/0.2)`. Below 0.8, draw a thin grey line.
Effort: S

### No microtonal or non-12 grids
Evidence: the grid is 12 semitones (`analysis.ts:203`). Item 15 is 12-offset temperaments; nothing supports 24, 31 or 53 EDO or Scala scales.
Fix: a `Scale` abstraction (list of cents within the period plus period). Parse Scala `.scl` (cents and ratio lines) and draw grid lines per scale degree. Deviation = cents to the nearest degree. Unit test with a 24-EDO and a 7-limit `.scl`.
Effort: M

### No pitch deviation histogram
Evidence: the only summary is the in-tune % (`analysis.ts:124`).
Fix: a histogram of voiced cents in 2-cent bins over the window or session, with the mean line, ± tolerance shading and standard deviation. It shows bias and spread at a glance.
Effort: S

### No range or tessitura profile
Evidence: none. Vocal pitch apps show a singer's range [unverified].
Fix: accumulate voiced seconds per MIDI note. A horizontal keyboard heat strip shows lowest and highest held notes (at least 0.5 s) and the 10th to 90th percentile tessitura band. Persist per session.
Effort: S

### No timbre profile across the range
Evidence: harmonics are per-frame only (`analysis.ts:387`), and nothing records how tone colour changes by register.
Fix: per MIDI note, average the harmonic dB profile (power-domain mean) over held notes. A grid (notes × partials) coloured by level shows register breaks and dull notes.
Effort: M

### No key detection or scale-degree view
Evidence: tendencies are per absolute pitch class (`intonation.ts:20`). Intonation habits are about function (leading tone, thirds of chords).
Fix: Krumhansl-Schmuckler key finding. Correlate a 12-bin duration-weighted pitch-class histogram with the major and minor key profiles rotated over 24 keys (take the profile values from the original paper, not memory). Display the key, use it for staff spelling, and show tendencies per scale degree (1 to 7) relative to it.
Effort: M

### No note-blob view
Evidence: the pitch chart is a line and the staff is heads and bars. Melodyne shows notes as blobs whose width follows amplitude, with a pitch-centre mark and a drift line inside [unverified].
Fix: a "Notes" tab. Each `HeldNote` is a rounded shape from start to end, its height following the rms envelope, a horizontal line at mean cents, the pitch curve inside, and the cents label. Uses the segmentation and dynamics items above.
Effort: M

### No CSV export of analysis data
Evidence: Analysis has no export. The app's CSV export covers practice history only (README:81).
Fix: "Export CSV" writes `time_s,frequency_hz,midi,note,cents,clarity,rms_dbfs,gated` for the history buffer, plus a notes CSV (start, end, note, mean cents, drift). Download, or `navigator.share` per item 29.
Effort: S

### No image export of charts
Evidence: none.
Fix: "Save image" renders the current tab to an offscreen canvas at 2× with a title, date, tuning subtitle and axis labels, then `canvas.toBlob('image/png')`, and downloads or shares.
Effort: S

### Spectrum and harmonic tests are too thin
Evidence: `tests/spectrum.test.ts` has two tests, both at bin-centred or 220 Hz frequencies. Nothing tests leakage between close partials, off-bin level accuracy, low f0, the waveform trigger, staff clef selection, or `segmentNotes` near ±50 cents.
Fix: add those cases alongside the fixes above, plus a pure `core/analysisGeometry.ts` (xOf, yOf, tick generation) with unit tests, so axis bugs like the off-canvas 10k label get caught.
Effort: S
