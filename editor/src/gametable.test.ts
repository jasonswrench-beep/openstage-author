// Games filled from a spreadsheet: reading a table for a quiz board and for a prize ladder (every mistake named, a table that cannot make the game saying why), the sample
// tables that come with the program, and the games made from them, which pass the real validator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { OSObject, Slide } from "../../player/src/types.ts";
import { BOARD_TEMPLATE_CSV, LADDER_TEMPLATE_CSV, readBoardTable, readLadderTable, type BoardContent } from "./gameimport.ts";
import { gameById } from "./gamesets.ts";
import { Model } from "./model.ts";
import { readQuestions } from "./questionimport.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HEAD = "Category,Value,Type,Question,A,B,C,D,E,Correct,Feedback if right,Feedback if wrong";
const row = (category: string, value: string, question: string, correct = "A", answers = "Yes,No,Maybe") => `${category},${value},MC,${question},${answers.split(",").concat(["", "", "", "", ""]).slice(0, 5).join(",")},${correct},,`;
const table = (...lines: string[]) => [HEAD, ...lines].join("\n");
const board = (text: string) => readBoardTable(text, "My board");
const errors = (r: { problems: { severity: string }[] }) => r.problems.filter((p) => p.severity === "error").length;

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-22" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}
const objectsOf = (s: Slide): OSObject[] => [s.baseLayer, ...s.layers].flatMap((l) => l.objects);

// ---- the quiz board table

test("the sample table for a quiz board is a whole small board with nothing wrong in it", () => {
  const r = board(BOARD_TEMPLATE_CSV);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.notes, []);
  assert.deepEqual(r.unusedColumns, []);
  assert.deepEqual(r.options, { categories: 3, values: 3 });
  const content = r.content as BoardContent;
  assert.deepEqual(content.categories.map((c) => c.name), ["Colour", "Keyboard", "Words"]);
  assert.deepEqual(content.categories.map((c) => c.tiles.map((t) => t.value)), [[100, 200, 300], [100, 200, 300], [100, 200, 300]]);
  assert.deepEqual(content.categories[0]!.tiles.map((t) => t.question.type), ["mc", "mc", "tf"]);
  assert.deepEqual(content.categories[2]!.tiles[2]!.question.type, "mr");
  assert.equal(content.title, "My board");
  assert.match(r.summary, /^3 categories with 3 questions each, so 9 tiles: Colour, Keyboard and Words\.$/);
});

test("the columns of the board are the categories in the order they first appear, and the tiles of each go from the smallest value down whatever the order of the rows", () => {
  const r = board(table(row("B", "300", "b3"), row("A", "200", "a2"), row("B", "100", "b1"), row("A", "100", "a1"), row("B", "200", "b2"), row("A", "300", "a3")));
  const content = r.content as BoardContent;
  assert.deepEqual(content.categories.map((c) => c.name), ["B", "A"]);
  assert.deepEqual(content.categories[0]!.tiles.map((t) => [t.value, t.question.question]), [[100, "b1"], [200, "b2"], [300, "b3"]]);
  assert.deepEqual(content.categories[1]!.tiles.map((t) => t.question.question), ["a1", "a2", "a3"]);
});

test("a category's name is the same whatever its capitals, and spaces round it do not count", () => {
  const r = board(table(row("Colour", "100", "q1"), row("colour ", "200", "q2"), row("Words", "100", "q3"), row("WORDS", "200", "q4")));
  assert.deepEqual((r.content as BoardContent).categories.map((c) => c.name), ["Colour", "Words"]);
});

test("with no Value column, Points is what a tile is worth; with neither, the tiles are worth 100, 200 and so on, and each says so", () => {
  const points = readBoardTable(["Category,Points,Type,Question,A,B,Correct", "X,50,MC,q1,a,b,A", "X,75,MC,q2,a,b,A", "Y,50,MC,q3,a,b,A", "Y,75,MC,q4,a,b,A"].join("\n"), "t");
  assert.deepEqual((points.content as BoardContent).categories.map((c) => c.tiles.map((t) => t.value)), [[50, 75], [50, 75]]);
  assert.deepEqual(points.problems, []);
  const none = readBoardTable(["Category,Type,Question,A,B,Correct", "X,MC,q1,a,b,A", "X,MC,q2,a,b,A", "Y,MC,q3,a,b,A", "Y,MC,q4,a,b,A"].join("\n"), "t");
  assert.deepEqual((none.content as BoardContent).categories.map((c) => c.tiles.map((t) => t.value)), [[100, 200], [100, 200]]);
  assert.equal(none.problems.length, 4);
  assert.match(none.problems[0]!.message, /There is no Value, so this tile is worth 100/);
});

test("two tiles of a category worth the same are noticed, and the tile worth its own value is not made to change", () => {
  const r = board(table(row("A", "100", "a1"), row("A", "100", "a2"), row("B", "100", "b1"), row("B", "200", "b2")));
  assert.equal(errors(r), 0);
  assert.ok(r.problems.some((p) => /also worth 100/.test(p.message)));
});

test("a row with no category is left out and says why; a table with no category at all cannot make a board", () => {
  const r = board(table(row("A", "100", "a1"), row("A", "200", "a2"), row("B", "100", "b1"), row("B", "200", "b2"), row("", "300", "lonely")));
  assert.equal(errors(r), 1);
  assert.match(r.problems.find((p) => p.row === 6)!.message, /There is no Category/);
  assert.equal((r.content as BoardContent).categories.length, 2);
  const none = board(table(row("", "100", "q")));
  assert.equal(none.content, null);
  assert.match(none.summary, /no question in this table has a Category/);
});

test("a board needs at least 2 categories of at least 2 questions, and says which category is short", () => {
  const one = board(table(row("A", "100", "a1"), row("A", "200", "a2")));
  assert.equal(one.content, null);
  assert.equal(one.options, null);
  assert.match(one.summary, /needs at least 2 categories, and this table has 1/);
  const thin = board(table(row("A", "100", "a1"), row("A", "200", "a2"), row("B", "100", "b1"), row("C", "100", "c1")));
  assert.equal(thin.content, null);
  assert.match(thin.summary, /at least 2 questions in every category, and B and C have 1/);
});

test("a category with more questions than the smallest has the extra rows left out, so every column has the same number of tiles", () => {
  const r = board(table(row("A", "100", "a1"), row("A", "200", "a2"), row("A", "300", "a3"), row("B", "100", "b1"), row("B", "200", "b2")));
  assert.deepEqual(r.options, { categories: 2, values: 2 });
  assert.equal(errors(r), 1);
  assert.equal(r.problems.find((p) => p.severity === "error")!.row, 4, "the highest tile of A");
  assert.match(r.problems.find((p) => p.severity === "error")!.message, /A has more questions than the category with the fewest \(2\)/);
  assert.match(r.summary, /1 row was left out/);
});

test("more than 6 categories or 5 questions in a column are cut to what a board holds, and the rows cut are named", () => {
  const wide = board(table(...["A", "B", "C", "D", "E", "F", "G"].flatMap((c) => [row(c, "100", `${c}1`), row(c, "200", `${c}2`)])));
  assert.deepEqual(wide.options, { categories: 6, values: 2 });
  assert.equal(errors(wide), 2);
  assert.match(wide.problems.find((p) => p.severity === "error")!.message, /at most 6 categories, so G was left out/);
  const tall = board(table(...["A", "B"].flatMap((c) => [1, 2, 3, 4, 5, 6].map((n) => row(c, String(n * 100), `${c}${n}`)))));
  assert.deepEqual(tall.options, { categories: 2, values: 5 });
  assert.equal(errors(tall), 2);
  assert.match(tall.problems.find((p) => p.severity === "error")!.message, /holds 5 questions in a column/);
});

test("a question with more answers than a game has room for is left out and says so", () => {
  const r = board(["Category,Value,Type,Question,A,B,C,D,E,F,Correct", "A,100,MC,a1,x,y,,,,,A", "A,200,MC,a2,x,y,,,,,A", "B,100,MC,b1,x,y,,,,,A", "B,200,MC,b2,x,y,,,,,A", "B,300,MC,crowded,1,2,3,4,5,6,A"].join("\n"));
  assert.equal(errors(r), 1);
  assert.match(r.problems.find((p) => p.severity === "error")!.message, /room for 5 answers and this has 6/);
});

test("a board's table does not use Attempts, and says Points is not used when Value is there", () => {
  const r = readBoardTable(["Category,Value,Points,Attempts,Type,Question,A,B,Correct", "A,100,5,3,MC,a1,x,y,A", "A,200,5,3,MC,a2,x,y,A", "B,100,5,3,MC,b1,x,y,A", "B,200,5,3,MC,b2,x,y,A"].join("\n"), "t");
  assert.deepEqual(r.notes, ["A tile's question has one try, so the Attempts column is not used.", "A tile is worth its Value, so the Points column is not used."]);
});

test("the ordinary question table does not take a Category or a Value column, and says they were not used", () => {
  const r = readQuestions(`${HEAD}\nA,100,MC,q1,a,b,,,,A,,`);
  assert.deepEqual(r.unusedColumns, ["Category", "Value"]);
  assert.equal(r.questions[0]!.category, "");
});

// ---- the prize ladder table

test("the sample table for a prize ladder is a whole small ladder of eight questions, one of each of three kinds", () => {
  const r = readLadderTable(LADDER_TEMPLATE_CSV, "My ladder");
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.options, { questions: 8 });
  assert.deepEqual((r.content as { questions: { type: string }[] }).questions.map((q) => q.type), ["mc", "mc", "tf", "mc", "mc", "short", "mc", "mc"]);
  assert.match(r.summary, /^8 questions, one for each rung, the first row on the lowest\.$/);
});

test("a ladder needs 5 to 15 questions, and a longer table has its last rows left out and named", () => {
  const some = (n: number) => ["Type,Question,A,B,Correct", ...Array.from({ length: n }, (_, i) => `MC,q${i + 1},a,b,A`)].join("\n");
  const few = readLadderTable(some(4), "t");
  assert.equal(few.content, null);
  assert.match(few.summary, /needs 5 to 15 questions, and this table has 4 that can be used\. Add 1 more\./);
  const many = readLadderTable(some(17), "t");
  assert.deepEqual(many.options, { questions: 15 });
  assert.deepEqual(many.problems.map((p) => p.row), [17, 18]);
  assert.match(many.problems[0]!.message, /at most 15 rungs/);
});

test("a ladder's table does not use Points or Attempts, and a Category column is not a column it knows", () => {
  const r = readLadderTable(["Category,Type,Question,A,B,Correct,Points,Attempts", ...Array.from({ length: 5 }, (_, i) => `X,MC,q${i},a,b,A,20,3`)].join("\n"), "t");
  assert.equal(r.notes.length, 2);
  assert.deepEqual(r.unusedColumns, ["Category"]);
});

// ---- the sample files that come with the program

test("the sample tables in the examples folder are the ones the editor writes", () => {
  for (const [name, text] of [["quiz-board-questions.csv", BOARD_TEMPLATE_CSV], ["prize-ladder-questions.csv", LADDER_TEMPLATE_CSV]] as const) {
    const file = readFileSync(path.join(repo, "examples", name));
    assert.deepEqual([...file.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${name} has the mark Excel looks for`);
    assert.equal(file.subarray(3).toString("utf8"), text, name);
  }
});

test("each game that can be filled from a table says which, and names a file for the sample", () => {
  assert.deepEqual(["quiz-board", "prize-ladder", "escape-room"].map((id) => gameById(id)!.table?.templateName ?? null), ["OpenStage quiz board questions.csv", "OpenStage prize ladder questions.csv", null]);
});

// ---- the games made from a table

test("a quiz board made from a table has its category names, tile values and questions in it, one try each, worth the tile's value", () => {
  const m = fresh();
  const read = readBoardTable(BOARD_TEMPLATE_CSV, "Accessibility basics");
  const made = m.addGameSet("quiz-board", read.options!, read.content!)!;
  const [boardSlide, ...rest] = made.slides;
  assert.equal(made.slides.length, 11);
  assert.equal(boardSlide!.name, "Accessibility basics");
  const names = boardSlide!.baseLayer.objects.map((o) => o.name);
  assert.ok(names.includes("100, Colour") && names.includes("300, Words"), names.join(" | "));
  const heading = (o: OSObject) => String(o.content["html"] ?? "");
  assert.equal(heading(boardSlide!.baseLayer.objects.find((o) => o.name === "Title")!), "<h1>Accessibility basics</h1>");
  assert.deepEqual(boardSlide!.baseLayer.objects.filter((o) => /^Category \d/.test(o.name)).map(heading), ["<h2>Colour</h2>", "<h2>Keyboard</h2>", "<h2>Words</h2>"]);
  const q = rest[0]!;
  assert.equal(q.name, "Colour: 100");
  const quiz = q.baseLayer.objects.find((o) => o.type === "quizQuestion")!;
  const c = quiz.content as { choices: { label: string; correct: boolean }[]; scoring: { points: number; attemptsAllowed: number } };
  assert.deepEqual(c.choices.map((x) => [x.label, x.correct]), [["3 to 1", false], ["4.5 to 1", true], ["7 to 1", false]]);
  assert.deepEqual(c.scoring, { points: 100, attemptsAllowed: 1 });
  assert.match(heading(q.baseLayer.objects.find((o) => o.name === "Question")!), /smallest contrast ratio/);
  assert.equal(q.baseLayer.objects.find((o) => o.name === "Question")!.style["autoFit"], "shrink", "a long question shrinks to fit its box");
  // the table's own feedback, and in its absence the right answer in words
  const words = (layer: number) => String(q.layers[layer]!.objects.find((o) => o.type === "text")!.content["html"]);
  assert.equal(words(0), "<p>Right: 4.5 to 1.</p>");
  assert.equal(words(1), "<p>Not quite. The smallest for normal-size text is 4.5 to 1.</p>");
  const plain = rest[1]!;
  assert.match(String(plain.layers[1]!.objects.find((o) => o.type === "text")!.content["html"]), /^<p>Not quite\. The right answer is A red border\.<\/p>$/);
  assert.ok(made.notes.join(" ").includes("filled from your table"));
  assert.ok(m.variables.some((v) => v.name === "Used: Colour, 100"));
});

test("a quiz board's true or false, several-right and short-answer questions are the kinds they say", () => {
  const m = fresh();
  const read = readBoardTable(BOARD_TEMPLATE_CSV, "t");
  const made = m.addGameSet("quiz-board", read.options!, read.content!)!;
  const kinds = made.slides.slice(1, -1).map((s) => (s.baseLayer.objects.find((o) => o.type === "quizQuestion")!.content as { questionType: string }).questionType);
  assert.deepEqual(kinds, ["multipleChoice", "multipleChoice", "multipleChoice", "multipleChoice", "multipleChoice", "multipleChoice", "multipleChoice", "multipleChoice", "multipleResponse"]);
  const tf = made.slides[3]!.baseLayer.objects.find((o) => o.type === "quizQuestion")!.content as { choices: { label: string; correct: boolean }[] };
  assert.deepEqual(tf.choices.map((x) => [x.label, x.correct]), [["True", true], ["False", false]]);
});

test("words from a table go into the slides as words: nothing in them is read as markup", () => {
  const m = fresh();
  const read = readBoardTable(table(row("Q&A <b>", "100", "Is 1 < 2 & 3 > 2?"), row("Q&A <b>", "200", "second"), row("Tom & Jerry", "100", "third"), row("Tom & Jerry", "200", "fourth")), "A & B");
  const made = m.addGameSet("quiz-board", read.options!, read.content!)!;
  const b = made.slides[0]!;
  assert.equal(String(b.baseLayer.objects.find((o) => o.name === "Title")!.content["html"]), "<h1>A &amp; B</h1>");
  assert.ok(b.baseLayer.objects.some((o) => String(o.content["html"] ?? "") === "<h2>Q&amp;A &lt;b&gt;</h2>"));
  assert.equal(String(made.slides[1]!.baseLayer.objects.find((o) => o.name === "Question")!.content["html"]), "<h2>Is 1 &lt; 2 &amp; 3 &gt; 2?</h2>");
});

test("a prize ladder made from a table has its questions on the rungs in order, with the title, the sizes from the table, and a way on that clears every answer", () => {
  const m = fresh();
  const read = readLadderTable(LADDER_TEMPLATE_CSV, "Space quiz");
  const made = m.addGameSet("prize-ladder", read.options!, read.content!)!;
  assert.equal(made.slides.length, 10);
  assert.equal(made.slides[0]!.name, "Space quiz");
  assert.equal(String(made.slides[0]!.baseLayer.objects.find((o) => o.name === "Title")!.content["html"]), "<h1>Space quiz</h1>");
  const first = made.slides[1]!;
  assert.equal(first.name, "Question 1: 100");
  assert.match(String(first.baseLayer.objects.find((o) => o.name === "Question")!.content["html"]), /closest to the Sun/);
  const scoring = (s: Slide) => (s.baseLayer.objects.find((o) => o.type === "quizQuestion")!.content as { scoring: unknown }).scoring;
  assert.deepEqual(scoring(first), { points: 100, attemptsAllowed: 1 });
  assert.deepEqual(scoring(made.slides[8]!), { points: 800, attemptsAllowed: 1 });
  const kinds = made.slides.slice(1, 9).map((s) => (s.baseLayer.objects.find((o) => o.type === "quizQuestion")!.content as { questionType: string }).questionType);
  assert.deepEqual(kinds, ["multipleChoice", "multipleChoice", "multipleChoice", "multipleChoice", "multipleChoice", "shortAnswer", "multipleChoice", "multipleChoice"]);
});

test("the feedback and the Next question button of a ladder question sit below however many answers it has", () => {
  const m = fresh();
  const five = ["Type,Question,A,B,C,D,E,Correct", ...Array.from({ length: 5 }, (_, i) => `MC,Five answers ${i},a,b,c,d,e,C`)].join("\n");
  const read = readLadderTable(five, "t");
  const made = m.addGameSet("prize-ladder", read.options!, read.content!)!;
  const slide = made.slides[1]!;
  const quiz = slide.baseLayer.objects.find((o) => o.type === "quizQuestion")!;
  const bottom = quiz.geometry.y + quiz.geometry.height;
  for (const layer of slide.layers) {
    for (const o of layer.objects) assert.ok(o.geometry.y >= bottom, `${o.name} at ${o.geometry.y} is below the answers, which end at ${bottom}`);
  }
  assert.ok(objectsOf(slide).every((o) => o.geometry.y + o.geometry.height <= 720), "and everything is on the slide");
});

test("a table for another game is ignored, and a game made without one is as it always was", () => {
  const m = fresh();
  const wrong = readLadderTable(LADDER_TEMPLATE_CSV, "t").content!;
  const made = m.addGameSet("quiz-board", { categories: 2, values: 2 }, wrong)!;
  assert.equal(made.slides.length, 6, "the sizes asked for, with the usual placeholders");
  assert.equal(String(made.slides[0]!.baseLayer.objects.find((o) => o.name === "Title")!.content["html"]), "<h1>Quiz board</h1>");
});

test("a game filled from a table passes the real validator, and a second one added to the same project does not clash with the first", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  const board = readBoardTable(BOARD_TEMPLATE_CSV, "Board one");
  const ladder = readLadderTable(LADDER_TEMPLATE_CSV, "Ladder one");
  m.addGameSet("quiz-board", board.options!, board.content!);
  m.addGameSet("quiz-board", board.options!, board.content!);
  m.addGameSet("prize-ladder", ladder.options!, ladder.content!);
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-gametable-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    const findings = JSON.parse(r.stdout) as { severity: string; rule: string; message: string }[];
    assert.deepEqual(findings.filter((f) => f.severity === "error"), []);
    assert.deepEqual(findings.filter((f) => /^(trigger|condition|tab-order|completion|state-|slide-|variable)/.test(f.rule)), [], JSON.stringify(findings).slice(0, 600));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
