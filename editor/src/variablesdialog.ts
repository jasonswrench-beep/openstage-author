// The Variables dialog: the project's variables, which rules and inputs read and write. A variable is
// a named value the course remembers, such as "path" (text), "score" (a number) or "seenIntro" (true or
// false). Here an author adds them, names them, sets what they start as, and deletes the ones nothing uses.
// A native <dialog>, so focus moves in, Tab stays inside, Escape closes it and focus returns.

import type { Variable } from "../../player/src/types.ts";
import type { Model } from "./model.ts";

type Attrs = Record<string, string | boolean>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    if (k === "class") e.className = String(v);
    else if (k === "text") e.textContent = String(v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  e.append(...kids);
  return e;
}

export const TYPE_LABELS: Record<Variable["type"], string> = { string: "Text", number: "Number", boolean: "True or false" };

/** A box for a variable's value that suits its kind. */
function valueInput(id: string, label: string, v: Variable, onChange: (value: Variable["initial"]) => void): HTMLElement {
  if (v.type === "boolean") {
    const sel = h("select", { id, "aria-label": label }, h("option", { value: "true", text: "true" }), h("option", { value: "false", text: "false" }));
    sel.value = String(v.initial);
    sel.addEventListener("change", () => onChange(sel.value === "true"));
    return sel;
  }
  const input = h("input", { id, type: v.type === "number" ? "number" : "text", "aria-label": label, ...(v.type === "number" ? { step: "any" } : {}) });
  input.value = String(v.initial);
  input.addEventListener("change", () => onChange(v.type === "number" ? (input.value.trim() === "" ? Number.NaN : Number(input.value)) : input.value));
  return input;
}

export function openVariables(model: Model, announce: (message: string) => void): Promise<void> {
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "dialog wide variables-dialog", "aria-labelledby": "vr-title" });
    const body = h("div", { class: "vr-list" });
    const status = h("p", { class: "as-status", role: "status" });
    const say = (text: string) => { status.textContent = text; };

    const render = () => {
      body.replaceChildren();
      if (model.variables.length === 0) body.appendChild(h("p", { class: "note", text: "There are no variables yet. Add one below, or add an input, which makes its own." }));
      for (const v of model.variables) {
        const uses = model.variableUsage(v.id);
        const name = h("input", { type: "text", id: `vr-name-${v.id}`, "aria-label": `Name of ${v.name}` });
        name.value = v.name;
        name.addEventListener("change", () => { const msg = model.renameVariable(v.id, name.value); if (msg) say(msg); render(); });
        const del = h("button", { type: "button", class: "small", text: "Delete", "aria-label": `Delete ${v.name}` });
        if (uses.length > 0) del.setAttribute("aria-disabled", "true");
        del.addEventListener("click", () => { const msg = model.deleteVariable(v.id); if (msg) say(msg); render(); });
        body.appendChild(h("div", { class: "vr-row", role: "group", "aria-label": v.name },
          name,
          h("span", { class: "vr-type", text: TYPE_LABELS[v.type] }),
          h("span", { class: "vr-start" }, h("label", { for: `vr-init-${v.id}`, text: "Starts as " }), valueInput(`vr-init-${v.id}`, `${v.name} starts as`, v, (value) => {
            const msg = model.setVariableInitial(v.id, value);
            if (msg) say(msg);
            render();
          })),
          h("span", { class: "vr-used", text: uses.length === 0 ? "Not used" : `Used ${uses.length} ${uses.length === 1 ? "time" : "times"}` }),
          del));
      }
    };

    const newName = h("input", { id: "vr-new-name", type: "text" });
    const newType = h("select", { id: "vr-new-type" }, ...(["string", "number", "boolean"] as const).map((t) => h("option", { value: t, text: TYPE_LABELS[t] })));
    const add = h("button", { type: "button", text: "Add variable" });
    add.addEventListener("click", () => {
      const name = newName.value.trim();
      if (name === "") { say("Give the variable a name first."); newName.focus(); return; }
      if (model.variables.some((v) => v.name.toLowerCase() === name.toLowerCase())) { say(`There is already a variable called ${name}.`); newName.focus(); return; }
      const v = model.addVariable(newType.value as Variable["type"], name);
      newName.value = "";
      say(`Added ${v.name}.`);
      render();
      document.getElementById(`vr-name-${v.id}`)?.focus();
    });
    const close = h("button", { type: "button", text: "Close" });

    dialog.append(
      h("h2", { id: "vr-title", text: "Variables" }),
      h("p", { class: "note", text: "A variable is a value the course remembers: text, a number, or true or false. Rules read and change them, and inputs save the learner's answers in them. Only a variable nothing uses can be deleted." }),
      body,
      h("fieldset", { class: "vr-add" }, h("legend", { text: "New variable" }),
        h("div", { class: "field" }, h("label", { for: "vr-new-name", text: "Name" }), newName),
        h("div", { class: "field" }, h("label", { for: "vr-new-type", text: "Kind" }), newType),
        add),
      status,
      h("div", { class: "dialog-actions" }, close),
    );
    document.body.appendChild(dialog);
    const finish = () => { dialog.close(); dialog.remove(); announce("Variables closed."); resolve(); };
    close.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });
    render();
    dialog.showModal();
    newName.focus();
  });
}
