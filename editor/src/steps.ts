// Steps: what a recording shows, one step at a time, ready to become slides (Capture's Phase 7, story E1).
//
// When the author turned interaction recording on, the recorder kept a private log of what they did (events.jsonl: clicks, the name of what was
// clicked, keys, windows, the author's own markers). This module reads that log and proposes steps from it: a click, a stretch of typing, a key such
// as Enter or Ctrl+S, a change of program, a marker. The author then reviews them (change the words, merge, split, delete, move) and the review
// is kept as `steps.json` inside the recording. Nothing here uses a screen or the shell, so every rule is tested with Node alone.
//
// Two standing rules shape it. The words of a step and the description of its picture are PROPOSED from the log (a button's name, a window's
// title) and are the author's only once the author has checked the step: `reviewed` is that check, and the slides made later use a step's picture
// description only when it has been reviewed, so nothing the editor guessed is ever put in a course as if the author wrote it. And a step keeps its
// id for good (`step-4` is never reused), because the course remembers which step a slide came from (provenance, format 0.18.0) and can be brought
// up to date when the recording changes.

import type { Model as EditModel } from "../../capture-edit/src/model.ts";

// ---- the log

export interface Bounds { x: number; y: number; width: number; height: number }

export type LogEvent =
  | { t: number; type: "cursorMove"; x: number; y: number }
  | { t: number; type: "click"; x: number; y: number; button: string }
  | { t: number; type: "element"; name: string; role: string }
  | { t: number; type: "key"; key: string; modifiers: string[] }
  | { t: number; type: "window"; title: string; process: string; bounds?: Bounds }
  | { t: number; type: "marker"; label: string };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function readBounds(v: unknown): Bounds | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const b = v as Record<string, unknown>;
  return isNum(b["x"]) && isNum(b["y"]) && isNum(b["width"]) && isNum(b["height"]) ? { x: b["x"], y: b["y"], width: b["width"], height: b["height"] } : undefined;
}

/** The lines of an events.jsonl file that can be read, in order. A line that cannot (cut short by a crash, or of a kind this program does not know) is counted, not guessed at. */
export function parseLog(text: string): { events: LogEvent[]; skipped: number } {
  const events: LogEvent[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    const raw = line.trim();
    if (raw === "") continue;
    let o: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) { skipped++; continue; }
      o = parsed as Record<string, unknown>;
    } catch {
      skipped++;
      continue;
    }
    const t = o["t"];
    if (!isNum(t) || t < 0) { skipped++; continue; }
    switch (o["type"]) {
      case "cursorMove":
        if (isNum(o["x"]) && isNum(o["y"])) events.push({ t, type: "cursorMove", x: o["x"], y: o["y"] }); else skipped++;
        break;
      case "click":
        if (isNum(o["x"]) && isNum(o["y"])) events.push({ t, type: "click", x: o["x"], y: o["y"], button: isStr(o["button"]) ? o["button"] : "left" }); else skipped++;
        break;
      case "element":
        if (isStr(o["name"]) && isStr(o["role"])) events.push({ t, type: "element", name: o["name"], role: o["role"] }); else skipped++;
        break;
      case "key":
        if (isStr(o["key"])) events.push({ t, type: "key", key: o["key"], modifiers: Array.isArray(o["modifiers"]) ? o["modifiers"].filter(isStr) : [] }); else skipped++;
        break;
      case "window": {
        if (!isStr(o["title"]) || !isStr(o["process"])) { skipped++; break; }
        const bounds = readBounds(o["bounds"]);
        events.push(bounds ? { t, type: "window", title: o["title"], process: o["process"], bounds } : { t, type: "window", title: o["title"], process: o["process"] });
        break;
      }
      case "marker":
        if (isStr(o["label"])) events.push({ t, type: "marker", label: o["label"] }); else skipped++;
        break;
      default:
        skipped++;
    }
  }
  return { events, skipped };
}

// ---- steps

export type StepKind = "click" | "type" | "key" | "window" | "marker" | "manual";

export interface Step {
  /** `step-1`, `step-2`: never reused in a recording, so a slide can say which step it came from for good. */
  id: string;
  kind: StepKind;
  /** The take the step comes from, and the moment in it (milliseconds of that take's recording time) the action happened. */
  take: number;
  atMs: number;
  /** The moment in the take whose picture is the step's picture: just before a click, so the thing to click is still there. */
  shotMs: number;
  /** Where to click, in pixels of the picture, or null when the step has no place (a key, a change of program). */
  target: { x: number; y: number } | null;
  /** How big the picture is, when known (a recorded part of the screen says; for a whole screen the video says, later). */
  picture: { width: number; height: number } | null;
  /** The name and kind of what was clicked, from Windows, when it said. */
  element: { name: string; role: string } | null;
  /** The window in front. */
  window: { title: string; process: string } | null;
  /** For a typing step, what was typed. It is also in the words, and is the author's to check: it may be private. */
  typed: string | null;
  /** What the learner is told to do. Proposed from the log, changed freely by the author. */
  text: string;
  /** What the step's picture shows, for someone who cannot see it. Proposed, and used in a course only once the step is reviewed. */
  alt: string;
  /** The author has read the words and the picture description and says they are right. */
  reviewed: boolean;
  /** For a step made by merging: the steps it was made from, so the merge can be undone. */
  from?: Step[];
}

export interface StepList {
  format: "openstage-capture-steps";
  schemaVersion: "0.1.0";
  /** The number the next new step's id is made from. */
  nextId: number;
  steps: Step[];
}

export const STEPS_FORMAT = "openstage-capture-steps";
export const STEPS_SCHEMA = "0.1.0";

/** The most steps a recording may have. A course of more is not a lesson, and each step is a slide. */
export const MAX_STEPS = 200;

/** How long before a click its picture is taken, so the thing to click has not yet changed. */
export const SHOT_BEFORE_CLICK_MS = 250;
const SHOT_BEFORE_TYPING_MS = 150;
const SHOT_AFTER_WINDOW_MS = 600;

export function emptyList(): StepList {
  return { format: STEPS_FORMAT, schemaVersion: STEPS_SCHEMA, nextId: 1, steps: [] };
}

// ---- where the steps may come from

/** A stretch of a take that is kept in the edit. */
export interface KeepRange { take: number; startMs: number; endMs: number }

/** The stretches of takes that the edit's screen track keeps, in the takes' own time. Null if the edit has no screen track (then every moment counts). */
export function keepRangesOf(model: EditModel): KeepRange[] | null {
  const ranges: KeepRange[] = [];
  let any = false;
  for (const track of model.tracks) {
    if (track.kind !== "screen") continue;
    any = true;
    for (const clip of track.clips) if (clip.source.kind === "take") ranges.push({ take: clip.source.take, startMs: clip.sourceStartMs, endMs: clip.sourceEndMs });
  }
  return any ? ranges : null;
}

const kept = (take: number, t: number, ranges: readonly KeepRange[] | null): boolean => ranges === null || ranges.some((r) => r.take === take && t >= r.startMs && t < r.endMs);

// ---- the words

/** The text of a program's file name as a person would say it: `notepad.exe` is Notepad. */
export function programName(process: string): string {
  const stem = process.replace(/\.exe$/i, "").replace(/[_-]+/g, " ").trim();
  return stem === "" ? "another program" : stem.charAt(0).toUpperCase() + stem.slice(1);
}

const tidy = (s: string, max = 80): string => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
};

/** What a click is told to the learner as, from the name and kind of what was clicked. */
export function clickWords(element: { name: string; role: string } | null, button: string, double: boolean): string {
  const verb = double ? "Double-click" : button === "right" ? "Right-click" : "Click";
  if (element === null || tidy(element.name) === "") return `${verb} the highlighted spot.`;
  const name = tidy(element.name);
  const role = element.role.toLowerCase();
  if (verb === "Click") {
    if (role === "button" || role === "push button") return `Click the ${name} button.`;
    if (role === "menu item" || role === "menu") return `Choose ${name} from the menu.`;
    if (role === "link" || role === "hyperlink") return `Click the ${name} link.`;
    if (role === "edit" || role === "text box") return `Click in the ${name} box.`;
    if (role === "check box") return `Click the ${name} check box.`;
    if (role === "radio button") return `Choose ${name}.`;
    if (role === "tab item" || role === "tab") return `Open the ${name} tab.`;
    if (role === "combo box") return `Open the ${name} list.`;
    if (role === "list item" || role === "tree item") return `Choose ${name}.`;
  }
  return `${verb} ${name}.`;
}

/** What a step's picture shows, proposed from the log. It is proposed text: the author checks it. */
export function altFor(kind: StepKind, element: { name: string; role: string } | null, window: { title: string; process: string } | null): string {
  const where = window !== null && tidy(window.title) !== "" ? `${tidy(window.title)}` : window !== null ? programName(window.process) : "the screen";
  if (kind === "click") {
    const what = element !== null && tidy(element.name) !== "" ? `the ${tidy(element.name)} ${element.role.toLowerCase()}` : "the place to click";
    return `A screenshot of ${where}, with ${what} marked.`;
  }
  if (kind === "type") return `A screenshot of ${where}, before the words are typed.`;
  if (kind === "window") return `A screenshot of ${where}.`;
  return `A screenshot of ${where}.`;
}

const SHIFTED: Record<string, string> = {
  "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", "8": "*", "9": "(", "0": ")",
  minus: "_", equal: "+", equals: "+", "left-bracket": "{", "right-bracket": "}", backslash: "|", semicolon: ":", quote: '"', comma: "<", period: ">", slash: "?", backtick: "~",
};
const SYMBOLS: Record<string, string> = {
  space: " ", minus: "-", equal: "=", equals: "=", "left-bracket": "[", "right-bracket": "]", backslash: "\\", semicolon: ";", quote: "'", comma: ",", period: ".", dot: ".", slash: "/", backtick: "`",
};

/** The character a key press types on a US keyboard, or null if it types none (or this program does not know it). */
export function charOf(key: string, modifiers: readonly string[]): string | null {
  if (modifiers.some((m) => m === "ctrl" || m === "alt" || m === "win")) return null;
  const shift = modifiers.includes("shift");
  if (/^[a-z]$/.test(key)) return shift ? key.toUpperCase() : key;
  if (/^[0-9]$/.test(key)) return shift ? (SHIFTED[key] ?? null) : key;
  const pad = /^numpad-([0-9])$/.exec(key);
  if (pad) return pad[1] ?? null;
  if (shift && SHIFTED[key] !== undefined) return SHIFTED[key] ?? null;
  return SYMBOLS[key] ?? null;
}

/** How a key that is not typing is told to the learner: `Press Enter.`, `Press Ctrl+S.`; null for the arrows, Backspace and the like, which are editing noise. */
export function keyWords(key: string, modifiers: readonly string[]): string | null {
  const named: Record<string, string> = { enter: "Enter", tab: "Tab", escape: "Esc", delete: "Delete" };
  const shortcut = modifiers.some((m) => m === "ctrl" || m === "alt" || m === "win");
  let label: string | null = null;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) label = key.toUpperCase();
  else if (named[key] !== undefined && (!shortcut || key === "enter" || key === "tab")) label = named[key] ?? null;
  else if (shortcut) label = /^[a-z0-9]$/.test(key) ? key.toUpperCase() : SYMBOLS[key] === undefined ? null : key;
  if (label === null) return null;
  const mods = modifiers.filter((m) => m === "ctrl" || m === "alt" || m === "shift" || m === "win").map((m) => (m === "win" ? "Windows" : m.charAt(0).toUpperCase() + m.slice(1)));
  return `Press ${[...mods, label].join("+")}.`;
}

// ---- proposing steps

export interface ProposeOptions {
  take: number;
  /** The part of the picture the video shows, when less than the whole display (subtracted from the log's pixels). */
  region?: { x: number; y: number; width: number; height: number } | null;
  /** The stretches of this take the edit keeps, or null for all of it. */
  keep?: readonly KeepRange[] | null;
}

/** Clicks this close in time and place are one double-click. */
const DOUBLE_MS = 450;
const DOUBLE_PX = 8;
/** Typing that pauses this long is more than one step. */
const TYPING_GAP_MS = 3000;

type Draft = Omit<Step, "id">;

/**
 * Steps from one take's log: a click (with the name of what was clicked, when Windows said), a stretch of typing, a key such as Enter or Ctrl+S,
 * a change of program, a marker the author made. Moves of the cursor make no steps. A click made at once after another, close to it, is one
 * double-click. A step is only proposed for something in a part of the take the edit keeps.
 */
export function proposeFromLog(events: readonly LogEvent[], opts: ProposeOptions): Draft[] {
  const out: Draft[] = [];
  const region = opts.region ?? null;
  const picture = region === null ? null : { width: region.width, height: region.height };
  const ok = (t: number): boolean => kept(opts.take, t, opts.keep ?? null);
  let window: { title: string; process: string } | null = null;
  let lastClickAt = -1e9;
  let typing: { startMs: number; lastMs: number; text: string } | null = null;

  const closeTyping = (): void => {
    if (typing === null) return;
    const text = typing.text;
    if (text.trim() !== "" && ok(typing.startMs)) {
      out.push({
        kind: "type", take: opts.take, atMs: typing.startMs, shotMs: Math.max(0, typing.startMs - SHOT_BEFORE_TYPING_MS), target: null, picture,
        element: null, window, typed: text, text: `Type "${tidy(text, 120)}".`, alt: altFor("type", null, window), reviewed: false,
      });
    }
    typing = null;
  };

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === "window") {
      const next = { title: e.title, process: e.process };
      const changedProgram = window !== null && window.process !== e.process;
      if (changedProgram) closeTyping();
      // A program that opens because of a click is that click's doing; one that comes to the front on its own is a step.
      if (changedProgram && e.t - lastClickAt > 1500 && ok(e.t)) {
        out.push({
          kind: "window", take: opts.take, atMs: e.t, shotMs: e.t + SHOT_AFTER_WINDOW_MS, target: null, picture, element: null, window: next, typed: null,
          text: `Switch to ${programName(e.process)}.`, alt: altFor("window", null, next), reviewed: false,
        });
      }
      window = next;
      continue;
    }
    if (e.type === "marker") {
      closeTyping();
      if (ok(e.t) && e.label.trim() !== "") {
        out.push({ kind: "marker", take: opts.take, atMs: e.t, shotMs: e.t, target: null, picture, element: null, window, typed: null, text: tidy(e.label, 200), alt: altFor("marker", null, window), reviewed: false });
      }
      continue;
    }
    if (e.type === "click") {
      closeTyping();
      const button = e.button;
      if (button !== "left" && button !== "right") continue;
      const x = e.x - (region?.x ?? 0);
      const y = e.y - (region?.y ?? 0);
      const prev = out[out.length - 1];
      const double = prev !== undefined && prev.kind === "click" && prev.take === opts.take && e.t - prev.atMs <= DOUBLE_MS && prev.target !== null
        && Math.abs(prev.target.x - x) <= DOUBLE_PX && Math.abs(prev.target.y - y) <= DOUBLE_PX && button === "left" && !prev.text.startsWith("Double-click") && !prev.text.startsWith("Right-click");
      lastClickAt = e.t;
      // The name of what was clicked is written right after the click, with the same time.
      let element: { name: string; role: string } | null = null;
      for (let j = i + 1; j < events.length; j++) {
        const f = events[j]!;
        if (f.t !== e.t) break;
        if (f.type === "element") { element = { name: f.name, role: f.role }; break; }
      }
      if (double && prev !== undefined) {
        // The first click of the pair becomes the double-click; the second adds nothing.
        const el = prev.element ?? element;
        prev.element = el;
        prev.text = clickWords(el, button, true);
        prev.alt = altFor("click", el, prev.window);
        continue;
      }
      if (!ok(e.t)) continue;
      out.push({
        kind: "click", take: opts.take, atMs: e.t, shotMs: Math.max(0, e.t - SHOT_BEFORE_CLICK_MS), target: { x, y }, picture, element, window, typed: null,
        text: clickWords(element, button, false), alt: altFor("click", element, window), reviewed: false,
      });
      continue;
    }
    if (e.type === "key") {
      const ch = charOf(e.key, e.modifiers);
      if (ch !== null) {
        if (typing !== null && e.t - typing.lastMs > TYPING_GAP_MS) closeTyping();
        if (typing === null) typing = { startMs: e.t, lastMs: e.t, text: "" };
        typing.text += ch;
        typing.lastMs = e.t;
        continue;
      }
      if (e.key === "backspace" && e.modifiers.length === 0 && typing !== null) {
        typing.text = typing.text.slice(0, -1);
        typing.lastMs = e.t;
        continue;
      }
      const words = keyWords(e.key, e.modifiers);
      if (words !== null) {
        closeTyping();
        if (ok(e.t)) out.push({ kind: "key", take: opts.take, atMs: e.t, shotMs: Math.max(0, e.t - SHOT_BEFORE_CLICK_MS), target: null, picture, element: null, window, typed: null, text: words, alt: altFor("key", null, window), reviewed: false });
      }
    }
  }
  closeTyping();
  return out;
}

/** Number steps from a recording's takes in order: `steps` for each take, as `proposeFromLog` made them. Ids are new and never reused; at most `MAX_STEPS`. */
export function listFrom(perTake: readonly (readonly Draft[])[], start: StepList = emptyList()): { list: StepList; cut: number } {
  const steps = [...start.steps];
  let next = start.nextId;
  let cut = 0;
  for (const drafts of perTake) {
    for (const d of drafts) {
      if (steps.length >= MAX_STEPS) { cut++; continue; }
      steps.push({ ...d, id: `step-${next++}` });
    }
  }
  return { list: { ...start, nextId: next, steps }, cut };
}

// ---- what the author does with the list

const find = (list: StepList, id: string): number => list.steps.findIndex((s) => s.id === id);

function replaceSteps(list: StepList, steps: Step[], nextId = list.nextId): StepList {
  return { ...list, nextId, steps };
}

/** Change a step's words, picture description, picture moment or place. Whatever the author changes, the step is theirs to approve again only by their saying so. */
export function editStep(list: StepList, id: string, patch: { text?: string; alt?: string; shotMs?: number; target?: { x: number; y: number } | null; reviewed?: boolean }): StepList {
  const i = find(list, id);
  if (i < 0) return list;
  const s = list.steps[i]!;
  const next: Step = { ...s };
  if (patch.text !== undefined) next.text = patch.text.slice(0, 500);
  if (patch.alt !== undefined) next.alt = patch.alt.slice(0, 500);
  if (patch.shotMs !== undefined && Number.isFinite(patch.shotMs)) next.shotMs = Math.max(0, Math.round(patch.shotMs));
  if (patch.target !== undefined) next.target = patch.target;
  if (patch.reviewed !== undefined) next.reviewed = patch.reviewed;
  return replaceSteps(list, list.steps.map((x, k) => (k === i ? next : x)));
}

/** Move a step one place earlier (-1) or later (1). */
export function moveStep(list: StepList, id: string, by: -1 | 1): StepList {
  const i = find(list, id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.steps.length) return list;
  const steps = [...list.steps];
  [steps[i], steps[j]] = [steps[j]!, steps[i]!];
  return replaceSteps(list, steps);
}

export function deleteStep(list: StepList, id: string): StepList {
  const i = find(list, id);
  return i < 0 ? list : replaceSteps(list, list.steps.filter((_s, k) => k !== i));
}

/** Join a step and the one after it into one. It keeps the first's id, picture and place; the words are both, one after the other; it has to be checked again. */
export function mergeWithNext(list: StepList, id: string): StepList {
  const i = find(list, id);
  const a = list.steps[i];
  const b = list.steps[i + 1];
  if (i < 0 || a === undefined || b === undefined) return list;
  const merged: Step = {
    ...a,
    typed: a.typed !== null || b.typed !== null ? `${a.typed ?? ""}${b.typed ?? ""}` : null,
    text: `${a.text.trim()} ${b.text.trim()}`.trim().slice(0, 500),
    alt: a.alt,
    reviewed: false,
    from: [...(a.from ?? [{ ...a }]), ...(b.from ?? [{ ...b }])],
  };
  return replaceSteps(list, [...list.steps.slice(0, i), merged, ...list.steps.slice(i + 2)]);
}

/**
 * Undo a merge (the steps it was made from come back, with the words they had, and the first keeps its id), or, for a step that was not merged,
 * make two of it: a second step at the same moment and place, with no words, for the author to write.
 */
export function splitStep(list: StepList, id: string): StepList {
  const i = find(list, id);
  const s = list.steps[i];
  if (i < 0 || s === undefined) return list;
  if (s.from !== undefined && s.from.length >= 2) {
    const parts = s.from.map((p) => ({ ...p, reviewed: false }));
    // The first keeps the merged step's id, so a slide made from it still finds it. The others get new ones.
    let next = list.nextId;
    const restored = parts.map((p, k) => (k === 0 ? { ...p, id: s.id } : { ...p, id: `step-${next++}` }));
    return replaceSteps(list, [...list.steps.slice(0, i), ...restored, ...list.steps.slice(i + 1)], next);
  }
  if (list.steps.length >= MAX_STEPS) return list;
  const { from: _from, ...rest } = s;
  void _from;
  const second: Step = { ...rest, id: `step-${list.nextId}`, text: "", alt: rest.alt, typed: null, reviewed: false };
  return replaceSteps(list, [...list.steps.slice(0, i + 1), second, ...list.steps.slice(i + 1)], list.nextId + 1);
}

/** A step the author adds by hand, at a moment of a take (after the step with `after`, or at the end). */
export function addManual(list: StepList, opts: { take: number; atMs: number; after?: string }): StepList {
  if (list.steps.length >= MAX_STEPS) return list;
  const step: Step = {
    id: `step-${list.nextId}`, kind: "manual", take: opts.take, atMs: opts.atMs, shotMs: opts.atMs, target: null, picture: null, element: null, window: null, typed: null,
    text: "", alt: "", reviewed: false,
  };
  const at = opts.after === undefined ? list.steps.length : find(list, opts.after) + 1;
  const steps = [...list.steps.slice(0, at), step, ...list.steps.slice(at)];
  return replaceSteps(list, steps, list.nextId + 1);
}

// ---- checking

/** What still needs the author's attention, in words: a step with no words, one not reviewed. Never blocks saving. */
export function stepProblems(list: StepList): string[] {
  const out: string[] = [];
  list.steps.forEach((s, i) => {
    if (s.text.trim() === "") out.push(`Step ${i + 1} has no words yet.`);
    else if (!s.reviewed) out.push(`Step ${i + 1} has not been checked.`);
  });
  return out;
}

export const unreviewedCount = (list: StepList): number => list.steps.filter((s) => !s.reviewed).length;

// ---- saving and reading

export function serializeSteps(list: StepList): string {
  return `${JSON.stringify(list, null, 2)}\n`;
}

function readStep(v: unknown): Step | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const kinds: StepKind[] = ["click", "type", "key", "window", "marker", "manual"];
  if (!isStr(o["id"]) || !/^step-\d+$/.test(o["id"]) || !isStr(o["kind"]) || !kinds.includes(o["kind"] as StepKind)) return null;
  if (!isNum(o["take"]) || !isNum(o["atMs"]) || !isNum(o["shotMs"]) || !isStr(o["text"]) || !isStr(o["alt"])) return null;
  const point = (p: unknown): { x: number; y: number } | null => (typeof p === "object" && p !== null && isNum((p as Record<string, unknown>)["x"]) && isNum((p as Record<string, unknown>)["y"]) ? { x: (p as { x: number }).x, y: (p as { y: number }).y } : null);
  const size = (p: unknown): { width: number; height: number } | null => (typeof p === "object" && p !== null && isNum((p as Record<string, unknown>)["width"]) && isNum((p as Record<string, unknown>)["height"]) ? { width: (p as { width: number }).width, height: (p as { height: number }).height } : null);
  const el = (p: unknown): { name: string; role: string } | null => (typeof p === "object" && p !== null && isStr((p as Record<string, unknown>)["name"]) && isStr((p as Record<string, unknown>)["role"]) ? { name: (p as { name: string }).name, role: (p as { role: string }).role } : null);
  const win = (p: unknown): { title: string; process: string } | null => (typeof p === "object" && p !== null && isStr((p as Record<string, unknown>)["title"]) && isStr((p as Record<string, unknown>)["process"]) ? { title: (p as { title: string }).title, process: (p as { process: string }).process } : null);
  const from = Array.isArray(o["from"]) ? o["from"].map(readStep).filter((s): s is Step => s !== null) : [];
  const step: Step = {
    id: o["id"], kind: o["kind"] as StepKind, take: o["take"], atMs: o["atMs"], shotMs: o["shotMs"], target: point(o["target"]), picture: size(o["picture"]),
    element: el(o["element"]), window: win(o["window"]), typed: isStr(o["typed"]) ? o["typed"] : null, text: o["text"], alt: o["alt"], reviewed: o["reviewed"] === true,
  };
  return from.length >= 2 ? { ...step, from } : step;
}

/** A saved step list, or a reason in words that it cannot be used. */
export function parseSteps(text: string): { ok: true; list: StepList } | { ok: false; message: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, message: "The saved steps are not in a form that can be read." };
  }
  if (typeof data !== "object" || data === null) return { ok: false, message: "The saved steps are not in a form that can be read." };
  const o = data as Record<string, unknown>;
  if (o["format"] !== STEPS_FORMAT) return { ok: false, message: "That file is not a list of steps." };
  if (o["schemaVersion"] !== STEPS_SCHEMA) return { ok: false, message: `These steps were saved by a different version (${String(o["schemaVersion"])}), so they cannot be opened here.` };
  if (!Array.isArray(o["steps"]) || !isNum(o["nextId"])) return { ok: false, message: "The saved steps are not in a form that can be read." };
  const steps = o["steps"].map(readStep);
  if (steps.some((s) => s === null)) return { ok: false, message: "Some of the saved steps are not in a form that can be read." };
  const ok = steps as Step[];
  const highest = ok.reduce((n, s) => Math.max(n, Number(s.id.slice(5)), ...(s.from ?? []).map((p) => Number(p.id.slice(5)))), 0);
  return { ok: true, list: { format: STEPS_FORMAT, schemaVersion: STEPS_SCHEMA, nextId: Math.max(o["nextId"], highest + 1), steps: ok } };
}
