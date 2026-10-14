// Timing that follows a video or an audio clip: what shows depends only on where the clip is, a clip that cannot play never leaves anything
// hidden, and Pause timing holds a playing clip. The clip and the clock are moved by hand.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MediaFollower, POLL_MS, type ClipLike, type Ticker } from "./follow.ts";
import { isTimed, Timeline, type Clock, type TimedObject } from "./timeline.ts";
import type { Timing } from "./types.ts";

class FakeClock implements Clock {
  t = 0;
  now(): number { return this.t; }
  set(): unknown { return 1; }
  clear(): void { /* the clock is never needed here */ }
}

const follows = (media: string, start: number, visibleFor: number | null = null): Timing => ({ appear: "media", media, start, visibleFor });
const obj = (id: string, timing: Timing): TimedObject => ({ id, timing, hasAudio: false });

function make() {
  const clock = new FakeClock();
  const log: string[] = [];
  const timeline = new Timeline({ show: (id) => log.push(`show ${id}`), hide: (id) => log.push(`hide ${id}`), advance: () => log.push("advance") }, clock);
  return { clock, log, timeline, take: () => log.splice(0) };
}

// ---- the timeline

test("timing that follows a clip counts as timing, and so shows the learner's controls", () => {
  assert.equal(isTimed(follows("v", 0)), true);
  const m = make();
  m.timeline.addLayer("base", [obj("note", follows("v", 5000))]);
  assert.equal(m.timeline.active, true);
});

test("an object waits for the clip to reach its time, shows, and goes after its time in the clip", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("note", follows("v", 5000, 4000))]);
  assert.deepEqual(m.take(), ["hide note"], "told at the start that it is not showing yet, as every timed object is");
  m.timeline.clipTime("v", 4999);
  assert.deepEqual(m.take(), []);
  m.timeline.clipTime("v", 5000);
  assert.deepEqual(m.take(), ["show note"]);
  m.timeline.clipTime("v", 8999);
  assert.deepEqual(m.take(), []);
  m.timeline.clipTime("v", 9000);
  assert.deepEqual(m.take(), ["hide note"]);
});

test("the clock does not move a clip's objects", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("note", follows("v", 1000))]);
  m.take();
  m.clock.t += 60_000;
  m.timeline.clipTime("v", 0);
  assert.deepEqual(m.take(), [], "a minute of the clock is no time at all in the clip");
});

test("an object timed for the very start of the clip shows at once", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("title", follows("v", 0))]);
  assert.deepEqual(m.take(), ["show title"], "a clip not heard from yet is at its start");
});

test("going back hides what had not been reached yet, and skipping ahead shows what belongs to the new place", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", follows("v", 5000, 4000)), obj("b", follows("v", 20_000))]);
  m.take();
  m.timeline.clipTime("v", 7000);
  assert.deepEqual(m.take(), ["show a"]);
  m.timeline.clipTime("v", 25_000);
  assert.deepEqual(m.take().sort(), ["hide a", "show b"], "skipped past a, and b is there");
  m.timeline.clipTime("v", 6000);
  assert.deepEqual(m.take().sort(), ["hide b", "show a"], "back in a's time, b has not happened yet");
  m.timeline.clipTime("v", 0);
  assert.deepEqual(m.take(), ["hide a"]);
});

test("an object with no end time stays for the rest of the clip, and goes again if the learner goes back before it", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("note", follows("v", 3000))]);
  m.take();
  m.timeline.clipTime("v", 3000);
  m.timeline.clipTime("v", 600_000);
  assert.deepEqual(m.take(), ["show note"], "shown once, and still showing a long way on");
  m.timeline.clipTime("v", 2000);
  assert.deepEqual(m.take(), ["hide note"]);
});

test("each object follows its own clip", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", follows("one", 1000)), obj("b", follows("two", 1000))]);
  m.take();
  m.timeline.clipTime("one", 1500);
  assert.deepEqual(m.take(), ["show a"]);
  m.timeline.clipTime("two", 1500);
  assert.deepEqual(m.take(), ["show b"]);
});

test("a clip that cannot play shows everything that follows it, and keeps it showing", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", follows("v", 5000, 2000)), obj("b", follows("v", 90_000))]);
  m.take();
  m.timeline.clipFailed("v");
  assert.deepEqual(m.take().sort(), ["show a", "show b"]);
  m.timeline.clipTime("v", 0);
  m.timeline.clipTime("v", 50_000);
  assert.deepEqual(m.take(), [], "nothing is hidden again by the time of a clip that is not playing");
});

test("Show everything now shows what follows a clip too, and leaves it showing", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", follows("v", 5000, 2000))]);
  m.take();
  m.timeline.showEverything();
  assert.deepEqual(m.take(), ["show a"]);
  m.timeline.clipTime("v", 60_000);
  assert.deepEqual(m.take(), []);
});

test("pausing the timing does not stop a clip's objects following the clip, because the player pauses the clip itself", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", follows("v", 1000))]);
  m.take();
  m.timeline.pause();
  m.timeline.clipTime("v", 2000);
  assert.deepEqual(m.take(), ["show a"], "the learner who plays the clip while the timing is paused still gets what belongs to it");
});

test("an object on a layer shown later follows the clip as it is then", () => {
  const m = make();
  m.timeline.clipTime("v", 8000);
  m.timeline.addLayer("later", [obj("a", follows("v", 5000, 4000))]);
  assert.deepEqual(m.take(), ["show a"]);
});

test("a new slide forgets where the clips were", () => {
  const m = make();
  m.timeline.addLayer("base", [obj("a", follows("v", 5000))]);
  m.timeline.clipTime("v", 9000);
  m.take();
  m.timeline.reset();
  m.timeline.addLayer("base", [obj("a", follows("v", 5000))]);
  assert.deepEqual(m.take(), ["hide a"], "the clip is back at its start, so it is not showing yet");
});

// ---- the follower

class FakeClip implements ClipLike {
  currentTime = 0;
  paused = true;
  plays = 0;
  pauses = 0;
  refuse = false;
  private listeners = new Map<string, Set<() => void>>();
  play(): Promise<void> {
    this.plays++;
    if (this.refuse) return Promise.reject(new Error("not allowed"));
    this.paused = false;
    this.emit("playing");
    return Promise.resolve();
  }
  pause(): void {
    this.pauses++;
    this.paused = true;
    this.emit("pause");
  }
  addEventListener(type: string, l: () => void): void { (this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!).add(l); }
  removeEventListener(type: string, l: () => void): void { this.listeners.get(type)?.delete(l); }
  emit(type: string): void { for (const l of [...(this.listeners.get(type) ?? [])]) l(); }
  count(): number { return [...this.listeners.values()].reduce((n, s) => n + s.size, 0); }
}

class FakeTicker implements Ticker {
  tick: (() => void) | null = null;
  started = 0;
  stopped = 0;
  start(fn: () => void): unknown { this.started++; this.tick = fn; return this.started; }
  stop(): void { this.stopped++; this.tick = null; }
}

function follower() {
  const times: string[] = [];
  const failed: string[] = [];
  const ticker = new FakeTicker();
  const f = new MediaFollower({ time: (id, ms) => times.push(`${id}@${ms}`), failed: (id) => failed.push(id) }, ticker);
  return { f, times, failed, ticker, last: () => times[times.length - 1] };
}

test("attaching a clip reports where it is straight away", () => {
  const w = follower();
  const clip = new FakeClip();
  clip.currentTime = 12.34;
  w.f.attach("v", clip);
  assert.deepEqual(w.times, ["v@12340"]);
});

test("the clip's own events report its time, including skipping and going back", () => {
  const w = follower();
  const clip = new FakeClip();
  w.f.attach("v", clip);
  clip.currentTime = 30; clip.emit("seeking");
  assert.equal(w.last(), "v@30000");
  clip.currentTime = 31; clip.emit("timeupdate");
  assert.equal(w.last(), "v@31000");
  clip.currentTime = 2; clip.emit("seeked");
  assert.equal(w.last(), "v@2000");
  clip.currentTime = 61; clip.emit("ended");
  assert.equal(w.last(), "v@61000");
});

test("a clip that is not there has failed, and so does one that raises an error", () => {
  const w = follower();
  w.f.attach("missing", null);
  assert.deepEqual(w.failed, ["missing"]);
  const clip = new FakeClip();
  w.f.attach("bad", clip);
  clip.emit("error");
  assert.deepEqual(w.failed, ["missing", "bad"]);
});

test("while a clip plays its time is read often, and the reading stops when it does", () => {
  const w = follower();
  const clip = new FakeClip();
  w.f.attach("v", clip);
  assert.equal(w.ticker.started, 0, "nothing to read while it is paused");
  void clip.play();
  assert.equal(w.ticker.started, 1);
  clip.currentTime = 1.5;
  w.ticker.tick!();
  assert.equal(w.last(), "v@1500");
  clip.pause();
  assert.equal(w.ticker.stopped, 1);
  assert.equal(POLL_MS <= 250, true, "more often than the clip reports");
});

test("Pause timing pauses a clip that is playing, and Resume plays it again", () => {
  const w = follower();
  const a = new FakeClip();
  const b = new FakeClip();
  w.f.attach("a", a);
  w.f.attach("b", b);
  void a.play();
  assert.equal(w.f.hold(), 1, "only the one that was playing");
  assert.equal(a.paused, true);
  assert.equal(b.pauses, 0);
  assert.equal(w.f.release(), 1);
  assert.equal(a.paused, false);
  assert.equal(b.plays, 0, "the one that was not playing is left alone");
});

test("a clip the browser will not play again is left for the learner to start", async () => {
  const w = follower();
  const clip = new FakeClip();
  w.f.attach("v", clip);
  void clip.play();
  w.f.hold();
  clip.refuse = true;
  assert.equal(w.f.release(), 1);
  await Promise.resolve();
  assert.equal(clip.paused, true);
});

test("a new slide stops following: no more reports, no clip held, nothing left listening", () => {
  const w = follower();
  const clip = new FakeClip();
  w.f.attach("v", clip);
  void clip.play();
  w.f.hold();
  w.f.detach();
  assert.equal(clip.count(), 0);
  assert.equal(w.f.following, false);
  const before = w.times.length;
  clip.emit("timeupdate");
  assert.equal(w.times.length, before);
  assert.equal(w.f.release(), 0, "nothing is held any more");
});

test("following the same clip again does not leave the old listeners behind", () => {
  const w = follower();
  const clip = new FakeClip();
  w.f.attach("v", clip);
  const once = clip.count();
  w.f.attach("v", clip);
  assert.equal(clip.count(), once);
});
