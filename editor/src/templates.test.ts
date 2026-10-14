// Ready-made lesson slides: each builds a whole slide whose parts work, with nothing filled in that the author has to write, and passes the real validator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readActivation } from "./content.ts";
import { SLIDE_LAYOUTS } from "./factory.ts";
import { Model } from "./model.ts";
import { previewBlocks } from "./factory.ts";
import { renumber, SLIDE_TEMPLATES, TEMPLATE_PREFIX, templateById } from "./templates.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-13" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

test("there are six ready-made lesson slides, each named and described", () => {
  assert.deepEqual(SLIDE_TEMPLATES.map((t) => t.id), ["welcome", "objectives", "knowledge-check", "scenario", "resources", "summary"]);
  for (const t of SLIDE_TEMPLATES) {
    assert.ok(t.label && t.description && t.name, t.id);
    assert.equal(templateById(t.id), t);
  }
  assert.equal(templateById("nothing"), undefined);
  assert.equal(TEMPLATE_PREFIX, "template:");
});

test("a template's ids cannot clash with a layout's, because the picker marks them", () => {
  const layoutIds = new Set(SLIDE_LAYOUTS.map((l) => l.id));
  for (const t of SLIDE_TEMPLATES) assert.ok(!layoutIds.has(`${TEMPLATE_PREFIX}${t.id}`));
});

test("every template can be drawn in the picker: it has something to draw", () => {
  for (const t of SLIDE_TEMPLATES) assert.ok(previewBlocks(t.layout, t.extras).length > 0, t.id);
});

for (const t of SLIDE_TEMPLATES) {
  test(`${t.label}: adds a slide after the current one, as one undo step`, () => {
    const m = fresh();
    const before = m.slides.length;
    const slide = m.addTemplateSlide(t.id)!;
    assert.equal(m.slides.length, before + 1);
    assert.equal(m.slides[1]!.id, slide.id, "after the slide the author was on");
    assert.equal(m.sel.slideId, slide.id);
    assert.equal(slide.name, t.name);
    assert.equal(slide.layout, null, "a template is a start, not a layout the slide stays tied to");
    assert.ok(slide.baseLayer.objects.length >= 1);
    m.undo();
    assert.equal(m.slides.length, before);
    assert.deepEqual(m.project.scenes[0]!.slides, ["slide-001"]);
    m.redo();
    assert.equal(m.slides.length, before + 1);
  });

  test(`${t.label}: every object has its own id, and everything reachable has a tab order of 1, 2, 3 in reading order`, () => {
    const m = fresh();
    m.addTemplateSlide("welcome");
    const slide = m.addTemplateSlide(t.id)!;
    const all = [slide.baseLayer, ...slide.layers].flatMap((l) => l.objects);
    const ids = all.map((o) => o.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const other of m.slides.filter((s) => s.id !== slide.id)) {
      for (const o of [other.baseLayer, ...other.layers].flatMap((l) => l.objects)) assert.ok(!ids.includes(o.id), `${o.id} is new`);
    }
    const tabs = slide.baseLayer.objects.filter((o) => (o.accessibility.tabOrder ?? 0) >= 1).sort((a, b) => a.accessibility.tabOrder! - b.accessibility.tabOrder!);
    assert.deepEqual(tabs.map((o) => o.accessibility.tabOrder), tabs.map((_, i) => i + 1));
    for (let i = 1; i < tabs.length; i++) {
      const a = tabs[i - 1]!.geometry;
      const b = tabs[i]!.geometry;
      assert.ok(a.y < b.y || (a.y === b.y && a.x <= b.x), `${tabs[i]!.name} comes after ${tabs[i - 1]!.name} on the slide`);
    }
  });
}

test("the buttons on a template are already wired to move around the course, for the mouse and the keyboard", () => {
  const m = fresh();
  const counts: Record<string, string[]> = {};
  for (const t of SLIDE_TEMPLATES) {
    const slide = m.addTemplateSlide(t.id)!;
    counts[t.id] = slide.baseLayer.objects.filter((o) => o.type === "button").map((o) => String(readActivation(o.triggers).kind));
  }
  assert.deepEqual(counts["welcome"], ["next"]);
  assert.deepEqual(counts["objectives"]!.sort(), ["next", "previous"]);
  assert.deepEqual(counts["scenario"]!.sort(), ["next", "previous"]);
  assert.deepEqual(counts["resources"]!.sort(), ["next", "previous"]);
  assert.deepEqual(counts["summary"], ["previous"]);
  assert.deepEqual(counts["knowledge-check"], []);
});

test("the welcome slide says Begin and sits on the dark background, with light text", () => {
  const m = fresh();
  const s = m.addTemplateSlide("welcome")!;
  assert.equal(s.background, "theme:bg.dark");
  const begin = s.baseLayer.objects.find((o) => o.type === "button")!;
  assert.equal(begin.content["label"], "Begin");
  assert.equal(begin.accessibility.altText, "Begin");
  const title = s.baseLayer.objects.find((o) => String(o.content["html"] ?? "").includes("<h1"))!;
  assert.equal(title.style["color"], "theme:color.onDark");
});

test("the knowledge check is a question with two feedback layers, wired to it", () => {
  const m = fresh();
  const s = m.addTemplateSlide("knowledge-check")!;
  const quiz = s.baseLayer.objects.find((o) => o.type === "quizQuestion")!;
  assert.equal(s.layers.length, 2);
  const feedback = quiz.content["feedback"] as { correct: string; incorrect: string };
  assert.deepEqual(s.layers.map((l) => l.id).sort(), [feedback.correct, feedback.incorrect].sort());
});

test("the scenario slide holds a starter story, and the resources slide an accordion", () => {
  const m = fresh();
  const s = m.addTemplateSlide("scenario")!;
  assert.equal(s.baseLayer.objects.filter((o) => o.type === "scenario").length, 1);
  const r = m.addTemplateSlide("resources")!;
  const acc = r.baseLayer.objects.find((o) => o.type === "interaction")!;
  assert.equal((acc.content as { kind: string }).kind, "accordion");
  assert.equal(acc.accessibility.altText, "Resources");
});

test("a template writes nothing a screen reader depends on that the author has not been asked for", () => {
  const m = fresh();
  for (const t of SLIDE_TEMPLATES) m.addTemplateSlide(t.id);
  const slide = m.slides.find((s) => s.name === "Scenario")!;
  const scenario = slide.baseLayer.objects.find((o) => o.type === "scenario")!;
  assert.equal(scenario.accessibility.altText, "A scenario", "the same placeholder as adding a scenario; the author makes it say what the story is about");
});

test("renumber puts the tab order in reading order and leaves decoration out of it", () => {
  const m = fresh();
  const s = m.addTemplateSlide("objectives")!;
  const shuffled = [...s.baseLayer.objects].reverse();
  renumber(shuffled);
  const reachable = shuffled.filter((o) => (o.accessibility.tabOrder ?? 0) >= 1);
  assert.equal(reachable.length, shuffled.filter((o) => !o.accessibility.decorative).length);
  for (const o of shuffled.filter((o) => o.accessibility.decorative)) assert.equal(o.accessibility.tabOrder ?? 0, 0);
});

// ---- the real validator

type Finding = { severity: string; rule: string; message: string; file: string };

test("a project built from every ready-made lesson slide passes the real validator", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  for (const t of SLIDE_TEMPLATES) m.addTemplateSlide(t.id);
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-templates-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    const findings = JSON.parse(r.stdout) as Finding[];
    // The scenario's name is a placeholder the author makes say something, and the question's wording too; neither is an error.
    const errors = findings.filter((f) => f.severity === "error");
    assert.deepEqual(errors, [], JSON.stringify(errors));
    // Each slide is added after the one before it, so Welcome has a slide to go back to and Summary, the last, has only Back: nothing goes nowhere.
    const nowhere = findings.filter((f) => f.rule === "trigger-next-last" || f.rule === "trigger-previous-first");
    assert.deepEqual(nowhere, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
