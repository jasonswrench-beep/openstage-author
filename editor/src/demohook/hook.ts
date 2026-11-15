// The demo-mode hook: a small library a program includes so OpenStage Studio can perform scripts in it.
//
// * Off by default. It starts only when the program was launched with the demo flag (its shell then sets the settings
//   global, see protocol.ts), and it only ever talks to this computer.
// * Controls are found by stable names, never by their visible labels: mark each one with `data-demo-id`, as in
//   `<button data-demo-id="toolbar.lesson.new">New lesson</button>`. Rewording a button does not break any script.
// * It lists controls, reports where they are, clicks, types, presses keys, scrolls, loads a named demo project and
//   resets to a known state.
// * In demo mode the page holds still: the text caret does not blink and transitions are off, so a still picture of a
//   step always looks the same.
//
// Adding it to a program: import { startDemoHook } from "<path>/demo-hook/hook.ts" and call it once at start-up with the
// program's demo-project loader. See docs/demo-hook.md.

import {
  HOOK_VERSION, readSettings, steadySelector, type Command, type ControlInfo, type Envelope, type Hello, type HookSettings, type Reply,
  type TextOnScreen,
} from "./protocol.ts";

export interface DemoHookOptions {
  /** The program's name, for the player's log. */
  program: string;
  /** Open a demo project from the program's demo library, by name. */
  loadDemo(name: string): void | Promise<void>;
  /** Put the program back to a known state (no dialogs open, nothing selected). */
  reset(): void | Promise<void>;
  /** Settings to use instead of reading them from the page (for tests). */
  settings?: HookSettings;
}

export interface DemoHook {
  stop(): void;
}

// In demo mode the page holds still and ignores the real mouse: a pointer resting over the window cannot give a control
// its hover look, and a stray click cannot spoil the take. The hook's own clicks are unaffected.
const STEADY_CSS = `
*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; scroll-behavior: auto !important; pointer-events: none !important; }
:focus-visible { outline-style: none; }
select { will-change: transform; appearance: none !important; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 6l4.5 4.5L12.5 6' fill='none' stroke='%23444' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") !important; background-repeat: no-repeat !important; background-position: right 0.7em center !important; background-size: 1em !important; padding-right: 2.2em !important; }
`;
// Windows draws some controls itself and draws them differently when the program's window is not the active one. A
// drop-down list is the one that shows in pictures, so in demo mode it is drawn by the page instead (the same box and
// colours, with a plain arrow), and its look no longer depends on which window is active.
// Each list is also drawn on a layer of its own (will-change), which fixes how its words are smoothed: otherwise the browser
// chose between plain grey and coloured fringes by itself, which made two takes differ.

export function controlLabel(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim() ?? "").join(" ").trim();
    if (text) return text;
  }
  const label = (el as HTMLInputElement).labels?.[0];
  if (label) {
    // The label’s own words, without the words of a control inside it (a list’s choices, say).
    const copy = label.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("input, select, textarea, button").forEach((n) => n.remove());
    const text = copy.textContent?.replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  const text = (el as HTMLElement).innerText?.trim() || el.textContent?.trim();
  if (text) return text.replace(/\s+/g, " ").slice(0, 80);
  return el.getAttribute("title") ?? el.getAttribute("placeholder") ?? "";
}

function controlRole(el: Element): string {
  const role = el.getAttribute("role");
  if (role) return role;
  const tag = el.tagName.toLowerCase();
  if (tag === "input") return (el as HTMLInputElement).type === "checkbox" ? "checkbox" : "textbox";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  if (tag === "a") return "link";
  return tag === "button" ? "button" : tag;
}

function find(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-demo-id="${CSS.escape(id)}"]`);
  if (!el) throw new Error(`There is no control called "${id}" on screen.`);
  return el;
}

function info(el: HTMLElement): ControlInfo {
  const r = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const visible = r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  return {
    id: el.dataset.demoId!,
    label: controlLabel(el),
    role: controlRole(el),
    rect: [r.left, r.top, r.width, r.height],
    visible,
    enabled: !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true",
  };
}

/** The control that has the keyboard focus, as the hook keeps it. When the program's window is not the active one, the page
 * does not record focus given to a control (by the hook or by the program itself), so in demo mode the hook keeps it:
 * every call to focus() and blur() is noted (see watchFocus), and nothing else counts. That way a take looks the same
 * whether or not its window is in front. */
let lastFocus: HTMLElement | null = null;

/** In demo mode, note every focus() and blur() call the page makes. */
function watchFocus() {
  const realFocus = HTMLElement.prototype.focus;
  const realBlur = HTMLElement.prototype.blur;
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    lastFocus = this;
    return realFocus.call(this, options);
  };
  HTMLElement.prototype.blur = function (this: HTMLElement) {
    if (lastFocus === this) lastFocus = null;
    return realBlur.call(this);
  };
}

/** Give a control the keyboard focus, and remember it. */
function focusOn(el: HTMLElement, byKey = false) {
  el.focus({ preventScroll: true });
  lastFocus = el;
  focusByKey = byKey;
}

/** What has the keyboard focus now, as the hook keeps it (a control that has left the page has lost it). */
function focused(): HTMLElement | null {
  return lastFocus && lastFocus.isConnected ? lastFocus : null;
}

/** Whether the last focus came from a key (Tab), which shows a focus ring on any control, or from a click, which shows one
 * only on fields you type in. */
let focusByKey = false;
const STATE_MARKS = ["data-demo-focus", "data-demo-focus-visible", "data-demo-focus-within"];

/** Rewrite the page's style rules so focus and hover follow the hook's markers (see steadySelector). Rules added since the
 * last time are rewritten too; rules from other sites cannot be read and are left as they are. */
function steadySheets() {
  const rewrite = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        const next = steadySelector(rule.selectorText);
        if (next !== rule.selectorText) rule.selectorText = next;
      }
      if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) rewrite((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of [...Array.from(document.styleSheets), ...(document.adoptedStyleSheets ?? [])]) {
    try {
      rewrite(sheet.cssRules);
    } catch {
      // A sheet from another site cannot be read.
    }
  }
}

/** Put the focus markers on the control that has the focus and on what holds it. */
function markFocus() {
  for (const name of STATE_MARKS) document.querySelectorAll(`[${name}]`).forEach((el) => el.removeAttribute(name));
  const el = focused();
  if (!el) return;
  el.setAttribute("data-demo-focus", "");
  if (focusByKey || takesText(el)) el.setAttribute("data-demo-focus-visible", "");
  for (let p: Element | null = el; p; p = p.parentElement) p.setAttribute("data-demo-focus-within", "");
}

/** Whether typing can go into this control. */
function takesText(el: HTMLElement): boolean {
  return el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable ||
    (el instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit", "reset", "file", "image", "range", "color"].includes(el.type));
}

const frames = (n: number) => new Promise<void>((done) => {
  const tick = (k: number) => (k <= 0 ? done() : requestAnimationFrame(() => tick(k - 1)));
  tick(n);
});

/** Put text into a text field or editable area as if typed: one character at a time, with the events a keyboard sends. */
function typeInto(el: HTMLElement, text: string) {
  for (const ch of text) {
    const init = { key: ch, bubbles: true, cancelable: true };
    const go = el.dispatchEvent(new KeyboardEvent("keydown", init));
    if (go) {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        el.setRangeText(ch, start, end, "end");
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
      } else if (el.isContentEditable) {
        document.execCommand("insertText", false, ch);
      }
    }
    el.dispatchEvent(new KeyboardEvent("keyup", init));
  }
}

function focusables(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1']), [contenteditable='true']")]
    .filter((el) => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0);
}

function pressKey(target: HTMLElement, key: string, modifiers: string[]) {
  const name = key === "Space" ? " " : key.length === 1 ? key.toLowerCase() : key;
  const init: KeyboardEventInit = {
    key: name, bubbles: true, cancelable: true,
    ctrlKey: modifiers.includes("Ctrl"), altKey: modifiers.includes("Alt"), shiftKey: modifiers.includes("Shift"),
  };
  const go = target.dispatchEvent(new KeyboardEvent("keydown", init));
  if (go) {
    // What the browser would do itself for these keys when nothing handled them.
    if (key === "Tab") {
      const list = focusables();
      const i = list.indexOf(document.activeElement as HTMLElement);
      const next = list[(i + (init.shiftKey ? -1 : 1) + list.length) % list.length];
      next?.focus();
    } else if ((key === "Enter" || key === "Space") && (target instanceof HTMLButtonElement || target.getAttribute("role") === "button")) {
      target.click();
    } else if (key === "Backspace" && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      const s = target.selectionStart ?? 0;
      const e = target.selectionEnd ?? 0;
      if (s !== e) target.setRangeText("", s, e, "end");
      else if (s > 0) target.setRangeText("", s - 1, s, "end");
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    } else if (key === "Enter" && target instanceof HTMLTextAreaElement) {
      typeInto(target, "\n");
    }
  }
  target.dispatchEvent(new KeyboardEvent("keyup", init));
}

async function perform(command: Command, options: DemoHookOptions): Promise<unknown> {
  switch (command.cmd) {
    case "hello": {
      const hello: Hello = {
        program: options.program, hookVersion: HOOK_VERSION, viewport: [innerWidth, innerHeight],
        devicePixelRatio, controls: document.querySelectorAll("[data-demo-id]").length,
      };
      return hello;
    }
    case "list":
      return { viewport: [innerWidth, innerHeight], controls: [...document.querySelectorAll<HTMLElement>("[data-demo-id]")].map(info) };
    case "position":
      return { viewport: [innerWidth, innerHeight], control: info(find(command.id)) };
    case "hover": {
      document.querySelectorAll("[data-demo-hover]").forEach((el) => el.removeAttribute("data-demo-hover"));
      if (command.id) find(command.id).setAttribute("data-demo-hover", "");
      return null;
    }
    case "click": {
      const el = find(command.id);
      if (!info(el).enabled) throw new Error(`The control "${command.id}" is switched off and cannot be clicked.`);
      document.querySelectorAll("[data-demo-hover]").forEach((h) => h.removeAttribute("data-demo-hover"));
      focusOn(el);
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
        el.dispatchEvent(new (type.startsWith("pointer") ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true, button: 0 }));
      }
      el.click();
      return null;
    }
    case "focus":
      focusOn(find(command.id));
      return null;
    case "type": {
      const el = command.id ? find(command.id) : focused();
      if (!el) throw new Error("Nothing has the keyboard focus to type into. Give the step a target.");
      if (!takesText(el)) throw new Error(`The control with the keyboard focus (${el.dataset.demoId ?? el.tagName.toLowerCase()}) cannot take typing. Give the step a target.`);
      if (command.id || document.activeElement !== el) focusOn(el);
      if (el instanceof HTMLSelectElement) {
        // A drop-down list: typing its option's words chooses it, as typing does on a focused list.
        const wanted = command.text.trim().toLowerCase();
        const option = [...el.options].find((o) => o.text.trim().toLowerCase() === wanted) ?? [...el.options].find((o) => o.text.trim().toLowerCase().startsWith(wanted));
        if (!option) throw new Error(`The list "${el.dataset.demoId}" has no choice called "${command.text}".`);
        el.value = option.value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return null;
      }
      typeInto(el, command.text);
      return null;
    }
    case "key": {
      const el = command.id ? find(command.id) : (focused() ?? document.body);
      if (command.id) focusOn(el);
      pressKey(el, command.key, command.modifiers);
      if (command.key === "Tab") focusByKey = true;
      return null;
    }
    case "scroll": {
      const el = command.id ? find(command.id) : (document.scrollingElement as HTMLElement);
      el.scrollBy(command.axis === "y" ? { top: command.amount } : { left: command.amount });
      return null;
    }
    case "loadDemo":
      await options.loadDemo(command.name);
      return null;
    case "reset":
      await options.reset();
      return null;
    case "settle":
      steadySheets();
      markFocus();
      await document.fonts.ready;
      await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
      await frames(2);
      return null;
    case "text":
      return { viewport: [innerWidth, innerHeight], items: textOnScreen() };
  }
}

/** Elements whose text never shows as it is (or shows only when opened, such as a drop-down list's choices). */
const NO_TEXT = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "SELECT", "OPTION", "OPTGROUP", "DATALIST", "TEXTAREA"]);

/** The part of the page an element can show through: the window, cut down by every scrolling or clipping box around it. */
function clipOf(el: Element): DOMRect | null {
  let [left, top, right, bottom] = [0, 0, innerWidth, innerHeight];
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.overflowX !== "visible" || s.overflowY !== "visible") {
      const r = p.getBoundingClientRect();
      left = Math.max(left, r.left);
      top = Math.max(top, r.top);
      right = Math.min(right, r.right);
      bottom = Math.min(bottom, r.bottom);
    }
  }
  return right > left && bottom > top ? new DOMRect(left, top, right - left, bottom - top) : null;
}

function shows(el: Element): boolean {
  for (let p: Element | null = el; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
  }
  return true;
}

/** The visible part of a rectangle, or null if none of it shows. */
function within(r: DOMRect, clip: DOMRect): [number, number, number, number] | null {
  const left = Math.max(r.left, clip.left), top = Math.max(r.top, clip.top);
  const right = Math.min(r.right, clip.right), bottom = Math.min(r.bottom, clip.bottom);
  return right - left >= 1 && bottom - top >= 1 ? [left, top, right - left, bottom - top] : null;
}

/** Every piece of text the viewer can see, with where it is: the page's words, what is typed in fields (or their
 * placeholder when empty), and the choice showing in each drop-down list. Used by the frame scan, never by the take. */
function textOnScreen(): TextOnScreen[] {
  const out: TextOnScreen[] = [];
  const clips = new Map<Element, DOMRect | null>();
  const clip = (el: Element) => {
    if (!clips.has(el)) clips.set(el, shows(el) ? clipOf(el) : null);
    return clips.get(el)!;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      for (let p = n.parentElement; p; p = p.parentElement) if (NO_TEXT.has(p.tagName)) return NodeFilter.FILTER_REJECT;
      return n.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement!;
    const c = clip(el);
    if (!c) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    // One piece per line the text wraps onto, so each has its own place.
    const lines = [...range.getClientRects()].map((r) => within(r, c)).filter((r): r is [number, number, number, number] => r !== null);
    if (!lines.length) continue;
    const text = n.textContent!.replace(/\s+/g, " ").trim();
    const left = Math.min(...lines.map((r) => r[0])), top = Math.min(...lines.map((r) => r[1]));
    const right = Math.max(...lines.map((r) => r[0] + r[2])), bottom = Math.max(...lines.map((r) => r[1] + r[3]));
    out.push({ text, rect: [left, top, right - left, bottom - top] });
  }
  for (const el of document.querySelectorAll<HTMLElement>("input, textarea, select")) {
    let text = "";
    if (el instanceof HTMLSelectElement) text = el.selectedOptions[0]?.text ?? "";
    else if (el instanceof HTMLInputElement && ["checkbox", "radio", "range", "color", "file", "hidden"].includes(el.type)) continue;
    else {
      const field = el as HTMLInputElement | HTMLTextAreaElement;
      text = field.type === "password" ? "" : field.value || field.placeholder;
    }
    if (!text.trim()) continue;
    const c = clip(el);
    const r = c && within(el.getBoundingClientRect(), c);
    if (r) out.push({ text: text.replace(/\s+/g, " ").trim(), rect: r });
  }
  return out;
}

/** Start the hook if the program was launched in demo mode. Returns null (and does nothing) otherwise. */
export function startDemoHook(options: DemoHookOptions): DemoHook | null {
  const settings = options.settings ?? readSettings(globalThis as unknown as Record<string, unknown>, location.search);
  if (!settings) return null;
  const style = document.createElement("style");
  style.dataset.demoHook = "steady";
  style.textContent = STEADY_CSS;
  document.head.append(style);
  document.documentElement.dataset.demoMode = "on";
  steadySheets();
  watchFocus();

  let stopped = false;
  const url = (path: string) => `${settings.endpoint}/hook/${path}?token=${encodeURIComponent(settings.token)}`;
  const loop = async () => {
    while (!stopped) {
      let envelope: Envelope | null = null;
      try {
        const res = await fetch(url("next"), { cache: "no-store" });
        if (res.status === 204) continue;
        if (res.status === 410) break; // the take is over
        if (!res.ok) throw new Error(`The player answered ${res.status}.`);
        envelope = (await res.json()) as Envelope;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      let reply: Reply;
      try {
        reply = { seq: envelope.seq, ok: true, result: await perform(envelope, options) };
      } catch (e) {
        reply = { seq: envelope.seq, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      try {
        // Plain text, so the browser sends it without asking the player first.
        await fetch(url("reply"), { method: "POST", body: JSON.stringify(reply), headers: { "Content-Type": "text/plain" } });
      } catch {
        // The player will time out and say so.
      }
    }
  };
  void loop();
  return {
    stop() {
      stopped = true;
      style.remove();
      delete document.documentElement.dataset.demoMode;
    },
  };
}
