// Tests for themes in the editor: switching them, theme colours on objects, slide backgrounds, and
// that everything the editor makes stays readable in every built-in theme.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { contrastRatio } from "./content.ts";
import { NEW_OPTIONS, SLIDE_LAYOUTS, toneOf } from "./factory.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";
import { BUILT_IN_THEMES } from "./themes.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");

function fresh(theme = BUILT_IN_THEMES[0]!): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-10", theme });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const styles = (m: Model) => m.slides.flatMap((s) => [s.baseLayer, ...s.layers].flatMap((l) => l.objects.map((o) => ({ o, s: o.style }))));

// ---- the built-in themes

test("there are at least eight built-in themes, each with a distinct id and name", () => {
  assert.ok(BUILT_IN_THEMES.length >= 8);
  assert.equal(new Set(BUILT_IN_THEMES.map((t) => t.id)).size, BUILT_IN_THEMES.length);
  assert.equal(new Set(BUILT_IN_THEMES.map((t) => t.name)).size, BUILT_IN_THEMES.length);
});

test("every built-in theme's text colours meet WCAG AA on what they sit on", () => {
  const pairs = [["text", "background"], ["muted", "background"], ["text", "surface"], ["onAccentStrong", "accentStrong"], ["onDark", "dark"], ["good", "background"], ["bad", "background"]] as const;
  for (const t of BUILT_IN_THEMES) for (const [fg, bg] of pairs) {
    assert.ok(contrastRatio(t.colors[fg], t.colors[bg]) >= 4.5, `${t.name}: ${fg} on ${bg}`);
  }
});

// ---- switching the theme

test("switching the theme replaces it, gives the project a theme file, and is one undo step", () => {
  const m = fresh();
  const forest = BUILT_IN_THEMES.find((t) => t.id === "forest")!;
  assert.equal(m.dirty, false);
  assert.match(m.setTheme(forest) ?? "", /Forest/);
  assert.equal(m.theme.id, "forest");
  assert.equal(m.dirty, true);
  m.undo();
  assert.equal(m.theme.id, "classic");
  assert.equal(m.dirty, false);
  m.redo();
  assert.equal(m.theme.id, "forest");
});

test("choosing the theme you already have changes nothing", () => {
  const m = fresh();
  assert.equal(m.setTheme(BUILT_IN_THEMES[0]!), null);
  assert.equal(m.dirty, false);
});

test("a changed theme is saved to theme.json, and only that, until the slides change too", () => {
  const m = fresh();
  m.setTheme(BUILT_IN_THEMES.find((t) => t.id === "ocean")!);
  const files = m.dirtyFiles();
  assert.deepEqual(files.map((f) => f.path), ["theme.json"]);
  assert.equal(JSON.parse(files[0]!.text).id, "ocean");
  m.markSaved(files);
  assert.equal(m.dirty, false);
  assert.deepEqual(m.dirtyFiles(), []);
});

test("the theme is part of what gets validated before saving", () => {
  const m = fresh();
  m.setTheme(BUILT_IN_THEMES.find((t) => t.id === "berry")!);
  const themeFile = m.allFiles().find((f) => f.path === "theme.json")!;
  assert.equal(JSON.parse(themeFile.text).id, "berry");
});

test("a project opened without a theme file looks like Classic, and gets a file only when the theme is changed", () => {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-10" });
  const project = JSON.parse(files[0]!.text);
  project.theme = null;
  const m = new Model({ dir: "x", project: JSON.stringify(project), theme: null, slides: [{ id: "slide-001", text: files[2]!.text }] });
  assert.equal(m.theme.id, "classic");
  assert.equal(m.allFiles().some((f) => f.path === "theme.json"), false);
  assert.equal(m.dirty, false);
  m.setTheme(BUILT_IN_THEMES.find((t) => t.id === "slate")!);
  assert.deepEqual(m.project.theme, { ref: "theme.json" });
  assert.deepEqual(m.dirtyFiles().map((f) => f.path).sort(), ["project.json", "theme.json"]);
});

// ---- objects follow the theme

test("everything the layouts make refers to the theme and uses no fixed colour", () => {
  const m = fresh();
  for (const l of SLIDE_LAYOUTS) m.addSlide(l.id);
  for (const { o, s } of styles(m)) {
    for (const key of ["color", "fill", "fontFamily"]) {
      if (s[key] !== undefined) assert.match(String(s[key]), /^theme:/, `${o.name}.${key} is a theme reference`);
    }
  }
});

test("things added by hand follow the theme too", () => {
  const m = fresh();
  for (const o of NEW_OPTIONS) {
    if (o.value === "image") continue;
    if (o.value.startsWith("quiz:")) m.addQuiz(o.value.slice(5) as "mc" | "tf");
    else if (o.value.startsWith("shape:")) m.addObject("shape", { shape: o.value.slice(6) });
    else if (o.value.startsWith("content:")) m.addObject(o.value.slice(8) as "table" | "scrollingText");
    else m.addObject(o.value as "text" | "button");
  }
  for (const { o, s } of styles(m)) {
    for (const key of ["color", "fill", "fontFamily"]) {
      if (s[key] !== undefined) assert.match(String(s[key]), /^theme:/, `${o.name}.${key}`);
    }
  }
});

test("a theme colour can be chosen for an object, a made-up one cannot", () => {
  const m = fresh();
  const o = m.addObject("text")!;
  assert.equal(m.setStyle(o.id, "color", "theme:color.accent").ok, true);
  assert.equal(m.object!.style["color"], "theme:color.accent");
  assert.equal(m.setStyle(o.id, "color", "theme:color.nope").ok, false);
  assert.equal(m.setStyle(o.id, "color", "theme:font.body").ok, false, "a font is not a colour");
  assert.equal(m.setStyle(o.id, "fontFamily", "theme:font.heading").ok, true);
  assert.equal(m.setStyle(o.id, "fontFamily", "theme:color.text").ok, false, "a colour is not a font");
  assert.equal(m.setStyle(o.id, "fontSize", "theme:color.text").ok, false);
  assert.equal(m.object!.style["color"], "theme:color.accent", "a refused value changes nothing");
});

test("text that follows the theme's fonts switches between the heading and body font with its style", () => {
  const m = fresh();
  const o = m.addObject("text")!;
  assert.equal(o.style["fontFamily"], "theme:font.body");
  m.setBlock(o.id, "h2", "Words");
  assert.equal(m.object!.style["fontFamily"], "theme:font.heading");
  m.setBlock(o.id, "p", "Words");
  assert.equal(m.object!.style["fontFamily"], "theme:font.body");
});

test("a font the author chose is not changed when the style changes", () => {
  const m = fresh();
  const o = m.addObject("text")!;
  m.setStyle(o.id, "fontFamily", "Georgia, serif");
  m.setBlock(o.id, "h1", "Words");
  assert.equal(m.object!.style["fontFamily"], "Georgia, serif");
});

// ---- slides remember their layout, and have backgrounds

test("a slide made from a layout remembers it and takes its background", () => {
  const m = fresh();
  assert.equal(m.addSlide("content").layout, "content");
  assert.equal(m.slide!.background, null);
  const title = m.addSlide("title");
  assert.equal(title.layout, "title");
  assert.equal(title.background, "theme:bg.dark");
  assert.equal(m.addSlide("section").background, "theme:bg.accent");
  assert.equal(m.addSlide("blank").layout, "blank");
});

test("changing layout changes what the slide remembers and its background", () => {
  const m = fresh();
  m.addSlide("content");
  m.applyLayout("section");
  assert.equal(m.slide!.layout, "section");
  assert.equal(m.slide!.background, "theme:bg.accent");
  m.applyLayout("two-content");
  assert.equal(m.slide!.layout, "two-content");
  assert.equal(m.slide!.background, null);
});

test("moving to a dark layout turns the theme-coloured text light, and back again turns it dark", () => {
  const m = fresh();
  m.addSlide("content");
  const first = m.slide!.baseLayer.objects.find((o) => o.name === "Title")!;
  m.setText(first.id, { block: "h1", text: "My title" });
  const title = () => m.slide!.baseLayer.objects.find((o) => o.id === first.id)!.style["color"];
  assert.equal(title(), "theme:color.text");
  m.applyLayout("title");
  assert.equal(title(), "theme:color.onDark");
  m.applyLayout("section");
  assert.equal(title(), "theme:color.onAccentStrong");
  m.applyLayout("content");
  assert.equal(title(), "theme:color.text");
});

test("a colour the author chose survives a change to a dark layout", () => {
  const m = fresh();
  m.addSlide("content");
  const title = m.slide!.baseLayer.objects.find((o) => o.name === "Title")!;
  m.setText(title.id, { block: "h1", text: "My title" });
  m.setStyle(title.id, "color", "#ff00ff");
  m.applyLayout("title");
  assert.equal(m.slide!.baseLayer.objects.find((o) => o.id === title.id)!.style["color"], "#ff00ff");
});

test("a placeholder nobody has written in is replaced by the new layout's own, even if it was recoloured", () => {
  const m = fresh();
  m.addSlide("content");
  const title = m.slide!.baseLayer.objects.find((o) => o.name === "Title")!;
  m.setStyle(title.id, "color", "#ff00ff");
  m.applyLayout("title");
  assert.equal(m.slide!.baseLayer.objects.some((o) => o.id === title.id), false);
  assert.equal(m.slide!.baseLayer.objects.find((o) => o.name === "Title")!.style["color"], "theme:color.onDark");
});

test("text added to a dark slide is light, and on an accent slide uses the accent slide's text colour", () => {
  const m = fresh();
  m.addSlide("title");
  assert.equal(m.addObject("text")!.style["color"], "theme:color.onDark");
  m.addSlide("section");
  assert.equal(m.addObject("text")!.style["color"], "theme:color.onAccentStrong");
  m.addSlide("content");
  assert.equal(m.addObject("text")!.style["color"], "theme:color.text");
});

test("a question added to a dark slide is readable there, including its feedback", () => {
  const m = fresh();
  m.addSlide("title");
  m.addQuiz("mc");
  for (const { o, s } of styles(m).filter((x) => x.o.type === "text" || x.o.type === "quizQuestion")) {
    if (o.name === "Title" || o.name === "Subtitle") continue;
    assert.equal(s["color"], "theme:color.onDark", `${o.name} is light on the dark slide`);
  }
});

test("a slide's background can be set, and only to something real", () => {
  const m = fresh();
  assert.equal(m.setSlideBackground("slide-001", "theme:bg.accent"), "Background updated");
  assert.equal(m.slide!.background, "theme:bg.accent");
  assert.equal(m.setSlideBackground("slide-001", "theme:bg.nope"), null);
  assert.equal(m.setSlideBackground("slide-001", "red"), null);
  assert.equal(m.setSlideBackground("slide-001", "#123456"), "Background updated");
  assert.equal(m.setSlideBackground("slide-001", null), "Background updated");
  assert.equal(m.setSlideBackground("slide-001", null), null, "no change, no undo step");
});

test("changing a slide's background re-colours the text that follows the theme, and undo puts it back", () => {
  const m = fresh();
  m.addSlide("content");
  const body = () => m.slide!.baseLayer.objects.find((o) => o.name === "Content")!.style["color"];
  assert.equal(body(), "theme:color.text");
  m.setSlideBackground(m.slide!.id, "theme:bg.dark");
  assert.equal(body(), "theme:color.onDark");
  m.undo();
  assert.equal(body(), "theme:color.text");
  assert.equal(m.slide!.background, null);
});

test("a plain-colour background gets light or dark text, whichever reads better", () => {
  const m = fresh();
  m.addSlide("content");
  m.setSlideBackground(m.slide!.id, "#101820");
  assert.equal(m.addObject("text")!.style["color"], "theme:color.onDark");
  m.setSlideBackground(m.slide!.id, "#f0f0f0");
  assert.equal(m.addObject("text")!.style["color"], "theme:color.text");
});

test("tone comes from the theme background named, not from how dark the theme happens to be", () => {
  assert.equal(toneOf(null), "light");
  assert.equal(toneOf("theme:bg.dark"), "dark");
  assert.equal(toneOf("theme:bg.accent"), "accent");
  assert.equal(toneOf("#000000", () => false), "dark");
  assert.equal(toneOf("#ffffff", () => true), "light");
});

// ---- the whole thing, with the real validator

test("every layout, shape and question reads well in every built-in theme (real validator)", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  for (const l of SLIDE_LAYOUTS) {
    m.addSlide(l.id);
    m.addObject("text");
    m.addObject("button");
    m.addObject("shape", { shape: "ellipse" });
  }
  m.addSlide("title");
  m.addQuiz("mc");
  m.addSlide("section");
  m.addQuiz("tf");
  m.addSlide("content");
  m.addQuiz("mc");
  m.selectSlide(m.slides[0]!.id);

  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-themes-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const theme of BUILT_IN_THEMES) {
      m.setTheme(theme);
      for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
      const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
      const errors = (JSON.parse(r.stdout) as { severity: string; rule: string; object_id: string; detail: string }[]).filter((f) => f.severity === "error");
      assert.deepEqual(errors, [], `${theme.name}: ${JSON.stringify(errors.slice(0, 3))}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the example project reads well in every built-in theme once it uses theme colours", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const text = readFileSync(path.join(repo, "examples", "minimal.osproj", "theme.json"), "utf-8");
  assert.equal(JSON.parse(text).id, "classic");
});
