// Speech and thought bubbles in the editor: adding one (empty, or with words to type), changing its kind and its tail, turning a plain text box into one and back, and the real validator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ADD_MENU, groupOptions, NEW_OPTIONS } from "./factory.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const get = (m: Model, id: string) => m.objects.find((o) => o.id === id)!;

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-21" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

test("the bubbles are offered in the Shape picker, so the Add menu stays as short as it was", () => {
  assert.ok(ADD_MENU.length <= 9);
  assert.equal(ADD_MENU.find((e) => e.value === "group:shape")?.label, "Shape or bubble...");
  const bubbles = NEW_OPTIONS.filter((o) => o.value.startsWith("bubble:")).map((o) => o.value);
  assert.deepEqual(bubbles, ["bubble:text-speech", "bubble:text-thought", "bubble:shape-speech", "bubble:shape-thought"]);
  assert.equal(groupOptions("shape").some((o) => o.value.startsWith("bubble:")), false, "the shapes and the bubbles are separate groups in the picker");
});

test("an empty bubble is a decorative shape with the theme's panel colour and a quiet outline, its tail on the left", () => {
  for (const kind of ["speech", "thought"] as const) {
    const m = fresh();
    const o = m.addObject("shape", { shape: kind })!;
    assert.equal(o.type, "shape");
    assert.deepEqual(o.content, { shape: kind, tail: "left" });
    assert.deepEqual(o.style, { fill: "theme:color.surface", stroke: "theme:color.muted", strokeWidth: 2 });
    assert.equal(o.accessibility.decorative, true);
    assert.equal(o.accessibility.altText, "", "alt text is never filled in for the author");
    assert.equal(o.name, kind === "speech" ? "Speech bubble" : "Thought bubble");
    assert.equal(m.object?.id, o.id, "it is selected");
    assert.ok(o.geometry.width >= 200 && o.geometry.height >= 100);
  }
});

test("a bubble with words is text with a bubble: reachable, with the words to type, and colours that read well together", () => {
  const m = fresh();
  const o = m.addObject("text", { bubble: "thought" })!;
  assert.equal(o.type, "text");
  assert.deepEqual(o.content, { html: "<p>New text</p>", bubble: "thought", tail: "left" });
  assert.equal(o.style["fill"], "theme:color.surface");
  assert.equal(o.style["color"], "theme:color.text", "the words are in the colour that goes with the panel colour, on any slide");
  assert.equal(o.accessibility.decorative, false);
  assert.ok((o.accessibility.tabOrder ?? 0) >= 1, "its words are read in order");
  assert.notEqual(o.accessibility.altText, "");
  assert.equal(o.name, "Thought bubble");
});

test("the tail can be put on either side of a bubble, and only of a bubble", () => {
  const m = fresh();
  const shape = m.addObject("shape", { shape: "speech" })!;
  assert.equal(m.setBubbleTail(shape.id, "right"), "Tail on the right");
  assert.equal(get(m, shape.id)?.content["tail"], "right");
  assert.equal(m.setBubbleTail(shape.id, "right"), null, "already there");
  assert.equal(m.setBubbleTail(shape.id, "up"), null, "only two sides");
  const text = m.addObject("text", { bubble: "speech" })!;
  assert.equal(m.setBubbleTail(text.id, "right"), "Tail on the right");
  assert.equal(get(m, text.id)?.content["tail"], "right");
  const plainShape = m.addObject("shape", { shape: "ellipse" })!;
  assert.equal(m.setBubbleTail(plainShape.id, "right"), null, "an ellipse has no tail");
  assert.equal("tail" in (get(m, plainShape.id).content ?? {}), false);
  const plainText = m.addObject("text")!;
  assert.equal(m.setBubbleTail(plainText.id, "right"), null, "plain text has no tail");
});

test("changing the tail is one step to undo", () => {
  const m = fresh();
  const o = m.addObject("text", { bubble: "speech" })!;
  m.setBubbleTail(o.id, "right");
  assert.equal(get(m, o.id)?.content["tail"], "right");
  m.undo();
  assert.equal(get(m, o.id)?.content["tail"], "left");
  m.redo();
  assert.equal(get(m, o.id)?.content["tail"], "right");
});

test("a plain text box can be put in a bubble and taken out again, and undo puts it back in one step", () => {
  const m = fresh();
  const o = m.addObject("text")!;
  const before = JSON.stringify(get(m, o.id));
  assert.equal(m.setTextBubble(o.id, "speech"), "In a speech bubble");
  const made = get(m, o.id);
  assert.equal(made.content["bubble"], "speech");
  assert.equal(made.content["tail"], "left");
  assert.equal(made.content["html"], "<p>New text</p>", "the words are kept");
  assert.deepEqual([made.style["fill"], made.style["stroke"], made.style["strokeWidth"], made.style["color"]], ["theme:color.surface", "theme:color.muted", 2, "theme:color.text"]);
  assert.equal(m.setTextBubble(o.id, "speech"), null, "nothing to change");
  assert.equal(m.setTextBubble(o.id, "cloud"), null, "only the two kinds");
  m.undo();
  assert.equal(JSON.stringify(get(m, o.id)), before, "one step back to the plain text box");
  m.redo();
  assert.equal(m.setTextBubble(o.id, ""), "Plain text again, without the bubble");
  const plain = get(m, o.id);
  assert.equal("bubble" in plain.content || "tail" in plain.content, false);
  assert.equal("fill" in plain.style || "stroke" in plain.style || "strokeWidth" in plain.style, false, "the bubble's colours go with it");
  assert.equal(plain.content["html"], "<p>New text</p>");
});

test("changing the kind of a text bubble keeps its tail and its colours, and a bubble the author coloured keeps their colours", () => {
  const m = fresh();
  const o = m.addObject("text", { bubble: "speech" })!;
  m.setBubbleTail(o.id, "right");
  m.setStyle(o.id, "fill", "#fff4c2");
  assert.equal(m.setTextBubble(o.id, "thought"), "In a thought bubble");
  const now = get(m, o.id);
  assert.equal(now.content["tail"], "right");
  assert.equal(now.style["fill"], "#fff4c2");
  // A text box the author already coloured, made into a bubble, keeps its own fill and colour.
  const own = m.addObject("text")!;
  m.setStyle(own.id, "fill", "#103a5c");
  m.setStyle(own.id, "color", "#ffffff");
  m.setTextBubble(own.id, "speech");
  const kept = get(m, own.id);
  assert.equal(kept.style["fill"], "#103a5c");
  assert.equal(kept.style["color"], "#ffffff");
  assert.equal(kept.style["stroke"], "theme:color.muted", "it still gets an outline, because a bubble without one has no edge");
});

test("a shape made into a bubble has its tail on the left, one made into something else has none, and changing the kind keeps the side", () => {
  const m = fresh();
  const o = m.addObject("shape", { shape: "rectangle" })!;
  assert.equal("tail" in get(m, o.id).content, false);
  m.setShape(o.id, "speech");
  assert.deepEqual(get(m, o.id).content, { shape: "speech", tail: "left" });
  m.setBubbleTail(o.id, "right");
  m.setShape(o.id, "thought");
  assert.deepEqual(get(m, o.id).content, { shape: "thought", tail: "right" });
  m.setShape(o.id, "diamond");
  assert.deepEqual(get(m, o.id).content, { shape: "diamond" });
});

type Finding = { severity: string; rule: string; message: string; detail?: string };

function validate(m: Model): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-bubble-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the real validator is satisfied with new bubbles of every kind and side, and has no complaint about their colours", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  for (const kind of ["speech", "thought"] as const) {
    for (const tail of ["left", "right"] as const) {
      const text = m.addObject("text", { bubble: kind })!;
      m.setBubbleTail(text.id, tail);
      const shape = m.addObject("shape", { shape: kind })!;
      m.setBubbleTail(shape.id, tail);
    }
  }
  const errors = validate(m).filter((f) => f.severity === "error");
  assert.deepEqual(errors, []);
  assert.equal(validate(m).filter((f) => f.rule === "contrast").length, 0);
});

test("the real validator names a tail or bubble it does not know", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  const o = m.addObject("text", { bubble: "speech" })!;
  get(m, o.id).content["tail"] = "up";
  assert.deepEqual(validate(m).filter((f) => f.rule === "bubble-invalid").map((f) => f.severity), ["error"]);
});
