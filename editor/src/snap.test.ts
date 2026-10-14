import assert from "node:assert/strict";
import { test } from "node:test";
import { snapMove, snapResize, type Box } from "./snap.ts";

const stage = { width: 1280, height: 720 };
const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

test("a box dragged near the slide's left or top edge jumps to it", () => {
  const r = snapMove(box(5, 3, 200, 100), [], stage, 8);
  assert.deepEqual([r.dx, r.dy], [-5, -3]);
  assert.ok(r.guides.some((g) => g.axis === "vertical" && g.at === 0));
  assert.ok(r.guides.some((g) => g.axis === "horizontal" && g.at === 0));
});

test("a box near the slide's right or bottom edge jumps to it by its own right or bottom edge", () => {
  const r = snapMove(box(1074, 615, 200, 100), [], stage, 8);
  assert.deepEqual([r.dx, r.dy], [6, 5]);
});

test("a box whose middle is near the middle of the slide jumps to the middle", () => {
  const r = snapMove(box(535, 255, 200, 100), [], stage, 8);
  assert.deepEqual([r.dx, r.dy], [5, 5], "its middle, 635, is 5 from the slide's middle at 640, and its bottom edge, 355, is 5 from the slide's middle at 360");
});

test("only the direction that is close jumps", () => {
  const r = snapMove(box(4, 300, 200, 100), [], stage, 8);
  assert.equal(r.dx, -4);
  assert.equal(r.dy, 0);
  assert.ok(r.guides.every((g) => g.axis === "vertical"), "no horizontal guide, since nothing lined up that way");
});

test("nothing close means no jump and no guides", () => {
  const r = snapMove(box(100, 100, 200, 100), [], stage, 8);
  assert.deepEqual([r.dx, r.dy, r.guides.length], [0, 0, 0]);
});

test("a box lines up with the edges and the middle of another object", () => {
  const other = box(300, 200, 400, 100);
  // Its left edge near the other's left edge
  assert.equal(snapMove(box(304, 400, 100, 50), [other], stage, 8).dx, -4);
  // Its right edge near the other's right edge (700)
  assert.equal(snapMove(box(603, 400, 100, 50), [other], stage, 8).dx, -3);
  // Its middle near the other's middle (500)
  assert.equal(snapMove(box(452, 400, 100, 50), [other], stage, 8).dx, -2);
  // Its left edge near the other's right edge, so they sit side by side
  assert.equal(snapMove(box(706, 220, 100, 50), [other], stage, 8).dx, -6);
  // Its top near the other's bottom, so one sits on the other
  assert.equal(snapMove(box(900, 305, 100, 50), [other], stage, 8).dy, -5);
});

test("the nearest line wins when two are within reach", () => {
  const a = box(100, 0, 100, 50);      // lines at 100, 150, 200
  const b = box(110, 100, 100, 50);    // lines at 110, 160, 210
  const r = snapMove(box(103, 400, 40, 40), [a, b], stage, 8);
  assert.equal(r.dx, -3, "100 is 3 away and 110 is 7 away");
});

test("the guide spans the box and what it lined up with", () => {
  const other = box(300, 200, 400, 100);
  const r = snapMove(box(304, 500, 100, 50), [other], stage, 8);
  const guide = r.guides.find((g) => g.axis === "vertical" && g.at === 300)!;
  assert.ok(guide, "a vertical line at 300");
  assert.equal(guide.from, 200, "from the top of the other object");
  assert.equal(guide.to, 550, "to the bottom of the dragged box");
});

test("a box that is already on a line still draws the guide", () => {
  const r = snapMove(box(0, 300, 100, 50), [], stage, 8);
  assert.equal(r.dx, 0);
  assert.ok(r.guides.some((g) => g.at === 0 && g.axis === "vertical"));
});

test("the threshold is in stage pixels, so a zoomed-out canvas needs a bigger one", () => {
  assert.equal(snapMove(box(12, 300, 100, 50), [], stage, 8).dx, 0);
  assert.equal(snapMove(box(12, 300, 100, 50), [], stage, 16).dx, -12);
});

test("resizing moves only the edges that move, and only those jump", () => {
  // Dragging the right edge (e) to 1275, near the slide's right edge at 1280. The left edge at 5 is near 0 but is not moving.
  const r = snapResize(box(5, 100, 1270, 100), "e", [], stage, 8, 8);
  assert.deepEqual(r.box, box(5, 100, 1275, 100));
  assert.ok(r.guides.some((g) => g.at === 1280), "a guide at the edge it jumped to");
  assert.ok(!r.guides.some((g) => g.at === 0), "no guide for the edge that did not move");
});

test("the north west corner snaps its left and top edges together", () => {
  const r = snapResize(box(6, 4, 300, 200), "nw", [], stage, 8, 8);
  assert.deepEqual(r.box, box(0, 0, 306, 204), "the far edges stay where they were, so the box grows");
});

test("a jump that would make the box too small is not made", () => {
  const other = box(0, 0, 10, 10);
  const r = snapResize(box(8, 100, 10, 50), "w", [other], stage, 8, 9);
  assert.deepEqual(r.box, box(8, 100, 10, 50), "the left edge is 2 from the line at 10, but jumping there would leave the box 8 wide, under the 9 it needs");
  const allowed = snapResize(box(8, 100, 10, 50), "w", [other], stage, 8, 8);
  assert.deepEqual(allowed.box, box(10, 100, 8, 50), "with room for 8, it jumps");
});

test("an object's own edges are not targets unless the caller lists it", () => {
  // The caller leaves out what is being dragged, so a box does not snap to itself.
  const r = snapMove(box(300, 300, 100, 100), [], stage, 8);
  assert.deepEqual([r.dx, r.dy], [0, 0]);
});
