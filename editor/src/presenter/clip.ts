// Makes the video of a Lite presenter: the narration plays into a recorder while the presenter is drawn on a canvas, mouth shapes following the
// speech, and the browser's own recorder writes the WebM file (the video and the speech together). It takes as long as the speech does, because
// the recorder takes in sound and picture as they happen; the editor says how far it has got. The editor window has to stay in front while it
// works, because a browser slows what it draws in a window nobody can see.

import { drawFrame } from "./draw.ts";
import { shapeAt, type Look, type MouthTrack } from "./look.ts";
import { webmWithDuration } from "./webm.ts";

export interface ClipRequest {
  /** The narration as a WAV file. */
  wav: Uint8Array;
  track: MouthTrack;
  look: Look;
  label: boolean;
  /** The side of the square picture, in pixels. */
  size?: number;
  fps?: number;
  /** Called as the clip is made: how far (0 to 1) and how many seconds of it are done. */
  onProgress?: (fraction: number, seconds: number) => void;
  signal?: AbortSignal;
}

export interface MadeClip {
  video: Uint8Array;
  /** The whole clip, with the moment of quiet at the end. */
  durationMs: number;
  /** How long the speech lasts, which is what the captions are spread over. */
  speechMs: number;
}

/** How long the picture goes on after the voice stops, so the clip does not end on the last sound. */
const TAIL_MS = 400;

const MIME_TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

/** Whether this window can make a clip: it has a recorder, a canvas that can be recorded, and a sound engine. */
export function clipSupported(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof AudioContext !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function" &&
    MIME_TYPES.some((t) => MediaRecorder.isTypeSupported(t))
  );
}

const aborted = (): Error => Object.assign(new Error("Stopped."), { name: "AbortError" });

export async function renderClip(req: ClipRequest): Promise<MadeClip> {
  if (!clipSupported()) throw new Error("This window cannot record video, so the presenter clip cannot be made here.");
  const size = req.size ?? 720;
  const fps = req.fps ?? 25;
  if (req.signal?.aborted) throw aborted();

  const audio = new AudioContext();
  try {
    const buffer = await audio.decodeAudioData(req.wav.slice().buffer);
    const audioMs = Math.round(buffer.duration * 1000);
    const totalMs = audioMs + TAIL_MS;
    await audio.resume();

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This window could not make a drawing surface.");
    const sink = audio.createMediaStreamDestination();
    const voice = audio.createBufferSource();
    voice.buffer = buffer;
    voice.connect(sink);

    const stream = new MediaStream([...canvas.captureStream(fps).getVideoTracks(), ...sink.stream.getAudioTracks()]);
    const mimeType = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 2_000_000, audioBitsPerSecond: 96_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e): void => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = (): void => resolve();
    });

    ctx.imageSmoothingEnabled = true;
    drawFrame(ctx as never, req.look, shapeAt(req.track, 0), 0, size, req.label);

    recorder.start(250);
    const t0 = audio.currentTime + 0.05;
    voice.start(t0);

    await new Promise<void>((resolve, reject) => {
      let last = -1;
      const tick = (): void => {
        if (req.signal?.aborted) {
          reject(aborted());
          return;
        }
        const ms = Math.max(0, (audio.currentTime - t0) * 1000);
        const frame = Math.floor((ms * fps) / 1000);
        if (frame !== last) {
          last = frame;
          drawFrame(ctx as never, req.look, ms <= audioMs ? shapeAt(req.track, ms) : "closed", ms, size, req.label);
        }
        req.onProgress?.(Math.min(1, ms / totalMs), Math.min(ms, totalMs) / 1000);
        if (ms >= totalMs) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }).catch((e: unknown) => {
      if (recorder.state !== "inactive") recorder.stop();
      try {
        voice.stop();
      } catch {
        // it had not started
      }
      throw e;
    });

    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    for (const t of stream.getTracks()) t.stop();
    const blob = new Blob(chunks, { type: "video/webm" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length < 64) throw new Error("The recorder made nothing. Try again with the editor window in front.");
    return { video: webmWithDuration(bytes, totalMs), durationMs: totalMs, speechMs: audioMs };
  } finally {
    void audio.close();
  }
}
