import assert from "node:assert/strict";
import { test } from "node:test";
import type { Finding } from "./backend.ts";
import { defaultPublishFolder, failureText, fileName, narrationLine, parentFolder, parsePublishResult, problemCounts, problemLine, publishSummary, type PublishResult } from "./publishing.ts";

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
