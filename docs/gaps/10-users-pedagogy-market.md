# Gaps by user, teaching and market

This file lists 178 items that don't repeat the 78 in `docs/gap-analysis.md`.

I read `C:\Users\Sri\TE\docs\gap-analysis.md`, `C:\Users\Sri\TE\README.md`, all of `src/core/*.ts` that matter here, `src/store/settings.ts`, `src/audio/context.ts` and `droneBank.ts`, and I skimmed every view in `src/ui/views/`.

- **Code references:** I checked each one this session.
- **Competitor facts:** they come from search result summaries of the URLs cited, not from reading each page line by line.
- **Arithmetic:** I computed every cents value myself (for example 1200·log2(7/4) = 968.8).
- **Recalled facts:** anything I remembered rather than looked up is marked [unverified].
- **Links to existing items:** where an item builds on one of the 78, it says so.

I stopped at 178 because more would have been padding.

---

### [Child violinist] Finger number and string display instead of note names
Evidence: Strings mode shows the note name and cents for the nearest open string only (`src/core/instruments.ts:52`, `src/ui/views/tuner.ts:277`). A young beginner thinks in "A string, 2nd finger," not "C#5." Finger-tape teaching for beginners is widespread [unverified].
Fix: Add `src/core/fingering.ts` with `fingerFor(instrument, midi, position=1): {string, finger, high?: boolean}` for violin, viola and cello in first position. In chromatic mode, when the instrument profile (item 11) is a bowed string, show "A string · 2 (high)" under the note. Unit test a table of first-position notes. Validate with 3 Suzuki-age students and their parents: can the child say which finger to fix without adult help?
Effort: M

### [Child violinist] Fine-tuner and peg directions in words
Evidence: Strings mode shows cents and sharp/flat (`tuner.ts`). A child needs "turn the fine tuner to the right a little."
Fix: Add a `tuningAction(cents)` helper that returns size buckets ("tiny", "small", "big") and a direction ("tighten" or "loosen"). When the string is more than 50 cents off, show "Ask a grown-up to use the peg." Render it under the strings row. Validate by watching 3 children tune alone.
Effort: S

### [Child violinist] Lock onto the chosen string to prevent snapping one
Evidence: `nearestString` picks whichever string is closest in cents (`instruments.ts:52-64`). If an E string is pulled far sharp, the reading can jump to another string's target. The child keeps tightening and the string breaks.
Fix: Add a "manual string" setting. Tapping a string pins it as the target, and anything more than 100 cents above it shows a red "Too high, stop" state with a haptic pulse. Unit test: 700 Hz against a pinned violin A4 target must report "too high," not "E string flat."
Effort: S

### [Parent] Lock settings so a child cannot change A4 or delete takes
Evidence: A4, temperament and delete buttons are always reachable (`src/ui/tuningSheet.ts:21`, `src/ui/views/recorder.ts`). Settings has no profile or lock field (`settings.ts:25-88`).
Fix: Add `settings.parentLock: {enabled, pinHash}` stored with SubtleCrypto SHA-256. Gate the tuning sheet, deletes, backup import and settings sheets behind the PIN. Say plainly in the UI that this is not security. Validate with 2 parents.
Effort: S

### [Child violinist] Sticker chart and task counters for young children
Evidence: Practice shows minutes, rings and streaks only (`src/ui/views/practice.ts:9-14`, `src/core/practice.ts`). Young students are usually given counts ("10 bow holds"), not minutes [unverified].
Fix: Add `Task {id, label, targetCount, emoji}` and a per-day `taskLog: Record<day, Record<taskId, count>>`. Build a big-button counter screen and a weekly sticker grid. Parents set the tasks behind the parent lock. Validate over 2 weeks with 2 families.
Effort: M

### [Child violinist] Rhythm-pattern metronome for beginner pieces
Evidence: Subdivisions are uniform only, 1 to 6 (`src/ui/views/metronome.ts:21-26`, `src/core/rhythm.ts:46`). Suzuki Twinkle variations use fixed rhythm patterns [unverified pattern details].
Fix: Add a `pattern?: number[]` field to `MeterConfig` holding the onset offsets within a beat, in beat fractions. `barEvents` emits those onsets. Ship patterns only after checking them against the Suzuki Book 1 score. Unit test the event times.
Effort: M

### [Child violinist] Live camera mirror with bow guide lines
Evidence: The recorder can capture video (`recorder.ts:457`), but there is no live preview without recording. Teachers use mirrors to check that the bow is parallel to the bridge [unverified].
Fix: Add a "Mirror" toggle on Record: `getUserMedia({video})` into a flipped `<video>` with a draggable SVG overlay (two lines for bridge and bow). Nothing is saved. Validate with a teacher.
Effort: S

### [Clarinet student] Written-pitch fingering chart for the detected note
Evidence: The app shows no fingerings anywhere in `src/`. Middle schoolers often forget throat-tone and altissimo fingerings [unverified].
Fix: Add an SVG fingering renderer, `src/ui/fingering/clarinet.ts`, with key-state arrays per written MIDI note. Include alternates and label them. Show it under the tuner reading when the profile is clarinet. Have a clarinet teacher check every chart before release.
Effort: L

### [Trumpet student] Brass partial tendencies and slide hints
Evidence: The tuner shows plain cents. The harmonic series makes the 5th partial 13.7 cents flat of equal temperament (1200·log2(5/4) = 386.3) and the 7th 31.2 cents flat (968.8). Using the 3rd valve slide on low D and C# is standard advice [unverified].
Fix: Add `src/core/brass.ts`: for each instrument key, map a written note to its valve combination and partial, then compute the expected deviation from the partial's ratio. Under the reading, show "5th partial, tends flat" and, where a teacher has confirmed it, "extend 3rd slide." Unit test the partial ratios.
Effort: M

### [Trombone student] Slide position display
Evidence: No position output exists. Trombonists think in positions 1 to 7 [unverified mapping details].
Fix: Add a `tromboneSlide(midi)` returning the primary and alternate positions with partial, sharing the tables from `brass.ts`. Replace "sharp/flat" with "slide out/in" for this profile. A trombone teacher reviews the table.
Effort: M

### [Tuba, bari sax, bass clarinet, guitar] Octave-aware transpositions
Evidence: `TRANSPOSITIONS` covers only C, Bb, Eb, F, G and A, with semitones 0 to 9 (`src/core/notes.ts:17-24`). Tenor sax sounds a 9th below written, bari sax an octave plus a 6th, and treble-clef euphonium a 9th [unverified intervals]. The staff view therefore shows the wrong octave.
Fix: Change the entries to full semitone offsets: tenor sax 14, bari sax 21, bass clarinet (treble clef) 14, euphonium TC 14, guitar 12, double bass 12, piccolo -12, glockenspiel -24, D trumpet -2, Eb trumpet -3. Use the full offset in `staff.ts`. Unit test written-to-concert for each, and have a band director confirm the list.
Effort: S

### [Band student] Exercise player root in the written key
Evidence: The Root select lists `noteName(i)` pitch classes with no transposition applied (`src/ui/views/sound.ts:404`). A Bb clarinetist told to play "concert Bb scale" sees C major.
Fix: Show the root in written pitch for the current transposition, with the concert name as a subtitle. Build the MIDI sequence from concert pitch. Unit test that Bb transposition plus written C gives concert Bb.
Effort: S

### [Band student] Scale test mode for chair and playing tests
Evidence: The exercise player plays scales but does not grade the student (`sound.ts:403-415`). Recording reports are per take, with no checklist across keys (`src/core/intonation.ts:45`).
Fix: Add `ScaleTest {keys[], pattern, bpm, results: Record<key, {inTune, timingMsSD, date, takeId}>}`. Record each key against a click and compute pitch with `analyzeTake` and timing from onsets. Show a 12-key grid with best scores. Validate with a band director's real playing-test sheet.
Effort: M

### [Band student] Rhythm reading with clap or play input
Evidence: No rhythm notation or onset scoring exists in `src/`. Rhythm reading is a core middle school skill [unverified].
Fix: Add `src/core/onsets.ts` (spectral flux onset detector) and an SVG rhythm renderer with a one-bar rhythm vocabulary. Compare onsets with expected times after latency calibration (item 50) and show early or late marks. Unit test the detector on synthesized claps.
Effort: L

### [Band student] Long-tone meter for pitch and volume steadiness
Evidence: `TrackerFrame.level` exists (`src/audio/pitchTracker.ts:13-20`), but nothing reports steadiness of loudness over a held note.
Fix: Add a "Long tone" card on Tuner. While a note is held, plot cents and dB together. Afterwards report pitch standard deviation, level standard deviation, and duration. Add an optional target shape (flat, crescendo, messa di voce) with a fit score. Unit test on a synthesized amplitude ramp.
Effort: M

### [Band student] Pitch against loudness report
Evidence: The take report has no dynamics dimension (`intonation.ts:45-56`). Winds drift with dynamics [unverified per instrument].
Fix: For each held note in `segmentNotes`, store its mean RMS. Draw a cents-vs-dB scatter with a regression line: "you go 9 cents sharp when loud." Unit test on synthesized data.
Effort: M

### [Band student] School Chromebook deployment check
Evidence: TE for Education lists Chromebook support (https://play.google.com/store/apps/details?id=com.tonalenergy.tetunered). Resonare has been tested only in Chrome and Edge on desktop (README). Managed ChromeOS may block the microphone by policy [unverified].
Fix: Test the installed PWA on a managed Chromebook. Write `docs/schools.md` with the admin policy needed for microphone access and the PWA install URL.
Effort: S

### [Band student] Practice report the teacher can check
Evidence: CSV and JSON export exist (README), but not a readable weekly report with evidence.
Fix: Add a "Weekly report" that renders an HTML page: minutes per day, activities, the best take intonation per day, and optional attached takes as files. The UI must say the file is not tamper-proof, since there is no server.
Effort: M

### [High school orchestra] Fifths beat-rate trainer for tuning by ear
Evidence: The pure-fifths target exists (`instruments.ts:28`), but the app gives no ear-training signal. For D against an A drone, the beating partials beat at |3·fD − 2·fA| Hz.
Fix: When a drone plays and the tuner detects a note about a fifth or fourth away, compute the beat frequency of the nearest coinciding partials. Show a pulsing dot at that rate, slowing to still when pure. Unit test the beat frequency for D4 at 293.66 Hz against A4 at 440 Hz.
Effort: M

### [High school orchestra] Shift accuracy trainer
Evidence: `segmentNotes` groups held notes (`intonation.ts:90`), but nothing measures the arrival pitch against the settled pitch.
Fix: For each note, record the cents in the first 150 ms and after 400 ms. Report "arrived 22 cents flat, corrected." A drill mode repeats a chosen shift and lists arrival errors. Tune the window lengths on real recordings.
Effort: M

### [High school orchestra] Double-stop interval tuning
Evidence: The interval trainer reads two sequential frequencies (`src/core/intervals.ts:41`). The monophonic YIN detector cannot read double stops.
Fix: Add a "Double stop" mode. The user picks the expected interval, and the app finds two spectral peaks near the expected notes with an 8192-sample FFT plus parabolic interpolation (sharing code with item 48). It reports the interval against just and equal. Benchmark on recorded double stops before release.
Effort: L

### [High school orchestra] Vibrato trainer locked to the metronome
Evidence: Item 44 measures vibrato. No drill exists for building it at controlled speeds.
Fix: Target N oscillations per beat at the metronome tempo. Score the detected rate and width against the target and show a sine guide. Unit test with synthesized vibrato.
Effort: M

### [High school orchestra] Tendencies by scale degree in a key
Evidence: Tendencies are keyed by written pitch class, regardless of key (`intonation.ts:20`). A leading tone and the same note as a flat 6 behave differently for string players [unverified].
Fix: When a tonic is set (`settings.tonic`) or a drone is sounding, also store stats under `tendByDegree[tonic][degree]`. Add a toggle in the tendencies panel.
Effort: M

### [College music major] Jury and audition simulator
Evidence: The app has no mode that randomizes requirements or forbids retakes.
Fix: Add `JuryList {items: {label, type: scale|excerpt|piece, bpm?, scorePage?}}`. Jury mode draws random items, shows each with a countdown, records one take per item with no redo, and produces a combined report. Validate with 2 music majors before a jury.
Effort: M

### [College music major] Repertoire and passage tempo tracker
Evidence: Presets hold tempos, but nothing tracks progress per passage (`settings.ts:11-21`). Modacity plans practice per piece with goals (https://www.modacity.co/).
Fix: Add a `Piece {id, title, scoreId?, passages:[{name, page, targetBpm, log:[{date, bpm, clean:boolean}]}]}` store in IndexedDB. "Log this tempo" is one tap from the metronome. Show a chart of clean tempo over time.
Effort: M

### [College music major] Input device and channel selection for recordings
Evidence: `acquireMic` requests default audio with processing off, but no `deviceId` or channel choice (`src/audio/context.ts:44`). Prescreen videos often use an interface or USB mic.
Fix: Add an input picker from `enumerateDevices()`, stored as `settings.inputDeviceId`, plus a channel select that splits with `ChannelSplitterNode`. Show the live level per channel.
Effort: S

### [College music major] Compare two takes
Evidence: Each take has its own report and chart (`recorder.ts:372`). There is no overlay or blind A/B.
Fix: Select 2 takes to get overlaid intonation charts aligned by the first onset, a stat delta table, and a blind A/B player that hides names until the user picks a preference.
Effort: M

### [College music major] Ear training exercises
Evidence: TE for Education lists ear training exercises (https://www.tonalenergy.com/te-education). ABRSM aural tests include identifying chords and cadences (https://www.abrsm.org/en-gb/about-our-exams/syllabuses). Resonare's interval trainer measures played intervals only.
Fix: Add a `src/core/eartraining.ts` question generator (intervals, chord qualities, cadences, short melodic dictation) played with the drone voices. Answer by buttons or by singing, and store spaced-repetition stats per item.
Effort: L

### [College music major] Movable-do solfege
Evidence: Solfege is fixed do (`notes.ts:158-159`). Many US theory programs teach movable do [unverified].
Fix: Add a `solfegeMovable` notation that computes the syllable from `mod(midi - tonic, 12)`, with la-based minor as an option. Unit test.
Effort: S

### [Professional orchestral player] Named tuning profiles for different ensembles
Evidence: A4, temperament and transposition are single global values (`settings.ts:27-30`).
Fix: Add `tuningProfiles: {id, name, a4, temperament, tonic, transposition}[]` with quick switching on the tuning chip.
Effort: S

### [Professional orchestral player] Fermatas and pauses in click tracks
Evidence: `ClickSection` has bars, tempo, meter and ramp only (`rhythm.ts:69-74`).
Fix: Add `holds?: {bar, beat, seconds}[]`. `expandClickTrack` inserts the delay after that beat and the timeline shows a fermata mark. Unit test the event times.
Effort: S

### [Professional orchestral player] Output device selection for silent backstage checks
Evidence: No output device choice exists. `AudioContext.setSinkId` exists in Chromium [unverified support matrix].
Fix: Add an output picker where supported, plus a "headphones only" toggle that refuses to start drones when the output is the built-in speaker (label heuristics).
Effort: S

### [Oboe or bassoon professional] Reed crow test log
Evidence: Nothing in the app handles short, unstable reed crows. Oboists check crow pitch [unverified target pitches].
Fix: Add a reed mode: a 2 s capture, then fundamental, octave content (from `harmonicLevels`, `spectrum.ts:64`), stability, and a saved `Reed {id, date, crowHz, notes}` list for comparison.
Effort: M

### [Church choir singer] Learn my part from a MusicXML score
Evidence: Sheet music is PDF only (`sheetmusic.ts:60-61`). Choir singers learn parts by hearing them with the other parts quieter [unverified common practice].
Fix: Import MusicXML (license-check a parser such as OpenSheetMusicDisplay first) and play parts with the drone voices, with per-part volume, "my part louder," loop bars, and tempo. Store it as `Score.kind = 'musicxml'`.
Effort: L

### [Church choir singer] Starting-pitch helper
Evidence: Drones play chosen notes (`sound.ts`), but there is no "key plus my starting degree" helper.
Fix: Add a "Give pitch" sheet: choose key, mode, and your first note as a degree. It plays the tonic chord and then your note, in your voice's octave.
Effort: S

### [Church choir singer] Vocal range finder
Evidence: The app has no range capture or voice profile.
Fix: A guided glide low then high records the lowest and highest notes held for 0.5 s or more. Save `voice {low, high}` and use it to pick octaves for drones and exercises. Unit test on synthesized sweeps.
Effort: S

### [Church choir singer] Pitch sag report for unaccompanied singing
Evidence: The take report gives mean cents, not drift over time (`intonation.ts:45-56`).
Fix: Fit a linear regression of cents against time over voiced frames, and compare the first and last tonic occurrences. Report "flattened 18 cents over 3:10." Unit test on a synthesized downward drift.
Effort: S

### [Church choir singer] Follow-the-line contour exercises
Evidence: The pitch-over-time view shows the singer's trace only (`analysis.ts:53`).
Fix: Add `Contour {points:[t, midiFloat]}` presets (sirens, five-note patterns) drawn as a target band. Score the percentage of time inside the band.
Effort: M

### [Church choir singer] Octave-tolerant pitch matching for novices
Evidence: The tuner reports the exact octave. Men matching a higher reference often land an octave below [unverified].
Fix: Add a "Match" mode that compares by pitch class, then says "right note, octave below" separately. Unit test.
Effort: S

### [Barbershop quartet] Adaptive just intonation per chord for drones
Evidence: Drones follow the global temperament from one tonic (`src/audio/droneBank.ts:24-29`). Barbershop tuning targets just ratios for chords (https://heartoffloridachorus.org/wp-content/uploads/2019/03/Craft.Tuning-a-Barbershop-Chord.pdf).
Fix: Add a chord-relative tuning mode. When 2 or more drones sound, detect the chord root and set each note to its ratio from that root (1, 5/4, 3/2, 7/4, 6/5), recalculated whenever notes change. Unit test the frequencies.
Effort: M

### [Barbershop quartet] 7-limit barbershop seventh
Evidence: The minor seventh's only just ratio is 9/5, which is 1017.6 cents (`intervals.ts:22`). The harmonic seventh 7/4 is 968.8 cents.
Fix: Change `just` to `ratios: {label, ratio}[]` so the m7 row carries 9/5, 16/9 and 7/4, and let the interval trainer show all of them. Unit test the cents values.
Effort: S

### [Barbershop quartet] Tuner target relative to a chord
Evidence: The tuner measures against a single-tonic temperament only.
Fix: Add a "Chord context" chip (root, chord type, my voice part). The tuner target for each note becomes its just position in that chord, and the ring shows cents from the just target.
Effort: M

### [Barbershop quartet] Learning track balance knob
Evidence: The app cannot import audio files (file inputs exist only for JSON and PDF: `practice.ts:272`, `sheetmusic.ts:60`). Learning tracks are commonly panned with one part left [unverified].
Fix: Allow audio import into takes. Add a stereo balance slider through `StereoPannerNode` or a split gain on L and R.
Effort: S

### [Barbershop quartet] Chord ring estimate from a recording
Evidence: No chord analysis exists. "Expanded sound" or "ring" comes from coinciding partials (https://choralnet.org/archives/434484). Whether a spectral metric tracks perceived ring is [unverified].
Fix: For a sustained chord, measure the spectral energy concentration at the expected coinciding partials against their spread. Label it experimental until correlated with judges' ratings on 20 recorded chords.
Effort: L

### [Barbershop quartet] Pitch pipe mode
Evidence: Drone timbres have no pitch pipe voice (`src/audio/voices.ts:203`). Quartets start from a pitch pipe [unverified].
Fix: Add a reedy short-tone voice and a "blow the key" button that plays 1.5 s and stops, reachable from a lock-screen-sized button.
Effort: S

### [Jazz musician] Swing ratio on the metronome
Evidence: Subdivision 2 splits beats evenly (`metronome.ts:22`, `rhythm.ts:46`).
Fix: Add `swing: number` (50 to 75%) to `MeterConfig`. `barEvents` offsets every second subdivision to `swing%` of the beat. Add a "2 and 4 only" accent preset. Unit test the offsets.
Effort: S

### [Jazz musician] Play-along from chord changes
Evidence: iReal Pro offers more than 50 backing styles from chord charts (https://www.irealpro.com/). Resonare has no chord chart or accompaniment.
Fix: Add `Chart {bars:[{chords:[{root, quality, beats}]}], form, key, style}`, a text editor, and a simple generator (walking bass, shell voicings, ride pattern) scheduled through `LookaheadScheduler` with transpose and tempo. Start with 3 styles.
Effort: XL

### [Jazz musician] Transcription player for imported audio
Evidence: The app cannot import audio, and playback runs from 0.5x to 1.25x only (`recorder.ts:256`).
Fix: Import audio files into takes, extend speed to 0.25x, and use A-B loop (item 27) with a live pitch-to-note readout of the playback.
Effort: M

### [Jazz musician] Modes, blues, bebop and 7th-chord patterns
Evidence: Only 9 patterns exist and none are modes, dominant 7ths or blues (`src/core/exercises.ts:3-13`).
Fix: Add Dorian, Mixolydian, Lydian, Locrian, blues, bebop dominant, altered, dominant 7th, half-diminished and diminished 7th arpeggios, plus a ii-V-I pattern cycling through keys (with item 21's transpose-each-repeat). Unit test the sequences.
Effort: S

### [Jazz musician] Ahead-or-behind the beat feel analysis
Evidence: No onset timing analysis exists.
Fix: Using the `onsets.ts` detector, record against the click, compute the mean and standard deviation of offset in ms per beat position, and measure the played swing ratio. Chart the result.
Effort: M

### [Guitarist] Custom and alternate tuning editor
Evidence: Only 4 guitar tunings exist (`instruments.ts:13-16`). Fender Tune ships more than 26 presets, including Open G, Open D and Drop C, plus custom tunings (https://apps.apple.com/us/app/fender-tune-guitar-tuner-app/id1107017950).
Fix: Add `settings.customInstruments: StringInstrument[]` and an editor (string count, note per string, name). Add Open G, Open D, Open E, Drop C and C standard presets. Validate a round trip in the backup JSON.
Effort: S

### [Guitarist] Capo support
Evidence: String targets ignore any capo (`instruments.ts:31`).
Fix: Add `settings.capo: number`. Targets become `strings[i] + capo`, and the label shows "fret 2 capo." Unit test.
Effort: S

### [Guitarist] Intonation setup assistant
Evidence: Peterson positions its tuners for setting guitar intonation (https://www.petersontuners.com/myinstrument/electric). Resonare has no setup flow.
Fix: Per string, capture the 12th-fret harmonic, then the fretted 12th, and show the difference in cents with the direction to move the saddle [unverified rule: fretted sharp means lengthen]. Save `SetupLog {date, instrumentName, diffs[]}` for later comparison.
Effort: M

### [Guitarist] Sweetened per-string offsets
Evidence: Peterson offers "sweetened" presets for fretted instruments (https://www.petersontuners.com/products/strobosoft/). `StringInstrument` has no per-string offsets (`instruments.ts:3-10`). Peterson's offset values were not in what I read [unverified].
Fix: Add `offsets?: number[]` in cents, apply them in `stringFrequency`, and make them user-editable. Ship no default values until they come from a documented source.
Effort: S

### [Guitarist] 12-string and extended-range instruments
Evidence: No 7-string, 8-string, baritone or 12-string instruments exist (`instruments.ts:12-26`). Octave courses on a 12-string confuse nearest-string matching.
Fix: Add `courses?: number[][]` so a course can hold an octave pair. `nearestString` tests both notes of a course and reports which one, and the course is shown as a pair. Unit test.
Effort: S

### [Guitarist] Chord diagrams in any tuning
Evidence: Fender Tune has a chord library that generates shapes in any tuning (https://apps.apple.com/us/app/fender-tune-guitar-tuner-app/id1107017950). Resonare has none.
Fix: Add a `src/core/chordShapes.ts` solver: given tuning, capo and chord pitch classes, enumerate playable voicings within a 4-fret span and rank them by fingers and completeness. Render SVG diagrams, and let a tap sound the chord.
Effort: L

### [Bassist] Harmonic-based tuning target
Evidence: The lowest bass notes sit near the 30 Hz detector floor (5-string low B is MIDI 23, 30.9 Hz; `instruments.ts:18`).
Fix: Add a "tune with 12th-fret harmonic" toggle that doubles each target frequency, improving low-string reliability until item 13 lands. Unit test the targets.
Effort: S

### [Double bassist] Solo tuning and low C extension
Evidence: Double bass has only orchestral E A D G (`instruments.ts:23`). Solo tuning a whole step up and C extensions exist [unverified].
Fix: Add "Double bass (solo)" and "Double bass (C extension)" presets through the editor.
Effort: S

### [Fretless bassist] Virtual fret lines on the pitch trace
Evidence: The tuner trace shows the last 10 seconds without note grid lines tied to the instrument (`tuner.ts:551`).
Fix: Draw horizontal lines at each semitone within ±2 notes, labelled with fret numbers for the chosen string. Show glide-in time to within the tolerance.
Effort: M

### [Drummer] Drum lug tuning mode
Evidence: Tune-Bot measures pitch struck near each lug and filters overtones (https://tune-bot.com/). YIN on a decaying drum hit is untested in Resonare (`src/core/pitch.ts`).
Fix: Add a percussive mode: trigger on onset, take the spectral peak in a 100 to 600 ms window, and show Hz. Build a head diagram with N lugs where each hit fills the selected lug, plus the maximum spread. Benchmark on recorded toms before release.
Effort: M

### [Drummer] Tom interval planner
Evidence: Tune-Bot has a drum tuning calculator (https://tune-bot.com/tuning-calculator/). Resonare has none.
Fix: Add `Kit {drums:[{name, sizeIn, targetHz}]}` with interval presets (fourths, thirds) from a chosen floor-tom note, and link targets to the lug mode.
Effort: S

### [Timpanist] Timpani preset and pitch check
Evidence: TE suggests sustaining a reference tone and tuning timpani by ear (https://www.tonalenergy.com/te-mobile). Resonare drones can do that, but there is no timpani profile. Which partial listeners hear as timpani pitch is [unverified].
Fix: Add a timpani profile: headphone-reference button per drum (4 drums with ranges), percussive-mode reading tuned on recorded timpani, and a "next note change" list from the part.
Effort: M

### [Drummer] Rudiment trainer with sticking
Evidence: The app has no sticking or rudiment content. The PAS publishes an international drum rudiment list [unverified count and URL].
Fix: Add `Rudiment {name, pattern:[{hand:'R'|'L', accent, grace, tuplet}]}`, render the sticking under the notes, and speed-train with the existing trainer. Load content only after checking the PAS list and its license.
Effort: L

### [Drummer] Multi-voice groove step sequencer
Evidence: Kick, snare and hi-hat click sounds exist (`voices.ts:3-19`), but the metronome uses one sound per beat level.
Fix: Add `Groove {steps: 16|12|24, voices:{sound, vel[]}[]}` scheduled per step, with a grid editor and presets saved as metronome presets. Unit test the event times.
Effort: M

### [Drummer] Live setlist with pedal advance
Evidence: Presets exist but nothing orders them for manual next-song use (`settings.ts:68`). Item 3 covers auto-sequenced presets, not gig use. Setlist Metronome advances songs with a page-turner pedal (https://setlistmetronome.app/).
Fix: Add `Setlist {songs:[presetId]}` with a giant song title and BPM. The existing MIDI and keyboard `next` action moves to the next song without starting it.
Effort: S

### [Drummer] Onset timing accuracy report
Evidence: No timing measurement exists.
Fix: Play on a pad against the click and use `onsets.ts` to show a histogram of early/late ms, standard deviation, and a drift chart over the take, after latency calibration (item 50).
Effort: M

### [Drummer] Loud click for acoustic kits
Evidence: The click chain has a volume setting but no limiter (`settings.ts:55`).
Fix: Add a `DynamicsCompressorNode` limiter on the click bus with a "loud" preset and a warning about hearing.
Effort: S

### [Drummer] Additive meter grouping display
Evidence: Accents are per beat (`rhythm.ts:1`), but 7/8 blocks show no 2+2+3 grouping.
Fix: Add `grouping?: number[]` to `MeterConfig`, applying accents and gaps between block groups. Include presets for 2+2+3, 3+2+2 and 3+3+2.
Effort: S

### [Pianist] Piano tuning with inharmonicity and stretch
Evidence: TuneLab measures inharmonicity and builds a stretch curve (https://www.tunelab-world.com/TuneLab%20Piano%20Tuner%204.4.pdf). Resonare targets exact equal temperament.
Fix: Measure the inharmonicity coefficient B on 5 or more notes from partial frequencies (8192+ FFT). Compute the per-key target offsets for chosen octave-type stretch, and add a piano mode showing target cents per key. Add a disclaimer about pin and string damage.
Effort: L

### [Pianist] Unison beat readout
Evidence: No beat analysis exists.
Fix: For a struck note, detect amplitude modulation of the fundamental's partial band. Show the beat rate, and still when the unison is clean. Validate on recorded unisons.
Effort: M

### [Pianist] MIDI scale evenness report
Evidence: MIDI is used only for actions (`src/core/midi.ts:1`).
Fix: Record MIDI note-on events into `MidiTake {events[]}` and report timing standard deviation against the click and velocity standard deviation per hand range, highlighting uneven notes on a keyboard graphic.
Effort: M

### [Pianist] Exam scale requirement checklists
Evidence: ABRSM grades require scales and arpeggios from memory (https://www.abrsm.org/sites/default/files/2023-09/piano-2023-2024-practical-grades-syllabus-may-2022.pdf). The app has no syllabus lists.
Fix: Add `Syllabus {board, instrument, grade, items:[{pattern, keys, octaves, bpm}]}` as JSON data. Transcribe each list from the current PDF, recording the PDF version and page. Include a random-examiner mode.
Effort: M

### [Pianist] Correct-repetitions counter
Evidence: The app has no repetition tracking.
Fix: A "5 in a row" bead counter with a big hit/miss pair of buttons (and MIDI pedal actions), saved per passage in the repertoire tracker.
Effort: S

### [Organist] Pitch against temperature log
Evidence: The app keeps no tuning logs. Organ pitch changes with temperature [unverified magnitude].
Fix: Add `OrganLog {date, tempC, a4Measured, stop}` using "Set A from what I hear" (item 72), charted against temperature.
Effort: S

### [Organist] Footage labels in the harmonic view
Evidence: Harmonic levels show partial numbers only (`spectrum.ts:57-76`).
Fix: When the profile is organ, label partial k as footage 8/k (4', 2 2/3', 2', 1 3/5'). Unit test.
Effort: S

### [Organist] Text stamps for registration in the sheet reader
Evidence: The ink tools are pen and highlight only (`src/core/ink.ts:1`).
Fix: Add a `TextStamp {page, x, y, text, size}` tool for registrations and fingerings, stored with the ink.
Effort: S

### [Harpist] Harp tuner with pedal or lever settings
Evidence: `STRING_INSTRUMENTS` has no harp (`instruments.ts:12-26`).
Fix: Add a harp model: 47-string pedal harp and lever harp sizes, `pedals: Record<'C'...'B', -1|0|1>`, string colour cues (C red, F dark), and targets computed from pedal state. Verify the range and conventions with a harpist [unverified].
Effort: M

### [Harpist] Pedal diagram for a key
Evidence: No pedal diagram exists.
Fix: Render the pedal layout for a selected key or chord in the harp's pedal order [unverified order; confirm with a harpist].
Effort: S

### [Harpist] Auto-advance string by string
Evidence: Strings mode requires a tap to move between targets (`tuner.ts:277`).
Fix: Once in tune for 1 s, advance to the next string with an announcement and haptic pulse. Include a direction option and skip.
Effort: S

### [Early music player] A4 range below 400 Hz
Evidence: A4 is clamped to 400 to 480 Hz (`tuningSheet.ts:21`). Some baroque pitch standards sit near 392 Hz [unverified].
Fix: Widen the clamp to 380 to 500 Hz and add chips for 392, 415, 430 and 466. Unit test the clamp.
Effort: S

### [Early music player] More historical temperaments
Evidence: Only 7 temperaments exist (`notes.ts:4-14`). Item 15 is a custom editor, not researched presets.
Fix: Add 1/6-comma and 1/5-comma meantone, Kirnberger III and one Bach-derived proposal. Build each from its primary publication (resolve DOIs first) and unit test against its defining tempering.
Effort: S

### [Early music player] Meantone chain and enharmonic choice
Evidence: Meantone is fixed from 3 flats to 8 sharps of the tonic (`notes.ts:39-45`), so Ab is always a G#. The difference is about 41 cents in quarter-comma.
Fix: Add `meantoneStart` (the number of flats in the chain), with a UI of "G# or Ab," "D# or Eb." Unit test the pitch class offsets.
Effort: S

### [Early music player] Viol, lute and theorbo tunings
Evidence: No historical string instruments exist (`instruments.ts`).
Fix: Add presets through the custom editor for treble, tenor and bass viol, Renaissance lute and theorbo (with re-entrant flag). Take the tunings from a cited source [unverified values].
Effort: S

### [Early music player] Dual note names for low-pitch parts
Evidence: At A = 415, written notes sound about 101 cents below modern pitch (1200·log2(415/440) = -101.3), and the tuner names only the modern note.
Fix: When A4 is within 20 cents of a semitone below 440, optionally show "reads as A (baroque)." Add a toggle.
Effort: S

### [Natural trumpet or horn player] Harmonic series target mode
Evidence: No partial-based targets exist. The 11th partial is 551.3 cents above its octave (1200·log2(11/8)), nearly a quarter tone from equal temperament.
Fix: Add a "Harmonic series" tuner mode: set a fundamental, and the targets become k·f0 with the partial number shown. Unit test.
Effort: S

### [Indian classical musician] Tanpura drone
Evidence: The drone timbres are sustained synthetic tones (`voices.ts:203`). iTablaPro includes two 5-string tanpuras (https://apps.apple.com/us/app/itablapro-tabla-tanpura-player/id337350026).
Fix: Add a plucked-string synth (Karplus-Strong plus a bridge-buzz nonlinearity), string cycle patterns with a choice of first string (Pa, Ma or Ni), Sa set by note plus fine cents, and cycle speed. Validate with 2 performers against a real tanpura recording.
Effort: L

### [Hindustani musician] Tala cycles with sam, taali and khali
Evidence: iTablaPro includes 47 taals and shows the current matra and divisions (https://apps.apple.com/us/app/itablapro-tabla-tanpura-player/id337350026). The Resonare metronome has only accent, normal and silent (`rhythm.ts:1`).
Fix: Add `Tala {name, matras, vibhags:number[], markers:('sam'|'taali'|'khali')[]}` with a circular matra display, bol labels and a distinct sound per marker. Get the data reviewed by a tabla player.
Effort: M

### [Carnatic musician] Suladi talas with jathi and gati
Evidence: Tala Shruti includes the 7 Suladi talas with configurable jathi (https://apps.apple.com/us/app/tala-shruti/id6740571964). Resonare has no Carnatic tala model.
Fix: Model `anga` sequences (laghu with jathi, dhrutam, anudhrutam) with hand-action visuals (clap, finger counts, wave) and gati subdivision. Reviewed by a Carnatic teacher.
Effort: M

### [Indian classical musician] Raga swara targets
Evidence: The tuner targets 12-tone temperaments only (`notes.ts:92`). Swara intonation differs by raga [unverified details].
Fix: Add `Raga {name, swaras:[{name, cents}]}` data with the source cited per value, and make the tuner and pitch trace target those cents relative to Sa. Ship without values that have no source.
Effort: M

### [Indian classical musician] Swara grid on the pitch trace for meend and gamak
Evidence: The pitch trace has no raga-relative lines (`analysis.ts`).
Fix: Draw horizontal lines at Sa-relative swara positions (from the raga or 12-tone), with labels from item 16's sargam names.
Effort: S

### [Hindustani musician] Tempos below 20 BPM for vilambit
Evidence: `MIN_BPM = 20` (`rhythm.ts:29`). Very slow vilambit tempos exist [unverified numbers].
Fix: Lower the minimum to 5 BPM with a sweeping progress arc so long gaps stay readable. Unit test the scheduling at 5 BPM.
Effort: S

### [Indian classical musician] Alankar and palta generator in sargam
Evidence: Exercise patterns are Western scales only (`exercises.ts:3`).
Fix: Add a `patternFromSequence("S R G, R G M")` generator over a thaat and raga scale, played with the tanpura and tala.
Effort: S

### [Arabic or Turkish maqam musician] Microtonal note display (24 or 53 divisions)
Evidence: Note names cover 12 pitch classes only (`notes.ts:1-2`). Turkish makam theory uses 53 Holdrian commas of about 22.64 cents (https://en.wikipedia.org/wiki/Holdrian_comma).
Fix: Add a `grid: 12|24|53` setting. `frequencyToNote` picks the nearest step and renders half-flat and half-sharp names for 24, or comma accidentals for 53. Unit test 1 koma = 22.64 cents.
Effort: M

### [Turkish makam musician] Makam scale presets
Evidence: No makam data exists. Wikipedia makam pages were found (https://en.wikipedia.org/wiki/Turkish_makam) but not read for values.
Fix: Add `Makam {name, steps in commas, seyir note}` for Rast, Uşşak and Hicaz first. Take the values from a cited theory source, used by drones, exercises and tuner targets.
Effort: M

### [Turkish musician] Ahenk (instrument key) transpositions
Evidence: Transpositions are Western only (`notes.ts:17`). Ney and bağlama players use ahenk names [unverified list].
Fix: Add ahenk entries through the octave-aware transposition table after a native musician checks them.
Effort: S

### [Maqam musician] Oud, bağlama and qanun tuning presets
Evidence: No Middle Eastern instruments exist (`instruments.ts`).
Fix: Add presets through the editor, including a microtonal offsets field (from the per-string offsets item). Get the values from players [unverified].
Effort: S

### [Maqam musician] Usul cycles with düm and tek sounds
Evidence: The click sounds have no low and high frame-drum pair (`voices.ts:21-38`).
Fix: Add synthesized düm and tek voices and `Usul {name, beats, strokes[]}` data reviewed by a percussionist, rendered in the groove sequencer.
Effort: M

### [Maqam musician] Microtonal keyboard or wheel
Evidence: The keyboard and wheel have 12 notes per octave (`sound.ts:126`, `sound.ts:77`).
Fix: Render wedges or keys from the active scale (24-EDO or makam) and play `Drone` at arbitrary cents.
Effort: M

### [Gamelan player] Capture an ensemble's own scale
Evidence: Gamelan tunings vary per set, with octaves often slightly larger than 1200 cents (http://recherche.ircam.fr/anasyn/peeters/GAMELAN/tuning.html). `frequencyToNote` assumes 12 steps per 1200 cents (`notes.ts:130`).
Fix: Add `Scale {name, degreesCents[], periodCents}`. A "capture" flow records each key of the reference instrument and averages cents. The tuner, drones and trace use it, with a non-1200 period supported. Unit test a 5-step 1210-cent scale.
Effort: M

### [Balinese gamelan player] Target beat rate for paired instruments
Evidence: No detuned-pair targets exist. Balinese paired instruments are deliberately tuned apart [unverified].
Fix: In the beat-rate trainer, add a "target beats per second" setting, with the tuner offset computed as f·(2^(c/1200) − 1) = target Hz.
Effort: S

### [Microtonal and non-Western musician] Scala .scl import
Evidence: The app cannot import tunings. Scala files are a widely used tuning format [unverified spec URL].
Fix: Add a parser in `src/core/scala.ts` for cents and ratio lines into the `Scale` model, with file input and unit tests on sample files.
Effort: S

### [Chinese instrument player] Jianpu numbered notation and erhu, pipa and guzheng tunings
Evidence: Notation covers English, solfege and German only (`notes.ts:151-156`).
Fix: Add a numbered notation relative to the tonic (1 to 7 with octave dots), plus instrument presets checked by a player [unverified values].
Effort: S

### [Singer-songwriter] Best key for my voice
Evidence: The app has no key suggestion.
Fix: From the voice range and a song's melody range (entered as lowest and highest notes), compute the transposition that fits with a margin, then suggest a guitar capo position. Unit test.
Effort: S

### [Singer-songwriter] Idea capture with key and tempo detection
Evidence: Takes store audio and a name (`recorder.ts:305`) with no tags, key or tempo.
Fix: After recording, estimate the key (pitch-class histogram against key profiles) and tempo (onset autocorrelation). Store `{key, bpm, tags[]}` on the take and filter the list.
Effort: M

### [Singer-songwriter] Stem separation to learn covers
Evidence: Moises separates vocals, drums, bass and guitar (https://moises.ai/features/). Resonare has nothing similar.
Fix: Prototype an open-weights separation model in the browser with ONNX Runtime Web, after checking the license and model size. Lazy-load it, and run it on the device only.
Effort: XL

### [Singer-songwriter] ChordPro lyric sheets with transpose and autoscroll
Evidence: The sheet reader handles PDFs only (`sheetmusic.ts:60`).
Fix: Add a ChordPro parser in `src/core/chordpro.ts`, a renderer with transpose and capo, autoscroll speed from song length or BPM, and pedal page turns.
Effort: M

### [Singer-songwriter] Genre drum loops instead of a click
Evidence: Fender Tune has 60 drum rhythms in 6 genres (https://apps.apple.com/us/app/fender-tune-guitar-tuner-app/id1107017950). Resonare has clicks only.
Fix: Ship groove presets built on the step sequencer (rock, ballad, shuffle, bossa), tempo-linked.
Effort: M

### [Singer-songwriter] Overdub a harmony over a take
Evidence: Each take is independent (`recorder.ts`).
Fix: "Record over": play the take while recording a new one, shift by the measured round-trip latency, and mix both with per-track gain. Export a WAV via `encodeWav` (`pitchshift.ts:73`).
Effort: L

### [Music therapist] Client session notes, local and encrypted
Evidence: The app has no client or session model. The data could be sensitive.
Fix: Add `Client {alias}` and `Session {clientId, date, goals[], interventions[], bpm, minutes, notes}` in IndexedDB, with optional passphrase encryption via AES-GCM (WebCrypto) and encrypted export. Do not claim any regulatory compliance. Validate with 2 board-certified therapists.
Effort: M

### [Music therapist] Gait cadence matching
Evidence: The metronome has tap tempo only (`rhythm.ts:201`). Gait training with a metronome at the step cadence is used in therapy [unverified].
Fix: Measure steps per minute from `DeviceMotionEvent` peaks with the phone in a pocket, set the BPM to cadence ± %, and log the session. Validate the step detection against video counts.
Effort: M

### [Music therapist] Time-based gradual tempo ramp
Evidence: The speed trainer steps per N bars (`settings.ts:56-58`).
Fix: Add `rampBpmPerMinute` and `rampTarget` in the scheduler, with tempo computed continuously from elapsed time. Unit test the event times.
Effort: S

### [Music therapist] Large "no wrong notes" pads
Evidence: The keyboard and wheel are dense (`sound.ts:77`, `sound.ts:126`).
Fix: A pads view with 4 to 8 huge buttons mapped to a pentatonic or chosen chord tones, sustained or plucked, with configurable colours and sizes.
Effort: S

### [Band director] Chord balance keyboard with per-voice volume and pure toggle
Evidence: Yamaha's Harmony Director plays chords in just intonation and lets each note's volume and pitch change to demonstrate balance (https://usa.yamaha.com/products/musical_instruments/winds/harmony_directors/index.html). Resonare drones share one volume (`settings.ts:72`).
Fix: Add `droneVoices: Record<midi, {gain, centsOffset}>`, a projector-friendly chord panel with a gain slider per note and a one-tap "Equal or Pure" switch (using the adaptive just engine), and a bass-heavy "pyramid" balance preset.
Effort: M

### [Band director] Section tuning roster
Evidence: The app has no roster or per-player results.
Fix: Add `Roster {chairs:[{label, instrument, transposition, tuningNote}]}` and a sequence that tunes one chair at a time. Store the reading per chair per date and chart each chair's trend across rehearsals.
Effort: M

### [Band director] Phone remote for the projected laptop
Evidence: The app has no remote control. There is no server by design.
Fix: Pair two devices peer to peer with WebRTC, exchanging offer and answer through QR codes (no signaling server), and send start, stop, tempo, drone and chord commands.
Effort: L

### [Band director] All transpositions on screen at once
Evidence: The tuner shows one transposition (`settings.ts:30`).
Fix: A projector card shows the detected or droned note as "Concert Bb · Bb inst: C · Eb inst: G · F inst: F" in large type.
Effort: S

### [Band director] Instrument-specific tuning notes
Evidence: The app has no ensemble tuning-note table [unverified conventions].
Fix: Add a table in the roster data giving each instrument's tuning note and octave for a concert Bb or A tune. The drone automatically plays in that instrument's octave.
Effort: S

### [Marching band director] Live tempo detection to catch rushing
Evidence: The app has no BPM estimation from audio.
Fix: Autocorrelate the onset envelope over 6 s windows and show the detected BPM against the target with a drift arrow. Validate on recorded band audio.
Effort: M

### [Band director] Per-student profiles on shared devices
Evidence: Settings live under one localStorage key (`settings.ts:90`).
Fix: Add `resonare.profiles` holding a list plus the active id. Settings keys and IndexedDB stores get the profile id as a prefix, with a profile switcher protected by the parent lock.
Effort: M

### [Band director] Collect student report files into a class table
Evidence: TE for Education gives teachers administrator control over student licenses and data (https://www.tonalenergy.com/te-education). Item 34 covers sending assignments, not collecting results.
Fix: A "Class results" screen that accepts dragging in many report JSON files, with a sortable table (student, item, date, in-tune %, tempo), CSV export, and nothing uploaded.
Effort: M

### [Band director] Rehearsal sound exposure estimate
Evidence: The app has no dB SPL meter. Phone microphones are not calibrated.
Fix: A dBA-weighted level meter with a user calibration offset against a real meter, and exposure dose using the NIOSH 85 dBA and 3 dB exchange rule [unverified, confirm at cdc.gov]. Label it an estimate.
Effort: M

### [Private teacher] Student roster with lesson notes
Evidence: The app has no student model.
Fix: Add `Student {alias, instrument, notes[], assignments[]}` in IndexedDB. Each lesson note can attach takes and presets. Import results from student report files.
Effort: M

### [Private teacher] Lesson summary page for the student
Evidence: Item 34 encodes single items in links, with no bundled lesson summary.
Fix: A "Lesson summary" builder that produces one link or HTML file listing assignments with tempos, exercises and presets, each importable.
Effort: M

### [Private teacher] Online-lesson audio guidance
Evidence: The app disables its own mic processing (`context.ts:44`), but video call apps process audio and can garble drones [unverified per app].
Fix: A help page explaining original-sound settings and recommending headphones, plus a "test my call audio" drone sweep.
Effort: S

### [Private teacher] Printable practice sheets
Evidence: History exists only in app (`practice.ts`).
Fix: A print stylesheet for a weekly chart with assignments and blank tick boxes, for families without devices.
Effort: S

### [Adult hobbyist] Gentle ramp for returning players
Evidence: The daily goal is a fixed number of minutes (`settings.ts:81`). Overuse strain in returning adults [unverified].
Fix: "Return plan": goal minutes grow by a set percentage each week, with rest-break reminders every N minutes of continuous use and a soreness check-in field.
Effort: S

### [Adult hobbyist] Monthly benchmark recording timeline
Evidence: Takes are a flat list (`recorder.ts`).
Fix: Mark a take as a "benchmark" of a piece and prompt monthly. A timeline plays benchmarks in order with intonation stats side by side.
Effort: S

### [Adult hobbyist] Note-reading flashcards answered by playing
Evidence: The staff view shows detected notes (`src/core/staff.ts`), but there is no quiz.
Fix: A flashcards mode showing a random note in the chosen clef and range (from the profile). The mic answer is checked by pitch class and octave, with reaction time tracked per note.
Effort: M

### [Deaf or hard-of-hearing musician] Haptic tuner feedback
Evidence: Vibration is used only for UI feedback (`src/ui/components.ts:9`).
Fix: On Android, pulse at a rate proportional to |cents|, with a long pulse when in tune. Measure usefulness with deaf players first.
Effort: S

### [Hard-of-hearing musician] Choose click and drone pitch for residual hearing
Evidence: Click sounds have fixed spectra (`voices.ts:108`).
Fix: Add a "click pitch" setting from 150 to 2000 Hz for the beep and blip voices, plus a low-frequency emphasis option. Include a hearing-range check tone sweep.
Effort: S

### [Deaf or hard-of-hearing musician] Visual equivalent for every audio-only cue
Evidence: The count-in has a live label (`metronome.ts:278`), but speed-trainer tempo steps, gap-trainer silences and the recording start cue have no guaranteed visual.
Fix: Audit every `play*` call site and emit a matching visual event (a banner or border flash) through one `cue(event)` helper, with an e2e check that each cue renders.
Effort: S

### [Blind musician] Sonified tuner
Evidence: Tuner readings go to a text live region (`settings.ts:86-87`). Speech is slow for continuous adjustment.
Fix: An "audio needle": short ticks in stereo whose pitch rises with sharpness and whose rate grows with error, silent when in tune. Headphones are recommended so the mic does not hear it. Validate with 2 blind players.
Effort: M

### [Blind musician] Accessible scores instead of PDFs
Evidence: PDFs are rendered as images (`sheetmusic.ts`).
Fix: With MusicXML import, give a text description per bar (notes, rhythms, dynamics) navigable by screen reader, and link out to a braille music converter [unverified tool availability].
Effort: L

### [Blind musician] Status hotkey for spoken readouts
Evidence: Shortcuts exist for screens and actions (README), but none speak state.
Fix: A key (S) and MIDI action that announce "Metronome 96, 7 8, playing; drone D3; A 442" through the live region.
Effort: S

### [Musician with ADHD] Focus mode
Evidence: The dock and screen switching are always visible (README "mini metronome docked on every screen").
Fix: A focus toggle hides navigation except the current task and a timer. Leaving needs a long press.
Effort: S

### [Musician with ADHD] Micro-challenges
Evidence: Feedback is continuous meters (`tuner.ts`) with no short goals.
Fix: A daily challenge generator ("hold 3 notes in tune for 5 s each," "gap trainer 4 bars clean") with instant win states, stored as `challengeLog`.
Effort: M

### [Musician with performance anxiety] Performance simulation
Evidence: The recorder has no pressure conditions.
Fix: A "mock performance" mode: room ambience and applause samples (CC0 only, credited), a walk-on countdown, a one-take-only recording, and a log of self-rated nerves before and after.
Effort: M

### [Musician with performance anxiety] Breathing pacer with drone
Evidence: No breathing tool exists.
Fix: An expanding circle at a set breaths per minute, with an optional soft drone swell matched to the inhale. Present it as a relaxation aid only, with no medical claims.
Effort: S

### [Musician with performance anxiety] Gentle feedback mode
Evidence: The tuner shows red and sharp/flat numbers constantly (`tuner.ts`).
Fix: A setting that hides numbers, uses neutral colours and summarizes only after the note ends ("steady, slightly high").
Effort: S

### [Older musician with low vision] In-app text size
Evidence: Key readouts use fixed clamps (`src/styles.css:1439`, `1445`, `1526`). There is no text size setting.
Fix: Add `settings.textScale` (100 to 200%) applied to the root font size, then test every screen at 200% for clipping.
Effort: S

### [Low-vision musician] High-contrast and forced-colors support
Evidence: No `forced-colors` or high-contrast styles exist (grep of `src/`).
Fix: Add `@media (forced-colors: active)` rules for the ring, beats and ink, plus a high-contrast theme with 7:1 text contrast. Test with Windows contrast themes.
Effort: S

### [Musician with tremor] Larger targets and no-drag alternatives
Evidence: The tempo dial and the wheel glide rely on drag gestures (`metronome.ts:259`, `sound.ts:77`). WCAG 2.2 SC 2.5.8 sets a 24 by 24 CSS pixel minimum target (https://wcag22aa.org/new-criteria/target-size/).
Fix: Audit all targets. Add a "large controls" setting (44 px minimum) and make sure every drag has a button alternative. Ignore double taps within 300 ms on toggles.
Effort: M

### [Musician with tremor] Guard against accidental stop
Evidence: The whole tuner stage is one start/stop button (`tuner.ts:187`).
Fix: An optional "hold to stop" (600 ms) on large stage buttons such as the tuner, metronome play and record, with a progress ring.
Effort: S

### [Market: schools] Privacy statement for district approval
Evidence: The README says there is no account, tracking or data leaving the device. There is no formal privacy document. Districts review student data privacy before approving tools [unverified].
Fix: Add `docs/privacy.md` stating the data flows (none), storage locations, microphone use and third-party code (pdf.js, fonts), to support district reviews. Keep claims to what the code does.
Effort: S

### [Market: teachers] Ready-made lesson packs
Evidence: The app ships no content.
Fix: Ship 10 importable packs (beginner strings, band warm-up, jazz swing) built from presets, exercises and click tracks, each reviewed by a teacher of that instrument.
Effort: M

### [Market: all] Persona-specific first run
Evidence: The first-run intro is a 3-point sheet (item 42) and knows nothing about the instrument.
Fix: The first run asks for instrument and level, then sets the profile (item 11), notation, transposition, strings or chromatic mode, and home screen. It is shown once and editable later.
Effort: S

### [Beginner child violinist] Open-string "listen and match" game
Evidence: "Tap a string to hear its reference" exists (README), with no matching game.
Fix: Play a random open string, the child plays it back, and the app shows a star when pitch class and octave match. Each round is 5 notes with animations.
Effort: S

### [Middle school percussionist] Mallet keyboard note-reading drills
Evidence: The sound keyboard plays drones (`sound.ts:126`). It has no mallet layout or quiz.
Fix: A marimba or xylophone layout quiz: show the note on the staff, the student plays it, and the mic checks the pitch class. Use the octave-transposition table for xylophone and glockenspiel.
Effort: S

### [High school orchestra] Bowing rhythm patterns on one note
Evidence: Only uniform subdivisions exist (`metronome.ts:21-26`).
Fix: Reuse the pattern field from the Suzuki item with presets for common bowing rhythms, displayed as notation with down-bow and up-bow marks.
Effort: S

### [College music major] Excerpt tempo marks attached to PDF pages
Evidence: Scores and metronome presets are separate (`sheetmusic.ts`, `settings.ts:68`).
Fix: Add `ScorePageLink {scoreId, page, presetId}` so opening that page loads the tempo, with a tap-to-start on the page corner.
Effort: S

### [Professional orchestral player] Tuning after instrument temperature changes
Evidence: The app keeps no tuning drift history within a session.
Fix: A "rehearsal log" that samples the tuning note on request and charts A drift over 3 hours with timestamps, reusing timed events (item 17).
Effort: S

### [Church choir singer] Hymn tempo by verses and time available
Evidence: Click tracks need bars and tempo (`rhythm.ts:69`).
Fix: A calculator: bars per verse, number of verses and target duration give the BPM, with a one-tap preset.
Effort: S

### [Barbershop quartet] Tag loop with chord hold
Evidence: Click-track sections cannot include holds (see the fermata item) or drones (item 3).
Fix: A "tag" preset type: a key, a sequence of chords with holds sounded in adaptive just intonation, and a loop.
Effort: M

### [Jazz musician] Tune list with key and tempo per standard
Evidence: No song library exists (`settings.ts`).
Fix: Add `Tune {title, key, bpm, style, feel, chartId?}` with a quick-start into metronome, swing or play-along. Shared with setlists.
Effort: S

### [Guitarist] Tuning order and reference-string mode
Evidence: Strings mode tunes each string to absolute pitch. Players tuning to a band or piano often tune one string, then relative [unverified practice].
Fix: A "relative" mode: the first string is measured as a reference, and the other targets are offset by its cents error. Unit test.
Effort: S

### [Bassist] Groove lock to the kick drum
Evidence: No groove content exists.
Fix: A bass practice preset combining the step sequencer's kick and hi-hat with an onset report measuring the note-onset offset from the kick in ms.
Effort: M

### [Drummer] Tempo map import from song files
Evidence: Click tracks are hand-built (`clicktrack.ts`).
Fix: Import a MIDI file's tempo and time-signature meta events into a `ClickTrack` with sections. Unit test on a sample file.
Effort: M

### [Pianist] Digital piano audio input via USB MIDI into the recorder
Evidence: The recorder captures only the mic (`recorder.ts`).
Fix: Record MIDI notes alongside audio and render them to the drone piano voice for clean playback when the room recording is noisy.
Effort: M

### [Organist] Hymn introduction countdown with registration change cues
Evidence: Click tracks have no text cues.
Fix: Add `cue?: string` per click-track section, shown large at the section start (for example "add reeds").
Effort: S

### [Harpist] Lever harp key helper
Evidence: No harp support exists.
Fix: For a lever harp, show which levers to flip for a key given the base tuning (Eb or C) [unverified conventions, confirm with a harpist].
Effort: S

### [Early music player] Gut string settling monitor
Evidence: The tuner has no drift-per-string memory.
Fix: In strings mode, remember each string's last in-tune time and show "E drifted 12 cents in 6 min," with a re-check prompt after a set number of minutes.
Effort: S

### [Indian classical musician] Tanpura tuning helper
Evidence: A tuner exists, but it has no Sa-relative tanpura mode.
Fix: Strings mode for tanpura strings (Pa, Sa, Sa, low Sa), targets relative to the chosen Sa in Hz with fine cents, and a harmonic view focused on the jawari overtones.
Effort: S

### [Carnatic musician] Sruti set as kattai
Evidence: The tonic is set by pitch class (`settings.ts:29`). Carnatic singers often speak of sruti in kattai numbers [unverified mapping].
Fix: Add a kattai-to-note mapping picker once verified with a teacher, plus fine cents.
Effort: S

### [Arabic maqam musician] Qarar drone with the dominant and microtonal third
Evidence: Drone chords are 12-tone (`sound.ts:13-18`).
Fix: Drone chord options from the active maqam scale (tonic, fifth, maqam third at scale cents).
Effort: S

### [Gamelan player] Colotomic cycle display
Evidence: Meters have no structural stroke markers (`rhythm.ts:1`).
Fix: Add `Cycle {beats, strokes:[{beat, instrument:'gong'|'kenong'|'kempul'|'kethuk'}]}` with synthesized gong-like voices and a circular display. Data reviewed by a gamelan teacher [unverified forms].
Effort: M

### [Singer-songwriter] Live performance mode with lyrics, click and pedal
Evidence: The sheet reader has pedals, but no ChordPro or song-linked click.
Fix: Combine ChordPro, setlist and preset into a gig view: next song by pedal, a click in one ear through a stereo pan option, lyrics autoscrolling.
Effort: M

### [Music therapist] Session timer with non-musical goal tallies
Evidence: The practice log counts minutes per activity only (`settings.ts:80`).
Fix: Custom counters per session (for example "initiated turn-taking"), stored in `Session.tallies`, with CSV export.
Effort: S

### [Band director] Warm-up chorales from public-domain sources
Evidence: The app has no chord progressions for full-band warm-up.
Fix: With MusicXML import, bundle a few public-domain chorales (verify each edition's license, not only the composer's dates), played with per-part volume and adaptive just intonation.
Effort: M

### [Private teacher] Duet play-along recordings for students
Evidence: Takes play one at a time (`recorder.ts`).
Fix: A teacher records the accompaniment part as a take and the student plays along with speed change and A-B loop (item 27), with synced click optional.
Effort: S

### [Adult hobbyist] Headphone practice with electric instruments
Evidence: Input monitoring is item 30, with no amp-style monitoring.
Fix: Low-latency monitor path with simple EQ and reverb (`ConvolverNode` with a generated impulse), showing the measured round-trip latency so the user knows whether it is playable.
Effort: M

### [Deaf or hard-of-hearing musician] Visual ensemble cue from another device
Evidence: The beat flash is local only (`settings.ts:66`).
Fix: Using WebRTC pairing, mirror the beat flash to a second screen facing the player, with latency compensation from the measured RTT.
Effort: L

### [Blind musician] Tempo and meter direct entry by keyboard
Evidence: The dial supports arrows (README), but there is no known numeric entry path.
Fix: Typing digits while the dial has focus sets the BPM on Enter, and a meter field accepts "7/8." Test with NVDA and VoiceOver.
Effort: S

### [Musician with ADHD] Visible time remaining per task
Evidence: The daily goal is a ring (`practice.ts:27`) with no per-task countdown. Routines (item 55) have no timers defined.
Fix: Add `durationMin` to each routine step, with a large shrinking bar and a chime at 1 minute remaining and at the end.
Effort: S

### [Older musician with low vision] Large-print tuner and metronome view on phones
Evidence: Item 73 targets projectors, not phones at arm's length.
Fix: A phone layout at text scale 200% that shows only the note letter, an arrow and the beat number, filling the width.
Effort: S

### [Older musician] Simplified mode with fewer controls
Evidence: Settings are hidden in multiple gear sheets (item 49).
Fix: Share the child "simple" profile: 3 big buttons per screen, the rest hidden, and a toggle behind a long press.
Effort: S

### [Market: international students] Offline-first install guidance for low-bandwidth regions
Evidence: A PWA works offline after the first visit (README). The first-load size has not been measured for all precached assets.
Fix: Measure and publish the total precache size, add a "download everything for offline" button with progress, and test on a 3G throttle.
Effort: S

### [Market: competitive] Head-to-head comparison page
Evidence: The README lists features but has no comparison. Resonare's free, local-only model is its main distinguishing claim.
Fix: Write `docs/compare.md` against TE, Soundcorset and Tunable with each claim sourced and dated, including where Resonare is worse.
Effort: S

### [Market: contributors] Content contribution format for non-coders
Evidence: All data (instruments, patterns, temperaments) is TypeScript in `src/core/`.
Fix: Move instrument, tuning, tala, makam and syllabus data into `public/data/*.json` with a JSON schema and a validation test, so teachers can contribute by pull request without writing TypeScript.
Effort: M

---

Total: 178 items. Things to know:

- **Not reached:** I did not open Reddit, Google Play reviews, or any teacher forums, so the persona pain points come from product listings and pedagogy summaries, not user complaints.
- **Needs experts before shipping:** Every item marked [unverified] (Suzuki rhythms, brass slide advice, tala and makam data, harp and early-music tunings, the NIOSH limits) must be checked with a primary source or a practitioner before it ships.
