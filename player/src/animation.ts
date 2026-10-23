// How an object arrives and leaves: a short fade, slide or grow when its timing shows it, and the same in reverse when its timing
// hides it. Only the effects themselves live here. When they play is decided by the timeline (timeline.ts) and the player.
//
// Motion is a barrier for some learners, so it is kept small and always optional:
//   - every effect lasts at most two seconds, and nothing flashes or repeats;
//   - none plays when the learner's device asks for reduced motion;
//   - the player has a "Turn off animation" button, so a learner can stop it whatever the device says;
//   - the effects change only how an object arrives. The content is in the page, readable, from the start of the effect.

import type { Effect, EffectName, ObjectAnimation } from "./types.ts";

export const EFFECTS: readonly EffectName[] = ["none", "fade", "slideLeft", "slideRight", "slideTop", "slideBottom", "wipeLeft", "wipeRight", "wipeTop", "wipeBottom", "zoom"];

export const MIN_DURATION = 100;
export const MAX_DURATION = 2000;
export const DEFAULT_DURATION = 500;

/** How long after an effect should be over a timer finishes it, if the page has not. */
export const GUARD_MS = 400;

/** How far, in stage pixels, a slide starts away from where the object rests. A short move: enough to see, not enough to chase. */
export const SLIDE_DISTANCE = 40;
/** How much smaller a zoom starts. */
export const ZOOM_FROM = 0.85;

/** What a wipe has shown of an object when it starts (an entrance) or ends (an exit): none of it, with the edge it comes from or goes toward named. Added in 0.40.0. */
export const WIPE_AWAY: Partial<Record<EffectName, string>> = {
  wipeLeft: "inset(0 100% 0 0)", wipeRight: "inset(0 0 0 100%)", wipeTop: "inset(0 0 100% 0)", wipeBottom: "inset(100% 0 0 0)",
};
/** All of the object showing. */
export const WIPE_WHOLE = "inset(0 0 0 0)";

export type Phase = "enter" | "exit";

export const NO_EFFECT: Effect = { effect: "none", duration: DEFAULT_DURATION };

/** Does this animation do anything at all? */
export function hasAnimation(a: ObjectAnimation): boolean {
  return a.enter.effect !== "none" || a.exit.effect !== "none";
}

/** Does a slide's transition do anything at all? */
export function hasSlideTransition(t: { enter?: Effect; exit?: Effect } | undefined): boolean {
  return !!t && ((t.enter !== undefined && t.enter.effect !== "none") || (t.exit !== undefined && t.exit.effect !== "none"));
}

/** Keep a time within what the format allows. */
export function clampDuration(ms: number): number {
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(ms)));
}

/**
 * The keyframes of an effect, from how the object looks away to how it looks at rest, for an entrance, and the reverse for an exit.
 * `translate` and `scale` are used, not `transform`, so an object that is rotated keeps its rotation while it moves. Null for "none".
 */
export function frames(effect: EffectName, phase: Phase): Keyframe[] | null {
  // A wipe shows or hides the object from one edge across, nothing moves and nothing fades. The page has all of it from the start; only what is drawn is clipped.
  const wiped = WIPE_AWAY[effect];
  if (wiped) {
    const shut: Keyframe = { clipPath: wiped };
    const open: Keyframe = { clipPath: WIPE_WHOLE };
    return phase === "enter" ? [shut, open] : [open, shut];
  }
  const away: Keyframe | null =
    effect === "fade" ? { opacity: 0 }
    : effect === "slideLeft" ? { opacity: 0, translate: `${-SLIDE_DISTANCE}px 0` }
    : effect === "slideRight" ? { opacity: 0, translate: `${SLIDE_DISTANCE}px 0` }
    : effect === "slideTop" ? { opacity: 0, translate: `0 ${-SLIDE_DISTANCE}px` }
    : effect === "slideBottom" ? { opacity: 0, translate: `0 ${SLIDE_DISTANCE}px` }
    : effect === "zoom" ? { opacity: 0, scale: String(ZOOM_FROM) }
    : null;
  if (!away) return null;
  const rest: Keyframe = { opacity: 1, ...(effect === "zoom" ? { scale: "1" } : effect === "fade" ? {} : { translate: "0 0" }) };
  return phase === "enter" ? [away, rest] : [rest, away];
}

/** The class that takes an object out of the page, for the learner and for assistive technology, while its timing has it hidden. */
export const HIDDEN_CLASS = "os-timed-out";

/**
 * Shows and hides objects on the page, with an effect when there is one to play. An entrance puts the object into the page and then
 * plays. An exit plays with the object still in the page, content and all, and takes it out when it is over. Starting a new effect on an
 * object stops the one it was in the middle of, so a show that comes during an exit never leaves the object half gone.
 */
export class Presenter {
  private readonly playing = new Map<string, Playing>();

  set(id: string, el: HTMLElement, visible: boolean, motion?: Effect): void {
    this.playing.get(id)?.cancel();
    this.playing.delete(id);
    if (visible) {
      el.classList.remove(HIDDEN_CLASS);
      const entering = motion ? play(el, motion, "enter") : null;
      if (entering) {
        this.playing.set(id, entering);
        void entering.finished.then(() => { if (this.playing.get(id) === entering) this.playing.delete(id); });
      }
      return;
    }
    const leaving = motion && !el.classList.contains(HIDDEN_CLASS) ? play(el, motion, "exit") : null;
    if (!leaving) {
      el.classList.add(HIDDEN_CLASS);
      return;
    }
    this.playing.set(id, leaving);
    void leaving.finished.then(() => {
      if (this.playing.get(id) !== leaving) return;
      this.playing.delete(id);
      el.classList.add(HIDDEN_CLASS);
      leaving.cancel();
    });
  }

  /** Stop every effect that is running now: what was arriving is there, and what was leaving is gone. */
  endAll(): void {
    for (const p of [...this.playing.values()]) p.cancel();
  }

  /** Forget everything, for a new slide. Nothing is left running on objects that are no longer on the page. */
  clear(): void {
    for (const p of this.playing.values()) p.cancel();
    this.playing.clear();
  }

  get running(): number {
    return this.playing.size;
  }
}

/** Does the learner's device ask for less motion? */
export function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** An effect that is running: when it is over, and a way to stop it where it is. */
export interface Playing {
  finished: Promise<void>;
  cancel(): void;
}

/**
 * Start an effect on an element with the browser's own animation support. Returns null if there is nothing to play: no effect, or a
 * browser too old to animate, in which case the object simply appears and goes. An entrance holds its first frame until it starts and
 * is then left as the object really is. An exit holds its last frame until the caller has hidden the object.
 */
export function play(el: HTMLElement, spec: Effect, phase: Phase): Playing | null {
  const keyframes = frames(spec.effect, phase);
  if (!keyframes || typeof el.animate !== "function") return null;
  const duration = clampDuration(spec.duration);
  const a = el.animate(keyframes, { duration, easing: phase === "enter" ? "ease-out" : "ease-in", fill: phase === "enter" ? "backwards" : "forwards" });
  // A page that is not being drawn (a background tab, a minimised window) does not run effects, so an entrance could hold an object at its
  // first frame, invisible, and an exit could hold it on screen, for as long as that lasts. A timer still runs, and makes sure every
  // effect is over soon after it should be.
  const guard = setTimeout(() => {
    try { a.finish(); } catch { a.cancel(); }
  }, duration + GUARD_MS);
  // Stopping an effect makes the browser reject its promise, which is not a failure here: it just means it is over.
  return {
    finished: a.finished.then(() => undefined, () => undefined).then(() => clearTimeout(guard)),
    cancel: () => { clearTimeout(guard); a.cancel(); },
  };
}
