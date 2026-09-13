# Tuner gaps

This file lists 110 tuner items. I stopped there because the ideas after that were either already in the 78 existing items or were padding. Every code reference was read this session. Anything about competitors or music facts that I recalled rather than checked is marked [unverified].

### Low range breaks at 88.2 and 96 kHz sample rates
Evidence: `pitchTracker.ts:46,83` use a fixed 4096-sample buffer. `pitch.ts:46` limits the longest lag to half the frame (2048). The AudioContext runs at the output device's rate (`context.ts:9`), so at 96 kHz the lowest detectable pitch is 96000/2048 = 46.9 Hz. The bass low E (41.2 Hz) and the 5-string low B (30.9 Hz) disappear on 96 kHz interfaces. At that rate the frame is also only 43 ms long. Tests only cover 48 kHz (`tests/pitch.test.ts:4`).
Fix: in `PitchTracker.doStart`, set `fftSize` to the next power of two at or above `4 * sampleRate / minFrequency`, capped at 32768, and size `this.buffer` to match. Parameterize the existing sine sweep in `pitch.test.ts` over 44100, 48000, 88200 and 96000 Hz.
Effort: S

### One octave-error frame goes straight through the median filter
Evidence: `PitchSmoother.push` (`pitch.ts:113`) clears the buffer whenever a value is more than 100 cents from the previous one. A single 880 Hz frame among steady 440 Hz frames becomes the whole buffer, so the median returns 880. The filter fails on exactly the outlier it should remove.
Fix: hold jumps in a pending list. Only reset once the new pitch has lasted K frames (K = 2, 3 or 4 by damping), and keep returning the old median until then. Tests: 440 x5, then 880, then 440 never returns 880; 440, 660, 660, 660 returns 660 on the third 660.
Effort: S

### Even-length median is biased sharp
Evidence: `pitch.ts:117` returns `sorted[floor(len/2)]`, which is the upper of the two middle values when the length is even. Right after every reset the buffer holds 2 or 4 values, so note starts read slightly sharp.
Fix: average the two middle values when the length is even. Test: `[440, 441]` returns 440.5.
Effort: S

### No interpolation when the dip lands on the longest lag
Evidence: `pitch.ts:82` sets `tauEstimate = maxTau` if the dip is still falling at the end of the search. `pitch.ts:86` then skips parabolic interpolation, leaving an integer lag, and a dip that is still falling means the frame was too short to be sure.
Fix: when `tauEstimate === maxTau`, return null or mark the result low-confidence. Better, compute one extra lag so interpolation is possible, which item 1's larger frame allows. Test: a 30.87 Hz sine at 44.1 kHz stays within 0.5 cents or returns null, never a quantized value.
Effort: S

### Note name flickers at the quarter-tone boundary
Evidence: `frequencyToNote` (`notes.ts:131-139`) always picks the nearest note. A pitch wobbling around +50 cents alternates between A and B♭. Each flip resets the EMA (`pitchTracker.ts:115-116`) and turns the ring 30 degrees with a 450 ms transition (`styles.css:1383`).
Fix: add hysteresis in the tracker. Keep the current MIDI note until the reading is more than 58 cents away for 3 frames. Unit test with readings oscillating 49 to 51 cents above A4.
Effort: S

### In-tune state chatters at the tolerance edge
Evidence: `tuner.ts:424` uses a hard `abs(cents) <= tolerance`. Noise at the edge toggles green on and off, restarts the hold timer (`tuner.ts:426-434`) and can fire the haptic again.
Fix: move the logic into a pure function in `src/core/intonation.ts` with separate enter and exit thresholds: enter at `tol`, exit at `tol + max(0.5, 0.3 * tol)`. Ignore excursions shorter than 150 ms for the hold timer. Unit test with a jittery series.
Effort: S

### Smoothing strength depends on screen refresh rate
Evidence: the EMA factor is applied once per animation frame (`pitchTracker.ts:116`) and the median counts frames (`pitchTracker.ts:8-10`). On a 120 Hz display "Steady" reacts twice as fast; with a 30 fps cap it reacts half as fast. Tendency counts (`tuner.ts:414`) are weighted by frames too.
Fix: use `alpha = 1 - exp(-dt / tau)` with tau per damping (for example 30, 90 and 220 ms), and size the median window in milliseconds. Test by feeding the same signal at 60 and 120 Hz frame intervals and checking the displayed cents match within 0.2.
Effort: S

### Mic stays open when the tab is hidden, but analysis stops
Evidence: the loop runs on `requestAnimationFrame` (`pitchTracker.ts:142`), which pauses in hidden tabs, but the stream is only released by `stop()`. The browser's recording indicator stays on while nothing is analysed and "drone follows you" freezes. There is no `visibilitychange` handler anywhere in `src`.
Fix: in `mountTuner`, on `visibilitychange` to hidden, stop the tracker and remember it was running. On return show "Paused while in background, tap to resume", or resume automatically if permission is still granted.
Effort: S

### A microphone that disconnects is never detected
Evidence: `context.ts:42` checks `readyState` only when acquiring the mic. If a USB mic is unplugged, a Bluetooth device switches, or permission is revoked, the track ends and the tuner keeps showing "Play a note".
Fix: attach `ended` and `mute` listeners to the audio track and a `devicechange` listener on `navigator.mediaDevices`. Show `errorBox` with retry and stop the tracker. E2E: call `track.stop()` from page script and assert the error appears.
Effort: S

### AudioContext suspension mid-session is not handled
Evidence: the only `statechange` handler in `src` is for MIDI (`controls.ts:100`). If the context is suspended or interrupted (phone calls on iOS [unverified exact state name]), `ctx.currentTime` freezes. Gating (`shared.ts:42`) and trace timestamps (`tuner.ts:421`) then use a stale clock.
Fix: add `ctx.onstatechange` in `context.ts` that publishes the state. The tuner shows "Audio paused, tap to resume" and calls `resume()` on tap.
Effort: S

### No input device choice
Evidence: `getUserMedia` has no `deviceId` (`context.ts:45`). Clip-on pickups, USB interfaces and headset mics cannot be chosen over the default.
Fix: after permission, `enumerateDevices()` fills an "Input" select in tuner options. Store `deviceId` in settings and request `{deviceId: {exact}}`, falling back to the default if it fails. E2E with Chrome's fake-device flags.
Effort: S

### Stereo interfaces are downmixed
Evidence: the source goes straight into the analyser (`pitchTracker.ts:85`), which downmixes to mono. An instrument on input 1 with input 2 silent loses about 6 dB, and out-of-phase inputs can cancel.
Fix: insert a `ChannelSplitterNode` with a Left, Right or Mix choice, and request `channelCount`. Unit test with a 2-channel OfflineAudioContext buffer that is silent on the right.
Effort: S

### Mic processing flags are requested but never checked
Evidence: `context.ts:45` asks for `echoCancellation`, `noiseSuppression` and `autoGainControl` off but never reads `track.getSettings()`. If a browser ignores the request [unverified which ones do], automatic gain undermines the fixed sensitivity values and noise suppression can eat sustained tones.
Fix: after acquiring, read `getSettings()`. If any flag is still true, show a warning in tuner options.
Effort: S

### Bluetooth headset mics degrade silently
Evidence: opening a Bluetooth headset mic typically switches the headset to a narrowband call profile [unverified per platform]. Nothing in `acquireMic` warns about it.
Fix: if the track label matches Bluetooth or AirPods patterns, or `getSettings().sampleRate <= 16000`, show "Bluetooth mic detected: use the phone's built-in mic for better accuracy". Verify on a device.
Effort: S

### Sensitivity uses fixed RMS values with no noise-floor calibration
Evidence: the three presets are absolute RMS values (`tuner.ts:57-66`) compared directly in `pitch.ts:41`. Mic gain differs between devices, so "Normal" means different things on different phones.
Fix: add a "Calibrate to this room" button that measures 2 s of silence and sets `minRms = max(0.001, 3 x noise RMS)`. Optionally adapt continuously from the 10th percentile of level over the last 10 s. Unit test the threshold function with synthetic noise.
Effort: S

### Level meter cannot explain why nothing is detected
Evidence: `tuner.ts:383` draws `sqrt(level) * 2.5` in a 120x4 px bar (`styles.css:1650-1664`). There is no dB scale, no threshold marker, no clipping indicator and no message for a dead-silent input or a pitch below 30 Hz.
Fix: switch to a dB meter with a tick at the current sensitivity threshold and a red clip light with peak hold (any sample at or above 0.99). Add status text: "No signal" (level exactly 0 for 3 s), "Too quiet" (above the noise floor but below threshold for 1 s), "Too low for the tuner".
Effort: S

### No filtering before detection
Evidence: the mic source connects straight to the analyser (`pitchTracker.ts:85`). Handling noise, HVAC rumble and wind below 30 Hz inflate the difference function and cause dropouts.
Fix: add a `BiquadFilterNode` high-pass at 0.7 x minFrequency (per instrument range) and a gentle low-pass around 5 kHz before the analyser. Use item 37's benchmark to confirm cents accuracy does not change.
Effort: S

### DC offset keeps full detection running
Evidence: `rms()` (`pitch.ts:18-22`) includes DC. A cheap USB mic with a small offset always passes `minRms`, so YIN runs every frame on silence.
Fix: subtract the frame mean before `rms` and the difference loop. Test: silence plus 0.02 DC returns null without running the lag loop (count iterations with a test hook).
Effort: S

### Worst-case YIN cost lands on noisy rooms
Evidence: when no dip falls below the threshold, `pitch.ts:64-81` computes all lags. At 48 kHz that is about 1600 lags x 2496 samples, roughly 4M operations per frame, exactly for speech and room noise. The idle skip (`pitchTracker.ts:105`) only halves it.
Fix: compute the difference function from an FFT autocorrelation, `d(tau) = r_t(0) + r_{t+tau}(0) - 2 r_t(tau)`, in O(N log N) with a small in-house FFT. Add a vitest bench comparing ms per frame on noise and a 41 Hz tone before and after.
Effort: M

### One frame length for every pitch
Evidence: every note is analysed over the same 4096 samples (85 ms at 48 kHz). High notes only need a few periods, so fast passages and attacks are smeared and note changes register late.
Fix: after a coarse estimate, re-run detection on the newest `max(1024, 4 periods)` samples when f > 300 Hz. Test: a synthetic step from A5 to B5 is detected in fewer frames than today.
Effort: M

### Top of the range is untested
Evidence: `maxFrequency` is 4200 (`pitch.ts:36`) and the test sweep stops at C7 (`tests/pitch.test.ts:35`). C8 (4186 Hz) and piccolo top notes sit at the edge, where the minimum lag at 48 kHz is only 11 samples.
Fix: extend the sweep to C8 at 44.1 and 48 kHz and record the worst error. If it is over 1 cent, refine the estimate with a spectral peak interpolation.
Effort: S

### Metronome gate ignores frame length and output latency
Evidence: the gate checks `ctx.currentTime` against [click - 10 ms, click + 80 ms] (`shared.ts:42`, `gestures.ts:31-37`). But the analyser frame holds the previous ~85 ms of audio, and the click reaches the mic after `outputLatency` (plus the acoustic path). A click 90 ms old is still in the frame but not gated; on Bluetooth output the click arrives after the gate has closed.
Fix: add `latency` and `frameDuration` parameters to `nearClick` and gate when a click falls in `[now - frameDuration - latency - after, now - latency + before]`, with latency from `ctx.outputLatency || baseLatency`. Extend the `ui-core.test.ts` cases.
Effort: S

### Gating stays on when the click is inaudible
Evidence: with headphones the mic never hears the click, but `ignoreClick` still discards frames (`shared.ts:42`), up to most of the time at fast subdivided tempos.
Fix: over the first 4 clicks, compare mic energy in a 30 ms window after each click with the energy before it. If there is no rise over 3 dB, disable gating for the session and show "Metronome not heard by mic, reading continuously".
Effort: S

### The tuner reads the app's own reference tones
Evidence: "Hear target" (`tuner.ts:177`), the string reference drone (`tuner.ts:344`) and the follow drone (`tuner.ts:269`) all play through the speakers while the mic listens, and only metronome clicks are gated. The tuner then reports the reference as your note, often "in tune".
Fix: expose the active reference frequencies from `droneBank` and `voices`. While one sounds, show a "Reference playing" badge. Optionally ignore readings within 3 cents of an active reference with clarity above 0.97, or add "Pause listening while the reference plays" for string references. E2E with a fake mic that loops back the output.
Effort: M

### Follow drone can sustain itself forever
Evidence: `followNote` returns early when no note is detected (`tuner.ts:258`), so the drone never stops when you stop playing. Through speakers, the mic hears the drone, detects the same note, and keeps it alive.
Fix: track the last time the player's note was voiced and call `stopFollow()` after 0.6 s without it. Move the logic into a pure state machine and unit test that the release happens.
Effort: S

### Follow drone and string references can be inaudible on phones
Evidence: the follow drone plays the detected MIDI note as-is (`tuner.ts:269`), and string references play the string pitch (`tuner.ts:344`). A tuba's B♭1 (58 Hz) or a bass low E (41 Hz) is barely reproduced by phone speakers [unverified typical roll-off].
Fix: add an "Reference octave: same / up one / up two / auto (at least 110 Hz)" setting applied in both `followNote` and `pressString`.
Effort: S

### Strings mode needle is noisier than chromatic mode
Evidence: strings mode computes cents from `f.frequency` (`tuner.ts:396`), which is only median-filtered. Chromatic uses the EMA-smoothed `f.displayCents`, so the same Steadiness setting jitters more in strings mode.
Fix: have the tracker publish a smoothed frequency (EMA in the cents domain) and compute string cents from that. Unit test with jittery input.
Effort: S

### Far-detuned strings are assigned to the wrong string and give the wrong direction
Evidence: `nearestString` (`instruments.ts:52-65`) picks the closest target. A guitar G3 string 260 cents flat is 240 cents above D3, so it is read as the D string. `tuner.ts:401` then clamps to +50 and tells the player to tune down, which is the wrong direction.
Fix: keep the active string while the pitch glides continuously; only switch after 300 ms stable near another string. When the reading is more than 50 cents off, show "Tune up 2.6 semitones" instead of clamping. Add a test at that ambiguous frequency.
Effort: S

### Manually selected string gives nonsense for other strings
Evidence: with a manual string (`tuner.ts:393-396`), every sound is measured against that string. Playing a neighbour string pegs the needle at ±50 with no explanation.
Fix: when the reading is more than 150 cents off and another string is within 50 cents, show "Sounds like the D string" with a tap to switch.
Effort: S

### Pluck and strike transients pollute readings
Evidence: every non-held frame counts toward the in-tune state and the session meter (`tuner.ts:411-438`), including the pitch transient at the start of a pluck, which is typically sharp [unverified magnitude].
Fix: detect onsets (level rises more than 6 dB within 50 ms) and ignore the first 120 ms in strings mode for the hold timer and session stats. Unit test with a synthetic tone gliding from +15 cents to 0 over 150 ms.
Effort: S

### Reference tone cannot be configured
Evidence: string references are always the 'strings' timbre at 0.7 volume and stop after 4 s (`tuner.ts:344-345`). "Hear target" forces at least 0.5 volume (`tuner.ts:177`), overriding a lower drone volume.
Fix: add reference options: timbre (defaulting to the drone timbre), length (4 s, until tapped, or a repeating pluck every 2 s) and its own volume. Apply them in `pressString` and the "Hear target" handler.
Effort: S

### No custom string tunings, capo or per-string offsets
Evidence: tunings are hard-coded (`instruments.ts:12-26`). There are no open G/D/E tunings, no capo, and no per-string cent offsets like Peterson's "Sweeteners" [unverified]. GuitarTuna ships a large tuning library [unverified].
Fix: store user tunings as `{id, label, strings, centOffsets?, capo?}` in settings. Add an editor sheet with per-string note pickers and an offset stepper. `stringFrequency` adds the capo semitones and offsets. Unit tests for capo and offsets.
Effort: M

### Common instruments and tunings are missing
Evidence: the list (`instruments.ts:12-26`) has no 7/8-string guitar, 6-string bass, 12-string, low-G, baritone or tenor ukulele, tenor banjo, bouzouki, oud, erhu, sitar, lever or pedal harp, viola da gamba, or double bass solo tuning.
Fix: add data entries, checking each tuning against a primary source (instrument society or maker documentation) first, since my recall of them is [unverified]. Harps (dozens of strings) need a horizontally scrolling string strip.
Effort: S (data), M (harp UI)

### Pure fifths offered for mandolin
Evidence: `instruments.ts:24` sets `pureFifthsFrom` for mandolin. Frets are equal tempered, so pure open fifths make fretted notes disagree with the open strings [my belief, unverified by measurement].
Fix: remove it for mandolin, or keep it with a hint that it suits unfretted instruments only.
Effort: S

### String buttons wrap into two rows on phones
Evidence: 58 px buttons with 8 px gaps (`styles.css:1726-1736`) need 388 px for 6 strings, wider than a 360 px phone. `flex-wrap` then splits the strings into two rows and breaks the low-to-high order.
Fix: use a grid of `repeat(n, minmax(40px, 1fr))` and scroll horizontally above 8 strings. E2E screenshot at 320 px wide.
Effort: S

### String buttons show state by colour only and have no labels
Evidence: `renderStrings` only toggles colour classes (`tuner.ts:319-322`), drawn as a border and dot colour (`styles.css:1773-1790`). There is no arrow or text, no `aria-label`, and no `aria-pressed` for the manual selection.
Fix: add an up, down or check glyph span, `aria-label` like "D3 string, 12 cents flat", and `aria-pressed` for manual selection. Add an axe-core check to the e2e run.
Effort: S

### The whole display is one button that hides the readout
Evidence: `tuner.ts:187` wraps the ring, bar and strobe in a `<button aria-label="Start or stop the tuner">`. The label replaces the note and cents text for screen readers, and there is no `aria-pressed` for the listening state.
Fix: make the stage a `div`. Add a real Start/Stop button with `aria-pressed`, and put the note and cents in an element screen readers can reach on demand. Check the reading order with NVDA and VoiceOver.
Effort: S

### Trace and tendencies have no text alternative
Evidence: the trace canvas is `aria-hidden` (`tuner.ts:184`) and tendency details live only in `title` attributes (`tuner.ts:232`), which touch users and many screen readers never get.
Fix: add a visually hidden table (note, average, spread, readings) and a one-line trace summary such as "Last 10 s: mostly 6 cents sharp".
Effort: S

### No non-speech audio feedback for players who cannot see the screen
Evidence: the only non-visual feedback is speech, throttled to one announcement every 1.5 s (`controls.ts:145`). There is no way to tune by sound cues.
Fix: add an optional sonified tuner for headphones. Tick rate grows with the size of the error, a rising tone means flat and a falling tone means sharp, silence means in tune. Gate those sounds out of the tracker the same way clicks are.
Effort: M

### No forced-colors (high contrast) support
Evidence: `styles.css` has no `forced-colors` rule. The ring relies on CSS-variable strokes and a translucent zone (`styles.css:1317-1345`), which may vanish or merge in Windows High Contrast [unverified exact rendering].
Fix: add `@media (forced-colors: active)` mapping strokes to `CanvasText` and `Highlight` and dashing the in-tune zone. Test with Edge DevTools forced-colors emulation.
Effort: S

### Strobe ignores reduced motion
Evidence: the reduced-motion rule (`styles.css:3751`) only affects CSS animations. The strobe scrolls by JavaScript (`tuner.ts:140-163`).
Fix: check `matchMedia('(prefers-reduced-motion: reduce)')` and draw static offset bands, or suggest the bar view.
Effort: S

### The strobe is not a real strobe
Evidence: `drawStrobe` moves the bands using the same smoothed cents value as the needle (`tuner.ts:153`, `intonation.ts:6`). It shows nothing the needle does not, and cannot show sub-cent drift or tone stability the way a phase-based strobe can (Peterson [unverified internals]).
Fix: demodulate the signal against quadrature oscillators at the target frequency, low-pass the result, and use `atan2` for the band phase. Test: a synthetic tone 0.3 cents sharp at A4 rotates at `440 x (2^(0.3/1200) - 1)` cycles per second.
Effort: M

### Strobe partial rows are made up
Evidence: rows two and three just move at 2x and 4x the cents value (`tuner.ts:152-153`), but the comment calls it a multi-band strobe. A real multi-band strobe shows each partial's own deviation, including inharmonicity on piano and bass.
Fix: short term, relabel the rows as magnified views. Long term, run the demodulation above at 2f and 4f. Test with a tone whose second partial is 3 cents sharp.
Effort: S (relabel), M (real)

### Every display is fixed at ±50 cents
Evidence: the ring uses 2.4 degrees per cent (`pitchRing.ts:11`), the bar 1% per cent (`tuner.ts:464`), the trace ±50 (`tuner.ts:490`). At Ultra ±1 the in-tune zone is 2.4 degrees wide and small errors are hard to see.
Fix: add a scale setting (±50, ±20, ±10 or auto). Auto zooms to ±10 after 500 ms within 10 cents. Put the cents-to-angle and cents-to-percent mapping in a pure function with unit tests.
Effort: S

### Ring cents ticks have no numbers
Evidence: ticks are drawn every 5 cents with no labels (`pitchRing.ts:59-66`), so a deviation cannot be read off the ring.
Fix: add small labels at ±25 and ±50 (and ±5, ±10 when zoomed).
Effort: S

### Bar scale labels are wrong
Evidence: `tuner.ts:122` labels only values where `c % 25 === 0`. With 10-cent steps that is just -50, 0 and 50, and they print without a sign.
Fix: label every 20 cents with a sign, or put ♭ and ♯ markers on the two halves.
Effort: S

### Readout precision too coarse for fine work
Evidence: cents are rounded to whole numbers and replaced by the words "in tune" (`tuner.ts:457-460`). Hz shows one decimal (`tuner.ts:477`), which at 41 Hz is about 4 cents.
Fix: add a "Decimal cents" option, on by default when tolerance is 2 or less. Keep the number visible next to an "in tune" badge. Show two decimals of Hz below 100 Hz.
Effort: S

### Tolerance choices are limited
Evidence: `RANGES` (`tuner.ts:19-24`) offers only 1, 2, 5 and 10 cents.
Fix: add a custom stepper from 0.5 to 25 cents. The ring already supports a 0.5 cent minimum (`pitchRing.ts:132`).
Effort: S

### In-tune lock is fixed and silent on iPhone
Evidence: `HOLD_SECONDS` is fixed at 1.2 (`tuner.ts:17`). The only confirmation is `haptic(12)` (`tuner.ts:438`), and the README says vibration is unavailable on Safari.
Fix: make the hold time adjustable from 0.5 to 5 s. Add an optional short soft chime on lock, gated from the tracker.
Effort: S

### The reading disappears as soon as the note ends
Evidence: readings are held only 150 to 700 ms (`pitchTracker.ts:8-10`). A wind player who looks at the screen after the note has ended sees nothing. KORG and BOSS tuners have a hold mode [unverified].
Fix: add "Keep last note on screen": after silence, show the last note and cents greyed with "2 s ago" until the next note.
Effort: S

### No steadiness feedback per long tone
Evidence: spread is only reported per pitch class across all sessions (`intonation.ts:34-43`). Long-tone practice gets no per-note result.
Fix: run `segmentNotes` on live readings. When a held note ends, show "A4 held 6.2 s, ±3.1¢ spread, drifted -4¢" for a few seconds.
Effort: S

### Trace cannot show which note was played
Evidence: `drawTrace` (`tuner.ts:484-518`) plots cents only, always 10 seconds, with no pause. Moving from A to B looks like one continuous line.
Fix: break the line at each note change and label it with the note name. Tap to freeze, and drag to scroll back through a 60 s buffer.
Effort: S

### Tendencies mix incompatible data
Evidence: `tuner.ts:414` stores stats under the written (transposed) pitch class with cents measured against the current temperament and A4. Changing transposition, temperament or A4 mixes different meanings into the same bars.
Fix: key stats by concert pitch class plus a tuning fingerprint (`a4|temperament|tonic`). Show them transposed. Mark existing data as legacy. Unit test the keys.
Effort: S

### Tendencies include slides and attacks, weighted by frame rate
Evidence: every non-held frame is recorded (`tuner.ts:411-417`), including note transitions, and each frame counts once regardless of refresh rate.
Fix: record only frames inside a note that has been stable for at least 300 ms, and weight by elapsed time rather than frame count. Test with a synthetic slide.
Effort: S

### Tendencies never age
Evidence: sums accumulate forever (`tuner.ts:205-211`), so improvement over months never shows.
Fix: store per-day buckets, or apply exponential decay with a half-life setting. Show "last 7 days" next to "all time".
Effort: S

### Tendencies grid overflows on narrow phones and hides large values
Evidence: 12 columns (`styles.css:1534-1536`) with nowrap labels (`styles.css:1574-1583`) overflow at 320 px. Bars are clamped to ±25 (`tuner.ts:228`) with no sign that a value is beyond that.
Fix: use two rows of 6 below 420 px via a container query, and add an arrow cap on clamped bars.
Effort: S

### Saving tendencies re-renders the whole tuner every 5 seconds
Evidence: `flushTendencies` runs every 5 s (`tuner.ts:214`) and calls `updateSettings`. That fires `applySettings` (`tuner.ts:556-573`), which rebuilds the tendencies, redraws the trace, re-renders the strings row, and notifies every other settings subscriber, all while tuning.
Fix: give tendencies their own store or event channel, or make `applySettings` compare only the keys it uses. Confirm with the performance panel.
Effort: S

### New DOM nodes every frame
Evidence: `freqEl.replaceChildren(h(...))` creates new nodes every frame (`tuner.ts:476-480`). `root.querySelector('.tuner')` runs up to 4 times per frame (`tuner.ts:443,449,468`), plus a `prettyName` regex per frame.
Fix: create the spans once and set `textContent` only when the text changes, and cache the view element. Compare allocation counts over 10 s in a performance profile.
Effort: S

### Expensive canvas drawing every frame
Evidence: `drawTrace` strokes every segment separately and calls `cssVar` (which uses `getComputedStyle`) 4 times per frame (`tuner.ts:491-497`). The strobe calls it again (`tuner.ts:150`).
Fix: cache colours and refresh them on theme or settings change, batch segments by colour into one path each, and draw the trace at 30 fps.
Effort: S

### Hidden ring still updates, and every write happens even when nothing changed
Evidence: `ring.update` runs every frame even in bar or strobe view (`tuner.ts:442,467`). It rewrites the zone path (`pitchRing.ts:133`) and toggles 12 class lists (`pitchRing.ts:147-149`) regardless of changes.
Fix: skip updates for hidden displays, and cache the last tolerance and active pitch class to avoid unchanged writes.
Effort: S

### Glow filter repaints on every frame
Evidence: the ring tip uses an SVG Gaussian blur filter (`pitchRing.ts:72`) and moves every frame, which likely forces a filter repaint each time on phones [my belief].
Fix: replace it with a pre-rendered radial-gradient halo, then compare paint time in DevTools.
Effort: S

### Bar needle animates `left`
Evidence: `.bar-needle` transitions `left` over 90 ms (`styles.css:1639`). That forces layout on every move and adds lag on top of the EMA.
Fix: animate `transform: translateX()` and drop the transition when Steadiness is Responsive.
Effort: S

### Ring rotation lags in fast passages
Evidence: the ring turns with a 450 ms transition (`styles.css:1383`). In a scale at 8 notes per second it is always mid-turn and the active label is hard to read.
Fix: skip the animation when the note changes within 300 ms of the last change, and add a "Fixed ring (C at top)" option.
Effort: S

### Stopping leaves a stale reading
Evidence: `toggle()` on stop (`tuner.ts:360-367`) only changes the hint and meta text. The ring, needle, colour classes and note name keep showing the last live reading.
Fix: on stop, call `ring.update` with no pitch, remove `has-note`, `in-tune`, `sharp` and `flat`, and centre the needle.
Effort: S

### A second tap during the permission prompt starts instead of cancelling
Evidence: `toggle()` checks `tracker.running` (`tuner.ts:360`), which is false while `start()` waits for permission, so a second tap calls `start()` again.
Fix: track a `starting` state in the view. A second tap calls `tracker.stop()`, which already sets `wanted = false`, and the display shows "Waiting for microphone permission".
Effort: S

### Microphone errors give no recovery steps
Evidence: `context.ts:50-52` covers every failure with two generic messages. A mic already in use by another app gets the same text as a missing mic.
Fix: map `NotReadableError` ("Another app is using the mic") and `OverconstrainedError` separately. Use `navigator.permissions.query({name: 'microphone'})` where supported [unverified support in Safari and Firefox] to show browser-specific steps before and after a denial.
Effort: S

### No auto-start even when permission is already granted
Evidence: the PWA opens on the tuner (`manifest.webmanifest:5`) but always waits for a tap (`tuner.ts:111`).
Fix: add a "Start listening automatically" setting. When permission is granted, start on mount, resuming the AudioContext on the first touch if the browser requires a gesture.
Effort: S

### No stop after silence, and practice time counts silence
Evidence: `ActivityTimer` (`tuner.ts:96,371`) logs wall-clock time even if the tuner sits silent for an hour. That inflates practice history, drains battery and keeps the mic open.
Fix: stop after N minutes with no voiced frames (setting, default 5) and log only the voiced time.
Effort: S

### Keyboard shortcuts are thin and Space gets swallowed
Evidence: `onKey` ignores Space when the focus is a button (`tuner.ts:578`). After clicking "Hear target", Space replays the target instead of toggling the tuner. There are no keys for display mode, A4 or string selection.
Fix: toggle on Space unless the focused element is a form control other than the stage. Add R, B, S for displays, [ and ] for A4 ±0.5, left and right arrows for strings, Enter for hear target. List them in the shortcuts sheet.
Effort: S

### A4 range and presets exclude historical and regional pitches
Evidence: `stepA4` clamps to 400 to 480 (`tuningSheet.ts:21`). Presets are 415, 430 and 440 to 443 only (`tuningSheet.ts:43`). French baroque pitch (around 392), Chorton (around 466), 432, 435 and Highland pipe chanters (around 480 and rising) are missing or at the edge [values unverified].
Fix: widen the range to 350 to 500 and group the chips as "Baroque / Classical / Modern". Verify each value against a historical pitch source before shipping.
Effort: S

### A4 cannot be typed and steps are coarse
Evidence: the stepper moves 0.5 Hz (`tuningSheet.ts:36-38`) while the stored value supports 0.1, and the value is an `<output>`, not an input.
Fix: make it `input type=number step=0.1` with validation, and show the equivalent cents offset ("441 Hz = +3.9¢").
Effort: S

### Non-equal temperaments move A away from the chosen reference
Evidence: `midiToFrequency` (`notes.ts:115-118`) keeps the tonic equal-tempered, not A. With Just in C and A4 set to 440, the A target is `440 x 2^(-15.64/1200)`, about 436.1 Hz. An ensemble tuned to a 440 A would read its A as about 16 cents sharp.
Fix: add an anchor option, defaulting to "A4 stays at the reference", computing `offset(midi - tonic) - offset(9 - tonic)`. Unit test that A4 equals `a4` exactly for every temperament and tonic.
Effort: S

### Well temperaments labelled with a misleading "Key"
Evidence: `tuningSheet.ts:57` shows "Key (tonic)" for Werckmeister, Vallotti and Young too. Those are defined starting from C (`notes.ts:72-79`), so "Key" suggests they follow the piece's key the way Just does.
Fix: for well temperaments, label it "Temperament starts on (usually C)" and default it to C.
Effort: S

### Tonic picker does not say whether it is concert or written
Evidence: `midiToFrequency` uses concert MIDI, so the tonic is a concert pitch. The rest of the UI shows written notes when a transposition is set. A B♭ clarinetist picking "C" gets concert C, which is their written D.
Fix: label the picker "Key (concert)" when a transposition is active, or offer the picker in written pitch and convert.
Effort: S

### Just intonation ratios are fixed
Evidence: `JUST_RATIOS` (`notes.ts:34`) fixes 9/5, 45/32 and 16/15. There is no 7/4 harmonic seventh (-31.2 cents), 16/9, 10/9 or 64/45, which barbershop singers and brass players need.
Fix: add per-degree ratio alternatives and a 7-limit preset. Tests compare cents to `ratioToCents`.
Effort: S

### Meantone wolf position and enharmonics are fixed
Evidence: `meantoneCents` (`notes.ts:41`) fixes the chain from E♭ to G♯. Rotating the tonic moves the naturals too. A pure A♭ reads as a very sharp G♯.
Fix: add a "Wolf between" option that shifts the chain start independently of the tonic. Test that A♭ exists when the chain runs from A♭ to C♯.
Effort: S

### Temperament targets are invisible
Evidence: in a non-equal temperament the ring shows only deviation from the tempered target (`pitchRing.ts:93-123`). Users never see how far each note is from equal temperament.
Fix: when the temperament is not equal, print each pitch class's offset (for example "E -13.7") under its ring label, and show "vs equal: +x¢" next to the main cents.
Effort: S

### No quick tuning presets
Evidence: A4, temperament, tonic and transposition are separate settings (`settings.ts:27-30`). Moving between a baroque ensemble (415, Vallotti) and a modern band means changing several controls.
Fix: saved tuning presets `{name, a4, temperament, tonic, transposition}` as chips in the tuning sheet. This is separate from item 11's instrument profiles.
Effort: S

### Tonic does not follow the drone
Evidence: the tonic is a global setting (`notes.ts:97-102`). While playing over a drone from the Sound screen, just intonation targets do not move with the drone root.
Fix: add "Tonic follows active drone", reading the lowest active note from `droneBank`. Test: drone on D, and the F♯ target is 5/4 above D.
Effort: S

### No harmonic-partial mode for brass
Evidence: nothing shows where natural partials sit relative to equal temperament: partial 5 is `1200 log2(5/4) - 400 = -13.7` cents, partial 7 is -31.2. That is how brass players reason about slide corrections.
Fix: a "Partial mode" where you pick the fundamental for a valve combination and the tuner shows the partial number, cents from that partial, and cents from equal temperament. Unit test partials 5 and 7.
Effort: M

### No Scala import or wider historical temperament library
Evidence: there are 7 fixed temperaments (`notes.ts:6-14`). Item 15 adds a manual editor, but nothing imports Scala `.scl` files, the common microtonal exchange format [unverified archive size]. Kirnberger III, 1/6-comma meantone, Kellner and Neidhardt are absent.
Fix: an `.scl` parser (skip `!` comments, read cents or ratio lines) mapped to offsets when the scale has 12 notes. Add built-in temperaments from verified definitions. Parser unit tests with sample files.
Effort: M

### No tuning systems with other than 12 notes
Evidence: everything assumes 12 pitch classes: `mod(…, 12)` (`notes.ts:26-27`), `frequencyToNote`, and the 12 ring slots (`pitchRing.ts:93`). 24-EDO quarter tones, 19-EDO and 31-EDO are impossible.
Fix: generalize `TuningSystem` to `{periodCents, steps: number[], names: string[]}` with a nearest-step search. The ring draws N slots. Keep a 12-TET fast path. Test quarter-tone detection in 24-EDO.
Effort: L

### No maqam or makam accidentals
Evidence: there are no half-flat, koron or sori signs and no Turkish comma-based accidentals [unverified system details]. Arabic, Persian and Turkish players cannot see targets like E half-flat.
Fix: on top of the item above, add quarter-tone names using SMuFL glyphs and scale presets checked with musicians from each tradition.
Effort: L

### Tonic cannot be set as a frequency for Indian music
Evidence: the tonic is a pitch class (`notes.ts:101`). A Hindustani or Carnatic Sa can sit at any frequency. Item 16 covers note names only.
Fix: allow the tonic as Hz with ratio-based svara targets (including a 22-shruti table verified with a musician). Test: Sa = 146.0 Hz gives Pa = 219.0 Hz.
Effort: M

### Cannot tune to an existing instrument's own scale
Evidence: there is no way to capture a scale from a real instrument. Gamelan sets, handbell sets or an old piano that must stay in tune with itself do not match any standard [my belief for gamelan].
Fix: "Capture scale": play each note, store the median Hz, save as a named scale, then tune against it.
Effort: M

### Transposition list has wrong octaves and gaps
Evidence: `TRANSPOSITIONS` (`notes.ts:17-24`) puts tenor sax at +2, but by standard convention it sounds a ninth below written (+14). E♭ clarinet is grouped with alto sax at +9, but it sounds a minor third above written (-3) [both standard orchestration conventions, unverified this session]. The displayed octave (`tuner.ts:455`) is therefore wrong. Missing: baritone sax, bass clarinet, piccolo, guitar, double bass, contrabassoon, D and E♭ trumpet, treble-clef euphonium.
Fix: one entry per instrument with signed semitones including the octave, grouped by family. Test: concert B♭3 on tenor sax shows written C5.
Effort: S

### Written and concert pitch cannot be shown together
Evidence: with a transposition set, only the written note is shown (`tuner.ts:405`). A band director working with mixed instruments needs both.
Fix: an optional secondary line "concert B♭" under the note.
Effort: S

### Spelling ignores the key
Evidence: one global `flats` flag (`settings.ts:31`). With tonic F the tuner still shows A♯.
Fix: add "Spelling: sharps / flats / follow key", choosing flats for flat-side key signatures. Unit tests.
Effort: S

### German and solfège naming are incomplete
Evidence: the German tables (`notes.ts:162-163`) swap B and H but show "C#" and "Eb" instead of Cis and Es. Solfège is French fixed-do only. There is no movable do and no Helmholtz octave marks (c', a').
Fix: proper German names (Cis, Dis, Fis, Gis, Ais, Des, Es, Ges, As, B). Add an Italian spelling option, movable do relative to the tonic, and an octave-notation setting. Unit tests.
Effort: S

### No note lock or arbitrary target
Evidence: chromatic mode only measures against the nearest note (`notes.ts:130`). Timpani, slide positions, handbells and arbitrary frequencies (a 432.1 Hz bowl, for example) need a fixed target. Peterson has a note lock [unverified]. "Hear target" only plays the last detected note.
Fix: tap a ring note or enter a Hz value to lock the target. Display semitones and cents away (for example "-3 st +12¢"). Long-press a ring note to hear it. An Auto chip unlocks.
Effort: S

### No timpani mode
Evidence: timpani notes decay quickly and are inharmonic. The 150 to 700 ms hold (`pitchTracker.ts:8-10`) flickers and nothing supports pedal tuning while tapping softly.
Fix: an onset-triggered mode that analyses 50 to 400 ms after each strike with a large FFT and interpolated peak picking, holding the value until the next strike. Combine with note lock. Validate on recorded timpani, after checking the sample license.
Effort: L

### No bell or handbell partial analysis
Evidence: bells have several strong partials (hum, prime, tierce, quint, nominal [unverified naming]). YIN reports whichever periodicity dominates, which may be the wrong partial.
Fix: a mode listing the 5 strongest spectral peaks with note and cents, where the user picks the reference partial.
Effort: L

### No piano stretch tuning
Evidence: targets are ideal equal temperament only. Piano strings are inharmonic, and tuners use stretched octaves. Apps such as TuneLab measure inharmonicity [unverified].
Fix: a piano mode that measures partials 1 to 6 per note with a 32768-point FFT, estimates the inharmonicity coefficient B, and derives stretched targets by matching the 4:2 octave partials. Store per-piano profiles and validate on a real piano.
Effort: L

### No beat-rate meter
Evidence: piano unisons, accordion tremolo reeds, organ celestes and two players tuning together all produce beats. Nothing measures them.
Fix: band-pass around the target, take the envelope, autocorrelate it over 0.2 to 15 Hz, and show "2.3 beats per second, 3.1¢ apart". Test with two sines 1 Hz apart.
Effort: M

### No aural temperament-setting aid
Evidence: the temperament tables exist (`notes.ts:81-89`), but there are no expected beat rates, which keyboard tuners use to set a temperament by ear.
Fix: compute the beat rates of coincident partials (`|n x f2 - m x f1|`) for fifths, fourths and thirds in the tuning octave for the current temperament, and list them. Unit test against the formula.
Effort: M

### No instrument tendency reference or guided tuning
Evidence: the app measures tendencies (`tuner.ts:194-239`) but never explains them. There are no per-instrument notes on known problem pitches and no plain-language actions such as "pull the slide out" or "loosen the string".
Fix: a data file of per-instrument tuning steps (which notes to check, and which way to adjust when sharp or flat) and known tendencies, each sourced from a pedagogy reference before shipping. Show it next to the measured tendencies.
Effort: M

### No guitar intonation (saddle) check
Evidence: luthiers compare the 12th-fret harmonic with the fretted 12th fret. Peterson offers this workflow [unverified].
Fix: a guided "Check intonation" flow: capture the harmonic, then the fretted note, and show the difference with "move saddle back/forward".
Effort: S

### No explicit measure button
Evidence: readings are always live. Luthiers, tuning-fork checks and science classes need an averaged value.
Fix: "Measure 3 s" captures readings and shows mean Hz, mean cents and standard deviation.
Effort: S

### No pitch-matching practice for singers
Evidence: nothing plays a target and scores singing. TE and vocal apps have something similar [unverified].
Fix: "Match this note": play a target in the singer's range, then score the percentage of time within tolerance after a 500 ms settle. Keep a history.
Effort: M

### No vocal range finder
Evidence: no way to find the lowest and highest comfortable notes.
Fix: a slide mode that records the lowest and highest notes held at least 0.5 s and saves the range for the matching exercise and the follow drone's octave.
Effort: S

### No choir pitch-drift check
Evidence: a cappella choirs drift over a piece, and nothing compares the end pitch with the starting reference.
Fix: "Start reference" captures or sets the key note; "Check" after the piece reports "ended 35¢ flat".
Effort: S

### No ensemble tuning log for teachers
Evidence: there is no way to record a tuning check across players.
Fix: a "Tuning check" sheet: enter player and instrument, capture the median cents over a 2 s held note, list and sort results, export CSV using the existing export code.
Effort: M

### No dual tuner
Evidence: one pitch stream per tracker (`pitchTracker.ts:42`). A teacher and student on a 2-input interface cannot both be tuned at once.
Fix: once channel split exists (item 12 above), run two trackers on the left and right channels with side-by-side compact rings.
Effort: L

### No haptic direction cues
Evidence: haptics fire only on lock (`tuner.ts:438`). Deaf or low-vision players cannot feel sharp versus flat. Existing item 74 covers only metronome haptics.
Fix: on Android, repeating vibration patterns (short-short for sharp, long for flat) behind a setting, rate-limited to once per second.
Effort: S

### Strings mode detection range is not narrowed to the instrument
Evidence: strings mode uses the default 30 to 4200 Hz range (`pitchTracker.ts:108`), so a bass guitar's harmonics or a neighbouring instrument can be picked up.
Fix: pass the lowest string x 0.7 and the highest x 1.5 as min and max frequency from the view to the tracker in strings mode. Test that a harmonic-rich bass tone gives no octave errors.
Effort: S

### "Hear target" can play a target from the previous tuning
Evidence: `lastTarget` is only refreshed from new frames (`tuner.ts:473`). After changing A4 or temperament, the button still plays the old frequency.
Fix: store the last MIDI note instead of Hz and recompute the target with `midiToFrequency(midi, tuningOf(settings))` on click.
Effort: S

### Recorder report and live tuner disagree by design
Evidence: the take report calls `detectPitch` on raw frames with no smoothing or hold (`recorder.ts:328-331`), while the live tuner smooths and holds (`pitchTracker.ts:109-127`). The same playing gives different in-tune percentages.
Fix: extract a pure per-frame processor shared by both pipelines (item below) and run it over recordings with the same settings.
Effort: S

### Idle frame skipping delays note starts
Evidence: with no active note, only every other frame is analysed (`pitchTracker.ts:105`), and `last` resets after every dropout. Every staccato note therefore starts in idle mode.
Fix: skip analysis only when the level is below the sensitivity threshold. Measure onset-to-reading frames before and after with the synthesized e2e mic.
Effort: S

### Tracker logic is untested and response time is unmeasured
Evidence: tests cover only `detectPitch` and `PitchSmoother` (`tests/pitch.test.ts`). Hold, gating, damping and note-jump handling in `PitchTracker.loop` have no tests, and the time from onset to a stable reading has never been measured.
Fix: refactor the loop body into a pure `processFrame(state, samples, now, dt, opts)` and unit test hold, gating, frame-rate independence and hysteresis. Add an e2e step-response check (frames until within 2 cents) and record the result.
Effort: M

### No wide-screen layout
Evidence: the ring is capped at 420 px (`styles.css:1297`), and the trace and tendencies stack below. On tablets and desktops they fall below the fold while side space goes unused. Existing item 64 covers phone landscape only.
Fix: a 900 px and wider two-column grid: ring and meta on the left, trace, tendencies and strings on the right.
Effort: S
