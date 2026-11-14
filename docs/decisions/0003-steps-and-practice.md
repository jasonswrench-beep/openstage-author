# ADR 0003: Steps, and the Demo, Practice and Assessment lessons made from them

Status: Accepted as a plan. Stage 1 (steps from the recording's log, and their review), Stage 2 (a picture for each step, with the place to point at) and Stage 3 (the Watch lesson: one slide for each step), Stage 4 (Practice), Stage 5 (the Test) and Stage 6 (bringing a lesson up to date, field by field, without losing what the author changed; course format 0.27.0) are built.
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
   **Decided (2026-10-18, Jason, on being asked which of the two to use for Practice, answered "Yes" to the recommendation):** Practice uses hotspot objects over the
   picture, as above, and Assessment uses the quiz kinds because only they score. If Jason meant otherwise, Practice is the only part that changes, and it is not built yet.
8. **Provenance on every slide made from a step** (`sourceCapture` is the recording's folder name; `stepId` the step's id), and a regenerated lesson keeps
   what the author changed, the way a .pptx re-sync does. Not built.
9. **Typed words and window titles are private.** The recorder writes keys only when it is sure the field is an ordinary text field. The typed words
   appear in a step's words for the author to check, and the dialog says so. Nothing reaches a course the author did not read and approve.

## What is built (Stage 1, 2026-10-16)

- `editor/src/steps.ts` (pure, 25 tests): reading the log, proposing steps, the operations, saving and reading `steps.json`.
- `editor/src/stepsource.ts` (8 tests): what steps come from (takes, set-aside takes left out, the edit's kept stretches, saved steps), with notes in words.
- `editor/src/stepsdialog.ts`: the review dialog, **Make steps from this recording** in the OpenScreen dialog (and for the recording just made). Every
  step is a labelled group of fields; every button names its step; changes are announced; Undo; Ctrl+S saves; closing asks if there is unsaved work.
  Tried in the real desktop editor with a made-up recording and log (20 checks).
- The shell reads `takes/take-N/events.jsonl` (up to 32 MB) and writes `steps.json` (2 new Rust tests, 90 in all).

## What is built (Stages 2 and 3, 2026-10-18)

- **Pictures.** `editor/src/steppicture.ts`: the picture of a step is taken in the window from the take's own screen video (a video element with `crossOrigin = "anonymous"`,
  moved to the step's moment, drawn on a canvas, saved as a PNG; wider than 1,920 pixels is scaled down). In the review dialog, **Show the picture** shows it, with a box round the
  place to point at. The box is an element that can be reached with Tab, moved with the arrow keys (Shift makes it wider or taller, Control makes each press five times as big) and
  dragged with the mouse; pressing elsewhere on the picture puts its middle there; four number fields (left, top, width, height in percent) do the same; **Mark a place to point at**
  and **Take the mark off** work on any step. A run of small moves is one undo step. Steps keep the picture's size and the box in `steps.json` (the box is in percent, so it does not
  depend on the picture's size).
- **Slides.** `editor/src/stepslides.ts` builds the slide for a step from ordinary objects on the stage: a heading ("Step 3 of 8"), the step's words with narration made from them (the audio
  route for step text, story D7), the picture, and a rounded frame round the place to point at (decorative, because the words already say what to do). The picture's description is the
  author's, used only for a step they ticked as checked; otherwise it is left empty and the course's own checker asks for it (tried: the real validator reports exactly that, and nothing
  else). A slide's `provenance` names the recording's folder and the step. `Model.makeStepSlides` puts the slides after the slide being edited as one undo step, selects the first,
  and skips a step that already has a slide (the same recording and step), so pressing it twice makes nothing twice. **Make a Watch lesson: one slide for each step** in the review dialog
  saves the steps, takes and saves a picture for each step that has no slide yet (a new shell command, `save_step_picture`: a real PNG, a safe name, never overwriting), then makes the slides.
  All or nothing: a picture that cannot be taken stops it with the reason.
- Tried in the real desktop editor with a made-up recording and log (26 checks), then the saved course was run through the real validator.

## What is built (Stages 4, 5 and 6, 2026-10-18)

- **Practice** (`editor/src/steplessons.ts`, `buildPracticeSlide`). For a click: the picture, a `hotspot` over the place (named by the step's words, at least 40 pixels each way), a second over the whole
  picture named "Anywhere else on the screen" (so a keyboard user has the same two choices), a **Show me** button, and an invisible frame over the place that a rule gives its look (`Shown`, which
  announces itself). Rules are written as the editor writes them (a click and a key press that do the same thing). The right place shows a layer ("That is right", with **Next step**). The other counts a
  try (`setVariable` with `add` on one number variable, `practice tries`, reset by a `slideStart` rule on every Practice slide) and shows a hint layer ("Not quite. Look for the Save button. Then try again", from the
  name of what was clicked), and on the third try outlines the place instead. For typing: a short-answer question worth no points, with what was typed as the answer (capitals count) and a right and a
  wrong layer. Feedback text is a status, so it is announced. Nothing is timed.
- **Test** (`buildTestSlide`). A click becomes a scored hotspot question (one point, one try): the place among up to four other cells of a three by three grid that the place does not touch, each with its own label
  ("Top right of the picture") for the list a keyboard uses; typing becomes a scored short answer. Feedback says only "Correct" or "That is not correct": no hints. The score is the course's quiz score; the editor
  says to add a results box after the last question.
- **A step with nothing to point at or type** (a key, a change of program, a marker, a click with no place marked, a step with no picture) is shown in both lessons as in Watch, named for the lesson, so the story of
  the procedure reads in order.
- **Each lesson is its own capture** in `provenance` (`name.capture`, `name.capture#practice`, `name.capture#test`), because two slides may not claim one step. Recorded in `docs/format-spec.md`; no schema change.
- **What was typed** can be corrected in the step's own field, apart from the words the learner reads, because it is the answer that Practice and Test accept.
- **Bringing a lesson up to date** (built in two steps on 2026-10-18; the second needed format 0.27.0, at Jason's request). Pressing the button again makes the slides that are missing, each in its own place among
  the lesson's slides (after the slide of the step before it, or before the first step that has one), and brings the others up to date. A slide made from a step records what was made in `provenance.base`: its name,
  the picture's take and moment, and for each part (its role, such as `words` or `layer-hint/message`) the object's id, layer and a fingerprint of each field. Bringing up to date makes the slide again in memory
  from the new step, with the same ids for the same parts (so rules still name the right objects), and compares each field three ways, as the .pptx re-sync does for a deck: the field as it was made (`base`), as it is
  now, and as it would be made now. A field the step does not change is left alone; one the step changes and the author did not is replaced; one both changed stays the author's and is reported; a part the author
  deleted stays deleted; a part the author added is never touched; a part the step no longer makes goes only if the author never changed it. A slide for a step that is gone is removed only if it is exactly as made
  (nothing changed, nothing added), and only after the dialog has said so and been told to go on. The editor does this in `editor/src/stepbase.ts`, called by `Model.planStepLesson` (what would change, in words,
  without changing anything) and `Model.makeStepSlides` (one undo step).
- **Why a fingerprint for each field and not for each object.** The first version recorded one fingerprint for a whole object. Then an author who had only written their own description of a picture could not have
  a new picture, because the object as a whole "had been changed". Comparing field by field lets the new picture come forward and keeps the description. For a narration only its words are compared, so choosing
  another voice, speed or language is not "changing the words". The editor's own `locked` and `group` and the ids of rules are not part of an object's design here either.
- **Slides made before 0.27.0** have no `base`, so there is nothing to compare with; they are left as they are and the dialog says which. Delete one and make the lesson again to bring its step in.
- **Pictures.** A picture is taken again only when the step's take or moment changed. Until the new one is taken and saved, a slide keeps the picture it has.
- Tried in the real desktop editor with a made-up recording (all three lessons in one course; the saved course through the real validator, which asks only for the unchecked pictures' descriptions), and, in the
  player's own runtime, what a learner can do: wrong tries, the hint, the third try, Show me, the right place and Next step by mouse and by keyboard, typing, and the Test's scoring.

## Stages still to do

1. **A real run:** a real recording's pictures, the lessons in a real LMS and with a screen reader.

Not decided yet: how many tries before the target is shown in Practice (proposed 3), whether the picture of a step should be the edit's own picture
(with its zooms) rather than the raw take's, and whether a step's marked target is a rectangle, an arrow or a choice.
