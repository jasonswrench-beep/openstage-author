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
handle could only resize one of them: Alt and the arrow keys say so, and sizes are typed in Properties one object at a time.
Dragging any selected object, or the arrow keys, moves them all together (one Undo step), and clicking one of them without dragging narrows the
selection to it. The Properties panel then offers **Line up** (Left, Centre, Right, Top, Middle, Bottom) and **Space out evenly** (Across, Down,
which needs three or more; the outermost two stay put). Line up lines the objects up with each other, changes only where they sit and never
their sizes, and is one Undo step. With one object selected, the same Line up buttons are in its properties and line it up with the slide.
A rotated object is lined up by the box it would have if it were not turned. Reading order is for one object at a time, so Move earlier and
Move later are off while several are selected. Everything other than the shared actions (text, colours, alt text, rules, timing, narration)
is changed on one object at a time, so nothing about alt text or the other accessibility fields is ever changed for several at once.

**Locking.** Lock an object so it is not moved, resized, rotated or deleted by accident, for example a background panel or a title you have
placed exactly. **Lock** (Ctrl+L) is under the Objects list, and says **Unlock** when everything selected is locked; the **Locked** box in an
object's Position and size does the same for one object. A locked object shows ", locked" in the Objects list and a dotted outline with no
handles on the canvas. The lock is saved with the project (format 0.15.0), so it is still there next time. A locked object refuses dragging,
the arrow keys, Alt and the arrow keys, typed X, Y, width, height and rotation, Cut and Delete, and the editor says why. It does not stop
anything else: you can still select it, edit its text, alt text, rules, timing and narration, change its stacking order, copy it, and duplicate
it (the copy is not locked). With several selected, moving, lining up and spacing out leave the locked ones where they are and say how many stayed,
and Delete removes the others and keeps the locked ones selected so you can unlock them if you meant to remove them. Change layout and Reset layout are
commands you ask for and can still rearrange a locked object. The published course ignores locks.

**Shapes.** Add a rectangle, rounded rectangle, ellipse, triangle, diamond, arrow or line, and change
the shape later. Fill and outline colour and outline width are editable. New shapes are decorative,
so they are hidden from screen readers; untick "Decorative" and write alt text if a shape carries
meaning.

**Colours.** Wherever a colour is needed there is a palette of 24 named colours (choose one with the
mouse, or with the arrow keys and Enter), the system colour picker for any other colour, a hex box
for anyone who has a code, and a button for "none" or "default". For text and buttons the panel
also says how readable the text colour is on what is behind it, against WCAG AA.

**Rules.** Every object has a Rules section in the Properties panel. A rule reads "When ..., do ..., only if
...": *when* the learner presses a button, checks a quiz answer, the slide opens or closes, a video or audio
finishes, or any variable changes (an object only offers the events it can cause); *do* go to a slide, show or
hide a layer, set a variable, or play or pause a video or audio; and any number of conditions, which all must
hold, such as "choice is The short path" or "score is at least 3". The targets are lists, not typed: the
slides, the layers of this slide, the variables, the videos and audios on this slide. Changing the action picks
a target that suits it, and if there is none (no layers yet) the editor says what to add first. When a
variable is one an input saves to, a condition or "set to" value is chosen from that input's own answers (for
example "The short path" or "Agree (4)"), so nothing has to be typed that could be wrong. Rules run in order
from the top and a rule that goes to another slide ends the list, so rules can be moved earlier and later.
A rule that happens when the learner presses something is saved as a click and a key press together, so it
works without a mouse. A rule can belong to any object, and for "the slide opens" or "any variable changes"
it does not matter which. To branch on a survey: add the input, add a Continue button, and give the button one
rule for each path, each with a condition on the input's answer. Rules the editor cannot show (such as a
change of object state) are kept as they are and marked as such.

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
back). Once there is a script the section also has a Voice list, grouped by language ("Heart, woman"), a Speed (0.5
to 2, where 1 is normal), and a Pronunciations list for words the voice gets wrong, each a word as spelled in the
script and its IPA, which is checked as the validator checks it. The captions and the transcript come from the
script, so they always match what is said.

The audio is made on this computer by the speech engine (Kokoro), never in the editor itself, and it is kept in the
project's `.cache/narration`, each file named by a hash of the script, voice, speed, language and pronunciations. So
the editor always knows whether an object's audio exists: change a word and the audio is out of date; undo it and it is
back, because it is found again by its words. The Properties section says whether the audio exists and how long it is,
and whether the captions are timed to the spoken words; with audio, a "Listen to the audio" button plays it there. The
**Narration** button in the toolbar opens a dialog listing every narrated object, slide by slide in the order they play,
each with its audio status, a "Go to" button, and "Make audio" (or "Make all missing audio" for the lot). It works from the
project as it is on screen, saved or not, and can be cancelled; the first time can take a minute or more for each object.
If no speech engine is set up the dialog says so and still lists everything (transcripts and captions work without audio).
OPEN EDITOR.bat looks for the engine in the Audiobook Studio folder; otherwise set `OPENSTAGE_KOKORO_PYTHON` to the
Python that has Kokoro installed. Publishing also makes any audio that is missing.

**Narration of items.** Text should have audio available, so each item of an interaction can speak too: a glossary
term and its definition, the back of a flip card, a tab, a step. In an interaction's Items section each item has its own
Narration box with the same script, voice, speed, pronunciations and "Listen to the audio" as an object, and a
**Use the item's text** button that writes the narration from the item's title and text. **Narrate every item from its
text** does that for every item that has none (items that already have narration are left exactly as they are, and one
undo takes it all back). The words are then the author's to change; they do not follow the item's text if that changes
later, and asking again replaces them. The Narration dialog lists items after their interaction, each by its title with
its own status and "Make audio", and "Go to" lands in that item's script box. In the published course the item speaks
when the learner opens it and has a Listen button; see the format spec.

**Assets.** The Assets button opens a dialog with three tabs. *This project* lists every file the project
keeps (images, video, audio and captions), filtered by kind, with a picture of each image. Selecting one shows
where it is used, where it came from, and buttons to insert it on the slide, edit its credit, or delete it. A
file a slide uses cannot be deleted. Everything listed is included when the course is published, and a
checkbox switches the credits page on or off. *Find media* helps with free pictures, video and sound from the web. **No key is needed to use these sites**:
for each kind (Images, Video, Audio) it has buttons that open Pexels, Pixabay, Unsplash, Freesound, Mixkit, SVG
Repo and Libreshot in your browser. Download a file there, add it on the *This project* tab with "Add image...",
"Add video..." or "Add audio...", and use Edit credit to record where it came from, so the credits page can name
the creator. Four of the sites can also be searched from inside the editor, if you add that site's own free key
(their programming interfaces ask for one; you get it on their website and paste it into *Settings* once). Without
a key those searches say so and point at the button that opens the site.

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
has one slide for each. Not built yet: drag and drop, matching, hotspots, text entry, scenarios and
character choice.

**Quiz questions.** "Question, input or survey..." in the Add menu opens a picker, and its Quiz questions group
(multiple choice or true or false) builds the
question as a heading, the answers, and two feedback layers (right and wrong) that are already wired
to it. Select the quiz to edit its answers (add, delete, rename, choose the correct one with the
radio button), its points and attempts, and which layers give the feedback. The first answer starts
as correct, and the placeholder text is yours to replace. The validator checks that exactly one
answer is correct.

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
goes. Export a chart as a picture, add it as an Image, give it alt text that says what the chart shows, and
delete the box. A table is its own kind of object (see Tables and scrolling text) and can go on any slide, so
no layout is built around one.

Change layout can be used on a slide that already has content. The words already written move into the
new layout's places (the first title-like text box to the title, the rest in reading order to the other
places), at the size that suits each place. Nothing you wrote is deleted: text you wrote that has no place in the new layout
stays where it was, and the editor says so. Placeholders nobody has written in (still showing a
layout's own prompt such as "Add your content here."), and the old layout's coloured bars and picture
area, are removed and replaced by the new layout's own, so the slide holds only the new layout. Buttons, images and any shapes you drew are not touched. It is one undo step. Only the base
layer changes.

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
The picture area is a grey decorative box that marks where a picture goes: add an image, then delete
the box. Every layout follows the format's accessibility rules, with real headings first in reading
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
Narration audio is made for any narrated object that has none, if a speech engine is set up (OPEN EDITOR.bat
looks for Kokoro in the Audiobook Studio folder); otherwise the course has transcripts and no new audio, and
the dialog says so. The first time this can take several minutes, so the button becomes "Cancel publishing",
and Escape cancels too. When it finishes the dialog says what was made and offers "Show the package in its
folder" and "Open the course in my browser". The web-files folder also holds `_scorm-test.html`, a stand-in
LMS page for trying scoring and resume; it has to be opened from a local web server and is not in the package.

Preview and Publish both run `player/publish.ts` under Node, the same tool as the command line, in the
background, so the editor stays usable. Only one of them runs at a time. Both need Node.js installed; Publish
also needs Python, for the problem check.

Not built yet: editing a theme's own colours and fonts (only the built-in themes can be chosen) and theme
images; other kinds of question (several correct answers, matching, fill in the blank) and question banks;
drag and drop, matching, hotspot and text-entry interactions; setting an object's states (so no rule can
change a state yet); narration that is not tied to an object (a slide with nothing to attach it to
needs an object for it, such as its heading); editing formatted text beyond one paragraph or heading; and a project's `modified` date (it is not updated
on save).

## Keyboard

Every task has a route that needs no pointer. The canvas keys are a convenience on top.

| Where | Keys |
| --- | --- |
| Anywhere | Ctrl+N new project, Ctrl+O open, Ctrl+S save, Ctrl+P preview, Ctrl+Shift+P publish, Ctrl+Z undo, Ctrl+Y or Ctrl+Shift+Z redo, F6 and Shift+F6 next and previous panel |
| Anywhere except in a text box | Ctrl+D duplicate the selected object, Ctrl+C copy, Ctrl+X cut, Ctrl+V paste |
| Anywhere except in a text box | Ctrl+A select every object on the layer, Ctrl+L lock or unlock the selected objects |
| Slide, Objects and Problems lists | Up and Down, Home and End move; Enter or Space chooses |
| Slides list | Alt+Up and Alt+Down move the slide; Delete removes it |
| Objects list | Alt+Up and Alt+Down change reading order; Delete removes the object, or all selected objects if it is one of them; Shift with Up, Down, Home or End selects a range; Ctrl+Space adds or removes the focused object |
| Canvas | Arrow keys move 1 pixel, with Shift 10, all the selected objects together; Alt+arrows resize one object; Page Down and Page Up choose the next or previous object, and with Shift add it to the selection; Delete removes the selected objects; Escape clears the selection |

Moves, resizes and selections made on the canvas are announced in a polite live region. Alt text and
the other accessibility fields are never filled in for the author.

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
