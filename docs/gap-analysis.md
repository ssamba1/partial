# Resonare vs TE Tuner: gaps and how to close each one

Written 2026-09-13 against commit `b040ec6`.

## How to read this

Every item says where the claim comes from:

- **[TE guide]** TonalEnergy's user guide for Android and desktop
  (https://www.tonalenergy.com/tet-user-guide-android), read through a web page
  summarizer, not line by line. Treat details as close, not exact.
- **[TE reviews]** complaints and praise from the TE App Store page
  (https://apps.apple.com/us/app/tonalenergy-tuner-metronome/id497716362),
  also read through a summarizer.
- **[research]** a background research pass over other apps' sites, manuals and
  reviews. It could not reach Reddit or Google Play; items it marked as coming
  only from search summaries are still unverified.
- **[our code]** something I checked in this repository.
- **[verified]** looked up in a primary source this session (link given).
- **[unverified]** my belief, not checked. Check before relying on it.

Effort: **S** is under a day, **M** a few days, **L** a week or more,
**XL** needs outside resources or a new platform.

---

## Part 1. Things TE has that Resonare does not

### Metronome

1. **Spoken count-in and voice counting** (male or female voice) [TE guide].
   Ours: count-in is clicks only [our code].
   Solution: use the Common Voice Single Word Target Segment, which has spoken
   digits 0 to 9 under CC0-1.0 [verified: https://datacollective.mozillafoundation.org/datasets/cmkzhp64p00wlno07elrmt20y].
   1. Pick 2 clean speakers (one higher, one lower voice) for digits 1 to 9.
      "Ten" to "twelve" are not in that set, so either record them ourselves
      (CC0 dedication from the speaker) or count 12/8 as "1-and-a 2-and-a".
   2. Trim each clip to its onset with a simple energy threshold (first sample
      above 10% of peak), normalize to the click loudness table, encode as
      48 kHz mono Opus, about 3 KB each.
   3. Store in `public/voice/<voice>/<n>.opus`; add them to `precache.json` only
      when voice counting is enabled, so offline users who never use it do not
      download them.
   4. In `src/audio/voices.ts` add `playVoice(ctx, dest, when, n, voice)` that
      starts an `AudioBufferSourceNode` at `when - onsetOffset` so the vowel
      lands on the beat (speech has a lead-in; the offset is measured per clip in
      step 2).
   5. Metronome options: "Count-in voice" and "Count every bar" toggles.
   6. Test: e2e renders the metronome offline with `OfflineAudioContext` and
      checks each voice onset is within 10 ms of its beat.
   Effort: M.

2. **Ableton Link tempo sync** [TE guide]. Browsers cannot open the UDP
   multicast sockets Link uses [unverified, but no web API for raw UDP exists].
   Link is dual licensed GPLv2+ or proprietary [verified: https://github.com/Ableton/link].
   Solution: only possible in a native shell.
   1. Wrap the app with Tauri (desktop) or Capacitor (mobile).
   2. Add a native plugin that links the Link C++ library and exposes
      `{tempo, beat, phase, peers}` to the web layer.
   3. Licensing: Resonare is MIT. Linking GPL code into the distributed native
      binary makes that binary GPL. Either ship the native wrapper under GPL
      (the web app can stay MIT) or ask Ableton for the proprietary license.
      This is a decision for you, not a coding task.
   4. In the metronome engine, when Link is on, derive the next beat time from
      Link's phase instead of the local clock.
   Effort: XL.

3. **Preset groups and preset sequences**: ordered presets that play one after
   another, with loop and range selection [TE guide]. Ours: presets and click
   tracks are separate; click tracks cover sequences but cannot hold drones,
   polyrhythm, silence patterns or sound choice per section [our code].
   Solution: make a click-track section a full metronome preset.
   1. Extend `ClickSection` with optional `drones`, `poly`, `playBars`,
      `muteBars`, `sound`.
   2. `expandClickTrack` already yields section indices; in the click track
      player, on the first event of a section apply that section's drones via
      `droneBank` and sound per event.
   3. "Save current metronome as section" button on the Metronome screen.
   4. Unit test the expansion; e2e plays a 2-section track and checks the drone
      changes at the boundary.
   Effort: M.

4. **Tempo adjustment across a whole group by percentage** [TE guide].
   Solution: "Scale tempo" sheet on a click track with a slider from 50% to
   150% that multiplies `bpm` and `endBpm` of every section (rounded), plus
   "make permanent" versus "this run only". Effort: S.

5. **Time limits in the Metronome Assistant** (stop after a time) [TE guide].
   Ours: stop after N bars only [our code].
   Solution: `stopAfterSeconds` in metronome settings; in `next()` return null
   when `ev.time` would exceed it. Effort: S.

6. **More beat visuals**: TE lists smile in a box, wiper, pendulum, shoe tap,
   hand clap, timer and bar views [TE guide]. Ours: blocks, pendulum, pulse.
   Solution: add a bar-progress wiper (a line sweeping across the bar, positioned
   from `(ctx.currentTime - barStart) / barDuration` each frame) and a practice
   timer view. Skip copying TE's faces; design our own. Effort: S each.

7. **Randomized or rotating click sounds** per beat or bar [TE guide].
   Solution: `soundMode: fixed | perBar | perBeat` choosing from a user-picked
   subset of `CLICK_SOUNDS`. Effort: S.

8. **"Preserve eighth note duration"** when changing between x/4 and x/8
   [TE guide]. Solution: in click-track sections and the metronome, when the
   beat unit changes from 4 to 8, optionally double the displayed BPM so the
   eighth stays the same length. Effort: S.

9. **Two polyrhythm layers with separate sounds and A/B solo** (meter against
   meter and subdivision against subdivision) [TE guide]. Ours: one extra layer
   [our code].
   Solution: replace `poly: number` with `layers: {pulses, sound, volume, muted}[]`,
   schedule each layer in the same place as today, and add solo buttons in the
   options sheet. Effort: M.

10. **BodyBeat Pulse wearable support** [TE guide]. Needs the Peterson device's
    Bluetooth protocol [unverified whether it is public]. Web Bluetooth exists in
    Chromium but not Safari [unverified]. Solution: only pursue if the protocol
    is documented; otherwise skip. Effort: XL or not possible.

### Tuner

11. **Instrument modes (winds, strings, voice) and range presets from wide to
    ultra-fine** [TE guide]. Ours: separate steadiness and in-tune range settings
    with no instrument profile [our code].
    Solution: an "Instrument" picker in tuner options that sets damping,
    tolerance, minimum frequency and transposition together (for example
    Trumpet: B-flat, balanced, normal range, 150 Hz floor; Tuba: slow, 25 Hz
    floor; Voice: steady with vibrato averaging, see item 44). Store the
    instrument in settings so the tuning chip can show it. Effort: S.

12. **Auto-select transposition by instrument name** (alto sax selects E-flat)
    [TE guide]. Solution: part of item 11. Effort: S.

13. **Range down to C0 (16.35 Hz)** [TE reviews state C0 to C8]. Ours: minimum
    30 Hz, so the lowest notes of a contrabassoon, tuba pedal tones or an organ's
    32' stop are missed [our code: `detectPitch` default `minFrequency` 30].
    Solution: a "Very low" mode.
    1. Use `fftSize` 8192 so the frame holds two periods of 16 Hz at 48 kHz
       (maxTau 3000, frame at least 6000).
    2. Set `minFrequency` 15 only in that mode, because the larger frame costs
       more and reacts slower.
    3. Extend the pitch unit test sweep down to MIDI 12 (C0) with the larger
       frame and record the measured worst-case cents error before claiming it.
    Effort: S to M.

14. **Auto reference notes**: the tone generator follows your notes and plays
    chosen intervals above them [TE guide]. Ours: "drone follows you" plays the
    same note only [our code].
    Solution: add an interval picker (unison, third, fifth, octave, up to three)
    and call `noteOn(midi + interval)` for each. Effort: S.

15. **Custom temperaments with a delete list** [TE guide]. Ours: 7 fixed
    temperaments [our code].
    Solution: a temperament editor of 12 cent offsets per pitch class, saved in
    settings; `temperamentOffset` looks up custom tables by id; validation that
    offsets stay within plus or minus 50 cents. Effort: S.

16. **Northern European and Indian (sargam, shruti) notation** [TE guide].
    Ours: English, solfege, German [our code].
    Solution: add naming tables. Sargam is relative to Sa (the tonic setting), so
    `noteName` needs the tonic for that system. Have a native speaker check the
    sargam spellings and komal/tivra markings before shipping [unverified
    spellings otherwise]. Effort: S.

17. **Tuning history views**: the pitch tracker menu with timed events, practice
    timer, current session and all activity, plus a sortable vertical pitch list
    [TE guide]. Ours: session in-tune chip and per-note tendencies, no timed
    events or sorting [our code].
    Solution:
    1. "Start timed event" button on Analysis; while active, collect
       `(t, midi, cents)` readings; on finish run `analyzeTake` on them (the same
       report used for recordings) and save it with a name and date.
    2. Tendencies panel: sort by note, by average deviation, by spread; group by
       octave by keying stats on `midi` instead of pitch class (keep both).
    Effort: M.

### Sound

18. **Chromatic wheel with a tuner in its center** [TE guide]. Ours: octave
    controls in the center [our code].
    Solution: when the mic is on, show the note name and cents in the wheel
    center using a shared `createTracker()`; add a mic toggle button there.
    Effort: S.

19. **Keyboard: key size pinch, scroll lock, transposed key colouring**
    [TE guide]. Ours: fixed key width, free scroll, no transposition marks
    [our code].
    Solution: a key-width slider bound to the `--key-w` CSS variable, a lock
    button that sets `overflow-x: hidden`, and a class on the written-C key when
    a transposition is set. Effort: S.

20. **Chord hold of up to 14 pitches and a pitch grid view laid out by
    instrument range** [TE guide]. Ours: sustain toggle and preset chord shapes
    [our code].
    Solution: "Add to chord" mode where taps accumulate notes; a grid view
    rendering the chromatic notes between an instrument's lowest and highest note
    (from item 11's profile) as buttons. Effort: M.

21. **Auto Exercise Creator depth**: intervals and harmonic series patterns,
    transposing every repeat, Galamian turns, remain-in-key, drones per
    exercise, and saved exercise collections with export [TE guide].
    Ours: scales, arpeggios and thirds with root drone and loop [our code].
    Solution:
    1. Add patterns to `src/core/exercises.ts`: interval ladders (seconds to
       octaves), harmonic series from a fundamental, Galamian turn (a defined
       ornament figure around each note; get the exact figure from a violin
       pedagogy source before coding it).
    2. `transposeEachRepeat: {semitones, direction, limit}` applied when the
       loop restarts.
    3. Save exercises to settings with a name; export uses item 29.
    4. Unit test each new pattern's note sequence.
    Effort: M.

22. **MIDI keyboard input to play the tone generator** [TE guide]. Ours: MIDI
    only triggers actions [our code].
    Solution: in `controls.ts`, when a note-on arrives and no action is mapped to
    it, call `noteOn(n)`; note-off calls `noteOff(n)`; a setting chooses "play
    notes" versus "actions only". Effort: S.

### Analysis and recording

23. **Waveform timespan from 20 ms to 60 s, amplitude slider, and pitch
    coloured on the waveform** [TE guide]. Ours: a fixed short window [our code].
    Solution: keep a rolling buffer of per-frame min/max (and pitch) for up to
    60 s; draw min/max columns for long spans and raw samples for short ones;
    colour each column by that frame's cents. Effort: M.

24. **Spectrum freeze-and-compare overlay and full-screen chart** [TE guide].
    Solution: "Compare" button stores the current spectrum and draws it in a
    second colour behind the live one; a full-screen button uses the Fullscreen
    API where available (see item 60). Effort: S.

25. **Harmonic view labelling each partial with its note name and cents**
    [TE guide]. Solution: for partial k, compute `frequencyToNote(f0 * k)` and
    print name and cents under each bar. Effort: S.

26. **Staff view clef choice and wave-in-note display** [TE guide]. Ours: auto
    treble or bass [our code]. Solution: clef selector (auto, treble, bass,
    alto, tenor, grand staff); add alto and tenor bottom-line constants in
    `staff.ts` with unit tests. Effort: S.

27. **Analysing a recording live**: switch the analysis source from the mic to a
    file, and set loop points on a file's waveform [TE guide]. Ours: a one-shot
    report per take, no loop points [our code].
    Solution:
    1. A-B loop: two draggable markers on the take's progress bar; on
       `timeupdate`, if `currentTime >= b` set `currentTime = a`.
    2. "Analyse while playing": route the take's `<audio>` through
       `createMediaElementSource` into an `AnalyserNode` feeding the same
       Analysis screen. Note that a media element source can be created only
       once per element [unverified wording; check MDN before coding].
    Effort: M.

28. **Recording the app's own sounds** (speaker icon on sound pages)
    [TE guide]. Solution: a `MediaStreamAudioDestinationNode` connected from the
    master gain; record its stream with `MediaRecorder`; label takes "Resonare
    output". Effort: S.

29. **Export and share of presets, exercises and recordings** [TE guide].
    Ours: JSON backup and CSV export; takes download individually; nothing uses
    the system share sheet [our code].
    Solution: `navigator.share({ files })` when `navigator.canShare` accepts the
    file, falling back to download. For presets and click tracks, export a small
    `.resonare.json` and accept it through the file input and a drop zone.
    Effort: S.

30. **Sound level mixer with per-source volume, pan and input monitoring**
    [TE guide]. Ours: separate volume sliders, no pan or monitoring [our code].
    Solution: create buses in `context.ts`: metronome, drones, playback, monitor;
    each is `GainNode -> StereoPannerNode -> master`. A mixer sheet exposes gain
    and pan. Input monitor connects the mic source to the monitor bus, with a
    warning to use headphones (feedback risk). Effort: M.

### Practice, platform and everything else

31. **Streaks page options**: monthly calendar swipe, custom date ranges, "show
    on launch" setting [TE guide]. Ours: fixed 12 weeks [our code].
    Solution: month navigation with previous/next, a range picker that sums
    totals per activity, and a setting to open Practice on first launch each day.
    Effort: S.

32. **Multiple languages** [TE guide lists a language preference]. Ours:
    English only [our code].
    Solution: move every UI string into `src/i18n/en.ts` keyed messages, add a
    `t(key, params)` helper, and load other catalogs on demand. Get each
    translation reviewed by a musician who speaks the language. Effort: L.

33. **Visible touches** for teaching videos [TE guide]. Solution: a setting that
    draws a fading circle at each `pointerdown` in a fixed overlay. Effort: S.

34. **Education and teacher features** (TE for Education) [TE desktop page].
    Resonare has no accounts by design.
    Solution without a backend: shareable assignment links that encode a click
    track, exercise or preset in the URL fragment (base64 JSON, never sent to a
    server since fragments are not). Students open the link and the item is
    imported. Results come back as an exported report file the student sends.
    Effort: M.

35. **Native apps in the App Store and Google Play, and Apple Watch**
    [TE reviews, TE guide]. Ours: installable web app only.
    Solution: Capacitor for iOS and Android using the existing build as the web
    layer; a WatchKit extension for a watch remote (start/stop, tempo) talking to
    the phone app. Needs an Apple developer account and a Mac [unverified cost;
    check Apple's current program fee]. Effort: XL.

36. **Audio that keeps running with the screen locked** (native apps can).
    Ours: web audio on phones may stop when the screen locks [unverified for
    current iOS and Android; test on devices].
    Solution: short term, request a screen wake lock (item 38) so the screen does
    not lock during practice; long term, the native shell from item 35 with a
    background audio session. Effort: S short term, XL long term.

---

## Part 2. Where we have the feature but TE is likely better

37. **Real-world pitch accuracy.** TE has years of use on real instruments
    (4.8 stars from about 58K ratings per the App Store summary) [TE reviews].
    Ours is measured only on synthesized tones [our code].
    Solution: an accuracy benchmark.
    1. Dataset: NSynth has about 306K single notes from 1,006 instruments with
       MIDI pitch labels, under CC BY 4.0 [verified: https://magenta.tensorflow.org/datasets/nsynth].
       Its audio is 16 kHz, so also test a 48 kHz set: record 10 real
       instruments yourself playing chromatic scales against a verified
       reference, or use another labelled set after checking its license.
    2. Script `scripts/benchmark.mjs`: decode each note, run `detectPitch` over
       the steady middle second, record median cents error against the label and
       whether it is off by an octave.
    3. Report per instrument family: median error, 95th percentile error,
       octave error rate, no-detection rate. Commit the table.
    4. Only then claim accuracy numbers in the README.
    Effort: M.

38. **Keeping the screen awake while practising.** Native apps typically keep it
    on [unverified for TE specifically]. Ours does not [our code].
    Solution: `navigator.wakeLock.request('screen')` while the tuner, metronome,
    click track or recorder is running; re-request on `visibilitychange`;
    release on stop. Effort: S.

39. **Visual beat and audio click alignment.** Ours fires visuals at the
    scheduled time, ignoring output latency, so the flash can lead the sound,
    badly on Bluetooth [our code].
    Solution: add `ctx.outputLatency` (fall back to `baseLatency`) to the visual
    delay in `LookaheadScheduler`, plus a manual offset from a calibration test
    (item 50). Effort: S.

40. **Sound quality of drones, keyboard and clicks.** Both apps synthesize;
    reviewers call TE's tones "cheesy" [TE reviews], and ours are synthesized
    approximations [our code]. TE at least has had years of tuning.
    Solution: sampled instruments.
    1. Clicks: CC0 percussion samples (for example from Freesound, filtering to
       CC0 only and saving each sample's page URL in `public/samples/CREDITS`).
    2. Keyboard: a sampled piano. Check the license of any candidate (for
       example the Salamander Grand Piano) before using it [unverified license].
    3. Drones: record long tones from real players (cello, clarinet, voice) and
       loop a steady section with crossfade.
    4. Keep samples lazy-loaded to protect the main bundle (127 KB raw, about
       46 KB gzipped, measured on 2026-09-13).
    Effort: L.

41. **Maturity of interaction polish.** TE has had many releases of refinement;
    ours was designed in two days and only reviewed by me [our code].
    Solution: 5 moderated usability sessions with real students (tuning a
    string, setting a 7/8 metronome with accents, recording and checking a take,
    importing and annotating a PDF). Log every hesitation and wrong tap, then fix
    the top issues. No analytics needed. Effort: M.

42. **Onboarding and help content.** TE has a full user guide and tutorial
    videos [TE guide, YouTube search result]. Ours: a 3-point welcome sheet and a
    shortcuts sheet [our code].
    Solution: a Help screen with one short page per feature, each with a
    screenshot and a "try it" button that opens the right screen with the
    control highlighted. Effort: M.

43. **Emotional feedback.** Reviewers specifically love TE's green smiley
    [research]. Ours: a filling ring and a short pulse [our code].
    Solution: an optional friendly face in the ring center, with our own
    original artwork (not TE's face), reacting to in-tune, sharp and flat, and
    an in-tune streak counter ("held 12 seconds"). Effort: S to M.

---

## Part 3. What both TE and Resonare do badly

44. **Vibrato makes the needle wander.** TE reviews call its display "jumpy" on
    sustained notes [TE reviews]. Our steadiness modes smooth noise but still
    follow vibrato [our code].
    Solution: vibrato-aware centre.
    1. Keep the last 1 s of pitch readings.
    2. Detect vibrato by finding a dominant oscillation between 4 and 8 Hz in
       that series (autocorrelation of the cents series).
    3. When present, display the mean over whole vibrato cycles as the centre
       pitch, and show vibrato width (peak to peak cents) and rate (Hz) as
       secondary info, which is useful feedback in its own right.
    4. Unit test with a synthesized 5.5 Hz, 40-cent vibrato tone: displayed
       centre within 2 cents of the true centre.
    Effort: M.

45. **The tuner hearing the metronome.** A TE review says you "can't tune with
    the metronome on" [TE reviews]. Ours skips audio around each click, but that
    was never tested with a real speaker and microphone, and at fast subdivided
    tempos the skipped windows can cover most of the time [our code].
    Solution:
    1. Measure: play the metronome through speakers at 60, 120 and 240 BPM with
       subdivisions while a steady tone plays; log reading stability with gating
       off and on.
    2. Shorten the skip window based on the actual click decay, per sound (the
       loudness table in `voices.ts` already has per-sound data).
    3. Better: subtract the click. We know each click waveform and its scheduled
       time; estimate the room delay and gain with cross-correlation over the
       first few clicks, then subtract the rendered click from the mic signal
       before pitch detection.
    Effort: M (measurement and tuning) to L (subtraction).

46. **Octave errors and misses on low, breathy or harmonic-rich instruments.**
    Unknown for TE; untested for us beyond synthetic tones [our code].
    Solution: the benchmark in item 37 finds them; then add a subharmonic check:
    when YIN picks lag tau, also test 2 tau and 3 tau and prefer the longer lag
    if its normalized difference is within a small margin (tune the margin from
    the benchmark, not by guess).
    Effort: M.

47. **Noisy rooms and ensembles.** Both apps are monophonic and will jump to the
    loudest nearby sound [unverified for TE].
    Solution: a clarity threshold setting (YIN already returns clarity), a hold
    until the same note repeats for 3 frames in "ensemble" mode, and a visible
    "too noisy" state instead of a wrong note. Effort: S.

48. **No polyphonic tuning.** You cannot strum all guitar strings at once in
    either app [unverified for TE; its guide describes per-string detection].
    Solution: in strings mode, run a spectrum (already implemented) and, for each
    string's target, measure energy and exact frequency near that target by
    parabolic interpolation of the spectral peak; show all strings at once. Needs
    a longer frame (at least 8192 samples) for resolution. Effort: L.

49. **Steep learning curve.** TE reviews say options are hard to find
    [TE reviews]. Ours hides many settings in gear sheets too [our code].
    Solution: a search box in the help sheet that lists every setting and jumps
    to it; show "changed from default" dots on gear buttons; move the 3 most-used
    options out of sheets onto each screen; confirm with item 41's sessions.
    Effort: M.

50. **Bluetooth headphone latency.** TE's Bluetooth distortion shows up in
    reviews [research, Play Store search summary, unverified]; neither app
    compensates in any way we know of.
    Solution: a latency calibration: play 8 clicks and ask the user to tap along;
    median tap offset minus expected is the compensation, applied to visuals and
    tap tempo. Store per output device label when available. Effort: S.

51. **Data safety.** A TE review mentions losing practice activity [research,
    search summary, unverified]. Ours keeps everything in the browser, and
    Safari deletes script-writable storage after 7 days without use for sites
    not added to the home screen [verified: https://webkit.org/tracking-prevention/].
    Our JSON backup excludes recordings, scores and annotations [our code].
    Solution:
    1. Call `navigator.storage.persist()` after the user saves a first take or
       score, and show whether persistence was granted.
    2. Full backup: a zip with settings, recordings, scores and annotations
       (write the zip with a small no-dependency store-only encoder).
    3. A gentle reminder to back up or install to the home screen after 5 days
       of use in plain Safari.
    Effort: M.

52. **Accessibility has not been tested with real screen reader users.** TE
    claims VoiceOver support [TE guide]; ours has announcements and labels
    [our code]. Neither is proven to us.
    Solution: test the full flows with VoiceOver on iOS and TalkBack on Android;
    make the tempo dial expose `aria-valuetext` ("100 beats per minute,
    Andante"); make the pitch ring announce direction changes only when they
    cross the tolerance edge. Effort: M.

53. **Battery use of continuous analysis on phones.** Unmeasured for both.
    Ours: about 1 ms per frame for mid-range notes on this desktop, not on a
    phone [our code].
    Solution: measure on 2 real phones for 10 minutes of tuner use; if heavy, run
    detection in an `AudioWorklet` at 30 frames per second instead of 60 and
    skip analysis while the page is hidden. Effort: M.

54. **Sheet music cannot follow what you play.** Neither app turns pages from
    your playing [unverified for TE].
    Solution, in stages: (a) metronome-driven turns after N bars per page (S);
    (b) "page turn markers" you tap in once, then turns happen at those bar
    counts (M); (c) real score following needs symbolic scores (MusicXML) and
    pitch alignment (XL).

55. **No guidance on what to practise.** Both are toolkits.
    Solution: routines, meaning ordered steps like "5 min long tones with drone,
    speed trainer scale 60 to 90, record and check the etude", built from the
    existing features and stored as a list you tick through. Effort: M.

---

## Part 4. Resonare's own gaps (not about TE)

### Verification

56. **No real instrument, microphone or phone testing** [our code]. Solution:
    items 37, 41, 45 and 53, plus a device matrix: 1 recent iPhone, 1 older
    iPhone on iOS 16.x, 1 mid-range Android, 1 laptop with Safari, 1 with
    Firefox.

57. **Safari and Firefox never run** [our code]. Solution: install Firefox
    (needs your approval to download); for Safari, use a Mac or a cloud device
    service; run `scripts/e2e.mjs` adapted to WebDriver BiDi, which both support
    [unverified for Safari; check current status].

58. **CI has never run** because nothing is on GitHub [our code]. Solution:
    publish (your decision), then fix whatever the first run breaks, most likely
    the headless Chrome path and `--no-sandbox` on the runner.

59. **E2E coverage gaps**: wheel drag glide, keyboard, exercise player, strobe
    and strings modes, click-track tempo ramps, MIDI learning, backup import,
    video takes, theme switching, first-run intro [our code].
    Solution: one e2e check each, reusing the existing helpers. Effort: M total.

### Platform behaviour

60. **Full screen is unavailable on iPhone Safari**, so the sheet reader hides
    the button there [our code, from MDN compat data]. Solution: on iOS, offer
    "Add to Home Screen" instructions, since a home screen web app has no Safari
    toolbar and uses the full display [unverified; check on device].

61. **No "new version available" prompt.** The service worker now waits for old
    tabs to close, so an installed app may keep running an old version for a
    long time [our code].
    Solution: detect a waiting worker (`registration.waiting`) and show a small
    "Update ready, reload" toast that posts `SKIP_WAITING` to the worker and
    reloads on `controllerchange`. Effort: S.

62. **Storage quota errors are only shown as a generic save failure** [our code].
    Solution: check `navigator.storage.estimate()` before saving large video
    takes; warn when under 50 MB free; offer to delete old takes. Effort: S.

63. **Recorder formats on Safari** (MP4 audio, possibly different decoding) are
    untested [our code]. Solution: device test from item 56; if
    `decodeAudioData` fails on MP4, analyse the live stream during recording
    instead of decoding afterwards. Effort: S to M.

64. **Landscape phone layouts** are not designed [our code]. Solution: a
    `(orientation: landscape) and (max-height: 500px)` layout that puts the ring
    and the readout side by side and hides the dock. Effort: S.

65. **Keyboard-only use of the wheel and the dial is partial**: the wheel has no
    arrow-key navigation [our code]. Solution: make wedges focusable with
    roving tabindex; arrows move, Enter toggles. Effort: S.

### Features we half-built

66. **Transposing a take works for audio only, not video** [our code]. Solution:
    render the shifted audio and play it in sync with the muted video element,
    locking `currentTime` on seek. Effort: S.

67. **Pitch shifting is a basic WSOLA**, audibly rougher than studio tools
    [our code]. Solution: a phase vocoder with transient preservation, only if
    listeners complain; benchmark with a sustained cello note and a staccato
    passage. Effort: M.

68. **Click tracks cannot start from a section or seek on the timeline**
    [our code]. Solution: tap a timeline segment to start from its first event
    (skip events before `spans[i].start`, subtract that offset from times).
    Effort: S.

69. **Sheet music lacks page thumbnails, bookmarks, setlists, zoom and margin
    crop, and export of annotated PDFs** [our code].
    Solution: thumbnails strip from the existing render path at 120 px width;
    bookmarks as `{page, label}` on the score entry; setlists as ordered score
    ids; crop by rendering with a viewport offset; export by drawing ink onto
    rendered pages and saving an image-based PDF (or use pdf-lib after checking
    its license). Effort: M each.

70. **Native confirm and alert dialogs** look out of place [our code].
    Solution: a `confirmSheet(title, body, confirmLabel)` using the existing sheet
    component, returning a promise. Effort: S.

71. **No undo for deleting takes, scores or presets** [our code]. Solution: soft
    delete with a 10-second "Undo" toast before removing from IndexedDB.
    Effort: S.

72. **No calibration of A4 from a reference** (for example an orchestra's
    oboe) [our code]. Solution: "Set A from what I hear": listen 2 s, take the
    median frequency, set `a4` if the detected note is an A, rounded to 0.1 Hz.
    Effort: S.

73. **No large-number stage display** for ensembles or projectors [our code].
    Solution: a full-screen tuner and metronome mode with only the note, cents
    and beat, readable from 5 metres. Effort: S.

74. **Haptic metronome on Android** (vibrate on the beat) is missing
    [our code]. `vibrate` timing precision is unknown [unverified].
    Solution: prototype `navigator.vibrate(20)` from the visual callback, measure
    jitter with a phone camera recording, and ship only if within 20 ms.
    Effort: S.

### Code health

75. **`src/styles.css` is about 3,000 lines in one file** and several views pass
    400 lines [our code]. Solution: split CSS per screen and import from each
    view module; extract the tuner's strobe and tendencies into components.
    Effort: M.

76. **Settings is one large object written to localStorage on every change**,
    including tendencies and practice history [our code]. Solution: move history
    and tendencies to IndexedDB, keep localStorage for small preferences, and
    write through a 300 ms debounce. Effort: M.

77. **Some UI code builds whole lists on every render** (for example the
    Practice screen re-renders fully when history changes) [our code].
    Solution: update only changed nodes; measure first with the browser
    performance panel to confirm it matters. Effort: S.

78. **No local error log.** When something fails for a user there is no record
    [our code]. Solution: capture `error` and `unhandledrejection` into a
    ring buffer shown under Practice, with a "copy details" button. Nothing is
    sent anywhere. Effort: S.

---

## Part 5. Blocked on you or on outside resources

| Item | What is needed |
| --- | --- |
| 2 Ableton Link | Native shell plus a GPL or proprietary licensing decision |
| 10 BodyBeat | Documented Bluetooth protocol, if one exists |
| 35 App stores, Apple Watch | Apple and Google developer accounts, a Mac |
| 37, 41, 45, 53, 56 | Real instruments, players and phones |
| 40 Samples | Recording sessions or license checks for each sample set |
| 57 Firefox, Safari | Your approval to download Firefox; a Mac or device service |
| 58 CI | Your approval to publish to GitHub |
| 16, 32 Translations, sargam | Native speakers to review |

## Suggested order

1. Cheap and high impact: 38 wake lock, 39 latency-aligned visuals, 61 update
   prompt, 72 calibrate A4, 5 time limit, 70 and 71 dialogs and undo, 11
   instrument profiles.
2. Proof of quality: 37 accuracy benchmark, 44 vibrato centre, 45 click
   measurement, 51 data safety.
3. Depth that matches TE: 1 voice count-in, 3 sections as full presets, 21
   exercises, 27 A-B loop and live file analysis, 30 mixer, 17 timed events.
4. With your help: 56 device testing, 41 usability sessions, 57 and 58
   browsers and CI.
5. Only if the project goes native: 2, 35, 36.
