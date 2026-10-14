// The avatar maker's drawing: it is built only from the known choices, it is safe to save in a project, every combination draws, and it is described in words.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Character } from "../../player/src/types.ts";
import {
  avatarSvg, BACKGROUND, cleanSpec, DEFAULT_AVATAR, describeAvatar, EXPRESSION, HAIR_COLOUR, HAIR_STYLE, randomSpec, SHIRT_COLOUR, SHIRT_STYLE, shade, SKIN,
} from "./avatar.ts";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The same refusals as the program that saves a drawn picture (save_generated_svg_at in the Rust side, and the dev server). */
function wouldBeRefused(svg: string): string | null {
  const lower = svg.toLowerCase();
  const bad = ["<script", "javascript:", "<foreignobject", "<iframe", "<image", "<use", "<style", "<!entity", "<!doctype", "href=", "xlink:", "@import", "url("].find((b) => lower.includes(b));
  if (bad) return bad;
  if (/[\s"']on[a-z]+\s*=/.test(lower)) return "an event handler";
  if (!lower.trimStart().startsWith("<svg")) return "not a picture";
  if (svg.length > 200 * 1024) return "too big";
  return null;
}

test("the starting person draws, and the picture is a plain SVG of a small size", () => {
  const svg = avatarSvg(DEFAULT_AVATAR);
  assert.ok(svg.startsWith("<svg "));
  assert.ok(svg.includes('viewBox="0 0 200 200"'));
  assert.ok(svg.length < 6000);
  assert.equal(wouldBeRefused(svg), null);
});

test("every combination of choices draws a picture the saving program accepts", () => {
  let count = 0;
  for (const skin of SKIN) for (const hairStyle of HAIR_STYLE) for (const expression of EXPRESSION) for (const shirtStyle of SHIRT_STYLE) for (const glasses of [false, true]) {
    const svg = avatarSvg({ ...DEFAULT_AVATAR, skin: skin.id, hairStyle: hairStyle.id, expression: expression.id, shirtStyle: shirtStyle.id, glasses });
    assert.equal(wouldBeRefused(svg), null, `${skin.id} ${hairStyle.id} ${expression.id} ${shirtStyle.id} ${glasses}`);
    count++;
  }
  for (const c of [...HAIR_COLOUR]) assert.ok(avatarSvg({ ...DEFAULT_AVATAR, hairColour: c.id }).includes(c.hex));
  for (const c of SHIRT_COLOUR) assert.ok(avatarSvg({ ...DEFAULT_AVATAR, shirtColour: c.id }).includes(c.hex));
  for (const c of BACKGROUND) assert.ok(avatarSvg({ ...DEFAULT_AVATAR, background: c.id }).includes(c.hex));
  assert.equal(count, 6 * 5 * 3 * 3 * 2);
});

test("the choices change the picture", () => {
  const a = avatarSvg(DEFAULT_AVATAR);
  assert.notEqual(avatarSvg({ ...DEFAULT_AVATAR, glasses: true }), a);
  assert.notEqual(avatarSvg({ ...DEFAULT_AVATAR, hairStyle: "curly" }), a);
  assert.notEqual(avatarSvg({ ...DEFAULT_AVATAR, expression: "concerned" }), a);
  assert.ok(avatarSvg({ ...DEFAULT_AVATAR, glasses: true }).includes("<circle cx=\"86\" cy=\"88\" r=\"11\"/>"));
  assert.ok(!avatarSvg({ ...DEFAULT_AVATAR, glasses: false }).includes("r=\"11\""));
});

test("anything that is not a known choice is replaced by the starting one, so no outside text reaches the picture", () => {
  const spec = cleanSpec({ skin: "<script>", hairStyle: 7, hairColour: "#ff0000", expression: null, shirtStyle: "x", shirtColour: "javascript:", glasses: "yes", background: "url(x)" });
  assert.deepEqual(spec, { ...DEFAULT_AVATAR, glasses: false });
  assert.deepEqual(cleanSpec(null), DEFAULT_AVATAR);
  assert.deepEqual(cleanSpec("text"), DEFAULT_AVATAR);
  const svg = avatarSvg({ skin: "\"><script>alert(1)</script>", hairColour: "#ff0000\" onload=\"x" });
  assert.equal(wouldBeRefused(svg), null);
  assert.ok(!svg.toLowerCase().includes("script"));
  assert.ok(!svg.includes("#ff0000"));
});

test("a colour can be made a little darker or lighter and stays a colour", () => {
  assert.equal(shade("#808080", 0), "#808080");
  assert.equal(shade("#808080", -0.5), "#404040");
  assert.equal(shade("#ffffff", 0.5), "#ffffff");
  assert.match(shade("#d9a273", -0.14), /^#[0-9a-f]{6}$/);
});

test("the picture is described in words, as a start for alt text", () => {
  assert.equal(describeAvatar({ ...DEFAULT_AVATAR, skin: "tan", hairStyle: "short", hairColour: "dark-brown", expression: "smile", shirtColour: "green", shirtStyle: "crew" }),
    "Short dark brown hair, tan skin, smiling, a green round neck shirt");
  assert.equal(describeAvatar({ ...DEFAULT_AVATAR, hairStyle: "bald", glasses: true }), "No hair, tan skin, smiling, glasses, a green round neck shirt");
  assert.ok(describeAvatar({ ...DEFAULT_AVATAR, hairStyle: "bun", hairColour: "auburn" }).startsWith("Auburn hair in a bun"));
});

test("surprise me gives a different person for different chance, and always a valid one", () => {
  const seen = new Set<string>();
  let n = 0;
  const random = () => { n = (n * 9301 + 49297) % 233280; return n / 233280; };
  for (let i = 0; i < 40; i++) {
    const spec = randomSpec(random);
    assert.deepEqual(cleanSpec(spec), spec, "every part is a known choice");
    seen.add(JSON.stringify(spec));
  }
  assert.ok(seen.size > 30);
  assert.deepEqual(cleanSpec(randomSpec(() => 0.9999999)), randomSpec(() => 0.9999999), "the top of the range stays in range");
});

// ---- in a project

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-13" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

test("a drawn picture can be a person's picture, with no alt text until the author writes it", () => {
  const person: Character = { id: "maya", name: "Maya", role: "", voice: "af_heart", picture: { src: "assets/images/maya.svg", alt: "", decorative: false } };
  const m = fresh();
  // Without alt text the cast cannot be saved: it has to be written, or the picture marked decorative.
  assert.ok(m.setCharacters([person])!.includes("alt text"));
  assert.equal(m.characters.length, 0);
  assert.ok(m.setCharacters([{ ...person, picture: { ...person.picture!, alt: "Maya, with short dark hair and a green shirt" } }])!.includes("1 person"));
});

test("a picture drawn by the maker, saved in a project, passes the real validator", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const person: Character = { id: "maya", name: "Maya", role: "", voice: "af_heart", picture: { src: "assets/images/maya.svg", alt: "Maya, with short dark brown hair and a green shirt", decorative: false } };
  const m = fresh();
  m.setCharacters([person]);
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-avatar-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    mkdirSync(path.join(dir, "assets", "images"), { recursive: true });
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    writeFileSync(path.join(dir, "assets", "images", "maya.svg"), avatarSvg(DEFAULT_AVATAR));
    const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
    const errors = (JSON.parse(r.stdout) as { severity: string; rule: string }[]).filter((f) => f.severity === "error");
    assert.deepEqual(errors, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
