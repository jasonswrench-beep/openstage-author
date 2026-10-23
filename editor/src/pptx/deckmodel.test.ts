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

// ---- bringing animation and speaker notes forward when the deck changes

type Eff = Parameters<typeof timing>[0];
const headlines = (steps: Eff, extra = ""): DeckSpec => ({
  media: { "image1.png": png1 },
  slides: [
    {
      id: 256,
      shapes: sp({ id: 10, name: "Headline 1", box: { x: 0, y: 1, w: 2, h: 1 }, geom: "rect", fill: "FF0000" }) + sp({ id: 11, name: "Headline 2", box: { x: 2, y: 1, w: 2, h: 1 }, geom: "rect", fill: "00FF00" }) + extra,
      timing: timing(steps),
    },
  ],
});
const clickFor = (spid: number, extra: Partial<Parameters<typeof timing>[0][0]["groups"][0]["effects"][0]> = {}) => ({ groups: [{ effects: [{ spid, ...extra }] }] });
const importDeck = (m: Model, s: DeckSpec, options: { notesAsNarration?: boolean } = {}) => {
  const { pkg, deck } = open(s);
  m.commitDeckImport(m.prepareDeckImport(deck, pkg, "Headlines.pptx", deck.slides.map((_, i) => i), "2026-10-23T10:00:00Z", undefined, options));
};
const resync = (m: Model, s: DeckSpec) => {
  const next = open(s);
  const plan = m.prepareDeckResync(m.deckSources[0]!.id, next.deck, next.pkg)!;
  return { plan, next, items: offered(plan) };
};
const accept = (m: Model, r: ReturnType<typeof resync>, pick: (label: string) => boolean = () => true) => {
  const ticked = new Set(r.items.filter((i) => pick(i.label)).map((i) => i.id));
  return m.commitDeckResync(r.plan, ticked, r.next.deck, r.next.pkg, "2026-10-23T12:00:00Z");
};
const slideHeadlines = (m: Model) => m.slides.find((s) => s.baseLayer.objects.some((o) => o.name === "Headline 1"))!;
const byName = (m: Model, name: string) => slideHeadlines(m).baseLayer.objects.find((o) => o.name === name)!;
const baseAnimation = (m: Model) => (slideHeadlines(m).provenance as unknown as { base: { animation?: Record<string, { timing: { appear: string; step?: number } }> } }).base.animation;

test("the import records what it gave each shape's timing and animation, to compare with later", () => {
  const m = fresh();
  importDeck(m, headlines([clickFor(10), clickFor(11, { preset: 10 })]));
  const rec = baseAnimation(m)!;
  assert.deepEqual(Object.keys(rec).sort(), ["10", "11"]);
  assert.deepEqual(rec["10"]!.timing, byName(m, "Headline 1").timing);
});

test("a change the deck made to the animation of something the author did not touch comes forward, in one undo step", () => {
  const m = fresh();
  importDeck(m, headlines([clickFor(10), clickFor(11)]));
  // The deck swaps the two clicks, and takes the first away at a third click.
  const r = resync(m, headlines([clickFor(11), clickFor(10), clickFor(10, { cls: "exit", preset: 10 })]));
  const item = r.items.find((i) => /Bring the animation forward/.test(i.label))!;
  assert.ok(item, r.items.map((i) => i.label).join(" | "));
  assert.equal(item.checked, true);
  assert.equal(item.replacesYours, false);
  assert.match(item.detail.join(" | "), /Headline 1: Appears when the learner shows item 1, then stays becomes Appears when the learner shows item 2, then goes away when the learner shows item 3 \(goes with fade\)/);
  const message = accept(m, r);
  assert.match(message, /animation changed on 2 objects/);
  assert.deepEqual(byName(m, "Headline 1").timing, { appear: "click", step: 2, start: 0, visibleFor: null, until: { step: 3, start: 0 } });
  assert.deepEqual(byName(m, "Headline 2").timing, { appear: "click", step: 1, start: 0, visibleFor: null });
  assert.equal(byName(m, "Headline 1").animation.exit.effect, "fade");
  assert.deepEqual(baseAnimation(m)!["10"]!.timing, byName(m, "Headline 1").timing, "the record moved on");
  m.undo();
  assert.deepEqual(byName(m, "Headline 1").timing, { appear: "click", step: 1, start: 0, visibleFor: null }, "one undo step puts it all back");
  assert.deepEqual(baseAnimation(m)!["10"]!.timing, { appear: "click", step: 1, start: 0, visibleFor: null }, "and so does the record");
});

test("an animation the author changed is offered, unticked, as a replacement, and stays offered if it is left", () => {
  const m = fresh();
  importDeck(m, headlines([clickFor(10), clickFor(11)]));
  m.setTiming(byName(m, "Headline 1").id, { start: 1500 }); // the author's own change
  const changed = headlines([clickFor(11), clickFor(10)]);
  const r = resync(m, changed);
  const take = r.items.find((i) => /Bring the animation forward/.test(i.label))!;
  const conflict = r.items.find((i) => /Replace your changes to the timing or animation of "Headline 1"/.test(i.label))!;
  assert.ok(take && conflict);
  assert.deepEqual([take.checked, conflict.checked, conflict.replacesYours], [true, false, true]);
  accept(m, r, (label) => !/Replace your changes/.test(label));
  assert.deepEqual(byName(m, "Headline 2").timing.step, 1, "what the author did not touch came forward");
  assert.equal(byName(m, "Headline 1").timing.start, 1500, "the author's own change stands");
  const again = resync(m, changed);
  assert.ok(again.items.some((i) => /Replace your changes to the timing or animation of "Headline 1"/.test(i.label)), "it is offered again");
  accept(m, again);
  assert.deepEqual(byName(m, "Headline 1").timing, { appear: "click", step: 2, start: 0, visibleFor: null }, "replaced when asked");
  assert.equal(resync(m, changed).items.length, 0, "and then there is nothing to offer");
});

test("an effect the deck took away takes the animation off; a change that is not there offers nothing; a slide imported before the record was kept starts one", () => {
  const m = fresh();
  importDeck(m, headlines([clickFor(10), clickFor(11)]));
  assert.equal(resync(m, headlines([clickFor(10), clickFor(11)])).items.length, 0, "the same deck changes nothing");
  const r = resync(m, headlines([clickFor(10)]));
  assert.ok(r.items.some((i) => /Bring the animation forward/.test(i.label)));
  accept(m, r);
  assert.deepEqual(byName(m, "Headline 2").timing, { appear: "time", start: 0, visibleFor: null });
  assert.deepEqual(byName(m, "Headline 2").animation.enter, { effect: "none", duration: 500 });

  // A slide imported before the record was kept has none: nothing is offered if the object already matches the deck, and the record is made.
  const old = fresh();
  importDeck(old, headlines([clickFor(10), clickFor(11)]));
  delete (slideHeadlines(old).provenance as unknown as { base: { animation?: unknown } }).base.animation;
  const same = resync(old, headlines([clickFor(10), clickFor(11)]));
  assert.equal(same.items.length, 0);
  accept(old, same);
  assert.ok(baseAnimation(old), "the record is made");
  // ... and where it does not match, it is offered unticked, since there is no telling whether the author changed it.
  const older = fresh();
  importDeck(older, headlines([clickFor(10), clickFor(11)]));
  delete (slideHeadlines(older).provenance as unknown as { base: { animation?: unknown } }).base.animation;
  const differs = resync(older, headlines([clickFor(11), clickFor(10)]));
  assert.ok(differs.items.length > 0 && differs.items.every((i) => !i.checked), differs.items.map((i) => `${i.label} ${i.checked}`).join(" | "));
});

test("a shape new in the deck comes with the animation the deck gives it", () => {
  const m = fresh();
  importDeck(m, headlines([clickFor(10), clickFor(11)]));
  const r = resync(m, headlines([clickFor(10), clickFor(11), clickFor(12, { preset: 10 })], sp({ id: 12, name: "Headline 3", box: { x: 4, y: 1, w: 2, h: 1 }, geom: "rect", fill: "0000FF" })));
  assert.ok(r.items.some((i) => /new .* "Headline 3"/.test(i.label)));
  accept(m, r);
  assert.deepEqual(byName(m, "Headline 3").timing, { appear: "click", step: 3, start: 0, visibleFor: null });
  assert.equal(byName(m, "Headline 3").animation.enter.effect, "fade");
  assert.ok(baseAnimation(m)!["12"], "and its record");
});

test("speaker notes that were made the narration come forward when the deck's notes change, keep the voice, and say the audio is to be made again", () => {
  const m = fresh();
  importDeck(m, withNotes(), { notesAsNarration: true });
  const title = () => m.slides.find((s) => s.name === "Welcome")!.baseLayer.objects.find((o) => o.name === "Title 1")!;
  const narration = () => title().narration as unknown as { script: string; voice: string };
  const voice = narration().voice;
  const changed = withNotes();
  changed.slides[0]!.notes = "Welcome, everybody.\nToday is about something else";
  const r = resync(m, changed);
  const item = r.items.find((i) => /speaker notes of the slide "Welcome" changed/.test(i.label))!;
  assert.ok(item, r.items.map((i) => i.label).join(" | "));
  assert.deepEqual([item.checked, item.replacesYours], [true, false]);
  assert.match(item.detail.join(" | "), /Now: "Welcome everyone\. Today is about notes\."/);
  assert.match(item.detail.join(" | "), /The audio for it has to be made again/);
  const message = accept(m, r);
  assert.match(message, /1 narration updated from the speaker notes \(make its audio again\)/);
  assert.equal(narration().script, "Welcome, everybody. Today is about something else.");
  assert.equal(narration().voice, voice, "the voice is kept");
  assert.equal(resync(m, changed).items.length, 0, "and the record moved on");
  // Notes taken out: the narration goes, when asked.
  const gone = withNotes();
  gone.slides[0]!.notes = "";
  const removal = resync(m, gone);
  assert.ok(removal.items.some((i) => /were taken out/.test(i.label)));
  accept(m, removal);
  assert.equal(title().narration, null);
});

test("a narration the author changed is offered, unticked, against the deck's new notes; and notes that were never made narration offer nothing", () => {
  const m = fresh();
  importDeck(m, withNotes(), { notesAsNarration: true });
  const title = () => m.slides.find((s) => s.name === "Welcome")!.baseLayer.objects.find((o) => o.name === "Title 1")!;
  m.setNarrationScript(title().id, "My own words.");
  const changed = withNotes();
  changed.slides[0]!.notes = "Something new in the notes";
  const r = resync(m, changed);
  const item = r.items.find((i) => /Replace your changes to what "Title 1" says/.test(i.label))!;
  assert.ok(item);
  assert.deepEqual([item.checked, item.replacesYours], [false, true]);
  accept(m, r, () => false);
  assert.equal((title().narration as unknown as { script: string }).script, "My own words.", "left as the author wrote it");
  // Notes were not made narration at import: the deck's notes changing offers nothing.
  const plain = fresh();
  importDeck(plain, withNotes());
  assert.equal(resync(plain, changed).items.filter((i) => /speaker notes/.test(i.label)).length, 0);
});

test("the paragraph timing of a text comes forward when the deck changes it, is told in words, and undoes in one step", () => {
  const bullet = (t: string) => ({ runs: [{ t }], bullet: "char" as const });
  const forPara = (i: number, click: number) => ({ groups: [{ effects: [{ spid: 10, preset: 10, para: { from: i, to: i } }] }] }) as { groups: { effects: { spid: number; preset: number; para: { from: number; to: number } }[] }[] };
  const deck = (clicks: number[]): DeckSpec => ({
    slides: [{ id: 256, shapes: sp({ id: 10, name: "Body", box: { x: 1, y: 1, w: 6, h: 3 }, paras: [bullet("One"), bullet("Two"), bullet("Three")] }), timing: timing(clicks.map((c, i) => forPara(i, c)).reduce<Parameters<typeof timing>[0]>((steps, g, i) => {
      // paragraphs that share a click are in the same step
      const same = i > 0 && clicks[i] === clicks[i - 1];
      if (same) steps[steps.length - 1]!.groups.push(...g.groups);
      else steps.push({ groups: [...g.groups] });
      return steps;
    }, [])) }],
  });
  const m = fresh();
  importDeck(m, deck([1, 2, 3]));
  const body = () => m.slides.find((s) => s.baseLayer.objects.some((o) => o.name === "Body"))!.baseLayer.objects.find((o) => o.name === "Body")!;
  assert.deepEqual(body().timing.paragraphs?.map((p) => p.step), [1, 2, 3]);
  assert.deepEqual(baseAnimation_(m, "10"), body().timing, "the record has it, paragraphs and all");
  assert.equal(resync(m, deck([1, 2, 3])).items.length, 0, "the same deck changes nothing");
  const r = resync(m, deck([1, 1, 2]));
  const item = r.items.find((i) => /Bring the animation forward/.test(i.label))!;
  assert.ok(item, r.items.map((i) => i.label).join(" | "));
  assert.match(item.detail.join(" | "), /Body: Shows when the slide opens, then stays\. Comes in one paragraph at a time, items 1 to 3 \(comes in with fade\) becomes Shows when the slide opens, then stays\. Paragraph 1 appears when the learner shows item 1, then stays\. Paragraph 2 appears when the learner shows item 1/);
  accept(m, r);
  assert.deepEqual(body().timing.paragraphs?.map((p) => p.step), [1, 1, 2]);
  m.undo();
  assert.deepEqual(body().timing.paragraphs?.map((p) => p.step), [1, 2, 3]);
  // The author's own change to the paragraphs is a conflict, offered unticked.
  m.setParagraphTiming(body().id, 2, { step: 9 });
  const again = resync(m, deck([1, 1, 2]));
  assert.ok(again.items.some((i) => /Replace your changes to the timing or animation of "Body"/.test(i.label) && !i.checked));
});

/** What the import recorded for a shape's timing, by the shape's number. */
const baseAnimation_ = (m: Model, key: string) => {
  const slide = m.slides.find((s) => s.baseLayer.objects.some((o) => o.name === "Body"))!;
  return (slide.provenance as unknown as { base: { animation?: Record<string, { timing: unknown }> } }).base.animation?.[key]?.timing;
};
