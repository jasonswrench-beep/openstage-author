// The average colour of each picture a deck uses as a slide background, worked out in the browser (it needs to draw the picture).
// The validator judges text against a slide's background colour and cannot see a picture, so an imported slide whose background is a picture
// is given the picture's average colour (see convert.ts, `backgroundOf`). A picture that cannot be drawn simply has no tone, and the slide
// keeps the theme's own background.

import type { Deck } from "./deck.ts";
import type { Pkg } from "./package.ts";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };

/** The average colour of a picture as #rrggbb, or null if it cannot be drawn here. Transparent parts count as white. */
export async function averageColour(bytes: Uint8Array, ext: string): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: MIME[ext] ?? "image/png" }));
    const size = 24;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, size, size);
    g.drawImage(bitmap, 0, 0, size, size);
    const data = g.getImageData(0, 0, size, size).data;
    let r = 0;
    let gr = 0;
    let b = 0;
    const n = size * size;
    for (let i = 0; i < data.length; i += 4) { r += data[i]!; gr += data[i + 1]!; b += data[i + 2]!; }
    const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(gr)}${hex(b)}`;
  } catch {
    return null;
  }
}

/** The average colour of every background picture in a deck, by the picture's fingerprint. */
export async function deckTones(pkg: Pkg, deck: Deck): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const s of deck.slides) {
    const pic = s.backgroundPicture ?? s.backgroundTile;
    if (!pic || out.has(pic.mediaHash)) continue;
    const bytes = pkg.bytes(pic.media);
    const colour = bytes ? await averageColour(bytes, pic.ext) : null;
    if (colour) out.set(pic.mediaHash, colour);
  }
  return out;
}
