# OpenStage project format

**Version 0.1 (draft). Nothing here is stable yet.**

This document defines the OpenStage project format. It is the source of truth for the
editor, the player, the publisher and the importer. Code that reads or writes a project
file and this document change in the same commit.

## Shape on disk

A project is a directory, not a single file.

```
my-course.osproj/
  project.json           manifest: metadata, variables, theme reference, scene order
  theme.json             the project's theme: colours, fonts, slide backgrounds
  assets.json            optional: where assets came from, so credit can be given
  slides/
    slide-001.json       one file per slide
    slide-002.json
  assets/
    images/              referenced media, committed
    video/
    audio/               human-recorded or imported audio, committed
    captions/            .vtt caption files for video and audio
    documents/           files a learner can download: PDF, Word and the other kinds listed under Files to download
  .cache/
    narration/           generated narration audio, keyed by hash, NOT committed
```

One slide per file so that two people editing different slides do not collide, and so a
diff of a changed slide is readable.

`.cache/` is regenerable and belongs in `.gitignore`. A project with an empty `.cache/`
must open, render and publish correctly, regenerating narration audio on demand.

JSON rather than YAML or TOML: universal tooling, JSON Schema gives the validator almost
for free, and no indentation or type-coercion footguns in a file that is mostly written
by a machine and occasionally edited by hand.

## project.json

```json
{
  "schemaVersion": "0.14.0",
  "meta": {
    "title": "Introduction to Organizational Communication",
    "author": "",
    "language": "en-US",
    "created": "2026-10-10",
    "modified": "2026-10-10"
  },
  "stage": { "width": 1280, "height": 720 },
  "variables": [
    { "id": "var-attempts", "name": "attempts", "type": "number", "initial": 0 }
  ],
  "theme": { "ref": "theme.json" },
  "credits": true,
  "completion": { "slides": "all" },
  "scenes": [
    {
      "id": "scene-main",
      "name": "Main",
      "slides": ["slide-001", "slide-002"]
    }
  ]
}
```

`credits` says whether the published course shows a credits page (see Assets and credits). It is on
by default and shows nothing until an asset has credit to give.

`completion` is what counts as completing the course, besides finishing every quiz. `slides` is `"all"`
(the learner has seen every slide) or `"last"` (the learner has reached the last slide). A course that has
rules able to jump past a slide should use `"last"`: with `"all"`, a learner who takes that path never sees
the skipped slide and the course can never complete. The validator warns about exactly that
(`completion-skippable`). New projects start with `"all"`, and so does every project updated from 0.8.0 or
earlier, which is how they already behaved.

`stage` is the size the course is drawn at, and objects are placed on it in those pixels. The player shows it at that size, scaled
down to fit, while the window is wide enough, and shows one column instead when it is not (see Reflow, under the player's
behaviour). Nothing about that is in the project file: it is worked out from the objects' places, their reading order and whether
they are marked decorative, so no format change was needed.

## Themes

A theme is the project's look: a set of named colours, two fonts, and three slide backgrounds.
It lives in `theme.json`, and `project.json` points at it with `"theme": { "ref": "theme.json" }`.
Objects and slides do not copy theme values. They refer to them with a token, so changing the
theme restyles the whole course.

```json
{
  "schemaVersion": "0.2.0",
  "id": "classic",
  "name": "Classic",
  "colors": {
    "background": "#ffffff", "surface": "#f4f5f7", "text": "#1a1a1a", "muted": "#4a4f57",
    "accent": "#0b5fff", "accentStrong": "#0b3fb3", "onAccentStrong": "#ffffff",
    "dark": "#14213d", "onDark": "#ffffff", "good": "#1b6e3c", "bad": "#a4262c", "line": "#c9ced6"
  },
  "fonts": { "heading": "system-ui, sans-serif", "body": "system-ui, sans-serif" },
  "backgrounds": {
    "default": { "type": "solid", "color": "background" },
    "dark": { "type": "solid", "color": "dark" },
    "accent": { "type": "solid", "color": "accentStrong" }
  }
}
```

All twelve colours are required, and the other fields too. A background is `solid`, or
`gradient` with `from`, `to` and an `angle` in degrees; its colours name theme colours.

**Tokens.** A style value may be a token instead of a literal:

| Token | Meaning |
| --- | --- |
| `theme:color.<name>` | One of the twelve colours, such as `theme:color.accent` |
| `theme:font.heading`, `theme:font.body` | One of the two fonts |
| `theme:bg.default`, `theme:bg.dark`, `theme:bg.accent` | A slide background, only in a slide's `background` |

Colour tokens are valid in the style keys `color`, `fill`, `stroke` and `background`. Font
tokens are valid in `fontFamily`. A literal value is left alone when the theme changes, which
is how an author keeps a colour of their own. The player and the editor resolve tokens with
the same code.

**Slides.** A slide records `layout`, the id of the layout it was made from or `null` for a slide
arranged by hand, and `background`, a `theme:bg.*` token, a `#rrggbb` colour, or `null` for the
theme's default. Switching the theme restyles every slide through these two fields.

## A slide

```json
{
  "id": "slide-001",
  "name": "Welcome",
  "layout": "title-slide",
  "background": null,
  "duration": null,
  "baseLayer": {
    "id": "layer-base",
    "name": "Base",
    "objects": []
  },
  "layers": []
}
```

`duration` is null for a slide that waits for the learner, or a number of milliseconds
for one that advances on its own (see Timing). The base layer always exists. Additional layers are
shown and hidden by triggers.

## An object

Every object carries the same envelope. `type` determines what is valid inside
`content`.

```json
{
  "id": "obj-0001",
  "type": "text",
  "name": "Heading",
  "geometry": { "x": 80, "y": 60, "width": 1120, "height": 96, "rotation": 0, "z": 10 },
  "content": { "html": "<h1>Welcome to the course</h1>" },
  "style": { "fontFamily": "system-ui", "fontSize": 40, "color": "#1a1a1a" },
  "accessibility": {
    "altText": "Welcome to the course",
    "role": "heading",
    "tabOrder": 1,
    "decorative": false
  },
  "states": {},
  "triggers": [],
  "timing": { "appear": "time", "start": 0, "visibleFor": null },
  "animation": { "enter": { "effect": "none", "duration": 500 }, "exit": { "effect": "none", "duration": 500 } },
  "narration": null,
  "provenance": null,
  "simulation": null
}
```

### Required fields

`id`, `type`, `geometry` and `accessibility` are required on every object. The four
accessibility fields are required inside it.

This is deliberate and is the single rule most likely to be eroded by convenience. A
format where alt text can be absent produces courses where alt text is absent. A
validator error is the correct outcome for a missing one, not a warning.

`decorative: true` is the honest way to say an object needs no alt text. It is not the
same as an empty `altText`, and the validator treats them differently.

### Object types in v0.1

`text`, `image`, `shape`, `button`, `hotspot`, `video`, `audio`, `quizQuestion`, `interaction`, `table`, `scrollingText`, `input`, `embed`, `results`, `certificate`, `download`.

### Machine-readable schema

The JSON Schema lives in `schema/` (`project.schema.json`, `slide.schema.json`,
`object.schema.json`). It must agree with this document. Where they differ, fix both in
the same commit.

Required fields: every field in the examples above is required, including `states`,
`triggers`, `narration`, `provenance` and `simulation` (use `{}`, `[]` or `null`). Unknown
fields are rejected. Ids match `^[a-z][a-z0-9_-]*$`.

`content` shapes fixed by the schema in v0.1:

| Type | `content` |
| --- | --- |
| `text` | `html` |
| `image` | `src` (under `assets/`) |
| `shape` | `shape` |
| `button` | `label` |
| `video`, `audio` | `src` (under `assets/`), optional `captions` (path under `assets/`, or null), optional `transcript` (HTML, as in a text object) |
| `embed` | `provider` (`youtube` or `vimeo`), `id`, `hash`, `transcript`, `captionsConfirmed` (see Embedded video) |
| `download` | `src` (under `assets/`), `title`, `description`, `accessibleConfirmed` (see Files to download) |
| `quizQuestion` | `questionType` (`multipleChoice` only), `choices` (2 or more, each `id`, `label`, `correct`), `scoring` (`points`, `attemptsAllowed`), `feedback` (`correct`, `incorrect` layer ids) |
| `input` | `kind`, `prompt`, `report`, and the parts that kind needs (see Inputs and surveys) |
| `table` | `caption`, `headerRow`, `headerColumn`, `rows` (1 to 30 rows of 1 to 12 text cells; see Tables) |
| `scrollingText` | `html`, like a text object |
| `results` | `heading`, `passMessage`, `failMessage`, `review` (see Results and certificates) |
| `certificate` | `title`, `statement`, `achievement`, `issuedBy`, `showScore`, `showDate` (see Results and certificates) |
| `interaction` | `kind`, `orientation` (`horizontal` or `vertical`), `allowMultiple`, `items` (1 or more; see Interactions) |
| `hotspot` | not yet defined, any object accepted |

`shape` draws one of these, named in `content.shape`: `rectangle`, `rounded`, `ellipse`, `triangle`,
`diamond` or `arrow`. A name the renderer does not know draws a rectangle. `style.fill` fills it and
`style.stroke` (a colour, or `none`) with `style.strokeWidth` outlines it. The figure is drawn as
vector graphics, so it stays sharp at any size, and it is hidden from assistive technology: the
object around it carries the name, or is marked `decorative`. A line is a thin `rectangle`.

A `quizQuestion` must have exactly one answer marked `correct`, and its answers must have different
ids. The validator checks both. The object's `altText` names the group of answers for a screen
reader; the question itself is normally a heading placed before it.

### Video, audio and embedded video

A `video` or `audio` object plays a file from `assets/video/` or `assets/audio/` with the browser's own
controls. A `video` needs `captions` (a `.vtt` file under `assets/`) or a narration script. An `audio` clip
needs captions, a narration script or a non-empty `transcript`, because a transcript is what an audio-only
clip needs. The player draws captions as a real `<track kind="captions">`, and a `transcript`, if there is
one, as a native "Transcript" disclosure under the player, closed until opened. Neither plays on its own.

An `embed` plays a YouTube or Vimeo video from that service in an iframe. `provider` and `id` say which video
(a YouTube id is 11 letters, digits, `-` and `_`; a Vimeo id is digits), and `hash` is Vimeo's key for an
unlisted video, or empty. Only a well-formed id ever reaches the page. The player uses
`youtube-nocookie.com` and Vimeo's do-not-track option, and sets a sandbox, a referrer policy and no
autoplay. The object's `altText` is the iframe's title.

OpenStage cannot see inside another site's player, so an embed has two accessibility rules of its own.
`captionsConfirmed` is the author's statement that the video has accurate captions, and `transcript` is
shown under the video for anyone who cannot watch or hear it. The validator makes both required
(`embed-captions-unconfirmed`, `embed-transcript-missing`), and warns that the learner needs an internet
connection and an LMS that allows embedded players (`embed-needs-internet`). The editor shows only a
placeholder for an embed, so editing never loads anything from the web. A published course that plays an
embed must be served over `https`, or from an LMS, because YouTube refuses requests with no referrer.

### Files to download

A `download` offers a file the learner saves to their own device, such as a PDF or a Word document. The learner
is told what the file is before they download it, so the author has to say.

```json
{
  "type": "download",
  "content": {
    "src": "assets/documents/channel-checklist.pdf",
    "title": "Channel checklist",
    "description": "A one page checklist of the four questions to ask before you choose a channel.",
    "accessibleConfirmed": true
  }
}
```

- `src` is a file in `assets/documents/`. Its extension has to be one of the kinds in `tools/download-types.json`:
  `pdf`, `docx`, `doc`, `odt`, `rtf`, `txt`, `xlsx`, `xls`, `ods`, `csv`, `pptx`, `ppt`, `odp` and `zip`. Anything that
  can run, or that a browser would run as a page (`exe`, `bat`, `js`, `html`, `ps1`, `msi` and the like), is refused by the
  validator (`download-file-type`) and by the editor. The list lives in one shared file, `tools/download-types.json`,
  which the validator, the editor and the player read. The editor's native side keeps its own copy, and a test fails
  if the two differ.
- `title` is what the link is called. `description` is what the file is, in the author's words. Both are required:
  a blank `title` is `download-title-missing`, a blank `description` is `download-description-missing`.
- `accessibleConfirmed` is the author's word that the file can be read with a screen reader (a tagged PDF, or a Word
  file with real headings and descriptions for its pictures). OpenStage cannot see inside a document, so, like the
  captions of an embedded video, it asks and records the answer. `false` is `download-unconfirmed`, an error.
- The object's `altText` is the name a screen reader gives the group, for example "Course handbook, a PDF to
  download". A download is a link, so it needs a `tabOrder` of 1 or more.

The player draws the title, then the description, then the kind of file and its size ("PDF document, 1.2 MB"), then a
Download link, then one sentence about saving the file. The link is an ordinary `<a href download>` with the file's own
name: it saves the file and does not open it in place of the course, in a pop-up, or in a new window. A screen reader
reads the kind of file and the description after the link's name (`aria-describedby`). The size is measured when the
course is published and travels in the package (`fileSizes`), not in the project, so the editor's canvas shows the kind
of file but not its size. In the editor the link is drawn but cannot be followed.

The editor can write narration for a download from its own words: the title, the description, "Type of file:" and
the kind, and the sentence about saving the file. As with the items of an interaction, the narration does not follow
the description if that changes later.

Files to download are an asset kind like the others: the editor copies a chosen file into `assets/documents/`, the
Assets dialog lists them, and the whole of `assets/` is copied into the published folder and the SCORM package.
`assets.json` may record where one came from, with `kind` `document`.

### Assets and credits

Everything a project uses is kept under `assets/`, and all of it is copied into the published folder and the
SCORM package. `assets.json` is an optional record of where assets came from:

```json
{
  "assets": [
    {
      "path": "assets/images/skyline.jpg",
      "title": "City skyline at dusk",
      "kind": "image",
      "source": {
        "provider": "unsplash", "url": "https://unsplash.com/photos/abc", "creator": "Jane Doe",
        "creatorUrl": "https://unsplash.com/@jane", "licence": "Unsplash Licence", "requiresCredit": true
      }
    }
  ]
}
```

`provider` is `pixabay`, `unsplash`, `pexels`, `openverse`, `wikimedia`, `freesound`, `mixkit`, `svgrepo`,
`libreshot`, `vecteezy` (kept for projects that already name it) or `other`. A file with no entry is treated as the
author's own. When `requiresCredit` is true the creator, the source link and the licence must all be
filled in (`credit-incomplete`). The validator warns about an entry whose file is missing
(`credit-asset-missing`), and when an asset that needs credit is used while `credits` is off
(`credit-page-off`).

When the course is published, the entries for assets that slides actually use go into the package, and if
`credits` is on the player shows a "Credits" button that opens a dialog listing them: the title, the
creator, where it came from, and the licence. The dialog is native, so focus stays inside it and Escape
closes it.

### Inputs and surveys

An `input` saves what the learner chooses into project variables, which triggers can read, and can
also send the answers to the LMS. Each is built from native form controls, so the keyboard and
screen reader behaviour is the browser's own.

| `kind` | Parts | Saves | Drawn as |
| --- | --- | --- | --- |
| `checkbox` | `items`, each `id`, `label`, `variable` | one **boolean** variable per box | a group of checkboxes |
| `radio` | `variable`, `options` (2 to 12, each `id`, `label`, `value`) | the chosen option's `value` in one **string** variable, empty until chosen | a radio group |
| `dropdown` | as `radio` | as `radio` | a select with a first "Choose an option" entry that means nothing chosen |
| `list` | as `radio` | as `radio` | a select showing several options at once |
| `likert` | `scale` (2 to 9 labels, lowest first), `rows` (1 to 20, each `id`, `label` = the statement, `variable`) | the number of the label chosen, from 1, in one **number** variable per row, 0 until answered | a row of radio buttons for each statement |
| `semantic` | `points` (3 to 9), `rows` (each `id`, `label` = left word, `right` = right word, `variable`) | the point chosen, from 1 at the left word, in one **number** variable per row | a row of radio buttons between two words |

`prompt` is required. It is the visible name of the group (a `<legend>`, or the label of a select), so
a screen reader announces it with the controls. If `altText` says something different it is added as a
description. The ends of a semantic differential row are named for the word they are closest to ("1 of 7,
closest to Hard"), so a screen reader user knows which way round the scale runs.

A part's variable must exist in `project.json` and have the type in the table, and no two parts of one
input may share a variable, or they would overwrite each other. Option values must be different and
cannot be empty, because an empty value means "nothing chosen". The validator checks all of this
(`input-unknown-variable`, `input-variable-type`, `input-shared-variable`, `input-duplicate-value`,
`input-empty-value`, `input-duplicate-id`, `input-semantic-pole`).

When `report` is true the answers are also written to the LMS as SCORM 1.2 interactions, one for each
part, with no correct response and no score: a checkbox as `true-false` (response `1` or `0`), a radio,
drop-down or list as `choice` (the letter of the option, `a` for the first), and a scale row as
`likert` (the number of the point). The interaction's id is the object's id, or
`<object id>.<row id>` for a part. Changing an answer rewrites that interaction rather than adding another,
so the LMS holds the final answer. An input does not affect the score.

When a learner returns to a slide, an input shows what they chose before, because the variable holds it,
and variables are saved with the learner's progress. Reading these variables in a trigger needs a
condition on the trigger; the editor has no trigger editor yet.

An input paints itself in the theme's colours (text on `background`, controls in `accentStrong`), so
only `fontFamily` and `fontSize` are read from its `style`.

### Tables and scrolling text

A `table` is a data table. Every row has the same number of cells, and it needs a header row, a header
column or both, because without headers a screen reader cannot say which column or row a cell belongs
to. The renderer writes a real `<table>`: the optional `caption` becomes its `<caption>`, header row
cells are `<th scope="col">` and header column cells are `<th scope="row">`. The object's `altText`
names the table as a labelled region. A table taller or wider than its box scrolls, and the player
then makes it a tab stop so the keyboard can scroll it. The validator reports ragged rows
(`table-not-rectangular`), no header (`table-needs-header`) and an empty header cell
(`table-empty-header`, a warning).

A `scrollingText` object holds the same `html` as a text object in a box that scrolls. It is a labelled
region named by `altText` and a tab stop, so it needs a `tabOrder` of 1 or more.

Both paint themselves in the theme's colours (header cells in `accentStrong` with `onAccentStrong`, body
cells in `text` on `background`, header column cells and scrolling text on `surface`), and only
`fontFamily` and `fontSize` are read from their `style`.

### Results and certificates

A `results` object tells the learner how the quiz went. It holds nothing about any learner: the player fills it
in from the quiz when the slide opens. It says either how many questions are finished so far, or, once every
question is finished (answered right, or out of attempts), "You scored 40 of 50 points (80%)", then "You passed." or
"You did not reach the pass mark.", then the pass mark. `heading` is its heading. `passMessage` and `failMessage` are
the author's own words, said after "You passed." and after "You did not reach the pass mark."; either may be empty.
With `review` on, it also lists each question, named by the slide it is on, with what happened in words ("correct,
10 of 10 points", "not correct, 0 of 10 points", "answered, but not right yet", "not answered yet"), so colour is
never the only signal.

A `certificate` is for a learner who passed. Until they pass, it says why there is none. After, it asks the learner
to type their own name (nothing about the learner is stored, and the name is never read from the LMS), and a button
makes the certificate: `title`, then `statement` (such as "This certifies that"), the name, `achievement` (such as
"has successfully completed"), the course title from `meta.title`, the score if `showScore` is on, the date if
`showDate` is on (long form, in the course's `meta.language`), and `issuedBy`. A line the author leaves empty is left
out. A second button, "Print or save as PDF", opens the browser's own print, showing only the certificate in black on
white, landscape. A certificate is a control, so it needs a `tabOrder` of 1 or more. A results box is read in reading
order like text.

Both are labelled regions named by `altText`, paint themselves in the theme's colours, and read only `fontFamily` and
`fontSize` from their `style`. Both report on the quiz, so the validator warns when the course has none
(`results-no-quiz`, `certificate-no-quiz`).

### Interactions

An `interaction` is a ready-made object that presents several items in one place. The author fills in
the items; the renderer supplies the behaviour, built from native controls and following the matching
WAI-ARIA Authoring Practices pattern, so keyboard and screen reader use is the one people already know.
It needs no triggers.

```json
{
  "type": "interaction",
  "content": {
    "kind": "tabs",
    "orientation": "horizontal",
    "allowMultiple": false,
    "items": [
      { "id": "item-1", "title": "Planning", "body": "<p>Text for this item.</p>",
        "image": { "src": "assets/images/plan.png", "alt": "A calendar with three dates ringed", "decorative": false },
        "narration": null },
      { "id": "item-2", "title": "Doing", "body": "<p>More text.</p>", "image": null,
        "narration": { "script": "Doing. More text.", "voice": "af_heart", "speed": 1.0, "lang": "en-US",
                       "pronunciations": [], "audioCache": null } }
    ]
  }
}
```

| `kind` | What the learner sees | Keyboard |
| --- | --- | --- |
| `clickReveal` | Buttons, each opening its own text. `allowMultiple` lets several stay open. `orientation` arranges the buttons side by side or stacked. | Tab to a button, Enter or Space to open or close it |
| `accordion` | Headings that open and close, always stacked. `allowMultiple` chooses one open at a time or several. | As above, plus Up and Down Arrow, Home and End between headings |
| `flipCards` | Cards that turn over to show their text. `orientation` arranges the cards. | Enter or Space turns a card; focus moves to its "Flip back" button, and back to the card |
| `tabs` | A tablist and one panel, with `orientation` choosing tabs along the top or down the side. | One tab stop for the tablist, arrow keys (Left and Right, or Up and Down for vertical), Home and End; the panel is a tab stop too |
| `steps` | Numbered steps with Previous and Next, and the current step marked `aria-current`. | Tab and Enter; each step is a button |
| `carousel` | One item at a time with Previous and Next, and "Item 2 of 5" announced politely. | Tab and Enter |
| `glossary` | Terms listed A to Z (the renderer sorts by `title`) with a search box, a letter bar and the definition beside them. A letter with no terms is disabled. The search count and the definition are announced politely. | Tab through the search box, letters and terms; Enter selects a term |
| `timeline` | Events as dots along a line; selecting one shows its text. | The tabs pattern, arrow keys Left and Right |
| `processCircle` | Steps round a circle with arrows between them; selecting one shows its text. | The tabs pattern; any arrow key moves to the next or previous step |
| `pyramidStack`, `pyramidMatrix`, `circleMatrix` | A pyramid of layers, a pyramid divided into sections, or a circle divided into segments. Each piece is a button; selecting one shows its text beside the drawing. | As above |

Timelines, process circles, pyramids and circle matrices are all the tabs pattern underneath: a tablist
whose pieces are drawn as shapes, with one panel shown at a time. A screen reader announces them as
tabs, each named by its item's `title`, and the drawing itself is hidden from it. The pieces are drawn
with CSS and only the shape takes a click, so nothing depends on the picture being seen. A shape's
keyboard focus ring follows its outline.

Each kind accepts only so many items, because a drawing has only so many places for them: `clickReveal`
`flipCards` `tabs` `steps` 1 to 12; `accordion` and `carousel` 1 to 20; `glossary` 1 to 50;
`timeline` 2 to 12; `processCircle` 3 to 8; `pyramidStack` 3 to 7; `pyramidMatrix` 3 to 6;
`circleMatrix` 3 to 8. The validator reports a count outside the range (`interaction-item-count`).
`pyramidMatrix` lays its items out in rows of 1, then 2, then 1, 2 or 3 pieces.

An interaction sits on the theme's `background` colour (a rounded panel that is invisible on a normal
slide), so its text keeps the contrast the theme guarantees even on a slide with a dark background.

Nothing moves on its own, so there is no auto-advance to stop. Previous and Next at the ends of a
carousel or step process are marked disabled rather than removed, so focus is never lost. Each item's
`title` is the name of its control. `body` is HTML limited to the same tags as a text object.

An item's `image` is `null` or `{ src, alt, decorative }`. Like any image it needs `alt` text, or
`decorative: true` with an empty `alt`; the validator reports either mistake (`interaction-image-alt`).
Item ids must be unique within the object. The object's own `altText` is the name a screen reader gives
the whole group, such as "Causes of burnout", and an interaction needs a `tabOrder` of 1 or more.

An interaction paints itself in the theme's colours (buttons and selected tabs in `accentStrong` with
`onAccentStrong`, panels in `surface` with `text`), which are pairs the theme already guarantees. For
that reason only `fontFamily` and `fontSize` are read from its `style`.

An item's `narration` is `null` or a narration (see Narration), and is required on every item. It is what
the learner hears when they open that item: a glossary term read aloud, a flip card's back, a tab's text.
The principle behind it: text on the page should have audio available, so an item that shows text should
have narration. The editor can write an item's narration from its own title and text, and the player has a
Listen button for it (see Narration of items, below).

A trigger may carry an optional `value`, used by `setVariable`. Condition operators are
`equals`, `notEquals`, `lessThan`, `lessThanOrEqual`, `greaterThan`, `greaterThanOrEqual`.

Four accessibility rules that concern a single object are enforced in the schema itself:
non-decorative objects need non-blank `altText`, decorative objects must have empty
`altText`, `button`, `hotspot`, `quizQuestion`, `interaction`, `scrollingText`, `input` and `certificate` need `tabOrder` of 1 or more, and
`video` and `audio` need `content.captions` or a `narration` script. The validator reports
these with its own plain-language messages.

### States

```json
"states": {
  "hover":   { "style": { "color": "#0b5fff" } },
  "visited": { "style": { "opacity": 0.7 } },
  "disabled":{ "style": { "opacity": 0.4 } }
}
```

A state holds only the properties that differ from the normal state. The normal state is
the object's own top-level `style` and `content`.

### Triggers

```json
"triggers": [
  {
    "id": "trg-0001",
    "event": "click",
    "action": "showLayer",
    "target": "layer-feedback",
    "conditions": [
      { "variable": "var-attempts", "operator": "lessThan", "value": 3 }
    ]
  }
]
```

v0.1 action set, deliberately small: `jumpToSlide`, `showLayer`, `hideLayer`,
`setVariable`, `playMedia`, `pauseMedia`, `changeState`.

v0.1 event set: `click`, `keyActivate`, `slideStart`, `slideEnd`, `mediaComplete`,
`variableChange`.

`keyActivate` exists so that keyboard activation is a first-class event rather than
something the renderer synthesises from `click`. Any interactive object must respond to
it.

#### How triggers run

When an event happens, the object's triggers (or, for `slideStart`, `slideEnd` and `variableChange`,
the triggers of every object on the slide) run **in order**. A trigger runs only if every one of its
`conditions` holds. A trigger that goes to another slide (`jumpToSlide`) **ends the list**: the triggers
after it do not run. So when several triggers could send the learner somewhere, the first whose
conditions hold decides. Triggers before the jump still run.

Which object holds a trigger makes no difference to what it does. A trigger on any object that can reach
the learner's slide runs when its event happens; the object only matters for `click`, `keyActivate`
(the learner pressing a `button`, `hotspot`, or checking a `quizQuestion`) and `mediaComplete` (a `video`
or `audio` finishing). A `variableChange` trigger is checked each time any variable changes, which is how
an input can send the learner somewhere, or show a layer, as soon as an answer is given.

**Branching on a survey answer.** An input saves the answer in a variable (see Inputs and surveys), and a
trigger's condition reads it. A "Continue" button with two triggers, one `jumpToSlide` slide-002 when the
variable equals `short`, and one `jumpToSlide` slide-003 when it equals `long`, sends each learner down
the path their answer chose. `examples/branching.osproj` does exactly this.

#### What the editor shows

The editor shows triggers as **rules**: "When *the learner presses it*, *go to a slide*, only if *choice is
The short path*." A `click` with a `keyActivate` that does the same thing is shown, and written, as one rule,
so a rule made in the editor is never mouse-only. Triggers the editor cannot show as a rule (`changeState`,
a lone click) are kept exactly as they are.

## Timing

Every object has a `timing`, which says when it appears and when it goes. The starting value, which every new object
and every migrated object has, means always there, so a course with no timing behaves exactly as it always has.

```json
"timing": { "appear": "narration", "start": 500, "visibleFor": 6000 }
```

| Field | Meaning |
| --- | --- |
| `appear` | `"time"`: shown `start` milliseconds after the object's layer is shown (after the slide opens, for the base layer). `"narration"`: shown `start` milliseconds after the object's own narration starts playing. |
| `start` | A whole number of milliseconds, 0 to 3,600,000. With `appear: "time"` and `start: 0` the object is there from the start. |
| `visibleFor` | `null` to stay, or a whole number of milliseconds, 1 to 3,600,000, after which the object goes again, counted from when it appeared. |

All times are milliseconds, like a slide's `duration`; the editor shows seconds. The decision (settled 2026-10-12) is to keep
timing on each object rather than in a separate timeline object per slide, so a slide's file stays easy to read and compare and
there is no second list that can fall out of step with the objects.

A slide's own `duration` is the time before it moves on by itself, in milliseconds, or `null` to wait for the learner. It is
measured from when the slide opens.

**With narration.** An object set to appear with its narration needs a `narration` of its own (`timing-narration-missing` is an
error). The player starts it when that narration starts playing, and narration plays in reading order, so a list can be revealed
line by line as the voice reaches each. If the narration will not play, the object must still appear, so there are two
fallbacks. An object whose narration has no audio counts as started when its layer was shown. If the browser refuses to start the
sound (autoplay is blocked), every object still waiting for narration counts as started at that moment, and its `start` delay
counts from then.

**Layers.** An object on a layer other than the base layer is timed from when that layer is shown, and starts again each time the
layer is shown. Timing never changes what a layer does, and is a separate switch from an object's states, so none undoes another.

**What the learner can do.** Anything that appears, goes or moves on by itself takes time away from slow readers and from people
using a keyboard or a screen reader, so a slide with any timing, or a `duration`, shows two controls ahead of the slide: **Pause timing**
(and **Resume timing**), which stops the clock, and **Show everything now**, which shows every timed object and keeps it showing.
They are ordinary buttons, announced politely when used, and they are not shown on a slide with no timing. Pausing stops
objects appearing and going and stops a slide moving on. Showing everything does not move the slide on; pausing does. This is
what WCAG 2.2.1 (Timing Adjustable) and 2.2.2 (Pause, Stop, Hide) ask for.

An object that is not showing yet is not in the page for assistive technology or the keyboard (it is `display: none`), and
appears in its place in the reading order when its time comes. Nothing animates. Timing restarts each time a slide is opened,
including when a learner returns to it, and a SCORM resume opens the slide with its timing at the start.

The validator warns about the cases that tend to leave a learner behind: `timing-after-advance`, `timing-control-disappears`,
`timing-too-brief` and `slide-advances-with-question` (see the validator spec). The editor never applies timing on its own canvas:
everything is drawn, so an author can see and edit all of it.

## Animation

Every object has an `animation`, which says how it arrives and how it leaves. The starting value, which every new and migrated object
has, is no effect either way, so the object just appears and goes, as before.

```json
"animation": { "enter": { "effect": "slideLeft", "duration": 600 }, "exit": { "effect": "fade", "duration": 400 } }
```

| Field | Meaning |
| --- | --- |
| `enter.effect`, `exit.effect` | `none`, `fade`, `slideLeft`, `slideRight`, `slideTop`, `slideBottom` or `zoom`. A slide arrives from that side, or leaves toward it. `zoom` grows from slightly smaller, or shrinks to it. |
| `enter.duration`, `exit.duration` | A whole number of milliseconds, 100 to 2000. Short on purpose. |

An entrance plays when the object appears: at its time (see Timing), and also when the slide, or its layer, opens, for an object
that is there from the start. An exit plays when the object disappears at the end of its time (`visibleFor`), so an object with
no end time never plays its exit (`animation-exit-never` is a warning). Showing everything at once, which the learner can ask
for, does not wait for any effect.

**Motion is a barrier for some learners, so it is small and always optional.** Nothing repeats or flashes. A slide moves 40 pixels at
most, and a zoom starts at 85 percent. The effects are the browser's own animations of `opacity`, `translate` and `scale`, never
`transform`, so an object that is rotated keeps its rotation while it moves. None plays when the learner's device asks for reduced
motion (`prefers-reduced-motion`). A slide that has any effect also has a **Turn off animation** button, with the timing controls, which
stops them whatever the device says; it is a toggle, announced when used, and is not shown where the device already asks for less motion.
The content of an object is in the page, readable, from the first moment of its entrance and until the end of its exit, so assistive
technology is never made to wait for a picture. If the page is not being drawn (a background tab, a minimised window) a timer still
finishes each effect soon after it should be over, so no object is left half arrived or half gone.

The editor shows effects only when the author asks, with **Preview animation**: it plays the arrival, waits a moment, plays the exit
and puts the object back, changing nothing. If the author's own device asks for reduced motion it says so and plays nothing.

## Narration

The decision that shapes the most downstream behaviour.

```json
"narration": {
  "script": "Welcome to the course. In this module we look at how information moves through an organization.",
  "voice": "af_heart",
  "speed": 1.0,
  "lang": "en-US",
  "pronunciations": [
    { "term": "Likert", "ipa": "ˈlɪkərt" }
  ],
  "audioCache": {
    "hash": "sha256:4f3a…",
    "path": ".cache/narration/4f3a….wav"
  }
}
```

### The cache hash

`audioCache.hash` is `sha256:` followed by the lowercase hex SHA-256 of this UTF-8 text,
lines joined with a single newline and no trailing newline: `script`, `voice`, `speed`
written with exactly three decimals (`1.000`), `lang`, then one line per pronunciation
as `term`, a tab, `ipa`. It is deliberately not a hash of serialised JSON, so that every
language that reads the format produces the same value. Reference implementation:
`narration_hash` in `tools/validate.py`.

### Where the cache lives and what it holds

For narration with hash `H`, `tools/narrate.py` writes two files to `.cache/narration/`:
`H.wav` (24 kHz mono audio) and `H.json` with `duration`, `exactTimings` and `cues`.
Each cue is `{start, end, text}` in seconds, one per sentence of `script`. The cue text
is the script itself, split into sentences, so joined with single spaces it equals the
script. Only the start and end times come from synthesis: Kokoro reports when each word
is spoken, and a cue spans the first to the last word of its sentence. If those word
timings cannot be matched to the script (for example after an IPA override changes the
token text) the times are estimated from sentence length and `exactTimings` is false.

The generator does not write into `audioCache` in the slide files. That field is optional
bookkeeping; the cache is found by recomputing the hash. This keeps generated paths out
of version control diffs. The editor writes `audioCache` as `null` and works the hash out itself
(`narrationHash` in `editor/src/narration.ts`, which is tested against the Python above, and against
the audio the generator really made for the example project). It also keeps `speed` to two
decimals, because a tie at the third decimal is the one place Python and JavaScript round differently.

### Why text and not audio

Narration is a script plus a voice setting. The audio file is a derived artifact keyed
by a hash of `script` + `voice` + `speed` + `lang` + `pronunciations`. Kokoro is
non-autoregressive and therefore deterministic, so the same inputs produce identical
audio every time and hash-based caching is exactly correct.

Four consequences, all of which are the point:

1. Change a word, regenerate one line. No re-recording.
2. Captions and transcripts come from `script`, perfectly synced and free. Never run
   speech-to-text over narration audio.
3. Translation is translating `script` and choosing a voice in the target language.
4. Project files stay small. Audio is cache and never enters version control.

This is where OpenStage differs structurally from the eLearning authoring platform, where narration is an audio
asset and changing the script means re-recording, re-captioning and re-syncing.

### Narration of items

Each item of an `interaction` can have its own `narration`, exactly the shape above. It is named by a key
made of the object's `id`, a slash, and the item's `id`, for example `obj-0012/item-3`. The key is what
`tools/narrate.py` calls it (`--only obj-0012/item-3`, and the result it prints), what the editor passes to
the speech tool, and what the published course looks it up by, so audio made for a key is the audio played
for that key. The cache hash is the same: it depends only on the narration's own words and settings, so two
items that say the same thing share one audio file. The item's narration is checked like an object's
(`voice-unknown`, `ipa-invalid`, `narration-stale`, `narration-not-generated`).

An item's narration does not change when the item's text changes: its words are the author's. The editor
offers to fill it from the item's title and text (the title, then each paragraph or list entry, each ending in a
full stop so the voice pauses and the captions break there), one item at a time or for every item that has none.

### Pronunciations

Kokoro tokenises to IPA, so per-project overrides are feasible. Discipline vocabulary,
researcher names and acronyms are a real and constant need in academic courses. The editor has a
Pronunciations list in an object's Narration section: a word as spelled in the script, and how it
sounds in IPA. The validator accepts IPA letters, stress and length marks, spaces, and the ordinary
Latin letters the IPA uses (`æ`, `ð`, `ø`, `ŋ`, `œ`), as in "cat", "this" and "sing".

## Provenance

Present on any object that came from an import. Null otherwise.

```json
"provenance": {
  "sourceDeck": "deck-7b21",
  "slideIndex": 4,
  "shapeId": "{A1B2C3D4-...}",
  "importedAt": "2026-10-10T14:22:00Z"
}
```

Never dropped on edit. Re-syncing a changed source deck depends entirely on these
fields, and they cannot be added retroactively to projects imported without them.

### Why import is one-directional

Bidirectional round-trip with PowerPoint is out of scope permanently.

The two object models are not the same shape. A PowerPoint shape is a shape. An
OpenStage object carries states, triggers, a timing, alt text and a tab
order. Round-tripping asks three questions with no good general answer: what happens to
a trigger pointing at a shape deleted externally, what state and accessibility metadata
does an externally added shape have, and where does it sit in the reading order.

No vendor ships this. the eLearning authoring platform imports. an eLearning authoring platform imports. a slide-based authoring tool inverts the
relationship and runs inside PowerPoint. Funded teams would have built bidirectional
sync if it worked.

What gets built instead: import once at fidelity, record provenance, and when the source
deck changes offer a per-slide diff the author can pull forward. Everything added in
OpenStage attaches to the slide rather than to imported shapes, so it survives a
re-sync.

Google Slides needs no API. It exports .pptx natively, so it uses the same path.

## Simulation

Reserved in v0.1. The shape is defined now so that software simulation can ship later
without a format migration that touches everything.

```json
"simulation": {
  "stepIndex": 3,
  "interaction": "click",
  "correctTarget": { "x": 420, "y": 310, "width": 120, "height": 32 },
  "expectedText": null,
  "feedback": { "correct": "layer-correct-3", "incorrect": "layer-retry-3" },
  "attemptsAllowed": 3,
  "mode": "practice"
}
```

`mode` is `demo`, `practice` or `assessment`.

Screen capture and step capture are separate problems from simulation authoring, and
only step capture needs the desktop shell. Simulation authoring is mostly slides and
triggers. This field is what keeps the later feature from becoming a rewrite.

## How the player interprets the format

The player (`player/`) is the reference reading of this document. Where the format above
left behaviour open, v0.1 fixes it as follows.

- **Reading and tab order.** Objects are placed in the page in `tabOrder` order, then
  objects with a tab order of 0 or null. Visual stacking comes from `geometry.z` only. No
  positive `tabindex` is ever used.
- **Accessible names.** `image` alt text is `altText`. A non-decorative `shape` becomes an
  image role named by `altText`. A `button` or `hotspot` is named by `altText` when that
  contains the visible label, otherwise the visible label is the name and `altText`
  becomes the description (so voice control still works). `text` objects are read from
  their own HTML, so their `altText` is not announced twice. Decorative objects are
  hidden from assistive technology.
- **Roles.** `role` is applied to `text` objects only when it is `status` or `alert`, which
  makes them live regions that are announced when their layer is shown. Other roles on text
  are carried by the HTML itself.
- **Activation.** A pointer click fires `click` triggers. A click that did not come from a
  pointer (keyboard Enter or Space, or a screen reader's activate) fires `keyActivate`
  triggers.
- **setVariable.** With no `value`, sets the variable to `true`.
- **changeState.** The state name is the trigger's `value`. `normal` returns to the base
  style. Only a state's `style` is applied in v0.1, not its `content`. `hover` also applies
  on keyboard focus, and `visited` applies after first activation.
- **Conditions.** All conditions on a trigger must hold.
- **variableChange.** Fires every `variableChange` trigger on the current slide whenever any
  variable changes. Trigger chains stop after 50 nested steps.
- **quizQuestion.** Shows each choice as a radio button and a "Check answer" button. A
  submit scores the answer, shows the `feedback.correct` or `feedback.incorrect` layer
  (hiding the other), counts the attempt, and runs the object's `click` or `keyActivate`
  triggers. A correct answer, or using the last attempt, locks the question.
- **video, audio, embed.** Drawn by `player/src/blocks.ts`. With a transcript a media element sits in a box
  above it; `playMedia` and `pauseMedia` triggers find the element inside.
- **input.** Drawn by `player/src/inputs.ts`. A change sets the part's variable (which fires
  `variableChange` triggers), and if `report` is true it is also recorded as an LMS interaction.
- **interaction.** Drawn by `player/src/interactions.ts`, part of the shared renderer. In the editor
  the first item is shown open and nothing responds; in the player it behaves as described under
  Interactions. It keeps its own open and selected state and does not touch variables or scoring yet.
- **Layers.** Only the base layer is visible when a slide starts.
- **Navigation.** Moving to a slide moves keyboard focus to that slide's region, which is
  named by the slide `name`. The first slide does not take focus on load.
- **Narration.** Narrated objects on the base layer play one after another in reading
  order when a slide opens. The browser may block autoplay until the learner has clicked
  something, in which case the Play button starts it. A narration bar sits first in the
  page, ahead of the stage, with Play or Pause, Replay, a Captions toggle (on by default)
  and a Transcript toggle. The transcript is real text and is the screen reader route;
  the moving caption line is hidden from assistive technology so nothing is read twice.
  With no generated audio the bar shows only the transcript. An object is only narrated
  if it has its own `narration`: a quiz's answer choices are not read unless the quiz
  object has a script that says so.
- **Item narration.** An interaction item with `narration` speaks when the learner opens it: a click or
  Enter or Space on its button (a tab, a card's front, an accordion or reveal header that is opening, a
  glossary term, a step, Next or Previous). It replaces whatever is playing, like layer narration, and its
  script is added to the transcript. Arrow keys that move between tabs, a timeline or a diagram do not
  speak, so a screen reader can read each name undisturbed. The item showing when the slide opens does not
  speak by itself either, because the slide's own narration is playing. For both, every opened item that has
  audio shows a Listen button after its text, an ordinary button named "Listen to: <title>" that plays it
  again. The editor's canvas never speaks and has no Listen buttons.
- **Layer narration.** When a layer is shown by a trigger or by quiz feedback, its narrated
  objects play at once, replacing whatever is playing, and their scripts are added to the
  transcript. A layer restored by a SCORM resume does not play.
- **Timing.** An object with a `timing` other than the starting one is hidden until its time, and a slide with a `duration`
  moves on after it. See Timing for the rules, the two fallbacks for narration that will not play, and the learner's controls.
- **Animation.** An object with an `animation` plays its entrance as it appears and its exit as it goes, unless the learner's device
  asks for reduced motion or the learner has turned animation off. See Animation.
- **Reflow.** When the room is under 70 percent of the stage's width (`REFLOW_BELOW` in `player/src/reflow.ts`), which a phone, a
  narrow window or a page zoomed to about 200 percent gives, the player stops drawing the fixed stage and shows the same objects in
  one column, in reading order, at their real size, wrapping to the width. This is what WCAG 1.4.10 (Reflow) asks for, so nothing
  scrolls sideways except a table, which scrolls inside its own box (two-dimensional content is allowed to). The player checks the
  width again whenever the window changes, so zooming in and out switches between the two. Wide windows look as they always did.
  The decision (settled 2026-10-12) was to stack automatically, with no per-slide narrow layout for the author to draw. The rules:
  - **Order.** The order a screen reader reads, which is the order the page already has (objects with a tab order first, in
    that order, then the rest), so what a sighted learner sees top to bottom is what a listener hears.
  - **Pictures, shapes and video** keep their shape and fill the width, no wider than the author drew them. **Audio** fills the width.
    An **embedded video** is 16 by 9.
  - **Buttons** each get their own line and a touch target at least 44 pixels high. A **hotspot** lies invisibly over a picture, which
    cannot work in a column, so it shows as a button with its name.
  - **Text on a panel or a picture.** An object sits on another when its box lies inside that one's box and is drawn above it. A
    decorative shape or picture with something on it is left out of the column, because it was only a backdrop, and the text that
    sat on it is painted with that shape's own fill, or for a picture with whichever of the theme's backgrounds reads best against the
    text, so the contrast the author chose is kept. A shape or picture that is not decorative stays. Objects that only partly
    overlap, or are rotated, are not guessed at: they simply follow each other in order. Only text is given a backdrop, because
    buttons, interactions, tables and the like paint themselves.
  - **Type.** Text bigger than 22 pixels is capped, titles (40 and over) at 9 percent of the window's width and body-sized text at 7,
    so a heading stays larger than what is under it. Long words break rather than run off the screen.
  - **Interactions** keep working and stack their parts: vertical tabs become tabs above a panel, a glossary's list goes above its
    definition, a timeline runs down the page, a process circle or pyramid shrinks to fit with its words kept whole, a Likert scale's
    choices go down the page, and a semantic differential puts its two words above its row of points.
  - **Layers.** A layer comes after the slide's own content, and is scrolled into view when it opens.
  - **Timing.** An object that appears later takes its place in the column then, and moves what follows down.
  The editor's canvas never reflows: it always shows the whole stage. To see the column, preview the course in a browser and narrow
  the window.

## SCORM 1.2 tracking

The published page reports to an LMS when it finds a SCORM 1.2 API (`window.API`, in a parent
frame or the opener). With none, such as a file opened from disk, the course runs untracked.
The package is `<name>-scorm12.zip`: the course, an `imsmanifest.xml`, and the editable project
under `source/` (not listed in the manifest, so the LMS ignores it). The ADL schema files
(`.xsd`) are not bundled; LMSs that import without them are unaffected.

- **Completion** means the slides have been seen enough, as the project's `completion` setting says (every
  slide, or having reached the last one), and every quiz is finished (answered correctly, or out of attempts). **Success** means the score reached the pass mark. They are
  kept as separate facts. SCORM 1.2 has one `lesson_status`, so they are combined only when
  writing it: `incomplete` until completion, then `passed`, `failed`, or `completed` (a course
  with no quiz). A learner who finishes everything but fails is reported `failed`; 1.2 cannot say
  "completed, failed". A finished status is never moved back.
- **Score** is points earned over points available across all quizzes, as a percentage, written
  as `score.raw` (with min 0 and max 100) once, when the course is complete. Writing it earlier
  would let an LMS judge pass or fail before the learner has finished.
- **Pass mark** is 80 percent, fixed in v0.1. It is also written to the manifest as
  `adlcp:masteryscore` for graded courses. Making it a project setting needs a schema change.
- **Position** is saved as `lesson_location` (the slide id) and, with the rest of the state, in
  `suspend_data`: variables that differ from their initial value, each quiz's attempts, lock,
  result, score and last answer, the layers showing, and which slides have been seen. SCORM 1.2
  allows 4096 characters, so if it would not fit the least important parts are dropped first
  (slides seen, then layers, then variables). Quiz results are never dropped.
- **Resume.** On a launch with `cmi.core.entry` of `resume`, the course restores that state and
  shows the saved slide with its layers and the learner's last answer, without running that
  slide's `slideStart` triggers again. Narration starts again from the beginning of the slide.
  Unknown ids in saved state are ignored, so a course edited since still opens.
- **Exit.** `cmi.core.exit` is `suspend` unless the course is finished, and `session_time` is
  sent, when the page is hidden or unloaded. The final write happens once.
- **Interactions.** Each quiz submission is recorded as a `choice` interaction with the
  student's response (`a`, `b`, `c` by choice order), result, weighting and correct response.
- **Review and browse mode** are read only: nothing is written.

## How the editor writes files

The editor writes a file only if its content really changed. Opening a project and saving
without changes writes nothing, so files stay byte-identical. A file that did change is
written in one canonical form: JSON with two-space indentation, keys in their existing order,
LF line endings, and a final newline. Because the editor reformats a file the first time it
changes it, hand-formatted files such as the examples will show a formatting diff on that first
save. Only `project.json`, `theme.json`, `assets.json` and `slides/<id>.json` are ever written, each by writing a temporary
file and renaming it over the original.

## Versioning and migration

`schemaVersion` follows semantic versioning. Any change to the schema bumps it and ships
a migration function. A project written by an older version opens, migrates, and reports
what changed.

`tools/migrate.py` updates a project in place and keeps the old files in
`.openstage-backup/<old version>/` inside the project. The editor offers to run it when it
opens an older project, and the validator reports `needs-migration` for one that has not been
updated.

| From | To | What changes |
| --- | --- | --- |
| 0.13.0 | 0.14.0 | Every object gets an `animation`, set to no effect either way (`{ "enter": { "effect": "none", "duration": 500 }, "exit": { "effect": "none", "duration": 500 } }`), after its `timing`. Nothing moves until the author chooses an effect. |
| 0.12.0 | 0.13.0 | Every object gets a `timing`, set to always there (`{ "appear": "time", "start": 0, "visibleFor": null }`), after its `triggers`. Nothing looks different until the author sets some. |
| 0.11.0 | 0.12.0 | Adds the `download` object type, the `assets/documents/` folder and the `document` kind in `assets.json`. Nothing in an existing project changes. |
| 0.10.0 | 0.11.0 | Every item of an interaction gets a `narration` field, set to `null`. Nothing sounds different until the author writes some. |
| 0.9.0 | 0.10.0 | Adds the `results` and `certificate` object types. Nothing in an existing project changes. |
| 0.8.0 | 0.9.0 | Adds `completion` to `project.json`, which says what counts as completing the course. It starts as `{ "slides": "all" }`, the rule every course already followed, so nothing changes until the author chooses otherwise. |
| 0.7.0 | 0.8.0 | The record of where assets came from can name Pexels, Openverse, Wikimedia Commons, Freesound, Mixkit, SVG Repo and Libreshot. Nothing in an existing project changes. |
| 0.6.0 | 0.7.0 | Adds the `embed` object type, the optional `assets.json`, the `credits` switch in `project.json` (starts on) and the `.vtt` captions folder. Nothing in an existing project changes. |
| 0.5.0 | 0.6.0 | Adds the `input` object type. Nothing in an existing project changes. |
| 0.4.0 | 0.5.0 | Adds the `table` and `scrollingText` object types. Nothing in an existing project changes. |
| 0.3.0 | 0.4.0 | Adds six interaction kinds (timeline, process circle, glossary, pyramid stack, pyramid matrix, circle matrix). Nothing in an existing project changes. |
| 0.2.0 | 0.3.0 | Adds the `interaction` object type. Nothing in an existing project changes. |
| 0.1.0 | 0.2.0 | Adds `theme.json` (the Classic theme) and points `project.json` at it. Adds `layout: null` and `background: null` to every slide. Nothing looks different. |

Until 1.0.0 the format may still change, but every change ships a migration.

## Open questions

Not yet decided, and worth settling before 1.0:

- Quiz model. Is a question an object type, a slide type, or both?
- Theme scope. How much can a theme override before a slide stops being portable between
  projects?
- Reusable components. Linked instances versus independent copies, and how a linked
  instance records what it points at.
- Zipped distribution. Extension, and whether the archive is the editable form or only a
  transport wrapper.
