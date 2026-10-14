// Looks: the other ways an object can appear besides its own. Pure logic with no DOM, so it is tested in plain node and the stage
// (which paints) and the editor's canvas (which previews) read it the same way.

import type { ObjectState, Style } from "./types.ts";

/** The names the course applies on its own: when the pointer or the keyboard is on the object, after it has been used, and when it cannot be used. */
export const READY_LOOKS = ["hover", "visited", "disabled"] as const;

/** Where an object is now: which look a rule last applied ("normal" for none), whether it has been used, and whether the pointer or the keyboard is on it. */
export interface LookNow {
  name: string;
  visited: boolean;
  hover: boolean;
}

/**
 * The looks to paint over the object's own style, earliest first, so a later one wins: "visited" once the object has been used,
 * then the look a rule applied, then "hover" while the pointer or the keyboard is on it. A look the object does not have adds nothing.
 */
export function lookLayers(states: Record<string, ObjectState>, now: LookNow): Style[] {
  const layers: Style[] = [];
  const add = (style: Style | undefined) => { if (style) layers.push(style); };
  if (now.visited) add(states["visited"]?.style);
  if (now.name !== "normal") add(states[now.name]?.style);
  if (now.hover) add(states["hover"]?.style);
  return layers;
}

/**
 * What a screen reader should hear when a rule changes an object from one look to another: the new look's own message, or nothing.
 * Going back to normal, or to the look it already has, says nothing. The course applying "hover" or "visited" on its own never asks.
 */
export function spokenOnChange(states: Record<string, ObjectState>, from: string, to: string): string | null {
  if (to === from || to === "normal") return null;
  const said = states[to]?.announce;
  return typeof said === "string" && said.trim() !== "" ? said : null;
}
