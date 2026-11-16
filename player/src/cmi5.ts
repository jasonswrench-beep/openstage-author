// cmi5 (Quartz, the 2016 first edition): the xAPI profile a learning system uses to launch a course as an "assignable unit" and to learn from it
// whether the learner completed it and passed. It is the same statements as xapi.ts sends, with the launch worked out the cmi5 way:
//
//   1. The LMS opens the course with ?endpoint=...&fetch=...&actor=...&registration=...&activityId=... in its address.
//   2. The course POSTs to the `fetch` address, once, and is given a token (`auth-token`) it sends as `Authorization: Basic <token>` from then on.
//   3. The course reads the LMS.LaunchData document from the State resource: the context every statement starts from, the launch mode (normal,
//      browse or review), the mastery score the LMS wants a pass judged against, and where to send the learner when the course ends.
//   4. It sends the statements (XapiTracker, given what step 3 found), with `initialized` first and `terminated` last.
//
// Nothing here knows about a page, so all of it is tested against a stand-in LMS (fake-cmi5.ts) without a browser. The one secret in play is the token. It
// goes only into the Authorization header of requests to the endpoint it came with, and never into a message or a statement.

import type { Runtime, Snapshot } from "./runtime.ts";
import { attachXapi, normaliseActor, XAPI_VERSION, type Cmi5Session, type FetchLike, type XapiIo, type XapiLaunch, type XapiTracker } from "./xapi.ts";

export const LAUNCH_DATA_STATE = "LMS.LaunchData";
export const PREFERENCES_PROFILE = "cmi5LearnerPreferences";
export const SESSION_ID_EXTENSION = "https://w3id.org/xapi/cmi5/context/extensions/sessionid";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IRI = /^[a-z][a-z0-9+.-]*:\S+$/i;

export interface Cmi5Launch {
  /** Always ends with a slash. */
  endpoint: string;
  /** Where the course asks for its token. */
  fetchUrl: string;
  actor: Record<string, unknown>;
  registration: string;
  /** The unit as the LMS knows it for this launch: the object of every statement cmi5 defines. */
  activityId: string;
}

/** What the learner asked of the LMS beforehand (cmi5LearnerPreferences). The course reads it at the start, as cmi5 asks. */
export interface Cmi5Preferences {
  languages: string[];
  audio: "on" | "off" | null;
}

/** Is this the address of a cmi5 launch? It has the `fetch` address, which no other kind of launch has. */
export function isCmi5Launch(search: string): boolean {
  return new URLSearchParams(search).has("fetch");
}

/** An address the learner's answers or token may be sent to: https, or http on the learner's own computer. */
function trusted(raw: string | null): URL | null {
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  const own = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return url.protocol === "https:" || (url.protocol === "http:" && own) ? url : null;
}

/** The launch details in the address the course was opened with, or null if any is missing or cannot be trusted. */
export function readCmi5Launch(search: string): Cmi5Launch | null {
  const q = new URLSearchParams(search);
  const endpoint = trusted(q.get("endpoint"));
  const fetchUrl = trusted(q.get("fetch"));
  const registration = q.get("registration");
  const activityId = q.get("activityId");
  const rawActor = q.get("actor");
  if (!endpoint || !fetchUrl || !registration || !UUID.test(registration) || !activityId || !IRI.test(activityId) || !rawActor) return null;
  let actor: Record<string, unknown> | null;
  try { actor = normaliseActor(JSON.parse(rawActor)); } catch { return null; }
  if (!actor) return null;
  return { endpoint: endpoint.href.endsWith("/") ? endpoint.href : `${endpoint.href}/`, fetchUrl: fetchUrl.href, actor, registration: registration.toLowerCase(), activityId };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One request with a time limit, so a learning system that does not answer cannot hold the course closed. */
async function ask(fetchFn: FetchLike, url: string, init: Parameters<FetchLike>[1], ms = 6000): Promise<{ ok: boolean; status: number; body: string } | null> {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), ms);
  try {
    const res = await fetchFn(url, { ...init, signal: control.signal, credentials: "omit" });
    return { ok: res.ok, status: res.status, body: await res.text() };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The token from the LMS's fetch address, as an Authorization header value. Null when it was refused: a token can be had once. */
export async function fetchToken(launch: Cmi5Launch, fetchFn: FetchLike): Promise<string | null> {
  // POST, never GET: a token must not come out of a cache. Nothing is sent but the request; the address carries what the LMS needs.
  const res = await ask(fetchFn, launch.fetchUrl, { method: "POST", headers: {} });
  if (!res || res.status !== 200) return null;
  try {
    const answer: unknown = JSON.parse(res.body);
    const token = isObject(answer) ? answer["auth-token"] : undefined;
    return typeof token === "string" && token !== "" ? `Basic ${token}` : null;
  } catch {
    return null;
  }
}

const headers = (auth: string): Record<string, string> => ({ "X-Experience-API-Version": XAPI_VERSION, Authorization: auth });

/** The LMS.LaunchData document, checked, in the form the tracker needs. Null if it is missing or cannot be used. */
export async function readLaunchData(launch: Cmi5Launch, auth: string, fetchFn: FetchLike): Promise<Cmi5Session | null> {
  const q = new URLSearchParams({ stateId: LAUNCH_DATA_STATE, activityId: launch.activityId, agent: JSON.stringify(launch.actor), registration: launch.registration });
  const res = await ask(fetchFn, `${launch.endpoint}activities/state?${q.toString()}`, { method: "GET", headers: headers(auth) });
  if (!res || res.status !== 200) return null;
  let doc: unknown;
  try { doc = JSON.parse(res.body); } catch { return null; }
  if (!isObject(doc) || !isObject(doc["contextTemplate"])) return null;
  const template = doc["contextTemplate"];
  // The session id is how the LMS ties every statement to this launch. A document without it is not one the course can follow.
  const extensions = template["extensions"];
  if (!isObject(extensions) || typeof extensions[SESSION_ID_EXTENSION] !== "string") return null;
  const mode = doc["launchMode"];
  const mastery = doc["masteryScore"];
  const back = doc["returnURL"];
  return {
    contextTemplate: template,
    launchMode: mode === "Browse" || mode === "Review" ? mode : "Normal",
    masteryScore: typeof mastery === "number" && mastery >= 0 && mastery <= 1 ? mastery : null,
    returnURL: typeof back === "string" && trusted(back) ? back : null,
  };
}

/** The learner's preferences from the LMS, if it keeps them. Never fails: no answer means no preferences. */
export async function readPreferences(launch: Cmi5Launch, auth: string, fetchFn: FetchLike): Promise<Cmi5Preferences> {
  const none: Cmi5Preferences = { languages: [], audio: null };
  const q = new URLSearchParams({ profileId: PREFERENCES_PROFILE, agent: JSON.stringify(launch.actor) });
  const res = await ask(fetchFn, `${launch.endpoint}agents/profile?${q.toString()}`, { method: "GET", headers: headers(auth) }, 3000);
  if (!res || res.status !== 200) return none;
  try {
    const doc: unknown = JSON.parse(res.body);
    if (!isObject(doc)) return none;
    const lang = doc["languagePreference"];
    const audio = doc["audioPreference"];
    return {
      languages: typeof lang === "string" ? lang.split(",").map((l) => l.trim()).filter(Boolean) : [],
      audio: audio === "on" || audio === "off" ? audio : null,
    };
  } catch {
    return none;
  }
}

export interface Cmi5Started {
  launch: XapiLaunch;
  session: Cmi5Session;
  preferences: Cmi5Preferences;
}

/** Steps 2 and 3: the token, the launch data and the learner's preferences. Null if the LMS could not be reached or gave nothing usable. */
export async function startCmi5(launch: Cmi5Launch, fetchFn: FetchLike): Promise<Cmi5Started | null> {
  const auth = await fetchToken(launch, fetchFn);
  if (!auth) return null;
  const session = await readLaunchData(launch, auth, fetchFn);
  if (!session) return null;
  const preferences = await readPreferences(launch, auth, fetchFn);
  return { launch: { endpoint: launch.endpoint, auth, actor: launch.actor, registration: launch.registration, activityId: launch.activityId }, session, preferences };
}

/**
 * Connect the course to the LMS that launched it, the cmi5 way. Resolves to where to resume, or null to start from the beginning, and to null
 * for the whole when the LMS could not be reached (the course then runs untracked, as an xAPI course does with an LRS that is not there).
 */
export async function attachCmi5(win: Window, runtime: Runtime, launch: Cmi5Launch, io?: XapiIo): Promise<{ tracker: XapiTracker; resume: Snapshot | null; preferences: Cmi5Preferences } | null> {
  const fetchFn = io?.fetch ?? ((url, init) => fetch(url, init));
  const started = await startCmi5(launch, fetchFn);
  if (!started) return null;
  const { tracker, resume } = await attachXapi(win, runtime, started.launch, { ...io, fetch: fetchFn }, started.session);
  return { tracker, resume, preferences: started.preferences };
}

/** End the session and send the learner's window where the LMS asked (cmi5's returnURL). The last statements travel with the page (keepalive). */
export function exitCourse(win: Window, tracker: XapiTracker): void {
  const back = tracker.returnUrl;
  tracker.end();
  if (back) win.location.assign(back);
}
