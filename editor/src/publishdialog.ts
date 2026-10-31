// The Publish dialog: makes the SCORM 1.2 package for an LMS and the same course as web files. It saves the
// project first, then runs the same publishing tool the command line uses, which checks the project for problems
// and refuses to publish if there are errors. Making narration audio for the first time can take minutes, so the
// work can be cancelled. A native <dialog>, so focus moves in, Tab stays inside, Escape closes it (or, while it is
// working, cancels the work) and focus returns to where it came from.

import { errorText, type Backend } from "./backend.ts";
import { defaultPublishFolder, failureText, problemLine, publishSummary, type PublishResult } from "./publishing.ts";
import { parseSettings, serializeSettings } from "./stock.ts";

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

export interface PublishOptions {
  backend: Backend;
  /** The project folder. */
  dir: string;
  /** Writes what has changed. Resolves false if it could not, after telling the author why. */
  save: () => Promise<boolean>;
  announce: (message: string) => void;
}

/** Remember the folder for next time. A failure to remember is not worth bothering the author with. */
async function rememberFolder(b: Backend, folder: string): Promise<void> {
  try {
    const settings = parseSettings(await b.readSettings());
    await b.writeSettings(serializeSettings({ ...settings, publishFolder: folder }));
  } catch {
    // the folder is simply not remembered
  }
}

export function openPublish(opts: PublishOptions): Promise<void> {
  const b = opts.backend;
  return new Promise((resolve) => {
    let folder = defaultPublishFolder(opts.dir);
    let running = false;
    let last: PublishResult | null = null;

    const dialog = h("dialog", { class: "dialog wide publish-dialog", "aria-labelledby": "pb-title" });
    const folderBox = h("input", { id: "pb-folder", type: "text", readonly: true, value: folder });
    const choose = h("button", { type: "button", text: "Choose folder..." });
    const status = h("p", { class: "as-status", role: "status" });
    const failure = h("p", { class: "dialog-error", role: "alert" });
    const problems = h("ul", { class: "pb-problems", "aria-label": "Errors that stopped publishing" });
    const reveal = h("button", { type: "button", text: "Show the package in its folder" });
    const revealReview = h("button", { type: "button", text: "Show the Word review document" });
    const view = h("button", { type: "button", text: "Open the course in my browser" });
    const after = h("div", { class: "dialog-actions pb-after", hidden: true }, reveal, revealReview, view);
    const go = h("button", { type: "button", text: "Publish" });
    const closeBtn = h("button", { type: "button", text: "Close" });

    const say = (text: string) => { status.textContent = text; };
    const fail = (text: string) => { failure.textContent = text; };

    /** Buttons that cannot be used while the work is running say so, and keep focus where it is. */
    const refresh = () => {
      for (const b2 of [go, choose]) {
        if (running) b2.setAttribute("aria-disabled", "true");
        else b2.removeAttribute("aria-disabled");
      }
      closeBtn.textContent = running ? "Cancel publishing" : "Close";
    };

    const clearResults = () => {
      failure.textContent = "";
      problems.replaceChildren();
      after.hidden = true;
      last = null;
    };

    const run = async () => {
      if (running) return;
      running = true;
      clearResults();
      refresh();
      say("Saving your project first.");
      try {
        if (!(await opts.save())) {
          say("");
          fail("Your project could not be saved, so nothing was published.");
          return;
        }
        say("Publishing. If narration audio is being made for the first time this can take several minutes. You can cancel.");
        const result = await b.publish(opts.dir, folder);
        last = result;
        say("");
        if (result.ok) {
          // One paragraph in the live region, so a screen reader reads all of it once.
          say(publishSummary(result).join(" "));
          revealReview.hidden = !result.review;
          after.hidden = false;
          await rememberFolder(b, folder);
        } else {
          const errors = result.findings.filter((f) => f.severity === "error");
          problems.replaceChildren(...errors.map((f) => h("li", { text: problemLine(f) })));
          fail(failureText(result));
        }
      } catch (err) {
        say("");
        fail(errorText(err));
      } finally {
        running = false;
        refresh();
      }
    };

    const leave = async () => {
      if (running) {
        say("Cancelling.");
        await b.cancelJob().catch(() => false);
        return;
      }
      dialog.close();
      dialog.remove();
      opts.announce("Publish closed.");
      resolve();
    };

    go.addEventListener("click", () => { if (go.getAttribute("aria-disabled") !== "true") void run(); });
    closeBtn.addEventListener("click", () => void leave());
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); void leave(); });
    choose.addEventListener("click", async () => {
      if (choose.getAttribute("aria-disabled") === "true") return;
      const picked = await b.pickFolder("Choose a folder to publish into", "publish");
      if (!picked) return;
      folder = picked;
      folderBox.value = picked;
      say(`The course will be published into ${picked}.`);
    });
    reveal.addEventListener("click", () => {
      if (last?.zip) void b.revealInFolder(last.zip).catch((err) => fail(errorText(err)));
    });
    revealReview.addEventListener("click", () => {
      if (last?.review) void b.revealInFolder(last.review).catch((err) => fail(errorText(err)));
    });
    view.addEventListener("click", () => {
      if (last?.indexHtml) void b.openInBrowser(last.indexHtml).catch((err) => fail(errorText(err)));
    });

    dialog.append(
      h("h2", { id: "pb-title", text: "Publish" }),
      h("p", { class: "note", text: "Publishing makes three packages, each a zip file: SCORM 1.2 and SCORM 2004 for an LMS, and xAPI for a learning record store. Upload the one your system asks for. It also makes the same course as web files, and a Word document for colleagues and accessibility reviewers: the slide text, alt text, narration scripts, quiz answers and the problems the checker found. It saves your project first and checks it for problems. Errors stop it; warnings do not." }),
      h("div", { class: "field" }, h("label", { for: "pb-folder", text: "Publish into this folder" }), folderBox),
      h("div", { class: "btn-row" }, choose),
      h("p", { class: "note", text: "A folder named after your project is made inside it, with the package beside that folder. Publishing again replaces them." }),
      status, failure, problems, after,
      h("div", { class: "dialog-actions" }, go, closeBtn),
    );
    document.body.appendChild(dialog);
    dialog.showModal();
    go.focus();
    // The remembered folder, if there is one, replaces the suggestion once it has been read.
    void b.readSettings().then((raw) => {
      const saved = parseSettings(raw).publishFolder;
      if (saved && !running && folder === defaultPublishFolder(opts.dir)) {
        folder = saved;
        folderBox.value = saved;
      }
    }).catch(() => undefined);
  });
}
