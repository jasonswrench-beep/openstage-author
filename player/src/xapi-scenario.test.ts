// Tests for the xAPI statements a scenario sends: one for every choice the learner makes (which situation they were in, what they chose from, what
// they chose, what it added to the course's numbers, where they are now, whether it was an ending), and one for taking choices back. They run against
// the strict stand-in LRS (fake-lrs.ts), and against the stand-in cmi5 LMS (fake-cmi5.ts) to see that the same statements are allowed there.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { attachCmi5, readCmi5Launch } from "./cmi5.ts";
import { FakeCmi5Lms } from "./fake-cmi5.ts";
import { FakeLrs } from "./fake-lrs.ts";
import { choose, undo } from "./scenario.ts";
import { examplePackage, newRuntime } from "./test-helpers.ts";
import type { CoursePackage, OSObject, ScenarioContent, ScenarioLine } from "./types.ts";
import { courseActivityId, SCENARIO_EXTENSION, XapiTracker, type XapiLaunch } from "./xapi.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));
const realWarn = console.warn;
beforeEach(() => { console.warn = () => undefined; });
afterEach(() => { console.warn = realWarn; });

const line = (id: string, text: string): ScenarioLine => ({ id, speaker: null, text, narration: null });

const story = (): ScenarioContent => ({
  start: "n-start",
  you: null,
  nodes: [
    {
      id: "n-start", title: "At the desk", prompt: "What do you do?", lines: [line("l-1", "A patient arrives.")],
      choices: [
        { id: "c-1", label: "Greet them", next: "n-mid", effects: [{ variable: "var-trust", add: 2 }], response: [] },
        { id: "c-2", label: "Ignore them", next: "n-end", effects: [{ variable: "var-trust", add: -2 }], response: [] },
      ],
    },
    {
      id: "n-mid", title: "The questions", prompt: "", lines: [line("l-2", "She asks about the wait.")],
      choices: [
        { id: "c-3", label: "Explain the wait", next: "n-end", effects: [{ variable: "var-trust", add: 1 }], response: [] },
        { id: "c-4", label: "Go back to the desk", next: "n-start", effects: [], response: [] },
      ],
    },
    { id: "n-end", title: "The end", prompt: "", lines: [line("l-3", "The shift is over.")], choices: [] },
  ],
  meters: [],
  allowRetry: true,
  finishedVariable: "",
  reflection: "",
});

function packageWithScenario(): CoursePackage {
  const pkg = examplePackage();
  pkg.project.variables.push({ id: "var-trust", name: "trust", type: "number", initial: 0 });
  const obj: OSObject = {
    id: "obj-9400", type: "scenario", name: "Patient visit",
    geometry: { x: 0, y: 0, width: 800, height: 500, rotation: 0, z: 90 },
    content: story() as unknown as Record<string, unknown>,
    style: {}, accessibility: { altText: "A scenario about greeting a patient", role: "presentation", tabOrder: 9, decorative: false },
    states: {}, triggers: [], timing: { appear: "time", start: 0, visibleFor: null }, animation: { enter: { effect: "none", duration: 500 }, exit: { effect: "none", duration: 500 } },
    narration: null, provenance: null, simulation: null,
  };
  pkg.slides[0]!.baseLayer.objects.push(obj);
  return pkg;
}

const ACTOR = { objectType: "Agent", name: "Test Learner", mbox: "mailto:learner@example.test" };
const REGISTRATION = "0b8c1e2a-5d3f-4a6b-9c7d-1e2f3a4b5c6d";
const launchFor = (lrs: FakeLrs): XapiLaunch => ({ endpoint: lrs.endpoint, auth: lrs.auth, actor: ACTOR, registration: REGISTRATION, activityId: courseActivityId(examplePackage().project.meta) });

async function start(lrs: FakeLrs) {
  const { rt } = newRuntime(packageWithScenario());
  const tracker = new XapiTracker(launchFor(lrs), rt, { fetch: lrs.fetch, wait: async () => undefined });
  const resume = await tracker.begin();
  if (!(resume && rt.restore(resume))) rt.goTo("slide-001");
  await tick();
  return { rt, tracker };
}

const move = (rt: ReturnType<typeof newRuntime>["rt"], path: string, index: number) => rt.scenarioMove("obj-9400", choose(story(), path, index)!);
const answered = (lrs: FakeLrs) => lrs.statements.filter((s) => (s["verb"] as { id: string }).id.endsWith("/answered") && String((s["object"] as { id: string }).id).includes("/scenario/"));
type Stmt = Record<string, any>;

test("a choice is an answer to the situation the learner was in, with the choice they made and what it added", async () => {
  const lrs = new FakeLrs();
  const { rt, tracker } = await start(lrs);
  move(rt, "", 0);
  await tick();
  await tracker.settled();
  const [s] = answered(lrs) as Stmt[];
  assert.ok(s, "a statement for the choice");
  assert.equal(s.object.id, `${launchFor(lrs).activityId}/scenario/obj-9400/situation/n-start`);
  assert.equal(s.object.definition.type, "http://adlnet.gov/expapi/activities/cmi.interaction");
  assert.equal(s.object.definition.interactionType, "choice");
  assert.deepEqual(s.object.definition.choices, [{ id: "0", description: { "en-US": "Greet them" } }, { id: "1", description: { "en-US": "Ignore them" } }]);
  assert.equal(s.object.definition.correctResponsesPattern, undefined, "a scenario has no right answer");
  assert.equal(s.result.response, "0");
  assert.equal(s.result.success, undefined, "a choice is not marked");
  assert.deepEqual(s.result.extensions[SCENARIO_EXTENSION], { scenario: "Patient visit", situation: "At the desk", choice: "Greet them", effects: [{ variable: "var-trust", add: 2 }], path: "0", ending: false });
  assert.equal(s.context.contextActivities.parent[0].id, launchFor(lrs).activityId, "it is part of the course");
});

test("every choice on the way to an ending is a statement, and the last one says it was an ending", async () => {
  const lrs = new FakeLrs();
  const { rt, tracker } = await start(lrs);
  move(rt, "", 0);
  move(rt, "0", 0);
  await tick();
  await tracker.settled();
  const list = answered(lrs) as Stmt[];
  assert.deepEqual(list.map((s) => s.result.extensions[SCENARIO_EXTENSION].choice), ["Greet them", "Explain the wait"]);
  assert.deepEqual(list.map((s) => s.result.extensions[SCENARIO_EXTENSION].ending), [false, true]);
  assert.equal(list[1]!.object.id.split("/").pop(), "n-mid", "the second answer is to the second situation");
  assert.equal(list[1]!.result.extensions[SCENARIO_EXTENSION].path, "00");
});

test("taking choices back is told as such, so the record of choices is not left wrong", async () => {
  const lrs = new FakeLrs();
  const { rt, tracker } = await start(lrs);
  move(rt, "", 0);
  move(rt, "0", 1);
  rt.scenarioMove("obj-9400", undo(story(), "01", 2)!);
  await tick();
  await tracker.settled();
  const back = lrs.statements.filter((s) => (s["verb"] as { id: string }).id.endsWith("/interacted")) as Stmt[];
  assert.equal(back.length, 1);
  assert.deepEqual(back[0]!.result.extensions[SCENARIO_EXTENSION], { tookBack: 2, path: "" });
  assert.equal(back[0]!.object.id, `${launchFor(lrs).activityId}/scenario/obj-9400`);
  assert.equal(answered(lrs).length, 2, "the choices stay told; the take-back follows them");
});

test("a learner who comes back is told from where they were, not from the start", async () => {
  const lrs = new FakeLrs();
  const first = await start(lrs);
  move(first.rt, "", 0);
  await tick();
  first.tracker.end();
  await first.tracker.settled();
  const before = answered(lrs).length;
  const second = await start(lrs);
  assert.equal(second.rt.scenarioPath("obj-9400"), "0", "the place was kept");
  move(second.rt, "0", 0);
  await tick();
  await second.tracker.settled();
  const list = answered(lrs) as Stmt[];
  assert.equal(list.length, before + 1);
  assert.equal(list.at(-1)!.result.extensions[SCENARIO_EXTENSION].choice, "Explain the wait");
});

test("the same statements are allowed under cmi5: they sit between initialized and terminated and carry no cmi5 category", async () => {
  const lms = new FakeCmi5Lms();
  const { rt } = newRuntime(packageWithScenario());
  const win = { addEventListener: () => undefined, location: { assign: () => undefined } } as unknown as Window;
  const attached = await attachCmi5(win, rt, readCmi5Launch(lms.address)!, { fetch: lms.fetch, wait: async () => undefined });
  rt.goTo("slide-001");
  await tick();
  move(rt, "", 0);
  move(rt, "0", 0);
  await tick();
  attached!.tracker.end();
  await tick();
  await attached!.tracker.settled();
  assert.deepEqual(lms.problems(), []);
  assert.equal(lms.statements.filter((s) => String((s["object"] as { id: string }).id).includes("/scenario/")).length, 2);
});

test("a course the LMS launched only to browse tells nothing of the choices", async () => {
  const lms = new FakeCmi5Lms({ launchMode: "Browse" });
  const { rt } = newRuntime(packageWithScenario());
  const win = { addEventListener: () => undefined, location: { assign: () => undefined } } as unknown as Window;
  const attached = await attachCmi5(win, rt, readCmi5Launch(lms.address)!, { fetch: lms.fetch, wait: async () => undefined });
  rt.goTo("slide-001");
  move(rt, "", 0);
  await tick();
  attached!.tracker.end();
  await attached!.tracker.settled();
  assert.deepEqual(lms.lrs.verbs(), ["initialized", "terminated"]);
});
