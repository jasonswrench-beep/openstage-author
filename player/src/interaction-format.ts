// How a learner's answer and the right answer are written for SCORM 2004 and for xAPI. The two standards share one
// syntax: lists are joined with [,], a matching pair with [.], a number range with [:], and a typed answer can begin with
// {case_matters=...}{order_matters=...}. SCORM 1.2 uses its own plainer forms, which grading.ts produces and scorm.ts sends.
// Nothing here knows about a page or an LMS, so all of it is tested directly.

import { LONG_LIMIT, cutTo, type Graded } from "./grading.ts";
import type { InputInteraction, QuizContent } from "./types.ts";

export type InteractionKind = "choice" | "fill-in" | "long-fill-in" | "numeric" | "matching" | "sequencing" | "true-false" | "likert" | "other";

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

/** What SCORM 2004 takes as a language: two or three letters, then any number of subtags (en, en-US, zh-Hans-CN). */
const LANGUAGE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/**
 * A long fill-in's answer in the form SCORM 2004 stores it. In SCORM 2004 that answer is a "localized string": text that may begin with a language marker such as
 * {lang=en-US}. An LMS therefore reads an answer that begins with "{" as the start of such a marker, and what it stores is not what the learner wrote (an essay that begins
 * "{lang=xx}" loses those nine characters and is filed under the language xx). So an answer that begins with "{" is given a marker of its own first, in the course's
 * language, and everything after that first marker is the learner's words exactly as written. An answer that does not begin with "{" is left alone.
 * The marker counts toward the 4000 characters a long fill-in holds, so a very long answer loses its last few characters rather than being refused outright.
 * A course language that is not a language code is replaced by an empty one ({lang=}), which ends the ambiguity just the same.
 * Nothing in the player reads an answer back from the LMS, so there is no step to undo this here. Whoever reads the record takes off exactly one leading marker,
 * and the learner's own words, even words that begin with a marker, are what is left (interaction-format.test.ts shows it).
 */
export function longResponse2004(response: string, language: string): string {
  if (!response.startsWith("{")) return response;
  const marker = `{lang=${LANGUAGE.test(language) ? language : ""}}`;
  return marker + cutTo(response, LONG_LIMIT - marker.length);
}

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
    case "essay":
      // Nothing to compare it with: the pattern list is empty and whoever reads the record judges the writing. Spaces were tidied when it was graded.
      // SCORM 1.2 got the first 255 characters (g.response); a long fill-in holds up to 4000, so these two standards are given the whole of it.
      return { kind: "long-fill-in", response: g.longResponse ?? g.response, patterns: [] };
    case "whichWord":
    case "shortcut":
      return { kind: "fill-in", response: safe(g.response), patterns: g.patterns.map(safe) };
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
export function formatInput(type: InputInteraction, response: string): { kind: InteractionKind; response: string } {
  // The course sends 1 or 0 for a ticked or unticked box; both standards want the words.
  if (type === "true-false") return { kind: "true-false", response: response === "1" ? "true" : response === "0" ? "false" : response };
  // Words the learner typed: both standards take about 250 characters of a short fill-in.
  if (type === "fill-in") return { kind: "fill-in", response: response.slice(0, 250) };
  return { kind: type, response };
}

/**
 * The name SCORM 2004 gives each kind. It is the same word SCORM 1.2 and xAPI use, with hyphens (`true-false`, `fill-in`, `long-fill-in`): the 2004 vocabulary
 * spells them that way too. Underscores were sent here once, and a strict LMS refuses such a type with error 406 and then every answer with 408.
 */
export const scorm2004Type = (kind: InteractionKind): string => kind;
