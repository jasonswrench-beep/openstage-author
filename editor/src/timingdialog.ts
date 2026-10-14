// The Timing dialog: every object on the slide being edited with when it appears and disappears, in a table that can be
// edited from the keyboard and read by a screen reader, and a row for whether the slide moves on by itself. It is the
// whole slide's timing in one place, which a long slide needs, because the Properties panel shows one object at a time.
// A native <dialog>, so focus moves in, Tab stays inside, Escape closes it and focus returns to where it came from.

import type { Timing } from "../../player/src/types.ts";
import type { Model } from "./model.ts";
import { describeTiming, parseSeconds, secondsText } from "./timing.ts";

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

export interface TimingDialogOptions {
  model: Model;
  announce: (message: string) => void;
}

export function openTiming(opts: TimingDialogOptions): Promise<void> {
  const { model } = opts;
  return new Promise((resolve) => {
    const slide = model.slide;
    const dialog = h("dialog", { class: "dialog wide timing-dialog", "aria-labelledby": "tm-title" });
    const status = h("p", { class: "as-status", role: "status" });
    const say = (text: string) => { status.textContent = text; };

    // ---- the slide itself
    const advance = h("input", { id: "tm-advance", type: "number", min: "0", step: "any" });
    advance.value = slide?.duration == null ? "" : secondsText(slide.duration);
    advance.addEventListener("change", () => {
      const ms = parseSeconds(advance.value);
      if (ms === undefined) { say("Write the time in seconds, for example 8 or 2.5, up to 3600."); advance.value = slide?.duration == null ? "" : secondsText(slide.duration); return; }
      const r = model.setSlideDuration(ms === 0 ? null : ms);
      say(r.message);
      if (!r.ok) advance.value = slide?.duration == null ? "" : secondsText(slide.duration);
    });

    // ---- one row for each object
    const rows = model.timingRows();
    const body = h("tbody");
    for (const row of rows) {
      const o = row.object;
      const name = row.onBase ? o.name : `${o.name} (layer ${row.layerName})`;
      const t = (): Timing => o.timing;
      const clips = model.mediaSources().filter((c) => c.id !== o.id);
      const appear = h("select", { "aria-label": `${name}: when it appears` },
        h("option", { value: "time", text: row.onBase ? "After the slide opens" : "After its layer is shown" }),
        h("option", { value: "narration", text: "After its narration starts", ...(o.narration ? {} : { disabled: true }) }),
        h("option", { value: "media", text: "When a video or audio clip reaches a time", ...(clips.length > 0 || o.timing.appear === "media" ? {} : { disabled: true }) }));
      // Which clip it follows: shown only for an object that follows one.
      const clip = h("select", { "aria-label": `${name}: which video or audio clip it follows` },
        ...clips.map((c) => h("option", { value: c.id, text: `${c.name} (${c.type})` })));
      const start = h("input", { type: "number", min: "0", step: "any", "aria-label": `${name}: seconds after it starts counting` });
      const leave = h("input", { type: "number", min: "0", step: "any", "aria-label": `${name}: stays for this many seconds, blank to stay` });
      const summary = h("td", { class: "tm-summary" });
      const fill = () => {
        appear.value = t().appear;
        clip.hidden = t().appear !== "media";
        if (t().media) clip.value = t().media!;
        start.value = secondsText(t().start);
        leave.value = t().visibleFor === null ? "" : secondsText(t().visibleFor!);
        summary.textContent = describeTiming(t(), !row.onBase, model.mediaNameOf(t().media));
      };
      const change = (patch: Partial<Timing>) => {
        const r = model.setTiming(o.id, patch);
        if (r.message) say(r.message);
        fill();
      };
      appear.addEventListener("change", () => change({ appear: appear.value as Timing["appear"] }));
      clip.addEventListener("change", () => change({ media: clip.value }));
      start.addEventListener("change", () => {
        const ms = parseSeconds(start.value);
        if (ms === undefined) { say("Write the time in seconds, for example 2 or 0.5, up to 3600."); fill(); return; }
        change({ start: ms ?? 0 });
      });
      leave.addEventListener("change", () => {
        const ms = parseSeconds(leave.value);
        if (ms === undefined || ms === 0) { say("Write how long it stays in seconds, for example 6, or leave it blank to stay until the slide ends."); fill(); return; }
        change({ visibleFor: ms });
      });
      fill();
      body.append(h("tr", {},
        h("th", { scope: "row", text: name }),
        h("td", {}, appear, clip), h("td", {}, start), h("td", {}, leave), summary));
    }

    const table = h("table", { class: "tm-table" },
      h("caption", { text: "Timing of each object on this slide" }),
      h("thead", {}, h("tr", {},
        h("th", { scope: "col", text: "Object" }), h("th", { scope: "col", text: "Appears" }), h("th", { scope: "col", text: "Seconds" }),
        h("th", { scope: "col", text: "Stays for (seconds)" }), h("th", { scope: "col", text: "In words" }))),
      body);

    const close = h("button", { type: "button", text: "Close" });
    const finish = () => { dialog.close(); dialog.remove(); opts.announce("Timing closed."); resolve(); };
    close.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });

    dialog.append(
      h("h2", { id: "tm-title", text: `Timing: ${slide?.name ?? "this slide"}` }),
      h("p", { class: "note", text: "Everything starts as always there. Set a time to make an object appear later, when its narration starts, or at a moment in a video or audio clip, and to make it go again. Times count from when the slide opens, from when a layer is shown, or into the clip. Learners can pause the timing and can show everything at once, so no one is left behind." }),
      h("div", { class: "field" }, h("label", { for: "tm-advance", text: "This slide moves on by itself after this many seconds (blank, or 0, waits for the learner)" }), advance),
      h("p", { class: "note", text: "A slide that moves on by itself takes time away from slow readers. Use it only where it helps, and not on a slide with a question." }),
      // A table of this many columns is data that needs both directions: it scrolls inside the dialog, and the dialog does not.
      rows.length === 0 ? h("p", { class: "note", text: "This slide has no objects yet." }) : h("div", { class: "tm-scroll" }, table),
      status,
      h("div", { class: "dialog-actions" }, close),
    );
    document.body.appendChild(dialog);
    dialog.showModal();
    (rows.length > 0 ? advance : close).focus();
  });
}
