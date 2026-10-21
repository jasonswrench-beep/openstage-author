// The dialog for adding questions from a spreadsheet (see questionimport.ts and docs/question-import.md). The author chooses a table saved as a CSV
// file, reads what was found, row by row, decides whether the questions become a question bank and whether their answers are mixed, and adds them.
// A native <dialog>, like the others: focus moves in, Tab stays inside, Escape closes it. The file work is passed in, so this file only draws.

import { describeRead, MAX_QUESTIONS, readQuestions, TEMPLATE_CSV, type ImportedQuestion, type QuestionRead } from "./questionimport.ts";

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

export interface QuestionImportHooks {
  /** Ask which file to read. Null if the author cancelled. */
  pickFile(): Promise<string | null>;
  /** The words of the file. Throws with a message for the author if it cannot be read. */
  readFile(path: string): Promise<string>;
  /** Ask where to save the blank table. Null if the author cancelled. */
  pickTemplateSave(): Promise<string | null>;
  writeTemplate(dest: string, text: string): Promise<void>;
}

export interface QuestionImportChoice {
  questions: ImportedQuestion[];
  bank: { name: string; draw: number; shuffle: boolean } | null;
  shuffleAnswers: boolean;
}

const TYPE_WORDS: Record<ImportedQuestion["type"], string> = { mc: "multiple choice", mr: "several right", tf: "true or false", short: "short answer" };

const stem = (path: string): string => (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]*$/, "");

/** Ask which questions to add and how. Resolves to the choice, or null if the dialog was cancelled. */
export function askQuestionImport(after: string, hooks: QuestionImportHooks): Promise<QuestionImportChoice | null> {
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "dialog wide questions-dialog", "aria-labelledby": "qi-title" });
    const form = h("form", { method: "dialog" });
    const body = h("div", { class: "qi-body" });
    const status = h("p", { class: "note", role: "status", "aria-live": "polite" });
    let read: QuestionRead | null = null;
    let fileName = "";
    let result: QuestionImportChoice | null = null;
    const actions = h("div", { class: "dialog-actions" });
    let addButton: HTMLButtonElement | null = null;
    const finish = () => { dialog.close(); dialog.remove(); resolve(result); };
    const say = (text: string) => { status.textContent = text; };

    const choose = async () => {
      let path: string | null;
      try { path = await hooks.pickFile(); } catch (err) { say(`Could not open the file chooser. ${err instanceof Error ? err.message : String(err)}`); return; }
      if (!path) return;
      try {
        read = readQuestions(await hooks.readFile(path));
        fileName = stem(path);
        say(`${describeRead(read)}`);
        render(true);
      } catch (err) {
        say(err instanceof Error ? err.message : String(err));
      }
    };
    const saveTemplate = async () => {
      try {
        const dest = await hooks.pickTemplateSave();
        if (!dest) return;
        await hooks.writeTemplate(dest, TEMPLATE_CSV);
        say(`Saved the blank table as ${dest}. Open it in Excel or Google Sheets, replace the example rows with your questions, and save it as CSV.`);
      } catch (err) {
        say(err instanceof Error ? err.message : String(err));
      }
    };

    const render = (focusSummary = false) => {
      body.replaceChildren();
      addButton?.remove();
      addButton = null;
      const intro = h("p", { class: "note", text: `Keep your questions in a spreadsheet, save it as a CSV file (in Excel: Save As, then CSV UTF-8), and each row becomes a question on a slide of its own, with its own feedback layers. The first row names the columns: Type (MC multiple choice, MR several right, TF true or false, SA short answer), Question, A to H (the answers), Correct (the letters of the right answers, or True or False), and, if you like, Points, Attempts, Feedback if right and Feedback if wrong. Up to ${MAX_QUESTIONS} questions at a time.` });
      const choose1 = h("button", { type: "button", text: read ? "Choose another file..." : "Choose a table of questions..." });
      const template = h("button", { type: "button", text: "Save a blank table to start from..." });
      choose1.addEventListener("click", () => void choose());
      template.addEventListener("click", () => void saveTemplate());
      body.append(intro, h("div", { class: "btn-row" }, choose1, template));
      if (!read) return;

      const n = read.questions.length;
      const summary = h("p", { class: "qi-summary", tabindex: "-1", text: `${fileName}: ${describeRead(read)}` });
      body.append(h("h3", { id: "qi-found", text: "What was found" }), summary);
      if (read.unusedColumns.length > 0) body.append(h("p", { class: "note", text: `${read.unusedColumns.length === 1 ? "A column was" : "Columns were"} not used because I do not know ${read.unusedColumns.length === 1 ? "its name" : "their names"}: ${read.unusedColumns.join(", ")}.` }));
      if (read.problems.length > 0) {
        body.append(h("h3", { id: "qi-problems-h", text: "Rows to look at" }),
          h("ul", { class: "qi-problems", "aria-labelledby": "qi-problems-h" }, ...read.problems.map((p) => h("li", { class: p.severity, text: `Row ${p.row}. ${p.severity === "error" ? "Left out: " : "Added, but: "}${p.message}` }))));
      }
      if (n > 0) {
        const shown = read.questions.slice(0, 12);
        body.append(h("h3", { id: "qi-list-h", text: "The questions" }),
          h("ol", { class: "qi-list", "aria-labelledby": "qi-list-h" }, ...shown.map((q) => h("li", { text: `${q.question} (${TYPE_WORDS[q.type]}${q.type === "tf" || q.type === "short" ? "" : `, ${q.answers.length} answers`})` }))),
          ...(n > shown.length ? [h("p", { class: "note", text: `And ${n - shown.length} more.` })] : []));

        const bankBox = h("input", { type: "checkbox", id: "qi-bank", ...(n >= 2 ? { checked: true } : { disabled: true }) });
        const name = h("input", { type: "text", id: "qi-bank-name" });
        name.value = fileName;
        const draw = h("input", { type: "number", id: "qi-bank-draw", min: "1", max: String(n), step: "1" });
        draw.value = String(Math.max(1, Math.floor(n / 2)));
        const mixOrder = h("input", { type: "checkbox", id: "qi-bank-mix", checked: true });
        const mixAnswers = h("input", { type: "checkbox", id: "qi-shuffle", checked: true });
        const details = h("div", { class: "qi-bank" },
          h("div", { class: "field" }, h("label", { for: "qi-bank-name", text: "Name of the bank" }), name),
          h("div", { class: "field" }, h("label", { for: "qi-bank-draw", text: `Show how many of the ${n} questions to each learner` }), draw),
          h("div", { class: "field check" }, mixOrder, h("label", { for: "qi-bank-mix", text: "Show them in a mixed order" })));
        const sync = () => { details.hidden = !bankBox.checked; };
        bankBox.addEventListener("change", sync);
        sync();
        body.append(h("fieldset", {}, h("legend", { text: "How to add them" }),
          h("div", { class: "field check" }, bankBox, h("label", { for: "qi-bank", text: n >= 2 ? "Make them a question bank: each learner is shown some of them, picked at random" : "A question bank needs at least two questions" })),
          details,
          h("div", { class: "field check" }, mixAnswers, h("label", { for: "qi-shuffle", text: "Show the answers of each multiple choice question in a different order to each learner" }))));

        const add = h("button", { type: "submit", text: `Add ${n === 1 ? "the question" : `${n} questions`} after ${after || "the last slide"}` });
        add.addEventListener("click", (e) => {
          e.preventDefault();
          const count = Number(draw.value);
          if (bankBox.checked && (!Number.isInteger(count) || count < 1 || count > n)) { say(`Show a whole number of questions from 1 to ${n}.`); draw.focus(); return; }
          result = {
            questions: read!.questions,
            bank: bankBox.checked ? { name: name.value.trim() || fileName, draw: count, shuffle: mixOrder.checked } : null,
            shuffleAnswers: mixAnswers.checked,
          };
          finish();
        });
        addButton = add;
        actions.prepend(add);
      }
      if (focusSummary) summary.focus();
    };

    const cancel = h("button", { type: "button", text: "Cancel" });
    actions.append(cancel);
    cancel.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });
    form.addEventListener("submit", (e) => e.preventDefault());
    form.append(h("h2", { id: "qi-title", text: "Add questions from a spreadsheet" }), body, status, actions);
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    render();
    dialog.showModal();
    body.querySelector<HTMLElement>("button")?.focus();
  });
}
