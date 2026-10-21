// Tests for suggested descriptions (format 0.28.0): a description the computer worked out for an object and the author has not approved. The course never uses it; the editor
// offers it, and the author uses it, throws it away, or writes their own.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-10" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const SUGGESTION = { text: "A screenshot of Notepad, with the File menu marked.", basis: "What was recorded: the name of what was clicked, and the window it was in." };

/** A table (it starts with no alt text) with a description waiting. */
function withSuggestion(): { m: Model; id: string } {
  const m = fresh();
  const o = m.addObject("table")!;
  assert.ok(m.setAccessibility(o.id, { altSuggestion: SUGGESTION }) !== null);
  return { m, id: o.id };
}

test("a suggestion waits beside empty alt text, and using it fills the alt text and takes the suggestion away", () => {
  const { m, id } = withSuggestion();
  assert.deepEqual(m.object!.accessibility.altSuggestion, SUGGESTION);
  assert.equal(m.object!.accessibility.altText, "");
  const said = m.useAltSuggestion(id)!;
  assert.match(said, /Read it against the picture and change it if it is wrong/);
  assert.equal(m.object!.accessibility.altText, SUGGESTION.text);
  assert.equal("altSuggestion" in m.object!.accessibility, false);
  assert.equal(m.object!.accessibility.decorative, false);
});

test("using a suggestion is one undo step, and undo puts the suggestion back with empty alt text", () => {
  const { m, id } = withSuggestion();
  m.useAltSuggestion(id);
  m.undo();
  assert.equal(m.object!.accessibility.altText, "");
  assert.deepEqual(m.object!.accessibility.altSuggestion, SUGGESTION);
  m.redo();
  assert.equal(m.object!.accessibility.altText, SUGGESTION.text);
});

test("throwing a suggestion away leaves the alt text as it was, and says it is still needed when it is empty", () => {
  const { m, id } = withSuggestion();
  const said = m.dismissAltSuggestion(id)!;
  assert.match(said, /Threw away the suggested description/);
  assert.match(said, /still needs alt text, or to be marked decorative/);
  assert.equal("altSuggestion" in m.object!.accessibility, false);
  assert.equal(m.object!.accessibility.altText, "");
  m.undo();
  assert.deepEqual(m.object!.accessibility.altSuggestion, SUGGESTION);
  assert.equal(m.dismissAltSuggestion("obj-nothing"), null);
});

test("writing their own alt text, or marking the object decorative, ends the suggestion; changing the role does not", () => {
  const a = withSuggestion();
  a.m.setAccessibility(a.id, { role: "table" });
  assert.deepEqual(a.m.object!.accessibility.altSuggestion, SUGGESTION, "an unrelated change leaves it");
  a.m.setAccessibility(a.id, { altText: "Results by quarter" });
  assert.equal("altSuggestion" in a.m.object!.accessibility, false, "their own words win");
  const b = withSuggestion();
  b.m.setAccessibility(b.id, { decorative: true });
  assert.equal("altSuggestion" in b.m.object!.accessibility, false, "a decorative object needs no description");
});

test("using or throwing away a suggestion on an object that has none does nothing", () => {
  const m = fresh();
  const o = m.addObject("table")!;
  assert.equal(m.useAltSuggestion(o.id), null);
  assert.equal(m.dismissAltSuggestion(o.id), null);
});

test("a suggestion survives saving and opening the course", () => {
  const { m } = withSuggestion();
  const files = m.allFiles();
  const slide = files.find((f) => f.path.startsWith("slides/"))!;
  assert.match(slide.text, /"altSuggestion"/);
  const reopened = new Model({ dir: "D:/x", project: files.find((f) => f.path === "project.json")!.text, theme: files.find((f) => f.path === "theme.json")!.text, slides: [{ id: "slide-001", text: slide.text }] });
  const t = reopened.slides[0]!.baseLayer.objects.find((o) => o.type === "table")!;
  assert.deepEqual(t.accessibility.altSuggestion, SUGGESTION);
});

// ---- the real validator

function validate(m: Model): { severity: string; rule: string; object_id: string; detail: string }[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-altsuggestion-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const opts = { skip: !process.env["OPENSTAGE_PYTHON"] };

test("the real checker still asks for alt text while a suggestion waits, and shows the suggestion; once it is used, it is satisfied", opts, () => {
  const { m, id } = withSuggestion();
  const waiting = validate(m).filter((f) => f.rule === "alt-text-missing" && f.object_id === id);
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0]!.severity, "error");
  assert.ok(waiting[0]!.detail.includes(SUGGESTION.text), waiting[0]!.detail);
  m.useAltSuggestion(id);
  const after = validate(m);
  assert.deepEqual(after.filter((f) => f.object_id === id && (f.rule === "alt-text-missing" || f.rule === "alt-suggestion-unused" || f.rule === "schema")), []);
});

test("the real checker tells the author about a suggestion left on an object that has its own alt text", opts, () => {
  const { m, id } = withSuggestion();
  // The model clears it for the author, so leave one behind the way a hand-edited file could.
  const o = m.object!;
  o.accessibility = { ...o.accessibility, altText: "Results by quarter" };
  const left = validate(m).filter((f) => f.rule === "alt-suggestion-unused" && f.object_id === id);
  assert.equal(left.length, 1);
  assert.equal(left[0]!.severity, "warning");
});
