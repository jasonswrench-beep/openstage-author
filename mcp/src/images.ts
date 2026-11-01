// How big a picture file is, read from its first bytes: PNG, JPEG, GIF, WebP and SVG. Null when it cannot be told.

export interface PictureSize {
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, at: number): number => (b[at]! << 8) | b[at + 1]!;
const u16le = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8);
const u32be = (b: Uint8Array, at: number): number => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
const ascii = (b: Uint8Array, at: number, n: number): string => String.fromCharCode(...b.subarray(at, at + n));

function png(b: Uint8Array): PictureSize | null {
  if (b.length < 24 || ascii(b, 1, 3) !== "PNG" || ascii(b, 12, 4) !== "IHDR") return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function jpeg(b: Uint8Array): PictureSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = b[at + 1]!;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // Start of frame markers hold the size; the others in this range are not frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: u16be(b, at + 5), width: u16be(b, at + 7) };
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    at += 2 + u16be(b, at + 2);
  }
  return null;
}

function gif(b: Uint8Array): PictureSize | null {
  if (b.length < 10 || ascii(b, 0, 3) !== "GIF") return null;
  return { width: u16le(b, 6), height: u16le(b, 8) };
}

function webp(b: Uint8Array): PictureSize | null {
  if (b.length < 30 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const kind = ascii(b, 12, 4);
  if (kind === "VP8X") return { width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
  if (kind === "VP8 ") return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  if (kind === "VP8L") {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  return null;
}

function svg(b: Uint8Array): PictureSize | null {
  const head = new TextDecoder().decode(b.subarray(0, 4096));
  const tag = /<svg\b[^>]*>/i.exec(head)?.[0];
  if (!tag) return null;
  const number = (name: string): number | null => {
    const m = new RegExp(`\\b${name}\\s*=\\s*["']\\s*([0-9.]+)\\s*(px)?\\s*["']`, "i").exec(tag);
    return m ? Number(m[1]) : null;
  };
  const w = number("width");
  const h = number("height");
  if (w && h) return { width: Math.round(w), height: Math.round(h) };
  const box = /viewBox\s*=\s*["']\s*[-0-9.]+[ ,]+[-0-9.]+[ ,]+([0-9.]+)[ ,]+([0-9.]+)\s*["']/i.exec(tag);
  return box ? { width: Math.round(Number(box[1])), height: Math.round(Number(box[2])) } : null;
}

export function imageSize(bytes: Uint8Array, ext: string): PictureSize | null {
  const found = ext === ".png" ? png(bytes) : ext === ".jpg" || ext === ".jpeg" ? jpeg(bytes) : ext === ".gif" ? gif(bytes) : ext === ".webp" ? webp(bytes) : ext === ".svg" ? svg(bytes) : null;
  return found && found.width > 0 && found.height > 0 ? found : null;
}
