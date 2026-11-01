# Building on a Windows ARM64 computer

Written 2026-10-16, after the editor and OpenScreen were built and run for the first time on a Windows 11 ARM64 PC (a Snapdragon-class laptop). Everything in the roadmap had been built on an x64 machine before this.

## What worked

- Git, Python (3.15, 32-bit), Node 26.12 with npm 11.20 and Rust 1.99.1 (`aarch64-pc-windows-msvc`) all run natively or under emulation without changes to the project.
- Visual Studio 2026 Community with the ARM64 build tools supplies the linker.
- All five Python tests, the player's type check and tests, the editor's type check and tests, and `capture/tools/check_rules.py` passed. The one expected failure on any fresh clone is the Kokoro audio cache test in `narration.test.ts`, which needs a cached voice that a fresh clone does not have.
- The editor (`openstage-editor.exe`) builds and opens. OpenScreen (`openstage-capture.exe`) builds.
- The computer check passes, including a hardware H.264 encoder.

## The one extra thing: LLVM clang

The Rust package `ring` (version 0.17.14) compiles some C and assembly files with **clang** on `aarch64-pc-windows-msvc`. Visual Studio's own compiler is not used for them. Without clang the editor build stops with an error naming `ring`.

Fix: install LLVM (`winget install --id LLVM.LLVM -e`) and put `C:\Program Files\LLVM\bin` on the PATH while building. LLVM is Apache 2.0 with LLVM exceptions, and it is a build tool only: nothing from it is linked into or shipped with the program, so it does not touch `NOTICE`.

## Python package

Only `jsonschema` is needed. `python -m pip install --user jsonschema`. The PATH warning pip prints about its scripts folder can be ignored.

## First real recording

A real screen recording was made, edited, exported and put on a slide:

- `screen.mp4` is a fragmented MP4 (moov, then moof and mdat pairs). It is valid and has a keyframe every second (22 in a 21 second take), so seeking to any time for a picture is cheap.
- The exported video length matched the edit.
- `events.jsonl` was empty. This is not a fault: noting the mouse and keys is **off by default** (`--interactions off`). Steps from a recording need the OpenScreen dialog's "OpenScreen may" choice set to note the mouse, or the mouse and keys, before recording.

## Open report

After cutting a recording in half, dragging a clip back toward the start went past the start line and then settled onto it. The model clamps a clip's position at zero (`session.dragTo` and `geometry.msAtX`), so the overshoot may be only the pointer or the drawn clip leaving the lane before the settle. Tried again 2026-11-01 with a real mouse in headless Chromium (Playwright): every clip and overlay of the timeline demo, with and without a cut at 15 seconds, dragged far past the start line, at 100, 150 and 200 percent screen scaling (24 drags, 4 of them moved something). Nothing was ever drawn before the line and nothing moved after the button was let go. Only overlays can move left; screen clips are held by their neighbours. A browser check now guards it (shown to fail when the drawing is broken on purpose). Still not seen on the ARM64 PC: if it shows again, note which thing was dragged. See ROADMAP.
