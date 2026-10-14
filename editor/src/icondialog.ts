// The icon picker: a search box and a grid of icons. Like the other dialogs it is a native <dialog>, so focus moves in, Tab stays inside and
// Escape closes it. The grid is one stop for Tab and moves with the arrow keys (Home and End too), so 1,879 icons are not 1,879 stops. Each
// icon is a button named by its name in words, so a screen reader says "arrow right" and not a picture.

import { buildIcon } from "../../player/src/icon.ts";
import { iconWords, searchIcons, type IconEntry, type IconList } from "./icons.ts";

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

export interface IconPickerOptions {
  /** Read the icon list (fetched the first time). */
  load(): Promise<IconList>;
  /** Said to a screen reader, as the editor's other messages are. */
  announce(message: string): void;
  /** What the author is choosing it for, to put in the heading: "Choose an icon for the button". */
  heading?: string;
}

const PAGE = 72;

/** Show the picker. Resolves to the icon chosen, or null if it was cancelled. */
export function pickIcon(opts: IconPickerOptions): Promise<IconEntry | null> {
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "dialog wide icon-dialog", "aria-labelledby": "ic-title" });
    const form = h("form", { method: "dialog" });
    const title = h("h2", { id: "ic-title", text: opts.heading ?? "Choose an icon" });
    const intro = h("p", { class: "note", text: "Simple line pictures that take the colour you give them and the theme's colours. Search by what it is or means, for example \"arrow\", \"book\" or \"warning\". The icons are from Lucide (ISC licence), and a course that uses one names Lucide on its credits page." });
    const search = h("input", { id: "ic-search", type: "search", autocomplete: "off", spellcheck: "false", "aria-describedby": "ic-status" });
    const status = h("p", { id: "ic-status", class: "note", role: "status", "aria-live": "polite", text: "Loading the icons..." });
    const grid = h("div", { class: "ic-grid", role: "group", "aria-label": "Icons" });
    const more = h("button", { type: "button", text: "Show more icons" });
    more.hidden = true;
    const cancel = h("button", { type: "button", text: "Cancel" });

    let list: IconList | null = null;
    let results: IconEntry[] = [];
    let shown = 0;
    let query = "";

    const cell = (icon: IconEntry, first: boolean): HTMLElement => {
      const b = h("button", { type: "button", class: "ic-cell", "data-icon": icon.name, tabindex: first ? "0" : "-1" });
      b.append(buildIcon(document, icon), h("span", { class: "ic-name", text: iconWords(icon.name) }));
      b.addEventListener("click", () => finish(icon));
      return b;
    };

    const summary = (): string => {
      if (results.length === 0) return `No icons match "${query}". Try a simpler word, such as "arrow" or "book".`;
      const of = shown < results.length ? `Showing ${shown} of ${results.length}. ` : "";
      return `${results.length} ${results.length === 1 ? "icon" : "icons"}${query.trim() ? ` match "${query.trim()}"` : ""}. ${of}Use the arrow keys to move between them, and Enter to choose one.`;
    };

    const draw = (announce: boolean) => {
      results = list ? searchIcons(list.icons, query) : [];
      shown = Math.min(PAGE, results.length);
      grid.replaceChildren(...results.slice(0, shown).map((icon, i) => cell(icon, i === 0)));
      more.hidden = shown >= results.length;
      status.textContent = summary();
      if (announce) opts.announce(summary());
    };

    more.addEventListener("click", () => {
      const from = shown;
      shown = Math.min(shown + PAGE, results.length);
      for (const icon of results.slice(from, shown)) grid.appendChild(cell(icon, false));
      more.hidden = shown >= results.length;
      status.textContent = summary();
      (grid.children[from] as HTMLElement | undefined)?.focus();
      (grid.children[from] as HTMLElement | undefined)?.setAttribute("tabindex", "0");
      grid.children[0]?.setAttribute("tabindex", "-1");
    });

    // The arrow keys move between icons; the grid is a single stop for Tab.
    grid.addEventListener("keydown", (e) => {
      const cells = Array.from(grid.children) as HTMLElement[];
      const at = cells.indexOf(document.activeElement as HTMLElement);
      if (at < 0 || cells.length === 0) return;
      const columns = Math.max(1, cells.filter((c) => c.offsetTop === cells[0]!.offsetTop).length);
      const to = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "ArrowDown" ? at + columns : e.key === "ArrowUp" ? at - columns
        : e.key === "Home" ? 0 : e.key === "End" ? cells.length - 1 : -1;
      if (to < 0) return;
      e.preventDefault();
      const target = cells[Math.min(cells.length - 1, Math.max(0, to))]!;
      for (const c of cells) c.setAttribute("tabindex", c === target ? "0" : "-1");
      target.focus();
    });

    let timer = 0;
    search.addEventListener("input", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { query = search.value; draw(true); }, 150);
    });
    // Down arrow from the search box goes into the results.
    search.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); (grid.querySelector("[tabindex='0']") as HTMLElement | null)?.focus(); }
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      query = search.value;
      draw(true);
    });

    const finish = (choice: IconEntry | null) => {
      window.clearTimeout(timer);
      dialog.close();
      dialog.remove();
      resolve(choice);
    };
    cancel.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(null); });

    form.append(title, intro, h("div", { class: "field" }, h("label", { for: "ic-search", text: "Search icons" }), search), status, grid, h("div", { class: "btn-row" }, more), h("div", { class: "dialog-actions" }, cancel));
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    dialog.showModal();
    search.focus();

    opts.load().then((l) => {
      list = l;
      draw(false);
    }).catch((err) => {
      status.textContent = `Could not load the icons. ${err instanceof Error ? err.message : String(err)}`;
    });
  });
}
