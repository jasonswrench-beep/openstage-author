// Tests for the answer syntax shared by SCORM 2004 and xAPI.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeBlanks, encodeBlanks, encodePairs, grade } from "./grading.ts";
import { formatGraded, formatInput, longResponse2004, scorm2004Type } from "./interaction-format.ts";
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

test("SCORM 2004 spells its types with hyphens, as SCORM 1.2 and xAPI do", () => {
  assert.equal(scorm2004Type("true-false"), "true-false");
  assert.equal(scorm2004Type("fill-in"), "fill-in");
  assert.equal(scorm2004Type("long-fill-in"), "long-fill-in");
  assert.equal(scorm2004Type("choice"), "choice");
  assert.equal(scorm2004Type("other"), "other");
});

// ---- SCORM 2004 long fill-in: an answer that begins with "{" (the learner's own braces) is not a language marker

test("an essay that begins with { is given the course's language marker first, and nothing else is changed", () => {
  assert.equal(longResponse2004("{lang=xx} my own words", "en-US"), "{lang=en-US}{lang=xx} my own words");
  assert.equal(longResponse2004("{x} is a placeholder", "fr"), "{lang=fr}{x} is a placeholder");
  assert.equal(longResponse2004("{", "en-US"), "{lang=en-US}{");
  for (const plain of ["my own words", "", " {not first}", "ends with {", "lang=xx"]) assert.equal(longResponse2004(plain, "en-US"), plain, JSON.stringify(plain));
});

test("taking exactly one marker off what was stored gives back the learner's words whole, even when they hold a marker of their own", () => {
  const strip = (stored: string) => stored.replace(/^\{lang=[^{}]*\}/, "");
  for (const words of ["{lang=xx}hello", "{lang=en-US}{lang=en-US}twice", "{lang=}", "{{", "{lang=xx", "{ plain brace"]) {
    assert.equal(strip(longResponse2004(words, "en-US")), words, words);
  }
  assert.equal(strip(longResponse2004("no brace at the start", "en-US")), "no brace at the start", "and with no marker added, nothing is taken off a plain answer");
});

test("a course language that is not a language code gives an empty marker, and a good one is used as it is", () => {
  for (const language of ["en", "en-US", "zh-Hans-CN", "fil"]) assert.equal(longResponse2004("{a", language), `{lang=${language}}{a`, language);
  for (const bad of ["", "english", "e", "en_US", "en-", "en US", "}{", "en}{lang=xx"]) assert.equal(longResponse2004("{a", bad), "{lang=}{a", JSON.stringify(bad));
});

test("the marker counts toward the 4000 characters, so the answer is cut a little rather than refused, and never in the middle of an emoji", () => {
  const long = longResponse2004("{" + "w".repeat(5000), "en-US");
  assert.equal(long.length, 4000);
  assert.ok(long.startsWith("{lang=en-US}{www"));
  const emoji = longResponse2004("{" + "w".repeat(3986) + "😀 more", "en-US");
  assert.ok(emoji.length <= 4000);
  assert.doesNotThrow(() => encodeURIComponent(emoji), "no lone half of a character");
  assert.equal(longResponse2004("{" + "w".repeat(100), "en-US").length, 12 + 101, "a short answer is not cut");
});

test("formatGraded itself leaves an essay as written, because xAPI takes it that way: the marker is SCORM 2004's own, added where it is sent", () => {
  const essay: QuizContent = { ...base, questionType: "essay", minWords: 1 };
  assert.deepEqual(fmt(essay, "{lang=xx} my own words"), { kind: "long-fill-in", response: "{lang=xx} my own words", patterns: [] });
});
