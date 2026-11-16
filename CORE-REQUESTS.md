# Requests to the shared core

Things OpenStage Author needs from `openstage-core` that the core does not offer yet. Author does not build its own version of
a shared piece when the core could offer it. Where it had to write something to finish its list, the entry says what and says
what replaces it once the core has the piece. Newest last. Core as read: `CORE-NOTES.md` of 2026-11-15 (second round); tags
`capture-v0.1.0`, `pstat-v1.2.0`, `item-analysis-v1.1.0`, `prismqda-stats-v1.0.0`. The accessibility crate in the core's working
folder (`crates/openstage-a11y`, `specs/a11y/rules.json`) was not committed or tagged when this was written, so nothing here
builds on it.

Each entry names the development list item it is for (`OpenStage Author Development List`, 2026-11-15) and says what Author
did meanwhile.

## R1. C4, the bank reader (list items 2 and 5)

**For:** item 2 (read OpenAssess banks directly) and item 5 (feed the four games from banks).

Author's questions come in today through a flat table (`editor/src/questionimport.ts`) and, since this round, through QTI
(`editor/src/qtiimport.ts`). Both drop what an OpenAssess bank holds. Asked: a library that reads a `.openassess` bank file
(a zip of `manifest.json`, `questions/q_*.json` and `folders.json`, which OpenStage Guide's `src/guide-bank.mjs` reads today in
its own way) and gives each question with its metadata, in TypeScript, in the style of `@openstage/pstat`: no dependencies,
types, a release the tool installs from a tag, and a test set of bank files with the questions each must give.

What Author needs from each question, beyond what the table has:

- `id`, `revision` and the bank's own option ids, so a question can be found again when a bank changes.
- `type` as the bank has it (multiple choice, multiple response, true or false, fill in the blank, short answer, matching,
  essay, and so on), with the key per type and the points, and for a type Author does not hold, a reason to show.
- `objective`, `chapter`, `section`, `page`, `bloomLevel`, `difficulty`, `tags`, and the folder the question is in.
- the history (who changed it and when, when it was last used), as plain data the tool may ignore.
- the feedback for a right and a wrong answer, and whether the question has a picture or an equation, with the picture's bytes
  and its description when it has one (Author can hold pictures; the table could not).
- a plain list of what the reader could not read, by question, so Author can say so as it does for a table.

Author cannot carry the metadata into a course until the format has a place for it: that is a format change on Author's side
(a `source` object on a question, a schema version and a migration), and it waits for this reader so the field names are the
bank's.

**Meanwhile:** QTI and the table. The QTI reader says in its notes that objectives, Bloom level and the rest are not kept.
**When the core has it:** the bank reader replaces nothing in Author (there is no bank reader in Author to replace); the
dialog gains a third kind of file, and the four games take their questions from the same reader as the quiz slides.

## R2. C2, the accessibility rule engine (list item 4)

**For:** item 4 (move the validator's accessibility rules onto C2 as warnings that no longer block publishing, with a WCAG 2.1 AA criterion on every
finding). The core's working folder holds a draft (`crates/openstage-a11y`, `specs/a11y/rules.json`, catalogue A11Y-1) that was not committed or tagged
when this was written, so Author has not built on it.

**What Author did meanwhile, and nothing more.** The policy is Author's own and is done:

- Accessibility findings are **warnings**, whatever the rule; none stops a publish.
- Each carries the WCAG criterion it answers (`wcag` on the finding; "WCAG 1.1.1" in the Problems list and the text report).
- A project may turn chosen rules into blockers for itself (`accessibilityBlockers`, format 0.50.0; File > Accessibility rules that stop a publish...). Off unless
  the author turns it on.
- The rule-to-criterion table is one data file, `tools/a11y-rules.json` (29 of the validator's rules), which is all that stands in for C2's catalogue. The
  validator's rules themselves (they read a project's JSON, not published HTML) stay where they are.

**Asked of the core, when C2 is published:**

1. The catalogue as data Author can read at build time (rule ids, titles, WCAG criteria, levels, and the version of WCAG that added each), and, for the rules
   that check a published course's HTML (alt text, heading order, reading and focus order, keyboard reach, captions, contrast, link text, timed content), the
   engine that runs them on the course Author publishes.
2. The ids to match Author's where the rule is the same (Author's are in `tools/a11y-rules.json`: `alt-text-missing`, `contrast`, `click-without-key`, and so on).
   Where they differ, a table from one to the other, so a project's `accessibilityBlockers` keeps its meaning.
3. The statuses (pass, fail, needs review, not tested) if the core wants Author's Problems list to show them; Author shows warnings only, today.

**When the core has it:** `tools/a11y-rules.json` is replaced by the catalogue, the published course is run through the engine after a publish as a second check (its
findings shown as warnings in the Publish summary), and the format keeps `accessibilityBlockers`.

## R3. C9, the review round-trip (list item 6)

**For:** item 6 (read reviewers' comments back through C9). Author writes `<name>-review.docx` beside every publish (`tools/review_doc.py`) and cannot
read anything back. The core has no C9 yet; OpenExplainer has its own, unshared. Author builds nothing of this until the format exists.

Asked: the review file's format as a spec in the core, in the style of PSTAT-1 (a small file a reviewer emails back; comments pinned to screens, each with its
author, time, text and status, and a place for a reply) and a reader and writer as a package, `@openstage/review`, with a conformance set.

What Author needs it to name, so a comment can be shown on the right thing:

- a screen by an id that survives edits: Author has stable `slide-NNN` ids and `obj-NNNN` object ids, and slides keep their `provenance` when imported;
- a place on a screen as a percentage of the slide's width and height (Author's stage size changes by project), optionally with an object id;
- the course's identity and version (`meta.title`, `meta.created`, `meta.version`), so a file for another version is said to be for another version;
- a status each tool can set (open, resolved, not taken), which the reviewer's copy does not have to know.

**Author's part, when it exists:** **File > Bring in reviewers' comments...**, a Comments list beside Problems that selects the slide and object a comment is on,
resolve and reply, and the browser review copy as a fourth thing a publish can make (`<name>-review.html`, next to the Word copy). Nothing leaves the computer.

## R4. C7, the source ledger (list item 7)

**For:** item 7 (source ledger links to .docx and PDF passages). Today an imported `.pptx` deck is re-synced: every imported object carries
`provenance {sourceDeck, slideIndex, shapeId}` and `provenance.base`, and **Bring the deck up to date** compares one property at a time (`editor/src/pptx/resync.ts`,
`docs/powerpoint.md`). The core's ROADMAP lists C7 as agreed, not scheduled.

Asked, as the core's roadmap already describes it: the passage-reference format (a source document and its edition, a place that survives re-pagination, a
fingerprint of the passage's text), the comparison of two editions of a .docx or PDF (unchanged, changed with old and new text, or gone), and a test set.

What Author needs besides: the reference to be small enough to keep on a slide, a block of text or a quiz question, as `provenance` is now (Author would add a
`passages` list beside it, a format change of Author's own, after the spec); and the comparison to run without a model (C8's note on whether a change matters is
extra).

**Author's part, when it exists:** a Sources panel listing the documents a course was made from and each slide's passages, **Check a new edition...** (choose the
new file; every slide whose passage changed is listed and can be opened beside the old and new text), the same for a question's source.

## R5. C6, the translation layer (list item 9)

**For:** item 9 (one package with several languages and a switcher). Author has `tools/xliff.py` (XLIFF 1.2 out and back in, one language copy per file) and a
course's `playerText` (the player's own words in the course's language); `docs/translation.md`.

Asked: C6 as the core describes it ("share one string extractor and importer, then add a single package that holds several languages with a language
switcher"). What a spec for the package needs to settle, from Author's side:

- how a course holds several languages: the strings keyed by a stable id (Author's units are paragraphs, headings, list items, alt text and narration
  scripts) with a value for each language, and which language is the source;
- what is per language besides text: the narration (audio is cached by script, voice and language, so each language has its own), the captions and
  transcripts, a picture that has words in it, a description, the player's own words, a number or date format;
- the switcher's rules: where it is, that it is a real control a keyboard and a screen reader reach, that it keeps the learner's place, that the
  page's `lang` follows it (WCAG 3.1.1), and what a missing string shows (the source language's, said);
- the same extractor and importer as the XLIFF files use, so a translator's file for one language adds that language to the package.

**Author's part, when it exists:** **File > Languages...** to add a language from a translated file and to say which is the learner's default, the switcher in the
published course's navigation bar, and a publish that carries all of them in one package of each kind (SCORM, xAPI, cmi5).
