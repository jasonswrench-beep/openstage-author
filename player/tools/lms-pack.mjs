// SPDX-License-Identifier: Apache-2.0
// Puts everything for the real LMS test in one folder, dist/lms-test-pack: the six packages (the LMS test lesson and the question-types course,
// each as SCORM 1.2, SCORM 2004 and xAPI), the start-here page, the test plans and the results sheet. It only copies; it does not publish.
//
//   node player/tools/lms-pack.mjs
//
// Publish first (PUBLISH LMS TEST LESSON.bat does all of it).

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = path.join(repo, "dist");
const pack = path.join(dist, "lms-test-pack");
const lesson = path.join(repo, "examples", "lms-test-lesson.osproj");
const types = path.join(repo, "examples", "question-types.osproj");

const files = [
  ...["lms-test-lesson", "question-types"].flatMap((name) => ["scorm12", "scorm2004", "xapi"].map((kind) => [path.join(dist, `${name}-${kind}.zip`), `${name}-${kind}.zip`])),
  [path.join(lesson, "LMS-START-HERE.md"), "LMS-START-HERE.md"],
  [path.join(lesson, "LMS-TEST-PLAN.md"), "LMS-TEST-PLAN.md"],
  [path.join(lesson, "LMS-RESULTS.md"), "LMS-RESULTS.md"],
  [path.join(types, "TEST-PLAN.md"), "QUESTION-TYPES-TEST-PLAN.md"],
];
const optional = [[path.join(dist, "lms-rehearsal-report.md"), "REHEARSAL-REPORT.md"]];

const missing = files.filter(([from]) => !existsSync(from)).map(([from]) => from);
if (missing.length > 0) {
  console.error(`Not everything is built yet. Missing:\n  ${missing.join("\n  ")}\nRun PUBLISH LMS TEST LESSON.bat first.`);
  process.exit(1);
}

mkdirSync(pack, { recursive: true });
// Only what this script puts there is replaced; anything else the author keeps in the folder stays.
for (const [, name] of [...files, ...optional]) rmSync(path.join(pack, name), { force: true });
for (const [from, name] of [...files, ...optional.filter(([from]) => existsSync(from))]) copyFileSync(from, path.join(pack, name));
console.log(`The LMS test pack is in ${pack}:`);
for (const name of readdirSync(pack).sort()) console.log(`  ${name}`);
