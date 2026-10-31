// Tests for the answer syntax shared by SCORM 2004 and xAPI.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeBlanks, encodeBlanks, encodePairs, grade } from "./grading.ts";
import { formatGraded, formatInput, scorm2004Type } from "./interaction-format.ts";
import type { QuizContent } from "./types.ts";

const base = { scoring: { points: 10, attemptsAllowed: 1 }, feedback: { correct: "", incorrect: "" } };
const choices = [
  { id: "c1", label: "One", correct: true },
  { id: "c2", label: "Two", correct: false },
  { id: "c3", label: "Three", correct: true },
];
const fmt = (q: QuizContent, answer: string) => formatGraded(q, grade(q, answer));

test("choices use the standard's list separator", () => {
  const multi: QuizContent = { ...base, questionType: "multipleResponse", choices };
  assert.deepEqual(fmt(multi, "c3,c1"), { kind: "choice", response: "a[,]c", patterns: ["a[,]c"] });
  const single: QuizContent = { ...base, questionType: "multipleChoice", choices: [choices[0]!, choices[1]!] };
  assert.deepEqual(fmt(single, "c2"), { kind: "choice", response: "b", patterns: ["a"] });
});

test("a hotspot offers each right area as its own pattern", () => {
  const q: QuizContent = {
    ...base, questionType: "hotspot", image: { src: "a.png", alt: "x" },
    regions: [
      { id: "r1", label: "A", x: 0, y: 0, width: 10, height: 10, correct: true },
      { id: "r2", label: "B", x: 20, y: 0, width: 10, height: 10, correct: false },
      { id: "r3", label: "C", x: 40, y: 0, width: 10, height: 10, correct: true },
    ],
  };
  assert.deepEqual(fmt(q, "r2"), { kind: "choice", response: "b", patterns: ["a", "c"] });
});

test("matching writes each pair with [.] and joins pairs with [,]", () => {
  const q: QuizContent = {
    ...base, questionType: "matching", drag: false, extras: ["decoy"],
    pairs: [{ id: "p1", premise: "1", match: "x" }, { id: "p2", premise: "2", match: "y" }],
  };
  assert.deepEqual(fmt(q, encodePairs({ p1: "p1", p2: "x1" })), { kind: "matching", response: "1[.]a[,]2[.]c", patterns: ["1[.]a[,]2[.]b"] });
});

test("sequencing is a list of letters in the learner's order", () => {
  const q: QuizContent = { ...base, questionType: "sequencing", drag: false, items: [{ id: "i1", text: "a" }, { id: "i2", text: "b" }, { id: "i3", text: "c" }] };
  assert.deepEqual(fmt(q, "i2,i1,i3"), { kind: "sequencing", response: "b[,]a[,]c", patterns: ["a[,]b[,]c"] });
});

test("a number range uses [:], and an answer that is not a number is sent as other", () => {
  const range: QuizContent = { ...base, questionType: "numeric", min: 1, max: 5 };
  assert.deepEqual(fmt(range, "3"), { kind: "numeric", response: "3", patterns: ["1[:]5"] });
  assert.deepEqual(fmt(range, "three"), { kind: "other", response: "three", patterns: ["1[:]5"] });
  const exact: QuizContent = { ...base, questionType: "numeric", min: 7, max: 7 };
  assert.deepEqual(fmt(exact, "7").patterns, ["7"]);
});

test("a typed answer says whether capitals matter, and cannot contain a separator", () => {
  const q: QuizContent = { ...base, questionType: "shortAnswer", answers: ["Paris", "paris, france"], caseSensitive: true };
  assert.deepEqual(fmt(q, "Paris"), { kind: "fill-in", response: "Paris", patterns: ["{case_matters=true}Paris", "{case_matters=true}paris, france"] });
  const loose: QuizContent = { ...q, caseSensitive: false };
  assert.deepEqual(fmt(loose, "a[,]b"), { kind: "fill-in", response: "a[ ,]b", patterns: ["Paris", "paris, france"] });
});

test("blanks keep a comma inside one blank and use [,] between blanks", () => {
  const q: QuizContent = {
    ...base, questionType: "fillBlanks", mode: "typed", text: "{b1} and {b2}", wordBank: [], caseSensitive: false,
    blanks: [{ id: "b1", answers: ["x, y"] }, { id: "b2", answers: ["z"] }],
  };
  const answer = encodeBlanks(["x, y", "z"]);
  assert.deepEqual(decodeBlanks(answer, 2), ["x, y", "z"]);
  assert.deepEqual(fmt(q, answer), {
    kind: "fill-in",
    response: "x, y[,]z",
    patterns: ["{case_matters=false}{order_matters=true}x, y[,]z"],
  });
  // A word picked from a list is exact.
  assert.match(fmt({ ...q, mode: "dropdown" }, answer).patterns[0]!, /^\{case_matters=true\}/);
});

test("an input's tick box becomes true or false", () => {
  assert.deepEqual(formatInput("true-false", "1"), { kind: "true-false", response: "true" });
  assert.deepEqual(formatInput("true-false", "0"), { kind: "true-false", response: "false" });
  assert.deepEqual(formatInput("likert", "4"), { kind: "likert", response: "4" });
  assert.deepEqual(formatInput("choice", "b"), { kind: "choice", response: "b" });
});

test("SCORM 2004 spells its types with underscores", () => {
  assert.equal(scorm2004Type("true-false"), "true_false");
  assert.equal(scorm2004Type("fill-in"), "fill_in");
  assert.equal(scorm2004Type("choice"), "choice");
  assert.equal(scorm2004Type("other"), "other");
});
