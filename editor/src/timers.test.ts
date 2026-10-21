// Tests for the timer in the editor: adding one, setting it, the rules that belong to it, and the real validator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { timerContentOf } from "../../player/src/timer.ts";
import { eventsFor, RULE_ACTIONS } from "./content.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-12" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

test("a new timer counts down 30 seconds, has the two buttons' settings, and is named by its label", () => {
  const m = fresh();
  const o = m.addTimer()!;
  assert.equal(o.type, "timer");
  assert.equal(m.object?.id, o.id, "it is selected");
  assert.deepEqual(o.content, { seconds: 30, label: "Time left", extendBy: 30 });
  assert.equal(o.accessibility.altText, "Time left", "a sighted learner reads the label, so a screen reader starts with the same words");
  assert.ok((o.accessibility.tabOrder ?? 0) >= 1, "it holds buttons, so it can be reached by keyboard");
  assert.equal(o.accessibility.decorative, false);
  assert.deepEqual(o.triggers, [], "what happens when time runs out is for the author to say");
});

test("the time is held to whole seconds from 5 to 3600, and the author is told when a number was changed", () => {
  const m = fresh();
  const o = m.addTimer()!;
  assert.match(m.setTimerSeconds(o.id, 90)!, /counts down 90 seconds/);
  assert.equal(timerContentOf(o).seconds, 90);
  assert.match(m.setTimerSeconds(o.id, 2)!, /5 seconds\. That is the shortest/);
  assert.equal(timerContentOf(o).seconds, 5);
  assert.match(m.setTimerSeconds(o.id, 99999)!, /3600 seconds\. That is the longest/);
  assert.match(m.setTimerSeconds(o.id, 12.6)!, /13 seconds/);
  assert.equal(m.setTimerSeconds(o.id, Number.NaN), "That needs a number of seconds.");
  assert.equal(timerContentOf(o).seconds, 13, "a bad entry changes nothing");
  assert.equal(m.setTimerSeconds(o.id, 13), null, "the same number is not a change");
});

test("the Add time button's seconds can be changed or taken away, but the Turn off button cannot", () => {
  const m = fresh();
  const o = m.addTimer()!;
  assert.match(m.setTimerExtend(o.id, 45)!, /gives 45 seconds/);
  assert.match(m.setTimerExtend(o.id, 1)!, /gives 5 seconds/, "too little to be of use is raised to the least");
  assert.match(m.setTimerExtend(o.id, 9999)!, /gives 600 seconds/);
  assert.match(m.setTimerExtend(o.id, 0)!, /no Add time button now\. Learners can still turn it off/);
  assert.equal(o.content["extendBy"], 0);
  assert.match(m.setTimerExtend(o.id, -3) ?? "", /^$|no Add time/, "below nothing is nothing");
  assert.equal(m.setTimerExtend(o.id, Number.NaN), "That needs a number of seconds.");
});

test("the label can be changed; the screen reader name follows it only while it was the label", () => {
  const m = fresh();
  const o = m.addTimer()!;
  m.setTimerLabel(o.id, "  Time to answer ");
  assert.equal(o.content["label"], "Time to answer");
  assert.equal(o.accessibility.altText, "Time to answer", "it followed");
  m.setAccessibility(o.id, { altText: "Time left to answer this question" });
  m.setTimerLabel(o.id, "Clock");
  assert.equal(o.accessibility.altText, "Time left to answer this question", "the author's own words are kept");
  assert.equal(m.setTimerLabel(o.id, "   "), "The timer needs a label.");
  assert.equal(o.content["label"], "Clock");
});

test("every change to a timer is one undo step, typing in a box counts as one", () => {
  const m = fresh();
  const o = m.addTimer()!;
  m.setTimerSeconds(o.id, 40);
  m.setTimerSeconds(o.id, 50);
  const timerNow = () => m.slides[0]!.baseLayer.objects.find((x) => x.type === "timer");
  m.undo();
  assert.equal(timerContentOf(timerNow()!).seconds, 30, "both edits of the number were one step");
  m.undo();
  assert.equal(timerNow(), undefined, "and the timer itself is the step before");
});

test("the time running out is an event only a timer has, and stopping a timer is an action that points at one", () => {
  assert.ok(eventsFor("timer").includes("timerEnd"));
  assert.equal(eventsFor("timer")[0], "timerEnd", "a new rule on a timer is about the time running out");
  assert.ok(!eventsFor("button").includes("timerEnd"));
  assert.ok(!eventsFor("text").includes("timerEnd"));
  assert.ok(RULE_ACTIONS.includes("stopTimer"));
});

test("a rule on a timer starts as the time running out, and a rule can be told to stop a timer", () => {
  const m = fresh();
  const timer = m.addTimer()!;
  const button = m.addObject("button")!;
  assert.match(m.addRule(timer.id)!, /Added rule 1/);
  const rule = m.rulesOf(timer.id)[0]!;
  assert.equal(rule.kind === "rule" && rule.rule.event, "timerEnd");
  assert.deepEqual(m.targetsFor(button.id, "stopTimer"), [{ value: timer.id, label: "Timer" }]);
  m.addRule(button.id);
  assert.equal(m.updateRule(button.id, 0, { action: "stopTimer" }), "Rule changed");
  const stop = m.rulesOf(button.id)[0]!;
  assert.ok(stop.kind === "rule" && stop.rule.action === "stopTimer" && stop.rule.target === timer.id);
  assert.deepEqual(button.triggers.map((t) => [t.event, t.action, t.target]), [["click", "stopTimer", timer.id], ["keyActivate", "stopTimer", timer.id]], "a button's rule works from the keyboard too");
  assert.equal(m.updateRule(timer.id, 0, { event: "slideStart" }), "Rule changed", "and its event can be changed to something else");
});

test("a slide with no timer cannot be told to stop one, and says why", () => {
  const m = fresh();
  const button = m.addObject("button")!;
  m.addRule(button.id);
  assert.equal(m.targetsFor(button.id, "stopTimer").length, 0);
  assert.equal(m.updateRule(button.id, 0, { action: "stopTimer" }), "This slide has no timer. Add one first.");
});

test("a copy of a timer, and of a button that stops it, keeps pointing at its own timer", () => {
  const m = fresh();
  const timer = m.addTimer()!;
  const button = m.addObject("button")!;
  m.addRule(button.id);
  m.updateRule(button.id, 0, { action: "stopTimer" });
  m.duplicateSlide(m.sel.slideId);
  const slides = m.slides;
  assert.equal(slides.length, 2);
  const copy = m.allFiles().filter((f) => f.path.startsWith("slides/")).map((f) => JSON.parse(f.text) as { baseLayer: { objects: { id: string; type: string; triggers: { action: string; target: string }[] }[] } });
  const newTimer = copy[1]!.baseLayer.objects.find((o) => o.type === "timer")!;
  const newButton = copy[1]!.baseLayer.objects.find((o) => o.type === "button")!;
  assert.notEqual(newTimer.id, timer.id);
  assert.ok(newButton.triggers.every((t) => t.action === "stopTimer" && t.target === newTimer.id), "the copy stops its own timer, not the first slide's");
});

interface Finding { severity: string; rule: string; object_id: string }

function validate(m: Model): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-timer-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the real validator accepts a timer with a rule for running out, and warns about one without", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  const o = m.addTimer()!;
  const errors = (f: Finding[]) => f.filter((x) => x.severity === "error").map((x) => x.rule);
  assert.deepEqual(errors(validate(m)), []);
  assert.ok(validate(m).some((f) => f.rule === "timer-no-end-rule" && f.object_id === o.id));
  m.selectObject(o.id);
  m.addRule(o.id);
  assert.ok(!validate(m).some((f) => f.rule === "timer-no-end-rule"));
  assert.deepEqual(errors(validate(m)), []);
});
