// Timing on a slide: when an object appears and disappears, and when a slide moves on by itself. This file is only the
// rules and the clock. It never touches a page; the player gives it hooks that show and hide things, so every rule can
// be tested with a clock that is moved by hand.
//
// Times are milliseconds, counted from when the object's layer is shown (the slide opening, for the base layer).
//   appear "time":      shown start ms after the layer is shown.
//   appear "narration": shown start ms after the object's own narration starts. If that narration will not play (it has
//                       no audio, or the browser refused to start the sound), it counts as having started when the
//                       layer was shown, so nothing is ever left hidden because a sound did not play.
//   visibleFor:         hidden again this many ms after it appeared, or null to stay.
// A learner can pause the clock, and can show everything at once. Both are for people who need longer, and are the reason
// timing is acceptable at all.

import type { Timing } from "./types.ts";

/** Does this timing change anything about how the object is shown? The starting timing means always there. */
export function isTimed(t: Timing): boolean {
  return t.appear !== "time" || t.start > 0 || t.visibleFor !== null;
}

/** What the timeline needs to know about an object. */
export interface TimedObject {
  id: string;
  timing: Timing;
  /** Its narration has audio that the narration bar will play, so "with narration" can follow it. */
  hasAudio: boolean;
}

export interface TimelineHooks {
  /** `instant` is true when the learner asked to show everything, which should not wait for an effect. */
  show(id: string, instant: boolean): void;
  /** `wasShowing` is false when the object was never on screen yet, so there is nothing to leave. */
  hide(id: string, wasShowing: boolean): void;
  /** The slide's own time is up. */
  advance(): void;
  /** Something the controls display has changed: paused, everything shown, or whether anything is timed at all. */
  changed?(): void;
}

/** A clock and a way to be called later. The player uses the real ones; the tests use one moved by hand. */
export interface Clock {
  now(): number;
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => performance.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Entry extends TimedObject {
  layer: string;
  /** The clock reading when its layer was shown. */
  from: number;
}

export class Timeline {
  private readonly entries = new Map<string, Entry>();
  /** When each "with narration" object's narration started, on the timeline's own clock. */
  private readonly narrationStart = new Map<string, number>();
  /** What the page was last told about each object, so only changes are reported. */
  private readonly shown = new Map<string, boolean>();
  private elapsed = 0;
  private lastReading: number;
  private running = true;
  private everything = false;
  private blocked = false;
  private advanceAt: number | null = null;
  private advanced = false;
  private handle: unknown = null;
  private readonly hooks: TimelineHooks;
  private readonly clock: Clock;

  constructor(hooks: TimelineHooks, clock: Clock = realClock) {
    this.hooks = hooks;
    this.clock = clock;
    this.lastReading = clock.now();
  }

  /** Forget everything and start again from nothing, for a new slide. */
  reset(): void {
    this.cancel();
    this.entries.clear();
    this.narrationStart.clear();
    this.shown.clear();
    this.elapsed = 0;
    this.lastReading = this.clock.now();
    this.running = true;
    this.everything = false;
    this.blocked = false;
    this.advanceAt = null;
    this.advanced = false;
    this.hooks.changed?.();
  }

  /** Move on after this many ms, or never (null). */
  setAdvance(ms: number | null): void {
    this.advanceAt = ms;
    this.advanced = false;
    this.sync();
  }

  /** Start timing the timed objects of a layer that has just been shown. Their times count from now. */
  addLayer(layer: string, objects: TimedObject[]): void {
    this.advanceClock();
    for (const o of objects) {
      this.entries.set(o.id, { ...o, layer, from: this.elapsed });
      this.shown.delete(o.id);
      this.narrationStart.delete(o.id);
      // Narration that will not play counts as started when the layer was shown.
      if (o.timing.appear === "narration" && !o.hasAudio) this.narrationStart.set(o.id, this.elapsed);
    }
    this.sync();
  }

  /** Stop timing a layer that has been hidden. */
  removeLayer(layer: string): void {
    for (const [id, e] of [...this.entries]) {
      if (e.layer !== layer) continue;
      this.entries.delete(id);
      this.shown.delete(id);
      this.narrationStart.delete(id);
    }
    this.sync();
  }

  /** An object's narration has started playing. */
  narrationStarted(id: string): void {
    if (!this.entries.has(id) || this.narrationStart.has(id)) return;
    this.advanceClock();
    this.narrationStart.set(id, this.elapsed);
    this.sync();
  }

  /** The browser refused to start the sound. Everything waiting on narration counts as started now. */
  narrationBlocked(): void {
    if (this.blocked) return;
    this.blocked = true;
    this.advanceClock();
    for (const [id, e] of this.entries) {
      if (e.timing.appear === "narration" && !this.narrationStart.has(id)) this.narrationStart.set(id, this.elapsed);
    }
    this.sync();
  }

  pause(): void {
    if (!this.running) return;
    this.advanceClock();
    this.running = false;
    this.cancel();
    this.hooks.changed?.();
  }

  resume(): void {
    if (this.running) return;
    this.lastReading = this.clock.now();
    this.running = true;
    this.sync();
  }

  /** Show every timed object now and keep it showing. Does not stop the slide moving on; pausing does. */
  showEverything(): void {
    this.everything = true;
    this.sync();
  }

  get paused(): boolean {
    return !this.running;
  }

  get allShown(): boolean {
    return this.everything;
  }

  /**
   * Is anything on this slide timed, or does the slide move on by itself? Then the learner needs the timing controls. An object
   * that is only listed so its arrival can be animated, and is there from the start, is not timed.
   */
  get active(): boolean {
    return [...this.entries.values()].some((e) => isTimed(e.timing)) || this.advanceAt !== null;
  }

  /** Milliseconds since the slide opened, not counting time spent paused. */
  get elapsedMs(): number {
    this.advanceClock();
    return this.elapsed;
  }

  private advanceClock(): void {
    const now = this.clock.now();
    if (this.running) this.elapsed += now - this.lastReading;
    this.lastReading = now;
  }

  private cancel(): void {
    if (this.handle !== null) this.clock.clear(this.handle);
    this.handle = null;
  }

  /** When the object appears, or Infinity while it is still waiting for its narration to start. */
  private appearsAt(e: Entry): number {
    if (e.timing.appear === "time") return e.from + e.timing.start;
    const started = this.narrationStart.get(e.id);
    return started === undefined ? Infinity : started + e.timing.start;
  }

  private isShown(e: Entry): boolean {
    if (this.everything) return true;
    const at = this.appearsAt(e);
    return this.elapsed >= at && (e.timing.visibleFor === null || this.elapsed < at + e.timing.visibleFor);
  }

  /** Bring the page up to date with the clock, and set the next time to look. */
  private sync(): void {
    this.advanceClock();
    for (const [id, e] of this.entries) {
      const visible = this.isShown(e);
      const was = this.shown.get(id);
      if (was === visible) continue;
      this.shown.set(id, visible);
      if (visible) this.hooks.show(id, this.everything);
      else this.hooks.hide(id, was === true);
    }
    this.cancel();
    if (this.advanceAt !== null && !this.advanced && this.elapsed >= this.advanceAt) {
      this.advanced = true;
      this.hooks.changed?.();
      this.hooks.advance(); // this may start a new slide and reset everything here, so nothing may follow it
      return;
    }
    this.schedule();
    this.hooks.changed?.();
  }

  private schedule(): void {
    if (!this.running) return;
    let next = Infinity;
    const consider = (t: number) => {
      if (t > this.elapsed && t < next) next = t;
    };
    if (!this.everything) {
      for (const e of this.entries.values()) {
        const at = this.appearsAt(e);
        if (at === Infinity) continue;
        consider(at);
        if (e.timing.visibleFor !== null) consider(at + e.timing.visibleFor);
      }
    }
    if (this.advanceAt !== null && !this.advanced) consider(this.advanceAt);
    if (next === Infinity) return;
    this.handle = this.clock.set(() => {
      this.handle = null;
      this.sync();
    }, Math.max(0, next - this.elapsed));
  }
}
