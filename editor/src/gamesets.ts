// Ready-made games: whole sets of slides with the variables and rules that make them play. A lesson-slide template (templates.ts) builds one
// slide. A game needs several slides that jump between each other, and variables that remember what has been played, so it is its own kind of
// template. Like a lesson slide it is only a way to start: what it makes is ordinary slides, variables and rules, nothing is tied to the game
// afterwards, and no format change was needed. Everything an author has to write (categories, questions, feedback) is a placeholder.
//
// Games here are built from rules and objects the editor already has. A score within one game is the quiz points that already reach the results
// box and the LMS. There are no leaderboards, coins, badges or anything kept beyond the one activity.

import { colorRef } from "../../player/src/theme.ts";
import type { Condition, Layer, OSObject, Slide, Trigger } from "../../player/src/types.ts";
import { buildActivation, writeRules, type Rule, type RuleItem } from "./content.ts";
import { box, buildQuiz, emptyLayer, emptySlide, heading, body, newObject, textRole, type Alloc, type PreviewBlock, type Rect, type SlideLayout, type Tone } from "./factory.ts";

/** What a game set needs from the model while it is built: ids nobody else is using, and a way to make variables. */
export interface GameContext {
  /** Ids for objects (unique in the project) and layers (unique across the set, so unique on every slide of it). */
  alloc: Alloc;
  /** A new slide id. Each call gives a different one, and none is used by a slide the project already has. */
  slideId(): string;
  /** Make a variable and return its id. A name that is taken gets a number added to it. */
  variable(type: "boolean" | "number" | "string", name: string): string;
  /** The names of the project's variables now, so a second copy of a game can tell its variables apart from the first's. */
  variableNames(): string[];
}

/** One thing the author is asked before the game is made, such as how many categories. A whole number in a range. */
export interface GameChoice {
  id: string;
  label: string;
  help: string;
  min: number;
  max: number;
  initial: number;
}

export type GameOptions = Record<string, number>;

export interface GameBuild {
  /** In course order: the first is the one the author lands on. */
  slides: Slide[];
  /** Words for the author about what was made and what to do next. */
  notes: string[];
}

export interface GameSet {
  id: string;
  label: string;
  description: string;
  /** A slide of the game as the picker draws it (usually its first), with `extras` for the parts that are not text. */
  layout: SlideLayout;
  extras: PreviewBlock[];
  choices: GameChoice[];
  /** What the author is told while choosing, such as how many slides it will make. */
  summary(options: GameOptions): string;
  /**
   * What the course must be set to for the game to count as played. A game that lets learners visit slides in any order needs "last":
   * with "every slide seen", the validator rightly warns about every rule that jumps past slides.
   */
  completion?: "last";
  build(ctx: GameContext, options: GameOptions): GameBuild;
}

/** The picker returns "game:<id>" for a game. */
export const GAME_PREFIX = "game:";

/** Whole numbers in each choice's range, with the starting number for anything missing or out of range. */
export function gameOptions(set: GameSet, raw: Record<string, unknown> = {}): GameOptions {
  const out: GameOptions = {};
  for (const c of set.choices) {
    const v = Number(raw[c.id]);
    out[c.id] = Number.isInteger(v) && v >= c.min && v <= c.max ? v : c.initial;
  }
  return out;
}

// ---- pieces the games share

const textBox = (alloc: Alloc, name: string, block: "h1" | "h2" | "p", text: string, rect: Rect, size: number, tone: Tone, tab: number, z: number, muted = false): OSObject => ({
  ...box(alloc.object(), rect[0], rect[1], rect[2], rect[3], z), type: "text", name,
  content: { html: `<${block}>${text}</${block}>` },
  style: { fontFamily: block === "p" ? "theme:font.body" : "theme:font.heading", fontSize: size, color: colorRef(textRole(tone, muted)) },
  accessibility: { altText: text, role: block === "p" ? "paragraph" : "heading", tabOrder: tab, decorative: false },
});

/** A button with its words as its name. Its rules are given by the caller. */
function button(alloc: Alloc, name: string, label: string, rect: Rect, z: number, tab: number, fontSize = 18): OSObject {
  const b = newObject("button", { id: alloc.object(), count: 0, z, tabOrder: tab });
  return {
    ...b, name,
    geometry: { ...b.geometry, x: rect[0], y: rect[1], width: rect[2], height: rect[3] },
    content: { label },
    style: { ...b.style, fontSize },
    accessibility: { ...b.accessibility, altText: name },
  };
}

/** The dimmed look a used tile or a closed button takes. The course also stops a disabled button being pressed or reached by keyboard. */
const DIMMED = { disabled: { style: { opacity: 0.4 } } };

const slideWith = (id: string, name: string, objects: OSObject[], layers: Layer[] = [], background: string | null = null): Slide => ({
  ...emptySlide(id, name),
  background,
  baseLayer: { id: "layer-base", name: "Base", objects },
  layers,
});

// ---- the quiz board

/** The tiles' place on the board slide: a row of category names, then each category's tiles from the smallest value down, across the same margins as the title. */
export function boardGrid(categories: number, values: number) {
  const gap = 16;
  const w = Math.floor((1120 - gap * (categories - 1)) / categories);
  const h = values <= 4 ? 72 : 64;
  const rowGap = 12;
  const x0 = 80;
  const headerY = 148;
  const tilesY = 204;
  return {
    w, h, headerY,
    header: (c: number): Rect => [x0 + c * (w + gap), headerY, w, 48],
    tile: (c: number, r: number): Rect => [x0 + c * (w + gap), tilesY + r * (h + rowGap), w, h],
  };
}

/** What a tile in row `r` (counting from 0) is worth. */
export const tileValue = (r: number): number => (r + 1) * 100;

const BOARD_PROMPT = "Choose a tile, answer its question, then come back to the board. Finish opens when every tile has been used.";

function boardPreview(categories: number, values: number): PreviewBlock[] {
  const grid = boardGrid(categories, values);
  const out: PreviewBlock[] = [{ kind: "button", rect: [1040, 640, 160, 56] }];
  for (let c = 0; c < categories; c++) {
    out.push({ kind: "heading", rect: grid.header(c) });
    for (let r = 0; r < values; r++) out.push({ kind: "button", rect: grid.tile(c, r) });
  }
  return out;
}

const boardLayout: SlideLayout = {
  id: "game-quiz-board", group: "Games", label: "Quiz board", description: "", name: "Quiz board", tone: "dark", background: "theme:bg.dark",
  slots: [heading("Title", "Quiz board", [80, 24, 1120, 64], 40), body("Instructions", BOARD_PROMPT, [80, 92, 1120, 44], 22, "p", true)],
  decorations: [],
};

const trigger = (id: string, event: Trigger["event"], action: Trigger["action"], target: string, value: Trigger["value"], conditions: Trigger["conditions"]): Trigger =>
  ({ id, event, action, target, ...(value === undefined ? {} : { value }), conditions });

/** Ids for the rules on one object: trg-0001, trg-0002 and so on. */
const triggerIds = (): (() => string) => {
  let n = 0;
  return () => `trg-${String(++n).padStart(4, "0")}`;
};

function questionSlide(ctx: GameContext, id: string, boardId: string, category: number, row: number, usedVariable: string, playedVariable: string): Slide {
  const { alloc } = ctx;
  const value = tileValue(row);
  const points = textBox(alloc, "Points", "p", `${value} points`, [80, 24, 1120, 36], 22, "light", 1, 10, true);
  const built = buildQuiz("mc", alloc, { y: 70, z: 20, tab: 2, tone: "light" });
  const [, quiz] = built.objects as [OSObject, OSObject];
  // One try: the answer is final, so the tile is used up when it is given. Each question is worth its tile's points, which is what reaches the score.
  quiz.content = { ...quiz.content, scoring: { points: value, attemptsAllowed: 1 } };
  // The question's own rules run once, when an answer is accepted (the player does not run them again for a question already answered).
  const rule = (action: "setVariable" | "addToVariable", target: string, v: boolean | number): RuleItem => ({ kind: "rule", rule: { event: "activate", action, target, value: v, conditions: [] } });
  quiz.triggers = writeRules([rule("setVariable", usedVariable, true), rule("addToVariable", playedVariable, 1)], triggerIds());
  // With one try there is no "try again", so the wrong-answer feedback says what to do instead.
  const wrong = built.layers[1]!.objects[0]!;
  const wrongText = "Not quite. Say what the right answer is, and why.";
  wrong.content = { ...wrong.content, html: `<p>${wrongText}</p>` };
  wrong.accessibility = { ...wrong.accessibility, altText: wrongText };
  // Always there, so a learner who arrives at a question already answered (resuming at the board, say) is never stuck. It does not mark the tile
  // as used: only answering does, so leaving a question alone leaves its tile open.
  const back = button(alloc, "Back to the board", "Back to the board", [80, 640, 280, 56], 30, 4);
  back.triggers = buildActivation({ kind: "jump", slideId: boardId });
  return slideWith(id, `Category ${category + 1}: ${value}`, [points, ...built.objects, back], built.layers);
}

/** The last slide of a game: the score and each question, and, for a game that can be gone back into, a way back to `backTo`. */
function resultsSlide(ctx: GameContext, id: string, backTo: string | null, headline = "Game results"): Slide {
  const { alloc } = ctx;
  const title = textBox(alloc, "Title", "h1", headline, [80, 48, 1120, 80], 44, "light", 1, 10);
  const results = newObject("results", { id: alloc.object(), count: 0, z: 20, tabOrder: 2 });
  results.geometry = { ...results.geometry, x: 80, y: 160, width: 760, height: 340 };
  results.content = { ...results.content, heading: "Your game results", failMessage: "Look back over the questions you missed." };
  results.accessibility = { ...results.accessibility, altText: "Your game results" };
  const objects = [title, results];
  if (backTo) {
    const back = button(alloc, "Back to the board", "Back to the board", [80, 640, 280, 56], 30, 3);
    back.triggers = buildActivation({ kind: "jump", slideId: backTo });
    objects.push(back);
  }
  return slideWith(id, "Game results", objects);
}

function buildQuizBoard(ctx: GameContext, o: GameOptions): GameBuild {
  const categories = o["categories"]!;
  const rows = o["values"]!;
  const total = categories * rows;
  const grid = boardGrid(categories, rows);
  const { alloc } = ctx;

  // A second board in the same project gets its own variables, told apart by a number in front.
  const boards = ctx.variableNames().filter((n) => /(^|: )Tiles played$/.test(n)).length;
  const tag = boards === 0 ? "" : `Board ${boards + 1}: `;

  const boardId = ctx.slideId();
  const questionIds = Array.from({ length: categories }, () => Array.from({ length: rows }, () => ctx.slideId()));
  const resultsId = ctx.slideId();
  const played = ctx.variable("number", `${tag}Tiles played`);
  const used = questionIds.map((column, c) => column.map((_, r) => ctx.variable("boolean", `${tag}Used: Category ${c + 1}, ${tileValue(r)}`)));

  // The board. Reading order goes down each category in turn (its name, then its tiles from the smallest value), then Finish.
  let tab = 2;
  let z = 20;
  const objects: OSObject[] = [
    textBox(alloc, "Title", "h1", "Quiz board", [80, 24, 1120, 64], 40, "dark", 1, 10),
    textBox(alloc, "Instructions", "p", BOARD_PROMPT, [80, 92, 1120, 44], 22, "dark", 2, 11, true),
  ];
  for (let c = 0; c < categories; c++) {
    objects.push(textBox(alloc, `Category ${c + 1}`, "h2", `Category ${c + 1}`, grid.header(c), 24, "dark", ++tab, ++z));
    for (let r = 0; r < rows; r++) {
      // The name starts with the words on the tile, so voice control and a screen reader agree, then says which category it is in.
      const name = `${tileValue(r)}, Category ${c + 1}`;
      const tile = button(alloc, name, String(tileValue(r)), grid.tile(c, r), ++z, ++tab, 32);
      tile.states = DIMMED;
      tile.triggers = [
        ...buildActivation({ kind: "jump", slideId: questionIds[c]![r]! }),
        // A look lasts only until the slide closes, so each time the board opens, a tile that has been used is dimmed again from its variable.
        trigger("trg-0003", "slideStart", "changeState", tile.id, "disabled", [{ variable: used[c]![r]!, operator: "equals", value: true }]),
      ];
      objects.push(tile);
    }
  }
  const finish = button(alloc, "Finish", "Finish", [1040, 640, 160, 56], ++z, ++tab);
  finish.states = DIMMED;
  finish.triggers = [
    ...buildActivation({ kind: "jump", slideId: resultsId }),
    trigger("trg-0003", "slideStart", "changeState", finish.id, "disabled", [{ variable: played, operator: "lessThan", value: total }]),
  ];
  objects.push(finish);

  const slides: Slide[] = [slideWith(boardId, "Quiz board", objects, [], "theme:bg.dark")];
  for (let c = 0; c < categories; c++) {
    for (let r = 0; r < rows; r++) slides.push(questionSlide(ctx, questionIds[c]![r]!, boardId, c, r, used[c]![r]!, played));
  }
  slides.push(resultsSlide(ctx, resultsId, boardId));

  return {
    slides,
    notes: [
      `The board has ${total} tiles and ${total} questions, each worth its tile's points.`,
      `Write over Category 1 to Category ${categories} and the questions. When you rename a category, also change the alt text of its tiles, which says the category.`,
    ],
  };
}

const quizBoard: GameSet = {
  id: "quiz-board",
  label: "Quiz board",
  description: "Tiles in categories. A learner picks a tile, answers its question, and comes back to the board. Used tiles are dimmed, and Finish opens when all are used.",
  layout: boardLayout,
  extras: boardPreview(4, 4),
  choices: [
    { id: "categories", label: "Categories", help: "How many columns of tiles, each with its own heading.", min: 2, max: 6, initial: 4 },
    { id: "values", label: "Questions in each category", help: "How many tiles in each column. The first is worth 100 points, the next 200, and so on.", min: 2, max: 5, initial: 4 },
  ],
  summary(o) {
    const questions = o["categories"]! * o["values"]!;
    return `This adds ${questions + 2} slides: the board, ${questions} question slides and a results slide. ${questions + 1} variables remember which tiles are used.`;
  },
  completion: "last",
  build: buildQuizBoard,
};

// ---- the prize ladder

export const MIN_RUNGS = 5;
export const MAX_RUNGS = 15;

/** What the question on rung `level` (counting from 1) is worth: 100 points on the first, and 100 more on each one after it. */
export const rungValue = (level: number): number => level * 100;

/** Where each rung of the ladder is, down the right-hand side of the slide. The highest rung is at the top. */
export function ladderGrid(rungs: number) {
  const gap = 6;
  const h = Math.min(44, Math.floor((660 - gap * (rungs - 1)) / rungs));
  const x = 980;
  const w = 220;
  const top = 24;
  return { x, w, h, gap, rect: (level: number): Rect => [x, top + (rungs - level) * (h + gap), w, h] };
}

/** Where a learner stands on a rung: already answered, the one in front of them, or still to come. */
type Rung = "answered" | "here" | "ahead";

/**
 * One rung, drawn as a text box with a fill of its own (the validator judges its words against that fill). The ladder is only a picture of where
 * the learner is, so a screen reader skips it: the same facts are in the words at the top of every question and on the opening slide. The three
 * kinds also differ in more than colour, so they can be told apart without it: the rung in front is bold and filled with the strong colour, one still
 * to come is in a grey box, and one already answered is plain, faded text.
 */
function rungBox(alloc: Alloc, rungs: number, level: number, where: Rung, group: string): OSObject {
  const g = ladderGrid(rungs);
  const kind: Record<Rung, Record<string, string | number>> = {
    here: { fill: colorRef("accentStrong"), color: colorRef("onAccentStrong"), fontWeight: "700" },
    ahead: { fill: colorRef("surface"), color: colorRef("text") },
    answered: { color: colorRef("muted") },
  };
  return {
    ...box(alloc.object(), ...g.rect(level), 5), type: "text", name: `Ladder: ${rungValue(level)} points`,
    content: { html: `<p>${level}. ${rungValue(level)} points</p>` },
    style: { fontFamily: "theme:font.body", fontSize: g.h >= 44 ? 20 : 18, textAlign: "center", padding: 8, radius: 8, ...kind[where] },
    accessibility: { altText: "", role: "presentation", tabOrder: 0, decorative: true },
    group,
  };
}

/** The whole ladder as it looks to a learner on question `current` (0 for none yet, so every rung is still ahead). */
function ladder(alloc: Alloc, rungs: number, current: number, group: string): OSObject[] {
  return Array.from({ length: rungs }, (_, i) => rungBox(alloc, rungs, rungs - i, current === rungs - i ? "here" : rungs - i < current ? "answered" : "ahead", group));
}

function ladderPreview(rungs: number): PreviewBlock[] {
  const g = ladderGrid(rungs);
  const out: PreviewBlock[] = [{ kind: "button", rect: [80, 560, 240, 56] }];
  for (let level = rungs; level >= 1; level--) out.push({ kind: "accent", rect: g.rect(level), fill: colorRef("surface") });
  return out;
}

const ladderLayout: SlideLayout = {
  id: "game-prize-ladder", group: "Games", label: "Prize ladder", description: "", name: "Prize ladder", tone: "dark", background: "theme:bg.dark",
  slots: [
    heading("Title", "Prize ladder", [80, 24, 860, 64], 40),
    body("Instructions", "Climb the ladder one question at a time. Each question is worth more than the last.", [80, 110, 860, 200], 24, "p", true),
  ],
  decorations: [],
};

function ladderQuestion(ctx: GameContext, id: string, nextId: string, level: number, rungs: number, group: string): Slide {
  const { alloc } = ctx;
  const value = rungValue(level);
  const where = textBox(alloc, "Where you are", "p", `Question ${level} of ${rungs}, worth ${value} points`, [80, 24, 860, 36], 22, "light", 1, 10, true);
  const built = buildQuiz("mc", alloc, { y: 70, z: 20, tab: 2, tone: "light" });
  const [prompt, quiz] = built.objects as [OSObject, OSObject];
  // The ladder takes the right-hand side, so the question and its feedback keep to the left of it.
  prompt.geometry = { ...prompt.geometry, width: 860 };
  // One try, and the right answer is shown whichever way it went: there is no "try again", and nobody is knocked out. Every question has to be
  // finished for the course to be complete, so a wrong answer cannot end the game and leave the rest unanswered.
  quiz.content = { ...quiz.content, scoring: { points: value, attemptsAllowed: 1 } };
  const wrongText = "Not quite. Say what the right answer is, and why.";
  const wrong = built.layers[1]!.objects[0]!;
  wrong.content = { ...wrong.content, html: `<p>${wrongText}</p>` };
  wrong.accessibility = { ...wrong.accessibility, altText: wrongText };
  // After an answer, the way on is in the feedback that appears, so it is there only when it can be used.
  const last = level === rungs;
  for (const layer of built.layers) {
    layer.objects[0]!.geometry = { ...layer.objects[0]!.geometry, x: 80, y: 460, width: 860, height: 100 };
    const next = button(alloc, last ? "See my results" : "Next question", last ? "See my results" : "Next question", [80, 580, 300, 56], 50, 2);
    next.triggers = buildActivation({ kind: "jump", slideId: nextId });
    layer.objects.push(next);
  }
  return slideWith(id, `Question ${level}: ${value}`, [where, prompt, quiz, ...ladder(alloc, rungs, level, group)], built.layers);
}

function buildPrizeLadder(ctx: GameContext, o: GameOptions): GameBuild {
  const rungs = o["questions"]!;
  const { alloc } = ctx;
  const introId = ctx.slideId();
  const questionIds = Array.from({ length: rungs }, () => ctx.slideId());
  const resultsId = ctx.slideId();
  // Each slide has its own ladder. Objects are grouped on one layer only, so a tag is enough for each; they differ across the set for clarity.
  let groups = 0;
  const group = () => `group-${++groups}`;

  const intro = slideWith(introId, "Prize ladder", [
    textBox(alloc, "Title", "h1", "Prize ladder", [80, 24, 860, 64], 40, "dark", 1, 10),
    textBox(alloc, "Instructions", "p",
      `Climb the ladder one question at a time. There are ${rungs} questions. The first is worth ${rungValue(1)} points, and each question after it is worth ${rungValue(1)} more, up to ${rungValue(rungs)} for the last. Every question has one try, and the points you earn are your score.`,
      [80, 110, 860, 200], 24, "dark", 2, 11, true),
    ...ladder(alloc, rungs, 0, group()),
  ], [], "theme:bg.dark");
  const start = button(alloc, "Start the game", "Start", [80, 560, 240, 56], 30, 3);
  start.triggers = buildActivation({ kind: "jump", slideId: questionIds[0]! });
  intro.baseLayer.objects.push(start);

  const slides: Slide[] = [intro];
  for (let level = 1; level <= rungs; level++) slides.push(ladderQuestion(ctx, questionIds[level - 1]!, level === rungs ? resultsId : questionIds[level]!, level, rungs, group()));
  slides.push(resultsSlide(ctx, resultsId, null));

  return {
    slides,
    notes: [
      `The ladder has ${rungs} questions, worth ${rungValue(1)} to ${rungValue(rungs)} points. It needs no variables.`,
      "Write over the title, the opening words and the questions. The ladder on each slide is a picture, and the line at the top of each question says where the learner is in words, so if you change the number of questions or their points, change those lines and the rungs together. A wrong answer does not end the game, because every question has to be answered for the course to be complete.",
    ],
  };
}

const prizeLadder: GameSet = {
  id: "prize-ladder",
  label: "Prize ladder",
  description: "Questions in order, each worth more than the last, with a ladder that shows where the learner is. Every question has one try, and the right answer is shown whichever way it goes.",
  layout: ladderLayout,
  extras: ladderPreview(8),
  choices: [
    { id: "questions", label: "Questions", help: `How many rungs the ladder has, each with its own question. The first is worth ${rungValue(1)} points and each one after is worth ${rungValue(1)} more.`, min: MIN_RUNGS, max: MAX_RUNGS, initial: 8 },
  ],
  summary(o) {
    const n = o["questions"]!;
    return `This adds ${n + 2} slides: an opening slide, ${n} question slides and a results slide. It needs no variables.`;
  },
  build: buildPrizeLadder,
};

// ---- the escape room

export const MIN_ROOMS = 2;
export const MAX_ROOMS = 5;
export const MIN_TRIES = 1;
export const MAX_TRIES = 3;
/** How many places to search in each room. */
export const PLACES = 3;

/** The code of the door of room `room` (counting from 1). The clues the game starts with spell it out, so the game can be played as it is made. */
export const doorCode = (room: number): string => ["4271", "6153", "8394", "5726", "3048"][(room - 1) % 5]!;

const PLACE_LABELS = ["Look at the desk", "Look in the cupboard", "Look behind the picture"];

/** What the clue in place `place` (from 0) says, for a door with this code. */
export const clueText = (place: number, code: string): string => [
  `A note on the desk reads: the first digit is ${code[0]}.`,
  `A torn page in the cupboard reads: the second digit is ${code[1]}.`,
  `Scratched on the back of the picture: the last two digits are ${code.slice(2)}.`,
][place]!;

/** Where the button for place `place` (from 0) is, in a row across the room. */
export const spotRect = (place: number): Rect => [80 + place * 380, 200, 360, 120];

/** A rule as the editor writes them: "when ... do ... only if ...". `activate` is a press, and is written as the click and the key press together. */
const ruleOf = (event: Rule["event"], action: Rule["action"], target: string, value?: boolean | number | string, conditions: Condition[] = []): RuleItem =>
  ({ kind: "rule", rule: { event, action, target, ...(value === undefined ? {} : { value }), conditions } });

/** The look a place takes once it has been searched. A look is not saved, so a rule brings it back from the place's variable each time the room opens. */
const SEARCHED = { Searched: { style: { fill: colorRef("surface"), color: colorRef("text") }, announce: "Searched" } };

const layerOf = (alloc: Alloc, name: string, objects: OSObject[] = []): Layer => ({ ...emptyLayer(alloc.layer(), name), objects });

function roomSlide(ctx: GameContext, id: string, lockId: string, room: number, found: string[]): Slide {
  const { alloc } = ctx;
  const code = doorCode(room);
  const clues = PLACE_LABELS.map((_, j) => layerOf(alloc, `Clue ${j + 1}`));
  const objects: OSObject[] = [
    textBox(alloc, "Title", "h1", `Room ${room}`, [80, 24, 1120, 64], 40, "dark", 1, 10),
    textBox(alloc, "Instructions", "p", "Search each place for a clue. When you are ready, go to the door and enter its code.", [80, 100, 1120, 60], 24, "dark", 2, 11, true),
  ];
  PLACE_LABELS.forEach((label, j) => {
    const spot = button(alloc, label, label, spotRect(j), 20 + j, 3 + j, 26);
    spot.states = SEARCHED;
    const own = clues[j]!;
    // Only one clue is open at a time, because they all appear in the same place. Searching also marks the place as searched, and a rule that
    // runs each time the room opens (and again after a resume) shows it as searched while its variable is true.
    spot.triggers = writeRules([
      ...clues.filter((_, other) => other !== j).map((l) => ruleOf("activate", "hideLayer", l.id)),
      ruleOf("activate", "setVariable", found[j]!, true),
      ruleOf("activate", "changeState", spot.id, "Searched"),
      ruleOf("activate", "showLayer", own.id),
      ruleOf("slideStart", "changeState", spot.id, "Searched", [{ variable: found[j]!, operator: "equals", value: true }]),
    ], triggerIds());
    objects.push(spot);
    const note = textBox(alloc, "Clue", "p", clueText(j, code), [160, 360, 960, 120], 26, "light", 1, 40);
    // A note card: its words are judged against its own fill, which is one of the theme's guaranteed pairs.
    note.style = { ...note.style, fill: colorRef("surface"), padding: 16, radius: 8 };
    note.accessibility = { ...note.accessibility, role: "status" };
    const close = button(alloc, "Close this clue", "Close", [160, 500, 200, 56], 41, 2);
    close.triggers = buildActivation({ kind: "hide", layerId: own.id });
    own.objects.push(note, close);
  });
  const door = button(alloc, "Go to the door", "Go to the door", [840, 640, 360, 56], 30, 3 + PLACE_LABELS.length);
  door.triggers = buildActivation({ kind: "jump", slideId: lockId });
  objects.push(door);
  return slideWith(id, `Room ${room}`, objects, clues, "theme:bg.dark");
}

/**
 * The lock on the door of room `room`: a typed code with a few tries. The way on is open once the lock is finished, whether it was solved or not.
 * A rule cannot tell a right answer from a wrong one, or see that a question is finished, so the game counts tries itself: a right answer's
 * feedback has the way on, and a wrong answer's has one too, dimmed until the tries are used up, when the code is shown. Every question has to be
 * finished for the course to be complete, so nobody can be left in front of a lock they cannot open.
 */
function lockSlide(ctx: GameContext, id: string, roomId: string, nextId: string, room: number, rooms: number, tries: number, triesVariable: string): Slide {
  const { alloc } = ctx;
  const code = doorCode(room);
  const where = textBox(alloc, "Where you are", "p", `Room ${room} of ${rooms}: the door`, [80, 24, 1120, 36], 22, "light", 1, 10, true);
  const built = buildQuiz("short", alloc, { y: 70, z: 20, tab: 2, tone: "light" });
  const [prompt, quiz] = built.objects as [OSObject, OSObject];
  prompt.content = { ...prompt.content, html: "<h2>What is the code that opens the door?</h2>" };
  prompt.accessibility = { ...prompt.accessibility, altText: "What is the code that opens the door?" };
  quiz.content = { ...quiz.content, answers: [code], scoring: { points: 100, attemptsAllowed: tries } };

  const [right, wrong] = built.layers as [Layer, Layer];
  const say = (o: OSObject, text: string) => {
    o.content = { ...o.content, html: `<p>${text}</p>` };
    o.accessibility = { ...o.accessibility, altText: text };
    o.geometry = { ...o.geometry, x: 80, y: 400, width: 1000, height: 70 };
  };
  say(right.objects[0]!, "Correct. The door unlocks.");
  say(wrong.objects[0]!, "Not quite. Look again at what you found in the room.");

  // The code is shown once the tries are used up, over whichever feedback is showing. It is only words, so it adds no second way on.
  const reveal = layerOf(alloc, "Out of tries");
  const revealText = textBox(alloc, "The code", "p", `That was your last try. The code was ${code}.`, [80, 470, 1000, 70], 22, "light", 1, 40);
  revealText.accessibility = { ...revealText.accessibility, role: "status" };
  reveal.objects.push(revealText);
  // The question's own rules run once for each answer that is accepted: count it, and show the code when that was the last try.
  quiz.triggers = writeRules([
    ruleOf("activate", "addToVariable", triesVariable, 1),
    ruleOf("activate", "showLayer", reveal.id, undefined, [{ variable: triesVariable, operator: "greaterThanOrEqual", value: tries }]),
  ], triggerIds());

  const goOn = (): OSObject => {
    const next = button(alloc, "Next room", "Next room", [80, 560, 300, 56], 50, 2);
    next.triggers = buildActivation({ kind: "jump", slideId: nextId });
    return next;
  };
  right.objects.push(goOn());
  // After a wrong answer the way on is dimmed until the last try has been used. It is dimmed each time the slide opens while tries are left, and
  // opened as the count reaches the number of tries, so a resume (which runs these rules again) gets it right too.
  const late = goOn();
  late.states = DIMMED;
  late.triggers = [
    ...late.triggers,
    trigger("trg-0003", "slideStart", "changeState", late.id, "disabled", [{ variable: triesVariable, operator: "lessThan", value: tries }]),
    trigger("trg-0004", "variableChange", "changeState", late.id, "normal", [{ variable: triesVariable, operator: "greaterThanOrEqual", value: tries }]),
  ];
  wrong.objects.push(late);

  // Always there, so a learner can leave a lock they are not ready for.
  const back = button(alloc, "Back to the room", "Back to the room", [900, 640, 300, 56], 30, 4);
  back.triggers = buildActivation({ kind: "jump", slideId: roomId });
  return slideWith(id, `Room ${room}: the door`, [where, prompt, quiz, back], [right, wrong, reveal]);
}

const escapeLayout: SlideLayout = {
  id: "game-escape-room", group: "Games", label: "Escape room", description: "", name: "Room 1", tone: "dark", background: "theme:bg.dark",
  slots: [
    heading("Title", "Room 1", [80, 24, 1120, 64], 40),
    body("Instructions", "Search each place for a clue. When you are ready, go to the door and enter its code.", [80, 100, 1120, 60], 24, "p", true),
  ],
  decorations: [],
};

function buildEscapeRoom(ctx: GameContext, o: GameOptions): GameBuild {
  const rooms = o["rooms"]!;
  const tries = o["tries"]!;
  const { alloc } = ctx;
  // A second escape room in the same project gets variables of its own, told apart by a name in front.
  const existing = ctx.variableNames().filter((n) => /(^|: )Room 1: tries$/.test(n)).length;
  const tag = existing === 0 ? "" : `Escape room ${existing + 1}: `;

  const introId = ctx.slideId();
  const roomIds: string[] = [];
  const lockIds: string[] = [];
  for (let k = 0; k < rooms; k++) {
    roomIds.push(ctx.slideId());
    lockIds.push(ctx.slideId());
  }
  const resultsId = ctx.slideId();
  // Each room's four variables are made together, so they are together in the Variables list.
  const found: string[][] = [];
  const used: string[] = [];
  for (let k = 0; k < rooms; k++) {
    found.push(PLACE_LABELS.map((_, j) => ctx.variable("boolean", `${tag}Room ${k + 1}: place ${j + 1} searched`)));
    used.push(ctx.variable("number", `${tag}Room ${k + 1}: tries`));
  }

  const intro = slideWith(introId, "Escape room", [
    textBox(alloc, "Title", "h1", "Escape room", [80, 24, 1120, 64], 40, "dark", 1, 10),
    textBox(alloc, "Instructions", "p",
      `You are locked in. There are ${rooms} rooms. In each one, search the places for clues, then go to the door and enter its code. You have ${tries} ${tries === 1 ? "try" : "tries"} at each lock. If you use them all, the code is shown and you can go on.`,
      [80, 110, 1120, 240], 24, "dark", 2, 11, true),
  ], [], "theme:bg.dark");
  const start = button(alloc, "Start the game", "Start", [80, 560, 240, 56], 30, 3);
  start.triggers = buildActivation({ kind: "jump", slideId: roomIds[0]! });
  intro.baseLayer.objects.push(start);

  const slides: Slide[] = [intro];
  for (let k = 0; k < rooms; k++) {
    slides.push(roomSlide(ctx, roomIds[k]!, lockIds[k]!, k + 1, found[k]!));
    slides.push(lockSlide(ctx, lockIds[k]!, roomIds[k]!, k === rooms - 1 ? resultsId : roomIds[k + 1]!, k + 1, rooms, tries, used[k]!));
  }
  slides.push(resultsSlide(ctx, resultsId, null, "You escaped"));

  return {
    slides,
    notes: [
      `The escape room has ${rooms} rooms. The placeholders already make a game that can be played: in each room the three clues spell out the code of the door (Room 1's is ${doorCode(1)}).`,
      "Write over the title, the opening words, the places and their clues, and the codes. When you change a code, change it in the lock's question (its answer), in the three clues, and in the line that says what the code was.",
    ],
  };
}

const escapeRoom: GameSet = {
  id: "escape-room",
  label: "Escape room",
  description: "Rooms to search for clues and a door with a code lock to open. Searched places are marked, each lock has a few tries, and when they run out the code is shown, so nobody is stuck.",
  layout: escapeLayout,
  extras: [...PLACE_LABELS.map((_, j): PreviewBlock => ({ kind: "button", rect: spotRect(j) })), { kind: "button", rect: [840, 640, 360, 56] }],
  choices: [
    { id: "rooms", label: "Rooms", help: "How many rooms, each with three places to search and a door with a code lock.", min: MIN_ROOMS, max: MAX_ROOMS, initial: 3 },
    { id: "tries", label: "Tries at each lock", help: "How many times a learner can enter the code. When they are used up the code is shown and the learner can go on.", min: MIN_TRIES, max: MAX_TRIES, initial: 3 },
  ],
  summary(o) {
    const rooms = o["rooms"]!;
    return `This adds ${2 * rooms + 2} slides: an opening slide, ${rooms} rooms, ${rooms} doors with code locks and a results slide. ${4 * rooms} variables remember which places have been searched and how many tries each lock has used.`;
  },
  build: buildEscapeRoom,
};

export const GAME_SETS: GameSet[] = [quizBoard, prizeLadder, escapeRoom];

export function gameById(id: string): GameSet | undefined {
  return GAME_SETS.find((g) => g.id === id);
}
