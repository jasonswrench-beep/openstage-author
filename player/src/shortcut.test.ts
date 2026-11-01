import assert from "node:assert/strict";
import { test } from "node:test";
import cases from "../../tools/shortcut-cases.json" with { type: "json" };
import { BROWSER_KEEPS, canonicalShortcut, formatShortcut, isModifierKey, parseShortcut, sameShortcut, shortcutOf, type KeyPress } from "./shortcut.ts";

test("a shortcut typed in any way is read as the keys it means, from the table the validator is tested from too", () => {
  for (const [typed, canonical] of cases.canonical as [string, string][]) assert.equal(canonicalShortcut(typed), canonical, JSON.stringify(typed));
});

test("what is not a shortcut is refused: no key, two keys, a word that is not a key, only modifiers", () => {
  for (const typed of cases.refused) assert.equal(parseShortcut(typed), null, JSON.stringify(typed));
});

test("the canonical form reads back as itself, so it can be written into a course and compared later", () => {
  for (const [, canonical] of cases.canonical as [string, string][]) assert.equal(canonicalShortcut(canonical), canonical, canonical);
});

test("two shortcuts are the same when they are the same keys, whatever order or words they were written in", () => {
  assert.ok(sameShortcut(parseShortcut("shift + ctrl + s")!, parseShortcut("Control+Shift+S")!));
  assert.ok(!sameShortcut(parseShortcut("Ctrl+S")!, parseShortcut("Ctrl+Shift+S")!));
  assert.ok(!sameShortcut(parseShortcut("Ctrl+S")!, parseShortcut("Alt+S")!));
  assert.equal(formatShortcut({ mods: ["Meta"], key: "K" }), "Meta+K");
});

const press = (key: string, code: string, mods: Partial<KeyPress> = {}): KeyPress => ({ key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test("a key press is the shortcut it makes, by the physical key, so a keyboard layout does not change the answer", () => {
  assert.equal(formatShortcut(shortcutOf(press("s", "KeyS", { ctrlKey: true }))!), "Ctrl+S");
  assert.equal(formatShortcut(shortcutOf(press("S", "KeyS", { ctrlKey: true, shiftKey: true }))!), "Ctrl+Shift+S");
  assert.equal(formatShortcut(shortcutOf(press("!", "Digit1", { shiftKey: true }))!), "Shift+1", "Shift+1, not Shift+!");
  assert.equal(formatShortcut(shortcutOf(press("é", "Digit2", { altKey: true }))!), "Alt+2");
  assert.equal(formatShortcut(shortcutOf(press("-", "Minus", { ctrlKey: true }))!), "Ctrl+-");
  assert.equal(formatShortcut(shortcutOf(press("+", "Equal", { ctrlKey: true, shiftKey: true }))!), "Ctrl+Shift+=");
  assert.equal(formatShortcut(shortcutOf(press("ArrowUp", "ArrowUp", { altKey: true }))!), "Alt+Up");
  assert.equal(formatShortcut(shortcutOf(press(" ", "Space", { ctrlKey: true }))!), "Ctrl+Space");
  assert.equal(formatShortcut(shortcutOf(press("F5", "F5"))!), "F5");
  assert.equal(formatShortcut(shortcutOf(press("Enter", "Enter", { metaKey: true }))!), "Meta+Enter");
  assert.equal(formatShortcut(shortcutOf(press("PageDown", "PageDown", { ctrlKey: true, altKey: true }))!), "Ctrl+Alt+PageDown");
  assert.equal(formatShortcut(shortcutOf(press("5", "Numpad5", { ctrlKey: true }))!), "Ctrl+5");
});

test("a modifier on its own is not yet a shortcut, and a key with no name is not one either", () => {
  for (const key of ["Control", "Alt", "Shift", "Meta", "AltGraph", "OS"]) {
    assert.equal(isModifierKey(key), true, key);
    assert.equal(shortcutOf(press(key, `${key}Left`, { ctrlKey: true })), null, key);
  }
  assert.equal(isModifierKey("a"), false);
  assert.equal(shortcutOf(press("Dead", "Quote")) !== null, true, "a dead key is still the key under the finger");
  assert.equal(shortcutOf(press("Unidentified", "IntlRo")), null);
});

test("the combinations a browser keeps for itself are listed in the canonical form, and the validator lists the same", () => {
  for (const keep of BROWSER_KEEPS) assert.equal(canonicalShortcut(keep), keep, keep);
  assert.deepEqual([...BROWSER_KEEPS], cases.browserKeeps);
});
