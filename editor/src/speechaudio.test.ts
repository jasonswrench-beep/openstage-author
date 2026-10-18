// Tests for reading a clip's sound for the recogniser: the part that needs no window (mixing channels down to one 16-bit channel).
import assert from "node:assert/strict";
import { test } from "node:test";
import { toMono16 } from "./speechaudio.ts";

test("one channel is kept as it is, scaled to 16 bits", () => {
  assert.deepEqual(Array.from(toMono16([Float32Array.from([0, 0.5, -0.5, 1, -1])])), [0, 16384, -16384, 32767, -32768]);
});

test("two channels are mixed down to their average, so a sound in only one ear is not lost, only quieter", () => {
  const left = Float32Array.from([0.5, 0.5, 0]);
  const right = Float32Array.from([0.5, -0.5, 0.25]);
  assert.deepEqual(Array.from(toMono16([left, right])), [16384, 0, 4096]);
  assert.deepEqual(Array.from(toMono16([Float32Array.from([0.8]), Float32Array.from([0])])), [13107]);
});

test("a sound past full scale is held there, and no channels gives no sound", () => {
  assert.deepEqual(Array.from(toMono16([Float32Array.from([2, -3])])), [32767, -32768]);
  assert.equal(toMono16([]).length, 0);
});

test("channels of different lengths are mixed as far as the longest, the short one counting as silence after it ends", () => {
  assert.deepEqual(Array.from(toMono16([Float32Array.from([1, 1]), Float32Array.from([1])])), [32767, 16384]);
});
