// Where the words of a text start in their box, and shrinking them to fit: what the editor writes, one step to undo, and that the real validator accepts it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-21" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

test("the words can start at the top, the middle or the bottom of the box; the top is how text starts, so nothing is written for it", () => {
  const m = fresh();
  const o = m.addObject("text")!;
  assert.equal(o.style["verticalAlign"], undefined);
  assert.equal(m.setTextVertical(o.id, "middle"), "Words sit in the middle of the box");
  assert.equal(o.style["verticalAlign"], "middle");
  assert.equal(m.setTextVertical(o.id, "bottom"), "Words sit at the bottom of the box");
  assert.equal(o.style["verticalAlign"], "bottom");
  assert.equal(m.setTextVertical(o.id, "bottom"), null, "already so");
  assert.equal(m.setTextVertical(o.id, "top"), "Words start at the top of the box");
  assert.equal("verticalAlign" in o.style, false);
  assert.equal(m.setTextVertical(o.id, "sideways"), null);
});

test("shrinking to fit is switched on and off, and off is how text starts", () => {
  const m = fresh();
  const o = m.addObject("text")!;
  assert.equal(o.style["autoFit"], undefined);
  assert.match(m.setTextFit(o.id, true)!, /^Words shrink to fit the box/);
  assert.equal(o.style["autoFit"], "shrink");
  assert.equal(m.setTextFit(o.id, true), null, "already on");
  assert.match(m.setTextFit(o.id, false)!, /^Words keep their size/);
  assert.equal("autoFit" in o.style, false);
});

test("each change is one step to undo, and the other style is kept", () => {
  const m = fresh();
  const o = m.addObject("text")!;
  m.setStyle(o.id, "color", "#112233");
  m.setTextFit(o.id, true);
  m.setTextVertical(o.id, "middle");
  assert.equal(o.style["color"], "#112233");
  m.undo();
  assert.equal(m.object!.style["verticalAlign"], undefined);
  assert.equal(m.object!.style["autoFit"], "shrink");
  m.undo();
  assert.equal(m.object!.style["autoFit"], undefined);
  assert.equal(m.object!.style["color"], "#112233");
});

test("only a text object takes them", () => {
  const m = fresh();
  const shape = m.addObject("shape")!;
  assert.equal(m.setTextFit(shape.id, true), null);
  assert.equal(m.setTextVertical(shape.id, "middle"), null);
});
