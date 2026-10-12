// A file a learner can save to their own device. The author describes what the file is, so the learner knows before
// downloading, and the course shows that description with the kind of file and its size. There is no pop-up window and
// no viewer: the link saves the file, and the learner opens it with their own programs, including a screen reader.
// It is part of the one shared renderer, so the editor's canvas and the published course look the same.

import fileTypes from "../../tools/download-types.json" with { type: "json" };
import type { DownloadContent, OSObject } from "./types.ts";

const LABELS = new Map<string, string>(fileTypes.types.map((t) => [t.ext, t.label]));

/** The kinds of file a course can offer, by extension: tools/download-types.json. */
export const DOWNLOAD_EXTENSIONS: readonly string[] = fileTypes.types.map((t) => t.ext);

/** What the learner is told about saving the file. The editor offers the same words as narration. */
export const DOWNLOAD_HELP = "Selecting Download saves this file to your computer. You can then open it with your own programs, including a screen reader.";

/** The extension of a file path, lower case, or an empty string if it has none. */
export function fileExtension(path: string): string {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** The file's own name, which is what the learner's computer saves it as. */
export function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

/** What kind of file it is, in words: "PDF document". */
export function fileTypeLabel(path: string): string {
  return LABELS.get(fileExtension(path)) ?? "File";
}

/** A size a person can judge: "800 bytes", "42 KB", "1.2 MB". */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The kind of file and, when it is known, its size: "PDF document, 1.2 MB". */
export function fileDetails(path: string, size: number | undefined): string {
  return size === undefined ? fileTypeLabel(path) : `${fileTypeLabel(path)}, ${sizeText(size)}`;
}

function make(doc: Document, tag: string, cls: string, text?: string): HTMLElement {
  const e = doc.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface DownloadOptions {
  /** In the editor the file is drawn but cannot be fetched, so nothing can navigate away. */
  editing: boolean;
  /** The file's size in bytes, when the course knows it (the published course does, the editor does not). */
  size: number | undefined;
}

export function buildDownload(doc: Document, obj: OSObject, options: DownloadOptions): HTMLElement {
  const c = obj.content as unknown as DownloadContent;
  const root = make(doc, "div", "os-download");
  root.setAttribute("role", "group");
  if (!obj.accessibility.decorative) root.setAttribute("aria-label", obj.accessibility.altText);

  const id = (part: string) => `${obj.id}-dl-${part}`;
  const title = make(doc, "p", "os-download-title", c.title);
  const description = make(doc, "p", "os-download-description", c.description);
  description.id = id("description");
  const details = make(doc, "p", "os-download-details", fileDetails(c.src, options.size));
  details.id = id("details");
  const help = make(doc, "p", "os-download-help", DOWNLOAD_HELP);
  help.id = id("help");

  const label = `Download ${c.title}`;
  let link: HTMLElement;
  if (options.editing) {
    link = make(doc, "span", "os-download-link", label);
  } else {
    // The download attribute keeps a PDF from opening in place of the course. The link has the title, the kind of file
    // and the description read after its name, so a screen reader user hears what they are about to get.
    link = make(doc, "a", "os-download-link", label);
    link.setAttribute("href", c.src);
    link.setAttribute("download", fileName(c.src));
    link.setAttribute("aria-describedby", `${id("details")} ${id("description")}`);
  }
  root.append(title, description, details, link, help);
  return root;
}
