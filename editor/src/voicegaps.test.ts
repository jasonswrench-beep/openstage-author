// Tests for placing captions by the quiet gaps in the voice: where the voice speaks, and where each caption starts.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cue } from "./captions.ts";
import { soundMapOf } from "./recognition.ts";
import { JOIN_MS, LEAD_MS, MIN_SPEECH_MS, placeByGaps, speechStretches, TAIL_MS, type Stretch } from "./voicegaps.ts";

const RATE = 16000;

/** Sound at 16 kHz: a loud tone for each [from, to) second pair and silence between them. */
function tone(seconds: number, bursts: [number, number][]): Int16Array {
  const samples = new Int16Array(Math.round(seconds * RATE));
  for (const [from, to] of bursts) {
    for (let i = Math.round(from * RATE); i < Math.min(samples.length, Math.round(to * RATE)); i++) samples[i] = Math.round(9000 * Math.sin(i / 7));
  }
  return samples;
}

const cue = (n: number, text: string): Cue => ({ id: `c${n}`, startMs: 0, endMs: 1, text });
const s = (from: number, to: number): Stretch => ({ startMs: from * 1000, endMs: to * 1000 });

test("the voice is found where the sound is above the gate, and nowhere else", () => {
  const map = soundMapOf(tone(10, [[1, 3], [4, 6.5], [8, 9.5]]), RATE);
  const found = speechStretches(map);
  assert.equal(found.length, 3);
  assert.deepEqual(found.map((f) => [Math.round(f.startMs / 100) / 10, Math.round(f.endMs / 100) / 10]), [[1, 3], [4, 6.5], [8, 9.5]]);
});

test("a pause shorter than 0.3 seconds is not a pause, and a click or a breath is not speech", () => {
  const map = soundMapOf(tone(6, [[1, 2], [2.2, 3], [4, 4.06], [5, 5.5]]), RATE);
  const found = speechStretches(map);
  assert.deepEqual(found.map((f) => [Math.round(f.startMs / 100) / 10, Math.round(f.endMs / 100) / 10]), [[1, 3], [5, 5.5]], "1 to 2 and 2.2 to 3 are one stretch, and the 0.06 second click is gone");
  assert.equal(JOIN_MS, 300);
  assert.equal(MIN_SPEECH_MS, 120);
});

test("with no sound there is no voice", () => {
  assert.deepEqual(speechStretches(soundMapOf(new Int16Array(RATE * 3), RATE)), []);
  assert.deepEqual(speechStretches(soundMapOf(new Int16Array(0), RATE)), []);
});

test("three captions and three stretches of voice: each caption starts when its stretch does, a little early, and ends a little after it stops", () => {
  const placed = placeByGaps([cue(1, "First sentence here."), cue(2, "Second sentence here."), cue(3, "Third sentence here.")], [s(1, 3), s(4, 6), s(7, 9)], 12_000);
  assert.ok(typeof placed !== "string");
  assert.deepEqual(placed.cues.map((c) => [c.startMs, c.endMs]), [[1000 - LEAD_MS, 3000 + TAIL_MS], [4000 - LEAD_MS, 6000 + TAIL_MS], [7000 - LEAD_MS, 9000 + TAIL_MS]]);
  assert.deepEqual([placed.atPauses, placed.boundaries], [2, 2], "both places a caption begins are at a pause");
});

test("the words and ids of the captions are never changed", () => {
  const before = [cue(1, "One two three."), cue(2, "Four five six.")];
  const placed = placeByGaps(before, [s(1, 3), s(4, 6)], null);
  assert.ok(typeof placed !== "string");
  assert.deepEqual(placed.cues.map((c) => [c.id, c.text]), [["c1", "One two three."], ["c2", "Four five six."]]);
  assert.equal(before[0]!.startMs, 0, "the captions that were given are not changed either");
});

test("more stretches than captions: each caption takes the stretches that are its share, and starts at the pause between its share and the next", () => {
  // Two captions of equal length over four stretches of equal length: the second begins after the second stretch.
  const placed = placeByGaps([cue(1, "Aaaa bbbb cccc."), cue(2, "Dddd eeee ffff.")], [s(1, 3), s(4, 6), s(7, 9), s(10, 12)], 15_000);
  assert.ok(typeof placed !== "string");
  assert.deepEqual(placed.cues.map((c) => c.startMs), [1000 - LEAD_MS, 7000 - LEAD_MS], "the middle pause, between the 4 to 6 and the 7 to 9 stretches");
  assert.equal(placed.cues[0]!.endMs, 6000 + TAIL_MS);
  assert.equal(placed.cues[1]!.endMs, 12_000 + TAIL_MS);
});

test("more captions than stretches: a caption that no pause is near starts inside the speech where its share of it begins", () => {
  // One long stretch of 10 seconds and four equal captions: the boundaries are at 2.5, 5 and 7.5 seconds into it.
  const placed = placeByGaps([cue(1, "aaaaaaaaaa"), cue(2, "bbbbbbbbbb"), cue(3, "cccccccccc"), cue(4, "dddddddddd")], [s(2, 12)], 20_000);
  assert.ok(typeof placed !== "string");
  assert.deepEqual(placed.cues.map((c) => c.startMs), [2000 - LEAD_MS, 4500, 7000, 9500]);
  assert.deepEqual(placed.cues.map((c) => c.endMs), [4500, 7000, 9500, 12_000 + TAIL_MS], "inside the speech they follow one another");
  assert.deepEqual([placed.atPauses, placed.boundaries], [0, 3]);
});

test("a pause too far from where a caption should start is not used", () => {
  // Two captions of equal length over a long stretch with one pause far to the side: the boundary is at the middle, not at the pause.
  const placed = placeByGaps([cue(1, "aaaaaaaaaa"), cue(2, "bbbbbbbbbb")], [s(0, 1.0), s(2, 22)], 30_000);
  assert.ok(typeof placed !== "string");
  assert.equal(placed.atPauses, 0);
  assert.ok(placed.cues[1]!.startMs > 9000 && placed.cues[1]!.startMs < 13_000, `at the middle of the speech, not at the pause: ${placed.cues[1]!.startMs}`);
});

test("a caption's share is by its characters, so a longer caption gets more of the voice", () => {
  const placed = placeByGaps([cue(1, "a".repeat(30)), cue(2, "b".repeat(10))], [s(0, 40)], 40_000);
  assert.ok(typeof placed !== "string");
  assert.equal(placed.cues[1]!.startMs, 30_000, "three quarters of the way through the speech");
});

test("no pause is used for two captions, and starts go forward even for tiny captions", () => {
  const placed = placeByGaps([cue(1, "a"), cue(2, "b"), cue(3, "c"), cue(4, "d")], [s(1, 2), s(2.5, 3)], 6000);
  assert.ok(typeof placed !== "string");
  const starts = placed.cues.map((c) => c.startMs);
  assert.deepEqual([...starts].sort((a, b) => a - b), starts, "in order");
  assert.equal(new Set(starts).size, 4, "no two start together");
  assert.ok(placed.cues.every((c) => c.endMs > c.startMs));
});

test("no caption ends after the clip, and a caption with no words keeps the place it had", () => {
  const placed = placeByGaps([cue(1, "Hello there."), { id: "c2", startMs: 5, endMs: 9, text: "  " }, cue(3, "Goodbye now.")], [s(0.5, 2), s(3, 4.9)], 5000);
  assert.ok(typeof placed !== "string");
  assert.equal(placed.cues[2]!.endMs, 5000, "held at the end of the clip");
  assert.deepEqual([placed.cues[1]!.startMs, placed.cues[1]!.endMs], [5, 9], "the empty caption is left alone");
  assert.equal(placed.cues[0]!.startMs, 380, "the first starts a little before the voice, never before the start of the clip");
});

test("with no captions, or no voice, the answer is a problem in words and nothing is changed", () => {
  assert.equal(placeByGaps([], [s(1, 2)], 5000), "There are no captions to set the times of.");
  assert.equal(placeByGaps([cue(1, "  ")], [s(1, 2)], 5000), "There are no captions to set the times of.");
  assert.match(placeByGaps([cue(1, "Hello.")], [], 5000) as string, /^No voice was found in the sound, so the times were not changed\./);
});

test("from real sound: three sentences read with pauses are placed at the pauses", () => {
  const map = soundMapOf(tone(12, [[1, 3], [4.5, 7], [8, 11]]), RATE);
  const placed = placeByGaps([cue(1, "A sentence of some length."), cue(2, "Another sentence, a longer one."), cue(3, "And a third, the longest of the three.")], speechStretches(map), 12_000);
  assert.ok(typeof placed !== "string");
  assert.equal(placed.atPauses, 2);
  const [a, b, c] = placed.cues;
  assert.ok(Math.abs(a!.startMs - 880) <= 40 && Math.abs(b!.startMs - 4380) <= 40 && Math.abs(c!.startMs - 7880) <= 40, JSON.stringify(placed.cues.map((x) => x.startMs)));
});
