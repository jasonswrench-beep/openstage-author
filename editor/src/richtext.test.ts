// Formatted text: reading HTML into a tree, and turning what a browser's editing box makes into the plain kind of HTML the editor keeps.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parasToHtml } from "./pptx/convert.ts";
import { cleanHtml, parseHtml, plainLines, serialize } from "./richtext.ts";

test("HTML is read into a tree: tags, attributes, entities, line breaks that need no closing, and tags nobody closed", () => {
  const tree = parseHtml('<p class="x">One &amp; two<br>three <a href="https://a.org/?q=1&amp;r=2">link</a></p><p>open');
  assert.equal(serialize(tree), '<p class="x">One &amp; two<br>three <a href="https://a.org/?q=1&amp;r=2">link</a></p><p>open</p>', "the tree keeps what it read, and the cleaner is what drops attributes");
  assert.equal((tree[0] as { attrs: Record<string, string> }).attrs["class"], "x");
  assert.deepEqual(parseHtml("a &lt; b &#65;&#x42; &nbsp;"), ["a < b AB  "]);
  assert.deepEqual(parseHtml("<script>alert(1)</script>words<style>p{}</style>"), ["words"], "script and style go with what is in them");
  assert.equal(serialize(parseHtml("<!-- note --><p>x</p>")), "<p>x</p>");
});

test("what the PowerPoint import writes is already in the kept form, so cleaning changes nothing", () => {
  const samples = [
    "<h1>A title</h1>",
    "<p>One</p><p>Two</p>",
    "<ul><li>One</li><li>Two<ul><li>Deeper</li></ul></li></ul>",
    "<ol><li>First</li><li>Second</li></ol>",
    '<p>He <strong>said</strong> <em>no</em>, <u>twice</u>, <a href="https://example.org">here</a>, H<sub>2</sub>O and x<sup>2</sup>.</p>',
    "<p>Line one<br>Line two</p>",
    "<h2>Heading</h2><p>Words</p><ul><li>Item</li></ul>",
  ];
  for (const s of samples) assert.equal(cleanHtml(s), s, s);
  assert.equal(parasToHtml([{ level: 0, bullet: "dot", runs: [{ text: "One", bold: true }] }, { level: 1, bullet: "dot", runs: [{ text: "Two" }] }], false, false), "<ul><li><strong>One</strong><ul><li>Two</li></ul></li></ul>");
  assert.equal(cleanHtml(parasToHtml([{ level: 0, bullet: "dot", runs: [{ text: "One", bold: true }] }, { level: 1, bullet: "dot", runs: [{ text: "Two" }] }], false, false)), "<ul><li><strong>One</strong><ul><li>Two</li></ul></li></ul>");
});

test("an editing box's divs and loose words become paragraphs, and its empty lines go", () => {
  assert.equal(cleanHtml("<div>One</div><div>Two<br></div><div><br></div>"), "<p>One</p><p>Two</p>");
  assert.equal(cleanHtml("Loose words<div>Next</div>"), "<p>Loose words</p><p>Next</p>");
  assert.equal(cleanHtml("<p></p><p> </p><p><br></p><p>Kept</p>"), "<p>Kept</p>");
  assert.equal(cleanHtml(""), "");
  assert.equal(cleanHtml("<div><br></div>"), "");
});

test("bold, italic and underline written as tags, old tags or styles all become the same marks", () => {
  assert.equal(cleanHtml("<p><b>a</b> <i>b</i> <u>c</u></p>"), "<p><strong>a</strong> <em>b</em> <u>c</u></p>");
  assert.equal(cleanHtml('<p><span style="font-weight: bold;">a</span><span style="font-style: italic; text-decoration: underline">b</span></p>'), "<p><strong>a</strong><em><u>b</u></em></p>");
  assert.equal(cleanHtml("<p><strong>a</strong><strong>b</strong> <em>c</em><em>d</em></p>"), "<p><strong>ab</strong> <em>cd</em></p>", "marks that touch are one mark");
  assert.equal(cleanHtml("<p>x<strong></strong>y</p>"), "<p>xy</p>", "an empty mark goes");
});

test("a list inside a list, the way an editing box makes a deeper level, goes inside the item before it", () => {
  assert.equal(cleanHtml("<ul><li>One</li><ul><li>Two</li><li>Three</li></ul><li>Four</li></ul>"), "<ul><li>One<ul><li>Two</li><li>Three</li></ul></li><li>Four</li></ul>");
  assert.equal(cleanHtml("<ul><ul><li>Only deep</li></ul></ul>"), "<ul><li><ul><li>Only deep</li></ul></li></ul>");
  assert.equal(cleanHtml("<ul><li>One</li><li><br></li><li></li></ul>"), "<ul><li>One</li></ul>", "empty items go");
  assert.equal(cleanHtml("<ul><li></li></ul>"), "");
  assert.equal(cleanHtml("<ol><li><p>Para in item</p></li></ol>"), "<ol><li>Para in item</li></ol>");
});

test("spaces: a non-breaking space is a space, a run of spaces is one, and the ends of a line are trimmed", () => {
  assert.equal(cleanHtml("<p>a&nbsp;&nbsp;b   c</p>"), "<p>a b c</p>");
  assert.equal(cleanHtml("<p>  padded  </p>"), "<p>padded</p>");
  assert.equal(cleanHtml("<p><strong> x </strong> y</p>"), "<p><strong>x</strong> y</p>");
});

test("line breaks stay between words and go at the ends of a line", () => {
  assert.equal(cleanHtml("<p>a<br>b</p>"), "<p>a<br>b</p>");
  assert.equal(cleanHtml("<p>a<br></p>"), "<p>a</p>");
  assert.equal(cleanHtml("<p><br>a</p>"), "<p>a</p>");
  assert.equal(cleanHtml("<p>a<br><br>b</p>"), "<p>a<br><br>b</p>");
});

test("a link keeps its address if it is a web or mail address, and loses everything else about it", () => {
  assert.equal(cleanHtml('<p><a href="https://x.org" target="_blank" rel="noopener" style="color:red">go</a></p>'), '<p><a href="https://x.org">go</a></p>');
  assert.equal(cleanHtml('<p><a href="mailto:a@b.org">mail</a></p>'), '<p><a href="mailto:a@b.org">mail</a></p>');
  assert.equal(cleanHtml('<p><a href="javascript:alert(1)">bad</a></p>'), "<p>bad</p>", "the words stay, the link does not");
  assert.equal(cleanHtml('<p><a href="data:text/html,x">bad</a></p>'), "<p>bad</p>");
  assert.equal(cleanHtml('<p><a>none</a></p>'), "<p>none</p>");
});

test("headings stay headings, a font tag goes, a language on a span stays, and styles and classes go", () => {
  assert.equal(cleanHtml('<h2 style="color:red" class="x">Title</h2>'), "<h2>Title</h2>");
  assert.equal(cleanHtml('<p><font color="red" face="Arial">red</font></p>'), "<p>red</p>");
  assert.equal(cleanHtml('<p>Say <span lang="fr">bonjour</span></p>'), '<p>Say <span lang="fr">bonjour</span></p>');
  assert.equal(cleanHtml('<p><span lang="not valid!">x</span></p>'), "<p>x</p>");
  assert.equal(cleanHtml('<p style="text-align:center">x</p>'), "<p>x</p>");
});

test("script and style are never kept, and the angle brackets of words are written as words", () => {
  assert.equal(cleanHtml("<p>a<script>alert(1)</script>b</p>"), "<p>ab</p>");
  assert.equal(cleanHtml("<p>1 &lt; 2 &amp; 3 &gt; 2</p>"), "<p>1 &lt; 2 &amp; 3 &gt; 2</p>");
  assert.equal(cleanHtml("<p>{{Score}} points</p>"), "<p>{{Score}} points</p>", "a value shown in the text is only words");
});

test("a block quote keeps its blocks", () => {
  assert.equal(cleanHtml("<blockquote><p>Quoted</p><p>More</p></blockquote>"), "<blockquote><p>Quoted</p><p>More</p></blockquote>");
});

test("cleaning twice is cleaning once, whatever it is given", () => {
  const messy = [
    "<div>One<div>Two</div></div><ul><li>a</li><ul><li>b</li></ul></ul>text <b>bold</b>",
    "<p><span style='font-weight:700'>x</span><br><br></p><div><br></div>",
    "<h1><b>T</b></h1><p>&nbsp;</p><ol><li><div>i</div><div>j</div></li></ol>",
    "<p>a<p>b",
  ];
  for (const s of messy) {
    const once = cleanHtml(s);
    assert.equal(cleanHtml(once), once, s);
    assert.equal(/<(div|span(?! lang)|b|i|font|script|style)\b/.test(once), false, once);
  }
});

test("what it writes uses only tags the player will show", () => {
  const allowed = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li", "strong", "em", "u", "br", "span", "sup", "sub", "blockquote", "a", "abbr", "code"]);
  const out = cleanHtml('<div><b>a</b><table><tr><td>cell</td></tr></table><center>mid</center><img src="x.png"><iframe src="y"></iframe></div>');
  for (const m of out.matchAll(/<\/?([a-z0-9]+)/g)) assert.ok(allowed.has(m[1]!), `${m[1]} in ${out}`);
  assert.match(out, /cell/);
  assert.match(out, /mid/);
});

test("the plain lines of some text are one for each paragraph, heading and list item, in order", () => {
  assert.deepEqual(plainLines("<h1>Title</h1><p>Some <strong>words</strong>.</p><ul><li>One<ul><li>Deeper</li></ul></li><li>Two</li></ul>"), ["Title", "Some words.", "One", "Deeper", "Two"]);
  assert.deepEqual(plainLines(""), []);
});
