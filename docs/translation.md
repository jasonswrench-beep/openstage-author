# Translating a course

OpenStage does not translate for you. It makes a file a translator can work on, in the standard translation format (XLIFF 1.2), and
brings the translated file back as a new copy of the course. Any tool that reads XLIFF can do the middle step, such as OmegaT (free)
or Weblate.

Nothing about the course changes. The translated course is a new project folder beside the original, named after it and the
language (`Intro.osproj` into French is `Intro-fr-FR.osproj`).

## In the editor

1. Open the course and choose **Translate...** in the **File** menu. The project is saved first, because the file is made from what is on disk.
2. Type the language to translate into as a language tag (`fr-FR`, `es-MX`, `de`, `en-GB`), or pick one from the list.
3. Choose **Make the translation file...** and say where to save it. It is named `Intro-fr-FR.xlf`. The dialog says how many pieces of
   text and words it holds. Give the file to the translator.
4. When the translated file comes back, open **Translate** again and choose **Bring in a translated file...**. The dialog says how many
   pieces were put back, which were left in the original language and why, which translations were refused, and what the checker
   finds in the translated course.
5. Open the translated course (`Intro-fr-FR.osproj`). Its narration scripts are marked as French, but the voice is still the English
   one: choose a voice for the language, make the audio, and publish.

**Make a pseudo-translation to try the course with** fills every target for you with accented, longer text (`[Ŵĥàţ ìš ...]`), so you
can bring it straight back and look at the result without a translator. Text that does not fit shows up, and anything that is still
plain English was never in the file (see "What is not in the file").

## From the command line

```
python tools/xliff.py export PROJECT_DIR OUT.xlf --to fr-FR [--pseudo] [--json]
python tools/xliff.py import PROJECT_DIR FILE.xlf (OUT_DIR | --into PARENT_DIR) [--language fr-FR] [--json]
python tools/xliff.py uncovered PROJECT_DIR
```

`--into PARENT_DIR` names the new folder for you (`Intro-fr-FR.osproj` inside `PARENT_DIR`); `OUT_DIR` names it yourself. The new folder must not
exist or must be empty: the tool never writes over anything. `uncovered` is for people who change the format: it lists any text
in a project that the file would not carry and that is not known to be an id, a name or a setting.

## What the file holds

Every piece of text a learner reads or hears:

- the course title, section names, the names and roles of the people in the cast and the descriptions of their pictures, slide names;
- every text and scrolling text, one unit for each paragraph, heading, list item or quotation, with bold, italic, links and line breaks
  as tags;
- **the player's own words**, as a group at the end: every button, label, hint and message the player says that is not the course's
  (Next, Back, Listen, Check answer, "Slide 2 of 9", the accessibility panel, the quiz and certificate messages, and about two
  hundred and seventy more). They are listed in `tools/player-text.json` with the English each starts as and a note on where it is
  used, and they come back as the course's `playerText` (see "The player's own words" in the format spec);
- button labels, table captions and cells, timer labels, results messages, certificate wording, download titles and descriptions;
- alt text, transcripts and narration scripts;
- all the words of interactions (each item's title, text, picture description and narration script), inputs (prompts, choices, scale
  labels, statements), scenarios (situations, lines, choices, responses, meters, reflection) and quiz questions (choices, extra
  wrong options, the items to put in order, both sides of every match, the word bank, the blanks' accepted answers, the text with its
  blanks, the places on a picture).

A piece of alt text, or a narration script, that says exactly what the words next to it say (a button whose alt text is its label, a
heading whose alt text is its words) is not a unit of its own: it follows the translation of those words, so the two cannot drift
apart (WCAG 2.5.3, label in name).

## What the translator must keep

- **Tags.** Bold, links and line breaks appear as small coloured or bracketed tags in the source. Keep every one. Moving a tag to where
  the same words fall in the translation is right and expected. A translation that loses a tag, adds one, or crosses two is refused.
- **Placeholders.** `{1}` in a fill-in-the-blank text, and `{{$score}}` or `{{Name}}` where the course shows a value (two braces each
  side), must stay exactly as they are.
- **The source text.** Do not change it. The import checks it still matches the course, and leaves a unit alone if the course has been
  edited since the file was made.

## What the import checks

Every unit is checked before it is put back: the source in the file is the course's source, the markup matches, the placeholders match,
and it is the right kind (plain text cannot hold tags). Whatever fails is left in the original language and listed. A file with a
document type or entity declaration is not read at all. Once the course is made it goes through the same checker as the editor's
Problems list, and anything that is an error in the translated course and was not one in the original is listed.

## What is not in the file

- **Lines of the credits page that come from the course's list of assets** (`assets.json`): the title of a picture, who made it and its
  licence. They are data the author recorded when the picture was added, not words the player or the course says. The credits for the icons
  and for the narration are in the course's language, because the player's words make them.
- **How a language counts.** A phrase that counts something has a form for exactly one and a form for any other number (`.one` and
  `.other`), which is right for English, French, Spanish, German and most others. A language that needs more forms (Polish, Russian, Arabic)
  uses the closest of the two.
- **Caption files** (WebVTT). They are separate files and the import says which the course uses. Translate them as their own files.
- **Names and settings**: object names, ids, variable names and values (they are logic, and a changed value would break a rule), file
  names, pronunciation entries, voices.
- **Right-to-left layout.** A course in Arabic or Hebrew has its words, but the page is not mirrored.
- **Words inside pictures.**

## The player's own words

Every phrase the player says has a key (`nav.next`, `quiz.check`, `a11y.readAloud`...) and its English in `tools/player-text.json`. A
course's `playerText` replaces any of them; a key left out keeps its English. Phrases hold `{places}` that the player fills in
(`Slide {n} of {total}`); a translation must keep exactly the same places, and the checker refuses one that does not. The same words are in
the translation file, so a translator does them together with the slides. Course words and the player's words are told apart in the file
by their group.

A way to see what is missing: make a **pseudo-translation** (every word accented, in square brackets), bring it back, publish it and open it.
Anything on screen that is still plain English is a word that never reached the file.

## Not tried with a real translation tool yet

The file is checked against the XLIFF 1.2 structure and is made and read back by the same tool, but it has not been opened in OmegaT,
Weblate or another real tool yet (see `TESTING-TODO.md`). The tags are carried as `<bpt>`, `<ept>` and `<ph>` elements whose content is
the literal tag, the form every XLIFF 1.2 tool is built to keep.
