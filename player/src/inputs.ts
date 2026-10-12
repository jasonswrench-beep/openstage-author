// Inputs: checkboxes, radio buttons, a drop-down, a list, and the two survey scales (Likert and
// semantic differential). Each one is built from native form controls, so the keyboard and screen
// reader behaviour is the browser's own, and each writes what the learner chose into a variable
// that triggers can read. The renderer calls buildInput for an object of type "input".

import type { InputContent, OSObject, Primitive } from "./types.ts";

export const INPUT_KINDS = ["checkbox", "radio", "dropdown", "list", "likert", "semantic"] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

/** What an input tells the course when the learner changes it. */
export interface InputChange {
  /** The part of the input that changed: an option, a checkbox or a row of a scale. */
  rowId: string;
  variable: string;
  value: Primitive;
  /** What to tell the LMS if the input reports: a letter for a choice, a number for a scale, 1 or 0 for a checkbox. */
  response: string;
  type: "choice" | "likert" | "true-false";
}

export interface InputHooks {
  editing: boolean;
  /** The variable's value now, so a learner who comes back sees what they chose. */
  value?(variable: string): Primitive | undefined;
  onChange?(change: InputChange): void;
}

/** The variable type each kind of input writes. The validator and the editor use the same table. */
export const INPUT_VARIABLE_TYPE: Record<InputKind, "boolean" | "string" | "number"> = {
  checkbox: "boolean", radio: "string", dropdown: "string", list: "string", likert: "number", semantic: "number",
};

const letter = (i: number) => String.fromCharCode(97 + i);

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

  if (c.kind === "dropdown" || c.kind === "list") {
    // A drop-down and a list are one select element. It is named by the prompt, which is the legend above it.
    const select = make(doc, "select", "os-input-select", { id: id("select"), "aria-labelledby": id("legend") }) as HTMLSelectElement;
    legend.id = id("legend");
    const options = c.options ?? [];
    if (c.kind === "dropdown") {
      const none = make(doc, "option") as HTMLOptionElement;
      none.value = "";
      none.textContent = "Choose an option";
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
      radio.setAttribute("aria-label", i === 1 ? `1 of ${n}, closest to ${row.label}` : i === n ? `${n} of ${n}, closest to ${row.right ?? ""}` : `${i} of ${n}`);
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
