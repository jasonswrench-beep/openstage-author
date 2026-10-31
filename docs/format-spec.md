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
  "schemaVersion": "0.41.0",
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

`banks` is optional (added in 0.33.0): **question banks**, runs of slides of which each learner is shown some. Each bank has an `id`, a `name`, its `slides` (two or more slide ids), `draw` (how many each learner is
shown) and `shuffle` (show the ones picked in a random order). When a learner begins, the player picks `draw` of each bank's slides at random (all of them, if it holds fewer), keeps them in the author's order unless `shuffle` is
on, and plays a course made of the slides that are in no bank plus those picks, which take the place of the bank's first slide. Everything the player works out from the slides follows what the learner was shown: "Slide 3 of 5", Back and
Next, whether every slide has been seen, the questions that must be finished, the points that are possible and the score sent to the LMS. What was picked is kept with the learner's progress (in the SCORM suspend data, with a number that
also shuffles their answers), so coming back shows the same slides; a learner who starts again, or whose saved picks no longer fit the course, is dealt new ones. The slides of a bank should sit together; each can be in one bank only.
A rule that jumps to a slide of a bank may lead to a slide that learner was not given, and then does nothing (`jump-into-bank`, warning).

```json
"banks": [
  { "id": "bank-0001", "name": "Chapter questions", "slides": ["slide-003", "slide-004", "slide-005", "slide-006"], "draw": 2, "shuffle": true }
]
```

`characters` is optional: the cast, the people a course can show and give a voice to. It is shared by every scenario and every choice of character in the
course, so a person is described once.

```json
"characters": [
  { "id": "maya", "name": "Maya Reyes", "role": "Nurse manager", "voice": "af_heart",
    "picture": { "src": "assets/images/maya.png", "alt": "Maya, a woman in a blue coat", "decorative": false } },
  { "id": "dev", "name": "Dev Patel", "role": "New hire", "voice": "am_adam", "picture": null }
]
```

Up to 12 people. `id` is like any other id, except that `you` is not allowed, because in a scenario `you` means the learner. `name` is what the learner reads
beside the person's lines, and must be different from the others' (`character-name-duplicate`, a warning). `role` is a few words on who they are, and may be
empty. `voice` is the narration voice that reads the person's lines (`voice-unknown` if there is no such voice). `picture` is optional; when there is one it
needs alt text that says what the person looks like, or it is marked `decorative` and then has no alt text (`character-picture-alt`), and the file has to be
in the project (`asset-missing`). The picture is only a picture of the person: their name is always written beside it, so the picture is hidden from a
screen reader beside a line (the name is read), and is described once where a learner has to pick a person (see the character input). (Added in 0.21.0.)
A picture may be one from a character pack (`docs/character-packs.md`): the editor copies it into the project's images, takes its alt text from the pack's description of the person (which the author can change), and records its maker in `assets.json`.

A person may also have **`poses`** (added in 0.29.0): more pictures of them, each in a pose, to show beside a line of a scenario in place of their picture, and a **`library`** that says where they came from, so the editor can offer more of their poses.

```json
{ "id": "maya", "name": "Maya Reyes", "role": "Team lead", "voice": "af_heart",
  "picture": { "src": "assets/images/maya.png", "alt": "Maya, a woman with dark skin and short dark hair, wearing a dark grey skirt suit", "decorative": false },
  "poses": [ { "id": "welcome", "label": "Waving hello", "src": "assets/images/maya-welcome.png" } ],
  "library": { "pack": "openstage-people-1", "person": "lisa" } }
```

`poses` has up to 40 entries. A pose's `id` is a plain id, unique for the person (`character-pose-duplicate`); `label` (1 to 60 letters) is what a menu says; `src` is a file in the project (`asset-missing`). The ids a pack uses are the same from one person to the next where the standard names are used (`welcome`, `think`, `present-left`, `arms-crossed`...), so a pose carries over when a line is given to someone else. A pose has no alt text of its own: it is shown only beside the person's name, so a screen reader skips it, as with the picture. `library` is `{ "pack", "person" }`, two ids of a character pack (`docs/character-packs.md`); the course never reads it. A pose that a line uses cannot be taken out of the cast in the editor until the line is changed.

`sourceExclude` is optional. It lists files and folders to leave out of the `source/` copy of the project that a published package carries beside the
course (the cache and the empty `.gitkeep` placeholder files are always left out). A name with no slash, such as `events.jsonl` or `capture`, matches a file or folder of that name at any depth; a path
with a slash, such as `raw/footage`, is from the project folder, and a folder takes everything inside it. Names must be plain: no leading slash, no
backslash, no `..`. It matters for raw recordings and interaction logs, which would otherwise be handed to every learner. The validator warns when
recognizable raw capture material (a file called `events.jsonl`, or a folder called `capture` or `captures`) sits in the project and is not listed
here, and always when it sits under `assets/`, because that folder is published with the course itself (`capture-material-in-project`). (Added in 0.18.0.)

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

**Logo.** A theme may carry one `logo`, shown in a corner of every slide:

```json
"logo": { "src": "assets/images/school-logo.png", "alt": "New Paltz logo", "decorative": false, "corner": "bottom-right", "width": 180, "height": 60 }
```

`src` is a picture under `assets/`. `corner` is `top-left`, `top-right`, `bottom-left` or `bottom-right`, and the logo sits 24 stage pixels in from the two
edges of that corner. `width` (24 to 400) and `height` (24 to 200) are its size on the stage in stage pixels, kept in the shape of the picture. A
screen reader user hears the logo on every slide, so it needs `alt` text, or it is marked `decorative` (hidden from screen readers) and then has no alt
text; the validator checks both (`theme-logo-alt`, `theme-logo-decorative-alt`), that the file exists (`theme-logo-missing`), and warns when content a
learner needs reaches into the logo's corner on a slide (`theme-logo-overlap`; decorative objects do not count). The logo is drawn by the shared renderer,
behind the slide's objects, ignoring the pointer and the keyboard. In the page it comes before the slide's objects when it is at the top and after them
when it is at the bottom, so the reading order matches what the eye sees. Where the page reflows to one column it is part of the flow, at the top or the
bottom and to the left or the right, at most 45 percent of the width and in the shape of the picture. The margin, the limits and the four cases that fix where a logo
sits are in `tools/theme-rules.json`, which the validator, the player and the editor all read, together with the pairs of theme colours that must
contrast (also checked by the editor as colours are changed). A built-in theme file has no logo; a project's own `theme.json` has one if the author added it.
(Added in 0.20.0.)

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

`transition` is optional (added in 0.37.0): `{ "enter": { "effect": "fade", "duration": 500 }, "exit": { "effect": "slideLeft", "duration": 600 } }`, either part optional (and at least one present), each an `effect` of an object's `animation` (`none`, `fade`, `slideLeft`, `slideRight`, `slideTop`, `slideBottom`, `wipeLeft`, `wipeRight`, `wipeTop`, `wipeBottom`, `zoom`; `duration` 100 to 2000 milliseconds). `enter` plays when the learner arrives at the slide; `exit` plays when the learner leaves it, over the slide that follows (the old slide stays on top, with nothing in it to read or press, until its effect is over, so the new slide is already working underneath and nothing waits). Not played in one-column view, when the learner has turned animation off (a slide with a transition has the **Turn off animation** button, as an object with an effect does), or when the device asks for less motion (`prefers-reduced-motion`). The editor writes only the parts that are not `none`, and no `transition` at all when neither is.

`autoSteps` is optional (added in 0.36.0): `{ "first": ms, "every": ms }` makes the slide's steps (see Waiting for the learner, under Timing) come by themselves. Absent, they wait for the learner.

`hideNavigation` is optional (added in 0.34.0) and, when present, is `true`: the player leaves out the course's **Back** and **Next** buttons while this slide is showing, so the
learner leaves it only through something on it (a button with a rule that goes to a slide, a tile on a game board) or, if the slide has a `duration`, when its time is up. The three
game sets set it on every slide but the last, which is how a player stays in the game until it is over. It is written only when true; leaving it out (or removing it) shows Back and Next
as for any other slide. The validator reports `navigation-no-way-out` when a slide that leaves them out has no way on (see `docs/validator-spec.md`). Only the two buttons are
left out: the slide counter stays, and the player has no other way of paging through a course, so a slide like this really can only be left in the ways above.

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

#### A suggested description (0.28.0)

`accessibility` may also hold `altSuggestion`: `{ "text": "...", "basis": "..." }`, a description the computer worked out that the author has not approved (for example, from the name of what was clicked in a recording: "A screenshot of Notepad,
with the File menu item marked."). `text` is 1 to 1000 characters and `basis` (1 to 300) says what it was worked out from, in words the author can read.

A suggestion is only ever a suggestion. **The course never uses it**: the player ignores it, the object still has no alt text, and a missing alt text is still an error (`alt-text-missing`; its detail now shows the suggestion that is waiting). It becomes the object's alt text only when the author
uses it in the editor (it is copied into `altText` and removed) or writes their own (which removes it). A suggestion left on an object that has alt text of its own, or is decorative, is a warning (`alt-suggestion-unused`). The rule that alt text is never silently filled in therefore holds: the author's decision is what puts words in front of a learner.

### Object types in v0.1

`text`, `image`, `shape`, `button`, `hotspot`, `video`, `audio`, `quizQuestion`, `interaction`, `table`, `scrollingText`, `input`, `embed`, `results`, `certificate`, `download`, `scenario`, `icon`, `timer`.

### Machine-readable schema

The JSON Schema lives in `schema/` (`project.schema.json`, `slide.schema.json`,
`object.schema.json`). It must agree with this document. Where they differ, fix both in
the same commit.

Required fields: every field in the examples above is required, including `states`,
`triggers`, `narration`, `provenance` and `simulation` (use `{}`, `[]` or `null`). Unknown
fields are rejected. Ids match `^[a-z][a-z0-9_-]*$`.

Optional field: `locked`. `true` means the editor refuses to move, resize, rotate or delete the object until it is unlocked. Its text,
alt text, rules, timing, narration and stacking order can still be changed. An object that is not locked has no `locked` field at all,
never `false`, so a project that has never used locking looks exactly as it did before. It is for the author only: the published course
and the validator ignore it. A copy of a locked object is not locked. (Added in 0.15.0.)

Optional field: `group`. Objects on one layer that carry the same `group` id are grouped: the editor selects, moves, resizes, copies, cuts, deletes and locks them
together, and lines them up as one object. An object that is not in a group has no `group` field. A group has two or more objects, all on one layer, and is
flat (a group cannot hold a group); the validator reports a group split across layers (`group-split`, an error) and a group of one (`group-single`, a
warning). It is for the author only: the published course and the player ignore it. A copy of a whole group is a new group; a copy of only some of a
group's objects is not grouped. (Added in 0.17.0.)

`content` shapes fixed by the schema in v0.1:

| Type | `content` |
| --- | --- |
| `text` | `html`, optional `bubble` and `tail` (see Speech and thought bubbles) |
| `image` | `src` (under `assets/`) |
| `shape` | `shape`, and `tail` for a speech or thought bubble |
| `button` | `label`, optional `icon` and `iconPlacement` (see Icons) |
| `icon` | `set`, `name`, `shapes` (see Icons) |
| `video`, `audio` | `src` (under `assets/`), optional `captions` (path under `assets/`, or null), optional `transcript` (HTML, as in a text object); a `video` also has an optional `description` (see Audio description) |
| `embed` | `provider` (`youtube` or `vimeo`), `id`, `hash`, `transcript`, `captionsConfirmed` (see Embedded video) |
| `download` | `src` (under `assets/`), `title`, `description`, `accessibleConfirmed` (see Files to download) |
| `quizQuestion` | `questionType` (one of eight kinds), `scoring` (`points`, `attemptsAllowed`), `feedback` (`correct`, `incorrect` layer ids), and the fields its kind needs (see Quiz questions) |
| `input` | `kind`, `prompt`, `report`, and the parts that kind needs (see Inputs and surveys) |
| `table` | `caption`, `headerRow`, `headerColumn`, `rows` (1 to 30 rows of 1 to 12 text cells; see Tables) |
| `scrollingText` | `html`, like a text object |
| `results` | `heading`, `passMessage`, `failMessage`, `review` (see Results and certificates) |
| `certificate` | `title`, `statement`, `achievement`, `issuedBy`, `showScore`, `showDate` (see Results and certificates) |
| `interaction` | `kind`, `orientation` (`horizontal` or `vertical`), `allowMultiple`, `items` (1 or more; see Interactions) |
| `hotspot` | none: `content` is `{}` (see Hotspots below) |

**Hotspots.** A `hotspot` is a transparent button to put over a picture, for something a learner has to find and press, such as a button in a
screenshot. It has no content of its own (`content` is `{}`); the picture is a separate `image` object beneath it. It is named by `altText`, which
is required, and it cannot be `decorative`. It is reached with Tab and pressed with Enter or Space like any button, and its `click` and
`keyActivate` triggers run the same rules. It is drawn invisible, with the ordinary visible focus ring when it has focus, and where the page
reflows to one column it becomes a visible button showing its name. It has to be big enough to press: at least 24 by 24 stage pixels
(WCAG 2.2, 2.5.8 Target Size), and the validator warns under 35 each way, because the slide can be drawn at 70 percent of its size before it
reflows, and 24 is then what is left. (Defined in 0.18.0. The `hotspot` question kind is a different thing: see Quiz questions.)

`shape` draws one of these, named in `content.shape`: `rectangle`, `rounded`, `ellipse`, `triangle`,
`diamond`, `arrow`, `speech` or `thought` (the last two are bubbles, below). A name the renderer does not know draws a rectangle. `style.fill` fills it and
`style.stroke` (a colour, or `none`) with `style.strokeWidth` outlines it. The figure is drawn as
vector graphics, so it stays sharp at any size, and it is hidden from assistive technology: the
object around it carries the name, or is marked `decorative`. A line is a thin `rectangle`.

**A part of a text with its own colour or size.** Inside a text's `html`, a `<span>` may carry `style="color:#c00000;font-size:120%"`: a colour as six hex digits and a size as a whole percentage (50 to 300) of the object's own size, so the box still scales and shrinks to fit as one. Nothing else of a style is kept: the player and the editor drop it (a colour name, a pixel size, a font, a background and a position all go, and the words stay), and `rgb(...)` and three-digit colours are rewritten as six digits. The validator holds each colour to the same contrast as the object's own (`contrast`, "Part of the text, #xxxxxx"). The PowerPoint import writes these for a part that differs from the box; the editor's Edit text keeps them, though it has no buttons to make them. No format version changed: it is the same `html` string.

**Values in a text** (added in 0.31.0). A `text` object's `html` can hold a **reference**, two braces round a name: `Score: {{$score}}`. While the course is played the player puts the value there and writes it again whenever it changes (a rule changed a variable, or a question was answered). The name is either a variable's `name` (capitals and spaces at the ends do not matter) or one of the values the course works out, which start with a dollar sign so no variable can share one: `$score` (points earned so far), `$possible` (points possible in the whole course), `$percent` (the points earned so far as a percentage of those possible, rounded), `$answered` (questions finished), `$questions` (questions in the course) and `$correct` (questions answered right). A number is written as it is, `true` and `false` as yes and no, a word as it is. A name with a brace or a line break in it, or longer than 80 characters, cannot be referenced. A reference is read in each stretch of words between tags, so a tag in the middle of one breaks it. A reference to nothing is shown as written, so the mistake can be seen, and the validator's `value-text-unknown` names it. Only `text` objects take references (a text bubble is one). If the text's `accessibility.role` is `status` it is a live region, and a screen reader says it again when a value in it changes; with any other role it is not announced. The transcript, being a fixed copy, writes a reference as its name in brackets (`[score]`). The editor changes a reference when its variable is renamed, and will not delete a variable a text shows.

A `text` object's words sit on the left of its box unless `style.textAlign` is `center` or `right` (a deck imported from PowerPoint may also bring `justify`, which the player draws; the editor offers only the first three, because the uneven spaces in justified text are hard to read). Nothing is written for left. It needs no schema change: `style` takes any keys the player knows.

**How words sit in their box** (added in 0.35.0; `style` keys of a `text` object, none of them written unless they have a value, so an older text is drawn as before):

| Key | Meaning |
| --- | --- |
| `verticalAlign` | `"middle"` or `"bottom"`: the words sit in the middle of the box, or at its bottom edge, instead of starting at the top. |
| `paddingX`, `paddingY` | Pixels of room between the box's edge and its words, left and right, and top and bottom. Without them a text has none (a text from PowerPoint has the room PowerPoint gives, a tenth of an inch at the sides and a twentieth above and below, unless its box said otherwise). |
| `autoFit` | `"shrink"`: when there are more words than the box holds, the player shrinks them until they fit, to no less than half the size in `fontSize` or 12 pixels (whichever is larger, but never above `fontSize`). It is worked out on the learner's own screen, with the learner's own fonts, so it holds whatever fonts are there; in the one-column layout for narrow screens, where a box has no fixed height, it does nothing. |
| `paragraphSpacing` | Pixels between paragraphs, and between list items. Without it a browser's usual space is used. A number, including 0, replaces it. |
| `nestedSize` | A number from 0.5 to 1.5: a list inside a list is drawn at this share of the size of the list it is in, one level after another (0.8 makes each deeper level four fifths of the one above). A text from PowerPoint says it when its deeper levels were a different size from its first. |
| `lineHeight` | Already there: the height of a line as a multiple of the size (1.2 is the usual). A text from PowerPoint says it when the deck did. |

A weight in `fontWeight` also applies to a heading (`h1` to `h6`) in the text, so a title that is not bold can be written (a browser draws a heading bold unless it is told not to).

**Speech and thought bubbles** (added in 0.30.0). A bubble is the picture of something said or thought, with a tail that points at whoever is speaking or thinking. A `shape`
whose `content.shape` is `speech` (a rounded box with a pointed tail) or `thought` (an ellipse with two small circles trailing away from it) is a plain, empty bubble: a picture
with no words, like any other shape, and decorative unless the author says it carries meaning. A `text` object whose `content.bubble` is `"speech"` or `"thought"` is a bubble
with words in it: its `html` is the words, drawn inside the bubble, and it is read like any text. `content.tail` (on either) is `"left"` or `"right"`, the side the tail is on;
without one it is on the left. The tail always hangs below the body, so the object's box is the bubble with its tail: the body takes the top, and the tail the bottom
(28 percent of the height, between 12 and 36 pixels, for speech; 30 percent, between 16 and 44, for thought). The drawing is made at the box's own size, so a tail stays
the same size however wide or tall the bubble is made and a circle stays round. A text bubble is coloured as a shape is: `style.fill` is the bubble, `style.stroke` and
`style.strokeWidth` its outline, `style.color` the words (which the validator checks against the fill), and the room round the words is worked out from the bubble, so they sit
in its body and never in the tail. Where the page reflows to one column the drawing, made for the author's box, gives way to a plain rounded box in the same fill and
outline with the words filling it; a plain bubble shape keeps its shape and fills the width, as any shape does. A learner's own colours (the accessibility panel) paint
a bubble in the surface and text colours they chose, and Windows high contrast paints it in the system colours. A `bubble` or `tail` that is neither of the two is the
validator's `bubble-invalid` error.

A `quizQuestion` has to make sense: it needs an answer a learner can give that is right, and its parts must have different ids. The validator checks each
kind (see Quiz questions). The object's `altText` names the group of controls for a screen reader; the question itself is normally a heading placed before it.

### Video, audio and embedded video

A `video` or `audio` object plays a file from `assets/video/` or `assets/audio/` with the browser's own
controls. A `video` needs `captions` (a `.vtt` file under `assets/`) or a narration script. An `audio` clip
needs captions, a narration script or a non-empty `transcript`, because a transcript is what an audio-only
clip needs. The player draws captions as a real `<track kind="captions">`, and a `transcript`, if there is
one, as a native "Transcript" disclosure under the player, closed until opened. Neither plays on its own.

A captions file may carry a WebVTT `NOTE` block that says nobody has checked it yet: "Times estimated from a script and not yet checked.", "Words and times made by speech recognition and not yet checked.", or "Times set by listening to the
voice with speech recognition and not yet checked." Players ignore `NOTE` blocks, so the captions play as usual; the editor reads the note back so the warning is still there when the captions are opened again, and removes it when the
author says they have checked. It is not part of the project schema and the validator does not look at it.

**Audio description.** A `video` can carry an audio description for a learner who cannot see its picture (WCAG 2.2, 1.2.5, level AA): `content.description`
is `{ "cues": [...] }`, one to 60 cues, each with an `id` (unique on the video), a `time` (whole milliseconds into the video, 0 to 24 hours), `text` (what the
picture shows at that moment, up to 2000 letters), `pause` (whether the video waits while it is spoken, which is what makes an extended description possible) and
`narration` (the usual narration object, or null for a description that can only be read). A cue's narration is named by the key `<object id>/<cue id>`, like
an interaction item's, so the speech tool, the cache and the published course treat all three the same way, and an audio clip cannot carry one. Where there
is a description, the player puts an **Audio description** button beside the video, and nowhere else. It opens a native dialog (focus moves in, Tab stays
inside, Escape closes it and focus goes back to the button) where a learner can read every description with its time, **listen to them** one after another
without the video, or **play the video with the description**: the video starts from the beginning and each description is spoken when its time comes, holding
the video if it says so and letting it go when the voice ends. Descriptions that can only be read are never spoken and never hold the video. Pressing play
while the video is held skips the rest of that description; going to another place in the video stops the one being spoken and picks up the ones still to come;
the end of the video turns the voice off. A browser that refuses to start a sound never leaves the video held. A description with no voice is a warning
(`description-not-voiced`), because audio description is something heard. (Added in 0.19.0.)

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

### Timers

A `timer` is a countdown on a slide (added in 0.32.0). It is drawn as a label, a clock (`0:30`), a bar that shortens, and two buttons. It starts when the layer it is on is shown (when the slide opens, for the base layer), on the same clock as the
slide's timing (see Timing): pausing the timing holds it, and **Show everything now** turns it off.

```json
{ "type": "timer", "content": { "seconds": 30, "label": "Time left", "extendBy": 30 } }
```

| Field | What it is |
| --- | --- |
| `seconds` | How long it counts down: a whole number from 5 to 3600. |
| `label` | The words above the clock, 1 to 60 letters. |
| `extendBy` | The seconds the **Add time** button gives, from 0 to 600. 0 takes that button away. |

The **Turn off the timer** button is always there, and cannot be taken away: a time limit a learner cannot get out of is a barrier (WCAG 2.2.1). Turning one timer off turns off every timer that would start later in that visit to the course, so a
learner who cannot work against a clock does not have to say so again on each slide. The timer is not saved with the learner's progress: coming back to a slide starts its timer again.

**Rules.** The rules on the timer that answer the event `timerEnd` run once, when the time runs out. They are ordinary rules (show a layer, go to a slide, change a variable), so they can lead to a "time is up" layer, count a missed question or move on.
They do not run if the learner turned the timer off, if a rule stopped it, or if **Show everything now** ended it. The action `stopTimer`, with a timer's id as its `target`, holds a running timer at the time it has left; it is how a question that has
been answered stops the clock. A `stopTimer` rule that names something that is not a timer is an error (`stop-timer-target`), and a `timerEnd` rule on an object that is not a timer never runs (`trigger-event-never`, warning). A timer with no rule
for running out is a warning (`timer-no-end-rule`).

**What a screen reader hears.** The group has the name in `accessibility.altText` (the editor starts it as the label). The clock is read when the learner asks for it and is not read out as it changes. A status region of the timer's own says "1 minute
left", "30 seconds left" and "10 seconds left" as the time passes those marks, but only for marks lower than the time the timer started with; it says "Time added. 45 seconds left.", "The timer is off." and "Time is up." A timer stopped by a rule
says nothing, because the question's own feedback speaks. The transcript names each timer and says it can be added to or turned off. Nothing flashes and the bar does not animate.

A timer is a control (it holds buttons), so it needs a tab order of 1 or more, and one that is timed to disappear (`visibleFor`) is a warning like any other control.

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
`libreshot`, `vecteezy` (kept for projects that already name it), `generated` or `other`. A file with no entry is treated as the
author's own. When `requiresCredit` is true the creator, the source link and the licence must all be
filled in (`credit-incomplete`). The validator warns about an entry whose file is missing
(`credit-asset-missing`), and when an asset that needs credit is used while `credits` is off
(`credit-page-off`).

When the course is published, the entries for assets that the course actually uses go into the package (a file is used if a slide names it, or a person in the cast has it as their picture),
and if `credits` is on the player shows a "Credits" button that opens a dialog listing them: the title, the
creator, where it came from, and the licence. Entries that would read the same are one line. The dialog is native, so focus stays inside it and Escape
closes it.

**Pictures an AI service made** (added in 0.26.0; the record is also allowed for a sound, but nothing makes one now). The provider is `generated`, and the `source` carries a
`generated` record, which is required for that provider and allowed for no other:

```json
"source": {
  "provider": "generated", "url": "https://openai.com/", "creator": "OpenAI (gpt-image-1)", "creatorUrl": "",
  "licence": "AI-generated; the service's terms of use apply", "requiresCredit": true,
  "generated": { "service": "openai", "model": "gpt-image-1", "prompt": "A red barn in the snow", "madeAt": "2026-10-14T10:30:00Z" }
}
```

`service` is the service's short name (letters, digits and hyphens), `model` the model it used, `prompt` the words that
were sent (kept so the author can see, and make again, what made the file), and `madeAt` the time in UTC. The editor
writes `requiresCredit` as true, so the credits page must be on for the course to tell its learners the picture or sound
was made by an AI service (`credit-page-off`, the same warning as any asset that needs credit). The credits page reads
"Title, made with OpenAI (gpt-image-1). AI-generated; the service's terms of use apply." The prompt is for the author and
is not shown to learners. A made picture still needs alt text like any other, and the editor never writes it from the
prompt. OpenStage keeps no key, no request and no answer from a service in a project: only the file and this record.

The credits page also lists the narration: one line for each engine whose voices speak in the course ("Narration, made
with OpenAI. Synthetic voices from an AI service, not a person."). The publisher adds these from the narration it
finds, so they are not in `assets.json`.

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
| `character` | `variable`, `characters` (2 to 8 ids from the project's cast) | the chosen person's **id** in one **string** variable, empty until chosen | a group of picture cards, one per person, each a radio button |

`prompt` is required. It is the visible name of the group (a `<legend>`, or the label of a select), so
a screen reader announces it with the controls. If `altText` says something different it is added as a
description. The ends of a semantic differential row are named for the word they are closest to ("1 of 7,
closest to Hard"), so a screen reader user knows which way round the scale runs.

A part's variable must exist in `project.json` and have the type in the table, and no two parts of one
input may share a variable, or they would overwrite each other. Option values must be different and
cannot be empty, because an empty value means "nothing chosen". The validator checks all of this
(`input-unknown-variable`, `input-variable-type`, `input-shared-variable`, `input-duplicate-value`,
`input-empty-value`, `input-duplicate-id`, `input-semantic-pole`).

**Choosing a character.** The `character` kind lets a learner pick who they will be, from people in the project's cast (`characters`, in `project.json`). Each
person is a card with their picture (if they have one), name and role, and the cards are one radio group, so the arrow keys move between them and a screen reader
says "Maya Reyes, Nurse manager, 1 of 2". Here the picture's alt text is read, once, since choosing by appearance is the point; the card's name is its label. The
chosen person's id is saved in the variable, so a trigger can branch on it (`equals`, with the person's id as the value) and a scenario can show the person as
"you" (see Scenarios). A person who is not in the cast is an error (`input-character-unknown`), and the variable has to be a string (`input-variable-type`). With
`report`, the LMS is told a `choice` whose response is the letter of the person's place in the list, `a` for the first. (Added in 0.21.0.)

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

### Scenarios

A `scenario` is a branching story that a learner steps through by choosing what to do. It is one object on one slide. Its `content`:

| Field | What it is |
| --- | --- |
| `start` | the id of the situation the learner begins in |
| `nodes` | 1 to 40 situations |
| `you` | `null`, or the name of a **string** variable that holds the id of the person the learner chose to be (see the character input) |
| `meters` | 0 to 6 meters, each `id`, `label`, `variable` (a **number** variable), `min`, `max`; they show the learner how a number is changing |
| `allowRetry` | whether the learner can take back their last choice and choose again |
| `finishedVariable` | `null`, or the name of a **boolean** variable that is set to true when the learner reaches an ending |
| `reflection` | something for the learner to think about, shown with the review of their path at an ending (may be empty) |

A **situation** (`nodes[]`) has an `id`, a `title` (its heading), a `prompt` (the question above the choices, for example "What do you do?"; may be empty, and then the title names the choices), `lines`
(1 to 12) and `choices` (0 to 6). A situation with no choices is an **ending**. A **choice** has an `id`, a `label` (what the learner does, written as the
learner would say it), `next` (the id of the situation it leads to), `effects` (0 to 6, each a `variable` and a number to `add`, which is not 0 and may be negative) and
a `response` (0 to 6 lines shown straight after the choice, before the next situation, which is where a person's reaction or a coach's note goes). A **line**
has an `id`, a `speaker`, `text` (plain text, up to 2000 characters) and a `narration` (or null, and then it can only be read). The speaker is `null` for the
narrator, `"you"` for the learner's own character, or the id of a person in the project's cast. A line may also have a **`pose`** (0.29.0): the id of one of its speaker's `poses`.
The line then shows the person in that pose (a picture of them to the waist, 220 by 180 points, with the person's name beside it as always) instead of their small round picture; with no `pose`, or `null`, it shows their picture. A pose is decoration (its `alt` is empty), and what a line means is in its words.
A narrator's line has no pose (`scenario-pose-narrator`), and the pose of a person in the cast must be one they have (`scenario-pose-unknown`). A line spoken by `"you"` may name a pose: it is shown if the person the learner chose has a pose with that id, and not otherwise, because who that will be is not known until the course is played, so the validator cannot check it and the editor does not offer it.

All the ids in one scenario are different, whatever they name (situation, choice, line or meter), because the learner's path is remembered by them and audio is
filed under them (`scenario-duplicate-id`). A choice's effect adds to a number variable when the choice is made, with the same arithmetic as the rule "add to a
number variable", so a rule can read the total with a condition, and the variable is saved with the learner's progress like any other. It does not touch quiz
scores: a scenario is not marked.

The validator checks the story is a whole one: the start exists (`scenario-start-missing`); every choice leads to a situation that exists
(`scenario-next-missing`); every situation can be reached (`scenario-unreachable`, a warning); a learner can reach an ending (`scenario-no-ending`, a warning);
every line has words (`scenario-line-empty`) and a speaker that is `you` or in the cast (`scenario-speaker-unknown`); effects add to number variables that
exist (`scenario-effect-variable`); a meter shows a number variable and goes from less to more (`scenario-meter-variable`, `scenario-meter-range`);
`finishedVariable` is a boolean (`scenario-finished-variable`); `you` is a string (`scenario-you-variable`) and some choice of character saves to it
(`scenario-you-unset`, a warning); no two choices in one situation read the same (`scenario-choice-duplicate`, a warning, because a screen reader user
could not tell them apart); and a line spoken by a person in the cast is read in that person's voice (`scenario-voice-differs`, a warning). A line's narration is
checked like any narration (`voice-unknown`, `ipa-invalid`, `narration-stale`, `narration-not-generated`).

**Narration.** A line's narration is named by the object's `id`, a slash and the line's `id`, for example `obj-0040/line-3`, the same way as an item of an
interaction (see Narration of items). A choice's label has no audio of its own: it is a button with a name, and a screen reader reads it.

**What the learner sees.** The scenario is a region named by the object's alt text. Meters come first, each a name with its number and a native `<meter>` bar
(`Trust: 2`); when a choice changes them a polite message says so ("Trust is now 3, up 2."). Then the situation: its title as a heading; its lines as a list, with a
person's name (and picture, which says nothing to a screen reader because the name is written) beside their lines, the narrator's lines without a name, and "you"
lines showing the person the learner chose, or just "You"; a **Listen to this part** button if any line has audio; then the question and the choices as a group of
buttons. Choosing a choice adds its changes to the number variables, shows "What happened" (the choice made, and its response) above the next situation, moves
keyboard focus to that heading so a screen reader says where the learner now is, and speaks the response and the situation's lines in place of whatever was being
said. Nothing is spoken when the slide opens, so it does not talk over the slide's own narration; Listen to this part plays it when asked. At an ending the learner
sees **Your path** (each situation and the choice made there), the reflection, and **Start again**. With `allowRetry`, **Take back my last choice** also appears:
it undoes the last choice and takes off what it added (a change of +2 becomes -2). Start again takes back every choice the same way. Setting a variable in a rule
between times is not undone, since the course only takes back what the choices added.

**What is remembered.** Where the learner is, is one short string kept with their progress: the number of the choice made in each situation, from the start (`"02"`
is the first choice of the start situation, then the third choice of the situation it led to). It travels in the SCORM suspend data as `c`, by the scenario's object
id, and is dropped only together with the variables when there is no room (a meter is a variable, so one without the other would return the learner to the start
with their old numbers). If the course was edited since the learner left, the path is cut at the first step that no longer fits. A walk holds at most 120 choices;
a story that loops back past that offers only Start again. A learner who comes back finds the same situation, the same meters, and the choices they have made in
**Your path**; the response to their last choice is not shown again. (Added in 0.21.0.)

### Icons

An `icon` object is a small line drawing from the Lucide icon set, drawn in the object's colour. Its `content`:

```json
{ "set": "lucide", "name": "arrow-right", "shapes": [ { "tag": "path", "d": "M5 12h14" }, { "tag": "path", "d": "m12 5 7 7-7 7" } ] }
```

`set` is `lucide`. `name` is the icon's name in the set. `shapes` are the drawn parts, from 1 to 24, kept in the project so that a course never depends on the icon set it came from.
Each shape has a `tag` (`path`, `circle`, `rect`, `ellipse`, `line`, `polyline` or `polygon`) and only the attributes that tag needs: `d` (path text, made only of path
letters and numbers), `points`, the numbers `cx cy r rx ry x y width height x1 y1 x2 y2`, and `fill` (`none` or `currentColor`). Nothing else is allowed, in the schema or in the
renderer, so an icon can never carry a script or a link. The drawing is in a 24 by 24 box with a rounded outline, no fill, and the colour of the text around it. The
object's `style.color` is its colour (a theme colour by default, so it follows the theme), and `style.strokeWidth` the width of the line (0.5 to 4, 2 if absent).

An icon is a picture, so it needs alt text that says what it means (for example "Next"), or it must be marked `decorative`; the generic alt text rule applies, and an icon
that is not decorative and falls below 3 to 1 against the slide's background is a warning (`icon-contrast`, WCAG 2.2 1.4.11). A screen reader hears the alt text as an
image; a decorative icon is hidden. The icon is `role: "img"` and is not a tab stop.

A button can show an icon beside its label: `content.icon` (the same shape as above) and `content.iconPlacement` (`before` when absent, or `after`). The icon is
decoration: the label is the button's name, the icon is hidden from a screen reader, and the button still needs its label.

**The licence.** Lucide is ISC licensed, and its notice has to travel with its icons. A published course that uses any icon names Lucide on its credits page and carries the
licence text as `licenses/lucide.txt`; the validator warns when the credits page is off (`icon-credit-page-off`). The editor's list of icons is `editor/web/icons/lucide.json`,
made from the Lucide package by `tools/make_icon_catalogue.py`, with the licence text inside it; the licence is also kept in `third-party/lucide-LICENSE.txt`. (Added in 0.22.0.)

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
  "hover":    { "style": { "color": "#0b5fff" } },
  "visited":  { "style": { "color": "#5b21b6" } },
  "disabled": { "style": { "opacity": 0.4 } },
  "Done":     { "style": { "color": "#14532d", "fontSize": 28 }, "announce": "Step 1 is marked as done" }
}
```

A state holds only the properties that differ from the normal state. The normal state is
the object's own top-level `style` and `content`. The editor calls a state a **look**.

**Names.** A name is 1 to 40 characters with no space at either end (a schema rule). `normal` is how a rule returns to the object's own appearance, so a look cannot be
called that (`state-name-normal`). `hover`, `visited` and `disabled` are applied by the course on its own, as below. Any other name is applied only when a rule applies it.

**What a look holds.** `style`: the style properties that differ, read the way the object's own `style` is, so a look on an object that paints itself in the theme's colours
changes only its font and size. `opacity` (0 to 1) says how solid the object is painted: below 1 lets what is behind it show through. `announce`: text, 1 to 200 characters, that a
screen reader says when a rule applies the look (see below). `content` is reserved and is not applied. A look is never an empty object. The editor offers looks on text, buttons, icons,
shapes and pictures.

**How looks stack.** The object is painted in its own `style`, then `visited` once the learner has used it, then the look a rule applied, then `hover` while the pointer is over it
or the keyboard is on it. A later one wins for each property it sets.

**When they apply.** The course applies `hover` and `visited` itself. A rule applies any look, including those two, with `changeState`, whose `target` is an object on the same slide and
whose `value` is `normal` or the name of a look that object has (`trigger-state-missing`). The look a rule applied lasts until the slide closes: opening a slide, or replaying it,
starts every object in its own appearance, and the learner's saved place does not hold looks. Anything that has to last is a variable, which a rule on the slide's start can turn into a look again, and a resume does the same for a rule that has a condition (see Resume, under SCORM 1.2 tracking).
`disabled` also disables a button, so it cannot be pressed or reached with the keyboard, and sets `aria-disabled` on anything else.

**What is said.** A look changes how something appears, and a change that is only seen is missed by a learner who cannot see it. When a rule applies a look that has an `announce`, the player says the
words in its polite status region. It says nothing for `normal`, for the look the object already has, or for an object that is hidden, and the course applying `hover` or `visited` on its own never says anything.
A rule that applies a look with no `announce` is a warning (`state-silent`), unless the look is `disabled` (a disabled control already says so to assistive technology) or the object is decorative. The
editor never writes the words for the author.

**Readable in every look.** The validator checks text against what is behind it for the object's own look, for each look, and for each way the looks stack. A look with `opacity` below 1 fades the
text and its own fill into what is behind them together, and is judged as it will look. The `disabled` look is left out of this: WCAG does not ask an inactive control for contrast.

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
`setVariable`, `playMedia`, `pauseMedia`, `changeState`. `stopTimer` was added in 0.32.0 (see Timers).

Three more act on the course itself, so their `target` is empty (`""`), and a trigger that has a target for one of them, or an empty target for any other action, is a
schema error: `nextSlide` goes to the slide that follows this one in the course, `previousSlide` to the one before, and `replaySlide` shows this slide again from the
start (its `slideStart` rules run, its layers close, its timing and narration begin again). Unlike `jumpToSlide`, they do not name a slide, so they keep working when
slides are moved, copied or deleted: a Next button is still a Next button. Like a jump, each ends the list of rules when it does move the learner. Where there is no
slide to go to (Next on the last slide, Back on the first) nothing moves, the list carries on, and the validator warns (`trigger-next-last`,
`trigger-previous-first`). (Added in 0.22.0.)

`setVariable` has an optional `operation`: `set` (the default) puts `value` in the variable, and `add` adds `value` to a number variable. With `add`,
`value` is the amount (it may be negative, and is 1 if there is none), and the variable must be a number. This is how a rule counts tries: add 1 to
`attempts` each time, and let a condition on `attempts` decide what happens. A click and the key press that goes with it must have the same
operation, like every other part of the rule. (Added in 0.18.0.)

v0.1 event set: `click`, `keyActivate`, `slideStart`, `slideEnd`, `mediaComplete`,
`variableChange`. `timerEnd` was added in 0.32.0 (see Timers).

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
(the learner pressing a `button`, `hotspot`, or checking a `quizQuestion`), `mediaComplete` (a `video`
or `audio` finishing) and `timerEnd` (a `timer` running out). A `variableChange` trigger is checked each time any variable changes, which is how
an input can send the learner somewhere, or show a layer, as soon as an answer is given.

**Branching on a survey answer.** An input saves the answer in a variable (see Inputs and surveys), and a
trigger's condition reads it. A "Continue" button with two triggers, one `jumpToSlide` slide-002 when the
variable equals `short`, and one `jumpToSlide` slide-003 when it equals `long`, sends each learner down
the path their answer chose. `examples/branching.osproj` does exactly this.

#### What the editor shows

The editor shows triggers as **rules**: "When *the learner presses it*, *go to a slide*, only if *choice is
The short path*." A `click` with a `keyActivate` that does the same thing is shown, and written, as one rule,
so a rule made in the editor is never mouse-only. Triggers the editor cannot show as a rule (a lone click,
a lone key press) are kept exactly as they are.

## Quiz questions

Every `quizQuestion` has a `questionType`, `scoring` (`points`, `attemptsAllowed`), `feedback` (`correct` and `incorrect`, ids of layers on the
same slide) and the fields its kind needs. The question itself is normally a heading placed before the object, and the object's `altText` names
the group of controls for a screen reader.

| `questionType` | Fields | What the learner does | How it scores |
| --- | --- | --- | --- |
| `multipleChoice` | `choices` (2 to 8, each `id`, `label`, `correct`; exactly one correct) | Chooses one radio button | All or nothing |
| `multipleResponse` | `choices` (at least one correct) | Ticks every right check box | A share: the right ones ticked, less the wrong ones ticked, over the number that are right, never below nothing |
| `shortAnswer` | `answers` (1 to 10), `caseSensitive` | Types a word or phrase | All or nothing; right if it matches any accepted answer |
| `numeric` | `min`, `max` (an exact answer has them equal) | Types a number | All or nothing; right from `min` to `max`, ends included |
| `fillBlanks` | `mode` (`typed`, `dropdown` or `drag`), `text` with a `{id}` where each blank goes, `blanks` (each `id`, `answers`), `wordBank`, `caseSensitive` | Types into blanks, or chooses from a drop-down in each, or drags words onto them | A share: the blanks that are right over all the blanks |
| `matching` | `drag`, `pairs` (2 to 10, each `id`, `premise`, `match`), `extras` (0 to 5 matches that fit nothing) | Chooses a match for each item from a drop-down, or drags matches onto the items | A share: the items matched rightly over all the items |
| `sequencing` | `drag`, `items` (2 to 10, each `id`, `text`, listed in the right order) | Puts the items in order with Move up and Move down, or drags them | A share: the items in their right place over all the items |
| `hotspot` | `image` (`src`, `alt`), `regions` (2 to 12, each `id`, `label`, `x`, `y`, `width`, `height` in percent of the picture, `correct`) | Chooses an area of a picture, by clicking it or from a list of the areas by label | All or nothing; right if the area is one marked `correct` |

**Answers.** A typed answer has its spaces tidied, and its capitals ignored unless `caseSensitive` is on. A typed number may use `1,234` for a thousand
and more, or `1,5` for one and a half, and a sum a hair off (0.1 + 0.2 for 0.3) is accepted. In a drop-down or a dragged blank the word must be
exactly a word of the `wordBank`, and the right word of each blank is the first of its `answers`; the bank holds every right word and may hold extras.
Matches and extras must read differently, because a learner chooses among them. The sentence of a `fillBlanks` marks each blank `{1}`, `{2}` and so
on, and every marker has a blank and every blank a marker.

**Shuffled answers** (added in 0.33.0). A `multipleChoice` or `multipleResponse` question may have `"shuffle": true`. Each learner is then shown its answers in an order of their own, worked out from the number the player gives that
learner when they begin and the question's id, so the same learner sees the same order each time they come back (and after they resume), and another learner sees another. Grading goes by each answer's `id`, so nothing else changes.
The editor never shuffles, so the author sees and edits their own order. An answer that depends on where it stands (`A.`, `All of the above`, `Both A and B`) is a warning when the question shuffles (`shuffle-position-words`).
Absent, or `false`, means the author's order. No other kind of question has the field (the schema refuses it).

**Order.** Matches, the word bank and the starting order of a sequence are shown in an order that is the same every time (a shuffle seeded by the
object's id) and never the order the author wrote, so the first match is not the first item's. The editor and the player show the same order.

**Partial credit.** A question with several parts earns a share of its points for the parts that are right. The best of the attempts counts, so trying
again never takes marks away. A question is finished when every part is right or the attempts are used up. Only a fully right answer shows the `correct`
feedback layer; an answer that is partly right shows the `incorrect` one, which should say what to look at again. SCORM 1.2 has no partly right result, so
the interaction of a partly right answer is `wrong` there, and the LMS's score is the total, sent as before. A question worth 0 points is practice: it is
finished the same way and adds nothing to the score.

**Dragging is an extra.** Where a question can be dragged (`drag`, or `mode: "drag"`), the drop-downs and buttons are still there, and are how a keyboard and a
screen reader answer. The words or grips that are dragged are hidden from assistive technology, because the controls already say everything. Dragging only
ever changes those same controls. Escape cancels a drag.

**What a screen reader needs.** A hotspot's picture needs alt text and every area needs a label, because the areas are listed by label for anyone who cannot
use the picture (the validator makes both errors, `quiz-hotspot-alt` and `quiz-region-label`). The editor never fills either in. A fill in the blanks reads
as the sentence with each blank named, "Blank 1 of 2". The editor can write the question's narration from what it shows, one button, and the words are then the
author's to change.

**What the LMS is told.** Each submission is one interaction, of the SCORM type that fits: `choice` for multiple choice, multiple response and hotspot (the
letters of the choices or areas, `a`, `b`, `c` in the order written), `fill-in` for short answer and fill in the blanks, `numeric` for a number (its range
as `min#max`), `matching` (`1.a,2.b`, the item number and the letter of its match) and `sequencing` (the letters of the items in the learner's order). A
long answer is cut to the 255 characters SCORM 1.2 allows.

## Timing

Every object has a `timing`, which says when it appears and when it goes. The starting value, which every new object
and every migrated object has, means always there, so a course with no timing behaves exactly as it always has.

```json
"timing": { "appear": "narration", "start": 500, "visibleFor": 6000 }
```

| Field | Meaning |
| --- | --- |
| `appear` | `"time"`: shown `start` milliseconds after the object's layer is shown (after the slide opens, for the base layer). `"narration"`: shown `start` milliseconds after the object's own narration starts playing. `"media"`: shown when a video or audio clip on the slide has played `start` milliseconds (see Following a video or an audio clip). `"click"`: shown `start` milliseconds after the learner presses **Show next item** for this object's `step` (see Waiting for the learner). |
| `step` | Only with `appear: "click"`, and then required: a whole number from 1 to 200. (Added in 0.35.0.) |
| `media` | Only with `appear: "media"`, and then required: the `id` of a `video` or `audio` object on the same slide. Absent otherwise. (Added in 0.23.0.) |
| `start` | A whole number of milliseconds, 0 to 3,600,000. With `appear: "time"` and `start: 0` the object is there from the start. With `appear: "media"` it counts the clip's own time. |
| `visibleFor` | `null` to stay, or a whole number of milliseconds, 1 to 3,600,000, after which the object goes again, counted from when it appeared. With `appear: "media"` it is that much of the clip. |

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

**Following a video or an audio clip.** An object with `appear: "media"` and a `media` id follows that clip's own playing time instead of the clock. What shows depends only on where the clip is
(`start <= time < start + visibleFor`, or from `start` to the end when `visibleFor` is `null`): the learner who plays, pauses, skips ahead or goes back sees what belongs to that moment, and nothing
that does not. An object with `start: 0` is there from the clip's start, so before anyone presses play. The clip's time is read about ten times a second while it plays (the clip itself reports only
about four), and at once when it is paused, finished or moved. It works for a video or audio file in the project; an embedded YouTube or Vimeo video cannot be followed, because its player only
reports the time to scripts loaded from its own site, and the editor does not offer one.

If the clip cannot play (the file is missing or not understood) or is not on the slide, everything that follows it shows and stays showing, so nothing is left hidden because a clip failed.
**Pause timing** also pauses a clip that is playing, and **Resume timing** plays it again (the browser can refuse, and then the learner presses play on the clip itself); **Show everything now**
shows every object that follows a clip and leaves the clip alone. Both are the same controls as before, shown on any slide where something follows a clip. The validator checks the clip exists
and is a video or audio object (`timing-media-missing`), that an object does not follow itself (`timing-media-self`), and warns when a slide with `duration` holds objects that follow a clip
(`timing-media-advance`), because the slide may move on before the clip has reached them. The editor keeps the reference when a slide is copied (the copies follow the copied clip), and when
an object is copied to a slide that does not have the clip it goes back to appearing when the slide opens, and says so. (Added in 0.23.0.)

**Waiting for the learner** (added in 0.35.0). An object with `appear: "click"` and a `step` is hidden until the learner asks for it. A slide that has any such object shows a button, **Show next item (1 of 3)**, in the navigation row, just before **Next** (Pause timing, Show everything now and Turn off animation are in the Timing controls above the slide). Each press shows the next step: the steps are the `step` numbers on a layer, once each, in order (they need not be unbroken: 3 and 7 are two presses), and objects with the same number show together, each after its own `start` (a delay counted from the press, so a picture can arrive half a second after a caption). The player says which item came ("Item 2 of 7 is showing" and the object's alt text, or its name, never for decoration) in the same polite way as the other timing controls. After the last the button says **All items are showing** and stays in place, so a learner using the keyboard is not left without it. **Show everything now** shows every step at once. A layer has steps of its own and starts them again each time it is shown; with steps on more than one layer, the base layer's come first. Unless the slide says otherwise (next paragraph), nothing moves on by itself: the learner decides when each step comes, so it is no barrier to anyone who needs more time. A slide with a `duration` and such objects is warned about (`timing-click-advance`), because it may move on before the learner has shown them. The editor draws such an object on the timeline at its delay, marked as a guess, because the clock does not know when the learner will press.

**Going away at a step** (added in 0.38.0). A `timing` may have `"until": { "step": 3, "start": 500 }`: the object goes away when the learner shows step 3 of Show next item (or when step 3 comes by itself, on a slide with `autoSteps`), `start` milliseconds after it. It can go with any way of appearing except following a clip (`timing-until-media`): there from the start, after the slide opens, at its own step of Show next item, or after its narration starts. The steps of a layer are now the step numbers objects appear at **and** the step numbers objects go away at, so a step that only has things going away is still a press of the button, and the count says so ("Show next item (3 of 5)"). The player says what went with the press ("Item 3 of 5. Chart went away."). With `visibleFor` as well, the object goes at whichever comes first. **Show everything now** shows it too, as it shows an object with a time to stay. A step the object goes away at that is not later than the step it appears at is a warning (`timing-until-before-appear`), because a learner would never see it. The PowerPoint import writes this for an exit effect that waits for a click. The animation `exit` effect of the object plays when it goes.

**One paragraph at a time** (added in 0.41.0). A text object's `timing` may have `"paragraphs": [ ... ]`, a timing for each paragraph of the text, in the order they come in it. A paragraph is a heading, a paragraph, a quotation, or a list item with whatever lists are inside it: a list's own items count and the list does not, and a bullet under a bullet goes with the bullet above it (PowerPoint's "by first level paragraphs"); words outside all of those are always shown. Each entry is a timing as an object has one (`appear`, `step`, `start`, `visibleFor`, `until`), except that it can only appear at a `time` or a `click` (not follow a clip or a narration, and it has no `paragraphs` of its own): `{ "appear": "click", "step": 2, "start": 0, "visibleFor": null }` is a paragraph shown at item 2; `{ "appear": "time", "start": 0, "visibleFor": null, "until": { "step": 3, "start": 0 } }` is one that is there from the start and goes away at item 3; a paragraph with the starting timing is always there. The object's own `timing`, `animation` and narration apply to the whole box as they always did (a box there from the start has the starting timing), and the object's `animation` is also how each paragraph arrives and leaves. Each paragraph that waits for a step is one of the steps of Show next item, numbered with the object's and the others' on the layer, counted, said ("Item 2 of 5 is showing: the paragraph's words.") and brought by themselves on a slide with `autoSteps` as any step is. A paragraph that is not showing keeps its room (the lines round it do not move), and is out of the page for a screen reader and the keyboard; in the one-column layout it takes no room. **Show everything now** shows them all. The count must match the text: timing for more or fewer paragraphs than the text has is a warning (`timing-paragraphs-count`), and only a text may have it (`timing-paragraphs-type`, an error). The editor keeps the entries in step with the words when they are edited. The PowerPoint import writes this for a text whose effects are for some of its paragraphs.

**Steps that come by themselves** (added in 0.36.0). A slide with `"autoSteps": { "first": 2000, "every": 3000 }` (milliseconds, `first` 0 to 600000, `every` 500 to 600000) has its steps pressed for the learner: step 1 `first` ms after the slide (or the layer) is shown, step 2 `every` ms after that, and so on, counted on the timeline's own clock, so **Pause timing** holds them and **Show everything now** shows them all. The objects keep their `click` timing and their step numbers (so the slide can be switched back to waiting for presses by removing `autoSteps`), and an object's own `start` delay still counts from when its step came. **Show next item** stays and brings the next step that has not come yet at once, without moving the clock: a learner who reads faster than the pace can go ahead, and the later steps stay on their times. The player says each step that comes by itself in the words it uses for a press ("Item 2 of 7 is showing: ..."), politely, so a learner who cannot see a step still knows it came. An import from PowerPoint offers this for slides whose animations wait for a click in PowerPoint, because the presenter's clicks have no learner at the keyboard in a course. A slide with a `duration` is warned about (`timing-click-advance`) only if it would move on before the last step has come. The editor's timeline draws these objects at their real times.

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
| `enter.effect`, `exit.effect` | `none`, `fade`, `slideLeft`, `slideRight`, `slideTop`, `slideBottom`, `wipeLeft`, `wipeRight`, `wipeTop`, `wipeBottom` or `zoom`. A slide arrives from that side, or leaves toward it. A wipe (added in 0.40.0) shows the object across from that edge, or hides it back toward that edge, by clipping what is drawn: nothing moves or fades, and the content is in the page throughout. `zoom` grows from slightly smaller, or shrinks to it. |
| `enter.duration`, `exit.duration` | A whole number of milliseconds, 100 to 2000. Short on purpose. |

An entrance plays when the object appears: at its time (see Timing), and also when the slide, or its layer, opens, for an object
that is there from the start. An exit plays when the object disappears at the end of its time (`visibleFor`) or at a step (`until`, added in 0.38.0), so an object with
neither never plays its exit (`animation-exit-never` is a warning). Showing everything at once, which the learner can ask
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

### Voices

`voice` names one voice of one speech engine, in one string. A name with no colon is a voice of Kokoro, the speech
model that runs on the author's computer (`af_heart`), which is how every project made before 0.26.0 names its voices
and is why none of them changed. Any other engine's voices begin with the engine's name and a colon:

| Voice | Engine |
| --- | --- |
| `af_heart` | Kokoro, on this computer. Checked against `tools/kokoro-voices.json`. |
| `openai:alloy` | OpenAI, over the internet, with the author's key. The ready-made voices only, from `tools/openai-voices.json`. |
| `my-plugin:narrator` | A voice plugin the author has installed (docs/plugins.md). A plugin's voices can be checked only on the computer that has it, so any well-formed name is accepted. |

The name before the colon is 2 to 31 lowercase letters, digits and hyphens, starting with a letter; the name after it is 1 to 60
letters, digits, `.`, `_` and `-`. A voice that does not match is `voice-unknown`. **Voices are always a fixed set of ready-made voices.** No
field of the format, and no part of the plugin contract, can hand an engine a recording to copy, because voice cloning is out of scope.

What differs between engines, and what the format says about it:

- **`lang`** is stored beside the voice as always. A Kokoro voice, and a plugin voice that names its language, set it. A voice that speaks many
  languages (OpenAI's) has no language of its own, so the editor starts it at the course's language and the author sets the
  language of the script. The captions, the transcript and a screen reader use it.
- **`pronunciations`** are IPA, and only Kokoro can use them. For any other voice they are kept in the file and ignored when the audio is made. They are still part
  of the cache hash, so changing one makes the audio again. The editor says so and offers no way to add one for such a voice.
- **`speed`** is held to what the engine can do. The hash uses the speed as written.
- **Word times.** Kokoro, and a plugin that says it reports them, give when each word is spoken. The services do not, so the cue times are estimated from
  sentence length and `exactTimings` is false. The captions still equal the script.
- **Where the audio is made.** Kokoro and most plugins work on the computer. A service receives the words of the script, over the internet, using the
  author's key. It is sent only after the author has said yes to that service, and never when a course is previewed or published (docs/ai-generation.md).
  The audio is a cache like any other: a course published from a project whose audio is already made sends nothing and needs no key.

### The cache hash

`audioCache.hash` is `sha256:` followed by the lowercase hex SHA-256 of this UTF-8 text,
lines joined with a single newline and no trailing newline: `script`, `voice`, `speed`
written with exactly three decimals (`1.000`), `lang`, then one line per pronunciation
as `term`, a tab, `ipa`. It is deliberately not a hash of serialised JSON, so that every
language that reads the format produces the same value. Reference implementation:
`narration_hash` in `tools/validate.py`.

### Where the cache lives and what it holds

For narration with hash `H`, `tools/narrate.py` writes two files to `.cache/narration/`:
`H.wav` (a WAV file: 24 kHz mono from Kokoro and the services, whatever a plugin writes) and `H.json` with `duration`, `exactTimings` and `cues`, and, for audio from a service or a plugin, `madeBy` (the engine's id, name and home page, and whether it works on this computer or over the internet), which the credits page uses.
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

Each line of a `scenario` has one in the same way, named by the object's `id`, a slash and the line's `id`. Each item of an `interaction` can have its own `narration`, exactly the shape above. It is named by a key
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

Present on any object that came from an import or from the Capture module. Null otherwise.

```json
"provenance": {
  "sourceDeck": "deck-7b21",
  "slideIndex": 4,
  "shapeId": "256/3",
  "importedAt": "2026-10-10T14:22:00Z",
  "slideId": "256",
  "sourceHash": "13a5c258ca972d",
  "base": { "type": "text", "name": "Title 1", "geometry": { "x": 48, "y": 29, "width": 864, "height": 115, "rotation": 0 },
            "content": { "html": "<h1>Welcome</h1>" }, "style": { "fontSize": 59 }, "altText": "Welcome", "decorative": false }
}
```

Never dropped on edit. Re-syncing a changed source deck depends entirely on these
fields, and they cannot be added retroactively to projects imported without them.

`sourceDeck` is the id of an entry in `project.sources`. `slideIndex` is the slide's place in the deck when it was imported. `slideId` is the deck's own number for the slide
(PowerPoint's `p:sldId`), which stays the same when slides are moved, so it, and not the place, is what finds the slide again. `shapeId` is `slideId`, a slash, and the shape's own
number on its slide (`p:cNvPr id`), so it is the same for the life of the shape and never the same for two shapes of a deck (a background picture is `slideId/background`).
`sourceHash` is a fingerprint of the shape as the deck had it: when it has not changed, the shape is not looked at again. `base` is the object as the import made it
(type, name, place and size, content, style, alt text, decorative): the version a changed deck and the author's edits are both compared with. `slideId`, `sourceHash` and
`base` are optional in the schema, and the importer always writes them.

A slide made from a slide of a deck carries a provenance of its own:

```json
"provenance": { "sourceDeck": "deck-7b21", "slideId": "256", "slideIndex": 0, "importedAt": "2026-10-10T14:22:00Z", "sourceHash": "a1b2c3d4e5f6a7",
                "base": { "name": "Welcome", "background": null, "shapes": ["2", "3", "4"] } }
```

`base.shapes` lists the shapes the import brought in, so a shape the author deleted is not brought back and a shape that is new in the deck is told apart from one that was deleted.
`base.animation` (added in 0.39.0) maps a shape's number on the slide to the `timing` and `animation` the import gave the object made from it (only for shapes that have an effect in the deck), and
`base.notes` (also 0.39.0, only when the speaker notes were made the narration of an object) holds that shape's number and the words the notes gave (`{ "key": "2", "script": "Welcome everyone." }`).
(This changes what this section used to say, that an imported slide has no provenance of its own: a slide with no shapes of its own, or whose shapes were all deleted,
still has to be found again.)

The project lists the decks:

```json
"sources": [
  { "id": "deck-7b21", "name": "Introduction to communication.pptx", "importedAt": "2026-10-10T14:22:00Z", "syncedAt": "2026-10-20T09:00:00Z",
    "slideWidth": 12192000, "slideHeight": 6858000, "pixelsPerInch": 96, "offsetX": 0, "offsetY": 0, "seen": ["256", "257", "258"] }
]
```

`slideWidth` and `slideHeight` are the deck's own units (English Metric Units, 914,400 to the inch). `pixelsPerInch`, `offsetX` and `offsetY` say how the deck was laid on the stage (see
below), so a changed deck is laid the same way even if the stage has been changed. `seen` is the deck's number for every slide the deck had when it was last imported or brought
up to date, which tells a slide the author left out from a slide the deck has since added. The validator warns of a deck that slides name and the project does not list (`import-source-missing`).

An object or a slide made by the Capture module from a recorded step names the capture and the step instead, so a changed recording can be brought
forward without losing what the author added:

```json
"provenance": {
  "sourceCapture": "capture-2026-10-13",
  "stepId": "step-3",
  "capturedAt": "2026-10-13T09:30:00Z"
}
```

`sourceCapture` and `stepId` are required and `capturedAt` is optional. A slide may carry this too, as an optional `provenance` field of its own
(an imported slide does not; its shapes carry the deck). Several objects can come from one step, so only slides are checked for two claiming the same
step (`provenance-duplicate`). A copy made in the editor (duplicate, paste, or duplicate slide) is the author's own, not the thing it was copied from, so it
has no provenance, and two objects never claim the same source. (Capture provenance added in 0.18.0.) The Capture module makes up to three lessons from the same steps (Watch, Practice and Test), and two slides may not claim one step, so it names the lesson in `sourceCapture`: the recording's folder name for Watch (`Week 3.capture`), and `Week 3.capture#practice` and `Week 3.capture#test` for the others. The format does not look inside the name.

#### What the Capture module remembers about a slide it made (0.27.0)

So that a lesson can be brought up to date when its steps change, without losing anything the author did, a slide made from a step may carry one more thing in its `provenance`: `base`, the record of what
was made.

```json
"provenance": {
  "sourceCapture": "Week 3.capture#practice",
  "stepId": "step-3",
  "capturedAt": "2026-10-18T09:30:00Z",
  "base": {
    "name": "Practice 3: Choose Save from the menu.",
    "picture": { "src": "assets/images/week-3-step-3.png", "width": 1280, "height": 720, "take": 1, "shotMs": 4200 },
    "objects": {
      "heading": { "id": "obj-0201", "layer": "layer-base",
                   "fields": { "name": "0a1b2c3d4e5f6a", "geometry": "1b2c3d4e5f6a7b", "content": "2c3d4e5f6a7b8c", "style": "3d4e5f6a7b8c9d", "...": "one for each field" } },
      "layer-hint/message": { "id": "obj-0207", "layer": "layer-hint", "fields": { "name": "4e5f6a7b8c9d0e", "...": "..." } }
    }
  }
}
```

`name` is the slide's name as made. `picture` is the picture the slide was made with (the file, its size, the take it came from and the moment in it, in milliseconds), or `null` for a slide with no
picture. `objects` has one entry for each thing that was made, under the name of its part (`heading`, `words`, `picture`, `frame`, `target`, `elsewhere`, `showme`, `question`, `answer`, and the parts of a
layer such as `layer-hint/message`): the object's `id`, the `layer` it was made on, and `fields`, a short fingerprint of each field of the object as it was made (`name`, `geometry`, `content`, `style`,
`accessibility`, `states`, `triggers`, `timing`, `animation` and `narration`). Fingerprints are of the design only: an object's `locked` and `group`, the ids of its rules and everything of a narration
but its words (so choosing another voice is not changing the words) are left out. The fingerprints are not secret or checked: the editor compares them with the slide as it is now and with the slide as
the step would make it now, one field at a time.

- A field the step would not change is left alone, whether or not the author changed it.
- A field the step would change, and the author has not, is made again from the step. (So a new picture is used even when the author has written their own description of it.)
- A field the step would change, and the author has changed, stays as the author left it, and the author is told.
- A part the author deleted stays deleted. A part the author added is not in `base` and is never touched. A part the step no longer makes is taken away only if the author never changed it.
- A slide for a step that is gone is taken away only if every part is still as it was made and nothing was added; otherwise it stays, and the author is told.

A slide with no `base` (every one made before 0.27.0) is left as it is. The validator checks the shape of `base` and nothing more.

### PowerPoint import

The editor reads a `.pptx` file (a zip file of XML parts) itself, with no library for the XML and no PowerPoint. Google Slides makes the same files. A deck is read into its slides and
the shapes on them in the deck's own units, then turned into slides and objects. What a shape is takes more than the shape: a title or a bulleted list is a *placeholder* whose position,
text size, bullets and colour come from the slide's layout and the deck's master, so those are read too (a position the shape does not give comes from the layout's, then the master's; text
style from the master's title or body style, the layout's, the shape's own list style, the paragraph's and the run's, the later winning; "shrink text on overflow" is applied as the
percentage PowerPoint stored).

| In the deck | Becomes |
| --- | --- |
| A title placeholder | A text object that is a heading (`<h1>`), role `heading` |
| Other text | A text object: paragraphs `<p>`; bulleted or numbered paragraphs `<ul>` or `<ol>`, nested by level; bold, italic, underline, superscript, subscript and web or mail links kept; one size, colour, font and alignment for the box |
| A shape with text and a fill or outline | The same text object with `fill`, `stroke`, `strokeWidth` and `radius` (an ellipse is fully rounded, a rounded rectangle 12 pixels) |
| A shape with no text | A `shape` object (rectangle, rounded, ellipse, triangle, diamond or arrow; any other form is drawn as a rectangle and counted) |
| A straight line | A thin rectangle `shape` |
| A picture | An `image` object, the file saved as `assets/images/pptx-<fingerprint>.<ext>` (the same picture is one file) |
| A table | A `table` object: cell text, first row and first column as headers |
| A picture used as a slide's background | A decorative `image` object at the back, and the slide's `background` set to the picture's average colour, so the text on it can be checked |
| Alt text written in PowerPoint | `altText`. Nothing is made up: a picture or a table with none is left for the Problems list; a shape with none is decorative, as a new shape in this editor is; a text box's alt text is its own words |
| "Mark as decorative" | `decorative` |

Left out, and said so in the report: charts, SmartArt, embedded objects and movies or sounds (named, with the reason), pictures a web page cannot show (EMF, WMF, TIFF), slanted lines, hidden
shapes, dates, footers and slide numbers, speaker notes, animations and transitions. Changed, and counted: fonts a web page cannot count on are replaced by the course's own font; a box with
more than one size or colour takes the one most of its words have; a cropped picture is shown whole; merged table cells are separate.

The deck is laid on the stage at one scale for the whole deck: as big as it goes without being cut, in the middle (`pixelsPerInch` and the offsets in `project.sources`). Text sizes follow the same
scale (points to pixels at that scale). Reading order is the deck's order, which is the order PowerPoint's screen reader reads; the objects are numbered for the tab key in that order, decoration excepted.

#### Bringing a deck up to date

A deck is compared with the course in three parts: the deck as it was imported (`provenance.base`), the object now (the author's version), and the deck as it is now. Each object is compared one
property at a time (its name, each of its place and size numbers, each key of its content and style, its alt text and decorative flag). A property only the deck changed comes forward; a property
only the author changed stays; a property both changed is a *conflict*, and is offered unticked, to replace the author's. A text box whose alt text is still just its own words moves with the words.
Nothing the author added is touched: rules, narration, timing, animation, looks, layers and objects made in the editor are not in the deck and are never compared. What is offered, each with its own
box to tick: a new shape; a changed shape (and, separately, the conflicts on it); a shape the deck removed (ticked only if the author did nothing to it and added nothing to it); a new slide; a slide the
deck has that the author left out or deleted (unticked); a slide the deck no longer has (unticked); a changed slide name or background. A shape the author deleted is not brought back.
Two more are compared from 0.39.0, on the same three-way rule: the timing and animation of each shape (`base.animation`, the object's `timing` and `animation`, and what the deck gives now; one item for the slide's takes and, unticked, one for the author's conflicts), and, when `base.notes`
is there, the narration's words (`base.notes.script`, the narration's `script`, and the deck's notes now; the voice and the made audio are not touched, the item says the audio is to be made again). A slide without
a record (imported before 0.39.0) has nothing to compare against: where the object already matches the deck nothing is offered, and where it differs the change is offered unticked as a replacement,
since there is no telling whether the author made it. The records move on to the deck as it is each time, except for what was left unticked.
What was left unticked stays recorded as it was, and is offered again next time. The result is one undo step. The order of slides is noticed and reported, and not changed.

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
- **setVariable.** With no `value`, sets the variable to `true`. With `operation` `add` it adds `value` (1 if there is none) to a number variable
  instead, rounded to nine decimal places so that adding 0.1 three times gives 0.3. A variable that is not a number is left alone; the validator
  reports a rule that would try.
- **changeState.** The state name is the trigger's `value`; with no `value` it means `normal`. `normal` returns to the base
  style. Only a state's `style` is applied in v0.1, not its `content`. `hover` also applies
  on keyboard focus, and `visited` applies after first activation. A look the object does not have changes nothing. If the look has an `announce`, and the
  object is showing and was not already in that look, the player says it (see States). Looks start over each time a slide opens.
- **Conditions.** All conditions on a trigger must hold.
- **variableChange.** Fires every `variableChange` trigger on the current slide whenever any
  variable changes. Trigger chains stop after 50 nested steps.
- **quizQuestion.** Draws the controls for its kind (see Quiz questions) and a "Check answer" button. Checking with nothing
  answered says what is missing and counts nothing. Otherwise it grades the answer, shows the `feedback.correct` layer for a
  fully right answer or the `feedback.incorrect` layer for any other (hiding the other), counts the attempt, keeps the best score,
  and runs the object's `click` or `keyActivate` triggers. A fully right answer, or using the last attempt, locks the question.
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
  object has a script that says so, which the editor can write from the question.
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
  **Looks come back by their conditions.** A look lasts only until its slide closes and is not saved, so a resumed
  slide would show a used tile as open. The variables are saved, so the looks that depend on them are worked out
  again: every rule on the slide whose action is `changeState` and that has at least one condition is run once more
  against the restored variables, `slideStart` rules first and then `variableChange` rules, each in the order of the
  slide's objects and their rules, as they would have run. Nothing else is run again (a rule that sets a variable, jumps
  or shows a layer would repeat what the learner already did). A `changeState` rule with no condition is not run again,
  because the learner may have changed that look since the slide opened; such a look is back to the object's own
  appearance after a resume, as before. The looks are applied silently: an `announce` message is not spoken, because
  the learner is not being told of a change. If the saved text had no room for the variables (see above), the
  conditions are judged on their starting values.
- **Exit.** `cmi.core.exit` is `suspend` unless the course is finished, and `session_time` is
  sent, when the page is hidden or unloaded. The final write happens once.
- **Interactions.** Each quiz submission is recorded as an interaction of the SCORM type that fits the kind of question (see Quiz
  questions), with the student's response, result, weighting and correct response.
- **Review and browse mode** are read only: nothing is written.

## Which tracking the page uses

One published course serves all three kinds of package (SCORM 1.2, SCORM 2004 and xAPI): the files are the same and only
the file that describes the package differs. When the page opens it looks, in this order, for a SCORM 2004 API
(`window.API_1484_11`), then a SCORM 1.2 API (`window.API`), each in a parent frame or the opener, and then for the launch
details of a learning record store in its own address (`endpoint` and `actor`). The first it finds reports for the course. With none, such as a
file opened from disk, the course runs untracked. What counts as complete, and what counts as passed, is the same under all
three: the sections "Completion", "Score" and "Pass mark" of SCORM 1.2 tracking above are the one definition.

## SCORM 2004 tracking

The package is `<name>-scorm2004.zip`, for SCORM 2004 4th edition: the course, an `imsmanifest.xml`, and the editable
project under `source/`. As with 1.2, the ADL schema files (`.xsd`) are not bundled.

- **Two statuses.** `cmi.completion_status` is `incomplete` until the course is complete, then `completed`. `cmi.success_status`
  is written only when the course is complete and the assessment is finished: `passed` or `failed`. They are separate, so a
  learner who finishes everything but fails is `completed` and `failed`, which 1.2 cannot say. A finished status is never moved back.
- **Score.** Written once, when the course is complete: `cmi.score.min` 0, `max` 100, `raw`, and `scaled` (raw over 100, to four
  decimals). `cmi.progress_measure` is the share of slides seen, and stays below 1 (0.99 at most) until the course is complete.
- **Pass mark.** For a course with a quiz the manifest gives the primary objective `satisfiedByMeasure` with a
  `minNormalizedMeasure` of 0.8, so an LMS that works success out from the scaled score gets the answer the course gives.
  Every course's manifest also says the content sets its own completion and success (`completionSetByContent` and
  `objectiveSetByContent`); without that an LMS may mark the course complete when the learner leaves, whatever it reported.
- **Position and resume.** `cmi.location` holds the slide id and `cmi.suspend_data` the same text as in 1.2, but may be up to
  64000 characters (what the standard asks every LMS to hold), so nothing is dropped from it unless it would not fit even then.
  On `cmi.entry` of `resume` the course restores the state, exactly as in 1.2.
- **Exit.** `cmi.exit` is `suspend` unless the course is complete, when it is `normal`. `cmi.session_time` is an ISO 8601
  duration such as `PT1H2M3.45S`. `Terminate` is called once, when the page is hidden or unloaded.
- **Interactions.** Each quiz submission is one interaction: `id`, then `type`, then `timestamp`, `learner_response`, `result`
  (`correct` or `incorrect`; a partly right answer is `incorrect` and the share of points is in the score), `weighting` and
  `correct_responses`. The order matters: an LMS refuses an answer before its type. The standard's own answer syntax is used,
  not the plainer forms of 1.2:

  | Question | `type` | `learner_response` and patterns |
  | --- | --- | --- |
  | Multiple choice, multiple response, hotspot | `choice` | letters joined by `[,]`, such as `a[,]c` |
  | Sequencing | `sequencing` | letters in order, `b[,]a[,]c` |
  | Matching | `matching` | `1[.]a[,]2[.]c` (item, then option) |
  | Number | `numeric` | a number, and the pattern `1[:]5` for a range or `7` for an exact answer |
  | Short answer | `fill_in` | the text; the pattern begins `{case_matters=true}` when capitals matter |
  | Fill in the blanks | `fill_in` | each blank joined by `[,]`; the pattern begins `{case_matters=...}{order_matters=true}` (a word picked from a list is exact) |

  A number question answered with something that is not a number is sent as type `other`. A separator typed inside a learner's
  words (`[,]`, `[.]`, `[:]`) is changed to have a space in it, so it cannot be mistaken for one. An input the author chose to
  report is an interaction too: a tick box is `true_false` with `true` or `false`, a rating is `likert`, a drop-down or radio group is `choice`.
- **Review and browse mode** are read only: nothing is written.
- **Not done.** Only the primary objective is used, there is one SCO (so no sequencing between parts), and `adl.nav.request`, `cmi.comments_from_learner` and
  `cmi.interactions.n.objectives` are not written.

## xAPI tracking

The package is `<name>-xapi.zip`: the course, a `tincan.xml` (which names the course, its identifier and its launch file, `index.html`),
and the editable project under `source/`. It is for xAPI 1.0.3. The LMS or learning record store (LRS) opens `index.html` with
its details in the address (the "TinCan launch"): `endpoint`, `auth` (the Authorization header value), `actor` (JSON),
`registration` (a UUID, optional) and `activity_id` (optional).

- **Launch rules.** The `endpoint` must be https, except on the learner's own computer (`localhost`, `127.0.0.1`, `[::1]`),
  because the learner's answers are sent to it. The `actor` must name the learner in exactly one way (`mbox`, `mbox_sha1sum`,
  `openid` or `account`); the older launch form with each value in a list is understood. If the details are missing or do not meet
  these rules the course runs untracked.
- **The course's identifier** is `activity_id` from the address if there is one, otherwise
  `https://openstageauthor.com/xapi/course/<the title as a slug>-<the project's created date>`, which is also the id in
  `tincan.xml`. It stays the same each time the course is published, and changes if the title is changed.
- **Statements.** Each has a UUID, the actor, the registration if there is one, and the platform `OpenStage Author`.

  | Verb | Object | When |
  | --- | --- | --- |
  | `initialized` | the course | the course opens |
  | `resumed` | the course | the course opens at a saved place |
  | `experienced` | a slide | a slide is shown (once each time it changes) |
  | `answered` | a question, as an interaction | a question is submitted, or a reported input is changed; the result has `response`, `success` (every part right) and `score` (the share of the question's points); the object has `interactionType` and `correctResponsesPattern`, in the same syntax as SCORM 2004 above |
  | `completed` | the course | once, when the course is complete; `completion` true, `duration`, and the score |
  | `passed` or `failed` | the course | once, when the course is complete and the assessment is finished; `success`, and the score (`scaled`, `raw`, `min` 0, `max` 100) |
  | `suspended` or `terminated` | the course | the learner leaves: `terminated` if the course is complete, `suspended` if not; `duration` |

  `completed` and the result are never sent before the course is complete, and never twice in one launch.
- **Position and resume.** The learner's place is kept in the State resource, under the state id `openstage-progress` for the
  course, the actor and the registration: `{"v":1,"suspend":"...","completed":false}`, where `suspend` is the same text as in
  SCORM. It has no size limit in xAPI, so nothing is dropped from it. It is saved when it changes. On a launch with a saved place
  that is not complete the course restores it, as in 1.2. A finished course starts again from the beginning. A different registration is a different place.
- **Delivery.** Statements go in order, in one request for what one click did. A request the LRS refuses as wrong (a 4xx other than 429) is not
  sent again; one it could not answer (no network, 5xx, 429) is tried up to three times. When the learner leaves, the last
  statements and the saved place are sent so they can outlive the page (`keepalive`). If the LRS has not answered the request for the saved place in
  four seconds, or answers that there is none, the course opens at the start and goes on sending statements as usual. While it waits the page is marked `aria-busy`.
- **The credential.** `auth` is used only as the Authorization header of requests to the `endpoint` it came with. It is not put in a statement,
  a message, or storage.
- **Not done.** cmi5 (a different launch and statement profile), statement signing and attachments. A learner who opens a finished
  course again starts it again, and sends new `completed` and result statements for that attempt.

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
| 0.40.0 | 0.41.0 | Adds the optional `paragraphs` of a text object's `timing`: a timing for each paragraph or list item, so a text can come in or go away one paragraph at a time (how a PowerPoint text that builds by paragraph comes across). Nothing in an older course changes. |
| 0.39.0 | 0.40.0 | Adds four wipe effects, `wipeLeft`, `wipeRight`, `wipeTop` and `wipeBottom`, to the effects an object's `animation` or a slide's `transition` can use (how a Wipe in PowerPoint comes across). Nothing in an older course changes. |
| 0.38.0 | 0.39.0 | Adds the optional `animation` and `notes` of the `base` of a slide's import provenance: what the import gave each animated shape's `timing` and `animation`, and the words of the speaker notes it made the narration of one object, so a changed deck's animation and notes can be compared with what the author has done since. Nothing in an older course changes: a slide without them is compared as if they were not recorded (see below). |
| 0.37.0 | 0.38.0 | Adds the optional `until` of an object's `timing`: the object goes away when the learner shows a step of Show next item (how an exit effect that waits for a click in PowerPoint comes across). Nothing in an older course changes. |
| 0.36.0 | 0.37.0 | Adds the optional `transition` of a slide (how the slide arrives and how it leaves, with the same effects as an object's animation). Nothing in an older course changes. |
| 0.35.0 | 0.36.0 | Adds the optional `autoSteps` of a slide (the steps of Show next item come by themselves, one after another). Nothing in an older course changes. |
| 0.34.0 | 0.35.0 | Adds timing that waits for the learner (`appear` `click`, with a `step`) and the text style keys `verticalAlign`, `paddingX`, `paddingY`, `autoFit` and `paragraphSpacing`. Nothing in an older course changes. |
| 0.33.0 | 0.34.0 | Adds the optional `hideNavigation` of a slide (leave out Back and Next on it). Nothing in an older course changes. |
| 0.32.0 | 0.33.0 | Adds question banks (the optional `banks` of `project.json`) and the optional `shuffle` of a multiple choice or multiple response question. Nothing in an older course changes. |
| 0.31.0 | 0.32.0 | Adds the timer: an object of type `timer` (`seconds`, `label`, `extendBy`), the event `timerEnd` and the action `stopTimer`. Nothing in an older course changes. |
| 0.30.0 | 0.31.0 | Adds values in a text: a `text` object's `html` can hold `{{Name}}`, naming a variable or one of the values the course works out (`$score`, `$possible`, `$percent`, `$answered`, `$questions`, `$correct`), and the player shows and updates it. Nothing in an existing project has to change, unless a text already had words in double braces, which now name a value (the validator says if they name nothing). |
| 0.29.0 | 0.30.0 | Adds the speech and thought bubbles: the shapes `speech` and `thought`, the optional `tail` (`left` or `right`) of a shape that is one, and the optional `bubble` and `tail` of a `text` object (words in a bubble). Nothing in an existing project has to change: no shape is a bubble and no text has one. |
| 0.28.0 | 0.29.0 | Adds the optional `poses` and `library` of a person in the cast (more pictures of them, each in a pose, and the character pack they came from) and the optional `pose` of a line of a scenario (which of its speaker's poses to show). Nothing in an existing project changes: no person has poses and no line has a pose. |
| 0.27.0 | 0.28.0 | Adds the optional `altSuggestion` to an object's `accessibility`: a description the computer worked out and the author has not approved (`text` and `basis`). The course never uses it, and alt text is still required. Nothing in an existing project changes: no object has one. |
| 0.26.0 | 0.27.0 | Adds the optional `base` to a slide's Capture provenance: what the Capture module made for a step (the slide's name and picture, and for each part its id, layer and a fingerprint of each field), so a lesson can be brought up to date without losing what the author changed. Nothing in an existing project changes: no slide had one, and a slide without one is left as it is when a lesson is brought up to date. |
| 0.25.0 | 0.26.0 | Adds the `generated` credit provider and its record (a picture or sound an AI service made, with the service, model, prompt and time), and lets a narration's `voice` name an engine other than the built-in one (`openai:alloy`). Nothing in an existing project changes: a voice with no engine in its name is still Kokoro's, and nothing was generated before. |
| 0.24.0 | 0.25.0 | Adds what is needed to bring slides in from a PowerPoint deck and to bring them up to date: `project.sources` (the decks, and how each was laid on the stage), a slide's own import provenance, and in an object's import provenance the deck's slide number (`slideId`), a fingerprint of the shape (`sourceHash`) and the object as it was imported (`base`). Nothing in an existing project changes: nothing was imported before. |
| 0.23.0 | 0.24.0 | Adds `announce` to a look (an object state): the words a screen reader says when a rule applies the look. Nothing in an existing project changes: no look has one. A look's name now has limits (1 to 40 characters, no space at either end). |
| 0.22.0 | 0.23.0 | Adds `timing.appear: "media"` and `timing.media`: an object can appear and go at moments in a video or audio clip on its slide. Nothing in an existing project changes: every timing there says `time` or `narration`. |
| 0.21.0 | 0.22.0 | Adds the `icon` object, an optional `icon` (and `iconPlacement`) on a button's content, and the trigger actions `nextSlide`, `previousSlide` and `replaySlide`, which take an empty `target`. Nothing in an existing project changes: no icon means none, and no rule uses the new actions. |
| 0.20.0 | 0.21.0 | Adds the `scenario` object (a branching story the learner steps through by choosing), the optional project `characters` (a cast, each with a name, a picture and a voice), and the input kind `character` (the learner chooses who they are). Nothing in an existing project changes: no cast means no characters, and no scenario object means no scenario. |
| 0.19.0 | 0.20.0 | Adds the optional `logo` to a theme: one picture in a corner of every slide. Nothing in an existing project changes, because no logo means none. |
| 0.18.0 | 0.19.0 | Adds the optional audio `description` on a `video` (cues, each with a time, words, whether the video waits, and a voice). Nothing in an existing project changes, because no description means none. |
| 0.17.0 | 0.18.0 | Adds the optional `operation` on a `setVariable` trigger (`add` counts), defines the `hotspot` object (a transparent button with no content, so a hotspot that had content has it cleared), lets `provenance` name a capture step and lets a slide carry it, and adds the optional `sourceExclude` list to `project.json`. Nothing else in an existing project changes. |
| 0.16.0 | 0.17.0 | Adds the optional `group` field to objects, which groups objects in the editor. Nothing in an existing project changes, because no field means not in a group. |
| 0.15.0 | 0.16.0 | Adds the quiz question kinds `multipleResponse`, `shortAnswer`, `numeric`, `fillBlanks`, `matching`, `sequencing` and `hotspot`, and partial credit. Existing questions are multiple choice, which has not changed. Nothing in an existing project changes. |
| 0.14.0 | 0.15.0 | Adds the optional `locked` field to objects, which locks an object in the editor. Nothing in an existing project changes, because no field means unlocked. |
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

- Quiz model. Settled: a question is an object type (`quizQuestion`), with a kind for each way of answering.
- Theme scope. How much can a theme override before a slide stops being portable between
  projects?
- Reusable components. Linked instances versus independent copies, and how a linked
  instance records what it points at.
- Zipped distribution. Extension, and whether the archive is the editable form or only a
  transport wrapper.
