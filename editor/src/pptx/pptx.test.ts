// Tests for reading a PowerPoint deck and turning it into OpenStage slides: the XML reader, the package, the deck reader and the converter.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { convertShape, convertSlide, newNotes, parasToHtml, placementFor, snapshotOf, type ConvertContext, type SlideContext } from "./convert.ts";
import { readDeck, type DeckShape } from "./deck.ts";
import { fingerprint, hashBytes, hashText } from "./hash.ts";
import { openDeck, resolveTarget } from "./package.ts";
import { buildDeck, chart, connector, fakePng, group, inch, pic, sp, table, type DeckSpec } from "./testdeck.ts";
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
