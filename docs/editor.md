# The editor

`editor/` is a Tauri app. The Rust side (`editor/src-tauri`) does only what a web page cannot:
read and write the project folder, run the validator and the publishing tool, reach the stock-media sites, show a
folder picker. Everything the author
sees is TypeScript in `editor/src`, and the canvas draws slides with the same `StageRenderer` the
published player uses (`player/src/stage.ts`). Never fork that renderer.

Run it by double-clicking `OPEN EDITOR.bat`. The first run builds it.

## What it does

Make a new project (a title, an author, a language and an empty folder, which gets one slide with the title on it) or open an existing project folder. Choose a slide and a layer. Choose an object from the Objects list or on the
canvas. Move and resize it with the mouse, the arrow keys, or typed values. Edit its name, alt text,
role, tab order and decorative setting. Change reading order. Undo and redo. Save. Preview the course in a
browser and publish it as a SCORM package. A live Problems
list runs the real validator on unsaved work and jumps to the object concerned.

**Building a course.** Add, delete, rename and reorder slides. Add, rename and delete layers. Add a
text box, button, shape or image to a layer, and delete objects. Edit a text object's words and
style (paragraph or a heading level), a button's label, font size and colours. Images are copied
into the project's `assets/images` folder when added, and are left with empty alt text, so the
validator flags them until the author writes it or marks them decorative.

**Duplicating a slide, and duplicating and reordering layers.** **Duplicate slide** (under the Slides list, and Ctrl+D while you are in the
list) puts a copy straight after the slide, in the same scene, and selects it. The copy is called "name copy", then "name copy 2". Everything is
copied as it is: the layers, every object in the same place, locks, groups, timing, animation, narration (the copy reuses the audio already made, until you
change a word) and the slide's layout, background and automatic advance. The layers keep their ids, because a layer id only has to be unique on its
own slide, and the objects get new ids, because those are unique across the project and name their narration. Rules between the slide's own
objects and layers work on the copy. An input saves to variables of its own, so the copy does not overwrite the original's answers, and the rules
on the copy that read those answers read the copy's. Rules that jump to other slides are unchanged, and rules on other slides that jump to this
one still go to the original. Each question on a copied slide counts toward the score again, and you are told. **Duplicate layer** (on the layer
bar above the canvas) puts a copy of the layer you are editing and what is on it straight after it, and you are now editing the copy. A rule inside the layer that points at the layer itself, or at one of its objects, points at the copy; a rule that
points at another layer still does. Nothing shows the copy yet, because a layer appears only when a rule shows it, so you add that rule. A
question on a copied layer brings feedback layers of its own. The base layer can be duplicated too, into an ordinary layer. **Earlier** and
**Later** on the same bar move the layer you are editing in the layer order (the base layer is always first). A later layer is drawn in front of an
earlier one where they overlap, and is read after it. Each is one step for Undo, and the editor says what happened and where the layer is now.

**Duplicate, copy, cut and paste.** Under the Objects list: **Duplicate** (Ctrl+D) puts a copy of the selected object a little to one side,
on top, and straight after the original in reading order, and selects it. **Copy** (Ctrl+C) remembers the object and **Cut** (Ctrl+X)
remembers it and removes it; **Paste** (Ctrl+V) then puts a copy on the layer you are on, which can be on another slide, where it lands in
the same place (or a little to one side if it would land on top of the original or an earlier paste). Each is one step for Undo. The
shortcuts work from the canvas and the lists but not while you are typing in a box, so Copy and Paste there stay the box's own. A copy is
a separate object with its own id and its own rules. A copy of an input saves to variables of its own, so it does not overwrite the
original's answers. A copy of a quiz question has feedback layers of its own and counts toward the score as another question. A rule that
points at a layer, a video or an object on the slide the original is on is left off a copy pasted onto a different slide, and you are told
how many. A name that is already taken becomes "copy", then "copy 2". Alt text is copied, never made up, and for a picture, video,
audio, video link or file you are reminded to check that it still fits. Pasting onto a slide with a different background reminds you to check
the text is still easy to read. What was copied belongs to the open project: it is forgotten when another project is opened, because a
picture or file in one project is not in another. Duplicate, Copy, Cut, Paste and Delete work on everything selected (see the next paragraph).

**Choosing several objects, and lining them up.** The first selected object is the main one; the others are chosen along with it. On the
canvas, **Shift or Ctrl and click** adds an object or takes it out, and **dragging a box across empty canvas** selects every object it touches
(a click on empty canvas clears the selection). **Shift and Page Down** or **Shift and Page Up** add the next or previous object in reading
order, and **Ctrl+A** (or the **Select all** button under the Objects list) selects everything on the layer. In the Objects list, Ctrl and
click or Ctrl and Space adds or removes the item, Shift and click or Shift and the arrow keys select a range from where you began, and a
plain click or Enter chooses one object alone. With several selected, each selected item in the list is a pressed button, so a screen
reader says which are chosen, and each object is outlined with a dashed line on the canvas. There are no resize handles then, because a
handle could only resize one of them: Alt and the arrow keys say so, and sizes are typed in Properties one object at a time. (The one
exception is a whole group, which is resized as one: see Grouping.)
Dragging any selected object, or the arrow keys, moves them all together (one Undo step), and clicking one of them without dragging narrows the
selection to it. The Properties panel then offers **Line up** (Left, Centre, Right, Top, Middle, Bottom) and **Space out evenly** (Across, Down,
which needs three or more; the outermost two stay put). Line up lines the objects up with each other, changes only where they sit and never
their sizes, and is one Undo step. With one object selected, the same Line up buttons are in its properties and line it up with the slide.
A rotated object is lined up by the box it would have if it were not turned. Reading order is for one object at a time, so Move earlier and
Move later are off while several are selected. Everything other than the shared actions (text, colours, alt text, rules, timing, narration)
is changed on one object at a time, so nothing about alt text or the other accessibility fields is ever changed for several at once.
The exceptions are **Timing** and **Animation**, which the panel offers "for all" the selected objects: a value set there is set on every one of
them as one Undo step, a field is blank when they differ, and an object that cannot take it (an object with no narration cannot appear after its
narration starts) is left as it was, with a message saying so.

**Snapping.** When you drag an object, a group, or a resize handle with the mouse or a finger, it jumps to line up with the slide's left edge, middle
or right edge, top, middle or bottom, and with the same lines of the other objects on the layer, when it comes within 8 pixels of the screen of one. A dashed
guide line shows each line it lined up with, and goes when you let go. It never snaps to the objects being dragged themselves, and when resizing only the
edges that move jump. The **Snap** button under the canvas switches it on and off for good (it starts on, and the choice is kept on this computer, not in
the project), and **holding Alt** while dragging turns it off for that drag. Snapping is for the pointer only: the arrow keys move by exactly the step they
say, and **Line up** in the Properties panel (and typed places) give a keyboard the same results, so nothing depends on it. A locked object cannot be
dragged, but other objects snap to it.

**Grouping.** Group ties two or more objects together so they are chosen, moved, resized, copied and deleted as one. **Group** (Ctrl+G),
**Ungroup** (Ctrl+Shift+G) and **Select group** are under the Objects list, and in the Properties panel while several are selected. On the
canvas, clicking any object in a group chooses the whole group (Shift or Ctrl and click adds or removes the whole group, and a box dragged across part
of a group takes all of it), and **Alt and click** chooses just that one object. From the keyboard, the Objects list and Page Down still choose one object
at a time, so any member can be reached and edited alone, and **Select group** adds the rest of its group. A group shows as one solid box with resize
handles; the objects in it keep their dashed outlines. The Objects list says ", in a group of 3". Dragging or the arrow keys move the group; dragging a
handle (or Alt and the arrow keys, or the group's X, Y, Width and Height in Properties) **resizes the group as one**, scaling every object in it so each
keeps its place and size relative to the rest. Only the boxes scale: a text object's font size does not change. **Line up** and **Space out
evenly** treat a whole group as one object, and say "items" when a group is involved. Copying a whole group gives a group of its own, and copying only
some of a group's objects gives ungrouped copies (and says so). Grouping and ungrouping are one Undo step each. A group is flat: grouping objects that
are already in a group takes them out of it first, and a group left with one object is dissolved. If one object in a group is locked, the whole group is
held: it will not move or resize, and the editor says why. Groups are for editing only: the course looks and behaves the same, and the validator only
checks that a group is on one layer (`group-split`) and has two or more objects (`group-single`). The tag is saved in the slide file (format 0.17.0).

**Locking.** Lock an object so it is not moved, resized, rotated or deleted by accident, for example a background panel or a title you have
placed exactly. **Lock** (Ctrl+L) is under the Objects list, and says **Unlock** when everything selected is locked; the **Locked** box in an
object's Position and size does the same for one object. A locked object shows ", locked" in the Objects list and a dotted outline with no
handles on the canvas. The lock is saved with the project (format 0.15.0), so it is still there next time. A locked object refuses dragging,
the arrow keys, Alt and the arrow keys, typed X, Y, width, height and rotation, Cut and Delete, and the editor says why. It does not stop
anything else: you can still select it, edit its text, alt text, rules, timing and narration, change its stacking order, copy it, and duplicate
it (the copy is not locked). With several selected, moving, lining up and spacing out leave the locked ones where they are and say how many stayed,
and Delete removes the others and keeps the locked ones selected so you can unlock them if you meant to remove them. Change layout and Reset layout are
commands you ask for and can still rearrange a locked object. The published course ignores locks.

**Audio description.** A video's Properties have an **Audio description** box for a learner who cannot see the picture. **Add description** adds one at a time
in the video (the first at 0:00, then five seconds after the last), and each has the seconds into the video, **What the picture shows** (the words, which
you write: the editor never fills them in), **Pause the video while this is spoken**, and a **Voice** with the usual narration controls. **Use the description
as the voice** writes the voice's words from the description (they are then the voice's own, so changing the description later does not change them),
**Give every description a voice** does it for all that have words and no voice, and each description is a line in the Narration list, named by its
video and its time, so its audio is made like any other (the speech tool finds it under the key `<video id>/<description id>`). A description with no
voice can only be read, which the Problems list says. The Objects list says ", described" for a video that has any. Descriptions are kept in the order
they happen. The course shows the **Audio description** button beside the video only when there is a description. If everything important on screen is
already said in the narration, no description is needed. For a video made from a recording, **Describe what is on the screen** (in the recording window, once
the video is on a slide) adds one description for each text overlay, each shape or arrow that was given a description, and each zoom (what it shows), at the time
it happens, already with a voice that says its words, as one undo step (`Model.describeScreen`). That is the audio route for text a learner reads in a recording (story D7).
Pressing it again adds nothing twice, and it never touches descriptions the author wrote. If the recorded voice already says one of them, delete it. It is only offered right
after the video is put on the slide, because the editor does not yet remember which recording a video came from (that belongs with provenance, request OS-14, in Capture's Phase 7).

**Hotspots.** **Add > Hotspot (a clickable area)** puts a transparent button on the layer, to place over a picture (a screenshot, say). It shows as a blue
dashed box in the editor only; a learner sees nothing but the picture and, when they Tab to it, the ordinary focus ring. Its name is the Alt text field
and starts empty, because the editor never fills in a name: write what it is, for example "The Save button". It has to be at least 24 by 24 pixels, and the
editor starts it at 200 by 100. Rules work as on a button, and the Problems list says if it has no name or is too small.

**Provenance.** A slide or object that the Capture module made keeps a record of the recording and step it came from. Nothing in the editor changes it, and
every edit keeps it. A copy you make (Duplicate, Paste or Duplicate slide) is yours, not the recorded step, so it has none.

**Shapes.** Add a rectangle, rounded rectangle, ellipse, triangle, diamond, arrow or line, and change
the shape later. Fill and outline colour and outline width are editable. New shapes are decorative,
so they are hidden from screen readers; untick "Decorative" and write alt text if a shape carries
meaning.

**A background picture.** With nothing selected, the **Design** box has **Background picture...**, which opens the packs of backgrounds: offices, meeting and training rooms, reception areas, corridors, kitchens and outdoor entrances come with the program, each picture beside a description of it. Choosing one puts it behind everything on the slide. It is a decorative picture named *Background picture*, locked so a click on the slide does not move it (Unlock it in the Objects list to move or resize it), and the slide's own background becomes the picture's average colour so the Problems list can still judge your text and text that follows the theme stays readable. The same picture on another slide is the same file. **Remove background picture** takes it off. Words on a busy picture can be hard to read in places: put them in a text bubble or on a panel.

**Sharing slides, and taking in slides someone shared.** In the Slides panel, **Share slides...** saves slides you choose as one file (ending `.osset`) with what they need: their variables and rules, the people of a scenario, the pictures and sounds and where they came from. Give the file to someone; they choose **Add slides from a file...**, see who made it, what it is for and what others may do with it, and **Add** puts the slides after the one they are on, as one step to undo, with ids and variables of their own, so a game added twice does not share what it remembers. A file that is not a good set is refused before anything is changed, in words. `docs/slide-sets.md` describes the file and everything it is refused for.

**Showing a value that changes.** A text box's **Show a value in the text** list puts a value in the words: the points earned so far, the points possible, the percent, the questions finished, right, or in the course, or any variable of your own. **Put it in the text** writes it where the cursor is as `{{Name}}`, for example `Score: {{$score}}`. While the course is played the number is put there and changes when it changes. On the slide in the editor it shows the variable's starting value, or 0. If the text shows a value, **Say changes aloud** makes it a live region, so a screen reader says the new value (good for a score, which changes now and then; not for something that changes all the time). Renaming a variable changes every text that shows it, in the same Undo step, and a variable a text shows cannot be deleted. The Problems list names a `{{Name}}` that matches nothing.

**Questions from a spreadsheet.** In the Slides panel, **Questions from a file...** reads a table of questions saved as a CSV file (columns Type, Question, A to H, Correct, and optionally Points, Attempts, Feedback if right and Feedback if wrong) and makes a slide for each question after the slide you are on, with its feedback layers, as one step to undo. It can make them a question bank and mix their answers in the same step. **Save a blank table to start from...** writes a template with an example of each kind. A row with a mistake is left out and the dialog says which row and why. See `docs/question-import.md`.

**Question banks.** In the Slides panel, **Question banks...** opens a dialog for making banks: a bank holds the slides from one slide to another, shows each learner some of them (it starts by showing half), and can mix the order. The picks are made when a learner begins and kept if they come back; the score, Back and Next and the "Slide 3 of 5" label all follow what they were shown. A slide in a bank says so in the Slides list. Deleting a slide takes it out of its bank, and a copy of a slide in a bank (Duplicate slide) joins the bank, right after the original. Put one question on each slide of a bank, make them worth the same points, and jump to the slide before a bank rather than into it; the Problems list warns about each. A bank is not carried in a shared set of slides.

**Shuffling answers.** A multiple choice or multiple response question has **Show the answers in a different order to each learner**. The editor always shows your order; a learner sees theirs, the same one each time they come back. Do not write answers that depend on where they stand ("A.", "All of the above").

**A timer.** **Add > Interaction, scenario or timer... > Timer** puts a countdown on the slide (30 seconds to start). In its Properties you set the seconds (5 to 3600), the words above the clock, and how many seconds its **Add time** button gives (0 takes that button away). It starts when its layer is shown, and a learner can pause it with Pause timing, add time, or turn it off with **Turn off the timer**, which cannot be removed: a time limit nobody can get out of is a barrier. Turning it off also stops every later timer in that visit. In its **Rules** box a rule happens **when the time runs out**: show a layer, go to a slide, change a variable. To stop the clock when a question is answered, add a rule to the question that does **Stop a timer**. The Problems list warns about a timer with no rule for running out. A screen reader is told at a minute, thirty seconds and ten seconds to go, and when time is added or up; it is not told every second.

**A person from the library on a slide.** **Add > Image, video, audio or file... > A person from the library** opens the library of people, then asks which picture of them: their head and shoulders, or one of their poses. The picture is copied into the project (once, however many times it is used), credited, and put on the slide as an image named for the person and the pose. Its alt text is filled in from the library, and the editor says so: read it, change it if it is not right, or mark the picture decorative if it only decorates. (Nothing is decorative until you say so.) Put a person over a background picture and a speech bubble beside them, and you have a scene: `examples/conversation.osproj` is two slides made that way (a background from the offices pack, Lisa and Ken from the people pack, a speech bubble and a thought bubble each with a voice), and it is a good one to open and change.

**Where the words sit.** A text box's **Words sit** box puts its words on the left (how text starts), in the centre or on the right. A new text bubble starts in the centre. Justified text is not offered, because the uneven spaces are hard to read.

**Speech and thought bubbles.** **Add > Shape or bubble...** offers four: a speech bubble or a thought bubble, each either **with words** (text you type in) or **empty** (a plain
picture, decorative like a shape, to put your own words or a picture over). A bubble with words is a text object: type its words in the **Text** box as for any text, and
set its **Bubble** (none, speech or thought), its **Tail** (on the left or the right, whichever side whoever is speaking or thinking is on), the **Bubble colour**, **Outline colour**
and **Outline width** in the Properties panel. Any plain text box can be made into a bubble with its **Bubble** box, and made plain again (the bubble's colours go with it; Control Z
brings them back). A new bubble has the theme's panel colour and a quiet outline, and its words are in the theme's text colour, so it reads well on any slide and keeps reading
well if the theme changes; the Problems list checks the words against the bubble colour you choose. The tail stays the same size however you stretch the bubble, and where the
page reflows to one column the bubble becomes a plain rounded box with the same colours.

**Colours.** Wherever a colour is needed there is a palette of 24 named colours (choose one with the
mouse, or with the arrow keys and Enter), the system colour picker for any other colour, a hex box
for anyone who has a code, and a button for "none" or "default". For text and buttons the panel
also says how readable the text colour is on what is behind it, against WCAG AA.

**Rules.** Every object has a Rules section in the Properties panel. A rule reads "When ..., do ..., only if
...": *when* the learner presses a button, checks a quiz answer, the slide opens or closes, a video or audio
finishes, or any variable changes (an object only offers the events it can cause); *do* go to a slide, show or
hide a layer, set a variable, add to a number variable (to count tries; "add this much", and a negative number takes away), or play or pause a video or audio; and any number of conditions, which all must
hold, such as "choice is The short path" or "score is at least 3". The targets are lists, not typed: the
slides, the layers of this slide, the variables, the videos and audios on this slide. Changing the action picks
a target that suits it, and if there is none (no layers yet) the editor says what to add first. When a
variable is one an input saves to, a condition or "set to" value is chosen from that input's own answers (for
example "The short path" or "Agree (4)"), so nothing has to be typed that could be wrong. Rules run in order
from the top and a rule that goes to another slide ends the list, so rules can be moved earlier and later.
A rule that happens when the learner presses something is saved as a click and a key press together, so it
works without a mouse. A rule can belong to any object, and for "the slide opens" or "any variable changes"
it does not matter which. To branch on a survey: add the input, add a Continue button, and give the button one
rule for each path, each with a condition on the input's answer. Rules the editor cannot show (a click with no
key press to match, or a key press with no click) are kept as they are and marked as such.

**Results and certificate.** "Results or certificate..." in the Add menu opens a picker. **Results** shows the
learner their score and whether they passed, filled in from the quiz, and can list each question and how it went. In
its Properties section you set the heading, what is said after "You passed." and after "You did not reach the pass
mark.", and whether to list the questions. **Certificate** is for a learner who passed: they type their own name
(it is never taken from the LMS), then print it or save it as a PDF. You set its title, the line before the name, the
line after it, an optional "issued by", and whether the score and the date are shown; the course title is added for
you, and a line left blank is left out. Both start with no alt text, which you write, and both want a slide after the
quiz questions. On the canvas each shows an example, because the real thing depends on a learner. The Problems list warns
if the course has no quiz, since neither can then mean anything.

**Course settings.** With nothing selected, the Properties panel has a Course section. "Complete when" is the
setting that decides when the course counts as complete: **the learner has seen every slide**, which is how every
course worked before, or **the learner reaches the last slide**. Every quiz has to be finished either way. Choose the
last slide whenever a rule can send some learners past some slides, because with "every slide" they would never
complete the course. The Problems list warns about that case, and undo and redo cover the choice.

**Variables.** The Variables button lists the project's variables, each with its kind (text, number, or true
or false), what it starts as, and how often it is used. Add one with a name and a kind, rename it, change its
starting value, or delete it if nothing uses it. Inputs make their own variables, and take them away again when
the checkbox, statement or pair that saved to one is deleted (see Questions, inputs and surveys).

**Narration.** Any object can speak. In the Properties panel, the Narration section holds the object's script: what
the learner hears when its slide opens, in reading order. Writing the first words makes narration, in the voice and
speed of the narration before it, so a course keeps one voice; clearing the script removes it (undo brings all of it
back). Once there is a script the section also has a Voice list, grouped by language ("Heart, woman"), a **Hear this voice** button that plays a short sample of the voice shown (one fixed sentence, never the author's words; the
same button cancels while the sample is being made and stops it while it plays; the first sample of a voice is made on request and kept on this computer, so hearing it again is quick and free; for a service's voice the
first one is one short request to the service, which may charge the author, as the note under the button says), a Speed (0.5
to 2, where 1 is normal), and a Pronunciations list for words the voice gets wrong, each a word as spelled in the
script and its IPA, which is checked as the validator checks it. The captions and the transcript come from the
script, so they always match what is said.

The audio is made by the voice's own engine, never in the editor itself: Kokoro on this computer, a voice plugin, or an internet service the author has a key for (**AI services**, below). It is kept in the
project's `.cache/narration`, each file named by a hash of the script, voice, speed, language and pronunciations. So
the editor always knows whether an object's audio exists: change a word and the audio is out of date; undo it and it is
back, because it is found again by its words. The Properties section says whether the audio exists and how long it is,
and whether the captions are timed to the spoken words; with audio, a "Listen to the audio" button plays it there. The
**Narration** button in the toolbar opens a dialog listing every narrated object, slide by slide in the order they play,
each with its audio status, a "Go to" button, and "Make audio" (or "Make all missing audio" for the lot). It works from the
project as it is on screen, saved or not, and can be cancelled; the first time can take a minute or more for each object.
If no speech engine is set up the dialog says so and still lists everything (transcripts and captions work without audio).
The engine is installed separately (`docs/narration-setup.md`); its Python is named once in `local-settings.bat`
(`OPENSTAGE_KOKORO_PYTHON`), which the `.bat` files read. **Clear unused audio** in the Narration dialog deletes the audio that no narration names any more (it is left behind when a script, voice, speed or language changes, and is found again if the change is undone), after asking, and says how much space it frees. It asks you to save first, so audio the saved version uses is not cleared. Publishing also makes any Kokoro audio that is missing. It never sends anything to a service: a narration whose voice is a service's
is published with the audio already made, or without audio.

**AI services.** The **AI services** button opens a dialog for OpenAI and for voice plugins (docs/ai-generation.md, docs/plugins.md). For OpenAI: the key
(a password box with Show), a box that is the author's yes to it being sent their words (**Allow OpenStage to send ...**), **Check the key**,
and under *models (advanced)* the model names. Voice plugins are listed with a switch each, their licence, and what their author says about the
internet; **Open the plugins folder** shows where they go. **Save** keeps it; **Cancel** and Escape drop the changes. Only a service with a key and a yes has its voices in the lists.
The first time the author makes something with a service they have not said yes to, a question asks, and says what is sent; its **Not now** button has the focus. A voice from a service or
plugin is under its own heading in every Voice list (an object's, an item's, a description's, a character's). Under the list, a note says where the voice is made. A voice that speaks many languages
has a **Language of the script** box (for an OpenAI voice, changing it keeps the audio already made under the new language, since the voice sounds the same; `soundIgnoresLanguage`, the shell command `reuse_narration_audio`). A voice that cannot use pronunciations says so and has no way to add one. If the credits page is off, the note says
that listeners are not told the voice is made by an AI service. The Narration dialog starts with one sentence for each engine (where the audio is made and whether anything is sent),
asks before sending to a service for the first time, and leaves out what the author did not allow.

**Narration of items.** Text should have audio available, so each item of an interaction can speak too: a glossary
term and its definition, the back of a flip card, a tab, a step. In an interaction's Items section each item has its own
Narration box with the same script, voice, speed, pronunciations and "Listen to the audio" as an object, and a
**Use the item's text** button that writes the narration from the item's title and text. **Narrate every item from its
text** does that for every item that has none (items that already have narration are left exactly as they are, and one
undo takes it all back). The words are then the author's to change; they do not follow the item's text if that changes
later, and asking again replaces them. The Narration dialog lists items after their interaction, each by its title with
its own status and "Make audio", and "Go to" lands in that item's script box. In the published course the item speaks
when the learner opens it and has a Listen button; see the format spec.

**Assets.** The Assets button opens a dialog with four tabs. *This project* lists every file the project
keeps (images, video, audio and captions), filtered by kind, with a picture of each image. Selecting one shows
where it is used, where it came from, and buttons to insert it on the slide, edit its credit, or delete it. A
file a slide uses cannot be deleted. Everything listed is included when the course is published, and a
checkbox switches the credits page on or off. *Find media* helps with free pictures, video and sound from the web. **No key is needed to use these sites**:
for each kind (Images, Video, Audio) it has buttons that open Pexels, Pixabay (pictures, and separately its sound effects), Unsplash, Freesound, Free Sound Effects, Mixkit, SVG
Repo and Libreshot in your browser. Download a file there, add it on the *This project* tab with "Add image...",
"Add video..." or "Add audio...", and use Edit credit to record where it came from, so the credits page can name
the creator. Four of the sites can also be searched from inside the editor, if you add that site's own free key
(their programming interfaces ask for one; you get it on their website and paste it into *Settings* once). Without
a key those searches say so and point at the button that opens the site. *Make with AI* makes a picture (OpenAI) from a
description: its shape and quality, then **Make**, which can be cancelled. The file is saved in the project at once, with a credit that says an AI
service made it and the words that made it, and **Insert on this slide** puts it on the slide. Its alt text is the author's to write; their description is offered as a place to start. Each
time costs money, which the service charges; the tab says so. **Edit credit** keeps the record of a made file while it is still called AI-made.

| Searched here, with a free key | Finds |
| --- | --- |
| Pexels | pictures, video |
| Pixabay | pictures |
| Unsplash | pictures |
| Freesound | sounds |

The keys are kept in OpenStage's own settings on your PC and never in a project. Freesound shows only what is free
to use in a course (CC0, and plain Attribution); on the website, check the licence of each sound. Choosing a result shows its creator, licence and length, a pre-listen player for a sound, and "Add to project"
(or "Add and insert on this slide") downloads it into the project and saves its credit. Unsplash is told about
the download, as its rules ask. A service's description of a picture is offered as a starting point for alt
text, but the alt text is never filled in for you. A video from a library still needs captions and a sound
still needs captions or a transcript before the course can be published; the editor says so. Searching and
downloading happen in the program, which can only reach these services. If a service says there have been too
many requests, the editor waits a moment and tries again, or says how long to wait. The dialog is native, its
tabs and lists work by keyboard, and each list is one group of radio buttons.

A file found anywhere else can be credited by hand with Edit credit, which knows the usual places (including
Openverse and Wikimedia Commons), so the credits page names them properly.

**Video, audio and embedded video.** "Image, video or audio..." in the Add menu opens a picker: an image,
a video file or an audio file from your computer, a YouTube or Vimeo video from a pasted address, or the
asset browser. A video or audio clip starts with no name and no captions, so the validator asks for both; in
the Properties panel you choose a `.vtt` captions file, write a transcript, and give it a name in the Alt text
field. An audio clip needs captions or a transcript, a video needs captions. An embedded video takes any of the
usual YouTube or Vimeo address forms, and needs a name, a transcript and a tick in "I have checked that this
video has accurate captions". On the canvas an embed is a placeholder, so editing never loads anything from the
web. The learner needs an internet connection to play it, and the LMS must allow embedded players.

**Captions and the transcript of a video or audio clip.** In the Properties panel, **Write captions...** opens a dialog (`editor/src/captionsdialog.ts`) where the captions are written, timed,
checked and saved, with nothing saved until **Save and use these captions** (or Ctrl+S). The clip plays in the dialog, and the captions in the list are shown over it. Every caption is a labelled
group of fields (**Starts at**, **Ends at**, **Words**, in seconds, or as `1:05`), with **Start now** and **End now** to take a time from the player, and **Delete**; **Add a caption**, **Put the captions in
order of time**, **Break long lines** (to 42 characters) and **Undo the last change to the list** work on the whole list. A caption that is hard to read says why, in words, next to its fields: more than
two lines, a line over 42 characters, faster than 20 characters a second, or on screen for under a second (the numbers are `DEFAULT_LIMITS` in `editor/src/captions.ts`, from published caption guides,
and a warning never stops saving). The captions together are checked for order, overlap and running past the end of the clip. Ways to start: type them; **Make captions from this script** (paste the
words that are spoken: they are cut at the ends of sentences and clauses to fit, and the times are spread over the clip by length, as **estimates**; a note stays in the dialog, and in the saved WebVTT file as a `NOTE`, until
**I have checked the times** is pressed; nothing listens to the voice); or **Bring in a .vtt or .srt file...** (what cannot be read is left out and said). **Copy as WebVTT** and **Copy as SRT** put them on the clipboard for other programs. Anything
that would replace captions that already have words asks first, and can be undone. Saving writes plain WebVTT into `assets/captions` (a new file named from the clip, or the same file again when the clip already
uses one) and points the clip at it; styling or positions in an older file are not kept. **Make a transcript from the captions** puts the spoken words, run into paragraphs, in the transcript box, with what is on the
screen (from a recording: the words of text overlays, shapes and arrows that were given a description, and what each zoom shows) in square brackets where it happens; it is saved with the captions. A transcript with formatting
the editor cannot edit is left as it is. The pure parts (reading and writing WebVTT and SRT, the warnings, the script cutting, the transcript) are `editor/src/captions.ts`, with tests. The shell commands are `captions_read`,
`captions_write` and `caption_source_read` in `lib.rs` (only `assets/captions/<name>.vtt` is reachable, text only, 5 MB at most, replaced whole or not at all). Not built: marking which captions were edited by hand, and a languages choice for each caption track.

  **A description suggested for you** (story D6, format 0.28.0; `altSuggestion`, `Model.useAltSuggestion` and `dismissAltSuggestion`, `calloutalt.ts`). A step's picture in a lesson made from a recording is not given a description until you check the step, but it is now given a **suggestion**: what was proposed
  from the log (the name of what was clicked and the window), with what it was worked out from. In Properties, under Alt text, a group says "A description has been suggested, and not checked yet" and shows it with **Use this description** and **Throw the suggestion away**. Using it puts it in the Alt text box (focus goes there, and you are told to read it against the picture; one undo takes it back);
  writing your own alt text, or marking the object decorative, ends the suggestion. The list of objects says "description suggested", and the Problems panel still asks for alt text and shows the suggestion in its detail. The course never uses a suggestion. In the recording editor, a highlight box, circle or arrow put in at a moment when something named was clicked (within 2.5 seconds before or 1.5 after, in the take the picture shows then) gets a suggestion beside its
  alt text box ("A box around the Save button.", "A circle around ...", "An arrow pointing to ..."), with the click it came from and a button to use it; nothing is put in the edit until you press the button. No suggestion is made when nothing named was clicked near enough.

  **Captions from the voice** (story D3; `editor/src/speechpanel.ts`, `recognition.ts`, `speechaudio.ts`, and `src-tauri/src/speech.rs`; see `docs/speech-recognition.md` and `docs/decisions/0002-speech-recognition.md`). In the captions dialog,
  *Write the captions by listening to the voice* has a **Speech model** choice (small.en, 488 MB, careful and recommended; base.en, 148 MB, faster and less careful), **Words to listen for** (the course's names and terms, drawn from its
  title, slide names, headings, text and narration scripts, and changeable), and three buttons. **Download the speech model (488 MB)...** asks first, in words (the size, that it comes from huggingface.co, where it is kept, and that nothing from the
  course is sent), shows its progress, can be stopped, and keeps the file only when its size and SHA-256 are exactly what Hugging Face publishes. **Listen and write the captions** reads the clip's sound in the window (the window decodes it, so there is no
  FFmpeg), saves it as a 16 kHz mono WAV in a temporary folder, runs the recogniser (`whisper-cli`, a separate program, processor only, with its alignment mode for accurate word times), and makes captions from the words:
  a sentence that fits two lines of 42 characters is one caption, a longer one is cut near its middle (at a comma if one is there), a caption starts when its first word does and ends where the voice stops, and captions never overlap. The
  recogniser's notes about sounds (`[BLANK_AUDIO]`, `(keyboard clicking)`, music signs) and any word "heard" where the clip is silent are left out, and the dialog says how many. **Set the times of my captions by the voice** keeps the words of the captions
  the list already has (typed, from a script, or brought in) and gives them the voice's times, saying how many of their words were heard exactly; if the voice does not seem to say them it changes nothing. What the computer wrote or timed is
  marked as unchecked, in the dialog and in the saved WebVTT file as a `NOTE` block, until **I have checked the captions** is pressed. A clip is listened to in parts of at most 20 minutes, cut in a pause, and joined (up to 3 hours; longer is refused with a message). Stop ends a listening or a download; closing the dialog while one is going asks first.
  The pure parts (reading the recogniser's JSON, the notes and silence filters, cutting words into captions, placing captions by the voice, the hint) are `editor/src/recognition.ts` with tests that use real recogniser output.
  The shell commands are `speech_status`, `speech_download`, `speech_audio_put` (the sound as the raw body of the request), `speech_listen`, `speech_drop`, `speech_cancel` and `read_media_bytes`; the window's page may reach the shell by its fast channel because
  the content security policy allows `ipc:` and `http://ipc.localhost` (without that, every command quietly used a slower text route that cannot carry raw sound).

**Questions, inputs and surveys.** "Question, input or survey..." in the Add menu opens one picker with
three groups: Quiz questions (multiple choice, true or false), Inputs that save a choice (checkboxes,
radio buttons, drop-down, list) and Surveys (Likert scale, semantic differential). An input is added with
its own new variables, one for each part that saves something, so it works straight away and the whole
addition is one undo step. In the Properties panel an input has its prompt (the question the learner
sees, also the name a screen reader gives it; the alt text starts as the same words and follows the
prompt until you change it yourself), a "Send the answers to the LMS" box, and its options, checkboxes,
statements or pairs of words. Each part that saves something has a "saves to" list of the project's
variables of the right type, a way to make a new one, and a box to rename the chosen variable. The editor
refuses a variable of the wrong type or one that another part of the same input already uses. Deleting a
checkbox, statement or pair of words also deletes the variable it saved to, as part of the same undo step, and the
editor says so ("Deleted number 2 and its variable statement2"). The variable stays if anything else still uses it:
a rule that reads it, or another input that saves to it. The options of radio buttons, a drop-down or a list share
one variable, so deleting an option never deletes that variable. A Likert
scale takes its labels one to a line, and a semantic differential has 3 to 9 points. A rule can read
these variables to change what the course does (see Rules above); the values are also saved, shown again
when the learner returns, and can be sent to the LMS.

**Tables and scrolling text.** "Table or scrolling text..." in the Add menu opens a picker. A new table has
a header row and three by three cells, with no name: the author gives it one in the Alt text field, which
a screen reader reads, and the validator asks for it until then. In the Properties panel a table has a
caption, "the first row is a header" and "the first column is a header" (at least one must stay on), a
grid of text boxes for the cells, and buttons to insert or delete rows and columns, up to 30 rows by 12
columns. Scrolling text is a box of paragraphs that scrolls when it is long, and is a tab stop so the
keyboard can scroll it. Both use the theme's colours, so only their font and size can be changed.

**Editing formatted text.** Select a text and press **Edit text...** in its Properties, press F2 on the canvas, or double click the text, and the Edit text dialog opens with the words in a box. The buttons make words **Bold**, **Italic** or **Underline**, make or remove a **Link**, make a **Bulleted list** or **Numbered list**, move a list item to a **Deeper level** or a **Shallower level**, and a drop-down changes a paragraph into a heading (Heading 1 to 6) or back. Ctrl+B, Ctrl+I and Ctrl+U work in the box, and Ctrl+K makes a link: it asks for a web or mail address (a plain address such as example.org is given https://), and the words you chose become the link, or, with none chosen, the address itself. The toolbar is one tab stop and the arrow keys move along it; Bold, Italic, Underline and the list buttons say whether they are on (pressed) where the cursor is. A toolbar button used from the keyboard keeps the keyboard, so a screen reader says its new state ("Bold on. // pressed"); Ctrl+B, Ctrl+I and Ctrl+U say "Bold on." and "Bold off." too. The drop-down that changes a paragraph into a heading keeps the keyboard, so the arrow keys step through the kinds (a list item is not a paragraph, and it says so). **Done** keeps the changes, as one step to undo; **Cancel** throws them away; Escape asks first if you have changed anything. Words pasted in come in as plain words, so nothing a word processor carries gets in. This works for every text, including the lists and several paragraphs a PowerPoint import brings in. **Edit the HTML instead** (under the box) shows the HTML and lets you write it: only paragraphs, headings, lists, bold, italic, underline, links, line breaks, superscript and subscript are kept, and anything else is taken out and its words stay. What is kept is always that plain kind of HTML, whatever the browser's editing box made of it (`editor/src/richtext.ts`).

**Speaker notes as narration.** When the PowerPoint dialog is choosing slides and the presentation has speaker notes, a box, **Use speaker notes as narration**, says how many slides have them. Ticked, each slide's notes become the narration of its heading, or of its first text, or of its first object that is not decoration, in the voice and speed the course already uses; nothing is added to the slide. If a slide's objects are all decoration the report says so. See `docs/powerpoint.md`.

**Text boxes.** For a text, **Words start** (at the top, in the middle or at the bottom of the box) and **Shrink the words to fit the box** are among its looks, beside the font, size, colour and where the words sit across the box. Shrinking keeps the words inside the box on every screen, to no less than half the size or 12 pixels; text brought in from PowerPoint has it on if its box did. A text that holds a list inside a list also has **Deeper list levels, as a percent of the level above**, because the levels of a list are often smaller than the one above; text brought in from PowerPoint says it when its deeper levels were a different size. See `docs/format-spec.md`, "How words sit in their box".

**Waiting for the learner.** In an object's Timing, **Appears** has a choice, **When the learner shows the next item**, and **Item number** appears: items with the same number show together, in order of the numbers. The learner has a button, **Show next item**, on the slide. The timeline draws such an object at its delay and marks it as a guess. Choosing this for several selected objects gives each the next number.

**Leaving out Back and Next.** With nothing selected, the slide's Properties have a **Moving through the course** box with **Leave out Back and Next on this slide**. The learner then leaves the slide only through something on it
(a Continue button, a tile) or when its time is up, which is how the games keep players in the game. Ticking it says what it did, and warns if nothing on the slide goes to another slide yet; the Problems list reports the same as an error.
One step for Undo. The score slide at the end of a game keeps Back and Next.

**The Slides panel's buttons stay in view.** Add slide, Share slides, Slides from a file, Questions from a file and Question banks are pinned to the top of the Slides panel; only the list of slides scrolls under them, so
in a long course they are never scrolled out of reach.

**Timing.** Everything starts as always there. In the Properties panel every object has a **Timing** section: **Appears**
(after the slide opens, or after its own narration starts, which needs narration), **Seconds** to wait, and **Stays for**
(blank: until the slide ends), with a sentence underneath that says it in words ("Appears 2.5 seconds after its narration starts,
then disappears 6 seconds later"). An object on another layer counts from when its layer is shown. An object with a timing shows
", timed" in the Objects list. The **Timing** button in the toolbar opens the **Timing list**: a real table of every object on
the slide, whichever layer, with the same three controls on each row and the sentence beside them, and a box at the top for
whether the slide moves on by itself after some seconds (blank or 0: it waits for the learner). It is all keyboard operable and
every control is named for its object. With nothing selected, the slide's Properties show the same slide box.

**The Timeline.** The **Timeline** button in the toolbar (pressed while it is showing) shows a panel under the canvas that draws the
slide's timing along a time axis, so a whole slide can be seen at a glance. Each object is a row with a bar for when it is showing.
A bar that runs to the edge stays, an object that is always there is a thin grey bar, and one that follows its narration is green. A
thin line under a bar is that object's narration, drawn once its audio has been made (the Narration button makes it), because
narration plays one object after another in reading order and so an object's narration starts where the one before ended; an object
that follows narration whose place is not yet known is drawn from the start with a dashed outline. A dashed line marks where the
slide moves on by itself. Each row has two grips, **when it appears** and **when it goes**, which are real ARIA sliders: Left and Right
Arrow move one a tenth of a second, with Shift a second, Page Up and Page Down five, Home and End go to the ends (End on the second grip
makes the object stay), and they are announced in words ("0.3 seconds after the slide opens"). Moving the first grip moves the whole
bar. The bars and grips can also be dragged with the mouse; Escape during a drag puts everything back, and the whole drag is one undo.
The row's name selects the object, and changing a grip makes the Properties panel follow it. The Timing list and the Properties
boxes make exactly the same changes with fields, so nothing is possible only with a mouse. The panel is part of F6 region cycling
while it is showing. The canvas always
shows everything, so timing never hides anything from the author. Learners get Pause timing and Show everything now on any
slide with timing or an automatic advance, and the validator warns about a slide with a question that moves on by itself, an
object that appears after the slide has gone, a control that disappears, and text that goes before it can be read.

**Animation.** Every object has an **Animation** section in the Properties panel: how it **Arrives** (none, fade in, slide in from the left,
right, top or bottom, or grow in) and how it **Leaves** (the same, going out), each with the seconds it lasts, from 0.1 to 2, and a
sentence that says it in words. An arrival plays when the object appears, which includes when the slide opens. A leaving effect plays
only when the object disappears at the end of its time, so give it a **Stays for** time in Timing (otherwise the Problems list warns
that the exit never plays). **Preview animation** plays the arrival and the exit on the canvas and puts the object back, without
changing anything; if your own device asks for reduced motion it says so and plays nothing, because learners with that setting would
see nothing move either. An object with an effect shows ", animated" in the Objects list. In the published course, effects are short,
never repeat or flash, and never play for a learner whose device asks for less motion; a slide with effects has a **Turn off animation**
button for everyone else.

**Files to download.** "Image, video, audio or file..." in the Add menu includes **File to download**: choose a PDF, a
Word document or one of the other kinds (the list is in the format spec) from your computer. The editor copies it into
the project's `assets/documents` folder and puts a download on the slide. Learners are told what a file is before they
download it, so the Properties panel asks for a **Name** (it starts as the file's own name), a **Description** (required:
say what is in the file and why they might want it) and a tick box, **I have checked that this file is accessible**,
which is your word that a screen reader can read it (a tagged PDF, or a Word file with real headings and descriptions for
its pictures); the validator will not let the course be published until it is ticked. **Use a different file...** swaps the
file and keeps your words, and says so if narration needs another look. **Use the description as narration** writes
narration from the name, the description, the kind of file and how to save it, so the same words have audio. In the
published course the learner sees the description, the kind of file and its size, and a Download link that saves the file;
nothing opens in a pop-up. The Assets dialog lists these files under **Files to download** and can put one on the
slide. A program or a web page (`exe`, `bat`, `js`, `html` and so on) is refused.

**The Add menu.** It stays short: Text box, Button, Image, video, audio or file, Shape, Table or scrolling text, Question,
input or survey, and Interaction. All but the first two open a picker, so the menu does not grow as more kinds are added.
The Shape picker draws each of the seven shapes. The pickers are native dialogs holding one group of
radio buttons, so they work by keyboard and a screen reader reads each name.

**Interactions.** "Interaction..." opens a picker of fifteen ready-made interactions in four groups:
Reveal (click and reveal, stacked click and reveal, accordion, flip cards, stacked flip cards), Tabs and
steps (horizontal tabs, vertical tabs, step process), Browse (content carousel, glossary) and Diagrams
(timeline, process circle, pyramid stack, pyramid matrix, circle matrix). Most start with three items;
the diagrams start with four or five. A drawing holds only so many items, so Add item and Delete item stop
at the limits for that kind, and changing the kind is refused, with a reason, if the items would not fit.
A glossary's items are terms and definitions, and the player lists them A to Z. In the Properties panel an interaction has a Behaviour section (its kind, how it is
arranged, and whether several items can be open) and an Items section, where each item has a title,
text (a blank line starts a new paragraph), an optional picture with its alt text or a "decorative"
box, and Move earlier, Move later and Delete. Add item adds another, up to twelve. Changing the kind
keeps the items. The group's own name, which a screen reader reads, is its Alt text, so say what the
items are about. An interaction takes its colours from the theme, so only its font and size can be
changed. On the canvas the first item is shown open. The example project `examples/interactions.osproj`
has one slide for each. Scored drag and drop, matching, hotspots and text entry are quiz questions (see Quiz questions). A story that branches is a scenario (see
Scenarios and the cast).

**PowerPoint.** The **PowerPoint** button in the toolbar brings slides in from a PowerPoint presentation (a `.pptx` file; Google Slides can download one), and brings slides you brought in earlier
up to date after the presentation has changed. It is a dialog with a few steps, each headed so a screen reader says where you are. *Choose the file.* If the project already has imported decks, say whether
this is a new presentation or a newer version of one (the dialog guesses from the slides they have in common). *Bring slides in:* a list of the slides, each with a box (hidden ones start unticked), and the button says how many; the
slides go after the one you are on, and it is one step to undo. The report afterwards says in plain words what was left out or changed: charts and SmartArt, animations, speaker notes, fonts that were replaced, pictures with no
alt text (the Problems list asks for each; nothing is made up), and slides that have a picture behind the text. *Bring up to date:* every change the presentation has made since, each with a box. Changes to things you did not touch
are ticked; anything that would replace something you changed, a shape the presentation removed that has rules or narration of yours, a slide the presentation no longer has, and a slide you left out are not. What you
leave unticked is offered again next time. Rules, narration, timing, layers and objects you added are never touched. The presentation file is never changed. See `docs/powerpoint.md` for what to expect and how to get the best from it.

**Keyboard, and a narrow window.** Each list (Slides, Objects, Problems) is one stop for the Tab key: Tab lands on the current item, the arrow keys, Home and End move between the items, and Enter chooses one and says which. F6 moves between the panels. When the window is narrow, or the page is zoomed in (to 400% on a laptop), the panels stack in one column in reading order and the page scrolls down, never sideways; the slide is drawn smaller to fit, and everything on it is also a box in Properties. A button's name starts with the words it shows, then says what it acts on ("Move earlier: rule 1"), so voice control and screen readers agree. `docs/accessibility-audit.md` says what was checked and how to check a new panel.

**Looks.** A look is another way an object can appear. Text, buttons, icons, shapes and pictures have a **Looks** box in Properties, under Appearance. **Look to edit** lists Normal (the Appearance box) and then
Hover or focus, Visited and Disabled, which the course applies on its own, and any look you add. Choose one and the same fields as the Appearance box appear for it (text colour, button colour, font and size
for text and buttons; icon colour; fill, outline colour and outline width for a shape), each with "same as normal" as its blank. **How solid** (10 to 100) is in Appearance too, and in each look, so a look can dim an object. The canvas shows the look
you are editing on the selected object, so you see what you are making; choose Normal, or select another object, and it goes back. A sentence under the colours says how readable the text is in that look, using the theme's real
colours, and counts a look that makes the object see-through. **Add a look...** asks for a name (a few words, such as Correct or Selected; not Normal, and not one the object has), **Rename...** (your own looks) changes it and the rules that
apply it follow, **Delete this look** (or **Clear this look** for a ready-made one) removes it, and says how many rules still apply it, which the Problems list then names. Each look has a **Spoken message**: the words a screen reader says when a rule
applies the look, such as "Step 1 is marked as done". It is never written for you. A rule can apply a look with **Do: Change an object's look**: choose the object (only objects that have a look are listed) and the look, or Normal to return. The rule card says what a
screen reader will say, or that it will say nothing, and the Problems list warns about a rule that applies a look with no spoken message. A look lasts until the slide closes. The example `examples/looks.osproj` has a step that is marked as done and a button that starts disabled.

**Timing that follows a video or an audio clip.** In an object's Timing box, **Appears** has a third choice, **When a video or audio clip reaches a time**, once the slide has a video or audio file. Then
**Follows** names the clip, **Seconds into the clip** is when the object appears, and **Stays for** is how long, in seconds of the clip (blank: until the clip ends). **Choose by playing...** opens the clip with its
own controls: play or move to the place, press **Use this moment as the start**, move to the end and press **Use this moment as the end** (or **Stay until the clip ends**), then **Use these times**; an end before the
start is refused with the reason. The Timing list has the same choice in each row, with a second box for the clip. In the Timeline panel the objects that follow a clip are in a group of their own under the
slide's rows, headed "Following *the clip*", with an axis of seconds into the clip, and their grips are the same sliders. What shows in the course depends only on where the clip is, so skipping or going back is
safe; Pause timing pauses the clip too. If a clip that objects follow is deleted, the message says how many, and the Problems list names them; copying a slide keeps each copy following its own copy of the
clip, and an object pasted onto a slide without the clip goes back to appearing when the slide opens, and says so. YouTube and Vimeo videos cannot be followed. The example `examples/timed-media.osproj` has a
video with four notes and an audio clip with two.

**Icons.** "Image, video, audio or file..." has an **Icon** choice that opens a picker of 1,879 line icons from the Lucide set (ISC licence). Type what the icon means ("arrow", "book",
"warning") and the best matches come first; the grid is one stop for Tab and moves with the arrow keys, Home and End, and Enter chooses. A chosen icon is put on the slide at 64 by 64 in the theme's strong
colour, with **no alt text**: say what it means in the Alt text field ("Next", not "arrow"), or tick decorative; the editor offers the icon's name in words as a start and never fills it in. In the Properties
panel an icon has its colour, its line width and **Change icon...**, which keeps its size, colour and alt text. An icon is saved as its shapes in the project, so it needs no file, and a course that uses one
names Lucide on its credits page (the Problems list warns if that page is off).

**Games from a spreadsheet.** The size dialog of a Quiz board or a Prize ladder starts with **Fill it from a spreadsheet**: **Choose a spreadsheet (CSV)...** reads a table of questions (a quiz board's table also has Category and Value columns) and makes the game with its questions in it, and **Save a sample spreadsheet...** writes a whole small game's table to start from. The dialog says what it found, row by row, before anything is added, and the sizes come from the table. See `docs/game-templates.md`.

**Buttons.** "Button..." in the Add menu opens a picker: a plain **Button**, or a ready-made **Next**, **Back** or **Replay this slide** whose rule is already written for the mouse and the keyboard. These use
the course actions (next slide, previous slide, replay this slide), which have no target, so they keep working when slides are moved, copied or deleted. In the Properties panel every button has a **Look**
(Filled, Filled fully rounded, Outline, Outline fully rounded, Soft): a look sets the button's colours, outline and roundness from the theme's colours, so it follows the theme and stays readable, and leaves its words,
font, size and rules alone; colours changed by hand show as "Your own colours". A button can also **show an icon** before or after its words; the icon is decoration and the words stay its name. The Rules box now
offers "Go to the next slide", "Go to the previous slide" and "Replay this slide" beside "Go to a slide".

**Lesson slides.** The Add slide picker has a group of six ready-made lesson slides next to the layouts: Welcome (a title, a line about the course and a Begin button), Objectives (with Back and Next), Knowledge
check (a multiple choice question with feedback for a right and a wrong answer, wired), Scenario (a starter story with Back and Next), Resources (an accordion with Back and Next) and Summary (with Back). They are
built into the editor and need no format change. Their buttons are already wired and reachable in reading order; the words, the question and the story are placeholders to replace. The slide they make is an
ordinary slide, not tied to the template, and adding one is a single step for Undo.

**Games.** The Add slide picker has a second group, **Games, ready-made**, after the lesson slides. A game is several slides that jump between each other, with the variables and rules that make it play, built from
the editor's own parts. A game leaves out the course's Back and Next on every slide but its last (the score), using a slide's `hideNavigation`, so a player goes on only by playing:
a tile, an answer, the door. On the quiz board a question's **Back to the board** button is in its feedback, so it appears once the question is answered and not before. Choosing one asks how big it should be (a drop-down for each number, labelled, with a line that says how many slides it will add), then adds all its slides after the
one you are on and selects the first, as one step for Undo that also takes back the variables and the completion setting. Everything you have to write is a placeholder, and what it makes is ordinary slides, not tied to the game afterwards.
The first game is the **Quiz board**: a board slide with 2 to 6 categories of 2 to 5 tiles each (worth 100 points, then 200, and so on), a question slide for every tile (multiple choice, one try, worth its tile's points), and a results slide.
A tile opens its question. Answering marks the tile as used and counts it (the question's own rules, which the player runs once, when an answer is accepted), and each time the board opens, a rule dims every used tile, and
dims Finish until every tile has been used. Every question slide always has **Back to the board**, so a learner is never stuck on a question that is already answered. The game sets the course to complete when the learner
**reaches the last slide** if it was set to every slide seen (and says so), because learners visit the questions in any order and the validator would otherwise warn about every tile. Reading order on the board goes down each
category (its heading, then its tiles from the smallest value) and then Finish; every tile and Finish is a real button, and a used tile or a closed Finish is a disabled button, so Tab skips it and a screen reader says it is unavailable.
Each tile's name starts with the words on it and then says its category ("200, Category 2"), so **when you rename a category, change the alt text of its tiles too** (and the variables' names in **Variables**, if you want them to match).
The tiles, headings and the board's instructions have no narration until you add it, as with any text. A learner who leaves and comes back finds the board as they left it: a look is not saved, but the board's rules that dim a used tile
and close Finish depend on variables, which are, so a resume works them out again (silently, see Resume in `docs/format-spec.md`). The board has no running score
on it, because there is no way yet to show a variable's value as text; the score is in the results box. `examples/quiz-board.osproj` is a finished board of nine questions, and `docs/game-templates.md` has the plan for more games.

The second game is the **Prize ladder**: 5 to 15 questions in order (the dialog's one drop-down), each worth 100 points more than the one before. It adds an opening slide (what the game is, the whole ladder and **Start**), a
question slide for each rung, and a results slide. Each question is multiple choice with one try. After an answer its feedback shows the right answer, and a **Next question** button (**See my results** on the last) is in the
feedback, so the way on is there only once an answer has been given. **A wrong answer does not end the game**: a course is complete only when every question has been answered, so a game that stopped early would leave the
course incomplete for good. The ladder down the right of each question is a column of text boxes with fills of their own, grouped (so it can be moved, resized or deleted as one), and marked decorative, so a screen reader
skips it; the same facts are in words: "Question 3 of 8, worth 300 points" at the top of each question, and the opening slide's text. The rung the learner is on is bold and in the strong colour, rungs still to come are grey boxes,
and rungs already answered are faded text. The game adds no variables and changes no course setting, because every jump goes to the next slide. If you change the number of questions or their points, change the line at the top of
each question and its rung to match. Reading order on a question is where the learner is, the question, then its answers; in the feedback, the words and then the way on. `examples/prize-ladder.osproj` is a finished ladder of eight questions.

The third game is the **Escape room**: 2 to 5 rooms and 1 to 3 tries at each lock (two drop-downs in the dialog). It adds an opening slide, then a **room** and a **door** for each room, and a results slide. A room has three places
to search, which are buttons (there are no pictures to put hotspots on; put a picture behind them and move them if you like), and **Go to the door**. A place opens its clue, one at a time, with a **Close** button, and is marked
**Searched** (its look changes, and a screen reader says "Searched") from then on, including after the learner leaves the room and comes back, because the room's rules put the look back from the place's variable.
A door is a typed code (a short answer question, 100 points) with the tries asked for. After a right answer, **Next room** appears in its feedback. After a wrong answer with tries left, the learner can try again, and the
feedback's **Next room** is there but dimmed; when the last try is used, it opens and the code is shown. **Back to the room** is always there. This is so a lock can always be finished: a course is complete only when every question has been
finished, a rule cannot tell a right answer from a wrong one, and so the way on opens when the lock is finished by either route. The game counts the tries in a variable of its own (the question's rules add 1 for each answer that is accepted).
Each room has four variables, three for its places and one for its tries, made together. The clues the game starts with spell out each room's code, so it can be played as it is made: when you change a code, change it in the
lock's question (its answer), in the three clues, and in the line that says what the code was. It changes no course setting, because every way on goes to the next slide. A learner who leaves part way through comes back
to the same place: places still look searched, a lock with tries left keeps its feedback and its dimmed way on, and a finished lock keeps the code and its open way on. Reading order in a room is its title, its words,
the three places, then the door; at a door, where the learner is, the question, its answer box, then Back to the room, and in each feedback the words and then the way on. `examples/escape-room.osproj` is a finished escape room of
three rooms.

**Scenarios and the cast.** The **Characters** button in the toolbar opens the cast: the people a course can show and give a voice to. Each has a name, a few words
on who they are, a voice, and a picture with its alt text (or a "decorative" box, and then the alt text is cleared). For the picture you can press **Choose from the library...** to pick a person from a character pack (`docs/character-packs.md`), or **Choose a picture from my computer...**.
The library shows each person with a description of them beside their picture. Choosing one brings their picture into the project with that description as the alt text (the dialog says so aloud, and the alt text is yours to change), gives a person who has no name yet
the name and a voice of the kind the pack suggests, and saves the credit for the picture with the cast, in the same undo step. The library dialog also adds a pack from a zip file, shows the folder your own packs are kept in, and removes a pack you added (press twice).
A picture that was copied into the project while choosing and was then replaced, or the dialog was cancelled, is deleted again. You can add a person, move them and remove them.
A person from the library has a **Poses** box: **Add poses from the library...** shows every pose the pack has for them, each with its picture beside its words and a check box, and copies only the ones ticked into the project (so a course that uses three stays small); a pose can be taken out again, unless a line uses it, and then the dialog says where.
In a scenario, a line said by a person with poses has a **Pose beside the line** box: their picture, or one of their poses, which is drawn beside the line, to the waist, instead of their small face. Changing who says a line keeps the pose if the new speaker has one with the same id and takes it off if not, and says so. The pictures are decoration: the person's name is always written beside them.
The dialog changes nothing until **Save the cast**, and then one Undo takes it back. A person who is still used (they speak a line in a scenario, or a choice of
character offers them) cannot be removed, and the dialog says where they are used. Changing a person's voice changes the voice of the lines they speak and says how
many, so make the audio again. A scenario is added from "Interaction, scenario or timer..." (Branching scenario), and starts as a small story to write over: one situation
with two choices, each leading to its own ending. In the Properties panel, **Scenario** holds the settings (where it starts, whether the learner can take back
their last choice, who "you" is, a true or false variable that is set when they reach an ending, and something to think about at an ending). **Meters** adds
bars that show a number variable as choices change it, or none at all. **Situations** has a list to choose the situation to edit, with Add situation, Move
earlier, Move later and Delete (refused, with the reason, while a choice still leads to it). The situation being edited shows its title and its question, its
lines and its choices. For each line you choose who says it (the narrator, "you", or a person from the cast), write the words, and tick **Spoken aloud** to give
it narration in that person's voice; a Spoken words, voice and pronunciation section then opens the usual narration controls, and the spoken words follow the text
for as long as they are the same. A line that is not spoken says so in the panel. Each choice has the words, where it leads, the changes it makes to number
variables (with a minus sign it takes away), and an optional response shown straight after it. A situation with no choices is an ending. The canvas shows the first
situation, drawn inertly; the course is where the story runs. A **Choose a character** input is added from "Question, input or survey..." and needs two people in
the cast; its Properties panel lists the cast with a box for each person to offer. Everything is keyboard operable, a refused change says why, nothing is filled in for
you that a screen reader depends on, and the Narration dialog lists a scenario's spoken lines. The example `examples/scenario.osproj` is a small scenario with a
cast of three, a choice of character, two meters and an ending that shows a layer.

**Quiz questions.** "Question, input or survey..." in the Add menu opens a picker with twelve kinds of question in five groups: Choose
(multiple choice, true or false, multiple response), Type an answer (short answer, number), Fill in the blanks (typed, from drop-downs, drag the
words), Match and order (matching, drag and drop, sequencing) and Pictures (hotspot). Each builds the question as a heading, the question itself, and
two feedback layers (right, and wrong or partly right) that are already wired to it. A hotspot asks for its picture first. Select the question to edit
what belongs to its kind, which is all in the Properties panel and all keyboard operable: answers with a radio button or check box for the right ones
(and a box to switch between one right answer and several); the accepted answers of a short answer, one on each line; the right number and how far off
may be accepted; the sentence of a fill in the blanks with an Insert a blank button, each blank's answers, and a word bank with extra words; items and
their matches with Move earlier and Move later; the items of a sequence in the right order; a hotspot's picture, its description and its areas as
percentages, with the canvas showing the areas as dashed boxes (solid for a right one). The placeholder text is yours to replace, and alt text is never filled
in for you: a hotspot's picture description is required. **Points** and **Attempts allowed** are for every kind, and a question with several parts earns a
share of its points for each part that is right (the best attempt counts); a question worth 0 points is practice. Dragging, where a question has it, is an
extra over the drop-downs and buttons, which stay. **Write the narration from the question** in the Narration box writes what the question shows (what to do,
and what there is to choose from) as its narration, to be changed as you like. Changing a question is a step for Undo, and a change that cannot be made,
for example taking away the last right answer, is refused and says why. The validator checks each kind (see the validator spec). The example project
`examples/question-types.osproj` has one slide for each kind.

**Slide layouts.** The Add slide and Change layout buttons open a picker with a small drawing of each of
26 layouts, in four groups:

- **Basic:** Title Slide, Title and Content, Section Header, Two Content, Comparison, Title Only, Blank,
  Content with Caption, Picture with Caption.
- **Columns and grids:** Two Columns 60/40 and 70/30, Three Columns, Four Columns, Grid of Four.
- **Pictures and charts:** Picture and Text, Text and Chart, Chart, Title and Large Picture, Three
  Pictures, Four Pictures, Dashboard.
- **For lessons:** Learning Objectives, Instructions, Major Point, Welcome with Picture, Process or
  Timeline.

Questions are not layouts: add a quiz question to any slide as an object. There is no chart object, so a
chart is a grey "Chart area" and a picture is a "Picture area": decorative boxes that mark where an image
goes. Select the box and its Properties begin with a **Picture box** section with three buttons: **Picture from my computer...** (export a chart as a picture first), **A person from your cast...** (a person's own picture or one of their poses; its alt text starts as their name and pose, or the person's own alt text, and is yours to check) and **A person from the library...** (the character packs; their credit is recorded with the picture). The picture takes the box's place, as large as fits inside it in its own proportions, centred, in one step for Undo,
and focus moves to its Alt text, which is left empty for a picture from your computer (the editor never makes up a description) and must be written or the picture marked decorative. A table is its own kind of object (see Tables and scrolling text) and can go on any slide, so
no layout is built around one.

Change layout can be used on a slide that already has content. The words already written move into the
new layout's places (the first title-like text box to the title, the rest in reading order to the other
places), at the size that suits each place. Nothing you wrote is deleted: text you wrote that has no place in the new layout
stays where it was, and the editor says so. Placeholders nobody has written in (still showing a
layout's own prompt such as "Add your content here."), and the old layout's coloured bars and picture
area, are removed and replaced by the new layout's own, so the slide holds only the new layout. Buttons, images and any shapes you drew are not touched. It is one undo step. Only the base
layer changes.

**Editing a theme.** In the Themes gallery, **Edit this theme...** opens a dialog for the project's own copy of a theme: the built-in themes are never
changed. It has a **Theme name**, **Start from** (the project's current theme, or any built-in one: choosing a built-in one replaces the colours and fonts
with its own, and your logo stays), all twelve **colours**, the **heading and text fonts**, and a **logo**. Each colour is a hex code you can type (short
forms and a missing # are fine, and a code that is not a colour is flagged and not used) beside the system colour picker. A drawing of a light and a dark slide
changes as you go, and under the colours the dialog says in words how readable each pair is (the pairs the validator checks, which WCAG AA asks to be 4.5 to 1
or more), with a summary read out when you finish a change. A theme that is hard to read can still be saved, since the choice is yours, and the Problems list says so.
**Save theme** applies it as one undo step and saves it in `theme.json` under the new name. For the **logo**, choose a picture (it is copied into the project's
images and sized in the shape of the picture, no wider than 160 to start), write its **alt text** or tick that it is decorative (the dialog will not save
without one or the other), pick a **corner** and a **width**. It is drawn on every slide, on the canvas and in the course, behind the slide's content, and the
Problems list warns if content reaches into its corner. Choosing a different built-in theme later keeps the logo and says so. The logo is part of the format from 0.20.0.

**Themes.** The Themes button opens a gallery of eight built-in themes, each drawn as a light slide
and a dark one with its two fonts named. Choosing one restyles the whole project in one undo step:
every slide's background, and every colour and font that follows the theme. Colours and fonts the
author picked by hand stay as they are. A new project asks for a theme first. The colour chooser
shows twelve theme colours before the ordinary palette; picking one keeps the object following the
theme, and its name appears as "Theme: Accent (#0b5fff)". The readability note uses the theme's real
colours and the slide's background. Each slide has a Design section with its layout, Change layout,
Reset layout (put the text back in the layout's places), and a background of Theme default, Theme dark,
Theme accent or a colour of your own. When a background change would make text unreadable, text that
follows the theme is switched to the matching light or dark theme colour. Opening a project from an
older version of OpenStage asks first, then updates it and keeps its old files in `.openstage-backup`.

A slide remembers its layout by name, so Change layout starts on the current one. The layout's
bars and picture area are recognised by their names ("Accent" and "Picture area").

A layout's own shapes are not stored separately. A slide made from one is an ordinary slide; the editor
recognises a layout's decorative bars and picture area by their names ("Accent" and "Picture area").
The picture area is a grey decorative box that marks where a picture goes: select it and use the **Picture box** buttons in Properties, which put the picture in and take the box away. Every layout follows the format's accessibility rules, with real headings first in reading
order, alt text, a tab order that runs 1, 2, 3, and decoration hidden from screen readers.

**Button actions.** A button can do nothing, go to a slide, show a layer or hide a layer. The editor
always writes a `click` trigger and a matching `keyActivate` trigger together, so a button made here
is never mouse-only. A button whose triggers are anything more elaborate is left exactly as it
is; anything beyond these simple actions is done in the Rules section.

**Saving.** Only changed files are written. Deleting a slide removes its file when you save. A
brand-new slide is written, and `project.json` is rewritten when the slide list changes.

**Preview.** The Preview button (Ctrl+P) shows the course in your own browser as it is right now, including
changes you have not saved. It builds a copy in a temporary folder, so nothing in your project changes, and
it is quick: it does not check for problems (the Problems list does that) and it makes no narration audio,
though audio made before is used. If a narrated object has no audio yet, the editor says so. A preview is
not connected to an LMS, so scores and the place a learner left off are not recorded. The page opens in the
browser that is set as your default, outside the editor, and old previews are cleared away after a day. The preview is also the way to
see the narrow layout: the canvas always shows the whole stage, but when a learner's window is narrow or the page is zoomed in, the
course shows one column instead, in reading order, and narrowing the preview window or zooming in shows you that. Check it, because
it is the order a screen reader reads that decides what comes first (see Reflow in the format spec).

**Publish.** The Publish button (Ctrl+Shift+P) opens a dialog. Publishing saves your project first, then
checks it for problems with the same checker as the Problems list. Errors stop it, and are listed in the
dialog; warnings do not. It makes the course as a folder of web files and as a SCORM 1.2 package (a zip,
which also carries the editable project in a `source` folder the LMS ignores) beside it, in the folder you
choose with "Choose folder...". Until you choose, that is a "Published courses" folder beside the project, and
the folder you choose is remembered for next time. The folder and the package are named after the project.
Publishing again replaces them, and it refuses a place that is inside the project, holds the project, or
already has a folder of that name with other things in it, so it can never empty something that is yours.
Narration audio is made for any narrated object that has none, if a speech engine is set up (`local-settings.bat`
names the Python that has Kokoro; see `docs/narration-setup.md`); otherwise the course has transcripts and no new audio, and
the dialog says so. The first time this can take several minutes, so the button becomes "Cancel publishing",
and Escape cancels too. When it finishes the dialog says what was made and offers "Show the package in its
folder" and "Open the course in my browser". The web-files folder also holds `_scorm-test.html`, a stand-in
LMS page for trying scoring and resume; it has to be opened from a local web server and is not in the package.

Preview and Publish both run `player/publish.ts` under Node, the same tool as the command line, in the
background, so the editor stays usable. Only one of them runs at a time. Both need Node.js installed; Publish
also needs Python, for the problem check.

Not built yet: a background picture for slides (a theme has colours, fonts and one logo); keeping a theme to use in other projects; question banks, shuffled choices and timed questions; scenario situations laid out as a map you can drag (they are edited as a list); setting an object's states (so no rule can change a state yet); narration that is not tied to an object (a slide with nothing to attach it to
needs an object for it, such as its heading); and a project's `modified` date (it is not updated
on save).

## Keyboard

Every task has a route that needs no pointer. The canvas keys are a convenience on top.

| Where | Keys |
| --- | --- |
| Anywhere | Ctrl+N new project, Ctrl+O open, Ctrl+S save, Ctrl+P preview, Ctrl+Shift+P publish, Ctrl+Z undo, Ctrl+Y or Ctrl+Shift+Z redo, F6 and Shift+F6 next and previous panel |
| Anywhere except in a text box | Ctrl+D duplicate the selected object, Ctrl+C copy, Ctrl+X cut, Ctrl+V paste |
| Anywhere except in a text box | Ctrl+A select every object on the layer, Ctrl+L lock or unlock the selected objects, Ctrl+G group the selected objects, Ctrl+Shift+G ungroup them |
| Slide, Objects and Problems lists | Up and Down, Home and End move; Enter or Space chooses |
| Slides list | Alt+Up and Alt+Down move the slide; Delete removes it; Ctrl+D duplicates it |
| Objects list | Alt+Up and Alt+Down change reading order; Delete removes the object, or all selected objects if it is one of them; Shift with Up, Down, Home or End selects a range; Ctrl+Space adds or removes the focused object |
| Dragging on the canvas | Hold Alt to drag without snapping |
| Clicking on the canvas | Clicking an object in a group chooses the whole group; hold Alt and click to choose just that object |
| Canvas | F2 edits the words of the chosen text (so does a double click on it) |
| Edit text dialog | Ctrl+B bold, Ctrl+I italic, Ctrl+U underline, Ctrl+K link; the toolbar is one tab stop and Left, Right, Home and End move along it; Escape asks before throwing changes away |
| Canvas | Arrow keys move 1 pixel, with Shift 10, all the selected objects together; Alt+arrows resize one object or one whole group; Page Down and Page Up choose the next or previous object, and with Shift add it to the selection; Delete removes the selected objects; Escape clears the selection |

Moves, resizes and selections made on the canvas are announced in a polite live region. Alt text and
the other accessibility fields are never filled in for the author.

## Behind the editor: what the Capture recorder needs

OpenStage Capture is a separate program that records the screen. The editor starts it and talks to it, and these are the parts of the editor's
shell (the Rust side) that make that possible. They are built and tested; the panels an author would use (a recorder panel, a clip list) are not
built yet, so apart from the check dialog in the first item nothing here shows on screen. The page reaches all of it through `editor/src/backend.ts`.

- **OpenScreen: recording from the editor.** OpenScreen is the name authors see for the Capture module. The toolbar's **OpenScreen** button opens a dialog
  with three parts: **Record**, the recording as it goes, and **Is this computer ready to record?**
  - **Record.** The author names the recording and chooses what to record: a whole screen, one window (found with **Look for windows**; the window is asked for
    by its title), or part of a screen (four numbers, at least 64 by 64 pixels). They choose a microphone, whose sound to record (the computer's own sound includes a
    screen reader's speech), a webcam (none unless chosen), and whether to note what they do with the mouse and keyboard (off unless chosen, with a plain note about what that
    keeps and that password keys are never noted). The lists of screens, microphones, sound outputs and cameras come from the recorder's `probe`. A countdown of 0 to 10 seconds, and the
    recorder's short sound for each step (countdown, start, pause, resume, stop, on by default for anyone who cannot see the screen) can be changed. **Practice** records a
    made-up picture and sound instead of the screen, to try the controls. The recording is kept in a `captures` folder inside the course's own folder, in a folder named for the
    recording and ending in `.capture`, and the first time the editor adds `captures` to the course's `sourceExclude`, so the raw recording and its notes never go into a published
    package (the project then needs saving; it is not an undo step). **Start recording** says in words why it cannot start when a choice is missing.
  - **The recording as it goes.** The dialog shows a sentence for the state ("Recording take 1, 12 seconds. Interaction recording is on. Sound: microphone good, the computer's
    sound quiet."), with **Pause** or **Resume**, **Stop**, **Start again** (the old take is set aside, never erased) and **Add a marker** (with words if wanted), the markers, and
    everything the recorder said (warnings and problems, each starting "Note." or "Problem."). Changes of state, markers, warnings and the end are spoken through a status
    region; the sound levels and the running time are shown but not spoken, so a screen reader is not talked over. The recorder's keys work from any program while recording:
    Ctrl+Shift+F10 pause or resume, Ctrl+Shift+F11 stop, Ctrl+Shift+F12 start again (the editor says which could not be used, and the buttons always work). A recording goes
    on if the dialog is closed: the toolbar button then reads "OpenScreen (recording)" and the editor speaks the news itself. If the recorder ends without finishing, the editor says so
    and repairs what was recorded (at most about a second can be lost). When it finishes, the dialog says where the recording is kept and offers to show its folder.
  - **Is this computer ready to record?** **Check this computer** runs the recorder's own `setup-check`: the Windows version, screen capture, the video and sound encoders, the microphone and
    the camera and the permission to use them, and the room left on the disk of the open project. Each finding starts with "Passed." or "Problem." (never colour alone), and one sentence at
    the end says whether the computer is ready. It records nothing, asks Windows for no permission and sends nothing anywhere.
  It is a native dialog, so focus moves in, Tab stays inside, Escape closes it and focus returns to the button. Not built yet: choosing part of a screen by dragging (the numbers are typed),
  a list of earlier takes, changing the keys, editing a recording, and putting one in a course. The logic is `editor/src/capturesession.ts` (the choices, the recorder's options, what its lines
  mean and the words for each state), `editor/src/capturecontroller.ts` (starting it, the commands, the keys, the repair; tested against a stand-in recorder), `editor/src/capturecheck.ts`
  and the dialog `editor/src/recorderdialog.ts`. `OPEN EDITOR.bat` builds the recorder after the editor (into `capture\target\release`, where the editor looks), and opens the editor even if that fails.
- **OpenScreen: editing a recording.** The recorder's preview, timeline and clip list (`capture-timeline/`, plain DOM with no dependencies, with the edit model in `capture-edit/`) open in a
  dialog of their own: from **Edit a recording** in the OpenScreen dialog (every recording in the course's `captures` folder is listed) or from **Edit the recording I just made** when a recording has
  finished. The edit is a list of what to keep and what to add (trims, splits, text, shapes, blur, zoom); it is saved as `edit.json` inside the recording, whole or not at all, and the recorded picture
  and sound are never changed. **Save the edit** or Ctrl+S saves it; Close asks first if there are changes that are not saved. The screens keep their own keys and their own line of
  announcements (a polite live region, so nothing is read twice): F6 and Shift+F6 move between the preview, the timeline and the clip list and say where they arrived, Ctrl+Z and Ctrl+Y undo and redo
  the edit. While the dialog is open the editor's own Ctrl+S, Ctrl+Z and F6 step aside, so none of them reaches the course. The screens are kept in their light colours to match the editor.
  The shell reaches a recording only by the course's folder and the recording's folder name: it lists the recordings, reads the recording's `.json` files, lists the folders of a take, writes `edit.json` (and
  nothing else), and lets the page play the media of one recording's `takes` folder from disk with seeking (`list_recordings`, `recording_read`, `recording_folders`, `recording_write_edit`,
  `allow_recording_media` in `lib.rs`; a name must be one plain folder name ending in `.capture`, a place inside it plain names joined by `/`, only `.json` is read as text). The screens read a recording
  through `editor/src/recordingfolder.ts`, and the dialog is `editor/src/editrecording.ts`. A recording made with Practice has no real picture or sound, so it opens as an empty edit and says why.
  **Making a video.** **Make a video from this edit** saves the edit first (the recorder reads `edit.json`), then runs the recorder's `render` and says how far it has got, in words, as it
  works (about every tenth), with **Cancel the video**. The video is written in the recording's own `exports` folder (`<course>/captures/<name>.capture/exports/<name>.mp4`), so a half-made file is never
  in the course, and the recorder reads it back the way a player would. Its checks (the length, the size, the sound, and notes such as text that does not fit its box) are listed, each starting
  "Note." or "Problem.", with one sentence for the whole; a video that did not read back right is never called good. **Use cuts instead of animated zooms** (off unless chosen) is kinder to anyone
  bothered by movement. When the video is made, **Put the video on the current slide** copies it into the course's `assets/video` and adds a video object to the slide. That object starts with no
  description and no captions, and the Problems panel asks for both, because both are required and the editor never fills them in. **Show the video in its folder** opens its folder. An edit that
  still lacks something accessibility needs (a description for a text overlay, for instance) is refused, with what is missing. Once the video is on the slide, **Write captions for the video** opens the captions
  dialog on it, with the edit's on-screen words and zooms ready for its transcript. Not built: making the video anyway when that is so, choosing its size or
  speed, and linking the video to the steps of a lesson. The options and the words are `editor/src/captureexport.ts`.
  **Finishing the edit** (the timeline of the recording editor). Put the playhead where a mistake starts and press **I**, where it ends and press **O**: a shaded band shows the stretch and the words under the timeline say it. **X** removes it from every track and leaves a gap; **Shift+X** removes it and moves everything after it earlier; **Alt+X** clears the marks. Overlays and zooms in the stretch go with it or are shortened, and the sentence says what happened to them. One undo puts it all back.
  Dragging with the mouse **snaps** to the playhead, the edges of other clips and the ends of the edit (a line shows where; the **Snap** button or **N** turns it off; holding **Alt** turns it off for one drag, as on a slide). With several clips chosen, dragging one moves them all. The **Tracks** button renames or deletes a track; one with things on it asks first.
  Other things not built are listed in `capture-timeline/README.md` (a captions track, cursor and click effects).
  The first page (no project open) offers **New project**, **Open project** and **Show the examples**, which opens the folder of example projects that came with the program (`examples_folder` in `lib.rs`); the button is left out when there are none.
  **About** (the last button in the toolbar) shows the version and where things are on this computer (the program, its Python and Node, the recorder, the speech recogniser, the settings and data folders, whether the narration voice is installed, the web view and Windows versions), as lines and as text to copy into a message when asking for help; it holds no key and nothing from a course. **Show the guides** opens the folder of guides that came with an installed copy.
  **Steps from a recording.** **Make steps from this recording** (in the OpenScreen dialog, and for the recording just made) opens a review dialog (`editor/src/stepsdialog.ts`) for the steps that can be made from
  what the author did while OpenScreen was noting the mouse and keyboard (`takes/take-N/events.jsonl`): one step for each click (told as "Click the Save button.", "Choose Open from the menu.", "Double-click ...",
  "Right-click ..."; without a name, "Click the highlighted spot."), each stretch of typing ("Type "report"."), each key such as Enter or Ctrl+S, each change of program, and each marker. Anything the edit cuts out makes no
  step. Every step is a labelled group of fields: **Words the learner reads**, **Description of the picture**, **Picture taken at (seconds into the take)**, a tick for "I have checked the words and the picture description",
  and **Move up**, **Move down**, **Merge with the next step**, **Split in two** (or **Undo the merge**), **Delete**; **Add a step by hand**, **Undo the last change to the list** and **Start again from what I did while recording** work on the list,
  and every change is said in words. The words and the picture description are proposed from the log and are the author's only once the step is ticked as checked; slides made from steps will use a picture description only for a checked
  step. **Save the steps** (or Ctrl+S) writes `steps.json` in the recording, which the next opening reads back. A recording with no log says how to get one, and steps can still be added by hand. The pure parts are `editor/src/steps.ts`
  and `editor/src/stepsource.ts` (with tests); the shell reads a take's `events.jsonl` (up to 32 MB) and writes `steps.json` (`recording_write_steps`; only `edit.json` and `steps.json` can ever be written in a recording). The plan for pictures,
  slides, Practice and Assessment is `docs/decisions/0003-steps-and-practice.md`.
  **Pictures and the Watch lesson.** **Show the picture** (in each step) takes the step's picture from the recording's own video, at the moment in **Picture taken at**, and shows it with a box round the place to point at: the box is reached with Tab, moved with the arrow keys (Shift widens or heightens it, Control makes each press five times as big),
  dragged with the mouse, or set in four number fields (left, top, width, height, in percent); pressing elsewhere on the picture puts its middle there; **Mark a place to point at** and **Take the mark off** work on any step. **Make or update the lesson: one slide for each step** (for the Watch lesson; its name follows the lesson chosen) saves the steps, takes and saves a picture for each step
  that has no slide yet (into `assets/images`), then puts a slide for each step after the slide you are on, as one undo step: a heading ("Step 3 of 8"), the step's words with a voice that says them, the picture, and a frame round the place to point at. The picture's description is yours: it is used only for a step you ticked as checked, and the
  Problems panel asks for it on the others. A step that already has a slide is brought up to date (below); with nothing changed, pressing the button twice does nothing the second time. Each slide says which recording and step it came from, and what was made (`provenance`). The pure parts are `editor/src/steppicture.ts` (names and sizes), `editor/src/stepslides.ts` (the slide) and `Model.makeStepSlides`;
  the shell saves the picture (`save_step_picture`: a real PNG, a safe name, never overwriting).
  **The three lessons.** The review dialog's **Lesson** choice makes **Watch** (as above), **Practice** or **Test** from the same steps (`editor/src/steplessons.ts`). *Practice:* for a click, the picture with a hotspot over the place (named by the step's words) and another named "Anywhere else on the screen"; pressing the right one says so and offers Next step; pressing the other counts a try (one number variable, `practice tries`) and gives a hint, and the third try outlines the place, as **Show me** does at once; for typing, a short-answer question worth no points. *Test:* each click is a scored hotspot question (one point, one try, no hints) with the place among up to four other areas of the picture, each with its own label; typing is a scored short answer; the score is the course's quiz score, so add a results box after the last question. A step with nothing to point at or type (a key, a change of program, a marker) is shown as in Watch.
  Each lesson names its own capture in `provenance` (`name.capture`, `name.capture#practice`, `name.capture#test`), so all three can be in one course. Pressing the button again makes the missing slides, each in its place among the lesson's slides, and **brings the others up to date** (`editor/src/stepbase.ts`): if a step's words, picture or place to point at changed, or the steps were reordered, the slide is made again from the step, field by field. A field you changed yourself stays yours (and is reported); a part you deleted stays deleted; whatever you added is never touched; a voice you chose for the words stays, and only the words come forward. A slide for a step that is gone is taken away only if you never changed it, and the dialog says what it will change or take away and asks first. A new picture is taken only when the step's moment or take changed; until it is, the slide keeps the picture it has. Headings such as "Step 3 of 8" are renumbered when steps move, unless you edited the heading. Slides made before format 0.27.0 do not know what was made, so they are left as they are, and the dialog says which (delete one and make the lesson again to bring its step in). For a typing step there is a field for **What was typed**, the answer Practice and Test accept. The slides are built by `buildPracticeSlide` and `buildTestSlide`, and `Model.makeStepSlides` puts them in.
- **Where the recorder is.** `OPENSTAGE_CAPTURE` names the program, in the same style as `OPENSTAGE_NODE` and `OPENSTAGE_PYTHON`. If it is not set, the editor
  looks for `openstage-capture.exe` beside itself and in the repository's usual build folders. If the program cannot be found the answer is a plain
  message that says what to do, and a setting that points at nothing is an error that names the setting, not a quiet fall back.
- **A program that runs for as long as the author works.** Publishing runs a program to the end and reads its answer. A recording needs commands while
  it runs and a live picture of what it is doing, so the shell keeps the program's input open, reads its output a line at a time as it prints, and
  gives the page each line as it arrives (a `stream-line` event). A command from the page is checked to be one short line of JSON before it is sent. The
  shell does not read the protocol: lines pass through untouched, and the page decides what they mean, so unknown kinds of line are simply ignored.
  The run's end arrives as a `stream-exit` event with the exit code, what the program said on its error channel, and whether it had to be ended by force.
- **Stopping.** **Stop** sends the stop command, closes the program's input, and waits up to ten seconds for it to finish and print its result. Only then
  is it ended by force, and the page is told which happened. Closing the editor stops a recording the same way (with three seconds).
- **One recording at a time, and heavy work waits.** The recorder has a slot of its own, separate from the preview-or-publish slot, so a second recording
  is refused politely. While a recording is going and has not been paused, a publish, preview or narration run is refused with a plain message
  ("Pause or stop it, then try again"); editing and saving are never held back. The page says when the recorder pauses or resumes, because the shell does
  not read the protocol.
- **Keys that work in other programs.** Recording happens in another program, so start, pause, stop and start again have to work from there. The page
  gives the shell key combinations and the shell registers them with the system, and each press reaches the page as a `hotkey` event carrying the key's
  name. Each combination comes back with whether it worked and, if not, why: it must use Ctrl, Alt or Shift (or be a function key on its own) so it is not
  pressed by accident while typing, two cannot share keys, and another program may already use it. The starting keys are Ctrl+Shift+F9 (start),
  F10 (pause or resume), F11 (stop) and F12 (start again). A screen reader keeps Insert and Caps Lock as its own key, so `recorder.ts` warns about a
  combination that uses one, and about the Windows key. Every key is let go when the window closes.
- **Playing a large video.** A recording can be hundreds of megabytes or more, and reading it into memory to play it would be slow or fail. The editor
  can open a project's `assets` folder to the page, which then plays files from it straight from disk, with seeking (`mediaUrl` in `backend.ts`).
  Only a folder that is a project is opened, only its `assets` folder, and nothing else on the computer: a video beside it, in the project's top folder,
  or elsewhere is refused. A project opened during a session stays opened until the editor closes.
- **Tried in the real app**, with a stand-in recorder: lines arrived as the program printed them, commands were echoed back, a second start and a publish
  during a recording were refused, Stop finished the program in a few milliseconds with its result, the registered keys reached the page while a different
  program had the focus, and a 2.8 GB video played and seeked with about 14 of its 150 seconds buffered.

## Design notes

- Controls that are unavailable use `aria-disabled`, so focus is not lost when one becomes
  unavailable while it has focus.
- The slide on the canvas is drawn for the eye and marked `inert`. A screen reader author uses the
  lists and the Properties panel, which carry the same information.
- Deleting is not confirmed, because every change can be undone with Ctrl+Z. The editor says so
  when it deletes.
- When a value in the Properties panel changes, the panel updates in place, so the field the author
  is in keeps focus and its cursor. It is rebuilt only when it needs different controls.
- The validator is still Python. Rewriting it in Rust, so the editor needs nothing installed, is the
  planned next step for that piece.
- Preview and Publish find `player/publish.ts` by looking upward from the program, so the editor has to sit
  inside the repository for now. A preview is laid out in `%TEMP%\openstage-author-preview`, with the
  project's assets and narration audio linked in (hard links where the drives match, copies otherwise), and
  `OPENSTAGE_NO_BROWSER` makes the "open in browser" step do nothing, for automated tests.
- `window.__openstageTestPick` is a test seam: set it to a function returning a path, and the file
  dialogs return that instead of opening. Automated tests of the real app use it, because a native
  dialog cannot be clicked from a script. Nothing in the app sets it.
- `editor/dev-server.mjs` is a plain-browser stand-in for the Rust commands, used to test the web
  side. It is not part of the product.

## Known limits

- Accessibility of the Tauri web view on macOS and Linux (WebKit) has not been tested. On Windows it
  is WebView2, which is Chromium.
- Screen reader testing with NVDA is still to be done.
- Audio is never deleted: changing a word leaves the audio for the old words in `.cache/narration`. It is derived
  data, so it can be deleted by hand whenever you like, and it is not part of the project that is saved or shared.
- The first audio the speech engine makes can be slow while it loads its model, and the editor shows no percentage,
  only that it is working. Downloading the model for someone who has not got it is part of the installer, still to do.
- Preview and Publish need Node.js on the computer, and Publish needs Python. The editor says so if one is
  missing. Packaging the editor so neither is needed is a later step (see the roadmap).
- In the app, an image from the assets folder is read by a Rust command and shown as a data URL. The
  plain-browser stand-in uses temporary blob URLs instead.
