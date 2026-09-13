# UI, UX and accessibility gaps

I found 142 separate gaps and stopped there. I read every file in scope and none of these repeats one of the 78 items in `docs/gap-analysis.md`. Some are close to an existing item but aimed at a different part of the problem, and those say so (for example 7, 8 and 125). How I checked:

- **Contrast ratios** were worked out with the WCAG relative-luminance formula from the token hex values in `src/styles.css`, blending alpha tokens over their background. I did not measure them in a browser.
- **Font coverage** comes from the `unicode-range` lines in `node_modules/@fontsource-variable/*/index.css`, so that part is checked.
- **Competitor behaviour and platform quirks** are marked [unverified].
- Nothing has been tested on a device or with a screen reader.

### 1. Segmented buttons lose their accessible name on phones
Evidence: styles.css:327-332 hide `.toolbar .seg-btn span` at max-width 640px. The icon inside is `aria-hidden` (icons.ts:59), and components.ts:35-50 sets no `aria-label` on the button. So Tuner mode, Ring/Bar/Strobe and Page layout become radios with no name (WCAG 4.1.2).
Fix: in `segmented()` add `'aria-label': o.label` to every `.seg-btn`, or hide the span with `.visually-hidden` instead of `display:none`. Test: Chrome DevTools accessibility pane at 375px wide shows a name for every radio.
Effort: S

### 2. Segmented control is not a proper radio group for the keyboard
Evidence: components.ts:35-57 renders every radio as its own Tab stop and has no arrow-key handling, which the ARIA APG radio group pattern expects.
Fix: roving tabindex (`tabindex=0` only on the checked button, -1 on the rest). Add keydown for ArrowLeft/Right/Up/Down/Home/End that moves focus, calls `set()` and `onChange()`. Test: Tab lands once on the group and the arrows change the selection.
Effort: S

### 3. Clicking a field label selects the first option of a segmented control
Evidence: `field()` wraps its control in a `<label>` (dom.ts:53-55). A label forwards clicks to its first labelable descendant, which is the first `.seg-btn`. Clicking the words "Range", "Direction" or "Note length" (sound.ts:406-408) or "Percent of beats" (metronome.ts:171) silently picks the first option.
Fix: add `fieldGroup(label, control)` that renders a `div.field` with a `span` whose id feeds the group's `aria-labelledby`, and use it for all non-native controls. Test: click the label text and confirm nothing changes.
Effort: S

### 4. Visible group labels are not tied to their controls
Evidence: tuningSheet.ts:65-66 and 71-80, tuner.ts:34-35, 40 and 56 show a `span.field-label` and repeat the text in `aria-label`. The two can drift apart, and WCAG 1.3.1 wants a programmatic link.
Fix: generate an id for the span and pass `aria-labelledby` into `segmented()` instead of `ariaLabel`.
Effort: S

### 5. Sheets do not trap focus
Evidence: `openSheet()` (components.ts:110-147) sets `aria-modal="true"` but Tab moves out into the page behind. `#app` is never made `inert`.
Fix: when a sheet opens, set `document.getElementById('app').inert = true` and do the same for `.dock` and `.tabbar` (siblings of the layer). Clear it in `close()`. Test: Tab from the last control wraps to the Close button.
Effort: S

### 6. First focus in a sheet lands on Close
Evidence: components.ts:132 focuses the first `button, input, select`, which is always the header Close button (line 117). Screen reader users hear "Close, button" before the title, and on the welcome sheet one Enter dismisses onboarding.
Fix: give the `h2` `tabindex="-1"` and focus it, or focus `.sheet-body`'s first control. Link the title with `aria-labelledby` instead of `aria-label`.
Effort: S

### 7. Back button does not close sheets
Evidence: `openSheet` never touches history (components.ts:110). On Android, and in standalone PWA mode, Back leaves the screen or the app while a sheet is open.
Fix: `history.pushState({sheet: true}, '')` on open. A `popstate` listener calls `close()`. When closing through the UI, call `history.back()` if `history.state?.sheet`. Test: open Tuning, press browser Back, and the sheet closes while the route stays.
Effort: M

### 8. Sheet music reader state is not in the URL
Evidence: sheetmusic.ts:288-289 switches library and viewer with `hidden`. Back from an open score leaves Sheet music entirely, and there is no deep link to a score or page. This is separate from gap item 34, which is about assignment links.
Fix: route `#/sheet/<scoreId>/<page>`. `openScore` sets the hash (use `replaceState` for page turns) and the router passes a sub-path to the mount.
Effort: M

### 9. Unknown routes are not corrected
Evidence: router.ts:13-14 renders the tuner for any unknown hash but leaves the bad hash in the address bar, and nothing says the link was wrong.
Fix: when `routes.find` misses, `history.replaceState(null, '', '#/' + routes[0].path)` and show `toast('That page does not exist, showing the Tuner')`.
Effort: S

### 10. Focus and scroll are not handled on route change
Evidence: router.ts:17 sets `outlet.scrollTop = 0`, but `main` does not scroll (styles.css:226-233 has no overflow), so the window keeps its old scroll position. Focus stays on the tab link and nothing tells a screen reader the screen changed.
Fix: `window.scrollTo(0, 0)`, then `title.tabIndex = -1; title.focus({preventScroll: true})` in the `startRouter` callback in main.ts:204. Test: scroll Practice down, switch to Tuner, and the page is at the top with the h1 announced.
Effort: S

### 11. Navigating away mid-take stops the recording without warning
Evidence: recorder.ts:470 calls `recorder.stop()` on cleanup when you change tab. Reloading or closing the tab loses the take, and there is no `beforeunload`.
Fix: while recording, add `window.onbeforeunload = e => e.preventDefault()`. Intercept `hashchange` by restoring the previous hash and opening a confirm sheet ("Stop recording and save the take?").
Effort: M

### 12. Mobile tab bar does not show where you are on secondary screens
Evidence: main.ts:213 adds only `.active` to the More button. It has no `aria-current`, `aria-haspopup` or `aria-expanded` (main.ts:91), and the tiles in the More sheet do not mark the current page (main.ts:85).
Fix: on More, set `aria-haspopup="dialog"` and, when a secondary route is active, `aria-label="More, current: Record"`. Add `aria-current="page"` and `.active` to the matching `.more-tile`.
Effort: S

### 13. Single-letter shortcuts cannot be turned off (WCAG 2.1.4, Level A)
Evidence: controls.ts:21-33 (M, D, ?, 1 to 9) and metronome.ts:497 (T) fire on unmodified keys anywhere. Speech-input users can trigger them by accident.
Fix: add a `shortcuts: boolean` setting with a switch in the Accessibility card (practice.ts:214-221). Check it in `installGlobalShortcuts` and each view's `onKey`.
Effort: S

### 14. Keys leak through open sheets on three screens
Evidence: metronome.ts:486 checks `.sheet-layer.open`, but tuner.ts:577-583, clicktrack.ts:368-374 and sheetmusic.ts:540-552 do not. Space in an open sheet toggles the tuner behind it, and arrows turn score pages.
Fix: a shared `isModalOpen()` helper in components.ts, returned early from every view `onKey`.
Effort: S

### 15. Sheet reader steals Space and arrows from focused controls
Evidence: sheetmusic.ts:541 skips only `HTMLInputElement`. Space on the focused Annotate button toggles annotation and turns the page, and arrows on the layout radios turn pages.
Fix: also return when `e.target` is a `HTMLButtonElement` and the key is Space or Enter, or when it is inside `[role=radiogroup]` or a `select`.
Effort: S

### 16. Help says Space starts analysis, but it does not
Evidence: main.ts:127 lists analysis, but analysis.ts has no keydown handler. On Sheet music, Space turns the page.
Fix: add a Space handler to `mountAnalysis` calling `toggle()` (with the modal and button guards from 14), and correct the help text to say Space turns pages in sheet music.
Effort: S

### 17. Shortcut list is inaccurate and incomplete
Evidence: main.ts:130 shows `1` `9` as two keys with no "to" and says "1 to 9", but there are 8 routes (main.ts:46-55, and README says 1 to 8). It leaves out Page Up/Down, Ctrl+Z while annotating (sheetmusic.ts:542), Shift+arrows on the dial, and the Page keys.
Fix: build the row from `routes.length` ("1 to 8") with a "to" separator, add the missing rows, and group them by screen.
Effort: S

### 18. Metronome re-renders presets and badges every bar, destroying keyboard focus
Evidence: the `onBeat` handler calls `render()` on beat 0 (metronome.ts:458). That runs `renderPresets()` (replaceChildren, line 349) and `trainerBadge.replaceChildren` (line 419). A focused preset chip or mode badge is removed each bar, and a sheet opened from a badge returns focus to a detached node (components.ts:142).
Fix: rebuild presets and badges only when their data changes (keep a key like `lastBeatsKey`). On beat 0 update only text. Test: tab to a preset chip while playing, and focus stays for 10 bars.
Effort: S

### 19. Tapping a beat block loses focus
Evidence: renderBeats (metronome.ts:324-343) replaces every button whenever accents change, so pressing Enter on beat 3 leaves focus on body.
Fix: update `className` and `aria-label` on the existing buttons when the count is unchanged, and rebuild only when `beatsPerBar` changes.
Effort: S

### 20. Beat blocks do not expose their accent state
Evidence: the `aria-label` "Beat 1, accent. Tap to change." (metronome.ts:331) says "Tap" to keyboard users and embeds the state in the name.
Fix: name "Beat 1", add `aria-description="accent"` (or visually hidden text), and set `aria-roledescription="accent toggle"`. Replace "Tap" with "Press".
Effort: S

### 21. Live regions announce every beat
Evidence: `countInLabel` is `aria-live=polite` and is updated on each beat with "Count-in · 2" or "silent" (metronome.ts:278, 436). Click-track `nowPlaying` is `aria-live` and rewritten every beat (clicktrack.ts:80, 290). At 120 BPM this floods a screen reader.
Fix: take `aria-live` off both. Announce only section changes, count-in start and "Finished" through `announce(text, true)` in controls.ts.
Effort: S

### 22. Sounding-drones list re-announces on every change
Evidence: `sounding` has `aria-live=polite` and holds buttons plus helper text (sound.ts:187, 216-220), so each toggle reads the whole list.
Fix: remove `aria-live`. Call `announce('C4 drone on')` or `'off'` from the press handler.
Effort: S

### 23. Screen readers can miss toasts
Evidence: `toast()` creates a new `role=status` node that already contains its text (components.ts:152). Live regions inserted already populated are often not announced [unverified per screen reader].
Fix: create one persistent `div.toast-region` with `role=status` at startup and set its `textContent` inside a `requestAnimationFrame`.
Effort: S

### 24. The first screen-reader announcement is dropped
Evidence: announce() creates the live region on first use and writes text immediately (controls.ts:148-155), so the first tuner reading can go unannounced.
Fix: create the region at module load from `restoreMidi()` or main.ts.
Effort: S

### 25. Toasts stack and can be too short to read (WCAG 2.2.1)
Evidence: each toast is a new fixed element at the same position (components.ts:151-159, styles.css:1154-1173), so overlapping toasts cover each other. The fixed 2200ms is too short for controls.ts:95 (107 characters). `border-radius:999px` on wrapped text looks broken, and `max-width` is not set.
Fix: queue toasts, set duration to `max(2500, 60 * message.length)` ms, add `max-width: min(90vw, 420px)`, and use `border-radius: var(--radius)` when the text wraps.
Effort: S

### 26. Toast position ignores the desktop rail
Evidence: `.toast` uses `left:50%` (styles.css:1157) while the dock shifts to `calc(50% + var(--rail-w)/2)` at 1024px and up (styles.css:513). The bottom offset assumes a tab bar that desktop hides.
Fix: in the 1024px media query, `.toast { left: calc(50% + var(--rail-w)/2); bottom: 90px }`.
Effort: S

### 27. Focus ring removed on all inputs, replaced by a faint glow
Evidence: `select:focus, input:focus { outline:none; box-shadow: 0 0 0 3px color-mix(brand 22%) }` (styles.css:644-649) also applies to switches, ranges and checkboxes. A 22% brand glow is about 1.3:1 against the surface, and a switch has no border to recolor.
Fix: limit the rule to text, number and select inputs. For `input[role=switch]:focus-visible`, `input[type=range]:focus-visible` and checkboxes, keep `outline: 2px solid var(--brand); outline-offset: 2px`.
Effort: S

### 28. Hidden file inputs show no focus (WCAG 2.4.7)
Evidence: "Import backup" (practice.ts:266-289) and the sheet drop zone (sheetmusic.ts:59-72) put a `.visually-hidden` file input inside a label with no `:focus-within` style. `.visually-hidden` also lacks `margin:-1px; padding:0; border:0` (styles.css:140-147).
Fix: `.pill-btn:focus-within, .drop-zone:focus-within { outline: 2px solid var(--brand); outline-offset: 3px }` and complete the visually-hidden recipe.
Effort: S

### 29. Focused elements can hide under the sticky top bar, dock and tab bar (WCAG 2.4.11)
Evidence: the sticky `.topbar` (styles.css:236) and the fixed `.dock` and `.tabbar` (489, 364) cover elements scrolled into view by Tab, and no `scroll-padding` is set.
Fix: `html { scroll-padding-top: 72px; scroll-padding-bottom: calc(var(--tab-h) + 90px + env(safe-area-inset-bottom)) }`, with desktop values in the 1024px query. Test: tab through Practice at 375x667 and the focused element is always visible.
Effort: S

### 30. Sheet reader sticky offsets are magic numbers
Evidence: `.viewer-bar { top: 60px }` (styles.css:2957) and `.ink-bar { top: 128px }` (3509) ignore the desktop topbar height (18px top padding, taller) and `safe-area-inset-top`. On phones `.viewer-bar` wraps to 2 or 3 rows, so the ink bar overlaps it.
Fix: measure `.topbar` height into `--topbar-h` with a ResizeObserver in main.ts. Use `top: var(--topbar-h)` and put the ink bar inside the sticky viewer bar container.
Effort: S

### 31. Skip link is barely styled
Evidence: `.skip:focus` sets only background and padding (styles.css:154-160), with no text color, shadow or font weight, and the link is default blue underlined.
Fix: `color: var(--text); font-weight: 600; box-shadow: var(--shadow-2); text-decoration: none`.
Effort: S

### 32. Tempo name button is below the minimum target size (WCAG 2.5.8)
Evidence: `.bpm-marking` is 0.9rem with line-height 1 from `.bpm-stack` and `padding: 2px 8px` (styles.css:1964-1991), about 18px tall, 6px below the BPM input, which is also a target.
Fix: `min-height: 28px; padding: 4px 10px; line-height: 20px`. Test: `getBoundingClientRect().height >= 24`.
Effort: S

### 33. Hold-to-repeat steppers are small for phone use
Evidence: `.mini-stepper .step` is 28x28 (styles.css:3305-3314) and `.dock-step` is 32x32 (532-541). They pass the 24px WCAG minimum but fall short of the 44pt Apple HIG guideline [unverified current value], and click-track editing happens on phones on music stands.
Fix: 40px at `(pointer: coarse)`. Let `.section-grid` go to `minmax(150px, 1fr)` so there is room.
Effort: S

### 34. Hold buttons fire on pointerdown (WCAG 2.5.2)
Evidence: holdButton calls `onStep()` in `onpointerdown` (components.ts:85-92), and so do the wheel and piano (sound.ts:91-99, 151-155). Repeat-on-hold is arguably essential, but single-step buttons like the A4 stepper cannot be cancelled by sliding off.
Fix: for holdButton, fire the first step on pointerdown only after 150ms, or on pointerup if released sooner, and cancel if the pointer leaves. Leave the instruments as they are (essential exception) and document that.
Effort: S

### 35. Controls inside the tempo dial slider
Evidence: the dial is `role=slider` (components.ts:219) but contains a focusable `input.bpm-input` and `button.bpm-marking` (metronome.ts:261). Slider children are presentational in ARIA, so screen readers may never reach them. The dial label also carries usage instructions (metronome.ts:259).
Fix: move `role=slider`, `tabindex` and the key handling onto the SVG ring (or an overlay element) and leave the center as a sibling. Label "Tempo", with instructions in `aria-describedby`.
Effort: M

### 36. Dial wheel handling traps page scroll and jumps on trackpads
Evidence: components.ts:271-281 calls `preventDefault` on every wheel event over a 300px area and applies one step per event whatever the `deltaY` size. Trackpad momentum sends dozens of events, so the tempo jumps and the page will not scroll past the dial.
Fix: accumulate `deltaY` and step once per 50px. Only `preventDefault` when the dial has focus or the pointer went down on it, otherwise let the page scroll.
Effort: S

### 37. Large touch surfaces block page scrolling
Evidence: `.dial { touch-action: none }` at 72vw (styles.css:1885) and `.wheel { touch-action: none }` at 92vw (2435) cover most of a phone screen. A scroll that starts on them does nothing.
Fix: `touch-action: pan-y` on the container, with `touch-action: none` set only after the pointerdown lands on the ring band (radius check as in `pcAt`). Or restrict the drag to the outer 30% ring.
Effort: M

### 38. Dial ignores Home and End
Evidence: the components.ts:282-291 keydown handles arrows and Page keys only, while the APG slider pattern includes Home and End.
Fix: `Home` sets `opts.min` and `End` sets `opts.max`.
Effort: S

### 39. Tuner stage button does not expose on/off state
Evidence: `button.tuner-stage` has a static `aria-label` "Start or stop the tuner" (tuner.ts:187). Listening is shown only by CSS class and hint text.
Fix: `aria-pressed` set to `tracker.running` in `toggle()`, with the label "Tuner".
Effort: S

### 40. Tendencies values are only in tooltips
Evidence: each bar's data sits in `title` (tuner.ts:232). Touch users cannot hover and screen readers read the column letters only.
Fix: make the `.tend` element `role=img` with `aria-label` set to the same string. On tap, show the detail in `tendCaption`.
Effort: S

### 41. Practice calendar cells are only in tooltips
Evidence: heatmap `<i>` cells carry `title` only (practice.ts:159), so they cannot be read or tapped.
Fix: make `.heatmap` a `role=grid` of `role=gridcell` items with `aria-label="Mon Sep 8: 25m"`, and show the value on tap in a caption.
Effort: S

### 42. Heatmap levels are hard to tell apart and have no legend
Evidence: computed contrast is 1.23:1 for an empty cell (`--surface-3`) against the white card and 1.52:1 for level 1 against empty (styles.css:2781-2796), with no key.
Fix: put a 5-swatch legend "Less ... More" under the grid. Give empty cells `box-shadow: inset 0 0 0 1px var(--line-2)` and raise level 1 to 45% brand.
Effort: S

### 43. Analysis chart has no text alternative
Evidence: the canvas `aria-label` is a static "Analysis chart" (analysis.ts:34). The spectrum, harmonics and staff content never reaches assistive technology (WCAG 1.1.1).
Fix: update `aria-label` from `draw()` on a 1 second throttle, for example "Harmonics: 2nd -6 dB, 3rd -12 dB" or "Staff: last notes A4 in tune, B4 +12 cents".
Effort: M

### 44. Recording state is not announced
Evidence: `recBtn` changes only `aria-label` (recorder.ts:134), and `recState` "Recording" is not live (line 66).
Fix: give `recState` `role=status`, or call `announce('Recording started', true)` and `'Take saved'`. Add `aria-pressed` on `recBtn`.
Effort: S

### 45. Range sliders read out raw numbers
Evidence: the take progress runs 0 to 1000 with no valuetext (recorder.ts:232), and the metronome and drone volumes read 0.35 (metronome.ts:291, sound.ts:262).
Fix: set `aria-valuetext` on input, for example "1:23 of 3:10" and "35 percent".
Effort: S

### 46. Piano keys are 73 tab stops with no pressed state
Evidence: each key is a button with `aria-label` but no `aria-pressed` (sound.ts:141-150), from C1 to C7.
Fix: roving tabindex across keys (Left and Right arrows by semitone) and `aria-pressed` in `render()`.
Effort: S

### 47. Keyboard-played piano ignores chord and sustain modes
Evidence: Enter and Space call `toggleNote(m)` (sound.ts:164-168), but pointer input calls `press(m)`, which honours "Play as" and sustain (lines 31-39).
Fix: call `press(m)` on keydown and `release(m)` on keyup.
Effort: S

### 48. Toggle chips do not expose their state
Evidence: `.chip.on` is class-only on the tuner Auto chip (tuner.ts:287, 299), preset chips (metronome.ts:354), click-track library chips (clicktrack.ts:124) and ink tools and swatches (sheetmusic.ts:199-217). The swatch names are hex codes ("Pen colour #111418", line 200).
Fix: `aria-pressed` on toggles (`aria-current="true"` for the selected track), and name the swatches Black, Red, Blue, Green.
Effort: S

### 49. String buttons do not say what they do
Evidence: a string button's name is "E 2" (tuner.ts:305-311). It never says that pressing plays a reference or that the string is the active target, and in-tune state is class-only.
Fix: `aria-label` like "Low E string, E2, play reference", plus `aria-pressed` for the manual selection. Include "in tune" or "sharp" in `aria-description` when active.
Effort: S

### 50. Session chip hides a destructive reset
Evidence: the chip's name is "42% in tune", and the "Tap to reset" behaviour is only in `title` (main.ts:107-111). One tap wipes the session with no undo.
Fix: `aria-label="42% in tune this session. Reset"`. Open a small popover with the count and a Reset button instead of resetting on tap.
Effort: S

### 51. Visible text missing from accessible names (WCAG 2.5.3, Level A)
Evidence: the tuning chip shows "A4 440 · Equal" but is named "Tuning settings" (main.ts:99). The dock BPM link shows "100 BPM · 4/4" but is named "Open metronome" (main.ts:151). The tempo name shows "Andante" but is named "Tempo names and quick jumps" (metronome.ts:253). Speech users saying the visible words miss them.
Fix: start each name with the visible text, for example `aria-label="${tuningSummary()}, tuning settings"`, updated on render.
Effort: S

### 52. Timeline buttons are hidden inside role=img
Evidence: `.timeline` is `role=img` (clicktrack.ts:77) but contains section `button`s (line 104) that jump to the editor. Descendants of an img are presentational.
Fix: use `role=list` with `role=listitem` buttons, and name them in the same format as their `title`.
Effort: S

### 53. Unlabelled selects in click-track sections
Evidence: the "Beat unit" and "Subdivide" selects sit next to a `span` (clicktrack.ts:208-215) with no `aria-label` or `<label>` (WCAG 3.3.2 and 4.1.2). The stepper `output`s are not labelled either.
Fix: make `.mini-stepper` a `<label>` for selects, or add `aria-label`. Set `output` `aria-labelledby` to the span id.
Effort: S

### 54. Score pages are silent to screen readers
Evidence: page canvases have no role or label, turning happens on a `div` click (sheetmusic.ts:499-503), and `pageLabel` is not live.
Fix: `canvas.setAttribute('role', 'img')` with `aria-label="Page 3 of 12"`, and `announce('Page 3 of 12', true)` in `go()`.
Effort: S

### 55. Sheet reader toolbar buttons rely on title only
Evidence: the click, tuner, night and annotate buttons (sheetmusic.ts:163-182) have `title` but no `aria-label`. Once the readout span fills, the tuner button's name becomes "A +3¢", and touch users never see tooltips.
Fix: static `aria-label`s ("Metronome", "Tuner", "Night mode", "Annotate"), with the readout in `aria-describedby`.
Effort: S

### 56. Heading levels skip from h1 to h3
Evidence: views go straight from the page `h1` to `h3` in cards (practice.ts:180-225, sound.ts:399, metronome.ts:150), while recorder.ts:461 uses `h2`.
Fix: use `h2` for card titles on every screen and restyle `.card h2` to match the current h3 look.
Effort: S

### 57. Radius values scattered outside the tokens
Evidence: the tokens are 10, 16 and 24px (styles.css:35-37), but hard-coded radii include 26px (1092), 32px (1289), 20px (1507, 1605), 18px (1736, 2966), 14px (1818, 3058), 12px (726, 855, 1195), 9px (869), 8px (3257), 6px (192, 1552) and 7px (2548). That is at least 10 values off the scale.
Fix: add `--radius-xs: 6px` and `--radius-xl: 28px`, and swap every literal for the nearest token (grep `border-radius: [0-9]`).
Effort: M

### 58. No spacing scale
Evidence: gaps and paddings use 1, 2, 3, 4, 5, 6, 8, 10, 12, 13, 14, 16, 18, 20, 24, 26 and 28px. Card padding alone is 18 (`.card` 961), 14 (`.section-card` 2815), 20 (`.practice-hero` 2677), 14/16 (`.take` 3628), 28/20 (`.rec-panel` 2878) and 10 (`.chart-card` 2643).
Fix: define `--space-1` to `--space-8` (4, 8, 12, 16, 20, 24, 32, 40), set one card padding `var(--space-5)`, and migrate.
Effort: M

### 59. Too many font sizes
Evidence: at least 28 distinct rem sizes, from 0.62 to 2.4rem, including 0.7, 0.72, 0.76, 0.78, 0.8, 0.82, 0.84, 0.85, 0.86 and 0.88, plus weights 560, 620 and 650.
Fix: a 7-step scale (`--text-xs` 0.75rem up to `--text-3xl`) and 3 weights (500, 600, 700). Fold the neighbours together.
Effort: M

### 60. Text as small as 7.5px
Evidence: `.dock-bpm span` and `.tend b` are 0.62rem (9.3px) (styles.css:560, 1579). `.wedge-freq` is 9.5px in a 340-unit viewBox (2469), so at the 270px wheel minimum it draws at about 7.5px.
Fix: minimum 0.72rem for UI text. Scale wedge-freq to 11 units or hide it below 320px wheel width.
Effort: S

### 61. Root font size fixed in px overrides the user's browser text setting (WCAG 1.4.4)
Evidence: `html, body { font: 15px/1.5 ... }` (styles.css:123), so a user who sets 20px default text gets 15px.
Fix: `html { font-size: 93.75% }` and `body { font: 1rem/1.5 var(--font-ui) }`. Test with Chrome font size "Very large".
Effort: S

### 62. Fixed-height components clip enlarged or spaced text (WCAG 1.4.4, 1.4.12)
Evidence: `.icon-btn` 38px (724), `.chip` 34px with nowrap (815, 822), `.seg-btn` 32px with nowrap (867, 874), inputs 42px (624) and `.tuning-chip` 36px (281).
Fix: replace `height` with `min-height` plus vertical padding. Test with the WCAG text-spacing bookmarklet (line-height 1.5, letter-spacing 0.12em) at 200% text size.
Effort: M

### 63. Canvas text ignores user font scaling
Evidence: canvas fonts are hard-coded px (analysis.ts:180, 202, 292, 334, 391), so axis labels stay 11px when the user enlarges text.
Fix: multiply by `parseFloat(getComputedStyle(document.documentElement).fontSize) / 16` when building `ctx.font`.
Effort: S

### 64. Metronome tempo row overflows at 320px (WCAG 1.4.10)
Evidence: dial `min(72vw, 300px)` is 230px at 320px, plus two 56px `.round-btn` and two 9.6px gaps, which is about 361px against 284px of content width (styles.css:1837-1843, 1844-1856, 1883).
Fix: below 380px, `.tempo-row { flex-wrap: wrap }`, put the +/- buttons under the dial, or use `.dial { width: min(60vw, 300px) }` with 44px buttons. Test at 320px, and at 1280px with 400% zoom.
Effort: S

### 65. Dock overflows narrow phones
Evidence: the dock holds a 40px play button, 2x32px steps, a 58px-min BPM block, beat dots (7 or more in 7/8, 12 in 12/8, each 7px plus 4px gaps plus 16px padding), a drone pill of about 120px, 4px gaps and 12px padding. Nothing wraps or shrinks (`.dock` styles.css:489-506), so it spills past `max-width: calc(100vw - 20px)`.
Fix: `.dock-beats { display: none }` when `beatsPerBar > 6` or width < 400px. Let the drone pill collapse to icon plus count (`min-width: 0`, text `overflow: hidden`).
Effort: S

### 66. Top bar crowds on small phones
Evidence: title "Click tracks" or "Sheet music" at 1.15rem sits next to the session chip, tuning chip "440 B♭" and help button. `.page-title` has no `min-width: 0` or ellipsis (styles.css:248-251).
Fix: `.page-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }`. Below 360px, move the session chip into the tuning sheet.
Effort: S

### 67. Practice stat cards overflow at 320px
Evidence: `.stat-cards` is `repeat(3, 1fr)` (styles.css:2743-2748), each about 88px with 28px padding, holding `b` at 1.6rem such as "12h 30m" (practice.ts:178).
Fix: `grid-template-columns: repeat(auto-fit, minmax(100px, 1fr))` and `font-size: clamp(1.1rem, 5vw, 1.6rem)`.
Effort: S

### 68. Sheet reader toolbar eats phone height
Evidence: `.viewer-bar` wraps into 3 rows (title, tools with a labelled segmented control, nav) at 375px (sheetmusic.ts:236-251, styles.css:2955-2971), roughly 130px above the score.
Fix: below 640px, one row with Back, page label, prev/next and an overflow "..." sheet for metronome, tuner, night, annotate and layout. Auto-hide the bar after 3 seconds of no interaction.
Effort: M

### 69. Tablets get the phone layout
Evidence: the only structural breakpoint is 1024px (styles.css:408). iPad portrait (768 to 1023px) gets the bottom tab bar and a single column capped at 980px, and the tuner trace and tendencies stack below the ring.
Fix: at 768px and up, use a 2-column grid in `.view.tuner` (ring left, trace and tendencies right) and in `.view.metronome` (dial left, beats, transport and presets right). Consider the rail from 900px.
Effort: M

### 70. Large desktops waste space
Evidence: `main { max-width: 980px }` (styles.css:228), the ring capped at 420px (1297) and the analysis canvas at 420px tall (2649). At 2560px wide, more than half the area is empty.
Fix: at 1600px and up, raise `main` max-width to 1280px, let the analysis canvas use `height: clamp(240px, 60dvh, 720px)`, and show analysis stats in a side column.
Effort: M

### 71. Breakpoints are inconsistent
Evidence: 520, 560, 600, 640, 720 and 1024px (styles.css:634, 2680, 2100, 300, 1132, 408), with no shared definition.
Fix: settle on 480, 768 and 1024 and replace the others. Document them at the top of styles.css.
Effort: S

### 72. Left and right safe-area insets ignored
Evidence: only top and bottom `env(safe-area-inset-*)` are used (styles.css:230, 242, 370). With `viewport-fit=cover` (index.html:5), a notched phone on its side clips the topbar title and tab bar edges. This is separate from gap item 64, which is about landscape layout.
Fix: `padding-left: max(18px, env(safe-area-inset-left))` and the right-side equivalent on `.topbar`, `main`, `.tabbar` and `.sheet`.
Effort: S

### 73. Screen flash can break the three-flashes rule (WCAG 2.3.1, Level A)
Evidence: `flashScreen` flashes the whole viewport to 45% opacity on every non-silent beat (metronome.ts:452-457, styles.css:2392-2410), with no BPM cap. Above 180 BPM that is more than 3 full-screen flashes a second, and reduced-motion does not stop it.
Fix: when `bpm * subdivision > 170` or `prefers-reduced-motion`, flash only a border band under 25% of the viewport, or skip alternate beats. Add a warning line to the switch description.
Effort: S

### 74. Reduced motion makes the pendulum jump
Evidence: the global reduce rule sets transitions to 1ms (styles.css:3751-3759), so the pendulum snaps side to side every beat (2239), which is more jarring. Pulse `scale(1.5)` becomes a 1ms pop.
Fix: under `prefers-reduced-motion`, fall back from pendulum and pulse to blocks (or a static beat number with an opacity change) and say so in the visual picker.
Effort: S

### 75. Loading spinner freezes under reduced motion
Evidence: the reduce rule forces `animation-iteration-count: 1` and 1ms duration, so `.spinner` (1051-1058) shows as a static partial ring and looks hung.
Fix: exempt `.spinner` (`animation: spin 1.6s linear infinite !important` inside the reduce query), or swap it for a pulsing opacity.
Effort: S

### 76. JavaScript smooth scrolling ignores reduced motion
Evidence: `scrollIntoView({behavior: 'smooth'})` in clicktrack.ts:110, which CSS cannot override.
Fix: `behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'`.
Effort: S

### 77. Sheet is removed before its close animation ends
Evidence: close() removes the layer after 220ms (components.ts:140), but the mobile slide-down transition is 260ms (styles.css:1098), so the last frames are cut.
Fix: remove on `transitionend` of the panel, with a 400ms fallback timeout.
Effort: S

### 78. No motion tokens
Evidence: durations of 60, 80, 90, 100, 120, 150, 160, 180, 200, 220, 250, 260, 300, 400, 450, 800 and 900ms, with only one easing token.
Fix: `--dur-fast: 120ms; --dur: 200ms; --dur-slow: 400ms`, with `--ease-out` and `--ease-in-out`, and migrate.
Effort: S

### 79. Form field borders fail non-text contrast (WCAG 1.4.11)
Evidence: `--line-2` is `rgba(15,23,42,.14)`, computed 1.34:1 on white and 1.45:1 on the dark surface. It is the only boundary of inputs and selects (styles.css:627).
Fix: new token `--control-border` at `#8a93a3` light and `#5c6575` dark (check each is 3:1 or better against surface) for inputs, selects, the chip outline and the icon-btn border.
Effort: S

### 80. Off switches are almost invisible
Evidence: the off track uses `--surface-3` `#e5e8ee` on white, computed 1.23:1, and the thumb is white (styles.css:693-715).
Fix: off track `background: var(--control-border)`, or add `box-shadow: inset 0 0 0 1.5px var(--control-border)`. Give the thumb a 1px border.
Effort: S

### 81. Range sliders show no filled portion and the track is faint
Evidence: the track is `--surface-3` at 1.23:1 (styles.css:661-670) and there is no progress fill, so the current value is hard to read at a glance.
Fix: set `--fill: <percent>` on input and use `background: linear-gradient(90deg, var(--brand) var(--fill), var(--control-border) var(--fill))` on the track.
Effort: S

### 82. Selected state in segmented controls, chips and tiles is low contrast
Evidence: a selected `.seg-btn` is a white surface on `--surface-2` plus `--shadow-1` (styles.css:880-884), about 1.1:1 for the pill. `.chip.on` uses 16% brand. Selection relies on a faint fill plus a text colour change (WCAG 1.4.11).
Fix: selected seg-btn gets `box-shadow: inset 0 0 0 1.5px var(--brand)` or brand-tinted text plus a 2px underline. `.chip.on` gets `border-color: var(--brand)` at 100%.
Effort: S

### 83. Danger text below 4.5:1 in light mode
Evidence: `--danger: #d6404b` on white computes to 4.47:1 for "Delete track" and "Reset" pill text (styles.css:790-793), which is not large text.
Fix: `--danger: #c93440` or darker in light mode, then recheck 4.5:1 or better.
Effort: S

### 84. Status text on tinted chips below 4.5:1
Evidence: `--good` on `--good-soft` computes to 4.30:1 for the `.dock-drone` text at 0.78rem (styles.css:596-598) and `.note-chip.good`. `--sharp` on `--sharp-soft` is 4.25:1 for `.trainer-badge` (1979-1982).
Fix: use `--text` for chip text and keep the colour for the icon or a 3px leading bar. Or darken to `#086a48` and `#9a4607`.
Effort: S

### 85. Dock beat dots and piano labels below contrast
Evidence: off beat dots are `--surface-3` on the dock at 1.23:1 and 7px (styles.css:571-577). The piano `.key-label` is `#6b7280` on `#f1f2f5` at 4.32:1 (2537).
Fix: off dots `var(--control-border)`, key label `#4b5563`.
Effort: S

### 86. In tune and sharp differ only by hue, not lightness
Evidence: light `--good #0a7d55` against `--sharp #b45309` is 1.03:1 in luminance, so for deuteranopes they read as the same colour. Charts rely on colour alone: the tuner trace (tuner.ts:510), analysis pitch lines (analysis.ts:230), the staff (caption at analysis.ts:68 says "Green is in tune, orange sharp, blue flat"), take chart dots (recorder.ts:421) and tendencies bars (WCAG 1.4.1).
Fix: encode direction with a second cue. Dash sharp segments (`setLineDash([6, 3])`), draw flat readings as open dots, and put ▲/▼ glyphs on tendency bars. Change the caption to describe the pattern and fix "orange" to match the amber token. Test in Chrome DevTools, Rendering, emulate deuteranopia.
Effort: M

### 87. Night mode makes annotations invisible
Evidence: `.viewer.night canvas.page { filter: invert(.92) hue-rotate(180deg) }` (styles.css:3560-3562) inverts only the page, not the separate ink canvas. The black pen `#111418` (sheetmusic.ts:19) on the now-dark page vanishes, and the highlighter's `multiply` blend (line 410) has almost no effect on dark.
Fix: apply the same filter to `canvas.ink` in night mode, or swap pen colours at draw time. Draw the highlighter with `screen` blending in night mode.
Effort: S

### 88. Sheet music ignores dark theme and does not remember night mode
Evidence: `canvas.page` and `.score-open` are fixed `#fff` (styles.css:2999, 3416), so white pages glare in dark theme. `night` is a local variable reset on every open (sheetmusic.ts:45).
Fix: persist `sheetNight` in settings, defaulting to on when the resolved theme is dark. Dim thumbnails in dark with `filter: brightness(.85)`.
Effort: S

### 89. Canvases keep old colours after a theme change or resize
Evidence: the take chart draws once in `requestAnimationFrame` (recorder.ts:407-424) and never redraws. Idle strobe and trace redraw only on a settings change or resize. Colours come from `cssVar` at draw time.
Fix: a shared `onThemeChange` (MutationObserver on `data-theme` plus the matchMedia change) and a ResizeObserver per canvas that calls its draw function.
Effort: S

### 90. Browser chrome colour ignores the in-app theme choice
Evidence: `meta theme-color` depends only on `prefers-color-scheme` (index.html:7-8), and `applyTheme()` (practice.ts:322-326) does not update it. Choosing Light on a dark OS leaves a black status bar in the PWA.
Fix: in `applyTheme`, remove the media metas and set one `meta[name=theme-color]` to `cssVar('--bg')` after the attribute changes.
Effort: S

### 91. Manifest theme colour does not match the app
Evidence: manifest `theme_color` is `#6a5ae0` and `background_color` is `#090b0f` (manifest.webmanifest:8-9), while `--brand` is `#5b4bd6` and the light `--bg` is `#f4f5f8`. Installed windows flash violet, then switch.
Fix: `theme_color: "#f4f5f8"`. Keep dark background only if the splash should be dark, and make it consistent with the meta tags.
Effort: S

### 92. Dark theme tokens are duplicated
Evidence: the full dark palette is written twice (styles.css:46-77 and 79-108), so edits can drift.
Fix: one `:root[data-theme='dark'], :root:not([data-theme='light'])` block inside the media query plus the explicit selector. Or use `@custom-media` at build time.
Effort: S

### 93. No forced-colors (Windows High Contrast) support
Evidence: grep finds 0 `forced-colors` rules. The custom switch (`appearance: none`, background-only, styles.css:693-721), segmented selection by background and box-shadow, `.beat-fill` heights by background, and heatmap cells all disappear when backgrounds and shadows are overridden.
Fix: an `@media (forced-colors: active)` block giving switches `border: 1px solid ButtonText` and a checked thumb in `Highlight`, `.seg-btn[aria-checked=true] { outline: 2px solid Highlight }`, beat fills with `forced-color-adjust: none` or a border, and heat cells with a `CanvasText` border. Test with Chrome DevTools, emulate forced-colors.
Effort: M

### 94. No prefers-contrast support
Evidence: 0 `prefers-contrast` rules. `--line` is 8% alpha (1.18:1), so card boundaries vanish for low-vision users who ask for more contrast.
Fix: `@media (prefers-contrast: more) { :root { --line: rgba(15,23,42,.3); --line-2: rgba(15,23,42,.5); --muted: #3f4754 } }`, with dark equivalents.
Effort: S

### 95. No print styles
Evidence: 0 `@media print` rules. Printing the Practice summary or a take report prints the fixed tab bar and dock over content and the dark `--bg-glow` background.
Fix: `@media print { .tabbar, .dock, .rail, .topbar-end, .sticky-play { display: none } body { background: #fff } .card { box-shadow: none; break-inside: avoid } }`.
Effort: S

### 96. Dark mode elevation relies on invisible shadows
Evidence: the dark `--shadow-1` is `0 1px 2px rgba(0,0,0,.4)` on a `#090b0f` background and borders are 7% white (styles.css:53, 73). Cards, chips and inputs barely separate.
Fix: in dark mode, raise `.card` to `--surface-2` against `--bg` and use `--line-2` for card borders. Lean on surface steps instead of shadows.
Effort: S

### 97. Too many button styles
Evidence: `.pill-btn`, `.button`, `button.primary`, `button.big`, `button.danger`, `.chip`, `.tool-btn`, `.icon-btn`, `.round-btn`, `.play-btn`, `.transport-play`, `.take-play`, `.dock-play`, `.record-btn`, `.seg-btn`, `.sound-tile`, `.meter-tile`, `.marking-row`, `.template` and `.more-tile`, each with its own height, radius and border.
Fix: a documented set of 4 variants (primary, secondary, ghost, danger) × 3 sizes (32, 40, 48) plus an icon-only modifier. Map every existing class to one.
Effort: L

### 98. Play buttons disagree on what "playing" looks like
Evidence: metronome playing turns the button to surface with a brand inset ring (styles.css:2317-2321). Click track playing turns it text-coloured (3332-3335). The dock goes brand when playing but is text-coloured when idle (517-531). Take play is always text-coloured (3658-3668), and the exercise play button has no playing style.
Fix: one rule. Idle is the brand gradient with a play icon; playing is the surface with a 3px brand ring and a stop icon. Apply to `.play-btn`, `.transport-play`, `.dock-play` and `.take-play`.
Effort: S

### 99. Icon sizes are inconsistent
Evidence: icons at 12, 14, 16, 18, 20, 22, 26, 28, 30 and 34px. `iconButton` always uses 20px (components.ts:63), whether the button is 32px (`.score-delete`) or 38px.
Fix: add a size parameter to `iconButton`, plus a table: 16 in chips and tool buttons, 20 in icon buttons, 24 in the tab bar and rail.
Effort: S

### 100. Icon stroke does not scale with size
Evidence: `stroke-width="1.8"` in a 24 viewBox for every size (icons.ts:59), so a 12px close icon draws a 0.9px hairline (dock-drone, main.ts:175) and a 34px icon looks heavy.
Fix: `stroke-width = size <= 14 ? 2.4 : size >= 28 ? 1.5 : 1.8`.
Effort: S

### 101. Icons reused for the wrong meaning
Evidence: Loop uses `undo` plus a `scaleX(-1)` CSS hack (clicktrack.ts:82, styles.css:3346). Duplicate uses `pages` (clicktrack.ts:195). The gap trainer badge uses `sustain` (metronome.ts:415). Stop-after uses `stop`, which looks like the transport stop. Import backup uses `save` (practice.ts:269).
Fix: add `loop`, `copy`, `gap`, `timer` and `upload` paths to icons.ts and swap them in.
Effort: S

### 102. Ad hoc shadows
Evidence: besides the 2 tokens, literal shadows include `0 8px 20px -10px brand` (784), `0 16px 34px -14px` (2311), `0 6px 16px -6px` (267), glows `0 0 24px/40px/60px` (2171, 2281, 2288) and `0 4px 8px` (2549).
Fix: add `--shadow-3` and `--glow-brand`, and replace the literals.
Effort: S

### 103. Hover states missing on many clickable elements
Evidence: no `:hover` for `.tool-btn` (3466), `.sound-tile` (3110), `.meter-tile` (2367), `.marking-row` (2058), `.template` (3354), `.more-tile` (1180), `.note-pill`, `.take-play`, `.transport-play`, `.play-btn`, `.string-btn`, `.tl-seg`, `.mode-badge` and `.dock-drone`.
Fix: shared `@media (hover: hover) { :is(.tool-btn, .sound-tile, ...):hover { background: var(--surface-2) } }`, with brightness or lift for the filled buttons.
Effort: S

### 104. Hover styles stick on touch screens
Evidence: `.wedge:hover` (2454), `.chip:hover` (826), `.score-open:hover { translateY(-3px) }` (3420) and `.icon-btn:hover` apply on tap and stay until you tap elsewhere.
Fix: wrap every `:hover` rule in `@media (hover: hover) and (pointer: fine)`.
Effort: S

### 105. No pressed feedback on touch
Evidence: `-webkit-tap-highlight-color: transparent` globally (styles.css:127), but `:active` exists only for `.icon-btn`, `.pill-btn`, `.round-btn` and `.play-btn`. Chips, segmented buttons, tool buttons, tiles, wedges and beat blocks give no tap response.
Fix: `:is(.chip, .seg-btn, .tool-btn, .sound-tile, .meter-tile, .marking-row, .template, .more-tile):active { transform: scale(.97); background: var(--surface-3) }`.
Effort: S

### 106. Disabled states are thin and inconsistent
Evidence: `button:disabled { opacity: .4 }` (616) and `.ref-btn:disabled { opacity: .45 }` (1688) differ. Hover still applies to disabled chips, inputs and selects have no disabled style, and "Hear target" is disabled with the reason only in `title` (tuner.ts:171-172).
Fix: `:disabled { opacity: .45; pointer-events: none }` on all controls including inputs, and remove the `.ref-btn` duplicate. Show "Play a note first" as small text next to the chip while it is disabled.
Effort: S

### 107. No pending state while waiting for microphone permission
Evidence: tuner `toggle()` awaits `tracker.start()` with the hint still "Tap to start" (tuner.ts:369-373), and analysis `startBtn` does the same (analysis.ts:97-101). A second tap during the prompt calls `start()` again.
Fix: set a `starting` flag, show hint "Waiting for microphone…" or button text "Starting…" plus `aria-busy`, and ignore toggles while starting.
Effort: S

### 108. No loading indicator when importing or opening PDFs
Evidence: `importFiles` renders thumbnails for each file (sheetmusic.ts:96-114) with no progress feedback. `openScore` parses the PDF (257-291) with no spinner, so a large score looks unresponsive.
Fix: a `.loading` row "Importing 2 of 5…" in `errorSlot`'s place, and a skeleton page inside `pagesEl` during `openScore`.
Effort: S

### 109. Transpose shows the new value before it works and never reverts on failure
Evidence: the segmented control changes immediately, a toast says "Transposing this take…" with no progress (recorder.ts:278), and if it fails the selection stays on +2 while audio plays the original (286-288).
Fix: disable the transpose group and show an inline spinner in the take card. On error call `transpose.set(previous)`.
Effort: S

### 110. Sheet music load failure is a dead end
Evidence: the lazy-import failure renders `p.muted` "Check your connection and reload." (main.ts:38) with no retry button and no `role=alert`, unlike `errorBox` used everywhere else.
Fix: `root.replaceChildren(errorBox('Could not load the sheet music reader. You may be offline.', () => { root.replaceChildren(); cleanup = lazySheetMusic(root) }))`.
Effort: S

### 111. No offline indication
Evidence: no `online`/`offline` listeners anywhere in `src`. Users do not know which features need the network (first sheet music load before the service worker cache).
Fix: a small top-bar pill "Offline" on `window.offline`, removed on `online`.
Effort: S

### 112. No "ready to work offline" confirmation
Evidence: main.ts:238-244 registers the service worker silently, and the README promises offline use after the first visit. This is separate from gap item 61, the update prompt.
Fix: on first `registration.installing` reaching `activated` with no previous controller, `toast('Partial is ready to use offline')`.
Effort: S

### 113. Error messages expose raw exception text
Evidence: `Could not save the recording: ${err.message}` (recorder.ts:216), `Could not transpose: ${err.message}` (287), `Could not analyse this take: ${err.message}` (337), `Could not open this PDF: ${err.message}` (sheetmusic.ts:265) and `db.list` errors (recorder.ts:433) show DOMException strings like "QuotaExceededError".
Fix: a `friendlyError(err)` mapping QuotaExceededError to "Storage is full", NotAllowedError to "Permission was blocked", and so on, with raw detail in a `<details>` element.
Effort: S

### 114. Denied microphone errors give no browser-specific help and loop on retry
Evidence: the MicError text is "Microphone permission was denied. Allow it in the browser and try again." (audio/context.ts:50), and errorBox offers "Try again" (tuner.ts:376), which fails straight away when permission is permanently blocked.
Fix: when `reason === 'denied'`, replace "Try again" with "How to allow the microphone", showing steps chosen by UA (Chrome: lock icon, Site settings; iOS Safari: aA menu, Website settings) [unverified exact menu names].
Effort: S

### 115. Try again button is unstyled
Evidence: errorBox creates `h('button', { onclick: retry }, 'Try again')` with no class (dom.ts:92), so it gets default browser button styling.
Fix: `class: 'pill-btn'`.
Effort: S

### 116. Explain the microphone before the browser asks
Evidence: the first tap on the ring triggers the browser prompt directly (tuner.ts:370), and the welcome sheet (main.ts:221-236) never mentions the microphone. This is separate from gap item 42.
Fix: on the first tuner start (settings flag `micPrimed`), show a sheet first: "Partial listens to your instrument to show pitch. Audio never leaves this device." with an "Allow microphone" button that calls `tracker.start()`.
Effort: S

### 117. Tuner resets when you return to it
Evidence: route cleanup stops the tracker (tuner.ts:594), so coming back from Metronome needs another tap. TE's tuner listens as soon as it opens [unverified].
Fix: if `navigator.permissions.query({name: 'microphone'})` is `granted` and the tuner was running when you left (module-level flag), auto-start on mount.
Effort: S

### 118. Welcome sheet closes itself in a fragile way
Evidence: "Start practising" works by `document.querySelector('.sheet-head .icon-btn')?.click()` (main.ts:232), and any close (scrim, Esc) marks the intro seen.
Fix: capture the `close` function returned by `openSheet` and call it directly.
Effort: S

### 119. Touch wording shown to mouse and keyboard users
Evidence: "Tap to start" (tuner.ts:111), "Tap the ring to tune" (main.ts:229), "Tap a note to start a drone" (sound.ts:219), "Tap to change" (metronome.ts:331) and "Tap the right or left side to turn" (sheetmusic.ts:254) appear on desktop. The keyboard hints are hidden on touch (styles.css:1026-1030), but the tap wording is never swapped the other way.
Fix: a `verb()` helper returning "Tap" when `matchMedia('(pointer: coarse)')` and "Click" otherwise, or neutral "Select". Aria labels always use neutral wording.
Effort: S

### 120. Tuner says "Play a note to begin" before the mic is on
Evidence: freqEl "Play a note to begin" and barNote "Play a note" (tuner.ts:116, 129, 165) show while the tuner is stopped, which contradicts "Tap to start" in the ring.
Fix: idle text "Tuner is off. Tap the display to start listening"; after start, "Play a note".
Effort: S

### 121. Destructive actions are labelled and styled inconsistently
Evidence: "Reset tendencies" is a neutral pill sitting between two switches (tuner.ts:74-83). Practice "Reset" is a bare word with a trash icon (practice.ts:302). Click track "Delete track" is danger-styled (clicktrack.ts:349).
Fix: put destructive actions last in a "Reset" group, always danger-styled, with explicit labels ("Clear tendencies", "Reset all settings").
Effort: S

### 122. Importing a backup overwrites everything without asking
Evidence: practice.ts:278-283 merges the file into settings immediately and toasts "Backup restored". Presets, click tracks and history are replaced with no preview.
Fix: before applying, show a confirm sheet: "This backup from <date> has N presets, M click tracks, K days of history. Replace current data?" (date from a field added at export).
Effort: S

### 123. Out-of-range numbers are corrected silently (WCAG 3.3.1)
Evidence: option inputs clamp on change with no message (metronome.ts:147-148; typing 50 count-in bars becomes 4). The BPM input resets on a non-number (249-250), and 500 becomes MAX_BPM silently.
Fix: after clamping, if the value changed, set `input.setCustomValidity('Maximum is 4')`, call `reportValidity()`, and toast "Count-in is limited to 0 to 4 bars".
Effort: S

### 124. "0 means off" fields are programmer wording
Evidence: "Pulses per bar (0 off)", "Silent bars (0 off)", "Every (bars, 0 off)", "Bars (0 never)" (metronome.ts:160-180).
Fix: a switch per practice mode that reveals its number fields, with defaults filled in.
Effort: M

### 125. Settings live on the Practice screen
Evidence: Appearance, Pedals and MIDI, Accessibility and Your data sit in `mountPractice` (practice.ts:192-305) below the streak stats. Help even says MIDI is "under Practice" (main.ts:135). This is not gap item 49 (settings search); it is where settings live.
Fix: a Settings route (gear in the rail and top bar) holding the Appearance, Accessibility, MIDI, Data and tuning defaults cards. Practice keeps history only.
Effort: M

### 126. Some preferences reset on every visit
Evidence: exercise player settings are local variables (sound.ts:301-309), sustain resets to true each mount (sound.ts:24), the analysis tab resets to Pitch (analysis.ts:28, 469) and night mode resets (sheetmusic.ts:45). Tuner mode and display, by contrast, persist.
Fix: add `exercise`, `soundSustain`, `analysisTab` and `sheetNight` to settings and read and write them.
Effort: S

### 127. Tempo sheet highlights two names at once
Evidence: TEMPO_MARKINGS ranges overlap (Grave 25 to 45, Largo 40 to 60; rhythm.ts:182-184). The `on` test `bpm >= min && bpm < max` (metronome.ts:129) marks both, while the dial shows only the first match (rhythm.ts:197).
Fix: mark `on` only for `mk.name === tempoMarking(bpm())`.
Effort: S

### 128. Saved presets get duplicate automatic names with no rename
Evidence: Save creates "Andante 4/4" every time (metronome.ts:374-381), so identical chips pile up and renaming is buried in Manage.
Fix: after saving, open an inline rename field focused on the new chip. Add " 2" when the name already exists.
Effort: S

### 129. Tuning sheet A4 chips do not show the current value
Evidence: 415 to 443 chips have no `.on` class or `aria-pressed` (tuningSheet.ts:43-45).
Fix: toggle `.on` and `aria-pressed` in `renderA4()` for `f === getSettings().a4`.
Effort: S

### 130. Editable names look like plain text
Evidence: `.track-name`, `.section-name` and `.take-name` use transparent border and background via `!important` (styles.css:3158-3167, 3263-3272, 3641-3652), so they are not recognisable as editable until focused.
Fix: show a pencil icon or dashed underline on hover and focus-within, `border-bottom: 1px dashed var(--control-border)` at rest, plus `placeholder`.
Effort: S

### 131. Recorder controls stay live during a take
Evidence: the "Record video" and "Metronome while recording" switches (recorder.ts:457-458) can be toggled mid-take with no effect, because they are read only at start (line 100, 130).
Fix: set `withVideo.disabled = withClick.disabled = true` while recording, and clear it in teardown.
Effort: S

### 132. Camera preview is mirrored but the saved video is not
Evidence: `video.rec-preview { transform: scaleX(-1) }` (styles.css:3611) while `video.take-video` is unmirrored (3613-3618), so bowing arm and posture appear flipped on playback compared with recording.
Fix: add a "Mirror playback" toggle on video takes, defaulting to match the preview, and apply `scaleX(-1)` to `.take-video` when on.
Effort: S

### 133. Speed and transpose controls in a take have no visible labels
Evidence: two segmented rows "0.5× 0.75× 1× 1.25×" and "−2 −1 0 st +1 +2" sit side by side with labels only in aria (recorder.ts:255-299, 352).
Fix: wrap each in `.field` with a small visible label ("Speed", "Transpose").
Effort: S

### 134. Analysis canvas freezes on any tap
Evidence: pointerup under 50px of movement toggles freeze (analysis.ts:445-455). A scroll attempt or stray tap freezes the view with no badge on the canvas, and Freeze is enabled before listening starts (48-49).
Fix: require a deliberate tap (under 10px and under 300ms), show a "Frozen" overlay badge in `.chart-card`, and disable `freezeBtn` until `tracker.running`.
Effort: S

### 135. Sheet music library has an inconsistent empty state and no search
Evidence: the empty library is `p.muted` "Your library is empty." (sheetmusic.ts:154), while recorder uses the `.empty` component with icon and guidance (recorder.ts:442). Sorting is by name only with no filter (128).
Fix: use `.empty` ("No scores yet", "Import a PDF to read, annotate and turn pages with a pedal"). Add a search input once there are more than 8 scores.
Effort: S

### 136. Practice screen for a new user shows zeros with no guidance
Evidence: practice.ts:162-180 renders 0s rings, "0 day streak" and a blank 12-week grid on first visit.
Fix: when `Object.keys(practiceLog).length === 0`, replace the hero with `.empty`: "Your practice shows up here. Time on the tuner, metronome, drones and recorder is counted automatically."
Effort: S

### 137. Right-to-left languages will not lay out correctly
Evidence: `lang="en"` is static with no `dir` (index.html:2). Physical CSS properties are used throughout: `margin-left: auto` (253, 1004), `.rail { inset: 0 auto 0 0 }` (414), `.app-main { margin-left }` (470), `border-left` on sections (3242), `text-align: left` (807, 2068, 3198, 3363), `padding-right` on selects and the chevron at `right 12px` (635-638). This is separate from gap item 32 (string catalogs).
Fix: when adding locales, set `document.documentElement.dir` from the locale and convert to logical properties (`margin-inline-start`, `inset-inline-start`, `border-inline-start`, `text-align: start`). Keep musical directions (flat on the left, sharp on the right) fixed with `direction: ltr` on `.bar-meter`, `.strobe-frame` and `.bar-legend`.
Effort: M

### 138. Numbers, units and plurals are hard-coded English
Evidence:
- **Decimals:** `toFixed(1)` Hz with a period decimal in tuner.ts:477, tuningSheet.ts:19 and sound.ts:208/218.
- **Units:** `minutes()` returns "1h 20m" (practice.ts:17-21).
- **Plurals:** `score${added > 1 ? 's' : ''}` (sheetmusic.ts:116), `section${... > 1 ? 's' : ''}` (clicktrack.ts:151), and "sections" and "bars" always plural (clicktrack.ts:94-95, so "1 sections").
- **Word order:** "N-bar count-in" (metronome.ts:413).

Fix: `Intl.NumberFormat(locale, {maximumFractionDigits: 1})` for Hz and cents, `Intl.DurationFormat` where supported [unverified support; fall back to NumberFormat with unit 'minute'], and `Intl.PluralRules` in the `t()` helper.
Effort: M

### 139. Dates mix formats and assume Sunday starts the week
Evidence: take names use `{month: 'short', day: 'numeric'}` plus time (recorder.ts:206), but the take header uses bare `toLocaleDateString()` (346). The heatmap starts weeks on Sunday via `getDay()` (practice.ts:155) regardless of locale.
Fix: one `formatDate()` helper, and first weekday from `new Intl.Locale(navigator.language).getWeekInfo?.().firstDay` [unverified support], falling back to Monday outside en-US.
Effort: S

### 140. Longer translations will overflow fixed controls
Evidence: `white-space: nowrap` on `.seg-btn`, `.chip`, `.pill-btn`, `.tuning-chip` and `.dock-bpm span` (styles.css:874, 822, 766, 289, 564). Tab labels are 0.68rem in a 5-column grid (387). Segmented controls already hide text at 640px or below.
Fix: allow two-line tab labels (`line-height: 1.1; text-align: center`) and `.seg-btn { white-space: normal }` with `min-height`. Add a pseudo-locale build (English padded 40% with accented characters) to e2e to catch overflow.
Effort: M

### 141. Bundled fonts do not cover the music symbols used in the UI
Evidence (checked in node_modules): the Inter and Space Grotesk latin subsets have `unicode-range: U+0000-00FF, ..., U+2000-206F, U+2191, U+2193, U+2212...`. They do not include ♯ U+266F, ♭ U+266D, ₄ U+2084, or ← U+2190 and → U+2192.

So these characters fall back to a system font with different weight and baseline:
- the big note accidental (tuner.ts:451)
- ring labels (pitchRing.ts:119)
- "A₄" in the tuning chip (tuningSheet.ts:12)
- the strobe legend arrows (tuner.ts:136)

Space Grotesk ships only latin, latin-ext and vietnamese, so Cyrillic headings fall back too. The staff clef depends on "Noto Music", "Bravura" or "Segoe UI Symbol" (analysis.ts:284), none of which are bundled, so it may show a missing-glyph box on Android and iOS [unverified per platform].

Fix: bundle a small subset font (for example Noto Music, checking its license, OFL [unverified]) covering U+2190-2193, U+2080-2089, U+266D-266F and U+1D11E-1D122. Put it first in the font stack for `.big-acc`, `.note-label` and the canvas clef, or draw ♯, ♭ and the clefs as SVG paths. Test with `document.fonts.check('16px "Space Grotesk Variable"', '♯')`.
Effort: S

### 142. Uppercase and letter-spaced labels will break non-Latin scripts
Evidence: `.rail-label` (styles.css:436-437), `.ring-hint` (1461-1462), `.count-in-label` (2027-2028), `.rec-state` (3578-3579) and `.bpm-unit` (1960) use `text-transform: uppercase` with letter-spacing. Letter-spacing breaks cursive joining in Arabic, and case does not exist in CJK or Devanagari.
Fix: `:lang(ar, fa, he, hi, ja, ko, zh) :is(.rail-label, .ring-hint, .count-in-label, .rec-state, .bpm-unit) { text-transform: none; letter-spacing: 0 }`.
Effort: S

Things I did not cover:
- WCAG criteria that looked like passes are left out rather than listed as passes: 2.5.7 dragging alternatives, 3.2.6 consistent help (the help button is in the top bar everywhere), 1.3.4 orientation, and 3.3.7 and 3.3.8, which don't apply.
- I did not open `src/store`, `src/audio` beyond `context.ts`, or `public/sw.js` past its first 40 lines.
- I checked the `dist` build: `index.html` icon and manifest paths are rewritten to relative paths, so that is not a gap.
- I found no genuine items beyond these 142, short of the 150 to 200 target.
