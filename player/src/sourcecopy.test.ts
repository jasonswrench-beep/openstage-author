// What a published package may carry of the project itself (src/sourcecopy.ts).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { editableCopyFiles, mayBePublished, referencedAssets } from "./sourcecopy.ts";

test("hidden, reserved, recording and operating-system paths are never published", () => {
  for (const rel of [
    "", ".git/config", "assets/.git/HEAD", ".openstage-backup/project.json", ".cache/narration/a.wav", "assets/images/.gitkeep",
    "captures/take-1/events.jsonl", "assets/captures/take-1/frame.png", "assets/Capture/x.png", "assets/events.jsonl", "recording/EVENTS.JSONL",
    "desktop.ini", "assets/images/Thumbs.db", "assets/ehthumbs.db", "assets/.DS_Store", "assets//x.png", "assets/./x.png", "assets/../x.png",
    "/etc/passwd", "C:/Windows/win.ini", "c:x.png",
  ]) {
    assert.equal(mayBePublished(rel), false, rel);
  }
  for (const rel of ["project.json", "slides/slide-001.json", "assets/images/maya.png", "assets/audio/intro.wav", "assets/images/desktop.ini.png", "assets/captured.png"]) {
    assert.equal(mayBePublished(rel), true, rel);
  }
});

test("the assets a project names are every string that starts with assets/, wherever it sits", () => {
  const found = referencedAssets([
    JSON.stringify({ assets: [{ path: "assets/images/maya.png" }, { path: "assets/images/alex.png" }] }),
    "\uFEFF" + JSON.stringify({ objects: [{ src: "assets/caf\u00e9.png", nested: { deep: ["assets/audio/a.wav"] } }], note: "not assets/ at the start" }),
    "this is not JSON",
  ]);
  assert.deepEqual(found, ["assets/audio/a.wav", "assets/caf\u00e9.png", "assets/images/alex.png", "assets/images/maya.png"]);
});

test("the editable copy holds the format's own files and the assets they name, nothing else from the folder", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-sourcecopy-test-"));
  try {
    const put = (rel: string, text = "x") => {
      const full = path.join(dir, ...rel.split("/"));
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, text);
    };
    put("project.json", JSON.stringify({ title: "T", theme: { ref: "theme.json" } }));
    put("theme.json", JSON.stringify({ logo: { src: "assets/images/logo.png" } }));
    put("assets.json", JSON.stringify({ assets: [{ path: "assets/images/maya.png" }, { path: "assets/images/missing.png" }, { path: "assets/captures/take.png" }] }));
    put("slides/slide-001.json", JSON.stringify({ objects: [{ src: "assets/audio/intro.wav" }] }));
    put("slides/notes.txt", "not a slide");
    for (const rel of ["assets/images/logo.png", "assets/images/maya.png", "assets/audio/intro.wav", "assets/images/unused.png", "assets/captures/take.png"]) put(rel);
    for (const rel of [".git/config", ".openstage-backup/project.json", ".cache/narration/a.wav", "captures/take-1/events.jsonl", "desktop.ini", "notes.txt", "draft.pptx"]) put(rel);

    assert.deepEqual(editableCopyFiles(dir, "theme.json"), [
      "assets.json",
      "assets/audio/intro.wav",
      "assets/images/logo.png",
      "assets/images/maya.png",
      "project.json",
      "slides/slide-001.json",
      "theme.json",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a project with no slides folder, no theme and no assets file still gives just what is there", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "openstage-sourcecopy-test-"));
  try {
    writeFileSync(path.join(dir, "project.json"), "{}");
    assert.deepEqual(editableCopyFiles(dir), ["project.json"]);
    assert.deepEqual(editableCopyFiles(dir, "../outside.json"), ["project.json"], "a theme reference that leaves the folder is not followed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
