// Icons and the course actions: what an icon is allowed to be made of, and next, previous and replay.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { cleanShapes, ICON_STROKE, ICON_STROKE_MAX, ICON_STROKE_MIN, strokeWidthOf } from "./icon.ts";
import { examplePackage, newRuntime } from "./test-helpers.ts";
import type { OSObject, Trigger } from "./types.ts";

// ---- what an icon is made of

test("an icon keeps its drawable shapes and their numbers", () => {
  const shapes = cleanShapes([
    { tag: "path", d: "M5 12h14" },
    { tag: "circle", cx: 12, cy: 12, r: 3 },
    { tag: "rect", x: 3, y: 3, width: 18, height: 18, rx: 2 },
    { tag: "polyline", points: "4 12 9 17 20 6" },
    { tag: "line", x1: 0, y1: 0, x2: 5, y2: 5, fill: "none" },
  ]);
  assert.equal(shapes.length, 5);
  assert.deepEqual(shapes[0], { tag: "path", d: "M5 12h14" });
  assert.deepEqual(shapes[1], { tag: "circle", cx: 12, cy: 12, r: 3 });
});

test("anything that is not a drawing tag is left out, whatever the file says", () => {
  assert.deepEqual(cleanShapes([{ tag: "script", d: "alert(1)" }, { tag: "a", href: "javascript:alert(1)" }, { tag: "foreignObject" }, { tag: "image", href: "x" }]), []);
  assert.deepEqual(cleanShapes("not a list"), []);
  assert.deepEqual(cleanShapes([null, 3, "path", [], { nothing: true }]), []);
});

test("attributes that are not on the list are dropped, and the shape is kept without them", () => {
  const [shape] = cleanShapes([{ tag: "path", d: "M0 0L5 5", onclick: "alert(1)", style: "fill:red", href: "x", "stroke-width": 9 }]);
  assert.deepEqual(shape, { tag: "path", d: "M0 0L5 5" });
});

test("path text can only hold path letters and numbers", () => {
  assert.deepEqual(cleanShapes([{ tag: "path", d: "M0 0<script>" }]), [{ tag: "path" }], "the bad text is dropped, the shape stays empty");
  assert.deepEqual(cleanShapes([{ tag: "path", d: "M" + "1".repeat(2001) }]), [{ tag: "path" }]);
  assert.deepEqual(cleanShapes([{ tag: "polygon", points: "1,2 3,4 javascript" }]), [{ tag: "polygon" }]);
});

test("numbers have to be numbers, and fill can only be none or the current colour", () => {
  assert.deepEqual(cleanShapes([{ tag: "circle", cx: "12", cy: Number.NaN, r: Infinity }]), [{ tag: "circle" }]);
  assert.deepEqual(cleanShapes([{ tag: "circle", cx: 1, fill: "red" }]), [{ tag: "circle", cx: 1 }]);
  assert.deepEqual(cleanShapes([{ tag: "circle", cx: 1, fill: "currentColor" }]), [{ tag: "circle", cx: 1, fill: "currentColor" }]);
});

test("an icon has at most 24 parts", () => {
  assert.equal(cleanShapes(Array.from({ length: 40 }, () => ({ tag: "path", d: "M0 0" }))).length, 24);
});

test("the outline width stays between what looks right at any size", () => {
  assert.equal(strokeWidthOf(undefined), ICON_STROKE);
  assert.equal(strokeWidthOf("thick"), ICON_STROKE);
  assert.equal(strokeWidthOf(Number.NaN), ICON_STROKE);
  assert.equal(strokeWidthOf(0), ICON_STROKE_MIN);
  assert.equal(strokeWidthOf(50), ICON_STROKE_MAX);
  assert.equal(strokeWidthOf(1.5), 1.5);
});

test("every icon in the editor's list is drawn in full: nothing is lost on the way", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const list = JSON.parse(readFileSync(path.join(here, "..", "..", "editor", "web", "icons", "lucide.json"), "utf-8")) as { icons: Record<string, { s: unknown[] }> };
  const lost: string[] = [];
  for (const [name, icon] of Object.entries(list.icons)) {
    const kept = cleanShapes(icon.s);
    const sorted = (shapes: unknown[]) => JSON.stringify(shapes.map((x) => Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))));
    if (sorted(kept) !== sorted(icon.s)) lost.push(name);
  }
  assert.deepEqual(lost.slice(0, 5), []);
  assert.ok(Object.keys(list.icons).length > 1000);
});

// ---- next, previous and replay

function packageWith(triggers: Trigger[]) {
  const pkg = examplePackage();
  const obj: OSObject = pkg.slides[0]!.baseLayer.objects[0]!;
  obj.triggers = triggers;
  return pkg;
}

const rule = (id: string, event: Trigger["event"], action: Trigger["action"]): Trigger => ({ id, event, action, target: "", conditions: [] });

test("next goes to the next slide of the course, and previous comes back", () => {
  const { rt, log } = newRuntime(packageWith([]));
  rt.goTo("slide-001");
  rt.currentSlide!.baseLayer.objects[0]!.triggers = [rule("t-1", "click", "nextSlide")];
  rt.fire(rt.currentSlide!.baseLayer.objects[0]!.id, "click");
  assert.equal(rt.currentSlide!.id, "slide-002");
  assert.ok(log.includes("show slide-002"));
  rt.currentSlide!.baseLayer.objects[0]!.triggers = [rule("t-2", "click", "previousSlide")];
  rt.fire(rt.currentSlide!.baseLayer.objects[0]!.id, "click");
  assert.equal(rt.currentSlide!.id, "slide-001");
});

test("next on the last slide and previous on the first go nowhere, and the rules after them still run", () => {
  const pkg = packageWith([]);
  pkg.project.variables.push({ id: "var-x", name: "x", type: "number", initial: 0 });
  const { rt } = newRuntime(pkg);
  rt.goTo("slide-001");
  const first = rt.currentSlide!.baseLayer.objects[0]!;
  first.triggers = [rule("t-1", "click", "previousSlide"), { id: "t-2", event: "click", action: "setVariable", target: "var-x", value: 5, conditions: [] }];
  rt.fire(first.id, "click");
  assert.equal(rt.currentSlide!.id, "slide-001", "there is no slide before the first");
  assert.equal(rt.variables.get("var-x"), 5, "so the next rule ran");
  rt.goTo("slide-002");
  const last = rt.currentSlide!.baseLayer.objects[0]!;
  last.triggers = [rule("t-3", "click", "nextSlide")];
  rt.fire(last.id, "click");
  assert.equal(rt.currentSlide!.id, "slide-002", "there is no slide after the last");
});

test("a rule that moves to another slide ends the list, as a jump does", () => {
  const pkg = packageWith([]);
  pkg.project.variables.push({ id: "var-x", name: "x", type: "number", initial: 0 });
  const { rt } = newRuntime(pkg);
  rt.goTo("slide-001");
  const o = rt.currentSlide!.baseLayer.objects[0]!;
  o.triggers = [rule("t-1", "click", "nextSlide"), { id: "t-2", event: "click", action: "setVariable", target: "var-x", value: 5, conditions: [] }];
  rt.fire(o.id, "click");
  assert.equal(rt.currentSlide!.id, "slide-002");
  assert.equal(rt.variables.get("var-x"), 0, "the rule after the move did not run");
});

test("replay shows the same slide again, as at the start: its opening rules run and its layers close", () => {
  const { rt, log } = newRuntime(packageWith([]));
  rt.goTo("slide-001");
  log.length = 0;
  const o = rt.currentSlide!.baseLayer.objects[0]!;
  o.triggers = [rule("t-1", "click", "replaySlide")];
  rt.fire(o.id, "click");
  assert.equal(rt.currentSlide!.id, "slide-001");
  assert.deepEqual(log.filter((l) => l.startsWith("show")), ["show slide-001"], "the slide was drawn again");
});

test("a condition on a course action is honoured like any other", () => {
  const pkg = packageWith([]);
  pkg.project.variables.push({ id: "var-ok", name: "ok", type: "boolean", initial: false });
  const { rt } = newRuntime(pkg);
  rt.goTo("slide-001");
  const o = rt.currentSlide!.baseLayer.objects[0]!;
  o.triggers = [{ ...rule("t-1", "click", "nextSlide"), conditions: [{ variable: "var-ok", operator: "equals", value: true }] }];
  rt.fire(o.id, "click");
  assert.equal(rt.currentSlide!.id, "slide-001", "not allowed yet");
  rt.setVariable("var-ok", true);
  rt.fire(o.id, "click");
  assert.equal(rt.currentSlide!.id, "slide-002");
});
