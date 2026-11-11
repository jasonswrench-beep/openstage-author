// The publishing style: the names of published files, the next version, and the style as kept in the settings file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";
import { checkPattern, DEFAULT_STYLE, isDefaultStyle, nextVersion, parsePublishStyle, publishName } from "./publishstyle.ts";

const course = { folder: "intro-comm.osproj", title: "Introduction to Communication", code: "CMM 360", version: "2.1", date: "2026-11-10" };

test("the folder part is the project's folder name without .osproj (with the usual pattern the editor names nothing, so Publish is as it was)", () => {
  assert.equal(publishName(DEFAULT_STYLE.fileName, course), "intro-comm");
  assert.equal(publishName("{folder}_{date}", { ...course, folder: "Intro Comm.OSPROJ" }), "Intro-Comm_2026-11-10");
});

test("a pattern is filled in and made safe for a file name: spaces and marks become hyphens, dots stay", () => {
  assert.equal(publishName("{code}_{title}_v{version}", course), "CMM-360_Introduction-to-Communication_v2.1");
  assert.equal(publishName("{code} {date}", course), "CMM-360-2026-11-10");
  assert.equal(publishName("{title}", { ...course, title: "Café: résumé / notes?" }), "Cafe-resume-notes");
});

test("a part the course does not have is left out, with the joining mark beside it", () => {
  assert.equal(publishName("{code}_{title}", { ...course, code: undefined }), "Introduction-to-Communication");
  assert.equal(publishName("{title}_{version}_{date}", { ...course, version: undefined }), "Introduction-to-Communication_2026-11-10");
  assert.equal(publishName("{code}", { ...course, code: "", folder: "my course.osproj" }), "my-course", "an empty name falls back to the folder");
});

test("a name is at most 80 letters and never ends with a joining mark", () => {
  const long = publishName("{title}", { ...course, title: "word ".repeat(40) });
  assert.ok(long.length <= 80);
  assert.ok(!/[._-]$/.test(long));
});

test("a pattern needs a part in braces, and only the parts there are", () => {
  assert.equal(checkPattern("{code}_{title}_v{version}"), null);
  assert.equal(checkPattern("{TITLE}"), null, "case does not matter");
  assert.match(checkPattern("course") ?? "", /at least one part/);
  assert.match(checkPattern("{course}") ?? "", /\{course\} is not a part/);
  assert.match(checkPattern("{title") ?? "", /brace is left open/);
  assert.match(checkPattern("   ") ?? "", /Write a pattern/);
  assert.equal(publishName("{nonsense}", { ...course, folder: "intro" }), "intro", "a bad pattern is never used");
});

test("the next big version: 1.0 and 1.3 make 2.0, 2 makes 3, none makes 2.0, words around it stay", () => {
  assert.equal(nextVersion("1.0"), "2.0");
  assert.equal(nextVersion("1.3"), "2.0");
  assert.equal(nextVersion("2"), "3");
  assert.equal(nextVersion("v1.2.5"), "v2.0.0");
  assert.equal(nextVersion("2026 edition 1"), "2027 edition 1");
  assert.equal(nextVersion(undefined), "2.0");
  assert.equal(nextVersion("Spring"), "Spring 2");
});

test("the style kept in the settings file is read back, and anything damaged is the usual", () => {
  assert.deepEqual(parsePublishStyle({ fileName: "{code}_{title}", headings: "outline", font: "Arial" }), { fileName: "{code}_{title}", headings: "outline", font: "Arial" });
  assert.deepEqual(parsePublishStyle({ fileName: "{nope}", headings: "fancy", font: "Comic Sans" }), DEFAULT_STYLE);
  assert.deepEqual(parsePublishStyle(null), DEFAULT_STYLE);
  assert.ok(isDefaultStyle(parsePublishStyle(undefined)));
});

test("the course's code and version are kept in the project, one undo step each, and a blank one is taken away", () => {
  const files = newProjectFiles({ title: "Versions", author: "", language: "en-US", today: "2026-11-10" });
  const text = (p: string) => files.find((f) => f.path === p)!.text;
  const m = new Model({ dir: "versions-test", project: text("project.json"), theme: text("theme.json"), assets: null, slides: [{ id: "slide-001", text: text("slides/slide-001.json") }] });
  assert.equal(m.courseVersion, "");
  assert.equal(m.project.schemaVersion, "0.49.0");
  assert.deepEqual(m.setCourseDetail("version", "  2.0 "), { ok: true, message: "The course's version is 2.0." });
  assert.equal(m.project.meta.version, "2.0");
  assert.equal(m.setCourseDetail("courseCode", "CMM   360").message, "The course's course code is CMM 360.");
  assert.equal(m.courseCode, "CMM 360");
  assert.ok(!m.setCourseDetail("version", "x".repeat(21)).ok, "too long for the format");
  assert.equal(m.courseVersion, "2.0");
  m.undo();
  assert.equal(m.courseCode, "", "undo takes the code back off");
  assert.equal(m.setCourseDetail("version", "").message, "The course has no version now.");
  assert.ok(!("version" in m.project.meta), "a blank version is not kept as an empty one, which the format refuses");
});
