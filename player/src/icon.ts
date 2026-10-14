// Icons: small drawings made of a few lines and curves, in a 24 by 24 box, drawn in the object's colour. They are kept in the project as
// their shapes (not as a file), so a course never depends on the icon set it came from, and they are drawn here, by the one shared
// renderer, so the editor's canvas and the course look the same.
//
// An icon is built from a short list of tags and attributes and nothing else, whatever the project file says: the same limits as the
// format's schema, checked again here, so a hand-edited file can never put a script or a link into a page.

import type { IconContent, IconShape } from "./types.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

export const ICON_TAGS = ["path", "circle", "rect", "ellipse", "line", "polyline", "polygon"] as const;

/** The size of the box every icon is drawn in. */
export const ICON_BOX = 24;
export const ICON_STROKE = 2;
export const ICON_STROKE_MIN = 0.5;
export const ICON_STROKE_MAX = 4;

const NUMBERS = ["cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2"] as const;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]*$/;
const POINTS = /^[0-9eE.,\s+-]*$/;

/**
 * The drawable shapes of whatever was stored: only the known tags, only the known attributes, numbers where numbers belong, path text
 * made of path characters. Anything else is dropped, so what comes out is always safe to draw.
 */
export function cleanShapes(input: unknown): IconShape[] {
  if (!Array.isArray(input)) return [];
  const out: IconShape[] = [];
  for (const raw of input.slice(0, 24)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const tag = r["tag"];
    if (typeof tag !== "string" || !(ICON_TAGS as readonly string[]).includes(tag)) continue;
    const shape: IconShape = { tag: tag as IconShape["tag"] };
    for (const key of NUMBERS) {
      const v = r[key];
      if (typeof v === "number" && Number.isFinite(v)) shape[key] = v;
    }
    if (typeof r["d"] === "string" && r["d"].length <= 2000 && PATH_DATA.test(r["d"])) shape.d = r["d"];
    if (typeof r["points"] === "string" && r["points"].length <= 1000 && POINTS.test(r["points"])) shape.points = r["points"];
    if (r["fill"] === "none" || r["fill"] === "currentColor") shape.fill = r["fill"];
    out.push(shape);
  }
  return out;
}

/** The stroke width to draw with: the object's own, kept within what looks right at any size. */
export function strokeWidthOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(ICON_STROKE_MAX, Math.max(ICON_STROKE_MIN, value)) : ICON_STROKE;
}

/**
 * Draw an icon. It takes the colour of the text around it (currentColor), has a rounded outline and no fill, and says nothing to a
 * screen reader: whoever uses it gives it a name (an icon on its own) or leaves it as decoration (an icon inside a button, whose label
 * is its name).
 */
export function buildIcon(doc: Document, content: Pick<IconContent, "shapes">, strokeWidth: number = ICON_STROKE): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${ICON_BOX} ${ICON_BOX}`);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(strokeWidth));
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("aria-hidden", "true");
  for (const shape of cleanShapes(content.shapes)) {
    const part = doc.createElementNS(SVG_NS, shape.tag);
    for (const [key, value] of Object.entries(shape)) if (key !== "tag") part.setAttribute(key, String(value));
    svg.appendChild(part);
  }
  return svg;
}
