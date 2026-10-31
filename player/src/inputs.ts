// Inputs: checkboxes, radio buttons, a drop-down, a list, the two survey scales (Likert and
// semantic differential), and a choice of character (picture cards, one of which the learner is). Each one is built from native form controls, so the keyboard and screen
// reader behaviour is the browser's own, and each writes what the learner chose into a variable
// that triggers can read. The renderer calls buildInput for an object of type "input".

import type { Character, InputContent, InputInteraction, OSObject, Primitive } from "./types.ts";
import { t } from "./playertext.ts";

export const INPUT_KINDS = ["checkbox", "radio", "dropdown", "list", "likert", "semantic", "character", "slider", "dial"] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

/** What an input tells the course when the learner changes it. */
export interface InputChange {
  /** The part of the input that changed: an option, a checkbox or a row of a scale. */
  rowId: string;
  variable: string;
  value: Primitive;
  /** What to tell the LMS if the input reports: a letter for a choice, a number for a scale or a slider, 1 or 0 for a checkbox. */
  response: string;
  type: InputInteraction;
  /** A change that is still going on, such as a slider being dragged: the variable follows it, but it is not reported until the learner stops. */
  live?: boolean;
}

export interface InputHooks {
  editing: boolean;
  /** The variable's value now, so a learner who comes back sees what they chose. */
  value?(variable: string): Primitive | undefined;
  onChange?(change: InputChange): void;
  /** The project's cast, for a choice of character. */
  characters?(): Character[];
}

/** The variable type each kind of input writes. The validator and the editor use the same table. */
export const INPUT_VARIABLE_TYPE: Record<InputKind, "boolean" | "string" | "number"> = {
  checkbox: "boolean", radio: "string", dropdown: "string", list: "string", likert: "number", semantic: "number", character: "string",
  slider: "number", dial: "number",
};

const letter = (i: number) => String.fromCharCode(97 + i);

// ---- the scale of a slider or a dial

/** How many decimals a step has: 0.25 has two, 5 has none. */
export function stepDecimals(n: number): number {
  const text = String(n);
  const exponent = /e-(\d+)$/i.exec(text);
  if (exponent) return Number(exponent[1]);
  return text.split(".")[1]?.length ?? 0;
}

/** The value on the scale nearest to `raw`: inside min and max, a whole number of steps from min, and without the dust that adding decimals leaves (0.1 + 0.2). */
export function snapToStep(raw: number, min: number, max: number, step: number): number {
  if (!(step > 0) || !(max > min)) return min;
  const clamped = Math.min(max, Math.max(min, raw));
  const lastStep = Math.floor((max - min) / step + 1e-9);
  const steps = Math.min(lastStep, Math.round((clamped - min) / step));
  return Number((min + steps * step).toFixed(Math.max(stepDecimals(step), stepDecimals(min))));
}

/** The unit after a number: "%" goes straight after it, a word gets a space ("5 days"). */
const unitOf = (c: InputContent): string => {
  const unit = (c.unit ?? "").trim();
  return unit === "" ? "" : /^[\p{L}]/u.test(unit) ? ` ${unit}` : unit;
};

/** A value as the learner sees it, with its unit. */
export function sliderShown(c: InputContent, value: number): string {
  return `${value.toFixed(Math.max(stepDecimals(c.step ?? 1), stepDecimals(c.min ?? 0)))}${unitOf(c)}`;
}

/** A value as a screen reader says it: the number and unit, and at either end what that end means. */
export function sliderSpoken(c: InputContent, value: number): string {
  const min = c.min ?? 0;
  const max = c.max ?? 100;
  const end = value === min ? c.startLabel : value === max ? c.endLabel : undefined;
  return end && end.trim() !== "" ? `${sliderShown(c, value)}, ${end.trim()}` : sliderShown(c, value);
}

const SVG = "http://www.w3.org/2000/svg";
/** A dial sweeps three quarters of a circle, from lower left, over the top, to lower right. Degrees are clockwise from straight up. */
const SWEEP = 135;

/** The picture of a dial: a track, the part of it that is filled, and a pointer. It is only a picture; the range control beside it is what the keyboard and a screen reader use. */
function dialFace(doc: Document): { svg: SVGSVGElement; show(fraction: number): void; angleOf(x: number, y: number): number } {
  const svg = doc.createElementNS(SVG, "svg") as SVGSVGElement;
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.setAttribute("class", "os-dial-face");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const R = 46;
  const at = (deg: number): string => `${(60 + R * Math.sin((deg * Math.PI) / 180)).toFixed(2)} ${(60 - R * Math.cos((deg * Math.PI) / 180)).toFixed(2)}`;
  const arc = (from: number, to: number): string => (to - from < 0.01 ? "" : `M ${at(from)} A ${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${at(to)}`);
  const part = (name: string, tag: string, attrs: Record<string, string>): SVGElement => {
    const e = doc.createElementNS(SVG, tag) as SVGElement;
    e.setAttribute("class", name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    svg.appendChild(e);
    return e;
  };
  part("os-dial-track", "path", { d: arc(-SWEEP, SWEEP) });
  const fill = part("os-dial-fill", "path", { d: "" });
  const pointer = part("os-dial-pointer", "line", { x1: "60", y1: "60", x2: "60", y2: String(60 - R + 8) });
  part("os-dial-hub", "circle", { cx: "60", cy: "60", r: "6" });
  return {
    svg,
    show(fraction: number) {
      const deg = -SWEEP + fraction * 2 * SWEEP;
      fill.setAttribute("d", arc(-SWEEP, deg));
      pointer.setAttribute("transform", `rotate(${deg.toFixed(2)} 60 60)`);
    },
    /** Which way a point on the page lies from the middle of the dial, kept to the sweep: a point in the gap at the bottom goes to the nearer end. */
    angleOf(x: number, y: number) {
      const box = svg.getBoundingClientRect();
      const deg = (Math.atan2(x - (box.left + box.width / 2), -(y - (box.top + box.height / 2))) * 180) / Math.PI;
      return Math.max(-SWEEP, Math.min(SWEEP, deg));
    },
  };
}

function make(doc: Document, tag: string, cls = "", attrs: Record<string, string> = {}): HTMLElement {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export function buildInput(doc: Document, obj: OSObject, hooks: InputHooks): HTMLElement {
  const c = obj.content as unknown as InputContent;
  const root = make(doc, "fieldset", `os-input os-input-${c.kind}`);
  const legend = make(doc, "legend", "os-input-prompt");
  legend.textContent = c.prompt;
  // The prompt is the group's name. If the author wrote different alt text, it is a description of it.
  const alt = obj.accessibility.altText.trim();
  if (alt !== "" && alt !== c.prompt.trim() && !obj.accessibility.decorative) root.setAttribute("aria-description", alt);
  root.appendChild(legend);
  const id = (part: string) => `${obj.id}-${part}`;
  const emit = (change: InputChange) => { if (!hooks.editing) hooks.onChange?.(change); };
  // In the editor the controls are drawn but do not respond, and are not tab stops.
  const inert = (e: HTMLElement) => { if (hooks.editing) { e.tabIndex = -1; e.style.pointerEvents = "none"; } };

  if (c.kind === "checkbox") {
    (c.items ?? []).forEach((item) => {
      const label = make(doc, "label", "os-input-choice");
      const box = make(doc, "input", "", { type: "checkbox" }) as HTMLInputElement;
      box.checked = !hooks.editing && hooks.value?.(item.variable) === true;
      box.addEventListener("change", () => emit({ rowId: item.id, variable: item.variable, value: box.checked, response: box.checked ? "1" : "0", type: "true-false" }));
      inert(box);
      label.append(box, doc.createTextNode(` ${item.label}`));
      root.appendChild(label);
    });
    return root;
  }

  if (c.kind === "radio") {
    const current = hooks.editing ? undefined : hooks.value?.(c.variable ?? "");
    (c.options ?? []).forEach((opt, i) => {
      const label = make(doc, "label", "os-input-choice");
      const radio = make(doc, "input", "", { type: "radio", name: obj.id, value: opt.value }) as HTMLInputElement;
      radio.checked = current !== undefined && current !== "" && current === opt.value;
      radio.addEventListener("change", () => { if (radio.checked) emit({ rowId: obj.id, variable: c.variable!, value: opt.value, response: letter(i), type: "choice" }); });
      inert(radio);
      label.append(radio, doc.createTextNode(` ${opt.label}`));
      root.appendChild(label);
    });
    return root;
  }

  if (c.kind === "slider" || c.kind === "dial") {
    // Both are one native range control, so the arrow keys, Home, End, Page Up and Page Down work and a screen reader says "slider, 40 percent".
    // A dial draws a picture of it that a pointer can drag or click (a single click sets the value, so nothing needs dragging).
    const min = c.min ?? 0;
    const max = c.max ?? 100;
    const step = c.step ?? 1;
    legend.id = id("legend");
    const stored = hooks.editing ? undefined : hooks.value?.(c.variable ?? "");
    let value = snapToStep(typeof stored === "number" ? stored : min, min, max, step);
    // The last value told to the LMS in this visit to the slide. Nothing has been yet, so any value the learner settles on is told once, even the one it started at.
    let reported = NaN;
    const range = make(doc, "input", c.kind === "dial" ? "os-dial-range" : "os-slider-range", {
      type: "range", id: id("range"), min: String(min), max: String(max), step: String(step), "aria-labelledby": id("legend"),
    }) as HTMLInputElement;
    const shown = make(doc, "output", "os-slider-value", { for: id("range"), "aria-live": "off" });
    const face = c.kind === "dial" ? dialFace(doc) : null;
    const draw = () => {
      range.value = String(value);
      range.setAttribute("aria-valuetext", sliderSpoken(c, value));
      shown.textContent = sliderShown(c, value);
      face?.show((value - min) / (max - min));
    };
    // `live` is a drag or a key still going on. The variable follows it; the LMS hears only the value the learner stops at.
    const decimals = Math.max(stepDecimals(step), stepDecimals(min));
    let moved = false;
    const apply = (next: number, live: boolean) => {
      value = next;
      if (live) moved = true;
      draw();
      // What is told to the LMS is the plain number, with no unit.
      const change: InputChange = { rowId: obj.id, variable: c.variable!, value: next, response: next.toFixed(decimals), type: "numeric" };
      if (live) {
        emit({ ...change, live: true });
      } else if (next !== reported) {
        reported = next;
        emit(change);
      }
    };
    // The variable follows every step. What is reported is the value the learner stops at: a mouse or finger on the slider reports when it
    // lets go, and the keys report when they have paused for a moment or the learner leaves the control, so holding an arrow key is not a
    // hundred answers.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pointerDown = false;
    // Only a value the learner has moved is reported: tabbing through a control, or a blur with nothing changed, reports nothing.
    const commit = () => { clearTimeout(timer); if (moved) { moved = false; apply(value, false); } };
    const soon = () => { clearTimeout(timer); if (!pointerDown) timer = setTimeout(commit, 400); };
    range.addEventListener("input", () => { apply(snapToStep(Number(range.value), min, max, step), true); soon(); });
    range.addEventListener("change", soon);
    range.addEventListener("blur", commit);
    range.addEventListener("pointerdown", () => { pointerDown = true; clearTimeout(timer); });
    const release = () => { if (pointerDown) { pointerDown = false; commit(); } };
    range.addEventListener("pointerup", release);
    range.addEventListener("pointercancel", release);
    inert(range);
    draw();

    const ends = make(doc, "div", "os-slider-ends");
    const start = make(doc, "span", "os-slider-end");
    start.textContent = c.startLabel ?? "";
    const end = make(doc, "span", "os-slider-end");
    end.textContent = c.endLabel ?? "";
    if (face) {
      const dial = make(doc, "div", "os-dial");
      dial.append(range, face.svg);
      let dragging = false;
      const move = (e: PointerEvent) => apply(snapToStep(min + ((face.angleOf(e.clientX, e.clientY) + SWEEP) / (2 * SWEEP)) * (max - min), min, max, step), true);
      face.svg.addEventListener("pointerdown", (e) => {
        if (hooks.editing) return;
        dragging = true;
        // Keeping hold of the pointer lets a drag go outside the picture. A pointer that cannot be held still works while it is over the dial.
        try { face.svg.setPointerCapture(e.pointerId); } catch { /* not every pointer can be captured */ }
        move(e);
      });
      face.svg.addEventListener("pointermove", (e) => { if (dragging) move(e); });
      const stop = () => { if (dragging) { dragging = false; commit(); } };
      face.svg.addEventListener("pointerup", stop);
      face.svg.addEventListener("pointercancel", stop);
      ends.append(start, end);
      root.append(dial, ends);
    } else {
      const row = make(doc, "div", "os-slider-row");
      row.append(start, range, end);
      root.appendChild(row);
    }
    if (c.showValue !== false) root.appendChild(shown);
    return root;
  }

  if (c.kind === "character") {
    // Picture cards, one radio button each, so the arrow keys move between them and a screen reader says "1 of 3".
    // The name is the button's name and the role goes with it as a description, together with what the picture shows (said once, here,
    // because choosing by how someone looks is the point). The picture itself says nothing.
    const cast = hooks.characters?.() ?? [];
    const current = hooks.editing ? undefined : hooks.value?.(c.variable ?? "");
    const group = make(doc, "div", "os-cards");
    (c.characters ?? []).forEach((personId, i) => {
      const person = cast.find((p) => p.id === personId);
      if (!person) return;
      const label = make(doc, "label", "os-card");
      const radio = make(doc, "input", "", { type: "radio", name: obj.id, value: person.id }) as HTMLInputElement;
      radio.checked = current !== undefined && current !== "" && current === person.id;
      const nameId = id(`${person.id}-name`);
      const described = [id(`${person.id}-role`)];
      radio.setAttribute("aria-labelledby", nameId);
      radio.addEventListener("change", () => { if (radio.checked) emit({ rowId: obj.id, variable: c.variable!, value: person.id, response: letter(i), type: "choice" }); });
      inert(radio);
      label.appendChild(radio);
      if (person.picture) {
        const img = make(doc, "img", "os-card-pic", { alt: "" }) as HTMLImageElement;
        img.src = person.picture.src;
        label.appendChild(img);
        if (!person.picture.decorative && person.picture.alt.trim() !== "") {
          const look = make(doc, "span", "os-sr-only", { id: id(`${person.id}-look`) });
          look.textContent = person.picture.alt;
          described.push(look.id);
          label.appendChild(look);
        }
      }
      const name = make(doc, "span", "os-card-name", { id: nameId });
      name.textContent = person.name;
      const role = make(doc, "span", "os-card-role", { id: id(`${person.id}-role`) });
      role.textContent = person.role;
      radio.setAttribute("aria-describedby", described.join(" "));
      label.append(name, role);
      group.appendChild(label);
    });
    root.appendChild(group);
    return root;
  }

  if (c.kind === "dropdown" || c.kind === "list") {
    // A drop-down and a list are one select element. It is named by the prompt, which is the legend above it.
    const select = make(doc, "select", "os-input-select", { id: id("select"), "aria-labelledby": id("legend") }) as HTMLSelectElement;
    legend.id = id("legend");
    const options = c.options ?? [];
    if (c.kind === "dropdown") {
      const none = make(doc, "option") as HTMLOptionElement;
      none.value = "";
      none.textContent = t("inputs.chooseOption");
      select.appendChild(none);
    } else {
      select.size = Math.min(Math.max(options.length, 2), 6);
    }
    options.forEach((opt) => {
      const o = make(doc, "option") as HTMLOptionElement;
      o.value = opt.value;
      o.textContent = opt.label;
      select.appendChild(o);
    });
    const current = hooks.editing ? undefined : hooks.value?.(c.variable ?? "");
    select.value = typeof current === "string" ? current : "";
    select.addEventListener("change", () => {
      const at = options.findIndex((o) => o.value === select.value);
      emit({ rowId: obj.id, variable: c.variable!, value: select.value, response: at < 0 ? "" : letter(at), type: "choice" });
    });
    inert(select);
    root.appendChild(select);
    return root;
  }

  if (c.kind === "likert") {
    const scale = c.scale ?? [];
    (c.rows ?? []).forEach((row) => {
      const group = make(doc, "div", "os-scale-row", { role: "radiogroup", "aria-labelledby": id(`${row.id}-s`) });
      const statement = make(doc, "span", "os-scale-statement", { id: id(`${row.id}-s`) });
      statement.textContent = row.label;
      const points = make(doc, "div", "os-scale-points");
      const current = hooks.editing ? undefined : hooks.value?.(row.variable);
      scale.forEach((name, i) => {
        const label = make(doc, "label", "os-scale-point");
        const radio = make(doc, "input", "", { type: "radio", name: id(row.id), value: String(i + 1) }) as HTMLInputElement;
        radio.checked = current === i + 1;
        radio.addEventListener("change", () => { if (radio.checked) emit({ rowId: row.id, variable: row.variable, value: i + 1, response: String(i + 1), type: "likert" }); });
        inert(radio);
        const text = make(doc, "span", "os-scale-label");
        text.textContent = name;
        label.append(radio, text);
        points.appendChild(label);
      });
      group.append(statement, points);
      root.appendChild(group);
    });
    return root;
  }

  // semantic differential: two opposite words with a row of points between them
  const n = c.points ?? 7;
  (c.rows ?? []).forEach((row) => {
    const group = make(doc, "div", "os-scale-row os-semantic-row", { role: "radiogroup", "aria-label": `${row.label} to ${row.right ?? ""}` });
    const left = make(doc, "span", "os-semantic-pole os-semantic-left");
    left.textContent = row.label;
    const right = make(doc, "span", "os-semantic-pole os-semantic-right");
    right.textContent = row.right ?? "";
    const points = make(doc, "div", "os-scale-points");
    const current = hooks.editing ? undefined : hooks.value?.(row.variable);
    for (let i = 1; i <= n; i++) {
      const label = make(doc, "label", "os-scale-point");
      const radio = make(doc, "input", "", { type: "radio", name: id(row.id), value: String(i) }) as HTMLInputElement;
      // The ends are named for the word they are closest to, so a screen reader user knows which way is which.
      radio.setAttribute("aria-label", i === 1 ? t("input.scaleEnd", { n: 1, total: n, word: row.label }) : i === n ? t("input.scaleEnd", { n, total: n, word: row.right ?? "" }) : t("input.scalePoint", { n: i, total: n }));
      radio.checked = current === i;
      radio.addEventListener("change", () => { if (radio.checked) emit({ rowId: row.id, variable: row.variable, value: i, response: String(i), type: "likert" }); });
      inert(radio);
      label.appendChild(radio);
      points.appendChild(label);
    }
    group.append(left, points, right);
    root.appendChild(group);
  });
  return root;
}
