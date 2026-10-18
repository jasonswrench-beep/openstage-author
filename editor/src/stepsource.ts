// Reading what steps can be made from: a recording's takes, the logs of what the author did in them, the edit's kept stretches, and steps already saved.
//
// This reaches a recording only through the `ProjectFolder` the editing screens use (recordingfolder.ts), so it can be tested with a folder held in
// memory. What it finds is turned into steps by steps.ts; this file only reads, and says in words what it found and what it could not use.

import { readProject, takeFolder, type ProjectFolder } from "../../capture-timeline/src/project.ts";
import { keepRangesOf, listFrom, parseLog, parseSteps, proposeFromLog, type StepList } from "./steps.ts";

export interface StepSource {
  /** The steps proposed from the logs, numbered, in the order of the takes. */
  proposed: StepList;
  /** Steps the author already saved in this recording, or null. */
  saved: StepList | null;
  /** In words: what was used, what was left out and why. */
  notes: string[];
  /** Whether any take had a log with clicks or keys in it (markers alone do not count). */
  hasInteractions: boolean;
  /** The takes the steps may come from, as numbers. */
  takes: number[];
  /** For each of those takes, the file of its screen video, such as `screen.mp4`, so a step's picture can be taken from it. */
  screens: Record<number, string>;
}

interface TakeFacts {
  take: number;
  state: string;
  region: { x: number; y: number; width: number; height: number } | null;
  screen: string | null;
  hasLog: boolean;
  keys: boolean | null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readFacts(text: string, folderName: string): TakeFacts | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(data) || typeof data["id"] !== "number") return null;
  const facts: TakeFacts = { take: data["id"], state: typeof data["state"] === "string" ? data["state"] : "unknown", region: null, screen: null, hasLog: false, keys: null };
  if (!/^take-\d+$/.test(folderName)) return null;
  if (Array.isArray(data["media"])) {
    for (const m of data["media"]) {
      if (!isObject(m)) continue;
      if (m["kind"] === "screen" && typeof m["file"] === "string" && /^[^/\\]+$/.test(m["file"])) facts.screen = m["file"];
      if (m["kind"] === "screen" && isObject(m["region"])) {
        const r = m["region"];
        if (typeof r["x"] === "number" && typeof r["y"] === "number" && typeof r["width"] === "number" && typeof r["height"] === "number") facts.region = { x: r["x"], y: r["y"], width: r["width"], height: r["height"] };
      }
      if (m["kind"] === "interactions") {
        facts.hasLog = true;
        if (isObject(m["interactions"]) && typeof m["interactions"]["keys"] === "boolean") facts.keys = m["interactions"]["keys"];
      }
    }
  }
  return facts;
}

/** Read everything steps can come from. A take that cannot be used is left out and said, never guessed at. */
export async function readStepSource(folder: ProjectFolder): Promise<{ ok: true; source: StepSource } | { ok: false; message: string }> {
  const opened = await readProject(folder);
  if (!opened.ok) return opened;
  const keep = keepRangesOf(opened.project.model);
  const notes: string[] = [];
  const perTake = [];
  const takes: number[] = [];
  const screens: Record<number, string> = {};
  let hasInteractions = false;
  let skipped = 0;
  let keysLeftOut = false;
  for (const name of (await folder.listFolders("takes")).filter((n) => /^take-\d+$/.test(n)).sort()) {
    const text = await folder.readText(`takes/${name}/take.json`);
    const facts = text === undefined ? null : readFacts(text, name);
    if (facts === null) continue;
    if (facts.state === "setAside") { notes.push(`Take ${facts.take} was set aside when you started again, so it is not used.`); continue; }
    takes.push(facts.take);
    if (facts.screen !== null) screens[facts.take] = facts.screen;
    const logText = await folder.readText(`takes/${takeFolder(facts.take)}/events.jsonl`);
    if (logText === undefined) continue;
    const { events, skipped: bad } = parseLog(logText);
    skipped += bad;
    if (events.some((e) => e.type === "click" || e.type === "key")) hasInteractions = true;
    if (facts.hasLog && facts.keys === false) keysLeftOut = true;
    perTake.push(proposeFromLog(events, { take: facts.take, region: facts.region, keep }));
  }
  const { list, cut } = listFrom(perTake);
  if (!hasInteractions) {
    notes.push(perTake.some((t) => t.length > 0)
      ? "Only your own markers were noted, not what you did with the mouse and keyboard. Each marker is a step. For clicks and typing, record again with OpenScreen set to note the mouse (and the keys) while you record."
      : "This recording has no note of what you did with the mouse and keyboard, because OpenScreen was set to note nothing while it recorded. You can still add steps by hand, one at a time. To have the clicks made into steps, record again with OpenScreen set to note the mouse (and the keys).");
  } else if (keysLeftOut) {
    notes.push("Your keys were not noted, so there are no typing steps. Add them by hand, or record again with the keys noted.");
  }
  if (skipped > 0) notes.push(`${skipped} ${skipped === 1 ? "line" : "lines"} of the log could not be read and ${skipped === 1 ? "was" : "were"} left out.`);
  if (cut > 0) notes.push(`${cut} more ${cut === 1 ? "step was" : "steps were"} left out, because a recording may have at most 200 steps.`);
  if (keep !== null) notes.push("Only what the edit keeps is used: anything you cut out of the recording makes no step.");

  let saved: StepList | null = null;
  const savedText = await folder.readText("steps.json");
  if (savedText !== undefined) {
    const parsed = parseSteps(savedText);
    if (parsed.ok) saved = parsed.list;
    else notes.push(`The steps saved in this recording could not be used. ${parsed.message}`);
  }
  return { ok: true, source: { proposed: list, saved, notes, hasInteractions, takes, screens } };
}
