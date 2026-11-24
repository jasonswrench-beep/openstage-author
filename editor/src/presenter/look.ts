// What the Presenter add-on tells the editor (docs/presenter.md): which presenters there are and what they look like, and the mouth shapes of a
// piece of speech. Everything the add-on sends is checked here before it is used, because it comes from another program.

/** The mouth shapes, as the add-on names them (presenter/src/mouth.rs says what each is for). */
export type MouthShape = "closed" | "small" | "mid" | "open" | "wide" | "round" | "pucker" | "sh" | "teeth" | "fv" | "tongue";
export const MOUTH_SHAPES: readonly MouthShape[] = ["closed", "small", "mid", "open", "wide", "round", "pucker", "sh", "teeth", "fv", "tongue"];

export type HairStyle = "short" | "curly" | "long";
export const HAIR_STYLES: readonly HairStyle[] = ["short", "curly", "long"];

/** What the editor draws a Lite presenter from: colours, a hair style, glasses. */
export interface Look {
  skin: string;
  hair: { style: HairStyle; color: string };
  shirt: string;
  background: string;
  glasses: boolean;
  eyes: string;
}

export interface PresenterInfo {
  id: string;
  name: string;
  tier: "lite";
  /** The presenter in words, as a person who cannot see the screen would want it. It starts the clip's alt text. */
  description: string;
  look: Look;
}

const COLOUR = /^#[0-9a-fA-F]{6}$/;
const ID = /^[a-z][a-z0-9-]{1,40}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function colour(v: unknown): string | null {
  return typeof v === "string" && COLOUR.test(v) ? v : null;
}

function parseLook(raw: unknown): Look | null {
  if (!isRecord(raw) || !isRecord(raw["hair"])) return null;
  const style = raw["hair"]["style"];
  const hairColour = colour(raw["hair"]["color"]);
  const skin = colour(raw["skin"]);
  const shirt = colour(raw["shirt"]);
  const background = colour(raw["background"]);
  const eyes = colour(raw["eyes"]);
  if (!HAIR_STYLES.includes(style as HairStyle) || !hairColour || !skin || !shirt || !background || !eyes || typeof raw["glasses"] !== "boolean") return null;
  return { skin, hair: { style: style as HairStyle, color: hairColour }, shirt, background, glasses: raw["glasses"], eyes };
}

/** The presenters in the add-on's answer. One that is not whole is left out, never half used. */
export function parsePresenters(raw: unknown): PresenterInfo[] {
  const list = isRecord(raw) && Array.isArray(raw["presenters"]) ? raw["presenters"] : [];
  const out: PresenterInfo[] = [];
  for (const p of list) {
    if (!isRecord(p) || typeof p["id"] !== "string" || !ID.test(p["id"]) || p["tier"] !== "lite") continue;
    const look = parseLook(p["look"]);
    const name = typeof p["name"] === "string" ? p["name"].trim().slice(0, 60) : "";
    const description = typeof p["description"] === "string" ? p["description"].trim().slice(0, 300) : "";
    if (!look || name === "" || description === "" || out.some((o) => o.id === p["id"])) continue;
    out.push({ id: p["id"], name, tier: "lite", description, look });
  }
  return out;
}

/** The mouth shape at each moment of a piece of speech: runs, each from its start to the start of the next. */
export interface MouthTrack {
  durationMs: number;
  fps: number;
  runs: { atMs: number; shape: MouthShape }[];
  /** What the shapes follow: the words the speech engine said with the sounds it said them with, or only how loud and how high the sound is. */
  source: "phonemes" | "sound";
  /**
   * For the words: "measured" when each sound was laid by the time the speech engine gave it (Kokoro predicts the length of every sound), "estimated" when a word's time was
   * shared among its sounds by weight (audio made before the lengths were kept, or a voice that gives none). "none" when the shapes follow the sound. An add-on that does not
   * say (before 0.3.0) shares the word's time by weight, so its words are "estimated".
   */
  timing: "measured" | "estimated" | "none";
}

const MAX_RUNS = 200_000;
const MAX_DURATION_MS = 3_600_000;

/** The add-on's mouth track, checked. It throws a sentence if what came back cannot be used. */
export function parseTrack(raw: unknown): MouthTrack {
  const bad = (): never => {
    throw new Error("The Presenter add-on's answer about the mouth shapes could not be understood.");
  };
  if (!isRecord(raw)) return bad();
  const durationMs = raw["durationMs"];
  const fps = raw["fps"];
  const runs = raw["runs"];
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > MAX_DURATION_MS) return bad();
  if (typeof fps !== "number" || !Number.isFinite(fps) || fps < 5 || fps > 60) return bad();
  if (!Array.isArray(runs) || runs.length === 0 || runs.length > MAX_RUNS) return bad();
  const out: MouthTrack["runs"] = [];
  for (const r of runs) {
    if (!Array.isArray(r) || typeof r[0] !== "number" || !Number.isFinite(r[0]) || r[0] < 0 || !MOUTH_SHAPES.includes(r[1] as MouthShape)) return bad();
    if (out.length > 0 && r[0] <= out[out.length - 1]!.atMs) return bad();
    out.push({ atMs: r[0], shape: r[1] as MouthShape });
  }
  if (out[0]!.atMs !== 0) return bad();
  const source = raw["source"] === "phonemes" ? "phonemes" : "sound";
  const timing = source === "sound" ? "none" : raw["timing"] === "measured" ? "measured" : "estimated";
  return { durationMs, fps, runs: out, source, timing };
}

/** Where in the track a moment is: the run it is in. */
function runAt(runs: MouthTrack["runs"], ms: number): number {
  let lo = 0;
  let hi = runs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (runs[mid]!.atMs <= ms) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The shape showing at a moment (before the start and after the end, the first and the last). */
export function shapeAt(track: MouthTrack, ms: number): MouthShape {
  return track.runs[runAt(track.runs, ms)]!.shape;
}

// ---- the mouth in motion
//
// A track says which shape the sound makes at each moment. A mouth that jumps to each shape as the sound reaches it looks late and stiff, so the picture is
// made from the track in two ways, and both are for every kind of presenter (the drawn ones now, and the ones made from a photo, which will blend between their
// own pictures of the mouth by the same numbers):
//
//   LEAD   The mouth is ahead of the sound, as it is in a person (the lips close for a "p" and round for an "oo" before the sound is heard), and as animators
//          draw it (a mouth shape one or two pictures before its sound). A picture ahead of the sound is also far less noticeable than one behind it.
//   EASE   The mouth moves from one shape to the next over a short time, centred on the moment the track changes, so a picture just before a change has begun
//          to move and a picture just after it has nearly arrived. A shape that lasts only one picture is never blended away (the lips of an "m" last about
//          one picture, and a closed mouth that is half open is not a closed mouth): the move is no longer than half of the shorter shape beside it.

/** How far ahead of the sound the mouth is, in milliseconds: one picture at 25 a second. */
export const MOUTH_LEAD_MS = 40;
/** The longest a move from one shape to the next takes, in milliseconds: about two and a half pictures at 25 a second. */
export const MOUTH_EASE_MS = 100;

/** The mouth at a moment: on its way from one shape to another. `mix` is 0 at `from` and 1 at `to` (0 when it is resting in one shape). */
export interface MouthPose {
  from: MouthShape;
  to: MouthShape;
  mix: number;
}

const smooth = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** The pose at exactly `ms` of the sound, with no lead: the track's shapes with an eased move centred on each change. */
export function poseAt(track: MouthTrack, ms: number): MouthPose {
  const runs = track.runs;
  const i = runAt(runs, ms);
  const here = runs[i]!;
  const start = here.atMs;
  const end = i + 1 < runs.length ? runs[i + 1]!.atMs : Number.POSITIVE_INFINITY;
  const length = end - start;
  const half = MOUTH_EASE_MS / 2;

  // the move into this shape, centred on where it starts: no longer than half this shape and half the one before
  if (i > 0) {
    const before = start - runs[i - 1]!.atMs;
    const h = Math.min(half, before / 2, length / 2);
    if (ms < start + h) return { from: runs[i - 1]!.shape, to: here.shape, mix: smooth((ms - (start - h)) / (2 * h)) };
  }
  // the move out of it, centred on where the next one starts
  if (i + 1 < runs.length) {
    const after = (i + 2 < runs.length ? runs[i + 2]!.atMs : Number.POSITIVE_INFINITY) - end;
    const h = Math.min(half, length / 2, after / 2);
    if (ms >= end - h) return { from: here.shape, to: runs[i + 1]!.shape, mix: smooth((ms - (end - h)) / (2 * h)) };
  }
  return { from: here.shape, to: here.shape, mix: 0 };
}

/**
 * The mouth of the picture that is shown from `ms` for a whole picture (so until `ms` plus one picture). It is the mouth for the middle of that stretch of the
 * sound, `MOUTH_LEAD_MS` ahead. At 25 pictures a second and a track made at 25 a second, that is the middle of the track's next picture, where a shape that
 * lasts one picture is whole.
 */
export function poseForPicture(track: MouthTrack, ms: number): MouthPose {
  return poseAt(track, ms + 500 / track.fps + MOUTH_LEAD_MS);
}
