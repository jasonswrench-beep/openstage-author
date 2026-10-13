// Aligning and spacing out objects: the arithmetic only. The model applies the results and makes the one undo step.
//
// A box is an object's place on the stage, not turned: an object that is rotated is aligned by the box it would have if it were not.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Alignment = "left" | "centre" | "right" | "top" | "middle" | "bottom";

export const ALIGNMENTS: { value: Alignment; label: string; /** What is lined up, for a sentence about several objects. */ edge: string; /** Where one object goes, for a sentence about the slide. */ onSlide: string }[] = [
  { value: "left", label: "Left", edge: "left edges", onSlide: "against the left edge of the slide" },
  { value: "centre", label: "Centre", edge: "centres, left to right", onSlide: "to the centre of the slide, left to right" },
  { value: "right", label: "Right", edge: "right edges", onSlide: "against the right edge of the slide" },
  { value: "top", label: "Top", edge: "top edges", onSlide: "against the top edge of the slide" },
  { value: "middle", label: "Middle", edge: "middles, top to bottom", onSlide: "to the middle of the slide, top to bottom" },
  { value: "bottom", label: "Bottom", edge: "bottom edges", onSlide: "against the bottom edge of the slide" },
];

/** The smallest box that holds all of these. */
export function bounds(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * Line the boxes up with each other (when `within` is null) or with the edges or middle of `within`, which is the slide when only one
 * object is chosen. Only the position changes along one direction; sizes never change.
 */
export function alignBoxes(boxes: Box[], how: Alignment, within: Box | null): Box[] {
  if (boxes.length === 0) return [];
  const area = within ?? bounds(boxes);
  return boxes.map((b) => {
    switch (how) {
      case "left": return { ...b, x: round(area.x) };
      case "right": return { ...b, x: round(area.x + area.width - b.width) };
      case "centre": return { ...b, x: round(area.x + (area.width - b.width) / 2) };
      case "top": return { ...b, y: round(area.y) };
      case "bottom": return { ...b, y: round(area.y + area.height - b.height) };
      case "middle": return { ...b, y: round(area.y + (area.height - b.height) / 2) };
    }
  });
}

/**
 * Spread three or more boxes so the gaps between neighbours are equal, keeping the first and the last (by their position) where they are.
 * Fewer than three have nothing between them to space, so they come back unchanged. The result is in the order given.
 */
export function distributeBoxes(boxes: Box[], axis: "horizontal" | "vertical"): Box[] {
  if (boxes.length < 3) return boxes.map((b) => ({ ...b }));
  const pos = (b: Box): number => (axis === "horizontal" ? b.x : b.y);
  const size = (b: Box): number => (axis === "horizontal" ? b.width : b.height);
  const order = boxes.map((_, i) => i).sort((a, b) => pos(boxes[a]!) - pos(boxes[b]!) || a - b);
  const first = boxes[order[0]!]!;
  const last = boxes[order[order.length - 1]!]!;
  const span = pos(last) + size(last) - pos(first);
  const gap = (span - order.reduce((sum, i) => sum + size(boxes[i]!), 0)) / (order.length - 1);
  const out = boxes.map((b) => ({ ...b }));
  let at = pos(first);
  for (const i of order) {
    const b = out[i]!;
    if (axis === "horizontal") b.x = round(at); else b.y = round(at);
    at += size(boxes[i]!) + gap;
  }
  return out;
}
