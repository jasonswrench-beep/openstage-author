// The narration engine (Kokoro) that the editor can install on the author's own computer: what the Narration dialog says about it, the question it asks first, and the
// words for its progress. The installing itself is in the shell (engine.rs, lib.rs); nothing here needs a window, so it is tested alone (engine.test.ts).
//
// Why it is a button and not part of the installer: some of what Kokoro's English voices need (phonemizer and espeak-ng) is under the GNU General Public License. OpenStage
// Author is Apache-2.0 and carries none of it. The button fetches it from its own publishers onto the author's computer, after saying so, and runs it as a separate program.

import { formatBytes } from "./narration.ts";

/** What the shell says about the engine. */
export interface EngineStatus {
  /** "setting": the author named their own Python (OPENSTAGE_KOKORO_PYTHON). "installed": the editor's own. "none". */
  state: "setting" | "installed" | "none";
  /** Whether this copy of the editor can install one. */
  canInstall: boolean;
  /** Why not, in words, when it cannot. */
  problem: string;
  /** Microsoft's Visual C++ runtime, which the voice needs, is not on this computer: the dialog offers Microsoft's download. */
  runtimeMissing: boolean;
  /** An engine an earlier version of the editor installed is there, made for another Python: it is not used, and installing again replaces it. */
  outdated?: boolean;
  folder: string;
  /** What the installed engine takes, in bytes. */
  size: number;
}

export const NO_ENGINE_STATUS: EngineStatus = { state: "none", canInstall: false, problem: "", runtimeMissing: false, folder: "", size: 0 };

/** Microsoft's own permanent address for the 64-bit Visual C++ runtime installer (the same as RUNTIME_URL in engine.rs). */
export const RUNTIME_URL = "https://aka.ms/vs/17/release/vc_redist.x64.exe";

/** The shell's JSON as a status; anything that makes no sense is "no engine, cannot install". */
export function parseEngineStatus(raw: string): EngineStatus {
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    const state = d["state"] === "setting" || d["state"] === "installed" || d["state"] === "none" ? d["state"] : "none";
    return {
      state,
      canInstall: d["canInstall"] === true,
      problem: typeof d["problem"] === "string" ? d["problem"] : "",
      runtimeMissing: d["runtimeMissing"] === true,
      outdated: d["outdated"] === true,
      folder: typeof d["folder"] === "string" ? d["folder"] : "",
      size: typeof d["size"] === "number" && d["size"] >= 0 ? d["size"] : 0,
    };
  } catch {
    return { ...NO_ENGINE_STATUS, problem: "The state of the narration voice could not be read." };
  }
}

/**
 * How much is downloaded, and how much room it takes once it is unpacked, as said to the author before they agree. Measured on 2026-11-13: the 97 Python packages are 243 MB of files on PyPI and
 * the model files 340 MB on Hugging Face (so about 590 MB); the finished engine folder is 1.4 GB once it has spoken once (Python keeps compiled copies of its modules there); while pip works it also
 * unpacks the packages in a folder of its own beside them, up to about 1.5 GB more for a while (measured on 2026-10-19 with the larger packages of then, so it is not less now).
 */
export const DOWNLOAD_MEGABYTES = 590;
export const DISK_MEGABYTES = 1500;
export const TEMPORARY_MEGABYTES = 1500;

export interface EngineLine {
  /** The sentence for the Narration dialog. */
  text: string;
  /** Which buttons make sense. */
  canInstall: boolean;
  canRemove: boolean;
}

export function engineLine(s: EngineStatus): EngineLine {
  if (s.state === "setting") {
    return { text: "The narration voice (Kokoro) is the one you set up yourself, named by OPENSTAGE_KOKORO_PYTHON. The editor leaves it alone.", canInstall: false, canRemove: false };
  }
  if (s.state === "installed") {
    return { text: `The narration voice (Kokoro) is installed on this computer${s.size > 0 ? `, and takes ${formatBytes(s.size)}` : ""}.`, canInstall: false, canRemove: true };
  }
  if (s.outdated && s.canInstall) {
    return {
      text: `The narration voice (Kokoro) on this computer was installed by an earlier version of OpenStage Author and has to be installed again: it now runs in its own copy of Python, and every file it downloads is checked first. Installing it again replaces it (about ${DOWNLOAD_MEGABYTES} MB to download, a few minutes). Audio already made for your courses is kept.`,
      canInstall: true,
      canRemove: true,
    };
  }
  if (s.canInstall) {
    // An install that failed after its packages were in (the model, or the check that it speaks) leaves them: installing again replaces them, and they can be removed to free the room.
    const half = s.size > 0 ? ` A half-finished install is using ${formatBytes(s.size)}: installing again replaces it, or you can remove it.` : "";
    return {
      text: `The narration voice (Kokoro) is not installed on this computer, so audio cannot be made with it. You can install it here: about ${DOWNLOAD_MEGABYTES} MB to download, a few minutes. Voices from a service or a plugin do not need it.${half}`,
      canInstall: true,
      canRemove: s.size > 0,
    };
  }
  return { text: `The narration voice (Kokoro) is not installed on this computer. ${s.problem}`.trim(), canInstall: false, canRemove: false };
}

/** The question asked before anything is fetched. It says what, from where, how much, and about the GPL parts. */
export function installQuestion(): string {
  return (
    `Install the narration voice (Kokoro) on this computer?\n\n` +
    `It downloads about ${DOWNLOAD_MEGABYTES} MB: Python packages from pypi.org and the voice model from huggingface.co. Once unpacked it takes about ${(DISK_MEGABYTES / 1000).toFixed(1)} GB, and while it installs it needs about ${(TEMPORARY_MEGABYTES / 1000).toFixed(1)} GB more free on the same drive. ` +
    `It is kept in OpenStage's own folder on this computer, not in any Python of yours, and you can stop it while it runs and remove it here afterwards.\n\n` +
    `Some of what the English voices need (phonemizer and espeak-ng) is under the GNU General Public License. OpenStage Author does not include or hand out any of it: this fetches it from its own publishers onto your computer, and runs it as a separate program.\n\n` +
    `Nothing from your courses is sent. Go on?`
  );
}

/** What an author is told when words that are to be spoken have no sound yet and the way to get sound is to install the voice here. */
export function silentCourseText(count: number): string {
  return `${count === 1 ? "1 narration has" : `${count} narrations have`} words but no sound yet, and this computer has no narration voice, so the course is silent until you install one. It is about ${DOWNLOAD_MEGABYTES} MB to download and takes a few minutes, once. You are asked first, and it can be removed again.`;
}

/** The same, said before the words exist (under the Speaker notes box), so the author is not surprised afterwards. */
export function silentBeforeText(): string {
  return `This computer has no narration voice yet. The notes will come in as words, and the course will be silent until the voice is installed (about ${DOWNLOAD_MEGABYTES} MB, once). The next window offers to do that.`;
}

export function removeQuestion(size: number): string {
  return `Remove the narration voice from this computer${size > 0 ? ` and free ${formatBytes(size)}` : ""}? Audio already made for your courses is kept. To make new audio with it you would install it again.`;
}

/** One line for the live region when a step starts: which step, of how many, and what it is doing. */
export function stepText(step: number, steps: number, label: string): string {
  return `Step ${step} of ${steps}: ${label}.`;
}

/** What a progress line from pip or the model download is worth showing: short, and without the carriage-return noise. */
export function progressDetail(line: string): string {
  const clean = line.replace(/\s+/g, " ").trim();
  return clean.length > 140 ? `${clean.slice(0, 137)}...` : clean;
}
