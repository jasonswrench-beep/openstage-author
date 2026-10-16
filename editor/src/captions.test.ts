// Tests for captions: reading and writing WebVTT and SRT, how easy captions are to read, captions from a script, and the transcript.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  breakLongLines, buildTranscript, cuesFromScript, cueWarnings, DEFAULT_LIMITS, extrasFromEdit, formatSrt, formatSrtTime, formatVtt, formatVttTime, inOrder, newCueAfter,
  ordered, parseCaptions, parseClock, savingProblem, secondsField, trackWarnings, wrapLines, type Cue,
} from "./captions.ts";
import { createModel, type Item, type Model as EditModel, type Track } from "../../capture-edit/src/model.ts";

const cue = (startMs: number, endMs: number, text: string, id = "c1"): Cue => ({ id, startMs, endMs, text });

test("times are written the way each format writes them", () => {
  assert.equal(formatVttTime(65250), "00:01:05.250");
  assert.equal(formatSrtTime(65250), "00:01:05,250");
  assert.equal(formatVttTime(3_723_004), "01:02:03.004");
  assert.equal(formatVttTime(-5), "00:00:00.000", "never negative");
  assert.equal(formatVttTime(1.6), "00:00:00.002", "whole milliseconds");
});

test("times are read in every form an author or a file uses", () => {
  assert.equal(parseClock("12"), 12000);
  assert.equal(parseClock("12.5"), 12500);
  assert.equal(parseClock("1:05"), 65000);
  assert.equal(parseClock("1:05.25"), 65250);
  assert.equal(parseClock("0:01:05.250"), 65250);
  assert.equal(parseClock("00:01:05,250"), 65250);
  assert.equal(parseClock(" 90 "), 90000, "seconds can pass 60 when there are no colons");
  assert.equal(parseClock("1:2:3:4"), null);
  assert.equal(parseClock("1:75"), null, "seconds past 59 beside minutes");
  assert.equal(parseClock("0:75:00"), null, "minutes past 59 beside hours");
  assert.equal(parseClock("-3"), null);
  assert.equal(parseClock("abc"), null);
  assert.equal(parseClock(""), null);
  assert.equal(parseClock("1:05.12345"), null);
});

test("seconds in a field have no needless zeros", () => {
  assert.equal(secondsField(12000), "12");
  assert.equal(secondsField(12500), "12.5");
  assert.equal(secondsField(12345), "12.345");
  assert.equal(secondsField(0), "0");
});

test("WebVTT is read: header text, numbers, tags, entities, notes and styles", () => {
  const vtt = [
    "﻿WEBVTT - a lesson",
    "",
    "NOTE this is only a comment",
    "",
    "STYLE",
    "::cue { color: red }",
    "",
    "intro",
    "00:00:01.000 --> 00:00:03.500 align:start position:10%",
    "<v Jason>Hello &amp; welcome</v>",
    "to <b>the</b> course",
    "",
    "00:04.000 --> 00:06.000",
    "Second &lt;caption&gt;",
    "",
  ].join("\r\n");
  const r = parseCaptions(vtt);
  assert.equal(r.format, "vtt");
  assert.deepEqual(r.problems, []);
  assert.equal(r.cues.length, 2);
  assert.deepEqual(r.cues[0], { id: "c1", startMs: 1000, endMs: 3500, text: "Hello & welcome\nto the course" });
  assert.deepEqual(r.cues[1], { id: "c2", startMs: 4000, endMs: 6000, text: "Second <caption>" });
});

test("SRT is read: numbers, comma times and braces", () => {
  const srt = "1\n00:00:01,000 --> 00:00:03,000\n{\\an8}Top line\nsecond line\n\n2\n00:00:04,000 --> 00:00:05,000\n<i>Italic</i>\n";
  const r = parseCaptions(srt);
  assert.equal(r.format, "srt");
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.cues.map((c) => c.text), ["Top line\nsecond line", "Italic"]);
  assert.deepEqual(r.cues.map((c) => [c.startMs, c.endMs]), [[1000, 3000], [4000, 5000]]);
});

test("a caption whose times cannot be read is left out, and the file says so in words", () => {
  const r = parseCaptions("WEBVTT\n\n00:00:01.000 --> later\nOops\n\n00:00:02.000 --> 00:00:03.000\nFine\n");
  assert.deepEqual(r.cues.map((c) => c.text), ["Fine"]);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0]!, /times could not be read/);
});

test("a caption with no words is not kept, and text that is not captions gives none", () => {
  assert.deepEqual(parseCaptions("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<b></b>\n").cues, []);
  assert.deepEqual(parseCaptions("Just some words.\nAnd more.\n").cues, []);
  assert.deepEqual(parseCaptions("").cues, []);
});

test("a first line that only starts with WEBVTT is still read, with a note", () => {
  const r = parseCaptions("WEBVTTXX\n\n00:00:01.000 --> 00:00:02.000\nHi\n");
  assert.equal(r.cues.length, 1);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0]!, /first line/);
});

test("a header that runs straight into the first caption is still read", () => {
  const r = parseCaptions("WEBVTT\n00:00:01.000 --> 00:00:02.000\nHi\n");
  assert.deepEqual(r.cues.map((c) => c.text), ["Hi"]);
});

test("writing WebVTT leaves out empty captions and escapes what could start a tag", () => {
  const out = formatVtt([cue(0, 1000, "a < b & c > d"), cue(1000, 1000, "never"), cue(2000, 3000, "   "), cue(4000, 5000, "x --> y")]);
  assert.equal(out.startsWith("WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\n"), true);
  assert.match(out, /a &lt; b &amp; c &gt; d/);
  assert.doesNotMatch(out, /never/);
  assert.match(out, /x - -&gt; y/);
  assert.equal(out.endsWith("\n"), true);
  assert.doesNotMatch(out, /\n\n\n/);
  assert.equal(parseCaptions(out).cues.length, 2, "numbered again, in order, with nothing left out that had words");
});

test("what is written is read back the same", () => {
  const cues = [cue(0, 2500, "First line\nSecond line", "c1"), cue(3000, 4000, "Tom & Jerry <3", "c2"), cue(3_600_500, 3_601_500, "After an hour", "c3")];
  const back = parseCaptions(formatVtt(cues)).cues;
  assert.deepEqual(back.map((c) => [c.startMs, c.endMs, c.text]), cues.map((c) => [c.startMs, c.endMs, c.text]));
  const srtBack = parseCaptions(formatSrt(cues)).cues;
  assert.deepEqual(srtBack.map((c) => [c.startMs, c.endMs, c.text]), cues.map((c) => [c.startMs, c.endMs, c.text]));
});

test("captions whose times were estimated from a script say so in the file, and say so again when the file is read", () => {
  const cues = [cue(0, 2000, "Hello.")];
  const marked = formatVtt(cues, { estimated: true });
  assert.match(marked, /^WEBVTT\n\nNOTE Times estimated from a script and not yet checked\.\n\n1\n/);
  const back = parseCaptions(marked);
  assert.equal(back.estimated, true);
  assert.deepEqual(back.cues.map((c) => c.text), ["Hello."], "the note is not a caption");
  assert.equal(parseCaptions(formatVtt(cues)).estimated, false, "no mark unless asked");
  assert.equal(parseCaptions(formatSrt(cues)).estimated, false);
  assert.equal(parseCaptions("WEBVTT\n\nNOTE some other comment\n\n00:00:01.000 --> 00:00:02.000\nHi\n").estimated, false);
});

test("writing SRT uses commas and numbers from 1", () => {
  const out = formatSrt([cue(1500, 2500, "Hi")]);
  assert.equal(out, "1\n00:00:01,500 --> 00:00:02,500\nHi\n");
});

test("warnings say in words what is hard to read, and a good caption has none", () => {
  assert.deepEqual(cueWarnings(cue(0, 3000, "Short and fine.")), []);
  assert.match(cueWarnings(cue(0, 3000, "a\nb\nc")).join(" "), /3 lines; 2 is easier/);
  assert.match(cueWarnings(cue(0, 6000, "x".repeat(50))).join(" "), /50 characters; 42 or fewer/);
  assert.match(cueWarnings(cue(0, 1500, "This is a fairly long caption for so little time.")).join(" "), /characters a second/);
  assert.match(cueWarnings(cue(0, 500, "Hi")).join(" "), /0\.5 seconds; 1\.0 seconds or more/);
  assert.deepEqual(cueWarnings(cue(0, 3000, "")), ["It has no words."]);
  assert.deepEqual(cueWarnings(cue(2000, 1000, "Backwards")), ["It ends before it starts."]);
});

test("warnings follow the limits that are given", () => {
  const strict = { ...DEFAULT_LIMITS, maxChars: 10 };
  assert.deepEqual(cueWarnings(cue(0, 3000, "twelve chars")).length, 0);
  assert.equal(cueWarnings(cue(0, 3000, "twelve chars"), strict).length, 1);
});

test("captions together are checked for order, overlap and the end of the video", () => {
  const cues = [cue(0, 2000, "a"), cue(1500, 3000, "b"), cue(1000, 2500, "c"), cue(9000, 12000, "d")];
  const w = trackWarnings(cues, 10_000);
  assert.equal(w.length, 3);
  assert.match(w[0]!, /Caption 2 starts before caption 1 has ended/);
  assert.match(w[1]!, /Caption 3 starts before caption 2\. Put the captions in order/);
  assert.match(w[2]!, /Caption 4 is still on screen after the video has ended/);
  assert.deepEqual(trackWarnings([cue(0, 1000, "a"), cue(1000, 2000, "b")], null), [], "touching is not overlapping");
  assert.equal(trackWarnings([cue(0, 10_200, "a")], 10_000).length, 0, "a quarter second over is rounding, not a fault");
});

test("order: unsorted captions are found and put in order with new numbers", () => {
  const cues = [cue(3000, 4000, "later", "x"), cue(0, 1000, "first", "y")];
  assert.equal(inOrder(cues), false);
  const o = ordered(cues);
  assert.deepEqual(o.map((c) => [c.id, c.text]), [["c1", "first"], ["c2", "later"]]);
  assert.equal(inOrder(o), true);
});

test("a caption that ends before it starts cannot be saved, an empty one is just left out", () => {
  assert.equal(savingProblem([cue(0, 1000, "ok"), cue(3000, 2000, "bad")]), "Caption 2 ends before it starts. Change its times first.");
  assert.equal(savingProblem([cue(0, 1000, "ok"), cue(3000, 3000, "")]), null);
  assert.equal(savingProblem([cue(0, 1000, "")]), "There are no captions with words to save.");
  assert.equal(savingProblem([]), "There are no captions with words to save.");
});

test("a new caption follows the last one and does not run past the video", () => {
  assert.deepEqual(newCueAfter([], null), { id: "c1", startMs: 0, endMs: 2000, text: "" });
  assert.deepEqual(newCueAfter([cue(0, 5000, "a")], null), { id: "c2", startMs: 5000, endMs: 7000, text: "" });
  assert.equal(newCueAfter([cue(0, 5000, "a")], 6000).endMs, 6000);
  assert.equal(newCueAfter([cue(0, 5000, "a")], 20_000).endMs, 7000);
});

test("words are wrapped to the line length without cutting a word", () => {
  assert.deepEqual(wrapLines("one two three four five", 9), ["one two", "three", "four five"]);
  assert.deepEqual(wrapLines("supercalifragilistic", 5), ["supercalifragilistic"]);
  assert.deepEqual(wrapLines("   ", 10), []);
});

test("long lines are broken again to fit, and a caption that fits is left alone", () => {
  const cues = [cue(0, 4000, "In this short video we look at how a message gets lost,", "c1"), cue(4000, 6000, "Short.", "c2"), cue(6000, 9000, "x".repeat(60), "c3")];
  const r = breakLongLines(cues);
  assert.equal(r.changed, 1, "the word that is longer than a line cannot be broken, so it is not counted");
  assert.equal(r.cues[0]!.text, "In this short video we look at how a\nmessage gets lost,");
  assert.equal(r.cues[1], cues[1], "untouched");
  assert.equal(r.cues[2]!.text, "x".repeat(60));
  assert.deepEqual(cueWarnings(r.cues[0]!), []);
  assert.equal(breakLongLines(r.cues).changed, 0, "doing it again changes nothing");
});

test("a script becomes captions that each fit, in order, covering the video", () => {
  const script = "Welcome to the course. In this lesson we will look at three things: how to start, how to stop, and what to do when something goes wrong in between.\n\nThanks for watching.";
  const cues = cuesFromScript(script, 30_000);
  assert.ok(cues.length >= 4);
  assert.equal(cues[0]!.startMs, 0);
  assert.equal(cues[cues.length - 1]!.endMs, 30_000);
  cues.forEach((c, i) => {
    assert.ok(c.text.split("\n").length <= DEFAULT_LIMITS.maxLines, `caption ${i + 1} lines`);
    assert.ok(c.text.split("\n").every((l) => l.length <= DEFAULT_LIMITS.maxChars), `caption ${i + 1} width`);
    assert.ok(c.endMs > c.startMs);
    if (i > 0) assert.equal(c.startMs, cues[i - 1]!.endMs, "no gaps and no overlaps");
  });
  assert.equal(cues.map((c) => c.text.replace(/\n/g, " ")).join(" "), script.replace(/\s+/g, " ").trim(), "every word of the script is kept");
  assert.equal(inOrder(cues), true);
});

test("a script with no video length is spread at about 150 words a minute", () => {
  const cues = cuesFromScript("This is one sentence of sixty characters, which is quite short.", null);
  assert.equal(cues.length, 1);
  assert.ok(cues[0]!.endMs > 3000 && cues[0]!.endMs < 6000, `${cues[0]!.endMs}`);
});

test("an empty script gives no captions", () => {
  assert.deepEqual(cuesFromScript("  \n\n ", 10_000), []);
});

test("a very long sentence with no punctuation is still cut to fit", () => {
  const long = Array.from({ length: 60 }, (_v, i) => `word${i}`).join(" ");
  const cues = cuesFromScript(long, 60_000);
  assert.ok(cues.length > 3);
  assert.ok(cues.every((c) => c.text.split("\n").length <= 2 && c.text.split("\n").every((l) => l.length <= 42)));
  assert.equal(cues.map((c) => c.text.replace(/\n/g, " ")).join(" "), long);
});

// ---- the transcript

function overlay(items: Item[]): Track {
  return { id: "track-1", kind: "overlay", name: "Overlays", clips: [], items };
}
function modelWith(...tracks: Track[]): EditModel {
  return { ...createModel(), tracks };
}
const base = { name: "n", durationMs: 1000 };

test("what is on screen is found in the edit, in order, and only what is said in words", () => {
  const quiet = { ...base, id: "i3", kind: "zoom", startMs: 0, rect: { x: 0, y: 0, width: 5000, height: 5000 }, transitionMs: 300, description: "" } as Item;
  assert.deepEqual(extrasFromEdit(modelWith({ id: "track-1", kind: "zoom", name: "Zoom", clips: [], items: [quiet] })), [], "a zoom with no description says nothing");

  const text = { ...base, id: "i1", kind: "text", startMs: 4000, text: "  Click   Save ", rect: { x: 0, y: 0, width: 1, height: 1 }, fontSizeBp: 500, color: "#FFFFFF", background: null, bold: false, align: "left" } as Item;
  const shape = { ...base, id: "i2", kind: "shape", startMs: 1000, shape: "rectangle", rect: { x: 0, y: 0, width: 1, height: 1 }, outline: "#FF0000", fill: null, lineWidthBp: 30, altText: "The Save button" } as Item;
  const decorative = { ...base, id: "i4", kind: "arrow", startMs: 2000, from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, color: "#FF0000", lineWidthBp: 30, altText: "Ignored", decorative: true } as Item;
  const blur = { ...base, id: "i5", kind: "blur", startMs: 500, rect: { x: 0, y: 0, width: 1, height: 1 } } as Item;
  const zoom = { ...base, id: "i6", kind: "zoom", startMs: 3000, rect: { x: 0, y: 0, width: 5000, height: 5000 }, transitionMs: 300, description: "the toolbar" } as Item;
  const m2 = modelWith(overlay([text, shape, decorative, blur]), { id: "track-2", kind: "zoom", name: "Zoom", clips: [], items: [zoom] });
  assert.deepEqual(extrasFromEdit(m2), [
    { atMs: 1000, text: "On screen: The Save button" },
    { atMs: 3000, text: "The picture zooms in: the toolbar" },
    { atMs: 4000, text: "On screen: Click Save" },
  ]);
});

test("a transcript runs the spoken words into paragraphs and puts on-screen events in brackets where they happen", () => {
  const cues = [cue(0, 2000, "Welcome to the lesson."), cue(2000, 4000, "Today we start."), cue(9000, 11_000, "Now click Save.", "c3")];
  const t = buildTranscript(cues, [{ atMs: 8500, text: "On screen: The Save button" }]);
  assert.equal(t, "Welcome to the lesson. Today we start.\n\n[On screen: The Save button]\n\nNow click Save.");
});

test("a long pause starts a new paragraph, a short one does not", () => {
  const t = buildTranscript([cue(0, 1000, "One."), cue(2000, 3000, "Two."), cue(8000, 9000, "Three.")], []);
  assert.equal(t, "One. Two.\n\nThree.");
});

test("a transcript with no captions still gives the on-screen events, and nothing at all gives an empty string", () => {
  assert.equal(buildTranscript([], [{ atMs: 0, text: "On screen: Title" }]), "[On screen: Title]");
  assert.equal(buildTranscript([], []), "");
  assert.equal(buildTranscript([cue(0, 1000, "  ")], []), "");
});

test("the words of a caption are squeezed to one line in the transcript", () => {
  assert.equal(buildTranscript([cue(0, 1000, "Two\nlines   here")], []), "Two lines here");
});
