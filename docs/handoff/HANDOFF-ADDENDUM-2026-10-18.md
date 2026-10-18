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

**Next:** Stage 4, Practice, as in the ADR: for each step a slide with the picture, a `hotspot` object over the box (named by the step's words, reached by Tab, Enter or Space), a hint layer after a wrong try (a click elsewhere,
or a second hotspot named "Anywhere else on the screen" so a keyboard user has the same choice), an attempts variable (`setVariable` with `operation: "add"`), and the target shown after three tries; typing steps as
`shortAnswer` questions worth 0 points. Then Stage 5 (Assessment, scored quiz kinds, one try, no hints) and Stage 6 (bringing a lesson up to date). Not tried yet with a real recording's pictures or a screen reader.
