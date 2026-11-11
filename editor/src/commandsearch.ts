// The command search (Ctrl+K, or the Search button in the top bar): a box to type a few letters of what you want to do, and the
// commands whose names fit, so nobody has to remember which menu holds one. It lists the same commands as the menus under the top
// bar, with the same words, icons, shortcuts and dimming (they all come from one list in app.ts).
//
// It follows the combobox pattern of the WAI-ARIA Authoring Practices: focus stays in the box while Up and Down move through what is
// found (aria-activedescendant), Enter does the one that is chosen, and Escape closes the window. Like a menu, it first gives focus
// back to where the author was and then runs the command, so a dialog the command opens gives focus back to that place too.
// The pure parts (which commands fit what was typed, and in what order) are at the top, so they can be tested without a page.

import { ariaKeys, el, uiIcon, type MenuCommand, type MenuDef } from "./menubar.ts";

/** One command, and the menus it is in (for example Preview is in File and Review). */
export interface SearchEntry {
  cmd: MenuCommand;
  menus: string[];
}

export interface Found {
  entry: SearchEntry;
  /** What it is called now (Lock or Unlock). */
  label: string;
  score: number;
}

/** Every command in the menus, once each, in the order of the menus. A command in two menus is listed once, with both. */
export function searchEntries(menus: readonly MenuDef[]): SearchEntry[] {
  const out: SearchEntry[] = [];
  const byRun = new Map<() => void, SearchEntry>();
  for (const menu of menus) {
    for (const item of menu.items) {
      if (item === "-") continue;
      const known = byRun.get(item.run);
      if (known) {
        if (!known.menus.includes(menu.label)) known.menus.push(menu.label);
        continue;
      }
      const entry = { cmd: item, menus: [menu.label] };
      byRun.set(item.run, entry);
      out.push(entry);
    }
  }
  return out;
}

/** Where it is, in words: "File menu", "File and Review menus", "Edit, Slide and Help menus". */
export function menusText(menus: readonly string[]): string {
  if (menus.length === 0) return "";
  if (menus.length === 1) return `${menus[0]} menu`;
  return `${menus.slice(0, -1).join(", ")} and ${menus[menus.length - 1]} menus`;
}

/**
 * Words as they are compared: lower case, without the dots after a name that opens a window, with marks between words made into
 * spaces, and with British spellings made American, so "color" finds "colours" and "colour" finds "color".
 */
export function plain(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/\.\.\.|…/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/colour/g, "color")
    .replace(/behaviour/g, "behavior")
    .replace(/centre/g, "center")
    .replace(/organis/g, "organiz")
    .trim();
}

function words(text: string): string[] {
  const p = plain(text);
  return p === "" ? [] : p.split(" ");
}

/**
 * How well a command fits what was typed; 0 is not at all. Best is its name exactly, then its name starting with it, then every word
 * typed starting a word of its name ("lay ear" finds "Move layer earlier"; whole words first, so "slide" puts New slide before Share
 * slides), then its name holding it anywhere, then the words of its menu ("design" finds Themes), and last the words of its
 * description ("scorm" and "lms" find Publish). In a description a short word has to be a whole word, so "lay" does not find every
 * command whose description says "layer"; a word of five letters or more may be the start of one ("color" finds "colours").
 */
export function scoreCommand(query: string, label: string, menus: readonly string[] = [], title = ""): number {
  const q = plain(query);
  if (q === "") return 1;
  const name = plain(label);
  if (name === q) return 100;
  if (name.startsWith(q)) return 90;
  const typed = q.split(" ");
  const nameWords = name.split(" ");
  const starts = (pool: readonly string[]) => (w: string) => pool.some((x) => x.startsWith(w));
  if (typed.every(starts(nameWords))) {
    return 70 + (typed.every((w) => nameWords.includes(w)) ? 3 : 0) + (nameWords[0]!.startsWith(typed[0]!) ? 5 : 0);
  }
  if (name.includes(q)) return 50;
  const menuWords = [...nameWords, ...menus.flatMap(words)];
  if (typed.every(starts(menuWords))) return 30;
  const titleWords = words(title);
  if (typed.every((w) => starts(menuWords)(w) || (w.length >= 5 ? starts(titleWords)(w) : titleWords.includes(w)))) return 10;
  return 0;
}

/** The commands that fit what was typed, best first; with nothing typed, all of them in the order of the menus. */
export function rankCommands(entries: readonly SearchEntry[], query: string): Found[] {
  const scored = entries.map((entry, i) => {
    const cmd = entry.cmd;
    const label = cmd.labelNow?.() ?? cmd.label;
    let score = scoreCommand(query, label, entry.menus, cmd.title ?? "");
    // Its other name counts too, a little less: "lock" still finds Unlock.
    if (label !== cmd.label) score = Math.max(score, scoreCommand(query, cmd.label, entry.menus, cmd.title ?? "") - 1);
    return { found: { entry, label, score }, i };
  });
  return scored
    .filter((s) => s.found.score > 0)
    .sort((a, b) => b.found.score - a.found.score || a.i - b.i)
    .map((s) => s.found);
}

/** What the line under the box says about what was found. */
export function foundText(count: number, query: string): string {
  if (plain(query) === "") return `${count} commands, in the order of the menus. Type to find one.`;
  if (count === 0) return "No command has those words. Try another word, or look in the menus.";
  return count === 1 ? "1 command found." : `${count} commands found.`;
}

// ---- the page

export interface SearchOptions {
  /** Where focus goes when the window closes, if the place it came from has gone (a menu that closed, say). */
  fallback: () => HTMLElement | null;
  /**
   * The window's own words, when it finds something other than commands (Go to slide finds slides). Left out, it is the command search.
   * `where` says where each one is, after its name; `found` is the line under the box.
   */
  words?: {
    heading: string;
    intro: string;
    placeholder: string;
    listName: string;
    found(count: number, query: string): string;
    where(entry: SearchEntry): string;
    /** What is said when something dimmed is chosen. */
    unavailable?(label: string): string;
  };
}

/** The line under the box of Go to slide (Ctrl+J): how many slides fit what was typed. */
export function slidesFoundText(count: number, query: string): string {
  if (plain(query) === "") return `${count} ${count === 1 ? "slide" : "slides"}, in the order of the course. Type a few letters of a slide's name, or its number.`;
  if (count === 0) return "No slide has those words. Try another word, or its number.";
  return count === 1 ? "1 slide found." : `${count} slides found.`;
}

/** Only one at a time: Ctrl+K again while it is open puts focus back in its box. */
let openNow: HTMLDialogElement | null = null;

export function openCommandSearch(doc: Document, entries: readonly SearchEntry[], opts: SearchOptions): void {
  if (openNow) {
    openNow.querySelector<HTMLInputElement>("input")?.focus();
    return;
  }
  const from = doc.activeElement as HTMLElement | null;
  const words = opts.words;
  const dialog = el(doc, "dialog", { class: "dialog command-search", "aria-labelledby": "cs-title", "aria-describedby": "cs-intro" });
  const closeBtn = el(doc, "button", { type: "button", class: "cs-close icon-only", "aria-label": "Close", title: "Close (Escape)" }, uiIcon(doc, "x"));
  const input = el(doc, "input", {
    type: "text", id: "cs-input", class: "cs-input", role: "combobox", "aria-autocomplete": "list", "aria-expanded": "true",
    "aria-controls": "cs-list", "aria-labelledby": "cs-title", autocomplete: "off", spellcheck: "false",
    placeholder: words?.placeholder ?? "For example: new slide, themes, publish",
  });
  const list = el(doc, "ul", { id: "cs-list", class: "cs-list", role: "listbox", "aria-label": words?.listName ?? "Commands found" });
  // What was found, in words: shown under the box, and said by a screen reader (once typing pauses) from a line of its own.
  const status = el(doc, "p", { class: "cs-status" });
  const live = el(doc, "p", { class: "sr-only", role: "status" });
  dialog.append(
    el(doc, "div", { class: "cs-head" }, el(doc, "h2", { id: "cs-title", text: words?.heading ?? "Search for a command" }), closeBtn),
    el(doc, "p", { id: "cs-intro", class: "note", text: words?.intro ?? "Type a few letters of what you want to do. Up and Down move through what is found, Enter does it, Escape closes." }),
    el(doc, "div", { class: "cs-box" }, uiIcon(doc, "search"), input),
    status,
    list,
    live);

  let found: Found[] = [];
  let active = -1;
  let sayTimer = 0;

  const showActive = (scroll: boolean) => {
    list.querySelectorAll<HTMLElement>("[role=option]").forEach((o, i) => o.setAttribute("aria-selected", String(i === active)));
    const now = active >= 0 ? doc.getElementById(`cs-opt-${active}`) : null;
    if (now) {
      input.setAttribute("aria-activedescendant", now.id);
      if (scroll) now.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };

  const option = (f: Found, i: number): HTMLElement => {
    const cmd = f.entry.cmd;
    const icon = cmd.iconNow?.() ?? cmd.icon;
    const on = cmd.enabled ? cmd.enabled() : true;
    const li = el(doc, "li", { id: `cs-opt-${i}`, class: "cs-option", role: "option", "aria-selected": "false" });
    if (!on) li.setAttribute("aria-disabled", "true");
    if (cmd.keys) li.setAttribute("aria-keyshortcuts", ariaKeys(cmd.keys));
    if (cmd.title) li.title = cmd.title;
    const keys = el(doc, "span", { class: "menu-keys", text: cmd.keys ?? "", "aria-hidden": "true" });
    const text = el(doc, "span", { class: "cs-text" }, el(doc, "span", { class: "cs-label", text: f.label }), " ", el(doc, "span", { class: "cs-where", text: words ? words.where(f.entry) : menusText(f.entry.menus) }));
    if (cmd.checked?.()) {
      keys.replaceChildren(uiIcon(doc, "check"));
      text.append(el(doc, "span", { class: "sr-only", text: ", on" }));
    }
    li.append(icon ? uiIcon(doc, icon) : el(doc, "span", { class: "ui-icon-space", "aria-hidden": "true" }), text, keys);
    li.addEventListener("click", () => run(i));
    li.addEventListener("pointermove", () => {
      if (active !== i) {
        active = i;
        showActive(false);
      }
    });
    return li;
  };

  const draw = () => {
    found = rankCommands(entries, input.value);
    list.replaceChildren(...found.map((f, i) => option(f, i)));
    active = found.length > 0 ? 0 : -1;
    input.setAttribute("aria-expanded", String(found.length > 0));
    showActive(true);
    list.scrollTop = 0;
    status.textContent = words ? words.found(found.length, input.value) : foundText(found.length, input.value);
  };

  const close = (giveBack: boolean) => {
    window.clearTimeout(sayTimer);
    dialog.close();
    dialog.remove();
    openNow = null;
    if (!giveBack) return;
    const there = from && from !== doc.body && from.isConnected && !from.closest("[hidden]") ? from : opts.fallback();
    there?.focus();
  };

  const run = (i: number) => {
    const f = found[i];
    if (!f) return;
    const cmd = f.entry.cmd;
    if (cmd.enabled && !cmd.enabled()) {
      active = i;
      showActive(true);
      const why = words?.unavailable ? words.unavailable(f.label) : `${f.label.replace(/\.\.\.$/, "")} cannot be used now.`;
      status.textContent = why;
      window.clearTimeout(sayTimer);
      live.textContent = "";
      sayTimer = window.setTimeout(() => (live.textContent = why), 30);
      return;
    }
    close(true);
    cmd.run();
  };

  input.addEventListener("input", () => {
    draw();
    // Said once typing pauses, not after every letter.
    window.clearTimeout(sayTimer);
    live.textContent = "";
    const text = status.textContent ?? "";
    sayTimer = window.setTimeout(() => (live.textContent = text), 400);
  });
  input.addEventListener("keydown", (e) => {
    const n = found.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (n === 0) return;
      active = e.key === "ArrowDown" ? (active + 1) % n : (active - 1 + n) % n;
      showActive(true);
    } else if (e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      if (n === 0) return;
      active = Math.max(0, Math.min(n - 1, active + (e.key === "PageDown" ? 8 : -8)));
      showActive(true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(active);
    }
  });
  closeBtn.addEventListener("click", () => close(true));
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close(true);
  });
  // A click outside the window (on the dimmed page) closes it, as a click outside a menu does. It is the whole click, not the press,
  // so the window is still there when the button is let go and the click does nothing to what is under it.
  const outside = (e: MouseEvent) => {
    if (e.target !== dialog) return false;
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  dialog.addEventListener("mousedown", (e) => { if (outside(e)) e.preventDefault(); });
  dialog.addEventListener("click", (e) => { if (outside(e)) close(true); });

  doc.body.append(dialog);
  openNow = dialog;
  dialog.showModal();
  draw();
  input.focus();
}
