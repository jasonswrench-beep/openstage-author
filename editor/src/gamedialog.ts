// The dialog that asks how big a game should be before it is made, such as how many categories a quiz board has. A native <dialog>, like the
// others: focus moves in, Tab stays inside, Escape closes it, and focus goes back to where it was. Each question is a labelled drop-down of
// whole numbers, so it works by keyboard and a screen reader, and a live line says how many slides the choice will add.

import { gameOptions, type GameOptions, type GameSet } from "./gamesets.ts";

/** Resolves to the numbers chosen, or null if the dialog was cancelled. */
export function askGame(set: GameSet): Promise<GameOptions | null> {
  return new Promise((resolve) => {
    const doc = document;
    const dialog = doc.createElement("dialog");
    dialog.className = "dialog";
    dialog.setAttribute("aria-labelledby", "gd-title");

    const heading = doc.createElement("h2");
    heading.id = "gd-title";
    heading.textContent = set.label;

    const intro = doc.createElement("p");
    intro.className = "note";
    intro.textContent = set.description;

    const selects = new Map<string, HTMLSelectElement>();
    const fields = doc.createElement("div");
    for (const choice of set.choices) {
      const row = doc.createElement("div");
      row.className = "field";
      const label = doc.createElement("label");
      label.htmlFor = `gd-${choice.id}`;
      label.textContent = choice.label;
      const select = doc.createElement("select");
      select.id = `gd-${choice.id}`;
      select.setAttribute("aria-describedby", `gd-${choice.id}-help gd-summary`);
      for (let n = choice.min; n <= choice.max; n++) {
        const option = doc.createElement("option");
        option.value = String(n);
        option.textContent = String(n);
        option.selected = n === choice.initial;
        select.appendChild(option);
      }
      const help = doc.createElement("p");
      help.id = `gd-${choice.id}-help`;
      help.className = "note";
      help.textContent = choice.help;
      selects.set(choice.id, select);
      row.append(label, select);
      fields.append(row, help);
    }

    const chosen = (): GameOptions => gameOptions(set, Object.fromEntries([...selects].map(([id, s]) => [id, Number(s.value)])));

    const summary = doc.createElement("p");
    summary.id = "gd-summary";
    summary.className = "note";
    summary.setAttribute("role", "status");
    summary.textContent = set.summary(chosen());
    for (const s of selects.values()) s.addEventListener("change", () => (summary.textContent = set.summary(chosen())));

    const ok = doc.createElement("button");
    ok.type = "submit";
    ok.textContent = "Add game";
    const cancel = doc.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    const actions = doc.createElement("div");
    actions.className = "dialog-actions";
    actions.append(ok, cancel);

    const form = doc.createElement("form");
    form.method = "dialog";
    form.append(heading, intro, fields, summary, actions);
    dialog.appendChild(form);
    doc.body.appendChild(dialog);

    let result: GameOptions | null = null;
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
      result = chosen();
      finish();
    });

    dialog.showModal();
    selects.values().next().value?.focus();
  });
}
