// How the editor reaches the file system and the validator. In the app these are Rust
// commands. In a plain browser (the preview used for development) they are a small local
// web server that does the same jobs. The interface is the same either way.

import { DOWNLOAD_EXTENSIONS } from "../../player/src/downloads.ts";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm as confirmDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import type { FileText, OpenedProject } from "./model.ts";
import { base64ToBytes, parseMakeResult, type CachedAudio, type MakeResult } from "./narration.ts";
import { parsePublishResult, type PublishResult } from "./publishing.ts";

/** A readable message from whatever was thrown, without the word "Error:" in front. */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface Finding {
  severity: "error" | "warning";
  file: string;
  object_id: string;
  rule: string;
  message: string;
  detail: string;
}

/** What updating an older project did. */
export interface MigrationReport {
  status: "updated" | "current";
  from: string;
  to: string;
  notes: string[];
  backup: string | null;
}

/** The kinds of file a project keeps under assets/. */
export type AssetKindName = "image" | "video" | "audio" | "captions" | "document";

export interface AssetFile {
  /** Project-relative, such as assets/images/a.png. */
  path: string;
  kind: AssetKindName;
  size: number;
}

export interface Backend {
  /** Ask the author for a folder. Null if they cancelled. */
  pickFolder(title: string, purpose: "open" | "new" | "publish"): Promise<string | null>;
  open(dir: string): Promise<OpenedProject>;
  /** Update a project made by an older version, keeping a backup of its old files inside it. */
  migrate(dir: string): Promise<MigrationReport>;
  /** Make a new project in an empty folder. Refuses a folder that has anything in it. */
  create(dir: string, files: FileText[]): Promise<void>;
  /** Write changed files, and remove the slide files listed in `remove`. */
  save(dir: string, files: FileText[], remove: string[]): Promise<void>;
  /** Ask the author for an image file. Null if they cancelled. */
  pickImage(): Promise<string | null>;
  /** Copy an image into the project's assets folder. Returns its path inside the project. */
  importImage(dir: string, source: string): Promise<string>;
  /** Ask the author for a file of one kind. Null if they cancelled. */
  pickFile(kind: AssetKindName): Promise<string | null>;
  /** Copy a file into the project's assets folder for its kind. Returns its path inside the project. */
  importAsset(dir: string, source: string, kind: AssetKindName): Promise<string>;
  /** Every file in the project's asset folders. */
  listAssets(dir: string): Promise<AssetFile[]>;
  deleteAsset(dir: string, path: string): Promise<void>;
  /** Fetch a web address from a stock library. Only those services can be reached. */
  httpGet(url: string, headers: [string, string][]): Promise<string>;
  /** Download a picture, video or sound from a stock library into the project. Returns its path inside the project. */
  downloadAsset(dir: string, url: string, nameHint: string, kind: "image" | "video" | "audio"): Promise<string>;
  /** The editor's own settings, kept with the program and never in a project. */
  readSettings(): Promise<string>;
  writeSettings(text: string): Promise<void>;
  /** Open a web page in the author's own browser. */
  openUrl(url: string): Promise<void>;
  validate(dir: string, files: FileText[]): Promise<Finding[]>;
  /**
   * Make the course as it is in the editor now, saved or not, in a temporary folder. The answer says where its first
   * page is. Skips the problem check and makes no narration audio, so it is quick.
   */
  preview(dir: string, files: FileText[]): Promise<PublishResult>;
  /** Publish the saved project: the course as web files and a SCORM 1.2 zip, both inside `folder`. */
  publish(dir: string, folder: string): Promise<PublishResult>;
  /** Stop the preview or publish that is running. Returns whether there was one. */
  cancelJob(): Promise<boolean>;
  /** Open a page that OpenStage Author made in the author's own browser. */
  openInBrowser(path: string): Promise<void>;
  /** Show a file in its folder in the file explorer. */
  revealInFolder(path: string): Promise<void>;
  /** Whether a speech engine is set up on this computer, so narration audio can be made. */
  narrationEngine(): Promise<boolean>;
  /** The narration audio already made for the project, by cache key. */
  narrationCache(dir: string): Promise<CachedAudio[]>;
  /** One piece of narration audio (a WAV file), by its cache key. */
  readNarrationAudio(dir: string, key: string): Promise<Uint8Array<ArrayBuffer>>;
  /**
   * Make narration audio for the project as it is in the editor now, saved or not. `ids` are the objects to make it
   * for, or none to make everything that is missing. The audio goes into the project's .cache folder.
   */
  makeNarration(dir: string, files: FileText[], ids: string[]): Promise<MakeResult>;
  /** A URL the page can show an image from, for a file inside the project's assets folder. */
  assetUrl(dir: string, path: string): Promise<string>;
  confirm(message: string): Promise<boolean>;
  setTitle(title: string): Promise<void>;
  /** Called with a function that returns true if closing would lose work. */
  guardClose(hasUnsaved: () => boolean): void;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * A test seam. Automated tests of the real app cannot click a native file dialog, so they can set
 * window.__openstageTestPick to a function that returns the path to use instead. Nothing in the
 * app sets it, so it has no effect unless a test (or someone in the developer tools) does.
 */
type PickKind = "open" | "new" | "publish" | AssetKindName;
type TestPick = (kind: PickKind) => string | null | undefined;
const testPick = (kind: PickKind): string | null | undefined =>
  (window as unknown as { __openstageTestPick?: TestPick }).__openstageTestPick?.(kind);

const PICK_TITLES: Record<AssetKindName, string> = { image: "Choose an image", video: "Choose a video", audio: "Choose an audio file", captions: "Choose a captions file", document: "Choose a file to download" };
const PICK_EXTENSIONS: Record<AssetKindName, string[]> = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "svg"], video: ["mp4", "webm", "m4v", "ogv"], audio: ["mp3", "wav", "ogg", "m4a", "aac"], captions: ["vtt"], document: [...DOWNLOAD_EXTENSIONS],
};

const tauriBackend: Backend = {
  async pickFolder(title, purpose) {
    const forced = testPick(purpose);
    if (forced !== undefined) return forced;
    const picked = await openDialog({ directory: true, multiple: false, title });
    return typeof picked === "string" ? picked : null;
  },
  open: (dir) => invoke<OpenedProject>("open_project", { dir }),
  create: (dir, files) => invoke<void>("create_project", { dir, files }),
  async migrate(dir) {
    return JSON.parse(await invoke<string>("migrate_project", { dir })) as MigrationReport;
  },
  save: (dir, files, remove) => invoke<void>("save_files", { dir, files, remove }),
  async pickImage() {
    const forced = testPick("image");
    if (forced !== undefined) return forced;
    const picked = await openDialog({
      multiple: false,
      title: "Choose an image",
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }],
    });
    return typeof picked === "string" ? picked : null;
  },
  importImage: (dir, source) => invoke<string>("import_image", { dir, source }),
  async pickFile(kind) {
    const forced = testPick(kind);
    if (forced !== undefined) return forced;
    const picked = await openDialog({ multiple: false, title: PICK_TITLES[kind], filters: [{ name: PICK_TITLES[kind], extensions: PICK_EXTENSIONS[kind] }] });
    return typeof picked === "string" ? picked : null;
  },
  importAsset: (dir, source, kind) => invoke<string>("import_asset", { dir, source, kind }),
  listAssets: (dir) => invoke<AssetFile[]>("list_assets", { dir }),
  deleteAsset: (dir, path) => invoke<void>("delete_asset", { dir, path }),
  httpGet: (url, headers) => invoke<string>("http_get", { url, headers }),
  downloadAsset: (dir, url, nameHint, kind) => invoke<string>("download_asset", { dir, url, nameHint, kind }),
  readSettings: () => invoke<string>("read_settings"),
  writeSettings: (text) => invoke<void>("write_settings", { text }),
  openUrl: (url) => openUrl(url),
  async validate(dir, files) {
    return JSON.parse(await invoke<string>("validate", { dir, files })) as Finding[];
  },
  async preview(dir, files) {
    return parsePublishResult(await invoke<string>("preview_project", { dir, files }));
  },
  async publish(dir, folder) {
    return parsePublishResult(await invoke<string>("publish_project", { dir, folder }));
  },
  cancelJob: () => invoke<boolean>("cancel_job"),
  openInBrowser: (path) => invoke<void>("open_in_browser", { path }),
  revealInFolder: (path) => revealItemInDir(path),
  narrationEngine: () => invoke<boolean>("narration_engine"),
  narrationCache: (dir) => invoke<CachedAudio[]>("narration_cache", { dir }),
  async readNarrationAudio(dir, key) {
    return base64ToBytes(await invoke<string>("read_narration_audio", { dir, hash: key }));
  },
  async makeNarration(dir, files, ids) {
    return parseMakeResult(await invoke<string>("make_narration", { dir, files, ids }));
  },
  // The file comes back as a data URL string, which needs no binary transfer and no special
  // permission, and works for every image type including SVG.
  assetUrl: (dir, path) => invoke<string>("read_asset_url", { dir, path }),
  confirm: (message) => confirmDialog(message, { title: "OpenStage Author", kind: "warning" }),
  setTitle: (title) => getCurrentWindow().setTitle(title),
  guardClose(hasUnsaved) {
    void getCurrentWindow().onCloseRequested(async (event) => {
      if (hasUnsaved() && !(await confirmDialog("You have unsaved changes. Close anyway?", { title: "OpenStage Author", kind: "warning" }))) {
        event.preventDefault();
      }
    });
  },
};

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  return JSON.parse(text) as T;
}

const previewBackend: Backend = {
  async pickFolder(title, purpose) {
    const param = new URLSearchParams(location.search).get(purpose === "new" ? "newdir" : purpose === "publish" ? "publishdir" : "dir");
    return param ?? window.prompt(title);
  },
  async open(dir) {
    const res = await fetch(`/api/open?dir=${encodeURIComponent(dir)}`);
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as OpenedProject;
  },
  async save(dir, files, remove) {
    await post("/api/save", { dir, files, remove });
  },
  async pickImage() {
    return new URLSearchParams(location.search).get("image") ?? window.prompt("Path of an image file");
  },
  importImage: (dir, source) => post<string>("/api/import", { dir, source }),
  async pickFile(kind) {
    return new URLSearchParams(location.search).get(kind) ?? window.prompt(`Path of a ${kind} file`);
  },
  importAsset: (dir, source, kind) => post<string>("/api/import", { dir, source, kind }),
  listAssets: (dir) => post<AssetFile[]>("/api/assets", { dir }),
  async deleteAsset(dir, path) {
    await post("/api/delete-asset", { dir, path });
  },
  async httpGet() {
    throw new Error("Stock search needs the desktop app.");
  },
  async downloadAsset() {
    throw new Error("Stock search needs the desktop app.");
  },
  async readSettings() {
    return localStorage.getItem("openstage-settings") ?? "";
  },
  async writeSettings(text) {
    localStorage.setItem("openstage-settings", text);
  },
  async openUrl(url) {
    window.open(url, "_blank", "noopener");
  },
  async create(dir, files) {
    await post("/api/create", { dir, files });
  },
  migrate: (dir) => post<MigrationReport>("/api/migrate", { dir }),
  validate: (dir, files) => post<Finding[]>("/api/validate", { dir, files }),
  async preview() {
    throw new Error("Preview needs the desktop app.");
  },
  async publish() {
    throw new Error("Publishing needs the desktop app.");
  },
  async cancelJob() {
    return false;
  },
  async openInBrowser() {
    throw new Error("Opening a course needs the desktop app.");
  },
  async revealInFolder() {
    throw new Error("Showing a file in its folder needs the desktop app.");
  },
  async narrationEngine() {
    return false;
  },
  async narrationCache() {
    return [];
  },
  async readNarrationAudio() {
    throw new Error("Playing narration needs the desktop app.");
  },
  async makeNarration() {
    throw new Error("Making narration audio needs the desktop app.");
  },
  async assetUrl(dir, path) {
    const res = await fetch(`/api/asset?dir=${encodeURIComponent(dir)}&path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error(await res.text());
    const type = path.toLowerCase().endsWith(".svg") ? "image/svg+xml" : undefined;
    return URL.createObjectURL(new Blob([await res.arrayBuffer()], type ? { type } : {}));
  },
  async confirm(message) {
    return window.confirm(message);
  },
  async setTitle(title) {
    document.title = title;
  },
  guardClose(hasUnsaved) {
    window.addEventListener("beforeunload", (e) => {
      if (hasUnsaved()) e.preventDefault();
    });
  },
};

export const backend: Backend = isTauri ? tauriBackend : previewBackend;
