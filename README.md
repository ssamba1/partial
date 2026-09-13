# Resonare

Resonare is a free, open-source practice app for musicians. It has a tuner, a
metronome, drones and an exercise player, click tracks, a recorder that checks
your intonation, pitch analysis, and a sheet music reader you can write on. It
runs in the browser and can be installed like an app.

You don't need an account, and nothing costs money. The app has no ads or
tracking, and everything you save stays on your own device.

Resonare is an independent project and is not affiliated with TonalEnergy.

## Features

### Tuner
- Ring, bar and strobe displays. The ring rotates the detected note to the top,
  sweeps sharp (clockwise) or flat, and fills an inner ring while you hold the
  note in tune.
- States are shown in words and arrows as well as colour.
- String tuner for guitar (standard, Drop D, DADGAD, half step down), bass 4 and
  5, ukulele, violin, viola, cello, double bass, mandolin and banjo. Bowed
  strings can use pure 3:2 fifths. Tap a string to hear its reference.
- A4 from 400 to 480 Hz in 0.5 Hz steps; transposing instruments (B&#9837;,
  E&#9837;, F, G, A); equal, just, Pythagorean, quarter-comma meantone,
  Werckmeister III, Vallotti and Young II temperaments on any tonic.
- Note names in English, solf&egrave;ge or German (H).
- In-tune range from &plusmn;1 to &plusmn;10 cents, three steadiness modes, and
  mic sensitivity presets.
- Ignores the metronome: the tuner skips the instant each click sounds, so it
  keeps reading while the metronome plays.
- "Drone follows you" sounds the reference for the note you hold.
- Intonation tendencies: average cents and spread per note, saved across
  sessions.

### Metronome
- Tempo dial (drag, scroll wheel or arrow keys), hold-to-repeat +/-, tap tempo,
  a tempo sheet with tempo names and half/double time.
- Any meter from a tile picker, subdivisions up to 6, tap beats to cycle accent,
  normal and silent.
- Beat display as blocks, pendulum or pulse; optional full-screen flash.
- 16 synthesized click sounds, loudness-matched.
- Practice tools: count-in, polyrhythm layer, gap trainer (play N bars, silence
  M), random beat silence, speed trainer, stop after N bars.
- Presets, and a mini metronome docked on every screen.

### Sound
- Drones from a chromatic wheel (drag around it to glide) or a piano keyboard,
  as single notes, fifths, octaves or triads, in 11 synthesized timbres.
- Exercise player: major and minor scales, pentatonic, chromatic, arpeggios and
  scales in thirds over 1 to 3 octaves, up, down or both, at the metronome
  tempo, with a root drone, count-in, click and loop.

### Analysis
- Pitch over time, note staff, interval trainer (each interval against equal
  temperament and its just ratio), spectrum with harmonic markers, harmonic
  levels and waveform. Swipe between views; tap to freeze.

### Record
- Live waveform, optional metronome, playback at 0.5x to 1.25x with pitch
  preserved, download.
- Intonation report per take: percent in tune, average cents, held notes, and
  the notes furthest from centre with their times.

### Click tracks
- Sections with bars, tempo, meter, subdivision and tempo ramps, shown on a
  proportional timeline with a playhead. Templates and looping.

### Sheet music
- PDF library with thumbnails and drag-and-drop import.
- Single page, two pages, or half-page turns.
- Pen, highlighter and eraser with undo, saved per page. Night mode.
- Page turns by tap, keyboard, Bluetooth page turners, or MIDI pedals.

### Everywhere
- Tuning sheet from the top bar, session in-tune meter, keyboard shortcuts
  (M metronome, D stop drones, 1 to 8 screens, ? help).
- MIDI device learning for next/previous page, start/stop, metronome and tap.
- Screen reader announcements of tuner readings.
- Practice history: activity rings, streaks, 12-week calendar, daily goal, JSON
  backup and CSV export.
- Light and dark themes. Installs as a PWA and works offline after the first
  visit.

## What is measured, and what is not

The test suite (`npm test`, 76 tests) checks, among other things:

- Pitch detection on synthesized tones: pure sines for every semitone from E1
  (41 Hz) to C7 (2093 Hz) within 0.5 cents; harmonic-rich tones with a weak
  fundamental within 5 cents with no octave errors; silence and white noise give
  no pitch.
- Temperaments against their defining ratios, and that each well temperament
  distributes exactly one Pythagorean comma.
- Rhythm timing, polyrhythm offsets, gap and random muting, interval sizes,
  exercise note sequences, staff positions, and the offline take report on a
  synthesized recording.

`npm run e2e` builds the app and drives it in headless Chrome or Edge with a
synthesized microphone signal. It checks that every screen renders, tuner
readings, the tuner running alongside the metronome, exact metronome timing,
the interval trainer, recording with its intonation report, sheet music import
with annotation and half-page turns, and loading offline with the server
stopped. CI runs it on every push. During development the same approach was used
to confirm count-in, click-track playback, video takes, and that all 16 click
sounds render with similar peak levels.

The synthesized microphone is an electrical signal, so it cannot show that the
tuner ignores metronome clicks picked up acoustically; only the timing logic for
that is unit tested.

What I have not measured yet: accuracy with real instruments and microphones,
audio latency on phones, and whether anything breaks in Safari or Firefox (all
browser testing so far used Chrome and Edge). The timbres and click sounds are
synthesized approximations rather than recordings. Ableton Link and spoken
count-ins are missing.

## Development

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # unit tests
npm run build     # type check + production build into dist/
npm run preview   # serve the production build
```

Microphone access needs `https` or `localhost`.

### Layout

```
src/core/    pure logic, no DOM (notes, pitch, rhythm, intervals, intonation, ink, midi)
src/audio/   Web Audio (context, scheduler, metronome, voices, drones, pitch tracker)
src/store/   settings (localStorage) and recordings, scores, annotations (IndexedDB)
src/ui/      components, icons, shell pieces, one file per screen
tests/       vitest, core logic
public/      manifest, icons, service worker
```

The pitch detector is YIN: A. de Cheveign&eacute; and H. Kawahara, "YIN, a
fundamental frequency estimator for speech and music", J. Acoust. Soc. Am.
111(4), 1917-1930 (2002), [doi:10.1121/1.1458024](https://doi.org/10.1121/1.1458024).
The metronome schedules clicks ahead of time on the AudioContext clock, so
timing does not depend on UI load. PDF rendering uses
[pdf.js](https://github.com/mozilla/pdf.js), loaded only when the sheet music
screen opens. Fonts are Inter and Space Grotesk (SIL Open Font License).

## License

MIT. See [LICENSE](LICENSE).
