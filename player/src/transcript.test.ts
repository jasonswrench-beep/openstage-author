// Tests for the course transcript: slide by slide, with the narration, the audio descriptions, the on-screen text and every interaction item, and without the quizzes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTranscript, htmlToText, transcriptFileName, transcriptText } from "./transcript.ts";
import { examplePackage } from "./test-helpers.ts";
import type { CoursePackage } from "./types.ts";

const base = examplePackage();
const object = (id: string, type: string, content: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  id, type, name: id, geometry: { x: 0, y: 0, width: 10, height: 10, rotation: 0, z: 0 }, content, style: {}, accessibility: { altText: "", role: "", tabOrder: null, decorative: false },
  states: {}, triggers: [], timing: { appear: "time", start: 0, visibleFor: null }, animation: {}, narration: null, provenance: null, simulation: null, ...over,
}) as never;
const slide = (id: string, name: string, objects: unknown[], layers: unknown[] = []) => ({ id, name, baseLayer: { id: "base", name: "Base", objects }, layers, background: null, duration: null, notes: "", provenance: null }) as never;
const course = (slides: unknown[], narration: CoursePackage["narration"] = {}, title = "Safe Lifting"): CoursePackage => ({
  ...base, project: { ...base.project, meta: { ...base.project.meta, title, language: "en" } }, slides: slides as never, narration,
});
const said = (script: string) => ({ script, lang: "en", audio: "a.mp3", cues: null });

test("HTML becomes plain lines: blocks apart, list items marked, tags gone, entities written out", () => {
  assert.equal(htmlToText("<h1>Welcome</h1><p>Lift with <strong>your legs</strong> &amp; keep the load close.</p>"), "Welcome\nLift with your legs & keep the load close.");
  assert.equal(htmlToText("<ul><li>First</li><li>Second&nbsp;one</li></ul>"), "- First\n- Second one");
  assert.equal(htmlToText("One<br>Two<br/>Three"), "One\nTwo\nThree");
  assert.equal(htmlToText("<p>5 &lt; 6 &#38; &#x41;</p>"), "5 < 6 & A");
  assert.equal(htmlToText("  <p> </p> "), "");
});

test("each slide has its title, then what is on it in reading order: text, then what is said that the text does not say", () => {
  const pkg = course([
    slide("s1", "Welcome", [
      object("t1", "text", { html: "<h1>Safe lifting</h1><p>Keep your back straight.</p>" }),
      object("t2", "text", { html: "<p>Bend your knees.</p>" }),
    ]),
  ], { t2: said("Bend your knees, and keep the load close to your body.") });
  const t = buildTranscript(pkg);
  assert.equal(t.title, "Safe Lifting");
  assert.deepEqual(t.sections, [{ title: "Welcome", paragraphs: ["Safe lifting", "Keep your back straight.", "Bend your knees.", "Bend your knees, and keep the load close to your body."] }]);
});

test("narration that only repeats the text on the screen is written once", () => {
  const pkg = course([slide("s1", "One", [object("t1", "text", { html: "<p>Bend your knees.</p>" })])], { t1: said("Bend your knees.") });
  assert.deepEqual(buildTranscript(pkg).sections[0]!.paragraphs, ["Bend your knees."]);
  const alone = course([slide("s1", "One", [object("i1", "image", { src: "a.png" })])], { i1: said("A worker lifts a box.") });
  assert.deepEqual(buildTranscript(alone).sections[0]!.paragraphs, ["A worker lifts a box."], "narration of an object that has no text of its own");
});

test("every interaction item is there: its title, its text, and anything its voice says that the text does not", () => {
  const ix = object("ix", "interaction", {
    kind: "tabs", orientation: "horizontal", allowMultiple: false,
    items: [
      { id: "a", title: "Before", body: "<p>Check the load.</p>", image: null, narration: null },
      { id: "b", title: "During", body: "<p>Keep it close.</p>", image: null, narration: null },
    ],
  });
  const pkg = course([slide("s1", "Steps", [ix])], { "ix/a": said("Check the load."), "ix/b": said("Hold the load close to your body.") });
  assert.deepEqual(buildTranscript(pkg).sections[0]!.paragraphs, ["Before", "Check the load.", "During", "Keep it close.", "Hold the load close to your body."]);
});

test("a table is read row by row, and a video gives its descriptions in time order and its transcript", () => {
  const table = object("tb", "table", { caption: "Weights", headerRow: true, headerColumn: false, rows: [["Load", "Limit"], ["Box", "25 kg"]] });
  const video = object("v1", "video", {
    src: "assets/video/a.mp4", captions: null, transcript: "<p>The worker lifts the box.</p>",
    description: { cues: [{ id: "d2", time: 65000, text: "She sets it down.", pause: false, narration: null }, { id: "d1", time: 2000, text: "A worker bends at the knee.", pause: false, narration: null }] },
  });
  const t = buildTranscript(course([slide("s1", "Media", [table, video])]));
  assert.deepEqual(t.sections[0]!.paragraphs, [
    "Weights", "Load | Limit", "Box | 25 kg",
    "Audio description, at 0:02: A worker bends at the knee.", "Audio description, at 1:05: She sets it down.", "The worker lifts the box.",
  ]);
});

test("a slide with a quiz question shows only its title and a note: the question, its choices and its feedback are all left out", () => {
  const quiz = slide("s2", "Check yourself", [
    object("t1", "text", { html: "<p>Answer the question.</p>" }),
    object("q1", "quizQuestion", { questionType: "choice", prompt: "Which is right?", choices: [] }, { narration: null }),
  ], [{ id: "ok", name: "Correct", objects: [object("t9", "text", { html: "<p>That is correct: the answer is B.</p>" })] }]);
  const t = buildTranscript(course([quiz]));
  assert.deepEqual(t.sections[0]!.paragraphs, ["This slide has a quiz question. Quiz questions are not part of the transcript."]);
  assert.ok(!JSON.stringify(t).includes("answer is B") && !JSON.stringify(t).includes("Answer the question"), "neither the feedback nor the words beside the choices are a way round it");
});

test("other layers of a slide without a quiz are included, and decorative objects are not", () => {
  const s = slide("s1", "More", [object("t1", "text", { html: "<p>Main.</p>" }), object("d1", "text", { html: "<p>Skip me.</p>" }, { accessibility: { altText: "", role: "", tabOrder: null, decorative: true } })],
    [{ id: "pop", name: "Popup", objects: [object("t2", "text", { html: "<p>Extra detail.</p>" })] }]);
  assert.deepEqual(buildTranscript(course([s])).sections[0]!.paragraphs, ["Main.", "Extra detail."]);
});

test("the transcript as a text file: the title, then each slide numbered, with a blank line between paragraphs", () => {
  const t = buildTranscript(course([slide("s1", "Welcome", [object("t1", "text", { html: "<p>Hello.</p><p>Goodbye.</p>" })]), slide("s2", "Empty", [])]));
  assert.equal(transcriptText(t, "\n"), "Safe Lifting\nTranscript\n\n1. Welcome\n\nHello.\n\nGoodbye.\n\n2. Empty\n\n(Nothing to read on this slide.)\n");
  assert.ok(transcriptText(t).includes("\r\n") && !/[^\r]\n/.test(transcriptText(t)), "Windows line endings by default");
});

test("the file's name is the course's title, made safe", () => {
  assert.equal(transcriptFileName("Safe Lifting"), "Safe-Lifting-transcript.txt");
  assert.equal(transcriptFileName("Café: l'été / 2026?"), "Cafe-l-ete-2026-transcript.txt");
  assert.equal(transcriptFileName("???"), "course-transcript.txt");
  assert.ok(transcriptFileName("x".repeat(200)).length <= 80);
});

test("the example courses give a transcript with a section for every slide", () => {
  const pkg = examplePackage();
  const t = buildTranscript(pkg);
  assert.equal(t.sections.length, pkg.slides.length);
  assert.ok(t.sections.every((s) => s.title.length > 0));
  assert.ok(transcriptText(t).length > 40);
});
