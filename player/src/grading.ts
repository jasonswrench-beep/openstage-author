// Grading: what a learner's answer to a question comes to. No page and no course in here, so all of it is tested directly.
//
// An answer is always a short piece of text, so it can be saved with the learner's place and put back when they return:
//   multipleChoice  the id of the choice
//   multipleResponse  the ids of the ticked choices, separated by commas
//   shortAnswer, numeric  what was typed
//   fillBlanks  a list of what is in each blank, in the order of the blanks, as JSON
//   matching  "item:option" pairs, separated by commas, where the item and the option are the ids of the pair the option belongs to
//   sequencing  the ids of the items in the learner's order, separated by commas
//   hotspot  the id of the area chosen
//   essay  what was written
//   whichWord  the id of the word chosen (w1, w2 ... by its place in the passage, see passage.ts)
//   shortcut  what was typed, or the keys pressed, written as shortcut.ts writes them
//
// How much of the points an answer earns is a fraction from 0 to 1. A question with one thing to get right (multiple choice, short answer,
// numeric, a hotspot) gives all of it or none. A question with several parts gives a share for the parts that are right:
//   multipleResponse  the right choices ticked, less the wrong ones ticked, over the number of right choices, never below nothing
//   fillBlanks  the blanks that are right over all the blanks
//   matching  the items matched rightly over all the items
//   sequencing  the items in their right place over all the items
// An essay has no right answer to check against, so it is done or not: done once it has the fewest words the author asked for.

import type { ChoiceQuiz, EssayQuiz, FillBlanksQuiz, HotspotQuiz, MatchingQuiz, NumericQuiz, QuizContent, SequencingQuiz, ShortAnswerQuiz, ShortcutQuiz, WhichWordQuiz } from "./types.ts";
import { readPassage } from "./passage.ts";
import { t, tn } from "./playertext.ts";
import { canonicalShortcut } from "./shortcut.ts";

/** The kinds of interaction SCORM 1.2 knows, and so the ones an LMS can be told about. */
export type ScormType = "choice" | "fill-in" | "numeric" | "matching" | "sequencing";

export interface Graded {
  /** How much of the answer is right, from 0 to 1. */
  fraction: number;
  /** Every part is right. */
  correct: boolean;
  scormType: ScormType;
  /** What to tell the LMS the learner answered. */
  response: string;
  /** What to tell the LMS is right, one pattern for each way of being right. */
  patterns: string[];
  /** Only for blanks: what is in each, and the first accepted answer of each. SCORM 2004 and xAPI have their own separator, so they need the parts, not the text joined with commas. */
  blankParts?: { response: string[]; pattern: string[] };
}

/** The words in some writing: runs of letters or numbers between spaces. A dash or a lone mark on its own is not a word. */
export const countWords = (text: string): number => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** SCORM 1.2 holds 255 characters of an answer. */
const LIMIT = 255;
const cut = (s: string): string => (s.length > LIMIT ? s.slice(0, LIMIT) : s);

/** a, b, c ... for the first, second, third. SCORM names choices and targets this way. */
export const letter = (index: number): string => String.fromCharCode(97 + Math.max(0, Math.min(25, index)));

// ---- typed text

/** Spaces tidied, and capitals ignored unless they matter. */
export function tidy(text: string, caseSensitive: boolean): string {
  const t = text.normalize("NFC").replace(/\s+/g, " ").trim();
  return caseSensitive ? t : t.toLowerCase();
}

/**
 * A number typed by a person. Spaces are ignored, "1,234.5" and "1,234" use the comma for thousands, and "1,5" uses it as a decimal point.
 * Anything else that is not a number gives null.
 */
export function parseNumber(typed: string): number | null {
  let s = typed.replace(/[\s ]/g, "");
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^[+-]?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---- blanks, pairs and lists in an answer

export type TextPart = { type: "text"; value: string } | { type: "blank"; id: string };

/** A sentence cut into its words and its blanks. A blank is written {id}. */
export function splitBlanks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  for (const m of text.matchAll(/\{([A-Za-z0-9_-]+)\}/g)) {
    if (m.index > at) parts.push({ type: "text", value: text.slice(at, m.index) });
    parts.push({ type: "blank", id: m[1]! });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ type: "text", value: text.slice(at) });
  return parts;
}

export const encodeBlanks = (values: string[]): string => JSON.stringify(values);

/** What is in each blank, `count` of them, with an empty string for any not answered. A damaged answer is all empty. */
export function decodeBlanks(answer: string, count: number): string[] {
  let values: unknown;
  try { values = JSON.parse(answer); } catch { values = []; }
  const list = Array.isArray(values) ? values : [];
  return Array.from({ length: count }, (_, i) => (typeof list[i] === "string" ? (list[i] as string) : ""));
}

export const encodePairs = (chosen: Record<string, string>): string =>
  Object.entries(chosen).filter(([, option]) => option !== "").map(([item, option]) => `${item}:${option}`).join(",");

export function decodePairs(answer: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of answer.split(",")) {
    const [item, option] = part.split(":");
    if (item && option) out[item] = option;
  }
  return out;
}

const ids = (answer: string): string[] => answer.split(",").map((s) => s.trim()).filter(Boolean);

// ---- what a question shows

/** The options of a matching question, as the author wrote them: each right match, then the extras. The ids of the right ones are the pairs'. */
export function matchOptions(q: MatchingQuiz): { id: string; text: string }[] {
  return [...q.pairs.map((p) => ({ id: p.id, text: p.match })), ...q.extras.map((text, i) => ({ id: `x${i + 1}`, text }))];
}

function seedOf(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The same shuffle every time for the same seed, so a question looks the same each time a learner opens it, and in the editor.
 * If there is more than one thing, the result is never left in the order it came in.
 */
export function stableShuffle<T>(items: T[], seed: string): T[] {
  const out = [...items];
  let a = seedOf(seed);
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  if (out.length > 1 && out.every((x, i) => x === items[i])) out.push(out.shift()!);
  return out;
}

// ---- grading

const whole = (right: boolean, base: Omit<Graded, "fraction" | "correct">): Graded => ({ ...base, fraction: right ? 1 : 0, correct: right });

function gradeChoice(q: ChoiceQuiz, answer: string): Graded {
  const index = (id: string) => q.choices.findIndex((c) => c.id === id);
  const correctIds = q.choices.filter((c) => c.correct).map((c) => c.id);
  const patterns = [correctIds.map((id) => letter(index(id))).join(",")];
  if (q.questionType === "multipleChoice") {
    const right = q.choices.some((c) => c.id === answer && c.correct);
    return whole(right, { scormType: "choice", response: letter(index(answer)), patterns });
  }
  const picked = [...new Set(ids(answer))].filter((id) => index(id) !== -1);
  const rightPicked = picked.filter((id) => correctIds.includes(id)).length;
  const wrongPicked = picked.length - rightPicked;
  const fraction = correctIds.length === 0 ? 0 : Math.max(0, (rightPicked - wrongPicked) / correctIds.length);
  const sorted = [...picked].sort((a, b) => index(a) - index(b));
  return { fraction, correct: rightPicked === correctIds.length && wrongPicked === 0, scormType: "choice", response: sorted.map((id) => letter(index(id))).join(","), patterns };
}

function gradeShort(q: ShortAnswerQuiz, answer: string): Graded {
  const accepted = q.answers.map((a) => tidy(a, q.caseSensitive));
  return whole(accepted.includes(tidy(answer, q.caseSensitive)), { scormType: "fill-in", response: cut(answer.trim()), patterns: q.answers.map(cut) });
}

/** A number is within a range with a little room for the way computers add up, so 0.1 + 0.2 is accepted as 0.3. */
const within = (n: number, min: number, max: number): boolean => {
  const room = 1e-9 * Math.max(1, Math.abs(min), Math.abs(max), Math.abs(n));
  return n >= min - room && n <= max + room;
};

function gradeNumeric(q: NumericQuiz, answer: string): Graded {
  const n = parseNumber(answer);
  const pattern = q.min === q.max ? String(q.min) : `${q.min}#${q.max}`;
  return whole(n !== null && within(n, q.min, q.max), { scormType: "numeric", response: n === null ? cut(answer.trim()) : String(n), patterns: [pattern] });
}

function gradeBlanks(q: FillBlanksQuiz, answer: string): Graded {
  const values = decodeBlanks(answer, q.blanks.length);
  const typed = q.mode === "typed";
  // A word picked from a list is exact. A typed word has its spaces tidied, and its capitals ignored unless they matter.
  const same = (a: string, b: string) => tidy(a, typed ? q.caseSensitive : true) === tidy(b, typed ? q.caseSensitive : true);
  const right = q.blanks.filter((b, i) => values[i]!.trim() !== "" && b.answers.some((a) => same(a, values[i]!))).length;
  const fraction = q.blanks.length === 0 ? 0 : right / q.blanks.length;
  return {
    fraction,
    correct: q.blanks.length > 0 && right === q.blanks.length,
    scormType: "fill-in",
    response: cut(values.map((v) => v.trim()).join(",")),
    patterns: [cut(q.blanks.map((b) => b.answers[0] ?? "").join(","))],
    blankParts: { response: values.map((v) => v.trim()), pattern: q.blanks.map((b) => b.answers[0] ?? "") },
  };
}

function gradeMatching(q: MatchingQuiz, answer: string): Graded {
  const chosen = decodePairs(answer);
  const options = matchOptions(q);
  const target = (id: string | undefined) => letter(options.findIndex((o) => o.id === id));
  const right = q.pairs.filter((p) => chosen[p.id] === p.id).length;
  return {
    fraction: q.pairs.length === 0 ? 0 : right / q.pairs.length,
    correct: q.pairs.length > 0 && right === q.pairs.length,
    scormType: "matching",
    response: q.pairs.filter((p) => chosen[p.id]).map((p) => `${q.pairs.indexOf(p) + 1}.${target(chosen[p.id])}`).join(","),
    patterns: [q.pairs.map((p, i) => `${i + 1}.${target(p.id)}`).join(",")],
  };
}

function gradeSequence(q: SequencingQuiz, answer: string): Graded {
  const order = ids(answer);
  const rightPlace = q.items.filter((item, i) => order[i] === item.id).length;
  const at = (id: string) => letter(q.items.findIndex((item) => item.id === id));
  return {
    fraction: q.items.length === 0 ? 0 : rightPlace / q.items.length,
    correct: q.items.length > 0 && rightPlace === q.items.length && order.length === q.items.length,
    scormType: "sequencing",
    response: order.filter((id) => q.items.some((item) => item.id === id)).map(at).join(","),
    patterns: [q.items.map((item) => at(item.id)).join(",")],
  };
}

function gradeHotspot(q: HotspotQuiz, answer: string): Graded {
  const index = q.regions.findIndex((r) => r.id === answer);
  return whole(index !== -1 && q.regions[index]!.correct, {
    scormType: "choice",
    response: index === -1 ? "" : letter(index),
    patterns: q.regions.flatMap((r, i) => (r.correct ? [letter(i)] : [])),
  });
}

/** An essay is done when it has the fewest words asked for, and at least one. It is not marked for what it says. */
export const essayDone = (q: EssayQuiz, answer: string): boolean => countWords(answer) >= Math.max(1, q.minWords);

function gradeEssay(q: EssayQuiz, answer: string): Graded {
  // 1.2 has only a short fill-in to put it in; SCORM 2004 and xAPI are told it is a long one (see interaction-format.ts). No right answer to send.
  return whole(essayDone(q, answer), { scormType: "fill-in", response: cut(answer.replace(/\s+/g, " ").trim()), patterns: [] });
}

function gradeWhichWord(q: WhichWordQuiz, answer: string): Graded {
  const words = readPassage(q.passage).words;
  const chosen = words.find((w) => w.id === answer);
  const rightTexts = [...new Set(words.filter((w) => w.right).map((w) => w.text))];
  return whole(chosen?.right === true, { scormType: "fill-in", response: cut(chosen?.text ?? ""), patterns: rightTexts.map(cut) });
}

function gradeShortcut(q: ShortcutQuiz, answer: string): Graded {
  const accepted = q.keys.map((k) => canonicalShortcut(k) ?? k.trim());
  const typed = canonicalShortcut(answer);
  return whole(typed !== null && accepted.includes(typed), { scormType: "fill-in", response: cut(typed ?? answer.trim()), patterns: accepted.map(cut) });
}

/** How an answer to this question comes out. */
export function grade(q: QuizContent, answer: string): Graded {
  switch (q.questionType) {
    case "multipleChoice":
    case "multipleResponse": return gradeChoice(q, answer);
    case "shortAnswer": return gradeShort(q, answer);
    case "numeric": return gradeNumeric(q, answer);
    case "fillBlanks": return gradeBlanks(q, answer);
    case "matching": return gradeMatching(q, answer);
    case "sequencing": return gradeSequence(q, answer);
    case "hotspot": return gradeHotspot(q, answer);
    case "essay": return gradeEssay(q, answer);
    case "whichWord": return gradeWhichWord(q, answer);
    case "shortcut": return gradeShortcut(q, answer);
  }
}

/** Has the learner given something to check? A question with several parts can be checked with only some of them filled in. */
export function isAnswered(q: QuizContent, answer: string | null): boolean {
  if (answer === null) return false;
  switch (q.questionType) {
    case "multipleChoice":
    case "hotspot": return answer.trim() !== "";
    case "multipleResponse": return ids(answer).length > 0;
    case "shortAnswer":
    case "numeric": return answer.trim() !== "";
    case "fillBlanks": return decodeBlanks(answer, q.blanks.length).some((v) => v.trim() !== "");
    case "matching": return Object.keys(decodePairs(answer)).length > 0;
    case "sequencing": return true;
    case "essay": return essayDone(q, answer);
    case "whichWord":
    case "shortcut": return answer.trim() !== "";
  }
}

/** What to tell the learner when there is nothing to check yet. */
export function emptyMessage(q: QuizContent): string {
  switch (q.questionType) {
    case "multipleResponse": return t("quiz.emptyMulti");
    case "shortAnswer": return t("quiz.emptyShort");
    case "numeric": return t("quiz.emptyNumber");
    case "fillBlanks": return q.mode === "typed" ? t("quiz.emptyBlanksTyped") : t("quiz.emptyBlanksChoose");
    case "matching": return t("quiz.emptyMatching");
    case "hotspot": return t("quiz.emptyArea");
    case "whichWord": return t("quiz.emptyWord");
    case "shortcut": return t("quiz.emptyShortcut");
    case "essay": return q.minWords > 1 ? tn("quiz.emptyEssayWords", q.minWords) : t("quiz.emptyEssay");
    default: return t("quiz.emptyDefault");
  }
}

/** How a question's answer is kept when a learner leaves and returns. SCORM 1.2 has little room for it, so a long one is not kept. */
export const keepAnswer = (answer: string): string => (answer.length <= 200 ? answer : "");
