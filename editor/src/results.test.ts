// Tests for the results box and the certificate in the editor: adding them, editing their words, and that what the
// editor writes is accepted by the real validator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { CertificateContent, ResultsContent } from "../../player/src/types.ts";
import { ADD_MENU } from "./factory.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const python = process.env["OPENSTAGE_PYTHON"];

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-12" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const resultsOf = (m: Model, id: string) => m.objects.find((o) => o.id === id)!.content as unknown as ResultsContent;
const certOf = (m: Model, id: string) => m.objects.find((o) => o.id === id)!.content as unknown as CertificateContent;

test("the Add menu has one entry for both, and stays short", () => {
  assert.ok(ADD_MENU.some((e) => e.value === "group:course" && e.label === "Results or certificate..."));
  assert.ok(ADD_MENU.length <= 9);
});

test("a new results box starts with sensible words and no alt text, so the author must give it a name", () => {
  const m = fresh();
  const o = m.addObject("results")!;
  assert.equal(o.type, "results");
  assert.deepEqual(o.content, { heading: "Your results", passMessage: "Well done.", failMessage: "You can go back and review the lesson.", review: true });
  assert.equal(o.accessibility.altText, "", "alt text is never filled in for the author");
  assert.equal(o.accessibility.decorative, false);
  assert.ok(o.accessibility.tabOrder !== null && o.accessibility.tabOrder >= 1);
});

test("a new certificate starts with sensible words and no alt text", () => {
  const m = fresh();
  const o = m.addObject("certificate")!;
  assert.equal(o.type, "certificate");
  assert.deepEqual(o.content, { title: "Certificate of achievement", statement: "This certifies that", achievement: "has successfully completed", issuedBy: "", showScore: true, showDate: true });
  assert.equal(o.accessibility.altText, "");
});

test("results words and options change, with a plain message, and undo puts them back", () => {
  const m = fresh();
  const o = m.addObject("results")!;
  assert.equal(m.setResults(o.id, { heading: "  How you did  " }), "Results updated");
  assert.equal(resultsOf(m, o.id).heading, "How you did", "tidied");
  assert.equal(m.setResults(o.id, { passMessage: "Great work." }), "Results updated");
  assert.equal(m.setResults(o.id, { review: false }), "The results will not list the questions");
  assert.equal(m.setResults(o.id, { review: true }), "The results will list each question");
  // Switching the same option twice in a row is one undo step, like typing in one field.
  assert.ok(m.undo());
  assert.equal(resultsOf(m, o.id).review, true, "the switch is back as it was");
  assert.equal(resultsOf(m, o.id).passMessage, "Great work.", "the words are untouched");
  assert.ok(m.undo());
  assert.equal(resultsOf(m, o.id).passMessage, "Well done.");
});

test("a results box needs a heading, and a change that changes nothing says nothing", () => {
  const m = fresh();
  const o = m.addObject("results")!;
  assert.equal(m.setResults(o.id, { heading: "   " }), "The results box needs a heading.");
  assert.equal(resultsOf(m, o.id).heading, "Your results", "the refusal changed nothing");
  assert.equal(m.setResults(o.id, { heading: "Your results" }), null);
  assert.equal(m.setResults(o.id, { passMessage: "" }), "Results updated", "an empty message is allowed: it just adds nothing");
});

test("certificate words and options change, a title is required, and other lines may be left out", () => {
  const m = fresh();
  const o = m.addObject("certificate")!;
  assert.equal(m.setCertificate(o.id, { title: " Certificate of completion " }), "Certificate updated");
  assert.equal(certOf(m, o.id).title, "Certificate of completion");
  assert.equal(m.setCertificate(o.id, { title: "" }), "The certificate needs a title.");
  assert.equal(m.setCertificate(o.id, { statement: "", achievement: "", issuedBy: "The Department" }), "Certificate updated");
  assert.deepEqual([certOf(m, o.id).statement, certOf(m, o.id).achievement, certOf(m, o.id).issuedBy], ["", "", "The Department"]);
  assert.equal(m.setCertificate(o.id, { showScore: false }), "The certificate will not show the score");
  assert.equal(m.setCertificate(o.id, { showDate: false }), "The certificate will not show the date");
  assert.equal(m.setCertificate(o.id, { showDate: false }), null, "already off");
  assert.ok(m.undo());
  assert.equal(certOf(m, o.id).showDate, true);
});

test("the setters only work on their own kind of object", () => {
  const m = fresh();
  const r = m.addObject("results")!;
  const c = m.addObject("certificate")!;
  const t = m.addObject("text")!;
  assert.equal(m.setResults(c.id, { heading: "x" }), null);
  assert.equal(m.setCertificate(r.id, { title: "x" }), null);
  assert.equal(m.setResults(t.id, { heading: "x" }), null);
  assert.equal(m.setCertificate("obj-nope", { title: "x" }), null);
});

test("what is written to the slide file reads back the same", () => {
  const m = fresh();
  const o = m.addObject("certificate")!;
  m.setCertificate(o.id, { issuedBy: "Dr. Wrench" });
  const file = m.dirtyFiles().find((f) => f.path.startsWith("slides/"))!;
  const stored = (JSON.parse(file.text) as { baseLayer: { objects: { id: string; content: unknown }[] } }).baseLayer.objects.find((x) => x.id === o.id)!;
  assert.deepEqual(stored.content, certOf(m, o.id));
});

// ---- the real validator

function validate(m: Model): { rule: string; severity: string; object_id: string }[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-results-test-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(python!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout) as { rule: string; severity: string; object_id: string }[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the validator accepts what the editor makes, once each has a name and the course has a quiz", { skip: !python }, () => {
  const m = fresh();
  m.addQuiz("mc");
  const r = m.addObject("results")!;
  m.setAccessibility(r.id, { altText: "Your quiz results" });
  const c = m.addObject("certificate")!;
  m.setAccessibility(c.id, { altText: "Certificate of achievement" });
  const found = validate(m);
  assert.deepEqual(found.filter((f) => f.severity === "error" && ["alt-text-missing", "schema"].includes(f.rule)), []);
  assert.deepEqual(found.filter((f) => f.rule.endsWith("-no-quiz")), []);
});

test("the validator asks for the names, and warns when the course has no quiz", { skip: !python }, () => {
  const m = fresh();
  const r = m.addObject("results")!;
  const c = m.addObject("certificate")!;
  const found = validate(m);
  assert.ok(found.some((f) => f.rule === "alt-text-missing" && f.object_id === r.id));
  assert.ok(found.some((f) => f.rule === "alt-text-missing" && f.object_id === c.id));
  assert.ok(found.some((f) => f.rule === "results-no-quiz" && f.severity === "warning"));
  assert.ok(found.some((f) => f.rule === "certificate-no-quiz" && f.severity === "warning"));
});
