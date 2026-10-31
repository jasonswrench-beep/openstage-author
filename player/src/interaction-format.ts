// How a learner's answer and the right answer are written for SCORM 2004 and for xAPI. The two standards share one
// syntax: lists are joined with [,], a matching pair with [.], a number range with [:], and a typed answer can begin with
// {case_matters=...}{order_matters=...}. SCORM 1.2 uses its own plainer forms, which grading.ts produces and scorm.ts sends.
// Nothing here knows about a page or an LMS, so all of it is tested directly.

import type { Graded } from "./grading.ts";
import type { QuizContent } from "./types.ts";

export type InteractionKind = "choice" | "fill-in" | "numeric" | "matching" | "sequencing" | "true-false" | "likert" | "other";

export interface FormattedInteraction {
  kind: InteractionKind;
  /** What the learner answered. */
  response: string;
  /** What is right, one pattern for each way of being right. */
  patterns: string[];
}

const LIST = "[,]";
const PAIR = "[.]";
const RANGE = "[:]";

/** A person's words go between these separators, so none of them may appear inside the words. */
const safe = (text: string): string => text.split(LIST).join("[ ,]").split(PAIR).join("[ .]").split(RANGE).join("[ :]");

/** a,b,c with the comma SCORM 1.2 uses becomes a[,]b[,]c. */
const list = (text: string): string => text.split(",").filter((s) => s !== "").join(LIST);

/** 1.a,2.b becomes 1[.]a[,]2[.]b. */
const pairs = (text: string): string => text.split(",").filter((s) => s !== "").map((p) => p.split(".").join(PAIR)).join(LIST);

/** SCORM 2004 asks for a real number as the answer to a numeric question. Anything else is sent as "other", which takes any text. */
const isReal = (text: string): boolean => /^-?\d+(\.\d+)?$/.test(text);

/** The answer to a quiz question, in the form SCORM 2004 and xAPI take. */
export function formatGraded(q: QuizContent, g: Graded): FormattedInteraction {
  switch (q.questionType) {
    case "multipleChoice":
    case "multipleResponse":
    case "hotspot":
      return { kind: "choice", response: list(g.response), patterns: g.patterns.map(list) };
    case "sequencing":
      return { kind: "sequencing", response: list(g.response), patterns: g.patterns.map(list) };
    case "matching":
      return { kind: "matching", response: pairs(g.response), patterns: g.patterns.map(pairs) };
    case "numeric": {
      const patterns = g.patterns.map((p) => (p.includes("#") ? p.split("#").join(RANGE) : p));
      return isReal(g.response) ? { kind: "numeric", response: g.response, patterns } : { kind: "other", response: g.response, patterns };
    }
    case "shortAnswer": {
      const flag = q.caseSensitive ? "{case_matters=true}" : "";
      return { kind: "fill-in", response: safe(g.response), patterns: g.patterns.map((p) => flag + safe(p)) };
    }
    case "fillBlanks": {
      // A word picked from a list is exact; a typed word has its capitals ignored unless the author said they matter.
      const caseMatters = q.mode === "typed" ? q.caseSensitive : true;
      const flags = `{case_matters=${caseMatters}}{order_matters=true}`;
      const parts = g.blankParts;
      return {
        kind: "fill-in",
        response: parts ? parts.response.map(safe).join(LIST) : safe(g.response),
        patterns: parts ? [flags + parts.pattern.map(safe).join(LIST)] : g.patterns.map((p) => flags + safe(p)),
      };
    }
  }
}

/** An input (a checkbox, a radio group, a drop-down, a rating) that the author chose to report. */
export function formatInput(type: "choice" | "likert" | "true-false", response: string): { kind: InteractionKind; response: string } {
  // The course sends 1 or 0 for a ticked or unticked box; both standards want the words.
  if (type === "true-false") return { kind: "true-false", response: response === "1" ? "true" : response === "0" ? "false" : response };
  return { kind: type, response };
}

/** The name SCORM 2004 gives each kind (underscores, not hyphens). xAPI keeps the hyphens. */
export const scorm2004Type = (kind: InteractionKind): string => kind.replace("-", "_");
