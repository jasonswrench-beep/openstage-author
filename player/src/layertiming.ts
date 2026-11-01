// What a layer tells the timeline when it is shown: which of its objects are timed, what each does when it arrives or goes,
// and which timers run. The player (player.ts) and the video maker (video.ts) both ask here, so a course that is played
// and a course that is made into a video follow exactly the same rules about what is timed.

import { isTimed, type TimedObject } from "./timeline.ts";
import { partId } from "./paragraphs.ts";
import { timerContentOf } from "./timer.ts";
import type { Layer, ObjectAnimation, Timing } from "./types.ts";

/** What the page can say about the layer that the rules cannot work out for themselves. */
export interface LayerHost {
  /** Does this object have narration audio that the narration bar will play? */
  hasAudio(objectId: string): boolean;
  /** How many paragraphs a text object has once it is drawn. */
  paragraphCount(objectId: string): number;
}

export interface LayerTiming {
  /** What the timeline is told about: each timed object, and each timed paragraph of a text. */
  entries: TimedObject[];
  /** The animation of each object (or paragraph) that has a timing or an entrance to play, by id. */
  animations: Map<string, ObjectAnimation>;
  /** The timers on the layer, and how long each runs for. */
  timers: { id: string; seconds: number }[];
}

export function layerTiming(layer: Layer, host: LayerHost): LayerTiming {
  // An object with an entrance to play is listed even when it is there from the start, so its arrival can be animated.
  // A text with a timing for each paragraph has its effects for the paragraphs, not for the box.
  const timed = layer.objects.filter((o) => isTimed(o.timing) || (o.animation.enter.effect !== "none" && !o.timing.paragraphs));
  const animations = new Map<string, ObjectAnimation>();
  for (const o of timed) animations.set(o.id, o.animation);
  const entries: TimedObject[] = timed.map((o) => ({ id: o.id, timing: o.timing, hasAudio: host.hasAudio(o.id) }));
  // Each paragraph that is timed is an item of its own, as far as the text has paragraphs.
  for (const o of layer.objects) {
    if (!o.timing.paragraphs) continue;
    const count = host.paragraphCount(o.id);
    o.timing.paragraphs.slice(0, count).forEach((t, i) => {
      if (!isTimed(t as Timing) && o.animation.enter.effect === "none") return;
      animations.set(partId(o.id, i), o.animation);
      entries.push({ id: partId(o.id, i), timing: t as Timing, hasAudio: false });
    });
  }
  const timers = layer.objects.filter((o) => o.type === "timer").map((o) => ({ id: o.id, seconds: timerContentOf(o).seconds }));
  return { entries, animations, timers };
}
