// Bringing slides in from a PowerPoint deck: the slides and objects, the picture files they need, the entry for the project's list of
// decks, and a report in plain words of everything that was left out or changed. This only prepares; the model puts it in.

import type { DeckSource, OSObject, Slide } from "../../../player/src/types.ts";
import { convertSlide, newNotes, placementFor, slideFrom, type ConvertNotes, type ConvertedSlide, type Placement, type Tones } from "./convert.ts";
import { EMU_PER_INCH, type Deck, type DeckSlide } from "./deck.ts";
import { hashText } from "./hash.ts";
import type { Pkg } from "./package.ts";
import type { Narration } from "../narration.ts";

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
  /** Makes narration from words. When it is given, the speaker notes of each slide become that slide's narration. */
  narrate?: (script: string) => Narration;
  /** When it is given, a slide whose animations wait for a click in PowerPoint has its items come by themselves: the first after `first` ms, then one every `every` ms. Absent: they wait for the learner. */
  autoSteps?: { first: number; every: number };
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
    ...(req.narrate ? { narrate: req.narrate } : {}),
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
  const slides = converted.map((c) => slideFrom(c, req.newSlideId(), req.autoSteps));
  const objectCount = converted.reduce((n, c) => n + c.objects.length, 0);
  return {
    deckId, source: sourceFor(req.deck, deckId, req.fileName, req.importedAt, placement), slides, assets, objectCount,
    report: describeImport(req.deck, converted, notes, placement, req.chosen, req.autoSteps),
  };
}

// ---- the report

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (names: string[]) => (names.length <= 4 ? names.join(", ") : `${names.slice(0, 4).join(", ")} and ${names.length - 4} more`);

/** Everything that was left out or changed by the import, in plain words, as a list of sentences. */
export function describeImport(deck: Deck, converted: ConvertedSlide[], notes: ConvertNotes, placement: Placement, chosen: number[], auto?: { first: number; every: number }): string[] {
  const out: string[] = [];
  const objects = converted.flatMap((c) => c.objects);
  out.push(`Brought in ${plural(converted.length, "slide")} with ${plural(objects.length, "object")}.`);

  const taken = chosen.map((i) => deck.slides[i]).filter((s): s is DeckSlide => !!s);
  const left = deck.slides.length - taken.length;
  if (left > 0) out.push(`${plural(left, "slide")} of the presentation ${left === 1 ? "was" : "were"} not chosen. ${left === 1 ? "It" : "They"} can be added later: choose the same file in PowerPoint and bring it up to date.`);
  const hidden = taken.filter((s) => s.hidden);
  if (hidden.length > 0) out.push(`${plural(hidden.length, "slide")} ${hidden.length === 1 ? "is" : "are"} hidden in PowerPoint: ${list(hidden.map((s) => s.name))}. ${hidden.length === 1 ? "It was" : "They were"} brought in like the others.`);

  // What a layout or master draws on every slide is furniture and is reported on its own; the lines about alt text are about what is on the slides themselves.
  const furnitureOf = (o: OSObject) => /\/[lm]\d+$/.test(String((o.provenance as unknown as { shapeId?: string } | null)?.shapeId ?? ""));
  const noAltPictures = objects.filter((o) => !furnitureOf(o) && o.type === "image" && !o.accessibility.decorative && o.accessibility.altText.trim() === "");
  if (noAltPictures.length > 0) out.push(`${plural(noAltPictures.length, "picture")} had no alt text in PowerPoint. Nothing was made up: the Problems list asks for each, and you can also mark one decorative.`);
  const noNameTables = objects.filter((o) => !furnitureOf(o) && o.type === "table" && !o.accessibility.decorative && o.accessibility.altText.trim() === "");
  if (noNameTables.length > 0) out.push(`${plural(noNameTables.length, "table")} had no alt text in PowerPoint, so ${noNameTables.length === 1 ? "it has" : "they have"} no name for a screen reader yet. The Problems list asks for one.`);
  const decorative = objects.filter((o) => !furnitureOf(o) && o.type === "shape" && o.accessibility.decorative);
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
  if (notes.narrated > 0) out.push(`Speaker notes became the narration of ${plural(notes.narrated, "slide")}: each slide's first heading, or its first text, says them when the slide opens, in the course's usual voice, and the words are not shown on the slide. You can read and change them in Properties with nothing selected (Narration on this slide), or all together in the Narration window (the toolbar). The audio is made there.`);
  if (notes.notesUnused > 0) out.push(`Speaker notes on ${plural(notes.notesUnused, "slide")} could not become narration, because everything on ${notes.notesUnused === 1 ? "that slide is" : "those slides are"} decoration, so there is nothing to say them.`);
  if (withNotes > 0 && notes.narrated + notes.notesUnused === 0) out.push(`Speaker notes on ${plural(withNotes, "slide")} were not brought in. To have them as narration, tick "Use speaker notes as narration" when you choose the slides.`);
  if (notes.animated > 0) {
    out.push(`${plural(notes.animated, "object")} had an entrance animation in PowerPoint and ${notes.animated === 1 ? "has" : "have"} it here.${notes.waiting > 0 ? (auto
      ? ` ${plural(notes.waiting, "object")} waited for a click in PowerPoint. Here they come by themselves, in the order of PowerPoint's clicks: the first ${auto.first / 1000} seconds after the slide opens, then one every ${auto.every / 1000} seconds. The learner can pause, press Show next item to bring the next one at once, or show everything. You can change the pace, or have them wait for the learner, in a slide's Timing (select no object).`
      : ` ${plural(notes.waiting, "object")} wait${notes.waiting === 1 ? "s" : ""} for the learner: a button, Show next item, shows them one step at a time, in the order of PowerPoint's clicks, and Show everything now shows them all.`) : ""}`);
    if (notes.animationApproximated > 0) out.push(`${plural(notes.animationApproximated, "entrance")} used an effect this editor does not have, so ${notes.animationApproximated === 1 ? "it fades" : "they fade"} in instead.`);
  }
  const gone = { exit: 0, emphasis: 0, path: 0, byParagraph: 0, interactive: 0 };
  for (const s of taken) for (const k of Object.keys(gone) as (keyof typeof gone)[]) gone[k] += s.animationLeft[k];
  const leftOut = [
    gone.exit > 0 ? `${plural(gone.exit, "exit effect")}` : "",
    gone.emphasis > 0 ? `${plural(gone.emphasis, "emphasis effect")}` : "",
    gone.path > 0 ? `${plural(gone.path, "motion path")}` : "",
    gone.interactive > 0 ? `${plural(gone.interactive, "animation started by clicking a shape", "animations started by clicking a shape")}` : "",
  ].filter((x) => x !== "");
  if (leftOut.length > 0) out.push(`Not brought in: ${leftOut.join(", ")}. What they moved or removed stays as it is when the slide opens: use Timing and Animation in the editor if it should come or go.`);
  if (gone.byParagraph > 0) out.push(`${plural(gone.byParagraph, "text box", "text boxes")} came in one paragraph at a time in PowerPoint. The whole box comes in at once here.`);
  const moved = converted.filter((c) => c.transition);
  if (moved.length > 0) {
    const near = moved.filter((c) => !c.transition!.exact).length;
    out.push(`${plural(moved.length, "slide")} had a transition in PowerPoint. It is how the slide comes in here (Slide animation (in), with nothing selected on the slide).${near > 0 ? ` ${plural(near, "transition")} used an effect this editor does not have, so ${near === 1 ? "it uses" : "they use"} the nearest: a fade, or a slide in from the same side.` : ""} A learner whose device asks for less motion, or who turns animation off, sees none.`);
  }

  const tiled = taken.filter((s) => s.backgroundTile).length;
  if (tiled > 0) out.push(`${plural(tiled, "slide")} had a picture that repeats across the background. It is drawn here as one colour, the picture's average, so the slide's look is close but plainer.`);
  const furniture = new Set(converted.flatMap((c) => c.deck.shapes.filter((s) => s.template).map((s) => `${s.template}:${s.id}`)));
  const furnished = converted.filter((c) => c.deck.shapes.some((s) => s.template)).length;
  if (furniture.size > 0) out.push(`${plural(furniture.size, "shape")} that the layouts and master draw on every slide (a bar, a logo, a corner mark) ${furniture.size === 1 ? "was" : "were"} brought in on ${plural(furnished, "slide")} as decoration, behind each slide's own shapes.`);
  // A title placed off the slide is how a deck gives a slide a heading for a screen reader when a picture is the title people see. It is kept, and says so.
  const stageW = (deck.slideWidth / EMU_PER_INCH) * placement.pixelsPerInch + 2 * placement.offsetX;
  const stageH = (deck.slideHeight / EMU_PER_INCH) * placement.pixelsPerInch + 2 * placement.offsetY;
  const unseen = converted.filter((c) => c.objects.some((o) => o.type === "text" && !o.accessibility.decorative && o.accessibility.role === "heading"
    && (o.geometry.y + o.geometry.height <= 0 || o.geometry.y >= stageH || o.geometry.x + o.geometry.width <= 0 || o.geometry.x >= stageW))).length;
  if (unseen > 0) out.push(`${plural(unseen, "slide")} ${unseen === 1 ? "has" : "have"} a title placed off the slide, as decks do when a picture is the title people see. It is kept as the slide's heading, first in reading order, so a screen reader still has it. It is not seen on the slide.`);
  const pictured = converted.filter((c) => c.deck.backgroundPicture && c.background);
  if (pictured.length > 0) out.push(`${plural(pictured.length, "slide")} ${pictured.length === 1 ? "has" : "have"} a picture behind the text. The Problems list can only judge the text colour against the picture's average colour, which is ${list([...new Set(pictured.map((c) => c.background!))])}, so look at ${pictured.length === 1 ? "that slide" : "those slides"} yourself.`);
  const backgrounds = taken.filter((s) => s.backgroundNote);
  if (backgrounds.length > 0) out.push(`${plural(backgrounds.length, "slide")} had a background that is not one colour or one picture (${list([...new Set(backgrounds.map((s) => s.backgroundNote!))])}).`);
  for (const [note, count] of Object.entries(notes.fills)) out.push(`${plural(count, "shape")}: ${note}.`);

  const fonts = Object.entries(notes.fontsReplaced);
  if (fonts.length > 0) out.push(`Fonts a web page cannot count on were replaced by the course's own font: ${fonts.map(([f, n]) => `${f} (${plural(n, "text box", "text boxes")})`).join(", ")}.`);
  if (notes.mixedSize > 0) out.push(`${plural(notes.mixedSize, "text box", "text boxes")} had more than one text size. The size most of its words have is the box's, and each part with another size keeps it as a share of the box's.`);
  if (notes.mixedColour > 0) out.push(`${plural(notes.mixedColour, "text box", "text boxes")} had more than one text colour. The colour most of its words have is the box's, and each part with another colour keeps it. Each colour is checked for contrast like any other.`);
  if (notes.shrinks > 0) out.push(`${plural(notes.shrinks, "text box", "text boxes")} shrink${notes.shrinks === 1 ? "s" : ""} the words when they do not fit, as PowerPoint's "shrink text on overflow" does, but never below half size or 12 pixels. Fonts differ a little between PowerPoint and a web page, so this keeps each box looking as it did. You can turn it off in a text's Properties.`);
  const forms = Object.entries(notes.formsRedrawn);
  if (forms.length > 0) out.push(`Shapes this editor cannot draw were drawn as rectangles: ${forms.map(([f, n]) => `${f} (${n})`).join(", ")}.`);
  if (notes.croppedPictures > 0) out.push(`${plural(notes.croppedPictures, "picture")} ${notes.croppedPictures === 1 ? "was" : "were"} cropped in PowerPoint and ${notes.croppedPictures === 1 ? "is" : "are"} shown whole.`);
  if (notes.tableMerged > 0) out.push(`${plural(notes.tableMerged, "table")} had merged cells. They are shown as separate cells.`);

  if (placement.offsetX > 0.5 || placement.offsetY > 0.5) out.push("The deck is a different shape from the stage, so its slides are in the middle with room either side.");
  return out;
}

export type { OSObject };
