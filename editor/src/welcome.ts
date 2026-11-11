// The welcome page: what the editor shows when no project is open (design spec A01, "Welcome / project hub"). On the left, New project
// and Open project; on the right, the projects opened lately; under them, the examples that came with the program. Each recent project
// and each example is one button, so Tab goes from card to card and Enter opens it. A recent project's "..." button holds what else can
// be done with it (show it in its folder, take it off the list), and the "..." beside the heading holds the list's own choices (stop
// keeping one, clear it), so the page has few buttons. The data (recent.ts, examples.ts) is tested on its own; the page was driven in the
// browser preview (docs/handoff).

import { el, uiIcon } from "./menubar.ts";
import type { MenuEntry } from "./menubar.ts";
import { menuButton, PopupMenu } from "./popupmenu.ts";
import { recentDetails, recentTitle, slidesText, type RecentProject } from "./recent.ts";
import type { ExampleCard, ExampleInfo } from "./examples.ts";

export type ShownExample = ExampleCard & ExampleInfo;

export interface WelcomeActions {
  newProject(): void;
  openProject(): void;
  /** Open a project from the list. `from` is its card, for focus to stay on if it cannot be opened. */
  openRecent(p: RecentProject, from: HTMLElement): void;
  /** Show the project's folder in File Explorer; null where that cannot be done (the page in a plain browser). */
  showFolder: ((dir: string) => void) | null;
  /** Take one project off the list. */
  forget(p: RecentProject): void;
  clearRecent(): void;
  setKeepRecent(on: boolean): void;
  /** Make a copy of an example and open it. `from` is its card. */
  openExample(e: ShownExample, from: HTMLElement): void;
}

export class WelcomePage {
  readonly element: HTMLElement;
  private readonly doc: Document;
  private readonly actions: WelcomeActions;
  private readonly recentList: HTMLUListElement;
  private readonly recentEmpty: HTMLParagraphElement;
  private readonly recentMenu: PopupMenu;
  private readonly examplesSection: HTMLElement;
  private readonly exampleList: HTMLUListElement;
  private readonly showAllBtn: HTMLButtonElement;
  private readonly newBtn: HTMLButtonElement;
  private readonly openBtn: HTMLButtonElement;
  private recent: RecentProject[] = [];
  private keep = true;
  private showAll: (() => void) | null = null;

  constructor(doc: Document, actions: WelcomeActions) {
    this.doc = doc;
    this.actions = actions;

    // Making a course, or carrying on with one.
    this.newBtn = el(doc, "button", { type: "button", class: "primary welcome-big", id: "welcome-new", title: "Make a new project (Ctrl+N)", "aria-keyshortcuts": "Control+N" },
      uiIcon(doc, "file-plus"), el(doc, "span", { text: "New project..." }));
    this.newBtn.addEventListener("click", () => actions.newProject());
    this.openBtn = el(doc, "button", { type: "button", class: "welcome-big", id: "welcome-open", title: "Open a project folder (Ctrl+O)", "aria-keyshortcuts": "Control+O" },
      uiIcon(doc, "folder-open"), el(doc, "span", { text: "Open project..." }));
    this.openBtn.addEventListener("click", () => actions.openProject());
    const start = el(doc, "div", { class: "welcome-start" },
      el(doc, "h2", { id: "welcome-h", text: "Make a course, or carry on with one" }),
      el(doc, "p", { id: "welcome-text", class: "welcome-lead", text: "OpenStage Author makes accessible courses from slides, questions and narration, and publishes them for your LMS or the web." }),
      el(doc, "div", { class: "welcome-actions" }, this.newBtn, this.openBtn),
      el(doc, "p", { class: "welcome-hint", text: "New here? Open a copy of one of the examples. Ctrl+K finds any command by its name, and Ctrl+/ lists every key." }));

    // The projects opened lately.
    this.recentMenu = new PopupMenu(doc, "recent-item-menu", "Recent project");
    const listMenu = menuButton(doc, {
      id: "recent-more", name: "More for the list of recent projects", icon: "ellipsis",
      entries: () => this.listEntries(),
    }).button;
    this.recentList = el(doc, "ul", { class: "recent-list", role: "list", "aria-labelledby": "recent-h" });
    this.recentEmpty = el(doc, "p", { class: "recent-empty", id: "recent-empty" });
    const recentSection = el(doc, "section", { class: "welcome-recent", "aria-labelledby": "recent-h" },
      el(doc, "div", { class: "welcome-head" }, el(doc, "h2", { id: "recent-h" }, uiIcon(doc, "folder-clock"), el(doc, "span", { text: "Recent projects" })), listMenu),
      this.recentList, this.recentEmpty);

    // The examples that came with the program.
    this.showAllBtn = el(doc, "button", { type: "button", class: "small welcome-show-all", title: "Show the folder of examples that came with the program, with the ones not listed here", hidden: true },
      uiIcon(doc, "folder-open"), el(doc, "span", { text: "Show all the examples" }));
    this.showAllBtn.addEventListener("click", () => this.showAll?.());
    this.exampleList = el(doc, "ul", { class: "example-list", role: "list", "aria-labelledby": "examples-h", "aria-describedby": "examples-note" });
    this.examplesSection = el(doc, "section", { class: "welcome-examples", "aria-labelledby": "examples-h", hidden: true },
      el(doc, "div", { class: "welcome-head" }, el(doc, "h2", { id: "examples-h" }, uiIcon(doc, "layout-grid"), el(doc, "span", { text: "Examples" })), this.showAllBtn),
      el(doc, "p", { class: "note", id: "examples-note", text: "Each one opens as a copy, in a folder you choose, so the example stays as it came and your changes are your own." }),
      this.exampleList);

    this.element = el(doc, "main", { class: "welcome", "aria-labelledby": "welcome-h" },
      el(doc, "div", { class: "welcome-inner" }, start, recentSection, this.examplesSection));
    this.drawRecent();
  }

  /** The projects opened lately (newest first), and whether the editor keeps a list of them. */
  setRecent(list: readonly RecentProject[], keep: boolean): void {
    this.recent = [...list];
    this.keep = keep;
    this.drawRecent();
  }

  /** The examples to show, and what shows the folder they are in (null where that cannot be done). */
  setExamples(list: readonly ShownExample[], showAll: (() => void) | null): void {
    this.showAll = showAll;
    this.showAllBtn.hidden = !showAll;
    this.examplesSection.hidden = list.length === 0;
    this.exampleList.replaceChildren(...list.map((e, i) => this.exampleItem(e, i)));
  }

  /** Focus on the recent project at this place in the list (the last one if there are fewer), or on Open project if there are none. */
  focusRecent(index: number): void {
    const cards = [...this.recentList.querySelectorAll<HTMLElement>(".recent-open")];
    (cards[Math.min(index, cards.length - 1)] ?? this.openBtn).focus();
  }

  /** Focus on New project, the first thing on the page. */
  focusStart(): void {
    this.newBtn.focus();
  }

  /** The card of a recent project, if it is on the page. */
  recentCard(dir: string): HTMLElement | null {
    const i = this.recent.findIndex((p) => p.dir === dir);
    return i === -1 ? null : this.recentList.querySelectorAll<HTMLElement>(".recent-open")[i] ?? null;
  }

  private listEntries(): MenuEntry[] {
    return [
      { label: "Remember projects I open", icon: "clock", title: "Keep a list of the projects you open here, on this computer only. Turning it off clears the list.", checked: () => this.keep, run: () => this.actions.setKeepRecent(!this.keep) },
      "-",
      { label: "Clear the list", icon: "eraser", title: "Take every project off the list. The projects themselves are not touched.", enabled: () => this.recent.length > 0, run: () => this.actions.clearRecent() },
    ];
  }

  private drawRecent(): void {
    const now = new Date();
    this.recentList.replaceChildren(...this.recent.map((p, i) => this.recentItem(p, i, now)));
    this.recentList.hidden = this.recent.length === 0;
    this.recentEmpty.hidden = this.recent.length > 0;
    this.recentEmpty.textContent = this.keep
      ? "No projects yet. The projects you make or open will be listed here, so you can come back to them with one click."
      : "The editor is not keeping a list of the projects you open. To keep one again, choose Remember projects I open in the menu beside this heading.";
  }

  private recentItem(p: RecentProject, i: number, now: Date): HTMLLIElement {
    const doc = this.doc;
    const ids = { title: `recent-${i}-title`, details: `recent-${i}-details`, dir: `recent-${i}-dir` };
    const open = el(doc, "button", { type: "button", class: "recent-open", "aria-labelledby": ids.title, "aria-describedby": `${ids.details} ${ids.dir}`, title: `Open ${p.dir}` },
      el(doc, "span", { class: "recent-icon" }, uiIcon(doc, "folder")),
      el(doc, "span", { class: "recent-text" },
        el(doc, "span", { class: "recent-title", id: ids.title, text: recentTitle(p) }),
        el(doc, "span", { class: "recent-details", id: ids.details, text: recentDetails(p, now) }),
        el(doc, "span", { class: "recent-dir", id: ids.dir, text: p.dir })));
    open.addEventListener("click", () => this.actions.openRecent(p, open));
    const more = el(doc, "button", { type: "button", class: "panel-menu-button icon-only recent-more", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": "recent-item-menu",
      "aria-label": `More for ${recentTitle(p)}`, title: `More for ${recentTitle(p)}` }, uiIcon(doc, "ellipsis"));
    const show = (where: "first" | "last") => this.recentMenu.open(this.itemEntries(p, open), more, { trigger: more, where, returnTo: () => more, label: recentTitle(p) });
    more.addEventListener("click", () => { if (this.recentMenu.isOpen) this.recentMenu.close(true); else show("first"); });
    more.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); show("first"); }
      else if (e.key === "ArrowUp") { e.preventDefault(); show("last"); }
    });
    return el(doc, "li", { class: "recent-item" }, open, more);
  }

  private itemEntries(p: RecentProject, card: HTMLElement): MenuEntry[] {
    const showFolder = this.actions.showFolder;
    return [
      { label: "Open", icon: "folder-open", title: `Open ${p.dir}`, run: () => this.actions.openRecent(p, card) },
      ...(showFolder ? [{ label: "Show in folder", icon: "folder-search" as const, title: "Show the project's folder in File Explorer", run: () => showFolder(p.dir) }] : []),
      "-",
      { label: "Take off the list", icon: "x", title: "Take this project off the list. The project itself is not touched.", run: () => this.actions.forget(p) },
    ];
  }

  private exampleItem(e: ShownExample, i: number): HTMLLIElement {
    const doc = this.doc;
    const ids = { title: `example-${i}-title`, about: `example-${i}-about`, details: `example-${i}-details` };
    const card = el(doc, "button", { type: "button", class: "example-card", "aria-labelledby": ids.title, "aria-describedby": `${ids.details} ${ids.about}`, title: `Open a copy of ${e.title}` },
      el(doc, "span", { class: "example-icon" }, uiIcon(doc, e.icon)),
      el(doc, "span", { class: "example-text" },
        el(doc, "span", { class: "example-title", id: ids.title, text: e.title }),
        el(doc, "span", { class: "example-details", id: ids.details, text: `Example, ${slidesText(e.slides)}` }),
        el(doc, "span", { class: "example-about", id: ids.about, text: e.about })));
    card.addEventListener("click", () => this.actions.openExample(e, card));
    return el(doc, "li", {}, card);
  }
}
