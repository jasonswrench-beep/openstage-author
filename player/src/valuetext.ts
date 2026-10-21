// Words that show a number or a word that changes while the course is played: a text object can hold `{{Score}}`, and the player puts the variable's value there, and
// changes it when the value changes. This file has no screen in it. It says what a reference looks like, which names there are besides the author's own variables, and what
// each one is worth, so every part can be tested directly (valuetext.test.ts). The validator (tools/validate.py) reads references the same way: the two must agree.

import type { Primitive, Variable } from "./types.ts";

/** A reference is two braces, a name, and two braces. A name has no brace in it and is not long. */
export const VALUE_REFERENCE = /\{\{([^{}\n]{1,80})\}\}/g;

/** The values the course works out itself, from the questions answered so far. Their names start with a dollar sign, so no variable of the author's can share one. */
export const BUILT_IN_VALUES = [
  { name: "$score", label: "Points earned so far" },
  { name: "$possible", label: "Points possible in the whole course" },
  { name: "$percent", label: "Percent of the points earned so far" },
  { name: "$answered", label: "Questions finished" },
  { name: "$questions", label: "Questions in the whole course" },
  { name: "$correct", label: "Questions answered right" },
] as const;

export type BuiltInValue = (typeof BUILT_IN_VALUES)[number]["name"];

export const isBuiltInValue = (name: string): name is BuiltInValue => BUILT_IN_VALUES.some((v) => v.name === name);

/** A piece of a text: words as they are, or a reference to be filled in. */
export type TextPiece = { kind: "words"; text: string } | { kind: "value"; name: string };

/** Cut a text into its words and its references, in order. A text with none is one piece of words (or none, if it is empty). */
export function splitReferences(text: string): TextPiece[] {
  const out: TextPiece[] = [];
  let last = 0;
  for (const m of text.matchAll(VALUE_REFERENCE)) {
    const name = m[1]!.trim();
    if (name === "") continue;
    if (m.index! > last) out.push({ kind: "words", text: text.slice(last, m.index) });
    out.push({ kind: "value", name });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ kind: "words", text: text.slice(last) });
  return out;
}

/** The names of the references in a text, in order, each once. */
export function referencesIn(text: string): string[] {
  return [...new Set(splitReferences(text).flatMap((p) => (p.kind === "value" ? [p.name] : [])))];
}

/** How a value is written on the slide. A number is written as it is, true and false as yes and no, and a word as it is. */
export function showValue(v: Primitive | undefined): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

/** What the course has worked out about the questions so far. `percent` is null until the quiz is finished, as in the results box. */
export interface QuestionTotals {
  earnedPoints: number;
  totalPoints: number;
  percent: number | null;
  questions: number;
  finished: number;
  correct: number;
}

export interface ValueSource {
  variables: readonly Variable[];
  /** The value a variable has now. */
  valueOf(variableId: string): Primitive | undefined;
  totals(): QuestionTotals;
}

/** The variable with this name (capitals do not matter), if the course has one. */
export function variableNamed(variables: readonly Variable[], name: string): Variable | undefined {
  const wanted = name.trim().toLowerCase();
  return variables.find((v) => v.name.trim().toLowerCase() === wanted);
}

/** The words to show for one reference, or null if there is nothing by that name (the slide then shows the reference itself, so the mistake can be seen). */
export function valueFor(name: string, source: ValueSource): string | null {
  if (isBuiltInValue(name)) {
    const t = source.totals();
    switch (name) {
      case "$score": return String(t.earnedPoints);
      case "$possible": return String(t.totalPoints);
      case "$percent": return String(t.totalPoints > 0 ? Math.round((100 * t.earnedPoints) / t.totalPoints) : 0);
      case "$answered": return String(t.finished);
      case "$questions": return String(t.questions);
      case "$correct": return String(t.correct);
    }
  }
  const v = variableNamed(source.variables, name);
  return v ? showValue(source.valueOf(v.id)) : null;
}

/** A text with its references filled in, for a place that is not on a slide (such as a transcript, which is a fixed copy): each reference is written as its name in brackets. */
export function namesInBrackets(text: string): string {
  return splitReferences(text).map((p) => (p.kind === "words" ? p.text : `[${p.name.replace(/^\$/, "")}]`)).join("");
}
