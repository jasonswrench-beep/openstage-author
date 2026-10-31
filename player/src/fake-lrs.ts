// A small xAPI 1.0.3 learning record store, for tests. Like fake-lms.ts it is deliberately stricter than most real ones, so a
// mistake in the course shows up here first: it checks the version header and the credential, and each statement for the
// things the standard requires (a UUID, exactly one way of naming the actor, a verb and an object that are addresses, a score
// that makes sense, a real duration), and for what each of our verbs must carry. It keeps statements and State documents in
// memory. It is not a substitute for testing against a real LRS.

import type { FetchLike } from "./xapi.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IRI = /^[a-z][a-z0-9+.-]*:\S+$/i;
const DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+D)?(T(?!$)(\d+H)?(\d+M)?(\d+(\.\d{1,2})?S)?)?$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const INTERACTIONS = ["true-false", "choice", "fill-in", "long-fill-in", "matching", "performance", "sequencing", "likert", "numeric", "other"];
const TOP = ["id", "actor", "verb", "object", "result", "context", "timestamp", "stored", "authority", "version", "attachments"];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isMap = (v: unknown): boolean => isObject(v) && Object.keys(v).length > 0 && Object.values(v).every((x) => typeof x === "string");

/** The reason a statement would be refused, or null. */
export function statementProblem(s: unknown): string | null {
  if (!isObject(s)) return "a statement must be an object";
  for (const key of Object.keys(s)) if (!TOP.includes(key)) return `unknown property ${key}`;
  if (typeof s["id"] !== "string" || !UUID.test(s["id"])) return "id must be a UUID";

  const actor = s["actor"];
  if (!isObject(actor)) return "actor is missing";
  if (actor["objectType"] !== undefined && actor["objectType"] !== "Agent") return "actor must be an Agent";
  const identifiers = ["mbox", "mbox_sha1sum", "openid", "account"].filter((k) => actor[k] !== undefined);
  if (identifiers.length !== 1) return "an actor needs exactly one way of being identified";
  if (typeof actor["mbox"] === "string" && !actor["mbox"].startsWith("mailto:")) return "mbox must be a mailto address";
  if (identifiers[0] === "account" && !(isObject(actor["account"]) && typeof actor["account"]["homePage"] === "string" && typeof actor["account"]["name"] === "string")) return "account needs homePage and name";

  const verb = s["verb"];
  if (!isObject(verb) || typeof verb["id"] !== "string" || !IRI.test(verb["id"])) return "verb.id must be an address";
  if (verb["display"] !== undefined && !isMap(verb["display"])) return "verb.display must be a language map";

  const object = s["object"];
  if (!isObject(object)) return "object is missing";
  if (object["objectType"] !== undefined && object["objectType"] !== "Activity") return "object must be an Activity";
  if (typeof object["id"] !== "string" || !IRI.test(object["id"])) return "object.id must be an address";
  const def = object["definition"];
  if (def !== undefined) {
    if (!isObject(def)) return "definition must be an object";
    if (def["type"] !== undefined && (typeof def["type"] !== "string" || !IRI.test(def["type"]))) return "definition.type must be an address";
    if (def["name"] !== undefined && !isMap(def["name"])) return "definition.name must be a language map";
    if (def["interactionType"] !== undefined) {
      if (!INTERACTIONS.includes(String(def["interactionType"]))) return "unknown interactionType";
      if (def["type"] !== "http://adlnet.gov/expapi/activities/cmi.interaction") return "interactionType needs the cmi.interaction type";
    }
    const patterns = def["correctResponsesPattern"];
    if (patterns !== undefined && !(Array.isArray(patterns) && patterns.every((p) => typeof p === "string"))) return "correctResponsesPattern must be a list of text";
  }

  const result = s["result"];
  if (result !== undefined) {
    if (!isObject(result)) return "result must be an object";
    for (const key of ["success", "completion"]) if (result[key] !== undefined && typeof result[key] !== "boolean") return `result.${key} must be true or false`;
    if (result["response"] !== undefined && typeof result["response"] !== "string") return "result.response must be text";
    if (result["duration"] !== undefined && !(typeof result["duration"] === "string" && DURATION.test(result["duration"]))) return "result.duration must be an ISO 8601 duration";
    const score = result["score"];
    if (score !== undefined) {
      if (!isObject(score)) return "score must be an object";
      for (const key of ["scaled", "raw", "min", "max"]) if (score[key] !== undefined && typeof score[key] !== "number") return `score.${key} must be a number`;
      const { scaled, raw, min, max } = score as Record<string, number | undefined>;
      if (scaled !== undefined && (scaled < -1 || scaled > 1)) return "score.scaled must be from -1 to 1";
      if (min !== undefined && max !== undefined && min > max) return "score.min must not be above score.max";
      if (raw !== undefined && min !== undefined && raw < min) return "score.raw must not be below score.min";
      if (raw !== undefined && max !== undefined && raw > max) return "score.raw must not be above score.max";
    }
  }

  const context = s["context"];
  if (context !== undefined) {
    if (!isObject(context)) return "context must be an object";
    if (context["registration"] !== undefined && !(typeof context["registration"] === "string" && UUID.test(context["registration"]))) return "context.registration must be a UUID";
    const activities = context["contextActivities"];
    if (activities !== undefined) {
      if (!isObject(activities)) return "contextActivities must be an object";
      for (const list of Object.values(activities)) {
        if (!Array.isArray(list) || !list.every((a) => isObject(a) && typeof a["id"] === "string" && IRI.test(a["id"]))) return "contextActivities must hold lists of activities";
      }
    }
  }

  if (s["timestamp"] !== undefined && !(typeof s["timestamp"] === "string" && TIMESTAMP.test(s["timestamp"]))) return "timestamp must be an ISO 8601 date and time";

  // What each of the verbs the course uses has to carry.
  const verbName = String(verb["id"]).split("/").pop();
  const r = isObject(result) ? result : {};
  if (verbName === "answered" && !(isObject(def) && def["interactionType"] !== undefined && typeof r["response"] === "string")) return "answered needs an interaction and a response";
  if (verbName === "completed" && r["completion"] !== true) return "completed needs result.completion true";
  if (verbName === "passed" && r["success"] !== true) return "passed needs result.success true";
  if (verbName === "failed" && r["success"] !== false) return "failed needs result.success false";
  return null;
}

export class FakeLrs {
  /** Every statement accepted, in order. */
  readonly statements: Record<string, unknown>[] = [];
  /** Every request made, in order. */
  readonly requests: { method: string; path: string; keepalive: boolean }[] = [];
  readonly states = new Map<string, string>();
  /** The next `count` requests are answered with `status`, to try a failing LRS. */
  failNext: { status: number; count: number } | null = null;
  /** Requests fail as if there were no network. */
  down = false;
  readonly endpoint: string;
  readonly auth: string;

  constructor(endpoint = "https://lrs.example.test/xapi/", auth = "Basic dGVzdDp0ZXN0") {
    this.endpoint = endpoint;
    this.auth = auth;
  }

  /** The statements with this verb, in order. */
  verbs(): string[] {
    return this.statements.map((s) => String((s["verb"] as { id: string }).id).split("/").pop()!);
  }

  readonly fetch: FetchLike = async (url, init) => {
    if (this.down) throw new TypeError("network error");
    const u = new URL(url);
    const path = u.pathname.slice(new URL(this.endpoint).pathname.length);
    this.requests.push({ method: init.method, path, keepalive: init.keepalive === true });
    if (this.failNext && this.failNext.count > 0) {
      this.failNext.count--;
      return answer(this.failNext.status, "");
    }
    if (!u.href.startsWith(this.endpoint)) return answer(404, "");
    const headers = Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]));
    if (!/^1\.0(\.\d+)?$/.test(headers["x-experience-api-version"] ?? "")) return answer(400, "X-Experience-API-Version is missing or wrong");
    if (headers["authorization"] !== this.auth) return answer(401, "");

    if (path === "statements" && init.method === "POST") {
      let body: unknown;
      try { body = JSON.parse(init.body ?? ""); } catch { return answer(400, "the body is not JSON"); }
      if (!/^application\/json/.test(headers["content-type"] ?? "")) return answer(400, "Content-Type must be application/json");
      const list = Array.isArray(body) ? body : [body];
      for (const s of list) {
        const problem = statementProblem(s);
        if (problem) return answer(400, problem);
      }
      for (const s of list as Record<string, unknown>[]) {
        const earlier = this.statements.find((x) => x["id"] === s["id"]);
        if (earlier) {
          if (JSON.stringify(earlier) !== JSON.stringify(s)) return answer(409, "a different statement has this id");
          continue;
        }
        this.statements.push(s);
      }
      return answer(200, JSON.stringify(list.map((s) => (s as Record<string, unknown>)["id"])));
    }

    if (path === "activities/state") {
      const stateId = u.searchParams.get("stateId");
      const activityId = u.searchParams.get("activityId");
      const agent = u.searchParams.get("agent");
      if (!stateId || !activityId || !agent) return answer(400, "stateId, activityId and agent are required");
      try { JSON.parse(agent); } catch { return answer(400, "agent is not JSON"); }
      const registration = u.searchParams.get("registration");
      if (registration !== null && !UUID.test(registration)) return answer(400, "registration must be a UUID");
      const key = [activityId, agent, registration ?? "", stateId].join("|");
      if (init.method === "PUT") {
        if (!/^application\/json/.test(headers["content-type"] ?? "")) return answer(400, "Content-Type must be application/json");
        try { JSON.parse(init.body ?? ""); } catch { return answer(400, "the body is not JSON"); }
        this.states.set(key, init.body ?? "");
        return answer(204, "");
      }
      if (init.method === "GET") return this.states.has(key) ? answer(200, this.states.get(key)!) : answer(404, "");
      if (init.method === "DELETE") { this.states.delete(key); return answer(204, ""); }
    }
    return answer(404, "");
  };
}

function answer(status: number, body: string): { ok: boolean; status: number; text(): Promise<string> } {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}
