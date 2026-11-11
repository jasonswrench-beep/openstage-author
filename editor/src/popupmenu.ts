// Menus that open from a button on a panel (the Add and "..." buttons on the Slides and Objects panels and the layer bar), or from a
// right-click on a slide, an object or the canvas. They follow the menu button pattern of the WAI-ARIA Authoring Practices and behave
// like the menus under the top bar (menubar.ts):
//  - Enter, Space or Down on the button opens the menu on its first item; Up opens it on its last.
//  - In the menu, Up and Down move (round from the end to the start), Home and End go to the first and last item, a letter goes to the
//    next item that starts with it, Enter or Space chooses, Escape or Tab closes the menu and goes back to where it was opened from.
//  - A right-click, Shift+F10 or the Menu key on a slide, an object or the canvas opens the same kind of menu there (app.ts).
//  - An item that cannot be used now stays in the menu, dimmed, so people learn where things are.
//  - Choosing an item first puts focus back where the menu was opened from, then runs the command, so a dialog the command opens
//    gives focus back to that place when it closes.
// The pure part (where the menu goes on the screen) is at the top, so it can be tested without a page.

import { drawItem, el, letterIndex, newItem, stepIndex, uiIcon, type MenuCommand, type MenuEntry } from "./menubar.ts";
import type { UiIconName } from "./uiicons.gen.ts";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where a menu of this size goes: under the box (or over it, if there is no room under but there is over), lined up with the box's
 * left edge (or its right edge, if there is no room to the right), and always at least `margin` from the edges of the window.
 */
export function placeMenu(anchor: Box, size: { width: number; height: number }, view: { width: number; height: number }, margin = 8): { left: number; top: number } {
  let left = anchor.left;
  if (left + size.width > view.width - margin) left = anchor.right - size.width;
  left = Math.max(margin, Math.min(left, view.width - margin - size.width));
  let top = anchor.bottom + 2;
  if (top + size.height > view.height - margin && anchor.top - 2 - size.height >= margin) top = anchor.top - 2 - size.height;
  top = Math.max(margin, Math.min(top, view.height - margin - size.height));
  return { left, top };
}

/** Separators only between items: none at the start or the end, and never two together. */
export function tidyEntries(entries: readonly MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const e of entries) {
    if (e === "-" && (out.length === 0 || out[out.length - 1] === "-")) continue;
    out.push(e);
  }
  while (out[out.length - 1] === "-") out.pop();
  return out;
}

// ---- the page

/** Only one of these menus is open at a time. */
let openNow: PopupMenu | null = null;

function isElement(at: unknown): at is HTMLElement {
  return typeof (at as HTMLElement | null)?.getBoundingClientRect === "function";
}

export interface OpenOptions {
  /** Where focus goes when the menu closes; asked then, because what was there may have been drawn again meanwhile. */
  returnTo?: () => HTMLElement | null;
  /** The button that opened it, which says whether its menu is open. */
  trigger?: HTMLElement;
  /** Which item has focus when it opens. */
  where?: "first" | "last";
  /** What a screen reader calls the menu, if not what it was made with. */
  label?: string;
}

export class PopupMenu {
  readonly element: HTMLElement;
  private readonly doc: Document;
  private readonly label: string;
  private items: { button: HTMLElement; cmd: MenuCommand }[] = [];
  private returnTo: (() => HTMLElement | null) | null = null;
  private trigger: HTMLElement | null = null;

  constructor(doc: Document, id: string, label: string) {
    this.doc = doc;
    this.label = label;
    this.element = el(doc, "div", { class: "menu popup-menu", id, role: "menu", "aria-label": label, hidden: true });
    doc.body.append(this.element);
    this.element.addEventListener("keydown", (e) => this.onKey(e));
    // Focus going somewhere else (F10 to the top menus, say) closes it. Not the button that opened it: pressing that closes it itself.
    this.element.addEventListener("focusout", (e) => {
      const to = e.relatedTarget as Node | null;
      if (to && !this.element.contains(to) && !this.trigger?.contains(to)) this.close(false);
    });
    // So does a click anywhere else (the button that opened it closes it itself), scrolling under it, the window changing size,
    // and leaving the program.
    doc.addEventListener("pointerdown", (e) => {
      const on = e.target as Node;
      if (this.isOpen && !this.element.contains(on) && !this.trigger?.contains(on)) this.close(false);
    }, true);
    doc.addEventListener("scroll", (e) => {
      if (this.isOpen && !this.element.contains(e.target as Node)) this.close(false);
    }, true);
    doc.defaultView?.addEventListener("resize", () => this.close(false));
    doc.defaultView?.addEventListener("blur", () => this.close(false));
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  /** Show these commands beside `at` (an element, or a point on the screen), with focus on the first item (or the last). */
  open(entries: readonly MenuEntry[], at: HTMLElement | { x: number; y: number }, opts: OpenOptions = {}): void {
    if (openNow && openNow !== this) openNow.close(false);
    this.close(false);
    const doc = this.doc;
    this.items = [];
    const kids: HTMLElement[] = [];
    for (const entry of tidyEntries(entries)) {
      if (entry === "-") {
        kids.push(el(doc, "div", { class: "menu-separator", role: "separator" }));
        continue;
      }
      const button = newItem(doc, entry);
      drawItem(doc, button, entry);
      button.addEventListener("click", () => this.choose(button));
      button.addEventListener("pointermove", () => { if (doc.activeElement !== button) button.focus(); });
      this.items.push({ button, cmd: entry });
      kids.push(button);
    }
    this.element.replaceChildren(...kids);
    this.element.setAttribute("aria-label", opts.label ?? this.label);
    this.trigger = opts.trigger ?? null;
    const from = isElement(at) ? at : null;
    this.returnTo = opts.returnTo ?? (() => from ?? this.trigger);
    this.trigger?.setAttribute("aria-expanded", "true");

    // Measured where it cannot push anything about, then put in its place.
    this.element.style.left = "0px";
    this.element.style.top = "0px";
    this.element.hidden = false;
    const box = isElement(at) ? at.getBoundingClientRect() : { left: at.x, top: at.y, right: at.x, bottom: at.y };
    const size = this.element.getBoundingClientRect();
    const view = { width: doc.documentElement.clientWidth, height: doc.documentElement.clientHeight };
    const p = placeMenu(box, { width: size.width, height: size.height }, view);
    this.element.style.left = `${Math.round(p.left)}px`;
    this.element.style.top = `${Math.round(p.top)}px`;
    openNow = this;
    this.items[(opts.where ?? "first") === "first" ? 0 : this.items.length - 1]?.button.focus();
  }

  /** Close it; with `giveBack`, focus goes back to where it was opened from. */
  close(giveBack = true): void {
    if (!this.isOpen) return;
    this.element.hidden = true;
    this.trigger?.setAttribute("aria-expanded", "false");
    if (openNow === this) openNow = null;
    if (giveBack) {
      const back = this.returnTo?.();
      if (back && back.isConnected) back.focus();
    }
  }

  private choose(button: HTMLElement): void {
    const item = this.items.find((x) => x.button === button);
    if (!item || button.getAttribute("aria-disabled") === "true") return;
    this.close(true);
    item.cmd.run();
  }

  private onKey(e: KeyboardEvent): void {
    const now = this.items.findIndex((x) => x.button === this.doc.activeElement);
    const go = (i: number) => this.items[i]?.button.focus();
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); go(stepIndex(now, this.items.length, 1)); break;
      case "ArrowUp": e.preventDefault(); go(stepIndex(now, this.items.length, -1)); break;
      case "Home": e.preventDefault(); go(0); break;
      case "End": e.preventDefault(); go(this.items.length - 1); break;
      case "Escape": e.preventDefault(); e.stopPropagation(); this.close(true); break;
      case "Tab": e.preventDefault(); this.close(true); break;
      case "Enter": case " ":
        e.preventDefault();
        if (now !== -1) this.choose(this.items[now]!.button);
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
          const labels = this.items.map((x) => x.button.querySelector(".menu-label")?.textContent ?? x.cmd.label);
          const to = letterIndex(labels, now, e.key);
          if (to !== -1) { e.preventDefault(); go(to); }
        }
    }
  }
}

export interface MenuButtonOptions {
  /** Its id; its menu's id is this with "-menu" after it. */
  id: string;
  /** The word shown beside the icon ("Add"), if any. Without one, the button shows only its icon. */
  text?: string;
  /** What a screen reader calls it ("Add slides"). It starts with the shown word, so someone who says "click Add" reaches it. */
  name: string;
  icon: UiIconName;
  /** Shown when the pointer rests on it; its name if there is none. */
  title?: string;
  /** What is in its menu, asked each time it opens. */
  entries: () => readonly MenuEntry[];
}

/** A button that opens a menu under it: "+ Add" with its word, or "..." with only its icon (and its name for a screen reader and the tooltip). */
export function menuButton(doc: Document, opts: MenuButtonOptions): { button: HTMLButtonElement; menu: PopupMenu } {
  const menuId = `${opts.id}-menu`;
  const menu = new PopupMenu(doc, menuId, opts.name);
  const button = el(doc, "button", { type: "button", class: `panel-menu-button${opts.text ? "" : " icon-only"}`, id: opts.id, "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": menuId, title: opts.title ?? opts.name },
    uiIcon(doc, opts.icon));
  if (opts.text) button.append(el(doc, "span", { text: opts.text }));
  if (opts.name !== opts.text) button.setAttribute("aria-label", opts.name);
  const show = (where: "first" | "last") => menu.open(opts.entries(), button, { trigger: button, where, returnTo: () => button });
  button.addEventListener("click", () => {
    if (menu.isOpen) menu.close(true);
    else show("first");
  });
  button.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); show("first"); }
    else if (e.key === "ArrowUp") { e.preventDefault(); show("last"); }
  });
  return { button, menu };
}
