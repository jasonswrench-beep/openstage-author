// File > Accessibility rules that stop a publish. Accessibility findings in the Problems list are warnings and never stop a publish (docs/validator-spec.md);
// a project can choose rules that do, for itself, and none is chosen until the author turns one on. The choice is kept in the project (`accessibilityBlockers`,
// format 0.50.0). This file holds the list the author chooses from (the rules of tools/a11y-rules.json, the one list the checker reads too) and the dialog.
// A native <dialog>, like the others: focus moves in, Tab stays inside, Escape closes it without a change.

import catalogue from "../../tools/a11y-rules.json" with { type: "json" };

export interface BlockerRule {
  id: string;
  title: string;
  /** The WCAG success criteria it answers, such as "1.1.1". */
  wcag: string[];
  level: "A" | "AA";
  /** The version of WCAG that added the criterion, when it is not 2.0. */
  since: string;
}

/** Every accessibility rule the author can choose, in the order the criteria come in WCAG. */
export function blockerRules(): BlockerRule[] {
  const order = (r: BlockerRule): number[] => r.wcag[0]!.split(".").map(Number);
  return (catalogue.rules as { id: string; title: string; wcag: string[]; level: string; since?: string }[])
    .map((r) => ({ id: r.id, title: r.title, wcag: r.wcag, level: (r.level === "AA" ? "AA" : "A") as "A" | "AA", since: r.since ?? "2.0" }))
    .sort((a, b) => { const x = order(a); const y = order(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0); return a.id.localeCompare(b.id); });
}

/** How a rule reads in the list: what it catches, then the criterion it answers. */
export function ruleLabel(r: BlockerRule): string {
  return `${r.title} (WCAG ${r.wcag.join(" and ")}${r.since === "2.2" ? ", new in 2.2" : ""}, level ${r.level})`;
}

/** What to say once the choice is made. */
export function blockersSaid(chosen: string[]): string {
  if (chosen.length === 0) return "No accessibility rule stops a publish now. Accessibility problems are warnings.";
  return `${chosen.length === 1 ? "One accessibility rule" : `${chosen.length} accessibility rules`} will stop a publish for this course. The others stay warnings.`;
}

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

/** Ask which rules stop a publish. Resolves to the rule ids chosen (possibly none), or null if the dialog was cancelled. */
export function askAccessibilityBlockers(current: string[]): Promise<string[] | null> {
  return new Promise((resolve) => {
    const rules = blockerRules();
    const known = new Set(rules.map((r) => r.id));
    const dialog = h("dialog", { class: "dialog wide blockers-dialog", "aria-labelledby": "ab-title", "aria-describedby": "ab-intro" });
    const form = h("form", { method: "dialog" });
    let result: string[] | null = null;
    const finish = () => { dialog.close(); dialog.remove(); resolve(result); };

    const boxes = rules.map((r) => {
      const box = h("input", { type: "checkbox", id: `ab-${r.id}`, ...(current.includes(r.id) ? { checked: true } : {}) });
      return { rule: r, box, row: h("div", { class: "field check" }, box, h("label", { for: `ab-${r.id}`, text: ruleLabel(r) })) };
    });
    // A rule an older or newer program named that this one does not know is kept as it is, so opening this dialog never drops it.
    const unknown = current.filter((id) => !known.has(id));

    const none = h("button", { type: "button", text: "Choose none" });
    none.addEventListener("click", () => { for (const b of boxes) b.box.checked = false; status.textContent = "None chosen."; });
    const all = h("button", { type: "button", text: "Choose all" });
    all.addEventListener("click", () => { for (const b of boxes) b.box.checked = true; status.textContent = `All ${boxes.length} chosen.`; });
    const status = h("p", { class: "note", role: "status", "aria-live": "polite" });

    const save = h("button", { type: "submit", text: "Save" });
    save.addEventListener("click", (e) => {
      e.preventDefault();
      result = [...boxes.filter((b) => b.box.checked).map((b) => b.rule.id), ...unknown];
      finish();
    });
    const cancel = h("button", { type: "button", text: "Cancel" });
    cancel.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });
    form.addEventListener("submit", (e) => e.preventDefault());

    form.append(
      h("h2", { id: "ab-title", text: "Accessibility rules that stop a publish" }),
      h("p", { id: "ab-intro", class: "note", text: "Accessibility problems are warnings: they are listed in Problems with the WCAG criterion each one answers, and they never stop a publish. If this course must not go out with a certain kind of problem, choose it here and it will stop a publish, for this course only. None is chosen until you choose it." }),
      h("div", { class: "btn-row" }, none, all),
      h("fieldset", {}, h("legend", { text: "Stop a publish for" }), ...boxes.map((b) => b.row)),
      ...(unknown.length > 0 ? [h("p", { class: "note", text: `This course also names ${unknown.length === 1 ? "a rule" : `${unknown.length} rules`} this program does not know (${unknown.join(", ")}). ${unknown.length === 1 ? "It is" : "They are"} kept as written.` })] : []),
      status,
      h("div", { class: "dialog-actions" }, save, cancel),
    );
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    dialog.showModal();
    boxes[0]?.box.focus();
  });
}
