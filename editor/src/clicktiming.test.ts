// Timing that waits for the learner (appear click), in the editor: choosing it, the item numbers it hands out, the words for it, the timeline's guess at
// where it sits, undo, and the real validator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { OSObject } from "../../player/src/types.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";
import { describeTiming } from "./timing.ts";
import { buildTimeline, startText } from "./timelinemodel.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-21" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

function three(): { m: Model; a: OSObject; b: OSObject; c: OSObject } {
  const m = fresh();
  const a = m.addObject("text")!;
  m.setName(a.id, "First");
  const b = m.addObject("text")!;
  m.setName(b.id, "Second");
  const c = m.addObject("text")!;
  m.setName(c.id, "Third");
  return { m, a, b, c };
}

const timingOf = (m: Model, o: OSObject) => m.timingRows().find((r) => r.object.id === o.id)!.object.timing;

test("choosing to wait for the learner gives an object the next item number, and says so in words", () => {
  const { m, a, b } = three();
  const r = m.setTiming(a.id, { appear: "click" });
  assert.equal(r.ok, true);
  assert.deepEqual(timingOf(m, a), { appear: "click", step: 1, start: 0, visibleFor: null });
  assert.equal(r.message, "First: Appears when the learner shows item 1, then stays");
  m.setTiming(b.id, { appear: "click" });
  assert.equal(timingOf(m, b).step, 2, "the next object is the next press");
});

test("the item number can be set, and objects can share one, but it must be a whole number from 1 to 200", () => {
  const { m, a, b } = three();
  m.setTiming(a.id, { appear: "click" });
  assert.equal(m.setTiming(b.id, { appear: "click", step: 1 }).ok, true);
  assert.equal(timingOf(m, b).step, 1);
  for (const bad of [0, -1, 1.5, 201]) assert.equal(m.setTiming(a.id, { step: bad }).ok, false, String(bad));
  assert.equal(timingOf(m, a).step, 1);
  assert.equal(m.setTiming(a.id, { step: 200 }).ok, true);
});

test("a delay and a time to stay count from the press, and go in the words", () => {
  const { m, a } = three();
  const r = m.setTiming(a.id, { appear: "click", step: 2, start: 1500, visibleFor: 4000 });
  assert.equal(r.message, "First: Appears 1.5 seconds after the learner shows item 2, then disappears 4 seconds later");
  assert.equal(describeTiming({ appear: "click", step: 3, start: 0, visibleFor: null }), "Appears when the learner shows item 3, then stays");
});

test("going back to a time takes the item number away, so the object is valid again", () => {
  const { m, a } = three();
  m.setTiming(a.id, { appear: "click", step: 4 });
  m.setTiming(a.id, { appear: "time" });
  assert.deepEqual(timingOf(m, a), { appear: "time", start: 0, visibleFor: null });
});

test("one Undo takes a click back to what it was", () => {
  const { m, a } = three();
  m.setTiming(a.id, { appear: "click" });
  m.undo();
  assert.deepEqual(timingOf(m, a), { appear: "time", start: 0, visibleFor: null });
});

test("several objects set to wait for the learner at once get items in order", () => {
  const { m, a, b, c } = three();
  m.selectObject(a.id);
  m.toggleSelected(b.id);
  m.toggleSelected(c.id);
  assert.equal(m.setTimingForSelected({ appear: "click" }).ok, true);
  assert.deepEqual([a, b, c].map((o) => timingOf(m, o).step), [1, 2, 3]);
});

test("the timeline draws an object that waits for a click at its delay, and says it is a guess, because the learner decides when", () => {
  const { m, a } = three();
  m.setTiming(a.id, { appear: "click", step: 2, start: 2000 });
  const view = buildTimeline(m.timingRows(), null, () => null);
  const bar = view.bars.find((x) => x.id === a.id)!;
  assert.equal(bar.approximate, true);
  assert.equal(bar.from, 2000);
  assert.equal(startText(bar.timing, true), "2 seconds after the learner shows item 2");
});

test("the real validator accepts what the editor writes, and a click on a slide that moves on by itself is a warning", () => {
  const { m, a, b } = three();
  m.setTiming(a.id, { appear: "click" });
  m.setTiming(b.id, { appear: "click" });
  const dir = mkdtempSync(path.join(os.tmpdir(), "os-click-"));
  try {
    const write = (files: { path: string; text: string }[]) => {
      for (const f of files) {
        mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true });
        writeFileSync(path.join(dir, f.path), f.text);
      }
    };
    write(m.allFiles());
    const run = () => spawnSync("python", [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    const ok = run();
    const found = JSON.parse(ok.stdout || "[]") as { rule: string; severity: string }[];
    assert.deepEqual(found.filter((f) => f.severity === "error" && f.rule !== "contrast"), [], ok.stdout.slice(0, 600));
    m.setSlideDuration(8000);
    write(m.allFiles());
    const warned = JSON.parse(run().stdout || "[]") as { rule: string; severity: string }[];
    assert.ok(warned.some((f) => f.rule === "timing-click-advance" && f.severity === "warning"), JSON.stringify(warned).slice(0, 600));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
