// What a published package may carry of the project itself.
//
// The editable copy (source/ in the zip) is made only when the author asks for it, and then holds only the files of the project
// format: project.json, the theme file, assets.json, slides/*.json, and the asset files those name. Nothing else that happens to sit
// in the project folder travels: not a version-control folder (.git), not the migration backup (.openstage-backup), not the cache,
// not a recording (captures/, events.jsonl), not the files operating systems leave in folders (desktop.ini, Thumbs.db, .DS_Store),
// and not anything else an author keeps there. The course's own assets/ copy leaves the same things out.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Files the operating system leaves in folders, which never belong in a course. Compared without case. */
const OS_FILES = new Set(["desktop.ini", "thumbs.db", "ehthumbs.db", ".ds_store"]);
/** Folders and files a recording leaves, which must never be published (the interaction log can hold window titles and keys). */
const RECORDING = new Set(["capture", "captures", "events.jsonl"]);

/** Whether a path inside the project (forward slashes) may ever be published: no part hidden or reserved, no recording, no OS file. */
export function mayBePublished(rel: string): boolean {
  const parts = rel.split("/");
  if (rel === "" || path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return false;
  return parts.every((part) => part !== "" && part !== "." && part !== ".." && !part.startsWith(".") && !RECORDING.has(part.toLowerCase()))
    && !OS_FILES.has((parts[parts.length - 1] ?? "").toLowerCase());
}

/** The asset paths ("assets/...") that the project's own files name: every string value in them that starts with assets/. */
export function referencedAssets(texts: readonly string[]): string[] {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      if (value.startsWith("assets/")) found.add(value);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (value !== null && typeof value === "object") {
      for (const item of Object.values(value)) walk(item);
    }
  };
  for (const text of texts) {
    try {
      walk(JSON.parse(text.replace(/^﻿/, "")));
    } catch {
      // A file that is not JSON names nothing: the problem check reports it, and the copy simply carries no assets for it.
    }
  }
  return [...found].sort();
}

/**
 * The files of the editable copy, as paths inside the project folder: the project format's own files and the assets they name,
 * each only if it exists as a file and may be published.
 */
export function editableCopyFiles(projectDir: string, themeRef?: string): string[] {
  const files = new Set<string>();
  const isFile = (rel: string) => {
    const full = path.join(projectDir, ...rel.split("/"));
    return existsSync(full) && statSync(full).isFile();
  };
  const formatFiles = ["project.json", "assets.json", "theme.json"];
  if (themeRef && /\.json$/i.test(themeRef)) formatFiles.push(themeRef.replace(/\\/g, "/").replace(/^\.\//, ""));
  const slidesDir = path.join(projectDir, "slides");
  if (existsSync(slidesDir) && statSync(slidesDir).isDirectory()) {
    for (const name of readdirSync(slidesDir)) if (/\.json$/i.test(name)) formatFiles.push(`slides/${name}`);
  }
  const texts: string[] = [];
  for (const rel of formatFiles) {
    if (!mayBePublished(rel) || !isFile(rel)) continue;
    files.add(rel);
    texts.push(readFileSync(path.join(projectDir, ...rel.split("/")), "utf-8"));
  }
  for (const rel of referencedAssets(texts)) {
    if (mayBePublished(rel) && isFile(rel)) files.add(rel);
  }
  return [...files].sort();
}
