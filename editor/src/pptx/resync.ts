// Bringing a changed PowerPoint deck up to date. There are three versions of everything that was imported: the deck as it was when it was
// imported (the *base*, kept in each object's provenance), what the author has done to it since (*ours*), and the deck as it is now
// (*theirs*). A change the deck made to something the author never touched can simply come forward. A change to something the author
// also changed is a conflict, and is offered only if the author asks for their own change to be replaced. Things the author added
// (rules, narration, timing, layers, new objects) are never touched, which is why they survive. The deck's own animation (what appears and goes, and when) and its speaker
// notes (when they were made the narration) are compared the same way, against a record of what the import gave them (`base.animation` and `base.notes` of the slide).
//
// This file only works out what could change and applies what was chosen to the slides it is given. The model puts it in the project.

import type { DeckSource, ImportProvenance, OSObject, Slide, SlideImportProvenance } from "../../../player/src/types.ts";
import { animationFor, backgroundOf, convertSlide, draftsForSlide, newNotes, objectFrom, provenanceFor, scriptFromNotes, slideFrom, snapshotOf, type AnimRec, type Base, type Draft, type Tones } from "./convert.ts";
import { describeTiming } from "../timing.ts";
import { newNarration, type Narration } from "../narration.ts";
import type { Deck, DeckSlide } from "./deck.ts";
import { canonical } from "./hash.ts";
import { mediaPathFor, placementOf } from "./import.ts";
import type { Pkg } from "./package.ts";

// ---- what one property is called, for people

export type PropKind = "text" | "picture" | "table" | "shape" | "position" | "appearance" | "name" | "alt";

const KIND_WORDS: Record<PropKind, string> = {
  text: "text", picture: "picture", table: "table cells", shape: "form", position: "position and size", appearance: "appearance", name: "name", alt: "alt text",
};

export function kindOf(path: string): PropKind {
  if (path === "name") return "name";
  if (path === "altText" || path === "decorative") return "alt";
  if (path.startsWith("geometry.")) return "position";
  if (path.startsWith("style.")) return "appearance";
  if (path === "content.html") return "text";
  if (path === "content.src") return "picture";
  if (path === "content.shape") return "shape";
  if (path.startsWith("content.")) return "table";
  return "appearance";
}

export const wordsFor = (kinds: PropKind[]): string => [...new Set(kinds)].map((k) => KIND_WORDS[k]).join(", ");

// ---- comparing an object with its base

export interface PropChange {
  path: string;
  before: unknown;
  after: unknown;
}

const GEOMETRY = ["x", "y", "width", "height", "rotation"] as const;

/** Every simple property of an imported object as a path and a value, so two versions can be compared one property at a time. */
export function leavesOf(b: Base): Map<string, unknown> {
  const out = new Map<string, unknown>();
  out.set("type", b.type);
  out.set("name", b.name);
  for (const k of GEOMETRY) out.set(`geometry.${k}`, b.geometry[k]);
  for (const [k, v] of Object.entries(b.content)) out.set(`content.${k}`, v);
  for (const [k, v] of Object.entries(b.style)) out.set(`style.${k}`, v);
  out.set("altText", b.altText);
  out.set("decorative", b.decorative);
  return out;
}

const same = (a: unknown, b: unknown): boolean => canonical(a ?? null) === canonical(b ?? null);

export interface Merge {
  /** The deck changed it and the author did not: it can come forward. */
  takes: PropChange[];
  /** The deck and the author both changed it, differently. */
  conflicts: PropChange[];
  /** The deck did not change it. */
  unchanged: number;
}

/** Whether a text box's alt text is just its own words, as the import makes it. Then it is part of the words, not a separate thing to decide. */
export const altIsItsWords = (b: Base): boolean => b.type === "text" && b.altText === plainOf(b.content["html"]);

/** A three-way comparison of an imported object. `ours` is the object now, `theirs` is what the deck would make now. */
export function merge3(base: Base, ours: Base, theirs: Base): Merge {
  const b = leavesOf(base);
  const o = leavesOf(ours);
  const t = leavesOf(theirs);
  if (altIsItsWords(base) && ours.altText === base.altText) { b.delete("altText"); o.delete("altText"); t.delete("altText"); }
  const keys = [...new Set([...b.keys(), ...o.keys(), ...t.keys()])];
  const takes: PropChange[] = [];
  const conflicts: PropChange[] = [];
  let unchanged = 0;
  for (const path of keys) {
    const bv = b.get(path);
    const ov = o.get(path);
    const tv = t.get(path);
    if (same(tv, bv)) { unchanged += 1; continue; }
    if (same(ov, tv)) continue;
    if (same(ov, bv)) takes.push({ path, before: ov, after: tv });
    else conflicts.push({ path, before: ov, after: tv });
  }
  return { takes, conflicts, unchanged };
}

/** An object's words, without the tags, as one line: a paragraph, a list item or a line break is a space, and bold or a link is not. The same words the import makes the alt text from. */
export const plainOf = (html: unknown): string =>
  String(html ?? "")
    .replace(/<\/?(?:p|li|ul|ol|h[1-6]|br)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const brief = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}...` : s);

function describeChange(c: PropChange): string {
  const kind = kindOf(c.path);
  if (c.path === "content.html") return `Text: "${brief(plainOf(c.before))}" becomes "${brief(plainOf(c.after))}"`;
  if (c.path === "altText") return `Alt text: "${brief(String(c.before ?? ""))}" becomes "${brief(String(c.after ?? ""))}"`;
  if (kind === "position") return `${c.path.slice("geometry.".length)}: ${String(c.before)} becomes ${String(c.after)}`;
  if (kind === "picture") return "A different picture";
  if (kind === "table") return "Table cells";
  return `${KIND_WORDS[kind][0]!.toUpperCase()}${KIND_WORDS[kind].slice(1)}: ${brief(String(c.before ?? "none"))} becomes ${brief(String(c.after ?? "none"))}`;
}

// ---- reading the project

type Prov = ImportProvenance;

function provOf(o: OSObject, deckId: string): Prov | null {
  const p = o.provenance as unknown as Prov | null;
  return p && typeof p === "object" && p.sourceDeck === deckId && typeof p.shapeId === "string" ? p : null;
}

function slideProvOf(s: Slide, deckId: string): SlideImportProvenance | null {
  const p = s.provenance as unknown as SlideImportProvenance | null | undefined;
  return p && typeof p === "object" && "sourceDeck" in p && p.sourceDeck === deckId ? p : null;
}

const allObjects = (s: Slide): OSObject[] => [s.baseLayer, ...s.layers].flatMap((l) => l.objects);

/** Whether the author has put anything on an imported object that the deck does not know about, and that a removal would lose. */
export function authorAdded(o: OSObject): boolean {
  const plainTiming = o.timing.appear === "time" && o.timing.start === 0 && o.timing.visibleFor === null;
  const plainAnimation = o.animation.enter.effect === "none" && o.animation.exit.effect === "none";
  return o.triggers.length > 0 || o.narration !== null || Object.keys(o.states).length > 0 || !plainTiming || !plainAnimation;
}

// ---- the plan

export type Action =
  | { op: "newSlide"; deckSlide: DeckSlide; after: string | null; before: string | null }
  | { op: "removeSlide"; slideId: string }
  | { op: "slideField"; slideId: string; field: "name" | "background"; value: string | null }
  | { op: "newShape"; slideId: string; deckSlide: DeckSlide; key: string; hash: string; draft: Draft }
  | { op: "removeShape"; slideId: string; objectId: string }
  | { op: "changeShape"; slideId: string; objectId: string; changes: PropChange[]; theirs: Base; hash: string; conflict: boolean }
  /** The timing and animation of some objects of a slide, from the deck as it is now (null: the deck has none for it now). `theirsAll` is the deck's whole record for the slide. */
  | { op: "slideAnimation"; slideId: string; changes: AnimChange[]; theirsAll: Record<string, AnimRec>; conflict: boolean }
  /** What the speaker notes now say (an empty string: the notes are gone), for the object that says them. */
  | { op: "slideNotes"; slideId: string; objectId: string; key: string; script: string; conflict: boolean };

export interface AnimChange {
  objectId: string;
  key: string;
  name: string;
  after: AnimRec | null;
}

const STARTING: AnimRec = { timing: { appear: "time", start: 0, visibleFor: null }, animation: { enter: { effect: "none", duration: 500 }, exit: { effect: "none", duration: 500 } } };

/** An object's timing and animation, or null when it has none (always there, no effects): the same as the deck having no effect for it. */
const animOf = (o: OSObject): AnimRec | null => {
  const plain = o.timing.appear === "time" && o.timing.start === 0 && o.timing.visibleFor === null && o.timing.until === undefined && o.timing.paragraphs === undefined && o.animation.enter.effect === "none" && o.animation.exit.effect === "none";
  return plain ? null : { timing: o.timing, animation: o.animation };
};

/** How an object's timing and animation read in words, for the list of changes. */
const animWords = (a: AnimRec | null): string => {
  if (!a) return "always there, no effects";
  const effects = [a.animation.enter.effect !== "none" ? `comes in with ${a.animation.enter.effect}` : "", a.animation.exit.effect !== "none" ? `goes with ${a.animation.exit.effect}` : ""].filter(Boolean);
  return `${describeTiming(a.timing).replace(/\.$/, "")}${effects.length > 0 ? ` (${effects.join(", ")})` : ""}`;
};

export interface PlanItem {
  id: string;
  /** The name of the slide this belongs to, for grouping. */
  slide: string;
  label: string;
  detail: string[];
  /** Whether it is ticked to begin with. */
  checked: boolean;
  /** An item that replaces something the author changed. */
  replacesYours: boolean;
  /** An item that changes only the record of what the deck had (nothing shows), so the next comparison starts from the deck as it is. It is not offered, and is always applied. */
  quiet?: true;
  action: Action;
  assets: { path: string; bytes: Uint8Array }[];
}

export interface ResyncPlan {
  deckId: string;
  items: PlanItem[];
  /** How many shapes the deck did not change. */
  unchanged: number;
  /** The deck has its slides in another order than the course now does. */
  orderChanged: boolean;
  /** The deck's slides now, by the deck's own numbers. */
  seen: string[];
  /** Said when the file does not look like the deck that was imported. */
  warning: string | null;
}

export interface PlanRequest {
  source: DeckSource;
  slides: Slide[];
  deck: Deck;
  pkg: Pkg;
  /** Average colours of the deck's background pictures, as the import used them. */
  tones?: Tones;
}

export function planResync(req: PlanRequest): ResyncPlan {
  const { source, slides, deck, pkg } = req;
  const deckId = source.id;
  const placement = placementOf(source);
  const ctx = {
    placement, ...(req.tones ? { tones: req.tones } : {}), notes: newNotes(),
    mediaPath: mediaPathFor, bytesOf: (part: string) => pkg.bytes(part), slideWidth: deck.slideWidth, slideHeight: deck.slideHeight,
  };
  const items: PlanItem[] = [];
  let count = 0;
  const add = (item: Omit<PlanItem, "id">) => { items.push({ ...item, id: `item-${++count}` }); };

  const linked = new Map<string, Slide>();
  for (const s of slides) {
    const p = slideProvOf(s, deckId);
    if (p && !linked.has(p.slideId)) linked.set(p.slideId, s);
  }
  const seen = new Set(source.seen ?? []);
  const inDeck = new Set(deck.slides.map((s) => s.slideId));
  const matched = deck.slides.filter((s) => linked.has(s.slideId)).length;
  const warning = linked.size > 0 && matched === 0
    ? "None of the slides in this file match the slides that were imported. It may be a different presentation. Check before bringing anything up to date."
    : null;

  let unchanged = 0;
  deck.slides.forEach((ds, di) => {
    const target = linked.get(ds.slideId);
    if (!target) {
      const left = seen.has(ds.slideId);
      // Where it would go: after the slide of the course that comes from the deck slide before it, else before the one that comes after.
      let after: string | null = null;
      for (let k = di - 1; k >= 0 && !after; k--) after = linked.get(deck.slides[k]!.slideId)?.id ?? null;
      let before: string | null = null;
      for (let k = di + 1; k < deck.slides.length && !before; k++) before = linked.get(deck.slides[k]!.slideId)?.id ?? null;
      const drafts = draftsForSlide(ds, ctx);
      add({
        slide: ds.name,
        label: left ? `The deck still has the slide "${ds.name}", which you left out or deleted. Add it back?` : `The deck has a new slide, "${ds.name}". Add it?`,
        detail: [`${drafts.length} ${drafts.length === 1 ? "object" : "objects"}`],
        checked: !left, replacesYours: false, action: { op: "newSlide", deckSlide: ds, after, before },
        assets: drafts.flatMap((d) => (d.draft.asset ? [d.draft.asset] : [])),
      });
      return;
    }

    // The slide's own settings.
    const sp = slideProvOf(target, deckId)!;
    const sb = sp.base ?? { name: ds.name, background: ds.background };
    const slideFields: { field: "name" | "background"; base: string | null; ours: string | null; theirs: string | null; word: string }[] = [
      { field: "name", base: sb.name, ours: target.name, theirs: ds.name, word: "name" },
      // A picture whose average colour could not be worked out this time is not a change of background.
      { field: "background", base: sb.background, ours: target.background, theirs: (ds.backgroundPicture ?? ds.backgroundTile) && !ds.background && !req.tones?.get((ds.backgroundPicture ?? ds.backgroundTile)!.mediaHash) ? sb.background : backgroundOf(ds, req.tones), word: "background colour" },
    ];
    for (const f of slideFields) {
      if (same(f.theirs, f.base) || same(f.ours, f.theirs)) continue;
      const conflict = !same(f.ours, f.base);
      add({
        slide: target.name,
        label: conflict
          ? `Replace your ${f.word} for the slide "${target.name}" with the deck's (${f.theirs ?? "none"})?`
          : `The deck changed the ${f.word} of the slide "${target.name}" to ${f.theirs === null ? "none" : `"${f.theirs}"`}. Use it?`,
        detail: [`Now: ${f.ours ?? "none"}`, `Deck: ${f.theirs ?? "none"}`],
        checked: !conflict, replacesYours: conflict, action: { op: "slideField", slideId: target.id, field: f.field, value: f.theirs }, assets: [],
      });
    }

    // The slide's shapes.
    const mine = new Map<string, OSObject>();
    for (const o of allObjects(target)) {
      const p = provOf(o, deckId);
      if (p && p.slideId === ds.slideId) mine.set(p.shapeId, o);
    }
    const imported = new Set(sp.base?.shapes ?? []);
    const drafts = draftsForSlide(ds, ctx);
    const prefix = `${ds.slideId}/`;
    const theirKeys = new Set<string>();
    for (const { key, hash, draft } of drafts) {
      const shapeId = `${prefix}${key}`;
      theirKeys.add(shapeId);
      const obj = mine.get(shapeId);
      if (!obj) {
        // A shape the author deleted stays deleted, even if the deck changed it since. Only a shape the import never saw is new.
        if (imported.has(key)) continue;
        add({
          slide: target.name,
          label: `The deck has a new ${draft.type === "image" ? "picture" : draft.type === "text" ? "text box" : draft.type} on the slide "${target.name}", "${draft.name}". Add it?`,
          detail: draft.type === "text" ? [brief(plainOf(draft.content["html"]))] : [],
          checked: true, replacesYours: false, action: { op: "newShape", slideId: target.id, deckSlide: ds, key, hash, draft }, assets: draft.asset ? [draft.asset] : [],
        });
        continue;
      }
      const prov = provOf(obj, deckId)!;
      if (prov.sourceHash === hash) { unchanged += 1; continue; }
      const theirs = snapshotOf(draft);
      const base = prov.base ?? theirs;
      const result = merge3(base, snapshotOf(obj), theirs);
      if (result.takes.length === 0 && result.conflicts.length === 0) {
        // The deck changed something that does not show here, or the author already made the same change. Only the record moves on.
        add({ slide: target.name, label: "", detail: [], checked: true, replacesYours: false, quiet: true, action: { op: "changeShape", slideId: target.id, objectId: obj.id, changes: [], theirs, hash, conflict: false }, assets: [] });
        continue;
      }
      if (result.takes.length > 0) {
        add({
          slide: target.name,
          label: `Update "${obj.name}" on the slide "${target.name}" (${wordsFor(result.takes.map((c) => kindOf(c.path)))}).`,
          detail: result.takes.map(describeChange), checked: true, replacesYours: false,
          action: { op: "changeShape", slideId: target.id, objectId: obj.id, changes: result.takes, theirs, hash, conflict: false },
          assets: result.takes.some((c) => c.path === "content.src") && draft.asset ? [draft.asset] : [],
        });
      }
      if (result.conflicts.length > 0) {
        add({
          slide: target.name,
          label: `Replace your changes to "${obj.name}" on the slide "${target.name}" (${wordsFor(result.conflicts.map((c) => kindOf(c.path)))}) with the deck's?`,
          detail: result.conflicts.map(describeChange), checked: false, replacesYours: true,
          action: { op: "changeShape", slideId: target.id, objectId: obj.id, changes: result.conflicts, theirs, hash, conflict: true },
          assets: result.conflicts.some((c) => c.path === "content.src") && draft.asset ? [draft.asset] : [],
        });
      }
    }
    // The slide's animation: what the deck gives each shape now, against what the import gave it and what the author has done since.
    const keys = drafts.map((d) => d.key);
    const theirAnim = animationFor(ds, keys, newNotes());
    const baseAnim = sp.base?.animation ?? {};
    const takes: AnimChange[] = [];
    const conflicts: AnimChange[] = [];
    const theirsAll: Record<string, AnimRec> = {};
    keys.forEach((key, i) => {
      const theirs = theirAnim[i] ?? null;
      if (theirs) theirsAll[key] = theirs;
      const obj = mine.get(`${prefix}${key}`);
      if (!obj) return; // deleted by the author, or new (a new shape brings its own animation)
      const base = baseAnim[key] ?? null;
      const ours = animOf(obj);
      if (same(theirs, base) || same(ours, theirs)) return;
      const change: AnimChange = { objectId: obj.id, key, name: obj.name, after: theirs };
      if (same(ours, base)) takes.push(change); else conflicts.push(change);
    });
    const animationTold = (c: AnimChange) => `${c.name}: ${animWords(animOf(mine.get(`${prefix}${c.key}`)!))} becomes ${animWords(c.after)}`;
    if (takes.length > 0) {
      add({
        slide: target.name,
        label: `The deck changed when ${takes.length === 1 ? "something appears or goes" : `${takes.length} things appear or go`} on the slide "${target.name}". Bring the animation forward?`,
        detail: takes.map(animationTold), checked: true, replacesYours: false, action: { op: "slideAnimation", slideId: target.id, changes: takes, theirsAll, conflict: false }, assets: [],
      });
    }
    if (conflicts.length > 0) {
      add({
        slide: target.name,
        label: `Replace your changes to the timing or animation of ${conflicts.length === 1 ? `"${conflicts[0]!.name}"` : `${conflicts.length} objects`} on the slide "${target.name}" with the deck's?`,
        detail: conflicts.map(animationTold), checked: false, replacesYours: true, action: { op: "slideAnimation", slideId: target.id, changes: conflicts, theirsAll, conflict: true }, assets: [],
      });
    }
    if (takes.length === 0 && conflicts.length === 0 && !same(sp.base?.animation ?? {}, theirsAll)) {
      // Nothing to offer, but the record of what the deck had moves on (or is made, for a slide imported before it was kept).
      add({ slide: target.name, label: "", detail: [], checked: true, replacesYours: false, quiet: true, action: { op: "slideAnimation", slideId: target.id, changes: [], theirsAll, conflict: false }, assets: [] });
    }

    // The speaker notes, if they were made the narration of an object: what they say now, against what they said then and what the narration says now.
    const nb = sp.base?.notes;
    const narrated = nb ? mine.get(`${prefix}${nb.key}`) : undefined;
    if (nb && narrated) {
      const theirScript = ds.notes !== "" ? scriptFromNotes(ds.notes) : "";
      const ours = (narrated.narration as unknown as Narration | null)?.script ?? "";
      if (!same(theirScript, nb.script) && !same(ours, theirScript)) {
        const conflict = !same(ours, nb.script);
        add({
          slide: target.name,
          label: conflict
            ? `Replace your changes to what "${narrated.name}" says on the slide "${target.name}" with the deck's speaker notes?`
            : theirScript === ""
              ? `The speaker notes of the slide "${target.name}" were taken out. Take away what "${narrated.name}" says?`
              : `The speaker notes of the slide "${target.name}" changed. Update what "${narrated.name}" says?`,
          detail: [`Now: "${brief(ours)}"`, `Deck: ${theirScript === "" ? "no notes" : `"${brief(theirScript)}"`}`, ...(theirScript === "" ? [] : ["The audio for it has to be made again."])],
          checked: !conflict, replacesYours: conflict, action: { op: "slideNotes", slideId: target.id, objectId: narrated.id, key: nb.key, script: theirScript, conflict }, assets: [],
        });
      } else if (!same(theirScript, nb.script)) {
        // The author already has what the deck now says: only the record moves on.
        add({ slide: target.name, label: "", detail: [], checked: true, replacesYours: false, quiet: true, action: { op: "slideNotes", slideId: target.id, objectId: narrated.id, key: nb.key, script: theirScript, conflict: false }, assets: [] });
      }
    }

    // Shapes the deck no longer has.
    for (const [shapeId, obj] of mine) {
      if (theirKeys.has(shapeId)) continue;
      const prov = provOf(obj, deckId)!;
      const edited = prov.base ? canonical(snapshotOf(obj)) !== canonical(prov.base) : false;
      const extra = authorAdded(obj);
      add({
        slide: target.name,
        label: `The deck no longer has "${obj.name}" on the slide "${target.name}". Remove it?`,
        detail: [...(edited ? ["You have changed it."] : []), ...(extra ? ["It has rules, narration, timing or other things you added, which would go with it."] : [])],
        checked: !edited && !extra, replacesYours: edited || extra, action: { op: "removeShape", slideId: target.id, objectId: obj.id }, assets: [],
      });
    }
  });

  // Slides of the course that came from slides the deck no longer has.
  for (const [slideId, s] of linked) {
    if (inDeck.has(slideId)) continue;
    const own = allObjects(s).filter((o) => provOf(o, deckId) === null).length;
    add({
      slide: s.name,
      label: `The deck no longer has the slide "${s.name}". Delete it from the course?`,
      detail: own > 0 ? [`It has ${own} ${own === 1 ? "object that is" : "objects that are"} not from the deck.`] : [],
      checked: false, replacesYours: false, action: { op: "removeSlide", slideId: s.id }, assets: [],
    });
  }

  // The order of the slides.
  const order = [...linked.keys()].filter((id) => inDeck.has(id));
  const courseOrder = slides.map((s) => slideProvOf(s, deckId)?.slideId).filter((id): id is string => !!id && inDeck.has(id));
  const deckOrder = deck.slides.map((s) => s.slideId).filter((id) => order.includes(id));
  const orderChanged = canonical(courseOrder) !== canonical(deckOrder);

  return { deckId, items, unchanged, orderChanged, seen: deck.slides.map((s) => s.slideId), warning };
}

/** The picture files the ticked items need, which have to be saved in the project before the changes go in. */
export function assetsFor(plan: ResyncPlan, accepted: ReadonlySet<string>): { path: string; bytes: Uint8Array }[] {
  const out: { path: string; bytes: Uint8Array }[] = [];
  for (const item of plan.items) {
    if (!(item.quiet === true || accepted.has(item.id))) continue;
    for (const a of item.assets) if (!out.some((x) => x.path === a.path)) out.push(a);
  }
  return out;
}

/** The items to show the author: all but the ones that only move the record on. */
export const offered = (plan: ResyncPlan): PlanItem[] => plan.items.filter((i) => !i.quiet);

// ---- applying what was chosen

export interface ApplyEnv {
  tones?: Tones;
  slides: Slide[];
  source: DeckSource;
  importedAt: string;
  pkg: Pkg;
  deck: Deck;
  newSlideId(): string;
  newObjectId(): string;
}

export interface ApplyResult {
  insert: { slide: Slide; after: string | null; before: string | null }[];
  remove: string[];
  assets: { path: string; bytes: Uint8Array }[];
  summary: string[];
  counts: { slidesAdded: number; slidesRemoved: number; shapesAdded: number; shapesChanged: number; shapesRemoved: number; fields: number; animations: number; narrations: number };
}

function setLeaf(o: OSObject, path: string, value: unknown): void {
  if (path === "type") { o.type = String(value) as OSObject["type"]; return; }
  if (path === "name") { o.name = String(value); return; }
  if (path === "altText") { o.accessibility.altText = String(value ?? ""); return; }
  if (path === "decorative") {
    o.accessibility.decorative = value === true;
    if (value === true) { o.accessibility.altText = ""; o.accessibility.tabOrder = 0; }
    return;
  }
  const [group, key] = [path.slice(0, path.indexOf(".")), path.slice(path.indexOf(".") + 1)];
  if (group === "geometry") { (o.geometry as unknown as Record<string, number>)[key] = Number(value); return; }
  const bag = (group === "content" ? o.content : o.style) as Record<string, unknown>;
  if (value === undefined) delete bag[key];
  else bag[key] = value;
}

/** Apply the ticked items. The slides are changed where they stand; the slides to add and to delete are returned. */
export function applyPlan(plan: ResyncPlan, accepted: ReadonlySet<string>, env: ApplyEnv): ApplyResult {
  const result: ApplyResult = {
    insert: [], remove: [], assets: [], summary: [],
    counts: { slidesAdded: 0, slidesRemoved: 0, shapesAdded: 0, shapesChanged: 0, shapesRemoved: 0, fields: 0, animations: 0, narrations: 0 },
  };
  const slideById = new Map(env.slides.map((s) => [s.id, s]));
  const placement = placementOf(env.source);
  const ctx = {
    placement, ...(env.tones ? { tones: env.tones } : {}), notes: newNotes(),
    mediaPath: mediaPathFor, bytesOf: (part: string) => env.pkg.bytes(part), slideWidth: env.deck.slideWidth, slideHeight: env.deck.slideHeight,
    deckId: plan.deckId, importedAt: env.importedAt, newId: env.newObjectId,
  };
  const on = (i: PlanItem) => i.quiet === true || accepted.has(i.id);
  const lastAfter = new Map<string, string>();

  for (const item of plan.items) {
    if (!on(item)) continue;
    item.assets.forEach((a) => { if (!result.assets.some((x) => x.path === a.path)) result.assets.push(a); });
    const a = item.action;
    switch (a.op) {
      case "newSlide": {
        const converted = convertSlide(a.deckSlide, ctx);
        // A slide that is new to the course comes in the way the deck's other slides did: if they play their items by themselves, so does this one.
        const earlier = env.slides.find((s) => (s.provenance as { sourceDeck?: string } | null | undefined)?.sourceDeck === plan.deckId && s.autoSteps);
        const slide = slideFrom(converted, env.newSlideId(), earlier?.autoSteps);
        // Several new slides one after another keep the deck's order.
        const anchor = a.after ?? `before:${a.before}`;
        const after = a.after ? lastAfter.get(anchor) ?? a.after : null;
        if (a.after) lastAfter.set(anchor, slide.id);
        result.insert.push({ slide, after, before: a.after ? null : a.before });
        result.counts.slidesAdded += 1;
        break;
      }
      case "removeSlide":
        result.remove.push(a.slideId);
        result.counts.slidesRemoved += 1;
        break;
      case "slideField": {
        const s = slideById.get(a.slideId);
        if (!s) break;
        if (a.field === "name") s.name = a.value ?? s.name;
        else s.background = a.value;
        const p = slideProvOf(s, plan.deckId);
        if (p?.base) p.base = { ...p.base, [a.field]: a.value };
        result.counts.fields += 1;
        break;
      }
      case "newShape": {
        const s = slideById.get(a.slideId);
        if (!s) break;
        const objects = allObjects(s);
        const z = objects.reduce((m, o) => Math.max(m, o.geometry.z), 0) + 10;
        const tab = objects.reduce((m, o) => Math.max(m, o.accessibility.tabOrder ?? 0), 0) + 1;
        const obj = objectFrom(a.draft, env.newObjectId(), z, tab, provenanceFor(plan.deckId, a.deckSlide, a.key, a.hash, snapshotOf(a.draft), env.importedAt));
        // A picture that fills the slide goes behind everything else.
        if (a.key === "background") { obj.geometry.z = Math.min(0, ...objects.map((o) => o.geometry.z)) - 10; s.baseLayer.objects.unshift(obj); }
        else s.baseLayer.objects.push(obj);
        const sp = slideProvOf(s, plan.deckId);
        // A new shape comes with the timing and animation the deck gives it, and the record of them.
        const anim = animationFor(a.deckSlide, [a.key], newNotes())[0];
        if (anim) {
          obj.timing = structuredClone(anim.timing);
          obj.animation = structuredClone(anim.animation);
        }
        if (sp?.base) sp.base = { ...sp.base, shapes: [...new Set([...(sp.base.shapes ?? []), a.key])], ...(anim ? { animation: { ...(sp.base.animation ?? {}), [a.key]: structuredClone(anim) } } : {}) };
        result.counts.shapesAdded += 1;
        break;
      }
      case "removeShape": {
        const s = slideById.get(a.slideId);
        if (!s) break;
        for (const layer of [s.baseLayer, ...s.layers]) layer.objects = layer.objects.filter((o) => o.id !== a.objectId);
        result.counts.shapesRemoved += 1;
        break;
      }
      case "changeShape": break; // below, one object at a time, because an object can have two items
      case "slideAnimation": {
        const s = slideById.get(a.slideId);
        if (!s) break;
        const here = allObjects(s);
        for (const c of a.changes) {
          const o = here.find((x) => x.id === c.objectId);
          if (!o) continue;
          o.timing = structuredClone((c.after ?? STARTING).timing);
          o.animation = structuredClone((c.after ?? STARTING).animation);
          result.counts.animations += 1;
        }
        break;
      }
      case "slideNotes": {
        const s = slideById.get(a.slideId);
        const o = s && allObjects(s).find((x) => x.id === a.objectId);
        if (!o || item.quiet === true) break;
        if (a.script === "") o.narration = null;
        else o.narration = ((o.narration as unknown as Narration | null) ? { ...(o.narration as unknown as Narration), script: a.script } : newNarration(a.script)) as unknown as OSObject["narration"];
        result.counts.narrations += 1;
        break;
      }
    }
  }

  // The records of animation and notes move on to the deck as it is now, except for what the author kept their own way, which stays as it was so it is offered again.
  const animationItems = new Map<string, PlanItem[]>();
  for (const item of plan.items) if (item.action.op === "slideAnimation") animationItems.set(item.action.slideId, [...(animationItems.get(item.action.slideId) ?? []), item]);
  for (const [slideId, group] of animationItems) {
    const s = slideById.get(slideId);
    const sp = s && slideProvOf(s, plan.deckId);
    if (!sp?.base) continue;
    const first = group[0]!.action as Extract<Action, { op: "slideAnimation" }>;
    const next: Record<string, AnimRec> = structuredClone(first.theirsAll);
    const old = sp.base.animation ?? {};
    for (const item of group) {
      if (on(item)) continue;
      for (const c of (item.action as Extract<Action, { op: "slideAnimation" }>).changes) {
        if (old[c.key]) next[c.key] = old[c.key]!;
        else delete next[c.key];
      }
    }
    sp.base = { ...sp.base, ...(Object.keys(next).length > 0 ? { animation: next } : {}) };
    if (Object.keys(next).length === 0) delete sp.base.animation;
  }
  for (const item of plan.items) {
    const a = item.action;
    if (a.op !== "slideNotes" || !on(item)) continue;
    const s = slideById.get(a.slideId);
    const sp = s && slideProvOf(s, plan.deckId);
    if (sp?.base) sp.base = { ...sp.base, notes: { key: a.key, script: a.script } };
  }

  // Each changed object: apply what was ticked, then move its record on to the deck as it is now, except for what the author kept their own way,
  // which stays as it was so it is offered again.
  const byObject = new Map<string, PlanItem[]>();
  for (const item of plan.items) if (item.action.op === "changeShape") byObject.set(item.action.objectId, [...(byObject.get(item.action.objectId) ?? []), item]);
  for (const [objectId, group] of byObject) {
    const first = group[0]!.action as Extract<Action, { op: "changeShape" }>;
    const s = slideById.get(first.slideId);
    const o = s && allObjects(s).find((x) => x.id === objectId);
    if (!o) continue;
    const prov = o.provenance as unknown as Prov;
    const oldBase = leavesOf(prov.base ?? first.theirs);
    let changed = false;
    const declined: string[] = [];
    for (const item of group) {
      const a = item.action as Extract<Action, { op: "changeShape" }>;
      if (on(item)) {
        const wasWords = o.type === "text" && o.accessibility.altText === plainOf(o.content["html"]);
        for (const c of a.changes) setLeaf(o, c.path, c.after);
        if (wasWords && a.changes.some((c) => c.path === "content.html")) o.accessibility.altText = plainOf(o.content["html"]);
        if (a.changes.length > 0) changed = true;
      } else declined.push(...a.changes.map((c) => c.path));
    }
    const nextBase: Base = structuredClone(first.theirs);
    for (const path of declined) setLeafOn(nextBase, path, oldBase.get(path));
    // If the words stay as they were, so does the alt text that was made from them.
    if (declined.includes("content.html") && prov.base && altIsItsWords(prov.base)) nextBase.altText = prov.base.altText;
    prov.base = nextBase;
    if (declined.length === 0) prov.sourceHash = first.hash;
    if (changed) result.counts.shapesChanged += 1;
  }
  return result;
}

function setLeafOn(b: Base, path: string, value: unknown): void {
  if (path === "type") { b.type = String(value); return; }
  if (path === "name") { b.name = String(value); return; }
  if (path === "altText") { b.altText = String(value ?? ""); return; }
  if (path === "decorative") { b.decorative = value === true; return; }
  const group = path.slice(0, path.indexOf("."));
  const key = path.slice(path.indexOf(".") + 1);
  if (group === "geometry") { (b.geometry as unknown as Record<string, number>)[key] = Number(value); return; }
  const bag = (group === "content" ? b.content : b.style) as Record<string, unknown>;
  if (value === undefined) delete bag[key];
  else bag[key] = value;
}
