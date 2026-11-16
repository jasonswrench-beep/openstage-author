import assert from "node:assert/strict";
import { test } from "node:test";
import { captionsFromNarration, parseNarrationCues, type NarrationCues } from "./cues.ts";

const script = "Welcome to the course. In this lesson we look at how information moves through an organization, and why it matters to the people who work there every day.";
const timing: NarrationCues = {
  exactTimings: true, duration: 9,
  cues: [{ start: 0.2, end: 1.9, text: "Welcome to the course." }, { start: 2.4, end: 8.8, text: "In this lesson we look at how information moves through an organization, and why it matters to the people who work there every day." }],
};
const words = (c: { text: string }[]): string => c.map((x) => x.text.replace(/\s+/g, " ")).join(" ").replace(/\s+/g, " ").trim();

test("the shell's answer is read, and a cue that is not whole is left out", () => {
  const raw = { exactTimings: true, duration: 3, cues: [{ start: 0, end: 1, text: "One." }, { start: 2, end: 1, text: "Backwards." }, { start: "1", end: 2, text: "Text." }, { start: 1, end: 2, text: "  " }, { start: -1, end: 2, text: "Before." }, null, { start: 1, end: 2 }, { start: 1, end: 2, text: "Two." }] };
  const read = parseNarrationCues(raw)!;
  assert.deepEqual(read.cues.map((c) => c.text), ["One.", "Two."]);
  assert.equal(read.exactTimings, true);
  for (const bad of [null, "x", {}, { cues: "no" }, []]) assert.equal(parseNarrationCues(bad), null);
  assert.equal(parseNarrationCues({ cues: [] })!.exactTimings, false);
});

test("captions are timed to when each sentence is spoken, and say exactly the script", () => {
  const made = captionsFromNarration(timing, script, 9000);
  assert.equal(made.fromVoice, true);
  assert.equal(made.estimated, false);
  assert.equal(made.cues[0]!.startMs, 200);
  assert.equal(made.cues[0]!.endMs, 1900, "the first sentence ends where it is spoken to end");
  assert.ok(made.cues.length >= 3, "the long sentence needed more than one caption");
  assert.equal(made.cues[1]!.startMs, 2400, "and the second sentence's first caption begins when it is spoken");
  assert.equal(made.cues[made.cues.length - 1]!.endMs, 8800);
  assert.equal(words(made.cues), script, "the captions are the script, word for word");
  for (let i = 0; i + 1 < made.cues.length; i++) assert.ok(made.cues[i]!.endMs <= made.cues[i + 1]!.startMs, "in order, and never overlapping");
  assert.deepEqual(made.cues.map((c) => c.id), made.cues.map((_, i) => `c${i + 1}`));
});

test("a caption that is a part of a long sentence stays inside the time the sentence is spoken", () => {
  const made = captionsFromNarration(timing, script, 9000);
  const inSecond = made.cues.filter((c) => c.startMs >= 2400);
  assert.ok(inSecond.every((c) => c.startMs >= 2400 && c.endMs <= 8800));
});

test("the clip's lead-in moves every caption", () => {
  const plain = captionsFromNarration(timing, script, 9000, 0);
  const shifted = captionsFromNarration(timing, script, 9000, 50);
  assert.deepEqual(shifted.cues.map((c) => c.startMs - 50), plain.cues.map((c) => c.startMs));
  assert.deepEqual(shifted.cues.map((c) => c.endMs - 50), plain.cues.map((c) => c.endMs));
});

test("times the engine only estimated are timed by sentence but marked as estimates", () => {
  const made = captionsFromNarration({ ...timing, exactTimings: false }, script, 9000);
  assert.equal(made.estimated, true);
  assert.equal(made.fromVoice, false);
  assert.equal(made.cues[0]!.startMs, 200);
});

test("with no timing, or timing for other words, the script is spread over the speech as an estimate", () => {
  for (const t of [null, { ...timing, cues: [] }, { ...timing, cues: [{ start: 0, end: 2, text: "Some other words entirely." }] }]) {
    const made = captionsFromNarration(t, script, 9000, 50);
    assert.equal(made.estimated, true);
    assert.equal(made.fromVoice, false);
    assert.equal(made.cues[0]!.startMs, 50);
    assert.equal(made.cues[made.cues.length - 1]!.endMs, 9050);
    assert.equal(words(made.cues), script);
  }
});

test("sentences timed to overlap are put in order, so no caption runs into the next", () => {
  const overlap: NarrationCues = { exactTimings: true, duration: 6, cues: [{ start: 0, end: 3, text: "First thing." }, { start: 2, end: 5, text: "Second thing." }] };
  const made = captionsFromNarration(overlap, "First thing. Second thing.", 6000);
  assert.equal(made.cues[0]!.endMs, 2000);
  assert.equal(made.cues[1]!.startMs, 2000);
  const upside: NarrationCues = { exactTimings: true, duration: 6, cues: [{ start: 2, end: 5, text: "Second thing." }, { start: 0, end: 1.5, text: "First thing." }] };
  assert.equal(captionsFromNarration(upside, "First thing. Second thing.", 6000).cues[0]!.text, "First thing.", "sentences given out of order are put in order");
});
