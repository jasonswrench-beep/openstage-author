// Questions as the learner sees them. Every kind is built from real form controls (radio buttons, checkboxes, text boxes, drop-down lists,
// buttons), so a keyboard and a screen reader work with it as they would anywhere. Where a question can also be answered by dragging
// (dragging words into blanks, items onto their matches, items into order), the controls are still the real way to answer: dragging is
// an extra layer put on top of them in dragging.ts, which changes the same controls.
//
// What a question knows how to do is the same for every kind (see QuestionView): give its answer in the form grading.ts reads, take an
// earlier answer back, and stop taking changes. The "Check answer" button, the feedback layers and the scoring are the stage's and the
// runtime's, and are the same for every kind.

import { attachDrag, insertIndexFor, reorder } from "./dragging.ts";
import { t, tn } from "./playertext.ts";
import { countWords, decodeBlanks, decodePairs, encodeBlanks, encodePairs, matchOptions, splitBlanks, stableShuffle } from "./grading.ts";
import { readPassage } from "./passage.ts";
import { formatShortcut, isModifierKey, shortcutOf } from "./shortcut.ts";
import type { ChoiceQuiz, EssayQuiz, FillBlanksQuiz, HotspotQuiz, MatchingQuiz, NumericQuiz, OSObject, QuizContent, SequencingQuiz, ShortAnswerQuiz, ShortcutQuiz, WhichWordQuiz } from "./types.ts";

export interface QuestionContext {
  /** In the editor the question is drawn but nothing in it responds. */
  editing: boolean;
  /** A message for a screen reader. */
  announce?: (message: string) => void;
  /** The learner's own number for shuffling, as text. A question that shuffles its answers does so only when there is one: the editor has none, so the author sees their own order. */
  seed?: string;
}

export interface QuestionView {
  /** The whole question: the box that goes on the stage. */
  el: HTMLElement;
  /** What the learner has answered, in the form grading.ts reads, or null if nothing has been answered yet. */
  answer(): string | null;
  /** Show an answer given earlier, for a learner who has come back. */
  setAnswer(answer: string): void;
  /** The question is finished: its controls no longer change. */
  lock(): void;
}

type Parts = Omit<QuestionView, "el"> & { group: HTMLElement };

function make(doc: Document, tag: string, cls = "", attrs: Record<string, string> = {}): HTMLElement {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

const input = (doc: Document, type: string, cls: string, attrs: Record<string, string> = {}): HTMLInputElement => make(doc, "input", cls, { type, ...attrs }) as HTMLInputElement;

/** A name no other control on the page shares, so labels point at the right thing. */
const uid = (obj: OSObject, part: string): string => `q-${obj.id}-${part}`;

/** Highlight the target, and nothing else of its kind, while something is dragged over it. */
function highlight(root: HTMLElement, target: HTMLElement | null, cls: string): void {
  root.querySelectorAll(`.${cls}`).forEach((x) => x.classList.remove(cls));
  target?.classList.add(cls);
}

// ---- multiple choice and multiple response

function buildChoice(doc: Document, obj: OSObject, q: ChoiceQuiz, ctx: QuestionContext): Parts {
  const multi = q.questionType === "multipleResponse";
  const group = make(doc, "div", "os-quiz-group", { role: multi ? "group" : "radiogroup", "aria-label": obj.accessibility.altText });
  if (multi) {
    const hint = make(doc, "p", "os-q-hint", { id: uid(obj, "hint") });
    hint.textContent = t("quiz.hintMulti");
    group.setAttribute("aria-describedby", hint.id);
    group.appendChild(hint);
  }
  const boxes: HTMLInputElement[] = [];
  // A different order for each learner, the same one every time that learner comes back. Grading goes by each answer's id, so the order changes nothing else.
  const shown = q.shuffle === true && !ctx.editing && ctx.seed !== undefined ? stableShuffle(q.choices, `${ctx.seed}:${obj.id}`) : q.choices;
  for (const c of shown) {
    const label = make(doc, "label", "os-choice");
    const box = input(doc, multi ? "checkbox" : "radio", "", { name: obj.id, value: c.id });
    label.append(box, doc.createTextNode(` ${c.label}`));
    group.appendChild(label);
    boxes.push(box);
  }
  return {
    group,
    answer: () => {
      const picked = boxes.filter((b) => b.checked).map((b) => b.value);
      return picked.length === 0 ? null : picked.join(",");
    },
    setAnswer: (a) => {
      const ids = new Set(a.split(","));
      for (const b of boxes) b.checked = ids.has(b.value);
    },
    lock: () => boxes.forEach((b) => (b.disabled = true)),
  };
}

// ---- a typed answer and a typed number

function buildTyped(doc: Document, obj: OSObject, q: ShortAnswerQuiz | NumericQuiz): Parts {
  const group = make(doc, "div", "os-q-typed", { role: "group", "aria-label": obj.accessibility.altText });
  const id = uid(obj, "answer");
  const label = make(doc, "label", "os-q-label", { for: id });
  label.textContent = q.questionType === "numeric" ? t("quiz.yourAnswerNumber") : t("quiz.yourAnswer");
  // A number is typed as text, because the browser's own number box refuses a comma and says things in its own words.
  const box = input(doc, "text", "os-q-input", { id, autocomplete: "off", spellcheck: "false", autocapitalize: "off", ...(q.questionType === "numeric" ? { inputmode: "decimal" } : {}) });
  group.append(label, box);
  return {
    group,
    answer: () => (box.value.trim() === "" ? null : box.value),
    setAnswer: (a) => (box.value = a),
    lock: () => (box.disabled = true),
  };
}

// ---- fill in the blanks: typed, from a drop-down, or by dragging words

/** The words a drop-down or a word bank offers, in an order that is the same every time and does not give the answer away. */
export const bankOf = (q: FillBlanksQuiz, obj: OSObject): string[] => stableShuffle(q.wordBank, obj.id);

function buildBlanks(doc: Document, obj: OSObject, q: FillBlanksQuiz, ctx: QuestionContext): Parts {
  const typed = q.mode === "typed";
  const group = make(doc, "div", "os-q-blanks", { role: "group", "aria-label": obj.accessibility.altText });
  const sentence = make(doc, "p", "os-q-sentence");
  const known = new Map(q.blanks.map((b, i) => [b.id, { blank: b, n: i + 1 }]));
  const fields = new Map<string, HTMLInputElement | HTMLSelectElement>();
  const words = bankOf(q, obj);
  for (const part of splitBlanks(q.text)) {
    if (part.type === "text") {
      sentence.appendChild(doc.createTextNode(part.value));
      continue;
    }
    const hit = known.get(part.id);
    if (!hit) {
      sentence.appendChild(doc.createTextNode(`{${part.id}}`));
      continue;
    }
    const name = t("quiz.blankName", { n: hit.n, total: q.blanks.length });
    let field: HTMLInputElement | HTMLSelectElement;
    if (typed) {
      const longest = Math.max(0, ...hit.blank.answers.map((a) => a.length));
      field = input(doc, "text", "os-q-blank", { "aria-label": name, size: String(Math.min(30, Math.max(6, longest + 2))), autocomplete: "off", spellcheck: "false", autocapitalize: "off" });
    } else {
      const select = make(doc, "select", "os-q-blank", { "aria-label": name }) as HTMLSelectElement;
      select.appendChild(Object.assign(make(doc, "option"), { value: "", textContent: t("quiz.chooseWord") }));
      for (const w of words) select.appendChild(Object.assign(make(doc, "option"), { value: w, textContent: w }));
      field = select;
    }
    fields.set(part.id, field);
    sentence.appendChild(field);
  }
  group.appendChild(sentence);
  if (q.mode === "drag") {
    // The words to drag. They only repeat what the lists in the blanks offer, so they are hidden from assistive technology.
    const bank = make(doc, "div", "os-q-bank", { "aria-hidden": "true" });
    const title = make(doc, "span", "os-q-bank-label");
    title.textContent = t("quiz.wordBank");
    bank.appendChild(title);
    for (const w of words) bank.appendChild(Object.assign(make(doc, "span", "os-chip", { "data-word": w }), { textContent: w }));
    const hint = make(doc, "p", "os-q-hint");
    hint.textContent = t("quiz.dragWordHint");
    group.append(bank, hint);
  }
  const values = (): string[] => q.blanks.map((b) => fields.get(b.id)?.value ?? "");
  const markUsed = (): void => {
    const used = new Set(values().filter((v) => v !== ""));
    group.querySelectorAll<HTMLElement>(".os-chip").forEach((chip) => chip.classList.toggle("is-used", used.has(chip.dataset["word"] ?? "")));
  };
  for (const f of fields.values()) f.addEventListener("change", markUsed);
  if (q.mode === "drag" && !ctx.editing) {
    // Dragging a word onto a blank chooses that word in the blank's own list, so the list is always what holds the answer.
    group.querySelectorAll<HTMLElement>(".os-chip").forEach((chip) => attachDrag({
      source: chip,
      target: (under) => {
        const field = under?.closest<HTMLElement>("select.os-q-blank") ?? null;
        return field && !(field as HTMLSelectElement).disabled ? field : null;
      },
      over: (t) => highlight(group, t, "is-target"),
      drop: (t) => {
        const word = chip.dataset["word"] ?? "";
        const select = t as HTMLSelectElement | null;
        if (!select || ![...select.options].some((o) => o.value === word)) return;
        select.value = word;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      },
    }));
  }
  return {
    group,
    answer: () => (values().every((v) => v.trim() === "") ? null : encodeBlanks(values())),
    setAnswer: (a) => {
      decodeBlanks(a, q.blanks.length).forEach((v, i) => {
        const f = fields.get(q.blanks[i]!.id);
        if (f) f.value = v;
      });
      markUsed();
    },
    lock: () => fields.forEach((f) => (f.disabled = true)),
  };
}

// ---- matching

function buildMatching(doc: Document, obj: OSObject, q: MatchingQuiz, ctx: QuestionContext): Parts {
  const group = make(doc, "div", "os-q-matching", { role: "group", "aria-label": obj.accessibility.altText });
  const hint = make(doc, "p", "os-q-hint");
  hint.textContent = t("quiz.matchHint");
  group.appendChild(hint);
  const options = stableShuffle(matchOptions(q), obj.id);
  const selects = new Map<string, HTMLSelectElement>();
  for (const pair of q.pairs) {
    const row = make(doc, "div", "os-q-row");
    const premise = make(doc, "span", "os-q-premise", { id: uid(obj, `item-${pair.id}`) });
    premise.textContent = pair.premise;
    const select = make(doc, "select", "os-q-match", { "aria-labelledby": premise.id, "data-pair": pair.id }) as HTMLSelectElement;
    select.appendChild(Object.assign(make(doc, "option"), { value: "", textContent: t("quiz.chooseMatch") }));
    for (const o of options) select.appendChild(Object.assign(make(doc, "option"), { value: o.id, textContent: o.text }));
    selects.set(pair.id, select);
    row.append(premise, select);
    group.appendChild(row);
  }
  if (q.drag) {
    const bank = make(doc, "div", "os-q-bank", { "aria-hidden": "true" });
    for (const o of options) bank.appendChild(Object.assign(make(doc, "span", "os-chip", { "data-option": o.id }), { textContent: o.text }));
    const dragHint = make(doc, "p", "os-q-hint");
    dragHint.textContent = t("quiz.dragMatchHint");
    group.append(bank, dragHint);
  }
  const chosen = (): Record<string, string> => Object.fromEntries([...selects].map(([id, s]) => [id, s.value]));
  const markUsed = (): void => {
    const used = new Set(Object.values(chosen()).filter((v) => v !== ""));
    group.querySelectorAll<HTMLElement>(".os-chip").forEach((chip) => chip.classList.toggle("is-used", used.has(chip.dataset["option"] ?? "")));
  };
  for (const s of selects.values()) s.addEventListener("change", markUsed);
  if (q.drag && !ctx.editing) {
    // Dragging a match onto an item chooses it in the item's own list.
    group.querySelectorAll<HTMLElement>(".os-chip").forEach((chip) => attachDrag({
      source: chip,
      target: (under) => {
        const select = under?.closest<HTMLElement>(".os-q-row")?.querySelector<HTMLSelectElement>("select") ?? null;
        return select && !select.disabled ? select : null;
      },
      over: (t) => highlight(group, t, "is-target"),
      drop: (t) => {
        const select = t as HTMLSelectElement | null;
        if (!select) return;
        select.value = chip.dataset["option"] ?? "";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      },
    }));
  }
  return {
    group,
    answer: () => {
      const a = encodePairs(chosen());
      return a === "" ? null : a;
    },
    setAnswer: (a) => {
      const pairs = decodePairs(a);
      for (const [id, s] of selects) s.value = pairs[id] ?? "";
      markUsed();
    },
    lock: () => selects.forEach((s) => (s.disabled = true)),
  };
}

// ---- sequencing

function buildSequence(doc: Document, obj: OSObject, q: SequencingQuiz, ctx: QuestionContext): Parts {
  const group = make(doc, "div", "os-q-sequencing", { role: "group", "aria-label": obj.accessibility.altText });
  const hint = make(doc, "p", "os-q-hint");
  hint.textContent = t("quiz.orderHint");
  const list = make(doc, "ol", "os-q-sequence");
  group.append(hint, list);
  const text = (id: string): string => q.items.find((i) => i.id === id)?.text ?? "";
  let order = stableShuffle(q.items.map((i) => i.id), obj.id);
  let locked = false;

  const draw = (): void => {
    list.replaceChildren(...order.map((id, i) => {
      const li = make(doc, "li", "os-q-seq-item", { "data-item": id });
      const words = make(doc, "span", "os-q-seq-text");
      words.textContent = text(id);
      const up = make(doc, "button", "os-q-move", { type: "button", "aria-label": t("quiz.moveUpNamed", { item: text(id) }), "data-move": `${id}:-1` });
      up.textContent = t("quiz.moveUp");
      const down = make(doc, "button", "os-q-move", { type: "button", "aria-label": t("quiz.moveDownNamed", { item: text(id) }), "data-move": `${id}:1` });
      down.textContent = t("quiz.moveDown");
      if (locked || i === 0) up.setAttribute("aria-disabled", "true");
      if (locked || i === order.length - 1) down.setAttribute("aria-disabled", "true");
      if (!ctx.editing) {
        up.addEventListener("click", () => move(id, -1));
        down.addEventListener("click", () => move(id, 1));
      }
      if (q.drag && !ctx.editing && !locked) {
        // A grip for a mouse or a finger. The buttons are the way for everyone else, so the grip is hidden from assistive technology.
        const grip = make(doc, "span", "os-q-grip", { "aria-hidden": "true" });
        grip.textContent = "\u22ee\u22ee";
        attachDrag({
          source: grip,
          ghost: false,
          target: (under) => under?.closest<HTMLElement>("li.os-q-seq-item") ?? null,
          over: (t) => highlight(list, t, "is-over"),
          state: (on) => li.classList.toggle("is-dragging", on),
          drop: (_t, pointer) => {
            const others = [...list.querySelectorAll<HTMLElement>("li.os-q-seq-item")].filter((x) => x !== li);
            const mids = others.map((x) => { const r = x.getBoundingClientRect(); return r.top + r.height / 2; });
            list.dispatchEvent(new CustomEvent("os-reorder", { detail: { id, to: insertIndexFor(mids, pointer.y) } }));
          },
        });
        li.prepend(grip);
      }
      li.append(words, up, down);
      return li;
    }));
  };
  /** Move an item one place, say where it is now, and keep the focus on the button that was pressed. */
  const move = (id: string, by: -1 | 1): void => {
    const at = order.indexOf(id);
    const to = at + by;
    if (locked || at === -1 || to < 0 || to >= order.length) return;
    [order[at], order[to]] = [order[to]!, order[at]!];
    draw();
    list.querySelector<HTMLElement>(`[data-move="${id}:${by}"]`)?.focus();
    ctx.announce?.(t("quiz.nowNumber", { item: text(id), n: to + 1, total: order.length }));
  };
  // Dragging an item gives the place it was dropped at; the order is changed here, in one place, whichever way it was asked for.
  list.addEventListener("os-reorder", (e) => {
    const { id, to } = (e as CustomEvent<{ id: string; to: number }>).detail;
    const next = reorder(order, id, to);
    if (locked || next.join() === order.join()) return;
    order = next;
    draw();
    ctx.announce?.(t("quiz.nowNumber", { item: text(id), n: order.indexOf(id) + 1, total: order.length }));
  });
  draw();
  return {
    group,
    answer: () => order.join(","),
    setAnswer: (a) => {
      const ids = a.split(",");
      if (ids.length === order.length && [...order].every((id) => ids.includes(id))) {
        order = ids;
        draw();
      }
    },
    lock: () => {
      locked = true;
      draw();
    },
  };
}

// ---- hotspot

function buildHotspot(doc: Document, obj: OSObject, q: HotspotQuiz, ctx: QuestionContext): Parts {
  const group = make(doc, "div", "os-q-hotspot", { role: "group", "aria-label": obj.accessibility.altText });
  const picture = make(doc, "div", "os-q-picture");
  const img = make(doc, "img", "os-q-image", { alt: q.image.alt }) as HTMLImageElement;
  img.src = q.image.src;
  picture.appendChild(img);

  const fieldset = make(doc, "fieldset", "os-q-areas");
  const legend = make(doc, "legend");
  legend.textContent = t("quiz.chooseArea");
  const list = make(doc, "div", "os-q-area-list");
  fieldset.append(legend, list);
  const radios: HTMLInputElement[] = [];
  const areas = new Map<string, HTMLElement>();
  for (const r of q.regions) {
    // The area on the picture is for the mouse and touch. The list is the way to answer with a keyboard or a screen reader.
    const area = make(doc, "button", "os-q-area", { type: "button", tabindex: "-1", "aria-hidden": "true", "data-area": r.id });
    area.style.left = `${r.x}%`;
    area.style.top = `${r.y}%`;
    area.style.width = `${r.width}%`;
    area.style.height = `${r.height}%`;
    // On the editor's canvas the areas are shown, dashed for a wrong one and solid for a right one, so the author can see where they are.
    if (ctx.editing) {
      area.classList.add("is-shown");
      area.dataset["correct"] = String(r.correct);
      area.textContent = r.label;
    }
    picture.appendChild(area);
    areas.set(r.id, area);
    const label = make(doc, "label", "os-choice");
    const radio = input(doc, "radio", "", { name: obj.id, value: r.id });
    label.append(radio, doc.createTextNode(` ${r.label}`));
    list.appendChild(label);
    radios.push(radio);
  }
  const sync = (): void => areas.forEach((area, id) => area.classList.toggle("is-chosen", radios.some((r) => r.checked && r.value === id)));
  if (!ctx.editing) {
    radios.forEach((r) => r.addEventListener("change", sync));
    areas.forEach((area, id) => area.addEventListener("click", () => {
      const radio = radios.find((r) => r.value === id);
      if (!radio || radio.disabled) return;
      radio.checked = true;
      sync();
    }));
  }
  group.append(picture, fieldset);
  return {
    group,
    answer: () => radios.find((r) => r.checked)?.value ?? null,
    setAnswer: (a) => {
      for (const r of radios) r.checked = r.value === a;
      sync();
    },
    lock: () => {
      radios.forEach((r) => (r.disabled = true));
      areas.forEach((area) => area.setAttribute("aria-disabled", "true"));
    },
  };
}

// ---- an essay

function buildEssay(doc: Document, obj: OSObject, q: EssayQuiz, ctx: QuestionContext): Parts {
  const group = make(doc, "div", "os-q-typed os-q-essay", { role: "group", "aria-label": obj.accessibility.altText });
  const id = uid(obj, "answer");
  const label = make(doc, "label", "os-q-label", { for: id });
  label.textContent = t("quiz.yourAnswer");
  const box = make(doc, "textarea", "os-q-essay-input", { id, rows: "8", autocomplete: "off" }) as HTMLTextAreaElement;
  // The count is plain text a screen reader reads when the box is focused. It is not a live region: announcing every word as it is typed would talk over the typing.
  const count = make(doc, "p", "os-q-count", { id: uid(obj, "count") });
  const describedBy = [count.id];
  const parts: HTMLElement[] = [label];
  if (q.minWords > 0) {
    const need = make(doc, "p", "os-q-hint", { id: uid(obj, "need") });
    need.textContent = tn("quiz.essayMinimum", q.minWords);
    describedBy.unshift(need.id);
    parts.push(need);
  }
  box.setAttribute("aria-describedby", describedBy.join(" "));
  const update = (): void => { count.textContent = tn("quiz.wordCount", countWords(box.value)); };
  update();
  if (!ctx.editing) box.addEventListener("input", update);
  group.append(...parts, box, count);
  return {
    group,
    answer: () => (box.value.trim() === "" ? null : box.value),
    setAnswer: (a) => { box.value = a; update(); },
    // Read-only, not disabled: a locked answer can still be focused, read and moved through.
    lock: () => { box.readOnly = true; },
  };
}

// ---- which word

function buildWhichWord(doc: Document, obj: OSObject, q: WhichWordQuiz, ctx: QuestionContext): Parts {
  const group = make(doc, "div", "os-q-whichword", { role: "group", "aria-label": obj.accessibility.altText });
  const read = readPassage(q.passage);
  const text = make(doc, "p", "os-q-passage");
  const spans = new Map<string, HTMLElement>();
  for (const piece of read.pieces) {
    if (piece.type === "text") {
      text.appendChild(doc.createTextNode(piece.value));
      continue;
    }
    // The words are for the mouse and touch, and a screen reader reads them as plain text. The list below is the way to answer with a keyboard or a screen reader.
    const span = make(doc, "span", "os-q-word", { "data-word": piece.id });
    span.textContent = piece.value;
    if (ctx.editing && read.words.find((w) => w.id === piece.id)?.right) span.classList.add("is-right");
    text.appendChild(span);
    spans.set(piece.id, span);
  }
  const id = uid(obj, "word");
  const label = make(doc, "label", "os-q-label", { for: id });
  label.textContent = t("quiz.wordList");
  const select = make(doc, "select", "os-q-select", { id }) as HTMLSelectElement;
  select.appendChild(make(doc, "option", "", { value: "" }));
  // A word that comes more than once is told apart by its place, so the list never has two options that sound the same.
  const times = new Map<string, number>();
  for (const w of read.words) times.set(w.text.toLowerCase(), (times.get(w.text.toLowerCase()) ?? 0) + 1);
  read.words.forEach((w, i) => {
    const option = make(doc, "option", "", { value: w.id });
    option.textContent = (times.get(w.text.toLowerCase()) ?? 0) > 1 ? t("quiz.wordPlace", { word: w.text, n: i + 1 }) : w.text;
    select.appendChild(option);
  });
  const show = (): void => spans.forEach((span, wordId) => span.classList.toggle("is-chosen", select.value === wordId));
  if (!ctx.editing) {
    select.addEventListener("change", show);
    spans.forEach((span, wordId) => span.addEventListener("click", () => {
      if (select.disabled) return;
      select.value = wordId;
      show();
    }));
  }
  const choose = make(doc, "div", "os-q-choose");
  choose.append(label, select);
  group.append(text, choose);
  return {
    group,
    answer: () => (select.value === "" ? null : select.value),
    setAnswer: (a) => { select.value = spans.has(a) ? a : ""; show(); },
    lock: () => {
      select.disabled = true;
      spans.forEach((span) => span.setAttribute("aria-disabled", "true"));
    },
  };
}

// ---- a keyboard shortcut

function buildShortcut(doc: Document, obj: OSObject, _q: ShortcutQuiz, ctx: QuestionContext): Parts {
  const group = make(doc, "div", "os-q-typed os-q-shortcut", { role: "group", "aria-label": obj.accessibility.altText });
  const id = uid(obj, "answer");
  const label = make(doc, "label", "os-q-label", { for: id });
  label.textContent = t("quiz.yourShortcut");
  const hint = make(doc, "p", "os-q-hint", { id: uid(obj, "hint") });
  hint.textContent = t("quiz.shortcutHint");
  const box = input(doc, "text", "os-q-input", { id, autocomplete: "off", spellcheck: "false", autocapitalize: "off", "aria-describedby": hint.id });
  const capture = make(doc, "button", "os-q-capture", { type: "button" }) as HTMLButtonElement;
  capture.textContent = t("quiz.captureKeys");
  group.append(label, hint, box, capture);

  // While capturing, the next key pressed with the button focused is the answer, and then the button goes back to being a button. It cannot trap anyone:
  // any one key ends it (Tab included, which is then the answer, not a way out), Escape alone stops it without an answer, and leaving the button stops it.
  let capturing = false;
  const stop = (message?: string): void => {
    capturing = false;
    capture.textContent = t("quiz.captureKeys");
    capture.removeAttribute("aria-pressed");
    if (message) ctx.announce?.(message);
  };
  if (!ctx.editing) {
    capture.addEventListener("click", () => {
      if (capturing) return stop(t("quiz.captureStopped"));
      capturing = true;
      capture.textContent = t("quiz.capturing");
      capture.setAttribute("aria-pressed", "true");
      ctx.announce?.(t("quiz.capturing"));
    });
    capture.addEventListener("blur", () => { if (capturing) stop(); });
    capture.addEventListener("keydown", (e) => {
      if (!capturing) return;
      // Modifiers on their own are only the start of the shortcut. Any other key is the answer, so it does nothing else.
      if (isModifierKey(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return stop(t("quiz.captureStopped"));
      const pressed = shortcutOf(e);
      if (pressed === null) return stop(t("quiz.captureUnknown"));
      box.value = formatShortcut(pressed);
      stop(t("quiz.captured", { keys: box.value }));
    });
  }
  return {
    group,
    answer: () => (box.value.trim() === "" ? null : box.value),
    setAnswer: (a) => { box.value = a; },
    lock: () => {
      box.disabled = true;
      capture.disabled = true;
    },
  };
}

// ---- the question

/** Build the question for an object. The "Check answer" button is added by whoever puts it on the stage. */
export function buildQuestion(doc: Document, obj: OSObject, ctx: QuestionContext): QuestionView {
  const q = obj.content as unknown as QuizContent;
  const box = make(doc, "div", "os-quiz");
  let parts: Parts;
  switch (q.questionType) {
    case "multipleChoice":
    case "multipleResponse": parts = buildChoice(doc, obj, q, ctx); break;
    case "shortAnswer":
    case "numeric": parts = buildTyped(doc, obj, q); break;
    case "fillBlanks": parts = buildBlanks(doc, obj, q, ctx); break;
    case "matching": parts = buildMatching(doc, obj, q, ctx); break;
    case "sequencing": parts = buildSequence(doc, obj, q, ctx); break;
    case "hotspot": parts = buildHotspot(doc, obj, q, ctx); break;
    case "essay": parts = buildEssay(doc, obj, q, ctx); break;
    case "whichWord": parts = buildWhichWord(doc, obj, q, ctx); break;
    case "shortcut": parts = buildShortcut(doc, obj, q, ctx); break;
  }
  box.appendChild(parts.group);
  return { el: box, answer: parts.answer, setAnswer: parts.setAnswer, lock: parts.lock };
}
