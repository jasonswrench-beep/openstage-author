// The Insert gallery (Insert > Find something to add..., and the first item of every Add menu): everything that can be added to a
// slide in one window, as in the spec's mockup A03, with a box to search them by name or by what they are for and a row of kinds to
// narrow them. Choosing one does exactly what choosing it from the menus and their pickers does, so nothing is lost and making it is
// still one step to undo; the gallery only saves the second step of finding it.
//
// Each choice is a real button with its name and one line about it. Focus starts in the search box; Down goes to the first choice;
// the arrow keys, Home and End move between choices, and Tab goes on to the kinds and to Cancel, so the window takes three presses of
// Tab to cross however many choices it shows. The kinds are radio buttons. The words under the box say how many are shown.
// The pure parts (the list and how a search narrows it) are at the top, so they can be tested without a page.

import { plain, scoreCommand } from "./commandsearch.ts";
import { INPUTS, INTERACTIONS, NAVIGATION_BUTTONS } from "./factory.ts";
import { el, uiIcon } from "./menubar.ts";
import { QUIZ_KINDS } from "./questionedit.ts";
import type { UiIconName } from "./uiicons.gen.ts";

export type GalleryKind = "basics" | "media" | "shapes" | "questions" | "interactions" | "course";

/** The kinds, in the order of the row above the choices. "all" comes first and is not a kind of its own. */
export const GALLERY_KINDS: readonly { id: GalleryKind; label: string; icon: UiIconName }[] = [
  { id: "basics", label: "Basics", icon: "type" },
  { id: "media", label: "Pictures and media", icon: "image" },
  { id: "shapes", label: "Shapes and bubbles", icon: "shapes" },
  { id: "questions", label: "Questions and surveys", icon: "circle-question-mark" },
  { id: "interactions", label: "Interactions", icon: "puzzle" },
  { id: "course", label: "Results and games", icon: "award" },
];

export interface GalleryItem {
  /** What the editor is asked to add: see App.addChosen. */
  value: string;
  label: string;
  /** All of what the pickers say about it; the card shows the first sentence, and a search reads it all. */
  description: string;
  kind: GalleryKind;
  /** The smaller group it belongs to in its picker, such as "Fill in the blanks" or "Surveys"; searched too. */
  group: string;
  icon: UiIconName;
}

const QUIZ_ICONS: Record<string, UiIconName> = {
  mc: "list-checks", tf: "circle-check", mr: "list-checks", short: "text-cursor-input", numeric: "hash", blanks: "pencil-line",
  dropdown: "chevron-down", dragwords: "move", matching: "link", dragdrop: "move", sequence: "list-ordered", essay: "file-text",
  shortcut: "keyboard", whichword: "mouse-pointer-click", hotspot: "locate",
};
const INPUT_ICONS: Record<string, UiIconName> = {
  character: "users", checkbox: "square-check", radio: "circle-dot", dropdown: "chevron-down", list: "list", text: "text-cursor-input",
  slider: "sliders-horizontal", dial: "gauge", likert: "chart-bar", semantic: "arrow-left-right",
};
const INTERACTION_ICONS: Record<string, UiIconName> = {
  clickReveal: "mouse-pointer-click", accordion: "chevrons-down-up", flipCards: "copy", tabs: "panel-top", steps: "footprints",
  carousel: "gallery-horizontal", glossary: "book-open-text", timeline: "chart-gantt", processCircle: "refresh-cw", pyramidStack: "triangle",
  pyramidMatrix: "layers-2", circleMatrix: "circle", labeledGraphic: "map-pin",
};
const SHAPE_ICONS: Record<string, UiIconName> = {
  rectangle: "square", rounded: "square", ellipse: "circle", triangle: "triangle", diamond: "diamond", arrow: "move-right", line: "minus",
};

/** The pictures and media, as the picker behind Insert > Image, video, audio or file... lists them. */
export const MEDIA_CHOICES: readonly { id: string; label: string; description: string; group: string; icon: UiIconName }[] = [
  { id: "image", label: "Image", description: "A picture from your computer.", group: "From your computer", icon: "image" },
  { id: "video", label: "Video file", description: "A video from your computer. It needs captions.", group: "From your computer", icon: "video" },
  { id: "audio", label: "Audio file", description: "A sound from your computer. It needs captions or a transcript.", group: "From your computer", icon: "volume-2" },
  { id: "download", label: "File to download", description: "A PDF, Word document or other file learners can save to their own device. You describe what it is, and confirm it is accessible.", group: "From your computer", icon: "download" },
  { id: "youtube", label: "YouTube video", description: "Plays from YouTube. You confirm the captions and add a transcript.", group: "From the web", icon: "monitor-play" },
  { id: "vimeo", label: "Vimeo video", description: "Plays from Vimeo. You confirm the captions and add a transcript.", group: "From the web", icon: "monitor-play" },
  { id: "person", label: "A person from the library", description: "A picture of a person from a character pack, waving, thinking, presenting. Its description becomes the alt text, for you to check.", group: "Assets", icon: "user-round" },
  { id: "icon", label: "Icon", description: "A simple line picture from the Lucide set, drawn in a colour you choose. Search by what it means.", group: "Assets", icon: "star" },
  { id: "library", label: "Browse the assets", description: "The project's own files, and stock images to add to it.", group: "Assets", icon: "images" },
];

/** Shapes and bubbles, with the words the shape picker uses. */
const SHAPES: readonly { id: string; label: string }[] = [
  { id: "rectangle", label: "Rectangle" }, { id: "rounded", label: "Rounded rectangle" }, { id: "ellipse", label: "Ellipse" },
  { id: "triangle", label: "Triangle" }, { id: "diamond", label: "Diamond" }, { id: "arrow", label: "Arrow" }, { id: "line", label: "Line" },
];
const BUBBLES: readonly { value: string; label: string; description: string; icon: UiIconName }[] = [
  { value: "bubble:text-speech", label: "Speech bubble, with words", description: "A speech bubble you type in, to say what someone is saying.", icon: "message-circle" },
  { value: "bubble:text-thought", label: "Thought bubble, with words", description: "A thought bubble you type in, to say what someone is thinking.", icon: "cloud" },
  { value: "bubble:shape-speech", label: "Speech bubble, empty", description: "A plain speech bubble with no words in it, to put your own words or a picture over.", icon: "message-circle" },
  { value: "bubble:shape-thought", label: "Thought bubble, empty", description: "A plain thought bubble with no words in it.", icon: "cloud" },
];

/** Everything the gallery offers, in the order of the kinds and, inside each, the order of the menus and pickers. */
export function galleryItems(): GalleryItem[] {
  const out: GalleryItem[] = [];
  const add = (kind: GalleryKind, group: string, value: string, label: string, description: string, icon: UiIconName) => out.push({ value, label, description, kind, group, icon });

  add("basics", "Text", "text", "Text box", "Words on the slide: a heading, a paragraph or a list. Edit them with Edit text (F2).", "type");
  add("basics", "Buttons", "button", "Button", "A button with words you write. Say what it does in the Rules box.", "square-mouse-pointer");
  for (const b of NAVIGATION_BUTTONS) add("basics", "Buttons", `nav:${b.id}`, `${b.label} button`, `Ready-made, already wired. ${b.description}`, b.icon.name as UiIconName);
  add("basics", "Buttons", "hotspot", "Hotspot (a clickable area)", "An area to press, laid over part of a picture. You name it, and add a rule for what pressing it does.", "square-dashed-mouse-pointer");
  add("basics", "Text", "content:table", "Table", "Rows and columns of text, with header cells a screen reader can announce.", "table");
  add("basics", "Text", "content:scrollingText", "Scrolling text", "A box of text that scrolls when it is long. The keyboard can scroll it.", "scroll-text");

  for (const m of MEDIA_CHOICES) add("media", m.group, `media:${m.id}`, m.label, m.description, m.icon);
  add("media", "Recordings", "record", "Screen recording", "Record the screen with the OpenStage recorder, and check that this computer is ready to record.", "circle-dot");

  for (const s of SHAPES) add("shapes", "Shapes", `shape:${s.id}`, s.label, `A ${s.label.toLowerCase()} shape, filled in the theme's colours.`, SHAPE_ICONS[s.id] ?? "shapes");
  for (const b of BUBBLES) add("shapes", "Speech and thought bubbles", b.value, b.label, b.description, b.icon);

  for (const k of QUIZ_KINDS) add("questions", `Quiz questions: ${k.group.toLowerCase()}`, `quiz:${k.id}`, k.label, k.description, QUIZ_ICONS[k.id] ?? "circle-question-mark");
  for (const i of INPUTS) add("questions", i.group === "Inputs" ? "Inputs that save a choice" : "Surveys", `input:${i.id}`, i.label, i.description, INPUT_ICONS[i.id] ?? "list");

  for (const i of INTERACTIONS) add("interactions", i.group, `interaction:${i.id}`, i.label, i.description, INTERACTION_ICONS[i.kind] ?? "puzzle");
  add("interactions", "Time limits", "timer", "Timer", "A countdown clock for the slide or its layer. The learner can always add time or turn it off. A rule on the timer says what happens when the time runs out.", "timer");
  add("interactions", "Stories", "scenario", "Branching scenario", "A story the learner steps through by choosing what to do. Each choice leads to another situation, until an ending.", "git-branch");

  add("course", "After the quiz", "course:results", "Results", "Shows the learner's score and whether they passed, and can list each question. It fills itself in from the quiz.", "chart-column");
  add("course", "After the quiz", "course:certificate", "Certificate", "For a learner who passed. They type their own name, then print it or save it as a PDF.", "award");
  add("course", "Whole slides", "game", "Game", "A ready-made game after this slide: a quiz board, a prize ladder, an escape room or an order challenge.", "gamepad-2");
  add("course", "Whole slides", "quizFromFile", "Quiz from a spreadsheet", "A slide for each question in a spreadsheet saved as a CSV file, after this slide.", "sheet");
  return out;
}

/** The first sentence of a description, for the card; the rest is still searched. */
export function firstSentence(text: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(text.trim());
  return m ? m[1]! : text.trim();
}

/** The kind's words for the row of kinds and the headings, "All" for everything. */
export function kindLabel(kind: GalleryKind | "all"): string {
  return kind === "all" ? "All" : GALLERY_KINDS.find((k) => k.id === kind)?.label ?? kind;
}

/**
 * What the gallery shows for what was typed and the kind chosen. With nothing typed, everything of that kind in the gallery's order;
 * with words, the ones that fit best first, scored the way the command search scores commands (name first, then its kind and group,
 * then what it is for), so the two boxes find things the same way.
 */
export function filterGallery(items: readonly GalleryItem[], query: string, kind: GalleryKind | "all"): GalleryItem[] {
  const pool = kind === "all" ? items : items.filter((i) => i.kind === kind);
  if (plain(query) === "") return [...pool];
  return pool
    .map((item, i) => ({ item, i, score: scoreCommand(query, item.label, [kindLabel(item.kind), item.group], item.description) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((s) => s.item);
}

/** The line under the search box. */
export function galleryStatus(shown: number, total: number, query: string, kind: GalleryKind | "all"): string {
  const typed = plain(query) !== "";
  if (shown === 0) {
    return kind === "all"
      ? "Nothing to add has those words. Try a shorter or another word, such as picture, question or timer."
      : `Nothing in ${kindLabel(kind)} has those words. Try another word, or choose All.`;
  }
  const things = shown === 1 ? "1 thing" : `${shown} things`;
  if (!typed && kind === "all") return `${things} you can add, by kind. Type to find one.`;
  if (!typed) return `${things} in ${kindLabel(kind)}.`;
  return `${things} found${kind === "all" ? "" : ` in ${kindLabel(kind)}`}, best first.`;
}

/** Where a key moves focus among the choices shown: the index of the one to go to, -1 for the search box, or null for no move. */
export function galleryMove(key: string, at: number, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowDown" || key === "ArrowRight") return Math.min(at + 1, count - 1);
  if (key === "ArrowLeft") return Math.max(at - 1, 0);
  if (key === "ArrowUp") return at === 0 ? -1 : at - 1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

// ---- the page

let nextId = 0;

/** Show the gallery. Resolves to the value of what was chosen, or null when it was closed without choosing. */
export function openInsertGallery(doc: Document, items: readonly GalleryItem[]): Promise<string | null> {
  return new Promise((resolve) => {
    const id = `ig${++nextId}`;
    const dialog = el(doc, "dialog", { class: "dialog insert-gallery", "aria-labelledby": `${id}-title` }) as HTMLDialogElement;
    const head = el(doc, "div", { class: "ig-head" });
    head.append(
      el(doc, "h2", { id: `${id}-title`, text: "Add to the slide" }),
      el(doc, "p", { class: "ig-intro", text: "Choose what to add to the layer being edited. Everything stays editable afterwards." }));

    const searchLabel = el(doc, "label", { class: "sr-only", for: `${id}-q`, text: "Search what you can add" });
    const box = el(doc, "div", { class: "cs-box ig-box" });
    const input = el(doc, "input", { id: `${id}-q`, class: "cs-input", type: "search", autocomplete: "off", spellcheck: "false", placeholder: "Search text, pictures, questions, interactions...", "aria-describedby": `${id}-status` }) as HTMLInputElement;
    box.append(uiIcon(doc, "search"), input);

    const kinds = el(doc, "fieldset", { class: "ig-kinds" });
    kinds.append(el(doc, "legend", { class: "sr-only", text: "Show" }));
    let kind: GalleryKind | "all" = "all";
    for (const k of [{ id: "all" as const, label: "All", icon: "layout-grid" as UiIconName }, ...GALLERY_KINDS]) {
      const lab = el(doc, "label", { class: "ig-kind" });
      const radio = el(doc, "input", { type: "radio", name: `${id}-kind`, value: k.id }) as HTMLInputElement;
      radio.checked = k.id === "all";
      radio.addEventListener("change", () => { if (radio.checked) { kind = k.id; draw(); } });
      lab.append(radio, uiIcon(doc, k.icon), el(doc, "span", { text: k.label }));
      kinds.append(lab);
    }
    const status = el(doc, "p", { id: `${id}-status`, class: "ig-status", role: "status" });
    head.append(searchLabel, box, kinds, status);

    const results = el(doc, "div", { class: "ig-results" });
    const note = el(doc, "p", { class: "ig-keys note", text: "Type to search. Down goes to the choices, and the arrow keys move between them; Tab goes on to the kinds and to Cancel." });
    const cancel = el(doc, "button", { type: "button", text: "Cancel" });
    const foot = el(doc, "div", { class: "dialog-actions ig-foot" });
    foot.append(note, cancel);
    dialog.append(head, results, foot);
    doc.body.append(dialog);

    let cards: HTMLButtonElement[] = [];
    let current = 0;
    let chosen: string | null = null;

    const focusCard = (i: number) => {
      cards.forEach((c, j) => { c.tabIndex = j === i ? 0 : -1; });
      current = i;
      cards[i]?.focus();
    };

    function card(item: GalleryItem): HTMLButtonElement {
      const descId = `${id}-d-${item.value.replace(/[^a-z0-9]+/gi, "-")}`;
      const b = el(doc, "button", { type: "button", class: "ig-card", "aria-describedby": descId, "data-value": item.value }) as HTMLButtonElement;
      const tile = el(doc, "span", { class: "ig-tile", "aria-hidden": "true" });
      tile.append(uiIcon(doc, item.icon));
      const text = el(doc, "span", { class: "ig-text" });
      text.append(el(doc, "span", { class: "ig-name", text: item.label }), el(doc, "span", { id: descId, class: "ig-desc", text: firstSentence(item.description) }));
      b.append(tile, text);
      b.title = item.description;
      b.addEventListener("click", () => { chosen = item.value; finish(); });
      return b;
    }

    function draw(): void {
      const shown = filterGallery(items, input.value, kind);
      const typed = plain(input.value) !== "";
      results.replaceChildren();
      cards = [];
      if (shown.length === 0) {
        results.append(el(doc, "p", { class: "ig-empty", text: galleryStatus(0, items.length, input.value, kind) }));
      } else if (typed || kind !== "all") {
        const grid = el(doc, "div", { class: "ig-grid" });
        for (const item of shown) { const c = card(item); cards.push(c); grid.append(c); }
        results.append(grid);
      } else {
        for (const k of GALLERY_KINDS) {
          const mine = shown.filter((i) => i.kind === k.id);
          if (mine.length === 0) continue;
          const h = el(doc, "h3", { class: "ig-group" });
          h.append(uiIcon(doc, k.icon), el(doc, "span", { text: k.label }));
          const grid = el(doc, "div", { class: "ig-grid" });
          for (const item of mine) { const c = card(item); cards.push(c); grid.append(c); }
          results.append(h, grid);
        }
      }
      cards.forEach((c, j) => { c.tabIndex = j === 0 ? 0 : -1; });
      current = 0;
      status.textContent = galleryStatus(shown.length, items.length, input.value, kind);
      results.scrollTop = 0;
    }

    input.addEventListener("input", draw);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" && cards.length > 0) { e.preventDefault(); focusCard(0); }
      if (e.key === "Enter") e.preventDefault();
    });
    results.addEventListener("keydown", (e) => {
      const at = cards.indexOf(e.target as HTMLButtonElement);
      if (at < 0) return;
      const to = galleryMove(e.key, at, cards.length);
      if (to === null) return;
      e.preventDefault();
      if (to === -1) input.focus();
      else focusCard(to);
    });
    results.addEventListener("focusin", (e) => {
      const at = cards.indexOf(e.target as HTMLButtonElement);
      if (at >= 0 && at !== current) { cards.forEach((c, j) => { c.tabIndex = j === at ? 0 : -1; }); current = at; }
    });

    const finish = () => {
      if (!dialog.open) return;
      dialog.close();
      dialog.remove();
      resolve(chosen);
    };
    cancel.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });

    draw();
    dialog.showModal();
    input.focus();
  });
}
