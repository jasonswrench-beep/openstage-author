// Slide sets in the editor: slides handed to someone else as one file, and taken in from one (docs/slide-sets.md). tools/slideset.py decides what a good set is and does the
// reading and the making; the shell passes its answer on as JSON. This file is the editor's side with no window in it: what the answer looks like, and how the slides of a set are
// made into slides of THIS course, which means giving them ids nobody else is using, new variables of their own, pictures under the names they were copied to, and texts that show
// a variable the name it now has. It is tested alone (slidesets.test.ts). The dialogs are in setdialog.ts and the one undo step is Model.addSlideSet.

import type { Character, CreditEntry, OSObject, Slide, Variable } from "../../player/src/types.ts";
import { renameReferences } from "./values.ts";

export interface SetInfo {
  id: string;
  title: string;
  description: string;
  author: string;
  licence: string;
  created: string;
  schemaVersion: string;
  stage: { width: number; height: number };
  /** "last" if the slides need the course to count as complete when the learner reaches the last slide (a game does). */
  completion: "last" | null;
}

/** What the shell says about a set it has read and unpacked. */
export interface SetRead {
  /** The folder it was unpacked into, to ask the shell for its files by. */
  stage: string;
  set: SetInfo;
  slides: Slide[];
  variables: Variable[];
  characters: Character[];
  assets: { path: string; bytes: number }[];
  credits: CreditEntry[];
  /** The set was made in an older format and has been brought up to date. */
  migrated: boolean;
  /** Things to look at (colours that may not suit this course's theme, say). */
  notes: string[];
}

/** What the shell says after making a set. */
export interface SetMade {
  set: SetInfo;
  slides: number;
  assets: number;
  /** Ways to a slide that is not in the set, which were left out. */
  dropped: number;
  bytes: number;
}

export type SetAnswer<T> = { ok: true; value: T } | { ok: false; message: string };

const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const text = (v: unknown, otherwise = ""): string => (typeof v === "string" ? v : otherwise);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function parseInfo(raw: unknown): SetInfo {
  const s = record(raw);
  const stage = record(s["stage"]);
  return {
    id: text(s["id"]), title: text(s["title"]), description: text(s["description"]), author: text(s["author"]), licence: text(s["licence"]), created: text(s["created"]),
    schemaVersion: text(s["schemaVersion"]), stage: { width: Number(stage["width"]) || 1280, height: Number(stage["height"]) || 720 }, completion: s["completion"] === "last" ? "last" : null,
  };
}

/** The shell's JSON after reading a set, as something the editor can use. A refusal carries its words. */
export function parseSetRead(raw: string): SetAnswer<SetRead> {
  try {
    const d = record(JSON.parse(raw));
    if (d["ok"] !== true) return { ok: false, message: text(d["message"], "That set could not be used.") };
    const slides = list(d["slides"]) as Slide[];
    if (slides.length === 0) return { ok: false, message: "That set has no slides." };
    return {
      ok: true,
      value: {
        stage: text(d["stage"]),
        set: parseInfo(d["set"]),
        slides,
        variables: list(d["variables"]) as Variable[],
        characters: list(d["characters"]) as Character[],
        assets: list(d["assets"]).map((a) => ({ path: text(record(a)["path"]), bytes: Number(record(a)["bytes"]) || 0 })).filter((a) => a.path !== ""),
        credits: list(d["credits"]) as CreditEntry[],
        migrated: d["migrated"] === true,
        notes: list(d["notes"]).map((n) => text(n)).filter((n) => n !== ""),
      },
    };
  } catch {
    return { ok: false, message: "The answer could not be read." };
  }
}

/** The shell's JSON after making a set. */
export function parseSetMade(raw: string): SetAnswer<SetMade> {
  try {
    const d = record(JSON.parse(raw));
    if (d["ok"] !== true) return { ok: false, message: text(d["message"], "That set could not be made.") };
    return { ok: true, value: { set: parseInfo(d["set"]), slides: list(d["slides"]).length, assets: list(d["assets"]).length, dropped: Number(d["dropped"]) || 0, bytes: Number(d["bytes"]) || 0 } };
  } catch {
    return { ok: false, message: "The answer could not be read." };
  }
}

/** A size in words: "340 KB", "12 MB". */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

/** What a set holds, in words, for the dialog that asks whether to add it. */
export function describeSet(read: SetRead): string {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const bytes = read.assets.reduce((sum, a) => sum + a.bytes, 0);
  const parts = [n(read.slides.length, "slide", "slides")];
  if (read.variables.length > 0) parts.push(n(read.variables.length, "variable", "variables"));
  if (read.characters.length > 0) parts.push(n(read.characters.length, "person", "people"));
  if (read.assets.length > 0) parts.push(`${n(read.assets.length, "file", "files")} (${sizeWords(bytes)})`);
  return parts.join(", ");
}

// ---- making the slides of a set the slides of this course

export interface ImportIds {
  /** An id for a slide, an object and a variable that nothing in the course uses (each call gives a new one). */
  slide(): string;
  object(): string;
  /** Make a variable and return its new id. A name that is taken gets a number added, which `nameOf` then says. */
  variable(type: Variable["type"], name: string, initial: Variable["initial"]): string;
  nameOf(variableId: string): string;
}

export interface Imported {
  slides: Slide[];
  characters: Character[];
  credits: CreditEntry[];
  /** How the course now names each variable of the set, for those whose name had to change. */
  renamed: [string, string][];
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every quoted string in some JSON that is exactly one of the keys, written as its value instead. Ids and file paths are whole strings, so this changes nothing else. */
function replaceWholeStrings<T>(value: T, map: ReadonlyMap<string, string>): T {
  if (map.size === 0) return value;
  const keys = [...map.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`"(${keys.map((k) => escapeRegex(JSON.stringify(k).slice(1, -1))).join("|")})"`, "g");
  const unquote = (s: string): string => JSON.parse(`"${s}"`) as string;
  return JSON.parse(JSON.stringify(value).replace(pattern, (_whole, k: string) => JSON.stringify(map.get(unquote(k))!))) as T;
}

/**
 * The slides of a set as slides of this course. Every slide gets a new id, every object a new id (object ids are unique in a course), and every variable of the set
 * becomes a new variable of its own, so a game brought in twice does not share what it remembers with the first. Rules, conditions, scenarios, timing and texts that follow
 * an id or a file name follow the new ones. A text that shows a variable (`{{Name}}`) is written with the name the variable has here. `pictures` maps each file path in the set
 * to where it was copied to in this course.
 */
export function importSlides(read: SetRead, ids: ImportIds, pictures: ReadonlyMap<string, string>): Imported {
  const slideMap = new Map(read.slides.map((s) => [s.id, ids.slide()]));
  const variableMap = new Map<string, string>();
  const renamed: [string, string][] = [];
  for (const v of read.variables) {
    const made = ids.variable(v.type, v.name, v.initial);
    variableMap.set(v.id, made);
    const now = ids.nameOf(made);
    if (now !== v.name) renamed.push([v.name, now]);
  }
  const objectMap = new Map<string, string>();
  for (const slide of read.slides) for (const layer of [slide.baseLayer, ...slide.layers]) for (const o of layer.objects) objectMap.set(o.id, ids.object());

  const idMap = new Map<string, string>();
  for (const [from, to] of [...slideMap, ...variableMap, ...objectMap]) {
    if (idMap.has(from) && idMap.get(from) !== to) throw new Error(`The set uses the id ${from} for two different things.`);
    idMap.set(from, to);
  }
  const everything = new Map([...idMap, ...pictures]);

  let slides = replaceWholeStrings(read.slides, everything);
  // A text shows a variable by its name, so a name that changed is written again, in two steps so that two names that swap places do not run into each other.
  if (renamed.length > 0) {
    const step = (from: string[], to: string[], html: string): string => from.reduce((h, f, i) => renameReferences(h, f, to[i]!), html);
    const old = renamed.map(([from]) => from);
    const holding = renamed.map((_, i) => `__set_name_${i}__`);
    slides = slides.map((slide) => {
      for (const layer of [slide.baseLayer, ...slide.layers]) {
        for (const o of layer.objects) {
          if (o.type !== "text" || typeof o.content["html"] !== "string") continue;
          const html = step(holding, renamed.map(([, now]) => now), step(old, holding, o.content["html"]));
          if (html !== o.content["html"]) o.content = { ...o.content, html };
        }
      }
      return slide;
    });
  }
  for (const slide of slides) for (const layer of [slide.baseLayer, ...slide.layers]) for (const o of layer.objects) (o as OSObject).provenance = null;
  const characters = replaceWholeStrings(read.characters, pictures);
  const credits = read.credits.map((c) => ({ ...c, path: pictures.get(c.path) ?? c.path }));
  return { slides, characters, credits, renamed };
}

/** What stops a set's people being added: someone with the same id as one the course has, who is not the same person. Returns words, or null if all is well. */
export function peopleProblem(read: SetRead, cast: readonly Character[]): string | null {
  for (const c of read.characters) {
    const have = cast.find((x) => x.id === c.id);
    if (have && have.name.trim().toLowerCase() !== c.name.trim().toLowerCase()) {
      return `This set has a person called ${c.name} (with the id "${c.id}"), and the course already has a different person, ${have.name}, with that id. Change one of them in the Characters dialog, then add the set again.`;
    }
  }
  return null;
}
