import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Jail, createProjectFolder, importPicture, listProjectNames, readProject, within, writeProjectFiles } from "../src/files.ts";
import { imageSize } from "../src/images.ts";
import { ToolError } from "../src/protocol.ts";

function scratch(): { root: string; folder: string; outside: string; jail: Jail } {
  const root = mkdtempSync(path.join(os.tmpdir(), "openstage-mcp-files-"));
  const folder = path.join(root, "work");
  const outside = path.join(root, "secret");
  mkdirSync(folder);
  mkdirSync(outside);
  writeFileSync(path.join(outside, "private.txt"), "private");
  return { root, folder, outside, jail: new Jail(folder) };
}
const done = (root: string) => rmSync(root, { recursive: true, force: true });

test("a path inside the folder is given back in full, and the folder itself is allowed", () => {
  const { root, folder, jail } = scratch();
  try {
    assert.equal(jail.resolve("pictures/map.png"), path.join(jail.root, "pictures", "map.png"));
    assert.equal(jail.resolve(path.join(folder, "a", "b.txt")), path.join(jail.root, "a", "b.txt"));
    assert.equal(jail.resolve("."), jail.root);
    assert.equal(jail.resolve("a/../b.txt"), path.join(jail.root, "b.txt"), "a way that goes up and comes back down inside is fine");
  } finally {
    done(root);
  }
});

test("a path that leaves the folder by .., by a full path or by another drive is refused, and the words say it was not touched", () => {
  const { root, outside, jail } = scratch();
  try {
    for (const bad of ["../secret/private.txt", "..", "a/../../secret", outside, path.join(outside, "private.txt"), "C:\\Windows\\win.ini", "\\\\server\\share\\x", "/etc/passwd"]) {
      assert.throws(() => jail.resolve(bad), (e: unknown) => e instanceof ToolError && /outside the folder an assistant may use.*not touched/.test(e.message), bad);
    }
    assert.throws(() => jail.resolve(""), /not a path/);
    assert.throws(() => jail.resolve("a\0b"), /not a path/);
  } finally {
    done(root);
  }
});

test("a link inside the folder that leads out of it does not let anything through", () => {
  const { root, outside, folder, jail } = scratch();
  try {
    symlinkSync(outside, path.join(folder, "shortcut"), "junction");
    symlinkSync(outside, path.join(folder, "Evil.osproj"), "junction");
    assert.throws(() => jail.resolve("shortcut/private.txt"), /outside the folder/);
    assert.throws(() => jail.resolve("shortcut/new-file.txt"), /outside the folder/, "not even a file that does not exist yet");
    assert.throws(() => jail.project("Evil"), /outside the folder/, "a project folder that is really somewhere else");
  } finally {
    done(root);
  }
});

test("on Windows, names that mean something else are refused: streams, devices, trailing dots and spaces", { skip: process.platform !== "win32" }, () => {
  const { root, jail } = scratch();
  try {
    for (const bad of ["file.txt:hidden", "CON", "nul.txt", "COM1", "LPT3.png", "name.", "name ", "a/aux/b"]) assert.throws(() => jail.resolve(bad), ToolError, bad);
  } finally {
    done(root);
  }
});

test("a folder that does not exist cannot be used", () => {
  assert.throws(() => new Jail(path.join(os.tmpdir(), "openstage-no-such-folder-xyz")), /does not exist/);
  const { root, folder } = scratch();
  try {
    writeFileSync(path.join(folder, "a-file"), "x");
    assert.throws(() => new Jail(path.join(folder, "a-file")), /does not exist/, "a file is not a folder");
  } finally {
    done(root);
  }
});

test("a project is named by plain words, with or without .osproj, and anything else is refused", () => {
  const { root, jail } = scratch();
  try {
    assert.equal(jail.project("Intro"), path.join(jail.root, "Intro.osproj"));
    assert.equal(jail.project("Intro.osproj"), path.join(jail.root, "Intro.osproj"));
    assert.equal(jail.project("  My course (2) "), path.join(jail.root, "My course (2).osproj"));
    for (const bad of ["", "../x", "a/b", "a\\b", ".hidden", "-x", "x*", "x:y", "CON", "a".repeat(81), "name.", "C:\\x"]) {
      assert.throws(() => jail.project(bad), (e: unknown) => e instanceof ToolError && /not a name a project can have/.test(e.message), JSON.stringify(bad));
    }
  } finally {
    done(root);
  }
});

test("within says where a path is, on any system", () => {
  assert.ok(within(path.resolve("/a/b"), path.resolve("/a")));
  assert.ok(within(path.resolve("/a"), path.resolve("/a")));
  assert.ok(!within(path.resolve("/ab"), path.resolve("/a")), "a folder whose name starts the same is not inside");
  assert.ok(!within(path.resolve("/"), path.resolve("/a")));
});

function makeProject(dir: string, slides: string[] = ["slide-001"]): void {
  mkdirSync(path.join(dir, "slides"), { recursive: true });
  writeFileSync(path.join(dir, "project.json"), JSON.stringify({ schemaVersion: "0.46.0", meta: { title: "T" }, theme: { ref: "theme.json" }, scenes: [{ id: "s", name: "Main", slides: [...slides, slides[0]] }] }));
  writeFileSync(path.join(dir, "theme.json"), "{}");
  for (const id of slides.filter((s) => s !== "slide-missing")) writeFileSync(path.join(dir, "slides", `${id}.json`), `{"id":"${id}"}`);
}

test("a project is read as the editor reads it: slides in scene order once each, the theme, and a missing slide left to the checker", () => {
  const { root, folder } = scratch();
  try {
    const dir = path.join(folder, "A.osproj");
    makeProject(dir, ["slide-002", "slide-001", "slide-missing"]);
    const opened = readProject(dir);
    assert.deepEqual(opened.slides.map((s) => s.id), ["slide-002", "slide-001"]);
    assert.equal(opened.theme, "{}");
    assert.equal(opened.assets, null);
    assert.throws(() => readProject(path.join(folder, "nothing.osproj")), /project\.json/);
    writeFileSync(path.join(dir, "project.json"), "{ nope");
    assert.throws(() => readProject(dir), /not valid JSON/);
  } finally {
    done(root);
  }
});

test("a slide with an unsafe id is never read", () => {
  const { root, folder } = scratch();
  try {
    const dir = path.join(folder, "A.osproj");
    makeProject(dir, ["slide-001"]);
    writeFileSync(path.join(dir, "project.json"), JSON.stringify({ meta: {}, scenes: [{ slides: ["slide-001", "../project", "a/b", "..\\x"] }] }));
    assert.deepEqual(readProject(dir).slides.map((s) => s.id), ["slide-001"]);
  } finally {
    done(root);
  }
});

test("projects are listed by name, only the folders that are projects", () => {
  const { root, folder, jail } = scratch();
  try {
    makeProject(path.join(folder, "Beta.osproj"));
    makeProject(path.join(folder, "Alpha.osproj"));
    makeProject(path.join(folder, "NotNamedRight"));
    mkdirSync(path.join(folder, "Empty.osproj"));
    writeFileSync(path.join(folder, "loose.osproj"), "a file");
    assert.deepEqual(listProjectNames(jail), ["Alpha", "Beta"]);
  } finally {
    done(root);
  }
});

test("files are written beside their place and swapped in, leaving no half-written file, and removed slides go", () => {
  const { root, folder } = scratch();
  try {
    const dir = path.join(folder, "A.osproj");
    makeProject(dir);
    writeFileSync(path.join(dir, "slides", "slide-002.json"), "{}");
    writeProjectFiles(dir, [{ path: "project.json", text: '{"a":1}\n' }, { path: "slides/slide-001.json", text: '{"b":2}\n' }, { path: "slides/slide-003.json", text: "{}\n" }], ["slides/slide-002.json"]);
    assert.equal(readFileSync(path.join(dir, "project.json"), "utf-8"), '{"a":1}\n');
    assert.ok(existsSync(path.join(dir, "slides", "slide-003.json")));
    assert.ok(!existsSync(path.join(dir, "slides", "slide-002.json")));
    assert.ok(!readdirSync(path.join(dir, "slides")).some((f) => f.endsWith(".tmp")));
  } finally {
    done(root);
  }
});

test("only a project's own files can be written or removed, and nothing is changed when one is refused", () => {
  const { root, folder } = scratch();
  try {
    const dir = path.join(folder, "A.osproj");
    makeProject(dir);
    const before = readFileSync(path.join(dir, "project.json"), "utf-8");
    for (const bad of ["../x.json", "slides/../../x.json", "slides/a/b.json", "notes.txt", "slides/x.txt", "assets/x.json", "C:\\x.json"]) {
      assert.throws(() => writeProjectFiles(dir, [{ path: "project.json", text: "changed" }, { path: bad, text: "x" }], []), ToolError, bad);
      assert.equal(readFileSync(path.join(dir, "project.json"), "utf-8"), before, `nothing was written when ${bad} was refused`);
    }
    assert.throws(() => writeProjectFiles(dir, [], ["project.json"]), /Only slide files can be removed/);
    assert.throws(() => writeProjectFiles(path.join(folder, "nothing"), [], []), /not an OpenStage project/);
  } finally {
    done(root);
  }
});

test("a new project folder is made from its files, refuses a name that is taken, and leaves nothing behind when it fails", () => {
  const { root, folder } = scratch();
  try {
    const dir = path.join(folder, "New.osproj");
    createProjectFolder(dir, [{ path: "project.json", text: "{}" }, { path: "slides/slide-001.json", text: "{}" }]);
    assert.ok(existsSync(path.join(dir, "slides", "slide-001.json")) && existsSync(path.join(dir, "assets", "images")));
    assert.throws(() => createProjectFolder(dir, []), /already something called New\.osproj/);
    const broken = path.join(folder, "Broken.osproj");
    assert.throws(() => createProjectFolder(broken, [{ path: "slides/x/../../../escape.json\0", text: "x" }]));
    assert.ok(!existsSync(broken), "a folder that could not be made is not left half made");
  } finally {
    done(root);
  }
});

/** The smallest real PNG: one pixel, 3 wide by 2 high in its header. */
const PNG = (w: number, h: number): Uint8Array => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};

test("a picture is copied into the project under a plain name that is not taken, and its size is read", () => {
  const { root, folder } = scratch();
  try {
    const dir = path.join(folder, "A.osproj");
    makeProject(dir);
    const source = path.join(folder, "My Map (final)!.png");
    writeFileSync(source, PNG(300, 200));
    assert.deepEqual(importPicture(dir, source), { src: "assets/images/My-Map-final.png", width: 300, height: 200 });
    assert.equal(importPicture(dir, source).src, "assets/images/My-Map-final-2.png", "the same picture again does not overwrite the first");
    writeFileSync(path.join(folder, "photo.jpeg"), "x");
    assert.equal(importPicture(dir, path.join(folder, "photo.jpeg")).src, "assets/images/photo.jpg");
  } finally {
    done(root);
  }
});

test("only pictures are taken, nothing too big, and a missing file is said", () => {
  const { root, folder } = scratch();
  try {
    const dir = path.join(folder, "A.osproj");
    makeProject(dir);
    writeFileSync(path.join(folder, "notes.txt"), "x");
    writeFileSync(path.join(folder, "run.exe"), "x");
    assert.throws(() => importPicture(dir, path.join(folder, "notes.txt")), /not a kind of picture/);
    assert.throws(() => importPicture(dir, path.join(folder, "run.exe")), /not a kind of picture/);
    assert.throws(() => importPicture(dir, path.join(folder, "missing.png")), /There is no file missing\.png/);
    const big = path.join(folder, "big.png");
    writeFileSync(big, Buffer.alloc(25 * 1024 * 1024 + 1));
    assert.throws(() => importPicture(dir, big), /over 25 MB/);
  } finally {
    done(root);
  }
});

test("a picture's size is read from its first bytes, for each kind the editor takes", () => {
  assert.deepEqual(imageSize(PNG(640, 480), ".png"), { width: 640, height: 480 });
  const gif = new Uint8Array(10);
  gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x01, 0x90, 0x00]);
  assert.deepEqual(imageSize(gif, ".gif"), { width: 288, height: 144 });
  // A JPEG: a start, a comment segment to skip, then a frame header with the height before the width.
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xfe, 0x00, 0x05, 1, 2, 3, 0xff, 0xc0, 0x00, 0x11, 8, 0x01, 0xe0, 0x02, 0x80, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  assert.deepEqual(imageSize(jpeg, ".jpg"), { width: 640, height: 480 });
  const webp = new Uint8Array(30);
  webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 0, 0, 0, 0, 0, 0, 0, 0, 0x1f, 0x03, 0x00, 0xe7, 0x01, 0x00]);
  assert.deepEqual(imageSize(webp, ".webp"), { width: 800, height: 488 });
  const svg = (text: string) => new TextEncoder().encode(text);
  assert.deepEqual(imageSize(svg('<svg xmlns="x" width="120px" height="80"></svg>'), ".svg"), { width: 120, height: 80 });
  assert.deepEqual(imageSize(svg('<?xml version="1.0"?><svg viewBox="0 0 24 12"></svg>'), ".svg"), { width: 24, height: 12 });
  assert.equal(imageSize(svg("<html>"), ".svg"), null);
  assert.equal(imageSize(new Uint8Array(5), ".png"), null);
  assert.equal(imageSize(PNG(0, 5), ".png"), null, "a size of nothing is no size");
});
