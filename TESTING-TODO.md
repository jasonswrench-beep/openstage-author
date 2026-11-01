# Testing to do by hand

Things that only a person can check, kept as work goes on. Everything else is tested by the suites and by trying the real tools here. Tick a line when you have done it, and write what you saw under it if it was not right.

## Captions timed by the quiet gaps in the voice (2026-11-01)

Built and covered by 13 tests with sound made in the test (tones and silences). Never tried on a recording of a real voice, which is the whole point of it.

- [ ] **Try it on a real recording.** Open the captions dialog for a video or audio clip of someone reading a script, make captions from the script, then press **Set the times of my captions by the quiet gaps in the voice**. It needs no model. Play the clip with the captions: does each caption start where its sentence does? The dialog says how many starts are at a pause; where a sentence runs into the next with no pause, the time is a guess, so check those first.
- [ ] **A noisy recording** (a fan, a room): the gate sits 8 decibels over the quiet of the recording, so steady noise should not count as speech, but a recording with a lot of changing noise might. Tell me if pauses are missed or invented.
- [ ] **The marks.** After it runs the captions should be marked as estimates (the Checked button), and a saved .vtt file should say so.

## Order challenge, a fourth game (2026-11-01)

Built and covered by 6 tests, including the real validator and a play-through to a pass and a fail. Not looked at on a screen.

- [ ] **Add one.** Add slide > Games, ready-made > Order challenge. Look at an opening slide, a round and the results in the editor and in Preview. Check the four steps fit and the feedback and **Next round** sit below the question, without overlapping.
- [ ] **Play it** in Preview: put a round in the wrong order, then the right order in the next. The feedback says where the right order is; the score at the top of the next round should be the points so far.
- [ ] **Write your own steps** in a round (2 to 8 steps). With more than four, the question's box may need making taller.
- [ ] **With a keyboard and a screen reader:** the Move up and Move down buttons of a sequencing question are the same as everywhere else; check the round reads in a sensible order.

## Text field, a new kind of input (2026-11-01, format 0.48.0)

Built and checked: the player's code in a real headless browser (6 checks: label, hint, text area, when it is told, 250 characters, coming back), the real validator (5 tests), the migration, the editor's model and tests, and the whole suites. Not tried: in the editor itself, with a screen reader, or in a real LMS.

- [ ] **Add one.** In the editor choose Add > Question, input or survey > Text field. It should appear with a prompt, a variable of its own, and Properties for the saved words, the lines, the most characters and a hint. Change each and press Undo. A number outside the limits should be refused in words.
- [ ] **Preview it.** Type in the box. Show the words in a text on the slide (the value of the variable), and make a rule that reacts to it. Leave the slide and come back: your words should be there.
- [ ] **With a screen reader** (NVDA, Narrator): it should say the prompt, then "edit", then the hint. A box of several lines should say it is a multi-line edit.
- [ ] **In an LMS**: turn on Send the answers to the LMS, type a short answer, and look in the LMS report for a fill-in; a long answer is cut at 250 characters.
- Not built: scoring from steps (the other half of this roadmap item), a text field inside a scored question, and an example course using the new field.

## Sound, picture and pointer buttons in this program's recording editor (2026-11-01)

Type-checked and covered by unit tests of the options and the words (4 new tests, the editor's whole suite passes), but the dialog itself has no browser check: nobody has seen these buttons on a screen, so everything below is untried.

- [ ] **Open a recording for editing** (Record > the recording > Edit). Check there are now three buttons beside Save the edit: **Make a video from this edit**, **Make a sound file (WAV) from this edit**, **Save the picture shown in the preview (PNG)**, and a box about the mouse pointer under the motion box.
- [ ] **Make a sound file.** It should be made, say so ("The sound file was made."), and offer **Put the sound file on the current slide**. Put it on a slide: expect an audio clip that asks for a name and captions or a transcript. Listen to it (I have not).
- [ ] **Save a picture.** Move the playhead to a moment, press the button, and **Put the picture on the current slide**: expect an image that asks for alt text. Open the PNG too (it is uncompressed, about 2.8 MB).
- [ ] **The pointer box.** With a recording whose mouse was noted, tick it and make a video and a picture: a soft yellow ring should follow the pointer, a red ring at each click.
- [ ] **While one is being made, the others are refused in words** (you can keep editing). Cancel names what is being made.

## Hiding windows, and picking a window by clicking it (2026-11-01)

Built and checked as far as I could without your screen: Rust tests (438 and one test that makes real windows of its own), the pretend recorder in the browser (56 checks in all for the Recorder app), and two real recordings of a small part of the screen holding only windows I made. What follows is what only you can say.

- [ ] **Hide a window, for real.** In the Recorder, type a word from the title of a window you use (for example the name of a password manager or your mail) in **Hide windows with these words**, record a part of your screen with that window in it, and play the video. Expect a plain dark grey box where the window is, all the time it is there. Then move it, resize it, close it and open it again while recording, and tell me how many pictures it shows before it is covered (I expect none when moved, and a few at most when it opens).
- [ ] **The edges.** The box is the window's visible frame; Windows' shadow round some windows can show as a thin strip. Tell me if that bothers you.
- [ ] **A hidden window with other windows in front of it.** The whole box is covered anyway. Check you are happy with that, because it can hide a window you meant to show.
- [ ] **Pick a window by clicking it.** On the Record screen choose One window, press **Pick a window by clicking it**, and click a window. The Recorder should go to the taskbar, come back, and have that window chosen, and the window you clicked should not have reacted (no button pressed, no text field focused). Try Escape, and a click on the desktop and the taskbar. Only you can say whether this feels right with a mouse and with a screen reader.
- [ ] **Do not use the mouse** while `cargo test -p openstage-capture-windows --lib -- --ignored` runs: its tests watch the mouse buttons for a moment and one clicks a window of its own (I ran them while you were using the computer; one of your clicks may not have registered, and I am sorry for that).

## Zooms suggested from clicks, and noting the mouse (2026-11-01)

Built and tested with the pretend recorder (12 + 5 unit tests, 6 browser checks). Never tried on a recording of your own screen.

- [ ] **Record with the mouse noted.** In the Recorder, tick **Note where the mouse goes and where I click** (under The mouse), record for a minute while you click around a few things (a button, a menu, then somewhere else), and stop. Then open **Edit the recording I just made** and press **Suggest zooms from my clicks**. Expect a short list, one line per stretch of clicking, with when, how long and where. Add one and look at the preview: does the zoom land on what you clicked, and does it feel too close, too far, too long or too short? The numbers are constants at the top of `capture-edit/src/suggest.ts`.
- [ ] **A whole screen.** The picture's size is read from the video; if it says it could not be read, tell me, because that is the one part I could only guess at.
- [ ] **A part of a screen** (the Part of a screen choice): the zooms should be centred on where you clicked inside that part, not shifted by where the part starts.
- [ ] **The wording.** Each suggestion is a sentence; read a few aloud with a screen reader if you can, and say if they are too long.
- [ ] **Privacy.** The notes include the title of the window in front and the name of what you click. Read the words beside the box and tell me if they are clear enough.
- Not built: the same button in this program's own recording editor; asking for step text; letting you change the numbers.

## Quick record in OpenStage Recorder (2026-11-01)

Built and tested with the pretend recorder (11 unit tests, 7 browser checks, 5 Rust tests), and the shell compiles. Never run on Windows: nothing here has recorded your screen, shown an icon, or touched your clipboard. A real recording is screen and (by default) your voice and the computer's sound, so I have not started one.

- [ ] **The button.** In the Recorder, read the sentence beside **Quick record**: it should say your screen, your voice, the computer's sound and the webcam as you have set them, and how to stop. Press the button, do something, press Ctrl+Shift+F11. Expect: a video made, the Record screen showing its path with **Copy the path** focused, and the path on your clipboard (paste it into Notepad). Open the MP4 and look at it and listen to it.
- [ ] **The icon.** Look for the OpenStage Recorder icon in the notification area (it may be under the up arrow). Right-click it: Quick record, Stop recording, Show OpenStage Recorder, Quit. Choose **Quick record**: the window should go to the taskbar and not appear in the video; **Stop recording** should bring it back with the video and its path. Hover the icon: the tooltip should say what is happening. A left click on the icon should show the window.
- [ ] **Quit while recording.** Choose Quit from the icon's menu during a quick recording. It should ask before it stops the recording, the same as closing the window.
- [ ] **Screen reader and keyboard** on Quick record, the path box, Copy the path and Show the video (the browser checks prove only names, roles and focus).
- Choices to change if you want: a key that starts Quick record from any program; closing the window to the icon instead of quitting; a window kept as the target; a quick profile of its own.

## Lower third with a logo (2026-11-01)

Built and tested by the suites (capture-edit 229, capture-timeline 157, the timeline's browser check 77, and the Recorder's copy: app 117 and 41). Nobody has used the button in the real editor with the real file chooser, or looked at the finished video.

- [ ] **Try the button.** In the recording editor (a recording with some time on it), put the playhead where the name should show, press **Lower third with logo** (in the bar of buttons beside the picture, after Zoom and Draw a zoom, with the file buttons) and choose a logo. Expect: two new rows, "Lower third" (the words "Name or caption", white on black) and your logo at the left end of the band; the logo's box for alt text opens first; both last 3 seconds (less near the end). Type the name, give the logo alt text (or mark it decorative), make a video, and look at it.
- [ ] **Look at the logo's shape and place.** It is a square box about 5 percent in from the left and 78 to 92 percent of the way down, and the picture is fitted inside it (not stretched, so a wide logo has empty space above and below). These are constants in `capture-edit/src/callouts.ts` (`LOGO_PLACE`, `LOWER_THIRD_BESIDE_LOGO`); say if you want the logo bigger, on the right, or a different length (3 seconds, the same as every callout).
- [ ] **A zoom during the lower third.** The logo is an imported picture with a place of its own, and those move with the screen in a zoom, while the words stay where they are. So a lower third is best put where no zoom is going on. If you want pictures with a place to stay still in a zoom, say so; it is a change in the video maker and the preview, not in the edit format.
- [ ] **Undo.** One Undo takes away both rows; then Redo brings both back.
- Not in the Recorder yet: it has no file chooser, so the button is not shown there (the code is the same in both).

## Sound-only export, single picture and pointer highlight (2026-11-01)

Built and tested by the suites (exporter 425, render crate 85, command line 18) and tried by me on the real project the MP4 publish makes from the LMS example: a WAV of 284.1 seconds in 3 seconds (peak 62 percent, no clipping), and a 1280 by 720 PNG at 20 seconds that I looked at. Nobody has listened to a WAV or opened a PNG in a viewer, and the pointer has never been drawn from a real recording. The choices I made for you, each easy to change:

- [ ] **Listen to a sound file** made with `openstage-capture render --audio-only --out lesson.wav` (or the Recorder's "Make a sound file (WAV) from this edit") from a recording with your voice and the computer's sound: it should sound like the video's sound, balanced the way the editing screen's Sound balance says, and be as long as the video would be. A WAV is 16-bit, two channels, 48,000 a second, uncompressed (about 11 MB a minute). I chose WAV because it needs no encoder and opens everywhere; say if you want MP3 or M4A (M4A would use Windows' own AAC encoder as the video does).
- [ ] **Open a picture** made with `--frame 20000 --out moment.png` (or "Save the picture shown in the preview (PNG)") in a picture viewer and an editor: it should match what the video shows at that moment, including a zoom in progress and any overlays. A PNG is uncompressed (about 2.8 MB at 1280 by 720); I chose that so it needs nothing to be installed. Say if you want smaller files.
- [ ] **The pointer highlight** (`--highlight-cursor`, or the box in the Recorder's edit screen): record something with "note where the mouse goes" on, then make a video with the option. Check the soft yellow disc follows the pointer, the red ring opens at each click, it does not show where the pointer left the recorded region, a blur or blackout hides it, and with "cuts instead of animated zooms" ticked the ring does not open. It is off unless asked for, and a recording made without noting the mouse says so and is unchanged.
- [ ] **Colours and size of the pointer**: yellow disc, orange ring, red press ring, 3 percent of the picture's height (at least 14 pixels). Look at them on your own screens (a white page and a dark one) and tell me if they are hard to see or too much. They are constants in `capture/crates/openstage-capture-render/src/cursor.rs`.
- [ ] **Screen reader and keyboard** on the Recorder's three new buttons and the pointer box (the unit tests and browser checks only prove the names, roles and focus).

## Essay, choose a word and keyboard shortcut questions (2026-11-01)

Tried in a browser with a real mouse, a real keyboard and the stand-in page (the essay's word count and "write at least 20 words" message, a wrong and a right word, Capture the keys with Ctrl+C and with Escape) and by the suites. Not tried with a screen reader, a phone, or a real LMS. The choices I made for you, each easy to change:

- [ ] An essay is **not marked**: it counts once it has the fewest words (a new one starts at 20, the author can set 0 for any answer), earns all its points, and has one try. Too few words is "Write at least N words first" and does not use a try. If you would rather an essay earn nothing until an instructor marks it, that is a bigger change (the LMS has to mark it), so say so.
- [ ] A learner's essay goes to the LMS as a long fill-in, cut to 255 characters in SCORM 1.2. Try it in a real LMS (SCORM Cloud) and look at what the LMS shows for the answer: does it show the words, and does it cut them?
- [ ] An essay of more than 200 characters is not put back when a learner leaves and returns (SCORM 1.2 has too little room), though the question stays finished. Say if that matters.
- [ ] With NVDA or Narrator on the essay: the box should be read with its label, the "Write at least 20 words." line and "0 words" (as the box's description, once, when it is focused, not on every word typed).
- [ ] Choose a word: the learner clicks a word or uses the list. A **mouse and touch** click on a word worked in the browser; try it on a phone or tablet, where the words are small.
- [ ] With NVDA or Narrator on the choose-a-word question: the passage should read as plain text, the list should be "Choose a word" with every word in it, and a word that comes twice should say its place ("the (word 5)"). Say whether that is enough to answer without the picture of the passage.
- [ ] More than one word may be marked right, and any of them is right (only one is chosen). If you want "choose every right word" that is a different question.
- [ ] Keyboard shortcut: Capture the keys listens for one key and cannot trap (Tab is an answer and the next Tab moves on; Escape alone stops it; leaving it stops it). To answer Escape, type it. Try it with a screen reader running: NVDA may take some keys for itself (the NVDA key, Insert), which a page cannot see.
- [ ] Try the shortcuts a browser or Windows keeps (Ctrl+W, Alt+F4, Win+D, Ctrl+Alt+Delete) with Capture: the page cannot see them, so the validator warns when an author makes one the right answer. Check the warning reads well in the Problems list.
- [ ] A Mac: Cmd is Meta. Try Capture on a Mac with Cmd+C and check it is recorded as `Meta+C` and counts as right when the author wrote `Cmd+C`.
- [ ] The editor's Properties for the three kinds (Written answer, Passage, Shortcuts that are right) in the desktop app: the passage box refusing a stray bracket, and the shortcut box rewriting `ctrl + s` as `Ctrl+S` when you leave it. Tried in the test suite, not in the app.
- [ ] `examples/question-types.osproj` has three new slides (13 to 15); `TEST-PLAN.md` there has the steps for Brightspace.

## MCP access: an AI assistant using the program (2026-11-01)

- [ ] Connect a real assistant. In the desktop app press **MCP access**, tick the box, choose a folder (a new empty one is best), Save, and copy the Claude Desktop block into `claude_desktop_config.json` (or run the Claude Code command). Restart the assistant, then ask it to make a short course with a few slides, a picture, a question and some narration, check it, and publish it. Look at what it made by opening the project in the editor (close the assistant's work first, or open a copy). The server has been tried with the official MCP client library and with a test client, but never with Claude itself.
- [ ] Try the safety on purpose: with MCP access off, connect (it should say how to turn it on); turn it on, then off while the assistant is connected and ask for something (it should be stopped); ask it to open or write something outside the folder (it should refuse).
- [ ] Read `OpenStage MCP log.txt` in the folder after a session. It should say what was done, in order, without the words written on the slides.
- [ ] In the desktop app, check the MCP access dialog end to end: the native folder dialog, Save, Copy (paste somewhere to see the lines), Escape, and that focus returns to the MCP access button. It was tried in a web browser, not in the app. The lines name the program's Node, `mcp\openstage-mcp.mjs` and the settings file: after an installer build, check that those three paths exist on the installed computer (`BUILD INSTALLER.bat` now builds the server into the payload; that step has not been run).
- [ ] With NVDA or Narrator on the dialog: the checkbox should be read with its label and the note about the folder, the two blocks of lines as text boxes with their labels, and the results of Save and Copy from the status line.
- [ ] If a narration voice is installed, ask the assistant to make the audio (`make_audio`) and then publish; the voice needs the lines to include its settings, which the dialog adds only when the voice is installed.
- [ ] Ask the assistant for a course that uses the larger tools: a flip-card or tabs slide, a labeled picture, a branching scenario with two people speaking, a button that shows a layer and adds to a score, and a new theme. Open it in the editor and play it with **Preview**: does each work as asked? Does the scenario read well aloud once the audio is made? Do the rules do what their sentences say?
- [ ] The scenario tool builds a scenario whole, outside the editor's own step-by-step edits (the shape is checked against the format, and the problem check passes). Open one in the editor's scenario panel and change a line, a choice and an effect, to see that the panel reads it as one it made itself.
- [ ] Ask the assistant to make a course and then look at it for accessibility the way a person would (headings, reading order, alt text it wrote for pictures): the tools make what is asked for, and whether its words are good is for you to judge.

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

- [ ] A real LMS test of the SCORM 1.2, SCORM 2004 and xAPI packages. **Everything is ready (2026-11-01): open `dist/lms-test-pack/LMS-START-HERE.md`** (rebuild the folder with `PUBLISH LMS TEST LESSON.bat`). Brightspace first; a SCORM Cloud free Trial is the free second opinion and the way to see xAPI statements. `player/tools/lms-rehearsal.mjs` is the answer key played through the pretend LMS and LRS.
- [ ] NVDA or VoiceOver on the sliders and dials, the enlarge button and its dialog, the labeled graphic (markers as tabs) and the guided Previous and Next step buttons with their "Step 2 of 5" line.
