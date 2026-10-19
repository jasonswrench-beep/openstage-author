// Tests for what the Narration dialog says about the narration engine.
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatBytes } from "./narration.ts";
import { DISK_MEGABYTES, DOWNLOAD_MEGABYTES, TEMPORARY_MEGABYTES, engineLine, installQuestion, parseEngineStatus, progressDetail, removeQuestion, stepText } from "./engine.ts";

test("the shell's status is read, and nonsense is no engine that cannot be installed", () => {
  const s = parseEngineStatus(JSON.stringify({ state: "installed", canInstall: false, problem: "", folder: "C:/x/narration-engine", size: 1_500_000_000 }));
  assert.deepEqual([s.state, s.size, s.folder], ["installed", 1_500_000_000, "C:/x/narration-engine"]);
  const bad = parseEngineStatus("garbage");
  assert.deepEqual([bad.state, bad.canInstall], ["none", false]);
  assert.match(bad.problem, /could not be read/);
  assert.equal(parseEngineStatus(JSON.stringify({ state: "weird", size: -5, canInstall: "yes" })).state, "none");
  assert.equal(parseEngineStatus(JSON.stringify({ state: "none", size: -5 })).size, 0);
});

test("each state says what it is and which button makes sense", () => {
  const none = engineLine({ state: "none", canInstall: true, problem: "", folder: "", size: 0 });
  assert.match(none.text, /not installed on this computer, so audio cannot be made with it\. You can install it here: about 670 MB/);
  assert.match(none.text, /Voices from a service or a plugin do not need it\./);
  assert.deepEqual([none.canInstall, none.canRemove], [true, false]);
  const half = engineLine({ state: "none", canInstall: true, problem: "", folder: "", size: 800_000_000 });
  assert.match(half.text, new RegExp(`A half-finished install is using ${formatBytes(800_000_000).replace(".", "\\.")}: installing again replaces it, or you can remove it\\.$`));
  assert.deepEqual([half.canInstall, half.canRemove], [true, true], "a half-finished install can be removed to free the room");
  const installed = engineLine({ state: "installed", canInstall: false, problem: "", folder: "", size: 1_234_000_000 });
  assert.equal(installed.text, `The narration voice (Kokoro) is installed on this computer, and takes ${formatBytes(1_234_000_000)}.`);
  assert.deepEqual([installed.canInstall, installed.canRemove], [false, true]);
  const own = engineLine({ state: "setting", canInstall: false, problem: "", folder: "", size: 0 });
  assert.match(own.text, /OPENSTAGE_KOKORO_PYTHON\. The editor leaves it alone\./);
  assert.deepEqual([own.canInstall, own.canRemove], [false, false], "the author's own engine is never touched");
  const cannot = engineLine({ state: "none", canInstall: false, problem: "This copy has no Python of its own.", folder: "", size: 0 });
  assert.equal(cannot.text, "The narration voice (Kokoro) is not installed on this computer. This copy has no Python of its own.");
  assert.equal(cannot.canInstall, false);
});

test("the question says what, from where, how much, where it goes, and that part of it is GPL, before anything is fetched", () => {
  const q = installQuestion();
  for (const part of ["pypi.org", "huggingface.co", `about ${DOWNLOAD_MEGABYTES} MB`, `${(DISK_MEGABYTES / 1000).toFixed(1)} GB`, `${(TEMPORARY_MEGABYTES / 1000).toFixed(1)} GB more free`, "OpenStage's own folder", "stop it", "GNU General Public License", "does not include or hand out any of it", "Nothing from your courses is sent"]) {
    assert.ok(q.includes(part), part);
  }
  assert.ok(q.endsWith("Go on?"));
});

test("removing says what is kept and how much is freed", () => {
  assert.equal(removeQuestion(1_500_000_000), `Remove the narration voice from this computer and free ${formatBytes(1_500_000_000)}? Audio already made for your courses is kept. To make new audio with it you would install it again.`);
  assert.doesNotMatch(removeQuestion(0), /free/);
});

test("progress words are short, one step at a time", () => {
  assert.equal(stepText(2, 3, "Fetching the voice model"), "Step 2 of 3: Fetching the voice model.");
  assert.equal(progressDetail("  Downloading   torch-2.5.1-cp311-cp311-win_amd64.whl (203.1 MB)  "), "Downloading torch-2.5.1-cp311-cp311-win_amd64.whl (203.1 MB)");
  assert.equal(progressDetail("x".repeat(300)).length, 140);
});
