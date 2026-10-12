// Tests for video, audio, embedded video and the record of where assets came from.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { CreditEntry, EmbedContent } from "../../player/src/types.ts";
import { parseVideoAddress } from "./content.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-10" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const embed = (m: Model) => m.object!.content as unknown as EmbedContent;

const credit = (path_: string, over: Partial<CreditEntry["source"]> = {}): CreditEntry => ({
  path: path_, title: "A view", kind: "image",
  source: { provider: "unsplash", url: "https://unsplash.com/photos/a", creator: "Jane Doe", creatorUrl: "https://unsplash.com/@jane", licence: "Unsplash Licence", requiresCredit: true, ...over },
});

// ---- reading a pasted address

test("every common form of a YouTube address is understood", () => {
  const id = "dQw4w9WgXcQ";
  for (const url of [
    `https://www.youtube.com/watch?v=${id}`, `https://youtube.com/watch?v=${id}&t=42s`, `http://m.youtube.com/watch?v=${id}`, `https://youtu.be/${id}`, `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/embed/${id}`, `https://www.youtube-nocookie.com/embed/${id}`, `https://www.youtube.com/shorts/${id}`, `youtube.com/watch?v=${id}`, `www.youtube.com/live/${id}`,
  ]) assert.deepEqual(parseVideoAddress(url), { provider: "youtube", id, hash: "" }, url);
  assert.deepEqual(parseVideoAddress(id, "youtube"), { provider: "youtube", id, hash: "" });
});

test("every common form of a Vimeo address is understood, with the key of an unlisted video", () => {
  for (const url of ["https://vimeo.com/76979871", "vimeo.com/76979871", "https://player.vimeo.com/video/76979871", "https://vimeo.com/channels/staffpicks/76979871", "https://vimeo.com/manage/videos/76979871"]) {
    assert.deepEqual(parseVideoAddress(url), { provider: "vimeo", id: "76979871", hash: "" }, url);
  }
  assert.deepEqual(parseVideoAddress("https://vimeo.com/76979871/a1b2c3d4e5"), { provider: "vimeo", id: "76979871", hash: "a1b2c3d4e5" });
  assert.deepEqual(parseVideoAddress("https://player.vimeo.com/video/76979871?h=a1b2c3d4e5"), { provider: "vimeo", id: "76979871", hash: "a1b2c3d4e5" });
  assert.deepEqual(parseVideoAddress("76979871", "vimeo"), { provider: "vimeo", id: "76979871", hash: "" });
});

test("anything that is not a YouTube or Vimeo video is refused", () => {
  for (const bad of [
    "", "   ", "hello", "javascript:alert(1)", "https://evil.example/watch?v=dQw4w9WgXcQ", "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short", "https://www.youtube.com/", "https://vimeo.com/channels/staffpicks", "https://vimeo.com/76979871abc/x", "file:///C:/x.mp4", "ftp://youtu.be/dQw4w9WgXcQ",
  ]) assert.equal(parseVideoAddress(bad), null, bad);
  assert.equal(parseVideoAddress("dQw4w9WgXcQ"), null, "a bare id needs to be told which service");
  assert.equal(parseVideoAddress("12345", "youtube"), null);
});

// ---- embeds

test("a new embed has no name, no transcript, unconfirmed captions, and a tab stop", () => {
  const m = fresh();
  const o = m.addEmbed("https://youtu.be/dQw4w9WgXcQ")!;
  assert.equal(o.type, "embed");
  assert.equal(o.accessibility.altText, "");
  assert.ok((o.accessibility.tabOrder ?? 0) >= 1);
  assert.deepEqual({ ...embed(m) }, { provider: "youtube", id: "dQw4w9WgXcQ", hash: "", transcript: "", captionsConfirmed: false });
  assert.equal(m.addEmbed("https://example.com"), null);
  assert.equal(m.addEmbed("https://vimeo.com/123", "youtube"), null, "the wrong service for the choice made");
  m.undo();
  assert.equal(m.objects.some((x) => x.type === "embed"), false);
});

test("an embed can be pointed at another video, given a transcript, and have its captions confirmed", () => {
  const m = fresh();
  const o = m.addEmbed("https://youtu.be/dQw4w9WgXcQ")!;
  assert.match(m.setEmbedAddress(o.id, "nonsense")!, /not a YouTube or Vimeo/);
  assert.match(m.setEmbedAddress(o.id, "https://vimeo.com/76979871/a1b2c3d4e5")!, /Vimeo video 76979871/);
  assert.equal(m.object!.name, "Vimeo video");
  assert.equal(embed(m).hash, "a1b2c3d4e5");
  m.setEmbedTranscript(o.id, "Hello.\n\nGoodbye & thanks");
  assert.equal(embed(m).transcript, "<p>Hello.</p><p>Goodbye &amp; thanks</p>");
  m.setEmbedCaptionsConfirmed(o.id, true);
  assert.equal(embed(m).captionsConfirmed, true);
});

// ---- video and audio files

test("a video or audio clip starts with no name, no captions and no transcript", () => {
  const m = fresh();
  const v = m.addMedia("video", "assets/video/clip.mp4")!;
  assert.equal(v.type, "video");
  assert.equal(v.content["src"], "assets/video/clip.mp4");
  assert.equal(v.content["captions"], null);
  assert.equal(v.accessibility.altText, "");
  const a = m.addMedia("audio", "assets/audio/song.mp3")!;
  assert.equal(a.type, "audio");
  assert.ok(a.geometry.height < 100, "an audio player is a thin bar");
});

test("captions and a transcript can be added to and removed from a clip", () => {
  const m = fresh();
  const v = m.addMedia("video", "assets/video/clip.mp4")!;
  assert.equal(m.setMediaCaptions(v.id, "assets/captions/clip.vtt"), "Captions added");
  assert.equal(m.setMediaCaptions(v.id, "assets/captions/clip.vtt"), null);
  assert.equal(m.object!.content["captions"], "assets/captions/clip.vtt");
  m.setMediaTranscript(v.id, "Line one.\n\nLine two.");
  assert.equal(m.object!.content["transcript"], "<p>Line one.</p><p>Line two.</p>");
  assert.equal(m.setMediaCaptions(v.id, null), "Captions removed");
  assert.equal(m.object!.content["captions"], null);
});

// ---- where assets came from

test("credit is recorded, saved to assets.json, undone, and kept apart from projects that have none", () => {
  const m = fresh();
  assert.equal(m.dirtyFiles().some((f) => f.path === "assets.json"), false, "no file until there is something to record");
  assert.equal(m.allFiles().some((f) => f.path === "assets.json"), false);
  m.setCredit(credit("assets/images/a.jpg"));
  assert.equal(m.setCredit(credit("assets/images/a.jpg")), null, "nothing changed");
  const file = m.dirtyFiles().find((f) => f.path === "assets.json")!;
  assert.deepEqual(JSON.parse(file.text).assets[0].source.creator, "Jane Doe");
  m.markSaved([file]);
  assert.equal(m.dirtyFiles().some((f) => f.path === "assets.json"), false);
  m.setCredit(credit("assets/images/a.jpg", { creator: "Someone Else" }));
  assert.equal(m.assets.length, 1, "the same asset is replaced, not added twice");
  m.undo();
  assert.equal(m.creditOf("assets/images/a.jpg"), undefined, "quick edits of one credit are one undo step, as with typing");
  m.redo();
  m.dropCredit("assets/images/a.jpg");
  assert.equal(m.assets.length, 0);
  assert.ok(m.allFiles().some((f) => f.path === "assets.json"), "a project that had the file keeps it, now empty");
});

test("a project opened with assets.json keeps its entries", () => {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-10" });
  const m = new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, assets: JSON.stringify({ assets: [credit("assets/images/a.jpg")] }), slides: [{ id: "slide-001", text: files[2]!.text }] });
  assert.equal(m.assets.length, 1);
  assert.equal(m.dirtyFiles().length, 0, "opening and saving writes nothing");
});

test("where an asset is used is found by its path, and the credits page can be switched off", () => {
  const m = fresh();
  assert.deepEqual(m.usageOf("assets/images/a.jpg"), []);
  const img = m.addObject("image", { imageSrc: "assets/images/a.jpg" })!;
  m.setName(img.id, "Skyline");
  assert.deepEqual(m.usageOf("assets/images/a.jpg"), [{ slide: "Title slide", object: "Skyline" }]);
  assert.equal(m.credits, true);
  assert.match(m.setCredits(false)!, /will not show/);
  assert.equal(m.setCredits(false), null);
  m.undo();
  assert.equal(m.credits, true);
});

// ---- the real validator

type Finding = { severity: string; rule: string; message: string };

function validate(m: Model, extraFiles: string[] = []): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-media-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    for (const rel of extraFiles) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), "x"); }
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const opts = { skip: !process.env["OPENSTAGE_PYTHON"] };
const errors = (f: Finding[]) => f.filter((x) => x.severity === "error").map((x) => x.rule);

test("an embed needs a name, confirmed captions and a transcript, and warns that it needs the internet", opts, () => {
  const m = fresh();
  const o = m.addEmbed("https://youtu.be/dQw4w9WgXcQ")!;
  assert.deepEqual(errors(validate(m)).sort(), ["alt-text-missing", "embed-captions-unconfirmed", "embed-transcript-missing"]);
  m.setAccessibility(o.id, { altText: "A talk about teaching" });
  m.setEmbedCaptionsConfirmed(o.id, true);
  m.setEmbedTranscript(o.id, "Welcome to the talk.");
  const found = validate(m);
  assert.deepEqual(errors(found), []);
  assert.ok(found.some((f) => f.rule === "embed-needs-internet" && f.severity === "warning"));
});

test("a video needs captions, and an audio clip needs captions or a transcript", opts, () => {
  const m = fresh();
  const v = m.addMedia("video", "assets/video/clip.mp4")!;
  const a = m.addMedia("audio", "assets/audio/song.mp3")!;
  m.setAccessibility(v.id, { altText: "Welcome video" });
  m.setAccessibility(a.id, { altText: "Theme music" });
  const files = ["assets/video/clip.mp4", "assets/audio/song.mp3", "assets/captions/clip.vtt"];
  assert.equal(errors(validate(m, files)).filter((r) => r === "media-needs-captions").length, 2);
  m.setMediaCaptions(v.id, "assets/captions/clip.vtt");
  m.setMediaTranscript(a.id, "Gentle piano music.");
  assert.deepEqual(errors(validate(m, files)), []);
  m.setMediaTranscript(v.id, "A transcript is not captions");
  m.setMediaCaptions(v.id, null);
  assert.ok(errors(validate(m, files)).includes("media-needs-captions"), "a transcript does not make up for a video with no captions");
});

test("credit that is required must be complete, the file must exist, and the credits page should be on", opts, () => {
  const m = fresh();
  m.addObject("image", { imageSrc: "assets/images/a.jpg" });
  m.setAccessibility(m.object!.id, { altText: "A view" });
  m.setCredit(credit("assets/images/a.jpg"));
  assert.deepEqual(errors(validate(m, ["assets/images/a.jpg"])), []);
  assert.ok(validate(m).some((f) => f.rule === "credit-asset-missing" && f.severity === "warning"));
  m.setCredit(credit("assets/images/a.jpg", { creator: "" }));
  assert.ok(errors(validate(m, ["assets/images/a.jpg"])).includes("credit-incomplete"));
  m.setCredit(credit("assets/images/a.jpg"));
  m.setCredits(false);
  assert.ok(validate(m, ["assets/images/a.jpg"]).some((f) => f.rule === "credit-page-off" && f.severity === "warning"));
});
