// Writes a WebM file from video and sound that are already encoded (by the window's own encoders, fast.ts). The file is whole when it is written: it says how long
// it is, it has a table of where its keyframes are (so a player can jump about in it at once), and its sound and picture are in time order. It is written
// in memory in two passes, because the table comes before the clusters it points into and so has to know how long everything before them is.

export interface MuxChunk {
  /** 1 for the picture, 2 for the sound. */
  track: 1 | 2;
  timestampUs: number;
  /** A keyframe (every sound chunk is one). */
  key: boolean;
  data: Uint8Array;
}

export interface MuxInit {
  width: number;
  height: number;
  videoCodec: "V_VP8" | "V_VP9";
  /** The sound, if there is any: its rate, channels, what the decoder needs to be told (the Opus header), and how many samples it skips at the start. */
  audio: null | { sampleRate: number; channels: number; codecPrivate: Uint8Array; preSkipSamples: number };
  durationMs: number;
}

const text = new TextEncoder();

/** The bytes of an element's size: its length, with the leading bit that says how many bytes the size takes. At least `minLen` bytes. */
export function encodeSize(value: number, minLen = 1): Uint8Array | null {
  for (let len = minLen; len <= 8; len++) {
    if (value < 2 ** (7 * len) - 1) {
      const out = new Uint8Array(len);
      let v = value;
      for (let i = len - 1; i >= 0; i--) {
        out[i] = v % 256;
        v = Math.floor(v / 256);
      }
      out[0]! |= 1 << (8 - len);
      return out;
    }
  }
  return null;
}

const idBytes = (id: number): number[] => {
  const out: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v % 256);
  return out;
};

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** An element: its id, its size, its content. */
function el(id: number, ...content: Uint8Array[]): Uint8Array {
  const body = concat(content);
  const size = encodeSize(body.length, 1);
  if (!size) throw new Error("An element is too large to write.");
  return concat([Uint8Array.from(idBytes(id)), size, body]);
}

/** A whole number, in as few bytes as hold it, or exactly `len` bytes when the table has to know its size beforehand. */
function uint(id: number, value: number, len?: number): Uint8Array {
  const bytes: number[] = [];
  let v = value;
  do {
    bytes.unshift(v % 256);
    v = Math.floor(v / 256);
  } while (v > 0);
  while (len !== undefined && bytes.length < len) bytes.unshift(0);
  return el(id, Uint8Array.from(bytes));
}

function float64(id: number, value: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, value);
  return el(id, b);
}

const str = (id: number, s: string): Uint8Array => el(id, text.encode(s));

const ID = {
  EBML: 0x1a45dfa3, Segment: 0x18538067, Info: 0x1549a966, Tracks: 0x1654ae6b, Cues: 0x1c53bb6b, Cluster: 0x1f43b675,
  TimecodeScale: 0x2ad7b1, Duration: 0x4489, MuxingApp: 0x4d80, WritingApp: 0x5741,
  TrackEntry: 0xae, TrackNumber: 0xd7, TrackUID: 0x73c5, TrackType: 0x83, CodecID: 0x86, FlagLacing: 0x9c, CodecPrivate: 0x63a2, CodecDelay: 0x56aa, SeekPreRoll: 0x56bb,
  Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba, Audio: 0xe1, SamplingFrequency: 0xb5, Channels: 0x9f,
  CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueTrack: 0xf7, CueClusterPosition: 0xf1,
  Timecode: 0xe7, SimpleBlock: 0xa3,
} as const;

/** A cluster holds at most this much time, so a block's time inside it always fits the 16 bits the file gives it. */
const MAX_CLUSTER_MS = 30_000;

interface Built {
  bytes: Uint8Array;
  /** When the cluster starts, in milliseconds, if it starts with a keyframe of the picture (so a player can land there). */
  keyAtMs: number | null;
}

function buildCluster(blocks: readonly MuxChunk[]): Built {
  const startMs = Math.round(blocks[0]!.timestampUs / 1000);
  const parts: Uint8Array[] = [uint(ID.Timecode, startMs)];
  for (const b of blocks) {
    const rel = Math.round(b.timestampUs / 1000) - startMs;
    const head = Uint8Array.from([0x80 | b.track, (rel >> 8) & 0xff, rel & 0xff, b.key ? 0x80 : 0]);
    parts.push(el(ID.SimpleBlock, head, b.data));
  }
  const first = blocks[0]!;
  return { bytes: el(ID.Cluster, ...parts), keyAtMs: first.track === 1 && first.key ? startMs : null };
}

export function writeWebm(init: MuxInit, chunks: readonly MuxChunk[]): Uint8Array {
  const header = el(ID.EBML,
    uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8), str(0x4282, "webm"), uint(0x4287, 4), uint(0x4285, 2));
  const info = el(ID.Info,
    uint(ID.TimecodeScale, 1_000_000), float64(ID.Duration, init.durationMs), str(ID.MuxingApp, "OpenStage Presenter"), str(ID.WritingApp, "OpenStage Author"));

  const entries: Uint8Array[] = [
    el(ID.TrackEntry, uint(ID.TrackNumber, 1), uint(ID.TrackUID, 1), uint(ID.TrackType, 1), str(ID.CodecID, init.videoCodec), uint(ID.FlagLacing, 0),
      el(ID.Video, uint(ID.PixelWidth, init.width), uint(ID.PixelHeight, init.height))),
  ];
  if (init.audio) {
    const a = init.audio;
    entries.push(el(ID.TrackEntry, uint(ID.TrackNumber, 2), uint(ID.TrackUID, 2), uint(ID.TrackType, 2), str(ID.CodecID, "A_OPUS"), uint(ID.FlagLacing, 0),
      el(ID.CodecPrivate, a.codecPrivate), uint(ID.CodecDelay, Math.round((a.preSkipSamples * 1e9) / a.sampleRate)), uint(ID.SeekPreRoll, 80_000_000),
      el(ID.Audio, float64(ID.SamplingFrequency, a.sampleRate), uint(ID.Channels, a.channels))));
  }
  const tracks = el(ID.Tracks, ...entries);

  // Sound and picture in the order of their times, a new cluster at each keyframe of the picture (and whenever one has run long).
  const sorted = [...chunks].sort((a, b) => a.timestampUs - b.timestampUs || a.track - b.track);
  const groups: MuxChunk[][] = [];
  for (const c of sorted) {
    const current = groups[groups.length - 1];
    const startsNew = !current || (c.track === 1 && c.key && current.some((x) => x.track === 1)) || c.timestampUs / 1000 - current[0]!.timestampUs / 1000 >= MAX_CLUSTER_MS;
    if (startsNew) groups.push([c]);
    else current!.push(c);
  }
  const clusters = groups.map(buildCluster);

  // The table of keyframes comes before the clusters, so its size has to be known before it is written: every number in it is a fixed four bytes.
  const cuePoints = clusters.filter((c) => c.keyAtMs !== null).length;
  const cuesSize = el(ID.Cues, ...Array.from({ length: cuePoints }, () => el(ID.CuePoint, uint(ID.CueTime, 0, 4), el(ID.CueTrackPositions, uint(ID.CueTrack, 1), uint(ID.CueClusterPosition, 0, 4))))).length;
  let at = info.length + tracks.length + cuesSize;
  const points: Uint8Array[] = [];
  for (const c of clusters) {
    if (c.keyAtMs !== null) points.push(el(ID.CuePoint, uint(ID.CueTime, c.keyAtMs, 4), el(ID.CueTrackPositions, uint(ID.CueTrack, 1), uint(ID.CueClusterPosition, at, 4))));
    at += c.bytes.length;
  }
  const cues = el(ID.Cues, ...points);
  if (cues.length !== cuesSize) throw new Error("The table of keyframes was not the size it was worked out to be.");

  const body = concat([info, tracks, cues, ...clusters.map((c) => c.bytes)]);
  const size = encodeSize(body.length, 8)!;
  return concat([header, Uint8Array.from(idBytes(ID.Segment)), size, body]);
}

/** The Opus header a decoder is told about the sound: what the file's CodecPrivate holds when the encoder did not give one. */
export function opusHead(channels: number, sampleRate: number, preSkipSamples = 312): Uint8Array {
  const b = new Uint8Array(19);
  b.set(text.encode("OpusHead"), 0);
  b[8] = 1;
  b[9] = channels;
  b[10] = preSkipSamples & 0xff;
  b[11] = (preSkipSamples >> 8) & 0xff;
  new DataView(b.buffer).setUint32(12, sampleRate, true);
  return b;
}
