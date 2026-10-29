// SPDX-License-Identifier: Apache-2.0
// Choosing where the webcam picture goes in the finished video, from the form.
import assert from "node:assert/strict";
import { test } from "node:test";
import { editFromTakes, setPlacement, webcamRect, type TakeInfo } from "../../capture-edit/src/index.ts";
import { EditSession } from "../src/session.ts";

const take: TakeInfo = {
  take: 1,
  state: "complete",
  durationMs: 10_000,
  media: [{ file: "screen.mp4", kind: "screen" }, { file: "webcam.mp4", kind: "webcam" }, { file: "mic.wav", kind: "microphone" }],
};

function open(): EditSession {
  return new EditSession(editFromTakes([take]).model);
}

function choose(s: EditSession, trackName: string): void {
  const row = s.rows.find((r) => r.trackName === trackName);
  assert.ok(row, trackName);
  assert.ok(s.select(row.clipId).ok);
}

test("only a webcam recording has a place, and it starts in the usual one", () => {
  const s = open();
  choose(s, "Webcam");
  assert.deepEqual([s.details?.isWebcam, s.details?.webcamWhere, s.details?.webcamSize], [true, "usual", "medium"]);
  choose(s, "Screen");
  assert.equal(s.details?.isWebcam, false);
  choose(s, "Microphone");
  assert.equal(s.details?.isWebcam, false);
});

test("a corner and a size are chosen, said in words, undone in one step, and 'the usual place' takes them away", () => {
  const s = open();
  choose(s, "Webcam");
  const placed = s.setWebcamPlace("top-left", "large");
  assert.ok(placed.ok, placed.message);
  assert.match(placed.message, /is now drawn in .* of the picture/);
  assert.deepEqual([s.details?.webcamWhere, s.details?.webcamSize], ["top-left", "large"]);
  const filled = s.setWebcamPlace("fill", "large");
  assert.ok(filled.ok);
  assert.deepEqual([s.details?.webcamWhere, s.details?.webcamSize], ["fill", "medium"], "a picture that fills the video has no size of its own");
  assert.ok(s.undo().ok);
  assert.deepEqual([s.details?.webcamWhere, s.details?.webcamSize], ["top-left", "large"], "one undo goes back one choice");
  const usual = s.setWebcamPlace("usual", "small");
  assert.ok(usual.ok, usual.message);
  assert.deepEqual([s.details?.webcamWhere, s.details?.webcamSize], ["usual", "medium"]);
  const again = s.setWebcamPlace("usual", "small");
  assert.ok(again.ok, "asking for what is already so is not an error");
  assert.match(again.message, /already/);
});

test("a size alone moves nothing else: bottom right and large is bottom right, bigger", () => {
  const s = open();
  choose(s, "Webcam");
  assert.ok(s.setWebcamPlace("bottom-right", "small").ok);
  const small = webcamRect("bottom-right", "small");
  assert.ok(s.setWebcamPlace("bottom-right", "large").ok);
  const large = webcamRect("bottom-right", "large");
  assert.ok(large.width > small.width && large.x < small.x && large.y < small.y, "it grows toward the middle, from the same corner");
  assert.deepEqual([s.details?.webcamWhere, s.details?.webcamSize], ["bottom-right", "large"]);
});

test("a choice that cannot be made says why and changes nothing", () => {
  const s = open();
  choose(s, "Screen");
  const screen = s.setWebcamPlace("top-left", "small");
  assert.equal(screen.ok, false);
  assert.match(screen.message, /not a webcam recording/);
  choose(s, "Webcam");
  for (const [where, size] of [["sideways", "small"], ["top-left", "huge"], ["", ""]] as const) {
    const said = s.setWebcamPlace(where, size);
    assert.equal(said.ok, false, `${where} ${size}`);
    assert.match(said.message, /not one of the places or sizes/);
  }
  assert.equal(s.details?.webcamWhere, "usual");
  assert.equal(s.undo().ok, false, "nothing was changed, so there is nothing to undo");
});

test("a place set some other way is shown as 'other', and is replaced by choosing one", () => {
  const model = editFromTakes([take]).model;
  const webcamClip = model.tracks.find((t) => t.kind === "webcam")?.clips[0];
  assert.ok(webcamClip);
  const odd = setPlacement(model, webcamClip.id, { x: 100, y: 200, width: 3000, height: 1700 });
  assert.ok(odd.ok);
  const s = new EditSession(odd.model);
  choose(s, "Webcam");
  assert.deepEqual([s.details?.webcamWhere, s.details?.webcamSize], ["other", "other"]);
  const refused = s.setWebcamPlace("other", "other");
  assert.equal(refused.ok, false);
  assert.match(refused.message, /another way/);
  assert.ok(s.setWebcamPlace("top-right", "small").ok);
  assert.deepEqual([s.details?.webcamWhere, s.details?.webcamSize], ["top-right", "small"]);
});
