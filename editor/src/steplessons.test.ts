// Tests for the Practice and Test lessons made from steps: what each slide holds, how the rules read, the places offered in a Test, and the course's own checker.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Runtime, type Host } from "../../player/src/runtime.ts";
import type { CoursePackage, OSObject, Project, Slide, Theme } from "../../player/src/types.ts";
import { Model } from "./model.ts";
import { editStep, knowPicture, listFrom, parseLog, proposeFromLog, type StepList } from "./steps.ts";
import { buildPracticeSlide, buildTestSlide, hintFor, lessonCapture, otherAreas, placeWords, TRIES_BEFORE_SHOWN, type LessonOptions } from "./steplessons.ts";
import type { StepPicture } from "./stepslides.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function options(over: Partial<LessonOptions> = {}): LessonOptions {
  let n = 0;
  return { recording: "Demo.capture#practice", total: 3, stage: { width: 1280, height: 720 }, newSlideId: () => `slide-x${++n}`, newObjectId: () => `obj-x${++n}`, newTriggerId: () => `trg-x${++n}`, tries: "var-1", narration: (script) => ({ script }), ...over };
}

function stepsOf(...lines: string[]): StepList {
  const events = parseLog(lines.join("\n")).events;
  let list = listFrom([proposeFromLog(events, { take: 1 })]).list;
  for (const s of list.steps) list = knowPicture(list, s.id, { width: 1920, height: 1080 });
  return list;
}

const CLICK = '{"t":1000,"type":"click","x":960,"y":540,"button":"left"}';
const NAMED = '{"t":1000,"type":"element","name":"Save","role":"button"}';
const TYPED = ['{"t":2000,"type":"key","key":"h","modifiers":[]}', '{"t":2100,"type":"key","key":"i","modifiers":[]}'];
const ENTER = '{"t":3000,"type":"key","key":"enter","modifiers":[]}';
const PIC: StepPicture = { path: "assets/images/step-1.png", width: 1920, height: 1080 };

const byName = (slide: Slide, part: string): OSObject => slide.baseLayer.objects.find((o) => o.name.endsWith(part))!;
const actions = (o: OSObject): string[] => o.triggers.map((t) => `${t.event}:${t.action}${t.operation === "add" ? "+" : ""}:${t.target}${t.conditions.length ? "?" + t.conditions.map((c) => `${c.operator}${c.value}`).join("&") : ""}`);

test("each lesson is its own capture, so two slides never claim the same step", () => {
  assert.equal(lessonCapture("Demo.capture", "watch"), "Demo.capture");
  assert.equal(lessonCapture("Demo.capture", "practice"), "Demo.capture#practice");
  assert.equal(lessonCapture("Demo.capture", "test"), "Demo.capture#test");
});

test("a place on a picture is told by the third it is in, and a hint names what to look for", () => {
  assert.equal(placeWords({ x: 45, y: 45, width: 10, height: 10 }), "Middle");
  assert.equal(placeWords({ x: 0, y: 0, width: 10, height: 10 }), "Top left");
  assert.equal(placeWords({ x: 80, y: 85, width: 10, height: 10 }), "Bottom right");
  assert.equal(placeWords({ x: 45, y: 5, width: 10, height: 10 }), "Top middle");
  const list = stepsOf(CLICK, NAMED, ENTER);
  assert.equal(hintFor(list.steps[0]!), "Look for the Save button.");
  assert.equal(hintFor(list.steps[1]!), "Press Enter.", "no name, so the words");
});

test("the other areas offered in a Test are cells the place does not touch, nearest first, and never the place itself", () => {
  const areas = otherAreas({ x: 45, y: 45, width: 10, height: 10 });
  assert.equal(areas.length, 4);
  assert.ok(areas.every((a) => a.label !== "Middle"));
  assert.ok(areas.every((a) => !(45 < a.x + a.width && 55 > a.x && 45 < a.y + a.height && 55 > a.y)), "none touches the place");
  assert.equal(new Set(areas.map((a) => a.label)).size, areas.length, "different labels");
  const corner = otherAreas({ x: 1, y: 1, width: 10, height: 10 });
  assert.equal(corner[0]!.label.includes("Top"), true, "the nearest come first");
  // a place that touches every cell has no cell, so a strip round it is used
  const near = otherAreas({ x: 5, y: 5, width: 90, height: 40 });
  assert.deepEqual(near.map((a) => a.label), ["Bottom middle", "Bottom left", "Bottom right"], "only the cells it does not touch");
  const huge = otherAreas({ x: 5, y: 5, width: 90, height: 90 });
  assert.equal(huge.length, 1);
  assert.equal(huge[0]!.label, "Above the place");
  assert.deepEqual(otherAreas({ x: 0, y: 0, width: 100, height: 100 }), [], "a place that fills the picture leaves nothing to choose");
});

test("Practice for a click: the picture, a hotspot on the place, one on the rest, Show me, and the three layers", () => {
  const list = stepsOf(CLICK, NAMED, ENTER);
  const slide = buildPracticeSlide(list.steps[0]!, 0, PIC, options());
  assert.equal(slide.provenance && "sourceCapture" in slide.provenance && slide.provenance.sourceCapture, "Demo.capture#practice");
  assert.equal(slide.name, "Practice 1: Click the Save button.");
  assert.deepEqual(slide.baseLayer.objects.map((o) => o.type), ["text", "text", "image", "shape", "hotspot", "hotspot", "button"]);
  assert.deepEqual(slide.layers.map((l) => l.id), ["layer-hint", "layer-shown", "layer-right"]);
  const target = byName(slide, "target");
  const elsewhere = byName(slide, "anywhere else");
  assert.equal(target.accessibility.altText, "Click the Save button");
  assert.equal(elsewhere.accessibility.altText, "Anywhere else on the screen");
  assert.ok(target.geometry.width >= 40 && target.geometry.height >= 40, "big enough to press");
  const image = byName(slide, "picture");
  assert.deepEqual([elsewhere.geometry.x, elsewhere.geometry.y, elsewhere.geometry.width, elsewhere.geometry.height], [image.geometry.x, image.geometry.y, image.geometry.width, image.geometry.height], "the rest covers the picture");
  assert.ok(target.geometry.z > elsewhere.geometry.z, "the place is on top, so it takes its own clicks");
  assert.ok(byName(slide, "place to click").geometry.z < elsewhere.geometry.z, "the frame lies under both, so it takes no click");
  assert.deepEqual([target.accessibility.tabOrder, elsewhere.accessibility.tabOrder], [4, 5]);
  assert.ok(target.triggers.length === 6 && elsewhere.triggers.length === 8, "every rule is a click and a key press");
  assert.deepEqual(actions(target), ["click:hideLayer:layer-hint", "keyActivate:hideLayer:layer-hint", "click:hideLayer:layer-shown", "keyActivate:hideLayer:layer-shown", "click:showLayer:layer-right", "keyActivate:showLayer:layer-right"]);
  assert.deepEqual(actions(elsewhere).slice(0, 2), ["click:setVariable+:var-1", "keyActivate:setVariable+:var-1"], "a try is counted first");
  assert.deepEqual(actions(elsewhere).filter((_a, i) => i % 2 === 0).slice(1), [`click:showLayer:layer-hint?lessThan${TRIES_BEFORE_SHOWN}`, `click:showLayer:layer-shown?greaterThanOrEqual${TRIES_BEFORE_SHOWN}`, `click:changeState:${byName(slide, "place to click").id}?greaterThanOrEqual${TRIES_BEFORE_SHOWN}`]);
  const frame = byName(slide, "place to click");
  assert.equal(frame.style["stroke"], undefined, "the frame is not drawn until it is asked for");
  assert.equal(frame.states["Shown"]?.style?.["stroke"] !== undefined, true);
  assert.match(frame.states["Shown"]?.announce ?? "", /now outlined/);
  const showMe = byName(slide, "Show me");
  assert.deepEqual(actions(showMe), [`click:changeState:${frame.id}`, `keyActivate:changeState:${frame.id}`]);
  assert.equal(showMe.triggers[0]!.value, "Shown");
  const words = byName(slide, "words");
  assert.deepEqual(actions(words), ["slideStart:setVariable:var-1"], "the count starts again each time the slide opens");
  assert.equal(words.triggers[0]!.value, 0);
  assert.deepEqual(words.narration, { script: "Click the Save button." });
  for (const layer of slide.layers) {
    const say = layer.objects.find((o) => o.type === "text")!;
    assert.equal(say.accessibility.role, "status", "what a layer says is announced");
  }
  assert.match(slide.layers[0]!.objects.find((o) => o.type === "text")!.content["html"] as string, /Not quite\. Look for the Save button\. Then try again\./);
  assert.deepEqual(slide.layers[2]!.objects.filter((o) => o.type === "button").map((o) => actions(o)[0]), ["click:nextSlide:"]);
});

test("Practice for typing: a short-answer question worth no points that takes what was typed, with its two layers", () => {
  const list = stepsOf(TYPED[0]!, TYPED[1]!, ENTER);
  const slide = buildPracticeSlide(list.steps[0]!, 0, PIC, options());
  const quiz = slide.baseLayer.objects.find((o) => o.type === "quizQuestion")!;
  assert.deepEqual(quiz.content["answers"], ["hi"]);
  assert.deepEqual(quiz.content["scoring"], { points: 0, attemptsAllowed: 3 });
  assert.deepEqual(quiz.content["feedback"], { correct: "layer-right", incorrect: "layer-wrong" });
  assert.deepEqual(slide.layers.map((l) => l.id), ["layer-right", "layer-wrong"]);
  assert.equal(quiz.geometry.y + quiz.geometry.height <= 720, true);
  const image = byName(slide, "picture");
  assert.ok(image.geometry.y + image.geometry.height <= quiz.geometry.y, "the picture stops above the answer");
});

test("a step with nothing to point at or type is shown as in the Watch lesson, in either lesson", () => {
  const list = stepsOf(CLICK, NAMED, ENTER);
  const key = buildPracticeSlide(list.steps[1]!, 1, PIC, options());
  assert.deepEqual(key.baseLayer.objects.map((o) => o.type), ["text", "text", "image"]);
  assert.equal(key.name, "Practice 2: Press Enter.", "named for its lesson, like the rest of the outline");
  assert.equal(key.provenance && "sourceCapture" in key.provenance && key.provenance.sourceCapture, "Demo.capture#practice");
  const noBox = editStep(list, "step-1", { box: null });
  assert.deepEqual(buildTestSlide(noBox.steps[0]!, 0, PIC, options({ recording: "Demo.capture#test" })).baseLayer.objects.map((o) => o.type), ["text", "text", "image"]);
  assert.equal(buildPracticeSlide(list.steps[0]!, 0, null, options()).baseLayer.objects.some((o) => o.type === "hotspot"), false, "no picture, nothing to point at");
});

test("the Test for a click: one scored question, the place among some other areas, one try, no hints", () => {
  const list = editStep(stepsOf(CLICK, NAMED, ENTER), "step-1", { reviewed: true, alt: "The File menu with Save." });
  const slide = buildTestSlide(list.steps[0]!, 0, PIC, options({ recording: "Demo.capture#test" }));
  assert.equal(slide.name, "Test 1: Click the Save button.");
  assert.deepEqual(slide.baseLayer.objects.map((o) => o.type), ["text", "text", "quizQuestion"]);
  const quiz = byName(slide, "question");
  const c = quiz.content as { questionType: string; image: { src: string; alt: string }; regions: { id: string; label: string; x: number; y: number; width: number; height: number; correct: boolean }[]; scoring: unknown; feedback: unknown };
  assert.equal(c.questionType, "hotspot");
  assert.deepEqual(c.image, { src: "assets/images/step-1.png", alt: "The File menu with Save." });
  assert.deepEqual(c.scoring, { points: 1, attemptsAllowed: 1 });
  assert.equal(c.regions.filter((r) => r.correct).length, 1);
  assert.equal(c.regions[0]!.correct, true);
  assert.ok(c.regions.length >= 2 && c.regions.length <= 12);
  assert.equal(new Set(c.regions.map((r) => r.id)).size, c.regions.length);
  assert.equal(new Set(c.regions.map((r) => r.label)).size, c.regions.length, "every area has its own label, for the list a keyboard uses");
  assert.ok(c.regions.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.width <= 100.01 && r.y + r.height <= 100.01), "wholly inside the picture");
  const right = c.regions[0]!;
  for (const r of c.regions.slice(1)) assert.ok(!(right.x < r.x + r.width && right.x + right.width > r.x && right.y < r.y + r.height && right.y + right.height > r.y), `${r.label} does not overlap the place`);
  assert.deepEqual(slide.layers.map((l) => l.id), ["layer-right", "layer-wrong"]);
  const unchecked = buildTestSlide(stepsOf(CLICK, NAMED, ENTER).steps[0]!, 0, PIC, options({ recording: "Demo.capture#test" }));
  assert.equal((byName(unchecked, "question").content["image"] as { alt: string }).alt, "", "an unchecked step's picture has no description yet");
});

test("the Test for typing: one scored short-answer question, one try", () => {
  const slide = buildTestSlide(stepsOf(TYPED[0]!, TYPED[1]!).steps[0]!, 0, PIC, options({ recording: "Demo.capture#test" }));
  const quiz = slide.baseLayer.objects.find((o) => o.type === "quizQuestion")!;
  assert.deepEqual([quiz.content["answers"], quiz.content["scoring"], quiz.content["caseSensitive"]], [["hi"], { points: 1, attemptsAllowed: 1 }, true]);
  assert.equal(slide.name, "Test 1: Type \"hi\".");
});

// ---- in the course

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-18" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const pictures = (list: StepList): Map<string, StepPicture> => new Map(list.steps.map((s, i) => [s.id, { path: `assets/images/step-${i + 1}.png`, width: 1920, height: 1080 }]));
const LINES = [CLICK, NAMED, TYPED[0]!, TYPED[1]!, ENTER].map((l, i) => (i >= 2 ? l.replace(/"t":(\d+)/, (_m, t) => `"t":${Number(t) + 4000}`) : l));

test("the three lessons can all be in one course, each making its slides once, and Practice makes its counter once", () => {
  const m = fresh();
  const list = stepsOf(...LINES);
  const go = (lesson: "watch" | "practice" | "test") => m.makeStepSlides({ recording: "Demo.capture", lesson, steps: list.steps, pictures: pictures(list) });
  assert.equal(go("watch").added, 3);
  const practice = go("practice");
  assert.equal(practice.added, 3);
  assert.match(practice.message, /^Made 3 slides for the Practice lesson, after the slide you were on\./);
  assert.equal(go("practice").message, "Every step already has a slide in the Practice lesson.");
  assert.equal(go("test").added, 3);
  assert.match(go("test").message, /Every step already has a slide in the Test lesson/);
  assert.equal(m.slides.length, 1 + 9);
  assert.deepEqual(m.project.variables.filter((v) => v.name === "practice tries").map((v) => v.type), ["number"], "one counter, however many Practice slides");
  const test2 = fresh();
  const t = test2.makeStepSlides({ recording: "Demo.capture", lesson: "test", steps: list.steps, pictures: pictures(list) });
  assert.match(t.message, /Add a results box after the last question to show the learner their score\./);
  m.undo();
  assert.equal(m.slides.length, 1 + 6, "one undo takes the last lesson away");
});

test("undoing the Practice lesson takes its counter away too", () => {
  const m = fresh();
  const list = stepsOf(CLICK, NAMED);
  m.makeStepSlides({ recording: "Demo.capture", lesson: "practice", steps: list.steps, pictures: pictures(list) });
  assert.equal(m.project.variables.some((v) => v.name === "practice tries"), true);
  m.undo();
  assert.equal(m.project.variables.some((v) => v.name === "practice tries"), false);
  assert.equal(m.slides.length, 1);
});

// ---- bringing a lesson up to date

import { addManual, deleteStep, moveStep } from "./steps.ts";

const CLICK2 = '{"t":2500,"type":"click","x":300,"y":300,"button":"left"}';
const ENTER6 = '{"t":6000,"type":"key","key":"enter","modifiers":[]}';
const stepIdsOfSlides = (m: Model): string[] => m.slides.flatMap((sl) => (sl.provenance && "stepId" in sl.provenance ? [sl.provenance.stepId] : []));

test("a step added later gets its slide in its own place among the lesson's slides, not at the end", () => {
  const m = fresh();
  let list = stepsOf(CLICK, NAMED, CLICK2, ENTER6);
  assert.deepEqual(list.steps.map((s) => s.id), ["step-1", "step-2", "step-3"]);
  // steps 1 and 3 have slides; then a new step goes between them, and another comes first
  m.makeStepSlides({ recording: "Demo.capture", lesson: "watch", steps: [list.steps[0]!, list.steps[2]!], pictures: pictures(list) });
  list = addManual(list, { take: 1, atMs: 100 });
  list = editStep(list, "step-4", { text: "Open Notepad." });
  list = moveStep(moveStep(moveStep(list, "step-4", -1), "step-4", -1), "step-4", -1);
  assert.deepEqual(list.steps.map((s) => s.id), ["step-4", "step-1", "step-2", "step-3"]);
  const r = m.makeStepSlides({ recording: "Demo.capture", lesson: "watch", steps: list.steps, pictures: pictures(list) });
  assert.equal(r.added, 2, "step 4 and step 2 had no slide yet");
  assert.deepEqual(stepIdsOfSlides(m), ["step-4", "step-1", "step-2", "step-3"], "in the order of the steps, each in its place");
  assert.match(r.message, /each in its place\./);
  const again = m.makeStepSlides({ recording: "Demo.capture", lesson: "watch", steps: list.steps, pictures: pictures(list) });
  assert.equal(again.added, 0);
  const noneYet = fresh();
  noneYet.makeStepSlides({ recording: "Demo.capture", lesson: "watch", steps: list.steps, pictures: pictures(list) });
  assert.deepEqual(stepIdsOfSlides(noneYet), ["step-4", "step-1", "step-2", "step-3"], "a first making follows the order of the list too");
});

test("slides for steps that are gone, and slides that say something else than their step now, are reported and never changed", () => {
  const m = fresh();
  let list = stepsOf(CLICK, NAMED, CLICK2, ENTER6);
  m.makeStepSlides({ recording: "Demo.capture", lesson: "practice", steps: list.steps, pictures: pictures(list) });
  const before = JSON.stringify(m.slides);
  list = deleteStep(list, "step-3");
  list = editStep(list, "step-1", { text: "Choose Save." });
  const r = m.makeStepSlides({ recording: "Demo.capture", lesson: "practice", steps: list.steps, pictures: pictures(list) });
  assert.equal(r.added, 0);
  assert.match(r.message, /^Every step already has a slide in the Practice lesson\./);
  assert.match(r.message, /A slide is for a step that is no longer in the list: "Practice 3: Press Enter\.". Delete it if you do not want it\./);
  assert.match(r.message, /A slide says something different from its step's words now: "Practice 1: Click the Save button\.". To remake one, delete the slide and make the lesson again/);
  assert.equal(JSON.stringify(m.slides), before, "nothing was changed");
  // remaking: delete the slide, make again, and the new words are on a new slide in the same place
  m.deleteSlide(m.slides.find((sl) => sl.name.startsWith("Practice 1:"))!.id);
  const again = m.makeStepSlides({ recording: "Demo.capture", lesson: "practice", steps: list.steps, pictures: pictures(list) });
  assert.equal(again.added, 1);
  assert.deepEqual(stepIdsOfSlides(m), ["step-1", "step-2", "step-3"], "in its own place, first");
  assert.equal(m.slides.find((sl) => sl.name === "Practice 1: Choose Save.") !== undefined, true);
  assert.doesNotMatch(again.message, /something different/);
});

// ---- what a learner can do, in the player's own runtime

function runtimeOf(m: Model): { rt: Runtime; log: string[]; pkg: CoursePackage } {
  const files = m.allFiles();
  const get = <T,>(rel: string): T => JSON.parse(files.find((f) => f.path === rel)!.text) as T;
  const order = get<Project>("project.json").scenes.flatMap((sc) => sc.slides);
  const pkg: CoursePackage = { project: get<Project>("project.json"), theme: get<Theme>("theme.json"), slides: order.map((id) => get<Slide>(`slides/${id}.json`)), narration: {} };
  const log: string[] = [];
  const host: Host = {
    showSlide: (sl) => log.push(`show ${sl.id}`), setLayerVisible: (id, v) => log.push(`layer ${id} ${v}`), playMedia: () => undefined, pauseMedia: () => undefined,
    setObjectState: (id, st) => log.push(`state ${id} ${st}`),
  };
  return { rt: new Runtime(pkg, host), log, pkg };
}

const named = (slide: Slide, part: string): OSObject => slide.baseLayer.objects.find((o) => o.name.endsWith(part))!;
const withLayer = (slide: Slide, layer: string, label: string): OSObject => slide.layers.find((l) => l.id === layer)!.objects.find((o) => o.type === "button" && o.name === label)!;

test("Practice, as a learner meets it: wrong tries give a hint, the third shows the place, the right place says so and goes on", () => {
  const m = fresh();
  const list = stepsOf(CLICK, NAMED, '{"t":2000,"type":"click","x":300,"y":300,"button":"left"}');
  m.makeStepSlides({ recording: "Demo.capture", lesson: "practice", steps: list.steps, pictures: pictures(list) });
  const { rt, log, pkg } = runtimeOf(m);
  const [first, second] = pkg.slides.filter((sl) => sl.name.startsWith("Practice"));
  const tries = pkg.project.variables.find((v) => v.name === "practice tries")!.id;
  rt.goTo(first!.id);
  assert.equal(rt.variables.get(tries), 0);
  assert.deepEqual([...rt.visibleLayers], ["layer-base"], "nothing is said until the learner does something");
  const elsewhere = named(first!, "anywhere else").id;
  const target = named(first!, "target").id;
  const frame = named(first!, "place to click").id;
  rt.fire(elsewhere, "click");
  assert.equal(rt.variables.get(tries), 1);
  assert.ok(rt.visibleLayers.has("layer-hint") && !rt.visibleLayers.has("layer-shown"), "the first wrong try gives a hint");
  rt.fire(withLayer(first!, "layer-hint", "Try again").id, "keyActivate");
  assert.equal(rt.visibleLayers.has("layer-hint"), false, "Try again closes the hint, by keyboard too");
  rt.fire(elsewhere, "keyActivate");
  assert.equal(rt.variables.get(tries), 2, "a key press counts as a try as a click does");
  assert.ok(rt.visibleLayers.has("layer-hint"));
  assert.equal(log.some((l) => l === `state ${frame} Shown`), false, "the place is not shown yet");
  rt.fire(withLayer(first!, "layer-hint", "Try again").id, "click");
  rt.fire(elsewhere, "click");
  assert.equal(rt.variables.get(tries), 3);
  assert.ok(rt.visibleLayers.has("layer-shown") && !rt.visibleLayers.has("layer-hint"), "the third try says where it is");
  assert.ok(log.includes(`state ${frame} Shown`), "and outlines it");
  rt.fire(target, "click");
  assert.ok(rt.visibleLayers.has("layer-right") && !rt.visibleLayers.has("layer-shown") && !rt.visibleLayers.has("layer-hint"), "the right place says so and closes the others");
  rt.fire(withLayer(first!, "layer-right", "Next step").id, "click");
  assert.equal(rt.currentSlide?.id, second!.id, "Next step goes to the next slide");
  assert.equal(rt.variables.get(tries), 0, "and the count starts again");
  rt.goTo(first!.id);
  assert.equal(rt.variables.get(tries), 0);
});

test("Show me outlines the place at once, by mouse or keyboard", () => {
  const m = fresh();
  const list = stepsOf(CLICK, NAMED);
  m.makeStepSlides({ recording: "Demo.capture", lesson: "practice", steps: list.steps, pictures: pictures(list) });
  const { rt, log, pkg } = runtimeOf(m);
  const slide = pkg.slides.find((sl) => sl.name.startsWith("Practice"))!;
  rt.goTo(slide.id);
  rt.fire(named(slide, "Show me").id, "keyActivate");
  assert.ok(log.includes(`state ${named(slide, "place to click").id} Shown`));
  assert.equal(rt.visibleLayers.size, 1, "nothing is counted against the learner");
});

test("Practice for typing takes what was typed and counts for nothing", () => {
  const m = fresh();
  const list = stepsOf(TYPED[0]!, TYPED[1]!);
  m.makeStepSlides({ recording: "Demo.capture", lesson: "practice", steps: list.steps, pictures: pictures(list) });
  const { rt, pkg } = runtimeOf(m);
  const slide = pkg.slides.find((sl) => sl.name.startsWith("Practice"))!;
  const quiz = slide.baseLayer.objects.find((o) => o.type === "quizQuestion")!;
  rt.goTo(slide.id);
  assert.equal(rt.submitQuiz(quiz.id, "Hi", "click")?.correct, false, "capitals count when typing what was typed");
  assert.ok(rt.visibleLayers.has("layer-wrong"));
  assert.equal(rt.submitQuiz(quiz.id, "hi", "click")?.correct, true);
  assert.ok(rt.visibleLayers.has("layer-right") && !rt.visibleLayers.has("layer-wrong"));
  assert.deepEqual([rt.assessment().totalPoints, rt.assessment().earnedPoints], [0, 0], "Practice adds nothing to the score");
});

test("the Test, as a learner meets it: the right area scores, a wrong one does not, one try, and typing is scored", () => {
  const m = fresh();
  const list = stepsOf(CLICK, NAMED, TYPED[0]!.replace(/"t":\d+/, '"t":5000'), TYPED[1]!.replace(/"t":\d+/, '"t":5100'));
  m.makeStepSlides({ recording: "Demo.capture", lesson: "test", steps: list.steps, pictures: pictures(list) });
  const { rt, pkg } = runtimeOf(m);
  const [click, typing] = pkg.slides.filter((sl) => sl.name.startsWith("Test"));
  const q1 = click!.baseLayer.objects.find((o) => o.type === "quizQuestion")!;
  const q2 = typing!.baseLayer.objects.find((o) => o.type === "quizQuestion")!;
  assert.equal(rt.assessment().totalPoints, 2, "one point for each question");
  rt.goTo(click!.id);
  const wrong = rt.submitQuiz(q1.id, "r2", "click")!;
  assert.deepEqual([wrong.correct, wrong.locked, wrong.score], [false, true, 0], "one try, then it is done");
  assert.ok(rt.visibleLayers.has("layer-wrong"));
  assert.equal(rt.submitQuiz(q1.id, "r1", "click")?.correct, false, "it does not reopen");
  rt.goTo(typing!.id);
  const ok = rt.submitQuiz(q2.id, "hi", "click")!;
  assert.deepEqual([ok.correct, ok.score], [true, 1]);
  assert.deepEqual([rt.assessment().earnedPoints, rt.assessment().totalPoints], [1, 2]);
});

// ---- the course's own checker

type Finding = { rule: string; severity: string; message: string };

function validate(m: Model): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-lessons-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout) as Finding[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the real validator accepts every lesson, together, and asks only for the unchecked pictures' descriptions", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  let list = stepsOf(...LINES);
  list = editStep(list, "step-1", { reviewed: true, alt: "The File menu with Save." });
  list = editStep(list, "step-2", { reviewed: true, alt: "A text box before typing." });
  for (const lesson of ["watch", "practice", "test"] as const) m.makeStepSlides({ recording: "Demo.capture", lesson, steps: list.steps, pictures: pictures(list) });
  // The pictures are not on disk in this test, so their files are missing; that is the one thing set aside.
  const found = validate(m).filter((f) => f.rule !== "asset-missing");
  const unexpected = found.filter((f) => f.rule !== "alt-text-missing" && f.rule !== "quiz-hotspot-alt");
  assert.deepEqual(unexpected.map((f) => `${f.severity} ${f.rule}: ${f.message}`), [], "nothing else is wrong, and no step is claimed twice");
  assert.ok(found.filter((f) => f.rule === "alt-text-missing" || f.rule === "quiz-hotspot-alt").length >= 3, "the pictures of unchecked steps ask for their descriptions");
});
