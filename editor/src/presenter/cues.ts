// Captions for a presenter clip, timed from the narration's own timing. The speech engine says when each sentence is spoken (from its first word to its last) and
// keeps that with the audio, so the captions come out timed to the voice with no listening and no guessing. A sentence that needs more than one caption is
// split by the length of its pieces, inside the time it is spoken. When the engine could only estimate (some voices give no word times), or there is no timing at all,
// the captions are estimates and are marked so, as everywhere else in the editor.

import { cuesFromScript, type Cue } from "../captions.ts";

export interface NarrationCue {
  /** Seconds from the start of the speech. */
  start: number;
  end: number;
  text: string;
}

export interface NarrationCues {
  /** True when the times came from the words the engine spoke; false when they were estimated from the length of each sentence. */
  exactTimings: boolean;
  duration: number;
  cues: NarrationCue[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The shell's answer, checked. Null when it is not usable. */
export function parseNarrationCues(raw: unknown): NarrationCues | null {
  if (!isRecord(raw) || !Array.isArray(raw["cues"])) return null;
  const cues: NarrationCue[] = [];
  for (const c of raw["cues"]) {
    if (!isRecord(c) || typeof c["start"] !== "number" || typeof c["end"] !== "number" || typeof c["text"] !== "string") continue;
    if (!Number.isFinite(c["start"]) || !Number.isFinite(c["end"]) || c["start"] < 0 || c["end"] < c["start"] || c["text"].trim() === "") continue;
    cues.push({ start: c["start"], end: c["end"], text: c["text"] });
  }
  return { exactTimings: raw["exactTimings"] === true, duration: typeof raw["duration"] === "number" ? raw["duration"] : 0, cues };
}

const squash = (text: string): string => text.replace(/\s+/g, " ").trim();

export interface MadeCaptions {
  cues: Cue[];
  /** Whether the times are estimates, which the captions file then says. */
  estimated: boolean;
  /** Whether they were timed from the voice. */
  fromVoice: boolean;
}

/**
 * The captions of a clip whose speech starts `startMs` into the clip and lasts `speechMs`. Each sentence the narration timed is captioned inside the time it is spoken;
 * with no usable timing the script is spread over the speech by the length of each caption.
 */
export function captionsFromNarration(timing: NarrationCues | null, script: string, speechMs: number, startMs = 0): MadeCaptions {
  const spread = (): MadeCaptions => ({
    cues: cuesFromScript(script, speechMs).map((c) => ({ ...c, startMs: c.startMs + startMs, endMs: c.endMs + startMs })),
    estimated: true,
    fromVoice: false,
  });
  if (!timing || timing.cues.length === 0) return spread();
  const sorted = [...timing.cues].sort((a, b) => a.start - b.start);
  // The sentences have to be the script: timing kept for other words says nothing about these.
  if (squash(sorted.map((c) => c.text).join(" ")) !== squash(script)) return spread();
  const out: Cue[] = [];
  for (const s of sorted) {
    const from = Math.round(s.start * 1000);
    const span = Math.max(Math.round((s.end - s.start) * 1000), 200);
    for (const c of cuesFromScript(s.text, span)) out.push({ ...c, startMs: c.startMs + from + startMs, endMs: c.endMs + from + startMs });
  }
  // A caption never runs into the next: if two sentences were timed to overlap, the earlier one ends where the later begins.
  for (let i = 0; i + 1 < out.length; i++) {
    const next = out[i + 1]!;
    if (out[i]!.endMs > next.startMs) out[i] = { ...out[i]!, endMs: Math.max(next.startMs, out[i]!.startMs + 1) };
  }
  return { cues: out.map((c, i) => ({ ...c, id: `c${i + 1}` })), estimated: !timing.exactTimings, fromVoice: timing.exactTimings };
}
