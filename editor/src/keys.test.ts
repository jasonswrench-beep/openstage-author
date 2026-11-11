// The list of keys (Help > Keyboard keys, Ctrl+/, and the Keys button under the slide): that it holds every shortcut the design list
// gives a command, that nothing in it is empty, and that the slide's keys can come first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANVAS_DESCRIPTION, KEY_GROUPS, keyGroupsFirst } from "./keys.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const design = JSON.parse(readFileSync(path.join(repo, "design", "icons.json"), "utf-8")) as { products: { author: { command: string; keys?: string }[] } };

test("every shortcut in design/icons.json for Author is in the list of keys", () => {
  const listed = KEY_GROUPS.flatMap((g) => g.rows.map((r) => r.keys)).join(" | ");
  const missing = design.products.author.filter((row) => row.keys && !listed.includes(row.keys)).map((row) => `${row.command} (${row.keys})`);
  assert.deepEqual(missing, []);
});

test("every group has a title and rows, every row has its keys and what they do, and the ids differ", () => {
  const ids = new Set<string>();
  for (const g of KEY_GROUPS) {
    assert.ok(g.title.trim() !== "" && g.rows.length > 0, g.id);
    assert.ok(!ids.has(g.id), g.id);
    ids.add(g.id);
    for (const r of g.rows) assert.ok(r.keys.trim() !== "" && r.does.trim() !== "", `${g.id}: ${r.keys}`);
  }
});

test("the keys under the slide can come first, and nothing is lost or doubled", () => {
  const groups = keyGroupsFirst("canvas");
  assert.equal(groups[0]!.id, "canvas");
  assert.deepEqual([...groups.map((g) => g.id)].sort(), [...KEY_GROUPS.map((g) => g.id)].sort());
  assert.deepEqual(keyGroupsFirst().map((g) => g.id), KEY_GROUPS.map((g) => g.id));
  assert.deepEqual(keyGroupsFirst("nothing").map((g) => g.id), KEY_GROUPS.map((g) => g.id));
});

test("what a screen reader hears on the slide is short and says where the rest of the keys are", () => {
  assert.ok(CANVAS_DESCRIPTION.length < 260, String(CANVAS_DESCRIPTION.length));
  assert.match(CANVAS_DESCRIPTION, /Ctrl\+\/ lists every key/);
});
