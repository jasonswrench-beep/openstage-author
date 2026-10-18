# Addendum to the handoff notes (2026-10-18)

Written by the Claude instance on the main PC. Read in this order: `HANDOFF.md`, `HANDOFF-ADDENDUM-2026-10-15.md`, `HANDOFF-2026-10-16.md`, then this file.
Where they differ, the later file wins, and the repository wins over all of them. Everything here is checked against GitHub `main` at the commit that adds this file.

Suggested first message to the new instance:

> Read the four notes in docs/handoff (in the order the last one gives), CLAUDE.md, the "What is left" part of ROADMAP.md and docs/decisions/0003-steps-and-practice.md. Run `git fetch` and tell me whether any other branch has new work. Then tell me in a few plain sentences where things stand, and wait for me to say what to do.

## What happened since `HANDOFF-2026-10-16.md`

Other Claude sessions worked on the same repository, on branches, while the main-PC instance was idle. Jason asked the main-PC instance to check GitHub for them. There was
no new handoff note, but there were two branches:

1. **`docs/arm64-and-first-real-recording`** (a session on a Windows 11 ARM64 laptop, 2026-10-16). Docs only: `docs/windows-arm64.md` (how to build there; the one extra
   tool is LLVM's `clang`, because the Rust package `ring` compiles C with it on ARM64) and a roadmap note. It also reports the **first real recording**: the recorder's
   `screen.mp4` is a valid fragmented MP4 with a keyframe every second, so picture grabbing and seeking are cheap, and an exported video's length matched the edit. The
   interaction log was empty because **noting the mouse and keys is off by default**: steps from a recording need the OpenScreen dialog's "OpenScreen may" choice set
   before recording. It also reported an unreproduced overshoot when dragging a clip back after a cut (now a roadmap item).
2. **`fix/say-when-saved-edit-misses-new-takes`** (a cloud session, 2026-10-17, 13 commits, about 6,300 lines). The recording editor was rebuilt for ease of use, with Jason's a screen recording studio
   video as the reference: a big picture with the timeline under it and a side panel for properties and the clip list; a tool bar; copy and paste; a zoom slider; thumbnails on
   clips; a gallery of ready-made callouts and a form for text and zoom; drawing a zoom; **transitions** (edit format 0.4.0: fade, cross-fade, two wipes, slide; the Rust reader and
   video maker included); adding **pictures, video and sound from files**; and a fix so that a saved edit no longer hides newer takes (the editor asks which edit to open).
   That session had no Rust compiler, no TypeScript compiler and no desktop window, so its commits say what was not run.

**Both are merged into `main` (2026-10-18)**, after the checks below. The remote branches are left in place; Jason can delete them.

## What was checked before merging, and what was fixed

- Capture's Rust workspace built and its tests passed (662 in one full run; `video::tests::too_much_processor_use_is_flagged_without_calling_the_video_broken` failed once
  under load and passed in every other run, in a file the branch does not touch: another timing-sensitive test, like the crash-recovery one in the older note). The editor's types
  are clean; the editor's tests pass (943, 1 expected skip); `capture-timeline` 120 and `capture-edit` 198 pass.
- **Transitions were run for the first time.** A video with a cross-fade between two parts of a recording was made with the rebuilt recorder, and frames were pulled out with ffmpeg
  and looked at: the first part, then both pictures blended, then the second. Only the cross-fade was looked at; the other kinds have the Rust tests only.
- **The merged editor was tried in the real desktop window, which the cloud session could not do. Three faults were found and fixed** (separate commits):
  1. The tool bar's icons sat on top of their labels. The editing screens' icon class was `os-icon`, the same name as the course player's class for icon objects, and the player's
     stylesheet (the editor includes it) positions that class absolutely. Now `os-tl-icon`. A check of the other `os-` class names found no other collision.
  2. The callout gallery's last three buttons (Picture, Video and Sound from a file) were hidden off to the side in a 900-pixel-high window: the number of columns was guessed
     from the window's height. It is now measured (`fitGallery` in `capture-timeline/src/editor.ts`).
  3. A video or sound from a file was copied into the course and then reported as unreadable, every time. Its length was measured through `assetUrl`, which reads a whole file into
     the page as a picture-typed data address. It now uses `mediaUrl` (play from disk with seeking), as the captions dialog does.
- **A race that caused two unexplained failures in the last note was found and fixed.** The recorder dialog asks the recorder for its list of screens when it opens, and the shell
  runs one thing at a time, so a video made at once was told "A recording is already in progress" when none was. `runOneShot` now waits up to 20 seconds, then says in plain words
  that the recorder is busy.

## State now

- Course format still **0.26.0**; the recording's edit format is now **0.4.0** (written only when a transition is used; an edit without one is still written as 0.3.0).
- Test counts at the commit that adds this file: editor 943 (942 pass, 1 skip; about 43 skip without `OPENSTAGE_PYTHON`), editor Rust 90, Capture Rust workspace 662 plus the one
  flaky test above, `capture-timeline` 120, `capture-edit` 198, player 279, Python 278, 16, 87, 12 and 38, `check_rules.py` passes.
- **Still not verified:** anything with a screen reader; a real screen recording through the whole path in the editor window (the ARM64 session did one by hand, the main PC has only
  seen test sources); real clicks and keys turned into steps (the log is off by default); the take-picking questions (need several takes); the other four transition kinds by eye;
  captions and steps by a person.
- **The other items of `HANDOFF-2026-10-16.md` stand:** the Whisper trial waits for Jason's yes; the learner accessibility panel and the AI help note wait; Practice needs Jason's
  choice between hotspot objects and the quiz hotspot question; D6 alt-text suggestions need a format design. Phase 7's next stage is pictures for steps.

## Working with other sessions (new)

- Run `git fetch` at the start and look at `git branch -r` and `git log main..origin/<branch>`. Other sessions push branches and do not always write a handoff note.
- To bring a branch in: make a temporary local branch from `main`, merge the branch there, run the checks (editor types and tests, `capture-edit` and `capture-timeline` tests, the Rust
  tests, then **look at the real window**), fix what is found in separate commits, then fast-forward `main` to it. A merge may conflict in `ROADMAP.md` (every session edits it): keep both
  sets of items.
- **Code from a cloud session arrives unbuilt and unseen.** Its commit messages say what was not run. Build it, run it, and look at it before trusting it.
- Do not delete someone else's remote branch without asking Jason.

## Traps found in this stretch (add to the lists in the earlier notes)

- A class name used by two packages that are both loaded into the editor can collide: the editor's `web/style.css` holds the player's stylesheet and the editing screens' stylesheets
  together, so name classes in `capture-timeline` with its own prefix (`os-tl-`, `os-cl-`, `os-ed-`) and never reuse a player class (`os-icon`, `os-text`, `os-shape`, `os-button`, ...).
- `Backend.assetUrl` reads a whole file into the page and is for pictures only. Use `Backend.mediaUrl` for anything played (video, sound).
- The editor's rule `.dialog button { padding: 6px 16px; font: inherit }` beats a package's single-class button rule; a package's own compact buttons need a rule scoped to the dialog
  (see `.recording-editor button.os-tl-tool` in `editor/src/editor.css`).
- The Capture program the editor starts is `capture/target/release/openstage-capture.exe`, built from the crate **`openstage-capture-cli`** (`cargo build --release -p openstage-capture-cli`).
  `-p openstage-capture` is a library and does not rebuild the exe. After any change under `capture/crates`, rebuild it (or double-click `OPEN EDITOR.bat`) before trying a video in the editor.
- The Capture workspace compiles into its own target folder; a full `cargo test --workspace` on Windows takes a few minutes the first time. Skip `cues_on_or_off` to avoid real beeps.
- `ffmpeg` is on this PC's PATH (a winget install) and is fine for making test videos and pulling frames out of a result; the product itself never uses FFmpeg.

## Still worth doing before the next big feature

Add the small real-app driver and the made-up-recording builder (the scripts used for the checks of 2026-10-16 to 2026-10-18 are in a session scratchpad, not in the repository) to a `tools/`
folder, with a `.bat`, so that a future instance can repeat the checks in a minute. The checks that exist: captions (45), describe the screen (9), steps (21), files in the recording editor (5).

## Later on 2026-10-18: Phase 7, Stages 2 and 3 (pictures, and the Watch lesson)

Jason answered the Practice question ("hotspot objects or the quiz hotspot question?") with "Yes" to my recommendation, taken as: **Practice uses hotspot objects, Assessment uses the quiz kinds**
(recorded in `docs/decisions/0003-steps-and-practice.md`; Practice is the only part that would change if that was not what was meant, and it is not built).

Built, tried in the real desktop editor (26 checks, then the saved course went through `tools/validate.py`) and pushed:

- **A picture for each step** (`editor/src/steppicture.ts`). Taken in the window from the take's own video (`crossOrigin = "anonymous"`, seek, canvas, PNG; scaled to at most 1,920 wide). A box marks the place
  to point at: Tab to reach it, arrow keys to move (Shift resizes, Control is five times as big), mouse to drag or to press elsewhere, four percent fields as the keyboard-and-screen-reader equivalent. Steps
  now keep `picture` and `box` (percent) in `steps.json` (`steps.ts`: `Box`, `startBox`, `knowPicture`, `nudgeBox`, `clampBox`).
- **The Watch lesson** (`editor/src/stepslides.ts`, `Model.makeStepSlides`, the dialog's **Make a Watch lesson** button). One slide per step after the current slide, one undo step: heading, the step's words with narration
  (D7 for step text), the picture, a decorative frame round the box. Picture descriptions only from steps ticked as checked; the validator then asks only for the rest. `provenance` on each slide (recording folder name,
  step id); a step that already has a slide is skipped. New shell command `save_step_picture` (a real PNG, a safe name, never overwrites). `Model.stepsWithSlides(recording)` reports which steps have slides.
- Counts now: editor 961 (960 pass, 1 skip), editor Rust 91, `capture-timeline` 120; everything else as in the section above.

## Later still on 2026-10-18: Phase 7, Stages 4 to 6 (Practice, the Test, bringing a lesson up to date)

Built, tried in the real desktop editor (all three lessons in one course; the saved course through `tools/validate.py`, which asked only for the unchecked pictures' descriptions) and, for what a learner can do, in the
player's own runtime (`Runtime` from `player/src/runtime.ts`, used in `editor/src/steplessons.test.ts`):

- **`editor/src/steplessons.ts`**: `buildPracticeSlide` (hotspot over the place, hotspot "Anywhere else on the screen", Show me, an invisible frame with a look `Shown`, layers `layer-hint`, `layer-shown`, `layer-right`; a
  `practice tries` number variable reset by a `slideStart` rule; hint from the name of what was clicked; typing = short-answer worth 0 points), `buildTestSlide` (hotspot question, the place among up to four grid cells it does not touch,
  one point, one try, no hints; typing = scored short answer), `lessonCapture` (`name.capture`, `name.capture#practice`, `name.capture#test`: each lesson its own `sourceCapture`, because two slides may not claim one step; written
  into `docs/format-spec.md`, no schema change). Steps with nothing to press fall back to the Watch slide, named for the lesson.
- **`Model.makeStepSlides({ recording, lesson, steps, pictures })`**: makes only the missing slides, each in its step's place among the lesson's slides; reports (never changes) slides for steps that are gone and slides whose words differ
  from their step's now; creates the `practice tries` variable once, inside the same undo step. The dialog has a **Lesson** choice and a field for **What was typed** (the answer Practice and Test accept).
- A fuller bringing up to date (rewrite a slide whose step changed, keeping the author's additions) needed a record of what was generated, which `provenance` could not hold: a **format change**. Jason asked for it, and it is built: see the last section.
- Counts now: editor 979 (978 pass, 1 skip), editor Rust 91; the rest as above.
- **Not tried:** a real recording's pictures; any lesson in a real LMS or with a screen reader; the real browser player (the logic is covered in the runtime; the DOM drawing is the shared renderer's).
- **Traps found:** in the slide list each slide is `<li><button class="item">`: click the **button**, not the `li`, in a script; a screenshot taken straight after a click can show the previous frame, so wait before it.

**What is left of Phase 7:** a real-world pass (Jason recording clicks with the mouse setting on, then Watch, Practice and Test, in Preview and in an LMS, with a screen reader), and the optional fuller update above. Other open items are unchanged:
the Whisper trial, the learner accessibility panel, the AI help note, D6 alt-text suggestions.

## Last on 2026-10-18: bringing a lesson up to date, fully (course format 0.27.0)

Jason: "I think a bring up to date would be important." Built, tested and pushed.

- **Format 0.27.0.** A slide made from a step may carry `provenance.base` (the slide's name, the picture's take and moment, and for each part: its id, layer, and a fingerprint of **each field**). Schema, `player/src/types.ts`,
  `tools/migrate.py` (0.26.0 to 0.27.0; nothing in an existing project changes), `tools/validate.py` (`SUPPORTED_SCHEMA_VERSION`), the editor's `FORMAT_VERSION`, the examples, the template, the Rust test asserts and `docs/format-spec.md` all say 0.27.0.
- **`editor/src/stepbase.ts`** (new, with `stepbase.test.ts`): `baseOf`, `baseFrom`, `fieldHashes`, `untouched`, `mergeSlide`. The slide is made again in memory from the step with the same ids (`partId`, `existing`,
  `roles` in `SlideOptions`), then each field of each part is compared three ways (as made, now, would be made now). Taken if only the step changed it; kept (and reported) if the author changed it; deleted parts stay
  deleted; added parts untouched; removed from the step = removed only if the author never changed it. Narration compares by script only (voice, speed and language stay). `locked`, `group` and rule ids are ignored.
- **`Model.planStepLesson`** says in words what pressing the button would do without changing anything; **`Model.makeStepSlides`** does it as one undo step (`removeGone` only when told, which the dialog does after a
  confirm). A picture is taken again only when the step's take or moment changed. The dialog button is now **Make or update the lesson: one slide for each step**.
- **Per-field, not per-object.** The first design fingerprinted a whole object, which stopped a new picture being used when the author had only written its alt text. Per-field fixed it; an object's name no longer
  carries "of M", so headings renumber for free.
- **Also fixed on the way.** `runOneShot` (the recorder's short jobs) had a race: a job that waited for another to finish heard that job's lines and exit as its own, so "Describe what is on the screen" and captions
  failed with "The video could not be made." It now waits until the recorder reports it is free (`streamState`) and listens only after that; anything heard while a start was being answered is passed on only if the
  start was accepted. New tests for both. `stepbase.test.ts` was missing from `npm test`; it is in now.
- Counts: editor 996 (995 pass with `OPENSTAGE_PYTHON=python`, 1 expected skip; without it the 45 "real validator" tests skip), player 279, Python 439, editor Rust 91. Real-editor passes (made-up recording): captions, describe on
  screen, steps review, pictures, three lessons, and the update (words, picture and place changed, a step deleted, own alt text kept, nothing to do on a second press), all PASS.
- **Not tried:** a real recording; the update on a course that was taken to an LMS; a screen reader on the confirm and the report text. Slides made before 0.27.0 are left as they are (the dialog says so).
- **Trap:** `-I` on `python -m unittest` hides the installed `jsonschema`; use plain `python` for the project's own tests.

## Whisper quality trial (done 2026-10-18, after Jason said "do it")

Result: **Whisper passes; D3 stays in Release 1.** Full numbers and caveats are in `docs/decisions/0002-speech-recognition.md`; the scripts are in `tools/asr-trial/`.

- Built `whisper-cli.exe` (whisper.cpp v1.9.5, CPU only) with the CMake and C++ compiler that ship with Visual Studio 2026 Professional (no new tool was needed). Models downloaded and their SHA-256 matched
  Hugging Face. Everything lives in `D:\Whisper-Trial` (source, build, models, audio, results), outside the repo; delete the folder to remove it (731 MB, of which 636 MB are the two models).
- Accuracy: 99.8% on a known script, 97.8% to 98.9% with laptop noise, 83% (base.en) and 93% (small.en) with the voice only about 4 dB over the noise. Jason's real narration: both models gave the same 271 words, which read correctly.
- The built-in caption times are poor; **alignment mode (`-dtw small.en -nfa`) is accurate** (every sentence start within 0.5 s). Captions must end by the next word and the real sound.
- It never invented a sentence; it wrote "You" on perfect silence and notes like `[BLANK_AUDIO]` and `(keyboard clicking)`, so a filter is required. "New Paltz" needs a hint of the course's own words.
- Speed: a 2-minute recording takes about 25 seconds with small.en (37 on two threads); memory 880 MB (410 MB for base.en).
- **Decided for the build:** small.en default (base.en optional), alignment mode, a hint of the course's words, a filter, a generic build with the C++/OpenMP runtimes bundled, `NOTICE` naming the exact licences.
- **Not tested:** other speakers or accents, a poor microphone, music, long recordings, other languages, ARM, a graphics card. The first real build should be tried on a recording of someone other than Jason.
- Traps: `python -I` hides installed packages (`jsonschema`, `numpy`) so do not use it for the project's own tools; Kokoro's own word times run about 5% long and need stretching to the sound before they are used as truth;
  the shell's `/tmp` is not Python's `/tmp`.

## Captions from a recorded voice (D3) built (2026-10-18, after Jason said "Continue with your recommended build")

Built, tested and pushed. User guide: `docs/speech-recognition.md`. Decision and results: `docs/decisions/0002-speech-recognition.md` ("What was built").

- **What it does.** In the captions dialog, a new panel listens to the clip's voice on this computer and writes captions with the time of every word, or sets the times of captions that are already there (keeping their words). The result is marked unchecked (dialog and a `NOTE` in the .vtt) until the author says they checked.
- **Pieces.** `editor/src/recognition.ts` (pure: read whisper.cpp's `-ojf` JSON using the alignment times `t_dtw`; drop `[BLANK_AUDIO]`-type notes and words heard in silence; cut words into captions that fit; place existing captions by the voice; the hint of the course's own words; WAV writing), `speechaudio.ts` (the window decodes the clip's sound to 16 kHz mono, so no FFmpeg and no Capture change),
  `speechpanel.ts` (the screen), `captionsdialog.ts` (wired in), `captions.ts` (the `Heard` mark in the file), `src-tauri/src/speech.rs` (model table with size and SHA-256, checked download, run options, WAV check) and the `speech_*` and `read_media_bytes` commands in `lib.rs`. `BUILD SPEECH RECOGNISER.bat` builds whisper.cpp v1.9.5 (pinned to commit `d1be6fde...`) into `speech/` (git-ignored) as a generic build: CPU variants chosen at run time, C++ runtime linked in.
- **Models.** small.en (488 MB, default) and base.en (148 MB) are downloaded only when the author presses the button and says yes; kept in `%LOCALAPPDATA%\com.openstageauthor.editor\speech-models`. On Jason's PC both are installed (small.en copied from the trial; base.en downloaded through the real button). `D:\Whisper-Trial` (731 MB) is the trial folder and can be deleted; `speech/` in the repo folder holds the build and its 20 MB source.
- **Important fix on the way.** The window's page was reaching the shell by a slow text route for EVERY command, because the content security policy did not allow Tauri's own channel. `tauri.conf.json` now has `connect-src ipc: http://ipc.localhost`. Raw bytes (the sound) need the fast route. All earlier real-app scripts (captions, describe, steps, pictures, lessons, update) were run again and pass.
- **Tests.** Editor 1022 (1021 pass, 1 expected skip, with `OPENSTAGE_PYTHON=python`; 21 new in `recognition.test.ts`, 4 in `speechaudio.test.ts`, 1 in `captions.test.ts`), editor Rust 101 (10 new: model table, progress parsing, options, WAV check, checked download including bad hash, short, long and cancelled, program lookup, media reading), player 279, Python 439. Real app (CDP scripts in the scratchpad: `rec17` 38 checks on the spoken video, `rec18a` the base.en download, `rec18b-*` silence/keyboard/tones): 100% of 462 words right with the hint, 27 of 28 sentence starts within 0.5 s, "SUNY New Paltz"/Brightspace/SCORM/Wrench right, Stop, close mid-listen, save/reopen mark, no captions from silence.
- **Not tried:** another person's voice or accent, a poor microphone, music under speech, a clip near the 45-minute limit (the whole sound is held in memory), a computer without AVX2 (the generic build should choose a variant; not run), ARM, a screen reader on the new panel (labels, states and focus were checked by script only).
- **Also fixed:** two lines of `VALIDATE EXAMPLES.bat` had a control character where `\v` should be, so the question-types and scenario examples were never validated by it.
- **Traps.** The Bash tool collapses backslashes inside heredoc Python (write patch scripts with the Write tool, or use `chr(92)`); `sed -i` on a CRLF file turns it into LF (a `.bat` must keep CRLF); a `.bat` with spaces in its name cannot be launched through `cmd /c` from Git Bash (call it from a small wrapper); `taskkill /F /T /IM openstage-editor.exe` is more reliable than `Stop-Process`; the running app locks its exe, so close it before `tauri build`; a PowerShell `Start-Process` of the app needs `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`.
- **Next for D3 (optional):** try it on a recording of someone other than Jason; a screen-reader pass of the panel (add it to `docs/screen-reader-pass.md`); the "placing by the quiet gaps" method (no model) is still not built and is lower value now.

## The first-real-run checklist and the learner accessibility panel (2026-10-18, Jason: "go ahead with the checklist and the accessibility panel, using the two-button transcript")

- **`docs/first-real-run.md`**: a 45-minute walkthrough for Jason with a real screen, voice and microphone (record in Notepad with a given script, edit, make a video, captions from the voice, steps and the Watch/Practice/Test lessons, Preview), what to tell us after each part, and optional screen reader, Accessibility button and Brightspace steps. Everything built so far has only seen made-up recordings and a computer voice; this is the real test.
- **Learner accessibility panel** (`docs/learner-accessibility.md`; no format change). `player/src/a11y.ts` (pure: the choices, `pageSettings`, `needsReflow`, `describe`, load/save with a storage that may be blocked, `pickVoice` that only accepts local voices, `speechChunks`), `transcript.ts` (pure: the course transcript, no quiz questions; a quiz slide shows its title and a note only), `a11ypanel.ts` (the panel, reading line, read aloud, transcript window and download),
  `player.ts` (`applyA11y` sets `data-os-*` attributes and `--os-a11y-*` variables on the player and `<html>`, forces the one-column layout when text is bigger or more spaced, `unvoicedText`, the button in the nav bar, stops reading when narration starts or the slide changes), `narration.ts` (`playing`), and the end of `player.css`. Text size uses CSS `zoom` on words and controls in one-column mode; colour modes override the course's `--os-*` colour variables with `!important` on the slide and recolour objects, shapes and buttons (pictures untouched).
- **Choices made.** Two buttons for the transcript (Show opens a window; Download saves a plain `.txt` named from the course title, UTF-8 with a byte order mark and Windows line endings, because `.html` opens in Notepad on Jason's PC). Reading aloud only on a button press, never while narration plays, local voices only, Escape stops it. Settings in `localStorage` key `openstage.accessibility.v1`, or for the visit only if blocked. Quiz slides contribute nothing but a note to the transcript, because a quiz question's words are a separate text object that cannot be told from other text.
- **Tests.** Player 299 (20 new in `a11y.test.ts` and `transcript.test.ts`); editor 1022 unchanged. In a real browser (the 24-slide lesson served locally, driven with the browser tools): all settings, dark and yellow modes on an interaction and a quiz slide, Tab/Enter/Tab/Escape with real key presses (focus goes to the panel, first control, back to the button), reading line following a real pointer move, read aloud (David, local, `en-US`, only "Your score" etc.; refused while narration played; Stop works), transcript (24 sections, no quiz wording, 5 quiz notes) and file (name, size, CRLF), reset (attributes, variables and storage all cleared), persistence across reload, phone size (the panel is a sheet at most 62% high).
- **Not tried:** a screen reader (`docs/screen-reader-pass.md` has new patterns 12 and 13, for the panel and for captions from the voice), Firefox or Safari (`zoom` is standard now but untried), an LMS that blocks `localStorage`, print.
- **Traps.** `node publish.ts` deletes its output folder first, so do not serve from inside it (a server holding the folder open makes the delete fail with EPERM). The Browser pane screenshot can show the previous frame straight after a click; take another. A script that looks for a button named "Close" finds the first one in the page (the Credits dialog's), so look inside the panel.

## Alt text suggestions, D6 (2026-10-18, format 0.28.0; Jason: "Start with 2 and 3")

- **Format 0.28.0**: `accessibility.altSuggestion` `{ text, basis }`, optional, a description the computer worked out that the author has not approved. The player ignores it; alt text is still required; the validator's `alt-text-missing` detail shows the waiting suggestion, and `alt-suggestion-unused` (warning) flags a leftover. Schema, `player/src/types.ts` (`AltSuggestion`), `tools/migrate.py` (0.27.0 to 0.28.0, nothing to change), `tools/validate.py`, tests, the ten examples, the template, the Rust test asserts and `docs/format-spec.md`.
- **Editor**: `Model.useAltSuggestion` / `dismissAltSuggestion` (one undo step each; writing your own alt text or marking decorative clears the suggestion), a labelled group in Properties under Alt text with **Use this description** and **Throw the suggestion away**, "description suggested" in the objects list. Step pictures of unchecked steps carry `altSuggestion` (`stepslides.ts`, `SUGGESTION_BASIS`); the lesson message says how many have suggestions.
- **Recording editor**: `editor/src/calloutalt.ts` (pure) finds the take and moment shown at the callout's start (`takeTimeAt`), the named click nearest it (`namedClickNear`: 2.5 s before to 1.5 s after) and words for a box, circle or arrow; `readClickLogs` in `stepsource.ts` reads the logs; `capture-timeline/src/item-form.ts` shows the suggestion beside the alt text box (`ItemFormOptions.suggestAlt`, passed through `EditorOptions`; the timeline package knows nothing of logs). The roadmap's note that the screens for shapes and arrows were missing was out of date: the callout gallery and form came on 2026-10-17.
- **Tests**: editor 1036 (1035 pass, 1 expected skip; 8 in `altsuggestion.test.ts`, 6 in `calloutalt.test.ts`, step picture test extended), editor Rust 101, player 299, Python 444 (5 new). Real app, scripts `rec19.js` (26 checks) and the earlier step scripts `rec14` to `rec16` (still pass).
- **Traps found.** Another program, OpenExplainer, may be holding debugging port 9222: the real-app scripts now use port 9333 (`run_rec.ps1`, `cdp.mjs` reads `CDP_PORT`). A programmatic `.click()` does not move focus, and a text box that has focus is deliberately not overwritten by a refresh, so a button that fills a box must take focus first. `npx tsc` in a folder that has no TypeScript makes npm fetch an unrelated package named `tsc` (it did once, harmlessly into npm's cache); use `editor/node_modules/.bin/tsc`.

## Finishing the editing screens (2026-10-18, Jason: "Start with 2 and 3. Then we'll do 4 and come back to 1")

- **Edit model (`capture-edit`, 217 tests, was 198).** `deleteRange` now treats overlays and zooms: inside the stretch removed; crossing an edge shortened to it; spanning it shorter (gap closed) or cut in two with a new id (gap left); a piece under 0.1 s dropped; later ones moved earlier when the gap closes; refused if it would make a new error (a zoom's rules); the sentence counts removed, dropped and shortened. New `deleteTrack(model, id, withContents)` (non-empty refused unless `withContents`), `src/group.ts` `moveRowsBy(model, ids, deltaMs)` (all or nothing, built on the single moves; refuses a time before the start, which the single moves would quietly clamp; a chosen zoom may not jump a zoom that was not chosen) and `groupMoveLimits` in `limits.ts`. Tests in `stretch.test.ts` (11) and `group.test.ts` (8). Trap: `wholeMs` clamps negatives to 0, so a negative shift must not go through it.
- **Timeline (`capture-timeline`, 143 tests, was 120).** `snap.ts` (pure `snapTo`, `snapTargets`); `session.ts`: `snapping`/`toggleSnapping`, `dragTo(ms, {snapWithinMs})` with `DragState.snappedTo` and `.ids`, group drags in `beginDrag`/`endDrag`, `stretch`/`markStretchStart`/`markStretchEnd`/`clearStretch`/`removeStretch(closeGap)`, `renameTrack`, `deleteTrack`, new change kind `tools`. `commands.ts`: I, O, X, Shift+X, Alt+X, N (the clip list screen gets buttons for them automatically). `timeline-panel.ts`: tool bar buttons, Snap with `aria-pressed`, the stretch band and marks and a line of words, the snap guide line, the Tracks menu with an in-panel rename form and delete question, Alt turns snapping off for one drag. CSS in `timeline.css`. Tests in `finishing.test.ts` (23).
- **Real app.** `rec20.js` (50 checks, all pass) with `run_rec.ps1 -Make make_proj_steps.py`. `rec19.js` still passes (26) when run with `-Make`. The old `rec4.js` has a stale selector (`.os-cl` now matches the preview section first, so its F6 check fails although F6 works) and also needs a fresh `edit.json`; use `proj-rec-fresh` (a copy without `edit.json`) and `rec4f.js`.
- **Left out, on purpose, and said so in the roadmap.** A captions track on the timeline (captions are written in their own dialog after the video exists); cursor and click effects (the exporter and the edit file need them first: the recorder's item); the recorder hardware items (choosing a window by clicking, hiding windows, long recordings) cannot be checked without Windows hardware and a person.
- **New choices to look through:** 48 to 54 in `capture-timeline/README.md` (I and O instead of a drag on the ruler; X and Shift+X with no default; always every track; snapping on by default at 8 pixels; a group moves together; a track with things on it asks first; slivers dropped).
- **Not tried:** a screen reader on any of it (the timeline still must not ship until one has been used), a real recorder-made `screen.mp4`.
