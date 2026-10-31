// Runs the real publishing tool (player/publish.ts) on copies of the example projects, the way the editor's
// Preview and Publish buttons do. The checks that need the Python validator run only when OPENSTAGE_PYTHON is
// set, like the other tests that need it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { itemNarrationKey } from "./narration.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const player = path.resolve(here, "..");
const examples = path.resolve(player, "..", "examples");
const havePython = Boolean(process.env["OPENSTAGE_PYTHON"]);

interface Result { ok: boolean; message?: string; findings: { severity: string; rule: string }[]; preview?: boolean; slides?: number; outDir?: string; indexHtml?: string; zip?: string | null; narration?: { engine: string } }

function scratch(): string {
  return mkdtempSync(path.join(os.tmpdir(), "openstage-publish-test-"));
}

/** Run the tool with --json and return what it printed and how it ended. */
function run(project: string, out: string, ...flags: string[]): { result: Result; status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, ["publish.ts", project, out, "--json", ...flags], { cwd: player, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1, `standard output must be exactly one JSON result, got: ${r.stdout}`);
  return { result: JSON.parse(lines[0]!) as Result, status: r.status, stderr: r.stderr };
}

test("a preview writes the page and nothing else: no zip, no stand-in LMS, no problem check", { skip: !havePython }, () => {
  const dir = scratch();
  try {
    const { result, status } = run(path.join(examples, "minimal.osproj"), path.join(dir, "site"), "--preview");
    assert.equal(status, 0);
    assert.equal(result.ok, true);
    assert.equal(result.preview, true);
    assert.equal(result.zip, null);
    assert.equal(result.narration?.engine, "skipped");
    assert.ok(existsSync(path.join(dir, "site", "index.html")) && existsSync(path.join(dir, "site", "player.js")));
    assert.ok(!existsSync(path.join(dir, "site-scorm12.zip")));
    assert.ok(!existsSync(path.join(dir, "site", "_scorm-test.html")));
    assert.ok(!existsSync(path.join(dir, "site", "imsmanifest.xml")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a publish writes the folder, the SCORM zip and the manifest, and reports warnings without stopping", { skip: !havePython }, () => {
  const dir = scratch();
  try {
    const { result, status } = run(path.join(examples, "minimal.osproj"), path.join(dir, "course"));
    assert.equal(status, 0);
    assert.equal(result.ok, true);
    assert.equal(result.preview, false);
    assert.equal(result.slides, 2);
    assert.equal(result.zip, path.join(dir, "course-scorm12.zip"));
    assert.ok(existsSync(path.join(dir, "course-scorm12.zip")));
    assert.ok(existsSync(path.join(dir, "course", "imsmanifest.xml")));
    assert.ok(result.findings.every((f) => f.severity === "warning"), "only warnings can come back from a publish that worked");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a publish makes a SCORM 1.2, a SCORM 2004 and an xAPI package from the same files", { skip: !havePython }, () => {
  const dir = scratch();
  try {
    const { result, status } = run(path.join(examples, "minimal.osproj"), path.join(dir, "course"));
    assert.equal(status, 0);
    const zips = (result as unknown as { zips: Record<string, string> }).zips;
    assert.deepEqual(Object.keys(zips).sort(), ["scorm12", "scorm2004", "xapi"]);
    assert.equal(zips["scorm12"], path.join(dir, "course-scorm12.zip"));
    assert.equal(zips["scorm2004"], path.join(dir, "course-scorm2004.zip"));
    assert.equal(zips["xapi"], path.join(dir, "course-xapi.zip"));
    assert.equal(result.zip, zips["scorm12"], "the editor still reveals the SCORM 1.2 package");

    const read = (name: string) => unzipSync(new Uint8Array(readFileSync(zips[name]!)));
    const text = (entries: Record<string, Uint8Array>, name: string) => new TextDecoder().decode(entries[name]!);
    const [s12, s2004, xapi] = [read("scorm12"), read("scorm2004"), read("xapi")];

    assert.match(text(s12, "imsmanifest.xml"), /<schemaversion>1\.2<\/schemaversion>/);
    assert.match(text(s2004, "imsmanifest.xml"), /<schemaversion>2004 4th Edition<\/schemaversion>/);
    assert.match(text(s2004, "imsmanifest.xml"), /<imsss:minNormalizedMeasure>0\.8<\/imsss:minNormalizedMeasure>/, "the example is graded");
    assert.ok(!("imsmanifest.xml" in xapi) && "tincan.xml" in xapi, "xAPI is described by tincan.xml, not a SCORM manifest");
    assert.ok(!("tincan.xml" in s12) && !("tincan.xml" in s2004));
    assert.match(text(xapi, "tincan.xml"), /<launch lang="[^"]+">index\.html<\/launch>/);

    // Everything but the description is the same in all three, and the SCORM ones list those files.
    const rest = (e: Record<string, Uint8Array>) => Object.keys(e).filter((k) => k !== "imsmanifest.xml" && k !== "tincan.xml").sort();
    assert.deepEqual(rest(s2004), rest(s12));
    assert.deepEqual(rest(xapi), rest(s12));
    assert.ok(rest(s12).includes("index.html") && rest(s12).includes("player.js"));
    for (const f of ["index.html", "player.js"]) assert.ok(text(s2004, "imsmanifest.xml").includes(`<file href="${f}"/>`));
    assert.ok(Buffer.from(s2004["player.js"]!).equals(Buffer.from(s12["player.js"]!)), "one player serves every kind of package");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--targets makes only the packages asked for, and refuses one that does not exist", { skip: !havePython }, () => {
  const dir = scratch();
  try {
    const { result, status } = run(path.join(examples, "minimal.osproj"), path.join(dir, "course"), "--targets=xapi");
    assert.equal(status, 0);
    assert.deepEqual(Object.keys((result as unknown as { zips: object }).zips), ["xapi"]);
    assert.equal(result.zip, path.join(dir, "course-xapi.zip"), "with no SCORM 1.2 package, the editor is shown the one that was made");
    assert.ok(existsSync(path.join(dir, "course-xapi.zip")));
    assert.ok(!existsSync(path.join(dir, "course-scorm12.zip")) && !existsSync(path.join(dir, "course-scorm2004.zip")));
    assert.ok(!existsSync(path.join(dir, "course", "imsmanifest.xml")), "the web files carry the SCORM 1.2 manifest only when that package was asked for");

    const bad = spawnSync(process.execPath, ["publish.ts", path.join(examples, "minimal.osproj"), path.join(dir, "other"), "--targets=scorm12,flash"], { cwd: player, encoding: "utf-8" });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /targets can be scorm12, scorm2004, xapi/);
    assert.ok(!existsSync(path.join(dir, "other")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a project with errors is not published, and the errors come back", { skip: !havePython }, () => {
  const dir = scratch();
  try {
    const { result, status } = run(path.join(examples, "broken.osproj"), path.join(dir, "course"));
    assert.equal(status, 1);
    assert.equal(result.ok, false);
    assert.match(result.message ?? "", /found 14 errors/);
    assert.ok(result.findings.some((f) => f.rule === "alt-text-missing"));
    assert.ok(!existsSync(path.join(dir, "course")), "nothing is written when the check fails");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an interaction item's narration is in the published course under the key the player looks for", { skip: !havePython }, () => {
  const dir = scratch();
  try {
    const project = path.join(dir, "ix.osproj");
    cpSync(path.join(examples, "interactions.osproj"), project, { recursive: true, filter: (src) => path.basename(src) !== ".cache" });
    const slideFile = path.join(project, "slides", "slide-001.json");
    const slide = JSON.parse(readFileSync(slideFile, "utf-8")) as { baseLayer: { objects: { id: string; type: string; content: { items: { id: string; narration: unknown }[] } }[] } };
    const ix = slide.baseLayer.objects.find((o) => o.type === "interaction")!;
    const item = ix.content.items[1]!;
    item.narration = { script: "This item speaks.", voice: "af_heart", speed: 1, lang: "en-US", pronunciations: [], audioCache: null };
    writeFileSync(slideFile, JSON.stringify(slide, null, 2));

    const { result, status } = run(project, path.join(dir, "site"), "--preview");
    assert.equal(status, 0);
    assert.equal(result.ok, true);
    const page = readFileSync(path.join(dir, "site", "index.html"), "utf-8");
    assert.ok(page.includes(`"${itemNarrationKey(ix.id, item.id)}"`), "the package names the item's narration by the player's key");
    assert.ok(page.includes("This item speaks."), "and carries its script, which becomes the transcript");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file to download is published with its size, and the file is in the course's assets", { skip: !havePython }, () => {
  const dir = scratch();
  try {
    const project = path.join(dir, "dl.osproj");
    cpSync(path.join(examples, "minimal.osproj"), project, { recursive: true, filter: (src) => path.basename(src) !== ".cache" });
    mkdirSync(path.join(project, "assets", "documents"), { recursive: true });
    writeFileSync(path.join(project, "assets", "documents", "guide.pdf"), Buffer.alloc(2048, 65));
    const slideFile = path.join(project, "slides", "slide-001.json");
    const slide = JSON.parse(readFileSync(slideFile, "utf-8")) as { baseLayer: { objects: unknown[] } };
    slide.baseLayer.objects.push({
      id: "obj-0090", type: "download", name: "Download", geometry: { x: 80, y: 480, width: 520, height: 200, rotation: 0, z: 90 },
      content: { src: "assets/documents/guide.pdf", title: "Course guide", description: "What the course covers.", accessibleConfirmed: true },
      style: {}, accessibility: { altText: "Course guide, a PDF", role: "group", tabOrder: 9, decorative: false },
      states: {}, triggers: [], timing: { appear: "time", start: 0, visibleFor: null }, animation: { enter: { effect: "none", duration: 500 }, exit: { effect: "none", duration: 500 } }, narration: null, provenance: null, simulation: null,
    });
    writeFileSync(slideFile, JSON.stringify(slide, null, 2));

    const { result, status } = run(project, path.join(dir, "course"));
    assert.equal(status, 0, JSON.stringify(result));
    assert.equal(result.ok, true);
    assert.ok(existsSync(path.join(dir, "course", "assets", "documents", "guide.pdf")), "the file travels with the course");
    const page = readFileSync(path.join(dir, "course", "index.html"), "utf-8");
    assert.match(page, /"fileSizes":\s*\{\s*"assets\/documents\/guide\.pdf":\s*2048\s*\}/, "the package carries the size");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("it will not empty the project folder, a folder that holds it, or one inside it", () => {
  const dir = scratch();
  try {
    const project = path.join(dir, "holder", "project");
    cpSync(path.join(examples, "minimal.osproj"), project, { recursive: true });
    for (const out of [project, path.join(dir, "holder"), path.join(project, "out")]) {
      const { result, status } = run(project, out);
      assert.equal(status, 1);
      assert.equal(result.ok, false);
      assert.match(result.message ?? "", /somewhere else/);
    }
    assert.ok(existsSync(path.join(project, "project.json")), "the project is untouched");
    assert.ok(existsSync(path.join(project, "assets")), "the project's assets are untouched");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("what the project lists in sourceExclude stays out of the package's source copy, and the cache always does", { skip: !havePython }, () => {
  const dir = scratch();
  try {
    const project = path.join(dir, "project.osproj");
    cpSync(path.join(examples, "minimal.osproj"), project, { recursive: true });
    mkdirSync(path.join(project, "recording"), { recursive: true });
    writeFileSync(path.join(project, "recording", "events.jsonl"), "{}");
    writeFileSync(path.join(project, "notes.txt"), "Keep me.");
    const pj = JSON.parse(readFileSync(path.join(project, "project.json"), "utf-8")) as Record<string, unknown>;
    pj["sourceExclude"] = ["recording"];
    writeFileSync(path.join(project, "project.json"), JSON.stringify(pj, null, 2));

    const { result, status } = run(project, path.join(dir, "course"));
    assert.equal(status, 0, JSON.stringify(result));
    assert.equal(result.ok, true);
    assert.ok(!result.findings.some((f) => f.rule === "capture-material-in-project"), "listed, so no warning");
    const entries = Object.keys(unzipSync(new Uint8Array(readFileSync(path.join(dir, "course-scorm12.zip")))));
    const source = entries.filter((e) => e.startsWith("source/project.osproj/"));
    assert.ok(source.includes("source/project.osproj/project.json") && source.includes("source/project.osproj/notes.txt"), "the project itself travels");
    assert.ok(!source.some((e) => e.includes("events.jsonl") || e.includes("/recording")), "the listed folder does not");
    assert.ok(!source.some((e) => e.includes("/.cache/")), "and neither does the cache");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the empty .gitkeep placeholders stay out of the package, in the course folder and in the source copy", { skip: !havePython }, () => {
  const dir = scratch();
  try {
    const project = path.join(dir, "project.osproj");
    cpSync(path.join(examples, "minimal.osproj"), project, { recursive: true });
    for (const sub of ["audio", "images", "video"]) {
      mkdirSync(path.join(project, "assets", sub), { recursive: true });
      writeFileSync(path.join(project, "assets", sub, ".gitkeep"), "");
    }
    const { result, status } = run(project, path.join(dir, "course"));
    assert.equal(status, 0, JSON.stringify(result));
    const entries = Object.keys(unzipSync(new Uint8Array(readFileSync(path.join(dir, "course-scorm12.zip")))));
    assert.deepEqual(entries.filter((e) => e.endsWith(".gitkeep")), [], "no placeholder travels in the zip");
    assert.ok(entries.includes("source/project.osproj/project.json"), "the project itself still travels");
    assert.ok(!existsSync(path.join(dir, "course", "assets", "audio", ".gitkeep")), "and none is left in the course folder");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a project with raw recording material that is not listed is warned about but still publishes", { skip: !havePython }, () => {
  const dir = scratch();
  try {
    const project = path.join(dir, "project.osproj");
    cpSync(path.join(examples, "minimal.osproj"), project, { recursive: true });
    mkdirSync(path.join(project, "recording"), { recursive: true });
    writeFileSync(path.join(project, "recording", "events.jsonl"), "{}");
    const { result, status } = run(project, path.join(dir, "course"));
    assert.equal(status, 0);
    assert.ok(result.findings.some((f) => f.rule === "capture-material-in-project" && f.severity === "warning"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the people of the cast are credited on the credits page, though no slide shows their pictures", { skip: !havePython }, () => {
  const dir = scratch();
  try {
    const { result, status } = run(path.join(examples, "scenario.osproj"), path.join(dir, "site"), "--preview");
    assert.equal(status, 0, JSON.stringify(result));
    const page = readFileSync(path.join(dir, "site", "index.html"), "utf-8");
    const credits = (JSON.parse(/"credits":(\[.*?\]),"fileSizes"/s.exec(page)![1]!) as { title: string; source: { creator: string } }[]).map((c) => `${c.title} / ${c.source.creator}`);
    assert.ok(credits.includes("Maya Reyes (character picture) / Jason S. Wrench"), credits.join("; "));
    assert.ok(credits.includes("Alex Kim (character picture) / Jason S. Wrench"));
    assert.ok(credits.includes("Jordan Lee (character picture) / Jason S. Wrench"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
