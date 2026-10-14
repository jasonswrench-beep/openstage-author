// Editing a scenario: situations, the lines in them, the choices that lead on, what a choice adds, meters and the settings around them.
// Everything here works on a scenario's content and has no screen in it, so all of it can be tested directly. The Model calls these on a copy,
// records one undo step if something changed, and tells the screen. The panel that uses it is in app.ts.
//
// Each function does its edit and returns what happened in a plain sentence. `changed` says whether anything was altered: a refusal
// ("A situation can have at most six choices.") has a message too, so the author is told why nothing happened.

import type { Character, ScenarioChoice, ScenarioContent, ScenarioLine, ScenarioNode } from "../../player/src/types.ts";
import { YOU } from "./characters.ts";
import { langAfterVoiceChange, newNarration, type Narration } from "./narration.ts";

export const LIMITS = { nodes: 40, lines: 12, choices: 6, responses: 6, effects: 6, meters: 6 } as const;

export interface Edit {
  changed: boolean;
  message: string;
}

const done = (message: string): Edit => ({ changed: true, message });
const refused = (message: string): Edit => ({ changed: false, message });
const unchanged: Edit = { changed: false, message: "" };

// ---- ids

const idsOf = (c: ScenarioContent): string[] => [
  ...c.nodes.flatMap((n) => [n.id, ...n.lines.map((l) => l.id), ...n.choices.flatMap((ch) => [ch.id, ...ch.response.map((l) => l.id)])]),
  ...c.meters.map((m) => m.id),
];

/** An id nothing in the scenario has: all of a scenario's ids are different, because audio and the learner's path are kept by them. */
export function freshId(c: ScenarioContent, prefix: string): string {
  const taken = new Set(idsOf(c));
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

// ---- finding things

export const nodeOf = (c: ScenarioContent, nodeId: string): ScenarioNode | undefined => c.nodes.find((n) => n.id === nodeId);

export function choiceOf(c: ScenarioContent, choiceId: string): { node: ScenarioNode; choice: ScenarioChoice } | undefined {
  for (const node of c.nodes) {
    const choice = node.choices.find((ch) => ch.id === choiceId);
    if (choice) return { node, choice };
  }
  return undefined;
}

export interface LineHome {
  /** The list the line is in: the lines of a situation, or the response to a choice. */
  list: ScenarioLine[];
  index: number;
  line: ScenarioLine;
  node: ScenarioNode;
  /** Set when the line is in the response to a choice. */
  choice: ScenarioChoice | null;
}

export function lineOf(c: ScenarioContent, lineId: string): LineHome | undefined {
  for (const node of c.nodes) {
    const at = node.lines.findIndex((l) => l.id === lineId);
    if (at >= 0) return { list: node.lines, index: at, line: node.lines[at]!, node, choice: null };
    for (const choice of node.choices) {
      const r = choice.response.findIndex((l) => l.id === lineId);
      if (r >= 0) return { list: choice.response, index: r, line: choice.response[r]!, node, choice };
    }
  }
  return undefined;
}

/** Every line of a scenario in the order a learner meets them: each situation's lines, then the response to each of its choices. */
export function allLines(c: ScenarioContent): { line: ScenarioLine; node: ScenarioNode; choice: ScenarioChoice | null }[] {
  return c.nodes.flatMap((node) => [
    ...node.lines.map((line) => ({ line, node, choice: null as ScenarioChoice | null })),
    ...node.choices.flatMap((choice) => choice.response.map((line) => ({ line, node, choice }))),
  ]);
}

/** A line in words, for a message: "line 2 of "At the desk"" or "response 1 to "Greet them"". */
export function describeLine(home: LineHome): string {
  return home.choice ? `response ${home.index + 1} to "${home.choice.label}"` : `line ${home.index + 1} of "${home.node.title}"`;
}

/** Who leads where: the situations that have a choice leading to this one. */
export function leadingTo(c: ScenarioContent, nodeId: string): ScenarioNode[] {
  return c.nodes.filter((n) => n.id !== nodeId && n.choices.some((ch) => ch.next === nodeId));
}

// ---- a new scenario

/**
 * A small scenario to start from: one situation with two choices, each leading to its own ending. All of its words are for the author to
 * write over. No variable is used yet, because which numbers to change is the author's to decide.
 */
export function newScenarioContent(): ScenarioContent {
  const line = (id: string, text: string): ScenarioLine => ({ id, speaker: null, text, narration: null });
  return {
    start: "situation-1",
    you: null,
    nodes: [
      {
        id: "situation-1", title: "The situation", prompt: "What do you do?",
        lines: [line("line-1", "Describe what is happening, and who the learner is talking to.")],
        choices: [
          { id: "choice-1", label: "The first thing the learner could do", next: "situation-2", effects: [], response: [] },
          { id: "choice-2", label: "The second thing the learner could do", next: "situation-3", effects: [], response: [] },
        ],
      },
      { id: "situation-2", title: "One way it ends", prompt: "", lines: [line("line-2", "Say what happens when the learner makes the first choice.")], choices: [] },
      { id: "situation-3", title: "Another way it ends", prompt: "", lines: [line("line-3", "Say what happens when the learner makes the second choice.")], choices: [] },
    ],
    meters: [],
    allowRetry: true,
    finishedVariable: null,
    reflection: "",
  };
}

// ---- situations

export function addSituation(c: ScenarioContent): Edit & { id?: string } {
  if (c.nodes.length >= LIMITS.nodes) return refused(`A scenario can have at most ${LIMITS.nodes} situations.`);
  const id = freshId(c, "situation-");
  const node: ScenarioNode = { id, title: `Situation ${c.nodes.length + 1}`, prompt: "", lines: [], choices: [] };
  c.nodes.push(node);
  node.lines.push({ id: freshId(c, "line-"), speaker: null, text: "", narration: null });
  return { ...done(`Added situation ${c.nodes.length}. It has no choices yet, so it is an ending until you add some. Write what happens in it.`), id };
}

export function deleteSituation(c: ScenarioContent, nodeId: string): Edit {
  const node = nodeOf(c, nodeId);
  if (!node) return unchanged;
  if (c.nodes.length <= 1) return refused("A scenario needs at least one situation.");
  const from = leadingTo(c, nodeId);
  if (from.length > 0) {
    return refused(`${from.map((n) => `"${n.title}"`).join(" and ")} ${from.length === 1 ? "has a choice that leads" : "have choices that lead"} to "${node.title}". Change where ${from.length === 1 ? "it leads" : "they lead"} first, then delete it.`);
  }
  const wasStart = c.start === nodeId;
  c.nodes = c.nodes.filter((n) => n.id !== nodeId);
  if (wasStart) c.start = c.nodes[0]!.id;
  return done(`Deleted the situation "${node.title}".${wasStart ? ` The scenario now starts at "${c.nodes[0]!.title}".` : ""}`);
}

export function moveSituation(c: ScenarioContent, nodeId: string, delta: -1 | 1): Edit {
  const i = c.nodes.findIndex((n) => n.id === nodeId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= c.nodes.length) return unchanged;
  const [node] = c.nodes.splice(i, 1);
  c.nodes.splice(j, 0, node!);
  return done(`Moved "${node!.title}" to place ${j + 1} of ${c.nodes.length}. The order is only for the list here: the learner follows the choices.`);
}

export function setStart(c: ScenarioContent, nodeId: string): Edit {
  const node = nodeOf(c, nodeId);
  if (!node || c.start === nodeId) return unchanged;
  c.start = nodeId;
  return done(`The scenario now starts at "${node.title}".`);
}

export function setTitle(c: ScenarioContent, nodeId: string, title: string): Edit {
  const node = nodeOf(c, nodeId);
  const next = title.trim();
  if (!node || node.title === next) return unchanged;
  if (next === "") return refused("A situation needs a title. It is the heading the learner hears first.");
  node.title = next;
  return done("Title updated.");
}

export function setPrompt(c: ScenarioContent, nodeId: string, prompt: string): Edit {
  const node = nodeOf(c, nodeId);
  const next = prompt.trim();
  if (!node || node.prompt === next) return unchanged;
  node.prompt = next;
  return done("Question updated.");
}

// ---- lines

/** The voice a line should be read in: its speaker's, if the speaker is someone in the cast. */
export function voiceFor(speaker: string | null, cast: readonly Character[]): string | undefined {
  return speaker && speaker !== YOU ? cast.find((p) => p.id === speaker)?.voice : undefined;
}

/** Narration for a line: its words, in its speaker's voice if it has one, otherwise in the voice and speed of the narration nearest to hand. */
export function spokenLine(text: string, speaker: string | null, cast: readonly Character[], like?: Narration): Narration {
  const base = newNarration(text.trim(), like);
  const voice = voiceFor(speaker, cast);
  return voice ? { ...base, voice, lang: langAfterVoiceChange(base, voice) } : base;
}

/** Add a line to a situation (`nodeId`), or to the response to a choice (`choiceId`). It starts with no words, for the author to write. */
export function addLine(c: ScenarioContent, where: { nodeId: string } | { choiceId: string }): Edit & { id?: string } {
  let list: ScenarioLine[];
  let limit: number;
  let what: string;
  if ("nodeId" in where) {
    const node = nodeOf(c, where.nodeId);
    if (!node) return unchanged;
    [list, limit, what] = [node.lines, LIMITS.lines, `a situation can have at most ${LIMITS.lines} lines`];
  } else {
    const hit = choiceOf(c, where.choiceId);
    if (!hit) return unchanged;
    [list, limit, what] = [hit.choice.response, LIMITS.responses, `a response can have at most ${LIMITS.responses} lines`];
  }
  if (list.length >= limit) return refused(`Only ${limit} lines fit: ${what}.`);
  const id = freshId(c, "line-");
  list.push({ id, speaker: null, text: "", narration: null });
  return { ...done(`Added line ${list.length}. Choose who says it and write the words.`), id };
}

export function deleteLine(c: ScenarioContent, lineId: string): Edit {
  const home = lineOf(c, lineId);
  if (!home) return unchanged;
  if (!home.choice && home.list.length <= 1) return refused("A situation needs at least one line, to say what is happening.");
  home.list.splice(home.index, 1);
  return done(`Deleted ${describeLine(home)}.`);
}

export function moveLine(c: ScenarioContent, lineId: string, delta: -1 | 1): Edit {
  const home = lineOf(c, lineId);
  if (!home) return unchanged;
  const j = home.index + delta;
  if (j < 0 || j >= home.list.length) return unchanged;
  home.list.splice(home.index, 1);
  home.list.splice(j, 0, home.line);
  return done(`Moved to place ${j + 1} of ${home.list.length}.`);
}

/**
 * Change a line's words. If the line is spoken and what it says is what it showed, what it says follows, so the audio does not
 * quietly stop matching the text. Words the author wrote differently for the voice are left alone.
 */
export function setLineText(c: ScenarioContent, lineId: string, text: string): Edit {
  const home = lineOf(c, lineId);
  if (!home || home.line.text === text) return unchanged;
  const line = home.line;
  const said = (line.narration as Narration | null) ?? null;
  const followed = said && said.script === line.text.trim() ? said : null;
  line.text = text;
  if (followed && text.trim() !== "") {
    line.narration = { ...followed, script: text.trim() };
    return done("Line updated. Its spoken words follow it, so make the audio again.");
  }
  return done("Line updated.");
}

export function setLineSpeaker(c: ScenarioContent, lineId: string, speaker: string | null, cast: readonly Character[]): Edit {
  const home = lineOf(c, lineId);
  if (!home || home.line.speaker === speaker) return unchanged;
  if (speaker !== null && speaker !== YOU && !cast.some((p) => p.id === speaker)) return refused("That person is not in the cast.");
  home.line.speaker = speaker;
  const voice = voiceFor(speaker, cast);
  const n = home.line.narration as Narration | null;
  if (n && voice && n.voice !== voice) {
    home.line.narration = { ...n, voice, lang: langAfterVoiceChange(n, voice) };
    return done(`Now spoken by ${cast.find((p) => p.id === speaker)!.name}. Its voice changed to theirs, so make the audio again.`);
  }
  const who = speaker === null ? "the narrator" : speaker === YOU ? "you, the learner's character" : cast.find((p) => p.id === speaker)!.name;
  return done(`Now spoken by ${who}.`);
}

/** Make a line spoken (its words, in its speaker's voice) or take its spoken form away. */
export function setLineSpoken(c: ScenarioContent, lineId: string, on: boolean, cast: readonly Character[], like?: Narration): Edit {
  const home = lineOf(c, lineId);
  if (!home) return unchanged;
  const line = home.line;
  if (on === (line.narration !== null)) return unchanged;
  if (!on) {
    line.narration = null;
    return done("The line is no longer spoken. It can only be read.");
  }
  if (line.text.trim() === "") return refused("Write the line first. Its spoken form is made from its words.");
  line.narration = spokenLine(line.text, line.speaker, cast, like);
  return done("The line is now spoken. Make the audio from the Narration button, where you can also change the voice and the pronunciation.");
}

// ---- choices

export function addChoice(c: ScenarioContent, nodeId: string): Edit & { id?: string } {
  const node = nodeOf(c, nodeId);
  if (!node) return unchanged;
  if (node.choices.length >= LIMITS.choices) return refused(`A situation can have at most ${LIMITS.choices} choices.`);
  const id = freshId(c, "choice-");
  const next = c.nodes.find((n) => n.id !== nodeId)?.id ?? nodeId;
  node.choices.push({ id, label: `Choice ${node.choices.length + 1}`, next, effects: [], response: [] });
  return { ...done(`Added choice ${node.choices.length}. Write what the learner does, and choose the situation it leads to.`), id };
}

export function deleteChoice(c: ScenarioContent, choiceId: string): Edit {
  const hit = choiceOf(c, choiceId);
  if (!hit) return unchanged;
  hit.node.choices = hit.node.choices.filter((ch) => ch.id !== choiceId);
  return done(hit.node.choices.length === 0
    ? `Deleted the choice. "${hit.node.title}" now has no choices, so it is an ending.`
    : "Deleted the choice.");
}

export function moveChoice(c: ScenarioContent, choiceId: string, delta: -1 | 1): Edit {
  const hit = choiceOf(c, choiceId);
  if (!hit) return unchanged;
  const list = hit.node.choices;
  const i = list.indexOf(hit.choice);
  const j = i + delta;
  if (j < 0 || j >= list.length) return unchanged;
  list.splice(i, 1);
  list.splice(j, 0, hit.choice);
  return done(`Moved to place ${j + 1} of ${list.length}.`);
}

export function setChoiceLabel(c: ScenarioContent, choiceId: string, label: string): Edit {
  const hit = choiceOf(c, choiceId);
  const next = label.trim();
  if (!hit || hit.choice.label === next) return unchanged;
  if (next === "") return refused("A choice needs words that say what the learner does.");
  hit.choice.label = next;
  return done("Choice updated.");
}

export function setChoiceNext(c: ScenarioContent, choiceId: string, nodeId: string): Edit {
  const hit = choiceOf(c, choiceId);
  const target = nodeOf(c, nodeId);
  if (!hit || !target || hit.choice.next === nodeId) return unchanged;
  hit.choice.next = nodeId;
  return done(`This choice now leads to "${target.title}".`);
}

// ---- what a choice adds

export const EFFECT_MAX = 1000;

export function addEffect(c: ScenarioContent, choiceId: string, variable: string): Edit {
  const hit = choiceOf(c, choiceId);
  if (!hit) return unchanged;
  if (hit.choice.effects.length >= LIMITS.effects) return refused(`A choice can change at most ${LIMITS.effects} numbers.`);
  hit.choice.effects.push({ variable, add: 1 });
  return done("Added a change. It adds 1 to the number; set how much.");
}

export function setEffect(c: ScenarioContent, choiceId: string, index: number, patch: { variable?: string; add?: number }): Edit {
  const effect = choiceOf(c, choiceId)?.choice.effects[index];
  if (!effect) return unchanged;
  if (patch.add !== undefined) {
    if (!Number.isFinite(patch.add) || patch.add === 0 || Math.abs(patch.add) > EFFECT_MAX) {
      return refused(`A change adds a number that is not 0, up to ${EFFECT_MAX} either way. Use a minus sign to take away.`);
    }
    if (effect.add === patch.add) return unchanged;
    effect.add = patch.add;
    return done(`It now ${patch.add > 0 ? "adds" : "takes away"} ${Math.abs(patch.add)}.`);
  }
  if (patch.variable !== undefined && patch.variable !== effect.variable) {
    effect.variable = patch.variable;
    return done("The change now applies to another number.");
  }
  return unchanged;
}

export function deleteEffect(c: ScenarioContent, choiceId: string, index: number): Edit {
  const hit = choiceOf(c, choiceId);
  if (!hit || !hit.choice.effects[index]) return unchanged;
  hit.choice.effects.splice(index, 1);
  return done("Deleted the change.");
}

// ---- meters

export function addMeter(c: ScenarioContent, variable: string, label: string): Edit & { id?: string } {
  if (c.meters.length >= LIMITS.meters) return refused(`A scenario can have at most ${LIMITS.meters} meters.`);
  const id = freshId(c, "meter-");
  c.meters.push({ id, label, variable, min: 0, max: 10 });
  return { ...done("Added a meter. It shows the number as the learner's choices change it. Set what it measures and its range."), id };
}

export function setMeter(c: ScenarioContent, meterId: string, patch: { label?: string; variable?: string; min?: number; max?: number }): Edit {
  const meter = c.meters.find((m) => m.id === meterId);
  if (!meter) return unchanged;
  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (label === meter.label) return unchanged;
    if (label === "") return refused("A meter needs a name. A screen reader says it, and it is written beside the bar.");
    meter.label = label;
    return done("Meter named.");
  }
  if (patch.variable !== undefined) {
    if (patch.variable === meter.variable) return unchanged;
    meter.variable = patch.variable;
    return done("The meter now shows another number.");
  }
  const min = patch.min ?? meter.min;
  const max = patch.max ?? meter.max;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return refused("Write the range as numbers.");
  if (min >= max) return refused("The smallest value has to be less than the largest.");
  if (min === meter.min && max === meter.max) return unchanged;
  [meter.min, meter.max] = [min, max];
  return done(`The meter now goes from ${min} to ${max}.`);
}

export function deleteMeter(c: ScenarioContent, meterId: string): Edit {
  const meter = c.meters.find((m) => m.id === meterId);
  if (!meter) return unchanged;
  c.meters = c.meters.filter((m) => m.id !== meterId);
  return done(`Deleted the meter "${meter.label}". The number it showed is not changed.`);
}

// ---- settings

export function setRetry(c: ScenarioContent, on: boolean): Edit {
  if (c.allowRetry === on) return unchanged;
  c.allowRetry = on;
  return done(on ? "Learners can now take back their last choice and choose again." : "Learners can no longer take back a choice. They can still start again at an ending.");
}

export function setYou(c: ScenarioContent, variable: string | null): Edit {
  if (c.you === variable) return unchanged;
  c.you = variable;
  return done(variable === null
    ? "Lines spoken by \"you\" now show just \"You\"."
    : "Lines spoken by \"you\" now show the character the learner chose. Put a Choose a character input on an earlier slide.");
}

export function setFinished(c: ScenarioContent, variable: string | null): Edit {
  if (c.finishedVariable === variable) return unchanged;
  c.finishedVariable = variable;
  return done(variable === null ? "Reaching an ending no longer sets a variable." : "Reaching an ending now sets that variable to true, so a rule can carry on from there.");
}

export function setReflection(c: ScenarioContent, text: string): Edit {
  const next = text.trim();
  if (c.reflection === next) return unchanged;
  c.reflection = next;
  return done("Reflection updated.");
}
