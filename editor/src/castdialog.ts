// The cast dialog: a place to describe the people a course can show and give a voice to. Each has a name, a few words on who they are, a voice,
// and a picture with a description. Like the other dialogs it is a native <dialog>, so focus moves in, Tab stays inside, and Escape closes it.
// Every control is a real labelled control, and nothing is changed in the project until Save the cast, and then in one undo step.

import type { Character, CharacterPose, CreditEntry } from "../../player/src/types.ts";
import { cloneCast, draftNotes, draftProblems, newPerson, personId, poseKey, CAST_LIMIT } from "./characters.ts";
import { isKnownVoice, VOICES, voiceGroups } from "./narration.ts";
import { chosenMessage, isPlaceholderName, voiceFor, type VoiceHint } from "./packs.ts";

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

/** A person chosen from a character pack, with their picture already copied into the project. */
export interface LibraryPick {
  /** The picture's place in the project. */
  src: string;
  /** What the person looks like, as the pack says: it comes with the picture as its alt text. */
  alt: string;
  name: string;
  role: string;
  /** The kind of voice the pack suggests. */
  voice: VoiceHint;
  /** The record for assets.json that credits the pack's maker. */
  credit: CreditEntry;
  /** Which pack and which person of it, so more poses of them can be offered. */
  library: { pack: string; person: string };
}

/** Poses of a person, chosen from their pack, with the pictures already copied into the project. */
export interface PoseAdds {
  poses: CharacterPose[];
  /** The records for assets.json that credit the pack's maker, one for each picture. */
  credits: CreditEntry[];
}

export interface CastDialogOptions {
  /** The cast the project has now. */
  current: Character[];
  /** Where each person is used, so one that is in use cannot be taken out. */
  uses: Map<string, string[]>;
  /** Where each pose of each person is used (see poseUse in characters.ts), so a pose that is in use cannot be taken out. */
  poseUses: Map<string, string[]>;
  /** Ask for a picture: it is copied into the project and its path comes back. Null if the author cancelled. */
  choosePicture(): Promise<string | null>;
  /** Show the library of people (see packdialog.ts), copy the picture of the one chosen into the project, and give what the pack says about them. Null if the author closed it without choosing. */
  chooseFromLibrary(): Promise<LibraryPick | null>;
  /** Show the poses of the person's pack (see posedialog.ts), copy the ones chosen into the project, and give them. Null if there is nothing to add, or the author cancelled. */
  choosePoses(person: Character): Promise<PoseAdds | null>;
  /** An address the page can show a project picture from. */
  imageUrl(src: string): Promise<string>;
  /** Delete a picture this dialog copied into the project and then did not keep (one that was replaced, or the dialog was cancelled). */
  discardPicture(src: string): Promise<void>;
  /** Said to a screen reader, as the editor's other messages are. */
  announce(message: string): void;
}

/** What the dialog gives back when the cast is saved: the cast, and the credit records of the library pictures it uses. */
export interface CastResult {
  cast: Character[];
  credits: CreditEntry[];
}

/** Show the dialog. Resolves to the cast to apply, or null if it was cancelled. */
export function editCast(opts: CastDialogOptions): Promise<CastResult | null> {
  return new Promise((resolve) => {
    let draft = cloneCast(opts.current);
    /** The credit for each picture that came from the library, by the picture's place. Only the ones still in use when the cast is saved are kept. */
    const credits = new Map<string, CreditEntry>();
    /** The pictures this dialog has copied into the project. Choosing is a copy at once, so one that is replaced or not saved is deleted again when the dialog closes. */
    const added = new Set<string>();

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
      const fromLibrary = h("button", { type: "button", id: `${k}-library`, text: "Choose from the library..." });
      fromLibrary.addEventListener("click", () => void library(p, i));
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
        const change = h("button", { type: "button", text: "Choose a different picture from my computer..." });
        change.addEventListener("click", () => void choose(p, i));
        const remove = h("button", { type: "button", text: "Remove picture" });
        remove.addEventListener("click", () => { p.picture = null; draw(`${k}-library`); opts.announce("Picture removed from the draft."); });
        picture.append(
          h("div", { class: "cd-pic-row" }, img, h("p", { class: "note", text: `Picture: ${pic.src.split("/").pop() ?? pic.src}${credits.has(pic.src) ? " (from the library)" : ""}` })),
          h("div", { class: "field" }, label("Alt text (what the person looks like)", `${k}-alt`), alt),
          h("div", { class: "field check" }, deco, label("The picture is decorative (a screen reader skips it)", `${k}-deco`)),
          h("p", { class: "note", text: "A person's name is always written beside their picture, so in a scenario the picture says nothing to a screen reader. Where a learner chooses who to be, the alt text is read once, so write what the person looks like." }),
          h("div", { class: "btn-row" }, fromLibrary, change, remove),
        );
      } else {
        const choosePic = h("button", { type: "button", id: `${k}-picture`, text: "Choose a picture from my computer..." });
        choosePic.addEventListener("click", () => void choose(p, i));
        picture.append(h("p", { class: "note", text: "No picture. A person without one is shown by name only. Choose someone from the library, which comes with a description of them, or a picture from your computer." }), h("div", { class: "btn-row" }, fromLibrary, choosePic));
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
      // Poses: more pictures of a person from the library, to show beside a line of a scenario.
      const posesBox = h("div", { class: "cd-poses" });
      if (p.library) {
        const have = p.poses ?? [];
        posesBox.append(h("p", { class: "note", text: have.length === 0 ? `No poses yet. A pose is another picture of ${p.name || "this person"}, to show beside a line of a scenario instead of their face.` : `${have.length} ${have.length === 1 ? "pose" : "poses"}, to choose for a line of a scenario in its Pose box:` }));
        if (have.length > 0) {
          posesBox.append(h("ul", { class: "cd-pose-list" }, ...have.map((pose) => {
            const drop = h("button", { type: "button", text: "Remove", "aria-label": `Remove the pose ${pose.label} from ${p.name || `person ${i + 1}`}` });
            drop.addEventListener("click", () => {
              const where = opts.poseUses.get(poseKey(p.id, pose.id));
              if (where && where.length > 0) {
                const why = `The pose ${pose.label} is used by ${where.join(" and ")}. Change those lines first, then take the pose out.`;
                problems.replaceChildren(h("p", { text: why }));
                opts.announce(why);
                return;
              }
              problems.replaceChildren();
              p.poses = (p.poses ?? []).filter((x) => x.id !== pose.id);
              draw(`${k}-poses`);
              opts.announce(`Removed the pose ${pose.label} from the draft.`);
            });
            return h("li", {}, `${pose.label} `, drop);
          })));
        }
        const addPoses = h("button", { type: "button", id: `${k}-poses`, text: "Add poses from the library..." });
        addPoses.addEventListener("click", () => void poses(p, i));
        posesBox.append(h("div", { class: "btn-row" }, addPoses));
      } else {
        posesBox.append(h("p", { class: "note", text: "Poses come with people from the library. Choose this person from the library to add some." }));
      }

      return h("fieldset", { class: "cd-person" }, legend,
        h("div", { class: "field" }, label("Name", `${k}-name`), name),
        h("div", { class: "field" }, label("Who they are (optional)", `${k}-role`), role),
        h("div", { class: "field" }, label("Voice", `${k}-voice`), voice),
        h("p", { class: "note", text: "Their lines in a scenario are read in this voice." }),
        h("fieldset", {}, h("legend", { text: "Picture" }), picture),
        h("fieldset", {}, h("legend", { text: "Poses" }), posesBox),
        h("div", { class: "btn-row" }, earlier, later, remove));
    };

    const legendText = (p: Character, i: number) => `Person ${i + 1} of ${draft.length}${p.name.trim() ? `: ${p.name.trim()}` : ""}`;

    const choose = async (p: Character, i: number): Promise<void> => {
      try {
        const src = await opts.choosePicture();
        if (!src) return;
        added.add(src);
        p.picture = { src, alt: "", decorative: false };
        draw(`cd-${i}-alt`);
        opts.announce("Picture added to the draft. Say what the person looks like in the alt text, or mark the picture decorative.");
      } catch (err) {
        opts.announce(`Could not use that picture. ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    const library = async (p: Character, i: number): Promise<void> => {
      try {
        const pick = await opts.chooseFromLibrary();
        if (!pick) { document.getElementById(`cd-${i}-library`)?.focus(); return; }
        const named = isPlaceholderName(p.name);
        // Someone the author has not named yet is a new person, so the pack can say who they are and what they sound like. Someone already named keeps their name and voice.
        const voiced = named ? voiceFor(pick.voice, draft, p.voice, VOICES) : p.voice;
        added.add(pick.src);
        p.picture = { src: pick.src, alt: pick.alt, decorative: false };
        credits.set(pick.src, pick.credit);
        // Poses belong to the person they came with: someone else from the library brings none of the old person's.
        if (p.library?.pack !== pick.library.pack || p.library?.person !== pick.library.person) delete p.poses;
        p.library = { ...pick.library };
        if (named) p.name = pick.name;
        if (named && !p.role.trim()) p.role = pick.role;
        // A person who is new in this dialog has nothing pointing at them yet, so their id can say who they are.
        if (named && !opts.current.some((c) => c.id === p.id)) p.id = personId(p.name, draft.filter((q) => q !== p).map((q) => q.id));
        const voiceChanged = voiced !== p.voice;
        p.voice = voiced;
        draw(`cd-${i}-alt`);
        opts.announce(chosenMessage(pick.name, { name: named, voice: voiceChanged }));
      } catch (err) {
        opts.announce(`Could not use that person. ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    const poses = async (p: Character, i: number): Promise<void> => {
      try {
        const got = await opts.choosePoses(p);
        if (!got || got.poses.length === 0) { document.getElementById(`cd-${i}-poses`)?.focus(); return; }
        p.poses = [...(p.poses ?? []), ...got.poses];
        for (const pose of got.poses) added.add(pose.src);
        for (const c of got.credits) credits.set(c.path, c);
        draw(`cd-${i}-poses`);
        opts.announce(`Added ${got.poses.length} ${got.poses.length === 1 ? "pose" : "poses"} for ${p.name || "this person"} to the draft: ${got.poses.map((x) => x.label).join(", ")}.`);
      } catch (err) {
        opts.announce(`Could not add the poses. ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    add.id = "cd-add";
    add.addEventListener("click", () => {
      draft.push(newPerson(draft));
      draw(`cd-${draft.length - 1}-name`);
      (document.getElementById(`cd-${draft.length - 1}-name`) as HTMLInputElement | null)?.select();
      opts.announce(`Added person ${draft.length}. Give them a name and choose their voice, or choose someone from the library.`);
    });

    form.append(title, intro, list, h("div", { class: "btn-row" }, add), notes, problems, h("div", { class: "dialog-actions" }, save, cancel));
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    draw();

    let result: CastResult | null = null;
    const finish = () => {
      dialog.close();
      dialog.remove();
      const kept = new Set((result?.cast ?? []).flatMap((p) => [p.picture?.src, ...(p.poses ?? []).map((x) => x.src)]));
      for (const src of added) if (!kept.has(src)) void opts.discardPicture(src).catch(() => undefined);
      resolve(result);
    };
    cancel.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const found = draftProblems(draft, opts.current, opts.uses, opts.poseUses);
      if (found.length > 0) {
        problems.replaceChildren(h("p", { text: "The cast cannot be saved yet:" }), h("ul", {}, ...found.map((p) => h("li", { text: p }))));
        return;
      }
      problems.replaceChildren();
      const cast = cloneCast(draft);
      result = { cast, credits: [...credits.values()].filter((c) => cast.some((p) => p.picture?.src === c.path || (p.poses ?? []).some((x) => x.src === c.path))) };
      finish();
    });

    dialog.showModal();
    (document.getElementById(draft.length > 0 ? "cd-0-name" : "cd-add") as HTMLElement | null)?.focus();
  });
}
