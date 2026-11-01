// What the server does to the disk, and the one fence round it: an assistant may use one folder, and nothing outside it. Every path an
// assistant names is resolved here first. A name that leaves the folder by `..`, by a full path, by a drive, by a network share or by a link
// (a symbolic link or a junction inside the folder that points out of it) is refused with words, and nothing is touched.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ToolError } from "./protocol.ts";
import { imageSize } from "./images.ts";
import type { FileText, OpenedProject } from "../../editor/src/model.ts";

const WINDOWS = process.platform === "win32";
const same = (a: string): string => (WINDOWS ? a.toLowerCase() : a);

/** Is `inner` the folder `outer`, or inside it? */
export function within(inner: string, outer: string): boolean {
  const rel = path.relative(same(outer), same(inner));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** Names Windows treats as devices, which must never be opened as files. */
const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

export class Jail {
  readonly root: string;

  constructor(folder: string) {
    let real: string;
    try {
      real = realpathSync(folder);
      if (!statSync(real).isDirectory()) throw new Error("not a folder");
    } catch {
      throw new ToolError(`The folder an assistant may use (${folder}) does not exist.`);
    }
    this.root = real;
  }

  /** The full path of something inside the folder: given relative to it, or in full. Throws a sentence for anything that is not inside it. */
  resolve(given: string): string {
    if (given.trim() === "" || given.includes("\0")) throw new ToolError("That is not a path.");
    const abs = path.resolve(this.root, given);
    const outside = `${given} is outside the folder an assistant may use (${this.root}), so it was not touched.`;
    if (!within(abs, this.root)) throw new ToolError(outside);
    const below = path.relative(this.root, abs).split(path.sep).filter(Boolean);
    if (WINDOWS && below.some((part) => part.includes(":") || DEVICE.test(part) || /[. ]$/.test(part))) throw new ToolError(`${given} is not a name that can be used here.`);
    // A link inside the folder that leads out of it: look at where the nearest part that exists really is.
    let probe = abs;
    while (!existsSync(probe)) {
      const up = path.dirname(probe);
      if (up === probe) break;
      probe = up;
    }
    if (!within(realpathSync(probe), this.root)) throw new ToolError(outside);
    return abs;
  }

  /** A project's folder from its name: `Intro` and `Intro.osproj` are the same. Only plain names are accepted. */
  project(name: string): string {
    const clean = name.trim().replace(/\.osproj$/i, "");
    if (!/^[A-Za-z0-9][A-Za-z0-9 _.()-]{0,79}$/.test(clean) || /[. ]$/.test(clean) || DEVICE.test(clean)) {
      throw new ToolError(`"${name}" is not a name a project can have here. Use letters, numbers, spaces, dots, dashes, brackets and underscores, up to 80 characters, starting with a letter or number.`);
    }
    return this.resolve(`${clean}.osproj`);
  }
}

/** The projects in the folder: each folder that has a project.json, by name without .osproj. */
export function listProjectNames(jail: Jail): string[] {
  return readdirSync(jail.root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /\.osproj$/i.test(e.name) && existsSync(path.join(jail.root, e.name, "project.json")))
    .map((e) => e.name.replace(/\.osproj$/i, ""))
    .sort((a, b) => a.localeCompare(b));
}

const SAFE_SLIDE = /^[A-Za-z0-9._-]+$/;
const text = (file: string): string => {
  try {
    return readFileSync(file, "utf-8").replace(/^﻿/, "");
  } catch (e) {
    throw new ToolError(`Could not read ${path.basename(file)}: ${(e as Error).message}`);
  }
};

/** A project as the editor reads it from its folder (the same files, in the same order). */
export function readProject(dir: string): OpenedProject {
  const projectText = text(path.join(dir, "project.json"));
  let project: { scenes?: { slides?: unknown }[]; theme?: { ref?: unknown } };
  try {
    project = JSON.parse(projectText);
  } catch (e) {
    throw new ToolError(`project.json is not valid JSON: ${(e as Error).message}`);
  }
  const ids: string[] = [];
  for (const scene of project.scenes ?? []) {
    for (const id of Array.isArray(scene.slides) ? scene.slides : []) if (typeof id === "string" && !ids.includes(id)) ids.push(id);
  }
  const slides: { id: string; text: string }[] = [];
  for (const id of ids) {
    // A slide that is listed but missing, or has an unsafe id, is left out here; the checker reports it.
    if (!SAFE_SLIDE.test(id) || id.includes("..")) continue;
    const file = path.join(dir, "slides", `${id}.json`);
    if (existsSync(file)) slides.push({ id, text: text(file) });
  }
  const themeFile = path.join(dir, "theme.json");
  const theme = project.theme?.ref === "theme.json" && existsSync(themeFile) ? text(themeFile) : null;
  const assetsFile = path.join(dir, "assets.json");
  return { dir, project: projectText, theme, assets: existsSync(assetsFile) ? text(assetsFile) : null, slides };
}

/** Only these files of a project are ever written or removed. */
function projectFile(rel: string): string {
  if (rel === "project.json" || rel === "theme.json" || rel === "assets.json") return rel;
  const m = /^slides\/([^/\\]+)\.json$/.exec(rel);
  if (m && SAFE_SLIDE.test(m[1]!) && !m[1]!.includes("..")) return rel;
  throw new ToolError(`${rel} is not a file of a project.`);
}

/** Write the changed files and remove the slide files that are no longer wanted. Each file is written beside its place, then swapped in, so a crash leaves no half-written slide. */
export function writeProjectFiles(dir: string, files: readonly FileText[], remove: readonly string[]): void {
  if (!existsSync(path.join(dir, "project.json"))) throw new ToolError("That folder is not an OpenStage project.");
  for (const f of files) projectFile(f.path);
  for (const r of remove) {
    if (!r.startsWith("slides/")) throw new ToolError(`Only slide files can be removed: ${r}`);
    projectFile(r);
  }
  for (const f of files) {
    const target = path.join(dir, ...f.path.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, f.text, "utf-8");
    renameSync(tmp, target);
  }
  for (const r of remove) rmSync(path.join(dir, ...r.split("/")), { force: true });
}

/** Make a new project folder from its files. It must not exist yet. */
export function createProjectFolder(dir: string, files: readonly FileText[]): void {
  if (existsSync(dir)) throw new ToolError(`There is already something called ${path.basename(dir)} in that folder. Choose another name, or open it.`);
  mkdirSync(dir, { recursive: true });
  try {
    for (const f of files) {
      const target = path.join(dir, ...f.path.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, f.text, "utf-8");
    }
    mkdirSync(path.join(dir, "assets", "images"), { recursive: true });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

const PICTURES = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const MAX_PICTURE = 25 * 1024 * 1024;

/**
 * Copy a picture from the assistant's folder into the project's assets/images, under a plain name that is not taken, and say where it went
 * and how big it is. Only the kinds of picture the editor takes, and nothing over 25 MB.
 */
export function importPicture(projectDir: string, source: string): { src: string; width: number; height: number } {
  const ext = path.extname(source).toLowerCase();
  if (!PICTURES.has(ext)) throw new ToolError(`${path.basename(source)} is not a kind of picture that can be used. Use PNG, JPEG, GIF, WebP or SVG.`);
  if (!existsSync(source) || !statSync(source).isFile()) throw new ToolError(`There is no file ${path.basename(source)}.`);
  if (statSync(source).size > MAX_PICTURE) throw new ToolError(`${path.basename(source)} is over 25 MB, which is too big for a slide.`);
  const bytes = readFileSync(source);
  const size = imageSize(bytes, ext) ?? { width: 640, height: 360 };
  const stem = path.basename(source, path.extname(source)).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60) || "picture";
  const folder = path.join(projectDir, "assets", "images");
  mkdirSync(folder, { recursive: true });
  let name = `${stem}${ext === ".jpeg" ? ".jpg" : ext}`;
  for (let n = 2; existsSync(path.join(folder, name)); n++) name = `${stem}-${n}${ext === ".jpeg" ? ".jpg" : ext}`;
  copyFileSync(source, path.join(folder, name));
  return { src: `assets/images/${name}`, ...size };
}
