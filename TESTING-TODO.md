# Testing to do by hand

Things that only a person can check, kept as work goes on. Everything else is tested by the suites and by trying the real tools here. Tick a line when you have done it, and write what you saw under it if it was not right.

## MP4 video of a course (2026-10-31)

- [ ] Watch a real video with the sound on. Publish `examples/lms-test-lesson.osproj` with **Also make a video (MP4)** ticked (or `node player/publish.ts examples/lms-test-lesson.osproj "C:\Temp\lms" --targets=mp4`) and play `lms.mp4` in an ordinary player (Media Player, VLC, Edge). Check that the voice fits the picture (the slide changes when its words change), that nothing is cut off at the start or end of a slide, and whether the pace of the slides is comfortable. The video has been checked as pictures, and by reading its length, size and sound track back, but nobody has listened to it.
- [ ] Put `lms.vtt` beside the video, with the same name, and turn captions on in the player. They should be the narration's sentences, in time with the voice.
- [ ] Try it in the desktop app: Publish with the box ticked, watch the status line, and press Cancel part way through. Then check Task Manager: no extra Microsoft Edge should be left running. Publish again and let it finish. (A cancel leaves a folder of pictures in `%TEMP%` called `openstage-video-work-...`; it is safe to delete.)
- [ ] Look at the video of a course with real effects (`examples/looks.osproj`, or a PowerPoint import with fades and wipes). The motion is pictures a tenth of a second apart, so say whether it looks smooth enough or flickers, and whether the half second cross-fade between slides looks right.
- [ ] The video of `lms-test-lesson` is 33 MB for 4 minutes 44 seconds of mostly still slides (about 0.9 megabits a second), larger than such slides need. Say whether the size matters for how you share it; a choice of quality could be added.
- [ ] If Chrome is installed, set `OPENSTAGE_BROWSER` to its `chrome.exe` and make a video with that.
- [ ] With NVDA or Narrator on the Publish dialog: the new box should be read with its label and its note, and the sentences after a publish (the video's name, what it cannot do, the slides with words nobody reads aloud) should be read once from the status line.
- [ ] A long course (100 slides or more): how long it takes, and whether the status lines keep moving.

## Word review document (2026-10-31)

- [ ] Open a review document in Word. A sample made from `examples/question-types.osproj` is at `D:\Claude Audio Test\authoring-research\samples\question-types-review.docx`; a real publish writes `<name>-review.docx` beside the packages. It should open without a repair message. If Word says it found unreadable content, say so: that is the one thing the structure checks cannot rule out.
- [ ] In Word, open the Navigation pane (View, Navigation Pane). It should list "How to read this document", "Problems the checker found", "Slides", and under Slides one heading for each slide.
- [ ] Read the first page with NVDA or Narrator. It should read the title, the "How to read this document" paragraphs, and the problems table as a table with a header row (Kind, Where, Problem, Detail).
- [ ] Check a quiz question: each choice is on its own line and the right one ends with "(correct answer)".

## Translation files and the Translate dialog (2026-10-31)

- [ ] Open a translation file in a real tool. Make one with the Translate dialog (or `python tools/xliff.py export examples/minimal.osproj minimal-fr.xlf --to fr-FR`) and open it in OmegaT (free) or Weblate. Check that each paragraph is one segment, that bold and links show as tags you can move, and that the notes say where each piece of text is.
- [ ] Translate a few segments by hand (move a tag, keep a `{1}`), save, and bring the file back with **Bring in a translated file...**. Check that the new course opens and that your words are where they should be.
- [ ] In the desktop app, try the Translate dialog end to end: the language list, the two native file dialogs (the save one should offer `.xlf`, the open one `.xlf` and `.xliff`), Escape, and that focus returns to the Translate button. The dialog was tried in a web browser against the real tool, but not in the app, where the file dialogs are native.
- [ ] With NVDA or Narrator, move through the Translate dialog: the language field should be read with its label and its help line, the list of languages should be announced as suggestions, the checkbox as a checkbox, and the result sentences should be read once from the status line.
- [ ] Look at a pseudo-translated course (the box in the dialog, then Bring in) in the player. Text that is cut off, overflows its box or wraps badly is where a real, longer translation will do the same. (Every page of twelve examples was scanned by a program for English that did not change, but nobody has looked at the layout.)
- [ ] Hear a translated course read by a screen reader that speaks the language (NVDA with a French voice, say). The player's phrases such as "Slide 2 of 9" should be in the language, and the page's language should be set so the right voice is chosen.
- [ ] Choose a voice for the translated narration: the scripts are marked as the new language, but the voice is still the English one until the author chooses another.

## Earlier, not yet checked by a person

- [ ] A real LMS test of the SCORM 1.2, SCORM 2004 and xAPI packages (a SCORM Cloud trial is the quickest route; `examples/lms-test-lesson.osproj` is made for it).
- [ ] NVDA or VoiceOver on the sliders and dials, the enlarge button and its dialog, the labeled graphic (markers as tabs) and the guided Previous and Next step buttons with their "Step 2 of 5" line.
