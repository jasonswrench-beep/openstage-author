// Icons, button looks and the buttons that move around the course: the list and its search, the Model's edits, rules, copies, and the real validator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { IconContent } from "../../player/src/types.ts";
import { BUTTON_LOOKS, CUSTOM_LOOK, lookOf, withLook } from "./buttonlooks.ts";
import { buildActivation, isCourseAction, readActivation, readRules, RULE_ACTIONS } from "./content.ts";
import { ADD_MENU, NAVIGATION_BUTTONS } from "./factory.ts";
import { contentOf, forgetIcons, iconWords, loadIcons, parseIconList, scoreIcon, searchIcons } from "./icons.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rawList = JSON.parse(readFileSync(path.join(repo, "editor", "web", "icons", "lucide.json"), "utf-8"));
const list = parseIconList(rawList);

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-13" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const arrow: IconContent = contentOf(list.icons.find((i) => i.name === "arrow-right")!);

// ---- the list and its search

test("the editor's icon list is read in full, with its licence", () => {
  assert.equal(list.set, "lucide");
  assert.ok(list.icons.length > 1500);
  assert.ok(list.licence.includes("ISC License"));
  assert.ok(list.version.length > 0);
});

test("things that are not drawable icons are left out of the list", () => {
  const read = parseIconList({ icons: { good: { t: ["a"], s: [{ tag: "path", d: "M0 0" }] }, bad: { t: [], s: [{ tag: "script" }] }, "Bad Name": { t: [], s: [{ tag: "path", d: "M0 0" }] }, empty: { t: [], s: [] } } });
  assert.deepEqual(read.icons.map((i) => i.name), ["good"]);
  assert.deepEqual(parseIconList(null).icons, []);
  assert.deepEqual(parseIconList({}).icons, []);
});

test("a search finds an icon by its name first, then by what it is about", () => {
  const found = searchIcons(list.icons, "arrow right");
  assert.equal(found[0]!.name, "arrow-right");
  assert.ok(found.length > 3);
  assert.ok(searchIcons(list.icons, "book").some((i) => i.name === "book-open"));
  assert.ok(searchIcons(list.icons, "warning").length > 0, "warning is a search word, not only a name");
});

test("every word of a search has to match, and a word nothing matches finds nothing", () => {
  assert.deepEqual(searchIcons(list.icons, "arrow zzzzqqq"), []);
  assert.equal(scoreIcon(list.icons[0]!, "zzzzqqq"), 0);
  assert.ok(scoreIcon(list.icons.find((i) => i.name === "arrow-right")!, "arrow") > scoreIcon(list.icons.find((i) => i.name === "arrow-right")!, "rrow"));
});

test("an empty search is every icon, by name", () => {
  const all = searchIcons(list.icons, "   ");
  assert.equal(all.length, list.icons.length);
  assert.deepEqual(all.map((i) => i.name), [...all.map((i) => i.name)].sort((a, b) => a.localeCompare(b)));
});

test("an exact name beats a name that only holds the word", () => {
  const found = searchIcons(list.icons, "x");
  assert.equal(found[0]!.name, "x");
});

test("an icon's name as words is only a start for alt text", () => {
  assert.equal(iconWords("arrow-right"), "arrow right");
  assert.equal(iconWords("x"), "x");
});

test("the list is fetched once and shared, and a failed fetch is tried again", async () => {
  forgetIcons();
  let calls = 0;
  const ok = () => { calls++; return Promise.resolve(rawList); };
  const [a, b] = await Promise.all([loadIcons(ok), loadIcons(ok)]);
  assert.equal(a, b);
  assert.equal(calls, 1);
  forgetIcons();
  await assert.rejects(loadIcons(() => Promise.reject(new Error("offline"))), /offline/);
  assert.equal((await loadIcons(ok)).icons.length, list.icons.length, "the next try works");
  forgetIcons();
});

test("the arrows built into the ready-made buttons are the ones in the icon list", () => {
  for (const button of NAVIGATION_BUTTONS) {
    const entry = list.icons.find((i) => i.name === button.icon.name)!;
    assert.ok(entry, button.icon.name);
    assert.deepEqual(button.icon.shapes, entry.shapes, `${button.id}: the same shapes as the icon list`);
  }
});

// ---- adding and changing an icon

test("an icon is added with no alt text, in the theme's colour, and is one undo step", () => {
  const m = fresh();
  const o = m.addIcon(arrow)!;
  assert.equal(o.type, "icon");
  assert.equal(o.accessibility.altText, "", "the author writes it, or marks the icon decorative");
  assert.equal(o.accessibility.decorative, false);
  assert.equal(o.style["color"], "theme:color.accentStrong");
  assert.equal(m.object!.id, o.id);
  assert.deepEqual((o.content as unknown as IconContent).shapes, arrow.shapes);
  assert.equal(o.name, "Icon: arrow right");
  m.undo();
  assert.equal(m.object, null);
});

test("changing the icon keeps its size, colour and alt text, and follows its name only while the name is the editor's own", () => {
  const m = fresh();
  const o = m.addIcon(arrow)!;
  m.setAccessibility(o.id, { altText: "Next" });
  const other = contentOf(list.icons.find((i) => i.name === "arrow-left")!);
  assert.ok(m.changeIcon(o.id, other)!.includes("arrow left"));
  assert.equal(m.object!.accessibility.altText, "Next");
  assert.equal(m.object!.name, "Icon: arrow left");
  m.setName(o.id, "Back arrow");
  m.changeIcon(o.id, arrow);
  assert.equal(m.object!.name, "Back arrow", "a name the author wrote is theirs");
  assert.equal(m.changeIcon(o.id, arrow), null, "no change, nothing to say");
});

test("the Add menu is still short: the icon is in the media picker and the button picker is one entry", () => {
  assert.ok(ADD_MENU.length <= 9);
  assert.equal(ADD_MENU.find((e) => e.value === "group:button")?.label, "Button...");
});

// ---- looks

test("every look uses the theme's colours, and each is told apart by its style", () => {
  const seen = new Set<string>();
  for (const look of BUTTON_LOOKS) {
    assert.ok(look.label && look.description);
    for (const key of ["fill", "color", "stroke"] as const) {
      const v = look.style[key];
      if (v !== undefined) assert.ok(String(v).startsWith("theme:color."), `${look.id}.${key} is a theme colour`);
    }
    seen.add(JSON.stringify(look.style));
  }
  assert.equal(seen.size, BUTTON_LOOKS.length);
});

test("a new button has the Filled look, and a look can be put on and told again", () => {
  const m = fresh();
  const b = m.addObject("button")!;
  assert.equal(m.buttonLook(b.id), "filled");
  assert.ok(m.setButtonLook(b.id, "outline")!.includes("look"));
  assert.equal(m.buttonLook(b.id), "outline");
  assert.equal(m.object!.style["stroke"], "theme:color.accentStrong");
  assert.equal(m.setButtonLook(b.id, "outline"), null, "no change");
  m.setButtonLook(b.id, "filled");
  assert.equal(m.object!.style["stroke"], undefined, "the outline is taken away again");
  assert.equal(m.object!.style["strokeWidth"], undefined);
  m.undo();
  assert.equal(m.buttonLook(b.id), "outline");
});

test("a look changes only colours, outline and roundness: font, size and rules stay", () => {
  const m = fresh();
  const b = m.addNavigationButton("next")!;
  m.setStyle(b.id, "fontSize", "24");
  const before = m.object!;
  m.setButtonLook(b.id, "soft");
  assert.equal(m.object!.style["fontSize"], 24);
  assert.equal(m.object!.style["fontFamily"], before.style["fontFamily"]);
  assert.equal(m.object!.triggers.length, 2);
  assert.equal(m.object!.content["label"], "Next");
});

test("a button whose colours the author set is 'your own colours'", () => {
  assert.equal(lookOf({ fill: "#ff0000", color: "#ffffff", radius: 8 }), CUSTOM_LOOK);
  const m = fresh();
  const b = m.addObject("button")!;
  m.setStyle(b.id, "fill", "#ff0000");
  assert.equal(m.buttonLook(b.id), CUSTOM_LOOK);
  assert.equal(withLook({ fill: "#ff0000" }, "no-such-look"), null);
});

// ---- the icon on a button

test("a button can show an icon before or after its words, and lose it again", () => {
  const m = fresh();
  const b = m.addObject("button")!;
  assert.ok(m.setButtonIcon(b.id, arrow)!.includes("arrow right"));
  assert.equal((m.object!.content["icon"] as IconContent).name, "arrow-right");
  assert.equal(m.object!.content["label"], "Button", "the words are still the name");
  assert.equal(m.setButtonIcon(b.id, arrow), null);
  assert.ok(m.setButtonIconPlacement(b.id, "after")!.includes("after"));
  assert.equal(m.object!.content["iconPlacement"], "after");
  assert.ok(m.setButtonIconPlacement(b.id, "before"));
  assert.equal("iconPlacement" in m.object!.content, false, "before is the default and is not written");
  assert.equal(m.setButtonIconPlacement(b.id, "before"), null);
  m.setButtonIconPlacement(b.id, "after");
  assert.ok(m.setButtonIcon(b.id, null)!.includes("Took"));
  assert.equal("icon" in m.object!.content, false);
  assert.equal("iconPlacement" in m.object!.content, false, "the side goes with the icon");
  assert.equal(m.setButtonIconPlacement(b.id, "after"), null, "there is no icon to place");
});

// ---- the ready-made buttons

test("each ready-made button has its words, its icon, and a rule for the mouse and the keyboard", () => {
  for (const choice of NAVIGATION_BUTTONS) {
    const m = fresh();
    const o = m.addNavigationButton(choice.id)!;
    assert.equal(o.type, "button");
    assert.equal(o.content["label"], choice.label);
    assert.equal(o.accessibility.altText, choice.label, "the name is its words");
    assert.ok((o.accessibility.tabOrder ?? 0) >= 1, "it can be reached by keyboard");
    assert.deepEqual(readActivation(o.triggers), { kind: choice.id });
    assert.deepEqual(o.triggers.map((t) => t.event), ["click", "keyActivate"]);
    assert.deepEqual(o.triggers.map((t) => t.target), ["", ""]);
    assert.equal(new Set(o.triggers.map((t) => t.id)).size, 2);
    assert.equal(m.buttonLook(o.id), "filled");
  }
  assert.equal(fresh().addNavigationButton("sideways"), null);
});

test("the ready-made buttons have different trigger actions", () => {
  const actions = NAVIGATION_BUTTONS.map((b) => buildActivation({ kind: b.id })[0]!.action);
  assert.deepEqual(actions, ["nextSlide", "previousSlide", "replaySlide"]);
});

// ---- rules with the course actions

test("the three course actions are rule actions that have no target", () => {
  assert.ok(RULE_ACTIONS.includes("nextSlide") && RULE_ACTIONS.includes("previousSlide") && RULE_ACTIONS.includes("replaySlide"));
  assert.ok(isCourseAction("nextSlide") && !isCourseAction("jumpToSlide"));
  const m = fresh();
  const b = m.addObject("button")!;
  assert.deepEqual(m.targetsFor(b.id, "nextSlide"), []);
});

test("a rule can be changed to go to the next slide, and back to a rule that needs a target", () => {
  const m = fresh();
  m.addSlide("content");
  m.selectSlide("slide-001");
  const b = m.addObject("button")!;
  assert.ok(m.addRule(b.id));
  assert.ok(m.updateRule(b.id, 0, { action: "nextSlide" }));
  let rule = readRules(m.object!.triggers)[0]!;
  assert.equal(rule.kind === "rule" && rule.rule.action, "nextSlide");
  assert.deepEqual(m.object!.triggers.map((t) => t.target), ["", ""]);
  assert.ok(m.updateRule(b.id, 0, { action: "jumpToSlide" }));
  rule = readRules(m.object!.triggers)[0]!;
  assert.ok(rule.kind === "rule" && rule.rule.target !== "", "a slide to go to is chosen again");
});

test("a copy of a Next button still goes to the next slide, and is not dropped", () => {
  const m = fresh();
  const b = m.addNavigationButton("next")!;
  m.duplicate();
  const copy = m.object!;
  assert.notEqual(copy.id, b.id);
  assert.deepEqual(readActivation(copy.triggers), { kind: "next" });
  m.addSlide("content");
  m.selectSlide("slide-001");
  m.selectObject(b.id);
  m.duplicateSlide("slide-001");
  const copy2 = m.slides.find((s) => !["slide-001", "slide-002"].includes(s.id))!;
  const copied = copy2.baseLayer.objects.filter((o) => o.type === "button");
  assert.ok(copied.length >= 2);
  for (const o of copied) assert.deepEqual(readActivation(o.triggers), { kind: "next" }, "the course action survives copying a slide");
});

// ---- the real validator

type Finding = { severity: string; rule: string; message: string };

function validate(m: Model): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-icon-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("icons, buttons with icons and the ready-made buttons pass the real validator", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  m.addSlide("content");
  m.selectSlide("slide-001");
  const icon = m.addIcon(arrow)!;
  m.setAccessibility(icon.id, { altText: "Next" });
  const b = m.addObject("button")!;
  m.setButtonIcon(b.id, arrow);
  m.setButtonLook(b.id, "outline");
  for (const choice of NAVIGATION_BUTTONS) m.addNavigationButton(choice.id);
  const errors = validate(m).filter((f) => f.severity === "error");
  assert.deepEqual(errors, []);
});

test("an icon with no alt text is reported, and a Next button on the last slide is a warning", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  m.addIcon(arrow);
  const found = validate(m);
  assert.ok(found.some((f) => f.rule === "alt-text-missing"), "the author must say what the icon means");
  const n = fresh();
  n.addNavigationButton("next");
  assert.ok(validate(n).some((f) => f.rule === "trigger-next-last" && f.severity === "warning"), "this is the only slide");
});

test("a Next button put on the first of two slides is not a problem", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  m.addSlide("content");
  m.selectSlide("slide-001");
  m.addNavigationButton("next");
  assert.deepEqual(validate(m).filter((f) => f.rule === "trigger-next-last"), []);
});
