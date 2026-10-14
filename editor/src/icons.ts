// The icon list: reading it, and searching it. No screen in here, so all of it can be tested directly. The picker that uses it is icondialog.ts.
//
// The list is a file, editor/web/icons/lucide.json, made by tools/make_icon_catalogue.py from the Lucide icon set (ISC licence). It is
// fetched the first time the picker opens, not at start-up, because it is about 600 KB. Each icon is its name, some search words and
// its drawn shapes in exactly the form a project keeps them.

import { cleanShapes } from "../../player/src/icon.ts";
import type { IconContent, IconShape } from "../../player/src/types.ts";

export interface IconEntry {
  name: string;
  /** Search words other than the name: what the icon means, and what it is often called. */
  words: string[];
  shapes: IconShape[];
}

export interface IconList {
  set: "lucide";
  version: string;
  /** The licence text. It travels with the data, as the licence asks. */
  licence: string;
  icons: IconEntry[];
}

/** Read the file's contents. Anything that is not a drawable icon is left out, so what comes back is always safe to draw. */
export function parseIconList(raw: unknown): IconList {
  const data = (raw ?? {}) as { set?: unknown; version?: unknown; licence?: unknown; icons?: Record<string, { t?: unknown; s?: unknown }> };
  const icons: IconEntry[] = [];
  for (const [name, icon] of Object.entries(data.icons ?? {})) {
    const shapes = cleanShapes(icon?.s);
    if (shapes.length === 0 || !/^[a-z0-9][a-z0-9-]*$/.test(name)) continue;
    icons.push({ name, words: Array.isArray(icon.t) ? icon.t.filter((w): w is string => typeof w === "string").map((w) => w.toLowerCase()) : [], shapes });
  }
  icons.sort((a, b) => a.name.localeCompare(b.name));
  return { set: "lucide", version: typeof data.version === "string" ? data.version : "", licence: typeof data.licence === "string" ? data.licence : "", icons };
}

/** An icon's name as words: "arrow-right" is "arrow right". Offered as a start for alt text, never filled in. */
export function iconWords(name: string): string {
  return name.replace(/-/g, " ");
}

/** What a project keeps for an icon. */
export function contentOf(entry: IconEntry): IconContent {
  return { set: "lucide", name: entry.name, shapes: entry.shapes.map((s) => ({ ...s })) };
}

const tokens = (query: string): string[] => query.toLowerCase().split(/[\s-]+/).filter((t) => t !== "");

/**
 * How well an icon matches a search: 0 if some word of the search is nowhere in it. A word that is the icon's name, or one word of
 * it, counts most; then a name that starts with it or holds it; then the search words.
 */
export function scoreIcon(icon: IconEntry, query: string): number {
  const wanted = tokens(query);
  if (wanted.length === 0) return 1;
  const parts = icon.name.split("-");
  let score = 0;
  for (const token of wanted) {
    let best = 0;
    if (icon.name === token) best = 100;
    else if (parts.includes(token)) best = 60;
    else if (icon.name.startsWith(token)) best = 50;
    else if (icon.name.includes(token)) best = 30;
    else if (icon.words.includes(token)) best = 20;
    else if (icon.words.some((w) => w.includes(token))) best = 10;
    if (best === 0) return 0;
    score += best;
  }
  // Of two names that match every word, the shorter is the plainer icon: arrow-right before arrow-big-right.
  const extra = parts.filter((part) => !wanted.includes(part)).length;
  return Math.max(1, score - Math.min(extra, 5) * 5);
}

/** The icons that match a search, best first, then by name. An empty search is every icon by name. */
export function searchIcons(icons: readonly IconEntry[], query: string): IconEntry[] {
  return icons
    .map((icon) => ({ icon, score: scoreIcon(icon, query) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.icon.name.localeCompare(b.icon.name))
    .map((hit) => hit.icon);
}

let loading: Promise<IconList> | null = null;

/** Fetch and read the list once; later calls share the same answer. A failed fetch is tried again next time. */
export function loadIcons(fetchRaw: () => Promise<unknown>): Promise<IconList> {
  loading ??= fetchRaw().then(parseIconList).catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

/** For tests: forget what was loaded. */
export function forgetIcons(): void {
  loading = null;
}
