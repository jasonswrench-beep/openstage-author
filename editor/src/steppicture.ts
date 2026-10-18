// The picture of a step: a frame taken from the take's own screen video, in the editor's window.
//
// The video is played from disk by the window (an address the shell opens up for that one recording), moved to the moment of the step, and drawn onto a
// canvas, which is saved as a PNG. The web view only lets a canvas be saved when the video element asked for it with `crossOrigin = "anonymous"`; without
// that the picture is refused as "tainted" (tried in the real window, 2026-10-16). The names and sizes are plain functions with tests; the grabbing needs a
// window, and is tried in the real editor.

/** The folder of a take: 1 is `take-001`. */
export function takeFolderName(take: number): string {
  return `take-${String(take).padStart(3, "0")}`;
}

/** Where a take's screen video is inside its recording: `takes/take-001/screen.mp4`. */
export function screenPath(take: number, file: string): string {
  return `takes/${takeFolderName(take)}/${file}`;
}

/** A picture wider than this is made smaller when it is saved: a course shows it at about 1,100 pixels, and a 4K screen would make a heavy file for nothing. */
export const MAX_PICTURE_WIDTH = 1920;

/** The size a picture of this video is saved at: its own size, or scaled down to `MAX_PICTURE_WIDTH` wide, keeping its shape. */
export function pictureSize(width: number, height: number, max = MAX_PICTURE_WIDTH): { width: number; height: number } {
  if (width <= max) return { width, height };
  return { width: max, height: Math.max(1, Math.round((height * max) / width)) };
}

/** What a name for a step's picture file is made from: the recording and the step, such as `Week 3-step-4`. The shell makes it safe. */
export function pictureName(recording: string, stepId: string): string {
  return `${recording.replace(/\.capture$/, "")}-${stepId}`;
}

export interface Frame {
  blob: Blob;
  /** The size it was saved at. */
  width: number;
  height: number;
  /** The size of the video it came from: the size the log's pixels are counted in. */
  sourceWidth: number;
  sourceHeight: number;
}

const SEEK_LIMIT_MS = 10_000;
const LOAD_LIMIT_MS = 20_000;

function wait(video: HTMLVideoElement, event: "loadeddata" | "seeked", limitMs: number, failure: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { cleanup(); reject(new Error(failure)); }, limitMs);
    const done = (): void => { cleanup(); resolve(); };
    const failed = (): void => { cleanup(); reject(new Error(failure)); };
    const cleanup = (): void => {
      window.clearTimeout(timer);
      video.removeEventListener(event, done);
      video.removeEventListener("error", failed);
    };
    video.addEventListener(event, done);
    video.addEventListener("error", failed);
  });
}

/** Takes pictures from the screen videos of a recording, one video loaded once for all the pictures of its take. Close it when done. */
export class PictureGrabber {
  private readonly videos = new Map<number, Promise<HTMLVideoElement>>();
  private readonly urlFor: (take: number) => Promise<string | undefined>;

  constructor(urlFor: (take: number) => Promise<string | undefined>) {
    this.urlFor = urlFor;
  }

  private open(take: number): Promise<HTMLVideoElement> {
    let found = this.videos.get(take);
    if (found === undefined) {
      found = this.load(take);
      this.videos.set(take, found);
      found.catch(() => this.videos.delete(take));
    }
    return found;
  }

  private async load(take: number): Promise<HTMLVideoElement> {
    const url = await this.urlFor(take);
    if (url === undefined) throw new Error(`The video of take ${take} was not found, so its pictures cannot be taken.`);
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    const loaded = wait(video, "loadeddata", LOAD_LIMIT_MS, `The video of take ${take} could not be read, so its pictures cannot be taken.`);
    video.src = url;
    await loaded;
    return video;
  }

  /** The picture at a moment of a take (milliseconds), as a PNG. It never throws anything but an error that says, in words, why not. */
  async grab(take: number, ms: number): Promise<Frame> {
    const video = await this.open(take);
    const length = Number.isFinite(video.duration) ? video.duration : 0;
    const target = Math.max(0, length > 0 ? Math.min(ms / 1000, Math.max(0, length - 0.05)) : ms / 1000);
    if (!(Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2)) {
      const seeked = wait(video, "seeked", SEEK_LIMIT_MS, `The video of take ${take} did not move to ${(ms / 1000).toFixed(1)} seconds, so that picture could not be taken.`);
      video.currentTime = target;
      await seeked;
    }
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (sourceWidth === 0 || sourceHeight === 0) throw new Error(`The video of take ${take} has no picture at ${(ms / 1000).toFixed(1)} seconds.`);
    const { width, height } = pictureSize(sourceWidth, sourceHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("A picture could not be drawn here.");
    context.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob === null) throw new Error("A picture could not be saved here.");
    return { blob, width, height, sourceWidth, sourceHeight };
  }

  close(): void {
    for (const pending of this.videos.values()) {
      void pending.then((video) => { video.removeAttribute("src"); video.load(); }, () => undefined);
    }
    this.videos.clear();
  }
}
