// A small cmi5 learning system, for tests: the part of an LMS that launches a course and checks what it sends back. It is built on the stand-in LRS
// (fake-lrs.ts), so every statement is first checked as xAPI, and then against the rules cmi5 adds (cmi5Problems below). Like the other stand-ins it is
// deliberately stricter than most real ones, and it is not a substitute for a real LMS. The rules are those of cmi5 Quartz, section 9 and 10.

import { FakeLrs } from "./fake-lrs.ts";
import type { FetchLike } from "./xapi.ts";
import { CMI5_CATEGORY, CMI5_MASTERY_EXTENSION, CMI5_MOVEON } from "./xapi.ts";
import { LAUNCH_DATA_STATE, SESSION_ID_EXTENSION, type Cmi5Launch } from "./cmi5.ts";

const DEFINED = ["initialized", "completed", "passed", "failed", "terminated"];

export interface Cmi5LmsOptions {
  launchMode?: "Normal" | "Browse" | "Review";
  masteryScore?: number | null;
  returnURL?: string | null;
  /** Leave out the context template's session id, to see the course refuse a launch it cannot follow. */
  noSessionId?: boolean;
  /** Where the LMS is, ending in a slash. A test address by default; the stand-in for trying a course by hand gives its own. */
  base?: string;
}

export class FakeCmi5Lms {
  readonly lrs: FakeLrs;
  readonly launch: Cmi5Launch;
  readonly unitId = "https://openstageauthor.com/xapi/course/test-2026-11-16/au/1";
  readonly sessionId = "6f1d2b3c-4a5e-4c7d-8e9f-0a1b2c3d4e5f";
  readonly options: Required<Pick<Cmi5LmsOptions, "launchMode" | "masteryScore" | "returnURL">> & Cmi5LmsOptions;
  /** The token has been handed out. It can be had once. */
  tokenGiven = false;
  /** How many times the fetch address was asked, and with which method. */
  readonly fetchCalls: string[] = [];
  /** What the learner prefers, served from the agent profile, or null for none. */
  preferences: Record<string, string> | null = null;
  private readonly token = "dGVzdC1sZWFybmVyOnNlY3JldA==";

  constructor(options: Cmi5LmsOptions = {}) {
    this.options = { launchMode: "Normal", masteryScore: 0.8, returnURL: null, ...options };
    const base = options.base ?? "https://lms.example.test/";
    this.lrs = new FakeLrs(`${base}cmi5/`, `Basic ${this.token}`);
    this.launch = {
      endpoint: this.lrs.endpoint,
      fetchUrl: `${base}token?k=2390289x0`,
      actor: { objectType: "Agent", account: { homePage: base.replace(/\/$/, ""), name: "1625378" } },
      registration: "0b8c1e2a-5d3f-4a6b-9c7d-1e2f3a4b5c6d",
      activityId: `${base}activities/au-launch-7`,
    };
    this.putLaunchData();
  }

  /** The address the LMS opens the course with. */
  get address(): string {
    const q = new URLSearchParams({ endpoint: this.launch.endpoint, fetch: this.launch.fetchUrl, actor: JSON.stringify(this.launch.actor), registration: this.launch.registration, activityId: this.launch.activityId });
    return `?${q.toString()}`;
  }

  private putLaunchData(): void {
    const o = this.options;
    const doc: Record<string, unknown> = {
      contextTemplate: {
        contextActivities: { grouping: [{ objectType: "Activity", id: this.unitId }] },
        extensions: o.noSessionId ? {} : { [SESSION_ID_EXTENSION]: this.sessionId },
      },
      launchMode: o.launchMode,
      moveOn: "CompletedAndPassed",
      ...(o.masteryScore !== null ? { masteryScore: o.masteryScore } : {}),
      ...(o.returnURL ? { returnURL: o.returnURL } : {}),
    };
    const key = [this.launch.activityId, JSON.stringify(this.launch.actor), this.launch.registration, LAUNCH_DATA_STATE].join("|");
    this.lrs.states.set(key, JSON.stringify(doc));
  }

  readonly fetch: FetchLike = async (url, init) => {
    if (url === this.launch.fetchUrl) {
      this.fetchCalls.push(init.method);
      if (init.method !== "POST") return answer(405, "");
      // Both a good answer and an error are a 200 with a JSON body, as cmi5 says.
      if (this.tokenGiven) return answer(200, JSON.stringify({ "error-code": "1", "error-text": "The authorization token has already been returned." }));
      this.tokenGiven = true;
      return answer(200, JSON.stringify({ "auth-token": this.token }));
    }
    const u = new URL(url);
    if (u.pathname.endsWith("/agents/profile")) {
      if ((init.headers["Authorization"] ?? init.headers["authorization"]) !== this.lrs.auth) return answer(401, "");
      return u.searchParams.get("profileId") === "cmi5LearnerPreferences" && this.preferences ? answer(200, JSON.stringify(this.preferences)) : answer(404, "");
    }
    return this.lrs.fetch(url, init);
  };

  /** Ask for a new launch of the same registration: the LMS makes a new token each time one is launched. */
  relaunch(): void {
    this.tokenGiven = false;
  }

  /** What this session sent, in order. */
  get statements(): Record<string, unknown>[] {
    return this.lrs.statements;
  }

  /** Every way the statements break cmi5's rules, a session at a time (a session begins with initialized). Empty when they keep them all. */
  problems(): string[] {
    const sessions: Record<string, unknown>[][] = [];
    for (const s of this.statements) {
      if (String((s["verb"] as { id: string }).id).endsWith("/initialized") || sessions.length === 0) sessions.push([]);
      sessions[sessions.length - 1]!.push(s);
    }
    return sessions.flatMap((list, i) => this.sessionProblems(list).map((p) => (sessions.length > 1 ? `session ${i + 1}: ${p}` : p)));
  }

  private sessionProblems(statements: Record<string, unknown>[]): string[] {
    return cmi5Problems(statements, { unitId: this.unitId, activityId: this.launch.activityId, registration: this.launch.registration, sessionId: this.sessionId, launchMode: this.options.launchMode, masteryScore: this.options.masteryScore, actor: this.launch.actor });
  }
}

function answer(status: number, body: string): { ok: boolean; status: number; text(): Promise<string> } {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

export interface Cmi5Expect {
  unitId: string;
  activityId: string;
  registration: string;
  sessionId: string;
  launchMode: "Normal" | "Browse" | "Review";
  masteryScore: number | null;
  actor: unknown;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});

/** The ways a session's statements, in the order sent, break the rules cmi5 adds to xAPI. */
export function cmi5Problems(statements: Obj[], want: Cmi5Expect): string[] {
  const out: string[] = [];
  const verbOf = (s: Obj): string => String(obj(s["verb"])["id"]).split("/").pop()!;
  if (statements.length === 0) return ["no statement was sent"];
  const verbs = statements.map(verbOf);
  if (verbs[0] !== "initialized") out.push(`the first statement is ${verbs[0]}, not initialized`);
  if (verbs[verbs.length - 1] !== "terminated") out.push(`the last statement is ${verbs[verbs.length - 1]}, not terminated`);
  for (const v of DEFINED) if (verbs.filter((x) => x === v).length > 1) out.push(`${v} was sent more than once`);
  if (verbs.includes("passed") && verbs.includes("failed")) out.push("both passed and failed were sent");
  for (const bad of ["resumed", "suspended"]) if (verbs.includes(bad)) out.push(`${bad} is not a cmi5 verb`);
  if (want.launchMode !== "Normal" && verbs.some((v) => !["initialized", "terminated"].includes(v))) out.push(`a ${want.launchMode} launch sent ${verbs.filter((v) => !["initialized", "terminated"].includes(v)).join(", ")}`);

  statements.forEach((s, i) => {
    const verb = verbOf(s);
    const at = `statement ${i + 1} (${verb})`;
    const context = obj(s["context"]);
    const activities = obj(context["contextActivities"]);
    const ids = (kind: string): string[] => (Array.isArray(activities[kind]) ? (activities[kind] as Obj[]).map((a) => String(a["id"])) : []);
    const result = obj(s["result"]);
    if (context["registration"] !== want.registration) out.push(`${at}: registration is not the launch's`);
    if (obj(context["extensions"])[SESSION_ID_EXTENSION] !== want.sessionId) out.push(`${at}: the session id is missing`);
    if (!ids("grouping").includes(want.unitId)) out.push(`${at}: the unit is not in the grouping`);
    if (JSON.stringify(s["actor"]) !== JSON.stringify(want.actor)) out.push(`${at}: the actor is not the one the LMS gave`);
    if (typeof s["timestamp"] !== "string" || !/Z$/.test(String(s["timestamp"]))) out.push(`${at}: the timestamp is not in UTC`);
    if (i > 0 && i < statements.length - 1 && DEFINED.includes(verb) && ["initialized", "terminated"].includes(verb)) out.push(`${at}: sent in the middle of the session`);

    if (DEFINED.includes(verb)) {
      if (obj(s["object"])["id"] !== want.activityId) out.push(`${at}: the object is not the launch's activity`);
      if (!ids("category").includes(CMI5_CATEGORY)) out.push(`${at}: the cmi5 category is missing`);
      const settles = result["success"] !== undefined || result["completion"] !== undefined;
      if (settles !== ids("category").includes(CMI5_MOVEON)) out.push(`${at}: the move-on category ${settles ? "is missing" : "must not be there"}`);
      if (["completed", "passed", "failed", "terminated"].includes(verb) && typeof result["duration"] !== "string") out.push(`${at}: it needs a duration`);
      if (result["score"] !== undefined && !["passed", "failed"].includes(verb)) out.push(`${at}: a score belongs only in passed and failed`);
      if (result["success"] !== undefined && !["passed", "failed"].includes(verb)) out.push(`${at}: success belongs only in passed and failed`);
      if (result["completion"] !== undefined && verb !== "completed") out.push(`${at}: completion belongs only in completed`);
      if (verb === "passed" && result["success"] !== true) out.push(`${at}: success must be true`);
      if (verb === "failed" && result["success"] !== false) out.push(`${at}: success must be false`);
      if (verb === "completed" && result["completion"] !== true) out.push(`${at}: completion must be true`);
      const score = obj(result["score"]);
      if (score["raw"] !== undefined && !(Number.isInteger(score["raw"]) && score["min"] !== undefined && score["max"] !== undefined)) out.push(`${at}: raw must be a whole number with a min and a max`);
      if ((verb === "passed" || verb === "failed") && want.masteryScore !== null) {
        if (obj(context["extensions"])[CMI5_MASTERY_EXTENSION] !== want.masteryScore) out.push(`${at}: the mastery score extension is missing`);
        if (typeof score["scaled"] === "number") {
          if (verb === "passed" && score["scaled"] < want.masteryScore) out.push(`${at}: scaled ${score["scaled"]} is under the mastery score`);
          if (verb === "failed" && score["scaled"] >= want.masteryScore) out.push(`${at}: scaled ${score["scaled"]} reaches the mastery score`);
        }
      }
    } else {
      if (ids("category").includes(CMI5_CATEGORY)) out.push(`${at}: an allowed statement must not carry the cmi5 category`);
      if (ids("category").includes(CMI5_MOVEON)) out.push(`${at}: an allowed statement must not carry the move-on category`);
    }
  });
  return out;
}
