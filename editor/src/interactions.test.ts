// Tests for interactions: adding them, editing their items, undo, and the real validator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { InteractionContent } from "../../player/src/types.ts";
import { buildBody, parseBody } from "./content.ts";
import { ITEM_LIMITS } from "../../player/src/interactions.ts";
import { ADD_MENU, groupOptions, INTERACTIONS, interactionById } from "./factory.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-10" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const content = (m: Model) => m.object!.content as unknown as InteractionContent;

test("the Add menu stays short: interactions are one entry that opens a picker", () => {
  assert.ok(ADD_MENU.length <= 9);
  assert.ok(ADD_MENU.some((e) => e.value === "group:interaction"));
  assert.equal(groupOptions("interaction").length, 0, "interactions come from their own catalogue, not the flat list");
});

test("the catalogue has unique ids, and each entry names its kind and a group", () => {
  const ids = INTERACTIONS.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const i of INTERACTIONS) {
    assert.equal(i.id, `${i.kind}:${i.orientation}`);
    assert.ok(i.label && i.description && i.group);
    assert.ok(i.size.w <= 1280 && i.size.h <= 720);
  }
  assert.equal(interactionById("tabs:vertical")?.kind, "tabs");
});

test("every interaction is added with a sensible number of items, a name, a tab stop and no colours of its own", () => {
  for (const choice of INTERACTIONS) {
    const m = fresh();
    const o = m.addInteraction(choice.id)!;
    assert.equal(o.type, "interaction");
    assert.equal(content(m).kind, choice.kind);
    const { min, max } = ITEM_LIMITS[choice.kind];
    assert.ok(content(m).items.length >= min && content(m).items.length <= max, `${choice.id} starts within its limits`);
    assert.ok(o.accessibility.altText.trim() !== "", "the group has a name");
    assert.ok((o.accessibility.tabOrder ?? 0) >= 1, "it can be reached by keyboard");
    assert.equal(o.accessibility.decorative, false);
    assert.equal(o.style["color"], undefined);
    assert.equal(o.style["fill"], undefined);
    assert.equal(m.object?.id, o.id, "the new interaction is selected");
  }
});

test("adding an interaction is one undo step", () => {
  const m = fresh();
  const before = m.objects.length;
  m.addInteraction("tabs:horizontal");
  assert.equal(m.objects.length, before + 1);
  m.undo();
  assert.equal(m.objects.length, before);
});

test("items can be added, retitled, rewritten, moved and deleted, and each is undoable", () => {
  const m = fresh();
  const o = m.addInteraction("accordion:vertical")!;
  const first = content(m).items[0]!.id;

  assert.match(m.addItem(o.id)!, /Added item 4/);
  assert.equal(content(m).items.length, 4);
  assert.equal(new Set(content(m).items.map((i) => i.id)).size, 4, "item ids stay unique");

  assert.equal(m.setItemTitle(o.id, first, "Causes"), "Title updated");
  assert.equal(m.setItemTitle(o.id, first, "   "), null, "a title cannot be empty");
  assert.equal(content(m).items[0]!.title, "Causes");

  m.setItemBody(o.id, first, "One.\n\nTwo & <three>");
  assert.equal(content(m).items[0]!.body, "<p>One.</p><p>Two &amp; &lt;three&gt;</p>");

  assert.match(m.moveItem(o.id, first, 1)!, /number 2 of 4/);
  assert.equal(content(m).items[1]!.id, first);
  assert.match(m.moveItem(o.id, content(m).items[0]!.id, -1)!, /already first/);

  m.deleteItem(o.id, first);
  assert.equal(content(m).items.length, 3);

  m.undo();
  assert.equal(content(m).items.length, 4);
  m.undo();
  m.undo();
  m.undo();
  assert.equal(content(m).items[0]!.title, "Item 1");
});

test("an interaction keeps within the number of items its kind allows", () => {
  for (const choice of INTERACTIONS) {
    const m = fresh();
    const o = m.addInteraction(choice.id)!;
    const { min, max } = ITEM_LIMITS[choice.kind];
    while (content(m).items.length > min) m.deleteItem(o.id, content(m).items[0]!.id);
    assert.match(m.deleteItem(o.id, content(m).items[0]!.id)!, /at least/, choice.id);
    while (content(m).items.length < max) m.addItem(o.id);
    assert.match(m.addItem(o.id)!, /at most/, choice.id);
  }
});

test("changing to a kind that cannot hold the items is refused, and says why", () => {
  const m = fresh();
  const o = m.addInteraction("processCircle:horizontal")!;
  while (content(m).items.length < 8) m.addItem(o.id);
  assert.match(m.setInteractionKind(o.id, "pyramidStack")!, /needs 3 to 7 items and this one has 8/);
  assert.equal(content(m).kind, "processCircle", "nothing changed");
  m.deleteItem(o.id, content(m).items[0]!.id);
  assert.equal(m.setInteractionKind(o.id, "pyramidStack"), "Changed to pyramidStack");
});

test("a picture starts with no alt text, and alt text and decorative exclude each other", () => {
  const m = fresh();
  const o = m.addInteraction("flipCards:horizontal")!;
  const id = content(m).items[0]!.id;
  m.setItemImage(o.id, id, "assets/images/a.png");
  assert.deepEqual(content(m).items[0]!.image, { src: "assets/images/a.png", alt: "", decorative: false });

  m.setItemImageAlt(o.id, id, { alt: "A bridge" });
  assert.equal(content(m).items[0]!.image!.alt, "A bridge");

  m.setItemImageAlt(o.id, id, { decorative: true });
  assert.deepEqual(content(m).items[0]!.image, { src: "assets/images/a.png", alt: "", decorative: true }, "decorative clears the alt text");

  m.setItemImageAlt(o.id, id, { alt: "A bridge again" });
  assert.equal(content(m).items[0]!.image!.decorative, false, "writing alt text means it is not decorative");

  m.setItemImage(o.id, id, null);
  assert.equal(content(m).items[0]!.image, null);
});

test("changing the kind keeps the items, and fixes up options that kind does not use", () => {
  const m = fresh();
  const o = m.addInteraction("clickReveal:horizontal")!;
  assert.equal(content(m).allowMultiple, true);
  m.setItemTitle(o.id, content(m).items[0]!.id, "Kept");
  m.setInteractionKind(o.id, "accordion");
  assert.equal(content(m).kind, "accordion");
  assert.equal(content(m).orientation, "vertical");
  assert.equal(content(m).allowMultiple, false);
  assert.equal(content(m).items[0]!.title, "Kept");
  assert.equal(m.setInteractionKind(o.id, "accordion"), null);
});

test("body text round-trips through plain paragraphs, and formatted HTML is left alone", () => {
  assert.equal(buildBody("A\n\nB\nC"), "<p>A</p><p>B<br>C</p>");
  assert.equal(parseBody("<p>A</p><p>B<br>C</p>"), "A\n\nB\nC");
  assert.equal(parseBody(""), "");
  assert.equal(parseBody("<p>Some <strong>bold</strong></p>"), null);
  assert.equal(parseBody("<ul><li>x</li></ul>"), null);
});

// ---- the real validator

type Finding = { severity: string; rule: string; message: string };

function validateFiles(files: { path: string; text: string }[]): Finding[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-ix-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of files) writeFileSync(path.join(dir, f.path), f.text);
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Validate the model's files after changing the interaction in the slide file by hand. */
function validateEdited(m: Model, edit: (content: InteractionContent) => void): Finding[] {
  const files = m.allFiles().map((f) => {
    if (f.path !== "slides/slide-001.json") return f;
    const slide = JSON.parse(f.text);
    const obj = slide.baseLayer.objects.find((x: { type: string }) => x.type === "interaction");
    edit(obj.content);
    return { path: f.path, text: JSON.stringify(slide, null, 2) + "\n" };
  });
  return validateFiles(files);
}

const opts = { skip: !process.env["OPENSTAGE_PYTHON"] };

test("every interaction passes the real validator, and a new labeled graphic asks only for its picture", opts, () => {
  const m = fresh();
  for (const choice of INTERACTIONS.filter((c) => c.kind !== "labeledGraphic")) m.addInteraction(choice.id);
  const errors = () => validateFiles(m.allFiles()).filter((f) => f.severity === "error");
  assert.deepEqual(errors(), [], JSON.stringify(errors()));

  // A labeled graphic starts with no picture, because the author chooses it, and the validator says so until they do.
  const g = m.addInteraction("labeledGraphic:horizontal")!;
  const asking = errors();
  assert.ok(asking.length > 0 && asking.every((f) => /graphic/i.test(JSON.stringify(f))), `only about its picture: ${JSON.stringify(asking)}`);
  m.setGraphic(g.id, "assets/images/a.png");
  m.setGraphicAlt(g.id, "A diagram of the model");
  // The picture is chosen and described. The file itself is not in this scratch project, which is the one thing left to complain about.
  assert.deepEqual(errors().map((f) => f.rule), ["asset-missing"]);
});

test("the validator flags a picture with no alt text, and a decorative one that has some", opts, () => {
  const m = fresh();
  const o = m.addInteraction("tabs:horizontal")!;
  const id = content(m).items[0]!.id;
  m.setItemImage(o.id, id, "assets/images/a.png");
  const count = (findings: Finding[]) => findings.filter((f) => f.rule === "interaction-image-alt").length;
  assert.equal(count(validateFiles(m.allFiles())), 1, "no alt text yet");
  m.setItemImageAlt(o.id, id, { decorative: true });
  assert.equal(count(validateFiles(m.allFiles())), 0);
  assert.equal(count(validateEdited(m, (c) => { c.items[0]!.image!.alt = "oops"; })), 1, "decorative with alt text");
});

test("the validator flags duplicate item ids", opts, () => {
  const m = fresh();
  m.addInteraction("accordion:vertical");
  const findings = validateEdited(m, (c) => { c.items[1]!.id = c.items[0]!.id; });
  assert.ok(findings.some((f) => f.rule === "interaction-duplicate-item"));
});

test("the validator flags an interaction nobody can tab to, and one with no items", opts, () => {
  const m = fresh();
  const o = m.addInteraction("steps:horizontal")!;
  m.setAccessibility(o.id, { tabOrder: 0 });
  assert.ok(validateFiles(m.allFiles()).some((f) => f.rule === "not-keyboard-reachable"));
  m.setAccessibility(o.id, { tabOrder: 1 });
  assert.ok(validateEdited(m, (c) => { c.items = []; }).some((f) => f.severity === "error"), "an empty interaction is an error");
});
