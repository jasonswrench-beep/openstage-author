// Copying objects: what has to change in a copy so it is its own object and not a second name for the first.
//
// A copy needs its own id, and its own ids for the rules on it. An input saves to variables, and a copy that saved to the same ones
// would overwrite the original's answers, so it gets new ones. A quiz question shows feedback layers that belong to it, so it gets
// layers of its own. A rule that points at something on the slide it came from (a layer, a video, an object's state) can only be
// kept if the copy is going to a slide that has that thing; otherwise the rule is dropped, and the author is told how many.
//
// This file has no screen and no project in it, so all of it can be tested directly. The model supplies the context.

import type { InputContent, Layer, OSObject, QuizContent, Trigger, Variable } from "../../player/src/types.ts";

export interface CloneContext {
  newObjectId(): string;
  newLayerId(): string;
  newTriggerId(): string;
  /** An id for a group of copies: one no other group in the project uses. */
  newGroupId(): string;
  /** Make a variable in the project and return its id. */
  newVariable(type: Variable["type"], base: string): string;
  variableOf(id: string): Variable | undefined;
  /** What a rule on a copy may still point at: the layers and the objects of the slide the copy is going to. */
  layerIds: Set<string>;
  objectIds: Set<string>;
  /** Keep a locked object locked in its copy. A copy made to work on starts unlocked; a copy of a whole slide or layer is meant to be the same. */
  keepLocks?: boolean;
  /** Layers that are already copied, by old id and new id, so a rule that points at one follows to its copy. */
  layerMap?: Map<string, string>;
}

export interface Cloned {
  objects: OSObject[];
  /** New layers: the feedback layers of any quiz question that was copied. They belong on the slide the copy is going to. */
  layers: Layer[];
  /** Rules left off because they pointed at something the copy cannot reach. */
  droppedRules: number;
  /** Inputs that were given variables of their own. */
  newVariables: number;
  /** Copies that were not put in a group, because only part of the group they came from was copied. */
  leftGroup: number;
  /** Copies that followed a video or audio clip that did not come with them, so they now appear a set time after the slide opens. */
  timingsReset: number;
}

const deep = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** "Title" becomes "Title copy", then "Title copy 2", and so on, never matching a name in `taken`. */
export function copyName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  const base = name.replace(/ copy( \d+)?$/i, "");
  let candidate = `${base} copy`;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} copy ${n}`;
  return candidate;
}

/**
 * Copies of a whole group are a group of their own, with a new id, so changing the copy never touches the original. A copy of only some
 * of a group's objects is not grouped, because a group needs two or more. Returns how many copies were left out of a group.
 */
function regroup(copies: OSObject[], newGroupId: () => string): number {
  const count = new Map<string, number>();
  for (const o of copies) if (o.group) count.set(o.group, (count.get(o.group) ?? 0) + 1);
  const made = new Map<string, string>();
  let left = 0;
  for (const o of copies) {
    if (!o.group) continue;
    if ((count.get(o.group) ?? 0) < 2) {
      delete o.group;
      left++;
      continue;
    }
    if (!made.has(o.group)) made.set(o.group, newGroupId());
    o.group = made.get(o.group)!;
  }
  return left;
}

/** The variables an input saves to, wherever it keeps them. */
function variableSlots(c: InputContent): { holder: { variable?: string }; }[] {
  const slots: { holder: { variable?: string } }[] = [];
  if (c.variable) slots.push({ holder: c as { variable?: string } });
  for (const part of [...(c.items ?? []), ...(c.rows ?? [])]) if (part.variable) slots.push({ holder: part as { variable?: string } });
  return slots;
}

/**
 * Copy objects (and, for quiz questions, their feedback layers). The sources are not changed. The copies keep their sources' names
 * and places: the caller renames them and moves them.
 */
export function cloneObjects(sources: OSObject[], feedbackLayers: Layer[], ctx: CloneContext): Cloned {
  const idMap = new Map<string, string>();
  const layerMap = new Map<string, string>(ctx.layerMap ?? []);
  for (const s of sources) idMap.set(s.id, ctx.newObjectId());

  // An input saves to variables, and a copy that saved to the same ones would overwrite the original's answers, so its copy gets new ones.
  // Rules on the copies that read or set those variables follow to the new ones, so the copies stay consistent with each other.
  const variableMap = new Map<string, string>();
  const claimVariables = (o: OSObject): void => {
    if (o.type !== "input") return;
    for (const { holder } of variableSlots(o.content as unknown as InputContent)) {
      const old = ctx.variableOf(holder.variable!);
      if (old && !variableMap.has(old.id)) variableMap.set(old.id, ctx.newVariable(old.type, old.name));
    }
  };
  for (const s of sources) claimVariables(s);

  // Give each quiz question its own pair of feedback layers, before any rule is read, so a rule on a feedback object can find its layer.
  const feedbackOf = (o: OSObject): Layer[] => {
    if (o.type !== "quizQuestion") return [];
    const f = (o.content as unknown as QuizContent).feedback;
    return [f.correct, f.incorrect].map((id) => feedbackLayers.find((l) => l.id === id)).filter((l): l is Layer => !!l);
  };
  for (const s of sources) {
    for (const layer of feedbackOf(s)) {
      if (layerMap.has(layer.id)) continue;
      layerMap.set(layer.id, ctx.newLayerId());
      for (const inner of layer.objects) {
        idMap.set(inner.id, ctx.newObjectId());
        claimVariables(inner);
      }
    }
  }

  // A button's rule is stored as two triggers, one for the mouse and one for the keyboard, so rules are counted as the author sees them.
  const dropped = new Set<string>();

  const target = (t: Trigger): string | null => {
    switch (t.action) {
      case "jumpToSlide":
        return t.target;
      // The course's own movement has no target, so a copy keeps it as it is: a Next button still goes to the next slide after the copy.
      case "nextSlide":
      case "previousSlide":
      case "replaySlide":
        return "";
      case "setVariable":
        return variableMap.get(t.target) ?? t.target;
      case "showLayer":
      case "hideLayer":
        return layerMap.get(t.target) ?? (ctx.layerIds.has(t.target) ? t.target : null);
      default:
        return idMap.get(t.target) ?? (ctx.objectIds.has(t.target) ? t.target : null);
    }
  };

  let timingsReset = 0;
  const copyOne = (source: OSObject): OSObject => {
    const o = deep(source);
    o.id = idMap.get(source.id)!;
    // A copy starts unlocked: it is a new object, and the author copied it to do something with it. A copy of a whole slide or layer
    // is meant to be the same, so it keeps its locks.
    if (!ctx.keepLocks) delete o.locked;
    // A copy is the author's own, not the imported shape or recorded step it came from, so a changed source will not reach it. Two
    // objects claiming the same source would also leave a re-sync not knowing which to update.
    o.provenance = null;
    o.triggers = o.triggers.flatMap((t) => {
      const to = target(t);
      if (to === null) { dropped.add(`${t.action}|${t.target}|${JSON.stringify(t.value ?? null)}|${JSON.stringify(t.conditions)}`); return []; }
      return [{ ...t, id: ctx.newTriggerId(), target: to, conditions: t.conditions.map((c) => ({ ...c, variable: variableMap.get(c.variable) ?? c.variable })) }];
    });
    if (o.type === "input") {
      const c = o.content as unknown as InputContent;
      for (const { holder } of variableSlots(c)) {
        const made = variableMap.get(holder.variable!);
        if (made) holder.variable = made;
      }
    }
    // An object timed to a video or audio clip keeps following it when the clip is copied with it, or is on the slide the copy goes to.
    // Otherwise there is nothing for it to follow, and it would be left hidden, so it goes back to appearing when the slide opens.
    if (o.timing.appear === "media") {
      const clip = o.timing.media ?? "";
      const to = idMap.get(clip) ?? (ctx.objectIds.has(clip) ? clip : null);
      if (to) o.timing = { ...o.timing, media: to };
      else { o.timing = { appear: "time", start: 0, visibleFor: null }; timingsReset++; }
    }
    return o;
  };

  const layers: Layer[] = [];
  const objects = sources.map((s) => {
    const copy = copyOne(s);
    if (copy.type === "quizQuestion") {
      const c = copy.content as unknown as QuizContent;
      const names: Record<"correct" | "incorrect", string> = { correct: c.feedback.correct, incorrect: c.feedback.incorrect };
      for (const which of ["correct", "incorrect"] as const) {
        const layer = feedbackLayers.find((l) => l.id === names[which]);
        const to = layer ? layerMap.get(layer.id) : undefined;
        if (!layer || !to) continue; // a missing layer is left as it was: the validator reports that
        const inner = layer.objects.map((o) => copyOne(o));
        // A feedback layer is copied whole, so its groups are copied whole, and each is a group of its own.
        regroup(inner, ctx.newGroupId);
        layers.push({ id: to, name: layer.name, objects: inner });
        c.feedback = { ...c.feedback, [which]: to };
      }
    }
    return copy;
  });
  const leftGroup = regroup(objects, ctx.newGroupId);
  return { objects, layers, droppedRules: dropped.size, newVariables: variableMap.size, leftGroup, timingsReset };
}
