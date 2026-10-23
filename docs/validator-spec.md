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

A suggested description is checked for shape: `altSuggestion` has a non-empty `text` (at most 1000 characters) and a non-empty `basis` (at most 300), and nothing else.

## Semantic rules

### Accessibility — all errors

| Rule | Message |
| --- | --- |
| An object with `decorative: false` has an empty `altText` | Object needs alt text, or must be marked decorative. When a suggested description is attached (`altSuggestion`, 0.28.0) the detail shows it: "A suggested description is waiting for you to check: ... Use it, or write your own." It is still an error: a suggestion is never used by the course |
| An object with `decorative: true` has a non-empty `altText` | Decorative objects should not carry alt text |
| An object has a suggested description (`altSuggestion`) and also has alt text of its own, or is decorative (`alt-suggestion-unused`, a warning, not an error) | A suggested description is still attached to an object that does not need one |
| Two objects on the same layer share a `tabOrder` | Tab order must be unique within a layer |
| An interactive object (`button`, `hotspot`, `quizQuestion`) has `tabOrder: 0` or null | Interactive objects must be reachable by keyboard |
| An interactive object has a `click` trigger with no `keyActivate` equivalent | Interactive objects must be operable by keyboard |
| A `video` or `audio` object has no caption track and no narration script | Time-based media needs captions |
| Text contrast against its background is below WCAG 2.2 AA, for the object's own look, for each look it can take, and for each way the looks stack (a look that makes the object see-through counts; `disabled` is left out) | Contrast too low |

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
| A theme's logo has no alt text and is not marked decorative (`theme-logo-alt`) | The logo needs alt text, or must be marked decorative |
| A theme's logo is marked decorative and has alt text (`theme-logo-decorative-alt`) | A decorative logo must not have alt text |
| A theme's logo file is not in the project (`theme-logo-missing`) | The logo file is missing |
| Non-decorative content on a slide reaches into the logo's corner (`theme-logo-overlap`, warning) | The logo overlaps content on this slide |

### Hotspots

| Rule | Severity | Message |
| --- | --- | --- |
| A hotspot is marked decorative (`hotspot-decorative`) | Error | A hotspot cannot be decorative |
| A hotspot is under 24 pixels either way (`hotspot-too-small`) | Error | A hotspot is too small to press |
| A hotspot is under 35 pixels either way (`hotspot-small`) | Warning | A hotspot may be too small to press when the slide is drawn smaller |
| A hotspot has content (`hotspot-content`) | Warning | A hotspot has no content of its own |

A hotspot with no alt text or no tab order is reported by the general accessibility rules, and content in a hotspot is also a schema error.

### Audio description: errors and a warning

| Rule | Severity | Message |
| --- | --- | --- |
| A description has no words (`description-text-missing`) | Error | A description has no words |
| Two descriptions on a video have the same id (`description-duplicate-id`) | Error | Two descriptions have the same id |
| An audio clip has a description (`description-on-audio`) | Error | An audio clip cannot have an audio description |
| A description has no voice (`description-not-voiced`) | Warning | A description is not spoken |

The voice of a description is checked like any narration: an unknown voice (`voice-unknown`), a pronunciation that is not IPA (`ipa-invalid`) and audio that is out
of date (`narration-stale`) are reported against the video, naming the description by its time. A time, a pause setting or a list that is not well formed is a
schema error.

### Scenarios and the cast

| Rule | Severity | Message |
| --- | --- | --- |
| A scenario's start is not one of its situations (`scenario-start-missing`) | Error | A scenario has to start in a situation that exists |
| A choice leads to a situation that does not exist (`scenario-next-missing`) | Error | A choice leads to a situation that does not exist |
| Two parts of a scenario (situation, choice, line, meter) share an id (`scenario-duplicate-id`) | Error | Two parts of a scenario have the same id |
| A line has no text (`scenario-line-empty`) | Error | A line has no words |
| A choice has no text (`scenario-choice-empty`) | Error | A choice has no words |
| A line's speaker is neither `you` nor in the cast (`scenario-speaker-unknown`) | Error | A line is spoken by someone who is not in the cast |
| A choice adds to a variable that is missing or not a number (`scenario-effect-variable`) | Error | A choice can only add to a number variable |
| A meter shows a variable that is missing or not a number (`scenario-meter-variable`) | Error | A meter shows something that is not a number variable |
| A meter's smallest value is not less than its largest (`scenario-meter-range`) | Error | A meter's smallest value must be less than its largest |
| The variable set at an ending is missing or not a boolean (`scenario-finished-variable`) | Error | The variable set at an ending must be a true or false variable |
| The variable that holds the learner's character is missing or not a string (`scenario-you-variable`) | Error | The variable that holds the learner's character must be a text variable |
| A situation can never be reached (`scenario-unreachable`) | Warning | A situation can never be reached |
| No ending can be reached (`scenario-no-ending`) | Warning | A learner can never finish this scenario |
| Two choices in one situation read the same (`scenario-choice-duplicate`) | Warning | Two choices say the same thing |
| A line by a person in the cast is read in a different voice (`scenario-voice-differs`) | Warning | A line is not read in its speaker's voice |
| The scenario shows the learner's chosen character but no choice of character saves to its variable (`scenario-you-unset`) | Warning | Nothing lets the learner choose who they are |
| A choice of character names someone who is not in the cast (`input-character-unknown`) | Error | A choice of character names someone who is not in the cast |
| Two people in the cast share an id (`character-duplicate-id`) | Error | Two people in the cast have the same id |
| A person in the cast has the id `you` (`character-id-reserved`) | Error | A person in the cast cannot have the id 'you' |
| A person in the cast has no name (`character-name-empty`) | Error | A person in the cast needs a name |
| Two people in the cast have the same name (`character-name-duplicate`) | Warning | Two people in the cast have the same name |
| A person's picture has no alt text and is not decorative, or is decorative with alt text (`character-picture-alt`) | Error | A picture of a person needs alt text, or must be marked decorative |
| Two poses of one person share an id (`character-pose-duplicate`) | Error | Two poses of one person have the same id |
| A line names a pose its speaker does not have (`scenario-pose-unknown`) | Error | A line shows its speaker in a pose they do not have |
| A line told by the narrator names a pose (`scenario-pose-narrator`) | Error | A line told by the narrator has a pose |

A person's voice that does not exist, or a line's narration with one that does not, is `voice-unknown`, like any narration; a picture that is missing is `asset-missing`.

### Speech and thought bubbles

| Rule | Severity | Message |
| --- | --- | --- |
| A `{{Name}}` in a text names no variable and is not one of the values the course works out (`value-text-unknown`) | Error | A text shows a value that does not exist |
| A text object's `content.bubble` is not `speech` or `thought` (`bubble-invalid`) | Error | A text bubble is neither a speech nor a thought bubble |
| A bubble's `content.tail` is not `left` or `right` (`bubble-invalid`) | Error | A bubble's tail is on neither side |

The tail of something that is not a bubble is left alone. The words in a text bubble are checked for contrast against the bubble's `fill` by the ordinary `contrast` rule, and an empty bubble is a shape: decorative unless it is given alt text.

### Icons and the course actions

| Rule | Severity | Message |
| --- | --- | --- |
| A picture that carries meaning is below 3 to 1 against the slide, in its own look or in any look it can take (`icon-contrast`) | Warning | An icon is hard to see |
| Icons are used and the credits page is off (`icon-credit-page-off`) | Warning | This course uses icons, but the credits page is off |
| Next is used on the last slide (`trigger-next-last`) | Warning | Next goes nowhere on the last slide |
| Back is used on the first slide (`trigger-previous-first`) | Warning | Back goes nowhere on the first slide |

An icon with no alt text that is not decorative is the same `alt-text-missing` as any other object, and a shape that is not on the list of drawing parts, or has an attribute that is not on
its list, is a schema error. A `nextSlide`, `previousSlide` or `replaySlide` trigger with a target, or any other action with an empty one, is a schema error.

### Imported slides

| Rule | Severity | Message |
| --- | --- | --- |
| Slides or shapes name a deck that `project.sources` does not list (`import-source-missing`) | Warning | Imported slides name a deck that the project does not list |
| Two slides are the same slide of the same deck (`provenance-duplicate`) | Warning | Duplicate provenance, re-sync behaviour undefined |

A deck's entry in `project.sources`, a slide's import provenance and an object's (`slideId`, `sourceHash`, `base`) are schema rules. Everything else about an imported slide is checked like any other slide:
alt text, contrast (against the slide's background colour, which for a slide with a background picture is the picture's average colour), tab order and the rest.

A slide made from a recorded step may carry `provenance.base` (0.27.0): the record of what was made, used only to bring the lesson up to date. Its shape is a schema rule (a name, a picture or `null`, and
for each part an `id`, a `layer` and a fingerprint for each field); the validator looks no further into it.

### Looks (object states)

| Rule | Severity | Message |
| --- | --- | --- |
| A look is named `normal` (`state-name-normal`) | Error | A look cannot be named normal |
| A rule applies a look the target object does not have (`trigger-state-missing`) | Error | A rule applies a look the object does not have |
| A rule's look is not text (`trigger-value-type`) | Error | A look is named by text |
| A rule applies a look that has no spoken message, unless the look is `disabled` or the object is decorative (`state-silent`) | Warning | A screen reader user is not told about this change |

A look's name (1 to 40 characters, no space at either end) and its `announce` (1 to 200 characters) are schema rules. A `changeState` rule pointing at an object that is not on its slide is
`trigger-target-missing`, as for any rule, and then no look is checked. A click and its matching key press are one rule, so a silent look is reported once.

### Groups

| Rule | Severity | Message |
| --- | --- | --- |
| Objects with the same `group` are on more than one layer (`group-split`) | Error | A group has objects on different layers |
| A `group` is shared by only one object (`group-single`) | Warning | A group has only one object |

### Quizzes — errors

| Rule | Message |
| --- | --- |
| A multiple choice question does not have exactly one answer marked `correct`, or a multiple response one has none (`quiz-correct-answer`) | Quiz needs exactly one correct answer, or at least one |
| Two answers in one `quizQuestion` share an id (`quiz-duplicate-choice`) | Quiz answers must have different ids |
| A short answer or a blank has an empty accepted answer (`quiz-empty-answer`) | An accepted answer is empty |
| A numeric question's lowest number is above its highest (`quiz-numeric-range`) | The lowest accepted number is above the highest |
| The sentence has a blank `{id}` with no answer set for it (`quiz-blank-missing`) | The sentence has a blank with no answer |
| A blank has answers but is not in the sentence (`quiz-blank-unused`) | A blank is not in the sentence |
| Two blanks share an id (`quiz-duplicate-blank`) | Blanks must have different ids |
| In a drop-down or drag question, a blank's right word is not in the word bank (`quiz-word-bank`) | A right answer is not in the word bank |
| The word bank repeats a word, whatever its capitals (`quiz-word-bank-duplicate`) | The word bank repeats a word |
| Two pairs share an id (`quiz-duplicate-pair`) | Pairs must have different ids |
| Two matches, or a match and an extra, read the same (`quiz-match-duplicate`) | Two matches read the same |
| Two sequence items share an id (`quiz-duplicate-item`) | Items must have different ids |
| A hotspot's picture has no alt text (`quiz-hotspot-alt`) | The picture needs alt text |
| Two hotspot areas share an id (`quiz-duplicate-region`) | Areas must have different ids |
| No hotspot area is marked `correct` (`quiz-correct-answer`) | Quiz needs at least one correct area |
| A hotspot area has no label (`quiz-region-label`) | An area needs a label |
| A hotspot area runs off the picture (`quiz-region-bounds`) | An area runs off the picture |
| A hotspot's picture is not in the project (`asset-missing`) | Asset missing |
| A question has a field that belongs to another kind, or lacks one its kind needs | A schema error |

### Quizzes: warnings

| Rule | Message |
| --- | --- |
| Every answer of a multiple response question is marked correct (`quiz-all-correct`) | Every answer in this question is marked correct |
| Two sequence items read the same (`quiz-item-duplicate`) | Two items read the same |
| Two hotspot areas have the same label (`quiz-region-duplicate`) | Two areas have the same label |

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
| A `click` or `keyActivate` rule on an object that cannot be pressed, `mediaComplete` on one that is not media, or `timerEnd` on one that is not a timer (`trigger-event-never`, warning) | This rule's event never happens on this kind of object |
| A `stopTimer` rule whose target is an object that is not a timer (`stop-timer-target`) | Stop the timer needs a timer |

| A rule that adds names a variable that is not a number (`trigger-operation-type`) | Adding needs a number variable |
| A rule that adds has an amount that is not a number (`trigger-value-type`) | Adding something that is not a number |
| `add` on an action other than `setVariable` (`trigger-operation-action`) | Only setting a variable can add |

A click and its matching key press are one rule to an author, so a problem with a rule is reported once.
Triggers that point at a missing target or variable are `trigger-target-missing` and
`condition-unknown-variable`, as before.

### Timing — an error and warnings

| Rule | Severity | Message |
| --- | --- | --- |
| An object is set to appear with its narration but has none (`timing-narration-missing`) | Error | This object is set to appear with its narration, but it has none |
| A slide has a `duration` and holds a question (`slide-advances-with-question`) | Warning | A slide with a question moves on by itself |
| A base layer object appears at or after its slide's `duration` (`timing-after-advance`) | Warning | This object would appear after the slide has moved on |
| An object follows a clip that is not a video or audio object on its slide (`timing-media-missing`) | Error | This object follows a video or audio clip that is not on its slide |
| An object follows itself (`timing-media-self`) | Error | An object cannot follow itself |
| A slide has a `duration` and holds an object that follows a clip (`timing-media-advance`) | Warning | A slide that moves on by itself holds objects that follow a video or audio clip |
| An object goes away at a step (`until`) and follows a video or audio clip (`timing-until-media`) | Error | An object that follows a clip cannot also go away at a step |
| An object appears at a step and goes away at the same or an earlier step (`timing-until-before-appear`) | Warning | This object goes away before it ever shows |
| A paragraph of a text appears at a step and goes away at the same or an earlier step (`timing-until-before-appear`) | Warning | Paragraph 2 goes away before it ever shows |
| An object other than a text has a timing for its paragraphs (`timing-paragraphs-type`) | Error | Only a text can come in one paragraph at a time |
| A text has timing for more or fewer paragraphs than it has (`timing-paragraphs-count`) | Warning | This text has 3 paragraphs, but timing for 2 |
| A paragraph is timed to appear after the slide has moved on (`timing-after-advance`) | Warning | Paragraph 2 would appear after the slide has moved on |
| A slide has a `duration` and holds an object that waits for the learner to show it, or to take it away (`timing-click-advance`), unless the slide has `autoSteps` and its last step comes (with the longest delay of an object on it) before the duration | Warning | A slide that moves on by itself holds objects that wait for the learner to show them, or, with `autoSteps`, would move on before its items have all come |
| An object has `appear` `click` and no `step`, or a `step` with any other `appear` (`schema`) | Error | The object's timing is not in the right shape |
| A control (a button, an input, a question, an interaction, a download and the like) has a `visibleFor` (`timing-control-disappears`) | Warning | A control that disappears can leave a learner stuck |
| A text or scrolling text object stays for less than three seconds, or for fewer seconds than its words need at 3 words a second (`timing-too-brief`) | Warning | This text may disappear before it can be read |
| An object has an exit effect but neither a time to stay nor a step to go away at, so it never goes (`animation-exit-never`) | Warning | This object has an exit effect but never goes |

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

### Slides that leave out Back and Next

| Rule | Message |
| --- | --- |
| A slide with `hideNavigation` has nothing that goes to another slide: it has no `duration`, and none of its objects, on any layer, has a rule that jumps to a slide, goes to the next slide or goes to the previous slide (`navigation-no-way-out`) | A slide with no Back and Next has no way out |

An error, because a learner who reached the slide could never leave it. The last slide of the course is let be (it has nowhere to go), so is a slide that moves on by itself. The editor
warns when **Leave out Back and Next** is ticked on a slide with no way out yet, and the three game sets hide Back and Next on every slide but their last, each of which has a way on of its own.

### Question banks and shuffled answers

| Rule | Message |
| --- | --- |
| Two banks have the same id (`bank-duplicate-id`) | Two question banks have the same id |
| A bank lists a slide that is not in the course (`bank-slide-missing`) | A question bank holds a slide that is not in the course |
| A slide is in two banks (`bank-slide-shared`) | A slide is in two question banks |
| A bank is asked to show more slides than it holds (`bank-draw-too-many`) | A question bank is asked to show more slides than it has |
| A bank shows all its slides and does not mix them (`bank-does-nothing`, warning) | A question bank shows every slide in the same order, so it changes nothing |
| The slides of a bank have other slides between them (`bank-not-together`, warning) | The slides of a question bank are not side by side |
| A slide of a bank holds no question (`bank-slide-no-question`, warning) | A slide in a question bank has no question |
| The questions of a bank are worth different points (`bank-points-differ`, warning) | The questions in a bank are worth different points |
| A rule jumps to a slide of a bank (`jump-into-bank`, warning) | A rule jumps to a slide in a question bank |
| A question that shuffles has an answer that depends on its place: a letter, "all of the above", "both A and B" (`shuffle-position-words`, warning) | A question that mixes its answers has an answer that depends on its place |
| A bank's `draw` below 1 or not whole, fewer than two `slides`, no name, or a `shuffle` that is not true or false; a `shuffle` on a question with no answers to choose from (`schema`) | (the schema's message) |

### Timers

| Rule | Message |
| --- | --- |
| A `timer` has no rule for the event `timerEnd` (`timer-no-end-rule`, warning) | Nothing happens when this timer runs out |
| `seconds` outside 5 to 3600 or not a whole number, `extendBy` outside 0 to 600, or `label` blank or over 60 letters (`schema`) | (the schema's message) |

A `timer` holds buttons, so it also needs alt text (its name) and a tab order of 1 or more, and one with a `visibleFor` gets `timing-control-disappears`.

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
| `assets.json` names a `generated` source with no `generated` record, a record on any other source, or a record that is missing its service, model, prompt or time, or whose prompt is blank or time is not a UTC date-time (`schema`) | (the schema's message) |
| Narration uses an OpenAI voice and `credits` is off (`voice-credit-page-off`, warning) | This course has OpenAI voices, but the credits page is off |

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
| Two slides name the same capture and step (`provenance-duplicate`) | Duplicate provenance, re-sync behaviour undefined |

Objects from a capture step are not counted by the first rule, and several objects can come from one step.

### Raw recording material: warning

| Rule | Message |
| --- | --- |
| A file called `events.jsonl`, or a folder called `capture` or `captures`, is in the project and not listed in `sourceExclude`, or is under `assets/` (`capture-material-in-project`) | Raw recording material is inside the project / in the published assets |

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
- **Voice set** is `tools/kokoro-voices.json`, checked against the 54 voices published for Kokoro-82M. A voice may instead be `engine:voice` (see docs/format-spec.md, "Voices"):
  OpenAI's are checked against `tools/openai-voices.json`, and any other engine's by shape only, because a plugin's voices are known only on the
  computer it is installed on. `voice-unknown` is reported for a name that cannot be right in any of these ways.
- **Added beyond the tables:** slide id must match its file name (error), slide files not
  in any scene (warning), quiz and simulation feedback layers must exist (error).
- **Missing slide files** are reported once, not again for every trigger that jumps there.
- If a file fails structural schema checks, semantic rules skip it, so one broken field
  does not produce a cascade of unrelated findings.
