import assert from "node:assert/strict";
import { test } from "node:test";
import { blinkAt, drawFrame, drawLabel, shade, swayAt, type Ctx } from "./draw.ts";
import { MOUTH_SHAPES, parsePresenters, parseTrack, shapeAt, type Look, type MouthShape, type MouthTrack } from "./look.ts";
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
  assert.equal(new Set(made.values()).size, MOUTH_SHAPES.length, "six shapes, six different pictures");
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

test("the shapes are the six the add-on makes", () => {
  const shapes: MouthShape[] = ["closed", "small", "open", "wide", "round", "teeth"];
  assert.deepEqual([...MOUTH_SHAPES], shapes);
  const t: MouthTrack = parseTrack(raw);
  assert.ok(t.runs.every((r) => MOUTH_SHAPES.includes(r.shape)));
});
