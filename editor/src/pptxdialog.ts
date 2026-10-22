// The PowerPoint dialog: bring slides in from a PowerPoint presentation (.pptx), or bring slides imported earlier up to date after the
// presentation has changed. One native <dialog> that goes through a few steps: choose the file, say what to do with it, choose what to
// bring in, and a report of what was done and what was left out. Every step is a heading that takes the focus, real check boxes inside
// labelled groups, and a status area for what is happening, so it works from the keyboard and with a screen reader. Nothing is changed
// in the project until the author presses the button that says so, and then it is one step to undo.

import type { Deck } from "./pptx/deck.ts";
import { readDeck } from "./pptx/deck.ts";
import type { PreparedImport } from "./pptx/import.ts";
import { openDeck, type Pkg } from "./pptx/package.ts";
import { assetsFor, offered, type PlanItem, type ResyncPlan } from "./pptx/resync.ts";
import type { Model } from "./model.ts";
import { silentBeforeText, silentCourseText } from "./engine.ts";
import { deckTones } from "./pptx/tones.ts";

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

export interface PowerPointDialogOptions {
  model: Model;
  /** Save a picture from the presentation in the project's images. */
  savePicture(name: string, bytes: Uint8Array): Promise<string>;
  announce(message: string): void;
  /** Whether sound can be made now for the voice the course uses (the narration voice is installed, or the course's voice is a service or a plugin that is set up). Looks again each time. */
  canMakeAudio(): Promise<boolean>;
}

/** What the dialog tells the editor when it closes: whether to go on to the Narration window, where the audio is made and the voice installed. */
export interface PowerPointDialogResult {
  openNarration: boolean;
}

interface Opened {
  name: string;
  pkg: Pkg;
  deck: Deck;
  /** The average colour of each picture the deck uses as a background, so text on it can be checked. */
  tones: Map<string, string>;
}

const MAX_FILE = 300 * 1024 * 1024;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Read a .pptx file into a deck. Throws a sentence the author can act on. */
export async function readFile(file: File): Promise<Opened> {
  if (!/\.pptx$/i.test(file.name)) {
    throw new Error(/\.ppt$/i.test(file.name)
      ? "That is an older PowerPoint file (.ppt). In PowerPoint, choose Save As and save it as a PowerPoint Presentation (.pptx), then choose that."
      : "That is not a PowerPoint presentation. Choose a file that ends in .pptx. (Google Slides can download one: File, Download, Microsoft PowerPoint.)");
  }
  if (file.size > MAX_FILE) throw new Error("That file is too big to read here (over 300 megabytes). Save a smaller copy without large videos.");
  const pkg = openDeck(new Uint8Array(await file.arrayBuffer()));
  const deck = readDeck(pkg);
  return { name: file.name, pkg, deck, tones: await deckTones(pkg, deck) };
}

export function openPowerPoint(opts: PowerPointDialogOptions): Promise<PowerPointDialogResult> {
  const { model } = opts;
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "dialog wide pptx-dialog", "aria-labelledby": "pp-title" });
    const title = h("h2", { id: "pp-title", tabindex: "-1" });
    const body = h("div", { class: "pp-body" });
    const error = h("p", { class: "dialog-error", role: "alert" });
    const status = h("p", { class: "as-status", role: "status" });
    const actions = h("div", { class: "dialog-actions" });
    dialog.append(title, body, error, status, actions);

    let busy = false;
    let opened: Opened | null = null;
    const say = (text: string) => { status.textContent = text; };
    const fail = (text: string) => { error.textContent = text; opts.announce(text); };
    let toNarration = false;
    const finish = () => { dialog.close(); dialog.remove(); resolve({ openNarration: toNarration }); };
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); if (!busy) finish(); });

    const button = (label: string, fn: () => void | Promise<void>, kind: "primary" | "plain" = "plain", name = ""): HTMLButtonElement => {
      const b = h("button", { type: "button", text: label, ...(kind === "primary" ? { class: "primary" } : {}) });
      if (name) b.setAttribute("aria-label", name);
      b.addEventListener("click", () => { if (b.getAttribute("aria-disabled") !== "true" && !busy) void fn(); });
      return b;
    };
    const closeBtn = button("Close", finish);
    const enable = (b: HTMLElement, on: boolean) => { if (on) b.removeAttribute("aria-disabled"); else b.setAttribute("aria-disabled", "true"); };

    /** Show a step: its heading takes the focus, so a screen reader says where the author is. */
    const show = (heading: string, content: Node[], buttons: HTMLButtonElement[], focus?: HTMLElement) => {
      error.textContent = "";
      status.textContent = "";
      title.textContent = heading;
      body.replaceChildren(...content);
      actions.replaceChildren(...buttons, closeBtn);
      (focus ?? title).focus();
    };

    const check = (label: string, on: boolean, detail: string[] = [], extra = ""): { row: HTMLElement; input: HTMLInputElement } => {
      const input = h("input", { type: "checkbox", ...(on ? { checked: true } : {}) });
      const describedBy = detail.length > 0 ? `pp-d-${Math.random().toString(36).slice(2, 8)}` : "";
      const list = detail.length > 0 ? h("ul", { class: "pp-detail note", id: describedBy }, ...detail.map((d) => h("li", { text: d }))) : null;
      if (describedBy) input.setAttribute("aria-describedby", describedBy);
      const row = h("div", { class: "pp-item" }, h("label", { class: "pp-check" }, input, h("span", { text: label })), ...(extra ? [h("p", { class: "note pp-detail", text: extra })] : []), ...(list ? [list] : []));
      return { row, input };
    };

    // ---- step 1: choose the file
    const stepChoose = () => {
      const file = h("input", { type: "file", id: "pp-file", accept: ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" });
      file.addEventListener("change", async () => {
        const picked = file.files?.[0];
        if (!picked) return;
        busy = true;
        error.textContent = "";
        say("Reading the presentation...");
        try {
          opened = await readFile(picked);
          busy = false;
          say("");
          if (model.deckSources.length > 0) stepMode();
          else stepImport();
        } catch (err) {
          busy = false;
          say("");
          fail(err instanceof Error ? err.message : String(err));
          file.value = "";
          file.focus();
        }
      });
      show("PowerPoint", [
        h("p", { class: "note", text: "Bring slides in from a PowerPoint presentation, or bring slides you imported earlier up to date after the presentation has changed. The presentation itself is never changed." }),
        h("div", { class: "field" }, h("label", { for: "pp-file", text: "PowerPoint file (.pptx)" }), file),
        h("p", { class: "note", text: "Google Slides can download a presentation as a .pptx file. Pictures, text, tables, shapes, entrance animations and speaker notes (as narration, if you choose) come across; charts, SmartArt, transitions and movies do not, and a report afterwards says what was left out." }),
      ], [], file);
    };

    const summary = (o: Opened) => `${plural(o.deck.slides.length, "slide")}, ${(o.deck.slideWidth / 914400).toFixed(1)} by ${(o.deck.slideHeight / 914400).toFixed(1)} inches`;

    // ---- step 2: a new deck, or a newer version of one already brought in
    const stepMode = () => {
      const o = opened!;
      const ids = new Set(o.deck.slides.map((s) => s.slideId));
      const overlap = (seen: string[] | undefined) => (seen ?? []).filter((s) => ids.has(s)).length;
      const best = [...model.deckSources].sort((a, b) => overlap(b.seen) - overlap(a.seen))[0]!;
      const likely = overlap(best.seen) > 0;
      const radio = (id: string, label: string, on: boolean) => {
        const input = h("input", { type: "radio", name: "pp-mode", id, ...(on ? { checked: true } : {}) });
        return { input, row: h("label", { class: "pp-check", for: id }, input, h("span", { text: label })) };
      };
      const fresh = radio("pp-mode-new", "Bring slides in as a new presentation", !likely);
      const update = radio("pp-mode-update", "Bring slides I brought in earlier up to date from this file", likely);
      const which = h("select", { id: "pp-source" }, ...model.deckSources.map((d) => h("option", { value: d.id, text: `${d.name}, brought in ${d.importedAt.slice(0, 10)}` })));
      which.value = best.id;
      const go = button("Continue", () => { if (update.input.checked) stepUpdate(which.value); else stepImport(); }, "primary");
      show(o.name, [
        h("p", { text: `${summary(o)}.` }),
        h("fieldset", {}, h("legend", { text: "What to do with this file" }), fresh.row, update.row,
          h("div", { class: "field" }, h("label", { for: "pp-source", text: "Which earlier import" }), which),
          likely ? h("p", { class: "note", text: `This file has slides in common with ${best.name}, so it looks like a newer version of it.` }) : h("p", { class: "note", text: "This file has no slides in common with the presentations brought in so far." })),
      ], [go, button("Choose another file", stepChoose)], (update.input.checked ? update.input : fresh.input));
    };

    // ---- step 3a: choose slides to bring in
    const stepImport = async () => {
      const o = opened!;
      const rows = o.deck.slides.map((s, i) => check(`${i + 1}. ${s.name}${s.hidden ? " (hidden in PowerPoint)" : ""}`, !s.hidden));
      const chosen = () => rows.flatMap((r, i) => (r.input.checked ? [i] : []));
      // Speaker notes can become each slide's narration. It is the author's choice: it means narration to make audio for, in the course's voice.
      const withNotes = o.deck.slides.filter((s) => s.hasNotes).length;
      const soundNow = withNotes === 0 ? true : await opts.canMakeAudio();
      const notesBox = check("Use speaker notes as narration", false, [], withNotes === 0 ? "" : `${plural(withNotes, "slide")} in this presentation ${withNotes === 1 ? "has" : "have"} speaker notes. Each slide's notes become the narration of its heading, or of its first text, in the voice the rest of your course uses, and are not shown on the slide. The audio is made when you generate narration.${soundNow ? "" : ` ${silentBeforeText()}`}`);
      const go = button("", async () => {
        const picks = chosen();
        if (picks.length === 0) return;
        busy = true;
        try {
          const prepared = model.prepareDeckImport(o.deck, o.pkg, o.name, picks, undefined, o.tones, { notesAsNarration: withNotes > 0 && notesBox.input.checked });
          await saveAll(prepared);
          const message = model.commitDeckImport(prepared);
          const narrated = prepared.slides.reduce((n, s) => n + [s.baseLayer, ...s.layers].reduce((m, l) => m + l.objects.filter((x) => (x as { narration?: unknown }).narration).length, 0), 0);
          const speech = narrated > 0 ? { count: narrated, canMake: await opts.canMakeAudio() } : undefined;
          opts.announce(speech && !speech.canMake ? `${message} ${silentCourseText(speech.count)}` : message);
          busy = false;
          stepDone(`Brought in ${plural(prepared.slides.length, "slide")}`, message, prepared.report, speech);
        } catch (err) {
          busy = false;
          say("");
          fail(err instanceof Error ? err.message : String(err));
        }
      }, "primary");
      const recount = () => {
        const n = chosen().length;
        go.textContent = n === 0 ? "Bring in slides" : `Bring in ${plural(n, "slide")}`;
        enable(go, n > 0);
        say(n === 0 ? "No slide is chosen." : `${plural(n, "slide")} chosen.`);
      };
      for (const r of rows) r.input.addEventListener("change", recount);
      const all = button("Choose all", () => { rows.forEach((r) => (r.input.checked = true)); recount(); }, "plain", "Choose all the slides");
      const none = button("Choose none", () => { rows.forEach((r) => (r.input.checked = false)); recount(); }, "plain", "Choose none of the slides");
      all.classList.add("small");
      none.classList.add("small");
      show(`Bring slides in from ${o.name}`, [
        h("p", { class: "note", text: `${summary(o)}. Each slide is drawn on the stage at the same size, in the middle if its shape is different. Pictures are saved in the project's images.` }),
        ...(withNotes > 0 ? [h("fieldset", {}, h("legend", { text: "Speaker notes" }), notesBox.row)] : []),
        h("fieldset", {}, h("legend", { text: "Slides to bring in" }), h("div", { class: "btn-row" }, all, none), ...rows.map((r) => r.row)),
      ], [go, ...(model.deckSources.length > 0 ? [button("Back", stepMode)] : [button("Choose another file", stepChoose)])]);
      recount();
      status.textContent = "";
    };

    // ---- step 3b: choose the changes to bring forward
    const stepUpdate = (sourceId: string) => {
      const o = opened!;
      const source = model.deckSources.find((d) => d.id === sourceId)!;
      let plan: ResyncPlan;
      try {
        plan = model.prepareDeckResync(sourceId, o.deck, o.pkg, o.tones)!;
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
        return;
      }
      const items = offered(plan);
      const rows = items.map((item) => ({ item, ...check(item.label, item.checked, item.detail, item.replacesYours ? "This replaces something you changed." : "") }));
      const accepted = () => new Set(rows.filter((r) => r.input.checked).map((r) => r.item.id));
      const go = button("", async () => {
        const picks = accepted();
        busy = true;
        try {
          const assets = assetsFor(plan, picks);
          await saveAll({ assets });
          const message = model.commitDeckResync(plan, picks, o.deck, o.pkg, undefined, o.tones);
          opts.announce(message);
          busy = false;
          const left = items.length - picks.size;
          stepDone("Brought up to date", message, [
            ...(left > 0 ? [`${plural(left, "change")} ${left === 1 ? "was" : "were"} not brought in. ${left === 1 ? "It" : "They"} will be offered again next time.`] : []),
            ...(plan.orderChanged ? ["The presentation has its slides in a different order from your course. The order of your slides was not changed."] : []),
          ]);
        } catch (err) {
          busy = false;
          say("");
          fail(err instanceof Error ? err.message : String(err));
        }
      }, "primary");
      const recount = () => {
        const n = rows.filter((r) => r.input.checked).length;
        go.textContent = n === 0 ? "Bring up to date" : `Bring up to date (${plural(n, "change")})`;
        enable(go, n > 0);
        say(`${plural(n, "change")} chosen.`);
      };
      for (const r of rows) r.input.addEventListener("change", recount);

      // Group the changes: slides of the presentation not in the course, slides the presentation no longer has, and the rest by slide.
      const groups = new Map<string, typeof rows>();
      const put = (name: string, r: (typeof rows)[number]) => groups.set(name, [...(groups.get(name) ?? []), r]);
      for (const r of rows) {
        const op = r.item.action.op;
        put(op === "newSlide" ? "Slides in the presentation that are not in your course" : op === "removeSlide" ? "Slides the presentation no longer has" : `Slide: ${r.item.slide}`, r);
      }
      const all = button("Choose all", () => { rows.forEach((r) => (r.input.checked = true)); recount(); }, "plain", "Choose all the changes");
      const none = button("Choose none", () => { rows.forEach((r) => (r.input.checked = false)); recount(); }, "plain", "Choose none of the changes");
      all.classList.add("small");
      none.classList.add("small");

      const content: Node[] = [h("p", { class: "note", text: `Changes in ${o.name} since ${source.name} was brought in on ${source.importedAt.slice(0, 10)}. Anything you added (rules, narration, timing, layers, new objects) stays as it is.` })];
      if (plan.warning) content.push(h("p", { class: "dialog-error", role: "alert", text: plan.warning }));
      if (plan.orderChanged) content.push(h("p", { class: "note", text: "The presentation has its slides in a different order from your course. The order of your slides is not changed." }));
      if (rows.length === 0) {
        content.push(h("p", { text: "Nothing in the presentation has changed since it was brought in." }), h("p", { class: "note", text: `${plural(plan.unchanged, "object")} ${plan.unchanged === 1 ? "is" : "are"} exactly as the presentation has ${plan.unchanged === 1 ? "it" : "them"}.` }));
        show(`Bring up to date from ${o.name}`, content, [button("Choose another file", stepChoose)]);
        return;
      }
      content.push(h("div", { class: "btn-row" }, all, none));
      for (const [name, list] of groups) content.push(h("fieldset", {}, h("legend", { text: name }), ...list.map((r) => r.row)));
      show(`Bring up to date from ${o.name}`, content, [go, button("Back", model.deckSources.length > 0 ? stepMode : stepChoose)]);
      recount();
    };

    const saveAll = async (what: { assets: { path: string; bytes: Uint8Array }[] }) => {
      let n = 0;
      for (const a of what.assets) {
        n += 1;
        say(`Saving picture ${n} of ${what.assets.length}...`);
        await opts.savePicture(a.path.split("/").pop() ?? a.path, a.bytes);
      }
      say("");
    };

    // ---- the end
    /** The end. When words were brought in to be spoken, it says whether they can be heard yet and goes on to the Narration window, where the voice is installed and the audio made. */
    const stepDone = (heading: string, message: string, lines: string[], speech?: { count: number; canMake: boolean }) => {
      const goOn = speech
        ? button(speech.canMake ? "Make the audio..." : "Set up the narration voice...", () => { toNarration = true; finish(); }, "primary")
        : null;
      show(heading, [
        h("p", { text: message }),
        ...(speech && !speech.canMake ? [h("p", { class: "pp-silent", text: silentCourseText(speech.count) })] : []),
        ...(lines.length > 0
          ? [h("h3", { text: lines.length === 1 ? "One thing to know" : "What to know" }), h("ul", { class: "pp-report" }, ...lines.map((l) => h("li", { text: l })))]
          : []),
      ], goOn ? [goOn] : []);
    };

    document.body.appendChild(dialog);
    dialog.showModal();
    stepChoose();
  });
}

export type { PlanItem, PreparedImport };
