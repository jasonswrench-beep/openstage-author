// The paragraphs of a text, for timing them one at a time (a text object's `timing.paragraphs`, added in 0.41.0). The same rule is in the editor
// (editor/src/paragraphs.ts, on its own HTML reader) and the validator (tools/validate.py); paragraph-cases.json holds the cases all three are tested on.
//
// A paragraph is a heading, a paragraph, a quotation, or a list item with whatever lists are inside it, counted in the order they come in the text. A list's own
// items count, the list does not, and a list inside a list item belongs to that item, as PowerPoint's own "by first level paragraphs" counts it.
// Words that sit outside all of those are not a paragraph and are always shown.

const BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "li"]);

/** The paragraphs of a text's content, which is where the text's own HTML is (not the box that holds it). */
export function blocksOf(root: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const c of Array.from(root.children)) {
    const tag = c.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") {
      for (const li of Array.from(c.children)) if (li.tagName.toLowerCase() === "li") out.push(li as HTMLElement);
    } else if (BLOCKS.has(tag)) {
      out.push(c as HTMLElement);
    }
  }
  return out;
}

/** What a paragraph says, on one line. */
export function blockWords(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The class that holds a paragraph out of sight until its timing shows it. It keeps the paragraph's room, so the lines round it do not jump. */
export const PART_HIDDEN_CLASS = "os-part-out";

/** The id the timeline knows a paragraph by: its text object's id, `#`, and its number from 0. */
export const partId = (objectId: string, index: number): string => `${objectId}#${index}`;

/** The text object and paragraph number a timeline id stands for, or null for an ordinary object's id. */
export function partOf(id: string): { objectId: string; index: number } | null {
  const at = id.lastIndexOf("#");
  if (at <= 0) return null;
  const index = Number(id.slice(at + 1));
  return Number.isInteger(index) && index >= 0 ? { objectId: id.slice(0, at), index } : null;
}
