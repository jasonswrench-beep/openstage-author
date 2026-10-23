import assert from "node:assert/strict";
import { test } from "node:test";
import { SPAN_SIZE, safeSpanStyle, spanColour, spanSize, spanStyleFor } from "./spanstyle.ts";

test("a colour is six lower case hex digits, from hex or rgb(), and anything else is refused", () => {
  assert.equal(spanColour("#C00000"), "#c00000");
  assert.equal(spanColour(" #0a0 "), "#00aa00");
  assert.equal(spanColour("rgb(192, 0, 0)"), "#c00000");
  assert.equal(spanColour("rgba(0,0,255,0.5)"), "#0000ff");
  for (const bad of ["red", "var(--x)", "url(javascript:alert(1))", "#12", "#12345", "rgb(300,0,0)", "rgb(1,2)", "expression(1)", ""]) assert.equal(spanColour(bad), null, bad);
});

test("a size is a whole percentage within what a span may have", () => {
  assert.equal(spanSize("120%"), 120);
  assert.equal(spanSize(" 85.4% "), 85);
  assert.equal(spanSize(`${SPAN_SIZE.min}%`), 50);
  assert.equal(spanSize(`${SPAN_SIZE.max}%`), 300);
  for (const bad of ["49%", "301%", "12px", "1.2em", "large", "120", "%", "-120%"]) assert.equal(spanSize(bad), null, bad);
});

test("of a style only the colour and the size survive, written one way", () => {
  assert.equal(safeSpanStyle("color: #C00000; font-size: 120%"), "color:#c00000;font-size:120%");
  assert.equal(safeSpanStyle("font-size:80%;color:rgb(0, 0, 255)"), "color:#0000ff;font-size:80%");
  assert.equal(safeSpanStyle("background:url(x);position:fixed;font-family:Comic Sans;color:#fff"), "color:#ffffff");
  assert.equal(safeSpanStyle("color:red;font-size:12px"), "", "a name and a pixel size are not kept");
  assert.equal(safeSpanStyle("color:#abc;color:javascript:1"), "color:#aabbcc", "a later bad colour does not undo a good one");
  assert.equal(safeSpanStyle(undefined), "");
  assert.equal(safeSpanStyle(""), "");
  assert.equal(safeSpanStyle("not a style"), "");
});

test("the import writes the style for a part of a text that has its own colour or size", () => {
  assert.equal(spanStyleFor("#C00000", 120), "color:#c00000;font-size:120%");
  assert.equal(spanStyleFor("#c00000", undefined), "color:#c00000");
  assert.equal(spanStyleFor(undefined, 80), "font-size:80%");
  assert.equal(spanStyleFor(undefined, undefined), "");
  assert.equal(spanStyleFor(undefined, 10), "", "too small to be kept");
});
