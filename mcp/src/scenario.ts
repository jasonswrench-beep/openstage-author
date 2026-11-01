// A branching scenario from a plain description: situations, what is said in each, the choices the learner has and where each leads, what a choice
// changes (a score, a mood), and the meters that show it. The result is the content the editor's own scenario object holds, with every limit of
// the format checked and every reference resolved first, so a description that cannot work is refused with the reason and nothing is made.

import { LIMITS, spokenLine } from "../../editor/src/scenarioedit.ts";
import type { Narration } from "../../editor/src/narration.ts";
import type { Character, ScenarioChoice, ScenarioContent, ScenarioLine, ScenarioNode, Variable } from "../../player/src/types.ts";
import { ToolError } from "./protocol.ts";

export interface LineSpec {
  text: string;
  /** A person of the cast, by id or name. Nobody if left out. */
  speaker?: string;
}

export interface ChoiceSpec {
  label: string;
  /** The situation this leads to: its number (from 1) or its title. */
  goesTo: string | number;
  /** What is said straight after the choice, before the next situation. */
  response?: LineSpec[];
  effects?: { variable: string; add: number }[];
}

export interface SituationSpec {
  title: string;
  /** The question above the choices. */
  prompt?: string;
  lines?: LineSpec[];
  choices?: ChoiceSpec[];
}

export interface ScenarioSpec {
  situations: SituationSpec[];
  /** The situation it starts in: its number or title. The first if left out. */
  start?: string | number;
  meters?: { label: string; variable: string; min?: number; max?: number }[];
  allowRetry?: boolean;
  /** A true or false variable set when the learner reaches an ending. */
  finishedVariable?: string;
  reflection?: string;
  /** Whether every line is spoken, in its speaker's voice if the speaker has one. */
  spoken: boolean;
}

export interface World {
  cast: readonly Character[];
  variables: readonly Variable[];
  /** The narration nearest to hand, whose voice and speed a new one follows. */
  like?: Narration;
}

const bad = (message: string): never => {
  throw new ToolError(message);
};

/** Build the scenario's content. Throws a sentence for anything that cannot be a scenario. */
export function buildScenario(spec: ScenarioSpec, world: World): ScenarioContent {
  const n = spec.situations.length;
  if (n < 1) bad("A scenario needs at least one situation.");
  if (n > LIMITS.nodes) bad(`A scenario can have at most ${LIMITS.nodes} situations.`);

  let lineSerial = 0;
  let choiceSerial = 0;
  const ids = spec.situations.map((_, i) => `situation-${i + 1}`);

  const situationId = (given: string | number, where: string): string => {
    if (typeof given === "number" || /^\d+$/.test(String(given).trim())) {
      const at = Number(given);
      if (!Number.isInteger(at) || at < 1 || at > n) return bad(`${where}: there is no situation ${given}. They are numbered 1 to ${n}.`);
      return ids[at - 1]!;
    }
    const wanted = String(given).trim().toLowerCase();
    const hits = spec.situations.flatMap((s, i) => (s.title.trim().toLowerCase() === wanted ? [i] : []));
    if (hits.length === 0) return bad(`${where}: there is no situation called "${given}". The titles are: ${spec.situations.map((s) => s.title).join("; ")}.`);
    if (hits.length > 1) return bad(`${where}: more than one situation is called "${given}". Use its number.`);
    return ids[hits[0]!]!;
  };

  const speakerId = (given: string | undefined, where: string): string | null => {
    if (given === undefined) return null;
    const wanted = given.trim().toLowerCase();
    const hit = world.cast.find((p) => p.id === given) ?? world.cast.find((p) => p.name.toLowerCase() === wanted);
    if (!hit) {
      return bad(`${where}: "${given}" is not in the cast. ${world.cast.length > 0 ? `The cast is: ${world.cast.map((p) => p.name).join(", ")}.` : "The course has no cast yet; add_character adds a person."}`);
    }
    return hit.id;
  };

  const makeLine = (l: LineSpec, where: string, count: number, limit: number): ScenarioLine => {
    if (count > limit) bad(`${where} can have at most ${limit} lines.`);
    const text = l.text.trim();
    if (text === "") bad(`${where}: a line has no words.`);
    const speaker = speakerId(l.speaker, where);
    lineSerial += 1;
    return { id: `line-${lineSerial}`, speaker, text, narration: spec.spoken ? spokenLine(text, speaker, world.cast, world.like) : null };
  };

  const numberVariable = (name: string, where: string): string => {
    const wanted = name.trim().toLowerCase();
    const v = world.variables.find((x) => x.id === name) ?? world.variables.find((x) => x.name.toLowerCase() === wanted);
    if (!v) return bad(`${where}: there is no variable "${name}". ${world.variables.length > 0 ? `The variables are: ${world.variables.map((x) => x.name).join(", ")}.` : "add_variable makes one."}`);
    if (v.type !== "number") return bad(`${where}: "${v.name}" is a ${v.type} variable, and this needs a number variable.`);
    return v.id;
  };

  const nodes: ScenarioNode[] = spec.situations.map((s, i) => {
    const where = `Situation ${i + 1}`;
    const title = s.title.trim();
    if (title === "") bad(`${where} needs a title.`);
    const lines = (s.lines ?? []).map((l, k, all) => makeLine(l, `${where}, line ${k + 1}`, all.length, LIMITS.lines));
    const choicesIn = s.choices ?? [];
    if (choicesIn.length > LIMITS.choices) bad(`${where} can have at most ${LIMITS.choices} choices.`);
    const choices: ScenarioChoice[] = choicesIn.map((c, k) => {
      const here = `${where}, choice ${k + 1}`;
      const label = c.label.trim();
      if (label === "") bad(`${here} has no words.`);
      choiceSerial += 1;
      const response = (c.response ?? []).map((l, j, all) => makeLine(l, `${here}, response ${j + 1}`, all.length, LIMITS.responses));
      const effectsIn = c.effects ?? [];
      if (effectsIn.length > LIMITS.effects) bad(`${here} can change at most ${LIMITS.effects} things.`);
      const effects = effectsIn.map((e, j) => {
        if (!Number.isFinite(e.add) || Math.abs(e.add) > 1000) bad(`${here}, effect ${j + 1}: the amount must be a number from -1000 to 1000.`);
        return { variable: numberVariable(e.variable, `${here}, effect ${j + 1}`), add: e.add };
      });
      return { id: `choice-${choiceSerial}`, label, next: situationId(c.goesTo, here), effects, response };
    });
    return { id: ids[i]!, title, prompt: (s.prompt ?? "").trim(), lines, choices };
  });

  const meters = (spec.meters ?? []).map((m, i) => {
    const where = `Meter ${i + 1}`;
    if (i >= LIMITS.meters) bad(`A scenario can have at most ${LIMITS.meters} meters.`);
    if (m.label.trim() === "") bad(`${where} needs a label.`);
    const min = m.min ?? 0;
    const max = m.max ?? 100;
    if (!(min < max)) bad(`${where}: the smallest value must be less than the largest.`);
    return { id: `meter-${i + 1}`, label: m.label.trim(), variable: numberVariable(m.variable, where), min, max };
  });

  let finishedVariable: string | null = null;
  if (spec.finishedVariable !== undefined) {
    const wanted = spec.finishedVariable.trim().toLowerCase();
    const v = world.variables.find((x) => x.id === spec.finishedVariable) ?? world.variables.find((x) => x.name.toLowerCase() === wanted);
    if (!v) bad(`There is no variable "${spec.finishedVariable}" to set when the learner reaches an ending.`);
    else if (v.type !== "boolean") bad(`"${v.name}" is a ${v.type} variable; the one set at an ending must be a true or false variable.`);
    else finishedVariable = v.id;
  }

  // Every situation but the first must be somewhere the learner can get to, or it is a dead page the checker will name.
  const start = spec.start === undefined ? ids[0]! : situationId(spec.start, "The start");
  const reached = new Set<string>([start]);
  for (let again = true; again; ) {
    again = false;
    for (const node of nodes) if (reached.has(node.id)) for (const c of node.choices) if (!reached.has(c.next)) (reached.add(c.next), (again = true));
  }
  const lost = nodes.filter((x) => !reached.has(x.id));
  if (lost.length > 0) bad(`${lost.map((x) => `"${x.title}"`).join(", ")} can never be reached: no choice leads there. Point a choice at ${lost.length === 1 ? "it" : "them"}, or leave ${lost.length === 1 ? "it" : "them"} out.`);

  return {
    start,
    you: null,
    nodes,
    meters,
    allowRetry: spec.allowRetry ?? true,
    finishedVariable,
    reflection: (spec.reflection ?? "").trim(),
  };
}
