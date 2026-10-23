// The one bit of style a span of text may carry: a colour, and a size as a share of the text object's own size. Text objects hold author-written HTML and only a
// small set of tags and attributes is let through (see sanitize.ts); a span may also say `style="color:#c00000;font-size:120%"`, and nothing else in a style survives.
// Pure, so the editor's text editing and the course's sanitising use the same rule, and both are tested without a page.

/** The smallest and largest size a span may have, as a percentage of the object's size. Outside this, text is unreadable or breaks its box. */
export const SPAN_SIZE = { min: 50, max: 300 } as const;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i;
const PERCENT = /^(\d{2,3}(?:\.\d+)?)%$/;

/** A colour as six hex digits in lower case, from `#rgb`, `#rrggbb` or `rgb(r, g, b)`, or null if it is anything else (a name, a variable, a gradient). */
export function spanColour(value: string): string | null {
  const v = value.trim();
  if (HEX.test(v)) {
    const h = v.slice(1).toLowerCase();
    return `#${h.length === 3 ? h.split("").map((c) => c + c).join("") : h}`;
  }
  const m = RGB.exec(v);
  if (!m) return null;
  const parts = [m[1], m[2], m[3]].map(Number);
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return `#${parts.map((n) => n!.toString(16).padStart(2, "0")).join("")}`;
}

/** A size as a whole percentage within what a span may have, or null. */
export function spanSize(value: string): number | null {
  const m = PERCENT.exec(value.trim());
  if (!m) return null;
  const n = Math.round(Number(m[1]));
  return n >= SPAN_SIZE.min && n <= SPAN_SIZE.max ? n : null;
}

/**
 * What survives of a style attribute: `color:#rrggbb` and `font-size:N%`, in that order, with the same colour and size written the same way, or "" when neither is there.
 * Anything else in it (a font, a background, a position, a url, a script in a colour) is dropped.
 */
export function safeSpanStyle(raw: string | null | undefined): string {
  if (!raw) return "";
  let colour: string | null = null;
  let size: number | null = null;
  for (const part of raw.split(";")) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    const name = part.slice(0, at).trim().toLowerCase();
    const value = part.slice(at + 1);
    if (name === "color") colour = spanColour(value) ?? colour;
    else if (name === "font-size") size = spanSize(value) ?? size;
  }
  const out: string[] = [];
  if (colour) out.push(`color:${colour}`);
  if (size !== null) out.push(`font-size:${size}%`);
  return out.join(";");
}

/** The style the import writes for a part of a text that has its own colour or size: a size is a share of the object's. Empty if there is neither. */
export function spanStyleFor(colour: string | undefined, sizePercent: number | undefined): string {
  return safeSpanStyle(`${colour ? `color:${colour};` : ""}${sizePercent !== undefined ? `font-size:${sizePercent}%` : ""}`);
}
