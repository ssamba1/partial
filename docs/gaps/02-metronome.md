# Metronome gaps

This file lists 114 metronome gaps that aren't already in `docs/gap-analysis.md`. I stopped there rather than pad the list. I read the metronome view, engine, scheduler, click sounds, rhythm helpers, dial and hold buttons, dock, shared wiring, the metronome CSS, `settings.ts`, `controls.ts`, the relevant parts of `clicktrack.ts`, `recorder.ts` and `sound.ts`, the rhythm tests and the metronome e2e checks. I edited nothing and ran nothing. Every code bug below comes from reading the code, not from running it. Every competitor feature is from memory and marked [unverified].

## Timing engine

### Tempo changes can lag up to two beats at slow tempos
Evidence: `src/audio/scheduler.ts:39,57` fetches the next event (`pending = next()`) as soon as the current one is scheduled. `src/audio/metronome.ts:111-113` reads `bpm` when it builds a beat's first event. At 20 BPM a change made just after a beat is ignored for the next beat, so it takes up to about 6 s to be heard.
Fix: split `next()` so it returns only the next beat's start time, which depends only on the previous beat's length. Read `bpm`, subdivision and accents when that beat enters the horizon inside `tick()`. Test: a pure sequence test with a fake clock that changes 20 to 200 BPM mid-beat and checks the next beat's length is 0.3 s.
Effort: S

### Changing subdivision mid-beat schedules a stray, out-of-order click
Evidence: `src/audio/metronome.ts:116` re-reads `subdivision` on every event, but `sub` carries over (`:123,134`). Example: at sub 3 of 4, switching to 2 gives `time = beatStart + 3/2 * beatDur`. That click lands after the next downbeat and is scheduled before it.
Fix: store `subdivision` in a local variable at `sub === 0`, alongside `beatDur`. Test: switch 4 to 2 during sub 2 and check event times only increase.
Effort: S

### Meter changes apply mid-bar with odd beat numbers
Evidence: `src/audio/metronome.ts:117` uses `beat % s.beatsPerBar` with a running `beat`. Going from 7 to 4 at beat 5 plays beat index 1 and then wraps, so that bar has 6 beats with accents out of place.
Fix: store `beatsPerBar` and the accents at the start of each bar and apply meter changes at the next barline. Test the sequence for bar lengths.
Effort: S

### The polyrhythm layer is scheduled a whole bar ahead
Evidence: `src/audio/metronome.ts:154-160` schedules every poly pulse at the downbeat using that moment's tempo. A tempo change, a speed trainer step, or poly turned off mid-bar leaves those pulses out of step with the beats.
Fix: produce poly pulses as a second cursor inside the event sequence and merge the two streams in time order, so each pulse is scheduled only when it enters the lookahead window. Test: change tempo at beat 2 and check the pulses land on the new grid.
Effort: S

### Stop does not silence clicks that are already scheduled
Evidence: `LookaheadScheduler.stop()` (`scheduler.ts:74-80`) only clears timers. Oscillators already started keep sounding: up to 120 ms of clicks, or a whole bar of poly pulses (12 s at 20 BPM in 4/4).
Fix: send each run through its own `GainNode`. On stop, ramp it to 0 over 5 ms, disconnect it, and create a new one on start. Test in e2e: 20 BPM with poly 3, stop after 1 s, and check an `AnalyserNode` reads silence after 50 ms.
Effort: S

### No guard when the timer runs late: clicks in the past play in a burst
Evidence: the `scheduler.ts:45` loop schedules every event before the horizon, including ones already in the past. After a stall (GC, busy main thread, throttled tab) they all start at once.
Fix: in `tick()`, if `startAt + pending.time < ctx.currentTime - 0.02`, move the start point forward by the missed amount (or skip audio for those events but keep counting) and count the skips. Test by stubbing `currentTime` to jump 2 s.
Effort: S

### Background tab timer throttling can break the click
Evidence: the tick is a 25 ms `setTimeout` chain with 120 ms lookahead (`scheduler.ts:36-37,68`). Browsers throttle timers in hidden tabs, and whether audio-playing pages are exempt varies [unverified].
Fix: run the tick from a dedicated Worker's `setInterval`, posting to the main thread, and raise the lookahead to 1 s while `document.hidden`. Test: hide the tab in Chrome for 10 minutes while logging the `when` of each `start()` call, then check for gaps.
Effort: M

### Beat visuals pile up and flash in a burst when the tab returns
Evidence: `scheduler.ts:50-55` creates one `setTimeout` per event. When throttled timers release they all fire together, causing a flash or animation storm (`metronome.ts:452-457`).
Fix: in the visual callback, drop events older than `ctx.currentTime - 0.05`.
Effort: S

### Visuals use setTimeout and forced reflows instead of a frame loop on the audio clock
Evidence: `scheduler.ts:51` uses a timer per event, and `metronome.ts:439,448,454` use `void el.offsetWidth` reflows. This is separate from gap item 39 (output latency). It is about timer jitter and layout cost.
Fix: keep a queue of upcoming events. In one `requestAnimationFrame` loop, map audio time to page time with `ctx.getOutputTimestamp()` and apply every due event. Animate with the Web Animations API. Measure the offset between frame time and click time with performance marks.
Effort: M

### A suspended or interrupted AudioContext is not detected
Evidence: `src/audio/context.ts` has no `onstatechange` handler. If the OS suspends audio (for example a phone call), `playing` stays true while `currentTime` is frozen.
Fix: listen for `statechange` and set a stalled state on `Metronome`. Show "Audio paused by the system, tap to resume", and on resume restart from the next barline. Test: call `ctx.suspend()` in e2e and check the banner appears.
Effort: S

### The tuner's click-time buffer overflows with poly and subdivisions
Evidence: `recentClicks` holds 24 entries (`metronome.ts:46`). Poly writes future times at the downbeat (`:158`), so with 16 poly pulses plus subdivisions, later clicks overwrite those entries before they sound and the tuner is not skipped for them. Clicks from click tracks and the exercise player are never recorded.
Fix: keep a time-sorted list covering the last 2 s and the next 2 s, pruned by time, with one `registerClick(when)` in `shared.ts` that click tracks and `sound.ts` also call. Unit test with 40 clicks per bar.
Effort: S

### Two timing engines can play at once
Evidence: starting a click track stops the metronome (`clicktrack.ts:272`), but nothing stops a click track or the exercise player (`sound.ts:347-378`) when the metronome starts from the dock or with M. The result is doubled clicks out of phase.
Fix: add `claimTransport(owner, stop)` in `shared.ts` that each engine calls on start, which stops whichever engine held it. Test in e2e: start a click track, press M, and check only one scheduler is running.
Effort: S

### The exercise player ignores a running metronome's phase
Evidence: `sound.ts:365` starts its own schedule at the current time, even when the metronome is already playing at the same tempo.
Fix: add `metronome.nextBarTime()`. When the metronome is playing, start the exercise at that time, drop its own count-in, and let the metronome keep clicking.
Effort: S

### The first click can be swallowed when the audio device wakes up
Evidence: the start delay is a fixed 80 ms (`scheduler.ts:32`). Bluetooth and USB outputs often need longer to wake [unverified].
Fix: start the first beat at `currentTime + max(0.08, outputLatency + 0.05)` and play a silent 100 ms buffer first. Test on Bluetooth headphones by recording the output.
Effort: S

### iPhone ring/silent switch may mute Web Audio
Evidence: this is widely reported iOS behaviour [unverified]. There is no handling in `context.ts`.
Fix: in `ensureRunning()`, set `navigator.audioSession.type = 'playback'` where it exists [unverified API availability]. Otherwise show a one-time tip on iOS. Test on a device with the switch on silent.
Effort: S

### No limiter on the master output
Evidence: `LOUDNESS` goes up to 3.1 (`voices.ts:50`), wood noise is `peak * 4` (`:124`), and poly, subdivision and accent clicks can stack with drones. The master is a plain `GainNode` (`context.ts:10`).
Fix: insert a `DynamicsCompressorNode` set up as a limiter (threshold -3 dB, ratio 20, 1 ms attack). Test: render the worst case offline and check the peak stays below 1.0.
Effort: S

### Every click builds 2 to 5 audio nodes on the fly
Evidence: `voices.ts:64-200`. At 400 BPM with 6 subdivisions that is 40 clicks per second, which is heavy garbage collection on low-end phones.
Fix: render each sound at each level once into an `AudioBuffer` with `OfflineAudioContext`, cached per sample rate, and play it with one buffer source and one gain. Test that the output matches the live synth within -60 dB, then profile.
Effort: S

## Sound design

### Loudness matching uses peak level, not perceived loudness
Evidence: `voices.ts:40-43` matches sounds by peak. At the same peak, bell (0.8 s) and triangle (0.6 s) sound much louder than tick (15 ms).
Fix: match sounds on the RMS level of a rendered 4-beat pattern (or K-weighted loudness; check the ITU-R BS.1770 details first) and regenerate the table with a script.
Effort: S

### Accents are weak on unpitched sounds
Evidence: hi-hat, rim, snare and shaker noise ignore `pitchByLevel` (`voices.ts:132,146,149,156`). Accent versus normal is only 1 : 0.7 gain, about 3 dB (`:117`).
Fix: give each sound its own accent treatment (brighter filter, extra layer) and add an accent strength setting from 0 to 12 dB. Test: render accent and normal and check at least a 6 dB difference.
Effort: S

### Long-decay sounds smear together at fast tempos
Evidence: bell decays for 0.8 s, triangle 0.6 s, cowbell 0.25 s (`voices.ts:160,168,176`). Clicks overlap at high tempos or with subdivisions.
Fix: pass the time until the next click into `playClick` and limit decay to 80% of it.
Effort: S

### The kick sound is inaudible on phone speakers
Evidence: `voices.ts:152` is a 150 Hz sine sweeping down to 45 Hz with only a faint 1 kHz tick.
Fix: add a beater transient and a second harmonic, and label the tile "best on headphones". Test: filter the render above 300 Hz and compare the remaining energy with other sounds.
Effort: S

## Meters and rhythm

### No additive meters or beat groupings (2+2+3)
Evidence: `compoundAccents` handles only multiples of 3 in /8 (`metronome.ts:41-47`). 5/8, 7/8 and 6/4 get a single accent, and the beat blocks show no grouping.
Fix: add `grouping: number[]` to settings and derive accents from group starts. Show grouping chips for the numerator (7: 2+2+3, 2+3+2, 3+2+2) and a CSS gap between groups. Unit test grouping to accents.
Effort: S

### Uneven beats (aksak, long-short) cannot be clicked as beats
Evidence: `beatUnit` is display only (`rhythm.ts:6`), so 7/8 either clicks every eighth or needs a wrong BPM.
Fix: a "click groups" option that plays one click per group, each lasting group size times the eighth length, with BPM counting eighths. Test group times for 2+2+3.
Effort: S

### No choice of the note BPM counts (dotted quarter in 6/8, half note in 2/2)
Evidence: `rhythm.ts:6` says BPM always counts beats. This differs from gap item 8, which is about keeping the eighth the same length when switching meters.
Fix: add a `pulseUnit` setting. Event length is `60 / bpm / notesPerPulse`, subdivision is relative to the pulse, and the tempo display shows the note symbol.
Effort: M

### Meter range and picker are limited, and the custom picker does not update
Evidence: 1 to 16 beats and units 2, 4, 8, 16 only (`metronome.ts:52-54`). No 3/2, 11/8 or 15/16 tiles (`:16-18`). The tile highlight never updates after a custom change (`:64`).
Fix: allow up to 32 beats and units 1 to 32, add tiles, and redraw the sheet when settings change.
Effort: S

### Changing meter throws away custom accent patterns
Evidence: a tile applies `compoundAccents` (`metronome.ts:66`), and `setMetronome` truncates or pads the accents (`:33-36`). Going 4/4 to 7/8 and back loses your 4/4 accents.
Fix: keep `accentMemory: Record<"b/u", AccentLevel[]>` and restore it when you return to that meter.
Effort: S

### Only three accent levels, cycled in a fixed order
Evidence: `NEXT_ACCENT` (`metronome.ts:14`) goes accent, silent, normal. There is no medium or soft level, and getting from accent to normal passes through silent.
Fix: five levels (accent, medium, normal, soft, silent) and a long-press or context menu to pick one directly. Extend `gainByLevel` in `voices.ts:117`.
Effort: S

### Individual subdivision clicks cannot be edited
Evidence: a silent beat also silences its subdivisions (`metronome.ts:121`, `rhythm.ts:57`), so "and only" or "e and a" patterns are impossible. Pro Metronome and Soundbrenner have per-subdivision editors [unverified].
Fix: `pattern: AccentLevel[][]` (beat by subdivision cell), a grid editor, and the engine reads each cell's level. Unit test the expansion.
Effort: M

### No per-beat subdivision
Evidence: one global `subdivision` (`settings.ts:52`). You cannot have eighths on beat 1 and triplets on beat 2.
Fix: optional `subdivisionPerBeat: number[]`, stored when each beat starts and edited from the beat block.
Effort: S

### Common rhythm figures and larger tuplets are missing
Evidence: `SUBDIVISIONS` covers 1 to 6 even clicks only (`metronome.ts:20-27`). There is no dotted eighth plus sixteenth, eighth plus two sixteenths, 7, 8 or 9.
Fix: named rhythm figures stored as onset fractions within the beat (for example `[0, 0.75]`), with the engine iterating those onsets.
Effort: S

### No swing or shuffle
Evidence: subdivisions are evenly spaced (`metronome.ts:123`).
Fix: a `swing` setting from 50% to 75%. With subdivision 2, the off-beat lands at `swing/100 * beatDur`; with subdivision 4, apply the same within each eighth pair. Unit test that 66.7% matches the triplet position within 1 ms.
Effort: S

### Subdivisions cannot be layered with separate levels
Evidence: one subdivision at a time. The Boss DB-90 has a separate level for each note value mixed together [unverified].
Fix: layers of `{subdivision, gain}` (quarter, eighth, triplet, sixteenth) merged into one event stream, with a small mixer in the options sheet.
Effort: M

### Polyrhythms cannot span more than one bar or a few beats
Evidence: `polyOffsets(barSeconds, pulses)` covers exactly one bar (`rhythm.ts:176-179`), so 5 over 2 bars or 4 over 3 beats is impossible. Gap item 9 covers adding layers, not the span.
Fix: add `polySpanBeats`, spread the offsets over that span, and restart the cycle at bar multiples.
Effort: S

### The polyrhythm layer has no visual
Evidence: poly clicks are only scheduled for audio (`metronome.ts:154-160`) and never reach the beat display callbacks.
Fix: emit poly events into the visual stream with a `layer` field and draw a second row of dots under the blocks.
Effort: S

### No clave or other timeline patterns
Evidence: nothing in `rhythm.ts`. Metronome Beats and Drumgenius offer style patterns [unverified].
Fix: a library of step-grid patterns on 12 or 16 cells with a sound per cell (son clave 3-2 and 2-3, rumba clave, tresillo, bossa). This depends on the subdivision grid above.
Effort: M

### No drum grooves
Evidence: no groove engine. iReal Pro and Drumgenius play style grooves [unverified].
Fix: a multi-voice step sequencer using the existing kick, snare and hi-hat synths, grooves stored as JSON, with swing and fills every N bars.
Effort: L

### No rudiment or sticking practice
Evidence: nothing in the metronome view. Drum rudiment apps show sticking [unverified].
Fix: show a sticking string (R L R R L R L L) mapped to subdivision cells above the blocks, and a small rudiment library checked against a published rudiment list before shipping.
Effort: M

### No conductor beat-pattern visual
Evidence: the visuals are blocks, pendulum and pulse only (`settings.ts:23`).
Fix: an SVG path for 2, 3, 4, 5 and 6 beat patterns with a ball whose position is computed each frame from beat phase. Check the patterns against a conducting textbook.
Effort: M

### Cannot shift the click off the beat
Evidence: event time is always `beatStart + sub/subdivision` (`metronome.ts:123`). You cannot put the click on the "and" or the "a" for time-feel practice.
Fix: an `offsetFraction` setting added to every event time while bar and beat numbering stay the same.
Effort: S

### No uneven beat timing within a bar (for example Viennese waltz)
Evidence: beats are always equal length (`metronome.ts:112-113`). The early beat 2 of a Viennese waltz is a convention [unverified].
Fix: `beatOffsetsMs: number[]` added to each beat's time, with dance presets whose values come from a cited source.
Effort: S

## Tempo

### Tempo is whole numbers only
Evidence: `setMetronome` does `Math.round(m.bpm)` (`metronome.ts:32`), so 72.5 is impossible.
Fix: allow 0.1 BPM steps, use `inputmode="decimal"`, Shift-drag on the dial for fine steps, and show one decimal only when needed.
Effort: S

### Tempo range 20 to 400 is narrow at the slow end
Evidence: `MIN_BPM = 20`, `MAX_BPM = 400` (`rhythm.ts:29-30`). Competitor ranges are [unverified].
Fix: widen to about 10 to 600, check the lookahead at the extremes, and extend the tempo names table.
Effort: S

### Clearing a number field sets it to its minimum
Evidence: `Number('')` is 0, which is finite, so clearing the BPM field sets 20 BPM (`metronome.ts:248-249`). `numberInput` does the same (`dom.ts:67`): a cleared "Stop at" becomes 20 and "Add BPM" becomes 1.
Fix: treat an empty trimmed value as invalid and restore the old value. Test in e2e: clear the field, blur, and check it still reads 100.
Effort: S

### Half then double does not return to the original tempo
Evidence: 101 halves to 50.5, rounded to 51, and doubles back to 102 (`metronome.ts:116,119` plus rounding at `:32`).
Fix: once decimal tempos exist, keep the exact value, or store a base tempo and a multiplier.
Effort: S

### Tempo names are uncited and overlap
Evidence: Grave 25-45 overlaps Largo 40-60, and Vivace 156-176 overlaps Presto 168-200 (`rhythm.ts:181-193`). `tempoMarking` picks the first match (`:196`) while the sheet highlights every matching row (`metronome.ts:129`).
Fix: cite the source table in code, show "Vivace or Presto" when ranges overlap, and make the label and highlight agree.
Effort: S

### No smooth accelerando or ritardando in the metronome, and click-track ramps are not linear in time
Evidence: the metronome only has stepwise trainer jumps (`metronome.ts:170-177`). Click tracks ramp BPM linearly per beat index (`rhythm.ts:106-109`), so an accelerando spends longer at the slow end than a ramp that is linear in time.
Fix: `ramp: {toBpm, overBars, curve}` with the choice "linear per beat", "linear in time" or "exponential". For linear in time, `beats(t) = (b0*t + (b1-b0)*t²/(2T))/60`, inverted with the quadratic formula to get each beat time. Unit test that total length equals T within 1 ms.
Effort: M

### The speed trainer permanently overwrites your saved tempo
Evidence: trainer steps write to settings (`shared.ts:23-25`, `metronome.ts:174`). The next session starts at the raised tempo and the starting tempo is lost. Screen reader users are not told about the changes.
Fix: keep `trainerStartBpm`. On stop, offer "Keep 132 or go back to 100". The badge shows start, current and target, and each step is announced politely.
Effort: S

### The speed trainer fails silently and only goes up
Evidence: `s.bpm < s.trainerMax` (`metronome.ts:173`). A target below the current tempo does nothing while the badge still shows it (`:417`). There is no slowing-down trainer and no message when the target is reached.
Fix: go in either direction based on the sign, warn in the sheet when the target is unreachable, and show "Reached 160" when it is hit.
Effort: S

### Speed trainer modes are basic
Evidence: whole-BPM steps from 1 to 20 every N bars only (`metronome.ts:176-178`). The Boss DB-90 and Tempo apps have step up/down and time-based modes [unverified].
Fix: a trainer spec `{unit: BPM | %, every: bars | seconds, pattern: [+4, +4, -2], onMax: hold | loop | stop}` evaluated in `onBarComplete`.
Effort: M

### No pause and resume
Evidence: `start()` resets bar count, trainer progress and the random seed (`metronome.ts:97-98`), so stopping loses your place.
Fix: `pause()` keeps bar, beat, bars played and seed. Resume continues from the next bar with an optional count-in.
Effort: S

### No "stop at end of bar" and no bar-aligned start
Evidence: `stop()` is immediate (`metronome.ts:179-188`).
Fix: a stop mode setting. "End of bar" sets `stopAfterBars` to the current bar + 1 while playing.
Effort: S

### Tempo presets as percentages of a target are missing
Evidence: no target tempo in settings. Gap item 4 covers scaling click tracks, not this.
Fix: add `targetBpm` and buttons for 60, 70, 85 and 100% of it in the tempo sheet.
Effort: S

### No snapping to traditional metronome marks
Evidence: the dial moves 1 BPM per step (`metronome.ts:260`). The traditional marks (40, 42, 44 ... 208) are what many printed scores use [unverified list].
Fix: an optional snap mode for the dial and +/- buttons using a cited mark table.
Effort: S

### No tempo in dance units (bars per minute)
Evidence: BPM only. Ballroom dance tempos are given in bars per minute [unverified].
Fix: a display toggle where bars per minute = BPM / beats per bar, plus dance presets with cited ranges.
Effort: S

### No milliseconds-per-note readout
Evidence: the tempo sheet (`metronome.ts:107-143`) shows names only.
Fix: list quarter, eighth, dotted and triplet lengths in ms (`60000/bpm` and its fractions) in the tempo sheet.
Effort: S

## Tap tempo

### Tap timing uses the click event, which fires on release
Evidence: `tapBtn` uses `onclick` with `performance.now()` (`metronome.ts:275,310`). How long each press lasts adds jitter.
Fix: use `pointerdown` with `e.timeStamp` and ignore the click that follows. For keys, use `keydown` `e.timeStamp`. Test: synthetic pointer events with different press lengths give the same BPM.
Effort: S

### Tap tempo cannot go below 30 BPM
Evidence: taps reset after a 2000 ms gap (`metronome.ts:311`), which is 30 BPM, while the minimum tempo is 20.
Fix: reset after 4500 ms (just over one beat at 20 BPM), or only when an interval differs from the median by more than 60%.
Effort: S

### Tap tempo jumps on the second tap and has no outlier rejection
Evidence: `tapTempo` applies after one interval, and with an even count the median takes the upper middle value (`rhythm.ts:201-208`). No live tap count or provisional BPM is shown.
Fix: apply from the third tap, average intervals after dropping any more than 25% from the median, and show the count and BPM on the button. Unit test ±20 ms jitter at 60, 120 and 240 BPM: within 1 BPM after 6 taps.
Effort: S

### Tapping does not set the beat phase
Evidence: `tap()` sets only BPM (`metronome.ts:317-318`), so the click stays out of phase with a band.
Fix: map tap times to audio time with `ctx.getOutputTimestamp()`. After 4 taps, reschedule so the next beat falls at last tap + interval, minus output latency.
Effort: M

### MIDI or pedal tap only works on the metronome screen
Evidence: `runAction('tap')` fires a synthetic "t" key (`controls.ts:63-64`), and only the metronome view listens for it (`metronome.ts:497`). The dock has no tap button.
Fix: move tap handling to `shared.ts` (`tapInput(timestamp)`), call it from `runAction` with the MIDI event's `timeStamp`, and add tap to the dock.
Effort: S

### Holding a key repeats the action
Evidence: `onKey` does not check `e.repeat` (`metronome.ts:488-499`). Holding T drives the tempo toward 400. Holding Space flips start and stop over and over.
Fix: return early when `e.repeat` is true for Space and T.
Effort: S

### No hands-free tap (clap into the mic or knock the phone)
Evidence: tap requires the button, a key or MIDI. Soundbrenner offers body-tap tempo [unverified].
Fix: an onset detector on the mic `AnalyserNode` (spectral flux with a 150 ms refractory period) or on `DeviceMotionEvent` acceleration peaks, feeding `tapInput`. iOS needs a motion permission prompt.
Effort: M

## Feedback on your playing

### No timing accuracy feedback against the click
Evidence: the app never compares your playing to the click. The Boss DB-90 has a timing check feature [unverified].
Fix: detect onsets from the mic and match each to the nearest scheduled click time. Subtract round-trip latency (gap item 50). Show mean and spread in ms, early or late per beat, and drift during gap-trainer silent bars.
Effort: L

### No tempo detection from playing
Evidence: nothing listens for tempo.
Fix: autocorrelate an onset-strength envelope over 8 s, pick candidates from 40 to 240 BPM with octave preference, and add a "Listen" button that proposes the tempo.
Effort: M

## Interface and accessibility

### Preset chips and dock controls are rebuilt every bar
Evidence: on every downbeat, `render()` runs (`metronome.ts:458`), which rebuilds the preset chips (`:421`), meter button and play icon. The dock drone button is rebuilt too (`main.ts:183`). A tap landing on a barline hits a removed element, and keyboard focus drops to the page body.
Fix: a light per-bar update and a separate settings render that changes preset chips only when the data changes. Test in e2e: focus a preset chip, play 3 bars, and check `document.activeElement` is unchanged.
Effort: S

### Changing an accent loses focus and is not announced
Evidence: `renderBeats` replaces every beat block when accents change (`metronome.ts:324`).
Fix: update the class and `aria-label` in place, and announce the new level through a live region.
Effort: S

### The count-in label talks to screen readers every beat
Evidence: `aria-live="polite"` (`metronome.ts:278`) with text changing every beat, including "silent" on each muted beat (`:436`).
Fix: announce only "Count-in" and "Go". Keep the per-beat label visual only.
Effort: S

### Subdivision and sound pickers lack names and arrow keys
Evidence: the labels are "♩" and "♫" symbols (`metronome.ts:20-27`). `segmented` has no roving focus (`components.ts:35-52`). When a picker has focus, arrow keys change tempo instead (`metronome.ts:491`).
Fix: `aria-label`s ("Quarter notes", "Eighth notes", "Triplets"), roving tabindex with arrow-key selection, and skip the tempo arrows when focus is inside a radio group.
Effort: S

### Space toggles the last clicked control instead of start/stop
Evidence: `metronome.ts:487` skips Space when a button has focus. After you click a beat block or preset with the mouse, Space changes that control instead of starting the metronome.
Fix: treat Space as start/stop unless the button got focus from the keyboard (`:focus-visible`), or blur buttons after pointer clicks.
Effort: S

### The dial has interactive controls inside a slider
Evidence: the BPM input and tempo-name button sit inside `role="slider"` (`components.ts:215-227`, `metronome.ts:261`). A slider must not contain interactive children, so screen readers may hide them.
Fix: put the slider role on the ring (the SVG) and make the centre controls siblings layered on top.
Effort: S

### Beat blocks overflow at high beat counts on phones
Evidence: 16 columns with 8 px gaps (`styles.css:2132-2137`), and subdivision dots of 5 px with 5 px gaps (`:2201-2213`) wider than a column about 14 px wide at 360 px screen width.
Fix: wrap into two rows above 8 beats (or by grouping), and replace the dots with a thin progress bar when columns are narrower than 30 px. Screenshot test at 360 px.
Effort: S

### The screen flash disappears for reduced-motion users
Evidence: the flash is a CSS animation (`styles.css:2400`), and the reduced-motion rule forces animations to 1 ms (`:3751-3758`). Users who rely on the flash get nothing.
Fix: show the flash by adding a class and removing it with a 100 ms timer instead of an animation, and offer a non-flashing border colour option.
Effort: S

### Full-screen flash has no photosensitivity limit
Evidence: a 45% opacity full-screen flash (`styles.css:2392-2408`) on every beat, up to 400 BPM (6.7 per second). WCAG 2.3.1 sets a three-flashes-per-second threshold [unverified wording; check the WCAG text].
Fix: above 180 BPM flash only downbeats, add a warning to the toggle, and offer a small-area flash.
Effort: S

### The accent flash differs only by colour
Evidence: `.screen-flash.go.accent` only changes the background colour (`styles.css:2403`).
Fix: make the accent flash stronger or longer as well. Check it in grayscale.
Effort: S

### The flash only works on the metronome screen
Evidence: the flash element lives in the metronome view (`metronome.ts:302,477`). On the sheet music or tuner screens you only get 7 px dock dots (`styles.css:571`).
Fix: move the flash into the app shell in `main.ts`, driven by `metronome.onBeat`, with an edge-glow option that does not cover the score.
Effort: S

### The pendulum shows beat one on alternating sides and starts late
Evidence: the side flips every beat (`metronome.ts:444`), so in 3/4 beat one alternates sides. The first swing starts from the centre. Under reduced motion it jumps.
Fix: compute the angle each frame from beat phase, anchor even meters so beat one is always on the same side, and offer a conductor-style option for odd meters.
Effort: S

### Pendulum and pulse views never show subdivisions
Evidence: subdivision events only update the dots in beat blocks (`metronome.ts:459-462`).
Fix: small tick marks around the pulse circle, and a subdivision marker along the pendulum arc.
Effort: S

### No bar counter or elapsed time
Evidence: `ClickEvent.bar` exists but nothing displays it (`metronome.ts:392-428`).
Fix: a readout like "Bar 17 · 3:42", plus bars remaining with stop-after, and "silent 2 of 4" in the gap trainer.
Effort: S

### No form or phrase counter
Evidence: nothing counts choruses. iReal Pro shows a chorus count [unverified].
Fix: a `formBars` setting showing "Chorus 3, bar 5", with an optional bell or extra accent on the first beat of each form or every Nth bar.
Effort: S

### Sheets show stale values
Evidence: the tempo, meter and practice-tools sheets render once from a snapshot (`metronome.ts:50,108,146`). After ±10 or "Turn all practice modes off" (`:190`), highlights and numbers are wrong.
Fix: subscribe to settings inside each sheet and unsubscribe in `onClose`.
Effort: S

### Keyboard hints show on touch phones
Evidence: `metronome.ts:476` always shows the keyboard hint line.
Fix: hide it under `@media (hover: none) and (pointer: coarse)`.
Effort: S

### Mouse wheel and trackpad spin the dial too fast
Evidence: every wheel event is one step regardless of `deltaY` or `deltaMode` (`components.ts:271-281`). Trackpads send dozens of events per gesture.
Fix: add up normalised `deltaY` and step once per 50 px. Test with synthetic WheelEvents.
Effort: S

### The dial jumps near its centre and accepts any mouse button
Evidence: `pointerdown` does not check `e.button`, and there is no dead zone in the centre, where angle changes explode (`components.ts:244-264`). `lostpointercapture` is not handled.
Fix: require button 0, ignore moves inside 25% of the radius, and end the drag on `lostpointercapture`.
Effort: S

### The dial lacks Home/End, and its arc wastes space on extreme tempos
Evidence: the key handler has no Home or End (`components.ts:282-291`). The progress arc is linear from 20 to 400, so 60 to 160 fills about 26% of it (`:295`).
Fix: Home and End go to min and max, and the arc uses a log scale: `log(v/min) / log(max/min)`.
Effort: S

### Hold-to-repeat never speeds up beyond +1
Evidence: `holdRepeatDelay` bottoms out at 45 ms per +1 (`gestures.ts:44-48`).
Fix: after 2 s of holding, step by 5, landing on multiples of 5.
Effort: S

### No mute button
Evidence: the only way to silence is dragging volume to 0, which loses your level (`metronome.ts:291-299`).
Fix: a `muted` flag that keeps the volume and the visuals running, for silent visual-only practice.
Effort: S

### Volume is capped and the slider is linear
Evidence: 0 to 1 linear gain (`metronome.ts:291-299`), which is too quiet on phone speakers in loud rooms.
Fix: a decibel slider from -40 to +6 (`gain = 10^(dB/20)`), relying on the limiter above.
Effort: S

### Accent, beat and subdivision cannot have their own sound or level
Evidence: one sound for all levels, with fixed gain 1/0.7/0.4 and pitch 1.5/1/0.8 (`voices.ts:117-118`). This differs from gap item 7, which is about random rotation.
Fix: `levels: {accent, normal, sub}`, each with a sound and gain, and three small pickers.
Effort: S

### Count-in is rigid
Evidence: the count-in always uses the "tick" sound (`metronome.ts:152`), ignores subdivision and grouping (`:116,118`), and allows whole bars 0 to 4 only (`:156`). There are no pickup beats.
Fix: a count-in spec `{bars, beats, sound, subdivided}` that supports starting on a pickup beat.
Effort: S

### No "count-in then silent" for recording
Evidence: when the recorder starts the metronome, it clicks through the whole take (`recorder.ts:130-131`).
Fix: a `clickAfterCountIn: on | off` option that the recorder can use.
Effort: S

### No delayed start
Evidence: playback starts 80 ms after the tap (`scheduler.ts:32`), with no time to pick up an instrument.
Fix: a start delay of 0 to 10 s with a visible countdown and no clicks.
Effort: S

### Gap trainer and random silence cannot increase over time
Evidence: silence is fixed at 0, 10, 25 or 50% (`metronome.ts:171`), with fixed play and silent bar counts. Time Guru increases silence gradually [unverified].
Fix: a `muteRamp: {from, to, overBars}` setting, a 0 to 90% slider, whole-bar random silence, and an optional gradual volume fade-out.
Effort: S

### Nothing marks the end of a stop-after run
Evidence: `onEnd` just stops (`metronome.ts:165`).
Fix: an optional bell on the final downbeat and a "Finished 32 bars" message.
Effort: S

### Dock beat dots ignore accents, silent beats and count-in
Evidence: `main.ts:171,180-184` only sets the current dot.
Fix: add classes for accent, silent and count-in states on the dots.
Effort: S

## Presets and live performance

### Presets save only part of the metronome
Evidence: `MetronomePreset` holds tempo, meter, subdivision, accents and drones (`settings.ts:11-21`, `metronome.ts:378`). Sound, count-in, poly, gap, trainer and visual are lost.
Fix: save a full metronome snapshot (volume optional), migrate old presets, and match the active chip on a hash of the whole snapshot.
Effort: S

### Preset management is thin
Evidence: names are generated automatically, duplicates are allowed, there is no reordering, and the active chip ignores accents (`metronome.ts:354,374`).
Fix: ask for a name on save, block exact duplicates, and allow reordering with drag plus up/down buttons.
Effort: S

### No setlist mode with pedal switching
Evidence: MIDI actions have no preset next or previous (`midi.ts:1`), and preset changes apply immediately.
Fix: add `presetNext` and `presetPrev` actions and keys, and queue the change to apply at the start of the next bar.
Effort: M

### No tempo nudge for playing with people
Evidence: there is no way to shift the click's phase without changing tempo.
Fix: nudge buttons (±10 ms) that shift all future event times, plus a "tap one" resync.
Effort: S

### No performance lock
Evidence: the dial, beat blocks and presets are always live (`metronome.ts:254-389`), so a stray touch on stage changes the tempo.
Fix: a lock toggle that disables those controls, with long-press to unlock.
Effort: S

### Keyboard coverage is thin
Evidence: only Space, arrows and T (`metronome.ts:483-500`).
Fix: keys to cycle subdivision, switch presets with [ and ], half and double time, mute, and edit accents with Shift+digit (plain digits already switch screens, `controls.ts:30-32`). List them in help.
Effort: S

### Cannot type a tempo without clicking the field
Evidence: digits switch screens (`controls.ts:30-32`).
Fix: Enter focuses and selects the BPM input.
Effort: S

### Media keys and headset buttons do nothing
Evidence: no Media Session handlers anywhere. Some browsers may only honour them while a media element plays [unverified].
Fix: `navigator.mediaSession.setActionHandler('play' / 'pause')` calling `metronome.toggle`. Test with a Bluetooth headset.
Effort: S

### No app shortcut to open the metronome
Evidence: `public/manifest.webmanifest` has no `shortcuts` entry.
Fix: add a shortcut to `#/metronome`. Autoplay still needs a tap, so it only opens the screen.
Effort: S

### No MIDI clock or MIDI note output
Evidence: `controls.ts` only reads trigger messages. Web MIDI can send clock at 24 pulses per quarter note. This is separate from Ableton Link (gap item 2).
Fix: send `0xF8` with send timestamps mapped from audio time via `getOutputTimestamp`, plus Start/Stop messages. Follow incoming clock by taking the median of 24 intervals. Optionally send a MIDI note per accent level.
Effort: M

### Cannot send the click to a specific output device
Evidence: one `AudioContext` on the default output (`context.ts:9`). `setSinkId` exists in Chromium [unverified version].
Fix: an output picker from `enumerateDevices` (audio outputs) using `ctx.setSinkId`, where supported.
Effort: M

### No multi-device ensemble sync
Evidence: no networking. Soundbrenner syncs several devices [unverified].
Fix: a WebRTC data channel with QR pairing (needs signalling), about 20 pings to estimate clock offset, and a leader that broadcasts `{bpm, barStartTime}`.
Effort: XL

### Two tabs run two metronomes
Evidence: there is no cross-tab coordination (the `Metronome` in `shared.ts:7` is per tab).
Fix: a BroadcastChannel so starting in one tab stops the other.
Effort: S

### Cannot export the pattern as audio
Evidence: `playClick` already accepts `BaseAudioContext` (`voices.ts:108`), but there is no export. This differs from gap item 28, which records live output.
Fix: render N bars with `OfflineAudioContext`, encode a 16-bit WAV, and share or download it.
Effort: S

## Data and verification

### Practice time is counted twice
Evidence: metronome time is logged while the recorder also logs its own time (`shared.ts:17`, `recorder.ts:131`). Click tracks log as "metronome" too (`clicktrack.ts:314`).
Fix: record each activity's time intervals and merge overlaps before adding up minutes.
Effort: S

### No tempo progress history per piece
Evidence: the practice log stores minutes only (`settings.ts`).
Fix: on stop, record `{presetId, maxBpm, bars}` per day and chart it on the Practice screen.
Effort: M

### Saved metronome settings are not validated
Evidence: `mergeSettings` is a shallow spread. `beatsPerBar: 0` makes `beat % 0` NaN (`metronome.ts:117`), an unknown sound silently falls back to beep (`voices.ts:191`), and volume above 1 is accepted.
Fix: a `sanitizeMetronome()` that clamps every field and allows only known sound ids. Unit test it with junk input.
Effort: S

### No tests of the live metronome engine
Evidence: tests cover the rhythm helpers and one `tapTempo` case (`tests/rhythm.test.ts:88-93`). Nothing tests changes while playing, the trainer, count-in with stop-after, or poly timing.
Fix: move the sequence into `src/core/metronomeSequence.ts` with an injected settings getter, then test the timing items at the top of this list.
Effort: M

### The e2e timing check measures scheduling, not sound
Evidence: `scripts/e2e.mjs:182-195` patches only `AudioBufferSourceNode.start` and compares the times passed in, not the audio produced.
Fix: render with `OfflineAudioContext`, detect onsets to within a sample, and add a loopback measurement on real devices.
Effort: S

### Sound preview clashes with a running metronome
Evidence: tapping a sound tile plays two preview clicks at `currentTime + 0.02` and `+0.32` regardless of playback (`metronome.ts:94-96`).
Fix: while playing, just switch the sound; preview only when stopped.
Effort: S

The quickest real bugs to fix first are the stray click on subdivision change, the empty BPM field jumping to 20, preset chips rebuilt every bar, key repeat on Space and T, tap on release, and stop not silencing scheduled clicks. All are S effort.
