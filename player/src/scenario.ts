// Scenarios: a branching story the learner steps through by choosing what to do. A situation is told in lines (by the narrator, by people
// in the project's cast, or by the learner's own character), the learner chooses, the choice may add to a number variable and shows a
// response, and the story goes on in another situation until an ending (a situation with no choices).
//
// The first half of this file has no screen in it: where the learner is, what a choice does, and what to say about it are plain functions,
// so they can be tested directly. The second half builds the widget from them, out of real headings, lists and buttons. The renderer calls
// buildScenario for an object of type "scenario"; it is part of the one shared renderer, so the editor's canvas and the course look the same.
//
// Where the learner is, is one short string: the number of the choice made in each situation, from the start (so "02" is the first
// choice of the start situation, then the third choice of the situation it led to). That is all the course has to remember, and it is
// small enough to keep with the learner's other progress in an LMS.

import type { Character, CharacterPose, OSObject, Primitive, ScenarioChoice, ScenarioContent, ScenarioEffect, ScenarioLine, ScenarioMeter, ScenarioNode } from "./types.ts";
import { t } from "./playertext.ts";

/** The most choices one walk through a scenario can hold. A story that loops back on itself stops here, so what is remembered stays small. */
export const MAX_STEPS = 120;

const round = (n: number): number => Math.round(n * 1e9) / 1e9;

// ---- where the learner is

export interface Walk {
  /** The situations from the start to where the learner is now: one more than there are choices. */
  nodes: ScenarioNode[];
  /** The choice made in each situation but the last. */
  choices: ScenarioChoice[];
  /** The part of the path that fits the scenario. A course that was edited since the learner left may not fit it all; the walk stops at the first step that does not. */
  path: string;
}

/** Follow a path from the start. Null if the scenario has no start. */
export function walk(c: ScenarioContent, path: string): Walk | null {
  const byId = new Map(c.nodes.map((n) => [n.id, n] as const));
  const first = byId.get(c.start);
  if (!first) return null;
  let node: ScenarioNode = first;
  const nodes: ScenarioNode[] = [first];
  const choices: ScenarioChoice[] = [];
  let kept = "";
  for (const ch of path.slice(0, MAX_STEPS)) {
    const choice: ScenarioChoice | undefined = /^[0-9]$/.test(ch) ? node.choices[Number(ch)] : undefined;
    const next: ScenarioNode | undefined = choice && byId.get(choice.next);
    if (!choice || !next) break;
    choices.push(choice);
    nodes.push(next);
    kept += ch;
    node = next;
  }
  return { nodes, choices, path: kept };
}

/** A situation with no choices ends the scenario. */
export const isEnding = (node: ScenarioNode): boolean => node.choices.length === 0;

// ---- what a move does

export interface Move {
  /** Where the learner is after it. */
  path: string;
  /** What to add to number variables, one entry for each variable, with nothing for a total of zero. */
  effects: ScenarioEffect[];
  /** The learner has arrived at an ending. */
  finished: boolean;
}

/** Add up effects by variable, in the order the variables first appear. `sign` -1 takes them away. */
export function totalEffects(list: ScenarioEffect[], sign: 1 | -1 = 1): ScenarioEffect[] {
  const sums = new Map<string, number>();
  for (const e of list) sums.set(e.variable, (sums.get(e.variable) ?? 0) + sign * e.add);
  return [...sums].map(([variable, add]) => ({ variable, add: round(add) })).filter((e) => e.add !== 0);
}

/** The learner makes choice number `index` where they are. Null if it cannot be made: no such choice, an ending, or a walk that has reached its limit. */
export function choose(c: ScenarioContent, path: string, index: number): Move | null {
  const w = walk(c, path);
  if (!w || w.path !== path || path.length >= MAX_STEPS) return null;
  const choice = w.nodes[w.nodes.length - 1]!.choices[index];
  const next = choice && c.nodes.find((n) => n.id === choice.next);
  if (!choice || !next) return null;
  return { path: path + String(index), effects: totalEffects(choice.effects), finished: isEnding(next) };
}

/** Take back the last `steps` choices, or every one of them to start again. What they added is taken off. Null if there is nothing to take back. */
export function undo(c: ScenarioContent, path: string, steps: number): Move | null {
  const w = walk(c, path);
  if (!w || steps < 1 || w.choices.length === 0) return null;
  const n = Math.min(steps, w.choices.length);
  const taken = w.choices.slice(w.choices.length - n);
  return { path: w.path.slice(0, w.path.length - n), effects: totalEffects(taken.flatMap((ch) => ch.effects), -1), finished: false };
}

// ---- what to show and say

/** Who is speaking a line: a name and, if they have one, a picture, and the pose the line asks for if the person has it. Null for the narrator. */
export interface Speaker {
  name: string;
  picture: Character["picture"];
  pose: CharacterPose | null;
}

/** The person from the cast the learner chose to be, or null if there is none (no choice yet, or the scenario does not use one). */
export function youOf(c: ScenarioContent, cast: Character[], value: (variable: string) => Primitive | undefined): Character | null {
  if (!c.you) return null;
  const v = value(c.you);
  return typeof v === "string" ? cast.find((p) => p.id === v) ?? null : null;
}

const poseOf = (person: Character, id: string | null | undefined): CharacterPose | null => (id ? person.poses?.find((p) => p.id === id) ?? null : null);

export function speakerOf(line: ScenarioLine, cast: Character[], you: Character | null): Speaker | null {
  if (line.speaker === null) return null;
  // The learner's own character shows the pose a line asks for if they have it: who they are is only known when the course is played.
  if (line.speaker === "you") return you ? { name: you.name, picture: you.picture, pose: poseOf(you, line.pose) } : { name: t("scenario.you"), picture: null, pose: null };
  const person = cast.find((p) => p.id === line.speaker);
  // Someone who is not in the cast is the validator's to report; the line is still shown, as the narrator's.
  return person ? { name: person.name, picture: person.picture, pose: poseOf(person, line.pose) } : null;
}

/** A line for each choice the learner made: where they were, and what they did. Shown at an ending. */
export function pathReview(w: Walk): { situation: string; choice: string }[] {
  return w.choices.map((choice, i) => ({ situation: w.nodes[i]!.title, choice: choice.label }));
}

const numberOf = (v: Primitive | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** What each meter's variable holds now. */
export function meterValues(meters: ScenarioMeter[], value: (variable: string) => Primitive | undefined): number[] {
  return meters.map((m) => numberOf(value(m.variable)));
}

/** A sentence for a screen reader about how the meters moved, or an empty string if none did. */
export function describeMeterChanges(meters: ScenarioMeter[], before: number[], after: number[]): string {
  const parts: string[] = [];
  meters.forEach((m, i) => {
    const change = round((after[i] ?? 0) - (before[i] ?? 0));
    if (change !== 0) parts.push(change > 0 ? t("scenario.meterUp", { label: m.label, value: after[i] ?? 0, change }) : t("scenario.meterDown", { label: m.label, value: after[i] ?? 0, change: -change }));
  });
  return parts.join(" ");
}

// ---- the widget

/** What a scenario needs to speak its lines. Absent in the editor, where nothing speaks. */
export interface ScenarioSound {
  has(lineId: string): boolean;
  /** Say these lines, one after another, in place of anything already being said. */
  play(lineIds: string[]): void;
}

export interface ScenarioHooks {
  /** Editing: the first situation is drawn, and nothing responds. */
  editing: boolean;
  /** The project's cast. */
  cast: Character[];
  /** The value of a variable now. */
  value(variable: string): Primitive | undefined;
  /** Where the learner got to before: the path saved with their progress, or "". */
  path(): string;
  /** The learner moved. The course adds up what it did, remembers the path and sets the variable for an ending. */
  onMove?(move: Move): void;
  announce?(message: string): void;
  sound?: ScenarioSound;
}

export interface BuiltScenario {
  el: HTMLElement;
  /** The course's variables changed: show the meters and the learner's character as they are now, without moving focus. */
  refresh(): void;
}

type Attrs = Record<string, string>;

function make(doc: Document, tag: string, cls = "", attrs: Attrs = {}): HTMLElement {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function textOf(doc: Document, tag: string, cls: string, text: string, attrs: Attrs = {}): HTMLElement {
  const e = make(doc, tag, cls, attrs);
  e.textContent = text;
  return e;
}

export function buildScenario(doc: Document, obj: OSObject, hooks: ScenarioHooks): BuiltScenario {
  const c = obj.content as unknown as ScenarioContent;
  const root = make(doc, "section", "os-scenario");
  root.setAttribute("aria-label", obj.accessibility.altText.trim() || obj.name);
  const id = (part: string) => `${obj.id}-${part}`;
  const editing = hooks.editing;
  // In the editor the controls are drawn but do not respond, and are not tab stops.
  const inert = (e: HTMLElement) => { if (editing) { e.tabIndex = -1; e.style.pointerEvents = "none"; } };

  // ---- meters
  const meterEls: { meter: HTMLElement; text: HTMLElement; m: ScenarioMeter }[] = [];
  if (c.meters.length > 0) {
    const group = make(doc, "div", "os-scenario-meters", { role: "group", "aria-label": t("scenario.meters") });
    for (const m of c.meters) {
      const row = make(doc, "div", "os-scenario-meter");
      const text = make(doc, "span", "os-scenario-meter-text");
      const meter = make(doc, "meter", "os-scenario-meter-bar", { "aria-label": m.label });
      row.append(text, meter);
      group.appendChild(row);
      meterEls.push({ meter, text, m });
    }
    root.appendChild(group);
  }
  const showMeters = () => {
    const values = meterValues(c.meters, hooks.value);
    meterEls.forEach(({ meter, text, m }, i) => {
      const v = values[i]!;
      const bar = meter as HTMLMeterElement;
      bar.min = m.min;
      bar.max = m.max;
      bar.value = v;
      bar.setAttribute("aria-valuetext", t("scenario.meterValue", { value: v, min: m.min, max: m.max }));
      text.textContent = t("scenario.meterLabel", { label: m.label, value: v });
    });
  };

  // ---- the panel: what the learner is looking at now
  const panel = make(doc, "div", "os-scenario-panel");
  root.appendChild(panel);
  let path = editing ? "" : walk(c, hooks.path())?.path ?? "";
  let refreshers: (() => void)[] = [];

  const you = () => youOf(c, hooks.cast, hooks.value);

  const lineItem = (line: ScenarioLine): HTMLElement => {
    const speaker = speakerOf(line, hooks.cast, you());
    const li = make(doc, "li", speaker ? "os-scenario-line" : "os-scenario-line os-scenario-story");
    // The name is always written beside the picture, so the picture says nothing to a screen reader. A pose is shown in place of the picture, cut to show the person to the waist.
    if (speaker?.pose) {
      const img = make(doc, "img", "os-scenario-pose", { alt: "" }) as HTMLImageElement;
      img.src = speaker.pose.src;
      li.appendChild(img);
    } else if (speaker?.picture) {
      const img = make(doc, "img", "os-scenario-pic", { alt: "" }) as HTMLImageElement;
      img.src = speaker.picture.src;
      li.appendChild(img);
    }
    const body = make(doc, "div", "os-scenario-body");
    if (speaker) body.appendChild(textOf(doc, "strong", "os-scenario-name", `${speaker.name}: `));
    body.appendChild(textOf(doc, "span", "os-scenario-text", line.text));
    li.appendChild(body);
    return li;
  };

  const linesList = (lines: ScenarioLine[]): HTMLElement => {
    const ul = make(doc, "ul", "os-scenario-lines");
    const fill = () => { ul.textContent = ""; for (const line of lines) ul.appendChild(lineItem(line)); };
    fill();
    refreshers.push(fill);
    return ul;
  };

  const heading = (level: 2 | 3, text: string): HTMLElement => textOf(doc, `h${level}`, "os-scenario-heading", text, { tabindex: "-1" });

  const control = (label: string, cls: string, action: () => void): HTMLButtonElement => {
    const b = make(doc, "button", cls, { type: "button" }) as HTMLButtonElement;
    b.textContent = label;
    b.addEventListener("click", action);
    inert(b);
    return b;
  };

  const render = (just: ScenarioChoice | null, focus: boolean): void => {
    panel.textContent = "";
    refreshers = [];
    const w = walk(c, path);
    if (!w) {
      panel.appendChild(textOf(doc, "p", "os-scenario-text", t("scenario.noStart")));
      return;
    }
    path = w.path;
    const node = w.nodes[w.nodes.length - 1]!;
    const spoken: string[] = [];
    let focusTarget: HTMLElement | null = null;

    // What the choice just made led to, before the next situation.
    if (just) {
      const result = make(doc, "div", "os-scenario-result");
      const h = heading(2, just.response.length > 0 ? t("scenario.whatHappened") : t("scenario.yourChoice"));
      result.append(h, textOf(doc, "p", "os-scenario-chosen", t("scenario.youChose", { label: just.label })));
      if (just.response.length > 0) result.appendChild(linesList(just.response));
      for (const line of just.response) spoken.push(line.id);
      panel.appendChild(result);
      focusTarget = h;
    }

    const situation = make(doc, "div", "os-scenario-situation");
    const title = heading(2, node.title);
    situation.append(title, linesList(node.lines));
    for (const line of node.lines) spoken.push(line.id);
    focusTarget ??= title;

    const audible = hooks.sound ? spoken.filter((lineId) => hooks.sound!.has(lineId)) : [];
    if (audible.length > 0) situation.appendChild(control(t("scenario.listen"), "os-nav-btn os-scenario-listen", () => hooks.sound!.play(audible)));

    const ended = isEnding(node);
    if (!ended && path.length >= MAX_STEPS) {
      situation.appendChild(textOf(doc, "p", "os-scenario-text", t("scenario.tooLong")));
    } else if (!ended) {
      const group = make(doc, "div", "os-scenario-choices", { role: "group", "aria-labelledby": id("prompt") });
      group.appendChild(textOf(doc, "p", "os-scenario-prompt", node.prompt.trim() || node.title, { id: id("prompt") }));
      node.choices.forEach((choice, i) => group.appendChild(control(choice.label, "os-nav-btn os-scenario-choice", () => pick(i))));
      situation.appendChild(group);
    } else {
      const review = make(doc, "div", "os-scenario-review");
      review.appendChild(heading(3, t("scenario.yourPath")));
      const steps = pathReview(w);
      if (steps.length > 0) {
        const ol = make(doc, "ol", "os-scenario-path");
        for (const s of steps) ol.appendChild(textOf(doc, "li", "", t("scenario.pathLine", { situation: s.situation, choice: s.choice })));
        review.appendChild(ol);
      }
      if (c.reflection.trim()) {
        const p = make(doc, "p", "os-scenario-reflection");
        p.append(textOf(doc, "strong", "", `${t("scenario.reflection")} `), doc.createTextNode(c.reflection));
        review.appendChild(p);
      }
      situation.appendChild(review);
    }

    if (w.choices.length > 0 && (c.allowRetry || ended)) {
      const controls = make(doc, "div", "os-scenario-controls");
      if (c.allowRetry) controls.appendChild(control(t("scenario.takeBack"), "os-nav-btn", () => back(1)));
      controls.appendChild(control(t("scenario.startAgain"), "os-nav-btn", () => back(w.choices.length)));
      situation.appendChild(controls);
    }
    panel.appendChild(situation);

    if (!editing) {
      root.scrollTop = 0;
      if (focus) focusTarget.focus();
      if (just && audible.length > 0) hooks.sound!.play(audible);
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => { if (root.scrollHeight > root.clientHeight + 1) root.tabIndex = 0; });
    }
  };

  const tell = (before: number[]): void => {
    const message = describeMeterChanges(c.meters, before, meterValues(c.meters, hooks.value));
    if (message) hooks.announce?.(message);
  };

  const pick = (index: number): void => {
    const move = choose(c, path, index);
    if (!move) return;
    const w = walk(c, path)!;
    const choice = w.nodes[w.nodes.length - 1]!.choices[index]!;
    const before = meterValues(c.meters, hooks.value);
    hooks.onMove?.(move);
    path = move.path;
    showMeters();
    render(choice, true);
    tell(before);
  };

  const back = (steps: number): void => {
    const move = undo(c, path, steps);
    if (!move) return;
    const before = meterValues(c.meters, hooks.value);
    hooks.onMove?.(move);
    path = move.path;
    showMeters();
    render(null, true);
    tell(before);
  };

  showMeters();
  render(null, false);
  return {
    el: root,
    refresh: () => {
      showMeters();
      for (const r of refreshers) r();
    },
  };
}
