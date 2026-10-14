// Tests for offering a file to download: adding it, describing it, confirming it, narrating it, and the real validator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { DownloadContent } from "../../player/src/types.ts";
import { DOWNLOAD_EXTENSIONS, DOWNLOAD_HELP } from "../../player/src/downloads.ts";
import { ADD_MENU, newDownload, titleFromFileName } from "./factory.ts";
import { Model } from "./model.ts";
import { downloadScript, type Narration } from "./narration.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-12" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const content = (m: Model) => m.object!.content as unknown as DownloadContent;

test("a file's name becomes a title to start from", () => {
  assert.equal(titleFromFileName("assets/documents/course-handbook_v2.pdf"), "Course handbook v2");
  assert.equal(titleFromFileName("assets/documents/Syllabus.DOCX"), "Syllabus");
  assert.equal(titleFromFileName("assets/documents/a  b--c.csv"), "A b c");
  assert.equal(titleFromFileName("assets/documents/.pdf"), "File");
  assert.equal(titleFromFileName("assets/documents/---.pdf"), "File");
});

test("the Add menu is still short, and files are in the media picker", () => {
  assert.ok(ADD_MENU.length <= 9);
  assert.equal(ADD_MENU.find((e) => e.value === "group:media")?.label, "Image, video, audio or file...");
});

test("a new download has the file, a starting title, and nothing the author has not written", () => {
  const m = fresh();
  const o = m.addDownload("assets/documents/course-guide.pdf")!;
  assert.equal(o.type, "download");
  assert.equal(m.object?.id, o.id, "it is selected");
  assert.deepEqual(content(m), { src: "assets/documents/course-guide.pdf", title: "Course guide", description: "", accessibleConfirmed: false });
  assert.equal(o.accessibility.altText, "", "alt text is never filled in for the author");
  assert.ok((o.accessibility.tabOrder ?? 0) >= 1, "it is a link, so it can be reached by keyboard");
  assert.equal(o.accessibility.decorative, false);
  assert.equal(o.narration, null);
  assert.ok(newDownload({ id: "obj-0099", z: 1, tabOrder: 4 } as never, "assets/documents/x.pdf").geometry.width > 0);
});

test("the description, the name and the confirmation each change on their own, and undo takes them back", () => {
  const m = fresh();
  const o = m.addDownload("assets/documents/course-guide.pdf")!;
  assert.equal(m.setDownloadDescription(o.id, "  A four page guide.\r\n\r\nHow it is graded.  "), "Description updated");
  assert.equal(content(m).description, "A four page guide.\n\nHow it is graded.", "ends trimmed and line endings made plain");
  assert.equal(m.setDownloadDescription(o.id, "A four page guide.\n\nHow it is graded."), null, "the same words change nothing");
  assert.equal(m.setDownloadTitle(o.id, "Course guide, 2026"), "Name updated");
  assert.equal(m.setDownloadConfirmed(o.id, true), "You have said this file is accessible");
  assert.equal(m.setDownloadConfirmed(o.id, true), null);
  assert.equal(content(m).accessibleConfirmed, true);
  assert.equal(m.setDownloadConfirmed(o.id, false), "Accessibility is not confirmed");
  m.undo();
  assert.equal(content(m).accessibleConfirmed, true, "undo puts the confirmation back");
  m.undo(); m.undo(); m.undo();
  assert.equal(content(m).description, "", "and undoing the rest takes the description away again");
});

test("a blank name or description is allowed while writing but is said plainly, so the author knows", () => {
  const m = fresh();
  const o = m.addDownload("assets/documents/g.pdf")!;
  m.setDownloadDescription(o.id, "Something.");
  assert.match(m.setDownloadDescription(o.id, "   ")!, /Learners need to know what the file is/);
  assert.equal(content(m).description, "");
  assert.match(m.setDownloadTitle(o.id, "")!, /needs one/);
});

test("typing quickly in the description is one undo step, like any other text", () => {
  const m = fresh();
  const o = m.addDownload("assets/documents/g.pdf")!;
  m.setDownloadDescription(o.id, "A");
  m.setDownloadDescription(o.id, "A guide");
  m.setDownloadDescription(o.id, "A guide to the course");
  m.undo();
  assert.equal(content(m).description, "", "all three edits undo together");
});

test("using a different file keeps the author's words and says so", () => {
  const m = fresh();
  const o = m.addDownload("assets/documents/a.pdf")!;
  m.setDownloadDescription(o.id, "My words.");
  const msg = m.setDownloadFile(o.id, "assets/documents/b.docx")!;
  assert.match(msg, /^Now offers b\.docx\./);
  assert.equal(content(m).src, "assets/documents/b.docx");
  assert.equal(content(m).description, "My words.");
  assert.equal(m.setDownloadFile(o.id, "assets/documents/b.docx"), null);
  m.setAccessibility(o.id, { altText: "x" });
  m.narrateDownloadFromText(o.id);
  assert.match(m.setDownloadFile(o.id, "assets/documents/c.pdf")!, /Check that the description and the narration still fit it\.$/, "narration does not follow the file, so the author is told");
});

test("the setters do nothing to an object that is not a download", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  assert.equal(m.setDownloadDescription(t.id, "x"), null);
  assert.equal(m.setDownloadTitle(t.id, "x"), null);
  assert.equal(m.setDownloadConfirmed(t.id, true), null);
  assert.equal(m.setDownloadFile(t.id, "assets/documents/x.pdf"), null);
  assert.equal(m.narrateDownloadFromText(t.id), null);
});

test("narration for a download says its name, what it is, its kind and how to save it, and waits for the description", () => {
  const m = fresh();
  const o = m.addDownload("assets/documents/course-guide.pdf")!;
  assert.match(m.narrateDownloadFromText(o.id)!, /Write the description first/);
  assert.equal(o.narration, null, "nothing is made up before the author has described the file");
  m.setDownloadDescription(o.id, "A four page guide to the course.\n\nHow it is graded");
  assert.equal(m.narrateDownloadFromText(o.id), `Added narration to ${o.name}`);
  const say = (m.object!.narration as Narration).script;
  assert.equal(say, `Course guide. A four page guide to the course. How it is graded. Type of file: PDF document. ${DOWNLOAD_HELP}`);
  assert.equal(m.narrateDownloadFromText(o.id), "The narration already says what the file shows.");
  m.setDownloadDescription(o.id, "A short guide.");
  assert.equal(m.narrateDownloadFromText(o.id), "Narration updated", "asking again follows the new description");
});

test("the narration words for a file are plain sentences", () => {
  assert.equal(downloadScript({ title: "Data", description: "Raw scores", src: "assets/documents/x.XLSX" }), `Data. Raw scores. Type of file: Excel spreadsheet. ${DOWNLOAD_HELP}`);
  assert.equal(downloadScript({ title: "", description: "Does it work?", src: "assets/documents/x.mystery" }), `Does it work? Type of file: File. ${DOWNLOAD_HELP}`);
});

test("the editor offers the same kinds of file as the shared list", () => {
  assert.ok(DOWNLOAD_EXTENSIONS.includes("pdf") && DOWNLOAD_EXTENSIONS.includes("docx") && DOWNLOAD_EXTENSIONS.includes("doc"));
});

// ---- the real validator

type Finding = { severity: string; rule: string; message: string };

function validate(m: Model, fileText = "%PDF-1.7 stand-in"): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-dl-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    mkdirSync(path.join(dir, "assets", "documents"), { recursive: true });
    writeFileSync(path.join(dir, "assets", "documents", "course-guide.pdf"), fileText);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the real validator asks for a name, a description and the confirmation, and then is satisfied", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  const o = m.addDownload("assets/documents/course-guide.pdf")!;
  const rules = (f: Finding[]) => f.filter((x) => x.severity === "error").map((x) => x.rule);
  assert.deepEqual(rules(validate(m)).filter((r) => r !== "alt-text-missing"), ["download-description-missing", "download-unconfirmed"]);
  assert.ok(rules(validate(m)).includes("alt-text-missing"), "the name for screen readers is asked for too");
  m.setAccessibility(o.id, { altText: "Course guide, a PDF to download" });
  m.setDownloadDescription(o.id, "A four page guide to the course.");
  assert.deepEqual(rules(validate(m)), ["download-unconfirmed"]);
  m.setDownloadConfirmed(o.id, true);
  assert.deepEqual(rules(validate(m)), []);
  m.setDownloadTitle(o.id, "");
  assert.deepEqual(rules(validate(m)), ["download-title-missing"]);
});

test("a download whose file has gone is reported", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  const o = m.addDownload("assets/documents/missing.pdf")!;
  m.setAccessibility(o.id, { altText: "x" });
  m.setDownloadDescription(o.id, "x");
  m.setDownloadConfirmed(o.id, true);
  assert.ok(validate(m).some((f) => f.rule === "asset-missing"));
});
