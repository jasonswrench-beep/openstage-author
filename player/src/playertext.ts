// The player's own words: what its buttons, labels and announcements say. Each has a key and the English it starts as, in
// tools/player-text.json, which the validator and the translation tool read too. A course may replace any of them with its own
// words (the project's `playerText`), so a translated course speaks its language all the way through, not only on its slides.
//
// One course is shown on a page, so the choice is made once, when the player starts (setPlayerText), and every part of the player
// asks t(). The editing stage never sets it, so it shows the defaults.

import catalog from "../../tools/player-text.json" with { type: "json" };

/** Every key the player has a phrase for. A key that is not in the catalog does not compile. */
export type PlayerTextKey = keyof typeof catalog.keys;

/** The keys that have a form for one and a form for any other number: "term" and "terms" are `x.one` and `x.other`, and the key is `x`. */
export type PluralKey = Extract<PlayerTextKey, `${string}.one`> extends infer K ? (K extends `${infer B}.one` ? B : never) : never;

const DEFAULTS: Record<string, string> = Object.fromEntries(Object.entries(catalog.keys).map(([key, entry]) => [key, entry.text]));

let own: Record<string, string> = {};

/** Use a course's own words for the player's. Anything that is not one of the player's keys, or is empty, is ignored. Undefined goes back to the defaults. */
export function setPlayerText(table: Record<string, string> | undefined): void {
  own = {};
  for (const [key, value] of Object.entries(table ?? {})) {
    if (typeof value === "string" && value.trim() !== "" && Object.hasOwn(DEFAULTS, key)) own[key] = value;
  }
}

function fill(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => (Object.hasOwn(values, name) ? String(values[name]) : whole));
}

/** The words for a key, with {name} places filled from `values`. A place with no value is left as it is. */
export function t(key: PlayerTextKey, values?: Record<string, string | number>): string {
  return fill(own[key] ?? DEFAULTS[key] ?? key, values);
}

/** The course's own words for a key whose name is built from something in the course (a kind of file), or this fallback, which is that key's English. */
export function ownOr(key: string, fallback: string): string {
  return own[key] ?? fallback;
}

/** The English words for a key, whatever the course says. For the editor, which is written in English and offers the same words as narration. */
export function english(key: PlayerTextKey, values?: Record<string, string | number>): string {
  return fill(DEFAULTS[key] ?? key, values);
}

/** The form for one, or for any other number, of a phrase that counts something. `n` is also available to the phrase as {n}. */
export function tn(key: PluralKey, n: number, values?: Record<string, string | number>): string {
  return t(`${key}.${n === 1 ? "one" : "other"}` as PlayerTextKey, { n, ...values });
}
