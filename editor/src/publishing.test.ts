import assert from "node:assert/strict";
import { test } from "node:test";
import type { Finding } from "./backend.ts";
import { defaultPublishFolder, failureText, fileName, lengthWords, narrationLine, parentFolder, parsePublishResult, problemCounts, problemLine, publishSummary, type PublishResult } from "./publishing.ts";

const finding = (severity: "error" | "warning", message = "m", object_id = "obj-0001", detail = ""): Finding => ({ severity, file: "slides/slide-001.json", object_id, rule: "r", message, detail });

test("the tool's answer is read, with a missing problem list taken as empty", () => {
  const r = parsePublishResult('{"ok":true,"preview":false,"slides":2,"zip":"C:\\\\out\\\\course-scorm12.zip","findings":[]}');
  assert.equal(r.ok, true);
  assert.equal(r.slides, 2);
  assert.equal(r.zip, "C:\\out\\course-scorm12.zip");
  assert.deepEqual(parsePublishResult('{"ok":false,"message":"no"}').findings, []);
  assert.deepEqual(parsePublishResult('{"ok":false,"cancelled":true,"message":"x","findings":"nonsense"}').findings, []);
});

test("an answer that is not the tool's is refused with a plain message", () => {
  for (const bad of ["", "not json", "[]", "null", '{"slides":2}', '{"ok":"yes"}']) {
    assert.throws(() => parsePublishResult(bad), /could not be read/, bad);
  }
});

test("errors and warnings are counted apart", () => {
  assert.deepEqual(problemCounts([]), { errors: 0, warnings: 0 });
  assert.deepEqual(problemCounts([finding("error"), finding("warning"), finding("warning")]), { errors: 1, warnings: 2 });
});

test("narration without audio is explained by why it has none", () => {
  assert.equal(narrationLine(undefined), null);
  assert.equal(narrationLine({ objects: 0, withAudio: 0, engine: "none" }), null, "nothing is narrated");
  assert.equal(narrationLine({ objects: 5, withAudio: 5, engine: "none" }), null, "audio from an earlier run is enough");
  assert.equal(narrationLine({ objects: 5, withAudio: 2, engine: "none" }), "3 narrated objects have a transcript but no audio, because no speech engine is set up on this computer.");
  assert.equal(narrationLine({ objects: 1, withAudio: 0, engine: "failed" }), "1 narrated object has a transcript but no audio, because the speech engine did not work this time.");
  assert.equal(narrationLine({ objects: 4, withAudio: 1, engine: "skipped" }), "3 narrated objects have a transcript but no audio yet, because a preview does not make audio.");
  assert.equal(narrationLine({ objects: 4, withAudio: 1, engine: "ready" }), "3 narrated objects have a transcript but no audio.");
});

test("why it did not work is plain, and a cancel says the output is unfinished", () => {
  assert.match(failureText({ ok: false, cancelled: true, findings: [] }), /cancelled.*publish again/i);
  assert.equal(failureText({ ok: false, message: "  The problem check found 2 errors.  ", findings: [] }), "The problem check found 2 errors.");
  assert.match(failureText({ ok: false, findings: [] }), /gave no reason/);
});

test("a publish that worked is summed up in sentences", () => {
  const worked: PublishResult = {
    ok: true, slides: 12, zip: "C:\\Courses\\Published courses\\intro-scorm12.zip", outDir: "C:\\Courses\\Published courses\\intro",
    findings: [finding("warning"), finding("warning")], narration: { objects: 4, withAudio: 0, engine: "none" },
  };
  assert.deepEqual(publishSummary(worked), [
    "Published 12 slides.",
    "The package to upload to your LMS is intro-scorm12.zip.",
    "The same course as web files is in the folder intro.",
    "4 narrated objects have a transcript but no audio, because no speech engine is set up on this computer.",
    "2 warnings are listed in the Problems panel. They did not stop publishing.",
  ]);
  assert.deepEqual(publishSummary({ ok: true, slides: 1, zip: "/c/a-scorm12.zip", findings: [finding("warning")] }), [
    "Published 1 slide.",
    "The package to upload to your LMS is a-scorm12.zip.",
    "1 warning is listed in the Problems panel. It did not stop publishing.",
  ]);
});

test("a publish that made several packages names each one and says to upload the one the system asks for", () => {
  const dir = "C:\\Courses\\Published courses\\";
  assert.deepEqual(publishSummary({
    ok: true, slides: 3, zip: `${dir}intro-scorm12.zip`, findings: [],
    zips: { scorm12: `${dir}intro-scorm12.zip`, scorm2004: `${dir}intro-scorm2004.zip`, xapi: `${dir}intro-xapi.zip` },
  }), [
    "Published 3 slides.",
    "The packages are intro-scorm12.zip (SCORM 1.2), intro-scorm2004.zip (SCORM 2004) and intro-xapi.zip (xAPI). Upload the one your LMS or learning record store asks for.",
  ]);
  // Two kinds, in the same fixed order whatever order the tool listed them in.
  assert.match(publishSummary({ ok: true, findings: [], zips: { xapi: "/a/x-xapi.zip", scorm2004: "/a/x-scorm2004.zip" } })[1]!, /^The packages are x-scorm2004\.zip \(SCORM 2004\) and x-xapi\.zip \(xAPI\)\./);
  // One kind is said the old way, and a result from before the packages were several still reads as before.
  assert.equal(publishSummary({ ok: true, findings: [], zip: "/a/x-xapi.zip", zips: { xapi: "/a/x-xapi.zip" } })[1], "The package to upload to your LMS is x-xapi.zip.");
});

test("a publish that made the Word copy says what is in it, and one that did not says nothing", () => {
  const dir = "C:\\Courses\\Published courses\\";
  const lines = publishSummary({ ok: true, slides: 2, zip: `${dir}intro-scorm12.zip`, outDir: `${dir}intro`, review: `${dir}intro-review.docx`, findings: [] });
  assert.deepEqual(lines, [
    "Published 2 slides.",
    "The package to upload to your LMS is intro-scorm12.zip.",
    "The same course as web files is in the folder intro.",
    "A Word copy for colleagues and accessibility reviewers is intro-review.docx. It holds the slide text, alt text, narration scripts, quiz answers and the problems the checker found.",
  ]);
  for (const review of [null, undefined]) {
    assert.ok(!publishSummary({ ok: true, slides: 2, zip: `${dir}intro-scorm12.zip`, review, findings: [] }).some((l) => l.includes("Word")));
  }
  assert.equal(parsePublishResult('{"ok":true,"review":"C:\\\\out\\\\x-review.docx","findings":[]}').review, "C:\\out\\x-review.docx");
});

test("a length of time is said the way a person says it", () => {
  assert.equal(lengthWords(0), "0 seconds");
  assert.equal(lengthWords(1), "1 second");
  assert.equal(lengthWords(45.4), "45 seconds");
  assert.equal(lengthWords(60), "1 minute");
  assert.equal(lengthWords(284.1), "4 minutes 44 seconds");
  assert.equal(lengthWords(3601), "60 minutes 1 second");
});

test("a publish that made a video names it and its captions, and says what a video cannot do", () => {
  const dir = "C:\\Courses\\Published courses\\";
  const lines = publishSummary({
    ok: true, slides: 2, zip: `${dir}intro-scorm12.zip`, findings: [],
    video: { file: `${dir}intro.mp4`, captions: `${dir}intro.vtt`, seconds: 284.1, slides: 2, pictures: 9, notes: ["Slide 2: a question or other activity is shown as it is when the slide opens. A video cannot be answered."] },
  });
  assert.deepEqual(lines.slice(2), [
    "A video of the course is intro.mp4, 4 minutes 44 seconds long. Its captions are in intro.vtt. Keep the two files in one folder and most video players will show them.",
    "Slide 2: a question or other activity is shown as it is when the slide opens. A video cannot be answered.",
  ]);
  const silent = publishSummary({ ok: true, slides: 1, zip: `${dir}a-scorm12.zip`, findings: [], video: { file: `${dir}a.mp4`, captions: null, seconds: 5, slides: 1, pictures: 1, notes: [] } });
  assert.equal(silent[2], "A video of the course is a.mp4, 5 seconds long.");
  assert.equal(silent.length, 3);
});

test("a video that could not be made is said, with the reason, and the rest is still reported as published", () => {
  const lines = publishSummary({ ok: true, slides: 2, zip: "/c/a-scorm12.zip", findings: [], video: null, videoError: "A browser to take the pictures with was not found." });
  assert.ok(lines.includes("The video could not be made: A browser to take the pictures with was not found. The rest was published."));
  assert.ok(!publishSummary({ ok: true, slides: 2, zip: "/c/a-scorm12.zip", findings: [], video: null }).some((l) => l.includes("video")), "a publish that did not ask for one says nothing of video");
  assert.equal(parsePublishResult('{"ok":true,"video":{"file":"C:\\\\o\\\\x.mp4","captions":null,"seconds":3,"slides":1,"pictures":1,"notes":[]},"findings":[]}').video?.file, "C:\\o\\x.mp4");
});

test("a problem is described by where it is, then what is wrong", () => {
  assert.equal(problemLine(finding("error", "Object needs alt text", "obj-0007", "Describe it.")), "obj-0007: Object needs alt text Describe it.");
  assert.equal(problemLine(finding("error", "Slide file missing", "-")), "Slide file missing");
  assert.equal(problemLine(finding("error", "Bad", "")), "Bad");
});

test("file and folder names come out of Windows and other paths", () => {
  assert.equal(fileName("C:\\Courses\\Published courses\\intro-scorm12.zip"), "intro-scorm12.zip");
  assert.equal(fileName("/home/me/intro.osproj/"), "intro.osproj");
  assert.equal(fileName("plain"), "plain");
  assert.equal(parentFolder("C:\\Courses\\intro.osproj"), "C:\\Courses");
  assert.equal(parentFolder("C:\\Courses\\intro.osproj\\"), "C:\\Courses");
  assert.equal(parentFolder("D:\\intro.osproj"), "D:\\", "the top of a drive keeps its separator");
  assert.equal(parentFolder("/home/me/intro"), "/home/me");
  assert.equal(parentFolder("intro"), "intro", "nothing to go up to");
});

test("courses go in a Published courses folder beside the project unless the author chooses", () => {
  assert.equal(defaultPublishFolder("C:\\Users\\Jo\\Courses\\Stats.osproj"), "C:\\Users\\Jo\\Courses\\Published courses");
  assert.equal(defaultPublishFolder("D:\\Stats.osproj"), "D:\\Published courses");
  assert.equal(defaultPublishFolder("/home/jo/courses/stats.osproj"), "/home/jo/courses/Published courses");
});
