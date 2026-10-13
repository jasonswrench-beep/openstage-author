// Duplicate, copy, cut and paste: a copy is its own object, with its own ids, variables and feedback layers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { copyName } from "./clone.ts";
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

const allIds = (m: Model): string[] => m.slides.flatMap((s) => [s.baseLayer, ...s.layers].flatMap((l) => l.objects.map((o) => o.id)));
const allTriggerIds = (m: Model): string[] => m.slides.flatMap((s) => [s.baseLayer, ...s.layers].flatMap((l) => l.objects.flatMap((o) => o.triggers.map((t) => t.id))));
const unique = (ids: string[]): boolean => new Set(ids).size === ids.length;

test("copyName says copy, then copy 2, and never repeats a name", () => {
  assert.equal(copyName("Title", []), "Title copy");
  assert.equal(copyName("Title", ["Title copy"]), "Title copy 2");
  assert.equal(copyName("Title copy", ["Title", "Title copy"]), "Title copy 2", "a copy of a copy is a copy of the first");
  assert.equal(copyName("Title copy 2", ["Title copy 2", "Title copy"]), "Title copy 3");
  assert.equal(copyName("Title", ["title COPY"]), "Title copy 2", "names are compared without regard to capitals");
});

test("duplicate makes a separate object beside the original, on top, selected, straight after it in reading order", () => {
  const m = open();
  m.addObject("text");
  const original = m.addObject("button")!;
  m.addObject("shape");
  m.selectObject(original.id);
  const before = m.objects.length;
  const topZ = Math.max(...m.objects.map((o) => o.geometry.z));
  const msg = m.duplicate()!;
  const copy = m.object!;
  assert.match(msg, /^Duplicated /);
  assert.notEqual(copy.id, original.id);
  assert.equal(m.objects.length, before + 1);
  assert.ok(unique(allIds(m)), "every object id in the project is still its own");
  assert.equal(copy.name, `${original.name} copy`);
  assert.deepEqual([copy.geometry.x, copy.geometry.y], [original.geometry.x + 20, original.geometry.y + 20]);
  assert.equal(copy.geometry.width, original.geometry.width);
  assert.ok(copy.geometry.z > topZ, "the copy is drawn above everything");
  const tabbed = m.objects.filter((o) => (o.accessibility.tabOrder ?? 0) >= 1);
  assert.deepEqual(tabbed.map((o) => o.accessibility.tabOrder), tabbed.map((_, i) => i + 1), "the tab order has no gaps or repeats");
  assert.equal(tabbed.findIndex((o) => o.id === copy.id), tabbed.findIndex((o) => o.id === original.id) + 1, "the copy comes straight after the original");
});

test("a copy shares nothing with its original: editing one leaves the other alone", () => {
  const m = open();
  const original = m.addObject("text")!;
  m.setText(original.id, { block: "p", text: "First words" });
  m.duplicate();
  const copy = m.object!;
  m.setText(copy.id, { block: "p", text: "Different words" });
  m.setGeometry(copy.id, { x: 5 });
  m.selectObject(original.id);
  assert.match(String(m.object!.content["html"]), /First words/);
  assert.notEqual(m.object!.geometry.x, 5);
  assert.notEqual(m.object!.style, copy.style, "style is its own object too");
});

test("duplicating twice gives copy and then copy 2", () => {
  const m = open();
  const original = m.addObject("shape")!;
  m.duplicate();
  m.selectObject(original.id);
  m.duplicate();
  const names = m.objects.map((o) => o.name);
  assert.ok(names.includes(`${original.name} copy`));
  assert.ok(names.includes(`${original.name} copy 2`));
});

test("one undo takes a duplicate away, and the original is where it was", () => {
  const m = open();
  const original = m.addObject("text")!;
  const before = m.objects.length;
  const at = { ...original.geometry };
  m.duplicate();
  assert.equal(m.undo(), true);
  assert.equal(m.objects.length, before);
  assert.deepEqual(m.objects.find((o) => o.id === original.id)!.geometry, at);
});

test("nothing selected: duplicate, copy and cut do nothing", () => {
  const m = open();
  m.selectObject(null);
  const before = JSON.stringify(m.slides);
  assert.equal(m.duplicate(), null);
  assert.equal(m.copy(), null);
  assert.equal(m.cut(), null);
  assert.equal(JSON.stringify(m.slides), before);
  assert.equal(m.canPaste, false);
});

test("an image's alt text is copied and the author is told to check it", () => {
  const m = open();
  const image = m.addObject("image", { imageSrc: "assets/a.svg" })!;
  m.setAccessibility(image.id, { altText: "A red circle", decorative: false });
  const msg = m.duplicate()!;
  assert.equal(m.object!.accessibility.altText, "A red circle", "copied, not made up and not blanked");
  assert.match(msg, /alt text was copied/i);
  const text = m.addObject("text")!;
  m.selectObject(text.id);
  assert.doesNotMatch(m.duplicate()!, /alt text/i, "text needs no such reminder");
});

test("a copy of an input saves to variables of its own, of the same kind, and one undo removes them too", () => {
  const m = open();
  const radio = m.addInput("radio")!;
  const own = (radio.content as { variable: string }).variable;
  const vars = m.variables.length;
  const msg = m.duplicate()!;
  const copy = m.object!;
  const mine = (copy.content as { variable: string }).variable;
  assert.notEqual(mine, own);
  assert.equal(m.variables.length, vars + 1);
  assert.equal(m.variables.find((v) => v.id === mine)!.type, m.variables.find((v) => v.id === own)!.type);
  assert.equal((m.objects.find((o) => o.id === radio.id)!.content as { variable: string }).variable, own, "the original still saves where it did");
  assert.match(msg, /variable of its own/);
  m.undo();
  assert.equal(m.variables.length, vars, "undo removes the new variable as well");

  const boxes = m.addInput("checkbox")!;
  const used = (boxes.content as { items: { variable: string }[] }).items.map((i) => i.variable);
  m.duplicate();
  const fresh = (m.object!.content as { items: { variable: string }[] }).items.map((i) => i.variable);
  assert.equal(fresh.length, used.length);
  assert.ok(fresh.every((v) => !used.includes(v)), "every checkbox of the copy has its own variable");
  assert.ok(unique(fresh));
});

test("a copy of a quiz question has feedback layers of its own, and says it is another question", () => {
  const m = open();
  const question = m.addQuiz("mc")!;
  const slide = m.slide!;
  const layersBefore = slide.layers.length;
  const was = (question.content as { feedback: { correct: string; incorrect: string } }).feedback;
  const msg = m.duplicate()!;
  const copy = m.object!;
  const now = (copy.content as { feedback: { correct: string; incorrect: string } }).feedback;
  assert.equal(slide.layers.length, layersBefore + 2);
  assert.notEqual(now.correct, was.correct);
  assert.notEqual(now.incorrect, was.incorrect);
  const layer = slide.layers.find((l) => l.id === now.correct)!;
  assert.match(layer.name, /^Correct feedback for /);
  assert.ok(layer.objects.length > 0, "the feedback text came with the layer");
  assert.ok(unique(allIds(m)));
  assert.match(msg, /counts toward the score/);
  assert.equal(slide.layers.find((l) => l.id === was.correct)!.objects.length, layer.objects.length, "the original's layer is untouched");
});

test("rules keep working in a copy: new ids, same targets on the same slide", () => {
  const m = open();
  const layer = m.addLayer()!;
  m.selectLayer(m.slide!.baseLayer.id);
  const button = m.addObject("button")!;
  m.addRule(button.id);
  assert.equal(button.triggers[0]!.target, layer.id);
  m.duplicate();
  const copy = m.object!;
  assert.equal(copy.triggers.length, button.triggers.length, "a button's rule is a pair of triggers, one for the mouse and one for the keyboard, and both came");
  assert.ok(copy.triggers.length > 0);
  assert.ok(copy.triggers.every((t) => t.target === layer.id), "it still shows the same layer");
  assert.ok(copy.triggers.every((t) => !button.triggers.some((o) => o.id === t.id)), "with ids of their own");
  assert.ok(unique(allTriggerIds(m)), "no two rules in the project share an id");
});

test("a rule that points at a layer of the first slide is left off a copy pasted onto another slide, and the author is told", () => {
  const m = open();
  m.addLayer();
  m.selectLayer(m.slide!.baseLayer.id);
  const button = m.addObject("button")!;
  m.addRule(button.id);
  m.copy();
  m.selectSlide("slide-002");
  const msg = m.paste()!;
  assert.equal(m.object!.triggers.length, 0);
  assert.match(msg, /1 rule was not copied/, "one rule, though it is stored as two triggers");
  assert.ok(button.triggers.length > 0, "the original keeps its rule");
});

test("a rule that jumps to a slide is kept wherever the copy goes", () => {
  const m = open();
  const button = m.addObject("button")!;
  m.addRule(button.id);
  m.updateRule(button.id, 0, { action: "jumpToSlide", target: "slide-002" });
  m.copy();
  m.selectSlide("slide-002");
  const msg = m.paste()!;
  assert.ok(m.object!.triggers.length > 0);
  assert.ok(m.object!.triggers.every((t) => t.target === "slide-002"));
  assert.doesNotMatch(msg, /not copied/);
});

test("pasting onto a slide with a different background says to check the text", () => {
  const m = open();
  m.selectSlide("slide-001");
  m.setSlideBackground("slide-001", "theme:bg.default");
  m.setSlideBackground("slide-002", "theme:bg.dark");
  m.selectSlide("slide-001");
  m.addObject("text");
  m.copy();
  assert.doesNotMatch(m.paste()!, /different background/, "the same slide, so the same background");
  m.selectSlide("slide-002");
  assert.match(m.paste()!, /different background from the one it was copied from/);
});

test("paste with nothing copied says so, and copy makes it possible", () => {
  const m = open();
  assert.equal(m.canPaste, false);
  assert.match(m.paste()!, /nothing to paste/i);
  const o = m.addObject("shape")!;
  const kinds: string[] = [];
  m.on((c) => kinds.push(c.kind));
  const course = JSON.stringify([m.slides, m.variables]);
  assert.equal(m.copy(), `Copied ${o.name}.`);
  assert.equal(m.canPaste, true);
  assert.deepEqual(kinds, ["clipboard"], "copying changes nothing in the course, so nothing but the Paste button needs to hear of it");
  assert.equal(JSON.stringify([m.slides, m.variables]), course);
  assert.equal(m.canUndo && m.undo() && m.objects.some((x) => x.id === o.id), false, "and copying is not an undo step: undo takes back the shape that was added");
});

test("paste onto another slide lands where the original was and keeps its name", () => {
  const m = open();
  const o = m.addObject("shape")!;
  m.setName(o.id, "Blue panel");
  m.copy();
  m.selectSlide("slide-002");
  const before = m.objects.length;
  m.paste();
  const pasted = m.object!;
  assert.equal(m.objects.length, before + 1);
  assert.equal(pasted.name, "Blue panel");
  assert.deepEqual(pasted.geometry, { ...o.geometry, z: pasted.geometry.z });
  assert.notEqual(pasted.id, o.id);
  assert.ok(unique(allIds(m)));
});

test("pasting again on the same layer moves each copy aside, and a repeated name becomes a copy", () => {
  const m = open();
  const o = m.addObject("shape")!;
  m.setName(o.id, "Blue panel");
  m.copy();
  m.paste();
  const first = m.object!;
  m.paste();
  const second = m.object!;
  assert.deepEqual([first.geometry.x, first.geometry.y], [o.geometry.x + 20, o.geometry.y + 20], "the first paste would land on the original, so it moves aside");
  assert.deepEqual([second.geometry.x, second.geometry.y], [o.geometry.x + 40, o.geometry.y + 40], "the second moves further");
  assert.equal(first.name, "Blue panel copy");
  assert.equal(second.name, "Blue panel copy 2");
});

test("copy holds what the object was then: editing the original afterwards does not change the paste", () => {
  const m = open();
  const o = m.addObject("text")!;
  m.setText(o.id, { block: "p", text: "As copied" });
  m.copy();
  m.setText(o.id, { block: "p", text: "Edited after" });
  m.selectSlide("slide-002");
  m.paste();
  assert.match(String(m.object!.content["html"]), /As copied/);
});

test("cut removes the object, closes the gap in the tab order, and paste puts it back where it was", () => {
  const m = open();
  const a = m.addObject("text")!;
  const b = m.addObject("button")!;
  m.addObject("shape");
  m.selectObject(b.id);
  const at = { ...b.geometry };
  const name = b.name;
  assert.equal(m.cut(), `Cut ${name}.`);
  assert.equal(m.objects.some((o) => o.id === b.id), false);
  const tabbed = m.objects.filter((o) => (o.accessibility.tabOrder ?? 0) >= 1);
  assert.deepEqual(tabbed.map((o) => o.accessibility.tabOrder), tabbed.map((_, i) => i + 1));
  m.paste();
  const back = m.object!;
  assert.equal(back.name, name, "nothing else has the name now, so it keeps it");
  assert.deepEqual([back.geometry.x, back.geometry.y], [at.x, at.y], "and it goes back where it was, not to one side");
  assert.ok(m.objects.some((o) => o.id === a.id));
});

test("one undo takes a paste away", () => {
  const m = open();
  m.addObject("shape");
  m.copy();
  const before = m.objects.length;
  m.paste();
  assert.equal(m.objects.length, before + 1);
  m.undo();
  assert.equal(m.objects.length, before);
});

test("what was copied goes with the project: a new project has nothing to paste", () => {
  const m = open();
  m.addObject("shape");
  m.copy();
  assert.equal(m.canPaste, true);
  assert.equal(open().canPaste, false, "pictures and files of one project are not in another, so the clipboard is the project's own");
});
