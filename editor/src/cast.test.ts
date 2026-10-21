// People from character packs in a project: the picture needs its alt text, the credit is saved with the cast in one step, and the real validator
// accepts what the editor writes (using the pack that comes with the program).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Character, ScenarioContent } from "../../player/src/types.ts";
import { cloneCast, draftProblems, poseKey, poseUse, tidyPerson } from "./characters.ts";
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

test("the pack that comes with the program has the fifteen people, each with alt text and many poses", () => {
  const { listed } = kathy();
  assert.deepEqual(listed.people.map((p) => p.name), ["Aisyah", "Blayne", "Daryl", "David", "Gerry", "Harold", "Jacob", "Kathy", "Ken", "Lisa", "Makoa", "Malina", "Mei", "Salma", "Yusuf"]);
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

// ---- poses (format 0.29.0)

const POSES = [
  { id: "welcome", label: "Waving hello", src: "assets/images/kathy-welcome.png" },
  { id: "think", label: "Thinking, hand to chin", src: "assets/images/kathy-think.png" },
];

/** A project with Kathy (with two poses) and Ken (with none), and one scenario. */
function staged() {
  const { character } = kathy();
  const withPoses: Character = { ...character, poses: POSES.map((x) => ({ ...x })), library: { pack: "openstage-people-1", person: "kathy" } };
  const ken: Character = { id: "ken", name: "Ken", role: "", voice: "am_adam", picture: null };
  const m = fresh();
  assert.ok(m.setCharacters([withPoses, ken]));
  m.addScenario();
  const id = m.object!.id;
  /** The scenario as it is now (an edit makes a new one, so it is read again each time). */
  const content = () => m.object!.content as unknown as ScenarioContent;
  return { m, id, c: content, line: content().nodes[0]!.lines[0]!.id, withPoses, ken };
}

test("a line can show its speaker in one of their poses, and show their picture again", () => {
  const { m, id, c, line } = staged();
  m.setScenarioLineSpeaker(id, line, "kathy");
  assert.match(m.setScenarioLinePose(id, line, "welcome")!, /Now shown in the pose "Waving hello"/);
  assert.equal(c().nodes[0]!.lines[0]!.pose, "welcome");
  assert.equal(m.setScenarioLinePose(id, line, "welcome"), null, "nothing changed");
  assert.match(m.setScenarioLinePose(id, line, null)!, /Now shown with Kathy's picture/);
  assert.equal("pose" in c().nodes[0]!.lines[0]!, false, "no pose is no key at all");
  m.setScenarioLinePose(id, line, "think");
  assert.equal(m.undo(), true);
  assert.equal(c().nodes[0]!.lines[0]!.pose, undefined, "one undo takes the pose back");
});

test("a pose is refused for the narrator, for someone with no poses, and for a pose that is not theirs", () => {
  const { m, id, c, line } = staged();
  assert.match(m.setScenarioLinePose(id, line, "welcome")!, /narrator has no pose/);
  m.setScenarioLineSpeaker(id, line, "ken");
  assert.match(m.setScenarioLinePose(id, line, "welcome")!, /Ken does not have that pose/);
  m.setScenarioLineSpeaker(id, line, "kathy");
  assert.match(m.setScenarioLinePose(id, line, "dancing")!, /Kathy does not have that pose/);
  assert.equal(c().nodes[0]!.lines[0]!.pose, undefined);
});

test("changing who says a line keeps a pose the new speaker has and takes off one they do not", () => {
  const { m, id, c, line, withPoses } = staged();
  m.setScenarioLineSpeaker(id, line, "kathy");
  m.setScenarioLinePose(id, line, "welcome");
  assert.match(m.setScenarioLineSpeaker(id, line, "ken")!, /pose it had was taken off/);
  assert.equal(c().nodes[0]!.lines[0]!.pose, undefined);
  // Ken gets a pose with the same id as Kathy's: it carries over.
  const both = [withPoses, { id: "ken", name: "Ken", role: "", voice: "am_adam", picture: null, poses: [{ id: "welcome", label: "Waving", src: "assets/images/ken-welcome.png" }] }] as Character[];
  assert.ok(m.setCharacters(both));
  m.setScenarioLineSpeaker(id, line, "kathy");
  m.setScenarioLinePose(id, line, "welcome");
  const said = m.setScenarioLineSpeaker(id, line, "ken")!;
  assert.doesNotMatch(said, /taken off/);
  assert.equal(c().nodes[0]!.lines[0]!.pose, "welcome");
  assert.match(m.setScenarioLineSpeaker(id, line, null)!, /taken off/, "the narrator has none");
});

test("a pose a line uses cannot be taken out of the cast until the line is changed", () => {
  const { m, id, line, withPoses, ken } = staged();
  m.setScenarioLineSpeaker(id, line, "kathy");
  m.setScenarioLinePose(id, line, "think");
  const without = { ...withPoses, poses: withPoses.poses!.filter((x) => x.id !== "think") };
  const refusal = m.setCharacters([without, ken])!;
  assert.match(refusal, /Kathy's pose "Thinking, hand to chin" is still used by 1 line in the scenario/, refusal);
  assert.equal(m.characters[0]!.poses!.length, 2, "nothing was changed");
  const unused = { ...withPoses, poses: withPoses.poses!.filter((x) => x.id !== "welcome") };
  assert.match(m.setCharacters([unused, ken])!, /2 people/, "a pose no line uses can go");
  m.setScenarioLinePose(id, line, null);
  assert.match(m.setCharacters([{ ...unused, poses: [] }, ken])!, /2 people/);
  assert.equal("poses" in m.characters[0]!, false, "no poses is no key at all");
});

test("where poses are used is counted in words, per person and pose, and 'you' lines are left out", () => {
  const { m, id, c, line } = staged();
  m.setScenarioLineSpeaker(id, line, "kathy");
  m.setScenarioLinePose(id, line, "welcome");
  const second = c().nodes[1]!.lines[0]!.id;
  m.setScenarioLineSpeaker(id, second, "kathy");
  m.setScenarioLinePose(id, second, "welcome");
  const uses = poseUse(m.slides);
  assert.deepEqual([...uses.keys()], [poseKey("kathy", "welcome")]);
  assert.match(uses.get(poseKey("kathy", "welcome"))![0]!, /^2 lines in the scenario/);
  m.setScenarioLineSpeaker(id, second, "you");
  assert.match(poseUse(m.slides).get(poseKey("kathy", "welcome"))![0]!, /^1 line in the scenario/);
});

test("a cast copied for the dialog does not share its poses or its library with the project's", () => {
  const { withPoses } = staged();
  const copy = cloneCast([withPoses])[0]!;
  copy.poses![0]!.label = "Changed";
  copy.library!.person = "someone-else";
  assert.equal(withPoses.poses![0]!.label, "Waving hello");
  assert.equal(withPoses.library!.person, "kathy");
  assert.equal("poses" in cloneCast([{ ...withPoses, poses: undefined }])[0]!, false);
  assert.equal("poses" in tidyPerson({ ...withPoses, poses: [] }), false);
  assert.equal(tidyPerson({ ...withPoses, name: "  Kathy  " }).name, "Kathy");
});

test("draftProblems with no pose uses is as it was for a cast with no poses", () => {
  const { withPoses, ken } = staged();
  assert.deepEqual(draftProblems([withPoses, ken], [withPoses, ken], new Map()), []);
  assert.deepEqual(draftProblems([{ ...withPoses, poses: [] }, ken], [withPoses, ken], new Map()), []);
});

test("a project with poses passes the real validator, and a line's pose that is not the speaker's does not", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const { m, id, c, line } = staged();
  m.setScenarioLineSpeaker(id, line, "kathy");
  m.setScenarioLinePose(id, line, "welcome");
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-poses-"));
  const validate = () => {
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    return JSON.parse(r.stdout) as { severity: string; rule: string }[];
  };
  try {
    mkdirSync(path.join(dir, "slides"));
    mkdirSync(path.join(dir, "assets", "images"), { recursive: true });
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    for (const name of ["kathy.png", "kathy-welcome.png", "kathy-think.png"]) copyFileSync(path.join(BUNDLED, "openstage-people-1", "kathy", "head.png"), path.join(dir, "assets", "images", name));
    assert.deepEqual(validate().filter((f) => f.severity === "error"), []);
    // Break it by hand: the line asks for a pose Kathy does not have.
    (c().nodes[0]!.lines[0]! as { pose?: string }).pose = "dancing";
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    assert.deepEqual(validate().filter((f) => f.severity === "error").map((f) => f.rule), ["scenario-pose-unknown"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
