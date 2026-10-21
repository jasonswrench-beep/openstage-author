// Run with: npm test   (from the player folder)
import assert from "node:assert/strict";
import { test } from "node:test";
import { lookLayers, READY_LOOKS, spokenOnChange } from "./looks.ts";
import { Runtime, type Host } from "./runtime.ts";
import { examplePackage, newRuntime } from "./test-helpers.ts";
import type { CoursePackage, ObjectState, OSObject, Trigger } from "./types.ts";

const states: Record<string, ObjectState> = {
  visited: { style: { color: "#111111", fill: "#222222" } },
  hover: { style: { fill: "#333333" } },
  done: { style: { fill: "#444444" }, announce: "Marked as done" },
  quiet: { style: { fill: "#555555" } },
  silent: { announce: "   " },
};

const now = (over: Partial<{ name: string; visited: boolean; hover: boolean }> = {}) => ({ name: "normal", visited: false, hover: false, ...over });

test("with nothing going on there is no look over the object's own", () => {
  assert.deepEqual(lookLayers(states, now()), []);
  assert.deepEqual(lookLayers({}, now({ visited: true, hover: true, name: "done" })), []);
});

test("looks stack in order, so a later one wins: used, then what a rule applied, then hover", () => {
  assert.deepEqual(lookLayers(states, now({ visited: true })), [states["visited"]!.style]);
  assert.deepEqual(lookLayers(states, now({ name: "done" })), [states["done"]!.style]);
  assert.deepEqual(lookLayers(states, now({ visited: true, name: "done", hover: true })), [states["visited"]!.style, states["done"]!.style, states["hover"]!.style]);
});

test("a look the object does not have, or that sets no style, adds nothing", () => {
  assert.deepEqual(lookLayers(states, now({ name: "nowhere" })), []);
  assert.deepEqual(lookLayers(states, now({ name: "silent" })), []);
  assert.deepEqual(lookLayers({ done: { announce: "Done" } }, now({ hover: true })), []);
});

test("a rule can apply a ready-made look by name too", () => {
  assert.deepEqual(lookLayers(states, now({ name: "hover" })), [states["hover"]!.style]);
  assert.deepEqual(READY_LOOKS, ["hover", "visited", "disabled"]);
});

test("a rule applying a look with a message says it, and nothing else does", () => {
  assert.equal(spokenOnChange(states, "normal", "done"), "Marked as done");
  assert.equal(spokenOnChange(states, "normal", "quiet"), null, "no message, no words");
  assert.equal(spokenOnChange(states, "normal", "silent"), null, "blank words are no words");
  assert.equal(spokenOnChange(states, "normal", "nowhere"), null, "a look the object lacks says nothing");
});

test("going back to normal, or to the look it already has, says nothing", () => {
  assert.equal(spokenOnChange(states, "done", "normal"), null);
  assert.equal(spokenOnChange(states, "done", "done"), null, "no change, nothing new to hear");
  assert.equal(spokenOnChange(states, "quiet", "done"), "Marked as done", "from one look to another is a change");
});

const rule = (id: string, action: Trigger["action"], target: string, value?: string): Trigger =>
  ({ id, event: "slideStart", action, target, ...(value === undefined ? {} : { value }), conditions: [] }) as Trigger;

test("the course hands a rule's look to the display, and normal when there is no value", () => {
  const pkg = examplePackage();
  const slide = pkg.slides[0]!;
  slide.baseLayer.objects[0]!.triggers.push(rule("trg-8001", "changeState", "obj-0004", "done"), rule("trg-8002", "changeState", "obj-0004"));
  const { rt, log } = newRuntime(pkg);
  rt.goTo("slide-001"); // opening the slide runs its slideStart rules
  assert.deepEqual(log.filter((l) => l.startsWith("state ")), ["state obj-0004 done", "state obj-0004 normal"]);
});

// ---- a resumed slide gets back the looks that depend on variables

type Call = [object: string, look: string, quiet: boolean | undefined];

/** A runtime whose display records every look it is asked to show, and whether it was asked to say nothing about it. */
function recording(pkg: CoursePackage) {
  const calls: Call[] = [];
  const host: Host = {
    showSlide: () => {},
    setLayerVisible: () => {},
    playMedia: () => {},
    pauseMedia: () => {},
    stopTimer: () => {},
    setObjectState: (id, look, quiet) => void calls.push([id, look, quiet]),
  };
  return { rt: new Runtime(pkg, host), calls };
}

const rule2 = (id: string, event: Trigger["event"], action: Trigger["action"], target: string, value: string | number | boolean | undefined, conditions: Trigger["conditions"]): Trigger =>
  ({ id, event, action, target, ...(value === undefined ? {} : { value }), conditions }) as Trigger;
const attemptsAre = (n: number): Trigger["conditions"] => [{ variable: "var-attempts", operator: "equals", value: n }];
const leftAt = (slide: string, vars: Record<string, number | boolean | string> = {}) => ({ slide, vars, quiz: {}, layers: [], visited: "11" });

test("a resumed slide gets back a look that depends on a variable, and says nothing about it", () => {
  const pkg = examplePackage();
  pkg.slides[0]!.baseLayer.objects[0]!.triggers.push(rule2("trg-9001", "slideStart", "changeState", "obj-0004", "done", attemptsAre(5)));
  const { rt, calls } = recording(pkg);
  assert.equal(rt.restore(leftAt("slide-001", { "var-attempts": 5 })), true);
  assert.deepEqual(calls, [["obj-0004", "done", true]], "applied from the saved variable, and quietly");
});

test("a look whose condition no longer holds is not put back", () => {
  const pkg = examplePackage();
  pkg.slides[0]!.baseLayer.objects[0]!.triggers.push(rule2("trg-9001", "slideStart", "changeState", "obj-0004", "done", attemptsAre(5)));
  const { rt, calls } = recording(pkg);
  rt.restore(leftAt("slide-001", { "var-attempts": 4 }));
  assert.deepEqual(calls, []);
});

test("opening the same slide the ordinary way still applies the look as before, and is not asked to be quiet", () => {
  const pkg = examplePackage();
  pkg.slides[0]!.baseLayer.objects[0]!.triggers.push(rule2("trg-9001", "slideStart", "changeState", "obj-0004", "done", attemptsAre(0)));
  const { rt, calls } = recording(pkg);
  rt.goTo("slide-001");
  assert.deepEqual(calls, [["obj-0004", "done", undefined]]);
});

test("a look with no condition is not put back on a resume, because the learner may have changed it since the slide opened", () => {
  const pkg = examplePackage();
  pkg.slides[0]!.baseLayer.objects[0]!.triggers.push(rule2("trg-9001", "slideStart", "changeState", "obj-0004", "disabled", []));
  const resumed = recording(pkg);
  resumed.rt.restore(leftAt("slide-001"));
  assert.deepEqual(resumed.calls, [], "left as the object's own appearance, as it always was");
  const opened = recording(pkg);
  opened.rt.goTo("slide-001");
  assert.deepEqual(opened.calls, [["obj-0004", "disabled", undefined]], "but an ordinary opening still applies it");
});

test("only rules that apply a look are run again on a resume: a rule that does anything else would repeat what the learner already did", () => {
  const pkg = examplePackage();
  const first = pkg.slides[0]!.baseLayer.objects[0]!;
  first.triggers.push(
    rule2("trg-9001", "slideStart", "setVariable", "var-answered", true, attemptsAre(5)),
    rule2("trg-9002", "slideStart", "jumpToSlide", "slide-002", undefined, attemptsAre(5)),
    rule2("trg-9003", "slideStart", "showLayer", "layer-nowhere", undefined, attemptsAre(5)),
  );
  const { rt, calls } = recording(pkg);
  rt.restore(leftAt("slide-001", { "var-attempts": 5 }));
  assert.equal(rt.currentSlide!.id, "slide-001", "no jump");
  assert.equal(rt.variables.get("var-answered"), false, "no variable set");
  assert.deepEqual([...rt.visibleLayers], ["layer-base"], "no layer shown");
  assert.deepEqual(calls, []);
});

test("rules that run when a variable changes are put back too, after the ones that run when the slide opens, whichever object holds them", () => {
  const pkg = examplePackage();
  const [a, b] = pkg.slides[0]!.baseLayer.objects as [OSObject, OSObject];
  a.triggers.push(rule2("trg-9001", "variableChange", "changeState", "obj-0004", "late", attemptsAre(5)));
  b.triggers.push(rule2("trg-9002", "slideStart", "changeState", "obj-0004", "early", attemptsAre(5)));
  const { rt, calls } = recording(pkg);
  rt.restore(leftAt("slide-001", { "var-attempts": 5 }));
  assert.deepEqual(calls.map((c) => c[1]), ["early", "late"]);
});

test("rules for the same object run in order, so the last true one wins, as when the slide opened", () => {
  const pkg = examplePackage();
  pkg.slides[0]!.baseLayer.objects[0]!.triggers.push(
    rule2("trg-9001", "slideStart", "changeState", "obj-0004", "first", attemptsAre(5)),
    rule2("trg-9002", "slideStart", "changeState", "obj-0004", "second", attemptsAre(5)),
    rule2("trg-9003", "slideStart", "changeState", "obj-0004", undefined, attemptsAre(9)),
  );
  const { rt, calls } = recording(pkg);
  rt.restore(leftAt("slide-001", { "var-attempts": 5 }));
  assert.deepEqual(calls.map((c) => c[1]), ["first", "second"]);
});

test("a rule with a condition on a variable the course does not have applies nothing", () => {
  const pkg = examplePackage();
  pkg.slides[0]!.baseLayer.objects[0]!.triggers.push(
    rule2("trg-9001", "slideStart", "changeState", "obj-0004", "done", [{ variable: "var-gone", operator: "equals", value: 1 }]),
  );
  const { rt, calls } = recording(pkg);
  rt.restore(leftAt("slide-001", { "var-gone": 1 }));
  assert.deepEqual(calls, []);
});
