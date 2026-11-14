// A picture behind everything on a slide: the pack side (backgrounds in a pack, their groups and credit), the average colour, adding and removing it in the Model, and the
// real validator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { averageHex, backgroundGroups, BACKGROUND_NAME, isBackgroundPicture } from "./backgrounds.ts";
import { Model } from "./model.ts";
import { creditForBackground, packsWithBackgrounds, packsWithPeople, parsePackList } from "./packs.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUNDLED = path.join(repo, "character-packs");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-21" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const credit = { creator: "A. Maker", creatorUrl: "", licence: "Free to use.", url: "https://example.org/p" };
const background = (id: string, group = "Offices") => ({ id, name: `Room ${id}`, group, alt: `A room, ${id}.`, file: `backgrounds/${id}.webp` });

test("the average colour of a picture is taken from its pixels, and clear pixels count for nothing", () => {
  assert.equal(averageHex([255, 0, 0, 255, 0, 0, 255, 255]), "#800080");
  assert.equal(averageHex([10, 20, 30, 255]), "#0a141e");
  assert.equal(averageHex([200, 200, 200, 255, 0, 0, 0, 0]), "#c8c8c8", "a clear pixel is not black");
  assert.equal(averageHex([]), null);
  assert.equal(averageHex([1, 2, 3, 0]), null, "nothing but clear pixels");
});

test("a pack's backgrounds are listed under their groups in the order the pack gives them, and one with no group is still listed", () => {
  const list = parsePackList(JSON.stringify({ packs: [{ id: "rooms", folder: "rooms", title: "Rooms", credit, backgrounds: [background("a", "Offices"), background("b", "Halls"), background("c", "Offices"), background("d", "")] }], broken: [] }));
  const groups = backgroundGroups(list.packs[0]!);
  assert.deepEqual(groups.map((g) => [g.group, g.items.map((x) => x.id)]), [["Offices", ["a", "c"]], ["Halls", ["b"]], ["More backgrounds", ["d"]]]);
});

test("a pack of backgrounds alone is a pack, a pack of people alone still is, and one with neither is left out", () => {
  const person = { id: "ann", name: "Ann", head: "ann/head.webp", alt: "Ann.", poses: [] };
  const raw = JSON.stringify({
    packs: [
      { id: "rooms", folder: "rooms", credit, backgrounds: [background("a")] },
      { id: "folks", folder: "folks", credit, people: [person] },
      { id: "both", folder: "both", credit, people: [person], backgrounds: [background("b")] },
      { id: "empty", folder: "empty", credit },
      { id: "unusable", folder: "unusable", credit, backgrounds: [{ id: "", file: "" }] },
    ], broken: [],
  });
  const list = parsePackList(raw);
  assert.deepEqual(list.packs.map((p) => p.id), ["rooms", "folks", "both"]);
  assert.deepEqual(packsWithPeople(list.packs).map((p) => p.id), ["folks", "both"]);
  assert.deepEqual(packsWithBackgrounds(list.packs).map((p) => p.id), ["rooms", "both"]);
  assert.deepEqual(list.packs[1]!.backgrounds, []);
  assert.deepEqual(list.packs[0]!.people, []);
});

test("the pack that comes with the program is read as a pack of 58 described backgrounds, in groups", () => {
  const manifest = JSON.parse(readFileSync(path.join(BUNDLED, "openstage-offices-1", "pack.json"), "utf-8")) as Record<string, unknown>;
  const list = parsePackList(JSON.stringify({ packs: [{ ...manifest, source: "bundled", folder: "openstage-offices-1" }], broken: [] }));
  const pack = list.packs[0]!;
  assert.equal(pack.backgrounds.length, 58);
  assert.ok(pack.backgrounds.every((b) => b.alt.length > 20 && b.name.length > 0 && existsSync(path.join(BUNDLED, "openstage-offices-1", b.file))));
  const groups = backgroundGroups(pack);
  assert.equal(groups.length, 13);
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), 58);
  assert.equal(pack.credit.licence, "AI-generated, Apache License 2.0");
});

test("a background's credit names who made it, where, and under what terms", () => {
  const pack = parsePackList(JSON.stringify({ packs: [{ id: "rooms", folder: "rooms", title: "Rooms", credit, backgrounds: [background("a")] }], broken: [] })).packs[0]!;
  const c = creditForBackground(pack, pack.backgrounds[0]!, "assets/images/room-a.webp");
  assert.equal(c.path, "assets/images/room-a.webp");
  assert.equal(c.title, "Room a (background picture)");
  assert.equal(c.kind, "image");
  assert.deepEqual(c.source, { provider: "other", url: "https://example.org/p", creator: "A. Maker", creatorUrl: "", licence: "Free to use", requiresCredit: true });
});

const background1 = (m: Model) => m.backgroundPictureOf("slide-001");

test("a background picture goes behind everything: decorative, locked, the size of the stage, first in the list, with the picture's average colour as the slide's", () => {
  const m = fresh();
  const text = m.addObject("text")!;
  const before = m.slide!.baseLayer.objects.length;
  const msg = m.setBackgroundPicture("slide-001", { src: "assets/images/room.webp", color: "#d9d4cc" });
  assert.match(msg!, /Background picture added/);
  const objects = m.slide!.baseLayer.objects;
  assert.equal(objects.length, before + 1);
  const bg = objects[0]!;
  assert.equal(bg.id, background1(m)!.id);
  assert.ok(isBackgroundPicture(bg));
  assert.equal(bg.name, BACKGROUND_NAME);
  assert.equal(bg.type, "image");
  assert.deepEqual(bg.content, { src: "assets/images/room.webp" });
  assert.equal(bg.accessibility.decorative, true);
  assert.equal(bg.accessibility.altText, "", "alt text is never filled in for the author");
  assert.equal(bg.locked, true);
  assert.deepEqual([bg.geometry.x, bg.geometry.y, bg.geometry.width, bg.geometry.height], [0, 0, m.project.stage.width, m.project.stage.height]);
  assert.ok(objects.slice(1).every((o) => o.geometry.z > bg.geometry.z), "everything else is in front of it");
  assert.equal(m.slide!.background, "#d9d4cc");
  assert.ok(objects.some((o) => o.id === text.id));
});

test("a dark picture makes the text that follows the theme light, and taking the picture away puts it back", () => {
  const m = fresh();
  m.setSlideBackground("slide-001", null);
  const text = m.addObject("text")!;
  const colorBefore = m.objects.find((o) => o.id === text.id)!.style["color"];
  m.setBackgroundPicture("slide-001", { src: "assets/images/dark.webp", color: "#101820" });
  assert.notEqual(m.objects.find((o) => o.id === text.id)!.style["color"], colorBefore);
  const msg = m.removeBackgroundPicture("slide-001");
  assert.match(msg!, /theme's again/);
  assert.equal(m.slide!.background, null);
  assert.equal(m.objects.find((o) => o.id === text.id)!.style["color"], colorBefore);
  assert.equal(background1(m), null);
  assert.equal(m.removeBackgroundPicture("slide-001"), null, "nothing to take away");
});

test("choosing another picture replaces the first: only one is ever behind the slide", () => {
  const m = fresh();
  m.setBackgroundPicture("slide-001", { src: "assets/images/one.webp", color: "#cccccc" });
  m.setBackgroundPicture("slide-001", { src: "assets/images/two.webp", color: "#333333" });
  const pictures = m.slide!.baseLayer.objects.filter(isBackgroundPicture);
  assert.equal(pictures.length, 1);
  assert.deepEqual(pictures[0]!.content, { src: "assets/images/two.webp" });
  assert.equal(m.slide!.background, "#333333");
});

test("adding and removing are each one step to undo", () => {
  const m = fresh();
  const was = JSON.stringify(m.slide);
  m.setBackgroundPicture("slide-001", { src: "assets/images/room.webp", color: "#d9d4cc" });
  assert.notEqual(JSON.stringify(m.slide), was);
  m.undo();
  assert.equal(JSON.stringify(m.slide), was);
  m.redo();
  assert.ok(background1(m));
  m.removeBackgroundPicture("slide-001");
  assert.equal(background1(m), null);
  m.undo();
  assert.ok(background1(m), "the picture is back");
  assert.equal(m.slide!.background, "#d9d4cc", "and so is the colour");
});

test("what is already at the back moves up together, so the order stays as it was", () => {
  const m = fresh();
  const backgroundBefore = m.slide!.background;
  const a = m.addObject("text")!;
  const b = m.addObject("button")!;
  m.setGeometry(a.id, { z: -3 });
  m.setGeometry(b.id, { z: 0 });
  const order = (ids: string[]) => ids.map((id) => m.slide!.baseLayer.objects.find((o) => o.id === id)!.geometry.z);
  m.setBackgroundPicture("slide-001", { src: "assets/images/room.webp", color: null });
  const [za, zb] = order([a.id, b.id]);
  assert.ok(za! < zb!, "a is still behind b");
  assert.ok(za! > 0, "both are in front of the picture, which is at 0");
  assert.equal(background1(m)!.geometry.z, 0);
  assert.equal(m.slide!.background, backgroundBefore, "no colour given, so the slide's own background is left alone");
});

test("the credit is saved with the picture, and the same picture chosen again is found by its credit title and not copied again", () => {
  const m = fresh();
  const pack = parsePackList(JSON.stringify({ packs: [{ id: "rooms", folder: "rooms", title: "Rooms", credit, backgrounds: [background("a")] }], broken: [] })).packs[0]!;
  const entry = creditForBackground(pack, pack.backgrounds[0]!, "assets/images/room-a.webp");
  assert.equal(m.pathOfCredit(entry.title), null);
  m.setBackgroundPicture("slide-001", { src: entry.path, color: "#d9d4cc", credit: entry });
  assert.deepEqual(m.creditOf(entry.path), entry);
  assert.equal(m.pathOfCredit(entry.title), "assets/images/room-a.webp");
});

test("a picture that is not in the project's assets is refused, and a slide that is not there is left alone", () => {
  const m = fresh();
  const was = JSON.stringify(m.slide);
  assert.equal(m.setBackgroundPicture("slide-001", { src: "../outside.webp", color: null }), null);
  assert.equal(m.setBackgroundPicture("slide-999", { src: "assets/images/room.webp", color: null }), null);
  assert.equal(JSON.stringify(m.slide), was);
});

test("a picture on a different slide is on that slide only", () => {
  const m = fresh();
  m.addSlide("content");
  m.setBackgroundPicture("slide-001", { src: "assets/images/room.webp", color: null });
  const other = m.slides.find((s) => s.id !== "slide-001")!;
  assert.equal(m.backgroundPictureOf(other.id), null);
  assert.ok(background1(m));
});

type Finding = { severity: string; rule: string; message: string };

test("the real validator is satisfied with a background picture, with its credit, and says nothing about its colour or its name", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const m = fresh();
  m.addObject("text");
  const pack = parsePackList(JSON.stringify({ packs: [{ id: "rooms", folder: "rooms", title: "Rooms", credit, backgrounds: [background("a")] }], broken: [] })).packs[0]!;
  const entry = creditForBackground(pack, pack.backgrounds[0]!, "assets/images/room-a.webp");
  m.setBackgroundPicture("slide-001", { src: entry.path, color: "#d9d4cc", credit: entry });
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-bgpic-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    mkdirSync(path.join(dir, "assets", "images"), { recursive: true });
    writeFileSync(path.join(dir, entry.path), readFileSync(path.join(BUNDLED, "openstage-offices-1", "backgrounds", "kitchen-1.webp")));
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    const found = JSON.parse(r.stdout) as Finding[];
    assert.deepEqual(found.filter((f) => f.severity === "error"), []);
    assert.deepEqual(found.filter((f) => /alt|credit|contrast/.test(f.rule)), [], "the picture is decoration, it is credited, and the text is judged against the average colour");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
