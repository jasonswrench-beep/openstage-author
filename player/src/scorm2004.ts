// SCORM 2004 (4th edition) tracking. The same job as scorm.ts, for an LMS that offers window.API_1484_11: report score,
// completion and success, and put a learner who left part-way back where they were.
//
// What 2004 changes for the course:
//   - Completion and success are two fields (completion_status, success_status), so a learner who finishes everything but
//     fails is reported "completed" and "failed". SCORM 1.2 had to fold them into one word.
//   - The score is also given as a fraction (score.scaled, -1 to 1), and progress_measure says how much has been seen.
//   - suspend_data may hold 64000 characters, so nothing the course remembers is dropped to make it fit.
//   - Answers use the standard's own syntax (interaction-format.ts).
// The decisions about what counts as complete or passed are not made here. They are evaluate() in scorm.ts, shared with 1.2.

import type { Runtime, Snapshot } from "./runtime.ts";
import type { Graded } from "./grading.ts";
import type { QuizContent } from "./types.ts";
import { decodeSuspend, encodeSuspend, evaluate, findNamedApi, type Progress } from "./scorm.ts";
import { formatGraded, formatInput, scorm2004Type } from "./interaction-format.ts";

/** SCORM 2004 asks every LMS to hold at least 64000 characters of suspend_data and 1000 of location. */
export const SUSPEND_LIMIT_2004 = 64000;
export const LOCATION_LIMIT_2004 = 1000;

export interface Scorm2004Api {
  Initialize(s: string): string;
  Terminate(s: string): string;
  GetValue(element: string): string;
  SetValue(element: string, value: string): string;
  Commit(s: string): string;
  GetLastError(): string;
  GetErrorString(code: string): string;
  GetDiagnostic(code: string): string;
}

/** SCORM 2004 session time: an ISO 8601 duration with at most two decimals on the seconds, such as PT1H2M3.45S. */
export function sessionTime2004(ms: number): string {
  const hundredths = Math.max(0, Math.round(ms / 10));
  const hours = Math.floor(hundredths / 360000);
  const minutes = Math.floor(hundredths / 6000) % 60;
  const seconds = (hundredths % 6000) / 100;
  const text = Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(2).replace(/0$/, "");
  return `PT${hours}H${minutes}M${text}S`;
}

/** SCORM 2004 time stamp: an ISO 8601 date and time with at most two decimals, in UTC, such as 2026-10-31T12:34:56.78Z. */
export function timestamp2004(ms: number): string {
  return new Date(ms).toISOString().slice(0, 22) + "Z";
}

/** A fraction from 0 to 1 as the shortest text that holds it to four decimals. */
const fraction = (value: number): string => String(Math.round(Math.max(0, Math.min(1, value)) * 10000) / 10000);

/** How much of the course has been seen: 1 only once the course is complete, never more than 0.99 before. */
export function progressMeasure(runtime: Runtime, progress: Progress): number {
  if (progress.completed) return 1;
  const total = runtime.pkg.slides.length;
  return total === 0 ? 0 : Math.min(0.99, runtime.visited.size / total);
}

export class Scorm2004Tracker {
  private readonly api: Scorm2004Api;
  private readonly runtime: Runtime;
  private readonly clock: () => number;
  private started = 0;
  private open = false;
  private finished = false;
  private readOnly = false;
  private pending = false;
  private interactions = 0;
  private inputSlots = new Map<string, number>();

  constructor(api: Scorm2004Api, runtime: Runtime, clock: () => number = () => Date.now()) {
    this.api = api;
    this.runtime = runtime;
    this.clock = clock;
  }

  /** Connect to the LMS. Returns where to resume, or null to start from the beginning. */
  begin(): Snapshot | null {
    if (this.api.Initialize("") !== "true") {
      this.warn("Initialize");
      return null;
    }
    this.open = true;
    this.started = this.clock();
    const mode = this.get("cmi.mode");
    this.readOnly = mode === "browse" || mode === "review";

    // A new attempt starts as "unknown" or "not attempted". A completed course stays completed.
    const status = this.get("cmi.completion_status");
    if (status !== "completed" && status !== "incomplete") this.set("cmi.completion_status", "incomplete");
    this.interactions = Number(this.get("cmi.interactions._count")) || 0;

    this.runtime.onEvent((e) => {
      if (e.type === "quiz") this.recordInteraction(e.objectId, e.graded);
      if (e.type === "input") this.recordInput(e.objectId, e.rowId, e.interaction, e.response);
      this.schedule();
    });

    let snap: Snapshot | null = null;
    if (this.get("cmi.entry") === "resume") {
      snap = decodeSuspend(this.get("cmi.suspend_data"));
      const where = this.get("cmi.location");
      if (!snap && where) snap = { slide: where, vars: {}, quiz: {}, layers: [], visited: "" };
    }
    this.commit();
    return snap;
  }

  /** Write everything that depends on the course's current state. */
  flush(): void {
    if (!this.open || this.finished) return;
    this.pending = false;
    const snap = this.runtime.snapshot();
    this.set("cmi.location", snap.slide.slice(0, LOCATION_LIMIT_2004));
    this.set("cmi.suspend_data", encodeSuspend(snap, SUSPEND_LIMIT_2004));

    const progress = evaluate(this.runtime);
    this.set("cmi.progress_measure", fraction(progressMeasure(this.runtime, progress)));
    if (progress.completed) {
      // The score and the result are written once, when the course is complete. Writing them sooner would let an LMS judge
      // pass or fail before the learner has finished.
      if (progress.scorePercent !== null) {
        this.set("cmi.score.min", "0");
        this.set("cmi.score.max", "100");
        this.set("cmi.score.raw", String(progress.scorePercent));
        this.set("cmi.score.scaled", fraction(progress.scorePercent / 100));
      }
      if (progress.success !== null) this.set("cmi.success_status", progress.success ? "passed" : "failed");
      this.set("cmi.completion_status", "completed");
    } else if (this.get("cmi.completion_status") !== "completed") {
      // A finished status is never moved back.
      this.set("cmi.completion_status", "incomplete");
    }
    this.commit();
  }

  /** Final report when the learner leaves. Safe to call more than once. */
  end(): void {
    if (!this.open || this.finished) return;
    this.flush();
    // "suspend" tells the LMS to keep suspend_data and offer a resume. Once the course is complete there is nothing to resume.
    this.set("cmi.exit", evaluate(this.runtime).completed ? "normal" : "suspend");
    this.set("cmi.session_time", sessionTime2004(this.clock() - this.started));
    this.commit();
    this.finished = true;
    if (this.api.Terminate("") !== "true") this.warn("Terminate");
  }

  /** Several runtime events in one click become one write to the LMS. */
  private schedule(): void {
    if (this.pending) return;
    this.pending = true;
    setTimeout(() => this.flush(), 0);
  }

  /** One interaction for each submission. A partly right answer is "incorrect" here: the LMS's score is the total, sent separately. */
  private recordInteraction(objectId: string, graded: Graded): void {
    const obj = this.runtime.findQuiz(objectId);
    if (!obj || this.readOnly) return;
    const q = obj.content as unknown as QuizContent;
    const f = formatGraded(q, graded);
    const base = `cmi.interactions.${this.interactions++}`;
    // The id comes first, then the type: the syntax of the answers depends on the type, and the LMS refuses them in any other order.
    this.set(`${base}.id`, objectId);
    this.set(`${base}.type`, scorm2004Type(f.kind));
    this.set(`${base}.timestamp`, timestamp2004(this.clock()));
    if (f.response !== "") this.set(`${base}.learner_response`, f.response);
    this.set(`${base}.result`, graded.correct ? "correct" : "incorrect");
    this.set(`${base}.weighting`, String(q.scoring.points));
    f.patterns.forEach((pattern, i) => this.set(`${base}.correct_responses.${i}.pattern`, pattern));
  }

  /** One interaction per part of an input, rewritten if the learner changes their answer, so the LMS holds the final one. */
  private recordInput(objectId: string, rowId: string, type: "choice" | "likert" | "true-false", response: string): void {
    if (this.readOnly || response === "") return;
    const key = rowId === objectId ? objectId : `${objectId}.${rowId}`;
    const f = formatInput(type, response);
    let n = this.inputSlots.get(key);
    if (n === undefined) {
      n = this.interactions++;
      this.inputSlots.set(key, n);
      this.set(`cmi.interactions.${n}.id`, key);
      this.set(`cmi.interactions.${n}.type`, scorm2004Type(f.kind));
      this.set(`cmi.interactions.${n}.timestamp`, timestamp2004(this.clock()));
    }
    this.set(`cmi.interactions.${n}.learner_response`, f.response);
  }

  // ---- thin wrappers that report problems instead of hiding them

  private get(element: string): string {
    return this.api.GetValue(element);
  }

  private set(element: string, value: string): void {
    if (this.readOnly) return;
    if (this.api.SetValue(element, value) !== "true") this.warn(`SetValue(${element})`);
  }

  private commit(): void {
    if (this.readOnly) return;
    if (this.api.Commit("") !== "true") this.warn("Commit");
  }

  private warn(what: string): void {
    const code = this.api.GetLastError();
    console.warn(`SCORM 2004: ${what} failed: ${code} ${this.api.GetErrorString(code)} ${this.api.GetDiagnostic(code)}`.trim());
  }
}

/** Connect the course to a SCORM 2004 LMS if there is one. Does nothing, quietly, if there is not. */
export function attachScorm2004(win: Window, runtime: Runtime): { tracker: Scorm2004Tracker; resume: Snapshot | null } | null {
  const api = findNamedApi<Scorm2004Api>(win, "API_1484_11");
  if (!api) return null;
  const tracker = new Scorm2004Tracker(api, runtime);
  const resume = tracker.begin();
  // pagehide is the reliable moment on modern browsers, and beforeunload covers older LMS frames.
  win.addEventListener("pagehide", () => tracker.end());
  win.addEventListener("beforeunload", () => tracker.end());
  return { tracker, resume };
}
