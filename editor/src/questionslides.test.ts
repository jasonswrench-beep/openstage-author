// Tests for making slides from a table of questions: what each slide holds, the bank, undo, escaping, and the real validator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ChoiceQuiz, QuizContent, ShortAnswerQuiz } from "../../player/src/types.ts";
import { Model } from "./model.ts";
import { readQuestions, TEMPLATE_CSV } from "./questionimport.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(slides = 1): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-12" });
  const m = new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
  while (m.slides.length < slides) m.addSlide();
  m.selectSlide(m.slides[0]!.id);
  return m;
}
const quizOf = (m: Model, slideId: string) => {
  const slide = m.slides.find((s) => s.id === slideId)!;
  return slide.baseLayer.objects.find((o) => o.type === "quizQuestion")!;
};
const ids = (m: Model) => m.slides.map((s) => s.id);

test("each question becomes a slide of its own, after the slide being edited, and the first is chosen", () => {
  const m = fresh(3);
  m.selectSlide(ids(m)[1]!);
  const before = ids(m);
  const said = m.addQuestionSlides(readQuestions(TEMPLATE_CSV).questions, { bank: null, shuffleAnswers: false })!;
  assert.match(said, /Added 5 questions as slides 3 to 7\. One Undo takes them all away\./);
  assert.equal(m.slides.length, 8);
  assert.deepEqual(ids(m).slice(0, 2), before.slice(0, 2));
  assert.equal(ids(m)[7], before[2], "the slide that came after is still last");
  assert.deepEqual(m.slides.slice(2, 7).map((s) => s.name), ["Question 1", "Question 2", "Question 3", "Question 4", "Question 5"]);
  assert.equal(m.sel.slideId, ids(m)[2], "the first new slide is the one on the screen");
  assert.equal(m.banks.length, 0);
});

test("a multiple choice slide has the question as its heading, the answers, the right one marked, and the table's points and feedback", () => {
  const m = fresh();
  m.addQuestionSlides(readQuestions(TEMPLATE_CSV).questions, { bank: null, shuffleAnswers: false });
  const slide = m.slides[1]!;
  const [heading, quizObject] = slide.baseLayer.objects;
  assert.equal(heading!.type, "text");
  assert.equal((heading!.content as { html: string }).html, "<h2>Which channel suits a quick yes or no between two colleagues?</h2>");
  assert.equal(heading!.accessibility.role, "heading");
  const q = quizObject!.content as unknown as ChoiceQuiz;
  assert.equal(q.questionType, "multipleChoice");
  assert.deepEqual(q.choices.map((c) => [c.label, c.correct]), [["A short message", true], ["A formal letter", false], ["A staff meeting", false], ["A printed memo", false]]);
  assert.deepEqual(q.scoring, { points: 10, attemptsAllowed: 2 });
  assert.equal(q.shuffle, undefined, "not asked to mix");
  assert.equal(quizObject!.accessibility.altText, "Which channel suits a quick yes or no between two colleagues?", "the group of answers is named by the question");
  assert.ok((quizObject!.accessibility.tabOrder ?? 0) >= 1 && (heading!.accessibility.tabOrder ?? 0) >= 1);
  const [right, wrong] = slide.layers;
  assert.equal(slide.layers.length, 2);
  assert.equal(q.feedback.correct, right!.id);
  assert.equal(q.feedback.incorrect, wrong!.id);
  assert.equal((right!.objects[0]!.content as { html: string }).html, "<p>Right: a short message is quick and easy to answer.</p>");
  assert.equal((wrong!.objects[0]!.content as { html: string }).html, "<p>Not quite. Think about how quickly the answer is needed.</p>");
});

test("the other kinds: several right, true or false, and a short answer", () => {
  const m = fresh();
  m.addQuestionSlides(readQuestions(TEMPLATE_CSV).questions, { bank: null, shuffleAnswers: false });
  const content = (n: number) => quizOf(m, m.slides[n]!.id).content as unknown as QuizContent;
  const mr = content(3) as ChoiceQuiz;
  assert.equal(mr.questionType, "multipleResponse");
  assert.deepEqual(mr.choices.map((c) => c.correct), [true, false, true, false]);
  const tf = content(4) as ChoiceQuiz;
  assert.equal(tf.questionType, "multipleChoice");
  assert.deepEqual(tf.choices.map((c) => [c.label, c.correct]), [["True", false], ["False", true]]);
  assert.equal(tf.scoring.attemptsAllowed, 1, "true or false starts with one try, as it does in the editor");
  const sa = content(5) as ShortAnswerQuiz;
  assert.equal(sa.questionType, "shortAnswer");
  assert.deepEqual(sa.answers, ["Communication", "communicating"]);
  assert.equal(sa.caseSensitive, false);
});

test("without feedback in the table, a right answer says Correct and a wrong one says Not quite, with Try again only if there is another try", () => {
  const m = fresh();
  m.addQuestionSlides(readQuestions("Question,A,B,Correct,Attempts\nOne,x,y,A,1\nTwo,x,y,A,3").questions, { bank: null, shuffleAnswers: false });
  const text = (n: number, layer: number) => (m.slides[n]!.layers[layer]!.objects[0]!.content as { html: string }).html;
  assert.equal(text(1, 0), "<p>Correct.</p>");
  assert.equal(text(1, 1), "<p>Not quite.</p>");
  assert.equal(text(2, 1), "<p>Not quite. Try again.</p>");
  assert.equal((quizOf(m, m.slides[2]!.id).content as unknown as QuizContent).scoring.attemptsAllowed, 3);
});

test("mixing the answers is set on the multiple choice and several right questions only", () => {
  const m = fresh();
  m.addQuestionSlides(readQuestions(TEMPLATE_CSV).questions, { bank: null, shuffleAnswers: true });
  const mixes = m.slides.slice(1).map((s) => (quizOf(m, s.id).content as { shuffle?: boolean }).shuffle === true);
  assert.deepEqual(mixes, [true, true, true, false, false], "not true or false (the order of True and False stays), and not a short answer");
});

test("with a bank, the new slides are the bank: the name, how many to show, and the mixed order", () => {
  const m = fresh(2);
  const said = m.addQuestionSlides(readQuestions(TEMPLATE_CSV).questions, { bank: { name: "Chapter 1", draw: 2, shuffle: true }, shuffleAnswers: true })!;
  assert.match(said, /They are the question bank Chapter 1: each learner is shown 2 of them, in a mixed order/);
  assert.equal(m.banks.length, 1);
  assert.deepEqual(m.banks[0]!.slides, ids(m).slice(1, 6));
  assert.deepEqual({ name: m.banks[0]!.name, draw: m.banks[0]!.draw, shuffle: m.banks[0]!.shuffle }, { name: "Chapter 1", draw: 2, shuffle: true });
  assert.equal(m.bankOf(ids(m)[1]!)?.id, m.banks[0]!.id);
});

test("one question cannot be a bank, and the author is told", () => {
  const m = fresh();
  const said = m.addQuestionSlides(readQuestions("Question,A,B,Correct\nOnly,x,y,A").questions, { bank: { name: "B", draw: 1, shuffle: true }, shuffleAnswers: false })!;
  assert.match(said, /Added one question as slide 2\./);
  assert.match(said, /A bank needs at least two questions, so no bank was made/);
  assert.equal(m.banks.length, 0);
});

test("one Undo takes all the slides and the bank away, and Redo brings them back", () => {
  const m = fresh(2);
  m.addQuestionSlides(readQuestions(TEMPLATE_CSV).questions, { bank: { name: "Chapter 1", draw: 2, shuffle: true }, shuffleAnswers: false });
  assert.equal(m.slides.length, 7);
  m.undo();
  assert.equal(m.slides.length, 2);
  assert.equal(m.banks.length, 0);
  m.redo();
  assert.equal(m.slides.length, 7);
  assert.equal(m.banks.length, 1);
});

test("words with angle brackets or ampersands are kept as words, in the page and in the name a screen reader reads", () => {
  const m = fresh();
  m.addQuestionSlides(readQuestions('Question,A,B,Correct,Feedback if right\n"Is a < b & b > c?",x,y,A,"Yes: a < b\nand b > c"').questions, { bank: null, shuffleAnswers: false });
  const slide = m.slides[1]!;
  assert.equal((slide.baseLayer.objects[0]!.content as { html: string }).html, "<h2>Is a &lt; b &amp; b &gt; c?</h2>");
  assert.equal(slide.baseLayer.objects[0]!.accessibility.altText, "Is a < b & b > c?");
  assert.equal((slide.layers[0]!.objects[0]!.content as { html: string }).html, "<p>Yes: a &lt; b</p><p>and b &gt; c</p>");
});

test("no question, no change", () => {
  const m = fresh();
  assert.equal(m.addQuestionSlides([], { bank: null, shuffleAnswers: false }), "There are no questions to add.");
  assert.equal(m.slides.length, 1);
});

test("a long answer list makes room for itself", () => {
  const m = fresh();
  m.addQuestionSlides(readQuestions("Question,A,B,C,D,E,F,G,H,Correct\nQ,1,2,3,4,5,6,7,8,A").questions, { bank: null, shuffleAnswers: false });
  const quiz = quizOf(m, m.slides[1]!.id);
  assert.ok(quiz.geometry.height >= 80 + 48 * 8, String(quiz.geometry.height));
});

interface Finding { severity: string; rule: string; object_id: string; message: string }

function validate(m: Model): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-qi-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the real validator finds nothing wrong with what the import makes", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  m.addQuestionSlides(readQuestions(TEMPLATE_CSV).questions, { bank: { name: "Chapter 1", draw: 2, shuffle: true }, shuffleAnswers: true });
  const found = validate(m);
  assert.deepEqual(found.filter((f) => f.severity === "error"), []);
  assert.deepEqual(found.filter((f) => f.rule.startsWith("bank-") || f.rule.startsWith("quiz-")), [], "no bank or question rules fire");
});
