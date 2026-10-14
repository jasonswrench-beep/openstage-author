// SCORM 1.2 tracking. Reports score, status and position to the LMS, and restores a learner
// who left part-way. Everything here is plain functions plus one class that talks to the
// LMS API, so it can be tested against a fake LMS (fake-lms.ts) without a browser.
//
// SCORM 1.2 has a single lesson_status that mixes "finished" with "passed or failed". The
// course keeps completion and success as separate facts (see evaluate) and only combines
// them at the last moment, when writing lesson_status.

import type { Runtime, Snapshot } from "./runtime.ts";
import type { CourseResults, QuestionResult } from "./results.ts";
import type { Graded } from "./grading.ts";
import type { CoursePackage, QuizContent } from "./types.ts";

/** Percentage of available points needed to pass. Fixed for now: a project setting needs a
 *  schema change, which needs a schemaVersion bump and a migration. */
export const PASSING_PERCENT = 80;

/** SCORM 1.2 allows 4096 characters of suspend_data and 255 of lesson_location. */
export const SUSPEND_LIMIT = 4096;
export const LOCATION_LIMIT = 255;

export interface ScormApi {
  LMSInitialize(s: string): string;
  LMSFinish(s: string): string;
  LMSGetValue(element: string): string;
  LMSSetValue(element: string, value: string): string;
  LMSCommit(s: string): string;
  LMSGetLastError(): string;
  LMSGetErrorString(code: string): string;
  LMSGetDiagnostic(code: string): string;
}

/** Walk up through parent frames, then the opener, looking for window.API. */
export function findApi(start: Window): ScormApi | null {
  const search = (from: Window): ScormApi | null => {
    let win: Window | null = from;
    for (let depth = 0; win && depth < 500; depth++) {
      try {
        const api = (win as unknown as { API?: ScormApi }).API;
        if (api) return api;
        if (win.parent === win) return null;
        win = win.parent;
      } catch {
        return null; // a parent on another origin: not reachable, and not an error
      }
    }
    return null;
  };
  const found = search(start);
  if (found) return found;
  try {
    return start.opener ? search(start.opener as Window) : null;
  } catch {
    return null;
  }
}

// ---- policy: completion, success, score

export interface Progress {
  /** Every slide seen and every quiz finished. */
  completed: boolean;
  /** null until the assessment is finished (or if the course has none). */
  success: boolean | null;
  /** 0 to 100, or null until the assessment is finished. */
  scorePercent: number | null;
}

/**
 * Whether the learner has seen enough of the slides, as the course's own setting says: every one of them, or just the
 * last one (which is the right choice when a rule can send some learners past some slides).
 */
export function slidesSeenEnough(runtime: Runtime): boolean {
  const slides = runtime.pkg.slides;
  // Written defensively: a course published before the setting existed has none, and counted every slide.
  if (runtime.pkg.project.completion?.slides === "last") {
    const last = slides[slides.length - 1];
    return last !== undefined && runtime.visited.has(last.id);
  }
  return slides.every((s) => runtime.visited.has(s.id));
}

/** Where the learner stands in the quiz, for a results box and a certificate. */
export function courseResults(runtime: Runtime): CourseResults {
  const questions: QuestionResult[] = [];
  for (const slide of runtime.pkg.slides) {
    for (const obj of [slide.baseLayer, ...slide.layers].flatMap((l) => l.objects)) {
      if (obj.type !== "quizQuestion") continue;
      const q = obj.content as unknown as QuizContent;
      const st = runtime.quiz.get(obj.id);
      const state = !st || st.attempts === 0 ? "unanswered" : st.locked ? (st.result === "correct" ? "correct" : st.score > 0 ? "partial" : "incorrect") : "open";
      questions.push({ slideName: slide.name, objectId: obj.id, points: q.scoring.points, earned: st?.score ?? 0, state });
    }
  }
  const a = runtime.assessment();
  const p = evaluate(runtime);
  return { questions, totalPoints: a.totalPoints, earnedPoints: a.earnedPoints, percent: p.scorePercent, finished: a.quizzes > 0 && a.locked === a.quizzes, passed: p.success, passMark: PASSING_PERCENT };
}

export function evaluate(runtime: Runtime): Progress {
  const a = runtime.assessment();
  const everySlideSeen = slidesSeenEnough(runtime);
  const assessmentDone = a.quizzes > 0 && a.locked === a.quizzes;
  const completed = everySlideSeen && (a.quizzes === 0 || assessmentDone);
  if (!assessmentDone) return { completed, success: null, scorePercent: null };
  const pct = a.totalPoints > 0 ? Math.round((10000 * a.earnedPoints) / a.totalPoints) / 100 : 100;
  return { completed, success: pct >= PASSING_PERCENT, scorePercent: pct };
}

const FINAL = new Set(["passed", "completed", "failed"]);

/** Fold the two facts into SCORM 1.2's one field. Never moves a finished status backwards. */
export function lessonStatus(p: Progress, current: string): string {
  if (!p.completed) return FINAL.has(current) ? current : "incomplete";
  if (p.success === true) return "passed";
  if (p.success === false) return "failed";
  return "completed";
}

// ---- suspend data

export function encodeSuspend(snap: Snapshot): string {
  const full = { v: 1, s: snap.slide, x: snap.vars, q: snap.quiz, l: snap.layers, d: snap.visited, c: snap.scenario };
  // Over the limit: drop the least important parts first. Quiz results are never dropped,
  // because the score depends on them. Where a learner is in a scenario goes with the variables: the
  // meters are variables, so one without the other would put the learner back at the start with
  // their old numbers.
  const attempts: object[] = [
    full,
    { ...full, d: undefined },
    { ...full, d: undefined, l: undefined },
    { ...full, d: undefined, l: undefined, x: undefined, c: undefined },
  ];
  for (const a of attempts) {
    const text = JSON.stringify(a);
    if (text.length <= SUSPEND_LIMIT) return text;
  }
  return JSON.stringify({ v: 1, s: snap.slide });
}

export function decodeSuspend(text: string): Snapshot | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (raw["v"] !== 1 || typeof raw["s"] !== "string") return null;
    return {
      slide: raw["s"],
      vars: (raw["x"] as Snapshot["vars"]) ?? {},
      quiz: (raw["q"] as Snapshot["quiz"]) ?? {},
      layers: (raw["l"] as string[]) ?? [],
      visited: typeof raw["d"] === "string" ? raw["d"] : "",
      ...(raw["c"] && typeof raw["c"] === "object" ? { scenario: raw["c"] as Record<string, string> } : {}),
    };
  } catch {
    return null;
  }
}

/** SCORM 1.2 session time, HHHH:MM:SS.SS */
export function sessionTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 10) / 100);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total - h * 3600 - m * 60;
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${pad(h, 4)}:${pad(m, 2)}:${s.toFixed(2).padStart(5, "0")}`;
}

// ---- the tracker

export class Tracker {
  private readonly api: ScormApi;
  private readonly runtime: Runtime;
  private readonly pkg: CoursePackage;
  private readonly clock: () => number;
  private started = 0;
  private open = false;
  private finished = false;
  private readOnly = false;
  private pending = false;
  private interactions = 0;
  private inputSlots = new Map<string, number>();

  constructor(api: ScormApi, runtime: Runtime, clock: () => number = () => Date.now()) {
    this.api = api;
    this.runtime = runtime;
    this.pkg = runtime.pkg;
    this.clock = clock;
  }

  /** Connect to the LMS. Returns where to resume, or null to start from the beginning. */
  begin(): Snapshot | null {
    if (this.api.LMSInitialize("") !== "true") {
      this.warn("LMSInitialize");
      return null;
    }
    this.open = true;
    this.started = this.clock();
    const mode = this.get("cmi.core.lesson_mode");
    this.readOnly = mode === "browse" || mode === "review";

    const status = this.get("cmi.core.lesson_status");
    if (!FINAL.has(status) && status !== "incomplete") this.set("cmi.core.lesson_status", "incomplete");
    this.interactions = Number(this.get("cmi.interactions._count")) || 0;

    this.runtime.onEvent((e) => {
      if (e.type === "quiz") this.recordInteraction(e.objectId, e.graded);
      if (e.type === "input") this.recordInput(e.objectId, e.rowId, e.interaction, e.response);
      this.schedule();
    });

    let snap: Snapshot | null = null;
    if (this.get("cmi.core.entry") === "resume") {
      snap = decodeSuspend(this.get("cmi.suspend_data"));
      const where = this.get("cmi.core.lesson_location");
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
    this.set("cmi.core.lesson_location", snap.slide.slice(0, LOCATION_LIMIT));
    this.set("cmi.suspend_data", encodeSuspend(snap));

    const progress = evaluate(this.runtime);
    if (progress.completed && progress.scorePercent !== null) {
      this.set("cmi.core.score.min", "0");
      this.set("cmi.core.score.max", "100");
      this.set("cmi.core.score.raw", String(progress.scorePercent));
    }
    const status = lessonStatus(progress, this.get("cmi.core.lesson_status"));
    this.set("cmi.core.lesson_status", status);
    this.commit();
  }

  /** Final report when the learner leaves. Safe to call more than once. */
  end(): void {
    if (!this.open || this.finished) return;
    this.flush();
    const status = this.get("cmi.core.lesson_status");
    // "suspend" tells the LMS to keep suspend_data and offer a resume. Once the course is
    // finished there is nothing to resume.
    this.set("cmi.core.exit", FINAL.has(status) ? "" : "suspend");
    this.set("cmi.core.session_time", sessionTime(this.clock() - this.started));
    this.commit();
    this.finished = true;
    if (this.api.LMSFinish("") !== "true") this.warn("LMSFinish");
  }

  /** Several runtime events in one click become one write to the LMS. */
  private schedule(): void {
    if (this.pending) return;
    this.pending = true;
    setTimeout(() => this.flush(), 0);
  }

  /** One interaction for each submission, of the SCORM type that fits the question. A partly right answer is "wrong" here: the LMS's score is the total, sent separately. */
  private recordInteraction(objectId: string, graded: Graded): void {
    const obj = this.runtime.findQuiz(objectId);
    if (!obj || this.readOnly) return;
    const q = obj.content as unknown as QuizContent;
    const n = this.interactions++;
    const base = `cmi.interactions.${n}`;
    this.set(`${base}.id`, objectId);
    this.set(`${base}.type`, graded.scormType);
    this.set(`${base}.student_response`, graded.response);
    this.set(`${base}.result`, graded.correct ? "correct" : "wrong");
    this.set(`${base}.weighting`, String(q.scoring.points));
    graded.patterns.forEach((pattern, i) => this.set(`${base}.correct_responses.${i}.pattern`, pattern));
  }

  /** One interaction per part of an input, rewritten if the learner changes their answer, so the LMS holds the final one. */
  private recordInput(objectId: string, rowId: string, type: string, response: string): void {
    if (this.readOnly || response === "") return;
    const key = rowId === objectId ? objectId : `${objectId}.${rowId}`;
    let n = this.inputSlots.get(key);
    if (n === undefined) {
      n = this.interactions++;
      this.inputSlots.set(key, n);
      this.set(`cmi.interactions.${n}.id`, key);
      this.set(`cmi.interactions.${n}.type`, type);
    }
    this.set(`cmi.interactions.${n}.student_response`, response);
  }

  // ---- thin wrappers that report problems instead of hiding them

  private get(element: string): string {
    return this.api.LMSGetValue(element);
  }

  private set(element: string, value: string): void {
    if (this.readOnly) return;
    if (this.api.LMSSetValue(element, value) !== "true") this.warn(`LMSSetValue(${element})`);
  }

  private commit(): void {
    if (this.readOnly) return;
    if (this.api.LMSCommit("") !== "true") this.warn("LMSCommit");
  }

  private warn(what: string): void {
    const code = this.api.LMSGetLastError();
    console.warn(`SCORM: ${what} failed: ${code} ${this.api.LMSGetErrorString(code)} ${this.api.LMSGetDiagnostic(code)}`.trim());
  }
}

/** Connect the course to an LMS if there is one. Does nothing, quietly, if there is not. */
export function attachTracker(win: Window, runtime: Runtime): { tracker: Tracker; resume: Snapshot | null } | null {
  const api = findApi(win);
  if (!api) return null;
  const tracker = new Tracker(api, runtime);
  const resume = tracker.begin();
  // pagehide is the reliable moment on modern browsers, and beforeunload covers older LMS frames.
  win.addEventListener("pagehide", () => tracker.end());
  win.addEventListener("beforeunload", () => tracker.end());
  return { tracker, resume };
}
