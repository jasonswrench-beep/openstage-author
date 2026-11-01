// Planning a video of a course (the MP4 target of publish.ts). Nothing here touches a page, a file or a program: it works out, for one
// slide, when each timed object comes and goes, how long the slide lasts, and which pictures of it are needed and for how long. The
// timing is the player's own: the same Timeline, driven by a clock that is moved by hand, so a video follows exactly the rules a learner
// would see (timing, narration that objects wait for, steps that come by themselves, and the effects of arriving and leaving).
//
// A video cannot wait for a learner, so three things are decided here and written down in docs/video.md:
//   - Narration starts a little after the slide opens, and plays one object after another in reading order, as the narration bar does.
//   - Steps that wait for a press of Show next item come by themselves: the first after 2 seconds and then one every 3 seconds, unless
//     the slide says when (autoSteps).
//   - A slide lasts as long as its narration (and a moment after), or its last timed object (and time to read it), or the time the slide
//     was set to move on after, whichever is longest; a slide with none of these is shown for a fixed time.
// All times are whole milliseconds, and every picture lasts a whole number of GRID_MS, so the video's picture track is on a grid.

import { Timeline, type Clock, type TimedObject } from "./timeline.ts";
import { clampDuration } from "./animation.ts";
import type { Effect, ObjectAnimation } from "./types.ts";

/** Pictures change at most this often, and last at least this long (the recorder's editing format does not take a clip under 100 ms). */
export const GRID_MS = 100;
/** Narration starts this long after the slide opens, so a slide that fades in is there before it is spoken about. */
export const NARRATION_DELAY_MS = 300;
/** Time left after the last word of a slide's narration. */
export const TAIL_MS = 1000;
/** Time left after the last timed object arrives, to read it. */
export const READ_MS = 2000;
/** How long a slide with no narration and nothing timed is shown. */
export const SILENT_MS = 5000;
/** When steps that wait for a press come by themselves in a video. */
export const AUTO_STEPS = { first: 2000, every: 3000 } as const;
/** How long the cross-fade into a slide with an entrance lasts. */
export const TRANSITION_MS = 500;
/** No slide is planned past this: a guard against rules that never end. */
const HORIZON_MS = 30 * 60 * 1000;

/** A clock that is moved by hand: the timeline asks it for the time and for a call later, and nothing happens until it is moved. */
class ManualClock implements Clock {
  private time = 0;
  private serial = 0;
  private waiting: { id: number; at: number; fn: () => void }[] = [];

  now(): number {
    return this.time;
  }

  set(fn: () => void, ms: number): unknown {
    this.serial += 1;
    this.waiting.push({ id: this.serial, at: this.time + ms, fn });
    return this.serial;
  }

  clear(handle: unknown): void {
    this.waiting = this.waiting.filter((w) => w.id !== handle);
  }

  /** When the next call is due, or null if there is none. */
  nextAt(): number | null {
    return this.waiting.length === 0 ? null : Math.min(...this.waiting.map((w) => w.at));
  }

  /** Move to `ms`, making each call that falls due on the way at its own time, earliest first. */
  advanceTo(ms: number, stop: () => boolean): void {
    for (;;) {
      const due = this.waiting.filter((w) => w.at <= ms).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.waiting = this.waiting.filter((w) => w !== due);
      this.time = Math.max(this.time, due.at);
      due.fn();
      if (stop()) return;
    }
    this.time = Math.max(this.time, ms);
  }
}

/** What the page tells the video maker about a slide it has drawn: what is timed, what is narrated, and how the slide arrives. */
export interface PreparedSlide {
  id: string;
  name: string;
  /** The timed objects (and paragraphs) of the base layer. */
  entries: TimedObject[];
  /** What each timed object does when it arrives and when it goes, by id. */
  animations: [string, ObjectAnimation][];
  followedClips: string[];
  /** The narrated objects that have audio, in the order they are spoken. */
  narrated: string[];
  advanceMs: number | null;
  autoSteps: { first: number; every: number } | null;
  /** The slide arrives with an effect. */
  arrives: boolean;
}

/** What the plan of one slide needs to know. */
export interface SlideTimingInput {
  /** The timed objects (and paragraphs) of the base layer, as layerTiming gives them. */
  entries: TimedObject[];
  /** The narration that plays, in order: the object, and when it starts, in ms from the slide opening. */
  narration: { id: string; startMs: number }[];
  /** The slide's own time to move on, or null. */
  advanceMs: number | null;
  /** When steps come by themselves, or null: steps that wait for a press then come on the default times. */
  autoSteps: { first: number; every: number } | null;
  /** The video or audio clips that objects are timed to. A video cannot play them, so what follows them shows from the start. */
  followedClips: string[];
}

/** An object coming or going, at a time. */
export interface VisibilityEvent {
  atMs: number;
  id: string;
  visible: boolean;
  /** For a going object: it was on screen, so it can play its exit. */
  wasShowing: boolean;
}

export interface SlideSimulation {
  /** In the order they happened. Every timed object has one at 0. */
  events: VisibilityEvent[];
  /** When the slide would move on by itself, or null. */
  advancedAtMs: number | null;
  /** The time of the last coming or going after the slide opened (0 if everything was settled at the start). */
  lastChangeMs: number;
}

/** Run the slide's timing against the player's own rules. */
export function simulateSlide(input: SlideTimingInput): SlideSimulation {
  const clock = new ManualClock();
  const events: VisibilityEvent[] = [];
  let advancedAtMs: number | null = null;
  const timeline = new Timeline(
    {
      show: (id) => events.push({ atMs: clock.now(), id, visible: true, wasShowing: false }),
      hide: (id, wasShowing) => events.push({ atMs: clock.now(), id, visible: false, wasShowing }),
      advance: () => {
        advancedAtMs = clock.now();
      },
    },
    clock,
  );
  timeline.reset();
  if (input.entries.length > 0) timeline.addLayer("base", input.entries);
  for (const id of input.followedClips) timeline.clipFailed(id);
  timeline.setAdvance(input.advanceMs);
  const waits = input.entries.some((e) => e.timing.appear === "click" || e.timing.until !== undefined);
  timeline.setAutoSteps(input.autoSteps ?? (waits ? { ...AUTO_STEPS } : null));
  for (const n of input.narration) clock.set(() => timeline.narrationStarted(n.id), n.startMs);
  for (;;) {
    const next = clock.nextAt();
    if (next === null || next > HORIZON_MS || advancedAtMs !== null) break;
    clock.advanceTo(next, () => advancedAtMs !== null);
  }
  const lastChangeMs = events.reduce((latest, e) => (e.atMs > latest ? e.atMs : latest), 0);
  return { events, advancedAtMs, lastChangeMs };
}

/** Round up to a whole number of grid steps. */
export function roundUpToGrid(ms: number): number {
  return Math.ceil(ms / GRID_MS) * GRID_MS;
}

/** Where each narrated object's audio starts and ends in the slide, given how long each lasts. They play one after another. */
export function narrationSchedule(items: { id: string; durationMs: number }[]): { id: string; startMs: number; endMs: number }[] {
  let at = NARRATION_DELAY_MS;
  return items.map((item) => {
    const startMs = at;
    at += item.durationMs;
    return { id: item.id, startMs, endMs: at };
  });
}

/** How long the slide lasts in the video, on the grid. */
export function slideLengthMs(sim: SlideSimulation, narrationEndMs: number | null, advanceMs: number | null, silentMs: number = SILENT_MS): number {
  const wanted: number[] = [];
  if (narrationEndMs !== null) wanted.push(narrationEndMs + TAIL_MS);
  if (sim.lastChangeMs > 0) wanted.push(sim.lastChangeMs + READ_MS);
  if (advanceMs !== null) wanted.push(advanceMs);
  return roundUpToGrid(wanted.length === 0 ? silentMs : Math.max(...wanted));
}

/** An effect that is partway through at one moment: an object arriving or leaving. */
export interface InFlight {
  id: string;
  phase: "enter" | "exit";
  effect: Effect;
  /** 0 up to, not including, 1. */
  progress: number;
}

/** How the slide looks at one moment: which timed objects are showing, and which effects are partway. */
export interface FrameState {
  /** By object id, for every timed object. An object that is leaving is still showing. */
  visible: Record<string, boolean>;
  flying: InFlight[];
}

/** A picture of the slide and how long it is shown for. */
export interface Segment {
  startMs: number;
  endMs: number;
  state: FrameState;
}

/** The state at one moment (a time on the grid). */
export function stateAt(events: VisibilityEvent[], animations: Map<string, ObjectAnimation>, ids: string[], atMs: number, motion: boolean): FrameState {
  const visible: Record<string, boolean> = {};
  const flying: InFlight[] = [];
  for (const id of ids) {
    let last: VisibilityEvent | null = null;
    for (const e of events) if (e.id === id && e.atMs <= atMs) last = e;
    visible[id] = last?.visible ?? false;
    if (!motion || !last) continue;
    const spec = animations.get(id)?.[last.visible ? "enter" : "exit"];
    if (!spec || spec.effect === "none") continue;
    // An entrance plays when the object comes. An exit plays only for an object that was on screen.
    if (!last.visible && !last.wasShowing) continue;
    const progress = (atMs - last.atMs) / clampDuration(spec.duration);
    if (progress >= 1) continue;
    if (!last.visible) visible[id] = true;
    flying.push({ id, phase: last.visible ? "enter" : "exit", effect: spec, progress });
  }
  return { visible, flying };
}

/** What makes two moments look the same. */
function signature(state: FrameState): string {
  const ids = Object.keys(state.visible).sort();
  return JSON.stringify([ids.map((id) => [id, state.visible[id]]), state.flying.map((f) => [f.id, f.phase, f.effect.effect, Math.round(f.progress * 1000)])]);
}

/**
 * The pictures a slide needs, covering 0 up to `lengthMs` with no gap: one for each stretch in which nothing about the slide changes, and
 * one for every grid step in which an effect is partway (so a fade is a few pictures, not a jump).
 */
export function planSegments(sim: SlideSimulation, animations: Map<string, ObjectAnimation>, ids: string[], lengthMs: number, motion: boolean): Segment[] {
  const segments: Segment[] = [];
  let lastSignature = "";
  for (let at = 0; at < lengthMs; at += GRID_MS) {
    const state = stateAt(sim.events, animations, ids, at, motion);
    const sig = signature(state);
    const open = segments[segments.length - 1];
    if (open && sig === lastSignature) {
      open.endMs = at + GRID_MS;
      continue;
    }
    segments.push({ startMs: at, endMs: at + GRID_MS, state });
    lastSignature = sig;
  }
  return segments;
}
