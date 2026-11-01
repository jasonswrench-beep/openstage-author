import assert from "node:assert/strict";
import { test } from "node:test";
import cases from "../../tools/passage-cases.json" with { type: "json" };
import { MAX_PASSAGE_WORDS, readPassage, shownPassage } from "./passage.ts";

test("a passage is read into the words a learner can choose and what is wrong with it, from the table the validator is tested from too", () => {
  for (const c of cases.cases as { source: string; words: [string, boolean][]; problems: string[] }[]) {
    const read = readPassage(c.source);
    assert.deepEqual(read.words.map((w) => [w.text, w.right]), c.words, JSON.stringify(c.source));
    assert.deepEqual(read.problems, c.problems, JSON.stringify(c.source));
  }
});

test("a word is chosen by an id that comes from its place, and a repeated word is two choices", () => {
  const read = readPassage("The [cat] and the cat.");
  assert.deepEqual(read.words.map((w) => [w.id, w.text, w.right]), [["w1", "The", false], ["w2", "cat", true], ["w3", "and", false], ["w4", "the", false], ["w5", "cat", false]]);
});

test("the learner reads the passage whole, with punctuation and spacing as the author wrote it and no marks", () => {
  assert.equal(shownPassage("The dog [barked] loudly."), "The dog barked loudly.");
  assert.equal(shownPassage('She said "[yes]", then  left.\nNext line [here].'), 'She said "yes", then  left.\nNext line here.');
  assert.equal(shownPassage("A mark across [two words] here"), "A mark across two words here");
  assert.equal(shownPassage("Wait - [now] - go."), "Wait - now - go.");
});

test("the pieces to draw keep punctuation outside the word that can be chosen", () => {
  const read = readPassage('"[yes]", ok');
  assert.deepEqual(read.pieces, [{ type: "text", value: '"' }, { type: "word", id: "w1", value: "yes" }, { type: "text", value: '",' }, { type: "text", value: " " }, { type: "word", id: "w2", value: "ok" }]);
});

test("a passage of more than the most words is said to be too long", () => {
  const long = `${Array.from({ length: MAX_PASSAGE_WORDS }, () => "w").join(" ")} [one] more`;
  assert.deepEqual(readPassage(long).problems, ["too-many-words"]);
  assert.deepEqual(readPassage(`${Array.from({ length: MAX_PASSAGE_WORDS - 1 }, () => "w").join(" ")} [one]`).problems, []);
});
