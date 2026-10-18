// Captions from a recorded voice (story D3): what comes back from the speech recogniser, and what is made of it.
//
// The recogniser is a separate program (`whisper-cli`, see docs/decisions/0002-speech-recognition.md) that listens to a 16 kHz mono WAV file and writes what it hears with a time
// for every word. Nothing here runs it or uses a screen; this file turns its output into captions, and every rule is tested with Node alone. The rules come from the trial in
// ADR 0002: the recogniser's own caption times are poor but its word times (the "alignment mode") are good, it writes notes in brackets and one invented word on perfect silence,
// and it needs the course's own names as a hint. So:
//
//   - words and their start times are read from the alignment times, not the caption times (parseWhisper);
//   - notes such as [BLANK_AUDIO] and (keyboard clicking), and anything "heard" where the sound file is silent, are dropped (dropNotes, dropSilent);
//   - a caption is cut from the words so it fits, at the ends of sentences, then clauses, then pauses, and ends where the voice stops (cuesFromWords);
//   - the captions an author already has can have their TIMES set by the voice, keeping their words (placeByVoice);
//   - the names and terms in the course are offered as a hint (hintFor), shown to the author and changeable.

import { DEFAULT_LIMITS, wrapLines, type Cue, type Limits } from "./captions.ts";
import type { Slide } from "../../player/src/types.ts";

// ---- what the shell tells the page

export interface SpeechModel {
  id: string;
  label: string;
  /** What this model is good for, in a sentence. */
  note: string;
  bytes: number;
  installed: boolean;
}

export interface SpeechStatus {
  /** Whether the recogniser program was found. */
  ready: boolean;
  /** When it is not ready, why, and what to do. */
  problem: string;
  /** Where the models are kept on this computer. */
  folder: string;
  models: SpeechModel[];
}

/** The shell's answer about the recogniser and its models, or a status that says it could not be read. */
export function parseSpeechStatus(raw: string): SpeechStatus {
  try {
    const v = JSON.parse(raw) as Partial<SpeechStatus> | null;
    const models = Array.isArray(v?.models)
      ? v.models.filter((m): m is SpeechModel => m !== null && typeof m === "object" && typeof m.id === "string" && typeof m.bytes === "number")
      : [];
    return { ready: v?.ready === true, problem: typeof v?.problem === "string" ? v.problem : "", folder: typeof v?.folder === "string" ? v.folder : "", models };
  } catch {
    return { ready: false, problem: "The speech recogniser could not be checked.", folder: "", models: [] };
  }
}

/** `488 MB`, `148 MB`, `1.5 GB`: a file's size as it is told to the author, in the millions of bytes that Hugging Face and the docs use. */
export function megabytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

// ---- the recogniser's output

/** A word as the recogniser wrote it (with its punctuation) and when it starts, in milliseconds on the clip's own time. */
export interface Word {
  text: string;
  startMs: number;
}

export interface Parsed {
  words: Word[];
  /** Things the author should know about, in words. */
  problems: string[];
}

interface Token {
  text?: unknown;
  offsets?: { from?: unknown; to?: unknown };
  t_dtw?: unknown;
}

/**
 * The words in whisper.cpp's full JSON output (`-ojf`), each with its start time. The time is the alignment time (`t_dtw`, in hundredths of a second) when there is one, because
 * that is accurate; otherwise the token's own time, which is rough, and the author is told how many words had only that. Tokens that are not text ([_BEG_], [_TT_150], <|...|>)
 * are skipped, and a token that does not begin with a space belongs to the word before it.
 */
export function parseWhisper(raw: string): Parsed {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { words: [], problems: ["The recogniser's answer could not be read."] };
  }
  const segments = (doc as { transcription?: unknown } | null)?.transcription;
  if (!Array.isArray(segments)) return { words: [], problems: ["The recogniser's answer had no text in it."] };
  const words: Word[] = [];
  let rough = 0;
  let last = 0;
  for (const seg of segments as { tokens?: Token[] }[]) {
    let current: { text: string; start: number; exact: boolean } | null = null;
    const push = () => {
      if (current === null) return;
      const text = current.text.trim();
      if (text !== "") {
        const startMs = Math.max(last, current.start);
        words.push({ text, startMs });
        last = startMs;
        if (!current.exact) rough++;
      }
      current = null;
    };
    for (const tok of seg.tokens ?? []) {
      const text = typeof tok.text === "string" ? tok.text : "";
      if (text === "" || text.startsWith("[_") || text.startsWith("<|")) continue;
      if (current === null || text.startsWith(" ")) {
        push();
        const dtw = typeof tok.t_dtw === "number" && tok.t_dtw >= 0 ? tok.t_dtw * 10 : null;
        const from = typeof tok.offsets?.from === "number" ? tok.offsets.from : 0;
        current = { text, start: dtw ?? from, exact: dtw !== null };
      } else {
        current.text += text;
      }
    }
    push();
  }
  const problems: string[] = [];
  if (rough > 0) problems.push(`${rough} ${rough === 1 ? "word has" : "words have"} only a rough time, so ${rough === 1 ? "its caption may" : "their captions may"} start a little early or late.`);
  return { words, problems };
}

// ---- notes and silence

const MUSIC = /^[♪-♯#*]+$/;

/**
 * The words without the recogniser's notes about sounds: [BLANK_AUDIO], (keyboard clicking), (gentle music), and music signs. These are not words anyone said. A bracket or
 * parenthesis that is never closed within a few words is left alone, so a word of the speech is never lost to a stray mark.
 */
export function dropNotes(words: readonly Word[]): { words: Word[]; dropped: number } {
  // `dropped` counts notes, not words: "(keyboard clicking)" is one note.
  const out: Word[] = [];
  let dropped = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (MUSIC.test(w.text)) { dropped++; continue; }
    const open = w.text.startsWith("[") ? "]" : w.text.startsWith("(") ? ")" : null;
    if (open !== null) {
      let close = -1;
      for (let j = i; j < Math.min(words.length, i + 8); j++) {
        if (words[j]!.text.endsWith(open)) { close = j; break; }
      }
      if (close >= 0) {
        dropped++;
        i = close;
        continue;
      }
    }
    out.push(w);
  }
  return { words: out, dropped };
}

/** How loud each short stretch of a clip is, so captions can be kept out of silence and ended where the voice stops. */
export interface SoundMap {
  frameMs: number;
  /** Each frame's level in decibels below full scale (0 is as loud as it gets; silence is -120). */
  db: Float32Array;
  /** The level above which a frame counts as sound: a little over the quiet of the recording itself, and never lower than -62. */
  gateDb: number;
}

/** The level of every `frameMs` of 16-bit samples. The gate sits 8 decibels over the quiet of the recording (its 20th percentile), and never under -62. */
export function soundMapOf(samples: Int16Array, rate = 16000, frameMs = 20): SoundMap {
  const size = Math.max(1, Math.round((rate * frameMs) / 1000));
  const frames = Math.ceil(samples.length / size);
  const db = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const from = f * size;
    const to = Math.min(samples.length, from + size);
    for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!;
    const rms = Math.sqrt(sum / Math.max(1, to - from)) / 32768;
    db[f] = rms <= 0 ? -120 : Math.max(-120, 20 * Math.log10(rms));
  }
  const sorted = Float32Array.from(db).sort();
  const floor = sorted.length === 0 ? -120 : sorted[Math.floor(sorted.length * 0.2)]!;
  return { frameMs, db, gateDb: Math.max(-62, floor + 8) };
}

const frameOf = (map: SoundMap, ms: number): number => Math.max(0, Math.min(map.db.length, Math.floor(ms / map.frameMs)));

/** Whether any of the clip between two times is sound (above the gate). */
export function hasSound(map: SoundMap, fromMs: number, toMs: number): boolean {
  for (let f = frameOf(map, fromMs); f <= Math.min(map.db.length - 1, frameOf(map, toMs)); f++) if (map.db[f]! >= map.gateDb) return true;
  return false;
}

/** The time the last sound between two times ends, or null if there is none. */
export function soundEnd(map: SoundMap, fromMs: number, toMs: number): number | null {
  for (let f = Math.min(map.db.length - 1, frameOf(map, toMs)); f >= frameOf(map, fromMs); f--) if (map.db[f]! >= map.gateDb) return (f + 1) * map.frameMs;
  return null;
}

/**
 * The words without any that were "heard" where the clip is silent. The recogniser writes a word such as "You" over perfect silence, and a caption there would be a word nobody said.
 * A word is kept if there is sound anywhere from just before it starts to a little after.
 */
export function dropSilent(words: readonly Word[], map: SoundMap): { words: Word[]; dropped: number } {
  const kept = words.filter((w) => hasSound(map, w.startMs - 100, w.startMs + 400));
  return { words: kept, dropped: words.length - kept.length };
}

// ---- captions from words

const letters = (s: string): number => s.replace(/[^\p{L}\p{N}]/gu, "").length;

/**
 * When each word ends. A word ends where the voice stops, if that is before the next word begins (so a caption does not hang on through a pause), and otherwise where the next
 * word begins; a word followed by nothing ends a little after it starts. With no map of the sound, the length of the word is guessed from its letters.
 */
export function wordEnds(words: readonly Word[], lengthMs: number | null, map: SoundMap | null): number[] {
  return words.map((w, i) => {
    const next = words[i + 1]?.startMs ?? (lengthMs !== null ? Math.max(lengthMs, w.startMs + 200) : w.startMs + 1500);
    const guess = Math.min(1400, Math.max(300, 150 + 70 * letters(w.text)));
    const cap = Math.min(next, w.startMs + 1400);
    if (map !== null) {
      const stops = soundEnd(map, w.startMs, cap);
      if (stops !== null) return Math.max(w.startMs + 120, Math.min(cap, stops + 60));
    }
    return Math.max(w.startMs + 120, Math.min(next, w.startMs + guess));
  });
}

const SENTENCE_END = /[.!?…]["'”’)\]]*$/;
const CLAUSE_END = /[,;:]["'”’)\]]*$/;

/** Words that start a caption's first line must fit the lines allowed: this says whether `from..to` of the words does. */
function fitsWords(words: readonly Word[], from: number, to: number, limits: Limits): boolean {
  return wrapLines(words.slice(from, to).map((w) => w.text).join(" "), limits.maxChars).length <= limits.maxLines;
}

/** One run of words cut into pieces that each fit a caption: at the best place near the middle (a clause end, a pause) and again for each half that is still too long. */
function cutToFit(words: readonly Word[], ends: readonly number[], from: number, to: number, limits: Limits): [number, number][] {
  if (to - from <= 1 || fitsWords(words, from, to, limits)) return [[from, to]];
  const total = words.slice(from, to).reduce((n, w) => n + w.text.length + 1, 0);
  let best = from + 1;
  let bestScore = Infinity;
  let left = 0;
  for (let k = from + 1; k < to; k++) {
    left += words[k - 1]!.text.length + 1;
    const gap = Math.max(0, words[k]!.startMs - ends[k - 1]!);
    const score = Math.abs(total - 2 * left) - (CLAUSE_END.test(words[k - 1]!.text) ? 14 : 0) - Math.min(14, gap / 60);
    if (score < bestScore) {
      bestScore = score;
      best = k;
    }
  }
  return [...cutToFit(words, ends, from, best, limits), ...cutToFit(words, ends, best, to, limits)];
}

/** A pause this long ends a caption even where the sentence goes on. */
export const LONG_PAUSE_MS = 1200;
/** A caption shorter than this many characters is joined to its neighbour when the two fit and there is no pause between them. */
const SHORT_CAPTION = 25;
const JOIN_GAP_MS = 800;

/**
 * Captions from timed words. Each begins when its first word does and ends when its last word ends (where the voice stops), so what is shown matches what is heard. A sentence that
 * fits two lines of 42 characters is one caption; a longer one is cut at a comma or a pause near its middle; a caption that would be on screen for only a blink is joined to its
 * neighbour. Nothing here changes a word.
 */
export function cuesFromWords(words: readonly Word[], ends: readonly number[], lengthMs: number | null, limits: Limits = DEFAULT_LIMITS): Cue[] {
  if (words.length === 0) return [];
  // Sentences: ended by the punctuation the recogniser wrote, or by a long pause.
  const runs: [number, number][] = [];
  let from = 0;
  for (let i = 0; i < words.length; i++) {
    const last = i === words.length - 1;
    const pause = !last && words[i + 1]!.startMs - ends[i]! >= LONG_PAUSE_MS;
    if (last || SENTENCE_END.test(words[i]!.text) || pause) {
      runs.push([from, i + 1]);
      from = i + 1;
    }
  }
  let pieces: [number, number][] = runs.flatMap(([a, b]) => cutToFit(words, ends, a, b, limits));
  // Short pieces next to each other, with no pause, are one caption when they fit.
  const joined: [number, number][] = [];
  for (const p of pieces) {
    const prev = joined[joined.length - 1];
    if (prev !== undefined) {
      const lenPrev = words.slice(prev[0], prev[1]).reduce((n, w) => n + w.text.length + 1, 0);
      const lenThis = words.slice(p[0], p[1]).reduce((n, w) => n + w.text.length + 1, 0);
      const gap = words[p[0]]!.startMs - ends[prev[1] - 1]!;
      if ((lenPrev < SHORT_CAPTION || lenThis < SHORT_CAPTION) && gap < JOIN_GAP_MS && fitsWords(words, prev[0], p[1], limits)) {
        prev[1] = p[1];
        continue;
      }
    }
    joined.push([p[0], p[1]]);
  }
  pieces = joined;
  const cues: Cue[] = pieces.map(([a, b], i) => ({
    id: `c${i + 1}`,
    startMs: words[a]!.startMs,
    endMs: ends[b - 1]!,
    text: wrapLines(words.slice(a, b).map((w) => w.text).join(" "), limits.maxChars).join("\n"),
  }));
  // A caption is never on screen over the next, and one that would be gone in a blink stays as long as there is room.
  return cues.map((c, i) => {
    const nextStart = cues[i + 1]?.startMs ?? (lengthMs ?? Infinity);
    let end = Math.min(c.endMs, nextStart);
    if (end - c.startMs < limits.minMs) end = Math.min(c.startMs + limits.minMs, nextStart);
    return { ...c, endMs: Math.max(end, c.startMs + 1) };
  });
}

// ---- the captions an author already has, timed by the voice

const plain = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "").replace(/'/g, "");

export interface Placed {
  cues: Cue[];
  /** Words of the captions that the voice said (heard exactly). */
  matched: number;
  total: number;
}

/** The most cells of the word-by-word comparison that will be worked out: about 25 minutes of speech against its own captions. */
const MAX_CELLS = 36_000_000;

/**
 * The captions' own words set against the words that were heard, and the captions given the voice's times. The words are the author's and are never changed: only when each caption
 * starts and ends. A word the recogniser got wrong still has its place (it sits between the words around it), so one mistake does not move a caption. If the voice does not seem to
 * say these words at all, the answer is a problem in words, and nothing is changed.
 */
export function placeByVoice(cues: readonly Cue[], heard: readonly Word[], ends: readonly number[], lengthMs: number | null, limits: Limits = DEFAULT_LIMITS): Placed | string {
  const script: { word: string; cue: number }[] = [];
  cues.forEach((c, ci) => {
    for (const w of c.text.split(/\s+/)) {
      const p = plain(w);
      if (p !== "") script.push({ word: p, cue: ci });
    }
  });
  const hyp = heard.map((w) => plain(w.text));
  if (script.length === 0) return "The captions have no words to place.";
  if (hyp.length === 0) return "No words were heard in the sound, so the times were not changed.";
  const n = script.length;
  const m = hyp.length;
  if (n * m > MAX_CELLS) return "The captions are too long to set by the voice in one go. Do the first part of the video, then the rest.";
  const d = new Uint16Array((n + 1) * (m + 1));
  const at = (i: number, j: number): number => i * (m + 1) + j;
  for (let i = 0; i <= n; i++) d[at(i, 0)] = i;
  for (let j = 0; j <= m; j++) d[at(0, j)] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[at(i, j)] = Math.min(d[at(i - 1, j)]! + 1, d[at(i, j - 1)]! + 1, d[at(i - 1, j - 1)]! + (script[i - 1]!.word === hyp[j - 1] ? 0 : 1));
    }
  }
  // Walk back, noting for every word of the captions which heard word it lines up with (exactly, or as a mistake in its place).
  const line: (number | null)[] = new Array(n).fill(null);
  let exact = 0;
  for (let i = n, j = m; i > 0 || j > 0;) {
    if (i > 0 && j > 0 && d[at(i, j)] === d[at(i - 1, j - 1)]! + (script[i - 1]!.word === hyp[j - 1] ? 0 : 1)) {
      line[i - 1] = j - 1;
      if (script[i - 1]!.word === hyp[j - 1]) exact++;
      i--;
      j--;
    } else if (i > 0 && d[at(i, j)] === d[at(i - 1, j)]! + 1) i--;
    else j--;
  }
  if (exact / n < 0.5) return `The voice does not seem to say these words: only ${exact} of ${n} words were heard. The times were not changed.`;
  // Each caption starts at its first word that lines up and ends at its last, with the unplaced ones between neighbours filled in.
  const startOf = (index: number): number | null => (line[index] === null ? null : heard[line[index]!]!.startMs);
  const first: number[] = [];
  const last: number[] = [];
  script.forEach((s, i) => {
    first[s.cue] = first[s.cue] ?? i;
    last[s.cue] = i;
  });
  const placedStart: (number | null)[] = cues.map((_c, ci) => {
    for (let i = first[ci] ?? 0; i <= (last[ci] ?? -1); i++) {
      const t = startOf(i);
      if (t !== null) return t;
    }
    return null;
  });
  const placedEnd: (number | null)[] = cues.map((_c, ci) => {
    for (let i = last[ci] ?? -1; i >= (first[ci] ?? 0); i--) if (line[i] !== null) return ends[line[i]!]!;
    return null;
  });
  // A caption with nothing lined up (or no words) takes the gap between its neighbours.
  const out: Cue[] = cues.map((c, ci) => {
    let start: number | null = placedStart[ci] ?? null;
    let end: number | null = placedEnd[ci] ?? null;
    if (start === null || end === null) {
      let before = ci - 1;
      while (before >= 0 && placedEnd[before] === null) before--;
      let after = ci + 1;
      while (after < cues.length && placedStart[after] === null) after++;
      const lo = before >= 0 ? placedEnd[before]! : 0;
      const hi = after < cues.length ? placedStart[after]! : (lengthMs ?? lo + 2000);
      const between = after - before - 1;
      const share = (hi - lo) / Math.max(1, between);
      start = Math.round(lo + share * (ci - before - 1));
      end = Math.round(start + share);
    }
    return { ...c, startMs: start, endMs: end };
  });
  const timed = out.map((c, i) => {
    const nextStart = out[i + 1]?.startMs ?? (lengthMs ?? Infinity);
    let end = Math.min(c.endMs, nextStart);
    if (end - c.startMs < limits.minMs) end = Math.min(c.startMs + limits.minMs, nextStart);
    return { ...c, endMs: Math.max(end, c.startMs + 1) };
  });
  return { cues: timed, matched: exact, total: n };
}

// ---- a hint of the course's own words

/** Words that start a heading in nearly every course and say nothing about this one. */
const COMMON_HEADING_WORDS = new Set([
  "about", "after", "again", "answer", "assessment", "before", "chapter", "conclusion", "course", "example", "introduction", "lesson", "module", "overview", "practice", "question",
  "quiz", "results", "review", "section", "slide", "summary", "test", "their", "there", "these", "those", "unit", "using", "watch", "welcome", "what", "when", "where", "which",
  "while", "with", "your", "step", "next", "back", "start", "finish", "making", "make", "this", "that", "from", "into", "have", "does", "choose", "click", "press", "open",
]);

/** "Dr." and its like do not end a sentence, so the name after one is still a name. */
const ABBREVIATION = /^(?:dr|mr|mrs|ms|prof|st|jr|sr|vs|etc|inc|no)\.$/i;

export interface HintSources {
  /** The course's title. */
  title: string;
  /** Slide names and headings: short, so every capitalised word in them counts. */
  headings: string[];
  /** Sentences of text and narration: only names, acronyms and words with a capital inside count. */
  prose: string[];
}

/**
 * A few of the names and terms in the course, to give the recogniser as a hint, which is the difference between "SUNY New Paltz" and "Sunny pouts". Acronyms (SCORM), words with a capital inside
 * (OpenStage, Brightspace's relatives), names inside a sentence, and the capitalised words of headings that are not the plain words every heading uses. Most often first, at most `maxChars`.
 */
export function hintFor(src: HintSources, maxChars = 280): string {
  // A name, an acronym or a word with a capital inside (tier 3 and 2) is a better hint than the capitalised words of a heading, which are only in capitals because headings are (tier 1).
  const seen = new Map<string, { term: string; tier: number; count: number; order: number }>();
  let order = 0;
  const note = (term: string, tier: number) => {
    const key = term.toLowerCase();
    const hit = seen.get(key);
    if (hit) {
      hit.count++;
      hit.tier = Math.max(hit.tier, tier);
    } else seen.set(key, { term, tier, count: 1, order: order++ });
  };
  const strip = (s: string): string => s.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/gi, " ");
  for (const heading of [src.title, ...src.headings]) {
    for (const w of strip(heading).split(/[^\p{L}\p{N}'-]+/u)) {
      if (/^\p{Lu}{2,}$/u.test(w)) note(w, 3);
      else if (w.length >= 4 && /^\p{Lu}/u.test(w) && !COMMON_HEADING_WORDS.has(w.toLowerCase())) note(w, 1);
    }
  }
  for (const text of src.prose) {
    const words = strip(text).split(/\s+/).filter((w) => w !== "");
    words.forEach((raw, i) => {
      const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (w.length < 2) return;
      const before = words[i - 1] ?? "";
      const afterStop = i === 0 || (/[.!?:]$/.test(before) && !ABBREVIATION.test(before));
      if (/^\p{Lu}{2,}\d*$/u.test(w)) note(w, 3);
      else if (/^\p{Lu}\p{Ll}+\p{Lu}/u.test(w) || /^\p{Ll}+\p{Lu}/u.test(w)) note(w, 3);
      else if (!afterStop && /^\p{Lu}\p{Ll}{2,}$/u.test(w) && !COMMON_HEADING_WORDS.has(w.toLowerCase())) note(w, 2);
    });
  }
  const terms = [...seen.values()].sort((a, b) => b.tier - a.tier || b.count - a.count || a.order - b.order).map((t) => t.term);
  const out: string[] = [];
  let length = 0;
  for (const t of terms) {
    if (length + t.length + 2 > maxChars) break;
    out.push(t);
    length += t.length + 2;
  }
  return out.join(", ");
}

/**
 * Where the course's own words are: its title, the names of its slides and the text marked as a heading (short, so every capitalised word counts), and the rest of its text and
 * every narration script (only names, acronyms and unusual words count). What the author wrote is read; nothing is sent anywhere.
 */
export function hintSourcesOf(project: { meta: { title: string } }, slides: readonly Slide[]): HintSources {
  const headings: string[] = [];
  const prose: string[] = [];
  for (const slide of slides) {
    headings.push(slide.name);
    for (const layer of [slide.baseLayer, ...slide.layers]) {
      for (const o of layer.objects) {
        if (o.type === "text" || o.type === "scrollingText") (o.accessibility.role === "heading" ? headings : prose).push(String(o.content["html"] ?? ""));
        const script = (o.narration as { script?: unknown } | null)?.script;
        if (typeof script === "string" && script.trim() !== "") prose.push(script);
      }
    }
  }
  return { title: project.meta.title, headings, prose };
}

// ---- the sound, as the recogniser reads it

/** A 16 kHz mono WAV file of 16-bit samples, which is what the recogniser reads. */
export function encodeWav(samples: Int16Array, rate = 16000): Uint8Array {
  const data = samples.length * 2;
  const out = new Uint8Array(44 + data);
  const v = new DataView(out.buffer);
  const tag = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i); };
  tag(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, samples[i]!, true);
  return out;
}

/** The longest clip that will be listened to in one go, in minutes, because the sound is read into memory. */
export const MAX_LISTEN_MINUTES = 45;
