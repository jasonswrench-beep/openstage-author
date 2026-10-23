// The paragraphs of a text, in the editor, for timing them one at a time (a text object's `timing.paragraphs`, added in 0.41.0). The rule is the player's
// (player/src/paragraphs.ts, on the page) and the validator's (tools/validate.py): a heading, a paragraph, a quotation, or a list item with the lists inside it, in the
// order they come in the text. player/src/paragraph-cases.json holds the cases all three are tested on.

import type { PartTiming } from "../../player/src/types.ts";
import { parseHtml, type HChild, type HNode } from "./richtext.ts";

const BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "li"]);

const words = (n: HChild): string => (typeof n === "string" ? n : n.kids.map(words).join(""));
const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/** The words of each paragraph of a text's HTML, each on one line. */
export function paragraphsOf(html: string): string[] {
  const out: string[] = [];
  for (const c of parseHtml(html)) {
    if (typeof c === "string") continue;
    if (c.tag === "ul" || c.tag === "ol") {
      for (const li of c.kids) if (typeof li !== "string" && li.tag === "li") out.push(oneLine(words(li)));
    } else if (BLOCKS.has(c.tag) && c.tag !== "li") {
      out.push(oneLine(words(c)));
    }
  }
  return out;
}

/** The paragraph's own timing when it has none: always there. */
export const plainPart = (): PartTiming => ({ appear: "time", start: 0, visibleFor: null });

export const isPlainPart = (p: PartTiming): boolean => p.appear === "time" && p.start === 0 && p.visibleFor === null && p.until === undefined;

/** A timing for each of `count` paragraphs: the ones given, cut or filled out with always-there paragraphs, as a copy. */
export function partsFor(count: number, given: PartTiming[] | undefined): PartTiming[] {
  return Array.from({ length: count }, (_, i) => (given?.[i] ? structuredClone(given[i]!) : plainPart()));
}

/** A few words of a paragraph, for naming it in a list. */
export function brief(text: string, max = 48): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export type { HNode };
