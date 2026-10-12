import assert from "node:assert/strict";
import { test } from "node:test";
import { isTimed, Timeline, type Clock, type TimedObject } from "./timeline.ts";
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
