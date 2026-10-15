# OpenStage Author

Free, open-source desktop authoring tool for freeform WYSIWYG eLearning. Apache 2.0.

Name: the product is OpenStage Author (website openstageauthor.com). In prose "OpenStage" is the accepted short form.
The project format, the `.osproj` extension, `openstage-editor.exe`, the `OPENSTAGE_*` variables and the `os-` CSS prefix
keep the short name on purpose; do not rename them.

Read `docs/format-spec.md` before touching anything that reads or writes a project file.

## What this is

A slide-based authoring studio in the the eLearning authoring platform and an eLearning authoring platform lane, built for higher
education/businesses, funded by donation rather than license. Every other free authoring tool
(an interactive content framework, Adapt, an open authoring toolkit, eXeLearning) is template-driven. This one is a freeform canvas.

Not a template tool. Not an LMS. Not a cloud platform. Not a full or professional video editor.
The Capture module includes a mid-level editor for recordings: trimming, splitting, text overlays,
and zoom, in the manner of a screen recording studio.

## Current phase

**Phase 1 (format, validator, player, SCORM 1.2 wrapper) is built and works for the user.
Still open: testing in Moodle, Canvas and Brightspace, and NVDA and VoiceOver passes.**
Phase 2, the editor, has started.

The user confirmed on 2026-10-10 that the editor can begin, as a Tauri app (Rust shell, TypeScript
web layer sharing the player's renderer). The first slice is in `editor/`. Anything beyond it,
such as placing objects, triggers or the timeline, is agreed with the user first.

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
  needs native code. Electron or Tauri shell. Cross-platform from the start, except the
  Capture module, which is Windows first.

## Out of scope — do not build these

Adding to this list needs a better reason than "a competitor has it."

- Bidirectional PowerPoint or Google Slides round-trip. Import is one-directional with
  provenance and re-sync. The reasoning is in `docs/format-spec.md`.
- Cloud collaboration, user accounts, hosting, SSO. There is no server.
- A built-in LMS.
- Voice cloning. Fixed voice sets only.
- VR, AR, avatar systems, gamification economies.
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
