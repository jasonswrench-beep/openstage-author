# Capture: handover to OpenStage Author

This is the note that comes with the import of OpenStage Capture into this repository. It says what is here, what was checked, what was not, and what is still to do. `IMPORT-MANIFEST.md` beside it lists every file that was copied, with its checksum.

Source: `jasonswrench-beep/claude-test`, branch `claude/screen-recording-software-brief-ivhxqp`, commit `9c2c6fa303709f73650361e31e0a2cf12c5a5ce3`, dated 2026-10-15.

## What Capture is

A screen recorder and a mid-level video editor for recordings (trim, split, text, shapes, blur, zoom, webcam picture in picture, sound mixing, MP4 export). Windows first. Apache-2.0. It is a module of OpenStage Author, not a separate product. The recorder is a Rust program the editor starts; the editing screens are TypeScript.

## What is where

| Folder | What it is | Language |
|---|---|---|
| `capture/` | The recorder (`openstage-capture`), the exporter (`render`), the Windows parts, the test scripts you can double-click, and the rule checker | Rust, plus `.bat` scripts |
| `capture-edit/` | The edit model: tracks, clips, trim, split, join, move, undo and redo, limits, volume and fades, overlays, playing the edit at any moment. It says in plain words what each action did | TypeScript, no runtime dependencies |
| `capture-timeline/` | The editing screens: the clip list, the visual timeline, the preview that plays the edit, opening and saving. A standalone package with a demo page | TypeScript and plain DOM, no runtime dependencies |
| `docs/capture/` | Capture's documents: brief, requirements, roadmap, the protocol, the two file formats, and what it asked of OpenStage | Markdown |

The Rust workspace in `capture/` is separate from the Tauri editor's (`editor/src-tauri/`). They share no `Cargo.toml` and no `target` folder. The two Rust pieces talk through the protocol in `docs/capture/capture-protocol-spec.md`; the editor's side of that is `editor/src-tauri/src/stream.rs` and `editor/src/recorder.ts`, which were already here.

## What was checked on this branch

Run on Linux, on the files as they now are in this repository:

| Check | Result |
|---|---|
| `python -I capture/tools/check_rules.py` (licences of 65 dependencies, no FFmpeg, file headers, no em dashes, batch file rules, no runtime dependencies in the two TypeScript packages) | All passed |
| `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings` | Clean |
| `cargo test --workspace` | 673 passed, 0 failed, 1 ignored |
| `cargo check --workspace --all-targets --target x86_64-pc-windows-msvc` (the Windows-only code, type-checked from Linux) | Clean |
| `capture-edit`: `tsc` and `node --test` | Clean; 161 tests passed |
| `capture-timeline`: `tsc` and `node --test` | Clean; 98 tests passed |
| `capture-timeline`: `node tools/browser-check.mjs` (a real browser, keyboard only, contrast, 320 pixels wide, forced colours, a 60 minute recording in 720 clips) | 47 passed |
| This repository's own tool tests (`test_validate`, `test_migrate`, `test_todo`, `test_icons`) | Unchanged and passing |

The type-check of the Windows-only code says it compiles. It says nothing about how it behaves on Windows.

## What was not checked, and what has never been run

Do not read more into the above than it says.

- **No screen reader has ever spoken any of the editing screens.** The clip list, the timeline and the preview were checked by scripts and by a script that reads what a screen reader would be given in a real browser. Not NVDA, not Narrator, not a paid Windows screen reader, not the Mac's screen reader. The timeline must not ship until this is done (story C3). `capture-timeline/README.md` has a "Please listen to this with a screen reader" list of what to listen for.
- **The recorder's own screens (the region picker and the window list)**: no screen reader result has been recorded for them either.
- **The browser's real file and folder pickers** (Edge and Chrome) have not been used with the demo page. The checks reach the fallback ("choose a folder" box), and a fake folder handle stands in for the real one.
- **Playing a real recording's `screen.mp4` in a browser** has not been seen. The browser used for the checks cannot play H.264, so those checks used WebM.
- **No result has been reported from opening the editing screens' demo on Windows** (`OPEN TIMELINE DEMO.bat`). It was run here on Linux only.
- **The second LMS, the third LMS, the institution's LMS, NVDA and the Mac's screen reader** (OS-16 and OS-17 in `openstage-session-handoff.md`) are OpenStage's own open items, not Capture's, and nothing here changes them.
- What has been run on a Windows computer, and what the owner saw, is in `capture/README.md` ("What tested means here" and the table at the top). Read that rather than a summary of it.

## Things in the copied documents that need knowing

The documents were copied byte for byte, so they still read as written in the Capture repository. In particular:

- **"This repository" in the Capture documents means the Capture repository**, not this one. `openstage-requests.md` and `openstage-session-handoff.md` were written for a reader in this repository; their tasks are mostly done (see this repository's `ROADMAP.md` and `docs/handoff/`), and they are history now, not a to-do list.
- **Comments in the Rust and TypeScript code point to `docs/prd.md`, `docs/capture-protocol-spec.md` and so on.** Here they are in `docs/capture/`. The code was not touched to change the comments (only the rule checker was), so read `docs/X.md` in a code comment as `docs/capture/X.md`.
- **`capture/README.md` says 658 tests pass on Linux. The run above counted 673.** The README was not brought up to date after the last additions. The README was left as it is.
- **The roadmap's Phase 3 row says "the Windows parts have never been run".** The README is newer: the export demo was made on a work PC on 2026-10-15 and cancelling worked. How the exported video looks is still not confirmed. The roadmap was copied word for word as asked, so the older sentence stays.
- **Capture's phase numbers are not OpenStage's.** Capture's roadmap has Phases 0 to 8; this repository's `ROADMAP.md` has one entry, "Phase 4: Capture module". Capture's "Phase 5: editor panels" is the work that puts the editing screens into `editor/src/`.

## How the editing screens will join the editor (not done)

`capture-timeline/` is a standalone package so it could be built and tested before the editor was ready for it. It is not wired into `editor/src/`. Joining them means, in this repository and agreed with the owner first:

1. Mount the clip list, timeline and preview as an editor region, and put them in the editor's F6 cycle (the timeline package has its own F6 for its three panels; the editor's F6 has to treat the whole thing as one stop and let the keys through).
2. Use the editor's own file and folder dialogs (Tauri) behind the package's `ProjectFolder` interface, in place of the browser pickers the demo uses.
3. Use the editor's live region for announcements, in place of the package's own.
4. Add the recorder panel (start, pause, stop, the countdown, the take list) on the protocol.
5. Run the screen reader pass before any of it ships.

The accessibility rules of this repository's `CLAUDE.md` apply to all of it, including the rule that text a learner is meant to read should be able to have audio. Capture's captions and audio description (its Phase 6) are where that is met for recordings; they are not built.

## Decisions that are the owner's

- **Which copy is live afterwards.** Two live copies drift apart. Recommended: this repository is live, and the Capture repository is frozen at the source commit above with a one-line pointer here. Not decided.
- **The 25 choices that could have gone the other way** are listed in `capture-timeline/README.md` ("Choices that could have gone the other way"), and the edit format's choices in `capture-edit-format.md`. Each is one small change to reverse.
- **Still to write in this repository, when the owner says so:** `docs/decisions/0001-screen-capture.md` (the draft assumed Electron and must be corrected for Tauri), the licensing rules in `CLAUDE.md`, and the link in this repository's Phase 4 roadmap entry (it still points to the Capture repository). The reasoning for the licensing rules: some open-source recorders are AGPL, so their code cannot go into an Apache-2.0 project; they can be used as separate programs.
- **Not built**, so as not to be mistaken for done: snapping, dragging several clips at once, removing a stretch, renaming or deleting a track, editing screens for overlays and zoom, a captions track, cursor and click effects, an export button.

## Switched off on purpose

`capture/ci/capture.yml` is a continuous integration file. It is in `capture/ci/`, not in `.github/workflows/`, so GitHub does not run it. Moving it into `.github/workflows/` switches it on. Its `paths` list would need `docs/capture/**` rather than `docs/**` first.

## How to check this import is intact

`IMPORT-MANIFEST.md` has a checksum for each file. Every file is identical to the source commit except the four listed under "Changed on import" there.
