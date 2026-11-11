// The parts of the panel and right-click menus that need no page: where a menu goes on the screen, and tidying its separators. The
// menus themselves were driven by keyboard and pointer in the browser (docs/handoff).
import { test } from "node:test";
import assert from "node:assert/strict";
import { placeMenu, tidyEntries } from "./popupmenu.ts";
import type { MenuCommand } from "./menubar.ts";

const view = { width: 1200, height: 800 };
const size = { width: 260, height: 300 };

test("a menu opens under its button, lined up with the button's left edge", () => {
  const button = { left: 100, top: 50, right: 160, bottom: 80 };
  assert.deepEqual(placeMenu(button, size, view), { left: 100, top: 82 });
});

test("near the right edge it lines up with the button's right edge instead, so it stays in the window", () => {
  const button = { left: 1100, top: 50, right: 1160, bottom: 80 };
  assert.deepEqual(placeMenu(button, size, view), { left: 900, top: 82 });
});

test("with no room under the button it opens over it, and with no room either way it is kept inside the window", () => {
  const low = { left: 100, top: 700, right: 160, bottom: 730 };
  assert.deepEqual(placeMenu(low, size, view), { left: 100, top: 398 }, "over the button");
  const tall = { width: 260, height: 790 };
  const p = placeMenu(low, tall, view);
  assert.equal(p.top, 8, "a menu taller than the window starts 8 pixels from the top (it scrolls)");
});

test("a right-click puts the menu at the pointer, and a narrow window keeps it 8 pixels from each side", () => {
  const point = { left: 300, top: 200, right: 300, bottom: 200 };
  assert.deepEqual(placeMenu(point, size, view), { left: 300, top: 202 });
  const phone = { width: 375, height: 700 };
  const wide = { width: 400, height: 200 };
  assert.equal(placeMenu(point, wide, phone).left, 8);
});

test("separators come only between items: never first, last or two together", () => {
  const item = (label: string): MenuCommand => ({ label, run: () => undefined });
  const a = item("A");
  const b = item("B");
  assert.deepEqual(tidyEntries(["-", a, "-", "-", b, "-"]), [a, "-", b]);
  assert.deepEqual(tidyEntries(["-", "-"]), []);
});
