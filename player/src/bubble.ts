// Speech and thought bubbles: the drawing of them, with no screen in it, so every size can be tested directly.
//
// A bubble is a body (a rounded box for speech, an ellipse for thought) with a tail that points at whoever is speaking or thinking: a pointed tail for speech,
// two small circles for thought. The body takes the top of the object's box and the tail the bottom, so the object's box is the bubble including its tail.
// Everything is worked out in the box's own pixels (the figure is drawn with a view box the size of the box), so a tail stays the same size however wide or
// tall the bubble is made, and a circle stays round. Used by `shape` objects (a plain bubble) and by `text` objects with a `content.bubble` (a bubble with words in it).

export const BUBBLE_KINDS = ["speech", "thought"] as const;
export type BubbleKind = (typeof BUBBLE_KINDS)[number];

/** Which side of the bubble the tail is on. The tail always hangs below. */
export const BUBBLE_TAILS = ["left", "right"] as const;
export type BubbleTail = (typeof BUBBLE_TAILS)[number];

export const isBubbleKind = (v: unknown): v is BubbleKind => typeof v === "string" && (BUBBLE_KINDS as readonly string[]).includes(v);
export const isBubbleTail = (v: unknown): v is BubbleTail => typeof v === "string" && (BUBBLE_TAILS as readonly string[]).includes(v);

/** A tail that is missing or not one of the two is on the left. */
export const tailOf = (v: unknown): BubbleTail => (v === "right" ? "right" : "left");

/** What a bubble is made of, one piece to draw each. */
export type Figure =
  | { tag: "path"; d: string }
  | { tag: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { tag: "circle"; cx: number; cy: number; r: number };

export interface BubbleDrawing {
  /** The view box, "0 0 width height". */
  viewBox: string;
  /** How much of the height is body; the rest is tail. */
  bodyHeight: number;
  figures: Figure[];
}

const round = (n: number): number => Math.round(n * 100) / 100;
const clamp = (n: number, low: number, high: number): number => Math.min(Math.max(n, low), Math.max(low, high));

/** The room the tail takes at the bottom of a bubble `h` high. */
export function tailHeight(kind: BubbleKind, h: number): number {
  return kind === "speech" ? clamp(h * 0.28, 12, 36) : clamp(h * 0.3, 16, 44);
}

/** The distance from a point to the edge of an ellipse, found by looking at points all round it. */
function nearestEdge(cx: number, cy: number, rx: number, ry: number, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < 180; i++) {
    const t = (i / 180) * Math.PI * 2;
    best = Math.min(best, Math.hypot(cx + rx * Math.cos(t) - x, cy + ry * Math.sin(t) - y));
  }
  return best;
}

/** The drawing of a bubble that fills a box `w` wide and `h` high. */
export function bubbleParts(kind: BubbleKind, tail: BubbleTail, width: number, height: number): BubbleDrawing {
  const w = Math.max(24, width);
  const h = Math.max(24, height);
  const tailH = Math.min(tailHeight(kind, h), h - 8);
  const bodyH = h - tailH;
  const right = tail === "right";
  const out: BubbleDrawing = { viewBox: `0 0 ${round(w)} ${round(h)}`, bodyHeight: round(bodyH), figures: [] };

  if (kind === "speech") {
    const r = clamp(Math.min(26, bodyH / 2, w / 2), 1, 26);
    const base = clamp(Math.min(44, w * 0.3, w - 2 * r), 6, 44);
    // Where the tail starts, measured from the side it is on, and where its point is.
    const from = clamp(w * 0.12, r, w - r - base);
    const lean = base * 0.35;
    const left0 = right ? w - from - base : from; // the left foot of the tail
    const tipX = right ? Math.min(w, left0 + base + lean) : Math.max(0, left0 - lean);
    const x = (n: number) => round(n);
    // Clockwise from the top left corner, round the body, with the tail let into the bottom edge.
    const d = [
      `M ${x(r)} 0`, `H ${x(w - r)}`, `Q ${x(w)} 0 ${x(w)} ${x(r)}`,
      `V ${x(bodyH - r)}`, `Q ${x(w)} ${x(bodyH)} ${x(w - r)} ${x(bodyH)}`,
      // Along the bottom edge from the right: to the tail's right foot, down to its point, and back up to its left foot.
      `H ${x(left0 + base)} L ${x(tipX)} ${x(h)} L ${x(left0)} ${x(bodyH)}`,
      `H ${x(r)}`, `Q 0 ${x(bodyH)} 0 ${x(bodyH - r)}`, `V ${x(r)}`, `Q 0 0 ${x(r)} 0`, "Z",
    ].join(" ");
    out.figures.push({ tag: "path", d });
    return out;
  }

  // Thought: an ellipse, and two circles trailing away from it toward the one who is thinking.
  const rx = w / 2;
  const ry = bodyH / 2;
  const cx = w / 2;
  const cy = ry;
  out.figures.push({ tag: "ellipse", cx: round(cx), cy: round(cy), rx: round(rx), ry: round(ry) });
  const dir = right ? 1 : -1;
  // The larger circle sits below the body, clear of its edge; the smaller one is further along toward the one thinking, clear of the larger. A box too short for both
  // makes them smaller until they fit.
  let a = clamp(tailH * 0.4, 3, 16);
  for (let attempt = 0; attempt < 12; attempt++) {
    const x1 = clamp(right ? w * 0.84 : w * 0.16, a + 1, w - a - 1);
    const across = Math.min(1, Math.abs(x1 - cx) / rx);
    let y1 = cy + ry * Math.sqrt(1 - across * across) + a + 2; // below the body's lower edge at that place, to start with
    // The nearest the body comes may be to one side, not straight above, so move down until the circle is clear of it all round.
    while (y1 + a < h && nearestEdge(cx, cy, rx, ry, x1, y1) < a + 2) y1 += 0.5;
    const b = clamp(a * 0.55, 1.5, a);
    const gap = a + b + 2;
    const x2 = clamp(x1 + dir * gap * 0.85, b + 1, w - b - 1);
    const dx = Math.abs(x2 - x1);
    const y2 = y1 + Math.sqrt(Math.max(0, gap * gap - dx * dx));
    if (y2 + b <= h - 0.5 || a <= 2.2) {
      out.figures.push({ tag: "circle", cx: round(x1), cy: round(y1), r: round(a) }, { tag: "circle", cx: round(x2), cy: round(Math.min(y2, h - b)), r: round(b) });
      return out;
    }
    a *= 0.85;
  }
  return out;
}

/** The room to leave round words inside a bubble `w` by `h` so they sit in the body and not in the tail or the corners, in pixels. */
export function bubblePadding(kind: BubbleKind, width: number, height: number): { top: number; right: number; bottom: number; left: number } {
  const w = Math.max(24, width);
  const h = Math.max(24, height);
  const tailH = Math.min(tailHeight(kind, h), h - 8);
  const bodyH = h - tailH;
  // Speech: the corners are round, so a little room all round. Thought: the words must fit inside an ellipse, which is a rectangle about 0.7 of its size.
  const side = kind === "speech" ? 14 : Math.round(w * 0.146) + 4;
  const top = kind === "speech" ? 10 : Math.round(bodyH * 0.146) + 4;
  return { top, right: side, bottom: Math.round(tailH + top), left: side };
}

/** The padding as a CSS value: top, right, bottom, left. */
export function bubblePaddingCss(kind: BubbleKind, width: number, height: number): string {
  const p = bubblePadding(kind, width, height);
  return `${p.top}px ${p.right}px ${p.bottom}px ${p.left}px`;
}
