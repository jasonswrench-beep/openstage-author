// The transcript of a whole course, for a learner who wants to read it all in one place, or keep it.
//
// It goes slide by slide, each under the slide's title: what is said (the narration, and the audio descriptions of a video), what is on the screen (text, tables, and the
// title and text of every item in an interaction), and the transcripts the author wrote for videos and sounds. Quiz questions are left out, so a transcript is not a way round a
// quiz: a slide that has one shows only its title and a note saying so, because the question's own words are usually a text object beside the answer choices and cannot be told
// from other text on the slide. It is built from the course package, with no page, so it is tested with Node alone. The panel shows it and offers it as a file
// (a11ypanel.ts).

import { namesInBrackets } from "./valuetext.ts";
import { descriptionCues } from "./description.ts";
import { itemNarrationKey } from "./narration.ts";
import { addTimeLabel, spokenTime, timerContentOf } from "./timer.ts";
import { readingOrder } from "./stage.ts";
import type { CoursePackage, InteractionContent, OSObject, TableContent } from "./types.ts";

export interface TranscriptSection {
  title: string;
  paragraphs: string[];
}

export interface Transcript {
  title: string;
  language: string;
  sections: TranscriptSection[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "\u2013", mdash: "\u2014", hellip: "\u2026" };

/** The words of a piece of the course's HTML: blocks and line breaks become separate lines, a list item starts with a dash, tags go, and entities are written out. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "\n- ")
    .replace(/<\/\s*(p|div|h[1-6]|li|ul|ol|tr|blockquote|table)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  const decoded = withBreaks
    .replace(/&#(\d{1,6});/g, (_m, n: string) => { const c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ""; })
    .replace(/&#x([0-9a-f]{1,6});/gi, (_m, n: string) => { const c = parseInt(n, 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ""; })
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
  return decoded.split("\n").map((l) => l.replace(/[ \t ]+/g, " ").trim()).filter((l) => l !== "" && l !== "-").join("\n");
}

const lines = (text: string): string[] => text.split("\n").filter((l) => l.trim() !== "");
const same = (a: string, b: string): boolean => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

const clock = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** What one object adds to the transcript. */
function partsOf(o: OSObject, pkg: CoursePackage): string[] {
  if (o.accessibility.decorative || o.type === "quizQuestion") return [];
  const out: string[] = [];
  const spoken = pkg.narration[o.id]?.script?.trim() ?? "";
  const text = (html: unknown): string => htmlToText(String(html ?? ""));
  const onScreen: string[] = [];
  switch (o.type) {
    case "text":
    case "scrollingText":
      // A transcript is a fixed copy, so a value that changes while the course is played (`{{Score}}`) is written as its name, [Score].
      onScreen.push(...lines(namesInBrackets(text(o.content["html"]))));
      break;
    case "table": {
      const t = o.content as unknown as TableContent;
      if (t.caption?.trim()) onScreen.push(t.caption.trim());
      for (const row of t.rows ?? []) onScreen.push(row.map((c) => String(c).trim()).filter((c) => c !== "").join(" | "));
      break;
    }
    case "interaction": {
      const c = o.content as unknown as InteractionContent;
      for (const item of c.items ?? []) {
        const body = lines(text(item.body));
        const said = pkg.narration[itemNarrationKey(o.id, item.id)]?.script?.trim() ?? "";
        if (item.title?.trim()) onScreen.push(item.title.trim());
        onScreen.push(...body);
        if (said !== "" && !body.some((b) => same(b, said)) && !same(body.join(" "), said)) onScreen.push(said);
      }
      break;
    }
    case "video":
    case "audio":
      onScreen.push(...lines(text(o.content["transcript"])));
      break;
    case "embed":
      onScreen.push(...lines(String(o.content["transcript"] ?? "")));
      break;
    case "timer": {
      // A reader of the transcript should know there is a time limit, and that it can be added to or turned off.
      const t = timerContentOf(o);
      onScreen.push(`${t.label}: a timer of ${spokenTime(t.seconds)}. ${t.extendBy > 0 ? `${addTimeLabel(t.extendBy)} or turn it off.` : "It can be turned off."}`);
      break;
    }
    default:
      break;
  }
  if (o.type === "video") {
    for (const cue of descriptionCues(o)) if (cue.text.trim() !== "") out.push(`Audio description, at ${clock(cue.time)}: ${cue.text.trim()}`);
  }
  // The narration says what the object says. When it only repeats what is on the screen, it is not written twice.
  if (spoken !== "" && !same(onScreen.join(" "), spoken) && !onScreen.some((l) => same(l, spoken))) out.unshift(spoken);
  return [...(o.type === "video" ? out : []), ...onScreen, ...(o.type === "video" ? [] : out)].filter((p) => p.trim() !== "");
}

/** The transcript of a course, in its order. A paragraph that is the same as the one before it is left out. */
export function buildTranscript(pkg: CoursePackage): Transcript {
  const sections: TranscriptSection[] = [];
  for (const slide of pkg.slides) {
    const layers = [slide.baseLayer, ...slide.layers];
    const hasQuiz = layers.some((l) => l.objects.some((o) => o.type === "quizQuestion"));
    const paragraphs: string[] = [];
    if (hasQuiz) {
      // The question's words, its choices and its feedback layers ("Correct", "Try again") are all part of the quiz.
      paragraphs.push("This slide has a quiz question. Quiz questions are not part of the transcript.");
    } else {
      for (const layer of layers) {
        for (const o of readingOrder(layer.objects)) {
          for (const p of partsOf(o, pkg)) if (paragraphs[paragraphs.length - 1] !== p) paragraphs.push(p);
        }
      }
    }
    sections.push({ title: slide.name, paragraphs });
  }
  return { title: pkg.project.meta.title, language: pkg.project.meta.language, sections };
}

/** The transcript as a plain text file's contents: the course's title, then each slide numbered, with a blank line between paragraphs. */
export function transcriptText(t: Transcript, newline = "\r\n"): string {
  const out: string[] = [t.title, "Transcript", ""];
  t.sections.forEach((s, i) => {
    out.push(`${i + 1}. ${s.title}`, "");
    if (s.paragraphs.length === 0) out.push("(Nothing to read on this slide.)", "");
    for (const p of s.paragraphs) out.push(p, "");
  });
  return out.join(newline).replace(/(\r?\n)+$/, newline);
}

/** A name for the file: the course's title with only letters, digits and hyphens, then `-transcript.txt`. */
export function transcriptFileName(title: string): string {
  const stem = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${stem === "" ? "course" : stem}-transcript.txt`;
}
