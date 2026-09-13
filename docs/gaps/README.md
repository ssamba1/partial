# Gap audit, full list

This folder extends [../gap-analysis.md](../gap-analysis.md), which has 78
items. Each file below came from a separate audit pass over one area of the app.
Every item has the same shape: what is wrong or missing, the evidence (a
`file:line` in this repo, a cited page, or a claim marked [unverified]), how to
fix it, and a rough effort (S, M, L or XL).

The short intro at the top of each file was written by the audit pass for that
area, so "I" there means that pass. The item counts in those intros have been
corrected to match the files.

## Counts

Counted from `### ` headings. Each file has exactly as many `Effort:` lines as
headings, and no heading repeats within a file.

| File | Area | Items |
| --- | --- | ---: |
| [01-tuner.md](01-tuner.md) | Tuner | 110 |
| [02-metronome.md](02-metronome.md) | Metronome | 114 |
| [03-sound-exercises.md](03-sound-exercises.md) | Drones, keyboard, exercises | 115 |
| [04-analysis.md](04-analysis.md) | Analysis screen | 111 |
| [05-recorder.md](05-recorder.md) | Recorder and take reports | 154 |
| [06-clicktracks-sheetmusic.md](06-clicktracks-sheetmusic.md) | Click tracks (72), sheet music (80) | 152 |
| [07-practice-data-settings.md](07-practice-data-settings.md) | Practice log, data, settings | 107 |
| [08-ui-ux-a11y.md](08-ui-ux-a11y.md) | UI, UX, accessibility | 142 |
| [09-platform-perf-testing.md](09-platform-perf-testing.md) | Platform, performance, testing, release, legal | 139 |
| [10-users-pedagogy-market.md](10-users-pedagogy-market.md) | Specific kinds of musicians, teaching, market | 178 |
| | **Total in this folder** | **1,322** |

110 + 114 + 115 + 111 + 154 + 152 + 107 + 142 + 139 + 178 = 1,322.

Some items were found by more than one pass. The 105 groups below hold 227
items; one item per group is kept and the other 122 are counted as duplicates.

- Distinct items in this folder: 1,322 - 122 = **1,200**
- Plus the 78 in `gap-analysis.md`: 1,200 + 78 = **1,278**

The goal was 20 times the original 78, which is 1,560. The list reaches 1,278,
about 16 times the original. Every pass stopped when it ran out of real items
instead of padding, and that is why the total is short.

## How far to trust these numbers

- **Duplicates may remain.** Claude found them by comparing title words and shared
  code references across files, then reading all 224 candidate pairs by hand.
  Two items that describe the same problem in different words and cite
  different lines would slip through. So 1,200 is a ceiling on the distinct
  count, not an exact figure.
- **Overlap with the original 78 was not checked item by item.** Each audit
  pass was told to skip anything already in `gap-analysis.md`, and many items
  say which existing item they build on. I did not compare all 1,322 against
  the 78 myself.
- **Code bugs come from reading source, mostly not from running it.** A few
  were reproduced (the files say which). Treat the rest as strong leads.
- **Anything marked [unverified] needs a source or an expert before it
  ships.** That covers competitor features, platform quirks, and musical data
  such as tala and makam tables, historical tunings, brass slide advice and
  instrument transpositions.

## Corrections this audit made to existing docs

- `gap-analysis.md` item 40 called the main bundle 17 KB. A fresh build on
  2026-09-13 gives `dist/assets/index-BeFWkRDq.js` at 127,277 bytes, 45,477
  bytes gzipped at level 9 (Node zlib). Fixed.
- `docs/superpowers/specs/2026-09-12-resonare-design.md` still lists pitch
  shifting of recordings as not built, but it is (`src/ui/views/recorder.ts`).
  Fixed.

## Duplicate groups

- Kept: [01-tuner.md #11](01-tuner.md) No input device choice
  - Same as: [04-analysis.md #95](04-analysis.md) No choice of input device
  - Same as: [05-recorder.md #1](05-recorder.md) No microphone or input device picker
  - Same as: [09-platform-perf-testing.md #6](09-platform-perf-testing.md) No input device choice and no devicechange handling
  - Same as: [10-users-pedagogy-market.md #26](10-users-pedagogy-market.md) [College music major] Input device and channel selection for recordings
- Kept: [02-metronome.md #16](02-metronome.md) No limiter on the master output
  - Same as: [03-sound-exercises.md #37](03-sound-exercises.md) No limiter on the master output
  - Same as: [09-platform-perf-testing.md #11](09-platform-perf-testing.md) No limiter on the master bus
  - Same as: [10-users-pedagogy-market.md #67](10-users-pedagogy-market.md) [Drummer] Loud click for acoustic kits
- Kept: [07-practice-data-settings.md #102](07-practice-data-settings.md) Settings live on the Practice statistics screen
  - Same as: [08-ui-ux-a11y.md #125](08-ui-ux-a11y.md) 125. Settings live on the Practice screen
- Kept: [01-tuner.md #40](01-tuner.md) No forced-colors (high contrast) support
  - Same as: [08-ui-ux-a11y.md #93](08-ui-ux-a11y.md) 93. No forced-colors (Windows High Contrast) support
  - Same as: [10-users-pedagogy-market.md #141](10-users-pedagogy-market.md) [Low-vision musician] High-contrast and forced-colors support
- Kept: [01-tuner.md #88](01-tuner.md) Spelling ignores the key
  - Same as: [03-sound-exercises.md #68](03-sound-exercises.md) Spelling ignores the key
  - Same as: [04-analysis.md #33](04-analysis.md) Staff spelling ignores key
- Kept: [01-tuner.md #100](01-tuner.md) No vocal range finder
  - Same as: [10-users-pedagogy-market.md #36](10-users-pedagogy-market.md) [Church choir singer] Vocal range finder
- Kept: [02-metronome.md #31](02-metronome.md) No swing or shuffle
  - Same as: [10-users-pedagogy-market.md #46](10-users-pedagogy-market.md) [Jazz musician] Swing ratio on the metronome
- Kept: [03-sound-exercises.md #59](03-sound-exercises.md) No tanpura drone
  - Same as: [10-users-pedagogy-market.md #86](10-users-pedagogy-market.md) [Indian classical musician] Tanpura drone
- Kept: [04-analysis.md #92](04-analysis.md) Chart has no text alternative
  - Same as: [08-ui-ux-a11y.md #43](08-ui-ux-a11y.md) 43. Analysis chart has no text alternative
- Kept: [07-practice-data-settings.md #93](07-practice-data-settings.md) No Content-Security-Policy
  - Same as: [09-platform-perf-testing.md #63](09-platform-perf-testing.md) No Content Security Policy
- Kept: [02-metronome.md #70](02-metronome.md) The dial has interactive controls inside a slider
  - Same as: [08-ui-ux-a11y.md #35](08-ui-ux-a11y.md) 35. Controls inside the tempo dial slider
- Kept: [01-tuner.md #93](01-tuner.md) No piano stretch tuning
  - Same as: [10-users-pedagogy-market.md #69](10-users-pedagogy-market.md) [Pianist] Piano tuning with inharmonicity and stretch
- Kept: [02-metronome.md #104](02-metronome.md) No MIDI clock or MIDI note output
  - Same as: [06-clicktracks-sheetmusic.md #47](06-clicktracks-sheetmusic.md) [Click tracks] No MIDI clock output
- Kept: [05-recorder.md #54](05-recorder.md) Listing loads every recording blob into memory
  - Same as: [07-practice-data-settings.md #106](07-practice-data-settings.md) Loading the take list reads every recording's audio into memory
- Kept: [07-practice-data-settings.md #91](07-practice-data-settings.md) MIDI permission may be requested at launch without a gesture
  - Same as: [09-platform-perf-testing.md #50](09-platform-perf-testing.md) MIDI permission may be requested at startup without a gesture
- Kept: [05-recorder.md #144](05-recorder.md) Chart does not redraw on resize or theme change
  - Same as: [08-ui-ux-a11y.md #89](08-ui-ux-a11y.md) 89. Canvases keep old colours after a theme change or resize
- Kept: [06-clicktracks-sheetmusic.md #32](06-clicktracks-sheetmusic.md) [Click tracks] Click tracks count as metronome practice
  - Same as: [07-practice-data-settings.md #9](07-practice-data-settings.md) Click tracks are logged as metronome time
- Kept: [06-clicktracks-sheetmusic.md #74](06-clicktracks-sheetmusic.md) [Sheet music] Black ink is invisible in night mode
  - Same as: [08-ui-ux-a11y.md #87](08-ui-ux-a11y.md) 87. Night mode makes annotations invisible
- Kept: [03-sound-exercises.md #110](03-sound-exercises.md) Sounding list re-announces on every settings change
  - Same as: [08-ui-ux-a11y.md #22](08-ui-ux-a11y.md) 22. Sounding-drones list re-announces on every change
- Kept: [07-practice-data-settings.md #105](07-practice-data-settings.md) No app shortcuts in the manifest
  - Same as: [09-platform-perf-testing.md #43](09-platform-perf-testing.md) Manifest has no shortcuts
  - Same as: [02-metronome.md #103](02-metronome.md) No app shortcut to open the metronome
- Kept: [03-sound-exercises.md #16](03-sound-exercises.md) Enter or Space on a key ignores chord and sustain modes
  - Same as: [08-ui-ux-a11y.md #47](08-ui-ux-a11y.md) 47. Keyboard-played piano ignores chord and sustain modes
- Kept: [03-sound-exercises.md #102](03-sound-exercises.md) No beat rate shown between you and the drone
  - Same as: [04-analysis.md #43](04-analysis.md) Beat rate between played note and drone isn't shown
- Kept: [05-recorder.md #40](05-recorder.md) Mirrored preview but unmirrored recording
  - Same as: [08-ui-ux-a11y.md #132](08-ui-ux-a11y.md) 132. Camera preview is mirrored but the saved video is not
- Kept: [01-tuner.md #51](01-tuner.md) No steadiness feedback per long tone
  - Same as: [04-analysis.md #74](04-analysis.md) No long-tone steadiness score
- Kept: [01-tuner.md #79](01-tuner.md) Tonic does not follow the drone
  - Same as: [03-sound-exercises.md #6](03-sound-exercises.md) Temperament tonic does not follow the drone root
- Kept: [05-recorder.md #36](05-recorder.md) Recording state is not announced to screen readers
  - Same as: [08-ui-ux-a11y.md #44](08-ui-ux-a11y.md) 44. Recording state is not announced
- Kept: [01-tuner.md #13](01-tuner.md) Mic processing flags are requested but never checked
  - Same as: [09-platform-perf-testing.md #8](09-platform-perf-testing.md) Mic processing constraints are never confirmed
- Kept: [01-tuner.md #22](01-tuner.md) Metronome gate ignores frame length and output latency
  - Same as: [04-analysis.md #8](04-analysis.md) Metronome gate is shorter than the analysis frame
- Kept: [02-metronome.md #105](02-metronome.md) Cannot send the click to a specific output device
  - Same as: [09-platform-perf-testing.md #7](09-platform-perf-testing.md) No output device selection
  - Same as: [10-users-pedagogy-market.md #32](10-users-pedagogy-market.md) [Professional orchestral player] Output device selection for silent backstage checks
- Kept: [06-clicktracks-sheetmusic.md #11](06-clicktracks-sheetmusic.md) [Click tracks] No fermatas, holds or timed pauses
  - Same as: [10-users-pedagogy-market.md #31](10-users-pedagogy-market.md) [Professional orchestral player] Fermatas and pauses in click tracks
- Kept: [07-practice-data-settings.md #17](07-practice-data-settings.md) Heatmap weeks always start on Sunday
  - Same as: [08-ui-ux-a11y.md #139](08-ui-ux-a11y.md) 139. Dates mix formats and assume Sunday starts the week
- Kept: [03-sound-exercises.md #34](03-sound-exercises.md) A forgotten drone logs as practice time
  - Same as: [07-practice-data-settings.md #4](07-practice-data-settings.md) A forgotten metronome or drone logs hours of "practice"
- Kept: [02-metronome.md #84](02-metronome.md) The dial lacks Home/End, and its arc wastes space on extreme tempos
  - Same as: [08-ui-ux-a11y.md #38](08-ui-ux-a11y.md) 38. Dial ignores Home and End
- Kept: [07-practice-data-settings.md #103](07-practice-data-settings.md) Status bar colour ignores a forced theme
  - Same as: [08-ui-ux-a11y.md #90](08-ui-ux-a11y.md) 90. Browser chrome colour ignores the in-app theme choice
- Kept: [02-metronome.md #45](02-metronome.md) Tempo names are uncited and overlap
  - Same as: [08-ui-ux-a11y.md #127](08-ui-ux-a11y.md) 127. Tempo sheet highlights two names at once
- Kept: [07-practice-data-settings.md #98](07-practice-data-settings.md) No separate profiles for several students on one device
  - Same as: [10-users-pedagogy-market.md #119](10-users-pedagogy-market.md) [Band director] Per-student profiles on shared devices
- Kept: [01-tuner.md #66](01-tuner.md) Microphone errors give no recovery steps
  - Same as: [08-ui-ux-a11y.md #114](08-ui-ux-a11y.md) 114. Denied microphone errors give no browser-specific help and loop on retry
- Kept: [02-metronome.md #22](02-metronome.md) No additive meters or beat groupings (2+2+3)
  - Same as: [10-users-pedagogy-market.md #68](10-users-pedagogy-market.md) [Drummer] Additive meter grouping display
- Kept: [02-metronome.md #37](02-metronome.md) No rudiment or sticking practice
  - Same as: [10-users-pedagogy-market.md #63](10-users-pedagogy-market.md) [Drummer] Rudiment trainer with sticking
- Kept: [02-metronome.md #66](02-metronome.md) Changing an accent loses focus and is not announced
  - Same as: [08-ui-ux-a11y.md #19](08-ui-ux-a11y.md) 19. Tapping a beat block loses focus
- Kept: [02-metronome.md #82](02-metronome.md) Mouse wheel and trackpad spin the dial too fast
  - Same as: [08-ui-ux-a11y.md #36](08-ui-ux-a11y.md) 36. Dial wheel handling traps page scroll and jumps on trackpads
- Kept: [02-metronome.md #110](02-metronome.md) No tempo progress history per piece
  - Same as: [07-practice-data-settings.md #40](07-practice-data-settings.md) Tempo progress per piece is overwritten, not kept
- Kept: [03-sound-exercises.md #95](03-sound-exercises.md) No pitch matching with scoring
  - Same as: [04-analysis.md #83](04-analysis.md) No pitch-matching trainer
  - Same as: [01-tuner.md #99](01-tuner.md) No pitch-matching practice for singers
- Kept: [06-clicktracks-sheetmusic.md #141](06-clicktracks-sheetmusic.md) [Sheet music] Pages are invisible to screen readers
  - Same as: [08-ui-ux-a11y.md #54](08-ui-ux-a11y.md) 54. Score pages are silent to screen readers
- Kept: [07-practice-data-settings.md #54](07-practice-data-settings.md) Two open tabs overwrite each other's settings and history
  - Same as: [09-platform-perf-testing.md #26](09-platform-perf-testing.md) Two tabs overwrite each other's settings and practice log
- Kept: [05-recorder.md #89](05-recorder.md) Transposition runs on the main thread
  - Same as: [09-platform-perf-testing.md #19](09-platform-perf-testing.md) Pitch shifting and take analysis block the main thread
- Kept: [06-clicktracks-sheetmusic.md #23](06-clicktracks-sheetmusic.md) [Click tracks] The timeline hides its buttons from screen readers
  - Same as: [08-ui-ux-a11y.md #52](08-ui-ux-a11y.md) 52. Timeline buttons are hidden inside role=img
- Kept: [02-metronome.md #73](02-metronome.md) Full-screen flash has no photosensitivity limit
  - Same as: [08-ui-ux-a11y.md #73](08-ui-ux-a11y.md) 73. Screen flash can break the three-flashes rule (WCAG 2.3.1, Level A)
- Kept: [01-tuner.md #8](01-tuner.md) Mic stays open when the tab is hidden, but analysis stops
  - Same as: [09-platform-perf-testing.md #4](09-platform-perf-testing.md) Mic stays open while the page is hidden
- Kept: [02-metronome.md #10](02-metronome.md) A suspended or interrupted AudioContext is not detected
  - Same as: [01-tuner.md #10](01-tuner.md) AudioContext suspension mid-session is not handled
  - Same as: [09-platform-perf-testing.md #1](09-platform-perf-testing.md) No handling of AudioContext state changes (interrupted or suspended)
- Kept: [02-metronome.md #13](02-metronome.md) The exercise player ignores a running metronome's phase
  - Same as: [03-sound-exercises.md #30](03-sound-exercises.md) Exercise does not lock to a running metronome
- Kept: [02-metronome.md #63](02-metronome.md) No timing accuracy feedback against the click
  - Same as: [05-recorder.md #138](05-recorder.md) No rhythm or timing report against the click
  - Same as: [10-users-pedagogy-market.md #66](10-users-pedagogy-market.md) [Drummer] Onset timing accuracy report
- Kept: [03-sound-exercises.md #67](03-sound-exercises.md) Exercise root cannot be chosen in written pitch
  - Same as: [10-users-pedagogy-market.md #12](10-users-pedagogy-market.md) [Band student] Exercise player root in the written key
- Kept: [03-sound-exercises.md #112](03-sound-exercises.md) Wheel hover colour sticks on touch
  - Same as: [08-ui-ux-a11y.md #104](08-ui-ux-a11y.md) 104. Hover styles stick on touch screens
- Kept: [05-recorder.md #16](05-recorder.md) Unplugged mic or ended track is not detected
  - Same as: [01-tuner.md #9](01-tuner.md) A microphone that disconnects is never detected
  - Same as: [09-platform-perf-testing.md #5](09-platform-perf-testing.md) No response when the mic track ends or is muted
- Kept: [05-recorder.md #151](05-recorder.md) No tempo or key detection for imported recordings
  - Same as: [10-users-pedagogy-market.md #104](10-users-pedagogy-market.md) [Singer-songwriter] Idea capture with key and tempo detection
- Kept: [02-metronome.md #65](02-metronome.md) Preset chips and dock controls are rebuilt every bar
  - Same as: [08-ui-ux-a11y.md #18](08-ui-ux-a11y.md) 18. Metronome re-renders presets and badges every bar, destroying keyboard focus
- Kept: [03-sound-exercises.md #80](03-sound-exercises.md) No modes
  - Same as: [10-users-pedagogy-market.md #49](10-users-pedagogy-market.md) [Jazz musician] Modes, blues, bebop and 7th-chord patterns
- Kept: [06-clicktracks-sheetmusic.md #84](06-clicktracks-sheetmusic.md) [Sheet music] No text annotations
  - Same as: [10-users-pedagogy-market.md #76](10-users-pedagogy-market.md) [Organist] Text stamps for registration in the sheet reader
- Kept: [01-tuner.md #75](01-tuner.md) Just intonation ratios are fixed
  - Same as: [04-analysis.md #40](04-analysis.md) Only one just ratio per interval
- Kept: [02-metronome.md #7](02-metronome.md) Background tab timer throttling can break the click
  - Same as: [06-clicktracks-sheetmusic.md #60](06-clicktracks-sheetmusic.md) [Click tracks] Clicks may be late in a background tab
  - Same as: [09-platform-perf-testing.md #3](09-platform-perf-testing.md) Lookahead is too short for hidden or throttled tabs
- Kept: [06-clicktracks-sheetmusic.md #95](06-clicktracks-sheetmusic.md) [Sheet music] Rendered pages are never evicted from memory
  - Same as: [09-platform-perf-testing.md #21](09-platform-perf-testing.md) Sheet music page cache has no limit
- Kept: [01-tuner.md #1](01-tuner.md) Low range breaks at 88.2 and 96 kHz sample rates
  - Same as: [09-platform-perf-testing.md #9](09-platform-perf-testing.md) Low-note floor rises on 88.2 and 96 kHz devices
- Kept: [05-recorder.md #18](05-recorder.md) A tab crash or reload mid-take loses the whole take
  - Same as: [09-platform-perf-testing.md #20](09-platform-perf-testing.md) Recorder chunks live only in memory until stop
- Kept: [08-ui-ux-a11y.md #116](08-ui-ux-a11y.md) 116. Explain the microphone before the browser asks
  - Same as: [09-platform-perf-testing.md #49](09-platform-perf-testing.md) No explainer before the microphone permission prompt
- Kept: [08-ui-ux-a11y.md #91](08-ui-ux-a11y.md) 91. Manifest theme colour does not match the app
  - Same as: [09-platform-perf-testing.md #45](09-platform-perf-testing.md) Theme and splash colors disagree
- Kept: [04-analysis.md #36](04-analysis.md) Out-of-tune notes near ±50 cents get split up and dropped
  - Same as: [05-recorder.md #135](05-recorder.md) Note grouping splits notes that waver near the semitone boundary
- Kept: [01-tuner.md #80](01-tuner.md) No harmonic-partial mode for brass
  - Same as: [10-users-pedagogy-market.md #85](10-users-pedagogy-market.md) [Natural trumpet or horn player] Harmonic series target mode
- Kept: [01-tuner.md #81](01-tuner.md) No Scala import or wider historical temperament library
  - Same as: [10-users-pedagogy-market.md #101](10-users-pedagogy-market.md) [Microtonal and non-Western musician] Scala .scl import
- Kept: [01-tuner.md #32](01-tuner.md) No custom string tunings, capo or per-string offsets
  - Same as: [10-users-pedagogy-market.md #51](10-users-pedagogy-market.md) [Guitarist] Custom and alternate tuning editor
  - Same as: [10-users-pedagogy-market.md #52](10-users-pedagogy-market.md) [Guitarist] Capo support
  - Same as: [10-users-pedagogy-market.md #54](10-users-pedagogy-market.md) [Guitarist] Sweetened per-string offsets
- Kept: [01-tuner.md #97](01-tuner.md) No guitar intonation (saddle) check
  - Same as: [10-users-pedagogy-market.md #53](10-users-pedagogy-market.md) [Guitarist] Intonation setup assistant
- Kept: [01-tuner.md #91](01-tuner.md) No timpani mode
  - Same as: [10-users-pedagogy-market.md #62](10-users-pedagogy-market.md) [Timpanist] Timpani preset and pitch check
- Kept: [01-tuner.md #101](01-tuner.md) No choir pitch-drift check
  - Same as: [10-users-pedagogy-market.md #37](10-users-pedagogy-market.md) [Church choir singer] Pitch sag report for unaccompanied singing
- Kept: [01-tuner.md #39](01-tuner.md) No non-speech audio feedback for players who cannot see the screen
  - Same as: [10-users-pedagogy-market.md #132](10-users-pedagogy-market.md) [Blind musician] Sonified tuner
- Kept: [01-tuner.md #104](01-tuner.md) No haptic direction cues
  - Same as: [10-users-pedagogy-market.md #129](10-users-pedagogy-market.md) [Deaf or hard-of-hearing musician] Haptic tuner feedback
- Kept: [01-tuner.md #86](01-tuner.md) Transposition list has wrong octaves and gaps
  - Same as: [10-users-pedagogy-market.md #11](10-users-pedagogy-market.md) [Tuba, bari sax, bass clarinet, guitar] Octave-aware transpositions
- Kept: [01-tuner.md #89](01-tuner.md) German and solfège naming are incomplete
  - Same as: [10-users-pedagogy-market.md #29](10-users-pedagogy-market.md) [College music major] Movable-do solfege
- Kept: [01-tuner.md #70](01-tuner.md) A4 range and presets exclude historical and regional pitches
  - Same as: [10-users-pedagogy-market.md #80](10-users-pedagogy-market.md) [Early music player] A4 range below 400 Hz
- Kept: [01-tuner.md #76](01-tuner.md) Meantone wolf position and enharmonics are fixed
  - Same as: [10-users-pedagogy-market.md #82](10-users-pedagogy-market.md) [Early music player] Meantone chain and enharmonic choice
- Kept: [01-tuner.md #82](01-tuner.md) No tuning systems with other than 12 notes
  - Same as: [10-users-pedagogy-market.md #93](10-users-pedagogy-market.md) [Arabic or Turkish maqam musician] Microtonal note display (24 or 53 divisions)
- Kept: [01-tuner.md #85](01-tuner.md) Cannot tune to an existing instrument's own scale
  - Same as: [10-users-pedagogy-market.md #99](10-users-pedagogy-market.md) [Gamelan player] Capture an ensemble's own scale
- Kept: [02-metronome.md #97](02-metronome.md) No setlist mode with pedal switching
  - Same as: [10-users-pedagogy-market.md #65](10-users-pedagogy-market.md) [Drummer] Live setlist with pedal advance
- Kept: [02-metronome.md #36](02-metronome.md) No drum grooves
  - Same as: [10-users-pedagogy-market.md #64](10-users-pedagogy-market.md) [Drummer] Multi-voice groove step sequencer
- Kept: [02-metronome.md #42](02-metronome.md) Tempo range 20 to 400 is narrow at the slow end
  - Same as: [10-users-pedagogy-market.md #91](10-users-pedagogy-market.md) [Hindustani musician] Tempos below 20 BPM for vilambit
- Kept: [02-metronome.md #46](02-metronome.md) No smooth accelerando or ritardando in the metronome, and click-track ramps are not linear in time
  - Same as: [10-users-pedagogy-market.md #111](10-users-pedagogy-market.md) [Music therapist] Time-based gradual tempo ramp
- Kept: [02-metronome.md #64](02-metronome.md) No tempo detection from playing
  - Same as: [10-users-pedagogy-market.md #118](10-users-pedagogy-market.md) [Marching band director] Live tempo detection to catch rushing
- Kept: [02-metronome.md #101](02-metronome.md) Cannot type a tempo without clicking the field
  - Same as: [10-users-pedagogy-market.md #172](10-users-pedagogy-market.md) [Blind musician] Tempo and meter direct entry by keyboard
- Kept: [09-platform-perf-testing.md #134](09-platform-perf-testing.md) No privacy policy, and store privacy forms will be needed
  - Same as: [10-users-pedagogy-market.md #144](10-users-pedagogy-market.md) [Market: schools] Privacy statement for district approval
- Kept: [06-clicktracks-sheetmusic.md #45](06-clicktracks-sheetmusic.md) [Click tracks] No MIDI file import
  - Same as: [10-users-pedagogy-market.md #157](10-users-pedagogy-market.md) [Drummer] Tempo map import from song files
- Kept: [07-practice-data-settings.md #53](07-practice-data-settings.md) No printable practice record for teachers or parents
  - Same as: [10-users-pedagogy-market.md #125](10-users-pedagogy-market.md) [Private teacher] Printable practice sheets
- Kept: [07-practice-data-settings.md #43](07-practice-data-settings.md) No clean-repetition counter for passages
  - Same as: [10-users-pedagogy-market.md #73](10-users-pedagogy-market.md) [Pianist] Correct-repetitions counter
- Kept: [04-analysis.md #85](04-analysis.md) No comparison between takes or against a reference recording
  - Same as: [10-users-pedagogy-market.md #27](10-users-pedagogy-market.md) [College music major] Compare two takes
  - Same as: [05-recorder.md #150](05-recorder.md) No comparison of a take's pitch contour with a reference recording
- Kept: [07-practice-data-settings.md #60](07-practice-data-settings.md) Stored and imported values are never type-checked
  - Same as: [09-platform-perf-testing.md #67](09-platform-perf-testing.md) Backup import accepts arbitrary shapes and can break the app on every launch
- Kept: [02-metronome.md #12](02-metronome.md) Two timing engines can play at once
  - Same as: [06-clicktracks-sheetmusic.md #31](06-clicktracks-sheetmusic.md) [Click tracks] The metronome can play at the same time as a click track
- Kept: [02-metronome.md #102](02-metronome.md) Media keys and headset buttons do nothing
  - Same as: [09-platform-perf-testing.md #17](09-platform-perf-testing.md) No Media Session integration
- Kept: [02-metronome.md #107](02-metronome.md) Two tabs run two metronomes
  - Same as: [09-platform-perf-testing.md #28](09-platform-perf-testing.md) Only one tab should own the mic and audio
- Kept: [02-metronome.md #112](02-metronome.md) No tests of the live metronome engine
  - Same as: [09-platform-perf-testing.md #91](09-platform-perf-testing.md) The metronome event generator is untested
- Kept: [02-metronome.md #17](02-metronome.md) Every click builds 2 to 5 audio nodes on the fly
  - Same as: [09-platform-perf-testing.md #12](09-platform-perf-testing.md) Click synthesis creates 2 to 5 nodes per click
- Kept: [02-metronome.md #15](02-metronome.md) iPhone ring/silent switch may mute Web Audio
  - Same as: [09-platform-perf-testing.md #16](09-platform-perf-testing.md) Audio session type is not set for iOS
- Kept: [01-tuner.md #67](01-tuner.md) No auto-start even when permission is already granted
  - Same as: [08-ui-ux-a11y.md #117](08-ui-ux-a11y.md) 117. Tuner resets when you return to it
- Kept: [01-tuner.md #65](01-tuner.md) A second tap during the permission prompt starts instead of cancelling
  - Same as: [08-ui-ux-a11y.md #107](08-ui-ux-a11y.md) 107. No pending state while waiting for microphone permission
- Kept: [01-tuner.md #36](01-tuner.md) String buttons show state by colour only and have no labels
  - Same as: [08-ui-ux-a11y.md #49](08-ui-ux-a11y.md) 49. String buttons do not say what they do
- Kept: [01-tuner.md #37](01-tuner.md) The whole display is one button that hides the readout
  - Same as: [08-ui-ux-a11y.md #39](08-ui-ux-a11y.md) 39. Tuner stage button does not expose on/off state
- Kept: [01-tuner.md #38](01-tuner.md) Trace and tendencies have no text alternative
  - Same as: [08-ui-ux-a11y.md #40](08-ui-ux-a11y.md) 40. Tendencies values are only in tooltips
- Kept: [02-metronome.md #67](02-metronome.md) The count-in label talks to screen readers every beat
  - Same as: [08-ui-ux-a11y.md #21](08-ui-ux-a11y.md) 21. Live regions announce every beat
