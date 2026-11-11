// The Keyboard keys window (Help > Keyboard keys, Ctrl+/, or the Keys button under the slide): every key the editor has, in tables
// by where they work. A native <dialog>, so Tab stays inside and Escape closes it; focus goes back to where it came from.

import { keyGroupsFirst } from "./keys.ts";
import { el } from "./menubar.ts";

export interface KeysOptions {
  announce: (message: string) => void;
  /** Which group of keys comes first ("canvas" from the Keys button under the slide). */
  first?: string;
}

export function openKeys(opts: KeysOptions): Promise<void> {
  const doc = document;
  return new Promise((resolve) => {
    const from = doc.activeElement as HTMLElement | null;
    const dialog = el(doc, "dialog", { class: "dialog wide keys-dialog", "aria-labelledby": "ky-title" });
    const title = el(doc, "h2", { id: "ky-title", text: "Keyboard keys", tabindex: "-1" });
    const close = el(doc, "button", { type: "button", id: "ky-close", text: "Close" });
    const sections = keyGroupsFirst(opts.first).map((g) =>
      el(doc, "section", { class: "keys-group", "aria-labelledby": `ky-${g.id}` },
        el(doc, "h3", { id: `ky-${g.id}`, text: g.title }),
        el(doc, "table", { class: "keys-table", "aria-labelledby": `ky-${g.id}` },
          el(doc, "thead", {}, el(doc, "tr", {}, el(doc, "th", { scope: "col", text: "Keys" }), el(doc, "th", { scope: "col", text: "What they do" }))),
          el(doc, "tbody", {}, ...g.rows.map((r) => el(doc, "tr", {}, el(doc, "th", { scope: "row", text: r.keys }), el(doc, "td", { text: r.does })))))));
    dialog.append(
      title,
      el(doc, "p", { class: "note", text: "Every key the editor has. The menus show each command's keys beside it, and Ctrl+K finds a command by its name." }),
      ...sections,
      el(doc, "div", { class: "dialog-actions" }, close));

    const finish = () => {
      dialog.close();
      dialog.remove();
      if (from && from !== doc.body && from.isConnected) from.focus();
      opts.announce("Keyboard keys closed.");
      resolve();
    };
    close.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish();
    });
    doc.body.append(dialog);
    dialog.showModal();
    // On the title, so a screen reader starts at the top and the arrow keys scroll the list.
    title.focus();
  });
}
