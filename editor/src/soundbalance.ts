// The two boxes that balance the voice and the computer's own sound against each other for the whole edit of a recording.
//
// Each box shows the volume that every clip of that sound has (blank when they differ, with a sentence that says so) and sets every clip of that sound when
// a number is entered: a whole number of decibels from -40 to 20, as one undo step. A sound that was not recorded has no box. Plain DOM, kept apart from the
// dialog so that it can be tried in a page of its own. The sentences are the edit session's (capture-timeline/src/session.ts); this only shows them.

import type { BalanceSound, EditSession } from "../../capture-timeline/src/session.ts";

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

export interface SoundBalance {
  readonly element: HTMLElement;
  /** Bring the boxes up to date with the edit (after it changes). A box the author is typing in is left as it is. */
  refresh(): void;
}

export function mountSoundBalance(live: EditSession, announce: (message: string) => void): SoundBalance {
  const note = h("p", {
    class: "note",
    id: "re-balance-note",
    text: "Sets every clip of your voice, or of the computer's own sound, to the same volume: a whole number of decibels from -40 to 20. 0 is as recorded, a negative number is quieter, and about 6 decibels is double or half the volume. One clip's volume is set in its own form in the clip list. Press Enter or leave the box to apply it. It can be undone.",
  });
  const part = (sound: BalanceSound, id: string, label: string) => {
    const input = h("input", { type: "text", id, inputmode: "numeric", autocomplete: "off", spellcheck: "false", size: "6", "aria-describedby": `${id}-now re-balance-note` });
    const now = h("span", { id: `${id}-now`, class: "note" });
    const row = h("div", { class: "field" }, h("label", { for: id, text: label }), h("div", {}, input, " ", now));
    return { sound, input, now, row };
  };
  const parts = [part("microphone", "re-balance-mic", "Your voice, in decibels"), part("system-audio", "re-balance-system", "The computer's sound, in decibels")];
  const element = h("fieldset", { id: "re-balance", hidden: true }, h("legend", { text: "Sound balance" }), ...parts.map((p) => p.row), note);

  /** What each box showed last: text that is still that was not typed by the author. */
  const shown = new Map<HTMLInputElement, string>();

  function refresh(): void {
    let any = false;
    for (const { sound, input, now, row } of parts) {
      const volume = live.soundBalance(sound);
      row.hidden = volume === undefined;
      if (volume !== undefined) any = true;
      const text = volume === undefined || volume === "mixed" ? "" : String(volume);
      shown.set(input, text);
      now.textContent = volume === "mixed" ? "The clips are at different volumes. Type a number to make them all the same." : "";
      // What the author is typing is not taken from them.
      if (document.activeElement !== input) {
        input.value = text;
        input.removeAttribute("aria-invalid");
      }
    }
    element.hidden = !any;
  }

  function commit(sound: BalanceSound, input: HTMLInputElement): void {
    if (input.value === (shown.get(input) ?? "")) return;
    const outcome = live.setSoundBalance(sound, input.value);
    announce(outcome.message);
    if (outcome.ok) {
      input.removeAttribute("aria-invalid");
      input.value = shown.get(input) ?? "";
    } else {
      input.setAttribute("aria-invalid", "true");
    }
  }

  for (const { sound, input } of parts) {
    input.addEventListener("change", () => commit(sound, input));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit(sound, input);
      } else if (e.key === "Escape" && input.value !== (shown.get(input) ?? "")) {
        // Put the old number back and keep the dialog open: only when there is something to put back does Escape do this.
        e.preventDefault();
        input.value = shown.get(input) ?? "";
        input.removeAttribute("aria-invalid");
        announce("Put back as it was.");
      }
    });
  }

  refresh();
  return { element, refresh };
}
