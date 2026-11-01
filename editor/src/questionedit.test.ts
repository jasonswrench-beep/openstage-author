import assert from "node:assert/strict";
import { test } from "node:test";
import { bankFor, applyEdit, extraWordsOf, lines, LIMITS, markersIn, QUIZ_KINDS, startingQuestion, type QuestionEdit, type QuizType } from "./questionedit.ts";
import type { ChoiceQuiz, EssayQuiz, FillBlanksQuiz, HotspotQuiz, MatchingQuiz, NumericQuiz, QuizContent, SequencingQuiz, ShortAnswerQuiz, ShortcutQuiz, WhichWordQuiz } from "../../player/src/types.ts";

const base = { scoring: { points: 10, attemptsAllowed: 2 }, feedback: { correct: "layer-1", incorrect: "layer-2" } };
const make = <T extends QuizContent>(type: QuizType, imageSrc = "assets/images/map.png"): T => ({ ...JSON.parse(JSON.stringify(startingQuestion(type, imageSrc))), ...base }) as T;
const refused = (r: unknown): string | null => (typeof r === "object" && r !== null && "refuse" in r ? String((r as { refuse: string }).refuse) : null);
const ok = (r: unknown): string => {
  assert.equal(typeof r, "string", `expected a message, got ${JSON.stringify(r)}`);
  return r as string;
};
const run = (q: QuizContent, e: QuestionEdit) => applyEdit(q, e);

test("lines are tidied, empty ones dropped, and repeats dropped ignoring capitals unless they matter", () => {
  assert.deepEqual(lines("  Everest \n\nmount   everest\r\nEVEREST\n"), ["Everest", "mount everest"]);
  assert.deepEqual(lines("Everest\nEVEREST", true), ["Everest", "EVEREST"]);
  assert.deepEqual(lines(""), []);
});

test("every kind has a starting question that is complete, with unique ids", () => {
  for (const kind of QUIZ_KINDS) {
    const q = make<QuizContent>(kind.id);
    const encoded = JSON.stringify(q);
    assert.ok(encoded.length > 20, kind.id);
    if (q.questionType === "multipleChoice" || q.questionType === "multipleResponse") {
      assert.equal(new Set(q.choices.map((c) => c.id)).size, q.choices.length);
      assert.ok(q.choices.some((c) => c.correct), kind.id);
      if (q.questionType === "multipleChoice") assert.equal(q.choices.filter((c) => c.correct).length, 1);
    }
    if (q.questionType === "fillBlanks") {
      assert.deepEqual(markersIn(q.text), q.blanks.map((b) => b.id));
      if (q.mode !== "typed") assert.ok(q.blanks.every((b) => q.wordBank.includes(b.answers[0]!)), "every right word is in the bank");
    }
    if (q.questionType === "matching") assert.ok(q.pairs.length >= 2);
    if (q.questionType === "sequencing") assert.ok(q.items.length >= 2);
    if (q.questionType === "hotspot") {
      assert.ok(q.regions.some((r) => r.correct));
      assert.equal(q.image.alt, "", "alt text is never filled in for the author");
    }
  }
  assert.equal(new Set(QUIZ_KINDS.map((k) => k.id)).size, QUIZ_KINDS.length);
});

test("multiple choice: choosing a right answer clears the others, and an answer cannot be un-chosen", () => {
  const q = make<ChoiceQuiz>("mc");
  assert.match(ok(run(q, { op: "choiceCorrect", id: "c2", correct: true })), /is the correct answer/);
  assert.deepEqual(q.choices.map((c) => c.correct), [false, true, false]);
  assert.match(refused(run(q, { op: "choiceCorrect", id: "c2", correct: false }))!, /Exactly one answer/);
  assert.match(refused(run(q, { op: "choiceCorrect", id: "zzz", correct: true }))!, /not in this question/);
});

test("multiple response: each answer is ticked on its own, and at least one must stay right", () => {
  const q = make<ChoiceQuiz>("mr");
  assert.deepEqual(q.choices.map((c) => c.correct), [true, false, true, false]);
  ok(run(q, { op: "choiceCorrect", id: "c2", correct: true }));
  assert.deepEqual(q.choices.map((c) => c.correct), [true, true, true, false]);
  ok(run(q, { op: "choiceCorrect", id: "c1", correct: false }));
  ok(run(q, { op: "choiceCorrect", id: "c3", correct: false }));
  assert.match(refused(run(q, { op: "choiceCorrect", id: "c2", correct: false }))!, /At least one answer must be right/);
  assert.equal(q.choices.find((c) => c.id === "c2")!.correct, true, "the refused change is undone in the content too");
  const all = make<ChoiceQuiz>("mr");
  all.choices.forEach((c) => (c.correct = true));
  all.choices[3]!.correct = false;
  assert.match(ok(run(all, { op: "choiceCorrect", id: "c4", correct: true })), /tests nothing/);
});

test("switching between one right answer and several keeps what makes sense", () => {
  const q = make<ChoiceQuiz>("mr");
  assert.match(ok(run(q, { op: "choiceMode", multiple: false })), /Exactly one answer is right now: First answer/);
  assert.equal(q.questionType, "multipleChoice");
  assert.deepEqual(q.choices.map((c) => c.correct), [true, false, false, false]);
  assert.match(ok(run(q, { op: "choiceMode", multiple: true })), /Several answers can now be right/);
  assert.equal(q.questionType, "multipleResponse");
  const none = make<ChoiceQuiz>("mr");
  none.choices.forEach((c) => (c.correct = false));
  ok(run(none, { op: "choiceMode", multiple: false }));
  assert.equal(none.choices.filter((c) => c.correct).length, 1, "a question with no right answer gets one, and the author is told");
});

test("short answer: accepted answers are lines, and there has to be one", () => {
  const q = make<ShortAnswerQuiz>("short");
  assert.match(ok(run(q, { op: "shortAnswers", text: "Everest\nMount Everest\neverest\n" })), /2 accepted answers/);
  assert.deepEqual(q.answers, ["Everest", "Mount Everest"]);
  assert.match(refused(run(q, { op: "shortAnswers", text: " \n " }))!, /at least one/);
  assert.match(refused(run(q, { op: "shortAnswers", text: Array.from({ length: 11 }, (_, i) => `a${i}`).join("\n") }))!, /at most 10/);
  ok(run(q, { op: "caseSensitive", on: true }));
  assert.equal(q.caseSensitive, true);
  ok(run(q, { op: "shortAnswers", text: "Everest\neverest" }));
  assert.deepEqual(q.answers, ["Everest", "everest"], "capitals matter now, so both spellings are kept");
});

test("numeric: an answer and how far off may be accepted", () => {
  const q = make<NumericQuiz>("numeric");
  assert.match(ok(run(q, { op: "numeric", answer: 42, tolerance: 0 })), /Only 42 is right/);
  assert.deepEqual([q.min, q.max], [42, 42]);
  assert.match(ok(run(q, { op: "numeric", answer: 10, tolerance: 0.5 })), /from 9.5 to 10.5/);
  assert.deepEqual([q.min, q.max], [9.5, 10.5]);
  assert.match(refused(run(q, { op: "numeric", answer: 10, tolerance: -1 }))!, /zero or more/);
  assert.match(refused(run(q, { op: "numeric", answer: NaN, tolerance: 0 }))!, /has to be a number/);
  ok(run(q, { op: "numeric", answer: 0.3, tolerance: 0.1 }));
  assert.deepEqual([q.min, q.max], [0.2, 0.4], "no stray digits from the arithmetic");
});

test("fill in the blanks: the sentence, the blanks and the word bank stay in step", () => {
  const q = make<FillBlanksQuiz>("dropdown");
  q.text = "The {1} flows past the {2}.";
  q.blanks = [{ id: "1", answers: ["river"] }, { id: "2", answers: ["town"] }];
  q.wordBank = ["river", "town", "hill"];
  assert.deepEqual(extraWordsOf(q), ["hill"]);
  const said = ok(run(q, { op: "blanksText", text: "The {1} flows past the {2} and the {3}." }));
  assert.match(said, /3 blanks/);
  assert.match(said, /blank 3; it starts as "word"/);
  assert.deepEqual(q.blanks.map((b) => b.id), ["1", "2", "3"]);
  assert.deepEqual(q.wordBank, ["river", "town", "word", "hill"], "the new blank's word joins the bank, and the extra stays");
  const gone = ok(run(q, { op: "blanksText", text: "The {2} flows past the {1}." }));
  assert.match(gone, /Blank 3 was taken out with its answers/);
  assert.deepEqual(q.blanks.map((b) => [b.id, b.answers[0]]), [["2", "town"], ["1", "river"]], "blanks follow the order in the sentence, each keeping its answer");
  assert.match(refused(run(q, { op: "blanksText", text: "" }))!, /needs some words/);
  assert.match(refused(run(q, { op: "blanksText", text: "No blanks here." }))!, /at least one blank/);
  assert.match(refused(run(q, { op: "blanksText", text: Array.from({ length: 11 }, (_, i) => `{${i + 1}}`).join(" ") }))!, /at most 10 blanks/);
});

test("inserting a blank puts the next free number where the cursor was", () => {
  const q = make<FillBlanksQuiz>("blanks");
  q.text = "A {1} and a b.";
  ok(run(q, { op: "insertBlank", at: 12 }));
  assert.equal(q.text, "A {1} and a {2}b.");
  ok(run(q, { op: "insertBlank", at: 0 }));
  assert.equal(q.text, "{3}A {1} and a {2}b.");
  ok(run(q, { op: "insertBlank", at: 9999 }));
  assert.ok(String(q.text).endsWith("{4}"), "past the end is the end");
  assert.deepEqual(q.blanks.map((b) => b.id), ["3", "1", "2", "4"]);
});

test("a blank's answers: lines when typed, one right word from the bank otherwise", () => {
  const typed = make<FillBlanksQuiz>("blanks");
  assert.match(ok(run(typed, { op: "blankAnswers", id: "1", text: "river\nstream\nRiver" })), /accepts 2 answers/);
  assert.deepEqual(typed.blanks[0]!.answers, ["river", "stream"]);
  assert.match(refused(run(typed, { op: "blankAnswers", id: "1", text: "" }))!, /at least one answer/);

  const bank = make<FillBlanksQuiz>("dropdown");
  assert.deepEqual(bank.wordBank, ["word", "another"]);
  assert.match(ok(run(bank, { op: "blankAnswers", id: "1", text: "river\nstream" })), /right with river/);
  assert.deepEqual(bank.blanks[0]!.answers, ["river"], "a list has one right word");
  assert.deepEqual(bank.wordBank, ["river", "another"], "the bank follows the right word, and the extra stays");
});

test("changing how blanks are filled builds or clears the word bank and keeps the extras", () => {
  const q = make<FillBlanksQuiz>("blanks");
  q.blanks[0]!.answers = ["river", "stream"];
  ok(run(q, { op: "blanksMode", mode: "dropdown" }));
  assert.deepEqual(q.blanks[0]!.answers, ["river"], "only the first answer is a word from the bank");
  assert.deepEqual(q.wordBank, ["river"]);
  ok(run(q, { op: "extraWords", text: "hill\nRiver\nlake" }));
  assert.deepEqual(q.wordBank, ["river", "hill", "lake"], "an extra that is a right word is not repeated");
  ok(run(q, { op: "blanksMode", mode: "drag" }));
  assert.deepEqual(q.wordBank, ["river", "hill", "lake"], "dropdown to drag keeps the bank");
  ok(run(q, { op: "blanksMode", mode: "typed" }));
  assert.deepEqual(q.wordBank, [], "typed blanks have no bank");
  assert.match(refused(run(q, { op: "extraWords", text: "x" }))!, /no word bank/);
});

test("the word bank never holds a word twice", () => {
  const q = make<FillBlanksQuiz>("dropdown");
  q.blanks = [{ id: "1", answers: ["Word"] }, { id: "2", answers: ["word"] }];
  assert.deepEqual(bankFor(q, ["WORD", "other"]), ["Word", "other"]);
  const many = Array.from({ length: LIMITS.bank }, (_, i) => `w${i}`);
  assert.match(refused(run(q, { op: "extraWords", text: many.join("\n") }))!, /at most 30/);
});

test("matching: pairs, their texts, their order, and extra matches", () => {
  const q = make<MatchingQuiz>("matching");
  assert.match(ok(run(q, { op: "addPair" })), /Added pair 3/);
  assert.deepEqual(q.pairs.map((p) => p.id), ["p1", "p2", "p3"]);
  assert.equal(new Set(q.pairs.map((p) => p.match)).size, 3);
  assert.match(ok(run(q, { op: "pairText", id: "p1", field: "match", text: "  A   new match " })), /Match updated/);
  assert.equal(q.pairs[0]!.match, "A new match");
  assert.match(refused(run(q, { op: "pairText", id: "p2", field: "match", text: "a new MATCH" }))!, /already says that/);
  assert.match(refused(run(q, { op: "pairText", id: "p2", field: "premise", text: "  " }))!, /needs some words/);
  ok(run(q, { op: "movePair", id: "p3", delta: -1 }));
  assert.deepEqual(q.pairs.map((p) => p.id), ["p1", "p3", "p2"]);
  assert.match(refused(run(q, { op: "movePair", id: "p1", delta: -1 }))!, /already first/);
  assert.match(refused(run(q, { op: "movePair", id: "p2", delta: 1 }))!, /already last/);
  ok(run(q, { op: "deletePair", id: "p3" }));
  assert.match(refused(run(q, { op: "deletePair", id: "p2" }))!, /at least 2 pairs/);
  assert.match(ok(run(q, { op: "extras", text: "Silent\nSilent\nQuiet" })), /2 extra matches/);
  assert.deepEqual(q.extras, ["Silent", "Quiet"]);
  assert.match(refused(run(q, { op: "extras", text: "a new match" }))!, /already the match of a pair/);
  assert.match(refused(run(q, { op: "extras", text: "a\nb\nc\nd\ne\nf" }))!, /at most 5/);
  assert.match(ok(run(q, { op: "drag", on: true })), /also drag/);
  assert.equal(q.drag, true);
});

test("matching is limited to ten pairs", () => {
  const q = make<MatchingQuiz>("matching");
  while (q.pairs.length < LIMITS.pairs) ok(run(q, { op: "addPair" }));
  assert.match(refused(run(q, { op: "addPair" }))!, /at most 10 pairs/);
});

test("sequencing: items in the right order, added, changed, moved and deleted", () => {
  const q = make<SequencingQuiz>("sequence");
  assert.match(ok(run(q, { op: "addItem" })), /Added item 4/);
  assert.deepEqual(q.items.map((i) => i.id), ["s1", "s2", "s3", "s4"]);
  ok(run(q, { op: "itemText", id: "s2", text: "  Choose   a channel " }));
  assert.equal(q.items[1]!.text, "Choose a channel");
  assert.match(refused(run(q, { op: "itemText", id: "s2", text: "" }))!, /needs some words/);
  assert.match(ok(run(q, { op: "moveItem", id: "s4", delta: -1 })), /Item 3 of 4 in the right order/);
  assert.deepEqual(q.items.map((i) => i.id), ["s1", "s2", "s4", "s3"]);
  assert.match(refused(run(q, { op: "moveItem", id: "s1", delta: -1 }))!, /already first/);
  ok(run(q, { op: "deleteItem", id: "s4" }));
  ok(run(q, { op: "deleteItem", id: "s3" }));
  assert.match(refused(run(q, { op: "deleteItem", id: "s2" }))!, /at least 2 items/);
  assert.match(ok(run(q, { op: "drag", on: false })), /only the Move up/);
});

test("hotspot: the picture, its description, and the areas", () => {
  const q = make<HotspotQuiz>("hotspot");
  assert.equal(q.image.alt, "");
  ok(run(q, { op: "hotspotAlt", alt: "A map of the campus" }));
  ok(run(q, { op: "hotspotImage", src: "assets/images/other.png" }));
  assert.deepEqual(q.image, { src: "assets/images/other.png", alt: "A map of the campus" }, "changing the picture keeps the description");
  assert.match(ok(run(q, { op: "addRegion" })), /Added area 3/);
  assert.equal(q.regions[2]!.correct, false);
  assert.match(refused(run(q, { op: "regionLabel", id: "r1", label: "  " }))!, /needs a label/);
  ok(run(q, { op: "regionLabel", id: "r1", label: "North gate" }));
  assert.match(ok(run(q, { op: "regionRect", id: "r2", patch: { x: 60, width: 30.456 } })), /30.46 percent wide/);
  assert.equal(q.regions[1]!.x, 60);
  assert.match(refused(run(q, { op: "regionRect", id: "r2", patch: { x: 80 } }))!, /stay inside the picture/);
  assert.match(refused(run(q, { op: "regionRect", id: "r2", patch: { width: 0 } }))!, /stay inside the picture/);
  assert.match(refused(run(q, { op: "regionRect", id: "r2", patch: { y: Number.NaN } }))!, /have to be numbers/);
  assert.equal(q.regions[1]!.x, 60, "refused edits change nothing");
  assert.match(refused(run(q, { op: "regionCorrect", id: "r1", correct: false }))!, /At least one area must be right/);
  ok(run(q, { op: "regionCorrect", id: "r2", correct: true }));
  ok(run(q, { op: "regionCorrect", id: "r1", correct: false }));
  assert.match(refused(run(q, { op: "deleteRegion", id: "r2" }))!, /only right area/);
  ok(run(q, { op: "deleteRegion", id: "r3" }));
  assert.match(refused(run(q, { op: "deleteRegion", id: "r1" }))!, /at least 2 areas/);
  while (q.regions.length < LIMITS.regions) ok(run(q, { op: "addRegion" }));
  assert.match(refused(run(q, { op: "addRegion" }))!, /at most 12 areas/);
});

test("an edit for another kind of question is refused", () => {
  const edits: [QuizType, QuestionEdit][] = [
    ["mc", { op: "shortAnswers", text: "x" }], ["short", { op: "choiceMode", multiple: true }], ["numeric", { op: "caseSensitive", on: true }],
    ["blanks", { op: "addPair" }], ["matching", { op: "addItem" }], ["sequence", { op: "addPair" }], ["hotspot", { op: "drag", on: true }],
    ["essay", { op: "shortAnswers", text: "x" }], ["whichword", { op: "minWords", words: 5 }], ["shortcut", { op: "passage", text: "A [b]" }], ["mc", { op: "shortcutKeys", text: "F5" }],
  ];
  for (const [type, edit] of edits) {
    const q = make<QuizContent>(type);
    const before = JSON.stringify(q);
    assert.match(refused(run(q, edit))!, /does not belong to this kind of question/, `${type} ${edit.op}`);
    assert.equal(JSON.stringify(q), before);
  }
});

test("an essay starts needing 20 words, and the fewest words is a whole number from 0 to 1000", () => {
  const q = make<EssayQuiz>("essay");
  assert.equal(q.minWords, 20);
  assert.match(ok(run(q, { op: "minWords", words: 50 })), /counts once it has 50 words/);
  assert.equal(q.minWords, 50);
  assert.match(ok(run(q, { op: "minWords", words: 1 })), /1 word\./);
  assert.match(ok(run(q, { op: "minWords", words: 0 })), /Any answer counts/);
  assert.equal(q.minWords, 0);
  for (const bad of [-1, 1001, 2.5, Number.NaN]) {
    assert.match(refused(run(q, { op: "minWords", words: bad }))!, /whole number from 0 to 1000/, String(bad));
    assert.equal(q.minWords, 0, "a refused edit changes nothing");
  }
});

test("a passage is refused until it can be a question, and says what to do", () => {
  const q = make<WhichWordQuiz>("whichword");
  assert.match(q.passage, /\[right\]/);
  const before = q.passage;
  const cases: [string, RegExp][] = [
    ["", /needs some words/], ["  ... ", /needs some words/], ["No marks here.", /Put square brackets round the right word/],
    ["An [] empty [mark]", /no word in it/], ["A mark across [two words] [here]", /holds one word/], ["The [dog barked loudly.", /holds one word/],
    ["Marked [a][b] twice [here]", /marked twice/], [Array.from({ length: 301 }, () => "w").join(" ") + " [x]", /at most 300 words/], ["a ".repeat(2600) + "[b]", /at most 5000 characters/],
  ];
  for (const [text, why] of cases) {
    assert.match(refused(run(q, { op: "passage", text }))!, why, JSON.stringify(text.slice(0, 30)));
    assert.equal(q.passage, before, "a refused edit changes nothing");
  }
});

test("a passage that can be a question is kept as written, and the message says what the right words are", () => {
  const q = make<WhichWordQuiz>("whichword");
  assert.equal(ok(run(q, { op: "passage", text: "  The dog [barked] loudly.\r\n" })), "The passage has 4 words. Right: barked.");
  assert.equal(q.passage, "The dog [barked] loudly.", "trimmed, line ends tidied, nothing else touched");
  assert.match(ok(run(q, { op: "passage", text: "Two [right] answers: both [correct]." })), /Right: right, correct\./);
  assert.match(ok(run(q, { op: "passage", text: "The [cat] sat and the Cat ran." })), /cat comes again where it is wrong/);
  assert.match(ok(run(q, { op: "passage", text: "[Everything] [is] [right]" })), /tests nothing/);
});

test("shortcuts are written the one way, repeats dropped, and one nobody could give is refused", () => {
  const q = make<ShortcutQuiz>("shortcut");
  assert.deepEqual(q.keys, ["Ctrl+S"]);
  assert.match(ok(run(q, { op: "shortcutKeys", text: "ctrl + shift + s\nControl+Shift+S\n\nCmd+Shift+S" })), /2 shortcuts are right: Ctrl\+Shift\+S, Shift\+Meta\+S\./);
  assert.deepEqual(q.keys, ["Ctrl+Shift+S", "Shift+Meta+S"]);
  assert.match(ok(run(q, { op: "shortcutKeys", text: "F5" })), /^1 shortcut is right: F5\.$/);
  const before = JSON.stringify(q);
  assert.match(refused(run(q, { op: "shortcutKeys", text: "Ctrl+S\nCtrl+Banana" }))!, /"Ctrl\+Banana" is not a keyboard shortcut/);
  assert.match(refused(run(q, { op: "shortcutKeys", text: " \n " }))!, /at least one shortcut/);
  assert.match(refused(run(q, { op: "shortcutKeys", text: Array.from({ length: 11 }, (_, i) => `F${i + 1}`).join("\n") }))!, /at most 10/);
  assert.equal(JSON.stringify(q), before, "a refused edit changes nothing");
});

test("a shortcut a browser keeps for itself is allowed, with a word about it", () => {
  const q = make<ShortcutQuiz>("shortcut");
  const said = ok(run(q, { op: "shortcutKeys", text: "ctrl+w\nCtrl+S" }));
  assert.deepEqual(q.keys, ["Ctrl+W", "Ctrl+S"]);
  assert.match(said, /A browser keeps Ctrl\+W for itself, so a learner cannot press it on a page\. They can still type it\./);
});
