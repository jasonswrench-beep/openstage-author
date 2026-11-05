# ADR 0001: Screen capture and recording

Status: Accepted, and corrected on 2026-10-15
Date: 2026-10-12 (first draft), corrected 2026-10-15
Applies to: the Capture module (shown to authors as OpenScreen), which lives in `capture/`, `capture-edit/`, `capture-timeline/` and `docs/capture/`.

## What the correction changed

The first draft decided to record the screen with Electron's built-in `desktopCapturer`. OpenStage Author is a Tauri app (decided 2026-10-10), and
the web view Tauri uses has no such interface. Capture also needs more than a picture: a recording that survives a crash, the computer's own sound
as well as a microphone, the cursor, the clicks and the names of the buttons clicked (so that step-by-step lessons can be made), and keys that work
while another program has the focus. So the decision below replaces the Electron one with what Capture is actually built as. The licence
reasoning and the audit of other recorders stand as they were.

## Context

OpenStage needs screen recording and, in time, software simulation. Both are expected in this product category. The question was
whether to adopt an existing open-source screen recorder, and if so, which. The GitHub `screen-recorder` topic lists over 600 repositories; this
record is the result of auditing the significant ones.

OpenStage is licensed Apache 2.0. That constraint decides most of this before technical merit is considered.

## The licence constraint

Apache 2.0 is one-way incompatible with the GPL family. Apache 2.0 code may be incorporated into a GPL-3.0 project. GPL or AGPL code may not be
incorporated into an Apache 2.0 project: the combined work would have to ship under the GPL, which would relicense OpenStage.

So for any component whose code would be linked, vendored or copied, a copyleft licence is a hard stop rather than a tradeoff. Running a GPL tool
as a separate process that the user installed themselves is fine and is a different question.

AGPL deserves separate mention because it is the most aggressive variant: network interaction with the software counts as distribution, which
triggers the source obligation. Two of the most popular recorders in this space are AGPL.

## Licensing and platform review

The recorder needs native capture, audio and interaction events. Candidate applications had incompatible copyleft terms or did not fit the platform and maintenance requirements. Check the license of each library before adopting it.

## Decision

### 1. OpenStage has its own recorder: a separate Rust program, Windows first

`openstage-capture` (the `capture/` folder) records the screen, a window or a region, the microphone, the computer's own sound and a webcam, and
exports an edit as an MP4. It is written in Rust because screen capture needs native code, and it uses Windows' own services through the
`windows` crate (MIT or Apache-2.0):

- pictures: Windows Graphics Capture, the service Windows' built-in screenshot tool uses;
- video: Windows' own media encoders, H.264 and AAC in an MP4, written as one fragmented MP4 for each take so that a crash loses about a second;
- sound and webcam: Windows' own audio and camera services;
- the interaction log (cursor, clicks, the window in front, the names of clicked items, and keys only when the author asks): Windows hooks and UI
  Automation, off unless asked for, and never password text.

There is no FFmpeg in it. `capture/tools/check_rules.py` fails the build if a dependency is not on the allowed licence list, if a dependency looks
like FFmpeg, or if any script asks for a GPL or non-free FFmpeg build. All 65 of its dependencies are MIT, Apache-2.0 or similarly permissive.

The editor starts the recorder as a separate process and talks to it one line of JSON at a time (`docs/capture/capture-protocol-spec.md`; the
editor's side is `editor/src-tauri/src/stream.rs` and `editor/src/recorder.ts`). A separate process also keeps any licence question separate.

The first release is Windows only. Capture's own plan, in eight phases, is `docs/capture/roadmap.md`.

### 2. No third-party recorder's code is adopted

Copyleft application code is incompatible with the project's distribution requirements. An author may still record with any program they like separately.

### 3. Importing a recording made elsewhere is wanted, but not built

A video file, or a folder of screenshots, should be able to become a sequence of steps. This belongs to Capture's Phase 7 (steps and interactive
training), which is not started.

### 4. Third-party code and naming

Verify license compatibility for any library before reuse and retain required attribution in `NOTICE`. The editor shows this module as OpenScreen. Its folders, executable, setting and project format keep the name Capture.

### 5. Other systems later

macOS and Linux are not in the first release. When they are, the same protocol would drive a recorder built on that system's own services (the
audit's `scap` is the likely starting point); this record is then reopened.

## FFmpeg: the rules if it is ever used

Capture does not use FFmpeg. If that ever changes, FFmpeg's effective licence depends on how it is built, and this is the easiest way to
relicense the project by accident. The core is LGPL 2.1 or later; optional components and some optimisations are GPL 2 or later, and any of them
makes the whole build GPL. Then:

- Build without `--enable-gpl` and without `--enable-nonfree`.
- Do not link GPL libraries. libx264 is the common trap.
- Link dynamically. Do not statically link FFmpeg into a program.
- Distribute the FFmpeg source that matches the shipped binaries, with the configure options used and a diff of any changes, hosted beside them.
- Credit FFmpeg on download pages and in the about box, spelled correctly, and say plainly that we do not own it.
- Keep the library filenames recognisable (a prefix or suffix is fine, a rename is not), and do not forbid reverse engineering in any licence terms.
- Make the build fail if the FFmpeg configuration reports GPL. A person will not catch this reliably.

FFmpeg also warns about codec patent exposure. Look at that before wide distribution, and prefer royalty-free codecs where the quality allows.
Capture's final licence, patent and trademark checks are in its Phase 8.

## Step capture and simulation

Three things are often mixed up. Keep them apart.

| Capability | What it is | Status |
| --- | --- | --- |
| Video capture | Record pixels and sound to a file | Built in `capture/`, Windows only. The parts that touch Windows have been run on the owner's computers in pieces; see `capture/README.md` for exactly what |
| Step capture | Note each click and key, take a picture at each, name the control that was clicked | The interaction log is built and off unless asked for. Turning a log into steps is not built (Capture's Phase 7) |
| Simulation authoring | Step slides with hotspots, typing, right and wrong feedback, hints, retries, and watch, try-it and test-me modes | Mostly slides and rules. It needs a free-text input and scoring from steps, which OpenStage does not have yet (see `ROADMAP.md`) |

## Consequences

- No copyleft code enters the repository, and the rule checker holds that line for the Rust program on every change.
- No FFmpeg is shipped. Nothing about recording depends on a program the author has to install.
- The recorder works on Windows only for now, and says so on other systems.
- A new dependency of Capture needs its licence checked before it goes in, and an entry in `capture/THIRD-PARTY.md` (the checker writes it).

## Sources

- https://github.com/smasherprog/screen_capture_lite
- https://github.com/helmerapp/scap
- https://www.ffmpeg.org/legal.html
