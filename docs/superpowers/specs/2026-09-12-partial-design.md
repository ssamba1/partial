# Partial: design

Free, open-source (MIT) practice studio covering and extending what TonalEnergy's
TE Tuner & Metronome offers. Named "Partial" on 2026-09-13 (working name was "Resonare", which an App Store app already uses).

Direction agreed in chat on 2026-09-12: one installable web app on a shared audio
core, every feature in scope. On 2026-09-12 and 2026-09-13 the interface was
redesigned after studying TE's documented interaction patterns (user guide), App
Store reviews, other tuner and metronome apps, and the UI work in Sri's other
repositories. Visual assets were not copied; interaction ideas were.

## Non-goals

- No backend, no accounts, no sync. Data stays in the browser (localStorage and
  IndexedDB), with JSON backup and CSV export.
- No native wrappers yet. `src/core` is framework-free so a Capacitor or Tauri
  shell can be added later.
- Not implemented: Ableton Link (no browser API), spoken count-in (no recorded
  voice), Apple Watch. (Pitch shifting of recordings was listed here but is
  built: `src/ui/views/recorder.ts` transposes a take by semitones.)

## Architecture

```
src/core/    pure logic, unit tested
  notes        frequency and note math, temperaments (incl. Werckmeister III, Vallotti, Young II), notation
  pitch        YIN with early exit at the first dip, smoother
  rhythm       meters, click tracks, section spans, gap and random muting, polyrhythm, tempo names
  intervals    interval naming and equal/just deviation
  intonation   strobe phase, tendencies, held-note segmentation, offline take reports
  exercises    scale and arpeggio sequences
  instruments  string tunings, pure fifths, nearest string
  staff        staff positions and ledger lines
  ink          annotation geometry, half-page turn state
  midi, gestures, spectrum, practice, format
src/audio/   Web Audio: context and mic, lookahead scheduler, metronome engine,
             click and timbre synthesis, drone bank, pitch tracker with click gating
src/store/   settings (localStorage), recordings, scores and annotations (IndexedDB)
src/ui/      components (segmented, dial, hold button, sheet, toast), icons,
             pitch ring, tuning sheet, global controls (shortcuts, MIDI, announcements),
             one file per screen
scripts/e2e.mjs  headless Chromium checks with a synthesized microphone
public/      manifest, icons, service worker (build id stamped at build time)
```

Boundaries: `core` imports nothing from `audio`, `store` or `ui`.

## Key design decisions

- Semantic colour is fixed app-wide: green in tune, amber sharp, blue flat,
  violet brand. States are also written in words so colour is never the only
  signal. Text colours were measured against WCAG 4.5:1.
- The metronome is one shared engine, reachable from a dock on every screen, and
  the tuner ignores audio around each scheduled click (addresses the TE review
  complaint that the tuner hears the metronome).
- Tuner steadiness modes and a short hold through dropouts address the "jumpy
  readout" complaint.
- Every hold-to-repeat control also works with a single tap, and every long
  feature has a visible entry point, to avoid hidden gestures.

## Verification

- `npm test`: unit tests on all of `src/core`.
- `npm run e2e`: builds and drives the app in headless Chromium (screens render,
  tuner readings, metronome timing, preset drones, interval trainer, recording
  report, sheet music annotation and half turns, score tempo memory, offline).
- Not verified: real instruments and microphones, phone audio latency, Safari
  and Firefox.
