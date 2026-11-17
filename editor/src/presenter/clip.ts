// Makes the video of a Lite presenter, the presenter drawn frame by frame with the mouth shapes following the speech, and the speech in the clip with it.
// Where the window has encoders for picture and sound (WebCodecs), the clip is encoded as fast as the computer can (fast.ts). Where it has not, the narration plays
// into the window's own recorder while the presenter is drawn on a canvas, which takes as long as the speech does and needs the editor window to stay in front,
// because a browser slows what it draws in a window nobody can see. Either way the result is a WebM file that says how long it is and can be jumped about in.

import { drawFrame } from "./draw.ts";
import { fastSupport, renderFast } from "./fast.ts";
import { poseForPicture, type Look, type MouthTrack } from "./look.ts";
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
  /** "realtime" to record in real time even where the faster way is there (a test, or a window whose encoders let it down). */
  mode?: "auto" | "realtime";
}

export interface MadeClip {
  video: Uint8Array;
  /** The whole clip, with the moment of quiet at the end. */
  durationMs: number;
  /** How long the speech lasts, which is what the captions are spread over. */
  speechMs: number;
  /** How far into the clip the speech starts, which is what the captions are shifted by. */
  speechStartMs: number;
  /** How it was made: encoded as fast as the computer could, or recorded as the speech played. */
  mode: "fast" | "realtime";
}

/** How long after the recorder starts the speech begins (the recorder is started, then the speech is scheduled a moment ahead). */
const REALTIME_LEAD_MS = 55;

/** How long the picture goes on after the voice stops, so the clip does not end on the last sound. */
const TAIL_MS = 400;

const MIME_TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

/** Whether this window can record a clip in real time: it has a recorder, a canvas that can be recorded, and a sound engine. */
export function realtimeSupported(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof AudioContext !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function" &&
    MIME_TYPES.some((t) => MediaRecorder.isTypeSupported(t))
  );
}

const aborted = (): Error => Object.assign(new Error("Stopped."), { name: "AbortError" });

/** How a clip would be made here: "fast" (encoded as fast as the computer can), "realtime" (recorded as the speech plays), or null when this window can do neither. */
export async function clipMode(size = 720, fps = 25): Promise<"fast" | "realtime" | null> {
  if (await fastSupport(size, fps)) return "fast";
  return realtimeSupported() ? "realtime" : null;
}

/** Make the clip the fastest way this window can. If the fast way fails for a reason that is not the author stopping it, the real-time way is tried. */
export async function renderClip(req: ClipRequest): Promise<MadeClip> {
  const how = req.mode === "realtime" ? null : await fastSupport(req.size ?? 720, req.fps ?? 25);
  if (how) {
    try {
      return await renderFast(req, how);
    } catch (e) {
      if ((e instanceof Error && e.name === "AbortError") || !realtimeSupported()) throw e;
    }
  }
  return renderRealtime(req);
}

async function renderRealtime(req: ClipRequest): Promise<MadeClip> {
  if (!realtimeSupported()) throw new Error("This window cannot make video, so the presenter clip cannot be made here.");
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
    drawFrame(ctx as never, req.look, poseForPicture(req.track, 0), 0, size, req.label);

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
          drawFrame(ctx as never, req.look, ms <= audioMs ? poseForPicture(req.track, ms) : "closed", ms, size, req.label);
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
    return { video: webmWithDuration(bytes, totalMs), durationMs: totalMs, speechMs: audioMs, speechStartMs: REALTIME_LEAD_MS, mode: "realtime" };
  } finally {
    void audio.close();
  }
}
