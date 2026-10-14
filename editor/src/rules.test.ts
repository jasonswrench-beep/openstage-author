// Tests for rules: reading triggers as rules and back, editing them, and making a course branch.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { InputContent, Trigger } from "../../player/src/types.ts";
import { defaultValueFor, eventsFor, operatorsFor, readRules, writeRules, type RuleItem } from "./content.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-10" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const trig = (id: string, event: Trigger["event"], action: Trigger["action"], target: string, extra: Partial<Trigger> = {}): Trigger => ({ id, event, action, target, conditions: [], ...extra });
const ids = () => { let n = 100; return () => `trg-${n++}`; };

// ---- reading and writing

test("changing an object's look is a rule like any other, and keeps its look through reading and writing", () => {
  const triggers = [trig("a", "slideEnd", "changeState", "obj-0001", { value: "done" }), trig("b", "slideStart", "changeState", "obj-0001")];
  const items = readRules(triggers);
  assert.deepEqual(items.map((i) => i.kind), ["rule", "rule"]);
  assert.equal(items[0]!.kind === "rule" && items[0]!.rule.action, "changeState");
  assert.equal(items[0]!.kind === "rule" && items[0]!.rule.value, "done");
  assert.equal(items[1]!.kind === "rule" && "value" in items[1]!.rule, false, "no value stays no value, which means normal");
  assert.deepEqual(writeRules(items, ids()), triggers);
});

test("a click with its matching key press is one rule that happens when the learner presses it", () => {
  const triggers = [trig("a", "click", "jumpToSlide", "slide-002"), trig("b", "keyActivate", "jumpToSlide", "slide-002")];
  const items = readRules(triggers);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.kind === "rule" && items[0]!.rule.event, "activate");
  assert.deepEqual(writeRules(items, ids()), triggers, "written back exactly, ids and all");
});

test("a new rule that happens when the learner presses something is written as a click and a key press", () => {
  const items: RuleItem[] = [{ kind: "rule", rule: { event: "activate", action: "showLayer", target: "layer-1", conditions: [] } }];
  const out = writeRules(items, ids());
  assert.deepEqual(out.map((t) => [t.id, t.event]), [["trg-100", "click"], ["trg-101", "keyActivate"]]);
  assert.ok(out.every((t) => t.action === "showLayer" && t.target === "layer-1"));
});

test("a lone click, a lone key press and an action the editor cannot edit are kept as they are, in place", () => {
  const triggers = [
    trig("a", "click", "jumpToSlide", "slide-002"),
    trig("b", "slideStart", "showLayer", "layer-1"),
    trig("c", "slideEnd", "explode" as Trigger["action"], "obj-0001", { value: "hover" }),
    trig("d", "keyActivate", "jumpToSlide", "slide-002"),
  ];
  const items = readRules(triggers);
  assert.deepEqual(items.map((i) => i.kind), ["raw", "rule", "raw", "raw"]);
  assert.match((items[0] as { why: string }).why, /no matching keyboard trigger/);
  assert.match((items[2] as { why: string }).why, /explode/);
  assert.deepEqual(writeRules(items, ids()), triggers);
});

test("a rule keeps its value and conditions through reading and writing", () => {
  const cond = [{ variable: "var-1", operator: "equals" as const, value: "b" }];
  const triggers = [trig("a", "variableChange", "setVariable", "var-2", { value: 5, conditions: cond })];
  const [item] = readRules(triggers);
  assert.deepEqual(item, { kind: "rule", rule: { event: "variableChange", action: "setVariable", target: "var-2", value: 5, conditions: cond, ids: ["a"] } });
  assert.deepEqual(writeRules([item!], ids()), triggers);
});

test("each kind of object offers only the events it can cause", () => {
  assert.deepEqual(eventsFor("button"), ["activate", "slideStart", "slideEnd", "variableChange"]);
  assert.deepEqual(eventsFor("video"), ["mediaComplete", "slideStart", "slideEnd", "variableChange"]);
  assert.deepEqual(eventsFor("text"), ["slideStart", "slideEnd", "variableChange"]);
  assert.ok(eventsFor("quizQuestion").includes("activate"));
  assert.deepEqual(operatorsFor("string"), ["equals", "notEquals"]);
  assert.ok(operatorsFor("number").includes("lessThan"));
  assert.equal(defaultValueFor("number"), 0);
});

// ---- editing

test("a new rule on a slide with no layers goes to a slide, and with a layer shows it", () => {
  const m = fresh();
  const b = m.addObject("button")!;
  assert.equal(m.addRule(b.id), "Added rule 1");
  let [item] = m.rulesOf(b.id);
  assert.deepEqual(item && item.kind === "rule" && [item.rule.event, item.rule.action, item.rule.target], ["activate", "jumpToSlide", "slide-001"]);
  m.addLayer();
  m.selectLayer("layer-base");
  m.addRule(b.id);
  [, item] = m.rulesOf(b.id);
  assert.equal(item && item.kind === "rule" && item.rule.action, "showLayer");
  m.selectObject(b.id);
  assert.equal(m.object!.triggers.length, 4, "each button rule is a click and a key press");
});

test("choosing another action picks a target that suits it, and says why when there is nothing to pick", () => {
  const m = fresh();
  const b = m.addObject("button")!;
  m.addRule(b.id);
  assert.match(m.updateRule(b.id, 0, { action: "showLayer" })!, /no layers/);
  assert.match(m.updateRule(b.id, 0, { action: "setVariable" })!, /no variables/);
  assert.match(m.updateRule(b.id, 0, { action: "playMedia" })!, /no video or audio/);
  m.addLayer();
  m.selectLayer("layer-base");
  assert.equal(m.updateRule(b.id, 0, { action: "showLayer" }), "Rule changed");
  const r = m.rulesOf(b.id)[0]!;
  assert.equal(r.kind === "rule" && r.rule.target, "layer-1");
  assert.equal(m.updateRule(b.id, 0, { target: "layer-9" }), null, "a target that does not exist is ignored");
});

test("a rule that sets a variable starts with a value of that variable's kind, and only accepts one", () => {
  const m = fresh();
  const b = m.addObject("button")!;
  const n = m.addVariable("number", "score");
  const f = m.addVariable("boolean", "done");
  m.addRule(b.id);
  m.updateRule(b.id, 0, { action: "setVariable" });
  const rule = () => { const r = m.rulesOf(b.id)[0]!; return r.kind === "rule" ? r.rule : null; };
  assert.equal(rule()!.target, n.id);
  assert.equal(rule()!.value, 0);
  assert.match(m.updateRule(b.id, 0, { value: Number.NaN })!, /needs a number/);
  m.updateRule(b.id, 0, { value: 7 });
  assert.equal(rule()!.value, 7);
  m.updateRule(b.id, 0, { target: f.id });
  assert.equal(rule()!.value, true, "a new variable resets the value to suit it");
  assert.equal(m.updateRule(b.id, 0, { value: 3 }), null, "a number is not a true or false");
});

test("an object cannot be given an event it cannot cause", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  m.addRule(t.id);
  assert.equal((m.rulesOf(t.id)[0] as { rule: { event: string } }).rule.event, "slideStart");
  assert.match(m.updateRule(t.id, 0, { event: "activate" })!, /cannot cause that/);
  assert.equal(m.updateRule(t.id, 0, { event: "variableChange" }), "Rule changed");
});

test("conditions are added, changed to suit the variable, and deleted", () => {
  const m = fresh();
  const b = m.addObject("button")!;
  m.addRule(b.id);
  assert.match(m.addCondition(b.id, 0)!, /no variables/);
  const text = m.addVariable("string", "path");
  const num = m.addVariable("number", "score");
  m.addCondition(b.id, 0);
  const conds = () => { const r = m.rulesOf(b.id)[0]!; return r.kind === "rule" ? r.rule.conditions : []; };
  assert.deepEqual(conds(), [{ variable: text.id, operator: "equals", value: "" }]);
  assert.equal(m.updateCondition(b.id, 0, 0, { operator: "lessThan" }), null, "text cannot be put in order");
  m.updateCondition(b.id, 0, 0, { value: "a" });
  m.updateCondition(b.id, 0, 0, { variable: num.id });
  assert.deepEqual(conds(), [{ variable: num.id, operator: "equals", value: 0 }], "a new variable resets the test");
  m.updateCondition(b.id, 0, 0, { operator: "greaterThanOrEqual" });
  assert.match(m.updateCondition(b.id, 0, 0, { value: Number.NaN })!, /needs a number/);
  m.updateCondition(b.id, 0, 0, { value: 3 });
  assert.deepEqual(conds(), [{ variable: num.id, operator: "greaterThanOrEqual", value: 3 }]);
  m.addCondition(b.id, 0);
  assert.equal(conds().length, 2);
  m.deleteCondition(b.id, 0, 0);
  assert.equal(conds().length, 1);
  assert.equal(m.object!.triggers.every((t) => t.conditions.length === 1), true, "both triggers of the pair carry the condition");
});

test("rules can be reordered and deleted, each as one undo step, and new ids are never reused", () => {
  const m = fresh();
  const a = m.addObject("button")!;
  const other = m.addObject("button")!;
  m.addRule(a.id); m.addRule(a.id); m.addRule(other.id);
  const all = [...m.object!.triggers, ...m.objects.find((o) => o.id === a.id)!.triggers].map((t) => t.id);
  assert.equal(new Set(all).size, all.length, "ids are unique across the project");
  const idsOf = () => m.objects.find((o) => o.id === a.id)!.triggers.map((t) => t.id);
  const before = idsOf();
  m.moveRule(a.id, 0, 1);
  assert.deepEqual(idsOf(), [...before.slice(2), ...before.slice(0, 2)], "the pair moves together");
  assert.match(m.moveRule(a.id, 1, 1)!, /already last/);
  m.deleteRule(a.id, 0);
  assert.equal(idsOf().length, 2);
  m.undo();
  assert.equal(idsOf().length, 4);
  m.undo();
  assert.deepEqual(idsOf(), before);
});

test("rules the editor cannot show are left alone while the others are edited", () => {
  const m = fresh();
  const b = m.addObject("button")!;
  m.addRule(b.id);
  const obj = m.objects.find((o) => o.id === b.id)!;
  const odd = trig("trg-0900", "click", "jumpToSlide", "slide-001");
  obj.triggers = [odd, ...obj.triggers];
  m.addRule(b.id);
  m.deleteRule(b.id, 1);
  assert.deepEqual(m.objects.find((o) => o.id === b.id)!.triggers[0], odd);
  assert.equal(m.updateRule(b.id, 0, { action: "playMedia" }), null, "a rule the editor cannot show cannot be edited");
});

// ---- variables

test("a variable's starting value must be of its kind, and a used variable cannot be deleted", () => {
  const m = fresh();
  const n = m.addVariable("number", "score");
  const s = m.addVariable("string", "path");
  assert.match(m.setVariableInitial(n.id, Number.NaN)!, /needs a number/);
  assert.equal(m.setVariableInitial(n.id, 10), "score starts as 10");
  assert.equal(m.setVariableInitial(s.id, 5), null);
  const b = m.addObject("button")!;
  m.addRule(b.id);
  m.updateRule(b.id, 0, { action: "setVariable" });
  assert.match(m.deleteVariable(n.id)!, /score is used by Button on Title slide/);
  assert.equal(m.deleteVariable(s.id), "Deleted path", "an unused one goes");
  m.undo();
  assert.ok(m.variables.some((v) => v.id === s.id));
});

test("an input's variable is counted as used", () => {
  const m = fresh();
  m.addInput("radio");
  const v = m.variables[0]!;
  assert.match(m.deleteVariable(v.id)!, /is used by/);
});

// ---- the real validator, on a course that branches

test("a survey that sends the learner down different paths passes the real validator", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  const a = m.addSlide("title-only");
  const bSlide = m.addSlide("title-only");
  m.selectSlide("slide-001");
  const radio = m.addInput("radio")!;
  const c = radio.content as unknown as InputContent;
  const variable = c.variable!;
  const go = m.addObject("button")!;
  m.setLabel(go.id, "Continue");
  m.setAccessibility(go.id, { altText: "Continue" });
  for (const [slide, value] of [[a.id, c.options![0]!.value], [bSlide.id, c.options![1]!.value]] as const) {
    m.addRule(go.id);
    const at = m.rulesOf(go.id).length - 1;
    m.updateRule(go.id, at, { target: slide });
    m.addCondition(go.id, at);
    m.updateCondition(go.id, at, 0, { variable });
    m.updateCondition(go.id, at, 0, { value });
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-rules-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    const errors = (JSON.parse(r.stdout) as { severity: string; rule: string }[]).filter((f) => f.severity === "error");
    assert.deepEqual(errors, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(go.triggers.length, 4, "two rules, each a click and a key press");
});

// ---- picking an answer instead of typing it

test("a rule is offered the input's own answers for a variable the input saves to", () => {
  const m = fresh();
  const radio = m.addInput("radio")!;
  const c = radio.content as unknown as InputContent;
  const choices = m.valueChoices(c.variable!)!;
  assert.deepEqual(choices.map((x) => x.value), ["", "option-1", "option-2", "option-3"]);
  assert.equal(choices[0]!.label, "Nothing chosen yet");

  const likert = m.addInput("likert")!;
  const row = (likert.content as unknown as InputContent).rows![0]!;
  const scale = m.valueChoices(row.variable)!;
  assert.deepEqual(scale.map((x) => x.value), [0, 1, 2, 3, 4, 5]);
  assert.equal(scale[4]!.label, "Agree (4)");

  const semantic = m.addInput("semantic")!;
  const pair = (semantic.content as unknown as InputContent).rows![0]!;
  const points = m.valueChoices(pair.variable)!;
  assert.equal(points.length, 8, "0 for not answered, then 7 points");
  assert.equal(points[1]!.label, "1 (Word 1)");
  assert.equal(points[7]!.label, "7 (Opposite 1)");

  const free = m.addVariable("string", "notes");
  assert.equal(m.valueChoices(free.id), null, "a variable no input saves to takes any value");
});

test("an option's saved value follows its label, so the rule's choices follow it too", () => {
  const m = fresh();
  const radio = m.addInput("radio")!;
  const c = radio.content as unknown as InputContent;
  m.setInputPartText(radio.id, c.options![0]!.id, "label", "The short path");
  assert.equal(m.valueChoices(c.variable!)![1]!.value, "the-short-path");
  assert.equal(m.valueChoices(c.variable!)![1]!.label, "The short path");
});
