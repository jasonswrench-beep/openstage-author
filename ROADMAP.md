# Roadmap

Full reasoning lives in the scoping document. This is the short version.

## What is left (updated 2026-10-13)

This is the list of everything not done yet. The sections after it are the record of what is built, with the detail.

### Waiting on you

- [ ] **Commit and push the question types, snapping and grouping work.** It is built and tested, and not committed.
- [ ] **Before the repository goes public.** The three `.bat` files name `D:\Claude Audio Test\.venv`; `LMS-TEST-PLAN.md` is written to you personally; `NOTICE` needs a last check, including the note about the GPL speech parts (phonemizer and espeak-ng) in the voice setup; the domain openstageauthor.com is not registered.
- [ ] **Two small questions still open.** A readout of what was sent to the LMS (or a test student account), and a line in the docs saying WCAG 2.1 AA is the legal floor for SUNY and 2.2 AA is what OpenStage aims for.
- [ ] **The screen recorder build is on hold at your request.** The three rule exceptions in `CLAUDE.md`, the Capture phase in this roadmap and the note about the speech engine's GPL parts are recorded. Still to write when you raise it: the decision record (`docs/decisions/0001-screen-capture.md`, which assumed Electron and needs correcting for Tauri) and the licensing rules in `CLAUDE.md`. The other Capture requests (OS-4 to OS-17 in their document) wait for your go-ahead, one at a time.

### Held until everything is ready

- [ ] **The real LMS test** (your decision, 2026-10-13: save it, and run one proper test when everything is ready). The lesson has been uploaded to Brightspace and its quiz shows in the gradebook, but no one has confirmed what a learner's run records (score, status, resume), and Moodle and Canvas have not been tried. The test plans are ready: tests 1 to 13 in `examples/lms-test-lesson.osproj/LMS-TEST-PLAN.md`, and `examples/question-types.osproj/TEST-PLAN.md`, with an empty results sheet to fill in (`examples/lms-test-lesson.osproj/LMS-RESULTS.md`). The packages in `dist` were rebuilt with the latest player on 2026-10-13. One question needs your decision first: the release gate says completion and success are separate states, which SCORM 1.2 cannot do (see the end of the results sheet).

### Next, in the order you set

Nothing is left on the list you set (scenarios, assets, timing that follows a video). What remains is held or bigger, below.

Done since the last list: timing that follows a video or an audio clip (format 0.23.0), icons, button looks and ready-made Next, Back and Replay buttons, an avatar maker for the cast, and six ready-made lesson slides (format 0.22.0), grouping (format 0.17.0), snapping while dragging, slides and layers (duplicate a slide, duplicate and reorder layers), themes (edit a theme's own colours and fonts, and a logo on every slide, format 0.20.0), and scenarios with a shared cast and a choice of character (format 0.21.0).

### Bigger items, not started

- [x] **Object states** in the editor (your request, 2026-10-13; format 0.24.0). The editor calls them looks. Text, buttons, icons, shapes and pictures have a Looks box: the ready-made Hover or focus, Visited and Disabled, and looks you name. Each is edited with the Appearance fields (plus how solid it is), shown on the canvas as you edit, and checked for contrast with the look counted (see-through looks, and looks stacked together). A rule can **Change an object's look**. A look can have a spoken message, which the player says when a rule applies it; the editor and the validator say plainly when a rule applies a look with none. Looks start over each time a slide opens. Not built: a look that swaps a button's words or a picture (the player does not do this yet), and looks remembered in the learner's saved place.
- [ ] **ATAG Part A pass** on the whole editor, including NVDA, and VoiceOver. A pass **without a screen reader** was done 2026-10-13 (`docs/accessibility-audit.md`): the editor now reflows down to 320 pixels, every list is one Tab stop, button names start with their visible words, targets are at least 24 pixels, long dialogs no longer hide the focus, and choosing a slide or object is announced. **Still not done: a pass with NVDA and VoiceOver.** No screen reader pass has been done on the editor or the player. A test script for the first round (NVDA and Narrator on Windows) is written in `docs/screen-reader-pass.md`, with empty result lines. It needs someone who uses a screen reader to run it.
- [ ] **Installer and first-run model download.** Nothing is packaged; the editor is built from source. The GPL speech parts have to be settled first.
- [x] **PowerPoint import** with provenance, and the per-slide re-sync against a changed deck (your request, 2026-10-13; format 0.25.0). The editor reads `.pptx` files itself (a small XML reader and the zip reader the publisher already had, no new library): slides, titles, bulleted and numbered lists, bold, italic and links, shapes, lines, pictures with their alt text, tables, backgrounds (a picture behind the text becomes a decorative picture and the slide gets its average colour, so contrast can be checked), reading order, the stage laid out to the deck's shape. Anything it cannot bring in is named in a report (charts, SmartArt, movies, animations, speaker notes). Re-sync compares the deck as it was imported, as the author has since changed it, and as it is now, one property at a time, so the deck's changes come forward and the author's work stays; conflicts are offered unticked. Read and converted without trouble on 15 real course decks (a test does this when `OPENSTAGE_REAL_DECKS` names a folder of them), and three imported whole into a project and run through the validator. Not built: speaker notes as narration, animations, charts and SmartArt, cropped pictures, a slide order that follows the deck, and a link from a shape to a slide.
- [x] **AI generation API** (pictures, voices, sound) with the author's own key, and a plugin seam for other voice models (your request, 2026-10-14; format 0.26.0). A voice names its engine (`openai:alloy`, `my-plugin:narrator`; a bare name is Kokoro, so nothing existing changed). **AI services** on the toolbar takes the author's keys for **OpenAI** (voices, pictures) and **ElevenLabs** (voices, sound effects), asks once per service before anything is sent, and lists voice **plugins**, folders each with a `plugin.json` and a small program that talks one line of JSON at a time (`docs/plugins.md`; an example is in `examples/plugins`). Only ready-made voices are ever offered, never a cloned one. **Assets > Make with AI** saves a made picture or sound in the project with a credit that says an AI service made it and the words that made it (`generated` in `assets.json`); the credits page also lists the narration's synthetic voices, and the checker warns if the page is off. Publishing and previewing never send anything. The key goes in an environment variable, never in a project, a command line or an error message. Built from the services' documentation (2026-10-14) and tested with stand-ins: **not yet tried with a live key.** Not built: other services, picture and sound plugins (the contract is voices only), hearing a sample before choosing a voice, showing what a service charged. See `docs/ai-generation.md`.

### Gaps in what is built

- **Questions.** Not built: question banks, shuffled choices, timed questions (a time limit must let a learner extend or switch it off, WCAG 2.2.1), an essay question (SCORM 1.2 cannot score it), drag and drop onto places on a picture. Not tried: dragging on a touch screen, a screen reader on any question.
- **Accessibility.** Two things have no audio route because their words depend on the learner: the score and review in a results box, and the name on a certificate. The pass mark is fixed at 80 percent; making it a setting needs a format change.
- **Not yet checked.** The editor features from this week (copy and paste, selecting several, lining up, locking, every question kind) were checked in the editor in a browser and by tests, not in the desktop app window. The one-column layout has not been seen on a real phone or in Brightspace's frame. The lesson zip in `dist` still has the player from before the question types, which works the same for its quiz.
- **Editor.** Narration that is not tied to an object; editing formatted text beyond one paragraph or heading; the project's `modified` date is not updated on save; there is no narrow-screen preview (preview in a browser and narrow it); Change layout and Reset layout can still rearrange a locked object, by design.
- **Format.** The `hotspot` object type is still undefined (hotspot questions are a quiz kind). Open questions before 1.0: how much a theme may override, reusable components (linked or copied), and the zipped form of a project.
- **Documents.** Reading a downloaded file in the course, reading it aloud, and checking inside a PDF or Word file for tags and headings are not built.


## Phase 1 — Format and player (built; waiting on real LMS tests)

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

- [~] Canvas: place, move, resize, rotate, z-order (select, move, resize, add and delete done for text, buttons, shapes and images). Duplicate, copy, cut and paste done, across slides. Selecting several objects (Shift or Ctrl and click, a box dragged across the canvas, Shift with Page Down, Ctrl+A, the Objects list) with moving, copying and deleting them together, and line up and space out evenly, done. Locking done (format 0.15.0): a locked object is not moved, resized, rotated or deleted by accident. Snapping done: dragging and resizing jump to the slide's edges and middle and to other objects, with guide lines, a Snap switch and Alt to drag freely. Grouping done (format 0.17.0): a group is chosen, moved, resized as one (scaling its objects), copied and deleted together, lined up and spaced out as one object, and timed once; it is for editing only and the course is unchanged.
- [x] Property panel, slide sorter, layer list (all three exist, with add, duplicate, delete, rename and reorder for slides, and add, duplicate, delete, rename and reorder for layers)
- [x] Slide layouts (26, with previews, Change layout and Reset layout)
- [x] Linked themes (format 0.2.0, 8 built-in themes, theme colours and fonts, slide backgrounds, migration). Editing a theme's own colours and fonts, with a readability check, and a logo on every slide are done (format 0.20.0). Not built: a background picture, and keeping a theme to use in other projects.
- [x] Interactions (format 0.3.0: click and reveal, accordion, flip cards, tabs, step process, carousel; drag and drop, matching, hotspots and text entry are quiz questions now, and a question worth 0 points is practice). Branching scenarios, a cast shared by the whole project and a choice of character are done (format 0.21.0).
- [x] Table and scrolling text objects (format 0.5.0)
- [x] Inputs and surveys: checkbox, radio, drop-down, list, Likert, semantic differential (format 0.6.0, answers can go to the LMS)
- [x] Assets: project library, media search (Pexels, Pixabay, Unsplash, Freesound; Mixkit, SVG Repo and Libreshot as links), credits page, video, audio and YouTube/Vimeo embeds (format 0.8.0). Icons (1,879 from Lucide, ISC licence), button looks and ready-made navigation buttons, an avatar maker for the cast and six ready-made lesson slides are done (format 0.22.0). Not built: illustrated characters with poses (needs an outside set whose licence has been checked), saving your own slide as a template, and a library that is kept across projects.
- [x] A general API for AI generation (pictures, voices, sound) with the author's own key (format 0.26.0). Not Midjourney, which has no official API.
- [x] Object states (format 0.24.0)
- [x] Rules editor (when / do / only if) and Variables dialog; jump ends the rule list; branching on survey answers
- [x] Files to download (format 0.12.0): a PDF, Word document or other file in the project's assets, offered with a required description of what it is, the kind of file and its size, a Download link that saves it (no pop-up), the author's confirmation that it is accessible, and narration written from the description. Not built: opening a file to read it in the course, reading the document aloud, and checking inside a PDF or Word file for tags and headings.
- [x] Audio for every item of an interaction (format 0.11.0): each glossary term, flip card, tab, step and accordion heading can have its own narration, read when the learner opens it, with a Listen button. The editor writes it from the item's own text in one click. Still without an audio route: text whose words depend on the learner, which is the score and the review in a results box and the name on a certificate, because a script written ahead of time cannot say them.
- [x] Results box and printable certificate (format 0.10.0): the score, passed or not, each question, and a certificate for learners who pass, who type their own name and print it or save it as a PDF.
- [x] Course setting for what completes a course: every slide seen, or the last slide reached (format 0.9.0). The editor and the validator warn when a rule can skip a slide and the course needs every slide.
- [x] Animation (format 0.14.0): an object can fade, slide or grow in when it appears and out when it goes, from a tenth of a second to two, never repeating or flashing. It does not play when a learner's device asks for reduced motion, and the player has a Turn off animation button. The editor has an Animation box and a Preview animation button. Not built: emphasis or looping effects (on purpose), slide transitions, and motion paths.
- [x] Timing (format 0.13.0): each object can appear after a delay or when its own narration starts and go again, a slide can move on by itself, and the editor has a Timing box, a keyboard-operable Timing list and warnings. Learners get Pause timing and Show everything now. The Timeline panel under the canvas draws it all along a time axis, with the narration lengths, and its bars and grips work from the keyboard and by dragging. Timing that follows a video or an audio clip is done (format 0.23.0, see the item below).
- [x] Timing that follows a video or an audio clip (requested by Jason, 2026-10-12; format 0.23.0): an object appears, or goes, at moments in a video or audio file on its slide, so notes, questions and extra text arrive as the clip reaches them. What shows depends only on where the clip is, so skipping ahead or going back is safe; a clip that cannot play shows everything that follows it; Pause timing pauses the clip too; Show everything now shows it all. The editor has the choice in the Timing box and the Timing list, a Choose by playing dialog, and an axis of its own in the Timeline panel. Not built: following a YouTube or Vimeo video, which only reports its time to scripts loaded from its own site.
- [x] Publish and Preview from the editor (Publish: saves, checks, makes the SCORM 1.2 package and web files, cancellable; Preview: the course as it is now in your browser, saved or not). Both still need Node.js, and Publish needs Python.
- [x] Narration panel: script, voice, speed and pronunciations in Properties, a Narration dialog that lists everything and makes the missing audio locally with Kokoro (cancellable), and a Listen button. Other voice models plug in as voice plugins (format 0.26.0, `docs/plugins.md`).
- [ ] ATAG Part A pass on everything above, including NVDA
- [ ] Installer and first-run model download (nothing is packaged yet; the editor is built from source). The installer must not bundle GPL components such as espeak-ng or phonemizer-fork; see NOTICE.

## Phase 3 — Import and quizzing

- [x] PowerPoint import with provenance (format 0.25.0)
- [x] Per-slide re-sync diff against a changed source deck (format 0.25.0)
- [x] Quiz questions (format 0.16.0): multiple choice, true or false, multiple response, short answer, number, fill in the blanks (typed, from drop-downs, or dragging words), matching, drag and drop, sequencing and hotspot, each with a keyboard and screen reader route, partial credit (the best attempt counts), the right SCORM interaction type for each, and narration written from the question. Not built: question banks, shuffling the order of choices, timed questions, an essay question (SCORM 1.2 cannot score it), drag and drop onto positions on a picture.
- [x] Branching (rules editor, conditions on variables and survey answers)

## Phase 4: Capture module (Windows first)

Screen recording, a mid-level video editor for recordings (trimming, splitting, text overlays and
zoom), and accessible step-by-step and software-simulation output. The recorder is a separate
program (`openstage-capture`, written in Rust) that the editor starts; the editor panels are
TypeScript. Building the recorder is on hold at the owner's request, so this phase records the plan
and what it needs from OpenStage. Its own plan is in the repository jasonswrench-beep/claude-test
(docs/roadmap.md); update this link when the Capture code moves into this repository. What it needs
from OpenStage, besides the shell work listed in that repository's docs/openstage-requests.md:

- [x] Audio description for video in the player (format 0.19.0): an "Audio description" button beside a video that opens an accessible pop-up where the learner can read the description, listen to it, or play the video with the description voiced in time. Shown only where the author has added description. The text is the source and the audio is generated from it, like narration.
- [ ] A free-text input, so a learner can type an answer into a labelled field that is saved in a variable and a rule can check it. (Typed answers already exist as quiz questions: short answer, number and fill in the blanks. This would be an input kind for practice steps that are not questions.)
- [ ] Scoring from steps: hotspot and text-entry steps that are not quiz questions can add points to the score, the results box and SCORM, with step results stored compactly enough for SCORM 1.2's 4096-character suspend data. (Quiz questions already score, with partial credit, and a question worth 0 points is practice.)

Done so far, as format 0.18.0 (no shell or player features needed a decision): a rule that adds to a number variable, so tries can be counted (OS-12); the
hotspot object, defined with a name, a keyboard route and a minimum size (OS-13); provenance that names a capture step, on slides and objects (OS-14); and a
`sourceExclude` list in `project.json` with a warning for raw recording material in the project (OS-15). The editor's shell also now has what the
recorder needs (see "Behind the editor" in docs/editor.md): a way to start the recorder and talk to it while it runs, with a polite stop and heavy jobs
waiting (OS-4); keys that work in other programs (OS-5); playing a very large video from the project (OS-6); and the `OPENSTAGE_CAPTURE` setting (OS-7). The
recorder panels, and the recorder itself, are not built.

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
