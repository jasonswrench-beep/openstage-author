// An interactive video: a video on a slide with things that happen at moments in it. This file builds those things out of what the course format already
// has, and gives the editor what it needs to list them and take them away; nothing here touches a project (the Model puts what is built into the slide).
//
// There are four kinds of moment. Each is a handful of ordinary objects tied to the video by its timing (`appear: "media"`, which follows the clip's own
// time) and by rules, so a published course needs no new player for them, and each can be changed afterwards in the editor like anything else:
//
//   question   a multiple choice question over the picture at a time; the clip is held (`timing.pauseMedia`, 0.51.0) until it is answered and the learner
//              presses Continue, which plays the clip again. One try, so there is no way to go round a wrong answer without going on.
//   hotspot    a part of the picture a learner can press for a time, which pauses the clip and shows a note; Close plays it again.
//   chapters   a row of buttons under the video, each moving the clip to a moment (the seekMedia action, 0.51.0) and playing it.
//   choice     what to do next: at a time (the clip is held) or when the video ends, buttons that each go to a slide, which is how a video branches.
//
// What a moment is made of is marked by a `group` tag (`vm-<kind>-<number>`), which is how it is found again, moved together and taken away whole.

import type { Layer, OSObject, Trigger } from "../../player/src/types.ts";
import { colorRef } from "../../player/src/theme.ts";
import { box, buildQuiz, emptyLayer, type Alloc } from "./factory.ts";
import { fillQuiz } from "./questionfill.ts";
import type { ImportedQuestion } from "./questionimport.ts";

export type MomentKind = "question" | "hotspot" | "chapter" | "choice";

/** What the editor asks the Model to add: one of the four kinds, with what it needs (the kind comes first). */
export type VideoMomentSpec =
  | ({ kind: "question" } & QuestionMoment)
  | ({ kind: "hotspot" } & HotspotMoment)
  | ({ kind: "choice" } & ChoiceMoment)
  | { kind: "chapter"; chapters: Chapter[]; problems: string[] };

export const MOMENT_WORDS: Record<MomentKind, string> = { question: "Question", hotspot: "Hotspot", chapter: "Chapter", choice: "Choice" };

/** How long, in the clip's own time, a held moment stays in the picture after it comes in, so it is still there while the clip waits. */
const HOLD_MS = 500;
const MAX_MS = 3_600_000;

// ---- time

/** "1:20", "01:20", "1:02:03", "80" and "80.5" (seconds) as milliseconds, or null if it is not a time up to an hour. */
export function parseTime(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const parts = t.split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  const seconds = parts.reduce((total, p) => total * 60 + Number(p), 0);
  const ms = Math.round(seconds * 1000);
  return Number.isFinite(ms) && ms >= 0 && ms <= MAX_MS ? ms : null;
}

/** A time as minutes and seconds ("1:20"), with hours when there are any. */
export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** A time said in words for a screen reader: "1 minute 20 seconds". */
export function timeInWords(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (m === 0) return part(s, "second");
  return s === 0 ? part(m, "minute") : `${part(m, "minute")} ${part(s, "second")}`;
}

// ---- the video, and what is tied to it

export interface VideoBox { id: string; x: number; y: number; width: number; height: number; z: number }

export const videoBox = (o: OSObject): VideoBox => ({ id: o.id, x: o.geometry.x, y: o.geometry.y, width: o.geometry.width, height: o.geometry.height, z: o.geometry.z });

const follow = (video: VideoBox, atMs: number, forMs: number | null, pause: boolean): OSObject["timing"] =>
  ({ appear: "media", media: video.id, start: atMs, visibleFor: forMs, ...(pause ? { pauseMedia: true } : {}) });

/** Click and keyboard do the same things, in order, as everywhere else: a control made here is never mouse-only. */
function pressing(...steps: { action: Trigger["action"]; target: string; value?: number }[]): Trigger[] {
  const out: Trigger[] = [];
  let n = 0;
  for (const event of ["click", "keyActivate"] as const) {
    for (const s of steps) {
      out.push({ id: `trg-${String(++n).padStart(4, "0")}`, event, action: s.action, target: s.target, ...(s.value !== undefined ? { value: s.value } : {}), conditions: [] });
    }
  }
  return out;
}

const textOf = (alloc: Alloc, x: number, y: number, w: number, h: number, z: number, name: string, html: string, tab: number, size = 22): OSObject => ({
  ...box(alloc.object(), x, y, w, h, z), type: "text", name,
  content: { html },
  // Words over a picture sit on a fill of their own, so they can be read over anything and the checker can judge them against it.
  style: { fontFamily: "theme:font.body", fontSize: size, color: colorRef("text"), fill: colorRef("surface") },
  accessibility: { altText: name, role: "paragraph", tabOrder: tab, decorative: false },
});

const buttonOf = (alloc: Alloc, x: number, y: number, w: number, h: number, z: number, label: string, triggers: Trigger[], tab: number): OSObject => ({
  ...box(alloc.object(), x, y, w, h, z), type: "button", name: label,
  content: { label },
  style: { fontFamily: "theme:font.body", fontSize: 18, color: colorRef("onAccentStrong"), fill: colorRef("accentStrong"), radius: 8 },
  accessibility: { altText: label, role: "button", tabOrder: tab, decorative: false },
  triggers,
});

/** A plain panel behind a moment's words, so they can be read over any picture. It is decoration. */
const panelOf = (alloc: Alloc, x: number, y: number, w: number, h: number, z: number): OSObject => ({
  ...box(alloc.object(), x, y, w, h, z), type: "shape", name: "Panel",
  content: { shape: "rounded" },
  style: { fill: colorRef("surface"), radius: 12 },
  accessibility: { altText: "", role: "presentation", tabOrder: 0, decorative: true },
});

const html = (s: string): string => `<p>${s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
const heading = (s: string): string => `<h2>${s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</h2>`;
const snippet = (s: string, n = 40): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export interface Built {
  /** What goes in the slide's own layer, in order. */
  objects: OSObject[];
  /** Layers the objects open (feedback, a note, the choices at the end). */
  layers: Layer[];
  /** What to say to the author. */
  said: string;
  /** A trigger to add to the video itself (the choices at its end), or null. */
  onVideo: Trigger | null;
}

const empty = (): Pick<Built, "layers" | "onVideo"> => ({ layers: [], onVideo: null });

// ---- a question

export interface QuestionMoment {
  atMs: number;
  question: string;
  /** The answers to choose from, at least two. */
  answers: string[];
  /** The position of the right one in `answers`, from 0. */
  correct: number;
  right?: string;
  wrong?: string;
}

/** Why a question moment cannot be built, or null. */
export function questionProblem(q: QuestionMoment): string | null {
  if (q.atMs < 0 || q.atMs > MAX_MS) return "The time has to be within the hour.";
  if (q.question.trim() === "") return "Write the question.";
  const answers = q.answers.map((a) => a.trim()).filter((a) => a !== "");
  if (answers.length < 2) return "A question needs at least two answers.";
  if (answers.length > 6) return "A question over a video can have up to six answers.";
  if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.answers.length || q.answers[q.correct]!.trim() === "") return "Say which answer is right.";
  return null;
}

export function buildQuestionMoment(video: VideoBox, q: QuestionMoment, alloc: Alloc, tab: number, tag: string): Built {
  const answers = q.answers.map((a) => a.trim()).filter((a) => a !== "");
  const correct = answers.indexOf(q.answers[q.correct]!.trim());
  const built = buildQuiz("mc", alloc, { y: 0, z: video.z + 10, tab, tone: "light" });
  const asked: ImportedQuestion = { row: 1, type: "mc", question: q.question.trim(), answers, correct: [correct], points: 10, attempts: 1, category: "", value: null, rightFeedback: q.right ?? "", wrongFeedback: q.wrong ?? "" };
  fillQuiz(built, asked, { points: 10, attempts: 1, shuffleAnswers: false, right: "Correct.", wrong: "Not quite." });
  const [prompt, quiz] = built.objects as [OSObject, OSObject];
  const [rightLayer, wrongLayer] = built.layers as [Layer, Layer];
  const pad = Math.max(16, Math.round(video.width * 0.04));
  const w = video.width - 2 * pad;
  prompt.geometry = { ...prompt.geometry, x: video.x + pad, y: video.y + pad, width: w, height: 80, z: video.z + 11 };
  quiz.geometry = { ...quiz.geometry, x: video.x + pad, y: video.y + pad + 92, width: w, height: Math.max(quiz.geometry.height, 80 + 48 * answers.length) };
  quiz.geometry.z = video.z + 12;
  prompt.style = { ...prompt.style, fill: colorRef("surface"), color: colorRef("text") };
  quiz.style = { ...quiz.style, fill: colorRef("surface"), color: colorRef("text") };
  const panel = panelOf(alloc, video.x + pad / 2, video.y + pad / 2, video.width - pad, quiz.geometry.y - video.y + quiz.geometry.height, video.z + 10);
  const objects = [panel, prompt, quiz];
  objects.forEach((o, i) => { o.timing = follow(video, q.atMs, HOLD_MS, true); o.group = tag; if (o.accessibility.tabOrder !== 0) o.accessibility.tabOrder = tab + i; });
  // Each feedback ends with a Continue that plays the video again. A feedback is shown over the picture, so it has a panel of its own.
  for (const layer of [rightLayer, wrongLayer]) {
    const text = layer.objects[0]!;
    text.geometry = { ...text.geometry, x: video.x + pad, y: video.y + pad, width: w, height: 90, z: video.z + 41 };
    text.style = { ...text.style, fill: colorRef("surface") };
    layer.objects.unshift(panelOf(alloc, video.x + pad / 2, video.y + pad / 2, video.width - pad, 190, video.z + 40));
    layer.objects.push(buttonOf(alloc, video.x + pad, video.y + pad + 100, 220, 56, video.z + 42, "Continue the video", pressing({ action: "hideLayer", target: layer.id }, { action: "playMedia", target: video.id }), 2));
  }
  prompt.name = `Question at ${formatTime(q.atMs)}`;
  quiz.name = `Answers at ${formatTime(q.atMs)}`;
  return { objects, layers: [rightLayer, wrongLayer], said: `Added a question at ${timeInWords(q.atMs)}. The video waits for the answer, and goes on when the learner presses Continue.`, onVideo: null };
}

// ---- a hotspot

export interface HotspotMoment {
  atMs: number;
  /** How long the hotspot stays, in the clip's time. */
  forMs: number;
  /** What it is called: the name a screen reader gives it, so it says what pressing it shows. */
  label: string;
  /** What pressing it shows. */
  text: string;
  /** Where it is on the picture, as percentages of the video's width and height. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export function hotspotProblem(h: HotspotMoment): string | null {
  if (h.atMs < 0 || h.atMs > MAX_MS) return "The time has to be within the hour.";
  if (!Number.isInteger(h.forMs) || h.forMs < 1000) return "A hotspot has to stay for at least a second, or no one can press it.";
  if (h.label.trim() === "") return "Name the hotspot: it is what a screen reader says.";
  if (h.text.trim() === "") return "Write what pressing it shows.";
  for (const [k, v] of [["left", h.x], ["top", h.y], ["width", h.w], ["height", h.h]] as const) if (!Number.isFinite(v) || v < 0 || v > 100) return `The ${k} is a percentage, from 0 to 100.`;
  if (h.w < 5 || h.h < 5) return "A hotspot has to be at least 5 percent wide and high, or it is too small to press.";
  if (h.x + h.w > 100.0001 || h.y + h.h > 100.0001) return "The hotspot goes past the edge of the picture.";
  return null;
}

export function buildHotspotMoment(video: VideoBox, h: HotspotMoment, alloc: Alloc, tab: number, tag: string): Built {
  const layer = emptyLayer(alloc.layer(), `Note: ${snippet(h.label, 30)}`);
  const pad = Math.max(16, Math.round(video.width * 0.04));
  layer.objects.push(
    panelOf(alloc, video.x + pad / 2, video.y + pad / 2, video.width - pad, 220, video.z + 40),
    textOf(alloc, video.x + pad, video.y + pad, video.width - 2 * pad, 100, video.z + 41, `Note: ${snippet(h.label, 30)}`, html(h.text.trim()), 1),
    buttonOf(alloc, video.x + pad, video.y + pad + 120, 200, 56, video.z + 42, "Close the note", pressing({ action: "hideLayer", target: layer.id }, { action: "playMedia", target: video.id }), 2),
  );
  const spot: OSObject = {
    ...box(alloc.object(), Math.round(video.x + (video.width * h.x) / 100), Math.round(video.y + (video.height * h.y) / 100), Math.round((video.width * h.w) / 100), Math.round((video.height * h.h) / 100), video.z + 5),
    type: "hotspot", name: h.label.trim(), content: {},
    style: { stroke: colorRef("accentStrong"), strokeWidth: 3, radius: 8 },
    accessibility: { altText: h.label.trim(), role: "button", tabOrder: tab, decorative: false },
    triggers: pressing({ action: "pauseMedia", target: video.id }, { action: "showLayer", target: layer.id }),
  };
  spot.timing = follow(video, h.atMs, h.forMs, false);
  spot.group = tag;
  // The label sits under the part of the picture, so a learner who sees knows what it is; it is the same words the hotspot is named by.
  const label = textOf(alloc, spot.geometry.x, Math.min(video.y + video.height - 40, spot.geometry.y + spot.geometry.height + 4), Math.max(160, spot.geometry.width), 36, video.z + 6, h.label.trim(), html(h.label.trim()), 0, 16);
  label.accessibility = { altText: "", role: "presentation", tabOrder: 0, decorative: true };
  label.style = { ...label.style, fill: colorRef("surface"), color: colorRef("text") };
  label.timing = follow(video, h.atMs, h.forMs, false);
  label.group = tag;
  return { objects: [spot, label], layers: [layer], said: `Added a hotspot called ${h.label.trim()} from ${timeInWords(h.atMs)} for ${timeInWords(h.forMs)}.`, onVideo: null };
}

// ---- chapters

export interface Chapter { title: string; atMs: number }

/** "0:00 Introduction" and "1:20 The first rule" lines as chapters. A line that is not a time and a title is named. */
export function parseChapters(text: string): { chapters: Chapter[]; problems: string[] } {
  const chapters: Chapter[] = [];
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line === "") return;
    const m = /^(\d+(?::\d+){0,2}(?:\.\d+)?)\s+(.+)$/.exec(line);
    const at = m ? parseTime(m[1]!) : null;
    if (!m || at === null) { problems.push(`Line ${i + 1} ("${snippet(line, 30)}") should be a time and then a title, such as 1:20 The first rule.`); return; }
    chapters.push({ title: m[2]!.trim(), atMs: at });
  });
  if (chapters.length > 12) problems.push("A video can have up to 12 chapters.");
  if (chapters.length === 1) problems.push("A chapter menu needs at least two chapters.");
  return { chapters: chapters.sort((a, b) => a.atMs - b.atMs), problems };
}

export function chaptersAsText(chapters: Chapter[]): string {
  return chapters.map((c) => `${formatTime(c.atMs)} ${c.title}`).join("\n");
}

export function buildChapters(video: VideoBox, chapters: Chapter[], alloc: Alloc, tab: number, tag: string): Built {
  const perRow = Math.max(1, Math.min(4, chapters.length));
  const gap = 12;
  const w = Math.floor((video.width - gap * (perRow - 1)) / perRow);
  const objects = chapters.map((c, i) => {
    const label = `${formatTime(c.atMs)} ${c.title}`;
    const button = buttonOf(alloc, video.x + (i % perRow) * (w + gap), video.y + video.height + 16 + Math.floor(i / perRow) * 64, w, 52, video.z + 1, label, pressing({ action: "seekMedia", target: video.id, value: c.atMs }, { action: "playMedia", target: video.id }), tab + i);
    button.name = `Chapter: ${label}`;
    button.group = tag;
    return button;
  });
  return { objects, ...empty(), said: chapters.length === 0 ? "The video has no chapters now." : `The video has ${chapters.length === 1 ? "one chapter" : `${chapters.length} chapters`}, as buttons under it. Each moves the video to its time and plays it.` };
}

// ---- a choice

export interface ChoiceMoment {
  /** When it comes in, or null for when the video ends. */
  atMs: number | null;
  prompt: string;
  /** Each choice and the slide it goes to. */
  choices: { label: string; slideId: string }[];
}

export function choiceProblem(c: ChoiceMoment, slideIds: string[]): string | null {
  if (c.atMs !== null && (c.atMs < 0 || c.atMs > MAX_MS)) return "The time has to be within the hour.";
  if (c.prompt.trim() === "") return "Write what the learner is asked.";
  const labelled = c.choices.filter((x) => x.label.trim() !== "");
  if (labelled.length < 2) return "A choice needs at least two ways to go.";
  if (labelled.length > 4) return "A choice can have up to four ways to go.";
  if (labelled.some((x) => !slideIds.includes(x.slideId))) return "Each way to go needs a slide to go to.";
  return null;
}

export function buildChoiceMoment(video: VideoBox, c: ChoiceMoment, alloc: Alloc, tab: number, tag: string): Built {
  const choices = c.choices.filter((x) => x.label.trim() !== "");
  const pad = Math.max(16, Math.round(video.width * 0.04));
  const w = video.width - 2 * pad;
  // The choices for the end are on a layer of their own, which has its own tab order from 1.
  if (c.atMs === null) tab = 1;
  const items: OSObject[] = [
    panelOf(alloc, video.x + pad / 2, video.y + pad / 2, video.width - pad, 120 + 64 * choices.length, video.z + 40),
    textOf(alloc, video.x + pad, video.y + pad, w, 90, video.z + 41, `Choice at ${c.atMs === null ? "the end" : formatTime(c.atMs)}`, html(c.prompt.trim()), tab),
    ...choices.map((x, i) => buttonOf(alloc, video.x + pad, video.y + pad + 100 + i * 64, w, 52, video.z + 42, x.label.trim(), pressing({ action: "jumpToSlide", target: x.slideId }), tab + 1 + i)),
  ];
  for (const o of items) o.group = tag;
  if (c.atMs === null) {
    const layer = emptyLayer(alloc.layer(), "Choices at the end");
    items.forEach((o) => { o.geometry = { ...o.geometry, z: o.geometry.z }; });
    layer.objects.push(...items);
    return { objects: [], layers: [layer], said: `Added a choice for when the video ends: ${choices.length} ways to go.`, onVideo: { id: "trg-0900", event: "mediaComplete", action: "showLayer", target: layer.id, conditions: [] } };
  }
  for (const o of items) o.timing = follow(video, c.atMs, HOLD_MS, true);
  return { objects: items, ...empty(), said: `Added a choice at ${timeInWords(c.atMs)}. The video waits while the learner chooses.` };
}

// ---- finding them again

export interface Moment {
  tag: string;
  kind: MomentKind;
  /** When it comes in, or null for the end of the video. */
  atMs: number | null;
  /** What to call it in a list. */
  label: string;
  /** The layer its objects are on, or null for the slide's own. */
  layerId: string | null;
}

const TAG = /^vm-(question|hotspot|chapter|choice)-(\d+)$/;

/** The moments tied to a video, in the order of their times (chapters together, at their first time; a choice at the end last). */
export function momentsOf(slide: { baseLayer: Layer; layers: Layer[] }, videoId: string): Moment[] {
  const seen = new Map<string, Moment>();
  for (const layer of [slide.baseLayer, ...slide.layers]) {
    for (const o of layer.objects) {
      const m = o.group ? TAG.exec(o.group) : null;
      if (!m) continue;
      const kind = m[1] as MomentKind;
      const follows = o.timing.appear === "media" && o.timing.media === videoId;
      const seeks = kind === "chapter" && o.triggers.some((t) => t.action === "seekMedia" && t.target === videoId);
      const atEnd = kind === "choice" && layer !== slide.baseLayer && layer.objects.some((x) => x.group === o.group);
      if (!follows && !seeks && !atEnd) continue;
      if (kind === "chapter") {
        const existing = [...seen.values()].find((x) => x.kind === "chapter");
        const at = o.triggers.find((t) => t.action === "seekMedia")?.value;
        const atMs = typeof at === "number" ? at : 0;
        if (existing) { existing.atMs = Math.min(existing.atMs ?? atMs, atMs); continue; }
        seen.set(o.group!, { tag: o.group!, kind, atMs, label: "Chapters", layerId: null });
        continue;
      }
      if (seen.has(o.group!)) continue;
      const label = o.type === "text" || o.type === "hotspot" || (kind === "question" && o.name.startsWith("Question")) ? o.name : "";
      seen.set(o.group!, { tag: o.group!, kind, atMs: atEnd ? null : o.timing.start, label: label || MOMENT_WORDS[kind], layerId: layer === slide.baseLayer ? null : layer.id });
    }
  }
  return [...seen.values()].sort((a, b) => (a.atMs ?? Infinity) - (b.atMs ?? Infinity) || a.tag.localeCompare(b.tag));
}

/** The next tag of a kind that no object on the slide has. */
export function nextTag(slide: { baseLayer: Layer; layers: Layer[] }, kind: MomentKind): string {
  let n = 0;
  for (const layer of [slide.baseLayer, ...slide.layers]) for (const o of layer.objects) {
    const m = o.group ? TAG.exec(o.group) : null;
    if (m && m[1] === kind) n = Math.max(n, Number(m[2]));
  }
  return `vm-${kind}-${String(n + 1).padStart(4, "0")}`;
}

/** The ids of the layers a set of objects opens or is answered in: where their feedback, note or choices are. */
export function layersOpenedBy(objects: OSObject[]): string[] {
  const ids = new Set<string>();
  for (const o of objects) {
    for (const t of o.triggers) if (t.action === "showLayer") ids.add(t.target);
    if (o.type === "quizQuestion") { const f = (o.content as { feedback?: Record<string, string> }).feedback; for (const v of Object.values(f ?? {})) ids.add(v); }
  }
  return [...ids];
}

