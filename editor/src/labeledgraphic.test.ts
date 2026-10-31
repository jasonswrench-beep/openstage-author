// A labeled graphic (an interaction of kind labeledGraphic, added in 0.44.0), in the editor: adding one, choosing its picture, and placing its markers.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { InteractionContent } from "../../player/src/types.ts";
import { defaultMarker } from "./factory.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-31" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}
const content = (m: Model, id: string) => m.objects.find((o) => o.id === id)!.content as unknown as InteractionContent;

test("a new labeled graphic has three markers on the picture, none on another, and no picture yet", () => {
  const m = fresh();
  const o = m.addInteraction("labeledGraphic:horizontal")!;
  const c = content(m, o.id);
  assert.equal(c.kind, "labeledGraphic");
  assert.deepEqual(c.graphic, { src: "", alt: "" }, "the author chooses the picture");
  assert.equal(c.items.length, 3);
  for (const item of c.items) assert.ok(item.x! >= 0 && item.x! <= 100 && item.y! >= 0 && item.y! <= 100);
  assert.equal(new Set(c.items.map((i) => `${i.x},${i.y}`)).size, 3, "no two markers start in the same place");
});

test("the starting places keep up to twelve markers on the picture and apart", () => {
  const places = Array.from({ length: 12 }, (_, i) => defaultMarker(i));
  for (const p of places) assert.ok(p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100);
  for (let i = 0; i < places.length; i++) {
    for (let j = i + 1; j < places.length; j++) {
      assert.ok(Math.abs(places[i]!.x - places[j]!.x) >= 5 || Math.abs(places[i]!.y - places[j]!.y) >= 5, `markers ${i + 1} and ${j + 1} do not overlap`);
    }
  }
});

test("the picture is chosen, keeps its alt text when changed, and the alt text is set", () => {
  const m = fresh();
  const o = m.addInteraction("labeledGraphic:horizontal")!;
  assert.match(m.setGraphic(o.id, "assets/images/a.png")!, /Picture chosen/);
  assert.equal(content(m, o.id).graphic!.src, "assets/images/a.png");
  assert.equal(m.setGraphicAlt(o.id, "A diagram of the model"), "Alt text updated");
  assert.equal(m.setGraphicAlt(o.id, "A diagram of the model"), null, "no change, no undo step");
  m.setGraphic(o.id, "assets/images/b.png");
  assert.deepEqual(content(m, o.id).graphic, { src: "assets/images/b.png", alt: "A diagram of the model" }, "a new picture keeps the words, which the author checks");
  assert.equal(m.setGraphic(o.id, ""), null, "no picture is not a choice");
});

test("a marker is moved to a place on the picture, kept inside it and to a tenth of a percent", () => {
  const m = fresh();
  const o = m.addInteraction("labeledGraphic:horizontal")!;
  const id = content(m, o.id).items[1]!.id;
  assert.match(m.setItemPosition(o.id, id, 40.04, 61.26)!, /Marker 2 is 40 percent across and 61.3 percent down/);
  assert.deepEqual([content(m, o.id).items[1]!.x, content(m, o.id).items[1]!.y], [40, 61.3]);
  m.setItemPosition(o.id, id, -20, 250);
  assert.deepEqual([content(m, o.id).items[1]!.x, content(m, o.id).items[1]!.y], [0, 100], "a click past the edge puts it on the edge");
  assert.equal(m.setItemPosition(o.id, id, 0, 100), null, "no change, no undo step");
  assert.equal(m.setItemPosition(o.id, id, Number.NaN, 5), null);
  assert.equal(m.setItemPosition(o.id, "item-nope", 5, 5), null);
});

test("only a labeled graphic has a picture and places", () => {
  const m = fresh();
  const tabs = m.addInteraction("tabs:horizontal")!;
  const id = content(m, tabs.id).items[0]!.id;
  assert.equal(m.setGraphic(tabs.id, "assets/images/a.png"), null);
  assert.equal(m.setGraphicAlt(tabs.id, "x"), null);
  assert.equal(m.setItemPosition(tabs.id, id, 5, 5), null);
  assert.ok(!("graphic" in content(m, tabs.id)));
});

test("turning another kind into a labeled graphic gives it a picture to choose and a place for each marker, and an added item gets a place too", () => {
  const m = fresh();
  const o = m.addInteraction("tabs:horizontal")!;
  assert.equal(m.setInteractionKind(o.id, "labeledGraphic"), "Changed to labeledGraphic");
  const c = content(m, o.id);
  assert.deepEqual(c.graphic, { src: "", alt: "" });
  assert.ok(c.items.every((i) => typeof i.x === "number" && typeof i.y === "number"));
  m.addItem(o.id);
  const added = content(m, o.id).items[3]!;
  assert.deepEqual([added.x, added.y], [defaultMarker(3).x, defaultMarker(3).y]);
});

test("a labeled graphic takes one to twelve markers", () => {
  const m = fresh();
  const o = m.addInteraction("labeledGraphic:horizontal")!;
  for (let i = 0; i < 9; i++) assert.match(m.addItem(o.id)!, /^Added item/);
  assert.match(m.addItem(o.id)!, /at most 12/);
});

test("placing a marker is one undo step", () => {
  const m = fresh();
  const o = m.addInteraction("labeledGraphic:horizontal")!;
  const before = { ...content(m, o.id).items[0]! };
  m.setItemPosition(o.id, before.id, 77, 66);
  m.undo();
  const after = content(m, o.id).items[0]!;
  assert.deepEqual([after.x, after.y], [before.x, before.y]);
});
