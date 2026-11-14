// Questions from a spreadsheet. An author keeps their questions in a table (Excel, Google Sheets, a text file) and saves it as a CSV file; this reads
// that file into questions the editor can make slides from. Nothing here touches the project: it reads text and says what it found, row by row, in
// words, so a table with a few mistakes still gives the questions that are good and says exactly what is wrong with the others.
//
// The columns, in the order the template has them (the first row names them, so they may be in any order, and some may be left out):
//   Type        MC multiple choice, MR multiple response (several right), TF true or false, SA short answer. Left empty it is MC.
//   Question    The words of the question.
//   A to H      The answers to choose from. For SA, the answers that are accepted.
//   Correct     MC and MR: the letters of the right answers (B, or A and C). TF: True or False. SA: not needed.
//   Points, Attempts, Feedback if right, Feedback if wrong     Optional.

export type ImportedType = "mc" | "mr" | "tf" | "short";

/** The other kinds of question a table cannot hold, which only a tool that builds questions directly (the MCP server) makes. */
export type DirectType = "essay" | "whichword" | "shortcut";

export interface ImportedQuestion {
  /** The row of the table it came from, counting the header as row 1, so the author can find it. */
  row: number;
  type: ImportedType | DirectType;
  /** Only for essay: the fewest words that count as an answer. */
  minWords?: number;
  /** Only for whichword: the passage, with each right word in [square brackets]. */
  passage?: string;
  /** Only for shortcut: every shortcut that is right. */
  keys?: string[];
  question: string;
  /** The answers to show, in order. A true or false question has True and False. A short answer has the answers that are accepted. */
  answers: string[];
  /** The positions in `answers` that are right (one for MC, one or more for MR, True or False for TF). Empty for SA. */
  correct: number[];
  /** Null when the table did not say, so the editor's own starting value is used. */
  points: number | null;
  attempts: number | null;
  /** For a game filled from a table: the category a quiz board puts the question in, or "". Read only when the caller asks for it (see `readQuestions`). */
  category: string;
  /** For a quiz board: what the question's tile is worth, or null. Read only when the caller asks for it. */
  value: number | null;
  rightFeedback: string;
  wrongFeedback: string;
}

export interface ImportProblem {
  row: number;
  /** An error means the row was left out. A warning means it was used, with something the author may want to look at. */
  severity: "error" | "warning";
  message: string;
}

export interface QuestionRead {
  questions: ImportedQuestion[];
  problems: ImportProblem[];
  /** Columns whose names were not understood, so were not used. */
  unusedColumns: string[];
  /** How many rows of questions the file held, with or without problems. */
  rows: number;
}

export const MAX_QUESTIONS = 200;
export const MAX_ANSWERS = 8;
const LETTERS = "ABCDEFGH";

// ---- the table itself

/** Which character separates the cells: the one used most in the first line outside quotes. A table saved by Excel in some countries uses semicolons, and one saved as Unicode text uses tabs. */
export function delimiterOf(text: string): "," | ";" | "\t" {
  const count = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch in count) count[ch as keyof typeof count]++;
  }
  if (count["\t"] > count[","] && count["\t"] >= count[";"]) return "\t";
  return count[";"] > count[","] ? ";" : ",";
}

/**
 * A cell as it was before the program that wrote the file put an apostrophe in front of it so that a spreadsheet program would not
 * read it as a formula: OpenAssess does this to a cell of the OpenStage question spreadsheet that begins with =, +, -, @, a tab or a
 * carriage return, and to one that begins with apostrophes and then one of those, so that the two are exact inverses. One apostrophe
 * is taken off a run of them at the start, and only when the run is in front of one of those characters; any other apostrophe is
 * the author's. So a question such as "-3 + 4 = ?" comes in as it was written.
 */
export function unguardFormula(cell: string): string {
  return /^'+[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell;
}

/** Split CSV text into rows of cells. Quotes hold a comma or a new line inside a cell, and two quotes in a row mean one. Rows with nothing in them are left out. */
export function parseCsv(raw: string): string[][] {
  const text = raw.replace(/^﻿/, "");
  const sep = delimiterOf(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endCell = () => { row.push(cell.trim()); cell = ""; };
  const endRow = () => { endCell(); if (row.some((c) => c !== "")) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell.trim() === "") quoted = true;
    else if (ch === sep) endCell();
    else if (ch === "\n") endRow();
    else if (ch === "\r") { if (text[i + 1] === "\n") i++; endRow(); }
    else cell += ch;
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

// ---- the columns

type Column = "type" | "question" | "correct" | "points" | "attempts" | "right" | "wrong" | "category" | "value" | `a${number}`;

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const NAMES: Record<string, Column> = {
  type: "type", questiontype: "type", kind: "type",
  question: "question", questiontext: "question", text: "question", prompt: "question", stem: "question",
  correct: "correct", correctanswer: "correct", correctanswers: "correct", answer: "correct", key: "correct", rightanswer: "correct",
  points: "points", score: "points", weight: "points",
  category: "category", categoryname: "category", categorytitle: "category", topic: "category", columnname: "category",
  value: "value", tilevalue: "value", tilepoints: "value", rowvalue: "value", amount: "value", dollars: "value",
  attempts: "attempts", tries: "attempts", attemptsallowed: "attempts",
  feedbackifright: "right", rightfeedback: "right", correctfeedback: "right", feedbackcorrect: "right", feedbackright: "right", ifright: "right", ifcorrect: "right", feedbackifcorrect: "right",
  feedbackifwrong: "wrong", wrongfeedback: "wrong", incorrectfeedback: "wrong", feedbackincorrect: "wrong", feedbackwrong: "wrong", ifwrong: "wrong", ifincorrect: "wrong", feedbackifincorrect: "wrong",
};
for (let i = 0; i < MAX_ANSWERS; i++) {
  const l = LETTERS[i]!.toLowerCase();
  for (const name of [l, `answer${l}`, `choice${l}`, `answerchoice${l}`, `option${l}`, `response${l}`]) NAMES[name] = `a${i}`;
}

/** The order of the columns when the first row is not a row of names: the template's, with room for five answers. */
const DEFAULT_ORDER: Column[] = ["type", "question", "a0", "a1", "a2", "a3", "a4", "correct", "points", "right", "wrong"];

const TYPE_CODES: Record<string, ImportedType> = {
  mc: "mc", mcq: "mc", multiplechoice: "mc", choice: "mc", single: "mc",
  mr: "mr", ma: "mr", ms: "mr", mrq: "mr", multipleresponse: "mr", multipleanswer: "mr", multipleselect: "mr", selectall: "mr", checkbox: "mr",
  tf: "tf", truefalse: "tf", trueorfalse: "tf", tof: "tf",
  sa: "short", shortanswer: "short", fillin: "short", fib: "short", text: "short", typed: "short",
};

/** Does this first row name the columns (it names the question column), or is it already a question? */
function isHeader(cells: string[]): boolean {
  return cells.some((c) => NAMES[squash(c)] === "question");
}

// ---- reading the questions

const TRUE_WORDS = new Set(["true", "t", "yes", "y", "1"]);
const FALSE_WORDS = new Set(["false", "f", "no", "n", "0"]);

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * Read a table of questions. Every row is checked; a row with a mistake is left out and says what the mistake is. A table for a game may also have a
 * Category and a Value column; they are read only when `columns` asks for them, and are otherwise reported as columns that were not used.
 */
export function readQuestions(text: string, opts: { columns?: ("category" | "value")[] } = {}): QuestionRead {
  const table = parseCsv(text);
  const problems: ImportProblem[] = [];
  const questions: ImportedQuestion[] = [];
  if (table.length === 0) return { questions, problems: [{ row: 1, severity: "error", message: "The file is empty." }], unusedColumns: [], rows: 0 };

  const header = isHeader(table[0]!);
  const wanted = new Set<string>(opts.columns ?? []);
  const columnOf = (c: string): Column | null => {
    const col = NAMES[squash(c)];
    if (!col) return null;
    return (col === "category" || col === "value") && !wanted.has(col) ? null : col;
  };
  const order: (Column | null)[] = header ? table[0]!.map(columnOf) : DEFAULT_ORDER;
  const unusedColumns = header ? table[0]!.filter((c, i) => c !== "" && order[i] === null) : [];
  const at = (cells: string[], col: Column): string => {
    const i = order.indexOf(col);
    return i === -1 ? "" : unguardFormula(cells[i] ?? "");
  };
  const first = header ? 1 : 0;
  const body = table.slice(first);
  if (body.length === 0) return { questions, problems: [{ row: 1, severity: "error", message: "The file has column names but no questions under them." }], unusedColumns, rows: 0 };
  if (header && order.indexOf("question") === -1) return { questions, problems: [{ row: 1, severity: "error", message: "No column is called Question." }], unusedColumns, rows: body.length };

  const seen = new Map<string, number>();
  body.forEach((cells, k) => {
    const row = k + 1 + first;
    const err = (message: string) => problems.push({ row, severity: "error", message });
    const warn = (message: string) => problems.push({ row, severity: "warning", message });
    const question = at(cells, "question").replace(/\s+/g, " ").trim();
    if (question === "") return err("There is no question, so this row was left out.");

    // The type
    const code = squash(at(cells, "type"));
    const answerCells = Array.from({ length: MAX_ANSWERS }, (_, i) => at(cells, `a${i}` as Column).trim());
    const correctCell = at(cells, "correct").trim();
    let type: ImportedType;
    if (code === "") {
      const filled = answerCells.filter((a) => a !== "").length;
      type = filled < 2 && (TRUE_WORDS.has(correctCell.toLowerCase()) || FALSE_WORDS.has(correctCell.toLowerCase())) ? "tf" : "mc";
    } else if (TYPE_CODES[code]) type = TYPE_CODES[code]!;
    else return err(`The type "${at(cells, "type")}" is not one I know. Use MC (multiple choice), MR (several right), TF (true or false) or SA (short answer).`);

    // The answers, keeping each one's letter so "Correct" can name it
    const letterOf: number[] = [];
    const answers: string[] = [];
    answerCells.forEach((a, i) => {
      if (a === "") return;
      letterOf.push(i);
      answers.push(a);
    });
    const skipped = answerCells.slice(0, Math.max(0, (letterOf[letterOf.length - 1] ?? -1) + 1)).filter((a) => a === "").length;
    if (type !== "tf" && skipped > 0) warn(`${plural(skipped, "answer is", "answers are")} empty, so ${skipped === 1 ? "it was" : "they were"} left out.`);

    let correct: number[] = [];
    let shown = answers;
    if (type === "tf") {
      const word = correctCell.toLowerCase();
      if (TRUE_WORDS.has(word)) correct = [0];
      else if (FALSE_WORDS.has(word)) correct = [1];
      else return err(`A true or false question needs True or False in the Correct column${correctCell === "" ? "" : `, not "${correctCell}"`}.`);
      shown = ["True", "False"];
      if (answers.length > 0) warn("A true or false question has no answers of its own, so the answer columns were not used.");
    } else if (type === "short") {
      shown = answers.length > 0 ? answers : correctCell.split("|").map((s) => s.trim()).filter((s) => s !== "");
      if (shown.length === 0) return err("A short answer needs at least one answer that is accepted, in column A (or in Correct).");
      if (shown.length > 10) return err("A short answer can have up to 10 accepted answers.");
    } else {
      if (answers.length < 2) return err(`A ${type === "mr" ? "multiple response" : "multiple choice"} question needs at least two answers.`);
      if (correctCell === "") return err("The Correct column says which answer is right, and it is empty.");
      const tokens = correctCell.split(/[,;|/]|\s+and\s+|\s+/i).map((t) => t.trim()).filter((t) => t !== "");
      const wanted: number[] = [];
      for (const token of tokens) {
        let position = -1;
        if (/^[A-Ha-h]$/.test(token)) position = letterOf.indexOf(token.toUpperCase().charCodeAt(0) - 65);
        if (position === -1) position = answers.findIndex((a) => a.toLowerCase() === token.toLowerCase());
        if (position === -1) {
          // The whole cell may be the text of one answer, which has spaces in it.
          const whole = answers.findIndex((a) => a.toLowerCase() === correctCell.toLowerCase());
          if (whole !== -1 && tokens.length > 1) { wanted.length = 0; wanted.push(whole); break; }
          return err(`"${token}" in the Correct column is not one of the answers. Use the letter of an answer that is filled in, such as ${LETTERS[letterOf[0] ?? 0]}.`);
        }
        if (!wanted.includes(position)) wanted.push(position);
      }
      correct = wanted.sort((x, y) => x - y);
      if (type === "mc" && correct.length > 1) return err("A multiple choice question has one right answer, and the Correct column names more than one. Use MR for several right answers.");
      if (type === "mr" && correct.length === answers.length) return err("Every answer is marked right, so there is nothing to choose.");
      if (new Set(answers.map((a) => a.toLowerCase())).size < answers.length) warn("Two answers are the same.");
    }

    // The numbers
    const number = (col: Column, what: string, whole: boolean): number | null => {
      const raw = at(cells, col).trim();
      if (raw === "") return null;
      const n = Number(raw.replace(",", "."));
      if (!Number.isFinite(n) || n < 0 || (whole && (!Number.isInteger(n) || n < 1))) {
        warn(`${what} "${raw}" is not ${whole ? "a whole number from 1" : "a number from 0"}, so the usual value is used.`);
        return null;
      }
      return n;
    };
    const points = number("points", "The points", false);
    const attempts = number("attempts", "The attempts", true);
    const value = wanted.has("value") ? number("value", "The value", false) : null;

    if (seen.has(question.toLowerCase())) warn(`This is the same question as row ${seen.get(question.toLowerCase())}.`);
    else seen.set(question.toLowerCase(), row);

    questions.push({ row, type, question, answers: shown, correct, points, attempts, category: wanted.has("category") ? at(cells, "category").replace(/\s+/g, " ").trim() : "", value: value !== null && value > 0 ? value : null, rightFeedback: at(cells, "right").trim(), wrongFeedback: at(cells, "wrong").trim() });
  });

  if (questions.length > MAX_QUESTIONS) {
    problems.push({ row: 1, severity: "error", message: `The file holds ${questions.length} questions and at most ${MAX_QUESTIONS} can be added at once. Split it into two files.` });
    return { questions: [], problems, unusedColumns, rows: body.length };
  }
  problems.sort((a, b) => a.row - b.row);
  return { questions, problems, unusedColumns, rows: body.length };
}

/** A sentence for the top of the dialog: what was found. */
export function describeRead(read: QuestionRead): string {
  const errors = read.problems.filter((p) => p.severity === "error").length;
  const n = read.questions.length;
  if (n === 0) return errors > 0 ? "No question could be read from this file." : "There are no questions in this file.";
  const left = read.rows - n;
  return `${plural(n, "question", "questions")} can be added.${left > 0 ? ` ${plural(left, "row was", "rows were")} left out because of a mistake.` : ""}`;
}

// ---- the template

const cell = (s: string): string => (/[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** A table to start from: the columns named, a few rows to show how each kind is written, and nothing else to delete but those rows. */
export const TEMPLATE_CSV: string = [
  ["Type", "Question", "A", "B", "C", "D", "E", "Correct", "Points", "Feedback if right", "Feedback if wrong"],
  ["MC", "Which channel suits a quick yes or no between two colleagues?", "A short message", "A formal letter", "A staff meeting", "A printed memo", "", "A", "10", "Right: a short message is quick and easy to answer.", "Not quite. Think about how quickly the answer is needed."],
  ["MC", "Which of these is a planet?", "Mars", "The Moon", "The Sun", "Sirius", "Halley's Comet", "A", "", "", ""],
  ["MR", "Which of these help a reader decide what to read first?", "A clear subject line", "A long first paragraph", "A short summary at the top", "Writing in capital letters", "", "A, C", "10", "", ""],
  ["TF", "A reply to everyone is always the right choice.", "", "", "", "", "", "False", "", "", ""],
  ["SA", "What is the name of the movement of ideas from one person to another?", "Communication", "communicating", "", "", "", "", "", "", ""],
].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
