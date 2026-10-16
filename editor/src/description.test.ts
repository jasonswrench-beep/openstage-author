// Audio description in the editor: adding, changing and deleting a video's descriptions, and giving them a voice.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { DescriptionCue, OSObject } from "../../player/src/types.ts";
import { clockText, DESCRIPTION_LIMIT, Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-13" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

function withVideo(): { m: Model; v: OSObject } {
  const m = fresh();
  const v = m.addMedia("video", "assets/video/welcome.mp4")!;
  m.setMediaCaptions(v.id, "assets/captions/welcome.vtt");
  return { m, v };
}

const cuesOf = (m: Model, v: OSObject): DescriptionCue[] => m.descriptionOf(v.id);
const contentOf = (m: Model, v: OSObject) => m.object && m.slide!.baseLayer.objects.find((o) => o.id === v.id)!.content as { description?: { cues: DescriptionCue[] } };

test("a description starts empty, at the start, and holds the video: the author writes the words", () => {
  const { m, v } = withVideo();
  assert.deepEqual(cuesOf(m, v), []);
  assert.equal("description" in contentOf(m, v)!, false, "no descriptions means no description field at all");
  const msg = m.addDescription(v.id)!;
  assert.match(msg, /^Added a description at 0:00\. Write what the picture shows/);
  const [cue] = cuesOf(m, v);
  assert.deepEqual({ ...cue, id: "x" }, { id: "x", time: 0, text: "", pause: true, narration: null }, "never filled in for the author");
});

test("each new description comes five seconds after the last, and has an id no other on the video has", () => {
  const { m, v } = withVideo();
  m.addDescription(v.id);
  m.addDescription(v.id);
  m.addDescription(v.id);
  assert.deepEqual(cuesOf(m, v).map((c) => [c.id, c.time]), [["ad-1", 0], ["ad-2", 5000], ["ad-3", 10000]]);
  m.deleteDescription(v.id, "ad-2");
  m.addDescription(v.id);
  assert.deepEqual(cuesOf(m, v).map((c) => c.id), ["ad-1", "ad-3", "ad-4"], "an id is not reused while a later one exists");
});

test("descriptions are kept in the order they happen, whichever is changed", () => {
  const { m, v } = withVideo();
  m.addDescription(v.id);
  m.addDescription(v.id);
  m.updateDescription(v.id, "ad-1", { time: 20000 });
  assert.deepEqual(cuesOf(m, v).map((c) => c.id), ["ad-2", "ad-1"]);
  assert.deepEqual(contentOf(m, v)!.description!.cues.map((c) => c.id), ["ad-2", "ad-1"], "and saved that way");
});

test("the words, the time and whether the video waits can each be changed, and a bad value is refused with a reason", () => {
  const { m, v } = withVideo();
  m.addDescription(v.id);
  assert.deepEqual(m.updateDescription(v.id, "ad-1", { text: "A woman opens a laptop." }), { ok: true, message: "Description at 0:00 updated" });
  assert.equal(cuesOf(m, v)[0]!.text, "A woman opens a laptop.");
  assert.deepEqual(m.updateDescription(v.id, "ad-1", { pause: false }), { ok: true, message: "The video will keep playing while this is spoken" });
  assert.equal(m.updateDescription(v.id, "ad-1", { pause: true }).message, "The video will wait while this is spoken");
  assert.deepEqual(m.updateDescription(v.id, "ad-1", { time: 4500 }), { ok: true, message: "Description at 0:04 updated" });
  for (const bad of [-1, 1.5, 90_000_000, Number.NaN]) {
    const r = m.updateDescription(v.id, "ad-1", { time: bad });
    assert.equal(r.ok, false, String(bad));
    assert.match(r.message, /0 to 24 hours/);
  }
  assert.match(m.updateDescription(v.id, "ad-1", { text: "x".repeat(2001) }).message, /2000 letters/);
  assert.equal(cuesOf(m, v)[0]!.time, 4500, "refused changes change nothing");
  assert.deepEqual(m.updateDescription(v.id, "ad-1", { text: "A woman opens a laptop." }), { ok: true, message: "" }, "no change says nothing");
  assert.deepEqual(m.updateDescription(v.id, "ad-nope", { pause: false }), { ok: false, message: "" });
});

test("typing a description is one undo step, and deleting the last one takes the description away", () => {
  const { m, v } = withVideo();
  m.addDescription(v.id);
  const undoable = () => (m.canUndo ? 1 : 0);
  m.updateDescription(v.id, "ad-1", { text: "A" });
  m.updateDescription(v.id, "ad-1", { text: "A wo" });
  m.updateDescription(v.id, "ad-1", { text: "A woman" });
  m.undo();
  assert.equal(cuesOf(m, v)[0]!.text, "", "the whole run of typing was one step");
  m.redo();
  assert.equal(cuesOf(m, v)[0]!.text, "A woman");
  assert.match(m.deleteDescription(v.id, "ad-1")!, /^Deleted the description at 0:00/);
  assert.equal("description" in contentOf(m, v)!, false);
  m.undo();
  assert.equal(cuesOf(m, v).length, 1, "undo brings it back");
  assert.equal(undoable(), 1);
});

test("only a video can have descriptions, and no more than the limit", () => {
  const m = fresh();
  const clip = m.addMedia("audio", "assets/audio/clip.mp3")!;
  assert.equal(m.addDescription(clip.id), null);
  const t = m.addObject("text")!;
  assert.equal(m.addDescription(t.id), null);
  const { m: m2, v } = withVideo();
  for (let i = 0; i < DESCRIPTION_LIMIT; i++) m2.addDescription(v.id);
  assert.equal(cuesOf(m2, v).length, DESCRIPTION_LIMIT);
  assert.match(m2.addDescription(v.id)!, /up to 60 descriptions/);
  assert.equal(cuesOf(m2, v).length, DESCRIPTION_LIMIT);
});

test("a description is spoken by giving it a voice that says its words, and not before it has any", () => {
  const { m, v } = withVideo();
  m.addDescription(v.id);
  assert.match(m.narrateDescriptionFromText(v.id, "ad-1")!, /Write the description first/);
  m.updateDescription(v.id, "ad-1", { text: "  A woman opens a laptop.  " });
  assert.match(m.narrateDescriptionFromText(v.id, "ad-1")!, /Added narration to/);
  const n = cuesOf(m, v)[0]!.narration as { script: string; voice: string; audioCache: unknown };
  assert.equal(n.script, "A woman opens a laptop.");
  assert.equal(n.audioCache, null);
  // the words are the voice's own now
  m.updateDescription(v.id, "ad-1", { text: "A man closes a laptop." });
  assert.equal((cuesOf(m, v)[0]!.narration as { script: string }).script, "A woman opens a laptop.");
  assert.equal(m.narrateDescriptionFromText(v.id, "ad-1"), "Narration updated", "asking again brings them back in line");
});

test("the usual narration controls work on a description through its key", () => {
  const { m, v } = withVideo();
  m.addDescription(v.id);
  m.updateDescription(v.id, "ad-1", { text: "A woman opens a laptop." });
  const key = `${v.id}/ad-1`;
  m.setNarrationScript(key, "Someone opens a laptop.");
  assert.equal((cuesOf(m, v)[0]!.narration as { script: string }).script, "Someone opens a laptop.");
  assert.match(m.setNarrationVoice(key, "am_adam")!, /Voice changed/);
  assert.deepEqual(m.setNarrationSpeed(key, 0.9), { ok: true, message: "Speed 0.9" });
  const n = cuesOf(m, v)[0]!.narration as { voice: string; speed: number; lang: string };
  assert.deepEqual([n.voice, n.speed, n.lang], ["am_adam", 0.9, "en-US"]);
  assert.match(m.setNarrationScript(key, "   ")!, /^Removed the narration from .*audio description at 0:00/);
  assert.equal(cuesOf(m, v)[0]!.narration, null);
  assert.equal(m.setNarrationScript(`${v.id}/ad-nope`, "x"), null, "a description that is not there");
});

test("the Narration list names a description by its video and its time, after the video's own narration", () => {
  const { m, v } = withVideo();
  m.setNarrationScript(v.id, "Welcome to the course.");
  m.addDescription(v.id);
  m.addDescription(v.id);
  m.updateDescription(v.id, "ad-1", { text: "She waves." });
  m.updateDescription(v.id, "ad-2", { text: "She sits down." });
  m.narrateDescriptionFromText(v.id, "ad-2");
  m.narrateDescriptionFromText(v.id, "ad-1");
  const listed = m.narratedObjects().filter((n) => n.object.id === v.id);
  assert.deepEqual(listed.map((n) => n.key), [v.id, `${v.id}/ad-1`, `${v.id}/ad-2`]);
  assert.deepEqual(listed.map((n) => n.cue?.time ?? null), [null, 0, 5000]);
  assert.deepEqual(listed.map((n) => n.item), [null, null, null]);
});

test("what a recording shows on its screen becomes audio descriptions with a voice, in one undo step, and never twice", () => {
  const { m, v } = withVideo();
  const items = [{ atMs: 4000, text: "  On screen:   Click Save " }, { atMs: 1500, text: "The picture zooms in: the toolbar" }, { atMs: 2000, text: "   " }];
  const r = m.describeScreen(v.id, items);
  assert.equal(r.added, 2, "the one with no words is left out");
  assert.match(r.message, /^Added 2 descriptions from what is on the screen, each with a voice that says its words\./);
  assert.match(r.message, /If your own voice already says one of them, delete it\./);
  const cues = cuesOf(m, v);
  assert.deepEqual(cues.map((c) => [c.time, c.text, c.pause]), [[1500, "The picture zooms in: the toolbar", true], [4000, "On screen: Click Save", true]], "in the order they happen, with the words squeezed");
  assert.deepEqual(cues.map((c) => (c.narration as { script: string } | null)?.script), ["The picture zooms in: the toolbar", "On screen: Click Save"], "each has a voice that says its words");
  assert.equal(new Set(cues.map((c) => c.id)).size, 2, "ids are their own");
  assert.equal(m.describeScreen(v.id, items).added, 0, "pressing it again adds nothing");
  assert.equal(m.describeScreen(v.id, items).message, "Everything on the screen is already described.");
  assert.equal(cuesOf(m, v).length, 2);
  m.undo();
  assert.equal(cuesOf(m, v).length, 0, "one undo takes all of them away");
});

test("describing the screen keeps the author's own descriptions, says when there is nothing, and stops at the limit", () => {
  const { m, v } = withVideo();
  m.addDescription(v.id);
  m.updateDescription(v.id, "ad-1", { text: "A woman opens a laptop." });
  assert.equal(m.describeScreen(v.id, [{ atMs: 1000, text: "On screen: Title" }]).added, 1);
  assert.deepEqual(cuesOf(m, v).map((c) => c.text), ["A woman opens a laptop.", "On screen: Title"]);
  assert.equal(cuesOf(m, v)[0]!.narration, null, "the author's description is not given a voice behind their back");
  assert.match(m.describeScreen(v.id, []).message, /Nothing on the screen needs describing/);
  const many = Array.from({ length: DESCRIPTION_LIMIT + 5 }, (_x, i) => ({ atMs: 10_000 + i, text: `Item ${i}` }));
  const r = m.describeScreen(v.id, many);
  assert.equal(cuesOf(m, v).length, DESCRIPTION_LIMIT);
  assert.equal(r.added, DESCRIPTION_LIMIT - 2);
  assert.match(r.message, /7 more did not fit/);
  assert.match(m.describeScreen(v.id, [{ atMs: 99, text: "More" }]).message, /up to 60 descriptions/);
});

test("giving every description a voice leaves ones that have a voice, or no words, alone, in one undo step", () => {
  const { m, v } = withVideo();
  for (let i = 0; i < 4; i++) m.addDescription(v.id);
  m.updateDescription(v.id, "ad-1", { text: "One." });
  m.updateDescription(v.id, "ad-2", { text: "Two." });
  m.updateDescription(v.id, "ad-3", { text: "Three." });
  m.setNarrationScript(`${v.id}/ad-1`, "My own words for one.");
  const r = m.narrateDescriptionsFromText(v.id);
  assert.equal(r.added, 2);
  assert.match(r.message, /^Gave 2 descriptions a voice/);
  const by = Object.fromEntries(cuesOf(m, v).map((c) => [c.id, (c.narration as { script: string } | null)?.script ?? null]));
  assert.deepEqual(by, { "ad-1": "My own words for one.", "ad-2": "Two.", "ad-3": "Three.", "ad-4": null });
  m.undo();
  assert.deepEqual(cuesOf(m, v).map((c) => c.narration === null), [false, true, true, true]);
  assert.match(m.narrateDescriptionsFromText(v.id).message, /./);
});

test("descriptions and their voices travel with a copy of the video", () => {
  const { m, v } = withVideo();
  m.addDescription(v.id);
  m.updateDescription(v.id, "ad-1", { text: "She waves." });
  m.narrateDescriptionFromText(v.id, "ad-1");
  m.selectObject(v.id);
  m.duplicate();
  const copy = m.object!;
  assert.notEqual(copy.id, v.id);
  const copied = (copy.content as { description: { cues: DescriptionCue[] } }).description.cues;
  assert.deepEqual(copied.map((c) => [c.id, c.text]), [["ad-1", "She waves."]]);
  assert.ok(copied[0]!.narration, "the voice is copied");
  copied[0]!.text = "changed";
  assert.equal(cuesOf(m, v)[0]!.text, "She waves.", "and is the copy's own");
});

test("clock text reads as minutes and seconds", () => {
  assert.deepEqual([0, 4500, 65_000, 600_000].map(clockText), ["0:00", "0:04", "1:05", "10:00"]);
});

// ---- the real validator

type Finding = { severity: string; rule: string; message: string };

function validate(m: Model): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-ad-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout) as Finding[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the real validator asks for the words, then the voice, then is content", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const { m, v } = withVideo();
  m.setAccessibility(v.id, { altText: "Welcome from the instructor" });
  m.addDescription(v.id);
  const about = (rule: string) => validate(m).filter((f) => f.rule === rule);
  assert.equal(about("description-text-missing").length, 1, "an empty description is an error");
  m.updateDescription(v.id, "ad-1", { text: "A woman opens a laptop." });
  assert.equal(about("description-text-missing").length, 0);
  assert.equal(about("description-not-voiced").length, 1, "written only is a warning");
  m.narrateDescriptionFromText(v.id, "ad-1");
  assert.equal(about("description-not-voiced").length, 0);
  assert.deepEqual(validate(m).filter((f) => f.rule.startsWith("description-") || f.rule === "voice-unknown" || f.rule === "ipa-invalid"), []);
  assert.equal(validate(m).filter((f) => f.severity === "error" && !f.rule.startsWith("asset")).length, 0, "and nothing else is wrong");
});
