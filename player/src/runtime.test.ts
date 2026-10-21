// Run with: npm test   (from the player folder)
import assert from "node:assert/strict";
import { test } from "node:test";
import { compare } from "./runtime.ts";
import { newRuntime } from "./test-helpers.ts";

function setup() {
  const { rt, log } = newRuntime();
  return { rt, log };
}

test("variables start at their initial values", () => {
  const { rt } = setup();
  assert.equal(rt.variables.get("var-attempts"), 0);
  assert.equal(rt.variables.get("var-answered"), false);
});

test("compare handles every operator and unknown variables", () => {
  assert.ok(compare(1, "lessThan", 3));
  assert.ok(!compare(3, "lessThan", 3));
  assert.ok(compare(3, "lessThanOrEqual", 3));
  assert.ok(compare(4, "greaterThan", 3));
  assert.ok(compare(3, "greaterThanOrEqual", 3));
  assert.ok(compare("a", "equals", "a"));
  assert.ok(compare("a", "notEquals", "b"));
  assert.ok(!compare(undefined, "equals", 1));
});

test("a click and a keyActivate on Continue both jump to slide 2", () => {
  for (const event of ["click", "keyActivate"] as const) {
    const { rt, log } = setup();
    rt.goTo("slide-001");
    assert.equal(rt.fire("obj-0004", event), 1);
    assert.equal(rt.currentSlide?.id, "slide-002");
    assert.deepEqual(log, ["show slide-001", "show slide-002"]);
  }
});

test("feedback layers start hidden", () => {
  const { rt } = setup();
  rt.goTo("slide-002");
  assert.deepEqual([...rt.visibleLayers], ["layer-base"]);
});

test("a wrong answer shows retry feedback and allows another attempt", () => {
  const { rt, log } = setup();
  rt.goTo("slide-002");
  const out = rt.submitQuiz("obj-0011", "c2", "click");
  assert.equal(out?.correct, false);
  assert.equal(out?.locked, false);
  assert.ok(log.includes("layer layer-retry true"));
  assert.equal(rt.variables.get("var-answered"), true);
});

test("a right answer locks the question, scores it and shows correct feedback", () => {
  const { rt, log } = setup();
  rt.goTo("slide-002");
  const out = rt.submitQuiz("obj-0011", "c1", "keyActivate");
  assert.equal(out?.correct, true);
  assert.equal(out?.locked, true);
  assert.equal(out?.score, 10);
  assert.ok(log.includes("layer layer-correct true"));
  assert.ok(!rt.visibleLayers.has("layer-retry"));
});

test("running out of attempts locks the question with no score", () => {
  const { rt } = setup();
  rt.goTo("slide-002");
  rt.submitQuiz("obj-0011", "c2", "click");
  const out = rt.submitQuiz("obj-0011", "c3", "click");
  assert.equal(out?.locked, true);
  assert.equal(out?.score, 0);
  assert.equal(out?.result, "incorrect");
});

test("submitting without choosing does nothing", () => {
  const { rt } = setup();
  rt.goTo("slide-002");
  assert.equal(rt.submitQuiz("obj-0011", null, "click"), null);
  assert.equal(rt.quiz.size, 0);
});

test("conditions gate triggers", () => {
  const { rt } = setup();
  rt.goTo("slide-001");
  const btn = rt.currentSlide!.baseLayer.objects.find((o) => o.id === "obj-0004")!;
  btn.triggers[0]!.conditions = [{ variable: "var-attempts", operator: "greaterThan", value: 5 }];
  assert.equal(rt.fire("obj-0004", "click"), 0);
  assert.equal(rt.currentSlide?.id, "slide-001");
});

test("a trigger loop is stopped instead of hanging", () => {
  const { rt } = setup();
  rt.goTo("slide-001");
  const btn = rt.currentSlide!.baseLayer.objects.find((o) => o.id === "obj-0004")!;
  btn.triggers.push({ id: "loop", event: "slideStart", action: "jumpToSlide", target: "slide-001", conditions: [] });
  rt.goTo("slide-001");
  assert.equal(rt.currentSlide?.id, "slide-001");
});

test("a timer's rules run when its time is up, and a rule can stop a timer", () => {
  const { rt, log } = setup();
  rt.goTo("slide-001");
  const slide = rt.currentSlide!;
  const timer = {
    ...slide.baseLayer.objects.find((o) => o.id === "obj-0004")!, id: "obj-timer", type: "timer" as const,
    content: { seconds: 30, label: "Time left", extendBy: 30 },
    triggers: [
      { id: "t1", event: "timerEnd" as const, action: "showLayer" as const, target: "layer-correct", conditions: [] },
      { id: "t2", event: "timerEnd" as const, action: "setVariable" as const, target: "var-attempts", value: 7, conditions: [] },
    ],
  };
  slide.baseLayer.objects.push(timer);
  slide.baseLayer.objects.push({ ...timer, id: "obj-stopper", type: "button" as const, triggers: [{ id: "stop", event: "click" as const, action: "stopTimer" as const, target: "obj-timer", conditions: [] }] });
  log.length = 0;
  rt.fire("obj-stopper", "click");
  assert.ok(log.includes("stopTimer obj-timer"), "the host is asked to stop that timer");
  assert.equal(rt.fire("obj-timer", "timerEnd"), 2, "both of the timer's rules run when its time is up");
  assert.equal(rt.variables.get("var-attempts"), 7);
});
