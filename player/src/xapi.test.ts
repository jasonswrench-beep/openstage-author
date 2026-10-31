// Tests for xAPI tracking, run against a strict stand-in LRS (fake-lrs.ts). They cover the same release gates as the SCORM
// tests (a passing and a failing attempt report the right score, completion and success are separate, a learner who leaves
// returns to the exact place) and what is particular to xAPI: the launch address, statements sent once and in order, a
// store that cannot be reached, and the credential staying out of sight.
import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { FakeLrs, statementProblem } from "./fake-lrs.ts";
import type { Runtime } from "./runtime.ts";
import { attachXapi, courseActivityId, normaliseActor, readLaunch, uuid4, XapiTracker, type XapiLaunch } from "./xapi.ts";
import { examplePackage, newRuntime } from "./test-helpers.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));

let warnings: string[] = [];
const realWarn = console.warn;
beforeEach(() => {
  warnings = [];
  console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
});
afterEach(() => { console.warn = realWarn; });

const ACTOR = { objectType: "Agent", name: "Test Learner", mbox: "mailto:learner@example.test" };
const REGISTRATION = "0b8c1e2a-5d3f-4a6b-9c7d-1e2f3a4b5c6d";

function launchFor(lrs: FakeLrs): XapiLaunch {
  return { endpoint: lrs.endpoint, auth: lrs.auth, actor: ACTOR, registration: REGISTRATION, activityId: courseActivityId(examplePackage().project.meta) };
}

/** One launch of the course against an LRS. */
async function launch(lrs: FakeLrs) {
  const { rt, log } = newRuntime();
  const tracker = new XapiTracker(launchFor(lrs), rt, { fetch: lrs.fetch, wait: async () => undefined });
  const resume = await tracker.begin();
  if (!(resume && rt.restore(resume))) rt.goTo("slide-001");
  await tick();
  await tracker.settled();
  return { rt, log, tracker, resume };
}

/** Let what the course has just done reach the LRS. */
async function settle(tracker: XapiTracker) {
  await tick();
  await tracker.settled();
}

function finishCourse(rt: Runtime, choice: string, times = 1) {
  rt.fire("obj-0004", "click"); // Continue to slide 2
  for (let i = 0; i < times; i++) rt.submitQuiz("obj-0011", choice, "click");
}

const result = (s: Record<string, unknown> | undefined) => (s?.["result"] ?? {}) as Record<string, unknown>;
const find = (lrs: FakeLrs, verb: string) => lrs.statements.find((s) => (s["verb"] as { id: string }).id.endsWith(`/${verb}`));

// ---- the launch address

test("the launch address gives the endpoint, the credential, the learner and the registration", () => {
  const project = examplePackage().project;
  const query = `?endpoint=${encodeURIComponent("https://lrs.example.test/xapi")}&auth=${encodeURIComponent("Basic abc")}&actor=${encodeURIComponent(JSON.stringify(ACTOR))}&registration=${REGISTRATION.toUpperCase()}`;
  const launch = readLaunch(query, project);
  assert.deepEqual(launch, {
    endpoint: "https://lrs.example.test/xapi/", auth: "Basic abc", actor: ACTOR, registration: REGISTRATION, activityId: courseActivityId(project.meta),
  });
  assert.equal(readLaunch(`${query}&activity_id=${encodeURIComponent("https://example.test/a")}`, project)?.activityId, "https://example.test/a");
});

test("a course opened without LRS details, or with ones that cannot be trusted, runs untracked", () => {
  const project = examplePackage().project;
  const actor = encodeURIComponent(JSON.stringify(ACTOR));
  assert.equal(readLaunch("", project), null);
  assert.equal(readLaunch(`?actor=${actor}`, project), null, "no endpoint");
  assert.equal(readLaunch(`?endpoint=${encodeURIComponent("https://lrs.example.test/xapi/")}`, project), null, "no actor");
  assert.equal(readLaunch(`?endpoint=${encodeURIComponent("http://lrs.example.test/xapi/")}&actor=${actor}`, project), null, "plain http to another computer would send answers in the clear");
  assert.equal(readLaunch(`?endpoint=${encodeURIComponent("javascript:alert(1)")}&actor=${actor}`, project), null);
  assert.equal(readLaunch(`?endpoint=${encodeURIComponent("https://lrs.example.test/")}&actor=not-json`, project), null);
  assert.equal(readLaunch(`?endpoint=${encodeURIComponent("https://lrs.example.test/")}&actor=${encodeURIComponent('{"name":"x"}')}`, project), null, "an actor with no way of being identified");
  assert.ok(readLaunch(`?endpoint=${encodeURIComponent("http://localhost:8080/xapi")}&actor=${actor}`, project), "http is fine on the learner's own computer");
  const bad = readLaunch(`?endpoint=${encodeURIComponent("https://lrs.example.test/")}&actor=${actor}&registration=nope`, project);
  assert.equal(bad?.registration, null, "a registration that is not a UUID is left out");
});

test("an actor in the older launch form, with each value in a list, is understood", () => {
  assert.deepEqual(normaliseActor({ name: ["Ann"], mbox: ["mailto:ann@example.test"] }), { objectType: "Agent", name: "Ann", mbox: "mailto:ann@example.test" });
  assert.deepEqual(normaliseActor({ account: [{ homePage: "https://x.test", name: "a1" }] }), { objectType: "Agent", account: { homePage: "https://x.test", name: "a1" } });
  assert.equal(normaliseActor(null), null);
});

test("the course's identifier is the same each time and changes with the title", () => {
  const meta = examplePackage().project.meta;
  assert.equal(courseActivityId(meta), courseActivityId({ ...meta }));
  assert.match(courseActivityId(meta), /^https:\/\/openstageauthor\.com\/xapi\/course\/[a-z0-9-]+-\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(courseActivityId(meta), courseActivityId({ ...meta, title: "Another course" }));
  assert.match(uuid4(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

// ---- the release gates

test("a passing attempt sends answered, completed and passed, with the score", async () => {
  const lrs = new FakeLrs();
  const { rt, tracker } = await launch(lrs);
  assert.deepEqual(lrs.verbs(), ["initialized", "experienced"]);
  finishCourse(rt, "c1");
  await settle(tracker);
  assert.deepEqual(lrs.verbs(), ["initialized", "experienced", "experienced", "answered", "completed", "passed"]);

  const answered = find(lrs, "answered")!;
  const def = (answered["object"] as { definition: Record<string, unknown> }).definition;
  assert.equal(def["interactionType"], "choice");
  assert.deepEqual(def["correctResponsesPattern"], ["a"]);
  assert.equal(result(answered)["response"], "a");
  assert.equal(result(answered)["success"], true);
  assert.deepEqual(result(answered)["score"], { scaled: 1, raw: 10, min: 0, max: 10 });

  const passed = find(lrs, "passed")!;
  assert.equal(result(passed)["success"], true);
  assert.deepEqual(result(passed)["score"], { scaled: 1, raw: 100, min: 0, max: 100 });
  assert.equal(result(find(lrs, "completed")!)["completion"], true);
  assert.ok(lrs.statements.every((s) => (s["context"] as { registration?: string }).registration === REGISTRATION));
  assert.ok(lrs.statements.every((s) => JSON.stringify(s["actor"]) === JSON.stringify(ACTOR)));
  assert.deepEqual(warnings, []);
});

test("a failing attempt is completed and failed: the two facts stay separate", async () => {
  const lrs = new FakeLrs();
  const { rt, tracker } = await launch(lrs);
  finishCourse(rt, "c2", 2);
  await settle(tracker);
  assert.deepEqual(lrs.verbs().slice(-4), ["answered", "answered", "completed", "failed"]);
  assert.equal(result(find(lrs, "failed")!)["success"], false);
  assert.deepEqual(result(find(lrs, "failed")!)["score"], { scaled: 0, raw: 0, min: 0, max: 100 });
  assert.equal(find(lrs, "passed"), undefined);
  assert.equal(result(lrs.statements.filter((s) => (s["verb"] as { id: string }).id.endsWith("/answered"))[0]!)["success"], false);
});

test("nothing about completion or the result is sent before the course is complete", async () => {
  const lrs = new FakeLrs();
  const { rt, tracker } = await launch(lrs);
  rt.fire("obj-0004", "click"); // every slide seen, quiz not answered
  await settle(tracker);
  assert.deepEqual(lrs.verbs(), ["initialized", "experienced", "experienced"]);
});

test("completed and the result are sent once, however much happens afterwards", async () => {
  const lrs = new FakeLrs();
  const { rt, tracker } = await launch(lrs);
  finishCourse(rt, "c1");
  await settle(tracker);
  rt.goTo("slide-001");
  rt.goTo("slide-002");
  await settle(tracker);
  assert.equal(lrs.verbs().filter((v) => v === "completed").length, 1);
  assert.equal(lrs.verbs().filter((v) => v === "passed").length, 1);
  assert.equal(new Set(lrs.statements.map((s) => s["id"])).size, lrs.statements.length, "no statement is sent twice");
});

test("a learner who leaves mid-course returns to the exact place with state intact", async () => {
  const lrs = new FakeLrs();
  const first = await launch(lrs);
  first.rt.fire("obj-0004", "click");
  first.rt.submitQuiz("obj-0011", "c2", "click"); // one wrong attempt, retry feedback showing
  await settle(first.tracker);
  first.tracker.end();
  await tick();
  assert.equal(lrs.verbs().at(-1), "suspended");
  assert.ok(lrs.requests.at(-1)!.keepalive || lrs.requests.slice(-2).some((r) => r.keepalive), "what is sent as the page goes is allowed to outlive it");
  const saved = JSON.parse([...lrs.states.values()][0]!) as { v: number; completed: boolean };
  assert.equal(saved.v, 1);
  assert.equal(saved.completed, false);

  const second = await launch(lrs);
  assert.ok(second.resume, "the saved place was found");
  assert.equal(second.rt.currentSlide?.id, "slide-002");
  assert.deepEqual([...second.rt.visibleLayers].sort(), ["layer-base", "layer-retry"]);
  assert.equal(second.rt.variables.get("var-answered"), true);
  assert.equal(second.rt.quiz.get("obj-0011")?.attempts, 1);
  assert.equal(second.rt.quiz.get("obj-0011")?.choice, "c2");
  assert.ok(second.rt.visited.has("slide-001"), "slides already seen stay seen");
  assert.ok(!second.log.some((l) => l.startsWith("layer ")), "resume does not replay layer changes");
  assert.ok(lrs.verbs().includes("resumed"));

  const out = second.rt.submitQuiz("obj-0011", "c1", "click");
  assert.equal(out?.attempts, 2);
  await settle(second.tracker);
  assert.equal(lrs.verbs().at(-1), "passed");
  assert.equal(result(find(lrs, "passed")!)["score"] !== undefined, true);
  assert.deepEqual(warnings, []);
});

test("a finished course starts from the beginning next time", async () => {
  const lrs = new FakeLrs();
  const first = await launch(lrs);
  finishCourse(first.rt, "c1");
  await settle(first.tracker);
  first.tracker.end();
  await tick();
  assert.equal(lrs.verbs().at(-1), "terminated");

  const second = await launch(lrs);
  assert.equal(second.resume, null);
  assert.equal(second.rt.currentSlide?.id, "slide-001");
});

test("a place saved with a different registration is not used", async () => {
  const lrs = new FakeLrs();
  const first = await launch(lrs);
  first.rt.fire("obj-0004", "click");
  await settle(first.tracker);
  first.tracker.end();
  await tick();

  const { rt } = newRuntime();
  const other = new XapiTracker({ ...launchFor(lrs), registration: "11111111-2222-4333-8444-555555555555" }, rt, { fetch: lrs.fetch, wait: async () => undefined });
  assert.equal(await other.begin(), null);
});

// ---- when the LRS misbehaves

test("an LRS that cannot be reached means an untracked start, not a stuck course", async () => {
  const lrs = new FakeLrs();
  lrs.down = true;
  const { rt, resume, tracker } = await launch(lrs);
  assert.equal(resume, null);
  assert.equal(rt.currentSlide?.id, "slide-001");
  await settle(tracker);
  assert.ok(warnings.some((w) => /could not be reached/.test(w)));
  assert.deepEqual(lrs.statements, []);
});

test("a busy LRS is tried again and each statement still arrives once", async () => {
  const lrs = new FakeLrs();
  const { rt, tracker } = await launch(lrs);
  lrs.failNext = { status: 503, count: 1 };
  finishCourse(rt, "c1");
  await settle(tracker);
  assert.deepEqual(lrs.verbs().slice(-3), ["answered", "completed", "passed"]);
  assert.equal(new Set(lrs.statements.map((s) => s["id"])).size, lrs.statements.length);
});

test("statements the LRS refuses are not sent again, and the credential is never in a message", async () => {
  const lrs = new FakeLrs();
  const { rt, tracker } = await launch(lrs);
  const before = lrs.requests.length;
  lrs.failNext = { status: 400, count: 5 };
  finishCourse(rt, "c1");
  await settle(tracker);
  const posts = lrs.requests.slice(before).filter((r) => r.method === "POST");
  assert.ok(posts.length >= 1 && posts.length <= 2, `refused statements are not retried (${posts.length} sends)`);
  assert.ok(warnings.some((w) => /answered 400/.test(w)));
  assert.ok(warnings.every((w) => !w.includes(lrs.auth) && !w.includes("dGVzdDp0ZXN0")));
});

// ---- the page's side

test("leaving the page sends the last statements, and a second leave sends nothing", async () => {
  const lrs = new FakeLrs();
  const { rt } = newRuntime();
  const handlers = new Map<string, () => void>();
  const win = { addEventListener: (name: string, fn: () => void) => handlers.set(name, fn) } as unknown as Window;
  const { tracker } = await attachXapi(win, rt, launchFor(lrs), { fetch: lrs.fetch, wait: async () => undefined });
  rt.goTo("slide-001");
  await settle(tracker);
  handlers.get("pagehide")!();
  handlers.get("beforeunload")!();
  await tick();
  assert.equal(lrs.verbs().filter((v) => v === "suspended").length, 1);
  assert.deepEqual([...handlers.keys()].sort(), ["beforeunload", "pagehide"]);
});

// ---- the stand-in LRS itself

test("the stand-in LRS refuses what the standard refuses", async () => {
  const lrs = new FakeLrs();
  const good = {
    id: "00000000-0000-4000-8000-000000000001", actor: ACTOR,
    verb: { id: "http://adlnet.gov/expapi/verbs/experienced", display: { "en-US": "experienced" } },
    object: { objectType: "Activity", id: "https://example.test/a" }, timestamp: "2026-10-31T12:00:00.000Z",
  };
  assert.equal(statementProblem(good), null);
  assert.match(statementProblem({ ...good, id: "nope" })!, /UUID/);
  assert.match(statementProblem({ ...good, actor: { ...ACTOR, openid: "https://x.test/me" } })!, /exactly one/);
  assert.match(statementProblem({ ...good, verb: { id: "experienced" } })!, /address/);
  assert.match(statementProblem({ ...good, extra: 1 })!, /unknown property/);
  assert.match(statementProblem({ ...good, result: { score: { scaled: 1.5 } } })!, /scaled/);
  assert.match(statementProblem({ ...good, result: { score: { raw: 120, min: 0, max: 100 } } })!, /above/);
  assert.match(statementProblem({ ...good, result: { duration: "5 minutes" } })!, /duration/);
  assert.match(statementProblem({ ...good, timestamp: "yesterday" })!, /timestamp/);
  assert.match(statementProblem({ ...good, verb: { id: "http://adlnet.gov/expapi/verbs/failed" }, result: { success: true } })!, /failed needs/);
  assert.match(statementProblem({ ...good, verb: { id: "http://adlnet.gov/expapi/verbs/answered" } })!, /answered needs/);

  const base = { method: "POST", headers: { "X-Experience-API-Version": "1.0.3", Authorization: lrs.auth, "Content-Type": "application/json" }, body: JSON.stringify(good) };
  assert.equal((await lrs.fetch(`${lrs.endpoint}statements`, base)).status, 200);
  assert.equal((await lrs.fetch(`${lrs.endpoint}statements`, base)).status, 200, "the same statement again is accepted and kept once");
  assert.equal(lrs.statements.length, 1);
  assert.equal((await lrs.fetch(`${lrs.endpoint}statements`, { ...base, body: JSON.stringify({ ...good, timestamp: "2026-10-31T13:00:00.000Z" }) })).status, 409);
  assert.equal((await lrs.fetch(`${lrs.endpoint}statements`, { ...base, headers: { ...base.headers, "X-Experience-API-Version": "0.9" } })).status, 400);
  assert.equal((await lrs.fetch(`${lrs.endpoint}statements`, { ...base, headers: { ...base.headers, Authorization: "Basic wrong" } })).status, 401);
  assert.equal((await lrs.fetch(`${lrs.endpoint}activities/state?stateId=x`, { method: "GET", headers: base.headers })).status, 400, "the State resource needs the activity and the agent");
});
