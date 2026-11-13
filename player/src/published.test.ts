// What a published page carries of the project (src/published.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { publishedCredit, publishedPackage, publishedProject, publishedSlide } from "./published.ts";
import { examplePackage } from "./test-helpers.ts";
import type { CreditEntry, Project, Slide } from "./types.ts";

test("the project keeps what the player reads and loses the author, the decks and what the editable copy leaves out", () => {
  const pkg = examplePackage();
  const project: Project = {
    ...pkg.project,
    meta: { ...pkg.project.meta, author: "Jo Example", modified: "2026-11-13T10:00:00Z", version: "2.1", courseCode: "CMM 360" },
    sources: [{ id: "deck-abc", name: "Private lecture.pptx", importedAt: "2026-11-01T10:00:00Z", slideWidth: 9144000, slideHeight: 5143500, pixelsPerInch: 96, offsetX: 0, offsetY: 0 }] as Project["sources"],
    sourceExclude: ["recordings"],
  };
  const out = publishedProject(project);
  assert.deepEqual(out.meta, { title: project.meta.title, language: project.meta.language, created: project.meta.created });
  assert.equal("sources" in out, false);
  assert.equal("sourceExclude" in out, false);
  assert.deepEqual(out.scenes, project.scenes, "the rest is as it was");
  assert.deepEqual(out.stage, project.stage);
  assert.equal(project.meta.author, "Jo Example", "the project itself is not changed");
});

test("a slide and its objects lose the record of where they were imported or recorded from", () => {
  const slide = examplePackage().slides[0]!;
  const imported: Slide = {
    ...slide,
    provenance: { sourceDeck: "deck-abc", slideId: "256", slideIndex: 0, importedAt: "2026-11-01T10:00:00Z", base: { name: "Old title", background: null } } as Slide["provenance"],
    baseLayer: { ...slide.baseLayer, objects: slide.baseLayer.objects.map((o) => ({ ...o, provenance: { sourceDeck: "deck-abc", slideIndex: 0, shapeId: "4", importedAt: "2026-11-01T10:00:00Z" } })) },
  };
  const out = publishedSlide(imported);
  assert.equal("provenance" in out, false);
  assert.ok(out.baseLayer.objects.length > 0);
  assert.ok(out.baseLayer.objects.every((o) => o.provenance === null));
  assert.equal(JSON.stringify(out).includes("deck-abc"), false);
  assert.deepEqual(out.baseLayer.objects.map((o) => o.id), slide.baseLayer.objects.map((o) => o.id), "the objects themselves are all there");
});

test("a credit for a picture an AI service made keeps who made it and loses the words, the model and the time", () => {
  const entry: CreditEntry = {
    path: "assets/images/a.png", title: "A picture", kind: "image",
    source: { provider: "generated", url: "https://example.org", creator: "An AI service", creatorUrl: "", licence: "", requiresCredit: true,
      generated: { service: "openai", model: "image-model-1", prompt: "a private prompt", madeAt: "2026-11-13T10:00:00Z" } },
  };
  const out = publishedCredit(entry);
  assert.equal("generated" in out.source, false);
  assert.deepEqual({ ...out.source }, { provider: "generated", url: "https://example.org", creator: "An AI service", creatorUrl: "", licence: "", requiresCredit: true });
});

test("the whole package is trimmed the same way, and a package without credits stays without", () => {
  const pkg = examplePackage();
  const out = publishedPackage({ ...pkg, project: { ...pkg.project, meta: { ...pkg.project.meta, author: "Jo Example" } } });
  assert.equal(JSON.stringify(out).includes("Jo Example"), false);
  const { credits: _credits, ...bare } = pkg;
  assert.equal("credits" in publishedPackage(bare), false);
});
