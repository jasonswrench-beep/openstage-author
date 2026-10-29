// A recording of the course, reached through the editor's own shell, as the editing screens want it.
//
// The editing screens (capture-timeline) read a recording through a small interface, `ProjectFolder`: read a text file, list the folders in a
// place, give an address for a video, and write `edit.json` (and keep the copy of an older edit). In a browser that is a folder the author picked; here it is a folder of the open
// course, `<course>/captures/<name>.capture`, reached only by the course's folder and the recording's name, so nothing else on the computer is in
// reach. The shell does the checking (src-tauri/src/lib.rs); this only asks the right questions and turns a refusal into "there is none".

import type { Backend } from "./backend.ts";
import type { ProjectFolder } from "../../capture-timeline/src/project.ts";

export type RecordingBackend = Pick<Backend, "recordingRead" | "recordingFolders" | "recordingWriteEdit" | "recordingKeepEdit" | "recordingMediaUrl">;

/** The media of a take: `takes/take-001/screen.mp4`. Nothing else can be played. */
export const TAKE_MEDIA = /^takes\/take-\d+\/[^/\\]+$/;

/** The copy of an older edit that is kept when a new edit of the newest take replaces it: `edit-before-take-2.json`. The only other file that can be written. */
export const KEPT_EDIT = /^edit-before-take-\d{1,4}\.json$/;

export function recordingFolder(b: RecordingBackend, dir: string, name: string): ProjectFolder {
  return {
    name,
    canWrite: true,
    async readText(path) {
      try {
        return await b.recordingRead(dir, name, path);
      } catch {
        return undefined;
      }
    },
    async listFolders(path) {
      try {
        return await b.recordingFolders(dir, name, path);
      } catch {
        return [];
      }
    },
    async mediaUrl(path) {
      if (!TAKE_MEDIA.test(path)) return undefined;
      try {
        return await b.recordingMediaUrl(dir, name, path);
      } catch {
        return undefined;
      }
    },
    async writeText(path, text) {
      const kept = KEPT_EDIT.test(path);
      if (path !== "edit.json" && !kept) return false;
      try {
        if (kept) await b.recordingKeepEdit(dir, name, path, text);
        else await b.recordingWriteEdit(dir, name, text);
        return true;
      } catch {
        return false;
      }
    },
    release() {
      // The addresses are the shell's own, with nothing to give back.
    },
  };
}

/** The folder name of a recording from the path the recorder reported ("D:/course/captures/Demo.capture"). */
export function recordingNameOf(folder: string): string {
  const parts = folder.split(/[\\/]+/).filter((p) => p !== "");
  return parts[parts.length - 1] ?? "";
}
