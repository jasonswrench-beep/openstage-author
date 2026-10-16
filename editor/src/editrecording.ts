// The dialog for editing a recording: OpenScreen's preview, timeline and clip list, on one edit.
//
// The editing screens are the package capture-timeline (plain DOM, no dependencies). This dialog gives them somewhere to live inside the editor, a
// way to reach the recording through the editor's shell (recordingfolder.ts), and a way to save the edit. The edit is a list of what to keep and
// what to add (trims, splits, text, shapes, zoom); it is saved as `edit.json` inside the recording and never changes the recorded video or sound.
//
// A native <dialog>, so focus moves in, Tab stays inside, and focus returns to the button that opened it. The screens have their own F6, which
// moves between the preview, the timeline and the clip list, and say where it arrived. They have their own line of announcements, a polite
// live region; the editor's own announcer is not used as well, so nothing is read twice.

import { describeLength, listCaption, modelLengthMs, serialize } from "../../capture-edit/src/index.ts";
import { mountEditor } from "../../capture-timeline/src/editor.ts";
import { libraryOf, readProject } from "../../capture-timeline/src/project.ts";
import { EditSession } from "../../capture-timeline/src/session.ts";
import type { Backend } from "./backend.ts";
import { recordingFolder } from "./recordingfolder.ts";

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

export interface EditRecordingOptions {
  backend: Backend;
  /** The open course's folder. */
  dir: string;
  /** The recording's folder name, such as `Week 3.capture`. */
  name: string;
}

/** The first thing the screens say when a recording is opened. */
function openingWords(title: string, lengthMs: number, caption: string, notes: readonly string[], problems: readonly { message: string }[]): string {
  const first = problems[0];
  const problem = first === undefined ? "" : ` ${problems.length === 1 ? "One thing needs a look" : `${problems.length} things need a look`}: ${first.message}`;
  return `Opened the recording ${title}, ${describeLength(lengthMs)} long. ${caption} ${notes.join(" ")}${problem}`.replace(/\s+/g, " ").trim();
}

export function openRecordingEditor(opts: EditRecordingOptions): Promise<void> {
  const b = opts.backend;
  return new Promise((resolve) => {
    // The editing screens bring colours for a dark page as well; the editor is light only, so they are kept light to match it.
    document.documentElement.setAttribute("data-theme", "light");

    const dialog = h("dialog", { class: "dialog recording-editor", "aria-labelledby": "re-title" });
    const heading = h("h2", { id: "re-title", text: "Edit the recording" });
    const state = h("p", { id: "re-state", class: "note", text: "Opening the recording." });
    const save = h("button", { type: "button", text: "Save the edit", "aria-describedby": "re-state" });
    const close = h("button", { type: "button", text: "Close" });
    const host = h("div", { class: "re-host" });
    dialog.append(
      heading,
      h("p", { class: "note", text: "Your changes are saved as a list of what to keep and what to add. The recording itself, its picture and its sound, is never changed. Press F6 to move between the preview, the timeline and the clip list." }),
      h("div", { class: "dialog-actions" }, save, close), state, host,
    );
    document.body.appendChild(dialog);
    dialog.showModal();

    const folder = recordingFolder(b, opts.dir, opts.name);
    let session: EditSession | undefined;
    let editor: ReturnType<typeof mountEditor> | undefined;

    const showState = () => {
      if (session === undefined) return;
      state.textContent = session.dirty ? "There are changes that are not saved." : "There are no unsaved changes.";
    };

    async function saveEdit(): Promise<void> {
      if (session === undefined || editor === undefined) return;
      try {
        const ok = await folder.writeText("edit.json", serialize(session.model));
        if (ok) {
          session.markSaved();
          editor.announce(`Saved the edit in ${opts.name}.`);
        } else {
          editor.announce("The edit could not be saved. Nothing was changed on the disk.");
        }
      } catch (err) {
        editor.announce(`The edit could not be saved. ${err instanceof Error ? err.message : String(err)}`);
      }
      showState();
    }

    async function finish(): Promise<void> {
      if (session?.dirty === true && !(await b.confirm("You have changes to this edit that are not saved. Close and lose them?"))) return;
      editor?.destroy();
      folder.release();
      dialog.close();
      dialog.remove();
      resolve();
    }

    save.addEventListener("click", () => void saveEdit());
    close.addEventListener("click", () => void finish());
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); void finish(); });
    // Ctrl+S saves the edit while this dialog is open. (The course is not saved from here: its own Ctrl+S steps aside.)
    dialog.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveEdit();
      }
    });
    // Leaving with changes that are not saved is asked about by the Close button; the window closing is asked about by the editor.

    void (async () => {
      const result = await readProject(folder);
      if (!result.ok) {
        state.textContent = result.message;
        save.hidden = true;
        close.focus();
        return;
      }
      const { project } = result;
      heading.textContent = `Edit the recording: ${project.title}`;
      session = new EditSession(project.model);
      editor = mountEditor(host, session, { library: libraryOf(project.folder) });
      session.subscribe((kind) => {
        if (kind === "model" || kind === "saved") showState();
      });
      showState();
      editor.announce(openingWords(project.title, modelLengthMs(project.model), listCaption(project.model), project.notes, project.problems));
      editor.focus();
    })();
  });
}
