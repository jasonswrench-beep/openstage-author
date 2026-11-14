# Bringing a .pptx slide deck in, and keeping it up to date

OpenStage Author can bring in the slides of a .pptx slide deck (a `.pptx` file) and, when you change the presentation later, bring the changes forward without losing what you did in OpenStage.
It never changes your presentation. Online slide programs work too: download the presentation as a .pptx file, and use that file.

## Bringing slides in

1. Open the project, and choose **PowerPoint slides...** in the **File** menu.
2. Choose the `.pptx` file. (An older `.ppt` file has to be saved as `.pptx` in the slide program first.)
3. If the presentation has speaker notes, the first thing on this screen is a box, **Use speaker notes as narration** (it starts unticked: tick it if you want them; see below). Then choose the slides you want. Hidden slides start unticked. They go after the slide you are on.
4. Read the report. It tells you what came across and what did not.

Try it with `examples/powerpoint/Introduction to Communication.pptx`.

## What comes across

- **Slides**, in order, named by their title.
- **Text**: a title becomes a heading; bulleted and numbered lists stay lists, with their levels; bold, italic, underline and links stay. A box that has more than one size or colour keeps them: the colour and size most of its words have are the box's, and a part with another colour or size is marked (a colour as it is; a size as a share of the box's, so the box can still shrink to fit). Each colour is checked for contrast against the background like the box's own.
- **Pictures**, with the alt text you wrote in the slide program. The picture files are saved in the project's images.
- **Tables**, with their first row or column as headers.
- **Shapes and lines**, with their fill and outline. A shape with no alt text is marked decorative, as a new shape in this editor is.
- **Backgrounds**. A picture that repeats across the background (tiled) is drawn as the picture's average colour, which is plainer than the deck; the report counts those slides. A picture behind the text becomes a decorative picture at the back, and the slide gets that picture's average colour, so the Problems list can check that the text is readable. It is a guess: look at those slides yourself.
- **What the layouts and the master draw on every slide**: a logo, a colour bar, a corner mark. They come in behind each slide's own shapes, as decoration (hidden from a screen reader), unless the slide or its layout turns them off ("hide background graphics"). A slide number or date the slide program fills in is not brought in (the shape it sat on is, empty). Shapes that are turned or flipped as a group (a thin group turned a quarter makes a bar across the slide) are placed where the slide program draws them.
- **A title that is placed off the slide.** When a picture is the title people see, a deck often keeps a real title off the edge of the slide so a screen reader still has a heading for the slide. That title comes in as it is: a heading, first in reading order, in the page for a screen reader and not seen on the slide. The report counts those slides, and the picture keeps its alt text (the same words as the title, which is what the slide program does too).
- **Reading order**: the order the slide program reads a slide aloud, which is the order the shapes are in. The Objects list shows it, and it is also the tab order.
- **How words sit in their box**: where they start (top, middle or bottom), the room round them, the space between lines and paragraphs, and "shrink text on overflow", which shrinks the words here too when they do not fit, because a web page draws type a little differently from a .pptx file and its fonts are mostly not on a learner's computer. Empty paragraphs used for space become space.
- **Speaker notes, if you choose them as narration**: tick **Use speaker notes as narration** and each slide's notes become the narration of its heading (or its first text, or its first object that is not decoration), in the voice the rest of the course uses, one sentence at least for each paragraph. The words are not shown on the slide. **Where to find them:** click an empty part of the slide (or press Escape to select nothing), and **Narration on this slide** is the first thing in Properties, with the words ready to read and change; or select the heading and look at **Narration** in Properties; or open the **Narration** window (the toolbar), which lists every one slide by slide; or, in the played course, the accessibility panel's **Show the transcript**. **The sound** is made when you generate narration, like any other narration, and you can change the words or the voice in Properties. The notes come in as words whether or not a voice is installed; without one the course is silent. When the notes have come in, the last screen says so, and its button (**Set up the narration voice...**, or **Make the audio...** when a voice is ready) goes straight to the Narration window, where **Install the narration voice...** has the keyboard (about 670 MB, once, asked first; see `docs/narration-setup.md`). Notes are not brought forward when you bring a presentation up to date.
- **Slide transitions**: a slide's transition becomes how the slide comes in (**Slide animation (in)** in the slide's Properties, with nothing selected). A fade, a zoom, a push and a wipe come across as themselves (a push toward the left brings the next slide in from the right; a wipe toward the left shows it across from the right); a cover or pull is a slide in from the same side, which is near; every other effect (blinds, checkerboard, vortex and the rest) is a fade, and the report counts those. The time is the deck's own number if it has one, else from fast, medium or slow. The slide program has no way out for a slide, so **Slide animation (out)** is left for you. A learner whose device asks for less motion, or who turns animation off, sees none. Changes to a transition are not brought forward when you bring a presentation up to date (a slide new to the course comes with its transition).
- **Text that builds one paragraph at a time**: a text whose effects are for its paragraphs ("By paragraph") comes in, or goes away, one paragraph at a time here too. Each paragraph is an item of **Show next item** (or comes by itself, at the pace you chose), in the order of the slide program's clicks; paragraphs that share a click show together; a paragraph with no effect is always there; and one that is not showing keeps its room, so the lines round it do not jump, as in the slide program. In a list, a bullet with bullets under it takes them along (the slide program's "by first level paragraphs"). How each paragraph arrives or leaves is the first effect the deck gave (Appear, Fade, Fly In, Wipe and Zoom as themselves, the rest as a fade). In **Properties > Paragraph by paragraph** each paragraph's item numbers can be changed, and **Show all the text together** turns it off.
- **Exit effects**: an effect that makes something go away comes across too. One at a click is "goes away when the learner shows that item" (a click that only has things going away is still an item to press); one at the same click as the object's entrance, or one that starts by itself after an entrance that does too, is a time to stay; an exit on an object with no entrance means it is there from the start and goes at that click or time. Disappear is no effect, Fade is a fade, Fly Out and Wipe leave toward the side they were told to, and the rest fade out (the report counts those). An exit that starts by itself while its object waits for a click, or that comes before the object does, cannot be matched and is left out (also counted). So layered pictures that replace each other work: each goes when the next one's click comes.
- **Entrance animations**: an effect that makes something appear comes across. One that waits for a click becomes "when the learner shows the next item", numbered in the order of the slide program's clicks. A course has no presenter to click, so when a presentation has such slides the slide-choice screen asks, under **Animations that wait for a click in PowerPoint**, how they come in: **by themselves, one after another** (the starting choice: the first after 2 seconds, then one every 3, both yours to change) or **wait for the learner**, who presses a **Show next item** button (the slide program's click anywhere becomes a button anyone can reach by keyboard). By themselves, the learner can still **Pause timing**, press **Show next item** to bring the next one at once, or **Show everything now**, and a screen reader says each item as it comes ("Item 2 of 7 is showing: ..."). The choice can be changed later for a slide: with nothing selected, its **Timing** has **Show the items one after another by themselves**, with the pace (see `docs/format-spec.md`, `autoSteps`). One that starts by itself in the slide program becomes a time after the slide opens. Appear, Fade, Fly In, Wipe and Zoom come across as themselves (Fly In and Wipe from the side the deck says); every other entrance (Split, Circle, Bounce and the rest) fades, and the report counts those. OpenStage keeps its effects few and gentle on purpose. Layered pictures that appear one at a time work this way.

## Changing the words after they come in

Select a text and use **Edit text...** (or F2, or double click it): the words open in a box with buttons for bold, italic, underline, links, bulleted and numbered lists, how deep a list item is, and headings, so the lists and paragraphs of a slide can be changed in the editor. Shrinking to fit and where the words start in the box are in the text's Properties too. Pictures, tables and shapes are changed in their own Properties. See `docs/editor.md`.

## What does not come across

Charts, SmartArt, embedded objects, movies and sounds (each is named in the report), slanted lines, emphasis animations and motion paths (they are counted in the report; what they would have moved or removed stays as it is), animations started by clicking a shape, dates, footers and slide numbers, and hidden shapes. Speaker notes are not brought in unless you tick the box. Fonts a web page cannot count on (Calibri, for one) are replaced by the course's own font. A cropped picture is shown whole. Merged table cells are shown as separate cells.

## Nothing is made up

If a picture or a table had no alt text in the slide program, it has none here, and the Problems list asks for it. The best time to write alt text is in the slide program, with its Accessibility Checker: it then comes across, and comes across again every time you bring the presentation up to date. Titles matter too: use each slide's title placeholder, so each slide has a heading and a name.

## When the presentation changes

Choose **PowerPoint slides...** again and choose the changed file. The dialog works out which earlier import it is a newer version of. It then lists the changes since, each with a box:

- A **changed** shape, which you did not touch, is ticked: its new text, position, picture or colours come forward. Anything you added to it (rules, narration, a look) stays.
- A change to **when things appear or go away** is ticked, one item per slide, and says in words what each object does now ("Headline 1: Appears when the learner shows item 1, then stays becomes Appears when the learner shows item 2, then goes away when the learner shows item 3"). It covers the timing and the animation effects the import gave the shape. If you changed the timing or animation of that object yourself, it is unticked and says so, and your version stays unless you tick it. A shape that is new comes with the animation the presentation gives it, and an effect the presentation took away takes the animation off.
- If you brought the **speaker notes in as narration**, and the notes change, the narration's words are updated (ticked) and the voice is kept. The audio is not made again for you: the item says it has to be made again. Notes taken out take away what that object says. If you changed those words yourself, it is unticked.
- A change that would **replace something you changed** is unticked and says so. Tick it only if the presentation should win.
- A shape the presentation **removed** is ticked only if you did nothing to it. If it has a rule or narration of yours, it is not.
- A **new** shape or slide is ticked. A slide you left out when you first brought slides in, or deleted since, is unticked.
- A slide the presentation **no longer has** is unticked.

Anything you leave unticked is offered again next time. A shape you deleted stays deleted. New objects and layers you made in OpenStage are never touched: put what you add on the slide, and it survives every update. It is one step to undo.

The order of the slides is not changed. If the presentation has them in a different order, the dialog says so.

## Why not both ways?

The slide program and OpenStage describe things differently: an OpenStage object carries rules, timing, narration and a tab order that the slide program has no place for. Changes are brought one way, from the presentation into the course, and what you add stays yours. The reasons are in `docs/format-spec.md`.

## Tips

- Keep one presentation per module, and bring it in once. Changing the file name does not matter; the slides are found by the slide program's own numbers.
- If you rebuild a slide in the slide program (delete it and make a new one), it counts as a new slide.
- The **Problems** list may say that a slide mixes imported and new objects. That is only information: it is what happens when you add things to an imported slide.
