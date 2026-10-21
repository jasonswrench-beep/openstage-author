// The Question banks dialog. A bank is a run of slides of which each learner is shown some, picked at random when they begin and kept with
// their progress, so two learners (or two tries) do not get the same questions. Here an author makes a bank from the slides between two
// slides, says how many to show and whether to mix them, and takes a bank away. A native <dialog>, like the others: focus moves in, Tab
// stays inside, Escape closes it and focus returns.

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

export function openBanks(model: Model, announce: (message: string) => void): Promise<void> {
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "dialog wide banks-dialog", "aria-labelledby": "bk-title" });
    const list = h("div", { class: "bk-list" });
    const status = h("p", { class: "as-status", role: "status" });
    const say = (text: string) => { status.textContent = text; };

    const slideSelect = (id: string, label: string, value: string, onChange: (v: string) => void): HTMLElement => {
      const sel = h("select", { id }, ...model.slides.map((s, i) => h("option", { value: s.id, text: `${i + 1}. ${s.name}` })));
      sel.value = value;
      sel.addEventListener("change", () => onChange(sel.value));
      return h("div", { class: "field" }, h("label", { for: id, text: label }), sel);
    };

    const render = () => {
      list.replaceChildren();
      if (model.banks.length === 0) list.appendChild(h("p", { class: "note", text: "There are no question banks yet. Every learner is shown every slide." }));
      for (const bank of model.banks) {
        const first = bank.slides[0] ?? "";
        const last = bank.slides[bank.slides.length - 1] ?? "";
        // Where the bank is, in the course's own order: the first and the last of its slides as they stand.
        const order = model.slides.map((s) => s.id);
        const spots = bank.slides.map((s) => order.indexOf(s)).filter((i) => i >= 0).sort((a, b) => a - b);
        const from = order[spots[0] ?? 0] ?? first;
        const to = order[spots[spots.length - 1] ?? 0] ?? last;
        const name = h("input", { type: "text", id: `bk-name-${bank.id}` });
        name.value = bank.name;
        name.addEventListener("change", () => { const msg = model.setBankName(bank.id, name.value); if (msg) say(msg); render(); });
        const draw = h("input", { type: "number", id: `bk-draw-${bank.id}`, min: "1", max: String(bank.slides.length), step: "1" });
        draw.value = String(bank.draw);
        draw.addEventListener("change", () => { const msg = model.setBankDraw(bank.id, Number(draw.value)); if (msg) say(msg); render(); });
        const mix = h("input", { type: "checkbox", id: `bk-mix-${bank.id}`, ...(bank.shuffle ? { checked: true } : {}) });
        mix.addEventListener("change", () => { const msg = model.setBankMix(bank.id, mix.checked); if (msg) say(msg); render(); });
        const del = h("button", { type: "button", class: "small", text: "Delete bank", "aria-label": `Delete the question bank ${bank.name}` });
        del.addEventListener("click", () => { const msg = model.deleteBank(bank.id); if (msg) { say(msg); announce(msg); } render(); addName.focus(); });
        const together = spots.length > 0 && spots[spots.length - 1]! - spots[0]! + 1 === spots.length;
        list.appendChild(h("fieldset", { class: "bk-row" },
          h("legend", { text: bank.name }),
          h("div", { class: "field" }, h("label", { for: `bk-name-${bank.id}`, text: "Name" }), name),
          slideSelect(`bk-from-${bank.id}`, "First slide", from, (v) => { const msg = model.setBankRange(bank.id, v, to); if (msg) say(msg); render(); }),
          slideSelect(`bk-to-${bank.id}`, "Last slide", to, (v) => { const msg = model.setBankRange(bank.id, from, v); if (msg) say(msg); render(); }),
          h("div", { class: "field" }, h("label", { for: `bk-draw-${bank.id}`, text: `Show how many of its ${bank.slides.length} slides to each learner` }), draw),
          h("div", { class: "field check" }, mix, h("label", { for: `bk-mix-${bank.id}`, text: "Show them in a mixed order" })),
          h("p", { class: "note", text: `${bank.slides.length} slides. Each learner is shown ${bank.draw}${bank.draw === bank.slides.length && !bank.shuffle ? ", the same every time, so this bank changes nothing" : ""}.${together ? "" : " Its slides are not side by side any more: the slides shown take the place of the first one, so the slides between stay where they are. Choose a first and last slide to put it right."}` }),
          del));
      }
    };

    const current = model.sel.slideId;
    const nextOne = model.slides[model.slides.findIndex((s) => s.id === current) + 1]?.id ?? current;
    let addFirst = current;
    let addLast = nextOne;
    const addName = h("input", { type: "text", id: "bk-new-name" });
    const addFields = h("div", { class: "bk-new-slides" });
    const renderAdd = () => addFields.replaceChildren(
      slideSelect("bk-new-from", "First slide", addFirst, (v) => { addFirst = v; }),
      slideSelect("bk-new-to", "Last slide", addLast, (v) => { addLast = v; }));
    const add = h("button", { type: "button", text: "Add bank" });
    add.addEventListener("click", () => {
      const msg = model.addBank(addFirst, addLast, addName.value);
      if (msg) { say(msg); announce(msg); }
      if (msg && msg.startsWith("Added")) { addName.value = ""; render(); document.getElementById(`bk-name-${model.banks[model.banks.length - 1]!.id}`)?.focus(); }
    });
    const close = h("button", { type: "button", text: "Close" });

    dialog.append(
      h("h2", { id: "bk-title", text: "Question banks" }),
      h("p", { class: "note", text: "A question bank shows each learner some of its slides, picked at random when they begin and remembered if they come back, so two learners do not get the same questions. Put the questions of a bank on slides that sit together, one question to a slide. The score and whether the course counts as complete follow the slides a learner was shown. A rule that jumps to a slide of a bank may lead to a slide that learner was not given, so jump to the slide before the bank instead." }),
      list,
      h("fieldset", { class: "bk-add" }, h("legend", { text: "New question bank" }),
        h("div", { class: "field" }, h("label", { for: "bk-new-name", text: "Name (optional)" }), addName),
        addFields,
        h("p", { class: "note", text: "The bank holds these two slides and every slide between them. It starts by showing half of them, in a mixed order." }),
        add),
      status,
      h("div", { class: "dialog-actions" }, close),
    );
    document.body.appendChild(dialog);
    const finish = () => { dialog.close(); dialog.remove(); announce("Question banks closed."); resolve(); };
    close.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });
    render();
    renderAdd();
    dialog.showModal();
    (model.banks.length > 0 ? list.querySelector<HTMLElement>("input") ?? addName : addName).focus();
  });
}
