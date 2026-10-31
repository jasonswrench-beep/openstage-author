// The labeled graphic kind of interaction (added in 0.44.0): where a marker sits and what it is called. The drawing itself needs a page, and is tried in a browser.
import assert from "node:assert/strict";
import { test } from "node:test";
import { INTERACTION_KINDS, ITEM_LIMITS, markerAt, markerName } from "./interactions.ts";
import type { InteractionItem } from "./types.ts";

const item = (extra: Partial<InteractionItem> = {}): InteractionItem => ({ id: "item-1", title: "Part", body: "<p>x</p>", image: null, narration: null, ...extra });

test("a marker sits where the item says, as a percentage of the picture", () => {
  assert.deepEqual(markerAt(item({ x: 30, y: 62.5 }), 0, 3), { x: 30, y: 62.5 });
  assert.deepEqual(markerAt(item({ x: 0, y: 100 }), 0, 3), { x: 0, y: 100 }, "the edges are on the picture");
});

test("a marker with no place, or one off the picture, goes in a row along the bottom so it can still be reached", () => {
  assert.deepEqual(markerAt(item(), 0, 4), { x: 12.5, y: 92 });
  assert.deepEqual(markerAt(item(), 3, 4), { x: 87.5, y: 92 });
  assert.deepEqual(markerAt(item({ x: 120, y: 10 }), 1, 2), { x: 75, y: 92 });
  assert.deepEqual(markerAt(item({ x: 10 }), 0, 1), { x: 50, y: 92 }, "half a place is no place");
  assert.deepEqual(markerAt(item({ x: Number.NaN, y: 5 }), 0, 1), { x: 50, y: 92 });
});

test("a marker is named by its number, which is all it shows, and then its title", () => {
  assert.equal(markerName(0, "The sender"), "1. The sender");
  assert.equal(markerName(11, "Noise"), "12. Noise");
  assert.ok(markerName(2, "x").startsWith("3"), "the visible number is the start of the name (WCAG 2.5.3)");
});

test("a labeled graphic is a kind of interaction with one to twelve markers", () => {
  assert.ok((INTERACTION_KINDS as readonly string[]).includes("labeledGraphic"));
  assert.deepEqual(ITEM_LIMITS.labeledGraphic, { min: 1, max: 12 });
});
