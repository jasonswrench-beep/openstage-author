import assert from "node:assert/strict";
import { test } from "node:test";
import { blinkAt, drawFrame, drawLabel, shade, swayAt, type Ctx } from "./draw.ts";
import { MOUTH_EASE_MS, MOUTH_LEAD_MS, MOUTH_SHAPES, parsePresenters, parseTrack, poseAt, poseForPicture, shapeAt, type Look, type MouthPose, type MouthShape, type MouthTrack } from "./look.ts";
import { MOUTH_LOOK, lookOf, mixLook } from "./mouthdraw.ts";
import { blockFor, clipStatus, creditForClip, fileHint, framingStyle, madeFrom, startingAltText } from "./status.ts";
import { webmDuration, webmWithDuration } from "./webm.ts";
import { newNarration } from "../narration.ts";

const look: Look = { skin: "#e6b995", hair: { style: "short", color: "#2b2118" }, shirt: "#1f7a8c", background: "#dcecf3", glasses: false, eyes: "#2b2118" };
const guide = { id: "lite-guide", name: "Guide", tier: "lite", description: "An illustrated guide with short dark hair and a teal shirt, facing the camera", look };

// ---- what the add-on says

test("presenters the add-on describes are read, and one that is not whole is left out", () => {
  const raw = { presenters: [guide, { ...guide, id: "lite-two" }, { ...guide, id: "Bad Id" }, { ...guide, id: "lite-three", look: { ...look, skin: "red" } }, { ...guide, id: "lite-four", tier: "standard" }, { ...guide, id: "lite-guide" }, "nonsense", null] };
  assert.deepEqual(parsePresenters(raw).map((p) => p.id), ["lite-guide", "lite-two"]);
  assert.deepEqual(parsePresenters({ presenters: [{ ...guide, look: { ...look, hair: { style: "bald", color: "#000000" } } }] }), []);
  assert.deepEqual(parsePresenters({ presenters: [{ ...guide, description: "" }] }), []);
  assert.deepEqual(parsePresenters(null), []);
  assert.deepEqual(parsePresenters({ presenters: "no" }), []);
});

const raw = { durationMs: 2000, fps: 25, runs: [[0, "closed"], [200, "open"], [600, "teeth"], [1000, "closed"]] };

test("a mouth track is read, and the shape at a moment is the one whose run it is in", () => {
  const t = parseTrack(raw);
  assert.equal(t.durationMs, 2000);
  assert.deepEqual([0, 199, 200, 599, 600, 999, 1000, 5000].map((ms) => shapeAt(t, ms)), ["closed", "closed", "open", "open", "teeth", "teeth", "closed", "closed"]);
  assert.equal(shapeAt(t, -50), "closed");
});

test("a mouth track says what it follows: the words, or the sound when it does not say", () => {
  assert.equal(parseTrack(raw).source, "sound");
  assert.equal(parseTrack({ ...raw, source: "phonemes" }).source, "phonemes");
  assert.equal(parseTrack({ ...raw, source: "sound" }).source, "sound");
  assert.equal(parseTrack({ ...raw, source: "anything else" }).source, "sound");
});

test("a mouth track says whether each sound was timed one by one: measured, estimated by weight, or none", () => {
  assert.equal(parseTrack({ ...raw, source: "phonemes", timing: "measured" }).timing, "measured");
  assert.equal(parseTrack({ ...raw, source: "phonemes", timing: "estimated" }).timing, "estimated");
  assert.equal(parseTrack({ ...raw, source: "phonemes" }).timing, "estimated", "an add-on from before the times were kept shares each word's time by weight");
  assert.equal(parseTrack({ ...raw, source: "phonemes", timing: "anything else" }).timing, "estimated");
  assert.equal(parseTrack({ ...raw, source: "sound", timing: "measured" }).timing, "none", "a track that follows the sound has no timing of words");
  assert.equal(parseTrack(raw).timing, "none");
});

test("a mouth track that cannot be used is refused with a sentence", () => {
  const bad: unknown[] = [null, "x", {}, { ...raw, durationMs: -1 }, { ...raw, durationMs: 9e9 }, { ...raw, fps: 0 }, { ...raw, fps: 500 }, { ...raw, runs: [] },
    { ...raw, runs: [[100, "closed"]] }, { ...raw, runs: [[0, "closed"], [0, "open"]] }, { ...raw, runs: [[0, "closed"], [300, "open"], [200, "wide"]] },
    { ...raw, runs: [[0, "grin"]] }, { ...raw, runs: [["0", "closed"]] }, { ...raw, runs: [[0]] }, { ...raw, runs: "no" }];
  for (const b of bad) assert.throws(() => parseTrack(b), /could not be understood/, JSON.stringify(b)?.slice(0, 60));
});

// ---- the block, and when a clip is out of date

const speech = newNarration("Welcome to the course.");

test("what a clip was made from is the narration and the settings, so changing any of them makes it out of date", () => {
  const block = blockFor(speech, { id: "lite-guide", tier: "lite", framing: "circle", label: true });
  assert.match(block.madeFrom, /^sha256:[0-9a-f]{64}$/);
  const obj = { type: "video" as const, narration: speech, presenter: block };
  assert.equal(clipStatus(obj), "up-to-date");
  assert.equal(clipStatus({ ...obj, narration: { ...speech, script: "Welcome back." } }), "out-of-date");
  assert.equal(clipStatus({ ...obj, narration: { ...speech, speed: 1.2 } }), "out-of-date");
  assert.equal(clipStatus({ ...obj, narration: { ...speech, voice: "am_adam" } }), "out-of-date");
  assert.equal(clipStatus({ ...obj, presenter: { ...block, framing: "rounded" } }), "out-of-date");
  assert.equal(clipStatus({ ...obj, presenter: { ...block, label: false } }), "out-of-date");
  assert.equal(clipStatus({ ...obj, presenter: { ...block, id: "lite-coach" } }), "out-of-date");
  assert.equal(clipStatus({ ...obj, narration: null }), "no-narration");
  assert.equal(clipStatus({ type: "video", narration: speech, presenter: undefined as never }), "not-a-clip");
  assert.equal(clipStatus({ type: "text" as never, narration: speech, presenter: block }), "not-a-clip");
});

test("the hash is made as the format says: the narration's hash, the presenter, tier, framing and label, one to a line", () => {
  const a = madeFrom(speech, { id: "lite-guide", tier: "lite", framing: "rounded", label: false });
  assert.equal(a, madeFrom(speech, { id: "lite-guide", tier: "lite", framing: "rounded", label: false }));
  assert.notEqual(a, madeFrom(speech, { id: "lite-guide", tier: "lite", framing: "rounded", label: true }));
});

test("the framing is the shell of the picture, so the clip itself is always a plain square", () => {
  assert.deepEqual(framingStyle("rectangle"), {});
  assert.deepEqual(framingStyle("rounded"), { radius: 28 });
  assert.deepEqual(framingStyle("circle", 360), { radius: 180 });
});

test("the credit says a program made the clip, from the words, and the alt text starts from the presenter in words", () => {
  const p = parsePresenters({ presenters: [guide] })[0]!;
  const c = creditForClip({ path: "assets/video/presenter-x.webm", presenter: p, script: "  Welcome   to the course. ".repeat(20), madeAt: "2026-11-16T10:00:00Z" });
  assert.equal(c.source.provider, "generated");
  assert.equal(c.source.requiresCredit, true);
  assert.equal(c.source.generated?.service, "openstage-presenter");
  assert.equal(c.source.generated?.model, "lite-guide");
  assert.ok((c.source.generated?.prompt.length ?? 999) <= 200);
  assert.match(startingAltText(p), /^An illustrated guide .*, speaking\.$/);
  assert.equal(fileHint(p, "Welcome to the course, everyone and then some"), "lite-guide Welcome to the course,");
});

// ---- the drawing

/** A canvas that writes down what it is asked to do. */
function recorder(): { ctx: Ctx; log: string[] } {
  const log: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]): void => { log.push(`${k}(${args.map((a) => (typeof a === "number" ? Math.round(a * 1000) / 1000 : String(a))).join(",")})`); }),
    set: (t, k: string, v) => { t[k] = v; if (k === "fillStyle" || k === "font") log.push(`${k}=${String(v)}`); return true; },
  }) as unknown as Ctx;
  return { ctx, log };
}

test("blinks are short, regular and never at the very start; the sway is small", () => {
  assert.equal(blinkAt(0), 0);
  assert.equal(blinkAt(1000), 0);
  assert.ok(blinkAt(3740 + 80) > 0.95, "shut at the middle of a blink");
  assert.equal(blinkAt(3900 + 100), 0);
  assert.ok(blinkAt(3900 + 3820) > 0.95, "and again every 3.9 seconds");
  for (let ms = 0; ms < 60000; ms += 137) {
    const s = swayAt(ms);
    assert.ok(Math.abs(s.dx) <= 0.006 && Math.abs(s.dy) <= 0.004 && Math.abs(s.angle) <= 0.02 && Math.abs(s.breath) <= 0.004);
    assert.ok(blinkAt(ms) >= 0 && blinkAt(ms) <= 1);
  }
});

test("colours are made lighter and darker without leaving the range", () => {
  assert.equal(shade("#808080", 0), "#808080");
  assert.equal(shade("#000000", 1), "#ffffff");
  assert.equal(shade("#ffffff", -1), "#000000");
  assert.match(shade("#e6b995", -0.1), /^#[0-9a-f]{6}$/);
});

test("every mouth shape is drawn differently, and the picture is the same for the same moment", () => {
  const made = new Map<string, string>();
  for (const shape of MOUTH_SHAPES) {
    const { ctx, log } = recorder();
    drawFrame(ctx, look, shape, 1234, 720, false);
    made.set(shape, log.join("\n"));
    const again = recorder();
    drawFrame(again.ctx, look, shape, 1234, 720, false);
    assert.equal(again.log.join("\n"), log.join("\n"), `${shape} is drawn the same way twice`);
  }
  assert.equal(new Set(made.values()).size, MOUTH_SHAPES.length, "eleven shapes, eleven different pictures");
});

test("a mouth between two shapes is drawn from the numbers between them, and resting in a shape is that shape", () => {
  const draw = (m: MouthShape | MouthPose): string => { const r = recorder(); drawFrame(r.ctx, look, m, 1234, 720, false); return r.log.join("\n"); };
  for (const shape of MOUTH_SHAPES) {
    assert.equal(draw({ from: shape, to: "open", mix: 0 }), draw(shape), `${shape} at the start of a move is the shape`);
    assert.equal(draw({ from: "wide", to: shape, mix: 0 }), draw("wide"), `a move to ${shape} has not begun`);
  }
  const half = draw({ from: "closed", to: "open", mix: 0.5 });
  assert.notEqual(half, draw("closed"));
  assert.notEqual(half, draw("open"));
  assert.notEqual(half, draw({ from: "closed", to: "open", mix: 0.25 }));
  // a mouth nearly shut is a very thin shape: its lips are drawn with a round join, never a pointed one that would spike out at the corners
  const thin = recorder();
  drawFrame(thin.ctx, look, { from: "teeth", to: "closed", mix: 0.84 }, 1234, 720, false);
  assert.equal((thin.ctx as unknown as Record<string, unknown>)["lineJoin"], "round");
  const between = mixLook(MOUTH_LOOK.closed, MOUTH_LOOK.open, 0.5);
  assert.equal(between.down, (MOUTH_LOOK.closed.down + MOUTH_LOOK.open.down) / 2);
  assert.equal(between.sag, (MOUTH_LOOK.closed.sag + MOUTH_LOOK.open.sag) / 2);
  assert.deepEqual(lookOf("wide"), MOUTH_LOOK.wide);
  assert.deepEqual(lookOf({ from: "wide", to: "round", mix: 0 }), MOUTH_LOOK.wide);
});

test("every mouth shape fits in the face and is made of sensible numbers", () => {
  assert.deepEqual(Object.keys(MOUTH_LOOK).sort(), [...MOUTH_SHAPES].sort());
  for (const [name, m] of Object.entries(MOUTH_LOOK)) {
    for (const [k, v] of Object.entries(m)) assert.ok(Number.isFinite(v) && v >= 0, `${name}.${k} is ${v}`);
    assert.ok(m.w >= 0.015 && m.w <= 0.055, `${name} is a sensible width`);
    assert.ok(m.up + m.down <= 0.08 && m.down < 0.06, `${name} does not open past the chin`);
    assert.ok(m.teethTop + m.teethBottom <= m.up + m.down + m.sag + 0.002, `${name}: the teeth fit in the opening`);
  }
  assert.ok(MOUTH_LOOK.closed.up === 0 && MOUTH_LOOK.closed.down === 0, "a shut mouth has no opening");
  assert.ok(MOUTH_LOOK.open.down > MOUTH_LOOK.mid.down && MOUTH_LOOK.mid.down > MOUTH_LOOK.small.down, "small, mid, open are in order");
  assert.ok(MOUTH_LOOK.pucker.w < MOUTH_LOOK.round.w && MOUTH_LOOK.round.w < MOUTH_LOOK.wide.w, "pushed forward is narrower than rounded, which is narrower than spread");
});

test("the label is drawn only when it is on, and says what it is", () => {
  const on = recorder();
  drawFrame(on.ctx, look, "closed", 0, 720, true);
  const off = recorder();
  drawFrame(off.ctx, look, "closed", 0, 720, false);
  assert.ok(on.log.some((l) => l.startsWith("fillText(AI presenter")));
  assert.ok(!off.log.some((l) => l.startsWith("fillText")));
  const alone = recorder();
  drawLabel(alone.ctx, 720);
  assert.ok(alone.log.some((l) => l.startsWith("fillText(AI presenter")));
});

test("glasses and the three hair styles change the picture, and the eyes shut for a blink", () => {
  const of = (l: Look, ms = 0): string => { const r = recorder(); drawFrame(r.ctx, l, "closed", ms, 720, false); return r.log.join("\n"); };
  const plain = of(look);
  assert.notEqual(of({ ...look, glasses: true }), plain);
  const styles = (["short", "curly", "long"] as const).map((style) => of({ ...look, hair: { ...look.hair, style } }));
  assert.equal(new Set(styles).size, 3);
  const whites = (s: string): number => s.split("\n").filter((l) => l === "fillStyle=#ffffff").length;
  assert.ok(whites(of(look, 1000)) >= 4, "open eyes have whites and a shine");
  assert.equal(whites(of(look, 3740 + 80)), 0, "a shut eye is a line, with no white");
});

// ---- the file

/** A little WebM: the file's header, a segment, an Info block (with a timecode scale, a writing application and maybe a duration) and an empty cluster. */
function webm(opts: { segmentSize?: boolean; duration?: number } = {}): Uint8Array {
  const info: number[] = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40, 0x57, 0x41, 0x84, 0x74, 0x65, 0x73, 0x74];
  if (opts.duration !== undefined) {
    const d = new Uint8Array(8);
    new DataView(d.buffer).setFloat64(0, opts.duration);
    info.push(0x44, 0x89, 0x88, ...d);
  }
  const cluster = [0x1f, 0x43, 0xb6, 0x75, 0x82, 0xe7, 0x81];
  const infoElement = [0x15, 0x49, 0xa9, 0x66, 0x80 | info.length, ...info];
  const body = [...infoElement, ...cluster];
  const segment = opts.segmentSize ? [0x18, 0x53, 0x80, 0x67, 0x80 | body.length, ...body] : [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...body];
  return new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80, ...segment]);
}

test("a recorded WebM gets its length written in, and nothing else changes", () => {
  const before = webm();
  assert.equal(webmDuration(before), null);
  const after = webmWithDuration(before, 12345);
  assert.equal(webmDuration(after), 12345);
  assert.equal(after.length, before.length + 11);
  const tail = (b: Uint8Array): number[] => [...b.subarray(b.length - 7)];
  assert.deepEqual(tail(after), tail(before), "the cluster is as it was");
  assert.deepEqual([...after.subarray(0, 5)], [...before.subarray(0, 5)], "and the header");
});

test("a length the file already has is replaced, and a segment with a size has its size kept right", () => {
  const known = webm({ segmentSize: true, duration: 500 });
  assert.equal(webmDuration(known), 500);
  const after = webmWithDuration(known, 2500);
  assert.equal(webmDuration(after), 2500);
  assert.equal(after.length, known.length, "one length out, one in");
  const grown = webmWithDuration(webm({ segmentSize: true }), 2500);
  assert.equal(webmDuration(grown), 2500);
  // the segment's declared size runs exactly to the end of the file
  assert.equal(grown[9]! & 0x7f, grown.length - 10, "the size of the segment is right");
});

test("a file that is not a WebM is returned as it was", () => {
  for (const junk of [new Uint8Array(), new Uint8Array([1, 2, 3]), new TextEncoder().encode("RIFF....WAVE"), webm().subarray(0, 12)]) {
    assert.equal(webmWithDuration(junk, 1000), junk);
    assert.equal(webmDuration(junk), null);
  }
  assert.equal(webmWithDuration(webm(), Number.NaN).length, webm().length);
});

test("the shapes are the eleven the add-on makes, and a track can use any of them", () => {
  const shapes: MouthShape[] = ["closed", "small", "mid", "open", "wide", "round", "pucker", "sh", "teeth", "fv", "tongue"];
  assert.deepEqual([...MOUTH_SHAPES], shapes);
  const t: MouthTrack = parseTrack(raw);
  assert.ok(t.runs.every((r) => MOUTH_SHAPES.includes(r.shape)));
  const all = parseTrack({ durationMs: 1100, fps: 25, runs: shapes.map((s, i) => [i * 100, s]) });
  assert.deepEqual(all.runs.map((r) => r.shape), shapes);
  assert.throws(() => parseTrack({ durationMs: 100, fps: 25, runs: [[0, "grin"]] }), /could not be understood/);
});

// ---- the mouth in motion

/** A track with one run each time the shape changes, one shape to each picture of 25 a second. */
function grid(shapes: MouthShape[]): MouthTrack {
  const runs: MouthTrack["runs"] = [];
  shapes.forEach((shape, i) => {
    if (runs.length === 0 || runs[runs.length - 1]!.shape !== shape) runs.push({ atMs: i * 40, shape });
  });
  return { durationMs: shapes.length * 40, fps: 25, runs, source: "phonemes", timing: "measured" };
}

/** How much of a shape a pose is made of. */
const weight = (p: MouthPose, shape: MouthShape): number => (p.from === shape ? 1 - p.mix : 0) + (p.to === shape ? p.mix : 0);

const track: MouthTrack = { durationMs: 1000, fps: 25, runs: [{ atMs: 0, shape: "closed" }, { atMs: 200, shape: "open" }, { atMs: 600, shape: "closed" }], source: "phonemes", timing: "measured" };

test("a move from one shape to the next is centred on the moment the track changes, and is smooth", () => {
  assert.deepEqual(poseAt(track, 100), { from: "closed", to: "closed", mix: 0 });
  assert.deepEqual(poseAt(track, 400), { from: "open", to: "open", mix: 0 });
  assert.equal(poseAt(track, 200).mix, 0.5, "half way at the change");
  assert.equal(poseAt(track, 200).from, "closed");
  assert.equal(poseAt(track, 200).to, "open");
  assert.equal(poseAt(track, 150).mix, 0, "it has not begun half the ease before");
  assert.deepEqual(poseAt(track, 250), { from: "open", to: "open", mix: 0 }, "and it has finished half the ease after");
  assert.ok(poseAt(track, 175).mix > 0 && poseAt(track, 175).mix < 0.5, "begun, before the change");
  assert.ok(poseAt(track, 225).mix > 0.5 && poseAt(track, 225).mix < 1, "nearly there, after it");
  assert.equal(MOUTH_EASE_MS, 100);
  // and the move out of it
  assert.equal(poseAt(track, 600).mix, 0.5);
  assert.equal(poseAt(track, 600).to, "closed");
  assert.deepEqual(poseAt(track, 5000), { from: "closed", to: "closed", mix: 0 });
  assert.deepEqual(poseAt(track, -20), { from: "closed", to: "closed", mix: 0 });
});

test("the mouth is ahead of the sound: the picture is made from a little later in the track", () => {
  assert.equal(MOUTH_LEAD_MS, 40);
  // the sound opens at 200 ms. The picture shown from 160 ms is made from 160 + 20 (its middle) + 40 (the lead) = 220 ms, nearly open
  const p = poseForPicture(track, 160);
  assert.equal(shapeAt(track, 160), "closed", "the sound has not opened yet");
  assert.equal(p.to, "open");
  assert.ok(p.mix > 0.5, `it is more than half open before the sound: ${p.mix}`);
  assert.deepEqual(poseForPicture(track, 200), { from: "open", to: "open", mix: 0 });
  assert.deepEqual(poseForPicture(track, 0), { from: "closed", to: "closed", mix: 0 });
  // the middle of a picture is half of it, whatever the picture rate the track was made at
  assert.equal(poseForPicture(track, 160).mix, poseAt(track, 160 + 20 + 40).mix);
  assert.equal(poseForPicture({ ...track, fps: 50 }, 160).mix, poseAt(track, 160 + 10 + 40).mix);
});

test("a shape that lasts one picture is never blended away", () => {
  // lips together for one picture between two vowels, a shape of one picture between a pause and a vowel, and so on
  const shapes: MouthShape[] = ["open", "open", "open", "closed", "open", "open", "open", "open", "closed", "closed", "teeth", "wide", "wide", "wide", "wide", "fv", "round", "round"];
  const t = grid(shapes);
  let one = 0;
  for (let i = 1; i < shapes.length - 1; i++) {
    if (shapes[i] === shapes[i - 1] || shapes[i] === shapes[i + 1]) continue;
    // the picture shown from (i - 1) * 40 is the one made from the middle of the track's picture i
    const p = poseForPicture(t, (i - 1) * 40);
    assert.equal(p.mix, 0, `picture ${i - 1}`);
    assert.equal(p.from, shapes[i], `picture ${i - 1} shows ${shapes[i]} whole`);
    one++;
  }
  assert.ok(one >= 3, `${one} one-picture shapes tried`);
  // and the same for one picture beside shapes that last a long time
  const long: MouthTrack = { durationMs: 2000, fps: 25, runs: [{ atMs: 0, shape: "open" }, { atMs: 1000, shape: "closed" }, { atMs: 1040, shape: "open" }], source: "phonemes", timing: "measured" };
  assert.deepEqual(poseForPicture(long, 1000 - 40), { from: "closed", to: "open", mix: 0 }, "the picture made from the middle of the one-picture shape");
});

test("the mouth never jumps: the shapes in a pose change smoothly from moment to moment, whatever the track", () => {
  let seed = 7;
  const next = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let trial = 0; trial < 40; trial++) {
    const runs: MouthTrack["runs"] = [{ atMs: 0, shape: "closed" }];
    let at = 0;
    for (let i = 0; i < 30; i++) {
      at += 40 * (1 + Math.floor(next() * 8));
      let shape = MOUTH_SHAPES[Math.floor(next() * MOUTH_SHAPES.length)]!;
      if (shape === runs[runs.length - 1]!.shape) shape = shape === "closed" ? "open" : "closed";
      runs.push({ atMs: at, shape });
    }
    const t: MouthTrack = { durationMs: at + 200, fps: 25, runs, source: "phonemes", timing: "measured" };
    for (let ms = 0; ms < at + 100; ms += 1) {
      const a = poseAt(t, ms);
      const b = poseAt(t, ms + 1);
      assert.ok(a.mix >= 0 && a.mix <= 1 && MOUTH_SHAPES.includes(a.from) && MOUTH_SHAPES.includes(a.to));
      let change = 0;
      for (const shape of MOUTH_SHAPES) change += Math.abs(weight(a, shape) - weight(b, shape));
      assert.ok(change < 0.1, `trial ${trial}: the mouth changes by ${change} in a millisecond at ${ms}`);
    }
  }
});
