# Slide sets

A **slide set** is some slides of a course handed to someone else as **one file**, so they can add them to their own course. It is how a game, a scenario or any group of slides you made can be shared with another person who uses OpenStage Author. It was asked for on 2026-10-21 ("it's all open, so sharing is always best"), and it came out of the games work: a game is slides, variables and rules, and all three have to travel together.

A set is data only: slides (in the course format), pictures, sounds, video and captions, and plain words. Nothing in one is ever run.

## Sharing slides

In the **Slides** panel, the **...** menu's **Share slides...** (also in the File menu) opens a dialog:

* choose the slides (the one you are on starts chosen; **Choose all the slides** and **Choose none** help);
* give the set a **name**, say **who made it**, say **what it is for** in a sentence or two, and say **what others may do with it** (its licence, in your own words, for example "Free to use and change, with credit to the author" or "Public domain");
* press **Choose where to save it...**, choose a place, and the file (ending `.osset`) is written.

What goes into the file:

* **The slides you chose**, in the order they are in your course.
* **Their variables**: every variable a slide's rules, conditions, inputs, scenario or texts use, with its starting value. (A text that shows a value, `{{Tries}}`, brings the variable it names.)
* **The people** of a scenario or a choice of character, with their pictures.
* **The pictures, sounds, video and captions** the slides use, and the record of where each came from (its credit), so the credits page can still name the maker.
* **The course setting a game needs**: a set made from a course that counts as complete at the last slide says so.

What is left out: your theme (the set uses the colours and fonts of the course it is added to; a slide that names a theme colour follows that course's theme), your narration audio (the scripts are kept, and the audio is made again where the set is used), anything about where a slide came from (a recording, a .pptx slide deck), and a rule that leads to a slide you did not choose (it would go nowhere; the editor says how many it left out).

Your project is saved first, because the file is made from what is saved. Nothing in your project changes.

## Adding slides from a file

**Slides from a file...**, in the Slides panel's **Add** menu (**Add slides from a file...** in the File menu), asks for an `.osset` file, checks all of it, and shows what it holds: who made it, what it is for, what others may do with it, how many slides, variables, people and files, and the names of the slides. **Add** puts the slides after the slide you are on, as **one step to undo**.

What happens when they come in:

* Every slide and every object gets **an id of its own**, so nothing can clash with your slides. A rule that leads to another slide of the set follows to its new id.
* Every **variable of the set becomes a new variable of yours**, so the same game added twice does not share what it remembers. If a variable's name is taken, a number is added (`Tiles played2`), the editor says so, and a text that shows that variable is changed to use the new name.
* The set's **people** are added to your cast. A person your course already has is the same person only if they have the same name; if it is a different person with the same id, the set is refused, in words, and nothing is changed.
* The **files** are copied into your project's `assets`, under names not already used there (never over a file of yours). Their credits come with them, and if any of them must be credited, the credits page is turned on, and the editor says so.
* If the set needs the course to count as complete at the last slide and yours counts every slide, that is changed, and the editor says so (the same as the ready-made games).
* If the slides were made for a different stage size, the editor says so.
* The slides are ordinary slides afterwards. Nothing is tied to the file.

A set that is not good is refused before anything is changed, with a message that says why (see What is refused).

## The format

A set is a zip file (the editor saves it with the ending `.osset`; a zip file renamed `.osset` is read the same).

```
my-set.osset
  set.json              what the set is
  slides/
    slide-001.json      one file per slide, as in a project
    slide-002.json
  assets.json           optional: where the files came from, as in a project
  assets/
    images/             png, webp, jpg, jpeg, gif
    audio/              mp3, wav, ogg, m4a
    video/              mp4, webm
    captions/           vtt
  README.txt            optional
```

`set.json`:

| Field | What it is |
| --- | --- |
| `setVersion` | `1`. A set with another number is refused with a message to update OpenStage Author. |
| `id` | 3 to 60 lower case letters, digits and hyphens, starting with a letter. |
| `title` | 1 to 80 letters. What the dialog calls the set. |
| `description` | Up to 400 letters, or empty. |
| `author` | Up to 80 letters, or empty. |
| `licence` | 1 to 300 letters. **Needed.** What others may do with it, in the author's words. |
| `created` | A date such as `2026-10-21`, or empty. |
| `schemaVersion` | The course format the slides are in, such as `0.31.0`. An older set is brought up to date when it is read; a newer one is refused. |
| `stage` | `{ "width", "height" }`: the stage size the slides were made for. |
| `completion` | `"last"` if the slides need the course to count as complete at the last slide, otherwise `null`. |
| `slides` | The slide ids, in order, each with a file in `slides/`. 1 to 200. |
| `variables` | The variables the slides use, in the course format (`id`, `name`, `type`, `initial`). |
| `characters` | The people the slides use, in the course format. |

## What is refused

`tools/slideset.py` (the one place that decides what a good set is) refuses a set, and keeps nothing of it, if:

* it is not a zip file, or has no `set.json`, or `set.json` is not valid or names a `setVersion` this program does not know, or a format newer than this program reads;
* it holds anything but `set.json`, slides, `assets.json`, `README`, and pictures, sounds, video and captions of the kinds above. **No web page, no program, no script and no SVG** (a vector picture can hold script);
* a name inside it is not a plain place inside the set (a path that climbs out with `..`, a drive letter, a backslash, a hidden file, a link), or two names differ only by capital letters;
* a picture is not really the kind of picture its name says, judged by what is inside it;
* a file is larger than 100 MB, the whole set is larger than 250 MB, or it holds more than 3000 files;
* a slide `set.json` lists is missing, or one is there that it does not list, or a slide is not valid JSON;
* its slides, taken as a small course, have a problem that stops them being used (the course's own checker runs on them). A contrast finding is not a reason to refuse, because colours are judged against the theme the set is used with, which is not known when it is read; the editor's Problems list judges them once the slides are in.

`Share slides...` runs the same check on the file it has just made, so a set that could not be used is never handed on.

## Where this fits

* **Character packs** (`docs/character-packs.md`) are pictures: people and backgrounds. A set can carry the pictures it uses, and a person from a pack.
* **Game sets** (`docs/game-templates.md`) are the games that come with the program. A game you made, or changed, can be shared as a set.
* **Reusable components** (a slide or object kept linked to its original, so a change reaches every copy) are a different thing and are not built. A set is copied in, and is then yours.
* **Finding sets** is up to people for now: a file can be sent by email or put on a web page. A place to download sets from, with a check before they are listed, would follow the way character packs are meant to.
