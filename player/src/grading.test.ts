import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeBlanks, decodePairs, emptyMessage, encodeBlanks, encodePairs, grade, isAnswered, keepAnswer, letter, matchOptions, parseNumber, splitBlanks, stableShuffle, tidy } from "./grading.ts";
import type { ChoiceQuiz, FillBlanksQuiz, HotspotQuiz, MatchingQuiz, NumericQuiz, SequencingQuiz, ShortAnswerQuiz } from "./types.ts";

const base = { scoring: { points: 10, attemptsAllowed: 2 }, feedback: { correct: "layer-1", incorrect: "layer-2" } };

const mc: ChoiceQuiz = { ...base, questionType: "multipleChoice", choices: [{ id: "c1", label: "A", correct: false }, { id: "c2", label: "B", correct: true }, { id: "c3", label: "C", correct: false }] };
const mr: ChoiceQuiz = { ...base, questionType: "multipleResponse", choices: [{ id: "c1", label: "A", correct: true }, { id: "c2", label: "B", correct: false }, { id: "c3", label: "C", correct: true }, { id: "c4", label: "D", correct: true }] };
const short: ShortAnswerQuiz = { ...base, questionType: "shortAnswer", answers: ["Mount Everest", "Everest"], caseSensitive: false };
const numeric: NumericQuiz = { ...base, questionType: "numeric", min: 9.5, max: 10.5 };
const exact: NumericQuiz = { ...base, questionType: "numeric", min: 42, max: 42 };
const typed: FillBlanksQuiz = { ...base, questionType: "fillBlanks", mode: "typed", text: "The {1} flows past the {2}.", blanks: [{ id: "1", answers: ["river", "stream"] }, { id: "2", answers: ["town"] }], wordBank: [], caseSensitive: false };
const bank: FillBlanksQuiz = { ...typed, mode: "dropdown", wordBank: ["river", "town", "hill"], blanks: [{ id: "1", answers: ["river"] }, { id: "2", answers: ["town"] }] };
const matching: MatchingQuiz = { ...base, questionType: "matching", drag: false, pairs: [{ id: "p1", premise: "Email", match: "Slow and written" }, { id: "p2", premise: "Phone", match: "Fast and spoken" }, { id: "p3", premise: "Text", match: "Short and quick" }], extras: ["Silent"] };
const sequence: SequencingQuiz = { ...base, questionType: "sequencing", drag: false, items: [{ id: "s1", text: "First" }, { id: "s2", text: "Second" }, { id: "s3", text: "Third" }, { id: "s4", text: "Fourth" }] };
const hotspot: HotspotQuiz = { ...base, questionType: "hotspot", image: { src: "assets/images/map.png", alt: "A map" }, regions: [{ id: "r1", label: "North", x: 0, y: 0, width: 50, height: 50, correct: false }, { id: "r2", label: "South", x: 0, y: 50, width: 50, height: 50, correct: true }, { id: "r3", label: "Also south", x: 50, y: 50, width: 50, height: 50, correct: true }] };

test("multiple choice is all or nothing, and reports the letter", () => {
  const right = grade(mc, "c2");
  assert.deepEqual([right.fraction, right.correct, right.scormType, right.response, right.patterns], [1, true, "choice", "b", ["b"]]);
  const wrong = grade(mc, "c1");
  assert.deepEqual([wrong.fraction, wrong.correct, wrong.response], [0, false, "a"]);
  assert.equal(grade(mc, "nonsense").fraction, 0);
});

test("multiple response: every right choice and no wrong one is full marks", () => {
  const g = grade(mr, "c4,c1,c3");
  assert.deepEqual([g.fraction, g.correct, g.response, g.patterns], [1, true, "a,c,d", ["a,c,d"]]);
});

test("multiple response gives a share for the right ones ticked, less the wrong ones ticked, never below nothing", () => {
  assert.equal(grade(mr, "c1").fraction.toFixed(4), (1 / 3).toFixed(4), "one of three right");
  assert.equal(grade(mr, "c1,c3").fraction.toFixed(4), (2 / 3).toFixed(4));
  assert.equal(grade(mr, "c1,c3,c2").fraction.toFixed(4), (1 / 3).toFixed(4), "a wrong tick takes one right one away");
  assert.equal(grade(mr, "c2").fraction, 0, "only a wrong one: nothing, not minus");
  assert.equal(grade(mr, "c2,c1").fraction, 0, "one right and one wrong cancel out");
  assert.equal(grade(mr, "c1,c3,c4,c2").correct, false, "ticking everything is not right");
  assert.equal(grade(mr, "").fraction, 0);
  assert.equal(grade(mr, "c1,c1,c1").fraction.toFixed(4), (1 / 3).toFixed(4), "the same choice repeated counts once");
  assert.equal(grade(mr, "zzz,c1").fraction.toFixed(4), (1 / 3).toFixed(4), "an unknown id is ignored");
});

test("short answer ignores capitals and spaces unless told not to, and takes any accepted answer", () => {
  assert.equal(grade(short, "mount   everest ").correct, true);
  assert.equal(grade(short, "EVEREST").correct, true);
  assert.equal(grade(short, "K2").correct, false);
  assert.equal(grade(short, "").correct, false);
  assert.equal(grade({ ...short, caseSensitive: true }, "everest").correct, false);
  assert.equal(grade({ ...short, caseSensitive: true }, "Everest").correct, true);
  const g = grade(short, "Everest");
  assert.deepEqual([g.scormType, g.response, g.patterns], ["fill-in", "Everest", ["Mount Everest", "Everest"]]);
});

test("short answer treats accented letters the same however they were typed", () => {
  const cafe = { ...short, answers: ["café"] };
  assert.equal(grade(cafe, "café").correct, true, "e and a combining accent is the same word as the one letter");
});

test("numbers are read the way a person types them", () => {
  assert.equal(parseNumber("10"), 10);
  assert.equal(parseNumber(" 10.5 "), 10.5);
  assert.equal(parseNumber("1,234"), 1234, "a comma then three digits is thousands");
  assert.equal(parseNumber("1,234.5"), 1234.5);
  assert.equal(parseNumber("1,5"), 1.5, "a comma then other digits is a decimal point");
  assert.equal(parseNumber("12,345,678"), 12345678);
  assert.equal(parseNumber("-3"), -3);
  assert.equal(parseNumber(".5"), 0.5);
  assert.equal(parseNumber("1e3"), 1000);
  assert.equal(parseNumber("1 000"), 1000);
  assert.equal(parseNumber("ten"), null);
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber("1.2.3"), null);
  assert.equal(parseNumber("10%"), null);
});

test("numeric is right within the range, ends included, and says so to the LMS", () => {
  assert.equal(grade(numeric, "10").correct, true);
  assert.equal(grade(numeric, "9.5").correct, true);
  assert.equal(grade(numeric, "10.5").correct, true);
  assert.equal(grade(numeric, "10.6").correct, false);
  assert.equal(grade(numeric, "banana").correct, false);
  assert.deepEqual(grade(numeric, "10").patterns, ["9.5#10.5"]);
  assert.deepEqual(grade(exact, "42").patterns, ["42"], "an exact answer is a single number");
  assert.equal(grade(exact, "42.0").correct, true);
  assert.equal(grade({ ...exact, min: 0.3, max: 0.3 }, String(0.1 + 0.2)).correct, true, "sums that are a hair off are accepted");
  assert.equal(grade(numeric, "10").scormType, "numeric");
});

test("splitting a sentence at its blanks", () => {
  assert.deepEqual(splitBlanks("The {1} flows past the {2}."), [
    { type: "text", value: "The " }, { type: "blank", id: "1" }, { type: "text", value: " flows past the " }, { type: "blank", id: "2" }, { type: "text", value: "." },
  ]);
  assert.deepEqual(splitBlanks("{a}{b}"), [{ type: "blank", id: "a" }, { type: "blank", id: "b" }]);
  assert.deepEqual(splitBlanks("No blanks."), [{ type: "text", value: "No blanks." }]);
  assert.deepEqual(splitBlanks("Braces { 1 } with spaces are not blanks."), [{ type: "text", value: "Braces { 1 } with spaces are not blanks." }]);
});

test("blanks in an answer survive encoding, and a damaged answer is just empty", () => {
  assert.deepEqual(decodeBlanks(encodeBlanks(["river", "a, b | c"]), 2), ["river", "a, b | c"]);
  assert.deepEqual(decodeBlanks(encodeBlanks(["one"]), 3), ["one", "", ""]);
  assert.deepEqual(decodeBlanks("not json", 2), ["", ""]);
  assert.deepEqual(decodeBlanks('{"a":1}', 2), ["", ""]);
  assert.deepEqual(decodeBlanks("[1,2]", 2), ["", ""], "only text counts");
});

test("fill in the blanks gives a share for each blank that is right", () => {
  const all = grade(typed, encodeBlanks(["River", " town "]));
  assert.deepEqual([all.fraction, all.correct, all.scormType, all.response, all.patterns], [1, true, "fill-in", "River,town", ["river,town"]]);
  assert.equal(grade(typed, encodeBlanks(["stream", "city"])).fraction, 0.5);
  assert.equal(grade(typed, encodeBlanks(["lake", "city"])).fraction, 0);
  assert.equal(grade(typed, encodeBlanks(["", "town"])).fraction, 0.5, "an empty blank is wrong, the other still counts");
  assert.equal(grade({ ...typed, caseSensitive: true }, encodeBlanks(["River", "town"])).fraction, 0.5);
});

test("a word chosen from a list must be exactly the word", () => {
  assert.equal(grade(bank, encodeBlanks(["river", "town"])).correct, true);
  assert.equal(grade(bank, encodeBlanks(["River", "town"])).fraction, 0.5, "a list gives the word exactly, so a different capital is a different word");
  assert.equal(grade(bank, encodeBlanks([" river ", "town"])).fraction, 1, "though stray spaces are ignored");
  assert.equal(grade(bank, encodeBlanks(["hill", "town"])).fraction, 0.5);
});

test("matching gives a share for each item matched rightly, and tells the LMS in its own form", () => {
  const options = matchOptions(matching);
  assert.deepEqual(options.map((o) => o.id), ["p1", "p2", "p3", "x1"], "each right match carries its pair's id, extras get x ids");
  const all = grade(matching, encodePairs({ p1: "p1", p2: "p2", p3: "p3" }));
  assert.deepEqual([all.fraction, all.correct, all.scormType, all.response, all.patterns], [1, true, "matching", "1.a,2.b,3.c", ["1.a,2.b,3.c"]]);
  const some = grade(matching, encodePairs({ p1: "p2", p2: "p2", p3: "x1" }));
  assert.equal(some.fraction.toFixed(4), (1 / 3).toFixed(4));
  assert.equal(some.response, "1.b,2.b,3.d");
  assert.equal(grade(matching, "").fraction, 0);
  assert.deepEqual(decodePairs(encodePairs({ p1: "p2", p2: "" })), { p1: "p2" }, "an item with nothing chosen is left out");
});

test("sequencing gives a share for each item in its right place", () => {
  const right = grade(sequence, "s1,s2,s3,s4");
  assert.deepEqual([right.fraction, right.correct, right.scormType, right.response, right.patterns], [1, true, "sequencing", "a,b,c,d", ["a,b,c,d"]]);
  assert.equal(grade(sequence, "s2,s1,s3,s4").fraction, 0.5, "two in their place");
  assert.equal(grade(sequence, "s4,s3,s2,s1").fraction, 0, "all reversed");
  assert.equal(grade(sequence, "s2,s3,s4,s1").fraction, 0, "all shifted by one");
  assert.equal(grade(sequence, "s1,s2,s3").correct, false, "a missing item is not right");
});

test("a hotspot is right if the area chosen is one of the right ones, and says all the right areas to the LMS", () => {
  assert.equal(grade(hotspot, "r2").correct, true);
  assert.equal(grade(hotspot, "r3").correct, true);
  assert.equal(grade(hotspot, "r1").correct, false);
  assert.equal(grade(hotspot, "nowhere").fraction, 0);
  const g = grade(hotspot, "r1");
  assert.deepEqual([g.scormType, g.response, g.patterns], ["choice", "a", ["b", "c"]]);
});

test("what counts as having an answer to check", () => {
  assert.equal(isAnswered(mc, null), false);
  assert.equal(isAnswered(mc, ""), false);
  assert.equal(isAnswered(mc, "c1"), true);
  assert.equal(isAnswered(mr, ""), false);
  assert.equal(isAnswered(mr, "c1"), true);
  assert.equal(isAnswered(short, "   "), false);
  assert.equal(isAnswered(numeric, "x"), true, "something typed can be checked, and is simply wrong if it is not a number");
  assert.equal(isAnswered(typed, encodeBlanks(["", ""])), false);
  assert.equal(isAnswered(typed, encodeBlanks(["", "a"])), true);
  assert.equal(isAnswered(matching, ""), false);
  assert.equal(isAnswered(matching, encodePairs({ p1: "p1" })), true);
  assert.equal(isAnswered(sequence, "s1,s2"), true, "the order as it stands is an answer");
  assert.equal(isAnswered(hotspot, ""), false);
});

test("each question says what is missing in its own words", () => {
  for (const q of [mc, mr, short, numeric, typed, bank, matching, hotspot]) assert.match(emptyMessage(q), /first\.$/);
  assert.match(emptyMessage(typed), /blank/);
  assert.match(emptyMessage(bank), /word/);
});

test("the shuffle is the same every time for the same seed, differs for another, and never leaves a list as it came", () => {
  const items = ["a", "b", "c", "d", "e", "f"];
  assert.deepEqual(stableShuffle(items, "obj-1"), stableShuffle(items, "obj-1"));
  assert.notDeepEqual(stableShuffle(items, "obj-1"), stableShuffle(items, "obj-2"));
  assert.deepEqual([...stableShuffle(items, "obj-1")].sort(), items, "nothing lost or added");
  assert.deepEqual(items, ["a", "b", "c", "d", "e", "f"], "the original is not changed");
  for (let n = 2; n <= 8; n++) {
    for (const seed of ["a", "b", "c", "question-1", "question-2", "q3"]) {
      const list = Array.from({ length: n }, (_, i) => i);
      assert.notDeepEqual(stableShuffle(list, seed), list, `${n} items, seed ${seed}`);
    }
  }
  assert.deepEqual(stableShuffle(["only"], "x"), ["only"]);
  assert.deepEqual(stableShuffle([], "x"), []);
});

test("letters, tidying and what is kept", () => {
  assert.deepEqual([letter(0), letter(1), letter(25), letter(40), letter(-3)], ["a", "b", "z", "z", "a"]);
  assert.equal(tidy("  Hello \n World  ", false), "hello world");
  assert.equal(tidy("  Hello World ", true), "Hello World");
  assert.equal(keepAnswer("short"), "short");
  assert.equal(keepAnswer("x".repeat(201)), "", "an answer too long to save with the learner's place is not kept");
});

test("an answer to the LMS is never longer than SCORM 1.2 allows", () => {
  const long = "x".repeat(400);
  assert.equal(grade(short, long).response.length, 255);
  assert.ok(grade({ ...short, answers: [long] }, "a").patterns[0]!.length <= 255);
});
