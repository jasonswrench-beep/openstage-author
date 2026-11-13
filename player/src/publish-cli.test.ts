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

interface Result { ok: boolean; message?: string; findings: { severity: string; rule: string }[]; preview?: boolean; slides?: number; outDir?: string; indexHtml?: string; zip?: string | null; zips?: Record<string, string>; review?: string | null; narration?: { engine: string } }

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
    assert.equal(result.review, null);
    assert.ok(!existsSync(path.join(dir, "site-review.docx")), "a preview makes no Word document either");
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
    assert.equal(result.review, null, "the Word document is made only when it is named");
    assert.ok(!existsSync(path.join(dir, "course-review.docx")));

    const bad = spawnSync(process.execPath, ["publish.ts", path.join(examples, "minimal.osproj"), path.join(dir, "other"), "--targets=scorm12,flash"], { cwd: player, encoding: "utf-8" });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /targets can be scorm12, scorm2004, xapi, review/);
    assert.ok(!existsSync(path.join(dir, "other")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a publish also writes a Word copy for reviewers beside the packages, and --targets=review asks for just that", { skip: !havePython }, () => {
  const dir = scratch();
  try {
    const { result, status } = run(path.join(examples, "minimal.osproj"), path.join(dir, "course"));
    assert.equal(status, 0);
    assert.equal(result.review, path.join(dir, "course-review.docx"));
    assert.deepEqual(Object.keys(result.zips ?? {}).sort(), ["scorm12", "scorm2004", "xapi"], "it is not a package");
    const parts = unzipSync(new Uint8Array(readFileSync(result.review!)));
    assert.ok("[Content_Types].xml" in parts && "word/document.xml" in parts && "word/styles.xml" in parts, "it is a Word document");
    const body = new TextDecoder().decode(parts["word/document.xml"]!);
    assert.ok(body.includes("What Is Organizational Communication?"), "it carries the course's words");
    assert.ok(body.includes("(correct answer)"), "and marks the right answers");

    const only = run(path.join(examples, "minimal.osproj"), path.join(dir, "only"), "--targets=review");
    assert.equal(only.status, 0);
    assert.equal(only.result.review, path.join(dir, "only-review.docx"));
    assert.deepEqual(Object.keys(only.result.zips ?? {}), []);
    assert.equal(only.result.zip, null, "with no package, the editor has none to show first");
    assert.ok(existsSync(path.join(dir, "only-review.docx")) && !existsSync(path.join(dir, "only-scorm12.zip")));
    assert.ok(existsSync(path.join(dir, "only", "index.html")), "the web files are made as always");

    const both = run(path.join(examples, "minimal.osproj"), path.join(dir, "both"), "--targets=xapi,review");
    assert.equal(both.status, 0);
    assert.deepEqual(Object.keys(both.result.zips ?? {}), ["xapi"]);
    assert.ok(existsSync(path.join(dir, "both-review.docx")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a Word document that cannot be made says so and does not stop the packages", { skip: !havePython }, () => {
  const dir = scratch();
  try {
    // A folder where the file should go: the tool cannot write there.
    mkdirSync(path.join(dir, "course-review.docx"));
    const { result, status, stderr } = run(path.join(examples, "minimal.osproj"), path.join(dir, "course"));
    assert.equal(status, 0, JSON.stringify(result));
    assert.equal(result.ok, true);
    assert.equal(result.review, null);
    assert.match(stderr, /The Word review document could not be made: .*The packages were made\./);
    assert.deepEqual(Object.keys(result.zips ?? {}).sort(), ["scorm12", "scorm2004", "xapi"]);
    assert.ok(existsSync(path.join(dir, "course-scorm12.zip")));
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

test("asked for, the editable copy holds the project's own files and nothing else: not what sourceExclude lists, not the cache, not other files", { skip: !havePython }, () => {
  const dir = scratch();
  try {
    const project = path.join(dir, "project.osproj");
    cpSync(path.join(examples, "minimal.osproj"), project, { recursive: true });
    mkdirSync(path.join(project, "recording"), { recursive: true });
    writeFileSync(path.join(project, "recording", "events.jsonl"), "{}");
    writeFileSync(path.join(project, "notes.txt"), "Mine, not the course's.");
    const pj = JSON.parse(readFileSync(path.join(project, "project.json"), "utf-8")) as Record<string, unknown>;
    pj["sourceExclude"] = ["recording"];
    writeFileSync(path.join(project, "project.json"), JSON.stringify(pj, null, 2));

    const { result, status } = run(project, path.join(dir, "course"), "--include-source");
    assert.equal(status, 0, JSON.stringify(result));
    assert.equal(result.ok, true);
    assert.ok(!result.findings.some((f) => f.rule === "capture-material-in-project"), "listed, so no warning");
    const entries = Object.keys(unzipSync(new Uint8Array(readFileSync(path.join(dir, "course-scorm12.zip")))));
    const source = entries.filter((e) => e.startsWith("source/project.osproj/")).sort();
    assert.deepEqual(source, [
      "source/project.osproj/project.json",
      "source/project.osproj/slides/slide-001.json",
      "source/project.osproj/slides/slide-002.json",
      "source/project.osproj/theme.json",
    ], "the project's own files travel, and nothing else");
    assert.ok(!entries.some((e) => e.endsWith("notes.txt")), "an author's own file in the folder does not");
    assert.ok(!entries.some((e) => e.includes("events.jsonl") || e.includes("/recording")), "the listed folder does not");
    assert.ok(!entries.some((e) => e.includes(".cache/")), "and neither does the cache");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a folder holding .git, a recording take and desktop.ini publishes none of them, and no editable copy unless it is asked for", { skip: !havePython }, () => {
  const dir = scratch();
  try {
    const project = path.join(dir, "project.osproj");
    cpSync(path.join(examples, "minimal.osproj"), project, { recursive: true });
    const put = (rel: string, text: string) => {
      const full = path.join(project, ...rel.split("/"));
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, text);
    };
    put(".git/config", "[remote \"origin\"]\n");
    put(".git/HEAD", "ref: refs/heads/main\n");
    put("captures/take-1/events.jsonl", "{\"window\":\"Private window title\"}\n");
    put("desktop.ini", "[.ShellClassInfo]\n");
    put("assets/desktop.ini", "[.ShellClassInfo]\n");
    put("assets/images/Thumbs.db", "thumbs");
    put("assets/.hidden/secret.txt", "hidden");

    const plain = run(project, path.join(dir, "plain"));
    assert.equal(plain.status, 0, JSON.stringify(plain.result));
    assert.ok(plain.result.findings.some((f) => f.rule === "capture-material-in-project" && f.severity === "warning"), "the take outside assets/ is warned about");
    const asked = run(project, path.join(dir, "asked"), "--include-source");
    assert.equal(asked.status, 0, JSON.stringify(asked.result));

    for (const [name, wantSource] of [["plain", false], ["asked", true]] as const) {
      for (const zip of [`${name}-scorm12.zip`, `${name}-scorm2004.zip`, `${name}-xapi.zip`]) {
        const entries = Object.keys(unzipSync(new Uint8Array(readFileSync(path.join(dir, zip)))));
        const bad = entries.filter((e) => /(^|\/)\.git\//.test(e) || /(^|\/)captures\//.test(e) || e.includes("events.jsonl")
          || /(^|\/)desktop\.ini$/i.test(e) || /(^|\/)thumbs\.db$/i.test(e) || e.includes("/.hidden/"));
        assert.deepEqual(bad, [], `${zip} carries none of them`);
        assert.equal(entries.some((e) => e.startsWith("source/")), wantSource, `${zip}: an editable copy only when asked for`);
      }
      assert.ok(!existsSync(path.join(dir, name, "assets", "desktop.ini")) && !existsSync(path.join(dir, name, "assets", "images", "Thumbs.db")),
        "and none is left in the course folder");
      assert.ok(!existsSync(path.join(dir, name, "assets", ".hidden")), "nor a hidden folder");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recording material inside assets/ stops the publish: everything there goes to every learner", { skip: !havePython }, () => {
  const dir = scratch();
  try {
    const project = path.join(dir, "project.osproj");
    cpSync(path.join(examples, "minimal.osproj"), project, { recursive: true });
    mkdirSync(path.join(project, "assets", "captures", "take-1"), { recursive: true });
    writeFileSync(path.join(project, "assets", "captures", "take-1", "events.jsonl"), "{}");
    const { result, status } = run(project, path.join(dir, "course"));
    assert.equal(status, 1);
    assert.equal(result.ok, false);
    assert.ok(result.findings.some((f) => f.rule === "capture-material-in-project" && f.severity === "error"));
    assert.ok(!existsSync(path.join(dir, "course-scorm12.zip")), "nothing was packaged");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the empty .gitkeep placeholders stay out of the package and the course folder", { skip: !havePython }, () => {
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
    assert.ok(!entries.some((e) => e.startsWith("source/")), "and a plain publish carries no editable copy");
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

test("a published page names no imported deck file, no picture prompt and no author, and still credits the picture", { skip: !havePython }, () => {
  const dir = scratch();
  try {
    const project = path.join(dir, "project.osproj");
    cpSync(path.join(examples, "scenario.osproj"), project, { recursive: true });
    const pj = JSON.parse(readFileSync(path.join(project, "project.json"), "utf-8")) as Record<string, any>;
    pj["meta"]["author"] = "Jo Unlikely-Name";
    pj["sources"] = [{ id: "deck-abc", name: "Private lecture notes.pptx", importedAt: "2026-11-01T10:00:00Z", slideWidth: 9144000, slideHeight: 5143500, pixelsPerInch: 96, offsetX: 0, offsetY: 0 }];
    pj["sourceExclude"] = ["private-recordings"];
    writeFileSync(path.join(project, "project.json"), JSON.stringify(pj, null, 2));
    const assets = JSON.parse(readFileSync(path.join(project, "assets.json"), "utf-8")) as { assets: Record<string, any>[] };
    assets.assets[0]!["source"] = { ...assets.assets[0]!["source"], provider: "generated", generated: { service: "openai", model: "image-model-unlikely", prompt: "an unlikely private prompt", madeAt: "2026-11-13T10:00:00Z" } };
    writeFileSync(path.join(project, "assets.json"), JSON.stringify(assets, null, 2));

    const { result, status } = run(project, path.join(dir, "site"), "--preview");
    assert.equal(status, 0, JSON.stringify(result));
    const page = readFileSync(path.join(dir, "site", "index.html"), "utf-8");
    for (const kept of ["Private lecture notes.pptx", "an unlikely private prompt", "image-model-unlikely", "Jo Unlikely-Name", "private-recordings", "deck-abc"]) {
      assert.equal(page.includes(kept), false, `the page does not carry ${kept}`);
    }
    assert.ok(page.includes("Maya Reyes (character picture)"), "the picture is still credited");
    assert.ok(page.includes(String(pj["meta"]["title"])), "and the course still has its title");
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
