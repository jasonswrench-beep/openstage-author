// Tests for adding, deleting and editing slides, layers and objects, and for what gets saved.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { BLOCK_SIZES, buildActivation, buildSimpleText, FONT_CHOICES, isFontValue, isHexColor, parseSimpleText, readActivation } from "./content.ts";
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

// ---- simple text

test("simple text round-trips, including special characters and line breaks", () => {
  const html = buildSimpleText({ block: "h2", text: "Fish & <chips>\nsecond line" });
  assert.equal(html, "<h2>Fish &amp; &lt;chips&gt;<br>second line</h2>");
  assert.deepEqual(parseSimpleText(html), { block: "h2", text: "Fish & <chips>\nsecond line" });
});

test("text with real formatting is not flattened", () => {
  assert.equal(parseSimpleText("<p>one <strong>two</strong></p>"), null);
  assert.equal(parseSimpleText("<p>one</p><p>two</p>"), null);
  assert.equal(parseSimpleText("<ul><li>a</li></ul>"), null);
  assert.deepEqual(parseSimpleText("<h1>What is organizational communication?</h1>"), { block: "h1", text: "What is organizational communication?" });
});

test("colours must be hex codes", () => {
  assert.ok(isHexColor("#fff") && isHexColor("#1A1a1a"));
  assert.ok(!isHexColor("red") && !isHexColor("#ff") && !isHexColor("url(x)") && !isHexColor("#12345g"));
});

// ---- the button action always keeps the keyboard route

test("a button action is always written as a click and a matching keyActivate", () => {
  const t = buildActivation({ kind: "jump", slideId: "slide-002" });
  assert.deepEqual(t.map((x) => x.event), ["click", "keyActivate"]);
  assert.equal(t[0]!.target, t[1]!.target);
  assert.deepEqual(readActivation(t), { kind: "jump", slideId: "slide-002" });
  assert.deepEqual(buildActivation({ kind: "none" }), []);
});

test("triggers the editor cannot show are recognised as custom, not misread", () => {
  const t = buildActivation({ kind: "show", layerId: "layer-1" });
  assert.deepEqual(readActivation(t), { kind: "show", layerId: "layer-1" });
  assert.equal(readActivation([t[0]!]).kind, "custom");
  assert.equal(readActivation([{ ...t[0]!, conditions: [{ variable: "v", operator: "equals", value: 1 }] }, t[1]!]).kind, "custom");
  assert.equal(readActivation([{ ...t[0]!, action: "setVariable" }, { ...t[1]!, action: "setVariable" }]).kind, "custom");
});

// ---- objects

test("a new text box is visible, tabbable, and selected", () => {
  const m = open();
  const o = m.addObject("text")!;
  assert.equal(o.id, "obj-0022", "ids continue after the highest in the whole project");
  assert.equal(m.sel.objectId, o.id);
  assert.equal(o.accessibility.tabOrder, 4);
  assert.equal(o.accessibility.decorative, false);
  assert.ok(o.geometry.z > 30);
  assert.equal(m.dirty, true);
});

test("a new image keeps its alt text empty for the author to write", () => {
  const m = open();
  const o = m.addObject("image", { imageSrc: "assets/images/pic.png", size: { w: 2000, h: 1000 } })!;
  assert.equal(o.accessibility.altText, "");
  assert.equal(o.accessibility.decorative, false);
  assert.equal(o.content["src"], "assets/images/pic.png");
  assert.ok(o.geometry.width <= 640 && o.geometry.height <= 400, "large images are fitted to the slide");
  assert.equal(o.geometry.width / o.geometry.height, 2);
});

test("a new shape is decorative and outside the tab order", () => {
  const m = open();
  const o = m.addObject("shape")!;
  assert.equal(o.accessibility.decorative, true);
  assert.equal(o.accessibility.tabOrder, 0);
  assert.equal(o.accessibility.altText, "");
});

test("a new button does nothing until given an action, and has no mouse-only trigger", () => {
  const m = open();
  const o = m.addObject("button")!;
  assert.deepEqual(o.triggers, []);
  m.setActivation(o.id, { kind: "jump", slideId: "slide-002" });
  assert.deepEqual(m.object!.triggers.map((t) => t.event), ["click", "keyActivate"]);
  m.setActivation(o.id, { kind: "none" });
  assert.deepEqual(m.object!.triggers, []);
});

test("a button with custom triggers is left alone", () => {
  const m = open();
  m.selectSlide("slide-002");
  m.selectObject("obj-0011"); // the quiz, not a button
  assert.equal(m.setActivation("obj-0011", { kind: "none" }), null);
  m.selectSlide("slide-001");
  const btn = m.layer!.objects.find((o) => o.id === "obj-0004")!;
  btn.triggers[0]!.conditions = [{ variable: "var-attempts", operator: "lessThan", value: 3 }];
  assert.equal(m.setActivation("obj-0004", { kind: "none" }), null);
  assert.equal(btn.triggers.length, 2, "custom triggers untouched");
});

test("deleting an object renumbers the tab order and clears the selection", () => {
  const m = open();
  m.selectObject("obj-0002");
  m.deleteObject("obj-0002");
  assert.equal(m.sel.objectId, null);
  assert.deepEqual(m.objects.filter((o) => (o.accessibility.tabOrder ?? 0) > 0).map((o) => [o.id, o.accessibility.tabOrder]), [["obj-0001", 1], ["obj-0004", 2]]);
});

test("adding then deleting an object can be undone step by step", () => {
  const m = open();
  const before = m.objects.length;
  const o = m.addObject("text")!;
  m.deleteObject(o.id);
  assert.equal(m.objects.length, before);
  m.undo();
  assert.equal(m.objects.length, before + 1);
  m.undo();
  assert.equal(m.objects.length, before);
  assert.equal(m.dirty, false);
});

test("editing text, a label and colours", () => {
  const m = open();
  m.selectObject("obj-0001");
  assert.equal(m.setText("obj-0001", { block: "h2", text: "A new heading" }), "Text updated");
  assert.equal(m.object!.content["html"], "<h2>A new heading</h2>");
  m.selectObject("obj-0004");
  assert.equal(m.setLabel("obj-0004", "Go on"), "Label updated");
  assert.equal(m.setLabel("obj-0004", "  "), null, "an empty label is refused");
  assert.deepEqual(m.setStyle("obj-0004", "fill", "#112233"), { ok: true, message: "Style updated" });
  assert.equal(m.object!.style["fill"], "#112233");
  assert.equal(m.setStyle("obj-0004", "fill", "blue").ok, false);
  assert.equal(m.setStyle("obj-0004", "fontSize", "2").ok, false);
  assert.equal(m.setStyle("obj-0004", "fontSize", "24").ok, true);
  m.setStyle("obj-0004", "fill", "");
  assert.equal("fill" in m.object!.style, false, "an empty value removes the style");
});

// ---- slides

test("a new slide is added after the current one, in the same scene, and selected", () => {
  const m = open();
  const s = m.addSlide();
  assert.equal(s.id, "slide-003");
  assert.deepEqual(m.project.scenes[0]!.slides, ["slide-001", "slide-003", "slide-002"]);
  assert.deepEqual(m.slides.map((x) => x.id), ["slide-001", "slide-003", "slide-002"]);
  assert.equal(m.sel.slideId, "slide-003");
  assert.equal(m.slide!.baseLayer.id, "layer-base");
});

test("a new slide is saved with project.json, and a deleted slide's file is removed", () => {
  const m = open();
  m.addSlide();
  const files = m.dirtyFiles();
  assert.deepEqual(files.map((f) => f.path).sort(), ["project.json", "slides/slide-003.json"]);
  assert.deepEqual(m.removedFiles(), []);
  m.markSaved(files);
  assert.equal(m.dirty, false);

  m.deleteSlide("slide-003");
  assert.equal(m.dirty, true);
  assert.deepEqual(m.removedFiles(), ["slides/slide-003.json"]);
  assert.deepEqual(m.dirtyFiles().map((f) => f.path), ["project.json"]);
  m.markSaved(m.dirtyFiles());
  assert.equal(m.dirty, false);
  assert.deepEqual(m.removedFiles(), []);
});

test("adding and deleting before saving leaves no trace", () => {
  const m = open();
  const s = m.addSlide();
  m.deleteSlide(s.id);
  assert.deepEqual(m.removedFiles(), []);
  assert.deepEqual(m.dirtyFiles(), []);
  assert.equal(m.dirty, false);
});

test("the last slide cannot be deleted", () => {
  const m = open();
  m.deleteSlide("slide-002");
  assert.match(m.deleteSlide("slide-001") ?? "", /at least one slide/);
  assert.equal(m.slides.length, 1);
});

test("deleting the selected slide selects its neighbour", () => {
  const m = open();
  m.selectSlide("slide-001");
  m.deleteSlide("slide-001");
  assert.equal(m.sel.slideId, "slide-002");
});

test("undoing a slide deletion brings it back, and it is rewritten on the next save", () => {
  const m = open();
  m.deleteSlide("slide-002");
  m.markSaved(m.dirtyFiles());
  m.undo();
  assert.deepEqual(m.slides.map((s) => s.id), ["slide-001", "slide-002"]);
  assert.deepEqual(m.project.scenes[0]!.slides, ["slide-001", "slide-002"]);
  assert.ok(m.dirtyFiles().some((f) => f.path === "slides/slide-002.json"), "the file has to be written again");
});

test("slides can be reordered, which changes the order the scenes list them", () => {
  const m = open();
  assert.match(m.moveSlide("slide-002", -1) ?? "", /slide 1 of 2/);
  assert.deepEqual(m.slides.map((s) => s.id), ["slide-002", "slide-001"]);
  assert.deepEqual(m.project.scenes[0]!.slides, ["slide-002", "slide-001"]);
  assert.match(m.moveSlide("slide-002", -1) ?? "", /already first/);
  assert.deepEqual(m.dirtyFiles().map((f) => f.path), ["project.json"], "only the scene order changed");
});

test("slides and layers can be renamed", () => {
  const m = open();
  assert.equal(m.renameSlide("slide-001", "Intro"), "Renamed to Intro");
  assert.equal(m.renameSlide("slide-001", "  "), null);
  m.selectSlide("slide-002");
  assert.equal(m.renameLayer("layer-retry", "Try again"), "Renamed to Try again");
  assert.equal(m.layers.find((l) => l.id === "layer-retry")!.name, "Try again");
});

// ---- layers

test("a new layer is selected, and the base layer cannot be deleted", () => {
  const m = open();
  const l = m.addLayer()!;
  assert.equal(l.id, "layer-1");
  assert.equal(m.sel.layerId, "layer-1");
  assert.match(m.deleteLayer("layer-base") ?? "", /base layer cannot/);
  m.deleteLayer("layer-1");
  assert.equal(m.sel.layerId, "layer-base");
  assert.equal(m.dirty, false, "adding then deleting leaves the slide exactly as it was");
  m.undo();
  assert.equal(m.layers.length, 2, "undo brings the layer back");
  assert.equal(m.dirty, true);
  m.undo();
  assert.equal(m.dirty, false);
});

test("a deleted layer's objects go with it, and undo restores them", () => {
  const m = open();
  m.selectSlide("slide-002");
  m.deleteLayer("layer-correct");
  assert.equal(m.layers.some((l) => l.id === "layer-correct"), false);
  assert.equal(m.locate("slide-002", "obj-0020"), null);
  m.undo();
  assert.ok(m.locate("slide-002", "obj-0020"));
});

// ---- headings and fonts

test("choosing a heading level changes the size as well as the tag, in one undo step", () => {
  const m = open();
  m.selectObject("obj-0002"); // the body text, a paragraph at 22
  assert.equal(m.object!.style["fontSize"], 22);
  m.setBlock("obj-0002", "h2", "Body text");
  assert.equal(m.object!.content["html"], "<h2>Body text</h2>");
  assert.equal(m.object!.style["fontSize"], 36);
  m.setBlock("obj-0002", "h1", "Body text");
  assert.equal(m.object!.style["fontSize"], 44);
  m.setBlock("obj-0002", "h6", "Body text");
  assert.equal(m.object!.style["fontSize"], 20);
  m.setBlock("obj-0002", "p", "Body text");
  assert.equal(m.object!.style["fontSize"], 22);
  assert.equal(m.object!.content["html"], "<p>Body text</p>");
});

test("every heading level gets a different size from the next, and from a paragraph where it matters", () => {
  const sizes = [BLOCK_SIZES.h1, BLOCK_SIZES.h2, BLOCK_SIZES.h3, BLOCK_SIZES.h4, BLOCK_SIZES.h5, BLOCK_SIZES.h6];
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i]! < sizes[i - 1]!, `h${i + 1} should be smaller than h${i}`);
  assert.ok(BLOCK_SIZES.h1 > BLOCK_SIZES.p && BLOCK_SIZES.h3 > BLOCK_SIZES.p);
});

test("a heading change can be undone and the size goes back with it", () => {
  const m = open();
  m.selectObject("obj-0002");
  m.setBlock("obj-0002", "h1", "x");
  m.undo();
  assert.equal(m.object!.style["fontSize"], 22);
  assert.match(String(m.object!.content["html"]), /^<p>/);
});

test("the author can still set their own size after choosing a heading", () => {
  const m = open();
  m.selectObject("obj-0002");
  m.setBlock("obj-0002", "h2", "x");
  assert.equal(m.setStyle("obj-0002", "fontSize", "40").ok, true);
  assert.equal(m.object!.style["fontSize"], 40);
});

test("font choices are stored on the object and refused if they are not font names", () => {
  const m = open();
  m.selectObject("obj-0001");
  const georgia = FONT_CHOICES.find((f) => f.label.startsWith("Georgia"))!.value;
  assert.equal(m.setStyle("obj-0001", "fontFamily", georgia).ok, true);
  assert.equal(m.object!.style["fontFamily"], georgia);
  assert.equal(m.setStyle("obj-0001", "fontFamily", "x; background:url(http://evil)").ok, false);
  assert.equal(m.object!.style["fontFamily"], georgia, "a refused value changes nothing");
  assert.ok(FONT_CHOICES.every((f) => isFontValue(f.value)), "every listed font passes the player's own check");
});
