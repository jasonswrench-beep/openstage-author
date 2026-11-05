# OpenStage Author

Free, open-source desktop authoring tool for freeform WYSIWYG eLearning. Apache 2.0.

Name: the product is OpenStage Author (website openstageauthor.com). In prose "OpenStage" is the accepted short form.
The project format, the `.osproj` extension, `openstage-editor.exe`, the `OPENSTAGE_*` variables and the `os-` CSS prefix
keep the short name on purpose; do not rename them.

Read `docs/format-spec.md` before touching anything that reads or writes a project file.

## What this is

A slide-based authoring studio, built for higher
education/businesses, funded by donation rather than license. It provides a freeform canvas.

Not a template tool. Not an LMS. Not a cloud platform. Not a full or professional video editor.
The Capture module includes a mid-level editor for recordings: trimming, splitting, text overlays,
and zoom.

## Current phase

**Phase 1 (format, validator, player, SCORM 1.2 wrapper) is built and works for the user.
Still open: testing in Moodle, Canvas and Brightspace, and NVDA and VoiceOver passes.**
Phase 2, the editor, is a Tauri app (Rust shell, TypeScript web layer sharing the player's renderer)
in `editor/`. It is built well past its first slice: `ROADMAP.md` says what is done and what is left,
and `docs/editor.md` says how it works.

The Capture module (screen recording and a mid-level editor for recordings, shown to authors as
OpenScreen) was brought into this repository on 2026-10-15, under `capture/`, `capture-edit/`,
`capture-timeline/` and `docs/capture/`. It is not yet joined to the editor; `ROADMAP.md` has the order
of that work.

Anything that is not on `ROADMAP.md` is agreed with the user first.

## Non-negotiable rules

### Accessibility

- ATAG Part A applies to the editor itself, not only to published output. Every editor
  feature must be fully keyboard operable and usable with a screen reader. A feature that
  is not is not finished.
- Never introduce a keyboard trap. Every dialog, panel and editor must be closable by
  keyboard alone.
- `altText`, `role`, `tabOrder` and `decorative` are required fields on every object in
  the schema. Never make them optional and never fill them silently with empty defaults.
- Published output targets WCAG 2.2 AA.
- If it is text the learner is meant to read, audio should be available for it, so the course is
  accessible to someone who cannot read the screen. A feature that shows text in a new place (an
  interaction's items, a results box, a caption) needs a way to give that text narration, and the editor
  should make it easy to do. Say so in the summary when a new kind of text has no audio route yet.
- When a change could affect keyboard access, focus order or screen reader output, say so
  explicitly in the summary of what changed.

### The project format

- The format is the source of truth. Change `docs/format-spec.md` in the same commit as
  any code that reads or writes the format. Never let them drift.
- Narration is text. `script`, `voice`, `speed` and `lang` live on the object. Generated
  audio is a cache keyed by content hash, never content. Never store audio as the primary
  representation of narration.
- Captions and transcripts for narrated objects are derived from `script`. Never run
  speech-to-text on narration audio when a script exists.
- Imported objects carry `provenance` (`sourceDeck`, `slideIndex`, `shapeId`). Never drop
  these on edit. Re-sync against a changed source deck depends on them.
- Media are referenced assets, not embedded blobs.
- Every schema change bumps `schemaVersion` and ships a migration.

### Architecture

- The editing stage and the published player run the same renderer. Never fork them.
- Local models sit behind three plugin contracts: audio from text, captions from media,
  image from prompt. Nothing model-specific enters the format or the renderer.
- TypeScript throughout, except the Capture program, which is Rust because screen capture
  needs native code. The shell is Tauri. Cross-platform from the start, except the
  Capture module, which is Windows first.

### Licensing

This project is Apache 2.0. Apache 2.0 cannot incorporate GPL or AGPL code: the combined work would
have to ship under the GPL, relicensing the project. Treat a copyleft licence as a hard stop for
anything linked, vendored or copied, not a tradeoff to weigh. Running a GPL tool that the user
installed, as a separate process, is fine and is a different question.

Before adding any dependency, check its licence. Permissive (MIT, BSD, Apache 2.0, ISC) is fine.
LGPL is dynamic-linking only. GPL and AGPL are refused. Open model weights are not automatically
open source, so audit those one by one too. Record anything adopted in `NOTICE` with its
attribution. The Capture program's rule checker (`capture/tools/check_rules.py`) enforces this for
its Rust dependencies on every change.

**FFmpeg is not used.** If it ever is, it must be an LGPL build: no `--enable-gpl`, no
`--enable-nonfree`, no GPL libraries such as libx264, linked dynamically, with the matching source
and configure options shipped. The full list is in `docs/decisions/0001-screen-capture.md`.

### Screen capture

Screen recording is OpenStage's own Rust program, `openstage-capture`, built on Windows' own capture
and encoding services (shown to authors as OpenScreen). Do not adopt a third-party recorder's code:
Copyleft recorder code is excluded. Authors may record with any program of their own, as a
separate program. The reasoning, the audit and the platform notes are in
`docs/decisions/0001-screen-capture.md`, and Capture's own documents are in `docs/capture/`. Read
them before any work on capture, recording or simulation.

## Out of scope — do not build these

Expand this list when an authoring need justifies the change.

- Bidirectional PowerPoint or Google Slides round-trip. Import is one-directional with
  provenance and re-sync. The reasoning is in `docs/format-spec.md`.
- Cloud collaboration, user accounts, hosting, SSO. There is no server.
- A built-in LMS.
- Voice cloning. Fixed voice sets only.
- VR, AR, avatar systems, gamification economies (points shops, badges, coins, levelling, leaderboards, or anything kept beyond one
  activity). A score within one game is not an economy: ready-made games are allowed, built from the editor's own parts (`docs/game-templates.md`).
- Unrestricted custom scripting in courses.

## Acceptance tests that gate a release

- SCORM package launches in Moodle, Canvas and Brightspace without error
- Passing and failing attempts both report the correct score
- Course completion and assessment success are both reported as correctly as SCORM 1.2 can express them, and are fully separate in SCORM 2004 (later)
- A learner who leaves mid-course returns to their exact position with state intact
- The entire published course and the entire editor are operable by keyboard alone
- Both are usable with NVDA and VoiceOver
- Generated captions match the narration script exactly and are correctly timed
- A project saved, closed, reopened and republished is byte-identical

SCORM suspend and bookmark state is where implementations quietly break. Treat the resume
test as load-bearing, not a nicety.

## Working style

- Explain what changed in plain language. Don't assume familiarity with JavaScript
  tooling conventions.
- Anything that needs running should be delivered as a double-clickable script, not as a
  terminal command to copy.
- Avoid em dashes in prose written for this project.
- When a decision could reasonably go either way, say so and ask rather than picking
  silently.
