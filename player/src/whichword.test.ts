// The which-word question: a passage to read, in which the learner chooses a word. The right word or words are marked [like this] by the author and
// are never shown to the learner. A keyboard and a screen reader answer from a list of the words; the words themselves are for the mouse and touch.
import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyMessage, grade, isAnswered } from "./grading.ts";
import { formatGraded } from "./interaction-format.ts";
import { built, courseWith, told12, told2004, type Body } from "./question-helpers.ts";
import type { QuizContent, WhichWordQuiz } from "./types.ts";

const word = (passage: string): Body<WhichWordQuiz> => ({ questionType: "whichWord", passage });
const full = (passage: string): QuizContent => ({ ...word(passage), scoring: { points: 12, attemptsAllowed: 2 }, feedback: { correct: "a", incorrect: "b" } });
const DOG = "The dog [barked] loudly.";

test("choosing the marked word is right, any other is not, and the LMS is told the word", () => {
  const right = grade(full(DOG), "w3");
  assert.deepEqual([right.fraction, right.correct, right.scormType, right.response, right.patterns], [1, true, "fill-in", "barked", ["barked"]]);
  const wrong = grade(full(DOG), "w1");
  assert.deepEqual([wrong.fraction, wrong.correct, wrong.response, wrong.patterns], [0, false, "The", ["barked"]]);
  const none = grade(full(DOG), "w99");
  assert.deepEqual([none.fraction, none.response], [0, ""]);
});

test("a passage with two marked words accepts either, and says both", () => {
  const q = full("Two [right] answers: both [correct].");
  assert.equal(grade(q, "w2").correct, true);
  assert.equal(grade(q, "w5").correct, true);
  assert.equal(grade(q, "w3").correct, false);
  assert.deepEqual(grade(q, "w3").patterns, ["right", "correct"]);
});

test("a word that comes twice is the one in its place: the same word elsewhere is not the answer", () => {
  const q = full("The [cat] and the cat.");
  assert.equal(grade(q, "w2").correct, true);
  assert.equal(grade(q, "w5").correct, false);
  assert.equal(grade(q, "w5").response, "cat");
});

test("something chosen is an answer; nothing is not, and the learner is told", () => {
  assert.deepEqual([isAnswered(full(DOG), null), isAnswered(full(DOG), ""), isAnswered(full(DOG), "w2")], [false, false, true]);
  assert.equal(emptyMessage(full(DOG)), "Choose a word first.");
});

test("SCORM 2004 and xAPI take it as a fill-in", () => {
  const q = full("Say [hello] now");
  assert.deepEqual(formatGraded(q, grade(q, "w2")), { kind: "fill-in", response: "hello", patterns: ["hello"] });
});

test("in the course, a right word is full marks and a wrong one is a try used", () => {
  const { rt } = courseWith(word(DOG));
  assert.equal(rt.submitQuiz("obj-0011", "", "click"), null);
  const wrong = rt.submitQuiz("obj-0011", "w1", "click")!;
  assert.deepEqual([wrong.correct, wrong.score, wrong.locked], [false, 0, false]);
  const right = rt.submitQuiz("obj-0011", "w3", "click")!;
  assert.deepEqual([right.correct, right.score, right.locked], [true, 12, true]);
});

test("SCORM 1.2 and strict SCORM 2004 are told the word as a fill-in", async () => {
  const a = await told12(word(DOG), "w3");
  assert.deepEqual([a("type"), a("student_response"), a("correct_responses.0.pattern"), a("result")], ["fill-in", "barked", "barked", "correct"]);
  const b = await told2004(word(DOG), "w1");
  assert.deepEqual([b.get("type"), b.get("learner_response"), b.get("correct_responses.0.pattern"), b.get("result")], ["fill_in", "The", "barked", "incorrect"]);
  assert.deepEqual(b.warnings, []);
});

// ---- the page

const options = (root: ReturnType<typeof built>["root"]) => root.byTag("option").map((o) => [o.getAttribute("value"), o.textContent]);

test("the passage reads as the author wrote it, one word to a place, and never shows which is right", () => {
  const { root } = built(word(DOG));
  assert.equal(root.byClass("os-q-passage")[0]!.textContent, "The dog barked loudly.");
  assert.deepEqual(root.byClass("os-q-word").map((s) => [s.getAttribute("data-word"), s.textContent]), [["w1", "The"], ["w2", "dog"], ["w3", "barked"], ["w4", "loudly"]]);
  assert.equal(root.all((e) => e.classList.contains("is-right") || e.className.includes("right") || e.hasAttribute("data-right")).length, 0);
  assert.ok(!JSON.stringify([...root.all()].map((e) => [...e.attrs])).includes("barked"), "the right word is not in an attribute either");
});

test("the keyboard and screen reader route is a list of every word, labelled, and a word said twice is told apart by its place", () => {
  const { root } = built(word("The [cat] and the cat."));
  const select = root.byTag("select")[0]!;
  assert.equal(root.byTag("label")[0]!.getAttribute("for"), select.id);
  assert.equal(root.byTag("label")[0]!.textContent, "Choose a word");
  assert.deepEqual(options(root), [["", ""], ["w1", "The (word 1)"], ["w2", "cat (word 2)"], ["w3", "and"], ["w4", "the (word 4)"], ["w5", "cat (word 5)"]]);
  assert.equal(root.byClass("os-q-word").some((s) => s.hasAttribute("tabindex") || s.tag === "button"), false, "words are plain text to a screen reader, not a hundred tab stops");
});

test("choosing from the list or by clicking a word does the same, and shows which is chosen", () => {
  const { root, view } = built(word(DOG));
  const select = root.byTag("select")[0]!;
  const spans = root.byClass("os-q-word");
  const chosen = () => spans.filter((s) => s.classList.contains("is-chosen")).map((s) => s.getAttribute("data-word"));
  assert.equal(view.answer(), null);
  select.value = "w2";
  select.fire("change");
  assert.deepEqual([view.answer(), chosen()], ["w2", ["w2"]]);
  spans[2]!.fire("click");
  assert.deepEqual([view.answer(), select.value, chosen()], ["w3", "w3", ["w3"]]);
  view.setAnswer("w1");
  assert.deepEqual([view.answer(), chosen()], ["w1", ["w1"]]);
  view.setAnswer("w404");
  assert.deepEqual([view.answer(), chosen()], [null, []], "an answer to a word that is not there is no answer");
});

test("a finished question takes no more clicks", () => {
  const { root, view } = built(word(DOG));
  view.setAnswer("w1");
  view.lock();
  root.byClass("os-q-word")[2]!.fire("click");
  assert.equal(view.answer(), "w1");
  assert.equal(root.byTag("select")[0]!.disabled, true);
});

test("the author's canvas marks the right words, and nothing responds", () => {
  const { root, view } = built(word(DOG), { editing: true });
  assert.deepEqual(root.byClass("is-right").map((s) => s.textContent), ["barked"]);
  root.byClass("os-q-word")[0]!.fire("click");
  assert.equal(view.answer(), null);
});

test("a passage with nothing in it still builds, for the validator to complain about", () => {
  for (const passage of ["", "  ...  ", "No marks at all here."]) {
    const { root } = built(word(passage));
    assert.ok(root.byTag("select").length === 1, JSON.stringify(passage));
  }
});
