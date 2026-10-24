import assert from "node:assert/strict";
import { test } from "node:test";
import { isTimed, itemSentence, Timeline, type Clock, type TimedObject } from "./timeline.ts";
import type { Timing } from "./types.ts";

/** A clock moved by hand. Timers run, in order, as it passes their time. */
class FakeClock implements Clock {
  t = 0;
  private next = 1;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  now(): number { return this.t; }
  set(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.timers.push({ id, at: this.t + ms, fn });
    return id;
  }
  clear(handle: unknown): void { this.timers = this.timers.filter((x) => x.id !== handle); }
  pending(): number { return this.timers.length; }
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x !== due);
      this.t = due.at;
      due.fn();
    }
    this.t = end;
  }
}

const at = (start: number, visibleFor: number | null = null): Timing => ({ appear: "time", start, visibleFor });
const withNarration = (start = 0, visibleFor: number | null = null): Timing => ({ appear: "narration", start, visibleFor });
const obj = (id: string, timing: Timing, hasAudio = true): TimedObject => ({ id, timing, hasAudio });

function make() {
  const clock = new FakeClock();
  const log: string[] = [];
  /** What each show and hide was told besides the object: instant for a show, wasShowing for a hide. */
  const told: string[] = [];
  let advanced = 0;
  let changed = 0;
  const timeline = new Timeline({
    show: (id, instant) => { log.push(`show ${id}`); told.push(`show ${id} instant=${instant}`); },
    hide: (id, wasShowing) => { log.push(`hide ${id}`); told.push(`hide ${id} wasShowing=${wasShowing}`); },
    advance: () => { advanced++; },
    changed: () => { changed++; },
  }, clock);
  return { clock, log, told, timeline, advanced: () => advanced, changed: () => changed, take: () => log.splice(0) };
}

test("the starting timing means always there, and anything else is timed", () => {
  assert.equal(isTimed(at(0)), false);
  assert.equal(isTimed(at(1)), true);
  assert.equal(isTimed(at(0, 5000)), true);
  assert.equal(isTimed(withNarration(0)), true);
});

test("an object waits for its time, then appears, and nothing happens in between", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", at(2000))]);
  assert.deepEqual(m.take(), ["hide a"], "hidden from the first moment");
  m.clock.advance(1999);
  assert.deepEqual(m.take(), []);
  m.clock.advance(1);
  assert.deepEqual(m.take(), ["show a"]);
  m.clock.advance(60000);
  assert.deepEqual(m.take(), [], "and it stays");
  assert.equal(m.clock.pending(), 0, "no timer is left running when nothing more can change");
});

test("an object that leaves does so visibleFor after it appeared", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", at(1000, 3000))]);
  m.take();
  m.clock.advance(1000);
  assert.deepEqual(m.take(), ["show a"]);
  m.clock.advance(2999);
  assert.deepEqual(m.take(), []);
  m.clock.advance(1);
  assert.deepEqual(m.take(), ["hide a"]);
  m.clock.advance(10000);
  assert.deepEqual(m.take(), [], "gone for good");
});

test("an object with no delay that leaves is showing from the start", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", at(0, 2000))]);
  assert.deepEqual(m.take(), ["show a"]);
  m.clock.advance(2000);
  assert.deepEqual(m.take(), ["hide a"]);
});

test("several objects are each shown at their own time, in time order", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("late", at(5000)), obj("early", at(1000)), obj("never", at(0))]);
  assert.deepEqual(m.take(), ["hide late", "hide early", "show never"]);
  m.clock.advance(6000);
  assert.deepEqual(m.take(), ["show early", "show late"]);
});

test("with narration: it waits for its narration to start, then follows it by the delay", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", withNarration(500)), obj("b", withNarration(0))]);
  assert.deepEqual(m.take(), ["hide a", "hide b"]);
  m.clock.advance(10000);
  assert.deepEqual(m.take(), [], "no narration has started, so nothing is shown");
  m.timeline.narrationStarted("b");
  assert.deepEqual(m.take(), ["show b"], "with no delay, at once");
  m.clock.advance(4000);
  m.timeline.narrationStarted("a");
  assert.deepEqual(m.take(), []);
  m.clock.advance(499);
  assert.deepEqual(m.take(), []);
  m.clock.advance(1);
  assert.deepEqual(m.take(), ["show a"], "500 ms after its narration started, not after the slide opened");
});

test("with narration: a repeat of the same start changes nothing, and an unknown id is ignored", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", withNarration(1000))]);
  m.take();
  m.timeline.narrationStarted("a");
  m.clock.advance(600);
  m.timeline.narrationStarted("a");
  m.timeline.narrationStarted("nobody");
  m.clock.advance(400);
  assert.deepEqual(m.take(), ["show a"], "the first start is the one that counts");
});

test("with narration that will not play (no audio), it counts as started when the layer was shown", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", withNarration(2000), false), obj("b", withNarration(0), false)]);
  assert.deepEqual(m.take(), ["hide a", "show b"]);
  m.clock.advance(2000);
  assert.deepEqual(m.take(), ["show a"]);
});

test("with narration that the browser refused to play, everything waiting appears, so nothing stays hidden", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", withNarration(0)), obj("b", withNarration(3000))]);
  m.take();
  m.clock.advance(1000);
  m.timeline.narrationBlocked();
  assert.deepEqual(m.take(), ["show a"], "at once, because there is no narration to wait for");
  m.clock.advance(3000);
  assert.deepEqual(m.take(), ["show b"], "and its delay still counts from then");
  m.timeline.narrationStarted("a");
  m.timeline.narrationBlocked();
  assert.deepEqual(m.take(), [], "a later start or a second refusal changes nothing");
});

test("pausing stops the clock and resuming carries on from where it was", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", at(4000))]);
  m.take();
  m.clock.advance(1000);
  m.timeline.pause();
  assert.equal(m.timeline.paused, true);
  m.clock.advance(60000);
  assert.deepEqual(m.take(), [], "nothing happens while paused");
  assert.equal(m.clock.pending(), 0, "and no timer is running");
  assert.equal(m.timeline.elapsedMs, 1000, "paused time is not counted");
  m.timeline.resume();
  m.clock.advance(2999);
  assert.deepEqual(m.take(), []);
  m.clock.advance(1);
  assert.deepEqual(m.take(), ["show a"], "3 seconds were left, and 3 seconds it was");
  m.timeline.pause();
  m.timeline.pause();
  m.timeline.resume();
  m.timeline.resume();
  assert.equal(m.timeline.paused, false);
});

test("show everything shows what has not come yet, and keeps what would have gone", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("later", at(30000)), obj("leaves", at(0, 1000)), obj("narrated", withNarration(0))]);
  m.take();
  m.timeline.showEverything();
  assert.deepEqual(m.take().sort(), ["show later", "show narrated"], "leaves was already showing");
  assert.equal(m.timeline.allShown, true);
  m.clock.advance(60000);
  assert.deepEqual(m.take(), [], "none of it goes away afterwards");
  assert.equal(m.clock.pending(), 0);
});

test("show everything works while paused, and the clock stays paused", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", at(10000))]);
  m.take();
  m.timeline.pause();
  m.timeline.showEverything();
  assert.deepEqual(m.take(), ["show a"]);
  assert.equal(m.timeline.paused, true);
});

test("a slide moves on by itself once its time is up, only once", () => {
  const m = make();
  m.timeline.setAdvance(8000);
  assert.equal(m.timeline.active, true, "the learner needs the controls even with nothing timed");
  m.clock.advance(7999);
  assert.equal(m.advanced(), 0);
  m.clock.advance(1);
  assert.equal(m.advanced(), 1);
  m.clock.advance(60000);
  assert.equal(m.advanced(), 1);
});

test("a slide does not move on while paused, and the time left is kept", () => {
  const m = make();
  m.timeline.setAdvance(5000);
  m.clock.advance(2000);
  m.timeline.pause();
  m.clock.advance(60000);
  assert.equal(m.advanced(), 0);
  m.timeline.resume();
  m.clock.advance(2999);
  assert.equal(m.advanced(), 0);
  m.clock.advance(1);
  assert.equal(m.advanced(), 1);
});

test("showing everything does not move the slide on", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", at(1000))]);
  m.timeline.setAdvance(5000);
  m.timeline.showEverything();
  m.clock.advance(4999);
  assert.equal(m.advanced(), 0);
  m.clock.advance(1);
  assert.equal(m.advanced(), 1, "the learner stops that by pausing, which is what the pause control is for");
});

test("no advance at all is the same as waiting for the learner", () => {
  const m = make();
  m.timeline.setAdvance(1000);
  m.timeline.setAdvance(null);
  m.clock.advance(60000);
  assert.equal(m.advanced(), 0);
  assert.equal(m.timeline.active, false);
});

test("reset forgets everything and cancels what was waiting", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", at(3000))]);
  m.timeline.setAdvance(9000);
  m.timeline.pause();
  m.timeline.showEverything();
  m.take();
  m.timeline.reset();
  assert.equal(m.timeline.active, false);
  assert.equal(m.timeline.paused, false);
  assert.equal(m.timeline.allShown, false);
  assert.equal(m.timeline.elapsedMs, 0);
  assert.equal(m.clock.pending(), 0);
  m.clock.advance(60000);
  assert.deepEqual(m.take(), []);
  assert.equal(m.advanced(), 0);
});

test("a layer's objects are timed from when the layer is shown, not from when the slide opened", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", at(1000))]);
  m.clock.advance(10000);
  m.take();
  m.timeline.addLayer("feedback", [obj("note", at(2000))]);
  assert.deepEqual(m.take(), ["hide note"]);
  m.clock.advance(1999);
  assert.deepEqual(m.take(), []);
  m.clock.advance(1);
  assert.deepEqual(m.take(), ["show note"]);
});

test("a layer that is hidden stops being timed, and starts over when it is shown again", () => {
  const m = make();
  m.timeline.addLayer("feedback", [obj("note", at(2000))]);
  m.clock.advance(2000);
  m.take();
  m.timeline.removeLayer("feedback");
  m.clock.advance(60000);
  assert.deepEqual(m.take(), [], "nothing to say about a layer that is not showing");
  assert.equal(m.timeline.active, false);
  m.timeline.addLayer("feedback", [obj("note", at(2000))]);
  assert.deepEqual(m.take(), ["hide note"], "hidden again, because its time starts over");
  m.clock.advance(2000);
  assert.deepEqual(m.take(), ["show note"]);
});

test("the controls are told when something they show has changed", () => {
  const m = make();
  const before = m.changed();
  m.timeline.addLayer("base", [obj("a", at(1000))]);
  assert.ok(m.changed() > before, "adding timing");
  const afterAdd = m.changed();
  m.timeline.pause();
  assert.ok(m.changed() > afterAdd, "pausing");
  const afterPause = m.changed();
  m.timeline.resume();
  assert.ok(m.changed() > afterPause, "resuming");
  const afterResume = m.changed();
  m.timeline.showEverything();
  assert.ok(m.changed() > afterResume, "showing everything");
});

test("a timer that fires a little early looks again instead of missing the moment", () => {
  const clock = new FakeClock();
  const log: string[] = [];
  const timeline = new Timeline({ show: (id) => { log.push(`show ${id}`); }, hide: (id) => { log.push(`hide ${id}`); }, advance: () => undefined }, clock);
  timeline.addLayer("base", [obj("a", at(1000))]);
  log.length = 0;
  clock.t = 999.6; // the real clock can be a hair under when a timer wakes
  timeline.pause();
  timeline.resume();
  clock.advance(0.5);
  assert.deepEqual(log, ["show a"]);
});

test("a hide is told whether the object was ever showing, so an object that never appeared has no exit to play", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("later", at(2000)), obj("leaves", at(0, 1000))]);
  assert.deepEqual(m.told, ["hide later wasShowing=false", "show leaves instant=false"], "hidden from the first moment: nothing to leave");
  m.clock.advance(1000);
  assert.equal(m.told.at(-1), "hide leaves wasShowing=true", "it was on screen, so it has an exit");
});

test("a show is instant only when the learner asked to show everything", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", at(5000)), obj("b", at(8000))]);
  m.clock.advance(5000);
  assert.equal(m.told.at(-1), "show a instant=false", "arriving on its own time can have its effect");
  m.timeline.showEverything();
  assert.equal(m.told.at(-1), "show b instant=true", "but everything at once does not wait for effects");
});

test("an object listed only so its arrival can be animated is not timed, so the learner is not given timing controls for it", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", at(0))]);
  assert.equal(m.timeline.active, false);
  assert.deepEqual(m.take(), ["show a"], "it is shown at once, which is when its entrance plays");
  m.timeline.addLayer("more", [obj("b", at(1000))]);
  assert.equal(m.timeline.active, true);
  m.timeline.removeLayer("more");
  assert.equal(m.timeline.active, false);
  m.timeline.setAdvance(5000);
  assert.equal(m.timeline.active, true, "a slide that moves on by itself still needs them");
});

// ---- timers

function makeTimers() {
  const clock = new FakeClock();
  const readings: string[] = [];
  const ends: string[] = [];
  let advanced = 0;
  let onEnd: (id: string) => void = () => {};
  const timeline = new Timeline({
    show: () => {}, hide: () => {},
    advance: () => { advanced++; ends.push("advance"); },
    timerChanged: (id, r) => readings.push(`${id} ${r.state} ${r.seconds}${r.paused ? " paused" : ""}`),
    timerEnd: (id) => { ends.push(id); onEnd(id); },
  }, clock);
  return { clock, timeline, readings, ends, advanced: () => advanced, onEnd: (fn: (id: string) => void) => { onEnd = fn; }, take: () => readings.splice(0) };
}

test("a timer counts down a second at a time and runs out once", () => {
  const m = makeTimers();
  m.timeline.addTimer("base", "t", 3);
  m.clock.advance(3000);
  assert.deepEqual(m.readings, ["t running 3", "t running 2", "t running 1", "t done 0"]);
  assert.deepEqual(m.ends, ["t"]);
  m.clock.advance(60000);
  assert.deepEqual(m.ends, ["t"], "it does not run out again");
  assert.equal(m.clock.pending(), 0, "and nothing is left waiting");
});

test("a second is counted up, so a timer reads 0 only when the time is up", () => {
  const m = makeTimers();
  m.timeline.addTimer("base", "t", 10);
  m.clock.advance(9999);
  assert.equal(m.readings.at(-1), "t running 1");
  assert.deepEqual(m.ends, []);
  m.clock.advance(1);
  assert.equal(m.readings.at(-1), "t done 0");
  assert.deepEqual(m.ends, ["t"]);
});

test("pausing the timing holds the timer, and resuming carries on from where it was", () => {
  const m = makeTimers();
  m.timeline.addTimer("base", "t", 30);
  m.clock.advance(5000);
  m.take();
  m.timeline.pause();
  assert.deepEqual(m.take(), ["t running 25 paused"]);
  m.clock.advance(120000);
  assert.deepEqual(m.readings, [], "nothing moves while it is held");
  assert.deepEqual(m.ends, []);
  m.timeline.resume();
  assert.deepEqual(m.take(), ["t running 25"]);
  m.clock.advance(25000);
  assert.deepEqual(m.ends, ["t"]);
});

test("adding time moves the end later, and only while the timer is running", () => {
  const m = makeTimers();
  m.timeline.addTimer("base", "t", 30);
  m.clock.advance(10000);
  m.take();
  m.timeline.addTime("t", 30);
  assert.deepEqual(m.take(), ["t running 50"]);
  m.clock.advance(49000);
  assert.deepEqual(m.ends, []);
  m.clock.advance(1000);
  assert.deepEqual(m.ends, ["t"]);
  m.take();
  m.timeline.addTime("t", 30);
  assert.deepEqual(m.readings, [], "time that is up cannot be added to");
  m.timeline.addTime("nothing", 30);
});

test("a rule can stop a timer: it holds the time it had left and does not run out", () => {
  const m = makeTimers();
  m.timeline.addTimer("base", "t", 30);
  m.clock.advance(12500);
  m.timeline.stopTimer("t");
  assert.equal(m.readings.at(-1), "t stopped 18");
  m.clock.advance(60000);
  assert.deepEqual(m.ends, []);
  assert.equal(m.timeline.timing, false);
  assert.equal(m.clock.pending(), 0);
});

test("turning the timer off stops it, and every timer that starts afterwards, even on another slide", () => {
  const m = makeTimers();
  m.timeline.addTimer("base", "a", 30);
  m.timeline.addTimer("base", "b", 40);
  m.clock.advance(4000);
  m.timeline.turnOffTimers();
  assert.deepEqual(m.readings.slice(-2), ["a off 26", "b off 36"]);
  m.clock.advance(60000);
  assert.deepEqual(m.ends, []);
  m.timeline.reset();
  m.take();
  m.timeline.addTimer("base", "c", 20);
  assert.deepEqual(m.take(), ["c off 20"], "the next slide's timer never starts");
  m.clock.advance(60000);
  assert.deepEqual(m.ends, []);
});

test("showing everything turns the slide's timers off, for people who need longer", () => {
  const m = makeTimers();
  m.timeline.addTimer("base", "t", 30);
  m.clock.advance(1000);
  m.timeline.showEverything();
  assert.equal(m.readings.at(-1), "t off 29");
  m.clock.advance(60000);
  assert.deepEqual(m.ends, []);
  m.timeline.reset();
  m.timeline.addTimer("base", "u", 30);
  m.clock.advance(30000);
  assert.deepEqual(m.ends, ["u"], "but the next slide's timer works as usual");
});

test("a timer on a layer that is hidden is forgotten", () => {
  const m = makeTimers();
  m.timeline.addTimer("question", "t", 30);
  m.clock.advance(10000);
  m.timeline.removeLayer("question");
  m.clock.advance(60000);
  assert.deepEqual(m.ends, []);
  m.timeline.addTimer("question", "t", 30);
  m.clock.advance(30000);
  assert.deepEqual(m.ends, ["t"], "shown again, it starts again");
});

test("a running timer needs the timing controls, and they go when it is over", () => {
  const m = makeTimers();
  assert.equal(m.timeline.active, false);
  m.timeline.addTimer("base", "t", 5);
  assert.equal(m.timeline.active, true);
  m.clock.advance(5000);
  assert.equal(m.timeline.active, false);
});

test("a rule that takes the learner to another slide when time is up ends everything here", () => {
  const m = makeTimers();
  m.timeline.setAdvance(5000);
  m.timeline.addTimer("base", "t", 5);
  m.onEnd(() => m.timeline.reset());
  m.clock.advance(5000);
  assert.deepEqual(m.ends, ["t"], "the slide does not move on as well");
  assert.equal(m.advanced(), 0);
  assert.equal(m.clock.pending(), 0);
});

test("when a slide's time and a timer's time are the same moment, the timer's rules run first", () => {
  const m = makeTimers();
  m.timeline.setAdvance(5000);
  m.timeline.addTimer("base", "t", 5);
  m.clock.advance(5000);
  assert.deepEqual(m.ends, ["t", "advance"]);
});

test("two timers run out in their own time", () => {
  const m = makeTimers();
  m.timeline.addTimer("base", "short", 2);
  m.timeline.addTimer("base", "long", 4);
  m.clock.advance(4000);
  assert.deepEqual(m.ends, ["short", "long"]);
});

// ---- timing that waits for the learner: appear "click"

const onClick = (step: number, start = 0, visibleFor: number | null = null): Timing => ({ appear: "click", step, start, visibleFor });

test("an object that waits for a click is timed, and is not shown until the learner presses Show next item", () => {
  assert.equal(isTimed(onClick(1)), true);
  const m = make();
  m.timeline.addLayer("base", [obj("a", onClick(1)), obj("b", onClick(2))]);
  assert.deepEqual(m.take(), ["hide a", "hide b"], "both start hidden, and nothing shows by itself");
  m.clock.advance(60000);
  assert.deepEqual(m.take(), [], "however long the learner waits");
  assert.deepEqual(m.timeline.steps, { total: 2, pressed: 0 });
  assert.equal(m.timeline.active, true, "the controls are there");
});

test("each press shows the next step, in step order, and says what it showed", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("b", onClick(2)), obj("a", onClick(1))]);
  m.take();
  assert.deepEqual(m.timeline.showNext(), ["a"]);
  assert.deepEqual(m.take(), ["show a"]);
  assert.deepEqual(m.timeline.steps, { total: 2, pressed: 1 });
  assert.deepEqual(m.timeline.showNext(), ["b"]);
  assert.deepEqual(m.take(), ["show b"]);
  assert.deepEqual(m.timeline.showNext(), [], "nothing is left to show");
  assert.deepEqual(m.timeline.steps, { total: 2, pressed: 2 });
});

test("objects with the same step show together, and an object's own delay counts from the press", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", onClick(1)), obj("b", onClick(1, 1500)), obj("c", onClick(2))]);
  m.take();
  m.clock.advance(5000);
  assert.deepEqual(m.timeline.showNext(), ["a", "b"]);
  assert.deepEqual(m.take(), ["show a"], "the one with no delay is there at once");
  m.clock.advance(1499);
  assert.deepEqual(m.take(), []);
  m.clock.advance(1);
  assert.deepEqual(m.take(), ["show b"]);
});

test("step numbers do not have to be unbroken: the presses follow the numbers that are there", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", onClick(3)), obj("b", onClick(7))]);
  assert.deepEqual(m.timeline.steps, { total: 2, pressed: 0 });
  assert.deepEqual(m.timeline.showNext(), ["a"]);
  assert.deepEqual(m.timeline.showNext(), ["b"]);
});

test("pausing holds a delay but not the press itself, and Show everything shows every step and leaves nothing to press", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", onClick(1, 2000)), obj("b", onClick(2))]);
  m.take();
  m.timeline.pause();
  m.timeline.showNext();
  m.clock.advance(10000);
  assert.deepEqual(m.take(), [], "the clock is stopped, so the delay has not passed");
  m.timeline.showEverything();
  assert.deepEqual(m.take().sort(), ["show a", "show b"]);
  assert.deepEqual(m.timeline.steps, { total: 2, pressed: 2 });
  assert.deepEqual(m.timeline.showNext(), []);
});

test("an object that waits for a click and has a time to stay goes after that time", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", onClick(1, 0, 3000))]);
  m.take();
  m.timeline.showNext();
  assert.deepEqual(m.take(), ["show a"]);
  m.clock.advance(3000);
  assert.deepEqual(m.take(), ["hide a"]);
});

test("each layer has steps of its own, base layer first, and hiding a layer forgets its presses", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", onClick(1))]);
  m.timeline.addLayer("more", [obj("x", onClick(1))]);
  assert.deepEqual(m.timeline.steps, { total: 2, pressed: 0 });
  assert.deepEqual(m.timeline.showNext(), ["a"]);
  assert.deepEqual(m.timeline.showNext(), ["x"]);
  m.timeline.removeLayer("more");
  m.take();
  m.timeline.addLayer("more", [obj("x", onClick(1))]);
  assert.deepEqual(m.timeline.steps, { total: 2, pressed: 1 }, "the layer starts again when it is shown again");
  assert.deepEqual(m.timeline.showNext(), ["x"]);
});

test("a new slide forgets the presses", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", onClick(1))]);
  m.timeline.showNext();
  m.timeline.reset();
  m.timeline.addLayer("base", [obj("a", onClick(1))]);
  assert.deepEqual(m.timeline.steps, { total: 1, pressed: 0 });
});

// ---- steps that come by themselves: setAutoSteps

function makeAuto(first = 2000, every = 3000) {
  const clock = new FakeClock();
  const log: string[] = [];
  const said: string[] = [];
  const timeline = new Timeline({
    show: (id) => log.push(`show ${id}`),
    hide: (id) => log.push(`hide ${id}`),
    advance: () => undefined,
    stepShown: (ids, pressed, total) => said.push(`${ids.join("+")} ${pressed}/${total}`),
  }, clock);
  timeline.addLayer("base", [obj("a", onClick(1)), obj("b", onClick(2)), obj("c", onClick(3))]);
  timeline.setAutoSteps({ first, every });
  log.length = 0;
  return { clock, timeline, log, said, take: () => log.splice(0) };
}

test("steps that come by themselves appear one after another on the clock, and each is said as it comes", () => {
  const m = makeAuto();
  m.clock.advance(1999);
  assert.deepEqual(m.take(), [], "nothing before the first time");
  m.clock.advance(1);
  assert.deepEqual(m.take(), ["show a"]);
  m.clock.advance(2999);
  assert.deepEqual(m.take(), []);
  m.clock.advance(1);
  assert.deepEqual(m.take(), ["show b"]);
  m.clock.advance(3000);
  assert.deepEqual(m.take(), ["show c"]);
  assert.deepEqual(m.said, ["a 1/3", "b 2/3", "c 3/3"]);
  assert.deepEqual(m.timeline.steps, { total: 3, pressed: 3 });
});

test("pausing holds the schedule, and resuming carries on from where it was", () => {
  const m = makeAuto();
  m.clock.advance(1500);
  m.timeline.pause();
  m.clock.advance(60000);
  assert.deepEqual(m.take(), []);
  m.timeline.resume();
  m.clock.advance(499);
  assert.deepEqual(m.take(), []);
  m.clock.advance(1);
  assert.deepEqual(m.take(), ["show a"]);
});

test("Show next item brings the next step now, the schedule goes on, and a press is not said by the clock", () => {
  const m = makeAuto();
  m.clock.advance(500);
  assert.deepEqual(m.timeline.showNext(), ["a"], "the first one, early");
  assert.deepEqual(m.take(), ["show a"]);
  assert.deepEqual(m.said, [], "the button says it, not the timeline");
  m.clock.advance(1500); // 2000: the time of step 1, which is already showing
  assert.deepEqual(m.take(), []);
  assert.deepEqual(m.said, []);
  m.clock.advance(3000); // 5000: step 2
  assert.deepEqual(m.take(), ["show b"]);
  assert.deepEqual(m.said, ["b 2/3"]);
  assert.deepEqual(m.timeline.showNext(), ["c"], "the last, early");
  assert.deepEqual(m.timeline.showNext(), []);
  m.clock.advance(60000);
  assert.deepEqual(m.said, ["b 2/3"]);
});

test("Show everything shows every step and says nothing more", () => {
  const m = makeAuto();
  m.timeline.showEverything();
  assert.deepEqual(m.take().sort(), ["show a", "show b", "show c"]);
  m.clock.advance(60000);
  assert.deepEqual(m.said, []);
  assert.deepEqual(m.timeline.steps, { total: 3, pressed: 3 });
});

test("an object's own delay counts from when its step came by itself, and a first time of 0 shows at once", () => {
  const clock = new FakeClock();
  const log: string[] = [];
  const t = new Timeline({ show: (id) => log.push(`show ${id}`), hide: () => undefined, advance: () => undefined }, clock);
  t.addLayer("base", [obj("a", onClick(1)), obj("b", onClick(1, 1000))]);
  t.setAutoSteps({ first: 0, every: 4000 });
  assert.deepEqual(log.splice(0), ["show a"]);
  clock.advance(999);
  assert.deepEqual(log.splice(0), []);
  clock.advance(1);
  assert.deepEqual(log.splice(0), ["show b"]);
});

test("without the setting steps wait for presses as before, and a new slide forgets the setting", () => {
  const m = makeAuto();
  m.timeline.reset();
  m.timeline.addLayer("base", [obj("a", onClick(1))]);
  m.clock.advance(60000);
  assert.deepEqual(m.take(), ["hide a"], "the setting was forgotten by the reset");
  assert.deepEqual(m.timeline.steps, { total: 1, pressed: 0 });
});

// ---- going away at a step: timing.until

const goesAt = (step: number, start = 0, appear: Timing = at(0), visibleFor: number | null = null): Timing => ({ ...appear, visibleFor, until: { step, start } });

test("an object that goes away at a step is timed, is there from the start, and goes when the learner shows that step", () => {
  assert.equal(isTimed(goesAt(1)), true);
  const m = make();
  m.timeline.addLayer("base", [obj("a", goesAt(1)), obj("b", onClick(1))]);
  assert.deepEqual(m.take().sort(), ["hide b", "show a"], "a is there at once, b waits");
  assert.deepEqual(m.timeline.steps, { total: 1, pressed: 0 });
  assert.deepEqual(m.timeline.showNextDetail(), { shown: ["b"], left: ["a"] });
  assert.deepEqual(m.take().sort(), ["hide a", "show b"]);
});

test("a step with only things going away is still a step to press, and the press says what went", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", onClick(1)), obj("b", goesAt(2))]);
  m.take();
  assert.deepEqual(m.timeline.steps, { total: 2, pressed: 0 });
  assert.deepEqual(m.timeline.showNextDetail(), { shown: ["a"], left: [] });
  assert.deepEqual(m.timeline.showNextDetail(), { shown: [], left: ["b"] });
  assert.deepEqual(m.timeline.steps, { total: 2, pressed: 2 });
  assert.deepEqual(m.timeline.showNextDetail(), { shown: [], left: [] }, "nothing is left to press");
});

test("one that appears at a click and goes at a later click is there between the two, and its delay counts from the press", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", { ...onClick(1), until: { step: 3, start: 500 } }), obj("b", onClick(2)), obj("c", onClick(3))]);
  m.take();
  m.timeline.showNext();
  assert.deepEqual(m.take(), ["show a"]);
  m.timeline.showNext();
  m.timeline.showNext();
  assert.deepEqual(m.take().sort(), ["show b", "show c"], "a is still there at the third press");
  m.clock.advance(499);
  assert.deepEqual(m.take(), []);
  m.clock.advance(1);
  assert.deepEqual(m.take(), ["hide a"], "gone half a second after the third press");
});

test("with a time to stay as well, the object goes at whichever comes first", () => {
  const first = make();
  first.timeline.addLayer("base", [obj("a", goesAt(1, 0, at(0), 2000)), obj("b", onClick(1))]);
  first.take();
  first.clock.advance(2000);
  assert.deepEqual(first.take(), ["hide a"], "its time ran out before the step was shown");
  const second = make();
  second.timeline.addLayer("base", [obj("a", goesAt(1, 0, at(0), 9000)), obj("b", onClick(1))]);
  second.take();
  second.clock.advance(1000);
  second.timeline.showNext();
  assert.deepEqual(second.take().sort(), ["hide a", "show b"], "the step came first");
});

test("on a slide whose steps come by themselves, objects go away on the clock and the page is told what went", () => {
  const clock = new FakeClock();
  const log: string[] = [];
  const said: string[] = [];
  const t = new Timeline({
    show: (id) => log.push(`show ${id}`), hide: (id) => log.push(`hide ${id}`), advance: () => undefined,
    stepShown: (ids, pressed, total, left) => said.push(`${ids.join("+")}|${left.join("+")} ${pressed}/${total}`),
  }, clock);
  t.addLayer("base", [obj("a", onClick(1)), obj("b", goesAt(1)), obj("c", goesAt(2))]);
  t.setAutoSteps({ first: 1000, every: 2000 });
  log.length = 0;
  clock.advance(1000);
  assert.deepEqual(log.splice(0).sort(), ["hide b", "show a"]);
  clock.advance(2000);
  assert.deepEqual(log.splice(0), ["hide c"]);
  assert.deepEqual(said, ["a|b 1/2", "|c 2/2"]);
});

test("Show everything shows even what would have gone, and pausing holds a delay after the step", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", goesAt(1, 1000)), obj("b", onClick(1))]);
  m.take();
  m.timeline.pause();
  m.timeline.showNext();
  m.clock.advance(5000);
  assert.deepEqual(m.take(), ["show b"], "a has not gone: the clock is stopped");
  m.timeline.resume();
  m.clock.advance(1000);
  assert.deepEqual(m.take(), ["hide a"]);
  m.timeline.showEverything();
  assert.deepEqual(m.take().sort(), ["show a"], "everything means everything");
});

test("what is said for an item: the names, one full stop, and what went away", () => {
  assert.equal(itemSentence(["Chart"], [], 2, 7), "Item 2 of 7 is showing: Chart.");
  assert.equal(itemSentence(["Chart", "Caption"], [], 2, 7), "Item 2 of 7 is showing: Chart, Caption.");
  assert.equal(itemSentence([], [], 1, 3), "Item 1 of 3 is showing.");
  assert.equal(itemSentence(["Chart"], [], 3, 3), "Item 3 of 3 is showing: Chart. That was the last.");
  assert.equal(itemSentence([], ["Chart"], 3, 5), "Item 3 of 5. Chart went away.");
  assert.equal(itemSentence(["Sky"], ["Chart", "Map"], 4, 5), "Item 4 of 5 is showing: Sky. Chart, Map went away.");
  // A paragraph ends with its own full stop: no second one, and the next paragraph follows it without a comma.
  assert.equal(itemSentence(["The flow of information today."], [], 2, 2), "Item 2 of 2 is showing: The flow of information today. That was the last.");
  assert.equal(itemSentence(["One.", "Two?", "Three"], [], 1, 1), "Item 1 of 1 is showing: One. Two? Three. That was the last.");
  assert.equal(itemSentence(["She said “stop.”"], [], 1, 2), "Item 1 of 2 is showing: She said “stop.”");
  assert.equal(itemSentence([], ["A quote: “gone.”"], 1, 2), "Item 1 of 2. A quote: “gone.” went away.");
});
