// The dialog that asks how big a game should be before it is made, such as how many categories a quiz board has. A native <dialog>, like the
// others: focus moves in, Tab stays inside, Escape closes it, and focus goes back to where it was. Each question is a labelled drop-down of
// whole numbers, so it works by keyboard and a screen reader, and a live line says how many slides the choice will add.
//
// A game that can be filled from a spreadsheet (a quiz board, a prize ladder) also offers, right under its description, to choose a table of questions saved as a
// CSV file, and to save a sample table to start from. A table that can make the game sets the sizes (they come from the table) and the game is made with its
// questions already in it; the dialog says what it found, row by row, in words, before anything is added.

import { gameOptions, type GameOptions, type GameSet } from "./gamesets.ts";
import type { GameContent, GameTableRead } from "./gameimport.ts";

/** What the author chose: the sizes, and, if a table was used, what it gave the game. */
export interface GameChoice {
  options: GameOptions;
  content?: GameContent;
}

/** The file work for a table, passed in so this file only draws. */
export interface GameTableHooks {
  /** Ask which file to read. Null if the author cancelled. */
  pickFile(): Promise<string | null>;
  /** The words of the file. Throws with a message for the author if it cannot be read. */
  readFile(path: string): Promise<string>;
  /** Ask where to save the sample table, suggesting this name. Null if the author cancelled. */
  pickTemplateSave(name: string): Promise<string | null>;
  writeTemplate(dest: string, text: string): Promise<void>;
}

/** A file's name as a title: no extension, words apart, a capital to begin with ("quiz-board_questions.csv" is "Quiz board questions"). */
const stem = (path: string): string => {
  const name = (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]*$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return name.charAt(0).toUpperCase() + name.slice(1);
};

/** Resolves to what was chosen, or null if the dialog was cancelled. */
export function askGame(set: GameSet, hooks?: GameTableHooks): Promise<GameChoice | null> {
  return new Promise((resolve) => {
    const doc = document;
    const dialog = doc.createElement("dialog");
    dialog.className = "dialog game-dialog";
    dialog.setAttribute("aria-labelledby", "gd-title");

    const heading = doc.createElement("h2");
    heading.id = "gd-title";
    heading.textContent = set.label;

    const intro = doc.createElement("p");
    intro.className = "note";
    intro.textContent = set.table && hooks ? `${set.description} You can also fill it from a spreadsheet of your questions.` : set.description;

    const selects = new Map<string, HTMLSelectElement>();
    const fields = doc.createElement("div");
    for (const choice of set.choices) {
      const row = doc.createElement("div");
      row.className = "field";
      const label = doc.createElement("label");
      label.htmlFor = `gd-${choice.id}`;
      label.textContent = choice.label;
      const select = doc.createElement("select");
      select.id = `gd-${choice.id}`;
      select.setAttribute("aria-describedby", `gd-${choice.id}-help gd-summary`);
      for (let n = choice.min; n <= choice.max; n++) {
        const option = doc.createElement("option");
        option.value = String(n);
        option.textContent = String(n);
        option.selected = n === choice.initial;
        select.appendChild(option);
      }
      const help = doc.createElement("p");
      help.id = `gd-${choice.id}-help`;
      help.className = "note";
      help.textContent = choice.help;
      selects.set(choice.id, select);
      row.append(label, select);
      fields.append(row, help);
    }

    const chosen = (): GameOptions => gameOptions(set, Object.fromEntries([...selects].map(([id, s]) => [id, Number(s.value)])));

    const summary = doc.createElement("p");
    summary.id = "gd-summary";
    summary.className = "note";
    summary.setAttribute("role", "status");
    summary.textContent = set.summary(chosen());
    for (const s of selects.values()) s.addEventListener("change", () => (summary.textContent = set.summary(chosen())));

    // ---- a spreadsheet of questions
    let read: GameTableRead | null = null;
    let fileStem = "";
    const sheet = doc.createElement("fieldset");
    sheet.className = "gd-sheet";
    const sheetResult = doc.createElement("div");
    sheetResult.className = "gd-sheet-result";
    const titleRow = doc.createElement("div");
    titleRow.className = "field";
    titleRow.hidden = true;
    const titleLabel = doc.createElement("label");
    titleLabel.htmlFor = "gd-game-title";
    titleLabel.textContent = "Title of the game";
    const titleInput = doc.createElement("input");
    titleInput.type = "text";
    titleInput.id = "gd-game-title";
    titleInput.autocomplete = "off";
    titleRow.append(titleLabel, titleInput);
    const sizesNote = doc.createElement("p");
    sizesNote.className = "note";
    sizesNote.hidden = true;
    sizesNote.textContent = "The sizes come from your spreadsheet.";

    const say = (text: string) => { summary.textContent = text; };

    const showRead = () => {
      sheetResult.replaceChildren();
      const usable = !!read?.content;
      for (const [id, s] of selects) {
        s.disabled = usable;
        if (usable && read!.options) { const v = read!.options[id]; if (v !== undefined) s.value = String(v); }
      }
      sizesNote.hidden = !usable;
      titleRow.hidden = !usable;
      if (!read) return;
      const found = doc.createElement("p");
      found.className = "gd-found";
      found.tabIndex = -1;
      found.textContent = `${fileStem}: ${usable ? "this fills the game: " : ""}${read.summary}`;
      sheetResult.append(found);
      if (read.unusedColumns.length > 0) {
        const p = doc.createElement("p");
        p.className = "note";
        p.textContent = `${read.unusedColumns.length === 1 ? "A column was" : "Columns were"} not used because I do not know ${read.unusedColumns.length === 1 ? "its name" : "their names"}: ${read.unusedColumns.join(", ")}.`;
        sheetResult.append(p);
      }
      for (const note of read.notes) {
        const p = doc.createElement("p");
        p.className = "note";
        p.textContent = note;
        sheetResult.append(p);
      }
      if (read.problems.length > 0) {
        const h = doc.createElement("h3");
        h.id = "gd-problems-h";
        h.textContent = "Rows to look at";
        const list = doc.createElement("ul");
        list.className = "qi-problems";
        list.setAttribute("aria-labelledby", "gd-problems-h");
        for (const p of read.problems) {
          const li = doc.createElement("li");
          li.className = p.severity;
          li.textContent = `Row ${p.row}. ${p.severity === "error" ? "Left out: " : "Added, but: "}${p.message}`;
          list.append(li);
        }
        sheetResult.append(h, list);
      }
      if (usable) {
        titleInput.value = read.content!.title;
        say(set.summary(chosen()));
      } else {
        say("The game was not filled. Fix the table, or add the game with the sizes below and write the questions in yourself.");
      }
    };

    if (set.table && hooks) {
      const table = set.table;
      const legend = doc.createElement("legend");
      legend.textContent = "Fill it from a spreadsheet";
      const how = doc.createElement("p");
      how.className = "note";
      how.id = "gd-sheet-how";
      how.textContent = `Keep the questions in a spreadsheet and save it as a CSV file (in Excel: Save As, then CSV UTF-8). The game is made with them already in it. The first row names the columns: ${table.columns}. The sample is a whole small game, so you can add it to see how the table works, then replace its rows with your own.`;
      const choose = doc.createElement("button");
      choose.type = "button";
      choose.id = "gd-choose";
      choose.textContent = "Choose a spreadsheet (CSV)...";
      choose.setAttribute("aria-describedby", "gd-sheet-how");
      const sample = doc.createElement("button");
      sample.type = "button";
      sample.id = "gd-sample";
      sample.textContent = "Save a sample spreadsheet...";
      const buttons = doc.createElement("div");
      buttons.className = "btn-row";
      buttons.append(choose, sample);
      choose.addEventListener("click", async () => {
        let path: string | null;
        try { path = await hooks.pickFile(); } catch (err) { say(`Could not open the file chooser. ${err instanceof Error ? err.message : String(err)}`); return; }
        if (!path) return;
        try {
          read = table.read(await hooks.readFile(path), stem(path));
          fileStem = stem(path);
          choose.textContent = "Choose another spreadsheet...";
          showRead();
          sheetResult.querySelector<HTMLElement>(".gd-found")?.focus();
        } catch (err) {
          say(err instanceof Error ? err.message : String(err));
        }
      });
      sample.addEventListener("click", async () => {
        try {
          const dest = await hooks.pickTemplateSave(table.templateName);
          if (!dest) return;
          await hooks.writeTemplate(dest, table.template);
          say(`Saved the sample spreadsheet as ${dest}. Open it in Excel or Google Sheets, replace the example rows with your questions, save it as CSV, and choose it here.`);
        } catch (err) {
          say(err instanceof Error ? err.message : String(err));
        }
      });
      sheet.append(legend, how, buttons, sheetResult, titleRow);
    }

    const ok = doc.createElement("button");
    ok.type = "submit";
    ok.textContent = "Add game";
    const cancel = doc.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    const actions = doc.createElement("div");
    actions.className = "dialog-actions";
    actions.append(ok, cancel);

    const form = doc.createElement("form");
    form.method = "dialog";
    form.append(heading, intro, ...(set.table && hooks ? [sheet] : []), fields, sizesNote, summary, actions);
    dialog.appendChild(form);
    doc.body.appendChild(dialog);

    let result: GameChoice | null = null;
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
      const content = read?.content ?? null;
      result = content
        ? { options: read!.options ? gameOptions(set, read!.options) : chosen(), content: { ...content, title: titleInput.value.trim() || content.title } }
        : { options: chosen() };
      finish();
    });

    dialog.showModal();
    // The first thing to reach is the spreadsheet, if the game has one: it is the quick way to a finished game.
    (doc.getElementById("gd-choose") ?? selects.values().next().value)?.focus();
  });
}
