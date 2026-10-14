// Editing a theme: the colours, the checks on them, the name it is saved under, and the logo.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Theme, ThemeLogo } from "../../player/src/types.ts";
import { Model } from "./model.ts";
import { contrastReport, contrastSummary, draftProblems, editedName, logoFromImage, normaliseHex, resizeLogo, setColor, setFont, startingFrom, themeId } from "./themeedit.ts";
import { BUILT_IN_THEMES, cloneTheme } from "./themes.ts";
import { newProjectFiles } from "./template.ts";

const classic = BUILT_IN_THEMES.find((t) => t.id === "classic")!;
const slate = BUILT_IN_THEMES.find((t) => t.id === "slate")!;
const logo = (over: Partial<ThemeLogo> = {}): ThemeLogo => ({ src: "assets/images/logo.png", alt: "New Paltz logo", decorative: false, corner: "top-right", width: 120, height: 60, ...over });

test("a hex colour is accepted in the forms people write it, and written one way", () => {
  assert.equal(normaliseHex("#1A2B3C"), "#1a2b3c");
  assert.equal(normaliseHex("1a2b3c"), "#1a2b3c");
  assert.equal(normaliseHex("  #abc "), "#aabbcc");
  for (const bad of ["", "#12", "#1234567", "blue", "#gggggg", "rgb(1,2,3)"]) assert.equal(normaliseHex(bad), null, bad);
});

test("the contrast report checks the seven pairs the validator checks, and every built-in theme passes it", () => {
  const r = contrastReport(classic);
  assert.equal(r.length, 7);
  assert.deepEqual(r.map((p) => p.label).slice(0, 2), ["Text against Background", "Quiet text against Background"]);
  for (const t of BUILT_IN_THEMES) assert.ok(contrastReport(t).every((p) => p.ok), `${t.name} should be readable`);
  assert.equal(contrastSummary(classic), "All of the colours that are used together are easy to read.");
});

test("a colour that is hard to read on its background is named in plain words", () => {
  const bad = setColor(classic, "text", "#cccccc");
  const failing = contrastReport(bad).filter((p) => !p.ok);
  assert.ok(failing.some((p) => p.fg === "text" && p.bg === "background"));
  const said = contrastSummary(bad);
  assert.match(said, /hard to read: Text against Background \(\d\.\d to 1\)/);
  assert.match(said, /WCAG AA asks for 4\.5 to 1\./);
  assert.match(contrastSummary(setColor(setColor(classic, "text", "#cccccc"), "muted", "#dddddd")), /^\d pairs are hard to read/);
});

test("changing a colour or a font makes a changed copy and leaves the theme alone", () => {
  const before = JSON.stringify(classic);
  const a = setColor(classic, "accent", "#FF0000");
  assert.equal(a.colors.accent, "#ff0000");
  assert.equal(classic.colors.accent, JSON.parse(before).colors.accent, "the original is untouched");
  assert.equal(setColor(classic, "accent", "banana"), classic, "a value that is not a colour changes nothing");
  assert.equal(setFont(classic, "heading", "Georgia, serif").fonts.heading, "Georgia, serif");
  assert.equal(JSON.stringify(classic), before);
});

test("a theme is saved under a name of its own, and an id made from it that no built-in theme has", () => {
  assert.equal(themeId("My Theme!"), "my-theme");
  assert.equal(themeId("  2026 Spring "), "spring", "an id starts with a letter");
  assert.equal(themeId("!!!"), "custom");
  assert.equal(themeId("Classic"), "classic-2", "not a built-in's id");
  assert.equal(themeId("Classic", ["classic", "classic-2"]), "classic-3");
  assert.equal(editedName(slate), "Slate (edited)");
  assert.equal(editedName({ ...slate, name: "Slate (edited)" }), "Slate (edited)", "editing it again does not pile up the word");
});

test("starting from a built-in theme copies it under a new name; starting from the project's own theme keeps it", () => {
  const project = cloneTheme(classic);
  const fromSlate = startingFrom(slate, project);
  assert.equal(fromSlate.name, "Slate (edited)");
  assert.equal(fromSlate.id, "slate-edited");
  assert.deepEqual(fromSlate.colors, slate.colors);
  assert.equal(slate.name, "Slate", "the built-in is untouched");
  const same = startingFrom(project, project);
  assert.deepEqual(same, project);
  assert.notEqual(same, project, "a copy");
});

test("the logo the project has comes along when the colours are started from another theme", () => {
  const withLogo = { ...cloneTheme(classic), logo: logo() };
  assert.deepEqual(startingFrom(slate, withLogo).logo, logo());
  assert.equal("logo" in startingFrom(slate, classic), false, "and there is none if the project had none");
  assert.equal("logo" in startingFrom(slate, cloneTheme(classic)), false);
});

test("a draft is held back for what is wrong with it, but poor contrast is only shown", () => {
  assert.deepEqual(draftProblems(classic), []);
  assert.deepEqual(draftProblems(setColor(classic, "text", "#cccccc")), [], "the author decides");
  assert.deepEqual(draftProblems({ ...classic, name: "  " }), ["Give the theme a name."]);
  const broken = cloneTheme(classic);
  broken.colors.accent = "red";
  broken.fonts.body = "<script>";
  const said = draftProblems(broken);
  assert.match(said[0]!, /^Accent is not a colour/);
  assert.match(said[1]!, /body font is not usable/);
  assert.deepEqual(draftProblems({ ...classic, logo: logo({ alt: "" }) }), ["The logo needs alt text, or tick that it is decorative."]);
  assert.deepEqual(draftProblems({ ...classic, logo: logo({ decorative: true, alt: "x" }) }), ["A decorative logo has no alt text. Clear it, or untick decorative."]);
  assert.deepEqual(draftProblems({ ...classic, logo: logo({ decorative: true, alt: "" }) }), []);
});

test("a logo starts no wider than 160, in the shape of its picture, inside the limits, with no alt text yet", () => {
  assert.deepEqual(logoFromImage("assets/images/a.png", { width: 500, height: 500 }), logo({ src: "assets/images/a.png", alt: "", width: 160, height: 160 }));
  assert.deepEqual(logoFromImage("assets/images/a.png", { width: 50, height: 40 }), logo({ src: "assets/images/a.png", alt: "", width: 50, height: 40 }), "never larger than the picture");
  const tall = logoFromImage("assets/images/a.png", { width: 100, height: 1000 });
  assert.deepEqual([tall.width, tall.height], [24, 200], "a very tall picture reaches the greatest height first");
  const wide = logoFromImage("assets/images/a.png", { width: 2000, height: 100 });
  assert.deepEqual([wide.width, wide.height], [160, 24], "a very flat picture reaches the least height first");
  const unknown = logoFromImage("assets/images/a.svg", { width: 0, height: 0 });
  assert.deepEqual([unknown.width, unknown.height], [160, 80], "a picture with no size of its own gets a plain one");
  assert.equal(logoFromImage("assets/images/a.png", { width: 10, height: 10 }, "bottom-left").corner, "bottom-left");
});

test("resizing a logo keeps its shape and stays inside the limits", () => {
  const l = logo({ width: 120, height: 60 });
  assert.deepEqual([resizeLogo(l, 240).width, resizeLogo(l, 240).height], [240, 120]);
  assert.deepEqual([resizeLogo(l, 10).width, resizeLogo(l, 10).height], [24, 24], "no smaller than 24 each way");
  assert.equal(resizeLogo(l, 5000).width, 400);
  assert.equal(resizeLogo(l, 5000).height, 200);
  assert.equal(resizeLogo(logo({ width: 100, height: 100 }), 390).height, 200, "a tall logo stops at the greatest height");
  assert.equal(resizeLogo(l, 240).src, l.src, "everything else is kept");
});

// ---- the model

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-13" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

test("an edited theme is the project's own, saved in theme.json, in one undo step", () => {
  const m = fresh();
  const mine = setColor(startingFrom(slate, m.theme), "accent", "#ff6600");
  assert.equal(m.setTheme(mine), `Theme changed to Slate (edited)`);
  assert.equal(m.theme.name, "Slate (edited)");
  const file = JSON.parse(m.allFiles().find((f) => f.path === "theme.json")!.text) as Theme;
  assert.equal(file.colors.accent, "#ff6600");
  assert.equal(file.id, "slate-edited");
  m.undo();
  assert.equal(m.theme.id, "classic");
  m.redo();
  assert.equal(m.theme.colors.accent, "#ff6600");
  assert.equal(BUILT_IN_THEMES.find((t) => t.id === "slate")!.colors.accent, slate.colors.accent, "the built-in theme is never changed");
});

test("a logo is saved in theme.json, and choosing another built-in theme keeps it, and says so", () => {
  const m = fresh();
  m.setTheme({ ...cloneTheme(m.theme), logo: logo() });
  const file = JSON.parse(m.allFiles().find((f) => f.path === "theme.json")!.text) as Theme;
  assert.deepEqual(file.logo, logo());
  const msg = m.setTheme(slate, true);
  assert.equal(msg, "Theme changed to Slate. The logo was kept.");
  assert.deepEqual(m.theme.logo, logo());
  m.setTheme(classic);
  assert.equal(m.theme.logo, undefined, "without the carrying on, a theme brings only its own");
});

test("choosing the theme the project already has changes nothing", () => {
  const m = fresh();
  assert.equal(m.setTheme(classic, true), null);
  assert.equal(m.canUndo, false);
});

test("the real shared rules are the ones the editor reports on", () => {
  const rules = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "tools", "theme-rules.json"), "utf-8")) as { pairs: string[][] };
  assert.deepEqual(contrastReport(classic).map((p) => [p.fg, p.bg]), rules.pairs);
});
