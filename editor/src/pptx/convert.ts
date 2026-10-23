// Turns what the deck reader found into OpenStage slides and objects. Nothing here touches the project: it returns objects and the
// picture files they need, and the model puts them in.
//
// Choices made here, because the two programs do not draw the same way:
//  - A deck's drawing units become stage pixels at one scale for the whole deck (see `placementFor`), so shapes keep their places.
//  - Text keeps its meaning: a title is a heading, bulleted paragraphs are a list, bold and italic stay. A box that mixes sizes or colours
//    takes the one that most of its words have, and the report says so.
//  - Alt text is what PowerPoint had. A shape with none is decorative, as a new shape in this editor is; a picture or table with none is
//    left for the author, and the Problems list asks. Nothing is made up.

import type { Effect, EffectName, OSObject, Slide } from "../../../player/src/types.ts";
import type { Narration } from "../narration.ts";
import { FONT_CHOICES } from "../content.ts";
import { box } from "../factory.ts";
import { EMU_PER_INCH, type DeckEffect, type DeckPara, type DeckRun, type DeckShape, type DeckSlide, type DeckTransition } from "./deck.ts";

/** How a deck is laid on the stage: how big an inch of the deck is in stage pixels, and how far in from the stage's top left corner the deck starts. */
export interface Placement {
  pixelsPerInch: number;
  offsetX: number;
  offsetY: number;
}

/** Fit a deck's slide on the stage, as big as it will go without being cut, in the middle. */
export function placementFor(slideWidth: number, slideHeight: number, stage: { width: number; height: number }): Placement {
  const inchesWide = slideWidth / EMU_PER_INCH;
  const inchesHigh = slideHeight / EMU_PER_INCH;
  const ppi = Math.min(stage.width / inchesWide, stage.height / inchesHigh);
  const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
  return { pixelsPerInch: round(ppi, 3), offsetX: round((stage.width - inchesWide * ppi) / 2, 1), offsetY: round((stage.height - inchesHigh * ppi) / 2, 1) };
}

/** What importing left out or changed, counted, for the report. */
export interface ConvertNotes {
  fontsReplaced: Record<string, number>;
  mixedColour: number;
  mixedSize: number;
  formsRedrawn: Record<string, number>;
  croppedPictures: number;
  diagonalLines: number;
  tableMerged: number;
  fills: Record<string, number>;
  /** Text boxes that shrink their words when they do not fit. */
  shrinks: number;
  /** Objects given an entrance, and how many of those had an effect this editor does not have, so they fade in instead. */
  animated: number;
  animationApproximated: number;
  /** Objects that wait for the learner to show them. */
  waiting: number;
  /** Slides whose speaker notes became narration, and slides whose notes had no object to be the narration of. */
  narrated: number;
  notesUnused: number;
}

export const newNotes = (): ConvertNotes => ({ fontsReplaced: {}, mixedColour: 0, mixedSize: 0, formsRedrawn: {}, croppedPictures: 0, diagonalLines: 0, tableMerged: 0, fills: {}, shrinks: 0, animated: 0, animationApproximated: 0, waiting: 0, narrated: 0, notesUnused: 0 });

const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

/** An object as the import makes it, before it has an id, a place in the stacking order or a tab number. */
export interface Draft {
  type: "text" | "shape" | "image" | "table";
  name: string;
  geometry: { x: number; y: number; width: number; height: number; rotation: number };
  content: Record<string, unknown>;
  style: Record<string, string | number>;
  altText: string;
  decorative: boolean;
  role: string;
  /** A picture file the object needs, read from the deck, to be saved in the project at `path`. */
  asset?: { path: string; bytes: Uint8Array };
}

/** The part of an object the import decides: the object as it was imported, kept so a changed deck can be compared with what the author did since. */
export interface Base {
  type: string;
  name: string;
  geometry: { x: number; y: number; width: number; height: number; rotation: number };
  content: Record<string, unknown>;
  style: Record<string, string | number>;
  altText: string;
  decorative: boolean;
}

export function snapshotOf(o: Pick<Draft, "type" | "name" | "geometry" | "content" | "style" | "altText" | "decorative"> | OSObject): Base {
  const isObject = "accessibility" in o;
  const g = o.geometry;
  return structuredClone({
    type: o.type,
    name: o.name,
    geometry: { x: g.x, y: g.y, width: g.width, height: g.height, rotation: g.rotation },
    content: o.content,
    style: o.style as Record<string, string | number>,
    altText: isObject ? (o as OSObject).accessibility.altText : (o as Draft).altText,
    decorative: isObject ? (o as OSObject).accessibility.decorative : (o as Draft).decorative,
  });
}

/**
 * The colour to give a slide whose background is a picture. The validator judges text against a slide's background colour and cannot see a
 * picture, so the slide is given the picture's average colour, which is the best guess available. The key is the picture's fingerprint.
 */
export type Tones = ReadonlyMap<string, string>;

/** The slide's background colour as the import sets it: the deck's own colour, or else the average colour of its background picture. */
export function backgroundOf(ds: DeckSlide, tones: Tones | undefined): string | null {
  if (ds.background) return ds.background;
  const behind = ds.backgroundPicture ?? ds.backgroundTile;
  return (behind && tones?.get(behind.mediaHash)) || null;
}

export interface ConvertContext {
  placement: Placement;
  notes: ConvertNotes;
  /** Average colours of background pictures, if they could be worked out. */
  tones?: Tones;
  /** The file name inside the project for a picture from the deck, from its fingerprint and extension. */
  mediaPath(hash: string, ext: string): string;
  bytesOf(part: string): Uint8Array | undefined;
}

// ---- text

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escape(s).replace(/"/g, "&quot;");
const SAFE_HREF = /^(https?:|mailto:)/i;

function runHtml(r: DeckRun, allBold: boolean): string {
  if (r.br) return "<br>";
  let t = escape(r.text);
  if (r.sup) t = `<sup>${t}</sup>`;
  if (r.sub) t = `<sub>${t}</sub>`;
  if (r.underline && !r.href) t = `<u>${t}</u>`;
  if (r.italic) t = `<em>${t}</em>`;
  if (r.bold && !allBold) t = `<strong>${t}</strong>`;
  if (r.href && SAFE_HREF.test(r.href)) t = `<a href="${escapeAttr(r.href)}">${t}</a>`;
  return t;
}

/** Paragraphs as HTML: a heading for a title, paragraphs, and lists (nested for deeper levels) for bulleted paragraphs. */
export function parasToHtml(paras: DeckPara[], title: boolean, allBold: boolean): string {
  const inner = (p: DeckPara) => p.runs.map((r) => runHtml(r, allBold)).join("");
  if (title) return `<h1>${paras.map(inner).join("<br>")}</h1>`;
  let out = "";
  const open: { tag: "ul" | "ol"; li: boolean }[] = [];
  const closeTo = (depth: number) => {
    while (open.length > depth) {
      const top = open.pop()!;
      out += `${top.li ? "</li>" : ""}</${top.tag}>`;
    }
  };
  for (const p of paras) {
    if (p.bullet === "none") {
      closeTo(0);
      out += `<p>${inner(p)}</p>`;
      continue;
    }
    const tag = p.bullet === "number" ? "ol" : "ul";
    const depth = Math.min(p.level, 3) + 1;
    closeTo(depth);
    if (open.length === depth && open[depth - 1]!.tag !== tag) closeTo(depth - 1);
    if (open.length === depth) {
      const top = open[depth - 1]!;
      if (top.li) out += "</li>";
      out += `<li>${inner(p)}`;
      top.li = true;
      continue;
    }
    while (open.length < depth) {
      const last = open.length === depth - 1;
      out += `<${tag}>`;
      open.push({ tag, li: false });
      if (last) { out += `<li>${inner(p)}`; open[open.length - 1]!.li = true; }
      else { out += "<li>"; open[open.length - 1]!.li = true; }
    }
  }
  closeTo(0);
  return out;
}

const plain = (paras: DeckPara[]) => paras.map((p) => p.runs.map((r) => (r.br ? " " : r.text)).join("")).join(" ").replace(/\s+/g, " ").trim();

/** The value most of a box's words have for something, or undefined if none has it. */
function dominant<T extends string | number>(runs: DeckRun[], pick: (r: DeckRun) => T | undefined): { value: T | undefined; mixed: boolean } {
  const weight = new Map<T, number>();
  for (const r of runs) {
    const v = pick(r);
    if (v !== undefined) weight.set(v, (weight.get(v) ?? 0) + r.text.length);
  }
  if (weight.size === 0) return { value: undefined, mixed: false };
  let best: T | undefined;
  let most = -1;
  for (const [v, w] of weight) if (w > most) { best = v; most = w; }
  const noValue = runs.some((r) => !r.br && r.text.trim() !== "" && pick(r) === undefined);
  return { value: best, mixed: weight.size > 1 || noValue };
}

const firstFamily = (stack: string) => (stack.split(",")[0] ?? "").replace(/['"]/g, "").trim().toLowerCase();

function fontStack(deckFont: string | undefined, notes: ConvertNotes): string | undefined {
  if (!deckFont) return undefined;
  const hit = FONT_CHOICES.find((f) => firstFamily(f.value) === deckFont.toLowerCase());
  if (hit) return hit.value;
  bump(notes.fontsReplaced, deckFont);
  return undefined;
}

const SHAPE_FOR: Record<string, string> = {
  rect: "rectangle", roundRect: "rounded", round1Rect: "rounded", round2SameRect: "rounded", ellipse: "ellipse", triangle: "triangle", rtTriangle: "triangle",
  diamond: "diamond", rightArrow: "arrow",
};

const px = (emu: number, p: Placement) => (emu / EMU_PER_INCH) * p.pixelsPerInch;

/** What PowerPoint shows when a text box says nothing of its own about the room round its words. */
const DEFAULT_INSET = { l: 91440, t: 45720, r: 91440, b: 45720 };

/**
 * How the words sit in their box, as PowerPoint draws them: the room round them, the line they start from (top, middle or bottom of the box), the
 * spacing between lines and paragraphs, and shrinking when they do not fit. A web page draws type a little differently from PowerPoint, and the fonts
 * PowerPoint uses are mostly not on a learner's computer, so shrinking when the words do not fit is what keeps the box looking as it did.
 */
function boxStyle(shape: DeckShape & { kind: "text" }, sizePoints: number | undefined, p: Placement, notes: ConvertNotes): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const body = shape.body;
  const inset = { ...DEFAULT_INSET, ...body?.inset };
  out["paddingX"] = Math.round(px((inset.l + inset.r) / 2, p));
  out["paddingY"] = Math.round(px((inset.t + inset.b) / 2, p));
  if (body?.anchor === "ctr") out["verticalAlign"] = "middle";
  else if (body?.anchor === "b") out["verticalAlign"] = "bottom";
  if (body?.fit === "shrink" || body?.fit === "grow") {
    out["autoFit"] = "shrink";
    notes.shrinks += 1;
  }
  const first = shape.paras[0];
  const spacing = first?.lineSpacing;
  // A browser's single line is a little taller than the type; PowerPoint's single line is about 1.2 times the type.
  if (spacing?.pct !== undefined) out["lineHeight"] = Math.round(spacing.pct * 1.2 * 100) / 100;
  else if (spacing?.pts !== undefined && sizePoints) out["lineHeight"] = Math.round((spacing.pts / sizePoints) * 100) / 100;
  const between = shape.paras.length > 1 ? (shape.paras[1]!.before ?? 0) + (shape.paras[0]!.after ?? 0) : (first?.before ?? 0);
  // Empty paragraphs between the words were the author's way of leaving a gap; the gap is what is kept.
  const blank = Math.max(0, ...shape.paras.slice(0, -1).map((q) => (q.blankAfter ?? 0) * (q.blankPts ?? 0) * 1.2));
  out["paragraphSpacing"] = Math.round(((between + blank) * p.pixelsPerInch) / 72);
  return out;
}
const rectOf = (s: DeckShape, p: Placement) => ({
  x: Math.round(p.offsetX + px(s.box.x, p)),
  y: Math.round(p.offsetY + px(s.box.y, p)),
  width: Math.max(1, Math.round(px(s.box.cx, p))),
  height: Math.max(1, Math.round(px(s.box.cy, p))),
  rotation: Math.round(s.rot),
});

function strokeStyle(line: { color: string; width: number } | null, p: Placement): Record<string, string | number> {
  if (!line) return {};
  return { stroke: line.color, strokeWidth: Math.max(1, Math.round(((line.width / 12700) * p.pixelsPerInch) / 72)) };
}

/** Turn one shape of the deck into the object it becomes, or null if it becomes nothing. */
export function convertShape(shape: DeckShape, ctx: ConvertContext): Draft | null {
  const { placement: p, notes } = ctx;
  const geometry = rectOf(shape, p);
  switch (shape.kind) {
    case "text": {
      const runs = shape.paras.flatMap((r) => r.runs).filter((r) => !r.br && r.text.trim() !== "");
      const title = shape.placeholder === "title" || shape.placeholder === "ctrTitle";
      const allBold = runs.length > 0 && runs.every((r) => r.bold);
      // The size is the one most of the first level's words have; deeper levels of a list are drawn as a share of the level above (see `nestedSize`).
      const wordsOf = (level: (l: number) => boolean) => shape.paras.filter((q) => level(q.level)).flatMap((q) => q.runs).filter((r) => !r.br && r.text.trim() !== "");
      const top = wordsOf((l) => l === 0);
      const size = dominant(top.length > 0 ? top : runs, (r) => r.size);
      const colour = dominant(runs, (r) => r.color);
      const font = dominant(runs, (r) => r.font);
      if (size.mixed) notes.mixedSize += 1;
      if (colour.mixed) notes.mixedColour += 1;
      const style: Record<string, string | number> = {};
      const stack = fontStack(font.value, notes);
      style["fontFamily"] = stack ?? (title ? "theme:font.heading" : "theme:font.body");
      if (size.value !== undefined) style["fontSize"] = Math.max(6, Math.round((size.value * p.pixelsPerInch) / 72));
      if (colour.value) style["color"] = colour.value;
      if (allBold && !title) style["fontWeight"] = "bold";
      if (title && runs.length > 0 && !runs.some((r) => r.bold)) style["fontWeight"] = "normal";
      const align = shape.paras[0]?.align;
      if (align) style["textAlign"] = align === "ctr" ? "center" : align === "r" ? "right" : align === "j" ? "justify" : "left";
      Object.assign(style, boxStyle(shape, size.value, p, notes));
      const deeper = dominant(wordsOf((l) => l === 1), (r) => r.size).value;
      if (top.length > 0 && size.value !== undefined && deeper !== undefined && deeper !== size.value) {
        style["nestedSize"] = Math.round(Math.min(1.5, Math.max(0.5, deeper / size.value)) * 100) / 100;
      }
      if (shape.fill) { style["fill"] = shape.fill; }
      Object.assign(style, strokeStyle(shape.line, p));
      if (shape.fill || shape.line) {
        if (shape.geom === "ellipse") style["radius"] = 9999;
        else if (shape.geom === "roundRect" || shape.geom === "round1Rect" || shape.geom === "round2SameRect") style["radius"] = 12;
        else if (shape.geom !== "rect" && shape.geom !== "custom") bump(notes.formsRedrawn, shape.geom);
      }
      if (shape.note) bump(notes.fills, shape.note);
      const text = plain(shape.paras);
      return {
        type: "text", name: shape.name, geometry, content: { html: parasToHtml(shape.paras, title, allBold) }, style,
        altText: shape.alt !== "" ? shape.alt : text, decorative: false, role: title ? "heading" : shape.paras.some((q) => q.bullet !== "none") ? "list" : "paragraph",
      };
    }
    case "shape": {
      const kind = SHAPE_FOR[shape.geom];
      if (!kind) bump(notes.formsRedrawn, shape.geom);
      const style: Record<string, string | number> = {};
      if (shape.fill) style["fill"] = shape.fill;
      Object.assign(style, strokeStyle(shape.line, p));
      if (shape.note) bump(notes.fills, shape.note);
      const meaningful = shape.alt !== "" && !shape.decorative;
      return {
        type: "shape", name: shape.name, geometry, content: { shape: kind ?? "rectangle" }, style,
        altText: meaningful ? shape.alt : "", decorative: !meaningful, role: meaningful ? "img" : "presentation",
      };
    }
    case "line": {
      const thick = Math.max(2, Math.round(((shape.width / 12700) * p.pixelsPerInch) / 72));
      const horizontal = geometry.height <= thick + 1;
      const vertical = geometry.width <= thick + 1;
      if (!horizontal && !vertical) { notes.diagonalLines += 1; return null; }
      const g = horizontal
        ? { ...geometry, y: Math.round(geometry.y + geometry.height / 2 - thick / 2), height: thick }
        : { ...geometry, x: Math.round(geometry.x + geometry.width / 2 - thick / 2), width: thick };
      const meaningful = shape.alt !== "" && !shape.decorative;
      return {
        type: "shape", name: shape.name, geometry: g, content: { shape: "rectangle" }, style: { fill: shape.color },
        altText: meaningful ? shape.alt : "", decorative: !meaningful, role: meaningful ? "img" : "presentation",
      };
    }
    case "picture": {
      if (!shape.media) return null;
      const bytes = ctx.bytesOf(shape.media);
      if (!bytes) return null;
      if (shape.cropped) notes.croppedPictures += 1;
      const path = ctx.mediaPath(shape.mediaHash, shape.ext);
      return {
        type: "image", name: shape.name, geometry, content: { src: path }, style: {},
        altText: shape.decorative ? "" : shape.alt, decorative: shape.decorative, role: "img", asset: { path, bytes },
      };
    }
    case "table": {
      if (shape.merged) notes.tableMerged += 1;
      return {
        type: "table", name: shape.name, geometry,
        content: { caption: "", headerRow: shape.headerRow, headerColumn: shape.headerColumn, rows: shape.rows.map((r) => [...r]) },
        style: { fontFamily: "theme:font.body", fontSize: Math.max(8, Math.round(((shape.size ?? 13.5) * p.pixelsPerInch) / 72)) },
        altText: shape.decorative ? "" : shape.alt, decorative: shape.decorative, role: "table",
      };
    }
    default: return null;
  }
}

// ---- a slide

export interface SlideProvenance {
  sourceDeck: string;
  slideId: string;
  slideIndex: number;
  importedAt: string;
  sourceHash: string;
  base: { name: string; background: string | null; /** The shapes of the slide the import brought in, so a shape the author deleted is not brought back. */ shapes: string[] };
}

export interface ConvertedSlide {
  deck: DeckSlide;
  name: string;
  /** How the slide comes in, from the deck's transition, and whether the effect is the deck's own or only the nearest one this editor has. Null if the deck has none. */
  transition: { effect: Effect; exact: boolean } | null;
  background: string | null;
  objects: OSObject[];
  assets: { path: string; bytes: Uint8Array }[];
  provenance: SlideProvenance;
}

export interface SlideContext extends ConvertContext {
  /** Makes narration from words, in the voice the course already uses. When it is there, a slide's speaker notes become the narration of one of its objects. */
  narrate?: (script: string) => Narration;
  deckId: string;
  importedAt: string;
  newId(): string;
  slideWidth: number;
  slideHeight: number;
}

/** The provenance an object made from a shape carries. */
export function provenanceFor(deckId: string, slide: DeckSlide, shapeId: string, sourceHash: string, base: Base, importedAt: string): NonNullable<OSObject["provenance"]> {
  return { sourceDeck: deckId, slideIndex: slide.index, shapeId: `${slide.slideId}/${shapeId}`, importedAt, slideId: slide.slideId, sourceHash, base } as unknown as NonNullable<OSObject["provenance"]>;
}

/** Make an object from a draft, with the parts every object has. */
export function objectFrom(draft: Draft, id: string, z: number, tabOrder: number, provenance: OSObject["provenance"]): OSObject {
  const g = draft.geometry;
  return {
    ...box(id, g.x, g.y, g.width, g.height, z),
    type: draft.type,
    name: draft.name,
    geometry: { x: g.x, y: g.y, width: g.width, height: g.height, rotation: g.rotation, z },
    content: draft.content,
    style: draft.style,
    accessibility: { altText: draft.altText, role: draft.role, tabOrder: draft.decorative ? 0 : tabOrder, decorative: draft.decorative },
    provenance,
  } as OSObject;
}

/** What a slide of the deck becomes before ids exist: each shape's number in the slide, its fingerprint, and the object it makes, in reading order. */
export interface SlideDraft {
  key: string;
  hash: string;
  draft: Draft;
}

export interface SlideGeometry {
  slideWidth: number;
  slideHeight: number;
}

export function draftsForSlide(ds: DeckSlide, ctx: ConvertContext & SlideGeometry): SlideDraft[] {
  const out: SlideDraft[] = [];
  // A picture that fills the background goes behind everything, and is decoration.
  if (ds.backgroundPicture) {
    const bytes = ctx.bytesOf(ds.backgroundPicture.media);
    if (bytes) {
      const path = ctx.mediaPath(ds.backgroundPicture.mediaHash, ds.backgroundPicture.ext);
      const p = ctx.placement;
      out.push({
        key: "background", hash: ds.backgroundPicture.mediaHash,
        draft: {
          type: "image", name: "Background picture",
          geometry: { x: Math.round(p.offsetX), y: Math.round(p.offsetY), width: Math.round(px(ctx.slideWidth, p)), height: Math.round(px(ctx.slideHeight, p)), rotation: 0 },
          content: { src: path }, style: {}, altText: "", decorative: true, role: "presentation", asset: { path, bytes },
        },
      });
    }
  }
  for (const shape of ds.shapes) {
    const draft = convertShape(shape, ctx);
    if (!draft) continue;
    // What a layout or master draws on every slide is furniture: it is hidden from a screen reader, so it is not read out again on each slide.
    if (shape.template) Object.assign(draft, { decorative: true, altText: "", role: "presentation" });
    out.push({ key: shape.id, hash: shape.hash, draft });
  }
  return out;
}

const SENTENCE_END = /[.!?\u2026][\u201d"')\]\u2019]*$/;

/** Speaker notes as words to be read aloud: a paragraph is a sentence at least, so the voice pauses and the captions break between them. */
export function scriptFromNotes(notes: string): string {
  return notes.split("\n").map((l) => l.trim()).filter((l) => l !== "").map((l) => (SENTENCE_END.test(l) ? l : `${l}.`)).join(" ");
}

/**
 * Give a slide's speaker notes to one of its objects as narration: its title if it has one, else its first text, else its first object that is not decoration.
 * Narration plays when the slide opens, in reading order, so notes on the title are heard first. Returns false if every object is decoration (or there are none).
 */
function narrateFromNotes(ds: DeckSlide, objects: OSObject[], narrate: (script: string) => Narration): boolean {
  const live = objects.filter((o) => !o.accessibility.decorative);
  const target = live.find((o) => o.type === "text" && o.accessibility.role === "heading") ?? live.find((o) => o.type === "text") ?? live[0];
  if (!target) return false;
  target.narration = narrate(scriptFromNotes(ds.notes)) as unknown as OSObject["narration"];
  return true;
}

const FROM_SIDE: Record<number, EffectName> = { 1: "slideTop", 2: "slideRight", 4: "slideBottom", 8: "slideLeft" };

/** The effect this editor has that comes nearest to a PowerPoint entrance, and whether it is the same effect. */
export function entranceFor(e: DeckEffect): { effect: EffectName; exact: boolean } {
  switch (e.preset) {
    case 1: return { effect: "none", exact: true };
    case 10: return { effect: "fade", exact: true };
    case 2: return { effect: FROM_SIDE[e.subtype] ?? "fade", exact: FROM_SIDE[e.subtype] !== undefined };
    case 22: return { effect: FROM_SIDE[e.subtype] ?? "fade", exact: false };
    case 23: case 53: return { effect: "zoom", exact: true };
    case 31: return { effect: "zoom", exact: false };
    default: return { effect: "fade", exact: false };
  }
}

const within = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

/**
 * Give the objects the entrances the deck gave their shapes: an effect that waits for a press of the mouse becomes "when the learner shows the next item",
 * numbered in the order of the presses, and one that starts by itself becomes a time after the slide opens. An effect on a group is on everything in it.
 */
function applyEffects(ds: DeckSlide, objects: OSObject[], keys: string[], notes: ConvertNotes): void {
  const done = new Set<string>();
  for (const e of ds.effects) {
    const { effect, exact } = entranceFor(e);
    objects.forEach((o, i) => {
      const shape = ds.shapes.find((s) => s.id === keys[i]);
      if (done.has(o.id) || !(keys[i] === e.target || shape?.groups?.includes(e.target))) return;
      done.add(o.id);
      const start = within(e.delay, 0, 3_600_000);
      o.timing = e.click === null ? { appear: "time", start, visibleFor: null } : { appear: "click", step: within(e.click, 1, 200), start, visibleFor: null };
      if (e.click !== null) notes.waiting += 1;
      o.animation = { ...o.animation, enter: { effect, duration: within(e.duration || 500, 100, 2000) } };
      notes.animated += 1;
      if (!exact) notes.animationApproximated += 1;
    });
  }
}

/** Which side a slide comes in from, for each direction PowerPoint says it moves. A push toward the left brings the next slide in from the right. */
const COMES_FROM: Record<string, EffectName> = { l: "slideRight", r: "slideLeft", u: "slideBottom", d: "slideTop" };

/**
 * The way a slide comes in, from the deck's transition. A fade, a zoom and a push are the same here; a cover, a pull and a wipe are a slide from the same side, which is near;
 * everything else (blinds, checkerboard, vortex and the rest) is a fade. A transition is how the slide comes ON, so it becomes the slide's way in, never its way out.
 */
export function transitionFor(t: DeckTransition): { effect: Effect; exact: boolean } {
  const duration = within(t.durationMs, 100, 2000);
  switch (t.kind) {
    case "fade":
      return { effect: { effect: "fade", duration }, exact: true };
    case "zoom":
      return { effect: { effect: "zoom", duration }, exact: true };
    case "push":
    case "cover":
    case "pull":
    case "wipe": {
      const side = COMES_FROM[t.dir];
      return side ? { effect: { effect: side, duration }, exact: t.kind === "push" } : { effect: { effect: "fade", duration }, exact: false };
    }
    default:
      return { effect: { effect: "fade", duration }, exact: false };
  }
}

/** Every object of a slide of the deck, in reading order, with what they need. */
export function convertSlide(ds: DeckSlide, ctx: SlideContext): ConvertedSlide {
  const objects: OSObject[] = [];
  const assets: ConvertedSlide["assets"] = [];
  const keys: string[] = [];
  let z = 0;
  let tab = 0;
  for (const { key, hash, draft } of draftsForSlide(ds, ctx)) {
    z += 10;
    if (!draft.decorative) tab += 1;
    if (draft.asset && !assets.some((a) => a.path === draft.asset!.path)) assets.push(draft.asset);
    keys.push(key);
    objects.push(objectFrom(draft, ctx.newId(), z, tab, provenanceFor(ctx.deckId, ds, key, hash, snapshotOf(draft), ctx.importedAt)));
  }
  applyEffects(ds, objects, keys, ctx.notes);
  if (ctx.narrate && ds.notes !== "") {
    if (narrateFromNotes(ds, objects, ctx.narrate)) ctx.notes.narrated += 1;
    else ctx.notes.notesUnused += 1;
  }
  const background = backgroundOf(ds, ctx.tones);
  return {
    deck: ds,
    name: ds.name,
    transition: ds.transition ? transitionFor(ds.transition) : null,
    background,
    objects,
    assets,
    provenance: {
      sourceDeck: ctx.deckId, slideId: ds.slideId, slideIndex: ds.index, importedAt: ctx.importedAt, sourceHash: ds.hash,
      base: { name: ds.name, background, shapes: objects.map((o) => (o.provenance as unknown as { shapeId: string }).shapeId.slice(ds.slideId.length + 1)) },
    },
  };
}

/**
 * The slide as the import makes it. The caller gives it its id. With `auto`, a slide whose animations waited for a click in PowerPoint has its items come by themselves
 * (the objects keep their click steps; the slide says how fast), because a course has no presenter to click.
 */
export function slideFrom(converted: ConvertedSlide, id: string, auto?: { first: number; every: number }): Slide {
  const waits = auto !== undefined && converted.objects.some((o) => o.timing.appear === "click");
  return {
    id,
    name: converted.name,
    duration: null,
    layout: null,
    background: converted.background,
    provenance: converted.provenance,
    ...(waits ? { autoSteps: { ...auto } } : {}),
    ...(converted.transition ? { transition: { enter: converted.transition.effect } } : {}),
    baseLayer: { id: "layer-base", name: "Base", objects: converted.objects },
    layers: [],
  } as unknown as Slide;
}
