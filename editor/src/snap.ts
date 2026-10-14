// Snapping: when an object is dragged near the edge or the middle of the slide, or near the edge or middle of another object, it jumps to
// line up with it, and a guide line shows what it lined up with. The arithmetic only: the canvas does the dragging and the drawing.
//
// Snapping is for the mouse and for touch. The Line up buttons (and typed places in Properties) are how a keyboard gets the same result,
// so nothing depends on it. Objects are lined up by the box they have, not turned.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A line to draw: a vertical one at an x, or a horizontal one at a y, from one end to the other. All in stage pixels. */
export interface Guide {
  axis: "vertical" | "horizontal";
  at: number;
  from: number;
  to: number;
}

export interface SnapMove {
  /** How much further to move to land on the line, along each direction. Zero when nothing is close enough. */
  dx: number;
  dy: number;
  guides: Guide[];
}

export interface Stage {
  width: number;
  height: number;
}

/** How near, in pixels on the screen, an object must come to a line before it jumps to it. */
export const SNAP_SCREEN_PX = 8;

/** The three vertical lines of a box (its left edge, middle and right edge), and the three horizontal ones (top, middle, bottom). */
const xs = (b: Box): number[] => [b.x, b.x + b.width / 2, b.x + b.width];
const ys = (b: Box): number[] => [b.y, b.y + b.height / 2, b.y + b.height];

interface Target {
  at: number;
  /** The other direction: where along it the thing the line belongs to begins and ends, for drawing a guide. */
  from: number;
  to: number;
}

/** Everything a box can line up with: the slide's edges and middle, and the edges and middles of the other boxes. */
function targets(axis: "x" | "y", others: Box[], stage: Stage): Target[] {
  const span = axis === "x" ? stage.height : stage.width;
  const out: Target[] = (axis === "x" ? [0, stage.width / 2, stage.width] : [0, stage.height / 2, stage.height]).map((at) => ({ at, from: 0, to: span }));
  for (const o of others) {
    const lines = axis === "x" ? xs(o) : ys(o);
    const [from, to] = axis === "x" ? [o.y, o.y + o.height] : [o.x, o.x + o.width];
    for (const at of lines) out.push({ at, from, to });
  }
  return out;
}

/** The smallest move, among all the ways these lines could meet these targets, that is within the threshold. Null if none is. */
function nearest(lines: number[], among: Target[], threshold: number): number | null {
  let best: number | null = null;
  for (const line of lines) {
    for (const t of among) {
      const d = t.at - line;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  return best;
}

const same = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;

/** Guides for every line of the box that now sits on a target. */
function guidesFor(box: Box, axis: "x" | "y", among: Target[]): Guide[] {
  const lines = axis === "x" ? xs(box) : ys(box);
  const own: [number, number] = axis === "x" ? [box.y, box.y + box.height] : [box.x, box.x + box.width];
  const out: Guide[] = [];
  for (const line of lines) {
    for (const t of among) {
      if (!same(line, t.at)) continue;
      const guide: Guide = { axis: axis === "x" ? "vertical" : "horizontal", at: t.at, from: Math.min(own[0], t.from), to: Math.max(own[1], t.to) };
      const twin = out.find((g) => g.axis === guide.axis && same(g.at, guide.at));
      if (twin) {
        twin.from = Math.min(twin.from, guide.from);
        twin.to = Math.max(twin.to, guide.to);
      } else {
        out.push(guide);
      }
    }
  }
  return out;
}

/**
 * Where a dragged box would land if it jumped to the nearest line, in each direction on its own. `box` is where the pointer has taken it,
 * `others` are the boxes it can line up with (not the ones being dragged), and `threshold` is in stage pixels.
 */
export function snapMove(box: Box, others: Box[], stage: Stage, threshold: number): SnapMove {
  const across = targets("x", others, stage);
  const down = targets("y", others, stage);
  const dx = nearest(xs(box), across, threshold) ?? 0;
  const dy = nearest(ys(box), down, threshold) ?? 0;
  const landed = { ...box, x: box.x + dx, y: box.y + dy };
  return { dx, dy, guides: [...(dx !== 0 || xs(box).some((l) => across.some((t) => same(l, t.at))) ? guidesFor(landed, "x", across) : []), ...(dy !== 0 || ys(box).some((l) => down.some((t) => same(l, t.at))) ? guidesFor(landed, "y", down) : [])] };
}

/**
 * A box being resized by one of its handles (n, ne, e, se, s, sw, w, nw): only the edges that move jump to a line, and the edges that stay do not.
 * A jump that would leave the box smaller than `minSize` is not made.
 */
export function snapResize(box: Box, handle: string, others: Box[], stage: Stage, threshold: number, minSize: number): { box: Box; guides: Guide[] } {
  const across = targets("x", others, stage);
  const down = targets("y", others, stage);
  let { x, y, width, height } = box;
  if (handle.includes("w")) {
    const d = nearest([x], across, threshold);
    if (d !== null && width - d >= minSize) { x += d; width -= d; }
  }
  if (handle.includes("e")) {
    const d = nearest([x + width], across, threshold);
    if (d !== null && width + d >= minSize) width += d;
  }
  if (handle.includes("n")) {
    const d = nearest([y], down, threshold);
    if (d !== null && height - d >= minSize) { y += d; height -= d; }
  }
  if (handle.includes("s")) {
    const d = nearest([y + height], down, threshold);
    if (d !== null && height + d >= minSize) height += d;
  }
  const out = { x, y, width, height };
  // Only the edges that moved are drawn, so a line is not drawn for an edge that was not touched.
  const edgesX = [...(handle.includes("w") ? [x] : []), ...(handle.includes("e") ? [x + width] : [])];
  const edgesY = [...(handle.includes("n") ? [y] : []), ...(handle.includes("s") ? [y + height] : [])];
  return {
    box: out,
    guides: [
      ...guidesFor(out, "x", across).filter((g) => edgesX.some((e) => same(e, g.at))),
      ...guidesFor(out, "y", down).filter((g) => edgesY.some((e) => same(e, g.at))),
    ],
  };
}
