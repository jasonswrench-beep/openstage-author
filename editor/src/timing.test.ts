// Tests for timing in the editor: what an author types, what it says in words, and the changes the model allows.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Model } from "./model.ts";
import { describeTiming, isStartingTiming, MAX_MS, parseSeconds, plainSeconds, secondsText, STARTING_TIMING } from "./timing.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-12" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

test("what an author types in a seconds box becomes whole milliseconds, or is refused", () => {
  assert.equal(parseSeconds("2"), 2000);
  assert.equal(parseSeconds(" 2.5 "), 2500);
  assert.equal(parseSeconds("0.25"), 250);
  assert.equal(parseSeconds("0.001"), 1);
  assert.equal(parseSeconds("0"), 0);
  assert.equal(parseSeconds("3600"), MAX_MS);
  assert.equal(parseSeconds(""), null, "blank is nothing set");
  assert.equal(parseSeconds("   "), null);
  for (const bad of ["3600.001", "3601", "-1", "1.2345", "abc", "2s", "1,5", "1e3", ".5", "5.", "0x10", "Infinity", "NaN"]) assert.equal(parseSeconds(bad), undefined, bad);
});

test("milliseconds come back as the seconds an author would type", () => {
  assert.equal(secondsText(2500), "2.5");
  assert.equal(secondsText(3000), "3");
  assert.equal(secondsText(0), "0");
  assert.equal(secondsText(1), "0.001");
  for (const ms of [0, 1, 250, 1000, 2500, 59999, MAX_MS]) assert.equal(parseSeconds(secondsText(ms)), ms, `${ms} survives the round trip`);
  assert.equal(plainSeconds(1000), "1 second");
  assert.equal(plainSeconds(2500), "2.5 seconds");
  assert.equal(plainSeconds(0), "0 seconds");
});

test("a timing says what it does in plain words", () => {
  assert.equal(describeTiming(STARTING_TIMING), "Always there");
  assert.equal(describeTiming({ appear: "time", start: 2500, visibleFor: null }), "Appears 2.5 seconds after the slide opens, then stays");
  assert.equal(describeTiming({ appear: "time", start: 1000, visibleFor: 6000 }), "Appears 1 second after the slide opens, then disappears 6 seconds later");
  assert.equal(describeTiming({ appear: "time", start: 0, visibleFor: 4000 }), "Shows when the slide opens, then disappears 4 seconds later");
  assert.equal(describeTiming({ appear: "narration", start: 0, visibleFor: null }), "Appears when its narration starts, then stays");
  assert.equal(describeTiming({ appear: "narration", start: 1500, visibleFor: 5000 }), "Appears 1.5 seconds after its narration starts, then disappears 5 seconds later");
  assert.equal(describeTiming({ appear: "time", start: 2000, visibleFor: null }, true), "Appears 2 seconds after its layer is shown, then stays");
  assert.equal(describeTiming({ appear: "time", start: 0, visibleFor: 3000 }, true), "Shows when its layer is shown, then disappears 3 seconds later");
  assert.equal(isStartingTiming(STARTING_TIMING), true);
  assert.equal(isStartingTiming({ appear: "narration", start: 0, visibleFor: null }), false);
});

test("a new object is always there, and a new slide waits for the learner", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  assert.deepEqual(t.timing, STARTING_TIMING);
  assert.notEqual(t.timing, STARTING_TIMING, "each object has its own copy, not the shared one");
  assert.equal(m.slide!.duration, null);
});

test("a delay and a time to leave are set, and say what they did", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  assert.deepEqual(m.setTiming(t.id, { start: 2500 }), { ok: true, message: `${t.name}: Appears 2.5 seconds after the slide opens, then stays` });
  assert.deepEqual(m.setTiming(t.id, { visibleFor: 6000 }), { ok: true, message: `${t.name}: Appears 2.5 seconds after the slide opens, then disappears 6 seconds later` });
  assert.deepEqual(t.timing, { appear: "time", start: 2500, visibleFor: 6000 });
  assert.deepEqual(m.setTiming(t.id, { visibleFor: null }), { ok: true, message: `${t.name}: Appears 2.5 seconds after the slide opens, then stays` });
  assert.deepEqual(m.setTiming(t.id, { visibleFor: null }), { ok: true, message: "" }, "no change says nothing");
});

test("times that are not times are refused and nothing changes", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  for (const bad of [{ start: -1 }, { start: 1.5 }, { start: MAX_MS + 1 }, { start: Number.NaN }, { visibleFor: 0 }, { visibleFor: -5 }, { visibleFor: 2.5 }, { visibleFor: MAX_MS + 1 }, { appear: "later" as never }]) {
    const r = m.setTiming(t.id, bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(r.message.length > 10, "and says why");
  }
  assert.deepEqual(t.timing, STARTING_TIMING);
  assert.deepEqual(m.setTiming("obj-9999", { start: 1 }), { ok: false, message: "" });
});

test("an object can only follow its narration if it has some", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  const refused = m.setTiming(t.id, { appear: "narration" });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /Write this object's narration first/);
  assert.equal(t.timing.appear, "time");
  m.setNarrationScript(t.id, "Something to say.");
  assert.deepEqual(m.setTiming(t.id, { appear: "narration", start: 500 }), { ok: true, message: `${t.name}: Appears 0.5 seconds after its narration starts, then stays` });
});

test("typing in a timing box is one undo step, and undo puts the old timing back", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  m.setTiming(t.id, { start: 1000 });
  m.setTiming(t.id, { start: 1500 });
  m.setTiming(t.id, { start: 2000 });
  m.setTiming(t.id, { visibleFor: 4000 });
  assert.equal(m.undo(), true);
  assert.equal(m.object!.timing.visibleFor, null, "the time to leave is taken back first (undo makes new copies, so look at the selected object, not the old one)");
  assert.equal(m.undo(), true);
  assert.deepEqual(m.object!.timing, STARTING_TIMING, "and the three edits of the start undo together");
  assert.equal(m.redo(), true);
  assert.equal(m.object!.timing.start, 2000);
});

test("the timing list has every object on the slide, base layer first, each layer in reading order", () => {
  const m = fresh();
  const a = m.addObject("text")!;
  const layer = m.addLayer()!;
  const b = m.addObject("button")!;
  const rows = m.timingRows();
  const ids = rows.map((r) => r.object.id);
  assert.ok(ids.indexOf(a.id) < ids.indexOf(b.id), "the base layer comes first");
  assert.deepEqual(rows.find((r) => r.object.id === b.id), { object: b, layerId: layer.id, layerName: layer.name, onBase: false });
  assert.equal(rows.find((r) => r.object.id === a.id)!.onBase, true);
  m.selectLayer(m.slide!.baseLayer.id);
  assert.ok(m.setTiming(b.id, { start: 1000 }).ok, "an object on another layer can be timed whichever layer is being edited");
  assert.equal(b.timing.start, 1000);
  assert.match(m.setTiming(b.id, { start: 2000 }).message, /after its layer is shown/);
});

test("a slide moves on by itself after a time, or waits", () => {
  const m = fresh();
  assert.deepEqual(m.setSlideDuration(8000), { ok: true, message: "This slide moves on by itself after 8 seconds." });
  assert.equal(m.slide!.duration, 8000);
  assert.deepEqual(m.setSlideDuration(8000), { ok: true, message: "" });
  assert.deepEqual(m.setSlideDuration(null), { ok: true, message: "This slide waits for the learner." });
  assert.equal(m.slide!.duration, null);
  for (const bad of [0, -1, 2.5, MAX_MS + 1, Number.NaN]) assert.equal(m.setSlideDuration(bad).ok, false, String(bad));
  assert.equal(m.slide!.duration, null);
});

test("a slide that moves on by itself is undone with one undo, and a question on it is mentioned", () => {
  const m = fresh();
  m.setSlideDuration(5000);
  m.undo();
  assert.equal(m.slide!.duration, null);
  m.addQuiz("mc");
  assert.match(m.setSlideDuration(5000).message, /It has a question, and a learner could be moved past it\.$/);
});

test("timing is saved in the slide file and survives a reopen", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  m.setTiming(t.id, { start: 2500, visibleFor: 6000 });
  m.setSlideDuration(9000);
  const slide = JSON.parse(m.allFiles().find((f) => f.path === "slides/slide-001.json")!.text) as { duration: number; baseLayer: { objects: { id: string; timing: unknown }[] } };
  assert.equal(slide.duration, 9000);
  assert.deepEqual(slide.baseLayer.objects.find((o) => o.id === t.id)!.timing, { appear: "time", start: 2500, visibleFor: 6000 });
});

// ---- the real validator

type Finding = { severity: string; rule: string; message: string };

function validate(m: Model): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-tm-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the real validator accepts what the editor writes and warns about the risky cases", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  const t = m.addObject("text")!;
  m.setAccessibility(t.id, { altText: "Words" });
  m.setTiming(t.id, { start: 2500, visibleFor: 30000 });
  m.setSlideDuration(8000);
  const rules = (f: Finding[]) => f.filter((x) => x.rule.startsWith("timing") || x.rule.startsWith("slide-advances")).map((x) => `${x.severity} ${x.rule}`);
  assert.deepEqual(m.setTiming(t.id, { start: 9000 }).ok, true);
  assert.deepEqual(rules(validate(m)), ["warning timing-after-advance"], "appearing after the slide has moved on");
  m.setTiming(t.id, { start: 1000, visibleFor: 1000 });
  m.setNarrationScript(t.id, "Hello.");
  m.setTiming(t.id, { appear: "narration", start: 0 });
  m.setNarrationScript(t.id, "");
  assert.deepEqual(rules(validate(m)).filter((r) => r.includes("narration-missing")), ["error timing-narration-missing"], "narration removed after the timing was set is caught");
  assert.equal(validate(m).filter((x) => x.severity === "error" && x.rule !== "timing-narration-missing").length, 0);
});
