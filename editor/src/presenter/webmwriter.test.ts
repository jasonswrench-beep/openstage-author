import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeSize, opusHead, writeWebm, type MuxChunk, type MuxInit } from "./webmwriter.ts";
import { webmDuration, webmWithDuration } from "./webm.ts";

// ---- a small reader, only so the tests can see what was written

interface El { id: number; at: number; start: number; end: number }

function read(b: Uint8Array, at: number, limit: number): El {
  const first = b[at]!;
  const idLen = Math.clz32(first) - 24 + 1;
  let id = 0;
  for (let i = 0; i < idLen; i++) id = id * 256 + b[at + i]!;
  const s0 = b[at + idLen]!;
  const len = Math.clz32(s0) - 24 + 1;
  let size = s0 & (0xff >> len);
  for (let i = 1; i < len; i++) size = size * 256 + b[at + idLen + i]!;
  const start = at + idLen + len;
  assert.ok(start + size <= limit, "an element runs past its parent");
  return { id, at, start, end: start + size };
}

const children = (b: Uint8Array, e: El): El[] => {
  const out: El[] = [];
  for (let at = e.start; at < e.end; ) {
    const c = read(b, at, e.end);
    out.push(c);
    at = c.end;
  }
  return out;
};

const number = (b: Uint8Array, e: El): number => {
  let v = 0;
  for (let i = e.start; i < e.end; i++) v = v * 256 + b[i]!;
  return v;
};

const ID = { EBML: 0x1a45dfa3, Segment: 0x18538067, Info: 0x1549a966, Tracks: 0x1654ae6b, Cues: 0x1c53bb6b, Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3, CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueClusterPosition: 0xf1, CueTrack: 0xf7, TrackEntry: 0xae };

function parse(b: Uint8Array): { top: El[]; segment: El; seg: El[] } {
  const top: El[] = [];
  for (let at = 0; at < b.length; ) {
    const e = read(b, at, b.length);
    top.push(e);
    at = e.end;
  }
  const segment = top.find((e) => e.id === ID.Segment)!;
  return { top, segment, seg: children(b, segment) };
}

const init: MuxInit = { width: 720, height: 720, videoCodec: "V_VP9", audio: { sampleRate: 48000, channels: 1, codecPrivate: opusHead(1, 48000), preSkipSamples: 312 }, durationMs: 6400 };

/** Video at 25 a second for six seconds with a keyframe every two, and sound in 20 millisecond pieces. */
function chunks(seconds = 6): MuxChunk[] {
  const out: MuxChunk[] = [];
  for (let i = 0; i < seconds * 25; i++) out.push({ track: 1, timestampUs: i * 40_000, key: i % 50 === 0, data: Uint8Array.from([i & 255, 1, 2, 3]) });
  for (let i = 0; i < seconds * 50; i++) out.push({ track: 2, timestampUs: i * 20_000, key: true, data: Uint8Array.from([9, i & 255]) });
  return out.reverse(); // not in order: the writer puts them in order
}

test("sizes are written in as few bytes as hold them, or in the number asked for, and a size too large is refused", () => {
  assert.deepEqual([...encodeSize(0)!], [0x80]);
  assert.deepEqual([...encodeSize(126)!], [0xfe]);
  assert.deepEqual([...encodeSize(127)!], [0x40, 0x7f], "all ones in a byte means unknown, so 127 takes two");
  assert.deepEqual([...encodeSize(300)!], [0x41, 0x2c]);
  assert.deepEqual([...encodeSize(5, 4)!], [0x10, 0, 0, 5]);
  assert.equal(encodeSize(5, 8)!.length, 8);
  assert.equal(encodeSize(2 ** 56, 8), null);
});

test("the file is a WebM: a header, one segment with its size, and in it the info, the tracks, the table of keyframes and the clusters", () => {
  const file = writeWebm(init, chunks());
  const { top, segment, seg } = parse(file);
  assert.deepEqual(top.map((e) => e.id), [ID.EBML, ID.Segment]);
  assert.equal(segment.end, file.length, "the segment's size takes it to the end of the file");
  assert.deepEqual(seg.map((e) => e.id).filter((id, i, a) => a.indexOf(id) === i), [ID.Info, ID.Tracks, ID.Cues, ID.Cluster]);
  assert.equal(new TextDecoder().decode(file.subarray(top[0]!.start, top[0]!.end)).includes("webm"), true);
  assert.equal(webmDuration(file), 6400, "it says how long it is");
  assert.equal(webmWithDuration(file, 6400).length, file.length, "and one that already says is left alone in size");
  const tracks = children(file, seg.find((e) => e.id === ID.Tracks)!);
  assert.equal(tracks.length, 2);
});

test("a picture only file has one track and no sound track", () => {
  const picture = chunks().filter((c) => c.track === 1);
  const file = writeWebm({ ...init, audio: null }, picture);
  const tracks = children(file, parse(file).seg.find((e) => e.id === ID.Tracks)!);
  assert.equal(tracks.length, 1);
});

test("sound and picture are in the order of their times, in clusters that each start at a keyframe of the picture", () => {
  const file = writeWebm(init, chunks());
  const { seg } = parse(file);
  const clusters = seg.filter((e) => e.id === ID.Cluster);
  assert.equal(clusters.length, 3, "a keyframe every two seconds over six");
  let last = -1;
  for (const c of clusters) {
    const parts = children(file, c);
    const start = number(file, parts[0]!);
    assert.equal(parts[0]!.id, ID.Timecode);
    const blocks = parts.slice(1);
    assert.ok(blocks.every((p) => p.id === ID.SimpleBlock));
    const first = blocks[0]!;
    assert.equal(file[first.start], 0x81, "the first block of a cluster is the picture");
    assert.equal(file[first.start + 3], 0x80, "and a keyframe");
    for (const p of blocks) {
      const rel = (file[p.start + 1]! << 8) | file[p.start + 2]!;
      const ms = start + rel;
      assert.ok(ms >= last, "never back in time");
      last = ms;
    }
  }
  assert.deepEqual(clusters.map((c) => number(file, children(file, c)[0]!)), [0, 2000, 4000]);
});

test("every sound and picture chunk is in the file, unchanged, once", () => {
  const input = chunks();
  const file = writeWebm(init, input);
  const seen: string[] = [];
  for (const c of parse(file).seg.filter((e) => e.id === ID.Cluster)) {
    for (const p of children(file, c).slice(1)) seen.push(`${file[p.start]! & 0x7f}:${[...file.subarray(p.start + 4, p.end)].join(",")}`);
  }
  const want = input.map((c) => `${c.track}:${[...c.data].join(",")}`);
  assert.equal(seen.length, want.length);
  assert.deepEqual([...seen].sort(), [...want].sort());
});

test("the table of keyframes points exactly at the clusters, at the times they start", () => {
  const file = writeWebm(init, chunks());
  const { segment, seg } = parse(file);
  const points = children(file, seg.find((e) => e.id === ID.Cues)!);
  assert.equal(points.length, 3);
  const clusters = seg.filter((e) => e.id === ID.Cluster);
  points.forEach((p, i) => {
    assert.equal(p.id, ID.CuePoint);
    const [time, where] = children(file, p);
    assert.equal(number(file, time!), i * 2000);
    const position = number(file, children(file, where!).find((e) => e.id === ID.CueClusterPosition)!);
    assert.equal(segment.start + position, clusters[i]!.at, "the position is counted from the start of the segment's content");
    assert.equal(file[segment.start + position], 0x1f, "and that is where a cluster begins");
  });
});

test("a cluster that runs long without a keyframe is cut so a block's time always fits", () => {
  const long: MuxChunk[] = [];
  for (let i = 0; i < 25 * 70; i++) long.push({ track: 1, timestampUs: i * 40_000, key: i === 0, data: Uint8Array.from([1]) });
  const file = writeWebm({ ...init, audio: null, durationMs: 70_000 }, long);
  const clusters = parse(file).seg.filter((e) => e.id === ID.Cluster);
  assert.ok(clusters.length >= 3, "70 seconds takes at least three clusters of 30");
  for (const c of clusters) for (const p of children(file, c).slice(1)) assert.ok(((file[p.start + 1]! << 8) | file[p.start + 2]!) < 32768, "within the 16 bits");
  assert.equal(parse(file).seg.find((e) => e.id === ID.Cues) !== undefined, true);
});

test("the Opus header says the channels, the samples skipped at the start and the rate", () => {
  const h = opusHead(1, 48000);
  assert.equal(h.length, 19);
  assert.equal(new TextDecoder().decode(h.subarray(0, 8)), "OpusHead");
  assert.deepEqual([h[8], h[9], h[10]! | (h[11]! << 8)], [1, 1, 312]);
  assert.equal(new DataView(h.buffer).getUint32(12, true), 48000);
  assert.equal(opusHead(2, 44100, 400)[9], 2);
});
