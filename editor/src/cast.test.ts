// People from character packs in a project: the picture needs its alt text, the credit is saved with the cast in one step, and the real validator
// accepts what the editor writes (using the pack that comes with the program).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Character } from "../../player/src/types.ts";
import { Model } from "./model.ts";
import { creditForPicture, parsePackList } from "./packs.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUNDLED = path.join(repo, "character-packs");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-13" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

/** Kathy, as the pack that comes with the program describes her, with her head picture copied in under a made-up project path. */
function kathy(src = "assets/images/kathy.png") {
  const pack = JSON.parse(readFileSync(path.join(BUNDLED, "openstage-people-1", "pack.json"), "utf-8")) as Record<string, unknown>;
  const listed = parsePackList(JSON.stringify({ packs: [{ ...pack, source: "bundled", folder: "openstage-people-1" }], broken: [] })).packs[0]!;
  const person = listed.people.find((p) => p.id === "kathy")!;
  const character: Character = { id: person.id, name: person.name, role: person.role, voice: "af_heart", picture: { src, alt: person.alt, decorative: false } };
  return { listed, person, character, credit: creditForPicture(listed, person, src) };
}

test("the pack that comes with the program has the five people, each with alt text and many poses", () => {
  const { listed } = kathy();
  assert.deepEqual(listed.people.map((p) => p.name), ["David", "Jacob", "Kathy", "Ken", "Lisa"]);
  for (const p of listed.people) {
    assert.ok(p.alt.length > 40, `${p.name} has a description`);
    assert.ok(p.poses.length >= 10, `${p.name} has poses`);
    assert.ok(p.poses.some((x) => x.id === "neutral"), `${p.name} has a standing pose`);
    for (const pose of p.poses) assert.ok(pose.alt.startsWith(p.alt.replace(/\.$/, "")), `${p.name}: ${pose.id}'s description starts with who the person is`);
  }
});

test("a person's picture with no alt text cannot be saved until it is written or the picture is marked decorative", () => {
  const { character } = kathy();
  const m = fresh();
  assert.ok(m.setCharacters([{ ...character, picture: { ...character.picture!, alt: "" } }])!.includes("alt text"));
  assert.equal(m.characters.length, 0);
  assert.ok(m.setCharacters([character])!.includes("1 person"));
});

test("the cast and the credit for its library pictures are saved in one step, and undone in one step", () => {
  const { character, credit } = kathy();
  const m = fresh();
  assert.equal(m.creditOf(credit.path), undefined);
  assert.ok(m.setCharacters([character], [credit])!.includes("1 person"));
  assert.deepEqual(m.creditOf(credit.path), credit);
  assert.equal(credit.source.requiresCredit, true);
  assert.equal(m.undo(), true);
  assert.equal(m.characters.length, 0);
  assert.equal(m.creditOf(credit.path), undefined, "one undo takes back the credit too");
  assert.equal(m.redo(), true);
  assert.deepEqual(m.creditOf(credit.path), credit);
});

test("saving the same cast and credit again changes nothing, and a credit alone is a change", () => {
  const { character, credit } = kathy();
  const m = fresh();
  m.setCharacters([character], [credit]);
  assert.equal(m.setCharacters([character], [credit]), null);
  const other = { ...credit, title: "Kathy again" };
  assert.ok(m.setCharacters([character], [other]));
  assert.equal(m.creditOf(credit.path)?.title, "Kathy again", "the record for a path is replaced, not added twice");
  assert.equal(m.assets.filter((a) => a.path === credit.path).length, 1);
});

test("a cast and its credit pass the real validator, and the credit is complete", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const { character, credit } = kathy();
  const m = fresh();
  m.setCharacters([character], [credit]);
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-cast-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    mkdirSync(path.join(dir, "assets", "images"), { recursive: true });
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    copyFileSync(path.join(BUNDLED, "openstage-people-1", "kathy", "head.png"), path.join(dir, "assets", "images", "kathy.png"));
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    const found = JSON.parse(r.stdout) as { severity: string; rule: string }[];
    assert.deepEqual(found.filter((f) => f.severity === "error"), []);
    assert.deepEqual(found.filter((f) => f.rule.startsWith("credit")), [], "the credit is complete and its picture is there");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
