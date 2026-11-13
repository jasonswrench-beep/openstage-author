// Publishes a project folder as a folder of static web files and as packages for an LMS or an LRS: SCORM 1.2,
// SCORM 2004 (4th edition) and xAPI. The three packages hold the same course files; they differ only in the file that
// describes them (imsmanifest.xml, or tincan.xml). The course finds out at run time which one it is running under.
// Beside them goes a Word copy of the course for colleagues and accessibility reviewers (tools/review_doc.py), and, when it is asked
// for, an MP4 of the course with captions (src/video.ts; docs/video.md).
//
//   node publish.ts PROJECT_DIR OUT_DIR [--json] [--preview] [--targets=scorm12,scorm2004,xapi,review,mp4]
//
// Runs the validator first and refuses to publish if it reports errors.
//
//   --json     Print one JSON result on standard output, for the editor to read. Progress goes to
//              standard error instead, so standard output is only that result.
//   --preview  A quick look, not a release: no problem check, no narration is generated (audio that
//              already exists is used), and no package zip or stand-in LMS page is written.
//   --targets  Which packages to make, as a comma-separated list. All three if left out, and the Word review
//              document too. "review" is the Word document, which is not a package: it is made
//              only when it is named or when --targets is left out. "mp4" is a video of the course, with its captions beside it
//              (OUT_DIR.mp4 and OUT_DIR.vtt). It takes minutes and needs Windows and Edge or Chrome, so it is made only when it is named.
//   --video-size=WxH       The video's size in pixels (both even), if not the stage's own. A wide stage is made at most 1920 wide.
//   --video-silent=SECONDS How long a slide with nothing narrated and nothing timed is shown. 5 if left out.
//   --video-no-motion      Every effect and every change of slide is a cut, for people who cannot have motion.
//   --review-headings=slide|number|outline|name  How the Word review document heads each slide (the author's publishing style;
//                          tools/review_doc.py). "slide" if left out.
//   --review-font=NAME     The Word review document's font, one of review_doc.py's FONTS. Calibri if left out.
//   --include-source       Each zip also carries an editable copy of the course (source/), so someone with the package can open
//                          and change it. Off if left out. The copy holds only the project's own files and the assets they name
//                          (src/sourcecopy.ts): never a hidden folder such as .git, a backup, the cache, a recording or OS files.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { zipSync } from "fflate";
import { buildManifest, buildManifest2004, manifestId } from "./src/scorm-manifest.ts";
import { buildTincanXml } from "./src/xapi-manifest.ts";
import { courseActivityId } from "./src/xapi.ts";
import type { CoursePackage, NarrationAsset, Project, Slide, Theme } from "./src/types.ts";
import { creditsInUse, mergeCredits, narrationCredits } from "./src/credits.ts";
import { isExcluded } from "./src/exclude.ts";
import { editableCopyFiles, mayBePublished } from "./src/sourcecopy.ts";
import { publishedPackage } from "./src/published.ts";
import { setPlayerText, t } from "./src/playertext.ts";
import { makeVideo, type VideoResult } from "./src/video.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const TARGETS = ["scorm12", "scorm2004", "xapi"] as const;
type Target = (typeof TARGETS)[number];
/** The Word copy for reviewers. Named in --targets like a package, but it has no zip and no manifest. */
const REVIEW = "review";
/** The video of the course. Named in --targets like a package, but it is made only when it is named. */
const MP4 = "mp4";

const flags = process.argv.slice(2);
const asJson = flags.includes("--json");
const preview = flags.includes("--preview");
const includeSource = flags.includes("--include-source");
const [projectArg, outArg] = flags.filter((a) => !a.startsWith("--"));
const usage = "Usage: node publish.ts PROJECT_DIR OUT_DIR [--json] [--preview] [--targets=scorm12,scorm2004,xapi,review,mp4] [--video-size=WxH] [--video-silent=SECONDS] [--video-no-motion] [--review-headings=slide|number|outline|name] [--review-font=NAME] [--include-source]";
if (!projectArg || !outArg) {
  console.error(usage);
  process.exit(2);
}
const targetsFlag = flags.find((a) => a.startsWith("--targets="));
const asked: string[] = targetsFlag ? targetsFlag.slice("--targets=".length).split(",").map((t) => t.trim()).filter(Boolean) : [...TARGETS, REVIEW];
if (asked.length === 0 || asked.some((t) => t !== REVIEW && t !== MP4 && !(TARGETS as readonly string[]).includes(t))) {
  console.error(`${usage}\nThe targets can be ${[...TARGETS, REVIEW, MP4].join(", ")}.`);
  process.exit(2);
}
const targets = asked.filter((t): t is Target => t !== REVIEW && t !== MP4);
const wantReview = asked.includes(REVIEW);
const wantVideo = asked.includes(MP4);
// How the video is made, if it is asked for.
const sizeFlag = flags.find((a) => a.startsWith("--video-size="));
const sizeMatch = sizeFlag ? /^(\d+)x(\d+)$/.exec(sizeFlag.slice("--video-size=".length)) : null;
if (sizeFlag && (!sizeMatch || [sizeMatch[1], sizeMatch[2]].some((n) => Number(n) < 64 || Number(n) > 7680 || Number(n) % 2 !== 0))) {
  console.error(`${usage}\n--video-size needs a width and a height, both even and between 64 and 7680, such as 1280x720.`);
  process.exit(2);
}
const videoSize = sizeMatch ? { width: Number(sizeMatch[1]), height: Number(sizeMatch[2]) } : undefined;
const silentFlag = flags.find((a) => a.startsWith("--video-silent="));
const silentSeconds = silentFlag ? Number(silentFlag.slice("--video-silent=".length)) : undefined;
if (silentFlag && !(silentSeconds !== undefined && silentSeconds >= 1 && silentSeconds <= 600)) {
  console.error(`${usage}\n--video-silent needs a number of seconds from 1 to 600.`);
  process.exit(2);
}
const videoMotion = !flags.includes("--video-no-motion");
// The Word review document's style, passed on to review_doc.py, which says if it is not one it offers.
const reviewFlags = flags.filter((a) => a.startsWith("--review-headings=") || a.startsWith("--review-font=")).map((a) => a.replace(/^--review-/, "--"));
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
// The words that go into the package itself (the credits for icons and the narration) are in the course's language, as the player's own words are.
setPlayerText(project.playerText);
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
    path: "icons", title: t("credits.icons"), kind: "image",
    source: { provider: "other", url: "https://lucide.dev", creator: "Lucide Icons and Contributors", creatorUrl: "https://lucide.dev", licence: t("credits.iconsLicence"), requiresCredit: true },
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
// What goes into the page is what the player reads: not who wrote the course, the decks it came from or how a picture was made (src/published.ts).
const pkg: CoursePackage = publishedPackage({ project, theme, slides, narration, credits, fileSizes });

// 4. Write the output folder.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
if (existsSync(path.join(projectDir, "assets"))) {
  // Hidden files and folders, recordings and the files operating systems leave in folders stay out, as do the empty .gitkeep placeholders.
  cpSync(path.join(projectDir, "assets"), path.join(outDir, "assets"), {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(projectDir, src).split(path.sep).join("/");
      return rel === "assets" || mayBePublished(rel);
    },
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
/** The zip of each package made, by target. */
const zips: Partial<Record<Target, string>> = {};
/** The Word review document, or null when it was not asked for or could not be made. */
let reviewPath: string | null = null;
/** The video, or null when it was not asked for or could not be made. */
let video: VideoResult | null = null;
/** Why the video could not be made, when it was asked for and could not be. */
let videoError: string | null = null;

if (!preview) {
  // 5. The packages: the course plus the file that describes it (imsmanifest.xml for SCORM, tincan.xml for xAPI), and, only when the
  // author asks for it, the editable copy of the course alongside (not listed in the description, so the LMS ignores it).
  function walk(dir: string, base = dir): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join("/")];
    });
  }
  const courseFiles = walk(outDir);
  const description: Record<Target, { file: string; text: string }> = {
    scorm12: { file: "imsmanifest.xml", text: buildManifest({ title: project.meta.title, files: courseFiles, graded }) },
    scorm2004: { file: "imsmanifest.xml", text: buildManifest2004({ title: project.meta.title, files: courseFiles, graded }) },
    xapi: { file: "tincan.xml", text: buildTincanXml({ title: project.meta.title, language: project.meta.language, activityId: courseActivityId(project.meta) }) },
  };
  // The web-files folder keeps the SCORM 1.2 manifest, as it always has.
  if (targets.includes("scorm12")) writeFileSync(path.join(outDir, "imsmanifest.xml"), description.scorm12.text);

  // The files every package holds are read once.
  const shared: Record<string, Uint8Array> = {};
  for (const f of courseFiles) shared[f] = readFileSync(path.join(outDir, f));
  // The editable copy: only the project's own files and the assets they name (src/sourcecopy.ts), and only when it is asked for.
  // Whatever the project lists in sourceExclude stays out of it too.
  if (includeSource) {
    const exclude = project.sourceExclude ?? [];
    for (const f of editableCopyFiles(projectDir, project.theme?.ref).filter((f) => !isExcluded(f, exclude))) {
      shared[`source/${path.basename(projectDir)}/${f}`] = readFileSync(path.join(projectDir, f));
    }
  }
  for (const target of targets) {
    const zipPath = `${outDir}-${target}.zip`;
    const { file, text } = description[target];
    writeFileSync(zipPath, zipSync({ [file]: new TextEncoder().encode(text), ...shared }, { level: 6 }));
    zips[target] = zipPath;
  }

  // The Word copy for reviewers. It is a courtesy beside the packages, so when it cannot be made the publish still stands.
  if (wantReview) {
    const docxPath = `${outDir}-review.docx`;
    try {
      rmSync(docxPath, { force: true });
    } catch {
      // Not a file we can clear (a folder of that name, say): the tool below will say what is wrong.
    }
    const made = spawnSync(python, [path.join(repoRoot, "tools", "review_doc.py"), projectDir, docxPath, "--json", ...reviewFlags], { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    let reason = "";
    try {
      const answer = JSON.parse(made.stdout) as { ok: boolean; message?: string };
      if (answer.ok) reviewPath = docxPath;
      else reason = answer.message ?? "";
    } catch {
      reason = (made.stderr || made.error?.message || "").trim();
    }
    if (!reviewPath) console.error(`The Word review document could not be made${reason ? `: ${reason}` : "."} The packages were made.`);
  }

  // The video, last, because it takes the longest and because its page files must not be in any package. It is a courtesy beside the packages too.
  if (wantVideo) {
    try {
      video = await makeVideo({
        pkg, outDir, indexHtml: readFileSync(path.join(outDir, "index.html"), "utf-8"), videoPath: `${outDir}.mp4`, captionsPath: `${outDir}.vtt`, root: repoRoot,
        motion: videoMotion, ...(videoSize ? { size: videoSize } : {}), ...(silentSeconds !== undefined ? { silentMs: Math.round(silentSeconds * 1000) } : {}), say,
      });
    } catch (e) {
      videoError = (e as Error).message;
      console.error(`The video could not be made: ${videoError}${targets.length > 0 || wantReview ? " The other files were made." : ""}`);
    }
  }

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

// `zip` is the one package the editor reveals: the SCORM 1.2 one if it was made, which is what it has always been.
const mainZip = preview ? null : (zips.scorm12 ?? zips[targets[0]!] ?? null);
if (asJson) {
  console.log(JSON.stringify({
    ok: true, preview, slides: slides.length, outDir, indexHtml: path.join(outDir, "index.html"),
    zip: mainZip, zips: preview ? {} : zips, review: preview ? null : reviewPath, video: preview ? null : video, videoError: preview ? null : videoError, graded, findings, narration: narrationSummary,
  }));
} else {
  console.log(`\n${preview ? "Previewed" : "Published"} ${slides.length} slide(s) to ${outDir}`);
  if (!preview) {
    const names: Record<Target, string> = { scorm12: "SCORM 1.2", scorm2004: "SCORM 2004 (4th edition)", xapi: "xAPI" };
    for (const t of targets) console.log(`${names[t]} package (${manifestId(project.meta.title)}${graded ? ", graded" : ""}): ${zips[t]}`);
    if (reviewPath) console.log(`Word review document: ${reviewPath}`);
    if (video) {
      console.log(`Video: ${video.file} (${video.seconds.toFixed(1)} seconds, ${video.slides} slide(s))${video.captions ? `, captions: ${video.captions}` : ""}`);
      for (const note of video.notes) console.log(`  ${note}`);
    }
    console.log(`Try it with a stand-in LMS: open _scorm-test.html from a local web server.`);
  }
}
