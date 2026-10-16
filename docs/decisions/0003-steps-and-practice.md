# ADR 0003: Steps, and the Demo, Practice and Assessment lessons made from them

Status: Accepted as a plan. Stage 1 (steps from the recording's log, and their review) is built. Pictures, slides and the three modes are not.
Date: 2026-10-16
Applies to: Capture's Phase 7 (stories E1 to E4), and what it unlocks: audio for step text (D7) and the provenance of generated slides.

## What changed since the requirements were written

The requirements (`docs/capture/prd.md`, Epic E; `docs/capture/openstage-requests.md`, OS-10 to OS-14) assumed OpenStage lacked five things. Checked
against `docs/format-spec.md` and the player on 2026-10-16, most of them exist:

| Request | Status |
| --- | --- |
| OS-12 counting attempts | Done. `setVariable` has `operation: "add"` (format 0.18.0). |
| OS-13 define the `hotspot` object | Done (0.18.0). A transparent, focusable button over a picture, named by its alt text, at least 24 by 24 stage pixels. |
| OS-14 capture provenance on generated slides | Done (0.18.0). A slide or an object may carry `provenance: { sourceCapture, stepId, capturedAt? }`; the validator checks two slides do not claim one step. |
| OS-10 a text-entry input | Covered, in another shape. The quiz kinds `shortAnswer` and `numeric` (0.16.0) take typed answers and score them. There is no free `input` text kind. |
| OS-11 scoring from steps | Covered, in another shape. The quiz kind `hotspot` (0.16.0) scores a chosen area of a picture, all or nothing, with attempts and feedback layers. Only `quizQuestion` objects add to the score. |

So Phase 7 needs **no new course format** to start. The one place a new format field may be wanted later is "suggested, not yet approved" alt text
(D6), which is a separate question.

## Decisions

1. **Steps belong to the recording, not the course.** They are kept as `steps.json` inside `<course>/captures/<name>.capture/`, beside `edit.json`.
   They are made from what the author did while recording (clicks, the name of what was clicked, keys, program changes, the author's own markers),
   which is private and stays out of the published course (the recordings folder is left out by the editor). The shell may write only `edit.json` and
   `steps.json` there, and read a take's `events.jsonl`. A step has an id (`step-4`) that is never reused, so a slide can say which step it came from.
2. **The words and the picture description are proposed, and are the author's only when checked.** A step's words are pre-filled from the log
   ("Click the Save button.") and its picture description too. Each step has `reviewed`, set only by the author. Slides made from steps will use a
   step's picture description only when it is reviewed; otherwise the picture's alt text is left empty and the Problems panel asks for it. This keeps the
   rule that alt text is never silently filled in, while still saving the author the typing.
3. **Merge, split, delete, move and edit are plain operations on a list** (`editor/src/steps.ts`), each undoable, and each announced in words. A merged
   step remembers what it was made from so a merge can be undone; splitting a step that was not merged makes a second, empty step at the same moment.
4. **A step is one of:** a click (double-click and right-click told as such), a stretch of typing, a key such as Enter or Ctrl+S, a change of program,
   the author's marker, or one added by hand. A recording with no log still works: the author adds steps by hand, and the dialog says how to get a log
   next time (OpenScreen noting the mouse, and optionally the keys). Only what the edit keeps makes a step, so anything cut out makes none.
5. **Pictures are grabbed in the editor's window** from the take's own video, with a video element and a canvas, and saved as PNG into the course.
   Tried on 2026-10-16: the web view refuses to export a canvas drawn from the asset address unless the video element has
   `crossOrigin = "anonymous"`, and with it the export works (a 640 by 360 test frame gave a 91 KB PNG). Tried only on a synthetic recording; a real
   recorder file (a fragmented MP4) has not been tried. The picture is taken just before a click (250 ms), so the thing to click is still there. The
   take's own video has none of the edit's zooms or overlays. If this proves unreliable on real recordings, the fallback is a `frames` command in the
   recorder (Windows' own image encoder, no new dependency).
6. **A target is a place in the picture**, kept as pixels and turned into percent of the picture once its size is known. The log has the click's
   point and the name of what was clicked, not that thing's outline, so a target starts as a box of a sensible size centred on the click, and is an
   ordinary object on an ordinary slide that the author can move and resize.
7. **Three lessons from one set of steps**, all ordinary OpenStage slides using one renderer (the plan, unbuilt):
   - **Demo (watch):** one slide per step: the picture, a marked target, the step's words, and narration made from those words (the audio route for text
     the learner reads, story D7), so the learner steps with Next and Back. No new objects.
   - **Practice (try it):** the picture with a `hotspot` over the target, so a learner clicks it with the mouse, or tabs to it and presses Enter. A click
     elsewhere, or on a second hotspot named "Anywhere else on the screen" (so a keyboard user has the same choice), shows a hint layer and adds one to an
     attempts variable; after a set number of tries the target is shown. A typing step uses a `shortAnswer` question with points 0 (practice).
   - **Assessment (test me):** the same steps as scored `quizQuestion`s: kind `hotspot` for a click (the target area plus the targets of the other steps
     as the other areas), `shortAnswer` for typing, points 1, one attempt, no hints. Completion and success stay separate states as the format already does.
   The Practice design is a recommendation, and **the choice between hotspot objects and the quiz hotspot question for Practice is Jason's** (hotspot
   objects feel like the real program; the quiz kind is scored by existing machinery). Assessment uses the quiz kinds because only they score.
8. **Provenance on every slide made from a step** (`sourceCapture` is the recording's folder name; `stepId` the step's id), and a regenerated lesson keeps
   what the author changed, the way a PowerPoint re-sync does. Not built.
9. **Typed words and window titles are private.** The recorder writes keys only when it is sure the field is an ordinary text field. The typed words
   appear in a step's words for the author to check, and the dialog says so. Nothing reaches a course the author did not read and approve.

## What is built (Stage 1, 2026-10-16)

- `editor/src/steps.ts` (pure, 25 tests): reading the log, proposing steps, the operations, saving and reading `steps.json`.
- `editor/src/stepsource.ts` (8 tests): what steps come from (takes, set-aside takes left out, the edit's kept stretches, saved steps), with notes in words.
- `editor/src/stepsdialog.ts`: the review dialog, **Make steps from this recording** in the OpenScreen dialog (and for the recording just made). Every
  step is a labelled group of fields; every button names its step; changes are announced; Undo; Ctrl+S saves; closing asks if there is unsaved work.
  Tried in the real desktop editor with a made-up recording and log (20 checks).
- The shell reads `takes/take-N/events.jsonl` (up to 32 MB) and writes `steps.json` (2 new Rust tests, 90 in all).

## Stages still to do

1. **Pictures (Stage 2).** A picture beside each step in the dialog (grabbed as in decision 5), and the target drawn on it and movable by keyboard and mouse.
2. **Demo slides (Stage 3).** Generate the slides: image saved in `assets/images` through a new shell command (PNG checked by its first bytes, a name made
   from the recording and step), a marked target, text, narration scripts, alt text only from reviewed steps, provenance, position chosen by the author.
3. **Practice (Stage 4)** and 4. **Assessment (Stage 5)**, as in decision 7.
5. **Bringing the lesson up to date** when steps change, keeping the author's edits.

Not decided yet: how many tries before the target is shown in Practice (proposed 3), whether the picture of a step should be the edit's own picture
(with its zooms) rather than the raw take's, and whether a step's marked target is a rectangle, an arrow or a choice.
