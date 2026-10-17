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
import { backupName, libraryOf, readProject } from "../../capture-timeline/src/project.ts";
import { EditSession } from "../../capture-timeline/src/session.ts";
import type { Backend } from "./backend.ts";
import { runOneShot } from "./capturecontroller.ts";
import { applyExportLine, exportPlan, initialExport, summariseExport, type ExportPlan, type ExportState } from "./captureexport.ts";
import { extrasFromEdit, type Extra } from "./captions.ts";
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
  /** Start a new edit of the newest take, not the edit saved before (the old one is kept as a copy when the new one is saved). */
  newestTake?: boolean;
  /**
   * Put a video that is already in the course's assets on the slide the author is on. Returns what to tell them. `facts` is what the edit knows that
   * the editor needs to write the video's transcript: what is on the screen that the voice does not say, and how long the video is.
   */
  placeVideo: (assetPath: string, facts: { extras: Extra[]; lengthMs: number }) => string;
  /** Open the captions dialog for the video that was just put on the slide. */
  writeCaptions: () => Promise<string>;
  /** Add what the recording shows on its screen to the video that was just put on the slide, as audio descriptions with a voice. Returns what to tell them. */
  describeScreen: (extras: Extra[]) => string;
}

/** Turn on when the Rust video maker reads edit format 0.4 and draws transitions (see ROADMAP.md). Until then a video is not attempted for an edit that has one. */
export const VIDEO_MAKER_DRAWS_TRANSITIONS = false;

/** The longest an export may run before it is stopped. A long recording takes a while; this is only a safety net. */
export const EXPORT_LIMIT_MS = 4 * 60 * 60 * 1000;

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
    // ---- making a video from the edit
    const make = h("button", { type: "button", text: "Make a video from this edit" });
    const reduce = h("input", { type: "checkbox", id: "re-reduce" });
    const cancelVideo = h("button", { type: "button", text: "Cancel the video", hidden: true });
    const progress = h("progress", { id: "re-progress", max: "100", value: "0", hidden: true, "aria-labelledby": "re-export-say" });
    const exportSay = h("p", { id: "re-export-say", role: "status" });
    const exportNotes = h("ul", { class: "rc-list", "aria-label": "What the recorder said about the video" });
    const place = h("button", { type: "button", text: "Put the video on the current slide" });
    const reveal = h("button", { type: "button", text: "Show the video in its folder" });
    const captionsBtn = h("button", { type: "button", text: "Write captions for the video", hidden: true });
    const describeBtn = h("button", { type: "button", text: "Describe what is on the screen", hidden: true });
    const madeRow = h("div", { class: "dialog-actions", hidden: true }, place, captionsBtn, describeBtn, reveal);
    const exportBox = h("section", { "aria-labelledby": "re-export-title", hidden: true },
      h("h3", { id: "re-export-title", text: "The video" }), progress, exportSay, exportNotes, madeRow);
    dialog.append(
      heading,
      h("p", { class: "note", text: "Your changes are saved as a list of what to keep and what to add. The recording itself, its picture and its sound, is never changed. Press F6 to move between the preview, the timeline and the clip list." }),
      h("div", { class: "dialog-actions" }, save, make, cancelVideo, close),
      h("p", {}, reduce, " ", h("label", { for: "re-reduce", text: "Use cuts instead of animated zooms in the video (kinder to anyone bothered by movement)" })),
      state, exportBox, host,
    );
    document.body.appendChild(dialog);
    dialog.showModal();

    const folder = recordingFolder(b, opts.dir, opts.name);
    let session: EditSession | undefined;
    let editor: ReturnType<typeof mountEditor> | undefined;
    /** The saved edit that a new edit of the newest take replaces, until it has been copied aside. */
    let toKeep: { text: string; name: string } | undefined;

    const showState = () => {
      if (session === undefined) return;
      state.textContent = session.dirty ? "There are changes that are not saved." : "There are no unsaved changes.";
    };

    async function saveEdit(): Promise<void> {
      if (session === undefined || editor === undefined) return;
      try {
        if (toKeep !== undefined) {
          if (!(await folder.writeText(toKeep.name, toKeep.text))) {
            editor.announce(`The edit saved before could not be copied to ${toKeep.name}, so nothing was saved and nothing was changed on the disk.`);
            return;
          }
          toKeep = undefined;
        }
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

    let exporting = false;
    let plan: ExportPlan | null = null;
    let made = false;
    /** What the edit knew when the video was made (the edit may be changed after), for the video's transcript. */
    let facts: { extras: Extra[]; lengthMs: number } = { extras: [], lengthMs: 0 };

    function drawNotes(state: ExportState): void {
      exportNotes.replaceChildren(...state.notes.map((n) => h("li", {}, h("strong", { class: n.ok ? "rc-pass" : "rc-problem", text: n.ok ? "Note. " : "Problem. " }), h("span", { text: n.text }))));
    }

    /** Make the video from the saved edit. The edit is saved first, because the recorder reads edit.json. */
    async function makeVideo(): Promise<void> {
      if (session === undefined || exporting) return;
      if (session.dirty) {
        await saveEdit();
        if (session.dirty) { exportBox.hidden = false; exportSay.textContent = "The edit could not be saved, so no video was made."; return; }
      }
      if (!VIDEO_MAKER_DRAWS_TRANSITIONS && session.model.tracks.some((t) => t.clips.some((c) => c.transitionIn !== undefined || c.transitionOut !== undefined))) {
        exportBox.hidden = false;
        exportSay.textContent = "No video was made. This edit has a transition, and the program that makes the video cannot draw transitions yet. Take the transitions off, or wait for the next update of the recorder. Nothing in the edit was changed.";
        return;
      }
      exporting = true;
      made = false;
      captionsBtn.hidden = true;
      describeBtn.hidden = true;
      facts = { extras: extrasFromEdit(session.model), lengthMs: modelLengthMs(session.model) };
      plan = exportPlan(opts.dir, opts.name, { reduceMotion: reduce.checked });
      let state = initialExport();
      exportBox.hidden = false;
      madeRow.hidden = true;
      exportNotes.replaceChildren();
      progress.hidden = false;
      progress.value = 0;
      make.setAttribute("aria-disabled", "true");
      cancelVideo.hidden = false;
      exportSay.textContent = "Making the video. This can take a while for a long recording. You can keep editing, but the video is made from the edit as it was saved.";
      const job = await runOneShot(b, plan.args, (line) => {
        const u = applyExportLine(state, line);
        state = u.state;
        progress.value = state.percent;
        if (u.say.length > 0) exportSay.textContent = u.say.join(" ");
        drawNotes(state);
      }, EXPORT_LIMIT_MS);
      exporting = false;
      make.removeAttribute("aria-disabled");
      cancelVideo.hidden = true;
      progress.hidden = true;
      const summary = summariseExport(state, job.exit);
      exportSay.textContent = job.problem === "" ? summary.sentence : `${summary.sentence} ${job.problem}`;
      drawNotes(state);
      made = state.made && job.exit?.code === 0;
      madeRow.hidden = !made;
      if (made) place.focus();
    }

    /** Copy the video into the course, then put it on the slide. */
    async function putOnSlide(): Promise<void> {
      if (plan === null || !made) return;
      try {
        exportSay.textContent = opts.placeVideo(await b.importAsset(opts.dir, plan.out, "video"), facts);
        captionsBtn.hidden = false;
        describeBtn.hidden = facts.extras.length === 0;
      } catch (err) {
        exportSay.textContent = `The video could not be put in the course. ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    async function finish(): Promise<void> {
      if (exporting && !(await b.confirm("The video is still being made. Stop it and close?"))) return;
      if (exporting) await b.streamStop().catch(() => false);
      if (session?.dirty === true && !(await b.confirm("You have changes to this edit that are not saved. Close and lose them?"))) return;
      editor?.destroy();
      folder.release();
      dialog.close();
      dialog.remove();
      resolve();
    }

    save.addEventListener("click", () => void saveEdit());
    make.addEventListener("click", () => { if (make.getAttribute("aria-disabled") !== "true") void makeVideo(); });
    cancelVideo.addEventListener("click", () => { exportSay.textContent = "Cancelling the video."; void b.streamStop().catch(() => false); });
    place.addEventListener("click", () => void putOnSlide());
    describeBtn.addEventListener("click", () => { exportSay.textContent = opts.describeScreen(facts.extras); });
    captionsBtn.addEventListener("click", () => void opts.writeCaptions().then((said) => { if (said !== "") exportSay.textContent = said; captionsBtn.focus(); }));
    reveal.addEventListener("click", () => { if (plan !== null) void b.revealInFolder(plan.out).catch((err: unknown) => { exportSay.textContent = `Could not show the folder. ${err instanceof Error ? err.message : String(err)}`; }); });
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

    /** Ask which edit to open, when takes were recorded after the saved edit. Resolves to true for a new edit of the newest take. */
    function askWhich(newest: number, title: string): Promise<boolean> {
      return new Promise((done) => {
        const keep = h("button", { type: "button", text: "Open my saved edit" });
        const fresh = h("button", { type: "button", text: `Start a new edit of the newest recording (take ${newest})` });
        const box = h("section", { "aria-labelledby": "re-ask-title" },
          h("h3", { id: "re-ask-title", tabindex: "-1", text: "Which edit do you want?" }),
          h("p", { text: `${title} has a recording made after the edit you saved. Your saved edit is the older one. If you start a new edit of the newest recording, your saved edit is kept: it is copied to ${backupName(newest)} when you first save the new one.` }),
          h("div", { class: "dialog-actions" }, keep, fresh));
        host.replaceChildren(box);
        state.textContent = "Choose which edit to open, or press Close to leave.";
        keep.focus();
        const finish = (value: boolean) => { box.remove(); done(value); };
        keep.addEventListener("click", () => finish(false));
        fresh.addEventListener("click", () => finish(true));
      });
    }

    void (async () => {
      let result = await readProject(folder, opts.newestTake === true ? { newestTakeOnly: true } : {});
      const unused = result.ok ? result.project.unusedTakes : undefined;
      if (result.ok && unused !== undefined && unused[0] !== undefined) {
        if (await askWhich(unused[0], result.project.title)) result = await readProject(folder, { newestTakeOnly: true });
      }
      if (!result.ok) {
        state.textContent = result.message;
        save.hidden = true;
        make.hidden = true;
        close.focus();
        return;
      }
      const { project } = result;
      heading.textContent = `Edit the recording: ${project.title}`;
      if (project.replacedEdit !== undefined && project.newestTake !== undefined) toKeep = { text: project.replacedEdit, name: backupName(project.newestTake) };
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
