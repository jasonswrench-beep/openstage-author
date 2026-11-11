// The parts of the command search (Ctrl+K) that need no page: which commands fit what was typed and in what order, listing each
// command once with the menus it is in, and the words under the box. The window itself was driven by keyboard and pointer in the
// browser (docs/handoff).
import { test } from "node:test";
import assert from "node:assert/strict";
import { foundText, menusText, plain, rankCommands, scoreCommand, searchEntries } from "./commandsearch.ts";
import type { MenuCommand, MenuDef } from "./menubar.ts";

const cmd = (label: string, extra: Partial<MenuCommand> = {}): MenuCommand => ({ label, run: () => undefined, ...extra });

test("words are compared without case, without the dots after a name, and with either spelling of colour", () => {
  assert.equal(plain("New slide..."), "new slide");
  assert.equal(plain("Record the screen (OpenScreen)..."), "record the screen openscreen");
  assert.equal(plain("The colours, fonts and backgrounds"), "the colors fonts and backgrounds");
  assert.equal(plain("Behaviour"), "behavior");
});

test("its name exactly beats its name starting with what was typed, which beats words starting words of the name", () => {
  const exact = scoreCommand("save", "Save");
  const starts = scoreCommand("sav", "Save as...");
  const wordStarts = scoreCommand("lay ear", "Move layer earlier");
  const inside = scoreCommand("ayer", "Move layer earlier");
  assert.ok(exact > starts && starts > wordStarts && wordStarts > inside && inside > 0, `${exact} ${starts} ${wordStarts} ${inside}`);
});

test("the words of its menu and of its description find it too, less well than its name", () => {
  assert.ok(scoreCommand("design", "Themes...", ["Design"]) > 0);
  const byTitle = scoreCommand("scorm", "Publish...", ["File"], "Make packages for your LMS: SCORM 1.2, SCORM 2004 and xAPI");
  assert.ok(byTitle > 0);
  assert.ok(byTitle < scoreCommand("pub", "Publish..."));
  // In a description a short word has to be a whole word: "lms" finds Publish, "lay" does not find every command that mentions a layer.
  assert.ok(scoreCommand("lms", "Publish...", ["File"], "Make packages for your LMS: SCORM 1.2, SCORM 2004 and xAPI") > 0);
  assert.equal(scoreCommand("lay", "Paste", ["Edit"], "Paste the copied objects on this layer"), 0);
  assert.equal(scoreCommand("an", "Publish...", ["File"], "Make packages and more"), 0);
  assert.equal(scoreCommand("zebra", "Publish...", ["File"], "Make packages"), 0);
});

test("a whole word of the name beats the start of one, so \"slide\" puts New slide before Share slides", () => {
  const entries = searchEntries([
    { id: "file", label: "File", items: [cmd("Share slides..."), cmd("Add slides from a file...")] },
    { id: "slide", label: "Slide", items: [cmd("New slide..."), cmd("Duplicate slide")] },
  ]);
  assert.deepEqual(rankCommands(entries, "slide").map((f) => f.label), ["New slide...", "Duplicate slide", "Share slides...", "Add slides from a file..."]);
});

test("a command in two menus is listed once, with both, in the order of the menus", () => {
  const preview = cmd("Preview");
  const menus: MenuDef[] = [
    { id: "file", label: "File", items: [cmd("New project..."), "-", preview] },
    { id: "review", label: "Review", items: [cmd("Problems"), preview] },
  ];
  const entries = searchEntries(menus);
  assert.deepEqual(entries.map((e) => e.cmd.label), ["New project...", "Preview", "Problems"]);
  assert.deepEqual(entries[1]!.menus, ["File", "Review"]);
});

test("a copy of a command with another name (Add slides from a file... in File) is still the same command", () => {
  const run = () => undefined;
  const menus: MenuDef[] = [
    { id: "file", label: "File", items: [{ label: "Add slides from a file...", run }] },
    { id: "slide", label: "Slide", items: [{ label: "Slides from a file...", run }] },
  ];
  const entries = searchEntries(menus);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0]!.menus, ["File", "Slide"]);
});

test("with nothing typed, every command in the order of the menus; with words, the best first and ties in menu order", () => {
  const entries = searchEntries([
    { id: "slide", label: "Slide", items: [cmd("New slide..."), cmd("Delete slide"), cmd("Move layer earlier")] },
    { id: "edit", label: "Edit", items: [cmd("Delete")] },
  ]);
  assert.deepEqual(rankCommands(entries, "").map((f) => f.label), ["New slide...", "Delete slide", "Move layer earlier", "Delete"]);
  assert.deepEqual(rankCommands(entries, "delete").map((f) => f.label), ["Delete", "Delete slide"]);
  // "slide" is a word of two names, and the name of the menu the third is in.
  assert.deepEqual(rankCommands(entries, "slide").map((f) => f.label), ["New slide...", "Delete slide", "Move layer earlier"]);
  assert.deepEqual(rankCommands(entries, "  ").length, 4);
});

test("a command whose name changes is found by either name, and shown by the name it has now", () => {
  const lock = cmd("Lock", { labelNow: () => "Unlock" });
  const entries = searchEntries([{ id: "edit", label: "Edit", items: [lock] }]);
  assert.deepEqual(rankCommands(entries, "unlock").map((f) => f.label), ["Unlock"]);
  assert.deepEqual(rankCommands(entries, "lock").map((f) => f.label), ["Unlock"]);
});

test("where a command is, and what was found, in words", () => {
  assert.equal(menusText(["File"]), "File menu");
  assert.equal(menusText(["File", "Review"]), "File and Review menus");
  assert.equal(menusText(["Insert", "Narration", "Help"]), "Insert, Narration and Help menus");
  assert.equal(foundText(70, ""), "70 commands, in the order of the menus. Type to find one.");
  assert.equal(foundText(1, "save"), "1 command found.");
  assert.equal(foundText(3, "del"), "3 commands found.");
  assert.match(foundText(0, "zebra"), /^No command has those words/);
});
