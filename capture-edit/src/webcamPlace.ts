// SPDX-License-Identifier: Apache-2.0
/**
 * Where the webcam picture goes in the finished video, as a choice of corner and size instead of a rectangle.
 *
 * The edit model has always been able to place a clip's picture (`placement`, a rectangle in ten-thousandths of the frame) and the preview and the
 * video maker draw it there; this is the choice an author makes to set it. Without a place a webcam is a small picture near the bottom right corner
 * (the video maker's `DEFAULT_WEBCAM_PLACE`: 2200 wide and high, 250 from the right and 450 from the bottom), or fills the frame when it is the only picture.
 *
 * A place is as wide as it is high in these units, so it keeps the shape of the frame, and a webcam is 16 by 9 like a screen.
 */

import { FULL, type Rect } from "./model.ts";

/** `usual` takes the place away, so the video maker draws the webcam where it does when nothing is said. */
export type WebcamWhere = "usual" | "bottom-right" | "bottom-left" | "top-right" | "top-left" | "fill";
export type WebcamSize = "small" | "medium" | "large";

export const WEBCAM_WHERE: readonly WebcamWhere[] = ["usual", "bottom-right", "bottom-left", "top-right", "top-left", "fill"];
export const WEBCAM_SIZES: readonly WebcamSize[] = ["small", "medium", "large"];

export const WEBCAM_WHERE_NAMES: Readonly<Record<WebcamWhere, string>> = {
  usual: "The usual place (bottom right)",
  "bottom-right": "Bottom right",
  "bottom-left": "Bottom left",
  "top-right": "Top right",
  "top-left": "Top left",
  fill: "Fills the whole picture",
};

export const WEBCAM_SIZE_NAMES: Readonly<Record<WebcamSize, string>> = {
  small: "Small",
  medium: "Medium (the usual size)",
  large: "Large",
};

/** How wide and high each size is, in ten-thousandths of the frame. Medium is the video maker's own. */
const SIDE_OF: Readonly<Record<WebcamSize, number>> = { small: 1800, medium: 2200, large: 3200 };
/** The gaps to the edges: the usual place's own. */
const GAP_X = 250;
const GAP_Y = 450;

/** The rectangle for a corner and a size. `usual` has none: it is the absence of a place. */
export function webcamRect(where: Exclude<WebcamWhere, "usual">, size: WebcamSize): Rect {
  if (where === "fill") return { x: 0, y: 0, width: FULL, height: FULL };
  const side = SIDE_OF[size];
  const x = where.endsWith("right") ? FULL - GAP_X - side : GAP_X;
  const y = where.startsWith("bottom") ? FULL - GAP_Y - side : GAP_Y;
  return { x, y, width: side, height: side };
}

/** What a clip's place is, as the two choices. A place that is none of these (set some other way) is `other`. */
export function webcamChoiceOf(place: Rect | undefined): { where: WebcamWhere | "other"; size: WebcamSize | "other" } {
  if (place === undefined) return { where: "usual", size: "medium" };
  const same = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  if (same(place, webcamRect("fill", "medium"))) return { where: "fill", size: "medium" };
  for (const where of WEBCAM_WHERE) {
    if (where === "usual" || where === "fill") continue;
    for (const size of WEBCAM_SIZES) if (same(place, webcamRect(where, size))) return { where, size };
  }
  return { where: "other", size: "other" };
}
