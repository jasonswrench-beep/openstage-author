# Roadmap

Full reasoning lives in the scoping document. This is the short version.

## Phase 1 — Format and player (now)

The published course has to be right before the thing that authors it is worth building.

- [x] JSON Schema for the project format
- [x] Validator, accessibility rules first
- [x] Test fixtures: one valid project, one broken fixture per rule
- [x] Player that renders a project file to accessible HTML (slides, layers, triggers, quiz, narration with captions and transcript), and shows one column in reading order when the window is narrow or the page is zoomed in (WCAG 1.4.10 Reflow). Not yet tried on a real phone, or inside an LMS frame.
- [x] SCORM 1.2 wrapper (checked against a strict stand-in LMS; not yet in a real one)
- [ ] Tested in Moodle, Canvas and Brightspace, including resume

At the end of Phase 1 there is a working, accessible, publishable course and no editor
at all. That is the intended order.

## Phase 2 — Editor

First slice built with the Tauri shell: open and save a project, slide list, canvas, properties,
object list with reading order, live problem list, undo and redo.

- [~] Canvas: place, move, resize, rotate, z-order (select, move, resize, add and delete done for text, buttons, shapes and images). Duplicate, copy, cut and paste done, across slides. Selecting several objects (Shift or Ctrl and click, a box dragged across the canvas, Shift with Page Down, Ctrl+A, the Objects list) with moving, copying and deleting them together, and line up and space out evenly, done. Locking done (format 0.15.0): a locked object is not moved, resized, rotated or deleted by accident. Not built: grouping, snapping.
- [~] Property panel, slide sorter, layer list (all three exist, with add, delete, rename and reorder for slides, and add, delete and rename for layers)
- [x] Slide layouts (26, with previews, Change layout and Reset layout)
- [~] Linked themes (format 0.2.0, 8 built-in themes, theme colours and fonts, slide backgrounds, migration; editing a theme's own colours and fonts is not built)
- [~] Interactions (format 0.3.0: click and reveal, accordion, flip cards, tabs, step process, carousel; drag and drop, matching, hotspots, text entry and scenarios not built)
- [x] Table and scrolling text objects (format 0.5.0)
- [x] Inputs and surveys: checkbox, radio, drop-down, list, Likert, semantic differential (format 0.6.0, answers can go to the LMS)
- [~] Assets: project library, media search (Pexels, Pixabay, Unsplash, Freesound; Mixkit, SVG Repo and Libreshot as links), credits page, video, audio and YouTube/Vimeo embeds (format 0.8.0). Icons, characters, buttons and slide templates are not built.
- [ ] A general API for AI generation (pictures, voices, sound) with the author's own key, later. Not Midjourney, which has no official API.
- [ ] Object states
- [x] Rules editor (when / do / only if) and Variables dialog; jump ends the rule list; branching on survey answers
- [x] Files to download (format 0.12.0): a PDF, Word document or other file in the project's assets, offered with a required description of what it is, the kind of file and its size, a Download link that saves it (no pop-up), the author's confirmation that it is accessible, and narration written from the description. Not built: opening a file to read it in the course, reading the document aloud, and checking inside a PDF or Word file for tags and headings.
- [x] Audio for every item of an interaction (format 0.11.0): each glossary term, flip card, tab, step and accordion heading can have its own narration, read when the learner opens it, with a Listen button. The editor writes it from the item's own text in one click. Still without an audio route: text whose words depend on the learner, which is the score and the review in a results box and the name on a certificate, because a script written ahead of time cannot say them.
- [x] Results box and printable certificate (format 0.10.0): the score, passed or not, each question, and a certificate for learners who pass, who type their own name and print it or save it as a PDF.
- [x] Course setting for what completes a course: every slide seen, or the last slide reached (format 0.9.0). The editor and the validator warn when a rule can skip a slide and the course needs every slide.
- [x] Animation (format 0.14.0): an object can fade, slide or grow in when it appears and out when it goes, from a tenth of a second to two, never repeating or flashing. It does not play when a learner's device asks for reduced motion, and the player has a Turn off animation button. The editor has an Animation box and a Preview animation button. Not built: emphasis or looping effects (on purpose), slide transitions, and motion paths.
- [x] Timing (format 0.13.0): each object can appear after a delay or when its own narration starts and go again, a slide can move on by itself, and the editor has a Timing box, a keyboard-operable Timing list and warnings. Learners get Pause timing and Show everything now. The Timeline panel under the canvas draws it all along a time axis, with the narration lengths, and its bars and grips work from the keyboard and by dragging. Not built: timing that follows a video or an audio clip (see the next item).
- [ ] Timing that follows a video (requested by Jason, 2026-10-12): an object appears, or goes, at a moment in a video, so notes, questions and extra text can arrive as the video reaches them, with the same Pause timing and Show everything now controls. An audio clip would work the same way and should come with it. Open questions: a video file in the project can be followed directly, but an embedded YouTube or Vimeo video can only be followed through that site's own player code, which has to be loaded from the web; what happens to timed objects when the learner skips or rewinds the video; and what shows if the video cannot play. Needs a format change (a new way for `timing.appear` to count) and a migration.
- [x] Publish and Preview from the editor (Publish: saves, checks, makes the SCORM 1.2 package and web files, cancellable; Preview: the course as it is now in your browser, saved or not). Both still need Node.js, and Publish needs Python.
- [x] Narration panel: script, voice, speed and pronunciations in Properties, a Narration dialog that lists everything and makes the missing audio locally with Kokoro (cancellable), and a Listen button. A plugin seam for other voice models is not built.
- [ ] ATAG Part A pass on everything above, including NVDA
- [ ] Installer and first-run model download (nothing is packaged yet; the editor is built from source). The installer must not bundle GPL components such as espeak-ng or phonemizer-fork; see NOTICE.

## Phase 3 — Import and quizzing

- [ ] PowerPoint import with provenance
- [ ] Per-slide re-sync diff against a changed source deck
- [~] Quiz authoring and scoring (multiple choice and true or false are authored in the editor and score in the player; other question types are not built)
- [x] Branching (rules editor, conditions on variables and survey answers)

## Phase 4: Capture module (Windows first)

Screen recording, a mid-level video editor for recordings (trimming, splitting, text overlays and
zoom), and accessible step-by-step and software-simulation output. The recorder is a separate
program (`openstage-capture`, written in Rust) that the editor starts; the editor panels are
TypeScript. Building the recorder is on hold at the owner's request, so this phase records the plan
and what it needs from OpenStage. Its own plan is in the repository jasonswrench-beep/claude-test
(docs/roadmap.md); update this link when the Capture code moves into this repository. What it needs
from OpenStage, besides the shell work listed in that repository's docs/openstage-requests.md:

- [ ] Audio description for video in the player: an "Audio description" button beside a video that opens an accessible pop-up where the learner can read the description, listen to it, or play the video with the description voiced in time. Shown only where the author has added description. The text is the source and the audio is generated from it, like narration.
- [ ] A free-text input, so a learner can type an answer into a labelled field that is saved in a variable and a rule can check it. (Typed answers already exist as quiz questions: short answer, number and fill in the blanks. This would be an input kind for practice steps that are not questions.)
- [ ] Scoring from steps: hotspot and text-entry steps that are not quiz questions can add points to the score, the results box and SCORM, with step results stored compactly enough for SCORM 1.2's 4096-character suspend data. (Quiz questions already score, with partial credit, and a question worth 0 points is practice.)

Timing that follows a video or an audio clip is already on the list under Phase 2. Capture works
without it, but with it Capture's step text could be real, accessible objects timed to the video
instead of being drawn into the picture.

## Later

SCORM 2004 and xAPI. Whisper for imported media (the Capture module will audit it first
for speech recognition). Localisation. QTI and LTI. A CC0 character and icon library.
Reusable components. Bring-your-own-key AI assistance.

## Never

Bidirectional PowerPoint round-trip. Cloud collaboration and accounts. A built-in LMS.
Voice cloning. VR and AR. Unrestricted custom scripting.

See CLAUDE.md for why each of these is on the list.
