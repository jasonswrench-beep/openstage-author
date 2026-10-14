// A theme's logo: where it sits, and the limits it shares with the validator and the editor.
import assert from "node:assert/strict";
import { test } from "node:test";
import rules from "../../tools/theme-rules.json" with { type: "json" };
import { LOGO_LIMITS, LOGO_MARGIN, logoBox, logoFirst } from "./logo.ts";

test("the logo sits in its corner, a fixed margin in, as the shared cases say", () => {
  assert.ok(rules.logoCases.length > 3);
  for (const c of rules.logoCases) {
    assert.deepEqual(logoBox({ width: c.stage[0]!, height: c.stage[1]! }, c.logo as { corner: "top-left"; width: number; height: number }), c.box, JSON.stringify(c));
  }
});

test("the margin and the limits are the shared ones", () => {
  assert.equal(LOGO_MARGIN, 24);
  assert.deepEqual([LOGO_LIMITS.minSize, LOGO_LIMITS.maxWidth, LOGO_LIMITS.maxHeight], [24, 400, 200]);
  assert.deepEqual([...LOGO_LIMITS.corners], ["top-left", "top-right", "bottom-left", "bottom-right"]);
});

test("a logo at the top comes before the slide's objects in the page, and one at the bottom after them", () => {
  assert.equal(logoFirst({ corner: "top-left" }), true);
  assert.equal(logoFirst({ corner: "top-right" }), true);
  assert.equal(logoFirst({ corner: "bottom-left" }), false);
  assert.equal(logoFirst({ corner: "bottom-right" }), false);
});
