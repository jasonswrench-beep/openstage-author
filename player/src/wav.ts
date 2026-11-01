// Reading and writing WAV sound files, and changing their rate. The video maker (video.ts) hands narration to the recorder's exporter,
// which mixes 48,000 samples a second and reads nothing else, while the voices make 22,050, 24,000 and others. So each narration file is
// read here, brought to 48,000 a second as one channel of 16-bit samples, and written again. Only the standard library is used.

/** A sound read from a file, as one channel of numbers between -1 and 1 (the channels averaged). */
export interface Sound {
  rate: number;
  samples: Float32Array;
}

/** The rate the exporter mixes at. */
export const EXPORT_RATE = 48_000;

const text = (b: Uint8Array, at: number, n: number): string => String.fromCharCode(...b.subarray(at, at + n));

/** Read a WAV file: PCM of 8, 16, 24 or 32 bits, or 32-bit floating point, with any number of channels. Throws a sentence for anything else. */
export function parseWav(bytes: Uint8Array): Sound {
  if (bytes.length < 12 || text(bytes, 0, 4) !== "RIFF" || text(bytes, 8, 4) !== "WAVE") throw new Error("This is not a WAV sound file.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt: { tag: number; channels: number; rate: number; bits: number } | null = null;
  let data: { at: number; size: number } | null = null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = text(bytes, at, 4);
    const declared = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") {
      let tag = view.getUint16(body, true);
      // The extensible form keeps the real format in the first two bytes of its sub-format.
      if (tag === 0xfffe && declared >= 26) tag = view.getUint16(body + 24, true);
      fmt = { tag, channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    } else if (id === "data") {
      // A file that was being written when it was cut off, or a stream, may claim more than there is.
      data = { at: body, size: Math.min(declared, bytes.length - body) };
      break;
    }
    at = body + declared + (declared % 2);
  }
  if (!fmt) throw new Error("This WAV file has no description of its sound.");
  if (!data) throw new Error("This WAV file has no sound in it.");
  if (fmt.channels < 1 || fmt.rate < 1) throw new Error("This WAV file describes a sound that cannot be read.");
  const float = fmt.tag === 3;
  if (!(fmt.tag === 1 || float) || (float ? fmt.bits !== 32 : ![8, 16, 24, 32].includes(fmt.bits))) {
    throw new Error(`This WAV file holds sound in a form that is not read (format ${fmt.tag}, ${fmt.bits} bits).`);
  }
  const width = fmt.bits / 8;
  const frames = Math.floor(data.size / (width * fmt.channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const p = data.at + (i * fmt.channels + c) * width;
      sum += float ? view.getFloat32(p, true)
        : fmt.bits === 8 ? (bytes[p]! - 128) / 128
        : fmt.bits === 16 ? view.getInt16(p, true) / 32768
        : fmt.bits === 24 ? ((bytes[p]! | (bytes[p + 1]! << 8) | (bytes[p + 2]! << 16)) << 8 >> 8) / 8388608
        : view.getInt32(p, true) / 2147483648;
    }
    samples[i] = sum / fmt.channels;
  }
  return { rate: fmt.rate, samples };
}

const sinc = (x: number): number => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

/** The sound at another rate, by windowed-sinc interpolation (a low-pass first when the rate goes down, so nothing is folded back). */
export function resample(sound: Sound, to: number): Float32Array {
  if (sound.rate === to) return sound.samples;
  const input = sound.samples;
  const step = sound.rate / to;
  const cut = Math.min(1, to / sound.rate);
  const lobes = 8;
  const radius = lobes / cut;
  const out = new Float32Array(Math.round((input.length * to) / sound.rate));
  for (let i = 0; i < out.length; i++) {
    const pos = i * step;
    let sum = 0;
    let weights = 0;
    for (let j = Math.max(0, Math.ceil(pos - radius)); j <= Math.min(input.length - 1, Math.floor(pos + radius)); j++) {
      const x = (pos - j) * cut;
      const w = Math.abs(x) >= lobes ? 0 : sinc(x) * sinc(x / lobes);
      sum += input[j]! * w;
      weights += w;
    }
    out[i] = weights === 0 ? 0 : sum / weights;
  }
  return out;
}

/** One channel of 16-bit samples as a WAV file. */
export function writeWav(samples: Float32Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(out.buffer);
  const put = (at: number, s: string) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
  put(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  put(8, "WAVE");
  put(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, Math.round(v < 0 ? v * 32768 : v * 32767), true);
  }
  return out;
}

/** A narration file as the exporter reads it (one channel, 48,000 a second) and how long it lasts, in whole milliseconds, never more than there is. */
export function forExport(bytes: Uint8Array): { wav: Uint8Array; durationMs: number } {
  const samples = resample(parseWav(bytes), EXPORT_RATE);
  return { wav: writeWav(samples, EXPORT_RATE), durationMs: Math.floor((samples.length * 1000) / EXPORT_RATE) };
}

/** How long a WAV file lasts, in whole milliseconds, read from its description without reading its sound. */
export function wavDurationMs(bytes: Uint8Array): number {
  if (bytes.length < 12 || text(bytes, 0, 4) !== "RIFF" || text(bytes, 8, 4) !== "WAVE") throw new Error("This is not a WAV sound file.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let blockBytes = 0;
  let rate = 0;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = text(bytes, at, 4);
    const declared = view.getUint32(at + 4, true);
    if (id === "fmt ") {
      rate = view.getUint32(at + 12, true);
      blockBytes = view.getUint16(at + 8 + 12, true);
    } else if (id === "data") {
      if (rate === 0 || blockBytes === 0) throw new Error("This WAV file has no description of its sound.");
      return Math.floor((Math.min(declared, bytes.length - at - 8) / blockBytes) * 1000 / rate);
    }
    at += 8 + declared + (declared % 2);
  }
  throw new Error("This WAV file has no sound in it.");
}
