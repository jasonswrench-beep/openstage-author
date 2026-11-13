// The Publish dialog: makes the SCORM 1.2 package for an LMS and the same course as web files. It saves the
// project first, then runs the same publishing tool the command line uses, which checks the project for problems
// and refuses to publish if there are errors. Making narration audio for the first time can take minutes, so the
// work can be cancelled. A native <dialog>, so focus moves in, Tab stays inside, Escape closes it (or, while it is
// working, cancels the work) and focus returns to where it came from.

import { errorText, type Backend } from "./backend.ts";
import { defaultPublishFolder, failureText, problemLine, publishSummary, type PublishResult } from "./publishing.ts";
import { parseSettings, serializeSettings } from "./stock.ts";
import { DEFAULT_STYLE, publishName, type NameValues, type PublishStyle } from "./publishstyle.ts";
import { readPublishStyle } from "./publishstyledialog.ts";

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
  /** The course's title, code, version and folder, for the name the publishing style gives the files. */
  values: () => NameValues;
  /** Open File > Publishing style from here. Resolves once it is closed. */
  editStyle: () => Promise<void>;
}

/** The name the style gives the published files, or null for the usual (the project folder's, worked out by the desktop program). */
export function styledName(style: PublishStyle, values: NameValues): string | null {
  return style.fileName.trim() === DEFAULT_STYLE.fileName ? null : publishName(style.fileName, values);
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
    let style: PublishStyle = DEFAULT_STYLE;

    const dialog = h("dialog", { class: "dialog wide publish-dialog", "aria-labelledby": "pb-title" });
    const folderBox = h("input", { id: "pb-folder", type: "text", readonly: true, value: folder });
    const choose = h("button", { type: "button", text: "Choose folder..." });
    const status = h("p", { class: "as-status", role: "status" });
    const failure = h("p", { class: "dialog-error", role: "alert" });
    const problems = h("ul", { class: "pb-problems", "aria-label": "Errors that stopped publishing" });
    const reveal = h("button", { type: "button", text: "Show the package in its folder" });
    const revealReview = h("button", { type: "button", text: "Show the Word review document" });
    const revealVideo = h("button", { type: "button", text: "Show the video" });
    const view = h("button", { type: "button", text: "Open the course in my browser" });
    const after = h("div", { class: "dialog-actions pb-after", hidden: true }, reveal, revealReview, revealVideo, view);
    const videoBox = h("input", { id: "pb-video", type: "checkbox", "aria-describedby": "pb-video-note" });
    // Off unless the author asks: the copy is for someone who should be able to open and change the course, not for every learner.
    const sourceBox = h("input", { id: "pb-source", type: "checkbox", "aria-describedby": "pb-source-note" });
    const sourceNote = h("p", { id: "pb-source-note", class: "note", text: "Puts the course's own files in each zip too, so someone who has the package can open and change it in OpenStage Author. Only the project, its slides, its theme and the assets the course uses go in: nothing else from the project folder. Anyone who can download the package from your LMS could get them, so leave this off unless you mean to share the course itself." });
    const videoNote = h("p", { id: "pb-video-note", class: "note", text: "The video shows each slide as it opens, in order, with its narration, the things that arrive on their own and captions in a file beside it. It cannot be answered or clicked, so a question is shown as it opens. It takes a few minutes, needs Windows with Microsoft Edge or Google Chrome, and is made with the OpenStage recorder's video tools." });
    const nameNote = h("p", { id: "pb-name-note", class: "note" });
    const styleBtn = h("button", { type: "button", text: "Publishing style..." });
    const showName = () => {
      const values = opts.values();
      const name = styledName(style, values);
      const shown = name ?? values.folder.replace(/\.osproj$/i, "");
      nameNote.textContent = name === null
        ? `A folder named after your project (${shown}) is made inside it, with the packages beside that folder. Publishing again replaces them. Publishing style can name them by your institution's rules instead.`
        : `Your publishing style names them ${shown}: a folder of that name is made inside it, with ${shown}-scorm12.zip and the other packages beside it. Publishing again with the same name replaces them.`;
    };
    const go = h("button", { type: "button", text: "Publish" });
    const closeBtn = h("button", { type: "button", text: "Close" });

    const say = (text: string) => { status.textContent = text; };
    const fail = (text: string) => { failure.textContent = text; };

    /** Buttons that cannot be used while the work is running say so, and keep focus where it is. */
    const refresh = () => {
      for (const b2 of [go, choose, styleBtn]) {
        if (running) b2.setAttribute("aria-disabled", "true");
        else b2.removeAttribute("aria-disabled");
      }
      videoBox.disabled = running;
      sourceBox.disabled = running;
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
        const video = videoBox.checked;
        say(`Publishing. If narration audio is being made for the first time this can take several minutes${video ? ", and so does making the video" : ""}. You can cancel.`);
        style = await readPublishStyle(b);
        showName();
        const name = styledName(style, opts.values());
        const result = await b.publish(opts.dir, folder, {
          video,
          ...(sourceBox.checked ? { source: true } : {}),
          ...(name !== null ? { name } : {}),
          ...(style.headings !== DEFAULT_STYLE.headings ? { headings: style.headings } : {}),
          ...(style.font !== DEFAULT_STYLE.font ? { font: style.font } : {}),
        });
        last = result;
        say("");
        if (result.ok) {
          // One paragraph in the live region, so a screen reader reads all of it once.
          say(publishSummary(result).join(" "));
          revealReview.hidden = !result.review;
          revealVideo.hidden = !result.video;
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
    revealVideo.addEventListener("click", () => {
      if (last?.video) void b.revealInFolder(last.video.file).catch((err) => fail(errorText(err)));
    });
    styleBtn.addEventListener("click", async () => {
      if (styleBtn.getAttribute("aria-disabled") === "true" || running) return;
      await opts.editStyle();
      style = await readPublishStyle(b);
      showName();
      styleBtn.focus();
    });
    view.addEventListener("click", () => {
      if (last?.indexHtml) void b.openInBrowser(last.indexHtml).catch((err) => fail(errorText(err)));
    });

    dialog.append(
      h("h2", { id: "pb-title", text: "Publish" }),
      h("p", { class: "note", text: "Publishing makes three packages, each a zip file: SCORM 1.2 and SCORM 2004 for an LMS, and xAPI for a learning record store. Upload the one your system asks for. It also makes the same course as web files, and a Word document for colleagues and accessibility reviewers: the slide text, alt text, narration scripts, quiz answers and the problems the checker found. It saves your project first and checks it for problems. Errors stop it; warnings do not." }),
      h("div", { class: "field" }, h("label", { for: "pb-folder", text: "Publish into this folder" }), folderBox),
      h("div", { class: "btn-row" }, choose),
      nameNote,
      h("div", { class: "btn-row" }, styleBtn),
      h("div", { class: "field check" }, videoBox, h("label", { for: "pb-video", text: "Also make a video (MP4) of the course, with captions" })),
      videoNote,
      h("div", { class: "field check" }, sourceBox, h("label", { for: "pb-source", text: "Include an editable copy of the course" })),
      sourceNote,
      status, failure, problems, after,
      h("div", { class: "dialog-actions" }, go, closeBtn),
    );
    document.body.appendChild(dialog);
    dialog.showModal();
    go.focus();
    showName();
    void readPublishStyle(b).then((s) => { style = s; showName(); });
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
