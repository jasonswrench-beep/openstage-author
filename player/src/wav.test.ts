import assert from "node:assert/strict";
import { test } from "node:test";
import { EXPORT_RATE, forExport, parseWav, resample, wavDurationMs, writeWav } from "./wav.ts";

const tone = (rate: number, hz: number, seconds: number, amplitude = 0.5): Float32Array =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / rate));

const peak = (a: Float32Array, from = 0, to = a.length): number => a.slice(from, to).reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** How many times a sound crosses zero going up, which says its pitch. */
const risingCrossings = (a: Float32Array): number => a.reduce((n, v, i) => (i > 0 && a[i - 1]! < 0 && v >= 0 ? n + 1 : n), 0);

/** A WAV file of any shape, written by hand so the reader is not tested against the writer that goes with it. */
function wavFile(opts: { tag?: number; channels: number; rate: number; bits: number; data: number[]; declared?: number; extensible?: boolean; extra?: boolean }): Uint8Array {
  const width = opts.bits / 8;
  const fmtSize = opts.extensible ? 40 : 16;
  const data = new Uint8Array(opts.data.length * width);
  const dv = new DataView(data.buffer);
  opts.data.forEach((v, i) => {
    if (opts.tag === 3) dv.setFloat32(i * 4, v, true);
    else if (opts.bits === 8) data[i] = v;
    else if (opts.bits === 16) dv.setInt16(i * 2, v, true);
    else if (opts.bits === 24) { data[i * 3] = v & 255; data[i * 3 + 1] = (v >> 8) & 255; data[i * 3 + 2] = (v >> 16) & 255; }
    else dv.setInt32(i * 4, v, true);
  });
  const extra = opts.extra ? [0x4c, 0x49, 0x53, 0x54, 3, 0, 0, 0, 1, 2, 3, 0] : [];
  const out = new Uint8Array(12 + 8 + fmtSize + extra.length + 8 + data.length);
  const v = new DataView(out.buffer);
  const put = (at: number, s: string) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
  put(0, "RIFF"); v.setUint32(4, out.length - 8, true); put(8, "WAVE");
  put(12, "fmt "); v.setUint32(16, fmtSize, true);
  v.setUint16(20, opts.extensible ? 0xfffe : (opts.tag ?? 1), true);
  v.setUint16(22, opts.channels, true); v.setUint32(24, opts.rate, true);
  v.setUint32(28, opts.rate * opts.channels * width, true); v.setUint16(32, opts.channels * width, true); v.setUint16(34, opts.bits, true);
  if (opts.extensible) { v.setUint16(36, 22, true); v.setUint16(44, opts.tag ?? 1, true); }
  const dataAt = 20 + fmtSize;
  out.set(extra, dataAt);
  const at = dataAt + extra.length;
  put(at, "data"); v.setUint32(at + 4, opts.declared ?? data.length, true);
  out.set(data, at + 8);
  return out;
}

test("a sound written and read again is the same sound, to the precision of 16 bits", () => {
  const a = tone(24000, 440, 0.5);
  const back = parseWav(writeWav(a, 24000));
  assert.equal(back.rate, 24000);
  assert.equal(back.samples.length, a.length);
  for (let i = 0; i < a.length; i += 97) assert.ok(Math.abs(back.samples[i]! - a[i]!) < 2 / 32768);
});

test("going from 24,000 a second to 48,000 doubles the length and keeps the pitch and the loudness", () => {
  const a = tone(24000, 440, 1);
  const up = resample({ rate: 24000, samples: a }, EXPORT_RATE);
  assert.equal(up.length, 48000);
  assert.equal(risingCrossings(up), risingCrossings(a));
  assert.ok(Math.abs(peak(up, 2000, 46000) - 0.5) < 0.01);
});

test("the rates the voices use all come out at the right length, and a rate going down is not folded back", () => {
  for (const rate of [16000, 22050, 24000, 44100]) {
    const up = resample({ rate, samples: tone(rate, 300, 0.5) }, EXPORT_RATE);
    assert.equal(up.length, 24000, `from ${rate}`);
    assert.ok(Math.abs(peak(up, 1000, 23000) - 0.5) < 0.02, `from ${rate}`);
  }
  // A tone above half the new rate cannot be kept: it must vanish, not come back as a lower one.
  const high = resample({ rate: 96000, samples: tone(96000, 30000, 0.2) }, EXPORT_RATE);
  assert.ok(peak(high, 800, high.length - 800) < 0.05);
});

test("a sound that is already 48,000 a second is not changed", () => {
  const a = tone(48000, 440, 0.1);
  assert.equal(resample({ rate: 48000, samples: a }, EXPORT_RATE), a);
});

test("stereo is averaged to one channel", () => {
  const w = wavFile({ channels: 2, rate: 8000, bits: 16, data: [10000, -10000, 20000, 0, 30000, 30000] });
  const s = parseWav(w);
  assert.equal(s.samples.length, 3);
  assert.ok(Math.abs(s.samples[0]!) < 1e-6);
  assert.ok(Math.abs(s.samples[1]! - 10000 / 32768) < 1e-6);
  assert.ok(Math.abs(s.samples[2]! - 30000 / 32768) < 1e-6);
});

test("8, 24 and 32 bit sound and floating point sound are read", () => {
  assert.ok(Math.abs(parseWav(wavFile({ channels: 1, rate: 8000, bits: 8, data: [128, 255, 0] })).samples[1]! - 127 / 128) < 1e-6);
  assert.ok(Math.abs(parseWav(wavFile({ channels: 1, rate: 8000, bits: 24, data: [4194304, -4194304] })).samples[1]! + 0.5) < 1e-6);
  assert.ok(Math.abs(parseWav(wavFile({ channels: 1, rate: 8000, bits: 32, data: [1073741824] })).samples[0]! - 0.5) < 1e-6);
  assert.ok(Math.abs(parseWav(wavFile({ tag: 3, channels: 1, rate: 8000, bits: 32, data: [0.25, -0.75] })).samples[1]! + 0.75) < 1e-6);
});

test("the extensible form and a chunk before the sound are read", () => {
  const w = wavFile({ extensible: true, channels: 1, rate: 22050, bits: 16, data: [1000, 2000], extra: true });
  const s = parseWav(w);
  assert.equal(s.rate, 22050);
  assert.equal(s.samples.length, 2);
});

test("a file cut short is read as far as it goes, and a file with no sound or not a WAV says so", () => {
  const w = wavFile({ channels: 1, rate: 8000, bits: 16, data: [1, 2, 3, 4], declared: 4000 });
  assert.equal(parseWav(w).samples.length, 4);
  assert.throws(() => parseWav(new Uint8Array(100)), /not a WAV/);
  assert.throws(() => parseWav(new TextEncoder().encode("RIFFxxxxWAVE")), /no description|no sound/);
  assert.throws(() => parseWav(wavFile({ tag: 2, channels: 1, rate: 8000, bits: 4, data: [] })), /not read/);
});

test("the length of a file is read from its description and agrees with reading all of it", () => {
  const w = writeWav(tone(24000, 200, 1.234), 24000);
  assert.equal(wavDurationMs(w), 1234);
  assert.equal(wavDurationMs(wavFile({ channels: 2, rate: 8000, bits: 16, data: new Array(16000).fill(0) })), 1000);
});

test("a narration file is made ready for the exporter: one channel, 48,000 a second, and a length that is never more than there is", () => {
  const { wav, durationMs } = forExport(writeWav(tone(22050, 220, 2.5), 22050));
  const back = parseWav(wav);
  assert.equal(back.rate, EXPORT_RATE);
  assert.equal(durationMs, 2500);
  assert.ok(durationMs * (EXPORT_RATE / 1000) <= back.samples.length);
  assert.equal(wavDurationMs(wav), durationMs);
});
