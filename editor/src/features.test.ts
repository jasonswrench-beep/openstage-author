// Tests for shapes, colours, quiz questions and the built-in slide layouts.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SHAPE_KINDS } from "../../player/src/stage.ts";
import type { QuizContent } from "../../player/src/types.ts";
import { colorName, contrastNote, contrastRatio, normalizeHex, PALETTE } from "./content.ts";
import { NEW_OPTIONS, previewBlocks, SLIDE_LAYOUTS } from "./factory.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");
const proj = path.join(repo, "examples", "minimal.osproj");
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

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-10" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

// ---- colours

test("the palette has named colours, none repeated", () => {
  assert.ok(PALETTE.length >= 24);
  assert.equal(new Set(PALETTE.map((p) => p.hex)).size, PALETTE.length);
  assert.equal(new Set(PALETTE.map((p) => p.name)).size, PALETTE.length);
  for (const p of PALETTE) assert.ok(normalizeHex(p.hex) === p.hex, `${p.name} is a lower-case six digit hex`);
});

test("hex codes are normalised, and palette colours get their names", () => {
  assert.equal(normalizeHex("#FFF"), "#ffffff");
  assert.equal(normalizeHex(" #0B3FB3 "), "#0b3fb3");
  assert.equal(normalizeHex("blue"), null);
  assert.equal(colorName("#0b3fb3"), "Blue (#0b3fb3)");
  assert.equal(colorName("#123456"), "#123456");
});

test("contrast ratios match the WCAG definition", () => {
  assert.equal(contrastRatio("#000000", "#ffffff").toFixed(1), "21.0");
  assert.equal(contrastRatio("#ffffff", "#ffffff").toFixed(1), "1.0");
  assert.equal(contrastRatio("#777777", "#ffffff").toFixed(2), "4.48");
  assert.match(contrastNote("#141414", "#ffffff", "white", 22), /passes WCAG AA/);
  assert.match(contrastNote("#f5f5f5", "#eeeeee", "the fill", 18), /too low/);
  assert.match(contrastNote("#8a8a8a", "#ffffff", "white", 30), /passes WCAG AA for large text/, "large text needs only 3:1");
});

test("outline and fill styles are accepted and refused sensibly", () => {
  const m = open();
  m.selectObject("obj-0003");
  assert.equal(m.setStyle("obj-0003", "stroke", "#0b3fb3").ok, true);
  assert.equal(m.setStyle("obj-0003", "stroke", "none").ok, true);
  assert.equal(m.object!.style["stroke"], "none");
  assert.equal(m.setStyle("obj-0003", "stroke", "navy").ok, false);
  assert.equal(m.setStyle("obj-0003", "strokeWidth", "4").ok, true);
  assert.equal(m.setStyle("obj-0003", "strokeWidth", "99").ok, false);
  assert.equal(m.setStyle("obj-0003", "strokeWidth", "-1").ok, false);
});

// ---- shapes

test("every shape in the Add menu is a shape the renderer can draw", () => {
  const offered = NEW_OPTIONS.filter((o) => o.value.startsWith("shape:")).map((o) => o.value.slice(6));
  for (const s of offered) assert.ok(s === "line" || (SHAPE_KINDS as readonly string[]).includes(s), `${s} must be drawable`);
  assert.ok(offered.length >= 6);
});

test("a new shape is the kind you chose, is decorative, and a line is a thin rectangle", () => {
  const m = open();
  const e = m.addObject("shape", { shape: "ellipse" })!;
  assert.equal(e.content["shape"], "ellipse");
  assert.equal(e.name, "Ellipse");
  assert.equal(e.accessibility.decorative, true);
  const line = m.addObject("shape", { shape: "line" })!;
  assert.equal(line.content["shape"], "rectangle");
  assert.ok(line.geometry.height <= 8 && line.geometry.width >= 300);
});

test("a shape can be changed to another, but not to something the renderer cannot draw", () => {
  const m = open();
  m.selectObject("obj-0003");
  assert.match(m.setShape("obj-0003", "triangle") ?? "", /triangle/);
  assert.equal(m.object!.content["shape"], "triangle");
  assert.equal(m.setShape("obj-0003", "star"), null);
  assert.equal(m.object!.content["shape"], "triangle");
  assert.equal(m.setShape("obj-0003", "triangle"), null, "no change, no undo step");
});

// ---- quiz questions

test("adding a multiple-choice question builds the prompt, the answers and two feedback layers", () => {
  const m = open();
  m.selectSlide("slide-001");
  const quiz = m.addQuiz("mc")!;
  const q = quiz.content as unknown as QuizContent;
  assert.equal(q.choices.length, 3);
  assert.equal(q.choices.filter((c) => c.correct).length, 1);
  assert.equal(quiz.accessibility.role, "radiogroup");
  assert.equal(m.slide!.layers.length, 2);
  assert.deepEqual(m.slide!.layers.map((l) => l.id), [q.feedback.correct, q.feedback.incorrect]);
  const prompt = m.objects.find((o) => o.name === "Question")!;
  assert.match(String(prompt.content["html"]), /^<h2>/);
  assert.ok(prompt.accessibility.tabOrder! < quiz.accessibility.tabOrder!, "the question is read before the answers");
  assert.equal(m.sel.objectId, quiz.id);
  for (const l of m.slide!.layers) assert.equal(l.objects[0]!.accessibility.role, "status", "feedback is announced");
});

test("a true or false question has two answers and one attempt", () => {
  const m = open();
  const q = m.addQuiz("tf")!.content as unknown as QuizContent;
  assert.deepEqual(q.choices.map((c) => c.label), ["True", "False"]);
  assert.equal(q.scoring.attemptsAllowed, 1);
});

test("a second quiz on the same slide gets its own feedback layers", () => {
  const m = open();
  m.selectSlide("slide-002");
  const before = m.slide!.layers.map((l) => l.id);
  const quiz = m.addQuiz("mc")!;
  const q = quiz.content as unknown as QuizContent;
  assert.ok(!before.includes(q.feedback.correct) && !before.includes(q.feedback.incorrect));
  assert.notEqual(q.feedback.correct, q.feedback.incorrect);
});

test("a question added to a slide that already has content goes below it", () => {
  const m = fresh();
  m.addSlide("blank");
  const first = m.addQuiz("tf")!;
  const prompt1 = m.objects.find((o) => o.name === "Question")!;
  assert.equal(prompt1.geometry.y, 60, "an empty slide puts the first question at the top");
  const second = m.addQuiz("tf")!;
  const prompt2 = m.objects.filter((o) => o.name === "Question")[1]!;
  assert.ok(prompt2.geometry.y > prompt1.geometry.y, "the second question starts lower");
  assert.ok(prompt2.geometry.y + 370 <= m.project.stage.height, "and still fits on the slide");
  assert.notEqual(first.id, second.id);
});

test("choosing the correct answer clears the others, so there is always exactly one", () => {
  const m = open();
  const quiz = m.addQuiz("mc")!;
  const q = quiz.content as unknown as QuizContent;
  assert.match(m.setCorrectChoice(quiz.id, "c3") ?? "", /correct answer/);
  assert.deepEqual(q.choices.map((c) => c.correct), [false, false, true]);
  assert.equal(m.setCorrectChoice(quiz.id, "c3"), null);
  assert.equal(m.setCorrectChoice(quiz.id, "nope"), null);
});

test("answers can be added and removed within limits, and removing the right one is flagged", () => {
  const m = open();
  const quiz = m.addQuiz("mc")!;
  const q = quiz.content as unknown as QuizContent;
  assert.match(m.addChoice(quiz.id) ?? "", /Added answer 4/);
  assert.equal(q.choices[3]!.id, "c4");
  for (let i = 0; i < 4; i++) m.addChoice(quiz.id);
  assert.equal(q.choices.length, 8);
  assert.match(m.addChoice(quiz.id) ?? "", /at most 8/);
  while (q.choices.length > 2) m.deleteChoice(quiz.id, q.choices[q.choices.length - 1]!.id);
  assert.match(m.deleteChoice(quiz.id, "c1") ?? "", /at least 2/);
  assert.equal(q.choices.length, 2);
});

test("deleting the correct answer makes another correct and says so", () => {
  const m = open();
  const quiz = m.addQuiz("mc")!;
  const q = quiz.content as unknown as QuizContent;
  const msg = m.deleteChoice(quiz.id, "c1");
  assert.match(msg ?? "", /now the correct answer/);
  assert.equal(q.choices.filter((c) => c.correct).length, 1);
});

test("scoring and feedback layers are validated", () => {
  const m = open();
  const quiz = m.addQuiz("mc")!;
  const q = quiz.content as unknown as QuizContent;
  assert.equal(m.setScoring(quiz.id, { points: 5 }), "Scoring updated");
  assert.equal(q.scoring.points, 5);
  assert.equal(m.setScoring(quiz.id, { points: -1 }), null);
  assert.equal(m.setScoring(quiz.id, { attemptsAllowed: 0 }), null);
  assert.equal(m.setScoring(quiz.id, { attemptsAllowed: 2.5 }), null);
  assert.equal(m.setScoring(quiz.id, { attemptsAllowed: 11 }), null);
  const other = m.slide!.layers[0]!.id;
  assert.match(m.setFeedbackLayer(quiz.id, "incorrect", other) ?? "", /incorrect feedback now uses/);
  assert.equal(m.setFeedbackLayer(quiz.id, "incorrect", "layer-base"), null, "the base layer cannot be feedback");
  assert.equal(m.setFeedbackLayer(quiz.id, "correct", "nope"), null);
});

test("adding a question is one undo step that removes the layers too", () => {
  const m = open();
  m.selectSlide("slide-001");
  m.addQuiz("mc");
  m.undo();
  assert.equal(m.slide!.layers.length, 0);
  assert.equal(m.dirty, false);
});

// ---- slide layouts

test("the layouts cover the usual presentation set first, then columns, pictures and charts, and lessons", () => {
  assert.deepEqual(SLIDE_LAYOUTS.slice(0, 9).map((l) => l.label), [
    "Title Slide", "Title and Content", "Section Header", "Two Content", "Comparison",
    "Title Only", "Blank", "Content with Caption", "Picture with Caption",
  ]);
  assert.deepEqual([...new Set(SLIDE_LAYOUTS.map((l) => l.group))], ["Basic", "Columns and grids", "Pictures and charts", "For lessons"]);
  const labels = SLIDE_LAYOUTS.map((l) => l.label);
  for (const wanted of ["Two Columns, 60/40", "Two Columns, 70/30", "Three Columns", "Four Columns", "Grid of Four", "Picture and Text", "Text and Chart", "Chart",
    "Title and Large Picture", "Three Pictures", "Four Pictures", "Dashboard", "Learning Objectives", "Instructions", "Major Point", "Welcome with Picture", "Process or Timeline"]) {
    assert.ok(labels.includes(wanted), `${wanted} is offered`);
  }
  assert.ok(!SLIDE_LAYOUTS.some((l) => l.id.startsWith("quiz")), "questions are objects, not layouts");
  assert.equal(new Set(SLIDE_LAYOUTS.map((l) => l.id)).size, SLIDE_LAYOUTS.length);
  assert.equal(new Set(labels).size, labels.length, "no two layouts share a label");
  for (const l of SLIDE_LAYOUTS) assert.ok(l.description.length > 10, `${l.label} describes itself`);
});

test("columns and grids fit the slide and do not run into each other", () => {
  for (const id of ["three-columns", "four-columns"]) {
    const layout = SLIDE_LAYOUTS.find((l) => l.id === id)!;
    const cols = layout.slots.filter((s) => s.name.startsWith("Column"));
    assert.equal(cols.length, id === "three-columns" ? 3 : 4);
    assert.equal(new Set(cols.map((c) => c.rect[2])).size, 1, "equal widths");
    assert.ok(cols[cols.length - 1]!.rect[0] + cols[cols.length - 1]!.rect[2] <= 1200, "inside the right margin");
    assert.equal(cols[0]!.rect[0], 80, "starts at the left margin");
  }
});

test("a process slide reads step by step: heading, then its text, then the next heading", () => {
  const slide = fresh().addSlide("process");
  const order = [...slide.baseLayer.objects].filter((o) => (o.accessibility.tabOrder ?? 0) > 0).sort((a, b) => a.accessibility.tabOrder! - b.accessibility.tabOrder!).map((o) => o.name);
  assert.deepEqual(order, ["Title", "Step 1", "Step 1 detail", "Step 2", "Step 2 detail", "Step 3", "Step 3 detail", "Step 4", "Step 4 detail"]);
});

test("chart and picture areas are layout decoration: hidden from screen readers, and replaced when the layout changes", () => {
  const m = fresh();
  m.addSlide("dashboard");
  const areas = () => m.slide!.baseLayer.objects.filter((o) => o.name === "Chart area" || o.name === "Picture area");
  assert.equal(areas().length, 4);
  for (const a of areas()) {
    assert.equal(a.accessibility.decorative, true);
    assert.equal(a.accessibility.altText, "");
  }
  m.applyLayout("text-chart");
  assert.deepEqual(areas().map((a) => a.name), ["Chart area"], "the dashboard's four areas are replaced by one chart area");
  m.applyLayout("three-pictures");
  assert.deepEqual(areas().map((a) => a.name), ["Picture area", "Picture area", "Picture area"]);
  m.applyLayout("content");
  assert.equal(areas().length, 0);
});

test("a chart slide offers a chart area and a caption, and the chart area comes first visually", () => {
  const slide = fresh().addSlide("chart");
  assert.ok(slide.baseLayer.objects.some((o) => o.name === "Chart area"));
  assert.ok(slide.baseLayer.objects.some((o) => o.name === "Caption"));
  const area = slide.baseLayer.objects.find((o) => o.name === "Chart area")!;
  const title = slide.baseLayer.objects.find((o) => o.name === "Title")!;
  assert.ok(area.geometry.y >= title.geometry.y + title.geometry.height, "the chart sits below the title");
});

test("moving between column layouts keeps what you wrote, column by column", () => {
  const m = fresh();
  m.addSlide("three-columns");
  const cols = m.objects.filter((o) => o.name.startsWith("Column"));
  m.setText(cols[0]!.id, { block: "p", text: "One" });
  m.setText(cols[1]!.id, { block: "p", text: "Two" });
  m.setText(cols[2]!.id, { block: "p", text: "Three" });
  m.applyLayout("four-columns");
  const words = m.objects.filter((o) => o.name.startsWith("Column")).map((o) => String(o.content["html"]).replace(/<[^>]+>/g, ""));
  assert.deepEqual(words, ["One", "Two", "Three", "Add the fourth column here."]);
  m.applyLayout("grid");
  const grid = m.objects.filter((o) => o.name.startsWith("Grid")).map((o) => String(o.content["html"]).replace(/<[^>]+>/g, ""));
  assert.deepEqual(grid, ["One", "Two", "Three", "Add the fourth item here."]);
});

test("every layout makes a slide that follows the format's accessibility rules", () => {
  for (const layout of SLIDE_LAYOUTS) {
    const m = fresh();
    const slide = m.addSlide(layout.id);
    const objects = [slide.baseLayer, ...slide.layers].flatMap((l) => l.objects);
    const ids = objects.map((o) => o.id);
    assert.equal(new Set(ids).size, ids.length, `${layout.id}: object ids are unique`);
    const other = m.slides[0]!.baseLayer.objects.map((o) => o.id);
    assert.ok(!ids.some((id) => other.includes(id)), `${layout.id}: ids do not clash with other slides`);
    for (const o of objects) {
      if (o.accessibility.decorative) assert.equal(o.accessibility.altText, "", `${layout.id}: decorative ${o.name} has no alt text`);
      else assert.ok(o.accessibility.altText.trim() !== "", `${layout.id}: ${o.name} has alt text`);
    }
    const tabs = slide.baseLayer.objects.map((o) => o.accessibility.tabOrder ?? 0).filter((t) => t > 0).sort((a, b) => a - b);
    assert.deepEqual(tabs, tabs.map((_, i) => i + 1), `${layout.id}: tab order runs 1..n with no gaps or repeats`);
    assert.equal(slide.baseLayer.objects.filter((o) => o.type === "text").length, layout.slots.length, `${layout.id}: one text box per slot`);
  }
});

test("a layout slide is named for its layout, and a blank one is numbered", () => {
  const m = fresh();
  assert.equal(m.addSlide("two-content").name, "Two content");
  assert.equal(m.addSlide("blank").name, "Slide 3");
});

test("the title comes first in reading order and is a real heading", () => {
  for (const layout of SLIDE_LAYOUTS.filter((l) => l.slots.length)) {
    const slide = fresh().addSlide(layout.id);
    const first = [...slide.baseLayer.objects].filter((o) => (o.accessibility.tabOrder ?? 0) > 0).sort((a, b) => a.accessibility.tabOrder! - b.accessibility.tabOrder!)[0]!;
    assert.equal(first.accessibility.role, "heading", `${layout.id} starts with a heading`);
    assert.match(String(first.content["html"]), /^<h[123]>/);
  }
});

// ---- changing a slide's layout

function slideWithWords() {
  const m = fresh();
  m.addSlide("content");
  const title = m.objects.find((o) => o.name === "Title")!;
  const content = m.objects.find((o) => o.name === "Content")!;
  m.setText(title.id, { block: "h1", text: "Why consent matters" });
  m.setText(content.id, { block: "p", text: "Participants choose freely." });
  return { m, titleId: title.id, contentId: content.id };
}

test("changing layout moves the words already written into the new places", () => {
  const { m, titleId, contentId } = slideWithWords();
  const msg = m.applyLayout("two-content")!;
  assert.match(msg, /Applied Two Content/);
  assert.match(msg, /2 text boxes moved into place/);
  assert.match(msg, /1 new placeholder added/);
  const byName = (n: string) => m.objects.find((o) => o.name === n)!;
  assert.equal(byName("Title").id, titleId, "the title object is the same object, not a copy");
  assert.equal(byName("Title").content["html"], "<h1>Why consent matters</h1>");
  assert.equal(byName("Left content").id, contentId);
  assert.equal(byName("Left content").content["html"], "<p>Participants choose freely.</p>");
  assert.equal(byName("Left content").geometry.width, 540);
  assert.equal(byName("Right content").content["html"], "<p>Add the second column here.</p>");
});

test("text only moves into a place of its own kind: body text never lands in a heading", () => {
  const { m, contentId } = slideWithWords();
  m.applyLayout("two-content");
  const right = m.objects.find((o) => o.name === "Right content")!;
  m.setText(right.id, { block: "p", text: "Participants may withdraw." });
  m.applyLayout("comparison");
  const byName = (n: string) => m.objects.find((o) => o.name === n)!;
  assert.equal(byName("Left content").id, contentId);
  assert.equal(byName("Left content").content["html"], "<p>Participants choose freely.</p>");
  assert.equal(byName("Right content").content["html"], "<p>Participants may withdraw.</p>");
  assert.equal(byName("Left heading").content["html"], "<h3>First heading</h3>", "headings are new placeholders");
  assert.equal(byName("Right heading").content["html"], "<h3>Second heading</h3>");
});

test("headings you wrote move into heading places, and are not squeezed into body text elsewhere", () => {
  const { m } = slideWithWords();
  m.applyLayout("comparison");
  const lh = m.objects.find((o) => o.name === "Left heading")!;
  m.setText(lh.id, { block: "h3", text: "Benefits" });
  m.applyLayout("two-content");
  const names = m.objects.filter((o) => o.type === "text").map((o) => `${o.name}: ${o.content["html"]}`);
  assert.ok(names.some((n) => n.includes("Benefits")), "the heading is kept");
  const left = m.objects.find((o) => o.name === "Left content")!;
  assert.doesNotMatch(String(left.content["html"]), /Benefits/, "and did not take a body place");
  m.applyLayout("comparison");
  assert.equal(m.objects.find((o) => o.name === "Left heading")!.content["html"], "<h3>Benefits</h3>", "it returns to a heading place");
});

test("a slide changed from one layout to another has only the new layout's objects, with nothing left over from the old", () => {
  const m = fresh();
  m.addSlide("comparison");
  m.applyLayout("picture-caption");
  const names = () => m.slide!.baseLayer.objects.map((o) => o.name).sort();
  assert.deepEqual(names(), ["Caption", "Picture area", "Title"], "no headings, columns or accent bar are left from Comparison");
  m.applyLayout("two-content");
  assert.deepEqual(names(), ["Accent", "Left content", "Right content", "Title"], "and no picture area or caption");
  m.applyLayout("blank");
  assert.deepEqual(names(), []);
  m.applyLayout("content-caption");
  assert.deepEqual(names(), ["Accent", "Caption", "Content", "Title"]);
});

test("the replacement placeholders carry the new layout's own prompt text, not the old one's", () => {
  const m = fresh();
  m.addSlide("comparison");
  m.applyLayout("picture-caption");
  const html = (n: string) => String(m.slide!.baseLayer.objects.find((o) => o.name === n)!.content["html"]);
  assert.equal(html("Title"), "<h2>Title</h2>");
  assert.equal(html("Caption"), "<p>Add a caption here.</p>");
});

test("the message says what was cleared, and what was kept", () => {
  const m = fresh();
  m.addSlide("comparison");
  const msg = m.applyLayout("title-only")!;
  assert.match(msg, /5 unused placeholders from the old layout were removed/);
  assert.doesNotMatch(msg, /no place in this layout/);
});

test("only text the author wrote is carried over, and unwritten placeholders are not", () => {
  const m = fresh();
  m.addSlide("comparison");
  const left = m.objects.find((o) => o.name === "Left content")!;
  m.setText(left.id, { block: "p", text: "My own words" });
  m.applyLayout("picture-caption");
  const texts = m.slide!.baseLayer.objects.filter((o) => o.type === "text").map((o) => `${o.name}: ${String(o.content["html"]).replace(/<[^>]+>/g, "")}`).sort();
  assert.deepEqual(texts, ["Caption: My own words", "Title: Title"]);
});

test("a text box the author wrote but that has no place in the new layout is still kept", () => {
  const m = fresh();
  m.addSlide("comparison");
  const right = m.objects.find((o) => o.name === "Right content")!;
  m.setText(right.id, { block: "p", text: "Keep me" });
  const left = m.objects.find((o) => o.name === "Left content")!;
  m.setText(left.id, { block: "p", text: "Me too" });
  const msg = m.applyLayout("title-only")!;
  assert.match(msg, /2 text boxes have no place in this layout and stay where they were/);
  assert.equal(m.slide!.baseLayer.objects.filter((o) => o.type === "text" && /Keep me|Me too/.test(String(o.content["html"]))).length, 2);
});

test("the old layout's decoration is replaced, not piled up", () => {
  const { m } = slideWithWords();
  const accents = () => m.slide!.baseLayer.objects.filter((o) => o.name === "Accent");
  assert.equal(accents().length, 1);
  m.applyLayout("section");
  assert.equal(accents().length, 1);
  assert.deepEqual(accents()[0]!.geometry, { x: 120, y: 230, width: 160, height: 8, rotation: 0, z: 5 });
  m.applyLayout("blank");
  assert.equal(accents().length, 0);
});

test("text with no place in the new layout is kept where it was, and the author is told", () => {
  const { m, contentId } = slideWithWords();
  const before = { ...m.slide!.baseLayer.objects.find((o) => o.id === contentId)!.geometry };
  const msg = m.applyLayout("title-only")!;
  assert.match(msg, /1 text box has no place in this layout and stays where it was/);
  const kept = m.slide!.baseLayer.objects.find((o) => o.id === contentId)!;
  assert.deepEqual(kept.geometry, before);
  assert.equal(kept.content["html"], "<p>Participants choose freely.</p>");
});

test("buttons, images and shapes the author added are left alone", () => {
  const { m } = slideWithWords();
  const button = m.addObject("button")!;
  const circle = m.addObject("shape", { shape: "ellipse" })!;
  const before = JSON.stringify([button, circle]);
  const was = button.accessibility.tabOrder;
  m.applyLayout("comparison");
  const after = m.slide!.baseLayer.objects;
  const b = after.find((o) => o.id === button.id)!;
  const c = after.find((o) => o.id === circle.id)!;
  assert.equal(JSON.stringify([{ ...b, accessibility: { ...b.accessibility, tabOrder: was } }, c]), before, "same apart from the reading-order number");
  const tabs = after.map((o) => o.accessibility.tabOrder ?? 0).filter((t) => t > 0).sort((x, y) => x - y);
  assert.deepEqual(tabs, tabs.map((_, i) => i + 1), "reading order is still 1..n");
  assert.ok(b.accessibility.tabOrder! > 5, "the button comes after the layout's five text places");
});

test("applying a layout is one undo step that restores everything", () => {
  const { m } = slideWithWords();
  const before = JSON.stringify(m.slides);
  m.applyLayout("comparison");
  assert.notEqual(JSON.stringify(m.slides), before);
  m.undo();
  assert.equal(JSON.stringify(m.slides), before);
  m.redo();
  assert.equal(m.objects.some((o) => o.name === "Left heading"), true);
});

test("changing layout sets each text's size to suit its place, but keeps the author's colour and font", () => {
  const { m, titleId } = slideWithWords();
  m.selectObject(titleId);
  m.setStyle(titleId, "color", "#336699");
  m.setStyle(titleId, "fontFamily", "Georgia, serif");
  m.applyLayout("title");
  const t = m.slide!.baseLayer.objects.find((o) => o.id === titleId)!;
  assert.equal(t.style["fontSize"], 56);
  assert.equal(t.style["color"], "#336699");
  assert.equal(t.style["fontFamily"], "Georgia, serif");
});

test("formatted text is moved but not flattened", () => {
  const { m, contentId } = slideWithWords();
  m.setHtml(contentId, "<p>One <strong>two</strong></p>");
  m.applyLayout("two-content");
  const moved = m.slide!.baseLayer.objects.find((o) => o.id === contentId)!;
  assert.equal(moved.content["html"], "<p>One <strong>two</strong></p>");
  assert.equal(moved.geometry.x, 80);
});

test("a shape the author drew with a layout's name is not mistaken for decoration", () => {
  const { m } = slideWithWords();
  const mine = m.addObject("shape", { shape: "rectangle" })!;
  m.applyLayout("blank");
  assert.ok(m.slide!.baseLayer.objects.some((o) => o.id === mine.id), "a decorative rectangle called Rectangle survives");
});

test("applying a layout does nothing to other layers or other slides", () => {
  const m = open();
  m.selectSlide("slide-002");
  const layers = JSON.stringify(m.slide!.layers);
  const other = JSON.stringify(m.slides[0]);
  m.applyLayout("two-content");
  assert.equal(JSON.stringify(m.slide!.layers), layers);
  assert.equal(JSON.stringify(m.slides[0]), other);
});

// ---- the pictures of layouts

test("each layout's picture shows what it holds", () => {
  const blocks = (id: string) => previewBlocks(SLIDE_LAYOUTS.find((l) => l.id === id)!);
  const count = (id: string, kind: string) => blocks(id).filter((b) => b.kind === kind).length;
  assert.equal(blocks("blank").length, 0);
  assert.equal(count("title-only", "title"), 1);
  assert.equal(count("title-only", "body"), 0);
  assert.equal(count("two-content", "body"), 2);
  assert.equal(count("comparison", "heading"), 2);
  assert.equal(count("text-chart", "chart"), 1);
  assert.equal(count("dashboard", "chart"), 2);
  assert.equal(count("dashboard", "picture"), 2);
  assert.equal(count("four-pictures", "picture"), 4);
  assert.equal(count("process", "heading"), 4);
  assert.equal(count("comparison", "body"), 2);
  assert.equal(count("picture-caption", "picture"), 1);
  assert.equal(count("section", "accent"), 1);
  for (const l of SLIDE_LAYOUTS) for (const b of previewBlocks(l)) {
    const [x, y, w, h] = b.rect;
    assert.ok(x >= 0 && y >= 0 && x + w <= 1280 && y + h <= 720, `${l.id}: ${b.kind} fits on the slide`);
  }
});

test("slots in a layout never overlap each other", () => {
  for (const l of SLIDE_LAYOUTS) {
    const r = l.slots.map((s) => s.rect);
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
      const [ax, ay, aw, ah] = r[i]!;
      const [bx, by, bw, bh] = r[j]!;
      const overlap = ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
      assert.ok(!overlap, `${l.id}: ${l.slots[i]!.name} overlaps ${l.slots[j]!.name}`);
    }
  }
});

// ---- the real validator, on everything the editor can make

test("a project built from every layout, shape and quiz passes the real validator", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  for (const l of SLIDE_LAYOUTS) m.addSlide(l.id);
  m.selectSlide("slide-001");
  for (const o of NEW_OPTIONS) {
    // An image, a table and a scrolling text box start with no alt text, on purpose, so the validator asks for it.
    if (o.value === "image" || o.value.startsWith("quiz:") || o.value.startsWith("content:")) continue;
    if (o.value.startsWith("shape:")) m.addObject("shape", { shape: o.value.slice(6) });
    else m.addObject(o.value as "text" | "button");
  }
  m.addQuiz("mc");
  m.addQuiz("tf");

  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-features-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    const findings = JSON.parse(r.stdout) as { severity: string; rule: string; object_id: string; message: string }[];
    const errors = findings.filter((f) => f.severity === "error");
    assert.deepEqual(errors, [], `the validator found errors: ${JSON.stringify(errors)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every layout applied to a slide that already has content still passes the real validator", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  m.addSlide("content");
  m.addObject("button");
  m.addObject("shape", { shape: "ellipse" });
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-layouts-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const layout of SLIDE_LAYOUTS) {
      m.applyLayout(layout.id);
      for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
      const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
      const errors = (JSON.parse(r.stdout) as { severity: string }[]).filter((f) => f.severity === "error");
      assert.deepEqual(errors, [], `after applying ${layout.id}: ${JSON.stringify(errors)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
