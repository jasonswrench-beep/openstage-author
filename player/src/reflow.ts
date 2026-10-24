// Reflow: what the player does when the window is narrow or the page is zoomed in.
//
// A slide is a freeform stage with objects at fixed places. Scaling that down to a phone makes the text too small to read, and a
// learner who zooms in to 400 percent would have to scroll sideways, which fails WCAG 1.4.10 (Reflow). So below a certain
// width the player stops drawing the stage and shows the same objects in one column, in reading order, at their real size.
//
// This file holds the decisions that need no page: when to switch, and what to do with an object that sat on top of another one
// (text on a coloured panel, text on a picture). Stacking those as separate blocks would leave the text on the plain page, and
// white text on a white page cannot be read. The page-drawing side is in stage.ts and player.css.

import type { OSObject, Theme } from "./types.ts";
import { resolveStyle } from "./theme.ts";

/** The stage gives way to one column when the room is less than this share of the stage's width. */
export const REFLOW_BELOW = 0.7;

/** Should the slide be shown in one column? `room` and `stageWidth` are in CSS pixels. */
export function shouldReflow(room: number, stageWidth: number): boolean {
  return stageWidth > 0 && room > 0 && room < stageWidth * REFLOW_BELOW;
}

/** What to do with one object when the slide is in one column. */
export interface ReflowNote {
  /** Leave it out: it was a decorative panel or picture that only sat behind other objects. */
  hide: boolean;
  /** A colour to paint behind it, so text that was drawn on a panel or a picture still has the contrast it was given. */
  backdrop: string | null;
}

/** Is the object turned a quarter or three quarters of a turn (give or take a little), so its width and height swap places on the page? */
export function quarterTurned(rotation: number): boolean {
  const r = ((rotation % 180) + 180) % 180;
  return Math.abs(r - 90) <= 10;
}

/** The size the object has on the stage as it is seen, for keeping its shape in one column: a quarter turn swaps width and height. */
export function seenSize(o: Pick<OSObject, "geometry">): { width: number; height: number } {
  const { width, height, rotation } = o.geometry;
  return quarterTurned(rotation) ? { width: height, height: width } : { width, height };
}

/** How much a child may stick out of the object under it and still count as sitting on it, in stage pixels. */
const TOLERANCE = 6;

interface Box { x0: number; y0: number; x1: number; y1: number }

const boxOf = (o: OSObject): Box => ({ x0: o.geometry.x, y0: o.geometry.y, x1: o.geometry.x + o.geometry.width, y1: o.geometry.y + o.geometry.height });
const areaOf = (b: Box): number => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const within = (inner: Box, outer: Box): boolean =>
  inner.x0 >= outer.x0 - TOLERANCE && inner.y0 >= outer.y0 - TOLERANCE && inner.x1 <= outer.x1 + TOLERANCE && inner.y1 <= outer.y1 + TOLERANCE;

/** A colour a page can use, as the stage accepts them. */
const COLOR_VALUE = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([0-9.,%\s/]+\)|[a-z]+)$/i;

/** Red, green and blue from 0 to 255, or null for a colour this cannot read (a name, hsl, or nothing). */
export function parseColor(value: string | undefined): [number, number, number] | null {
  if (!value) return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (hex) {
    let h = hex[1]!;
    if (h.length <= 4) h = h.split("").map((c) => c + c).join("");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i.exec(value.trim());
  if (rgb) return [Math.min(255, +rgb[1]!), Math.min(255, +rgb[2]!), Math.min(255, +rgb[3]!)];
  return null;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of two colours, 1 to 21. */
export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Of the theme's own backgrounds, the one that reads best against this text colour. The theme guarantees its pairs. */
function backdropFor(text: string | undefined, theme: Theme): string | null {
  const ink = parseColor(text) ?? parseColor(theme.colors.text);
  if (!ink) return null;
  let best: string | null = null;
  let bestRatio = 0;
  for (const candidate of [theme.colors.background, theme.colors.dark, theme.colors.surface]) {
    const c = parseColor(candidate);
    if (!c) continue;
    const ratio = contrast(ink, c);
    if (ratio > bestRatio) { best = candidate; bestRatio = ratio; }
  }
  return best;
}

/** The fill of a shape, if it has a plain one. */
function fillOf(o: OSObject, theme: Theme): string | null {
  const s = resolveStyle(theme, o.style);
  const v = s["fill"] ?? s["background"];
  return typeof v === "string" && v !== "none" && v !== "transparent" && COLOR_VALUE.test(v) ? v : null;
}

/**
 * Work out, for the objects of one layer, which to leave out and which need a colour behind them.
 *
 * An object sits on a panel or picture when its box lies inside that object's box and is drawn above it. A decorative panel or picture
 * that has something on it is left out in one column (it was only a backdrop), and the text on it is painted with the panel's own
 * fill, or, for a picture, with whichever of the theme's backgrounds reads best against the text. Objects that only partly overlap
 * are not treated as sitting on each other: they just follow one another in reading order.
 */
export function planReflow(objects: OSObject[], theme: Theme): Map<string, ReflowNote> {
  const notes = new Map<string, ReflowNote>();
  const note = (id: string): ReflowNote => {
    let n = notes.get(id);
    if (!n) { n = { hide: false, backdrop: null }; notes.set(id, n); }
    return n;
  };
  const holders = objects.filter((o) => (o.type === "shape" || o.type === "image") && !o.geometry.rotation);
  for (const o of objects) {
    if (o.geometry.rotation) continue;
    const mine = boxOf(o);
    // A panel the same size as another panel does not sit on it, or two matching panels would both be left out.
    const isHolder = o.type === "shape" || o.type === "image";
    const under = holders
      .filter((h) => h !== o && h.geometry.z <= o.geometry.z && within(mine, boxOf(h)) && (isHolder ? areaOf(boxOf(h)) > areaOf(mine) : areaOf(boxOf(h)) >= areaOf(mine)))
      .sort((a, b) => areaOf(boxOf(a)) - areaOf(boxOf(b)));
    if (under.length === 0) continue;
    for (const h of under) if (h.accessibility.decorative) note(h.id).hide = true;
    if (o.type !== "text") continue;
    // The nearest thing under the text that can give it a background.
    for (const h of under) {
      if (h.type === "shape") {
        const fill = fillOf(h, theme);
        if (fill) { note(o.id).backdrop = fill; break; }
      } else {
        const style = resolveStyle(theme, o.style);
        const ink = typeof style["color"] === "string" ? style["color"] : theme.colors.text;
        note(o.id).backdrop = backdropFor(ink, theme);
        break;
      }
    }
  }
  return notes;
}
