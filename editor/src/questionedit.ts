// Changing a question: what each edit does to its content. Every edit is a small command, applied to a copy of the question, so a
// refused edit changes nothing and a real one is one step for Undo. The model applies them (Model.editQuestion); the window only
// builds the command from what the author typed. No page and no project in here, so all of it is tested directly.

import { stableShuffle } from "../../player/src/grading.ts";
import type { Blank, ChoiceQuiz, FillBlanksQuiz, HotspotQuiz, MatchingQuiz, NumericQuiz, QuizContent, Region, SequencingQuiz, ShortAnswerQuiz } from "../../player/src/types.ts";

/** A question without its scoring and feedback, whichever kind it is. */
export type QuestionBody<T = QuizContent> = T extends QuizContent ? Omit<T, "scoring" | "feedback"> : never;

export type QuestionEdit =
  | { op: "choiceCorrect"; id: string; correct: boolean }
  | { op: "choiceMode"; multiple: boolean }
  | { op: "shortAnswers"; text: string }
  | { op: "caseSensitive"; on: boolean }
  | { op: "numeric"; answer: number; tolerance: number }
  | { op: "blanksText"; text: string }
  | { op: "insertBlank"; at: number }
  | { op: "blankAnswers"; id: string; text: string }
  | { op: "blanksMode"; mode: FillBlanksQuiz["mode"] }
  | { op: "extraWords"; text: string }
  | { op: "addPair" }
  | { op: "deletePair"; id: string }
  | { op: "pairText"; id: string; field: "premise" | "match"; text: string }
  | { op: "movePair"; id: string; delta: -1 | 1 }
  | { op: "extras"; text: string }
  | { op: "drag"; on: boolean }
  | { op: "addItem" }
  | { op: "deleteItem"; id: string }
  | { op: "itemText"; id: string; text: string }
  | { op: "moveItem"; id: string; delta: -1 | 1 }
  | { op: "hotspotImage"; src: string }
  | { op: "hotspotAlt"; alt: string }
  | { op: "addRegion" }
  | { op: "deleteRegion"; id: string }
  | { op: "regionLabel"; id: string; label: string }
  | { op: "regionRect"; id: string; patch: Partial<Pick<Region, "x" | "y" | "width" | "height">> }
  | { op: "regionCorrect"; id: string; correct: boolean };

/** A message for the author, or a refusal with the reason. A refused edit changes nothing. */
export type EditResult = string | { refuse: string };

export const LIMITS = { choices: 8, answers: 10, blanks: 10, pairs: 10, extras: 5, items: 10, regions: 12, bank: 30 } as const;

const refuse = (reason: string): EditResult => ({ refuse: reason });

/** Lines of text as a list: tidied, empty ones dropped, and repeats dropped (ignoring capitals unless they matter). */
export function lines(text: string, caseSensitive = false): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    const key = caseSensitive ? line : line.toLowerCase();
    if (line === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

const next = (ids: string[], prefix: string): string => {
  let n = 1;
  while (ids.includes(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
};

const key = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

const round = (n: number, places = 2): number => Math.round(n * 10 ** places) / 10 ** places;

// ---- fill in the blanks: the sentence, the blanks and the word bank stay in step

/** The blanks marked in a sentence, in the order they appear. */
export const markersIn = (text: string): string[] => [...new Set([...text.matchAll(/\{([A-Za-z0-9_-]+)\}/g)].map((m) => m[1]!))];

/** The words offered that are not the answer to any blank. */
export function extraWordsOf(q: FillBlanksQuiz): string[] {
  const answers = new Set(q.blanks.map((b) => key(b.answers[0] ?? "")));
  return q.wordBank.filter((w) => !answers.has(key(w)));
}

/** The word bank for a sentence: each blank's first answer, then the extras, with no word twice. */
export function bankFor(q: FillBlanksQuiz, extras: string[]): string[] {
  if (q.mode === "typed") return [];
  const out: string[] = [];
  for (const w of [...q.blanks.map((b) => b.answers[0] ?? ""), ...extras]) {
    const t = w.replace(/\s+/g, " ").trim();
    if (t !== "" && !out.some((o) => key(o) === key(t))) out.push(t);
  }
  return out;
}

function syncBlanks(q: FillBlanksQuiz, text: string): EditResult {
  if (text.trim() === "") return refuse("The sentence needs some words.");
  const ids = markersIn(text);
  if (ids.length === 0) return refuse("Put at least one blank in the sentence. Write {1} where a word is missing.");
  if (ids.length > LIMITS.blanks) return refuse(`A question can have at most ${LIMITS.blanks} blanks.`);
  const extras = extraWordsOf(q);
  const before = new Set(q.blanks.map((b) => b.id));
  const added = ids.filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !ids.includes(id));
  q.text = text;
  q.blanks = ids.map((id): Blank => q.blanks.find((b) => b.id === id) ?? { id, answers: ["word"] });
  q.wordBank = bankFor(q, extras);
  const parts = [`The sentence has ${ids.length} ${ids.length === 1 ? "blank" : "blanks"}.`];
  if (added.length > 0) parts.push(`Write the answer for ${added.map((a) => `blank ${a}`).join(", ")}; it starts as "word".`);
  if (removed.length > 0) parts.push(`${removed.map((r) => `Blank ${r}`).join(", ")} ${removed.length === 1 ? "was" : "were"} taken out with ${removed.length === 1 ? "its" : "their"} answers.`);
  return parts.join(" ");
}

// ---- the edits

function editChoice(q: ChoiceQuiz, e: QuestionEdit): EditResult {
  switch (e.op) {
    case "choiceCorrect": {
      const c = q.choices.find((x) => x.id === e.id);
      if (!c) return refuse("That answer is not in this question.");
      if (q.questionType === "multipleChoice") {
        if (!e.correct) return refuse("Exactly one answer is correct. Mark another answer as correct instead.");
        q.choices.forEach((x) => (x.correct = x.id === e.id));
        return `${c.label} is the correct answer`;
      }
      c.correct = e.correct;
      if (!q.choices.some((x) => x.correct)) {
        c.correct = true;
        return refuse("At least one answer must be right.");
      }
      return q.choices.every((x) => x.correct) ? `${c.label} is right. Every answer is now marked right, so the question tests nothing.` : `${c.label} is ${e.correct ? "" : "not "}a right answer`;
    }
    case "choiceMode": {
      if (e.multiple) {
        q.questionType = "multipleResponse";
        return "Several answers can now be right. Tick every right one. A learner earns part of the points for each right answer ticked, less a share for a wrong one.";
      }
      q.questionType = "multipleChoice";
      const first = q.choices.find((c) => c.correct) ?? q.choices[0]!;
      q.choices.forEach((c) => (c.correct = c === first));
      return `Exactly one answer is right now: ${first.label}. Change it if that is wrong.`;
    }
    default:
      return refuse("That change does not belong to this kind of question.");
  }
}

function editShort(q: ShortAnswerQuiz, e: QuestionEdit): EditResult {
  if (e.op === "caseSensitive") {
    q.caseSensitive = e.on;
    return e.on ? "Capital letters must now match" : "Capital letters no longer matter";
  }
  if (e.op !== "shortAnswers") return refuse("That change does not belong to this kind of question.");
  const answers = lines(e.text, q.caseSensitive);
  if (answers.length === 0) return refuse("Write at least one accepted answer.");
  if (answers.length > LIMITS.answers) return refuse(`A question can accept at most ${LIMITS.answers} answers.`);
  q.answers = answers;
  return `${answers.length} accepted ${answers.length === 1 ? "answer" : "answers"}`;
}

function editNumeric(q: NumericQuiz, e: QuestionEdit): EditResult {
  if (e.op !== "numeric") return refuse("That change does not belong to this kind of question.");
  if (!Number.isFinite(e.answer)) return refuse("The correct answer has to be a number.");
  if (!Number.isFinite(e.tolerance) || e.tolerance < 0) return refuse("The allowed difference has to be a number, zero or more.");
  q.min = round(e.answer - e.tolerance, 10);
  q.max = round(e.answer + e.tolerance, 10);
  return q.min === q.max ? `Only ${q.min} is right` : `Any number from ${q.min} to ${q.max} is right`;
}

function editBlanks(q: FillBlanksQuiz, e: QuestionEdit): EditResult {
  switch (e.op) {
    case "blanksText":
      return syncBlanks(q, e.text);
    case "insertBlank": {
      const ids = q.blanks.map((b) => b.id);
      if (ids.length >= LIMITS.blanks) return refuse(`A question can have at most ${LIMITS.blanks} blanks.`);
      const id = next(ids, "");
      const at = Math.max(0, Math.min(q.text.length, Math.round(e.at)));
      return syncBlanks(q, `${q.text.slice(0, at)}{${id}}${q.text.slice(at)}`);
    }
    case "blankAnswers": {
      const blank = q.blanks.find((b) => b.id === e.id);
      if (!blank) return refuse("That blank is not in this question.");
      const answers = lines(e.text, q.mode === "typed" ? q.caseSensitive : true);
      if (answers.length === 0) return refuse("A blank needs at least one answer.");
      if (answers.length > LIMITS.answers) return refuse(`A blank can accept at most ${LIMITS.answers} answers.`);
      const extras = extraWordsOf(q);
      blank.answers = q.mode === "typed" ? answers : [answers[0]!];
      q.wordBank = bankFor(q, extras);
      return q.mode === "typed" ? `Blank ${e.id} accepts ${answers.length} ${answers.length === 1 ? "answer" : "answers"}` : `Blank ${e.id} is right with ${answers[0]}`;
    }
    case "blanksMode": {
      const extras = extraWordsOf(q);
      q.mode = e.mode;
      // A drop-down or a dragged word has one right word. The extras were the words offered besides the right ones.
      if (e.mode !== "typed") q.blanks.forEach((b) => (b.answers = [b.answers[0] ?? "word"]));
      q.wordBank = bankFor(q, extras);
      return e.mode === "typed" ? "The blanks are now typed" : e.mode === "dropdown" ? "Each blank is now a drop-down of the words in the word bank" : "Learners can now drag words onto the blanks. Each blank still has a drop-down, which is how a keyboard answers.";
    }
    case "extraWords": {
      if (q.mode === "typed") return refuse("Typed blanks have no word bank.");
      const extras = lines(e.text).filter((w) => !q.blanks.some((b) => key(b.answers[0] ?? "") === key(w)));
      if (q.blanks.length + extras.length > LIMITS.bank) return refuse(`The word bank can hold at most ${LIMITS.bank} words.`);
      q.wordBank = bankFor(q, extras);
      return `${extras.length} extra ${extras.length === 1 ? "word" : "words"} in the word bank`;
    }
    case "caseSensitive":
      q.caseSensitive = e.on;
      return e.on ? "Capital letters must now match" : "Capital letters no longer matter";
    default:
      return refuse("That change does not belong to this kind of question.");
  }
}

function editMatching(q: MatchingQuiz, e: QuestionEdit): EditResult {
  const taken = (text: string, except?: string): boolean =>
    [...q.pairs.filter((p) => p.id !== except).map((p) => p.match), ...q.extras].some((o) => key(o) === key(text));
  switch (e.op) {
    case "addPair": {
      if (q.pairs.length >= LIMITS.pairs) return refuse(`A question can have at most ${LIMITS.pairs} pairs.`);
      const id = next(q.pairs.map((p) => p.id), "p");
      let n = q.pairs.length + 1;
      while (taken(`Match ${n}`)) n++;
      q.pairs.push({ id, premise: `Item ${q.pairs.length + 1}`, match: `Match ${n}` });
      return `Added pair ${q.pairs.length}`;
    }
    case "deletePair": {
      if (q.pairs.length <= 2) return refuse("A matching question needs at least 2 pairs.");
      if (!q.pairs.some((p) => p.id === e.id)) return refuse("That pair is not in this question.");
      q.pairs = q.pairs.filter((p) => p.id !== e.id);
      return "Deleted the pair";
    }
    case "pairText": {
      const pair = q.pairs.find((p) => p.id === e.id);
      if (!pair) return refuse("That pair is not in this question.");
      const text = e.text.replace(/\s+/g, " ").trim();
      if (text === "") return refuse(e.field === "premise" ? "An item needs some words." : "A match needs some words.");
      if (e.field === "match" && taken(text, e.id)) return refuse("Another match already says that. Two matches that read the same cannot be told apart.");
      pair[e.field] = text;
      return e.field === "premise" ? "Item updated" : "Match updated";
    }
    case "movePair": {
      const at = q.pairs.findIndex((p) => p.id === e.id);
      const to = at + e.delta;
      if (at === -1 || to < 0 || to >= q.pairs.length) return refuse(e.delta < 0 ? "That pair is already first." : "That pair is already last.");
      [q.pairs[at], q.pairs[to]] = [q.pairs[to]!, q.pairs[at]!];
      return `Pair ${to + 1} of ${q.pairs.length}`;
    }
    case "extras": {
      const extras = lines(e.text);
      if (extras.length > LIMITS.extras) return refuse(`A question can have at most ${LIMITS.extras} extra matches.`);
      const clash = extras.find((x) => q.pairs.some((p) => key(p.match) === key(x)));
      if (clash) return refuse(`"${clash}" is already the match of a pair, so it cannot also be an extra.`);
      q.extras = extras;
      return `${extras.length} extra ${extras.length === 1 ? "match" : "matches"}`;
    }
    case "drag":
      q.drag = e.on;
      return e.on ? "Learners can now also drag the matches onto the items. The drop-downs stay, which is how a keyboard answers." : "Learners now use only the drop-downs";
    default:
      return refuse("That change does not belong to this kind of question.");
  }
}

function editSequence(q: SequencingQuiz, e: QuestionEdit): EditResult {
  switch (e.op) {
    case "addItem": {
      if (q.items.length >= LIMITS.items) return refuse(`A question can have at most ${LIMITS.items} items.`);
      q.items.push({ id: next(q.items.map((i) => i.id), "s"), text: `Step ${q.items.length + 1}` });
      return `Added item ${q.items.length}`;
    }
    case "deleteItem": {
      if (q.items.length <= 2) return refuse("A sequencing question needs at least 2 items.");
      if (!q.items.some((i) => i.id === e.id)) return refuse("That item is not in this question.");
      q.items = q.items.filter((i) => i.id !== e.id);
      return "Deleted the item";
    }
    case "itemText": {
      const item = q.items.find((i) => i.id === e.id);
      if (!item) return refuse("That item is not in this question.");
      const text = e.text.replace(/\s+/g, " ").trim();
      if (text === "") return refuse("An item needs some words.");
      item.text = text;
      return "Item updated";
    }
    case "moveItem": {
      const at = q.items.findIndex((i) => i.id === e.id);
      const to = at + e.delta;
      if (at === -1 || to < 0 || to >= q.items.length) return refuse(e.delta < 0 ? "That item is already first." : "That item is already last.");
      [q.items[at], q.items[to]] = [q.items[to]!, q.items[at]!];
      return `Item ${to + 1} of ${q.items.length} in the right order`;
    }
    case "drag":
      q.drag = e.on;
      return e.on ? "Learners can now also drag the items into order. The Move up and Move down buttons stay, which is how a keyboard answers." : "Learners now use only the Move up and Move down buttons";
    default:
      return refuse("That change does not belong to this kind of question.");
  }
}

function editHotspot(q: HotspotQuiz, e: QuestionEdit): EditResult {
  switch (e.op) {
    case "hotspotImage":
      q.image.src = e.src;
      return `The picture is now ${e.src.split("/").pop()}`;
    case "hotspotAlt":
      q.image.alt = e.alt;
      return "Picture description updated";
    case "addRegion": {
      if (q.regions.length >= LIMITS.regions) return refuse(`A question can have at most ${LIMITS.regions} areas.`);
      const n = q.regions.length;
      const offset = Math.min(50, (n % 6) * 8);
      q.regions.push({ id: next(q.regions.map((r) => r.id), "r"), label: `Area ${n + 1}`, x: 10 + offset, y: 10 + offset, width: 30, height: 30, correct: false });
      return `Added area ${n + 1}. Set its label and its place on the picture.`;
    }
    case "deleteRegion": {
      const region = q.regions.find((r) => r.id === e.id);
      if (!region) return refuse("That area is not in this question.");
      if (q.regions.length <= 2) return refuse("A hotspot question needs at least 2 areas.");
      if (region.correct && q.regions.filter((r) => r.correct).length === 1) return refuse("That is the only right area. Mark another area as right first.");
      q.regions = q.regions.filter((r) => r.id !== e.id);
      return "Deleted the area";
    }
    case "regionLabel": {
      const region = q.regions.find((r) => r.id === e.id);
      if (!region) return refuse("That area is not in this question.");
      const label = e.label.replace(/\s+/g, " ").trim();
      if (label === "") return refuse("An area needs a label. A learner who cannot see the picture chooses it from the list by its label.");
      region.label = label;
      return "Area label updated";
    }
    case "regionRect": {
      const region = q.regions.find((r) => r.id === e.id);
      if (!region) return refuse("That area is not in this question.");
      const want = { x: region.x, y: region.y, width: region.width, height: region.height, ...e.patch };
      for (const v of Object.values(want)) if (!Number.isFinite(v)) return refuse("Place and size have to be numbers.");
      const r = { x: round(want.x), y: round(want.y), width: round(want.width), height: round(want.height) };
      if (r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > 100 || r.y + r.height > 100) {
        return refuse("The area has to stay inside the picture. Places and sizes are percentages from 0 to 100, and an area cannot be empty.");
      }
      Object.assign(region, r);
      return `The area is ${r.width} percent wide and ${r.height} percent high, ${r.x} percent from the left and ${r.y} percent from the top`;
    }
    case "regionCorrect": {
      const region = q.regions.find((r) => r.id === e.id);
      if (!region) return refuse("That area is not in this question.");
      if (!e.correct && region.correct && q.regions.filter((r) => r.correct).length === 1) return refuse("At least one area must be right.");
      region.correct = e.correct;
      return `${region.label} is ${e.correct ? "" : "not "}a right area`;
    }
    default:
      return refuse("That change does not belong to this kind of question.");
  }
}

/** Apply an edit to a question, which is changed in place. Give it a copy. */
export function applyEdit(q: QuizContent, e: QuestionEdit): EditResult {
  switch (q.questionType) {
    case "multipleChoice":
    case "multipleResponse": return editChoice(q, e);
    case "shortAnswer": return editShort(q, e);
    case "numeric": return editNumeric(q, e);
    case "fillBlanks": return editBlanks(q, e);
    case "matching": return editMatching(q, e);
    case "sequencing": return editSequence(q, e);
    case "hotspot": return editHotspot(q, e);
  }
}

// ---- new questions

export type QuizType = "mc" | "tf" | "mr" | "short" | "numeric" | "blanks" | "dropdown" | "dragwords" | "matching" | "dragdrop" | "sequence" | "hotspot";

export interface QuizKind {
  id: QuizType;
  label: string;
  group: string;
  description: string;
  /** What the object is called, and the name a screen reader gives its group of controls. */
  name: string;
  alt: string;
  /** Size on the slide. */
  size: { w: number; h: number };
}

export const QUIZ_GROUPS = ["Choose", "Type an answer", "Fill in the blanks", "Match and order", "Pictures"] as const;

export const QUIZ_KINDS: QuizKind[] = [
  { id: "mc", label: "Multiple choice", group: "Choose", description: "One correct answer among several choices. Scored.", name: "Multiple choice question", alt: "Answer choices", size: { w: 720, h: 260 } },
  { id: "tf", label: "True or false", group: "Choose", description: "A statement the learner marks true or false. Scored.", name: "True or false question", alt: "Answer choices", size: { w: 720, h: 200 } },
  { id: "mr", label: "Multiple response", group: "Choose", description: "Several answers can be right, and the learner ticks every right one. A share of the points for each one right.", name: "Multiple response question", alt: "Answer choices, choose every right one", size: { w: 720, h: 320 } },
  { id: "short", label: "Short answer", group: "Type an answer", description: "The learner types a word or phrase. You list the spellings that are right.", name: "Short answer question", alt: "Your answer", size: { w: 720, h: 200 } },
  { id: "numeric", label: "Number", group: "Type an answer", description: "The learner types a number. Exact, or anywhere within a range you set.", name: "Number question", alt: "Your answer, a number", size: { w: 720, h: 200 } },
  { id: "blanks", label: "Fill in the blanks, typed", group: "Fill in the blanks", description: "A sentence with blanks the learner types into. A share of the points for each blank right.", name: "Fill in the blanks question", alt: "Fill in the blanks", size: { w: 1000, h: 260 } },
  { id: "dropdown", label: "Fill in the blanks, from drop-downs", group: "Fill in the blanks", description: "The same, but each blank is a drop-down of words to choose from.", name: "Choose the words question", alt: "Choose the words for the blanks", size: { w: 1000, h: 260 } },
  { id: "dragwords", label: "Drag the words", group: "Fill in the blanks", description: "Words are dragged from a word bank onto the blanks. Each blank also has a drop-down, so a keyboard works.", name: "Drag the words question", alt: "Drag the words onto the blanks, or choose them from the lists", size: { w: 1000, h: 300 } },
  { id: "matching", label: "Matching", group: "Match and order", description: "Match each item with one of several matches, from a drop-down. Extra wrong matches can be added.", name: "Matching question", alt: "Match each item", size: { w: 1000, h: 360 } },
  { id: "dragdrop", label: "Drag and drop", group: "Match and order", description: "Matching, where the matches can also be dragged onto their items. The drop-downs stay, so a keyboard works.", name: "Drag and drop question", alt: "Match each item, by dragging or from the lists", size: { w: 1000, h: 420 } },
  { id: "sequence", label: "Sequencing", group: "Match and order", description: "Put items in the right order, with Move up and Move down buttons. They can be dragged too.", name: "Sequencing question", alt: "Put the items in order", size: { w: 1000, h: 420 } },
  { id: "hotspot", label: "Hotspot", group: "Pictures", description: "Choose an area of a picture. Every area is also listed by its label, so a screen reader can answer.", name: "Hotspot question", alt: "Choose an area of the picture", size: { w: 1000, h: 560 } },
];

export const quizKind = (id: string): QuizKind | undefined => QUIZ_KINDS.find((k) => k.id === id);

/** What a new question of this kind starts with. A hotspot needs the picture it is about. Scoring and feedback are added by the caller. */
export function startingQuestion(type: QuizType, imageSrc = ""): QuestionBody {
  const choices = (n: number, right: number[]): ChoiceQuiz["choices"] =>
    Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, label: ["First", "Second", "Third", "Fourth"][i]! + " answer", correct: right.includes(i) }));
  const sentence = "Write your sentence here, with {1} where a word is missing.";
  switch (type) {
    case "mc": return { questionType: "multipleChoice", choices: choices(3, [0]) };
    case "tf": return { questionType: "multipleChoice", choices: [{ id: "c1", label: "True", correct: true }, { id: "c2", label: "False", correct: false }] };
    case "mr": return { questionType: "multipleResponse", choices: choices(4, [0, 2]) };
    case "short": return { questionType: "shortAnswer", answers: ["The right answer"], caseSensitive: false };
    case "numeric": return { questionType: "numeric", min: 10, max: 10 };
    case "blanks": return { questionType: "fillBlanks", mode: "typed", text: sentence, blanks: [{ id: "1", answers: ["word"] }], wordBank: [], caseSensitive: false };
    case "dropdown": return { questionType: "fillBlanks", mode: "dropdown", text: sentence, blanks: [{ id: "1", answers: ["word"] }], wordBank: ["word", "another"], caseSensitive: false };
    case "dragwords": return { questionType: "fillBlanks", mode: "drag", text: sentence, blanks: [{ id: "1", answers: ["word"] }], wordBank: ["word", "another"], caseSensitive: false };
    case "matching":
    case "dragdrop": return { questionType: "matching", drag: type === "dragdrop", pairs: [{ id: "p1", premise: "First item", match: "First match" }, { id: "p2", premise: "Second item", match: "Second match" }], extras: [] };
    case "sequence": return { questionType: "sequencing", drag: true, items: [{ id: "s1", text: "First step" }, { id: "s2", text: "Second step" }, { id: "s3", text: "Third step" }] };
    case "hotspot": return {
      questionType: "hotspot", image: { src: imageSrc, alt: "" },
      regions: [{ id: "r1", label: "Left half", x: 2, y: 5, width: 46, height: 90, correct: true }, { id: "r2", label: "Right half", x: 52, y: 5, width: 46, height: 90, correct: false }],
    };
  }
}

/** The order a learner first sees items in, so the editor can say it too. */
export const shownOrder = (ids: string[], seed: string): string[] => stableShuffle(ids, seed);
