import assert from "node:assert/strict";
import { test } from "node:test";
import { DOWNLOAD_EXTENSIONS, DOWNLOAD_HELP, buildDownload, fileDetails, fileExtension, fileName, fileTypeLabel, sizeText } from "./downloads.ts";
import type { OSObject } from "./types.ts";

test("a file's kind comes from its extension, in any case, and an unknown one is just a file", () => {
  assert.equal(fileExtension("assets/documents/Guide.PDF"), "pdf");
  assert.equal(fileExtension("assets/documents/archive.tar.zip"), "zip");
  assert.equal(fileExtension("assets/documents/noextension"), "");
  assert.equal(fileExtension("assets/documents/.hidden"), "");
  assert.equal(fileTypeLabel("assets/documents/a.pdf"), "PDF document");
  assert.equal(fileTypeLabel("assets/documents/a.DOCX"), "Word document");
  assert.equal(fileTypeLabel("assets/documents/a.doc"), "Word document");
  assert.equal(fileTypeLabel("assets/documents/a.xlsx"), "Excel spreadsheet");
  assert.equal(fileTypeLabel("assets/documents/a.mystery"), "File");
  assert.equal(fileName("assets/documents/my guide.pdf"), "my guide.pdf");
});

test("a size is in words a person can judge", () => {
  assert.equal(sizeText(1), "1 byte");
  assert.equal(sizeText(800), "800 bytes");
  assert.equal(sizeText(1024), "1 KB");
  assert.equal(sizeText(42 * 1024 + 300), "42 KB");
  assert.equal(sizeText(1024 * 1024), "1.0 MB");
  assert.equal(sizeText(Math.round(1.26 * 1024 * 1024)), "1.3 MB");
  assert.equal(fileDetails("assets/documents/a.pdf", 1024 * 1024 * 2), "PDF document, 2.0 MB");
  assert.equal(fileDetails("assets/documents/a.pdf", undefined), "PDF document", "no size is left out, not guessed");
});

test("the kinds of file are the shared list, and nothing that runs is on it", () => {
  for (const ext of ["pdf", "docx", "doc", "xlsx", "pptx", "csv", "txt", "zip"]) assert.ok(DOWNLOAD_EXTENSIONS.includes(ext), ext);
  for (const ext of ["exe", "bat", "cmd", "js", "html", "htm", "ps1", "sh", "msi", "jar", "vbs", "scr", "dll", "svg"]) assert.ok(!DOWNLOAD_EXTENSIONS.includes(ext), ext);
  assert.equal(new Set(DOWNLOAD_EXTENSIONS).size, DOWNLOAD_EXTENSIONS.length, "each once");
});

// ---- the page it draws, on a stand-in for the browser's document, which is all this needs

interface El { tag: string; className: string; textContent: string; id: string; attrs: Map<string, string>; kids: El[]; setAttribute(k: string, v: string): void; append(...k: El[]): void }
const fakeDoc = {
  createElement(tag: string): El {
    const e: El = { tag, className: "", textContent: "", id: "", attrs: new Map(), kids: [], setAttribute(k, v) { e.attrs.set(k, v); }, append(...k) { e.kids.push(...k); } };
    return e;
  },
};
const make = (over: Partial<OSObject["accessibility"]> = {}, content: Record<string, unknown> = {}): OSObject => ({
  id: "obj-0007", type: "download", name: "Download", geometry: { x: 0, y: 0, width: 500, height: 220, rotation: 0, z: 1 },
  content: { src: "assets/documents/course guide.pdf", title: "Course guide", description: "Four pages: what the course covers.\n\nHow it is graded.", accessibleConfirmed: true, ...content },
  style: {}, accessibility: { altText: "Course guide, a PDF", role: "group", tabOrder: 3, decorative: false, ...over },
  states: {}, triggers: [], timing: { appear: "time", start: 0, visibleFor: null }, animation: { enter: { effect: "none", duration: 500 }, exit: { effect: "none", duration: 500 } }, narration: null, provenance: null, simulation: null,
});
const find = (e: El, cls: string): El | undefined => (e.className.split(" ").includes(cls) ? e : e.kids.map((k) => find(k, cls)).find(Boolean));
const draw = (obj: OSObject, editing: boolean, size?: number) => buildDownload(fakeDoc as unknown as Document, obj, { editing, size }) as unknown as El;

test("the published page says what the file is, then offers the download", () => {
  const root = draw(make(), false, 1_200_000);
  assert.equal(root.attrs.get("role"), "group");
  assert.equal(root.attrs.get("aria-label"), "Course guide, a PDF");
  assert.equal(find(root, "os-download-title")!.textContent, "Course guide");
  assert.equal(find(root, "os-download-description")!.textContent, "Four pages: what the course covers.\n\nHow it is graded.");
  assert.equal(find(root, "os-download-details")!.textContent, "PDF document, 1.1 MB");
  assert.equal(find(root, "os-download-help")!.textContent, DOWNLOAD_HELP);
  const link = find(root, "os-download-link")!;
  assert.equal(link.tag, "a");
  assert.equal(link.textContent, "Download Course guide");
  assert.equal(link.attrs.get("href"), "assets/documents/course guide.pdf");
  assert.equal(link.attrs.get("download"), "course guide.pdf", "saved, not opened in place of the course");
  assert.equal(link.attrs.get("target"), undefined, "no new window");
  assert.equal(link.attrs.get("aria-describedby"), "obj-0007-dl-details obj-0007-dl-description", "a screen reader hears the kind and the description after the name");
  assert.equal(find(root, "os-download-details")!.id, "obj-0007-dl-details");
  assert.equal(find(root, "os-download-description")!.id, "obj-0007-dl-description");
});

test("the order on the page is the description first and the link after it", () => {
  const order = draw(make(), false).kids.map((k) => k.className);
  assert.deepEqual(order, ["os-download-title", "os-download-description", "os-download-details", "os-download-link", "os-download-help"]);
});

test("the editor's canvas draws the same but its link cannot go anywhere", () => {
  const root = draw(make(), true);
  const link = find(root, "os-download-link")!;
  assert.equal(link.tag, "span");
  assert.equal(link.attrs.get("href"), undefined);
  assert.equal(link.attrs.get("download"), undefined);
  assert.equal(link.textContent, "Download Course guide");
  assert.equal(find(root, "os-download-details")!.textContent, "PDF document", "the editor does not know the size");
});

test("a decorative flag takes the group's name away, and the name is the author's own words", () => {
  assert.equal(draw(make({ decorative: true, altText: "" }), false).attrs.get("aria-label"), undefined);
  assert.equal(draw(make({ altText: "The syllabus" }), false).attrs.get("aria-label"), "The syllabus");
});
