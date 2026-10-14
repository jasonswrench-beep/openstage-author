// Scenarios: where the learner is, what a choice does, who is speaking, and how the course remembers it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeLms } from "./fake-lms.ts";
import { INPUT_KINDS, INPUT_VARIABLE_TYPE } from "./inputs.ts";
import type { RuntimeEvent } from "./runtime.ts";
import {
  choose, describeMeterChanges, isEnding, MAX_STEPS, meterValues, pathReview, speakerOf, totalEffects, undo, walk, youOf,
} from "./scenario.ts";
import { Tracker, decodeSuspend, encodeSuspend } from "./scorm.ts";
import { examplePackage, newRuntime } from "./test-helpers.ts";
import type { Character, CoursePackage, OSObject, ScenarioContent, ScenarioLine } from "./types.ts";

const cast: Character[] = [
  { id: "maya", name: "Maya Reyes", role: "Nurse manager", voice: "af_heart", picture: { src: "assets/images/maya.png", alt: "Maya in a blue coat", decorative: false } },
  { id: "dev", name: "Dev Patel", role: "New hire", voice: "am_adam", picture: null },
];

const line = (id: string, text: string, speaker: string | null = null): ScenarioLine => ({ id, speaker, text, narration: null });

function story(over: Partial<ScenarioContent> = {}): ScenarioContent {
  return {
    start: "n-start",
    you: null,
    nodes: [
      {
        id: "n-start", title: "At the desk", prompt: "What do you do?", lines: [line("l-1", "A patient arrives.", "maya")],
        choices: [
          { id: "c-1", label: "Greet them", next: "n-mid", effects: [{ variable: "var-trust", add: 2 }], response: [line("r-1", "She smiles.", "maya")] },
          { id: "c-2", label: "Ignore them", next: "n-end", effects: [{ variable: "var-trust", add: -2 }], response: [] },
        ],
      },
      {
        id: "n-mid", title: "The questions", prompt: "", lines: [line("l-2", "She asks about the wait.", "maya")],
        choices: [
          { id: "c-3", label: "Explain the wait", next: "n-end", effects: [{ variable: "var-trust", add: 1 }, { variable: "var-calm", add: 0.1 }], response: [] },
          { id: "c-4", label: "Go back to the desk", next: "n-start", effects: [], response: [] },
        ],
      },
      { id: "n-end", title: "The end", prompt: "", lines: [line("l-3", "The shift is over.")], choices: [] },
    ],
    meters: [{ id: "m-1", label: "Trust", variable: "var-trust", min: -5, max: 5 }],
    allowRetry: true,
    finishedVariable: "var-done",
    reflection: "What would you do differently?",
    ...over,
  };
}

// ---- where the learner is

test("an empty path is the start, and each digit is the choice made in the situation the learner was in", () => {
  const c = story();
  assert.deepEqual(walk(c, "")!.nodes.map((n) => n.id), ["n-start"]);
  const w = walk(c, "00")!;
  assert.deepEqual(w.nodes.map((n) => n.id), ["n-start", "n-mid", "n-end"]);
  assert.deepEqual(w.choices.map((x) => x.id), ["c-1", "c-3"]);
  assert.equal(w.path, "00");
});

test("a path that no longer fits the scenario is cut at the first step that does not fit", () => {
  const c = story();
  assert.equal(walk(c, "05")!.path, "0", "the middle situation has two choices, not six");
  assert.equal(walk(c, "x")!.path, "");
  assert.equal(walk(c, "001")!.path, "00", "nothing can be chosen at an ending");
  assert.equal(walk(story({ start: "n-nowhere" }), ""), null, "no start, no walk");
});

test("a story that loops back keeps its whole path, up to a limit", () => {
  const c = story();
  const loop = "01".repeat(10);
  assert.equal(walk(c, loop)!.path, loop);
  assert.equal(walk(c, "01".repeat(MAX_STEPS))!.path.length, MAX_STEPS);
});

test("a situation with no choices is an ending", () => {
  assert.deepEqual(story().nodes.map(isEnding), [false, false, true]);
});

// ---- what a choice does

test("a choice moves the learner and says what it adds", () => {
  assert.deepEqual(choose(story(), "", 0), { path: "0", effects: [{ variable: "var-trust", add: 2 }], finished: false });
});

test("a choice that leads to an ending says so", () => {
  assert.equal(choose(story(), "", 1)!.finished, true);
  assert.equal(choose(story(), "0", 0)!.finished, true);
  assert.equal(choose(story(), "0", 1)!.finished, false, "that one goes back to the desk");
});

test("a choice that cannot be made is refused", () => {
  const c = story();
  assert.equal(choose(c, "", 2), null, "there is no third choice");
  assert.equal(choose(c, "", -1), null);
  assert.equal(choose(c, "00", 0), null, "nothing can be chosen at an ending");
  assert.equal(choose(c, "05", 0), null, "a path that does not fit is not one to go on from");
  assert.equal(choose(c, "01".repeat(MAX_STEPS / 2), 0), null, "a story that has gone on this long stops");
});

test("several effects on one variable are added up, and a total of nothing is left out", () => {
  assert.deepEqual(totalEffects([{ variable: "a", add: 2 }, { variable: "b", add: 1 }, { variable: "a", add: -2 }, { variable: "c", add: 3 }]), [{ variable: "b", add: 1 }, { variable: "c", add: 3 }]);
  assert.deepEqual(totalEffects([{ variable: "a", add: 2 }], -1), [{ variable: "a", add: -2 }]);
  assert.deepEqual(totalEffects([{ variable: "a", add: 0.1 }, { variable: "a", add: 0.2 }]), [{ variable: "a", add: 0.3 }], "no 0.30000000000000004");
});

// ---- taking choices back

test("taking back the last choice puts the learner where they were and takes off what it added", () => {
  const c = story();
  assert.deepEqual(undo(c, "00", 1), { path: "0", effects: [{ variable: "var-trust", add: -1 }, { variable: "var-calm", add: -0.1 }], finished: false });
  assert.deepEqual(undo(c, "0", 1), { path: "", effects: [{ variable: "var-trust", add: -2 }], finished: false });
});

test("starting again takes back every choice, and what they added nets to nothing", () => {
  const c = story();
  const vars: Record<string, number> = {};
  const apply = (effects: { variable: string; add: number }[]) => {
    for (const e of effects) vars[e.variable] = Math.round(((vars[e.variable] ?? 0) + e.add) * 1e9) / 1e9;
  };
  let path = "";
  for (const index of [0, 0]) {
    const move = choose(c, path, index)!;
    apply(move.effects);
    path = move.path;
  }
  assert.deepEqual({ ...vars }, { "var-trust": 3, "var-calm": 0.1 });
  const again = undo(c, path, path.length)!;
  assert.equal(again.path, "");
  apply(again.effects);
  assert.deepEqual({ ...vars }, { "var-trust": 0, "var-calm": 0 });
});

test("there is nothing to take back at the start", () => {
  assert.equal(undo(story(), "", 1), null);
  assert.equal(undo(story(), "0", 0), null);
});

// ---- who is speaking

test("the narrator has no name, a person from the cast is named with their picture, and an unknown speaker is shown as the narrator", () => {
  assert.equal(speakerOf(line("l", "x", null), cast, null), null);
  assert.deepEqual(speakerOf(line("l", "x", "maya"), cast, null), { name: "Maya Reyes", picture: cast[0]!.picture });
  assert.deepEqual(speakerOf(line("l", "x", "dev"), cast, null), { name: "Dev Patel", picture: null });
  assert.equal(speakerOf(line("l", "x", "stranger"), cast, null), null);
});

test("'you' is the character the learner chose, or just 'You' before they have chosen", () => {
  assert.deepEqual(speakerOf(line("l", "x", "you"), cast, null), { name: "You", picture: null });
  assert.deepEqual(speakerOf(line("l", "x", "you"), cast, cast[1]!), { name: "Dev Patel", picture: null });
});

test("the character the learner chose is read from the scenario's variable", () => {
  const c = story({ you: "var-who" });
  const value = (v: string) => ({ "var-who": "dev" } as Record<string, string>)[v];
  assert.equal(youOf(c, cast, value)!.id, "dev");
  assert.equal(youOf(c, cast, () => ""), null, "nothing chosen yet");
  assert.equal(youOf(c, cast, () => "nobody"), null, "someone who is not in the cast");
  assert.equal(youOf(story({ you: null }), cast, value), null, "a scenario that does not use one");
});

// ---- what to say

test("the review lists where the learner was and what they chose, in order", () => {
  assert.deepEqual(pathReview(walk(story(), "00")!), [
    { situation: "At the desk", choice: "Greet them" },
    { situation: "The questions", choice: "Explain the wait" },
  ]);
  assert.deepEqual(pathReview(walk(story(), "")!), []);
});

test("a change in the meters is described, and no change is not", () => {
  const meters = [{ id: "m-1", label: "Trust", variable: "t", min: 0, max: 10 }, { id: "m-2", label: "Patience", variable: "p", min: 0, max: 10 }];
  assert.equal(describeMeterChanges(meters, [3, 5], [5, 5]), "Trust is now 5, up 2.");
  assert.equal(describeMeterChanges(meters, [3, 5], [2, 4]), "Trust is now 2, down 1. Patience is now 4, down 1.");
  assert.equal(describeMeterChanges(meters, [3, 5], [3, 5]), "");
  assert.deepEqual(meterValues(meters, (v) => ({ t: 4, p: "x" } as Record<string, number | string>)[v]), [4, 0], "a variable that is not a number counts as nothing");
});

// ---- the course remembers it

function packageWithScenario(content: ScenarioContent = story()): CoursePackage {
  const pkg = examplePackage();
  pkg.project.variables.push(
    { id: "var-trust", name: "trust", type: "number", initial: 0 },
    { id: "var-calm", name: "calm", type: "number", initial: 0 },
    { id: "var-done", name: "done", type: "boolean", initial: false },
    { id: "var-who", name: "who", type: "string", initial: "" },
  );
  pkg.project.characters = cast;
  const obj: OSObject = {
    id: "obj-9400", type: "scenario", name: "Patient visit",
    geometry: { x: 0, y: 0, width: 800, height: 500, rotation: 0, z: 90 },
    content: content as unknown as Record<string, unknown>,
    style: {}, accessibility: { altText: "A scenario about greeting a patient", role: "presentation", tabOrder: 9, decorative: false },
    states: {}, triggers: [], timing: { appear: "time", start: 0, visibleFor: null }, animation: { enter: { effect: "none", duration: 500 }, exit: { effect: "none", duration: 500 } },
    narration: null, provenance: null, simulation: null,
  };
  pkg.slides[0]!.baseLayer.objects.push(obj);
  return pkg;
}

test("a choice adds to the number variables and remembers where the learner is", () => {
  const { rt } = newRuntime(packageWithScenario());
  rt.goTo("slide-001");
  rt.scenarioMove("obj-9400", choose(story(), "", 0)!);
  assert.equal(rt.variables.get("var-trust"), 2);
  assert.equal(rt.scenarioPath("obj-9400"), "0");
  assert.equal(rt.variables.get("var-done"), false);
});

test("reaching an ending sets the scenario's finished variable", () => {
  const { rt } = newRuntime(packageWithScenario());
  rt.goTo("slide-001");
  rt.scenarioMove("obj-9400", choose(story(), "", 1)!);
  assert.equal(rt.variables.get("var-done"), true);
  assert.equal(rt.variables.get("var-trust"), -2);
});

test("taking a choice back takes off what it added, and a scenario back at its start is forgotten", () => {
  const { rt } = newRuntime(packageWithScenario());
  rt.goTo("slide-001");
  rt.scenarioMove("obj-9400", choose(story(), "", 0)!);
  rt.scenarioMove("obj-9400", choose(story(), "0", 0)!);
  assert.equal(rt.variables.get("var-trust"), 3);
  rt.scenarioMove("obj-9400", undo(story(), "00", 2)!);
  assert.equal(rt.variables.get("var-trust"), 0);
  assert.equal(rt.variables.get("var-calm"), 0);
  assert.equal(rt.scenarioPath("obj-9400"), "");
  assert.equal(rt.snapshot().scenario, undefined, "nothing to remember");
});

test("a move for something that is not a scenario on this slide changes nothing", () => {
  const { rt } = newRuntime(packageWithScenario());
  rt.goTo("slide-001");
  rt.scenarioMove("obj-0001", choose(story(), "", 0)!);
  assert.equal(rt.variables.get("var-trust"), 0);
  rt.goTo("slide-002");
  rt.scenarioMove("obj-9400", choose(story(), "", 0)!);
  assert.equal(rt.variables.get("var-trust"), 0, "its slide is not showing");
});

test("a rule can react to what a choice added, like any change to a variable", () => {
  const pkg = packageWithScenario();
  pkg.slides[0]!.baseLayer.objects[0]!.triggers.push({
    id: "trg-9", event: "variableChange", conditions: [{ variable: "var-trust", operator: "greaterThanOrEqual", value: 2 }], action: "setVariable", target: "var-who", value: "reached",
  });
  const { rt } = newRuntime(pkg);
  rt.goTo("slide-001");
  rt.scenarioMove("obj-9400", choose(story(), "", 0)!);
  assert.equal(rt.variables.get("var-who"), "reached");
});

test("a move tells the course something happened, so the LMS is written to even when nothing was added", () => {
  const { rt } = newRuntime(packageWithScenario());
  const seen: RuntimeEvent[] = [];
  rt.goTo("slide-001");
  rt.onEvent((e) => seen.push(e));
  rt.scenarioMove("obj-9400", choose(story(), "0", 1)!);
  assert.deepEqual(seen.filter((e) => e.type === "scenario"), [{ type: "scenario", objectId: "obj-9400", path: "01" }]);
});

test("where the learner is in a scenario comes back with the rest of their progress", () => {
  const first = newRuntime(packageWithScenario());
  first.rt.goTo("slide-001");
  first.rt.scenarioMove("obj-9400", choose(story(), "", 0)!);
  const snap = JSON.parse(JSON.stringify(first.rt.snapshot()));
  assert.deepEqual(snap.scenario, { "obj-9400": "0" });

  const second = newRuntime(packageWithScenario());
  assert.equal(second.rt.restore(snap), true);
  assert.equal(second.rt.scenarioPath("obj-9400"), "0");
  assert.equal(second.rt.variables.get("var-trust"), 2, "the meter comes back as it was");
});

test("progress saved before scenarios existed still opens, and a scenario that was removed is forgotten", () => {
  const { rt } = newRuntime(packageWithScenario());
  const old = { slide: "slide-001", vars: {}, quiz: {}, layers: [], visited: "" };
  assert.equal(rt.restore(old), true);
  assert.equal(rt.scenarioPath("obj-9400"), "");
  assert.equal(rt.restore({ ...old, scenario: { "obj-gone": "01", "obj-9400": "1" } }), true);
  assert.equal(rt.scenarioPath("obj-gone"), "");
  assert.equal(rt.scenarioPath("obj-9400"), "1");
});

test("the path survives the LMS's suspend data, and is dropped only with the variables when there is no room", () => {
  const snap = { slide: "slide-001", vars: { "var-trust": 2 }, quiz: {}, layers: [], visited: "11", scenario: { "obj-9400": "0" } };
  assert.deepEqual(decodeSuspend(encodeSuspend(snap))!.scenario, { "obj-9400": "0" });
  assert.equal(decodeSuspend(encodeSuspend({ slide: "slide-001", vars: {}, quiz: {}, layers: [], visited: "" }))!.scenario, undefined);
  const crowded = { ...snap, vars: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`var-${i}`, i + 1000])) };
  const kept = decodeSuspend(encodeSuspend(crowded))!;
  assert.equal(kept.slide, "slide-001");
  assert.equal(kept.vars["var-1"], undefined, "the variables did not fit");
  assert.equal(kept.scenario, undefined, "so the path is not kept without them");
});

test("a learner who leaves a scenario half way and comes back finds it as they left it", () => {
  const lms = new FakeLms();
  const first = newRuntime(packageWithScenario());
  const tracker = new Tracker(lms, first.rt);
  tracker.begin();
  first.rt.goTo("slide-001");
  first.rt.scenarioMove("obj-9400", choose(story(), "", 0)!);
  tracker.end();

  lms.relaunch();
  const second = newRuntime(packageWithScenario());
  const snap = new Tracker(lms, second.rt).begin();
  assert.ok(snap, "the LMS offers to resume");
  assert.equal(second.rt.restore(snap), true);
  assert.equal(second.rt.scenarioPath("obj-9400"), "0");
  assert.equal(second.rt.variables.get("var-trust"), 2);
});

// ---- choosing a character

test("a choice of character saves the person's id in a text variable", () => {
  assert.ok((INPUT_KINDS as readonly string[]).includes("character"));
  assert.equal(INPUT_VARIABLE_TYPE.character, "string");
});

test("the character a learner chose can be read back by a scenario", () => {
  const { rt } = newRuntime(packageWithScenario(story({ you: "var-who" })));
  rt.goTo("slide-001");
  rt.setVariable("var-who", "dev");
  const c = rt.findScenario("obj-9400")!.content as unknown as ScenarioContent;
  assert.equal(youOf(c, cast, (v) => rt.variables.get(v))!.name, "Dev Patel");
});
