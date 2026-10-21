// Tests for keeping the recordings folder out of the published package.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-15" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const exclude = (m: Model): string[] => (JSON.parse(m.dirtyFiles().find((f) => f.path === "project.json")!.text) as { sourceExclude?: string[] }).sourceExclude ?? [];

test("the recordings folder is left out of the published package, once, and the project then needs saving", () => {
  const m = fresh();
  assert.equal(m.dirty, false);
  assert.equal(m.excludeFromPackage("captures"), true);
  assert.equal(m.dirty, true, "project.json has to be saved to keep it");
  assert.deepEqual(exclude(m), ["captures"]);
  assert.equal(m.excludeFromPackage("captures"), false, "already left out");
  assert.deepEqual(exclude(m), ["captures"], "not listed twice");
});

test("a folder that is already covered by an entry is not listed again", () => {
  const m = fresh();
  m.excludeFromPackage("raw");
  assert.equal(m.excludeFromPackage("raw/footage"), false, "a folder takes everything inside it");
  assert.equal(m.excludeFromPackage("capture"), true);
  assert.deepEqual(exclude(m), ["raw", "capture"]);
});

test("a name that is not a plain folder name is refused and changes nothing", () => {
  const m = fresh();
  for (const bad of ["", "/captures", "..", "a/../b", "./x", "a\\b", "captures/", "x*", "a//b"]) {
    assert.equal(m.excludeFromPackage(bad), false, JSON.stringify(bad));
  }
  assert.equal(m.dirty, false);
});

test("undo does not bring the recordings folder back into the package", () => {
  const m = fresh();
  m.excludeFromPackage("captures");
  m.addLayer();
  assert.equal(m.undo(), true);
  assert.deepEqual(exclude(m), ["captures"], "undoing the author's own work leaves the bookkeeping alone");
  assert.equal(m.undo(), false, "and it is not itself a step to undo");
});

test("a project that already lists things keeps them", () => {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-15" });
  const project = { ...(JSON.parse(files[0]!.text) as object), sourceExclude: ["notes.txt"] };
  const m = new Model({ dir: "D:/x", project: JSON.stringify(project), theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
  m.excludeFromPackage("captures");
  assert.deepEqual(exclude(m), ["notes.txt", "captures"]);
});
