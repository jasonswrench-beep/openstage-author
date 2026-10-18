// Tests for slides made from steps: their layout, what a screen reader is told, narration, provenance, and the course's own checker.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Slide } from "../../player/src/types.ts";
import { Model } from "./model.ts";
import { addManual, editStep, knowPicture, listFrom, parseLog, proposeFromLog, type Step, type StepList } from "./steps.ts";
import { buildStepSlide, fitPicture, shorten, type SlideOptions, type StepPicture } from "./stepslides.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function options(over: Partial<SlideOptions> = {}): SlideOptions {
  let n = 0;
  return { recording: "Demo.capture", total: 3, stage: { width: 1280, height: 720 }, newSlideId: () => `slide-x${++n}`, newObjectId: () => `obj-x${++n}`, narration: (script) => ({ script }), ...over };
}

function stepsOf(...lines: string[]): StepList {
  const events = parseLog(lines.join("\n")).events;
  let list = listFrom([proposeFromLog(events, { take: 1 })]).list;
  for (const s of list.steps) list = knowPicture(list, s.id, { width: 1920, height: 1080 });
  return list;
}

const CLICK = '{"t":1000,"type":"click","x":960,"y":540,"button":"left"}';
const NAMED = '{"t":1000,"type":"element","name":"Save","role":"button"}';
const PIC: StepPicture = { path: "assets/images/step-1.png", width: 1920, height: 1080 };

test("a picture is fitted under the words as large as it can be, centred, and never blown up past one and a half times", () => {
  assert.deepEqual(fitPicture({ x: 64, y: 160, width: 1152, height: 540 }, { width: 1920, height: 1080 }), { x: 160, y: 160, width: 960, height: 540 });
  assert.deepEqual(fitPicture({ x: 0, y: 0, width: 1000, height: 1000 }, { width: 100, height: 50 }), { x: 425, y: 463, width: 150, height: 75 });
  const wide = fitPicture({ x: 0, y: 0, width: 1000, height: 400 }, { width: 4000, height: 1000 });
  assert.deepEqual([wide.width, wide.height, wide.x, wide.y], [1000, 250, 0, 75]);
});

test("a name is shortened for the outline, and says so when it has no words", () => {
  assert.equal(shorten("Click the Save button."), "Click the Save button.");
  assert.equal(shorten("x".repeat(100), 10), "xxxxxxxxx…");
  assert.equal(shorten("  a   b  "), "a b");
});

test("a click step becomes a slide: heading, words with narration, the picture, and a frame round the place to point at", () => {
  const list = stepsOf(CLICK, NAMED);
  const slide = buildStepSlide(list.steps[0]!, 0, PIC, options());
  assert.equal(slide.provenance && "sourceCapture" in slide.provenance && `${slide.provenance.sourceCapture}/${slide.provenance.stepId}`, "Demo.capture/step-1");
  assert.equal(slide.name, "Step 1: Click the Save button.");
  const [heading, words, image, frame] = slide.baseLayer.objects;
  assert.deepEqual([heading!.type, heading!.content["html"], heading!.accessibility.role], ["text", "<h1>Step 1 of 3</h1>", "heading"]);
  assert.deepEqual([words!.type, words!.content["html"], words!.narration], ["text", "<p>Click the Save button.</p>", { script: "Click the Save button." }]);
  assert.deepEqual([image!.type, image!.content["src"]], ["image", "assets/images/step-1.png"]);
  assert.equal(frame!.type, "shape");
  assert.equal(frame!.accessibility.decorative, true, "the words say what to do, so the frame is not read out");
  assert.deepEqual([heading!.accessibility.tabOrder, words!.accessibility.tabOrder, image!.accessibility.tabOrder, frame!.accessibility.tabOrder], [1, 2, 3, 0], "read in order: step, words, picture");
  // the frame lies over the picture, where the click was
  const g = image!.geometry;
  const f = frame!.geometry;
  assert.ok(f.x >= g.x && f.y >= g.y && f.x + f.width <= g.x + g.width && f.y + f.height <= g.y + g.height, "inside the picture");
  assert.ok(Math.abs(f.x + f.width / 2 - (g.x + g.width / 2)) <= 2 && Math.abs(f.y + f.height / 2 - (g.y + g.height / 2)) <= 2, "centred on a click in the middle of the screen");
  for (const o of slide.baseLayer.objects) {
    assert.ok(o.geometry.x >= 0 && o.geometry.y >= 0 && o.geometry.x + o.geometry.width <= 1280 && o.geometry.y + o.geometry.height <= 720, `${o.name} is on the stage`);
  }
});

test("a picture's description is used only once the step is checked, and the words are used as they were written", () => {
  let list = stepsOf(CLICK, NAMED);
  const unchecked = buildStepSlide(list.steps[0]!, 0, PIC, options());
  assert.equal(unchecked.baseLayer.objects[2]!.accessibility.altText, "", "nothing the editor guessed is put in as the author's");
  list = editStep(list, "step-1", { text: "Press Save.", alt: "  The Save button in the toolbar.  ", reviewed: true });
  const checked = buildStepSlide(list.steps[0]!, 0, PIC, options());
  assert.equal(checked.baseLayer.objects[2]!.accessibility.altText, "The Save button in the toolbar.");
  assert.equal(checked.baseLayer.objects[1]!.content["html"], "<p>Press Save.</p>");
});

test("words are written into the slide safely, and long words make room for more lines", () => {
  const list = editStep(stepsOf(CLICK), "step-1", { text: 'Type "<b>&</b>" in the box. ' + "word ".repeat(40) });
  const slide = buildStepSlide(list.steps[0]!, 0, PIC, options());
  const html = String(slide.baseLayer.objects[1]!.content["html"]);
  assert.match(html, /^<p>Type "&lt;b&gt;&amp;&lt;\/b&gt;" in the box\. word/);
  const short = buildStepSlide(stepsOf(CLICK).steps[0]!, 0, PIC, options());
  assert.ok(slide.baseLayer.objects[1]!.geometry.height > short.baseLayer.objects[1]!.geometry.height, "more lines, taller box");
  assert.ok(slide.baseLayer.objects[2]!.geometry.y > slide.baseLayer.objects[1]!.geometry.y + slide.baseLayer.objects[1]!.geometry.height, "the picture starts below the words");
});

test("a step with no place has no frame, and one with no picture has neither picture nor frame", () => {
  const list = stepsOf('{"t":1000,"type":"key","key":"enter","modifiers":[]}');
  const noFrame = buildStepSlide(list.steps[0]!, 0, PIC, options());
  assert.deepEqual(noFrame.baseLayer.objects.map((o) => o.type), ["text", "text", "image"]);
  const none = buildStepSlide(stepsOf(CLICK).steps[0]!, 0, null, options());
  assert.deepEqual(none.baseLayer.objects.map((o) => o.type), ["text", "text"]);
});

test("the stage's size is respected, and ids come from the model", () => {
  const slide = buildStepSlide(stepsOf(CLICK).steps[0]!, 1, PIC, options({ stage: { width: 960, height: 540 } }));
  assert.ok(slide.baseLayer.objects.every((o) => o.geometry.x + o.geometry.width <= 960 && o.geometry.y + o.geometry.height <= 540));
  assert.equal(slide.name.startsWith("Step 2:"), true);
  assert.match(slide.id, /^slide-x/);
  assert.ok(slide.baseLayer.objects.every((o) => /^obj-x/.test(o.id)));
});

// ---- in the course

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-18" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const pictures = (list: StepList): Map<string, StepPicture> => new Map(list.steps.map((s, i) => [s.id, { path: `assets/images/step-${i + 1}.png`, width: 1920, height: 1080 }]));

test("slides for every step are put after the current slide, as one undo step, with a voice that says each step's words", () => {
  const m = fresh();
  let list = stepsOf(CLICK, NAMED, '{"t":3000,"type":"key","key":"enter","modifiers":[]}');
  list = editStep(list, "step-1", { reviewed: true });
  const r = m.makeStepSlides({ recording: "Demo.capture", steps: list.steps, pictures: pictures(list), capturedAt: "2026-10-18T10:00:00Z" });
  assert.equal(r.added, 2);
  assert.deepEqual(m.slides.map((s) => s.name), ["Title", "Step 1: Click the Save button.", "Step 2: Press Enter."].map((n, i) => (i === 0 ? m.slides[0]!.name : n)));
  assert.equal(m.slide!.id, m.slides[1]!.id, "the first new slide is where the author is taken");
  assert.match(r.message, /^Made 2 slides from the steps, after the slide you were on\./);
  assert.match(r.message, /1 picture has no description yet, because its step has not been checked\./);
  assert.match(r.message, /Press Control Z to undo\.$/);
  const second = m.slides[2]!;
  const said = second.baseLayer.objects[1]!.narration as { script: string; voice: string } | null;
  assert.equal(said?.script, "Press Enter.");
  assert.ok(typeof said?.voice === "string" && said.voice !== "");
  assert.deepEqual(second.provenance, { sourceCapture: "Demo.capture", stepId: "step-2", capturedAt: "2026-10-18T10:00:00Z" });
  m.undo();
  assert.equal(m.slides.length, 1, "one undo takes every slide away");
});

test("pressing it again makes nothing twice, and says so; a step added later gets its own slide", () => {
  const m = fresh();
  let list = stepsOf(CLICK, NAMED);
  const input = () => ({ recording: "Demo.capture", steps: list.steps, pictures: pictures(list) });
  assert.equal(m.makeStepSlides(input()).added, 1);
  const again = m.makeStepSlides(input());
  assert.deepEqual([again.added, again.skipped], [0, 1]);
  assert.equal(again.message, "Every step already has a slide in this course.");
  assert.equal(m.slides.length, 2);
  list = addManual(list, { take: 1, atMs: 5000 });
  list = editStep(list, list.steps[1]!.id, { text: "Close the window." });
  const more = m.makeStepSlides(input());
  assert.deepEqual([more.added, more.skipped], [1, 1]);
  assert.match(more.message, /1 step already had a slide, so it was left alone\./);
  assert.equal(m.slides.length, 3);
  assert.equal(m.makeStepSlides({ recording: "Other.capture", steps: list.steps, pictures: pictures(list) }).added, 2, "another recording's steps are not the same steps");
  assert.match(m.makeStepSlides({ recording: "Demo.capture", steps: [], pictures: new Map() }).message, /^There are no steps to make slides from\. 2 slides are for steps that are no longer in the list/);
  assert.equal(fresh().makeStepSlides({ recording: "Demo.capture", steps: [], pictures: new Map() }).message, "There are no steps to make slides from.");
});

// ---- the course's own checker

type Finding = { rule: string; severity: string; message: string };

function validate(m: Model): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-steps-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout) as Finding[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the real validator accepts the slides, asks only for the descriptions of unchecked pictures, and finds no step claimed twice", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  let list = stepsOf(CLICK, NAMED, '{"t":3000,"type":"key","key":"enter","modifiers":[]}');
  list = editStep(list, "step-1", { reviewed: true, alt: "The Save button." });
  m.makeStepSlides({ recording: "Demo.capture", steps: list.steps, pictures: pictures(list) });
  // The pictures are not on disk in this test, so their files are missing; that is the one thing set aside.
  const found = validate(m).filter((f) => f.rule !== "asset-missing");
  assert.deepEqual(found.map((f) => [f.rule, f.severity]), [["alt-text-missing", "error"]], "only the unchecked step's picture asks for a description, and no step is claimed twice");
});
