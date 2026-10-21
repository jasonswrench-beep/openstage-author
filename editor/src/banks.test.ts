// Tests for question banks and shuffled answers in the editor: making a bank, its settings, what deleting a slide does to it, undo, and the real validator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ChoiceQuiz } from "../../player/src/types.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A project with this many slides in all, each named Slide 1, Slide 2 and so on. */
function course(n: number): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-12" });
  const m = new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
  m.renameSlide("slide-001", "Slide 1");
  while (m.slides.length < n) {
    const s = m.addSlide();
    m.renameSlide(s.id, `Slide ${m.slides.length}`);
  }
  return m;
}
const ids = (m: Model) => m.slides.map((s) => s.id);

test("a new bank holds the slides from the first to the last, shows half of them in a mixed order, and is named for the author to change", () => {
  const m = course(6);
  const [, b, , d] = ids(m);
  const said = m.addBank(b!, d!, "  Chapter 2 questions ");
  assert.match(said!, /Added the question bank Chapter 2 questions: 3 slides, showing 1 of them/);
  assert.equal(m.banks.length, 1);
  const bank = m.banks[0]!;
  assert.deepEqual(bank.slides, ids(m).slice(1, 4));
  assert.deepEqual({ name: bank.name, draw: bank.draw, shuffle: bank.shuffle }, { name: "Chapter 2 questions", draw: 1, shuffle: true });
  assert.match(bank.id, /^bank-0001$/);
  assert.equal(m.bankOf(b!)?.id, bank.id);
  assert.equal(m.bankOf(ids(m)[0]!), undefined);
});

test("the first and last can be given in either order, and a bank without a name gets one", () => {
  const m = course(5);
  m.addBank(ids(m)[3]!, ids(m)[1]!);
  assert.deepEqual(m.banks[0]!.slides, ids(m).slice(1, 4));
  assert.equal(m.banks[0]!.name, "Question bank 1");
});

test("a bank needs two slides, and a slide can be in one bank only", () => {
  const m = course(6);
  assert.match(m.addBank(ids(m)[1]!, ids(m)[1]!)!, /needs at least two slides/);
  assert.equal(m.banks.length, 0);
  m.addBank(ids(m)[1]!, ids(m)[3]!);
  assert.match(m.addBank(ids(m)[3]!, ids(m)[4]!)!, /Slide 4 is already in the question bank Question bank 1/);
  assert.equal(m.banks.length, 1);
  assert.match(m.addBank(ids(m)[4]!, ids(m)[5]!)!, /^Added/);
  assert.equal(m.banks[1]!.id, "bank-0002");
  assert.equal(m.addBank("slide-999", ids(m)[1]!), null, "a slide that is not there");
});

test("how many to show is from 1 to all, the mixing can be turned off, and a bank can be renamed", () => {
  const m = course(6);
  m.addBank(ids(m)[0]!, ids(m)[5]!);
  const id = m.banks[0]!.id;
  assert.equal(m.banks[0]!.draw, 3);
  assert.match(m.setBankDraw(id, 4)!, /shown 4 of the 6 slides/);
  assert.match(m.setBankDraw(id, 99)!, /shown 6 of the 6 slides\. That is as many as it can/);
  assert.match(m.setBankDraw(id, 0)!, /shown 1 of the 6/);
  assert.equal(m.banks[0]!.draw, 1);
  assert.equal(m.setBankDraw(id, 1), null, "no change");
  assert.equal(m.setBankDraw(id, Number.NaN), "That needs a number.");
  assert.match(m.setBankMix(id, false)!, /order they have in the course/);
  assert.equal(m.banks[0]!.shuffle, false);
  assert.equal(m.setBankMix(id, false), null);
  assert.equal(m.setBankName(id, "  "), "A question bank needs a name.");
  assert.equal(m.setBankName(id, " Final "), "Name updated");
  assert.equal(m.banks[0]!.name, "Final");
});

test("moving a bank to other slides keeps what it shows within what it holds, and keeps out of other banks", () => {
  const m = course(8);
  m.addBank(ids(m)[0]!, ids(m)[5]!);
  const id = m.banks[0]!.id;
  m.setBankDraw(id, 5);
  assert.match(m.setBankRange(id, ids(m)[0]!, ids(m)[2]!)!, /now holds 3 slides/);
  assert.equal(m.banks[0]!.draw, 3, "lowered, because it holds only three");
  m.addBank(ids(m)[5]!, ids(m)[7]!);
  assert.match(m.setBankRange(id, ids(m)[0]!, ids(m)[6]!)!, /already in the question bank/);
  assert.equal(m.banks[0]!.slides.length, 3, "not changed");
  assert.equal(m.setBankRange(id, ids(m)[0]!, ids(m)[2]!), null, "the same slides is no change");
});

test("deleting a slide takes it out of its bank, and a bank with fewer than two left goes", () => {
  const m = course(6);
  m.addBank(ids(m)[1]!, ids(m)[4]!);
  m.setBankDraw(m.banks[0]!.id, 4);
  const said = m.deleteSlide(ids(m)[2]!)!;
  assert.match(said, /Deleted Slide 3\. It was one of the slides of the question bank Question bank 1\./);
  assert.equal(m.banks[0]!.slides.length, 3);
  assert.equal(m.banks[0]!.draw, 3, "it cannot show more than it holds now");
  m.deleteSlide(ids(m)[1]!);
  assert.match(m.deleteSlide(ids(m)[1]!)!, /too few slides left and was taken away/);
  assert.equal(m.banks.length, 0);
});

test("every change to a bank is one undo step, and a bank comes back with undo", () => {
  const m = course(5);
  m.addBank(ids(m)[0]!, ids(m)[3]!);
  const id = m.banks[0]!.id;
  m.setBankDraw(id, 3);
  m.undo();
  assert.equal(m.banks[0]!.draw, 2, "the number is back");
  m.undo();
  assert.equal(m.banks.length, 0, "and so is the bank not being there");
  m.redo();
  assert.equal(m.banks.length, 1);
  m.deleteBank(m.banks[0]!.id);
  assert.equal(m.banks.length, 0);
  m.undo();
  assert.equal(m.banks.length, 1, "a deleted bank comes back");
  assert.equal(m.deleteBank("bank-9999"), null);
});

test("deleting a bank leaves its slides, and says so", () => {
  const m = course(4);
  m.addBank(ids(m)[0]!, ids(m)[2]!);
  const said = m.deleteBank(m.banks[0]!.id)!;
  assert.match(said, /Its slides stay in the course, and every learner sees all of them/);
  assert.equal(m.slides.length, 4);
});

test("a bank is saved in project.json and read back, and a project with none has no banks key", () => {
  const m = course(4);
  assert.ok(!m.allFiles().find((f) => f.path === "project.json")!.text.includes('"banks"'));
  m.addBank(ids(m)[0]!, ids(m)[2]!, "Quiz");
  const project = JSON.parse(m.allFiles().find((f) => f.path === "project.json")!.text) as { banks: unknown[] };
  assert.deepEqual(project.banks, [{ id: "bank-0001", name: "Quiz", slides: ids(m).slice(0, 3), draw: 1, shuffle: true }]);
  const reopened = new Model({ dir: "D:/x", project: m.allFiles().find((f) => f.path === "project.json")!.text, theme: m.allFiles().find((f) => f.path === "theme.json")!.text, slides: m.allFiles().filter((f) => f.path.startsWith("slides/")).map((f) => ({ id: f.path.slice(7, -5), text: f.text })) });
  assert.equal(reopened.banks.length, 1);
  assert.equal(reopened.banks[0]!.name, "Quiz");
});

test("the copy of a slide in a bank joins the bank, right after it, so the bank stays together", () => {
  const m = course(5);
  m.addBank(ids(m)[1]!, ids(m)[3]!);
  const original = ids(m)[2]!;
  const before = ids(m);
  const said = m.duplicateSlide(original)!;
  assert.match(said, /The copy is in the question bank Question bank 1 too/);
  const copy = ids(m).find((id) => !before.includes(id))!;
  assert.deepEqual(m.banks[0]!.slides, [before[1]!, original, copy, before[3]!]);
  assert.deepEqual(m.banks[0]!.slides, ids(m).slice(1, 5), "side by side in the course too");
  assert.equal(m.duplicateSlide(ids(m)[0]!)!.includes("question bank"), false, "a slide outside any bank is copied outside");
});

// ---- shuffled answers

test("a multiple choice question can mix its answers, and that is taken away by turning it off", () => {
  const m = course(2);
  m.selectSlide(ids(m)[0]!);
  m.addQuiz("mc");
  const q = m.object!;
  assert.equal((q.content as unknown as ChoiceQuiz).shuffle, undefined, "off to start with");
  assert.match(m.setShuffleChoices(q.id, true)!, /different order/);
  assert.equal((m.object!.content as unknown as ChoiceQuiz).shuffle, true);
  assert.equal(m.setShuffleChoices(q.id, true), null);
  assert.match(m.setShuffleChoices(q.id, false)!, /shown in your order/);
  assert.ok(!("shuffle" in m.object!.content), "no leftover setting");
  m.undo();
  assert.equal((m.object!.content as unknown as ChoiceQuiz).shuffle, true);
});

test("only a question with answers to choose from can mix them", () => {
  const m = course(2);
  m.addQuiz("short");
  assert.match(m.setShuffleChoices(m.object!.id, true)!, /Only a question with answers to choose from/);
  assert.ok(!("shuffle" in m.object!.content));
});

interface Finding { severity: string; rule: string; object_id: string }

function validate(m: Model): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-bank-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the real validator accepts what the editor writes, and warns about a bank that changes nothing", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = course(4);
  for (const id of ids(m)) {
    m.selectSlide(id);
    m.addQuiz("mc");
    m.setShuffleChoices(m.object!.id, true);
  }
  m.addBank(ids(m)[0]!, ids(m)[3]!, "Quiz");
  m.setBankDraw("bank-0001", 4);
  m.setBankMix("bank-0001", false);
  const errors = (f: Finding[]) => f.filter((x) => x.severity === "error").map((x) => x.rule);
  assert.deepEqual(errors(validate(m)).filter((r) => !["alt-text-missing"].includes(r)), []);
  assert.ok(validate(m).some((f) => f.rule === "bank-does-nothing"));
  m.setBankDraw("bank-0001", 2);
  assert.ok(!validate(m).some((f) => f.rule.startsWith("bank-")));
  assert.ok(!validate(m).some((f) => f.rule === "shuffle-position-words"));
});
