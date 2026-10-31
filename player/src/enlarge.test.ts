// What the Enlarge button and its pop-up are called to a screen reader. The pop-up itself needs a page, and is tried in a browser.
import assert from "node:assert/strict";
import { test } from "node:test";
import { enlargedName, enlargeName } from "./enlarge.ts";

test("the button says which picture it is for, and starts with its visible word", () => {
  assert.equal(enlargeName("A chart of the four channels"), "Enlarge picture: A chart of the four channels");
  assert.equal(enlargeName("  spaced  "), "Enlarge picture: spaced");
  assert.equal(enlargeName(""), "Enlarge picture", "with no description it is still a button with a name");
  assert.ok(enlargeName("x").startsWith("Enlarge"), "the name contains the visible label Enlarge, first (WCAG 2.5.3)");
});

test("the pop-up is named for the picture too", () => {
  assert.equal(enlargedName("A chart"), "Enlarged picture: A chart");
  assert.equal(enlargedName(" "), "Enlarged picture");
});
