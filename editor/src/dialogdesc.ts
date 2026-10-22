// What a screen reader says when a dialog opens. NVDA says the dialog's name and then its description, and when a dialog has no description it
// reads out every word in the dialog (all 35 layouts with what each is for, for the layout picker, and then again when focus lands). Pointing the
// description at the dialog's first paragraph, which every dialog of ours uses to say what it is for, makes it say that and no more.
// Found in the NVDA pass of 2026-10-21 (docs/screen-reader-pass.md).

/** Give a dialog a short description: its first paragraph that holds words, unless it already has one. */
export function describeBriefly(dialog: HTMLDialogElement): void {
  if (dialog.hasAttribute("aria-describedby")) return;
  const intro = [...dialog.querySelectorAll<HTMLElement>("p")].find((p) => p.textContent!.trim() !== "" && !p.matches('[role="status"], [role="alert"], .dialog-error'));
  if (!intro) return;
  if (!intro.id) intro.id = `${dialog.getAttribute("aria-labelledby") ?? "dialog"}-intro`;
  dialog.setAttribute("aria-describedby", intro.id);
}

/** Make every dialog opened with showModal describe itself briefly. Called once, when the editor starts. */
export function describeDialogsBriefly(): void {
  const original = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement): void {
    describeBriefly(this);
    original.call(this);
  };
}
