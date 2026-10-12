// A small dialog that asks for one line of text, such as a video address. Like the other dialogs it is
// a native <dialog>, so focus moves in, Tab stays inside, Escape closes it, and focus goes back to
// where it was. A mistake is shown in the dialog, in a live region, and the dialog stays open.

export interface TextPrompt {
  heading: string;
  label: string;
  confirm: string;
  /** Words under the box that say what is wanted. */
  help?: string;
  /** Returns a message if the text is not acceptable, or null if it is. */
  check?(text: string): string | null;
}

/** Resolves to the text, or null if the dialog was cancelled. */
export function askText(opts: TextPrompt): Promise<string | null> {
  return new Promise((resolve) => {
    const doc = document;
    const dialog = doc.createElement("dialog");
    dialog.className = "dialog";
    dialog.setAttribute("aria-labelledby", "tp2-title");

    const heading = doc.createElement("h2");
    heading.id = "tp2-title";
    heading.textContent = opts.heading;

    const row = doc.createElement("div");
    row.className = "field";
    const label = doc.createElement("label");
    label.htmlFor = "tp2-input";
    label.textContent = opts.label;
    const input = doc.createElement("input");
    input.id = "tp2-input";
    input.type = "text";
    input.setAttribute("aria-describedby", "tp2-help tp2-error");
    row.append(label, input);

    const help = doc.createElement("p");
    help.id = "tp2-help";
    help.className = "note";
    help.textContent = opts.help ?? "";

    const error = doc.createElement("p");
    error.id = "tp2-error";
    error.className = "dialog-error";
    error.setAttribute("role", "alert");

    const ok = doc.createElement("button");
    ok.type = "submit";
    ok.textContent = opts.confirm;
    const cancel = doc.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    const actions = doc.createElement("div");
    actions.className = "dialog-actions";
    actions.append(ok, cancel);

    const form = doc.createElement("form");
    form.method = "dialog";
    form.append(heading, row, help, error, actions);
    dialog.appendChild(form);
    doc.body.appendChild(dialog);

    let result: string | null = null;
    const finish = () => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    cancel.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish();
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const message = opts.check?.(input.value) ?? null;
      if (message) {
        error.textContent = message;
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      result = input.value;
      finish();
    });

    dialog.showModal();
    input.focus();
  });
}
