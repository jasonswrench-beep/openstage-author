// The Narration dialog: every narrated object in the course, slide by slide in the order they play, with whether its
// audio has been made, and the buttons that make what is missing. The audio is made on this computer by the speech
// engine, so it can take a while and can be cancelled. A native <dialog>, so focus moves in, Tab stays inside, Escape
// closes it (or, while audio is being made, cancels that) and focus returns to where it came from.

import { errorText, type Backend } from "./backend.ts";
import type { Model, NarratedObject } from "./model.ts";
import { audioStatus, excerpt, formatDuration, totals, totalsLine, type CachedAudio } from "./narration.ts";

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

export interface NarrationDialogOptions {
  model: Model;
  backend: Backend;
  /** Whether a speech engine is set up. Without one audio cannot be made, but everything can still be read. */
  engine: boolean;
  /** The audio that has been made, as the editor last knew it. */
  cache: () => ReadonlyMap<string, CachedAudio>;
  /** Look at the disk again, and update what `cache` returns. */
  refresh: () => Promise<void>;
  announce: (message: string) => void;
}

/** What the dialog tells the editor when it closes: an object (or one of its items) to go to, if the author chose one. */
export interface NarrationDialogResult {
  goTo: NarratedObject | null;
}

export function openNarration(opts: NarrationDialogOptions): Promise<NarrationDialogResult> {
  const { model, backend: b } = opts;
  return new Promise((resolve) => {
    let running = false;
    let chosen: NarratedObject | null = null;

    const dialog = h("dialog", { class: "dialog wide narration-dialog", "aria-labelledby": "nr-title" });
    const summary = h("p", { class: "nr-summary" });
    const engineNote = h("p", { class: "note", text: opts.engine ? "Audio is made on this computer by the speech engine, so nothing is sent anywhere." : "No speech engine is set up on this computer, so audio cannot be made here. Transcripts and captions still work. OPEN EDITOR.bat looks for the speech engine in the Audiobook Studio folder; if yours is somewhere else, set OPENSTAGE_KOKORO_PYTHON to the Python that has Kokoro installed." });
    const list = h("div", { class: "nr-list" });
    const status = h("p", { class: "as-status", role: "status" });
    const failure = h("p", { class: "dialog-error", role: "alert" });
    const makeAll = h("button", { type: "button", text: "Make all missing audio" });
    const closeBtn = h("button", { type: "button", text: "Close" });

    const say = (text: string) => { status.textContent = text; };

    const render = () => {
      const items = model.narratedObjects();
      const t = totals(items, opts.cache());
      summary.textContent = totalsLine(t);
      makeAll.textContent = t.missing > 0 ? `Make all missing audio (${t.missing})` : "Make all missing audio";
      const can = opts.engine && t.missing > 0 && !running;
      if (can) makeAll.removeAttribute("aria-disabled"); else makeAll.setAttribute("aria-disabled", "true");
      closeBtn.textContent = running ? "Cancel" : "Close";

      list.replaceChildren();
      let slideId = "";
      let group: HTMLElement | null = null;
      for (const item of items) {
        if (item.slideId !== slideId) {
          slideId = item.slideId;
          list.append(h("h3", { text: item.slideName }));
          group = h("ul", { class: "nr-items", role: "list" });
          list.append(group);
        }
        const s = audioStatus(item.narration, opts.cache());
        const owner = item.item ? `${item.object.name}, item "${item.item.title}"` : item.object.name;
        const name = item.layerName && item.layerId !== model.slides.find((x) => x.id === item.slideId)?.baseLayer.id ? `${owner} (layer ${item.layerName})` : owner;
        const go = h("button", { type: "button", class: "small", text: "Go to", "aria-label": `Go to ${name}` });
        go.addEventListener("click", () => { chosen = item; finish(); });
        const make = h("button", { type: "button", class: "small", text: "Make audio", "aria-label": `Make audio for ${name}` });
        if (s.state === "ready" || !opts.engine || running) make.setAttribute("aria-disabled", "true");
        make.addEventListener("click", () => { if (make.getAttribute("aria-disabled") !== "true") void run([item.key]); });
        group!.append(h("li", { class: "nr-row" },
          h("div", { class: "nr-text" },
            h("strong", { text: name }),
            h("span", { class: "nr-excerpt", text: excerpt(item.narration.script) })),
          h("span", { class: "nr-state", text: s.state === "ready" ? `Audio ready, ${formatDuration(s.duration ?? 0)}` : "Needs audio" }),
          h("div", { class: "nr-buttons" }, go, make)));
      }
      if (items.length === 0) list.append(h("p", { class: "note", text: "Select an object, then write what it should say in the Narration section of the Properties panel." }));
    };

    const run = async (ids: string[]) => {
      if (running) return;
      running = true;
      failure.textContent = "";
      render();
      const count = ids.length > 0 ? ids.length : model.narratedObjects().filter((n) => audioStatus(n.narration, opts.cache()).state === "missing").length;
      say(`Making audio for ${count} ${count === 1 ? "narration" : "narrations"}. This can take a minute or more each, the first time most of all. You can cancel.`);
      try {
        const result = await b.makeNarration(model.dir, model.allFiles(), ids);
        await opts.refresh();
        say("");
        if (result.ok) {
          const t = totals(model.narratedObjects(), opts.cache());
          say(t.missing === 0 ? `Done. ${totalsLine(t)}` : `Finished, but ${t.missing} ${t.missing === 1 ? "narration still has" : "narrations still have"} no audio.`);
        } else {
          failure.textContent = result.cancelled ? "Making audio was cancelled. Anything it had finished is kept." : result.message ?? "The speech engine did not finish.";
        }
      } catch (err) {
        await opts.refresh().catch(() => undefined);
        say("");
        failure.textContent = errorText(err);
      } finally {
        running = false;
        render();
      }
    };

    const finish = () => {
      dialog.close();
      dialog.remove();
      opts.announce("Narration closed.");
      resolve({ goTo: chosen });
    };
    const leave = async () => {
      if (running) {
        say("Cancelling.");
        await b.cancelJob().catch(() => false);
        return;
      }
      finish();
    };

    makeAll.addEventListener("click", () => { if (makeAll.getAttribute("aria-disabled") !== "true") void run([]); });
    closeBtn.addEventListener("click", () => void leave());
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); void leave(); });

    dialog.append(
      h("h2", { id: "nr-title", text: "Narration" }),
      h("p", { class: "note", text: "Narration belongs to an object and plays when its slide opens, in reading order. An item of an interaction, such as a glossary term or a flip card, has its own narration, which plays when the learner opens that item. The captions and the transcript come from the script, so they always match what is said. To change a word, change the script and make its audio again." }),
      summary, engineNote, status, failure, list,
      h("div", { class: "dialog-actions" }, makeAll, closeBtn),
    );
    document.body.appendChild(dialog);
    render();
    dialog.showModal();
    makeAll.focus();
  });
}
