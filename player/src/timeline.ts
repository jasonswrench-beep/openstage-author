// Timing on a slide: when an object appears and disappears, and when a slide moves on by itself. This file is only the
// rules and the clock. It never touches a page; the player gives it hooks that show and hide things, so every rule can
// be tested with a clock that is moved by hand.
//
// Times are milliseconds, counted from when the object's layer is shown (the slide opening, for the base layer).
//   appear "time":      shown start ms after the layer is shown.
//   appear "narration": shown start ms after the object's own narration starts. If that narration will not play (it has
//                       no audio, or the browser refused to start the sound), it counts as having started when the
//                       layer was shown, so nothing is ever left hidden because a sound did not play.
//   appear "media":     shown when a video or audio clip on the slide has played start ms. What shows then depends only on where the clip
//                       is, so it follows the learner playing, pausing, skipping ahead and going back. If the clip cannot play, or is not
//                       there, everything that follows it shows, so nothing is ever left hidden because a clip did not play.
//   appear "click":     shown start ms after the learner presses Show next item for its step. The steps of a layer are its objects' step numbers in order;
//                       objects with one step show together. A learner who has not pressed yet sees none of them. Showing everything shows them all.
//                       A slide can also have its steps come by themselves (see setAutoSteps): step n is then pressed for the learner n x every ms after the
//                       first, counted on the timeline's own clock, so pausing holds it. The learner can still press Show next item to bring the next one now.
//   visibleFor:         hidden again this many ms after it appeared, or null to stay. For a clip it is that much of the clip.
// A learner can pause the clock, and can show everything at once. Both are for people who need longer, and are the reason
// timing is acceptable at all.
//
// A timer (see timer.ts) is the same clock with a deadline. It counts from when its layer is shown, is held by pausing, and is
// added to or turned off by the learner. Turning one off turns off every timer after it for the rest of the visit, because a
// learner who cannot work against the clock should not have to say so again on every slide. Showing everything turns the
// timers on the slide off too.

import type { TimerInfo, TimerState } from "./timer.ts";
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
  /** Steps that came by themselves (not from a press): the objects of the latest, and how many steps have come of how many. Not called for a press or for showing everything. */
  stepShown?(ids: string[], pressed: number, total: number): void;
  /** Something the controls display has changed: paused, everything shown, or whether anything is timed at all. */
  changed?(): void;
  /** What a timer shows has changed: a second passed, time was added, it was stopped or ran out, or the timing was paused or resumed. */
  timerChanged?(id: string, reading: TimerInfo): void;
  /** A timer's time ran out. */
  timerEnd?(id: string): void;
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

interface Alarm {
  layer: string;
  /** The clock reading when its layer was shown. */
  from: number;
  /** How long it runs for, in milliseconds, with any time the learner added. */
  ms: number;
  state: TimerState;
  /** Seconds left, kept from when it stopped being "running". */
  left: number;
  /** What the page was last told, so only changes are reported. */
  told: string;
}

interface Entry extends TimedObject {
  layer: string;
  /** The clock reading when its layer was shown. */
  from: number;
}

export class Timeline {
  private readonly entries = new Map<string, Entry>();
  /** When each "with narration" object's narration started, on the timeline's own clock. */
  private readonly narrationStart = new Map<string, number>();
  /** For each layer, the clock reading at each press of Show next item, by the number of the step it showed (0 is the first step). Steps that came by themselves are not here. */
  private readonly pressedAt = new Map<string, (number | undefined)[]>();
  /** The steps that come by themselves: when the first does, and how long between steps, in milliseconds from when their layer was shown. Null means they wait for presses. */
  private auto: { first: number; every: number } | null = null;
  /** For each layer, how many steps the page has been told about (by a press, by itself, or by showing everything), so each is said once. */
  private readonly told = new Map<string, number>();
  /** What the page was last told about each object, so only changes are reported. */
  private readonly shown = new Map<string, boolean>();
  /** Where each clip that objects follow is, in milliseconds, and whether it has failed. A clip not reported yet is at the start. */
  private readonly clips = new Map<string, { ms: number; failed: boolean }>();
  private elapsed = 0;
  private lastReading: number;
  private running = true;
  private everything = false;
  private blocked = false;
  private advanceAt: number | null = null;
  private advanced = false;
  private handle: unknown = null;
  /** The timers on this slide. */
  private readonly alarms = new Map<string, Alarm>();
  /** The learner turned a timer off: later timers do not start. Kept when a new slide starts. */
  private timersOff = false;
  /** Counts the times everything was forgotten, so a hook that moved to another slide can be noticed. */
  private generation = 0;
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
    this.alarms.clear();
    this.generation += 1;
    this.narrationStart.clear();
    this.pressedAt.clear();
    this.told.clear();
    this.auto = null;
    this.shown.clear();
    this.clips.clear();
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
    this.pressedAt.delete(layer);
    this.told.delete(layer);
    for (const o of objects) {
      this.entries.set(o.id, { ...o, layer, from: this.elapsed });
      this.shown.delete(o.id);
      this.narrationStart.delete(o.id);
      // Narration that will not play counts as started when the layer was shown.
      if (o.timing.appear === "narration" && !o.hasAudio) this.narrationStart.set(o.id, this.elapsed);
    }
    this.sync();
  }

  /** Start a timer on a layer that has just been shown. It counts from now. */
  addTimer(layer: string, id: string, seconds: number): void {
    this.advanceClock();
    const off = this.timersOff || this.everything;
    this.alarms.set(id, { layer, from: this.elapsed, ms: seconds * 1000, state: off ? "off" : "running", left: seconds, told: "" });
    this.sync();
  }

  /** The learner added time to a timer that is still running. */
  addTime(id: string, seconds: number): void {
    const a = this.alarms.get(id);
    if (!a || a.state !== "running" || !(seconds > 0)) return;
    this.advanceClock();
    a.ms += seconds * 1000;
    this.sync();
  }

  /** A rule stopped a timer (the question was answered): it holds at the time left and does not run out. */
  stopTimer(id: string): void {
    const a = this.alarms.get(id);
    if (!a || a.state !== "running") return;
    this.advanceClock();
    this.leave(a, "stopped");
    this.sync();
  }

  /** The learner turned the timer off. This one stops, and so does every timer that starts after it. */
  turnOffTimers(): void {
    this.timersOff = true;
    this.advanceClock();
    for (const a of this.alarms.values()) if (a.state === "running") this.leave(a, "off");
    this.sync();
  }

  /** Is any timer on the slide still counting down? */
  get timing(): boolean {
    return [...this.alarms.values()].some((a) => a.state === "running");
  }

  private secondsLeft(a: Alarm): number {
    return Math.max(0, Math.ceil((a.from + a.ms - this.elapsed) / 1000));
  }

  /** A timer stops counting; it keeps the time it had left. */
  private leave(a: Alarm, state: TimerState): void {
    a.left = this.secondsLeft(a);
    a.state = state;
  }

  /** Tell the page what each timer shows, for the ones whose reading changed. */
  private reportTimers(): void {
    for (const [id, a] of this.alarms) {
      const reading: TimerInfo = { state: a.state, seconds: a.state === "running" ? this.secondsLeft(a) : a.left, paused: !this.running };
      const told = `${reading.state}|${reading.seconds}|${reading.paused}`;
      if (told === a.told) continue;
      a.told = told;
      this.hooks.timerChanged?.(id, reading);
    }
  }

  /** Stop timing a layer that has been hidden. */
  removeLayer(layer: string): void {
    this.pressedAt.delete(layer);
    this.told.delete(layer);
    for (const [id, a] of [...this.alarms]) if (a.layer === layer) this.alarms.delete(id);
    for (const [id, e] of [...this.entries]) {
      if (e.layer !== layer) continue;
      this.entries.delete(id);
      this.shown.delete(id);
      this.narrationStart.delete(id);
    }
    this.sync();
  }

  /** The step numbers of the objects on a layer that wait for a press, once each, in order. */
  private stepsOf(layer: string): number[] {
    const steps = new Set<number>();
    for (const e of this.entries.values()) if (e.layer === layer && e.timing.appear === "click") steps.add(e.timing.step ?? 1);
    return [...steps].sort((a, b) => a - b);
  }

  /** The steps on this slide come by themselves: the first this many ms after its layer is shown, then one every `every` ms. Null: they wait for presses. */
  setAutoSteps(auto: { first: number; every: number } | null): void {
    this.auto = auto;
    this.sync();
  }

  /** The clock reading when a layer was shown (all its objects share it). */
  private layerFrom(layer: string): number {
    for (const e of this.entries.values()) if (e.layer === layer) return e.from;
    return 0;
  }

  /** The reading at which step number `i` of a layer was pressed: by the learner, or when its turn came if the steps come by themselves, whichever was first. Infinity while it waits. */
  private pressTime(layer: string, i: number): number {
    const manual = this.pressedAt.get(layer)?.[i];
    const auto = this.auto ? this.layerFrom(layer) + this.auto.first + i * this.auto.every : Infinity;
    return Math.min(manual ?? Infinity, auto);
  }

  /** How many of a layer's steps have been pressed, by the learner or by the clock. */
  private pressedCount(layer: string): number {
    if (this.everything) return this.stepsOf(layer).length;
    let n = 0;
    for (let i = 0; i < this.stepsOf(layer).length; i++) if (this.pressTime(layer, i) <= this.elapsed) n++;
    return n;
  }

  /** How many presses of Show next item the slide has in all, and how many have been made. Everything counts as pressed once the learner has shown everything. */
  get steps(): { total: number; pressed: number } {
    this.advanceClock();
    let total = 0;
    let pressed = 0;
    for (const layer of new Set([...this.entries.values()].map((e) => e.layer))) {
      total += this.stepsOf(layer).length;
      pressed += this.pressedCount(layer);
    }
    return { total, pressed };
  }

  /**
   * The learner pressed Show next item: the next step that is waiting (the first layer that has one, base layer first) is shown, each of its objects after its own
   * delay. Returns the ids of those objects, so the page can say what came; none if there is nothing waiting.
   */
  showNext(): string[] {
    if (this.everything) return [];
    for (const layer of new Set([...this.entries.values()].map((e) => e.layer))) {
      const steps = this.stepsOf(layer);
      this.advanceClock();
      // The first step that has not come yet: not the one after the last press, because steps that came by themselves count.
      const next = steps.findIndex((_, i) => this.pressTime(layer, i) > this.elapsed);
      if (next === -1) continue;
      const presses = this.pressedAt.get(layer) ?? [];
      presses[next] = this.elapsed;
      this.pressedAt.set(layer, presses);
      this.told.set(layer, this.pressedCount(layer)); // the page says a press itself
      const step = steps[next]!;
      const ids = [...this.entries.values()].filter((e) => e.layer === layer && e.timing.appear === "click" && (e.timing.step ?? 1) === step).map((e) => e.id);
      this.sync();
      return ids;
    }
    return [];
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

  /** A clip is at this many milliseconds: it played, was paused, or the learner skipped or went back. */
  clipTime(id: string, ms: number): void {
    const clip = this.clips.get(id) ?? { ms: 0, failed: false };
    if (clip.ms === ms && this.clips.has(id)) return;
    this.clips.set(id, { ...clip, ms });
    this.sync();
  }

  /** A clip cannot play or is not there. What follows it shows, and stays showing. */
  clipFailed(id: string): void {
    const clip = this.clips.get(id) ?? { ms: 0, failed: false };
    if (clip.failed) return;
    this.clips.set(id, { ...clip, failed: true });
    this.sync();
  }

  pause(): void {
    if (!this.running) return;
    this.advanceClock();
    this.running = false;
    this.cancel();
    this.reportTimers();
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
    return [...this.entries.values()].some((e) => isTimed(e.timing)) || this.advanceAt !== null || this.timing;
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

  /** When the object appears, or Infinity while it is still waiting for its narration to start. (Not for a clip: see isShown.) */
  private appearsAt(e: Entry): number {
    if (e.timing.appear === "time") return e.from + e.timing.start;
    if (e.timing.appear === "media") return Infinity;
    if (e.timing.appear === "click") {
      const at = this.pressTime(e.layer, this.stepsOf(e.layer).indexOf(e.timing.step ?? 1));
      return at === Infinity ? Infinity : at + e.timing.start;
    }
    const started = this.narrationStart.get(e.id);
    return started === undefined ? Infinity : started + e.timing.start;
  }

  private isShown(e: Entry): boolean {
    if (this.everything) return true;
    if (e.timing.appear === "media") {
      // Counted on the clip's own time, not the clock. A clip that failed shows what follows it, whatever its time.
      const clip = this.clips.get(e.timing.media ?? "") ?? { ms: 0, failed: false };
      if (clip.failed) return true;
      return clip.ms >= e.timing.start && (e.timing.visibleFor === null || clip.ms < e.timing.start + e.timing.visibleFor);
    }
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
    this.tellSteps();
    // A timer that has run out is marked first, so the rules it starts find everything as it is now. A rule may take the learner to
    // another slide, which forgets everything here, so nothing may follow if that happened.
    const ended: string[] = [];
    for (const [id, a] of this.alarms) {
      if (a.state !== "running") continue;
      if (this.everything) this.leave(a, "off");
      else if (this.elapsed >= a.from + a.ms) {
        this.leave(a, "done");
        ended.push(id);
      }
    }
    this.reportTimers();
    if (ended.length > 0) {
      const generation = this.generation;
      for (const id of ended) {
        if (this.generation !== generation) return;
        this.hooks.timerEnd?.(id);
      }
      if (this.generation !== generation) return;
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

  /** Tell the page about steps that came by themselves since it was last told. A press, and showing everything, are said by the controls, so they are only counted. */
  private tellSteps(): void {
    for (const layer of new Set([...this.entries.values()].map((e) => e.layer))) {
      const now = this.pressedCount(layer);
      const before = this.told.get(layer) ?? 0;
      if (now <= before) continue;
      this.told.set(layer, now);
      if (this.everything) continue;
      const steps = this.stepsOf(layer);
      for (let i = before; i < now; i++) {
        const ids = [...this.entries.values()].filter((e) => e.layer === layer && e.timing.appear === "click" && (e.timing.step ?? 1) === steps[i]).map((e) => e.id);
        const { total, pressed } = this.steps;
        this.hooks.stepShown?.(ids, Math.min(pressed, total), total);
      }
    }
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
    // Steps that come by themselves are said when their turn comes, which is before the delay some objects have after it.
    if (this.auto && !this.everything) {
      for (const layer of new Set([...this.entries.values()].map((e) => e.layer))) {
        for (let i = 0; i < this.stepsOf(layer).length; i++) consider(this.pressTime(layer, i));
      }
    }
    // A timer's clock changes at each whole second left, and at its end.
    for (const a of this.alarms.values()) {
      if (a.state !== "running") continue;
      const end = a.from + a.ms;
      const left = end - this.elapsed;
      if (left > 0) consider(end - (Math.ceil(left / 1000) - 1) * 1000);
    }
    if (next === Infinity) return;
    this.handle = this.clock.set(() => {
      this.handle = null;
      this.sync();
    }, Math.max(0, next - this.elapsed));
  }
}
