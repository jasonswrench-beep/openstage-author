// Tests for the results box and the certificate: the data behind them, and every sentence they say.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  certificateDate, certificateLines, cleanName, lockedSentence, passMarkSentence, questionLine, roundPercent, scoreSentence, verdictSentence,
  type CourseResults, type QuestionResult,
} from "./results.ts";
import { courseResults } from "./scorm.ts";
import { examplePackage, newRuntime } from "./test-helpers.ts";
import type { CertificateContent, OSObject, QuizContent, ResultsContent } from "./types.ts";

/** The example course with its one question copied, so there are three questions on slide 2. */
function threeQuestions() {
  const pkg = examplePackage();
  const slide = pkg.slides[1]!;
  const original = slide.baseLayer.objects.find((o) => o.type === "quizQuestion") as OSObject;
  slide.baseLayer.objects.push(
    { ...original, id: "obj-q2", name: "Second question" },
    { ...original, id: "obj-q3", name: "Third question" },
  );
  return newRuntime(pkg);
}

const results = (over: Partial<CourseResults> = {}): CourseResults => ({
  questions: [{ slideName: "Question 1", objectId: "a", points: 10, earned: 10, state: "correct" }],
  totalPoints: 10, earnedPoints: 10, percent: 100, finished: true, passed: true, passMark: 80, ...over,
});

const resultsContent: ResultsContent = { heading: "Your results", passMessage: "Well done.", failMessage: "Review the lesson.", review: true };
const certContent: CertificateContent = { title: "Certificate", statement: "This certifies that", achievement: "has passed", issuedBy: "The Department", showScore: true, showDate: true };

// ---- the data

test("before any answer, the question is unanswered and nothing is known", () => {
  const { rt } = newRuntime();
  rt.goTo("slide-002");
  const r = courseResults(rt);
  assert.deepEqual(r.questions.map((q) => [q.slideName, q.state, q.points, q.earned]), [["Knowledge check", "unanswered", 10, 0]]);
  assert.deepEqual([r.finished, r.percent, r.passed, r.passMark, r.totalPoints, r.earnedPoints], [false, null, null, 80, 10, 0]);
});

test("a wrong answer with an attempt left is open, not finished", () => {
  const { rt } = newRuntime();
  rt.goTo("slide-002");
  rt.submitQuiz("obj-0011", "c2", "click");
  const r = courseResults(rt);
  assert.equal(r.questions[0]!.state, "open");
  assert.deepEqual([r.finished, r.percent, r.passed], [false, null, null]);
});

test("out of attempts the question is incorrect and the quiz is finished and failed", () => {
  const { rt } = newRuntime();
  rt.goTo("slide-002");
  rt.submitQuiz("obj-0011", "c2", "click");
  rt.submitQuiz("obj-0011", "c3", "click");
  const r = courseResults(rt);
  assert.equal(r.questions[0]!.state, "incorrect");
  assert.deepEqual([r.finished, r.percent, r.passed, r.earnedPoints], [true, 0, false, 0]);
});

test("a right answer on a retry still earns every point", () => {
  const { rt } = newRuntime();
  rt.goTo("slide-002");
  rt.submitQuiz("obj-0011", "c2", "click");
  rt.submitQuiz("obj-0011", "c1", "click");
  const r = courseResults(rt);
  assert.equal(r.questions[0]!.state, "correct");
  assert.deepEqual([r.finished, r.percent, r.passed, r.earnedPoints], [true, 100, true, 10]);
});

test("with several questions the score is points over points, and the pass mark is 80 percent", () => {
  const right = (rt: ReturnType<typeof threeQuestions>["rt"], id: string) => rt.submitQuiz(id, "c1", "click");
  const a = threeQuestions().rt;
  a.goTo("slide-002");
  right(a, "obj-0011"); right(a, "obj-q2");
  assert.equal(courseResults(a).finished, false, "one question is still unanswered");
  a.submitQuiz("obj-q3", "c2", "click"); a.submitQuiz("obj-q3", "c3", "click");
  const r = courseResults(a);
  assert.deepEqual(r.questions.map((q) => q.state), ["correct", "correct", "incorrect"]);
  assert.deepEqual([r.finished, r.percent, r.passed, r.earnedPoints, r.totalPoints], [true, 66.67, false, 20, 30]);

  const b = threeQuestions().rt;
  b.goTo("slide-002");
  for (const id of ["obj-0011", "obj-q2", "obj-q3"]) right(b, id);
  assert.deepEqual([courseResults(b).percent, courseResults(b).passed], [100, true]);
});

test("the questions are listed in the order of the course", () => {
  const { rt } = threeQuestions();
  rt.goTo("slide-002");
  assert.deepEqual(courseResults(rt).questions.map((q) => q.objectId), ["obj-0011", "obj-q2", "obj-q3"]);
});

test("a course with no quiz has no questions and no result", () => {
  const pkg = examplePackage();
  for (const slide of pkg.slides) slide.baseLayer.objects = slide.baseLayer.objects.filter((o) => o.type !== "quizQuestion");
  const { rt } = newRuntime(pkg);
  const r = courseResults(rt);
  assert.deepEqual([r.questions.length, r.finished, r.percent, r.passed], [0, false, null, null]);
  assert.equal(scoreSentence(r), "This course has no quiz questions.");
  assert.equal(verdictSentence(r, resultsContent), "");
});

test("the results come from the quiz as it stands, so resuming restores them", () => {
  const first = threeQuestions().rt;
  first.goTo("slide-002");
  first.submitQuiz("obj-0011", "c1", "click");
  const snapshot = first.snapshot();
  const second = threeQuestions().rt;
  second.restore(snapshot);
  assert.deepEqual(courseResults(second).questions.map((q) => q.state), ["correct", "unanswered", "unanswered"]);
});

// ---- the words

test("percentages have no needless decimals", () => {
  assert.deepEqual([80, 66.666, 100, 0, 33.3333].map(roundPercent), ["80", "66.67", "100", "0", "33.33"]);
});

test("the score sentence says what is known", () => {
  assert.equal(scoreSentence(results({ earnedPoints: 40, totalPoints: 50, percent: 80 })), "You scored 40 of 50 points (80%).");
  const two: QuestionResult[] = [
    { slideName: "Q1", objectId: "a", points: 10, earned: 10, state: "correct" },
    { slideName: "Q2", objectId: "b", points: 10, earned: 0, state: "open" },
    { slideName: "Q3", objectId: "c", points: 10, earned: 0, state: "unanswered" },
  ];
  assert.equal(scoreSentence(results({ questions: two, finished: false, percent: null, passed: null })), "You have finished 1 of 3 questions so far.");
  assert.equal(scoreSentence(results({ questions: [two[0]!], finished: false, percent: null, passed: null })), "You have finished 1 of 1 question so far.");
});

test("the verdict says passed, not passed, or not yet, and adds the author's own words", () => {
  assert.equal(verdictSentence(results(), resultsContent), "You passed. Well done.");
  assert.equal(verdictSentence(results({ passed: false, percent: 60 }), resultsContent), "You did not reach the pass mark. Review the lesson.");
  assert.equal(verdictSentence(results({ finished: false, passed: null, percent: null }), resultsContent), "Finish every question to see whether you passed.");
  assert.equal(verdictSentence(results(), { ...resultsContent, passMessage: "  " }), "You passed.", "an empty message adds nothing");
});

test("the pass mark is stated", () => {
  assert.equal(passMarkSentence(results({ passMark: 80 })), "The pass mark is 80%.");
});

test("each question line says what happened without relying on colour", () => {
  const q = (state: QuestionResult["state"], earned = 0, points = 10): QuestionResult => ({ slideName: "Question 4", objectId: "x", points, earned, state });
  assert.equal(questionLine(q("correct", 10)), "Question 4: correct, 10 of 10 points");
  assert.equal(questionLine(q("correct", 1, 1)), "Question 4: correct, 1 of 1 point");
  assert.equal(questionLine(q("incorrect")), "Question 4: not correct, 0 of 10 points");
  assert.equal(questionLine(q("open")), "Question 4: answered, but not right yet, and you can still try again");
  assert.equal(questionLine(q("unanswered")), "Question 4: not answered yet");
});

// ---- the certificate

test("a typed name is tidied and limited", () => {
  assert.equal(cleanName("  Ada   \n Lovelace  "), "Ada Lovelace");
  assert.equal(cleanName("   "), "");
  assert.equal(cleanName("x".repeat(300)).length, 100);
});

test("the date is long form in the course's language, and falls back to English", () => {
  const when = new Date(Date.UTC(2026, 9, 12, 12, 0, 0));
  assert.equal(certificateDate(when, "en-US", "UTC"), "October 12, 2026");
  assert.equal(certificateDate(when, "fr-FR", "UTC"), "12 octobre 2026");
  assert.equal(certificateDate(when, "not a language!", "UTC"), "October 12, 2026");
});

test("the certificate has the title, the name, the course, the score and the date, in order", () => {
  const when = new Date(Date.UTC(2026, 9, 12, 12, 0, 0));
  const lines = certificateLines(certContent, "Ada Lovelace", results({ percent: 85.5 }), { title: "Choosing the Right Channel", language: "en-US" }, when);
  assert.deepEqual(lines.map((l) => l.cls), ["os-cert-title", "os-cert-statement", "os-cert-name", "os-cert-achievement", "os-cert-course", "os-cert-fact", "os-cert-fact", "os-cert-issuer"]);
  assert.equal(lines[0]!.tag, "h2");
  assert.deepEqual(lines.map((l) => l.text).slice(0, 5), ["Certificate", "This certifies that", "Ada Lovelace", "has passed", "Choosing the Right Channel"]);
  assert.equal(lines[5]!.text, "Score: 85.5%");
  assert.match(lines[6]!.text, /^Date: .*2026$/);
  assert.equal(lines[7]!.text, "The Department");
});

test("lines the author left empty or switched off are left out, and the name is still there", () => {
  const bare = { ...certContent, statement: "", achievement: " ", issuedBy: "", showScore: false, showDate: false };
  const lines = certificateLines(bare, "Ada", results(), { title: "Course", language: "en-US" }, new Date());
  assert.deepEqual(lines.map((l) => l.cls), ["os-cert-title", "os-cert-name", "os-cert-course"]);
  const noScore = certificateLines(certContent, "Ada", results({ percent: null }), { title: "Course", language: "en-US" }, new Date());
  assert.ok(!noScore.some((l) => l.text.startsWith("Score")), "no score is shown when there is none");
});

test("a learner who cannot have a certificate is told why", () => {
  assert.match(lockedSentence(undefined), /no certificate to earn/);
  assert.match(lockedSentence(results({ questions: [], finished: false })), /no certificate to earn/);
  assert.match(lockedSentence(results({ finished: false, passed: null, percent: null })), /Finish every question first/);
  assert.match(lockedSentence(results({ passed: false, percent: 60 })), /you did not reach the pass mark/);
});

test("quiz content really is what the data is built from", () => {
  const quiz = examplePackage().slides[1]!.baseLayer.objects.find((o) => o.type === "quizQuestion")!;
  assert.equal((quiz.content as unknown as QuizContent).scoring.points, 10);
});
