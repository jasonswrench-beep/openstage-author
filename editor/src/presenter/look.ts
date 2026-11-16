// What the Presenter add-on tells the editor (docs/presenter.md): which presenters there are and what they look like, and the mouth shapes of a
// piece of speech. Everything the add-on sends is checked here before it is used, because it comes from another program.

export type MouthShape = "closed" | "small" | "open" | "wide" | "round" | "teeth";
export const MOUTH_SHAPES: readonly MouthShape[] = ["closed", "small", "open", "wide", "round", "teeth"];

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
  return { durationMs, fps, runs: out, source: raw["source"] === "phonemes" ? "phonemes" : "sound" };
}

/** The shape showing at a moment (before the start and after the end, the first and the last). */
export function shapeAt(track: MouthTrack, ms: number): MouthShape {
  const runs = track.runs;
  let lo = 0;
  let hi = runs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (runs[mid]!.atMs <= ms) lo = mid;
    else hi = mid - 1;
  }
  return runs[lo]!.shape;
}
