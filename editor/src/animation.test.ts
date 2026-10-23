// Tests for animation in the editor: the words an author sees, what the model allows, and the real validator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { EFFECTS } from "../../player/src/animation.ts";
import { describeAnimation, describeEffect, describeSlideTransition, effectChoices, isStartingAnimation, MAX_DURATION, MIN_DURATION, STARTING_ANIMATION, validDuration } from "./animation.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-13" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

test("a new object has no effect either way, and each has its own copy", () => {
  const m = fresh();
  const a = m.addObject("text")!;
  const b = m.addObject("button")!;
  assert.deepEqual(a.animation, STARTING_ANIMATION);
  assert.equal(isStartingAnimation(a.animation), true);
  assert.notEqual(a.animation, b.animation);
  assert.notEqual(a.animation.enter, STARTING_ANIMATION.enter, "not the shared one");
});

test("the list of effects to choose from has the same effects as the format, with different words for arriving and leaving", () => {
  const enter = effectChoices("enter");
  const exit = effectChoices("exit");
  assert.deepEqual(enter.map((c) => c.value), [...EFFECTS]);
  assert.deepEqual(exit.map((c) => c.value), [...EFFECTS]);
  assert.equal(enter.find((c) => c.value === "slideLeft")!.label, "Slide in from the left");
  assert.equal(exit.find((c) => c.value === "slideLeft")!.label, "Slide out to the left");
  assert.equal(enter.find((c) => c.value === "wipeBottom")!.label, "Wipe in from the bottom");
  assert.equal(exit.find((c) => c.value === "wipeLeft")!.label, "Wipe out toward the left");
  assert.equal(enter.find((c) => c.value === "zoom")!.label, "Grow in");
  assert.equal(exit.find((c) => c.value === "zoom")!.label, "Shrink out");
  assert.equal(enter[0]!.label, "No effect");
  assert.equal(new Set(enter.map((c) => c.label)).size, enter.length, "no two choices read the same");
});

test("an animation is described in plain words", () => {
  assert.equal(describeEffect({ effect: "none", duration: 500 }, "enter"), "No effect");
  assert.equal(describeEffect({ effect: "fade", duration: 500 }, "enter"), "Fade in, over 0.5 seconds");
  assert.equal(describeEffect({ effect: "slideTop", duration: 1000 }, "exit"), "Slide out to the top, over 1 second");
  assert.equal(describeAnimation(STARTING_ANIMATION), "Arrives: no effect. Leaves: no effect");
  assert.equal(describeAnimation({ enter: { effect: "slideRight", duration: 600 }, exit: { effect: "fade", duration: 300 } }), "Arrives: slide in from the right, over 0.6 seconds. Leaves: fade out, over 0.3 seconds");
});

test("a duration is a whole number of milliseconds from a tenth of a second to two seconds", () => {
  assert.equal(MIN_DURATION, 100);
  assert.equal(MAX_DURATION, 2000);
  for (const ok of [100, 500, 1999, 2000]) assert.equal(validDuration(ok), true, String(ok));
  for (const bad of [0, 99, 2001, -1, 250.5, Number.NaN, Infinity]) assert.equal(validDuration(bad), false, String(bad));
});

test("an effect and its time are set separately, and say what they did", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  assert.deepEqual(m.setAnimation(t.id, "enter", { effect: "fade" }), { ok: true, message: `${t.name}: Arrives: fade in, over 0.5 seconds. Leaves: no effect` });
  assert.deepEqual(m.setAnimation(t.id, "enter", { duration: 800 }), { ok: true, message: `${t.name}: Arrives: fade in, over 0.8 seconds. Leaves: no effect` });
  assert.deepEqual(m.setAnimation(t.id, "exit", { effect: "slideBottom", duration: 1200 }).ok, true);
  assert.deepEqual(t.animation, { enter: { effect: "fade", duration: 800 }, exit: { effect: "slideBottom", duration: 1200 } });
  assert.deepEqual(m.setAnimation(t.id, "enter", { effect: "fade" }), { ok: true, message: "" }, "no change says nothing");
});

test("effects and times that are not allowed are refused, plainly, and nothing changes", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  for (const bad of [{ effect: "spin" as never }, { duration: 0 }, { duration: 99 }, { duration: 2001 }, { duration: 1.5 }, { duration: Number.NaN }]) {
    const r = m.setAnimation(t.id, "enter", bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(r.message.length > 10);
  }
  assert.deepEqual(t.animation, STARTING_ANIMATION);
  assert.deepEqual(m.setAnimation("obj-9999", "enter", { effect: "fade" }), { ok: false, message: "" });
});

test("an object on another layer can be animated whichever layer is being edited", () => {
  const m = fresh();
  m.addObject("text");
  m.addLayer();
  const b = m.addObject("button")!;
  m.selectLayer(m.slide!.baseLayer.id);
  assert.equal(m.setAnimation(b.id, "enter", { effect: "zoom" }).ok, true);
  assert.equal(b.animation.enter.effect, "zoom");
});

test("typing a time is one undo step, and undo puts the old effect back", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  m.setAnimation(t.id, "enter", { duration: 600 });
  m.setAnimation(t.id, "enter", { duration: 700 });
  m.setAnimation(t.id, "enter", { duration: 900 });
  m.setAnimation(t.id, "exit", { effect: "fade" });
  m.undo();
  assert.equal(m.object!.animation.exit.effect, "none", "the exit is taken back first");
  m.undo();
  assert.equal(m.object!.animation.enter.duration, 500, "and the three edits of the time undo together");
  m.redo();
  assert.equal(m.object!.animation.enter.duration, 900);
});

test("animation is saved in the slide file", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  m.setAnimation(t.id, "enter", { effect: "slideLeft", duration: 600 });
  const slide = JSON.parse(m.allFiles().find((f) => f.path === "slides/slide-001.json")!.text) as { baseLayer: { objects: { id: string; animation: unknown }[] } };
  assert.deepEqual(slide.baseLayer.objects.find((o) => o.id === t.id)!.animation, { enter: { effect: "slideLeft", duration: 600 }, exit: { effect: "none", duration: 500 } });
});

// ---- the real validator

type Finding = { severity: string; rule: string; message: string };

function validate(m: Model): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-an-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the real validator accepts what the editor writes, and warns about an exit that never plays", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  const t = m.addObject("text")!;
  m.setAccessibility(t.id, { altText: "Words" });
  m.setAnimation(t.id, "enter", { effect: "fade", duration: 700 });
  const mine = (f: Finding[]) => f.filter((x) => x.rule.startsWith("animation"));
  assert.deepEqual(validate(m).filter((x) => x.severity === "error"), []);
  assert.deepEqual(mine(validate(m)), [], "an entrance needs no end time");
  m.setAnimation(t.id, "exit", { effect: "fade" });
  assert.deepEqual(mine(validate(m)).map((x) => `${x.severity} ${x.rule}`), ["warning animation-exit-never"]);
  m.setTiming(t.id, { visibleFor: 30000 });
  assert.deepEqual(mine(validate(m)), [], "once it has an end, the exit plays");
});

test("a slide's way in and way out are described together, and a slide with none says so", () => {
  assert.equal(describeSlideTransition(undefined), "Slide in: no effect. Slide out: no effect");
  assert.equal(describeSlideTransition({ enter: { effect: "fade", duration: 500 } }), "Slide in: fade in, over 0.5 seconds. Slide out: no effect");
  assert.equal(describeSlideTransition({ enter: { effect: "slideLeft", duration: 600 }, exit: { effect: "zoom", duration: 300 } }), "Slide in: slide in from the left, over 0.6 seconds. Slide out: shrink out, over 0.3 seconds");
});

test("a slide's transition is chosen one part at a time, kept only while it does something, validated, and undone as one step", () => {
  const m = fresh();
  const id = m.slide!.id;
  const tr = () => m.slide!.transition;
  assert.equal(tr(), undefined, "a new slide has none");
  const first = m.setSlideTransition(id, "enter", { effect: "fade" });
  assert.deepEqual(first, { ok: true, message: `${m.slide!.name}: Slide in: fade in, over 0.5 seconds. Slide out: no effect` });
  assert.deepEqual(tr(), { enter: { effect: "fade", duration: 500 } });
  m.setSlideTransition(id, "exit", { effect: "slideRight", duration: 800 });
  assert.deepEqual(tr(), { enter: { effect: "fade", duration: 500 }, exit: { effect: "slideRight", duration: 800 } });
  assert.deepEqual(m.setSlideTransition(id, "enter", { effect: "fade" }), { ok: true, message: "" }, "nothing changed");
  assert.equal(m.setSlideTransition(id, "enter", { duration: 50 }).ok, false, "too quick");
  assert.equal(m.setSlideTransition(id, "enter", { duration: 3000 }).ok, false, "too slow");
  assert.equal(m.setSlideTransition(id, "enter", { effect: "spin" as never }).ok, false, "not an effect");
  m.setSlideTransition(id, "enter", { duration: 1000 });
  assert.equal(tr()!.enter!.duration, 1000);
  m.undo();
  assert.equal(tr()!.enter!.duration, 500);
  m.setSlideTransition(id, "enter", { effect: "none" });
  assert.deepEqual(tr(), { exit: { effect: "slideRight", duration: 800 } }, "no effect takes that part away");
  m.setSlideTransition(id, "exit", { effect: "none" });
  assert.equal(tr(), undefined, "a slide with neither has no transition at all");
  assert.equal("transition" in m.slide!, false);
  assert.deepEqual(m.setSlideTransition(id, "exit", { duration: 900 }), { ok: true, message: "" }, "a time with no effect means nothing");
  assert.equal(m.setSlideTransition("no-such-slide", "enter", { effect: "fade" }).ok, false);
});

test("a course with slide transitions passes the real validator", () => {
  const m = fresh();
  m.setSlideTransition(m.slide!.id, "enter", { effect: "zoom", duration: 700 });
  m.setSlideTransition(m.slide!.id, "exit", { effect: "fade" });
  const dir = mkdtempSync(path.join(os.tmpdir(), "os-trans-"));
  try {
    for (const f of m.allFiles()) {
      const p = path.join(dir, f.path);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, f.text);
    }
    const r = spawnSync("python", [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    const found = JSON.parse(r.stdout || "[]") as { rule: string; severity: string }[];
    assert.deepEqual(found.filter((f) => f.severity === "error" && !/contrast/.test(f.rule)).map((f) => f.rule), [], r.stdout.slice(0, 500));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
