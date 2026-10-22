// Ready-made games: each adds several slides whose rules really play, in the player's own runtime, and passes the real validator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Runtime, type Host } from "../../player/src/runtime.ts";
import { courseResults } from "../../player/src/scorm.ts";
import { totalsFromResults, valueFor } from "../../player/src/valuetext.ts";
import { decodeSuspend, encodeSuspend, evaluate, lessonStatus, SUSPEND_LIMIT } from "../../player/src/scorm.ts";
import type { CoursePackage, Layer, OSObject, Project, QuizContent, Slide, Theme } from "../../player/src/types.ts";
import { readActivation, readRules } from "./content.ts";
import { previewBlocks, SLIDE_LAYOUTS } from "./factory.ts";
import { boardGrid, clueText, doorCode, GAME_PREFIX, GAME_SETS, gameById, gameOptions, ladderGrid, MAX_ROOMS, MAX_RUNGS, MAX_TRIES, MIN_ROOMS, MIN_RUNGS, MIN_TRIES, PLACES, rungValue, tileValue } from "./gamesets.ts";
import { referencesIn } from "../../player/src/valuetext.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";
import { TEMPLATE_PREFIX } from "./templates.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-21" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const objectsOf = (s: Slide): OSObject[] => [s.baseLayer, ...s.layers].flatMap((l) => l.objects);
const quizOf = (s: Slide): OSObject => s.baseLayer.objects.find((o) => o.type === "quizQuestion")!;

/** The board and its questions, as the model made them. */
function board(options: Record<string, number> = {}) {
  const m = fresh();
  const made = m.addGameSet("quiz-board", options)!;
  const [boardSlide, ...rest] = made.slides;
  const results = rest.pop()!;
  const o = gameOptions(gameById("quiz-board")!, options);
  const categories = o["categories"]!;
  const rows = o["values"]!;
  const tiles = (c: number, r: number): OSObject => boardSlide!.baseLayer.objects.find((x) => x.name === `${tileValue(r)}, Category ${c + 1}`)!;
  return { m, made, board: boardSlide!, questions: rest, results, categories, rows, tile: tiles, finish: boardSlide!.baseLayer.objects.find((x) => x.name === "Finish")! };
}

// ---- the set of games

test("there is a Quiz board, a Prize ladder and an Escape room, named and described, and their picker values cannot clash with a layout or a lesson slide", () => {
  assert.deepEqual(GAME_SETS.map((g) => g.id), ["quiz-board", "prize-ladder", "escape-room"]);
  for (const g of GAME_SETS) {
    assert.ok(g.label && g.description, g.id);
    assert.equal(gameById(g.id), g);
    assert.ok(!SLIDE_LAYOUTS.some((l) => l.id === `${GAME_PREFIX}${g.id}`));
    assert.ok(!`${GAME_PREFIX}${g.id}`.startsWith(TEMPLATE_PREFIX));
    assert.ok(previewBlocks(g.layout, g.extras).length > 0, "the picker has something to draw");
    assert.ok(g.choices.length > 0 && g.choices.every((c) => c.min <= c.initial && c.initial <= c.max));
  }
  assert.equal(gameById("nothing"), undefined);
  assert.equal(GAME_PREFIX, "game:");
});

test("the numbers asked for are whole numbers in range, and anything else becomes the starting number", () => {
  const set = gameById("quiz-board")!;
  assert.deepEqual(gameOptions(set, {}), { categories: 4, values: 4 });
  assert.deepEqual(gameOptions(set, { categories: 6, values: 2 }), { categories: 6, values: 2 });
  assert.deepEqual(gameOptions(set, { categories: 1, values: 9 }), { categories: 4, values: 4 });
  assert.deepEqual(gameOptions(set, { categories: 3.5, values: "x" }), { categories: 4, values: 4 });
  assert.equal(set.summary({ categories: 3, values: 2 }), "This adds 8 slides: the board, 6 question slides and a results slide. 7 variables remember which tiles are used.");
});

test("asking for a game that does not exist changes nothing, not even the undo history", () => {
  const m = fresh();
  assert.equal(m.addGameSet("nothing"), null);
  assert.equal(m.undo(), false);
});

// ---- adding a game

test("a quiz board adds the board, a question for every tile and a results slide, after the slide the author was on, as one undo step", () => {
  const { m, made, board: b, questions, results } = board();
  assert.equal(made.slides.length, 18);
  assert.equal(questions.length, 16);
  assert.deepEqual(m.project.scenes[0]!.slides, ["slide-001", ...made.slides.map((s) => s.id)]);
  assert.equal(m.sel.slideId, b.id, "the board is selected");
  assert.equal(b.name, "Quiz board");
  assert.equal(b.background, "theme:bg.dark");
  assert.equal(results.name, "Game results");
  assert.equal(questions[0]!.name, "Category 1: 100");
  assert.equal(questions[3]!.name, "Category 1: 400");
  assert.equal(questions[4]!.name, "Category 2: 100");
  assert.ok(made.slides.every((s) => s.layout === null), "a game is a start, not a layout the slides stay tied to");
  assert.equal(m.variables.length, 17);

  m.undo();
  assert.equal(m.slides.length, 1);
  assert.deepEqual(m.project.scenes[0]!.slides, ["slide-001"]);
  assert.equal(m.variables.length, 0, "the variables go with the slides");
  assert.equal(m.completion, "all", "and so does the change to the completion setting");
  m.redo();
  assert.equal(m.slides.length, 19);
  assert.equal(m.variables.length, 17);
  assert.equal(m.completion, "last");
});

test("it is added after the slide being edited, not at the end", () => {
  const m = fresh();
  m.addTemplateSlide("summary");
  m.selectSlide("slide-001");
  const made = m.addGameSet("quiz-board", { categories: 2, values: 2 })!;
  const order = m.project.scenes[0]!.slides;
  assert.equal(order[0], "slide-001");
  assert.deepEqual(order.slice(1, 1 + made.slides.length), made.slides.map((s) => s.id));
  assert.equal(m.slides.at(-1)!.name, "Summary");
});

test("the course is set to complete at the last slide only when it was set to every slide, and the author is told", () => {
  const first = fresh();
  assert.equal(first.completion, "all");
  const told = first.addGameSet("quiz-board")!;
  assert.equal(first.completion, "last");
  assert.ok(told.notes.some((n) => /reaches the last slide/.test(n)), told.notes.join("\n"));

  const already = fresh();
  already.setCompletion("last");
  const quiet = already.addGameSet("quiz-board")!;
  assert.equal(already.completion, "last");
  assert.ok(!quiet.notes.some((n) => /reaches the last slide/.test(n)), "nothing changed, so nothing to say");
});

test("a second board in the same project gets variables of its own, told apart by name", () => {
  const m = fresh();
  m.addGameSet("quiz-board", { categories: 2, values: 2 });
  const names1 = m.variables.map((v) => v.name);
  m.addGameSet("quiz-board", { categories: 2, values: 2 });
  const second = m.variables.slice(names1.length);
  assert.equal(second.length, 5);
  assert.ok(second.every((v) => v.name.startsWith("Board 2: ")), second.map((v) => v.name).join(" | "));
  assert.equal(new Set(m.variables.map((v) => v.id)).size, m.variables.length);
  assert.equal(new Set(m.variables.map((v) => v.name)).size, m.variables.length);
  // Every object has an id of its own across both boards.
  const ids = m.slides.flatMap((s) => objectsOf(s).map((o) => o.id));
  assert.equal(new Set(ids).size, ids.length);
});

// ---- what each slide holds

test("every tile jumps to its own question, from the mouse and the keyboard, and is dimmed from its own variable when the board opens", () => {
  const { m, board: b, questions, categories, rows, tile } = board();
  for (let c = 0; c < categories; c++) {
    for (let r = 0; r < rows; r++) {
      const t = tile(c, r);
      const q = questions[c * rows + r]!;
      assert.equal(t.type, "button");
      assert.equal(t.content["label"], String(tileValue(r)), "the words on the tile");
      assert.ok(t.accessibility.altText.startsWith(String(tileValue(r))), "the name starts with the words on the tile");
      assert.ok(t.accessibility.altText.endsWith(`Category ${c + 1}`), "and says which category");
      assert.deepEqual(readActivation(t.triggers.slice(0, 2)), { kind: "jump", slideId: q.id });
      const dim = t.triggers[2]!;
      assert.equal(dim.event, "slideStart");
      assert.equal(dim.action, "changeState");
      assert.equal(dim.target, t.id);
      assert.equal(dim.value, "disabled");
      assert.equal(dim.conditions.length, 1);
      assert.equal(dim.conditions[0]!.operator, "equals");
      assert.equal(dim.conditions[0]!.value, true);
      assert.equal(m.variableName(dim.conditions[0]!.variable), `Used: Category ${c + 1}, ${tileValue(r)}`);
      assert.ok(t.states["disabled"], "a rule can only apply a look the object has");
    }
  }
  assert.equal(b.baseLayer.objects.filter((o) => o.type === "button").length, categories * rows + 1);
});

test("each question is one try, worth its tile's points, and marks its tile used and counts it when it is answered", () => {
  const { m, questions, categories, rows } = board();
  const played = m.variables.find((v) => v.name === "Tiles played")!;
  assert.equal(played.type, "number");
  for (let c = 0; c < categories; c++) {
    for (let r = 0; r < rows; r++) {
      const slide = questions[c * rows + r]!;
      const quiz = quizOf(slide);
      const content = quiz.content as unknown as QuizContent;
      assert.equal(content.questionType, "multipleChoice");
      assert.deepEqual(content.scoring, { points: tileValue(r), attemptsAllowed: 1 });
      assert.equal(slide.layers.length, 2);
      assert.deepEqual(slide.layers.map((l) => l.id).sort(), [content.feedback.correct, content.feedback.incorrect].sort());
      const [setUsed, setUsedKey, count, countKey, ...extra] = quiz.triggers;
      assert.equal(extra.length, 0);
      assert.deepEqual([setUsed!.event, setUsedKey!.event], ["click", "keyActivate"], "answering with the keyboard counts the same");
      assert.deepEqual([count!.event, countKey!.event], ["click", "keyActivate"]);
      assert.equal(m.variableName(setUsed!.target), `Used: Category ${c + 1}, ${tileValue(r)}`);
      assert.equal(setUsed!.action, "setVariable");
      assert.equal(setUsed!.value, true);
      assert.equal(count!.target, played.id);
      assert.equal(count!.action, "setVariable");
      assert.equal(count!.operation, "add");
      assert.equal(count!.value, 1);
      assert.equal(new Set(quiz.triggers.map((t) => t.id)).size, 4, "each rule has an id of its own");
    }
  }
});

test("the wrong-answer feedback does not offer another try, because there is only one", () => {
  const { questions } = board();
  const wrong = questions[0]!.layers.map((l) => l.objects[0]!).find((o) => o.name === "Incorrect feedback")!;
  assert.ok(!/try again/i.test(String(wrong.content["html"])));
  assert.equal(wrong.accessibility.altText, "Not quite. Say what the right answer is, and why.");
});

/** The way back to the board on a question slide: it is in the feedback, on both layers, so it is only there once the question is answered. */
const backOf = (slide: Slide): OSObject => [slide.baseLayer, ...slide.layers].flatMap((l) => l.objects).find((o) => o.name === "Back to the board")!;

test("a question's way back to the board is in its feedback, so it shows once the question is answered and not before, and every answer has it", () => {
  const { board: b, questions } = board();
  for (const slide of questions) {
    assert.ok(!slide.baseLayer.objects.some((o) => o.name === "Back to the board"), "not on the slide itself: nobody can skip the question");
    assert.equal(slide.layers.length, 2);
    for (const layer of slide.layers) {
      const back = layer.objects.find((o) => o.name === "Back to the board")!;
      assert.ok(back, `the ${layer.name} has it`);
      assert.deepEqual(readActivation(back.triggers), { kind: "jump", slideId: b.id });
      assert.equal(back.content["label"], "Back to the board");
      assert.equal(back.accessibility.altText, "Back to the board");
      assert.equal(back.triggers.some((t) => t.action === "setVariable"), false, "leaving does not use the tile up; only answering does");
    }
  }
});

test("a game's slides leave out Back and Next, except the last, where the score is", () => {
  const { board: b, questions, results } = board();
  assert.equal(b.hideNavigation, true);
  for (const q of questions) assert.equal(q.hideNavigation, true);
  assert.equal(results.hideNavigation, undefined, "the score slide keeps Back and Next");
});

test("Finish is dimmed until every tile is used, then goes to the results, which have a way back to the board", () => {
  const { m, board: b, finish, results, categories, rows } = board();
  const played = m.variables.find((v) => v.name === "Tiles played")!;
  assert.deepEqual(readActivation(finish.triggers.slice(0, 2)), { kind: "jump", slideId: results.id });
  const dim = finish.triggers[2]!;
  assert.equal(dim.event, "slideStart");
  assert.equal(dim.value, "disabled");
  assert.deepEqual(dim.conditions, [{ variable: played.id, operator: "lessThan", value: categories * rows }]);
  assert.ok(finish.states["disabled"]);
  assert.ok(objectsOf(results).some((o) => o.type === "results"));
  const back = results.baseLayer.objects.find((o) => o.name === "Back to the board")!;
  assert.deepEqual(readActivation(back.triggers), { kind: "jump", slideId: b.id });
});

test("reading order on the board goes down each category in turn, and every slide's tab order is 1, 2, 3 with no repeats", () => {
  const { made, board: b, categories, rows } = board();
  const order = b.baseLayer.objects.filter((o) => (o.accessibility.tabOrder ?? 0) >= 1).sort((x, y) => x.accessibility.tabOrder! - y.accessibility.tabOrder!).map((o) => o.name);
  const expected = ["Title", "Instructions", "Score"];
  for (let c = 0; c < categories; c++) {
    expected.push(`Category ${c + 1}`);
    for (let r = 0; r < rows; r++) expected.push(`${tileValue(r)}, Category ${c + 1}`);
  }
  expected.push("Finish");
  assert.deepEqual(order, expected);
  for (const slide of made.slides) {
    for (const layer of [slide.baseLayer, ...slide.layers]) {
      const tabs = layer.objects.map((o) => o.accessibility.tabOrder ?? 0).filter((n) => n >= 1).sort((x, y) => x - y);
      assert.deepEqual(tabs, tabs.map((_, i) => i + 1), `${slide.name}, ${layer.name}`);
    }
  }
  assert.ok(b.baseLayer.objects.filter((o) => o.name.startsWith("Category ") && o.type === "text").every((o) => o.accessibility.role === "heading"));
});

test("everything fits on the slide and nothing on the board overlaps, for every size of board", () => {
  for (let categories = 2; categories <= 6; categories++) {
    for (let rows = 2; rows <= 5; rows++) {
      const { board: b } = board({ categories, values: rows });
      const boxes = b.baseLayer.objects.map((o) => ({ name: o.name, ...o.geometry }));
      for (const g of boxes) {
        assert.ok(g.x >= 0 && g.y >= 0 && g.x + g.width <= 1280 && g.y + g.height <= 720, `${categories}x${rows}: ${g.name} is on the slide`);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const p = boxes[i]!;
          const q = boxes[j]!;
          const apart = p.x + p.width <= q.x || q.x + q.width <= p.x || p.y + p.height <= q.y || q.y + q.height <= p.y;
          assert.ok(apart, `${categories}x${rows}: ${p.name} and ${q.name} do not overlap`);
        }
      }
      for (const o of b.baseLayer.objects.filter((x) => x.type === "button")) {
        assert.ok(o.geometry.width >= 100 && o.geometry.height >= 56, `${categories}x${rows}: ${o.name} is a comfortable target`);
      }
    }
  }
  // The tiles run across the same margins as the title and the Finish button (80 to 1200).
  const grid = boardGrid(4, 4);
  assert.deepEqual(grid.tile(0, 0), [80, 204, 268, 72]);
  assert.deepEqual(grid.header(0), [80, 148, 268, 48]);
  for (let categories = 2; categories <= 6; categories++) {
    const g = boardGrid(categories, 3);
    const [x, , w] = g.tile(categories - 1, 0);
    assert.ok(x + w <= 1200 && x + w > 1200 - categories, `${categories} categories end at the right margin, to within a pixel each`);
  }
});

// ---- playing it

type Played = ReturnType<typeof play>;

type FileText = { path: string; text: string };

/** The course as the model wrote it (or as files on disk), run by the player's own runtime. A look lasts until the slide closes, as in the player. */
function play(from: Model | FileText[]) {
  const files = Array.isArray(from) ? from : from.allFiles();
  const read = <T>(p: string): T => JSON.parse(files.find((f) => f.path === p)!.text) as T;
  const project = read<Project>("project.json");
  const pkg: CoursePackage = {
    project,
    theme: read<Theme>("theme.json"),
    slides: project.scenes.flatMap((s) => s.slides).map((id) => read<Slide>(`slides/${id}.json`)),
    narration: {},
  };
  const looks = new Map<string, string>();
  /** The objects whose look was applied with the instruction to say nothing about it (the looks put back on a resume). */
  const quiet = new Set<string>();
  const host: Host = {
    showSlide: () => { looks.clear(); quiet.clear(); },
    setLayerVisible: () => {},
    playMedia: () => {},
    pauseMedia: () => {},
    stopTimer: () => {},
    setObjectState: (id, state, hush) => { looks.set(id, state); if (hush) quiet.add(id); else quiet.delete(id); },
  };
  const rt = new Runtime(pkg, host);
  return { rt, looks, quiet, pkg };
}

const variableByName = (m: Model, name: string) => m.variables.find((v) => v.name === name)!;

/** The id of the answer that is right, and of one that is not. */
function answersOf(slide: Slide): { right: string; wrong: string } {
  const q = quizOf(slide).content as unknown as QuizContent & { choices: { id: string; correct: boolean }[] };
  return { right: q.choices.find((c) => c.correct)!.id, wrong: q.choices.find((c) => !c.correct)!.id };
}

function answer(p: Played, tile: OSObject, questionSlide: Slide, how: "right" | "wrong"): void {
  p.rt.fire(tile.id, "click");
  assert.equal(p.rt.currentSlide!.id, questionSlide.id, "the tile opens its own question");
  const choice = answersOf(questionSlide)[how];
  assert.ok(p.rt.submitQuiz(quizOf(questionSlide).id, choice, "click"));
  p.rt.fire(backOf(questionSlide).id, "click");
}

test("the game plays: pick a tile, answer, come back to a board where that tile is dimmed, and Finish opens when every tile has been used", () => {
  const { m, board: b, questions, results, categories, rows, tile, finish } = board({ categories: 2, values: 2 });
  const p = play(m);
  const played = variableByName(m, "Tiles played").id;
  p.rt.goTo(b.id);
  assert.equal(p.looks.get(finish.id), "disabled", "nothing has been played, so Finish is closed");
  assert.equal([...p.looks.values()].filter((v) => v === "disabled").length, 1, "and no tile is dimmed yet");

  answer(p, tile(0, 0), questions[0]!, "right");
  assert.equal(p.rt.currentSlide!.id, b.id, "Back to the board goes back");
  assert.equal(p.rt.variables.get(played), 1);
  assert.equal(p.looks.get(tile(0, 0).id), "disabled", "the used tile is dimmed when the board opens again");
  assert.equal(p.looks.get(tile(0, 1).id), undefined, "the others are not");
  assert.equal(p.looks.get(finish.id), "disabled", "Finish is still closed");

  answer(p, tile(0, 1), questions[1]!, "wrong");
  answer(p, tile(1, 0), questions[2]!, "right");
  assert.equal(p.looks.get(finish.id), "disabled", "one tile left");
  answer(p, tile(1, 1), questions[3]!, "right");
  assert.equal(p.rt.variables.get(played), 4);
  assert.equal(p.looks.get(finish.id), undefined, "every tile is used, so Finish is open");
  assert.equal([...p.looks.values()].filter((v) => v === "disabled").length, 4, "all four tiles are dimmed");

  p.rt.fire(finish.id, "click");
  assert.equal(p.rt.currentSlide!.id, results.id);
  // Each question was worth its tile's points: 100 + 100 + 200 right, the 200 in the first column wrong.
  const sum = p.rt.assessment();
  assert.equal(sum.quizzes, 4);
  assert.equal(sum.locked, 4);
  assert.equal(sum.totalPoints, 600);
  assert.equal(sum.earnedPoints, 400);
});

test("leaving a question alone leaves its tile open, and answering twice does not count twice", () => {
  const { m, board: b, questions, tile } = board({ categories: 2, values: 2 });
  const p = play(m);
  const played = variableByName(m, "Tiles played").id;
  p.rt.goTo(b.id);
  p.rt.fire(tile(0, 0).id, "click");
  assert.ok(questions[0]!.layers.every((l) => !p.rt.visibleLayers.has(l.id)), "on a question not yet answered, neither feedback is showing, so there is no way back yet");
  p.rt.fire(backOf(questions[0]!).id, "click");
  assert.equal(p.rt.currentSlide!.id, b.id);
  assert.equal(p.rt.variables.get(played), 0);
  assert.equal(p.looks.get(tile(0, 0).id), undefined, "still open");

  answer(p, tile(0, 0), questions[0]!, "right");
  assert.equal(p.rt.variables.get(played), 1);
  // Back at a question that is already answered, such as after resuming at the board (looks are not rebuilt then), a second answer is refused.
  p.rt.goTo(questions[0]!.id);
  const again = p.rt.submitQuiz(quizOf(questions[0]!).id, answersOf(questions[0]!).wrong, "click");
  assert.equal(again!.locked, true);
  assert.equal(p.rt.variables.get(played), 1, "not counted again");
  assert.equal(p.rt.assessment().earnedPoints, 100, "and the score stands");
});

test("a learner who leaves part way through comes back to the same board: used tiles and the count are kept", () => {
  const { m, board: b, questions, tile, finish } = board({ categories: 2, values: 2 });
  const first = play(m);
  first.rt.goTo(b.id);
  answer(first, tile(0, 0), questions[0]!, "right");
  answer(first, tile(1, 1), questions[3]!, "wrong");
  const saved = JSON.parse(encodeSuspend(first.rt.snapshot())) as { x: Record<string, unknown> };
  assert.equal(Object.keys(saved.x).length, 3, "two used tiles and the count");

  // What the LMS would hand back: the saved text, read again.
  const second = play(m);
  assert.equal(second.rt.restore(decodeSuspend(encodeSuspend(first.rt.snapshot()))!), true);
  assert.equal(second.rt.currentSlide!.id, b.id, "back on the board");
  const played = variableByName(m, "Tiles played").id;
  assert.equal(second.rt.variables.get(played), 2);
  // A look is not saved, and a resumed slide does not run its start rules, but the board is right straight away: the used tiles are dimmed from
  // their variables, and Finish is still closed.
  assert.equal(second.looks.get(tile(0, 0).id), "disabled", "a used tile looks used");
  assert.equal(second.looks.get(tile(1, 1).id), "disabled", "and so does the one answered wrong");
  assert.equal(second.looks.get(tile(0, 1).id), undefined, "an unused tile does not");
  assert.equal(second.looks.get(tile(1, 0).id), undefined);
  assert.equal(second.looks.get(finish.id), "disabled", "two tiles are left, so Finish is closed");
  assert.deepEqual(second.quiet, new Set([tile(0, 0).id, tile(1, 1).id, finish.id]), "and nothing was said about it");

  // The learner carries on from there, and Finish opens when the last tile is used.
  answer(second, tile(0, 1), questions[1]!, "right");
  answer(second, tile(1, 0), questions[2]!, "right");
  assert.equal(second.looks.get(finish.id), undefined);
});

test("a learner who leaves with every tile used comes back to a board whose Finish is open", () => {
  const { m, board: b, questions, tile, finish, categories, rows } = board({ categories: 2, values: 2 });
  const first = play(m);
  first.rt.goTo(b.id);
  for (let c = 0; c < categories; c++) for (let r = 0; r < rows; r++) answer(first, tile(c, r), questions[c * rows + r]!, "right");
  const second = play(m);
  assert.equal(second.rt.restore(decodeSuspend(encodeSuspend(first.rt.snapshot()))!), true);
  assert.equal(second.looks.get(finish.id), undefined, "every tile is used, so Finish is open");
  assert.equal([...second.looks.values()].filter((v) => v === "disabled").length, 4, "and all four tiles look used");
});

test("a finished board of the largest size still fits in the 4096 characters SCORM 1.2 keeps, with nothing dropped", () => {
  const { m, board: b, questions, categories, rows, tile } = board({ categories: 6, values: 5 });
  const p = play(m);
  p.rt.goTo(b.id);
  for (let c = 0; c < categories; c++) for (let r = 0; r < rows; r++) answer(p, tile(c, r), questions[c * rows + r]!, r % 2 === 0 ? "right" : "wrong");
  const text = encodeSuspend(p.rt.snapshot());
  assert.ok(text.length < SUSPEND_LIMIT, `${text.length} characters`);
  const parsed = JSON.parse(text) as Record<string, unknown>;
  assert.ok(parsed["x"] && parsed["d"], "the variables and the slides seen are still there");
});

// ---- the real validator

type Finding = { severity: string; rule: string; message: string; file: string };

function validate(from: Model | FileText[]): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-games-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of Array.isArray(from) ? from : from.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout) as Finding[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a project with a quiz board passes the real validator with no errors, for the smallest board, the starting one and the largest", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  for (const options of [{ categories: 2, values: 2 }, {}, { categories: 6, values: 5 }] as Record<string, number>[]) {
    const { m } = board(options);
    const findings = validate(m);
    assert.deepEqual(findings.filter((f) => f.severity === "error"), [], JSON.stringify(options));
    // The wiring is right: no rule points at nothing, applies a look that is missing, or skips a slide the course needs; no tab order repeats.
    const wiring = findings.filter((f) => /^(trigger|condition|tab-order|completion|state-|slide-)/.test(f.rule));
    assert.deepEqual(wiring, [], JSON.stringify(wiring));
  }
});

test("a quiz board in a course that counts every slide would be warned about, which is why the game sets the course to the last slide", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const { m } = board({ categories: 2, values: 2 });
  m.setCompletion("all");
  assert.ok(validate(m).some((f) => f.rule === "completion-skippable"));
});

// ---- the example project, as it is in the repository

function exampleFiles(name = "quiz-board"): FileText[] {
  const dir = path.join(repo, "examples", `${name}.osproj`);
  const read = (rel: string): FileText => ({ path: rel, text: readFileSync(path.join(dir, rel), "utf-8") });
  return [read("project.json"), read("theme.json"), ...readdirSync(path.join(dir, "slides")).filter((n) => n.endsWith(".json")).map((n) => read(`slides/${n}`))];
}

test("the quiz-board example has all nine questions written, with the right answer in different places", () => {
  const { pkg } = play(exampleFiles());
  const board = pkg.slides[1]!;
  assert.deepEqual(board.baseLayer.objects.filter((o) => o.type === "button" && o.name !== "Finish").map((o) => o.name),
    ["100, Colour", "200, Colour", "300, Colour", "100, Keyboard", "200, Keyboard", "300, Keyboard", "100, Words", "200, Words", "300, Words"]);
  const questions = pkg.slides.filter((s) => s.baseLayer.objects.some((o) => o.type === "quizQuestion"));
  assert.equal(questions.length, 9);
  const positions = new Set<number>();
  for (const s of questions) {
    const prompt = s.baseLayer.objects.find((o) => o.name === "Question")!;
    assert.ok(!/Type your question here/.test(String(prompt.content["html"])), `${s.name} is written`);
    const q = quizOf(s).content as unknown as { choices: { label: string; correct: boolean }[] };
    assert.ok(q.choices.every((c) => !/^(First|Second|Third) answer$/.test(c.label)), `${s.name} has its own answers`);
    positions.add(q.choices.findIndex((c) => c.correct));
    for (const l of s.layers) assert.ok(!/Explain why|Give a hint|Say what the right answer is/.test(String(l.objects[0]!.content["html"])), `${s.name}: ${l.name} is written`);
  }
  assert.ok(positions.size === 3, "the right answer is first, second and third in some question");
});

test("the quiz-board example passes the real validator with no findings at all, and can be played from the first tile to a full score", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const files = exampleFiles();
  assert.deepEqual(validate(files), []);

  const p = play(files);
  const [, board, ...rest] = p.pkg.slides;
  const results = rest.pop()!;
  const tiles = board!.baseLayer.objects.filter((o) => o.type === "button" && o.name !== "Finish");
  const finish = board!.baseLayer.objects.find((o) => o.name === "Finish")!;
  p.rt.goTo(board!.id);
  assert.equal(p.looks.get(finish.id), "disabled");
  for (const t of tiles) {
    const target = readActivation(t.triggers.slice(0, 2));
    assert.equal(target.kind, "jump");
    const question = p.pkg.slides.find((s) => s.id === (target as { slideId: string }).slideId)!;
    p.rt.fire(t.id, "click");
    assert.equal(p.rt.currentSlide!.id, question.id);
    assert.ok(p.rt.submitQuiz(quizOf(question).id, answersOf(question).right, "click")!.correct);
    p.rt.fire(backOf(question).id, "click");
  }
  assert.equal(p.looks.get(finish.id), undefined, "every tile used, so Finish is open");
  assert.equal(tiles.filter((t) => p.looks.get(t.id) === "disabled").length, 9);
  p.rt.fire(finish.id, "click");
  assert.equal(p.rt.currentSlide!.id, results.id);
  assert.deepEqual(p.rt.assessment(), { quizzes: 9, locked: 9, totalPoints: 1800, earnedPoints: 1800 });
});

// ---- the prize ladder

/** The ladder as the model made it: the opening slide, a question for every rung, and the results. */
function ladderGame(options: Record<string, number> = {}) {
  const m = fresh();
  const made = m.addGameSet("prize-ladder", options)!;
  const [intro, ...rest] = made.slides;
  const results = rest.pop()!;
  return { m, made, intro: intro!, questions: rest, results, rungs: rest.length };
}

const rungsOf = (s: Slide): OSObject[] => s.baseLayer.objects.filter((o) => o.name.startsWith("Ladder: "));
const nextIn = (layer: Layer): OSObject => layer.objects.find((o) => o.type === "button")!;
const feedbackOf = (s: Slide): { correct: string; incorrect: string } => (quizOf(s).content as unknown as QuizContent).feedback;
const levelOf = (rung: OSObject): number => Number(/^<p>(\d+)\./.exec(String(rung.content["html"]))![1]);

test("the questions asked for are whole numbers from 5 to 15, and anything else becomes eight", () => {
  const set = gameById("prize-ladder")!;
  assert.deepEqual([MIN_RUNGS, MAX_RUNGS], [5, 15]);
  assert.deepEqual(gameOptions(set, {}), { questions: 8 });
  assert.deepEqual(gameOptions(set, { questions: 15 }), { questions: 15 });
  assert.deepEqual(gameOptions(set, { questions: 4 }), { questions: 8 });
  assert.deepEqual(gameOptions(set, { questions: 16 }), { questions: 8 });
  assert.equal(set.summary({ questions: 6 }), "This adds 8 slides: an opening slide, 6 question slides and a results slide. It needs no variables.");
  assert.equal(rungValue(1), 100);
  assert.equal(rungValue(8), 800);
});

test("a prize ladder adds an opening slide, a question for every rung and a results slide, after the slide the author was on, as one undo step, with no variables and no change to the course settings", () => {
  const { m, made, intro, questions, results } = ladderGame();
  assert.equal(made.slides.length, 10);
  assert.equal(questions.length, 8);
  assert.deepEqual(m.project.scenes[0]!.slides, ["slide-001", ...made.slides.map((s) => s.id)]);
  assert.equal(m.sel.slideId, intro.id, "the opening slide is selected");
  assert.equal(intro.name, "Prize ladder");
  assert.equal(intro.background, "theme:bg.dark");
  assert.deepEqual(questions.map((s) => s.name), ["Question 1: 100", "Question 2: 200", "Question 3: 300", "Question 4: 400", "Question 5: 500", "Question 6: 600", "Question 7: 700", "Question 8: 800"]);
  assert.equal(results.name, "Game results");
  assert.ok(made.slides.every((s) => s.layout === null));
  assert.equal(m.variables.length, 0, "a ladder remembers nothing: each question is its own slide");
  assert.equal(m.completion, "all", "every jump goes to the next slide, so there is nothing for the validator to warn about and no setting to change");
  assert.ok(!made.notes.some((n) => /reaches the last slide/.test(n)));

  m.undo();
  assert.equal(m.slides.length, 1);
  assert.deepEqual(m.project.scenes[0]!.slides, ["slide-001"]);
  m.redo();
  assert.equal(m.slides.length, 11);
});

test("it is added after the slide being edited, and two ladders in one project do not share any ids", () => {
  const m = fresh();
  m.addTemplateSlide("summary");
  m.selectSlide("slide-001");
  const first = m.addGameSet("prize-ladder", { questions: 5 })!;
  m.addGameSet("prize-ladder", { questions: 5 });
  assert.equal(m.project.scenes[0]!.slides[1], first.slides[0]!.id);
  assert.equal(m.slides.length, 1 + 7 + 7 + 1);
  const ids = m.slides.flatMap((s) => objectsOf(s).map((o) => o.id));
  assert.equal(new Set(ids).size, ids.length);
});

test("Start goes to the first question, and each question's feedback has the way on to the next, ending at the results", () => {
  const { intro, questions, results } = ladderGame();
  const start = intro.baseLayer.objects.find((o) => o.name === "Start the game")!;
  assert.equal(start.content["label"], "Start", "the name starts with the words on the button");
  assert.deepEqual(readActivation(start.triggers), { kind: "jump", slideId: questions[0]!.id });
  questions.forEach((s, i) => {
    const level = i + 1;
    const content = quizOf(s).content as unknown as QuizContent & { choices: unknown[] };
    assert.equal(content.questionType, "multipleChoice");
    assert.deepEqual(content.scoring, { points: level * 100, attemptsAllowed: 1 }, `${s.name} is one try, worth its rung`);
    assert.equal(s.layers.length, 2);
    assert.deepEqual(s.layers.map((l) => l.id).sort(), [content.feedback.correct, content.feedback.incorrect].sort());
    const last = level === questions.length;
    for (const layer of s.layers) {
      const next = nextIn(layer);
      assert.equal(next.content["label"], last ? "See my results" : "Next question");
      assert.equal(next.accessibility.altText, next.content["label"]);
      assert.deepEqual(readActivation(next.triggers), { kind: "jump", slideId: last ? results.id : questions[i + 1]!.id });
    }
    assert.equal(s.baseLayer.objects.filter((o) => o.type === "button").length, 0, "no way on until an answer has been given");
    assert.deepEqual(quizOf(s).triggers, [], "nothing to remember, so the question has no rules");
    const where = s.baseLayer.objects.find((o) => o.name === "Where you are")!;
    assert.equal(where.content["html"], `<p>Question ${level} of 8, worth ${level * 100} points. Points so far: {{$score}}</p>`);
  });
  assert.equal(objectsOf(results).filter((o) => o.type === "button").length, 0, "the results are the end");
  assert.ok(objectsOf(results).some((o) => o.type === "results"));
});

test("the wrong-answer feedback does not offer another try, and shows the right answer is to be said", () => {
  const { questions } = ladderGame();
  const wrong = questions[0]!.layers.map((l) => l.objects[0]!).find((o) => o.name === "Incorrect feedback")!;
  assert.ok(!/try again/i.test(String(wrong.content["html"])));
  assert.equal(wrong.accessibility.altText, "Not quite. Say what the right answer is, and why.");
});

test("the ladder on each slide is decoration that shows where the learner is, and the same facts are in real text", () => {
  const { intro, questions, rungs } = ladderGame({ questions: 6 });
  const tags = new Set<string>();
  const check = (s: Slide, here: number) => {
    const r = rungsOf(s);
    assert.equal(r.length, rungs, s.name);
    assert.equal(new Set(r.map((o) => o.group)).size, 1, "one group, so the author can move or delete the ladder as one");
    tags.add(r[0]!.group!);
    for (const o of r) {
      assert.equal(o.accessibility.decorative, true);
      assert.equal(o.accessibility.tabOrder, 0);
      assert.equal(o.accessibility.altText, "");
      const level = levelOf(o);
      assert.equal(o.content["html"], `<p>${level}. ${level * 100} points</p>`);
      const kind = level === here ? "here" : level < here ? "answered" : "ahead";
      if (kind === "here") assert.deepEqual([o.style["fill"], o.style["color"], o.style["fontWeight"]], ["theme:color.accentStrong", "theme:color.onAccentStrong", "700"], `${s.name}: rung ${level}`);
      if (kind === "ahead") assert.deepEqual([o.style["fill"], o.style["color"], o.style["fontWeight"]], ["theme:color.surface", "theme:color.text", undefined], `${s.name}: rung ${level}`);
      if (kind === "answered") assert.deepEqual([o.style["fill"], o.style["color"], o.style["fontWeight"]], [undefined, "theme:color.muted", undefined], `${s.name}: rung ${level}`);
    }
    // The highest rung is at the top.
    const byLevel = [...r].sort((a, b) => levelOf(a) - levelOf(b));
    for (let i = 1; i < byLevel.length; i++) assert.ok(byLevel[i]!.geometry.y < byLevel[i - 1]!.geometry.y);
  };
  check(intro, 0);
  questions.forEach((s, i) => check(s, i + 1));
  assert.equal(tags.size, 7, "each slide has a group of its own");
});

test("reading order on a question is where the learner is, the question, then its answers, and in the feedback the words then the way on", () => {
  const { made } = ladderGame();
  for (const s of made.slides) {
    for (const layer of [s.baseLayer, ...s.layers]) {
      const tabs = layer.objects.map((o) => o.accessibility.tabOrder ?? 0).filter((n) => n >= 1).sort((x, y) => x - y);
      assert.deepEqual(tabs, tabs.map((_, i) => i + 1), `${s.name}, ${layer.name}`);
    }
  }
  const q = ladderGame().questions[0]!;
  const order = q.baseLayer.objects.filter((o) => (o.accessibility.tabOrder ?? 0) >= 1).sort((a, b) => a.accessibility.tabOrder! - b.accessibility.tabOrder!).map((o) => o.name);
  assert.deepEqual(order, ["Where you are", "Question", "Multiple choice question"]);
  for (const layer of q.layers) assert.deepEqual(layer.objects.filter((o) => (o.accessibility.tabOrder ?? 0) >= 1).sort((a, b) => a.accessibility.tabOrder! - b.accessibility.tabOrder!).map((o) => o.type), ["text", "button"]);
});

test("everything fits on the slide and nothing overlaps, for every number of questions", () => {
  for (let n = MIN_RUNGS; n <= MAX_RUNGS; n++) {
    const g = ladderGrid(n);
    assert.ok(g.h >= 38, `${n} rungs: each is tall enough for its words`);
    assert.ok(g.rect(1)[1] + g.h <= 700, `${n} rungs: the lowest ends on the slide`);
    const { made } = ladderGame({ questions: n });
    for (const s of made.slides) {
      const base = s.baseLayer.objects.map((o) => ({ name: o.name, ...o.geometry }));
      for (const layer of s.layers) {
        // The feedback is shown over the base layer, so it must not cover the question or the ladder.
        const over = [...base, ...layer.objects.map((o) => ({ name: `${layer.name}: ${o.name}`, ...o.geometry }))];
        for (let i = 0; i < over.length; i++) for (let j = i + 1; j < over.length; j++) assertApart(over[i]!, over[j]!, `${n} rungs, ${s.name}`);
      }
      for (const b of base) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= 1280 && b.y + b.height <= 720, `${n} rungs, ${s.name}: ${b.name} is on the slide`);
      for (let i = 0; i < base.length; i++) for (let j = i + 1; j < base.length; j++) assertApart(base[i]!, base[j]!, `${n} rungs, ${s.name}`);
    }
  }
});

function assertApart(p: { name: string; x: number; y: number; width: number; height: number }, q: { name: string; x: number; y: number; width: number; height: number }, where: string): void {
  const apart = p.x + p.width <= q.x || q.x + q.width <= p.x || p.y + p.height <= q.y || q.y + q.height <= p.y;
  assert.ok(apart, `${where}: ${p.name} and ${q.name} do not overlap`);
}

/** Answer a question, take the way on that its feedback shows, and say which feedback it was. */
function answerAndGoOn(p: Played, s: Slide, how: "right" | "wrong"): "correct" | "incorrect" {
  const out = p.rt.submitQuiz(quizOf(s).id, answersOf(s)[how], "click")!;
  assert.equal(out.correct, how === "right");
  const feedback = feedbackOf(s);
  const shown = how === "right" ? feedback.correct : feedback.incorrect;
  const other = how === "right" ? feedback.incorrect : feedback.correct;
  assert.ok(p.rt.visibleLayers.has(shown) && !p.rt.visibleLayers.has(other), "the right feedback is showing, and only that");
  p.rt.fire(nextIn(s.layers.find((l) => l.id === shown)!).id, "click");
  return how === "right" ? "correct" : "incorrect";
}

test("the game plays to the end whatever the answers: every question gets finished, so the course can be completed", () => {
  const { m, intro, questions, results } = ladderGame({ questions: 5 });
  const p = play(m);
  p.rt.goTo("slide-001"); // the course's own first slide; the player's Next takes the learner on to the game
  p.rt.goTo(intro.id);
  p.rt.fire(intro.baseLayer.objects.find((o) => o.name === "Start the game")!.id, "click");
  questions.forEach((s, i) => {
    assert.equal(p.rt.currentSlide!.id, s.id, `on question ${i + 1}`);
    answerAndGoOn(p, s, i % 2 === 0 ? "right" : "wrong");
  });
  assert.equal(p.rt.currentSlide!.id, results.id);
  // 100, 300 and 500 earned of 1500: the wrong answers cost their points, but they did not end the game.
  assert.deepEqual(p.rt.assessment(), { quizzes: 5, locked: 5, totalPoints: 1500, earnedPoints: 900 });
  const progress = evaluate(p.rt);
  assert.equal(progress.completed, true, "every slide seen and every question finished");
  assert.equal(progress.scorePercent, 60);
  assert.equal(lessonStatus(progress, "incomplete"), "failed", "the LMS is told how it went, not left waiting");
});

test("a ladder left part way is never complete, which is why a wrong answer does not end the game", () => {
  const { m, intro, questions, results } = ladderGame({ questions: 5 });
  const p = play(m);
  p.rt.goTo("slide-001");
  p.rt.goTo(intro.id);
  p.rt.fire(intro.baseLayer.objects.find((o) => o.name === "Start the game")!.id, "click");
  answerAndGoOn(p, questions[0]!, "right");
  answerAndGoOn(p, questions[1]!, "wrong");
  // Were a wrong answer to send the learner to the end, the rest of the questions would stay unanswered, and the course could never complete.
  p.rt.goTo(results.id);
  const progress = evaluate(p.rt);
  assert.equal(progress.completed, false);
  assert.equal(progress.success, null);
  assert.equal(lessonStatus(progress, "incomplete"), "incomplete");
});

test("answering every question right passes", () => {
  const { m, intro, questions } = ladderGame({ questions: 5 });
  const p = play(m);
  p.rt.goTo("slide-001");
  p.rt.goTo(intro.id);
  p.rt.fire(intro.baseLayer.objects.find((o) => o.name === "Start the game")!.id, "click");
  for (const s of questions) answerAndGoOn(p, s, "right");
  assert.equal(lessonStatus(evaluate(p.rt), "incomplete"), "passed");
});

test("a learner who leaves after answering comes back to the same question, with its feedback and the way on still showing", () => {
  const { m, intro, questions } = ladderGame({ questions: 5 });
  const first = play(m);
  first.rt.goTo("slide-001");
  first.rt.goTo(intro.id);
  first.rt.fire(intro.baseLayer.objects.find((o) => o.name === "Start the game")!.id, "click");
  answerAndGoOn(first, questions[0]!, "right");
  answerAndGoOn(first, questions[1]!, "right");
  const third = questions[2]!;
  first.rt.submitQuiz(quizOf(third).id, answersOf(third).wrong, "click");

  const second = play(m);
  assert.equal(second.rt.restore(decodeSuspend(encodeSuspend(first.rt.snapshot()))!), true);
  assert.equal(second.rt.currentSlide!.id, third.id);
  const shown = feedbackOf(third).incorrect;
  assert.ok(second.rt.visibleLayers.has(shown), "the feedback they were reading is still open");
  assert.equal(second.rt.quiz.get(quizOf(third).id)!.locked, true);
  second.rt.fire(nextIn(third.layers.find((l) => l.id === shown)!).id, "click");
  assert.equal(second.rt.currentSlide!.id, questions[3]!.id, "and the way on works");
  answerAndGoOn(second, questions[3]!, "right");
  answerAndGoOn(second, questions[4]!, "right");
  assert.equal(evaluate(second.rt).completed, true);
});

test("the prize-ladder example has all eight questions written, with the right answer in different places", () => {
  const { pkg } = play(exampleFiles("prize-ladder"));
  const questions = pkg.slides.filter((s) => s.baseLayer.objects.some((o) => o.type === "quizQuestion"));
  assert.equal(questions.length, 8);
  assert.deepEqual(questions.map((s) => s.name), Array.from({ length: 8 }, (_, i) => `Question ${i + 1}: ${(i + 1) * 100}`));
  const positions = new Set<number>();
  for (const s of questions) {
    const prompt = s.baseLayer.objects.find((o) => o.name === "Question")!;
    assert.ok(!/Type your question here/.test(String(prompt.content["html"])), `${s.name} is written`);
    const q = quizOf(s).content as unknown as { choices: { label: string; correct: boolean }[] };
    assert.ok(q.choices.every((c) => !/^(First|Second|Third) answer$/.test(c.label)), `${s.name} has its own answers`);
    assert.equal(q.choices.filter((c) => c.correct).length, 1);
    positions.add(q.choices.findIndex((c) => c.correct));
    for (const l of s.layers) assert.ok(!/Explain why|Give a hint|Say what the right answer is/.test(String(l.objects[0]!.content["html"])), `${s.name}: ${l.name} is written`);
  }
  assert.equal(positions.size, 3);
});

test("the prize-ladder example passes the real validator with no findings at all, and can be played from the title to a full score and a pass", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const files = exampleFiles("prize-ladder");
  assert.deepEqual(validate(files), []);
  const p = play(files);
  const [title, intro, ...rest] = p.pkg.slides;
  const results = rest.pop()!;
  p.rt.goTo(title!.id);
  p.rt.goTo(intro!.id);
  p.rt.fire(intro!.baseLayer.objects.find((o) => o.name === "Start the game")!.id, "click");
  for (const s of rest) {
    assert.equal(p.rt.currentSlide!.id, s.id);
    answerAndGoOn(p, s, "right");
  }
  assert.equal(p.rt.currentSlide!.id, results.id);
  assert.deepEqual(p.rt.assessment(), { quizzes: 8, locked: 8, totalPoints: 3600, earnedPoints: 3600 });
  assert.equal(lessonStatus(evaluate(p.rt), "incomplete"), "passed");
});

test("a project with a prize ladder passes the real validator with no findings at all, for every number of questions that matters and on every built-in theme", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  for (const n of [MIN_RUNGS, 8, MAX_RUNGS]) assert.deepEqual(validate(ladderGame({ questions: n }).m), [], `${n} questions`);
  // The rungs paint their own fills, so their words are judged against those on each theme.
  const { m } = ladderGame();
  const files = m.allFiles();
  const themesDir = path.join(repo, "themes");
  for (const name of readdirSync(themesDir).filter((n) => n.endsWith(".theme.json"))) {
    const swapped = files.map((f) => (f.path === "theme.json" ? { ...f, text: readFileSync(path.join(themesDir, name), "utf-8") } : f));
    assert.deepEqual(validate(swapped), [], name);
  }
});

// ---- the escape room

/** The escape room as the model made it: the opening slide, then a room and its door for each room, and the results. */
function escapeGame(options: Record<string, number> = {}) {
  const m = fresh();
  const made = m.addGameSet("escape-room", options)!;
  const [intro, ...rest] = made.slides;
  const results = rest.pop()!;
  const rooms: Slide[] = [];
  const locks: Slide[] = [];
  rest.forEach((s, i) => (i % 2 === 0 ? rooms : locks).push(s));
  return { m, made, intro: intro!, rooms, locks, results };
}

const spotsOf = (room: Slide): OSObject[] => room.baseLayer.objects.filter((o) => o.type === "button" && o.name.startsWith("Look "));
const layerNamed = (s: Slide, name: string): Layer => s.layers.find((l) => l.name === name)!;
const buttonNamed = (s: Slide | Layer, name: string): OSObject => (("baseLayer" in s ? objectsOf(s) : s.objects)).find((o) => o.type === "button" && o.name === name)!;
const triesOf = (m: Model, room: number): string => variableByName(m, `Room ${room}: tries`).id;

/** The ways on a learner could use at a lock right now: a "Next room" button in a layer that is showing and not dimmed. */
function waysOn(p: Played, lock: Slide): OSObject[] {
  return lock.layers.filter((l) => p.rt.visibleLayers.has(l.id)).flatMap((l) => l.objects).filter((o) => o.type === "button" && o.name === "Next room" && p.looks.get(o.id) !== "disabled");
}

/** Begin a game from the course's first slide, as a learner does, and stop on the opening slide of the game. */
function startEscape(g: ReturnType<typeof escapeGame>) {
  const p = play(g.m);
  p.rt.goTo("slide-001");
  p.rt.goTo(g.intro.id);
  return p;
}

const attempt = (p: Played, lock: Slide, how: "right" | "wrong"): void => {
  const code = ((quizOf(lock).content as unknown as { answers: string[] }).answers[0])!;
  const out = p.rt.submitQuiz(quizOf(lock).id, how === "right" ? code : "0000", "click")!;
  assert.equal(out.correct, how === "right");
};

test("the rooms and tries asked for are whole numbers in range, and anything else becomes three", () => {
  const set = gameById("escape-room")!;
  assert.deepEqual([MIN_ROOMS, MAX_ROOMS, MIN_TRIES, MAX_TRIES, PLACES], [2, 5, 1, 3, 3]);
  assert.deepEqual(gameOptions(set, {}), { rooms: 3, tries: 3 });
  assert.deepEqual(gameOptions(set, { rooms: 5, tries: 1 }), { rooms: 5, tries: 1 });
  assert.deepEqual(gameOptions(set, { rooms: 1, tries: 4 }), { rooms: 3, tries: 3 });
  assert.equal(set.summary({ rooms: 2, tries: 3 }), "This adds 6 slides: an opening slide, 2 rooms, 2 doors with code locks and a results slide. 8 variables remember which places have been searched and how many tries each lock has used.");
});

test("an escape room adds an opening slide, a room and a door for each room, and a results slide, after the slide the author was on, as one undo step", () => {
  const { m, made, intro, rooms, locks, results } = escapeGame();
  assert.equal(made.slides.length, 8);
  assert.equal(rooms.length, 3);
  assert.equal(locks.length, 3);
  assert.deepEqual(m.project.scenes[0]!.slides, ["slide-001", ...made.slides.map((s) => s.id)]);
  assert.equal(m.sel.slideId, intro.id);
  assert.deepEqual(made.slides.map((s) => s.name), ["Escape room", "Room 1", "Room 1: the door", "Room 2", "Room 2: the door", "Room 3", "Room 3: the door", "Game results"]);
  assert.equal(intro.background, "theme:bg.dark");
  assert.ok(made.slides.every((s) => s.layout === null));
  assert.deepEqual(m.variables.map((v) => v.name), [
    "Room 1: place 1 searched", "Room 1: place 2 searched", "Room 1: place 3 searched", "Room 1: tries",
    "Room 2: place 1 searched", "Room 2: place 2 searched", "Room 2: place 3 searched", "Room 2: tries",
    "Room 3: place 1 searched", "Room 3: place 2 searched", "Room 3: place 3 searched", "Room 3: tries",
  ]);
  assert.deepEqual(m.variables.map((v) => v.type), ["boolean", "boolean", "boolean", "number", "boolean", "boolean", "boolean", "number", "boolean", "boolean", "boolean", "number"]);
  assert.equal(m.completion, "all", "every way on goes to the next slide, so there is nothing to warn about and no setting to change");
  assert.ok(made.notes.some((n) => n.includes("4271")), "the author is told the first code");
  assert.ok(!made.notes.some((n) => /reaches the last slide/.test(n)));

  m.undo();
  assert.equal(m.slides.length, 1);
  assert.equal(m.variables.length, 0);
  m.redo();
  assert.equal(m.slides.length, 9);
  assert.equal(m.variables.length, 12);
});

test("two escape rooms in one project get variables and ids of their own", () => {
  const m = fresh();
  m.addGameSet("escape-room", { rooms: 2, tries: 2 });
  const first = m.variables.map((v) => v.name);
  m.addGameSet("escape-room", { rooms: 2, tries: 2 });
  const second = m.variables.slice(first.length);
  assert.equal(second.length, 8);
  assert.ok(second.every((v) => v.name.startsWith("Escape room 2: ")), second.map((v) => v.name).join(" | "));
  assert.equal(new Set(m.variables.map((v) => v.id)).size, m.variables.length);
  assert.equal(new Set(m.variables.map((v) => v.name)).size, m.variables.length);
  const ids = m.slides.flatMap((s) => objectsOf(s).map((o) => o.id));
  assert.equal(new Set(ids).size, ids.length);
});

test("Start goes to the first room, each room's button goes to its door, a door goes on to the next room or the results, and back to its room", () => {
  const { intro, rooms, locks, results } = escapeGame();
  assert.deepEqual(readActivation(buttonNamed(intro, "Start the game").triggers), { kind: "jump", slideId: rooms[0]!.id });
  rooms.forEach((room, i) => {
    assert.deepEqual(readActivation(buttonNamed(room, "Go to the door").triggers), { kind: "jump", slideId: locks[i]!.id });
    const onward = i === rooms.length - 1 ? results.id : rooms[i + 1]!.id;
    assert.deepEqual(readActivation(buttonNamed(layerNamed(locks[i]!, "Correct feedback"), "Next room").triggers), { kind: "jump", slideId: onward });
    assert.deepEqual(readActivation(buttonNamed(layerNamed(locks[i]!, "Incorrect feedback"), "Next room").triggers.slice(0, 2)), { kind: "jump", slideId: onward });
    assert.deepEqual(readActivation(buttonNamed(locks[i]!, "Back to the room").triggers), { kind: "jump", slideId: room.id });
  });
  assert.equal(objectsOf(results).filter((o) => o.type === "button").length, 0, "the results are the end");
  assert.equal(objectsOf(results).find((o) => o.name === "Title")!.content["html"], "<h1>You escaped</h1>");
});

test("each room has three places to search, and searching one opens its clue alone, marks the place, and is remembered", () => {
  const { m, rooms } = escapeGame();
  rooms.forEach((room, r) => {
    const spots = spotsOf(room);
    assert.equal(spots.length, 3);
    assert.equal(room.layers.length, 3);
    spots.forEach((spot, j) => {
      const own = room.layers[j]!;
      const found = variableByName(m, `Room ${r + 1}: place ${j + 1} searched`).id;
      const items = readRules(spot.triggers).map((i) => (i.kind === "rule" ? i.rule : null)!);
      assert.deepEqual(items.map((x) => `${x.event}:${x.action}`), ["activate:hideLayer", "activate:hideLayer", "activate:setVariable", "activate:changeState", "activate:showLayer", "slideStart:changeState"]);
      assert.deepEqual(items.slice(0, 2).map((x) => x.target).sort(), room.layers.filter((l) => l !== own).map((l) => l.id).sort(), "the other two clues are closed");
      assert.deepEqual([items[2]!.target, items[2]!.value], [found, true]);
      assert.deepEqual([items[3]!.target, items[3]!.value], [spot.id, "Searched"]);
      assert.equal(items[4]!.target, own.id);
      assert.deepEqual([items[5]!.target, items[5]!.value, items[5]!.conditions], [spot.id, "Searched", [{ variable: found, operator: "equals", value: true }]]);
      // Pressed with the keyboard it does the same: every rule is a click and a key press.
      assert.equal(spot.triggers.filter((t) => t.event === "keyActivate").length, 5);
      assert.ok(spot.states["Searched"]!.announce, "a rule applies this look, so a screen reader is told");
      // The clue itself, and a way to close it.
      const note = own.objects.find((o) => o.name === "Clue")!;
      assert.equal(note.accessibility.role, "status");
      assert.ok(note.content["html"] !== "<p></p>");
      assert.deepEqual(readActivation(buttonNamed(own, "Close this clue").triggers), { kind: "hide", layerId: own.id });
    });
  });
});

test("in each room the three clues spell out the code of the door, so the game can be played as it is made", () => {
  const { rooms, locks } = escapeGame({ rooms: 5 });
  rooms.forEach((room, r) => {
    const code = doorCode(r + 1);
    const answers = (quizOf(locks[r]!).content as unknown as { answers: string[] }).answers;
    assert.deepEqual(answers, [code]);
    const said = room.layers.map((l) => String(l.objects.find((o) => o.name === "Clue")!.content["html"]));
    assert.deepEqual(said, [0, 1, 2].map((j) => `<p>${clueText(j, code)}</p>`));
    const [a, b, c] = said.map((s) => /digits? (?:is|are) (\d+)/.exec(s)![1]!);
    assert.equal(a! + b! + c!, code, `room ${r + 1}`);
  });
  assert.equal(new Set(Array.from({ length: 5 }, (_, i) => doorCode(i + 1))).size, 5, "five different codes");
});

test("each door is a typed code with the tries asked for, and counts them, shows the code when they are used up, and has one way on after a right answer and a dimmed one after a wrong", () => {
  for (const tries of [1, 2, 3]) {
    const { m, locks } = escapeGame({ rooms: 2, tries });
    locks.forEach((lock, i) => {
      const content = quizOf(lock).content as unknown as QuizContent & { answers: string[]; caseSensitive: boolean };
      assert.equal(content.questionType, "shortAnswer");
      assert.deepEqual(content.scoring, { points: 100, attemptsAllowed: tries });
      assert.deepEqual(lock.layers.map((l) => l.name), ["Correct feedback", "Incorrect feedback", "Out of tries"]);
      assert.deepEqual([content.feedback.correct, content.feedback.incorrect], [lock.layers[0]!.id, lock.layers[1]!.id]);
      const tv = triesOf(m, i + 1);
      const rules = readRules(quizOf(lock).triggers).map((x) => (x.kind === "rule" ? x.rule : null)!);
      assert.deepEqual(rules.map((x) => `${x.event}:${x.action}:${x.target === tv ? "tries" : "reveal"}`), ["activate:addToVariable:tries", "activate:showLayer:reveal"]);
      assert.equal(rules[0]!.value, 1);
      assert.equal(rules[1]!.target, lock.layers[2]!.id);
      assert.deepEqual(rules[1]!.conditions, [{ variable: tv, operator: "greaterThanOrEqual", value: tries }], "the code is shown when the last try is used");
      // The code is shown in words only, so it adds no second way on.
      assert.equal(lock.layers[2]!.objects.filter((o) => o.type === "button").length, 0);
      assert.ok(String(lock.layers[2]!.objects[0]!.content["html"]).includes(content.answers[0]!), "it says the code");
      // A right answer's way on is always open. A wrong answer's is dimmed until the tries are used.
      const right = buttonNamed(lock.layers[0]!, "Next room");
      assert.deepEqual(right.states, {});
      assert.equal(right.triggers.length, 2);
      const wrong = buttonNamed(lock.layers[1]!, "Next room");
      assert.ok(wrong.states["disabled"]);
      const [, , close, open] = wrong.triggers;
      assert.deepEqual([close!.event, close!.action, close!.value, close!.conditions], ["slideStart", "changeState", "disabled", [{ variable: tv, operator: "lessThan", value: tries }]]);
      assert.deepEqual([open!.event, open!.action, open!.value, open!.conditions], ["variableChange", "changeState", "normal", [{ variable: tv, operator: "greaterThanOrEqual", value: tries }]]);
      // The one thing always there is the way back to the room.
      assert.deepEqual(lock.baseLayer.objects.filter((o) => o.type === "button").map((o) => o.name), ["Back to the room"]);
    });
  }
});

test("reading order is right on every slide, and everything fits and does not overlap what it can appear with", () => {
  for (const rooms of [2, 5]) {
    const { made } = escapeGame({ rooms });
    for (const s of made.slides) {
      for (const layer of [s.baseLayer, ...s.layers]) {
        const tabs = layer.objects.map((o) => o.accessibility.tabOrder ?? 0).filter((n) => n >= 1).sort((x, y) => x - y);
        assert.deepEqual(tabs, tabs.map((_, i) => i + 1), `${s.name}, ${layer.name}`);
      }
      const base = s.baseLayer.objects.map((o) => ({ name: o.name, ...o.geometry }));
      for (const b of base) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= 1280 && b.y + b.height <= 720, `${s.name}: ${b.name} is on the slide`);
      for (let i = 0; i < base.length; i++) for (let j = i + 1; j < base.length; j++) assertApart(base[i]!, base[j]!, s.name);
      // A layer shows over the base layer. At a door, the code can also show over a right or wrong answer's words; the clues of a room show one at a time.
      for (const layer of s.layers) {
        const here = layer.objects.map((o) => ({ name: `${layer.name}: ${o.name}`, ...o.geometry }));
        const together = layer.name === "Out of tries" ? [] : s.layers.filter((l) => l.name === "Out of tries").flatMap((l) => l.objects.map((o) => ({ name: `${l.name}: ${o.name}`, ...o.geometry })));
        const all = [...base, ...here, ...together];
        for (const b of all) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= 1280 && b.y + b.height <= 720, `${s.name}: ${b.name} is on the slide`);
        for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assertApart(all[i]!, all[j]!, `${s.name}, ${layer.name}`);
      }
    }
  }
});

test("the game plays: search the places, open the door with the clues, go on from room to room, and out", () => {
  const g = escapeGame({ rooms: 3, tries: 3 });
  const p = startEscape(g);
  p.rt.fire(buttonNamed(g.intro, "Start the game").id, "click");
  g.rooms.forEach((room, r) => {
    assert.equal(p.rt.currentSlide!.id, room.id, `in room ${r + 1}`);
    const spots = spotsOf(room);
    // Nothing is marked yet. Searching a place opens its clue, and only that one, and marks the place.
    for (const spot of spots) assert.equal(p.looks.get(spot.id), undefined);
    spots.forEach((spot, j) => {
      p.rt.fire(spot.id, "click");
      assert.deepEqual(room.layers.filter((l) => p.rt.visibleLayers.has(l.id)).map((l) => l.id), [room.layers[j]!.id], "one clue at a time");
      assert.equal(p.rt.variables.get(variableByName(g.m, `Room ${r + 1}: place ${j + 1} searched`).id), true);
      assert.equal(p.looks.get(spot.id), "Searched");
    });
    p.rt.fire(buttonNamed(room.layers[2]!, "Close this clue").id, "click");
    assert.equal(room.layers.some((l) => p.rt.visibleLayers.has(l.id)), false, "closing a clue closes it");
    p.rt.fire(buttonNamed(room, "Go to the door").id, "click");
    const lock = g.locks[r]!;
    assert.equal(p.rt.currentSlide!.id, lock.id);
    attempt(p, lock, "right");
    assert.deepEqual(waysOn(p, lock).map((o) => o.name), ["Next room"]);
    p.rt.fire(waysOn(p, lock)[0]!.id, "click");
  });
  assert.equal(p.rt.currentSlide!.id, g.results.id);
  assert.deepEqual(p.rt.assessment(), { quizzes: 3, locked: 3, totalPoints: 300, earnedPoints: 300 });
  assert.equal(lessonStatus(evaluate(p.rt), "incomplete"), "passed");
});

test("a place that has been searched still looks searched when the room is opened again, and again after a resume, silently", () => {
  const g = escapeGame({ rooms: 2 });
  const room = g.rooms[0]!;
  const p = startEscape(g);
  p.rt.fire(buttonNamed(g.intro, "Start the game").id, "click");
  const [first, second, third] = spotsOf(room) as [OSObject, OSObject, OSObject];
  p.rt.fire(first.id, "click");
  p.rt.fire(third.id, "click");
  // Away to the door and back: a look is lost when a slide closes, and the room's own rules put it back.
  p.rt.fire(buttonNamed(room, "Go to the door").id, "click");
  p.rt.fire(buttonNamed(g.locks[0]!, "Back to the room").id, "click");
  assert.deepEqual([first, second, third].map((s) => p.looks.get(s.id)), ["Searched", undefined, "Searched"]);
  assert.equal(p.quiet.size, 0, "opening a room the ordinary way is not quiet");

  // Leave the course here, and come back.
  const later = play(g.m);
  assert.equal(later.rt.restore(decodeSuspend(encodeSuspend(p.rt.snapshot()))!), true);
  assert.equal(later.rt.currentSlide!.id, room.id);
  assert.deepEqual([first, second, third].map((s) => later.looks.get(s.id)), ["Searched", undefined, "Searched"]);
  assert.deepEqual(later.quiet, new Set([first.id, third.id]), "and nothing is said about it");
});

/** Every way a learner can use the tries at one lock: some wrong answers and then a right one, or all of them wrong. */
function triesPaths(tries: number): ("right" | "wrong")[][] {
  const out: ("right" | "wrong")[][] = [Array.from({ length: tries }, () => "wrong")];
  for (let wrong = 0; wrong < tries; wrong++) out.push([...Array.from({ length: wrong }, () => "wrong" as const), "right"]);
  return out;
}

test("a lock can always be finished, and the way on is open exactly when it has been: right on any try, or wrong on all of them", () => {
  for (const tries of [1, 2, 3]) {
    for (const path of triesPaths(tries)) {
      const g = escapeGame({ rooms: 2, tries });
      const lock = g.locks[0]!;
      const p = startEscape(g);
      p.rt.goTo(lock.id);
      const where = `${tries} tries, ${path.join(", ")}`;
      assert.deepEqual(waysOn(p, lock), [], `${where}: no way on before an answer`);
      path.forEach((how, i) => {
        attempt(p, lock, how);
        const last = i === path.length - 1;
        const finished = how === "right" || i + 1 === tries;
        assert.equal(p.rt.quiz.get(quizOf(lock).id)!.locked, finished, `${where}: the lock is finished after try ${i + 1} only if it was right or the last`);
        if (!last) assert.equal(waysOn(p, lock).length, 0, `${where}: a wrong answer with tries left does not open the way on`);
      });
      assert.equal(p.rt.quiz.get(quizOf(lock).id)!.locked, true, `${where}: finished`);
      const ways = waysOn(p, lock);
      assert.equal(ways.length, 1, `${where}: exactly one way on`);
      const reveal = p.rt.visibleLayers.has(lock.layers[2]!.id);
      assert.equal(reveal, path.length === tries, `${where}: the code is shown only when the tries are used`);
      p.rt.fire(ways[0]!.id, "click");
      assert.equal(p.rt.currentSlide!.id, g.rooms[1]!.id, `${where}: and it goes on`);
    }
  }
});

test("a wrong answer with tries left shows the way on dimmed, and the last try opens it", () => {
  const g = escapeGame({ rooms: 2, tries: 3 });
  const lock = g.locks[0]!;
  const wrongNext = buttonNamed(layerNamed(lock, "Incorrect feedback"), "Next room");
  const p = startEscape(g);
  p.rt.goTo(lock.id);
  assert.equal(p.looks.get(wrongNext.id), "disabled");
  attempt(p, lock, "wrong");
  assert.ok(p.rt.visibleLayers.has(layerNamed(lock, "Incorrect feedback").id));
  assert.equal(p.looks.get(wrongNext.id), "disabled");
  attempt(p, lock, "wrong");
  assert.equal(p.looks.get(wrongNext.id), "disabled");
  assert.ok(!p.rt.visibleLayers.has(layerNamed(lock, "Out of tries").id));
  attempt(p, lock, "wrong");
  assert.equal(p.looks.get(wrongNext.id), "normal");
  assert.ok(p.rt.visibleLayers.has(layerNamed(lock, "Out of tries").id), "the code is shown");
  assert.equal(p.rt.variables.get(triesOf(g.m, 1)), 3);
});

test("the game can be finished with every code wrong, and the LMS is told how it went", () => {
  const g = escapeGame({ rooms: 3, tries: 2 });
  const p = startEscape(g);
  p.rt.fire(buttonNamed(g.intro, "Start the game").id, "click");
  g.rooms.forEach((room, r) => {
    p.rt.fire(buttonNamed(room, "Go to the door").id, "click");
    attempt(p, g.locks[r]!, "wrong");
    assert.equal(waysOn(p, g.locks[r]!).length, 0);
    attempt(p, g.locks[r]!, "wrong");
    p.rt.fire(waysOn(p, g.locks[r]!)[0]!.id, "click");
  });
  assert.equal(p.rt.currentSlide!.id, g.results.id);
  assert.deepEqual(p.rt.assessment(), { quizzes: 3, locked: 3, totalPoints: 300, earnedPoints: 0 });
  const progress = evaluate(p.rt);
  assert.equal(progress.completed, true, "every slide seen and every lock finished, though none was solved");
  assert.equal(lessonStatus(progress, "incomplete"), "failed");
});

test("a learner who leaves a lock part way comes back with the same tries, and the way on in the same state", () => {
  const g = escapeGame({ rooms: 2, tries: 3 });
  const lock = g.locks[0]!;
  const wrongNext = buttonNamed(layerNamed(lock, "Incorrect feedback"), "Next room");
  const first = startEscape(g);
  first.rt.goTo(lock.id);
  attempt(first, lock, "wrong");

  const second = play(g.m);
  assert.equal(second.rt.restore(decodeSuspend(encodeSuspend(first.rt.snapshot()))!), true);
  assert.equal(second.rt.currentSlide!.id, lock.id);
  assert.equal(second.rt.variables.get(triesOf(g.m, 1)), 1);
  assert.equal(second.rt.quiz.get(quizOf(lock).id)!.attempts, 1);
  assert.ok(second.rt.visibleLayers.has(layerNamed(lock, "Incorrect feedback").id), "the feedback they were reading is still open");
  assert.equal(second.looks.get(wrongNext.id), "disabled", "and its way on is still dimmed, though a resume does not run the slide's start rules");
  assert.deepEqual(waysOn(second, lock), []);
  attempt(second, lock, "wrong");
  attempt(second, lock, "wrong");
  assert.equal(second.looks.get(wrongNext.id), "normal");
  assert.equal(waysOn(second, lock).length, 1);
});

test("a learner who leaves with the tries used up comes back with the code showing and the way on open", () => {
  const g = escapeGame({ rooms: 2, tries: 2 });
  const lock = g.locks[0]!;
  const first = startEscape(g);
  first.rt.goTo(lock.id);
  attempt(first, lock, "wrong");
  attempt(first, lock, "wrong");

  const second = play(g.m);
  assert.equal(second.rt.restore(decodeSuspend(encodeSuspend(first.rt.snapshot()))!), true);
  assert.ok(second.rt.visibleLayers.has(layerNamed(lock, "Out of tries").id), "the code is still showing");
  assert.equal(waysOn(second, lock).length, 1, "and the way on is open");
  second.rt.fire(waysOn(second, lock)[0]!.id, "click");
  assert.equal(second.rt.currentSlide!.id, g.rooms[1]!.id);
});

test("a learner who goes back to a lock they have not finished, and one they have, is never stuck", () => {
  const g = escapeGame({ rooms: 2, tries: 3 });
  const lock = g.locks[0]!;
  const p = startEscape(g);
  p.rt.goTo(lock.id);
  attempt(p, lock, "wrong");
  // Leave with tries left: the door is still open to try again later, and the quiz is not finished.
  p.rt.fire(buttonNamed(lock, "Back to the room").id, "click");
  assert.equal(p.rt.currentSlide!.id, g.rooms[0]!.id);
  p.rt.fire(buttonNamed(g.rooms[0]!, "Go to the door").id, "click");
  assert.equal(p.rt.quiz.get(quizOf(lock).id)!.locked, false);
  attempt(p, lock, "right");
  assert.equal(waysOn(p, lock).length, 1);
  // Finished, then back again: the lock stays finished, the player's own Back and Next are still there, and the room button still leads home.
  p.rt.fire(buttonNamed(lock, "Back to the room").id, "click");
  p.rt.fire(buttonNamed(g.rooms[0]!, "Go to the door").id, "click");
  assert.equal(p.rt.quiz.get(quizOf(lock).id)!.locked, true);
  assert.equal(p.rt.submitQuiz(quizOf(lock).id, "0000", "click")!.locked, true, "a finished lock takes no more answers");
  assert.equal(p.rt.variables.get(triesOf(g.m, 1)), 2, "and does not count them");
  p.rt.fire(buttonNamed(lock, "Back to the room").id, "click");
  assert.equal(p.rt.currentSlide!.id, g.rooms[0]!.id);
});

/** The code a learner works out from what is on the clues of a room: "the first digit is 4", "the second digit is 2", "the last two digits are 71". */
function codeFromClues(room: Slide): string {
  const said = room.layers.map((l) => String(l.objects.find((o) => o.name === "Clue")!.content["html"]).replace(/<[^>]+>/g, "")).join(" ");
  return `${/first digit is (\d)/.exec(said)![1]}${/second digit is (\d)/.exec(said)![1]}${/last two digits are (\d\d)/.exec(said)![1]}`;
}

test("the escape-room example has every place, clue and room written, and each room can be solved from its clues alone", () => {
  const { pkg } = play(exampleFiles("escape-room"));
  const [, intro, ...rest] = pkg.slides;
  rest.pop();
  const rooms = rest.filter((_, i) => i % 2 === 0);
  const locks = rest.filter((_, i) => i % 2 === 1);
  assert.equal(rooms.length, 3);
  assert.equal(intro!.name, "Escape room");
  assert.deepEqual(rooms.map((s) => s.name), ["Reception", "The meeting room", "The server cupboard"]);
  assert.deepEqual(locks.map((s) => s.name), ["Reception: the door", "The meeting room: the door", "The server cupboard: the door"]);
  const labels = rooms.flatMap((r) => spotsOf(r).map((o) => o.name));
  assert.equal(new Set(labels).size, 9, "nine different places");
  assert.ok(labels.every((l) => !["Look at the desk", "Look in the cupboard", "Look behind the picture"].includes(l)));
  rooms.forEach((room, i) => {
    const typed = codeFromClues(room);
    assert.equal(typed, doorCode(i + 1));
    assert.deepEqual((quizOf(locks[i]!).content as unknown as { answers: string[] }).answers, [typed], `room ${i + 1}: the clues spell the lock's code`);
    for (const l of room.layers) assert.ok(!/A note on the desk|A torn page in the cupboard|Scratched on the back of the picture/.test(String(l.objects.find((o) => o.name === "Clue")!.content["html"])), `${room.name} clue is written`);
    for (const spot of spotsOf(room)) assert.equal(spot.accessibility.altText, spot.content["label"], "the name starts with the words on the button");
  });
});

test("the escape-room example passes the real validator with no findings at all, and can be played from the title, solving each room from its clues alone, to a full score and a pass", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const files = exampleFiles("escape-room");
  assert.deepEqual(validate(files), []);
  const p = play(files);
  const [title, intro, ...rest] = p.pkg.slides;
  const results = rest.pop()!;
  p.rt.goTo(title!.id);
  p.rt.goTo(intro!.id);
  p.rt.fire(buttonNamed(intro!, "Start the game").id, "click");
  for (let r = 0; r < 3; r++) {
    const room = rest[r * 2]!;
    const lock = rest[r * 2 + 1]!;
    assert.equal(p.rt.currentSlide!.id, room.id);
    for (const spot of spotsOf(room)) p.rt.fire(spot.id, "click");
    p.rt.fire(buttonNamed(room, "Go to the door").id, "click");
    assert.equal(p.rt.submitQuiz(quizOf(lock).id, codeFromClues(room), "click")!.correct, true);
    const ways = waysOn(p, lock);
    assert.equal(ways.length, 1);
    p.rt.fire(ways[0]!.id, "click");
  }
  assert.equal(p.rt.currentSlide!.id, results.id);
  assert.deepEqual(p.rt.assessment(), { quizzes: 3, locked: 3, totalPoints: 300, earnedPoints: 300 });
  assert.equal(lessonStatus(evaluate(p.rt), "incomplete"), "passed");
});

test("a project with an escape room passes the real validator with no findings at all, for each number of tries and on every built-in theme", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  for (const [rooms, tries] of [[MIN_ROOMS, MIN_TRIES], [3, 3], [MAX_ROOMS, 2]] as [number, number][]) assert.deepEqual(validate(escapeGame({ rooms, tries }).m), [], `${rooms} rooms, ${tries} tries`);
  // The note cards and the places paint their own fills, so their words are judged against those on each theme.
  const files = escapeGame().m.allFiles();
  const themesDir = path.join(repo, "themes");
  for (const name of readdirSync(themesDir).filter((n) => n.endsWith(".theme.json"))) {
    const swapped = files.map((f) => (f.path === "theme.json" ? { ...f, text: readFileSync(path.join(themesDir, name), "utf-8") } : f));
    assert.deepEqual(validate(swapped), [], name);
  }
});

// ---- the running score

test("every game shows the points earned so far where the learner is playing, as a value the player fills in, and its alt text says [score]", () => {
  const shows = (s: Slide): OSObject[] => objectsOf(s).filter((o) => o.type === "text" && referencesIn(String(o.content["html"])).length > 0);
  const m = fresh();
  const boardGame = m.addGameSet("quiz-board", { categories: 2, values: 2 })!;
  const ladder = m.addGameSet("prize-ladder", { questions: 5 })!;
  const room = m.addGameSet("escape-room", { rooms: 2, tries: 2 })!;
  // The board shows it in its corner; each question says it beside the points; the results box has the score already.
  assert.equal(shows(boardGame.slides[0]!).length, 1);
  assert.deepEqual(boardGame.slides.slice(1, -1).map((s) => shows(s).length), [1, 1, 1, 1]);
  assert.equal(shows(boardGame.slides.at(-1)!).length, 0);
  // The ladder: the line at the top of every question; the opening slide has no score yet.
  assert.equal(shows(ladder.slides[0]!).length, 0);
  assert.deepEqual(ladder.slides.slice(1, -1).map((s) => shows(s).length), [1, 1, 1, 1, 1]);
  // The escape room: every room, and every lock.
  assert.deepEqual(room.slides.slice(1, -1).map((s) => shows(s).length), [1, 1, 1, 1]);
  for (const slide of [...boardGame.slides, ...ladder.slides, ...room.slides]) {
    for (const o of shows(slide)) {
      assert.deepEqual(referencesIn(String(o.content["html"])), ["$score"], `${slide.name}: ${o.name}`);
      assert.match(o.accessibility.altText, /\[score\]/, `${slide.name}: ${o.name}`);
      assert.doesNotMatch(o.accessibility.altText, /\{\{/);
    }
  }
});

test("the score a game shows is the quiz points the course already counts: answering a tile right adds its points, a wrong one adds nothing", () => {
  const { m, board: b, questions, categories, rows, tile } = board({ categories: 2, values: 2 });
  assert.equal(categories * rows, 4);
  const p = play(m);
  const shown = () => valueFor("$score", { variables: m.variables, valueOf: (id) => p.rt.variables.get(id), totals: () => totalsFromResults(courseResults(p.rt)) });
  const percent = () => valueFor("$percent", { variables: m.variables, valueOf: (id) => p.rt.variables.get(id), totals: () => totalsFromResults(courseResults(p.rt)) });
  p.rt.goTo(b.id);
  assert.equal(shown(), "0");
  answer(p, tile(0, 0), questions[0]!, "right");
  assert.equal(shown(), "100");
  answer(p, tile(0, 1), questions[1]!, "wrong");
  assert.equal(shown(), "100", "a wrong answer adds nothing");
  answer(p, tile(1, 0), questions[2]!, "right");
  answer(p, tile(1, 1), questions[3]!, "right");
  assert.equal(shown(), "400");
  assert.equal(percent(), "67", "400 of the 600 points there were");
});

test("the prize ladder and the escape room leave out Back and Next on every slide but the score, and every one of those slides has a way out of its own", () => {
  for (const game of [ladderGame(), escapeGame()]) {
    const slides = game.made.slides;
    assert.ok(slides.slice(0, -1).every((s) => s.hideNavigation === true), "all but the last leave them out");
    assert.equal(slides[slides.length - 1]!.hideNavigation, undefined, "the score keeps them");
    for (const slide of slides.slice(0, -1)) {
      const ways = [slide.baseLayer, ...slide.layers].flatMap((l) => l.objects).flatMap((o) => o.triggers).filter((t) => t.action === "jumpToSlide");
      assert.ok(ways.length > 0, `${slide.name} has a button that goes somewhere`);
    }
  }
});
