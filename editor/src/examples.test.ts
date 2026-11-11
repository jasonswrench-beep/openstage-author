// The examples the welcome page offers: each is a real example that the installer ships, in the order chosen, with what the program
// found out about it. Opening one copies it (examples_list and copy_example in lib.rs, with tests of their own).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXAMPLE_CARDS, examplesToShow, parseExamples } from "./examples.ts";
import { UI_ICONS } from "./uiicons.gen.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("every example on the welcome page is in the examples folder, is shipped by the installer, and has a line and an icon", () => {
  const installer = readFileSync(path.join(repo, "tools", "build_installer.py"), "utf-8");
  // The list may run over several lines, with comments.
  const list = (/^EXAMPLES = \[([\s\S]*?)\]$/m.exec(installer)?.[1] ?? "").replace(/#.*$/gm, "");
  const shipped = [...list.matchAll(/["']([^"']+)["']/g)].map((x) => x[1]!);
  assert.ok(shipped.length > 0, "the installer's list of examples was found");
  for (const card of EXAMPLE_CARDS) {
    assert.ok(existsSync(path.join(repo, "examples", card.name, "project.json")), `${card.name} is an example`);
    assert.ok(shipped.includes(card.name), `${card.name} comes with the program`);
    assert.ok(card.about.endsWith(".") && card.about.length < 140 && !card.about.includes("—"), `${card.name}: one plain line`);
    assert.ok(card.icon in UI_ICONS, `${card.name}: its icon is in the editor's set`);
  }
  assert.equal(new Set(EXAMPLE_CARDS.map((c) => c.name)).size, EXAMPLE_CARDS.length, "none twice");
});

test("only the examples the program found are shown, in the welcome page's order, with their own titles", () => {
  const shown = examplesToShow([
    { name: "minimal.osproj", title: "What Is Organizational Communication?", slides: 2 },
    { name: "broken.osproj", title: "Deliberately Broken Fixture", slides: 2 },
    { name: "question-types.osproj", title: "Question types", slides: 16 },
    { name: "branching.osproj", title: "  ", slides: 3 },
  ]);
  assert.deepEqual(shown.map((e) => [e.name, e.title, e.slides]), [
    ["question-types.osproj", "Question types", 16],
    ["branching.osproj", "branching", 3],
    ["minimal.osproj", "What Is Organizational Communication?", 2],
  ]);
  assert.deepEqual(examplesToShow([]), []);
});

test("what the program says it found is checked before it is used", () => {
  assert.deepEqual(parseExamples([
    { name: "question-types.osproj", title: "Question types", slides: 16 },
    { name: "../evil.osproj", title: "x", slides: 1 },
    { name: "Upper.osproj", title: "x", slides: 1 },
    { name: "plugins", title: "x", slides: 1 },
    { name: "looks.osproj", slides: "three" },
    "nothing",
  ]), [
    { name: "question-types.osproj", title: "Question types", slides: 16 },
    { name: "looks.osproj", title: "", slides: 0 },
  ]);
  assert.deepEqual(parseExamples({}), []);
});
