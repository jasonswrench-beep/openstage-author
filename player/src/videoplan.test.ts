import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTO_STEPS, GRID_MS, NARRATION_DELAY_MS, READ_MS, SILENT_MS, TAIL_MS, narrationSchedule, planSegments, roundUpToGrid, simulateSlide, slideLengthMs, stateAt, type SlideTimingInput } from "./videoplan.ts";
import type { Effect, ObjectAnimation, Timing } from "./types.ts";
import type { TimedObject } from "./timeline.ts";

const at = (start: number, visibleFor: number | null = null): Timing => ({ appear: "time", start, visibleFor });
const click = (step: number, start = 0): Timing => ({ appear: "click", step, start, visibleFor: null });
const withNarration = (start = 0): Timing => ({ appear: "narration", start, visibleFor: null });
const obj = (id: string, timing: Timing, hasAudio = false): TimedObject => ({ id, timing, hasAudio });
const NONE: Effect = { effect: "none", duration: 500 };
const fade = (duration = 500): Effect => ({ effect: "fade", duration });
const anim = (enter: Effect = NONE, exit: Effect = NONE): ObjectAnimation => ({ enter, exit });

function input(over: Partial<SlideTimingInput>): SlideTimingInput {
  return { entries: [], narration: [], advanceMs: null, autoSteps: null, followedClips: [], ...over };
}

test("a slide with nothing timed and nothing said is shown for the fixed time, as one picture", () => {
  const sim = simulateSlide(input({}));
  assert.deepEqual(sim.events, []);
  assert.equal(slideLengthMs(sim, null, null), SILENT_MS);
  const segments = planSegments(sim, new Map(), [], SILENT_MS, true);
  assert.equal(segments.length, 1);
  assert.deepEqual([segments[0]!.startMs, segments[0]!.endMs], [0, SILENT_MS]);
});

test("the time for a slide with nothing in it can be changed", () => {
  const sim = simulateSlide(input({}));
  assert.equal(slideLengthMs(sim, null, null, 8000), 8000);
});

test("an object that comes after 2 seconds is hidden before and showing after, and the slide stays long enough to read it", () => {
  const sim = simulateSlide(input({ entries: [obj("a", at(2000))] }));
  assert.deepEqual(sim.events.map((e) => [e.atMs, e.id, e.visible]), [[0, "a", false], [2000, "a", true]]);
  assert.equal(sim.lastChangeMs, 2000);
  const length = slideLengthMs(sim, null, null);
  assert.equal(length, 2000 + READ_MS);
  const segments = planSegments(sim, new Map(), ["a"], length, true);
  assert.deepEqual(segments.map((s) => [s.startMs, s.endMs, s.state.visible["a"]]), [[0, 2000, false], [2000, length, true]]);
});

test("pictures cover the whole slide with no gap and none under a grid step", () => {
  const sim = simulateSlide(input({ entries: [obj("a", at(1234, 3000)), obj("b", at(2501))] }));
  const length = slideLengthMs(sim, null, null);
  const segments = planSegments(sim, new Map([["a", anim(fade(), fade())]]), ["a", "b"], length, true);
  assert.equal(segments[0]!.startMs, 0);
  assert.equal(segments[segments.length - 1]!.endMs, length);
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    assert.ok(s.endMs - s.startMs >= GRID_MS, `segment ${i} is too short`);
    assert.equal(s.startMs % GRID_MS, 0);
    assert.equal(s.endMs % GRID_MS, 0);
    if (i > 0) assert.equal(s.startMs, segments[i - 1]!.endMs);
  }
});

test("a fade in is a few pictures, each a little more arrived, and then the object as it is", () => {
  const sim = simulateSlide(input({ entries: [obj("a", at(2000))] }));
  const animations = new Map([["a", anim(fade(500))]]);
  const segments = planSegments(sim, animations, ["a"], 4000, true);
  const flying = segments.filter((s) => s.state.flying.length > 0);
  assert.deepEqual(flying.map((s) => [s.startMs, s.state.flying[0]!.progress]), [[2000, 0], [2100, 0.2], [2200, 0.4], [2300, 0.6], [2400, 0.8]]);
  assert.ok(flying.every((s) => s.state.visible["a"] === true));
  const last = segments[segments.length - 1]!;
  assert.deepEqual([last.startMs, last.endMs, last.state.flying.length], [2500, 4000, 0]);
});

test("with motion turned off a fade is a cut", () => {
  const sim = simulateSlide(input({ entries: [obj("a", at(2000))] }));
  const segments = planSegments(sim, new Map([["a", anim(fade(500))]]), ["a"], 4000, false);
  assert.deepEqual(segments.map((s) => [s.startMs, s.endMs]), [[0, 2000], [2000, 4000]]);
  assert.ok(segments.every((s) => s.state.flying.length === 0));
});

test("an object with an entrance that is there from the start plays it as the slide opens", () => {
  const sim = simulateSlide(input({ entries: [obj("a", at(0))] }));
  const segments = planSegments(sim, new Map([["a", anim(fade(300))]]), ["a"], 3000, true);
  assert.deepEqual(segments.slice(0, 3).map((s) => [s.startMs, s.state.flying[0]?.progress]), [[0, 0], [100, 1 / 3], [200, 2 / 3]]);
  assert.equal(segments[3]!.startMs, 300);
  assert.equal(segments[3]!.state.flying.length, 0);
});

test("an object that goes away after a while plays its exit, still showing while it leaves", () => {
  const sim = simulateSlide(input({ entries: [obj("a", at(0, 2000))] }));
  const animations = new Map([["a", anim(NONE, fade(300))]]);
  const segments = planSegments(sim, animations, ["a"], 4000, true);
  const leaving = segments.filter((s) => s.state.flying.length > 0);
  assert.deepEqual(leaving.map((s) => [s.startMs, s.state.flying[0]!.phase, s.state.visible["a"]]), [[2000, "exit", true], [2100, "exit", true], [2200, "exit", true]]);
  const after = segments[segments.length - 1]!;
  assert.deepEqual([after.startMs, after.state.visible["a"]], [2300, false]);
});

test("an object that was never on screen does not play an exit", () => {
  const sim = simulateSlide(input({ entries: [obj("a", at(3000))] }));
  const state = stateAt(sim.events, new Map([["a", anim(NONE, fade(300))]]), ["a"], 0, true);
  assert.deepEqual(state, { visible: { a: false }, flying: [] });
});

test("steps that wait for a press come by themselves on the video's times", () => {
  const sim = simulateSlide(input({ entries: [obj("a", click(1)), obj("b", click(2)), obj("c", click(3))] }));
  const shown = sim.events.filter((e) => e.visible).map((e) => [e.id, e.atMs]);
  assert.deepEqual(shown, [["a", AUTO_STEPS.first], ["b", AUTO_STEPS.first + AUTO_STEPS.every], ["c", AUTO_STEPS.first + 2 * AUTO_STEPS.every]]);
});

test("a slide that says when its steps come is followed", () => {
  const sim = simulateSlide(input({ entries: [obj("a", click(1)), obj("b", click(2))], autoSteps: { first: 1000, every: 500 } }));
  assert.deepEqual(sim.events.filter((e) => e.visible).map((e) => [e.id, e.atMs]), [["a", 1000], ["b", 1500]]);
});

test("an object that waits for its own narration comes when that narration starts, and at the start if there is no audio", () => {
  const sim = simulateSlide(input({
    entries: [obj("a", withNarration(0), true), obj("b", withNarration(500), true), obj("c", withNarration(0), false)],
    narration: [{ id: "a", startMs: 300 }, { id: "b", startMs: 4300 }],
  }));
  const shown = Object.fromEntries(sim.events.filter((e) => e.visible).map((e) => [e.id, e.atMs]));
  assert.deepEqual(shown, { a: 300, b: 4800, c: 0 });
});

test("what is timed to a video or sound clip shows from the start, because a video cannot play the clip", () => {
  const timing: Timing = { appear: "media", media: "clip", start: 5000, visibleFor: null };
  const sim = simulateSlide(input({ entries: [obj("a", timing)], followedClips: ["clip"] }));
  assert.equal(sim.lastChangeMs, 0);
  assert.deepEqual(stateAt(sim.events, new Map(), ["a"], 0, true), { visible: { a: true }, flying: [] });
});

test("a slide that moves on by itself lasts at least that long", () => {
  const sim = simulateSlide(input({ entries: [obj("a", at(1000))], advanceMs: 12000 }));
  assert.equal(sim.advancedAtMs, 12000);
  assert.equal(slideLengthMs(sim, null, 12000), 12000);
});

test("a slide that is narrated lasts as long as the narration and a moment after, rounded up to the grid", () => {
  const schedule = narrationSchedule([{ id: "a", durationMs: 4321 }, { id: "b", durationMs: 2000 }]);
  assert.deepEqual(schedule, [{ id: "a", startMs: NARRATION_DELAY_MS, endMs: NARRATION_DELAY_MS + 4321 }, { id: "b", startMs: NARRATION_DELAY_MS + 4321, endMs: NARRATION_DELAY_MS + 6321 }]);
  const sim = simulateSlide(input({ narration: schedule }));
  const length = slideLengthMs(sim, schedule[1]!.endMs, null);
  assert.equal(length, roundUpToGrid(NARRATION_DELAY_MS + 6321 + TAIL_MS));
  assert.equal(length % GRID_MS, 0);
});

test("whichever of the narration, the last object and the set time is longest decides", () => {
  const sim = simulateSlide(input({ entries: [obj("a", at(20000))] }));
  assert.equal(slideLengthMs(sim, 5000, 8000), 20000 + READ_MS);
  assert.equal(slideLengthMs(sim, 30000, 8000), 30000 + TAIL_MS);
});

test("two objects that arrive at the same moment are one change", () => {
  const sim = simulateSlide(input({ entries: [obj("a", at(2000)), obj("b", at(2000))] }));
  const segments = planSegments(sim, new Map(), ["a", "b"], 5000, true);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[1]!.state.visible, { a: true, b: true });
});

test("an exit that waits for a step takes the object away when the step comes", () => {
  const leaves: Timing = { appear: "time", start: 0, visibleFor: null, until: { step: 1, start: 0 } };
  const sim = simulateSlide(input({ entries: [obj("a", leaves), obj("b", click(1))] }));
  assert.deepEqual(sim.events.filter((e) => e.atMs > 0).map((e) => [e.atMs, e.id, e.visible, e.wasShowing]), [[AUTO_STEPS.first, "a", false, true], [AUTO_STEPS.first, "b", true, false]]);
});

test("the same slide planned twice gives the same pictures", () => {
  const entries = [obj("a", at(1500, 2500)), obj("b", click(1)), obj("c", withNarration(200), true)];
  const make = () => {
    const sim = simulateSlide(input({ entries, narration: [{ id: "c", startMs: 300 }] }));
    return planSegments(sim, new Map([["a", anim(fade(), fade())]]), ["a", "b", "c"], slideLengthMs(sim, 6000, null), true);
  };
  assert.deepEqual(make(), make());
});
