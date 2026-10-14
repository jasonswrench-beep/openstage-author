// Tests for bringing a changed PowerPoint deck up to date: what is offered, what is ticked to begin with, and that nothing the author did is lost.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeckSource, OSObject, Slide } from "../../../player/src/types.ts";
import { readDeck } from "./deck.ts";
import { prepareImport } from "./import.ts";
import { openDeck } from "./package.ts";
import { applyPlan, authorAdded, merge3, offered, planResync, type PlanItem, type ResyncPlan } from "./resync.ts";
import { snapshotOf } from "./convert.ts";
import { buildDeck, fakePng, pic, sp, type DeckSpec } from "./testdeck.ts";
import { hashBytes } from "./hash.ts";

const png1 = fakePng(1);
const png2 = fakePng(2);

interface Variant {
  title?: string;
  bodyLines?: string[];
  bodyBox?: { x: number; y: number; w: number; h: number };
  photo?: "none" | "one" | "two";
  photoBox?: { x: number; y: number; w: number; h: number };
  photoAlt?: string;
  bar?: boolean;
  extra?: boolean;
  second?: boolean;
  secondTitle?: string;
  third?: boolean;
  fourth?: boolean;
  order?: "normal" | "swapped";
  background?: string;
  bgPicture?: boolean;
}

/** A small deck whose parts can each be changed, to stand for the same deck before and after somebody edits it. */
function deckSpec(v: Variant = {}): DeckSpec {
  const first = {
    id: 256,
    media: { rIdP: v.photo === "two" ? "image2.png" : "image1.png" },
    ...(v.background ? { background: v.background } : {}),
    ...(v.bgPicture ? { backgroundPicture: "image1.png" } : {}),
    shapes:
      sp({ id: 2, name: "Title 1", ph: { type: "title" }, paras: [{ runs: [{ t: v.title ?? "Welcome" }] }] }) +
      sp({ id: 3, name: "Body", ph: { type: "body", idx: 1 }, ...(v.bodyBox ? { box: v.bodyBox } : {}), paras: (v.bodyLines ?? ["One", "Two"]).map((t) => ({ runs: [{ t }] })) }) +
      (v.photo === "none" ? "" : pic(4, "Photo", "rIdP", v.photoBox ?? { x: 6, y: 2, w: 3, h: 2 }, v.photoAlt ?? "A team")) +
      (v.bar === false ? "" : sp({ id: 5, name: "Bar", box: { x: 0, y: 0, w: 4, h: 0.1 }, geom: "rect", fill: "FF0000" })) +
      (v.extra ? sp({ id: 6, name: "Note", txBox: true, box: { x: 1, y: 6, w: 4, h: 0.5 }, paras: [{ runs: [{ t: "A new note" }] }] }) : ""),
  };
  const second = { id: 257, shapes: sp({ id: 2, name: "Title 1", ph: { type: "title" }, paras: [{ runs: [{ t: v.secondTitle ?? "Second" }] }] }) + sp({ id: 3, name: "Content", ph: { type: "body", idx: 1 }, paras: [{ runs: [{ t: "Words" }] }] }) };
  const third = { id: 258, shapes: sp({ id: 2, name: "Title 1", ph: { type: "title" }, paras: [{ runs: [{ t: "Third" }] }] }) };
  const fourth = { id: 259, shapes: sp({ id: 2, name: "Title 1", ph: { type: "title" }, paras: [{ runs: [{ t: "Fourth" }] }] }) };
  const slides = [first, ...(v.second === false ? [] : [second]), ...(v.third ? [third] : []), ...(v.fourth ? [fourth] : [])];
  if (v.order === "swapped") slides.reverse();
  return { media: { "image1.png": png1, "image2.png": png2 }, slides };
}

interface Project {
  slides: Slide[];
  source: DeckSource;
}

function importDeck(v: Variant = {}, chosen?: number[], tones?: Map<string, string>): Project {
  const pkg = openDeck(buildDeck(deckSpec(v)));
  const deck = readDeck(pkg);
  let s = 0;
  let o = 0;
  const prepared = prepareImport({
    deck, pkg, fileName: "Intro.pptx", importedAt: "2026-10-13T10:00:00Z", chosen: chosen ?? deck.slides.map((_, i) => i), stage: { width: 1280, height: 720 },
    existingDeckIds: [], ...(tones ? { tones } : {}), newSlideId: () => `slide-${String(++s).padStart(3, "0")}`, newObjectId: () => `obj-${String(++o).padStart(4, "0")}`,
  });
  return { slides: prepared.slides, source: prepared.source };
}

function planFor(project: Project, v: Variant, tones?: Map<string, string>) {
  const pkg = openDeck(buildDeck(deckSpec(v)));
  const deck = readDeck(pkg);
  return { plan: planResync({ source: project.source, slides: project.slides, deck, pkg, ...(tones ? { tones } : {}) }), pkg, deck };
}

let counter = 100;
function apply(project: Project, plan: ResyncPlan, accepted: string[], pkg: ReturnType<typeof openDeck>, deck: ReturnType<typeof readDeck>) {
  return applyPlan(plan, new Set(accepted), {
    slides: project.slides, source: project.source, importedAt: "2026-10-20T10:00:00Z", pkg, deck,
    newSlideId: () => `slide-${++counter}`, newObjectId: () => `obj-${++counter}`,
  });
}

const objectsOf = (s: Slide): OSObject[] => [s.baseLayer, ...s.layers].flatMap((l) => l.objects);
const find = (project: Project, slide: string, name: string): OSObject => objectsOf(project.slides.find((s) => s.name === slide)!).find((o) => o.name === name)!;
const html = (o: OSObject) => String(o.content["html"]);
const tick = (plan: ResyncPlan) => offered(plan).filter((i) => i.checked).map((i) => i.id);
const labels = (plan: ResyncPlan) => offered(plan).map((i) => i.label);

// ---- importing

test("importing a deck makes slides and objects that say where they came from, and a list entry for the deck", () => {
  const p = importDeck();
  assert.deepEqual(p.slides.map((s) => [s.name, objectsOf(s).length]), [["Welcome", 4], ["Second", 2]]);
  assert.equal(p.source.id.startsWith("deck-"), true);
  assert.deepEqual(p.source.seen, ["256", "257"]);
  assert.deepEqual([p.source.pixelsPerInch, p.source.offsetX], [96, 0]);
  const body = find(p, "Welcome", "Body");
  assert.equal(html(body), "<ul><li>One</li><li>Two</li></ul>");
  const prov = body.provenance as unknown as { sourceDeck: string; shapeId: string; base: unknown };
  assert.deepEqual([prov.sourceDeck, prov.shapeId], [p.source.id, "256/3"]);
  assert.deepEqual(prov.base, snapshotOf(body));
  const sp0 = p.slides[0]!.provenance as unknown as { base: { shapes: string[] } };
  assert.deepEqual(sp0.base.shapes, ["2", "3", "4", "5"]);
});

test("only the chosen slides come in, and the others are still known to the deck's list", () => {
  const p = importDeck({}, [1]);
  assert.deepEqual(p.slides.map((s) => s.name), ["Second"]);
  assert.deepEqual(p.source.seen, ["256", "257"]);
});

// ---- a deck that has not changed

test("a deck that has not changed offers nothing", () => {
  const p = importDeck();
  const { plan } = planFor(p, {});
  assert.deepEqual(offered(plan), []);
  assert.equal(plan.unchanged, 6);
  assert.equal(plan.warning, null);
  assert.equal(plan.orderChanged, false);
});

// ---- changes the author never touched come forward

test("text the deck changed, on a shape the author left alone, is offered and ticked, and comes forward without touching what the author added", () => {
  const p = importDeck();
  const body = find(p, "Welcome", "Body");
  // The author's own work on that shape.
  body.triggers = [{ id: "trg-1", event: "click", action: "showLayer", target: "layer-1", conditions: [] }];
  body.narration = { script: "Read this", voice: "af_heart", speed: 1, lang: "en-US", pronunciations: [] } as unknown as OSObject["narration"];
  body.timing = { appear: "time", start: 2000, visibleFor: null };
  const { plan, pkg, deck } = planFor(p, { bodyLines: ["One", "Two", "Three"] });
  assert.equal(offered(plan).length, 1);
  const item = offered(plan)[0]!;
  assert.match(item.label, /Update "Body" on the slide "Welcome" \(text\)\./, "the alt text of a text box is its words, so it is not a separate change");
  assert.equal(item.checked, true);
  assert.match(item.detail.join(" "), /One Two/);
  apply(p, plan, tick(plan), pkg, deck);
  const now = find(p, "Welcome", "Body");
  assert.equal(html(now), "<ul><li>One</li><li>Two</li><li>Three</li></ul>");
  assert.equal(now.id, body.id, "the same object");
  assert.equal(now.triggers.length, 1, "the rule is still there");
  assert.ok(now.narration, "and the narration");
  assert.equal(now.timing.start, 2000, "and the timing");
  // After a full update the next comparison finds nothing to do.
  assert.deepEqual(offered(planFor(p, { bodyLines: ["One", "Two", "Three"] }).plan), []);
});

test("changes to different parts of one shape are all offered together, and each can be taken", () => {
  const p = importDeck();
  const { plan, pkg, deck } = planFor(p, { bodyLines: ["One"], bodyBox: { x: 1, y: 1, w: 5, h: 3 } });
  const item = offered(plan)[0]!;
  assert.match(item.label, /\(position and size, text\)/);
  apply(p, plan, [item.id], pkg, deck);
  const now = find(p, "Welcome", "Body");
  assert.equal(html(now), "<ul><li>One</li></ul>");
  assert.deepEqual([now.geometry.x, now.geometry.y, now.geometry.width, now.geometry.height], [96, 96, 480, 288]);
});

// ---- the author changed it too

test("the author's change to one part and the deck's change to another do not clash", () => {
  const p = importDeck();
  find(p, "Welcome", "Photo").accessibility.altText = "My own description";
  const { plan, pkg, deck } = planFor(p, { photoBox: { x: 7, y: 2, w: 3, h: 2 } });
  assert.equal(offered(plan).length, 1);
  assert.equal(offered(plan)[0]!.replacesYours, false);
  apply(p, plan, tick(plan), pkg, deck);
  const now = find(p, "Welcome", "Photo");
  assert.equal(now.geometry.x, 672, "moved as the deck moved it");
  assert.equal(now.accessibility.altText, "My own description", "and the author's alt text is kept");
});

test("when the author and the deck both changed the same thing, the deck's is not applied unless asked", () => {
  const p = importDeck();
  setHtml(find(p, "Welcome", "Body"), "<p>My own words</p>");
  const { plan, pkg, deck } = planFor(p, { bodyLines: ["Deck words"] });
  const items = offered(plan);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.replacesYours, true);
  assert.equal(items[0]!.checked, false);
  assert.match(items[0]!.label, /Replace your changes to "Body"/);
  // Left alone, the author's words stay and the conflict is still there next time.
  const before = (find(p, "Welcome", "Body").provenance as unknown as { sourceHash: string }).sourceHash;
  apply(p, plan, tick(plan), pkg, deck);
  assert.equal(html(find(p, "Welcome", "Body")), "<p>My own words</p>");
  assert.equal((find(p, "Welcome", "Body").provenance as unknown as { sourceHash: string }).sourceHash, before, "still marked as changed in the deck");
  const again = planFor(p, { bodyLines: ["Deck words"] }).plan;
  assert.equal(offered(again).length, 1);
  // Asked to, the deck's wins.
  apply(p, again, [offered(again)[0]!.id], pkg, deck);
  assert.equal(html(find(p, "Welcome", "Body")), "<ul><li>Deck words</li></ul>");
  assert.deepEqual(offered(planFor(p, { bodyLines: ["Deck words"] }).plan), []);
});

function setHtml(o: OSObject, text: string) {
  o.content = { ...o.content, html: text };
}

test("something the author changed to exactly what the deck now says needs nothing", () => {
  const p = importDeck();
  setHtml(find(p, "Welcome", "Body"), "<ul><li>Same</li></ul>");
  const { plan } = planFor(p, { bodyLines: ["Same"] });
  assert.deepEqual(offered(plan), []);
});

test("a change left unticked is offered again next time", () => {
  const p = importDeck();
  const { plan, pkg, deck } = planFor(p, { title: "Welcome, everyone" });
  assert.equal(offered(plan).length, 2, "the title, and the slide's name that follows it");
  apply(p, plan, [], pkg, deck);
  assert.equal(html(find(p, "Welcome", "Title 1")), "<h1>Welcome</h1>");
  assert.equal(offered(planFor(p, { title: "Welcome, everyone" }).plan).length, 2);
});

// ---- shapes added and removed

test("a new shape in the deck is offered and added at the end with its own tab number and where it came from", () => {
  const p = importDeck();
  const { plan, pkg, deck } = planFor(p, { extra: true });
  const items = offered(plan);
  assert.equal(items.length, 1);
  assert.match(items[0]!.label, /new text box on the slide "Welcome", "Note"/);
  const tabs = objectsOf(p.slides[0]!).map((o) => o.accessibility.tabOrder ?? 0);
  const result = apply(p, plan, tick(plan), pkg, deck);
  assert.equal(result.counts.shapesAdded, 1);
  const added = find(p, "Welcome", "Note");
  assert.equal(added.accessibility.tabOrder, Math.max(...tabs) + 1);
  assert.equal((added.provenance as unknown as { shapeId: string }).shapeId, "256/6");
  assert.ok((p.slides[0]!.provenance as unknown as { base: { shapes: string[] } }).base.shapes.includes("6"));
  assert.deepEqual(offered(planFor(p, { extra: true }).plan), [], "and it is not offered again");
});

test("a shape the author deleted is not brought back, even though the deck still has it", () => {
  const p = importDeck();
  p.slides[0]!.baseLayer.objects = p.slides[0]!.baseLayer.objects.filter((o) => o.name !== "Bar");
  assert.deepEqual(offered(planFor(p, {}).plan), []);
  assert.deepEqual(offered(planFor(p, { bodyLines: ["Changed"] }).plan).map((i) => i.label.startsWith("Update")), [true]);
});

test("a shape the deck removed is offered for removal, ticked only if the author has done nothing to it", () => {
  const p = importDeck();
  find(p, "Welcome", "Body").triggers = [{ id: "trg-1", event: "click", action: "showLayer", target: "layer-1", conditions: [] }];
  const { plan, pkg, deck } = planFor(p, { photo: "none", bar: false, bodyLines: ["One", "Two"] });
  const byName = Object.fromEntries(offered(plan).map((i) => [i.label.match(/"([^"]+)"/)![1]!, i]));
  assert.equal(byName["Photo"]!.checked, true);
  assert.equal(byName["Bar"]!.checked, true);
  // The body is still in the deck; try a deck without it for the one with the rule.
  const gone = planFor(p, { photo: "none", bar: false });
  assert.equal(offered(gone.plan).length, 2);
  apply(p, plan, tick(plan), pkg, deck);
  assert.deepEqual(objectsOf(p.slides[0]!).map((o) => o.name), ["Title 1", "Body"]);
});

test("a shape the deck removed that carries the author's rule is offered unticked, and says why", () => {
  const p = importDeck();
  const photo = find(p, "Welcome", "Photo");
  photo.narration = { script: "A team", voice: "af_heart", speed: 1, lang: "en-US", pronunciations: [] } as unknown as OSObject["narration"];
  const item = offered(planFor(p, { photo: "none" }).plan).find((i) => /"Photo"/.test(i.label))!;
  assert.equal(item.checked, false);
  assert.match(item.detail.join(" "), /rules, narration, timing/);
  assert.equal(authorAdded(photo), true);
});

test("a changed picture brings its new file with it, only when ticked", () => {
  const p = importDeck();
  const { plan, pkg, deck } = planFor(p, { photo: "two" });
  const item = offered(plan)[0]!;
  assert.match(item.label, /\(picture\)/);
  assert.equal(item.assets.length, 1);
  assert.match(item.assets[0]!.path, /^assets\/images\/pptx-[0-9a-f]{14}\.png$/);
  assert.deepEqual(apply(p, plan, [], pkg, deck).assets, [], "nothing to write when nothing is ticked");
  const result = apply(p, plan, [item.id], pkg, deck);
  assert.equal(result.assets.length, 1);
  assert.equal(find(p, "Welcome", "Photo").content["src"], item.assets[0]!.path);
});

// ---- slides

test("a new slide in the deck is offered, ticked, and goes after the slide before it", () => {
  const p = importDeck();
  const { plan, pkg, deck } = planFor(p, { third: true });
  const item = offered(plan)[0]!;
  assert.match(item.label, /new slide, "Third"/);
  assert.equal(item.checked, true);
  const result = apply(p, plan, [item.id], pkg, deck);
  assert.equal(result.insert.length, 1);
  assert.deepEqual([result.insert[0]!.slide.name, result.insert[0]!.after], ["Third", "slide-002"]);
  const prov = result.insert[0]!.slide.provenance as unknown as { slideId: string; sourceDeck: string };
  assert.deepEqual([prov.slideId, prov.sourceDeck], ["258", p.source.id]);
  assert.equal(objectsOf(result.insert[0]!.slide).length, 1);
});

test("several new slides in a row keep the deck's order", () => {
  const p = importDeck();
  const { plan, pkg, deck } = planFor(p, { third: true, fourth: true });
  const result = apply(p, plan, tick(plan), pkg, deck);
  assert.equal(result.insert.length, 2);
  assert.equal(result.insert[0]!.after, "slide-002");
  assert.equal(result.insert[1]!.after, result.insert[0]!.slide.id, "the second goes after the first, not after the old last slide");
});

test("a slide the author left out at import is offered unticked, apart from a slide the deck really added", () => {
  const p = importDeck({ third: true }, [0, 2]);
  assert.deepEqual(p.source.seen, ["256", "257", "258"]);
  const { plan } = planFor(p, { third: true, fourth: true });
  const byLabel = offered(plan).map((i) => [i.label.replace(/".*"/, '"..."'), i.checked]);
  assert.deepEqual(byLabel, [['The deck still has the slide "...", which you left out or deleted. Add it back?', false], ['The deck has a new slide, "...". Add it?', true]]);
});

test("a slide the deck no longer has is offered for deletion, unticked", () => {
  const p = importDeck();
  const { plan, pkg, deck } = planFor(p, { second: false });
  const item = offered(plan).find((i) => /no longer has the slide/.test(i.label))!;
  assert.equal(item.checked, false);
  assert.deepEqual(apply(p, plan, [], pkg, deck).remove, []);
  assert.deepEqual(apply(p, plan, [item.id], pkg, deck).remove, ["slide-002"]);
});

test("a slide that the author added their own objects to says so when it is offered for deletion", () => {
  const p = importDeck();
  p.slides[1]!.baseLayer.objects.push({ ...find(p, "Second", "Content"), id: "obj-9999", name: "Mine", provenance: null });
  const item = offered(planFor(p, { second: false }).plan).find((i) => /no longer has the slide/.test(i.label))!;
  assert.match(item.detail.join(" "), /1 object that is not from the deck/);
});

test("a slide's name and background follow the deck unless the author changed them", () => {
  const p = importDeck();
  const { plan, pkg, deck } = planFor(p, { secondTitle: "Second part", background: "112233" });
  assert.match(labels(plan).join("|"), /changed the name of the slide "Second"/);
  assert.match(labels(plan).join("|"), /changed the background colour of the slide "Welcome"/);
  assert.equal(plan.items.filter((i) => i.action.op === "slideField").every((i) => i.checked), true);
  apply(p, plan, tick(plan), pkg, deck);
  assert.deepEqual(p.slides.map((s) => [s.name, s.background]), [["Welcome", "#112233"], ["Second part", null]]);

  const q = importDeck();
  q.slides[1]!.name = "My chapter two";
  const again = planFor(q, { secondTitle: "Second part" }).plan;
  const rename = again.items.find((i) => i.action.op === "slideField")!;
  assert.equal(rename.replacesYours, true);
  assert.equal(rename.checked, false);
});

test("a background picture's colour is no change when the picture is the same, nor when its colour could not be worked out this time", () => {
  const tones = new Map([[hashBytes(png1), "#102030"]]);
  const p = importDeck({ bgPicture: true }, undefined, tones);
  assert.equal(p.slides[0]!.background, "#102030");
  assert.deepEqual(offered(planFor(p, { bgPicture: true }, tones).plan), []);
  assert.deepEqual(offered(planFor(p, { bgPicture: true }).plan), [], "no colour this time: the old one stands");
  assert.deepEqual(offered(planFor(p, { bgPicture: true }, new Map([[hashBytes(png1), "#102031"]])).plan).map((i) => i.action.op), ["slideField"], "a different colour is a change");
});

test("the course's order is compared with the deck's, and a different deck is noticed", () => {
  const p = importDeck();
  assert.equal(planFor(p, { order: "swapped" }).plan.orderChanged, true);
  const other = importDeck();
  for (const s of other.slides) s.provenance = { ...(s.provenance as object), slideId: `x${(s.provenance as unknown as { slideId: string }).slideId}` } as never;
  assert.match(planFor(other, {}).plan.warning ?? "", /may be a different presentation/);
});

test("merge3 sorts each property into what can come forward, what clashes and what is unchanged", () => {
  const base = snapshotOf({ type: "text", name: "A", geometry: { x: 1, y: 2, width: 3, height: 4, rotation: 0 }, content: { html: "<p>a</p>" }, style: { fontSize: 20, color: "#000000" }, altText: "a", decorative: false });
  const ours = structuredClone(base);
  ours.altText = "mine";
  ours.style["fontSize"] = 30;
  const theirs = structuredClone(base);
  theirs.content["html"] = "<p>b</p>";
  theirs.style["fontSize"] = 40;
  delete theirs.style["color"];
  const m = merge3(base, ours, theirs);
  assert.deepEqual(m.takes.map((c) => c.path).sort(), ["content.html", "style.color"]);
  assert.deepEqual(m.conflicts.map((c) => c.path), ["style.fontSize"]);
  assert.equal(m.takes.find((c) => c.path === "style.color")!.after, undefined, "a property the deck dropped is dropped");
});

test("every item has its own id, and the ids are the ones the screen uses", () => {
  const p = importDeck();
  const { plan } = planFor(p, { bodyLines: ["x"], extra: true, third: true, photo: "none" });
  const ids = plan.items.map((i: PlanItem) => i.id);
  assert.equal(new Set(ids).size, ids.length);
});
