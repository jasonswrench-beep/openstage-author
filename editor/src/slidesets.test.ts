// Slide sets in the editor: reading the shell's answers, making the slides of a set the slides of this course, and adding them as one step to undo, with the real tool and validator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Character, CreditEntry, Slide, Variable } from "../../player/src/types.ts";
import { Model } from "./model.ts";
import { describeSet, importSlides, parseSetMade, parseSetRead, peopleProblem, sizeWords, type ImportIds, type SetRead } from "./slidesets.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXAMPLES = path.join(repo, "examples");

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-21" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

/** A set made from an example project's slides, as the shell would say it after reading it (no pictures are copied here). */
function setOf(example: string, ids?: string[], over: Partial<SetRead> = {}): SetRead {
  const dir = path.join(EXAMPLES, `${example}.osproj`);
  const project = JSON.parse(readFileSync(path.join(dir, "project.json"), "utf-8")) as { scenes: { slides: string[] }[]; variables: Variable[]; characters?: Character[]; completion: { slides: string }; stage: { width: number; height: number }; schemaVersion: string };
  const order = project.scenes.flatMap((s) => s.slides).filter((s) => !ids || ids.includes(s));
  const slides = order.map((id) => JSON.parse(readFileSync(path.join(dir, "slides", `${id}.json`), "utf-8")) as Slide);
  return {
    stage: "", set: { id: example, title: `The ${example} set`, description: "", author: "A. Maker", licence: "Free to use", created: "2026-10-21", schemaVersion: project.schemaVersion, stage: project.stage, completion: project.completion.slides === "last" ? "last" : null },
    slides, variables: project.variables, characters: project.characters ?? [], assets: [], credits: [], migrated: false, notes: [], ...over,
  };
}

const ids = (taken: { slides: string[]; objects: string[]; variables: string[] }): ImportIds => {
  let s = 100, o = 100, v = 100;
  const names = new Map<string, string>();
  return {
    slide: () => { let id: string; do id = `slide-${++s}`; while (taken.slides.includes(id)); return id; },
    object: () => { let id: string; do id = `obj-${++o}`; while (taken.objects.includes(id)); return id; },
    variable: (_type, name) => { const id = `var-${++v}`; names.set(id, taken.variables.includes(name) ? `${name} (2)` : name); return id; },
    nameOf: (id) => names.get(id)!,
  };
};

const objectsOf = (s: Slide) => [s.baseLayer, ...s.layers].flatMap((l) => l.objects);

test("the shell's answer about a set is read, a refusal carries its words, and nonsense is not trusted", () => {
  const good = parseSetRead(JSON.stringify({
    ok: true, stage: "C:/tmp/x", set: { id: "a-set", title: "A set", description: "d", author: "me", licence: "Free", created: "2026-10-21", schemaVersion: "0.31.0", stage: { width: 1280, height: 720 }, completion: "last" },
    slides: [{ id: "slide-001" }], variables: [], characters: [], assets: [{ path: "assets/images/a.png", bytes: 5000 }, { path: "", bytes: 1 }], credits: [], migrated: true, notes: ["look at the colours"],
  }));
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.value.set.completion, "last");
    assert.equal(good.value.assets.length, 1, "an entry with no path is left out");
    assert.equal(good.value.migrated, true);
    assert.deepEqual(good.value.notes, ["look at the colours"]);
  }
  assert.deepEqual(parseSetRead(JSON.stringify({ ok: false, message: "Not a zip file." })), { ok: false, message: "Not a zip file." });
  assert.deepEqual(parseSetRead("not json"), { ok: false, message: "The answer could not be read." });
  assert.equal(parseSetRead(JSON.stringify({ ok: true, slides: [] })).ok, false, "a set with no slides is refused");
  const made = parseSetMade(JSON.stringify({ ok: true, set: { title: "T" }, slides: [{}, {}], assets: [{}], dropped: 3, bytes: 2048 }));
  assert.deepEqual(made.ok && made.value, { set: { id: "", title: "T", description: "", author: "", licence: "", created: "", schemaVersion: "", stage: { width: 1280, height: 720 }, completion: null }, slides: 2, assets: 1, dropped: 3, bytes: 2048 });
});

test("sizes and what a set holds are put in words", () => {
  assert.deepEqual([500, 1024, 340 * 1024, 12 * 1024 * 1024, 1.5 * 1024 * 1024].map(sizeWords), ["500 bytes", "1 KB", "340 KB", "12 MB", "1.5 MB"]);
  const read = setOf("quiz-board");
  const words = describeSet({ ...read, assets: [{ path: "assets/images/a.png", bytes: 2048 }] });
  assert.match(words, /^12 slides, 10 variables, 1 file \(2 KB\)$/);
  assert.equal(describeSet({ ...read, slides: read.slides.slice(0, 1), variables: [], characters: [], assets: [] }), "1 slide");
});

test("every slide and object of a set gets an id nobody else is using, and the rules between them follow", () => {
  const read = setOf("quiz-board");
  const taken = { slides: ["slide-101", "slide-103"], objects: ["obj-101", "obj-102"], variables: [] as string[] };
  const imported = importSlides(read, ids(taken), new Map());
  const newSlides = imported.slides.map((s) => s.id);
  assert.equal(new Set(newSlides).size, newSlides.length);
  assert.ok(newSlides.every((id) => !read.slides.some((s) => s.id === id) && !taken.slides.includes(id)));
  const objectIds = imported.slides.flatMap(objectsOf).map((o) => o.id);
  assert.equal(new Set(objectIds).size, objectIds.length);
  assert.ok(objectIds.every((id) => !taken.objects.includes(id)));
  for (const slide of imported.slides) {
    for (const o of objectsOf(slide)) {
      for (const t of o.triggers) if (t.action === "jumpToSlide") assert.ok(newSlides.includes(t.target), `${slide.name}: ${o.name}`);
    }
  }
  assert.equal(imported.slides.length, read.slides.length);
  assert.deepEqual(imported.slides.map((s) => s.name), read.slides.map((s) => s.name), "names and order are kept");
});

test("the variables of a set become new ones, and every rule and condition follows them", () => {
  const read = setOf("quiz-board");
  const made: string[] = [];
  const imported = importSlides(read, { ...ids({ slides: [], objects: [], variables: [] }), variable: (_t, name) => { const id = `var-new-${made.length}`; made.push(name); return id; }, nameOf: (id) => made[Number(id.split("-").pop())]! }, new Map());
  assert.equal(made.length, read.variables.length);
  const old = new Set(read.variables.map((v) => v.id));
  const text = JSON.stringify(imported.slides);
  for (const id of old) assert.equal(text.includes(`"${id}"`), false, `${id} is gone`);
  for (let i = 0; i < made.length; i++) assert.ok(text.includes(`"var-new-${i}"`), `variable ${i} is used`);
  assert.deepEqual(imported.renamed, []);
});

test("a variable whose name had to change is written with its new name in the texts that show it, even if two names swap", () => {
  const slide: Slide = JSON.parse(JSON.stringify(setOf("minimal").slides[0]));
  const text = objectsOf(slide).find((o) => o.type === "text")!;
  text.content = { html: "<p>{{Tries}} of {{Tries (2)}} and {{$score}} and {{ tries }}</p>" };
  const read: SetRead = { ...setOf("minimal", ["slide-001"]), slides: [slide], variables: [{ id: "var-a", name: "Tries", type: "number", initial: 0 }, { id: "var-b", name: "Tries (2)", type: "number", initial: 0 }] };
  // The course already has "Tries", so the set's "Tries" becomes "Tries (2)"; and the set's own "Tries (2)" becomes "Tries (2) (2)".
  const imported = importSlides(read, ids({ slides: [], objects: [], variables: ["Tries", "Tries (2)"] }), new Map());
  assert.deepEqual(imported.renamed, [["Tries", "Tries (2)"], ["Tries (2)", "Tries (2) (2)"]]);
  const html = String(objectsOf(imported.slides[0]!).find((o) => o.type === "text" && String(o.content["html"]).includes("{{"))!.content["html"]);
  assert.equal(html, "<p>{{Tries (2)}} of {{Tries (2) (2)}} and {{$score}} and {{Tries (2)}}</p>");
});

test("pictures follow to where they were copied, in the slides, the people and the credits, and what is not a picture's path is left alone", () => {
  const read = setOf("conversation");
  const picture = (p: string) => `assets/images/${p}`;
  const pictures = new Map([[picture("open-plan-1.webp"), picture("open-plan-1-2.webp")], [picture("ken-think.webp"), picture("ken-think-2.webp")]]);
  const credits: CreditEntry[] = [{ path: picture("open-plan-1.webp"), title: "Room", kind: "image", source: { provider: "other", url: "https://x.org", creator: "A", creatorUrl: "", licence: "Free", requiresCredit: true } }];
  const person: Character = { id: "kay", name: "Kay", role: "", voice: "af_heart", src: picture("ken-think.webp"), alt: "Kay.", decorative: false, poses: [{ id: "think", label: "Thinking", src: picture("ken-think.webp") }] } as unknown as Character;
  const imported = importSlides({ ...read, credits, characters: [person] }, ids({ slides: [], objects: [], variables: [] }), pictures);
  const srcs = imported.slides.flatMap(objectsOf).filter((o) => o.type === "image").map((o) => String(o.content["src"]));
  assert.ok(srcs.includes(picture("open-plan-1-2.webp")) && srcs.includes(picture("ken-think-2.webp")));
  assert.ok(!srcs.includes(picture("open-plan-1.webp")));
  assert.ok(srcs.includes(picture("lisa-explain-2.webp")), "a picture that was not moved keeps its path");
  assert.equal(imported.credits[0]!.path, picture("open-plan-1-2.webp"));
  const p = imported.characters[0]! as unknown as { src: string; poses: { src: string }[] };
  assert.equal(p.src, picture("ken-think-2.webp"));
  assert.equal(p.poses[0]!.src, picture("ken-think-2.webp"));
});

test("an object no longer says which recording or deck it came from", () => {
  const read = setOf("conversation");
  objectsOf(read.slides[0]!)[0]!.provenance = { sourceDeck: "x" } as never;
  const imported = importSlides(read, ids({ slides: [], objects: [], variables: [] }), new Map());
  assert.ok(imported.slides.flatMap(objectsOf).every((o) => o.provenance === null));
});

test("a person the course already has is the same person only if they have the same name", () => {
  const read = setOf("scenario");
  assert.equal(peopleProblem(read, []), null);
  assert.equal(peopleProblem(read, read.characters), null);
  const other = read.characters.map((c) => (c.id === "maya" ? { ...c, name: "Somebody Else" } : c));
  assert.match(peopleProblem(read, other)!, /different person, Somebody Else, with that id/);
});

// ---- the Model

test("a set is added after the slide being edited, as one undo step that takes everything back: slides, variables, people, credits and the completion setting", () => {
  const m = fresh();
  m.addSlide("blank");
  m.selectSlide("slide-001");
  const slidesBefore = m.slides.map((s) => s.id);
  const variablesBefore = m.variables.length;
  const completion = m.completion;
  const read = setOf("quiz-board");
  const result = m.addSlideSet(read, new Map());
  assert.ok(typeof result !== "string");
  if (typeof result === "string") return;
  assert.equal(result.slides.length, read.slides.length);
  const now = m.slides.map((s) => s.id);
  assert.deepEqual(now.slice(0, 1), ["slide-001"]);
  assert.deepEqual(now.slice(1, 1 + read.slides.length), result.slides.map((s) => s.id), "right after the slide being edited");
  assert.equal(now.at(-1), slidesBefore[1], "and the slide that was next is still after them");
  assert.equal(m.variables.length, variablesBefore + read.variables.length);
  assert.equal(m.completion, "last");
  assert.match(result.notes.join(" "), /complete when the learner reaches the last slide/);
  assert.equal(m.slide?.id, result.slides[0]!.id, "the first slide is chosen");
  m.undo();
  assert.deepEqual(m.slides.map((s) => s.id), slidesBefore);
  assert.equal(m.variables.length, variablesBefore);
  assert.equal(m.completion, completion);
  m.redo();
  assert.equal(m.slides.length, slidesBefore.length + read.slides.length);
});

test("the same set added twice shares nothing: new slide ids, new object ids, and variables of its own", () => {
  const m = fresh();
  const read = setOf("quiz-board", ["slide-002", "slide-003"]);
  const a = m.addSlideSet(read, new Map());
  const b = m.addSlideSet(read, new Map());
  assert.ok(typeof a !== "string" && typeof b !== "string");
  if (typeof a === "string" || typeof b === "string") return;
  const all = [...a.slides, ...b.slides];
  assert.equal(new Set(all.map((s) => s.id)).size, all.length);
  const objectIds = m.slides.flatMap(objectsOf).map((o) => o.id);
  assert.equal(new Set(objectIds).size, objectIds.length, "object ids are unique in the course");
  assert.equal(new Set(m.variables.map((v) => v.name.toLowerCase())).size, m.variables.length, "so are variable names");
  assert.equal(new Set(m.variables.map((v) => v.id)).size, m.variables.length);
  assert.match(b.notes.join(" "), /renamed because the course already had one/);
});

test("a set whose people clash with the course's is refused in words and nothing is changed", () => {
  const m = fresh();
  const read = setOf("scenario");
  m.setCharacters(read.characters.map((c) => (c.id === "maya" ? ({ ...c, name: "Somebody Else" } as Character) : (c as Character))), []);
  const before = JSON.stringify([m.slides, m.variables, m.characters, m.completion]);
  const result = m.addSlideSet(read, new Map());
  assert.equal(typeof result, "string");
  assert.equal(JSON.stringify([m.slides, m.variables, m.characters, m.completion]), before);
  m.undo();
  assert.equal(m.characters.length, 0, "the one step to undo is the author's own change to the cast, not a half-added set");
});

test("the people of a set are added to the cast, the ones the course has already are not added twice, and the credits are kept", () => {
  const m = fresh();
  const read = setOf("scenario");
  const credit: CreditEntry = { path: "assets/images/maya.png", title: "Maya", kind: "image", source: { provider: "other", url: "https://x.org", creator: "A", creatorUrl: "", licence: "Free", requiresCredit: true } };
  const first = m.addSlideSet({ ...read, credits: [credit] }, new Map());
  assert.ok(typeof first !== "string");
  assert.deepEqual(m.characters.map((c) => c.id).sort(), ["alex", "jordan", "maya"]);
  assert.equal(m.creditOf("assets/images/maya.png")?.title, "Maya");
  assert.equal(m.credits, true, "a credit that must be given turns the credits page on");
  const second = m.addSlideSet(read, new Map());
  assert.ok(typeof second !== "string");
  assert.equal(m.characters.length, 3, "the same three people are not added again");
});

test("slides made for a different stage size say so", () => {
  const m = fresh();
  const read = setOf("minimal", ["slide-001"]);
  const result = m.addSlideSet({ ...read, set: { ...read.set, stage: { width: 960, height: 540 } } }, new Map());
  assert.ok(typeof result !== "string");
  if (typeof result !== "string") assert.match(result.notes.join(" "), /made for a stage 960 by 540/);
});

// ---- the real tool and the real validator, end to end

const python = process.env["OPENSTAGE_PYTHON"];

function tool(...args: string[]): { ok: boolean; [key: string]: unknown } {
  const r = spawnSync(python!, [path.join(repo, "tools", "slideset.py"), ...args], { encoding: "utf-8" });
  return JSON.parse(r.stdout.trim().split("\n").at(-1)!);
}

test("a set made by the real tool from the quiz board is read, added to a new course, and the course passes the real validator", { skip: !python }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-setflow-"));
  try {
    const project = JSON.parse(readFileSync(path.join(EXAMPLES, "quiz-board.osproj", "project.json"), "utf-8")) as { scenes: { slides: string[] }[] };
    const made = tool("make", path.join(EXAMPLES, "quiz-board.osproj"), "--slides", project.scenes.flatMap((s) => s.slides).join(","), "--out", path.join(dir, "board.osset"), "--title", "A board", "--licence", "Free to use");
    assert.equal(made.ok, true, JSON.stringify(made));
    const read = parseSetRead(JSON.stringify(tool("check", path.join(dir, "board.osset"))));
    assert.equal(read.ok, true);
    if (!read.ok) return;
    const m = fresh();
    const result = m.addSlideSet(read.value, new Map());
    assert.ok(typeof result !== "string");
    const out = path.join(dir, "course");
    mkdirSync(path.join(out, "slides"), { recursive: true });
    for (const f of m.allFiles()) writeFileSync(path.join(out, f.path), f.text);
    const r = spawnSync(python!, [path.join(repo, "tools", "validate.py"), out, "--json"], { encoding: "utf-8" });
    const found = JSON.parse(r.stdout) as { severity: string; rule: string; message: string }[];
    assert.deepEqual(found.filter((f) => f.severity === "error"), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a set with pictures made by the real tool is added with its files copied in, and the course passes the real validator", { skip: !python }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-setflow-"));
  try {
    const made = tool("make", path.join(EXAMPLES, "conversation.osproj"), "--slides", "slide-001,slide-002", "--out", path.join(dir, "talk.osset"), "--title", "A talk", "--licence", "Free to use");
    assert.equal(made.ok, true, JSON.stringify(made));
    const stage = path.join(dir, "stage");
    const read = parseSetRead(JSON.stringify(tool("read", path.join(dir, "talk.osset"), "--stage", stage)));
    assert.equal(read.ok, true);
    if (!read.ok) return;
    const out = path.join(dir, "course");
    mkdirSync(path.join(out, "slides"), { recursive: true });
    mkdirSync(path.join(out, "assets", "images"), { recursive: true });
    // The editor's native side copies each file under a name that is not taken; here the same, with a prefix, so every path has to change.
    const pictures = new Map<string, string>();
    for (const a of read.value.assets) {
      const to = a.path.replace("assets/images/", "assets/images/set-");
      copyFileSync(path.join(stage, a.path), path.join(out, to));
      pictures.set(a.path, to);
    }
    const m = fresh();
    m.addSlideSet(read.value, pictures);
    for (const f of m.allFiles()) writeFileSync(path.join(out, f.path), f.text);
    assert.ok(readdirSync(path.join(out, "assets", "images")).every((n) => n.startsWith("set-")));
    const r = spawnSync(python!, [path.join(repo, "tools", "validate.py"), out, "--json"], { encoding: "utf-8" });
    const found = JSON.parse(r.stdout) as { severity: string; rule: string; message: string }[];
    assert.deepEqual(found.filter((f) => f.severity === "error"), []);
    assert.deepEqual(found.filter((f) => /asset|credit/.test(f.rule)), [], "every picture is there and credited");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
