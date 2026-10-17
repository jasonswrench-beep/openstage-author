// SPDX-License-Identifier: Apache-2.0
/**
 * Choosing a picture, a video or a sound for a recording's edit: the file is picked, checked against what the video maker can
 * use, copied into the course's files, and measured. What comes back is what the edit needs (`ImportedFile`), or a sentence saying
 * why not. Nothing is added to the edit here.
 */

import type { ImportedFile } from "../../capture-edit/src/index.ts";
import type { MediaPick } from "../../capture-timeline/src/index.ts";

/** The parts of the program's backend this needs. */
export interface PickBackend {
  pickFile(kind: ImportedFile["kind"]): Promise<string | null>;
  importAsset(dir: string, source: string, kind: ImportedFile["kind"]): Promise<string>;
  assetUrl(dir: string, path: string): Promise<string>;
}

/** What the video maker can use, by kind, and how to say it. */
export const USABLE: Readonly<Record<ImportedFile["kind"], { readonly exts: readonly string[]; readonly words: string }>> = {
  image: { exts: ["png", "jpg", "jpeg", "gif"], words: "PNG, JPEG or GIF pictures" },
  video: { exts: ["mp4", "m4v"], words: "MP4 videos" },
  audio: { exts: ["wav"], words: "WAV sound files" },
};

/** The part of a path after the last slash or backslash. */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** The extension of a file name in small letters, or "". */
export function extensionOf(path: string): string {
  const name = fileNameOf(path);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** A name to show for a file: "intro-video.mp4" is "Intro video". */
export function friendlyName(path: string): string {
  const name = fileNameOf(path);
  const dot = name.lastIndexOf(".");
  const stem = (dot > 0 ? name.slice(0, dot) : name).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return stem === "" ? "Imported file" : stem.charAt(0).toUpperCase() + stem.slice(1);
}

/**
 * Ask for a file and bring it in. `measure` finds how long a video or sound is (in milliseconds) from an address it can play,
 * or null if it cannot be read.
 */
export async function chooseMedia(
  b: PickBackend,
  dir: string,
  kind: ImportedFile["kind"],
  measure: (url: string, kind: "video" | "audio") => Promise<number | null>,
): Promise<MediaPick> {
  const picked = await b.pickFile(kind);
  if (picked === null) return { ok: false, message: "No file was chosen, so nothing was added." };
  const rule = USABLE[kind];
  if (!rule.exts.includes(extensionOf(picked))) {
    return {
      ok: false,
      message: `${fileNameOf(picked)} was not added. The video maker can use ${rule.words} here for now. Save or convert it to one of those and choose it again.`,
    };
  }
  const path = await b.importAsset(dir, picked, kind);
  const asset = path.replace(/^assets\//, "");
  let durationMs: number | null = null;
  if (kind !== "image") {
    durationMs = await measure(await b.assetUrl(dir, path), kind);
    if (durationMs === null) {
      return { ok: false, message: `${fileNameOf(picked)} was copied into the course but could not be read as a ${kind}, so it was not added to the edit.` };
    }
  }
  return { ok: true, file: { asset, kind, name: friendlyName(picked), durationMs } };
}

/** Find out how long a video or sound is, by loading just enough of it in the browser. Null if it will not load within 15 seconds. */
export function measureInBrowser(url: string, kind: "video" | "audio"): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement(kind);
    el.preload = "metadata";
    const finish = (value: number | null): void => {
      window.clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), 15_000);
    el.addEventListener("loadedmetadata", () => finish(Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration * 1000) : null));
    el.addEventListener("error", () => finish(null));
    el.src = url;
  });
}
