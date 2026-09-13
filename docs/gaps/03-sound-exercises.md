# Sound and exercises

### Scale in thirds repeats the top note (three times in up and down)
Evidence: src/core/exercises.ts:22-27 adds the final pair (69,72) and then pushes 72 again. I ran it with tsx this session: `buildExercise('thirds',60,1,'up')` gives `[...,69,72,72]`, and 'upDown' gives `[...,69,72,72,72,69,...]`. tests/exercises.test.ts:21-23 only checks the first six notes and the last one, so it misses this.
Fix: in `ascending()` skip `out.push(last)` when the last pair already ends on the top root. In `buildExercise` drop a duplicate where up meets down. Add a test asserting no two consecutive notes are equal for every pattern and direction.
Effort: S

### Scale in thirds leaves out the last pair
Evidence: exercises.ts:26 stops at `i + 2 < notes.length`, so C major ends A C, C. The usual figure is A C, B D, C.
Fix: build the scale one extra degree past the top root (to the 9th), pair up to the 7th degree, then end on the root. Unit test `[...69,72,71,74,72]`.
Effort: S

### Melodic minor comes down in its ascending form
Evidence: exercises.ts:7 has one step set, and `buildExercise` mirrors it (lines 35-37). Classical melodic minor descends as natural minor.
Fix: add an optional `stepsDown` to the pattern definition (natural minor for melodicMinor). Build the descending half from it in 'down' and 'upDown'. Add a "Jazz melodic minor" pattern that stays the same both ways. Unit test the descent.
Effort: S

### Just intonation chords are wrong on any root other than the tonic
Evidence: sound.ts:32 adds intervals to the root, and `midiToFrequency` (notes.ts:115-118) takes every pitch class relative to the global `tonic`. With Just and tonic C, the E major third E to G# is +13.7 cents (8/5) against -13.7 cents (5/4), about 427 cents instead of 386. My arithmetic from the JUST_RATIOS table.
Fix: add a "Pure chord" option to `press()`. Tune the root from the temperament, then set each chord member to `rootHz * justRatio(interval)` from `INTERVALS[].just` (src/core/intervals.ts). droneBank needs `noteOnHz(key, hz)` for this. Unit test: E major third within 0.1 cent of 386.3.
Effort: M

### Exercise scales in non-equal temperaments use the global tonic, not the exercise root
Evidence: sound.ts:345-350 builds on `rootPc` but tunes with `tuningOf(s)`, whose tonic is set elsewhere. A D major scale in Just with tonic C is not a just D scale.
Fix: in `toggle()` pass `{...tuning, tonic: rootPc}` to `midiToFrequency`. Show "tuned to D" in the card. Add an option to keep the global tonic.
Effort: S

### Temperament tonic does not follow the drone root
Evidence: droneBank.ts:44 uses `tuningOf(s)` with the stored tonic. Nothing on the Sound screen sets the tonic.
Fix: a "Tonic follows lowest drone" toggle. In `notify()`, when on and the temperament is not equal, set `tonic = mod(min(activeNotes), 12)`. Show it on the tuning chip.
Effort: S

### In sustain mode, pressing a chord that shares notes turns those notes off
Evidence: sound.ts:34-35. `anyOn` is true when any target is on, so with C major on, pressing A minor (A C E) turns off C and E and never starts A.
Fix: track chords as objects `{root, intervals}` in the view. A press toggles that chord's ownership, and a note stops only when no chord owns it. Test: C major then A minor leaves A C E G sounding.
Effort: M

### Momentary mode: a quick first tap leaves a drone stuck on
Evidence: droneBank.ts:39-46 awaits `ensureRunning()` before `active.set`. `release()` (sound.ts:40-43) calls `noteOff` right away, finds nothing, and the drone starts afterwards and never stops.
Fix: in droneBank keep a `pendingOff` set checked after the await, or give each noteOn a token that release cancels. Unit test with a mocked `ensureRunning` that resolves late.
Effort: S

### Changing chord while holding a note leaves notes stuck
Evidence: sound.ts:42 works out the intervals to release from the current chord setting, not the one used on press.
Fix: store the targets played on press in `pressedKeys` (pointerId to midi[]) and in the wheel drag state, and release exactly those.
Effort: S

### Two fingers on the same key: lifting one stops the note
Evidence: sound.ts:128-161 maps pointer to midi with no reference count, and `noteOff` is unconditional.
Fix: reference count holds per midi in the view. Call noteOff only when the count reaches 0.
Effort: S

### The wheel only tracks one finger
Evidence: sound.ts:80-82 keeps one `dragPc`/`dragOct`/`dragAngle`. A second pointerdown overwrites them and orphans the first finger's notes.
Fix: key drag state by `pointerId` in a Map and process each pointer separately. Test with two synthetic pointer ids.
Effort: S

### Wheel octave wrap is missed on fast drags or through the centre
Evidence: sound.ts:107-108 changes octave only when the previous wedge is 11 and the new one is 0. A fast move from wedge 10 to 1, or leaving the ring (pc null, line 105) and coming back, skips the wrap.
Fix: add up the unwrapped angle from `angleDelta` since pointerdown and derive the absolute step as `round(totalAngle/30)`. Semitone = start + steps, and octave comes from that.
Effort: S

### Dragging on the wheel stops drones the user had already sustained
Evidence: sound.ts:111 calls `noteOff(fromRoot + i)` whether or not the drag started that note.
Fix: remember whether the drag created each note (use `noteOn`'s boolean result) and turn off only those.
Effort: S

### "Glide" is a series of new drones, not a pitch glide
Evidence: sound.ts:111-115 stops one Drone and creates another for every wedge, so each step is a 50 ms fade out and fade in (voices.ts:352, 360). Nothing slides continuously.
Fix: during a drag keep the same Drone objects and call `setFrequency` with a portamento time constant set by the user (0 to 300 ms). Re-key droneBank entries when the drag ends. Add an optional continuous mode where angle maps to cents.
Effort: M

### Scrolling the keyboard plays notes
Evidence: styles.css:2517 sets `touch-action: pan-x` and sound.ts:151-155 starts notes on pointerdown. A horizontal swipe toggles drones in sustain mode before the browser sends pointercancel.
Fix: on touch pointers wait until 8 px of movement or 80 ms before sounding, and cancel if pointercancel arrives. Or add a scroll strip above the keys with `touch-action: none` on the keys.
Effort: S

### Enter or Space on a key ignores chord and sustain modes
Evidence: sound.ts:164-169 calls `toggleNote(m)` directly, not `press`/`release`.
Fix: on keydown call `press(m)`; on keyup call `release(m)` (ignore repeat events).
Effort: S

### No glissando across piano keys
Evidence: sound.ts:152 captures the pointer on the pressed key, so moving onto another key does nothing.
Fix: capture on `.piano`, find the key with `document.elementFromPoint` on pointermove, and release and press as the finger crosses keys.
Effort: S

### Keyboard covers C1 to C7 only; octave 0 has no keys
Evidence: sound.ts:133-134 (24 to 96). setOctave allows 0 (line 196), and then `scrollPianoToOctave` finds no C0 key and silently does nothing. A0, B0 and C8 are missing.
Fix: build A0 (21) to C8 (108) to match an 88-key piano. Clamp the octave control to what the keys cover.
Effort: S

### Turning sustain off kills drones started elsewhere
Evidence: sound.ts:192 and 294 call `stopAll()`, which also stops metronome preset drones (metronome.ts:358-360) and the tuner's follow drone.
Fix: add an owner tag in droneBank (`noteOn(midi, owner)`) and `stopOwner('sound')`. Stop only notes this view started.
Effort: S

### Sustain mode is not remembered
Evidence: sound.ts:24 `let sustain = true` resets every time the view mounts.
Fix: add `drone.sustain` to settings (settings.ts:69) and read and write it.
Effort: S

### Exercise settings reset when you leave the screen
Evidence: sound.ts:301-309 keeps pattern, root, octave, range, direction, note length and toggles in local variables.
Fix: add an `exercise` object to Settings, restore it in `exercisePlayer`, and update it in each onChange.
Effort: S

### Root picker note names do not update when flats or notation change
Evidence: sound.ts:404 builds labels from `s0.flats` once.
Fix: rebuild the select options inside a settings subscription.
Effort: S

### Exercise click sounds on every note, not on the beat
Evidence: sound.ts:378 plays a click for each note event. With half-beat notes it clicks eighths, and with half notes every other beat.
Fix: schedule clicks on their own beat grid, `k * 60/bpm`, in the same `next()` loop (an event type flag). Accent the first beat of each group.
Effort: S

### Count-in length follows note length
Evidence: sound.ts:363 and 369 use two events spaced by `dur`. With half-beat notes the count-in is two eighths, and with half notes it is two half notes.
Fix: count in one bar of beats (`metronome.beatsPerBar` at 60/bpm), then start notes. Let the user choose 0, 1 or 2 bars.
Effort: S

### Count-in sound is fixed and follows the metronome volume
Evidence: sound.ts:373 hard-codes 'tick' at `s.metronome.volume`. With the metronome volume at 0 the count-in is silent.
Fix: use `s.metronome.sound` and give the count-in its own minimum level. Show a visual count as well.
Effort: S

### Stopping an exercise leaves sound playing briefly
Evidence: scheduler.ts:36 schedules 120 ms ahead. `playTone` (voices.ts:270-290) returns no handle, so tones already queued, some up to two beats long, keep playing after Stop (sound.ts:320-324).
Fix: route exercise tones through one per-run `GainNode`, and on stop ramp it to 0 over 20 ms and disconnect it. Or have `playTone` return a `stop(t)` handle kept in a list.
Effort: S

### Looping is not seamless
Evidence: sound.ts:389-392 restarts through `finish()` and `toggle()`. That means a 300 ms end delay (scheduler.ts:60) plus the 80 ms start delay, the count-in again, and the root drone released and started again (sound.ts:330, 353).
Fix: loop inside `next()`: when `i` reaches the end, wrap with a time offset of `notes.length * dur` and keep the drone and scheduler running. Count in only once. Add an optional rest of N beats between loops.
Effort: S

### Tempo, timbre and volume are frozen when an exercise starts
Evidence: sound.ts:347-350 snapshots `bpm` and `s`, and line 377 uses them for every note.
Fix: read settings inside `next()` and `onSchedule`. Compute each event time by adding up per-note durations, so tempo can change during a run.
Effort: S

### Exercise melody is stuck at 35% volume or louder and shares the drone's timbre
Evidence: sound.ts:377 `Math.max(0.35, s.drone.volume)` with `s.drone.timbre`. The melody and the root drone use the same timbre, which masks the melody, and the melody can never go below 0.35.
Fix: add `exercise.timbre` and `exercise.volume` settings with their own controls and no floor.
Effort: S

### Exercise does not lock to a running metronome
Evidence: sound.ts:344 creates its own `LookaheadScheduler` starting at `currentTime + 0.08`. If the metronome is already running, the two click on unrelated grids.
Fix: if `metronome` (ui/shared.ts) is running, start the exercise on its next bar using the metronome's start time and beat period, and skip the exercise's own click.
Effort: M

### Exercise stops when you change screens
Evidence: sound.ts:293 disposes the player on unmount, while drones keep playing (droneBank.ts:6-9). You cannot play a scale while reading sheet music.
Fix: move the exercise engine into a module like droneBank, and show its transport in the dock.
Effort: M

### Exercise range has no limits
Evidence: sound.ts:405-406. Octave 5 over 3 octaves reaches MIDI 108 (C8), and octave 2 puts the drone at `root-12` = C1, 32.7 Hz (line 352), likely inaudible on phone speakers [unverified per device]. Octaves 1 and 6 cannot be chosen at all.
Fix: allow octaves 1 to 6, clamp the top note to a chosen instrument range (hook into gap item 11 profiles), and let the user pick the drone octave.
Effort: S

### Exercise without a drone is not logged as practice
Evidence: only droneBank logs 'sound' time (droneBank.ts:14-19). sound.ts never calls `logPractice`.
Fix: in `finish()` call `logPractice(elapsed, 'sound')` when the drone was not sounding.
Effort: S

### A forgotten drone logs as practice time
Evidence: droneBank.ts:15-18 counts the whole span from the first drone to the last stop, even with the page hidden.
Fix: pause the count on `visibilitychange` hidden, and cap it at the auto-off time (next item).
Effort: S

### No auto-off for drones
Evidence: droneBank.ts has no timer. Drones play until stopped, even in a background tab.
Fix: a setting "Stop drones after 5/10/20 min or when hidden". Fade out over 2 s and show a toast.
Effort: S

### UI still shows drones on after the audio is interrupted
Evidence: context.ts:22-26 only resumes on demand and has no `statechange` listener. After an interruption such as a phone call the context may leave 'running' [unverified on iOS] while the pills still show notes.
Fix: listen for `ctx.onstatechange`. When the state is not 'running', mark drones paused in the dock with a "Tap to resume" button that calls `ensureRunning()`.
Effort: S

### No limiter on the master output
Evidence: context.ts:10-11 connects gain straight to the destination. Each drone is `volume*0.25*spec.gain` (voices.ts:352), so 6 organ drones at volume 1 can reach 1.5 and clip, and exercise tones add on top.
Fix: insert a `DynamicsCompressorNode` (threshold -6 dB, ratio 20, attack 3 ms) before the destination. Offline test: render 12 drones and check the peak stays at or below 1.
Effort: S

### No cap on how many drones can play
Evidence: droneBank.ts:39-47 accepts any number of notes. Tapping many piano keys in sustain mode adds oscillators without limit.
Fix: cap at 16. Refuse or steal the oldest note, with a toast.
Effort: S

### Changing timbre on a sounding drone clicks
Evidence: voices.ts:325-327 swaps the PeriodicWave and filter cutoff instantly. It also leaves the old vibrato depth gain connected (lines 328-332).
Fix: crossfade by building a new Drone with the new timbre, ramping it up over 60 ms while the old one ramps down. Disconnect the depth node.
Effort: S

### Drone vibrato hides beats and cannot be turned off
Evidence: voices.ts:239-243 gives strings, cello, flute and voice 3 to 6 cents of vibrato (line 333). Hearing beats against a drone needs a steady pitch.
Fix: add a "Vibrato on drones" setting, off by default. Pass a flag into `setTimbre` that skips the LFO for drones and keeps it for exercise tones.
Effort: S

### Every chord voice wobbles at the same vibrato rate
Evidence: voices.ts:334-335 uses the fixed `spec.rate` for every drone, so a chord's voices move in lockstep.
Fix: spread each drone's rate randomly by plus or minus 8% and give it a random start phase.
Effort: S

### Filter cutoff does not follow pitch
Evidence: voices.ts:240 and 327 use a fixed lowpass (cello 2600 Hz). A C6 cello drone keeps about 2 harmonics while C2 keeps about 40, so timbre changes a lot across the range.
Fix: set the cutoff to `min(spec.lowpass, f0 * spec.harmonicsKept)` or `f0 * k` in `setFrequency` and the constructor.
Effort: S

### Timbres never move
Evidence: voices.ts:231-244 uses fixed harmonic amplitudes with no amplitude motion, no noise and no variation between partials, which is why they sound electronic (see gap item 40's review complaint).
Fix: in Drone add a slow random LFO (0.1 to 0.3 Hz, plus or minus 1 dB) on gain, and bandpassed noise at -35 dB for bow or breath on cello, voice, flute and clarinet. Or build two PeriodicWaves with slightly different spectra and crossfade them slowly.
Effort: M

### Exercise notes have one envelope for every timbre and no vibrato
Evidence: voices.ts:279-289 uses a 30 ms linear attack and 120 ms release for every timbre and ignores `spec.vibrato`.
Fix: add `attack`, `release` and `vibratoDelay` to `TimbreSpec` (for example clarinet 40 ms, cello 80 ms, organ 10 ms) and apply them in `playTone`, with a delayed vibrato LFO on longer notes.
Effort: S

### Volume slider is linear, not in decibels
Evidence: sound.ts:262-269 sends 0 to 1 straight into gain (voices.ts:352). Most of the audible change is bunched at the low end.
Fix: map the slider to decibels, `gain = 10^((v*40-40)/20)` with 0 as mute, and label it in dB.
Effort: S

### Low drones are quiet or missing on phone and laptop speakers
Evidence: timbre gains are the same in every register (voices.ts:228-244). Octave 0 and 1 drones (16 to 60 Hz) are below what small speakers reproduce [unverified per device].
Fix: add register loudness compensation (a gain tilt below 200 Hz) and a "Small speaker" option that adds a quiet octave above any drone under 110 Hz.
Effort: S

### Drone release may jump in level
Evidence: voices.ts:359-360 calls `cancelScheduledValues(t)` and then `setTargetAtTime`. If the gain is still mid-swell, cancelling can snap it to a level before the fade [unverified; behaviour differs between the old and new spec wording].
Fix: use `cancelAndHoldAtTime(t)` where it exists, falling back to `setValueAtTime(gain.value, t)`. Offline render test: stop a drone 20 ms after start and check there is no sample step larger than 0.01.
Effort: S

### Any settings change re-sends pitch and volume to every drone
Evidence: droneBank.ts:23-29 runs `setFrequency` and `setVolume` on every drone for every settings update, including metronome tempo drags and history writes.
Fix: remember the last `a4|temperament|tonic|volume` key and skip when it has not changed.
Effort: S

### No control over fade-in and fade-out time
Evidence: voices.ts:352 and 360 use fixed 50 ms time constants.
Fix: add `drone.fadeIn` and `drone.fadeOut` settings (0.05 to 5 s) passed to Drone. A slow fade-in lets a player start inside the drone.
Effort: S

### No per-drone volume, timbre or pan
Evidence: droneBank.ts:44 and 72-74 apply the global `drone.timbre` and `drone.volume` to every note, so a fifth cannot sit below its root, and a cello root cannot have a clarinet fifth.
Fix: store `{timbre, volume, pan}` per active note in droneBank. In the pills, a long press opens a small popover with the three controls. Add `StereoPannerNode` in Drone.
Effort: M

### No cents detune per drone voice
Evidence: nothing in droneBank or Drone offsets a note from its tempered frequency.
Fix: add a `detune` in cents per active note (Drone `osc.detune` base value, summed with the vibrato), plus buttons for "pure third (-13.7)" and "pure fifth (+2.0)" computed from `INTERVALS`.
Effort: S

### No beat-hearing generator
Evidence: nothing plays two tones a controlled number of cents apart. Hearing beats is the main use of a drone for intonation.
Fix: a "Beats" panel: reference note plus a second tone at an interval and plus or minus N cents, showing the expected beat rate, computed as `|p*f2 - q*f1|` for the coinciding partials. A slider sweeps through 0.
Effort: S

### No way to pause drones and keep the set
Evidence: only `noteOff`/`stopAll` exist (droneBank.ts:49-66).
Fix: a "Mute" button that ramps a shared drone bus to 0 and keeps the active map, and a "Resume" button.
Effort: S

### Presets remember drone notes only, not how they sounded
Evidence: settings.ts:19-20 saves `drones?: number[]`. metronome.ts:358-378 restores only the notes, so timbre, chord, volume, detune and temperament are lost.
Fix: add a `DronePreset {notes, timbre, volume, perNote, temperament, tonic, a4}`, saved from the Sound screen and referenced by metronome presets. Add a favorites row on the Sound screen.
Effort: M

### Octave buttons do not move sounding drones
Evidence: sound.ts:195-198 changes only the octave setting.
Fix: a "Move sounding notes" option. When on, retune each active note by 12 semitones with `setFrequency` and re-key it in droneBank.
Effort: S

### Changing the chord does not change the sounding chord
Evidence: sound.ts:236 only updates the setting.
Fix: when the view owns exactly one chord, stop and start it with the new intervals (needs the chord ownership model above).
Effort: S

### Only 5 chord shapes
Evidence: sound.ts:13-19 has single, fifth, octave, major and minor. There is no root with fifth and octave, sub-octave, sus2, sus4, dominant 7, major 7, minor 7, diminished, augmented, or major and minor sixth.
Fix: extend `CHORDS` with these (allow negative intervals for a sub-octave) and show them in a grouped select instead of the segmented control.
Effort: S

### No chord inversions or open voicings
Evidence: `CHORDS` intervals are root position only, within an octave (sound.ts:13-19).
Fix: add an inversion select (root, 1st, 2nd) that moves the lowest notes up an octave, and an "open" voicing (root, fifth, tenth). Use a pure transform `voice(intervals, inversion, spread)` in src/core with unit tests.
Effort: S

### No tanpura drone
Evidence: all drones are sustained oscillators (voices.ts:293). Indian classical practice uses a cycling plucked Pa-Sa-Sa-Sa (or Ma or Ni) drone. Tanpura apps offer this [unverified].
Fix: a `Tanpura` voice that repeats 4 plucks per cycle (tempo setting). Each pluck is a Karplus-Strong string in an AudioWorklet, with a bridge-buzz effect from a slowly opening filter. String 1 can be Pa, Ma or Ni.
Effort: L

### No overtone (harmonic series) drone
Evidence: drones play fixed timbres only. Gap item 21 covers harmonic series exercise patterns, not a sustained partials drone.
Fix: an "Overtones" timbre where the user switches partials 1 to 16 on or off with levels (a PeriodicWave built from the checkbox array), for hearing where a partial sits against the tempered note.
Effort: S

### No chord progression drones or harmonized scale accompaniment
Evidence: drones hold until changed by hand. iRealPro plays chord changes, and TE's exercises can use drones [unverified detail].
Fix: a progression editor (chord symbols per bar, parsed to intervals) played on the metronome grid by swapping drone sets at bar lines. A "harmonize scale" option chooses the diatonic triad per exercise note.
Effort: L

### Note pills and wedges show Hz only, rounded on the wheel
Evidence: sound.ts:208 shows `toFixed(0)` Hz on wedges (32.7 Hz shows as 33), and line 218 shows Hz without the temperament offset.
Fix: show cents from equal temperament (`temperamentOffset`) on pills and wedges whenever the temperament is not equal. Use 1 decimal of Hz below 100 Hz.
Effort: S

### No typed frequency or fine-tune tone generator
Evidence: drones exist only at note frequencies from `midiToFrequency` (droneBank.ts:44). You cannot play 432 Hz, 60 Hz or A4 +7 cents.
Fix: a "Custom tone" field accepting Hz or note plus cents, stored as a non-integer key in droneBank (`noteOnHz`).
Effort: S

### No circle-of-fifths layout for the wheel
Evidence: sound.ts:53-68 places wedges chromatically (`pc*30`).
Fix: a layout toggle mapping wedge index to `mod(7*i, 12)`, with the drag and octave logic worked in chromatic steps.
Effort: S

### Keyboard labels only on C
Evidence: sound.ts:149 labels only pitch class 0.
Fix: a setting for labels "C only / all white / all", with black key labels drawn small at the bottom of the black key.
Effort: S

### Wheel and keyboard names are concert pitch only
Evidence: sound.ts:146 and 203 call `noteName(m, flats)` without the transposition. Gap item 19 covers only colouring the written C key.
Fix: a "Show written pitch" toggle that labels with `transpose(m, semitones)` while still sounding concert pitch.
Effort: S

### Exercise root cannot be chosen in written pitch
Evidence: sound.ts:345 and 404: the root is concert pitch, so a B-flat clarinetist choosing written C gets concert C.
Fix: when a transposition is set, label roots in written pitch and subtract the semitones to get the sounding root.
Effort: S

### Spelling ignores the key
Evidence: `noteName` (notes.ts:172-187) uses the global sharps or flats setting, so D-flat major shows C#, D#, F, F#. The exercise status line (sound.ts:387) inherits this.
Fix: `spellScale(rootPc, pattern)` in src/core picks letter names degree by degree (one letter per degree, with double sharps where needed). Use it in the status line and the staff. Unit test F# major and Gb major.
Effort: M

### Keyboard does not scroll to follow the exercise
Evidence: sound.ts:240 only toggles a class. Notes outside the visible range cannot be seen.
Fix: in `onNote`, if the key is off screen, `scrollIntoView({inline:'center', behavior:'smooth'})` on the key, throttled to once per note.
Effort: S

### Wheel highlight hides the octave
Evidence: sound.ts:239 highlights by pitch class only, so going up an octave looks the same.
Fix: show the note's octave in the wheel centre during an exercise (the centre currently shows the octave setting) and pulse it when the octave changes.
Effort: S

### No staff notation for exercises
Evidence: the exercise card shows only a status text (sound.ts:387). src/core/staff.ts already computes staff positions.
Fix: draw the note sequence as SVG noteheads with the key signature from `spellScale`, highlighting the current note, and the clef chosen by range.
Effort: M

### No tempo control in the exercise card
Evidence: sound.ts:347 and 399: tempo comes from the metronome screen.
Fix: add a BPM stepper that defaults to the metronome tempo with a "link" toggle.
Effort: S

### No tempo ramp across exercise loops
Evidence: loop replays at the same tempo (sound.ts:391). The metronome has a speed trainer (README:43) but the exercise does not use it. Gap item 21 covers transposing each repeat, not tempo.
Fix: `rampPerLoop` (+N BPM), `maxBpm`, and an option to drop back after reaching the top, applied when `next()` wraps (after the seamless loop fix).
Effort: S

### No rhythm variations
Evidence: sound.ts:408 offers only equal half, beat and half-beat notes.
Fix: rhythm templates applied cyclically to durations: dotted (0.75, 0.25), reverse dotted, triplets, 3+3+2 sixteenths, and long-short-short. Pure `applyRhythm(notes, template)` with tests.
Effort: S

### No articulation choice
Evidence: sound.ts:377 always sounds 92% of the note length.
Fix: legato (102%, overlapping), tenuto (95%), staccato (45%), and slur groupings of 2 or 4 (legato inside the group, a small gap between groups).
Effort: S

### No dynamics or accents
Evidence: `playTone` level is constant for every note (voices.ts:278).
Fix: per-note gain from a profile: crescendo up and diminuendo down, an accent every N notes, or a random spread for evenness practice.
Effort: S

### No long tone or messa di voce mode
Evidence: no pattern holds each note with a rest in between. This is standard daily practice for winds and voice.
Fix: a "Long tones" pattern: each scale note N beats, with a rest of M beats, and an optional swell envelope (0 to peak to 0) in `playTone`.
Effort: S

### No final held note or rest before a repeat
Evidence: `buildExercise` durations are uniform and the loop restarts right away.
Fix: options for "Hold last note N beats" and "Rest before repeat N beats" in the event generator.
Effort: S

### Guide melody never drops out
Evidence: every loop plays every note (sound.ts:376-377).
Fix: a "Guide" mode: play with the melody, then the next loop plays only the drone and click (alternating, or fading 100/50/0% over loops).
Effort: S

### No modes
Evidence: exercises.ts:3-13 has no Dorian, Phrygian, Lydian, Mixolydian or Locrian.
Fix: add the 7 rotations of the major scale as step arrays, with unit tests.
Effort: S

### No minor pentatonic, blues, whole tone or diminished scales
Evidence: exercises.ts:3-13.
Fix: add minor pentatonic [0,3,5,7,10], blues [0,3,5,6,7,10], whole tone [0,2,4,6,8,10], and half-whole and whole-half octatonic.
Effort: S

### No jazz scales
Evidence: exercises.ts:3-13 has no melodic minor modes (Lydian dominant, altered, Locrian natural 2) and no bebop scales (8 notes with a passing tone).
Fix: add them. Bebop dominant [0,2,4,5,7,9,10,11], bebop major [0,2,4,5,7,8,9,11]. Descending bebop playing order needs `stepsDown`.
Effort: S

### No non-Western or other heptatonic scales
Evidence: exercises.ts:3-13 has no harmonic major, double harmonic (Hijaz and Bhairav family), Hungarian minor, Phrygian dominant, hirajoshi or in scale.
Fix: add step arrays in a "World" group of the pattern select. Have a specialist check names and spellings [unverified naming per tradition].
Effort: S

### Microtonal scales are impossible
Evidence: exercises.ts:21 builds integer MIDI steps, and `midiToFrequency` works on integers. Maqam quarter tones and shruti-based raga intonation need other cent values.
Fix: allow fractional steps (cents/100) in patterns and pass `midi + frac` through `midiToEqualFrequency` with detune. Add a few documented sets (for example Rast with a neutral third) after checking them against a source.
Effort: M

### Only major and minor arpeggios, no inversions
Evidence: exercises.ts:10-11.
Fix: add dominant 7, major 7, minor 7, half-diminished, diminished 7 and augmented, plus an inversion option that rotates the starting chord tone.
Effort: S

### "In thirds" works only on the major scale
Evidence: exercises.ts:12 and 23 hard-code the transform to pattern 'thirds' with major steps.
Fix: split scale choice from a "Figure" select (straight, 3rds, 4ths, 6ths, octaves) that takes degree index k and k+n in any scale. Test the minor scale in thirds.
Effort: S

### No sequence groupings
Evidence: no 1-2-3, 1-2-3-4, 1-2-3-1 or 1-3-2-4 figures over scale degrees.
Fix: add `grouping: number[]` degree offsets applied at each start degree up to the top, as a pure function with tests.
Effort: S

### No custom pattern entry
Evidence: `Pattern` is a closed union (exercises.ts:1).
Fix: a "Custom" option where the user types degrees or intervals (for example "1 3 5 8 5 3") or taps notes on the keyboard to record a sequence, saved in settings.
Effort: M

### No random or weighted key selection
Evidence: the root is chosen by hand (sound.ts:404).
Fix: "Random key" and "Random pattern" per loop. Weight toward keys with low scores once scoring exists (below).
Effort: S

### Exercises do not listen to the player
Evidence: the exercise player never uses the mic. src/audio/pitchTracker.ts exists, but sound.ts does not import it. Yousician and Simply Piano score played notes [unverified detail].
Fix: a "Listen" toggle. While each note sounds (offset by output latency), collect tracker readings and score median cents and whether the right note was hit. Show a per-note coloured row and a loop summary, saved to history.
Effort: L

### No wait-for-me mode
Evidence: exercises run on the clock only. Simply Piano waits for the correct note [unverified].
Fix: in Listen mode, a "Wait" option that pauses `next()` until the tracker holds the target note within tolerance for 150 ms, then plays or advances.
Effort: M

### No interval recognition training
Evidence: README:54 lists an interval trainer that measures intervals you play, not a listening quiz. EarMaster and Theta Music Trainer have interval ID [unverified].
Fix: a "Train" section: play two notes (melodic up or down, or harmonic) through `playTone`, with answer buttons for the enabled intervals, a score, and extra repeats of mistaken intervals.
Effort: M

### No chord quality recognition
Evidence: nothing plays a chord and asks what it is.
Fix: a quiz using `CHORDS` shapes plus inversions, with chosen qualities and a stats table.
Effort: S

### No scale or mode recognition
Evidence: no listening quiz for patterns.
Fix: play `buildExercise(randomPattern)` and ask which scale, reusing the exercise player.
Effort: S

### No pitch matching with scoring
Evidence: the tuner shows pitch, but nothing plays a target, hides it, and scores your matched note.
Fix: play a random note in a chosen range for 1 s, go silent, then use the tracker to record the settled pitch after 500 ms. Score cents error and time to settle, and keep a history.
Effort: M

### No fine pitch discrimination trainer
Evidence: nothing trains hearing small cent differences, which is the core skill an intonation app serves.
Fix: play two tones (or one tone against a drone) differing by N cents. Ask higher or lower (or in tune or not), with an adaptive staircase (2 down, 1 up) that reports the discrimination threshold in cents.
Effort: M

### No beat-based sharp or flat training against a drone
Evidence: related to the beat generator above but with no quiz.
Fix: play a drone chord with one voice detuned plus or minus N cents. The user taps the voice that is off and says sharp or flat, with difficulty set by N.
Effort: S

### No scale-degree ear training
Evidence: none. Some trainers play a cadence then a note to name [unverified].
Fix: play I-IV-V-I as drones or timed `playTone` chords, then a random degree, with answers 1 to 7 plus chromatic degrees.
Effort: M

### No melodic dictation
Evidence: none.
Fix: generate a short melody from the chosen scale (random walk with steps and leaps), play it, and let the user enter it on the keyboard. Compare the sequences.
Effort: M

### No sight-singing practice
Evidence: none. It needs staff rendering, a generated melody and mic scoring, all partly present (staff.ts, pitchTracker).
Fix: show a generated 4-bar melody on the staff, give the tonic drone and count-in, track sung pitch per note against the timeline, and score each note's cents and timing.
Effort: L

### No choir or ensemble chord tuning exercise
Evidence: nothing plays a chord with one voice missing for a singer or player to fill in.
Fix: choose a chord and a missing member (root, third, fifth). Drones play the rest in just tuning, and the tracker scores the held pitch against the just and equal targets (both shown, from `readInterval`).
Effort: M

### No beat rate shown between you and the drone
Evidence: the tuner and drones do not interact beyond follow drone. Showing beats per second makes "tune until the beats stop" concrete.
Fix: with the mic on and a drone sounding, compute the expected beat frequency from detected f0 and the nearest coinciding partials of the drone, `|m*f_player - n*f_drone|`. Display "3.2 beats/s, slowing" in the wheel centre, using the gap item 18 tracker.
Effort: M

### No open-string resonance drone
Evidence: string tuner references exist in the tuner (tuner.ts:344) but there is no drone set for ringing-tone practice.
Fix: a "Open strings" button in Sound that sustains the chosen instrument's open strings (from `src/core/instruments.ts`) quietly with the pure fifths option, so players hear sympathetic resonance when a note is in tune.
Effort: S

### No MIDI output
Evidence: controls.ts:68-90 handles MIDI input only. Drones and exercises cannot drive an external synth or piano.
Fix: a "MIDI out" device select. droneBank noteOn and noteOff send 0x90 and 0x80 (with pitch bend for temperament cents on a per-note channel, MPE style). The exercise sends timed messages with `output.send(data, performanceTime)`.
Effort: M

### No computer keyboard playing or Sound screen shortcuts
Evidence: controls.ts:14-34 has global keys only (M, D, ?, digits). sound.ts adds no key handlers except Enter on a focused key.
Fix: on the Sound view map the A W S E D F T G Y H U J K row to a chromatic octave from the current octave (Z and X change octave), and Space to play or stop the exercise. Skip when typing, and avoid the global 'd' clash by holding Shift or remapping.
Effort: S

### No velocity from touch
Evidence: sound.ts:151-155 ignores `PointerEvent.pressure` and the tap position. Every note has the same level.
Fix: velocity comes from `pressure` when above 0 and not 0.5 (the default reported without pressure support), otherwise from the vertical position on the key. Scale the drone or tone gain.
Effort: S

### No MIDI file export of exercises
Evidence: exercises exist only as played audio.
Fix: a small Standard MIDI File writer in src/core (header, one track, variable-length delta times) from the event list, downloaded as `.mid`. Unit test the bytes of a 3-note file.
Effort: S

### No offline render of drones or exercises to WAV
Evidence: gap item 28 records live output, but a 10-minute drone track for another player would take 10 real minutes.
Fix: render with `OfflineAudioContext` using the same Drone and `playTone` code (both accept `BaseAudioContext`), encode 16-bit WAV, and share or download.
Effort: S

### No stereo spread or room sound
Evidence: every source goes mono into one master gain (context.ts:10-11). Dry mono drones sound thin on headphones.
Fix: spread chord voices across the stereo field with StereoPanner, and add an optional convolution reverb from a generated noise-decay impulse (no sample needed), with a wet level setting.
Effort: S

### Sounding list re-announces on every settings change
Evidence: sound.ts:216-220 replaces the `aria-live` list inside `render()`, which runs on every settings change (sound.ts:280-287), including unrelated ones.
Fix: rebuild the pills only when `activeNotes()` changed (compare a joined key), and announce only additions and removals.
Effort: S

### Keyboard is rebuilt on tuning changes and loses focus
Evidence: sound.ts:279-285 calls `buildPiano()`, which replaces every key, so a keyboard user's focus is lost.
Fix: update the aria-labels and text in place, or restore focus to the same `data-midi` after rebuilding.
Effort: S

### Wheel hover colour sticks on touch
Evidence: styles.css:2454 `.wedge:hover` without a hover media query. On touch devices the last tapped wedge stays highlighted and can be confused with the green "on" state.
Fix: wrap it in `@media (hover: hover)`.
Effort: S

### No repeating reference beep
Evidence: drones are continuous only. A repeating short reference lets a player hear their own tone between pulses.
Fix: a "Pulse" option on drones: gain gated on N ms and off M ms by an LFO or scheduled automation on the drone gain.
Effort: S

### Keyboard can only sustain; it never plays like a piano
Evidence: every key starts a `Drone` (droneBank.ts:44), which never decays. There is no struck note that fades.
Fix: a "Piano" play mode where keys call `playTone` with a decaying envelope (fast attack, exponential decay 1 to 3 s scaled by pitch) instead of droneBank.
Effort: S

### No harmonic interval or double-stop exercises
Evidence: exercise events play one note each (sound.ts:376-377). Gap item 21's interval ladders are melodic.
Fix: let a pattern step be an array of notes, and play them together (for example scale in thirds as double stops, or sixths) with separate voice levels.
Effort: S

Total: 115 items. I stopped there; going further would have meant rewording these or repeating the 78 in docs/gap-analysis.md.

What I checked this session:
- **Thirds bug:** confirmed by running `buildExercise` through tsx.
- **Just third on E:** the 427 cent figure is arithmetic from the table at notes.ts:34, not a measurement.
- **Code bugs:** the stuck drone race, the chord toggle bug, the extra clicks and the stop-lag items come from reading the source. I have not reproduced them in a browser.
- **Unverified:** anything marked [unverified] about other apps' features or browser behaviour is from memory, not looked up.

Files read: `C:\Users\Sri\TE\src\ui\views\sound.ts`, `C:\Users\Sri\TE\src\audio\droneBank.ts`, `C:\Users\Sri\TE\src\audio\voices.ts`, `C:\Users\Sri\TE\src\core\exercises.ts`, `C:\Users\Sri\TE\src\core\notes.ts`, `C:\Users\Sri\TE\src\core\intervals.ts`, `C:\Users\Sri\TE\src\audio\context.ts`, `C:\Users\Sri\TE\src\audio\scheduler.ts`, and `C:\Users\Sri\TE\src\styles.css` lines 2410 to 2589.
