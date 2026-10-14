// Timing in the editor: how long a time is in words, how what an author types becomes milliseconds, and what an object's
// timing says in plain language. Nothing here touches a page, so all of it is tested directly. The format keeps whole
// milliseconds, like a slide's duration; authors work in seconds.

import type { Timing } from "../../player/src/types.ts";

/** The longest a time can be, an hour, which is also the schema's limit. */
export const MAX_MS = 3_600_000;

/** Always there: the timing every new object starts with. */
export const STARTING_TIMING: Timing = { appear: "time", start: 0, visibleFor: null };

export const isStartingTiming = (t: Timing): boolean => t.appear === "time" && t.start === 0 && t.visibleFor === null;

/**
 * What an author typed in a seconds box. Whole or decimal seconds up to three places ("2", "2.5", "0.25") become
 * milliseconds. Blank is null (nothing set). Anything else, or more than an hour, is undefined: not a time.
 */
export function parseSeconds(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return undefined;
  const ms = Math.round(Number(t) * 1000);
  return ms > MAX_MS ? undefined : ms;
}

/** Milliseconds as the author types them: 2500 is "2.5", 3000 is "3". */
export function secondsText(ms: number): string {
  return String(Math.round(ms) / 1000);
}

/** "1 second", "2.5 seconds". */
export function plainSeconds(ms: number): string {
  const s = Math.round(ms) / 1000;
  return `${s} ${s === 1 ? "second" : "seconds"}`;
}

/**
 * What a timing says, for the Properties panel, the Timing list and the announcements. `onLayer` is for an object on a layer
 * other than the base layer, whose times count from when that layer is shown, not from when the slide opens.
 */
export function describeTiming(t: Timing, onLayer = false, clipName?: string): string {
  if (isStartingTiming(t)) return "Always there";
  if (t.appear === "media") {
    // Counted on the clip's own time: playing, pausing, skipping and going back all move it.
    const clip = clipName ?? "its video or audio";
    const appears = t.start === 0 ? `Shows from the start of ${clip}` : `Appears ${plainSeconds(t.start)} into ${clip}`;
    return t.visibleFor === null ? `${appears}, then stays` : `${appears}, then disappears ${plainSeconds(t.visibleFor)} later`;
  }
  const origin = t.appear === "narration" ? "its narration starts" : onLayer ? "its layer is shown" : "the slide opens";
  const appears = t.appear === "time" && t.start === 0
    ? (onLayer ? "Shows when its layer is shown" : "Shows when the slide opens")
    : t.appear === "narration" && t.start === 0
      ? "Appears when its narration starts"
      : `Appears ${plainSeconds(t.start)} after ${origin}`;
  return t.visibleFor === null ? `${appears}, then stays` : `${appears}, then disappears ${plainSeconds(t.visibleFor)} later`;
}
