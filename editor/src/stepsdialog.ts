// The steps dialog: review the steps made from a recording, and keep them.
//
// What counts as a step, and what the author can do to the list (change the words, merge, split, delete, move), is in steps.ts, which has no
// screen and is tested alone; what the steps are made from is read by stepsource.ts. This dialog is where an author uses them. Every step is a
// labelled group of fields, so the review list has a plain reading order and works by keyboard alone (story E1). The words and the picture
// description are PROPOSED from what the author did while recording, and a step's picture description is used in a course only once the author
// has ticked "I have checked" for that step: the editor never puts its own guess in a course as the author's words.
//
// A native <dialog>, so focus moves in, Tab stays inside, Escape closes it (after asking, if there are changes), and focus returns to the button
// that opened it.

import { errorText, type Backend } from "./backend.ts";
import { recordingFolder } from "./recordingfolder.ts";
import {
  addManual, deleteStep, editStep, mergeWithNext, moveStep, serializeSteps, splitStep, stepProblems, unreviewedCount, type Step, type StepKind, type StepList,
} from "./steps.ts";
import { readStepSource, type StepSource } from "./stepsource.ts";

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

export interface StepsOptions {
  backend: Backend;
  /** The open course's folder. */
  dir: string;
  /** The recording's folder name, such as `Week 3.capture`. */
  name: string;
}

/** `1:05.3`: a moment in a take, for a sentence. */
function clock(ms: number): string {
  const tenths = Math.round(ms / 100);
  const m = Math.floor(tenths / 600);
  const s = (tenths - m * 600) / 10;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

const KIND_WORDS: Record<StepKind, string> = {
  click: "A click", type: "Typing", key: "A key press", window: "A change of program", marker: "Your marker", manual: "A step you added",
};

function whereWords(s: Step): string {
  const merged = s.from !== undefined ? ` Made by merging ${s.from.length} steps.` : "";
  return `${KIND_WORDS[s.kind]}, ${clock(s.atMs)} into take ${s.take}.${merged}`;
}

/** Resolves when the dialog is closed, with what the editor should say (empty if nothing was saved). */
export function openSteps(opts: StepsOptions): Promise<string> {
  const b = opts.backend;
  return new Promise((resolve) => {
    let list: StepList = { format: "openstage-capture-steps", schemaVersion: "0.1.0", nextId: 1, steps: [] };
    let source: StepSource | null = null;
    let dirty = false;
    const undo: StepList[] = [];

    const dialog = h("dialog", { class: "dialog wide steps-dialog", "aria-labelledby": "st-title" });
    const status = h("p", { id: "st-status", role: "status" });
    const speak = (...messages: string[]) => { status.textContent = messages.filter((m) => m !== "").join(" "); };
    const notes = h("ul", { id: "st-notes", class: "rc-list", "aria-label": "About where the steps come from" });
    const summary = h("p", { id: "st-summary", class: "note" });
    const listEl = h("div", { id: "st-list" });
    const addBtn = h("button", { type: "button", id: "st-add", text: "Add a step by hand" });
    const undoBtn = h("button", { type: "button", id: "st-undo", text: "Undo the last change to the list" });
    const again = h("button", { type: "button", id: "st-again", text: "Start again from what I did while recording" });
    const save = h("button", { type: "button", id: "st-save", text: "Save the steps" });
    const close = h("button", { type: "button", id: "st-close", text: "Close" });

    const rows: { text: HTMLTextAreaElement; alt: HTMLTextAreaElement; shot: HTMLInputElement; reviewed: HTMLInputElement }[] = [];

    function remember(): void {
      undo.push(list);
      if (undo.length > 40) undo.shift();
      dirty = true;
    }
    function change(next: StepList): void {
      remember();
      list = next;
    }

    function refresh(): void {
      const n = list.steps.length;
      const todo = unreviewedCount(list);
      summary.textContent = n === 0
        ? "There are no steps yet. Add one by hand, or record again with OpenScreen noting the mouse."
        : `${n} ${n === 1 ? "step" : "steps"}. ${todo === 0 ? "Every step has been checked." : `${todo} ${todo === 1 ? "has" : "have"} not been checked: the picture description of a step is used in a course only once you have checked it.`}`;
      undoBtn.toggleAttribute("disabled", undo.length === 0);
    }

    function draw(focus?: { id: string; part: "text" | "move-up" | "move-down" | "merge" | "split" } | "add"): void {
      rows.length = 0;
      const n = list.steps.length;
      listEl.replaceChildren(...list.steps.map((s, i) => {
        const id = (part: string) => `st-${i}-${part}`;
        const text = h("textarea", { id: id("text"), rows: "2" });
        text.value = s.text;
        text.addEventListener("input", () => { list = editStep(list, s.id, { text: text.value }); dirty = true; });
        const alt = h("textarea", { id: id("alt"), rows: "2", "aria-describedby": id("altnote") });
        alt.value = s.alt;
        alt.addEventListener("input", () => { list = editStep(list, s.id, { alt: alt.value }); dirty = true; });
        const shot = h("input", { type: "text", id: id("shot"), size: "8", inputmode: "decimal", value: String(Math.round(s.shotMs) / 1000) });
        shot.addEventListener("change", () => {
          const seconds = Number(shot.value.replace(",", "."));
          if (!Number.isFinite(seconds) || seconds < 0) { speak("Write the time in seconds from the start of the take, for example 12 or 12.5."); shot.value = String(Math.round(s.shotMs) / 1000); return; }
          change(editStep(list, s.id, { shotMs: Math.round(seconds * 1000) }));
          refresh();
        });
        const reviewed = h("input", { type: "checkbox", id: id("reviewed") });
        reviewed.checked = s.reviewed;
        reviewed.addEventListener("change", () => {
          list = editStep(list, s.id, { reviewed: reviewed.checked });
          dirty = true;
          refresh();
          speak(reviewed.checked ? `Step ${i + 1} is checked.` : `Step ${i + 1} is not checked.`);
        });
        rows.push({ text, alt, shot, reviewed });
        const button = (label: string, aria: string, part: "move-up" | "move-down" | "merge" | "split" | "delete", fn: () => void): HTMLButtonElement => {
          const btn = h("button", { type: "button", text: label, "aria-label": aria, "data-part": part });
          btn.addEventListener("click", fn);
          return btn;
        };
        const up = button("Move up", `Move step ${i + 1} up`, "move-up", () => { change(moveStep(list, s.id, -1)); draw({ id: s.id, part: "move-up" }); speak(`Step moved up. It is now step ${i}.`); });
        const down = button("Move down", `Move step ${i + 1} down`, "move-down", () => { change(moveStep(list, s.id, 1)); draw({ id: s.id, part: "move-down" }); speak(`Step moved down. It is now step ${i + 2}.`); });
        up.toggleAttribute("disabled", i === 0);
        down.toggleAttribute("disabled", i === n - 1);
        const merge = button("Merge with the next step", `Merge step ${i + 1} with step ${i + 2}`, "merge", () => { change(mergeWithNext(list, s.id)); draw({ id: s.id, part: "merge" }); speak(`Steps ${i + 1} and ${i + 2} are now one step. It has to be checked again.`); });
        merge.toggleAttribute("disabled", i === n - 1);
        const merged = s.from !== undefined && s.from.length >= 2;
        const split = button(merged ? "Undo the merge" : "Split in two", merged ? `Undo the merge of step ${i + 1}` : `Split step ${i + 1} in two`, "split", () => {
          change(splitStep(list, s.id));
          draw({ id: s.id, part: "split" });
          speak(merged ? "The merge is undone." : `Split step ${i + 1} in two. The second has no words yet. Write them.`);
        });
        const del = button("Delete", `Delete step ${i + 1}`, "delete", () => {
          change(deleteStep(list, s.id));
          const next = list.steps[Math.min(i, list.steps.length - 1)];
          draw(next === undefined ? "add" : { id: next.id, part: "text" });
          speak(`Deleted step ${i + 1}. ${list.steps.length} left. You can undo it.`);
        });
        return h("fieldset", { class: "step-row" },
          h("legend", { text: `Step ${i + 1} of ${n}` }),
          h("p", { class: "note", text: whereWords(s) }),
          h("div", { class: "field" }, h("label", { for: id("text"), text: "Words the learner reads" }), text),
          h("div", { class: "field" }, h("label", { for: id("alt"), text: "Description of the picture" }), alt),
          h("p", { id: id("altnote"), class: "note", text: "Said by a screen reader instead of the picture. It is used in the course only once you have checked the step." }),
          h("div", { class: "field" }, h("label", { for: id("shot"), text: "Picture taken at (seconds into the take)" }), shot),
          h("div", { class: "field check" }, reviewed, h("label", { for: id("reviewed"), text: "I have checked the words and the picture description" })),
          h("div", { class: "btn-row" }, up, down, merge, split, del));
      }));
      refresh();
      if (focus === "add") addBtn.focus();
      else if (focus !== undefined) {
        const i = list.steps.findIndex((s) => s.id === focus.id);
        const target = i < 0 ? null : focus.part === "text" ? rows[i]?.text : listEl.querySelectorAll<HTMLElement>(".step-row")[i]?.querySelector<HTMLElement>(`button[data-part="${focus.part}"]:not([disabled])`);
        (target ?? addBtn).focus();
      }
    }

    addBtn.addEventListener("click", () => {
      const take = list.steps.at(-1)?.take ?? source?.takes[0] ?? 1;
      const at = list.steps.at(-1)?.atMs ?? 0;
      const next = addManual(list, { take, atMs: at });
      if (next === list) { speak("A recording may have at most 200 steps."); return; }
      change(next);
      draw({ id: next.steps.at(-1)!.id, part: "text" });
      speak(`Added step ${next.steps.length}. Write its words, and set the moment its picture is taken.`);
    });
    undoBtn.addEventListener("click", () => {
      const before = undo.pop();
      if (before === undefined) return;
      list = before;
      draw();
      speak(`Undone. ${list.steps.length} ${list.steps.length === 1 ? "step" : "steps"}.`);
      undoBtn.focus();
    });
    again.addEventListener("click", () => {
      void (async () => {
        if (source === null) return;
        if (list.steps.length > 0 && !(await b.confirm("This replaces the steps you have now with new ones made from what you did while recording. You can undo it. Go on?"))) return;
        change(source.proposed);
        draw();
        speak(`Made ${list.steps.length} ${list.steps.length === 1 ? "step" : "steps"} from what you did while recording.`);
      })();
    });

    async function finish(): Promise<void> {
      if (dirty && !(await b.confirm("You have changes that are not saved. Close and lose them?"))) return;
      dialog.close();
      dialog.remove();
      resolve("");
    }

    async function saveSteps(): Promise<void> {
      try {
        await b.recordingWriteSteps(opts.dir, opts.name, serializeSteps(list));
        dirty = false;
        const problems = stepProblems(list);
        speak(`Saved ${list.steps.length} ${list.steps.length === 1 ? "step" : "steps"} in ${opts.name.replace(/\.capture$/, "")}.${problems.length > 0 ? ` ${problems.length === 1 ? "One thing" : `${problems.length} things`} still need${problems.length === 1 ? "s" : ""} you: ${problems[0]}` : ""}`);
      } catch (err) {
        speak(`The steps could not be saved. ${errorText(err)}`);
      }
    }

    save.addEventListener("click", () => void saveSteps());
    close.addEventListener("click", () => void finish());
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); void finish(); });
    dialog.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveSteps();
      }
    });

    dialog.append(
      h("h2", { id: "st-title", text: `Steps from ${opts.name.replace(/\.capture$/, "")}` }),
      h("p", { class: "note", text: "A step is one thing the learner is shown: a click, some typing, a key, a change of program. They are proposed from what you did while OpenScreen was noting the mouse and keyboard. Read each one, change its words, merge, split, delete or move it, and tick that you have checked it. The steps are kept with the recording, and become slides in the next stage. Typed words come from your keys, so check them: they may be private." }),
      notes, summary, status,
      h("div", { class: "btn-row" }, addBtn, undoBtn, again),
      listEl,
      h("div", { class: "dialog-actions" }, save, close),
    );
    document.body.appendChild(dialog);
    dialog.showModal();
    summary.textContent = "Reading the recording.";

    void (async () => {
      const r = await readStepSource(recordingFolder(b, opts.dir, opts.name));
      if (!r.ok) {
        speak(r.message);
        summary.textContent = "";
        again.hidden = true;
        addBtn.hidden = true;
        undoBtn.hidden = true;
        save.hidden = true;
        close.focus();
        return;
      }
      source = r.source;
      notes.replaceChildren(...r.source.notes.map((t) => h("li", { text: t })));
      if (r.source.saved !== null) {
        list = r.source.saved;
        speak(`Opened the ${list.steps.length} ${list.steps.length === 1 ? "step" : "steps"} you saved.`);
      } else {
        list = r.source.proposed;
        dirty = list.steps.length > 0;
        speak(list.steps.length === 0 ? "There are no steps to propose from this recording." : `Made ${list.steps.length} ${list.steps.length === 1 ? "step" : "steps"} from what you did while recording. Nothing is saved until you press Save.`);
      }
      draw();
      (rows[0]?.text ?? addBtn).focus();
    })();
  });
}
