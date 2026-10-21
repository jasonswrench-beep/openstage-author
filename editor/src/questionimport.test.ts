// Tests for reading questions from a spreadsheet saved as CSV: the table, the columns, every kind of question, and what is said about a mistake.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { delimiterOf, describeRead, MAX_QUESTIONS, parseCsv, readQuestions, TEMPLATE_CSV } from "./questionimport.ts";

test("a table is cut into cells, with quotes holding commas and new lines, and two quotes for one", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,2,3"), [["a", "b", "c"], ["1", "2", "3"]]);
  assert.deepEqual(parseCsv('a,"b, with comma","say ""hi"""\r\n1,"two\nlines",3\r\n'), [["a", "b, with comma", 'say "hi"'], ["1", "two\nlines", "3"]]);
  assert.deepEqual(parseCsv("﻿a,b\n1,2"), [["a", "b"], ["1", "2"]], "a byte order mark from Excel is not part of the first name");
  assert.deepEqual(parseCsv("a,b\n\n,\n1,2\n"), [["a", "b"], ["1", "2"]], "rows with nothing in them are left out");
  assert.deepEqual(parseCsv("a,b\r1,2"), [["a", "b"], ["1", "2"]], "an old Mac line end");
  assert.deepEqual(parseCsv("  a , b \n"), [["a", "b"]], "spaces round a cell are not part of it");
  assert.deepEqual(parseCsv("a,b\n1,"), [["a", "b"], ["1", ""]]);
  assert.deepEqual(parseCsv(""), []);
});

test("the separator is the one a spreadsheet used: commas, semicolons or tabs", () => {
  assert.equal(delimiterOf("a,b,c"), ",");
  assert.equal(delimiterOf("a;b;c"), ";");
  assert.equal(delimiterOf("a\tb\tc"), "\t");
  assert.equal(delimiterOf('"a,b";c;d'), ";", "a comma inside quotes does not count");
  assert.deepEqual(parseCsv("Question;A;B\nWhy, then?;x;y"), [["Question", "A", "B"], ["Why, then?", "x", "y"]]);
  assert.deepEqual(parseCsv("Question\tA\nWhy?\tx"), [["Question", "A"], ["Why?", "x"]]);
});

const read = (rows: string[]) => readQuestions(rows.join("\n"));
const HEAD = "Type,Question,A,B,C,D,E,Correct,Points,Feedback if right,Feedback if wrong";

test("the template reads without a single problem, and holds one of each kind", () => {
  const r = readQuestions(TEMPLATE_CSV);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.questions.map((q) => q.type), ["mc", "mc", "mr", "tf", "short"]);
  assert.equal(r.rows, 5);
  assert.deepEqual(r.unusedColumns, []);
  assert.equal(describeRead(r), "5 questions can be added.");
});

test("a multiple choice question: the answers, the right one by its letter, and the optional parts", () => {
  const r = read([HEAD, 'MC,"Which is first?",One,Two,Three,Four,Five,C,5,"Right, it is.","Look again"']);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.questions[0], { row: 2, type: "mc", question: "Which is first?", answers: ["One", "Two", "Three", "Four", "Five"], correct: [2], points: 5, attempts: null, rightFeedback: "Right, it is.", wrongFeedback: "Look again" });
});

test("the right answer can be written as a letter in either case, or as the answer's own words", () => {
  for (const cell of ["b", "B", " b ", "Two"]) {
    const r = read([HEAD, `MC,Q,One,Two,Three,,,${cell},,,`]);
    assert.deepEqual(r.questions[0]?.correct, [1], cell);
  }
  assert.deepEqual(read([HEAD, 'MC,Q,"A short message",Two,Three,,,"A short message",,,']).questions[0]?.correct, [0], "an answer's words with spaces, which start with a letter that is also a letter of an answer");
});

test("a type left empty is multiple choice, and the usual names for each type are understood", () => {
  assert.equal(read([HEAD, ",Q,One,Two,,,,A,,,"]).questions[0]?.type, "mc");
  for (const [code, want] of [["mc", "mc"], ["MCQ", "mc"], ["Multiple choice", "mc"], ["MR", "mr"], ["multiple response", "mr"], ["MA", "mr"], ["Select all", "mr"], ["TF", "tf"], ["True/False", "tf"], ["true or false", "tf"], ["SA", "short"], ["Short answer", "short"]] as const) {
    const row = want === "tf" ? `${code},Q,,,,,,True,,,` : want === "short" ? `${code},Q,x,,,,,,,,` : want === "mr" ? `${code},Q,One,Two,Three,,,A B,,,` : `${code},Q,One,Two,,,,A,,,`;
    assert.equal(read([HEAD, row]).questions[0]?.type, want, code);
  }
});

test("multiple response: several right answers named by letters in any usual way", () => {
  for (const cell of ["A, C", "A;C", "A|C", "A C", "A and C", "A/C", "c,a"]) {
    const r = readQuestions(`${HEAD}\nMR,Q,One,Two,Three,Four,,"${cell}",,,`);
    assert.deepEqual(r.questions[0]?.correct, [0, 2], cell);
  }
});

test("true or false: True and False are the two answers, and Correct says which is right", () => {
  for (const [cell, want] of [["True", 0], ["true", 0], ["T", 0], ["Yes", 0], ["False", 1], ["f", 1], ["No", 1]] as const) {
    const q = read([HEAD, `TF,A statement,,,,,,${cell},,,`]).questions[0]!;
    assert.deepEqual([q.answers, q.correct], [["True", "False"], [want]], cell);
  }
  const bad = read([HEAD, "TF,A statement,,,,,,Maybe,,,"]);
  assert.deepEqual(bad.questions, []);
  assert.match(bad.problems[0]!.message, /needs True or False in the Correct column, not "Maybe"/);
  assert.match(read([HEAD, "TF,A statement,,,,,,,,,"]).problems[0]!.message, /needs True or False in the Correct column\./);
  assert.match(read([HEAD, "TF,A statement,One,Two,,,,True,,,"]).problems[0]!.message, /answer columns were not used/);
});

test("a short answer takes its accepted answers from A to H, or from Correct, separated by bars", () => {
  assert.deepEqual(read([HEAD, "SA,Q,Paris,paris,,,,,,,"]).questions[0]?.answers, ["Paris", "paris"]);
  assert.deepEqual(read([HEAD, "SA,Q,,,,,,Paris | the city of Paris,,,"]).questions[0]?.answers, ["Paris", "the city of Paris"]);
  assert.match(read([HEAD, "SA,Q,,,,,,,,,"]).problems[0]!.message, /needs at least one answer that is accepted/);
});

test("the columns are found by their names, in any order, with the usual other names, and some can be left out", () => {
  const r = readQuestions("Question,Answer Choice B,Answer Choice A,Correct Answer\nWhich?,Two,One,A");
  assert.deepEqual(r.problems, []);
  assert.deepEqual([r.questions[0]?.answers, r.questions[0]?.correct], [["One", "Two"], [0]], "A is the column called A, wherever it is");
  const r2 = readQuestions("Prompt,Choice A,Choice B,Key,Weight,Tries,If right,If wrong\nWhich?,One,Two,B,3,2,Yes,No");
  assert.deepEqual([r2.questions[0]?.points, r2.questions[0]?.attempts, r2.questions[0]?.rightFeedback, r2.questions[0]?.wrongFeedback, r2.questions[0]?.correct], [3, 2, "Yes", "No", [1]]);
});

test("a column that is not understood is said, and not used", () => {
  const r = readQuestions("Question,A,B,Correct,Chapter\nWhich?,One,Two,A,3");
  assert.deepEqual(r.unusedColumns, ["Chapter"]);
  assert.equal(r.questions.length, 1);
});

test("a table with no names on its first row is read in the template's order", () => {
  const r = readQuestions("MC,Which?,One,Two,Three,,,B\nTF,True?,,,,,,True");
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.questions.map((q) => [q.type, q.question, q.correct]), [["mc", "Which?", [1]], ["tf", "True?", [0]]]);
  assert.equal(r.questions[0]?.row, 1, "the first row is row 1 when there is no header");
});

test("a row with a mistake is left out and says where and what, and the good rows still come in", () => {
  const r = read([HEAD, "MC,Good one,One,Two,,,,A,,,", "MC,,One,Two,,,,A,,,", "MC,One answer only,One,,,,,A,,,", "XX,Odd type,One,Two,,,,A,,,", "MC,No key,One,Two,,,,,,,", "MC,Wrong key,One,Two,,,,Z,,,", "MC,Two right,One,Two,,,,A B,,,", "MR,All right,One,Two,,,,A B,,,"]);
  assert.deepEqual(r.questions.map((q) => q.question), ["Good one"]);
  assert.deepEqual(r.problems.map((p) => p.row), [3, 4, 5, 6, 7, 8, 9]);
  assert.ok(r.problems.every((p) => p.severity === "error"));
  assert.match(r.problems[0]!.message, /There is no question/);
  assert.match(r.problems[1]!.message, /needs at least two answers/);
  assert.match(r.problems[2]!.message, /type "XX"/);
  assert.match(r.problems[3]!.message, /Correct column says which answer is right, and it is empty/);
  assert.match(r.problems[4]!.message, /"Z" in the Correct column is not one of the answers/);
  assert.match(r.problems[5]!.message, /one right answer.*Use MR/);
  assert.match(r.problems[6]!.message, /Every answer is marked right/);
  assert.equal(describeRead(r), "1 question can be added. 7 rows were left out because of a mistake.");
});

test("a letter that names an answer that is empty is a mistake, and an empty answer in the middle is skipped with a word", () => {
  const gap = read([HEAD, "MC,Q,One,,Three,,,C,,,"]);
  assert.deepEqual(gap.questions[0]?.answers, ["One", "Three"]);
  assert.deepEqual(gap.questions[0]?.correct, [1], "C is the second answer that is there");
  assert.equal(gap.problems[0]?.severity, "warning");
  assert.match(gap.problems[0]!.message, /1 answer is empty/);
  assert.match(read([HEAD, "MC,Q,One,,Three,,,B,,,"]).problems.find((p) => p.severity === "error")!.message, /"B" in the Correct column is not one of the answers/);
});

test("odd numbers and repeats are warnings, and the row is still used", () => {
  const r = read([HEAD, "MC,Same,One,Two,,,,A,lots,,", "MC,Same,One,One,,,,A,5,,", "MC,Third,One,Two,,,,A,-2,,"]);
  assert.equal(r.questions.length, 3);
  assert.deepEqual(r.problems.filter((p) => p.severity === "error"), []);
  assert.equal(r.questions[0]?.points, null);
  assert.deepEqual(r.problems.map((p) => p.row), [2, 3, 3, 4]);
  assert.match(r.problems[0]!.message, /The points "lots" is not a number from 0, so the usual value is used/);
  assert.match(r.problems[1]!.message, /Two answers are the same/);
  assert.match(r.problems[2]!.message, /same question as row 2/);
  assert.match(r.problems[3]!.message, /"-2"/);
});

test("attempts must be a whole number from 1", () => {
  const r = readQuestions("Question,A,B,Correct,Attempts\nQ,One,Two,A,3\nR,One,Two,A,0\nS,One,Two,A,1.5");
  assert.deepEqual(r.questions.map((q) => q.attempts), [3, null, null]);
  assert.equal(r.problems.length, 2);
});

test("an empty file, a header with nothing under it and a table with no Question column are said", () => {
  assert.match(readQuestions("").problems[0]!.message, /empty/);
  assert.equal(describeRead(readQuestions("")), "No question could be read from this file.");
  assert.match(readQuestions(HEAD).problems[0]!.message, /no questions under them/);
  assert.match(readQuestions("Type,A,B,Correct,Question\n").problems[0]!.message, /no questions under them/);
});

test("too many questions are refused with the number and what to do", () => {
  const rows = [HEAD, ...Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => `MC,Question ${i},One,Two,,,,A,,,`)];
  const r = read(rows);
  assert.equal(r.questions.length, 0);
  assert.match(r.problems[0]!.message, /201 questions and at most 200 can be added at once. Split it into two files/);
});

test("accented letters, quotes and symbols come through as they were", () => {
  const r = read([HEAD, 'MC,"Qu\'est-ce que c\'est « ça » ? Naïve café – 100% sûr",Oui,Non,,,,A,,,']);
  assert.equal(r.questions[0]?.question, "Qu'est-ce que c'est « ça » ? Naïve café – 100% sûr");
});

test("the template in the examples folder is the one the editor writes", () => {
  const file = readFileSync(fileURLToPath(new URL("../../examples/questions-template.csv", import.meta.url)));
  assert.deepEqual([...file.subarray(0, 3)], [0xef, 0xbb, 0xbf], "with the mark Excel looks for");
  assert.equal(file.subarray(3).toString("utf8"), TEMPLATE_CSV);
});
