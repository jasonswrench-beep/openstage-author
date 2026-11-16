// A presenter clip in the Model: what is offered to speak, putting a clip on the slide, making it again, undo, and that the real checker accepts it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { OSObject } from "../../../player/src/types.ts";
import type { Finding } from "../backend.ts";
import { box } from "../factory.ts";
import { Model } from "../model.ts";
import { newNarration, type Narration } from "../narration.ts";
import { newProjectFiles } from "../template.ts";
import { parsePresenters } from "./look.ts";
import { blockFor, creditForClip, startingAltText, type PresenterClipSpec } from "./status.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const look = { skin: "#e6b995", hair: { style: "short", color: "#2b2118" }, shirt: "#1f7a8c", background: "#dcecf3", glasses: false, eyes: "#2b2118" };
const guide = parsePresenters({ presenters: [{ id: "lite-guide", name: "Guide", tier: "lite", description: "An illustrated guide with short dark hair and a teal shirt, facing the camera", look }] })[0]!;

/** A course with one slide holding a heading that has narration. */
function withNarratedText(): { m: Model; text: OSObject; speech: Narration } {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-11-16" });
  const m = new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
  const speech = newNarration("Welcome to the course.");
  const text: OSObject = {
    ...box("obj-9300", 80, 80, 600, 80, 5), type: "text", name: "Welcome", content: { html: "<p>Welcome to the course.</p>" }, style: {},
    accessibility: { altText: "", role: "paragraph", tabOrder: 9, decorative: false }, narration: speech,
  };
  m.slide!.baseLayer.objects.push(text);
  return { m, text, speech };
}

function spec(m: Model, speech: Narration, over: Partial<PresenterClipSpec> & { framing?: "rectangle" | "rounded" | "circle"; src?: string } = {}): PresenterClipSpec {
  const src = over.src ?? "assets/video/presenter-lite-guide.webm";
  const block = blockFor(speech, { id: "lite-guide", tier: "lite", framing: over.framing ?? "circle", label: true });
  return {
    src, captions: "assets/captions/presenter-lite-guide.vtt", altText: startingAltText(guide), narration: speech, block,
    credit: creditForClip({ path: src, presenter: guide, script: speech.script, madeAt: "2026-11-16T10:00:00Z" }), takeNarrationFrom: "obj-9300", ...over,
  };
}

function findings(m: Model): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ospr-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"] ?? "python", [path.join(repo, "tools", "validate.py"), dir, "--json", "--block", "errors"], { encoding: "utf-8" });
    return (JSON.parse(r.stdout) as Finding[]).filter((f) => f.rule !== "asset-missing" && f.rule !== "credit-asset-missing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("what a presenter can speak is the narration on the slide, and a presenter clip is not offered", () => {
  const { m, speech } = withNarratedText();
  assert.deepEqual(m.speakableObjects().map((o) => o.id), ["obj-9300"]);
  m.slide!.baseLayer.objects.push({ ...box("obj-9301", 80, 200, 600, 80, 6), type: "text", name: "Quiet", content: {}, style: {}, accessibility: { altText: "", role: "paragraph", tabOrder: 10, decorative: false }, narration: { ...speech, script: "   " } });
  assert.equal(m.speakableObjects().length, 1, "words with nothing in them are not offered");
  m.addPresenterClip(spec(m, speech));
  assert.deepEqual(m.speakableObjects().map((o) => o.id), [], "the words went to the clip, and the clip is not offered");
});

test("a clip goes on the slide as one video with its words, its framing and its credit, and the source stops speaking", () => {
  const { m, speech } = withNarratedText();
  const clip = m.addPresenterClip(spec(m, speech))!;
  assert.equal(clip.type, "video");
  assert.equal(clip.geometry.width, 360);
  assert.equal(clip.geometry.height, 360);
  assert.deepEqual(clip.style, { radius: 180 }, "a circle");
  assert.equal(clip.content["src"], "assets/video/presenter-lite-guide.webm");
  assert.equal(clip.content["captions"], "assets/captions/presenter-lite-guide.vtt");
  assert.equal((clip.narration as Narration).script, "Welcome to the course.");
  assert.equal((clip.narration as Narration).audioCache, null);
  assert.equal(clip.presenter?.id, "lite-guide");
  assert.match(clip.accessibility.altText, /illustrated guide.*speaking/);
  assert.equal(m.object?.id, clip.id, "it is selected");
  assert.equal(m.slide!.baseLayer.objects.find((o) => o.id === "obj-9300")!.narration, null, "the heading no longer speaks");
  assert.equal(m.creditOf("assets/video/presenter-lite-guide.webm")?.source.provider, "generated");
  assert.equal(m.presenterStatus(clip.id), "up-to-date");
  assert.equal(m.presenterClip(clip.id), clip);
  assert.equal(m.presenterClip("obj-9300"), null);
});

test("putting the clip on the slide is one undo step, and takes everything back", () => {
  const { m, speech } = withNarratedText();
  const count = m.slide!.baseLayer.objects.length;
  m.addPresenterClip(spec(m, speech));
  assert.equal(m.undo(), true);
  assert.equal(m.slide!.baseLayer.objects.length, count);
  assert.equal((m.slide!.baseLayer.objects.find((o) => o.id === "obj-9300")!.narration as Narration).script, "Welcome to the course.", "the heading speaks again");
  assert.equal(m.creditOf("assets/video/presenter-lite-guide.webm"), undefined);
  assert.equal(m.redo(), true);
  assert.equal(m.slide!.baseLayer.objects.length, count + 1);
});

test("a clip whose words changed is out of date, and making it again keeps its place, its alt text and its words, and is one undo step", () => {
  const { m, speech } = withNarratedText();
  const clip = m.addPresenterClip(spec(m, speech, { takeNarrationFrom: null }))!;
  m.setGeometry(clip.id, { x: 100, y: 120 });
  clip.accessibility.altText = "The author's own description.";
  assert.equal(m.presenterStatus(clip.id), "up-to-date");
  (clip.narration as Narration).script = "Welcome back to the course.";
  assert.equal(m.presenterStatus(clip.id), "out-of-date");

  const words = clip.narration as Narration;
  const again = spec(m, words, { src: "assets/video/presenter-lite-guide-2.webm", framing: "rounded", takeNarrationFrom: null });
  const made = m.remakePresenterClip(clip.id, again)!;
  assert.equal(made.id, clip.id, "the same object");
  assert.equal(made.content["src"], "assets/video/presenter-lite-guide-2.webm");
  assert.equal(made.geometry.x, 100);
  assert.equal(made.accessibility.altText, "The author's own description.");
  assert.deepEqual(made.style, { radius: 28 }, "a new framing replaces the old one");
  assert.equal(m.presenterStatus(clip.id), "up-to-date");
  assert.equal(m.creditOf("assets/video/presenter-lite-guide.webm"), undefined, "the old file's credit is gone");
  assert.ok(m.creditOf("assets/video/presenter-lite-guide-2.webm"));
  assert.equal(m.undo(), true);
  assert.equal(m.slide!.baseLayer.objects.find((o) => o.id === clip.id)!.content["src"], "assets/video/presenter-lite-guide.webm");
  assert.ok(m.creditOf("assets/video/presenter-lite-guide.webm"));
  assert.equal(m.remakePresenterClip("obj-9300", again), null, "only a presenter clip can be made again");
});

test("a rectangle takes no rounding, and making a circle again at another size keeps it a circle", () => {
  const { m, speech } = withNarratedText();
  const clip = m.addPresenterClip(spec(m, speech, { framing: "rectangle", takeNarrationFrom: null }))!;
  assert.deepEqual(clip.style, {});
  m.setGeometry(clip.id, { width: 200, height: 200 });
  const made = m.remakePresenterClip(clip.id, spec(m, speech, { framing: "circle", src: "assets/video/presenter-lite-guide-2.webm", takeNarrationFrom: null }))!;
  assert.deepEqual(made.style, { radius: 100 });
});

test("the real checker accepts a presenter clip, and the credits page is the only thing it asks for", () => {
  const { m, speech } = withNarratedText();
  const clip = m.addPresenterClip(spec(m, speech))!;
  const found = findings(m);
  assert.deepEqual(found.filter((f) => f.object_id === clip.id || f.rule === "schema"), [], "nothing is wrong with the clip or the file it is in");
  assert.deepEqual(found.filter((f) => f.rule.startsWith("presenter")), []);
  assert.ok(JSON.stringify(m.allFiles().map((f) => f.path)).includes("assets.json"), "the credit is saved");
});
