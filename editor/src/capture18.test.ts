// Format 0.18.0 in the editor: a rule that adds to a number variable, the hotspot object, and provenance on copies and edits.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Trigger } from "../../player/src/types.ts";
import { eventsFor, readRules, writeRules } from "./content.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-13" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const trig = (id: string, event: Trigger["event"], extra: Partial<Trigger> = {}): Trigger => ({ id, event, action: "setVariable", target: "var-1", conditions: [], ...extra });
const ids = () => { let n = 100; return () => `trg-${n++}`; };

// ---- adding to a variable

test("a click and key press that add are one rule, 'add to a number variable', and are written back exactly", () => {
  const pair = [trig("a", "click", { operation: "add", value: 2 }), trig("b", "keyActivate", { operation: "add", value: 2 })];
  const items = readRules(pair);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.kind === "rule" && items[0]!.rule.action, "addToVariable");
  assert.deepEqual(writeRules(items, ids()), pair);
});

test("adding and setting are different rules, so a click that adds does not pair with a key press that sets", () => {
  const items = readRules([trig("a", "click", { operation: "add", value: 1 }), trig("b", "keyActivate", { value: 1 })]);
  assert.deepEqual(items.map((i) => i.kind), ["raw", "raw"], "kept as they are, since each has no matching partner");
});

test("a new rule that adds is written as setVariable with the operation add, and one that sets has no operation", () => {
  const out = writeRules([{ kind: "rule", rule: { event: "activate", action: "addToVariable", target: "var-1", value: 3, conditions: [] } }], ids());
  assert.deepEqual(out.map((t) => [t.event, t.action, t.operation, t.value]), [["click", "setVariable", "add", 3], ["keyActivate", "setVariable", "add", 3]]);
  const set = writeRules([{ kind: "rule", rule: { event: "slideStart", action: "setVariable", target: "var-1", value: 3, conditions: [] } }], ids());
  assert.equal("operation" in set[0]!, false);
});

test("a rule on a slide event can add, and keeps its conditions", () => {
  const cond = [{ variable: "var-2", operator: "lessThan" as const, value: 5 }];
  const [item] = readRules([trig("a", "slideStart", { operation: "add", value: 1, conditions: cond })]);
  assert.deepEqual(item, { kind: "rule", rule: { event: "slideStart", action: "addToVariable", target: "var-1", value: 1, conditions: cond, ids: ["a"] } });
});

test("the editor offers only number variables to add to, starts the amount at 1, and writes the format's way", () => {
  const m = fresh();
  m.addLayer();
  m.selectLayer(m.slide!.baseLayer.id);
  const flag = m.addVariable("boolean", "flag");
  const tries = m.addVariable("number", "tries");
  m.addVariable("string", "word");
  const button = m.addObject("button")!;
  m.addRule(button.id);
  assert.deepEqual(m.targetsFor(button.id, "addToVariable").map((t) => t.value), [tries.id], "only the number");
  assert.equal(m.updateRule(button.id, 0, { action: "addToVariable" }), "Rule changed");
  const trigs = m.object!.triggers;
  assert.deepEqual(trigs.map((t) => [t.event, t.action, t.target, t.operation, t.value]), [["click", "setVariable", tries.id, "add", 1], ["keyActivate", "setVariable", tries.id, "add", 1]]);
  assert.match(m.updateRule(button.id, 0, { value: 2 })!, /Rule changed/);
  assert.equal(m.object!.triggers[0]!.value, 2);
  assert.equal(m.updateRule(button.id, 0, { value: Number.NaN }), "That needs a number.");
  assert.equal(m.object!.triggers[0]!.value, 2, "refused, so unchanged");
  assert.equal(m.updateRule(button.id, 0, { value: -1 }) !== "That needs a number.", true, "taking away is adding a negative number");
  // Going back to setting a variable drops the operation.
  m.updateRule(button.id, 0, { action: "setVariable", target: flag.id });
  assert.equal(m.object!.triggers.every((t) => !("operation" in t)), true);
});

test("with no number variable there is nothing to add to, and the editor says what to do", () => {
  const m = fresh();
  m.addLayer();
  m.selectLayer(m.slide!.baseLayer.id);
  m.addVariable("boolean", "flag");
  const button = m.addObject("button")!;
  m.addRule(button.id);
  assert.match(m.updateRule(button.id, 0, { action: "addToVariable" })!, /no number variables yet/);
  assert.equal(readRules(m.object!.triggers)[0]!.kind === "rule" && (readRules(m.object!.triggers)[0] as { rule: { action: string } }).rule.action, "showLayer", "unchanged");
});

test("changing the rule's variable to another number keeps the amount", () => {
  const m = fresh();
  m.addLayer();
  m.selectLayer(m.slide!.baseLayer.id);
  const a = m.addVariable("number", "a");
  const b = m.addVariable("number", "b");
  const button = m.addObject("button")!;
  m.addRule(button.id);
  m.updateRule(button.id, 0, { action: "addToVariable" });
  m.updateRule(button.id, 0, { value: 4 });
  m.updateRule(button.id, 0, { target: b.id });
  assert.deepEqual(m.object!.triggers.map((t) => [t.target, t.value, t.operation]), [[b.id, 4, "add"], [b.id, 4, "add"]]);
  void a;
});

// ---- the hotspot

test("a hotspot is added with no content, no name, in the reading order and not decorative, so the author has to name it", () => {
  const m = fresh();
  const spot = m.addObject("hotspot")!;
  assert.equal(spot.type, "hotspot");
  assert.deepEqual(spot.content, {});
  assert.equal(spot.accessibility.altText, "", "never filled in for the author");
  assert.equal(spot.accessibility.decorative, false);
  assert.ok((spot.accessibility.tabOrder ?? 0) >= 1, "reachable by keyboard");
  assert.ok(spot.geometry.width >= 35 && spot.geometry.height >= 35, "big enough to press");
  assert.ok(eventsFor("hotspot").includes("activate"), "it can cause a press");
});

test("a hotspot can have rules, written as a click and a key press", () => {
  const m = fresh();
  m.addLayer();
  m.selectLayer(m.slide!.baseLayer.id);
  const spot = m.addObject("hotspot")!;
  assert.equal(m.addRule(spot.id), "Added rule 1");
  assert.deepEqual(m.object!.triggers.map((t) => t.event), ["click", "keyActivate"]);
});

// ---- provenance

const STEP = { sourceCapture: "capture-1", stepId: "step-3" };

test("editing an object never drops its provenance", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  t.provenance = { ...STEP };
  m.setGeometry(t.id, { x: 10, y: 10 });
  m.setName(t.id, "Renamed");
  m.setText(t.id, { block: "p", text: "Words" });
  m.setAccessibility(t.id, { altText: "Words" });
  m.setStyle(t.id, "color", "#112233");
  m.setTiming(t.id, { start: 1000 });
  m.selectObject(t.id);
  m.setLocked(true);
  assert.deepEqual(m.object!.provenance, STEP);
  m.undo();
  assert.deepEqual(m.object!.provenance, STEP, "and undo does not either");
});

test("changing a slide's layout keeps the provenance of the text it moves", () => {
  const m = fresh();
  const heading = m.slide!.baseLayer.objects.find((o) => o.type === "text")!;
  heading.provenance = { ...STEP };
  m.applyLayout("content");
  const same = m.slide!.baseLayer.objects.find((o) => o.id === heading.id);
  assert.ok(same, "the text stayed");
  assert.deepEqual(same!.provenance, STEP);
});

test("a copy of an object, by duplicate or paste, is not the recorded step it came from", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  t.provenance = { ...STEP };
  m.selectObject(t.id);
  m.duplicate();
  assert.equal(m.object!.provenance, null);
  assert.deepEqual(m.slide!.baseLayer.objects.find((o) => o.id === t.id)!.provenance, STEP, "the original keeps it");
  m.selectObject(t.id);
  m.copy();
  m.paste();
  assert.equal(m.object!.provenance, null);
});

test("a duplicated slide drops its own and its objects' provenance, so a changed recording reaches only the original", () => {
  const m = fresh();
  (m.slide as unknown as { provenance: unknown }).provenance = { ...STEP };
  const t = m.addObject("text")!;
  t.provenance = { ...STEP };
  m.duplicateSlide();
  assert.equal((m.slide as unknown as { provenance?: unknown }).provenance, undefined);
  assert.ok(m.slide!.baseLayer.objects.every((o) => o.provenance === null));
  m.selectSlide("slide-001");
  assert.deepEqual((m.slide as unknown as { provenance: unknown }).provenance, STEP);
});

test("the slide's provenance is written to its file", () => {
  const m = fresh();
  (m.slide as unknown as { provenance: unknown }).provenance = { ...STEP };
  m.setSlideDuration(5000);
  const saved = JSON.parse(m.allFiles().find((f) => f.path === "slides/slide-001.json")!.text) as { provenance: unknown };
  assert.deepEqual(saved.provenance, STEP);
});

// ---- the real validator

type Finding = { severity: string; rule: string; message: string };

function validate(m: Model): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-c18-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout) as Finding[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the real validator accepts a named hotspot and a rule that adds, and asks for the hotspot's name first", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  m.addLayer();
  m.selectLayer(m.slide!.baseLayer.id);
  const tries = m.addVariable("number", "tries");
  const spot = m.addObject("hotspot")!;
  m.addRule(spot.id);
  m.updateRule(spot.id, 0, { action: "addToVariable", target: tries.id });
  assert.ok(validate(m).some((f) => f.severity === "error"), "no name yet, so the validator asks for one");
  m.setAccessibility(spot.id, { altText: "The Save button" });
  const errors = validate(m).filter((f) => f.severity === "error");
  assert.deepEqual(errors.map((f) => f.rule), [], errors.map((f) => f.message).join("; "));
  m.setGeometry(spot.id, { width: 20, height: 20 });
  assert.ok(validate(m).some((f) => f.rule === "hotspot-too-small"), "and too small to press is an error");
});
