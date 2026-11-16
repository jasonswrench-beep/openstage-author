// A video the browser records (MediaRecorder) is a WebM file that does not say how long it is, so a player cannot show its length or jump about in it
// until it has played it through. This writes the length into the file's Info block. It reads only enough of the file to find that block and changes
// nothing else; if the file is not in the form it expects, it is returned as it was.

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_CLUSTER = 0x1f43b675;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;

interface Element {
  id: number;
  /** Where its id starts, where its content starts, and where its content ends. */
  at: number;
  start: number;
  end: number;
  /** The size field was "unknown" (all ones): the content runs to the end of the parent. */
  unknown: boolean;
  sizeLen: number;
}

function readElement(b: Uint8Array, at: number, limit: number): Element | null {
  if (at >= limit) return null;
  const first = b[at]!;
  if (first === 0) return null;
  const idLen = Math.clz32(first) - 24 + 1;
  if (idLen > 4 || at + idLen >= limit) return null;
  let id = 0;
  for (let i = 0; i < idLen; i++) id = id * 256 + b[at + i]!;
  const sizeAt = at + idLen;
  const s0 = b[sizeAt]!;
  if (s0 === 0) return null;
  const sizeLen = Math.clz32(s0) - 24 + 1;
  if (sizeLen > 8 || sizeAt + sizeLen > limit) return null;
  let value = s0 & (0xff >> sizeLen);
  let allOnes = value === 0xff >> sizeLen;
  for (let i = 1; i < sizeLen; i++) {
    const v = b[sizeAt + i]!;
    value = value * 256 + v;
    if (v !== 0xff) allOnes = false;
  }
  const start = sizeAt + sizeLen;
  if (allOnes) return { id, at, start, end: limit, unknown: true, sizeLen };
  if (value > Number.MAX_SAFE_INTEGER || start + value > limit) return null;
  return { id, at, start, end: start + value, unknown: false, sizeLen };
}

function encodeSize(value: number, minLen: number): Uint8Array | null {
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

interface Found {
  segment: Element;
  info: Element;
  children: Element[];
}

function find(b: Uint8Array): Found | null {
  const header = readElement(b, 0, b.length);
  if (!header || header.id !== ID_EBML) return null;
  const segment = readElement(b, header.end, b.length);
  if (!segment || segment.id !== ID_SEGMENT) return null;
  let at = segment.start;
  while (at < segment.end) {
    const e = readElement(b, at, segment.end);
    if (!e || e.id === ID_CLUSTER || e.unknown) return null;
    if (e.id === ID_INFO) {
      const children: Element[] = [];
      let c = e.start;
      while (c < e.end) {
        const child = readElement(b, c, e.end);
        if (!child || child.unknown) return null;
        children.push(child);
        c = child.end;
      }
      return { segment, info: e, children };
    }
    at = e.end;
  }
  return null;
}

function readNumber(b: Uint8Array, e: Element): number {
  let v = 0;
  for (let i = e.start; i < e.end; i++) v = v * 256 + b[i]!;
  return v;
}

/** The length a WebM file says it has, in milliseconds, or null when it says none or is not a file this reads. */
export function webmDuration(b: Uint8Array): number | null {
  const f = find(b);
  const d = f?.children.find((c) => c.id === ID_DURATION);
  if (!f || !d) return null;
  const view = new DataView(b.buffer, b.byteOffset + d.start, d.end - d.start);
  const units = d.end - d.start === 4 ? view.getFloat32(0) : d.end - d.start === 8 ? view.getFloat64(0) : null;
  if (units === null) return null;
  const scale = f.children.find((c) => c.id === ID_TIMECODE_SCALE);
  const ns = scale ? readNumber(b, scale) : 1_000_000;
  return (units * ns) / 1_000_000;
}

/** The file with its length written in (replacing one it had). Returned as it was if it is not a file this reads. */
export function webmWithDuration(b: Uint8Array, ms: number): Uint8Array {
  const f = find(b);
  if (!f || !Number.isFinite(ms) || ms < 0) return b;
  const scale = f.children.find((c) => c.id === ID_TIMECODE_SCALE);
  const ns = scale ? readNumber(b, scale) : 1_000_000;
  const element = new Uint8Array(3 + 8 + 0);
  element.set(idBytes(ID_DURATION), 0); // two bytes: 44 89
  element[2] = 0x88; // a size of 8
  new DataView(element.buffer).setFloat64(3, (ms * 1_000_000) / ns);
  const body: number[] = [];
  for (const c of f.children) {
    if (c.id === ID_DURATION) continue;
    for (let i = c.at; i < c.end; i++) body.push(b[i]!);
  }
  const content = new Uint8Array(body.length + 11);
  content.set(body, 0);
  content.set(element.subarray(0, 11), body.length);
  const size = encodeSize(content.length, f.info.sizeLen);
  if (!size) return b;
  const head = [...idBytes(ID_INFO), ...size];
  const delta = head.length + content.length - (f.info.end - f.info.at);
  let segmentSize: Uint8Array | null = null;
  if (!f.segment.unknown) {
    segmentSize = encodeSize(f.segment.end - f.segment.start + delta, f.segment.sizeLen);
    if (!segmentSize || segmentSize.length !== f.segment.sizeLen) return b;
  }
  const out = new Uint8Array(b.length + delta);
  out.set(b.subarray(0, f.info.at), 0);
  out.set(head, f.info.at);
  out.set(content, f.info.at + head.length);
  out.set(b.subarray(f.info.end), f.info.at + head.length + content.length);
  if (segmentSize) out.set(segmentSize, f.segment.start - f.segment.sizeLen);
  return out;
}
