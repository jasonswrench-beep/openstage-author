// Tests for inputs in the course runtime: the variable is set, and answers reach the LMS only when asked.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeLms } from "./fake-lms.ts";
import { INPUT_KINDS, INPUT_VARIABLE_TYPE } from "./inputs.ts";
import type { RuntimeEvent } from "./runtime.ts";
import { Tracker } from "./scorm.ts";
import { examplePackage, newRuntime } from "./test-helpers.ts";
import type { CoursePackage, InputContent, OSObject } from "./types.ts";

function inputObject(content: InputContent): OSObject {
  return {
    id: "obj-0900", type: "input", name: "Input",
    geometry: { x: 0, y: 0, width: 400, height: 200, rotation: 0, z: 90 },
    content: content as unknown as Record<string, unknown>,
    style: {}, accessibility: { altText: content.prompt, role: "group", tabOrder: 9, decorative: false },
    states: {}, triggers: [], timing: { appear: "time", start: 0, visibleFor: null }, animation: { enter: { effect: "none", duration: 500 }, exit: { effect: "none", duration: 500 } }, narration: null, provenance: null, simulation: null,
  };
}

function packageWith(content: InputContent): CoursePackage {
  const pkg = examplePackage();
  pkg.project.variables.push(
    { id: "var-pick", name: "pick", type: "string", initial: "" },
    { id: "var-rate", name: "rate", type: "number", initial: 0 },
    { id: "var-box", name: "box", type: "boolean", initial: false },
  );
  pkg.slides[0]!.baseLayer.objects.push(inputObject(content));
  return pkg;
}

const radio = (report: boolean): InputContent => ({
  kind: "radio", prompt: "Pick one", report, variable: "var-pick",
  options: [{ id: "opt-1", label: "Red", value: "red" }, { id: "opt-2", label: "Blue", value: "blue" }],
});
const likert = (report: boolean): InputContent => ({
  kind: "likert", prompt: "Rate", report, scale: ["No", "Maybe", "Yes"], rows: [{ id: "row-1", label: "I like it", variable: "var-rate" }],
});

test("every kind of input names the type of variable it saves", () => {
  for (const k of INPUT_KINDS) assert.ok(["boolean", "string", "number"].includes(INPUT_VARIABLE_TYPE[k]));
});

test("an input saves what the learner chose into its variable", () => {
  const { rt } = newRuntime(packageWith(radio(false)));
  rt.goTo("slide-001");
  assert.equal(rt.variables.get("var-pick"), "");
  rt.setInput("obj-0900", "obj-0900", "var-pick", "blue", "choice", "b");
  assert.equal(rt.variables.get("var-pick"), "blue");
});

test("an input does nothing for an object that is not an input on the current slide", () => {
  const { rt } = newRuntime(packageWith(radio(false)));
  rt.goTo("slide-001");
  rt.setInput("obj-0004", "obj-0004", "var-pick", "x", "choice", "a");
  rt.setInput("nope", "nope", "var-pick", "x", "choice", "a");
  assert.equal(rt.variables.get("var-pick"), "");
});

test("answers are announced to the LMS layer only when the input is set to report", () => {
  for (const report of [false, true]) {
    const { rt } = newRuntime(packageWith(radio(report)));
    const events: RuntimeEvent[] = [];
    rt.onEvent((e) => events.push(e));
    rt.goTo("slide-001");
    rt.setInput("obj-0900", "obj-0900", "var-pick", "red", "choice", "a");
    assert.equal(events.filter((e) => e.type === "input").length, report ? 1 : 0, `report ${report}`);
  }
});

function launch(content: InputContent) {
  const lms = new FakeLms();
  lms.relaunch();
  const { rt } = newRuntime(packageWith(content));
  const tracker = new Tracker(lms, rt);
  tracker.begin();
  rt.goTo("slide-001");
  return { lms, rt };
}

test("a reported choice becomes an LMS interaction, and a changed answer replaces it", () => {
  const { lms, rt } = launch(radio(true));
  rt.setInput("obj-0900", "obj-0900", "var-pick", "red", "choice", "a");
  assert.equal(lms.data["cmi.interactions.0.id"], "obj-0900");
  assert.equal(lms.data["cmi.interactions.0.type"], "choice");
  assert.equal(lms.data["cmi.interactions.0.student_response"], "a");
  rt.setInput("obj-0900", "obj-0900", "var-pick", "blue", "choice", "b");
  assert.equal(lms.data["cmi.interactions._count"] ?? "1", "1", "still one interaction");
  assert.equal(lms.data["cmi.interactions.0.student_response"], "b");
  assert.equal(lms.data["cmi.interactions.1.id"], undefined);
});

test("a reported scale row is a likert interaction with the chosen point", () => {
  const { lms, rt } = launch(likert(true));
  rt.setInput("obj-0900", "row-1", "var-rate", 3, "likert", "3");
  assert.equal(lms.data["cmi.interactions.0.id"], "obj-0900.row-1");
  assert.equal(lms.data["cmi.interactions.0.type"], "likert");
  assert.equal(lms.data["cmi.interactions.0.student_response"], "3");
});

test("an input that does not report writes nothing to the LMS", () => {
  const { lms, rt } = launch(likert(false));
  rt.setInput("obj-0900", "row-1", "var-rate", 2, "likert", "2");
  assert.equal(lms.data["cmi.interactions.0.id"], undefined);
  assert.equal(rt.variables.get("var-rate"), 2);
});
