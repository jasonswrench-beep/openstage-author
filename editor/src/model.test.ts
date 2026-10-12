// Run with: npm test   (from the editor folder)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { canonical, Model } from "./model.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const proj = path.join(here, "..", "..", "examples", "minimal.osproj");
const text = (rel: string) => readFileSync(path.join(proj, rel), "utf-8");

function open(): Model {
  return new Model({
    dir: "D:/x",
    project: text("project.json"),
    theme: text("theme.json"),
    slides: [
      { id: "slide-001", text: text("slides/slide-001.json") },
      { id: "slide-002", text: text("slides/slide-002.json") },
    ],
  });
}

test("opens at the first slide's base layer with nothing selected", () => {
  const m = open();
  assert.deepEqual(m.sel, { slideId: "slide-001", layerId: "layer-base", objectId: null });
  assert.equal(m.slides.length, 2);
  assert.equal(m.dirty, false);
});

test("objects are listed in reading order", () => {
  const m = open();
  assert.deepEqual(m.objects.map((o) => o.id), ["obj-0001", "obj-0002", "obj-0004", "obj-0003"]);
});

test("selecting slides, layers and objects", () => {
  const m = open();
  m.selectObject("obj-0004");
  assert.equal(m.object?.name, "Continue");
  m.selectObject("nope");
  assert.equal(m.object?.name, "Continue", "an unknown id changes nothing");
  m.selectSlide("slide-002");
  assert.equal(m.sel.objectId, null, "changing slide clears the object");
  m.selectLayer("layer-retry");
  assert.equal(m.layer?.name, "Retry feedback");
});

test("reveal jumps straight to an object on another slide and layer", () => {
  const m = open();
  assert.equal(m.reveal("slide-002", "obj-0021"), true);
  assert.deepEqual(m.sel, { slideId: "slide-002", layerId: "layer-retry", objectId: "obj-0021" });
  assert.equal(m.reveal("slide-002", "obj-missing"), false);
});

test("nudging moves the object and marks the project changed", () => {
  const m = open();
  m.selectObject("obj-0001");
  const msg = m.nudge(10, -5);
  assert.equal(m.object?.geometry.x, 90);
  assert.equal(m.object?.geometry.y, 67);
  assert.match(msg ?? "", /Heading, text, at 90, 67/);
  assert.equal(m.dirty, true);
});

test("a run of nudges is one undo step", () => {
  const m = open();
  m.selectObject("obj-0001");
  for (let i = 0; i < 5; i++) m.nudge(1, 0);
  assert.equal(m.object?.geometry.x, 85);
  assert.ok(m.undo());
  assert.equal(m.object?.geometry.x, 80);
  assert.equal(m.canUndo, false);
  assert.ok(m.redo());
  assert.equal(m.object?.geometry.x, 85);
});

test("undoing back to the start is clean again, even though formatting differs", () => {
  const m = open();
  m.selectObject("obj-0001");
  m.nudge(3, 3);
  assert.equal(m.dirty, true);
  m.undo();
  assert.equal(m.dirty, false);
  assert.deepEqual(m.dirtyFiles(), []);
});

test("a drag is a single undo step however many moves it has", () => {
  const m = open();
  m.selectObject("obj-0001");
  m.beginGesture();
  for (let i = 1; i <= 20; i++) m.setGeometry("obj-0001", { x: 80 + i });
  m.endGesture();
  assert.equal(m.object?.geometry.x, 100);
  m.undo();
  assert.equal(m.object?.geometry.x, 80);
});

test("resizing never goes below one pixel", () => {
  const m = open();
  m.selectObject("obj-0003");
  m.resizeBy(-1000, -1000);
  assert.equal(m.object?.geometry.width, 1);
  assert.equal(m.object?.geometry.height, 1);
});

test("bad geometry values are refused", () => {
  const m = open();
  m.selectObject("obj-0001");
  assert.equal(m.setGeometry("obj-0001", { x: Number.NaN }), null);
  assert.equal(m.setGeometry("obj-0001", { width: -4 }), null);
  assert.equal(m.object?.geometry.x, 80);
  assert.equal(m.dirty, false);
});

test("accessibility fields change, and nothing is filled in silently", () => {
  const m = open();
  m.selectObject("obj-0003"); // the decorative accent bar
  m.setAccessibility("obj-0003", { decorative: false });
  assert.equal(m.object?.accessibility.decorative, false);
  assert.equal(m.object?.accessibility.altText, "", "alt text is left empty for the author to write");
  assert.equal(m.setAccessibility("obj-0003", { tabOrder: -1 }), null);
  assert.equal(m.setAccessibility("obj-0003", { tabOrder: 1.5 }), null);
  assert.ok(m.setAccessibility("obj-0003", { tabOrder: null }) !== undefined);
});

test("moving an object up in reading order renumbers the tab order", () => {
  const m = open();
  m.selectObject("obj-0004"); // Continue, tab order 3
  const msg = m.reorder("obj-0004", -1);
  assert.match(msg ?? "", /number 2 of 3/);
  assert.deepEqual(m.objects.map((o) => o.id), ["obj-0001", "obj-0004", "obj-0002", "obj-0003"]);
  assert.deepEqual(m.objects.filter((o) => (o.accessibility.tabOrder ?? 0) > 0).map((o) => o.accessibility.tabOrder), [1, 2, 3]);
});

test("reordering explains itself at the ends and for objects outside the tab order", () => {
  const m = open();
  assert.match(m.reorder("obj-0001", -1) ?? "", /already first/);
  assert.match(m.reorder("obj-0004", 1) ?? "", /already last/);
  assert.match(m.reorder("obj-0003", -1) ?? "", /not in the tab order/);
  assert.equal(m.dirty, false);
});

test("saving writes only the slides that changed, in canonical form", () => {
  const m = open();
  m.selectObject("obj-0001");
  m.nudge(1, 0);
  const files = m.dirtyFiles();
  assert.deepEqual(files.map((f) => f.path), ["slides/slide-001.json"]);
  assert.equal(files[0]!.text, canonical(m.slides[0]));
  assert.ok(files[0]!.text.endsWith("}\n"));
  m.markSaved(files);
  assert.equal(m.dirty, false);
  assert.deepEqual(m.dirtyFiles(), []);
});

test("an unchanged project saves nothing, so files stay byte-identical", () => {
  const m = open();
  m.selectObject("obj-0001");
  m.selectSlide("slide-002");
  assert.deepEqual(m.dirtyFiles(), []);
});

test("validation gets every file, using the original text for unchanged ones", () => {
  const m = open();
  m.selectObject("obj-0001");
  m.nudge(1, 0);
  const all = m.allFiles();
  assert.deepEqual(all.map((f) => f.path), ["project.json", "theme.json", "slides/slide-001.json", "slides/slide-002.json"]);
  assert.equal(all[0]!.text, text("project.json"));
  assert.equal(all[3]!.text, text("slides/slide-002.json"));
  assert.notEqual(all[2]!.text, text("slides/slide-001.json"));
});

test("undoing a move keeps the object selected", () => {
  const m = open();
  m.selectObject("obj-0001");
  m.nudge(1, 0);
  m.undo();
  assert.equal(m.sel.objectId, "obj-0001");
});
