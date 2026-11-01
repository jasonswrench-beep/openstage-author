// How the editor reaches the file system and the validator. In the app these are Rust
// commands. In a plain browser (the preview used for development) they are a small local
// web server that does the same jobs. The interface is the same either way.

import { DOWNLOAD_EXTENSIONS } from "../../player/src/downloads.ts";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm as confirmDialog, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { parseMade, parsePlugins, parseServiceAnswer, type MadeAnswer, type PluginList, type ServiceAnswer, type ServiceId } from "./aiservices.ts";
import type { FileText, OpenedProject } from "./model.ts";
import { base64ToBytes, parseMakeResult, type CachedAudio, type MakeResult } from "./narration.ts";
import { parseSample, type SampleAnswer } from "./voicesample.ts";
import { parsePublishResult, type PublishResult } from "./publishing.ts";
import { parseTranslationAnswer, type TranslationExported, type TranslationFailed, type TranslationImported } from "./translation.ts";
import type { CaptureCheck, HotkeyBinding, HotkeyResult, StreamExit, StreamState } from "./recorder.ts";
import { parseSpeechStatus, type SpeechStatus } from "./recognition.ts";
import { NO_ENGINE_STATUS, parseEngineStatus, type EngineStatus } from "./engine.ts";
import { UNKNOWN_ABOUT, parseAbout, type AboutInfo } from "./about.ts";
import { NO_PACKS, parsePackAnswer, parsePackList, type PackAnswer, type PackList, type PackSource } from "./packs.ts";
import { parseSetMade, parseSetRead, type SetAnswer, type SetMade, type SetRead } from "./slidesets.ts";

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
  /**
   * Save a picture that came out of a PowerPoint deck in the project's images. `name` is the file name the importer made from what is in the
   * picture (pptx- and 14 letters and numbers, then the extension); a name that is already there is left as it is. Returns the path in the project.
   */
  saveDeckPicture(dir: string, name: string, bytes: Uint8Array): Promise<string>;
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
  /** Make the packages, and with `video` an MP4 of the course too (Windows only; it takes minutes). */
  publish(dir: string, folder: string, options?: { video?: boolean }): Promise<PublishResult>;
  /** Stop the preview or publish that is running. Returns whether there was one. */
  cancelJob(): Promise<boolean>;
  /** Open a page that OpenStage Author made in the author's own browser. */
  openInBrowser(path: string): Promise<void>;
  /** Show a file in its folder in the file explorer. */
  revealInFolder(path: string): Promise<void>;
  /** Whether a speech engine is set up on this computer, so narration audio can be made. */
  narrationEngine(): Promise<boolean>;
  /** The version, and where things are on this computer, for the About window. */
  aboutInfo(): Promise<AboutInfo>;
  /** The folder of one of the example projects that came with the program (to show the folder by), or "" if there are none. */
  examplesFolder(): Promise<string>;
  /** The character packs on this computer: the ones that came with the program and the ones the author added, and any folder that looks like a pack but cannot be used. */
  packsList(): Promise<PackList>;
  /** The folder the author's own packs are kept in (made if it is not there yet), to show them. */
  packsFolder(): Promise<string>;
  /** Ask for a pack's zip file with a file dialog. Null if the author cancelled. */
  pickPackZip(): Promise<string | null>;
  /** Install a pack from a zip file. Everything is checked first; the answer says what happened, in words. */
  packInstall(source: string): Promise<PackAnswer>;
  /** Take away a pack the author added. */
  packRemove(id: string): Promise<PackAnswer>;
  /** A picture inside a pack, as an address the page can show. */
  packPictureUrl(source: PackSource, folder: string, path: string): Promise<string>;
  /** Copy a picture of a pack into the project's images, and give its project-relative path. */
  packUsePicture(dir: string, source: PackSource, folder: string, path: string, nameHint: string): Promise<string>;
  /** Ask for a set of slides (a file ending .osset) with a file dialog. Null if the author cancelled. */
  pickSetFile(): Promise<string | null>;
  /** Ask where to save a set of slides, with a file dialog. Null if the author cancelled. */
  pickSetSave(name: string): Promise<string | null>;
  /** Ask which table of questions to read (a CSV file saved from a spreadsheet), with a file dialog. Null if the author cancelled. */
  pickQuestionFile(): Promise<string | null>;
  /** Ask where to save the blank table of questions, with a file dialog. Null if the author cancelled. */
  pickQuestionTemplateSave(name?: string): Promise<string | null>;
  /** Ask where to save the translation file, with a file dialog. Null if the author cancelled. */
  pickTranslationSave(name: string): Promise<string | null>;
  /** Ask which translated file to bring in, with a file dialog. Null if the author cancelled. */
  pickTranslationFile(): Promise<string | null>;
  /** Write the words of the project to an XLIFF file for translating into `language`. A refusal comes back as an answer with a reason. */
  translationExport(dir: string, language: string, dest: string, pseudo: boolean): Promise<TranslationExported | TranslationFailed>;
  /** Make a translated copy of the project from a translated XLIFF file, in a new folder inside `into`. */
  translationImport(dir: string, source: string, into: string): Promise<TranslationImported | TranslationFailed>;
  /** The words of a table of questions saved as CSV or text, whatever way the spreadsheet program saved them. */
  questionFileRead(source: string): Promise<string>;
  /** Write the blank table of questions to a file the author chose. */
  questionTemplateWrite(dest: string, text: string): Promise<void>;
  /** Check a set of slides and unpack it into a folder of its own; the answer says what is in it, or why it cannot be used. */
  setRead(source: string): Promise<SetAnswer<SetRead>>;
  /** Copy one file of an unpacked set into the project, and give its project-relative path. */
  setUseAsset(stage: string, dir: string, path: string): Promise<string>;
  /** Take away the folder a set was unpacked into. */
  setDiscard(stage: string): Promise<void>;
  /** Make a set from slides of the saved project and write it to `out`. */
  setMake(dir: string, input: { slides: string[]; title: string; author: string; licence: string; description: string }, out: string): Promise<SetAnswer<SetMade>>;
  /** What the editor knows about the narration engine: the author's own, one it installed, or none, and whether it can install one. */
  engineStatus(): Promise<EngineStatus>;
  /** Install the narration engine into the editor's own folder (packages from PyPI, the voice model from Hugging Face). Progress comes through `onEngineProgress`; `cancelJob` stops it. */
  engineInstall(): Promise<void>;
  onEngineProgress(listener: (p: { step: number; steps: number; label: string; line: string }) => void): Promise<() => void>;
  /** Take the editor's own narration engine away. Resolves with how many bytes that freed. */
  engineRemove(): Promise<number>;
  /** The narration audio already made for the project, by cache key. */
  narrationCache(dir: string): Promise<CachedAudio[]>;
  /** One piece of narration audio (a WAV file), by its cache key. */
  readNarrationAudio(dir: string, key: string): Promise<Uint8Array<ArrayBuffer>>;
  /** Delete narration audio by cache key. Returns how many were deleted. Only audio inside the project's own cache can be named. */
  deleteNarrationAudio(dir: string, keys: string[]): Promise<number>;
  /** Keep the audio made for one key under another key that names the same sound. Resolves with whether anything was copied. */
  reuseNarrationAudio(dir: string, from: string, to: string): Promise<boolean>;
  /**
   * Make narration audio for the project as it is in the editor now, saved or not. `ids` are the objects to make it
   * for, or none to make everything that is missing. The audio goes into the project's .cache folder.
   */
  makeNarration(dir: string, files: FileText[], ids: string[]): Promise<MakeResult>;
  // ---- AI services and voice plugins (docs/ai-generation.md). The tools check the author's permission themselves, using the settings file.

  /** The voice plugins in the plugins folder, and whether each is switched on. Runs no plugin and sends nothing. */
  aiPlugins(): Promise<PluginList>;
  /** The folder the author puts voice plugins in, made if it is not there yet. */
  aiPluginsFolder(): Promise<string>;
  /** Ask a service something free: whether the author's key works ("check"). */
  aiService(op: "check", service: ServiceId): Promise<ServiceAnswer>;
  /** Make a picture with a service and save it in the project's images. This costs the author money. */
  aiMake(dir: string, kind: "picture", request: Record<string, unknown>): Promise<MadeAnswer>;
  /**
   * A short sample of a voice, to hear before choosing it: one fixed sentence in the voice's language, made the first time and then kept on this
   * computer. None of the author's words are used. A voice of a service is charged for the first time only, by the service, to the author's account.
   */
  voiceSample(voice: string, lang: string): Promise<SampleAnswer>;
  /** A URL the page can show an image from, for a file inside the project's assets folder. */
  assetUrl(dir: string, path: string): Promise<string>;
  /**
   * An address a video or audio element can play a file from the project's assets folder at, straight from disk with seeking, so a
   * recording of any length can be previewed without reading it into memory.
   */
  mediaUrl(dir: string, path: string): Promise<string>;

  // ---- the recordings of a course (OpenScreen): `<course>/captures/<name>.capture`, reached by the course's folder and the recording's folder name only

  /** The recordings in the course, by folder name. */
  listRecordings(dir: string): Promise<string[]>;
  /** The text of a .json file inside a recording (`capture.json`, `edit.json`, `takes/take-001/take.json`), or undefined if there is none. */
  recordingRead(dir: string, name: string, rel: string): Promise<string | undefined>;
  /** The folders directly inside a place in a recording. */
  recordingFolders(dir: string, name: string, rel: string): Promise<string[]>;
  /** Save the edit of a recording as its edit.json, whole or not at all. The only file ever written in a recording. */
  recordingWriteEdit(dir: string, name: string, text: string): Promise<void>;
  /** Keep the saved edit before a new edit of the newest take replaces it: copied to `file`, which is `edit-before-take-<n>.json`. Whole or not at all, and never written over a different copy. */
  recordingKeepEdit(dir: string, name: string, file: string, text: string): Promise<void>;
  /** Save a picture taken from a recording (the picture of a step) as a PNG in the course's images. Returns its path inside the course. */
  saveStepPicture(dir: string, nameHint: string, bytes: Uint8Array): Promise<string>;
  /** Save the steps made from a recording as its steps.json, whole or not at all. With edit.json, the only file ever written in a recording. */
  recordingWriteSteps(dir: string, name: string, text: string): Promise<void>;
  /** An address a video or audio element can play a file of a take from, straight from disk with seeking. */
  recordingMediaUrl(dir: string, name: string, rel: string): Promise<string>;

  // ---- captions: WebVTT files in the course's assets/captions (editor/src/captions.ts says what is in them)

  /** Ask the author for a captions file to read into the captions dialog (.vtt or .srt). Null if they cancelled. */
  pickCaptionSource(): Promise<string | null>;
  /** The text of a .vtt or .srt file the author picked. Nothing is copied into the course. */
  captionSourceRead(source: string): Promise<string>;
  /** The text of a captions file in the course (`assets/captions/<name>.vtt`), or undefined if there is none. */
  captionsRead(dir: string, path: string): Promise<string | undefined>;
  /** Save WebVTT captions in the course: in place of `existing` when that file is there, otherwise as a new file named from `nameHint`. Returns the path. */
  captionsWrite(dir: string, nameHint: string, existing: string | null, text: string): Promise<string>;

  // ---- speech recognition: captions from a recorded voice. The recogniser is a separate program (docs/decisions/0002-speech-recognition.md); nothing is sent anywhere.

  /** Whether the recogniser is installed, where its models are kept, and which are downloaded. */
  speechStatus(): Promise<SpeechStatus>;
  /** Download a model the author asked for (by its id, such as `small.en`). Resolves when it is there and its checksum is right. */
  speechDownload(id: string): Promise<void>;
  /** Told how much of a model has arrived. Returns a function that stops listening. */
  onSpeechDownload(listener: (progress: { id: string; done: number; total: number }) => void): Promise<() => void>;
  /** The bytes of a video or audio file in the course's assets, to read its sound. */
  mediaBytes(dir: string, path: string): Promise<Uint8Array>;
  /** Keep a sound (a 16 kHz mono 16-bit WAV) for the recogniser to listen to. Returns the name to listen to it by. */
  speechAudioPut(wav: Uint8Array): Promise<string>;
  /** Listen to a kept sound with a model, given a hint of the course's words, and return the recogniser's answer (its JSON). */
  speechListen(audio: string, model: string, hint: string): Promise<string>;
  /** Let go of a kept sound. */
  speechDrop(audio: string): Promise<void>;
  /** Told how far the listening has got, in percent. Returns a function that stops listening. */
  onSpeechProgress(listener: (percent: number) => void): Promise<() => void>;
  /** Stop a download or a listening that is going on. Returns whether there was one. */
  speechCancel(): Promise<boolean>;

  // ---- the Capture recorder: a separate program the editor starts and talks to, one line of JSON at a time

  /** Where the recorder is, or a message that says why it cannot be used and what to do. */
  captureCheck(): Promise<CaptureCheck>;
  /** Start the recorder with these options. Refused politely if one is already running. */
  streamStart(args: string[]): Promise<void>;
  /** Send the recorder one command: one short line of JSON. */
  streamSend(line: string): Promise<void>;
  /** Tell the shell the recorder has paused or resumed, so a publish or preview knows whether it may run. */
  streamSetPaused(paused: boolean): Promise<void>;
  streamState(): Promise<StreamState>;
  /** Stop the recorder: it is asked to finish and print its result, given ten seconds, and only then ended by force. */
  streamStop(stopLine?: string): Promise<boolean>;
  /** Called with each line the recorder prints, as it prints it. Returns a function that stops listening. */
  onStreamLine(listener: (line: string) => void): Promise<() => void>;
  /** Called once when a recorder run ends, with how it ended. */
  onStreamExit(listener: (exit: StreamExit) => void): Promise<() => void>;

  // ---- keys that work while another program has the focus

  /** Replace every registered key with these. Each comes back with whether it worked and, if not, why. */
  hotkeysSet(bindings: HotkeyBinding[]): Promise<HotkeyResult[]>;
  hotkeysClear(): Promise<void>;
  /** Called with the id of a key each time it is pressed. */
  onHotkey(listener: (id: string) => void): Promise<() => void>;
  confirm(message: string): Promise<boolean>;
  setTitle(title: string): Promise<void>;
  /** Called with a function that returns true if closing would lose work. */
  guardClose(hasUnsaved: () => boolean): void;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Bytes as base64 text, in pieces so a big picture does not overflow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * A test seam. Automated tests of the real app cannot click a native file dialog, so they can set
 * window.__openstageTestPick to a function that returns the path to use instead. Nothing in the
 * app sets it, so it has no effect unless a test (or someone in the developer tools) does.
 */
type PickKind = "open" | "new" | "publish" | "captionsource" | "packzip" | "setfile" | "setsave" | "questionfile" | "questionsave" | "translationfile" | "translationsave" | AssetKindName;
type TestPick = (kind: PickKind) => string | null | undefined;
/** The same seam for the questions the editor asks with a native Yes or No: a test sets window.__openstageTestConfirm to a function that answers. */
const testConfirm = (message: string): boolean | undefined =>
  (window as unknown as { __openstageTestConfirm?: (message: string) => boolean | undefined }).__openstageTestConfirm?.(message);

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
  saveDeckPicture: (dir, name, bytes) => invoke<string>("save_deck_picture", { dir, name, data: bytesToBase64(bytes) }),
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
  async publish(dir, folder, options) {
    return parsePublishResult(await invoke<string>("publish_project", { dir, folder, video: options?.video === true }));
  },
  cancelJob: () => invoke<boolean>("cancel_job"),
  openInBrowser: (path) => invoke<void>("open_in_browser", { path }),
  revealInFolder: (path) => revealItemInDir(path),
  narrationEngine: () => invoke<boolean>("narration_engine"),
  async aboutInfo() {
    return parseAbout(await invoke<string>("about_info"));
  },
  examplesFolder: () => invoke<string>("examples_folder"),
  async packsList() {
    return parsePackList(await invoke<string>("packs_list"));
  },
  packsFolder: () => invoke<string>("packs_folder"),
  async pickPackZip() {
    const forced = testPick("packzip");
    if (forced !== undefined) return forced;
    const picked = await openDialog({ multiple: false, title: "Choose a character pack (a zip file)", filters: [{ name: "Character packs", extensions: ["zip"] }] });
    return typeof picked === "string" ? picked : null;
  },
  async packInstall(source) {
    return parsePackAnswer(await invoke<string>("pack_install", { source }));
  },
  async pickSetFile() {
    const forced = testPick("setfile");
    if (forced !== undefined) return forced;
    const picked = await openDialog({ multiple: false, title: "Choose a set of slides", filters: [{ name: "Sets of slides", extensions: ["osset"] }] });
    return typeof picked === "string" ? picked : null;
  },
  async pickQuestionFile() {
    const forced = testPick("questionfile");
    if (forced !== undefined) return forced;
    const picked = await openDialog({ multiple: false, title: "Choose a table of questions", filters: [{ name: "Tables of questions (CSV)", extensions: ["csv", "tsv", "txt"] }] });
    return typeof picked === "string" ? picked : null;
  },
  async pickQuestionTemplateSave(name) {
    const forced = testPick("questionsave");
    if (forced !== undefined) return forced;
    const picked = await saveDialog({ title: name ? "Save the sample spreadsheet" : "Save the blank table of questions", defaultPath: name ?? "OpenStage questions template.csv", filters: [{ name: "CSV files", extensions: ["csv"] }] });
    return typeof picked === "string" ? picked : null;
  },
  questionFileRead: (source) => invoke<string>("question_file_read", { source }),
  questionTemplateWrite: (dest, text) => invoke<void>("question_template_write", { dest, text }),
  async pickTranslationSave(name) {
    const forced = testPick("translationsave");
    if (forced !== undefined) return forced;
    const picked = await saveDialog({ title: "Save the translation file", defaultPath: name, filters: [{ name: "XLIFF translation files", extensions: ["xlf"] }] });
    return typeof picked === "string" ? picked : null;
  },
  async pickTranslationFile() {
    const forced = testPick("translationfile");
    if (forced !== undefined) return forced;
    const picked = await openDialog({ multiple: false, title: "Choose the translated file", filters: [{ name: "XLIFF translation files", extensions: ["xlf", "xliff"] }] });
    return typeof picked === "string" ? picked : null;
  },
  async translationExport(dir, language, dest, pseudo) {
    return parseTranslationAnswer<TranslationExported>(await invoke<string>("translation_export", { dir, language, dest, pseudo }));
  },
  async translationImport(dir, source, into) {
    return parseTranslationAnswer<TranslationImported>(await invoke<string>("translation_import", { dir, source, into }));
  },
  async pickSetSave(name) {
    const forced = testPick("setsave");
    if (forced !== undefined) return forced;
    const picked = await saveDialog({ title: "Save the set of slides", defaultPath: name, filters: [{ name: "Sets of slides", extensions: ["osset"] }] });
    return typeof picked === "string" ? picked : null;
  },
  async setRead(source) {
    return parseSetRead(await invoke<string>("set_read", { source }));
  },
  setUseAsset: (stage, dir, path) => invoke<string>("set_use_asset", { stage, dir, path }),
  async setDiscard(stage) {
    await invoke("set_discard", { stage });
  },
  async setMake(dir, input, out) {
    return parseSetMade(await invoke<string>("set_make", { dir, slides: input.slides, title: input.title, author: input.author, licence: input.licence, description: input.description, out }));
  },
  async packRemove(id) {
    return parsePackAnswer(await invoke<string>("pack_remove", { id }));
  },
  packPictureUrl: (source, folder, path) => invoke<string>("pack_picture_url", { source, folder, path }),
  packUsePicture: (dir, source, folder, path, nameHint) => invoke<string>("pack_use_picture", { dir, source, folder, path, nameHint }),
  async engineStatus() {
    return parseEngineStatus(await invoke<string>("engine_status"));
  },
  engineInstall: () => invoke<void>("engine_install"),
  onEngineProgress: (listener) => listen<{ step: number; steps: number; label: string; line: string }>("engine-progress", (e) => listener(e.payload)),
  engineRemove: () => invoke<number>("engine_remove"),
  narrationCache: (dir) => invoke<CachedAudio[]>("narration_cache", { dir }),
  deleteNarrationAudio: (dir, keys) => invoke<number>("delete_narration_audio", { dir, keys }),
  reuseNarrationAudio: (dir, from, to) => invoke<boolean>("reuse_narration_audio", { dir, from, to }),
  async readNarrationAudio(dir, key) {
    return base64ToBytes(await invoke<string>("read_narration_audio", { dir, hash: key }));
  },
  async makeNarration(dir, files, ids) {
    return parseMakeResult(await invoke<string>("make_narration", { dir, files, ids }));
  },
  async aiPlugins() {
    return parsePlugins(await invoke<string>("ai_plugins"));
  },
  aiPluginsFolder: () => invoke<string>("ai_plugins_folder"),
  async aiService(op, service) {
    return parseServiceAnswer(await invoke<string>("ai_service", { op, service }));
  },
  async aiMake(dir, kind, request) {
    return parseMade(await invoke<string>("ai_make", { dir, kind, request: JSON.stringify(request) }));
  },
  async voiceSample(voice, lang) {
    return parseSample(await invoke<string>("voice_sample", { voice, lang }));
  },
  // The file comes back as a data URL string, which needs no binary transfer and no special
  // permission, and works for every image type including SVG.
  assetUrl: (dir, path) => invoke<string>("read_asset_url", { dir, path }),
  async mediaUrl(dir, path) {
    // Only the project's own assets folder is ever opened up, and a path that climbs out of it is not a path.
    if (!/^assets\/[^.]/.test(path) || path.split("/").includes("..")) throw new Error("That file is not in the project's assets.");
    await invoke<void>("allow_project_media", { dir });
    const sep = dir.includes("\\") ? "\\" : "/";
    return convertFileSrc(`${dir.replace(/[\\/]+$/, "")}${sep}${path.split("/").join(sep)}`);
  },
  listRecordings: (dir) => invoke<string[]>("list_recordings", { dir }),
  async recordingRead(dir, name, rel) {
    return (await invoke<string | null>("recording_read", { dir, name, rel })) ?? undefined;
  },
  recordingFolders: (dir, name, rel) => invoke<string[]>("recording_folders", { dir, name, rel }),
  recordingWriteEdit: (dir, name, text) => invoke<void>("recording_write_edit", { dir, name, text }),
  recordingKeepEdit: (dir, name, file, text) => invoke<void>("recording_keep_edit", { dir, name, file, text }),
  recordingWriteSteps: (dir, name, text) => invoke<void>("recording_write_steps", { dir, name, text }),
  saveStepPicture: (dir, nameHint, bytes) => invoke<string>("save_step_picture", { dir, nameHint, data: bytesToBase64(bytes) }),
  async recordingMediaUrl(dir, name, rel) {
    // Only the media of a take can be played, and a path that climbs out of it is not a path.
    if (!/^takes\/take-\d+\/[^/\\]+$/.test(rel)) throw new Error("That file is not in a take of the recording.");
    await invoke<void>("allow_recording_media", { dir, name });
    const sep = dir.includes("\\") ? "\\" : "/";
    return convertFileSrc([dir.replace(/[\\/]+$/, ""), "captures", name, ...rel.split("/")].join(sep));
  },
  async pickCaptionSource() {
    const forced = testPick("captionsource");
    if (forced !== undefined) return forced;
    const picked = await openDialog({ multiple: false, title: "Choose a captions file", filters: [{ name: "Captions", extensions: ["vtt", "srt"] }] });
    return typeof picked === "string" ? picked : null;
  },
  captionSourceRead: (source) => invoke<string>("caption_source_read", { source }),
  async captionsRead(dir, path) {
    return (await invoke<string | null>("captions_read", { dir, rel: path })) ?? undefined;
  },
  captionsWrite: (dir, nameHint, existing, text) => invoke<string>("captions_write", { dir, nameHint, existing, text }),
  async speechStatus() {
    return parseSpeechStatus(await invoke<string>("speech_status"));
  },
  speechDownload: (id) => invoke<void>("speech_download", { id }),
  onSpeechDownload: (listener) => listen<{ id: string; done: number; total: number }>("speech-download", (e) => listener(e.payload)),
  async mediaBytes(dir, path) {
    // Raw bytes come back as an ArrayBuffer, so a long video is not turned into text on the way.
    return new Uint8Array(await invoke<ArrayBuffer>("read_media_bytes", { dir, path }));
  },
  speechAudioPut: (wav) => invoke<string>("speech_audio_put", wav),
  speechListen: (audio, model, hint) => invoke<string>("speech_listen", { audio, model, hint }),
  speechDrop: (audio) => invoke<void>("speech_drop", { audio }),
  onSpeechProgress: (listener) => listen<number>("speech-progress", (e) => listener(e.payload)),
  speechCancel: () => invoke<boolean>("speech_cancel"),
  async captureCheck() {
    try {
      return { ok: true, path: await invoke<string>("capture_check") };
    } catch (err) {
      return { ok: false, message: errorText(err) };
    }
  },
  streamStart: (args) => invoke<void>("stream_start", { args }),
  streamSend: (line) => invoke<void>("stream_send", { line }),
  streamSetPaused: (paused) => invoke<void>("stream_set_paused", { paused }),
  streamState: () => invoke<StreamState>("stream_state"),
  streamStop: (stopLine) => invoke<boolean>("stream_stop", { stopLine: stopLine ?? null }),
  onStreamLine: (listener) => listen<string>("stream-line", (e) => listener(e.payload)),
  onStreamExit: (listener) => listen<StreamExit>("stream-exit", (e) => listener(e.payload)),
  hotkeysSet: (bindings) => invoke<HotkeyResult[]>("hotkeys_set", { bindings }),
  hotkeysClear: () => invoke<void>("hotkeys_clear"),
  onHotkey: (listener) => listen<string>("hotkey", (e) => listener(e.payload)),
  confirm: async (message) => testConfirm(message) ?? confirmDialog(message, { title: "OpenStage Author", kind: "warning" }),
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
  saveDeckPicture: (dir, name, bytes) => post<string>("/api/save-deck-picture", { dir, name, data: bytesToBase64(bytes) }),
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
  async aboutInfo() {
    return { ...UNKNOWN_ABOUT, version: "(the page shown in a web browser, not the desktop program)" };
  },
  async examplesFolder() {
    return "";
  },
  async packsList() {
    return NO_PACKS;
  },
  async packsFolder() {
    throw new Error("Character packs need the desktop app.");
  },
  async pickPackZip() {
    return new URLSearchParams(location.search).get("packzip") ?? window.prompt("Path of a character pack (a zip file)");
  },
  async packInstall() {
    return { ok: false, message: "Adding a character pack needs the desktop app." };
  },
  async pickSetFile() {
    return null;
  },
  async pickSetSave() {
    return null;
  },
  async pickQuestionFile() {
    return null;
  },
  async pickQuestionTemplateSave() {
    return null;
  },
  async questionFileRead() {
    throw new Error("Reading a table of questions needs the desktop app.");
  },
  async questionTemplateWrite() {
    throw new Error("Saving the template needs the desktop app.");
  },
  // In a web browser there is no file dialog, so the web page is given the paths in its address (?translationsave=...&translationfile=...).
  async pickTranslationSave() {
    return new URLSearchParams(location.search).get("translationsave");
  },
  async pickTranslationFile() {
    return new URLSearchParams(location.search).get("translationfile");
  },
  translationExport: (dir, language, dest, pseudo) => post<TranslationExported | TranslationFailed>("/api/translation-export", { dir, language, dest, pseudo }),
  translationImport: (dir, source, into) => post<TranslationImported | TranslationFailed>("/api/translation-import", { dir, source, into }),
  async setRead() {
    return { ok: false, message: "Taking in a set of slides needs the desktop app." };
  },
  async setUseAsset() {
    throw new Error("Taking in a set of slides needs the desktop app.");
  },
  async setDiscard() {
    return undefined;
  },
  async setMake() {
    return { ok: false, message: "Sharing slides needs the desktop app." };
  },
  async packRemove() {
    return { ok: false, message: "Removing a character pack needs the desktop app." };
  },
  async packPictureUrl() {
    throw new Error("Character packs need the desktop app.");
  },
  async packUsePicture() {
    throw new Error("Character packs need the desktop app.");
  },
  async engineStatus() {
    return { ...NO_ENGINE_STATUS, problem: "Installing the narration voice needs the desktop app." };
  },
  async engineInstall() {
    throw new Error("Installing the narration voice needs the desktop app.");
  },
  async onEngineProgress() {
    return () => undefined;
  },
  async engineRemove() {
    throw new Error("Removing the narration voice needs the desktop app.");
  },
  async narrationCache() {
    return [];
  },
  async readNarrationAudio() {
    throw new Error("Playing narration needs the desktop app.");
  },
  async deleteNarrationAudio() {
    throw new Error("Clearing narration audio needs the desktop app.");
  },
  async reuseNarrationAudio() {
    return false;
  },
  async makeNarration() {
    throw new Error("Making narration audio needs the desktop app.");
  },
  // In a plain browser there is no network access to the services and no plugin runner. The development server answers with stand-ins, so the
  // dialogs can be tried: a plain picture or silence, saved in the project like the real thing, and the example plugin.
  async aiPlugins() {
    let enabled: string[] = [];
    try {
      enabled = Object.keys(((JSON.parse(localStorage.getItem("openstage-settings") ?? "{}") as { ai?: { plugins?: Record<string, boolean> } }).ai?.plugins) ?? {});
    } catch {
      // no settings yet
    }
    const res = await fetch("/api/ai-plugins", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) });
    return res.ok ? parsePlugins(await res.text()) : { plugins: [], problems: [] };
  },
  async aiPluginsFolder() {
    return "(the plugins folder, in the app)";
  },
  async aiService(op, service) {
    return parseServiceAnswer(JSON.stringify(await post("/api/ai-service", { op, service })));
  },
  async aiMake(dir, kind, request) {
    return parseMade(JSON.stringify(await post("/api/ai-make", { dir, kind, request })));
  },
  async voiceSample(voice, lang) {
    return parseSample(JSON.stringify(await post("/api/voice-sample", { voice, lang })));
  },
  async assetUrl(dir, path) {
    const res = await fetch(`/api/asset?dir=${encodeURIComponent(dir)}&path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error(await res.text());
    const type = path.toLowerCase().endsWith(".svg") ? "image/svg+xml" : undefined;
    return URL.createObjectURL(new Blob([await res.arrayBuffer()], type ? { type } : {}));
  },
  async mediaUrl() {
    throw new Error("Playing a large video needs the desktop app.");
  },
  async listRecordings() {
    return [];
  },
  async recordingRead() {
    throw new Error("Editing a recording needs the desktop app.");
  },
  async recordingFolders() {
    throw new Error("Editing a recording needs the desktop app.");
  },
  async recordingWriteEdit() {
    throw new Error("Editing a recording needs the desktop app.");
  },
  async recordingKeepEdit() {
    throw new Error("Editing a recording needs the desktop app.");
  },
  async recordingWriteSteps() {
    throw new Error("Making steps from a recording needs the desktop app.");
  },
  async saveStepPicture() {
    throw new Error("Making steps from a recording needs the desktop app.");
  },
  async recordingMediaUrl() {
    throw new Error("Playing a recording needs the desktop app.");
  },
  async pickCaptionSource() {
    return new URLSearchParams(location.search).get("captionsource") ?? window.prompt("Path of a captions file (.vtt or .srt)");
  },
  async captionSourceRead() {
    throw new Error("Reading a captions file needs the desktop app.");
  },
  async captionsRead() {
    throw new Error("Editing captions needs the desktop app.");
  },
  async captionsWrite() {
    throw new Error("Saving captions needs the desktop app.");
  },
  async speechStatus() {
    return { ready: false, problem: "Listening to the voice needs the desktop app.", folder: "", models: [] };
  },
  async speechDownload() {
    throw new Error("Listening to the voice needs the desktop app.");
  },
  async onSpeechDownload() {
    return () => {};
  },
  async mediaBytes() {
    throw new Error("Listening to the voice needs the desktop app.");
  },
  async speechAudioPut() {
    throw new Error("Listening to the voice needs the desktop app.");
  },
  async speechListen() {
    throw new Error("Listening to the voice needs the desktop app.");
  },
  async speechDrop() {},
  async onSpeechProgress() {
    return () => {};
  },
  async speechCancel() {
    return false;
  },
  async captureCheck() {
    return { ok: false, message: "The recorder needs the desktop app." };
  },
  async streamStart() {
    throw new Error("The recorder needs the desktop app.");
  },
  async streamSend() {
    throw new Error("The recorder needs the desktop app.");
  },
  async streamSetPaused() {},
  async streamState() {
    return { running: false, paused: false };
  },
  async streamStop() {
    return false;
  },
  async onStreamLine() {
    return () => {};
  },
  async onStreamExit() {
    return () => {};
  },
  async hotkeysSet(bindings) {
    return bindings.map((b) => ({ id: b.id, ok: false, message: "Keys that work in other programs need the desktop app." }));
  },
  async hotkeysClear() {},
  async onHotkey() {
    return () => {};
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
