// The parts every dialog has in the suite's look (revamp step 6), added as a dialog opens so the thirty-odd dialogs need no change of
// their own: a Close button in the top corner, the last row of buttons kept in sight at the bottom while the rest scrolls, and the
// main button of that row in the Author colour. The rest of the look is in editor.css, under "Dialogs".
//
// The Close button does exactly what Escape does: it asks the dialog to close the way Escape asks (a "cancel" event the dialog can
// answer, as it does for Escape: put away what it was doing, or stop a job first), and closes it if the dialog does not answer. It
// comes last in the dialog, so focus starts where each dialog puts it, and Tab reaches it after the buttons at the bottom.

import { el, uiIcon } from "./menubar.ts";

/** Words that leave a dialog rather than do what it is for: a button with one of these is never shown as the main one. */
const LEAVING = ["cancel", "close", "done", "back", "no", "not now", "skip", "keep editing"];

/** Whether a button's words say it leaves the dialog rather than does what the dialog is for. */
export function leavesDialog(label: string): boolean {
  const w = label.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!]+$/, "");
  return LEAVING.includes(w);
}

/** Which button of a row is the main one: the first that does something (not Cancel or Close); -1 for none. A dimmed one still is: CSS fills it in once it can be used. */
export function mainButtonOf(buttons: readonly { label: string; disabled: boolean }[]): number {
  return buttons.findIndex((b) => !leavesDialog(b.label));
}

/** Whether a dialog gets the Close button: every dialog of ours, except the ones with one of their own and the full-window recording editor. */
export function wantsCloseButton(classes: string, hasOwn: boolean): boolean {
  if (hasOwn) return false;
  const c = ` ${classes} `;
  return c.includes(" dialog ") && !c.includes(" recording-editor ");
}

/** Close a dialog the way Escape does. */
export function closeLikeEscape(dialog: HTMLDialogElement): void {
  const asked = new Event("cancel", { cancelable: true });
  if (dialog.dispatchEvent(asked) && dialog.open) dialog.close();
}

/** Give one dialog the Close button, the foot and the main button. Safe to call again on the same dialog. */
export function dressDialog(dialog: HTMLDialogElement): void {
  const doc = dialog.ownerDocument;
  if (wantsCloseButton(dialog.className, !!dialog.querySelector(".cs-close, .dlg-close"))) {
    const close = el(doc, "button", { type: "button", class: "dlg-close", "aria-label": "Close", title: "Close (Escape)" });
    close.append(uiIcon(doc, "x"));
    close.addEventListener("click", () => closeLikeEscape(dialog));
    dialog.append(close);
  }
  // The foot: the last row of buttons in the dialog. CSS keeps it in sight at the bottom while the rest scrolls.
  const rows = [...dialog.querySelectorAll<HTMLElement>(".dialog-actions")];
  const foot = rows[rows.length - 1];
  if (foot && !foot.classList.contains("dlg-foot")) {
    foot.classList.add("dlg-foot");
    const plain = [...foot.querySelectorAll<HTMLButtonElement>(":scope > button")].filter((b) => !b.className || b.className === "primary");
    const main = mainButtonOf(plain.map((b) => ({ label: b.textContent ?? "", disabled: b.disabled })));
    if (main >= 0 && plain.length > 1) plain[main]!.dataset.main = "";
  }
}

/** Dress every dialog of ours as it opens with showModal. Called once, when the editor starts. */
export function dressDialogsWhenShown(): void {
  const original = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement): void {
    dressDialog(this);
    original.call(this);
  };
}
