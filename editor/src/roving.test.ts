// Tests for the list that is one stop for the Tab key.
import assert from "node:assert/strict";
import { test } from "node:test";
import { rovingStop, type RovingItem } from "./roving.ts";

const item = (over: Partial<RovingItem> = {}): RovingItem => ({ focused: false, current: false, pressed: false, ...over });

test("an empty list has no stop", () => {
  assert.equal(rovingStop([]), -1);
});

test("with nothing marked, Tab lands on the first item", () => {
  assert.equal(rovingStop([item(), item(), item()]), 0);
});

test("Tab lands on the current item", () => {
  assert.equal(rovingStop([item(), item({ current: true }), item()]), 1);
});

test("the item that has the focus wins, so Shift and Tab comes back to where the person was", () => {
  assert.equal(rovingStop([item({ current: true }), item(), item({ focused: true })]), 2);
});

test("with several chosen and none current, Tab lands on the first chosen", () => {
  assert.equal(rovingStop([item(), item({ pressed: true }), item({ pressed: true })]), 1);
});

test("the current item wins over a chosen one", () => {
  assert.equal(rovingStop([item({ pressed: true }), item({ current: true }), item({ pressed: true })]), 1);
});

test("exactly one stop is chosen however the items are marked", () => {
  const marks = [item({ current: true, pressed: true }), item({ pressed: true }), item({ focused: true, current: true })];
  const stop = rovingStop(marks);
  assert.equal(stop, 2);
  assert.equal(marks.filter((_, i) => i === stop).length, 1);
});
