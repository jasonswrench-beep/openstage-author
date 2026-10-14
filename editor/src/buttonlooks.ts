// How a button looks: a few ready-made looks to choose from, each one only a set of the button's ordinary style values using the theme's
// colours, so a button changes with the theme and stays readable (the theme's colour pairs are chosen to contrast). Choosing a look changes
// the button's colours, outline and roundness and nothing else: its words, font and size, and what it does, are left alone.
//
// Nothing here is stored. A button holds its style, as every object does; a look is only a way to fill it in, and the look a button
// has is worked out from the style when it is shown.

import type { Style } from "../../player/src/types.ts";
import { colorRef } from "./colors.ts";

export interface ButtonLook {
  id: string;
  label: string;
  description: string;
  style: Style;
}

/** The style values a look sets. Any of these a look does not mention are taken away, so a filled button loses an outline it had. */
const OWNED = ["fill", "color", "stroke", "strokeWidth", "radius"] as const;

export const BUTTON_LOOKS: ButtonLook[] = [
  { id: "filled", label: "Filled", description: "A solid block of the theme's strong colour, with light words.", style: { fill: colorRef("accentStrong"), color: colorRef("onAccentStrong"), radius: 8 } },
  { id: "pill", label: "Filled, fully rounded", description: "The same, with ends rounded into a pill.", style: { fill: colorRef("accentStrong"), color: colorRef("onAccentStrong"), radius: 999 } },
  { id: "outline", label: "Outline", description: "The slide's own background, with the strong colour as an outline and as the words.", style: { fill: colorRef("background"), color: colorRef("accentStrong"), stroke: colorRef("accentStrong"), strokeWidth: 2, radius: 8 } },
  { id: "outline-pill", label: "Outline, fully rounded", description: "An outline button with ends rounded into a pill.", style: { fill: colorRef("background"), color: colorRef("accentStrong"), stroke: colorRef("accentStrong"), strokeWidth: 2, radius: 999 } },
  { id: "soft", label: "Soft", description: "A quiet button in the theme's panel colour with a thin edge, for things that are not the main step.", style: { fill: colorRef("surface"), color: colorRef("text"), stroke: colorRef("line"), strokeWidth: 1, radius: 8 } },
];

export const CUSTOM_LOOK = "custom";

/** The look a style has, or "custom" if its colours and edges are the author's own. */
export function lookOf(style: Style): string {
  for (const look of BUTTON_LOOKS) {
    if (OWNED.every((key) => (style[key] ?? null) === (look.style[key] ?? null))) return look.id;
  }
  return CUSTOM_LOOK;
}

/** A style with a look put on it. The font, its size and anything else the author set stay. Null if there is no such look. */
export function withLook(style: Style, id: string): Style | null {
  const look = BUTTON_LOOKS.find((l) => l.id === id);
  if (!look) return null;
  const next: Style = { ...style };
  for (const key of OWNED) delete next[key];
  return { ...next, ...look.style };
}
