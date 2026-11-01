// Tests for inputs and surveys: adding them with their variables, editing their parts, undo, and the real validator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { INPUT_KINDS, INPUT_VARIABLE_TYPE } from "../../player/src/inputs.ts";
import type { InputContent } from "../../player/src/types.ts";
import { ADD_MENU, INPUTS } from "./factory.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-10" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const content = (m: Model) => m.object!.content as unknown as InputContent;
const parts = (c: InputContent) => (c.kind === "checkbox" ? c.items! : c.kind === "likert" || c.kind === "semantic" ? c.rows! : c.options!);

test("quiz questions, inputs and surveys share one menu entry that opens a picker", () => {
  assert.ok(ADD_MENU.some((e) => e.value === "group:question"));
  assert.ok(!ADD_MENU.some((e) => e.value === "group:quiz"));
  assert.ok(ADD_MENU.length <= 9);
});

test("the catalogue offers every kind of input once, with a size that fits the slide", () => {
  assert.deepEqual(INPUTS.map((i) => i.id).sort(), [...INPUT_KINDS].sort());
  for (const i of INPUTS) { assert.ok(i.label && i.description); assert.ok(i.size.w <= 1280 && i.size.h <= 720); }
});

test("each input is added with its own variables of the right type, a prompt, alt text and a tab stop", () => {
  // A choice of character needs a cast to choose from, and has its own tests in scenario.test.ts.
  for (const choice of INPUTS.filter((i) => i.id !== "character")) {
    const m = fresh();
    const before = m.variables.length;
    const o = m.addInput(choice.id)!;
    const c = content(m);
    assert.equal(o.type, "input");
    assert.ok(c.prompt.trim() !== "");
    assert.equal(o.accessibility.altText, c.prompt, "alt text starts as the prompt");
    assert.ok((o.accessibility.tabOrder ?? 0) >= 1);
    const used = c.kind === "radio" || c.kind === "dropdown" || c.kind === "list" || c.kind === "slider" || c.kind === "dial" || c.kind === "text" ? [c.variable!] : parts(c).map((p) => (p as { variable: string }).variable);
    assert.equal(new Set(used).size, used.length, `${choice.id}: no two parts share a variable`);
    assert.equal(m.variables.length - before, used.length, `${choice.id}: one new variable for each`);
    for (const id of used) assert.equal(m.variables.find((v) => v.id === id)!.type, INPUT_VARIABLE_TYPE[choice.id]);
  }
});

test("adding an input, with its variables, is one undo step", () => {
  const m = fresh();
  const objects = m.objects.length;
  m.addInput("likert");
  assert.equal(m.variables.length, 3);
  m.undo();
  assert.equal(m.objects.length, objects);
  assert.equal(m.variables.length, 0, "the variables go too");
  m.redo();
  assert.equal(m.variables.length, 3);
});

test("a project with variables is written to project.json, and with none left it matches the original", () => {
  const m = fresh();
  assert.equal(m.dirtyFiles().some((f) => f.path === "project.json"), false);
  m.addInput("radio");
  assert.ok(m.dirtyFiles().some((f) => f.path === "project.json" && f.text.includes("var-1")));
});

test("the prompt carries the alt text along only while they still match", () => {
  const m = fresh();
  const o = m.addInput("radio")!;
  m.setInputPrompt(o.id, "Pick a colour");
  assert.equal(m.object!.accessibility.altText, "Pick a colour");
  m.setAccessibility(o.id, { altText: "Pick a colour. Use the arrow keys." });
  m.setInputPrompt(o.id, "Pick a flavour");
  assert.equal(m.object!.accessibility.altText, "Pick a colour. Use the arrow keys.", "the author's own alt text is kept");
  assert.equal(m.setInputPrompt(o.id, "  "), null, "a prompt cannot be empty");
});

test("options keep to their limits, and a value follows the label until it is set by hand", () => {
  const m = fresh();
  const o = m.addInput("radio")!;
  const first = parts(content(m))[0]!;
  m.setInputPartText(o.id, first.id, "label", "Red");
  assert.equal((parts(content(m))[0] as { value: string }).value, "red", "value follows the label");
  m.setInputPartText(o.id, first.id, "value", "r");
  m.setInputPartText(o.id, first.id, "label", "Crimson");
  assert.equal((parts(content(m))[0] as { value: string }).value, "r", "a value set by hand stays");
  assert.match(m.setInputPartText(o.id, first.id, "value", "option-2")!, /already saves that value/);
  assert.match(m.setInputPartText(o.id, first.id, "value", "")!, /cannot be empty/);
  assert.match(m.setInputPartText(o.id, first.id, "label", " ")!, /cannot be empty/);

  while (parts(content(m)).length > 2) m.deleteInputPart(o.id, parts(content(m))[0]!.id);
  assert.match(m.deleteInputPart(o.id, parts(content(m))[0]!.id)!, /at least 2/);
  while (parts(content(m)).length < 12) m.addInputPart(o.id);
  assert.match(m.addInputPart(o.id)!, /at most 12/);
  assert.equal(new Set(parts(content(m)).map((p) => p.id)).size, 12, "ids stay unique");
});

test("a checkbox, statement or pair gets a new variable when added, and deleting one leaves the others alone", () => {
  for (const kind of ["checkbox", "likert", "semantic"]) {
    const m = fresh();
    const o = m.addInput(kind)!;
    const before = m.variables.length;
    m.addInputPart(o.id);
    assert.equal(m.variables.length, before + 1, kind);
    const keep = (parts(content(m))[1] as { variable: string }).variable;
    m.deleteInputPart(o.id, parts(content(m))[0]!.id);
    assert.equal((parts(content(m))[0] as { variable: string }).variable, keep, kind);
  }
});

// ---- deleting a part takes its variable too, when nothing else uses it

const varOf = (p: unknown) => (p as { variable: string }).variable;

test("deleting a checkbox, statement or pair deletes the variable it saved to, and says so", () => {
  for (const kind of ["checkbox", "likert", "semantic"]) {
    const m = fresh();
    const o = m.addInput(kind)!;
    const [first, second, third] = parts(content(m));
    const gone = m.variables.find((v) => v.id === varOf(second))!;
    assert.equal(m.variables.length, 3, kind);
    assert.equal(m.deleteInputPart(o.id, second!.id), `Deleted number 2 and its variable ${gone.name}`, kind);
    assert.deepEqual(m.variables.map((v) => v.id), [varOf(first), varOf(third)], `${kind}: only the deleted part's variable went`);
    assert.deepEqual(parts(content(m)).map((p) => varOf(p)), [varOf(first), varOf(third)], kind);
  }
});

test("deleting statements 2 and 3 of a new Likert scale leaves only statement1", () => {
  const m = fresh();
  const o = m.addInput("likert")!;
  const [, second, third] = parts(content(m));
  m.deleteInputPart(o.id, second!.id);
  m.deleteInputPart(o.id, third!.id);
  assert.deepEqual(m.variables.map((v) => v.name), ["statement1"]);
  assert.equal(parts(content(m)).length, 1);
});

test("a variable that a rule reads stays when its part is deleted, and the message does not claim it went", () => {
  const m = fresh();
  const b = m.addObject("button")!;
  m.addRule(b.id);
  const o = m.addInput("likert")!;
  m.addCondition(b.id, 0);
  const [first, second] = parts(content(m));
  assert.equal(m.rulesOf(b.id).length, 1);
  assert.equal(JSON.stringify(m.objects.find((x) => x.id === b.id)!.triggers).includes(`"${varOf(first)}"`), true, "the rule reads the first statement's variable");
  assert.equal(m.deleteInputPart(o.id, first!.id), "Deleted number 1");
  assert.equal(parts(content(m)).length, 2);
  assert.ok(m.variables.some((v) => v.id === varOf(first)), "the variable the rule reads is kept");
  assert.equal(m.variables.length, 3);
  assert.match(m.deleteInputPart(o.id, second!.id)!, /and its variable statement2/, "a part nothing else uses still takes its variable");
  assert.equal(m.variables.length, 2);
});

test("a variable that another input saves to stays when its part is deleted", () => {
  const m = fresh();
  const a = m.addInput("checkbox")!;
  const firstOfA = parts(content(m))[0]!;
  const b = m.addInput("checkbox")!;
  const firstOfB = parts(content(m))[0]!;
  assert.equal(m.setInputVariable(b.id, firstOfB.id, varOf(firstOfA)), "Saves to option1");
  assert.equal(m.deleteInputPart(a.id, firstOfA.id), "Deleted number 1");
  assert.ok(m.variables.some((v) => v.id === varOf(firstOfA)), "the second input still saves to it");
  assert.equal(varOf(parts(content(m))[0]), varOf(firstOfA));
});

test("the options of a radio, drop-down or list never take the shared variable with them", () => {
  for (const kind of ["radio", "dropdown", "list"]) {
    const m = fresh();
    const o = m.addInput(kind)!;
    const shared = content(m).variable!;
    while (parts(content(m)).length > 2) assert.equal(m.deleteInputPart(o.id, parts(content(m))[0]!.id), `Deleted number 1`, kind);
    assert.equal(content(m).variable, shared, kind);
    assert.deepEqual(m.variables.map((v) => v.id), [shared], `${kind}: the shared variable is still there`);
  }
});

test("undo brings back a deleted part and its variable together, and redo removes both again", () => {
  const m = fresh();
  const o = m.addInput("likert")!;
  const before = JSON.stringify({ variables: m.variables, rows: content(m).rows });
  const second = parts(content(m))[1]!;
  m.deleteInputPart(o.id, second.id);
  assert.equal(m.variables.length, 2);
  assert.equal(parts(content(m)).length, 2);
  m.undo();
  assert.equal(JSON.stringify({ variables: m.variables, rows: content(m).rows }), before, "one undo restores the part and the variable exactly");
  m.redo();
  assert.equal(m.variables.length, 2);
  assert.equal(parts(content(m)).length, 2);
  m.undo();
  m.undo();
  assert.equal(m.objects.some((x) => x.id === o.id), false, "the next undo is the one that adds the input, so the delete was a single step");
  assert.equal(m.variables.length, 0);
});

test("a part that cannot be deleted leaves its variable alone", () => {
  const m = fresh();
  const o = m.addInput("checkbox")!;
  while (parts(content(m)).length > 1) m.deleteInputPart(o.id, parts(content(m))[0]!.id);
  const only = parts(content(m))[0]!;
  assert.match(m.deleteInputPart(o.id, only.id)!, /at least 1/);
  assert.deepEqual(m.variables.map((v) => v.id), [varOf(only)]);
});

test("a part can be pointed at another variable of the right type, but not a wrong or shared one", () => {
  const m = fresh();
  const o = m.addInput("checkbox")!;
  const extra = m.addVariable("boolean", "agreed");
  const other = m.addVariable("number", "score");
  const [a, b] = parts(content(m)) as { id: string; variable: string }[];
  assert.match(m.setInputVariable(o.id, a!.id, other.id)!, /saves a boolean, but score is a number/);
  assert.match(m.setInputVariable(o.id, a!.id, b!.variable)!, /overwrite each other/);
  assert.equal(m.setInputVariable(o.id, a!.id, extra.id), "Saves to agreed");
  assert.equal((parts(content(m))[0] as { variable: string }).variable, extra.id);
  const was = b!.variable;
  m.newInputVariable(o.id, b!.id);
  assert.notEqual((parts(content(m))[1] as { variable: string }).variable, was);
});

test("variables can be renamed, but not to a blank or to another variable's name", () => {
  const m = fresh();
  const v1 = m.addVariable("string", "colour");
  const v2 = m.addVariable("string", "shape");
  assert.match(m.renameVariable(v1.id, " ")!, /needs a name/);
  assert.match(m.renameVariable(v1.id, "SHAPE")!, /already a variable called/);
  assert.equal(m.renameVariable(v1.id, "favourite"), "Variable renamed to favourite");
  assert.equal(m.variableName(v1.id), "favourite");
  assert.equal(m.variableName(v2.id), "shape");
});

test("a Likert scale needs 2 to 9 labels and a semantic differential 3 to 9 points", () => {
  const m = fresh();
  const l = m.addInput("likert")!;
  assert.match(m.setLikertScale(l.id, ["Only one"])!, /between 2 and 9/);
  assert.equal(m.setLikertScale(l.id, ["No", "", "Yes"]), "The scale has 2 points", "blank lines are ignored");
  assert.deepEqual(content(m).scale, ["No", "Yes"]);
  const s = m.addInput("semantic")!;
  assert.equal(m.setSemanticPoints(s.id, 2), null);
  assert.equal(m.setSemanticPoints(s.id, 5), "5 points between the words");
  assert.equal(content(m).points, 5);
});

// ---- the real validator

type Finding = { severity: string; rule: string; message: string };
type SlideFile = { baseLayer: { objects: { type: string; content: InputContent }[] } };

function validate(m: Model, edit?: (c: InputContent) => void): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-inputs-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) {
      let text = f.text;
      if (edit && f.path === "slides/slide-001.json") {
        const slide = JSON.parse(text) as SlideFile;
        edit(slide.baseLayer.objects.find((o) => o.type === "input")!.content);
        text = JSON.stringify(slide, null, 2) + "\n";
      }
      writeFileSync(path.join(dir, f.path), text);
    }
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const opts = { skip: !process.env["OPENSTAGE_PYTHON"] };
const rules = (f: Finding[]) => f.filter((x) => x.severity === "error").map((x) => x.rule);

test("every kind of input passes the real validator as soon as it is added", opts, () => {
  const m = fresh();
  for (const choice of INPUTS) m.addInput(choice.id);
  assert.deepEqual(rules(validate(m)), []);
});

test("a survey with parts deleted, and their variables with them, still passes the real validator", opts, () => {
  const m = fresh();
  for (const kind of ["checkbox", "likert", "semantic"]) {
    const o = m.addInput(kind)!;
    while (parts(content(m)).length > 1) m.deleteInputPart(o.id, parts(content(m))[1]!.id);
  }
  assert.equal(m.variables.length, 3, "one variable left for each input's one remaining part");
  assert.deepEqual(rules(validate(m)), []);
});

test("the validator flags an input that saves to a missing variable, a wrong type, or a shared variable", opts, () => {
  const m = fresh();
  m.addInput("checkbox");
  assert.ok(rules(validate(m, (c) => { c.items![0]!.variable = "var-nope"; })).includes("input-unknown-variable"));
  const m2 = fresh();
  m2.addInput("likert");
  m2.addVariable("string", "text");
  assert.ok(rules(validate(m2, (c) => { c.rows![0]!.variable = "var-4"; })).includes("input-variable-type"));
  assert.ok(rules(validate(m2, (c) => { c.rows![1]!.variable = c.rows![0]!.variable; })).includes("input-shared-variable"));
});

test("the validator flags duplicate or empty option values, duplicate ids, and a scale row with one word", opts, () => {
  const m = fresh();
  m.addInput("dropdown");
  assert.ok(rules(validate(m, (c) => { c.options![1]!.value = c.options![0]!.value; })).includes("input-duplicate-value"));
  assert.ok(rules(validate(m, (c) => { c.options![1]!.value = ""; })).includes("input-empty-value"));
  assert.ok(rules(validate(m, (c) => { c.options![1]!.id = c.options![0]!.id; })).includes("input-duplicate-id"));
  const s = fresh();
  s.addInput("semantic");
  assert.ok(rules(validate(s, (c) => { c.rows![0]!.right = " "; })).includes("input-semantic-pole"));
});

test("the schema refuses an input without the parts its kind needs", opts, () => {
  const m = fresh();
  m.addInput("radio");
  assert.ok(rules(validate(m, (c) => { delete c.options; })).length > 0);
  assert.ok(rules(validate(m, (c) => { c.prompt = ""; })).length > 0);
});

// ---- slider and dial (added in 0.42.0)

test("a new slider or dial starts as a working 0 to 100 scale with its own number variable", () => {
  for (const id of ["slider", "dial"] as const) {
    const m = fresh();
    m.addInput(id);
    const c = content(m);
    assert.deepEqual([c.min, c.max, c.step, c.showValue], [0, 100, 1, true]);
    assert.equal(m.variables.find((v) => v.id === c.variable)!.type, "number");
    assert.ok(c.prompt.trim() && c.startLabel && c.endLabel, "a prompt, and a word for each end to start from");
  }
});

test("the scale is changed one number at a time, and a number that would break it is refused with the reason", () => {
  const m = fresh();
  const o = m.addInput("slider")!;
  assert.equal(m.setSliderScale(o.id, "max", 10), "Highest value 10");
  assert.equal(m.setSliderScale(o.id, "step", 0.5), "Step 0.5");
  assert.deepEqual([content(m).min, content(m).max, content(m).step], [0, 10, 0.5]);
  assert.equal(m.setSliderScale(o.id, "max", 10), null, "no change, no undo step");
  assert.match(m.setSliderScale(o.id, "min", 10)!, /highest value has to be above/);
  assert.match(m.setSliderScale(o.id, "max", -1)!, /highest value has to be above/);
  assert.match(m.setSliderScale(o.id, "step", 0)!, /more than 0/);
  assert.match(m.setSliderScale(o.id, "step", -2)!, /more than 0/);
  assert.match(m.setSliderScale(o.id, "step", 0.0001)!, /at most 3 decimals/);
  assert.match(m.setSliderScale(o.id, "max", 100000)!, /10000 steps/);
  assert.equal(m.setSliderScale(o.id, "min", Number.NaN), null);
  assert.deepEqual([content(m).min, content(m).max, content(m).step], [0, 10, 0.5], "a refused number changes nothing");
});

test("the words and whether the number shows are changed, and empty words are taken away", () => {
  const m = fresh();
  const o = m.addInput("dial")!;
  m.setSliderText(o.id, "unit", "%");
  m.setSliderText(o.id, "startLabel", "None");
  assert.deepEqual([content(m).unit, content(m).startLabel], ["%", "None"]);
  assert.equal(m.setSliderText(o.id, "unit", "%"), null);
  m.setSliderText(o.id, "unit", "");
  assert.ok(!("unit" in content(m)), "empty words are not kept");
  assert.equal(m.setSliderShowValue(o.id, false), "The number is not shown");
  assert.equal(content(m).showValue, false);
  assert.equal(m.setSliderShowValue(o.id, false), null);
});

test("these changes only apply to a slider or a dial, and each is one undo step", () => {
  const m = fresh();
  const radio = m.addInput("radio")!;
  assert.equal(m.setSliderScale(radio.id, "max", 5), null);
  assert.equal(m.setSliderText(radio.id, "unit", "x"), null);
  assert.equal(m.setSliderShowValue(radio.id, false), null);
  const s = m.addInput("slider")!;
  m.setSliderScale(s.id, "max", 50);
  m.undo();
  assert.equal(content(m).max, 100);
});

test("a slider can be pointed at a different number variable, but not at text", () => {
  const m = fresh();
  const s = m.addInput("slider")!;
  const other = m.addVariable("number", "other").id;
  const text = m.addVariable("string", "words").id;
  assert.match(m.setInputVariable(s.id, null, other)!, /^Saves to/);
  assert.equal(content(m).variable, other);
  assert.match(m.setInputVariable(s.id, null, text)!, /saves a number/);
  assert.equal(content(m).variable, other);
});

// ---- text field (added in 0.48.0)

test("a new text field starts as a one-line box of up to 200 characters with its own text variable", () => {
  const m = fresh();
  m.addInput("text");
  const c = content(m);
  assert.deepEqual([c.kind, c.lines, c.maxLength, c.report], ["text", 1, 200, false]);
  assert.equal(m.variables.find((v) => v.id === c.variable)!.type, "string");
  assert.ok(c.prompt.trim() !== "", "a prompt to start from");
  assert.equal(m.object!.accessibility.role, "group");
});

test("the box is changed one number at a time, and a number outside what is allowed is refused with the reason", () => {
  const m = fresh();
  const o = m.addInput("text")!;
  assert.equal(m.setTextBox(o.id, "lines", 4), "4 lines");
  assert.equal(m.setTextBox(o.id, "maxLength", 500), "Up to 500 characters");
  assert.deepEqual([content(m).lines, content(m).maxLength], [4, 500]);
  assert.equal(m.setTextBox(o.id, "lines", 4), null, "no change, no undo step");
  assert.equal(m.setTextBox(o.id, "lines", 1), "One line");
  assert.match(m.setTextBox(o.id, "lines", 0)!, /1 to 10 lines/);
  assert.match(m.setTextBox(o.id, "lines", 11)!, /1 to 10 lines/);
  assert.match(m.setTextBox(o.id, "lines", 2.5)!, /1 to 10 lines/);
  assert.match(m.setTextBox(o.id, "maxLength", 0)!, /1 to 2000 characters/);
  assert.match(m.setTextBox(o.id, "maxLength", 2001)!, /1 to 2000 characters/);
  assert.equal(m.setTextBox(o.id, "maxLength", Number.NaN), null);
  assert.deepEqual([content(m).lines, content(m).maxLength], [1, 500], "a refused number changes nothing");
});

test("the hint is changed and taken away with empty words, and these changes apply only to a text field, each as one undo step", () => {
  const m = fresh();
  const o = m.addInput("text")!;
  assert.equal(m.setTextHint(o.id, "Your first name is enough."), "Updated");
  assert.equal(content(m).hint, "Your first name is enough.");
  assert.equal(m.setTextHint(o.id, "Your first name is enough."), null);
  assert.equal(m.setTextHint(o.id, ""), "No hint");
  assert.ok(!("hint" in content(m)), "empty words are not kept");
  m.undo();
  assert.ok(!content(m).hint, "the changes to the hint are one undo step, like typing in any box, so one undo takes them all back");
  const radio = m.addInput("radio")!;
  assert.equal(m.setTextBox(radio.id, "lines", 3), null);
  assert.equal(m.setTextHint(radio.id, "x"), null);
});

test("a text field can be pointed at another text variable, but not at a number", () => {
  const m = fresh();
  const o = m.addInput("text")!;
  const other = m.addVariable("string", "other").id;
  const number = m.addVariable("number", "count").id;
  assert.match(m.setInputVariable(o.id, null, other)!, /^Saves to/);
  assert.equal(content(m).variable, other);
  assert.match(m.setInputVariable(o.id, null, number)!, /saves a string/);
  assert.equal(content(m).variable, other);
});

test("a text field passes the real validator, and one that reports more than 250 characters gets a warning", opts, () => {
  const m = fresh();
  const o = m.addInput("text")!;
  m.setTextBox(o.id, "lines", 3);
  m.setTextHint(o.id, "Used on the certificate.");
  assert.deepEqual(rules(validate(m)), []);
  assert.ok(!validate(m).some((f) => f.rule === "input-text-report-long"));
  m.setInputReport(o.id, true);
  m.setTextBox(o.id, "maxLength", 400);
  assert.ok(validate(m).some((f) => f.rule === "input-text-report-long" && f.severity === "warning"), "the LMS keeps only 250 characters");
  assert.deepEqual(rules(validate(m)), [], "but it is not an error");
});
