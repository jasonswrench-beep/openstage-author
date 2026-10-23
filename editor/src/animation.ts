// Animation in the editor: the names an author sees for each effect, and what an animation says in plain words. Nothing here touches a
// page, so all of it is tested directly. The effects themselves are in player/src/animation.ts, shared with the published course.

import { DEFAULT_DURATION, EFFECTS, MAX_DURATION, MIN_DURATION } from "../../player/src/animation.ts";
import type { Effect, EffectName, ObjectAnimation } from "../../player/src/types.ts";
import { plainSeconds } from "./timing.ts";

export type Phase = "enter" | "exit";

/** No effect on arrival or on leaving: what every new object starts with. */
export const STARTING_ANIMATION: ObjectAnimation = {
  enter: { effect: "none", duration: DEFAULT_DURATION },
  exit: { effect: "none", duration: DEFAULT_DURATION },
};

export const isStartingAnimation = (a: ObjectAnimation): boolean => a.enter.effect === "none" && a.exit.effect === "none";

const LABELS: Record<Phase, Record<EffectName, string>> = {
  enter: {
    none: "No effect", fade: "Fade in", slideLeft: "Slide in from the left", slideRight: "Slide in from the right",
    slideTop: "Slide in from the top", slideBottom: "Slide in from the bottom", zoom: "Grow in",
  },
  exit: {
    none: "No effect", fade: "Fade out", slideLeft: "Slide out to the left", slideRight: "Slide out to the right",
    slideTop: "Slide out to the top", slideBottom: "Slide out to the bottom", zoom: "Shrink out",
  },
};

/** The effects to choose from for arriving or for leaving, in the order the lists show them, with the words for each. */
export function effectChoices(phase: Phase): { value: EffectName; label: string }[] {
  return EFFECTS.map((value) => ({ value, label: LABELS[phase][value] }));
}

/** "Fade in, over 0.5 seconds" or "No effect". */
export function describeEffect(e: Effect, phase: Phase): string {
  return e.effect === "none" ? "No effect" : `${LABELS[phase][e.effect]}, over ${plainSeconds(e.duration)}`;
}

/** Both parts in one sentence, for announcements. */
export function describeAnimation(a: ObjectAnimation): string {
  return `Arrives: ${describeEffect(a.enter, "enter").toLowerCase()}. Leaves: ${describeEffect(a.exit, "exit").toLowerCase()}`;
}

/** How a slide arrives and leaves, in one sentence, for announcements and the panel. */
export function describeSlideTransition(t: { enter?: Effect; exit?: Effect } | undefined): string {
  const none: Effect = { effect: "none", duration: DEFAULT_DURATION };
  return `Slide in: ${describeEffect(t?.enter ?? none, "enter").toLowerCase()}. Slide out: ${describeEffect(t?.exit ?? none, "exit").toLowerCase()}`;
}

/** Whether a time is one the format allows: a whole number of milliseconds from the least to the most. */
export function validDuration(ms: number): boolean {
  return Number.isInteger(ms) && ms >= MIN_DURATION && ms <= MAX_DURATION;
}

export { MAX_DURATION, MIN_DURATION };
