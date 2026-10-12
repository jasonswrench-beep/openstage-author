# Validator specification

**Version 0.1 (draft).**

The validator is the first piece of code in the project. It reads a project directory
and reports what is wrong with it. It is also the first acceptance test: a format you
cannot validate is a format you have not actually specified.

## What it does

1. Reads `project.json` and every slide file it references.
2. Checks structure against the JSON Schema.
3. Checks the things a schema cannot express (the semantic rules below).
4. Prints a report of errors and warnings with file, object id and a plain-language
   explanation.
5. Exits non-zero if there are errors.

## Errors versus warnings

An **error** means the project is invalid and will not publish correctly. An error stops
a publish.

A **warning** means the project is valid but something is probably wrong. Warnings never
stop a publish.

Accessibility problems are errors, not warnings. This is the choice that makes the
accessibility positioning real rather than aspirational. A tool that warns about missing
alt text produces courses with missing alt text.

## Schema checks

Generated from the JSON Schema. Required fields present, types correct, enumerated
values within range, ids well-formed.

Required on every object: `id`, `type`, `geometry`, `accessibility`.
Required inside `accessibility`: `altText`, `role`, `tabOrder`, `decorative`.

## Semantic rules

### Accessibility — all errors

| Rule | Message |
| --- | --- |
| An object with `decorative: false` has an empty `altText` | Object needs alt text, or must be marked decorative |
| An object with `decorative: true` has a non-empty `altText` | Decorative objects should not carry alt text |
| Two objects on the same layer share a `tabOrder` | Tab order must be unique within a layer |
| An interactive object (`button`, `hotspot`, `quizQuestion`) has `tabOrder: 0` or null | Interactive objects must be reachable by keyboard |
| An interactive object has a `click` trigger with no `keyActivate` equivalent | Interactive objects must be operable by keyboard |
| A `video` or `audio` object has no caption track and no narration script | Time-based media needs captions |
| Text contrast against its background is below WCAG 2.2 AA | Contrast too low |

The `click` without `keyActivate` rule is the one that will be most tempting to soften.
It should not be softened. It is the difference between a tool that produces accessible
courses and a tool that permits them.

### Accessibility — warning

| Rule | Message |
| --- | --- |
| `tabOrder` values on a layer are not a contiguous run from 1 | Tab order has gaps |

A gap does not stop a keyboard user reaching anything, because focus follows the order of
the values, not their spacing. It is untidy rather than inaccessible, so it is a warning.
Duplicates, which do make the order ambiguous, remain errors.

### Format integrity — errors

| Rule | Message |
| --- | --- |
| A trigger `target` names a slide, layer, object or variable that does not exist | Trigger points at something missing |
| A scene lists a slide id with no matching file | Slide file missing |
| A referenced asset path does not exist under `assets/` | Asset missing |
| An object id appears twice in one project | Duplicate object id |
| A condition references an undefined variable | Condition uses an unknown variable |
| `schemaVersion` is newer than the validator understands | Project was made with a newer version |
| `schemaVersion` is older than the validator understands (`needs-migration`) | Project was made with an older version and needs updating |
| A style uses a `theme:` token that the theme does not define (`theme-token-unknown`) | Style uses a theme value that does not exist |
| Pairs of theme colours that are used together fall below WCAG AA (`theme-contrast`) | Theme colours do not contrast enough |

### Quizzes — errors

| Rule | Message |
| --- | --- |
| A `quizQuestion` does not have exactly one answer marked `correct` | Quiz needs exactly one correct answer |
| Two answers in one `quizQuestion` share an id | Quiz answers must have different ids |

### Interactions — errors

| Rule | Message |
| --- | --- |
| Two items in one `interaction` share an id (`interaction-duplicate-item`) | Interaction items must have different ids |
| The number of items is outside what the kind allows (`interaction-item-count`) | Interaction has the wrong number of items for its kind |
| An item's picture has no alt text and is not decorative (`interaction-image-alt`) | Interaction image needs alt text, or must be marked decorative |
| An item's picture is decorative but has alt text (`interaction-image-alt`) | Decorative images must have no alt text |

An interaction with no items, or an unknown `kind`, is a schema error. A picture that is not in the
project is reported as `asset-missing`, and an interaction with a tab order of 0 as
`not-keyboard-reachable`.

### Rules (triggers)

| Rule | Message |
| --- | --- |
| A condition compares a variable with a value of another kind (`condition-value-type`) | Condition compares a variable with the wrong kind of value |
| `setVariable` has a value of the wrong kind, or none for a variable that is not true or false (`trigger-value-type`) | Setting a variable to the wrong kind of value / Setting a variable needs a value |
| An ordering comparison on text or true and false (`condition-operator`, warning) | Condition puts text or true and false in order |
| A condition on a variable an input saves to asks for a value no answer saves, or a scale point past the end (`condition-never-true`, warning) | This condition can never be true |
| A `click` or `keyActivate` rule on an object that cannot be pressed, or `mediaComplete` on one that is not media (`trigger-event-never`, warning) | This rule's event never happens on this kind of object |

A click and its matching key press are one rule to an author, so a problem with a rule is reported once.
Triggers that point at a missing target or variable are `trigger-target-missing` and
`condition-unknown-variable`, as before.

### Timing — an error and warnings

| Rule | Severity | Message |
| --- | --- | --- |
| An object is set to appear with its narration but has none (`timing-narration-missing`) | Error | This object is set to appear with its narration, but it has none |
| A slide has a `duration` and holds a question (`slide-advances-with-question`) | Warning | A slide with a question moves on by itself |
| A base layer object appears at or after its slide's `duration` (`timing-after-advance`) | Warning | This object would appear after the slide has moved on |
| A control (a button, an input, a question, an interaction, a download and the like) has a `visibleFor` (`timing-control-disappears`) | Warning | A control that disappears can leave a learner stuck |
| A text or scrolling text object stays for less than three seconds, or for fewer seconds than its words need at 3 words a second (`timing-too-brief`) | Warning | This text may disappear before it can be read |
| An object has an exit effect but no time to stay, so it never goes (`animation-exit-never`) | Warning | This object has an exit effect but never goes |

The shape of `animation` is checked by the schema too: both parts required, each effect one of the seven, a whole number of
milliseconds from 100 to 2000, nothing else allowed.

The shape of `timing` is checked by the schema: both fields required, `appear` one of `time` or `narration`, whole
millisecond values within an hour, nothing else allowed. A `duration` must be above zero.

### Files to download

| Rule | Message |
| --- | --- |
| A `download`'s `title` is blank (`download-title-missing`) | A file to download needs a name |
| Its `description` is blank (`download-description-missing`) | A file to download needs a description |
| `accessibleConfirmed` is false (`download-unconfirmed`) | Confirm that this file is accessible |
| The file's extension is not one of the kinds in `tools/download-types.json` (`download-file-type`) | This kind of file cannot be offered for download |
| The file is not in the project (`asset-missing`) | Asset missing |

All are errors, so a course cannot be published until each is settled. A `download` is a control, so it also needs
alt text and a tab order of 1 or more like the other controls.

### Embedded video, media and credits

| Rule | Message |
| --- | --- |
| An `embed`'s id is not a valid YouTube or Vimeo id (`embed-id-invalid`) | The video address is not a valid YouTube (or Vimeo) video |
| `captionsConfirmed` is false (`embed-captions-unconfirmed`) | Confirm that the embedded video has captions |
| The `transcript` is empty (`embed-transcript-missing`) | An embedded video needs a transcript |
| Always, as a warning (`embed-needs-internet`) | An embedded video needs an internet connection |
| A `video` has no captions and no narration script, or an `audio` has no captions, narration script or transcript (`media-needs-captions`) | Time-based media needs captions |
| `assets.json` lists a file twice (`credit-duplicate`) | An asset is listed twice |
| A credited file is not in the project (`credit-asset-missing`, warning) | A credited asset is not in the project |
| An asset that requires credit lacks its creator, source link or licence (`credit-incomplete`) | Credit is required but incomplete |
| An asset that requires credit is used and `credits` is off (`credit-page-off`, warning) | This project uses an asset that needs credit, but the credits page is off |

### Results and certificates — warnings

| Rule | Message |
| --- | --- |
| A `results` object in a course with no `quizQuestion` (`results-no-quiz`) | This results box has no quiz to report on |
| A `certificate` object in a course with no `quizQuestion` (`certificate-no-quiz`) | No one can earn this certificate, because the course has no quiz |

Both also need `altText` like any other object, and a `certificate` needs a `tabOrder` of 1 or more.

### Completion — warning

| Rule | Message |
| --- | --- |
| `completion` is `"all"` and a `jumpToSlide` trigger goes from a slide to one more than one place further on (`completion-skippable`) | A rule skips slides, but this course is complete only when every slide has been seen |

Going back, or to the next slide, never warns. The fix is to choose the last slide as what completes the course.

### Inputs — errors

| Rule | Message |
| --- | --- |
| A part saves to a variable that is not in `project.json` (`input-unknown-variable`) | Input saves to a variable that does not exist |
| A part saves to a variable of the wrong type (`input-variable-type`) | Input saves to a variable of the wrong type |
| Two parts of one checkbox, Likert or semantic input save to the same variable (`input-shared-variable`) | Two parts of an input save to the same variable |
| Two options save the same value (`input-duplicate-value`) | Two options save the same value |
| An option's saved value is empty (`input-empty-value`) | An option's saved value cannot be empty |
| Two parts share an id (`input-duplicate-id`) | Input parts must have different ids |
| A semantic differential row has no right-hand word (`input-semantic-pole`) | Both ends of a scale row need a word |

A missing `prompt`, or missing parts for the kind, is a schema error, and an input with a tab order of 0
is `not-keyboard-reachable`.

### Tables — errors and a warning

| Rule | Message |
| --- | --- |
| The rows of a `table` have different numbers of cells (`table-not-rectangular`) | Every row of a table needs the same number of cells |
| A `table` has neither `headerRow` nor `headerColumn` (`table-needs-header`) | A table needs a header row or a header column |
| A header cell has no text (`table-empty-header`, warning) | A header cell is empty |

A `scrollingText` with a tab order of 0 is `not-keyboard-reachable`, like any other control.

### Narration — mixed

| Rule | Severity | Message |
| --- | --- | --- |
| `audioCache.hash` does not match a hash of the current narration inputs | Warning | Narration audio is stale and will be regenerated |
| `audioCache` points at a file that does not exist | Warning | Narration audio not yet generated |
| A `pronunciations` entry has invalid IPA (anything but IPA letters, stress and length marks, spaces, and `æ ð ø ŋ œ`) | Error | Pronunciation override is not valid IPA |
| `voice` is not in the available voice set | Error | Unknown voice |

The same four rules apply to the `narration` of each item of an interaction, and the finding names the item in its
detail. An item whose `narration` field is missing is a schema error: every item must say `null` or hold a narration.

A stale or missing cache is explicitly not an error. The whole point of treating audio
as derived is that a project with an empty cache is a complete project.

### Provenance — warnings

| Rule | Message |
| --- | --- |
| Some objects on a slide have provenance and others do not | Slide mixes imported and new objects; re-sync will only affect imported ones |
| Two objects share the same `sourceDeck` and `shapeId` | Duplicate provenance, re-sync behaviour undefined |

## Output

Default: plain text, grouped by file, errors before warnings.

```
slides/slide-002.json
  ERROR  obj-0014  Object needs alt text, or must be marked decorative
  ERROR  obj-0019  Interactive objects must be operable by keyboard
                   Has a click trigger but no keyActivate trigger.
  WARN   obj-0007  Narration audio is stale and will be regenerated

2 errors, 1 warning
```

`--json` emits machine-readable output for the editor to consume, so the same rules
power both the command-line check and the in-editor problem list. One implementation,
never two.

## How it gets run

A double-clickable script in the project root that validates `examples/` and prints the
report, so it can be run without a terminal.

## Build order

1. JSON Schema for the format.
2. Loader that reads a project directory into memory and reports structural failures.
3. Schema validation.
4. Semantic rules, accessibility first.
5. Text and JSON reporters.
6. Test fixtures: a valid project, and one deliberately broken project per rule above.

The broken fixtures matter as much as the valid ones. Every rule needs a fixture that
triggers it, or the rule is untested and will quietly stop working.

## Implementation notes (as built)

The validator is `tools/validate.py`, with tests in `tools/test_validate.py`. Every rule
above has a test. Decisions made while building it:

- **Schema carries four single-object accessibility rules** (alt text present, no alt text
  on decorative objects, interactive objects need `tabOrder` of 1 or more, media needs
  captions or narration). They are reported with the messages in the tables above.
- **Tab order gaps are a warning**, for the reason given above. The severity is one
  constant (`TAB_GAP_SEVERITY`) in the validator.
- **Tab order 0 or null** means "not in the tab sequence". Only values of 1 or more take
  part in the uniqueness and gap checks.
- **Keyboard equivalence:** a `click` trigger is matched by a `keyActivate` trigger with the
  same action, target, value and conditions.
- **Contrast** is checked only when an object has both a hex `color` and a hex `fill` (or
  `background`), including in each state. Text with no stated background is skipped until
  themes exist. Large text (24px, or 18.66px bold) needs 3:1, all other text 4.5:1.
- **IPA validity** is a character-set check, not a phonological one.
- **Voice set** is `tools/kokoro-voices.json`, checked against the 54 voices published for Kokoro-82M.
- **Added beyond the tables:** slide id must match its file name (error), slide files not
  in any scene (warning), quiz and simulation feedback layers must exist (error).
- **Missing slide files** are reported once, not again for every trigger that jumps there.
- If a file fails structural schema checks, semantic rules skip it, so one broken field
  does not produce a cascade of unrelated findings.
