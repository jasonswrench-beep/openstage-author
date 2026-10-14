// The theme picker: a dialog showing each built-in theme as a light slide and a dark one, with the
// name and the two fonts. Like the layout picker it is a native <dialog> holding one group of real
// radio buttons, so it works by keyboard and a screen reader reads each theme's name and fonts.

import { backgroundColors } from "../../player/src/theme.ts";
import type { Theme } from "../../player/src/types.ts";
import { FONT_CHOICES } from "./content.ts";
import { BUILT_IN_THEMES } from "./themes.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

function rect(doc: Document, x: number, y: number, w: number, h: number, fill: string, rx = 0, opacity = 1): SVGRectElement {
  const r = doc.createElementNS(SVG_NS, "rect");
  for (const [k, v] of Object.entries({ x, y, width: w, height: h, fill })) r.setAttribute(k, String(v));
  if (rx) r.setAttribute("rx", String(rx));
  if (opacity !== 1) r.setAttribute("fill-opacity", String(opacity));
  return r;
}

/** Two small slides in the theme: a light one with a button and a picture area, and a dark one. */
export function themePreviewSvg(doc: Document, theme: Theme): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 1340 360");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "theme-preview");
  const c = theme.colors;
  const slide = (x: number, bg: string, ink: string, quiet: string, withExtras: boolean) => {
    const page = rect(doc, x + 2, 2, 636, 356, bg);
    page.setAttribute("stroke", "#8c929b");
    page.setAttribute("stroke-width", "4");
    svg.appendChild(page);
    svg.appendChild(rect(doc, x + 40, 48, 360, 34, ink, 5));
    svg.appendChild(rect(doc, x + 40, 100, 90, 8, c.accent));
    [0, 1, 2].forEach((i) => svg.appendChild(rect(doc, x + 40, 140 + i * 34, i === 2 ? 200 : 320, 16, quiet, 4, 0.7)));
    if (withExtras) {
      svg.appendChild(rect(doc, x + 410, 130, 190, 150, c.surface, 6));
      svg.appendChild(rect(doc, x + 40, 275, 150, 46, c.accentStrong, 8));
      svg.appendChild(rect(doc, x + 78, 293, 74, 10, c.onAccentStrong, 4));
    }
  };
  slide(0, backgroundColors(theme, null)[0]!, c.text, c.muted, true);
  slide(700, backgroundColors(theme, "theme:bg.dark")[0]!, c.onDark, c.onDark, false);
  return svg;
}

const fontName = (css: string): string => FONT_CHOICES.find((f) => f.value === css)?.label ?? css.split(",")[0]!.replace(/['"]/g, "");

export interface ThemeChoice {
  /** The id of the theme the project has now. */
  current: string;
}

/** Show the picker. Resolves to the chosen built-in theme, to "edit" if the author wants to change the colours, fonts and logo, or to null if it was cancelled. */
export function askTheme(choice: ThemeChoice): Promise<Theme | "edit" | null> {
  return new Promise((resolve) => {
    const doc = document;
    const dialog = doc.createElement("dialog");
    dialog.className = "dialog wide";
    dialog.setAttribute("aria-labelledby", "tp-title");

    const heading = doc.createElement("h2");
    heading.id = "tp-title";
    heading.textContent = "Choose a theme";

    const fieldset = doc.createElement("fieldset");
    fieldset.className = "layout-set";
    const legend = doc.createElement("legend");
    legend.textContent = "Theme";
    fieldset.appendChild(legend);
    const grid = doc.createElement("div");
    grid.className = "layout-grid theme-grid";
    for (const theme of BUILT_IN_THEMES) {
      const label = doc.createElement("label");
      label.className = "layout-card";
      const radio = doc.createElement("input");
      radio.type = "radio";
      radio.name = "theme";
      radio.value = theme.id;
      radio.checked = theme.id === choice.current;
      const card = doc.createElement("span");
      card.className = "card-body";
      const name = doc.createElement("span");
      name.className = "card-title";
      name.textContent = theme.name;
      const desc = doc.createElement("span");
      desc.className = "card-desc";
      desc.textContent = `Headings in ${fontName(theme.fonts.heading)}, text in ${fontName(theme.fonts.body)}.`;
      card.append(themePreviewSvg(doc, theme), name, desc);
      label.append(radio, card);
      grid.appendChild(label);
    }
    fieldset.appendChild(grid);

    const note = doc.createElement("p");
    note.className = "note";
    note.textContent = "Every slide changes at once: its background, and the colours and fonts of everything that follows the theme. Colours and fonts you chose yourself stay as they are, and so does your logo. You can undo with Ctrl+Z. To change a theme's own colours and fonts, or add a logo, choose Edit this theme.";

    const ok = doc.createElement("button");
    ok.type = "submit";
    ok.textContent = "Apply theme";
    const edit = doc.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit this theme...";
    const cancel = doc.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    const actions = doc.createElement("div");
    actions.className = "dialog-actions";
    actions.append(ok, edit, cancel);

    const form = doc.createElement("form");
    form.method = "dialog";
    form.append(heading, fieldset, note, actions);
    dialog.appendChild(form);
    doc.body.appendChild(dialog);

    let result: Theme | "edit" | null = null;
    const finish = () => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    cancel.addEventListener("click", finish);
    edit.addEventListener("click", () => {
      result = "edit";
      finish();
    });
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish();
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const id = form.querySelector<HTMLInputElement>("input[name=theme]:checked")?.value;
      result = BUILT_IN_THEMES.find((t) => t.id === id) ?? null;
      finish();
    });

    dialog.showModal();
    (form.querySelector<HTMLInputElement>("input[name=theme]:checked") ?? form.querySelector<HTMLInputElement>("input[name=theme]"))?.focus();
  });
}
