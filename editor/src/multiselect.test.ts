// Choosing several objects, and what you can do with them together.
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

/** Three shapes in a row on the first slide, with places of their own, and nothing else selected. */
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

const ids = (m: Model) => m.selected.map((o) => o.id);

test("adding to the selection and taking away from it", () => {
  const m = open();
  const [a, b, c] = three(m) as [string, string, string];
  m.selectObject(a);
  assert.match(m.toggleSelected(c)!, /2 objects selected/);
  assert.deepEqual(ids(m), [a, c], "in reading order, whichever was chosen first");
  assert.equal(m.object!.id, c, "the one added last is the main one");
  m.toggleSelected(b);
  assert.deepEqual(ids(m), [a, b, c]);
  m.toggleSelected(c);
  assert.deepEqual(ids(m), [a, b]);
  assert.notEqual(m.object!.id, c, "taking out the main one gives the job to another");
  m.toggleSelected(a);
  m.toggleSelected(b);
  assert.deepEqual(ids(m), [], "taking out the last one clears the selection");
  assert.equal(m.object, null);
});

test("choosing one object ends a selection of several, even if it was already the main one", () => {
  const m = open();
  const [a, b] = three(m) as [string, string, string];
  m.selectObject(a);
  m.toggleSelected(b);
  assert.equal(m.selected.length, 2);
  m.selectObject(b);
  assert.deepEqual(ids(m), [b]);
  m.toggleSelected(a);
  m.selectObject(a);
  assert.deepEqual(ids(m), [a]);
});

test("a range runs from where the selection began, and keeps its start when it is stretched", () => {
  const m = open();
  const list = three(m);
  const order = m.objects.map((o) => o.id);
  m.selectObject(order[0]!);
  m.selectRange(order[2]!);
  assert.deepEqual(ids(m), order.slice(0, 3));
  m.selectRange(order[1]!);
  assert.deepEqual(ids(m), order.slice(0, 2), "the start stayed where it was, so the range shrank");
  assert.ok(list.length === 3);
});

test("select all takes every object on the layer, and says so, and says when there are none", () => {
  const m = open();
  three(m);
  const n = m.objects.length;
  assert.match(m.selectAll(), new RegExp(`^${n} objects selected`));
  assert.equal(m.selected.length, n);
  m.selectSlide("slide-002");
  m.addLayer();
  assert.match(m.selectAll(), /nothing on this layer/);
});

test("extending the selection adds the next or the previous object", () => {
  const m = open();
  three(m);
  const order = m.objects.map((o) => o.id);
  m.selectObject(order[1]!);
  m.extendSelection(1);
  assert.deepEqual(ids(m), order.slice(1, 3));
  m.extendSelection(-1);
  assert.deepEqual(ids(m), order.slice(0, 3), "the one before the first selected");
  m.selectObject(order[order.length - 1]!);
  assert.match(m.extendSelection(1)!, /last object is already selected/);
  m.selectObject(order[0]!);
  assert.match(m.extendSelection(-1)!, /first object is already selected/);
});

test("changing slide or layer ends the selection, and it does not come back", () => {
  const m = open();
  const [a, b] = three(m) as [string, string, string];
  m.selectObject(a);
  m.toggleSelected(b);
  m.selectSlide("slide-002");
  m.selectSlide("slide-001");
  assert.deepEqual(ids(m), []);
  m.selectObject(a);
  assert.deepEqual(ids(m), [a], "choosing the old main object again does not bring the others back");
});

test("a new object added while several are selected is chosen alone", () => {
  const m = open();
  const [a, b] = three(m) as [string, string, string];
  m.selectObject(a);
  m.toggleSelected(b);
  const added = m.addObject("shape")!;
  assert.deepEqual(ids(m), [added.id]);
});

test("the arrow keys move all the selected objects, and one undo puts them back", () => {
  const m = open();
  const list = three(m);
  const before = list.map((id) => ({ ...m.objects.find((o) => o.id === id)!.geometry }));
  m.selectObject(list[0]!);
  m.toggleSelected(list[1]!);
  m.toggleSelected(list[2]!);
  const msg = m.nudge(10, 5)!;
  assert.match(msg, /^3 objects, at /);
  list.forEach((id, i) => {
    const g = m.objects.find((o) => o.id === id)!.geometry;
    assert.deepEqual([g.x, g.y], [before[i]!.x + 10, before[i]!.y + 5]);
  });
  m.nudge(10, 5);
  m.undo();
  list.forEach((id, i) => {
    const g = m.objects.find((o) => o.id === id)!.geometry;
    assert.deepEqual([g.x, g.y], [before[i]!.x, before[i]!.y], "two quick presses are one undo step, for all of them");
  });
});

test("resizing works on one object at a time, and says so", () => {
  const m = open();
  const [a, b] = three(m) as [string, string, string];
  m.selectObject(a);
  m.toggleSelected(b);
  const w = m.objects.find((o) => o.id === a)!.geometry.width;
  assert.match(m.resizeBy(5, 5)!, /one object at a time/);
  assert.equal(m.objects.find((o) => o.id === a)!.geometry.width, w);
});

test("delete removes every selected object as one undo step, and the tab order has no gaps", () => {
  const m = open();
  const list = three(m);
  const total = m.objects.length;
  m.selectObject(list[0]!);
  m.toggleSelected(list[2]!);
  assert.equal(m.deleteSelected(), "Deleted 2 objects");
  assert.equal(m.objects.length, total - 2);
  assert.equal(m.object, null);
  const tabbed = m.objects.filter((o) => (o.accessibility.tabOrder ?? 0) >= 1);
  assert.deepEqual(tabbed.map((o) => o.accessibility.tabOrder), tabbed.map((_, i) => i + 1));
  m.undo();
  assert.equal(m.objects.length, total);
});

test("one selected object is deleted as before, and nothing selected does nothing", () => {
  const m = open();
  const list = three(m);
  m.selectObject(list[1]!);
  assert.match(m.deleteSelected()!, /^Deleted /);
  assert.equal(m.deleteSelected(), null);
});

test("copy and paste take all the selected objects, select the copies, and keep them tied to each other", () => {
  const m = open();
  const video = m.addMedia("video", "assets/v.mp4")!;
  const button = m.addObject("button")!;
  m.addRule(button.id);
  m.updateRule(button.id, 0, { action: "playMedia", target: video.id });
  m.selectObject(video.id);
  m.toggleSelected(button.id);
  const before = m.objects.length;
  assert.equal(m.copy(), "Copied 2 objects.");
  const msg = m.paste()!;
  assert.match(msg, /^Pasted 2 objects\./);
  assert.equal(m.objects.length, before + 2);
  assert.equal(m.selected.length, 2, "the copies are selected");
  const pastedVideo = m.selected.find((o) => o.type === "video")!;
  const pastedButton = m.selected.find((o) => o.type === "button")!;
  assert.notEqual(pastedVideo.id, video.id);
  assert.ok(pastedButton.triggers.length > 0);
  assert.ok(pastedButton.triggers.every((t) => t.target === pastedVideo.id), "the copied button plays the copied video, not the first one");
  assert.ok(button.triggers.every((t) => t.target === video.id), "and the first button still plays the first video");
  m.undo();
  assert.equal(m.objects.length, before);
});

test("duplicate takes all the selected objects and puts the copies after the last of them in reading order", () => {
  const m = open();
  const list = three(m);
  const order = m.objects.map((o) => o.id);
  m.selectObject(order[0]!);
  m.toggleSelected(order[1]!);
  const before = m.objects.length;
  assert.match(m.duplicate()!, /^Duplicated 2 objects\./);
  assert.equal(m.objects.length, before + 2);
  const copies = m.selected.map((o) => o.id);
  const after = m.objects.map((o) => o.id);
  assert.deepEqual(after.slice(2, 4), copies, "straight after the second original, together");
  assert.ok(list.length === 3);
});

test("cut removes all of them and paste brings them back", () => {
  const m = open();
  const list = three(m);
  m.selectObject(list[0]!);
  m.toggleSelected(list[1]!);
  const before = m.objects.length;
  assert.equal(m.cut(), "Cut 2 objects.");
  assert.equal(m.objects.length, before - 2);
  m.paste();
  assert.equal(m.objects.length, before);
});

test("aligning two or more lines them up with each other, as one undo step", () => {
  const m = open();
  const list = three(m);
  m.selectObject(list[0]!);
  m.toggleSelected(list[1]!);
  m.toggleSelected(list[2]!);
  const result = m.align("left")!;
  assert.equal(result.changed, true);
  assert.match(result.message, /^Lined up 3 objects by their left edges/);
  for (const id of list) assert.equal(m.objects.find((o) => o.id === id)!.geometry.x, 100);
  assert.equal(m.objects.find((o) => o.id === list[1]!)!.geometry.y, 220, "the other direction is untouched");
  assert.equal(m.objects.find((o) => o.id === list[1]!)!.geometry.width, 150, "and so are sizes");
  const again = m.align("left")!;
  assert.equal(again.changed, false);
  assert.match(again.message, /already lined up/);
  m.undo();
  assert.equal(m.objects.find((o) => o.id === list[2]!)!.geometry.x, 900);
});

test("one object aligns with the slide", () => {
  const m = open();
  const list = three(m);
  m.selectObject(list[1]!);
  const result = m.align("centre")!;
  assert.match(result.message, /to the centre of the slide/);
  const g = m.objects.find((o) => o.id === list[1]!)!.geometry;
  assert.equal(g.x, (m.project.stage.width - g.width) / 2);
  assert.match(m.align("centre")!.message, /already there/);
});

test("spacing out needs three, makes equal gaps, and is one undo step", () => {
  const m = open();
  const list = three(m);
  m.selectObject(list[0]!);
  m.toggleSelected(list[1]!);
  const few = m.distribute("horizontal")!;
  assert.equal(few.changed, false);
  assert.match(few.message, /three or more/);
  m.toggleSelected(list[2]!);
  const spaced = m.distribute("horizontal")!;
  assert.equal(spaced.changed, true);
  assert.match(spaced.message, /^Spaced 3 objects evenly across/);
  const g = list.map((id) => m.objects.find((o) => o.id === id)!.geometry);
  const first = g[0]!, mid = g[1]!, last = g[2]!;
  assert.equal(first.x, 100);
  assert.equal(last.x, 900);
  assert.ok(Math.abs(mid.x - (first.x + first.width) - (last.x - (mid.x + mid.width))) < 0.01, "the two gaps are the same");
  assert.match(m.distribute("horizontal")!.message, /already spaced evenly/);
  m.undo();
  assert.equal(m.objects.find((o) => o.id === list[1]!)!.geometry.x, 300);
});

test("nothing selected: align, distribute, nudge, copy and delete do nothing", () => {
  const m = open();
  three(m);
  assert.equal(m.align("left"), null);
  assert.equal(m.distribute("vertical"), null);
  assert.equal(m.nudge(1, 1), null);
  assert.equal(m.copy(), null);
  assert.equal(m.deleteSelected(), null);
});

test("a drag is one undo step, the window is told so, and it ends anything that could be redone", () => {
  const m = open();
  const first = m.objects[0]!;
  m.selectObject(first.id);
  m.nudge(1, 1);
  m.undo();
  assert.equal(m.canRedo, true);
  const x = m.objects.find((o) => o.id === first.id)!.geometry.x; // undo replaces the objects, so look it up again
  m.beginGesture();
  m.setGeometry(first.id, { x: x + 40 });
  m.setGeometry(first.id, { x: x + 80 });
  let told = false;
  m.on(() => { if (m.canUndo) told = true; });
  m.endGesture();
  assert.equal(told, true, "the Undo button hears that there is now something to undo");
  assert.equal(m.canRedo, false, "a new change ends the redo list, as every other change does");
  m.undo();
  assert.equal(m.objects.find((o) => o.id === first.id)!.geometry.x, x, "one undo takes back the whole drag");
});
