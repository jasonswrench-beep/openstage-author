// Makes the clip faster than the speech takes to say. The window has encoders for picture and sound (WebCodecs), so the presenter is drawn frame after frame as
// fast as the computer can encode them, the speech is encoded alongside, and webmwriter.ts puts both into a WebM file. Nothing plays and nothing is recorded in real
// time, so it does not matter whether the editor window is in front. Where the window has no such encoders, clip.ts records in real time instead.

import type { ClipRequest, MadeClip } from "./clip.ts";
import { drawFrame } from "./draw.ts";
import { poseForPicture } from "./look.ts";
import { opusHead, writeWebm, type MuxChunk } from "./webmwriter.ts";

/** What this window can encode with. */
export interface FastSupport {
  /** The code the encoder is configured with, and the name the file gives the picture's format. */
  codec: string;
  mux: "V_VP8" | "V_VP9";
}

const TAIL_MS = 400;
const RATE = 48_000;
/** Opus in 20 millisecond frames. */
const FRAME = 960;

const aborted = (): Error => Object.assign(new Error("Stopped."), { name: "AbortError" });

/** Whether this window can make a clip this way, and with which picture format (the smaller, VP9, if it can). Null when it cannot. */
export async function fastSupport(size = 720, fps = 25): Promise<FastSupport | null> {
  const have = (n: string): boolean => typeof (globalThis as Record<string, unknown>)[n] !== "undefined";
  if (!["VideoEncoder", "AudioEncoder", "VideoFrame", "AudioData", "OfflineAudioContext"].every(have)) return null;
  try {
    const audio = await AudioEncoder.isConfigSupported({ codec: "opus", sampleRate: RATE, numberOfChannels: 1, bitrate: 64_000 });
    if (!audio.supported) return null;
    for (const c of [{ codec: "vp09.00.10.08", mux: "V_VP9" as const }, { codec: "vp8", mux: "V_VP8" as const }]) {
      const v = await VideoEncoder.isConfigSupported({ codec: c.codec, width: size, height: size, framerate: fps, bitrate: 2_000_000 });
      if (v.supported) return c;
    }
  } catch {
    // an encoder that cannot even say is not one to rely on
  }
  return null;
}

/** A copy of the bytes of a buffer or a view of one. */
function bytesOf(d: AllowSharedBufferSource): Uint8Array {
  if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer);
  return new Uint8Array((d as ArrayBuffer).slice(0));
}

/** Give the rest of the window's work a turn, without a timer (a window that cannot be seen slows its timers down). */
function turn(): Promise<void> {
  return new Promise((done) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (): void => {
      channel.port1.close();
      done();
    };
    channel.port2.postMessage(0);
  });
}

/** Wait until an encoder has worked through some of what it was given, so memory does not fill with frames nobody has encoded yet. */
async function room(encoder: { encodeQueueSize: number; addEventListener(type: "dequeue", listener: () => void, options?: { once: boolean }): void }, most: number): Promise<void> {
  while (encoder.encodeQueueSize > most) await new Promise<void>((done) => encoder.addEventListener("dequeue", () => done(), { once: true }));
}

export async function renderFast(req: ClipRequest, how: FastSupport): Promise<MadeClip> {
  const size = req.size ?? 720;
  const fps = req.fps ?? 25;
  if (req.signal?.aborted) throw aborted();

  // The speech, as 48 000 samples a second (decoding into a context of that rate does the converting), one channel.
  const decoder = new OfflineAudioContext(1, 1, RATE);
  const buffer = await decoder.decodeAudioData(req.wav.slice().buffer);
  const audioMs = Math.round((buffer.length * 1000) / buffer.sampleRate);
  const totalMs = audioMs + TAIL_MS;
  const samples = Math.ceil((totalMs * RATE) / 1000);
  const mono = new Float32Array(Math.ceil(samples / FRAME) * FRAME);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length && i < mono.length; i++) mono[i]! += data[i]! / buffer.numberOfChannels;
  }

  const chunks: MuxChunk[] = [];
  let failure: Error | null = null;
  let description: Uint8Array | null = null;
  const fail = (e: unknown): void => { failure = e instanceof Error ? e : new Error(String(e)); };

  const video = new VideoEncoder({
    output: (chunk): void => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ track: 1, timestampUs: chunk.timestamp, key: chunk.type === "key", data });
    },
    error: fail,
  });
  const sound = new AudioEncoder({
    output: (chunk, meta): void => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ track: 2, timestampUs: chunk.timestamp, key: true, data });
      const d = meta?.decoderConfig?.description;
      if (!description && d) description = bytesOf(d);
    },
    error: fail,
  });

  try {
    video.configure({ codec: how.codec, width: size, height: size, framerate: fps, bitrate: 2_000_000, latencyMode: "quality" });
    sound.configure({ codec: "opus", sampleRate: RATE, numberOfChannels: 1, bitrate: 64_000 });

    // the sound: all of it, in frames of 20 milliseconds
    for (let at = 0; at < mono.length; at += FRAME) {
      if (failure) throw failure;
      if (req.signal?.aborted) throw aborted();
      const data = new AudioData({ format: "f32", sampleRate: RATE, numberOfFrames: FRAME, numberOfChannels: 1, timestamp: Math.round((at * 1e6) / RATE), data: mono.subarray(at, at + FRAME) });
      sound.encode(data);
      data.close();
      await room(sound, 32);
    }

    // the picture, drawn and encoded a frame at a time
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This window could not make a drawing surface.");
    const frames = Math.ceil((totalMs * fps) / 1000);
    for (let i = 0; i < frames; i++) {
      if (failure) throw failure;
      if (req.signal?.aborted) throw aborted();
      const ms = (i * 1000) / fps;
      drawFrame(ctx as never, req.look, ms <= audioMs ? poseForPicture(req.track, ms) : "closed", ms, size, req.label);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      video.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      await room(video, 6);
      if (i % 10 === 0) {
        req.onProgress?.(Math.min(1, i / frames), ms / 1000);
        await turn();
      }
    }
    await video.flush();
    await sound.flush();
    if (failure) throw failure;
    req.onProgress?.(1, totalMs / 1000);
  } finally {
    if (video.state !== "closed") video.close();
    if (sound.state !== "closed") sound.close();
  }

  const head: Uint8Array = description ?? opusHead(1, RATE);
  const preSkip = head.length >= 12 ? (head[10]! | (head[11]! << 8)) : 312;
  const file = writeWebm({ width: size, height: size, videoCodec: how.mux, audio: { sampleRate: RATE, channels: 1, codecPrivate: head, preSkipSamples: preSkip }, durationMs: totalMs }, chunks);
  return { video: file, durationMs: totalMs, speechMs: audioMs, speechStartMs: 0, mode: "fast" };
}
