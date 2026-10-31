// Letting a learner enlarge a picture (an image object's content.enlargeable, added in 0.43.0), in the editor.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-31" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

test("a picture can be made enlargeable and ordinary again, and the key is only there while it is on", () => {
  const m = fresh();
  const pic = m.addObject("image", { imageSrc: "assets/images/a.jpg" })!;
  m.setAccessibility(pic.id, { altText: "A chart of the four channels" });
  assert.ok(!("enlargeable" in pic.content), "off to begin with, and off is not written");
  assert.equal(m.setImageEnlargeable(pic.id, true), "Learners can enlarge this picture");
  assert.equal(pic.content["enlargeable"], true);
  assert.equal(m.setImageEnlargeable(pic.id, true), null, "no change, no undo step");
  assert.equal(m.setImageEnlargeable(pic.id, false), "Learners cannot enlarge this picture");
  assert.ok(!("enlargeable" in pic.content));
});

test("a decorative picture cannot be enlarged, and the reason is given", () => {
  const m = fresh();
  const pic = m.addObject("image", { imageSrc: "assets/images/a.jpg" })!;
  m.setAccessibility(pic.id, { decorative: true });
  assert.match(m.setImageEnlargeable(pic.id, true)!, /decorative picture cannot be enlarged/);
  assert.ok(!("enlargeable" in pic.content));
});

test("only a picture can be enlarged, and each change is one undo step", () => {
  const m = fresh();
  const text = m.addObject("text")!;
  assert.equal(m.setImageEnlargeable(text.id, true), null);
  assert.ok(!("enlargeable" in text.content));
  const pic = m.addObject("image", { imageSrc: "assets/images/a.jpg" })!;
  m.setAccessibility(pic.id, { altText: "A chart" });
  m.setImageEnlargeable(pic.id, true);
  assert.equal(m.objects.find((o) => o.id === pic.id)!.content["enlargeable"], true);
  m.undo();
  // Undo puts back the picture as it was, so the object is looked up again rather than trusting the one held from before.
  assert.ok(!("enlargeable" in m.objects.find((o) => o.id === pic.id)!.content));
});
