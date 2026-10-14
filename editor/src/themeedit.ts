// Editing a theme: the arithmetic and the checks, with no screen in it, so all of it can be tested directly. The dialog that uses it is
// themeeditor.ts.
//
// A theme is the project's own copy (theme.json), so editing it never changes the built-in themes. The author starts from any built-in
// theme (or the one the project has), changes its twelve colours and its two fonts, and may add a logo. The colours that are used together
// as text on a background are checked against WCAG AA as they are changed, with the same pairs the validator uses.

import rules from "../../tools/theme-rules.json" with { type: "json" };
import { COLOR_ROLES, type ColorRole } from "../../player/src/theme.ts";
import { LOGO_LIMITS } from "../../player/src/logo.ts";
import type { Theme, ThemeLogo } from "../../player/src/types.ts";
import { contrastOf } from "./colors.ts";
import { BUILT_IN_THEMES, COLOR_ROLE_NAMES, cloneTheme } from "./themes.ts";

export const MINIMUM_RATIO: number = rules.minimumRatio;

/** A colour as a hex code, in the one form the format uses (#rrggbb, lower case), or null if it is not one. Short forms and a missing # are accepted. */
export function normaliseHex(value: string): string | null {
  const v = value.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(v)) return `#${v.split("").map((c) => c + c).join("").toLowerCase()}`;
  if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toLowerCase()}`;
  return null;
}

export interface PairReport {
  fg: ColorRole;
  bg: ColorRole;
  /** In words: "Text against Background". */
  label: string;
  ratio: number;
  ok: boolean;
}

/** How readable each pair of colours that are used together is. The pairs are the validator's, from tools/theme-rules.json. */
export function contrastReport(theme: Theme): PairReport[] {
  return (rules.pairs as [ColorRole, ColorRole][]).map(([fg, bg]) => {
    const ratio = contrastOf(theme.colors[fg], theme.colors[bg]);
    return { fg, bg, label: `${COLOR_ROLE_NAMES[fg] ?? fg} against ${COLOR_ROLE_NAMES[bg] ?? bg}`, ratio, ok: ratio >= MINIMUM_RATIO };
  });
}

/** A short plain sentence about the pairs: how many are readable, and which are not. */
export function contrastSummary(theme: Theme): string {
  const bad = contrastReport(theme).filter((p) => !p.ok);
  if (bad.length === 0) return "All of the colours that are used together are easy to read.";
  return `${bad.length === 1 ? "One pair is" : `${bad.length} pairs are`} hard to read: ${bad.map((p) => `${p.label} (${p.ratio.toFixed(1)} to 1)`).join(", ")}. WCAG AA asks for ${MINIMUM_RATIO} to 1.`;
}

/** A copy of the theme with one colour changed. A value that is not a hex colour changes nothing. */
export function setColor(theme: Theme, role: ColorRole, value: string): Theme {
  const hex = normaliseHex(value);
  if (!hex) return theme;
  const next = cloneTheme(theme);
  next.colors[role] = hex;
  return next;
}

export function setFont(theme: Theme, which: "heading" | "body", css: string): Theme {
  const next = cloneTheme(theme);
  next.fonts[which] = css;
  return next;
}

/** A name turned into an id: lower case letters, digits and hyphens, starting with a letter. */
export function themeId(name: string, taken: string[] = BUILT_IN_THEMES.map((t) => t.id)): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^[^a-z]+/, "") || "custom";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/** The name an edited theme starts with: the one it came from, marked as edited. */
export function editedName(base: Theme): string {
  return base.name.replace(/ \(edited\)$/, "") + " (edited)";
}

/**
 * What the author starts from. A built-in theme is copied under a new name, so the built-in is never touched. The project's own theme
 * is kept as it is. Either way the logo the project already has comes with it.
 */
export function startingFrom(base: Theme, current: Theme): Theme {
  const isCurrent = base.id === current.id && base.name === current.name;
  const next = cloneTheme(isCurrent ? current : base);
  if (!isCurrent) {
    next.name = editedName(base);
    next.id = themeId(next.name);
  }
  if (current.logo) next.logo = { ...current.logo };
  else if (!isCurrent) delete next.logo;
  return next;
}

/** Problems that stop a draft being saved. (Poor contrast does not: it is shown, and the author decides.) */
export function draftProblems(theme: Theme): string[] {
  const out: string[] = [];
  if (theme.name.trim() === "") out.push("Give the theme a name.");
  for (const role of COLOR_ROLES) if (normaliseHex(theme.colors[role]) !== theme.colors[role]) out.push(`${COLOR_ROLE_NAMES[role] ?? role} is not a colour. Write six hex digits, like #1a1a1a.`);
  for (const which of ["heading", "body"] as const) if (!/^[\w\s,"'.-]+$/.test(theme.fonts[which])) out.push(`The ${which} font is not usable.`);
  const logo = theme.logo;
  if (logo) {
    if (!logo.decorative && logo.alt.trim() === "") out.push("The logo needs alt text, or tick that it is decorative.");
    if (logo.decorative && logo.alt.trim() !== "") out.push("A decorative logo has no alt text. Clear it, or untick decorative.");
  }
  return out;
}

// ---- the logo

const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, Math.round(n)));

/** A logo for a picture of this natural size: no wider than 160, and inside the limits the format sets. Alt text starts empty, for the author to write. */
export function logoFromImage(src: string, natural: { width: number; height: number }, corner: ThemeLogo["corner"] = "top-right"): ThemeLogo {
  const ratio = natural.width > 0 && natural.height > 0 ? natural.height / natural.width : 0.5;
  let width = Math.min(160, natural.width > 0 ? natural.width : 160);
  let height = width * ratio;
  if (height > LOGO_LIMITS.maxHeight) {
    height = LOGO_LIMITS.maxHeight;
    width = height / ratio;
  }
  return { src, alt: "", decorative: false, corner, width: clamp(width, LOGO_LIMITS.minSize, LOGO_LIMITS.maxWidth), height: clamp(height, LOGO_LIMITS.minSize, LOGO_LIMITS.maxHeight) };
}

/** The logo at a new width, keeping its shape. A very wide or tall picture may reach a limit first, and is then fitted inside its box. */
export function resizeLogo(logo: ThemeLogo, width: number): ThemeLogo {
  const ratio = logo.width > 0 ? logo.height / logo.width : 0.5;
  const w = clamp(width, LOGO_LIMITS.minSize, LOGO_LIMITS.maxWidth);
  return { ...logo, width: w, height: clamp(w * ratio, LOGO_LIMITS.minSize, LOGO_LIMITS.maxHeight) };
}

export const LOGO_CORNERS: { value: ThemeLogo["corner"]; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
];
