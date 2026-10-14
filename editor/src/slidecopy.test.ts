// Duplicating a slide, duplicating a layer, and putting layers in a different order.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { InputContent, OSObject, QuizContent } from "../../player/src/types.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-10" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const slideFile = (m: Model, id: string) => JSON.parse(m.allFiles().find((f) => f.path === `slides/${id}.json`)!.text) as { name: string; baseLayer: { id: string; objects: OSObject[] }; layers: { id: string; name: string; objects: OSObject[] }[] };
const everyObject = (m: Model) => m.slides.flatMap((s) => [s.baseLayer, ...s.layers].flatMap((l) => l.objects));

/** A slide with a button on the base layer that shows Layer 1, and on Layer 1 a note and a close button that hides it. */
function withLayer(m: Model): { show: OSObject; note: OSObject; close: OSObject } {
  const base = m.slide!.baseLayer.id;
  m.addLayer();
  m.selectLayer(base);
  const show = m.addObject("button")!;
  m.addRule(show.id);
  m.selectLayer("layer-1");
  const note = m.addObject("text")!;
  const close = m.addObject("button")!;
  m.addRule(close.id);
  m.updateRule(close.id, 0, { action: "hideLayer" });
  return { show, note, close };
}

// ---- duplicating a slide

test("a duplicated slide sits straight after the original, selected, and is called a copy", () => {
  const m = fresh();
  m.addSlide("blank");
  m.addSlide("blank");
  m.selectSlide("slide-002");
  const before = m.slides.map((s) => s.id);
  const msg = m.duplicateSlide()!;
  assert.match(msg, /^Duplicated Slide 2\. The copy is Slide 2 copy, slide 3 of 4\./);
  assert.deepEqual(m.slides.map((s) => s.id), ["slide-001", "slide-002", "slide-004", "slide-003"], "the copy comes straight after the original, not at the end");
  assert.equal(m.sel.slideId, "slide-004");
  assert.equal(m.slide!.name, "Slide 2 copy");
  assert.deepEqual(m.project.scenes[0]!.slides, ["slide-001", "slide-002", "slide-004", "slide-003"]);
  assert.deepEqual(before, ["slide-001", "slide-002", "slide-003"]);
  assert.equal(m.sel.objectId, null);
});

test("the copy has the same layers and places, and objects with ids of their own", () => {
  const m = fresh();
  const { note } = withLayer(m);
  m.selectLayer(m.slide!.baseLayer.id);
  m.addObject("text");
  const original = JSON.stringify(slideFile(m, "slide-001"));
  m.selectSlide("slide-001");
  m.duplicateSlide();
  assert.equal(JSON.stringify(slideFile(m, "slide-001")), original, "the original is untouched");
  const copy = slideFile(m, m.sel.slideId);
  const orig = JSON.parse(original) as typeof copy;
  assert.deepEqual([copy.baseLayer.id, ...copy.layers.map((l) => l.id)], [orig.baseLayer.id, ...orig.layers.map((l) => l.id)], "a layer id only has to be unique on its slide");
  assert.deepEqual(copy.layers[0]!.objects.map((o) => o.geometry), orig.layers[0]!.objects.map((o) => o.geometry));
  const ids = everyObject(m).map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, "object ids are unique across the whole project, because they name narration");
  assert.ok(!copy.layers[0]!.objects.some((o) => o.id === note.id));
  const triggerIds = everyObject(m).flatMap((o) => o.triggers.map((t) => t.id));
  assert.equal(new Set(triggerIds).size, triggerIds.length, "so are rule ids");
});

test("rules between a slide's own layers and objects work on the copy", () => {
  const m = fresh();
  const { show, close } = withLayer(m);
  m.duplicateSlide();
  const copy = slideFile(m, m.sel.slideId);
  const shown = copy.baseLayer.objects.find((o) => o.type === "button")!;
  assert.notEqual(shown.id, show.id);
  assert.ok(shown.triggers.length > 0 && shown.triggers.every((t) => t.action === "showLayer" && t.target === "layer-1"), "the button on the copy shows the copy's Layer 1");
  const closer = copy.layers[0]!.objects.find((o) => o.type === "button")!;
  assert.notEqual(closer.id, close.id);
  assert.ok(closer.triggers.every((t) => t.action === "hideLayer" && t.target === "layer-1"));
});

test("an input in the copy saves to variables of its own, and the rules that use them follow", () => {
  const m = fresh();
  m.addLayer();
  m.selectLayer(m.slide!.baseLayer.id);
  const input = m.addInput("radio")!;
  const button = m.addObject("button")!;
  m.addRule(button.id);
  m.addCondition(button.id, 0);
  const variable = (input.content as unknown as InputContent).variable!;
  assert.equal(button.triggers[0]!.conditions[0]!.variable, variable, "the rule reads the input's variable");
  const variablesBefore = m.variables.length;
  const msg = m.duplicateSlide()!;
  assert.match(msg, /Its input saves to a variable of its own/);
  assert.equal(m.variables.length, variablesBefore + 1);
  const copy = slideFile(m, m.sel.slideId);
  const copyInput = copy.baseLayer.objects.find((o) => o.type === "input")!;
  const copyVariable = (copyInput.content as unknown as InputContent).variable!;
  assert.notEqual(copyVariable, variable);
  const copyButton = copy.baseLayer.objects.find((o) => o.type === "button")!;
  assert.equal(copyButton.triggers[0]!.conditions[0]!.variable, copyVariable, "the copy's rule reads the copy's answer, not the original's");
  const origButton = slideFile(m, "slide-001").baseLayer.objects.find((o) => o.type === "button")!;
  assert.equal(origButton.triggers[0]!.conditions[0]!.variable, variable, "and the original's rule still reads the original's");
});

test("a question and its feedback layers are copied, and the copy says it counts toward the score again", () => {
  const m = fresh();
  const quiz = m.addQuiz("mc")!;
  const q = quiz.content as unknown as QuizContent;
  const msg = m.duplicateSlide()!;
  assert.match(msg, /Its question counts toward the score again/);
  const copy = slideFile(m, m.sel.slideId);
  const copyQuiz = copy.baseLayer.objects.find((o) => o.type === "quizQuestion")!;
  const cq = copyQuiz.content as unknown as QuizContent;
  assert.notEqual(copyQuiz.id, quiz.id);
  assert.ok(copy.layers.some((l) => l.id === cq.feedback.correct) && copy.layers.some((l) => l.id === cq.feedback.incorrect), "it shows layers of its own slide");
  assert.deepEqual(cq.feedback, q.feedback, "the layer ids are the same ids, on a different slide");
});

test("locks, groups and timing are kept; a copied group is a group of its own", () => {
  const m = fresh();
  const a = m.addObject("text")!;
  const b = m.addObject("text")!;
  m.selectObject(a.id);
  m.toggleSelected(b.id);
  m.group();
  m.setTiming(a.id, { start: 2000 });
  m.selectObject(a.id);
  m.setLocked(true);
  const tag = a.group;
  const count = m.slide!.baseLayer.objects.length;
  m.duplicateSlide();
  const copy = slideFile(m, m.sel.slideId).baseLayer.objects;
  assert.equal(copy.length, count);
  assert.ok(copy.some((o) => o.locked === true), "the lock is kept: the copy is meant to be the same");
  const grouped = copy.filter((o) => o.group);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0]!.group, grouped[1]!.group);
  assert.notEqual(grouped[0]!.group, tag, "a new group id, so the groups can never be mixed up");
  assert.equal(copy.find((o) => o.timing.start === 2000) !== undefined, true);
});

test("duplicating a slide is one undo step, and the copy is saved as a slide of its own", () => {
  const m = fresh();
  m.addInput("radio");
  const variables = m.variables.length;
  m.duplicateSlide();
  const files = m.allFiles().map((f) => f.path);
  assert.ok(files.includes("slides/slide-002.json"), "a file for the copy");
  assert.ok((JSON.parse(m.allFiles().find((f) => f.path === "project.json")!.text) as { scenes: { slides: string[] }[] }).scenes[0]!.slides.includes("slide-002"));
  m.undo();
  assert.deepEqual(m.slides.map((s) => s.id), ["slide-001"]);
  assert.equal(m.variables.length, variables, "the copy's variables go too");
  assert.equal(m.sel.slideId, "slide-001");
  m.redo();
  assert.equal(m.slides.length, 2);
});

test("a copy of a copy gets its own name and its own id", () => {
  const m = fresh();
  const name = m.slide!.name;
  m.duplicateSlide();
  m.duplicateSlide(); // duplicates the copy, which is the slide now selected
  assert.deepEqual(m.slides.map((s) => s.name), [name, `${name} copy`, `${name} copy 2`]);
  assert.equal(new Set(m.slides.map((s) => s.id)).size, 3);
});

// ---- duplicating a layer

test("a duplicated layer sits right after the original, is selected, and rules that pointed at its own layer point at the copy", () => {
  const m = fresh();
  const { show, note, close } = withLayer(m);
  m.addLayer(); // layer-2, after layer-1
  m.selectLayer("layer-1");
  const msg = m.duplicateLayer()!;
  assert.match(msg, /^Duplicated Layer 1\. The copy is Layer 1 copy, and you are now editing it\. No rule shows it yet/);
  assert.deepEqual(m.slide!.layers.map((l) => l.name), ["Layer 1", "Layer 1 copy", "Layer 2"]);
  assert.equal(m.sel.layerId, m.slide!.layers[1]!.id);
  const copy = m.slide!.layers[1]!;
  assert.equal(copy.objects.length, 2);
  assert.ok(copy.objects.every((o) => ![note.id, close.id].includes(o.id)), "new ids");
  const closer = copy.objects.find((o) => o.type === "button")!;
  assert.ok(closer.triggers.every((t) => t.action === "hideLayer" && t.target === copy.id), "the copy's close button closes the copy");
  assert.ok(close.triggers.every((t) => t.target === "layer-1"), "and the original's still closes the original");
  const shower = m.slide!.baseLayer.objects.find((o) => o.id === show.id)!;
  assert.ok(shower.triggers.every((t) => t.target === "layer-1"), "the rule that shows the original still shows only the original");
});

test("a rule in the layer that points at another layer keeps pointing there", () => {
  const m = fresh();
  withLayer(m);
  m.addLayer(); // layer-2
  m.selectLayer("layer-1");
  const extra = m.addObject("button")!;
  m.addRule(extra.id);
  m.updateRule(extra.id, 0, { target: "layer-2" });
  m.duplicateLayer("layer-1");
  const copy = m.slide!.layers[1]!;
  const jump = copy.objects.filter((o) => o.type === "button").flatMap((o) => o.triggers).find((t) => t.action === "showLayer")!;
  assert.equal(jump.target, "layer-2");
});

test("the base layer can be duplicated into an ordinary layer at the front", () => {
  const m = fresh();
  m.addLayer();
  m.selectLayer(m.slide!.baseLayer.id);
  const n = m.slide!.baseLayer.objects.length;
  m.duplicateLayer();
  assert.equal(m.slide!.layers.length, 2);
  assert.equal(m.slide!.layers[0]!.objects.length, n);
  assert.equal(m.slide!.layers[0]!.name, `${m.slide!.baseLayer.name} copy`);
  assert.equal(m.slide!.baseLayer.objects.length, n, "the base layer is unchanged");
});

test("a question on a duplicated layer brings feedback layers of its own", () => {
  const m = fresh();
  m.addLayer();
  const quiz = m.addQuiz("mc")!;
  const q = quiz.content as unknown as QuizContent;
  const layersBefore = m.slide!.layers.length;
  const msg = m.duplicateLayer()!;
  assert.match(msg, /It brought two feedback layers, and its question counts toward the score again\./);
  assert.equal(m.slide!.layers.length, layersBefore + 3, "the copy and two feedback layers");
  const copyQuiz = m.layer!.objects.find((o) => o.type === "quizQuestion")!;
  const cq = copyQuiz.content as unknown as QuizContent;
  assert.notEqual(cq.feedback.correct, q.feedback.correct);
  assert.notEqual(cq.feedback.incorrect, q.feedback.incorrect);
  const names = m.slide!.layers.map((l) => l.name);
  assert.equal(new Set(names).size, names.length, "no two layers share a name");
  assert.ok(m.slide!.layers.some((l) => l.id === cq.feedback.correct));
});

test("duplicating a layer is one undo step", () => {
  const m = fresh();
  const { show } = withLayer(m);
  const variables = m.variables.length;
  m.duplicateLayer("layer-1");
  assert.equal(m.slide!.layers.length, 2);
  m.undo();
  assert.deepEqual(m.slide!.layers.map((l) => l.id), ["layer-1"]);
  assert.equal(m.variables.length, variables);
  assert.equal(m.sel.layerId, m.slide!.baseLayer.id, "the editor is not left on a layer that is gone");
  assert.ok(m.slide!.baseLayer.objects.some((o) => o.id === show.id));
});

// ---- the order of layers

test("a layer moves earlier or later, in one undo step, and the base layer stays first", () => {
  const m = fresh();
  m.addLayer();
  m.addLayer();
  m.addLayer();
  const order = () => m.slide!.layers.map((l) => l.name);
  assert.deepEqual(order(), ["Layer 1", "Layer 2", "Layer 3"]);
  assert.match(m.moveLayer("layer-3", -1)!, /^Layer 3 is now layer 3 of 4\. A later layer is drawn in front of an earlier one, and is read after it\.$/);
  assert.deepEqual(order(), ["Layer 1", "Layer 3", "Layer 2"]);
  assert.match(m.moveLayer("layer-3", -1)!, /^Layer 3 is now layer 2 of 4\./);
  assert.match(m.moveLayer("layer-3", -1)!, /already the first layer after the base layer/);
  assert.match(m.moveLayer("layer-2", 1)!, /already the last layer/);
  assert.match(m.moveLayer(m.slide!.baseLayer.id, 1)!, /base layer is always first/);
  assert.equal(m.moveLayer("layer-nope", 1), null);
  m.undo();
  assert.deepEqual(order(), ["Layer 1", "Layer 3", "Layer 2"], "one undo step per move");
  m.undo();
  assert.deepEqual(order(), ["Layer 1", "Layer 2", "Layer 3"]);
});

test("moving a layer keeps what is selected selected", () => {
  const m = fresh();
  m.addLayer();
  m.addLayer();
  m.selectLayer("layer-2");
  const o = m.addObject("text")!;
  m.moveLayer("layer-2", -1);
  assert.equal(m.sel.layerId, "layer-2");
  assert.equal(m.sel.objectId, o.id);
  assert.deepEqual(m.layers.map((l) => l.id), ["layer-base", "layer-2", "layer-1"]);
});

// ---- the real validator

type Finding = { severity: string; rule: string; message: string };

function validate(m: Model): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-sc-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout) as Finding[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the real validator accepts a duplicated slide and a duplicated layer", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  withLayer(m);
  m.selectLayer(m.slide!.baseLayer.id);
  m.addInput("radio");
  m.addQuiz("mc");
  const before = validate(m).filter((f) => f.severity === "error").map((f) => f.rule);
  m.duplicateLayer("layer-1");
  m.moveLayer("layer-1", 1);
  m.selectSlide("slide-001");
  m.duplicateSlide();
  const errors = validate(m).filter((f) => f.severity === "error");
  assert.deepEqual(errors.map((f) => f.rule), before, `no new errors: ${errors.map((f) => f.message).join("; ")}`);
});
