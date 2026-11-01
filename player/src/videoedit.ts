// What the video maker hands to the recorder's exporter and to the person who made the course: the edit that lays the pictures and the
// narration on a timeline (the recorder's own edit format, docs/capture/capture-edit-format.md), the captions that go beside the video,
// and plain sentences about what a video cannot show. Nothing here writes a file or starts a program.

import { GRID_MS, TRANSITION_MS } from "./videoplan.ts";
import type { Cue, NarrationAsset, Slide } from "./types.ts";

/** A picture of a slide and the stretch of the slide it is shown for, in ms from the slide opening. */
export interface VideoPicture {
  startMs: number;
  endMs: number;
  /** The picture's file name in the exporter's folder of the course's own files. */
  file: string;
}

/** One object's narration, laid on the slide. */
export interface VideoNarration {
  name: string;
  script: string;
  /** The sound file's name in the exporter's folder (48,000 a second). */
  file: string;
  /** In ms from the slide opening. */
  startMs: number;
  durationMs: number;
  /** Caption cues in seconds from the start of this sound, or null. */
  cues: Cue[] | null;
}

export interface VideoSlide {
  name: string;
  /** Where the slide starts in the video. */
  startMs: number;
  lengthMs: number;
  pictures: VideoPicture[];
  /** The slide arrives with an effect, so the video blends into it from the slide before. */
  arrives: boolean;
  narration: VideoNarration[];
}

interface Clip {
  id: string;
  name: string;
  source: { kind: "asset"; asset: string };
  sourceStartMs: number;
  sourceEndMs: number;
  startMs: number;
  muted: false;
  volumeDb: 0;
  fadeInMs: 0;
  fadeOutMs: 0;
  altText?: string;
  transitionIn?: { kind: "cross-fade"; durationMs: number };
}

/**
 * The edit for the exporter: one track of pictures and, if anything is narrated, one of narration. A picture is a clip of a still image;
 * a slide that arrives with an effect blends in from the slide before over the first picture (at most TRANSITION_MS, and no longer than
 * the picture). Every clip is on the grid, and a sound is never beyond what its file holds.
 */
export function buildEdit(slides: VideoSlide[], transitions: boolean): { text: string; lengthMs: number; transitionCount: number } {
  let serial = 0;
  const nextId = (kind: string): string => `${kind}-${++serial}`;
  const sources: Record<string, unknown>[] = [];
  /** Two objects that say the same words share one sound file, which is listed once. */
  const listed = new Set<string>();
  const addSource = (file: string, source: Record<string, unknown>): void => {
    if (listed.has(file)) return;
    listed.add(file);
    sources.push({ ref: { kind: "asset", asset: file }, ...source });
  };
  const pictureClips: Clip[] = [];
  const soundClips: Clip[] = [];
  let transitionCount = 0;
  slides.forEach((slide, index) => {
    slide.pictures.forEach((picture, i) => {
      const length = picture.endMs - picture.startMs;
      if (length < GRID_MS) throw new Error(`A picture of slide ${index + 1} would last under ${GRID_MS} milliseconds.`);
      addSource(picture.file, { kind: "image", name: `${slide.name} (picture ${i + 1})`, durationMs: null });
      const clip: Clip = {
        id: nextId("clip"),
        name: slide.name,
        source: { kind: "asset", asset: picture.file },
        sourceStartMs: 0,
        sourceEndMs: length,
        startMs: slide.startMs + picture.startMs,
        muted: false,
        volumeDb: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
        altText: `Slide ${index + 1}: ${slide.name}`,
      };
      if (transitions && slide.arrives && index > 0 && i === 0) {
        clip.transitionIn = { kind: "cross-fade", durationMs: Math.min(TRANSITION_MS, length) };
        transitionCount += 1;
      }
      pictureClips.push(clip);
    });
    for (const n of slide.narration) {
      if (n.durationMs < GRID_MS) continue;
      addSource(n.file, { kind: "audio", name: n.name, durationMs: n.durationMs, hasTextAlternative: true });
      soundClips.push({
        id: nextId("clip"),
        name: n.name,
        source: { kind: "asset", asset: n.file },
        sourceStartMs: 0,
        sourceEndMs: n.durationMs,
        startMs: slide.startMs + n.startMs,
        muted: false,
        volumeDb: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
      });
    }
  });
  const tracks: Record<string, unknown>[] = [{ id: nextId("track"), kind: "media", name: "Slides", clips: pictureClips }];
  if (soundClips.length > 0) tracks.push({ id: nextId("track"), kind: "audio", name: "Narration", clips: soundClips });
  const edit = {
    format: "openstage-capture-edit",
    schemaVersion: transitionCount > 0 ? "0.4.0" : "0.3.0",
    nextId: serial + 1,
    sources,
    tracks,
  };
  const last = slides[slides.length - 1];
  return { text: `${JSON.stringify(edit, null, 2)}\n`, lengthMs: last ? last.startMs + last.lengthMs : 0, transitionCount };
}

/** A time as WebVTT writes it: 00:01:02.345. */
export function vttTime(ms: number): string {
  const whole = Math.max(0, Math.round(ms));
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(whole / 3_600_000))}:${pad(Math.floor(whole / 60_000) % 60)}:${pad(Math.floor(whole / 1000) % 60)}.${pad(whole % 1000, 3)}`;
}

/** The words of a cue as WebVTT may hold them: no markup, no line that is empty. */
function vttText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\s*\n\s*/g, " ").trim();
}

/**
 * Captions for the whole video, made from the narration scripts: each sentence is a cue, at the time its narration says it. A narration
 * with sound but no timed sentences is one cue for the whole of it. Nothing is listened to; the words are the author's own.
 */
export function captionsVtt(slides: VideoSlide[]): { text: string; cues: number } {
  const lines = ["WEBVTT", ""];
  let count = 0;
  for (const slide of slides) {
    for (const n of slide.narration) {
      const base = slide.startMs + n.startMs;
      const cues = n.cues && n.cues.length > 0 ? n.cues : [{ start: 0, end: n.durationMs / 1000, text: n.script }];
      for (const cue of cues) {
        const text = vttText(cue.text);
        if (text === "") continue;
        const start = base + cue.start * 1000;
        const end = Math.min(base + n.durationMs, Math.max(base + cue.end * 1000, start + 500));
        if (end <= start) continue;
        count += 1;
        lines.push(String(count), `${vttTime(start)} --> ${vttTime(end)}`, text, "");
      }
    }
  }
  return { text: lines.join("\n"), cues: count };
}

/** "Slide 3", "Slides 3 and 5", "Slides 3, 5 and 9". */
export function slideNumbers(numbers: number[]): string {
  const n = numbers.map(String);
  if (n.length === 1) return `Slide ${n[0]}`;
  return `Slides ${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

const ANSWERED = new Set(["quizQuestion", "interaction", "input", "scenario"]);
/** The kinds of object whose words a viewer is meant to read. */
const READ_TYPES = new Set(["text", "scrollingText", "table"]);
const MEDIA = new Set(["video", "audio"]);
const SHOWN_AS_OPENED = new Set(["results", "certificate", "timer"]);

/** What a video cannot do for these slides, in plain sentences for the person who made the course. Empty when nothing is lost. */
export function videoNotes(slides: Slide[], narration: Record<string, NarrationAsset>): string[] {
  const group = (test: (s: Slide) => boolean): number[] => slides.flatMap((s, i) => (test(s) ? [i + 1] : []));
  const has = (types: Set<string>) => (s: Slide) => s.baseLayer.objects.some((o) => types.has(o.type));
  const notes: string[] = [];
  const silent = group((s) => s.baseLayer.objects.some((o) => narration[o.id] && narration[o.id]!.script.trim() !== "" && !narration[o.id]!.audio));
  if (silent.length > 0) notes.push(`${slideNumbers(silent)} ${silent.length === 1 ? "has" : "have"} narration text but no audio has been made, so ${silent.length === 1 ? "it is" : "they are"} silent in the video. Make the audio and publish again.`);
  // Words on a slide that nothing reads aloud are only a picture in a video, so a viewer who cannot see it gets nothing from them.
  const unread = group((s) => s.baseLayer.objects.some((o) => READ_TYPES.has(o.type) && !o.accessibility?.decorative) && !s.baseLayer.objects.some((o) => narration[o.id]?.audio));
  if (unread.length > 0) notes.push(`${slideNumbers(unread)} ${unread.length === 1 ? "has" : "have"} text on ${unread.length === 1 ? "it" : "them"} but nothing is read aloud, so a viewer who cannot see the picture gets nothing from ${unread.length === 1 ? "it" : "them"}. Add narration to ${unread.length === 1 ? "it" : "them"}.`);
  const questions = group(has(ANSWERED));
  if (questions.length > 0) notes.push(`${slideNumbers(questions)}: a question or other activity is shown as it is when the slide opens. A video cannot be answered.`);
  const media = group(has(MEDIA));
  if (media.length > 0) notes.push(`${slideNumbers(media)}: a video or sound on the slide is not played. A video shows only its first picture.`);
  const opened = group(has(SHOWN_AS_OPENED));
  if (opened.length > 0) notes.push(`${slideNumbers(opened)}: a results box, a certificate or a timer is shown as it is when the slide opens, with no score or time running.`);
  const embeds = group(has(new Set(["embed"])));
  if (embeds.length > 0) notes.push(`${slideNumbers(embeds)}: a page or video from another website is not shown.`);
  const layers = group((s) => s.layers.length > 0);
  if (layers.length > 0) notes.push(`${slideNumbers(layers)}: only the main layer is shown. Layers that open from a button or an answer are not in the video.`);
  return notes;
}
