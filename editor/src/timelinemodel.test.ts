// Tests for the timeline view's arithmetic: bars, the axis, keys and the pointer, and the words a screen reader hears.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { OSObject } from "../../player/src/types.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";
import {
  BIG_STEP_MS, buildTimeline, endText, MIN_STAY_MS, msAtPointer, nudged, PAGE_STEP_MS, percentOf, snapMs, startMax, startText, STEP_MS,
  stayFromValue, stayMax, tickLabel, tickStep, type Bar,
} from "./timelinemodel.ts";

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-12" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const none = (): number | null => null;
const byId = (lengths: Record<string, number | null>) => (o: OSObject): number | null => lengths[o.id] ?? null;

/** A slide with three text objects, each with narration, in reading order. */
function narrated(): { m: Model; a: OSObject; b: OSObject; c: OSObject } {
  const m = fresh();
  const a = m.addObject("text")!;
  const b = m.addObject("text")!;
  const c = m.addObject("text")!;
  for (const o of [a, b, c]) m.setNarrationScript(o.id, `Words for ${o.id}.`);
  return { m, a, b, c };
}

test("the axis has a friendly step and at most twelve ticks", () => {
  assert.equal(tickStep(10000), 1000);
  assert.equal(tickStep(12000), 1000);
  assert.equal(tickStep(13000), 2000);
  assert.equal(tickStep(60000), 5000);
  assert.equal(tickStep(120000), 10000, "ten seconds apart is exactly twelve ticks");
  assert.equal(tickStep(3600000), 300000);
  for (const h of [10000, 25000, 61000, 400000, 3600000]) assert.ok(h / tickStep(h) <= 12, String(h));
});

test("ticks are labelled in seconds, and in minutes from a minute on", () => {
  assert.equal(tickLabel(0), "0 s");
  assert.equal(tickLabel(2500), "2.5 s");
  assert.equal(tickLabel(15000), "15 s");
  assert.equal(tickLabel(60000), "1:00");
  assert.equal(tickLabel(90000), "1:30");
  assert.equal(tickLabel(605000), "10:05");
});

test("a slide with nothing timed has an axis of ten seconds and every object always there", () => {
  const m = fresh();
  m.addObject("text");
  m.addObject("button");
  const view = buildTimeline(m.timingRows(), null, none);
  assert.equal(view.horizon, 10000);
  assert.equal(view.advanceAt, null);
  assert.equal(view.bars.length, m.timingRows().length);
  for (const b of view.bars) assert.deepEqual([b.from, b.to, b.approximate, b.narration], [0, null, false, null]);
  assert.deepEqual(view.ticks.map((t) => t.ms), [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]);
});

test("a delay and a time to leave place the bar", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  m.setTiming(t.id, { start: 2500, visibleFor: 6000 });
  const bar = buildTimeline(m.timingRows(), null, none).bars.find((b) => b.id === t.id)!;
  assert.deepEqual([bar.from, bar.to, bar.origin], [2500, 8500, 0]);
});

test("the axis grows to hold what is on it, with room beyond, and is a whole number of ticks long", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  m.setTiming(t.id, { start: 40000, visibleFor: 20000 });
  const view = buildTimeline(m.timingRows(), null, none);
  assert.ok(view.horizon >= 60000 + 3000, `${view.horizon} leaves room after the last end`);
  assert.equal(view.horizon % tickStep(view.horizon), 0);
  assert.equal(view.ticks.at(-1)!.ms, view.horizon);
  assert.ok(view.ticks.length <= 13);
  const withAdvance = buildTimeline(m.timingRows(), 120000, none);
  assert.ok(withAdvance.horizon >= 123000, "the moment the slide moves on is on the axis too");
  assert.equal(withAdvance.advanceAt, 120000);
});

test("narration plays one after another in reading order, so each starts where the one before ended", () => {
  const { m, a, b, c } = narrated();
  const view = buildTimeline(m.timingRows(), null, byId({ [a.id]: 4000, [b.id]: 2500, [c.id]: 6000 }));
  const n = (o: OSObject) => view.bars.find((x) => x.id === o.id)!.narration;
  assert.deepEqual(n(a), { start: 0, end: 4000 });
  assert.deepEqual(n(b), { start: 4000, end: 6500 });
  assert.deepEqual(n(c), { start: 6500, end: 12500 });
  assert.ok(view.horizon >= 12500, "the end of the last narration is on the axis");
});

test("an object that follows its narration is drawn from where its narration starts, plus its delay", () => {
  const { m, a, b, c } = narrated();
  m.setTiming(b.id, { appear: "narration", start: 500, visibleFor: 3000 });
  m.setTiming(c.id, { appear: "narration", start: 0 });
  const view = buildTimeline(m.timingRows(), null, byId({ [a.id]: 4000, [b.id]: 2500, [c.id]: 6000 }));
  const bar = (o: OSObject): Bar => view.bars.find((x) => x.id === o.id)!;
  assert.deepEqual([bar(b).origin, bar(b).from, bar(b).to, bar(b).approximate], [4000, 4500, 7500, false]);
  assert.deepEqual([bar(c).origin, bar(c).from, bar(c).to], [6500, 6500, null]);
});

test("a narration with no audio yet leaves everything after it unplaced, and the objects that follow it are marked as guesses", () => {
  const { m, a, b, c } = narrated();
  m.setTiming(b.id, { appear: "narration", start: 0 });
  m.setTiming(c.id, { appear: "narration", start: 1000 });
  const view = buildTimeline(m.timingRows(), null, byId({ [a.id]: 4000, [b.id]: null, [c.id]: 6000 }));
  const bar = (o: OSObject): Bar => view.bars.find((x) => x.id === o.id)!;
  assert.equal(bar(a).narration?.end, 4000, "what came before is still placed");
  assert.equal(bar(b).narration, null);
  assert.equal(bar(c).narration, null, "c cannot be placed because b has no length");
  assert.deepEqual([bar(b).approximate, bar(c).approximate], [true, true]);
  assert.deepEqual([bar(b).from, bar(c).from], [0, 1000], "a guess is drawn from the start of the slide");
  assert.equal(bar(a).approximate, false);
});

test("an object that follows narration but has none is a problem the validator reports; the view still draws it", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  assert.equal(m.setTiming(t.id, { appear: "narration" }).ok, false);
  const bar = buildTimeline(m.timingRows(), null, none).bars.find((b) => b.id === t.id)!;
  assert.equal(bar.hasNarration, false);
});

test("each layer has its own narration clock", () => {
  const m = fresh();
  const a = m.addObject("text")!;
  m.setNarrationScript(a.id, "Base words.");
  const layer = m.addLayer()!;
  const b = m.addObject("text")!;
  m.setNarrationScript(b.id, "Layer words.");
  const view = buildTimeline(m.timingRows(), null, byId({ [a.id]: 5000, [b.id]: 3000 }));
  assert.deepEqual(view.bars.find((x) => x.id === a.id)!.narration, { start: 0, end: 5000 });
  assert.deepEqual(view.bars.find((x) => x.id === b.id)!.narration, { start: 0, end: 3000 }, "the layer's narration starts when the layer is shown, not after the base layer's");
  assert.equal(view.bars.find((x) => x.id === b.id)!.layerId, layer.id);
});

test("keys move a time by a tenth of a second, a second, or five, and keep it between its limits", () => {
  assert.equal(nudged(1000, "ArrowRight", false, 0, 10000), 1000 + STEP_MS);
  assert.equal(nudged(1000, "ArrowUp", false, 0, 10000), 1000 + STEP_MS);
  assert.equal(nudged(1000, "ArrowLeft", false, 0, 10000), 1000 - STEP_MS);
  assert.equal(nudged(1000, "ArrowDown", false, 0, 10000), 1000 - STEP_MS);
  assert.equal(nudged(1000, "ArrowRight", true, 0, 10000), 1000 + BIG_STEP_MS);
  assert.equal(nudged(1000, "ArrowLeft", true, 0, 10000), 0, "kept at the least");
  assert.equal(nudged(9500, "PageUp", false, 0, 10000), 10000, "kept at the most");
  assert.equal(nudged(7000, "PageDown", false, 0, 10000), 7000 - PAGE_STEP_MS);
  assert.equal(nudged(4000, "Home", false, 200, 10000), 200);
  assert.equal(nudged(4000, "End", false, 200, 10000), 10000);
  for (const key of ["Tab", "Enter", "a", "Escape", "Delete", " "]) assert.equal(nudged(4000, key, false, 0, 10000), null, `${key} keeps its usual job`);
});

test("a pointer position is a time to the nearest tenth of a second, kept on the axis", () => {
  assert.equal(msAtPointer(100, 100, 1000, 10000), 0);
  assert.equal(msAtPointer(600, 100, 1000, 10000), 5000);
  assert.equal(msAtPointer(173, 100, 1000, 10000), 700, "730 ms rounds to 700");
  assert.equal(msAtPointer(176, 100, 1000, 10000), 800);
  assert.equal(msAtPointer(0, 100, 1000, 10000), 0, "left of the track is the start");
  assert.equal(msAtPointer(5000, 100, 1000, 10000), 10000, "right of the track is the end");
  assert.equal(msAtPointer(50, 0, 0, 10000), 0, "a track with no width gives the start");
  assert.equal(snapMs(149), 100);
  assert.equal(snapMs(150), 200);
  assert.equal(snapMs(-300), 0);
  assert.equal(percentOf(2500, 10000), 25);
  assert.equal(percentOf(-5, 10000), 0);
  assert.equal(percentOf(20000, 10000), 100);
});

test("the end grip: a time to stay, or past the edge, which means it stays", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  m.setTiming(t.id, { start: 2000 });
  const bar = buildTimeline(m.timingRows(), null, none).bars.find((b) => b.id === t.id)!;
  assert.equal(stayMax(bar, 10000), 8000, "the room from when it appears to the end of the axis");
  assert.equal(stayFromValue(3000, bar, 10000), 3000);
  assert.equal(stayFromValue(3040, bar, 10000), 3000, "to a tenth of a second");
  assert.equal(stayFromValue(0, bar, 10000), MIN_STAY_MS, "never less than the least");
  assert.equal(stayFromValue(8000, bar, 10000), null, "at the edge it stays");
  assert.equal(stayFromValue(9000, bar, 10000), null);
  assert.equal(startMax(bar, 10000), 10000);
  const follower = { ...bar, origin: 4000 };
  assert.equal(startMax(follower, 10000), 6000, "a delay after narration has less room");
});

test("what a screen reader hears for each grip", () => {
  assert.equal(startText({ appear: "time", start: 2500, visibleFor: null }, true), "2.5 seconds after the slide opens");
  assert.equal(startText({ appear: "time", start: 0, visibleFor: null }, true), "0 seconds after the slide opens");
  assert.equal(startText({ appear: "time", start: 1000, visibleFor: null }, false), "1 second after its layer is shown");
  assert.equal(startText({ appear: "narration", start: 500, visibleFor: null }, true), "0.5 seconds after its narration starts");
  assert.equal(endText({ appear: "time", start: 0, visibleFor: null }), "stays until the slide ends");
  assert.equal(endText({ appear: "time", start: 0, visibleFor: 6000 }), "disappears 6 seconds after it appears");
});
