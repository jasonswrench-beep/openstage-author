// Tests for cmi5: the launch address, the token, the launch data, and what the course sends, run against a strict stand-in learning system
// (fake-cmi5.ts). They cover the same release gates as the xAPI tests (a pass and a fail report the right score, completion and success are
// separate, a learner who leaves comes back to the place they were) and what is particular to cmi5: initialized first and terminated last,
// a duration where cmi5 asks for one, the LMS's context in every statement, the LMS's mastery score, browse and review launches, and the token
// staying out of sight.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { attachCmi5, exitCourse, fetchToken, isCmi5Launch, readCmi5Launch, readLaunchData, readPreferences, startCmi5 } from "./cmi5.ts";
import { FakeCmi5Lms } from "./fake-cmi5.ts";
import type { Runtime } from "./runtime.ts";
import { examplePackage, newRuntime } from "./test-helpers.ts";
import { CMI5_CATEGORY, CMI5_MOVEON } from "./xapi.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));

let warnings: string[] = [];
const realWarn = console.warn;
beforeEach(() => {
  warnings = [];
  console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
});
afterEach(() => { console.warn = realWarn; });

/** A window that holds nothing but where it was told to go. */
function fakeWindow() {
  const went: string[] = [];
  return { win: { addEventListener: () => undefined, location: { assign: (u: string) => went.push(u) } } as unknown as Window, went };
}

/** One launch of the course by the LMS. */
async function launch(lms: FakeCmi5Lms) {
  const { rt, log } = newRuntime();
  const { win, went } = fakeWindow();
  const launchDetails = readCmi5Launch(lms.address)!;
  const attached = await attachCmi5(win, rt, launchDetails, { fetch: lms.fetch, wait: async () => undefined });
  const resume = attached?.resume ?? null;
  if (!(resume && rt.restore(resume))) rt.goTo("slide-001");
  await tick();
  await attached?.tracker.settled();
  return { rt, log, attached, win, went };
}

async function settle(attached: Awaited<ReturnType<typeof launch>>["attached"]) {
  await tick();
  await attached!.tracker.settled();
}

function finishCourse(rt: Runtime, choice: string, times = 1) {
  rt.fire("obj-0004", "click");
  for (let i = 0; i < times; i++) rt.submitQuiz("obj-0011", choice, "click");
}

const verbs = (lms: FakeCmi5Lms) => lms.lrs.verbs();
const find = (lms: FakeCmi5Lms, verb: string) => lms.statements.find((s) => (s["verb"] as { id: string }).id.endsWith(`/${verb}`)) as Record<string, any> | undefined;

// ---- the launch address

test("the launch address gives the endpoint, the token address, the learner, the registration and the unit", () => {
  const lms = new FakeCmi5Lms();
  assert.ok(isCmi5Launch(lms.address));
  assert.deepEqual(readCmi5Launch(lms.address), { ...lms.launch });
  assert.equal(isCmi5Launch("?endpoint=x&actor=y"), false, "an xAPI launch has no fetch address");
});

test("a launch that is missing a part, or has one that cannot be trusted, is not used", () => {
  const lms = new FakeCmi5Lms();
  const q = (change: Record<string, string | null>) => {
    const p = new URLSearchParams(lms.address.slice(1));
    for (const [k, v] of Object.entries(change)) v === null ? p.delete(k) : p.set(k, v);
    return `?${p.toString()}`;
  };
  assert.equal(readCmi5Launch(q({ endpoint: null })), null);
  assert.equal(readCmi5Launch(q({ fetch: null })), null);
  assert.equal(readCmi5Launch(q({ registration: "not-a-uuid" })), null);
  assert.equal(readCmi5Launch(q({ activityId: "no scheme" })), null);
  assert.equal(readCmi5Launch(q({ actor: "not json" })), null);
  assert.equal(readCmi5Launch(q({ actor: '{"name":"x"}' })), null, "an actor with no way of being identified");
  assert.equal(readCmi5Launch(q({ endpoint: "http://lms.example.test/cmi5/" })), null, "plain http to another computer would send answers in the clear");
  assert.equal(readCmi5Launch(q({ fetch: "http://lms.example.test/token" })), null, "and so would the token's address");
  assert.ok(readCmi5Launch(q({ endpoint: "http://localhost:8080/cmi5/", fetch: "http://localhost:8080/token" })), "the learner's own computer is fine");
});

test("when the author listed hosts, a launch whose endpoint and token address are listed is used, and any other runs the course untracked", () => {
  const lms = new FakeCmi5Lms();
  const host = new URL(lms.launch.endpoint).hostname;
  const fetchHost = new URL(lms.launch.fetchUrl).hostname;
  const q = (change: Record<string, string>) => {
    const p = new URLSearchParams(lms.address.slice(1));
    for (const [k, v] of Object.entries(change)) p.set(k, v);
    return `?${p.toString()}`;
  };
  assert.deepEqual(readCmi5Launch(lms.address, [host, fetchHost]), { ...lms.launch }, "listed: used as it always was");
  assert.deepEqual(readCmi5Launch(lms.address, undefined), { ...lms.launch });
  assert.deepEqual(readCmi5Launch(lms.address, []), { ...lms.launch });
  assert.equal(warnings.length, 0);
  assert.equal(readCmi5Launch(lms.address, ["unrelated.example.org"]), null, "not listed: untracked");
  assert.ok(warnings.length >= 1 && warnings[0]!.includes(host), warnings.join(" | "));
  if (fetchHost !== host) assert.equal(readCmi5Launch(lms.address, [host]), null, "the place the token is asked for has to be listed too");
  assert.equal(readCmi5Launch(q({ endpoint: "https://elsewhere.example.org/cmi5/" }), [host, fetchHost]), null, "an endpoint at another host is refused even when the token's host is listed");
  assert.equal(readCmi5Launch(q({ fetch: "https://elsewhere.example.org/token" }), [host, fetchHost]), null, "and so is a token address at another host");
});

// ---- the token and the launch data

test("the token is asked for with a POST, used as Basic, and can be had once", async () => {
  const lms = new FakeCmi5Lms();
  const launchDetails = readCmi5Launch(lms.address)!;
  assert.equal(await fetchToken(launchDetails, lms.fetch), lms.lrs.auth);
  assert.deepEqual(lms.fetchCalls, ["POST"]);
  assert.equal(await fetchToken(launchDetails, lms.fetch), null, "the LMS answers 200 with an error body the second time");
});

test("the launch data is read and checked: context, mode, mastery score and where to go after", async () => {
  const lms = new FakeCmi5Lms({ launchMode: "Review", masteryScore: 0.65, returnURL: "https://lms.example.test/back?id=7" });
  const launchDetails = readCmi5Launch(lms.address)!;
  const session = await readLaunchData(launchDetails, lms.lrs.auth, lms.fetch);
  assert.equal(session?.launchMode, "Review");
  assert.equal(session?.masteryScore, 0.65);
  assert.equal(session?.returnURL, "https://lms.example.test/back?id=7");
  assert.ok((session?.contextTemplate["extensions"] as Record<string, string>)["https://w3id.org/xapi/cmi5/context/extensions/sessionid"]);
  const without = new FakeCmi5Lms({ masteryScore: null });
  assert.equal((await readLaunchData(readCmi5Launch(without.address)!, without.lrs.auth, without.fetch))?.masteryScore, null);
  const noSession = new FakeCmi5Lms({ noSessionId: true });
  assert.equal(await readLaunchData(readCmi5Launch(noSession.address)!, noSession.lrs.auth, noSession.fetch), null, "no session id, nothing to follow");
  assert.equal(await readLaunchData(launchDetails, "Basic wrong", lms.fetch), null, "a token the LMS did not give");
});

test("the learner's preferences are read when the LMS keeps them, and mean nothing when it does not", async () => {
  const lms = new FakeCmi5Lms();
  const launchDetails = readCmi5Launch(lms.address)!;
  assert.deepEqual(await readPreferences(launchDetails, lms.lrs.auth, lms.fetch), { languages: [], audio: null });
  lms.preferences = { languagePreference: "fr-FR, en-US", audioPreference: "off" };
  assert.deepEqual(await readPreferences(launchDetails, lms.lrs.auth, lms.fetch), { languages: ["fr-FR", "en-US"], audio: "off" });
});

test("an LMS that gives no token, or cannot be reached, means the course runs untracked", async () => {
  const lms = new FakeCmi5Lms();
  lms.tokenGiven = true;
  assert.equal(await startCmi5(readCmi5Launch(lms.address)!, lms.fetch), null);
  const down = new FakeCmi5Lms();
  down.lrs.down = true;
  assert.equal(await startCmi5(readCmi5Launch(down.address)!, async () => { throw new TypeError("network error"); }), null);
  const { attached, rt } = await launch(lms);
  assert.equal(attached, null);
  assert.equal(rt.currentSlide?.id, "slide-001", "the course still opens");
});

// ---- what the course sends

test("a pass: initialized, experienced, answered, completed, passed and terminated, every rule of cmi5 kept", async () => {
  const lms = new FakeCmi5Lms();
  const { rt, attached } = await launch(lms);
  finishCourse(rt, "c1");
  await settle(attached);
  attached!.tracker.end();
  await settle(attached);
  assert.deepEqual(lms.problems(), []);
  const v = verbs(lms);
  assert.equal(v[0], "initialized");
  assert.equal(v[v.length - 1], "terminated");
  for (const verb of ["experienced", "answered", "completed", "passed"]) assert.ok(v.includes(verb), `${verb} was sent: ${v.join(", ")}`);
  const passed = find(lms, "passed")!;
  assert.deepEqual(passed.result.score, { scaled: 1, raw: 100, min: 0, max: 100 });
  assert.equal(passed.object.id, lms.launch.activityId, "the object is the LMS's activity for this launch");
  assert.equal(find(lms, "completed")!.result.score, undefined, "cmi5 keeps the score for passed and failed");
});

test("a fail reports failed with success false, and never passed", async () => {
  const lms = new FakeCmi5Lms();
  const { rt, attached } = await launch(lms);
  finishCourse(rt, "c2", 2);
  await settle(attached);
  attached!.tracker.end();
  await settle(attached);
  assert.deepEqual(lms.problems(), []);
  assert.equal(find(lms, "failed")!.result.success, false);
  assert.equal(find(lms, "passed"), undefined);
  assert.ok(find(lms, "completed"), "completion and success stay separate: the learner finished");
});

test("the LMS's mastery score decides, not the course's own 80 percent", async () => {
  // A wrong answer is 0 percent. A mastery score of 0 is reached by it.
  const lms = new FakeCmi5Lms({ masteryScore: 0 });
  const { rt, attached } = await launch(lms);
  finishCourse(rt, "c2", 2);
  await settle(attached);
  attached!.tracker.end();
  await settle(attached);
  assert.deepEqual(lms.problems(), []);
  assert.ok(find(lms, "passed"));
  assert.equal(find(lms, "failed"), undefined);
  assert.equal(find(lms, "passed")!.context.extensions["https://w3id.org/xapi/cmi5/context/extensions/masteryscore"], 0);
});

test("with no mastery score from the LMS, the course's own pass mark decides", async () => {
  const lms = new FakeCmi5Lms({ masteryScore: null });
  const { rt, attached } = await launch(lms);
  finishCourse(rt, "c2", 2);
  await settle(attached);
  attached!.tracker.end();
  await settle(attached);
  assert.deepEqual(lms.problems(), []);
  assert.ok(find(lms, "failed"));
  assert.equal(find(lms, "failed")!.context.extensions?.["https://w3id.org/xapi/cmi5/context/extensions/masteryscore"], undefined);
});

test("leaving before the end sends terminated, never suspended, and nothing after it", async () => {
  const lms = new FakeCmi5Lms();
  const { rt, attached } = await launch(lms);
  rt.fire("obj-0004", "click");
  await settle(attached);
  attached!.tracker.end();
  attached!.tracker.end();
  await settle(attached);
  assert.deepEqual(lms.problems(), []);
  assert.equal(verbs(lms).filter((x) => x === "terminated").length, 1);
  assert.ok(!verbs(lms).includes("suspended"));
  assert.ok(!verbs(lms).includes("completed"));
  const before = lms.statements.length;
  rt.goTo("slide-001");
  await settle(attached);
  assert.equal(lms.statements.length, before, "nothing is sent once the session is over");
});

test("a statement the course sends between the first and the last carries the context but not the cmi5 category", async () => {
  const lms = new FakeCmi5Lms();
  const { rt, attached } = await launch(lms);
  rt.fire("obj-0004", "click");
  await settle(attached);
  const experienced = find(lms, "experienced")!;
  assert.ok(experienced.context.contextActivities.grouping.some((a: { id: string }) => a.id === lms.unitId));
  assert.ok(!experienced.context.contextActivities.category?.some((a: { id: string }) => a.id === CMI5_CATEGORY));
  assert.ok(!experienced.context.contextActivities.category?.some((a: { id: string }) => a.id === CMI5_MOVEON));
  assert.equal(experienced.context.registration, lms.launch.registration);
  attached!.tracker.end();
  await settle(attached);
});

test("a browse or a review launch sends initialized and terminated and nothing else", async () => {
  for (const mode of ["Browse", "Review"] as const) {
    const lms = new FakeCmi5Lms({ launchMode: mode });
    const { rt, attached } = await launch(lms);
    finishCourse(rt, "c1");
    await settle(attached);
    attached!.tracker.end();
    await settle(attached);
    assert.deepEqual(verbs(lms), ["initialized", "terminated"], mode);
    assert.deepEqual(lms.problems(), [], mode);
    assert.equal(lms.lrs.states.size, 1, `${mode}: no place was kept (only the launch data is there)`);
  }
});

test("a learner who leaves part-way comes back to the place they were, in a new session of the same registration", async () => {
  const lms = new FakeCmi5Lms();
  const first = await launch(lms);
  first.rt.fire("obj-0004", "click");
  await settle(first.attached);
  const slide = first.rt.currentSlide!.id;
  first.attached!.tracker.end();
  await settle(first.attached);
  assert.equal(slide, "slide-002");
  // A second launch: the LMS gives a new token and the same registration.
  lms.tokenGiven = false;
  const second = await launch(lms);
  assert.equal(second.rt.currentSlide?.id, slide);
  assert.ok(!verbs(lms).includes("resumed"), "cmi5 has no resumed");
  second.attached!.tracker.end();
  await settle(second.attached);
});

test("the token never appears in a statement, a warning or the stored state", async () => {
  const lms = new FakeCmi5Lms();
  const { rt, attached } = await launch(lms);
  finishCourse(rt, "c1");
  await settle(attached);
  attached!.tracker.end();
  await settle(attached);
  const everything = JSON.stringify([lms.statements, [...lms.lrs.states.values()], warnings]);
  assert.ok(!everything.includes("dGVzdC1sZWFybmVyOnNlY3JldA"), "the token stays in the Authorization header");
});

test("a returnURL sends the window there after the session ends, and without one nothing moves", async () => {
  const lms = new FakeCmi5Lms({ returnURL: "https://lms.example.test/back?id=7" });
  const { rt, attached, win, went } = await launch(lms);
  rt.fire("obj-0004", "click");
  await settle(attached);
  exitCourse(win, attached!.tracker);
  await settle(attached);
  assert.deepEqual(went, ["https://lms.example.test/back?id=7"]);
  assert.equal(verbs(lms).at(-1), "terminated", "the session ended first");

  const plain = new FakeCmi5Lms();
  const again = await launch(plain);
  assert.equal(again.attached!.tracker.returnUrl, null);
  exitCourse(again.win, again.attached!.tracker);
  assert.deepEqual(again.went, []);
});

test("a package's course is not told apart from an xAPI course by anything but the fetch address", () => {
  const project = examplePackage().project;
  assert.ok(project.meta.title.length > 0);
  assert.equal(isCmi5Launch(`?endpoint=${encodeURIComponent("https://lrs.example.test/xapi/")}&actor=%7B%7D`), false);
});
