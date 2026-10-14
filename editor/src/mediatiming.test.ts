// Timing that follows a video or an audio clip, in the editor: choosing the clip, the words for it, the timeline's own axis for it, what happens
// when the clip is deleted or copied away, and the real validator.
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
import { axisFor, buildTimeline, endText, startText } from "./timelinemodel.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-13" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

/** A slide with a video, an audio clip and a note to time. */
function withClips(): { m: Model; video: OSObject; audio: OSObject; note: OSObject } {
  const m = fresh();
  const video = m.addMedia("video", "assets/video/welcome.mp4")!;
  m.setName(video.id, "Welcome video");
  const audio = m.addMedia("audio", "assets/audio/theme.mp3")!;
  m.setName(audio.id, "Theme tune");
  const note = m.addObject("text")!;
  m.setName(note.id, "Note");
  return { m, video, audio, note };
}

test("the clips on a slide are listed in reading order, with their names and kinds", () => {
  const { m, video, audio } = withClips();
  assert.deepEqual(m.mediaSources(), [{ id: video.id, name: "Welcome video", type: "video" }, { id: audio.id, name: "Theme tune", type: "audio" }]);
  assert.equal(m.mediaNameOf(video.id), "Welcome video");
  assert.equal(m.mediaNameOf("obj-nowhere"), undefined);
  assert.deepEqual(fresh().mediaSources(), []);
});

test("an object is set to follow a clip, and chooses the first one when none is named", () => {
  const { m, video, note } = withClips();
  const r = m.setTiming(note.id, { appear: "media", start: 12_000 });
  assert.equal(r.ok, true);
  assert.deepEqual(m.timingRows().find((x) => x.object.id === note.id)!.object.timing, { appear: "media", media: video.id, start: 12_000, visibleFor: null });
  assert.equal(r.message, "Note: Appears 12 seconds into Welcome video, then stays");
});

test("it can follow an audio clip, and be moved from one clip to another", () => {
  const { m, video, audio, note } = withClips();
  m.setTiming(note.id, { appear: "media", media: audio.id, start: 2000, visibleFor: 4000 });
  assert.equal(note.timing.media, audio.id);
  assert.match(m.setTiming(note.id, { media: video.id }).message, /Welcome video/);
  assert.equal(note.timing.media, video.id);
  assert.equal(note.timing.start, 2000, "the times stay");
});

test("it cannot follow something that is not a clip on the slide, or itself", () => {
  const { m, video, note } = withClips();
  assert.equal(m.setTiming(note.id, { appear: "media", media: note.id }).ok, false, "a text box is not a clip");
  assert.equal(m.setTiming(note.id, { appear: "media", media: "obj-nowhere" }).ok, false);
  assert.equal(note.timing.appear, "time", "nothing changed");
  assert.equal(m.setTiming(video.id, { appear: "media", media: video.id }).ok, false, "a clip does not follow itself");
});

test("with no clip on the slide there is nothing to follow, and the editor says to add one", () => {
  const m = fresh();
  const note = m.addObject("text")!;
  const r = m.setTiming(note.id, { appear: "media" });
  assert.equal(r.ok, false);
  assert.match(r.message, /Add a video or audio file/);
});

test("going back to a time on the clock takes the clip away, so the file stays valid", () => {
  const { m, note } = withClips();
  m.setTiming(note.id, { appear: "media", start: 5000 });
  m.setTiming(note.id, { appear: "time" });
  assert.deepEqual(note.timing, { appear: "time", start: 5000, visibleFor: null });
  assert.equal("media" in note.timing, false);
});

test("choosing a clip is one step for Undo", () => {
  const { m, note } = withClips();
  m.setTiming(note.id, { appear: "media", start: 5000 });
  m.undo();
  // Undo puts back a copy of the object, so look it up again.
  assert.deepEqual(m.timingRows().find((r) => r.object.id === note.id)!.object.timing, { appear: "time", start: 0, visibleFor: null });
});

test("the time and the stay are checked like any other time", () => {
  const { m, note } = withClips();
  m.setTiming(note.id, { appear: "media" });
  assert.equal(m.setTiming(note.id, { start: -1 }).ok, false);
  assert.equal(m.setTiming(note.id, { start: 3_600_001 }).ok, false);
  assert.equal(m.setTiming(note.id, { visibleFor: 0 }).ok, false);
  assert.equal(m.setTiming(note.id, { start: 90_000, visibleFor: 5000 }).ok, true);
});

test("an object following a clip on a layer is the same", () => {
  const { m, video } = withClips();
  m.addLayer();
  const extra = m.addObject("text")!;
  assert.equal(m.setTiming(extra.id, { appear: "media", start: 1000 }).ok, true);
  assert.equal(extra.timing.media, video.id, "a clip on the base layer can be followed from a layer");
});

// ---- the words

test("the words say how far into which clip, in the clip's own name", () => {
  assert.equal(describeTiming({ appear: "media", media: "v", start: 0, visibleFor: null }, false, "Welcome video"), "Shows from the start of Welcome video, then stays");
  assert.equal(describeTiming({ appear: "media", media: "v", start: 2500, visibleFor: 4000 }, false, "Welcome video"), "Appears 2.5 seconds into Welcome video, then disappears 4 seconds later");
  assert.equal(describeTiming({ appear: "media", media: "v", start: 1000, visibleFor: null }), "Appears 1 second into its video or audio, then stays", "even if its name cannot be found");
  assert.equal(startText({ appear: "media", media: "v", start: 1000, visibleFor: null }, true, "Welcome video"), "1 second into Welcome video");
  assert.equal(endText({ appear: "media", media: "v", start: 1000, visibleFor: null }), "stays until the end of the clip");
  assert.equal(endText({ appear: "time", start: 1000, visibleFor: null }), "stays until the slide ends");
});

// ---- the timeline

test("the timeline gives objects that follow a clip an axis of their own, and the slide's axis ignores them", () => {
  const { m, video, note } = withClips();
  const plain = m.addObject("text")!;
  m.setTiming(plain.id, { start: 4000 });
  const noClips = buildTimeline(m.timingRows(), null, () => null);
  m.setTiming(note.id, { appear: "media", start: 95_000, visibleFor: 20_000 });
  const view = buildTimeline(m.timingRows(), null, () => null);
  assert.equal(view.horizon, noClips.horizon, "a note at a minute and a half into a clip does not stretch the slide's axis");
  assert.equal(view.clips.length, 1);
  const group = view.clips[0]!;
  assert.equal(group.mediaId, video.id);
  assert.equal(group.name, "Welcome video");
  assert.deepEqual(group.bars.map((b) => b.id), [note.id]);
  assert.ok(group.horizon >= 115_000, "the clip's own axis reaches the end of the note");
  assert.equal(group.bars[0]!.from, 95_000);
  assert.equal(group.bars[0]!.to, 115_000);
  assert.equal(group.bars[0]!.clipName, "Welcome video");
  assert.equal(group.bars[0]!.narration, null, "the slide's narration is not drawn on the clip's axis");
  assert.ok(view.bars.some((b) => b.id === note.id), "it is still one of the slide's objects");
});

test("two clips make two groups, and a clip nobody follows makes none", () => {
  const { m, video, audio, note } = withClips();
  const other = m.addObject("text")!;
  m.setTiming(note.id, { appear: "media", media: video.id, start: 1000 });
  m.setTiming(other.id, { appear: "media", media: audio.id, start: 1000 });
  const view = buildTimeline(m.timingRows(), null, () => null);
  assert.deepEqual(view.clips.map((g) => g.name).sort(), ["Theme tune", "Welcome video"]);
  const none = buildTimeline(withClips().m.timingRows(), null, () => null);
  assert.deepEqual(none.clips, []);
});

test("an object's narration still takes its turn in the slide's order, even when the object follows a clip", () => {
  const { m, video, note } = withClips();
  m.setNarrationScript(note.id, "A word.");
  const later = m.addObject("text")!;
  m.setNarrationScript(later.id, "Another.");
  m.setTiming(note.id, { appear: "media", media: video.id, start: 1000 });
  const view = buildTimeline(m.timingRows(), null, (o) => (o.id === note.id ? 3000 : 2000));
  const laterBar = view.bars.find((b) => b.id === later.id)!;
  assert.equal(laterBar.narration!.start, 3000, "the first narration is still ahead of it in reading order");
});

test("the axis for any length is the friendly one the slide uses", () => {
  const a = axisFor(0);
  assert.equal(a.horizon, 10_000);
  assert.ok(a.ticks.length > 2);
  assert.ok(axisFor(300_000).horizon >= 300_000);
});

// ---- deleting and copying

test("deleting a clip that objects follow says so, and the Problems list names them", () => {
  const { m, video, note } = withClips();
  m.setTiming(note.id, { appear: "media", start: 1000 });
  m.selectObject(video.id);
  const msg = m.deleteObject(video.id)!;
  assert.match(msg, /1 object followed it/);
  assert.equal(m.followersOf(video.id).length, 1, "the reference is left for the checker to find");
});

test("copying a slide keeps each copy following the clip that was copied with it", () => {
  const { m, video, note } = withClips();
  m.setTiming(note.id, { appear: "media", start: 7000, visibleFor: 3000 });
  m.duplicateSlide();
  const copy = m.slides[1]!.baseLayer.objects;
  const copiedVideo = copy.find((o) => o.type === "video")!;
  const copiedNote = copy.find((o) => o.name.startsWith("Note"))!;
  assert.notEqual(copiedVideo.id, video.id);
  assert.equal(copiedNote.timing.media, copiedVideo.id, "it follows its own slide's clip, not the original's");
  assert.equal(copiedNote.timing.start, 7000);
  assert.equal(note.timing.media, video.id, "the original is untouched");
});

test("a follower copied to a slide without the clip goes back to appearing when the slide opens, and says so", () => {
  const { m, note } = withClips();
  m.setTiming(note.id, { appear: "media", start: 7000 });
  m.selectObject(note.id);
  m.copy();
  m.addSlide("blank");
  const msg = m.paste()!;
  assert.match(msg, /did not come too/);
  const pasted = m.objects.find((o) => o.name.startsWith("Note"))!;
  assert.deepEqual(pasted.timing, { appear: "time", start: 0, visibleFor: null });
});

test("a follower pasted back onto the slide with its clip keeps following it", () => {
  const { m, video, note } = withClips();
  m.setTiming(note.id, { appear: "media", start: 7000 });
  m.selectObject(note.id);
  m.copy();
  m.paste();
  const copies = m.objects.filter((o) => o.name.startsWith("Note"));
  assert.equal(copies.length, 2);
  assert.ok(copies.every((o) => o.timing.media === video.id));
});

// ---- the real validator

type Finding = { severity: string; rule: string; message: string };

function validate(m: Model): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-mtime-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    mkdirSync(path.join(dir, "assets", "video"), { recursive: true });
    writeFileSync(path.join(dir, "assets", "video", "welcome.mp4"), "x");
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a slide whose notes follow its video passes the real validator", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  const video = m.addMedia("video", "assets/video/welcome.mp4")!;
  m.setAccessibility(video.id, { altText: "Welcome from the instructor" });
  m.setMediaTranscript(video.id, "Welcome to the course.");
  const note = m.addObject("text")!;
  m.setTiming(note.id, { appear: "media", start: 4000, visibleFor: 6000 });
  const found = validate(m).filter((f) => f.rule.startsWith("timing-") || f.rule === "schema");
  assert.deepEqual(found, []);
});

test("a follower whose clip was deleted is an error the checker names", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const { m, video, note } = withClips();
  m.setTiming(note.id, { appear: "media", start: 1000 });
  m.deleteObject(video.id);
  assert.ok(validate(m).some((f) => f.rule === "timing-media-missing" && f.severity === "error"));
});
