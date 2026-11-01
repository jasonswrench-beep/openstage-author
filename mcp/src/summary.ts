// What an assistant is told about a course: short, plain facts about the slides and objects, in the words and numbers the editor uses, so
// that what it reads can be used to ask for the next change. Nothing here changes anything.

import { isTimed } from "../../player/src/timeline.ts";
import { readRules } from "../../editor/src/content.ts";
import { keyOf, type Narration } from "../../editor/src/narration.ts";
import type { Model } from "../../editor/src/model.ts";
import type { OSObject, Slide } from "../../player/src/types.ts";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** The words of some HTML, one line to a paragraph, heading or list entry. */
export function plain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|blockquote|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, name: string) => {
      if (name[0] === "#") {
        const code = name[1]!.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
      }
      return ENTITIES[name.toLowerCase()] ?? all;
    })
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .join("\n");
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** What a person would call an object's content, for kinds whose words are in their content. */
function wordsOf(o: OSObject): string | undefined {
  const c = o.content as Record<string, unknown>;
  switch (o.type) {
    case "text":
      return plain(str(c["html"]));
    case "button":
    case "hotspot":
      return str(c["label"]) || undefined;
    case "scrollingText":
      return plain(str(c["html"]) || str(c["text"])) || undefined;
    default:
      return undefined;
  }
}

/** The key under which an object's narration is kept in the Narration list. */
export interface NarrationFact {
  key: string;
  object: string;
  slide: string;
  script: string;
  voice: string;
  lang: string;
  speed: number;
}

export function narrationFacts(model: Model): NarrationFact[] {
  return model.narratedObjects().map((n) => ({
    key: n.key,
    object: n.object.name,
    slide: n.slideName,
    script: n.narration.script,
    voice: n.narration.voice,
    lang: n.narration.lang,
    speed: n.narration.speed,
  }));
}

export function objectSummary(o: OSObject, layer: string): Record<string, unknown> {
  const c = o.content as Record<string, unknown>;
  const out: Record<string, unknown> = { id: o.id, type: o.type, name: o.name, layer, box: [o.geometry.x, o.geometry.y, o.geometry.width, o.geometry.height] };
  const words = wordsOf(o);
  if (words !== undefined && words !== "") out["text"] = words;
  if (o.type === "image") out["picture"] = str(c["src"]);
  if (o.type === "shape") out["shape"] = str(c["shape"]);
  if (o.type === "quizQuestion") {
    const choices = Array.isArray(c["choices"]) ? (c["choices"] as { label?: string; correct?: boolean }[]) : [];
    out["question"] = {
      kind: str(c["questionType"]),
      ...(choices.length > 0 ? { choices: choices.map((x) => ({ label: x.label, correct: x.correct === true })) } : {}),
      ...(Array.isArray(c["answers"]) ? { accepted: c["answers"] } : {}),
      ...(typeof c["minWords"] === "number" ? { minWords: c["minWords"] } : {}),
      ...(typeof c["passage"] === "string" ? { passage: c["passage"] } : {}),
      ...(Array.isArray(c["keys"]) ? { shortcuts: c["keys"] } : {}),
    };
  }
  if (o.type === "scenario") {
    const nodes = Array.isArray(c["nodes"]) ? (c["nodes"] as { title?: string; choices?: unknown[] }[]) : [];
    out["scenario"] = { situations: nodes.map((n, i) => ({ number: i + 1, title: n.title ?? "", choices: Array.isArray(n.choices) ? n.choices.length : 0 })) };
  }
  if (o.type === "interaction") {
    const items = Array.isArray(c["items"]) ? (c["items"] as { id?: string; title?: string }[]) : [];
    out["interaction"] = { kind: str(c["kind"]), items: items.map((i) => ({ id: i.id ?? "", title: i.title ?? "" })) };
  }
  if (o.type === "table") {
    const rows = Array.isArray(c["rows"]) ? (c["rows"] as unknown[]) : [];
    out["table"] = { rows: rows.length };
  }
  out["altText"] = o.accessibility.altText;
  if (o.accessibility.decorative) out["decorative"] = true;
  if (isTimed(o.timing)) out["timing"] = { appear: o.timing.appear, startMs: o.timing.start, visibleForMs: o.timing.visibleFor, ...(o.timing.step !== undefined ? { step: o.timing.step } : {}) };
  if (o.animation.enter.effect !== "none" || o.animation.exit.effect !== "none") out["animation"] = { enter: o.animation.enter.effect, exit: o.animation.exit.effect };
  const narration = o.narration as Narration | null;
  if (narration) out["narration"] = clip(narration.script, 160);
  if (o.triggers.length > 0) out["rules"] = readRules(o.triggers).length;
  if (o.locked) out["locked"] = true;
  return out;
}

export function slideSummary(slide: Slide, index: number): Record<string, unknown> {
  const objects = [slide.baseLayer, ...slide.layers].reduce((n, l) => n + l.objects.length, 0);
  return { number: index + 1, id: slide.id, name: slide.name, layout: slide.layout, objects, layers: slide.layers.length, ...(slide.duration !== null ? { durationMs: slide.duration } : {}) };
}

/** Whether the audio for a narration has been made (the speech tool keeps it in the project's .cache folder under the narration's hash). */
export function audioKey(n: Narration): string {
  return keyOf(n);
}
