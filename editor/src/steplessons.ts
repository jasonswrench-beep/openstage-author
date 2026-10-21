// The Practice and Test lessons made from steps (Capture's Phase 7, stories E3 and E4). The Watch lesson is in stepslides.ts.
//
// Practice ("try it") puts the learner in front of the step's picture. For a click, a `hotspot` lies over the place to point at, and another over the rest of
// the picture, named "Anywhere else on the screen" so a learner who cannot use a mouse has the same two choices: pressing the right one says so, pressing the other
// counts a try and gives a hint, and after three tries the place is outlined (and also outlined when the learner asks with "Show me"). For typing, a short-answer
// question worth no points takes what the step typed. Everything is said in a live region as well as shown, and nothing is timed.
//
// Test ("test me") asks the same steps as scored questions, with one try and no hints: for a click, a hotspot question (the place, among some other areas of the
// picture), and for typing, a short-answer question. The score is the course's own quiz score, reported as every other question's is.
//
// A step with nothing to test or practise (a key, a change of program, a marker, a click with no place marked, a step with no picture) is shown as it is in the Watch
// lesson, so the story of the procedure reads in order. Nothing here uses a screen or the shell; ids and narration are given in, as for the Watch lesson.

import type { Layer, OSObject, Slide } from "../../player/src/types.ts";
import { colorRef } from "../../player/src/theme.ts";
import { writeRules, type Rule } from "./content.ts";
import { box } from "./factory.ts";
import type { Box, Step } from "./steps.ts";
import { buildStepSlide, fitPicture, partId, shorten, type SlideOptions, type StepPicture } from "./stepslides.ts";

export type Lesson = "watch" | "practice" | "test";

export const LESSON_WORDS: Record<Lesson, { name: string; short: string }> = {
  watch: { name: "Watch: see each step", short: "Watch" },
  practice: { name: "Practice: try each step, with hints", short: "Practice" },
  test: { name: "Test: scored, one try, no hints", short: "Test" },
};

/** What a lesson's slides call the capture in their provenance. Each lesson is its own, because two slides may not claim the same step. */
export function lessonCapture(recording: string, lesson: Lesson): string {
  return lesson === "watch" ? recording : `${recording}#${lesson}`;
}

export interface LessonOptions extends SlideOptions {
  newTriggerId(): string;
  /** The number variable that counts a learner's wrong tries on a slide (Practice). */
  tries: string;
}

/** Wrong tries before the place to click is shown. */
export const TRIES_BEFORE_SHOWN = 3;

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A hotspot or area is never smaller than this on the stage, so it can be pressed (WCAG 2.2, 2.5.8). */
const LEAST_TARGET = 40;

// ---- the parts every lesson slide has

interface Frame {
  px(n: number): number;
  margin: number;
  wide: number;
  words: string;
  wordsHeight: number;
  /** Where the picture may go: under the words, above `reserve` pixels kept at the bottom. */
  area(reserve?: number): { x: number; y: number; width: number; height: number };
}

function frameOf(step: Step, o: SlideOptions): Frame {
  const u = o.stage.width / 1280;
  const px = (n: number): number => Math.round(n * u);
  const margin = px(64);
  const words = step.text.replace(/\s+/g, " ").trim();
  const lines = Math.min(4, Math.max(1, Math.ceil(words.length / 85)));
  const wordsHeight = px(36 * lines + 16);
  return {
    px, margin, wide: o.stage.width - margin * 2, words, wordsHeight,
    area: (reserve = 0) => {
      const top = px(84) + wordsHeight + px(16);
      return { x: margin, y: top, width: o.stage.width - margin * 2, height: o.stage.height - top - px(24) - reserve };
    },
  };
}

function headingAndWords(step: Step, index: number, o: SlideOptions, f: Frame, label: string, headingWidth: number, tab = 1): OSObject[] {
  const heading: OSObject = {
    ...box(partId(o, "heading"), f.margin, f.px(20), headingWidth, f.px(60), 10), type: "text", name: `Step ${index + 1} heading`,
    content: { html: `<h1>${escapeHtml(label)}</h1>` },
    style: { fontFamily: "theme:font.heading", fontSize: f.px(36), color: colorRef("text") },
    accessibility: { altText: label, role: "heading", tabOrder: tab, decorative: false },
  };
  const words: OSObject = {
    ...box(partId(o, "words"), f.margin, f.px(84), f.wide, f.wordsHeight, 20), type: "text", name: `Step ${index + 1} words`,
    content: { html: `<p>${escapeHtml(f.words)}</p>` },
    style: { fontFamily: "theme:font.body", fontSize: f.px(26), color: colorRef("text") },
    accessibility: { altText: f.words, role: "paragraph", tabOrder: tab + 1, decorative: false },
  };
  words.narration = f.words === "" ? null : o.narration(f.words);
  return [heading, words];
}

function pictureObject(step: Step, index: number, picture: StepPicture, o: SlideOptions, rect: { x: number; y: number; width: number; height: number }, tab: number): OSObject {
  return {
    ...box(partId(o, "picture"), rect.x, rect.y, rect.width, rect.height, 30), type: "image", name: `Step ${index + 1} picture`,
    content: { src: picture.path }, style: {},
    // Only what the author checked is said: an unchecked step's picture has no description yet, and the validator asks for one.
    accessibility: { altText: step.reviewed ? step.alt.trim() : "", role: "img", tabOrder: tab, decorative: false },
  };
}

const rule = (action: Rule["action"], target: string, extra: Partial<Rule> = {}): Rule => ({ event: "activate", action, target, conditions: [], ...extra });

function button(o: SlideOptions & { newTriggerId(): string }, role: string, label: string, x: number, y: number, w: number, h: number, z: number, tab: number, rules: Rule[], f: Frame): OSObject {
  return {
    ...box(partId(o, role), x, y, w, h, z), type: "button", name: label,
    content: { label },
    style: { fontFamily: "theme:font.body", fontSize: f.px(20), color: colorRef("onAccentStrong"), fill: colorRef("accentStrong"), radius: 8 },
    accessibility: { altText: label, role: "button", tabOrder: tab, decorative: false },
    triggers: writeRules(rules.map((r) => ({ kind: "rule" as const, rule: r })), o.newTriggerId),
  };
}

/** A panel over the top of the slide with a message that is announced when it appears, and buttons. It is a layer that a rule shows. */
function bannerLayer(id: string, name: string, text: string, buttons: { label: string; rules: Rule[] }[], o: LessonOptions, f: Frame): Layer {
  const panel: OSObject = {
    ...box(partId(o, `${id}/panel`), f.margin - f.px(8), f.px(8), f.wide + f.px(16), f.px(150), 100), type: "shape", name: `${name} panel`,
    content: { shape: "rounded" },
    style: { fill: colorRef("surface"), stroke: colorRef("line"), strokeWidth: 2, radius: 12 },
    accessibility: { altText: "", role: "presentation", tabOrder: 0, decorative: true },
  };
  const message: OSObject = {
    ...box(partId(o, `${id}/message`), f.margin, f.px(20), f.wide, f.px(76), 110), type: "text", name: `${name} message`,
    content: { html: `<p>${escapeHtml(text)}</p>` },
    style: { fontFamily: "theme:font.body", fontSize: f.px(24), color: colorRef("text") },
    accessibility: { altText: text, role: "status", tabOrder: 1, decorative: false },
  };
  const gap = f.px(16);
  const w = f.px(190);
  const made = buttons.map((b, i) => button(o, `${id}/button-${i + 1}`, b.label, f.margin + i * (w + gap), f.px(104), w, f.px(48), 120, 2 + i, b.rules, f));
  return { id, name, objects: [panel, message, ...made] };
}

const slideOf = (step: Step, index: number, name: string, objects: OSObject[], layers: Layer[], o: SlideOptions): Slide => ({
  id: o.newSlideId(), name: `${name} ${index + 1}: ${shorten(step.text.replace(/\s+/g, " ").trim()) || "no words yet"}`,
  provenance: { sourceCapture: o.recording, stepId: step.id, ...(o.capturedAt === undefined ? {} : { capturedAt: o.capturedAt }) },
  duration: null, layout: null, background: null, baseLayer: { id: "layer-base", name: "Base", objects }, layers,
});

/** What pressing the place to point at is called, for a screen reader: the step's own words, without their full stop. */
const hotspotName = (step: Step): string => step.text.replace(/\s+/g, " ").trim().replace(/[.]$/, "") || "The place to point at";

/** A hint for a wrong try: what to look for, from the name of what was clicked when Windows said, else the step's words. */
export function hintFor(step: Step): string {
  const el = step.element;
  if (el !== null && el.name.trim() !== "") return `Look for the ${el.name.replace(/\s+/g, " ").trim()} ${el.role.toLowerCase()}.`;
  return step.text.replace(/\s+/g, " ").trim() || "Read the step again.";
}

/** Where, in words, a place on a picture is: the third of the picture (across, then down) its middle is in. */
export function placeWords(b: Box): string {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const across = cx < 100 / 3 ? "left" : cx < 200 / 3 ? "middle" : "right";
  const down = cy < 100 / 3 ? "Top" : cy < 200 / 3 ? "Middle" : "Bottom";
  if (down === "Middle" && across === "middle") return "Middle";
  return `${down} ${across}`;
}

// ---- Practice

/** The slide of the Practice lesson for a step. A step with nothing to point at or type is shown as in the Watch lesson. */
export function buildPracticeSlide(step: Step, index: number, picture: StepPicture | null, o: LessonOptions): Slide {
  const f = frameOf(step, o);
  if (step.kind === "type" && step.typed !== null && step.typed !== "") return typingSlide(step, index, picture, o, f, "practice");
  if (picture === null || step.box === null || step.target === null) return buildStepSlide(step, index, picture, { ...o, namePrefix: "Practice" });

  const label = `Try it: step ${index + 1} of ${o.total}`;
  const top = headingAndWords(step, index, o, f, label, f.wide - f.px(190));
  const heading = top[0]!;
  const words = top[1]!;
  const placed = fitPicture(f.area(), picture);
  const image = pictureObject(step, index, picture, o, placed, 3);
  const b = step.box;
  const at = (n: number, size: number, whole: number, start: number): { pos: number; len: number } => {
    const len = Math.max(LEAST_TARGET, Math.round((size / 100) * whole));
    return { pos: Math.max(0, Math.round(start + (n / 100) * whole + ((size / 100) * whole - len) / 2)), len };
  };
  const hx = at(b.x, b.width, placed.width, placed.x);
  const hy = at(b.y, b.height, placed.height, placed.y);

  // The frame that shows where to click: invisible until a rule gives it its look. It lies under the hotspots, which are transparent, so it never takes a click.
  const frame: OSObject = {
    ...box(partId(o, "frame"), Math.round(placed.x + (b.x / 100) * placed.width), Math.round(placed.y + (b.y / 100) * placed.height), Math.max(4, Math.round((b.width / 100) * placed.width)), Math.max(4, Math.round((b.height / 100) * placed.height)), 35),
    type: "shape", name: `Step ${index + 1} place to click`,
    content: { shape: "rounded" },
    style: { strokeWidth: 6, radius: 8 },
    states: { Shown: { style: { stroke: colorRef("accentStrong") }, announce: "The place to click is now outlined in the picture." } },
    accessibility: { altText: "", role: "presentation", tabOrder: 0, decorative: true },
  };
  const wrongTry = { variable: o.tries, operator: "lessThan" as const, value: TRIES_BEFORE_SHOWN };
  const tooMany = { variable: o.tries, operator: "greaterThanOrEqual" as const, value: TRIES_BEFORE_SHOWN };
  const target: OSObject = {
    ...box(partId(o, "target"), hx.pos, hy.pos, hx.len, hy.len, 60), type: "hotspot", name: `Step ${index + 1} target`,
    content: {}, style: {},
    accessibility: { altText: hotspotName(step), role: "button", tabOrder: 4, decorative: false },
    triggers: writeRules([
      { kind: "rule", rule: rule("hideLayer", "layer-hint") },
      { kind: "rule", rule: rule("hideLayer", "layer-shown") },
      { kind: "rule", rule: rule("showLayer", "layer-right") },
    ], o.newTriggerId),
  };
  const elsewhere: OSObject = {
    ...box(partId(o, "elsewhere"), placed.x, placed.y, placed.width, placed.height, 50), type: "hotspot", name: `Step ${index + 1} anywhere else`,
    content: {}, style: {},
    accessibility: { altText: "Anywhere else on the screen", role: "button", tabOrder: 5, decorative: false },
    triggers: writeRules([
      { kind: "rule", rule: rule("addToVariable", o.tries, { value: 1 }) },
      { kind: "rule", rule: rule("showLayer", "layer-hint", { conditions: [wrongTry] }) },
      { kind: "rule", rule: rule("showLayer", "layer-shown", { conditions: [tooMany] }) },
      { kind: "rule", rule: rule("changeState", frame.id, { value: "Shown", conditions: [tooMany] }) },
    ], o.newTriggerId),
  };
  const showMe = button(o, "showme", "Show me", o.stage.width - f.margin - f.px(170), f.px(24), f.px(170), f.px(52), 70, 6, [rule("changeState", frame.id, { value: "Shown" })], f);
  // Every time the slide opens the count of wrong tries starts again.
  words.triggers = writeRules([{ kind: "rule", rule: { event: "slideStart", action: "setVariable", target: o.tries, value: 0, conditions: [] } }], o.newTriggerId);

  const layers: Layer[] = [
    bannerLayer("layer-hint", "Hint", `Not quite. ${hintFor(step)} Then try again.`, [{ label: "Try again", rules: [rule("hideLayer", "layer-hint")] }], o, f),
    bannerLayer("layer-shown", "Shown", "Not quite. The place to click is now outlined in the picture. Press it to go on.", [{ label: "Close", rules: [rule("hideLayer", "layer-shown")] }], o, f),
    bannerLayer("layer-right", "Right", "That is right. Press Next step to go on.", [{ label: "Next step", rules: [rule("nextSlide", "")] }], o, f),
  ];
  return slideOf(step, index, "Practice", [heading, words, image, frame, elsewhere, target, showMe], layers, o);
}

// ---- typing, for Practice and the Test

function typingSlide(step: Step, index: number, picture: StepPicture | null, o: LessonOptions, f: Frame, lesson: "practice" | "test"): Slide {
  const practice = lesson === "practice";
  const label = practice ? `Try it: step ${index + 1} of ${o.total}` : `Question ${index + 1} of ${o.total}`;
  const [heading, words] = headingAndWords(step, index, o, f, label, f.wide);
  const objects: OSObject[] = [heading!, words!];
  const reserve = f.px(150);
  if (picture !== null) objects.push(pictureObject(step, index, picture, o, fitPicture(f.area(reserve), picture), 3));
  const rightId = "layer-right";
  const wrongId = "layer-wrong";
  const quiz: OSObject = {
    ...box(partId(o, "answer"), f.margin, o.stage.height - f.px(24) - f.px(140), Math.min(f.wide, f.px(760)), f.px(140), 40), type: "quizQuestion", name: `Step ${index + 1} answer`,
    content: {
      questionType: "shortAnswer", answers: [step.typed ?? ""], caseSensitive: true,
      scoring: practice ? { points: 0, attemptsAllowed: TRIES_BEFORE_SHOWN } : { points: 1, attemptsAllowed: 1 },
      feedback: { correct: rightId, incorrect: wrongId },
    },
    style: { fontFamily: "theme:font.body", fontSize: f.px(22), color: colorRef("text") },
    accessibility: { altText: "Type what the step says to type", role: "group", tabOrder: 4, decorative: false },
  };
  objects.push(quiz);
  const layers: Layer[] = practice
    ? [
      bannerLayer(rightId, "Right", "That is right. Press Next step to go on.", [{ label: "Next step", rules: [rule("nextSlide", "")] }], o, f),
      bannerLayer(wrongId, "Wrong", "Not quite. Read the step again, and check the capital letters and the spaces. Then try again.", [{ label: "Try again", rules: [rule("hideLayer", wrongId)] }], o, f),
    ]
    : [
      bannerLayer(rightId, "Correct", "Correct.", [{ label: "Close", rules: [rule("hideLayer", rightId)] }], o, f),
      bannerLayer(wrongId, "Not correct", "That is not correct.", [{ label: "Close", rules: [rule("hideLayer", wrongId)] }], o, f),
    ];
  return slideOf(step, index, practice ? "Practice" : "Test", objects, layers, o);
}

// ---- the Test

/** The areas offered with the place to click in a Test question: the cells of a three by three grid that the place does not touch, nearest first, at most four. */
export function otherAreas(b: Box): { label: string; x: number; y: number; width: number; height: number }[] {
  const names = [["Top left", "Top middle", "Top right"], ["Middle left", "Middle", "Middle right"], ["Bottom left", "Bottom middle", "Bottom right"]];
  const third = 100 / 3;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const cells = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const cell = { label: names[row]![col]!, x: Math.round(col * third * 100) / 100, y: Math.round(row * third * 100) / 100, width: Math.round(third * 100) / 100, height: Math.round(third * 100) / 100 };
      const touches = b.x < cell.x + cell.width && b.x + b.width > cell.x && b.y < cell.y + cell.height && b.y + b.height > cell.y;
      if (!touches) cells.push({ cell, distance: Math.hypot(cx - (cell.x + cell.width / 2), cy - (cell.y + cell.height / 2)) });
    }
  }
  const nearest = cells.sort((p, q) => p.distance - q.distance).slice(0, 4).map((c) => c.cell);
  if (nearest.length > 0) return nearest;
  // A place that touches every cell: use the biggest strip of the picture round it.
  const strips = [
    { label: "Above the place", x: 0, y: 0, width: 100, height: b.y },
    { label: "Below the place", x: 0, y: b.y + b.height, width: 100, height: 100 - b.y - b.height },
    { label: "Left of the place", x: 0, y: 0, width: b.x, height: 100 },
    { label: "Right of the place", x: b.x + b.width, y: 0, width: 100 - b.x - b.width, height: 100 },
  ].filter((s) => s.width >= 2 && s.height >= 2).sort((p, q) => q.width * q.height - p.width * p.height);
  return strips.slice(0, 1);
}

/** The slide of the Test lesson for a step. A step with nothing to test is shown as in the Watch lesson. */
export function buildTestSlide(step: Step, index: number, picture: StepPicture | null, o: LessonOptions): Slide {
  const f = frameOf(step, o);
  if (step.kind === "type" && step.typed !== null && step.typed !== "") return typingSlide(step, index, picture, o, f, "test");
  if (picture === null || step.box === null || step.target === null) return buildStepSlide(step, index, picture, { ...o, namePrefix: "Test" });
  const decoys = otherAreas(step.box);
  if (decoys.length === 0) return buildStepSlide(step, index, picture, { ...o, namePrefix: "Test" });

  const label = `Question ${index + 1} of ${o.total}`;
  const [heading, words] = headingAndWords(step, index, o, f, label, f.wide);
  const area = f.area();
  const right = { id: "r1", label: `${placeWords(step.box)} of the picture`, x: step.box.x, y: step.box.y, width: step.box.width, height: step.box.height, correct: true };
  const regions = [right, ...decoys.map((d, i) => ({ id: `r${i + 2}`, label: `${d.label} of the picture`, x: d.x, y: d.y, width: d.width, height: d.height, correct: false }))];
  const quiz: OSObject = {
    ...box(partId(o, "question"), area.x, area.y, area.width, area.height, 40), type: "quizQuestion", name: `Step ${index + 1} question`,
    content: {
      questionType: "hotspot", image: { src: picture.path, alt: step.reviewed ? step.alt.trim() : "" }, regions,
      scoring: { points: 1, attemptsAllowed: 1 }, feedback: { correct: "layer-right", incorrect: "layer-wrong" },
    },
    style: { fontFamily: "theme:font.body", fontSize: f.px(20), color: colorRef("text") },
    accessibility: { altText: "Choose where to click in the picture", role: "group", tabOrder: 3, decorative: false },
  };
  const layers: Layer[] = [
    bannerLayer("layer-right", "Correct", "Correct.", [{ label: "Close", rules: [rule("hideLayer", "layer-right")] }], o, f),
    bannerLayer("layer-wrong", "Not correct", "That is not correct.", [{ label: "Close", rules: [rule("hideLayer", "layer-wrong")] }], o, f),
  ];
  return slideOf(step, index, "Test", [heading!, words!, quiz], layers, o);
}

/** The builder for a lesson. */
export function buildLessonSlide(lesson: Lesson, step: Step, index: number, picture: StepPicture | null, o: LessonOptions): Slide {
  return lesson === "practice" ? buildPracticeSlide(step, index, picture, o) : lesson === "test" ? buildTestSlide(step, index, picture, o) : buildStepSlide(step, index, picture, o);
}
