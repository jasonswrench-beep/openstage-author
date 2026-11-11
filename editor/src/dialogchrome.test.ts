// The parts every dialog gets as it opens (revamp step 6): which button of the foot is the main one, and which dialogs get the Close
// button. The dialogs themselves were opened one by one in the browser preview (Close, Escape, the foot in sight, a narrow window).
import { test } from "node:test";
import assert from "node:assert/strict";
import { leavesDialog, mainButtonOf, wantsCloseButton } from "./dialogchrome.ts";

test("buttons that leave a dialog are known by their words", () => {
  for (const w of ["Cancel", "Close", "Done", "Back", " close ", "Not now", "Keep editing"]) assert.ok(leavesDialog(w), w);
  for (const w of ["Add", "Publish", "Save theme", "Make all missing audio", "Close project", "Go back to recordings"]) assert.ok(!leavesDialog(w), w);
});

test("the main button of a foot is the first that does something, never Cancel or Close", () => {
  const row = (...labels: string[]) => labels.map((label) => ({ label, disabled: false }));
  assert.equal(mainButtonOf(row("Add", "Cancel")), 0);
  assert.equal(mainButtonOf(row("Cancel", "Add")), 1);
  assert.equal(mainButtonOf(row("Make audio", "Make all missing audio", "Close")), 0);
  assert.equal(mainButtonOf(row("Close")), -1);
  assert.equal(mainButtonOf(row("Cancel", "Close")), -1);
  assert.equal(mainButtonOf([]), -1);
  // A dimmed one is still the main one: it is filled in again as soon as it can be used.
  assert.equal(mainButtonOf([{ label: "Publish", disabled: true }, { label: "Close", disabled: false }]), 0);
});

test("every dialog of ours gets a Close button, except those with their own and the recording editor", () => {
  assert.ok(wantsCloseButton("dialog", false));
  assert.ok(wantsCloseButton("dialog wide narration-dialog", false));
  assert.ok(!wantsCloseButton("dialog command-search", true));
  assert.ok(!wantsCloseButton("dialog recording-editor", false));
  assert.ok(!wantsCloseButton("something-else", false));
});
