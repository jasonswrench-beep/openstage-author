// Tests for the facts the About window shows.
import assert from "node:assert/strict";
import { test } from "node:test";
import { UNKNOWN_ABOUT, aboutLines, aboutText, parseAbout } from "./about.ts";

const FULL = {
  version: "0.1.0", installed: true, program: "C:/Users/x/AppData/Local/Programs/OpenStage Author/openstage-editor.exe", guidesFile: "C:/Users/x/AppData/Local/Programs/OpenStage Author/docs/narration-setup.md",
  python: "C:/Users/x/AppData/Local/Programs/OpenStage Author/python/python.exe", node: "C:/Users/x/AppData/Local/Programs/OpenStage Author/node/node.exe",
  recorder: "C:/Users/x/AppData/Local/Programs/OpenStage Author/openstage-capture.exe", recogniser: "C:/Users/x/AppData/Local/Programs/OpenStage Author/speech/whisper-cli.exe",
  data: "C:/Users/x/AppData/Local/com.openstageauthor.editor", settings: "C:/Users/x/AppData/Roaming/com.openstageauthor.editor/settings.json",
  engine: "Installed by the editor", webview: "141.0.3537.57", windows: "Microsoft Windows [Version 10.0.26200.1]", arch: "x86_64",
};

test("the shell's facts are read as they are", () => {
  assert.deepEqual(parseAbout(JSON.stringify(FULL)), FULL);
});

test("anything missing, damaged or of the wrong kind is unknown, never blank or a crash", () => {
  assert.deepEqual(parseAbout("garbage"), UNKNOWN_ABOUT);
  assert.deepEqual(parseAbout("[]"), UNKNOWN_ABOUT);
  const partly = parseAbout(JSON.stringify({ version: "0.2.0", installed: "yes", python: "", node: 5, guidesFile: "" }));
  assert.equal(partly.version, "0.2.0");
  assert.equal(partly.installed, false, "only a real yes counts");
  assert.equal(partly.python, "unknown", "an empty answer is not an answer");
  assert.equal(partly.node, "unknown");
  assert.equal(partly.guidesFile, "", "no folder of guides is a real answer");
});

test("the lines are labelled and say plainly what kind of copy this is", () => {
  const lines = aboutLines(parseAbout(JSON.stringify(FULL)));
  assert.deepEqual(lines.map((l) => l.label), ["Version", "Kind of copy", "Program", "Python", "Node", "Screen recorder", "Speech recogniser", "Narration voice", "Settings file", "Data folder", "Web view", "Windows"]);
  assert.equal(lines[1]?.value, "Installed (it has its own Python and Node)");
  assert.equal(lines[11]?.value, "Microsoft Windows [Version 10.0.26200.1] (x86_64)");
  assert.match(aboutLines({ ...UNKNOWN_ABOUT })[1]?.value ?? "", /^Run from the source folder/);
});

test("the text to copy has every line, starts with the name and holds no secret", () => {
  const text = aboutText(parseAbout(JSON.stringify(FULL)));
  assert.ok(text.startsWith("OpenStage Author\nVersion: 0.1.0\n"));
  assert.equal(text.split("\n").length, 13);
  assert.doesNotMatch(text, /sk-|key|password/i);
});
