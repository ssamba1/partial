# Practice, data and settings

This file lists 107 gaps. I stopped there because what was left would have repeated the 78 existing items or been padding. Items that come close to an existing gap-analysis number say what is different. Anything I recall about competitors is marked [unverified]. I read the practice view, practice core, settings, db, controls, shared and main, plus the parts of the recorder, click track, drone bank and tuner that write to the practice log, index.html, sw.js, the manifest and tests/practice.test.ts.

## A. Time logging correctness

### Overlapping activities are counted two or three times
Evidence: Each source calls `logPractice` on its own and every call adds to the same daily total: `src/ui/shared.ts:17` (metronome), `src/audio/droneBank.ts:17` (drones), `src/ui/shared.ts:55` (tuner, analysis), `src/ui/views/recorder.ts:198` (record). A take made with the click on runs the metronome at the same time (`recorder.ts:131`), so 10 minutes of recording logs 20. `settings.ts:208` adds both into `practiceLog`.
Fix: Add `src/core/sessionClock.ts` that keeps a set of open activity intervals `{activity, start}`. The daily total becomes the length of the union of all intervals; the per-activity totals stay as they are. `logPractice` takes `(start, end, activity)` instead of seconds. Show "time with any tool running" as the headline number. Unit test: metronome 0 to 600 s plus record 100 to 400 s gives a total of 600, metronome 600 and record 300.
Effort: M

### A session that crosses midnight goes entirely to the day it ended
Evidence: `settings.ts:204` uses `dayKey(new Date())` at stop time. A session from 23:30 to 00:30 puts 60 minutes on the new day and nothing on the old one, which can break the old day's streak.
Fix: Log intervals with a start timestamp. In `logPractice`, split at every local midnight between start and end: loop `new Date(y, m, d + 1)` from the start and add each piece to its own `dayKey`. Test with 23:30 to 00:30 local.
Effort: S

### Closing or reloading the tab loses the running session
Evidence: The codebase has no `pagehide`, `beforeunload` or `visibilitychange` handler (grep over `src/`). `ActivityTimer.stop()` (`shared.ts:53`) and the metronome's `onState` are the only places time gets written. A phone browser that kills the page while the metronome runs logs nothing.
Fix: Add a 30 s checkpoint for each open interval, stored under `partial.openSessions`. Flush on `pagehide` and on `visibilitychange` to hidden. At startup, recover leftover open sessions and credit them up to their last checkpoint.
Effort: S

### A forgotten metronome or drone logs hours of "practice"
Evidence: The only guard is `seconds > 24 * 3600` (`settings.ts:203`). A metronome left running on the dock (`main.ts:150`) for 6 hours logs 6 hours.
Fix: After 20 minutes with no user input (pointer, key or MIDI), show a "Still practising?" prompt. If nobody answers within 2 minutes, stop crediting from the last input time. Let the user set or disable the idle limit.
Effort: M

### Device sleep can get logged as practice
Evidence: Durations come from `performance.now()` deltas (`shared.ts:14,17`, `droneBank.ts:15,17`). Whether that clock advances during OS sleep differs by browser and OS [unverified]. A laptop closed with the metronome "playing" may credit the whole sleep.
Fix: Run a heartbeat every 15 s that stores `Date.now()`. If two beats are more than 60 s apart, close the interval at the earlier beat and open a new one.
Effort: S

### The 24-hour cap drops long sessions silently and still accepts implausible ones
Evidence: `settings.ts:203` returns without a word when a session exceeds 24 h, and accepts 23 h.
Fix: Sessions over 3 h go into a "Needs review" list on the Practice screen with Keep, Trim and Discard. Nothing is dropped silently.
Effort: S

### Running a tool counts as practising even in silence
Evidence: The tuner timer starts on `tracker.start()` (`tuner.ts:371`) whether or not any sound arrives. An open mic in a silent room logs tuner minutes.
Fix: For tuner and analysis, credit voiced time only: add a frame's duration when the tracker returns a pitch or RMS is above the gate, merging gaps under 5 s. Add a setting: "Count only while I play (tuner, analysis)".
Effort: S

### Sheet music reading is not tracked at all
Evidence: `Activity` (`settings.ts:9`) has no `sheet` value and `sheetmusic.ts` never calls `logPractice`. Reading and playing from a score, one of the most common practice modes, earns nothing.
Fix: Add `'sheet'` to `Activity`, `ACTIVITIES` (`practice.ts:9`) and the CSV columns. Credit time while a score is open and the page is visible, with the idle rule above. Store `scoreId` on the interval.
Effort: S

### Click tracks are logged as metronome time
Evidence: `clicktrack.ts:314` logs as `'metronome'`.
Fix: Add a `clicktrack` activity, or log metronome with `source: 'clicktrack', trackId` so per-track time can be shown.
Effort: S

### A failed or empty recording still logs practice
Evidence: `recorder.ts:198` calls `logPractice` before the `blob.size === 0` check at line 200.
Fix: Move `logPractice` after a successful `db.put`, or log only when `blob.size > 0`.
Effort: S

### A one-second accidental tap keeps a streak alive
Evidence: `streak()` and `bestStreak()` treat any truthy value as a practice day (`src/core/practice.ts:11,13,23`). A 0.4 s tap on the tuner counts.
Fix: Add `minDaySeconds` (default 60, user adjustable) and pass it to both functions. Test that 30 s does not count and 61 s does.
Effort: S

### Time zone travel breaks streaks and doubles days
Evidence: `dayKey` uses the local date at logging time (`core/practice.ts:2`) and no offset is stored. Flying east can skip a calendar day; flying west can spread one practice day over two keys.
Fix: Store each session as `{startUtc, endUtc, tzOffsetMin}`. Streaks get one "travel grace day" when the offset changed between consecutive sessions. Test with two sessions in different offsets.
Effort: M

### A wrong device clock writes future or past dates without warning
Evidence: No monotonic sanity check exists. A clock set a year ahead writes future keys that the 12-week grid and `streak()` never show. After the clock is corrected they are invisible but still sit in `bestStreak` and the CSV.
Fix: Keep a `maxSeenTimestamp`. If `Date.now()` is more than 36 h before it, or a new key is more than 2 days after the last key, flag it for review. Put a "Dates in the future" cleanup action on the data screen.
Effort: S

### No tests for DST, midnight splits or time zones
Evidence: `tests/practice.test.ts` covers only a fixed local date. There are no DST-transition days, no split sessions, no `TZ` variation.
Fix: Add a vitest setup that runs the practice suite under `TZ=America/New_York`, `Europe/London`, `Australia/Lord_Howe` (half-hour DST) and `Pacific/Kiritimati`. Include cases for the spring-forward and fall-back days and a 23:59 to 00:01 split.
Effort: S

### `bestStreak` breaks on keys that are not zero-padded
Evidence: `core/practice.ts:29-34` compares `dayKey(next) === k`. An imported key like `2026-9-1` never matches, and `new Date(NaN)` keys give wrong runs. Import does not normalize keys (`practice.ts:281`).
Fix: Add `normalizeDayKey()` using the regex `^\d{4}-\d{2}-\d{2}$` plus a round-trip through `Date`. Apply it on load and import. Drop or repair invalid keys and report how many.
Effort: S

## B. Practice screen display

### Heatmap colours history against today's goal
Evidence: `practice.ts:158` scales every past day by the current `goalSec`. Raising the goal from 20 to 60 minutes turns past goal-met days pale.
Fix: Store `goalSecByDay` (or goal change events with dates) and colour each day against the goal that applied then. Add a "goal met" marker.
Effort: S

### Heatmap weeks always start on Sunday
Evidence: `practice.ts:155` uses `end.getDay()`, which is Sunday-based. Most of Europe starts weeks on Monday.
Fix: Add a `weekStart` setting defaulting to `new Intl.Locale(navigator.language).weekInfo?.firstDay` [unverified browser support; fall back to Monday for non-US locales]. Align the columns to it.
Effort: S

### Heatmap cells are unreadable to screen readers and on touch
Evidence: `practice.ts:159` renders `<i>` elements with only a `title`. They have no role or accessible name, cannot be focused, and titles do not appear on touch.
Fix: Make it a `role="grid"` of buttons, each with `aria-label="Tue 9 Sep: 25 minutes, goal met"`, arrow-key roving focus, and a tap that opens the day detail.
Effort: S

### Heatmap has no weekday or month labels
Evidence: `practice.ts:180` renders bare cells.
Fix: Add a weekday column (M, W, F) and month labels above the first week of each month, in `Intl.DateTimeFormat` short form.
Effort: S

### No day detail view
Evidence: Nothing on a heatmap cell is clickable, and the per-activity breakdown exists only for today (`practice.ts:143`).
Fix: Tapping a day opens a sheet with activity minutes, sessions (once sessions are stored), takes recorded that day (join `RecordingEntry.created` by `dayKey`) and journal notes.
Effort: M

### The practice screen goes stale after midnight
Evidence: `render()` runs only when the goal, theme or `practiceLog` changes (`practice.ts:313`). With the screen left open past midnight, the rings keep showing yesterday as "today".
Fix: Schedule `setTimeout` for the next local midnight, then re-render and reschedule. Also re-render on `visibilitychange` to visible.
Effort: S

### Rings show nothing above 100% and inner rings can overrun
Evidence: The outer ring caps at 1 (`practice.ts:42`). Inner rings divide by `max(total, goal)` (line 49), and because of double counting they can sum past the outer ring.
Fix: Draw a second lap in a darker shade past 100% and label it "120% of goal". Once intervals are unioned, inner rings show each activity's share of the union.
Effort: S

### `minutes()` rounding shows "60s" and "1h 0m"
Evidence: `practice.ts:18-20`: 59.6 s becomes "60s" and 3570 s becomes "1h 0m".
Fix: Round first, then pick the unit: under 60 whole seconds show seconds, otherwise whole minutes. Drop "0m". Unit test the boundaries.
Effort: S

### Daily goal is limited to six presets and cannot be turned off
Evidence: `practice.ts:186` offers 10 to 90 minutes only. An imported value such as 25 matches no preset, so nothing looks selected. There is no "no goal" option, and 0 would make `total / goalSec` Infinity (line 48).
Fix: Add a stepper with custom minutes (5 to 600) and a "No daily goal" option that hides the outer ring. Guard the division.
Effort: S

### No weekly or monthly goals, rest days or pace line
Evidence: Only a daily goal exists (`settings.ts:81`). Strava offers weekly and yearly goals with progress [unverified].
Fix: Add `goals: {weeklyMinutes?, monthlyMinutes?, restDays: number[]}`. Show a weekly bar with an expected-pace marker at `(daysElapsed / 7) * target`. Rest days do not break streaks.
Effort: M

### No streak freeze or grace day
Evidence: One missed day resets `streak()` to 0 (`core/practice.ts:14`). Duolingo sells streak freezes [unverified].
Fix: Earn one freeze per 7-day run, holding at most 2, applied automatically. Store `freezesUsed: string[]` of day keys and have `streak()` treat them as present. Nothing is paid for and there is no pressure messaging.
Effort: S

### Streaks cannot be based on meeting the goal
Evidence: `streak()` counts any practice at all.
Fix: Add a `streakRule: 'any' | 'goal'` setting and pass the threshold into `streak()` and `bestStreak()`.
Effort: S

### Streaks cannot be hidden
Evidence: The streak cards always show (`practice.ts:176-177`). Streak anxiety is a known dark pattern and matters for kids.
Fix: Add a "Show streaks" toggle (default on). When off, show only total time and weekly minutes, and never show "streak lost" wording anywhere.
Effort: S

### No comparison with earlier weeks
Evidence: "last 7 days" is a single number (`practice.ts:178`).
Fix: Add "vs previous 7 days: +35 min" next to it, computed from `practiceLog` over days 7 to 13.
Effort: S

### No trend charts
Evidence: The only history views are the 12-week grid and today's rings.
Fix: Add an SVG bar chart of minutes per week (26 weeks), stacked by activity, with a toggle for monthly bars, plus accessible `<table>` fallback data.
Effort: M

### No weekly summary
Evidence: There is no summary surface anywhere.
Fix: On the first open after the local week start, show a dismissible card with total minutes, days practised, top activity, goal days met, takes recorded and the in-tune % trend. Keep it on the Practice screen as "Last week".
Effort: S

### No milestones or achievements
Evidence: None exist.
Fix: Add informational milestones only (first 10 hours, 100 hours, first take, 30 goal days), stored as `{id, reachedOn}` and shown in a list. They cannot be lost, have no push prompts and can be switched off.
Effort: S

### No summary when a session ends
Evidence: Stopping the tuner or metronome gives no feedback on logged time (`tuner.ts:362`, `shared.ts:17`).
Fix: When a session over 2 minutes closes, show a toast such as "14 min logged · 82% in tune". Tapping it opens the day detail.
Effort: S

## C. Richer practice data

### History is stored only as daily totals
Evidence: `practiceLog: Record<string, number>` and `activityLog` (`settings.ts:78-80`). It does not record when, how long each session was, or what was played.
Fix: Add an IndexedDB `sessions` store: `{id, startUtc, endUtc, tzOffsetMin, activities: {activity, sec}[], scoreId?, pieceId?, inTunePct?, bpmRange?, note?, rating?}` with a `day` index. Build the daily totals from it and keep `practiceLog` as a cache. This is a different change from gap item 76, which only moves the existing aggregates.
Effort: M

### No manual practice entry
Evidence: Only tool runtime creates entries. Lessons, rehearsals and practice without the app cannot be logged. Andante and Modacity allow manual logs [unverified].
Fix: Add a "Log practice" button: date (default today), start time, duration, category (practice, lesson, rehearsal, performance), piece and note. Write a session with `source: 'manual'`.
Effort: S

### History entries cannot be edited or deleted
Evidence: No UI touches `practiceLog` except Reset, which wipes everything (`practice.ts:296`).
Fix: In the day detail, allow editing a session's duration and deleting it with an undo toast, then recompute that day's aggregates.
Effort: S

### No practice journal
Evidence: No note field exists anywhere in `Settings` or `db.ts`. Andante centres on a journal [unverified].
Fix: Add a free-text note per session and per day (IndexedDB `journal` store), a prompt at session end ("What went well / what to fix next"), a searchable list, and inclusion in the backup.
Effort: M

### No mood, energy or focus rating
Evidence: None stored.
Fix: Add optional 1 to 5 ratings on the session-end sheet, a small chart of focus against minutes, and a way to turn the prompt off.
Effort: S

### No repertoire list and no time per piece
Evidence: `ScoreEntry` (`db.ts:14`) has `bpm` and `lastPage` but no practice time. Pieces without a PDF cannot exist at all.
Fix: Add a `pieces` store `{id, title, composer, scoreId?, status: learning|polishing|performance-ready|archived, targetDate?}`. Sessions reference `pieceId`; opening a score sets the active piece automatically. Show minutes per piece.
Effort: M

### Tempo progress per piece is overwritten, not kept
Evidence: `ScoreEntry.bpm` is one value (`db.ts:19`), replaced on each use.
Fix: Add `tempoHistory: {day, bpm}[]` per piece, appended when the tempo changes while that piece is active. Show a line chart toward a target tempo.
Effort: S

### Speed trainer results are not recorded
Evidence: The trainer raises the tempo up to `trainerMax` (`settings.ts:56-58`), but the peak tempo reached is never saved. `metronome.onTempo` only writes the current bpm (`shared.ts:23`).
Fix: When a trainer run stops, record `{startBpm, peakBpm, bars, pieceId?}` into the session and show "Peak tempo" in the day detail and the piece tempo chart.
Effort: S

### No spaced repetition for passages
Evidence: Nothing schedules review. Modacity has passage-level practice tools [unverified].
Fix: Add a `passages` store `{pieceId, label, page?, bars?, ease, intervalDays, dueDay}`. After practising a passage the user rates it Again, Hard, Good or Easy, which updates the interval (SM-2 style) and due day. Add a "Due today" list. Unit test the interval updates.
Effort: M

### No clean-repetition counter for passages
Evidence: None exists. Consecutive-correct counters are a common deliberate-practice tool [unverified in specific apps].
Fix: Add a counter on the metronome and sheet screens with "clean" and "missed" buttons that resets the run on a miss, a target such as 5 in a row, and results saved to the passage or session.
Effort: S

### No day-by-day practice planning
Evidence: No planned-time data exists. Gap item 55 covers routines (ordered steps), not a calendar plan.
Fix: Add `plan: {day, pieceId?, routineId?, minutes}[]` with a week grid editor. The Practice screen shows today's plan against what was done.
Effort: M

### No goals per piece with a deadline
Evidence: None exist.
Fix: Add `targetDate` and `targetBpm` on each piece and a countdown card ("Recital in 12 days, 78 of 96 BPM"), sorted by nearest date.
Effort: S

### Intonation tendencies are all-time only, so improvement cannot be seen
Evidence: `flushTendencies` merges into one cumulative object (`tuner.ts:205-211`) with no dates.
Fix: Also append per-day tendency snapshots `{day, pc: {count, sum, sumSq}}` and show a per-note mean-cents trend with a "last 30 days vs before" comparison.
Effort: M

### Tendencies mix readings from different tunings and instruments
Evidence: `tendencies` is keyed only by written pitch class (`settings.ts:42`). Changing A4, temperament, transposition or instrument pools the data.
Fix: Key buckets by `${transposition}|${temperament}|${instrumentId}`. The tendencies panel shows the current bucket, with a picker for others.
Effort: S

### Reset tendencies throws away history with no archive
Evidence: `tuner.ts:79` sets `tendencies: {}` after a native confirm.
Fix: Before clearing, move the current stats into `tendencyArchive: {resetOn, data}[]` and offer "Export first".
Effort: S

### The session in-tune percentage is never saved
Evidence: `session` lives in memory only (`shared.ts:63`) and is lost on reload.
Fix: Store `inTunePct` and `voicedFrames` on the tuner session record, and show a daily in-tune % line in the charts.
Effort: S

### Takes have no rating, notes or piece tags
Evidence: `RecordingEntry` (`db.ts:3-10`) has name, created, duration, mime and blob only.
Fix: Add optional `pieceId`, `rating`, `note` and `tags`, editable in the take list, with filters by piece. Include them in exports.
Effort: S

### No break reminders
Evidence: No timer tracks continuous playing. Long sessions without breaks are a known overuse injury risk [unverified specific guidance; cite a performing-arts medicine source before wording it].
Fix: Add an opt-in "Remind me to rest every N minutes" using the unioned activity clock. It shows a gentle toast and never stops audio.
Effort: S

### No lesson log
Evidence: No category or fields for lessons. Studio apps like My Music Staff track lessons and notes [unverified].
Fix: Add a lesson entry type `{day, teacher?, notes, assignments: text[], nextLessonDay?}`. Unticked assignments appear on the Practice screen until done.
Effort: M

### No printable practice record for teachers or parents
Evidence: Only the JSON backup and CSV exist (`practice.ts:231-265`). Many teachers ask for a signed weekly practice sheet [unverified how common]. This is about output format; gap item 34 is about assignment links.
Fix: Add a "Print week" view with a print stylesheet: a table per day (minutes, pieces, notes), weekly total and a signature line, printed with `window.print()` so the user can "Save as PDF".
Effort: S

## D. Settings persistence and data integrity

### Two open tabs overwrite each other's settings and history
Evidence: Each tab keeps its own `current` in memory (`settings.ts:170`) and writes the whole object (`settings.ts:184`). No `storage` event listener exists. If tab A logs 30 minutes and tab B then changes the theme, tab B's stale object erases those 30 minutes.
Fix: Before each write, re-read `localStorage`, apply the patch as a function to the fresh value, then write. Add a `window.addEventListener('storage')` handler that reloads `current` and notifies listeners. Store history as append-only session records (section C) so merges are safe. E2E test with two pages.
Effort: M

### Metronome running in two tabs doubles practice time
Evidence: The metronome is a module singleton per tab (`shared.ts:7`). Two tabs each log.
Fix: Put a `BroadcastChannel('partial')` presence message on each session open and union intervals across tabs by timestamp in the session store (store absolute UTC times).
Effort: S

### MIDI actions fire in every open tab
Evidence: `onMessage` runs `runAction` in every tab with MIDI enabled (`controls.ts:78-79`). One pedal press turns pages in two tabs or toggles two metronomes.
Fix: Act only when `document.visibilityState === 'visible'` and the document has focus. Otherwise use a BroadcastChannel so the most recently focused tab owns MIDI.
Effort: S

### Failed saves are silent, so changes vanish on reload
Evidence: `settings.ts:185-187` swallows quota and security errors: "keep in memory only". The user never learns that presets and history since then are lost. Gap item 62 covers IndexedDB video quota, not this.
Fix: On the first failed `setItem`, show a persistent banner "Changes are not being saved: storage is full or blocked" with an "Export backup now" button. Retry on the next write and clear the banner once a write succeeds.
Effort: S

### Blocked storage at startup runs on defaults without saying so
Evidence: `settings.ts:164-166` returns defaults when `localStorage` throws, for example with site data blocked.
Fix: Set a `storageAvailable` flag and show the same banner at launch explaining that nothing will persist.
Effort: S

### Corrupted settings JSON gets overwritten and lost for good
Evidence: `safeParse` returns `{}` on a parse error (`settings.ts:147`). The next `updateSettings` writes defaults over the raw string, destroying recoverable history.
Fix: On a parse failure, copy the raw string to `partial.settings.corrupt.<timestamp>` before continuing and offer a "Download damaged data" button. Also try recovering `practiceLog` with a tolerant extraction regex.
Effort: S

### Stored and imported values are never type-checked
Evidence: `mergeSettings` only spreads (`settings.ts:152-158`). A string `bpm`, `accents` shorter than `beatsPerBar`, a `theme` of `"purple"` or a non-numeric `dailyGoalMinutes` all pass straight into the engine and UI.
Fix: Write a hand-written `validateSettings(raw): {settings, issues[]}` that coerces and clamps each field (bpm 20 to 400, tolerance within the RANGES values, enums checked against their lists, accents resized to `beatsPerBar`). Run it on load and import. Fuzz test with random JSON.
Effort: M

### No schema version or migration path
Evidence: The key is `partial.settings.v1` (`settings.ts:90`) but the object has no `version` field and there is no migrate step. The IndexedDB upgrade (`db.ts:52-57`) only creates stores. A renamed field would silently reset.
Fix: Add `schemaVersion` to `Settings` and a `migrations: Record<number, (s) => s>` run in order on load and import, with a test per migration using stored fixtures. Do the same for IndexedDB with `oldVersion` in `onupgradeneeded`.
Effort: S

### Array items are not given new default fields
Evidence: Defaults are merged only for `metronome` and `drone` (`settings.ts:156-157`). Items inside `metronomePresets` and `clickTracks` keep whatever shape they had, so fields added later (gap item 3's section fields) come through as `undefined`.
Fix: Add `normalizePreset()` and `normalizeClickTrack()` that fill defaults per item, called from the validator.
Effort: S

## E. Backup, import and export

### Import accepts almost any JSON
Evidence: `practice.ts:280` checks only `'a4' in data`. File size is not limited, so a huge file is fully read and parsed on the main thread.
Fix: Reject files over 5 MB. Require a `format: 'partial-backup'` marker plus `schemaVersion` (accept marker-less legacy files through the validator). List any fields that were repaired.
Effort: S

### Import replaces history instead of merging it
Evidence: `updateSettings(mergeSettings(data))` (`practice.ts:281`) replaces `practiceLog`, `activityLog`, presets and click tracks. Importing a laptop backup onto a phone that already has a month of history deletes that month.
Fix: Show an import sheet with two modes, "Merge" (history: session records deduplicated by id, or daily max for legacy aggregates; presets and tracks: union by id with rename on conflict) and "Replace". Show counts before applying.
Effort: M

### Import and Reset overwrite with no preview and no undo
Evidence: Import applies immediately (`practice.ts:281`). Reset wipes after a native confirm (`practice.ts:295-296`). Neither keeps a copy. Gap item 71 covers takes, scores and presets, not whole-state operations.
Fix: Before either, save a snapshot to `partial.settings.snapshot.<timestamp>`, keeping the last 3 and pruning older ones on quota errors. Show a toast "Backup restored · Undo" that restores the snapshot. List snapshots on the data screen.
Effort: S

### Importing the same file a second time does nothing
Evidence: The file input's `value` is never cleared (`practice.ts:275-287`), so picking the same file again fires no `change` event.
Fix: Set `(e.target as HTMLInputElement).value = ''` in a `finally` block.
Effort: S

### The file picker may grey out .json files on some phones
Evidence: `accept: 'application/json'` (`practice.ts:273`). Some mobile pickers report an empty or other MIME type for .json files [unverified per platform].
Fix: Use `accept: '.json,application/json'` and test on iOS Files and Android.
Effort: S

### Import restores `midiEnabled` but never opens MIDI
Evidence: After import, only `applyTheme()` runs (`practice.ts:282`). `restoreMidi` runs only at startup (`main.ts:217`), so the switch says on while no MIDI access exists.
Fix: After import and reset, call a `applyRuntimeSettings()` that runs `applyTheme`, enables or disables MIDI to match `midiEnabled`, and resyncs drones.
Effort: S

### Reset is all or nothing
Evidence: One button resets everything, including `seenIntro` (the welcome sheet returns) and `midiMap` (`practice.ts:296`, `settings.ts:136-137`).
Fix: Add per-section reset: Tuner, Metronome, Drones, Presets, Click tracks, MIDI mappings, Practice history, Intonation tendencies, Appearance. Keep `seenIntro` unless "everything" is chosen.
Effort: S

### No true "delete all my data"
Evidence: Reset keeps recordings, scores and annotations (`practice.ts:295`). Nothing clears the IndexedDB `partial` database, Cache Storage or the service worker.
Fix: Add "Erase everything on this device": `indexedDB.deleteDatabase('partial')`, `localStorage` keys with the `partial.` prefix, `caches.keys()` deletion, service worker `unregister()`, then reload. Guard it with a typed confirmation word. Explain how to revoke the mic, camera and MIDI permissions in browser settings.
Effort: S

### No view of what is stored
Evidence: "Everything stays on this device" (`practice.ts:226`) is the only disclosure. No sizes, counts or keys are shown.
Fix: Add a "What is stored" panel: settings byte size, counts and total bytes of recordings, scores and annotations (sum `blob.size`), Cache Storage entries, `navigator.storage.estimate()`, last export date and persistence status. Each row links to delete or export.
Effort: S

### Backup file has no metadata
Evidence: The export is raw `getSettings()` (`practice.ts:235`), with no app version, schema version, export timestamp or origin.
Fix: Wrap it as `{format:'partial-backup', schemaVersion, appVersion: __BUILD_ID__, exportedAt, settings}` and have import accept both shapes.
Effort: S

### Backups carry device-specific settings to other devices
Evidence: `midiMap`, `midiEnabled`, `theme`, `sensitivity` and `seenIntro` travel in the backup. MIDI note numbers from one controller make no sense on another device.
Fix: Tag fields as `device` or `portable`. Import offers "Include device-specific settings" (off by default for merge).
Effort: S

### No automatic backup to a synced folder
Evidence: Backups are manual downloads only (`practice.ts:236`).
Fix: Where `showSaveFilePicker` exists (Chromium desktop [unverified current support]), let the user pick a file inside a Dropbox, OneDrive or iCloud folder, keep the handle in IndexedDB, and write a snapshot on each session end, debounced to 10 minutes. On load, compare the file's `exportedAt` and offer to merge a newer one. Show the last sync time.
Effort: M

### No QR transfer between devices
Evidence: Moving data needs a file transfer.
Fix: Gzip the backup with `CompressionStream`, base64url it, and split it into chunks shown as an animated sequence of QR codes (vendor a small MIT-licensed QR encoder after checking its license). The receiver scans with `BarcodeDetector` where available [unverified Safari and Firefox support], otherwise uploads a photo. Reassemble and merge. Limit it to settings and history, not recordings.
Effort: L

### No direct device-to-device transfer
Evidence: Recordings and scores are too large for QR or copy-paste.
Fix: Use a WebRTC data channel with manual signaling (offer and answer exchanged by QR or pasted text; on the same network, host candidates may connect without STUN [unverified]). Send IndexedDB entries in 64 KB chunks with a progress bar and a checksum per entry. No server.
Effort: L

### Sync merges would still lose data
Evidence: Everything is last-writer-wins on one object (`settings.ts:180`). Deleted presets have no tombstones, so a merge brings them back.
Fix: Give records `id`, `updatedAt` and `deleted?`. Merge per record by `updatedAt`, keep tombstones for 90 days, and treat sessions as append-only. Unit test merges both ways.
Effort: M

### Backups are not encrypted
Evidence: Exports are plain JSON (`practice.ts:235`). Once gap item 51's full zip includes recordings (for example, video of a child), a lost file exposes them.
Fix: Add an optional password: PBKDF2-SHA-256 (with a high iteration count; take the current OWASP figure before choosing) to AES-GCM via WebCrypto, stored as `{salt, iv, ciphertext}` with a `.partial-enc` extension. Import prompts for the password. Round-trip test.
Effort: S

### CSV totals do not match the activity columns
Evidence: `practice.ts:253-255` iterates `practiceLog` keys only, so days present only in `activityLog` are dropped. Each column is rounded with `toFixed(1)` separately and totals include double counting, so activity minutes do not add up to `total_minutes`. Days with zero practice are omitted, which leaves gaps for spreadsheet charts.
Fix: Iterate every day from the first to the last key, include zero rows, and compute the total from the unioned intervals. Add a `sessions.csv` with one row per session (start ISO time with offset, end, activities, piece, note), quoting fields per RFC 4180.
Effort: S

### No calendar (ICS) export
Evidence: None exists.
Fix: Export sessions as RFC 5545 `VEVENT`s (`DTSTART`/`DTEND` in UTC, `SUMMARY:Practice: <piece>`, `UID:<sessionId>@partial`). Planned practice exports as events with `VALARM` reminders, which gives reminders without push notifications.
Effort: S

### Downloads rely on clicking a detached link
Evidence: `practice.ts:236-238` and `258-260` click an `<a>` that is never attached to the document, then revoke the URL after 1 s. Behaviour in Firefox and iOS standalone PWAs is untested (the README says only Chrome and Edge were tested) [unverified].
Fix: Attach the anchor to `document.body` before clicking and remove it afterwards. Revoke on `focus` return or after 60 s. Add to the Safari and Firefox device checks.
Effort: S

## F. MIDI

### Any Practice screen re-render cancels MIDI learning
Evidence: `render()` disposes and rebuilds the MIDI card (`practice.ts:138-139`), and `dispose` calls `learnNextTrigger(null)` (`practice.ts:127`). Any `practiceLog` change (a drone stopped from the dock, the metronome ending after N bars) cancels learning while the button still says "Press a pedal or key…".
Fix: Build the MIDI card once, outside `render()`. Re-render only the stats section when history changes.
Effort: S

### MIDI learning cannot be cancelled and has no timeout
Evidence: `learnNextTrigger` stores one callback (`controls.ts:117-119`). Starting a second learn replaces the first silently and leaves the first button in its waiting state. No Escape and no timeout.
Fix: Keep a single learning state in the card. Pressing another learn resets the previous button. Escape or a 10 s timeout cancels and restores the label. Add a Cancel chip.
Effort: S

### Expression pedals fire actions repeatedly
Evidence: `midiTrigger` fires for every CC message with value 64 or more (`core/midi.ts:20`). A continuous pedal swept upward sends many such values and turns many pages.
Fix: Track the last value per `cc:<n>`. Fire only on a rising crossing from below 64 to 64 or above, with 10-unit hysteresis before it can re-arm. Unit test a value ramp.
Effort: S

### Program Change pedals are not supported
Evidence: Only note-on and CC are recognized (`core/midi.ts:18-21`). Some footswitches send Program Change [unverified which models].
Fix: Handle `0xC0` status (2-byte messages, so relax `data.length < 3` for that type) as `pc:<n>`, and label it in `triggerLabel`.
Effort: S

### MIDI channel is always ignored
Evidence: `core/midi.ts:14` ignores the channel, so a keyboard on channel 1 and a pedal board on channel 10 using the same note collide. This will matter once gap item 22 plays notes from MIDI.
Fix: Add a per-mapping option "any channel" (default) or a specific channel, stored as `note:60@ch10`.
Effort: S

### Mappings are not tied to a device
Evidence: `midiMap` keys hold no device (`settings.ts:84`).
Fix: Optionally store `input.id`/`input.name` with each mapping and match on it when present, so two controllers can reuse the same CC.
Effort: S

### Only five MIDI actions
Evidence: `MIDI_ACTIONS` is next, previous, toggle, metronome and tap (`core/midi.ts:3-9`).
Fix: Add tempo up and down, stop all drones, start and stop recording, tuner on and off, next and previous screen, and next click-track section, each through a function call rather than a synthetic keydown.
Effort: S

### Mapped notes show as numbers
Evidence: `triggerLabel` returns "Note 60" (`core/midi.ts:27`).
Fix: Use `noteName(n)` plus the octave, for example "C4 (60)".
Effort: S

### No MIDI activity monitor
Evidence: The card lists devices only (`practice.ts:112`). Users cannot see whether presses arrive at all.
Fix: Add a "Last message: cc 64 = 127 from AirPedal" line and a blinking dot, updated from `onMessage`, throttled to 10 updates per second.
Effort: S

### MIDI permission may be requested at launch without a gesture
Evidence: `restoreMidi` calls `requestMIDIAccess` at startup (`controls.ts:130`). Whether the browser re-prompts in that case is unverified.
Fix: Check `navigator.permissions.query({name:'midi'})` first. If the state is `prompt`, wait for the first user gesture or show a "Reconnect MIDI" chip.
Effort: S

## G. Privacy and security

### Deploying on GitHub Pages would share storage with other sites
Evidence: `vite.config.ts:33-34` targets subfolder deploys such as GitHub Pages. Every `user.github.io/<repo>` page shares one origin, so any of that user's other project pages can read `partial.settings.v1`, the `partial` IndexedDB (recordings, including video) and the camera or mic permission grant.
Fix: Deploy on a dedicated origin (custom domain or subdomain). Document it in the README. At startup, show a warning when `location.pathname` is not `/` on a `github.io` host.
Effort: S

### No Content-Security-Policy
Evidence: `index.html` has no CSP meta tag. Imported backups and PDF text are the main untrusted inputs.
Fix: Add a meta CSP: `default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'`. Check the pdf.js worker and blob URLs in the e2e run. A `connect-src 'self'` policy also enforces the no-tracking claim.
Effort: S

### No permissions overview
Evidence: Mic, camera, MIDI and persistent storage are each requested in different places, and nothing lists what was granted.
Fix: Add a Privacy card that shows `navigator.permissions.query` states for microphone, camera and midi and the `storage.persisted()` status, with per-browser revoke instructions.
Effort: S

### Nothing shows the mic is live outside the tuner screen
Evidence: Analysis and the recorder each open the mic, and the top bar shows no global mic indicator (`main.ts:140-146` has session and tuning chips only).
Fix: Add a shared mic reference count in the pitch tracker and recorder, with a red mic chip in the top bar while it is above zero. Tapping it stops all mic use.
Effort: S

### The no-tracking claim is not documented or verifiable
Evidence: The README and footer (`practice.ts:306`) state no tracking, but no privacy document lists storage keys or network requests.
Fix: Add `PRIVACY.md` listing every storage key and store with its purpose, stating that no network requests are made beyond the app's own files, and pointing to the CSP `connect-src 'self'` as the check. Link it from the Practice screen.
Effort: S

### Service worker update leaves old settings code on new data
Evidence: `sw.js:19-20` keeps old tabs on the old version. After another tab upgrades the settings schema (once migrations exist), an old tab writes the old shape back over it. Gap item 61 covers the update prompt, not this data risk.
Fix: Put `schemaVersion` in every write. A tab whose code version is lower than the stored one stops writing, shows "Reload to continue" and switches to read-only.
Effort: S

## H. Profiles, families and settings structure

### No separate profiles for several students on one device
Evidence: A single `KEY` (`settings.ts:90`) and a single IndexedDB name (`db.ts:40`).
Fix: Add `partial.profiles = [{id, name, color}]` and an active profile. Namespace settings as `partial.settings.v1.<profileId>` and add a `profileId` index or field on recordings, sessions and annotations (scores can be shared). Add a profile switcher in the top bar and migrate existing data into a "Default" profile.
Effort: L

### Children can reset or overwrite data in one tap
Evidence: Reset and Import sit in the open on the Practice screen (`practice.ts:266-303`).
Fix: Add an optional "Protect data actions" setting: a 4-digit parent code (salted hash, not a security boundary, just a speed bump) or a hold-for-3-seconds button in front of Reset, Import, Erase and delete-take.
Effort: S

### No kids mode
Evidence: The only configurable UI is the theme and the announce toggle.
Fix: Add a `kidsMode` flag: larger targets, only Tuner, Metronome and Sound in the nav, streak and goal wording turned into neutral "minutes this week", no destructive controls, and simplified language.
Effort: M

### Parents cannot see a child's practice without the child's device
Evidence: No summary can be shared out.
Fix: Add a "Share weekly summary" action producing a small text summary (minutes per day, pieces, takes count) through `navigator.share({text})`, falling back to clipboard. No data leaves the device unless the user sends it.
Effort: S

### Settings live on the Practice statistics screen
Evidence: Appearance, MIDI, Accessibility and data controls are all under the Practice route (`practice.ts:192-305`), which `main.ts:54` labels "Practice". Gap item 49 covers setting search, not this structure.
Fix: Add a `settings` route with sections (General, Tuning defaults, Metronome, MIDI and pedals, Accessibility, Data and privacy, Profiles) and leave Practice for statistics and the journal. Link a gear icon in the top bar.
Effort: M

### Status bar colour ignores a forced theme
Evidence: `index.html:7-8` picks `theme-color` from `prefers-color-scheme` only. `applyTheme` (`practice.ts:322-326`) sets `data-theme` but never updates the meta tag, so forced Dark on a light system shows a light browser bar.
Fix: In `applyTheme`, replace both meta tags with one `theme-color` meta set from the resolved theme's background colour.
Effort: S

### Accessibility settings are minimal
Evidence: The Accessibility card has one switch (`practice.ts:214-221`). CSS has a `prefers-reduced-motion` block (`styles.css:3751`) but no in-app override. There is no text size control, and no warning next to `flashScreen` (`settings.ts:66`) about photosensitivity.
Fix: Add in-app "Reduce motion" (sets `data-motion="reduce"`, mirroring the media query rules), "Larger text" (root font-size scale 100%, 115%, 130%) and a photosensitivity note plus frequency cap on the full-screen flash.
Effort: S

### No app shortcuts in the manifest
Evidence: `public/manifest.webmanifest` has no `shortcuts`.
Fix: Add shortcuts for Tuner (`./#/tuner`), Metronome, "Log practice" (`./#/practice?log=1`) and Practice stats, each with an icon.
Effort: S

### Loading the take list reads every recording's audio into memory
Evidence: `db.list('recordings')` uses `getAll()` (`db.ts:96`), which returns every blob. With many video takes this is slow and memory-heavy just to show names.
Fix: Split into a `recordingMeta` store (no blob) and `recordingBlobs` keyed by id. List reads metadata; playback fetches the blob. Migrate in `onupgradeneeded` (version 3) using a cursor.
Effort: M

### A blocked database upgrade gives up and can leak a connection
Evidence: On `onblocked`, `db.ts:58-61` rejects and nulls `dbPromise`. The original open request can still succeed after the other tab closes, leaving an unused connection, and the user has to retry by hand.
Fix: On `blocked`, show the message but keep waiting for `onsuccess` and resolve then. Also post a BroadcastChannel request so old tabs close their connection (they already handle `onversionchange`).
Effort: S
