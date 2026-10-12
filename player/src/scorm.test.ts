// Tests for SCORM 1.2 tracking, run against a strict fake LMS. They cover the release
// gates that can be checked without an LMS: correct score for passing and failing
// attempts, completion kept apart from success, and exact resume.
import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { FakeLms } from "./fake-lms.ts";
import { Runtime } from "./runtime.ts";
import {
  attachTracker, decodeSuspend, encodeSuspend, evaluate, findApi, lessonStatus, sessionTime, slidesSeenEnough,
  SUSPEND_LIMIT, Tracker, type ScormApi,
} from "./scorm.ts";
import { examplePackage, newRuntime } from "./test-helpers.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));

let warnings: string[] = [];
const realWarn = console.warn;
beforeEach(() => {
  warnings = [];
  console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
});
afterEach(() => { console.warn = realWarn; });

/** One launch of the course in an LMS. */
function launch(lms: FakeLms) {
  lms.relaunch();
  const { rt, log } = newRuntime();
  const tracker = new Tracker(lms, rt);
  const resume = tracker.begin();
  if (!(resume && rt.restore(resume))) rt.goTo("slide-001");
  return { rt, log, tracker, resume };
}

function finishCourse(rt: Runtime, choice: string, times = 1) {
  rt.fire("obj-0004", "click"); // Continue to slide 2
  for (let i = 0; i < times; i++) rt.submitQuiz("obj-0011", choice, "click");
}

test("a passing attempt reports score 100 and status passed", async () => {
  const lms = new FakeLms();
  const { rt, tracker } = launch(lms);
  finishCourse(rt, "c1");
  await tick();
  assert.equal(lms.data["cmi.core.score.raw"], "100");
  assert.equal(lms.data["cmi.core.score.min"], "0");
  assert.equal(lms.data["cmi.core.score.max"], "100");
  assert.equal(lms.data["cmi.core.lesson_status"], "passed");
  tracker.end();
  assert.equal(lms.data["cmi.core.exit"], "");
  assert.match(lms.data["cmi.core.session_time"] ?? "", /^\d{4}:\d{2}:\d{2}\.\d{2}$/);
  assert.deepEqual(warnings, []);
});

test("a failing attempt reports score 0 and status failed", async () => {
  const lms = new FakeLms();
  const { rt, tracker } = launch(lms);
  finishCourse(rt, "c2", 2); // both attempts wrong
  await tick();
  assert.equal(lms.data["cmi.core.score.raw"], "0");
  assert.equal(lms.data["cmi.core.lesson_status"], "failed");
  tracker.end();
  assert.equal(lms.data["cmi.core.exit"], "");
  assert.deepEqual(warnings, []);
});

test("completion and success are separate facts", () => {
  const a = newRuntime().rt;
  a.goTo("slide-001");
  assert.deepEqual(evaluate(a), { completed: false, success: null, scorePercent: null });

  a.fire("obj-0004", "click"); // every slide seen, quiz not yet answered
  assert.deepEqual(evaluate(a), { completed: false, success: null, scorePercent: null });

  a.submitQuiz("obj-0011", "c2", "click");
  a.submitQuiz("obj-0011", "c3", "click"); // finished, and failed
  assert.deepEqual(evaluate(a), { completed: true, success: false, scorePercent: 0 });

  const b = newRuntime().rt;
  b.goTo("slide-001");
  b.fire("obj-0004", "click");
  b.submitQuiz("obj-0011", "c1", "click");
  assert.deepEqual(evaluate(b), { completed: true, success: true, scorePercent: 100 });
});

test("the author chooses whether completing means every slide or the last slide", () => {
  const arrive = (setting: "all" | "last" | undefined) => {
    const pkg = examplePackage();
    if (setting === undefined) delete (pkg.project as { completion?: unknown }).completion;
    else pkg.project.completion = { slides: setting };
    const { rt } = newRuntime(pkg);
    rt.goTo("slide-002"); // straight to the last slide, past slide 1, as a rule that skips ahead would
    return rt;
  };
  assert.equal(slidesSeenEnough(arrive("all")), false, "every slide: slide 1 was never seen");
  assert.equal(slidesSeenEnough(arrive("last")), true, "last slide: it was reached");
  assert.equal(slidesSeenEnough(arrive(undefined)), false, "a course with no setting counts every slide, as before");

  const skipper = arrive("last");
  assert.deepEqual(evaluate(skipper), { completed: false, success: null, scorePercent: null }, "the quiz still has to be finished");
  skipper.submitQuiz("obj-0011", "c1", "click");
  assert.deepEqual(evaluate(skipper), { completed: true, success: true, scorePercent: 100 });

  const stayer = arrive("all");
  stayer.submitQuiz("obj-0011", "c1", "click");
  assert.deepEqual(evaluate(stayer), { completed: false, success: true, scorePercent: 100 }, "passed, but slide 1 was skipped, so not complete");
});

test("reaching the last slide means the last in the course, not just any later one", () => {
  const pkg = examplePackage();
  pkg.project.completion = { slides: "last" };
  const { rt } = newRuntime(pkg);
  rt.goTo("slide-001");
  assert.equal(slidesSeenEnough(rt), false, "on the first of two slides, the last has not been reached");
});

test("lesson_status never moves backwards", () => {
  const unfinished = { completed: false, success: null, scorePercent: null };
  assert.equal(lessonStatus(unfinished, "not attempted"), "incomplete");
  assert.equal(lessonStatus(unfinished, "passed"), "passed");
  assert.equal(lessonStatus(unfinished, "failed"), "failed");
  assert.equal(lessonStatus({ completed: true, success: null, scorePercent: null }, "incomplete"), "completed");
});

test("the first launch starts at slide 1 and marks the course incomplete", () => {
  const lms = new FakeLms();
  const { rt, resume } = launch(lms);
  assert.equal(resume, null);
  assert.equal(rt.currentSlide?.id, "slide-001");
  assert.equal(lms.data["cmi.core.lesson_status"], "incomplete");
});

test("a learner who leaves mid-course returns to the exact position with state intact", async () => {
  const lms = new FakeLms();
  const first = launch(lms);
  first.rt.fire("obj-0004", "click");
  first.rt.submitQuiz("obj-0011", "c2", "click"); // one wrong attempt, retry feedback showing
  await tick();
  first.tracker.end();

  assert.equal(lms.data["cmi.core.lesson_status"], "incomplete");
  assert.equal(lms.data["cmi.core.exit"], "suspend");
  assert.equal(lms.data["cmi.core.lesson_location"], "slide-002");

  const second = launch(lms);
  assert.equal(lms.data["cmi.core.entry"], "resume");
  assert.equal(second.rt.currentSlide?.id, "slide-002");
  assert.deepEqual([...second.rt.visibleLayers].sort(), ["layer-base", "layer-retry"]);
  assert.equal(second.rt.variables.get("var-answered"), true);
  assert.equal(second.rt.quiz.get("obj-0011")?.attempts, 1);
  assert.equal(second.rt.quiz.get("obj-0011")?.choice, "c2");
  assert.ok(second.rt.visited.has("slide-001"), "slides already seen stay seen");
  assert.ok(!second.log.some((l) => l.startsWith("layer ")), "resume does not replay layer changes");

  // The learner carries on and passes. The earlier wrong attempt still counts.
  const out = second.rt.submitQuiz("obj-0011", "c1", "click");
  assert.equal(out?.attempts, 2);
  await tick();
  assert.equal(lms.data["cmi.core.lesson_status"], "passed");
  assert.equal(lms.data["cmi.core.score.raw"], "100");
  assert.deepEqual(warnings, []);
});

test("resuming does not run the slide's start triggers again", () => {
  const lms = new FakeLms();
  const a = launch(lms);
  a.rt.fire("obj-0004", "click");
  a.tracker.flush();
  a.tracker.end();

  const b = newRuntime();
  b.pkg.slides[1]!.baseLayer.objects[0]!.triggers.push(
    { id: "trg-start", event: "slideStart", action: "setVariable", target: "var-attempts", value: 99, conditions: [] },
  );
  lms.relaunch();
  const tracker = new Tracker(lms, b.rt);
  const snap = tracker.begin();
  assert.ok(snap);
  b.rt.restore(snap);
  assert.equal(b.rt.variables.get("var-attempts"), 0);
});

test("a finished course starts fresh on the next launch", async () => {
  const lms = new FakeLms();
  const first = launch(lms);
  finishCourse(first.rt, "c1");
  await tick();
  first.tracker.end();

  const second = launch(lms);
  assert.equal(second.resume, null);
  assert.equal(second.rt.currentSlide?.id, "slide-001");
  assert.equal(lms.data["cmi.core.lesson_status"], "passed", "a finished status is not reset");
});

test("each quiz answer is recorded as an interaction", async () => {
  const lms = new FakeLms();
  const { rt } = launch(lms);
  rt.fire("obj-0004", "click");
  rt.submitQuiz("obj-0011", "c3", "click");
  rt.submitQuiz("obj-0011", "c1", "keyActivate");
  await tick();
  assert.equal(lms.data["cmi.interactions.0.id"], "obj-0011");
  assert.equal(lms.data["cmi.interactions.0.type"], "choice");
  assert.equal(lms.data["cmi.interactions.0.student_response"], "c");
  assert.equal(lms.data["cmi.interactions.0.result"], "wrong");
  assert.equal(lms.data["cmi.interactions.1.student_response"], "a");
  assert.equal(lms.data["cmi.interactions.1.result"], "correct");
  assert.equal(lms.data["cmi.interactions.1.correct_responses.0.pattern"], "a");
  assert.equal(lms.data["cmi.interactions.1.weighting"], "10");
  assert.deepEqual(warnings, []);
});

test("several changes from one click are written together", async () => {
  const lms = new FakeLms();
  const { rt } = launch(lms);
  lms.log.length = 0;
  rt.fire("obj-0004", "click");
  await tick();
  assert.equal(lms.log.filter((l) => l === "LMSCommit").length, 1);
});

test("end() can be called twice but finishes once", () => {
  const lms = new FakeLms();
  const { tracker } = launch(lms);
  tracker.end();
  tracker.end();
  assert.equal(lms.log.filter((l) => l === "LMSFinish").length, 1);
});

test("browse and review modes write nothing and raise no warnings", async () => {
  const lms = new FakeLms();
  lms.mode = "review";
  const { rt, tracker } = launch(lms);
  finishCourse(rt, "c1");
  await tick();
  tracker.end();
  assert.ok(!lms.log.some((l) => l.startsWith("set ")));
  assert.deepEqual(warnings, []);
});

test("the API is found in a parent frame, and its absence is not an error", () => {
  const api = new FakeLms();
  const top = { API: api } as unknown as Window;
  (top as unknown as { parent: Window }).parent = top;
  const child = { parent: top } as unknown as Window;
  assert.equal(findApi(child), api as ScormApi);

  const alone = {} as unknown as Window;
  (alone as unknown as { parent: Window }).parent = alone;
  assert.equal(findApi(alone), null);
  assert.equal(attachTracker(alone, newRuntime().rt), null);
});

test("suspend data stays within SCORM 1.2's limit and keeps quiz results", () => {
  const { rt } = newRuntime();
  rt.goTo("slide-001");
  rt.submitQuiz("obj-0011", "c1", "click");
  const snap = rt.snapshot();
  for (let i = 0; i < 400; i++) snap.vars[`var-a-rather-long-variable-name-${i}`] = i;
  const text = encodeSuspend(snap);
  assert.ok(text.length <= SUSPEND_LIMIT);
  const back = decodeSuspend(text);
  assert.equal(back?.slide, "slide-001");
  assert.deepEqual(back?.quiz, snap.quiz);
});

test("suspend data round-trips and rejects junk", () => {
  const { rt } = newRuntime();
  rt.goTo("slide-001");
  const snap = rt.snapshot();
  assert.deepEqual(decodeSuspend(encodeSuspend(snap)), snap);
  assert.equal(decodeSuspend(""), null);
  assert.equal(decodeSuspend("not json"), null);
  assert.equal(decodeSuspend('{"v":2,"s":"x"}'), null);
});

test("restoring tolerates a course that has changed since", () => {
  const { rt } = newRuntime();
  assert.equal(rt.restore({ slide: "slide-gone", vars: {}, quiz: {}, layers: [], visited: "" }), false);
  assert.equal(
    rt.restore({ slide: "slide-002", vars: { "var-gone": 1 }, quiz: { "obj-gone": [1, 1, "c", 10, "c1"] }, layers: ["layer-gone"], visited: "1" }),
    true,
  );
  assert.deepEqual([...rt.visibleLayers], ["layer-base"]);
  assert.equal(rt.quiz.size, 0);
});

test("session time is formatted the way SCORM 1.2 wants", () => {
  assert.equal(sessionTime(0), "0000:00:00.00");
  assert.equal(sessionTime(5230), "0000:00:05.23");
  assert.equal(sessionTime(3_725_000), "0001:02:05.00");
});

test("the fake LMS itself rejects what the standard rejects", () => {
  const lms = new FakeLms();
  assert.equal(lms.LMSSetValue("cmi.core.lesson_status", "passed"), "false");
  assert.equal(lms.LMSGetLastError(), "301");
  lms.LMSInitialize("");
  assert.equal(lms.LMSSetValue("cmi.core.lesson_status", "finished"), "false");
  assert.equal(lms.LMSGetLastError(), "405");
  assert.equal(lms.LMSSetValue("cmi.suspend_data", "x".repeat(4097)), "false");
  assert.equal(lms.LMSSetValue("cmi.core.score.raw", "101"), "false");
  assert.equal(lms.LMSSetValue("cmi.core.session_time", "5 minutes"), "false");
  assert.equal(lms.LMSSetValue("cmi.core.entry", "resume"), "false");
  assert.equal(lms.LMSGetLastError(), "403");
});
