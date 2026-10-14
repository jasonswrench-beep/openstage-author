// Looks: the other ways an object can appear besides its own, which the format calls states. Pure helpers with no screen code,
// so the model, the Properties panel and the tests all read them the same way.

import type { OSObject, Style } from "../../player/src/types.ts";
import { normalizeHex } from "./content.ts";

/** The looks the course applies on its own. The same three the player knows (player/src/looks.ts); a test keeps them equal. */
export const READY_LOOKS: { name: string; label: string; use: string }[] = [
  { name: "hover", label: "Hover or focus", use: "Used while the pointer is over the object, and also while the keyboard is on it, so keyboard users see the same change." },
  { name: "visited", label: "Visited", use: "Used after the learner has pressed the object, for as long as the slide stays open." },
  { name: "disabled", label: "Disabled", use: "Used when a rule applies it. A disabled button cannot be pressed, and a screen reader says it is unavailable." },
];

export const LOOK_NAME_MAX = 40;
/** The longest spoken message the format allows. */
export const ANNOUNCE_MAX = 200;

/** The things about an object's appearance that a look can set. */
export type LookField = "fontFamily" | "fontSize" | "color" | "fill" | "stroke" | "strokeWidth" | "opacity";

// The fields are the ones the object's Appearance box already has, plus how solid it is. An icon's line width is drawn once, so it stays out.
// An interaction, table, input and the like paint themselves in the theme's colours, so they have no looks to set.
const FIELDS: Record<string, LookField[]> = {
  text: ["fontFamily", "fontSize", "color", "opacity"],
  button: ["fontFamily", "fontSize", "color", "fill", "opacity"],
  icon: ["color", "opacity"],
  shape: ["fill", "stroke", "strokeWidth", "opacity"],
  image: ["opacity"],
};

export const lookFieldsFor = (type: string): LookField[] => FIELDS[type] ?? [];
export const canHaveLooks = (type: string): boolean => lookFieldsFor(type).length > 0;
export const isReadyLook = (name: string): boolean => READY_LOOKS.some((r) => r.name === name);

/** What the author sees for a look: a ready-made one by its plain name, any other by the name they gave it. */
export const lookLabel = (name: string): string => READY_LOOKS.find((r) => r.name === name)?.label ?? name;

/** One line about when a look is used. */
export function lookUse(name: string): string {
  return READY_LOOKS.find((r) => r.name === name)?.use
    ?? "Used when a rule applies it. Add a rule to any object on this slide, choose Change an object's look, and pick this object and this look.";
}

/** A look as the Properties panel lists it. */
export interface LookInfo {
  name: string;
  label: string;
  ready: boolean;
  /** The object has this look (a ready-made look that is not set is offered, but the object does not have it). */
  set: boolean;
  announce: string;
}

/** The looks an object can be shown in or edited in: the three ready-made, then any other it has. */
export function looksOf(obj: OSObject): LookInfo[] {
  const info = (name: string): LookInfo => ({ name, label: lookLabel(name), ready: isReadyLook(name), set: name in obj.states, announce: obj.states[name]?.announce ?? "" });
  return [...READY_LOOKS.map((r) => info(r.name)), ...Object.keys(obj.states).filter((n) => !isReadyLook(n)).map(info)];
}

/** Whether a look can be edited on this object: its own appearance, a ready-made look, or one it has. */
export const editableLook = (obj: OSObject, name: string): boolean => name === "normal" || isReadyLook(name) || name in obj.states;

/** Why a name cannot be used for a new look, or null if it can. `others` are the names the object already has. */
export function lookNameProblem(raw: string, others: string[]): string | null {
  const name = raw.trim();
  if (name === "") return "Give the look a name.";
  if (name.length > LOOK_NAME_MAX) return `A look's name can be up to ${LOOK_NAME_MAX} characters.`;
  if (/[\u0000-\u001f\u007f]/.test(name)) return "A look's name is a few plain words, with no line breaks.";
  const lower = name.toLowerCase();
  if (lower === "normal") return "Normal is the object's own appearance, so it cannot also be a look. Choose another name.";
  const ready = READY_LOOKS.find((r) => r.name === lower || r.label.toLowerCase() === lower);
  if (ready) return `${ready.label} is a ready-made look. Choose it in the Look to edit list instead.`;
  if (others.some((o) => o.toLowerCase() === lower)) return `This object already has a look called ${name}.`;
  return null;
}

/** How solid an object is painted, 0 to 1. A disabled object is not asked for contrast (WCAG), so the validator counts it as fully solid; so do we. */
export function solidnessOf(style: Style, look: string): number {
  const v = style["opacity"];
  if (look === "disabled" || typeof v !== "number" || !Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

/** A colour painted at some solidness over another, as a hex code. Used to judge readability the way it will look. */
export function mixHex(top: string, back: string, solidness: number): string {
  const a = normalizeHex(top);
  const b = normalizeHex(back);
  if (!a || !b) return top;
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const part = (i: number) => Math.round(channel(a, i) * solidness + channel(b, i) * (1 - solidness)).toString(16).padStart(2, "0");
  return `#${part(0)}${part(1)}${part(2)}`;
}

/** The solidness as the author types it: a whole percentage. */
export const percentOf = (solidness: number): number => Math.round(solidness * 100);
