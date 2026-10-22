// Games filled from a spreadsheet. A quiz board or a prize ladder is mostly its questions, so an author who keeps them in a table (Excel, Google Sheets) saves it
// as a CSV file and the game is made with the questions already in it. This reads the table for each game and says what it found, row by row, in words: a row with a
// mistake is left out and named, and a table that cannot make the game at all says why, in a sentence. Nothing here touches the project.
//
// The columns are the ones Add questions from a spreadsheet reads (Type, Question, A to H, Correct, Feedback if right, Feedback if wrong; see questionimport.ts), and:
//   Quiz board:    Category (the column of the board the question goes in) and Value (what its tile is worth; Points does the same if there is no Value).
//   Prize ladder:  none: the questions are the rungs, in the order of the rows.
// A table always names its columns in its first row, so the columns may be in any order.

import { readQuestions, type ImportedQuestion, type ImportProblem } from "./questionimport.ts";

/** How many of each a game can hold. The game sets take their limits from here, so the table and the dialog agree. */
export const BOARD_CATEGORIES = { min: 2, max: 6 } as const;
export const BOARD_VALUES = { min: 2, max: 5 } as const;
export const LADDER_QUESTIONS = { min: 5, max: 15 } as const;
/** A question in a game has room for this many answers to choose from. */
export const MAX_GAME_ANSWERS = 5;

export interface BoardTile {
  /** What the tile is worth, and what its question is worth. */
  value: number;
  question: ImportedQuestion;
}
export interface BoardCategory {
  name: string;
  /** From the smallest value to the largest. */
  tiles: BoardTile[];
}
export interface BoardContent {
  kind: "quiz-board";
  title: string;
  categories: BoardCategory[];
}
export interface LadderContent {
  kind: "prize-ladder";
  title: string;
  /** In the order of the rungs, the first on the lowest. */
  questions: ImportedQuestion[];
}
/** What an author's table gives a game, in place of the placeholders it starts with. */
export type GameContent = BoardContent | LadderContent;

export interface GameTableRead {
  /** What the game is made from, or null when the table cannot make this game (the summary says why). */
  content: GameContent | null;
  /** The sizes the game takes from the table, in the terms of the game's own choices. Null when it cannot be made. */
  options: Record<string, number> | null;
  problems: ImportProblem[];
  /** Things worth knowing that are not mistakes. */
  notes: string[];
  unusedColumns: string[];
  /** One or two sentences for the top of the result: what was found, or why nothing could be made. */
  summary: string;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const sentenceList = (items: string[]): string => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** The questions of a table that a game can hold, with those it cannot (too many answers for the room there is) taken out and named. */
function holdable(questions: ImportedQuestion[], problems: ImportProblem[]): ImportedQuestion[] {
  return questions.filter((q) => {
    if (q.type !== "short" && q.answers.length > MAX_GAME_ANSWERS) {
      problems.push({ row: q.row, severity: "error", message: `A question in a game has room for ${MAX_GAME_ANSWERS} answers and this has ${q.answers.length}, so this row was left out.` });
      return false;
    }
    return true;
  });
}

const fail = (read: ReturnType<typeof readQuestions>, problems: ImportProblem[], notes: string[], summary: string): GameTableRead =>
  ({ content: null, options: null, problems: problems.sort((a, b) => a.row - b.row), notes, unusedColumns: read.unusedColumns, summary });

// ---- the quiz board

/** Read a table of questions for a quiz board: a Category and a Value for each. */
export function readBoardTable(text: string, title: string): GameTableRead {
  const read = readQuestions(text, { columns: ["category", "value"] });
  const problems: ImportProblem[] = [...read.problems];
  const notes: string[] = [];
  const err = (row: number, message: string) => problems.push({ row, severity: "error", message });
  const warn = (row: number, message: string) => problems.push({ row, severity: "warning", message });

  let questions = holdable(read.questions, problems);
  questions = questions.filter((q) => {
    if (q.category !== "") return true;
    err(q.row, "There is no Category, so there is no telling which column of the board this question belongs in, and this row was left out.");
    return false;
  });
  if (questions.length === 0) return fail(read, problems, notes, "A quiz board could not be made: no question in this table has a Category. Name each question's category in a Category column.");

  // The columns of the board, in the order each category first appears.
  const names: string[] = [];
  const byCategory = new Map<string, ImportedQuestion[]>();
  for (const q of questions) {
    const key = q.category.toLowerCase();
    if (!byCategory.has(key)) { names.push(q.category); byCategory.set(key, []); }
    byCategory.get(key)!.push(q);
  }
  if (names.length < BOARD_CATEGORIES.min) {
    return fail(read, problems, notes, `A quiz board needs at least ${BOARD_CATEGORIES.min} categories, and this table has ${names.length}. Add a second category.`);
  }
  let used = names;
  if (names.length > BOARD_CATEGORIES.max) {
    used = names.slice(0, BOARD_CATEGORIES.max);
    for (const name of names.slice(BOARD_CATEGORIES.max)) for (const q of byCategory.get(name.toLowerCase())!) err(q.row, `A board has at most ${BOARD_CATEGORIES.max} categories, so ${name} was left out.`);
  }

  // A tile is worth its Value (or its Points, if the table has no Value). With every tile of a category valued, the tiles go from the smallest down; otherwise they keep the order of the rows.
  const worth = (q: ImportedQuestion): number | null => q.value ?? q.points;
  const columns = used.map((name) => {
    const rows = byCategory.get(name.toLowerCase())!;
    return { name, rows: rows.every((q) => worth(q) !== null) ? [...rows].sort((a, b) => worth(a)! - worth(b)!) : rows };
  });
  const smallest = Math.min(...columns.map((c) => c.rows.length));
  if (smallest < BOARD_VALUES.min) {
    const thin = columns.filter((c) => c.rows.length === smallest).map((c) => c.name);
    return fail(read, problems, notes, `A quiz board needs at least ${BOARD_VALUES.min} questions in every category, and ${sentenceList(thin)} ${thin.length === 1 ? "has" : "have"} ${smallest}. Add more, or take the category out.`);
  }
  const height = Math.min(smallest, BOARD_VALUES.max);
  for (const c of columns) {
    for (const q of c.rows.slice(height)) {
      err(q.row, smallest > BOARD_VALUES.max
        ? `A board holds ${height} questions in a column, so this row was left out.`
        : `${c.name} has more questions than the category with the fewest (${height}), and every column of a board has the same number of tiles, so this row was left out.`);
    }
    c.rows = c.rows.slice(0, height);
  }

  // Each tile's value, with the usual 100, 200, 300 where the table says nothing.
  const categories: BoardCategory[] = columns.map((c) => {
    const seen = new Set<number>();
    return {
      name: c.name,
      tiles: c.rows.map((q, r) => {
        let value = worth(q);
        if (value === null) {
          value = (r + 1) * 100;
          warn(q.row, `There is no Value, so this tile is worth ${value}.`);
        }
        if (seen.has(value)) warn(q.row, `Another tile in ${c.name} is also worth ${value}.`);
        seen.add(value);
        return { value, question: q };
      }),
    };
  });
  if (read.questions.some((q) => q.attempts !== null)) notes.push("A tile's question has one try, so the Attempts column is not used.");
  if (read.questions.some((q) => q.points !== null && q.value !== null)) notes.push("A tile is worth its Value, so the Points column is not used.");

  const total = categories.length * height;
  const dropped = read.rows - total;
  return {
    content: { kind: "quiz-board", title, categories },
    options: { categories: categories.length, values: height },
    problems: problems.sort((a, b) => a.row - b.row),
    notes,
    unusedColumns: read.unusedColumns,
    summary: `${categories.length} categories with ${plural(height, "question", "questions")} each, so ${plural(total, "tile", "tiles")}: ${sentenceList(categories.map((c) => c.name))}.${dropped > 0 ? ` ${plural(dropped, "row was", "rows were")} left out.` : ""}`,
  };
}

// ---- the prize ladder

/** Read a table of questions for a prize ladder: the rows are the rungs, the first row the lowest. */
export function readLadderTable(text: string, title: string): GameTableRead {
  const read = readQuestions(text);
  const problems: ImportProblem[] = [...read.problems];
  const notes: string[] = [];
  let questions = holdable(read.questions, problems);
  if (questions.length < LADDER_QUESTIONS.min) {
    return fail(read, problems, notes, `A prize ladder needs ${LADDER_QUESTIONS.min} to ${LADDER_QUESTIONS.max} questions, and this table has ${questions.length} that can be used. Add ${LADDER_QUESTIONS.min - questions.length} more.`);
  }
  if (questions.length > LADDER_QUESTIONS.max) {
    for (const q of questions.slice(LADDER_QUESTIONS.max)) problems.push({ row: q.row, severity: "error", message: `A ladder has at most ${LADDER_QUESTIONS.max} rungs, so this row was left out.` });
    questions = questions.slice(0, LADDER_QUESTIONS.max);
  }
  if (read.questions.some((q) => q.points !== null)) notes.push("The ladder sets what each rung is worth (100 for the first and 100 more for each after it), so the Points column is not used.");
  if (read.questions.some((q) => q.attempts !== null)) notes.push("Every question on the ladder has one try, so the Attempts column is not used.");
  const dropped = read.rows - questions.length;
  return {
    content: { kind: "prize-ladder", title, questions },
    options: { questions: questions.length },
    problems: problems.sort((a, b) => a.row - b.row),
    notes,
    unusedColumns: read.unusedColumns,
    summary: `${plural(questions.length, "question", "questions")}, one for each rung, the first row on the lowest.${dropped > 0 ? ` ${plural(dropped, "row was", "rows were")} left out.` : ""}`,
  };
}

// ---- the tables to start from

const cell = (s: string): string => (/[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const table = (rows: string[][]): string => rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";

const BOARD_HEAD = ["Category", "Value", "Type", "Question", "A", "B", "C", "D", "E", "Correct", "Feedback if right", "Feedback if wrong"];
const bq = (category: string, value: string, type: string, question: string, answers: string[], correct: string, right = "", wrong = ""): string[] =>
  [category, value, type, question, ...[...answers, "", "", "", "", ""].slice(0, 5), correct, right, wrong];

/** A table for a quiz board that is itself a whole small board: three categories of three questions. Replace the rows with your own. */
export const BOARD_TEMPLATE_CSV: string = table([
  BOARD_HEAD,
  bq("Colour", "100", "MC", "What is the smallest contrast ratio WCAG 2.2 level AA allows for normal-size text?", ["3 to 1", "4.5 to 1", "7 to 1"], "B", "Right: 4.5 to 1.", "Not quite. The smallest for normal-size text is 4.5 to 1."),
  bq("Colour", "200", "MC", "Which of these is not enough, on its own, to show that a form field has an error?", ["A red border", "A message that says what is wrong", "An icon with a text label"], "A"),
  bq("Colour", "300", "TF", "Large text, such as 24 pixel text, is allowed a lower contrast ratio than small text.", [], "True"),
  bq("Keyboard", "100", "MC", "Which key moves the focus to the next control on a page?", ["Enter", "Tab", "Escape"], "B"),
  bq("Keyboard", "200", "MC", "What is a keyboard trap?", ["A place the focus can enter but cannot leave with the keyboard", "A shortcut key that opens a menu", "A key that has stopped working"], "A"),
  bq("Keyboard", "300", "MC", "A dialog is open. Which key should close it?", ["Space", "Enter", "Escape"], "C"),
  bq("Words", "100", "MC", "What is alt text for?", ["A text version of a picture for learners who cannot see it", "A caption shown under every picture", "The file name of a picture"], "A"),
  bq("Words", "200", "MC", "Which link text is best?", ["Click here", "More", "Download the course handbook (PDF)"], "C"),
  bq("Words", "300", "MR", "Who can captions help?", ["Learners who are deaf", "Learners learning the language", "Learners in a noisy room", "Only learners who use a screen reader"], "A, B, C"),
]);

const LADDER_HEAD = ["Type", "Question", "A", "B", "C", "D", "E", "Correct", "Feedback if right", "Feedback if wrong"];
const lq = (type: string, question: string, answers: string[], correct: string, right = "", wrong = ""): string[] =>
  [type, question, ...[...answers, "", "", "", "", ""].slice(0, 5), correct, right, wrong];

/** A table for a prize ladder that is itself a whole small ladder: eight questions, the first on the lowest rung. Replace the rows with your own. */
export const LADDER_TEMPLATE_CSV: string = table([
  LADDER_HEAD,
  lq("MC", "Which planet is closest to the Sun?", ["Venus", "Mercury", "Mars"], "B", "Right: Mercury is the closest.", "Not quite. Mercury is the closest."),
  lq("MC", "How many sides does a hexagon have?", ["Six", "Five", "Eight"], "A"),
  lq("TF", "Plants make their own food from light, water and air.", [], "True"),
  lq("MC", "Which is the largest ocean on Earth?", ["The Atlantic", "The Pacific", "The Indian"], "B"),
  lq("MC", "In which year did the first people land on the Moon?", ["1969", "1959", "1979"], "A"),
  lq("SA", "What is the chemical symbol for gold?", ["Au"], ""),
  lq("MC", "Which of these numbers is a prime number?", ["49", "53", "51"], "B"),
  lq("MC", "About how fast does light travel in empty space?", ["300,000 kilometres a second", "30,000 kilometres a second", "3 million kilometres a second"], "A"),
]);
