// What Preview and Publish say to the author. The publishing tool (player/publish.ts) answers with one line of
// JSON; this turns that into plain sentences, and works out the folder a course goes into by default. No page
// or program is needed to use anything here, so it is all tested directly.

import type { Finding } from "./backend.ts";

/** How narration went. none: no speech engine is set up. failed: one is, but it did not work. skipped: a preview. */
export interface PublishNarration {
  objects: number;
  withAudio: number;
  engine: "none" | "failed" | "skipped" | "ready";
}

/** The kinds of package a publish makes. */
export type PackageKind = "scorm12" | "scorm2004" | "xapi";

const PACKAGE_NAMES: Record<PackageKind, string> = { scorm12: "SCORM 1.2", scorm2004: "SCORM 2004", xapi: "xAPI" };

/** The publishing tool's answer. */
export interface PublishResult {
  ok: boolean;
  /** The author stopped it. */
  cancelled?: boolean;
  /** Why it did not work, when it did not. */
  message?: string;
  /** What the problem check found: only warnings when it worked, the errors too when it did not. */
  findings: Finding[];
  preview?: boolean;
  slides?: number;
  outDir?: string;
  /** The course's first page, to open in a browser. */
  indexHtml?: string;
  /** The package to show the author first (SCORM 1.2 when it was made), or null for a preview. */
  zip?: string | null;
  /** Every package made, by kind. Absent from a result written before SCORM 2004 and xAPI. */
  zips?: Partial<Record<PackageKind, string>>;
  graded?: boolean;
  narration?: PublishNarration;
}

const UNREADABLE = "The publishing tool gave an answer that could not be read.";

export function parsePublishResult(text: string): PublishResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(UNREADABLE);
  }
  if (typeof data !== "object" || data === null || typeof (data as { ok?: unknown }).ok !== "boolean") throw new Error(UNREADABLE);
  const d = data as PublishResult;
  return { ...d, findings: Array.isArray(d.findings) ? d.findings : [] };
}

export function problemCounts(findings: Finding[]): { errors: number; warnings: number } {
  const errors = findings.filter((f) => f.severity === "error").length;
  return { errors, warnings: findings.length - errors };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** One sentence about narration that has no audio, or null when there is nothing to say. */
export function narrationLine(n: PublishNarration | undefined): string | null {
  if (!n || n.objects === 0 || n.withAudio >= n.objects) return null;
  const missing = n.objects - n.withAudio;
  const what = `${plural(missing, "narrated object has", "narrated objects have")} a transcript but no audio`;
  if (n.engine === "none") return `${what}, because no speech engine is set up on this computer.`;
  if (n.engine === "failed") return `${what}, because the speech engine did not work this time.`;
  if (n.engine === "skipped") return `${what} yet, because a preview does not make audio.`;
  return `${what}.`;
}

/** Why it did not work, for the author. */
export function failureText(r: PublishResult): string {
  if (r.cancelled) return "Publishing was cancelled. Anything it had started writing is incomplete, so publish again before using it.";
  return r.message?.trim() || "It did not work, and the publishing tool gave no reason.";
}

/** What a publish that worked produced, as sentences. */
export function publishSummary(r: PublishResult): string[] {
  const lines = [`Published ${plural(r.slides ?? 0, "slide", "slides")}.`];
  const made = (Object.keys(PACKAGE_NAMES) as PackageKind[]).flatMap((k) => (r.zips?.[k] ? [`${fileName(r.zips[k]!)} (${PACKAGE_NAMES[k]})`] : []));
  if (made.length > 1) lines.push(`The packages are ${made.slice(0, -1).join(", ")} and ${made.at(-1)}. Upload the one your LMS or learning record store asks for.`);
  else if (r.zip) lines.push(`The package to upload to your LMS is ${fileName(r.zip)}.`);
  if (r.outDir) lines.push(`The same course as web files is in the folder ${fileName(r.outDir)}.`);
  const narration = narrationLine(r.narration);
  if (narration) lines.push(`${narration[0]!.toUpperCase()}${narration.slice(1)}`);
  const { warnings } = problemCounts(r.findings);
  if (warnings > 0) lines.push(`${plural(warnings, "warning is", "warnings are")} listed in the Problems panel. ${warnings === 1 ? "It" : "They"} did not stop publishing.`);
  return lines;
}

/** One problem as a line of text: where it is, then what is wrong. */
export function problemLine(f: Finding): string {
  const where = f.object_id && f.object_id !== "-" ? `${f.object_id}: ` : "";
  return `${where}${f.message}${f.detail ? ` ${f.detail}` : ""}`;
}

// ---- folders

const SEPARATOR = /[\\/]/;

/** The last part of a path: C:\Courses\Intro.osproj gives Intro.osproj. */
export function fileName(path: string): string {
  const parts = path.split(SEPARATOR).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** The folder a path is in. The path of a drive's top folder is its own parent. */
export function parentFolder(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const at = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (at <= 0) return path;
  const parent = trimmed.slice(0, at);
  return /^[A-Za-z]:$/.test(parent) ? `${parent}${trimmed[at]}` : parent;
}

/** Where a project's courses go unless the author chooses: a "Published courses" folder beside the project. */
export function defaultPublishFolder(projectDir: string): string {
  const parent = parentFolder(projectDir).replace(/[\\/]+$/, "");
  return `${parent}${projectDir.includes("\\") ? "\\" : "/"}Published courses`;
}
