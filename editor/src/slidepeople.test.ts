// A person from the library on a slide: the list of pictures to choose from, the credit, and adding the picture with the library's words as its alt text.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Model } from "./model.ts";
import { creditForSlidePicture, parsePackList, slidePictures, type Pack } from "./packs.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUNDLED = path.join(repo, "character-packs");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-21" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

function people(): Pack {
  const manifest = JSON.parse(readFileSync(path.join(BUNDLED, "openstage-people-1", "pack.json"), "utf-8")) as Record<string, unknown>;
  return parsePackList(JSON.stringify({ packs: [{ ...manifest, source: "bundled", folder: "openstage-people-1" }], broken: [] })).packs[0]!;
}

test("a person's pictures to choose from start with their head and shoulders, then each pose, in the pack's order", () => {
  const pack = people();
  const kathy = pack.people.find((p) => p.id === "kathy")!;
  const list = slidePictures(kathy);
  assert.equal(list.length, kathy.poses.length + 1);
  assert.deepEqual(list[0], { id: "head", label: "Head and shoulders", alt: kathy.alt, file: kathy.head });
  assert.deepEqual(list.slice(1).map((p) => p.id), kathy.poses.map((p) => p.id));
  const bare = { ...kathy, poses: [] };
  assert.deepEqual(slidePictures(bare).map((p) => p.id), ["head"], "a person with no poses can still be chosen");
});

test("every picture of every bundled person has a description to use as alt text", () => {
  for (const person of people().people) {
    for (const pose of slidePictures(person)) assert.ok(pose.alt.length > 20 && pose.label.length > 0, `${person.id} ${pose.id}`);
  }
});

test("each picture has a credit title of its own, so the same one chosen twice is one file, and credits name the maker and the terms", () => {
  const pack = people();
  const lisa = pack.people.find((p) => p.id === "lisa")!;
  const [head, ...poses] = slidePictures(lisa);
  const titles = new Set([head!, ...poses].map((p) => creditForSlidePicture(pack, lisa, p, "x").title));
  assert.equal(titles.size, poses.length + 1);
  const c = creditForSlidePicture(pack, lisa, poses[0]!, "assets/images/lisa-neutral.webp");
  assert.match(c.title, /^Lisa, [a-z]/);
  assert.match(c.title, /\(character picture\)$/);
  assert.equal(c.path, "assets/images/lisa-neutral.webp");
  assert.equal(c.source.creator, "Jason S. Wrench");
  assert.equal(c.source.requiresCredit, true);
});

test("adding a person puts an image on the slide with the library's words as its alt text, named for them, and records the credit, in one step", () => {
  const m = fresh();
  const pack = people();
  const lisa = pack.people.find((p) => p.id === "lisa")!;
  const pose = slidePictures(lisa)[1]!;
  const before = m.objects.length;
  const was = JSON.stringify(m.slide);
  const credit = creditForSlidePicture(pack, lisa, pose, "assets/images/lisa-neutral.webp");
  const o = m.addPackPicture({ src: credit.path, size: { w: 300, h: 560 }, name: `Lisa, ${pose.label.toLowerCase()}`, alt: pose.alt, credit })!;
  assert.equal(m.objects.length, before + 1);
  assert.equal(o.type, "image");
  assert.deepEqual(o.content, { src: "assets/images/lisa-neutral.webp" });
  assert.equal(o.accessibility.altText, pose.alt);
  assert.equal(o.accessibility.decorative, false, "the author decides that, after reading the words");
  assert.ok((o.accessibility.tabOrder ?? 0) >= 1);
  assert.equal(o.name, `Lisa, ${pose.label.toLowerCase()}`);
  assert.equal(m.object?.id, o.id, "it is selected");
  assert.ok(o.geometry.height <= 400 && Math.abs(o.geometry.width / o.geometry.height - 300 / 560) < 0.02, "it keeps its proportions");
  assert.deepEqual(m.creditOf(credit.path), credit);
  assert.equal(m.pathOfCredit(credit.title), credit.path);
  m.undo();
  assert.equal(JSON.stringify(m.slide), was, "one step back");
  assert.equal(m.creditOf(credit.path), undefined, "and the credit goes with it");
  m.redo();
  assert.ok(m.objects.some((x) => x.id === o.id));
});

test("a picture that is not in the project's assets is refused", () => {
  const m = fresh();
  const pack = people();
  const credit = creditForSlidePicture(pack, pack.people[0]!, slidePictures(pack.people[0]!)[0]!, "../x.webp");
  assert.equal(m.addPackPicture({ src: "../x.webp", name: "x", alt: "x", credit }), null);
});

type Finding = { severity: string; rule: string };

test("the real validator is satisfied with a person on a slide: described, credited, and nothing to ask for", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  const pack = people();
  const kathy = pack.people.find((p) => p.id === "kathy")!;
  const pose = slidePictures(kathy)[0]!;
  const credit = creditForSlidePicture(pack, kathy, pose, "assets/images/kathy-head.webp");
  m.addPackPicture({ src: credit.path, size: { w: 256, h: 256 }, name: "Kathy", alt: pose.alt, credit });
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-person-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    mkdirSync(path.join(dir, "assets", "images"), { recursive: true });
    copyFileSync(path.join(BUNDLED, "openstage-people-1", kathy.head), path.join(dir, credit.path));
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    const found = JSON.parse(r.stdout) as Finding[];
    assert.deepEqual(found.filter((f) => f.severity === "error"), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
