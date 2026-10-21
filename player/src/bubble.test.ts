// The drawing of speech and thought bubbles: every size stays inside its box, the tail is the same size however wide the bubble is, a thought bubble's circles are round and clear of the body.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bubbleParts, bubblePadding, bubblePaddingCss, isBubbleKind, isBubbleTail, tailHeight, tailOf, type Figure } from "./bubble.ts";

type PathFigure = Extract<Figure, { tag: "path" }>;
type CircleFigure = Extract<Figure, { tag: "circle" }>;
type EllipseFigure = Extract<Figure, { tag: "ellipse" }>;

/** The points a path goes through. Only the commands the drawing uses. */
function pathPoints(d: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let at = { x: 0, y: 0 };
  for (const m of d.matchAll(/([MHVQLZ])([^MHVQLZ]*)/g)) {
    const n = m[2]!.trim().split(/\s+/).filter(Boolean).map(Number);
    switch (m[1]) {
      case "M": case "L": at = { x: n[0]!, y: n[1]! }; out.push(at); break;
      case "H": at = { x: n[0]!, y: at.y }; out.push(at); break;
      case "V": at = { x: at.x, y: n[0]! }; out.push(at); break;
      case "Q": out.push({ x: n[0]!, y: n[1]! }); at = { x: n[2]!, y: n[3]! }; out.push(at); break;
    }
  }
  return out;
}

const speechPath = (tail: "left" | "right", w: number, h: number): string => (bubbleParts("speech", tail, w, h).figures[0] as PathFigure).d;
const lowest = (points: { x: number; y: number }[]) => points.reduce((best, p) => (p.y > best.y ? p : best));

const SIZES: [number, number][] = [[24, 24], [60, 40], [120, 80], [200, 120], [320, 160], [600, 200], [900, 120], [200, 400], [1280, 720]];

test("the view box is the box, and the body and tail share its height", () => {
  const b = bubbleParts("speech", "left", 300, 160);
  assert.equal(b.viewBox, "0 0 300 160");
  assert.equal(b.bodyHeight, 160 - tailHeight("speech", 160));
  assert.equal(bubbleParts("thought", "right", 300, 160).bodyHeight, 160 - tailHeight("thought", 160));
});

test("a speech bubble is one closed outline, and every point of it is inside the box, at every size", () => {
  for (const tail of ["left", "right"] as const) {
    for (const [w, h] of SIZES) {
      const b = bubbleParts("speech", tail, w, h);
      assert.equal(b.figures.length, 1);
      assert.equal(b.figures[0]!.tag, "path");
      const d = speechPath(tail, w, h);
      assert.ok(d.startsWith("M ") && d.endsWith("Z"), d);
      assert.doesNotMatch(d, /NaN|Infinity/);
      const [bw, bh] = [Math.max(24, w), Math.max(24, h)];
      for (const p of pathPoints(d)) assert.ok(p.x >= 0 && p.x <= bw && p.y >= 0 && p.y <= bh, `${tail} ${w}x${h}: ${p.x},${p.y}`);
    }
  }
});

test("the tail's point is at the bottom of the box, on the side it is on, and below the body", () => {
  for (const tail of ["left", "right"] as const) {
    const b = bubbleParts("speech", tail, 300, 160);
    const pts = pathPoints(speechPath(tail, 300, 160));
    const tip = lowest(pts);
    assert.equal(tip.y, 160);
    assert.ok(tail === "left" ? tip.x < 150 : tip.x > 150, `${tail}: ${tip.x}`);
    assert.equal(pts.filter((p) => p.y > b.bodyHeight).length, 1, "only the point is below the body");
  }
});

test("the tail stays the same size however wide the bubble is made, and the right tail is the left one turned over", () => {
  const left = (w: number) => pathPoints(speechPath("left", w, 160));
  const size = (w: number) => {
    const pts = left(w);
    const at = pts.indexOf(lowest(pts));
    const [rightFoot, tip, leftFoot] = [pts[at - 1]!, pts[at]!, pts[at + 1]!];
    const to2 = (n: number) => Math.round(n * 100) / 100;
    return { reach: to2(tip.y - rightFoot.y), span: to2(rightFoot.x - leftFoot.x), lean: to2(leftFoot.x - tip.x) };
  };
  assert.deepEqual(size(400), size(900));
  assert.deepEqual(size(400), size(1280));
  assert.equal(lowest(pathPoints(speechPath("right", 400, 160))).x, 400 - lowest(left(400)).x);
});

test("a thought bubble is an ellipse the size of the body and two circles that get smaller toward the one thinking", () => {
  const b = bubbleParts("thought", "left", 300, 160);
  const [body, c1, c2] = b.figures;
  assert.deepEqual(body, { tag: "ellipse", cx: 150, cy: b.bodyHeight / 2, rx: 150, ry: b.bodyHeight / 2 });
  assert.equal(c1!.tag, "circle");
  assert.equal(c2!.tag, "circle");
  const [a, s] = [c1 as CircleFigure, c2 as CircleFigure];
  assert.ok(s.r < a.r);
  assert.ok(s.cy > a.cy && s.cx < a.cx, "the smaller one is further down and further to the left");
  const r = bubbleParts("thought", "right", 300, 160).figures as [EllipseFigure, CircleFigure, CircleFigure];
  assert.ok(r[2].cx > r[1].cx, "and further right for the right tail");
});

test("the circles of a thought bubble are inside the box, clear of the body and of each other, at every size", () => {
  for (const tail of ["left", "right"] as const) {
    for (const [w, h] of SIZES.filter(([a, c]) => a >= 60 && c >= 40)) {
      const [body, c1, c2] = bubbleParts("thought", tail, w, h).figures as [EllipseFigure, CircleFigure, CircleFigure];
      const [bw, bh] = [Math.max(24, w), Math.max(24, h)];
      for (const c of [c1, c2]) {
        assert.ok(c.r >= 1.5 - 1e-9 && c.cx - c.r >= -1e-9 && c.cx + c.r <= bw + 1e-9 && c.cy - c.r >= -1e-9 && c.cy + c.r <= bh + 1e-9, `${tail} ${w}x${h}: circle ${JSON.stringify(c)}`);
        // The nearest the body's edge comes to the middle of the circle.
        let nearest = Infinity;
        for (let i = 0; i < 720; i++) {
          const t = (i / 720) * Math.PI * 2;
          nearest = Math.min(nearest, Math.hypot(body.cx + body.rx * Math.cos(t) - c.cx, body.cy + body.ry * Math.sin(t) - c.cy));
        }
        assert.ok(nearest >= c.r - 0.75, `${tail} ${w}x${h}: the circle touches the body (${nearest} from the edge, radius ${c.r})`);
      }
      assert.ok(Math.hypot(c1.cx - c2.cx, c1.cy - c2.cy) >= c1.r + c2.r - 0.01, `${tail} ${w}x${h}: the circles touch`);
    }
  }
});

test("a box smaller than a bubble can be drawn in is drawn at the smallest size, with no broken numbers", () => {
  for (const kind of ["speech", "thought"] as const) {
    const b = bubbleParts(kind, "left", 0, 0);
    assert.equal(b.viewBox, "0 0 24 24");
    assert.doesNotMatch(JSON.stringify(b), /null|NaN/);
  }
});

test("words in a bubble sit in the body, never in the tail, and have room left in all but the smallest", () => {
  for (const kind of ["speech", "thought"] as const) {
    for (const [w, h] of SIZES.filter(([a, b]) => a >= 120 && b >= 80)) {
      const p = bubblePadding(kind, w, h);
      assert.ok(Number.isInteger(p.top) && Number.isInteger(p.right) && Number.isInteger(p.bottom) && Number.isInteger(p.left));
      assert.ok(p.bottom >= tailHeight(kind, h), `${kind} ${w}x${h}: the tail's room is kept free`);
      assert.ok(w - p.left - p.right > 0 && h - p.top - p.bottom > 0, `${kind} ${w}x${h}: some room is left for words`);
    }
  }
  const speech = bubblePadding("speech", 300, 160);
  assert.equal(bubblePaddingCss("speech", 300, 160), `${speech.top}px 14px ${speech.bottom}px 14px`);
  // A thought bubble's words must fit an ellipse, which takes more room at the sides than a speech bubble's corners do.
  assert.ok(bubblePadding("thought", 400, 160).left > bubblePadding("speech", 400, 160).left);
});

test("only the two kinds and the two tails are known, and a missing tail is on the left", () => {
  assert.deepEqual(["speech", "thought", "cloud", "", null, 3].map(isBubbleKind), [true, true, false, false, false, false]);
  assert.deepEqual(["left", "right", "top", null].map(isBubbleTail), [true, true, false, false]);
  assert.deepEqual(["left", "right", "up", undefined, 4].map(tailOf), ["left", "right", "left", "left", "left"]);
});
