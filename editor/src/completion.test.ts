// Tests for the course's completion setting in the editor's model.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

function fresh(mutate?: (project: Record<string, unknown>) => void): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-12" });
  const project = JSON.parse(files[0]!.text) as Record<string, unknown>;
  mutate?.(project);
  return new Model({ dir: "D:/x", project: JSON.stringify(project), theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

test("a new course counts every slide, as courses always have", () => {
  const m = fresh();
  assert.equal(m.completion, "all");
  assert.deepEqual(m.project.completion, { slides: "all" });
});

test("the new-project file puts the setting beside the credits switch", () => {
  const keys = Object.keys(JSON.parse(newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-12" })[0]!.text));
  assert.equal(keys[keys.indexOf("credits") + 1], "completion");
});

test("choosing the last slide changes the setting, says so plainly, and can be undone and redone", () => {
  const m = fresh();
  assert.equal(m.dirty, false);
  assert.equal(m.setCompletion("last"), "The course now counts as complete when the learner reaches the last slide and has finished every quiz.");
  assert.equal(m.completion, "last");
  assert.equal(m.dirty, true);
  assert.ok(m.undo());
  assert.equal(m.completion, "all");
  assert.equal(m.dirty, false, "undo puts the file back as it was");
  assert.ok(m.redo());
  assert.equal(m.completion, "last");
  assert.equal(m.setCompletion("all"), "The course now counts as complete when the learner has seen every slide and finished every quiz.");
});

test("choosing what is already chosen changes nothing", () => {
  const m = fresh();
  assert.equal(m.setCompletion("all"), null);
  assert.equal(m.dirty, false);
  m.setCompletion("last");
  assert.equal(m.setCompletion("last"), null);
});

test("the choice is written to project.json, and only project.json changes", () => {
  const m = fresh();
  m.setCompletion("last");
  const files = m.dirtyFiles();
  assert.deepEqual(files.map((f) => f.path), ["project.json"]);
  assert.deepEqual((JSON.parse(files[0]!.text) as { completion: unknown }).completion, { slides: "last" });
});

test("a project that somehow has no setting reads as every slide, and choosing writes one", () => {
  const m = fresh((p) => { delete p["completion"]; });
  assert.equal(m.completion, "all");
  assert.equal(m.setCompletion("all"), "The course now counts as complete when the learner has seen every slide and finished every quiz.", "the missing setting is written, even though it reads the same");
  assert.deepEqual(m.project.completion, { slides: "all" });
});
