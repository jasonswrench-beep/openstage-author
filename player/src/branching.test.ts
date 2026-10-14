// Tests for rules that change what the course does: conditions, order, and branching by a learner's answers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { newRuntime, examplePackage } from "./test-helpers.ts";
import type { CoursePackage, Slide, Trigger } from "./types.ts";

const rule = (id: string, event: Trigger["event"], action: Trigger["action"], target: string, conditions: Trigger["conditions"] = [], value?: Trigger["value"]): Trigger =>
  ({ id, event, action, target, conditions, ...(value === undefined ? {} : { value }) });

/** The example course with a third slide, a string variable, and the Continue button's rules replaced. */
function branching(triggers: Trigger[]): { pkg: CoursePackage; button: string } {
  const pkg = examplePackage();
  pkg.project.variables.push({ id: "var-path", name: "path", type: "string", initial: "" }, { id: "var-score", name: "score", type: "number", initial: 0 });
  const third: Slide = JSON.parse(JSON.stringify(pkg.slides[0]));
  third.id = "slide-003";
  third.name = "Third";
  for (const o of [third.baseLayer, ...third.layers].flatMap((l) => l.objects)) o.id = `${o.id}-c`;
  pkg.slides.push(third);
  const button = pkg.slides[0]!.baseLayer.objects.find((o) => o.id === "obj-0004")!;
  button.triggers = triggers;
  return { pkg, button: button.id };
}

const isA = [{ variable: "var-path", operator: "equals" as const, value: "a" }];
const isB = [{ variable: "var-path", operator: "equals" as const, value: "b" }];

test("a button sends the learner down the path their answer chose", () => {
  for (const [answer, expected] of [["a", "slide-002"], ["b", "slide-003"]] as const) {
    const { pkg, button } = branching([
      rule("t1", "click", "jumpToSlide", "slide-002", isA), rule("t2", "click", "jumpToSlide", "slide-003", isB),
    ]);
    const { rt } = newRuntime(pkg);
    rt.goTo("slide-001");
    rt.setVariable("var-path", answer);
    rt.fire(button, "click");
    assert.equal(rt.currentSlide?.id, expected, `answer ${answer}`);
  }
});

test("when no rule's conditions hold, nothing happens", () => {
  const { pkg, button } = branching([rule("t1", "click", "jumpToSlide", "slide-002", isA)]);
  const { rt } = newRuntime(pkg);
  rt.goTo("slide-001");
  assert.equal(rt.fire(button, "click"), 0);
  assert.equal(rt.currentSlide?.id, "slide-001");
});

test("a jump ends the list: when two rules could send the learner somewhere, the first one wins", () => {
  const { pkg, button } = branching([rule("t1", "click", "jumpToSlide", "slide-003"), rule("t2", "click", "jumpToSlide", "slide-002")]);
  const { rt } = newRuntime(pkg);
  rt.goTo("slide-001");
  assert.equal(rt.fire(button, "click"), 1);
  assert.equal(rt.currentSlide?.id, "slide-003");
});

test("rules before a jump still run, and rules after it do not", () => {
  const { pkg, button } = branching([
    rule("t1", "click", "setVariable", "var-path", [], "before"), rule("t2", "click", "jumpToSlide", "slide-002"), rule("t3", "click", "setVariable", "var-path", [], "after"),
  ]);
  const { rt } = newRuntime(pkg);
  rt.goTo("slide-001");
  rt.fire(button, "click");
  assert.equal(rt.variables.get("var-path"), "before");
  assert.equal(rt.currentSlide?.id, "slide-002");
});

test("answering an input can show a layer straight away, with no button", () => {
  const { pkg } = branching([]);
  const slide = pkg.slides[0]!;
  slide.layers.push({ id: "layer-help", name: "Help", objects: [] });
  slide.baseLayer.objects.push({
    id: "obj-0900", type: "input", name: "Choice", geometry: { x: 0, y: 0, width: 300, height: 120, rotation: 0, z: 90 },
    content: { kind: "radio", prompt: "Pick", report: false, variable: "var-path", options: [{ id: "o1", label: "A", value: "a" }, { id: "o2", label: "B", value: "b" }] },
    style: {}, accessibility: { altText: "Pick", role: "group", tabOrder: 9, decorative: false },
    states: {}, triggers: [], timing: { appear: "time", start: 0, visibleFor: null }, animation: { enter: { effect: "none", duration: 500 }, exit: { effect: "none", duration: 500 } }, narration: null, provenance: null, simulation: null,
  });
  // The rule lives on another object. Which object holds it does not matter.
  slide.baseLayer.objects.find((o) => o.id === "obj-0004")!.triggers = [rule("t1", "variableChange", "showLayer", "layer-help", isB)];
  const { rt, log } = newRuntime(pkg);
  rt.goTo("slide-001");
  rt.setInput("obj-0900", "obj-0900", "var-path", "a", "choice", "a");
  assert.ok(!log.includes("layer layer-help true"), "answer A does not show it");
  rt.setInput("obj-0900", "obj-0900", "var-path", "b", "choice", "b");
  assert.ok(log.includes("layer layer-help true"), "answer B shows it");
});

test("a rule can need several conditions, and a number can be compared", () => {
  const { pkg, button } = branching([
    rule("t1", "click", "jumpToSlide", "slide-003", [...isA, { variable: "var-score", operator: "greaterThanOrEqual", value: 3 }]),
    rule("t2", "click", "jumpToSlide", "slide-002"),
  ]);
  const { rt } = newRuntime(pkg);
  rt.goTo("slide-001");
  rt.setVariable("var-path", "a");
  rt.setVariable("var-score", 2);
  rt.fire(button, "click");
  assert.equal(rt.currentSlide?.id, "slide-002", "the score is too low, so the second rule applies");
  rt.goTo("slide-001");
  rt.setVariable("var-score", 3);
  rt.fire(button, "click");
  assert.equal(rt.currentSlide?.id, "slide-003", "both conditions hold");
});

// ---- adding to a number variable

test("a rule can add to a number variable, by an amount or by one", () => {
  const { pkg, button } = branching([
    rule("t1", "click", "setVariable", "var-score", [], 2), rule("t2", "click", "setVariable", "var-score"), rule("t3", "click", "setVariable", "var-score", [], -0.5),
  ]);
  pkg.slides[0]!.baseLayer.objects.find((o) => o.id === button)!.triggers.forEach((t) => (t.operation = "add"));
  const { rt } = newRuntime(pkg);
  rt.goTo("slide-001");
  rt.fire(button, "click");
  assert.equal(rt.variables.get("var-score"), 2 + 1 - 0.5, "2, then 1 because there is no amount, then minus a half");
  rt.fire(button, "click");
  assert.equal(rt.variables.get("var-score"), 5);
});

test("adding counts tries, and a condition on the count decides what happens", () => {
  const tries = [{ variable: "var-score", operator: "greaterThanOrEqual" as const, value: 3 }];
  const { pkg, button } = branching([
    rule("t1", "click", "setVariable", "var-score", [], 1),
    rule("t2", "click", "jumpToSlide", "slide-003", tries),
  ]);
  pkg.slides[0]!.baseLayer.objects.find((o) => o.id === button)!.triggers[0]!.operation = "add";
  const { rt } = newRuntime(pkg);
  rt.goTo("slide-001");
  rt.fire(button, "click");
  rt.fire(button, "click");
  assert.equal(rt.currentSlide?.id, "slide-001", "two tries: still here");
  rt.fire(button, "click");
  assert.equal(rt.currentSlide?.id, "slide-003", "the third try crosses the line");
});

test("adding 0.1 three times gives 0.3", () => {
  const { pkg, button } = branching([rule("t1", "click", "setVariable", "var-score", [], 0.1)]);
  pkg.slides[0]!.baseLayer.objects.find((o) => o.id === button)!.triggers[0]!.operation = "add";
  const { rt } = newRuntime(pkg);
  rt.goTo("slide-001");
  for (let i = 0; i < 3; i++) rt.fire(button, "click");
  assert.equal(rt.variables.get("var-score"), 0.3);
});

test("a variable that is not a number is left alone by an add", () => {
  const { pkg, button } = branching([rule("t1", "click", "setVariable", "var-path", [], 1)]);
  pkg.slides[0]!.baseLayer.objects.find((o) => o.id === button)!.triggers[0]!.operation = "add";
  const { rt } = newRuntime(pkg);
  rt.goTo("slide-001");
  rt.setVariable("var-path", "a");
  rt.fire(button, "click");
  assert.equal(rt.variables.get("var-path"), "a");
});

test("a rule with no operation still sets the variable, as before", () => {
  const { pkg, button } = branching([rule("t1", "click", "setVariable", "var-score", [], 7)]);
  const { rt } = newRuntime(pkg);
  rt.goTo("slide-001");
  rt.fire(button, "click");
  rt.fire(button, "click");
  assert.equal(rt.variables.get("var-score"), 7);
});
