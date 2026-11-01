// Tests for inputs in the course runtime: the variable is set, and answers reach the LMS only when asked.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeLms } from "./fake-lms.ts";
import { FakeLms2004 } from "./fake-lms-2004.ts";
import { INPUT_KINDS, INPUT_VARIABLE_TYPE, sliderShown, sliderSpoken, snapToStep, stepDecimals, textLines, textMaxLength, TEXT_DEFAULT_MAX, TEXT_LIMIT } from "./inputs.ts";
import type { RuntimeEvent } from "./runtime.ts";
import { Tracker } from "./scorm.ts";
import { Scorm2004Tracker } from "./scorm2004.ts";
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

// ---- slider and dial (added in 0.42.0)

const slider = (report: boolean, extra: Partial<InputContent> = {}): InputContent => ({
  kind: "slider", prompt: "How confident are you?", report, variable: "var-rate", min: 0, max: 10, step: 0.5,
  unit: "points", startLabel: "Not at all", endLabel: "Completely", ...extra,
});

test("sliders and dials save a number", () => {
  assert.equal(INPUT_VARIABLE_TYPE.slider, "number");
  assert.equal(INPUT_VARIABLE_TYPE.dial, "number");
});

test("a value snaps to the scale: between the ends, a whole number of steps, and no decimal dust", () => {
  assert.equal(snapToStep(7.3, 0, 10, 0.5), 7.5);
  assert.equal(snapToStep(-4, 0, 10, 0.5), 0);
  assert.equal(snapToStep(99, 0, 10, 0.5), 10);
  assert.equal(snapToStep(0.1 + 0.2, 0, 1, 0.1), 0.3, "0.30000000000000004 is not what the learner chose");
  assert.equal(snapToStep(3.7, 1, 10, 3), 4, "steps count from the lowest value");
  assert.equal(snapToStep(10, 1, 10, 4), 9, "the last step that fits, when the top is not a whole number of steps away");
  assert.equal(snapToStep(5, 5, 5, 1), 5, "a scale with no room gives its only value");
  assert.equal(stepDecimals(0.25), 2);
  assert.equal(stepDecimals(5), 0);
  assert.equal(stepDecimals(1e-7), 7);
});

test("a value is shown with its unit, and said with what an end means", () => {
  const c = slider(false);
  assert.equal(sliderShown(c, 7.5), "7.5 points", "a word gets a space");
  assert.equal(sliderShown(slider(false, { unit: "%", step: 1 }), 40), "40%", "a sign does not");
  assert.equal(sliderShown(slider(false, { unit: "", step: 1 }), 4), "4");
  assert.equal(sliderShown(slider(false, { step: 1 }), 4), "4 points");
  assert.equal(sliderSpoken(c, 0), "0.0 points, Not at all");
  assert.equal(sliderSpoken(c, 10), "10.0 points, Completely");
  assert.equal(sliderSpoken(c, 5), "5.0 points");
  assert.equal(sliderSpoken(slider(false, { startLabel: "  " }), 0), "0.0 points", "an empty label says nothing");
});

test("a slider being dragged moves the variable, and is reported only when the learner stops", () => {
  const { rt } = newRuntime(packageWith(slider(true)));
  const events: RuntimeEvent[] = [];
  rt.onEvent((e) => events.push(e));
  rt.goTo("slide-001");
  rt.setInput("obj-0900", "obj-0900", "var-rate", 2, "numeric", "2.0", true);
  rt.setInput("obj-0900", "obj-0900", "var-rate", 6.5, "numeric", "6.5", true);
  assert.equal(rt.variables.get("var-rate"), 6.5, "a rule that reads the variable sees it move as it is dragged");
  assert.equal(events.filter((e) => e.type === "input").length, 0, "nothing is reported yet");
  rt.setInput("obj-0900", "obj-0900", "var-rate", 6.5, "numeric", "6.5");
  assert.equal(events.filter((e) => e.type === "input").length, 1);
});

// ---- text fields (0.48.0)

const textField = (report: boolean, over: Partial<InputContent> = {}): InputContent => ({ kind: "text", prompt: "What is your name?", report, variable: "var-pick", ...over });

test("a text field saves words into a text variable", () => {
  assert.ok((INPUT_KINDS as readonly string[]).includes("text"));
  assert.equal(INPUT_VARIABLE_TYPE.text, "string");
  const { rt } = newRuntime(packageWith(textField(false)));
  rt.goTo("slide-001");
  rt.setInput("obj-0900", "obj-0900", "var-pick", "Ada Lovelace", "fill-in", "Ada Lovelace");
  assert.equal(rt.variables.get("var-pick"), "Ada Lovelace");
  rt.setInput("obj-0900", "obj-0900", "var-pick", "", "fill-in", "");
  assert.equal(rt.variables.get("var-pick"), "", "a cleared box is saved too");
});

test("how big a text field is: a whole number of lines from 1 to 10 and of characters from 1 to 2000, or the usual", () => {
  assert.equal(textMaxLength({}), TEXT_DEFAULT_MAX);
  assert.equal(textMaxLength({ maxLength: 50 }), 50);
  assert.equal(textMaxLength({ maxLength: TEXT_LIMIT }), TEXT_LIMIT);
  for (const bad of [0, -1, 2.5, TEXT_LIMIT + 1, Number.NaN]) assert.equal(textMaxLength({ maxLength: bad }), TEXT_DEFAULT_MAX, String(bad));
  assert.equal(textLines({}), 1);
  assert.equal(textLines({ lines: 4 }), 4);
  assert.equal(textLines({ lines: 10 }), 10);
  for (const bad of [0, 11, 1.5, -2]) assert.equal(textLines({ lines: bad }), 1, String(bad));
});

test("a reported text field is a fill-in interaction in SCORM 1.2, cut to the 250 characters an LMS takes", () => {
  const { lms, rt } = launch(textField(true));
  rt.setInput("obj-0900", "obj-0900", "var-pick", "Ada", "fill-in", "Ada");
  assert.equal(lms.data["cmi.interactions.0.id"], "obj-0900");
  assert.equal(lms.data["cmi.interactions.0.type"], "fill-in");
  assert.equal(lms.data["cmi.interactions.0.student_response"], "Ada");
  rt.setInput("obj-0900", "obj-0900", "var-pick", "x".repeat(400), "fill-in", "x".repeat(250));
  assert.equal(lms.data["cmi.interactions.0.student_response"], "x".repeat(250), "the answer is replaced, not added");
  assert.equal(lms.data["cmi.interactions.1.id"], undefined);
});

test("a reported text field is a fill_in interaction in SCORM 2004, and the strict LMS accepts it", () => {
  const lms = new FakeLms2004();
  lms.relaunch();
  const { rt } = newRuntime(packageWith(textField(true)));
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
  try {
    new Scorm2004Tracker(lms, rt).begin();
    rt.goTo("slide-001");
    rt.setInput("obj-0900", "obj-0900", "var-pick", "Ada", "fill-in", "Ada");
  } finally {
    console.warn = realWarn;
  }
  assert.equal(lms.data["cmi.interactions.0.type"], "fill_in");
  assert.equal(lms.data["cmi.interactions.0.learner_response"], "Ada");
  assert.deepEqual(warnings, []);
});

test("a text field that does not report tells the LMS nothing, and a cleared one is not an answer to tell", () => {
  const quiet = launch(textField(false));
  quiet.rt.setInput("obj-0900", "obj-0900", "var-pick", "Ada", "fill-in", "Ada");
  assert.equal(quiet.lms.data["cmi.interactions.0.id"], undefined);
  const loud = launch(textField(true));
  loud.rt.setInput("obj-0900", "obj-0900", "var-pick", "", "fill-in", "");
  assert.equal(loud.lms.data["cmi.interactions.0.id"], undefined, "nothing to tell");
  assert.equal(loud.rt.variables.get("var-pick"), "");
});

test("a reported slider is a numeric interaction in SCORM 1.2", () => {
  const { lms, rt } = launch(slider(true));
  rt.setInput("obj-0900", "obj-0900", "var-rate", 7.5, "numeric", "7.5", true);
  rt.setInput("obj-0900", "obj-0900", "var-rate", 7.5, "numeric", "7.5");
  assert.equal(lms.data["cmi.interactions.0.id"], "obj-0900");
  assert.equal(lms.data["cmi.interactions.0.type"], "numeric");
  assert.equal(lms.data["cmi.interactions.0.student_response"], "7.5");
  assert.equal(lms.data["cmi.interactions.1.id"], undefined, "one interaction, not one for each step of the drag");
});

test("a reported slider is a numeric interaction in SCORM 2004, and the strict LMS accepts it", () => {
  const lms = new FakeLms2004();
  lms.relaunch();
  const { rt } = newRuntime(packageWith(slider(true)));
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
  try {
    new Scorm2004Tracker(lms, rt).begin();
    rt.goTo("slide-001");
    rt.setInput("obj-0900", "obj-0900", "var-rate", 7.5, "numeric", "7.5");
    rt.setInput("obj-0900", "obj-0900", "var-rate", 9, "numeric", "9.0");
  } finally {
    console.warn = realWarn;
  }
  assert.equal(lms.data["cmi.interactions.0.type"], "numeric");
  assert.equal(lms.data["cmi.interactions.0.learner_response"], "9.0", "the last answer replaces the first");
  assert.equal(lms.data["cmi.interactions.1.id"], undefined);
  assert.deepEqual(warnings, []);
});
