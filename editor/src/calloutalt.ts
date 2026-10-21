// A suggested description for a highlight box, a circle or an arrow added in the recording editor (Capture's story D6).
//
// When the recording noted what was clicked (the name and kind of the item, from Windows' accessibility information), a box or arrow put in at that moment is very likely about that item,
// so "A box around the Save button." can be offered as the start of its alt text. It is only offered: it is shown beside the Alt text box with its source, and becomes the author's only when the
// author presses the button to use it. Nothing here uses a screen or the shell, so it is tested with Node alone.

import type { Item, Model as EditModel } from "../../capture-edit/src/model.ts";
import type { AltSuggestion } from "../../player/src/types.ts";
import { clockText } from "./model.ts";
import { elementPhrase, type LogEvent } from "./steps.ts";

/** How far from the moment a box or arrow appears a click can be, to count as what it is about. */
export const BEFORE_MS = 2500;
export const AFTER_MS = 1500;

/** The take, and the moment of it, that the finished video shows at a moment of the edit. Null if the screen track has nothing there. */
export function takeTimeAt(model: EditModel, editMs: number): { take: number; ms: number } | null {
  for (const track of model.tracks) {
    if (track.kind !== "screen") continue;
    for (const clip of track.clips) {
      if (clip.source.kind !== "take") continue;
      const length = clip.sourceEndMs - clip.sourceStartMs;
      if (editMs >= clip.startMs && editMs < clip.startMs + length) return { take: clip.source.take, ms: clip.sourceStartMs + (editMs - clip.startMs) };
    }
  }
  return null;
}

export interface NamedClick {
  t: number;
  name: string;
  role: string;
}

/** The named item that was clicked nearest a moment of a take (sooner than later when they are as near), within a short time either side. Null if none. */
export function namedClickNear(events: readonly LogEvent[], ms: number): NamedClick | null {
  let best: NamedClick | null = null;
  let bestDistance = Infinity;
  for (const e of events) {
    // The recorder writes an `element` line right after the `click` it belongs to, with the same time.
    if (e.type !== "element" || e.name.trim() === "") continue;
    const d = e.t - ms;
    if (d < -BEFORE_MS || d > AFTER_MS) continue;
    const distance = Math.abs(d);
    if (distance < bestDistance || (distance === bestDistance && e.t < (best?.t ?? Infinity))) {
      best = { t: e.t, name: e.name, role: e.role };
      bestDistance = distance;
    }
  }
  return best;
}

/** A suggested alt text for a shape or arrow, from the recording's log of what was clicked; null when there is nothing to base one on. */
export function suggestCalloutAlt(model: EditModel, logs: ReadonlyMap<number, readonly LogEvent[]>, item: Item): AltSuggestion | null {
  if (item.kind !== "shape" && item.kind !== "arrow") return null;
  const at = takeTimeAt(model, item.startMs);
  const events = at === null ? undefined : logs.get(at.take);
  if (at === null || events === undefined) return null;
  const hit = namedClickNear(events, at.ms);
  const what = hit === null ? null : elementPhrase({ name: hit.name, role: hit.role });
  if (hit === null || what === null) return null;
  const text = item.kind === "arrow" ? `An arrow pointing to ${what}.` : item.shape === "ellipse" ? `A circle around ${what}.` : `A box around ${what}.`;
  return {
    text,
    basis: `The name of what was clicked at ${clockText(hit.t)} in take ${at.take} (${hit.name}, ${hit.role}), noted in the recording's log. It has not been checked against the picture.`,
  };
}
