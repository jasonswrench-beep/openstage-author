// What was made for a step, and how a lesson is brought up to date without losing what the author changed.
//
// When the Capture module makes a slide from a step it records, in the slide's provenance (`base`, format 0.27.0), the slide's name, the picture it was made with, and for each
// part it made (the words, the picture, the frame, a message in a layer: its "role") the object's id, its layer, and a fingerprint of each field of the object as made.
// Later, when a step has changed, the slide is made again in memory from the new step, with the same ids for the same parts, and each field of each part is compared three ways:
//
//   the field as it was made (the fingerprint in `base`), the field as it is now (the author may have changed it), and the field as it would be made now.
//
// - If making it now gives the same field as before, the step's change does not touch it: it is left as it is, whether or not the author changed it.
// - If it would change, and the author has not touched that field, it is replaced. (So the author's own description of a picture does not stop a new picture being used.)
// - If it would change, and the author has changed that field, the author's stays, and the slide is reported as having something kept.
// - A part the author deleted stays deleted. A part the author added is never touched. A part that is no longer made is taken away only if the author never changed it.
//
// Nothing here uses a screen or the shell. The fingerprints leave out what is not the author's design (the editor's own `locked` and `group`, rule ids, and everything of a
// narration but its words, so choosing another voice for it is not "changing the words").

import type { CaptureBase, CaptureProvenance, Layer, OSObject, Slide } from "../../player/src/types.ts";
import { fingerprint } from "./pptx/hash.ts";

/** The fields of an object that are the author's design, and so are compared. */
export const FIELDS = ["name", "geometry", "content", "style", "accessibility", "states", "triggers", "timing", "animation", "narration"] as const;
export type Field = (typeof FIELDS)[number];

/** What of a field counts when asking whether the author changed it. */
function fieldValue(o: OSObject, field: Field): unknown {
  if (field === "narration") return o.narration !== null && typeof o.narration === "object" ? { script: (o.narration as { script?: unknown }).script ?? "" } : null;
  if (field === "triggers") return o.triggers.map((t) => ({ event: t.event, action: t.action, target: t.target, value: t.value, operation: t.operation, conditions: t.conditions }));
  return o[field];
}

/** A fingerprint of each field of an object. */
export function fieldHashes(o: OSObject): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of FIELDS) out[f] = fingerprint(fieldValue(o, f));
  return out;
}

/** A fingerprint of the whole of an object's design. */
export const hashObject = (o: OSObject): string => fingerprint(fieldHashes(o));

const sameFields = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean => FIELDS.every((f) => a[f] === b[f]);

/** Every object of a slide, by id, with the layer it is on. */
export function locate(slide: Slide): Map<string, { obj: OSObject; layer: Layer }> {
  const found = new Map<string, { obj: OSObject; layer: Layer }>();
  for (const layer of [slide.baseLayer, ...slide.layers]) for (const obj of layer.objects) found.set(obj.id, { obj, layer });
  return found;
}

export type BasePicture = NonNullable<CaptureBase["picture"]>;

/** The record of a slide just made: its name, its picture, and each part's id, layer and fingerprint. */
export function baseOf(slide: Slide, roles: Readonly<Record<string, string>>, picture: BasePicture | null): CaptureBase {
  const at = locate(slide);
  const objects: CaptureBase["objects"] = {};
  for (const [role, id] of Object.entries(roles)) {
    const hit = at.get(id);
    if (hit !== undefined) objects[role] = { id, layer: hit.layer.id, fields: fieldHashes(hit.obj) };
  }
  return { name: slide.name, picture, objects };
}

/** The base a slide carries, if it has one. */
export function baseFrom(slide: Slide): CaptureBase | null {
  const p = slide.provenance as CaptureProvenance | null | undefined;
  return p !== null && p !== undefined && "sourceCapture" in p && p.base !== undefined ? p.base : null;
}

/** Whether a slide is exactly as it was made: every part there and unchanged, nothing added, nothing set on the slide itself. Only then may it be removed for the author. */
export function untouched(current: Slide, base: CaptureBase): boolean {
  const at = locate(current);
  const roles = Object.values(base.objects);
  if (at.size !== roles.length) return false;
  if (current.duration !== null || current.background !== null || current.layout !== null || current.name !== base.name) return false;
  return roles.every((r) => { const hit = at.get(r.id); return hit !== undefined && sameFields(fieldHashes(hit.obj), r.fields); });
}

export interface Merge {
  slide: Slide;
  base: CaptureBase;
  /** Parts made again because the step changed them and the author had not. */
  replaced: string[];
  /** Parts the step now has that the slide did not. */
  added: string[];
  /** Parts the step no longer has, taken away because the author had not changed them. */
  removed: string[];
  /** Parts the step's change would touch but the author had changed (or taken away on purpose): the author's stay. */
  kept: string[];
  renamed: boolean;
  changed: boolean;
}

const clone = <T,>(v: T): T => structuredClone(v);

/**
 * Bring one slide up to date. `fresh` is the slide as it would be made now, made with the ids the slide's parts already have (`freshRoles` lists every part and its id).
 * Returns a new slide (the first is not changed) and the new record to keep.
 */
export function mergeSlide(current: Slide, base: CaptureBase, fresh: Slide, freshRoles: Readonly<Record<string, string>>, freshPicture: BasePicture | null): Merge {
  const next = clone(current);
  const nextAt = (): Map<string, { obj: OSObject; layer: Layer }> => locate(next);
  const freshAt = locate(fresh);
  const replaced: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const kept: string[] = [];

  const roles = new Set([...Object.keys(base.objects), ...Object.keys(freshRoles)]);
  for (const role of roles) {
    const was = base.objects[role];
    const freshId = freshRoles[role];
    const made = freshId === undefined ? undefined : freshAt.get(freshId);
    const now = was === undefined ? undefined : nextAt().get(was.id);

    if (was === undefined) {
      // A part the slide never had: add it, on its layer (made if need be).
      if (made === undefined) continue;
      let layer = [next.baseLayer, ...next.layers].find((l) => l.id === made.layer.id);
      if (layer === undefined) {
        layer = { id: made.layer.id, name: made.layer.name, objects: [] };
        next.layers.push(layer);
      }
      layer.objects.push(clone(made.obj));
      added.push(role);
      continue;
    }
    if (made === undefined) {
      // A part the step no longer has: away if the author never changed it.
      if (now === undefined) continue;
      if (sameFields(fieldHashes(now.obj), was.fields)) {
        now.layer.objects.splice(now.layer.objects.indexOf(now.obj), 1);
        removed.push(role);
      } else kept.push(role);
      continue;
    }
    // The step's part, field by field: a field the step would change is taken, unless the author changed that field themselves.
    if (now === undefined) {
      // The author deleted it. It stays deleted, and the author is told if the step would have changed it.
      if (!sameFields(fieldHashes(made.obj), was.fields)) kept.push(role);
      continue;
    }
    const fresh = fieldHashes(made.obj);
    const mine = fieldHashes(now.obj);
    const take: Field[] = [];
    let conflict = false;
    for (const f of FIELDS) {
      if (fresh[f] === was.fields[f]) continue;
      if (mine[f] === was.fields[f]) take.push(f);
      else conflict = true;
    }
    if (take.length > 0) {
      const replacement = clone(now.obj) as unknown as Record<string, unknown>;
      for (const f of take) {
        const value = clone((made.obj as unknown as Record<string, unknown>)[f]);
        // Choosing another voice, speed or language for the narration is not changing its words: those settings stay, the words are the step's.
        const had = now.obj.narration as { script?: string } | null;
        const will = made.obj.narration as { script?: string } | null;
        replacement[f] = f === "narration" && had !== null && typeof had === "object" && will !== null && typeof will === "object" ? { ...had, script: will.script } : value;
      }
      now.layer.objects[now.layer.objects.indexOf(now.obj)] = replacement as unknown as OSObject;
      replaced.push(role);
    }
    if (conflict) kept.push(role);
  }

  // A layer that was made for the slide and is empty now (and that the author put nothing in) goes.
  const madeLayers = new Set(Object.values(base.objects).map((o) => o.layer).filter((id) => id !== next.baseLayer.id));
  next.layers = next.layers.filter((l) => !(madeLayers.has(l.id) && l.objects.length === 0));

  let renamed = false;
  if (current.name === base.name && fresh.name !== base.name) {
    next.name = fresh.name;
    renamed = true;
  }

  const objects: CaptureBase["objects"] = {};
  for (const [role, id] of Object.entries(freshRoles)) {
    const hit = freshAt.get(id);
    if (hit !== undefined) objects[role] = { id, layer: hit.layer.id, fields: fieldHashes(hit.obj) };
  }
  return {
    slide: next, base: { name: fresh.name, picture: freshPicture, objects },
    replaced, added, removed, kept, renamed, changed: replaced.length + added.length + removed.length > 0 || renamed,
  };
}
