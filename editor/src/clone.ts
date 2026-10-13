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
  /** Make a variable in the project and return its id. */
  newVariable(type: Variable["type"], base: string): string;
  variableOf(id: string): Variable | undefined;
  /** What a rule on a copy may still point at: the layers and the objects of the slide the copy is going to. */
  layerIds: Set<string>;
  objectIds: Set<string>;
}

export interface Cloned {
  objects: OSObject[];
  /** New layers: the feedback layers of any quiz question that was copied. They belong on the slide the copy is going to. */
  layers: Layer[];
  /** Rules left off because they pointed at something the copy cannot reach. */
  droppedRules: number;
  /** Inputs that were given variables of their own. */
  newVariables: number;
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
  const layerMap = new Map<string, string>();
  for (const s of sources) idMap.set(s.id, ctx.newObjectId());

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
      for (const inner of layer.objects) idMap.set(inner.id, ctx.newObjectId());
    }
  }

  // A button's rule is stored as two triggers, one for the mouse and one for the keyboard, so rules are counted as the author sees them.
  const dropped = new Set<string>();
  let newVariables = 0;

  const target = (t: Trigger): string | null => {
    switch (t.action) {
      case "jumpToSlide":
      case "setVariable":
        return t.target;
      case "showLayer":
      case "hideLayer":
        return layerMap.get(t.target) ?? (ctx.layerIds.has(t.target) ? t.target : null);
      default:
        return idMap.get(t.target) ?? (ctx.objectIds.has(t.target) ? t.target : null);
    }
  };

  const copyOne = (source: OSObject): OSObject => {
    const o = deep(source);
    o.id = idMap.get(source.id)!;
    // A copy starts unlocked: it is a new object, and the author copied it to do something with it.
    delete o.locked;
    o.triggers = o.triggers.flatMap((t) => {
      const to = target(t);
      if (to === null) { dropped.add(`${t.action}|${t.target}|${JSON.stringify(t.value ?? null)}|${JSON.stringify(t.conditions)}`); return []; }
      return [{ ...t, id: ctx.newTriggerId(), target: to }];
    });
    if (o.type === "input") {
      const c = o.content as unknown as InputContent;
      for (const { holder } of variableSlots(c)) {
        const old = ctx.variableOf(holder.variable!);
        if (!old) continue;
        holder.variable = ctx.newVariable(old.type, old.name);
        newVariables++;
      }
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
        layers.push({ id: to, name: layer.name, objects: layer.objects.map((inner) => copyOne(inner)) });
        c.feedback = { ...c.feedback, [which]: to };
      }
    }
    return copy;
  });
  return { objects, layers, droppedRules: dropped.size, newVariables };
}
