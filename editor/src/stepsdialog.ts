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
  addManual, clampBox, deleteStep, editStep, knowPicture, mergeWithNext, moveStep, nudgeBox, serializeSteps, splitStep, stepProblems, unreviewedCount, type Box, type Step, type StepKind, type StepList,
} from "./steps.ts";
import { readStepSource, type StepSource } from "./stepsource.ts";
import { PictureGrabber, pictureName, screenPath } from "./steppicture.ts";
import type { StepPicture } from "./stepslides.ts";
import { LESSON_WORDS, type Lesson } from "./steplessons.ts";

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
  /** The ids of the steps of this recording that already have a slide in the course, in a lesson. */
  haveSlides: (lesson: Lesson) => ReadonlySet<string>;
  /** Make the slides of a lesson for the steps, with the pictures (by step id) that were taken and saved. Returns what to tell the author. */
  makeSlides: (lesson: Lesson, steps: Step[], pictures: Map<string, StepPicture>) => string;
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
    let busy = false;
    /** What to tell the editor when this window closes: the words about the slides, if any were made. */
    let madeWords = "";
    const undo: StepList[] = [];
    const folder = recordingFolder(b, opts.dir, opts.name);
    const grabber = new PictureGrabber(async (take) => {
      const file = source?.screens[take];
      return file === undefined ? undefined : folder.mediaUrl(screenPath(take, file));
    });
    /** The pictures shown in the list, as addresses the window can show, by step id. */
    const shown = new Map<string, string>();
    /** The boxes on the pictures that are showing, so a box can be moved without drawing the list again. */
    const boxViews = new Map<string, { frame: HTMLElement; box: HTMLElement | null; fields: HTMLInputElement[] }>();
    let lastBoxRemember = 0;

    const dialog = h("dialog", { class: "dialog wide steps-dialog", "aria-labelledby": "st-title" });
    const status = h("p", { id: "st-status", role: "status" });
    const speak = (...messages: string[]) => { status.textContent = messages.filter((m) => m !== "").join(" "); };
    const notes = h("ul", { id: "st-notes", class: "rc-list", "aria-label": "About where the steps come from" });
    const summary = h("p", { id: "st-summary", class: "note" });
    const listEl = h("div", { id: "st-list" });
    const addBtn = h("button", { type: "button", id: "st-add", text: "Add a step by hand" });
    const undoBtn = h("button", { type: "button", id: "st-undo", text: "Undo the last change to the list" });
    const again = h("button", { type: "button", id: "st-again", text: "Start again from what I did while recording" });
    const lessonSel = h("select", { id: "st-lesson" }, ...(["watch", "practice", "test"] as const).map((l) => h("option", { value: l, text: LESSON_WORDS[l].name })));
    const lessonNote = h("p", { id: "st-lesson-note", class: "note" });
    const make = h("button", { type: "button", id: "st-make", text: "Make the lesson: one slide for each step" });
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

    const stepById = (id: string): Step | undefined => list.steps.find((x) => x.id === id);
    const percent = (n: number): string => `${Math.round(n * 10) / 10}`;

    /** What the box on a step's picture says about itself, for the label a screen reader reads when it is reached. */
    const boxWords = (i: number, b: Box): string =>
      `Place to point at on the picture of step ${i + 1}: ${percent(b.x)} percent from the left, ${percent(b.y)} percent from the top, ${percent(b.width)} percent wide and ${percent(b.height)} percent high. The arrow keys move it; Shift with the arrow keys makes it wider or taller; Control makes each press five times as big.`;

    /** Move or resize a step's box, in place. A run of small moves is one undo step. */
    function setBox(stepId: string, i: number, box: Box | null, say?: string): void {
      const now = Date.now();
      if (now - lastBoxRemember > 800) { remember(); lastBoxRemember = now; }
      dirty = true;
      list = editStep(list, stepId, { box });
      const view = boxViews.get(stepId);
      const b2 = stepById(stepId)?.box ?? null;
      if (view !== undefined && view.box !== null && b2 !== null) {
        Object.assign(view.box.style, { left: `${b2.x}%`, top: `${b2.y}%`, width: `${b2.width}%`, height: `${b2.height}%` });
        view.box.setAttribute("aria-label", boxWords(i, b2));
        [b2.x, b2.y, b2.width, b2.height].forEach((v, k) => { const f = view.fields[k]; if (f !== undefined) f.value = String(v); });
      }
      if (say !== undefined) speak(say);
    }

    /** The picture of a step, with its box, drawn from what is already taken. */
    function renderPicture(holder: HTMLElement, i: number, stepId: string): void {
      const s = stepById(stepId);
      const url = shown.get(stepId);
      boxViews.delete(stepId);
      if (s === undefined || url === undefined) { holder.replaceChildren(); return; }
      const img = h("img", { class: "step-picture", src: url, alt: "" });
      const frame = h("div", { class: "step-frame", role: "group", "aria-label": `Picture of step ${i + 1}${s.box === null ? "" : ", with the place to point at marked"}. It is for people who can see the screen; the description above is what a screen reader says.` }, img);
      let boxEl: HTMLElement | null = null;
      const fields: HTMLInputElement[] = [];
      if (s.box !== null) {
        const bx = s.box;
        boxEl = h("div", { class: "step-box", tabindex: "0", role: "group", "aria-label": boxWords(i, bx) });
        Object.assign(boxEl.style, { left: `${bx.x}%`, top: `${bx.y}%`, width: `${bx.width}%`, height: `${bx.height}%` });
        const el = boxEl;
        el.addEventListener("keydown", (e) => {
          const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
          const d = moves[e.key];
          const now = stepById(stepId)?.box;
          if (d === undefined || now === null || now === undefined) return;
          e.preventDefault();
          const big = e.ctrlKey ? 5 : 1;
          const next = nudgeBox(now, d[0] * big, d[1] * big, e.shiftKey);
          setBox(stepId, i, next, `${e.shiftKey ? "Now" : "Moved to"} ${percent(next.x)} percent from the left, ${percent(next.y)} from the top, ${percent(next.width)} wide, ${percent(next.height)} high.`);
        });
        // The mouse: drag the box, or press anywhere else on the picture to put the box's middle there.
        el.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          const rect = frame.getBoundingClientRect();
          const start = stepById(stepId)?.box;
          if (start === null || start === undefined || rect.width === 0) return;
          el.setPointerCapture(e.pointerId);
          el.focus();
          const x0 = e.clientX;
          const y0 = e.clientY;
          const move = (m: PointerEvent): void => setBox(stepId, i, clampBox({ ...start, x: start.x + ((m.clientX - x0) / rect.width) * 100, y: start.y + ((m.clientY - y0) / rect.height) * 100 }));
          const up = (): void => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
          el.addEventListener("pointermove", move);
          el.addEventListener("pointerup", up);
        });
        frame.append(boxEl);
      }
      frame.addEventListener("pointerdown", (e) => {
        const rect = frame.getBoundingClientRect();
        const now = stepById(stepId)?.box;
        if (now === null || now === undefined || rect.width === 0) return;
        const next = clampBox({ ...now, x: ((e.clientX - rect.left) / rect.width) * 100 - now.width / 2, y: ((e.clientY - rect.top) / rect.height) * 100 - now.height / 2 });
        setBox(stepId, i, next, `Moved the place to point at to ${percent(next.x)} percent from the left and ${percent(next.y)} from the top.`);
      });
      const controls: HTMLElement[] = [];
      if (s.box === null) {
        const mark = h("button", { type: "button", id: `st-${i}-mark`, text: "Mark a place to point at", "aria-label": `Mark a place to point at on the picture of step ${i + 1}` });
        mark.addEventListener("click", () => { setBox(stepId, i, { x: 40, y: 40, width: 20, height: 12 }, "Marked a place in the middle of the picture. Move and resize it."); renderPicture(holder, i, stepId); holder.querySelector<HTMLElement>(".step-box")?.focus(); });
        controls.push(h("div", { class: "btn-row" }, mark));
      } else {
        const names = ["Left (percent)", "Top (percent)", "Width (percent)", "Height (percent)"];
        const vals = [s.box.x, s.box.y, s.box.width, s.box.height];
        const inputs = names.map((label, k) => {
          const input = h("input", { type: "text", id: `st-${i}-box-${k}`, size: "6", inputmode: "decimal", value: String(vals[k]) });
          fields.push(input);
          input.addEventListener("change", () => {
            const cur = stepById(stepId)?.box;
            const v = Number(input.value.replace(",", "."));
            if (cur === null || cur === undefined) return;
            if (!Number.isFinite(v)) { speak("Write a number of percent, for example 12.5."); input.value = String([cur.x, cur.y, cur.width, cur.height][k] ?? 0); return; }
            const next = clampBox(k === 0 ? { ...cur, x: v } : k === 1 ? { ...cur, y: v } : k === 2 ? { ...cur, width: v } : { ...cur, height: v });
            setBox(stepId, i, next, `The place to point at is ${percent(next.x)} percent from the left, ${percent(next.y)} from the top, ${percent(next.width)} wide and ${percent(next.height)} high.`);
          });
          return h("div", { class: "field" }, h("label", { for: `st-${i}-box-${k}`, text: label }), input);
        });
        const remove = h("button", { type: "button", id: `st-${i}-unmark`, text: "Take the mark off", "aria-label": `Take the mark off the picture of step ${i + 1}` });
        remove.addEventListener("click", () => { setBox(stepId, i, null, "The mark is off. The slide will show the picture with nothing marked."); renderPicture(holder, i, stepId); });
        controls.push(h("fieldset", {}, h("legend", { text: `Place to point at, step ${i + 1}` }), ...inputs, h("div", { class: "btn-row" }, remove)));
      }
      boxViews.set(stepId, { frame, box: boxEl, fields });
      holder.replaceChildren(frame, ...controls);
    }

    /** Take the picture of a step from its recording and show it. Nothing is saved in the course until the slides are made. */
    async function showPicture(stepId: string, i: number): Promise<void> {
      const s = stepById(stepId);
      if (s === undefined || busy) return;
      speak(`Taking the picture of step ${i + 1}.`);
      try {
        const frame = await grabber.grab(s.take, s.shotMs);
        const old = shown.get(stepId);
        if (old !== undefined) URL.revokeObjectURL(old);
        shown.set(stepId, URL.createObjectURL(frame.blob));
        list = knowPicture(list, stepId, { width: frame.sourceWidth, height: frame.sourceHeight });
        dirty = true;
        const holder = listEl.querySelector<HTMLElement>(`[data-picture="${stepId}"]`);
        if (holder !== null) renderPicture(holder, i, stepId);
        speak(`Showing the picture of step ${i + 1}, taken ${(s.shotMs / 1000).toFixed(1)} seconds into take ${s.take}.${stepById(stepId)?.box === null ? " It has no place marked." : ""}`);
      } catch (err) {
        speak(errorText(err));
      }
    }

    function pictureBlock(i: number, s: Step): HTMLElement {
      const holder = h("div", { class: "step-picture-holder", "data-picture": s.id });
      const showBtn = h("button", { type: "button", id: `st-${i}-show`, text: shown.has(s.id) ? "Take the picture again" : "Show the picture", "aria-label": `${shown.has(s.id) ? "Take the picture again for" : "Show the picture of"} step ${i + 1}` });
      showBtn.addEventListener("click", () => void showPicture(s.id, i));
      if (shown.has(s.id)) renderPicture(holder, i, s.id);
      return h("div", { class: "step-picture-block" }, h("div", { class: "btn-row" }, showBtn), holder);
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
          if (shown.has(s.id)) void showPicture(s.id, i);
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
        // For typing: what was typed is the answer that Practice and Test accept, so it can be corrected here, apart from the words the learner reads.
        const typed = s.kind === "type" ? h("input", { type: "text", id: id("typed"), value: s.typed ?? "", maxlength: "200" }) : null;
        typed?.addEventListener("change", () => { change(editStep(list, s.id, { typed: typed.value })); refresh(); });
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
          ...(typed === null ? [] : [h("div", { class: "field" }, h("label", { for: id("typed"), text: "What was typed (the answer Practice and Test accept)" }), typed)]),
          h("div", { class: "field" }, h("label", { for: id("alt"), text: "Description of the picture" }), alt),
          h("p", { id: id("altnote"), class: "note", text: "Said by a screen reader instead of the picture. It is used in the course only once you have checked the step." }),
          h("div", { class: "field" }, h("label", { for: id("shot"), text: "Picture taken at (seconds into the take)" }), shot),
          pictureBlock(i, s),
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
      if (busy) { speak("The slides are being made. Wait until that is finished, then close this window."); return; }
      if (dirty && !(await b.confirm("You have changes that are not saved. Close and lose them?"))) return;
      for (const url of shown.values()) URL.revokeObjectURL(url);
      shown.clear();
      grabber.close();
      folder.release();
      dialog.close();
      dialog.remove();
      resolve(madeWords);
    }

    /** Write the steps into the recording. Says why in words if it cannot, and says whether it did. */
    async function persist(): Promise<boolean> {
      try {
        await b.recordingWriteSteps(opts.dir, opts.name, serializeSteps(list));
        dirty = false;
        return true;
      } catch (err) {
        speak(`The steps could not be saved. ${errorText(err)}`);
        return false;
      }
    }

    /** One picture for each step that has no slide yet, taken and saved in the course, then the slides. All or nothing: a picture that cannot be taken stops it. */
    async function makeSlides(): Promise<void> {
      if (busy) { speak("The slides are already being made. Wait until that is finished."); return; }
      if (list.steps.length === 0) { speak("There are no steps to make slides from."); return; }
      const empty = list.steps.findIndex((s) => s.text.trim() === "");
      if (empty >= 0) { speak(`Step ${empty + 1} has no words yet. A slide needs them, so write them first.`); rows[empty]?.text.focus(); return; }
      busy = true;
      try {
        if (dirty && !(await persist())) return;
        const lesson = lessonSel.value as Lesson;
        const have = opts.haveSlides(lesson);
        const todo = list.steps.filter((s) => !have.has(s.id));
        const pictures = new Map<string, StepPicture>();
        let n = 0;
        for (const s of todo) {
          n++;
          speak(`Taking picture ${n} of ${todo.length}.`);
          const frame = await grabber.grab(s.take, s.shotMs);
          list = knowPicture(list, s.id, { width: frame.sourceWidth, height: frame.sourceHeight });
          const path = await b.saveStepPicture(opts.dir, pictureName(opts.name, s.id), new Uint8Array(await frame.blob.arrayBuffer()));
          pictures.set(s.id, { path, width: frame.width, height: frame.height });
        }
        // Learning a picture's size can give a step its box, so what is kept matches what the slides were made from.
        if (!(await persist())) return;
        madeWords = opts.makeSlides(lesson, list.steps, pictures);
        speak(madeWords);
      } catch (err) {
        speak(`The slides could not be made. ${errorText(err)}`);
      } finally {
        busy = false;
        draw();
        make.focus();
      }
    }

    async function saveSteps(): Promise<void> {
      if (await persist()) {
        const problems = stepProblems(list);
        speak(`Saved ${list.steps.length} ${list.steps.length === 1 ? "step" : "steps"} in ${opts.name.replace(/\.capture$/, "")}.${problems.length > 0 ? ` ${problems.length === 1 ? "One thing" : `${problems.length} things`} still need${problems.length === 1 ? "s" : ""} you: ${problems[0]}` : ""}`);
      }
    }

    const LESSON_NOTES: Record<Lesson, string> = {
      watch: "Watch: the learner sees each step. A slide has the step's number, its words (with a voice that says them), its picture, and a frame round the place to point at.",
      practice: "Practice: the learner tries each step. For a click, they press the place in the picture, or Tab to it and press Enter or Space. Anywhere else counts a try and gives a hint; after three tries, or at once with Show me, the place is outlined. For typing, they type what you typed, in a question worth no points. A step with nothing to press (a key, a change of program, a marker, a click with no place marked) is shown as in Watch.",
      test: "Test: the learner is scored. For a click, a question asks where to click, among some other areas of the picture, with one try and no hints. For typing, a short answer with one try. The score is the course's quiz score. Add a results box after the last question to show it. A step with nothing to test is shown as in Watch.",
    };
    const showLessonNote = (): void => { lessonNote.textContent = LESSON_NOTES[lessonSel.value as Lesson]; };
    lessonSel.addEventListener("change", showLessonNote);
    showLessonNote();
    save.addEventListener("click", () => void saveSteps());
    make.addEventListener("click", () => void makeSlides());
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
      h("section", { "aria-labelledby": "st-make-title" },
        h("h3", { id: "st-make-title", text: "Make a lesson from the steps" }),
        h("div", { class: "field" }, h("label", { for: "st-lesson", text: "Lesson" }), lessonSel),
        lessonNote,
        h("p", { class: "note", text: "The slides are put after the slide you are on in the course. A picture's description is used only for a step you have checked; for the others the Problems panel will ask you for it. A step that already has a slide in this lesson is left alone. Your steps are saved first. Close this window afterwards to see the slides." }),
        h("div", { class: "dialog-actions" }, make)),
      h("div", { class: "dialog-actions" }, save, close),
    );
    document.body.appendChild(dialog);
    dialog.showModal();
    summary.textContent = "Reading the recording.";

    void (async () => {
      const r = await readStepSource(folder);
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
