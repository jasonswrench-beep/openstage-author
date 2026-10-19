// Reading the sound of a video or an audio clip inside the editor's window, in the form the speech recogniser wants it: 16,000 samples a second, one channel, 16 bits.
//
// The window can decode what a course plays (MP4 with AAC, MP3, WAV, Ogg) because it is a browser; the editor does not carry a decoder of its own and does not need FFmpeg. The
// sound is decoded straight to 16 kHz by the browser, mixed down to one channel here, and handed to the shell as a WAV file. Only the mixing is tested in Node: the decoding
// needs a window with sound, and is tried in the real app.

import { MAX_LISTEN_MINUTES } from "./recognition.ts";

export const SPEECH_RATE = 16000;

/** Several channels of sound (each from -1 to 1) mixed down to one by their average, as 16-bit samples. A sound that goes past full scale is held there. */
export function toMono16(channels: readonly Float32Array[]): Int16Array {
  const length = channels.reduce((n, c) => Math.max(n, c.length), 0);
  const out = new Int16Array(length);
  const count = Math.max(1, channels.length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const c of channels) sum += c[i] ?? 0;
    const v = Math.max(-1, Math.min(1, sum / count));
    out[i] = Math.round(v < 0 ? v * 32768 : v * 32767);
  }
  return out;
}

/** The sound of a file's bytes, as 16 kHz mono 16-bit samples. Throws a message for the author if the sound cannot be read or is too long. */
export async function decodeSpeech(bytes: Uint8Array): Promise<Int16Array> {
  const Offline: typeof OfflineAudioContext | undefined = typeof OfflineAudioContext !== "undefined" ? OfflineAudioContext : undefined;
  if (Offline === undefined) throw new Error("This window cannot read sound.");
  // Decoding on a context made at 16 kHz makes the browser resample the sound to 16 kHz as it decodes, so the full-rate sound is never kept whole.
  const context = new Offline(1, 1, SPEECH_RATE);
  const own = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(own as ArrayBuffer);
  } catch {
    throw new Error("The sound of this file could not be read here. It may have no sound, be a kind of file this window cannot play, or be too long for this computer's memory.");
  }
  if (decoded.duration > MAX_LISTEN_MINUTES * 60) {
    throw new Error(`This is ${Math.round(decoded.duration / 60)} minutes long. Listening works on up to ${MAX_LISTEN_MINUTES} minutes (${MAX_LISTEN_MINUTES / 60} hours). Cut the video shorter, or do it in parts.`);
  }
  if (decoded.length === 0) throw new Error("There is no sound in this file.");
  return toMono16(Array.from({ length: decoded.numberOfChannels }, (_v, c) => decoded.getChannelData(c)));
}
