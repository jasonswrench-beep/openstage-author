// Publishes a project folder as a folder of static web files and a SCORM 1.2 package.
//
//   node publish.ts PROJECT_DIR OUT_DIR [--json] [--preview]
//
// Runs the validator first and refuses to publish if it reports errors.
//
//   --json     Print one JSON result on standard output, for the editor to read. Progress goes to
//              standard error instead, so standard output is only that result.
//   --preview  A quick look, not a release: no problem check, no narration is generated (audio that
//              already exists is used), and no SCORM zip or stand-in LMS page is written.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { zipSync } from "fflate";
import { buildManifest, manifestId } from "./src/scorm-manifest.ts";
import type { CoursePackage, NarrationAsset, Project, Slide, Theme } from "./src/types.ts";
import { creditsInUse, mergeCredits, narrationCredits } from "./src/credits.ts";
import { isExcluded } from "./src/exclude.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const flags = process.argv.slice(2);
const asJson = flags.includes("--json");
const preview = flags.includes("--preview");
const [projectArg, outArg] = flags.filter((a) => !a.startsWith("--"));
if (!projectArg || !outArg) {
  console.error("Usage: node publish.ts PROJECT_DIR OUT_DIR [--json] [--preview]");
  process.exit(2);
}
const projectDir = path.resolve(projectArg);
const outDir = path.resolve(outArg);

/** Progress for a person. With --json it goes to standard error, so standard output stays one JSON result. */
function say(message: string): void {
  if (asJson) console.error(message);
  else console.log(message);
}

interface Finding { severity: "error" | "warning"; file: string; object_id: string; rule: string; message: string; detail: string }

/** Stop without publishing. With --json the reason is the result; otherwise it is printed for a person. */
function stop(message: string, findings: Finding[] = [], code = 1): never {
  if (asJson) console.log(JSON.stringify({ ok: false, message, findings }));
  else console.error(message);
  process.exit(code);
}

// The output folder is emptied before anything is written, so it must not be the project, hold the project,
// or sit inside it.
function within(inner: string, outer: string): boolean {
  const rel = path.relative(outer, inner);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
}
if (within(outDir, projectDir) || within(projectDir, outDir)) {
  stop("The output folder must be somewhere else: not the project folder, and not a folder that holds it or sits inside it.");
}

// 1. Validate. Errors stop a publish; warnings never do. A preview skips this: the editor's Problems list
// already says what is wrong, and a preview is for looking.
const python = process.env["OPENSTAGE_PYTHON"] ?? "python";
let findings: Finding[] = [];
if (!preview) {
  const validator = path.join(repoRoot, "tools", "validate.py");
  const check = spawnSync(python, [validator, projectDir, ...(asJson ? ["--json"] : [])], { encoding: "utf-8", windowsHide: true });
  if (check.error) stop(`Could not run Python to validate the project: ${check.error.message}`);
  if (asJson) {
    try {
      findings = JSON.parse(check.stdout) as Finding[];
    } catch {
      stop(`The problem check did not give a result. ${(check.stderr ?? "").trim()}`.trim());
    }
  } else {
    console.log(check.stdout.trim());
    if (check.stderr.trim()) console.error(check.stderr.trim());
  }
  if (check.status !== 0) {
    const errors = findings.filter((f) => f.severity === "error").length;
    stop(asJson ? `The problem check found ${errors} ${errors === 1 ? "error" : "errors"}. Fix ${errors === 1 ? "it" : "them"} and publish again.` : "\nNot published: the project has errors. Fix them and publish again.", findings);
  }
}

// 2. Narration. Audio is derived from the scripts and cached in the project's .cache folder.
// If a speech engine is configured, generate whatever is missing. If not, publish anyway:
// the course still has transcripts, just no audio. A missing cache is never an error.
const narrateScript = path.join(repoRoot, "tools", "narrate.py");
const kokoroPython = process.env["OPENSTAGE_KOKORO_PYTHON"];
const LF = String.fromCharCode(10);
interface NarrationInfo { script: string; lang: string; hash: string; audio: string | null; cues: NarrationAsset["cues"]; engine?: string; engineName?: string; where?: string; home?: string }
function runNarrate(py: string, generate: boolean): Record<string, NarrationInfo> | null {
  const args = [narrateScript, projectDir, "--json", ...(generate ? [] : ["--no-generate"])];
  const r = spawnSync(py, args, { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) {
    console.error((r.stderr || r.error?.message || "").trim());
    return null;
  }
  const progress = r.stderr.split(LF).filter((l) => /^\s+(generating|cached|missing)\s/.test(l));
  if (progress.length) say(progress.join(LF));
  return JSON.parse(r.stdout) as Record<string, NarrationInfo>;
}
let narrationFailed = false;
let narrationInfo = kokoroPython && !preview ? runNarrate(kokoroPython, true) : null;
if (!narrationInfo) {
  if (preview) {
    // Nothing to say: a preview uses the audio that already exists and makes none.
  } else if (kokoroPython) {
    narrationFailed = true;
    console.error("Narration could not be generated. Publishing without audio.");
  } else {
    say("No speech engine configured (OPENSTAGE_KOKORO_PYTHON). Publishing without generating audio.");
  }
  narrationInfo = runNarrate(python, false) ?? {};
}
const narrationSummary = {
  objects: Object.keys(narrationInfo).length,
  withAudio: Object.values(narrationInfo).filter((i) => i.audio).length,
  /** none: no speech engine is set up. failed: one is, but it did not work. skipped: this is a preview. */
  engine: preview ? "skipped" : !kokoroPython ? "none" : narrationFailed ? "failed" : "ready",
};

// 3. Load the project in scene order.
const readJson = <T,>(file: string): T => JSON.parse(readFileSync(file, "utf-8")) as T;
const project = readJson<Project>(path.join(projectDir, "project.json"));
const slideIds = [...new Set(project.scenes.flatMap((s) => s.slides))];
const slides = slideIds.map((id) => readJson<Slide>(path.join(projectDir, "slides", `${id}.json`)));
const narration: Record<string, NarrationAsset> = {};
for (const [id, info] of Object.entries(narrationInfo)) {
  narration[id] = { script: info.script, lang: info.lang, audio: info.audio ? `narration/${info.hash}.wav` : null, cues: info.cues };
}
// The project's own theme, or the built-in Classic one if it names none.
const theme = project.theme ? readJson<Theme>(path.join(projectDir, project.theme.ref)) : readJson<Theme>(path.join(repoRoot, "themes", "classic.theme.json"));
// Credits: the recorded sources of the assets this course actually uses.
const assetsFile = path.join(projectDir, "assets.json");
const recorded = existsSync(assetsFile) ? readJson<{ assets: NonNullable<CoursePackage["credits"]> }>(assetsFile).assets : [];
const slideText = JSON.stringify(slides);
// A picture of someone in the cast is used too, though no slide names it.
const credits = mergeCredits(creditsInUse(recorded, slideText + JSON.stringify(project.characters ?? [])));
// Narration is made by a synthetic voice, and the credits page says so: one line for each engine whose voices speak in this course.
credits.push(...narrationCredits(Object.values(narrationInfo).filter((i) => i.audio && i.engine && i.engineName).map((i) => ({ engine: i.engine!, name: i.engineName!, where: i.where ?? "unknown", ...(i.home ? { home: i.home } : {}) }))));
// Icons come from an open set (Lucide, ISC licence) whose notice has to travel with them, so a course that uses any names it and carries the licence text.
const usesIcons = slideText.includes('"set":"lucide"');
if (usesIcons) {
  credits.push({
    path: "icons", title: "Icons", kind: "image",
    source: { provider: "other", url: "https://lucide.dev", creator: "Lucide Icons and Contributors", creatorUrl: "https://lucide.dev", licence: "ISC licence (the notice is in licenses/lucide.txt)", requiresCredit: true },
  });
}
// The size of each file the course offers for download, so learners are told how big it is before they save it.
// Only files inside the project's assets folder are measured.
const fileSizes: Record<string, number> = {};
const assetsRoot = path.resolve(projectDir, "assets") + path.sep;
for (const slide of slides) {
  for (const layer of [slide.baseLayer, ...slide.layers]) {
    for (const o of layer.objects) {
      if (o.type !== "download") continue;
      const src = String((o.content as { src?: unknown }).src ?? "");
      const file = path.resolve(projectDir, src);
      if (file.startsWith(assetsRoot) && existsSync(file)) fileSizes[src] = statSync(file).size;
    }
  }
}
const pkg: CoursePackage = { project, theme, slides, narration, credits, fileSizes };

// 4. Write the output folder.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
if (existsSync(path.join(projectDir, "assets"))) {
  cpSync(path.join(projectDir, "assets"), path.join(outDir, "assets"), {
    recursive: true,
    filter: (src) => path.basename(src) !== ".gitkeep",
  });
}
for (const info of Object.values(narrationInfo)) {
  if (!info.audio) continue;
  mkdirSync(path.join(outDir, "narration"), { recursive: true });
  cpSync(path.join(projectDir, info.audio), path.join(outDir, "narration", `${info.hash}.wav`));
}
cpSync(path.join(here, "src", "player.css"), path.join(outDir, "player.css"));
if (usesIcons) {
  mkdirSync(path.join(outDir, "licenses"), { recursive: true });
  cpSync(path.join(repoRoot, "third-party", "lucide-LICENSE.txt"), path.join(outDir, "licenses", "lucide.txt"));
}
await build({
  entryPoints: [path.join(here, "src", "player.ts")],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: path.join(outDir, "player.js"),
  logLevel: "warning",
});

// JSON inside a script tag must not be able to close it.
const U = String.fromCharCode(92) + "u";
const json = JSON.stringify(pkg)
  .split("<").join(U + "003c")
  .split(String.fromCharCode(0x2028)).join(U + "2028")
  .split(String.fromCharCode(0x2029)).join(U + "2029");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
writeFileSync(
  path.join(outDir, "index.html"),
  `<!doctype html>
<html lang="${esc(project.meta.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(project.meta.title)}</title>
<link rel="stylesheet" href="player.css">
</head>
<body>
<div id="openstage"></div>
<noscript>This course needs JavaScript to run.</noscript>
<script type="application/json" id="openstage-project">${json}</script>
<script src="player.js"></script>
</body>
</html>
`,
);

const graded = slides.some((sl) => [sl.baseLayer, ...sl.layers].some((l) => l.objects.some((o) => o.type === "quizQuestion")));
const zipPath = `${outDir}-scorm12.zip`;

if (!preview) {
  // 5. The SCORM 1.2 package: the course plus imsmanifest.xml, and the editable project source
  // alongside (not listed in the manifest, so the LMS ignores it).
  function walk(dir: string, base = dir): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join("/")];
    });
  }
  const courseFiles = walk(outDir);
  const manifest = buildManifest({ title: project.meta.title, files: courseFiles, graded });
  writeFileSync(path.join(outDir, "imsmanifest.xml"), manifest);

  const zipEntries: Record<string, Uint8Array> = { "imsmanifest.xml": new TextEncoder().encode(manifest) };
  for (const f of courseFiles) zipEntries[f] = readFileSync(path.join(outDir, f));
  // The cache is never carried, and neither are the empty .gitkeep placeholders (the course folder leaves them out too, and an LMS may
  // not like empty hidden files). Whatever the project lists in sourceExclude stays out too (raw recordings, for instance).
  const exclude = project.sourceExclude ?? [];
  for (const f of walk(projectDir).filter((f) => !f.startsWith(".cache/") && path.basename(f) !== ".gitkeep" && !isExcluded(f, exclude))) {
    zipEntries[`source/${path.basename(projectDir)}/${f}`] = readFileSync(path.join(projectDir, f));
  }
  writeFileSync(zipPath, zipSync(zipEntries, { level: 6 }));

  // 6. A stand-in LMS page for trying the course by hand. Not part of the package.
  await build({
    entryPoints: [path.join(here, "src", "harness.ts")],
    bundle: true,
    format: "iife",
    target: "es2022",
    outfile: path.join(outDir, "_scorm-test.js"),
    logLevel: "warning",
  });
  writeFileSync(path.join(outDir, "_scorm-test.html"), readFileSync(path.join(here, "scorm-test.html")));
}

if (asJson) {
  console.log(JSON.stringify({
    ok: true, preview, slides: slides.length, outDir, indexHtml: path.join(outDir, "index.html"),
    zip: preview ? null : zipPath, graded, findings, narration: narrationSummary,
  }));
} else {
  console.log(`\n${preview ? "Previewed" : "Published"} ${slides.length} slide(s) to ${outDir}`);
  if (!preview) {
    console.log(`SCORM 1.2 package (${manifestId(project.meta.title)}${graded ? ", graded" : ""}): ${zipPath}`);
    console.log(`Try it with a stand-in LMS: open _scorm-test.html from a local web server.`);
  }
}
