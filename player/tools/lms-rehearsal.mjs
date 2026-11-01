// SPDX-License-Identifier: Apache-2.0
// A rehearsal for the real LMS test. It plays the published LMS test lesson (examples/lms-test-lesson.osproj) through the project's own
// stand-in systems in a real, headless Chromium, the way a learner would, and checks what each system ends up holding:
//
//   SCORM 1.2   the stand-in LMS page (_scorm-test.html)
//   SCORM 2004  the same page with ?lms=2004
//   xAPI        the stand-in LRS (stand-in-xapi.ts)
//
// The four required tests of LMS-TEST-PLAN.md are played on each: 1 launch, 2 a failing attempt (3 of 5, expect failed and 60), 3 a pass at the
// edge (question 1 wrong then right, question 5 wrong, expect passed and 80, and the certificate), 4 resume (stop on question 3, leave, come back,
// expect question 3, the answers kept and locked, the survey answers and the adaptive notes kept, and passed with 100).
//
// This tells you what a correct LMS should show. If the real LMS shows something else, the difference is the LMS's (or the way it was set up), not
// the lesson's. It does not replace the real test: a stand-in is written by the same people as the lesson.
//
// A developer check. It needs Playwright (PLAYWRIGHT_DIR; default /opt/node-tools/node_modules/playwright) and a published lesson:
//
//   node player/publish.ts examples/lms-test-lesson.osproj dist/lms-test-lesson --targets=scorm12,scorm2004,xapi
//   node player/tools/lms-rehearsal.mjs [--only=scorm12|scorm2004|xapi] [--report=FILE]
//
// Nothing is played aloud: the browser is started muted.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const dist = path.join(repo, "dist");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR ?? "/opt/node-tools/node_modules/playwright");

const argv = process.argv.slice(2);
const only = argv.find((a) => a.startsWith("--only="))?.slice(7);
const reportFile = argv.find((a) => a.startsWith("--report="))?.slice(9);
if (!existsSync(path.join(dist, "lms-test-lesson", "index.html"))) {
  console.error("The lesson is not published. Run: node player/publish.ts examples/lms-test-lesson.osproj dist/lms-test-lesson --targets=scorm12,scorm2004,xapi");
  process.exit(2);
}

// ---------------------------------------------------------------- the files, served the way a web server would

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".pdf": "application/pdf", ".txt": "text/plain", ".xml": "application/xml" };
const fileServer = createServer((req, res) => {
  const file = path.resolve(dist, "." + decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(dist + path.sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end("Not found"); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((ready) => fileServer.listen(0, "127.0.0.1", ready));
const fileBase = `http://127.0.0.1:${fileServer.address().port}`;

// ---------------------------------------------------------------- the stand-in LRS, a program of its own

const XAPI_PORT = 18765;
const LRS_PORT = 18766;
let lrsProcess = null;
async function startLrs() {
  lrsProcess = spawn(process.execPath, ["stand-in-xapi.ts", dist, "--course", "lms-test-lesson", "--port", String(XAPI_PORT), "--lrs-port", String(LRS_PORT)], { cwd: path.join(repo, "player"), stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((ready, fail) => {
    lrsProcess.stdout.on("data", (chunk) => String(chunk).includes("Stand-in LRS") && ready());
    lrsProcess.on("exit", () => fail(new Error("the stand-in LRS stopped")));
  });
}

// ---------------------------------------------------------------- a learner

const browser = await chromium.launch({ args: ["--no-sandbox", "--mute-audio"] });
const results = [];
let failures = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (ok, what) => { if (!ok) throw new Error(what); };
const same = (actual, expected, what) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${what}: expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
};

const RIGHT = { 1: "A group chat message", 2: "True", 3: "A private conversation, in person or on video", 4: "An email that summarizes the decision", 5: "Channel overload" };
const WRONG = { 1: "A long email to everyone", 2: "False", 3: "A message in the team chat", 4: "A phone call to each department", 5: "Channel scarcity" };

class Learner {
  constructor(page, kind) {
    this.page = page;
    this.kind = kind;
    this.frame = page.frameLocator("#course");
    this.problems = [];
    page.on("pageerror", (e) => this.problems.push(`page error: ${e.message}`));
    // "Permissions policy violation" is the browser objecting to something the embedded YouTube player asks for (slide 12). It comes and goes
    // with how fast that player loads, and it is not the lesson's.
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource|Permissions policy violation/.test(m.text()) && this.problems.push(`console error: ${m.text()}`));
  }
  static async open(kind) {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
    const url = kind === "scorm12" ? `${fileBase}/lms-test-lesson/_scorm-test.html`
      : kind === "scorm2004" ? `${fileBase}/lms-test-lesson/_scorm-test.html?lms=2004`
      : `http://127.0.0.1:${XAPI_PORT}/_xapi-test.html`;
    // Each standard keeps its learner data in the page's own storage, so every run starts with a clean browser.
    await page.goto(url);
    const learner = new Learner(page, kind);
    await learner.waitForSlide();
    return learner;
  }
  async waitForSlide() {
    await this.frame.locator("h1:visible, h2:visible").first().waitFor({ timeout: 15000 });
    await sleep(250);
  }
  async heading() {
    const h = (await this.frame.locator("h1:visible, h2:visible").first().textContent())?.trim() ?? "";
    if (process.env.TRACE) console.log("      at:", h.slice(0, 50));
    return h;
  }
  async next() {
    const button = this.frame.getByRole("button", { name: "Next", exact: true });
    // A slide that has to be finished first (a question not yet answered) switches Next off. Say where that happened rather than wait it out.
    for (let i = 0; i < 8 && !(await button.isEnabled()); i++) await sleep(250);
    if (!(await button.isEnabled())) throw new Error(`Next is switched off on "${await this.heading()}"`);
    await button.click();
    await sleep(250);
  }
  async back() { await this.frame.getByRole("button", { name: "Back", exact: true }).click(); await sleep(250); }
  async text() { return (await this.frame.locator("body").innerText()).replace(/\s+/g, " "); }
  async toHeading(starts, limit = 40) {
    for (let i = 0; i < limit; i++) {
      if ((await this.heading()).startsWith(starts)) return;
      await this.next();
    }
    throw new Error(`never reached a slide starting "${starts}"; stopped at "${await this.heading()}"`);
  }
  async toHeadingBack(starts, limit = 40) {
    for (let i = 0; i < limit; i++) {
      if ((await this.heading()).startsWith(starts)) return;
      await this.back();
    }
    throw new Error(`never reached (going back) a slide starting "${starts}"; stopped at "${await this.heading()}"`);
  }
  /** Wait until the slide's words include something (a feedback layer or a result shows a moment after the click). */
  async waitText(part, what) {
    let text = "";
    for (let i = 0; i < 24; i++) {
      text = await this.text();
      if (text.includes(part)) return text;
      await sleep(250);
    }
    throw new Error(`${what}: the slide never said "${part}"; it said: ${text.slice(0, 300)}`);
  }
  async toQuestion(n) { await this.toHeading(`Question ${n} of 5`); }
  async choose(label) { await this.frame.getByRole("radio", { name: label, exact: true }).check(); }
  async check() { await this.frame.getByRole("button", { name: "Check answer" }).click(); await sleep(300); }
  async answer(n, which) { await this.toQuestion(n); await this.choose((which === "right" ? RIGHT : WRONG)[n]); await this.check(); }
  async toEnd() { await this.toHeading("Summary"); await sleep(300); }
  async relaunch() { await this.page.locator("#relaunch").click(); await sleep(600); await this.waitForSlide(); }
  async reset() { await this.page.locator("#reset").click(); await sleep(600); await this.waitForSlide(); }
  /** What the LMS holds for SCORM, as the stand-in page shows it. */
  async scormData() {
    return this.page.locator("#data tr").evaluateAll((rows) => Object.fromEntries(rows.map((r) => [r.querySelector("th")?.textContent, r.querySelector("td")?.textContent])));
  }
  async lrs() { return JSON.parse(await (await this.page.request.get(`http://127.0.0.1:${XAPI_PORT}/_xapi-log.json`)).text()); }
  /** What the LMS holds right now, read until it shows what is wanted (the lesson commits a moment after it changes). */
  async waitFor(read, wanted, what) {
    let seen;
    for (let i = 0; i < 40; i++) {
      seen = await read();
      if (wanted(seen)) return seen;
      await sleep(250);
    }
    throw new Error(`${what}: never showed what was expected; last seen ${JSON.stringify(seen)}`);
  }
}

// What each standard calls the result.
const SUMMARY = {
  scorm12: (d) => ({ status: d["cmi.core.lesson_status"], score: d["cmi.core.score.raw"] ?? null, entry: d["cmi.core.entry"] }),
  scorm2004: (d) => ({ completion: d["cmi.completion_status"], success: d["cmi.success_status"], raw: d["cmi.score.raw"] ?? null, scaled: d["cmi.score.scaled"] ?? null, entry: d["cmi.entry"] }),
};
const xapiSummary = (log) => {
  const verbs = log.statements.map((s) => s.verb.id.split("/").pop());
  const counts = {};
  for (const v of verbs) counts[v] = (counts[v] ?? 0) + 1;
  const last = (verb) => [...log.statements].reverse().find((s) => s.verb.id.endsWith("/" + verb));
  return { verbs, counts, passed: last("passed")?.result ?? null, failed: last("failed")?.result ?? null, completed: last("completed")?.result ?? null };
};

/** The xAPI result in a line: how many statements of each verb, and the result the store was given. */
const brief = (s) => ({ statements: s.counts, result: s.passed ?? s.failed });

async function finalState(learner) {
  if (learner.kind === "xapi") return learner.waitFor(() => learner.lrs(), (l) => l.statements.some((s) => /\/(passed|failed)$/.test(s.verb.id)), "xAPI result");
  return learner.waitFor(() => learner.scormData(), (d) => ["passed", "failed"].includes(d["cmi.core.lesson_status"] ?? d["cmi.success_status"]), "result");
}

const scenarios = {
  async launch(kind) {
    const l = await Learner.open(kind);
    same(await l.heading(), "Choosing the Right Channel at Work", "the first slide");
    if (kind === "xapi") {
      const log = await l.waitFor(() => l.lrs(), (x) => x.statements.length > 0, "statements");
      assert(xapiSummary(log).verbs.includes("initialized"), "an 'initialized' statement is sent when the lesson opens");
    } else {
      const d = await l.waitFor(() => l.scormData(), (x) => SUMMARY[kind](x).entry !== undefined, "the first launch");
      same(SUMMARY[kind](d).entry, "ab-initio", "first launch is ab-initio");
    }
    same(l.problems, [], "errors in the page");
    return "opened on slide 1, entry ab-initio";
  },

  async fail(kind) {
    const l = await Learner.open(kind);
    await l.toHeading("A quick question first");
    await l.choose("Agree");
    await l.choose("In an office");
    await l.answer(1, "right"); await l.answer(2, "right"); await l.answer(3, "right"); await l.answer(4, "wrong"); await l.answer(5, "wrong");
    await l.toHeading("Your results");
    const text = await l.text();
    assert(text.includes("You scored 30 of 50 points (60%). You did not reach the pass mark."), "results sentence: " + text.slice(0, 300));
    await l.next();
    assert(!(await l.frame.getByRole("button", { name: "Make my certificate" }).count()), "no certificate for a failing score");
    await l.toEnd();
    const seen = await finalState(l);
    same(l.problems, [], "errors in the page");
    if (kind === "scorm12") { const s = SUMMARY.scorm12(seen); same([s.status, s.score], ["failed", "60"], "SCORM 1.2 result"); return s; }
    if (kind === "scorm2004") { const s = SUMMARY.scorm2004(seen); same([s.success, s.raw, s.scaled], ["failed", "60", "0.6"], "SCORM 2004 success and score"); same(s.completion, "completed", "SCORM 2004 completion (every slide seen)"); return s; }
    const s = xapiSummary(seen);
    assert(s.failed && s.failed.success === false && Math.abs(s.failed.score.scaled - 0.6) < 1e-9, "xAPI failed statement with scaled 0.6: " + JSON.stringify(s.failed));
    return brief(s);
  },

  async edge(kind) {
    const l = await Learner.open(kind);
    await l.toQuestion(1);
    await l.choose(WRONG[1]); await l.check();
    await l.waitText("Try again.", "a wrong first try on question 1 offers another try");
    await l.choose(RIGHT[1]); await l.check();
    await l.answer(2, "right"); await l.answer(3, "right"); await l.answer(4, "right"); await l.answer(5, "wrong");
    await l.toHeading("Your results");
    assert((await l.text()).includes("You scored 40 of 50 points (80%). You passed. Well done."), "results sentence");
    await l.next();
    await l.frame.getByRole("button", { name: "Make my certificate" }).click();
    assert((await l.text()).includes("Type your name first."), "an empty name is refused");
    await l.frame.getByRole("textbox").first().fill("Test Learner");
    await l.frame.getByRole("button", { name: "Make my certificate" }).click();
    const certificate = await l.text();
    assert(certificate.includes("Test Learner") && certificate.includes("Score: 80%"), "the certificate shows the name and the score");
    await l.toEnd();
    const seen = await finalState(l);
    same(l.problems, [], "errors in the page");
    if (kind === "scorm12") { const s = SUMMARY.scorm12(seen); same([s.status, s.score], ["passed", "80"], "SCORM 1.2 result"); return s; }
    if (kind === "scorm2004") { const s = SUMMARY.scorm2004(seen); same([s.success, s.raw, s.scaled, s.completion], ["passed", "80", "0.8", "completed"], "SCORM 2004 result"); return s; }
    const s = xapiSummary(seen);
    assert(s.passed && s.passed.success === true && Math.abs(s.passed.score.scaled - 0.8) < 1e-9, "xAPI passed statement with scaled 0.8: " + JSON.stringify(s.passed));
    return brief(s);
  },

  async resume(kind) {
    const l = await Learner.open(kind);
    await l.toHeading("A quick question first");
    await l.choose("Strongly disagree");
    await l.choose("Remotely");
    await l.toHeading("Four questions before you send");
    let text = await l.text();
    assert(text.includes("Extra help") && text.includes("Remote tip"), "both adaptive notes show on slide 9");
    await l.answer(1, "right"); await l.answer(2, "right");
    await l.toQuestion(3);
    await sleep(500);
    await l.relaunch();
    assert((await l.heading()).startsWith("Question 3 of 5"), "it opens on question 3, but opened on: " + (await l.heading()));
    if (kind !== "xapi") {
      const d = await l.waitFor(() => l.scormData(), (x) => SUMMARY[kind](x).entry === "resume", "entry mode after coming back");
      same(SUMMARY[kind](d).entry, "resume", "entry mode after coming back");
    } else {
      const log = await l.waitFor(() => l.lrs(), (x) => xapiSummary(x).verbs.includes("resumed"), "a 'resumed' statement");
      assert(xapiSummary(log).verbs.includes("suspended"), "a 'suspended' statement when the lesson was left");
    }
    await l.back();
    assert((await l.heading()).startsWith("Question 2 of 5"), "Back goes to question 2");
    assert(await l.frame.getByRole("radio", { name: "True", exact: true }).isChecked(), "question 2 shows the answer given");
    assert(await l.frame.getByRole("radio", { name: "True", exact: true }).isDisabled(), "question 2 is locked");
    await l.back();
    assert(await l.frame.getByRole("radio", { name: RIGHT[1], exact: true }).isChecked(), "question 1 shows the answer given");
    await l.toHeadingBack("Four questions before you send");
    text = await l.text();
    assert(text.includes("Extra help") && text.includes("Remote tip"), "both adaptive notes are still on slide 9");
    await l.toHeadingBack("A quick question first");
    assert(await l.frame.getByRole("radio", { name: "Strongly disagree", exact: true }).isChecked(), "survey answer 1 kept");
    assert(await l.frame.getByRole("radio", { name: "Remotely", exact: true }).isChecked(), "survey answer 2 kept");
    await l.answer(3, "right"); await l.answer(4, "right"); await l.answer(5, "right");
    await l.toHeading("Your results");
    assert((await l.text()).includes("You scored 50 of 50 points (100%). You passed. Well done."), "results after finishing");
    await l.toEnd();
    const seen = await finalState(l);
    same(l.problems, [], "errors in the page");
    if (kind === "scorm12") { const s = SUMMARY.scorm12(seen); same([s.status, s.score], ["passed", "100"], "SCORM 1.2 result"); return s; }
    if (kind === "scorm2004") { const s = SUMMARY.scorm2004(seen); same([s.success, s.raw, s.completion], ["passed", "100", "completed"], "SCORM 2004 result"); return s; }
    const s = xapiSummary(seen);
    assert(s.passed && s.passed.success === true && Math.abs(s.passed.score.scaled - 1) < 1e-9, "xAPI passed statement with scaled 1: " + JSON.stringify(s.passed));
    return brief(s);
  },
};

const NAMES = { launch: "1 Launch and look", fail: "2 A failing attempt (expect failed, 60)", edge: "3 Passing at the edge (expect passed, 80)", resume: "4 Resume (expect Question 3, passed 100)" };
const KINDS = [["scorm12", "SCORM 1.2"], ["scorm2004", "SCORM 2004"], ["xapi", "xAPI"]].filter(([k]) => !only || only === k);

if (KINDS.some(([k]) => k === "xapi")) await startLrs();

console.log("LMS rehearsal: the LMS test lesson in the project's stand-in systems\n");
for (const [kind, label] of KINDS) {
  for (const [name, run] of Object.entries(scenarios)) {
    if (process.env.ONLY_TEST && process.env.ONLY_TEST !== name) continue;
    let shown;
    try {
      const got = await run(kind);
      shown = typeof got === "string" ? got : JSON.stringify(got);
      console.log(`PASS  ${label}: ${NAMES[name]}\n      ${shown.length > 400 ? shown.slice(0, 400) + "..." : shown}`);
      results.push({ kind: label, test: NAMES[name], ok: true, got: shown });
    } catch (e) {
      failures += 1;
      console.log(`FAIL  ${label}: ${NAMES[name]}\n      ${e.message}`);
      results.push({ kind: label, test: NAMES[name], ok: false, got: e.message });
    }
    await browser.contexts().at(-1)?.pages().at(-1)?.close().catch(() => {});
    if (kind === "xapi") await fetch(`http://127.0.0.1:${XAPI_PORT}/_xapi-reset`, { method: "POST" }).catch(() => {});
  }
}

if (reportFile) {
  const lines = ["# Stand-in rehearsal of the LMS test lesson", "", `Run ${new Date().toISOString()}. Each row is what the project's stand-in system held at the end of the test.`, "", "| System | Test | Result | What it held |", "| --- | --- | --- | --- |"];
  for (const r of results) lines.push(`| ${r.kind} | ${r.test} | ${r.ok ? "passed" : "FAILED"} | ${r.got.replace(/\|/g, "/")} |`);
  writeFileSync(reportFile, lines.join("\n") + "\n");
}

await browser.close();
fileServer.close();
lrsProcess?.kill();
console.log(`\n${results.length - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
