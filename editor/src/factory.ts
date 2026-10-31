// What new things look like when first added: objects, slides, layers, quiz questions and the
// built-in slide layouts. Everything a person must write themselves (alt text for an image) is
// left empty so the validator flags it. Nothing is invented on their behalf.

import type { IconContent } from "../../player/src/types.ts";
import { TIMER_DEFAULT } from "../../player/src/timer.ts";
import type { CertificateContent, DownloadContent, EmbedContent, InputContent, InteractionContent, InteractionItem, Layer, OSObject, QuizContent, ResultsContent, ScenarioContent, Slide, TableContent } from "../../player/src/types.ts";
import { QUIZ_KINDS, quizKind, startingQuestion, type QuizType } from "./questionedit.ts";
import type { InputKind } from "../../player/src/inputs.ts";
import { colorRef, isThemeRef } from "../../player/src/theme.ts";
import { BLOCK_SIZES, buildActivation, buildSimpleText, parseSimpleText, type Activation } from "./content.ts";

export type NewKind = "text" | "button" | "hotspot" | "shape" | "image" | "table" | "scrollingText" | "results" | "certificate";

/** What a slide sits on, which decides what colour text on it should be. */
export type Tone = "light" | "dark" | "accent";

/** The tone of a slide background value: the theme's default, its dark or accent background, or a plain colour. */
export function toneOf(background: string | null, lightnessOf?: (hex: string) => boolean): Tone {
  if (background === "theme:bg.dark") return "dark";
  if (background === "theme:bg.accent") return "accent";
  if (background && /^#[0-9a-fA-F]{6}$/.test(background) && lightnessOf) return lightnessOf(background) ? "light" : "dark";
  return "light";
}

/** The theme colour for ordinary or quiet text on a slide of this tone. */
export const textRole = (tone: Tone, muted = false): "text" | "muted" | "onDark" | "onAccentStrong" =>
  tone === "dark" ? "onDark" : tone === "accent" ? "onAccentStrong" : muted ? "muted" : "text";

/** What the Add menu offers. A value is "kind", "shape:<name>" or "quiz:<type>". */
export const NEW_OPTIONS: { value: string; label: string }[] = [
  { value: "text", label: "Text box" },
  { value: "button", label: "Button" },
  { value: "image", label: "Image..." },
  { value: "shape:rectangle", label: "Shape: rectangle" },
  { value: "shape:rounded", label: "Shape: rounded rectangle" },
  { value: "shape:ellipse", label: "Shape: ellipse" },
  { value: "shape:triangle", label: "Shape: triangle" },
  { value: "shape:diamond", label: "Shape: diamond" },
  { value: "shape:arrow", label: "Shape: arrow" },
  { value: "shape:line", label: "Shape: line" },
  { value: "bubble:text-speech", label: "Bubble: speech, with words" },
  { value: "bubble:text-thought", label: "Bubble: thought, with words" },
  { value: "bubble:shape-speech", label: "Bubble: speech, empty" },
  { value: "bubble:shape-thought", label: "Bubble: thought, empty" },
  { value: "content:table", label: "Content: table" },
  { value: "content:scrollingText", label: "Content: scrolling text" },
  ...QUIZ_KINDS.map((k) => ({ value: `quiz:${k.id}`, label: `Quiz question: ${k.label}` })),
];

/** What an Add menu value "bubble:<how>-<which>" asks for: words to type in (`text`) or an empty bubble (`shape`), a speech or a thought bubble. */
export function bubbleChoice(value: string): { how: "text" | "shape"; which: "speech" | "thought" } | null {
  const m = /^bubble:(text|shape)-(speech|thought)$/.exec(value);
  return m ? { how: m[1] as "text" | "shape", which: m[2] as "speech" | "thought" } : null;
}

/** Ids for new objects and layers that no one else is using. */
export interface Alloc {
  object(): string;
  layer(): string;
}

export function emptySlide(id: string, name: string): Slide {
  return { id, name, duration: null, layout: null, background: null, baseLayer: { id: "layer-base", name: "Base", objects: [] }, layers: [] };
}

export function emptyLayer(id: string, name: string): Layer {
  return { id, name, objects: [] };
}

export interface Placement {
  id: string;
  /** What the slide sits on. Text added to a dark slide is light. */
  tone?: Tone;
  /** How many objects the layer already has, used to stagger new ones so they do not stack exactly. */
  count: number;
  z: number;
  tabOrder: number;
}

interface NewOptions {
  imageSrc?: string;
  size?: { w: number; h: number };
  /** For a shape: rectangle, rounded, ellipse, triangle, diamond, arrow, line, speech or thought. */
  shape?: string;
  /** For text: put the words in a speech or thought bubble. */
  bubble?: "speech" | "thought";
}

/** What a bubble looks like when it is first made, or when a text box is made into one: the theme's panel colour with a quiet outline, so it reads well on any slide
 *  and keeps reading well when the theme changes. The words are in the theme's text colour, which goes with the panel colour. */
export const BUBBLE_LOOK = { fill: colorRef("surface"), stroke: colorRef("muted"), strokeWidth: 2 };
export const BUBBLE_TEXT_COLOR = colorRef("text");
export const BUBBLE_NAMES: Record<"speech" | "thought", string> = { speech: "Speech bubble", thought: "Thought bubble" };

/** The parts every object has the same way, with nothing added to it yet. */
export const box = (id: string, x: number, y: number, w: number, h: number, z: number) => ({
  id,
  geometry: { x, y, width: w, height: h, rotation: 0, z },
  states: {},
  triggers: [],
  timing: { appear: "time" as const, start: 0, visibleFor: null },
  animation: { enter: { effect: "none" as const, duration: 500 }, exit: { effect: "none" as const, duration: 500 } },
  narration: null,
  provenance: null,
  simulation: null,
});

const stagger = (p: Placement, x: number, y: number) => ({ x: x + (p.count % 6) * 24, y: y + (p.count % 6) * 24 });

const SHAPE_NAMES: Record<string, string> = {
  rectangle: "Rectangle", rounded: "Rounded rectangle", ellipse: "Ellipse", triangle: "Triangle",
  diamond: "Diamond", arrow: "Arrow", line: "Line", speech: "Speech bubble", thought: "Thought bubble",
};

export function newObject(kind: NewKind, p: Placement, opts: NewOptions = {}): OSObject {
  switch (kind) {
    case "text": {
      const at = stagger(p, 160, 160);
      if (opts.bubble) {
        return {
          ...box(p.id, at.x, at.y, 380, 180, p.z), type: "text", name: BUBBLE_NAMES[opts.bubble],
          content: { html: "<p>New text</p>", bubble: opts.bubble, tail: "left" },
          style: { fontFamily: "theme:font.body", fontSize: BLOCK_SIZES.p, color: BUBBLE_TEXT_COLOR, textAlign: "center", ...BUBBLE_LOOK },
          accessibility: { altText: "New text", role: "paragraph", tabOrder: p.tabOrder, decorative: false },
        };
      }
      return {
        ...box(p.id, at.x, at.y, 600, 60, p.z), type: "text", name: "Text box",
        content: { html: "<p>New text</p>" },
        style: { fontFamily: "theme:font.body", fontSize: BLOCK_SIZES.p, color: colorRef(textRole(p.tone ?? "light")) },
        accessibility: { altText: "New text", role: "paragraph", tabOrder: p.tabOrder, decorative: false },
      };
    }
    case "button": {
      const at = stagger(p, 160, 260);
      return {
        ...box(p.id, at.x, at.y, 200, 56, p.z), type: "button", name: "Button",
        content: { label: "Button" },
        style: { fontFamily: "theme:font.body", fontSize: 18, color: colorRef("onAccentStrong"), fill: colorRef("accentStrong"), radius: 8 },
        accessibility: { altText: "Button", role: "button", tabOrder: p.tabOrder, decorative: false },
      };
    }
    case "hotspot": {
      // A transparent button to put over a picture. Its name starts empty, so the validator asks the author for it: what pressing it does.
      const at = stagger(p, 300, 300);
      return {
        ...box(p.id, at.x, at.y, 200, 100, p.z), type: "hotspot", name: "Hotspot",
        content: {},
        style: {},
        accessibility: { altText: "", role: "button", tabOrder: p.tabOrder, decorative: false },
      };
    }
    case "shape": {
      const which = opts.shape ?? "rectangle";
      const isLine = which === "line";
      const isBubble = which === "speech" || which === "thought";
      const at = stagger(p, 160, 360);
      return {
        ...box(p.id, at.x, at.y, isLine ? 400 : isBubble ? 320 : 200, isLine ? 6 : isBubble ? 160 : 120, p.z), type: "shape", name: SHAPE_NAMES[which] ?? "Shape",
        content: isBubble ? { shape: which, tail: "left" } : { shape: isLine ? "rectangle" : which },
        style: isBubble ? { ...BUBBLE_LOOK } : { fill: colorRef("surface") },
        accessibility: { altText: "", role: "presentation", tabOrder: 0, decorative: true },
      };
    }
    case "table": {
      const at = stagger(p, 160, 200);
      const content: TableContent = {
        caption: "",
        headerRow: true,
        headerColumn: false,
        rows: [["Heading 1", "Heading 2", "Heading 3"], ["Cell", "Cell", "Cell"], ["Cell", "Cell", "Cell"]],
      };
      return {
        ...box(p.id, at.x, at.y, 760, 240, p.z), type: "table", name: "Table",
        content: content as unknown as Record<string, unknown>,
        style: { fontFamily: "theme:font.body", fontSize: 18 },
        // The name a screen reader gives the table. Left empty so the validator asks the author for one.
        accessibility: { altText: "", role: "table", tabOrder: p.tabOrder, decorative: false },
      };
    }
    case "scrollingText": {
      const at = stagger(p, 160, 200);
      return {
        ...box(p.id, at.x, at.y, 640, 220, p.z), type: "scrollingText", name: "Scrolling text",
        content: { html: "<p>Write the text here. When it is longer than the box, the box scrolls.</p>" },
        style: { fontFamily: "theme:font.body", fontSize: 18 },
        accessibility: { altText: "", role: "region", tabOrder: p.tabOrder, decorative: false },
      };
    }
    case "results": {
      const at = stagger(p, 160, 200);
      const content: ResultsContent = { heading: "Your results", passMessage: "Well done.", failMessage: "You can go back and review the lesson.", review: true };
      return {
        ...box(p.id, at.x, at.y, 760, 340, p.z), type: "results", name: "Results",
        content: content as unknown as Record<string, unknown>,
        style: { fontFamily: "theme:font.body", fontSize: 20 },
        // The name a screen reader gives the box. Left empty so the validator asks the author for one.
        accessibility: { altText: "", role: "region", tabOrder: p.tabOrder, decorative: false },
      };
    }
    case "certificate": {
      const at = stagger(p, 160, 160);
      const content: CertificateContent = { title: "Certificate of achievement", statement: "This certifies that", achievement: "has successfully completed", issuedBy: "", showScore: true, showDate: true };
      return {
        ...box(p.id, at.x, at.y, 800, 420, p.z), type: "certificate", name: "Certificate",
        content: content as unknown as Record<string, unknown>,
        style: { fontFamily: "theme:font.body", fontSize: 20 },
        accessibility: { altText: "", role: "region", tabOrder: p.tabOrder, decorative: false },
      };
    }
    case "image": {
      const size = opts.size;
      const fit = Math.min(1, 640 / (size?.w ?? 400), 400 / (size?.h ?? 300));
      const at = stagger(p, 160, 160);
      return {
        ...box(p.id, at.x, at.y, Math.round((size?.w ?? 400) * fit), Math.round((size?.h ?? 300) * fit), p.z), type: "image", name: "Image",
        content: { src: opts.imageSrc ?? "" },
        style: {},
        accessibility: { altText: "", role: "img", tabOrder: p.tabOrder, decorative: false },
      };
    }
  }
}

// ---- quiz questions

export type { QuizType } from "./questionedit.ts";

/**
 * A question, its answers and two feedback layers, wired together. The prompt is a heading so it
 * is a real heading to a screen reader. The first answer starts as the correct one, and the
 * author changes that.
 */
export function buildQuiz(type: QuizType, alloc: Alloc, at: { y: number; z: number; tab: number; tone?: Tone; imageSrc?: string }): { objects: OSObject[]; layers: Layer[] } {
  const tone = at.tone ?? "light";
  const correctLayer = emptyLayer(alloc.layer(), "Correct feedback");
  const wrongLayer = emptyLayer(alloc.layer(), "Incorrect feedback");

  const feedback = (layer: Layer, text: string, color: string): void => {
    layer.objects.push({
      ...box(alloc.object(), 840, at.y + 110, 360, 160, 40), type: "text", name: layer.name,
      content: { html: `<p>${text}</p>` },
      style: { fontFamily: "theme:font.body", fontSize: 18, color },
      accessibility: { altText: text, role: "status", tabOrder: 1, decorative: false },
    });
  };
  // Feedback shows over the slide, so on a dark slide it uses the light text colour instead of green and red.
  feedback(correctLayer, "Correct. Explain why this answer is right.", colorRef(tone === "light" ? "good" : textRole(tone)));
  feedback(wrongLayer, "Not quite. Give a hint, then let the learner try again.", colorRef(tone === "light" ? "bad" : textRole(tone)));

  const kind = quizKind(type)!;

  const prompt: OSObject = {
    ...box(alloc.object(), 80, at.y, 1120, 90, at.z), type: "text", name: "Question",
    content: { html: "<h2>Type your question here</h2>" },
    style: { fontFamily: "theme:font.heading", fontSize: BLOCK_SIZES.h2, color: colorRef(textRole(tone)) },
    accessibility: { altText: "Type your question here", role: "heading", tabOrder: at.tab, decorative: false },
  };
  const quiz: OSObject = {
    ...box(alloc.object(), 80, at.y + 110, kind.size.w, kind.size.h, at.z + 10), type: "quizQuestion", name: kind.name,
    content: {
      ...startingQuestion(type, at.imageSrc),
      scoring: { points: 10, attemptsAllowed: type === "tf" || type === "hotspot" ? 1 : 2 },
      feedback: { correct: correctLayer.id, incorrect: wrongLayer.id },
    },
    style: { fontFamily: "theme:font.body", fontSize: 20, color: colorRef(textRole(tone)) },
    // The name a screen reader gives the group of answers. The question itself is the heading before it.
    accessibility: { altText: kind.alt, role: type === "mc" || type === "tf" ? "radiogroup" : "group", tabOrder: at.tab + 1, decorative: false },
  };
  return { objects: [prompt, quiz], layers: [correctLayer, wrongLayer] };
}

// ---- slide layouts
//
// A layout is data: the places where a title or text goes (slots) and a few decorative shapes.
// The same data builds a new slide, draws the preview in the layout picker, and rearranges an
// existing slide when its layout is changed.

export type Rect = [x: number, y: number, w: number, h: number];

export interface Slot {
  /** "title" takes the slide's heading, "heading" a smaller heading above a block of text, and
   *  "body" any other text. Existing text only moves into a slot of its own kind. */
  kind: "title" | "heading" | "body";
  name: string;
  block: "h1" | "h2" | "h3" | "p";
  text: string;
  rect: Rect;
  size: number;
  /** Quieter text, such as a subtitle or caption. */
  muted?: boolean;
}

export interface Decoration {
  /** "Accent" for a coloured bar. "Picture area" and "Chart area" mark where a picture or an
   *  image of a chart goes: they are decorative, and are replaced by the real image. */
  name: "Accent" | "Picture area" | "Chart area";
  rect: Rect;
  /** A theme colour reference such as "theme:color.accent". */
  fill: string;
}

export interface SlideLayout {
  id: string;
  /** Which heading it sits under in the picker. */
  group: string;
  label: string;
  /** What it is for, in a few words. */
  description: string;
  /** The slide's name when first added. */
  name: string;
  slots: Slot[];
  decorations: Decoration[];
  /** What the slide sits on, which decides the text colour: "light" (the default), "dark" or "accent". */
  tone?: "light" | "dark" | "accent";
  /** The slide's background: "theme:bg.dark" and so on. Omitted for the theme's default. */
  background?: string;
}
export const heading = (name: string, text: string, rect: Rect, size: number, block: Slot["block"] = "h1"): Slot => ({ kind: "title", name, block, text, rect, size });
export const body = (name: string, text: string, rect: Rect, size: number, block: Slot["block"] = "p", muted = false): Slot => ({ kind: "body", name, block, text, rect, size, ...(muted ? { muted } : {}) });
const subhead = (name: string, text: string, rect: Rect, size: number): Slot => ({ kind: "heading", name, block: "h3", text, rect, size });
export const accent = (rect: Rect, fill = colorRef("accent")): Decoration => ({ name: "Accent", rect, fill });

const pictureArea = (rect: Rect): Decoration => ({ name: "Picture area", rect, fill: colorRef("surface") });
const chartArea = (rect: Rect): Decoration => ({ name: "Chart area", rect, fill: colorRef("surface") });
const TITLE: Slot = heading("Title", "Slide title", [80, 48, 1120, 80], 44);
const RULE = accent([80, 136, 160, 6]);

/** Equal columns across the slide, with a gap between. */
const columns = (n: number, y: number, h: number, size: number, words: string[]): Slot[] => {
  const gap = 40;
  const w = Math.floor((1120 - gap * (n - 1)) / n);
  return Array.from({ length: n }, (_, i) => body(`Column ${i + 1}`, words[i] ?? `Add column ${i + 1} here.`, [80 + i * (w + gap), y, w, h], size));
};

export const SLIDE_LAYOUTS: SlideLayout[] = [
  // ---- Basic
  {
    id: "title", group: "Basic", label: "Title Slide", description: "The opening slide: a title and a subtitle.", name: "Title slide",
    slots: [heading("Title", "Course title", [80, 260, 1120, 110], 56), body("Subtitle", "Subtitle or your name", [80, 390, 1120, 60], 28, "p", true)],
    decorations: [accent([80, 230, 160, 8])],
    tone: "dark", background: "theme:bg.dark",
  },
  {
    id: "content", group: "Basic", label: "Title and Content", description: "A title with one large area of text.", name: "Title and content",
    slots: [TITLE, body("Content", "Add your content here.", [80, 170, 1120, 460], 26)],
    decorations: [RULE],
  },
  {
    id: "section", group: "Basic", label: "Section Header", description: "Opens a new section of the course.", name: "Section",
    slots: [heading("Section title", "Section title", [120, 270, 1040, 110], 56), body("Section note", "A line about what this section covers.", [120, 390, 1040, 60], 26, "p", true)],
    decorations: [accent([120, 230, 160, 8], colorRef("onAccentStrong"))],
    tone: "accent", background: "theme:bg.accent",
  },
  {
    id: "two-content", group: "Basic", label: "Two Content", description: "A title with two side-by-side areas of text.", name: "Two content",
    slots: [TITLE, body("Left content", "Add the first column here.", [80, 170, 540, 460], 24), body("Right content", "Add the second column here.", [660, 170, 540, 460], 24)],
    decorations: [RULE],
  },
  {
    id: "comparison", group: "Basic", label: "Comparison", description: "Two headings, each with its own text, to compare two things.", name: "Comparison",
    slots: [
      TITLE,
      subhead("Left heading", "First heading", [80, 160, 540, 60], 30),
      body("Left content", "Add the first side here.", [80, 230, 540, 400], 22),
      subhead("Right heading", "Second heading", [660, 160, 540, 60], 30),
      body("Right content", "Add the second side here.", [660, 230, 540, 400], 22),
    ],
    decorations: [RULE],
  },
  {
    id: "title-only", group: "Basic", label: "Title Only", description: "Just a title, with the rest of the slide free for your own objects.", name: "Title only",
    slots: [TITLE],
    decorations: [RULE],
  },
  { id: "blank", group: "Basic", label: "Blank", description: "An empty slide.", name: "New slide", slots: [], decorations: [] },
  {
    id: "content-caption", group: "Basic", label: "Content with Caption", description: "A large content area, with a title and a short note beside it.", name: "Content with caption",
    slots: [heading("Title", "Title", [80, 60, 400, 120], 36, "h2"), body("Caption", "Add a short description here.", [80, 210, 400, 410], 22), body("Content", "Add your content here.", [540, 60, 660, 570], 26)],
    decorations: [accent([80, 190, 120, 6])],
  },
  {
    id: "picture-caption", group: "Basic", label: "Picture with Caption", description: "Space for a picture, with a title and caption underneath.", name: "Picture with caption",
    slots: [heading("Title", "Title", [80, 520, 1120, 70], 36, "h2"), body("Caption", "Add a caption here.", [80, 595, 1120, 70], 22, "p", true)],
    decorations: [pictureArea([80, 60, 1120, 440])],
  },

  // ---- Columns and grids
  {
    id: "split-60-40", group: "Columns and grids", label: "Two Columns, 60/40", description: "A wide column of text beside a narrower one.", name: "Two columns 60/40",
    slots: [TITLE, body("Left content", "Add the main content here.", [80, 170, 660, 460], 24), body("Right content", "Add the supporting content here.", [780, 170, 420, 460], 22)],
    decorations: [RULE],
  },
  {
    id: "split-70-30", group: "Columns and grids", label: "Two Columns, 70/30", description: "A very wide column of text beside a narrow side note.", name: "Two columns 70/30",
    slots: [TITLE, body("Left content", "Add the main content here.", [80, 170, 780, 460], 24), body("Right content", "Add a side note here.", [900, 170, 300, 460], 22)],
    decorations: [RULE],
  },
  {
    id: "three-columns", group: "Columns and grids", label: "Three Columns", description: "A title with three equal columns of text.", name: "Three columns",
    slots: [TITLE, ...columns(3, 170, 460, 22, ["Add the first column here.", "Add the second column here.", "Add the third column here."])],
    decorations: [RULE],
  },
  {
    id: "four-columns", group: "Columns and grids", label: "Four Columns", description: "A title with four equal columns of text.", name: "Four columns",
    slots: [TITLE, ...columns(4, 170, 460, 22, ["Add the first column here.", "Add the second column here.", "Add the third column here.", "Add the fourth column here."])],
    decorations: [RULE],
  },
  {
    id: "grid", group: "Columns and grids", label: "Grid of Four", description: "A title with four areas of text in two rows.", name: "Grid",
    slots: [
      TITLE,
      body("Grid 1", "Add the first item here.", [80, 170, 540, 210], 22), body("Grid 2", "Add the second item here.", [660, 170, 540, 210], 22),
      body("Grid 3", "Add the third item here.", [80, 420, 540, 210], 22), body("Grid 4", "Add the fourth item here.", [660, 420, 540, 210], 22),
    ],
    decorations: [RULE],
  },

  // ---- Pictures and charts
  {
    id: "picture-text", group: "Pictures and charts", label: "Picture and Text", description: "A picture or screenshot on one side, with a title and text on the other.", name: "Picture and text",
    slots: [heading("Title", "Title", [690, 60, 510, 120], 36, "h2"), body("Content", "Add your content here.", [690, 200, 510, 440], 24)],
    decorations: [pictureArea([80, 60, 560, 600])],
  },
  {
    id: "text-chart", group: "Pictures and charts", label: "Text and Chart", description: "Text on one side and a chart on the other.", name: "Text and chart",
    slots: [TITLE, body("Content", "Explain what the chart shows.", [80, 170, 480, 460], 24)],
    decorations: [RULE, chartArea([600, 170, 600, 460])],
  },
  {
    id: "chart", group: "Pictures and charts", label: "Chart", description: "A large chart with a caption underneath.", name: "Chart",
    slots: [TITLE, body("Caption", "Say what the learner should notice in the chart.", [80, 590, 1120, 60], 22, "p", true)],
    decorations: [RULE, chartArea([80, 160, 1120, 410])],
  },
  {
    id: "picture-large", group: "Pictures and charts", label: "Title and Large Picture", description: "A title with one large picture beneath it.", name: "Large picture",
    slots: [heading("Title", "Slide title", [80, 40, 1120, 80], 44)],
    decorations: [pictureArea([80, 140, 1120, 500])],
  },
  {
    id: "three-pictures", group: "Pictures and charts", label: "Three Pictures", description: "Three pictures across, each with a caption.", name: "Three pictures",
    slots: [TITLE, ...[0, 1, 2].map((i) => body(`Caption ${i + 1}`, `Caption ${i + 1}`, [80 + i * 385, 490, 350, 110], 22))],
    decorations: [RULE, ...[0, 1, 2].map((i) => pictureArea([80 + i * 385, 170, 350, 300]))],
  },
  {
    id: "four-pictures", group: "Pictures and charts", label: "Four Pictures", description: "Four pictures across, each with a caption.", name: "Four pictures",
    slots: [TITLE, ...[0, 1, 2, 3].map((i) => body(`Caption ${i + 1}`, `Caption ${i + 1}`, [80 + i * 290, 450, 250, 150], 20))],
    decorations: [RULE, ...[0, 1, 2, 3].map((i) => pictureArea([80 + i * 290, 170, 250, 260]))],
  },
  {
    id: "dashboard", group: "Pictures and charts", label: "Dashboard", description: "Four panels for charts and pictures, side by side.", name: "Dashboard",
    slots: [heading("Title", "Dashboard title", [80, 30, 1120, 80], 40)],
    decorations: [chartArea([80, 130, 540, 255]), pictureArea([660, 130, 540, 255]), pictureArea([80, 410, 540, 255]), chartArea([660, 410, 540, 255])],
  },

  // ---- For lessons
  {
    id: "objectives", group: "For lessons", label: "Learning Objectives", description: "What the learner will be able to do by the end.", name: "Objectives",
    slots: [heading("Title", "Learning objectives", [80, 48, 1120, 80], 44), body("Introduction", "By the end of this lesson you will be able to:", [80, 170, 1120, 60], 26, "p", true), body("Content", "List your objectives here.", [80, 250, 1120, 380], 28)],
    decorations: [RULE],
  },
  {
    id: "instructions", group: "For lessons", label: "Instructions", description: "Tell the learner what to do, with a note about how to move on.", name: "Instructions",
    slots: [heading("Title", "Instructions", [80, 48, 1120, 80], 44), body("Content", "Explain what the learner should do.", [80, 170, 1120, 400], 28), body("Next step", "Select Next to begin.", [80, 590, 1120, 50], 22, "p", true)],
    decorations: [RULE],
  },
  {
    id: "major-point", group: "For lessons", label: "Major Point", description: "One big statement, with a line of support beneath it.", name: "Major point",
    slots: [heading("Key message", "State your main point in one sentence.", [120, 210, 1040, 240], 48), body("Supporting detail", "Add a line of support here.", [120, 470, 1040, 80], 26, "p", true)],
    decorations: [accent([120, 170, 160, 8])],
    tone: "dark", background: "theme:bg.dark",
  },
  {
    id: "welcome-picture", group: "For lessons", label: "Welcome with Picture", description: "A welcome and a subtitle, with a picture beside them.", name: "Welcome",
    slots: [heading("Title", "Welcome", [80, 220, 560, 160], 52), body("Subtitle", "Say what this course is about.", [80, 400, 560, 140], 26, "p", true)],
    decorations: [accent([80, 190, 160, 8]), pictureArea([700, 80, 500, 560])],
  },
  {
    id: "process", group: "For lessons", label: "Process or Timeline", description: "Four steps or dates in a row, each with a heading and a description.", name: "Process",
    slots: [
      TITLE,
      ...[0, 1, 2, 3].flatMap((i): Slot[] => [
        subhead(`Step ${i + 1}`, `Step ${i + 1}`, [80 + i * 290, 220, 250, 70], 28),
        body(`Step ${i + 1} detail`, `Describe step ${i + 1}.`, [80 + i * 290, 330, 250, 300], 22),
      ]),
    ],
    decorations: [RULE, { name: "Accent", rect: [80, 304, 1120, 6], fill: colorRef("line") }],
  },
];

const roleFor = (tone: SlideLayout["tone"], muted?: boolean) => textRole(tone ?? "light", muted);

const fontFor = (slot: Slot) => (slot.kind === "body" && slot.block === "p" ? "theme:font.body" : "theme:font.heading");

const text = (alloc: Alloc, slot: Slot, tab: number, z: number, tone: SlideLayout["tone"]): OSObject => ({
  ...box(alloc.object(), slot.rect[0], slot.rect[1], slot.rect[2], slot.rect[3], z), type: "text", name: slot.name,
  content: { html: `<${slot.block}>${slot.text}</${slot.block}>` },
  style: { fontFamily: fontFor(slot), fontSize: slot.size, color: colorRef(roleFor(tone, slot.muted)) },
  accessibility: { altText: slot.text, role: slot.block === "p" ? "paragraph" : "heading", tabOrder: tab, decorative: false },
});

const decoration = (alloc: Alloc, d: Decoration): OSObject => ({
  ...box(alloc.object(), d.rect[0], d.rect[1], d.rect[2], d.rect[3], 5), type: "shape", name: d.name,
  content: { shape: "rectangle" },
  style: { fill: d.fill },
  accessibility: { altText: "", role: "presentation", tabOrder: 0, decorative: true },
});

/** A decorative shape that came from a layout, as opposed to one the author drew. */
export const isLayoutDecoration = (o: OSObject): boolean =>
  o.type === "shape" && o.accessibility.decorative && (o.name === "Accent" || o.name === "Picture area" || o.name === "Chart area");

/** A grey box from a layout that marks where a picture (or a picture of a chart) goes. */
export const isPictureBox = (o: OSObject): boolean => isLayoutDecoration(o) && (o.name === "Picture area" || o.name === "Chart area");

const SLOT_NAMES = new Set([...SLIDE_LAYOUTS.flatMap((l) => l.slots.map((s) => s.name)), "Text box"]);
const PLACEHOLDER_TEXTS = new Set(SLIDE_LAYOUTS.flatMap((l) => l.slots.map((s) => s.text)));

/**
 * A text box that came from a layout and has never been written in: it still has a layout's
 * place name and the layout's own prompt text. It holds nothing of the author's, so changing
 * layout replaces it instead of carrying it along.
 */
export function isUnusedPlaceholder(o: OSObject): boolean {
  if (o.type !== "text" || !SLOT_NAMES.has(o.name) || o.name === "Text box") return false;
  const simple = parseSimpleText(String(o.content["html"] ?? "").trim());
  return simple !== null && PLACEHOLDER_TEXTS.has(simple.text);
}

const html = (o: OSObject) => String(o.content["html"] ?? "").trim();
// A subheading is a smaller heading (h3 to h6) or a box called "... heading". A title is the main heading.
const looksLikeSubhead = (o: OSObject) => /^<h[3-6]>/.test(html(o)) || /heading/i.test(o.name);
const looksLikeTitle = (o: OSObject) => !looksLikeSubhead(o) && (/title/i.test(o.name) || /^<h[12]>/.test(html(o)));

export interface LayoutResult {
  /** Everything the base layer holds afterwards. */
  objects: OSObject[];
  /** Existing text boxes moved into a slot of the new layout. */
  moved: number;
  /** Slots with nothing to move in, filled with fresh placeholder text. */
  added: number;
  /** Text boxes that had no slot to go to. They are kept, where they were. */
  leftover: number;
  /** Decorations from the old layout that were taken away. */
  removed: number;
  /** Placeholders from the old layout that were never written in, and so were replaced. */
  cleared: number;
}

/**
 * Lay a slide out. With no existing objects this is a new slide. With existing objects, the
 * text already written moves into the new slots (the first title-like box to the title, the rest
 * in reading order to the other slots) and nothing is lost: what has no slot stays as it was.
 * Placeholders nobody has written in, and the old layout's decorations, are replaced by the new
 * layout's own. Buttons, images and everything else are not touched.
 */
export function layOut(layout: SlideLayout, alloc: Alloc, existing: OSObject[] = []): LayoutResult {
  const tone = layout.tone ?? "light";
  const decorations = existing.filter(isLayoutDecoration);
  const unused = existing.filter((o) => !isLayoutDecoration(o) && isUnusedPlaceholder(o));
  const free = existing.filter((o) => !isLayoutDecoration(o) && !isUnusedPlaceholder(o));
  const inOrder = (os: OSObject[]) => [...os].sort((a, b) => (a.accessibility.tabOrder || 999) - (b.accessibility.tabOrder || 999) || a.geometry.z - b.geometry.z);
  const texts = inOrder(free.filter((o) => o.type === "text"));
  const title = texts.find(looksLikeTitle);
  const subheads = texts.filter((o) => o !== title && looksLikeSubhead(o));
  // Subheadings only fill subheading slots. If the new layout has none they stay where they are,
  // rather than being squeezed into a block of body text.
  const bodies = texts.filter((o) => o !== title && !looksLikeSubhead(o));

  const used = new Set<OSObject>();
  const slotObjects: OSObject[] = [];
  let moved = 0;
  let added = 0;
  layout.slots.forEach((slot, i) => {
    const z = (i + 1) * 10;
    const pool = slot.kind === "title" ? (title ? [title] : []) : slot.kind === "heading" ? subheads : bodies;
    const candidate = pool.find((c) => !used.has(c));
    if (!candidate) {
      slotObjects.push(text(alloc, slot, i + 1, z, tone));
      added += 1;
      return;
    }
    used.add(candidate);
    moved += 1;
    const simple = parseSimpleText(String(candidate.content["html"] ?? ""));
    const [x, y, width, height] = slot.rect;
    slotObjects.push({
      ...candidate,
      name: SLOT_NAMES.has(candidate.name) ? slot.name : candidate.name,
      geometry: { ...candidate.geometry, x, y, width, height, rotation: 0, z },
      content: simple ? { ...candidate.content, html: buildSimpleText({ block: slot.block, text: simple.text }) } : candidate.content,
      style: {
        ...(simple ? { ...candidate.style, fontSize: slot.size } : candidate.style),
        // Colour and font that follow the theme follow the new place too. A colour or font the
        // author chose is theirs, and stays.
        ...(candidate.style["color"] === undefined || isThemeRef(candidate.style["color"]) ? { color: colorRef(roleFor(tone, slot.muted)) } : {}),
        ...(candidate.style["fontFamily"] === undefined || isThemeRef(candidate.style["fontFamily"]) ? { fontFamily: fontFor(slot) } : {}),
      },
      accessibility: {
        ...candidate.accessibility,
        role: ["paragraph", "heading"].includes(candidate.accessibility.role) ? (slot.block === "p" ? "paragraph" : "heading") : candidate.accessibility.role,
        tabOrder: i + 1,
      },
    });
  });

  const others = free.filter((o) => !used.has(o));
  // Reading order: the slots first, then whatever else was already in the tab order, in its old order.
  const rest = inOrder(others.filter((o) => (o.accessibility.tabOrder ?? 0) >= 1));
  rest.forEach((o, i) => (o.accessibility = { ...o.accessibility, tabOrder: slotObjects.length + i + 1 }));

  return {
    objects: [...layout.decorations.map((d) => decoration(alloc, d)), ...slotObjects, ...others],
    moved,
    added,
    leftover: others.filter((o) => o.type === "text").length,
    removed: decorations.length,
    cleared: unused.length,
  };
}

/** A new slide from a layout. */
export function buildLayoutSlide(layout: SlideLayout, id: string, alloc: Alloc): Slide {
  const { objects } = layOut(layout, alloc);
  return { ...emptySlide(id, layout.name), layout: layout.id, background: layout.background ?? null, baseLayer: { id: "layer-base", name: "Base", objects } };
}

// ---- layout previews

export interface PreviewBlock {
  kind: "title" | "heading" | "body" | "accent" | "picture" | "chart" | "button" | "panel";
  rect: Rect;
  fill?: string;
}

/** What to draw in the small picture of a layout, in slide units (1280 by 720). */
export function previewBlocks(layout: SlideLayout, extras: PreviewBlock[] = []): PreviewBlock[] {
  return [
    ...layout.decorations.map((d): PreviewBlock => ({ kind: d.name === "Picture area" ? "picture" : d.name === "Chart area" ? "chart" : "accent", rect: d.rect, fill: d.fill })),
    ...layout.slots.map((s): PreviewBlock => ({ kind: s.kind, rect: s.rect })),
    ...extras,
  ];
}

/**
 * The Add menu itself: a short list. Kinds with several variants (shapes, quiz questions, and later
 * interactions) are one entry that opens a picker, so the menu does not grow with every new variant.
 */
export const ADD_MENU: { value: string; label: string }[] = [
  { value: "text", label: "Text box" },
  { value: "group:button", label: "Button..." },
  { value: "hotspot", label: "Hotspot (a clickable area)" },
  { value: "group:media", label: "Image, video, audio or file..." },
  { value: "group:shape", label: "Shape or bubble..." },
  { value: "group:content", label: "Table or scrolling text..." },
  { value: "group:question", label: "Question, input or survey..." },
  { value: "group:interaction", label: "Interaction, scenario or timer..." },
  { value: "group:course", label: "Results or certificate..." },
];

/** The variants behind a menu entry that opens a picker, taken from NEW_OPTIONS. */
export function groupOptions(group: string): { value: string; label: string }[] {
  const prefix = `${group}:`;
  return NEW_OPTIONS.filter((o) => o.value.startsWith(prefix)).map((o) => ({
    value: o.value,
    label: o.label.replace(/^[^:]*:\s*/, "").replace(/^./, (c) => c.toUpperCase()),
  }));
}

// ---- interactions
//
// The catalogue is data. Each entry is one thing an author can add: a kind and, where it matters,
// which way it runs. The Add menu shows these in a picker, so the list can grow without the menu
// growing.

export type InteractionKind = InteractionContent["kind"];

export interface InteractionChoice {
  /** "kind:orientation", which is also what the picker returns. */
  id: string;
  kind: InteractionKind;
  orientation: "horizontal" | "vertical";
  group: string;
  label: string;
  description: string;
  /** Size on the slide. */
  size: { w: number; h: number };
}

export const INTERACTION_GROUPS = ["Reveal", "Tabs and steps", "Browse", "Diagrams"] as const;

export const INTERACTIONS: InteractionChoice[] = [
  { id: "clickReveal:horizontal", kind: "clickReveal", orientation: "horizontal", group: "Reveal", label: "Click and reveal", description: "Buttons side by side. Each one opens its own text.", size: { w: 1000, h: 320 } },
  { id: "clickReveal:vertical", kind: "clickReveal", orientation: "vertical", group: "Reveal", label: "Click and reveal, stacked", description: "The same, one under another.", size: { w: 760, h: 420 } },
  { id: "accordion:vertical", kind: "accordion", orientation: "vertical", group: "Reveal", label: "Accordion", description: "Headings that open and close. One open at a time, or several.", size: { w: 760, h: 420 } },
  { id: "flipCards:horizontal", kind: "flipCards", orientation: "horizontal", group: "Reveal", label: "Flip cards", description: "Cards in a row. Select one to turn it over.", size: { w: 1000, h: 300 } },
  { id: "flipCards:vertical", kind: "flipCards", orientation: "vertical", group: "Reveal", label: "Flip cards, stacked", description: "Cards one under another.", size: { w: 620, h: 460 } },
  { id: "tabs:horizontal", kind: "tabs", orientation: "horizontal", group: "Tabs and steps", label: "Horizontal tabs", description: "Tabs along the top. The arrow keys move between them.", size: { w: 900, h: 380 } },
  { id: "tabs:vertical", kind: "tabs", orientation: "vertical", group: "Tabs and steps", label: "Vertical tabs", description: "Tabs down the side.", size: { w: 900, h: 380 } },
  { id: "steps:horizontal", kind: "steps", orientation: "horizontal", group: "Tabs and steps", label: "Step process", description: "Numbered steps with Previous and Next.", size: { w: 900, h: 380 } },
  { id: "carousel:horizontal", kind: "carousel", orientation: "horizontal", group: "Browse", label: "Content carousel", description: "One item at a time with Previous and Next. It never moves by itself.", size: { w: 900, h: 380 } },
  { id: "glossary:horizontal", kind: "glossary", orientation: "horizontal", group: "Browse", label: "Glossary", description: "Terms A to Z with a search box and a letter bar. Select a term to read its definition.", size: { w: 960, h: 440 } },
  { id: "timeline:horizontal", kind: "timeline", orientation: "horizontal", group: "Diagrams", label: "Timeline", description: "Events along a line. Select one to read about it.", size: { w: 1000, h: 380 } },
  { id: "processCircle:horizontal", kind: "processCircle", orientation: "horizontal", group: "Diagrams", label: "Process circle", description: "Steps round a circle with arrows between them.", size: { w: 960, h: 440 } },
  { id: "pyramidStack:horizontal", kind: "pyramidStack", orientation: "horizontal", group: "Diagrams", label: "Pyramid stack", description: "A pyramid of layers. Select a layer to read about it.", size: { w: 960, h: 440 } },
  { id: "pyramidMatrix:horizontal", kind: "pyramidMatrix", orientation: "horizontal", group: "Diagrams", label: "Pyramid matrix", description: "A pyramid divided into labelled sections.", size: { w: 960, h: 440 } },
  { id: "circleMatrix:horizontal", kind: "circleMatrix", orientation: "horizontal", group: "Diagrams", label: "Circle matrix", description: "A circle divided into labelled segments.", size: { w: 960, h: 440 } },
  { id: "labeledGraphic:horizontal", kind: "labeledGraphic", orientation: "horizontal", group: "Diagrams", label: "Labeled graphic", description: "A picture with numbered markers. Select a marker to read about that part of the picture.", size: { w: 1100, h: 520 } },
];

/** How many items a new interaction starts with. The rest start with three. */
const STARTING_ITEMS: Partial<Record<InteractionKind, number>> = { timeline: 5, processCircle: 5, glossary: 5, pyramidStack: 4, pyramidMatrix: 4, circleMatrix: 4 };

export function interactionById(id: string): InteractionChoice | undefined {
  return INTERACTIONS.find((i) => i.id === id);
}

/** Where the `index`th marker of a labeled graphic starts, as percentages of the picture: spread so that up to twelve are not on top of one another. */
export function defaultMarker(index: number): { x: number; y: number } {
  return { x: 12 + ((index * 23) % 76), y: 14 + ((index * 31) % 72) };
}

/** A new item. It starts with a title and a line telling the author to write, both of which they replace. */
export function newInteractionItem(ids: string[], kind: InteractionKind = "tabs"): InteractionItem {
  let n = 1;
  while (ids.includes(`item-${n}`)) n++;
  const word = kind === "glossary" ? "Term" : "Item";
  const item: InteractionItem = { id: `item-${n}`, title: `${word} ${ids.length + 1}`, body: kind === "glossary" ? "<p>Write the definition.</p>" : "<p>Write the text for this item.</p>", image: null, narration: null };
  // A marker starts somewhere on the picture, spread so they do not sit on one another. The author moves it.
  if (kind === "labeledGraphic") Object.assign(item, defaultMarker(ids.length));
  return item;
}

export function newInteraction(choice: InteractionChoice, p: Placement): OSObject {
  const ids: string[] = [];
  const items = Array.from({ length: STARTING_ITEMS[choice.kind] ?? 3 }, () => {
    const item = newInteractionItem(ids, choice.kind);
    ids.push(item.id);
    return item;
  });
  const at = stagger(p, Math.round((1280 - choice.size.w) / 2), 190);
  return {
    ...box(p.id, at.x, at.y, choice.size.w, choice.size.h, p.z), type: "interaction", name: choice.label,
    // A labeled graphic starts with no picture; the author chooses it, and the validator asks until they do.
    content: { kind: choice.kind, orientation: choice.orientation, allowMultiple: choice.kind === "clickReveal", items, ...(choice.kind === "labeledGraphic" ? { graphic: { src: "", alt: "" } } : {}) } satisfies InteractionContent as unknown as Record<string, unknown>,
    style: { fontFamily: "theme:font.body", fontSize: 18 },
    // The name a screen reader gives the group. The author should make it say what the group is about.
    accessibility: { altText: choice.label, role: "group", tabOrder: p.tabOrder, decorative: false },
  };
}

// ---- icons, and buttons that go somewhere

/** An icon: 64 by 64 in the theme's strong colour. It starts with no alt text, so the validator asks for it, or for the icon to be marked decorative. */
export function newIcon(p: Placement, icon: IconContent): OSObject {
  const at = stagger(p, 200, 200);
  return {
    ...box(p.id, at.x, at.y, 64, 64, p.z), type: "icon", name: `Icon: ${icon.name.replace(/-/g, " ")}`,
    content: icon as unknown as Record<string, unknown>,
    style: { color: colorRef("accentStrong"), strokeWidth: 2 },
    accessibility: { altText: "", role: "img", tabOrder: p.tabOrder, decorative: false },
  };
}

/** The ready-made buttons that move around the course: what they say, the icon they show, and which side it is on. */
export interface NavigationButton {
  id: "next" | "previous" | "replay";
  label: string;
  description: string;
  icon: IconContent;
  placement: "before" | "after";
}

// The three arrows are Lucide's own (a test checks they are the same as in the icon list).
export const NAVIGATION_BUTTONS: NavigationButton[] = [
  { id: "next", label: "Next", description: "Goes to the next slide of the course. If the slides are moved about, it still goes to the one that follows.", placement: "after",
    icon: { set: "lucide", name: "arrow-right", shapes: [{ tag: "path", d: "M5 12h14" }, { tag: "path", d: "m12 5 7 7-7 7" }] } },
  { id: "previous", label: "Back", description: "Goes to the slide before this one.", placement: "before",
    icon: { set: "lucide", name: "arrow-left", shapes: [{ tag: "path", d: "m12 19-7-7 7-7" }, { tag: "path", d: "M19 12H5" }] } },
  { id: "replay", label: "Replay this slide", description: "Shows this slide again from the start: its timing, its narration and its layers.", placement: "before",
    icon: { set: "lucide", name: "rotate-ccw", shapes: [{ tag: "path", d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }, { tag: "path", d: "M3 3v5h5" }] } },
];

export function navigationButtonById(id: string): NavigationButton | undefined {
  return NAVIGATION_BUTTONS.find((b) => b.id === id);
}

/** A button already wired to move around the course. Its words are its name, and it works from the keyboard as well as the mouse. */
export function newNavigationButton(choice: NavigationButton, p: Placement): OSObject {
  const base = newObject("button", p);
  const action: Exclude<Activation, { kind: "custom" }> = { kind: choice.id };
  return {
    ...base,
    name: choice.label,
    content: { label: choice.label, icon: { ...choice.icon, shapes: choice.icon.shapes.map((s) => ({ ...s })) }, iconPlacement: choice.placement },
    accessibility: { ...base.accessibility, altText: choice.label },
    triggers: buildActivation(action),
  };
}

// ---- scenarios

/** A scenario with a small story to write over. It is large, because it holds a heading, lines of text and buttons. */
export function newScenario(p: Placement, content: ScenarioContent): OSObject {
  const at = stagger(p, 140, 120);
  return {
    ...box(p.id, at.x, at.y, 1000, 540, p.z), type: "scenario", name: "Scenario",
    content: content as unknown as Record<string, unknown>,
    style: { fontFamily: "theme:font.body", fontSize: 20 },
    // The name a screen reader gives the scenario. The author should make it say what the scenario is about.
    accessibility: { altText: "A scenario", role: "group", tabOrder: p.tabOrder, decorative: false },
  };
}

// ---- inputs and surveys

export interface InputChoice {
  id: InputKind;
  group: "Inputs" | "Surveys";
  label: string;
  description: string;
  size: { w: number; h: number };
}

export const INPUTS: InputChoice[] = [
  { id: "character", group: "Inputs", label: "Choose a character", description: "The learner picks who they will be, from the people in the project's cast, shown as picture cards. The choice is saved in one variable, and a scenario can show it.", size: { w: 700, h: 340 } },
  { id: "checkbox", group: "Inputs", label: "Checkboxes", description: "Tick any number of boxes. Each box is saved in its own true or false variable.", size: { w: 560, h: 230 } },
  { id: "radio", group: "Inputs", label: "Radio buttons", description: "Choose one of several. The choice is saved in one variable.", size: { w: 560, h: 230 } },
  { id: "dropdown", group: "Inputs", label: "Drop-down", description: "Choose one from a menu that opens.", size: { w: 560, h: 150 } },
  { id: "list", group: "Inputs", label: "List", description: "Choose one from a list that is always showing.", size: { w: 560, h: 230 } },
  { id: "slider", group: "Inputs", label: "Slider", description: "Set a number between a lowest and a highest value. The number is saved in a variable that rules can read as it changes.", size: { w: 760, h: 190 } },
  { id: "dial", group: "Inputs", label: "Dial", description: "The same as a slider, drawn as a round dial that can be turned by pointing or clicking. The keyboard and screen readers get an ordinary slider.", size: { w: 420, h: 380 } },
  { id: "likert", group: "Surveys", label: "Likert scale", description: "Statements to rate from strongly disagree to strongly agree.", size: { w: 1000, h: 350 } },
  { id: "semantic", group: "Surveys", label: "Semantic differential", description: "Pairs of opposite words with a row of points between them.", size: { w: 960, h: 320 } },
];

export function inputById(id: string): InputChoice | undefined {
  return INPUTS.find((i) => i.id === id);
}

/** What a part of an input saves when the author has not chosen: lower case, joined by hyphens. */
export function slugOf(label: string, fallback = "option"): string {
  const s = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s === "" ? fallback : s;
}

export const LIKERT_SCALE = ["Strongly disagree", "Disagree", "Neither agree nor disagree", "Agree", "Strongly agree"];

/**
 * A new input. Every part that saves something gets its own new variable, made by `makeVar`, so a
 * new input works straight away and no two parts overwrite each other.
 */
export function newInput(choice: InputChoice, p: Placement, makeVar: (type: "boolean" | "string" | "number", base: string) => string, cast: readonly { id: string }[] = []): OSObject {
  const kind = choice.id;
  const ids = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
  let content: InputContent;
  if (kind === "character") {
    content = { kind, prompt: "Choose who you will be", report: false, variable: makeVar("string", "character"), characters: cast.slice(0, 3).map((x) => x.id) };
  } else if (kind === "checkbox") {
    content = { kind, prompt: "Select all that apply", report: false, items: ids(3, "box-").map((id, i) => ({ id, label: `Option ${i + 1}`, variable: makeVar("boolean", `option${i + 1}`) })) };
  } else if (kind === "radio" || kind === "dropdown" || kind === "list") {
    const n = kind === "list" ? 4 : 3;
    content = { kind, prompt: "Choose one", report: false, variable: makeVar("string", "choice"), options: ids(n, "opt-").map((id, i) => ({ id, label: `Option ${i + 1}`, value: `option-${i + 1}` })) };
  } else if (kind === "slider" || kind === "dial") {
    content = {
      kind, prompt: kind === "slider" ? "How confident are you?" : "Turn the dial to your answer", report: false, variable: makeVar("number", kind),
      min: 0, max: 100, step: 1, startLabel: "Low", endLabel: "High", showValue: true,
    };
  } else if (kind === "likert") {
    content = { kind, prompt: "How much do you agree with each statement?", report: false, scale: [...LIKERT_SCALE], rows: ids(3, "row-").map((id, i) => ({ id, label: `Statement ${i + 1}`, variable: makeVar("number", `statement${i + 1}`) })) };
  } else {
    content = { kind, prompt: "Rate each pair of words", report: false, points: 7, rows: ids(3, "row-").map((id, i) => ({ id, label: `Word ${i + 1}`, right: `Opposite ${i + 1}`, variable: makeVar("number", `pair${i + 1}`) })) };
  }
  const at = stagger(p, Math.round((1280 - choice.size.w) / 2), 190);
  return {
    ...box(p.id, at.x, at.y, choice.size.w, choice.size.h, p.z), type: "input", name: choice.label,
    content: content as unknown as Record<string, unknown>,
    style: { fontFamily: "theme:font.body", fontSize: 18 },
    // The prompt is the visible name of the group. Alt text starts as the same words, and the author can add to it.
    accessibility: { altText: content.prompt, role: "group", tabOrder: p.tabOrder, decorative: false },
  };
}

// ---- video, audio and embedded video

/** A video or audio file already copied into the project. It starts with no name and no captions, so the validator asks for both. */
export function newMedia(kind: "video" | "audio", p: Placement, src: string): OSObject {
  const video = kind === "video";
  const at = stagger(p, video ? 320 : 380, video ? 180 : 300);
  return {
    ...box(p.id, at.x, at.y, video ? 640 : 520, video ? 360 : 54, p.z), type: kind, name: video ? "Video" : "Audio",
    content: { src, captions: null, transcript: "" },
    style: {},
    accessibility: { altText: "", role: video ? "video" : "audio", tabOrder: p.tabOrder, decorative: false },
  };
}

/** A file's name as a title to start from: "course-handbook_v2.pdf" becomes "Course handbook v2". The author changes it. */
export function titleFromFileName(src: string): string {
  const name = (src.split("/").pop() ?? src).replace(/\.[^.]*$/, "");
  const words = name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return words === "" ? "File" : words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A file already copied into the project, offered for download. It starts with the file's name as its title and no
 * description, no name for screen readers and no confirmation, so the validator asks for all three.
 */
export function newDownload(p: Placement, src: string): OSObject {
  const at = stagger(p, 370, 190);
  const content: DownloadContent = { src, title: titleFromFileName(src), description: "", accessibleConfirmed: false };
  return {
    ...box(p.id, at.x, at.y, 540, 340, p.z), type: "download", name: "Download",
    content: content as unknown as Record<string, unknown>,
    style: { fontFamily: "theme:font.body", fontSize: 18 },
    accessibility: { altText: "", role: "group", tabOrder: p.tabOrder, decorative: false },
  };
}

/**
 * A countdown. Its label is also its name for a screen reader to start with, because the label is what a sighted learner reads. It has no rule
 * yet: the author says what happens when the time runs out, and the validator warns until they do.
 */
export function newTimer(p: Placement): OSObject {
  const at = stagger(p, 200, 80);
  return {
    ...box(p.id, at.x, at.y, 360, 210, p.z), type: "timer", name: "Timer",
    content: { ...TIMER_DEFAULT } as unknown as Record<string, unknown>,
    style: { fontFamily: "theme:font.body", fontSize: 18 },
    accessibility: { altText: TIMER_DEFAULT.label, role: "group", tabOrder: p.tabOrder, decorative: false },
  };
}

/** A YouTube or Vimeo video. It starts with no name, no transcript and captions unconfirmed, so the validator asks for all three. */
export function newEmbed(p: Placement, address: { provider: "youtube" | "vimeo"; id: string; hash: string }): OSObject {
  const at = stagger(p, 320, 150);
  const content: EmbedContent = { ...address, transcript: "", captionsConfirmed: false };
  return {
    ...box(p.id, at.x, at.y, 640, 420, p.z), type: "embed", name: address.provider === "youtube" ? "YouTube video" : "Vimeo video",
    content: content as unknown as Record<string, unknown>,
    style: { fontFamily: "theme:font.body", fontSize: 16 },
    accessibility: { altText: "", role: "video", tabOrder: p.tabOrder, decorative: false },
  };
}
