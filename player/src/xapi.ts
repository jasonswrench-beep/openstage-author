// xAPI (Experience API 1.0.3) tracking. The same job as scorm.ts, for a course launched with the details of a learning
// record store (LRS) in its address: report what the learner did as statements, and put a learner who left part-way back
// where they were, using the LRS's State resource.
//
// Launch: the LMS or LRS opens index.html with ?endpoint=...&auth=...&actor=...&registration=... (the "TinCan launch"). A course
// opened without them, such as a preview, runs untracked. The statements it sends are:
//   initialized, resumed   the learner opened the course (resumed only when they come back to a saved place)
//   experienced            a slide was shown
//   answered               a question was submitted, or an input the author chose to report was changed
//   completed              the slides were seen enough and every quiz is finished (see evaluate in scorm.ts)
//   passed or failed       the score reached the pass mark or did not; sent once, with the score
//   suspended, terminated  the learner left before or after finishing
// What counts as complete or passed is not decided here. It is evaluate() in scorm.ts, shared with SCORM.
//
// Nothing here knows about a page, so all of it is tested against a stand-in LRS (fake-lrs.ts) without a browser. The one
// secret in play is `auth`, the LRS credential in the address. It goes only into the Authorization header of requests to the
// endpoint it came with, and never into a message or a statement.

import type { Runtime, Snapshot } from "./runtime.ts";
import type { Graded } from "./grading.ts";
import type { Project, QuizContent } from "./types.ts";
import { decodeSuspend, encodeSuspend, evaluate } from "./scorm.ts";
import { formatGraded, formatInput, type InteractionKind } from "./interaction-format.ts";
import { sessionTime2004 as duration } from "./scorm2004.ts";

export const XAPI_VERSION = "1.0.3";

const ADL = "http://adlnet.gov/expapi/verbs/";
const VERBS = {
  initialized: "initialized", resumed: "resumed", experienced: "experienced", answered: "answered",
  completed: "completed", passed: "passed", failed: "failed", suspended: "suspended", terminated: "terminated",
} as const;
type Verb = keyof typeof VERBS;

const STATE_ID = "openstage-progress";
const ACTIVITY = "http://adlnet.gov/expapi/activities/";

/** What the learner's browser needs from `fetch`. The real one fits; the stand-in LRS answers the same way. */
export type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body?: string;
  keepalive?: boolean;
  signal?: AbortSignal;
  credentials?: "omit";
}) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface XapiLaunch {
  /** Always ends with a slash. */
  endpoint: string;
  /** The Authorization header value, or "" if the LRS wants none. A secret. */
  auth: string;
  actor: Record<string, unknown>;
  registration: string | null;
  /** The course as an activity. */
  activityId: string;
}

// ---- who, and which course

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An identifier for the course that stays the same each time it is published, so records add up. */
export function courseActivityId(meta: Project["meta"]): string {
  const slug = meta.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "course";
  return `https://openstageauthor.com/xapi/course/${slug}-${meta.created}`;
}

/** An actor as an LMS sends it: one of the four ways of saying who someone is. Older launches wrap each value in a list. */
export function normaliseActor(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
  const out: Record<string, unknown> = { objectType: "Agent" };
  const name = first(o["name"]);
  if (typeof name === "string" && name !== "") out["name"] = name;
  for (const key of ["mbox", "mbox_sha1sum", "openid"]) {
    const value = first(o[key]);
    if (typeof value === "string" && value !== "") return { ...out, [key]: value };
  }
  const account = first(o["account"]);
  if (typeof account === "object" && account !== null) {
    const a = account as Record<string, unknown>;
    if (typeof a["homePage"] === "string" && typeof a["name"] === "string") return { ...out, account: { homePage: a["homePage"], name: a["name"] } };
  }
  return null;
}

/**
 * The LRS details in the address the course was opened with, or null if there are none or they cannot be trusted. The
 * endpoint must be https, except on the learner's own computer, because the learner's answers are sent to it.
 */
export function readLaunch(search: string, project: Project): XapiLaunch | null {
  const q = new URLSearchParams(search);
  const rawEndpoint = q.get("endpoint");
  const rawActor = q.get("actor");
  if (!rawEndpoint || !rawActor) return null;
  let url: URL;
  try { url = new URL(rawEndpoint); } catch { return null; }
  const own = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && own)) return null;
  let actor: Record<string, unknown> | null;
  try { actor = normaliseActor(JSON.parse(rawActor)); } catch { return null; }
  if (!actor) return null;
  const registration = q.get("registration");
  return {
    endpoint: url.href.endsWith("/") ? url.href : `${url.href}/`,
    auth: q.get("auth") ?? "",
    actor,
    registration: registration && UUID.test(registration) ? registration.toLowerCase() : null,
    activityId: q.get("activity_id") || courseActivityId(project.meta),
  };
}

/** A version 4 UUID. crypto.randomUUID only exists on secure pages, and an LMS may serve the course over plain http. */
export function uuid4(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---- the tracker

export interface XapiIo {
  fetch: FetchLike;
  clock?: () => number;
  newId?: () => string;
  /** How a failed send waits before trying again. Tests make it instant. */
  wait?: (ms: number) => Promise<void>;
}

interface Batch { statements: Record<string, unknown>[]; tries: number }

const MAX_TRIES = 3;

export class XapiTracker {
  private readonly launch: XapiLaunch;
  private readonly runtime: Runtime;
  private readonly fetchFn: FetchLike;
  private readonly clock: () => number;
  private readonly newId: () => string;
  private readonly lang: string;
  private started = 0;
  private open = false;
  private finished = false;
  private pending = false;
  private lastSlide = "";
  private sentCompleted = false;
  private sentResult = false;
  private lastState = "";
  private queue: Record<string, unknown>[] = [];
  private chain: Promise<void> = Promise.resolve();
  private readonly wait: (ms: number) => Promise<void>;

  constructor(launch: XapiLaunch, runtime: Runtime, io: XapiIo) {
    this.launch = launch;
    this.runtime = runtime;
    this.fetchFn = io.fetch;
    this.wait = io.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.clock = io.clock ?? (() => Date.now());
    this.newId = io.newId ?? uuid4;
    this.lang = runtime.pkg.project.meta.language;
  }

  /** Connect to the LRS. Resolves to where to resume, or null to start from the beginning. Never rejects: an LRS that cannot be reached means an untracked start, not a stuck course. */
  async begin(): Promise<Snapshot | null> {
    this.open = true;
    this.started = this.clock();
    const resume = await this.loadState();

    this.runtime.onEvent((e) => {
      if (e.type === "slide") this.noteSlide();
      if (e.type === "quiz") this.noteAnswer(e.objectId, e.graded);
      if (e.type === "input") this.noteInput(e.objectId, e.rowId, e.interaction, e.response);
      this.schedule();
    });

    this.add("initialized", this.course());
    if (resume) this.add("resumed", this.course());
    this.send(false);
    return resume;
  }

  /** Write everything that depends on the course's current state. */
  flush(final = false): void {
    if (!this.open || this.finished) return;
    this.pending = false;
    const progress = evaluate(this.runtime);
    const total = progress.scorePercent === null ? null : {
      scaled: Math.round(progress.scorePercent * 100) / 10000, raw: progress.scorePercent, min: 0, max: 100,
    };
    // Completed and the result are sent once, when the course is complete. Sending the result sooner would let an LRS
    // report pass or fail for a learner who has not finished.
    if (progress.completed && !this.sentCompleted) {
      this.sentCompleted = true;
      this.add("completed", this.course(), { completion: true, duration: duration(this.clock() - this.started), ...(total ? { score: total } : {}) });
    }
    if (progress.completed && progress.success !== null && !this.sentResult) {
      this.sentResult = true;
      this.add(progress.success ? "passed" : "failed", this.course(), { success: progress.success, completion: true, ...(total ? { score: total } : {}) });
    }
    this.saveState(progress.completed, final);
    this.send(final);
  }

  /** Final report when the learner leaves. Safe to call more than once. */
  end(): void {
    if (!this.open || this.finished) return;
    this.flush(true);
    const done = evaluate(this.runtime).completed;
    this.add(done ? "terminated" : "suspended", this.course(), { duration: duration(this.clock() - this.started) });
    this.send(true);
    this.finished = true;
  }

  /** Resolves when every request made so far has been answered, retries included. For tests. */
  async settled(): Promise<void> {
    let seen: Promise<void>;
    do {
      seen = this.chain;
      await seen;
    } while (seen !== this.chain);
  }

  // ---- what happened, as statements

  private noteSlide(): void {
    const slide = this.runtime.currentSlide;
    if (!slide || slide.id === this.lastSlide) return;
    this.lastSlide = slide.id;
    this.add("experienced", this.activity(`${this.launch.activityId}/slide/${encodeURIComponent(slide.id)}`, "lesson", slide.name), undefined, true);
  }

  private noteAnswer(objectId: string, graded: Graded): void {
    const obj = this.runtime.findQuiz(objectId);
    if (!obj) return;
    const q = obj.content as unknown as QuizContent;
    const f = formatGraded(q, graded);
    const points = q.scoring.points;
    const result: Record<string, unknown> = { response: f.response, success: graded.correct };
    // A partly right answer is not a success here, but its share of the points is in the score.
    if (points > 0) result["score"] = { scaled: graded.fraction, raw: Math.round(graded.fraction * points * 100) / 100, min: 0, max: points };
    this.add("answered", this.question(objectId, f.kind, f.patterns), result, true);
  }

  private noteInput(objectId: string, rowId: string, type: "choice" | "likert" | "true-false", response: string): void {
    if (response === "") return;
    const key = rowId === objectId ? objectId : `${objectId}.${rowId}`;
    const f = formatInput(type, response);
    this.add("answered", this.question(key, f.kind, []), { response: f.response }, true);
  }

  // ---- statements

  private activity(id: string, type: string, name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { objectType: "Activity", id, definition: { type: `${ACTIVITY}${type}`, name: { [this.lang]: name }, ...extra } };
  }

  private course(): Record<string, unknown> {
    return this.activity(this.launch.activityId, "course", this.runtime.pkg.project.meta.title);
  }

  private question(key: string, kind: InteractionKind, patterns: string[]): Record<string, unknown> {
    return this.activity(`${this.launch.activityId}/question/${encodeURIComponent(key)}`, "cmi.interaction", key, {
      interactionType: kind,
      ...(patterns.length ? { correctResponsesPattern: patterns } : {}),
    });
  }

  /** Queue a statement. `inCourse` ties it to the course, as a part of it. */
  private add(verb: Verb, object: Record<string, unknown>, result?: Record<string, unknown>, inCourse = false): void {
    const context: Record<string, unknown> = { platform: "OpenStage Author", language: this.lang };
    if (this.launch.registration) context["registration"] = this.launch.registration;
    if (inCourse) context["contextActivities"] = { parent: [{ objectType: "Activity", id: this.launch.activityId }] };
    this.queue.push({
      id: this.newId(),
      actor: this.launch.actor,
      verb: { id: `${ADL}${VERBS[verb]}`, display: { "en-US": VERBS[verb] } },
      object,
      ...(result ? { result } : {}),
      context,
      timestamp: new Date(this.clock()).toISOString(),
    });
  }

  /** Several runtime events in one click become one request to the LRS. */
  private schedule(): void {
    if (this.pending) return;
    this.pending = true;
    setTimeout(() => this.flush(), 0);
  }

  // ---- talking to the LRS

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { "X-Experience-API-Version": XAPI_VERSION, ...(this.launch.auth ? { Authorization: this.launch.auth } : {}), ...extra };
  }

  private stateUrl(): string {
    const q = new URLSearchParams({ stateId: STATE_ID, activityId: this.launch.activityId, agent: JSON.stringify(this.launch.actor) });
    if (this.launch.registration) q.set("registration", this.launch.registration);
    return `${this.launch.endpoint}activities/state?${q.toString()}`;
  }

  /** Where the learner left off, or null. A course that was finished starts again from the beginning. */
  private async loadState(): Promise<Snapshot | null> {
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), 4000);
    try {
      const res = await this.fetchFn(this.stateUrl(), { method: "GET", headers: this.headers(), signal: control.signal, credentials: "omit" });
      if (res.status !== 200) return null;
      const state = JSON.parse(await res.text()) as { v?: unknown; suspend?: unknown; completed?: unknown };
      if (state.v !== 1 || state.completed === true || typeof state.suspend !== "string") return null;
      this.lastState = JSON.stringify(state);
      return decodeSuspend(state.suspend);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Keep the learner's place, but only when it has changed. xAPI has no size limit on it, so nothing is dropped to fit. */
  private saveState(completed: boolean, final: boolean): void {
    const body = JSON.stringify({ v: 1, suspend: encodeSuspend(this.runtime.snapshot(), Number.MAX_SAFE_INTEGER), completed });
    if (body === this.lastState) return;
    this.lastState = body;
    const request = () => this.fetchFn(this.stateUrl(), {
      method: "PUT", headers: this.headers({ "Content-Type": "application/json" }), body, credentials: "omit",
      // A browser lets a request outlive the page only if it is small.
      keepalive: final && body.length < 60000,
    });
    if (final) void request().catch(() => undefined);
    else this.chain = this.chain.then(() => request().then(() => undefined, () => undefined));
  }

  private send(final: boolean): void {
    if (this.queue.length === 0) return;
    const batch: Batch = { statements: this.queue.splice(0), tries: 0 };
    if (final) void this.post(batch, true);
    else this.chain = this.chain.then(() => this.post(batch, false));
  }

  private async post(batch: Batch, keepalive: boolean): Promise<void> {
    batch.tries++;
    try {
      const res = await this.fetchFn(`${this.launch.endpoint}statements`, {
        method: "POST", headers: this.headers({ "Content-Type": "application/json" }), body: JSON.stringify(batch.statements),
        keepalive: keepalive && JSON.stringify(batch.statements).length < 60000, credentials: "omit",
      });
      if (res.ok) return;
      // Something wrong with what was sent will not mend by sending it again. A busy or failing LRS might.
      console.warn(`xAPI: the LRS answered ${res.status} to ${batch.statements.length} statement(s).`);
      if (res.status >= 500 || res.status === 429) this.retry(batch);
    } catch {
      console.warn("xAPI: the LRS could not be reached.");
      this.retry(batch);
    }
  }

  private retry(batch: Batch): void {
    if (batch.tries >= MAX_TRIES || this.finished) return;
    this.chain = this.chain.then(() => this.wait(1000 * batch.tries)).then(() => this.post(batch, false));
  }
}

/** Connect the course to an LRS, using the details it was launched with. */
export async function attachXapi(win: Window, runtime: Runtime, launch: XapiLaunch, io?: XapiIo): Promise<{ tracker: XapiTracker; resume: Snapshot | null }> {
  const tracker = new XapiTracker(launch, runtime, io ?? { fetch: (url, init) => fetch(url, init) });
  const resume = await tracker.begin();
  // pagehide is the reliable moment on modern browsers, and beforeunload covers older LMS frames.
  win.addEventListener("pagehide", () => tracker.end());
  win.addEventListener("beforeunload", () => tracker.end());
  return { tracker, resume };
}
