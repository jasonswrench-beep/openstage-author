# Screen reader pass on the editor

This is a script for testing OpenStage Author with a screen reader, and the place to write down what happened. Nothing in it has been run yet: every result line below is empty on purpose. Please fill them in with exactly what the screen reader said, not a summary.

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
| Version | | |
| Speech settings that matter (rate, punctuation level, "report" options) | | |
| Date and tester | | |

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
| NVDA | | | |
| Narrator | | | |

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
| NVDA | | | |
| Narrator | | | |

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
| NVDA | | | |
| Narrator | | | |

### 4. The Properties panel

**What to do.**
1. Choose a text object and Tab through the Properties panel. Listen to each field.
2. Change a value (for example the object's name) and press Tab.
3. Do the same for a shape and for an image.
4. Find a button that is unavailable (for example **Move earlier** when only one object is chosen) and move to it.

**A good result.** Every field has a spoken label, and the same label is not read twice. Changing a value keeps your place and does not jump focus. A control that is unavailable can still be reached and says it is unavailable.

| Screen reader | What it said | Verdict | Notes |
| --- | --- | --- | --- |
| NVDA | | | |
| Narrator | | | |

### 5. Dialogs

**What to do.** For each of these, open the dialog, Tab around inside it, press Escape, and check where focus lands.
- **New project**, **Add slide** (the layout picker), **Theme**, and the **Add** menu pickers (a shape, a question, an interaction).
- **Variables**, **Timing** and **Narration** (the toolbar buttons).
- **Publish**: start a publish and then cancel it.

**A good result.** Focus moves into the dialog and is announced with its name. Tab stays inside it. Escape closes it and focus returns to the button that opened it. For Narration and Publish, progress and the Cancel button are announced. You are never trapped.

| Dialog | Screen reader | What it said | Verdict | Notes |
| --- | --- | --- | --- | --- |
| New project | NVDA | | | |
| New project | Narrator | | | |
| A picker (layout or Add) | NVDA | | | |
| A picker (layout or Add) | Narrator | | | |
| Variables | NVDA | | | |
| Variables | Narrator | | | |
| Timing | NVDA | | | |
| Timing | Narrator | | | |
| Narration | NVDA | | | |
| Narration | Narrator | | | |
| Publish and cancel | NVDA | | | |
| Publish and cancel | Narrator | | | |

### 6. Announcements

**What to do.** Move an object, resize it, undo, redo, delete, save (Ctrl+S) and make narration audio. Listen after each.

**A good result.** Each announcement is heard once, in plain words, and does not interrupt typing in a field.

| Screen reader | What it said | Verdict | Notes |
| --- | --- | --- | --- |
| NVDA | | | |
| Narrator | | | |

### 7. The Timing list

**What to do.**
1. Open the **Timing** button in the toolbar.
2. Move through the table. Change a time with the keyboard.
3. Close it.

**A good result.** It reads as a table or a list with named fields, and each change is announced.

| Screen reader | What it said | Verdict | Notes |
| --- | --- | --- | --- |
| NVDA | | | |
| Narrator | | | |

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
| NVDA | | | |
| Narrator | | | |

**Answer these three questions too.** They decide how a multi-track timeline for recordings should be built.

| Question | NVDA | Narrator |
| --- | --- | --- |
| Do you have to switch to focus mode to use the grips, or does the screen reader switch by itself? | | |
| Is the value in words read ("0.3 seconds after the slide opens"), or only the number? | | |
| When focus moves from one row to the next, is the row's name (the group label) read? | | |

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
| NVDA | | | |
| Narrator | | | |

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
| NVDA | | | |
| Narrator | | | |

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
| NVDA | | | |
| Narrator | | | |

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
| NVDA | | | |
| Narrator | | | |

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
| NVDA | | | |
| Narrator | | | |

## Problems found

| # | Pattern | Screen reader and version | What was said | What should have been said | How bad |
| --- | --- | --- | --- | --- | --- |
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |

How bad: **blocks a task** (you could not do it), **awkward** (you could, with difficulty or confusion), **cosmetic** (a small oddity).

## What was not covered, for a second round

These editor features were added after this script was written, and are not in the patterns above: choosing several objects and the Line up and Space out buttons, locking, grouping, copy and paste, the question editors in the Properties panel, snapping (which is for the pointer only), the Group, Duplicate slide and layer buttons, the audio description box on a video, the Characters dialog and its library of people (each person's description beside their picture, Choose buttons named for the person and the pack, Add a character pack, and Remove with a second press), the pose dialog (a check box for each pose, with its picture and words) and the Pose beside the line box in the scenario editor, the Shape or bubble picker with its bubble choices and the Bubble and Tail boxes in the Properties panel, the background picker (a list of pictures in groups, each with a button named for it) and the Background picture and Remove background picture buttons, the icon picker (a grid that moves with the arrow keys), the button picker and the button Look and icon boxes, the ready-made lesson slides in the Add slide picker, the scenario editor in the Properties panel, and the Choose by playing dialog and the timeline groups for objects that follow a video or audio clip. (Looks are pattern 10.) The AI services dialog (a password box with Show, a box that is the author's yes, Check the key, the plugin switches), the question asked before a service is sent anything for the first time (its **Not now** button has the focus), the **Make with AI** tab of the Assets dialog (how a made picture's alt text is asked for), and the notes under the Voice list that say where a voice is made and what it cannot do.

## When it is done

The roadmap item "ATAG Part A pass" stays open until the whole editor has been covered. When this baseline is finished, change the roadmap note to say exactly which patterns were covered with which screen readers, and list the open problems.
