// Words that show a value: what a reference looks like, the values the course works out itself, and how each one is written.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILT_IN_VALUES, isBuiltInValue, namesInBrackets, referencesIn, showValue, splitReferences, valueFor, variableNamed, type ValueSource } from "./valuetext.ts";
import type { Variable } from "./types.ts";

const variables: Variable[] = [
  { id: "var-1", name: "Tries", type: "number", initial: 0 },
  { id: "var-2", name: "Door open", type: "boolean", initial: false },
  { id: "var-3", name: "Nickname", type: "string", initial: "Sam" },
];
const values: Record<string, number | boolean | string> = { "var-1": 3, "var-2": true, "var-3": "Sam" };
const source = (totals = { earnedPoints: 250, totalPoints: 800, percent: null as number | null, questions: 8, finished: 3, correct: 2 }): ValueSource => ({
  variables, valueOf: (id) => values[id], totals: () => totals,
});

test("a text is cut into its words and its references, in order", () => {
  assert.deepEqual(splitReferences("Score: {{$score}} of {{$possible}}."), [
    { kind: "words", text: "Score: " }, { kind: "value", name: "$score" }, { kind: "words", text: " of " }, { kind: "value", name: "$possible" }, { kind: "words", text: "." },
  ]);
  assert.deepEqual(splitReferences("No references here."), [{ kind: "words", text: "No references here." }]);
  assert.deepEqual(splitReferences(""), []);
  assert.deepEqual(splitReferences("{{Tries}}"), [{ kind: "value", name: "Tries" }]);
});

test("what is not a reference is left as words: one brace, an empty pair, a name with a brace or a line break, a name that is too long", () => {
  for (const text of ["{Tries}", "{{}}", "{{  }}", "{{a{b}}", "{{a\nb}}", `{{${"x".repeat(81)}}}`, "}}Tries{{"]) {
    assert.deepEqual(splitReferences(text).filter((p) => p.kind === "value"), [], text);
  }
  assert.equal(splitReferences("{{ Tries }}")[0]!.kind, "value", "spaces round a name do not matter");
  assert.deepEqual(referencesIn("{{ Tries }}"), ["Tries"]);
});

test("the names in a text are listed once each, in the order they come", () => {
  assert.deepEqual(referencesIn("{{Tries}} then {{$score}} then {{Tries}} again"), ["Tries", "$score"]);
  assert.deepEqual(referencesIn("nothing"), []);
});

test("an author's variable is found by its name, whatever the capitals", () => {
  assert.equal(variableNamed(variables, "tries")?.id, "var-1");
  assert.equal(variableNamed(variables, " DOOR OPEN ")?.id, "var-2");
  assert.equal(variableNamed(variables, "missing"), undefined);
});

test("a number is written as it is, true and false as yes and no, a word as it is, and nothing as nothing", () => {
  assert.deepEqual([3, 0, 2.5, true, false, "Sam", undefined].map((v) => showValue(v)), ["3", "0", "2.5", "yes", "no", "Sam", ""]);
});

test("the values the course works out come from the questions answered so far", () => {
  const s = source();
  assert.deepEqual(BUILT_IN_VALUES.map((v) => [v.name, valueFor(v.name, s)]), [
    ["$score", "250"], ["$possible", "800"], ["$percent", "31"], ["$answered", "3"], ["$questions", "8"], ["$correct", "2"],
  ]);
  assert.equal(valueFor("$percent", source({ earnedPoints: 0, totalPoints: 0, percent: null, questions: 0, finished: 0, correct: 0 })), "0", "no questions, no percent to divide");
  assert.equal(valueFor("$percent", source({ earnedPoints: 2, totalPoints: 3, percent: null, questions: 1, finished: 1, correct: 0 })), "67", "rounded");
});

test("an author's variable shows its value now, and a name that is nothing gives null so the slide can show the reference itself", () => {
  const s = source();
  assert.equal(valueFor("Tries", s), "3");
  assert.equal(valueFor("Door open", s), "yes");
  assert.equal(valueFor("Nickname", s), "Sam");
  assert.equal(valueFor("Nothing", s), null);
  assert.equal(valueFor("$nothing", s), null, "a dollar name that the course does not know is nothing too");
});

test("only the course's own names are built in, and they all start with a dollar sign", () => {
  assert.ok(BUILT_IN_VALUES.every((v) => v.name.startsWith("$") && v.label.length > 5));
  assert.deepEqual(["$score", "score", "$Score", ""].map(isBuiltInValue), [true, false, false, false]);
});

test("for a fixed copy such as a transcript, a reference is its name in brackets, without the dollar sign", () => {
  assert.equal(namesInBrackets("Score so far: {{$score}} out of {{$possible}}. Tries: {{Tries}}."), "Score so far: [score] out of [possible]. Tries: [Tries].");
  assert.equal(namesInBrackets("Plain words"), "Plain words");
});
