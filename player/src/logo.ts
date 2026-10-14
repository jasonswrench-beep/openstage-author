// A theme's logo: one picture in a corner of every slide.
//
// It is drawn by the shared renderer, so the editor's canvas and the published course show the same thing. It lies behind the slide's
// objects and takes no pointer or keyboard attention. A screen reader user hears it only if it has alt text; a decorative logo is hidden
// from them. It sits in the page before the slide's objects when it is at the top, and after them when it is at the bottom, so the
// reading order matches what the eye sees. Where the page reflows to one column the logo is part of the flow, small, at the top or bottom.

import rules from "../../tools/theme-rules.json" with { type: "json" };
import type { ThemeLogo } from "./types.ts";

/** How far in from the stage's edges a logo sits, in stage pixels. The validator and the editor use the same number. */
export const LOGO_MARGIN: number = rules.logo.margin;
export const LOGO_LIMITS = rules.logo;

/** Where the logo is on the stage: [x, y, width, height]. */
export function logoBox(stage: { width: number; height: number }, logo: Pick<ThemeLogo, "corner" | "width" | "height">): [number, number, number, number] {
  const x = logo.corner.endsWith("left") ? LOGO_MARGIN : stage.width - LOGO_MARGIN - logo.width;
  const y = logo.corner.startsWith("top") ? LOGO_MARGIN : stage.height - LOGO_MARGIN - logo.height;
  return [x, y, logo.width, logo.height];
}

/** Whether the logo comes before the slide's objects in the page (a top corner) or after them. */
export const logoFirst = (logo: Pick<ThemeLogo, "corner">): boolean => logo.corner.startsWith("top");

export function buildLogo(doc: Document, logo: ThemeLogo): HTMLElement {
  const img = doc.createElement("img");
  img.className = `os-logo os-logo-${logo.corner}`;
  img.setAttribute("src", logo.src);
  img.draggable = false;
  img.style.width = `${logo.width}px`;
  img.style.height = `${logo.height}px`;
  img.style.setProperty("--logo-w", `${logo.width}px`);
  img.style.setProperty("--logo-ar", `${logo.width} / ${logo.height}`);
  if (logo.decorative) {
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
  } else {
    img.alt = logo.alt;
  }
  return img;
}
