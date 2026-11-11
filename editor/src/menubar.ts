// The row of dropdown menus under the editor's top bar (File, Edit, Insert...): every command the editor has, in one place, each with
// its icon and its keyboard shortcut. It follows the menu bar pattern of the WAI-ARIA Authoring Practices, the way desktop programs
// on Windows behave:
//  - F10 (or Alt pressed and let go on its own) moves to the menu bar; Left and Right move along it; Down, Enter or Space opens a
//    menu; Up opens it at its last item.
//  - In a menu, Up and Down move (round from the end to the start), Home and End go to the first and last item, a letter goes to the
//    next item that starts with it, Left and Right open the menu beside it, Enter or Space chooses, Escape closes the menu and goes
//    back to its name in the bar, Tab closes it and moves on.
//  - Escape on the bar itself goes back to wherever the author was before coming to the menus.
//  - An item that cannot be used now stays in its menu, dimmed (aria-disabled), so people learn where things are.
//  - Choosing an item first puts focus back where the author was, then runs the command, so a dialog the command opens gives focus
//    back to that place when it closes.
// The pure parts (moving through a list, finding by letter) are at the top, so they can be tested without a page.

import { buildIcon } from "../../player/src/icon.ts";
import type { IconShape } from "../../player/src/types.ts";
import { UI_ICONS, type UiIconName } from "./uiicons.gen.ts";

export interface MenuCommand {
  /** What the item says, for example "New project". */
  label: string;
  icon?: UiIconName;
  /** The shortcut, written the way it is shown, for example "Ctrl+N". */
  keys?: string;
  /** A longer description, shown when the pointer rests on the item. */
  title?: string;
  run: () => void;
  /** Whether it can be used now; asked each time its menu opens. */
  enabled?: () => boolean;
  /** For an item that is on or off (such as showing the timeline): asked each time its menu opens. */
  checked?: () => boolean;
  /** A label that changes (such as Lock and Unlock): asked each time its menu opens. */
  labelNow?: () => string;
  /** The icon that goes with labelNow. */
  iconNow?: () => UiIconName;
}

export type MenuEntry = MenuCommand | "-";

export interface MenuDef {
  /** A short id, used to open the menu from elsewhere (for example "design"). */
  id: string;
  label: string;
  items: MenuEntry[];
}

// ---- pure parts

/** The next place in a list of `count` items, going round at the ends. */
export function stepIndex(current: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0) return dir === 1 ? 0 : count - 1;
  return (current + dir + count) % count;
}

/** The first item after `current` (going round) whose label starts with `letter`, or -1. */
export function letterIndex(labels: readonly string[], current: number, letter: string): number {
  const l = letter.toLocaleLowerCase();
  if (l.length !== 1 || l.trim() === "") return -1;
  for (let i = 1; i <= labels.length; i++) {
    const at = (current + i + labels.length) % labels.length;
    if (labels[at]!.trim().toLocaleLowerCase().startsWith(l)) return at;
  }
  return -1;
}

// ---- the page

type Attrs = Record<string, string | boolean>;

export function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, attrs: Attrs = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    if (k === "class") e.className = String(v);
    else if (k === "text") e.textContent = String(v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  e.append(...kids);
  return e;
}

/** An icon from the editor's own set, drawn in the colour of the words beside it and hidden from screen readers. */
export function uiIcon(doc: Document, name: UiIconName): SVGSVGElement {
  const svg = buildIcon(doc, { shapes: UI_ICONS[name] as unknown as IconShape[] });
  svg.classList.add("ui-icon");
  return svg;
}

/** The way aria-keyshortcuts writes a shortcut shown as "Ctrl+Z" or "Alt+Up". */
export function ariaKeys(keys: string): string {
  return keys.replace(/Ctrl/g, "Control").replace(/\bUp\b/, "ArrowUp").replace(/\bDown\b/, "ArrowDown");
}

/** Draw (or draw again) one item of a menu as it is now: its icon, its words, its shortcut or tick, and whether it can be used. */
export function drawItem(doc: Document, button: HTMLElement, cmd: MenuCommand): void {
  const label = cmd.labelNow?.() ?? cmd.label;
  const icon = cmd.iconNow?.() ?? cmd.icon;
  // An item that is on shows a tick where a shortcut would go (a screen reader hears "checked" from aria-checked).
  const keys = el(doc, "span", { class: "menu-keys", text: cmd.keys ?? "", "aria-hidden": "true" });
  if (cmd.checked?.()) keys.replaceChildren(uiIcon(doc, "check"));
  button.replaceChildren(
    icon ? uiIcon(doc, icon) : el(doc, "span", { class: "ui-icon-space", "aria-hidden": "true" }),
    el(doc, "span", { class: "menu-label", text: label }),
    keys);
  const on = cmd.enabled ? cmd.enabled() : true;
  if (on) button.removeAttribute("aria-disabled");
  else button.setAttribute("aria-disabled", "true");
  if (cmd.checked) button.setAttribute("aria-checked", String(cmd.checked()));
}

/** A new, empty item for a menu: drawItem fills it in when the menu opens. */
export function newItem(doc: Document, cmd: MenuCommand): HTMLElement {
  const role = cmd.checked ? "menuitemcheckbox" : "menuitem";
  const button = el(doc, "div", { class: "menu-item", role, tabindex: "-1", ...(cmd.title ? { title: cmd.title } : {}) });
  if (cmd.keys) button.setAttribute("aria-keyshortcuts", ariaKeys(cmd.keys));
  return button;
}

interface Built {
  def: MenuDef;
  trigger: HTMLButtonElement;
  menu: HTMLElement;
  /** The items of the menu, in order, with the command each runs. */
  items: { button: HTMLElement; cmd: MenuCommand }[];
}

export class MenuBar {
  readonly element: HTMLElement;
  private readonly doc: Document;
  private readonly built: Built[] = [];
  private openAt = -1;
  /** Where the author was before coming to the menus: where focus goes back to. */
  private returnTo: HTMLElement | null = null;
  /** The menu the last chosen command came from, for giving focus somewhere sensible when the place it came from has gone. */
  private lastMenu = -1;
  private altAlone = false;

  constructor(doc: Document, menus: MenuDef[], label = "Menus") {
    this.doc = doc;
    this.element = el(doc, "div", { class: "menubar", role: "menubar", "aria-label": label });
    menus.forEach((def, i) => this.element.append(this.buildMenu(def, i)));
    this.built[0]?.trigger.setAttribute("tabindex", "0");

    // Remember where the author came from when they arrive at the bar from somewhere else.
    this.element.addEventListener("focusin", (e) => {
      const from = e.relatedTarget as HTMLElement | null;
      if (from && !this.element.contains(from)) this.returnTo = from;
    });
    // Leaving the bar (Tab, or a click elsewhere) closes any open menu.
    this.element.addEventListener("focusout", (e) => {
      const to = e.relatedTarget as Node | null;
      if (!to || !this.element.contains(to)) this.close(false);
    });
    doc.addEventListener("pointerdown", (e) => {
      if (this.openAt !== -1 && !this.element.contains(e.target as Node)) this.close(false);
    }, true);
    // F10, or Alt pressed and let go with nothing else, goes to the bar (and back again).
    doc.addEventListener("keydown", (e) => {
      this.altAlone = e.key === "Alt" && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.repeat;
      if (e.key === "F10" && !e.shiftKey && !e.ctrlKey && !e.altKey && !doc.querySelector("dialog[open]")) {
        e.preventDefault();
        this.toggleFocus();
      }
    }, true);
    doc.addEventListener("keyup", (e) => {
      if (e.key === "Alt" && this.altAlone && !doc.querySelector("dialog[open]")) {
        e.preventDefault();
        this.toggleFocus();
      }
      this.altAlone = false;
    }, true);
    // Alt held while dragging on the canvas is not Alt on its own.
    doc.addEventListener("pointerdown", () => (this.altAlone = false), true);
    doc.defaultView?.addEventListener("blur", () => (this.altAlone = false));
  }

  /** Go to the menu bar (on the menu with this id, or the first), as if the author had pressed F10. */
  focusMenu(id?: string): void {
    const at = Math.max(0, this.built.findIndex((b) => b.def.id === id));
    if (!this.element.contains(this.doc.activeElement)) this.returnTo = this.doc.activeElement as HTMLElement | null;
    this.focusTrigger(at);
  }

  /**
   * Put focus back where the author was before coming to the menus, after a command chosen from them has finished (a dialog it
   * opened has closed, say). If that place has gone, focus goes to the name of the menu the command was in.
   */
  focusBack(): void {
    const back = this.returnTo;
    if (back && back.isConnected && back.getClientRects().length > 0 && !back.closest("[hidden]")) back.focus();
    else this.focusTrigger(Math.max(0, this.lastMenu));
  }

  /** Whether a menu is open. */
  get isOpen(): boolean {
    return this.openAt !== -1;
  }

  close(focusTrigger = true): void {
    const at = this.openAt;
    if (at === -1) return;
    const b = this.built[at]!;
    b.menu.hidden = true;
    b.trigger.setAttribute("aria-expanded", "false");
    this.openAt = -1;
    if (focusTrigger) b.trigger.focus();
  }

  // ---- inside

  private toggleFocus(): void {
    if (this.element.contains(this.doc.activeElement)) {
      this.close(false);
      this.leave();
    } else {
      this.returnTo = this.doc.activeElement as HTMLElement | null;
      this.focusTrigger(0);
    }
  }

  /** Leave the bar for where the author was before. */
  private leave(): void {
    const back = this.returnTo;
    if (back && back.isConnected && back.getClientRects().length > 0) back.focus();
    else (this.doc.activeElement as HTMLElement | null)?.blur();
  }

  private focusTrigger(at: number): void {
    const b = this.built[at];
    if (!b) return;
    for (const x of this.built) x.trigger.setAttribute("tabindex", x === b ? "0" : "-1");
    b.trigger.focus();
  }

  private buildMenu(def: MenuDef, at: number): HTMLElement {
    const doc = this.doc;
    const id = `menu-${def.id}`;
    const trigger = el(doc, "button", { type: "button", class: "menubar-item", id: `${id}-button`, role: "menuitem", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": id, tabindex: "-1" },
      el(doc, "span", { text: def.label }), uiIcon(doc, "chevron-down"));
    const menu = el(doc, "div", { class: "menu", id, role: "menu", "aria-labelledby": `${id}-button`, hidden: true });
    const built: Built = { def, trigger, menu, items: [] };
    for (const entry of def.items) {
      if (entry === "-") {
        menu.append(el(doc, "div", { class: "menu-separator", role: "separator" }));
        continue;
      }
      const button = newItem(doc, entry);
      button.addEventListener("click", () => this.choose(at, built.items.findIndex((x) => x.button === button)));
      button.addEventListener("pointermove", () => { if (this.doc.activeElement !== button) button.focus(); });
      built.items.push({ button, cmd: entry });
      menu.append(button);
    }
    this.built.push(built);

    trigger.addEventListener("click", () => {
      if (this.openAt === at) this.close();
      else this.open(at, "first");
    });
    // With a menu open, moving the pointer onto another menu's name opens that one instead, as on the desktop.
    trigger.addEventListener("pointerenter", () => {
      if (this.openAt !== -1 && this.openAt !== at) this.open(at, "none");
    });
    trigger.addEventListener("keydown", (e) => this.onTriggerKey(e, at));
    menu.addEventListener("keydown", (e) => this.onMenuKey(e, at));
    return el(doc, "div", { class: "menubar-slot", role: "none" }, trigger, menu);
  }

  /** Fill in what can change (enabled, ticked, the words), then show the menu and put focus on its first or last item. */
  private open(at: number, where: "first" | "last" | "none"): void {
    if (this.openAt !== -1 && this.openAt !== at) this.close(false);
    const b = this.built[at]!;
    for (const { button, cmd } of b.items) drawItem(this.doc, button, cmd);
    b.menu.hidden = false;
    b.trigger.setAttribute("aria-expanded", "true");
    this.openAt = at;
    for (const x of this.built) x.trigger.setAttribute("tabindex", x === b ? "0" : "-1");
    if (where === "none") b.trigger.focus();
    else b.items[where === "first" ? 0 : b.items.length - 1]?.button.focus();
  }

  private choose(at: number, index: number): void {
    const item = this.built[at]?.items[index];
    if (!item || item.button.getAttribute("aria-disabled") === "true") return;
    this.close(false);
    this.lastMenu = at;
    this.leave();
    item.cmd.run();
  }

  private onTriggerKey(e: KeyboardEvent, at: number): void {
    const n = this.built.length;
    const go = (to: number) => {
      e.preventDefault();
      if (this.openAt !== -1) this.open(to, "first");
      else this.focusTrigger(to);
    };
    switch (e.key) {
      case "ArrowRight": go(stepIndex(at, n, 1)); break;
      case "ArrowLeft": go(stepIndex(at, n, -1)); break;
      case "Home": go(0); break;
      case "End": go(n - 1); break;
      case "ArrowDown": case "Enter": case " ": e.preventDefault(); this.open(at, "first"); break;
      case "ArrowUp": e.preventDefault(); this.open(at, "last"); break;
      case "Escape":
        e.preventDefault();
        if (this.openAt !== -1) this.close();
        else this.leave();
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
          const to = letterIndex(this.built.map((b) => b.def.label), at, e.key);
          if (to !== -1) { e.preventDefault(); this.focusTrigger(to); }
        }
    }
  }

  private onMenuKey(e: KeyboardEvent, at: number): void {
    const b = this.built[at]!;
    const now = b.items.findIndex((x) => x.button === this.doc.activeElement);
    const focusItem = (i: number) => b.items[i]?.button.focus();
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); focusItem(stepIndex(now, b.items.length, 1)); break;
      case "ArrowUp": e.preventDefault(); focusItem(stepIndex(now, b.items.length, -1)); break;
      case "Home": e.preventDefault(); focusItem(0); break;
      case "End": e.preventDefault(); focusItem(b.items.length - 1); break;
      case "ArrowRight": e.preventDefault(); this.open(stepIndex(at, this.built.length, 1), "first"); break;
      case "ArrowLeft": e.preventDefault(); this.open(stepIndex(at, this.built.length, -1), "first"); break;
      case "Escape": e.preventDefault(); e.stopPropagation(); this.close(); break;
      case "Tab": this.close(false); break;
      case "Enter": case " ": e.preventDefault(); this.choose(at, now); break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
          const labels = b.items.map((x) => x.button.querySelector(".menu-label")?.textContent ?? x.cmd.label);
          const to = letterIndex(labels, now, e.key);
          if (to !== -1) { e.preventDefault(); focusItem(to); }
        }
    }
  }
}
