// Putting a question read from a spreadsheet into the objects the editor makes for a question (see factory.ts, `buildQuiz`): the heading that says it, the
// question itself with its answers, and the two layers of feedback. Used by Add questions from a spreadsheet and by the games that are filled from one.
// Nothing here touches the project.

import type { Layer, OSObject } from "../../player/src/types.ts";
import type { ImportedQuestion } from "./questionimport.ts";

export const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Words with a paragraph for each line, as HTML. */
export const paragraphs = (text: string): string => text.split(/\r?\n/).filter((t) => t.trim() !== "").map((t) => `<p>${escapeHtml(t)}</p>`).join("");

/** Words on one line, for a name a screen reader says. */
export const plainWords = (text: string): string => text.replace(/\s+/g, " ").trim();

/** What a learner who got it wrong is told if the table did not say: where the right answer is, in words, so nobody has to guess. */
export function rightAnswerWords(q: ImportedQuestion): string {
  const said = q.correct.map((i) => q.answers[i]).filter((a): a is string => typeof a === "string");
  if (q.type === "short") return `An accepted answer is ${q.answers[0] ?? ""}.`;
  if (said.length === 0) return "";
  if (said.length === 1) return `The right answer is ${said[0]}.`;
  return `The right answers are ${said.slice(0, -1).join(", ")} and ${said[said.length - 1]}.`;
}

export interface FillOptions {
  points: number;
  attempts: number;
  /** Mix the answers of a multiple choice or multiple response question for each learner. */
  shuffleAnswers: boolean;
  /** The feedback when the table says nothing. */
  right: string;
  wrong: string;
}

/**
 * Write a question into what `buildQuiz` made: `built.objects` is [the heading, the question] and `built.layers` is [the right-answer layer, the wrong-answer
 * layer]. The heading shrinks to fit its box if a long question needs it. The name a screen reader gives a question's answers is the question itself, because it is
 * the author's own words and they will see it in Alt text.
 */
export function fillQuiz(built: { objects: OSObject[]; layers: Layer[] }, q: ImportedQuestion, o: FillOptions): void {
  const [prompt, quiz] = built.objects as [OSObject, OSObject];
  prompt.content = { html: `<h2>${escapeHtml(q.question)}</h2>` };
  prompt.style = { ...prompt.style, autoFit: "shrink" };
  prompt.accessibility = { ...prompt.accessibility, altText: plainWords(q.question) };
  const choices = q.answers.map((label, i) => ({ id: `c${i + 1}`, label, correct: q.correct.includes(i) }));
  const body: Record<string, unknown> =
    q.type === "short" ? { questionType: "shortAnswer", answers: q.answers, caseSensitive: false }
    : q.type === "mr" ? { questionType: "multipleResponse", choices }
    : { questionType: "multipleChoice", choices };
  if (o.shuffleAnswers && (q.type === "mc" || q.type === "mr")) body["shuffle"] = true;
  quiz.content = { ...body, scoring: { points: o.points, attemptsAllowed: o.attempts }, feedback: (quiz.content as { feedback: unknown }).feedback };
  quiz.accessibility = { ...quiz.accessibility, altText: plainWords(q.question) };
  if (q.type === "mc" || q.type === "mr") quiz.geometry = { ...quiz.geometry, height: Math.max(quiz.geometry.height, 80 + 48 * choices.length) };
  const [right, wrong] = built.layers as [Layer, Layer];
  const say = (layer: Layer, text: string) => {
    const feedback = layer.objects[0]!;
    feedback.content = { html: paragraphs(text) };
    feedback.accessibility = { ...feedback.accessibility, altText: plainWords(text) };
  };
  say(right, q.rightFeedback || o.right);
  say(wrong, q.wrongFeedback || o.wrong);
}
