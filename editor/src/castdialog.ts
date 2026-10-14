// The cast dialog: a place to describe the people a course can show and give a voice to. Each has a name, a few words on who they are, a voice,
// and a picture with a description. Like the other dialogs it is a native <dialog>, so focus moves in, Tab stays inside, and Escape closes it.
// Every control is a real labelled control, and nothing is changed in the project until Save the cast, and then in one undo step.

import type { Character } from "../../player/src/types.ts";
import { cloneCast, draftNotes, draftProblems, newPerson, CAST_LIMIT } from "./characters.ts";
import { isKnownVoice, voiceGroups } from "./narration.ts";

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

export interface CastDialogOptions {
  /** The cast the project has now. */
  current: Character[];
  /** Where each person is used, so one that is in use cannot be taken out. */
  uses: Map<string, string[]>;
  /** Ask for a picture: it is copied into the project and its path comes back. Null if the author cancelled. */
  choosePicture(): Promise<string | null>;
  /**
   * Draw a picture of the person (see avatardialog.ts) and save it in the project. Its path comes back with a description in words,
   * which is offered as a start for the alt text and never put in. Null if the author cancelled.
   */
  makePicture(name: string): Promise<{ src: string; description: string } | null>;
  /** An address the page can show a project picture from. */
  imageUrl(src: string): Promise<string>;
  /** Said to a screen reader, as the editor's other messages are. */
  announce(message: string): void;
}

/** Show the dialog. Resolves to the cast to apply, or null if it was cancelled. */
export function editCast(opts: CastDialogOptions): Promise<Character[] | null> {
  return new Promise((resolve) => {
    let draft = cloneCast(opts.current);
    /** What the picture maker said each new picture looks like, to offer as alt text. It is only used if the author presses the button. */
    const suggestions = new Map<Character, string>();

    const dialog = h("dialog", { class: "dialog wide cast-dialog", "aria-labelledby": "cd-title" });
    const form = h("form", { method: "dialog" });
    const title = h("h2", { id: "cd-title", text: "The cast" });
    const intro = h("p", { class: "note", text: "The people your course can show and give a voice to. A scenario shows who is speaking and reads each person's lines in their voice, and a Choose a character input lets the learner be one of them. Nothing is changed until you choose Save the cast, and then you can undo it with Ctrl+Z." });
    const list = h("div", { class: "cd-list" });
    const notes = h("div", { class: "note cd-notes", role: "status", "aria-live": "polite" });
    const problems = h("div", { class: "te-problems", role: "alert" });
    const add = h("button", { type: "button", text: "Add a person" });
    const save = h("button", { type: "submit", text: "Save the cast" });
    const cancel = h("button", { type: "button", text: "Cancel" });

    const showNotes = () => {
      const found = draftNotes(draft);
      notes.textContent = found.join(" ");
    };

    /** Redraw the list, then put focus on a control (by id) so the author is not left at the top of the dialog. */
    const draw = (focusId?: string) => {
      list.replaceChildren(...draft.map((p, i) => card(p, i)));
      add.disabled = draft.length >= CAST_LIMIT;
      showNotes();
      if (focusId) document.getElementById(focusId)?.focus();
    };

    const card = (p: Character, i: number): HTMLElement => {
      const k = `cd-${i}`;
      const label = (text: string, forId: string) => h("label", { for: forId, text });
      const name = h("input", { id: `${k}-name`, type: "text", value: p.name });
      name.addEventListener("input", () => { p.name = name.value; legend.textContent = legendText(p, i); showNotes(); });
      const role = h("input", { id: `${k}-role`, type: "text", value: p.role });
      role.addEventListener("input", () => { p.role = role.value; });
      const voice = h("select", { id: `${k}-voice` },
        ...(isKnownVoice(p.voice) ? [] : [h("option", { value: p.voice, text: `${p.voice} (not an available voice)` })]),
        ...voiceGroups().map((g) => h("optgroup", { label: g.group }, ...g.voices.map((v) => h("option", { value: v.id, text: v.label })))));
      voice.value = p.voice;
      voice.addEventListener("change", () => { p.voice = voice.value; });

      const picture = h("div", { class: "cd-picture" });
      if (p.picture) {
        const pic = p.picture;
        const img = h("img", { class: "cd-pic", alt: "", "aria-hidden": "true" });
        void opts.imageUrl(pic.src).then((u) => { img.src = u; }).catch(() => img.remove());
        const alt = h("input", { id: `${k}-alt`, type: "text", value: pic.alt, ...(pic.decorative ? { disabled: true } : {}) });
        alt.addEventListener("input", () => { pic.alt = alt.value; });
        const deco = h("input", { id: `${k}-deco`, type: "checkbox", ...(pic.decorative ? { checked: true } : {}) });
        deco.addEventListener("change", () => {
          // A decorative picture has no alt text, so the field is cleared and switched off, and comes back empty if the box is unticked.
          pic.decorative = deco.checked;
          if (deco.checked) pic.alt = "";
          alt.disabled = deco.checked;
          if (deco.checked) alt.value = "";
          opts.announce(deco.checked ? `${p.name || "This person"}'s picture is decorative: it has no alt text.` : "The picture needs alt text again. Say what the person looks like.");
        });
        const change = h("button", { type: "button", text: "Choose a different picture..." });
        change.addEventListener("click", () => void choose(p, i));
        const remake = h("button", { type: "button", text: "Make a different picture..." });
        remake.addEventListener("click", () => void make(p, i));
        const suggestion = suggestions.get(p);
        const useSuggestion = suggestion && !pic.decorative && pic.alt.trim() === ""
          ? h("div", { class: "btn-row" }, h("p", { class: "note", text: `The picture maker describes it as: "${suggestion}".` }),
            (() => {
              const b = h("button", { type: "button", text: "Use that as the alt text" });
              b.addEventListener("click", () => { pic.alt = suggestion; suggestions.delete(p); draw(`${k}-alt`); opts.announce("Alt text filled in from the picture maker's description. Change it if it is not right."); });
              return b;
            })())
          : null;
        const remove = h("button", { type: "button", text: "Remove picture" });
        remove.addEventListener("click", () => { p.picture = null; draw(`${k}-picture`); opts.announce("Picture removed from the draft."); });
        picture.append(
          h("div", { class: "cd-pic-row" }, img, h("p", { class: "note", text: `Picture: ${pic.src.split("/").pop() ?? pic.src}` })),
          h("div", { class: "field" }, label("Alt text (what the person looks like)", `${k}-alt`), alt),
          ...(useSuggestion ? [useSuggestion] : []),
          h("div", { class: "field check" }, deco, label("The picture is decorative (a screen reader skips it)", `${k}-deco`)),
          h("p", { class: "note", text: "A person's name is always written beside their picture, so in a scenario the picture says nothing to a screen reader. Where a learner chooses who to be, the alt text is read once, so write what the person looks like." }),
          h("div", { class: "btn-row" }, change, remake, remove),
        );
      } else {
        const choosePic = h("button", { type: "button", id: `${k}-picture`, text: "Choose a picture..." });
        choosePic.addEventListener("click", () => void choose(p, i));
        const makePic = h("button", { type: "button", text: "Make a picture..." });
        makePic.addEventListener("click", () => void make(p, i));
        picture.append(h("p", { class: "note", text: "No picture. A person without one is shown by name only. Choose a picture from your computer, or make a simple one here." }), h("div", { class: "btn-row" }, choosePic, makePic));
      }

      const earlier = h("button", { type: "button", text: "Move earlier", "aria-label": `Move earlier: ${p.name || `person ${i + 1}`}`, ...(i === 0 ? { disabled: true } : {}) });
      earlier.addEventListener("click", () => { [draft[i - 1], draft[i]] = [draft[i]!, draft[i - 1]!]; draw(`cd-${i - 1}-name`); opts.announce(`Moved to place ${i} of ${draft.length}.`); });
      const later = h("button", { type: "button", text: "Move later", "aria-label": `Move later: ${p.name || `person ${i + 1}`}`, ...(i === draft.length - 1 ? { disabled: true } : {}) });
      later.addEventListener("click", () => { [draft[i], draft[i + 1]] = [draft[i + 1]!, draft[i]!]; draw(`cd-${i + 1}-name`); opts.announce(`Moved to place ${i + 2} of ${draft.length}.`); });
      const remove = h("button", { type: "button", text: "Remove from the cast", "aria-label": `Remove from the cast: ${p.name || `person ${i + 1}`}` });
      remove.addEventListener("click", () => {
        const where = opts.uses.get(p.id);
        if (where && where.length > 0) {
          opts.announce(`${p.name || "This person"} is used by ${where.join(" and ")}. Change those first, then remove them.`);
          problems.replaceChildren(h("p", { text: `${p.name || "This person"} is used by ${where.join(" and ")}. Change those first, then remove them.` }));
          return;
        }
        draft.splice(i, 1);
        problems.replaceChildren();
        draw(draft.length === 0 ? "cd-add" : `cd-${Math.min(i, draft.length - 1)}-name`);
        opts.announce(`Removed ${p.name || "the person"} from the draft.`);
      });

      const legend = h("legend", { text: legendText(p, i) });
      return h("fieldset", { class: "cd-person" }, legend,
        h("div", { class: "field" }, label("Name", `${k}-name`), name),
        h("div", { class: "field" }, label("Who they are (optional)", `${k}-role`), role),
        h("div", { class: "field" }, label("Voice", `${k}-voice`), voice),
        h("p", { class: "note", text: "Their lines in a scenario are read in this voice." }),
        h("fieldset", {}, h("legend", { text: "Picture" }), picture),
        h("div", { class: "btn-row" }, earlier, later, remove));
    };

    const legendText = (p: Character, i: number) => `Person ${i + 1} of ${draft.length}${p.name.trim() ? `: ${p.name.trim()}` : ""}`;

    const choose = async (p: Character, i: number): Promise<void> => {
      try {
        const src = await opts.choosePicture();
        if (!src) return;
        p.picture = { src, alt: "", decorative: false };
        draw(`cd-${i}-alt`);
        opts.announce("Picture added to the draft. Say what the person looks like in the alt text, or mark the picture decorative.");
      } catch (err) {
        opts.announce(`Could not use that picture. ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    const make = async (p: Character, i: number): Promise<void> => {
      try {
        const made = await opts.makePicture(p.name.trim());
        if (!made) { document.getElementById(`cd-${i}-picture`)?.focus(); return; }
        p.picture = { src: made.src, alt: "", decorative: false };
        suggestions.set(p, made.description);
        draw(`cd-${i}-alt`);
        opts.announce(`Picture added to the draft. Say what the person looks like in the alt text, or mark the picture decorative. The picture maker describes it as: ${made.description}. There is a button to use that as a start.`);
      } catch (err) {
        opts.announce(`Could not make the picture. ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    add.id = "cd-add";
    add.addEventListener("click", () => {
      draft.push(newPerson(draft));
      draw(`cd-${draft.length - 1}-name`);
      (document.getElementById(`cd-${draft.length - 1}-name`) as HTMLInputElement | null)?.select();
      opts.announce(`Added person ${draft.length}. Give them a name and choose their voice.`);
    });

    form.append(title, intro, list, h("div", { class: "btn-row" }, add), notes, problems, h("div", { class: "dialog-actions" }, save, cancel));
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    draw();

    let result: Character[] | null = null;
    const finish = () => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    cancel.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const found = draftProblems(draft, opts.current, opts.uses);
      if (found.length > 0) {
        problems.replaceChildren(h("p", { text: "The cast cannot be saved yet:" }), h("ul", {}, ...found.map((p) => h("li", { text: p }))));
        return;
      }
      problems.replaceChildren();
      result = cloneCast(draft);
      finish();
    });

    dialog.showModal();
    (document.getElementById(draft.length > 0 ? "cd-0-name" : "cd-add") as HTMLElement | null)?.focus();
  });
}
