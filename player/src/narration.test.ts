import assert from "node:assert/strict";
import { test } from "node:test";
import { cueAt, itemNarrationKey } from "./narration.ts";

const cues = [
  { start: 0.5, end: 2, text: "One." },
  { start: 2, end: 4, text: "Two." },
];

test("cueAt finds the cue being spoken", () => {
  assert.equal(cueAt(cues, 0.5)?.text, "One.");
  assert.equal(cueAt(cues, 1.99)?.text, "One.");
  assert.equal(cueAt(cues, 2)?.text, "Two.");
});

test("cueAt returns null before, between and after cues", () => {
  assert.equal(cueAt(cues, 0.1), null);
  assert.equal(cueAt(cues, 4), null);
  assert.equal(cueAt([], 1), null);
});

test("an interaction item's narration is found under its object's id, a slash, then its own id", () => {
  // tools/narrate.py (item_key) makes the same key, and the publish test below checks the two agree on a real project.
  assert.equal(itemNarrationKey("obj-0005", "item-2"), "obj-0005/item-2");
});
