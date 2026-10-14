// Bringing slides in from a PowerPoint deck: the slides and objects, the picture files they need, the entry for the project's list of
// decks, and a report in plain words of everything that was left out or changed. This only prepares; the model puts it in.

import type { DeckSource, OSObject, Slide } from "../../../player/src/types.ts";
import { convertSlide, newNotes, placementFor, slideFrom, type ConvertNotes, type ConvertedSlide, type Placement, type Tones } from "./convert.ts";
import { type Deck, type DeckSlide } from "./deck.ts";
import { hashText } from "./hash.ts";
import type { Pkg } from "./package.ts";

/** Where a picture from a deck is kept in the project. Named from what is in it, so the same picture is one file however often it is brought in. */
export const mediaPathFor = (hash: string, ext: string): string => `assets/images/pptx-${hash}.${ext === "jpeg" ? "jpg" : ext}`;

export interface ImportRequest {
  deck: Deck;
  pkg: Pkg;
  /** The deck's file name. */
  fileName: string;
  importedAt: string;
  /** The deck slides to bring in, by their place in the deck (0 is the first). */
  chosen: number[];
  stage: { width: number; height: number };
  existingDeckIds: string[];
  /** Average colours of the decks' background pictures. */
  tones?: Tones;
  newSlideId(): string;
  newObjectId(): string;
}

export interface PreparedImport {
  deckId: string;
  source: DeckSource;
  slides: Slide[];
  assets: { path: string; bytes: Uint8Array }[];
  report: string[];
  objectCount: number;
}

/** A name for the deck that nothing else in the project has. */
export function newDeckId(fileName: string, importedAt: string, existing: string[]): string {
  const base = `deck-${hashText(`${fileName}|${importedAt}`).slice(0, 6)}`;
  let id = base;
  for (let n = 2; existing.includes(id); n++) id = `${base}${n}`;
  return id;
}

export function sourceFor(deck: Deck, deckId: string, fileName: string, importedAt: string, placement: Placement): DeckSource {
  return {
    id: deckId,
    name: fileName.slice(0, 260) || "presentation.pptx",
    importedAt,
    slideWidth: deck.slideWidth,
    slideHeight: deck.slideHeight,
    pixelsPerInch: placement.pixelsPerInch,
    offsetX: placement.offsetX,
    offsetY: placement.offsetY,
    seen: deck.slides.map((s) => s.slideId),
  };
}

export function placementOf(source: DeckSource): Placement {
  return { pixelsPerInch: source.pixelsPerInch, offsetX: source.offsetX, offsetY: source.offsetY };
}

export function prepareImport(req: ImportRequest): PreparedImport {
  const placement = placementFor(req.deck.slideWidth, req.deck.slideHeight, req.stage);
  const deckId = newDeckId(req.fileName, req.importedAt, req.existingDeckIds);
  const notes = newNotes();
  const ctx = {
    placement, notes, deckId, importedAt: req.importedAt, slideWidth: req.deck.slideWidth, slideHeight: req.deck.slideHeight,
    ...(req.tones ? { tones: req.tones } : {}),
    newId: req.newObjectId,
    mediaPath: mediaPathFor,
    bytesOf: (part: string) => req.pkg.bytes(part),
  };
  const converted: ConvertedSlide[] = [];
  for (const index of req.chosen) {
    const ds = req.deck.slides[index];
    if (ds) converted.push(convertSlide(ds, ctx));
  }
  const assets: PreparedImport["assets"] = [];
  for (const c of converted) for (const a of c.assets) if (!assets.some((x) => x.path === a.path)) assets.push(a);
  const slides = converted.map((c) => slideFrom(c, req.newSlideId()));
  const objectCount = converted.reduce((n, c) => n + c.objects.length, 0);
  return {
    deckId, source: sourceFor(req.deck, deckId, req.fileName, req.importedAt, placement), slides, assets, objectCount,
    report: describeImport(req.deck, converted, notes, placement, req.chosen),
  };
}

// ---- the report

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (names: string[]) => (names.length <= 4 ? names.join(", ") : `${names.slice(0, 4).join(", ")} and ${names.length - 4} more`);

/** Everything that was left out or changed by the import, in plain words, as a list of sentences. */
export function describeImport(deck: Deck, converted: ConvertedSlide[], notes: ConvertNotes, placement: Placement, chosen: number[]): string[] {
  const out: string[] = [];
  const objects = converted.flatMap((c) => c.objects);
  out.push(`Brought in ${plural(converted.length, "slide")} with ${plural(objects.length, "object")}.`);

  const taken = chosen.map((i) => deck.slides[i]).filter((s): s is DeckSlide => !!s);
  const left = deck.slides.length - taken.length;
  if (left > 0) out.push(`${plural(left, "slide")} of the presentation ${left === 1 ? "was" : "were"} not chosen. ${left === 1 ? "It" : "They"} can be added later: choose the same file in PowerPoint and bring it up to date.`);
  const hidden = taken.filter((s) => s.hidden);
  if (hidden.length > 0) out.push(`${plural(hidden.length, "slide")} ${hidden.length === 1 ? "is" : "are"} hidden in PowerPoint: ${list(hidden.map((s) => s.name))}. ${hidden.length === 1 ? "It was" : "They were"} brought in like the others.`);

  const noAltPictures = objects.filter((o) => o.type === "image" && !o.accessibility.decorative && o.accessibility.altText.trim() === "");
  if (noAltPictures.length > 0) out.push(`${plural(noAltPictures.length, "picture")} had no alt text in PowerPoint. Nothing was made up: the Problems list asks for each, and you can also mark one decorative.`);
  const noNameTables = objects.filter((o) => o.type === "table" && !o.accessibility.decorative && o.accessibility.altText.trim() === "");
  if (noNameTables.length > 0) out.push(`${plural(noNameTables.length, "table")} had no alt text in PowerPoint, so ${noNameTables.length === 1 ? "it has" : "they have"} no name for a screen reader yet. The Problems list asks for one.`);
  const decorative = objects.filter((o) => o.type === "shape" && o.accessibility.decorative);
  if (decorative.length > 0) out.push(`${plural(decorative.length, "shape")} with no alt text ${decorative.length === 1 ? "was" : "were"} marked decorative, as a new shape in this editor is. Open one to say what it means instead.`);

  const why = new Map<string, string[]>();
  for (const s of taken) for (const k of s.skipped) why.set(k.why, [...(why.get(k.why) ?? []), k.name]);
  for (const [reason, names] of why) out.push(`Left out, because ${reason}: ${list(names)}.`);
  if (notes.diagonalLines > 0) out.push(`${plural(notes.diagonalLines, "slanted line")} could not be drawn and ${notes.diagonalLines === 1 ? "was" : "were"} left out.`);

  const sum = (f: (s: DeckSlide) => number) => taken.reduce((n, s) => n + f(s), 0);
  const footers = sum((s) => s.left.footers);
  if (footers > 0) out.push(`Dates, footers and slide numbers (${footers}) were not brought in.`);
  const hiddenShapes = sum((s) => s.left.hidden);
  if (hiddenShapes > 0) out.push(`${plural(hiddenShapes, "hidden shape")} in PowerPoint ${hiddenShapes === 1 ? "was" : "were"} not brought in.`);
  const withNotes = taken.filter((s) => s.hasNotes).length;
  if (withNotes > 0) out.push(`Speaker notes on ${plural(withNotes, "slide")} were not brought in. They are not narration unless you make them so.`);
  const animated = taken.filter((s) => s.animated).length;
  if (animated > 0) out.push(`${plural(animated, "slide")} had animations or a transition. They were not brought in: use Animation and Timing in the editor instead.`);

  const pictured = converted.filter((c) => c.deck.backgroundPicture && c.background);
  if (pictured.length > 0) out.push(`${plural(pictured.length, "slide")} ${pictured.length === 1 ? "has" : "have"} a picture behind the text. The Problems list can only judge the text colour against the picture's average colour, which is ${list([...new Set(pictured.map((c) => c.background!))])}, so look at ${pictured.length === 1 ? "that slide" : "those slides"} yourself.`);
  const backgrounds = taken.filter((s) => s.backgroundNote);
  if (backgrounds.length > 0) out.push(`${plural(backgrounds.length, "slide")} had a background that is not one colour or one picture (${list([...new Set(backgrounds.map((s) => s.backgroundNote!))])}).`);
  for (const [note, count] of Object.entries(notes.fills)) out.push(`${plural(count, "shape")}: ${note}.`);

  const fonts = Object.entries(notes.fontsReplaced);
  if (fonts.length > 0) out.push(`Fonts a web page cannot count on were replaced by the course's own font: ${fonts.map(([f, n]) => `${f} (${plural(n, "text box", "text boxes")})`).join(", ")}.`);
  if (notes.mixedSize > 0) out.push(`${plural(notes.mixedSize, "text box", "text boxes")} had more than one text size. The size most of its words have is used for all.`);
  if (notes.mixedColour > 0) out.push(`${plural(notes.mixedColour, "text box", "text boxes")} had more than one text colour. The colour most of its words have is used for all.`);
  const forms = Object.entries(notes.formsRedrawn);
  if (forms.length > 0) out.push(`Shapes this editor cannot draw were drawn as rectangles: ${forms.map(([f, n]) => `${f} (${n})`).join(", ")}.`);
  if (notes.croppedPictures > 0) out.push(`${plural(notes.croppedPictures, "picture")} ${notes.croppedPictures === 1 ? "was" : "were"} cropped in PowerPoint and ${notes.croppedPictures === 1 ? "is" : "are"} shown whole.`);
  if (notes.tableMerged > 0) out.push(`${plural(notes.tableMerged, "table")} had merged cells. They are shown as separate cells.`);

  if (placement.offsetX > 0.5 || placement.offsetY > 0.5) out.push("The deck is a different shape from the stage, so its slides are in the middle with room either side.");
  return out;
}

export type { OSObject };
