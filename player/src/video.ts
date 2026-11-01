// Makes an MP4 of a published course (the "mp4" target of publish.ts), with captions beside it. The pieces:
//   - a browser with no window (cdp.ts) opens the course's own renderer (videoframes.ts) and takes a picture of each slide in each state it has;
//   - videoplan.ts decides, with the player's own timing rules, what those states are and how long each lasts;
//   - wav.ts brings each narration to the rate the exporter mixes at;
//   - videoedit.ts lays pictures and narration on a timeline, in the recorder's edit format, and writes the captions;
//   - the recorder's own exporter (openstage-capture render, Windows' own H.264 and AAC encoders) makes the MP4 and reads it back.
// No FFmpeg is used or shipped. Both programs, the browser and the exporter, are started as separate programs.
// What this cannot do (answer a question, play a video) is said in docs/video.md and in the notes of the result.

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Browser, findBrowser } from "./cdp.ts";
import { forExport } from "./wav.ts";
import { narrationSchedule, planSegments, simulateSlide, slideLengthMs, SILENT_MS, type PreparedSlide } from "./videoplan.ts";
import { buildEdit, captionsVtt, videoNotes, type VideoSlide } from "./videoedit.ts";
import type { CoursePackage } from "./types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The widest a video is made: a stage wider than this is shown smaller, as a video of 4K slides would be very large and slow. */
const MAX_WIDTH = 1920;

/** Where the exporter is: OPENSTAGE_CAPTURE if it is set, otherwise beside the program or in the repository's usual build folders. Null if not found. */
export function findCapture(env: NodeJS.ProcessEnv, root: string): string | null {
  const named = env["OPENSTAGE_CAPTURE"];
  if (named) return existsSync(named) ? named : null;
  const candidates = [
    path.join(root, "openstage-capture.exe"),
    path.join(root, "capture", "target", "release", "openstage-capture.exe"),
    path.join(root, "capture", "target", "debug", "openstage-capture.exe"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

export interface VideoOptions {
  pkg: CoursePackage;
  /** The published course folder: the pages' files, the course's assets and the narration. */
  outDir: string;
  /** The text of its index.html, which holds the course. */
  indexHtml: string;
  /** Where the MP4 goes, and its captions. */
  videoPath: string;
  captionsPath: string;
  /** The repository (or the installed program's) folder, to find the exporter beside. */
  root: string;
  env?: NodeJS.ProcessEnv;
  /** Pictures a second in the video. */
  fps?: number;
  /** The video's size in pixels, if not the stage's own (wide stages are made smaller). */
  size?: { width: number; height: number };
  /** How long a slide with nothing in it is shown, in ms. */
  silentMs?: number;
  /** Play the effects of things arriving and leaving, and blend between slides. Off makes every change a cut. */
  motion?: boolean;
  say?: (message: string) => void;
}

export interface VideoResult {
  file: string;
  /** The captions file, or null when nothing in the course is narrated. */
  captions: string | null;
  seconds: number;
  slides: number;
  pictures: number;
  /** What a video cannot do for this course, in plain sentences. */
  notes: string[];
}

const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2);

/** Run a program and keep what it says. Resolves with its lines once it has ended; throws if it could not start or did not succeed. */
function run(program: string, args: string[], onLine: (line: string) => void): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const lines: string[] = [];
    let partial = "";
    const take = (chunk: Buffer) => {
      partial += chunk.toString("utf-8");
      const parts = partial.split(/\r?\n/);
      partial = parts.pop() ?? "";
      for (const line of parts) {
        lines.push(line);
        onLine(line);
      }
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.once("error", (e) => reject(new Error(`The video exporter could not be started: ${e.message}`)));
    child.once("close", (code) => {
      if (partial) lines.push(partial);
      if (code === 0) resolve(lines);
      else {
        const said = lines.filter((l) => l.trim() !== "" && !l.startsWith("export: frame") && !l.startsWith("Exporting:")).slice(-4).join(" ");
        reject(new Error(`The video exporter did not finish${said ? `: ${said}` : "."}`));
      }
    });
  });
}

export async function makeVideo(o: VideoOptions): Promise<VideoResult> {
  const env = o.env ?? process.env;
  const say = o.say ?? (() => undefined);
  const motion = o.motion ?? true;
  const fps = o.fps ?? 30;
  if (process.platform !== "win32") throw new Error("Making a video works on Windows only for now, because the video is made with Windows' own video tools.");
  const capture = findCapture(env, o.root);
  if (!capture) throw new Error("The video exporter (openstage-capture.exe) was not found. Put it in the same folder as the editor, or set OPENSTAGE_CAPTURE to its full path.");
  const browser = findBrowser(env);
  if (!browser) throw new Error("A browser to take the pictures with was not found. The video is made with Microsoft Edge or Google Chrome: install one, or set OPENSTAGE_BROWSER to its full path.");

  const { pkg, outDir } = o;
  const stage = pkg.project.stage;
  const outWidth = o.size?.width ?? even(stage.width * Math.min(1, MAX_WIDTH / stage.width));
  const outHeight = o.size?.height ?? even(stage.height * Math.min(1, MAX_WIDTH / stage.width));
  const shotScale = outWidth / stage.width;

  const work = mkdtempSync(path.join(os.tmpdir(), "openstage-video-work-"));
  const assets = path.join(work, "assets");
  const projectFolder = path.join(work, "project.capture");
  mkdirSync(assets);
  mkdirSync(projectFolder);
  const pagePath = path.join(outDir, "_video-frame.html");
  const scriptPath = path.join(outDir, "_video-frame.js");
  let session: Browser | null = null;
  try {
    // The page: the course, drawn by the course's own renderer and nothing else.
    await build({ entryPoints: [path.join(here, "videoframes.ts")], bundle: true, format: "iife", target: "es2022", outfile: scriptPath, logLevel: "warning" });
    writeFileSync(pagePath, o.indexHtml.replace('<script src="player.js"></script>', '<script src="_video-frame.js"></script>'));
    say("Opening the course in a browser with no window to take the pictures.");
    session = await Browser.launch(browser, { width: stage.width, height: stage.height });
    await session.page.navigate(pathToFileURL(pagePath).href);
    if ((await session.page.evaluate<string>("typeof window.OpenStageVideo")) !== "object") throw new Error("The slide page did not start in the browser.");

    const slides: VideoSlide[] = [];
    const sounds = new Map<string, { file: string; durationMs: number }>();
    let cursor = 0;
    let pictures = 0;
    for (let i = 0; i < pkg.slides.length; i++) {
      const info = await session.page.evaluate<PreparedSlide>(`window.OpenStageVideo.prepare(${i})`);
      // Narration: each file brought to the exporter's rate once, however many objects say the same words.
      const spoken = info.narrated.map((id) => {
        const asset = pkg.narration[id]!;
        let sound = sounds.get(asset.audio!);
        if (!sound) {
          let made: ReturnType<typeof forExport>;
          try {
            made = forExport(readFileSync(path.join(outDir, asset.audio!)));
          } catch (e) {
            throw new Error(`The narration of slide ${i + 1} (${asset.audio}) could not be read: ${(e as Error).message}`);
          }
          const file = `n-${path.basename(asset.audio!, ".wav")}.wav`;
          writeFileSync(path.join(assets, file), made.wav);
          sound = { file, durationMs: made.durationMs };
          sounds.set(asset.audio!, sound);
        }
        return { id, asset, ...sound };
      });
      const schedule = narrationSchedule(spoken.map((s) => ({ id: s.id, durationMs: s.durationMs })));
      const sim = simulateSlide({
        entries: info.entries,
        narration: schedule.map((s) => ({ id: s.id, startMs: s.startMs })),
        advanceMs: info.advanceMs,
        autoSteps: info.autoSteps,
        followedClips: info.followedClips,
      });
      const lengthMs = slideLengthMs(sim, schedule.length > 0 ? schedule[schedule.length - 1]!.endMs : null, info.advanceMs, o.silentMs ?? SILENT_MS);
      const segments = planSegments(sim, new Map(info.animations), info.entries.map((e) => e.id), lengthMs, motion);
      say(`Slide ${i + 1} of ${pkg.slides.length}: taking ${segments.length} ${segments.length === 1 ? "picture" : "pictures"}.`);
      const taken: VideoSlide["pictures"] = [];
      for (const [k, segment] of segments.entries()) {
        await session.page.evaluate(`window.OpenStageVideo.show(${i}, ${JSON.stringify(segment.state)})`);
        const file = `p${i + 1}-${k + 1}.png`;
        writeFileSync(path.join(assets, file), await session.page.screenshot(stage.width, stage.height, shotScale));
        taken.push({ startMs: segment.startMs, endMs: segment.endMs, file });
      }
      pictures += taken.length;
      slides.push({
        name: info.name,
        startMs: cursor,
        lengthMs,
        pictures: taken,
        arrives: motion && info.arrives,
        narration: spoken.map((s, j) => ({
          name: `Slide ${i + 1} narration ${j + 1}`,
          script: s.asset.script,
          file: s.file,
          startMs: schedule[j]!.startMs,
          durationMs: s.durationMs,
          cues: s.asset.cues,
        })),
      });
      cursor += lengthMs;
    }
    await session.close();
    session = null;

    const edit = buildEdit(slides, motion);
    const editPath = path.join(work, "edit.json");
    writeFileSync(editPath, edit.text);
    const captions = captionsVtt(slides);
    rmSync(o.captionsPath, { force: true });
    if (captions.cues > 0) writeFileSync(o.captionsPath, captions.text);

    say(`Making the video: ${(edit.lengthMs / 1000).toFixed(1)} seconds, ${outWidth} by ${outHeight}.`);
    const made = path.join(work, "video.mp4");
    let lastSaid = "";
    await run(capture, ["render", "--project", projectFolder, "--edit", editPath, "--assets", assets, "--out", made, "--fps", String(fps), "--size", `${outWidth}x${outHeight}`, "--plain"], (line) => {
      const progress = /^Exporting: (\d+) percent/.exec(line);
      if (progress && progress[1] !== lastSaid) {
        lastSaid = progress[1]!;
        say(line);
      }
    });
    rmSync(o.videoPath, { force: true });
    cpSync(made, o.videoPath);
    return {
      file: o.videoPath,
      captions: captions.cues > 0 ? o.captionsPath : null,
      seconds: edit.lengthMs / 1000,
      slides: slides.length,
      pictures,
      notes: videoNotes(pkg.slides, pkg.narration),
    };
  } finally {
    if (session) await session.close();
    rmSync(pagePath, { force: true });
    rmSync(scriptPath, { force: true });
    rmSync(work, { recursive: true, force: true });
  }
}
