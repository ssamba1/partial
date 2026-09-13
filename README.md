# Resonare

A free, open-source practice app for musicians: tuner, metronome, drone, click
tracks, recorder, pitch analysis and a sheet music reader, in one installable
web app. No accounts, no ads, no tracking. Everything you save stays in your
browser.

Resonare is an independent project and is not affiliated with TonalEnergy.

## Features

| Screen | What it does |
| --- | --- |
| Tuner | Chromatic tuner with needle, cents readout and pitch trace. A4 from 400 to 480 Hz, transposing instruments (B&#9837;, E&#9837;, F, G, A), equal / just / Pythagorean / quarter-comma meantone temperaments on any tonic, adjustable in-tune range and mic sensitivity. |
| Metronome | 20 to 400 BPM, any meter, subdivisions up to 6, per-beat accent / normal / silent, tap tempo, four click sounds, speed trainer, keyboard control. Keeps playing across screens. |
| Drone | Sustained reference pitches, single notes, fifths, octaves or triads, seven timbres. Follows the tuner's A4 and temperament. |
| Click track | Sections with their own bars, tempo, meter, subdivision and optional tempo ramp, plus a count-in. Saved locally. |
| Record | Record practice with an input meter and optional metronome, play back, rename, download, delete. |
| Analysis | Live pitch-over-time graph with in-tune band and accuracy stats, spectrum with harmonic markers, harmonic levels, waveform. |
| Sheet music | Import PDFs, one or two pages, full screen, page turns by tap, arrow keys, Page Up/Down or a Bluetooth pedal. Mini metronome and tuner overlay. Remembers the last page. |
| Practice | Daily practice time, streak, 28-day chart, theme, export / import of settings. |

It installs as a PWA and works offline after the first visit.

## What is measured

The test suite (`npm test`) checks the pitch detector against synthesized tones:
pure sines for every semitone from E1 (41 Hz) to C7 (2093 Hz) land within
0.5 cents, harmonic-rich tones with a weak fundamental land within 5 cents with
no octave errors, and silence and white noise return no pitch. Temperament
offsets are checked against their defining ratios, and click-track timing
against hand-computed event times.

These are synthetic signals. Accuracy on real instruments through a real
microphone has not been benchmarked yet.

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
src/core/    pure logic, no DOM (notes, pitch detection, rhythm, spectrum)
src/audio/   Web Audio glue (context, scheduler, metronome, voices, pitch tracker)
src/store/   settings (localStorage) and recordings / PDFs (IndexedDB)
src/ui/      DOM helpers, router, one file per screen
tests/       vitest, core logic
public/      manifest, icons, service worker
```

The pitch detector is YIN (de Cheveign&eacute; and Kawahara, 2002). The metronome
uses a lookahead scheduler on the AudioContext clock, so clicks are placed with
sample accuracy regardless of UI load. PDF rendering uses
[pdf.js](https://github.com/mozilla/pdf.js), loaded only when the sheet music
screen opens.

## License

MIT. See [LICENSE](LICENSE).
