// Tests for looks (the format's object states): making them, editing them, rules that apply them, and what the Problems list says.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { READY_LOOKS as PLAYER_READY } from "../../player/src/looks.ts";
import type { OSObject } from "../../player/src/types.ts";
import { ANNOUNCE_MAX, canHaveLooks, isReadyLook, lookFieldsFor, lookLabel, lookNameProblem, looksOf, mixHex, percentOf, READY_LOOKS, solidnessOf } from "./looks.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-10" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

/** A slide with a lamp (a piece of text, which a screen reader reaches) and a button, the button selected. */
function withButton() {
  const m = fresh();
  const lamp = m.addObject("text")!;
  m.setName(lamp.id, "Lamp");
  const button = m.addObject("button")!;
  m.setLabel(button.id, "Mark done");
  m.setAccessibility(button.id, { altText: "Mark done" });
  return { m, button, lamp };
}

/** An object as it is now: undo and redo replace objects, so look it up again by id. */
const now = (m: Model, id: string): OSObject => m.objects.find((o) => o.id === id)!;

// ---- what a look can be

test("the ready-made looks are the three the player applies on its own", () => {
  assert.deepEqual(READY_LOOKS.map((r) => r.name), [...PLAYER_READY]);
  assert.ok(READY_LOOKS.every((r) => r.label !== "" && r.use !== ""));
  assert.equal(lookLabel("hover"), "Hover or focus");
  assert.equal(lookLabel("Correct"), "Correct", "a look you named is shown as you named it");
  assert.ok(isReadyLook("visited") && !isReadyLook("Visited"));
});

test("looks are for the things with an appearance of their own, and offer the fields the Appearance box has", () => {
  for (const type of ["text", "button", "icon", "shape", "image"]) assert.ok(canHaveLooks(type), type);
  for (const type of ["interaction", "table", "input", "quizQuestion", "video", "audio", "hotspot", "scenario", "results"]) assert.ok(!canHaveLooks(type), type);
  assert.deepEqual(lookFieldsFor("button"), ["fontFamily", "fontSize", "color", "fill", "opacity"]);
  assert.deepEqual(lookFieldsFor("shape"), ["fill", "stroke", "strokeWidth", "opacity"]);
  assert.ok(!lookFieldsFor("icon").includes("strokeWidth"), "an icon's line is drawn once, so a look cannot change it");
  assert.deepEqual(lookFieldsFor("table"), []);
});

test("a look's name must be a few plain words that are not taken", () => {
  assert.equal(lookNameProblem("Correct", []), null);
  assert.equal(lookNameProblem("  Correct answer  ", ["done"]), null);
  assert.match(lookNameProblem("", [])!, /Give the look a name/);
  assert.match(lookNameProblem("   ", [])!, /Give the look a name/);
  assert.match(lookNameProblem("x".repeat(41), [])!, /up to 40/);
  assert.equal(lookNameProblem("x".repeat(40), []), null);
  assert.match(lookNameProblem("a\nb", [])!, /line breaks/);
  assert.match(lookNameProblem("Normal", [])!, /own appearance/);
  assert.match(lookNameProblem("HOVER", [])!, /ready-made/);
  assert.match(lookNameProblem("hover or focus", [])!, /ready-made/);
  assert.match(lookNameProblem("DONE", ["done"])!, /already has a look called DONE/);
});

test("how solid something is, and how it looks over a background, is worked out the way the validator does", () => {
  assert.equal(solidnessOf({ opacity: 0.4 }, "visited"), 0.4);
  assert.equal(solidnessOf({ opacity: 0.4 }, "disabled"), 1, "a disabled object is not asked for contrast");
  assert.equal(solidnessOf({}, "normal"), 1);
  assert.equal(solidnessOf({ opacity: 7 }, "normal"), 1, "kept in range");
  assert.equal(percentOf(0.85), 85);
  assert.equal(mixHex("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mixHex("#0b5fff", "#ffffff", 1), "#0b5fff");
  assert.equal(mixHex("#0b5fff", "#ffffff", 0), "#ffffff");
  assert.equal(mixHex("nonsense", "#ffffff", 0.5), "nonsense");
});

// ---- making and removing looks

test("adding a look gives the object one that starts the same as normal, and selects it to be edited", () => {
  const { m, button } = withButton();
  const r = m.addLook(button.id, "  Done ");
  assert.equal(r.ok, true);
  assert.match(r.message, /Added the look Done/);
  assert.deepEqual(button.states["Done"], { style: {} }, "never an empty object: the format wants something in it");
  assert.equal(m.editingLookOf(button.id), "Done");
  assert.deepEqual(m.looksOf(button.id).map((l) => l.name), ["hover", "visited", "disabled", "Done"]);
  assert.deepEqual(m.looksOf(button.id).map((l) => l.set), [false, false, false, true]);
});

test("a name that cannot be used is refused with the reason, and nothing changes", () => {
  const { m, button } = withButton();
  m.addLook(button.id, "Done");
  const before = JSON.stringify(button.states);
  for (const bad of ["", "normal", "Hover", "done", "x".repeat(50)]) {
    const r = m.addLook(button.id, bad);
    assert.equal(r.ok, false, bad);
    assert.notEqual(r.message, "", bad);
  }
  assert.equal(JSON.stringify(button.states), before);
});

test("an object without an appearance of its own cannot have looks", () => {
  const m = fresh();
  const input = m.addInput("radio")!;
  const r = m.addLook(input.id, "Done");
  assert.equal(r.ok, false);
  assert.match(r.message, /input object cannot have looks/);
});

test("adding and deleting a look can be undone, and the object is looked up again afterwards", () => {
  const { m, button } = withButton();
  m.addLook(button.id, "Done");
  m.setStyle(button.id, "fill", "#5b21b6", "Done");
  m.undo();
  assert.equal(JSON.stringify(now(m, button.id).states["Done"]), JSON.stringify({ style: {} }), "the colour is undone");
  m.undo();
  assert.deepEqual(now(m, button.id).states, {}, "and then the look");
  m.redo();
  assert.ok("Done" in now(m, button.id).states);
  const said = m.removeLook(button.id, "Done");
  assert.match(said!, /Deleted the look Done\./);
  assert.deepEqual(now(m, button.id).states, {});
  m.undo();
  assert.ok("Done" in now(m, button.id).states, "deleting is undone");
});

test("clearing a ready-made look puts it back to not set, and deleting says how many rules still use a look", () => {
  const { m, button } = withButton();
  m.setStyle(button.id, "fill", "#0a4fd1", "hover");
  assert.ok(m.looksOf(button.id)[0]!.set);
  assert.match(m.removeLook(button.id, "hover")!, /Cleared the Hover or focus look\./);
  assert.ok(!m.looksOf(button.id)[0]!.set);
  m.addLook(button.id, "Done");
  m.addRule(button.id);
  m.updateRule(button.id, 0, { action: "changeState" });
  assert.equal(m.lookUses(button.id, "Done"), 1);
  assert.match(m.removeLook(button.id, "Done")!, /1 rule still applies it, and the Problems list names it\./);
  assert.equal(m.removeLook(button.id, "Done"), null, "already gone");
});

test("a look is renamed in the order it was made, and the rules that apply it follow", () => {
  const { m, button } = withButton();
  m.addLook(button.id, "One");
  m.addLook(button.id, "Two");
  m.addRule(button.id);
  m.updateRule(button.id, 0, { action: "changeState" });
  m.updateRule(button.id, 0, { value: "Two" });
  const r = m.renameLook(button.id, "Two", "Second");
  assert.equal(r.ok, true);
  assert.match(r.message, /Renamed the look to Second\. 1 rule now applies the new name\./);
  assert.deepEqual(Object.keys(button.states), ["One", "Second"]);
  const rule = m.rulesOf(button.id)[0]!;
  assert.equal(rule.kind === "rule" && rule.rule.value, "Second");
  assert.equal(m.editingLookOf(button.id), "Second", "the look being edited follows its new name");
  m.undo();
  assert.deepEqual(Object.keys(now(m, button.id).states), ["One", "Two"], "undoing a rename also undoes the rules");
  const back = m.rulesOf(button.id)[0]!;
  assert.equal(back.kind === "rule" && back.rule.value, "Two");
});

test("only a look of your own can be renamed, and not to a name that cannot be used", () => {
  const { m, button } = withButton();
  m.setStyle(button.id, "fill", "#0a4fd1", "hover");
  m.addLook(button.id, "One");
  m.addLook(button.id, "Two");
  assert.match(m.renameLook(button.id, "hover", "Over").message, /ready-made look, so its name stays/);
  assert.equal(m.renameLook(button.id, "Two", "one").ok, false, "taken, even in other capitals");
  assert.equal(m.renameLook(button.id, "Two", "Normal").ok, false);
  assert.equal(m.renameLook(button.id, "Two", "Two").ok, true, "the same name changes nothing");
  assert.equal(m.renameLook(button.id, "Two", "TWO").ok, true, "but another way of writing its own name is fine");
  assert.ok("TWO" in button.states);
  assert.equal(m.renameLook(button.id, "Nope", "X").ok, false);
});

// ---- editing a look

test("a look is edited with the same fields as the object, blank meaning the same as normal", () => {
  const { m, button } = withButton();
  m.addLook(button.id, "Done");
  assert.deepEqual(m.setStyle(button.id, "fill", "#5b21b6", "Done"), { ok: true, message: "Look updated" });
  assert.deepEqual(m.setStyle(button.id, "fontSize", "24", "Done"), { ok: true, message: "Look updated" });
  assert.deepEqual(m.setStyle(button.id, "color", "theme:color.onAccentStrong", "Done"), { ok: true, message: "Look updated" });
  assert.deepEqual(button.states["Done"]!.style, { fill: "#5b21b6", fontSize: 24, color: "theme:color.onAccentStrong" });
  assert.deepEqual(button.style["fill"], button.style["fill"], "the object's own style is not touched");
  assert.equal("fontSize" in button.states["Done"]!.style! && button.style["fontSize"] === 24, false);
  m.setStyle(button.id, "fontSize", "", "Done");
  assert.deepEqual(Object.keys(button.states["Done"]!.style!), ["fill", "color"]);
  assert.equal(m.setStyle(button.id, "fill", "nonsense", "Done").ok, false);
  assert.equal(m.setStyle(button.id, "fontSize", "3", "Done").ok, false);
  assert.equal(m.setStyle(button.id, "fill", "#000000", "Nope").ok, false, "a look the object does not have");
  assert.equal(m.setStyle(button.id, "fill", "theme:color.nonsense", "Done").ok, false, "a theme colour has to exist");
});

test("how solid is typed as a percentage from 10 to 100 and kept as a fraction", () => {
  const { m, button } = withButton();
  m.addLook(button.id, "Faded");
  assert.equal(m.setStyle(button.id, "opacity", "85", "Faded").ok, true);
  assert.equal(button.states["Faded"]!.style!["opacity"], 0.85);
  assert.equal(m.setStyle(button.id, "opacity", "9", "Faded").ok, false);
  assert.equal(m.setStyle(button.id, "opacity", "101", "Faded").ok, false);
  assert.equal(m.setStyle(button.id, "opacity", "soft", "Faded").ok, false);
  assert.equal(m.setStyle(button.id, "opacity", "theme:color.text", "Faded").ok, false);
  assert.equal(m.setStyle(button.id, "opacity", "100", "Faded").ok, true);
  assert.equal(button.states["Faded"]!.style!["opacity"], 1, "a look keeps full solidness, to undo a fade");
  assert.equal(m.setStyle(button.id, "opacity", "60.4").ok, true);
  assert.equal(button.style["opacity"], 0.6);
  m.setStyle(button.id, "opacity", "100");
  assert.equal("opacity" in button.style, false, "on the object itself, fully solid is just how it starts");
});

test("the object's own appearance still works as it did", () => {
  const { m, button } = withButton();
  assert.deepEqual(m.setStyle(button.id, "fill", "#112233"), { ok: true, message: "Style updated" });
  assert.equal(button.style["fill"], "#112233");
  assert.deepEqual(m.setStyle(button.id, "fill", "#112233"), { ok: true, message: "" });
  assert.equal(m.setStyle(button.id, "fill", "oops").ok, false);
  m.setStyle(button.id, "fill", "");
  assert.equal("fill" in button.style, false);
});

test("a ready-made look is made by setting something, and goes again when nothing is left", () => {
  const { m, button } = withButton();
  assert.ok(!("hover" in button.states));
  m.setStyle(button.id, "fill", "#0a4fd1", "hover");
  assert.deepEqual(button.states["hover"], { style: { fill: "#0a4fd1" } });
  m.setStyle(button.id, "fill", "", "hover");
  assert.ok(!("hover" in button.states), "an empty ready-made look is not left lying about");
  m.addLook(button.id, "Mine");
  m.setStyle(button.id, "fill", "#0a4fd1", "Mine");
  m.setStyle(button.id, "fill", "", "Mine");
  assert.deepEqual(button.states["Mine"], { style: {} }, "but a look you named stays until you delete it");
});

test("typing in the same box coalesces into one undo step", () => {
  const { m, button } = withButton();
  m.addLook(button.id, "Done");
  m.setStyle(button.id, "fontSize", "20", "Done");
  m.setStyle(button.id, "fontSize", "22", "Done");
  m.setStyle(button.id, "fontSize", "24", "Done");
  m.undo();
  assert.deepEqual(now(m, button.id).states["Done"], { style: {} });
});

test("a spoken message is trimmed and kept short, blank removes it, and a message alone makes a look", () => {
  const { m, button } = withButton();
  m.addLook(button.id, "Done");
  assert.deepEqual(m.setLookAnnounce(button.id, "Done", "  Marked   as\n done "), { ok: true, message: "Spoken message updated" });
  assert.equal(button.states["Done"]!.announce, "Marked as done");
  assert.equal(m.setLookAnnounce(button.id, "Done", "x".repeat(ANNOUNCE_MAX + 1)).ok, false);
  assert.equal(m.setLookAnnounce(button.id, "Done", "x".repeat(ANNOUNCE_MAX)).ok, true);
  assert.deepEqual(m.setLookAnnounce(button.id, "Done", ""), { ok: true, message: "Spoken message removed" });
  assert.ok(!("announce" in button.states["Done"]!));
  assert.deepEqual(m.setLookAnnounce(button.id, "Done", ""), { ok: true, message: "" }, "nothing changed");
  assert.equal(m.setLookAnnounce(button.id, "normal", "Hi").ok, false, "normal has no message");
  m.setLookAnnounce(button.id, "visited", "Visited");
  assert.deepEqual(button.states["visited"], { announce: "Visited" });
  m.setLookAnnounce(button.id, "visited", "");
  assert.ok(!("visited" in button.states));
});

// ---- showing the look on the canvas

test("the canvas shows the look being worked on, only for the one selected object", () => {
  const { m, button, lamp } = withButton();
  assert.equal(m.lookPreview, null);
  m.addLook(button.id, "Done");
  assert.deepEqual(m.lookPreview, { objectId: button.id, look: "Done" });
  m.setEditingLook(button.id, "normal");
  assert.equal(m.lookPreview, null, "normal is just the object");
  m.setEditingLook(button.id, "hover");
  assert.deepEqual(m.lookPreview, { objectId: button.id, look: "hover" }, "a ready-made look that is not set can be previewed too");
  m.selectObject(lamp.id);
  assert.equal(m.lookPreview, null, "choosing another object ends it");
  assert.equal(m.editingLookOf(lamp.id), "normal");
  m.selectObject(button.id);
  assert.deepEqual(m.lookPreview, { objectId: button.id, look: "hover" }, "and coming back picks up where it was");
  m.setEditingLook(button.id, "Nope");
  assert.equal(m.editingLookOf(button.id), "hover", "a look that does not exist is not chosen");
});

test("a look that no longer exists is not shown", () => {
  const { m, button } = withButton();
  m.addLook(button.id, "Done");
  m.removeLook(button.id, "Done");
  assert.equal(m.editingLookOf(button.id), "normal");
  assert.equal(m.lookPreview, null);
  m.addLook(button.id, "Done");
  m.undo();
  assert.equal(m.editingLookOf(button.id), "normal", "undoing its creation leaves nothing to show");
});

test("choosing a look to work on tells the screen, and is not an undo step", () => {
  const { m, button } = withButton();
  const kinds: string[] = [];
  m.on((c) => kinds.push(c.kind));
  m.setEditingLook(button.id, "hover");
  assert.deepEqual(kinds, ["selection"]);
  const before = m.undo();
  assert.equal(before, true, "the undo before it is the earlier change");
});

// ---- rules

test("a rule can change the look of an object that has one", () => {
  const { m, button, lamp } = withButton();
  m.addLook(lamp.id, "Lit");
  m.setLookAnnounce(lamp.id, "Lit", "Light on");
  m.selectObject(button.id);
  assert.deepEqual(m.targetsFor(button.id, "changeState"), [{ value: lamp.id, label: lamp.name }], "only objects with a look");
  m.addRule(button.id);
  assert.equal(m.updateRule(button.id, 0, { action: "changeState" }), "Rule changed");
  const rule = m.rulesOf(button.id)[0]!;
  assert.ok(rule.kind === "rule");
  assert.equal(rule.kind === "rule" && rule.rule.action, "changeState");
  assert.equal(rule.kind === "rule" && rule.rule.target, lamp.id, "the first object with a look");
  assert.equal(rule.kind === "rule" && rule.rule.value, "Lit", "and its first look");
  assert.deepEqual(button.triggers.map((t) => [t.event, t.action, t.target, t.value]), [["click", "changeState", lamp.id, "Lit"], ["keyActivate", "changeState", lamp.id, "Lit"]], "mouse and keyboard together");
  assert.deepEqual(m.lookChoices(lamp.id), [{ value: "normal", label: "Normal (its own appearance)" }, { value: "Lit", label: "Lit" }]);
  assert.equal(m.updateRule(button.id, 0, { value: "normal" }), "Rule changed");
  assert.equal(m.updateRule(button.id, 0, { value: "Nope" }), null, "not a look it has");
  assert.equal(m.updateRule(button.id, 0, { value: 5 }), null, "a look is named by text");
});

test("a new rule starts with a look the author named, not one the course applies on its own", () => {
  const { m, button } = withButton();
  m.setStyle(button.id, "fill", "#0a4fd1", "hover");
  m.addLook(button.id, "Chosen");
  m.addRule(button.id);
  m.updateRule(button.id, 0, { action: "changeState" });
  const rule = m.rulesOf(button.id)[0]!;
  assert.equal(rule.kind === "rule" && rule.rule.value, "Chosen");
  m.removeLook(button.id, "Chosen");
  m.updateRule(button.id, 0, { target: button.id, value: "normal" });
  m.addRule(button.id);
  m.updateRule(button.id, 1, { action: "changeState" });
  const second = m.rulesOf(button.id)[1]!;
  assert.equal(second.kind === "rule" && second.rule.value, "hover", "with only a ready-made look to choose, that is the one");
});

test("a rule can point at its own object, and at an object on another layer of the slide", () => {
  const { m, button } = withButton();
  m.setStyle(button.id, "fill", "#5b21b6", "hover");
  m.addRule(button.id);
  m.updateRule(button.id, 0, { action: "changeState" });
  const rule = m.rulesOf(button.id)[0]!;
  assert.equal(rule.kind === "rule" && rule.rule.target, button.id, "the only object with a look is itself");
  const layer = m.addLayer()!;
  m.selectLayer(layer.id);
  const note = m.addObject("text")!;
  m.addLook(note.id, "Shown");
  m.selectLayer(m.slide!.baseLayer.id);
  m.selectObject(button.id);
  assert.deepEqual(m.targetsFor(button.id, "changeState").map((t) => t.value).sort(), [button.id, note.id].sort());
  assert.equal(m.updateRule(button.id, 0, { target: note.id }), "Rule changed");
  const moved = m.rulesOf(button.id)[0]!;
  assert.equal(moved.kind === "rule" && moved.rule.value, "Shown", "a new target brings its own first look");
});

test("with no look anywhere on the slide a rule cannot be made to change one, and says what to do", () => {
  const { m, button } = withButton();
  m.addRule(button.id);
  const said = m.updateRule(button.id, 0, { action: "changeState" });
  assert.match(said!, /No object on this slide has a look yet/);
  const rule = m.rulesOf(button.id)[0]!;
  assert.notEqual(rule.kind === "rule" && rule.rule.action, "changeState");
});

test("what a screen reader will say is known to the rule, and a silent change is named", () => {
  const { m, button, lamp } = withButton();
  m.addLook(lamp.id, "Lit");
  assert.equal(m.lookMessage(lamp.id, "Lit"), null);
  assert.equal(m.lookIsSilent(lamp.id, "Lit"), true);
  m.setLookAnnounce(lamp.id, "Lit", "Light on");
  assert.equal(m.lookMessage(lamp.id, "Lit"), "Light on");
  assert.equal(m.lookIsSilent(lamp.id, "Lit"), false);
  assert.equal(m.lookIsSilent(lamp.id, "normal"), false, "going back to normal needs no words");
  m.setStyle(lamp.id, "opacity", "40", "disabled");
  assert.equal(m.lookIsSilent(lamp.id, "disabled"), false, "a disabled control already says so");
  m.setAccessibility(lamp.id, { decorative: true, altText: "" });
  m.removeLook(lamp.id, "Lit");
  m.addLook(lamp.id, "Lit");
  assert.equal(m.lookIsSilent(lamp.id, "Lit"), false, "a decorative object is not reached by a screen reader");
  assert.equal(m.lookIsSilent("obj-nowhere", "Lit"), false);
  void button;
});

test("copying a slide keeps each copy's looks and the rules that apply them", () => {
  const { m, button, lamp } = withButton();
  m.addLook(lamp.id, "Lit");
  m.addRule(button.id);
  m.updateRule(button.id, 0, { action: "changeState" });
  const copy = m.duplicateSlide("slide-001")!;
  m.selectSlide(copy);
  const copiedButton = m.objects.find((o) => o.type === "button")!;
  const copiedLamp = m.objects.find((o) => o.name.startsWith("Lamp"))!;
  assert.ok("Lit" in copiedLamp.states);
  assert.deepEqual([...new Set(copiedButton.triggers.map((t) => t.target))], [copiedLamp.id], "the copy's rule points at the copy's own lamp");
  assert.notEqual(copiedLamp.id, lamp.id);
});

// ---- the real validator

test("a rule that applies a look with a spoken message passes the real validator, and one without says so", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const { m, button, lamp } = withButton();
  m.addLook(lamp.id, "Lit");
  m.setStyle(lamp.id, "fontSize", "30", "Lit");
  m.selectObject(button.id);
  m.addRule(button.id);
  m.updateRule(button.id, 0, { action: "changeState" });
  const findings = () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-looks-"));
    try {
      mkdirSync(path.join(dir, "slides"));
      for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
      const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
      return JSON.parse(r.stdout) as { severity: string; rule: string }[];
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  assert.deepEqual(findings().filter((f) => f.severity === "error"), []);
  assert.equal(findings().filter((f) => f.rule === "state-silent").length, 1, "the editor and the validator agree it is silent");
  m.setLookAnnounce(lamp.id, "Lit", "Light on");
  assert.deepEqual(findings().filter((f) => f.rule === "state-silent"), []);
  m.removeLook(lamp.id, "Lit");
  assert.equal(findings().filter((f) => f.rule === "trigger-state-missing").length, 1, "a rule left pointing at a deleted look is named");
});

test("every look the model can write is a valid look to the format's own rules", () => {
  const { m, button } = withButton();
  m.addLook(button.id, "Done");
  m.setStyle(button.id, "fill", "#5b21b6", "Done");
  m.setStyle(button.id, "opacity", "90", "Done");
  m.setLookAnnounce(button.id, "Done", "Marked as done");
  m.setLookAnnounce(button.id, "disabled", "Unavailable");
  for (const [name, state] of Object.entries(button.states)) {
    assert.ok(name.length >= 1 && name.length <= 40 && name === name.trim(), name);
    assert.ok(Object.keys(state).length >= 1, "never an empty look");
  }
  assert.deepEqual(looksOf(button).map((l) => l.name), ["hover", "visited", "disabled", "Done"]);
});
