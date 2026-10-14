// How the course scores the new kinds of question: partial credit, the best attempt, what is saved, and what the LMS is told.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeLms } from "./fake-lms.ts";
import { encodeBlanks, encodePairs } from "./grading.ts";
import { Tracker, courseResults, evaluate } from "./scorm.ts";
import { examplePackage, newRuntime } from "./test-helpers.ts";
import type { QuizContent } from "./types.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));
const feedback = { correct: "layer-correct", incorrect: "layer-retry" };

/** A question as an author writes it: everything but the scoring and the feedback layers, whichever kind it is. */
type Body<T = QuizContent> = T extends QuizContent ? Omit<T, "scoring" | "feedback"> : never;

/** The example course with its one question replaced by this one. */
function courseWith(content: Body & { scoring?: QuizContent["scoring"] }) {
  const pkg = examplePackage();
  const slide = pkg.slides.find((s) => s.id === "slide-002")!;
  const quiz = [slide.baseLayer, ...slide.layers].flatMap((l) => l.objects).find((o) => o.id === "obj-0011")!;
  quiz.content = { scoring: { points: 12, attemptsAllowed: 2 }, feedback, ...content } as unknown as Record<string, unknown>;
  const { rt, log } = newRuntime(pkg);
  rt.goTo("slide-002");
  return { rt, log, pkg };
}

const multipleResponse = {
  questionType: "multipleResponse" as const,
  choices: [{ id: "c1", label: "A", correct: true }, { id: "c2", label: "B", correct: false }, { id: "c3", label: "C", correct: true }, { id: "c4", label: "D", correct: true }],
};

test("a partly right answer earns a share of the points, shows the other feedback, and leaves another try", () => {
  const { rt, log } = courseWith(multipleResponse);
  const out = rt.submitQuiz("obj-0011", "c1,c3", "click")!;
  assert.equal(out.correct, false);
  assert.equal(out.result, "partial");
  assert.equal(out.score, 8, "two of three right answers, of 12 points");
  assert.equal(out.locked, false);
  assert.ok(log.includes("layer layer-retry true"), "partly right shows the feedback for an answer that is not right");
  assert.ok(!log.includes("layer layer-correct true"));
});

test("the best attempt counts: a worse second try keeps the better score", () => {
  const { rt } = courseWith(multipleResponse);
  rt.submitQuiz("obj-0011", "c1,c3", "click");
  const out = rt.submitQuiz("obj-0011", "c1", "click")!;
  assert.equal(out.score, 8);
  assert.equal(out.locked, true, "that was the last try");
  assert.equal(out.result, "partial");
});

test("a right answer after a partly right one is full marks and locks it", () => {
  const { rt } = courseWith(multipleResponse);
  rt.submitQuiz("obj-0011", "c1", "click");
  const out = rt.submitQuiz("obj-0011", "c1,c3,c4", "click")!;
  assert.deepEqual([out.correct, out.result, out.score, out.locked], [true, "correct", 12, true]);
});

test("running out of tries on a wrong answer is no points, and on a partly right one is its share", () => {
  const { rt } = courseWith(multipleResponse);
  rt.submitQuiz("obj-0011", "c2", "click");
  const out = rt.submitQuiz("obj-0011", "c2", "click")!;
  assert.deepEqual([out.result, out.score, out.locked], ["incorrect", 0, true]);
});

test("nothing to check is not an attempt, whatever the kind of question", () => {
  const cases: [string, Body][] = [
    ["", multipleResponse],
    ["   ", { questionType: "shortAnswer", answers: ["x"], caseSensitive: false }],
    ["", { questionType: "numeric", min: 1, max: 2 }],
    [encodeBlanks(["", ""]), { questionType: "fillBlanks", mode: "typed", text: "{1} {2}", blanks: [{ id: "1", answers: ["a"] }, { id: "2", answers: ["b"] }], wordBank: [], caseSensitive: false }],
    ["", { questionType: "matching", drag: false, pairs: [{ id: "p1", premise: "a", match: "b" }, { id: "p2", premise: "c", match: "d" }], extras: [] }],
  ];
  for (const [answer, content] of cases) {
    const { rt } = courseWith(content);
    assert.equal(rt.submitQuiz("obj-0011", answer, "click"), null, content.questionType);
    assert.equal(rt.quiz.size, 0);
  }
});

test("a partly right answer is saved with the learner's place and comes back as it was", () => {
  const { rt } = courseWith(multipleResponse);
  rt.submitQuiz("obj-0011", "c1,c3", "click");
  const snap = rt.snapshot();
  assert.deepEqual(snap.quiz["obj-0011"], [1, 0, "p", 8, "c1,c3"]);
  const { rt: back } = courseWith(multipleResponse);
  back.restore(snap);
  assert.deepEqual(back.quiz.get("obj-0011"), { attempts: 1, locked: false, result: "partial", score: 8, choice: "c1,c3" });
});

test("an answer too long to save is not kept, and the rest of the status still is", () => {
  const { rt } = courseWith({ questionType: "shortAnswer", answers: ["x"], caseSensitive: false });
  rt.submitQuiz("obj-0011", "y".repeat(300), "click");
  assert.equal(rt.quiz.get("obj-0011")!.choice, null);
  assert.equal(rt.snapshot().quiz["obj-0011"]![4], "");
});

test("the course score counts the shares: 8 of 12 points is 66.67 percent, which is not a pass", () => {
  const { rt } = courseWith(multipleResponse);
  rt.submitQuiz("obj-0011", "c1,c3", "click");
  rt.submitQuiz("obj-0011", "c1,c3", "click");
  const p = evaluate(rt);
  assert.equal(p.scorePercent, 66.67);
  assert.equal(p.success, false);
});

test("the results box says partly correct, with the points", () => {
  const { rt } = courseWith(multipleResponse);
  rt.submitQuiz("obj-0011", "c1,c3", "click");
  assert.equal(courseResults(rt).questions[0]!.state, "open", "with a try left it is still open");
  rt.submitQuiz("obj-0011", "c1,c3", "click");
  const r = courseResults(rt);
  assert.deepEqual([r.questions[0]!.state, r.questions[0]!.earned, r.finished], ["partial", 8, true]);
});

/** What the LMS is told for a question: the SCORM type, the answer, what is right, and whether it counts as right. */
async function told(content: Body, answer: string) {
  const { rt } = courseWith(content);
  const lms = new FakeLms();
  const tracker = new Tracker(lms, rt);
  tracker.begin();
  rt.submitQuiz("obj-0011", answer, "click");
  await tick();
  return (key: string) => lms.data[`cmi.interactions.0.${key}`];
}

test("the LMS is told the SCORM type that fits each kind of question", async () => {
  const mr = await told(multipleResponse, "c3,c1");
  assert.deepEqual([mr("type"), mr("student_response"), mr("correct_responses.0.pattern"), mr("result"), mr("weighting")], ["choice", "a,c", "a,c,d", "wrong", "12"]);

  const sa = await told({ questionType: "shortAnswer", answers: ["Everest", "Mount Everest"], caseSensitive: false }, "everest");
  assert.deepEqual([sa("type"), sa("student_response"), sa("correct_responses.0.pattern"), sa("correct_responses.1.pattern"), sa("result")], ["fill-in", "everest", "Everest", "Mount Everest", "correct"]);

  const num = await told({ questionType: "numeric", min: 9.5, max: 10.5 }, "10");
  assert.deepEqual([num("type"), num("student_response"), num("correct_responses.0.pattern"), num("result")], ["numeric", "10", "9.5#10.5", "correct"]);

  const blanks = await told({ questionType: "fillBlanks", mode: "typed", text: "{1} and {2}", blanks: [{ id: "1", answers: ["salt"] }, { id: "2", answers: ["pepper"] }], wordBank: [], caseSensitive: false }, encodeBlanks(["salt", "sugar"]));
  assert.deepEqual([blanks("type"), blanks("student_response"), blanks("correct_responses.0.pattern"), blanks("result")], ["fill-in", "salt,sugar", "salt,pepper", "wrong"]);

  const match = await told({ questionType: "matching", drag: false, pairs: [{ id: "p1", premise: "Email", match: "Written" }, { id: "p2", premise: "Phone", match: "Spoken" }], extras: ["Silent"] }, encodePairs({ p1: "p1", p2: "p2" }));
  assert.deepEqual([match("type"), match("student_response"), match("correct_responses.0.pattern"), match("result")], ["matching", "1.a,2.b", "1.a,2.b", "correct"]);

  const seq = await told({ questionType: "sequencing", drag: false, items: [{ id: "s1", text: "One" }, { id: "s2", text: "Two" }, { id: "s3", text: "Three" }] }, "s1,s3,s2");
  assert.deepEqual([seq("type"), seq("student_response"), seq("correct_responses.0.pattern"), seq("result")], ["sequencing", "a,c,b", "a,b,c", "wrong"]);

  const hot = await told({ questionType: "hotspot", image: { src: "assets/images/m.png", alt: "Map" }, regions: [{ id: "r1", label: "N", x: 0, y: 0, width: 10, height: 10, correct: false }, { id: "r2", label: "S", x: 0, y: 10, width: 10, height: 10, correct: true }] }, "r2");
  assert.deepEqual([hot("type"), hot("student_response"), hot("correct_responses.0.pattern"), hot("result")], ["choice", "b", "b", "correct"]);
});

test("multiple choice is reported just as it was before", async () => {
  const mc = await told({ questionType: "multipleChoice", choices: [{ id: "c1", label: "A", correct: false }, { id: "c2", label: "B", correct: true }] }, "c2");
  assert.deepEqual([mc("type"), mc("student_response"), mc("correct_responses.0.pattern"), mc("result"), mc("weighting")], ["choice", "b", "b", "correct", "12"]);
});
