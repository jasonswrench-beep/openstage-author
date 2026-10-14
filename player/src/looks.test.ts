// Run with: npm test   (from the player folder)
import assert from "node:assert/strict";
import { test } from "node:test";
import { lookLayers, READY_LOOKS, spokenOnChange } from "./looks.ts";
import { examplePackage, newRuntime } from "./test-helpers.ts";
import type { ObjectState, Trigger } from "./types.ts";

const states: Record<string, ObjectState> = {
  visited: { style: { color: "#111111", fill: "#222222" } },
  hover: { style: { fill: "#333333" } },
  done: { style: { fill: "#444444" }, announce: "Marked as done" },
  quiet: { style: { fill: "#555555" } },
  silent: { announce: "   " },
};

const now = (over: Partial<{ name: string; visited: boolean; hover: boolean }> = {}) => ({ name: "normal", visited: false, hover: false, ...over });

test("with nothing going on there is no look over the object's own", () => {
  assert.deepEqual(lookLayers(states, now()), []);
  assert.deepEqual(lookLayers({}, now({ visited: true, hover: true, name: "done" })), []);
});

test("looks stack in order, so a later one wins: used, then what a rule applied, then hover", () => {
  assert.deepEqual(lookLayers(states, now({ visited: true })), [states["visited"]!.style]);
  assert.deepEqual(lookLayers(states, now({ name: "done" })), [states["done"]!.style]);
  assert.deepEqual(lookLayers(states, now({ visited: true, name: "done", hover: true })), [states["visited"]!.style, states["done"]!.style, states["hover"]!.style]);
});

test("a look the object does not have, or that sets no style, adds nothing", () => {
  assert.deepEqual(lookLayers(states, now({ name: "nowhere" })), []);
  assert.deepEqual(lookLayers(states, now({ name: "silent" })), []);
  assert.deepEqual(lookLayers({ done: { announce: "Done" } }, now({ hover: true })), []);
});

test("a rule can apply a ready-made look by name too", () => {
  assert.deepEqual(lookLayers(states, now({ name: "hover" })), [states["hover"]!.style]);
  assert.deepEqual(READY_LOOKS, ["hover", "visited", "disabled"]);
});

test("a rule applying a look with a message says it, and nothing else does", () => {
  assert.equal(spokenOnChange(states, "normal", "done"), "Marked as done");
  assert.equal(spokenOnChange(states, "normal", "quiet"), null, "no message, no words");
  assert.equal(spokenOnChange(states, "normal", "silent"), null, "blank words are no words");
  assert.equal(spokenOnChange(states, "normal", "nowhere"), null, "a look the object lacks says nothing");
});

test("going back to normal, or to the look it already has, says nothing", () => {
  assert.equal(spokenOnChange(states, "done", "normal"), null);
  assert.equal(spokenOnChange(states, "done", "done"), null, "no change, nothing new to hear");
  assert.equal(spokenOnChange(states, "quiet", "done"), "Marked as done", "from one look to another is a change");
});

const rule = (id: string, action: Trigger["action"], target: string, value?: string): Trigger =>
  ({ id, event: "slideStart", action, target, ...(value === undefined ? {} : { value }), conditions: [] }) as Trigger;

test("the course hands a rule's look to the display, and normal when there is no value", () => {
  const pkg = examplePackage();
  const slide = pkg.slides[0]!;
  slide.baseLayer.objects[0]!.triggers.push(rule("trg-8001", "changeState", "obj-0004", "done"), rule("trg-8002", "changeState", "obj-0004"));
  const { rt, log } = newRuntime(pkg);
  rt.goTo("slide-001"); // opening the slide runs its slideStart rules
  assert.deepEqual(log.filter((l) => l.startsWith("state ")), ["state obj-0004 done", "state obj-0004 normal"]);
});
