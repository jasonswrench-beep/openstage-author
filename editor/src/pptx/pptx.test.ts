// Tests for reading a PowerPoint deck and turning it into OpenStage slides: the XML reader, the package, the deck reader and the converter.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { convertShape, convertSlide, newNotes, parasToHtml, placementFor, scriptFromNotes, snapshotOf, type ConvertContext, type SlideContext } from "./convert.ts";
import { readDeck, type DeckShape } from "./deck.ts";
import { describeImport } from "./import.ts";
import { newNarration } from "../narration.ts";
import { fingerprint, hashBytes, hashText } from "./hash.ts";
import { openDeck, resolveTarget } from "./package.ts";
import { buildDeck, chart, connector, fakePng, group, inch, pic, sp, table, timing, type DeckSpec } from "./testdeck.ts";
import { child, descendants, kids, num, parseXml, path as xpath } from "./xml.ts";

const read = (spec: DeckSpec) => readDeck(openDeck(buildDeck(spec)));
const one = (shapes: string, extra: Partial<DeckSpec> = {}, slide: Partial<DeckSpec["slides"][number]> = {}) => read({ slides: [{ id: 256, shapes, ...slide }], ...extra }).slides[0]!;
const text = (s: DeckShape) => (s.kind === "text" ? s : (() => { throw new Error(`not text: ${s.kind}`); })());

// ---- the XML reader

test("XML: elements, attributes, text, entities, CDATA and comments", () => {
  const root = parseXml('<?xml version="1.0"?><!-- hi --><r a="1" b=\'x &amp; y\'><c>one &lt; two</c><![CDATA[<raw>]]><e/><!DOCTYPE x></r>');
  assert.equal(root.name, "r");
  assert.deepEqual(root.attrs, { a: "1", b: "x & y" });
  assert.equal(root.text, "<raw>");
  assert.equal(child(root, "c")!.text, "one < two");
  assert.equal(kids(root, "e").length, 1);
  assert.equal(num(root, "a"), 1);
  assert.equal(num(root, "b"), undefined);
});

test("XML: character references, and entities the reader does not know are left alone", () => {
  assert.equal(parseXml("<t>&#65;&#x42;&amp;&bogus;</t>").text, "AB&&bogus;");
});

test("XML: it keeps prefixes, and finds things by path and by name", () => {
  const root = parseXml('<p:a xmlns:p="x"><p:b><p:c n="1"/><p:c n="2"/></p:b><p:d><p:c n="3"/></p:d></p:a>');
  assert.equal(xpath(root, "p:b", "p:c")!.attrs["n"], "1");
  assert.deepEqual(descendants(root, "p:c").map((c) => c.attrs["n"]), ["1", "2", "3"], "in document order");
  assert.equal(xpath(root, "p:x", "p:c"), undefined);
});

test("XML: what is not well formed fails with a sentence", () => {
  for (const bad of ["<a><b></a>", "<a>", "<a b=1/>", "<a b='1/>", "<a/><b/>", "", "<a b/>", "<!-- open", "<a></b>"]) {
    assert.throws(() => parseXml(bad), /not well-formed|no element/, bad);
  }
});

test("XML: nesting that is far too deep is refused instead of overflowing", () => {
  assert.throws(() => parseXml("<a>".repeat(500) + "</a>".repeat(500)), /nested too deeply/);
  assert.doesNotThrow(() => parseXml("<a>".repeat(100) + "</a>".repeat(100)));
});

test("XML: a document type is skipped and defines nothing, so no entity trick works", () => {
  const root = parseXml('<!DOCTYPE r [<!ENTITY boom "lol">]><r>&boom;</r>');
  assert.equal(root.text, "&boom;");
});

// ---- hashes

test("a fingerprint is the same for the same thing, and different for another", () => {
  assert.equal(hashText("abc"), hashText("abc"));
  assert.notEqual(hashText("abc"), hashText("abd"));
  assert.equal(hashText("abc").length, 14);
  assert.equal(fingerprint({ b: 1, a: [1, { d: 2, c: undefined }] }), fingerprint({ a: [1, { d: 2 }], b: 1 }), "key order and undefined do not matter");
  assert.notEqual(hashBytes(new Uint8Array([1, 2, 3])), hashBytes(new Uint8Array([1, 2, 4])));
});

// ---- the package

test("a relationship's target is worked out from the part that has it", () => {
  assert.equal(resolveTarget("ppt/slides/slide1.xml", "../media/image1.png"), "ppt/media/image1.png");
  assert.equal(resolveTarget("ppt/presentation.xml", "slides/slide1.xml"), "ppt/slides/slide1.xml");
  assert.equal(resolveTarget("ppt/slides/slide1.xml", "/ppt/media/a.png"), "ppt/media/a.png");
  assert.equal(resolveTarget("ppt/slides/slide1.xml", "./x/../y.xml"), "ppt/slides/y.xml");
});

test("a file that is not a PowerPoint presentation is refused in plain words", () => {
  assert.throws(() => openDeck(new Uint8Array([1, 2, 3, 4])), /not a PowerPoint deck|not a PowerPoint presentation/);
  assert.throws(() => openDeck(new TextEncoder().encode("hello")), /PowerPoint/);
});

// ---- the deck

test("slides come in the deck's order with the deck's own numbers", () => {
  const deck = read({ slides: [{ id: 300, shapes: "" }, { id: 256, shapes: "" }, { id: 301, shapes: "" }] });
  assert.deepEqual(deck.slides.map((s) => [s.slideId, s.index]), [["300", 0], ["256", 1], ["301", 2]]);
  assert.equal(deck.slideWidth, inch(13.333));
});

test("a title with no position of its own takes the master's, and its size, colour, font and alignment from the master's title style", () => {
  const s = one(sp({ id: 2, name: "Title 1", ph: { type: "title" }, paras: [{ runs: [{ t: "Welcome" }] }] }));
  const t = text(s.shapes[0]!);
  assert.deepEqual(t.box, { x: inch(0.5), y: inch(0.3), cx: inch(9), cy: inch(1.2) });
  const run = t.paras[0]!.runs[0]!;
  assert.equal(run.size, 44);
  assert.equal(run.bold, true);
  assert.equal(run.color, "#1f497d", "the theme's dark 2");
  assert.equal(run.font, "Georgia", "the theme's heading font");
  assert.equal(t.paras[0]!.align, "ctr");
  assert.equal(t.placeholder, "title");
  assert.equal(s.name, "Welcome", "the slide is named by its title");
});

test("a layout's position wins over the master's, and a slide's own wins over both", () => {
  const layoutShapes = sp({ id: 3, name: "Text Placeholder 2", ph: { type: "body", idx: 1 }, box: { x: 1, y: 2, w: 3, h: 4 } });
  const inherit = one(sp({ id: 3, name: "Body", ph: { type: "body", idx: 1 }, paras: [{ runs: [{ t: "x" }] }] }), { layoutShapes });
  assert.deepEqual(inherit.shapes[0]!.box, { x: inch(1), y: inch(2), cx: inch(3), cy: inch(4) });
  const own = one(sp({ id: 3, name: "Body", ph: { type: "body", idx: 1 }, box: { x: 5, y: 5, w: 1, h: 1 }, paras: [{ runs: [{ t: "x" }] }] }), { layoutShapes });
  assert.deepEqual(own.shapes[0]!.box, { x: inch(5), y: inch(5), cx: inch(1), cy: inch(1) });
});

test("bullets, levels and sizes come from the master's body style", () => {
  const s = one(sp({ id: 3, name: "Body", ph: { type: "body", idx: 1 }, paras: [{ runs: [{ t: "One" }] }, { lvl: 1, runs: [{ t: "Two" }] }, { runs: [{ t: "Plain" }], bullet: "none" }] }));
  const t = text(s.shapes[0]!);
  assert.deepEqual(t.paras.map((p) => [p.level, p.bullet, p.runs[0]!.size]), [[0, "dot", 32], [1, "dot", 28], [0, "none", 32]]);
});

test("a run's own formatting wins over the style, and a link is kept", () => {
  const links = { rIdLink: "https://example.org/a?b=1&c=2" };
  const s = one(
    sp({ id: 3, name: "Body", ph: { type: "body", idx: 1 }, paras: [{ runs: [{ t: "Big", sz: 40, b: true, i: true, color: "FF0000", font: "Arial" }, { t: " link", link: "rIdLink" }, { t: "2", baseline: 30000 }] }] }, new Map([["rIdLink", "rIdLink"]])),
    {}, { links },
  );
  const [a, b, c] = text(s.shapes[0]!).paras[0]!.runs;
  assert.deepEqual([a?.size, a?.bold, a?.italic, a?.color, a?.font], [40, true, true, "#ff0000", "Arial"]);
  assert.equal(b?.href, "https://example.org/a?b=1&c=2");
  assert.equal(c?.sup, true);
});

test("text that PowerPoint shrank to fit is kept at the size it is shown", () => {
  const s = one(sp({ id: 3, name: "Body", ph: { type: "body", idx: 1 }, fit: 62.5, paras: [{ runs: [{ t: "x" }] }] }));
  const t = text(s.shapes[0]!);
  assert.equal(t.paras[0]!.runs[0]!.size, 20, "32 points at 62.5 percent");
  assert.equal(t.fitScale, 0.625);
});

test("a text box that is not a placeholder uses the deck's plain text style", () => {
  const s = one(sp({ id: 4, name: "Box", txBox: true, box: { x: 1, y: 1, w: 2, h: 1 }, paras: [{ runs: [{ t: "Plain" }] }] }));
  const run = text(s.shapes[0]!).paras[0]!.runs[0]!;
  assert.deepEqual([run.size, run.color], [18, "#000000"]);
});

test("a shape drawn with a style takes its fill, outline and text colour from it", () => {
  const s = one(sp({ id: 5, name: "Button", box: { x: 1, y: 1, w: 3, h: 1 }, geom: "roundRect", styleRef: { fill: "4F81BD", font: "FFFFFF", line: "385D8A" }, paras: [{ runs: [{ t: "Go" }] }] }));
  const t = text(s.shapes[0]!);
  assert.equal(t.fill, "#4f81bd");
  assert.deepEqual(t.line, { color: "#385d8a", width: 12700 });
  assert.equal(t.paras[0]!.runs[0]!.color, "#ffffff");
  assert.equal(t.geom, "roundRect");
});

test("a shape's own fill and outline win over its style, and no fill is no fill", () => {
  const s = one(
    sp({ id: 5, name: "A", box: { x: 0, y: 0, w: 1, h: 1 }, geom: "rect", fill: "FF0000", styleRef: { fill: "4F81BD" } }) +
    sp({ id: 6, name: "B", box: { x: 0, y: 0, w: 1, h: 1 }, geom: "rect", noFill: true, line: { color: "00FF00", w: 25400 } }),
  );
  const [a, b] = s.shapes;
  assert.ok(a?.kind === "shape" && b?.kind === "shape");
  if (a?.kind !== "shape" || b?.kind !== "shape") return;
  assert.equal(a.fill, "#ff0000");
  assert.deepEqual([b.fill, b.line], [null, { color: "#00ff00", width: 25400 }]);
});

test("a shape with no fill, no outline and no words is nothing to see, and is counted", () => {
  const s = one(sp({ id: 5, name: "Empty", box: { x: 0, y: 0, w: 1, h: 1 }, geom: "rect", noFill: true }));
  assert.equal(s.shapes.length, 0);
  assert.equal(s.left.empty, 1);
});

test("hidden shapes, dates, footers and slide numbers are left out and counted", () => {
  const s = one(
    sp({ id: 2, name: "Hidden", box: { x: 0, y: 0, w: 1, h: 1 }, geom: "rect", fill: "FF0000", hidden: true }) +
    sp({ id: 3, name: "Date", ph: { type: "dt", idx: 10 }, box: { x: 0, y: 0, w: 1, h: 1 }, paras: [{ runs: [{ t: "10/13" }] }] }) +
    sp({ id: 4, name: "Number", ph: { type: "sldNum", idx: 12 }, box: { x: 0, y: 0, w: 1, h: 1 }, paras: [{ runs: [{ t: "3" }] }] }) +
    sp({ id: 5, name: "Kept", box: { x: 0, y: 0, w: 1, h: 1 }, geom: "rect", fill: "FF0000" }),
  );
  assert.deepEqual(s.shapes.map((x) => x.name), ["Kept"]);
  assert.deepEqual(s.left, { footers: 2, hidden: 1, empty: 0 });
});

test("shapes in a group are placed by the group's scale and position, in reading order", () => {
  const child1 = sp({ id: 11, name: "Inside", box: { x: 0.5, y: 0.25, w: 1, h: 0.5 }, geom: "rect", fill: "FF0000" });
  const s = one(sp({ id: 2, name: "Before", box: { x: 0, y: 0, w: 1, h: 1 }, geom: "rect", fill: "00FF00" }) + group(10, "G", { x: 1, y: 1, w: 4, h: 2 }, { x: 0, y: 0, w: 2, h: 1 }, child1));
  assert.deepEqual(s.shapes.map((x) => x.name), ["Before", "Inside"]);
  assert.deepEqual(s.shapes[1]!.box, { x: inch(2), y: inch(1.5), cx: inch(2), cy: inch(1) });
});

test("a picture keeps its alt text, its place and a fingerprint of the picture; a decorative mark is read", () => {
  const png = fakePng(1);
  const s = one(pic(7, "Photo", "rIdP", { x: 1, y: 1, w: 3, h: 2 }, "A team at a table"), { media: { "image1.png": png } }, { media: { rIdP: "image1.png" } });
  const p = s.shapes[0]!;
  assert.ok(p.kind === "picture");
  if (p.kind !== "picture") return;
  assert.deepEqual([p.alt, p.media, p.ext, p.cropped, p.decorative], ["A team at a table", "ppt/media/image1.png", "png", false, false]);
  assert.equal(p.mediaHash, hashBytes(png));
  const crop = one(pic(7, "Photo", "rIdP", { x: 1, y: 1, w: 3, h: 2 }, "", '<a:srcRect l="10000"/>'), { media: { "image1.png": png } }, { media: { rIdP: "image1.png" } });
  assert.equal(crop.shapes[0]?.kind === "picture" && crop.shapes[0]?.cropped, true);
});

test("a picture a web page cannot show is left out with the reason", () => {
  const s = one(pic(7, "Logo", "rIdP", { x: 1, y: 1, w: 1, h: 1 }), { media: { "image1.emf": fakePng(2) } }, { media: { rIdP: "image1.emf" } });
  assert.equal(s.shapes[0]?.kind === "picture" && s.shapes[0]?.media, null);
  assert.match(s.skipped[0]!.why, /\.emf/);
});

test("a table keeps its words, its header settings and whether cells were merged", () => {
  const s = one(table(8, "Grid", { x: 1, y: 1, w: 6, h: 2 }, [["A", "B"], ["1", "2"]], { firstRow: true, alt: "Scores" }));
  const t = s.shapes[0]!;
  assert.ok(t.kind === "table");
  if (t.kind !== "table") return;
  assert.deepEqual([t.rows, t.headerRow, t.headerColumn, t.merged, t.alt], [[["A", "B"], ["1", "2"]], true, false, false, "Scores"]);
  const merged = one(table(8, "Grid", { x: 1, y: 1, w: 6, h: 2 }, [["A", "B"]], { span: true }));
  assert.equal(merged.shapes[0]?.kind === "table" && merged.shapes[0]?.merged, true);
});

test("a chart is left out with the reason, not silently", () => {
  const s = one(chart(9, "Sales", { x: 1, y: 1, w: 4, h: 3 }));
  assert.equal(s.shapes.length, 0);
  assert.deepEqual(s.skipped, [{ name: "Sales", why: "it is a chart, which cannot be brought in yet" }]);
});

test("a line is read", () => {
  const s = one(connector(10, "Rule", { x: 1, y: 2, w: 5, h: 0 }, "FF0000", 25400));
  assert.deepEqual(s.shapes[0], { ...s.shapes[0]!, kind: "line", color: "#ff0000", width: 25400 });
});

test("a slide's own colour is its background; a picture fills it; otherwise the master's is used", () => {
  const own = one("", {}, { background: "FF0000" });
  assert.equal(own.background, "#ff0000");
  const png = fakePng(3);
  const picture = one("", { media: { "bg.png": png } }, { backgroundPicture: "bg.png" });
  assert.equal(picture.backgroundPicture?.media, "ppt/media/bg.png");
  assert.equal(picture.backgroundPicture?.mediaHash, hashBytes(png));
  const fromMaster = one("", {
    media: { "master.png": png },
    masterBackground: '<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rIdMedia1"/><a:stretch/></a:blipFill></p:bgPr></p:bg>',
  });
  assert.equal(fromMaster.backgroundPicture?.media, "ppt/media/master.png");
  assert.equal(one("").background, null);
});

test("speaker notes, animations and hidden slides are noticed", () => {
  const deck = read({ slides: [{ id: 256, shapes: "", notes: "Say hello", animated: true }, { id: 257, shapes: "", show: false }] });
  assert.deepEqual(deck.slides.map((s) => [s.hasNotes, s.animated, s.hidden]), [[true, true, false], [false, false, true]]);
});

test("a shape is fingerprinted by what it is, so a change shows and sameness does not", () => {
  const a = one(sp({ id: 3, name: "Body", ph: { type: "body", idx: 1 }, paras: [{ runs: [{ t: "One" }] }] })).shapes[0]!;
  const same = one(sp({ id: 3, name: "Body", ph: { type: "body", idx: 1 }, paras: [{ runs: [{ t: "One" }] }] })).shapes[0]!;
  const edited = one(sp({ id: 3, name: "Body", ph: { type: "body", idx: 1 }, paras: [{ runs: [{ t: "Won" }] }] })).shapes[0]!;
  assert.equal(a.hash, same.hash);
  assert.notEqual(a.hash, edited.hash);
});

// ---- converting

const ppi96 = placementFor(inch(13.333), inch(7.5), { width: 1280, height: 720 });
const ctx = (over: Partial<ConvertContext> = {}): ConvertContext => ({
  placement: ppi96,
  notes: newNotes(),
  mediaPath: (hash, ext) => `assets/images/deck-${hash}.${ext}`,
  bytesOf: () => fakePng(9),
  ...over,
});
const convert1 = (shapes: string, extra: Partial<DeckSpec> = {}, slide: Partial<DeckSpec["slides"][number]> = {}, c = ctx()) => {
  const s = one(shapes, extra, slide);
  return s.shapes.map((x) => convertShape(x, c));
};

test("the deck is laid on the stage as big as it fits, in the middle", () => {
  assert.deepEqual(placementFor(inch(13.333), inch(7.5), { width: 1280, height: 720 }), { pixelsPerInch: 96, offsetX: 0, offsetY: 0 });
  assert.deepEqual(placementFor(inch(10), inch(7.5), { width: 1280, height: 720 }), { pixelsPerInch: 96, offsetX: 160, offsetY: 0 });
  assert.deepEqual(placementFor(inch(10), inch(5), { width: 1280, height: 720 }), { pixelsPerInch: 128, offsetX: 0, offsetY: 40 });
});

test("a title becomes a heading with its size in stage pixels, and the alt text is its words", () => {
  const [d] = convert1(sp({ id: 2, name: "Title 1", ph: { type: "title" }, paras: [{ runs: [{ t: "Welcome &amp; &lt;hello&gt;" }] }] }));
  assert.equal(d!.type, "text");
  assert.equal(d!.content["html"], "<h1>Welcome &amp; &lt;hello&gt;</h1>");
  assert.equal(d!.role, "heading");
  assert.equal(d!.altText, "Welcome & <hello>");
  assert.equal(d!.style["fontSize"], 59, "44 points at 96 pixels an inch");
  assert.equal(d!.style["color"], "#1f497d");
  assert.equal(d!.style["textAlign"], "center");
  assert.equal(d!.style["fontFamily"], "Georgia, 'Times New Roman', serif", "Georgia is a font a web page can count on");
  assert.deepEqual(d!.geometry, { x: 48, y: 29, width: 864, height: 115, rotation: 0 });
});

test("bulleted paragraphs become a list, nested by level, and plain paragraphs stay paragraphs", () => {
  const para = (t: string, lvl: number, bullet: "char" | "none" | "num" = "char") => ({ runs: [{ t }], lvl, bullet });
  const html = (paras: ReturnType<typeof para>[]) => {
    const s = one(sp({ id: 3, name: "B", ph: { type: "body", idx: 1 }, paras }));
    return convertShape(s.shapes[0]!, ctx())!.content["html"];
  };
  assert.equal(html([para("One", 0), para("Two", 1)]), "<ul><li>One<ul><li>Two</li></ul></li></ul>");
  assert.equal(html([para("One", 0), para("Two", 1), para("Three", 0)]), "<ul><li>One<ul><li>Two</li></ul></li><li>Three</li></ul>");
  assert.equal(html([para("Intro", 0, "none"), para("A", 0), para("B", 0), para("After", 0, "none")]), "<p>Intro</p><ul><li>A</li><li>B</li></ul><p>After</p>");
  assert.equal(html([para("First", 0, "num"), para("Second", 0, "num")]), "<ol><li>First</li><li>Second</li></ol>");
  assert.equal(html([para("A", 0), para("N", 0, "num")]), "<ul><li>A</li></ul><ol><li>N</li></ol>");
  assert.equal(html([para("Deep", 2)]), "<ul><li><ul><li><ul><li>Deep</li></ul></li></ul></li></ul>");
});

test("bold, italic, a link and a superscript stay; a box that is bold all through is bold in its style instead", () => {
  const html = (runs: object[], style = {}) => {
    const s = one(sp({ id: 4, name: "T", txBox: true, box: { x: 1, y: 1, w: 3, h: 1 }, paras: [{ runs: runs as never }] }, new Map([["rIdL", "rIdL"]])), {}, { links: { rIdL: "https://example.org/" } });
    return convertShape(s.shapes[0]!, ctx())!;
  };
  const mixed = html([{ t: "a ", b: true }, { t: "b ", i: true }, { t: "link", link: "rIdL" }, { t: "2", baseline: 30000 }]);
  assert.equal(mixed.content["html"], '<p><strong>a </strong><em>b </em><a href="https://example.org/">link</a><sup>2</sup></p>');
  const allBold = html([{ t: "one ", b: true }, { t: "two", b: true }]);
  assert.equal(allBold.content["html"], "<p>one two</p>");
  assert.equal(allBold.style["fontWeight"], "bold");
});

test("a link that is not a web or mail address is dropped, so nothing can run", () => {
  const html = parasToHtml([{ level: 0, bullet: "none", runs: [{ text: "x", href: "javascript:alert(1)" }, { text: "y", href: "mailto:a@b.org" }] }], false, false);
  assert.equal(html, '<p>x<a href="mailto:a@b.org">y</a></p>');
});

test("a box with more than one size or colour takes the one most of its words have, and is counted", () => {
  const c = ctx();
  const s = one(sp({ id: 4, name: "T", txBox: true, box: { x: 1, y: 1, w: 3, h: 1 }, paras: [{ runs: [{ t: "tiny", sz: 10, color: "FF0000" }, { t: " the long part is large", sz: 30, color: "0000FF" }] }] }));
  const d = convertShape(s.shapes[0]!, c)!;
  assert.deepEqual([d.style["fontSize"], d.style["color"]], [40, "#0000ff"]);
  assert.deepEqual([c.notes.mixedSize, c.notes.mixedColour], [1, 1]);
});

test("fonts a web page cannot count on are replaced by the course's own and counted", () => {
  const c = ctx();
  const s = one(sp({ id: 4, name: "T", txBox: true, box: { x: 1, y: 1, w: 3, h: 1 }, paras: [{ runs: [{ t: "x", font: "Calibri" }] }] }));
  const d = convertShape(s.shapes[0]!, c)!;
  assert.equal(d.style["fontFamily"], "theme:font.body");
  assert.deepEqual(c.notes.fontsReplaced, { Calibri: 1 });
});

test("text on a fill carries the fill, the outline and a rounded corner", () => {
  const s = one(
    sp({ id: 5, name: "Pill", box: { x: 1, y: 1, w: 3, h: 1 }, geom: "roundRect", fill: "4F81BD", line: { color: "385D8A", w: 25400 }, paras: [{ runs: [{ t: "Go", color: "FFFFFF" }] }] }) +
    sp({ id: 6, name: "Oval", box: { x: 1, y: 1, w: 3, h: 1 }, geom: "ellipse", fill: "00FF00", paras: [{ runs: [{ t: "O" }] }] }) +
    sp({ id: 7, name: "Tri", box: { x: 1, y: 1, w: 3, h: 1 }, geom: "triangle", fill: "00FF00", paras: [{ runs: [{ t: "T" }] }] }),
  );
  const c = ctx();
  const [pill, oval, tri] = s.shapes.map((x) => convertShape(x, c)!);
  assert.deepEqual([pill!.style["fill"], pill!.style["stroke"], pill!.style["strokeWidth"], pill!.style["radius"]], ["#4f81bd", "#385d8a", 3, 12]);
  assert.equal(oval!.style["radius"], 9999);
  assert.deepEqual(c.notes.formsRedrawn, { triangle: 1 });
});

test("a shape with no alt text is decorative, as a new shape in this editor is; one with alt text is not", () => {
  const [plain, described, star] = convert1(
    sp({ id: 5, name: "Bar", box: { x: 0, y: 0, w: 4, h: 1 }, geom: "rect", fill: "FF0000" }) +
    sp({ id: 6, name: "Arrow", box: { x: 0, y: 0, w: 1, h: 1 }, geom: "rightArrow", fill: "FF0000", alt: "Points to the next step" }) +
    sp({ id: 7, name: "Star", box: { x: 0, y: 0, w: 1, h: 1 }, geom: "star5", fill: "FF0000" }),
  );
  assert.deepEqual([plain!.type, plain!.decorative, plain!.altText, plain!.role], ["shape", true, "", "presentation"]);
  assert.deepEqual([described!.content["shape"], described!.decorative, described!.altText, described!.role], ["arrow", false, "Points to the next step", "img"]);
  assert.equal(star!.content["shape"], "rectangle");
});

test("a straight line becomes a thin decorative bar, and a slanted one is counted and left out", () => {
  const c = ctx();
  const s = one(connector(10, "Rule", { x: 1, y: 2, w: 5, h: 0 }, "FF0000", 25400) + connector(11, "Slant", { x: 1, y: 2, w: 3, h: 2 }));
  const [bar, slant] = s.shapes.map((x) => convertShape(x, c));
  assert.deepEqual([bar!.type, bar!.style["fill"], bar!.decorative, bar!.geometry.height], ["shape", "#ff0000", true, 3]);
  assert.equal(slant, null);
  assert.equal(c.notes.diagonalLines, 1);
});

test("a picture keeps its alt text and its picture is saved under a name from its fingerprint; with no alt text it is left for the author", () => {
  const png = fakePng(5);
  const s = one(
    pic(7, "Photo", "rIdP", { x: 1, y: 1, w: 3, h: 2 }, "A team at a table") + pic(8, "Same", "rIdP", { x: 1, y: 4, w: 3, h: 2 }),
    { media: { "image1.png": png } }, { media: { rIdP: "image1.png" } },
  );
  const c = ctx({ bytesOf: () => png });
  const [a, b] = s.shapes.map((x) => convertShape(x, c)!);
  assert.deepEqual([a!.type, a!.altText, a!.decorative, a!.content["src"]], ["image", "A team at a table", false, `assets/images/deck-${hashBytes(png)}.png`]);
  assert.deepEqual([b!.altText, b!.decorative], ["", false], "no alt text is not made up: the validator will ask");
  assert.equal(a!.asset!.path, b!.asset!.path, "the same picture is one file");
});

test("a table becomes a table with its settings, and is named by its alt text", () => {
  const [d] = convert1(table(8, "Grid", { x: 1, y: 1, w: 6, h: 2 }, [["A", "B"], ["1", "2"]], { firstRow: true, alt: "Scores" }));
  assert.deepEqual([d!.type, d!.content, d!.altText], ["table", { caption: "", headerRow: true, headerColumn: false, rows: [["A", "B"], ["1", "2"]] }, "Scores"]);
});

test("a rotation is kept", () => {
  const [d] = convert1(sp({ id: 5, name: "Tilt", box: { x: 1, y: 1, w: 2, h: 1, rot: 15 }, geom: "rect", fill: "FF0000" }));
  assert.equal(d!.geometry.rotation, 15);
});

// ---- a whole slide

const slideCtx = (): SlideContext => {
  let n = 0;
  return { ...ctx(), deckId: "deck-abc", importedAt: "2026-10-13T10:00:00Z", newId: () => `obj-${String(++n).padStart(4, "0")}`, slideWidth: inch(13.333), slideHeight: inch(7.5) };
};

test("a slide's objects are in reading order, numbered for the tab key except decoration, and each says where it came from", () => {
  const ds = one(
    sp({ id: 2, name: "Title 1", ph: { type: "title" }, paras: [{ runs: [{ t: "Welcome" }] }] }) +
    sp({ id: 9, name: "Bar", box: { x: 0, y: 0, w: 4, h: 0.1 }, geom: "rect", fill: "FF0000" }) +
    sp({ id: 3, name: "Body", ph: { type: "body", idx: 1 }, paras: [{ runs: [{ t: "One" }] }] }),
  );
  const out = convertSlide(ds, slideCtx());
  assert.deepEqual(out.objects.map((o) => [o.id, o.name, o.geometry.z, o.accessibility.tabOrder, o.accessibility.decorative]), [
    ["obj-0001", "Title 1", 10, 1, false], ["obj-0002", "Bar", 20, 0, true], ["obj-0003", "Body", 30, 2, false],
  ]);
  const prov = out.objects[0]!.provenance as unknown as Record<string, unknown>;
  assert.deepEqual([prov["sourceDeck"], prov["slideIndex"], prov["shapeId"], prov["slideId"], prov["importedAt"], prov["sourceHash"]], ["deck-abc", 0, "256/2", "256", "2026-10-13T10:00:00Z", ds.shapes[0]!.hash]);
  assert.deepEqual(prov["base"], snapshotOf(out.objects[0]!), "the snapshot is the object as imported");
  assert.deepEqual(out.provenance, { sourceDeck: "deck-abc", slideId: "256", slideIndex: 0, importedAt: "2026-10-13T10:00:00Z", sourceHash: ds.hash, base: { name: "Welcome", background: null, shapes: ["2", "9", "3"] } });
});

test("a picture that fills the slide's background goes behind everything, as decoration", () => {
  const png = fakePng(6);
  const ds = one(sp({ id: 2, name: "Title 1", ph: { type: "title" }, paras: [{ runs: [{ t: "Hi" }] }] }), { media: { "bg.png": png } }, { backgroundPicture: "bg.png" });
  const out = convertSlide(ds, { ...slideCtx(), bytesOf: () => png });
  assert.deepEqual(out.objects.map((o) => [o.name, o.type, o.accessibility.decorative]), [["Background picture", "image", true], ["Title 1", "text", false]]);
  assert.deepEqual(out.objects[0]!.geometry, { x: 0, y: 0, width: 1280, height: 720, rotation: 0, z: 10 });
  assert.equal((out.objects[0]!.provenance as unknown as { shapeId: string }).shapeId, "256/background");
  assert.equal(out.assets.length, 1);
});

test("a slide whose background is a picture is given the picture's average colour when it is known, so the text on it can be checked", () => {
  const png = fakePng(6);
  const ds = one(sp({ id: 2, name: "Title 1", ph: { type: "title" }, paras: [{ runs: [{ t: "Hi" }] }] }), { media: { "bg.png": png } }, { backgroundPicture: "bg.png" });
  const tones = new Map([[hashBytes(png), "#102030"]]);
  const known = convertSlide(ds, { ...slideCtx(), bytesOf: () => png, tones });
  assert.equal(known.background, "#102030");
  assert.equal(known.provenance.base.background, "#102030", "so a deck that has not changed is not a change");
  assert.equal(convertSlide(ds, { ...slideCtx(), bytesOf: () => png }).background, null, "not known: the theme's own background");
  const plain = one("", {}, { background: "FF0000" });
  assert.equal(convertSlide(plain, { ...slideCtx(), tones }).background, "#ff0000", "a colour the deck chose wins");
});

test("a 4 to 3 deck is centred on a wider stage", () => {
  const four = placementFor(inch(10), inch(7.5), { width: 1280, height: 720 });
  const s = one(sp({ id: 5, name: "Box", box: { x: 0, y: 0, w: 10, h: 7.5 }, geom: "rect", fill: "FF0000" }), { width: inch(10), height: inch(7.5) });
  const d = convertShape(s.shapes[0]!, ctx({ placement: four }))!;
  assert.deepEqual(d.geometry, { x: 160, y: 0, width: 960, height: 720, rotation: 0 });
});

// ---- how words sit in their box: where they start, the room round them, shrinking, spacing

test("text: where the words start, the room round them and shrinking when they do not fit come from the box", () => {
  const [d] = convert1(sp({ id: 5, name: "Box", txBox: true, box: { x: 1, y: 1, w: 4, h: 2 }, body: { anchor: "ctr", ins: { l: 0.2, r: 0.2, t: 0.1, b: 0.1 }, autofit: "norm" }, paras: [{ runs: [{ t: "Hello" }] }] }));
  assert.equal(d!.style["verticalAlign"], "middle");
  assert.equal(d!.style["paddingX"], 19, "0.2 inch at 96 to the inch");
  assert.equal(d!.style["paddingY"], 10);
  assert.equal(d!.style["autoFit"], "shrink");
});

test("text: a box that says nothing has the room PowerPoint gives, starts at the top and does not shrink", () => {
  const [d] = convert1(sp({ id: 5, name: "Box", txBox: true, box: { x: 1, y: 1, w: 4, h: 2 }, paras: [{ runs: [{ t: "Hello" }] }] }));
  assert.equal(d!.style["paddingX"], 10, "a tenth of an inch is nine and a half pixels");
  assert.equal(d!.style["paddingY"], 5);
  assert.equal(d!.style["verticalAlign"], undefined);
  assert.equal(d!.style["autoFit"], undefined);
});

test("text: a box that grows to fit its words shrinks them here, and one that lets them run over does not", () => {
  const grow = convert1(sp({ id: 5, name: "G", txBox: true, box: { x: 1, y: 1, w: 4, h: 2 }, body: { autofit: "sp" }, paras: [{ runs: [{ t: "Hello" }] }] }))[0]!;
  const none = convert1(sp({ id: 6, name: "N", txBox: true, box: { x: 1, y: 1, w: 4, h: 2 }, body: { autofit: "none" }, paras: [{ runs: [{ t: "Hello" }] }] }))[0]!;
  assert.equal(grow.style["autoFit"], "shrink");
  assert.equal(none.style["autoFit"], undefined);
});

test("text: a placeholder takes where its words start, and shrinking, from its layout", () => {
  const spec = {
    layoutShapes: '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr anchor="b"><a:normAutofit/></a:bodyPr><a:lstStyle/></p:txBody></p:sp>',
  };
  const [d] = convert1(sp({ id: 2, name: "Title 1", ph: { type: "title" }, paras: [{ runs: [{ t: "Welcome" }] }] }), spec);
  assert.equal(d!.style["verticalAlign"], "bottom");
  assert.equal(d!.style["autoFit"], "shrink");
});

test("text: line spacing and the space between paragraphs are kept, and a title is not bold unless it says so", () => {
  const [d] = convert1(sp({ id: 5, name: "Box", txBox: true, box: { x: 1, y: 1, w: 4, h: 2 }, paras: [
    { lnPct: 90, before: 12, after: 0, runs: [{ t: "One", sz: 20 }] }, { lnPct: 90, before: 12, runs: [{ t: "Two", sz: 20 }] },
  ] }));
  assert.equal(d!.style["lineHeight"], 1.08, "90% of PowerPoint's single line, which is 1.2 times the type");
  assert.equal(d!.style["paragraphSpacing"], 16, "12 points at 96 to the inch");
  const [title] = convert1(sp({ id: 2, name: "Title 1", ph: { type: "title" }, paras: [{ runs: [{ t: "Welcome", b: false }] }] }));
  assert.equal(title!.style["fontWeight"], "normal");
});

test("text: a list whose deeper levels are a different size from its first says how much, and the size is the first level's", () => {
  const [d] = convert1(sp({ id: 5, name: "Box", txBox: true, box: { x: 1, y: 1, w: 6, h: 3 }, paras: [
    { bullet: "char", runs: [{ t: "Main point", sz: 20 }] }, { bullet: "char", lvl: 1, runs: [{ t: "A detail that is much longer than the main point, so most of the words are small", sz: 15 }] },
    { bullet: "char", runs: [{ t: "Another point", sz: 20 }] },
  ] }));
  assert.equal(d!.style["fontSize"], 27, "20 points at 96 to the inch");
  assert.equal(d!.style["nestedSize"], 0.75, "15 is three quarters of 20");
  const [same] = convert1(sp({ id: 6, name: "Same", txBox: true, box: { x: 1, y: 1, w: 6, h: 3 }, paras: [{ bullet: "char", runs: [{ t: "One", sz: 20 }] }, { bullet: "char", lvl: 1, runs: [{ t: "Two", sz: 20 }] }] }));
  assert.equal(same!.style["nestedSize"], undefined, "the same size needs nothing said");
});

test("text: empty paragraphs between paragraphs were space, so the space is kept and the empty paragraphs are not", () => {
  const [d] = convert1(sp({ id: 5, name: "Box", txBox: true, box: { x: 1, y: 1, w: 4, h: 3 }, paras: [
    { runs: [{ t: "One", sz: 20 }] }, { runs: [], endSz: 20 }, { runs: [{ t: "Two", sz: 20 }] },
  ] }));
  assert.equal(d!.content["html"], "<p>One</p><p>Two</p>");
  assert.equal(d!.style["paragraphSpacing"], 32, "one line of 20 points is 24 points of room, which is 32 pixels");
});

// ---- animation

const SHAPES = (n = 3) => Array.from({ length: n }, (_, i) => sp({ id: 10 + i, name: `Picture ${i + 1}`, box: { x: i, y: 1, w: 1, h: 1 }, geom: "rect", fill: "FF0000" })).join("");

test("animation: each press of the mouse is a step, in order, and effects that start with or after the one before share it", () => {
  const ds = one(SHAPES(4), {}, {
    timing: timing([
      { groups: [{ effects: [{ spid: 10 }] }] },
      { groups: [{ effects: [{ spid: 11 }, { spid: 12, node: "withEffect" }] }, { delay: 500, effects: [{ spid: 13, node: "afterEffect" }] }] },
    ]),
  });
  assert.deepEqual(ds.effects.map((e) => [e.target, e.click, e.delay]), [["10", 1, 0], ["11", 2, 0], ["12", 2, 0], ["13", 2, 500]]);
});

test("animation: an effect that starts by itself is not a press", () => {
  const ds = one(SHAPES(2), {}, { timing: timing([{ auto: true, groups: [{ effects: [{ spid: 10 }] }] }, { groups: [{ effects: [{ spid: 11 }] }] }]) });
  assert.deepEqual(ds.effects.map((e) => [e.target, e.click]), [["10", null], ["11", 1]]);
});

test("animation: exits, emphasis, motion and paragraph by paragraph are counted and not brought in as steps", () => {
  const ds = one(SHAPES(4), {}, {
    timing: timing([
      { groups: [{ effects: [{ spid: 10, cls: "exit", preset: 1 }, { spid: 11, cls: "emph", preset: 6 }, { spid: 12, cls: "path", preset: 0 }, { spid: 13, para: true }] }] },
    ]),
  });
  assert.deepEqual(ds.animationLeft, { exit: 1, emphasis: 1, path: 1, byParagraph: 1, interactive: 0 });
  assert.deepEqual(ds.effects.map((e) => e.target), ["13"], "the one that makes the text appear is kept, all at once");
});

test("animation: the objects get the entrance, a step to wait for, and an effect that is the nearest this editor has", () => {
  const ds = one(SHAPES(4), {}, {
    timing: timing([
      { groups: [{ effects: [{ spid: 10, preset: 1 }] }] },
      { groups: [{ effects: [{ spid: 11, preset: 10, dur: 700 }, { spid: 12, preset: 2, subtype: 8, node: "withEffect", delay: 250, dur: 400 }] }] },
      { groups: [{ effects: [{ spid: 13, preset: 18 }] }] },
    ]),
  });
  const c = ctx();
  const out = convertSlide(ds, { ...slideCtx(), notes: c.notes });
  const [a, b, f, u] = out.objects;
  assert.deepEqual(a!.timing, { appear: "click", step: 1, start: 0, visibleFor: null });
  assert.deepEqual(a!.animation.enter, { effect: "none", duration: 500 });
  assert.deepEqual(b!.timing, { appear: "click", step: 2, start: 0, visibleFor: null });
  assert.deepEqual(b!.animation.enter, { effect: "fade", duration: 700 });
  assert.deepEqual(f!.timing, { appear: "click", step: 2, start: 250, visibleFor: null }, "with the one before it, a quarter second after the press");
  assert.deepEqual(f!.animation.enter, { effect: "slideLeft", duration: 400 }, "flying in from the left");
  assert.deepEqual(u!.animation.enter, { effect: "fade", duration: 500 }, "an effect this editor does not have fades");
  assert.deepEqual([c.notes.animated, c.notes.animationApproximated, c.notes.waiting], [4, 1, 4]);
  assert.deepEqual(out.objects.map((o) => o.timing.appear), ["click", "click", "click", "click"]);
});

test("animation: an effect that starts by itself becomes a time after the slide opens", () => {
  const ds = one(SHAPES(1), {}, { timing: timing([{ auto: true, groups: [{ delay: 1000, effects: [{ spid: 10, preset: 10, node: "afterEffect", delay: 500 }] }] }]) });
  const [o] = convertSlide(ds, slideCtx()).objects;
  assert.deepEqual(o!.timing, { appear: "time", start: 1500, visibleFor: null });
});

test("animation: an effect on a group is an effect on everything in it, and a shape with no effect is left alone", () => {
  const inner = sp({ id: 21, name: "A", box: { x: 0, y: 0, w: 1, h: 1 }, geom: "rect", fill: "FF0000" }) + sp({ id: 22, name: "B", box: { x: 1, y: 0, w: 1, h: 1 }, geom: "rect", fill: "00FF00" });
  const ds = one(group(20, "Pair", { x: 0, y: 0, w: 2, h: 1 }, { x: 0, y: 0, w: 2, h: 1 }, inner) + SHAPES(1), {}, { timing: timing([{ groups: [{ effects: [{ spid: 20, preset: 10 }] }] }]) });
  const out = convertSlide(ds, slideCtx());
  assert.deepEqual(out.objects.map((o) => o.timing.appear), ["click", "click", "time"]);
  assert.deepEqual(out.objects.slice(0, 2).map((o) => (o.timing as { step?: number }).step), [1, 1], "they appear together");
});

test("animation: the report says what was brought in and what was not", () => {
  const ds = one(SHAPES(3), {}, {
    timing: timing([{ groups: [{ effects: [{ spid: 10, preset: 10 }, { spid: 11, preset: 18, node: "withEffect" }, { spid: 12, cls: "exit" }] }] }]),
  });
  const notes = newNotes();
  const converted = [convertSlide(ds, { ...slideCtx(), notes })];
  const report = describeImport({ slideWidth: inch(13.333), slideHeight: inch(7.5), slides: [ds] }, converted, notes, ppi96, [0]).join("\n");
  assert.match(report, /2 objects had an entrance animation in PowerPoint and have it here\. 2 objects wait for the learner: a button, Show next item/);
  assert.match(report, /1 entrance used an effect this editor does not have, so it fades in instead/);
  assert.match(report, /Not brought in: 1 exit effect/);
});


// ---- speaker notes

const NOTED = () => sp({ id: 2, name: "Title 1", ph: { type: "title" }, paras: [{ runs: [{ t: "Welcome" }] }] }) + sp({ id: 3, name: "Body", ph: { type: "body", idx: 1 }, paras: [{ runs: [{ t: "One" }] }] });

test("notes: the speaker notes are read, a line for each paragraph, and the slide's number on the notes page is not part of them", () => {
  const ds = one(NOTED(), {}, { notes: "First thing to say.\nAnd then another" });
  assert.equal(ds.hasNotes, true);
  assert.equal(ds.notes, "First thing to say.\nAnd then another");
  assert.equal(one(NOTED()).hasNotes, false);
  assert.equal(one(NOTED()).notes, "");
});

test("notes: read aloud, each paragraph ends in a stop, so the voice pauses between them", () => {
  assert.equal(scriptFromNotes("First thing to say.\nAnd then another\n\nWhat now?"), "First thing to say. And then another. What now?");
  assert.equal(scriptFromNotes("He said “stop.”"), "He said “stop.”");
});

test("notes: with the choice made, a slide's notes are the narration of its title, in the voice given, and the words are not put on the slide", () => {
  const ds = one(NOTED(), {}, { notes: "Say this first.\nThen this" });
  const c = ctx();
  const out = convertSlide(ds, { ...slideCtx(), notes: c.notes, narrate: (script) => newNarration(script, undefined) });
  const [title, body] = out.objects;
  assert.equal((title!.narration as unknown as { script: string }).script, "Say this first. Then this.");
  assert.equal(body!.narration, null);
  assert.equal(out.objects.length, 2, "nothing was added to the slide");
  assert.equal(c.notes.narrated, 1);
});

test("notes: without the choice nothing is made, and the report says how to ask for it", () => {
  const ds = one(NOTED(), {}, { notes: "Say this." });
  const notes = newNotes();
  const converted = [convertSlide(ds, { ...slideCtx(), notes })];
  assert.equal(converted[0]!.objects.every((o) => o.narration === null), true);
  const report = describeImport({ slideWidth: inch(13.333), slideHeight: inch(7.5), slides: [ds] }, converted, notes, ppi96, [0]).join("\n");
  assert.match(report, /Speaker notes on 1 slide were not brought in\. To have them as narration, tick "Use speaker notes as narration"/);
});

test("notes: the report says how many slides got them, and a slide with nothing to say them is named", () => {
  const withTitle = one(NOTED(), {}, { notes: "Say this." });
  const onlyBar = one(sp({ id: 9, name: "Bar", box: { x: 0, y: 0, w: 4, h: 0.1 }, geom: "rect", fill: "FF0000" }), {}, { notes: "Nobody can say this." });
  const notes = newNotes();
  const narrate = (script: string) => newNarration(script, undefined);
  const converted = [convertSlide(withTitle, { ...slideCtx(), notes, narrate }), convertSlide(onlyBar, { ...slideCtx(), notes, narrate })];
  assert.deepEqual([notes.narrated, notes.notesUnused], [1, 1]);
  const report = describeImport({ slideWidth: inch(13.333), slideHeight: inch(7.5), slides: [withTitle, onlyBar] }, converted, notes, ppi96, [0, 1]).join("\n");
  assert.match(report, /Speaker notes became the narration of 1 slide/);
  assert.match(report, /Speaker notes on 1 slide could not become narration, because everything on that slide is decoration/);
});

// ---- what a layout and a master draw on every slide, and a background that repeats

const BAR = sp({ id: 20, name: "Colour bar", box: { x: 0, y: 7, w: 10, h: 0.2 }, geom: "rect", fill: "0F6BAE" });
const LOGO = pic(21, "Logo", "rIdMedia1", { x: 8, y: 0.2, w: 1, h: 0.6 });
const TITLE_PH = sp({ id: 22, name: "Title placeholder", ph: { type: "title" }, box: { x: 0.5, y: 0.3, w: 9, h: 1.2 }, paras: [{ runs: [{ t: "Click to edit the title" }] }] });
const SLIDE_TITLE = sp({ id: 2, name: "Title 1", ph: { type: "title" }, paras: [{ runs: [{ t: "Welcome" }] }] });

test("template: the shapes a layout and a master draw come in behind the slide's own, and placeholders there are not shapes", () => {
  const ds = read({ layoutShapes: BAR + TITLE_PH, masterShapes: LOGO, media: { "image1.png": fakePng(1) }, slides: [{ id: 256, shapes: SLIDE_TITLE }] }).slides[0]!;
  assert.deepEqual(ds.shapes.map((s) => [s.id, s.name, s.template]), [["m21", "Logo", "master"], ["l20", "Colour bar", "layout"], ["2", "Title 1", undefined]]);
});

test("template: they are decoration, hidden from a screen reader, and stacked behind", () => {
  const ds = read({ layoutShapes: BAR + TITLE_PH, masterShapes: LOGO, media: { "image1.png": fakePng(1) }, slides: [{ id: 256, shapes: SLIDE_TITLE }] }).slides[0]!;
  const out = convertSlide(ds, slideCtx());
  assert.deepEqual(out.objects.map((o) => [o.name, o.accessibility.decorative, o.accessibility.tabOrder, o.accessibility.role]), [
    ["Logo", true, 0, "presentation"], ["Colour bar", true, 0, "presentation"], ["Title 1", false, 1, "heading"],
  ]);
  assert.ok(out.objects[0]!.geometry.z < out.objects[2]!.geometry.z);
});

test("template: a slide that hides background graphics, or a layout that hides the master's, shows less", () => {
  const spec = (over: Partial<DeckSpec>, slide: Partial<DeckSpec["slides"][number]> = {}) => read({ layoutShapes: BAR + TITLE_PH, masterShapes: LOGO, media: { "image1.png": fakePng(1) }, slides: [{ id: 256, shapes: SLIDE_TITLE, ...slide }], ...over }).slides[0]!.shapes.map((s) => s.name);
  assert.deepEqual(spec({}), ["Logo", "Colour bar", "Title 1"]);
  assert.deepEqual(spec({}, { hideMaster: true }), ["Title 1"]);
  assert.deepEqual(spec({ layoutHidesMaster: true }), ["Colour bar", "Title 1"]);
});

test("template: a picture on the master is found in the master's own files, and comes in with its picture", () => {
  const ds = read({ masterShapes: LOGO, media: { "image1.png": fakePng(7) }, slides: [{ id: 256, shapes: SLIDE_TITLE }] }).slides[0]!;
  const logo = convertSlide(ds, { ...slideCtx(), bytesOf: () => fakePng(7) });
  assert.equal(logo.objects[0]!.type, "image");
  assert.equal(logo.assets.length, 1);
});

test("template: the report says how many, and that they are decoration", () => {
  const ds = read({ layoutShapes: BAR + TITLE_PH, masterShapes: LOGO, media: { "image1.png": fakePng(1) }, slides: [{ id: 256, shapes: SLIDE_TITLE }, { id: 257, shapes: SLIDE_TITLE }] });
  const notes = newNotes();
  const converted = ds.slides.map((s) => convertSlide(s, { ...slideCtx(), notes }));
  const report = describeImport(ds, converted, notes, ppi96, [0, 1]).join("\n");
  assert.match(report, /2 shapes that the layouts and master draw on every slide \(a bar, a logo, a corner mark\) were brought in on 2 slides as decoration/);
});

test("background: a picture that repeats is not drawn, and the slide gets its average colour instead, and says so", () => {
  const ds = read({ media: { "image1.png": fakePng(3) }, slides: [{ id: 256, shapes: SLIDE_TITLE, backgroundTile: "image1.png" }] }).slides[0]!;
  assert.equal(ds.backgroundPicture, null);
  assert.ok(ds.backgroundTile);
  const tones = new Map([[ds.backgroundTile!.mediaHash, "#eeeeee"]]);
  const out = convertSlide(ds, { ...slideCtx(), tones });
  assert.equal(out.background, "#eeeeee");
  assert.equal(out.objects.some((o) => o.name === "Background picture"), false, "no picture is put on the slide");
  const notes = newNotes();
  const report = describeImport({ slideWidth: inch(13.333), slideHeight: inch(7.5), slides: [ds] }, [out], notes, ppi96, [0]).join("\n");
  assert.match(report, /1 slide had a picture that repeats across the background\. It is drawn here as one colour/);
  assert.doesNotMatch(report, /tiled picture, which is left out/);
});

// ---- groups that are turned or flipped, and slide numbers

const bar = (id: number, name: string, y: number) => sp({ id, name, box: { x: 0, y, w: 0.5, h: 2 }, geom: "rect", fill: "FF0000" });

test("group: a thin tall group turned three quarters of a turn lies across the slide, its shapes in order from the left", () => {
  const inner = bar(21, "A", 0) + bar(22, "B", 2);
  const ds = one(group(20, "Stripe", { x: 3, y: 0.5, w: 0.5, h: 4 }, { x: 0, y: 0, w: 0.5, h: 4 }, inner, { rot: 270 }));
  const [a, b] = ds.shapes;
  assert.deepEqual([a!.box.x, a!.box.y, a!.box.cx, a!.box.cy, Math.round(a!.rot)], [inch(2), inch(1.5), inch(0.5), inch(2), 270]);
  assert.deepEqual([b!.box.x, b!.box.y, Math.round(b!.rot)], [inch(4), inch(1.5), 270], "the shape that was lower is now to the right");
});

test("group: flipping a group first mirrors where its shapes are, and a group that is not turned is as it was", () => {
  const inner = bar(21, "A", 0) + bar(22, "B", 2);
  const plain = one(group(20, "Plain", { x: 3, y: 0.5, w: 0.5, h: 4 }, { x: 0, y: 0, w: 0.5, h: 4 }, inner));
  assert.deepEqual(plain.shapes.map((s) => [s.box.x, s.box.y, s.rot]), [[inch(3), inch(0.5), 0], [inch(3), inch(2.5), 0]]);
  const flipped = one(group(20, "Flipped", { x: 3, y: 0.5, w: 0.5, h: 4 }, { x: 0, y: 0, w: 0.5, h: 4 }, inner, { flipV: true }));
  assert.deepEqual(flipped.shapes.map((s) => [s.box.x, s.box.y]), [[inch(3), inch(2.5)], [inch(3), inch(0.5)]], "A and B swap places");
});

test("group: a group inside a turned group is turned with it", () => {
  const inside = group(30, "Inner", { x: 0, y: 0, w: 0.5, h: 2 }, { x: 0, y: 0, w: 0.5, h: 2 }, bar(31, "Deep", 0));
  const ds = one(group(20, "Outer", { x: 3, y: 0.5, w: 0.5, h: 4 }, { x: 0, y: 0, w: 0.5, h: 4 }, inside, { rot: 90 }));
  assert.equal(Math.round(ds.shapes[0]!.rot), 90);
});

test("text: a slide number or a date that PowerPoint fills in is not kept as words, and is counted with the footers", () => {
  const withNumber = '<p:sp><p:nvSpPr><p:cNvPr id="9" name="Number"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100000" y="100000"/><a:ext cx="900000" cy="300000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="F58426"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="{1}" type="slidenum"><a:rPr lang="en-US"/><a:t>‹#›</a:t></a:fld></a:p></p:txBody></p:sp>';
  const ds = one(withNumber);
  assert.equal(ds.shapes[0]!.kind, "shape", "with no words left it is just the coloured shape");
  assert.equal(ds.left.footers, 1);
});

// ---- table text size

const sizedTable = (sz: number | null) => {
  const run = (t: string) => `<a:r><a:rPr lang="en-US"${sz === null ? "" : ` sz="${sz * 100}"`}/><a:t>${t}</a:t></a:r>`;
  const cell = (t: string) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${run(t)}</a:p></a:txBody><a:tcPr/></a:tc>`;
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="Grid"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="${inch(6)}" cy="${inch(2)}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid/><a:tr h="370840">${cell("Name")}${cell("A longer cell with many more words in it")}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
};

test("table: the words of a table are the size the deck made them, so a table that was small stays small", () => {
  const [small] = convert1(sizedTable(8));
  assert.equal(small!.style["fontSize"], 11, "8 points at 96 to the inch");
  const [none] = convert1(sizedTable(null));
  assert.equal(none!.style["fontSize"], 18, "a table that says nothing keeps the size tables have always had here");
});

// ---- real decks, when someone points the test at a folder of them: set OPENSTAGE_REAL_DECKS to the folder, then run npm test

const REAL = process.env["OPENSTAGE_REAL_DECKS"] ?? "";
test("real decks are read and converted without trouble", { skip: REAL === "" || !existsSync(REAL) }, () => {
  for (const file of readdirSync(REAL).filter((f) => f.endsWith(".pptx"))) {
    const deck = readDeck(openDeck(new Uint8Array(readFileSync(path.join(REAL, file)))));
    assert.ok(deck.slides.length > 0, file);
    const placement = placementFor(deck.slideWidth, deck.slideHeight, { width: 1280, height: 720 });
    let n = 0;
    for (const ds of deck.slides) {
      const converted = convertSlide(ds, { ...ctx({ placement, bytesOf: () => fakePng(1) }), deckId: "deck-real", importedAt: "2026-10-13T00:00:00Z", newId: () => `obj-${++n}`, slideWidth: deck.slideWidth, slideHeight: deck.slideHeight });
      for (const o of converted.objects) {
        assert.ok(o.geometry.width >= 1 && o.geometry.height >= 1, `${file} ${ds.name} ${o.name}`);
        assert.ok(o.name.length > 0);
      }
    }
  }
});
