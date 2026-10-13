import assert from "node:assert/strict";
import { test } from "node:test";
import { alignBoxes, bounds, distributeBoxes, type Box } from "./align.ts";

const a: Box = { x: 100, y: 50, width: 200, height: 80 };
const b: Box = { x: 400, y: 200, width: 100, height: 40 };
const c: Box = { x: 250, y: 420, width: 300, height: 120 };

test("bounds is the smallest box that holds them all", () => {
  assert.deepEqual(bounds([a, b, c]), { x: 100, y: 50, width: 450, height: 490 });
  assert.deepEqual(bounds([a]), a);
});

test("aligning several objects lines them up with each other, and no size changes", () => {
  const sizes = (boxes: Box[]) => boxes.map((x) => [x.width, x.height]);
  assert.deepEqual(alignBoxes([a, b, c], "left", null).map((x) => x.x), [100, 100, 100]);
  assert.deepEqual(alignBoxes([a, b, c], "right", null).map((x) => x.x), [350, 450, 250], "the right edges all end at 550");
  assert.deepEqual(alignBoxes([a, b, c], "centre", null).map((x) => x.x), [225, 275, 175], "centres at 325");
  assert.deepEqual(alignBoxes([a, b, c], "top", null).map((x) => x.y), [50, 50, 50]);
  assert.deepEqual(alignBoxes([a, b, c], "bottom", null).map((x) => x.y), [460, 500, 420], "the bottom edges all end at 540");
  assert.deepEqual(alignBoxes([a, b, c], "middle", null).map((x) => x.y), [255, 275, 235], "middles at 295");
  assert.deepEqual(sizes(alignBoxes([a, b, c], "left", null)), sizes([a, b, c]));
});

test("aligning leaves the other direction alone", () => {
  const out = alignBoxes([a, b, c], "left", null);
  assert.deepEqual(out.map((x) => x.y), [50, 200, 420]);
  const up = alignBoxes([a, b, c], "top", null);
  assert.deepEqual(up.map((x) => x.x), [100, 400, 250]);
});

test("one object aligns with the slide", () => {
  const slide: Box = { x: 0, y: 0, width: 1280, height: 720 };
  assert.deepEqual(alignBoxes([a], "centre", slide)[0], { ...a, x: 540 });
  assert.deepEqual(alignBoxes([a], "right", slide)[0], { ...a, x: 1080 });
  assert.deepEqual(alignBoxes([a], "middle", slide)[0], { ...a, y: 320 });
  assert.deepEqual(alignBoxes([a], "bottom", slide)[0], { ...a, y: 640 });
  assert.deepEqual(alignBoxes([a], "left", slide)[0], { ...a, x: 0 });
  assert.deepEqual(alignBoxes([a], "top", slide)[0], { ...a, y: 0 });
});

test("nothing to align is nothing", () => {
  assert.deepEqual(alignBoxes([], "left", null), []);
});

test("spacing out three or more makes the gaps equal and keeps the outer two where they are", () => {
  const row: Box[] = [
    { x: 0, y: 0, width: 100, height: 50 },
    { x: 150, y: 0, width: 100, height: 50 },
    { x: 700, y: 0, width: 100, height: 50 },
  ];
  const out = distributeBoxes(row, "horizontal");
  assert.deepEqual(out.map((x) => x.x), [0, 350, 700], "the gaps are 250 each");
  assert.deepEqual(out.map((x) => x.y), [0, 0, 0]);
  const col: Box[] = [
    { x: 0, y: 0, width: 50, height: 100 },
    { x: 0, y: 10, width: 50, height: 100 },
    { x: 0, y: 20, width: 50, height: 100 },
    { x: 0, y: 500, width: 50, height: 100 },
  ];
  const down = distributeBoxes(col, "vertical");
  const gaps = [down[1]!.y - (down[0]!.y + 100), down[2]!.y - (down[1]!.y + 100), down[3]!.y - (down[2]!.y + 100)];
  assert.ok(gaps.every((g) => Math.abs(g - gaps[0]!) < 0.01), `equal gaps, got ${gaps}`);
  assert.equal(down[0]!.y, 0);
  assert.equal(down[3]!.y, 500);
});

test("spacing out follows position, not the order the objects were given in", () => {
  const given: Box[] = [
    { x: 700, y: 0, width: 100, height: 50 },
    { x: 0, y: 0, width: 100, height: 50 },
    { x: 150, y: 0, width: 100, height: 50 },
  ];
  assert.deepEqual(distributeBoxes(given, "horizontal").map((x) => x.x), [700, 0, 350], "the result is in the order given, each in its own place in the row");
});

test("fewer than three have nothing between them to space out", () => {
  assert.deepEqual(distributeBoxes([a, b], "horizontal"), [a, b]);
  assert.deepEqual(distributeBoxes([a], "vertical"), [a]);
});

test("a result is never the same object as the input", () => {
  const out = distributeBoxes([a, b, c], "horizontal");
  out[0]!.x = -999;
  assert.equal(a.x, 100);
});
