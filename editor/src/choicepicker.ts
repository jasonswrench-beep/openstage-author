// A small picker for "which kind of ..." questions, used by the Add menu so the menu itself stays
// short. Like the layout picker it is a native <dialog> holding one group of real radio buttons, so
// it works by keyboard and a screen reader reads each name. The drawings are for the eye only.

import { bubbleParts } from "../../player/src/bubble.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface Choice {
  value: string;
  label: string;
  description?: string;
  /** Choices with the same group are listed under that heading. */
  group?: string;
  /** A small drawing of the choice, hidden from screen readers. */
  preview?: SVGElement;
}

export interface ChoiceDialog {
  heading: string;
  legend: string;
  confirm: string;
  choices: Choice[];
  initial?: string;
}

/** A small drawing of a shape kind. */
export function shapePreview(kind: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 80 50");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "choice-preview");
  const draw = (tag: string, attrs: Record<string, string>) => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    e.setAttribute("fill", kind === "line" ? "none" : "#0b3fb3");
    e.setAttribute("stroke", "#0b3fb3");
    e.setAttribute("stroke-width", "3");
    svg.appendChild(e);
  };
  if (kind === "rectangle") draw("rect", { x: "10", y: "8", width: "60", height: "34" });
  else if (kind === "rounded") draw("rect", { x: "10", y: "8", width: "60", height: "34", rx: "10" });
  else if (kind === "ellipse") draw("ellipse", { cx: "40", cy: "25", rx: "30", ry: "18" });
  else if (kind === "triangle") draw("polygon", { points: "40,6 70,44 10,44" });
  else if (kind === "diamond") draw("polygon", { points: "40,5 70,25 40,45 10,25" });
  else if (kind === "arrow") draw("polygon", { points: "8,18 44,18 44,6 72,25 44,44 44,32 8,32" });
  else draw("line", { x1: "10", y1: "40", x2: "70", y2: "10" });
  return svg;
}

/** A small drawing of a speech or thought bubble, with a few lines in it for words when it has some. */
export function bubblePreview(kind: "speech" | "thought", withWords: boolean): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 80 50");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "choice-preview");
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("transform", "translate(10 3)");
  const add = (tag: string, attrs: Record<string, string>) => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    group.appendChild(e);
  };
  for (const f of bubbleParts(kind, "left", 60, 44).figures) {
    const { tag, ...attrs } = f;
    add(tag, { ...Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, String(v)])), fill: "#e8ecf6", stroke: "#0b3fb3", "stroke-width": "2.5" });
  }
  if (withWords) for (const y of [11, 18]) add("line", { x1: "14", y1: String(y), x2: "46", y2: String(y), stroke: "#6b7280", "stroke-width": "2.5", "stroke-linecap": "round" });
  svg.appendChild(group);
  return svg;
}

/** A small drawing of an interaction: the controls in the theme's blue, the content in grey. */
export function interactionPreview(kind: string, orientation: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 120 70");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "choice-preview");
  const BLUE = "#0b3fb3";
  const GREY = "#d3d9e6";
  const r = (x: number, y: number, w: number, h: number, fill: string, rx = 3) => {
    const e = document.createElementNS(SVG_NS, "rect");
    for (const [k, v] of Object.entries({ x, y, width: w, height: h, fill, rx })) e.setAttribute(k, String(v));
    svg.appendChild(e);
  };
  const o = (cx: number, cy: number, rad: number, fill: string) => {
    const e = document.createElementNS(SVG_NS, "circle");
    for (const [k, v] of Object.entries({ cx, cy, r: rad, fill })) e.setAttribute(k, String(v));
    svg.appendChild(e);
  };
  const vertical = orientation === "vertical";
  if (kind === "clickReveal") {
    if (vertical) { r(10, 6, 100, 12, BLUE); r(10, 20, 100, 14, GREY); r(10, 38, 100, 12, BLUE); r(10, 54, 100, 12, BLUE); }
    else { [8, 44, 80].forEach((x) => r(x, 8, 32, 14, BLUE)); r(8, 28, 32, 36, GREY); }
  } else if (kind === "accordion") {
    r(10, 6, 100, 12, BLUE); r(10, 20, 100, 8, BLUE); r(10, 30, 100, 20, GREY); r(10, 54, 100, 12, BLUE);
  } else if (kind === "flipCards") {
    if (vertical) { r(20, 6, 80, 26, BLUE); r(20, 38, 80, 26, GREY); }
    else { r(8, 14, 32, 42, BLUE); r(44, 14, 32, 42, GREY); r(80, 14, 32, 42, BLUE); }
  } else if (kind === "tabs") {
    if (vertical) { r(8, 8, 26, 12, BLUE); r(8, 24, 26, 12, GREY); r(8, 40, 26, 12, GREY); r(36, 8, 76, 54, GREY, 4); }
    else { r(8, 8, 30, 12, BLUE); r(40, 8, 30, 12, GREY); r(72, 8, 30, 12, GREY); r(8, 22, 104, 42, GREY, 4); }
  } else if (kind === "steps") {
    [20, 60, 100].forEach((x, i) => o(x, 12, 7, i === 0 ? BLUE : GREY));
    r(27, 11, 26, 2, GREY, 1); r(67, 11, 26, 2, GREY, 1);
    r(10, 26, 100, 28, GREY, 4); r(10, 58, 30, 9, BLUE); r(80, 58, 30, 9, BLUE);
  } else if (kind === "carousel") {
    r(18, 8, 84, 46, GREY, 4); r(4, 24, 10, 14, BLUE); r(106, 24, 10, 14, BLUE);
    [48, 60, 72].forEach((x, i) => o(x, 63, 3, i === 0 ? BLUE : GREY));
  } else if (kind === "glossary") {
    r(6, 6, 50, 8, GREY); [6, 14, 22, 30, 38, 46].forEach((x, i) => r(x, 18, 6, 6, i === 1 ? BLUE : GREY, 1));
    [28, 36, 44, 52, 60].forEach((y, i) => r(6, y, 50, 6, i === 1 ? BLUE : GREY, 2)); r(62, 6, 52, 58, GREY, 4);
  } else if (kind === "timeline") {
    r(6, 22, 108, 3, GREY, 1);
    [14, 38, 62, 86, 108].forEach((x, i) => o(x, 23, i === 1 ? 6 : 4, i === 1 ? BLUE : GREY)); r(6, 38, 108, 26, GREY, 4);
  } else if (kind === "processCircle") {
    const ring = document.createElementNS(SVG_NS, "circle");
    for (const [k, v] of Object.entries({ cx: 36, cy: 35, r: 22, fill: "none", stroke: GREY, "stroke-width": 3 })) ring.setAttribute(k, String(v));
    svg.appendChild(ring);
    [0, 1, 2, 3, 4].forEach((i) => { const a = (i / 5) * 2 * Math.PI - Math.PI / 2; o(36 + 22 * Math.cos(a), 35 + 22 * Math.sin(a), 6, i === 1 ? BLUE : GREY); });
    r(70, 8, 44, 54, GREY, 4);
  } else {
    // Pyramids and the circle matrix: the drawing on the left, the panel on the right.
    const poly = (pts: number[][], fill: string) => {
      const e = document.createElementNS(SVG_NS, "polygon");
      e.setAttribute("points", pts.map((p) => p.join(",")).join(" "));
      e.setAttribute("fill", fill);
      svg.appendChild(e);
    };
    if (kind === "pyramidStack") {
      for (let i = 0; i < 4; i++) { const t0 = i / 4, t1 = (i + 1) / 4; poly([[36 - 30 * t0, 6 + 58 * t0 + 1], [36 + 30 * t0, 6 + 58 * t0 + 1], [36 + 30 * t1, 6 + 58 * t1 - 1], [36 - 30 * t1, 6 + 58 * t1 - 1]], i === 1 ? BLUE : GREY); }
    } else if (kind === "pyramidMatrix") {
      poly([[36, 7], [46, 25], [26, 25]], GREY); poly([[25, 27], [47, 27], [54, 45], [18, 45]], BLUE); poly([[17, 47], [55, 47], [66, 63], [6, 63]], GREY);
    } else {
      for (let i = 0; i < 4; i++) {
        const a0 = (i / 4) * 360 - 88, a1 = ((i + 1) / 4) * 360 - 92;
        const pts: number[][] = [];
        for (let s = 0; s <= 8; s++) { const a = ((a0 + ((a1 - a0) * s) / 8) * Math.PI) / 180; pts.push([36 + 28 * Math.cos(a), 35 + 28 * Math.sin(a)]); }
        for (let s = 8; s >= 0; s--) { const a = ((a0 + ((a1 - a0) * s) / 8) * Math.PI) / 180; pts.push([36 + 12 * Math.cos(a), 35 + 12 * Math.sin(a)]); }
        poly(pts, i === 1 ? BLUE : GREY);
      }
    }
    r(76, 8, 38, 54, GREY, 4);
  }
  return svg;
}

/** Show the picker. Resolves to the chosen value, or null if it was cancelled. */
export function askChoice(opts: ChoiceDialog): Promise<string | null> {
  return new Promise((resolve) => {
    const doc = document;
    const dialog = doc.createElement("dialog");
    dialog.className = opts.choices.some((c) => c.group) ? "dialog wide" : "dialog";
    dialog.setAttribute("aria-labelledby", "cp-title");

    const heading = doc.createElement("h2");
    heading.id = "cp-title";
    heading.textContent = opts.heading;

    const fieldset = doc.createElement("fieldset");
    fieldset.className = "layout-set";
    const legend = doc.createElement("legend");
    legend.textContent = opts.legend;
    fieldset.appendChild(legend);
    const groups: (string | undefined)[] = [];
    for (const c of opts.choices) if (!groups.includes(c.group)) groups.push(c.group);
    const grids = new Map<string | undefined, HTMLElement>();
    for (const g of groups) {
      if (g) {
        const h3 = doc.createElement("h3");
        h3.className = "layout-group";
        h3.textContent = g;
        fieldset.appendChild(h3);
      }
      const grid = doc.createElement("div");
      grid.className = "layout-grid choice-grid";
      fieldset.appendChild(grid);
      grids.set(g, grid);
    }
    for (const c of opts.choices) {
      const grid = grids.get(c.group)!;
      const label = doc.createElement("label");
      label.className = "layout-card";
      const radio = doc.createElement("input");
      radio.type = "radio";
      radio.name = "choice";
      radio.value = c.value;
      radio.checked = c.value === (opts.initial ?? opts.choices[0]?.value);
      const body = doc.createElement("span");
      body.className = "card-body";
      if (c.preview) body.appendChild(c.preview);
      const name = doc.createElement("span");
      name.className = "card-title";
      name.textContent = c.label;
      body.appendChild(name);
      if (c.description) {
        const desc = doc.createElement("span");
        desc.className = "card-desc";
        desc.textContent = c.description;
        body.appendChild(desc);
      }
      label.append(radio, body);
      grid.appendChild(label);
    }

    const ok = doc.createElement("button");
    ok.type = "submit";
    ok.textContent = opts.confirm;
    const cancel = doc.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    const actions = doc.createElement("div");
    actions.className = "dialog-actions";
    actions.append(ok, cancel);

    const form = doc.createElement("form");
    form.method = "dialog";
    form.append(heading, fieldset, actions);
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
      result = form.querySelector<HTMLInputElement>("input[name=choice]:checked")?.value ?? null;
      finish();
    });

    dialog.showModal();
    (form.querySelector<HTMLInputElement>("input[name=choice]:checked") ?? form.querySelector<HTMLInputElement>("input[name=choice]"))?.focus();
  });
}
