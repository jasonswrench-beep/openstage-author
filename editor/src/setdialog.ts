// The two dialogs for slides handed over as a file: one to choose which slides to share and say what the set is, and one to look at a set someone sent before adding it. Like the
// other dialogs they are native <dialog>s, so focus moves in, Tab stays inside and Escape closes them, and every control is a real labelled control.

import { describeSet, sizeWords, type SetRead } from "./slidesets.ts";

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

export interface ShareChoice {
  slides: string[];
  title: string;
  author: string;
  licence: string;
  description: string;
}

export interface ShareOptions {
  slides: { id: string; name: string }[];
  /** The slide being edited: it starts chosen, and its name starts the title. */
  current: string;
  author: string;
}

export const DEFAULT_LICENCE = "Free to use and change, with credit to the author.";

/** Ask which slides to share and what to say about them. Resolves to the choice, or null if the dialog was cancelled. */
export function askShare(opts: ShareOptions): Promise<ShareChoice | null> {
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "dialog wide", "aria-labelledby": "ss-title" });
    const form = h("form", { method: "dialog" });
    const title = h("h2", { id: "ss-title", text: "Share slides" });
    const intro = h("p", { class: "note", text: "Slides you share go into one file that someone else can add to their own course with Add slides from a file. It carries the slides, the variables and rules that make a game play, the people in a scenario, and the pictures and sounds the slides use, with where they came from. It does not carry your theme or your narration audio. A rule that leads to a slide you leave out is left out of the file. Share only what you are free to share: say below what others may do with it." });
    const group = h("fieldset", { class: "ss-slides" }, h("legend", { text: "Slides to share" }));
    const boxes: { id: string; box: HTMLInputElement }[] = [];
    opts.slides.forEach((s, i) => {
      const box = h("input", { type: "checkbox", id: `ss-slide-${i}`, ...(s.id === opts.current ? { checked: true } : {}) });
      boxes.push({ id: s.id, box });
      group.append(h("div", { class: "field check" }, box, h("label", { for: `ss-slide-${i}`, text: `${i + 1}. ${s.name}` })));
    });
    const all = h("button", { type: "button", text: "Choose all the slides" });
    const none = h("button", { type: "button", text: "Choose none" });
    const status = h("p", { class: "note", role: "status", "aria-live": "polite" });
    const count = () => boxes.filter((b) => b.box.checked).length;
    const say = () => { status.textContent = `${count()} of ${boxes.length} ${boxes.length === 1 ? "slide" : "slides"} chosen.`; };
    group.addEventListener("change", say);
    all.addEventListener("click", () => { for (const b of boxes) b.box.checked = true; say(); });
    none.addEventListener("click", () => { for (const b of boxes) b.box.checked = false; say(); });

    const field = (id: string, label: string, value: string, area = false): HTMLInputElement | HTMLTextAreaElement => {
      const input = area ? h("textarea", { id, rows: "3" }) : h("input", { id, type: "text" });
      input.value = value;
      return input;
    };
    const currentName = opts.slides.find((s) => s.id === opts.current)?.name ?? "";
    const titleBox = field("ss-name", "Name of the set", currentName);
    const authorBox = field("ss-author", "Your name", opts.author);
    const descBox = field("ss-about", "What it is for", "", true);
    const licenceBox = field("ss-licence", "What others may do with it", DEFAULT_LICENCE);
    const failure = h("p", { class: "dialog-error", role: "alert" });
    const row = (id: string, label: string, input: HTMLElement, help?: string) => h("div", { class: "field" }, h("label", { for: id, text: label }), input, ...(help ? [h("p", { class: "note", text: help })] : []));

    const next = h("button", { type: "submit", text: "Choose where to save it..." });
    const cancel = h("button", { type: "button", text: "Cancel" });
    form.append(title, intro, h("div", { class: "btn-row" }, all, none), group, status,
      row("ss-name", "Name of the set", titleBox), row("ss-author", "Your name", authorBox), row("ss-about", "What it is for", descBox, "A sentence or two, for the person who is deciding whether to add it."),
      row("ss-licence", "What others may do with it", licenceBox, "In your own words, such as \"Free to use and change, with credit to the author\" or \"Public domain\". It is shown to whoever adds the set."),
      failure, h("div", { class: "dialog-actions" }, next, cancel));
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    say();

    let result: ShareChoice | null = null;
    const finish = () => { dialog.close(); dialog.remove(); resolve(result); };
    cancel.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (count() === 0) { failure.textContent = "Choose at least one slide."; return; }
      if (titleBox.value.trim() === "") { failure.textContent = "The set needs a name."; titleBox.focus(); return; }
      if (licenceBox.value.trim() === "") { failure.textContent = "Say what others may do with it."; licenceBox.focus(); return; }
      result = { slides: boxes.filter((b) => b.box.checked).map((b) => b.id), title: titleBox.value.trim(), author: authorBox.value.trim(), licence: licenceBox.value.trim(), description: descBox.value.trim() };
      finish();
    });
    dialog.showModal();
    (boxes.find((b) => b.box.checked)?.box ?? all).focus();
  });
}

/** Show what a set holds before it is added. Resolves to true if the author chose to add it. */
export function askAddSet(read: SetRead, after: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "dialog wide", "aria-labelledby": "as-title" });
    const form = h("form", { method: "dialog" });
    const set = read.set;
    const facts = h("dl", { class: "set-facts" });
    const fact = (term: string, value: string) => { if (value) facts.append(h("dt", { text: term }), h("dd", { text: value })); };
    fact("Made by", set.author);
    fact("What it is for", set.description);
    fact("What others may do with it", set.licence);
    fact("It holds", describeSet(read));
    fact("Made for a stage", `${set.stage.width} by ${set.stage.height}`);
    const slides = h("ol", { class: "set-slides" }, ...read.slides.map((s) => h("li", { text: s.name })));
    const files = read.assets.length > 0 ? h("p", { class: "note", text: `Its ${read.assets.length === 1 ? "file is" : "files are"} copied into your project's assets (${sizeWords(read.assets.reduce((n, a) => n + a.bytes, 0))}), under names not already used there.` }) : null;
    const add = h("button", { type: "submit", text: `Add after ${after || "the last slide"}` });
    const cancel = h("button", { type: "button", text: "Cancel" });
    form.append(
      h("h2", { id: "as-title", text: `Add ${set.title}?` }),
      h("p", { class: "note", text: "These slides were made by someone else. They come in as ordinary slides of your own course, with their own variables, and you can change all of it afterwards. One Undo takes them all away again." }),
      facts,
      h("h3", { id: "as-slides-h", text: "The slides" }),
      slides,
      ...(files ? [files] : []),
      ...(read.migrated ? [h("p", { class: "note", text: "This set was made with an older version of the format and has been brought up to date." })] : []),
      h("div", { class: "dialog-actions" }, add, cancel));
    slides.setAttribute("aria-labelledby", "as-slides-h");
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    let result = false;
    const finish = () => { dialog.close(); dialog.remove(); resolve(result); };
    cancel.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });
    form.addEventListener("submit", (e) => { e.preventDefault(); result = true; finish(); });
    dialog.showModal();
    add.focus();
  });
}
