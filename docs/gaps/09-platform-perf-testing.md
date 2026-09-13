# Platform, performance, testing and code gaps

This file lists 139 gaps. I stopped there because anything more would have been padding or a repeat of the existing 78 items. None of it is in `docs/gap-analysis.md`. Where an item builds on an existing one, it says so. Two things I found that bear on existing items:

- **Item 40 has the wrong bundle size.** It called the main bundle "17 KB", but the built `dist/assets/index-BeFWkRDq.js` is 127,277 bytes raw and 45,477 bytes gzipped at level 9 (rebuilt and measured with Node zlib on 2026-09-13; Vite reports 45.85 kB). Item 40 has been corrected.
- **The design spec is out of date.** `docs/superpowers/specs/2026-09-12-partial-design.md` lists "pitch-shifting of recordings" as not implemented, while README:59-61 and `recorder.ts:282` show it is.

Checked on the web this session:
- GitHub Pages cannot send custom headers: [community #54257](https://github.com/orgs/community/discussions/54257)
- WebKit "interrupted" AudioContext state: [W3C Audio Session](https://www.w3.org/TR/audio-session/), [WebKit bug 261554](https://bugs.webkit.org/show_bug.cgi?id=261554)
- Chrome timer throttling rules: [Chrome blog](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- The Cache API refuses 206 responses: [Workbox #1644](https://github.com/GoogleChrome/workbox/issues/1644)
- CVE-2024-4367 in pdf.js, fixed in 4.2.67: [GitLab advisory](https://advisories.gitlab.com/npm/pdfjs-dist/CVE-2024-4367/)
- Apple developer fee $99 a year: [Apple](https://developer.apple.com/programs/whats-included/)
- Google Play fee $25, one time: secondary sources only ([example](https://primetestlab.com/blog/google-play-developer-fee))
- Bubblewrap and assetlinks.json: [Bubblewrap README](https://github.com/GoogleChromeLabs/bubblewrap/blob/main/packages/cli/README.md)
- An App Store app is already called "Resonare": [App Store listing](https://apps.apple.com/us/app/resonare/id6752107210), and resonare.app is taken (the app has since been renamed to Partial). I saw these in search results but did not open the pages.

Anything else from outside the repo is marked [unverified].

---

## A. Web Audio robustness

### No handling of AudioContext state changes (interrupted or suspended)
Evidence: `src/audio/context.ts:7-26` creates the context and resumes it only when a feature starts. There is no `onstatechange` handler anywhere in `src`. WebKit has an "interrupted" state that the Audio Session API puts contexts into (W3C Audio Session; WebKit bug 261554). The metronome keeps saying `playing` while no sound comes out.
Fix: in `context.ts`, add `ctx.onstatechange` and export `onAudioState(fn)`. When the state is not `running` while the metronome, drones or tracker are active, show a "Audio paused, tap to resume" toast and call `ctx.resume()` on the next `pointerdown`. To verify, add an e2e check that runs `getContext().suspend()` through a debug hook and checks that the banner appears and playback resumes after a click.
Effort: S

### Visual beat timers keep firing while the audio clock is frozen
Evidence: `src/audio/scheduler.ts:117-121` turns `when - currentTime` into a wall-clock `setTimeout` once per event. If the context suspends, `currentTime` stops but those timers still fire, so the UI flashes beats that never sound.
Fix: on any change to a state other than `running`, clear `visualTimers` and pause `tick`. On return to `running`, rebuild the visual timers from the events still pending. Unit test with a stubbed context and `vi.useFakeTimers()`.
Effort: S

### Lookahead is too short for hidden or throttled tabs
Evidence: `scheduler.ts:103-104` uses a 0.12 s lookahead and a 25 ms interval. Chrome applies intensive throttling (timers checked once a minute) to pages that have been hidden for 5 minutes and silent for 30 seconds (Chrome blog). A gap trainer with long `muteBars`, or a slow click track with silent bars, can meet those conditions. Firefox and Safari behaviour is unverified.
Fix: on `visibilitychange`, raise the lookahead to about 2 s while `document.hidden` and schedule that far ahead (tempo changes then apply after the window). Verify by running a hidden tab for 6 minutes with a 4-bars-muted gap trainer and logging scheduled `when` gaps.
Effort: S

### Mic stays open while the page is hidden
Evidence: `pitchTracker.ts:294` loops on `requestAnimationFrame`, which pauses in hidden tabs, but the stream from `acquireMic` stays live. The OS recording indicator stays on and the mic keeps drawing power for nothing. Item 53 is about analysis cost, not releasing the device.
Fix: in `shared.ts`, stop every tracker on `visibilitychange` to hidden and on `pagehide`, and restart on visible if it was running. Show "Tuner paused while in background". Verify in Chrome that the tab's recording indicator disappears when the tab is backgrounded.
Effort: S

### No response when the mic track ends or is muted
Evidence: `context.ts:42` checks `readyState` only when the mic is acquired. Nothing listens for `ended` or `mute`, so unplugging a USB mic or the OS taking the device leaves the tuner silent with no message.
Fix: in `acquireMic`, attach `track.onended` and `onmute`/`onunmute` and emit through a listener set. `PitchTracker` shows an `errorBox` with "Microphone disconnected, Try again". Test by stubbing `getUserMedia` to return a track and dispatching `ended`.
Effort: S

### No input device choice and no devicechange handling
Evidence: `context.ts:45` asks for `{audio: {...}}` with no `deviceId`, and there is no `devicechange` listener. Musicians with interfaces or clip-on mics cannot pick them, and plugging in headphones or USB mics mid-session is ignored.
Fix: add `inputDeviceId` to `Settings` (`settings.ts:137`). After permission is granted, list devices with `navigator.mediaDevices.enumerateDevices()` and put a select in the tuning sheet. Pass `deviceId: {exact}` to `getUserMedia`. On `devicechange`, re-enumerate, and if the chosen device is gone, fall back to the default and show a toast.
Effort: M

### No output device selection
Evidence: `context.ts:9` always plays to the default output. `AudioContext.setSinkId` exists in Chromium [unverified for Safari and Firefox].
Fix: feature-detect `'setSinkId' in AudioContext.prototype`, add an "Output" select next to the input picker, and store `outputDeviceId`. Hide the control when the method is missing.
Effort: S

### Mic processing constraints are never confirmed
Evidence: `context.ts:45` asks for echoCancellation, noiseSuppression and autoGainControl off but never reads `track.getSettings()`. If a browser ignores the request, AGC silently distorts the level and clarity readings.
Fix: after acquiring, read `getSettings()` and `getCapabilities?.()`, and store them for the diagnostics panel (item 71 below). If any of the three are still true, show "Your browser is processing the microphone; readings may be less stable". Also request `channelCount: {ideal: 1}`.
Effort: S

### Low-note floor rises on 88.2 and 96 kHz devices
Evidence: `pitchTracker.ts:235` fixes `fftSize = 4096`, and `pitch.ts:45` caps `maxTau` at `frame.length / 2 = 2048`. The lowest detectable frequency is `sampleRate / 2048`: 23.4 Hz at 48 kHz but 46.9 Hz at 96 kHz. E1 (41 Hz), which README:89 advertises, would then be missed.
Fix: in `doStart`, set `fftSize` to the smallest power of two at or above `ctx.sampleRate * 0.085`, capped at 32768, and size `buffer` to match. Add unit tests in `tests/pitch.test.ts` running the E1 to C7 sweep at 44100, 88200 and 96000 Hz.
Effort: S

### Creating the mic source can fail when the mic rate differs from the context
Evidence: `pitchTracker.ts:233` calls `ctx.createMediaStreamSource(stream)` with no try/catch, and the context is created before the mic rate is known (`context.ts:9`). Firefox has rejected connecting nodes at different sample rates [unverified for current versions].
Fix: wrap it in try/catch. On failure, close and recreate the context with `new AudioContext({sampleRate: track.getSettings().sampleRate})`, rewire `master`, and retry once. Add a Firefox e2e case once item 57 lands.
Effort: S

### No limiter on the master bus
Evidence: `context.ts:10-11` connects `master` straight to `destination`. Woodblock noise peaks at `peak * 4` (`voices.ts:318`), each drone adds up to `0.25 * gain * volume` (`voices.ts:546`), and the poly layer adds another click at 0.8 (`metronome.ts:159`). Several drones plus accented clicks can clip.
Fix: insert `DynamicsCompressorNode` (threshold -3, knee 0, ratio 20, attack 0.003, release 0.1) between `master` and `destination`. Add a browser test that renders 4 drones plus accents in an `OfflineAudioContext` and asserts the absolute peak is at most 1.0.
Effort: S

### Click synthesis creates 2 to 5 nodes per click
Evidence: `voices.ts:258-299,302-395` builds new oscillators, filters and gains for every click. At 300 BPM with 6 subdivisions and poly, that is thousands of nodes a minute on phones, which costs CPU and garbage collection. This is unmeasured.
Fix: at startup or on sound change, pre-render each `(sound, level)` into an `AudioBuffer` with `OfflineAudioContext` and play clicks as one `AudioBufferSourceNode` plus a gain. This keeps the LOUDNESS table valid, since it is measured the same way. Verify with the Performance panel "Audio" track or `chrome://media-internals`, CPU at 300 BPM x6 before and after.
Effort: M

### Drone vibrato depth gain is never disconnected
Evidence: `voices.ts:522-536`. On a timbre change the vibrato oscillator is stopped and disconnected, but the local `depth` GainNode stays connected to `osc.detune`, with no reference kept. `Drone.stop` (`voices.ts:549-557`) also never disconnects `gain` from `master`.
Fix: keep `depth` as a field and disconnect it in `setTimbre`. In `stop`, schedule `setTimeout(() => this.gain.disconnect(), 500)`. Verify with a Chrome heap snapshot after 100 timbre changes: count `GainNode` instances.
Effort: S

### `resume()` has no timeout, so start can stall
Evidence: `context.ts:24` awaits `c.resume()` with no timeout. `metronome.ts:90-93` sets `pendingStart` before that await. If the promise never settles (reported on iOS outside a gesture [unverified]), start stays pending until the user taps stop.
Fix: `await Promise.race([c.resume(), timeout(1500)])`. If the state is still not `running`, throw `AudioBlockedError`, and have callers show "Tap to enable sound".
Effort: S

### `latencyHint` is fixed at interactive
Evidence: `context.ts:9`. Sustained drones do not need the smallest buffers, and small buffers glitch more on low-end Android [unverified].
Fix: add a settings option "Audio buffer: low latency / stable" that maps to `'interactive'` or `'playback'`. The context has to be recreated, so apply it on the next start. Show `ctx.baseLatency` next to it.
Effort: S

### Audio session type is not set for iOS
Evidence: there is no `navigator.audioSession` in `src` (grep). WebKit exposes `audioSession.type` (W3C Audio Session), which controls how audio mixes with other apps and with recording.
Fix: in `context.ts`, when available set `navigator.audioSession.type = 'playback'` while only output runs, and `'play-and-record'` while a tracker or recorder holds the mic. Check on a real iPhone whether the ringer switch still mutes clicks under each type [unverified].
Effort: S

### No Media Session integration
Evidence: grep finds no `mediaSession` in `src`. Headset buttons, lock-screen controls and keyboard media keys cannot start or stop the metronome or drones.
Fix: when the metronome starts, set `navigator.mediaSession.metadata = new MediaMetadata({title: '100 BPM 4/4', artist: 'Partial'})` and the `play`/`pause`/`stop` handlers mapped to `metronome.start/stop`. Update `playbackState` in `metronome.onState`. Note: Media Session UI may need an actual media element on some platforms [unverified].
Effort: S

### Recorder decodes whole takes into memory on the live context
Evidence: `recorder.ts:28-31` decodes the full blob with `getContext()`, and `mono()` (`recorder.ts:33-41`) allocates another copy. A 10-minute stereo take at 48 kHz is 600 x 48000 x 2 x 4 bytes = 230.4 MB, plus a 115.2 MB mono copy.
Fix: decode with `new OfflineAudioContext(1, Math.ceil(duration * 22050), 22050)` so the browser downmixes and resamples. Detection at 22.05 kHz still resolves E1, since maxTau is 538 samples for 41 Hz. For takes over 5 minutes, analyse in chunks. Add a test comparing report cents at 22.05 kHz and 48 kHz on the synthesized take in `tests/practice-tools.test.ts`.
Effort: M

### Pitch shifting and take analysis block the main thread
Evidence: `recorder.ts:282` runs `encodeWav(pitchShift(...))` and `recorder.ts:326-328` runs `detectPitch` over the whole take, both synchronously on the UI thread. That freezes the UI and can starve the metronome scheduler, which shares the thread.
Fix: add `src/workers/dsp.worker.ts` that imports `core/pitchshift` and `core/intonation`, call it with `new Worker(new URL('./workers/dsp.worker.ts', import.meta.url), {type: 'module'})`, and transfer the Float32Array. Show progress. Verify with the e2e transpose check plus a Long Tasks observer asserting no task over 200 ms.
Effort: M

### Recorder chunks live only in memory until stop
Evidence: `recorder.ts:119-127` pushes 1-second chunks into `recChunks` and writes to IndexedDB only in `finish`. A tab crash or iOS memory kill during a long video take loses everything.
Fix: append each `ondataavailable` chunk to a `pendingChunks` IndexedDB store keyed by take id. On startup, offer to recover takes found there. Bump `DB_VERSION` to 3 in `db.ts:41`.
Effort: M

## B. Memory and long sessions

### Sheet music page cache has no limit
Evidence: `sheetmusic.ts:50,329-345` caches a rendered canvas per `page|width|height` and clears only on open or resize (`:269`, `:558`). One page on a 390 px wide phone at DPR 3 is about 1170 x 1515 x 4 bytes = 7.1 MB, so paging through 100 pages keeps about 700 MB of canvases.
Fix: replace the Map with an LRU of 6 entries. On eviction set `canvas.width = 0`. Verify with `performance.memory` or a heap snapshot after paging 100 pages of a generated PDF (the e2e `makePdf` can make 100).
Effort: S

### pdf.js pages are never cleaned up after rendering
Evidence: `sheetmusic.ts:331-345` calls `doc.getPage(p)` and `render` but never `page.cleanup()`, so the worker keeps per-page operator lists and fonts.
Fix: call `page.cleanup()` after `render(...).promise` resolves, both in `renderPage` and in `makeThumb` (`:26-32`).
Effort: S

### No long-session soak test
Evidence: the e2e checks run for seconds (`e2e.mjs:189` plays 1.6 s). Nothing exercises an hour of tuner, metronome and drones, which is a normal practice session.
Fix: add `scripts/soak.mjs` that reuses the e2e CDP harness. Run tuner, metronome at 200 BPM x4 and 3 drones for 30 minutes, sample `Performance.getMetrics` JSHeapUsedSize, and count nodes every minute. Fail if the heap grows more than 20% after minute 5. Run it nightly with `schedule:` in a separate workflow.
Effort: M

### Theme colors and canvas size are read from layout every frame
Evidence: `recorder.ts` `drawLive` calls `fitCanvas` (reads `clientWidth`/`clientHeight`) and `cssVar` (`getComputedStyle`) on every animation frame, and so do `tuner.ts:143,150,485,491`. That forces style and layout work at 60 fps.
Fix: cache the palette in `dom.ts` (`palette()`, refreshed on `data-theme` change and `prefers-color-scheme` change) and cache sizes through a `ResizeObserver`. Measure with the Performance panel "Recalculate Style" count per second, before and after.
Effort: S

### A new object is allocated for every tracker frame
Evidence: `pitch.ts:25` says "allocates nothing per frame", but `pitchTracker.ts:281-292` builds a new `TrackerFrame` every rAF. That is small but steady garbage-collection pressure on phones.
Fix: reuse one mutable frame object and document that listeners must copy it. Update the comment in `pitch.ts`.
Effort: S

### Two tabs overwrite each other's settings and practice log
Evidence: `settings.ts:290-301` writes the whole in-memory `current` object to localStorage, and there is no `storage` event listener. With two tabs open, the second tab's next write clobbers the first tab's practice seconds, presets or tendencies.
Fix: in `settings.ts`, listen for `window.addEventListener('storage', e => { if (e.key === KEY) { current = mergeSettings(safeParse(e.newValue)); notify } })`. For counters (`logPractice`, tendencies), re-read localStorage inside `updateSettings` before merging. Add an e2e check that opens two targets, logs practice in both, and expects the sum.
Effort: S

### Practice time and tendencies are lost when the tab closes
Evidence: `shared.ts:37-44` logs metronome time only on stop, `droneBank.ts:324-331` logs only when drones stop, and `tuner.ts:214` flushes tendencies every 5 s. Closing or killing the tab mid-session drops that time.
Fix: on `pagehide` and on `visibilitychange` to hidden, flush `ActivityTimer`s, drone `soundingSince` and pending tendencies, then restart the timers from now. Check that `pageshow` with `persisted` (bfcache) resumes correctly.
Effort: S

### Only one tab should own the mic and audio
Evidence: nothing coordinates tabs. Two tabs can each run a metronome and hold the mic. `db.ts:58-62` already tells users to "Close that tab" when a version upgrade is blocked.
Fix: use `BroadcastChannel('partial')`. When a tab starts audio it posts `claim`, and other tabs stop their metronome, drones and trackers and show "Playing in another tab". Also add `"launch_handler": {"client_mode": "focus-existing"}` to the manifest.
Effort: S

## C. Bundle, build and loading performance

### Every screen except sheet music is in the main chunk
Evidence: `main.ts:13-19` imports tuner, metronome, sound, analysis, recorder, clicktrack and practice eagerly. The built main JS is 127,277 bytes raw, 45,362 gzip.
Fix: lazy-load `record`, `clicktrack`, `analysis` and `practice` with the same `lazySheetMusic` wrapper (`main.ts:26-43`, generalised to `lazy(() => import(...))`). Keep tuner and metronome eager. Compare `dist/assets` sizes before and after.
Effort: S

### Service worker precaches about 196 KB of font subsets the UI never uses
Evidence: `dist/precache.json` lists the Inter cyrillic-ext (25,960 bytes), cyrillic (18,748), greek-ext (11,232), greek (18,996), vietnamese (10,252) and latin-ext (85,068) files, plus Space Grotesk latin-ext (18,940) and vietnamese (6,712). The sum is 195,908 bytes. The UI is English only, and "è" in solfège is in the basic Latin subset (U+00E8). Browsers download only the needed subsets thanks to `unicode-range`, but `sw.js:13-15` precaches them all on install.
Fix: in `vite.config.ts` `generateBundle`, drop `/-(cyrillic|greek|vietnamese)(-ext)?-/` fonts from `precache.json`. Keep latin-ext until item 32 (i18n) decides. Or import only `@fontsource-variable/inter/wght.css` with a custom latin-only `@font-face`.
Effort: S

### The 1.7 MB sheet music stack is precached on the first visit
Evidence: `precache.json` includes `pdf.worker.min` (1,265,413 bytes raw, 374,166 gzip) and the `sheetmusic` chunk (442,498 raw, 131,316 gzip). Every tuner-only visitor downloads both on install.
Fix: split `precache.json` into `core` and `sheet`. The service worker caches `sheet` either when the app posts `{type: 'cache-sheet'}` the first time `#/sheet` mounts, or on idle 30 s after activation. Document the trade-off: sheet music is offline only after one visit or after the idle timer.
Effort: S

### No explicit build target matching the documented browser floor
Evidence: README:135 says Chrome 111, Safari 16.2, Firefox 113, but `vite.config.ts` has no `build.target`, so the output syntax level depends on the Vite 8 default [unverified value].
Fix: set `build: { target: ['chrome111', 'edge111', 'firefox113', 'safari16.2'] }` and add `npx es-check es2022 'dist/assets/*.js' --module` to CI. Note that syntax lowering does not polyfill APIs; see the next item.
Effort: S

### pdf.js 6.x may need newer APIs than Safari 16.2 provides
Evidence: `sheetmusic.ts:1` imports the modern `pdfjs-dist` build (6.3.289 installed). `node_modules/pdfjs-dist/legacy` exists. Whether the modern build runs on Safari 16.2 is unverified.
Fix: test on Safari 16.4 or earlier through the device matrix (item 56). If it fails, import `pdfjs-dist/legacy/build/pdf.mjs` and the legacy worker when `!('withResolvers' in Promise)` or a similar check, or raise the README floor for sheet music only.
Effort: M

### No bundle size budget
Evidence: `ci.yml` has no size check, and the numbers in the docs have already drifted (see the item 40 note at the top).
Fix: add `size-limit` (`.size-limit.json`: `dist/assets/index-*.js` 50 KB gzip, `index-*.css` 15 KB, `sheetmusic-*.js` 140 KB) and run `npx size-limit` in CI after the build. Or add a 20-line `scripts/sizes.mjs` that fails when a gzip size grows more than 5% over `sizes.json`.
Effort: S

### No Lighthouse CI
Evidence: there are no performance or best-practices gates in `ci.yml`.
Fix: add a `lighthouse` job running `npx @lhci/cli autorun` with `lighthouserc.json` (`staticDistDir: dist`, URLs `#/tuner` and `#/metronome`, assertions `categories:performance >= 0.9`, `accessibility >= 0.95`, `best-practices >= 0.95`, `total-byte-weight` budget). Upload reports as artifacts.
Effort: M

### No source maps for diagnosing user reports
Evidence: `dist` has no `.map` files and `vite.config.ts` does not set `build.sourcemap`. Stack traces from users (item 78's log) point into minified code.
Fix: set `build.sourcemap: 'hidden'`. The plugin already excludes `.map` from precache (`vite.config.ts:22`). Attach maps to the GitHub Release artifact instead of deploying them, and add a note in CONTRIBUTING on decoding with `npx source-map-cli`.
Effort: S

### Web font fallbacks are not metric-matched
Evidence: `styles.css:39` is `--font-display: 'Space Grotesk Variable', 'Inter Variable', system-ui`. When the woff2 swaps in, text reflows (layout shift), and nothing preloads the latin woff2.
Fix: add fallback `@font-face` rules (`font-family: 'Inter Fallback'; src: local('Arial'); size-adjust; ascent-override; descent-override`, values from `@capsizecss/metrics` or fontaine) and put them in the stacks. Add `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the Inter latin file through a small Vite `transformIndexHtml` hook. Verify CLS in Lighthouse.
Effort: S

### Dead exports are not detected
Evidence: `midiToEqualFrequency` (`notes.ts`) and `barDuration` (`rhythm.ts`) are referenced only in the files that define them (grep count 1).
Fix: add `knip` (`npx knip`) with `knip.json` entry `src/main.ts` and project `src/**/*.ts`. Run it in CI and remove or unexport what it reports.
Effort: S

## D. PWA manifest, icons and install

### No apple-touch-icon, and icons are SVG only
Evidence: `index.html:9` links only `/icon.svg`, and `manifest.webmanifest` has only SVG icons. iOS home-screen icons need a PNG `apple-touch-icon` [unverified that iOS ignores SVG manifest icons, but this is widely documented].
Fix: generate `public/apple-touch-icon.png` (180x180, opaque background) and add `<link rel="apple-touch-icon" href="./apple-touch-icon.png">`. Generator: `npx @vite-pwa/assets-generator --preset minimal-2023 public/icon.svg`.
Effort: S

### No PNG 192 and 512 icons, which Play and TWA need
Evidence: `manifest.webmanifest` icons are `sizes: "any"` SVG only. Bubblewrap and Play Store listings need raster icons, including a 512 px one [unverified exact requirement].
Fix: add `icon-192.png`, `icon-512.png` and `icon-maskable-512.png` (safe zone: content within the central 80%) to `public/` and the manifest with `purpose: "any"` and `"maskable"`. Validate in Chrome DevTools > Application > Manifest.
Effort: S

### Manifest has no `id`
Evidence: `manifest.webmanifest` has no `id`, so identity comes from `start_url`. Changing `start_url` later (for example to `#/practice`) would make browsers treat it as a different app.
Fix: add `"id": "./"`, and do it before public launch.
Effort: S

### Manifest has no screenshots
Evidence: there is no `screenshots` array. Chromium's richer install dialog uses them [unverified current UI].
Fix: add 2 `form_factor: "narrow"` (1080x2340) and 2 `"wide"` (1920x1080) PNG or WebP files in `public/screenshots/`, taken by a script from the e2e harness (`Page.captureScreenshot`) so they stay current.
Effort: S

### Manifest has no shortcuts
Evidence: there is no `shortcuts` array. A long press on the installed icon cannot jump to Metronome or Record.
Fix: add `"shortcuts": [{"name": "Metronome", "url": "./#/metronome", "icons": [...]}, {"name": "Tuner", "url": "./#/tuner"}, {"name": "Record", "url": "./#/record"}, {"name": "Sheet music", "url": "./#/sheet"}]` with 96 px PNG icons.
Effort: S

### Manifest is missing categories, lang, dir and orientation
Evidence: `manifest.webmanifest` has none of these keys.
Fix: add `"categories": ["music", "education", "utilities"], "lang": "en", "dir": "ltr"`. Leave `orientation` unset, since landscape is wanted for sheet music (see item 64).
Effort: S

### Theme and splash colors disagree
Evidence: the manifest has `theme_color: #6a5ae0` and `background_color: #090b0f`, while `index.html:7-8` uses `#f4f5f8` (light) and `#090b0f` (dark). Light-mode users get a dark splash screen and a purple title bar that changes on load.
Fix: set manifest `theme_color` to `#090b0f`, or use a neutral value. There is no media query in the manifest, so pick the dark palette consistently, or pick light and accept a dark flash. Document the choice.
Effort: S

### No iOS standalone meta tags or launch images
Evidence: `index.html` has no `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title` or `apple-touch-startup-image`, and uses `viewport-fit=cover` (`:5`).
Fix: add `<meta name="apple-mobile-web-app-title" content="Partial">` and `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`. Generate launch images with `@vite-pwa/assets-generator` (it emits the per-device `media` queries). Check the safe-area padding in `styles.css` on a notched iPhone.
Effort: S

### No way to open or receive PDFs from the OS
Evidence: the manifest has no `file_handlers` or `share_target`. Sheet music import is only through the file input or drag and drop (`sheetmusic.ts:58-80`). Item 29 covers exporting, not receiving.
Fix: add `"share_target": {"action": "./share", "method": "POST", "enctype": "multipart/form-data", "params": {"files": [{"name": "score", "accept": ["application/pdf"]}]}}`. In `sw.js`, handle `POST ./share`: store the file in IndexedDB, then `Response.redirect('./#/sheet?import=pending', 303)`. Add `"file_handlers": [{"action": "./#/sheet", "accept": {"application/pdf": [".pdf"]}}]` with `window.launchQueue` handling in `sheetmusic.ts`. Both are Chromium-only [unverified for Safari].
Effort: M

### No raster favicon and no social preview meta
Evidence: `index.html:9` has an SVG favicon only, and there are no `og:`/`twitter:` meta tags, so shared links show no preview.
Fix: add `favicon-32.png` and `<link rel="icon" sizes="32x32">`, plus `og:title`, `og:description` and `og:image` (1200x630 PNG in `public/`). Validate with a link preview debugger after deploy.
Effort: S

### No explainer before the microphone permission prompt
Evidence: `context.ts:44` calls `getUserMedia` straight from the tuner tap. On iOS a denial is hard to undo (Settings > Safari) [unverified exact flow].
Fix: the first time the mic is requested (new setting `micExplained`), show a sheet: "Partial listens only on this device to detect pitch. Nothing is recorded or sent." with a Continue button, then call `getUserMedia`. If denied, show platform-specific steps.
Effort: S

### MIDI permission may be requested at startup without a gesture
Evidence: `main.ts:217` calls `restoreMidi()` on load, which calls `navigator.requestMIDIAccess()` (`controls.ts:99`). If the browser gates Web MIDI behind a prompt [unverified for current Chrome], users get a prompt at launch with no context.
Fix: in `restoreMidi`, check `navigator.permissions.query({name: 'midi'})` first and call `enableMidi()` only when the state is `granted`. Otherwise show "Reconnect MIDI" on the Practice screen.
Effort: S

## E. Service worker

### Precache failure is swallowed and old caches are still deleted
Evidence: `sw.js:13-18` catches any failure of `cache.addAll(files)`. `addAll` is atomic, so one failed file (for example the 1.2 MB worker on a flaky connection) leaves only `CORE` cached. Install still succeeds, and `activate` (`sw.js:27-29`) deletes the previous complete cache, so offline breaks silently.
Fix: rethrow when `precache.json` was fetched but `addAll` failed. Keep swallowing only the "precache.json missing" dev case. The browser then retries install later and the old worker stays. Add an e2e check that serves a 500 for one asset and asserts the old service worker is still active and offline still works.
Effort: S

### Cache version ignores changes to public files
Evidence: `vite.config.ts:22-23` hashes only the bundle file names. If only `manifest.webmanifest`, `icon.svg` or `icon-maskable.svg` change, the build id and `sw.js` stay byte-identical, so no update installs and cache-first (`sw.js:56-67`) serves the stale manifest and icons forever.
Fix: in `closeBundle`, hash the contents of every file in `outDir` (excluding `sw.js`), not just the names. Unit test the plugin by building twice with a changed `public/manifest.webmanifest` and asserting the `CACHE` string differs.
Effort: S

### Runtime caching throws on 206 responses
Evidence: `sw.js:61-63` caches when `res.ok`, which is true for 206. The Cache API rejects 206 responses (Workbox #1644), and the promise has no catch, so it becomes an unhandled rejection. This will happen once samples or media are served (items 1, 40).
Fix: `if (res.status === 200 && res.type === 'basic') caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {})`. For range requests (`req.headers.has('range')`), bypass the cache or use a range plugin approach.
Effort: S

### Runtime cache stores any same-origin GET
Evidence: `sw.js:56-67` caches every same-origin GET, including query-string variants, and nothing trims it within a build.
Fix: runtime-cache only paths under `./assets/` or in the precache list (send it in with the next item). Pass everything else through to the network.
Effort: S

### Navigations have no network timeout
Evidence: `sw.js:38-50` is network-first with no timeout. On a weak connection, app launch waits for the browser's own timeout before falling back to cache.
Fix: `Promise.race([fetch(req), timeout(3000)])`, falling back to `caches.match('./index.html')`. Alternative: serve the cached shell immediately and revalidate in the background.
Effort: S

### A new index.html is written into the old build's cache
Evidence: `sw.js:43-45`. After a deploy, the old worker's network-first navigation stores the new `index.html` (which references new hashed assets) into the old `CACHE`, which lacks those assets. If the network then drops before the new worker activates, the offline launch loads HTML whose scripts are not cached, and the app is blank.
Fix: only write the navigation response into the cache if every `assets/*` URL it references is present, or never overwrite the shell from navigation and let each build's install own `index.html`. Add an e2e check: deploy build A, load, rebuild as B, load online once, go offline, reload, and assert the app renders.
Effort: M

### precache.json is fetched separately from sw.js
Evidence: `sw.js:14` fetches `./precache.json` during install. During a deploy it can come from a different build than the `sw.js` being installed.
Fix: in `closeBundle`, replace a `__PRECACHE__` placeholder in `sw.js` with the JSON array and delete `precache.json`. This also makes the first item in this section deterministic.
Effort: S

### Navigation preload is not enabled
Evidence: `sw.js` never calls `registration.navigationPreload.enable()`, so network-first navigations wait for service worker startup before the request goes out.
Fix: in `activate`, `await self.registration.navigationPreload?.enable()`. In the navigation branch, use `(await event.preloadResponse) || fetch(req)`.
Effort: S

### Installed apps that stay open never check for updates
Evidence: `main.ts:239-244` registers once on `load`. An installed PWA left open for days only checks on navigation. Item 61 covers the prompt, not the check.
Fix: call `registration.update()` on `visibilitychange` to visible (at most once an hour), and pass `{updateViaCache: 'none'}` to `register`.
Effort: S

### Activate deletes other apps' caches on a shared origin
Evidence: `sw.js:27-29` deletes every cache whose key is not `CACHE`. On GitHub Pages project sites, every repo of that user shares the origin `username.github.io`, so this wipes other projects' caches.
Fix: `keys.filter(k => k.startsWith('partial-') && k !== CACHE)`.
Effort: S

### No tests for service worker update, failure or eviction
Evidence: the only offline check (`e2e.mjs:347-359`) covers a single build. Update, partial precache and rollback are untested.
Fix: add an e2e suite that builds to `dist-a`/`dist-b` with an env-injected marker, serves them from a tiny Node static server that can switch roots, and checks: an update waits, the item 61 toast, `SKIP_WAITING`, offline after update, a failing asset leaves the old worker, and a changed manifest updates.
Effort: M

### sw.js is not type-checked
Evidence: `tsconfig.json` includes only `src` and `tests`, so `public/sw.js`, `vite.config.ts` and `scripts/e2e.mjs` are unchecked.
Fix: add `// @ts-check` and `/// <reference lib="webworker" />` to `sw.js`, and a `tsconfig.sw.json` (`lib: ["ES2022", "WebWorker"]`, `allowJs`, `checkJs`, `include: ["public/sw.js"]`). Add `tsconfig.node.json` for `vite.config.ts` and `scripts`. Run `tsc -p` for each in `npm run typecheck`.
Effort: S

## F. Security

### No Content Security Policy
Evidence: `index.html` has no CSP, and GitHub Pages cannot send custom headers (community #54257). The app loads user PDFs through pdf.js, which had an arbitrary-JS bug (CVE-2024-4367).
Fix: add `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' blob: data:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'">`. `'unsafe-inline'` styles are needed because `dom.ts:127` sets `style` attributes. `frame-ancestors` is ignored in meta, so it must be a header on the host (see the hosting items). Verify with an e2e listener on `securitypolicyviolation` that fails the run.
Effort: M

### pdf.js is used with eval enabled
Evidence: `sheetmusic.ts:23` and `:262` call `pdfjs.getDocument({data})` with defaults. The installed 6.3.289 is past the 4.2.67 fix for CVE-2024-4367, but `isEvalSupported: false` removes that whole code path and is required for a strict CSP.
Fix: pass `{data, isEvalSupported: false, enableXfa: false}` in both calls, and put them in one `openPdf(data)` helper.
Effort: S

### No resource limits for untrusted PDFs
Evidence: `getDocument` calls set no `maxImageSize` or `canvasMaxAreaInBytes` (both options exist in `node_modules/pdfjs-dist/types/src/display/api.d.ts`). A crafted or huge scanned PDF can exhaust memory on phones.
Fix: set `maxImageSize: 64_000_000` and `canvasMaxAreaInBytes: 64_000_000` in `openPdf`. In `renderPage` (`sheetmusic.ts:335-340`), cap `scale * dpr` so width x height stays under 16,777,216 px. That cap is a common iOS canvas limit [unverified exact value].
Effort: S

### pdf.js is missing CMaps, standard fonts and decoder assets
Evidence: `getDocument` sets no `cMapUrl`, `standardFontDataUrl`, `wasmUrl` or `iccUrl` (all exist in `api.d.ts`), and `node_modules/pdfjs-dist/cmaps`, `standard_fonts` and `iccs` are not copied into `dist`. PDFs with non-embedded standard fonts or CJK CMaps can render with wrong glyphs, and the service worker could not serve those files offline anyway.
Fix: copy those folders with a Vite plugin (`vite-plugin-static-copy`, or a `closeBundle` copy in the existing plugin) to `dist/pdfjs/`. Pass `cMapUrl: './pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: './pdfjs/standard_fonts/'`, plus `wasmUrl` if `pdfjs-dist` ships a wasm folder in the chosen version (none is in this install's root listing). Cache them lazily in the "sheet" precache group. Test with a PDF that uses non-embedded Helicat, which the e2e `makePdf` already produces (`e2e.mjs:298`).
Effort: M

### Backup import accepts arbitrary shapes and can break the app on every launch
Evidence: `practice.ts:279-281` only checks `'a4' in data`, then `mergeSettings(data)` (`settings.ts:264-271`) spreads unknown keys and wrong types (for example `metronome.accents: "x"`, `clickTracks: {}`, `a4: "abc"`). They are persisted immediately (`settings.ts:296`) and read by every view on each load.
Fix: write `validateSettings(raw): Settings` in `src/store/schema.ts` that coerces or clamps each field (numbers finite and in range, enums from the literal unions, arrays of valid items) and drops unknown keys. Use it in both `load()` and import. Property-test with fast-check `fc.anything()` that the result always satisfies the type guards, and render each view in happy-dom with that output.
Effort: M

### No recovery from corrupted settings at boot
Evidence: `settings.ts:273-280` recovers only from JSON errors. `main.ts` mounts with no try/catch, so settings that parse but crash a view leave a blank page on every launch.
Fix: wrap the boot in `main.ts` in try/catch. On failure, render a minimal page with "Something went wrong at startup", "Export my data" (raw localStorage as a download) and "Reset settings". Also support `#/reset` to do the same.
Effort: S

### icons.ts builds SVG through innerHTML
Evidence: `icons.ts:59` sets `tpl.innerHTML` with `className` interpolated. Inputs are internal today, but this blocks enabling Trusted Types (`require-trusted-types-for 'script'`).
Fix: parse `PATHS` once at module load with `DOMParser` (`image/svg+xml`), clone the nodes per call, and set `class` with `setAttribute`.
Effort: S

### No Dependabot or Renovate config
Evidence: `.github/` contains only `workflows/ci.yml`. `package.json` uses caret ranges (`^7.0.2`, `^8.3.0`, `^6.3.289`).
Fix: add `.github/dependabot.yml` with the `npm` (weekly, grouped dev dependencies) and `github-actions` (weekly) ecosystems. Or use Renovate with `config:recommended` and `rangeStrategy: pin` for devDependencies.
Effort: S

### GitHub Actions are pinned by tag, not commit SHA
Evidence: `ci.yml:15,16,25,40` use `actions/checkout@v7`, `setup-node@v7`, `upload-pages-artifact@v5` and `deploy-pages@v5`. I did not check that these tags exist; item 58 says CI has never run.
Fix: pin each to a full commit SHA with a version comment (`pinact run` or `npx pin-github-action .github/workflows/ci.yml`) and let Dependabot's github-actions ecosystem bump them. Verify the tags exist on the first run.
Effort: S

### No dependency audit in CI
Evidence: `ci.yml` runs `npm ci`, test, build and e2e only.
Fix: add `npm audit --audit-level=high --omit=dev` (runtime dependencies block), `npm audit signatures` (registry provenance), and a non-blocking full `npm audit`.
Effort: S

### No CodeQL or OpenSSF Scorecard
Evidence: there is no code scanning workflow.
Fix: add `.github/workflows/codeql.yml` (language `javascript-typescript`, on push and weekly) and `scorecard.yml` (`ossf/scorecard-action`), and put the Scorecard badge in the README.
Effort: S

### No SECURITY.md
Evidence: the repo root has only `LICENSE` and `README.md`.
Fix: add `SECURITY.md` with the supported version (latest deploy), GitHub private vulnerability reporting (enable it under Settings > Code security), a response target, and scope (PDF parsing, backup import, service worker).
Effort: S

### Deploys can race
Evidence: the `ci.yml` deploy job has no `concurrency` key, so two quick pushes can deploy out of order.
Fix: add `concurrency: { group: pages, cancel-in-progress: false }` to `deploy`, and `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }` to `build` for PRs.
Effort: S

### CI jobs have no timeout, and e2e CDP calls can hang forever
Evidence: `ci.yml` has no `timeout-minutes`. In `e2e.mjs:91`, `send()` never rejects if the browser crashes or a message is lost.
Fix: set `timeout-minutes: 15` on `build`. In `send`, reject after 30 s with the method name, and handle `ws.onclose` by rejecting all pending calls and exiting 1.
Effort: S

### No Permissions-Policy or other security headers
Evidence: no header config exists for any host. The app uses the mic, camera and MIDI and should deny everything else.
Fix: on a host that supports headers (see hosting below), add `public/_headers`: `Permissions-Policy: microphone=(self), camera=(self), midi=(self), fullscreen=(self), screen-wake-lock=(self), geolocation=(), payment=(), usb=()`, plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `Content-Security-Policy` with `frame-ancestors 'none'`, and `Cache-Control: no-cache` for `/sw.js` and `/index.html`. Verify with `curl -I`.
Effort: S

## G. TypeScript, lint and formatting

### `noUncheckedIndexedAccess` is off
Evidence: `tsconfig.json` has `strict` but not `noUncheckedIndexedAccess`. Code indexes arrays and records directly, for example `routes[0]` (`router.ts:13`), `practiceLog[d] / 60` (`practice.ts:257`), `TIMBRES[timbre] ?? TIMBRES.organ` (`voices.ts:450`).
Fix: enable it, fix the errors it reports (count them first with `npx tsc --noEmit | grep -c error`), then keep it on.
Effort: M

### Other strictness flags are off
Evidence: `tsconfig.json` lacks `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns` and `verbatimModuleSyntax` (it has `isolatedModules`).
Fix: turn them on one at a time in separate commits. `verbatimModuleSyntax` makes `import type` mandatory, which suits the current type-only imports (`settings.ts:1-7`).
Effort: S

### No linter, so floating promises go unchecked
Evidence: there is no eslint or oxlint config. There are many `void promise` calls and async event handlers (`practice.ts:276`, `sheetmusic.ts:66`), 8 non-null `!.` uses, and 10 empty `catch {}` blocks, some of which hide real failures (`sheetmusic.ts:275`, `:448`).
Fix: add `eslint.config.js` with `typescript-eslint` `strictTypeChecked` plus `no-floating-promises`, `no-misused-promises` and `no-empty` (with `allowEmptyCatch: false`, and a comment required where intended). Caveat: the repo uses TypeScript 7.0.2 (the Go-native compiler), and typescript-eslint's type-aware rules depend on the TypeScript JS API [unverified compatibility with 7.x]. If they don't work, use `oxlint` (the oxc toolchain is already present through rolldown) for the syntactic rules. Run it in CI.
Effort: M

### No formatter and no editorconfig
Evidence: lines exceed 250 characters (`main.ts:175`, `e2e.mjs:298`), and there is no `.prettierrc`, `biome.json` or `.editorconfig`.
Fix: add Prettier (`printWidth: 140`, `singleQuote: true`) or Biome, with `npm run format` and `format:check` in CI. Add `.editorconfig` (`charset = utf-8`, `end_of_line = lf`, `insert_final_newline = true`).
Effort: S

### UTF-8 BOMs in source and workflow files
Evidence: `.github/workflows/ci.yml` starts with bytes EF BB BF (checked with `od`), and `src/main.ts:1` begins with a BOM before `import`. That is probably a Windows editor artifact. Tools vary in how they treat a BOM [unverified for the GitHub Actions YAML parser].
Fix: strip them (`sed -i '1s/^\xEF\xBB\xBF//' .github/workflows/ci.yml src/main.ts`), set `charset = utf-8` (not `utf-8-bom`) in `.editorconfig`, and add a CI grep that fails on `\xEF\xBB\xBF`.
Effort: S

### No .gitattributes
Evidence: development happens on Windows (`e2e.mjs:49` uses taskkill), and there is no `.gitattributes`. CRLF commits would change `sw.js` bytes and diffs across platforms.
Fix: `.gitattributes` with `* text=auto eol=lf`, `*.woff2 binary`, `*.png binary`. Then run `git add --renormalize .`.
Effort: S

### No engines field or Node version file
Evidence: `package.json` has no `engines` or `packageManager`. CI uses Node 24 (`ci.yml:18`), locally Node v24.14.1 and npm 11.11.0.
Fix: add `"engines": {"node": ">=24"}`, `"packageManager": "npm@11.11.0"` and `.nvmrc` containing `24`, and point `setup-node` at `node-version-file: .nvmrc`.
Effort: S

### No pre-commit hooks
Evidence: no husky or lefthook config, so typecheck and lint only run in CI, which has never run.
Fix: add `lefthook.yml` with `pre-commit` running `npx tsc --noEmit`, the linter on staged files, and `vitest related --run {staged_files}`.
Effort: S

## H. Unit, property, mutation, visual and accessibility tests

### rhythm.ts helpers are untested
Evidence: `clampBpm`, `accentFor`, `defaultAccents` and `barDuration` are exported from `src/core/rhythm.ts` and appear in no test (grep of `tests/`).
Fix: in `tests/rhythm.test.ts`, test `clampBpm` with NaN, Infinity, below `MIN_BPM` and above `MAX_BPM`; `accentFor` when `accents.length < beatsPerBar`; `defaultAccents` for 6/8, 7/8, 5/4; and `barDuration` with `beatUnit` 8 against the definition.
Effort: S

### notes.ts global notation state is untested
Evidence: `setNotation`, `mod` and `midiToEqualFrequency` are untested. `setNotation` mutates module state (`settings.ts:283,294`), so test order could leak naming changes between tests.
Fix: add tests for `mod(-1, 12) === 11`, `midiToEqualFrequency(69) === 440`, and `setNotation('german')` changing `noteName(71)` to H. Add `afterEach(() => setNotation('english'))`, or refactor `noteName` to take the notation as a parameter.
Effort: S

### Small pure helpers are untested
Evidence: `clefFor` (`staff.ts`), `fft` (`spectrum.ts`), `rms` (`pitch.ts`) and `uid` (`format.ts`) are not referenced in `tests/`.
Fix: test `clefFor` at the boundary MIDI note; `fft` against Parseval's theorem and a sine landing in bin k with a power-of-two input, plus the behaviour for non-power-of-two length; `rms` of a full-scale sine being about 0.7071; and `uid` giving 10,000 unique ids of the expected format.
Effort: S

### store/settings.ts is untested
Evidence: `mergeSettings`, `updateSettings`, `subscribeSettings` and `logPractice` have no tests. `logPractice` has a 24 h guard (`settings.ts:315`) and day keys.
Fix: add `tests/settings.test.ts` with `// @vitest-environment happy-dom` (add `happy-dom` as a devDependency). Cover the nested merge for `metronome`/`drone`, persistence to localStorage, localStorage throwing (quota), the `logPractice` guard, and the per-activity sums. Use `vi.setSystemTime` for the day key.
Effort: S

### store/db.ts is untested
Evidence: there is no IndexedDB test. The v1 to v2 upgrade, `onblocked`, `onversionchange` and `deleteAnnotationsFor` are unverified.
Fix: add the `fake-indexeddb` devDependency and `import 'fake-indexeddb/auto'`. Test creating v1 with only `recordings` then opening v2 (stores and index exist), put/get/list/delete, `deleteAnnotationsFor` removing only that score, and a blocked open rejecting with the message and resetting `dbPromise`.
Effort: M

### The metronome event generator is untested
Evidence: the `next()` closure in `metronome.ts:108-145` holds count-in (negative bars), subdivision and beat rollover, `stopAfterBars`, and trainer stepping through `onBarComplete`. Only an e2e triplet-gap check covers any of it (`e2e.mjs:182-196`).
Fix: move it into `src/core/rhythm.ts` as `metronomeEvents(getSettings, seed, onBar)`, a pure iterator, and test it: 2 count-in bars in 3/4 give 6 accent/normal events with `countIn: true`; `stopAfterBars` 2 ends after the right event; a tempo change mid-beat applies from the next beat; the trainer at 1-bar steps reaches the max and stops.
Effort: M

### LookaheadScheduler is untested
Evidence: `scheduler.ts` has no tests.
Fix: add `tests/scheduler.test.ts` with a fake `{currentTime}` object and `vi.useFakeTimers()`. Check that events inside the horizon are scheduled at the right `when`; `stop()` clears the visual timers (no `onVisual` after stop); `onEnd` fires about 300 ms after the last event; and a restart calls `stop` first.
Effort: S

### Pitch tracker smoothing and state are untested
Evidence: the hold, idle-frame skipping, gating and EMA logic in `pitchTracker.ts:242-293` runs only inside a rAF loop bound to an `AnalyserNode`.
Fix: extract `class TrackerCore { process(buffer, sampleRate, now, audioTime): TrackerFrame }` into `src/core/`. Test that a held reading lasts `holdMs` then clears; the idle case analyses every other frame; a gated frame keeps `last`; and a note jump resets `displayCents` (not the EMA).
Effort: M

### Drone ownership and races are untested
Evidence: `droneBank.ts:349-357` re-checks `active.has` after awaiting and returns ownership. The race and the practice-log timing (`notify`, `:324-331`) are untested.
Fix: mock `./context` (`ensureRunning` resolving on a controlled promise, `getMaster`) and `./voices` (`Drone` stub). Test that two concurrent `noteOn(60)` calls create one drone and resolve `[true, false]`, and that `stopAll` logs elapsed seconds once.
Effort: S

### Mic reference counting is untested
Evidence: `context.ts:35-67` (shared in-flight request, refcount, error mapping) has no tests.
Fix: stub `navigator.mediaDevices.getUserMedia` and `window.isSecureContext`. Test that concurrent `acquireMic` calls use one `getUserMedia`; release twice stops tracks only on the last; `NotAllowedError` maps to `MicError('denied')`; and an insecure context throws `'insecure'`.
Effort: S

### DOM helper h() and the router are untested
Evidence: `dom.ts:113-137` picks between property and attribute (`key in el && !key.includes('-')`), which matters for `selected`, `for`, `hidden` and `aria-*`. `router.ts:9-25` cleanup and fallback are untested.
Fix: add `tests/dom.test.ts` (happy-dom). `h('label', {for: 'x'})` should set the `for` attribute, `h('option', {selected: true})` should set `.selected`, `false`/`null` props should be skipped, and `on*` should attach listeners. For the router, a hashchange calls the previous cleanup once, and an unknown path mounts `routes[0]`.
Effort: S

### Keyboard shortcuts and MIDI dispatch are untested
Evidence: `controls.ts` (`installGlobalShortcuts`, `runAction`, `learnNextTrigger`) is not in `tests/`. Only `core/midi.ts` parsing is tested.
Fix: in happy-dom, dispatch keydown `m`, `d`, `1` and `?` and assert the calls on mocked `metronome.toggle`, `stopAll` and `location.hash`. Check that key events from an `<input>` are ignored. Feed a fake `MIDIMessageEvent` into the wired `onmidimessage` and assert `runAction`.
Effort: S

### Sheet dialog focus handling is untested
Evidence: `components.ts:109-146` focuses the first control and restores focus on close, but there is no Tab focus trap (only Escape is handled at `:125-130`), and none of it is tested.
Fix: add tests that open a sheet, check `document.activeElement` is inside it, Escape closes it and restores focus, and opening a second sheet closes the first. Add a Tab and Shift+Tab trap and test it too. This is automated testing, distinct from the manual screen-reader item 52.
Effort: S

### No coverage reporting or thresholds
Evidence: `package.json` has no `@vitest/coverage-v8`, and `vite.config.ts` `test` has only `include`.
Fix: add `@vitest/coverage-v8`, set `test.coverage: {provider: 'v8', include: ['src/core/**', 'src/store/**', 'src/audio/**'], thresholds: {lines: 80, branches: 70}}`, add a `test:coverage` script, run it in CI and upload `coverage/` as an artifact.
Effort: S

### No property-based tests
Evidence: all 82 tests are example-based (counted `it(`/`test(` in `tests/*.ts`).
Fix: add the `fast-check` devDependency and properties in `tests/properties.test.ts`:
- `detectPitch` on a sine at any f from 45 to 2000 Hz, any phase and amplitude 0.05 to 1 is within 1 cent.
- `expandClickTrack` total duration equals the sum of `sectionSpans`.
- `simplify` keeps the first and last points and returns a subsequence of the input.
- `timeStretch` output length is about the input length times the ratio.
- Temperament offsets repeat every 12 semitones.
- `mergeSettings(validate(x))` never throws.
Effort: M

### No mutation testing
Evidence: nothing measures whether the tests would catch changes to `src/core`.
Fix: add `@stryker-mutator/core` and `@stryker-mutator/vitest-runner`, with `stryker.config.json` `mutate: ["src/core/**/*.ts"]`, `thresholds: {high: 80, low: 60, break: 50}`. Run it weekly in a scheduled workflow, since it is slow, and publish the HTML report as an artifact.
Effort: M

### e2e timing capture misses oscillator-based clicks
Evidence: `e2e.mjs:185` declares `origO = OscillatorNode.prototype.start` but never patches or uses it. Only `AudioBufferSourceNode.start` times are recorded. That works for the default `wood` click, which uses noise, but a tone-only sound (`beep`, `digital`, `tick`, `clave`, `marimba`, `bell`) would record nothing, and the check would fail for the wrong reason.
Fix: patch `OscillatorNode.prototype.start` as well, dedupe by `when.toFixed(4)` as it already does, and loop the check over all 16 `CLICK_SOUNDS`.
Effort: S

### e2e harness is brittle and checks depend on each other
Evidence: `e2e.mjs` uses fixed sleeps (`:117-129`, `:155` 900 ms per screen), fixed ports 4180 and 9340 (`:9-10`) that collide with parallel runs, a shared browser profile, a check that depends on an earlier one (`:321-345` needs E2E.pdf imported at `:295-319`), no failure screenshots, and only `Runtime.exceptionThrown` is captured (`:87`).
Fix: move to `@playwright/test` with a fresh `browserContext` per test, `webServer: {command: 'npx vite preview --port 0'}`, `trace: 'retain-on-failure'`, `retries: 1` in CI only, and `page.on('console')` failing on `error` level. Keep the synthesized mic as a fixture. This also gives Firefox and WebKit projects for item 57.
Effort: L

### e2e never runs at a phone viewport
Evidence: `e2e.mjs:100` emulates only 1280x900 non-mobile, so the tab bar, the "More" sheet (`main.ts:77-91`), the dock and `(max-width: 640px)` styles (`styles.css:300`) are never exercised.
Fix: add a second pass with `Emulation.setDeviceMetricsOverride({width: 390, height: 844, deviceScaleFactor: 3, mobile: true})` and `Emulation.setTouchEmulationEnabled`. At minimum run "all screens render" through the tab bar and More sheet, and check no element overflows horizontally (`document.documentElement.scrollWidth <= innerWidth`).
Effort: S

### No visual regression tests
Evidence: 3,759 lines of CSS (`styles.css`) and two themes, with no screenshot tests.
Fix: use Playwright `expect(page).toHaveScreenshot()` for 8 routes x light/dark x 390/1280 widths, plus `reducedMotion: 'reduce'` and `forcedColors: 'active'` variants for the tuner. Mask animated regions (ring, beat blocks). Store baselines in `tests/visual/__screenshots__` and update them with `--update-snapshots` in a labelled PR.
Effort: M

### No automated accessibility checks
Evidence: there are no axe runs. Item 52 is about manual VoiceOver and TalkBack testing.
Fix: add `@axe-core/playwright` and run `new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()` on each route and with each sheet open (tuning, help, more, intro). Fail on `serious` or `critical`.
Effort: S

### No DSP performance regression tests
Evidence: README and item 53 cite about 1 ms per frame on one desktop, and nothing tracks regressions. `tinybench` is already in `node_modules` through vitest.
Fix: add `bench/pitch.bench.ts` using `vitest bench`, covering `detectPitch` at 41 Hz, 440 Hz and 2 kHz on 4096 samples, `pitchShift` on 10 s, and `analyzeTake` on 60 s. Store the results JSON and fail CI when the mean exceeds baseline by 25%. Run it on the same runner type.
Effort: S

## I. Error handling, logging and diagnostics

### Stale lazy chunk after a deploy has no recovery
Evidence: `main.ts:30-40` shows "Could not load the sheet music reader. Check your connection and reload." when the dynamic import fails. After a deploy that removed the old `sheetmusic-*.js`, reloading is the fix, but the message blames the connection.
Fix: listen for `window.addEventListener('vite:preloadError', ...)` and catch the import. If `navigator.onLine`, check `registration.waiting` or `installing` and reload once (guard with `sessionStorage.partialReloaded`), otherwise show the offline message.
Effort: S

### A throwing view blanks the app with no way out
Evidence: `router.ts:15-18` calls `cleanup()` and `route.mount(outlet)` with no try/catch. An exception leaves `main` empty, and `cleanup` stays from the previous route.
Fix: wrap it in try/catch. On error, set `cleanup = undefined`, render `errorBox('This screen failed to open', () => render())` with a "Report" button (next item), and send the error to item 78's log.
Effort: S

### No privacy-preserving way to report a crash
Evidence: item 78 keeps a local log only. There is no path from a user to a maintainer, and the README promises no tracking (README:8-9).
Fix: a "Report a problem" button opens `https://github.com/<owner>/<repo>/issues/new?template=bug.yml&body=` with an encoded summary: app version, build id, user agent, route, and the last 20 log lines with any file or score names stripped. The user reviews it on GitHub before submitting, nothing is sent automatically, and there is a "Copy details" fallback for users without GitHub.
Effort: S

### App version and build id are not visible
Evidence: `package.json` is 0.1.0, no `define` in `vite.config.ts`, and the build id exists only inside `sw.js`.
Fix: in `vite.config.ts`, `define: {__APP_VERSION__: JSON.stringify(pkg.version), __BUILD_ID__: JSON.stringify(gitSha)}`. Show "Version 0.1.0 (abc1234)" in the Practice fineprint (`practice.ts:297`) and in reports.
Effort: S

### No diagnostics panel for audio and storage
Evidence: user bug reports would lack sample rate, latency, mic processing, service worker and storage state, and none of that is shown anywhere.
Fix: add a "Diagnostics" sheet under Practice listing `ctx.sampleRate`, `baseLatency`, `outputLatency`, `ctx.state`, mic `track.getSettings()`, `navigator.serviceWorker.controller` and the build id, `navigator.storage.estimate()` and `persisted()`, and `crossOriginIsolated`, with a "Copy" button.
Effort: S

## J. Release and versioning

### No tags, changelog or release process
Evidence: `git tag` prints nothing, there are 28 commits, `package.json` has never moved from 0.1.0, and there is no `CHANGELOG.md`.
Fix: adopt Conventional Commits and `release-please` (`googleapis/release-please-action`, `release-type: node`). It keeps `CHANGELOG.md`, bumps `package.json` and tags `vX.Y.Z`. Change the deploy trigger to release published, or keep deploy-on-main but label the version. Tag the current state `v0.1.0`.
Effort: S

### No release artifacts, provenance or rollback path
Evidence: the only output is the Pages artifact (`ci.yml:25-28`). Self-hosters get no downloadable build, and there is no documented rollback.
Fix: on a release, zip `dist` with its hidden source maps, attach it with `gh release upload`, and add `actions/attest-build-provenance` for the zip. Document rollback in `docs/releasing.md`: re-run the deploy job of the previous tag, which also rolls back `sw.js`, because the build id differs.
Effort: S

### No preview deploys for pull requests
Evidence: `ci.yml` deploys only on push to main, so testers and musicians cannot try a change before merge.
Fix: on Cloudflare Pages or Netlify (next section), enable per-PR preview URLs. Each preview is a separate origin, so its IndexedDB and service worker don't touch production data. Post the URL as a PR comment.
Effort: S

## K. Repository hygiene and documentation

### No CONTRIBUTING.md
Evidence: the repo root has only LICENSE and README.
Fix: add `CONTRIBUTING.md` covering setup (Node 24, `npm ci`), `npm test`/`npm run e2e` prerequisites (Chrome or Edge path, `BROWSER` env from `e2e.mjs:16`), the layout rule that `src/core` has no DOM, commit style, the inbound=outbound MIT licensing statement, how to add a temperament or click sound with tests, and the device-testing checklist.
Effort: S

### No code of conduct
Evidence: there is no `CODE_OF_CONDUCT.md`.
Fix: add Contributor Covenant 2.1 with a real contact address (not a personal email unless you choose that).
Effort: S

### No issue or PR templates
Evidence: there is no `.github/ISSUE_TEMPLATE` or `pull_request_template.md`.
Fix: add `bug.yml` (required fields: device, OS and version, browser and version, installed or tab, app version from diagnostics, instrument, steps), `feature.yml`, `config.yml` (blank issues off, link to Discussions), and a PR template checklist (tests, e2e, screenshots light and dark, README numbers updated).
Effort: S

### Development tool files are committed
Evidence: `git ls-files` includes `.claude/launch.json` and `docs/superpowers/specs/2026-09-12-partial-design.md`.
Fix: decide whether these belong in the public repo. If not, `git rm --cached .claude/launch.json` and add `.claude/` to `.gitignore`. Move the design spec to `docs/architecture.md` (next item) or delete it.
Effort: S

### Architecture doc is stale and misnamed
Evidence: `docs/superpowers/specs/2026-09-12-partial-design.md` still lists "pitch-shifting of recordings" as not implemented, which contradicts README:59-61 and `recorder.ts:282`.
Fix: rewrite it as `docs/architecture.md` covering:
- the audio graph (master, drones, clicks)
- the scheduler clocks
- mic sharing
- the storage split (localStorage vs IndexedDB and store versions)
- service worker strategy and update rules
- the lazy chunk boundaries
Add a Mermaid diagram and link it from the README Layout section.
Effort: S

### No API docs for src/core
Evidence: `src/core` is described as reusable for native shells, and has JSDoc on some functions (`pitch.ts:28-32`, `scheduler.ts:3-8`), but no generated reference.
Fix: add `typedoc` with `typedoc.json` entry points `src/core/*.ts`, `excludeInternal`, output `docs/api`. Build it in CI (fail on warnings with `treatWarningsAsErrors`) and publish under `/api/` on the site.
Effort: S

### No architecture decision records
Evidence: key choices appear only as code comments: no framework, hash router, no `skipWaiting` (`sw.js:19-20`), relative base (`vite.config.ts:34`), MIT with GPL Link isolation (item 2).
Fix: add `docs/adr/0001-no-framework.md` through `0005-...` using the Nygard template (Context, Decision, Consequences), one per decision above.
Effort: S

### Hard-coded figures in the README will drift
Evidence: README:87 says "82 tests" (this matches today's count), and gap item 40 says "17 KB main bundle" against the measured 45,362 bytes gzip. There is no automation keeping these true.
Fix: drop exact counts from the README, or generate them. For example, `scripts/readme-stats.mjs` rewrites marked regions (`<!-- stats:tests -->`) from `vitest --reporter=json` and gzip sizes, and CI fails if the README is out of date. Correct item 40's figure now.
Effort: S

### package.json is missing repository metadata
Evidence: `package.json` has no `repository`, `homepage`, `bugs` or `author`.
Fix: add them once the GitHub URL exists (item 58). Needed by Dependabot links, `npm fund` and any future package publishing.
Effort: S

### The core DSP is not reusable as a package
Evidence: `src/core` (YIN, temperaments, rhythm, WSOLA) has no DOM dependency per README:144, but it is not published. Other developers are more likely to contribute to a library they can use.
Fix: make an npm workspace `packages/core` with its own `package.json` (`@partial/core`, MIT, `exports`, `types`) built with `tsc`, and publish with `npm publish --provenance` from CI. Changes the import paths in `src/` only.
Effort: M

### No contributor onboarding structure
Evidence: the 78 gap items live in one markdown file (`docs/gap-analysis.md`), with no issues, labels or Discussions. The repo is not public yet.
Fix: after publishing, turn each S-effort item into an issue with labels `good first issue`, `area:audio`, `area:pwa` and `needs-device`, and link back to the item number. Enable Discussions with categories Q&A, Ideas and Device reports. Pin a roadmap issue that mirrors "Suggested order".
Effort: S

### No funding file for device-testing costs
Evidence: items 35, 56 and 57 need paid devices and accounts. Apple's program is $99 a year (developer.apple.com).
Fix: add `.github/FUNDING.yml` (GitHub Sponsors, Open Collective or Liberapay) and say in the README what funds pay for (developer accounts, test devices).
Effort: S

## L. Hosting and native distribution

### GitHub Pages cannot send the headers the app needs
Evidence: Pages does not support custom headers (community #54257), so no CSP `frame-ancestors`, Permissions-Policy or `Cache-Control` for `sw.js` (see the security items). Project pages also share the `username.github.io` origin with every other repo of that user, and localStorage, IndexedDB and service worker scope are per origin.
Fix: host on a provider that supports a `_headers` file, such as Cloudflare Pages or Netlify [unverified current free-tier limits; check pricing pages], or serve from a custom domain on Pages. Point the deploy job at the chosen host (`cloudflare/wrangler-action` with `pages deploy dist`).
Effort: S

### Pick the permanent origin before launch
Evidence: all user data lives in origin-scoped storage (`settings.ts:202`, `db.ts:40`). Moving from `x.github.io/partial` to a custom domain later strands every user's recordings, scores and history.
Fix: buy the domain now [unverified cost, depends on TLD and registrar] and deploy only there. If a move is ever unavoidable, ship a one-time "export all" on the old origin (needs item 51's full backup) and an import prompt on the new one.
Effort: S

### Trusted Web Activity for Google Play
Evidence: there is no Android distribution. Bubblewrap wraps a PWA as a TWA, and it needs `/.well-known/assetlinks.json` at the domain root (Bubblewrap README). A GitHub Pages project path cannot serve that, which is another reason for the custom domain. Google Play charges a $25 one-time fee (secondary sources). Reported testing requirements for new personal accounts, such as 12 testers, are unverified.
Fix:
1. Complete the PNG icon, `id` and screenshot items above.
2. Run `npm i -g @bubblewrap/cli`, then `bubblewrap init --manifest https://<domain>/manifest.webmanifest`, setting the application id and enabling notifications off.
3. `bubblewrap build` produces the signed AAB.
4. Copy the generated `assetlinks.json` to `public/.well-known/assetlinks.json` and redeploy.
5. Check with `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://<domain>&relation=delegate_permission/common.handle_all_urls`.
6. Upload to an internal testing track.
7. Test mic permission inside the TWA on a device [unverified behaviour].
Effort: M

### Microsoft Store through PWABuilder
Evidence: there is no Windows distribution. PWABuilder can package a PWA as MSIX [unverified current account fees for individuals].
Fix: run the site through pwabuilder.com, fix the manifest warnings it reports, download the Windows package, test it with sideloading (`Add-AppxPackage`), then submit through Partner Center.
Effort: M

### Tauri desktop app (separate from item 2's Link work)
Evidence: there is no desktop build. The design spec says "No native wrappers yet", and `src/core` is kept framework-free for that purpose.
Fix: `npm i -D @tauri-apps/cli && npx tauri init` with `frontendDist: "../dist"`, `devUrl: "http://localhost:5173"`, `beforeBuildCommand: "npm run build"`. macOS needs `NSMicrophoneUsageDescription` and `NSCameraUsageDescription` in `src-tauri/Info.plist` and the audio-input entitlement. Web MIDI and `setSinkId` availability in WKWebView (macOS) and WebKitGTK (Linux) are unverified, so feature-detect and test. Build per OS on a `tauri-apps/tauri-action` matrix. Unsigned builds trigger OS warnings, and code signing costs are unverified.
Effort: L

### No migration path from the PWA to a native app, and store compliance items
Evidence: item 35 plans Capacitor, but data in Safari or Chrome storage does not carry over to a native webview origin. App Store review may reject thin web wrappers [unverified current guideline wording].
Fix: before the native launch, ship item 51's full backup file and an "Import from web app" first-run screen in the native build, and share it through the share-sheet export in item 29. For iOS, set `ITSAppUsesNonExemptEncryption` to false if only HTTPS is used [unverified that this qualifies], add the mic and camera usage strings, and use native-only value (background audio, item 36) to support the review case.
Effort: M

### No privacy policy, and store privacy forms will be needed
Evidence: there is no `PRIVACY.md` or privacy page. Both stores require a privacy policy URL for apps [unverified exact rules], and the app uses the mic and camera.
Fix: write `public/privacy.html`, linked from Practice and the README. It should say: no data collected or transmitted, mic and camera processed on device, recordings and scores stored locally, no analytics, hosting provider logs (name the provider and what it logs), contact address, and that no age-specific data handling is needed because nothing is collected. Then fill in Play Data safety ("No data collected") and Apple privacy labels ("Data Not Collected") to match.
Effort: S

### Usage insight without analytics
Evidence: the README promises "no ads or tracking" (README:8-9), so there is no data on which features matter or which browsers break.
Fix: use signals that need no client code: host request analytics (counts of `precache.json` and `sheetmusic-*.js` fetches, as a rough proxy for installs and sheet music use [unverified per-host availability]), GitHub traffic stats, and an opt-in in-app survey link to GitHub Discussions twice a year. Document this in the privacy page. Do not add a client beacon.
Effort: S

## M. Legal

### The name "Resonare" is already used by a music app
Status: addressed on 2026-09-13 by renaming the app to Partial. Web searches found no app named Partial and no DNS records for partial.app or partial.dev. No trademark search has been done, so the fix below still applies to the new name.
Evidence: search results list an App Store app named "Resonare" (id6752107210, an album-logging app by James Shultz) and the resonare.app domain. I saw these as search results and did not open the pages. No trademark search has been done.
Fix: search USPTO (tmsearch.uspto.gov), EUIPO eSearch and WIPO Global Brand Database for the word in classes 9 and 41. Check both app stores and domain availability. An identical name in the same store category is a listing-conflict risk even without a registered mark [not legal advice]. Decide on a name before registering the domain, the TWA package id or store listings, all of which are costly to change later.
Effort: S

### Placement of the TonalEnergy disclaimer and use of its name
Evidence: the disclaimer is at README:11 and in the Practice fineprint (`practice.ts:297`), but not in the manifest or any store copy. `docs/gap-analysis.md` names "TE Tuner" throughout, which is fine for internal docs, and the project goal is framed against TE.
Fix: keep the disclaimer in an About section and the store "full description". Keep TonalEnergy's name out of the app title, subtitle, keywords and screenshots, since store keyword rules generally forbid competitor names [unverified exact wording]. Don't copy TE's visuals; item 43 already says to use original artwork.
Effort: S

### Font and pdf.js license texts are not shipped
Evidence: `dist/assets` redistributes Inter and Space Grotesk woff2 files (license OFL-1.1, from their `package.json`) and pdf.js (Apache-2.0), but `dist` has no license files. I believe OFL requires the license to accompany redistributed fonts, and Apache-2.0 section 4 requires a copy of the license; this is from memory, not a check of the texts in this session.
Fix: add a Vite step (`rollup-plugin-license` with `thirdParty.output: 'dist/THIRD_PARTY_LICENSES.txt'`, or a script concatenating `node_modules/{@fontsource-variable/inter,@fontsource-variable/space-grotesk,pdfjs-dist}/LICENSE`). Link it from Practice > About. Add CMap and standard-font licenses if the pdf.js assets item copies those folders.
Effort: S

### No license allowlist in CI
Evidence: 36 top-level `node_modules` entries, with no license gate before new dependencies (samples, zip encoders, pdf-lib) arrive per items 40, 51 and 69.
Fix: add `npx license-checker-rseidelsohn --production --onlyAllow "MIT;Apache-2.0;OFL-1.1;ISC;BSD-2-Clause;BSD-3-Clause;0BSD;CC0-1.0"` to CI. A GPL dependency then fails the build, which also protects item 2's licensing split.
Effort: S
