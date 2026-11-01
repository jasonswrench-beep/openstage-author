// The essay question: a written answer that no one marks for the author. It counts as done once it has the fewest words the author asked for,
// and what was written goes to the LMS as a long fill-in for a person to read.
import assert from "node:assert/strict";
import { test } from "node:test";
import { countWords, emptyMessage, grade, isAnswered, keepAnswer } from "./grading.ts";
import { formatGraded, scorm2004Type } from "./interaction-format.ts";
import { built, courseWith, told12, told2004, type Body } from "./question-helpers.ts";
import type { EssayQuiz, QuizContent } from "./types.ts";

const essay = (minWords: number): Body<EssayQuiz> => ({ questionType: "essay", minWords });
const full = (minWords: number): QuizContent => ({ ...essay(minWords), scoring: { points: 12, attemptsAllowed: 2 }, feedback: { correct: "a", incorrect: "b" } });

test("a word is a run of letters or numbers between spaces: a dash or a lone mark on its own is not one", () => {
  const cases: [string, number][] = [
    ["", 0], ["   \n ", 0], ["one", 1], ["two words", 2], ["  spaced   out  ", 2], ["a — b", 2], ["- - -", 0], ["...", 0],
    ["it's well-known", 2], ["don't stop\nnow", 3], ["123 4.5", 2], ["Zoë étudie", 2], ["你好 世界", 2],
  ];
  for (const [text, words] of cases) assert.equal(countWords(text), words, JSON.stringify(text));
});

test("an essay is done at the fewest words asked for, and never with none", () => {
  assert.deepEqual([grade(full(0), "").correct, grade(full(0), "Hello").correct], [false, true], "no minimum still wants an answer");
  assert.deepEqual([grade(full(5), "one two three four").correct, grade(full(5), "one two three four five").correct], [false, true]);
  const g = grade(full(5), "one two three four five six");
  assert.deepEqual([g.fraction, g.correct], [1, true], "all the points, because it is not marked for what it says");
  assert.equal(grade(full(5), "one two").fraction, 0, "too short earns nothing");
});

test("what the LMS is told for an essay: the words, spaces tidied, cut to what SCORM 1.2 holds, and nothing to compare it with", () => {
  const g = grade(full(0), "  Line one.\n\nLine   two.  ");
  assert.deepEqual([g.scormType, g.response, g.patterns], ["fill-in", "Line one. Line two.", []]);
  assert.equal(grade(full(0), "word ".repeat(200)).response.length, 255);
});

test("an essay is long fill-in for SCORM 2004 and xAPI, its words as they are and no right answer", () => {
  const g = grade(full(0), "A reply with [brackets] and, commas.");
  assert.deepEqual(formatGraded(full(0), g), { kind: "long-fill-in", response: "A reply with [brackets] and, commas.", patterns: [] });
  assert.equal(scorm2004Type("long-fill-in"), "long_fill_in", "every hyphen, not only the first");
});

test("nothing to check until there are enough words, and the learner is told how many", () => {
  assert.deepEqual([isAnswered(full(0), null), isAnswered(full(0), ""), isAnswered(full(0), "  \n "), isAnswered(full(0), "yes")], [false, false, false, true]);
  assert.deepEqual([isAnswered(full(25), "ten words are not enough for this one ok no"), isAnswered(full(25), "x ".repeat(25))], [false, true]);
  assert.equal(emptyMessage(full(0)), "Write your answer first.");
  assert.equal(emptyMessage(full(1)), "Write your answer first.");
  assert.equal(emptyMessage(full(25)), "Write at least 25 words first.");
});

test("a long essay is not kept when the learner leaves, but a short one is", () => {
  assert.equal(keepAnswer("a short reply"), "a short reply");
  assert.equal(keepAnswer("word ".repeat(100)), "");
});

test("in the course, too short is not an attempt; long enough is full marks and the question is finished", () => {
  const { rt } = courseWith(essay(5));
  assert.equal(rt.submitQuiz("obj-0011", "only three words", "click"), null);
  assert.equal(rt.quiz.size, 0, "no try was used");
  const out = rt.submitQuiz("obj-0011", "this one has five words", "click")!;
  assert.deepEqual([out.correct, out.result, out.score, out.locked], [true, "correct", 12, true]);
});

test("SCORM 1.2 is told a fill-in with the writing and no correct response", async () => {
  const lms = await told12(essay(3), "a  reply\nof four words");
  assert.deepEqual([lms("type"), lms("student_response"), lms("correct_responses.0.pattern"), lms("result"), lms("weighting")], ["fill-in", "a reply of four words", undefined, "correct", "12"]);
});

test("SCORM 2004 is told a long fill-in, which its strict LMS takes with no complaint", async () => {
  const lms = await told2004(essay(3), "a reply\nof four words");
  assert.deepEqual([lms.get("type"), lms.get("learner_response"), lms.get("correct_responses.0.pattern"), lms.get("result")], ["long_fill_in", "a reply of four words", undefined, "correct"]);
  assert.deepEqual(lms.warnings, []);
});

// ---- the page

test("the box has its label, a live-free word count it is described by, and the minimum when there is one", () => {
  const { root } = built(essay(25));
  const box = root.byTag("textarea")[0]!;
  const label = root.byTag("label")[0]!;
  assert.equal(label.getAttribute("for"), box.id);
  const described = (box.getAttribute("aria-describedby") ?? "").split(" ");
  assert.equal(described.length, 2);
  const texts = described.map((id) => root.all((e) => e.id === id)[0]!.textContent);
  assert.deepEqual(texts, ["Write at least 25 words.", "0 words"]);
  assert.equal(root.all((e) => e.hasAttribute("aria-live") || e.getAttribute("role") === "status").length, 0, "typing is not talked over");
});

test("no minimum, no minimum line", () => {
  const { root } = built(essay(0));
  const described = (root.byTag("textarea")[0]!.getAttribute("aria-describedby") ?? "").split(" ");
  assert.equal(described.length, 1);
  assert.equal(root.byClass("os-q-hint").length, 0);
  const one = built(essay(1));
  assert.equal(one.root.byClass("os-q-hint")[0]!.textContent, "Write at least 1 word.");
});

test("the count follows what is written, and an earlier answer comes back with its count", () => {
  const { root, view } = built(essay(0));
  const box = root.byTag("textarea")[0]!;
  const count = () => root.byClass("os-q-count")[0]!.textContent;
  assert.equal(view.answer(), null);
  box.value = "one";
  box.fire("input");
  assert.equal(count(), "1 word");
  box.value = "one two three";
  box.fire("input");
  assert.equal(count(), "3 words");
  assert.equal(view.answer(), "one two three");
  view.setAnswer("back again, with five words");
  assert.deepEqual([box.value, count()], ["back again, with five words", "5 words"]);
  box.value = "   ";
  assert.equal(view.answer(), null, "spaces are no answer");
});

test("a finished essay can still be read and moved through, so it is read-only, not disabled", () => {
  const { root, view } = built(essay(0));
  view.lock();
  const box = root.byTag("textarea")[0]!;
  assert.deepEqual([box.readOnly, box.disabled], [true, false]);
});

test("on the author's canvas nothing responds", () => {
  const { root } = built(essay(0), { editing: true });
  const box = root.byTag("textarea")[0]!;
  box.value = "typed";
  box.fire("input");
  assert.equal(root.byClass("os-q-count")[0]!.textContent, "0 words");
});
