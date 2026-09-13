# Resonare: design

Free, open-source (MIT) practice app for musicians covering the same ground as
TonalEnergy's TE Tuner & Metronome: tuner, metronome, drone / tone generator,
click tracks, recording, pitch analysis, and PDF sheet music. "Resonare" is a
working name.

Approved direction (chat, 2026-09-12): approach A, one web app (installable PWA)
on a shared audio core, every feature in scope, built in milestones. v1 goal for
"better" is: everything free, no accounts, no paywall, no tracking.

## Non-goals for this build

- No backend, no accounts, no sync. All data stays in the browser (IndexedDB /
  localStorage).
- No native mobile wrappers yet. The core is framework-free TypeScript so a
  Capacitor or Tauri wrapper can be added later without rewriting it.
- No claim of accuracy beyond what the test suite measures.

## Architecture

```
src/
  core/        pure logic, no DOM, unit tested
    notes.ts       frequency <-> note, cents, A4 calibration, temperaments, transposition
    pitch.ts       YIN pitch detector over a Float32Array frame
    rhythm.ts      meter / subdivision / accent patterns, click-track timeline expansion
    spectrum.ts    FFT magnitude spectrum, harmonic peak picking
    format.ts      small formatting helpers
  audio/       Web Audio glue, thin wrappers around core
    context.ts     shared AudioContext, mic stream
    scheduler.ts   lookahead scheduler (setTimeout wakeups, AudioContext time for events)
    voices.ts      click sounds and sustained tone voices (oscillators + envelopes)
    analyser.ts    mic frames -> pitch / spectrum readings
  store/
    settings.ts    persisted user settings
    recordings.ts  IndexedDB storage for recordings and sheet-music PDFs
  ui/
    router.ts      hash router
    dom.ts         tiny element helper
    views/         one file per feature screen
  main.ts
public/            manifest, icons, service worker
tests/             vitest, core only
```

Boundaries: `core` never imports from `audio`, `store`, or `ui`. Every view talks
to audio through `audio/*` functions and to persistence through `store/*`.

## Features and milestones

1. **Tuner.** Mic in, YIN detection, needle and cents readout, note name,
   frequency, A4 reference (400-480 Hz), transposition (C, Bb, Eb, F, G, A),
   temperaments (equal, just, Pythagorean, meantone quarter-comma) relative to a
   chosen tonic, adjustable in-tune tolerance, pitch trace of the last seconds.
2. **Metronome.** 20-400 BPM, any meter n/d, subdivisions (1-4 plus triplet
   feel via 3), per-beat accent levels (accent, normal, silent), tap tempo,
   several click sounds, visual beat indicator. Events scheduled on the
   AudioContext clock with lookahead so timing does not depend on UI jank.
3. **Drone / tone generator.** Sustained pitches for any note and octave,
   several waveforms, multiple simultaneous drones (intervals, chords), volume,
   follows tuner temperament and A4.
4. **Click tracks.** Ordered sections, each with bars, tempo, meter, optional
   tempo ramp to the next section, count-in. Expanded by `rhythm.ts` into a
   timeline the scheduler plays. Saved locally.
5. **Recording.** MediaRecorder capture, list, play, rename, delete, download,
   optional metronome while recording. Stored in IndexedDB.
6. **Analysis.** Live waveform, spectrum with harmonic markers, pitch-over-time
   graph with in-tune band.
7. **Sheet music.** Import PDFs (stored locally), page view with pdf.js, page
   turns by button / keyboard / foot pedal keys, metronome and tuner overlay.

## Error handling

- Mic permission denied or unavailable: the view shows a clear message and a
  retry button, the rest of the app keeps working.
- AudioContext must start from a user gesture: every audio feature has an
  explicit start button.
- IndexedDB unavailable (private mode): recordings / PDFs show an error, other
  features unaffected.
- Detector returns `null` when the signal is too quiet or aperiodic; the UI
  shows "listening" instead of a guessed note.

## Testing

- vitest on `core/`: pitch detection on synthesized tones across the range with
  measured cents error, harmonics-rich tones (octave-error check), noise returns
  null; note math and temperaments against hand-computed values; rhythm
  expansion (event times for meters, subdivisions, ramps).
- `tsc --noEmit` type check and `vite build` must pass.
- Manual browser check of each screen via the in-app browser.
