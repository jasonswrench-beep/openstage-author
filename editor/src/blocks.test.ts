// Tests for tables and scrolling text: adding them, editing them, undo, and the real validator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { TableContent } from "../../player/src/types.ts";
import { groupOptions } from "./factory.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-10" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const table = (m: Model) => m.object!.content as unknown as TableContent;

test("the table and the scrolling text box are offered in one picker", () => {
  assert.deepEqual(groupOptions("content").map((o) => o.value), ["content:table", "content:scrollingText"]);
});

test("a new table has a header row, three by three cells, and no name until the author gives one", () => {
  const m = fresh();
  const o = m.addObject("table")!;
  assert.equal(o.type, "table");
  assert.equal(table(m).headerRow, true);
  assert.equal(table(m).rows.length, 3);
  assert.equal(o.accessibility.altText, "", "the author names it");
  assert.ok((o.accessibility.tabOrder ?? 0) >= 1);
  assert.equal(o.style["color"], undefined);
});

test("cells, rows and columns can be edited, and each change is one undo step", () => {
  const m = fresh();
  const o = m.addObject("table")!;
  m.setTableCell(o.id, 1, 2, "Hello");
  assert.equal(table(m).rows[1]![2], "Hello");
  assert.equal(m.setTableCell(o.id, 9, 9, "x"), null, "a cell that does not exist is ignored");

  m.addTableRow(o.id, 0);
  assert.equal(table(m).rows.length, 4);
  assert.deepEqual(table(m).rows[1], ["", "", ""], "inserted below row 1");
  m.addTableColumn(o.id);
  assert.ok(table(m).rows.every((r) => r.length === 4), "every row got the new column");
  m.deleteTableColumn(o.id, 0);
  assert.ok(table(m).rows.every((r) => r.length === 3));
  m.deleteTableRow(o.id, 1);
  assert.equal(table(m).rows.length, 3);

  m.undo(); m.undo(); m.undo(); m.undo();
  assert.equal(table(m).rows[1]![2], "Hello");
  m.undo();
  assert.equal(table(m).rows[1]![2], "Cell");
});

test("a table keeps at least one row and column, at most 30 by 12, and always a header", () => {
  const m = fresh();
  const o = m.addObject("table")!;
  while (table(m).rows.length > 1) m.deleteTableRow(o.id, 0);
  assert.match(m.deleteTableRow(o.id, 0)!, /at least one row/);
  while (table(m).rows[0]!.length > 1) m.deleteTableColumn(o.id, 0);
  assert.match(m.deleteTableColumn(o.id, 0)!, /at least one column/);
  while (table(m).rows.length < 30) m.addTableRow(o.id);
  assert.match(m.addTableRow(o.id)!, /at most 30/);
  while (table(m).rows[0]!.length < 12) m.addTableColumn(o.id);
  assert.match(m.addTableColumn(o.id)!, /at most 12/);

  assert.match(m.setTableHeaders(o.id, { headerRow: false })!, /needs a header row or a header column/);
  assert.equal(table(m).headerRow, true, "refused");
  m.setTableHeaders(o.id, { headerColumn: true });
  assert.equal(m.setTableHeaders(o.id, { headerRow: false }), "Header row off, header column on");
});

test("scrolling text keeps its paragraphs, cannot be emptied, and one edit is one undo step", () => {
  const m = fresh();
  const o = m.addObject("scrollingText")!;
  m.setScrollText(o.id, "One.\n\nTwo & three");
  assert.equal(m.object!.content["html"], "<p>One.</p><p>Two &amp; three</p>");
  assert.match(m.setScrollText(o.id, "   ")!, /cannot be empty/);
  assert.equal(m.object!.content["html"], "<p>One.</p><p>Two &amp; three</p>");
  m.undo();
  assert.match(String(m.object!.content["html"]), /Write the text here/);
});

// ---- the real validator

type Finding = { severity: string; rule: string; message: string };
type SlideFile = { baseLayer: { objects: { type: string; content: Record<string, unknown> }[] } };

function validate(m: Model, edit?: (slide: SlideFile) => void): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-blocks-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) {
      let text = f.text;
      if (edit && f.path === "slides/slide-001.json") {
        const slide = JSON.parse(text);
        edit(slide);
        text = JSON.stringify(slide, null, 2) + "\n";
      }
      writeFileSync(path.join(dir, f.path), text);
    }
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const opts = { skip: !process.env["OPENSTAGE_PYTHON"] };

test("a new table and scrolling text box are flagged until they are named, then pass", opts, () => {
  const m = fresh();
  const t = m.addObject("table")!;
  const s = m.addObject("scrollingText")!;
  assert.equal(validate(m).filter((f) => f.rule === "alt-text-missing").length, 2);
  m.setAccessibility(t.id, { altText: "Results by quarter" });
  m.setAccessibility(s.id, { altText: "Terms of use" });
  assert.deepEqual(validate(m).filter((f) => f.severity === "error"), []);
});

test("the validator flags a table with no header, ragged rows, an empty header, and a scrolling box nobody can tab to", opts, () => {
  const m = fresh();
  const t = m.addObject("table")!;
  const s = m.addObject("scrollingText")!;
  m.setAccessibility(t.id, { altText: "Results" });
  m.setAccessibility(s.id, { altText: "Terms" });
  const tableOf = (sl: SlideFile) => sl.baseLayer.objects.find((o) => o.type === "table")!.content as unknown as TableContent;
  assert.ok(validate(m, (sl) => { tableOf(sl).headerRow = false; }).some((f) => f.rule === "table-needs-header"));
  assert.ok(validate(m, (sl) => { tableOf(sl).rows[1]!.pop(); }).some((f) => f.rule === "table-not-rectangular"));
  assert.ok(validate(m, (sl) => { tableOf(sl).rows[0]![0] = ""; }).some((f) => f.rule === "table-empty-header" && f.severity === "warning"));
  m.setAccessibility(s.id, { tabOrder: 0 });
  assert.ok(validate(m).some((f) => f.rule === "not-keyboard-reachable"));
});
