// Showing a value in a text (`{{Score}}`): what the author can choose, putting a reference into words, and keeping references right when a variable is renamed. The player's side
// is player/src/valuetext.ts; this is the editor's, with no window in it, so it is tested alone (values.test.ts).

import { BUILT_IN_VALUES, VALUE_REFERENCE } from "../../player/src/valuetext.ts";
import type { Variable } from "../../player/src/types.ts";

export interface ValueChoice {
  /** What goes between the braces. */
  value: string;
  /** What the author reads in the list. */
  label: string;
}

/** A name that can sit between braces: no brace, no line break, and not longer than a reference may be. */
export const canBeReferenced = (name: string): boolean => /^[^{}\n]{1,80}$/.test(name.trim());

/** The things an author can show in a text: first the values the course works out, then each variable of their own by name. */
export function valueChoices(variables: readonly Variable[]): ValueChoice[] {
  return [
    ...BUILT_IN_VALUES.map((v) => ({ value: v.name, label: v.label })),
    ...variables.filter((v) => canBeReferenced(v.name)).map((v) => ({ value: v.name.trim(), label: `${v.name.trim()} (a variable)` })),
  ];
}

/** The reference for a name, as it is written in a text. */
export const referenceFor = (name: string): string => `{{${name}}}`;

/** Put a reference into a text where the cursor is, or in place of what is selected. A cursor past the end puts it at the end. */
export function insertReference(text: string, name: string, start: number, end: number = start): string {
  const at = Math.max(0, Math.min(start, text.length));
  const to = Math.max(at, Math.min(end, text.length));
  return text.slice(0, at) + referenceFor(name) + text.slice(to);
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const c = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : m;
    }
    return ENTITY[e.toLowerCase()] ?? m;
  });
const encode = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Does this HTML hold a reference to a variable by this name (capitals do not matter)? A reference is read in each stretch of words between tags, as the player reads it. */
export function referencesVariable(html: string, name: string): boolean {
  const wanted = name.trim().toLowerCase();
  return html.split(/<[^>]*>/).some((stretch) => [...decode(stretch).matchAll(VALUE_REFERENCE)].some((m) => m[1]!.trim().toLowerCase() === wanted));
}

/** The HTML with every reference to one variable written with its new name, so renaming a variable does not leave its references pointing at nothing. */
export function renameReferences(html: string, from: string, to: string): string {
  const wanted = from.trim().toLowerCase();
  const parts = html.split(/(<[^>]*>)/);
  return parts
    .map((part) => {
      if (part.startsWith("<")) return part;
      return part.replace(/\{\{([^{}\n]{1,80})\}\}/g, (whole, raw: string) => (decode(raw).trim().toLowerCase() === wanted ? referenceFor(encode(to.trim())) : whole));
    })
    .join("");
}
