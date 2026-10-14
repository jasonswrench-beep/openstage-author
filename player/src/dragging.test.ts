import assert from "node:assert/strict";
import { test } from "node:test";
import { insertIndexFor, reorder } from "./dragging.ts";

test("an item dropped at a height lands after the others that are above it", () => {
  const mids = [50, 100, 150];
  assert.equal(insertIndexFor(mids, 10), 0, "above all of them");
  assert.equal(insertIndexFor(mids, 75), 1);
  assert.equal(insertIndexFor(mids, 120), 2);
  assert.equal(insertIndexFor(mids, 999), 3, "below all of them");
  assert.equal(insertIndexFor([], 10), 0);
});

test("reordering takes an item out and puts it in its new place", () => {
  assert.deepEqual(reorder(["a", "b", "c", "d"], "d", 0), ["d", "a", "b", "c"]);
  assert.deepEqual(reorder(["a", "b", "c", "d"], "a", 3), ["b", "c", "d", "a"]);
  assert.deepEqual(reorder(["a", "b", "c", "d"], "b", 2), ["a", "c", "b", "d"]);
  assert.deepEqual(reorder(["a", "b", "c"], "b", 1), ["a", "b", "c"], "dropped where it was");
  assert.deepEqual(reorder(["a", "b", "c"], "a", 99), ["b", "c", "a"], "past the end is the end");
  assert.deepEqual(reorder(["a", "b", "c"], "c", -5), ["c", "a", "b"], "before the start is the start");
  assert.deepEqual(reorder(["a", "b"], "zzz", 0), ["a", "b"], "an item that is not there changes nothing");
});

test("reordering does not change the list it was given", () => {
  const order = ["a", "b", "c"];
  reorder(order, "c", 0);
  assert.deepEqual(order, ["a", "b", "c"]);
});

test("placing an item from its drop height gives the order a person would expect", () => {
  // Four items, 40 tall, from the top: middles 20, 60, 100, 140. Dragging the last one to about the height of the first one's middle.
  const order = ["a", "b", "c", "d"];
  const others = [20, 60, 100];
  assert.deepEqual(reorder(order, "d", insertIndexFor(others, 15)), ["d", "a", "b", "c"]);
  assert.deepEqual(reorder(order, "d", insertIndexFor(others, 70)), ["a", "b", "d", "c"]);
  assert.deepEqual(reorder(order, "d", insertIndexFor(others, 500)), ["a", "b", "c", "d"], "dropped below everything, where it already was");
});
