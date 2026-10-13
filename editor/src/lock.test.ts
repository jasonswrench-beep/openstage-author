// Locking: a locked object is not moved, resized, rotated or deleted by accident, and is still fully editable otherwise.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Model } from "./model.ts";

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

function three(m: Model): string[] {
  const out: string[] = [];
  for (const [x, y, w] of [[100, 100, 100], [300, 220, 150], [900, 400, 100]] as const) {
    const o = m.addObject("shape")!;
    m.setGeometry(o.id, { x, y, width: w, height: 60 });
    out.push(o.id);
  }
  m.selectObject(null);
  return out;
}

const get = (m: Model, id: string) => m.objects.find((o) => o.id === id)!;

test("lock and unlock: the flag is there when locked and gone when not, never false", () => {
  const m = open();
  const [a] = three(m) as [string];
  m.selectObject(a);
  assert.equal(m.selectionLock, "none");
  assert.equal(m.setLocked(true), `Locked ${get(m, a).name}.`);
  assert.equal(get(m, a).locked, true);
  assert.equal(m.selectionLock, "all");
  assert.match(m.setLocked(true)!, /already locked/);
  m.setLocked(false);
  assert.equal("locked" in get(m, a), false, "an unlocked object carries no flag at all");
  assert.match(m.setLocked(false)!, /already unlocked/);
  m.setLocked(true);
  assert.ok(JSON.stringify(m.slide).includes('"locked":true'));
});

test("toggling locks what is not all locked, and unlocks what is", () => {
  const m = open();
  const [a, b] = three(m) as [string, string, string];
  m.selectObject(a);
  m.toggleSelected(b);
  m.setLocked(true);
  m.selectObject(a);
  m.toggleSelected(b);
  m.setLocked(false);
  m.selectObject(a);
  m.setLocked(true);
  m.toggleSelected(b);
  assert.equal(m.selectionLock, "some");
  m.toggleLock();
  assert.equal(m.selectionLock, "all", "some locked: locking finishes the job");
  m.toggleLock();
  assert.equal(m.selectionLock, "none", "all locked: the same key unlocks");
});

test("locking several is one undo step", () => {
  const m = open();
  const list = three(m);
  m.selectObject(list[0]!);
  m.toggleSelected(list[1]!);
  m.toggleSelected(list[2]!);
  assert.equal(m.setLocked(true), "Locked 3 objects.");
  m.undo();
  for (const id of list) assert.notEqual(get(m, id).locked, true);
});

test("a locked object refuses to move, resize and rotate, with a reason, and still accepts a change of stacking order", () => {
  const m = open();
  const [a] = three(m) as [string];
  m.selectObject(a);
  m.setLocked(true);
  const was = { ...get(m, a).geometry };
  for (const patch of [{ x: 500 }, { y: 500 }, { width: 10 }, { height: 10 }, { rotation: 20 }, { x: 1, y: 1, width: 5 }]) {
    assert.match(m.setGeometry(a, patch)!, /is locked/);
  }
  assert.deepEqual(get(m, a).geometry, was);
  assert.match(m.nudge(5, 5)!, /is locked/);
  assert.match(m.resizeBy(5, 5)!, /is locked/);
  assert.deepEqual(get(m, a).geometry, was);
  assert.match(m.lockMessage(a)!, /Unlock it first/);
  assert.match(String(m.setGeometry(a, { z: 77 })), /, shape, at /, "stacking order is not what a lock protects");
  assert.equal(get(m, a).geometry.z, 77);
});

test("unlocking lets it move again", () => {
  const m = open();
  const [a] = three(m) as [string];
  m.selectObject(a);
  m.setLocked(true);
  m.setLocked(false);
  assert.match(m.nudge(5, 0)!, /at 105, 100/);
});

test("a locked object is still fully editable: its text, name and accessibility are untouched by the lock", () => {
  const m = open();
  const t = m.addObject("text")!;
  m.setLocked(true);
  assert.equal(m.setText(t.id, { block: "p", text: "Still editable" }) !== null, true);
  assert.equal(m.setName(t.id, "Renamed") !== null, true);
  assert.equal(m.setAccessibility(t.id, { altText: "Words" }) !== null, true);
});

test("delete refuses a locked object, with a reason, and changes nothing", () => {
  const m = open();
  const [a] = three(m) as [string];
  m.selectObject(a);
  m.setLocked(true);
  const n = m.objects.length;
  const before = JSON.stringify(m.slides);
  assert.match(m.deleteSelected()!, /is locked/);
  assert.match(m.deleteObject(a)!, /is locked/);
  assert.equal(m.objects.length, n);
  assert.equal(JSON.stringify(m.slides), before, "the refusals changed nothing");
});

test("deleting several leaves the locked ones, keeps them selected, and says so", () => {
  const m = open();
  const list = three(m);
  m.selectObject(list[0]!);
  m.toggleSelected(list[1]!);
  m.toggleSelected(list[2]!);
  m.selectObject(list[1]!);
  m.setLocked(true);
  m.selectObject(list[0]!);
  m.toggleSelected(list[1]!);
  m.toggleSelected(list[2]!);
  const before = m.objects.length;
  const msg = m.deleteSelected()!;
  assert.match(msg, /^Deleted 2 objects\. 1 locked object was kept\.$/);
  assert.equal(m.objects.length, before - 2);
  assert.deepEqual(m.selected.map((o) => o.id), [list[1]!], "the locked one is still selected, ready to be unlocked");
  m.undo();
  assert.equal(m.objects.length, before);
});

test("deleting a selection that is all locked deletes nothing", () => {
  const m = open();
  const [a, b] = three(m) as [string, string, string];
  m.selectObject(a);
  m.toggleSelected(b);
  m.setLocked(true);
  const n = m.objects.length;
  assert.match(m.deleteSelected()!, /All 2 selected objects are locked/);
  assert.equal(m.objects.length, n);
});

test("cut refuses a locked object, and copy does not", () => {
  const m = open();
  const [a] = three(m) as [string];
  m.selectObject(a);
  m.setLocked(true);
  const n = m.objects.length;
  assert.match(m.cut()!, /is locked, so it cannot be cut/);
  assert.equal(m.objects.length, n);
  assert.equal(m.canPaste, false, "a refused cut copies nothing");
  assert.match(m.copy()!, /^Copied /);
  assert.equal(m.canPaste, true);
});

test("a copy of a locked object is not locked, and the original is", () => {
  const m = open();
  const [a] = three(m) as [string];
  m.selectObject(a);
  m.setLocked(true);
  m.duplicate();
  const copy = m.object!;
  assert.notEqual(copy.id, a);
  assert.equal("locked" in copy, false);
  assert.equal(get(m, a).locked, true);
  m.copy();
  m.paste();
  assert.equal("locked" in m.object!, false);
});

test("moving several together leaves the locked ones where they are, and says so", () => {
  const m = open();
  const list = three(m);
  m.selectObject(list[1]!);
  m.setLocked(true);
  m.selectObject(list[0]!);
  m.toggleSelected(list[1]!);
  m.toggleSelected(list[2]!);
  const x1 = get(m, list[1]!).geometry.x;
  const msg = m.nudge(10, 0)!;
  assert.equal(get(m, list[0]!).geometry.x, 110);
  assert.equal(get(m, list[2]!).geometry.x, 910);
  assert.equal(get(m, list[1]!).geometry.x, x1, "the locked one did not move");
  assert.match(msg, /^2 objects, at 110, 100\. 1 locked object stayed where it was\.$/);
  m.toggleSelected(list[0]!);
  m.toggleSelected(list[2]!);
  assert.match(m.nudge(10, 0)!, /is locked/);
});

test("all selected locked: nothing moves and the message says why", () => {
  const m = open();
  const [a, b] = three(m) as [string, string, string];
  m.selectObject(a);
  m.toggleSelected(b);
  m.setLocked(true);
  assert.match(m.nudge(5, 5)!, /All 2 selected objects are locked/);
});

test("lining up leaves a locked object where it is, and lines up the rest by the edge of all of them", () => {
  const m = open();
  const list = three(m);
  m.selectObject(list[1]!);
  m.setLocked(true);
  m.selectObject(list[0]!);
  m.toggleSelected(list[1]!);
  m.toggleSelected(list[2]!);
  const r = m.align("left")!;
  assert.equal(r.changed, true);
  assert.match(r.message, /1 locked object stayed where it was\.$/);
  assert.equal(get(m, list[1]!).geometry.x, 300, "the locked one stayed");
  assert.equal(get(m, list[0]!).geometry.x, 100);
  assert.equal(get(m, list[2]!).geometry.x, 100, "the others lined up to the left edge of the whole selection");
});

test("a locked object that is already in place is not reported as held back", () => {
  const m = open();
  const list = three(m);
  m.selectObject(list[0]!);
  m.setLocked(true);
  m.selectObject(list[0]!);
  m.toggleSelected(list[1]!);
  const r = m.align("left")!;
  assert.equal(r.changed, true);
  assert.doesNotMatch(r.message, /locked/);
});

test("lining up when the only object that needs to move is locked changes nothing and says so", () => {
  const m = open();
  const list = three(m);
  m.selectObject(list[2]!);
  m.setLocked(true);
  m.selectObject(list[0]!);
  m.toggleSelected(list[2]!);
  const r = m.align("left")!;
  assert.equal(r.changed, false);
  assert.match(r.message, /1 locked object would have had to move, so nothing changed/);
  assert.equal(get(m, list[2]!).geometry.x, 900);
  m.selectObject(list[2]!);
  const one = m.align("left")!;
  assert.equal(one.changed, false);
  assert.match(one.message, /is locked/);
});

test("spacing out leaves locked objects where they are and says so", () => {
  const m = open();
  const list = three(m);
  m.selectObject(list[1]!);
  m.setLocked(true);
  m.selectObject(list[0]!);
  m.toggleSelected(list[1]!);
  m.toggleSelected(list[2]!);
  const x = get(m, list[1]!).geometry.x;
  const r = m.distribute("horizontal")!;
  assert.equal(get(m, list[1]!).geometry.x, x);
  assert.equal(r.changed, false, "the middle one was the only one that had to move, and it is locked");
  assert.match(r.message, /locked/);
});

test("a lock survives a save and a reload, and the slide file has the flag", () => {
  const m = open();
  const [a] = three(m) as [string];
  m.selectObject(a);
  m.setLocked(true);
  const file = m.allFiles().find((f) => f.path === "slides/slide-001.json")!;
  const reopened = new Model({
    dir: "D:/x",
    project: JSON.stringify(m.project),
    theme: text("theme.json"),
    slides: [
      { id: "slide-001", text: file.text },
      { id: "slide-002", text: text("slides/slide-002.json") },
    ],
  });
  assert.equal(reopened.slides[0]!.baseLayer.objects.find((o) => o.id === a)!.locked, true);
});
