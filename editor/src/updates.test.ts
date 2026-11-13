import assert from "node:assert/strict";
import { test } from "node:test";
import { RELEASES_PAGE, isReleasePage, pageButtonText, parseUpdateAnswer } from "./updates.ts";

test("only this program's release pages are offered", () => {
  assert.equal(isReleasePage(RELEASES_PAGE), true);
  assert.equal(isReleasePage("https://github.com/jasonswrench-beep/openstage-author/releases/tag/v0.1.0-alpha.5"), true);
  assert.equal(isReleasePage("https://github.com/jasonswrench-beep/openstage-author/releases/tag/v1.2.3"), true);
  for (const bad of ["https://example.org/", "https://github.com/someone-else/openstage-author/releases", "http://github.com/jasonswrench-beep/openstage-author/releases",
    "https://github.com/jasonswrench-beep/openstage-author/releases/tag/v0.1.0-alpha.5/../x", "https://github.com/jasonswrench-beep/openstage-author/releases/download/v1/setup.exe", "javascript:alert(1)"]) {
    assert.equal(isReleasePage(bad), false, bad);
  }
});

test("the shell's answer is read, and a link that is not a release page is dropped", () => {
  const newer = parseUpdateAnswer(JSON.stringify({ state: "newer", message: "A newer version is published.", url: "https://github.com/jasonswrench-beep/openstage-author/releases/tag/v0.1.0-alpha.6" }));
  assert.deepEqual(newer, { state: "newer", message: "A newer version is published.", url: "https://github.com/jasonswrench-beep/openstage-author/releases/tag/v0.1.0-alpha.6" });
  assert.equal(pageButtonText(newer), "Open the new version's page");
  const sneaky = parseUpdateAnswer(JSON.stringify({ state: "newer", message: "x", url: "https://example.org/setup.exe" }));
  assert.equal(sneaky.url, undefined);
  assert.equal(parseUpdateAnswer(JSON.stringify({ state: "weird", message: "" })).state, "error");
  assert.equal(parseUpdateAnswer("not json").state, "error");
  assert.equal(pageButtonText({ state: "error", message: "x", url: RELEASES_PAGE }), "Open the releases page");
});
