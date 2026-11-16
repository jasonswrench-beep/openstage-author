// Tests for the interactive video: the times it is told in, a chapter list, each kind of moment as the Model builds it (what it is made of, that the timing and
// rules tie it to the video, that it can be found again and taken away whole, and that it is one undo step), and that the real checker accepts all of it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { OSObject } from "../../player/src/types.ts";
import type { Finding } from "./backend.ts";
import { chaptersAsText, formatTime, parseChapters, parseTime, timeInWords } from "./interactivevideo.ts";
import { box } from "./factory.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A course with three slides, the first holding a video. */
function withVideo(): { m: Model; video: OSObject } {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-11-16" });
  const m = new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
  m.addSlide();
  m.addSlide();
  m.selectSlide(m.slides[0]!.id);
  const video: OSObject = {
    ...box("obj-9100", 80, 80, 960, 540, 5), type: "video", name: "Lesson video",
    content: { src: "assets/video/lesson.mp4", captions: "assets/captions/lesson.vtt", transcript: "<p>Words.</p>" },
    style: {},
    accessibility: { altText: "A lesson on listening", role: "video", tabOrder: 9, decorative: false },
  };
  m.slide!.baseLayer.objects.push(video);
  return { m, video };
}

const question = { kind: "question" as const, atMs: 20_000, question: "What did she say first?", answers: ["Hello", "Goodbye", "Thanks"], correct: 0, right: "Yes.", wrong: "Listen again." };

function findings(m: Model): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "osiv-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"] ?? "python", [path.join(repo, "tools", "validate.py"), dir, "--json", "--block", "errors"], { encoding: "utf-8" });
    // The video and its captions are not files in this test, so what the checker says about missing assets is not what is being tried.
    return (JSON.parse(r.stdout) as Finding[]).filter((f) => f.rule !== "asset-missing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const errors = (f: Finding[]) => f.filter((x) => x.severity === "error");

test("a time is read as minutes and seconds or as seconds, and told as one, within the hour", () => {
  assert.equal(parseTime("1:20"), 80_000);
  assert.equal(parseTime("01:20"), 80_000);
  assert.equal(parseTime("80"), 80_000);
  assert.equal(parseTime("80.5"), 80_500);
  assert.equal(parseTime("1:02:03"), null, "past the hour");
  assert.equal(parseTime("1:00:00"), 3_600_000);
  for (const bad of ["", "abc", "1:2:3:4", "-5", "1:1:1:1", "61:00:01", "1,5"]) assert.equal(parseTime(bad), null, bad);
  assert.equal(formatTime(80_000), "1:20");
  assert.equal(formatTime(3_723_000), "1:02:03");
  assert.equal(formatTime(5_900), "0:05");
  assert.equal(timeInWords(80_000), "1 minute 20 seconds");
  assert.equal(timeInWords(60_000), "1 minute");
  assert.equal(timeInWords(1000), "1 second");
});

test("chapters are written as a time and a title a line, sorted by time, and a bad line is named", () => {
  const read = parseChapters("1:20 The first rule\n0:00 Introduction\n\n3:05 Wrap up");
  assert.deepEqual(read.problems, []);
  assert.deepEqual(read.chapters.map((c) => [c.atMs, c.title]), [[0, "Introduction"], [80_000, "The first rule"], [185_000, "Wrap up"]]);
  assert.equal(chaptersAsText(read.chapters), "0:00 Introduction\n1:20 The first rule\n3:05 Wrap up");
  assert.match(parseChapters("hello there").problems[0]!, /Line 1.*a time and then a title/);
  assert.match(parseChapters("0:00 Only one").problems[0]!, /at least two chapters/);
  assert.match(parseChapters(Array.from({ length: 13 }, (_, i) => `${i}:00 Part ${i}`).join("\n")).problems[0]!, /up to 12/);
});

test("a question holds the video where it comes in, has a Continue that plays it again, and is one undo step", () => {
  const { m, video } = withVideo();
  const before = JSON.stringify(m.slide);
  const said = m.addVideoMoment(video.id, question);
  assert.ok(said.ok, said.message);
  assert.match(said.message, /question at 20 seconds.*Continue/);
  const slide = m.slide!;
  const [panel, prompt, quiz] = slide.baseLayer.objects.slice(-3) as [OSObject, OSObject, OSObject];
  for (const o of [panel, prompt, quiz]) {
    assert.deepEqual(o.timing, { appear: "media", media: video.id, start: 20_000, visibleFor: 500, pauseMedia: true }, o.name);
    assert.equal(o.group, "vm-question-0001");
  }
  assert.equal(quiz.type, "quizQuestion");
  assert.ok(quiz.geometry.x >= video.geometry.x && quiz.geometry.x + quiz.geometry.width <= video.geometry.x + video.geometry.width, "it is over the picture");
  assert.equal((quiz.content as { scoring: { attemptsAllowed: number } }).scoring.attemptsAllowed, 1, "one try, so the video goes on");
  assert.equal(slide.layers.length, 2);
  for (const layer of slide.layers) {
    const button = layer.objects.find((o) => o.type === "button")!;
    assert.equal(button.name, "Continue the video");
    for (const event of ["click", "keyActivate"]) {
      const t = button.triggers.filter((x) => x.event === event);
      assert.deepEqual(t.map((x) => [x.action, x.target]), [["hideLayer", layer.id], ["playMedia", video.id]], event);
    }
  }
  assert.deepEqual(m.videoMoments(video.id).map((x) => [x.kind, x.atMs]), [["question", 20_000]]);
  assert.equal(errors(findings(m)).length, 0, JSON.stringify(errors(findings(m)), null, 1));
  m.undo();
  assert.equal(JSON.stringify(m.slide), before, "one undo takes it all back");
});

test("a question that cannot be built says why and changes nothing", () => {
  const { m, video } = withVideo();
  const before = JSON.stringify(m.slide);
  const cases: [typeof question, RegExp][] = [
    [{ ...question, question: " " }, /Write the question/],
    [{ ...question, answers: ["Only one"] }, /at least two answers/],
    [{ ...question, answers: ["a", "b", "c", "d", "e", "f", "g"] }, /up to six/],
    [{ ...question, correct: 5 }, /which answer is right/],
    [{ ...question, atMs: 4_000_000 }, /within the hour/],
  ];
  for (const [spec, why] of cases) {
    const r = m.addVideoMoment(video.id, spec);
    assert.equal(r.ok, false);
    assert.match(r.message, why);
  }
  assert.equal(m.addVideoMoment("obj-none", question).ok, false);
  assert.equal(JSON.stringify(m.slide), before);
});

test("a hotspot is a named part of the picture for a time, pressed by mouse or key, holding the video and showing a note that Close puts away", () => {
  const { m, video } = withVideo();
  const r = m.addVideoMoment(video.id, { kind: "hotspot", atMs: 8_000, forMs: 6_000, label: "The red lever", text: "This stops the machine.", x: 40, y: 30, w: 20, h: 25 });
  assert.ok(r.ok, r.message);
  const slide = m.slide!;
  const spot = slide.baseLayer.objects.find((o) => o.type === "hotspot")!;
  assert.equal(spot.accessibility.altText, "The red lever");
  assert.deepEqual(spot.timing, { appear: "media", media: video.id, start: 8_000, visibleFor: 6_000 });
  assert.deepEqual(spot.geometry.width, Math.round(960 * 0.2));
  const layer = slide.layers[0]!;
  assert.deepEqual(spot.triggers.filter((t) => t.event === "click").map((t) => [t.action, t.target]), [["pauseMedia", video.id], ["showLayer", layer.id]]);
  assert.deepEqual(spot.triggers.filter((t) => t.event === "keyActivate").map((t) => t.action), ["pauseMedia", "showLayer"], "never mouse-only");
  const close = layer.objects.find((o) => o.type === "button")!;
  assert.deepEqual(close.triggers.filter((t) => t.event === "click").map((t) => t.action), ["hideLayer", "playMedia"]);
  assert.equal(errors(findings(m)).length, 0, JSON.stringify(errors(findings(m)), null, 1));
  const tries: [Partial<{ label: string; text: string; w: number; x: number; forMs: number }>, RegExp][] = [
    [{ label: "" }, /Name the hotspot/], [{ text: "" }, /what pressing it shows/], [{ w: 2 }, /too small/],
    [{ x: 90, w: 20 }, /past the edge/], [{ forMs: 200 }, /at least a second/],
  ];
  for (const [h, why] of tries) {
    const bad = m.addVideoMoment(video.id, { kind: "hotspot", atMs: 1000, forMs: 5000, label: "a", text: "x", x: 10, y: 10, w: 20, h: 20, ...h });
    assert.equal(bad.ok, false);
    assert.match(bad.message, why);
  }
});

test("chapters are buttons under the video that move it and play it, and setting them again replaces the old ones", () => {
  const { m, video } = withVideo();
  const set = (text: string) => m.addVideoMoment(video.id, { kind: "chapter", ...parseChapters(text) });
  assert.ok(set("0:00 Introduction\n1:20 The first rule\n3:05 Wrap up").ok);
  const buttons = () => m.slide!.baseLayer.objects.filter((o) => o.name.startsWith("Chapter: "));
  assert.deepEqual(buttons().map((b) => b.name), ["Chapter: 0:00 Introduction", "Chapter: 1:20 The first rule", "Chapter: 3:05 Wrap up"]);
  for (const b of buttons()) {
    assert.ok(b.geometry.y >= video.geometry.y + video.geometry.height, "under the video");
    const click = b.triggers.filter((t) => t.event === "click");
    assert.deepEqual(click.map((t) => [t.action, t.target]), [["seekMedia", video.id], ["playMedia", video.id]]);
    assert.equal(b.triggers.filter((t) => t.event === "keyActivate").length, 2, "and from the keyboard");
  }
  assert.equal(buttons()[1]!.triggers[0]!.value, 80_000);
  assert.deepEqual(m.videoMoments(video.id).map((x) => [x.kind, x.atMs]), [["chapter", 0]]);
  assert.equal(errors(findings(m)).length, 0, JSON.stringify(errors(findings(m)), null, 1));
  assert.ok(set("0:00 One\n2:00 Two").ok);
  assert.deepEqual(buttons().map((b) => b.name), ["Chapter: 0:00 One", "Chapter: 2:00 Two"], "the old ones are gone");
  assert.equal(set("1:20").ok, false, "one chapter is not a menu");
  assert.match(m.removeVideoMoment(video.id, m.videoMoments(video.id)[0]!.tag)!, /chapters/);
  assert.equal(buttons().length, 0);
});

test("a choice at a time holds the video and branches to slides; a choice at the end shows when the video ends", () => {
  const { m, video } = withVideo();
  const [, second, third] = m.slides.map((s) => s.id) as [string, string, string];
  const at = m.addVideoMoment(video.id, { kind: "choice", atMs: 30_000, prompt: "What would you do?", choices: [{ label: "Ask a question", slideId: second }, { label: "Stay quiet", slideId: third }] });
  assert.ok(at.ok, at.message);
  const buttons = m.slide!.baseLayer.objects.filter((o) => o.type === "button");
  assert.deepEqual(buttons.map((b) => [b.name, b.triggers[0]!.action, b.triggers[0]!.target]), [["Ask a question", "jumpToSlide", second], ["Stay quiet", "jumpToSlide", third]]);
  assert.ok(buttons.every((b) => b.timing.pauseMedia === true && b.timing.media === video.id));

  const end = m.addVideoMoment(video.id, { kind: "choice", atMs: null, prompt: "Where next?", choices: [{ label: "Go on", slideId: second }, { label: "Go back", slideId: third }] });
  assert.ok(end.ok, end.message);
  const layer = m.slide!.layers.find((l) => l.name === "Choices at the end")!;
  assert.ok(layer);
  const video2 = m.slide!.baseLayer.objects.find((o) => o.id === video.id)!;
  assert.ok(video2.triggers.some((t) => t.event === "mediaComplete" && t.action === "showLayer" && t.target === layer.id));
  assert.equal(m.addVideoMoment(video.id, { kind: "choice", atMs: null, prompt: "Again?", choices: [{ label: "a", slideId: second }, { label: "b", slideId: third }] }).ok, false, "only one for the end");
  assert.deepEqual(m.videoMoments(video.id).map((x) => [x.kind, x.atMs]), [["choice", 30_000], ["choice", null]]);
  assert.equal(errors(findings(m)).length, 0, JSON.stringify(errors(findings(m)), null, 1));
  assert.equal(m.addVideoMoment(video.id, { kind: "choice", atMs: 5000, prompt: "x", choices: [{ label: "a", slideId: second }, { label: "b", slideId: "slide-nope" }] }).ok, false, "a way to go needs a slide that is there");
});

test("a moment is taken away whole: its objects, the layers only they open, and what the video held for it, and put back by Undo", () => {
  const { m, video } = withVideo();
  const [, second, third] = m.slides.map((s) => s.id) as [string, string, string];
  const plain = JSON.stringify(m.slide);
  m.addVideoMoment(video.id, question);
  m.addVideoMoment(video.id, { kind: "choice", atMs: null, prompt: "Where next?", choices: [{ label: "Go on", slideId: second }, { label: "Go back", slideId: third }] });
  const afterBoth = JSON.stringify(m.slide);
  const moments = m.videoMoments(video.id);
  assert.equal(moments.length, 2);
  const endOne = moments.find((x) => x.atMs === null)!;
  assert.match(m.removeVideoMoment(video.id, endOne.tag)!, /choice at the end/);
  assert.equal(m.slide!.layers.length, 2, "only the question's two feedback layers are left");
  assert.equal(m.slide!.baseLayer.objects.find((o) => o.id === video.id)!.triggers.length, 0, "the video no longer waits for its end");
  const q = moments.find((x) => x.kind === "question")!;
  assert.match(m.removeVideoMoment(video.id, q.tag)!, /question at 20 seconds/);
  assert.equal(JSON.stringify(m.slide), plain, "nothing of either is left");
  m.undo();
  m.undo();
  assert.equal(JSON.stringify(m.slide), afterBoth, "Undo puts them back");
  assert.equal(m.removeVideoMoment(video.id, "vm-question-9999"), null);
});

test("every moment kind together passes the real checker, and the timed objects follow the video", () => {
  const { m, video } = withVideo();
  const [, second, third] = m.slides.map((s) => s.id) as [string, string, string];
  m.addVideoMoment(video.id, question);
  m.addVideoMoment(video.id, { kind: "hotspot", atMs: 40_000, forMs: 5000, label: "The lever", text: "It stops the machine.", x: 10, y: 10, w: 20, h: 20 });
  m.addVideoMoment(video.id, { kind: "chapter", ...parseChapters("0:00 Start\n0:40 Middle") });
  m.addVideoMoment(video.id, { kind: "choice", atMs: 60_000, prompt: "Next?", choices: [{ label: "A", slideId: second }, { label: "B", slideId: third }] });
  m.addVideoMoment(video.id, { kind: "choice", atMs: null, prompt: "At the end?", choices: [{ label: "A", slideId: second }, { label: "B", slideId: third }] });
  const f = findings(m);
  assert.deepEqual(errors(f), [], JSON.stringify(errors(f), null, 1));
  // A hotspot is there for a time and then goes, and the checker rightly says a learner who needs longer may miss it; that is the one warning a moment draws.
  const spot = m.slide!.baseLayer.objects.find((o) => o.type === "hotspot")!;
  assert.deepEqual(f.filter((x) => (x.rule.startsWith("group-") || x.rule.startsWith("timing-")) && !(x.rule === "timing-control-disappears" && x.object_id === spot.id)), [], "no other group or timing problem");
  const all = [m.slide!.baseLayer, ...m.slide!.layers].flatMap((l) => l.objects);
  assert.ok(all.filter((o) => o.timing.appear === "media").every((o) => o.timing.media === video.id));
  assert.deepEqual(m.videoMoments(video.id).map((x) => x.kind), ["chapter", "question", "hotspot", "choice", "choice"]);
});
