// A picture behind everything on a slide. It is an ordinary decorative `image` object named "Background picture" at the back of the slide's base layer, which is how
// the PowerPoint import already draws a slide's background picture, so the format has nothing new in it. This file is the arithmetic around that, with no window in it, so
// it is tested alone (backgrounds.test.ts): which object counts as the background, the average colour the checker is given in place of the picture, and how a pack's
// backgrounds are listed. The dialog that chooses one is backgrounddialog.ts, and the Model methods that add and remove it are setBackgroundPicture and removeBackgroundPicture.

import type { OSObject } from "../../player/src/types.ts";
import type { Pack, PackBackground } from "./packs.ts";

export const BACKGROUND_NAME = "Background picture";

/** Whether an object is a slide's background picture: a decorative picture with that name. (Where it is and how big it is do not matter; an author may move it.) */
export function isBackgroundPicture(o: OSObject): boolean {
  return o.type === "image" && o.name === BACKGROUND_NAME && o.accessibility.decorative === true;
}

/**
 * The average colour of a picture, as #rrggbb, from its pixels (red, green, blue, alpha for each, as a canvas gives them). The checker judges text against a colour and cannot
 * see a picture, so the slide is given this one, which is the best guess there is. Pixels that are nearly clear count for nothing. Null if there is nothing to average.
 */
export function averageHex(rgba: ArrayLike<number>): string | null {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3]! < 8) continue;
    r += rgba[i]!;
    g += rgba[i + 1]!;
    b += rgba[i + 2]!;
    n++;
  }
  if (n === 0) return null;
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export interface BackgroundGroup {
  group: string;
  items: PackBackground[];
}

/** A pack's backgrounds under their group headings, in the order the pack lists them. One with no group is under "More backgrounds". */
export function backgroundGroups(pack: Pack): BackgroundGroup[] {
  const out: BackgroundGroup[] = [];
  for (const b of pack.backgrounds) {
    const name = b.group || "More backgrounds";
    let found = out.find((g) => g.group === name);
    if (!found) out.push((found = { group: name, items: [] }));
    found.items.push(b);
  }
  return out;
}
