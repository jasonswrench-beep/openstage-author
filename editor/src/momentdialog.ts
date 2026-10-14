// Choosing the moment by playing: a dialog with the video or audio clip and its own controls, so an author can play to the place, pause, and
// press a button to take that moment as the time an object appears or goes. The clip's own controls are the browser's, so they work from the
// keyboard and are read by a screen reader. Typing the time in seconds is always possible; this is only an easier way to find it.
// Like the other dialogs it is a native <dialog>: focus moves in, Tab stays inside and Escape closes it.

import { clockText } from "./model.ts";
import { plainSeconds } from "./timing.ts";

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

export interface MomentOptions {
  /** What the clip is called. */
  name: string;
  kind: "video" | "audio";
  /** An address the page can play it from. */
  url: string;
  /** What the object has now: where it appears (ms), and where it goes (ms into the clip), or null if it stays. */
  start: number;
  end: number | null;
  announce(message: string): void;
}

export interface MomentChoice {
  start: number;
  /** Milliseconds into the clip, or null to stay until the clip ends. */
  end: number | null;
}

/** Show the dialog. Resolves to the times chosen, or null if it was cancelled. */
export function chooseMoments(opts: MomentOptions): Promise<MomentChoice | null> {
  return new Promise((resolve) => {
    let start = opts.start;
    let end = opts.end;

    const dialog = h("dialog", { class: "dialog wide moment-dialog", "aria-labelledby": "mo-title" });
    const form = h("form", { method: "dialog" });
    const title = h("h2", { id: "mo-title", text: `Choose the moments in ${opts.name}` });
    const intro = h("p", { class: "note", text: "Play the clip with its own controls, pause where you want, and press a button to use that moment. You can play again and press a button again. Nothing changes until you choose Use these times." });
    const media = h(opts.kind, { controls: true, preload: "metadata", "aria-label": opts.name, class: "mo-media" }) as HTMLMediaElement;
    media.src = opts.url;
    const where = h("p", { class: "mo-now", role: "status", "aria-live": "off" });
    const chosen = h("p", { class: "mo-chosen", role: "status", "aria-live": "polite" });
    const problems = h("div", { class: "te-problems", role: "alert" });

    const now = (): number => Math.round(media.currentTime * 1000);
    const show = () => { where.textContent = `The clip is at ${clockText(now())} (${plainSeconds(now())}).`; };
    const summary = () => {
      chosen.textContent = `It appears ${plainSeconds(start)} into the clip, ${end === null ? "and stays until the clip ends." : `and goes ${plainSeconds(end)} into the clip.`}`;
    };
    for (const type of ["timeupdate", "seeked", "pause", "loadedmetadata"]) media.addEventListener(type, show);

    const useStart = h("button", { type: "button", text: "Use this moment as the start" });
    useStart.addEventListener("click", () => {
      start = now();
      // An end before the new start would make the object vanish before it appears.
      if (end !== null && end <= start) end = null;
      problems.replaceChildren();
      summary();
      opts.announce(chosen.textContent ?? "");
    });
    const useEnd = h("button", { type: "button", text: "Use this moment as the end" });
    useEnd.addEventListener("click", () => {
      if (now() <= start) {
        const msg = `The end has to be after the start, which is ${plainSeconds(start)} into the clip. Play on a little, then try again.`;
        problems.replaceChildren(h("p", { text: msg }));
        opts.announce(msg);
        return;
      }
      end = now();
      problems.replaceChildren();
      summary();
      opts.announce(chosen.textContent ?? "");
    });
    const stays = h("button", { type: "button", text: "Stay until the clip ends" });
    stays.addEventListener("click", () => { end = null; problems.replaceChildren(); summary(); opts.announce(chosen.textContent ?? ""); });

    const ok = h("button", { type: "submit", text: "Use these times" });
    const cancel = h("button", { type: "button", text: "Cancel" });

    form.append(title, intro, media, where, h("div", { class: "btn-row" }, useStart, useEnd, stays), chosen, problems, h("div", { class: "dialog-actions" }, ok, cancel));
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    summary();
    where.textContent = "Play the clip, or move to a place with its controls.";

    let result: MomentChoice | null = null;
    const finish = () => {
      media.pause();
      media.removeAttribute("src");
      media.load();
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    cancel.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      result = { start, end };
      finish();
    });
    dialog.showModal();
    media.focus();
  });
}
