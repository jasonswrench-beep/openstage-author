# Screen reader pass on the editor

This is a script for testing OpenStage Author with a screen reader, and the place to write down what happened. The NVDA half was run on 2026-10-21, and a second round on what was built after it on 2026-10-22 (the results are in the tables, and the problems they found are at the end); the Narrator half has not been run. A person who uses a screen reader every day should still run it, because this run could not use NVDA's own keys or the keyboard. Please fill in what is missing with exactly what the screen reader said, not a summary.

**Why this matters.** The release gate says the whole editor is usable with a keyboard alone and with NVDA. The Timeline panel, the lists, the dialogs and the Properties panel are the patterns that new panels (the recorder panel, a clip list, a multi-track timeline) will be built from. If a pattern does not work with a screen reader, it is far cheaper to find out now.

**Who should run it.** Someone who uses a screen reader every day will find much more than a first-time tester. If that is you, please say which screen reader and which settings you normally use, because a different configuration can sound very different.

**What has already been checked without a screen reader.** A pass on 2026-10-13 checked names, structure, focus, sizes, contrast and how the editor reflows (see `docs/accessibility-audit.md`). It could not say what a screen reader speaks, which is what this script is for. It also lists the questions it could not answer and that need a listener: whether the slide canvas's arrow keys work in NVDA's browse mode, whether the sections of Properties should be headings, and whether the long button descriptions help or tire.

**What this covers.** Windows only: NVDA (free, from nvaccess.org) and Narrator (built into Windows; Windows key + Ctrl + Enter turns it on or off). The editor is a desktop window that shows web content, so a screen reader treats it like a web page. VoiceOver on a Mac, touch devices and the published course player are not covered here (the player is tested with the real LMS plan).

## Before you start

1. Start the editor with `OPEN EDITOR.bat`.
2. Choose **Open project** and open `examples\minimal.osproj` (or any project with a few slides and objects). Work on a copy if you plan to make changes.
3. Turn your screen reader on. Note which one, its version, and the browse mode or focus mode behaviour you use.
4. Fill in this box:

| | NVDA | Narrator |
| --- | --- | --- |
| Version | 2026.2, portable copy (signed by NV Access), voice turned off and its log read instead | Not run |
| Speech settings that matter (rate, punctuation level, "report" options) | The defaults of a new profile. Live regions, dialog descriptions and "report dynamic content changes" were on. | |
| Date and tester | 2026-10-21, run by Claude (an AI) with keys sent through the debugging port. Not a person who uses NVDA every day. | |

## How to record a result

For each pattern below there is a table with one row per screen reader. In **What it said** write the words, as exactly as you can, for the key steps. In **Verdict** write one of: **works** (you could do the task and the speech was clear), **awkward** (you could do it but something was confusing, repeated or missing), or **blocked** (you could not do the task). Put any extra detail in **Notes**.

When something goes wrong, also add a line to the problem list at the end: which pattern, which screen reader, what was said, what should have been said, and how bad it is (**blocks a task**, **awkward** or **cosmetic**).

## The patterns

### 1. Moving between the panels

**What to do.**
1. Press F6 and listen. Press it again, several times, until you are back where you started.
2. Press Shift+F6 to go backwards.
3. Open the Timeline panel (the **Timeline** button in the toolbar) and press F6 again.

**A good result.** Each panel is named when focus enters it. The Timeline panel is included while it is showing and left out when it is hidden. Focus is never lost, and you never end up in a place with nothing named.

| Screen reader | What it said | Verdict | Notes |
| --- | --- | --- | --- |
| NVDA | F6 named each panel as focus arrived: Slides (navigation landmark), Canvas (main landmark), Properties (complementary landmark), Objects, Problems, and Timeline only while it was showing. Shift+F6 went back the same way. Focus was never lost. | works |  |
| Narrator | Not run (only NVDA was available) | | |

### 2. The Slides, Objects and Problems lists

**What to do.**
1. Tab into the Slides list: it is one Tab stop, and Tab should land on the current slide. Use Up and Down, then Home and End. Press Tab to leave and Shift and Tab to come back: you should land where you were.
2. Press Enter on a slide. Listen to what is said about the selection ("Slide 3 of 24: ..." is expected).
3. Press Alt+Down on a slide to move it later, then Alt+Up to put it back.
4. Move into the Objects list. Do the same, and use Alt+Up and Alt+Down to change an object's reading order.
5. Press Delete on an object. Then press Ctrl+Z.
6. Move into the Problems list and choose a problem.

**A good result.** Each item's name, its position in the list and whether it is the selected one are spoken. Choosing a slide or an object says which. Moving a slide or changing reading order is announced in plain words. Delete says it can be undone. Choosing a problem takes you to the object it is about and says so.

| Screen reader | What it said | Verdict | Notes |
| --- | --- | --- | --- |
| NVDA | Slides: "list with 9 items, 1. Welcome, button, current"; Down said "2. Knowledge check"; Home and End worked; Enter said "Slide 1 of 9: Welcome."; Alt+Down said "Welcome is now slide 2 of 9". Objects: "Heading is now number 2 of 3 in reading order"; Delete said "Deleted Heading. Press Control Z to undo."; Control+Z said "Undone". Problems: Enter went to the object and said "Selected Timer, timer, at 900, 40, size 340 by 200", but the canvas was first read with the old slide's name. | works, after one fix | The canvas was read as "Slide canvas: Welcome" when a problem on another slide was chosen (fixed: focus now waits a moment). The reading order said "of 3" in a list of 4 objects (one is outside the reading order). |
| Narrator | Not run (only NVDA was available) | | |

### 3. Working on the slide by keyboard

**What to do.**
1. Tab to the slide canvas (it is named "Slide canvas"). Press Page Down and Page Up to choose objects.
2. With an object chosen, press the arrow keys to move it by 1, then Shift with an arrow to move it by 10.
3. Press Alt with an arrow key to resize it.
4. Press Escape.
5. Choose two objects (Shift with Page Down). Press an arrow key. Then press Ctrl+G to group them.

**A good result.** Each choice, move and resize is announced once, in words, without having to look at the screen. The slide itself is hidden from the screen reader (it is for the eye), so you are not walked through its contents. Several quick key presses announce once, with the final position. Grouping says what it did.

| Screen reader | What it said | Verdict | Notes |
| --- | --- | --- | --- |
| NVDA | Page Down: "Selected Heading, text, at 80, 72, size 1120 by 96"; Right arrow: "at 81, 72..."; Shift+arrow moved by 10; Alt+arrow: "size 1121 by 96"; Escape: "Selection cleared"; Shift+Page Down: "2 objects selected: Heading, Body."; Ctrl+G: "Grouped 2 objects. Clicking one on the slide now chooses them all...". The slide itself was not read. Each key said one thing. | works |  |
| Narrator | Not run (only NVDA was available) | | |

### 4. The Properties panel

**What to do.**
1. Choose a text object and Tab through the Properties panel. Listen to each field.
2. Change a value (for example the object's name) and press Tab.
3. Do the same for a shape and for an image.
4. Find a button that is unavailable (for example **Move earlier** when only one object is chosen) and move to it.

**A good result.** Every field has a spoken label, and the same label is not read twice. Changing a value keeps your place and does not jump focus. A control that is unavailable can still be reached and says it is unavailable.

| Screen reader | What it said | Verdict | Notes |
| --- | --- | --- | --- |
| NVDA | F6 into Properties: "Properties, Name edit Heading". Each field read with its label and its note as the description; groups were named (Content, Appearance, Text colour, Timing, Animation, Rules). Palette buttons read "Theme colour: Background, toggle button, not pressed". Move earlier read "unavailable". After typing in Name and pressing Tab, focus fell to the top of the page ("OpenStage Author document"). | awkward, fixed | Name (and the narration text) lost focus on Tab because the panel was redrawn (fixed: focus goes to the next control). "Suggestion available, has auto complete" was read on text boxes (fixed). A bare "Default" was read as "default button" (fixed: "Text colour: default"). The native custom-colour picker is read by its colour only ("7% red 7% green 7% blue") whatever its name; the palettes and the Hex code box do the same job. |
| Narrator | Not run (only NVDA was available) | | |

### 5. Dialogs

**What to do.** For each of these, open the dialog, Tab around inside it, press Escape, and check where focus lands.
- **New project**, **Add slide** (the layout picker), **Theme**, and the **Add** menu pickers (a shape, a question, an interaction).
- **Variables**, **Timing** and **Narration** (the toolbar buttons).
- **Publish**: start a publish and then cancel it.

**A good result.** Focus moves into the dialog and is announced with its name. Tab stays inside it. Escape closes it and focus returns to the button that opened it. For Narration and Publish, progress and the Cancel button are announced. You are never trapped.

| Dialog | Screen reader | What it said | Verdict | Notes |
| --- | --- | --- | --- | --- |
| New project | NVDA | Opened as "New project dialog" and then every word in it (before the fix); "Project title (required) edit required blank"; Tab: Author, Language code, Theme combo box. | works, after the fix to every dialog | |
| New project | Narrator | Not run (only NVDA was available) | | |
| A picker (layout or Add) | NVDA | The layout picker read all 35 layouts with what each is for, twice, when it opened (before the fix); now it says its first paragraph. A layout is "radio button, checked, 2 of 35"; Tab reached Add slide and Cancel. The Add list's picker, with Timer in it, was reached; its first Tab stops were read after a delay. | awkward, fixed | |
| A picker (layout or Add) | Narrator | Not run (only NVDA was available) | | |
| Variables | NVDA | "Variables dialog" and its note; Name edit, Kind combo box, Add variable, Close. Escape: "Variables closed." and focus back on the button. | works, after the fix to every dialog | |
| Variables | Narrator | Not run (only NVDA was available) | | |
| Timing | NVDA | As pattern 7. | works | |
| Timing | Narrator | Not run (only NVDA was available) | | |
| Narration | NVDA | "Narration dialog", its status (35 narrations, none with audio, no speech engine) and "Make all missing audio (35), button, unavailable". Escape: "Narration closed." | works | |
| Narration | Narrator | Not run (only NVDA was available) | | |
| Publish and cancel | NVDA | Not run. |  | |
| Publish and cancel | Narrator | Not run (only NVDA was available) | | |

### 6. Announcements

**What to do.** Move an object, resize it, undo, redo, delete, save (Ctrl+S) and make narration audio. Listen after each.

**A good result.** Each announcement is heard once, in plain words, and does not interrupt typing in a field.

| Screen reader | What it said | Verdict | Notes |
| --- | --- | --- | --- |
| NVDA | Move: "Heading, text, at 81, 72..."; resize: "size 1121 by 96"; Control+Z: "Undone"; Control+Y: "Redone"; Delete: "Deleted Heading. Press Control Z to undo."; Control+S: "Saved. 1 file written". Each once, in plain words. The count of problems ("Problems: 2 warnings") now waits until 2.5 seconds after anything else was said, so it does not talk over "Added ...". | works | NVDA's own echo of typed letters could not be tried (keys are sent through the debugging port, not the keyboard). |
| Narrator | Not run (only NVDA was available) | | |

### 7. The Timing list

**What to do.**
1. Open the **Timing** button in the toolbar.
2. Move through the table. Change a time with the keyboard.
3. Close it.

**A good result.** It reads as a table or a list with named fields, and each change is announced.

| Screen reader | What it said | Verdict | Notes |
| --- | --- | --- | --- |
| NVDA | Opened as "Timing: Welcome dialog" with its note. The table was read as a table: "Timing of each object on this slide table", then each box with its row and column ("Heading row 2 Appears column 2, Heading: when it appears, combo box"). Escape: "Timing closed." and focus back on the Timing button. | works |  |
| Narrator | Not run (only NVDA was available) | | |

### 8. The Timeline panel (the most important one)

**What to do.**
1. Press the **Timeline** button. Move to the panel and through its rows.
2. On a row, find the two grips: "when it appears" and "when it goes".
3. On the first grip press Left and Right (a tenth of a second), Shift with an arrow (a second), Page Up and Page Down (five seconds), Home and End.
4. On the second grip press End, which makes the object stay until the end.
5. Look at the Properties panel and the announcement after each change.

**A good result.** Each row is a group named with the object and its timing in words. Each grip is announced as a slider with a name such as "Heading: when it appears" and a value in words, such as "0.3 seconds after the slide opens", which updates after every key. The Properties panel follows. Nothing is spoken twice.

| Screen reader | What it said | Verdict | Notes |
| --- | --- | --- | --- |
| NVDA | Grip: "Heading: when it appears, slider, 0 seconds after the slide opens". Right: "0.1 seconds after the slide opens"; Shift+Right: "1.1 seconds..."; Page Up and Page Down moved by 5 seconds; Home and End worked; the second grip said "disappears 9.9 seconds after it appears", and End "stays until the slide ends". Before the fix every key also said the row's name before and after the grip; now it says the new value and the row's new timing once. | works, after one fix | Every key press used to say the row name, then the grip, then the row name again (the row was redrawn each time; fixed: the row is changed where it stands, and the axis too). |
| Narrator | Not run (only NVDA was available) | | |

**Answer these three questions too.** They decide how a multi-track timeline for recordings should be built.

| Question | NVDA | Narrator |
| --- | --- | --- |
| Do you have to switch to focus mode to use the grips, or does the screen reader switch by itself? | No switch was needed in the way the pass was run: focus went to a grip and NVDA spoke it as a slider. (The pass could not press NVDA's browse mode keys.) | Not run (only NVDA was available) |
| Is the value in words read ("0.3 seconds after the slide opens"), or only the number? | Yes: "0.1 seconds after the slide opens", "stays until the slide ends", not only the number. | Not run (only NVDA was available) |
| When focus moves from one row to the next, is the row's name (the group label) read? | Yes: "Body: Always there, grouping" was read, then the grip. | Not run (only NVDA was available) |

### 9. A scenario in the published course (the most important one for learners)

This pattern is about the course a learner opens, not the editor. Publish `examples/scenario.osproj` (or open the preview), and use only the screen reader and the keyboard.

**What to do.**
1. On the first slide, move to the choice of character. Move between the cards with the arrow keys and choose one with Space.
2. Go to the next slide and find the scenario. Read the meters, the situation's heading and its lines, then the question and the choices.
3. Choose a choice with Enter. Listen to what is said next, and see where the cursor is.
4. Go on until an ending. Read "Your path". Find Take back my last choice and Start again, and use each.
5. Press Listen to this part on a situation that has audio.

**A good result.** Each card is read as a radio button with the person's name, then who they are and what they look like ("Alex Kim, radio button, 1 of 2, Analyst on Maya's team, Alex, a man with glasses..."). The scenario is a named region. The meters are read with their name and value, and a message such as "Trust is now 3, up 2." is read after a choice that changes one. After choosing, focus is on the heading "What happened" (or the next situation's heading), which is read, and the screen reader's reading position then continues with the response and the new situation. Choices are read as buttons in a group named by the question. A person's picture is not read beside their lines, only their name. Nothing is read twice, and the screen reader is never left on a button that has disappeared.

| Screen reader | What it said | Verdict | Notes |
| --- | --- | --- | --- |
| NVDA | Cards: "Alex Kim, radio button, not checked, Analyst on Maya's team, Alex, a man with light skin, short black hair and glasses..., 1 of 2"; the arrow keys moved and chose ("Jordan Lee, radio button, checked, ... 2 of 2"). The scenario slide was read as a region with meters, heading and choices. After a choice: "Maya's trust in you is now 2, up 2. How clear you have been is now 2, up 2." then the new situation's heading. Take back my last choice worked and said what the meters were now. | works | A meter is read as "Maya's trust in you: 0 0, on a scale from -5 to 5" (the number twice). Start again was not reached. |
| Narrator | Not run (only NVDA was available) | | |

### 10. Looks, and the rule that applies one

This pattern has two halves: the editor, and the course a learner opens. For the second half publish `examples/looks.osproj` (or open the preview).

**What to do in the editor.**
1. Select a button. In Properties find the Looks box and the **Look to edit** list. Choose Visited, then Add a look... and name it. Listen to how each is read, including "not set".
2. In the look, change a colour with the palette, type a number in How solid, and read the sentence about contrast. Write a Spoken message.
3. Add a rule, choose Do: Change an object's look, and read the Which object and Change it to boxes and the note under them.
4. Press Delete this look (or Clear this look) and listen to what is said about the rules that still use it.

**What to do in the course.**
1. On the first slide press Mark done. Listen for the words, then press Not done yet.
2. On the next slide read Submit: it should be read as unavailable (dimmed). Try to reach and press it.
3. Press Unlock Submit and listen. Go to Submit.

**A good result.** The Look to edit list reads each look by its plain name, with "not set" where it is not. Every field in a look says which look it belongs to ("Text colour (Visited)"), so you always know whether you are changing the object or the look.
Adding, renaming and deleting a look are announced, and focus goes back to the list. The note under a rule says what will be said, or that nothing will. In the course, Mark done says "Step 1 is marked as done" once, and going back to normal says nothing.
Submit is read as unavailable and cannot be pressed; after Unlock Submit, "Submit is ready" is said and Submit can be pressed. Nothing is read twice.

| Screen reader | What it said | Verdict | Notes |
| --- | --- | --- | --- |
| NVDA | In the course: Mark done said "Step 1 is marked as done" once; Not done yet said nothing; Submit was read as "unavailable"; Unlock Submit said "Submit is ready". The editor half (the Looks box) was not run. | works (course half) | A button that is really disabled is left out of the Tab order; the screen reader finds it by reading the slide. |
| Narrator | Not run (only NVDA was available) | | |

### 11. The PowerPoint dialog

Use `examples/powerpoint/Introduction to Communication.pptx` and then `Introduction to Communication (edited).pptx`, with a project open.

**What to do.**
1. Press the **PowerPoint** button. Listen to how the dialog is announced. Choose the first file.
2. If asked, choose *Bring slides in as a new presentation*. Move through the list of slides, untick one, and listen for the count on the button. Press **Bring in** and read the report.
3. Open PowerPoint again and choose the edited file. Choose *Bring slides I brought in earlier up to date*. Move through the changes: each has a box, and some have lines under them. Find the one that says it replaces something you changed.
4. Press **Bring up to date** and read what was done.

**A good result.** The dialog is named and the heading of each step is read when it appears. The file chooser, the two choices, the list of slides and the changes are all reached with Tab and the arrow keys, and each box is read with its words. The lines under a change are read with it. The count on the button changes as boxes are ticked. After each step, the new heading is read, and Close returns to the PowerPoint button. Nothing is read twice.

| Screen reader | What it said | Verdict | Notes |
| --- | --- | --- | --- |
| NVDA | Not run: the PowerPoint dialog starts with a file chooser belonging to Windows, which could not be driven. | | |
| Narrator | Not run (only NVDA was available) | | |

### 12. The learner accessibility panel in the published course

This is about the course a learner opens. Publish `examples/lms-test-lesson.osproj` (or open the preview) and use only the screen reader and the keyboard. See `docs/learner-accessibility.md`.

**What to do.**
1. Tab to the **Accessibility** button (after Credits). Press Enter. Listen to what is said about the panel.
2. Tab through it. Change **Text size** to 150%, then **Colours** to Dark, then turn on **Reading line**. Listen to what is announced each time.
3. Go to the Your results slide (slide 19), pause the narration, and press **Read aloud**. Then press Escape, or Stop reading.
4. Press **Show the transcript**. Read a few slides. Close it, and see where focus goes.
5. Press **Put everything back**. Then press Escape to close the panel, and see where focus goes.

**A good result.** The button is read as "Accessibility, button, collapsed" and then "expanded" once open; the panel is read as a region named "Accessibility" with groups named Text, Colours, Reading, Read aloud and Transcript; each control is read with its label and its value ("Text size, 100%, combo box"). Each change is announced in words. Read aloud does not talk over the screen reader's own speech by starting by itself.
The transcript window is read as a dialog titled with the course, with a heading for each slide. Escape closes the panel and focus is on the Accessibility button.

| Screen reader | What it said | Verdict | Notes |
| --- | --- | --- | --- |
| NVDA | The button: "Accessibility, button, collapsed" and then "expanded"; the panel: "Accessibility region, heading level 2", its note, and groups Text, Colours and Reading; each control with its label and value; Text size: "125% // Now text size 125 percent.", then "150%..."; Colours: "Dark // Now text size 150 percent, colours: dark."; Reading line: "checked // Now ..., reading line on."; Put everything back: "Everything is as the course has it.". The transcript used to open in silence; now: "Transcript: <title> dialog, heading level 2" and "The words of the transcript region". Escape closed the transcript and focus went to the Accessibility button. | works, after one fix | The transcript window said nothing when it opened (focus was on a box with no name; fixed: focus starts on the title). Read aloud was not run. |
| Narrator | Not run (only NVDA was available) | | |

### 13. Captions from the voice, in the captions window

This is about the editor. Select a video on a slide, press **Write captions...**, and find *Write the captions by listening to the voice*. See `docs/speech-recognition.md`.

**What to do.**
1. Move through the section with the screen reader: the line that says whether the recogniser and the model are ready, **Speech model**, **Words to listen for**, and the buttons.
2. Press **Listen and write the captions** on a short video with a voice. Listen to what is said while it works, when it finishes, and where focus is.
3. Press **Stop** during a second listening. Listen to what is said and where focus is.
4. Read the "unchecked" note and press its button.

**A good result.** Each field is read with its label and its description ("Words to listen for, edit, multi-line... Names and terms from your course..."). The progress bar is read as a progress bar named "How far this has got". The start and the end are announced in the status line; the percentage is not announced every few seconds. After a finished listening, focus is on the first caption's words; after Stop, on the button that was pressed.

| Screen reader | What it said | Verdict | Notes |
| --- | --- | --- | --- |
| NVDA | Not run: the speech model (488 MB) is not on this computer, and the pass did not download it. | | |
| Narrator | Not run (only NVDA was available) | | |

## Problems found

| # | Pattern | Screen reader and version | What was said | What should have been said | How bad |
| --- | --- | --- | --- | --- | --- |
| 5 | Every dialog | NVDA 2026.2 | On opening, every word in the dialog, and again when focus landed (the layout picker read all 35 layouts) | Its name and one paragraph of what it is for | awkward. Fixed: every dialog now names its first paragraph as its description (`dialogdesc.ts`). |
| 4 | Properties | NVDA 2026.2 | After typing a new name and pressing Tab: "OpenStage Author document", focus at the top of the page | The next field | awkward. Fixed: when a redraw loses the place Tab was heading for, focus goes there (`keepFocus`). NVDA still says "document" for a moment on the way. |
| 8 | Timeline | NVDA 2026.2 | Each key press said the row's name, the grip and the row's name again | The new value, and the row's timing once | awkward. Fixed: the row and the axis are changed where they stand (`nudge`, `reshape`). |
| 2 | Problems list | NVDA 2026.2 | Choosing a problem on another slide read the canvas as "Slide canvas: Welcome" (the old slide) | The new slide's name | awkward. Fixed: focus goes to the canvas 120 ms later, after the browser has passed the new name on. |
| 4 | Properties | NVDA 2026.2 | "Suggestion available, has auto complete" on text boxes; a bare "Default, button" | No browser suggestions; "Text colour: default" | cosmetic. Fixed (`autocomplete=off`, a label on the button). |
| 9, 10 | The course (feedback) | NVDA 2026.2 | After Check answer, nothing: the right or wrong feedback was not spoken. A timer's layer text was not spoken either. | "Not quite. Think about how many people..." and "Time is up. The clock ran out." | **blocks a task** for a learner who cannot see the feedback. Fixed: words in a layer's live regions are put in 350 ms after the layer opens, not on the next frame (`stage.ts`). Checked again with NVDA. |
| 12 | The transcript window | NVDA 2026.2 | Nothing said when it opened | Its name and what it is | awkward. Fixed: focus starts on the title; the words are a named region. |
| 4 | Properties | NVDA 2026.2 | The custom-colour picker is read as "7% red 7% green 7% blue", without its name, even with the name set | "Text colour: choose any colour..." | cosmetic. Open: a limit of NVDA with the browser's own colour control. The palettes and the Hex code box are the accessible way and are read well. |
| 9 | A scenario | NVDA 2026.2 | A meter was read as "0 0, on a scale from -5 to 5" | "0, on a scale from -5 to 5" | cosmetic. Open. |
| 2 | Objects list | NVDA 2026.2 | "Heading is now number 2 of 3 in reading order" in a list of 4 objects | The count that matches the list, or a word about the one outside the reading order | cosmetic. Open. |

How bad: **blocks a task** (you could not do it), **awkward** (you could, with difficulty or confusion), **cosmetic** (a small oddity).

## What was not covered, for a second round

These editor features were added after this script was written, and are not in the patterns above: choosing several objects and the Line up and Space out buttons, locking, grouping, copy and paste, the question editors in the Properties panel, snapping (which is for the pointer only), the Group, Duplicate slide and layer buttons, the audio description box on a video, the Characters dialog and its library of people (each person's description beside their picture, Choose buttons named for the person and the pack, Add a character pack, and Remove with a second press), the pose dialog (a check box for each pose, with its picture and words) and the Pose beside the line box in the scenario editor, the Shape or bubble picker with its bubble choices and the Bubble and Tail boxes in the Properties panel, the background picker (a list of pictures in groups, each with a button named for it) and the Background picture and Remove background picture buttons, the A person from the library choice and its one-picture dialog, and the Words sit box, the icon picker (a grid that moves with the arrow keys), the button picker and the button Look and icon boxes, the ready-made lesson slides in the Add slide picker, the scenario editor in the Properties panel, and the Choose by playing dialog and the timeline groups for objects that follow a video or audio clip. (Looks are pattern 10.) The AI services dialog (a password box with Show, a box that is the author's yes, Check the key, the plugin switches), the question asked before a service is sent anything for the first time (its **Not now** button has the focus), the **Make with AI** tab of the Assets dialog (how a made picture's alt text is asked for), and the notes under the Voice list that say where a voice is made and what it cannot do.

## What the browser's accessibility tree says (not a screen reader), 2026-10-21

This is not the pass above and does not replace it. It is what the browser tells assistive technology, read out of the real app over the debugging port (`Accessibility.getFullAXTree`), for the dialogs added with the people library, backgrounds and bubbles. It finds a missing name or a picture that is read out; it cannot say how a screen reader sounds or whether the order makes sense by ear.

* **The library of people, the pose dialog (one picture), the background picker and the Shape or bubble picker:** each dialog has its name; headings run 2 (the dialog), 3 (a pack, or a group of choices) and 4 (a group of backgrounds); every list and region is named; every button is named for what it does and for what ("Use Corner office at dusk as the background", "Choose Lisa from OpenStage people, set 1"); the pictures are hidden from assistive technology, with the words beside them doing the describing; the pose dialog is one group of round buttons named for the person; no control is without a name.
* **Found and fixed:** the tick that marks the chosen card in the pickers was read as part of the name ("check mark Rectangle"). It now has no words of its own.
* **The Question banks dialog (2026-10-21):** the dialog has its name and a level 2 heading; each bank is a group named for the bank, and every control in it has its own name (Name, First slide, Last slide, "Show how many of its 6 slides to each learner", "Show them in a mixed order", and "Delete the question bank Chapter questions"); the form for a new bank is a group of its own; the status line is a status region; no control is unnamed.
* **The Questions from a file dialog (2026-10-21):** the dialog has its name and a level 2 heading; the steps below it are level 3 headings ("What was found", "Rows to look at", "The questions"); the rows to look at and the questions are named lists; the choices for how to add them are a group with a legend and every box has its own label; focus moves to the summary after a file is read, so it is read out; the add button names how many questions and where they go.
* **The timer in a published course (2026-10-21, read from the page, not the accessibility tree):** a group named by the author's name for it; the clock is a `timer` named by the label above it and set not to be read as it changes; the bar is hidden from assistive technology; the two buttons are real buttons with their words as names, and a button that cannot be used is dimmed with `aria-disabled` (not `disabled`), so the keyboard is not lost when it is pressed; a status region of the timer's own says the marks, time added, the timer off and time up. What NVDA actually says, and whether it says those messages in turn, is for the pass.
* **Not looked at this way:** the Properties panel (it uses the same labelled boxes as every other object's), the scenario editor, and the editors for questions and interactions.

## How the NVDA pass was run, and what it cannot say (2026-10-21)

NVDA 2026.2 (a portable copy, signed by NV Access, downloaded with the author's yes) ran with its voice turned off and its debug log on, which records every line it would speak. The editor (a desktop window made of web content) and the published course pages (in Edge) were driven through the browser debugging port: keys, focus changes and clicks were sent to the page, and each key's speech was read from the log and written down. The scripts are not part of the repository; the results above are.

**Privacy.** NVDA hears the whole computer, including a window in the background that is changing its own text. A line of speech was kept only if the program being tested was in front the whole time and every piece of it was either NVDA's own wording ("button", "collapsed") or something the page being tested says (its text, labels and what the browser gives assistive technology). Anything else was thrown away unseen, and the raw log was deleted when each run ended. Even so, text from another window reached the first notes of this pass once, before the filter was strict; it was deleted, and none of it is kept.

**What it could not tell.** The keys were not typed on a keyboard, so NVDA's echo of typed letters and its browse mode keys (for reading a page line by line) were not tried. Narrator was not tried. Reading a page with NVDA's own cursor was not tried: the pass moved focus with Tab, the arrow keys and F6 and listened to what came. A person who uses NVDA every day will find more.

**Not covered.** Pattern 11 (the PowerPoint dialog: a Windows file chooser) and pattern 13 (captions from a voice: the model is not installed), the Publish dialog, the editor half of pattern 10 (the Looks box), Read aloud in the course, and the folder chooser of the New project dialog. The Share slides, Question banks and Questions from a file dialogs, the timer's Properties, a question that mixes its answers, and the timer, a bank and the feedback in a course page were covered, because they are new.

## A second NVDA pass, on what was built on 2026-10-21 and 22 (run 2026-10-22)

NVDA 2026.2 (the same portable copy, voice off, log read), run by Claude with the author's go, by the same method as above: keys sent through the debugging port, a line kept only if the program being tested was in front and every piece of it was NVDA's own wording or the page's. It covered the Edit text dialog, the text's new looks, timing that waits for the learner, leaving out Back and Next, the grey picture box, a quiz board filled from a spreadsheet, and, in Edge, a PowerPoint deck's slide with a title off the slide and the Show next item button.

**How it went.** The first editor run had other programs (a recorder test window, a browser and two other tools) take the front of the screen again and again, so a third of its lines were thrown away and two steps went wrong; it was run again until none were. The first run also sent the letter S where a script meant Space (a mistake in the script, found because a probe after the key said nothing had changed), and a text-decoding mistake in the harness stopped the first Edge run before it started. None of these is the editor's. The speech below is from the runs where the front was held the whole way.

| What was done | What NVDA said | Verdict |
| --- | --- | --- |
| Edit text... button in Properties | "Edit text..., button, Edit the words with bold, italic, underline, lists, headings and links (F2, or double click the text)" | works |
| Enter: the dialog opens | The dialog's name and its first paragraph (twice, as for every dialog), then "Text, edit multi line, list", and the line the cursor is on | works |
| Shift+Tab from the box, then the arrow keys, End | "Bold, toggle button, not pressed"; "Italic, toggle button, not pressed"; "Underline..."; "Link..., button"; End: "Shallower level, button"; Right wraps to Bold. The toolbar's own name ("Formatting") is not said when focus enters it. | works (the missing name is cosmetic and open: NVDA does not announce a toolbar when focus comes into it from the text) |
| Space on Bold, with words chosen | "Bold on. // pressed"; again: "Bold off. // not pressed"; Italic the same | works (after the fix below) |
| Ctrl+B in the text | "Bold on." and "Bold off." | works (after the fix below) |
| Kind of paragraph, arrow keys | "Heading 1. // Heading 1", "Heading 2.", then back "Heading 1." and "Paragraph.", the keyboard staying on the drop-down | works (after the fix below) |
| Ctrl+K, address, Enter | "Type the address that \"my school, my publishers, or the Romance\" goes to. // Web or mail address, edit, A link works with a web address... https://example.org, blank"; then "Link to https://example.org/page made." | works |
| Escape with changes | "You have changed the text. Press Cancel to throw the changes away, or Done to keep them." | works |
| Edit the HTML instead | "Edit the HTML instead, button, collapsed"; Enter: "expanded"; Tab: "HTML, edit multi line, Only paragraphs, headings, lists..."; Enter on the disclosure: "collapsed" | works |
| Done | "Text updated. Press Control Z to undo.", and focus is back on Edit text... ("Edit text..., button...") | works |
| Words start, Shrink the words to fit the box, Deeper list levels | "Words start, combo box, At the top of the box, collapsed"; Down: "In the middle of the box // Words sit in the middle of the box"; "Shrink the words to fit the box, check box, checked"; Space: "not checked // Words keep their size, and run past the box if there are too many"; again: "checked // Words shrink to fit the box, to no less than half their size or 12 pixels"; "Deeper list levels, as a percent of the level above, spin button editable, 100" | works |
| Timing: Appears, Item number | "Appears, combo box, When the learner shows the next item, collapsed"; "Item number, spin button editable, The learner has a button, Show next item... 2"; Up: "Picture 7: Appears when the learner shows item 3, then stays" | works |
| Leave out Back and Next, Space | "Leave out Back and Next on this slide, check box, checked // Back and Next are left out of this slide. Nothing on it goes to another slide yet, so a learner would be stuck: add a button with a rule that goes to a slide. // Problems: 79 errors"; again: "not checked // Back and Next are shown on this slide again." | works |
| The grey picture box | "Picture box, grouping, A person from your cast..., button, Put one of the people in the cast, with their pose, in this box"; Enter: "Which picture, grouping, Maya Reyes, Team lead. Their own picture., radio button, checked, 1 of 3"; Down: "Alex Kim, Analyst on Maya's team..., radio button, checked, 2 of 3"; "Use this picture, button"; Enter: "Alex Kim is in the box. Read its alt text in the Properties panel, and change it if it is not right.", then focus on "Alt text, edit multi line, Required unless the object is decorative..." | works |
| A quiz board from a spreadsheet | The game's dialog says its name and "...You can also fill it from a spreadsheet of your questions."; focus starts on "Choose a spreadsheet (CSV)..., button" with the columns read as its description; Tab: "Save a sample spreadsheet..., button"; Enter: "Saved the sample spreadsheet as ...sr-sample.csv. Open it in Excel or Google Sheets, replace the example rows..."; choosing the file: "This adds 11 slides... // Quiz board questions: this fills the game: 3 categories with 3 questions each, so 9 tiles: Colour, Keyboard and Words."; Tab: the title (read with its words, "Quiz board questions", selected); Tab: "Add game, button" (the greyed sizes are skipped); Enter: "Added Quiz board: 11 slides... filled from your table..."; Undo: "Undone" | works |
| In Edge: a slide whose title is off the slide | Opening the slide says "A Quick Disclaimer, region, A Quick Disclaimer, heading level 1, A Quick Disclaimer, graphic, list, The opinions expressed..." (the title first, then the picture, then the words); focus on the title: "A Quick Disclaimer, heading level 1"; on the picture: "A Quick Disclaimer, graphic" | works: a screen reader has the heading, and the picture keeps its alt text |
| In Edge: Show next item | "Timing, region, Show next item (1 of 7), button"; each Enter: "Item 1 of 7 is showing: Dow Jones Headline..." to "Item 6 of 7..."; the last: "unavailable // Item 7 of 7 is showing: Unilad... That was the last."; one more Enter: nothing said; Tab on: "Pause timing, toggle button, not pressed" | works |

**Problems found, and what was done**

| # | Where | What was said | What should have been said | How bad |
| --- | --- | --- | --- | --- |
| 14 | Edit text: Kind of paragraph | After the first arrow key: "Heading 1. // Text edit multi line, heading level 1..." because the drop-down applied the kind and moved the keyboard into the text, so the next arrow key moved in the text and said nothing | The kind, with the keyboard staying on the drop-down so the next key steps on | awkward. Fixed: the paragraphs the cursor is in are given the new tag directly and the keyboard stays (a list item is told it is not a paragraph). Checked again: "Heading 1.", "Heading 2.", "Paragraph." |
| 15 | Edit text: Ctrl+B, Ctrl+I, Ctrl+U | Nothing | "Bold on." | awkward. Fixed: it is said once the browser has done it. |
| 16 | Edit text: a toolbar button used from the keyboard | (found by reading the design against the speech, not heard) the keyboard was taken back into the text, so its state ("pressed") was never said | "Bold, toggle button, pressed" where the author is | awkward. Fixed: the button keeps the keyboard when it was used from the keyboard; a mouse click still leaves it in the text. Checked again: "Bold on. // pressed". |
| 17 | Edit text: the toolbar | "Bold, toggle button, not pressed" with no word of the toolbar | "Formatting toolbar, Bold..." | cosmetic. Open: NVDA does not say the toolbar when focus comes in from the text. |

**What it could not tell.** Browse mode (reading the page with NVDA's own keys) was not tried, so the off-slide title was heard through the slide's region being read out when it opens, and by focusing it, not by arrowing down the page. Narrator was not tried. A person who uses NVDA every day may find more.

## A third NVDA pass, on text that comes one paragraph at a time and on Show next item beside Next (run 2026-10-23)

NVDA 2026.2 (the same portable copy, voice off, log read), run by Claude with the author away, by the same method as before and the same filter, on the published Chapter 2 deck in a copy of Edge with its own profile folder. The raw log was deleted when each run ended.

| What was done | What NVDA said | Verdict |
| --- | --- | --- |
| Tab along the navigation row on a slide with items | "Show next item (1 of 2), button"; "Next, button"; "Accessibility, button, collapsed" | works: Show next item now comes before Next |
| Enter on Show next item, a text with two paragraphs | "Item 1 of 2 is showing: George Gerbner noted, corporations can almost act as ... a private "ministry of culture."." then "Item 2 of 2 is showing: Major corporations supply ... information today.. That was the last." | works; the doubled full stops were cosmetic (problem 18, fixed) |
| Enter once more | nothing | works (the button stays, and says nothing when all is shown) |
| Four paragraphs that go away, one Enter each | "Item 1 of 4. Cambridge Dictionary "a way of behaving ..." went away." ... "Item 4 of 4. Forbes "targeting or denouncing ..." went away. That was the last." | works |
| Tab along the navigation row on a slide with no items | "Next, button"; "Accessibility, button, collapsed" (after Back) | works: no Show next item there |

**Problems found, and what was done**

| # | Where | What was said | What should have been said | How bad |
| --- | --- | --- | --- | --- |
| 18 | The course: an item that is a paragraph | "... today.. That was the last." (two full stops), and "...clauses., Also, ..." when two paragraphs came together | One full stop, and no comma after a full stop | cosmetic. Fixed: `itemSentence` in `player/src/timeline.ts` adds a full stop only where there is none, and joins a name that ends a sentence with a space. |
| 19 | The editor: Paragraph by paragraph, the button | (found by a check of the real window, not heard) after Show one paragraph at a time or Show all the text together the keyboard fell to the top of the page, because the panel was drawn again with the other button | The keyboard staying on the button, now named for the other choice | awkward. Fixed: both states of the button share one key, so focus goes to the new one. Checked again in the real window. |

**What it could not tell.** The editor half was not run with NVDA: the author's own copy of the editor was open, and the harness tells windows apart by program name only, so it could not be sure which window it was listening to. The labels of the new section were read from the page instead (each paragraph is a group named by its words, each box has a label). The steps that Tab through the Timing controls heard nothing in the log, though the page was in the right state (Pause timing, Show everything now and Turn off animation, in that order): that is the test, not the course, and was not run again. Narrator was not tried: its speech cannot be read by a program, so it needs a person.

## When it is done

The roadmap item "ATAG Part A pass" stays open until the whole editor has been covered. When this baseline is finished, change the roadmap note to say exactly which patterns were covered with which screen readers, and list the open problems.
