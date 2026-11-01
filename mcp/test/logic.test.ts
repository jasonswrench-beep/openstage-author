// What a course remembers and does: variables, layers and rules, through the real protocol layer. A rule that cannot be made as asked is refused and
// leaves nothing behind.

import assert from "node:assert/strict";
import { test } from "node:test";
import { objectNamed, readSlide, started, read } from "./world.ts";

const havePython = Boolean(process.env["OPENSTAGE_PYTHON"]);

/** A course with a second slide, a button on the first, and the button's id. */
async function withButton() {
  const w = await started();
  await w.call("add_slide", { name: "Second" });
  const button = (await w.call("add_object", { slide: 1, kind: "button", text: "Go on" })).data;
  return { w, button: button.id as string };
}

test("a variable is added with its starting value, listed with the course, and saved", async () => {
  const w = await started();
  try {
    const r = await w.call("add_variable", { name: "Score", type: "number", initial: 5 });
    assert.ok(r.ok, r.text);
    assert.deepEqual([r.data.name, r.data.type], ["Score", "number"]);
    await w.call("add_variable", { name: "Seen", type: "boolean" });
    await w.call("add_variable", { name: "Choice", type: "string", initial: "none" });
    const vars = (await w.call("get_course")).data.variables;
    assert.deepEqual(vars.map((v: any) => [v.name, v.type, v.initial]), [["Score", "number", 5], ["Seen", "boolean", false], ["Choice", "string", "none"]]);
    assert.equal(JSON.parse(read(w.folder, "Course", "project.json")).variables.length, 3);
  } finally {
    w.done();
  }
});

test("a variable with a name that is taken, a value of the wrong kind or no name is refused", async () => {
  const w = await started();
  try {
    await w.call("add_variable", { name: "Score", type: "number" });
    assert.match((await w.call("add_variable", { name: "score", type: "string" })).text, /already a variable called score/);
    assert.match((await w.call("add_variable", { name: "Count", type: "number", initial: "five" })).text, /must be a number/);
    assert.match((await w.call("add_variable", { name: "Flag", type: "boolean", initial: 1 })).text, /true or false/);
    assert.match((await w.call("add_variable", { name: "Words", type: "string", initial: true })).text, /must be text/);
    assert.match((await w.call("add_variable", { name: "  ", type: "number" })).text, /needs a name/);
    assert.ok(!(await w.call("add_variable", { name: "X", type: "date" })).ok);
    assert.equal((await w.call("get_course")).data.variables.length, 1, "nothing was left behind");
  } finally {
    w.done();
  }
});

test("renaming a variable changes the texts that show it, and its starting value can be changed", async () => {
  const w = await started();
  try {
    await w.call("add_variable", { name: "Score", type: "number" });
    const t = (await w.call("add_object", { slide: 1, kind: "text", text: "You scored {{Score}} points" })).data;
    const r = await w.call("set_variable", { variable: "Score", name: "Points", initial: 10 });
    assert.ok(r.ok, r.text);
    assert.match(r.text, /renamed to Points.*1 text that shows it was changed/);
    assert.equal(objectNamed((await w.call("get_slide", { slide: 1 })).data, t.name).text, "You scored {{Points}} points");
    assert.equal((await w.call("get_course")).data.variables[0].initial, 10);
    assert.match((await w.call("set_variable", { variable: "Points", initial: "ten" })).text, /not of its kind|That needs a number/);
    assert.match((await w.call("set_variable", { variable: "Points" })).text, /Nothing was asked for/);
    assert.match((await w.call("set_variable", { variable: "Nothing", name: "x" })).text, /no variable "Nothing".*The variables are: Points/);
  } finally {
    w.done();
  }
});

test("a variable that something uses cannot be deleted, and says where it is used", async () => {
  const { w, button } = await withButton();
  try {
    await w.call("add_variable", { name: "Seen", type: "boolean" });
    await w.call("add_variable", { name: "Spare", type: "number" });
    await w.call("add_rule", { object: button, action: "setVariable", target: "Seen", value: true });
    assert.match((await w.call("delete_variable", { variable: "Seen", confirm: true })).text, /is used by .* on .*cannot be deleted/);
    assert.match((await w.call("delete_variable", { variable: "Spare", confirm: false })).text, /confirm: true/);
    assert.ok((await w.call("delete_variable", { variable: "Spare", confirm: true })).ok);
    assert.deepEqual((await w.call("get_course")).data.variables.map((v: any) => v.name), ["Seen"]);
  } finally {
    w.done();
  }
});

test("a layer is added, named, filled with objects, renamed and deleted, and the base layer stays", async () => {
  const w = await started();
  try {
    const added = await w.call("add_layer", { slide: 1, name: "Feedback" });
    assert.ok(added.ok, added.text);
    const text = await w.call("add_object", { slide: 1, layer: "Feedback", kind: "text", text: "Well done" });
    assert.match(text.text, /to the layer Feedback of slide 1/);
    assert.equal(text.data.layer, "Feedback");
    const slide = (await w.call("get_slide", { slide: 1 })).data;
    assert.deepEqual(slide.layers.map((l: any) => [l.name, l.base, l.objects.length > 0]), [["Base", true, true], ["Feedback", false, true]]);
    assert.ok((await w.call("rename_layer", { slide: 1, layer: "Feedback", name: "Praise" })).ok);
    assert.match((await w.call("add_object", { slide: 1, layer: "Nowhere", kind: "text" })).text, /no layer "Nowhere" on Title slide.*Praise/);
    assert.match((await w.call("delete_layer", { slide: 1, layer: "Praise", confirm: false })).text, /confirm: true/);
    assert.match((await w.call("delete_layer", { slide: 1, layer: "Base", confirm: true })).text, /base layer cannot be deleted/);
    assert.ok((await w.call("delete_layer", { slide: 1, layer: "Praise", confirm: true })).ok);
    assert.equal((await w.call("get_slide", { slide: 1 })).data.layers.length, 1);
    assert.equal(readSlide(w.folder, "Course", 1).layers.length, 0);
  } finally {
    w.done();
  }
});

test("a button is given a rule that goes to a slide, by number or by name, and it works with the keyboard too", async () => {
  const { w, button } = await withButton();
  try {
    const r = await w.call("add_rule", { object: button, action: "jumpToSlide", target: 2 });
    assert.ok(r.ok, r.text);
    assert.match(r.text, /Added rule 1 to .*When the learner presses it, go to slide 2, Second\./);
    const triggers = readSlide(w.folder, "Course", 1).baseLayer.objects.find((o: any) => o.id === button).triggers;
    assert.deepEqual(triggers.map((t: any) => [t.event, t.action, t.target]), [["click", "jumpToSlide", "slide-002"], ["keyActivate", "jumpToSlide", "slide-002"]]);
    assert.ok((await w.call("add_rule", { object: button, action: "jumpToSlide", target: "Title slide" })).ok);
    const rules = await w.call("get_rules", { object: button });
    assert.equal(rules.data.length, 2);
    assert.equal(rules.data[1].sentence, "When the learner presses it, go to slide 1, Title slide.");
    assert.equal(objectNamed((await w.call("get_slide", { slide: 1 })).data, "Button").rules, 2);
  } finally {
    w.done();
  }
});

test("rules that show a layer, set and add to variables, and only do it if something is so", async () => {
  const { w, button } = await withButton();
  try {
    await w.call("add_layer", { slide: 1, name: "Hint" });
    await w.call("add_variable", { name: "Tries", type: "number" });
    await w.call("add_variable", { name: "Passed", type: "boolean" });
    await w.call("add_variable", { name: "Name", type: "string" });
    assert.match((await w.call("add_rule", { object: button, action: "showLayer", target: "Hint" })).text, /show the layer "Hint"/);
    assert.match((await w.call("add_rule", { object: button, action: "addToVariable", target: "Tries", value: 1 })).text, /add 1 to "Tries"/);
    assert.match((await w.call("add_rule", { object: button, action: "setVariable", target: "Passed", value: true, conditions: [{ variable: "Tries", operator: "greaterThanOrEqual", value: 3 }] })).text, /set "Passed" to true, if "Tries" is at least 3\./);
    assert.match((await w.call("add_rule", { object: button, action: "setVariable", target: "Name", value: "Jo", conditions: [{ variable: "Passed", operator: "equals", value: true }, { variable: "Name", operator: "notEquals", value: "" }] })).text, /if "Passed" is true and "Name" is not ""/);
    assert.match((await w.call("add_rule", { object: button, action: "nextSlide" })).text, /go to the next slide/);
    const stored = readSlide(w.folder, "Course", 1).baseLayer.objects.find((o: any) => o.id === button).triggers;
    assert.equal(stored.length, 10, "five rules, each as a click and a key press");
    assert.deepEqual(stored[4].conditions, [{ variable: "var-1", operator: "greaterThanOrEqual", value: 3 }], "Tries, the first variable, is var-1");
    assert.equal((await w.call("get_rules", { object: button })).data.length, 5);
  } finally {
    w.done();
  }
});

test("a rule that cannot be made as asked is refused with the reason and leaves nothing behind", async () => {
  const { w, button } = await withButton();
  try {
    await w.call("add_variable", { name: "Tries", type: "number" });
    await w.call("add_variable", { name: "Name", type: "string" });
    const text = (await w.call("add_object", { slide: 1, kind: "text", text: "Hello" })).data;
    const refused = async (args: Record<string, unknown>, pattern: RegExp) => {
      const r = await w.call("add_rule", { object: button, ...args });
      assert.equal(r.ok, false, JSON.stringify(args));
      assert.match(r.text, pattern, JSON.stringify(args));
    };
    await refused({ action: "jumpToSlide", target: 9 }, /not something "jumpToSlide" can point at.*The choices are: 1\. Title slide; 2\. Second/);
    await refused({ action: "jumpToSlide" }, /needs a target/);
    await refused({ action: "nextSlide", target: 2 }, /acts on the course itself and takes no target/);
    await refused({ action: "showLayer", target: "Hint" }, /This slide has no layers.*add_layer/);
    await refused({ action: "playMedia", target: "x" }, /no video or audio to play/);
    await refused({ action: "setVariable", target: "Tries" }, /needs a value/);
    await refused({ action: "setVariable", target: "Tries", value: "many" }, /did not come out as asked|needs a number/);
    await refused({ action: "setVariable", target: "Name", value: 4 }, /did not come out as asked/);
    await refused({ action: "addToVariable", target: "Name", value: 1 }, /not something "addToVariable" can point at/);
    await refused({ action: "jumpToSlide", target: 2, value: 1 }, /takes no value/);
    await refused({ action: "jumpToSlide", target: 2, event: "mediaComplete" }, /cannot cause "mediaComplete"/);
    await refused({ action: "setVariable", target: "Tries", value: 1, conditions: [{ variable: "Name", operator: "lessThan", value: "x" }] }, /did not come out as asked|does not suit/);
    await refused({ action: "setVariable", target: "Tries", value: 1, conditions: [{ variable: "Nothing", operator: "equals", value: 1 }] }, /no variable "Nothing"/);
    assert.equal((await w.call("get_rules", { object: button })).data.length, 0, "no half-made rule is left");
    const onText = await w.call("add_rule", { object: text.id, event: "activate", action: "nextSlide" });
    assert.match(onText.text, /cannot cause "activate"/);
    assert.ok((await w.call("add_rule", { object: text.id, action: "nextSlide" })).ok, "a text's rule starts when the slide starts");
    assert.equal((await w.call("get_rules", { object: text.id })).data[0].when, "slideStart");
  } finally {
    w.done();
  }
});

test("a rule is deleted by its number and the others keep their order, and undo brings it back", async () => {
  const { w, button } = await withButton();
  try {
    await w.call("add_rule", { object: button, action: "nextSlide" });
    await w.call("add_rule", { object: button, action: "previousSlide" });
    await w.call("add_rule", { object: button, action: "replaySlide" });
    assert.ok((await w.call("delete_rule", { object: button, rule: 2 })).ok);
    assert.deepEqual((await w.call("get_rules", { object: button })).data.map((r: any) => r.does), ["nextSlide", "replaySlide"]);
    assert.match((await w.call("delete_rule", { object: button, rule: 5 })).text, /has no rule 5/);
    assert.ok((await w.call("undo")).ok);
    assert.deepEqual((await w.call("get_rules", { object: button })).data.map((r: any) => r.does), ["nextSlide", "previousSlide", "replaySlide"]);
  } finally {
    w.done();
  }
});

test("a rule on a button in a layer shows its own slide's layers, and a rule on another slide cannot reach them", async () => {
  const { w } = await withButton();
  try {
    await w.call("add_layer", { slide: 1, name: "Only here" });
    const other = (await w.call("add_object", { slide: 2, kind: "button", text: "Elsewhere" })).data;
    assert.match((await w.call("add_rule", { object: other.id, action: "showLayer", target: "Only here" })).text, /This slide has no layers/);
    await w.call("add_layer", { slide: 2, name: "Only here" });
    assert.ok((await w.call("add_rule", { object: other.id, action: "showLayer", target: "Only here" })).ok);
    const stored = readSlide(w.folder, "Course", 2).baseLayer.objects.find((o: any) => o.id === other.id).triggers[0];
    assert.equal(stored.target, readSlide(w.folder, "Course", 2).layers[0].id);
  } finally {
    w.done();
  }
});

test("a course with variables, layers and rules passes the check", { skip: !havePython }, async () => {
  const { w, button } = await withButton();
  try {
    await w.call("add_layer", { slide: 1, name: "Hint" });
    await w.call("add_object", { slide: 1, layer: "Hint", kind: "text", text: "A hint" });
    await w.call("add_variable", { name: "Tries", type: "number" });
    await w.call("add_rule", { object: button, action: "addToVariable", target: "Tries", value: 1 });
    await w.call("add_rule", { object: button, action: "showLayer", target: "Hint", conditions: [{ variable: "Tries", operator: "lessThan", value: 3 }] });
    await w.call("add_rule", { object: button, action: "jumpToSlide", target: 2 });
    const result = await w.call("check_course");
    assert.equal(result.data.errors, 0, JSON.stringify(result.data.findings, null, 1));
  } finally {
    w.done();
  }
});
