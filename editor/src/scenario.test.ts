// The cast and scenarios in the editor: the pure arithmetic (characters.ts, scenarioedit.ts), the Model's undoable edits, narration of lines,
// the choice of character, and the real validator on what the editor writes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Character, InputContent, ScenarioContent, Slide } from "../../player/src/types.ts";
import { castUse, draftNotes, draftProblems, newPerson, personId, voiceChanges, CAST_LIMIT } from "./characters.ts";
import { ADD_MENU, INPUTS } from "./factory.ts";
import { Model } from "./model.ts";
import type { Narration } from "./narration.ts";
import * as S from "./scenarioedit.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-13" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const maya: Character = { id: "maya", name: "Maya Reyes", role: "Team lead", voice: "af_heart", picture: null };
const dev: Character = { id: "dev", name: "Dev Patel", role: "Analyst", voice: "am_adam", picture: null };

function withCast(...people: Character[]): Model {
  const m = fresh();
  assert.ok(typeof m.setCharacters(people) === "string");
  return m;
}

const scenarioOf = (m: Model): ScenarioContent => m.object!.content as unknown as ScenarioContent;

// ---- the cast: arithmetic

test("a person's id comes from their name, is never 'you', and is never taken twice", () => {
  assert.equal(personId("Maya Reyes", []), "maya-reyes");
  assert.equal(personId("Maya Reyes", ["maya-reyes"]), "maya-reyes-2");
  assert.equal(personId("You", []), "you-2", "'you' means the learner");
  assert.equal(personId("???", []), "person");
  assert.equal(personId("42 Skidoo", []), "skidoo", "an id starts with a letter");
});

test("a new person has a name to change and a voice no one else has", () => {
  const first = newPerson([]);
  assert.equal(first.name, "Person 1");
  assert.equal(first.picture, null);
  const second = newPerson([first]);
  assert.equal(second.name, "Person 2");
  assert.notEqual(second.voice, first.voice);
  assert.notEqual(second.id, first.id);
});

test("a cast cannot be saved with a person who has no name, or a picture that is not described", () => {
  assert.deepEqual(draftProblems([maya, dev], [], new Map()), []);
  assert.ok(draftProblems([{ ...maya, name: "  " }], [], new Map())[0]!.includes("needs a name"));
  const pic = { src: "assets/images/maya.png", alt: "", decorative: false };
  assert.ok(draftProblems([{ ...maya, picture: pic }], [], new Map())[0]!.includes("alt text"));
  assert.deepEqual(draftProblems([{ ...maya, picture: { ...pic, decorative: true } }], [], new Map()), []);
  assert.ok(draftProblems([{ ...maya, picture: { ...pic, alt: "Maya", decorative: true } }], [], new Map())[0]!.includes("no alt text"));
  assert.ok(draftProblems([{ ...maya, voice: "zz_nobody" }], [], new Map())[0]!.includes("voice"));
  const crowd = Array.from({ length: CAST_LIMIT + 1 }, (_, i) => ({ ...maya, id: `p${i}`, name: `P${i}` }));
  assert.ok(draftProblems(crowd, [], new Map())[0]!.includes(String(CAST_LIMIT)));
});

test("someone still in use cannot be taken out of the cast", () => {
  const uses = new Map([["maya", ['5 lines in the scenario "Visit"']]]);
  const problems = draftProblems([dev], [maya, dev], uses);
  assert.equal(problems.length, 1);
  assert.ok(problems[0]!.includes("Maya Reyes") && problems[0]!.includes("5 lines"));
  assert.deepEqual(draftProblems([maya, dev], [maya, dev], uses), []);
});

test("two people with one name is a note, not a stop", () => {
  assert.deepEqual(draftProblems([maya, { ...dev, name: "maya  reyes" }], [], new Map()), []);
  assert.equal(draftNotes([maya, { ...dev, name: "maya  reyes" }]).length, 1);
  assert.deepEqual(draftNotes([maya, dev]), []);
});

test("the people whose voice changed are found", () => {
  assert.deepEqual([...voiceChanges([maya, dev], [{ ...maya, voice: "af_bella" }, dev])], [["maya", "af_bella"]]);
  assert.equal(voiceChanges([maya], [{ ...maya, id: "someone-else", voice: "af_bella" }]).size, 0, "a new person did not change");
});

// ---- the cast in the model

test("a project starts with no cast, and setting one is one undo step", () => {
  const m = fresh();
  assert.deepEqual(m.characters, []);
  assert.ok(m.setCharacters([maya, dev])!.includes("2 people"));
  assert.equal(m.characters.length, 2);
  assert.equal(m.canUndo, true);
  m.undo();
  assert.deepEqual(m.characters, []);
  assert.equal("characters" in m.project, false, "an empty cast leaves no trace in project.json");
  m.redo();
  assert.equal(m.characters.length, 2);
});

test("setting the cast to what it already is does nothing", () => {
  const m = withCast(maya, dev);
  m.undo();
  m.redo();
  assert.equal(m.setCharacters([maya, dev]), null);
});

test("a cast with a problem is refused and changes nothing", () => {
  const m = fresh();
  assert.ok(m.setCharacters([{ ...maya, name: "" }])!.includes("needs a name"));
  assert.deepEqual(m.characters, []);
  assert.equal(m.canUndo, false);
});

test("a person used by a scenario cannot be removed, until the lines are changed", () => {
  const m = withCast(maya, dev);
  m.addScenario();
  const id = m.object!.id;
  const c = scenarioOf(m);
  assert.equal(m.setScenarioLineSpeaker(id, c.nodes[0]!.lines[0]!.id, "maya")!.includes("Maya Reyes"), true);
  const refusal = m.setCharacters([dev])!;
  assert.ok(refusal.includes("Maya Reyes") && refusal.includes("1 line"), refusal);
  assert.equal(m.characters.length, 2);
  m.setScenarioLineSpeaker(id, c.nodes[0]!.lines[0]!.id, null);
  assert.ok(m.setCharacters([dev])!.includes("1 person"));
});

test("a person whose voice changes takes their spoken lines with them", () => {
  const m = withCast(maya, dev);
  m.addScenario();
  const id = m.object!.id;
  const line = scenarioOf(m).nodes[0]!.lines[0]!;
  m.setScenarioLineText(id, line.id, "Hello there.");
  m.setScenarioLineSpeaker(id, line.id, "maya");
  m.setScenarioLineSpoken(id, line.id, true);
  assert.equal((scenarioOf(m).nodes[0]!.lines[0]!.narration as Narration).voice, "af_heart");
  const message = m.setCharacters([{ ...maya, voice: "af_bella" }, dev])!;
  assert.ok(message.includes("1 spoken line was changed"), message);
  assert.equal((scenarioOf(m).nodes[0]!.lines[0]!.narration as Narration).voice, "af_bella");
  m.undo();
  assert.equal((scenarioOf(m).nodes[0]!.lines[0]!.narration as Narration).voice, "af_heart", "one undo puts the voice back too");
});

test("what a cast is used for can be listed", () => {
  const m = withCast(maya, dev);
  m.addScenario();
  const id = m.object!.id;
  const c = scenarioOf(m);
  m.setScenarioLineSpeaker(id, c.nodes[0]!.lines[0]!.id, "maya");
  m.setScenarioLineSpeaker(id, c.nodes[1]!.lines[0]!.id, "maya");
  const slides = m.slides as Slide[];
  assert.deepEqual(castUse(slides).get("maya"), ['2 lines in the scenario "Scenario"']);
  assert.equal(castUse(slides).get("dev"), undefined);
});

// ---- adding a scenario

test("a scenario starts as a small story, with a name for a screen reader, a tab stop and the Add menu unchanged", () => {
  assert.ok(ADD_MENU.length <= 9);
  const m = fresh();
  const o = m.addScenario()!;
  assert.equal(o.type, "scenario");
  assert.ok(o.accessibility.altText.trim() !== "");
  assert.ok((o.accessibility.tabOrder ?? 0) >= 1);
  assert.equal(m.object!.id, o.id);
  const c = scenarioOf(m);
  assert.equal(c.nodes.length, 3);
  assert.equal(c.start, c.nodes[0]!.id);
  assert.equal(c.nodes[0]!.choices.length, 2);
  assert.deepEqual(c.nodes.slice(1).map((n) => n.choices.length), [0, 0], "two endings");
  assert.equal(c.you, null);
  assert.equal(c.finishedVariable, null);
  assert.equal(m.canUndo, true);
  m.undo();
  assert.equal(m.object, null);
});

// ---- editing: the pure edits

test("every id in a scenario is different, however many things are added", () => {
  const c = S.newScenarioContent();
  S.addSituation(c);
  S.addSituation(c);
  S.addChoice(c, c.nodes[1]!.id);
  S.addLine(c, { nodeId: c.nodes[0]!.id });
  S.addLine(c, { choiceId: c.nodes[0]!.choices[0]!.id });
  S.addMeter(c, "var-1", "Trust");
  S.addMeter(c, "var-1", "Calm");
  const ids = [
    ...c.nodes.flatMap((n) => [n.id, ...n.lines.map((l) => l.id), ...n.choices.flatMap((ch) => [ch.id, ...ch.response.map((l) => l.id)])]),
    ...c.meters.map((m) => m.id),
  ];
  assert.equal(new Set(ids).size, ids.length);
});

test("situations: added, moved, titled, and deleted only when nothing leads to them", () => {
  const c = S.newScenarioContent();
  const added = S.addSituation(c);
  assert.equal(c.nodes.length, 4);
  assert.equal(c.nodes[3]!.lines.length, 1, "a situation needs at least one line");
  assert.equal(c.nodes[3]!.id, added.id);
  assert.equal(S.deleteSituation(c, "situation-2").changed, false, "a choice leads to it");
  assert.ok(S.deleteSituation(c, "situation-2").message.includes("The situation"));
  assert.equal(S.deleteSituation(c, added.id!).changed, true);
  assert.equal(S.moveSituation(c, "situation-3", -1).changed, true);
  assert.deepEqual(c.nodes.map((n) => n.id), ["situation-1", "situation-3", "situation-2"]);
  assert.equal(S.moveSituation(c, "situation-1", -1).changed, false, "already first");
  assert.equal(S.setTitle(c, "situation-1", "  A new title ").changed, true);
  assert.equal(c.nodes[0]!.title, "A new title");
  assert.equal(S.setTitle(c, "situation-1", " ").changed, false, "a situation needs a title");
  assert.equal(S.setPrompt(c, "situation-1", "").changed, true);
  assert.equal(c.nodes[0]!.prompt, "", "the question may be empty");
});

test("deleting the start moves the start, and the last situation cannot be deleted", () => {
  const c = S.newScenarioContent();
  c.nodes[0]!.choices = [];
  assert.equal(S.deleteSituation(c, "situation-1").changed, true);
  assert.equal(c.start, "situation-2");
  S.deleteSituation(c, "situation-2");
  assert.equal(c.nodes.length, 1);
  assert.equal(S.deleteSituation(c, "situation-3").changed, false);
});

test("a situation can be deleted when only its own choices lead to it", () => {
  const c = S.newScenarioContent();
  c.nodes[0]!.choices = c.nodes[0]!.choices.filter((ch) => ch.next !== "situation-2");
  c.nodes[1]!.choices = [{ id: "loop", label: "Again", next: "situation-2", effects: [], response: [] }];
  assert.equal(S.deleteSituation(c, "situation-2").changed, true);
});

test("lines: added to a situation or a response, limited, never taking a situation's last one", () => {
  const c = S.newScenarioContent();
  const node = c.nodes[0]!;
  for (let i = node.lines.length; i < S.LIMITS.lines; i++) assert.equal(S.addLine(c, { nodeId: node.id }).changed, true);
  assert.equal(S.addLine(c, { nodeId: node.id }).changed, false);
  assert.ok(S.addLine(c, { nodeId: node.id }).message.includes(String(S.LIMITS.lines)));
  assert.equal(S.addLine(c, { choiceId: "choice-1" }).changed, true);
  assert.equal(node.choices[0]!.response.length, 1);
  assert.equal(node.choices[0]!.response[0]!.text, "", "a new line has no words for the validator to ask for");
  assert.equal(S.deleteLine(c, c.nodes[1]!.lines[0]!.id).changed, false, "a situation's only line stays");
  assert.equal(S.deleteLine(c, node.choices[0]!.response[0]!.id).changed, true, "a response may have none");
  assert.equal(S.moveLine(c, node.lines[1]!.id, -1).changed, true);
  assert.equal(S.moveLine(c, node.lines[0]!.id, -1).changed, false);
});

test("a line's speaker must be the narrator, 'you' or someone in the cast", () => {
  const c = S.newScenarioContent();
  const id = c.nodes[0]!.lines[0]!.id;
  assert.equal(S.setLineSpeaker(c, id, "maya", [maya, dev]).changed, true);
  assert.equal(c.nodes[0]!.lines[0]!.speaker, "maya");
  assert.equal(S.setLineSpeaker(c, id, "you", [maya, dev]).changed, true);
  assert.equal(S.setLineSpeaker(c, id, "stranger", [maya, dev]).changed, false);
  assert.equal(S.setLineSpeaker(c, id, null, [maya, dev]).changed, true);
  assert.equal(c.nodes[0]!.lines[0]!.speaker, null);
});

test("a spoken line is read in its speaker's voice, and changing the speaker changes the voice", () => {
  const cast = [maya, dev];
  const c = S.newScenarioContent();
  const line = c.nodes[0]!.lines[0]!;
  assert.equal(S.setLineSpoken(c, line.id, true, cast).changed, true);
  assert.equal((line.narration as Narration).script, line.text);
  S.setLineSpeaker(c, line.id, "dev", cast);
  assert.equal((line.narration as Narration).voice, "am_adam");
  assert.equal((line.narration as Narration).lang, "en-US");
  const message = S.setLineSpeaker(c, line.id, "maya", cast).message;
  assert.equal((line.narration as Narration).voice, "af_heart");
  assert.ok(message.includes("make the audio again"));
  assert.equal(S.setLineSpoken(c, line.id, false, cast).changed, true);
  assert.equal(line.narration, null);
});

test("a line with no words cannot be made spoken", () => {
  const c = S.newScenarioContent();
  const r = S.addLine(c, { nodeId: "situation-2" });
  const result = S.setLineSpoken(c, r.id!, true, []);
  assert.equal(result.changed, false);
  assert.ok(result.message.includes("Write the line first"));
});

test("a narrator line is spoken in the voice of the narration nearest to hand", () => {
  const like: Narration = { script: "x", voice: "bf_emma", speed: 0.9, lang: "en-GB", pronunciations: [], audioCache: null };
  const c = S.newScenarioContent();
  S.setLineSpoken(c, c.nodes[0]!.lines[0]!.id, true, [], like);
  const n = c.nodes[0]!.lines[0]!.narration as Narration;
  assert.deepEqual([n.voice, n.speed], ["bf_emma", 0.9]);
});

test("the spoken words follow the text while they are the same, and are left alone once they are not", () => {
  const c = S.newScenarioContent();
  const line = c.nodes[0]!.lines[0]!;
  S.setLineText(c, line.id, "First version.");
  S.setLineSpoken(c, line.id, true, []);
  const r = S.setLineText(c, line.id, "Second version.");
  assert.equal((line.narration as Narration).script, "Second version.");
  assert.ok(r.message.includes("make the audio again"));
  (line.narration as Narration).script = "Said a different way.";
  S.setLineText(c, line.id, "Third version.");
  assert.equal((line.narration as Narration).script, "Said a different way.", "the author's own words stay");
  assert.equal(line.text, "Third version.");
});

test("clearing a spoken line's words keeps what it says, since it cannot say nothing", () => {
  const c = S.newScenarioContent();
  const line = c.nodes[0]!.lines[0]!;
  S.setLineSpoken(c, line.id, true, []);
  const spoken = (line.narration as Narration).script;
  S.setLineText(c, line.id, "");
  assert.equal((line.narration as Narration).script, spoken);
});

test("choices: added, limited, moved, worded and pointed", () => {
  const c = S.newScenarioContent();
  const node = c.nodes[0]!;
  const added = S.addChoice(c, node.id);
  assert.equal(node.choices.length, 3);
  assert.equal(node.choices[2]!.next, "situation-2", "a new choice leads somewhere that exists");
  for (let i = node.choices.length; i < S.LIMITS.choices; i++) S.addChoice(c, node.id);
  assert.equal(S.addChoice(c, node.id).changed, false);
  assert.equal(S.setChoiceLabel(c, added.id!, "  Something else ").changed, true);
  assert.equal(S.setChoiceLabel(c, added.id!, "").changed, false);
  assert.equal(S.setChoiceNext(c, added.id!, "situation-3").changed, true);
  assert.equal(S.setChoiceNext(c, added.id!, "nowhere").changed, false);
  assert.equal(S.moveChoice(c, added.id!, -1).changed, true);
  assert.equal(S.moveChoice(c, node.choices[0]!.id, -1).changed, false);
});

test("a situation whose last choice is deleted becomes an ending, and the message says so", () => {
  const c = S.newScenarioContent();
  c.nodes[0]!.choices = c.nodes[0]!.choices.slice(0, 1);
  const r = S.deleteChoice(c, "choice-1");
  assert.ok(r.message.includes("an ending"));
});

test("a choice's effects add a non-zero number, up to a limit, to a variable", () => {
  const c = S.newScenarioContent();
  assert.equal(S.addEffect(c, "choice-1", "var-1").changed, true);
  assert.deepEqual(c.nodes[0]!.choices[0]!.effects, [{ variable: "var-1", add: 1 }]);
  assert.equal(S.setEffect(c, "choice-1", 0, { add: -3 }).changed, true);
  assert.equal(c.nodes[0]!.choices[0]!.effects[0]!.add, -3);
  assert.ok(S.setEffect(c, "choice-1", 0, { add: -3 }).message === "", "no change, nothing to say");
  assert.equal(S.setEffect(c, "choice-1", 0, { add: 0 }).changed, false);
  assert.equal(S.setEffect(c, "choice-1", 0, { add: 5000 }).changed, false);
  assert.equal(S.setEffect(c, "choice-1", 0, { add: Number.NaN }).changed, false);
  assert.equal(S.setEffect(c, "choice-1", 0, { variable: "var-2" }).changed, true);
  assert.equal(c.nodes[0]!.choices[0]!.effects[0]!.variable, "var-2");
  for (let i = 1; i < S.LIMITS.effects; i++) S.addEffect(c, "choice-1", "var-1");
  assert.equal(S.addEffect(c, "choice-1", "var-1").changed, false);
  assert.equal(S.deleteEffect(c, "choice-1", 0).changed, true);
  assert.equal(S.deleteEffect(c, "choice-1", 99).changed, false);
});

test("meters: added, limited, named, ranged and deleted", () => {
  const c = S.newScenarioContent();
  const m = S.addMeter(c, "var-1", "Trust");
  assert.deepEqual(c.meters[0], { id: m.id, label: "Trust", variable: "var-1", min: 0, max: 10 });
  assert.equal(S.setMeter(c, m.id!, { label: "  " }).changed, false);
  assert.equal(S.setMeter(c, m.id!, { label: "Maya's trust" }).changed, true);
  assert.equal(S.setMeter(c, m.id!, { min: 5, max: 5 }).changed, false);
  assert.ok(S.setMeter(c, m.id!, { min: 12 }).message.includes("less than"));
  assert.equal(S.setMeter(c, m.id!, { min: -5, max: 5 }).changed, true);
  assert.equal(S.setMeter(c, m.id!, { variable: "var-2" }).changed, true);
  for (let i = 1; i < S.LIMITS.meters; i++) S.addMeter(c, "var-1", `Meter ${i}`);
  assert.equal(S.addMeter(c, "var-1", "One too many").changed, false);
  assert.equal(S.deleteMeter(c, m.id!).changed, true);
});

test("the settings: retry, who the learner is, the variable set at an ending, and the reflection", () => {
  const c = S.newScenarioContent();
  assert.equal(S.setRetry(c, true).changed, false, "already on");
  assert.equal(S.setRetry(c, false).changed, true);
  assert.equal(S.setYou(c, "var-who").changed, true);
  assert.equal(S.setYou(c, "var-who").changed, false);
  assert.equal(S.setFinished(c, "var-done").changed, true);
  assert.equal(S.setReflection(c, "  Think.  ").changed, true);
  assert.equal(c.reflection, "Think.");
});

// ---- editing: through the model, with undo

test("an edit is one undo step, a refusal is none, and nothing changes when nothing is different", () => {
  const m = fresh();
  m.addScenario();
  const id = m.object!.id;
  const before = JSON.stringify(scenarioOf(m));
  assert.ok(m.setSituationTitle(id, "situation-1", "At the desk")!.includes("Title"));
  assert.equal(scenarioOf(m).nodes[0]!.title, "At the desk");
  assert.equal(m.setSituationTitle(id, "situation-1", "At the desk"), null);
  assert.ok(m.setSituationTitle(id, "situation-1", " ")!.includes("needs a title"), "a refusal explains itself");
  assert.equal(scenarioOf(m).nodes[0]!.title, "At the desk");
  m.undo();
  assert.equal(JSON.stringify(scenarioOf(m)), before);
});

test("the Model keeps a scenario's edits to the object it was asked about", () => {
  const m = fresh();
  m.addScenario();
  const first = m.object!.id;
  m.addScenario();
  const second = m.object!.id;
  assert.notEqual(first, second);
  m.setSituationTitle(first, "situation-1", "Changed");
  assert.equal(scenarioOf(m).nodes[0]!.title, "The situation", "the selected one is the second");
  assert.equal(m.setSituationTitle("obj-nope", "situation-1", "x"), null);
});

test("adding, deleting and moving through the model are undoable", () => {
  const m = fresh();
  m.addScenario();
  const id = m.object!.id;
  const n = scenarioOf(m).nodes.length;
  const added = m.addSituation(id);
  assert.equal(scenarioOf(m).nodes.length, n + 1);
  assert.ok(added.id);
  m.undo();
  assert.equal(scenarioOf(m).nodes.length, n);
  m.redo();
  assert.equal(m.deleteSituation(id, added.id!)!.includes("Deleted"), true);
  assert.equal(scenarioOf(m).nodes.length, n);
});

test("a meter added to a project with no number variable makes one, and one undo takes both away", () => {
  const m = fresh();
  m.addScenario();
  const id = m.object!.id;
  assert.equal(m.variables.some((v) => v.type === "number"), false);
  assert.ok(m.addScenarioMeter(id)!.includes("Added a meter"));
  const meter = scenarioOf(m).meters[0]!;
  const variable = m.variables.find((v) => v.id === meter.variable)!;
  assert.equal(variable.type, "number");
  assert.equal(meter.label, variable.name);
  m.undo();
  assert.equal(scenarioOf(m).meters.length, 0);
  assert.equal(m.variables.some((v) => v.id === variable.id), false);
});

test("a meter uses a number variable the project already has", () => {
  const m = fresh();
  const v = m.addVariable("number", "trust");
  m.addScenario();
  m.addScenarioMeter(m.object!.id);
  assert.equal(scenarioOf(m).meters[0]!.variable, v.id);
});

test("the variable a scenario uses is counted as used, so it is not deleted from under it", () => {
  const m = fresh();
  const v = m.addVariable("number", "trust");
  m.addScenario();
  const id = m.object!.id;
  m.addScenarioEffect(id, "choice-1", v.id);
  assert.equal(m.variableUsage(v.id).length, 1);
});

// ---- narration of lines

test("the narration dialog lists a scenario's spoken lines, under the object's id and the line's id", () => {
  const m = withCast(maya, dev);
  m.addScenario();
  const id = m.object!.id;
  const c = scenarioOf(m);
  m.setScenarioLineSpeaker(id, c.nodes[0]!.lines[0]!.id, "maya");
  m.setScenarioLineSpoken(id, c.nodes[0]!.lines[0]!.id, true);
  m.addScenarioLine(id, { choiceId: "choice-1" });
  const reply = scenarioOf(m).nodes[0]!.choices[0]!.response[0]!;
  m.setScenarioLineText(id, reply.id, "That helps.");
  m.setScenarioLineSpoken(id, reply.id, true);
  const keys = m.narratedObjects().filter((n) => n.line).map((n) => n.key);
  assert.deepEqual(keys, [`${id}/line-1`, `${id}/${reply.id}`]);
  assert.equal(m.narratedObjects().find((n) => n.key === `${id}/line-1`)!.line!.speaker, "maya");
});

test("writing a line's narration in the dialog uses its speaker's voice, and clearing it removes it", () => {
  const m = withCast(maya, dev);
  m.addScenario();
  const id = m.object!.id;
  const line = scenarioOf(m).nodes[0]!.lines[0]!;
  m.setScenarioLineSpeaker(id, line.id, "dev");
  assert.ok(m.setNarrationScript(`${id}/${line.id}`, "Hello, I am Dev.")!.includes("Added narration"));
  assert.equal((scenarioOf(m).nodes[0]!.lines[0]!.narration as Narration).voice, "am_adam");
  assert.ok(m.setNarrationScript(`${id}/${line.id}`, "")!.includes("Removed"));
  assert.equal(scenarioOf(m).nodes[0]!.lines[0]!.narration, null);
  m.undo();
  assert.ok(scenarioOf(m).nodes[0]!.lines[0]!.narration);
});

// ---- the choice of character

test("a choice of character is in the picker, and needs two people", () => {
  assert.ok(INPUTS.some((i) => i.id === "character"));
  const m = fresh();
  assert.equal(m.addInput("character"), null, "no cast yet");
  m.setCharacters([maya]);
  assert.equal(m.addInput("character"), null, "one person is not a choice");
  m.setCharacters([maya, dev]);
  const o = m.addInput("character")!;
  const c = o.content as unknown as InputContent;
  assert.equal(c.kind, "character");
  assert.deepEqual(c.characters, ["maya", "dev"]);
  assert.equal(m.variables.find((v) => v.id === c.variable)?.type, "string", "it saves into its own text variable");
});

test("a choice of character offers the first three people to start with", () => {
  const m = withCast(maya, dev, { ...maya, id: "c", name: "C" }, { ...maya, id: "d", name: "D" });
  const c = m.addInput("character")!.content as unknown as InputContent;
  assert.equal(c.characters!.length, 3);
});

// ---- copies

test("a copy of a scenario is a scenario of its own: its own id and narration keys, the same story, and the same variables", () => {
  const m = withCast(maya, dev);
  const trust = m.addVariable("number", "trust");
  m.addScenario();
  const first = m.object!.id;
  m.addScenarioEffect(first, "choice-1", trust.id);
  m.setScenarioLineSpoken(first, "line-1", false);
  m.setScenarioLineText(first, "line-1", "Hello.");
  m.setScenarioLineSpoken(first, "line-1", true);
  const variables = m.variables.length;
  m.duplicate();
  const copy = m.object!;
  assert.notEqual(copy.id, first);
  const c = copy.content as unknown as ScenarioContent;
  assert.equal(c.nodes[0]!.choices[0]!.effects[0]!.variable, trust.id, "it adds to the same number");
  assert.equal(m.variables.length, variables, "a scenario makes no variables of its own");
  const keys = m.narratedObjects().filter((n) => n.line).map((n) => n.key);
  assert.deepEqual(keys.sort(), [`${first}/line-1`, `${copy.id}/line-1`].sort());
  // Changing the copy leaves the original alone.
  m.setSituationTitle(copy.id, "situation-1", "Changed in the copy");
  assert.equal((m.objects.find((o) => o.id === first)!.content as unknown as ScenarioContent).nodes[0]!.title, "The situation");
});

test("a copied slide keeps its scenario, and a copied choice of character saves to a variable of its own", () => {
  const m = withCast(maya, dev);
  const pick = m.addInput("character")!;
  m.addScenario();
  const before = m.variables.length;
  m.duplicateSlide();
  assert.equal(m.slides.length, 2);
  const objects = m.slides[1]!.baseLayer.objects;
  assert.equal(objects.filter((o) => o.type === "scenario").length, 1);
  const copiedInput = objects.find((o) => o.type === "input")!;
  assert.notEqual((copiedInput.content as unknown as InputContent).variable, (pick.content as unknown as InputContent).variable);
  assert.equal(m.variables.length, before + 1);
});

// ---- the real validator

type Finding = { severity: string; rule: string; message: string };

function validate(m: Model): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-scen-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a new scenario passes the validator, with only the empty words to write", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  m.addScenario();
  const found = validate(m).filter((f) => f.rule.startsWith("scenario-") || f.rule === "schema");
  assert.deepEqual(found, [], "the starter story is a valid one");
});

test("a scenario with a cast, a choice of character and meters passes the validator", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = withCast(maya, dev);
  const trust = m.addVariable("number", "trust");
  const pick = m.addInput("character")!;
  const who = (pick.content as unknown as InputContent).variable!;
  m.addScenario();
  const id = m.object!.id;
  m.setScenarioYou(id, who);
  const c = scenarioOf(m);
  m.setScenarioLineSpeaker(id, c.nodes[0]!.lines[0]!.id, "maya");
  m.setScenarioLineSpoken(id, c.nodes[0]!.lines[0]!.id, true);
  m.addScenarioEffect(id, "choice-1", trust.id);
  m.addScenarioMeter(id);
  const done = m.variables.find((v) => v.type === "boolean") ?? m.addVariable("boolean", "done");
  m.setScenarioFinished(id, done.id);
  const found = validate(m).filter((f) => f.severity === "error" && f.rule !== "alt-text-missing");
  assert.deepEqual(found, []);
});

test("the validator reports what the editor leaves for the author to write", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  m.addScenario();
  const id = m.object!.id;
  m.addScenarioLine(id, { nodeId: "situation-2" });
  const rules = validate(m).map((f) => f.rule);
  assert.ok(rules.includes("scenario-line-empty"), "a new line has no words yet");
});
