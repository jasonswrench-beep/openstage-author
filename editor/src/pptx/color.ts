// Colours in a PowerPoint deck: a fixed colour, or a colour of the deck's theme that is then made lighter, darker or less saturated.
// Everything is turned into a plain #rrggbb colour, because the deck's theme is not the course's theme.

import { child, type XmlNode } from "./xml.ts";

export interface Palette {
  /** The theme's colours by their scheme names: dk1, lt1, dk2, lt2, accent1 to accent6, hlink, folHlink. */
  scheme: Record<string, string>;
  /** Which scheme colour the slide's names stand for: bg1 is lt1, tx1 is dk1 and so on. */
  map: Record<string, string>;
}

export const DEFAULT_CLRMAP: Record<string, string> = {
  bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2", accent1: "accent1", accent2: "accent2", accent3: "accent3", accent4: "accent4",
  accent5: "accent5", accent6: "accent6", hlink: "hlink", folHlink: "folHlink",
};

const PRESET: Record<string, string> = {
  black: "000000", white: "ffffff", red: "ff0000", green: "008000", blue: "0000ff", yellow: "ffff00", gray: "808080", grey: "808080",
  orange: "ffa500", purple: "800080", pink: "ffc0cb", brown: "a52a2a", cyan: "00ffff", magenta: "ff00ff", lime: "00ff00", navy: "000080",
  teal: "008080", silver: "c0c0c0", maroon: "800000", olive: "808000", darkBlue: "00008b", darkRed: "8b0000", darkGreen: "006400",
  lightGray: "d3d3d3", lightGrey: "d3d3d3", darkGray: "a9a9a9", darkGrey: "a9a9a9", gold: "ffd700",
};

const SYSTEM: Record<string, string> = { windowText: "000000", window: "ffffff", menuText: "000000", highlight: "3399ff", highlightText: "ffffff", btnFace: "f0f0f0", btnText: "000000" };

const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
const toHex = (r: number, g: number, b: number) => `#${hex(r)}${hex(g)}${hex(b)}`;
const clean = (v: string): string | undefined => (/^[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : undefined);

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** The theme's colour scheme as a set of #rrggbb colours. */
export function readScheme(theme: XmlNode | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const scheme = theme && descend(theme, ["a:themeElements", "a:clrScheme"]);
  if (!scheme) return out;
  for (const c of scheme.children) {
    const name = c.name.replace(/^a:/, "");
    const inner = c.children[0];
    if (!inner) continue;
    const v = inner.name === "a:srgbClr" ? clean(inner.attrs["val"] ?? "") : inner.name === "a:sysClr" ? clean(inner.attrs["lastClr"] ?? "") ?? SYSTEM[inner.attrs["val"] ?? ""]?.toLowerCase() : undefined;
    if (v) out[name] = `#${v.replace("#", "")}`;
  }
  return out;
}

function descend(node: XmlNode, names: string[]): XmlNode | undefined {
  let at: XmlNode | undefined = node;
  for (const n of names) {
    at = child(at, n);
    if (!at) return undefined;
  }
  return at;
}

/**
 * A colour element (a:srgbClr, a:schemeClr, a:sysClr or a:prstClr, with any changes to it written inside) as #rrggbb.
 * `placeholder` is what a:schemeClr val="phClr" stands for, which is a colour the thing using the style chooses.
 */
export function colorOf(el: XmlNode | undefined, pal: Palette, placeholder?: string): string | undefined {
  if (!el) return undefined;
  let base: string | undefined;
  const val = el.attrs["val"] ?? "";
  switch (el.name) {
    case "a:srgbClr": base = clean(val) ? `#${val.toLowerCase()}` : undefined; break;
    case "a:sysClr": base = clean(el.attrs["lastClr"] ?? "") ? `#${el.attrs["lastClr"]!.toLowerCase()}` : SYSTEM[val] ? `#${SYSTEM[val]}` : undefined; break;
    case "a:prstClr": base = PRESET[val] ? `#${PRESET[val]}` : undefined; break;
    case "a:scrgbClr": {
      const pct = (a: string) => Math.max(0, Math.min(100000, Number(el.attrs[a] ?? 0))) / 100000;
      base = toHex(pct("r") * 255, pct("g") * 255, pct("b") * 255);
      break;
    }
    case "a:schemeClr": {
      if (val === "phClr") { base = placeholder; break; }
      const name = pal.map[val] ?? val;
      base = pal.scheme[name];
      break;
    }
    default: return undefined;
  }
  if (!base) return undefined;
  let [r, g, b] = [parseInt(base.slice(1, 3), 16), parseInt(base.slice(3, 5), 16), parseInt(base.slice(5, 7), 16)];
  for (const m of el.children) {
    const v = Number(m.attrs["val"]);
    if (!Number.isFinite(v)) continue;
    const f = v / 100000;
    if (m.name === "a:lumMod" || m.name === "a:lumOff" || m.name === "a:satMod") {
      const [h, s, l] = rgbToHsl(r, g, b);
      const next = m.name === "a:lumMod" ? [h, s, Math.min(1, l * f)] : m.name === "a:lumOff" ? [h, s, Math.min(1, Math.max(0, l + f))] : [h, Math.min(1, s * f), l];
      [r, g, b] = hslToRgb(next[0]!, next[1]!, next[2]!);
    } else if (m.name === "a:tint") {
      // A tint is that much of the colour with the rest white.
      [r, g, b] = [r * f + 255 * (1 - f), g * f + 255 * (1 - f), b * f + 255 * (1 - f)];
    } else if (m.name === "a:shade") {
      [r, g, b] = [r * f, g * f, b * f];
    }
  }
  return toHex(r, g, b);
}

/** What fills a shape or paints a background. `color` is the first colour of a gradient, so something close is kept. */
export type Paint = { kind: "none" } | { kind: "solid"; color: string } | { kind: "other"; what: string; color?: string };

/** The paint a container (a:spPr, a:ln, p:bgPr) specifies, or undefined if it says nothing, so something else decides. */
export function paintOf(container: XmlNode | undefined, pal: Palette, placeholder?: string): Paint | undefined {
  if (!container) return undefined;
  for (const c of container.children) {
    switch (c.name) {
      case "a:noFill": return { kind: "none" };
      case "a:solidFill": {
        const color = colorOf(c.children[0], pal, placeholder);
        return color ? { kind: "solid", color } : undefined;
      }
      case "a:gradFill": {
        const stop = child(child(c, "a:gsLst"), "a:gs");
        const color = colorOf(stop?.children[0], pal, placeholder);
        return { kind: "other", what: "a gradient", ...(color ? { color } : {}) };
      }
      case "a:pattFill": return { kind: "other", what: "a pattern" };
      case "a:blipFill": return { kind: "other", what: "a picture fill" };
    }
  }
  return undefined;
}
