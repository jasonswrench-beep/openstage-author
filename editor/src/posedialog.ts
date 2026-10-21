// Choosing poses of a person from their character pack: a dialog with a check box for every pose the pack has, each with its picture beside its words. Like the other
// dialogs it is a native <dialog>, so focus moves in, Tab stays inside and Escape closes it. A pose the course already has is shown ticked and cannot be unticked here
// (poses are taken out in the cast dialog, where it is checked that no line still uses them). The pictures are decoration: every pose is named in words beside its check box.

import { errorText, type Backend } from "./backend.ts";
import { chosenCount, type Pack, type PackPerson, type PackPose } from "./packs.ts";

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

export interface PoseDialogOptions {
  backend: Pick<Backend, "packPictureUrl">;
  pack: Pack;
  person: PackPerson;
  /** The ids of the poses the person already has in the course. */
  have: ReadonlySet<string>;
  /** Choose one picture, with round buttons, to put on a slide, instead of ticking any number of poses to add to the cast. */
  single?: boolean;
  announce(message: string): void;
}

/** Show the poses. Resolves to the new poses chosen (not the ones the person already has), or null if the dialog was cancelled. */
export function choosePoses(opts: PoseDialogOptions): Promise<PackPose[] | null> {
  const { person } = opts;
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "dialog wide pose-dialog", "aria-labelledby": "po-title" });
    const form = h("form", { method: "dialog" });
    const single = opts.single === true;
    const title = h("h2", { id: "po-title", text: single ? `Choose a picture of ${person.name}` : `Add poses for ${person.name}` });
    const intro = h("p", { class: "note", text: single
      ? `Choose the picture of ${person.name} to put on the slide. The words beside it become the picture's alt text, and you can change them afterwards.`
      : `A pose is another picture of ${person.name}, to show beside a line of a scenario instead of their face: waving, thinking, presenting. Tick the ones you want. Each one you add is copied into your project, so a course that uses only a few stays small. The picture is for the eye; what a line says is in its words.` });
    const status = h("p", { class: "note po-status", role: "status", "aria-live": "polite" });
    const failure = h("p", { class: "dialog-error", role: "alert" });
    const group = h("fieldset", { class: "po-group" }, h("legend", { text: single ? `${person.name}'s pictures` : `${person.name}'s poses` }));
    const list = h("ul", { class: "po-list" });
    const boxes: { pose: PackPose; box: HTMLInputElement }[] = [];

    person.poses.forEach((pose, i) => {
      const had = opts.have.has(pose.id);
      const box = single
        ? h("input", { type: "radio", name: "po-pick", id: `po-${i}`, ...(i === 0 ? { checked: true } : {}) })
        : h("input", { type: "checkbox", id: `po-${i}`, ...(had ? { checked: true, disabled: true } : {}) });
      const img = h("img", { class: "po-pic", alt: "", "aria-hidden": "true" });
      boxes.push({ pose, box });
      list.appendChild(h("li", { class: "po-item" }, h("label", { for: `po-${i}` }, img, h("span", { class: "po-label", text: `${pose.label}${had ? " (in the course already)" : ""}` })), box));
    });
    // The pictures come one after another, so a pack with many poses does not ask for them all at once.
    void (async () => {
      const imgs = [...list.querySelectorAll<HTMLImageElement>(".po-pic")];
      for (let i = 0; i < imgs.length; i++) {
        try {
          imgs[i]!.src = await opts.backend.packPictureUrl(opts.pack.source, opts.pack.folder, person.poses[i]!.file);
        } catch {
          imgs[i]!.remove();
        }
      }
    })();

    const chosen = () => boxes.filter(({ box }) => box.checked && !box.disabled).map(({ pose }) => pose);
    const say = () => { status.textContent = single ? `${chosen()[0]?.label ?? "No picture"} chosen.` : chosenCount(chosen().length, opts.have.size); };
    list.addEventListener("change", say);
    const all = h("button", { type: "button", text: "Tick all" });
    all.addEventListener("click", () => { for (const { box } of boxes) if (!box.disabled) box.checked = true; say(); opts.announce(status.textContent ?? ""); });
    const none = h("button", { type: "button", text: "Untick all" });
    none.addEventListener("click", () => { for (const { box } of boxes) if (!box.disabled) box.checked = false; say(); opts.announce(status.textContent ?? ""); });
    const add = h("button", { type: "submit", text: single ? "Add this picture" : "Add the chosen poses" });
    const cancel = h("button", { type: "button", text: "Cancel" });

    group.append(list);
    form.append(title, intro, ...(single ? [] : [h("div", { class: "btn-row" }, all, none)]), group, status, failure, h("div", { class: "dialog-actions" }, add, cancel));
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    say();

    let result: PackPose[] | null = null;
    const finish = () => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    cancel.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      try {
        const picked = chosen();
        if (picked.length === 0) {
          failure.textContent = "Tick at least one pose, or Cancel.";
          return;
        }
        result = picked;
        finish();
      } catch (err) {
        failure.textContent = errorText(err);
      }
    });
    dialog.showModal();
    (boxes.find(({ box }) => !box.disabled)?.box ?? add).focus();
  });
}
