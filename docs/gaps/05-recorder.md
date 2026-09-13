# Recorder

This file lists 154 gaps in recording and playback, none repeating the 78 in `docs/gap-analysis.md`. That is where I ran out of genuine ones; I stopped rather than pad.

Where the evidence cites our code, I read the source in this session: `src/ui/views/recorder.ts`, `src/core/pitchshift.ts`, `src/core/intonation.ts`, `src/store/db.ts`, `src/audio/context.ts`, `src/ui/controls.ts`, `src/store/settings.ts`, `src/styles.css`, `scripts/e2e.mjs` and `public/manifest.webmanifest`. Every competitor feature is recalled from memory and marked [unverified]. Browser behaviour claims I did not check are marked the same way.

These are the most serious:
- **Real bugs:**
  - A MediaRecorder setup failure leaks the mic.
  - Unplugging the mic mid-take is not handled.
  - Chrome WebM takes may have no duration and no seek index [unverified].
  - A failed transpose still shows the new key as selected.
  - The `toggle` MIDI or pedal action does nothing on the Record screen.
- **Data loss:**
  - Saving or deleting any take stops playback on every card, wipes all open reports and throws away transposed copies.
  - A tab crash or reload mid-take loses the whole take.
  - Intonation reports are never saved.
- **Report accuracy:**
  - Note names ignore the transposing-instrument setting, although the tuner applies it.
  - Metronome click bleed is not skipped during take analysis.
  - Quiet takes read as silence because of the fixed noise gate.

## Capture and input

### No microphone or input device picker
Evidence: `src/audio/context.ts:45` calls `getUserMedia({audio:{echoCancellation:false,...}})` with no `deviceId`. Zoom recorders and GarageBand pick the input [unverified].
Fix: in `context.ts`, list inputs with `enumerateDevices()` filtered to `audioinput` and store `inputDeviceId` in settings. Pass `deviceId: {exact}` in `acquireMic`, drop the shared stream when the device changes, listen to `devicechange`, and add a select to the recorder panel. E2e: fake two devices and check the chosen `deviceId` is requested.
Effort: M

### No input level check before recording starts
Evidence: `recorder.ts:136-145` only fills the level meter inside `toggle()` after recording begins, and `drawLive` draws a flat line when idle (`recorder.ts:153-157`). Voice Memos and Zoom recorders show levels before recording [unverified].
Fix: a "Check level" state that acquires the mic, runs the same analyser loop without a MediaRecorder, and releases the mic after 30 s idle or on leaving the screen.
Effort: S

### No peak or clipping indicator
Evidence: `recorder.ts:140,162` stores RMS and draws `sqrt(l)*2.4`, not a dBFS peak, so clipping is invisible.
Fix: in the rAF loop, compute `max(abs(sample))`. Draw a peak-hold tick and a red "CLIP" badge held for 2 s when the peak is at or above 0.99, and count clipped samples per take into a new `RecordingEntry.clipCount`.
Effort: S

### Level meter misses peaks between animation frames
Evidence: `recorder.ts:92,139` reads 1024 samples once per rAF. At 48 kHz and 60 fps a frame holds 800 samples, so gaps appear whenever frames drop (hidden tab, slow phone).
Fix: an `AudioWorkletProcessor` that posts per-block peak and RMS to the main thread, which aggregates them.
Effort: M

### No input gain control or recording-level guidance
Evidence: `context.ts:45` disables `autoGainControl` and nothing in the recorder scales input, so quiet mics give quiet takes.
Fix: a gain slider with a `GainNode` between source and a `MediaStreamAudioDestinationNode`, record that stream, and show a target zone of -18 to -6 dBFS on the meter.
Effort: M

### Mono only, no stereo recording
Evidence: `context.ts:45` requests no `channelCount`, and `recorder.ts:33-41` downmixes. Zoom recorders record stereo [unverified].
Fix: a setting "Stereo when available" that requests `channelCount: {ideal: 2}`. Store `channels` on the entry, keep analysis on the mono downmix, and make the transposer process each channel.
Effort: S

### Lossy Opus only, no lossless capture
Evidence: `recorder.ts:14-19` picks Opus or MP4 and `MediaRecorder` is constructed with no bitrate (`recorder.ts:118`). Intonation analysis runs on a lossy decode.
Fix: a "Lossless (WAV)" quality option. An AudioWorklet copies Float32 blocks into chunked buffers, `encodeWav` is extended for stereo and 24 bit, and a size estimate is shown (about 5.5 MB per minute for 16 bit mono at 48 kHz).
Effort: M

### No audio or video bitrate setting
Evidence: `recorder.ts:118` passes only `mimeType`, not `audioBitsPerSecond` or `videoBitsPerSecond`, so size and quality are whatever the browser defaults to.
Fix: Quality presets (Small, Standard, High) that map to `audioBitsPerSecond` 64k/128k/256k and `videoBitsPerSecond` 1M/2.5M/5M. Record the effective values on the entry.
Effort: S

### Sample rate is not requested or recorded
Evidence: no `sampleRate` constraint in `context.ts:45`, and `RecordingEntry` (`db.ts:3-10`) has no `sampleRate`.
Fix: read `track.getSettings().sampleRate` and `channelCount` at start and save them on the entry. Show them in a take info sheet.
Effort: S

### No optional noise suppression for non-tuning takes
Evidence: `context.ts:45` hard-disables processing for every consumer, including the recorder.
Fix: a recorder-only toggle "Voice memo cleanup" that opens a separate stream with `noiseSuppression:true`, `echoCancellation:true`. Label takes recorded with it and warn that analysis is less reliable.
Effort: S

### No post-recording noise reduction or rumble filter
Evidence: nothing in `pitchshift.ts` or `recorder.ts` filters the signal. Audacity-style spectral gating is standard in editors [unverified for the named apps].
Fix: `src/core/denoise.ts` builds a noise profile from the quietest 0.5 s (frames under the 10th percentile RMS), then applies STFT spectral subtraction with a floor, plus an 80 Hz high-pass biquad option. Render to a new derived take. Unit test on a sine plus white noise and check SNR improves.
Effort: L

### No warning when the input is a Bluetooth headset microphone
Evidence: the recorder advises headphones for the click (`recorder.ts:458`), but a Bluetooth headset mic is typically a low-bandwidth call profile [unverified].
Fix: after acquiring, check `track.label` for "Hands-Free" or "Bluetooth" and `getSettings().sampleRate <= 16000`, then show a toast recommending the built-in mic.
Effort: S

### No microphone permission state shown up front
Evidence: the mic error only appears after pressing record (`recorder.ts:94-97`).
Fix: `navigator.permissions.query({name:'microphone'})` on mount, plus `camera` when video is on. Show "Microphone blocked, here is how to allow it" before the first tap. Guard with try/catch because some browsers do not support these names [unverified].
Effort: S

### MediaRecorder construction failure leaks the mic and leaves the UI stuck
Evidence: `recorder.ts:117-127` has no try/catch around `new MediaRecorder` or `rec.start`. A throw (unsupported option) leaves `sourceNode` connected, the mic acquired and camera tracks running.
Fix: wrap the construction and `start` in try/catch that calls `teardown()` and shows an `errorBox`. Unit test by stubbing `MediaRecorder` to throw.
Effort: S

### No MediaRecorder error handler
Evidence: `rec.onerror` is never set (`recorder.ts:121-126`).
Fix: `rec.onerror = (e) => { errorSlot.append(errorBox(e.error?.message)); rec.state !== 'inactive' && rec.stop(); }`, and save whatever chunks exist.
Effort: S

### Unplugged mic or ended track is not detected
Evidence: no `ended` or `mute` listeners on the stream tracks in `recorder.ts` or `context.ts`. The only guard is the empty-blob check after stop (`recorder.ts:200`).
Fix: attach `track.onended` to stop the recorder, save the partial take and tell the user. On `onmute`, show "Input interrupted" and add a marker at that time.
Effort: S

### Interruptions (phone call, another app taking the mic) are not handled
Evidence: no `visibilitychange` or `AudioContext` `statechange` handling in `recorder.ts`. A search found none in `src`.
Fix: on `ctx.onstatechange` to `interrupted` or `suspended` while recording, pause the MediaRecorder, show a banner, and offer resume or stop and save.
Effort: M

### A tab crash or reload mid-take loses the whole take
Evidence: chunks live only in the `recChunks` array (`recorder.ts:119-123`) and there is no `beforeunload` guard (none in `src`).
Fix: write each 1 s chunk to a new `recordingChunks` store (`{takeId, seq, blob}`, `DB_VERSION` 3). On mount, reassemble orphaned chunk sets into a "Recovered take". Add a `beforeunload` prompt while recording.
Effort: M

### No pause and resume during a take
Evidence: only start and stop (`recorder.ts:68-72`). `MediaRecorder.pause()` exists. Voice Memos has pause [unverified].
Fix: a pause button that calls `rec.pause()` and `resume()`, freezes the timer with accumulated active time, and stops the metronome too if the take started it.
Effort: S

### Duration is wall-clock time, not media time
Evidence: `recorder.ts:189` uses `performance.now() - recStartedAt`, which includes permission and start latency and stop flush time. Playback then maps the progress bar with this value when `audio.duration` is not finite (`recorder.ts:246,251`).
Fix: after saving, decode (or read `loadedmetadata` duration after forcing a seek to a very large time) and store the real duration. Use the sum of `rec` active time until then.
Effort: S

### Chrome WebM takes may have no duration header or seek index
Evidence: the progress code already works around a non-finite `audio.duration` (`recorder.ts:246`), which is the symptom of MediaRecorder WebM without Duration or Cues [unverified that seeking is also degraded].
Fix: post-process the blob in `src/core/webmfix.ts` (EBML parse, write the Segment Duration, and optionally Cues from cluster timecodes). Add an e2e test that seeks to 50% and checks `currentTime` lands within 0.2 s.
Effort: M

### No recording length or storage limit shown during a take
Evidence: the timer only counts up (`recorder.ts:135`).
Fix: at start, call `navigator.storage.estimate()` and divide the free space by the chosen bitrate. Show "about 2 h left" and auto-stop and save at 95% of it.
Effort: S

### Sub-second accidental takes are saved
Evidence: `finish` saves any non-empty blob (`recorder.ts:199-214`).
Fix: if the duration is under 1 s, discard with a toast "Too short, not saved" and an Undo that saves anyway.
Effort: S

### No review step or retake after recording
Evidence: every take is saved immediately (`recorder.ts:213`). Voice Memos and TE let you review first [unverified].
Fix: after stop, show an inline "Keep / Retake / Discard" bar on the new card. Retake deletes that take and starts recording immediately, reusing the name with an incremented number.
Effort: S

### No count-in before the take
Evidence: `recorder.ts:130-131` starts the metronome and the recording at the same instant.
Fix: a "Count-in bars" option. Schedule the recorder start at the downbeat after N bars using `ctx.currentTime` and store `countInOffset` on the entry so playback and analysis skip it.
Effort: M

### Recording start is not aligned to the metronome grid
Evidence: `metronome.start()` and `rec.start()` are unrelated calls (`recorder.ts:127,131`), so the offset between click and take is unknown.
Fix: record `clickEpoch = metronome first beat time - (ctx.currentTime at rec.start + input latency)` on the entry. Needed for timing analysis and overdubs.
Effort: M

### Tempo, meter and click settings are not saved on the take
Evidence: `RecordingEntry` has only id, name, created, duration, mime and blob (`db.ts:3-10`).
Fix: add `bpm`, `meter`, `subdivision`, `withClick`, `a4`, `temperament`, `tonic`, `transposition` and `inputLabel` from settings at start. Show them in the take info.
Effort: S

### Metronome click bleed corrupts the take report
Evidence: the tuner skips audio around clicks (README "Ignores the metronome"), but `analyzeTake` in `recorder.ts:324-334` analyses every frame with no click gating.
Fix: when `withClick` and `clickEpoch` are stored, pass the click times into `analyzeTake` and null out frames overlapping `[click, click + decay]`, reusing the tuner's skip window logic. Unit test with synthetic clicks mixed into a tone.
Effort: M

### Cannot set the tempo from the Record screen
Evidence: `styles.css:2866` hides the dock on `data-route='record'` unless it is playing, so the "Metronome while recording" switch (`recorder.ts:458`) uses whatever tempo was last set elsewhere.
Fix: when the switch is on, show an inline compact tempo and meter control (BPM stepper plus tap), or always show the dock on Record.
Effort: S

### Recorder switches are not remembered
Evidence: `withClick` and `withVideo` are plain checkboxes created unchecked on every mount (`recorder.ts:60-61`).
Fix: persist `recWithClick` and `recWithVideo` in settings and bind `onchange` to `updateSettings`.
Effort: S

### MIDI pedal and keyboard cannot start or stop recording
Evidence: the `toggle` action dispatches a Space keydown (`controls.ts:56-58`), but `recorder.ts` registers no keydown listener, so pedals do nothing on Record. `MidiAction` has no record action (`src/core/midi.ts:1`).
Fix: add a `keydown` handler for Space (start/stop) and `R` in `mountRecorder`, and add a `record` MidiAction. E2e: dispatch Space and check a take appears.
Effort: S

### No markers during recording
Evidence: no marker data in `RecordingEntry` and no control in `rec-panel` (`recorder.ts:449-459`). Zoom recorders have a mark button [unverified].
Fix: a "Mark" button and `K` key that push `{t, label?}` to `markers` on the entry. Show markers as ticks on the take progress and as a list with tap-to-seek.
Effort: M

### No pre-record buffer
Evidence: recording begins at the tap (`recorder.ts:127`). Zoom recorders offer pre-record [unverified].
Fix: while "Check level" is active, keep a 3 s ring buffer of PCM in an AudioWorklet. On record, prepend it (requires the lossless path, or encoding the prebuffer to WAV and storing it as a separate leading segment played first).
Effort: L

### No sound-activated auto record and auto stop
Evidence: no threshold logic in `recorder.ts`. Zoom recorders have auto rec [unverified].
Fix: an "Auto" mode that starts when RMS exceeds a threshold for 100 ms and stops after N seconds below it, with a pre-buffer (item above) so the attack is kept.
Effort: M

### No whole-session recording that splits at silences
Evidence: one blob per take (`recorder.ts:199`).
Fix: a `splitAtSilence(samples, sr, minSilence=2s, threshold)` core function (unit tested), plus a "Split into takes" action creating derived entries with `parentId` and offsets instead of copying audio.
Effort: M

### Recording state is not announced to screen readers
Evidence: `recState` is a plain div (`recorder.ts:66`), the button has no `aria-pressed`, and `toast('Take saved')` is the only feedback.
Fix: set `role="status"` on `recState`, `aria-pressed` on `recBtn`, and call `announce('Recording started', true)` and `announce('Take saved, 1 minute 12', true)`.
Effort: S

### Dead recorder CSS
Evidence: `.record-btn.on`, `.rec-item`, `.rec-list` and `.rec-panel .level` (`styles.css:2810,2899-2907,2917-2934`) are unused. The recorder uses the `.recording` and `.take*` classes (`styles.css:3582-3700`).
Fix: delete the unused rules. Grep `src` for each class before removing.
Effort: S

## Video

### No camera choice or front/rear switch
Evidence: `recorder.ts:102` hardcodes `facingMode: 'user'`. Phone camera apps and TE video let you flip [unverified for TE].
Fix: a camera select from `enumerateDevices()` `videoinput` plus a flip button toggling `user`/`environment`. Persist `cameraId`.
Effort: S

### No camera preview until recording starts
Evidence: `preview` is shown only inside `toggle()` after the mic is acquired (`recorder.ts:104-105`), so framing cannot be checked first.
Fix: when "Record video" is switched on, open the camera and show the preview immediately. Reuse that stream at record time, and stop it when the switch goes off or the view unmounts.
Effort: S

### Mirrored preview but unmirrored recording
Evidence: `video.rec-preview { transform: scaleX(-1) }` (`styles.css:3611`) while the recorded file and `video.take-video` (`styles.css:3613-3618`) are not mirrored, so bowing direction flips between preview and playback.
Fix: a "Mirror" toggle stored per take (`mirror: boolean`) that applies the same transform on playback, with the default matching the preview. Optionally a separate preview mirror setting.
Effort: S

### Fixed 720p resolution and frame rate
Evidence: `recorder.ts:102` uses `width: {ideal:1280}, height: {ideal:720}` with no `frameRate`.
Fix: resolution options (480p, 720p, 1080p) and 30/60 fps (60 helps slow-motion bow analysis). Read the actual `getSettings()` and store it on the entry.
Effort: S

### Portrait phones are cropped in preview and may record landscape-constrained
Evidence: `video.rec-preview` forces `aspect-ratio: 16/9` with `object-fit: cover` (`styles.css:3607-3610`), and the constraints assume landscape.
Fix: match the preview aspect ratio to `track.getSettings()` width and height, use `object-fit: contain`, and swap the ideal width and height when `screen.orientation.type` is portrait.
Effort: S

### Audio and camera come from two separate captures with no sync check
Evidence: the mic from `acquireMic` and the camera from a second `getUserMedia` are combined into a new `MediaStream` (`recorder.ts:102-103`). Any A/V offset is unmeasured [unverified whether it drifts].
Fix: request audio and video in one `getUserMedia` call when video is on, or measure the offset with a clap test in e2e (flash plus click) and store `avOffset`.
Effort: M

### Two sequential permission prompts for a video take
Evidence: mic is requested at `recorder.ts:83`, then the camera at `recorder.ts:102`.
Fix: a combined request `{audio, video}` when video is on, keeping the tuner-safe audio constraints.
Effort: S

### No frame-by-frame stepping for video takes
Evidence: the player has play, a range and speed only (`recorder.ts:231-260`).
Fix: step buttons and `,` `.` keys that pause and move `currentTime` by 1/fps (from the stored frame rate), using `requestVideoFrameCallback` where available.
Effort: S

### No slower video speeds
Evidence: the speed options are 0.5, 0.75, 1 and 1.25 (`recorder.ts:256`).
Fix: add 0.25 and 0.1 for video, mute audio below 0.5 (pitch preservation degrades), and continue with the continuous speed item below.
Effort: S

### No side-by-side video comparison of two takes
Evidence: each card plays independently, and playing one pauses the others (`recorder.ts:238`).
Fix: a "Compare" mode with two `video` elements in a grid, one shared transport that sets both `currentTime`, and a per-side offset nudge.
Effort: M

### No drawing or guide lines over video
Evidence: no overlay on `take-video`. Coach's Eye-style apps allow drawing on video [unverified].
Fix: a canvas overlay reusing `src/core/ink` strokes, stored per take with a timestamp, and optional straight-line tools for bow angle.
Effort: M

### No tuner or beat overlay burned into or synced with video
Evidence: video takes carry no pitch display. TE records video with its tuner visible [unverified].
Fix: on playback, draw the stored analysis readings as a moving cents needle in a corner overlay synced to `currentTime`. For export, composite with canvas `captureStream` plus the audio track into MediaRecorder.
Effort: L

### Picture-in-picture not offered for video takes
Evidence: no PiP control in `takeCard`.
Fix: a PiP button calling `video.requestPictureInPicture()` when `document.pictureInPictureEnabled`, so a take can be watched while the sheet music is open.
Effort: S

### No video-only or audio-only extraction
Evidence: video takes are stored as one blob and cannot be transposed (gap 66) or saved as audio.
Fix: "Save audio as new take" that decodes the audio via `decodeAudioData` on the video blob and stores WAV or Opus as a derived entry.
Effort: S

### Video takes use the full-width player inside every card
Evidence: `video.take-video` is `width:100%`, `max-height:420px` for each take (`styles.css:3613-3618`) and loads metadata for all of them (`recorder.ts:226`).
Fix: show a poster thumbnail (first frame drawn to canvas at save, stored as a data URL) and create the `video` element only on play.
Effort: S

## Take list, library and organization

### Any save or delete rebuilds every card
Evidence: `renderList()` revokes all object URLs and replaces all cards (`recorder.ts:436-443`). It is called after each save (`recorder.ts:218`) and delete (`recorder.ts:362`), which stops other playback, discards open reports and transposed caches, and resets speed.
Fix: keyed rendering. Keep a `Map<id, card>`, insert the new card at the top, remove only the deleted card, and revoke only that card's URLs.
Effort: S

### Listing loads every recording blob into memory
Evidence: `db.list('recordings')` uses `getAll()` over entries that contain `blob` (`db.ts:96`, `recorder.ts:431`).
Fix: split into `recordingMeta` (no blob) and `recordingBlobs` (`{id, blob}`) in a `DB_VERSION` 3 upgrade that migrates existing entries with a cursor, and load a blob only on play, analyse or download. Test the upgrade with fake-indexeddb.
Effort: M

### Every card creates a media element and object URL up front
Evidence: `takeCard` calls `URL.createObjectURL` and builds `audio`/`video` with `preload: 'metadata'` for each take (`recorder.ts:222-227`).
Fix: render lightweight rows and create the media element on first play. For long lists, render in batches with an IntersectionObserver.
Effort: S

### No sorting options
Evidence: fixed newest first (`recorder.ts:438`).
Fix: a sort select (newest, oldest, name, longest, best in tune from the saved report), persisted in settings.
Effort: S

### No search
Evidence: no filter input in the takes header (`recorder.ts:461`).
Fix: a search box filtering on name, notes and tags, case-insensitive with diacritics folded via `normalize('NFD')`.
Effort: S

### No folders or pieces
Evidence: `RecordingEntry` has no grouping field (`db.ts:3-10`). TE's file browser has folders [unverified].
Fix: `folderId` on the entry and a `folders` store (`{id, name, order}`), with a folder chip row, move-to sheet, and a default "Unfiled".
Effort: M

### No tags
Evidence: no `tags` on the entry.
Fix: `tags: string[]` with chip entry on the card, a tag filter, and suggestions from existing tags.
Effort: S

### No favourites or star
Evidence: nothing to mark a best take.
Fix: `starred: boolean`, a star icon button, a "Starred" filter, and a pin to the top option.
Effort: S

### No notes or practice journal on a take
Evidence: only an editable name (`recorder.ts:301-310`).
Fix: `notes: string` with a collapsible textarea saved on input with a 500 ms debounce. Show the first line in the list row.
Effort: S

### Takes are not linked to a score, click track or exercise
Evidence: no reference fields in `RecordingEntry`, and the sheet music screen has no record button.
Fix: `scoreId`, `page`, `clickTrackId`. Add a "Record" button in the sheet reader that sets these, and show "Takes of this piece" in the score view.
Effort: M

### Takes do not appear in Practice history
Evidence: `logPractice(duration, 'record')` only adds seconds (`recorder.ts:198`, `settings.ts:202-211`). `practice.ts` does not read recordings.
Fix: on a day's detail in the Practice calendar, list takes whose `created` falls that day with play links, using the metadata store index `created`.
Effort: S

### Default names are not numbered or piece-aware
Evidence: the name is `Take Sep 13, 3:04 PM` (`recorder.ts:206`), so two takes in one minute get identical names.
Fix: a name template "{piece} take {n}" where n is the count of takes today (or in the folder) plus 1, falling back to date and time with seconds.
Effort: S

### Rename accepts empty or whitespace names and does not handle errors
Evidence: `onchange` assigns the raw value and awaits `db.put` without try/catch (`recorder.ts:306-309`). An empty name makes the download filename `.webm`.
Fix: trim, and restore the previous name if empty. Wrap the save in try/catch with an errorBox and revert `item.name` on failure.
Effort: S

### Stale accessible names after rename
Evidence: the play button `aria-label` is set once with the original name (`recorder.ts:231`), and the delete label is also fixed at creation (`recorder.ts:358`).
Fix: update both labels in the rename handler, or compute them at event time.
Effort: S

### Download filename strips non-ASCII names
Evidence: `item.name.replace(/[^\w\- ]+/g, '_')` (`recorder.ts:357`). `\w` is ASCII only, so a name like "Bach Ciacona für Geige" loses characters and a fully non-Latin name becomes underscores.
Fix: replace only characters that are illegal in filenames, `/[\\/:*?"<>|\u0000-\u001f]/g`, collapse repeats, trim to 120 characters, and fall back to `take-<date>`. Unit test with Japanese and accented names.
Effort: S

### Delete does not handle errors or free its URL
Evidence: `db.delete` is awaited without try/catch, and the card's URL is only revoked on the next full render (`recorder.ts:358-363`).
Fix: wrap in try/catch with an errorBox and revoke `url` and the shifted URLs on success. Combine with the soft-delete toast from gap 71.
Effort: S

### No multi-select bulk actions
Evidence: every action is per card (`recorder.ts:353-364`).
Fix: a "Select" mode with checkboxes and a sticky bar offering delete, export zip, move to folder and tag.
Effort: M

### No per-take file size or total storage used
Evidence: no size displayed, and `RecordingEntry` has no `size` (`db.ts:3-10`).
Fix: store `blob.size` at save and show "3.2 MB" in the card meta. The takes header shows the total plus `navigator.storage.estimate()` usage, with a "Largest first" sort.
Effort: S

### No compact list view
Evidence: each `.take` card shows the full player, speed, transpose and actions (`styles.css:3624-3633`, `recorder.ts:343-368`), so ten takes make a very long page.
Fix: collapsed rows (name, date, duration, in-tune %, play) that expand one at a time into the full controls.
Effort: S

### No loading state for the take list
Evidence: `list` is empty until `db.list` resolves (`recorder.ts:428-443`).
Fix: show a skeleton row or spinner before the await and replace it after.
Effort: S

### No waveform thumbnail of each take
Evidence: the card has only a plain range input (`recorder.ts:232`). Voice Memos shows a waveform [unverified].
Fix: at save time, compute 200 min/max pairs from the recorded levels (or a decode) and store them as `peaks: number[]`. Draw on a canvas behind the progress bar.
Effort: S

### Live waveform is thrown away when the take ends
Evidence: `teardown()` clears `levels` (`recorder.ts:181`).
Fix: copy the full-take level history, downsampled to 200 bins, into the entry's `peaks` before teardown.
Effort: S

## Playback

### Coarse progress updates
Evidence: progress moves only on `timeupdate` (`recorder.ts:245-249`), which fires a few times per second [unverified exact rate].
Fix: update the progress and clock in a rAF loop while playing, and cancel it on pause.
Effort: S

### The progress thumb fights the user while dragging
Evidence: `timeupdate` writes `progress.value` even while the user drags (`recorder.ts:247,250-253`).
Fix: set a `scrubbing` flag on `pointerdown`/`pointerup` and skip writes while scrubbing.
Effort: S

### Progress slider has no spoken value
Evidence: the range is 0 to 1000 with no `aria-valuetext` (`recorder.ts:232`).
Fix: set `aria-valuetext` to "1 minute 5 seconds of 3 minutes" on update, and use `step` so arrow keys move 5 s.
Effort: S

### Play button shows a stop icon but pauses
Evidence: it shows the `stop` icon while playing, yet the click calls `pause()` and the label stays "Play" (`recorder.ts:237-243`).
Fix: use a pause icon and toggle `aria-label` between Play and Pause.
Effort: S

### No skip back or forward buttons
Evidence: none in `take-player` (`recorder.ts:348`). Practice apps have 5 s back [unverified].
Fix: back 5 s and forward 5 s buttons, plus a "back to last start" button that returns to where play was last pressed.
Effort: S

### No keyboard shortcuts for take playback
Evidence: no keydown handler in `recorder.ts`.
Fix: while the Record screen has focus, Space plays or pauses the last-used take, arrows seek 5 s, `[` and `]` change speed. Skip when `typingTarget`.
Effort: S

### No lock-screen or headset media controls
Evidence: no `navigator.mediaSession` use anywhere in `src` (search found none).
Fix: on play, set `mediaSession.metadata` (title = take name) and handlers for play, pause, seekbackward, seekforward and seekto.
Effort: S

### No per-take or playback volume control
Evidence: `audio.volume` is never set, and media elements bypass the app's master gain (`context.ts:10-11`).
Fix: a volume slider on the card, or route the element through `createMediaElementSource` into a playback bus (coordinate with gap 30).
Effort: S

### No loudness normalization for quiet takes
Evidence: with AGC off (`context.ts:45`) takes can be very quiet, and playback has no gain.
Fix: at save or first analysis, compute the peak and RMS and store `gainDb = min(-1 - peakDb, -16 - rmsDb)`. Apply it via a GainNode (needs a media element source) with a "Normalize" toggle.
Effort: M

### Speed is limited to four presets
Evidence: `['0.5','0.75','1','1.25']` (`recorder.ts:256`). Amazing Slow Downer and Anytune offer continuous ranges down to about 25% [unverified].
Fix: a slider from 0.25 to 2.0 in 0.05 steps with the presets as quick chips, and a percentage readout.
Effort: S

### No gradual speed-up trainer on a take
Evidence: speed is static. Anytune has a step trainer that raises tempo each loop [unverified].
Fix: settings `{start, end, step, loopsPerStep}`. On `ended` (or loop end with the gap 27 loop), raise `playbackRate` and loop.
Effort: S

### Speed and transpose reset on re-render and are not remembered
Evidence: both segmented controls default to `'1'` and `'0'` on each card creation (`recorder.ts:257,267`).
Fix: store `lastRate` and `lastSemis` on the entry (or in memory keyed by id) and restore them on render.
Effort: S

### Transpose is limited to two semitones with no cents or octave
Evidence: options run from -2 to +2 (`recorder.ts:266`). Transcribe! and Anytune allow fine cents and wider ranges [unverified].
Fix: a semitone stepper from -12 to +12 plus a cents slider from -50 to +50 (for example A=415 to 440 is about -77 cents, so allow a combined value). `pitchShift` already takes fractional semitones, so pass `semis + cents/100`.
Effort: S

### A failed transpose leaves the new value selected
Evidence: `segmented` calls `set(o.value)` before `onChange` (`components.ts:43-45`). The transpose handler returns on error without resetting (`recorder.ts:286-288`), so the UI shows +2 while playing the original.
Fix: in the catch branch (and when the token is stale), call `transpose.set(previousValue)`.
Effort: S

### Transposition runs on the main thread
Evidence: `pitchShift` and `encodeWav` run synchronously in the click handler (`recorder.ts:282`). The WSOLA search loop is O(n × search × hop/4) (`pitchshift.ts:49-59`), which freezes the UI for long takes.
Fix: move `pitchShift` and `encodeWav` into `src/workers/dsp.worker.ts` using transferable Float32Arrays, with progress messages every 5% and a cancel button.
Effort: M

### No progress or cancel for transposing
Evidence: only a toast "Transposing this take…" (`recorder.ts:278`). Selecting another value only discards the result after the work is done (`recorder.ts:292`).
Fix: progress inside the transpose control, and cancellation by terminating the worker job when the token changes.
Effort: S

### Transposed copies use unbounded memory
Evidence: each semitone value caches a full WAV object URL per card (`recorder.ts:263,283-285`), and each render decodes the take again.
Fix: an LRU of two shifted renders across all cards, revoking evicted URLs.
Effort: S

### The take is decoded again for every transpose and analysis
Evidence: `decode(item.blob)` is called separately in the transpose handler and in `analyze()` (`recorder.ts:280,318`).
Fix: a per-card lazy `decoded: Promise<AudioBuffer>`, dropped when the card collapses.
Effort: S

### Linear-interpolation resampling aliases when shifting up
Evidence: `resample` uses linear interpolation with no low-pass (`pitchshift.ts:9-22`). Shifting up compresses the stretched signal, folding content above the new Nyquist back down.
Fix: a windowed-sinc resampler (Kaiser, 32 taps) with the cutoff at `min(1, outLen/inLen) × Nyquist`. Unit test: shift a 20 kHz sine at 48 kHz up 2 semitones and assert the energy of the aliased tone is 40 dB below the input.
Effort: S

### WSOLA similarity is an unnormalized dot product
Evidence: `score += ref * input[cand+i]` with no energy normalization (`pitchshift.ts:50-54`), which favours louder candidate segments over better-aligned ones. It also samples every 4th sample at a step of 2.
Fix: normalized cross-correlation `sum(ab)/sqrt(sum(a²)sum(b²))`, or subtract a local mean. Keep the stride but test phase continuity: shift a 220 Hz sine and measure the THD of the output under a fixed threshold.
Effort: S

### Transposed output drops the take's tail
Evidence: `timeStretch` breaks when `best + frame > input.length` (`pitchshift.ts:61`), leaving the remaining output samples zero, then `resample` squeezes that silent tail in, so the last frame is lost.
Fix: zero-pad the input by `frame + search` before stretching and trim afterwards. Unit test that the RMS of the last 50 ms of a steady tone stays within 1 dB of the middle.
Effort: S

### Transposed audio is hard clipped with no headroom
Evidence: `encodeWav` clamps to ±1 (`pitchshift.ts:91`), and overlap-add of a hot take can exceed that.
Fix: measure the peak after shifting and scale by `0.98/peak` when above 0.98. Report when this happens.
Effort: S

### Transposing collapses stereo to mono
Evidence: `pitchShift(mono(buffer), ...)` and a mono-only `encodeWav` (`recorder.ts:282`, `pitchshift.ts:83`).
Fix: process each channel with shared alignment offsets (compute `best` on the mid signal and apply it to both channels), and write multichannel WAV.
Effort: S

### Cannot download or save the transposed or slowed version
Evidence: the download link always points at the original `url` (`recorder.ts:357`).
Fix: "Save as new take" that renders the current semitones and speed (time stretch by 1/rate plus pitch shift) to WAV, stored with `parentId` and a name suffix like "(-1 st, 75%)".
Effort: S

### No playlist or play-all
Evidence: `ended` only resets the icon (`recorder.ts:244`).
Fix: a "Play all" in the takes header. On `ended`, play the next card in the current sort, with an auto-advance toggle.
Effort: S

### No instant A/B switch between two takes at the same position
Evidence: playing one take pauses the others (`recorder.ts:238`), and positions are independent.
Fix: an "A/B" pair selector. One button swaps which take is audible while keeping the shared relative position (both elements playing, one muted, or seek the other to the same time on switch).
Effort: M

### Cannot play a take with a drone or metronome at the recorded tempo
Evidence: there is no playback-time link to `droneBank` or the metronome, and the tempo is not stored (see the take metadata item above).
Fix: a "With click" toggle that starts the metronome at the stored bpm, aligned by `clickEpoch` plus `currentTime`, and a "With drone" toggle that plays the stored tonic.
Effort: M

### No named markers or seekable regions list
Evidence: no marker data. Gap 27 covers only an A-B loop. Transcribe! has named markers [unverified].
Fix: `markers: {t, label, kind:'mark'|'section'}[]`, an "Add marker" button during playback, a list with tap-to-seek, and markers exported in the report.
Effort: M

### No zoomable waveform scrubber
Evidence: the only seek UI is a 0 to 1000 range (`recorder.ts:232`).
Fix: a canvas waveform from the decoded peaks with pinch or wheel zoom, drag to seek and a playhead. Reuse the min/max rendering from gap 23.
Effort: M

### No EQ or isolation for learning from a recording
Evidence: no filtering on playback. Anytune and Transcribe! provide EQ and centre-channel reduction [unverified].
Fix: route playback through `createMediaElementSource`, then three BiquadFilters (low shelf, peaking, high shelf) and an optional mid/side "reduce centre" using a ChannelSplitter and inverted gain.
Effort: M

## Editing

### No trimming
Evidence: no edit operations on `RecordingEntry`, and takes include the fumble before playing.
Fix: a trim sheet with two handles on the waveform. Store non-destructive `trimStart` and `trimEnd`, applied on playback (seek and stop) and analysis. "Make permanent" renders WAV.
Effort: M

### No automatic silence trimming
Evidence: `analyzeTake` and playback cover the whole blob, including leading and trailing silence.
Fix: `findSoundRange(samples, sr, thresholdDb=-45)` in core, unit tested, used to propose trim points at save.
Effort: S

### No splitting a take
Evidence: no split operation.
Fix: "Split at playhead" creates two derived entries referencing the parent blob with offset ranges (`parentId`, `start`, `end`) to avoid copying data.
Effort: S

### No fades
Evidence: none.
Fix: optional 10 to 200 ms fade in and out, applied when rendering an export or permanent trim.
Effort: S

### No combining takes
Evidence: none.
Fix: "Join" in multi-select decodes each take, resamples to a common rate and concatenates with 50 ms crossfades into a new WAV take.
Effort: M

### No undo history for edits
Evidence: no edit model exists yet.
Fix: keep non-destructive edits (`trimStart`, `trimEnd`, `gainDb`, `markers`) as a versioned list on the entry with undo and redo.
Effort: S

## Multitrack, overdub and backing tracks

### No recording over a backing track
Evidence: the recorder can only add the metronome (`recorder.ts:130-131`). BandLab and GarageBand record against backing audio [unverified].
Fix: a "Play along with" picker (an imported file or another take). Start the backing `AudioBufferSourceNode` at a scheduled `ctx.currentTime` and store `backingId` and `backingOffset` on the new take.
Effort: M

### No overdub or multitrack layering
Evidence: one blob per entry and no tracks model (`db.ts:3-10`).
Fix: a `projects` store `{id, name, tracks:[{takeId, offset, gain, pan, mute, solo}]}`, a simple stacked lane view and playback of all tracks via AudioBufferSourceNodes in sync.
Effort: L

### No round-trip latency compensation for overdubs
Evidence: `acquireMic` and `AudioContext` expose no latency estimate to the recorder (`context.ts:9`).
Fix: a loopback calibration (play clicks, record them through speaker or cable, cross-correlate to find the delay). Store `roundTripMs` per input/output pair, and subtract `outputLatency + inputLatency` (from `ctx.outputLatency` and track settings `latency` where supported) from every overdub offset.
Effort: M

### No self-duet: play a previous take while recording a new one
Evidence: playing a take while recording has no linkage (`recorder.ts:237-241`).
Fix: part of the backing-track picker. Allow any take as backing and default the new take's name to "{name} part 2".
Effort: S

### No mixing down layered takes
Evidence: none.
Fix: render the project with `OfflineAudioContext` (sources, gain, StereoPanner) to WAV as a new take.
Effort: M

## Import, export and sharing

### Cannot import audio or video files
Evidence: the recorder has no file input or drop zone, and the take list only holds MediaRecorder output. Anytune, Transcribe! and TE's file browser open device files [unverified].
Fix: an "Import" button with `<input type=file accept="audio/*,video/*">` and drag and drop on the list. Probe with `decodeAudioData` or a media element for duration, and store as a `RecordingEntry` with `source: 'import'`. E2e: import a generated WAV and analyse it.
Effort: S

### Not a share target or file handler for audio
Evidence: `public/manifest.webmanifest` has no `share_target` or `file_handlers` (search found none).
Fix: add a `share_target` (POST, multipart, accept audio/* and video/*). The service worker stores the file into IndexedDB and redirects to `#/record`. Add `file_handlers` for desktop installs.
Effort: M

### No WAV export
Evidence: the download serves the raw recorded container (`recorder.ts:357`).
Fix: an export sheet with WAV (decode, then `encodeWav` 16 or 24 bit) alongside the original.
Effort: S

### No M4A or MP3 export
Evidence: Chrome takes are WebM/Opus (`recorder.ts:16-17`), which some players and school upload portals reject [unverified which ones].
Fix: M4A/AAC via WebCodecs `AudioEncoder` where `isConfigSupported({codec:'mp4a.40.2'})`, muxed with a small MP4 writer (check the licence of any muxer library). MP3 via a lame port in a lazily loaded worker (check its LGPL obligations first).
Effort: L

### No video export to MP4
Evidence: Chrome video takes are WebM (`recorder.ts:16`), which some phones and apps may not play [unverified].
Fix: transcode via WebCodecs `VideoEncoder` (avc1) plus `AudioEncoder` into MP4 when supported, with a progress bar. Otherwise explain the limit.
Effort: L

### Export does not include metadata
Evidence: filenames carry only the name. WAV and WebM exports have no title or date tags.
Fix: write a LIST/INFO chunk (INAM name, ICRD date, ICMT notes) in `encodeWav`, and put tempo and tuning in ICMT.
Effort: S

### No intonation report export
Evidence: `reportView` renders to the DOM only (`recorder.ts:371-426`).
Fix: "Export report" as CSV (t, midi, note, cents) and a printable HTML summary via `window.print()` with the chart rendered to a PNG data URL.
Effort: S

### No zip export of multiple takes
Evidence: downloads are per take only (`recorder.ts:357`).
Fix: reuse the store-only zip encoder from gap 51, bundling selected takes with a `manifest.json` of names, notes, tags and reports.
Effort: S

### No cloud folder export
Evidence: everything is local (`recorder.ts:461`).
Fix: on Chromium desktop, `showDirectoryPicker()` to export into a user-chosen synced folder (Dropbox, OneDrive, Google Drive desktop clients) and remember the handle. Elsewhere, fall back to share or zip. No backend needed.
Effort: M

### No teacher feedback workflow on takes
Evidence: no comments model. TE for Education and BandLab offer assignment and feedback flows [unverified].
Fix: time-stamped comments `{t, author, text}` on the entry, and a "Send for feedback" zip containing the take plus comments.json. The teacher opens it by import, adds comments, and exports a `.resonare-feedback.json` that the student imports to merge comments by take id.
Effort: M

### No time-stamped self-comments
Evidence: only one name field per take (`recorder.ts:301`).
Fix: the comments model above, with a "Comment at 1:12" button during playback and comments shown as pins on the progress bar.
Effort: S

## Intonation report and analysis

### Reports are not saved
Evidence: `analyze()` renders into `analysisSlot` only (`recorder.ts:335`). A re-render or reload loses it.
Fix: store `report` (readings downsampled to 10 per second plus notes and stats) and `reportSettings` on the entry, and render it on mount without recomputing.
Effort: S

### Report note names ignore the transposing-instrument setting
Evidence: the recorder uses `frequencyToNote(p.frequency, tuning)` and `noteName(n.midi)` with no transposition (`recorder.ts:330,399`). `tuningOf` omits it (`settings.ts:197-199`), while the tuner applies `TRANSPOSITIONS` semitones (`tuner.ts:384`).
Fix: apply the same semitone offset from `TRANSPOSITIONS` to the displayed midi in `reportView`, and state "written pitch (B-flat)" in the report. Unit test a B-flat trumpet take.
Effort: S

### The report uses tuning at analysis time, not recording time
Evidence: `tuningOf(getSettings())` is read inside `analyze()` (`recorder.ts:320`).
Fix: store the tuning on the entry at record time (see take metadata) and offer "Analyse with current settings" as an explicit alternative.
Effort: S

### Analysis blocks the main thread with no progress or cancel
Evidence: `analyzeTake` runs synchronously after a 30 ms yield (`recorder.ts:323-334`). Its callback calls `detectPitch`, which is YIN (O(frame × maxTau)), every 1024 samples.
Fix: run it in the DSP worker with progress messages, a cancel button, and incremental readings for a live-filling chart.
Effort: M

### Quiet takes read as unvoiced because of a fixed gate
Evidence: `minRms: getSettings().sensitivity` (0.008 by default, `settings.ts:100`) is applied to raw samples (`recorder.ts:328`), and takes are not normalized (AGC is off).
Fix: before analysis, scale the samples so the 95th-percentile frame RMS is at 0.1, or set `minRms` relative to that percentile. Unit test a tone at -40 dBFS.
Effort: S

### Glides and note changes count against "In tune"
Evidence: `inTune` covers every voiced frame (`intonation.ts:71-72`), including transitions and scoops outside held notes.
Fix: compute `inTuneHeld` over frames inside `notes`, excluding the first 80 ms of each note, and show it as the headline, with the all-frames value as secondary.
Effort: S

### Sharp and flat errors cancel in the average
Evidence: `meanCents` is a signed mean (`intonation.ts:73`), so +20 and -20 gives 0 labelled "Average".
Fix: add `meanAbsCents` and the standard deviation to `TakeReport`, and relabel the signed value "Bias". Unit test on alternating ±20 readings.
Effort: S

### "Furthest from centre" ignores note length and includes attack scoops
Evidence: the list is sorted only by `|meanCents|` (`recorder.ts:374`). `segmentNotes` averages from the first point (`intonation.ts:102-109`), so the attack is included.
Fix: exclude the first 80 ms of each note from the means and drift, rank by `|meanCents| × sqrt(duration)`, and expose a minimum length.
Effort: S

### Note grouping splits notes that waver near the semitone boundary
Evidence: `segmentNotes` starts a new note whenever `r.midi !== cur.midi` (`intonation.ts:114`). A note at +48 cents that briefly reads -51 on the next semitone splits into short fragments that are then dropped.
Fix: hysteresis. Continue the current note if the reading is within 70 cents of its running mean frequency, and re-express the cents relative to the current midi. Unit test oscillation around +50.
Effort: S

### Fast passages produce an empty report
Evidence: `minSeconds = 0.25` (`intonation.ts:92`), which gives "No sustained notes were found" (`recorder.ts:405`).
Fix: keep 0.25 s for held notes, but add a "short notes" summary with `minSeconds = 0.08`, reporting median cents per short note and a count.
Effort: S

### No vibrato-aware analysis for takes
Evidence: `segmentNotes` averages the raw cents. Gap 44 covers only the live tuner display.
Fix: reuse the gap 44 vibrato detector on each held note's series, and report centre pitch plus vibrato rate and width per note in the chips and CSV.
Effort: S

### No rhythm or timing report against the click
Evidence: `analyzeTake` covers pitch only. The app knows click times but never compares onsets with them.
Fix: `detectOnsets` (spectral flux with adaptive threshold) in core, matched to the nearest grid time from `clickEpoch`, bpm and subdivision. Report mean offset (rushing or dragging), spread, and a scatter row on the chart. Unit test with synthetic onsets at ±20 ms.
Effort: M

### No dynamics or loudness report
Evidence: readings carry no level (`intonation.ts:46`).
Fix: add `db` per reading, draw a loudness lane under the pitch chart, and report dynamic range (95th minus 10th percentile) and note-to-note evenness for held notes.
Effort: S

### No tone steadiness or quality metrics
Evidence: `YIN` clarity is not kept in readings (`recorder.ts:328-331` discards everything but frequency).
Fix: keep `clarity`, and add spectral centroid per held note. Report the median clarity per note as "tone focus", clearly labelled as a relative measure, not a quality score.
Effort: S

### Pitch chart has no axes, labels or time ruler
Evidence: `reportView` draws a band, a centre line and dots only (`recorder.ts:407-424`).
Fix: y labels at ±tolerance and ±50, time ticks every 5 or 10 s, and note names drawn above each held note span.
Effort: S

### Chart is not interactive
Evidence: the canvas has no pointer handlers (`recorder.ts:372`).
Fix: tap to seek `audio.currentTime` to `x/w × duration`, a hover or press tooltip with note and cents, a playhead line during playback, and pinch zoom for long takes.
Effort: M

### Note chips do not seek
Evidence: the chips are plain spans with a `title` (`recorder.ts:396-400`).
Fix: make them buttons that seek to `n.start - 0.5` and play. Add the gap 27 loop over `[start, end]` when available.
Effort: S

### Chart does not redraw on resize or theme change
Evidence: it is drawn once in a single `requestAnimationFrame`, and colours are read via `cssVar` at draw time (`recorder.ts:407-424`).
Fix: a ResizeObserver on the canvas plus a theme-change subscription that call a stored `draw()`.
Effort: S

### Chart and report are not accessible
Evidence: the canvas has only `aria-label` (`recorder.ts:372`), and the colours of `good`/`sharp` chips carry meaning (`recorder.ts:398`).
Fix: a visually hidden table of held notes (note, start, mean cents, drift) and text "sharp" or "flat" in each chip, not colour alone.
Effort: S

### "In tune" colour class misused and threshold hard coded
Evidence: an in-tune percentage below 70% gets class `sharp` (`recorder.ts:381`), so a flat player's score is shown in the sharp colour. 0.7 is a magic number.
Fix: a neutral `warn` class and a threshold derived from settings or defined as a named constant.
Effort: S

### Only the 5 worst notes are shown
Evidence: `.slice(0, 5)` (`recorder.ts:374`).
Fix: a "Show all notes" expander listing every held note in time order with mean, drift and duration.
Effort: S

### No per-pitch-class summary for a take, and takes do not feed Tendencies
Evidence: `TakeReport` has no pitch class aggregation, and `addReading` (`intonation.ts:20`) is used only by the tuner.
Fix: `summarize(readings.reduce(addReading))` per take, shown as a mini tendencies bar. An "Add to my tendencies" button merges it into settings.
Effort: S

### No progress tracking across takes of the same piece
Evidence: reports are not stored or grouped.
Fix: with stored reports and `folderId` or `scoreId`, draw a line chart of in-tune (held) % and mean absolute cents over dates in the folder header.
Effort: M

### No comparison of a take's pitch contour with a reference recording
Evidence: none. Useful for matching a teacher's recording.
Fix: choose a reference take, align with DTW on chroma or pitch sequences, overlay both contours, and report per-note differences in cents.
Effort: L

### No tempo or key detection for imported recordings
Evidence: no import, and no tempo or key estimation in core. Anytune detects BPM [unverified].
Fix: tempo from onset autocorrelation (60 to 200 BPM) and key from a chroma histogram against Krumhansl profiles. Look up and cite the profile values from the original paper before coding. Pre-fill the take metadata.
Effort: M

### Analysis ignores the tuner's steadiness and clarity settings
Evidence: `detectPitch` is called with `sampleRate` and `minRms` only (`recorder.ts:328`), not the tuner threshold or instrument range.
Fix: pass the same `threshold`, `minFrequency` and `maxFrequency` the tuner uses (and the gap 11 instrument profile). Median-filter the readings over 3 frames before segmenting.
Effort: S

## Testing

### Recorder edge cases are not tested
Evidence: `scripts/e2e.mjs:265-290` covers only record, analyse and transpose on the happy path.
Fix: e2e checks for denied mic permission, a recorder that throws, a track ending mid-take, rename persistence across reload, delete, a video take without a camera (falls back to audio), and leaving the screen mid-take (the take is saved).
Effort: M

### No unit tests for stereo, long input or boundary behaviour of the DSP
Evidence: `tests/pitchshift.test.ts` covers the WAV header, stretch length and shifted frequency on short tones only.
Fix: tests for the tail energy after stretch, aliasing (above), clipping headroom, fractional semitones, and a 10-minute input completing under a time budget in the worker.
Effort: S
