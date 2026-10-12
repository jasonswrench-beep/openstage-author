// Themes. A theme is the project's design: colours, fonts and backgrounds. Objects and slides can
// refer to a theme value by name instead of giving a fixed colour, so changing the theme changes
// how the whole course looks.
//
// A reference is a string: "theme:color.accent", "theme:font.heading" or, for a slide background,
// "theme:bg.dark". Anything else is an ordinary value and is used as it is.

import type { Style, Theme, ThemeBackground } from "./types.ts";

export const COLOR_ROLES = ["background", "surface", "text", "muted", "accent", "accentStrong", "onAccentStrong", "dark", "onDark", "good", "bad", "line"] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

/** Style properties whose value may be a theme reference. */
const THEMED_KEYS = ["color", "fill", "stroke", "background", "fontFamily"] as const;

export const isThemeRef = (v: unknown): v is string => typeof v === "string" && v.startsWith("theme:");

/** The theme colour a reference names, as a hex string. "" if there is no such colour. */
export function themeColor(theme: Theme, ref: string): string {
  return theme.colors[ref.slice("theme:color.".length) as ColorRole] ?? "";
}

export const colorRef = (role: ColorRole): string => `theme:color.${role}`;

/** A theme value as a plain value: a colour, or a font. Unknown references give "", which a
 *  renderer treats as not set. Ordinary values pass through. */
export function resolveValue(theme: Theme, value: string | number): string | number {
  if (!isThemeRef(value)) return value;
  if (value.startsWith("theme:color.")) return themeColor(theme, value);
  if (value.startsWith("theme:font.")) return theme.fonts[value.slice("theme:font.".length) as "heading" | "body"] ?? "";
  return "";
}

/** A copy of a style with every theme reference replaced by what it stands for. */
export function resolveStyle(theme: Theme, style: Style): Style {
  const out: Style = { ...style };
  for (const key of THEMED_KEYS) {
    const v = out[key];
    if (isThemeRef(v)) {
      const r = resolveValue(theme, v);
      if (r === "") delete out[key];
      else out[key] = r;
    }
  }
  return out;
}

const roleOrHex = (theme: Theme, c: string): string => theme.colors[c as ColorRole] ?? c;

/** CSS for a background: a theme background, a hex colour, or null for the theme's default. */
export function backgroundCss(theme: Theme, value: string | null): string {
  let bg: ThemeBackground | undefined;
  if (value && value.startsWith("theme:bg.")) bg = theme.backgrounds[value.slice("theme:bg.".length) as keyof Theme["backgrounds"]];
  else if (value && /^#[0-9a-fA-F]{6}$/.test(value)) return value;
  bg ??= theme.backgrounds.default;
  return bg.type === "solid"
    ? roleOrHex(theme, bg.color)
    : `linear-gradient(${bg.angle}deg, ${roleOrHex(theme, bg.from)}, ${roleOrHex(theme, bg.to)})`;
}

/** The colours a background is made of: one for solid, two for a gradient. */
export function backgroundColors(theme: Theme, value: string | null): string[] {
  let bg: ThemeBackground | undefined;
  if (value && value.startsWith("theme:bg.")) bg = theme.backgrounds[value.slice("theme:bg.".length) as keyof Theme["backgrounds"]];
  else if (value && /^#[0-9a-fA-F]{6}$/.test(value)) return [value];
  bg ??= theme.backgrounds.default;
  return bg.type === "solid" ? [roleOrHex(theme, bg.color)] : [roleOrHex(theme, bg.from), roleOrHex(theme, bg.to)];
}

/** Is this a theme reference the theme actually defines? */
export function themeRefKnown(theme: Theme, ref: string): boolean {
  if (ref.startsWith("theme:color.")) return themeColor(theme, ref) !== "";
  if (ref.startsWith("theme:font.")) return resolveValue(theme, ref) !== "";
  if (ref.startsWith("theme:bg.")) return ref.slice("theme:bg.".length) in theme.backgrounds;
  return false;
}
