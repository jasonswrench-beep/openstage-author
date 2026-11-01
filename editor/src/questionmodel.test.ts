// Adding every kind of question, changing one, and the narration written from it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { questionScript } from "./narration.ts";
import { Model } from "./model.ts";
import { QUIZ_KINDS, startingQuestion } from "./questionedit.ts";
import type { ChoiceQuiz, FillBlanksQuiz, HotspotQuiz, QuizContent } from "../../player/src/types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const proj = path.join(here, "..", "..", "examples", "minimal.osproj");
const text = (rel: string) => readFileSync(path.join(proj, rel), "utf-8");

function open(): Model {
  return new Model({
    dir: "D:/x",
    project: text("project.json"),
    theme: text("theme.json"),
    slides: [
      { id: "slide-001", text: text("slides/slide-001.json") },
      { id: "slide-002", text: text("slides/slide-002.json") },
    ],
  });
}

test("every kind of question can be added, with a heading, two feedback layers and a place on the slide", () => {
  for (const kind of QUIZ_KINDS) {
    const m = open();
    m.addLayer();
    m.selectLayer(m.slide!.baseLayer.id);
    const layers = m.slide!.layers.length;
    const before = m.objects.length;
    const quiz = m.addQuiz(kind.id, kind.id === "hotspot" ? { imageSrc: "assets/images/map.png" } : {})!;
    assert.ok(quiz, kind.id);
    assert.equal(m.objects.length, before + 2, `${kind.id}: a heading and the question`);
    assert.equal(m.slide!.layers.length, layers + 2, `${kind.id}: two feedback layers`);
    assert.equal(quiz.type, "quizQuestion");
    assert.equal(quiz.name, kind.name);
    assert.equal(quiz.accessibility.altText, kind.alt, "the group has a name for a screen reader");
    const c = quiz.content as unknown as QuizContent;
    assert.equal(c.questionType, (startingQuestion(kind.id, "assets/images/map.png") as QuizContent).questionType);
    assert.equal(c.scoring.points, 10);
    assert.ok(m.slide!.layers.some((l) => l.id === c.feedback.correct) && m.slide!.layers.some((l) => l.id === c.feedback.incorrect));
    const g = quiz.geometry;
    assert.ok(g.y >= 0 && g.y + g.height <= m.project.stage.height, `${kind.id} fits the slide: ${g.y} + ${g.height}`);
    assert.equal(m.object!.id, quiz.id, "the question is selected");
  }
});

test("a true or false question, a hotspot and an essay get one attempt, the rest two", () => {
  const attempts = (type: Parameters<Model["addQuiz"]>[0]) => (open().addQuiz(type, { imageSrc: "assets/images/m.png" })!.content as unknown as QuizContent).scoring.attemptsAllowed;
  assert.deepEqual(["tf", "hotspot", "essay", "mc", "mr", "short", "numeric", "blanks", "matching", "sequence", "whichword", "shortcut"].map((t) => attempts(t as never)), [1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
});

test("an essay's feedback layers do not talk about a right or wrong answer, and the others keep the usual words", () => {
  const words = (type: Parameters<Model["addQuiz"]>[0]) => {
    const m = open();
    const quiz = m.addQuiz(type)!;
    const c = quiz.content as unknown as QuizContent;
    return [c.feedback.correct, c.feedback.incorrect].map((id) => m.slide!.layers.find((l) => l.id === id)!.objects[0]!.accessibility.altText);
  };
  assert.deepEqual(words("essay"), ["Thank you. Your answer has been kept.", "Write a little more, then check your answer again."]);
  assert.deepEqual(words("mc"), ["Correct. Explain why this answer is right.", "Not quite. Give a hint, then let the learner try again."]);
});

test("a hotspot question starts with the picture it was given and no description, which the author has to write", () => {
  const q = open().addQuiz("hotspot", { imageSrc: "assets/images/map.png" })!.content as unknown as HotspotQuiz;
  assert.deepEqual(q.image, { src: "assets/images/map.png", alt: "" });
});

test("a second question on a slide goes below the first, as far as there is room", () => {
  const m = open();
  const first = m.addQuiz("mc")!;
  const second = m.addQuiz("mc")!;
  assert.ok(second.geometry.y >= first.geometry.y, "not above");
  assert.ok(second.geometry.y + second.geometry.height <= m.project.stage.height);
});

test("a change to a question is one undo step, a refused one is none, and one that changes nothing is not a change", () => {
  const m = open();
  const quiz = m.addQuiz("short")!;
  const before = JSON.stringify(quiz.content);
  assert.match(m.editQuestion(quiz.id, { op: "shortAnswers", text: "Everest\nMount Everest" })!, /2 accepted answers/);
  assert.deepEqual((quiz.content as unknown as { answers: string[] }).answers, ["Everest", "Mount Everest"]);
  m.undo();
  assert.equal(JSON.stringify(m.objects.find((o) => o.id === quiz.id)!.content), before, "one undo takes it back");

  const stack = JSON.stringify(m.slides);
  assert.match(m.editQuestion(quiz.id, { op: "shortAnswers", text: "" })!, /at least one/, "a refusal says why");
  assert.equal(JSON.stringify(m.slides), stack, "and changes nothing");
  assert.equal(m.editQuestion(quiz.id, { op: "shortAnswers", text: "The right answer" }), null, "the same answer again is no change");
  assert.equal(m.editQuestion("nope", { op: "drag", on: true }), null);
});

test("an edit says what happened, and tells the window to redraw", () => {
  const m = open();
  const quiz = m.addQuiz("matching")!;
  const kinds: string[] = [];
  m.on((c) => kinds.push(c.kind));
  m.editQuestion(quiz.id, { op: "addPair" });
  assert.deepEqual(kinds, ["content"]);
});

test("the answer-choice changes only apply to questions made of choices", () => {
  const m = open();
  const quiz = m.addQuiz("short")!;
  assert.equal(m.addChoice(quiz.id), null);
  assert.equal(m.deleteChoice(quiz.id, "c1"), null);
  assert.equal(m.setChoiceLabel(quiz.id, "c1", "x"), null);
  const mr = m.addQuiz("mr")!;
  assert.match(m.addChoice(mr.id)!, /Added answer 5/);
  assert.equal(m.setCorrectChoice(mr.id, "c2"), null, "radio-style choosing is for multiple choice only");
});

test("a copy of any kind of question has feedback layers of its own", () => {
  for (const kind of QUIZ_KINDS) {
    const m = open();
    const quiz = m.addQuiz(kind.id, { imageSrc: "assets/images/map.png" })!;
    const layers = m.slide!.layers.length;
    m.selectObject(quiz.id);
    m.duplicate();
    const copy = m.object!.content as unknown as QuizContent;
    assert.equal(m.slide!.layers.length, layers + 2, kind.id);
    assert.notEqual(copy.feedback.correct, (quiz.content as unknown as QuizContent).feedback.correct);
    assert.deepEqual({ ...copy, scoring: null, feedback: null }, { ...(quiz.content as unknown as QuizContent), scoring: null, feedback: null }, "the question itself is the same");
  }
});

test("narration is written from what a question shows, and a learner who cannot see the screen gets the same words", () => {
  const seed = "obj-0001";
  const mc = startingQuestion("mc") as ChoiceQuiz;
  assert.equal(questionScript(mc, seed), "Choose one answer. Your choices are: First answer. Second answer. Third answer.");
  assert.equal(questionScript(startingQuestion("mr") as ChoiceQuiz, seed), "Choose every answer that is right. Your choices are: First answer. Second answer. Third answer. Fourth answer.");
  assert.equal(questionScript(startingQuestion("short") as QuizContent, seed), "Type your answer.");
  assert.equal(questionScript(startingQuestion("numeric") as QuizContent, seed), "Type a number.");

  const typed = startingQuestion("blanks") as FillBlanksQuiz;
  typed.text = "The {1} flows past the {2}.";
  typed.blanks = [{ id: "1", answers: ["river"] }, { id: "2", answers: ["town"] }];
  assert.equal(questionScript(typed, seed), "The blank 1 flows past the blank 2. Type the missing words.");

  const bank = { ...typed, mode: "dropdown", wordBank: ["river", "town", "hill"] } as FillBlanksQuiz;
  const said = questionScript(bank, seed);
  assert.match(said, /^The blank 1 flows past the blank 2\. Choose a word for each blank\. The words are: /);
  for (const w of bank.wordBank) assert.ok(said.includes(`${w}.`), `${w} is read`);

  const match = questionScript(startingQuestion("matching") as QuizContent, seed);
  assert.match(match, /^Match each item with its match\. The items are: First item\. Second item\. The matches are: /);
  assert.ok(match.includes("First match.") && match.includes("Second match."));

  const seq = questionScript(startingQuestion("sequence") as QuizContent, seed);
  assert.match(seq, /^Put these in the right order\. They are: /);
  assert.notEqual(seq, "Put these in the right order. They are: First step. Second step. Third step.", "the steps are read in the order the learner sees them, not the right one");

  const hot = startingQuestion("hotspot", "assets/images/map.png") as HotspotQuiz;
  hot.image.alt = "A map of the campus";
  assert.equal(questionScript(hot, seed), "Choose an area of the picture. A map of the campus. The areas are: Left half. Right half.");
  hot.image.alt = "";
  assert.equal(questionScript(hot, seed), "Choose an area of the picture. The areas are: Left half. Right half.");

  assert.equal(questionScript(startingQuestion("essay") as QuizContent, seed), "Write your answer. It needs at least 20 words.");
  assert.equal(questionScript({ ...startingQuestion("essay"), minWords: 0 } as unknown as QuizContent, seed), "Write your answer.");
  assert.equal(questionScript(startingQuestion("whichword") as QuizContent, seed), "Choose a word of this passage. Write your passage here and put the right word in square brackets.", "read without the marks, so it does not give the answer away");
  assert.equal(questionScript(startingQuestion("shortcut") as QuizContent, seed), "Type a keyboard shortcut, or press the keys.");
});

test("narration can be written from a question in one step, and says so when it already says it", () => {
  const m = open();
  const quiz = m.addQuiz("mr")!;
  assert.equal(quiz.narration, null);
  m.narrateQuestionFromText(quiz.id);
  const script = (m.objects.find((o) => o.id === quiz.id)!.narration as { script: string }).script;
  assert.match(script, /^Choose every answer that is right\./);
  assert.match(m.narrateQuestionFromText(quiz.id)!, /already says what the question shows/);
  m.undo();
  assert.equal(m.objects.find((o) => o.id === quiz.id)!.narration, null, "one undo takes it away");
});
