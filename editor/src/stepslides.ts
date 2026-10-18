// A slide made from a step (Capture's Phase 7, the Demo lesson): the step's number, its words, its picture, and a frame round the place to point at.
//
// The slide is an ordinary OpenStage slide made of ordinary objects (a heading, a paragraph, an image, a shape), so the one renderer shows it, the Problems
// panel checks it and the author can change any part of it. What a screen reader is told is only what the author has checked: the picture's description
// is used only for a step the author ticked as checked (`reviewed`), and otherwise left empty, so the validator asks the author for it and nothing the
// editor guessed is put in the course as the author's words. The paragraph of words has narration made from it, which is the audio route for text the
// learner reads (story D7), and the slide says which recording and step it came from, so the lesson can be brought up to date later (format 0.18.0).
//
// Nothing here uses a screen or the shell. Ids, and how narration is made, are given in, so the editor's model decides them.

import type { OSObject, Slide } from "../../player/src/types.ts";
import { colorRef } from "../../player/src/theme.ts";
import { box } from "./factory.ts";
import type { Step } from "./steps.ts";

/** A picture saved in the course: its path under assets/, and its size in pixels. */
export interface StepPicture {
  path: string;
  width: number;
  height: number;
}

export interface SlideOptions {
  /** The recording's folder name, which is what a slide's provenance calls the capture. */
  recording: string;
  /** How many steps there are in the lesson, for "Step 3 of 8". */
  total: number;
  stage: { width: number; height: number };
  capturedAt?: string;
  /** What a slide of this lesson is called in the outline before its number: "Step" for the Watch lesson. */
  namePrefix?: string;
  newSlideId(): string;
  newObjectId(): string;
  /** What to put in an object's `narration` for these words (the model keeps one voice through the course). */
  narration(script: string): unknown;
}

/** The size of the picture on the stage, and where: as large as fits under the words, centred, never more than 1.5 times its own size. */
export function fitPicture(area: { x: number; y: number; width: number; height: number }, picture: { width: number; height: number }): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(area.width / picture.width, area.height / picture.height, 1.5);
  const width = Math.max(1, Math.round(picture.width * scale));
  const height = Math.max(1, Math.round(picture.height * scale));
  return { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height };
}

/** `Click the Save button.` shortened for a slide's name in the outline. */
export function shorten(text: string, max = 48): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One slide for one step. `index` is the step's place in the lesson, from 0. */
export function buildStepSlide(step: Step, index: number, picture: StepPicture | null, o: SlideOptions): Slide {
  const u = o.stage.width / 1280;
  const px = (n: number): number => Math.round(n * u);
  const margin = px(64);
  const wide = o.stage.width - margin * 2;
  const words = step.text.replace(/\s+/g, " ").trim();
  const lines = Math.min(4, Math.max(1, Math.ceil(words.length / 85)));
  const wordsHeight = px(36 * lines + 16);

  const heading: OSObject = {
    ...box(o.newObjectId(), margin, px(20), wide, px(60), 10), type: "text", name: `Step ${index + 1} heading`,
    content: { html: `<h1>Step ${index + 1} of ${o.total}</h1>` },
    style: { fontFamily: "theme:font.heading", fontSize: px(36), color: colorRef("text") },
    accessibility: { altText: `Step ${index + 1} of ${o.total}`, role: "heading", tabOrder: 1, decorative: false },
  };
  const text: OSObject = {
    ...box(o.newObjectId(), margin, px(84), wide, wordsHeight, 20), type: "text", name: `Step ${index + 1} words`,
    content: { html: `<p>${escapeHtml(words)}</p>` },
    style: { fontFamily: "theme:font.body", fontSize: px(26), color: colorRef("text") },
    accessibility: { altText: words, role: "paragraph", tabOrder: 2, decorative: false },
  };
  text.narration = words === "" ? null : o.narration(words);
  const objects: OSObject[] = [heading, text];

  if (picture !== null) {
    const top = px(84) + wordsHeight + px(16);
    const placed = fitPicture({ x: margin, y: top, width: wide, height: o.stage.height - top - px(24) }, picture);
    const image: OSObject = {
      ...box(o.newObjectId(), placed.x, placed.y, placed.width, placed.height, 30), type: "image", name: `Step ${index + 1} picture`,
      content: { src: picture.path },
      style: {},
      // Only what the author checked is said: an unchecked step's picture has no description yet, and the validator asks for one.
      accessibility: { altText: step.reviewed ? step.alt.trim() : "", role: "img", tabOrder: 3, decorative: false },
    };
    objects.push(image);
    if (step.box !== null) {
      const b = step.box;
      objects.push({
        ...box(o.newObjectId(), Math.round(placed.x + (b.x / 100) * placed.width), Math.round(placed.y + (b.y / 100) * placed.height), Math.max(4, Math.round((b.width / 100) * placed.width)), Math.max(4, Math.round((b.height / 100) * placed.height)), 40),
        type: "shape", name: `Step ${index + 1} place to point at`,
        content: { shape: "rounded" },
        style: { stroke: colorRef("accentStrong"), strokeWidth: 4, radius: 8 },
        // The words of the step already say what to do, so the frame is drawn for those who can see the picture, and is not read out.
        accessibility: { altText: "", role: "presentation", tabOrder: 0, decorative: true },
      });
    }
  }

  const provenance: Slide["provenance"] = { sourceCapture: o.recording, stepId: step.id, ...(o.capturedAt === undefined ? {} : { capturedAt: o.capturedAt }) };
  return {
    id: o.newSlideId(), name: `${o.namePrefix ?? "Step"} ${index + 1}: ${shorten(words) || "no words yet"}`, provenance, duration: null, layout: null, background: null,
    baseLayer: { id: "layer-base", name: "Base", objects }, layers: [],
  };
}
