# Click tracks and sheet music

I read every file you listed, plus `src/audio/scheduler.ts`, `src/ui/controls.ts`, `src/store/settings.ts`, `public/manifest.webmanifest`, the related parts of `src/styles.css` and `src/ui/views/practice.ts`, and the existing tests. I checked each item against the 78 in `docs/gap-analysis.md` and left out anything they already cover: voice count-in, preset groups, scale tempo, seek from a section, thumbnails, bookmarks, setlists of scores, zoom, crop, annotated PDF export, wake lock, latency, native confirm dialogs, undo for deletes, score-following page turns and full backup.

The list has 152 items: 72 for click tracks and 80 for sheet music. I stopped there because the rest would have been rewordings. Line numbers are from this read. Anything I say about a competitor comes from memory and is marked [unverified]. None of it was looked up this session.

## Click tracks

### [Click tracks] Loop restart has a long, irregular gap
Evidence: `scheduler.ts` `start()` only calls `onEnd` 300 ms after the last click. Then `clicktrack.ts:298-300` calls `togglePlay()`, which waits for `ensureRunning()` and starts again with the 80 ms `startDelay`. So the time from the last beat to the next downbeat is about 380 ms plus async time, not one beat.
Fix: in `togglePlay`, when `loop` is on, have the `next()` closure wrap around: when `i` reaches `events.length`, set `i = 0` and add `duration` to a running time offset. The scheduler then never ends. Unit test the wrapping generator: the first downbeat of pass 2 is exactly `duration` after pass 1's.
Effort: S

### [Click tracks] Looping plays the count-in on every pass
Evidence: the loop calls `togglePlay()` again, and that calls `expandClickTrack(track)`, which adds `countInBars` every time (`rhythm.ts:89-98`).
Fix: in the wrapping generator from the previous item, skip events with `countIn` true after the first pass. Add a "Count-in on every loop" toggle for people who want it.
Effort: S

### [Click tracks] You can only loop the whole track
Evidence: `loop` is one boolean (`clicktrack.ts:59,82`). There is no way to pick a range.
Fix: add `loopRange: {fromSection, toSection}` (later bars too), chosen by long-pressing timeline segments. Filter events to that range and shift their times so the range starts at 0. Draw the range as brackets over the timeline.
Effort: M

### [Click tracks] No loop count
Evidence: a loop runs until you press stop (`clicktrack.ts:300`).
Fix: a "Repeat ×N" select (∞, 2 to 20). Count passes in the wrapping generator and return null after N.
Effort: S

### [Click tracks] No speed trainer across loop passes
Evidence: the metronome has a speed trainer (README), but click tracks restart at the same tempo every time.
Fix: an option to add +X BPM or +X% per pass, up to a maximum tempo. Rebuild the events for each pass with the tempo factor applied to `bpm` and `endBpm`. Show the pass number and the current factor in `nowPlaying`.
Effort: S

### [Click tracks] A tempo ramp changes in steps, once per beat
Evidence: `rhythm.ts:105-110` sets one BPM per beat and keeps it for the whole beat, including its subdivisions. Long beats at slow tempos jump audibly.
Fix: put beat times on a continuous tempo curve. For a linear ramp, the time of position x beats in is `(60/Δ) * ln(1 + Δx/b0)`, where Δ is the tempo change per beat. Place subdivision clicks at fractional x on the same curve. Unit test that the gaps between clicks grow smoothly.
Effort: M

### [Click tracks] A ramp reaches its end tempo one beat early
Evidence: `k / (totalBeats - 1)` (`rhythm.ts:108`) makes the last beat of the section already play at `endBpm`. Musicians usually expect the target tempo on the next section's downbeat.
Fix: add `rampArrives: 'lastBeat' | 'nextDownbeat'` and use `k / totalBeats` for the second option. Make it the default for new sections and label it in the card.
Effort: S

### [Click tracks] Ramps can only be linear
Evidence: the `ClickSection.endBpm` comment says "linearly", and that is the only shape (`rhythm.ts:72`). DAWs offer curved tempo automation [unverified for Logic and Ableton specifics].
Fix: add `curve: 'linear' | 'exponential' | 'easeIn' | 'easeOut'`. Map normalized position u to a tempo factor (for exponential, `b0 * (b1/b0)^u`) and add up beat durations numerically. Draw the shape inside `.tl-seg.ramp`.
Effort: M

### [Click tracks] A ramp always covers the whole section
Evidence: `endBpm` applies from beat 0 to the end. A "rit. in the last 2 bars" needs its own section, which breaks bar labels and repeats.
Fix: add `rampStartBar` and `rampEndBar` inside the section, with constant tempo outside them. Show a two-handle range in the card.
Effort: S

### [Click tracks] Turning on a ramp at 400 BPM creates a ramp that does nothing
Evidence: `Math.min(400, s.bpm + 20)` (`clicktrack.ts:221`) gives `endBpm === bpm` when bpm is 400. The card shows "Ends at 400", but the timeline treats it as no ramp (`clicktrack.ts:102`).
Fix: if `bpm + 20 > 400`, default `endBpm` to `bpm - 20`. Show a hint when the start and end tempos are equal.
Effort: S

### [Click tracks] No fermatas, holds or timed pauses
Evidence: `ClickSection` only has bars and beats (`rhythm.ts:69-74`). No event can last a set number of seconds, so orchestral scores with fermatas can't be modelled. Worship click apps treat holds as a normal section type [unverified].
Fix: a section `kind: 'pause'` with `seconds` (or "wait for pedal", see the vamp item). It adds time without clicks, shows a countdown, and `sectionSpans` draws it with a hatched fill.
Effort: M

### [Click tracks] No pickup bars
Evidence: every bar is `beatsPerBar` long (`rhythm.ts:103-105`), and the count-in is always whole bars (`rhythm.ts:92`). A 1-beat pickup needs a separate 1-bar, 1-beat section, which resets accents and confuses bar numbers.
Fix: add `pickupBeats` to `ClickTrack`. Shorten the count-in by that many beats so the downbeat after the pickup falls where a player expects. Number the pickup as bar 0. Unit test a 4/4 track with a 1-beat pickup: 3 count-in clicks, then 1 pickup click, then bar 1.
Effort: S

### [Click tracks] Count-in options are too narrow
Evidence: only 0, 1 or 2 bars (`clicktrack.ts:72`). The count-in copies the first section's meter with no subdivision (`rhythm.ts:91`), so a first section of 1 beat per bar counts in with a single click. There is no "2 beats" or "count in 6/8 as two big beats".
Fix: `countIn: {bars | beats, meterOverride?, subdivision?}`. Offer 0 to 4 bars or 1 to 8 beats in the select.
Effort: S

### [Click tracks] Section accents cannot be edited, and changing beats silently resets them
Evidence: `ClickSection.accents` exists, but no control in the card sets it. `update()` overwrites accents with `defaultAccents` whenever `beatsPerBar` changes (`clicktrack.ts:177`). The metronome screen has tap-to-cycle accents (README).
Fix: reuse the metronome's accent-cycling beat tiles in each `sectionCard`. When beats change, keep the existing accents and pad or trim instead of resetting.
Effort: S

### [Click tracks] No beat grouping for compound or additive meters
Evidence: `beatUnit` only changes the label (`rhythm.ts:6`). 6/8 clicks six equal eighths at the BPM. 7/8 as 2+2+3 cannot accent its groups, and there is no dotted-quarter tempo.
Fix: add `grouping: number[]` (for example [2,2,3]) and `tempoUnit: 'beat' | 'group'`. With `group`, the BPM counts groups and clicks fall on group starts, with sub-clicks on the eighths. Unit test that 6/8 at dotted quarter = 60 gives clicks every 1/3 s with accents on 0 and 3.
Effort: M

### [Click tracks] Subdivisions are limited and cannot be patterned
Evidence: only 1, 2, 3, 4 and 6 (`clicktrack.ts:215`). No quintuplets, septuplets or 8, and no patterns such as "only the and" or a gallop.
Fix: allow 1 to 8. Add an optional `subPattern: boolean[]` per beat, edited as small toggles under each beat tile. `expandClickTrack` skips the masked-out subs.
Effort: S

### [Click tracks] No swing or shuffle
Evidence: subdivision clicks are evenly spaced, `sub / subdivision` (`rhythm.ts:114`).
Fix: add a `swing` value (50 to 75%) that applies to subdivision 2 (and 4 in pairs). Time of sub 1 = `swing * beatDur`. Unit test that 66% puts the second eighth at 2/3 of the beat.
Effort: S

### [Click tracks] Beats per bar stops at 16
Evidence: `stepper('Beats', …, 1, 16, …)` (`clicktrack.ts:204`). Some contemporary and Balkan music uses longer cycles.
Fix: raise the limit to 32 and let the beat tiles wrap. Check the timeline tooltip still reads well.
Effort: S

### [Click tracks] BPM is whole numbers only
Evidence: the steppers step by 1 (`clicktrack.ts:161-162`), while `clampBpm` accepts decimals. Film cues and DAW tempo maps often use values like 92.5.
Fix: long-press or double-click the output to type a value with 0.1 precision. Show one decimal only when the value has one.
Effort: S

### [Click tracks] Numbers can only be changed with +/- buttons
Evidence: the `<output>` in `stepper()` (`clicktrack.ts:160`) can't be typed into. Going from 8 bars to 120 means holding the button. Screen reader users get no spinbutton role.
Fix: replace the output with `<input type="number" inputmode="numeric">` using min and max, clamping on change. Keep the hold buttons. Give it `role="spinbutton"` semantics.
Effort: S

### [Click tracks] Every stepper tick writes storage and rebuilds every event
Evidence: `update()` calls `persist()` (`clicktrack.ts:178`), which calls `saveTrack` (a whole-settings `updateSettings`), `renderLibrary`, and `renderSummary`. `renderSummary` calls `sectionSpans`, which runs a full `expandClickTrack` (`rhythm.ts:141`). While holding BPM on a 999-bar, 16-beat, ×6 track, each tick builds about 96,000 event objects and writes localStorage.
Fix: compute section boundaries by adding up bar durations (closed form for a ramp) without building events. Debounce `saveTrack` by 300 ms. Rebuild the library chips only when names change.
Effort: S

### [Click tracks] The playhead does not line up with the segments
Evidence: segments are sized with `flex: fraction` (`clicktrack.ts:108`), but each has `min-width: 26px`, and the timeline has `gap: 3px` (`styles.css`, `.tl-seg` and `.timeline`). The playhead's `left` is a plain percentage of the duration (`clicktrack.ts:307`). Short sections get wider than their share, so the playhead drifts away from them.
Fix: place the playhead from the actual segment boxes. Find the current section's segment, read its `offsetLeft` and `offsetWidth`, and interpolate inside it by `(t - span.start) / (span.end - span.start)`.
Effort: S

### [Click tracks] The timeline hides its buttons from screen readers
Evidence: the timeline has `role="img"` (`clicktrack.ts:77`) but contains `<button>` segments (`clicktrack.ts:105`). An img role makes its children presentational.
Fix: use `role="list"` with segments as list items holding buttons. Give each button an `aria-label` from the same text as its `title`.
Effort: S

### [Click tracks] Section colours change when sections move
Evidence: `--hue: (index * 47) % 360` (`clicktrack.ts:108,184`). After a move, "Chorus" changes colour and people lose their visual anchor.
Fix: store `color` (or a hue seed) on `ClickSection` when it is created. Sections with the same name share a colour. Add a colour picker to the card.
Effort: S

### [Click tracks] The timeline shows no bars, meters or tempo shape
Evidence: each segment shows only a name and its BPM (`clicktrack.ts:112-113`). There are no bar ticks, meter changes, zoom, or tempo graph. DAW tempo tracks show a curve [unverified detail].
Fix: add an SVG strip under the timeline: bar ticks from the bar start times, a meter label wherever the meter changes, and a tempo polyline (y = BPM). Add pinch or ctrl-wheel zoom inside `.timeline-wrap`.
Effort: M

### [Click tracks] The bar number means something different from what it appears to
Evidence: `e.bar` counts bars across the whole track (`rhythm.ts:115,126`), but `nowPlaying` shows it right after the section name, "Verse · bar 21" (`clicktrack.ts:293`), which reads as bar 21 of the verse. There is also no elapsed or remaining time.
Fix: show "Verse 5/16 · m. 21 · 1:12 / 3:40". Compute the bar within the section as `e.bar` minus the section's first bar.
Effort: S

### [Click tracks] No starting measure number or rehearsal letters
Evidence: bars always start at 1. Sections have only `name`, so you cannot match a score that starts at m. 17 or uses letter [C].
Fix: add `startMeasure` to `ClickTrack` and `rehearsalMark` to `ClickSection`. Show both in `nowPlaying` and on the timeline.
Effort: S

### [Click tracks] No pause and resume
Evidence: `stop()` ends playback, and the next play starts from the top with the count-in (`clicktrack.ts:323-328`).
Fix: on pause, remember the index of the next event and its time. Resume starts the scheduler with a generator from that index minus the stored time offset, optionally with a one-bar count-in. Unit test the index arithmetic.
Effort: S

### [Click tracks] Editing during playback is ignored or mislabelled
Evidence: events are built once at start (`clicktrack.ts:277`). The visual callback then looks up `track.sections[e.section]` and the section cards by index (`clicktrack.ts:289,296`). Moving or removing a section while playing labels and highlights the wrong one, and tempo edits are silently ignored.
Fix: snapshot the track at play start and use the snapshot in callbacks. Show a "Changes apply on next play" note, or rebuild events from the next bar boundary.
Effort: S

### [Click tracks] Leaving the screen stops the click track
Evidence: the dispose function calls `stop()` (`clicktrack.ts:377-382`). The shared metronome survives screen changes, but a click track cannot play while you read sheet music or use the tuner.
Fix: move the player into a shared service (like `metronome` in `ui/shared.ts`). Show it in the mini dock with the section name and a stop button. The view just attaches to it.
Effort: M

### [Click tracks] The metronome can play at the same time as a click track
Evidence: starting a click track stops the metronome (`clicktrack.ts:272`), but the other direction is not handled. The global `M` shortcut (`controls.ts`) or the dock can start the metronome on top of it.
Fix: give both players a shared `transport.claim(owner)` that stops the other one.
Effort: S

### [Click tracks] Click tracks count as metronome practice
Evidence: `logPractice(…, 'metronome')` (`clicktrack.ts:314`). With looping, `finish()` also logs once per pass, so history splits into many short sessions.
Fix: add a `clicktrack` activity (or keep metronome but add the track id). Log once when the user stops, not at each loop.
Effort: S

### [Click tracks] No large beat display or count-in countdown
Evidence: the only playback visual is a small text line, `nowPlaying` (`clicktrack.ts:80,290-295`). There are no beat blocks, flash or big count-in numbers like the metronome screen has.
Fix: reuse the metronome's beat block component above the sticky play bar. During the count-in show big "4 3 2 1" numbers. Offer the metronome's full-screen flash option.
Effort: S

### [Click tracks] No warning before the next section
Evidence: nothing says "Chorus in 2 bars". Live click apps show upcoming sections [unverified].
Fix: in `onVisual`, when bars left in the section are 2 or fewer, show "Next: Chorus in N" with a progress bar. Optionally change the last bar's click sound.
Effort: S

### [Click tracks] No spoken section cues
Evidence: there is no audio cue such as "Verse" or "Chorus". Loop Community Prime and MultiTracks Playback advertise guide cues [unverified]. Gap-analysis item 1 covers spoken count numbers only.
Fix: record or synthesize a small CC0 word set (intro, verse, chorus, bridge, tag, outro, 1 to 4, "all in", "break"). Add `cue` to each section and schedule it one bar before the section starts. Reuse the voice asset pipeline from item 1.
Effort: M

### [Click tracks] Count-in sound cannot be changed
Evidence: the count-in always uses `'tick'` (`clicktrack.ts:286`), and the track sound comes from the global metronome setting.
Fix: add `countInSound` and a per-track `sound` and `volume` with a fallback to the global setting. Add selects in the track header.
Effort: S

### [Click tracks] Sections cannot repeat without copying them
Evidence: the only way to repeat is duplicating a section (`clicktrack.ts:236-240`). Changing the tempo later means editing every copy.
Fix: add `repeat: number` to `ClickSection`. `expandClickTrack` loops the section body. Show "×3" on the timeline segment and "pass 2/3" while playing.
Effort: S

### [Click tracks] No repeat or jump navigation
Evidence: sections play strictly in order (`rhythm.ts:100`). There are no 1st and 2nd endings, D.C., D.S. al Coda or "to Coda" markers.
Fix: separate the song (named sections) from its playing order: `ClickTrack.form: sectionId[]`. Add a form editor with chips and presets for "repeat with 1st/2nd ending" and "D.S. al Coda" that generate the order. Unit test that D.S. al Coda expands to the expected order.
Effort: M

### [Click tracks] Reused sections cannot be edited once
Evidence: a duplicated section is an independent copy (`structuredClone`, `clicktrack.ts:237`). Changing the chorus tempo means editing each chorus.
Fix: builds on the form-order item: each play in the order refers to one section definition. Add an "Unlink" action for one-off changes.
Effort: M

### [Click tracks] No meter change in the middle of a section
Evidence: every bar in a section has the same meter (`rhythm.ts:103-104`). One 5/8 bar inside a 4/4 verse needs 3 sections.
Fix: add `barOverrides: {bar, beatsPerBar, beatUnit, accents}[]`. The expansion uses the override for that bar. In the editor, tap a bar tick to override it.
Effort: M

### [Click tracks] No backing audio
Evidence: only synthesized clicks play (`clicktrack.ts:286`). Worship playback apps play backing tracks and stems in sync with the click [unverified].
Fix: add `audio: {assetId, offsetSeconds, gain}` to a track, stored in IndexedDB like takes. Decode to an `AudioBuffer` and start an `AudioBufferSourceNode` at `playStartAudio + offset`, so it uses the same audio clock. Stems (several buffers with mute and solo) are a later step.
Effort: L

### [Click tracks] Cannot line up the click with an imported audio file
Evidence: nothing sets tempo or offset from audio.
Fix: show the file's waveform (see gap item 23). The user taps bar 1 to set `offsetSeconds`. Add optional beat tracking: onset-strength envelope, autocorrelation for tempo, then dynamic-programming beat alignment. Store detected tempo changes as sections.
Effort: L

### [Click tracks] No audio export
Evidence: nothing renders a track to a file.
Fix: render `expandClickTrack` events through `playClick` into an `OfflineAudioContext` (48 kHz, `duration` plus 1 s). Encode 16-bit WAV with a small writer and share or download it. Unit test that the WAV header length matches the frame count.
Effort: S

### [Click tracks] No MIDI file export
Evidence: DAW users cannot bring a tempo map across.
Fix: write a Standard MIDI File type 1. Track 0 gets tempo meta events (FF 51, microseconds per quarter, one per beat inside ramps) and time signature events (FF 58) at section starts. Track 1 gets note events for clicks and marker events (FF 06) with section names. Round-trip test with a small parser.
Effort: M

### [Click tracks] No MIDI file import
Evidence: tempo maps from Logic, Ableton or MuseScore cannot come in.
Fix: parse FF 51 and FF 58 meta events. Merge constant runs into sections, and detect ramps by fitting a line to consecutive tempo events. Markers become section names. Test with a written fixture file.
Effort: M

### [Click tracks] No MusicXML import
Evidence: tempo, meter and rehearsal marks already exist in notation files.
Fix: read `<time>`, `<sound tempo>`, `<metronome>`, `<rehearsal>` and repeat, ending, segno and coda elements from `.musicxml` or `.mxl` (unzip). Build sections and the form order. Pickup: `measure implicit="yes"`.
Effort: L

### [Click tracks] No MIDI clock output
Evidence: `controls.ts` only listens to MIDI input. Drum machines and DAWs cannot follow the click.
Fix: `requestMIDIAccess()`, then send 0xFA (start) and 24 × 0xF8 per quarter note, timestamped with `output.send(data, performanceTimestamp)`. Convert audio time to performance time with `ctx.getOutputTimestamp()`. Send 0xFC on stop.
Effort: M

### [Click tracks] No MIDI clock input
Evidence: the app cannot follow an external clock.
Fix: in `onMessage` (`controls.ts`), use an exponentially smoothed interval of 0xF8 messages to set the tempo, and 0xFA and 0xFC to start and stop. Keep this only for the plain metronome, since a tempo map conflicts with an external clock.
Effort: M

### [Click tracks] MIDI cannot choose tracks or sections
Evidence: the only MIDI actions are next, previous, toggle, metronome and tap (`controls.ts` `runAction`).
Fix: new actions: program change selects track N, CC selects section N. Add them to `MIDI_ACTIONS` and handle them in the click track service.
Effort: S

### [Click tracks] No setlists of click tracks
Evidence: tracks are a flat list of chips (`clicktrack.ts:120-128`). Tempo and Soundbrenner apps have setlists [unverified].
Fix: `setlists: {id, name, items: {trackId, transition: 'stop' | 'auto' | 'gapSeconds'}[]}` in settings. Add a setlist view with next and previous track buttons and pedal mapping.
Effort: M

### [Click tracks] The track library has no management tools
Evidence: chips in insertion order with no search, sort, reorder, duplicate or folders (`clicktrack.ts:121-127`). With 50 tracks this gets unusable.
Fix: a library sheet with search by name, sort by name or recent, drag to reorder, and duplicate and rename actions. Keep the chips for the 5 most recent.
Effort: S

### [Click tracks] Phantom and missing library entries
Evidence: on mount, a Blank track is saved if none exist (`clicktrack.ts:365`), so just visiting the screen creates "New click track". After deleting the last track, the new Blank is not saved (`clicktrack.ts:354`), so no chip is highlighted. The delete prompt for an unnamed track reads `Delete ""`.
Fix: save only on the first edit, show a clear empty state when no tracks exist, and use `track.name || 'Untitled'` in the prompt.
Effort: S

### [Click tracks] Cannot save your own templates
Evidence: `TEMPLATES` is a fixed list of 4 (`clicktrack.ts:23-42`).
Fix: "Save as template" copies the track structure without its id into `settings.clickTemplates`, listed under the built-in ones. Also add common forms: AABA 32-bar, 12-bar blues, march (intro, first and second strains, trio).
Effort: S

### [Click tracks] No undo in the section editor
Evidence: remove, move and duplicate take effect at once (`clicktrack.ts:228-246`). Gap item 71 covers deleting takes, scores and presets, not editing inside a track.
Fix: a stack of `structuredClone(track)` snapshots taken before each change, with undo and redo buttons and Ctrl+Z and Ctrl+Shift+Z. Limit it to 50.
Effort: S

### [Click tracks] Space can delete a section
Evidence: `onKey` returns early when a button has focus (`clicktrack.ts:369`), so Space then activates the focused button. After clicking a section's trash or move button, pressing Space to start playback removes or moves that section.
Fix: handle Space globally unless focus is in a text field, and call `preventDefault()` so focused buttons don't activate. Move focus to the play button after structural edits. Add an e2e test that pressing Space after "Remove section" does not remove a second section.
Effort: S

### [Click tracks] Reordering needs one tap per position
Evidence: only one-step Move earlier and Move later buttons (`clicktrack.ts:193-194`).
Fix: a pointer-based drag handle on `.section-top` using the pointer capture helper that already exists. Keep the buttons for keyboard users.
Effort: S

### [Click tracks] Cannot edit several sections at once
Evidence: every change goes to one card.
Fix: selection checkboxes and a bulk sheet that sets meter, subdivision, or a BPM offset on all selected sections.
Effort: S

### [Click tracks] New sections copy the last section's name
Evidence: "Add section" clones the last section including its name (`clicktrack.ts:345`), so you get two "Outro" sections.
Fix: clone the settings but clear `name`, or add " 2".
Effort: S

### [Click tracks] Restored click tracks are not validated
Evidence: backup import only checks that `'a4' in data` (`practice.ts:280`), and `mergeSettings` spreads stored data as is (`settings.ts:152-158`). A section with `bars: 0` gets `start = duration` but `end` equal to the next section's start (`rhythm.ts:147-150`), so its flex fraction is negative. A missing `beatsPerBar` produces no events.
Fix: a `sanitizeClickTrack()` that clamps every field to the editor's limits, used on load and import. Make `sectionSpans` return `start` equal to the previous end for empty sections. Unit test those cases.
Effort: S

### [Click tracks] Clicks may be late in a background tab
Evidence: the scheduler uses a 25 ms `setTimeout` loop with 0.12 s lookahead (`scheduler.ts` `start()`). Browsers throttle timers in hidden tabs, so the loop can wake after the lookahead window has passed [unverified exact throttle values]. This is separate from gap item 36, which is about screen lock.
Fix: run the tick in a dedicated Worker, whose timers are throttled less [unverified], or raise the lookahead to 1.5 s while `document.hidden`. Test by hiding the tab during playback and logging late clicks (`when` already in the past).
Effort: S

### [Click tracks] No tap tempo in the section card
Evidence: tap tempo exists (`rhythm.ts:201-209`), but only on the metronome screen.
Fix: a tap button in each `sectionCard` that uses `tapTempo()` and writes `bpm`.
Effort: S

### [Click tracks] Sections cannot show tempo text or note values
Evidence: BPM is a bare number. There is no "♩. = 60" or tempo word (`tempoMarking` exists at `rhythm.ts:196`).
Fix: show `tempoMarking(bpm)` next to the BPM, and a note-value glyph once the grouping item adds `tempoUnit`.
Effort: S

### [Click tracks] No notes or lyrics per section
Evidence: `ClickSection` has only `name`.
Fix: add `note?: string` (a textarea in the card) and show it in `nowPlaying` while the section plays, for things like "watch conductor" or the first lyric.
Effort: S

### [Click tracks] Keyboard control is only Space
Evidence: `onKey` handles only Space (`clicktrack.ts:370`).
Fix: Home restarts, [ and ] jump to the previous or next section, L toggles loop, Esc stops. List them in the shortcuts sheet.
Effort: S

### [Click tracks] No video sync
Evidence: nothing plays video alongside the click. Film and theatre users rehearse to picture.
Fix: attach a video file (IndexedDB). A `<video>` element is started and seeked from the transport, with `currentTime` compared against audio time every second and corrected when it drifts more than 40 ms. Add a timecode start offset.
Effort: L

### [Click tracks] No hit points
Evidence: nothing solves for a tempo that lands a downbeat on a given time.
Fix: `hitPoints: {seconds, label}[]`. A "fit tempo" helper finds the BPM (one decimal) so bar N lands within 10 ms of the hit, by bisection using the analytic section durations. Draw hit marks on the timeline.
Effort: M

### [Click tracks] No vamp that waits for a cue
Evidence: every section has a fixed length. Worship playback apps loop a vamp until the leader taps [unverified].
Fix: `vamp: true` repeats the section until a "continue" action (button, pedal or MIDI) arrives, then plays on from the next bar boundary. Needs the generator to produce events on demand instead of a fixed array.
Effort: M

### [Click tracks] No jumping to a section during playback
Evidence: live jumps are not possible. Timeline taps only scroll the editor (`clicktrack.ts:110`).
Fix: during playback, tapping a segment queues a jump that happens at the next bar line, with a pending highlight. Also on-demand generation. This is separate from gap item 68, which starts playback from a section.
Effort: M

### [Click tracks] No start time or length per section card
Evidence: the card shows bars and BPM but not when it starts or how long it lasts (`clicktrack.ts:199-224`).
Fix: show "starts 1:04 · 0:32" in `.section-top`, from the spans.
Effort: S

### [Click tracks] No stage lock
Evidence: during a gig, one bad tap edits a stepper or deletes a track (`clicktrack.ts:345-360`).
Fix: a "Live" toggle that hides the editor and delete buttons and enlarges the transport, now-playing line and next-section cue. Keep it on while playing.
Effort: S

### [Click tracks] Subdivision clicks cannot be adjusted separately
Evidence: `level: 'sub'` (`rhythm.ts:118`) always uses the same sound and quieter level. You cannot make the eighths a different sound or mute them in some bars.
Fix: add per-track `subSound` and `subVolume`, passed to `playClick` when `e.level === 'sub'`.
Effort: S

### [Click tracks] Tests miss edge cases
Evidence: `tests/rhythm.test.ts` covers a count-in, 2 sections, a ramp and spans. Nothing tests ramps with subdivisions, empty sections, beatsPerBar 1, count-in with no sections, or loop wrapping.
Fix: add those cases alongside the fixes above, with property-based checks that event times strictly increase.
Effort: S

## Sheet music

### [Sheet music] Annotations disappear in half-page view
Evidence: the half-turn branch of `renderPages` builds a composite canvas and never calls `pageWrap` (`sheetmusic.ts:356-375`), so no ink is drawn. Fingerings vanish exactly while you turn by halves.
Fix: when building the composite, draw each page's ink (`drawInk` into offscreen canvases the size of `top` and `bottom`) and copy the same halves. Add an e2e test: annotate page 1, switch to half turn, and check the composite has ink pixels.
Effort: S

### [Sheet music] Black ink is invisible in night mode
Evidence: `.viewer.night canvas.page { filter: invert(0.92) hue-rotate(180deg) }` (`styles.css:3560`) inverts only the page. The ink canvas is not inverted, so `#111418` pen strokes sit on a near-black page. Night mode is also not remembered (`sheetmusic.ts:45`).
Fix: apply the same filter to `canvas.ink` in night mode, which keeps colours consistent with the page. Store `night` in settings.
Effort: S

### [Sheet music] A second finger breaks the stroke in progress
Evidence: `attachInk` keeps one `live` stroke. Each `pointerdown` replaces it (`sheetmusic.ts:444-458`), and every `pointermove` from any pointer appends points (`sheetmusic.ts:460-464`). A resting palm or second finger mixes points into the stroke.
Fix: store `activePointerId` and ignore other pointers while a stroke is live. When `pointerType === 'pen'`, ignore touch pointers.
Effort: S

### [Sheet music] No stylus-only mode
Evidence: touch, mouse and pen all draw, and `touch-action: none` (`styles.css:3549-3552`) blocks finger scrolling while annotating. forScore and GoodNotes-style apps draw with the stylus only [unverified].
Fix: once the first pen pointer is seen, switch to stylus-only: touch pointers scroll or turn pages instead of drawing. Add a manual "draw with finger" toggle in the ink bar.
Effort: S

### [Sheet music] Pen pressure is ignored
Evidence: points are `[x, y]` only (`ink.ts:9`), and the line width is fixed per stroke (`sheetmusic.ts:407`).
Fix: store `[x, y, p]` using `e.pressure`. Draw each segment with width `base * (0.4 + 0.9p)`, or as a filled polygon outline. Keep older 2-number points readable.
Effort: M

### [Sheet music] Strokes lag and look jagged
Evidence: `pointermove` redraws every stroke on the page, `drawInk(overlay, ink.get(pageNum), live)` (`sheetmusic.ts:464`), which is O(all strokes) per event. `getCoalescedEvents()` is not used, so fast strokes lose points.
Fix: cache committed strokes in an offscreen canvas and draw only the new live segment. Take points from `e.getCoalescedEvents()`. Also try the `desynchronized: true` 2D context option [unverified support].
Effort: S

### [Sheet music] No stroke smoothing, and points can fall off the page
Evidence: `simplify` only drops points (`ink.ts:36-45`), and strokes are straight polylines (`sheetmusic.ts:414`). With pointer capture, `pos()` can return values outside 0 to 1 (`sheetmusic.ts:429-432`).
Fix: clamp points to 0 to 1 and draw quadratic curves through segment midpoints. Add a unit test for the clamping.
Effort: S

### [Sheet music] Eraser and simplify distances are distorted on portrait pages
Evidence: points are normalized by width for x and by height for y (`sheetmusic.ts:431`), but `hitStroke` and `simplify` use plain `Math.hypot` (`ink.ts:19,27,41`). On a portrait page the eraser reach and simplify tolerance are elliptical, and `width / 2` (a fraction of the page width) is compared against mixed units.
Fix: pass `aspect = H / W` and scale dy by it in `distanceToSegment`, `hitStroke` and `simplify`. Add a unit test with a vertical stroke on an A4 aspect page.
Effort: S

### [Sheet music] Pen width and colours are fixed
Evidence: 4 fixed colours and one highlighter colour (`sheetmusic.ts:19-20`). Widths are hard-coded, 0.0028 and 0.018 (`sheetmusic.ts:457-458`). No opacity setting.
Fix: a pen settings popover with 3 widths, a custom colour input and highlighter colours. Save the last choices in settings.
Effort: S

### [Sheet music] Eraser removes whole strokes only
Evidence: `erase()` deletes the entire stroke it hits (`sheetmusic.ts:433-442`), with a fixed radius of 0.012. Dragging through 10 strokes creates 10 separate undo entries.
Fix: add a partial-erase mode that splits a stroke's point list where it lies inside the eraser circle. Make the radius adjustable. Record one undo entry per eraser gesture.
Effort: M

### [Sheet music] Undo can change a page you can't see, and there is no redo
Evidence: `undoStack` covers all pages (`sheetmusic.ts:52`). `undo()` restores `last.page` even when another page is showing (`sheetmusic.ts:482-487`), so it silently changes a hidden page. There is no redo, the stack is cleared on open (`sheetmusic.ts:271`), and it has no size limit.
Fix: go to `last.page` before restoring and show a toast. Add a redo stack (Ctrl+Shift+Z and a button) and cap it at 100 entries.
Effort: S

### [Sheet music] No text annotations
Evidence: the `Stroke` type has only pen and highlight (`ink.ts:1`). forScore, MobileSheets and Piascore support text [unverified].
Fix: a union type `Annotation = Stroke | TextNote {x, y, text, size, color}`. Tapping with the text tool opens an input; render with `fillText`. Hit-test boxes so the eraser works on text.
Effort: M

### [Sheet music] No music stamps
Evidence: there are no fingering numbers, up and down bows, breath marks, dynamics, accidentals or "eyeglasses" stamps. forScore has a stamp library [unverified].
Fix: a stamp palette using SMuFL glyphs from the Bravura font (check its licence first) or hand-made SVG paths. Store stamps as `{kind:'stamp', glyph, x, y, scale}`, with the stamp size scaled to the page width.
Effort: M

### [Sheet music] No shapes or straight lines
Evidence: freehand only. Hairpins, boxes, circles and brackets come out wobbly.
Fix: a shape tool (line, arrow, rectangle, ellipse, crescendo and decrescendo hairpin), and hold still at the end of a stroke to straighten it. Store shapes as their parameters.
Effort: M

### [Sheet music] Cannot select and move annotations
Evidence: no selection tool, so a misplaced fingering must be erased and redrawn.
Fix: lasso tool: select strokes whose points fall inside the lasso polygon, then drag to move, pinch or handles to scale, and delete. One undo entry per move.
Effort: M

### [Sheet music] Cannot copy annotations between pages or scores
Evidence: ink is stored per page with no clipboard.
Fix: copy the selection (from the lasso item) as normalized annotation JSON, and paste it on any page or score at the same position or where you tap.
Effort: S

### [Sheet music] No annotation layers
Evidence: one list of strokes per page (`db.ts:25-31`). A teacher's markings, the conductor's bowings and your own notes can't be shown or hidden separately. Newzik and forScore have layers [unverified].
Fix: `AnnotationEntry.layer` (id `${score}:${layer}:${page}`), with a layer list per score (name, visible, locked) and a layer picker in the ink bar.
Effort: M

### [Sheet music] Cannot annotate in two-page view
Evidence: annotating forces single-page view (`sheetmusic.ts:378`, `layout === 'two' && !annotating`).
Fix: `pageWrap` already creates an overlay per page. Call `attachInk` on both overlays and remove the `!annotating` condition.
Effort: S

### [Sheet music] Opening a score loads every annotation in the app
Evidence: `db.list('annotations')` followed by a filter (`sheetmusic.ts:273-274`), even though the `scoreId` index exists (`db.ts:56`). `saveInk` also writes on every stroke and on every erase during a drag.
Fix: add `db.listBy('annotations', 'scoreId', id)` using `index.getAll(IDBKeyRange.only(id))`, and debounce writes per page by 500 ms, flushing on close and `visibilitychange`.
Effort: S

### [Sheet music] Replacing the PDF would break annotations
Evidence: annotations are keyed by page number (`db.ts:26`), and there is no "replace file" action. A corrected edition with one extra page would shift every marking.
Fix: "Replace PDF" keeps the score id and annotations and offers a page mapping (default same index, with an insert or delete offset). Warn when the page count changes.
Effort: M

### [Sheet music] Cannot share annotations without the PDF
Evidence: no export of annotations alone. Gap item 69 is a flattened PDF export.
Fix: export `{scoreName, pageCount, fingerprint, layers}` JSON, and import it onto a score whose page count matches, warning when the pdf.js `doc.fingerprints` differ. This lets a teacher send bowings to a whole section.
Effort: S

### [Sheet music] No distributing markings or turns to an ensemble
Evidence: no multi-device features. Newzik offers conductor-to-player sharing [unverified].
Fix: local peer-to-peer over WebRTC, paired with a QR code, since there is no server (signalling pasted manually or through a small optional relay, which is your decision). The leader broadcasts annotation layers and optional page turns.
Effort: XL

### [Sheet music] Rendered pages are never evicted from memory
Evidence: `pageCache` is a Map of full-resolution canvases that only clears on resize or open (`sheetmusic.ts:50,558`). Paging through a 300-page score at DPR 3 keeps hundreds of large canvases. iOS Safari has a total canvas memory limit [unverified exact figure].
Fix: an LRU cache of about 6 canvases that sets `width = 0` on eviction to free memory. Cap the render size at about 16M pixels by lowering the DPR factor on large pages.
Effort: S

### [Sheet music] Next pages are not pre-rendered
Evidence: `renderPage` runs only when needed (`sheetmusic.ts:380`), so each turn waits for pdf.js to render. forScore turns feel instant [unverified].
Fix: after each render, schedule rendering of `page + 1` (and +2 in two-page view) with `requestIdleCallback`, at the same fit size, into the LRU cache.
Effort: S

### [Sheet music] Fast turns waste renders
Evidence: `renderToken` discards stale results (`sheetmusic.ts:351,359,381`), but the pdf.js `RenderTask` keeps running, and the same page can render twice at once.
Fix: keep an in-flight `Map<key, Promise>` and call `renderTask.cancel()` on renders that are no longer wanted.
Effort: S

### [Sheet music] Whole PDFs are read into memory
Evidence: import reads the full `arrayBuffer` and parses it for the thumbnail (`sheetmusic.ts:102-105`). Opening reads the whole file again (`sheetmusic.ts:260`). A 200 MB scanned opera score means large memory spikes.
Fix: pass pdf.js a range transport (`PDFDataRangeTransport`) that reads `blob.slice(begin, end)` on request, so only the pages needed are loaded. Measure peak memory before and after on a large scan.
Effort: M

### [Sheet music] Import has no progress and can't be cancelled
Evidence: files import one at a time, each rendering a thumbnail, with no progress indicator (`sheetmusic.ts:96-114`). Importing 40 PDFs looks frozen.
Fix: a progress row showing "12 of 40" with a cancel button. Create thumbnails after saving, in the background, so records exist right away.
Effort: S

### [Sheet music] Password-protected PDFs just fail
Evidence: `getDocument({ data })` is called without `onPassword` (`sheetmusic.ts:23,262`), so encrypted PDFs show a generic "Could not open".
Fix: set `loadingTask.onPassword = (update, reason) => …` to show a password sheet, and keep the password in memory for the session only. Explain corrupt files in plain words.
Effort: S

### [Sheet music] Half-page split is always at the middle
Evidence: `const half = Math.floor(c.height / 2)` (`sheetmusic.ts:369`). Systems often cross the middle of the page, so the split cuts through a staff.
Fix: store a `splits: Record<page, number>` fraction on `ScoreEntry`, with a draggable split line in an "Adjust split" mode. Use it for both the source and destination rectangles.
Effort: S

### [Sheet music] Half-page view distorts pages of different sizes
Evidence: the composite uses `max(top.width, bottom.width)` and `bottom.height`, and draws the top half of `top` (height `top.height / 2`) into `half` rows (`sheetmusic.ts:362-371`). Mixed page sizes, common in scanned books, get stretched or misaligned.
Fix: scale each source to the composite width, keep its aspect ratio, and centre it.
Effort: S

### [Sheet music] Two-page view can't pair pages like a book
Evidence: spreads are `[view.page, view.page + 1]` starting from whatever page you were on (`sheetmusic.ts:378`), and `go` steps by 2 from there (`sheetmusic.ts:315`). Starting on page 2 pairs 2 and 3, which may not match facing pages.
Fix: a "Cover page alone" option. Snap spreads to odd or even starts based on it.
Effort: S

### [Sheet music] Layout doesn't follow orientation
Evidence: layout is chosen by hand and resets to single on every open (`sheetmusic.ts:44`). A phone in portrait with "Two" shows unreadable pages.
Fix: an "Auto" layout: two pages when `innerWidth > innerHeight * 1.2`, otherwise one. Remember the layout per score.
Effort: S

### [Sheet music] Pages overflow landscape phones
Evidence: `maxH = Math.max(420, innerHeight - 200)` (`sheetmusic.ts:354`). On a 390 px tall landscape phone the page is taller than the screen, and vertical scrolling conflicts with tap-to-turn.
Fix: use `innerHeight - chromeHeight` measured from the toolbar with a smaller minimum. In landscape, offer fit-width with half-page scroll steps.
Effort: S

### [Sheet music] Toolbars and hint take up space and can't be hidden
Evidence: a sticky viewer bar (`styles.css:2955`), a sticky ink bar (`styles.css:3507`) and a hint line that is always visible (`sheetmusic.ts:254`).
Fix: tapping the centre third toggles the chrome, which auto-hides after 3 s. Show the hint only for the first 3 opens.
Effort: S

### [Sheet music] Page-turn tap zones cause mistakes
Evidence: any click on the left or right half turns the page (`sheetmusic.ts:499-503`), including taps meant for scrolling or accidental touches. There is no swipe and no setting for the zones.
Fix: turn only on taps shorter than 250 ms with little movement. Add horizontal swipe with a threshold, and settings for zone width or "right side only goes forward".
Effort: S

### [Sheet music] Reader preferences are not saved per score
Evidence: `layout`, `night` and the pen tool reset on every open (`sheetmusic.ts:43-48`). `ScoreEntry` has only `lastPage` and `bpm` (`db.ts:12-23`).
Fix: add `ScoreEntry.prefs: {layout, night, splits, rotation}`. Load it in `openScore` and save it when it changes.
Effort: S

### [Sheet music] Pages can't be rotated
Evidence: `getViewport({ scale })` never passes `rotation` (`sheetmusic.ts:332-337`). Pages scanned sideways stay sideways.
Fix: per-page `rotation: 0 | 90 | 180 | 270` in prefs, passed to `getViewport({ scale, rotation })`. The ink coordinates must use the rotated frame, so store them in rotated space and test that ink stays in place after rotating.
Effort: S

### [Sheet music] No continuous vertical scroll
Evidence: only page, two-page and half-turn layouts (`sheetmusic.ts:16`). MobileSheets has a vertical scroll mode [unverified].
Fix: a `scroll` layout: pages stacked at fit width, rendered lazily with `IntersectionObserver` through the LRU cache. Pedals scroll by 80% of the screen height.
Effort: M

### [Sheet music] No jump to a page number
Evidence: `pageLabel` is plain text (`sheetmusic.ts:160`). Getting to page 180 means 179 turns (thumbnails are gap item 69, a separate feature).
Fix: make the page label a button that opens a number input. Enter jumps there.
Effort: S

### [Sheet music] The PDF's own table of contents is ignored
Evidence: `doc.getOutline()` is never called. Anthology PDFs often have outlines.
Fix: an Outline sheet listing outline items, resolved with `doc.getPageIndex(dest)`. Add "Make pieces from outline" to create virtual library entries by page range.
Effort: S

### [Sheet music] One book PDF can't be split into pieces
Evidence: one PDF equals one library entry (`sheetmusic.ts:109`). A 400-page Real Book is one item. forScore uses bookmarks as separate pieces [unverified].
Fix: `ScoreEntry.range?: {sourceId, from, to}` for virtual scores that share the source blob. Library cards show the range, and page numbers shift by the offset.
Effort: M

### [Sheet music] No text search inside PDFs
Evidence: `page.getTextContent()` is never used.
Fix: an index built lazily by extracting text per page into IndexedDB, and a search box listing page hits. Scanned PDFs have no text, so say so when nothing is found.
Effort: M

### [Sheet music] No repeat jump links
Evidence: going back for a repeat or a D.S. means paging backwards. forScore has link points [unverified].
Fix: a "link" tool: tap a source spot, then a target page and spot. Store `{page, x, y, targetPage, targetY}`. In reading mode a small badge jumps there, and a "back" chip returns you.
Effort: M

### [Sheet music] Cannot rearrange pages
Evidence: no page editing. You can't remove blank pages, insert staff paper, or combine parts.
Fix: a virtual page order `pageOrder: (pdfPage | 'blank')[]` on `ScoreEntry`, edited in a thumbnail grid with drag and delete. Rendering maps indexes through it, so the original PDF is untouched.
Effort: M

### [Sheet music] Photos and scans can't be imported
Evidence: `accept: 'application/pdf'`, and other file types are rejected (`sheetmusic.ts:61,97`). Students often photograph handouts.
Fix: accept `image/*`. Store images as pages of a score with an image source type that draws the image to canvas. For camera capture, `<input capture="environment">`, then perspective correction with 4 corner handles (homography warp) and an optional black-and-white threshold.
Effort: M

### [Sheet music] No MusicXML import or rendering
Evidence: PDF only. The MuseScore app and Newzik handle symbolic scores [unverified].
Fix: render with OpenSheetMusicDisplay (check its licence and bundle size first) in a lazy-loaded chunk, for `.musicxml` and `.mxl` (unzip). Store the XML as the blob with `kind: 'musicxml'`. Reflow to the screen width comes for free.
Effort: L

### [Sheet music] No MusicXML playback
Evidence: symbolic playback doesn't exist.
Fix: once MusicXML import exists, turn notes into timed events using the `<sound tempo>` markings, play them through the existing synth voices, and move the rendered cursor with each event. Link it to the shared metronome tempo.
Effort: L

### [Sheet music] Notation can't be transposed
Evidence: the tuner supports transposing instruments (README), but there is nothing for scores.
Fix: with MusicXML, apply a transposition interval to pitches and key signatures before rendering, by semitones plus a spelling choice. Default to the instrument transposition from settings.
Effort: M

### [Sheet music] No part selection or play-along
Evidence: there is no way to mute your own part and play along.
Fix: with MusicXML, list the parts and toggle playback mute or solo and display per part. Add a "My part" preset.
Effort: M

### [Sheet music] No music recognition for scanned PDFs
Evidence: scanned PDFs cannot become playable.
Fix: an optional OMR path using Audiveris (check whether the licence works with an MIT app). It can't run in the browser, so offer "export page images for Audiveris, import the MusicXML result" rather than bundling it.
Effort: XL

### [Sheet music] The library has no metadata
Evidence: `ScoreEntry` stores only name, added, lastPage, pageCount, bpm and thumb (`db.ts:12-23`). No composer, key, genre, instrument, difficulty or tags. MobileSheets has rich metadata [unverified].
Fix: optional fields for those plus an edit sheet. On import, prefill title and author from `doc.getMetadata()`.
Effort: S

### [Sheet music] No library search or filters
Evidence: a single grid of all scores (`sheetmusic.ts:129-153`).
Fix: a search box matching name, composer and tags, and filter chips for tag, key and difficulty. Keep the query in the URL hash.
Effort: S

### [Sheet music] The library can only be sorted by name
Evidence: `scores.sort((a, b) => a.name.localeCompare(b.name))` (`sheetmusic.ts:128`).
Fix: sort by name, recently opened (add `lastOpened`), date added or composer, remembered in settings.
Effort: S

### [Sheet music] Scores can't be renamed
Evidence: the name comes from the file name on import (`sheetmusic.ts:109`), and no UI edits it.
Fix: an edit button on each card that opens the metadata sheet.
Effort: S

### [Sheet music] No folders or collections
Evidence: a flat list.
Fix: `collections: {id, name, scoreIds}` stored in IndexedDB, shown as chips above the grid, with a score allowed in several collections. This is separate from setlists (item 69), which are ordered.
Effort: S

### [Sheet music] The same PDF can be imported twice
Evidence: every import gets a new `uid()` (`sheetmusic.ts:109`).
Fix: hash the file (`crypto.subtle.digest('SHA-256', data)`), store it as `hash`, and offer "Already in library: open it or import a copy".
Effort: S

### [Sheet music] Other apps can't send PDFs to Partial
Evidence: `manifest.webmanifest` has no `share_target` or `file_handlers`.
Fix: add `share_target` (POST multipart with accept `application/pdf`), handled in `sw.js`, which stashes the file and redirects to `#/sheet`. Add `file_handlers` with `launchQueue` for desktop Chromium. Browser support differs and needs checking [unverified].
Effort: M

### [Sheet music] No cloud or URL import
Evidence: only the file picker and drag-and-drop (`sheetmusic.ts:59-90`).
Fix: import by URL with `fetch`, which only works where CORS allows, so explain failures. Google Drive and Dropbox pickers need API keys and client ids, which is your decision.
Effort: M

### [Sheet music] No linked local folder
Evidence: there is no folder sync. MobileSheets syncs from folders [unverified].
Fix: in Chromium, `showDirectoryPicker()` stores a handle in IndexedDB. On open, check permission and list PDFs, importing new ones by hash. Hide the option where the API is missing.
Effort: M

### [Sheet music] Library listing may load every PDF's data
Evidence: `renderLibrary` calls `db.list('scores')` (`sheetmusic.ts:123`), which returns full records including `blob` and the data URL thumbnail. Whether IndexedDB blobs are read into memory at that point is [unverified]. The thumbnails are certainly all loaded.
Fix: split into a `scoreMeta` store (no blob, thumbnail as its own small Blob URL) and a `scoreFiles` store, with a database version 3 migration and a test.
Effort: M

### [Sheet music] Score tempo is saved inconsistently and overrides the metronome
Evidence: `score.bpm` is saved only when you start the metronome from the reader (`sheetmusic.ts:171-174`), so tempo changes after that are lost. Opening a score silently changes the global metronome tempo (`sheetmusic.ts:284-287`).
Fix: subscribe to metronome changes while the score is open and save the latest BPM when it stops. Apply the score tempo when you press play, not on open.
Effort: S

### [Sheet music] No practice settings per score
Evidence: only BPM is stored. Meter, subdivision, key or drone note, transposition and temperament are not.
Fix: `ScoreEntry.practice: {meter, subdivision, droneRoot, transposition}`. Add a "Practice setup" sheet in the reader that applies all of them.
Effort: S

### [Sheet music] No audio attached to a score
Evidence: you can't play a reference recording or your own take while reading. forScore and MobileSheets attach audio [unverified].
Fix: `ScoreEntry.media: assetId[]` pointing at recordings or imported audio. Add a mini player in the reader with speed, and the A-B loop from gap item 27.
Effort: M

### [Sheet music] Can't record from the reader
Evidence: recording lives only on the Record screen. The reader has a tuner and metronome but no recorder (`sheetmusic.ts:239`).
Fix: a record button that uses the recorder module and saves the take with `scoreId` and the current page. The score card shows a take count.
Effort: M

### [Sheet music] Can't attach a click track to a score
Evidence: the click track player stops when you leave its screen (`clicktrack.ts:377-382`), and scores store only one BPM.
Fix: `ScoreEntry.clickTrackId`. Once playback is a shared service (see the click-track item above), the reader has a play button showing the current section and bar. Different from gap item 54a, which turns pages after N bars.
Effort: M

### [Sheet music] No hands-free turning by head movement
Evidence: only tap, keys and MIDI turn pages. forScore turns pages with face gestures [unverified].
Fix: an opt-in camera mode using a face landmark model (such as MediaPipe; check the licence and model size) to detect head turns or mouth open on a short time window, with a sensitivity slider and a visible indicator. Everything runs on the device.
Effort: L

### [Sheet music] Keyboard pedals can't be remapped
Evidence: `onKey` accepts a fixed set of keys (`sheetmusic.ts:545-551`). Pedals that send Enter, J/K or volume keys don't work, and there are no double-tap or long-press actions. MIDI learning exists (`controls.ts`), but not for keyboard pedals.
Fix: add keyboard learning to the MIDI learn UI (record `e.code`), plus mapping for double press within 300 ms (for example, first page).
Effort: S

### [Sheet music] No sign you've reached the last page
Evidence: `go()` returns silently at the ends (`sheetmusic.ts:317`). A player pressing the pedal at the end gets no response.
Fix: a short edge flash and "Last page" toast. Optionally, a pedal press on the last page opens the next score in a setlist (with item 69).
Effort: S

### [Sheet music] Pages are invisible to screen readers
Evidence: the page canvases have no role or label (`sheetmusic.ts:338-339`), and page changes are not announced, though the app has a live announcer (README).
Fix: `role="img"` with `aria-label="Page 3 of 12"` on each wrap, and announce page changes. Expose PDF text where it exists as visually hidden text.
Effort: S

### [Sheet music] Toasts are probably hidden in full screen
Evidence: `toast` appends to `document.body` (`components.ts:151-153`), while full screen is on `viewerEl` (`sheetmusic.ts:248`). Content outside the full-screen element is normally not shown [unverified]. That hides "Could not save annotations" (`sheetmusic.ts:424`).
Fix: append toasts to `document.fullscreenElement ?? document.body`, and do the same for sheets.
Effort: S

### [Sheet music] No display adjustments for scans
Evidence: only an invert-style night mode (`styles.css:3560`). No sepia, brightness, contrast or cleanup for grey scans.
Fix: per-score `display: {mode: normal | sepia | night, contrast}` using CSS filters. Add optional black-and-white threshold rendering (canvas pixel pass at render time).
Effort: S

### [Sheet music] Nothing prevents accidental edits while performing
Evidence: the annotate button and tools are always one tap away (`sheetmusic.ts:182,239`).
Fix: a "Performance" toggle that hides annotate, delete and layout controls and allows turning only. Unlock with a long press.
Effort: S

### [Sheet music] No second screen
Evidence: one window only. There is no dual-screen or projector mode for page pairs or a teacher's screen.
Fix: "Open mirror window" using `window.open` with `BroadcastChannel`, syncing page and ink changes, or the Presentation API where supported [unverified support].
Effort: M

### [Sheet music] Pen eraser button and hover are ignored
Evidence: `pointerdown` ignores `e.buttons`. The eraser end of Surface-style pens reports `buttons & 32` [unverified]. No hover preview.
Fix: when `e.buttons & 32` or `e.button === 5`, use the eraser for that gesture. Show a small cursor ring on `pointermove` with pen pointers that aren't pressed.
Effort: S

### [Sheet music] Pen contact doesn't start annotating
Evidence: you must tap Annotate first (`sheetmusic.ts:182`). In reading mode, pen taps turn pages.
Fix: a setting so that a pen `pointerdown` on the page (not touch) enters annotate mode with the last-used tool and leaves it after 5 s idle.
Effort: S

### [Sheet music] Mobile toolbar scrolling can trigger re-renders
Evidence: every `resize` clears the whole page cache and re-renders 150 ms later (`sheetmusic.ts:555-560`). Mobile browsers fire resize when their toolbar shows or hides [unverified for each browser], causing flicker and wasted renders.
Fix: re-render only if the width changed, or the height changed by more than 15%, and keep the cache entries for the old key until the new render arrives.
Effort: S

### [Sheet music] Reading time isn't logged
Evidence: the sheet reader never calls `logPractice`. Practice rings don't count score reading.
Fix: log time while the viewer is open and visible with an interaction in the last 2 minutes, as a `sheet` activity.
Effort: S

### [Sheet music] Two tabs overwrite each other's annotations
Evidence: `saveInk` writes a page's whole stroke list (`sheetmusic.ts:424`). Two open tabs on the same score keep overwriting each other.
Fix: `BroadcastChannel('partial-ink')` messages on each save. Other tabs merge by stroke id (add `id` to `Stroke`) or reload that page with a notice.
Effort: S

### [Sheet music] Can't view two scores side by side
Evidence: the viewer holds one `doc` (`sheetmusic.ts:40`), so you can't see the full score next to your part.
Fix: a split layout with two independent viewer instances (refactor the reader state into a factory), each with its own turn controls, with pedals driving the focused pane.
Effort: M

### [Sheet music] Printed page numbers are ignored
Evidence: the label shows the PDF index, `${page} / ${count}` (`sheetmusic.ts:379`). A book whose printed page 1 is PDF page 9 confuses "go to page 45".
Fix: read `doc.getPageLabels()`, show the printed label, and accept printed labels in go-to-page, with a manual offset field when the PDF has no labels.
Effort: S
