// The MP4 target of the publishing tool, from finding the programs it needs to a real video made from a real example: the course is opened in
// a browser with no window, the recorder's exporter writes the MP4, and Windows reads it back. The checks that make a video run only on Windows
// with the exporter and a browser to hand (and Python, for the problem check), like the other tests that need a program of this computer.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { findBrowser } from "./cdp.ts";
import { findCapture } from "./video.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const player = path.resolve(here, "..");
const repo = path.resolve(player, "..");
const examples = path.join(repo, "examples");
const havePython = Boolean(process.env["OPENSTAGE_PYTHON"]);
const capture = findCapture(process.env, repo);
const browser = findBrowser();
const canMakeVideo = process.platform === "win32" && havePython && capture !== null && browser !== null;
const why = canMakeVideo ? false : "needs Windows, Python, the video exporter and Edge or Chrome";

interface Video { file: string; captions: string | null; seconds: number; slides: number; pictures: number; notes: string[] }
interface Result { ok: boolean; zip: string | null; zips: Record<string, string>; review: string | null; video: Video | null; videoError?: string | null; slides?: number }

function scratch(): string {
  return mkdtempSync(path.join(os.tmpdir(), "openstage-video-test-"));
}

function run(project: string, out: string, flags: string[], env: NodeJS.ProcessEnv = process.env): { result: Result; status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, ["publish.ts", project, out, "--json", ...flags], { cwd: player, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024, env });
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1, `standard output must be exactly one JSON result, got: ${r.stdout}\n${r.stderr}`);
  return { result: JSON.parse(lines[0]!) as Result, status: r.status, stderr: r.stderr };
}

/** What Windows says about a finished video: how many pictures it holds and how long it is. */
function readBack(file: string): { pictures: number; seconds: number } {
  const r = spawnSync(capture!, ["video-info", "--file", file, "--plain"], { encoding: "utf-8" });
  const m = /holds (\d+) pictures and is ([\d.]+) seconds long/.exec(r.stdout);
  assert.ok(m, `video-info did not read the video: ${r.stdout} ${r.stderr}`);
  return { pictures: Number(m[1]), seconds: Number(m[2]) };
}

test("the exporter is found where OPENSTAGE_CAPTURE says, or beside the program, or in the repository's build folder", () => {
  const root = scratch();
  try {
    assert.equal(findCapture({}, root), null);
    const named = path.join(root, "mine.exe");
    writeFileSync(named, "x");
    assert.equal(findCapture({ OPENSTAGE_CAPTURE: named }, root), named);
    assert.equal(findCapture({ OPENSTAGE_CAPTURE: path.join(root, "missing.exe") }, root), null, "a name that is wrong is not quietly replaced by another program");
    const build = path.join(root, "capture", "target", "release");
    mkdirSync(build, { recursive: true });
    writeFileSync(path.join(build, "openstage-capture.exe"), "x");
    assert.equal(findCapture({}, root), path.join(build, "openstage-capture.exe"));
    writeFileSync(path.join(root, "openstage-capture.exe"), "x");
    assert.equal(findCapture({}, root), path.join(root, "openstage-capture.exe"), "the one beside the program comes first");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the browser is the one OPENSTAGE_BROWSER names, and a name that is wrong finds none", () => {
  assert.equal(findBrowser({ OPENSTAGE_BROWSER: process.execPath }), process.execPath);
  assert.equal(findBrowser({ OPENSTAGE_BROWSER: path.join(os.tmpdir(), "no-such-browser.exe") }), null);
});

test("a bad size or time for the video stops the tool before anything is made", { skip: !havePython }, () => {
  for (const flag of ["--video-size=101x50", "--video-size=wide", "--video-size=32x32", "--video-silent=0", "--video-silent=soon"]) {
    const r = spawnSync(process.execPath, ["publish.ts", path.join(examples, "minimal.osproj"), path.join(os.tmpdir(), "never-written"), "--targets=mp4", flag], { cwd: player, encoding: "utf-8" });
    assert.equal(r.status, 2, flag);
    assert.match(r.stderr, /--video-/, flag);
  }
});

test("when the video cannot be made the packages still are, and the tool says why", { skip: !havePython }, () => {
  const dir = scratch();
  try {
    const { result, status, stderr } = run(path.join(examples, "minimal.osproj"), path.join(dir, "course"), ["--targets=scorm12,mp4"], { ...process.env, OPENSTAGE_CAPTURE: path.join(dir, "no-such-exporter.exe") });
    assert.equal(status, 0);
    assert.equal(result.ok, true);
    assert.equal(result.video, null);
    assert.match(result.videoError ?? "", /not found/, "the answer says why, for the editor to show");
    assert.ok(existsSync(path.join(dir, "course-scorm12.zip")));
    assert.match(stderr, /The video could not be made: .*not found.*The other files were made\./s);
    assert.ok(!existsSync(path.join(dir, "course.mp4")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a course is made into a video with captions beside it, and the video reads back at the length it was made", { skip: why }, () => {
  const dir = scratch();
  try {
    const { result, status } = run(path.join(examples, "minimal.osproj"), path.join(dir, "course"), ["--targets=scorm12,mp4"]);
    assert.equal(status, 0);
    assert.equal(result.ok, true);
    const video = result.video!;
    assert.ok(video, "a video was made");
    assert.equal(video.file, path.join(dir, "course.mp4"));
    assert.equal(video.slides, 2);
    assert.ok(video.seconds > 5);
    const back = readBack(video.file);
    assert.ok(Math.abs(back.seconds - video.seconds) < 0.25, `read back ${back.seconds}, made ${video.seconds}`);
    assert.ok(back.pictures >= Math.floor(video.seconds * 29));
    // The packages are the same as without a video, and none of the pages the pictures were taken from is in them or left behind.
    const entries = Object.keys(unzipSync(new Uint8Array(readFileSync(path.join(dir, "course-scorm12.zip")))));
    assert.ok(entries.some((e) => e === "imsmanifest.xml"));
    assert.ok(!entries.some((e) => e.includes("_video-frame")));
    assert.ok(!readdirSync(path.join(dir, "course")).some((f) => f.startsWith("_video-frame")));
    // The captions are the narration's own sentences.
    const vtt = readFileSync(video.captions!, "utf-8");
    assert.ok(vtt.startsWith("WEBVTT\n"));
    assert.match(vtt, /\d\d:\d\d:\d\d\.\d{3} --> \d\d:\d\d:\d\d\.\d{3}\n\S/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the video alone can be asked for, and makes no package", { skip: why }, () => {
  const dir = scratch();
  try {
    const { result, status } = run(path.join(examples, "minimal.osproj"), path.join(dir, "course"), ["--targets=mp4", "--video-size=640x360"]);
    assert.equal(status, 0);
    assert.equal(result.zip, null);
    assert.deepEqual(result.zips, {});
    assert.ok(result.video);
    assert.ok(existsSync(path.join(dir, "course.mp4")));
    assert.ok(!existsSync(path.join(dir, "course-scorm12.zip")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A copy of the minimal example whose first slide's first text comes in with a fade after a second. */
function withFade(dir: string): string {
  const copy = path.join(dir, "fade.osproj");
  cpSync(path.join(examples, "minimal.osproj"), copy, { recursive: true });
  const slideFile = path.join(copy, "slides", readdirSync(path.join(copy, "slides")).sort()[0]!);
  const slide = JSON.parse(readFileSync(slideFile, "utf-8")) as { baseLayer: { objects: { type: string; timing: Record<string, unknown>; animation: Record<string, unknown> }[] } };
  const text = slide.baseLayer.objects.find((o) => o.type === "text")!;
  text.timing = { appear: "time", start: 1000, visibleFor: null };
  text.animation = { enter: { effect: "fade", duration: 500 }, exit: { effect: "none", duration: 500 } };
  writeFileSync(slideFile, `${JSON.stringify(slide, null, 2)}\n`);
  return copy;
}

test("an object that fades in is several pictures in the video, and with motion off it is a cut", { skip: why }, () => {
  const dir = scratch();
  try {
    const plain = run(path.join(examples, "minimal.osproj"), path.join(dir, "plain"), ["--targets=mp4"]).result.video!;
    const project = withFade(dir);
    const faded = run(project, path.join(dir, "faded"), ["--targets=mp4"]).result.video!;
    const cut = run(project, path.join(dir, "cut"), ["--targets=mp4", "--video-no-motion"]).result.video!;
    assert.equal(faded.pictures - cut.pictures, 5, "five more pictures for a half second fade, a tenth of a second each");
    assert.ok(cut.pictures > plain.pictures, "the object that comes later is a picture of its own");
    assert.ok(faded.seconds >= plain.seconds);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
