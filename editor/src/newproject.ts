// The New project dialog. It uses the browser's own <dialog>, which gives a proper modal:
// focus moves in, Tab stays inside, Escape closes it, and focus returns to the button that
// opened it. Errors are in a role="alert" region so a screen reader reads them at once.

import { errorText, type Backend } from "./backend.ts";
import { checkNewProject } from "./template.ts";
import { BUILT_IN_THEMES } from "./themes.ts";

export interface NewProjectChoice {
  dir: string;
  /** The id of the built-in theme to start with. */
  themeId: string;
  title: string;
  author: string;
  language: string;
}

/**
 * Show the dialog. `create` does the work; if it throws, the message is shown and the
 * dialog stays open so nothing typed is lost. Resolves to true if a project was created.
 */
export function askNewProject(backend: Backend, create: (c: NewProjectChoice) => Promise<void>): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "dialog";
    dialog.setAttribute("aria-labelledby", "np-title");

    const field = (id: string, label: string, value = "", required = false) => {
      const input = document.createElement("input");
      input.id = id;
      input.type = "text";
      input.value = value;
      if (required) input.setAttribute("aria-required", "true");
      const l = document.createElement("label");
      l.htmlFor = id;
      l.textContent = label;
      const row = document.createElement("div");
      row.className = "field";
      row.append(l, input);
      return { row, input };
    };

    const heading = document.createElement("h2");
    heading.id = "np-title";
    heading.textContent = "New project";

    const title = field("np-name", "Project title (required)", "", true);
    const author = field("np-author", "Author");
    const language = field("np-lang", "Language code", "en-US");

    const themeSelect = document.createElement("select");
    themeSelect.id = "np-theme";
    for (const t of BUILT_IN_THEMES) {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.name;
      themeSelect.appendChild(o);
    }
    const themeLabel = document.createElement("label");
    themeLabel.htmlFor = "np-theme";
    themeLabel.textContent = "Theme (you can change it later)";
    const themeRow = document.createElement("div");
    themeRow.className = "field";
    themeRow.append(themeLabel, themeSelect);

    let folder = "";
    const folderBtn = document.createElement("button");
    folderBtn.type = "button";
    folderBtn.textContent = "Choose folder...";
    const folderText = document.createElement("span");
    folderText.id = "np-folder";
    folderText.textContent = "No folder chosen";
    folderBtn.setAttribute("aria-describedby", "np-folder");
    const folderRow = document.createElement("div");
    folderRow.className = "field";
    const folderLabel = document.createElement("span");
    folderLabel.textContent = "Folder (empty, or a new one)";
    const folderControls = document.createElement("div");
    folderControls.append(folderBtn, document.createElement("br"), folderText);
    folderRow.append(folderLabel, folderControls);

    const error = document.createElement("p");
    error.className = "error-text";
    error.setAttribute("role", "alert");

    const createBtn = document.createElement("button");
    createBtn.type = "submit";
    createBtn.textContent = "Create project";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    actions.append(createBtn, cancelBtn);

    const form = document.createElement("form");
    form.method = "dialog";
    form.append(heading, title.row, author.row, language.row, themeRow, folderRow, error, actions);
    dialog.appendChild(form);
    document.body.appendChild(dialog);

    let created = false;
    const finish = () => {
      dialog.close();
      dialog.remove();
      resolve(created);
    };

    folderBtn.addEventListener("click", async () => {
      const picked = await backend.pickFolder("Choose an empty folder for the new project", "new");
      if (picked) {
        folder = picked;
        folderText.textContent = picked;
      }
      folderBtn.focus();
    });
    cancelBtn.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault(); // Escape: close through finish, so the promise always settles
      finish();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      error.textContent = "";
      const problem = checkNewProject({ title: title.input.value, language: language.input.value }) ?? (folder ? null : "Choose a folder for the project.");
      if (problem) {
        error.textContent = problem;
        (problem.startsWith("Enter") ? title.input : problem.startsWith("Language") ? language.input : folderBtn).focus();
        return;
      }
      createBtn.setAttribute("aria-disabled", "true");
      try {
        await create({ dir: folder, themeId: themeSelect.value, title: title.input.value, author: author.input.value, language: language.input.value });
        created = true;
        finish();
      } catch (err) {
        error.textContent = errorText(err);
        createBtn.removeAttribute("aria-disabled");
      }
    });

    dialog.showModal();
    title.input.focus();
  });
}
