// Tests for the three package descriptions: imsmanifest.xml for SCORM 1.2 and for SCORM 2004, and tincan.xml for xAPI.
// There is no XML parser in Node, so a small check that the tags open and close properly stands in for one: it catches the
// mistakes a template can make (an unclosed element, a title that is not escaped).
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildManifest, buildManifest2004, manifestId } from "./scorm-manifest.ts";
import { buildTincanXml } from "./xapi-manifest.ts";
import { courseActivityId } from "./xapi.ts";

/** Returns an error message if the tags do not nest properly, otherwise null. */
function wellFormed(text: string): string | null {
  const stack: string[] = [];
  const body = text.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  for (const m of body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g)) {
    const [, closing, name, , selfClosing] = m;
    if (selfClosing) continue;
    if (!closing) { stack.push(name!); continue; }
    if (stack.pop() !== name) return `</${name}> closes the wrong element`;
  }
  if (stack.length) return `<${stack.at(-1)}> is never closed`;
  // Anything left that looks like a tag was not understood, which means a bad attribute or a stray character.
  const rest = body.replace(/<\/?[A-Za-z][\w:.-]*(?:\s+[\w:.-]+="[^"<]*")*\s*\/?>/g, "");
  return /[<>]/.test(rest) ? "a stray < or > is in the text" : null;
}

const input = { title: 'Safety & "Health" <basics>', files: ["player.js", "index.html", "assets/a b.png"], graded: true };

test("the well-formedness check itself catches the mistakes it is for", () => {
  assert.equal(wellFormed("<a><b/></a>"), null);
  assert.match(wellFormed("<a><b></a>")!, /wrong element/);
  assert.match(wellFormed("<a>")!, /never closed/);
  assert.match(wellFormed("<a>1 < 2</a>")!, /stray/);
});

test("SCORM 1.2: the identifier, the mastery score and the files", () => {
  const m = buildManifest(input);
  assert.equal(wellFormed(m), null);
  assert.match(m, /<schemaversion>1\.2<\/schemaversion>/);
  assert.match(m, /<adlcp:masteryscore>80<\/adlcp:masteryscore>/);
  assert.match(m, /adlcp:scormtype="sco"/);
  assert.ok(m.includes("<title>Safety &amp; &quot;Health&quot; &lt;basics&gt;</title>"), "the title is escaped");
  const at = (f: string) => m.indexOf(`<file href="${f}"/>`);
  assert.ok(at("assets/a b.png") > 0 && at("assets/a b.png") < at("index.html") && at("index.html") < at("player.js"), "files are listed in order");
  assert.ok(!buildManifest({ ...input, graded: false }).includes("masteryscore"));
  assert.equal(manifestId("Safety & Health"), "openstage-safety-health");
});

test("SCORM 2004: the 2004 namespaces, the pass mark as a fraction, and the content reporting its own result", () => {
  const m = buildManifest2004(input);
  assert.equal(wellFormed(m), null);
  assert.match(m, /<schemaversion>2004 4th Edition<\/schemaversion>/);
  assert.ok(m.includes('xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"'));
  assert.ok(m.includes('xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"'));
  assert.ok(m.includes('xmlns:imsss="http://www.imsglobal.org/xsd/imsss"'));
  assert.match(m, /adlcp:scormType="sco"/, "2004 spells it with a capital T");
  assert.ok(!m.includes("masteryscore"), "that is a 1.2 element");
  assert.match(m, /<imsss:minNormalizedMeasure>0\.8<\/imsss:minNormalizedMeasure>/);
  assert.match(m, /satisfiedByMeasure="true"/);
  assert.match(m, /<imsss:deliveryControls completionSetByContent="true" objectiveSetByContent="true"\/>/);
  // The standard fixes the order of what goes inside imsss:sequencing.
  assert.ok(m.indexOf("<imsss:objectives>") < m.indexOf("<imsss:deliveryControls"));
  assert.ok(m.includes("<title>Safety &amp; &quot;Health&quot; &lt;basics&gt;</title>"));
  assert.ok(m.indexOf('href="assets/a b.png"') < m.indexOf('href="player.js"'));
});

test("SCORM 2004: a course with no quiz has no pass mark but still reports its own completion", () => {
  const m = buildManifest2004({ ...input, graded: false });
  assert.equal(wellFormed(m), null);
  assert.ok(!m.includes("imsss:objectives") && !m.includes("minNormalizedMeasure"));
  assert.ok(m.includes("completionSetByContent"));
});

test("xAPI: tincan.xml names the course, its identifier and its launch file", () => {
  const meta = { title: input.title, author: "A", language: "en-GB", created: "2026-10-31", modified: "2026-10-31" };
  const id = courseActivityId(meta);
  const x = buildTincanXml({ title: meta.title, language: meta.language, activityId: id });
  assert.equal(wellFormed(x), null);
  assert.ok(x.includes(`<activity id="${id}" type="http://adlnet.gov/expapi/activities/course">`));
  assert.ok(x.includes('<name lang="en-GB">Safety &amp; &quot;Health&quot; &lt;basics&gt;</name>'));
  assert.ok(x.includes('<launch lang="en-GB">index.html</launch>'));
  assert.ok(x.includes('xmlns="http://projecttincan.com/tincan.xsd"'));
});
