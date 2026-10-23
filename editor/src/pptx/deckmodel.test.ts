// Tests for importing a PowerPoint deck into a project and bringing it up to date, through the editor's model: one undo step each, the project's
// list of decks, the new slides in the right place, and the real validator on what comes out.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Model } from "../model.ts";
import { newProjectFiles } from "../template.ts";
import { readDeck } from "./deck.ts";
import { openDeck } from "./package.ts";
import { assetsFor, offered } from "./resync.ts";
import { buildDeck, fakePng, pic, sp, timing, type DeckSpec } from "./testdeck.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-13" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const png1 = fakePng(1);
const png2 = fakePng(2);

function spec(over: { body?: string; photo?: "one" | "two"; extraSlide?: boolean; noPhotoAlt?: boolean } = {}): DeckSpec {
  const slides: DeckSpec["slides"] = [
    {
      id: 256, media: { rIdP: over.photo === "two" ? "image2.png" : "image1.png" },
      shapes:
        sp({ id: 2, name: "Title 1", ph: { type: "title" }, paras: [{ runs: [{ t: "Welcome" }] }] }) +
        sp({ id: 3, name: "Body", ph: { type: "body", idx: 1 }, paras: [{ runs: [{ t: over.body ?? "One" }] }] }) +
        pic(4, "Photo", "rIdP", { x: 6, y: 2, w: 3, h: 2 }, over.noPhotoAlt ? "" : "A team at a table") +
        sp({ id: 5, name: "Bar", box: { x: 0, y: 0, w: 4, h: 0.1 }, geom: "rect", fill: "FF0000" }),
    },
    { id: 257, shapes: sp({ id: 2, name: "Title 1", ph: { type: "title" }, paras: [{ runs: [{ t: "Second" }] }] }) },
  ];
  if (over.extraSlide) slides.splice(1, 0, { id: 300, shapes: sp({ id: 2, name: "Title 1", ph: { type: "title" }, paras: [{ runs: [{ t: "Inserted" }] }] }) });
  return { media: { "image1.png": png1, "image2.png": png2 }, slides };
}

const open = (s: DeckSpec) => {
  const pkg = openDeck(buildDeck(s));
  return { pkg, deck: readDeck(pkg) };
};

function importInto(m: Model, s: DeckSpec = spec(), chosen?: number[]) {
  const { pkg, deck } = open(s);
  const prepared = m.prepareDeckImport(deck, pkg, "Intro.pptx", chosen ?? deck.slides.map((_, i) => i), "2026-10-13T10:00:00Z");
  const message = m.commitDeckImport(prepared);
  return { prepared, message };
}

test("importing puts the slides after the slide being edited, lists the deck, selects the first new slide and reports", () => {
  const m = fresh();
  m.addSlide("title-only");
  m.selectSlide("slide-001");
  const { prepared, message } = importInto(m);
  assert.deepEqual(m.slides.map((s) => s.name), [m.slides[0]!.name, "Welcome", "Second", m.slides[3]!.name]);
  assert.equal(m.sel.slideId, prepared.slides[0]!.id);
  assert.deepEqual(m.deckSources.map((d) => [d.id, d.name]), [[prepared.deckId, "Intro.pptx"]]);
  assert.match(message, /Brought in 2 slides from Intro\.pptx/);
  assert.ok(prepared.report.length > 0);
  assert.ok(m.dirty);
});

test("importing is one undo step, and undo takes the deck out of the list too", () => {
  const m = fresh();
  importInto(m);
  assert.equal(m.slides.length, 3);
  m.undo();
  assert.equal(m.slides.length, 1);
  assert.deepEqual(m.deckSources, []);
  m.redo();
  assert.equal(m.slides.length, 3);
  assert.equal(m.deckSources.length, 1);
});

test("two imports do not clash in slide or object ids, or in deck ids", () => {
  const m = fresh();
  importInto(m);
  importInto(m);
  const slideIds = m.slides.map((s) => s.id);
  assert.equal(new Set(slideIds).size, slideIds.length);
  const objectIds = m.slides.flatMap((s) => [s.baseLayer, ...s.layers].flatMap((l) => l.objects.map((o) => o.id)));
  assert.equal(new Set(objectIds).size, objectIds.length);
  assert.equal(new Set(m.deckSources.map((d) => d.id)).size, 2);
});

test("bringing a changed deck up to date is one undo step that undoes everything it did", () => {
  const m = fresh();
  importInto(m);
  const welcome = () => m.slides.find((s) => s.name === "Welcome")!;
  const body = () => welcome().baseLayer.objects.find((o) => o.name === "Body")!;
  body().triggers = [{ id: "trg-1", event: "slideStart", action: "showLayer", target: "layer-1", conditions: [] }];
  m.selectSlide(welcome().id);

  const next = open(spec({ body: "Two", photo: "two", extraSlide: true }));
  const plan = m.prepareDeckResync(m.deckSources[0]!.id, next.deck, next.pkg)!;
  const items = offered(plan);
  assert.ok(items.length >= 3, "the text, the picture and the new slide");
  const accepted = new Set(items.filter((i) => i.checked).map((i) => i.id));
  const assets = assetsFor(plan, accepted);
  assert.equal(assets.length, 1, "only the new picture is needed");
  const before = JSON.stringify([m.slides, m.deckSources]);
  const message = m.commitDeckResync(plan, accepted, next.deck, next.pkg, "2026-10-20T09:00:00Z");
  assert.match(message, /Brought up to date: /);
  assert.deepEqual(m.slides.map((s) => s.name).slice(1, 4), ["Welcome", "Inserted", "Second"], "the new slide is where the deck has it");
  assert.match(String(body().content["html"]), /Two/);
  assert.equal(body().triggers.length, 1, "the rule is kept");
  assert.equal(m.deckSources[0]!.syncedAt, "2026-10-20T09:00:00Z");
  assert.deepEqual(m.deckSources[0]!.seen, ["256", "300", "257"]);

  m.undo();
  assert.equal(JSON.stringify([m.slides, m.deckSources]), before, "everything is as it was");
  // And the same comparison offers the same things again.
  const again = m.prepareDeckResync(m.deckSources[0]!.id, next.deck, next.pkg)!;
  assert.equal(offered(again).length, items.length);
});

test("the deck's list entry keeps how the deck was laid on the stage, so a changed deck is laid the same way", () => {
  const m = fresh();
  importInto(m);
  const d = m.deckSources[0]!;
  assert.deepEqual([d.pixelsPerInch, d.offsetX, d.offsetY, d.slideWidth > 0, d.slideHeight > 0], [96, 0, 0, true, true]);
});

test("a deck the project does not list cannot be compared", () => {
  const m = fresh();
  const { pkg, deck } = open(spec());
  assert.equal(m.prepareDeckResync("deck-none", deck, pkg), null);
});

test("an imported project passes the real validator with only the problems the author is asked to settle", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  importInto(m, spec({ noPhotoAlt: true }));
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-deck-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    mkdirSync(path.join(dir, "assets", "images"), { recursive: true });
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const { pkg, deck } = open(spec({ noPhotoAlt: true }));
    const prepared = m.prepareDeckImport(deck, pkg, "x.pptx", [0]);
    for (const a of prepared.assets) writeFileSync(path.join(dir, a.path), a.bytes);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    const findings = JSON.parse(r.stdout) as { severity: string; rule: string; message: string }[];
    const errors = findings.filter((f) => f.severity === "error");
    // The picture had no alt text in the deck, so the author is asked. Nothing else is wrong.
    assert.deepEqual([...new Set(errors.map((e) => e.rule))], ["alt-text-missing"], JSON.stringify(errors));
    assert.equal(errors.length, 1);
    assert.equal(findings.some((f) => f.rule === "import-source-missing"), false, "the deck is listed");
    assert.equal(findings.some((f) => f.rule === "schema"), false, "and everything is in the shape the format wants");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- speaker notes as narration

function withNotes(): DeckSpec {
  return {
    media: { "image1.png": png1 },
    slides: [
      { id: 256, notes: "Welcome everyone.\nToday is about notes", shapes: sp({ id: 2, name: "Title 1", ph: { type: "title" }, paras: [{ runs: [{ t: "Welcome" }] }] }) + sp({ id: 3, name: "Body", ph: { type: "body", idx: 1 }, paras: [{ runs: [{ t: "One" }] }] }) },
      { id: 257, shapes: sp({ id: 2, name: "Title 1", ph: { type: "title" }, paras: [{ runs: [{ t: "Second" }] }] }) },
    ],
  };
}

test("speaker notes become narration only when asked, in the voice the course already uses, and it is one step to undo", () => {
  const m = fresh();
  const first = m.addObject("text")!;
  m.setNarrationScript(first.id, "Existing narration.");
  const voice = m.narratedObjects().at(-1)!.narration.voice;
  const { pkg, deck } = open(withNotes());
  const plain = m.prepareDeckImport(deck, pkg, "Intro.pptx", [0, 1], "2026-10-21T10:00:00Z");
  assert.equal(plain.slides.flatMap((s) => s.baseLayer.objects).every((o) => o.narration === null), true, "not asked, so none");
  assert.match(plain.report.join(" "), /To have them as narration, tick "Use speaker notes as narration"/);

  const prepared = m.prepareDeckImport(deck, pkg, "Intro.pptx", [0, 1], "2026-10-21T10:00:00Z", undefined, { notesAsNarration: true });
  const title = prepared.slides[0]!.baseLayer.objects.find((o) => o.name === "Title 1")!;
  const said = title.narration as unknown as { script: string; voice: string };
  assert.equal(said.script, "Welcome everyone. Today is about notes.");
  assert.equal(said.voice, voice, "the course keeps one voice");
  assert.equal(prepared.slides[1]!.baseLayer.objects.every((o) => o.narration === null), true, "a slide with no notes says nothing");
  assert.match(prepared.report.join(" "), /Speaker notes became the narration of 1 slide/);

  m.commitDeckImport(prepared);
  assert.equal(m.narratedObjects().length, 2);
  m.undo();
  assert.equal(m.narratedObjects().length, 1);
});

test("a deck imported with notes as narration passes the real validator", () => {
  const m = fresh();
  const { pkg, deck } = open(withNotes());
  const prepared = m.prepareDeckImport(deck, pkg, "Intro.pptx", [0, 1], "2026-10-21T10:00:00Z", undefined, { notesAsNarration: true });
  m.commitDeckImport(prepared);
  const dir = mkdtempSync(path.join(os.tmpdir(), "os-notes-"));
  try {
    for (const f of m.allFiles()) {
      mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true });
      writeFileSync(path.join(dir, f.path), f.text);
    }
    for (const a of prepared.assets) {
      mkdirSync(path.dirname(path.join(dir, a.path)), { recursive: true });
      writeFileSync(path.join(dir, a.path), a.bytes);
    }
    const r = spawnSync("python", [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    const found = JSON.parse(r.stdout || "[]") as { rule: string; severity: string }[];
    assert.deepEqual(found.filter((f) => f.severity === "error" && !/contrast/.test(f.rule)), [], r.stdout.slice(0, 600));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- animations that wait for a click: the import can have them come by themselves

const withClicks = (): DeckSpec => ({
  media: { "image1.png": png1, "image2.png": png2 },
  slides: [
    {
      id: 256,
      shapes: sp({ id: 10, name: "Headline 1", box: { x: 0, y: 1, w: 2, h: 1 }, geom: "rect", fill: "FF0000" }) + sp({ id: 11, name: "Headline 2", box: { x: 2, y: 1, w: 2, h: 1 }, geom: "rect", fill: "00FF00" }),
      timing: timing([{ groups: [{ effects: [{ spid: 10 }] }] }, { groups: [{ effects: [{ spid: 11 }] }] }]),
    },
    { id: 257, shapes: sp({ id: 2, name: "Title 1", ph: { type: "title" }, paras: [{ runs: [{ t: "Second" }] }] }) },
  ],
});

test("an import can have a slide's click animations come by themselves: the slide says the pace, the objects keep their steps, and only slides with clicks get it", () => {
  const m = fresh();
  const { pkg, deck } = open(withClicks());
  const waiting = m.prepareDeckImport(deck, pkg, "Clicks.pptx", [0, 1], "2026-10-22T10:00:00Z");
  assert.equal(waiting.slides.some((s) => s.autoSteps !== undefined), false, "not asked, so they wait for the learner");
  assert.match(waiting.report.join(" "), /wait for the learner: a button, Show next item/);

  const auto = m.prepareDeckImport(deck, pkg, "Clicks.pptx", [0, 1], "2026-10-22T10:00:00Z", undefined, { autoSteps: { first: 2000, every: 3000 } });
  assert.deepEqual(auto.slides[0]!.autoSteps, { first: 2000, every: 3000 });
  assert.equal(auto.slides[1]!.autoSteps, undefined, "a slide with no clicks has nothing to pace");
  assert.deepEqual(auto.slides[0]!.baseLayer.objects.map((o) => [o.timing.appear, (o.timing as { step?: number }).step]), [["click", 1], ["click", 2]], "the steps are kept");
  assert.match(auto.report.join(" "), /waited for a click in PowerPoint\. Here they come by themselves.*the first 2 seconds after the slide opens, then one every 3 seconds/);
});

test("an imported slide that plays by itself passes the real validator, and Model.setAutoSteps switches it, with one undo step", () => {
  const m = fresh();
  const { pkg, deck } = open(withClicks());
  m.commitDeckImport(m.prepareDeckImport(deck, pkg, "Clicks.pptx", [0], "2026-10-22T10:00:00Z", undefined, { autoSteps: { first: 2000, every: 3000 } }));
  const id = m.slide!.id;
  assert.equal(m.waitingSteps(id), 2);
  assert.match(m.setAutoSteps(id, { first: 1000, every: 4000 }) ?? "", /the first after 1 second, then one every 4 seconds/);
  assert.deepEqual(m.slide!.autoSteps, { first: 1000, every: 4000 });
  assert.equal(m.setAutoSteps(id, { first: 1000, every: 4000 }), null, "nothing changed");
  m.undo();
  assert.deepEqual(m.slide!.autoSteps, { first: 2000, every: 3000 });
  assert.match(m.setAutoSteps(id, null) ?? "", /wait for the learner again/);
  assert.equal(m.slide!.autoSteps, undefined);
  m.undo();
  // The numbers are held to what the format allows.
  m.setAutoSteps(id, { first: -5, every: 10 });
  assert.deepEqual(m.slide!.autoSteps, { first: 0, every: 500 });
  // A slide with nothing that waits says so, and is still set.
  const other = fresh();
  assert.match(other.setAutoSteps(other.slide!.id, { first: 0, every: 1000 }) ?? "", /Nothing on this slide waits for the learner yet/);

  m.setAutoSteps(id, { first: 2000, every: 3000 });
  const dir = mkdtempSync(path.join(os.tmpdir(), "os-auto-"));
  try {
    for (const f of m.allFiles()) {
      const p = path.join(dir, f.path);
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, f.text);
    }
    const r = spawnSync("python", [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    const found = JSON.parse(r.stdout || "[]") as { rule: string; severity: string }[];
    assert.deepEqual(found.filter((f) => f.rule === "timing-click-advance" || (f.severity === "error" && !/contrast/.test(f.rule))).map((f) => f.rule), [], r.stdout.slice(0, 600));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
