import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "../../capture-edit/src/index.ts";
import { buildEdit, captionsVtt, slideNumbers, videoNotes, vttTime, type VideoSlide } from "./videoedit.ts";
import type { NarrationAsset, Slide } from "./types.ts";

function slide(over: Partial<VideoSlide> & { name: string; startMs: number; lengthMs: number }): VideoSlide {
  return { pictures: [{ startMs: 0, endMs: over.lengthMs, file: `${over.name}.png` }], arrives: false, narration: [], ...over };
}

const voice = (file: string, startMs: number, durationMs: number, script = "Hello there. This is a slide.", cues: VideoSlide["narration"][0]["cues"] = null) => ({
  name: `Narration (${file})`, script, file, startMs, durationMs, cues,
});

const TWO: VideoSlide[] = [
  slide({ name: "One", startMs: 0, lengthMs: 5000, narration: [voice("n1.wav", 300, 3000)] }),
  slide({ name: "Two", startMs: 5000, lengthMs: 4000, arrives: true, pictures: [{ startMs: 0, endMs: 1000, file: "two-a.png" }, { startMs: 1000, endMs: 4000, file: "two-b.png" }] }),
];

test("the edit is one the recorder's own reader accepts, with nothing asked for and nothing wrong", () => {
  const { text } = buildEdit(TWO, true);
  const result = parse(text);
  assert.ok(result.ok, result.ok ? "" : result.message);
  assert.deepEqual(result.problems.filter((p) => p.severity === "error" || p.severity === "needs-attention"), []);
});

test("pictures follow one another with no gap and the sound sits where its narration starts", () => {
  const { text, lengthMs } = buildEdit(TWO, true);
  const edit = JSON.parse(text) as { tracks: { kind: string; clips: { startMs: number; sourceStartMs: number; sourceEndMs: number }[] }[] };
  const media = edit.tracks.find((t) => t.kind === "media")!;
  let at = 0;
  for (const clip of media.clips) {
    assert.equal(clip.startMs, at);
    assert.equal(clip.sourceStartMs, 0);
    at += clip.sourceEndMs;
  }
  assert.equal(at, lengthMs);
  assert.equal(lengthMs, 9000);
  const sound = edit.tracks.find((t) => t.kind === "audio")!;
  assert.deepEqual(sound.clips.map((c) => [c.startMs, c.sourceEndMs]), [[300, 3000]]);
});

test("a slide that arrives with an effect blends in over its first picture, never longer than the picture", () => {
  const { text, transitionCount } = buildEdit(TWO, true);
  assert.equal(transitionCount, 1);
  const edit = JSON.parse(text) as { schemaVersion: string; tracks: { clips: { name: string; transitionIn?: { kind: string; durationMs: number } }[] }[] };
  assert.equal(edit.schemaVersion, "0.4.0");
  const blended = edit.tracks[0]!.clips.filter((c) => c.transitionIn);
  assert.deepEqual(blended.map((c) => [c.name, c.transitionIn]), [["Two", { kind: "cross-fade", durationMs: 500 }]]);
  const short = buildEdit([TWO[0]!, slide({ name: "Three", startMs: 5000, lengthMs: 300, arrives: true, pictures: [{ startMs: 0, endMs: 300, file: "t.png" }] })], true);
  assert.equal((JSON.parse(short.text) as { tracks: { clips: { transitionIn?: { durationMs: number } }[] }[] }).tracks[0]!.clips[1]!.transitionIn!.durationMs, 300);
  assert.ok(parse(short.text).ok);
});

test("with transitions off, or when no slide arrives with an effect, the edit has none and says the older version", () => {
  const off = buildEdit(TWO, false);
  assert.equal(off.transitionCount, 0);
  assert.equal((JSON.parse(off.text) as { schemaVersion: string }).schemaVersion, "0.3.0");
  const plain = buildEdit([TWO[0]!, { ...TWO[1]!, arrives: false }], true);
  assert.equal(plain.transitionCount, 0);
  assert.ok(parse(plain.text).ok);
});

test("the first slide never blends in, because there is nothing before it", () => {
  const { transitionCount } = buildEdit([{ ...TWO[0]!, arrives: true }], true);
  assert.equal(transitionCount, 0);
});

test("two objects that say the same words share one sound file, listed once", () => {
  const same: VideoSlide[] = [slide({ name: "A", startMs: 0, lengthMs: 8000, narration: [voice("same.wav", 300, 2000), voice("same.wav", 2300, 2000)] })];
  const edit = JSON.parse(buildEdit(same, true).text) as { sources: { ref: { asset: string } }[]; tracks: { kind: string; clips: unknown[] }[] };
  assert.equal(edit.sources.filter((s) => s.ref.asset === "same.wav").length, 1);
  assert.equal(edit.tracks.find((t) => t.kind === "audio")!.clips.length, 2);
  assert.ok(parse(buildEdit(same, true).text).ok);
});

test("a narration too short for the edit format is left out, and a course with none has no sound track", () => {
  const short = buildEdit([slide({ name: "A", startMs: 0, lengthMs: 2000, narration: [voice("tiny.wav", 300, 50)] })], true);
  assert.equal((JSON.parse(short.text) as { tracks: unknown[] }).tracks.length, 1);
  assert.ok(parse(short.text).ok);
});

test("a picture shorter than a grid step is refused rather than written", () => {
  assert.throws(() => buildEdit([slide({ name: "A", startMs: 0, lengthMs: 50, pictures: [{ startMs: 0, endMs: 50, file: "a.png" }] })], true), /under 100 milliseconds/);
});

test("the same slides give the same bytes", () => {
  assert.equal(buildEdit(TWO, true).text, buildEdit(TWO, true).text);
});

test("times are written as WebVTT writes them", () => {
  assert.equal(vttTime(0), "00:00:00.000");
  assert.equal(vttTime(61_234), "00:01:01.234");
  assert.equal(vttTime(3_723_005), "01:02:03.005");
});

test("captions are the narration's sentences, at the time each is said, in the order of the video", () => {
  const slides: VideoSlide[] = [
    slide({ name: "One", startMs: 0, lengthMs: 6000, narration: [voice("a.wav", 300, 4000, "Hello. Welcome.", [{ start: 0, end: 1.2, text: "Hello." }, { start: 1.4, end: 3.9, text: "Welcome." }])] }),
    slide({ name: "Two", startMs: 6000, lengthMs: 5000, narration: [voice("b.wav", 300, 3000, "Second slide.", null)] }),
  ];
  const { text, cues } = captionsVtt(slides);
  assert.equal(cues, 3);
  assert.equal(text, [
    "WEBVTT", "",
    "1", "00:00:00.300 --> 00:00:01.500", "Hello.", "",
    "2", "00:00:01.700 --> 00:00:04.200", "Welcome.", "",
    "3", "00:00:06.300 --> 00:00:09.300", "Second slide.", "",
  ].join("\n"));
});

test("a caption lasts half a second at least when there is room, never runs past its sound, and carries no markup", () => {
  const slides: VideoSlide[] = [slide({ name: "One", startMs: 0, lengthMs: 4000, narration: [voice("a.wav", 300, 2000, "x", [
    { start: 0, end: 0.1, text: "Tom & <b>Jerry</b>" },
    { start: 1.9, end: 5, text: "Last\nline" },
  ])] })];
  const { text } = captionsVtt(slides);
  assert.match(text, /00:00:00\.300 --> 00:00:00\.800\nTom &amp; &lt;b&gt;Jerry&lt;\/b&gt;\n/);
  assert.match(text, /00:00:02\.200 --> 00:00:02\.300\nLast line\n/);
});

test("a course with no narration has captions with no cues", () => {
  assert.deepEqual(captionsVtt([slide({ name: "A", startMs: 0, lengthMs: 3000 })]), { text: "WEBVTT\n", cues: 0 });
});

test("slides are named in a sentence the way a person says them", () => {
  assert.equal(slideNumbers([3]), "Slide 3");
  assert.equal(slideNumbers([3, 5]), "Slides 3 and 5");
  assert.equal(slideNumbers([3, 5, 9]), "Slides 3, 5 and 9");
});

function realSlide(objects: { id: string; type: string }[], layers = 0): Slide {
  return { id: "s", name: "S", baseLayer: { id: "base", name: "Base", objects }, layers: Array.from({ length: layers }, (_, i) => ({ id: `l${i}`, name: "L", objects: [] })) } as unknown as Slide;
}

test("a slide with words that are read aloud, and nothing else to say, has no note", () => {
  const spoken: Record<string, NarrationAsset> = { a: { script: "Hello.", lang: "en-US", audio: "narration/x.wav", cues: null } };
  assert.deepEqual(videoNotes([realSlide([{ id: "a", type: "text" }, { id: "b", type: "image" }])], spoken), []);
});

test("words that nothing reads aloud are named, because in a video they are only a picture", () => {
  const spoken: Record<string, NarrationAsset> = { a: { script: "Hello.", lang: "en-US", audio: "narration/x.wav", cues: null } };
  const slides = [
    realSlide([{ id: "a", type: "text" }]),
    realSlide([{ id: "b", type: "text" }]),
    realSlide([{ id: "c", type: "table" }, { id: "d", type: "image" }]),
    realSlide([{ id: "e", type: "image" }]),
  ];
  assert.deepEqual(videoNotes(slides, spoken), [
    "Slides 2 and 3 have text on them but nothing is read aloud, so a viewer who cannot see the picture gets nothing from them. Add narration to them.",
  ]);
  const decorative = { id: "f", type: "text", accessibility: { decorative: true } } as unknown as { id: string; type: string };
  assert.deepEqual(videoNotes([realSlide([decorative])], {}), [], "words that are only decoration need no reading");
});

test("what a video cannot do is said slide by slide", () => {
  const spoken = (id: string): NarrationAsset => ({ script: "Say this.", lang: "en-US", audio: `narration/${id}.wav`, cues: null });
  const slides = [
    realSlide([{ id: "a", type: "text" }]),
    realSlide([{ id: "q", type: "quizQuestion" }, { id: "t", type: "text" }]),
    realSlide([{ id: "v", type: "video" }], 1),
    realSlide([{ id: "x", type: "interaction" }, { id: "r", type: "results" }]),
  ];
  const narration: Record<string, NarrationAsset> = { a: spoken("a"), t: { script: "Say this.", lang: "en-US", audio: null, cues: null } };
  const notes = videoNotes(slides, narration);
  assert.deepEqual(notes, [
    "Slide 2 has narration text but no audio has been made, so it is silent in the video. Make the audio and publish again.",
    "Slide 2 has text on it but nothing is read aloud, so a viewer who cannot see the picture gets nothing from it. Add narration to it.",
    "Slides 2 and 4: a question or other activity is shown as it is when the slide opens. A video cannot be answered.",
    "Slide 3: a video or sound on the slide is not played. A video shows only its first picture.",
    "Slide 4: a results box, a certificate or a timer is shown as it is when the slide opens, with no score or time running.",
    "Slide 3: only the main layer is shown. Layers that open from a button or an answer are not in the video.",
  ]);
});
