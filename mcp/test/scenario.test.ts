import assert from "node:assert/strict";
import { test } from "node:test";
import { buildScenario, type ScenarioSpec, type World } from "../src/scenario.ts";
import { ToolError } from "../src/protocol.ts";
import type { Character, Variable } from "../../player/src/types.ts";

const score: Variable = { id: "var-1", name: "Score", type: "number", initial: 0 };
const trust: Variable = { id: "var-2", name: "Trust", type: "number", initial: 50 };
const done: Variable = { id: "var-3", name: "Done", type: "boolean", initial: false };
const note: Variable = { id: "var-4", name: "Note", type: "string", initial: "" };
const ann: Character = { id: "person-1", name: "Ann", role: "", voice: "af_heart", picture: null };
const world = (over: Partial<World> = {}): World => ({ cast: [ann], variables: [score, trust, done, note], ...over });

const spec = (over: Partial<ScenarioSpec> = {}): ScenarioSpec => ({
  spoken: true,
  situations: [
    { title: "At the desk", prompt: "What do you do?", lines: [{ text: "A colleague hands you a late report.", speaker: "Ann" }], choices: [{ label: "Read it now", goesTo: 2, effects: [{ variable: "Score", add: 5 }], response: [{ text: "Thanks!", speaker: "ann" }] }, { label: "Say you are busy", goesTo: "The slow ending" }] },
    { title: "The good ending", lines: [{ text: "It went well." }] },
    { title: "The slow ending", lines: [{ text: "It went slowly." }] },
  ],
  ...over,
});

const refused = (s: ScenarioSpec, pattern: RegExp, w: World = world()) => assert.throws(() => buildScenario(s, w), (e: unknown) => e instanceof ToolError && pattern.test(e.message), String(pattern));

test("a scenario is built from a description, with its parts pointing at one another by number or by title", () => {
  const c = buildScenario(spec({ meters: [{ label: "Trust", variable: "Trust", min: 0, max: 10 }], reflection: " What would you do differently? ", finishedVariable: "Done" }), world());
  assert.equal(c.start, "situation-1");
  assert.deepEqual(c.nodes.map((n) => [n.id, n.title, n.choices.length]), [["situation-1", "At the desk", 2], ["situation-2", "The good ending", 0], ["situation-3", "The slow ending", 0]]);
  assert.deepEqual(c.nodes[0]!.choices.map((x) => [x.id, x.label, x.next]), [["choice-1", "Read it now", "situation-2"], ["choice-2", "Say you are busy", "situation-3"]]);
  assert.deepEqual(c.nodes[0]!.choices[0]!.effects, [{ variable: "var-1", add: 5 }], "a variable is named by its name and stored by its id");
  assert.deepEqual(c.meters, [{ id: "meter-1", label: "Trust", variable: "var-2", min: 0, max: 10 }]);
  assert.equal(c.finishedVariable, "var-3");
  assert.equal(c.reflection, "What would you do differently?");
  assert.equal(c.allowRetry, true);
  assert.equal(c.you, null);
});

test("every line has its own id, speaks in its person's voice when spoken, and has no narration when not", () => {
  const spoken = buildScenario(spec(), world());
  const lines = [...spoken.nodes.flatMap((n) => [...n.lines, ...n.choices.flatMap((x) => x.response)])];
  assert.deepEqual(lines.map((l) => l.id), ["line-1", "line-2", "line-3", "line-4"].length === lines.length ? lines.map((l) => l.id) : []);
  assert.equal(new Set(lines.map((l) => l.id)).size, lines.length);
  const first = spoken.nodes[0]!.lines[0]!;
  assert.deepEqual([first.speaker, (first.narration as { voice: string }).voice, (first.narration as { script: string }).script], ["person-1", "af_heart", "A colleague hands you a late report."]);
  assert.equal(spoken.nodes[0]!.choices[0]!.response[0]!.speaker, "person-1", "a speaker is found by name whatever the case");
  assert.equal(spoken.nodes[1]!.lines[0]!.speaker, null);
  const silent = buildScenario(spec({ spoken: false }), world());
  assert.ok(silent.nodes.flatMap((n) => n.lines).every((l) => l.narration === null));
});

test("a scenario can start in another situation, and meters and the ending variable are optional", () => {
  const c = buildScenario(spec({ start: "Begin", situations: [{ title: "Back", choices: [{ label: "Again", goesTo: "Begin" }] }, { title: "Begin", choices: [{ label: "On", goesTo: 1 }] }] }), world());
  assert.equal(c.start, "situation-2");
  assert.deepEqual([c.meters, c.finishedVariable, c.reflection], [[], null, ""]);
});

test("a scenario that cannot work is refused with the reason", () => {
  refused(spec({ situations: [] }), /needs at least one situation/);
  refused(spec({ situations: Array.from({ length: 41 }, (_, i) => ({ title: `S${i}` })) }), /at most 40 situations/);
  refused(spec({ situations: [{ title: " " }] }), /Situation 1 needs a title/);
  refused(spec({ situations: [{ title: "A", choices: [{ label: "Go", goesTo: 5 }] }] }), /Situation 1, choice 1: there is no situation 5\. They are numbered 1 to 1/);
  refused(spec({ situations: [{ title: "A", choices: [{ label: "Go", goesTo: "Nowhere" }] }] }), /there is no situation called "Nowhere"\. The titles are: A/);
  refused(spec({ situations: [{ title: "A", choices: [{ label: "Go", goesTo: "B" }] }, { title: "B" }, { title: "b" }] }), /more than one situation is called "B"\. Use its number/);
  refused(spec({ situations: [{ title: "A", choices: [{ label: " ", goesTo: 1 }] }] }), /choice 1 has no words/);
  refused(spec({ situations: [{ title: "A", lines: [{ text: "  " }] }] }), /line 1: a line has no words/);
  refused(spec({ situations: [{ title: "A", lines: Array.from({ length: 13 }, () => ({ text: "x" })) }] }), /at most 12 lines/);
  refused(spec({ situations: [{ title: "A", choices: Array.from({ length: 7 }, () => ({ label: "x", goesTo: 1 })) }] }), /at most 6 choices/);
  refused(spec({ situations: [{ title: "A", choices: [{ label: "x", goesTo: 1, response: Array.from({ length: 7 }, () => ({ text: "x" })) }] }] }), /at most 6 lines/);
});

test("a person who is not in the cast, or a variable that is not a number, is named in the refusal", () => {
  refused(spec({ situations: [{ title: "A", lines: [{ text: "Hi", speaker: "Bob" }] }] }), /"Bob" is not in the cast\. The cast is: Ann/);
  refused(spec({ situations: [{ title: "A", lines: [{ text: "Hi", speaker: "Bob" }] }] }), /The course has no cast yet; add_character/, world({ cast: [] }));
  refused(spec({ situations: [{ title: "A", choices: [{ label: "x", goesTo: 1, effects: [{ variable: "Done", add: 1 }] }] }] }), /"Done" is a boolean variable, and this needs a number variable/);
  refused(spec({ situations: [{ title: "A", choices: [{ label: "x", goesTo: 1, effects: [{ variable: "Missing", add: 1 }] }] }] }), /no variable "Missing"\. The variables are: Score, Trust, Done, Note/);
  refused(spec({ situations: [{ title: "A", choices: [{ label: "x", goesTo: 1, effects: [{ variable: "Score", add: 5000 }] }] }] }), /from -1000 to 1000/);
  refused(spec({ situations: [{ title: "A", choices: [{ label: "x", goesTo: 1, effects: Array.from({ length: 7 }, () => ({ variable: "Score", add: 1 })) }] }] }), /can change at most 6 things/);
  refused(spec({ situations: [{ title: "A" }], meters: [{ label: "Bad", variable: "Done" }] }), /Meter 1: "Done" is a boolean variable/);
  refused(spec({ situations: [{ title: "A" }], meters: [{ label: "Bad", variable: "Score", min: 5, max: 5 }] }), /smallest value must be less than the largest/);
  refused(spec({ situations: [{ title: "A" }], finishedVariable: "Score" }), /must be a true or false variable/);
  refused(spec({ situations: [{ title: "A" }], finishedVariable: "Nothing" }), /no variable "Nothing" to set when the learner reaches an ending/);
});

test("a situation that no choice leads to is refused, because the learner could never see it", () => {
  refused(spec({ situations: [{ title: "A", choices: [{ label: "x", goesTo: 2 }] }, { title: "B" }, { title: "Lost" }] }), /"Lost" can never be reached/);
  refused(spec({ start: 2 }), /"At the desk", "The slow ending" can never be reached: no choice leads there\. Point a choice at them/);
});
