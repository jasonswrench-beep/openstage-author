// SPDX-License-Identifier: Apache-2.0
// Setting the voice and the computer's sound against each other for the whole edit.
import assert from "node:assert/strict";
import { test } from "node:test";
import { editFromTakes, type TakeInfo } from "../../capture-edit/src/index.ts";
import { EditSession } from "../src/session.ts";

const take = (n: number): TakeInfo => ({
  take: n,
  state: "complete",
  durationMs: 10_000,
  media: [{ file: "screen.mp4", kind: "screen" }, { file: "mic.wav", kind: "microphone" }, { file: "system.wav", kind: "system-audio" }],
});

/** Two takes, so each sound has two clips. */
function open(): EditSession {
  return new EditSession(editFromTakes([take(1), take(2)]).model);
}

const volumes = (s: EditSession, trackName: string): number[] =>
  s.rows.filter((r) => r.trackName === trackName).map((r) => {
    s.select(r.clipId);
    return s.details?.volumeDb ?? Number.NaN;
  });

test("every clip of the voice, or of the computer's sound, is set together, and the other sound is left alone", () => {
  const s = open();
  assert.equal(s.soundBalance("microphone"), 0);
  assert.equal(s.soundBalance("system-audio"), 0);
  const said = s.setSoundBalance("system-audio", "-10");
  assert.ok(said.ok, said.message);
  assert.equal(said.message.startsWith("The computer's sound is now 10 decibels quieter than recorded, in all 2 of its clips."), true, said.message);
  assert.equal(s.soundBalance("system-audio"), -10);
  assert.equal(s.soundBalance("microphone"), 0, "the voice is not touched");
  assert.deepEqual(volumes(s, "Computer sound"), [-10, -10]);
  assert.deepEqual(volumes(s, "Microphone"), [0, 0]);
  assert.deepEqual(volumes(s, "Screen"), [0, 0], "and neither is a picture");
  const voice = s.setSoundBalance("microphone", "3 dB");
  assert.ok(voice.ok, voice.message);
  assert.equal(s.soundBalance("microphone"), 3);
});

test("setting the balance is one undo step, however many clips there are, and redo puts it back", () => {
  const s = open();
  assert.ok(s.setSoundBalance("system-audio", "-12").ok);
  assert.equal(s.soundBalance("system-audio"), -12);
  assert.ok(s.undo().ok);
  assert.equal(s.soundBalance("system-audio"), 0, "one undo puts every clip back");
  assert.ok(s.redo().ok);
  assert.equal(s.soundBalance("system-audio"), -12);
});

test("clips at different volumes are 'mixed' until the balance is set, which makes them all alike", () => {
  const s = open();
  const first = s.rows.find((r) => r.trackName === "Microphone");
  assert.ok(first);
  s.select(first.clipId);
  assert.ok(s.setVolumeText("5").ok);
  assert.equal(s.soundBalance("microphone"), "mixed");
  assert.ok(s.setSoundBalance("microphone", "0").ok);
  assert.equal(s.soundBalance("microphone"), 0);
});

test("a number that cannot be used, or a sound that is not there, is said in words and changes nothing", () => {
  const s = open();
  for (const bad of ["", "loud", "1.5", "21", "-41"]) {
    const said = s.setSoundBalance("system-audio", bad);
    assert.equal(said.ok, false, bad);
    assert.match(said.message, /decibels|number/i, said.message);
  }
  assert.equal(s.soundBalance("system-audio"), 0);
  assert.equal(s.undo().ok, false, "nothing to undo: nothing was changed");
  const again = s.setSoundBalance("system-audio", "0");
  assert.ok(again.ok);
  assert.equal(again.message, "The computer's sound is already as recorded.");
  const onlyScreen = new EditSession(editFromTakes([{ ...take(1), media: [{ file: "screen.mp4", kind: "screen" }] }]).model);
  assert.equal(onlyScreen.soundBalance("microphone"), undefined, "no voice recorded");
  const none = onlyScreen.setSoundBalance("microphone", "3");
  assert.equal(none.ok, false);
  assert.equal(none.message, "There is no voice in this edit.");
});

test("one clip alone is not called 'all of its clips'", () => {
  const s = new EditSession(editFromTakes([take(1)]).model);
  const said = s.setSoundBalance("microphone", "-3");
  assert.ok(said.ok);
  assert.equal(said.message.startsWith("Your voice is now 3 decibels quieter than recorded."), true, said.message);
});
