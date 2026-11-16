// Insert > Interactive video...: the dialog for the things that happen at moments in a video (interactivevideo.ts): questions, hotspots, chapters and choices.
// It lists what the chosen video has, takes any of it away, and adds more. A native <dialog>, like the others: focus moves in, Tab stays inside, Escape closes
// it. Every field is a labelled box and every choice a real control, so it is all reached and read by keyboard and screen reader; what each press did is said in
// a status line. The Model does the work (addVideoMoment, removeVideoMoment), each one undo step; this file only asks and says.

import type { Model } from "./model.ts";
import { formatTime, MOMENT_WORDS, parseChapters, parseTime, type Moment, type MomentKind, type VideoMomentSpec } from "./interactivevideo.ts";

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

const KINDS: { kind: MomentKind; label: string; about: string }[] = [
  { kind: "question", label: "A question", about: "A multiple choice question over the picture at a time. The video waits until it is answered and the learner presses Continue." },
  { kind: "hotspot", label: "A hotspot", about: "A part of the picture that can be pressed for a few seconds. Pressing it pauses the video and shows a note; Close plays it again." },
  { kind: "chapter", label: "Chapters", about: "A row of buttons under the video. Each moves the video to its time and plays it. Setting chapters again replaces the old ones." },
  { kind: "choice", label: "A choice", about: "Ways to go on, each a slide: at a time (the video waits while the learner chooses) or when the video ends." },
];

/** What the existing chapter buttons say, one per line, to start the chapters box from. */
export function chapterLines(m: Model, videoId: string): string {
  const slide = m.slide;
  if (!slide) return "";
  const lines = slide.baseLayer.objects
    .filter((o) => o.name.startsWith("Chapter: ") && o.triggers.some((t) => t.action === "seekMedia" && t.target === videoId))
    .map((o) => o.name.slice("Chapter: ".length));
  return lines.join("\n");
}

const momentLine = (x: Moment): string => `${MOMENT_WORDS[x.kind]}${x.kind === "chapter" ? "s" : ""} ${x.atMs === null ? "when the video ends" : `at ${formatTime(x.atMs)}`}${x.kind === "chapter" || x.label === MOMENT_WORDS[x.kind] ? "" : `: ${x.label}`}`;

/** Open the dialog for a video on the slide being edited. Resolves when it is closed. */
export function openInteractiveVideo(m: Model, videoId: string, announce: (message: string) => void): Promise<void> {
  return new Promise((resolve) => {
    const video = m.slide?.baseLayer.objects.find((o) => o.id === videoId);
    const dialog = h("dialog", { class: "dialog wide iv-dialog", "aria-labelledby": "iv-title", "aria-describedby": "iv-intro" });
    const status = h("p", { class: "note", role: "status", "aria-live": "polite" });
    const list = h("ul", { class: "iv-list", "aria-labelledby": "iv-list-h" });
    const form = h("form", { method: "dialog" });
    const say = (text: string) => { status.textContent = text; announce(text); };
    const finish = () => { dialog.close(); dialog.remove(); resolve(); };

    const renderList = () => {
      const moments = m.videoMoments(videoId);
      list.replaceChildren(...(moments.length === 0 ? [h("li", { class: "note", text: "Nothing yet. Add a question, a hotspot, chapters or a choice below." })] : moments.map((x) => {
        const remove = h("button", { type: "button", text: "Remove", "aria-label": `Remove ${momentLine(x)}` });
        remove.addEventListener("click", () => {
          const said = m.removeVideoMoment(videoId, x.tag);
          say(said ?? "That is not there any more.");
          renderList();
          (list.querySelector("button") ?? addButton).focus();
        });
        return h("li", {}, h("span", { text: `${momentLine(x)} ` }), remove);
      })));
    };

    // The kind to add, and a box of fields for each, one shown at a time.
    const picked = { kind: "question" as MomentKind };
    const fields = h("div", { class: "iv-fields" });
    const kindBox = h("fieldset", {}, h("legend", { text: "What to add" }));
    const aboutLine = h("p", { class: "note", id: "iv-about" });
    const radios = KINDS.map((k, i) => {
      const input = h("input", { type: "radio", name: "iv-kind", id: `iv-kind-${k.kind}`, value: k.kind, ...(i === 0 ? { checked: true } : {}) });
      input.addEventListener("change", () => { picked.kind = k.kind; draw(); });
      kindBox.append(h("div", { class: "field check" }, input, h("label", { for: `iv-kind-${k.kind}`, text: k.label })));
      return input;
    });

    const text = (id: string, label: string, value = "", hint = ""): { row: HTMLElement; input: HTMLInputElement } => {
      const input = h("input", { type: "text", id, ...(hint ? { "aria-describedby": `${id}-hint` } : {}) });
      input.value = value;
      return { row: h("div", { class: "field" }, h("label", { for: id, text: label }), input, ...(hint ? [h("p", { class: "note", id: `${id}-hint`, text: hint })] : [])), input };
    };
    const area = (id: string, label: string, value = "", hint = "", rows = 4): { row: HTMLElement; input: HTMLTextAreaElement } => {
      const input = h("textarea", { id, rows: String(rows), ...(hint ? { "aria-describedby": `${id}-hint` } : {}) });
      input.value = value;
      return { row: h("div", { class: "field" }, h("label", { for: id, text: label }), input, ...(hint ? [h("p", { class: "note", id: `${id}-hint`, text: hint })] : [])), input };
    };
    const number = (id: string, label: string, value: string): { row: HTMLElement; input: HTMLInputElement } => {
      const input = h("input", { type: "number", id, min: "0", max: "100", step: "1" });
      input.value = value;
      return { row: h("div", { class: "field" }, h("label", { for: id, text: label }), input), input };
    };

    let submit: () => { spec: VideoMomentSpec | null; problem: string | null } = () => ({ spec: null, problem: null });

    const draw = () => {
      aboutLine.textContent = KINDS.find((k) => k.kind === picked.kind)!.about;
      fields.replaceChildren();
      if (picked.kind === "question") {
        const at = text("iv-at", "Time the question comes in", "", "Minutes and seconds, such as 1:20, or seconds, such as 80.");
        const q = text("iv-q", "The question");
        const a = area("iv-answers", "The answers, one on each line", "", "Two to six. The first line is answer 1.", 5);
        const right = number("iv-right", "Which answer is right (its number, from 1)", "1");
        right.input.removeAttribute("max");
        right.input.min = "1";
        const good = text("iv-good", "Said after a right answer (optional)");
        const bad = text("iv-bad", "Said after a wrong answer (optional)");
        fields.append(at.row, q.row, a.row, right.row, good.row, bad.row);
        submit = () => {
          const when = parseTime(at.input.value);
          if (when === null) return { spec: null, problem: "Give the time as minutes and seconds, such as 1:20, within the hour." };
          const answers = a.input.value.split(/\r?\n/).map((x) => x.trim()).filter((x) => x !== "");
          return { spec: { kind: "question", atMs: when, question: q.input.value, answers, correct: Number(right.input.value) - 1, right: good.input.value, wrong: bad.input.value }, problem: null };
        };
      } else if (picked.kind === "hotspot") {
        const at = text("iv-at", "Time the hotspot comes in", "", "Minutes and seconds, such as 0:08.");
        const forS = number("iv-for", "How many seconds it stays (at least 1)", "6");
        forS.input.min = "1";
        forS.input.removeAttribute("max");
        const label = text("iv-label", "Its name", "", "What a screen reader says. Say what pressing it shows.");
        const note = area("iv-note", "What pressing it shows", "", "", 3);
        const left = number("iv-x", "Left edge, percent across the picture", "40");
        const top = number("iv-y", "Top edge, percent down the picture", "30");
        const wide = number("iv-w", "Width, percent of the picture (at least 5)", "20");
        const high = number("iv-hh", "Height, percent of the picture (at least 5)", "25");
        fields.append(at.row, forS.row, label.row, note.row, left.row, top.row, wide.row, high.row,
          h("p", { class: "note", text: "A hotspot goes when its time is up, so a learner who needs longer may miss it. The Problems list says so. Give it a good few seconds." }));
        submit = () => {
          const when = parseTime(at.input.value);
          if (when === null) return { spec: null, problem: "Give the time as minutes and seconds, such as 0:08, within the hour." };
          return { spec: { kind: "hotspot", atMs: when, forMs: Math.round(Number(forS.input.value) * 1000), label: label.input.value, text: note.input.value, x: Number(left.input.value), y: Number(top.input.value), w: Number(wide.input.value), h: Number(high.input.value) }, problem: null };
        };
      } else if (picked.kind === "chapter") {
        const chapters = area("iv-chapters", "Chapters, one on each line", chapterLines(m, videoId), "A time, then the title: 0:00 Introduction. At least two. Leave it empty and press Add to take the chapters away.", 6);
        fields.append(chapters.row);
        submit = () => {
          if (chapters.input.value.trim() === "") {
            const existing = m.videoMoments(videoId).find((x) => x.kind === "chapter");
            return { spec: null, problem: existing ? `__remove:${existing.tag}` : "Write the chapters, a time and a title on each line." };
          }
          const read = parseChapters(chapters.input.value);
          return { spec: { kind: "chapter", ...read }, problem: null };
        };
      } else {
        const slides = m.slides;
        const when = h("div", { class: "field" });
        const atTime = h("input", { type: "radio", name: "iv-when", id: "iv-when-time", checked: true });
        const atEnd = h("input", { type: "radio", name: "iv-when", id: "iv-when-end" });
        const at = text("iv-at", "Time the choice comes in", "", "Minutes and seconds, such as 0:30. Used when it comes in at a time.");
        when.append(h("div", { class: "field check" }, atTime, h("label", { for: "iv-when-time", text: "At a time" })), h("div", { class: "field check" }, atEnd, h("label", { for: "iv-when-end", text: "When the video ends" })));
        const prompt = text("iv-prompt", "What the learner is asked");
        const rows = [0, 1, 2, 3].map((i) => {
          const label = text(`iv-c${i}`, `Way ${i + 1}${i < 2 ? "" : " (optional)"}`);
          const where = h("select", { id: `iv-s${i}` });
          for (const s of slides) where.append(h("option", { value: s.id, text: s.name }));
          where.selectedIndex = Math.min(i + 1, slides.length - 1);
          return { label, where, row: h("div", { class: "field" }, label.row, h("label", { for: `iv-s${i}`, text: `Slide for way ${i + 1}` }), where) };
        });
        fields.append(when, at.row, prompt.row, ...rows.map((r) => r.row));
        submit = () => {
          const end = atEnd.checked;
          const time = end ? null : parseTime(at.input.value);
          if (!end && time === null) return { spec: null, problem: "Give the time as minutes and seconds, such as 0:30, or choose when the video ends." };
          return { spec: { kind: "choice", atMs: time, prompt: prompt.input.value, choices: rows.map((r) => ({ label: r.label.input.value, slideId: r.where.value })).filter((c) => c.label.trim() !== "") }, problem: null };
        };
      }
    };

    const add = h("button", { type: "submit", text: "Add" });
    const addButton = add;
    add.addEventListener("click", (e) => {
      e.preventDefault();
      const { spec, problem } = submit();
      if (problem?.startsWith("__remove:")) { say(m.removeVideoMoment(videoId, problem.slice("__remove:".length)) ?? ""); renderList(); draw(); return; }
      if (!spec) { say(problem ?? "Fill in the fields first."); return; }
      const result = m.addVideoMoment(videoId, spec);
      say(result.message);
      if (result.ok) { renderList(); draw(); }
    });
    const done = h("button", { type: "button", text: "Done" });
    done.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });
    form.addEventListener("submit", (e) => e.preventDefault());

    form.append(
      h("h2", { id: "iv-title", text: `Interactive video: ${video?.name ?? "video"}` }),
      h("p", { id: "iv-intro", class: "note", text: "Things that happen at moments in the video, made of ordinary objects tied to its time, so each can be changed on the slide afterwards. The learner can always play the video again with its own controls. Add a time as minutes and seconds, such as 1:20." }),
      h("h3", { id: "iv-list-h", text: "What the video has" }), list,
      h("h3", { text: "Add" }), kindBox, aboutLine, fields, status,
      h("div", { class: "dialog-actions" }, add, done),
    );
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    renderList();
    draw();
    dialog.showModal();
    radios[0]?.focus();
  });
}
