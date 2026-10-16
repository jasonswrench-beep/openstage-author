// Tests for reading what steps can be made from, with a recording held in memory.
import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryFolder } from "../../capture-timeline/src/project.ts";
import { emptyList, serializeSteps } from "./steps.ts";
import { readStepSource } from "./stepsource.ts";

const CAPTURE = '{"format":"openstage-capture-project","title":"Demo","schemaVersion":"0.2.5"}';
const take = (id: number, extra: { state?: string; region?: unknown; log?: boolean; keys?: boolean } = {}): string =>
  JSON.stringify({
    id, state: extra.state ?? "complete", durationMs: 9000,
    media: [
      { file: "screen.mp4", kind: "screen", container: "fragmented-mp4", ...(extra.region !== undefined ? { region: extra.region } : {}) },
      { file: "mic.wav", kind: "microphone", container: "wav" },
      ...(extra.log === false ? [] : [{ file: "events.jsonl", kind: "interactions", container: "jsonl", interactions: { display: 1, keys: extra.keys ?? true } }]),
    ],
  });
const CLICK = (t: number, x = 10, y = 10) => `{"t":${t},"type":"click","x":${x},"y":${y},"button":"left"}`;

test("steps are proposed from the logs of the takes, in order, with the picture's own corner and numbers that run on", async () => {
  const folder = memoryFolder("Demo.capture", {
    "capture.json": CAPTURE,
    "takes/take-001/take.json": take(1),
    "takes/take-001/events.jsonl": [CLICK(1000), '{"t":1000,"type":"element","name":"Save","role":"button"}'].join("\n"),
    "takes/take-002/take.json": take(2, { region: { display: 1, x: 100, y: 200, width: 1280, height: 720 } }),
    "takes/take-002/events.jsonl": CLICK(500, 340, 260),
  });
  const r = await readStepSource(folder);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const s = r.source.proposed.steps;
  assert.deepEqual(s.map((x) => [x.id, x.take, x.text]), [["step-1", 1, "Click the Save button."], ["step-2", 2, "Click the highlighted spot."]]);
  assert.deepEqual(s[1]!.target, { x: 240, y: 60 });
  assert.deepEqual(s[1]!.picture, { width: 1280, height: 720 });
  assert.equal(r.source.hasInteractions, true);
  assert.deepEqual(r.source.takes, [1, 2]);
  assert.equal(r.source.saved, null);
});

test("a take that was set aside is not used, and is said", async () => {
  const folder = memoryFolder("Demo.capture", {
    "capture.json": CAPTURE,
    "takes/take-001/take.json": take(1, { state: "setAside" }),
    "takes/take-001/events.jsonl": CLICK(1000),
    "takes/take-002/take.json": take(2),
    "takes/take-002/events.jsonl": CLICK(2000),
  });
  const r = await readStepSource(folder);
  assert.equal(r.ok && r.source.proposed.steps.length, 1);
  assert.equal(r.ok && r.source.notes.some((n) => /Take 1 was set aside/.test(n)), true);
});

test("a recording with no note of what the author did says how to get one, and still lets steps be added by hand", async () => {
  const folder = memoryFolder("Demo.capture", { "capture.json": CAPTURE, "takes/take-001/take.json": take(1, { log: false }) });
  const r = await readStepSource(folder);
  assert.equal(r.ok && r.source.proposed.steps.length, 0);
  assert.equal(r.ok && r.source.hasInteractions, false);
  assert.match(r.ok ? r.source.notes.join(" ") : "", /OpenScreen was set to note nothing/);
  assert.match(r.ok ? r.source.notes.join(" ") : "", /add steps by hand/);
});

test("only markers are steps when only markers were noted, and the author is told", async () => {
  const folder = memoryFolder("Demo.capture", {
    "capture.json": CAPTURE, "takes/take-001/take.json": take(1), "takes/take-001/events.jsonl": '{"t":3400,"type":"marker","label":"Open the report"}',
  });
  const r = await readStepSource(folder);
  assert.deepEqual(r.ok && r.source.proposed.steps.map((s) => s.text), ["Open the report"]);
  assert.match(r.ok ? r.source.notes.join(" ") : "", /Only your own markers were noted/);
});

test("keys that were left out of the log are said, and lines that cannot be read are counted", async () => {
  const folder = memoryFolder("Demo.capture", {
    "capture.json": CAPTURE, "takes/take-001/take.json": take(1, { keys: false }), "takes/take-001/events.jsonl": [CLICK(1000), "garbage", '{"t":1,"type":"click"'].join("\n"),
  });
  const r = await readStepSource(folder);
  const notes = r.ok ? r.source.notes.join(" ") : "";
  assert.match(notes, /Your keys were not noted/);
  assert.match(notes, /2 lines of the log could not be read and were left out/);
});

test("only what the saved edit keeps makes a step", async () => {
  const edit = JSON.stringify({
    format: "openstage-capture-edit", schemaVersion: "0.3.0", nextId: 3,
    sources: [{ ref: { kind: "take", take: 1, media: "screen.mp4" }, kind: "screen", name: "Screen of take 1", durationMs: 9000 }],
    tracks: [{ id: "track-1", kind: "screen", name: "Screen", items: [], clips: [{ id: "clip-1", name: "Screen", source: { kind: "take", take: 1, media: "screen.mp4" }, sourceStartMs: 4000, sourceEndMs: 6000, startMs: 0, muted: false, volumeDb: 0, fadeInMs: 0, fadeOutMs: 0 }] }],
  });
  const folder = memoryFolder("Demo.capture", {
    "capture.json": CAPTURE, "takes/take-001/take.json": take(1), "takes/take-001/events.jsonl": [CLICK(1000), CLICK(5000), CLICK(8000)].join("\n"), "edit.json": edit,
  });
  const r = await readStepSource(folder);
  assert.deepEqual(r.ok && r.source.proposed.steps.map((s) => s.atMs), [5000]);
  assert.match(r.ok ? r.source.notes.join(" ") : "", /anything you cut out of the recording makes no step/);
});

test("steps already saved are found, and a saved file that cannot be used is said and does not stop the rest", async () => {
  const files = { "capture.json": CAPTURE, "takes/take-001/take.json": take(1), "takes/take-001/events.jsonl": CLICK(1000) };
  const good = await readStepSource(memoryFolder("Demo.capture", { ...files, "steps.json": serializeSteps(emptyList()) }));
  assert.equal(good.ok && good.source.saved?.steps.length, 0);
  const bad = await readStepSource(memoryFolder("Demo.capture", { ...files, "steps.json": "{" }));
  assert.equal(bad.ok && bad.source.saved, null);
  assert.match(bad.ok ? bad.source.notes.join(" ") : "", /The steps saved in this recording could not be used/);
  assert.equal(bad.ok && bad.source.proposed.steps.length, 1);
});

test("a folder that is not a recording is refused in words", async () => {
  const r = await readStepSource(memoryFolder("Nope", {}));
  assert.equal(r.ok, false);
});
