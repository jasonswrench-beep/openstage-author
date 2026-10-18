# The learner accessibility panel

Every published course (and every Preview) has an **Accessibility** button in its navigation bar, beside Back, Next and Credits. A learner presses it to change how the course looks and sounds on their own computer. It is there in every course
and cannot be switched off: it is the learner's, not the author's, and nothing about it is in the course format.

## What a learner can do

- **Text size**: 100% (the course's own), 125%, 150%, 200% or 300%. The slide is shown in one column (the same layout it uses on a phone or when the page is zoomed in, see `player/src/reflow.ts`), so bigger text is never cut off by the box it was drawn in.
  Pictures, shapes and video keep their size; the words, the buttons, the narration controls and the navigation grow.
- **Space between lines**: the course's own, wide (1.5 times the text size) or wider (twice). **Space between letters and words**: the course's own, wide (0.12 em and 0.16 em, the amounts WCAG 1.4.12 names) or wider (0.2 em and 0.3 em).
  Either one also puts the slide in one column.
- **Colours**: the course's own, **dark**, **high contrast** (white on black) or **yellow on black**. Each sets a few colours, and the course's own colour variables follow them, so everything built from those follows too; the words of every object, shape fills,
  buttons and the player's own controls are set to the same colours. Pictures and video are left alone. Contrast, from the player's own contrast function: dark text on background 15.2 to 1, its muted text 11.2, its button text on accent 9.4, its links 8.2; high contrast 21 to 1;
  yellow on black 19.6 to 1; the panel itself at least 9.7 to 1 in the course's colours.
- **Reading line**: a band that follows the pointer, or the part of the page the keyboard is on (whichever was used last), to keep a place. It is a light tint with two lines, so the words under it stay readable.
- **Read aloud**: reads the words on the slide that have no recorded voice (a score, the name typed for a certificate, a table, a quiz question that has no narration) with a voice that runs on the learner's own computer, in the course's language, at a
  speed they choose. It starts only when the learner presses the button (Escape, or the same button, stops it), it does not start while the course's narration is playing, and it stops when narration starts or the slide changes. A voice that sends the words
  to a service is never used, and where the computer has no voice for the language the button says so. A screen reader user does not need it, and the panel says so; nothing speaks by itself, so it never talks over a screen reader.
- **The transcript**: **Show the transcript** opens it in a window; **Download the transcript** saves it as a plain text file named from the course's title. It goes slide by slide under each slide's title: the narration and the audio descriptions of videos, the text
  on the screen, tables, the title and text of every item in an interaction, and the transcripts the author wrote for videos and sounds. What is said and shown twice is written once. **Quiz questions are left out**: a slide with one shows only its title and a note saying
  so, because the question's words are usually a text object beside the answer choices and cannot be told from other text, so nothing else from that slide is given either. Scenarios, survey fields and buttons are not in it.
- **Put everything back** returns every choice to the course's own, and forgets them.

## How it behaves

- It is a button and a panel, not a pop-up: the panel sits beside the slide, so each change is seen as it is made. The Tab key reaches it like any button, Enter opens it and puts focus on the panel (named "Accessibility"), Tab moves through labelled controls (selects, a check box,
  buttons), and **Escape closes it and puts focus back on the button**. Nothing traps focus. Every change is announced in words ("Now text size 150 percent, colours: dark.").
- The choices are kept on the learner's computer (the browser's `localStorage`, under one key, `openstage.accessibility.v1`) so they apply to every OpenStage course on that site. Where a browser or learning system does not allow that (a private window, or a course shown in a frame from
  another site) the choices last for the visit, and the panel says so. Nothing is sent anywhere, to the learning system or anyone else. A choice that is all the course's own is not stored at all.
- A saved value that is not one of the choices is ignored, so a stale setting does no harm.

## What it does not do

Translation, simplified text and summaries (they need an AI service), a dyslexia-specific font, and changes to pictures. Colour modes change the colour of text, shapes and buttons, not of pictures, so text that sits on a picture is given a solid background of its own in the new
colours. A course that has its own accessibility controls elsewhere is not changed by this.

## Where it is

`player/src/a11y.ts` (the choices, how they are written to the page and saved, the voice choice, how text is cut for a voice; tested in `a11y.test.ts`), `player/src/transcript.ts` (the transcript; `transcript.test.ts`), `player/src/a11ypanel.ts` (the panel),
`player/src/player.ts` (`applyA11y`, `unvoicedText`, the button in the navigation bar) and the end of `player/src/player.css`. It was tried in a real browser with the 24 slide lesson `examples/lms-test-lesson.osproj`: every setting, all three colour modes on an interaction and on a quiz slide,
the keyboard route in and out, the reading line following the pointer, reading aloud on the results slide (a local voice, only the unvoiced words, refused while narration played), the transcript window and the file's name and contents, reset, remembering across a reload, and a phone-sized window.
Not tried: a screen reader (see `docs/screen-reader-pass.md`, patterns 12 and 13), other browsers than Chromium, an LMS that blocks `localStorage`.
