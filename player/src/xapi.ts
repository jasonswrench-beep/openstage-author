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
// A scenario adds two more:
//   answered               the learner made a choice in a scenario: which situation, which choice, what it added, where they are
//   interacted             the learner took back choices in a scenario
//
// The same tracker serves cmi5 (see cmi5.ts), where it is given what the LMS said at launch (`Cmi5Session`). cmi5 is the same statements with
// stricter rules: initialized first and terminated last, no resumed or suspended, a duration on every one of completed, passed, failed and
// terminated, the result fields that belong to each, the LMS's context template in every statement, and nothing sent but initialized and
// terminated when the LMS launched the course only to browse or review it.
//
// Nothing here knows about a page, so all of it is tested against a stand-in LRS (fake-lrs.ts) without a browser. The one
// secret in play is `auth`, the LRS credential in the address. It goes only into the Authorization header of requests to the
// endpoint it came with, and never into a message or a statement.

import type { Runtime, Snapshot } from "./runtime.ts";
import type { Graded } from "./grading.ts";
import type { InputInteraction, Project, QuizContent, ScenarioContent } from "./types.ts";
import { decodeSuspend, encodeSuspend, evaluate } from "./scorm.ts";
import { formatGraded, formatInput, type InteractionKind } from "./interaction-format.ts";
import { walk } from "./scenario.ts";
import { sessionTime2004 as duration } from "./scorm2004.ts";

export const XAPI_VERSION = "1.0.3";

const ADL = "http://adlnet.gov/expapi/verbs/";
const VERBS = {
  initialized: "initialized", resumed: "resumed", experienced: "experienced", answered: "answered",
  completed: "completed", passed: "passed", failed: "failed", suspended: "suspended", terminated: "terminated", interacted: "interacted",
} as const;
type Verb = keyof typeof VERBS;

const STATE_ID = "openstage-progress";

/** The extension a scenario statement carries its details in: where the learner was, what they chose, what it added, whether it was an ending. */
export const SCENARIO_EXTENSION = "https://openstageauthor.com/xapi/extensions/scenario";

/** cmi5's names (see cmi5.ts). */
export const CMI5_CATEGORY = "https://w3id.org/xapi/cmi5/context/categories/cmi5";
export const CMI5_MOVEON = "https://w3id.org/xapi/cmi5/context/categories/moveon";
export const CMI5_MASTERY_EXTENSION = "https://w3id.org/xapi/cmi5/context/extensions/masteryscore";
const CMI5_DEFINED = new Set<string>(["initialized", "completed", "passed", "failed", "terminated"]);

/** What the LMS said about this launch of a cmi5 course (its LMS.LaunchData document), in the form the tracker needs. */
export interface Cmi5Session {
  /** The context every statement starts from. It holds the session id and the unit's own id; nothing in it is overwritten. */
  contextTemplate: Record<string, unknown>;
  launchMode: "Normal" | "Browse" | "Review";
  /** From 0 to 1, or null when the course structure gave none. A passed or failed statement is based on it. */
  masteryScore: number | null;
  /** Where to send the learner's window when the course ends, or null. */
  returnURL: string | null;
}
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
  private readonly cmi5: Cmi5Session | null;
  /** Where each scenario was when last heard of, so a move can be told as a choice or as taking choices back. */
  private readonly scenarioPaths = new Map<string, string>();
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

  constructor(launch: XapiLaunch, runtime: Runtime, io: XapiIo, cmi5: Cmi5Session | null = null) {
    this.cmi5 = cmi5;
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
    // A course the LMS launched only to browse or review sends initialized and terminated and nothing else, and does not keep a place.
    const resume = this.quiet() ? null : await this.loadState();

    if (!this.quiet()) {
      this.runtime.onEvent((e) => {
        if (e.type === "slide") this.noteSlide();
        if (e.type === "quiz") this.noteAnswer(e.objectId, e.graded);
        if (e.type === "input") this.noteInput(e.objectId, e.rowId, e.interaction, e.response);
        if (e.type === "scenario") this.noteScenario(e.objectId, e.path);
        this.schedule();
      });
    }

    this.add("initialized", this.course());
    // cmi5 has no resumed: a returning learner is a new session of the same registration.
    if (resume && !this.cmi5) this.add("resumed", this.course());
    this.send(false);
    return resume;
  }

  /** Write everything that depends on the course's current state. */
  flush(final = false): void {
    if (!this.open || this.finished || this.quiet()) return;
    this.pending = false;
    const progress = evaluate(this.runtime);
    // cmi5 asks for a whole number of points, so its raw score is rounded; the scaled score keeps the hundredths.
    const total = progress.scorePercent === null ? null : {
      scaled: Math.round(progress.scorePercent * 100) / 10000, raw: this.cmi5 ? Math.round(progress.scorePercent) : progress.scorePercent, min: 0, max: 100,
    };
    // Completed and the result are sent once, when the course is complete. Sending the result sooner would let an LRS
    // report pass or fail for a learner who has not finished.
    const took = duration(this.clock() - this.started);
    if (progress.completed && !this.sentCompleted) {
      this.sentCompleted = true;
      // cmi5 keeps the score for passed and failed, and a completed statement carries nothing but its completion and duration.
      this.add("completed", this.course(), { completion: true, duration: took, ...(total && !this.cmi5 ? { score: total } : {}) });
    }
    if (progress.completed && progress.success !== null && !this.sentResult) {
      this.sentResult = true;
      // The LMS's mastery score, when it gave one, decides; otherwise the course's own pass mark does.
      const mastery = this.cmi5?.masteryScore ?? null;
      const success = mastery !== null && total ? total.scaled + 1e-9 >= mastery : progress.success;
      this.add(success ? "passed" : "failed", this.course(), this.cmi5
        ? { success, duration: took, ...(total ? { score: total } : {}) }
        : { success, completion: true, ...(total ? { score: total } : {}) });
    }
    this.saveState(progress.completed, final);
    this.send(final);
  }

  /** Final report when the learner leaves. Safe to call more than once. */
  end(): void {
    if (!this.open || this.finished) return;
    this.flush(true);
    const done = evaluate(this.runtime).completed;
    // cmi5 has terminated and nothing like suspended: leaving early is a terminated session.
    this.add(done || this.cmi5 ? "terminated" : "suspended", this.course(), { duration: duration(this.clock() - this.started) });
    this.send(true);
    this.finished = true;
  }

  /** Where the LMS asked the learner's window to go when the course ends (cmi5's returnURL), or null. */
  get returnUrl(): string | null {
    return this.cmi5?.returnURL ?? null;
  }

  /** A course the LMS launched to browse or review: nothing is reported but that it started and stopped. */
  private quiet(): boolean {
    return this.cmi5 !== null && this.cmi5.launchMode !== "Normal";
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
    // Where each scenario on this slide stands as it opens, so the first move is told from there (a learner who came back is not at the start).
    for (const layer of [slide.baseLayer, ...slide.layers]) {
      for (const o of layer.objects) if (o.type === "scenario" && !this.scenarioPaths.has(o.id)) this.scenarioPaths.set(o.id, this.runtime.scenarioPath(o.id));
    }
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

  /**
   * A learner made a choice in a scenario, or took choices back. A choice is an answer to the situation they were in: the situation is the
   * interaction, its choices are the options, and the one taken is the response. What it added to the variables, the path to where they are
   * now and whether it ended the story are in the scenario extension, so a reader of the record can follow the whole walk.
   */
  private noteScenario(objectId: string, path: string): void {
    const obj = this.runtime.findScenario(objectId);
    if (!obj) return;
    const c = obj.content as unknown as ScenarioContent;
    const before = this.scenarioPaths.get(objectId) ?? "";
    this.scenarioPaths.set(objectId, path);
    const scenario = this.activity(`${this.launch.activityId}/scenario/${encodeURIComponent(objectId)}`, "simulation", obj.name || objectId);
    if (path.length === before.length + 1 && path.startsWith(before)) {
      const w = walk(c, before);
      const node = w?.nodes[w.nodes.length - 1];
      const index = Number(path[path.length - 1]);
      const choice = node?.choices[index];
      if (!node || !choice) return;
      const after = walk(c, path);
      const ending = (after?.nodes[after.nodes.length - 1]?.choices.length ?? 1) === 0;
      const situation = this.activity(`${this.launch.activityId}/scenario/${encodeURIComponent(objectId)}/situation/${encodeURIComponent(node.id)}`, "cmi.interaction", node.title, {
        interactionType: "choice",
        choices: node.choices.map((ch, i) => ({ id: String(i), description: { [this.lang]: ch.label } })),
      });
      this.add("answered", situation, {
        response: String(index),
        extensions: { [SCENARIO_EXTENSION]: { scenario: obj.name || objectId, situation: node.title, choice: choice.label, effects: choice.effects.map((e) => ({ variable: e.variable, add: e.add })), path, ending } },
      }, true);
    } else if (path.length < before.length && before.startsWith(path)) {
      this.add("interacted", scenario, { extensions: { [SCENARIO_EXTENSION]: { tookBack: before.length - path.length, path } } }, true);
    }
  }

  private noteInput(objectId: string, rowId: string, type: InputInteraction, response: string): void {
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
    this.queue.push({
      id: this.newId(),
      actor: this.launch.actor,
      verb: { id: `${ADL}${VERBS[verb]}`, display: { "en-US": VERBS[verb] } },
      object,
      ...(result ? { result } : {}),
      context: this.cmi5 ? this.cmi5Context(verb, result, inCourse) : this.context(inCourse),
      timestamp: new Date(this.clock()).toISOString(),
    });
  }

  private context(inCourse: boolean): Record<string, unknown> {
    const context: Record<string, unknown> = { platform: "OpenStage Author", language: this.lang };
    if (this.launch.registration) context["registration"] = this.launch.registration;
    if (inCourse) context["contextActivities"] = { parent: [{ objectType: "Activity", id: this.launch.activityId }] };
    return context;
  }

  /**
   * A cmi5 statement's context: what the LMS gave as the template (the session, and the unit's own id as the grouping), with the registration, and
   * for the five statements cmi5 defines, the cmi5 category; for the ones that settle completion or success, the move-on category as well; for a
   * passed or failed one, the mastery score it was judged against. Nothing the template holds is overwritten.
   */
  private cmi5Context(verb: Verb, result: Record<string, unknown> | undefined, inCourse: boolean): Record<string, unknown> {
    const template = JSON.parse(JSON.stringify(this.cmi5!.contextTemplate)) as Record<string, unknown>;
    const context: Record<string, unknown> = { ...template };
    if (context["registration"] === undefined && this.launch.registration) context["registration"] = this.launch.registration;
    if (context["platform"] === undefined) context["platform"] = "OpenStage Author";
    if (context["language"] === undefined) context["language"] = this.lang;
    const given = (context["contextActivities"] as Record<string, unknown[]> | undefined) ?? {};
    const activities: Record<string, unknown[]> = { ...given };
    const add = (kind: string, id: string) => { activities[kind] = [...(activities[kind] ?? []), { objectType: "Activity", id }]; };
    if (CMI5_DEFINED.has(verb)) {
      add("category", CMI5_CATEGORY);
      if (result && (result["success"] !== undefined || result["completion"] !== undefined)) add("category", CMI5_MOVEON);
    } else if (inCourse) add("parent", this.launch.activityId);
    context["contextActivities"] = activities;
    if ((verb === "passed" || verb === "failed") && this.cmi5!.masteryScore !== null) {
      context["extensions"] = { ...((context["extensions"] as Record<string, unknown> | undefined) ?? {}), [CMI5_MASTERY_EXTENSION]: this.cmi5!.masteryScore };
    }
    return context;
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
export async function attachXapi(win: Window, runtime: Runtime, launch: XapiLaunch, io?: XapiIo, cmi5: Cmi5Session | null = null): Promise<{ tracker: XapiTracker; resume: Snapshot | null }> {
  const tracker = new XapiTracker(launch, runtime, io ?? { fetch: (url, init) => fetch(url, init) }, cmi5);
  const resume = await tracker.begin();
  // pagehide is the reliable moment on modern browsers, and beforeunload covers older LMS frames.
  win.addEventListener("pagehide", () => tracker.end());
  win.addEventListener("beforeunload", () => tracker.end());
  return { tracker, resume };
}
