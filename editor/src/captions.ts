// Captions, and the transcript made from them: reading and writing WebVTT and SRT, checking how easy captions are to read, making captions from
// a script, and building a transcript from captions and the words and zooms of a recording.
//
// A caption is a cue: words, and when they appear and go, in whole milliseconds on the video's own time. A course keeps captions as a WebVTT file
// under assets/captions, which is what the player shows, so WebVTT is what is read and written; SRT is read and written so captions can move to
// and from other tools. Nothing here uses a screen or the shell, so every rule is tested with Node alone. The rules for hard-to-read captions
// are warnings, never blockers: WCAG sets no numbers for them, and the numbers here (DEFAULT_LIMITS) come from published caption guides and can be changed.

import type { Model as EditModel } from "../../capture-edit/src/model.ts";

export interface Cue {
  id: string;
  startMs: number;
  endMs: number;
  /** One or more lines, separated by a newline. */
  text: string;
}

export interface Limits {
  /** The most lines in one caption. */
  maxLines: number;
  /** The most characters on one line. */
  maxChars: number;
  /** The most characters a second a viewer is asked to read. */
  maxCps: number;
  /** The shortest a caption should stay on screen, in milliseconds. */
  minMs: number;
}

/** From published caption guides (DCMP, Netflix, BBC), as summarised by secondary sources: two lines, 42 characters, about 160 words a minute, one second. */
export const DEFAULT_LIMITS: Limits = { maxLines: 2, maxChars: 42, maxCps: 20, minMs: 1000 };

/** The number of characters a second assumed when nothing says how long the words last: about 150 words a minute. */
export const FALLBACK_CPS = 15;

/**
 * Captions whose times were worked out from a script, not heard, are marked as estimates until the author has checked them. The mark travels in the
 * WebVTT file as a NOTE block, which every player ignores, so it is still there when the captions are opened again.
 */
export const ESTIMATE_NOTE = "Times estimated from a script and not yet checked.";

// ---- times

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

function clock(ms: number, point: string): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${point}${pad(total % 1000, 3)}`;
}

/** `00:01:05.250`, the form WebVTT uses. */
export const formatVttTime = (ms: number): string => clock(ms, ".");
/** `00:01:05,250`, the form SRT uses. */
export const formatSrtTime = (ms: number): string => clock(ms, ",");

/**
 * A time as an author or a file writes it, in milliseconds, or null if it is not a time. Accepts `12`, `12.5`, `1:05`, `1:05.25`, `0:01:05.250`
 * and, as SRT writes it, `00:01:05,250`. Negative numbers and letters are not times.
 */
export function parseClock(text: string): number | null {
  const parts = text.trim().replace(",", ".").split(":");
  if (parts.length > 3) return null;
  const last = parts[parts.length - 1] ?? "";
  if (parts.length === 1) return /^\d{1,6}(?:\.\d{1,3})?$/.test(last) ? Math.round(Number(last) * 1000) : null;
  if (!/^\d{1,2}(?:\.\d{1,3})?$/.test(last)) return null;
  const head = parts.slice(0, -1);
  if (!head.every((p) => /^\d{1,3}$/.test(p))) return null;
  const seconds = Number(last);
  const nums = head.map(Number);
  const hours = nums.length === 2 ? (nums[0] ?? 0) : 0;
  const minutes = (nums.length === 2 ? nums[1] : nums[0]) ?? 0;
  if (seconds >= 60 || (nums.length === 2 && minutes >= 60)) return null;
  return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000);
}

/** A time as the number of seconds an author types in a field: `12.5`, `65`. */
export function secondsField(ms: number): string {
  const s = Math.round(ms) / 1000;
  return Number.isInteger(s) ? String(s) : String(Number(s.toFixed(3)));
}

// ---- reading

export interface Parsed {
  cues: Cue[];
  /** Whether the file says its times are estimates that nobody has checked (WebVTT only). */
  estimated: boolean;
  /** Things in the file that could not be used, in words. */
  problems: string[];
  format: "vtt" | "srt";
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", lrm: "", rlm: "" };

function cleanText(lines: readonly string[], srt: boolean): string {
  const out: string[] = [];
  for (const raw of lines) {
    let line = raw.replace(/<[^>]*>/g, "");
    if (srt) line = line.replace(/\{[^}]*\}/g, "");
    line = line
      .replace(/&#(\d{1,6});/g, (_m, n: string) => { const c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ""; })
      .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
    line = line.replace(/\s+/g, " ").trim();
    if (line !== "") out.push(line);
  }
  return out.join("\n");
}

const TIMING = /^\s*(\S+)\s+-->\s+(\S+)/;

function readBlocks(lines: readonly string[], srt: boolean): { cues: Cue[]; problems: string[]; estimated: boolean } {
  const cues: Cue[] = [];
  const problems: string[] = [];
  let estimated = false;
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const l of lines) {
    if (l.trim() === "") {
      if (current.length > 0) blocks.push(current);
      current = [];
    } else {
      current.push(l);
    }
  }
  if (current.length > 0) blocks.push(current);
  blocks.forEach((block) => {
    const head = block[0] ?? "";
    if (!srt && /^(NOTE|STYLE|REGION)(\s|$)/.test(head)) {
      if (/^NOTE\s/.test(head) && block.join(" ").includes(ESTIMATE_NOTE)) estimated = true;
      return;
    }
    const at = block.findIndex((l) => l.includes("-->"));
    if (at < 0) return;
    const m = TIMING.exec(block[at] ?? "");
    const start = m ? parseClock(m[1] ?? "") : null;
    const end = m ? parseClock((m[2] ?? "").replace(/[^\d:.,].*$/, "")) : null;
    if (start === null || end === null) {
      problems.push(`A caption's times could not be read ("${(block[at] ?? "").trim().slice(0, 60)}"), so that caption was left out.`);
      return;
    }
    const text = cleanText(block.slice(at + 1), srt);
    if (text === "") return;
    cues.push({ id: `c${cues.length + 1}`, startMs: start, endMs: end, text });
  });
  return { cues, problems, estimated };
}

/** Read captions written as WebVTT or as SRT, whichever the text is. Anything that cannot be used is left out and said in words. */
export function parseCaptions(raw: string): Parsed {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (/^WEBVTT(?:[ \t].*)?$/.test(lines[0] ?? "")) {
    const { cues, problems, estimated } = readBlocks(lines, false);
    return { cues, problems, estimated, format: "vtt" };
  }
  if (/^\s*WEBVTT/.test(text)) {
    const { cues, problems, estimated } = readBlocks(lines, false);
    return { cues, problems: ["The first line of the file should say only WEBVTT, but the captions could still be read.", ...problems], estimated, format: "vtt" };
  }
  const { cues, problems } = readBlocks(lines, true);
  return { cues, problems, estimated: false, format: "srt" };
}

// ---- writing

/** A caption's words ready for a file: no blank line, no way to start a tag or an arrow. */
function fileText(text: string, vtt: boolean): string {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l !== "").map((l) => l.replace(/-->/g, "- ->"));
  return (vtt ? lines.map((l) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")) : lines).join("\n");
}

const writable = (c: Cue): boolean => fileText(c.text, true) !== "" && c.endMs > c.startMs;

/** Captions as a WebVTT file. A caption with no words, or that ends before it starts, is not written. With `estimated`, the file says its times are not checked. */
export function formatVtt(cues: readonly Cue[], options: { estimated?: boolean } = {}): string {
  const body = cues.filter(writable).map((c, i) => `${i + 1}\n${formatVttTime(c.startMs)} --> ${formatVttTime(c.endMs)}\n${fileText(c.text, true)}\n`);
  const note = options.estimated === true ? `NOTE ${ESTIMATE_NOTE}\n\n` : "";
  return `WEBVTT\n\n${note}${body.join("\n")}`.replace(/\n*$/, "\n");
}

/** Captions as an SRT file. */
export function formatSrt(cues: readonly Cue[]): string {
  const body = cues.filter(writable).map((c, i) => `${i + 1}\n${formatSrtTime(c.startMs)} --> ${formatSrtTime(c.endMs)}\n${fileText(c.text, false)}\n`);
  return body.join("\n");
}

// ---- how easy they are to read

/** The characters of a caption that a viewer reads (not the line breaks). */
export const readable = (text: string): number => text.replace(/\n/g, " ").replace(/\s+/g, " ").trim().length;

/** What makes one caption hard to read, in words. Empty when it is fine. These are warnings, never blockers. */
export function cueWarnings(cue: Cue, limits: Limits = DEFAULT_LIMITS): string[] {
  const out: string[] = [];
  const lines = cue.text.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length === 0) {
    out.push("It has no words.");
    return out;
  }
  const ms = cue.endMs - cue.startMs;
  if (ms <= 0) {
    out.push("It ends before it starts.");
    return out;
  }
  if (lines.length > limits.maxLines) out.push(`It has ${lines.length} lines; ${limits.maxLines} is easier to read.`);
  const longest = Math.max(...lines.map((l) => l.length));
  if (longest > limits.maxChars) out.push(`A line has ${longest} characters; ${limits.maxChars} or fewer is easier to read.`);
  const cps = readable(cue.text) / (ms / 1000);
  if (cps > limits.maxCps) out.push(`It is read at about ${Math.round(cps)} characters a second; ${limits.maxCps} or fewer is easier to follow.`);
  if (ms < limits.minMs) out.push(`It is on screen for ${(ms / 1000).toFixed(1)} seconds; ${(limits.minMs / 1000).toFixed(1)} seconds or more is easier to read.`);
  return out;
}

/** What is wrong with the captions together: out of order, overlapping, or past the end of the video. */
export function trackWarnings(cues: readonly Cue[], lengthMs: number | null): string[] {
  const out: string[] = [];
  cues.forEach((c, i) => {
    const prev = cues[i - 1];
    if (prev !== undefined && c.startMs < prev.startMs) out.push(`Caption ${i + 1} starts before caption ${i}. Put the captions in order.`);
    else if (prev !== undefined && c.startMs < prev.endMs) out.push(`Caption ${i + 1} starts before caption ${i} has ended, so they overlap.`);
    if (lengthMs !== null && c.endMs > lengthMs + 250) out.push(`Caption ${i + 1} is still on screen after the video has ended.`);
  });
  return out;
}

/** The first caption that cannot be saved, in words, or null. A caption with no words is simply left out; one that ends before it starts has to be fixed. */
export function savingProblem(cues: readonly Cue[]): string | null {
  const i = cues.findIndex((c) => fileText(c.text, true) !== "" && c.endMs <= c.startMs);
  if (i >= 0) return `Caption ${i + 1} ends before it starts. Change its times first.`;
  if (!cues.some(writable)) return "There are no captions with words to save.";
  return null;
}

export const inOrder = (cues: readonly Cue[]): boolean => cues.every((c, i) => i === 0 || c.startMs >= (cues[i - 1]?.startMs ?? 0));

/** The captions in the order they appear, with fresh ids. */
export function ordered(cues: readonly Cue[]): Cue[] {
  return [...cues].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs).map((c, i) => ({ ...c, id: `c${i + 1}` }));
}

/** A new, empty caption after the last one: it starts where the last ends and lasts two seconds (or until the video ends). */
export function newCueAfter(cues: readonly Cue[], lengthMs: number | null): Cue {
  const last = cues.reduce((end, c) => Math.max(end, c.endMs), 0);
  const end = lengthMs !== null && last + 2000 > lengthMs && lengthMs > last ? lengthMs : last + 2000;
  return { id: `c${cues.length + 1}`, startMs: last, endMs: end, text: "" };
}

// ---- captions from a script

/** Words on lines of at most `maxChars` characters, filled from the left. A word longer than a line has a line of its own. */
export function wrapLines(text: string, maxChars: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter((w) => w !== "");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line === "") line = w;
    else if (line.length + 1 + w.length <= maxChars) line += ` ${w}`;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

/** The captions with any line that is too long broken again into lines that fit. A caption whose lines already fit is left as it is. */
export function breakLongLines(cues: readonly Cue[], limits: Limits = DEFAULT_LIMITS): { cues: Cue[]; changed: number } {
  let changed = 0;
  const out = cues.map((c) => {
    const lines = c.text.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    if (lines.every((l) => l.length <= limits.maxChars)) return c;
    const text = wrapLines(lines.join(" "), limits.maxChars).join("\n");
    if (text === c.text) return c;
    changed++;
    return { ...c, text };
  });
  return { cues: out, changed };
}

const fits = (text: string, limits: Limits): boolean => wrapLines(text, limits.maxChars).length <= limits.maxLines;

/** One sentence cut into pieces that each fit a caption: at a comma, semicolon or colon if it can, then between words, then joined again where they fit. */
function sentencePieces(s: string, limits: Limits): string[] {
  if (fits(s, limits)) return [s];
  const out: string[] = [];
  let current = "";
  for (const clause of s.split(/(?<=[,;:])\s+/)) {
    const joined = current === "" ? clause : `${current} ${clause}`;
    if (fits(joined, limits)) {
      current = joined;
      continue;
    }
    if (current !== "") out.push(current);
    current = clause;
    if (!fits(current, limits)) {
      // A clause that is still too long is cut between words, as full as a caption allows.
      let piece = "";
      for (const w of current.split(" ")) {
        const next = piece === "" ? w : `${piece} ${w}`;
        if (piece === "" || fits(next, limits)) piece = next;
        else {
          out.push(piece);
          piece = w;
        }
      }
      current = piece;
    }
  }
  if (current !== "") out.push(current);
  return out;
}

/** A piece shorter than this is joined to its neighbour when the two fit together, so a caption is not on screen for a blink. */
const SHORT_PIECE = 25;

function joinShort(list: readonly string[], limits: Limits): string[] {
  const out: string[] = [];
  for (const p of list) {
    const prev = out[out.length - 1];
    if (prev !== undefined && (prev.length < SHORT_PIECE || p.length < SHORT_PIECE) && fits(`${prev} ${p}`, limits)) out[out.length - 1] = `${prev} ${p}`;
    else out.push(p);
  }
  return out;
}

/** The words of a script cut into pieces that each fit a caption. A paragraph's end always ends a caption. */
function pieces(script: string, limits: Limits): string[] {
  const out: string[] = [];
  for (const paragraph of script.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const list: string[] = [];
    for (const sentence of paragraph.replace(/\s+/g, " ").trim().split(/(?<=[.!?\u2026])\s+/)) {
      const s = sentence.trim();
      if (s !== "") list.push(...sentencePieces(s, limits));
    }
    out.push(...joinShort(list, limits));
  }
  return out;
}

/**
 * Captions from a script, spread over the video by the number of characters in each. The times are ESTIMATES: nothing here listens to the voice,
 * so the author is told to check and change them. With no length given they are spread at about 150 words a minute from the start.
 */
export function cuesFromScript(script: string, lengthMs: number | null, limits: Limits = DEFAULT_LIMITS): Cue[] {
  const parts = pieces(script, limits);
  if (parts.length === 0) return [];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const span = lengthMs !== null && lengthMs > 0 ? lengthMs : Math.round((total / FALLBACK_CPS) * 1000);
  let at = 0;
  return parts.map((p, i) => {
    const start = Math.round(at);
    at += (span * p.length) / total;
    const end = i === parts.length - 1 ? span : Math.round(at);
    return { id: `c${i + 1}`, startMs: start, endMs: Math.max(end, start + 1), text: wrapLines(p, limits.maxChars).join("\n") };
  });
}

// ---- the transcript

/** Something on the screen that the voice does not say: the words of a text overlay, a zoom, a shape that was described. */
export interface Extra {
  atMs: number;
  text: string;
}

const squash = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * What happens on screen in a recording that a transcript must say as well as the voice: the words of a text overlay, what a zoom shows, and the
 * description of a shape or an arrow that has one. In the order they happen. A shape or arrow marked decorative, a blur and a blackout are left out.
 */
export function extrasFromEdit(model: EditModel): Extra[] {
  const out: Extra[] = [];
  for (const track of model.tracks) {
    for (const item of track.items) {
      if (item.kind === "text") {
        const t = squash(item.text);
        if (t !== "") out.push({ atMs: item.startMs, text: `On screen: ${t}` });
      } else if (item.kind === "shape" || item.kind === "arrow") {
        const t = squash(item.altText ?? "");
        if (t !== "" && item.decorative !== true) out.push({ atMs: item.startMs, text: `On screen: ${t}` });
      } else if (item.kind === "zoom") {
        const t = squash(item.description);
        if (t !== "") out.push({ atMs: item.startMs, text: `The picture zooms in: ${t}` });
      }
    }
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

/** A pause in the speech longer than this starts a new paragraph of the transcript. */
export const PARAGRAPH_GAP_MS = 2500;

/**
 * A transcript from the captions and what is on screen: the words that are said, run together into paragraphs, with each on-screen event in
 * square brackets at the place it happens. Plain text with a blank line between paragraphs, which is what a video's transcript field takes.
 */
export function buildTranscript(cues: readonly Cue[], extras: readonly Extra[]): string {
  type Item = { at: number; end: number; text: string; extra: boolean };
  const items: Item[] = [
    ...cues.filter((c) => squash(c.text) !== "").map((c): Item => ({ at: c.startMs, end: c.endMs, text: squash(c.text), extra: false })),
    ...extras.filter((e) => squash(e.text) !== "").map((e): Item => ({ at: e.atMs, end: e.atMs, text: squash(e.text), extra: true })),
  ].sort((a, b) => a.at - b.at || Number(b.extra) - Number(a.extra));
  const paragraphs: string[] = [];
  let words: string[] = [];
  let lastEnd = 0;
  const flush = () => {
    if (words.length > 0) paragraphs.push(words.join(" "));
    words = [];
  };
  for (const item of items) {
    if (item.extra) {
      flush();
      paragraphs.push(`[${item.text}]`);
      continue;
    }
    if (words.length > 0 && item.at - lastEnd > PARAGRAPH_GAP_MS) flush();
    words.push(item.text);
    lastEnd = Math.max(lastEnd, item.end);
  }
  flush();
  return paragraphs.join("\n\n");
}
