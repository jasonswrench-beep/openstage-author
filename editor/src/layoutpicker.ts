// The layout picker: a dialog with a small drawing of every layout, in the colours of the project's
// own theme. It is a native <dialog>, so focus moves in, Tab stays inside, Escape closes it, and
// focus returns to the button that opened it. The layouts are one group of real radio buttons, so
// the arrow keys move between them and a screen reader reads each one's name and description. The
// drawings are for the eye only.

import { backgroundColors, resolveValue } from "../../player/src/theme.ts";
import type { Theme } from "../../player/src/types.ts";
import { previewBlocks, SLIDE_LAYOUTS, textRole, type PreviewBlock, type SlideLayout } from "./factory.ts";
import { GAME_PREFIX, GAME_SETS } from "./gamesets.ts";
import { SLIDE_TEMPLATES, TEMPLATE_PREFIX } from "./templates.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

function rect(doc: Document, x: number, y: number, w: number, h: number, fill: string, rx = 0, opacity = 1): SVGRectElement {
  const r = doc.createElementNS(SVG_NS, "rect");
  r.setAttribute("x", String(x));
  r.setAttribute("y", String(y));
  r.setAttribute("width", String(w));
  r.setAttribute("height", String(h));
  r.setAttribute("fill", fill);
  if (rx) r.setAttribute("rx", String(rx));
  if (opacity !== 1) r.setAttribute("fill-opacity", String(opacity));
  return r;
}

/**
 * A small drawing of a layout on its background: bars for titles, lines for text, and the
 * decorations, all in the theme's colours.
 */
export function previewSvg(doc: Document, layout: SlideLayout, theme: Theme, extras: PreviewBlock[] = []): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 1280 720");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "layout-preview");
  const tone = layout.tone ?? "light";
  const ink = theme.colors[textRole(tone)];
  const quiet = theme.colors[textRole(tone, true)];
  const page = rect(doc, 3, 3, 1274, 714, backgroundColors(theme, layout.background ?? null)[0]!);
  page.setAttribute("stroke", "#8c929b");
  page.setAttribute("stroke-width", "6");
  svg.appendChild(page);

  for (const b of previewBlocks(layout, extras)) {
    const [x, y, w, h] = b.rect;
    const fill = String(resolveValue(theme, b.fill ?? "#cccccc"));
    if (b.kind === "button") {
      svg.appendChild(rect(doc, x, y, w, h, theme.colors.accentStrong, 18));
    } else if (b.kind === "panel") {
      const box = rect(doc, x, y, w, h, theme.colors.surface, 10);
      box.setAttribute("stroke", theme.colors.muted);
      box.setAttribute("stroke-width", "4");
      box.setAttribute("stroke-dasharray", "14 10");
      svg.appendChild(box);
    } else if (b.kind === "accent") {
      svg.appendChild(rect(doc, x, y, w, h, fill));
    } else if (b.kind === "picture") {
      svg.appendChild(rect(doc, x, y, w, h, fill, 8));
      const hills = doc.createElementNS(SVG_NS, "polygon");
      hills.setAttribute("points", `${x + w * 0.1},${y + h * 0.85} ${x + w * 0.38},${y + h * 0.35} ${x + w * 0.55},${y + h * 0.65} ${x + w * 0.7},${y + h * 0.45} ${x + w * 0.9},${y + h * 0.85}`);
      hills.setAttribute("fill", theme.colors.muted);
      hills.setAttribute("fill-opacity", "0.45");
      svg.appendChild(hills);
      const sun = doc.createElementNS(SVG_NS, "circle");
      sun.setAttribute("cx", String(x + w * 0.78));
      sun.setAttribute("cy", String(y + h * 0.22));
      sun.setAttribute("r", String(Math.min(w, h) * 0.07));
      sun.setAttribute("fill", theme.colors.muted);
      sun.setAttribute("fill-opacity", "0.45");
      svg.appendChild(sun);
    } else if (b.kind === "chart") {
      svg.appendChild(rect(doc, x, y, w, h, fill, 8));
      const heights = [0.35, 0.55, 0.45, 0.8, 0.65];
      heights.forEach((v, i) => svg.appendChild(rect(doc, x + w * (0.1 + i * 0.17), y + h * (0.9 - v * 0.75), w * 0.11, h * v * 0.75, theme.colors.muted, 3, 0.45)));
    } else if (b.kind === "title") {
      svg.appendChild(rect(doc, x, y, w, Math.min(h, 64), ink, 6));
    } else if (b.kind === "heading") {
      svg.appendChild(rect(doc, x, y + 6, w * 0.7, Math.min(h, 40), ink, 6, 0.8));
    } else {
      const lines = Math.max(1, Math.min(6, Math.floor(h / 56)));
      for (let i = 0; i < lines; i++) {
        svg.appendChild(rect(doc, x, y + 8 + i * 56, i === lines - 1 && lines > 1 ? w * 0.6 : w, 22, quiet, 4, 0.65));
      }
    }
  }
  return svg;
}

export interface LayoutChoice {
  heading: string;
  confirm: string;
  /** Layout selected when the dialog opens. */
  initial: string;
  /** The project's theme, so the drawings show its colours. */
  theme: Theme;
  note?: string;
  /** Also offer the ready-made lesson slides, quizzes and games. Their ids come back as "template:<id>", "quiz:<id>" and "game:<id>". Only for adding a slide, not for changing a layout. */
  templates?: boolean;
  /** Offer only one kind of ready-made thing: the games, or the quizzes. */
  only?: "games" | "quizzes";
}

/** The quizzes the picker offers: a table of questions in a spreadsheet becomes a quiz, or a test bank. They come back as "quiz:<id>". */
export const QUIZ_PREFIX = "quiz:";
export const QUIZ_OFFERS: { id: "quiz" | "bank"; label: string; description: string }[] = [
  { id: "quiz", label: "Quiz from a spreadsheet", description: "A slide for each question in a spreadsheet: multiple choice, multiple response, true or false, short answer, each with its feedback. Every learner gets every question, in order." },
  { id: "bank", label: "Test bank from a spreadsheet", description: "The same questions, but each learner is shown some of them, picked at random and in a mixed order." },
];

/** Show the picker. Resolves to the chosen layout's id, or null if it was cancelled. */
export function askLayout(choice: LayoutChoice): Promise<string | null> {
  return new Promise((resolve) => {
    const doc = document;
    const dialog = doc.createElement("dialog");
    dialog.className = "dialog wide";
    dialog.setAttribute("aria-labelledby", "lp-title");

    const heading = doc.createElement("h2");
    heading.id = "lp-title";
    heading.textContent = choice.heading;

    const fieldset = doc.createElement("fieldset");
    fieldset.className = "layout-set";
    const legend = doc.createElement("legend");
    legend.textContent = "Layout";
    fieldset.appendChild(legend);

    // A layout is a place for text. A ready-made lesson slide also has its buttons, question or story, already working.
    interface Offer { value: string; layout: SlideLayout; label: string; description: string; extras: PreviewBlock[] }
    const offers: { group: string; items: Offer[] }[] = [];
    const groups: string[] = [];
    for (const layout of SLIDE_LAYOUTS) if (!groups.includes(layout.group)) groups.push(layout.group);
    if (!choice.only) {
      for (const group of groups) {
        offers.push({ group, items: SLIDE_LAYOUTS.filter((l) => l.group === group).map((l) => ({ value: l.id, layout: l, label: l.label, description: l.description, extras: [] })) });
      }
    }
    if (choice.templates || choice.only) {
      const question = SLIDE_TEMPLATES.find((t) => t.id === "knowledge-check") ?? SLIDE_TEMPLATES[0]!;
      if (!choice.only) offers.push({ group: "Lesson slides, ready-made", items: SLIDE_TEMPLATES.map((t) => ({ value: `${TEMPLATE_PREFIX}${t.id}`, layout: t.layout, label: t.label, description: t.description, extras: t.extras })) });
      // A quiz is a slide for each question in a table, so the picture is of a question slide.
      if (!choice.only || choice.only === "quizzes") offers.push({ group: "Quizzes and test banks, from a spreadsheet", items: QUIZ_OFFERS.map((q) => ({ value: `${QUIZ_PREFIX}${q.id}`, layout: question.layout, label: q.label, description: q.description, extras: question.extras })) });
      // A game adds several slides at once, so the picture is of its first slide.
      if (!choice.only || choice.only === "games") offers.push({ group: "Games, ready-made", items: GAME_SETS.map((g) => ({ value: `${GAME_PREFIX}${g.id}`, layout: g.layout, label: g.label, description: g.description, extras: g.extras })) });
    }
    const anchors: { group: string; h3: HTMLElement; first: HTMLInputElement | null }[] = [];
    for (const { group, items } of offers) {
      const h3 = doc.createElement("h3");
      h3.className = "layout-group";
      h3.textContent = group;
      fieldset.appendChild(h3);
      const grid = doc.createElement("div");
      grid.className = "layout-grid";
      anchors.push({ group, h3, first: null });
      for (const offer of items) {
        const label = doc.createElement("label");
        label.className = "layout-card";
        const radio = doc.createElement("input");
        radio.type = "radio";
        radio.name = "layout";
        radio.value = offer.value;
        radio.checked = offer.value === choice.initial;
        const card = doc.createElement("span");
        card.className = "card-body";
        const name = doc.createElement("span");
        name.className = "card-title";
        name.textContent = offer.label;
        const desc = doc.createElement("span");
        desc.className = "card-desc";
        desc.textContent = offer.description;
        card.append(previewSvg(doc, offer.layout, choice.theme, offer.extras), name, desc);
        label.append(radio, card);
        grid.appendChild(label);
        anchors[anchors.length - 1]!.first ??= radio;
      }
      fieldset.appendChild(grid);
    }
    // The list is long (the games are at the very end), so a row of buttons goes straight to a group, and the keyboard goes with it.
    if (anchors.length > 2) {
      const jump = doc.createElement("nav");
      jump.className = "layout-jump";
      jump.setAttribute("aria-label", "Go to a group in this list");
      const lead = doc.createElement("span");
      lead.textContent = "Go to:";
      jump.appendChild(lead);
      for (const a of anchors) {
        const b = doc.createElement("button");
        b.type = "button";
        b.textContent = a.group.split(",")[0]!;
        b.setAttribute("aria-label", `Go to ${a.group}`);
        b.addEventListener("click", () => {
          a.h3.scrollIntoView({ block: "start" });
          a.first?.focus();
        });
        jump.appendChild(b);
      }
      fieldset.insertBefore(jump, legend.nextSibling);
    }

    const note = doc.createElement("p");
    note.className = "note";
    note.textContent = choice.note ?? "";

    const ok = doc.createElement("button");
    ok.type = "submit";
    ok.textContent = choice.confirm;
    const cancel = doc.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    const actions = doc.createElement("div");
    actions.className = "dialog-actions";
    actions.append(ok, cancel);

    const form = doc.createElement("form");
    form.method = "dialog";
    form.append(heading, fieldset, note, actions);
    dialog.appendChild(form);
    doc.body.appendChild(dialog);

    let result: string | null = null;
    const finish = () => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    cancel.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish();
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      result = form.querySelector<HTMLInputElement>("input[name=layout]:checked")?.value ?? null;
      finish();
    });

    dialog.showModal();
    (form.querySelector<HTMLInputElement>("input[name=layout]:checked") ?? form.querySelector<HTMLInputElement>("input[name=layout]"))?.focus();
  });
}
