// Tests for SCORM 2004 tracking, run against a strict fake LMS (fake-lms-2004.ts). They cover the same release gates as the
// SCORM 1.2 tests (correct score for passing and failing attempts, exact resume), plus what 2004 adds: completion and success
// as two separate fields, a scaled score, progress, and the standard's own answer syntax.
import assert from "node:assert/strict";
import { test, beforeEach, afterEach } from "node:test";
import { FakeLms2004 } from "./fake-lms-2004.ts";
import { FakeLms } from "./fake-lms.ts";
import { Runtime } from "./runtime.ts";
import { decodeSuspend, encodeSuspend, SUSPEND_LIMIT } from "./scorm.ts";
import {
  attachScorm2004, progressMeasure, Scorm2004Tracker, sessionTime2004, SUSPEND_LIMIT_2004, timestamp2004,
} from "./scorm2004.ts";
import { evaluate } from "./scorm.ts";
import { newRuntime } from "./test-helpers.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));

let warnings: string[] = [];
const realWarn = console.warn;
beforeEach(() => {
  warnings = [];
  console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
});
afterEach(() => { console.warn = realWarn; });

/** One launch of the course in an LMS. */
function launch(lms: FakeLms2004) {
  lms.relaunch();
  const { rt, log } = newRuntime();
  const tracker = new Scorm2004Tracker(lms, rt);
  const resume = tracker.begin();
  if (!(resume && rt.restore(resume))) rt.goTo("slide-001");
  return { rt, log, tracker, resume };
}

function finishCourse(rt: Runtime, choice: string, times = 1) {
  rt.fire("obj-0004", "click"); // Continue to slide 2
  for (let i = 0; i < times; i++) rt.submitQuiz("obj-0011", choice, "click");
}

test("a passing attempt reports completed, passed, and a score of 100", async () => {
  const lms = new FakeLms2004();
  const { rt, tracker } = launch(lms);
  finishCourse(rt, "c1");
  await tick();
  assert.equal(lms.data["cmi.score.min"], "0");
  assert.equal(lms.data["cmi.score.max"], "100");
  assert.equal(lms.data["cmi.score.raw"], "100");
  assert.equal(lms.data["cmi.score.scaled"], "1");
  assert.equal(lms.data["cmi.completion_status"], "completed");
  assert.equal(lms.data["cmi.success_status"], "passed");
  assert.equal(lms.data["cmi.progress_measure"], "1");
  tracker.end();
  assert.equal(lms.data["cmi.exit"], "normal");
  assert.match(lms.data["cmi.session_time"] ?? "", /^PT\d+H\d+M[\d.]+S$/);
  assert.deepEqual(warnings, []);
});

test("a failing attempt is completed and failed: the two facts stay separate", async () => {
  const lms = new FakeLms2004();
  const { rt, tracker } = launch(lms);
  finishCourse(rt, "c2", 2); // both attempts wrong
  await tick();
  assert.equal(lms.data["cmi.score.raw"], "0");
  assert.equal(lms.data["cmi.score.scaled"], "0");
  assert.equal(lms.data["cmi.completion_status"], "completed", "SCORM 1.2 could only say failed; 2004 says completed as well");
  assert.equal(lms.data["cmi.success_status"], "failed");
  tracker.end();
  assert.equal(lms.data["cmi.exit"], "normal");
  assert.deepEqual(warnings, []);
});

test("a score and a result are not written before the course is complete", async () => {
  const lms = new FakeLms2004();
  const { rt } = launch(lms);
  rt.fire("obj-0004", "click"); // every slide seen, quiz not answered
  await tick();
  assert.equal(lms.data["cmi.completion_status"], "incomplete");
  assert.equal(lms.data["cmi.success_status"], "unknown");
  assert.equal(lms.data["cmi.score.raw"], undefined);
  assert.equal(lms.data["cmi.score.scaled"], undefined);
  assert.equal(lms.data["cmi.progress_measure"], "0.99", "all slides seen is not the same as complete");
  // The stand-in LMS works success_status out for itself, so read what the course actually sent.
  assert.ok(!lms.log.some((l) => /^set cmi\.(success_status|score\.)/.test(l)), "no result and no score are sent yet");
  assert.deepEqual(warnings, []);
});

test("the LMS's own reading of the pass mark agrees with the course's", async () => {
  for (const [choice, times, expected] of [["c1", 1, "passed"], ["c2", 2, "failed"]] as const) {
    const lms = new FakeLms2004(); // an LMS holding the manifest's 0.8 pass mark works success_status out for itself
    const { rt } = launch(lms);
    finishCourse(rt, choice, times);
    await tick();
    assert.equal(lms.data["cmi.success_status"], expected);
    assert.ok(lms.log.includes(`set cmi.success_status=${expected}`), "and the course said the same itself");
  }
});

test("the first launch starts at slide 1 and marks the course incomplete", () => {
  const lms = new FakeLms2004();
  const { rt, resume } = launch(lms);
  assert.equal(resume, null);
  assert.equal(rt.currentSlide?.id, "slide-001");
  assert.equal(lms.data["cmi.completion_status"], "incomplete");
});

test("a learner who leaves mid-course returns to the exact position with state intact", async () => {
  const lms = new FakeLms2004();
  const first = launch(lms);
  first.rt.fire("obj-0004", "click");
  first.rt.submitQuiz("obj-0011", "c2", "click"); // one wrong attempt, retry feedback showing
  await tick();
  first.tracker.end();

  assert.equal(lms.data["cmi.completion_status"], "incomplete");
  assert.equal(lms.data["cmi.exit"], "suspend");
  assert.equal(lms.data["cmi.location"], "slide-002");

  const second = launch(lms);
  assert.equal(lms.data["cmi.entry"], "resume");
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
  assert.equal(lms.data["cmi.success_status"], "passed");
  assert.equal(lms.data["cmi.score.raw"], "100");
  assert.deepEqual(warnings, []);
});

test("a finished course starts fresh on the next launch and its status is not reset", async () => {
  const lms = new FakeLms2004();
  const first = launch(lms);
  finishCourse(first.rt, "c1");
  await tick();
  first.tracker.end();

  const second = launch(lms);
  assert.equal(second.resume, null);
  assert.equal(second.rt.currentSlide?.id, "slide-001");
  assert.equal(lms.data["cmi.completion_status"], "completed");
  assert.equal(lms.data["cmi.success_status"], "passed");
});

test("each quiz answer is recorded as an interaction in SCORM 2004's form", async () => {
  const lms = new FakeLms2004();
  const { rt } = launch(lms);
  rt.fire("obj-0004", "click");
  rt.submitQuiz("obj-0011", "c3", "click");
  rt.submitQuiz("obj-0011", "c1", "keyActivate");
  await tick();
  assert.equal(lms.data["cmi.interactions.0.id"], "obj-0011");
  assert.equal(lms.data["cmi.interactions.0.type"], "choice");
  assert.equal(lms.data["cmi.interactions.0.learner_response"], "c");
  assert.equal(lms.data["cmi.interactions.0.result"], "incorrect");
  assert.match(lms.data["cmi.interactions.0.timestamp"] ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,2}Z$/);
  assert.equal(lms.data["cmi.interactions.1.learner_response"], "a");
  assert.equal(lms.data["cmi.interactions.1.result"], "correct");
  assert.equal(lms.data["cmi.interactions.1.correct_responses.0.pattern"], "a");
  assert.equal(lms.data["cmi.interactions.1.weighting"], "10");
  assert.deepEqual(warnings, []);
  // The id and the type are written before anything that depends on them.
  const sets = lms.log.filter((l) => l.startsWith("set cmi.interactions.0."));
  assert.ok(sets[0]!.startsWith("set cmi.interactions.0.id=") && sets[1]!.startsWith("set cmi.interactions.0.type="));
});

test("several changes from one click are written together", async () => {
  const lms = new FakeLms2004();
  const { rt } = launch(lms);
  lms.log.length = 0;
  rt.fire("obj-0004", "click");
  await tick();
  assert.equal(lms.log.filter((l) => l === "Commit").length, 1);
});

test("end() can be called twice but terminates once", () => {
  const lms = new FakeLms2004();
  const { tracker } = launch(lms);
  tracker.end();
  tracker.end();
  assert.equal(lms.log.filter((l) => l === "Terminate").length, 1);
});

test("browse and review modes write nothing and raise no warnings", async () => {
  const lms = new FakeLms2004();
  lms.mode = "review";
  const { rt, tracker } = launch(lms);
  finishCourse(rt, "c1");
  await tick();
  tracker.end();
  assert.ok(!lms.log.some((l) => l.startsWith("set ")));
  assert.deepEqual(warnings, []);
});

test("the API is found in a parent frame by its 2004 name, and its absence is not an error", () => {
  const api = new FakeLms2004();
  const top = { API_1484_11: api } as unknown as Window;
  (top as unknown as { parent: Window }).parent = top;
  const child = { parent: top, addEventListener: () => undefined } as unknown as Window;
  const attached = attachScorm2004(child, newRuntime().rt);
  assert.ok(attached);
  assert.equal(api.log[0], "Initialize");

  // A SCORM 1.2 API is not mistaken for it.
  const old = { API: new FakeLms() } as unknown as Window;
  (old as unknown as { parent: Window }).parent = old;
  assert.equal(attachScorm2004(old, newRuntime().rt), null);

  const alone = {} as unknown as Window;
  (alone as unknown as { parent: Window }).parent = alone;
  assert.equal(attachScorm2004(alone, newRuntime().rt), null);
});

test("suspend data may use 64000 characters: nothing is dropped that fits", () => {
  const { rt } = newRuntime();
  rt.goTo("slide-001");
  rt.submitQuiz("obj-0011", "c1", "click");
  const snap = rt.snapshot();
  for (let i = 0; i < 400; i++) snap.vars[`var-a-rather-long-variable-name-${i}`] = i;
  assert.ok(encodeSuspend(snap, SUSPEND_LIMIT).length <= SUSPEND_LIMIT, "1.2 still has to fit in 4096");
  const text = encodeSuspend(snap, SUSPEND_LIMIT_2004);
  assert.ok(text.length > SUSPEND_LIMIT && text.length <= SUSPEND_LIMIT_2004);
  const back = decodeSuspend(text);
  assert.equal(Object.keys(back?.vars ?? {}).length, 400, "the variables the 1.2 version would have dropped are kept");
  assert.deepEqual(back?.quiz, snap.quiz);
});

test("progress is a fraction of the slides seen, and 1 only when complete", () => {
  const { rt } = newRuntime();
  rt.goTo("slide-001");
  assert.equal(progressMeasure(rt, evaluate(rt)), 0.5);
  rt.fire("obj-0004", "click");
  assert.equal(progressMeasure(rt, evaluate(rt)), 0.99);
  rt.submitQuiz("obj-0011", "c1", "click");
  assert.equal(progressMeasure(rt, evaluate(rt)), 1);
});

test("session time and time stamps are formatted the way SCORM 2004 wants", () => {
  assert.equal(sessionTime2004(0), "PT0H0M0S");
  assert.equal(sessionTime2004(5230), "PT0H0M5.23S");
  assert.equal(sessionTime2004(5500), "PT0H0M5.5S");
  assert.equal(sessionTime2004(3_725_000), "PT1H2M5S");
  assert.equal(sessionTime2004(59_999), "PT0H1M0S", "rounding carries into the minute");
  assert.equal(timestamp2004(Date.UTC(2026, 9, 31, 12, 34, 56, 789)), "2026-10-31T12:34:56.78Z");
});

test("the fake LMS itself rejects what the standard rejects", () => {
  const lms = new FakeLms2004();
  assert.equal(lms.SetValue("cmi.completion_status", "completed"), "false");
  assert.equal(lms.GetLastError(), "132", "store before initialize");
  lms.Initialize("");
  assert.equal(lms.Initialize(""), "false");
  assert.equal(lms.GetLastError(), "103");
  assert.equal(lms.SetValue("cmi.completion_status", "finished"), "false");
  assert.equal(lms.GetLastError(), "406");
  assert.equal(lms.SetValue("cmi.score.scaled", "1.5"), "false");
  assert.equal(lms.GetLastError(), "407");
  assert.equal(lms.SetValue("cmi.suspend_data", "x".repeat(64001)), "false");
  assert.equal(lms.SetValue("cmi.session_time", "5 minutes"), "false");
  assert.equal(lms.SetValue("cmi.session_time", "PT"), "false");
  assert.equal(lms.SetValue("cmi.entry", "resume"), "false");
  assert.equal(lms.GetLastError(), "404");
  assert.equal(lms.SetValue("cmi.core.lesson_status", "passed"), "false");
  assert.equal(lms.GetLastError(), "401", "a SCORM 1.2 name is not in the 2004 data model");
  assert.equal(lms.GetValue("cmi.exit"), "");
  assert.equal(lms.GetLastError(), "405");
  // raw must lie between min and max
  lms.SetValue("cmi.score.min", "0");
  lms.SetValue("cmi.score.max", "100");
  assert.equal(lms.SetValue("cmi.score.raw", "101"), "false");
  assert.equal(lms.GetLastError(), "407");
  // an interaction needs its id, then its type, before its answer
  assert.equal(lms.SetValue("cmi.interactions.0.type", "choice"), "false");
  assert.equal(lms.GetLastError(), "408");
  assert.equal(lms.SetValue("cmi.interactions.0.id", "q1"), "true");
  assert.equal(lms.SetValue("cmi.interactions.0.learner_response", "a"), "false");
  assert.equal(lms.GetLastError(), "408");
  assert.equal(lms.SetValue("cmi.interactions.0.type", "true_false"), "true");
  assert.equal(lms.SetValue("cmi.interactions.0.learner_response", "a"), "false");
  assert.equal(lms.GetLastError(), "406");
  assert.equal(lms.SetValue("cmi.interactions.2.id", "skipped"), "false");
  assert.equal(lms.Terminate(""), "true");
  assert.equal(lms.Terminate(""), "false");
  assert.equal(lms.GetLastError(), "113");
});
