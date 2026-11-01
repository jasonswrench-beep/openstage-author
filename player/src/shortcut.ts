// Keyboard shortcuts as a question's answer: Ctrl+Shift+S, Alt+F4, Meta+Space. A learner may type one in their own way ("ctrl + shift + s", "Control+S",
// "Cmd+S") or press the keys; both come to the same canonical form, so an answer is compared as the keys it means, not as the text it was typed as.
// No page here: all of it is tested directly, from the same table of cases the validator's Python reading is tested from (tools/shortcut-cases.json).

export type Modifier = "Ctrl" | "Alt" | "Shift" | "Meta";

/** The order modifiers are written in, whatever order they were pressed or typed. */
export const MODIFIERS: readonly Modifier[] = ["Ctrl", "Alt", "Shift", "Meta"];

export interface Shortcut {
  mods: Modifier[];
  /** One capital letter, a digit, a punctuation mark, F1 to F24, or a name such as Enter, Escape, Space, Up. */
  key: string;
}

const MODIFIER_NAMES: Record<string, Modifier> = {
  ctrl: "Ctrl", control: "Ctrl", ctl: "Ctrl",
  alt: "Alt", option: "Alt", opt: "Alt",
  shift: "Shift",
  meta: "Meta", cmd: "Meta", command: "Meta", win: "Meta", windows: "Meta", super: "Meta", "⌘": "Meta",
};

const KEY_NAMES: Record<string, string> = {
  enter: "Enter", return: "Enter", esc: "Escape", escape: "Escape", tab: "Tab", space: "Space", spacebar: "Space",
  backspace: "Backspace", bksp: "Backspace", delete: "Delete", del: "Delete", insert: "Insert", ins: "Insert",
  home: "Home", end: "End", pageup: "PageUp", pgup: "PageUp", pagedown: "PageDown", pgdn: "PageDown",
  up: "Up", uparrow: "Up", arrowup: "Up", down: "Down", downarrow: "Down", arrowdown: "Down",
  left: "Left", leftarrow: "Left", arrowleft: "Left", right: "Right", rightarrow: "Right", arrowright: "Right",
  plus: "+", minus: "-", comma: ",", period: ".", dot: ".", slash: "/", backslash: "\\", semicolon: ";", equals: "=", equal: "=", backtick: "`", quote: "'",
};

const PUNCTUATION = new Set(["+", "-", ",", ".", "/", "\\", ";", "'", "[", "]", "=", "`"]);

/** One word of what was typed, as a key, or null if it is not one. */
function keyOf(token: string): string | null {
  const t = token.trim();
  if (t === "") return null;
  const lower = t.toLowerCase().replace(/[\s_-]+/g, "");
  if (Object.hasOwn(KEY_NAMES, lower)) return KEY_NAMES[lower]!;
  if (/^f([1-9]|1\d|2[0-4])$/.test(lower)) return lower.toUpperCase();
  if (t.length === 1) return /[a-z]/i.test(t) ? t.toUpperCase() : /[0-9]/.test(t) || PUNCTUATION.has(t) ? t : null;
  return null;
}

/** Read a shortcut however it was written. Null if it is not one: no key, more than one key, a word that is not a key, or only modifiers. */
export function parseShortcut(text: string): Shortcut | null {
  const trimmed = text
    .normalize("NFC")
    .trim()
    // Two words that are one key's name.
    .replace(/\bpage\s+(up|down)\b/gi, "page$1")
    .replace(/\b(up|down|left|right)\s+arrow\b/gi, "$1arrow");
  if (trimmed === "") return null;
  // A final "+" is the plus key itself ("Ctrl++"), not a separator.
  const plusKey = /\+\s*\+$/.test(trimmed) || trimmed === "+";
  const body = plusKey ? trimmed.replace(/\+?\s*\+$/, "") : trimmed;
  const tokens = body === "" ? [] : body.split(/\s*\+\s*|\s+(?=\S)/).filter((t) => t.trim() !== "");
  // "Cmd S" with spaces for pluses is understood when every word but the last is a modifier.
  const mods = new Set<Modifier>();
  const keys: string[] = plusKey ? ["+"] : [];
  for (const token of tokens) {
    const name = token.trim().toLowerCase();
    if (Object.hasOwn(MODIFIER_NAMES, name)) {
      mods.add(MODIFIER_NAMES[name]!);
      continue;
    }
    const key = keyOf(token);
    if (key === null) return null;
    keys.push(key);
  }
  if (keys.length !== 1) return null;
  return { mods: MODIFIERS.filter((m) => mods.has(m)), key: keys[0]! };
}

/** A shortcut written the one way: modifiers in a fixed order, then the key. */
export const formatShortcut = (s: Shortcut): string => [...s.mods, s.key].join("+");

/** The canonical text of a shortcut typed in any way, or null. */
export function canonicalShortcut(text: string): string | null {
  const s = parseShortcut(text);
  return s ? formatShortcut(s) : null;
}

export const sameShortcut = (a: Shortcut, b: Shortcut): boolean => formatShortcut(a) === formatShortcut(b);

/** What a key event is, in the browser's own words, as much as the shortcut needs to know. */
export interface KeyPress {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const CODE_PUNCTUATION: Record<string, string> = { Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Backquote: "`" };

/** Whether a key press is only a modifier going down, which is not yet a shortcut. */
export const isModifierKey = (key: string): boolean => key === "Control" || key === "Alt" || key === "Shift" || key === "Meta" || key === "AltGraph" || key === "OS";

/**
 * The shortcut a key press makes, or null while only modifiers are down. The physical key is used (`code`) for letters, digits and punctuation, so
 * Shift+1 is Shift+1 and not Shift+!, whatever the keyboard layout writes on it.
 */
export function shortcutOf(e: KeyPress): Shortcut | null {
  if (isModifierKey(e.key)) return null;
  const mods = MODIFIERS.filter((m) => (m === "Ctrl" && e.ctrlKey) || (m === "Alt" && e.altKey) || (m === "Shift" && e.shiftKey) || (m === "Meta" && e.metaKey));
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (/^Numpad[0-9]$/.test(e.code)) key = e.code.slice(6);
  else if (Object.hasOwn(CODE_PUNCTUATION, e.code)) key = CODE_PUNCTUATION[e.code]!;
  else key = keyOf(e.key === " " ? "Space" : e.key);
  return key === null ? null : { mods, key };
}

/** Combinations a browser keeps for itself, which a learner cannot press on a page (they can still type them). */
export const BROWSER_KEEPS: readonly string[] = ["Ctrl+W", "Ctrl+T", "Ctrl+N", "Ctrl+Shift+N", "Ctrl+Shift+T", "Ctrl+Shift+W", "Alt+F4", "Ctrl+Tab", "Ctrl+Shift+Tab", "Ctrl+PageUp", "Ctrl+PageDown"];
