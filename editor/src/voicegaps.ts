// Captions placed by the quiet gaps in the voice, with no speech model.
//
// An author who already has the words (a script, made into captions) and a recording of someone reading them does not need a computer to understand the words to know
// roughly when each is said: a person pauses between sentences. This finds where the voice speaks and where it pauses, and puts each caption's start at the pause nearest
// to where its share of the speech should begin. It never changes a caption's words. It is a better guess than spreading the captions evenly over the clip (which ignores
// the pauses), and a worse one than listening to the words (which needs a model), so the times it makes are marked as estimates until the author has checked them.
//
// What it does, so that it can be told in plain words:
//   * The voice is "speaking" wherever the sound is above the gate that `soundMapOf` works out (a little over the quiet of the recording itself). Pauses shorter than
//     0.3 seconds are not pauses, and a stretch of sound shorter than 0.12 seconds (a click, a breath) is not speech.
//   * Each caption gets a share of the speech in proportion to how many characters it has. Where a caption should start is where its share begins.
//   * A caption starts at the pause nearest to that place, if there is one within half of an average caption's share of the speech (and never less than 0.6 seconds),
//     and no pause is used for two captions. A caption with no pause near enough starts at the place itself, in the middle of the speech.
//   * A caption starts a little (0.12 seconds) before the voice does after a pause, and ends a little (0.25 seconds) after the voice stops before one.

import type { Cue } from "./captions.ts";
import { readable } from "./captions.ts";
import type { SoundMap } from "./recognition.ts";

/** A stretch of the clip where the voice speaks. */
export interface Stretch {
  startMs: number;
  endMs: number;
}

/** A pause shorter than this is not a pause between sentences. */
export const JOIN_MS = 300;
/** A stretch of sound shorter than this is not speech. */
export const MIN_SPEECH_MS = 120;
/** How long before the voice starts a caption starts, and how long after it stops a caption ends. */
export const LEAD_MS = 120;
export const TAIL_MS = 250;
/** The least a pause can be moved to for a caption to start there. */
export const SNAP_MIN_MS = 600;

/** Where the voice speaks, from a map of the sound: frames above the gate, with short pauses closed and short stretches dropped. */
export function speechStretches(map: SoundMap, joinMs: number = JOIN_MS, minMs: number = MIN_SPEECH_MS): Stretch[] {
  const raw: Stretch[] = [];
  let from = -1;
  for (let f = 0; f <= map.db.length; f++) {
    const loud = f < map.db.length && map.db[f]! >= map.gateDb;
    if (loud && from < 0) from = f;
    if (!loud && from >= 0) {
      raw.push({ startMs: from * map.frameMs, endMs: f * map.frameMs });
      from = -1;
    }
  }
  const joined: Stretch[] = [];
  for (const s of raw) {
    const last = joined[joined.length - 1];
    if (last !== undefined && s.startMs - last.endMs < joinMs) last.endMs = s.endMs;
    else joined.push({ ...s });
  }
  return joined.filter((s) => s.endMs - s.startMs >= minMs);
}

export interface PlacedByGaps {
  cues: Cue[];
  /** How many of the places where a caption begins (not counting the first) are at a pause in the voice. */
  atPauses: number;
  /** How many places there are where a caption begins, not counting the first. */
  boundaries: number;
}

/**
 * The captions' own words given times from where the voice pauses. `lengthMs` is the length of the clip, if known: no caption ends after it. If the voice is not found at all,
 * or there are no captions, the answer is a problem in words and nothing is changed.
 */
export function placeByGaps(cues: readonly Cue[], stretches: readonly Stretch[], lengthMs: number | null): PlacedByGaps | string {
  const items = cues.filter((c) => c.text.trim() !== "");
  if (items.length === 0) return "There are no captions to set the times of.";
  if (stretches.length === 0) return "No voice was found in the sound, so the times were not changed. The sound may be too quiet, or have no speech in it.";
  const total = stretches.reduce((n, s) => n + (s.endMs - s.startMs), 0);
  const weights = items.map((c) => Math.max(1, readable(c.text)));
  const weightSum = weights.reduce((n, w) => n + w, 0);

  /** The time in the clip at which `speechMs` of speech has been spoken. */
  const realAt = (speechMs: number): number => {
    let left = speechMs;
    for (const s of stretches) {
      const length = s.endMs - s.startMs;
      if (left <= length) return s.startMs + left;
      left -= length;
    }
    return stretches[stretches.length - 1]!.endMs;
  };

  const averageShare = total / items.length;
  const tolerance = Math.max(SNAP_MIN_MS, averageShare / 2);
  const starts: number[] = [Math.max(0, stretches[0]!.startMs - LEAD_MS)];
  /** For each caption after the first: the index of the pause it starts after, or -1 if it starts in the middle of speech. */
  const after: number[] = [-1];
  let usedUpTo = -1;
  let atPauses = 0;
  let cumulative = 0;
  for (let k = 1; k < items.length; k++) {
    cumulative += weights[k - 1]!;
    const place = realAt((total * cumulative) / weightSum);
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let j = usedUpTo + 1; j < stretches.length - 1; j++) {
      const mid = (stretches[j]!.endMs + stretches[j + 1]!.startMs) / 2;
      const distance = Math.abs(mid - place);
      if (distance < bestDistance) {
        best = j;
        bestDistance = distance;
      }
      // Pauses further on only get further from the place.
      if (mid > place && distance > bestDistance) break;
    }
    if (best >= 0 && bestDistance <= tolerance) {
      usedUpTo = best;
      atPauses += 1;
      after.push(best);
      starts.push(Math.max(stretches[best]!.endMs, stretches[best + 1]!.startMs - LEAD_MS));
    } else {
      after.push(-1);
      starts.push(Math.round(place));
    }
  }
  // Starts go forward: a caption that would start at or before the one before it starts a moment after it.
  for (let k = 1; k < starts.length; k++) starts[k] = Math.max(starts[k]!, starts[k - 1]! + 1);

  const ceiling = lengthMs !== null && lengthMs > 0 ? lengthMs : Number.POSITIVE_INFINITY;
  let next = 0;
  const placed = cues.map((cue): Cue => {
    if (cue.text.trim() === "") return { ...cue };
    const k = next++;
    const start = Math.min(starts[k]!, Math.max(0, ceiling - 1));
    let end: number;
    if (k === items.length - 1) end = Math.min(stretches[stretches.length - 1]!.endMs + TAIL_MS, ceiling);
    else if (after[k + 1]! >= 0) end = Math.min(stretches[after[k + 1]!]!.endMs + TAIL_MS, starts[k + 1]! - 1);
    else end = starts[k + 1]!;
    return { ...cue, startMs: Math.round(start), endMs: Math.round(Math.max(end, start + 1)) };
  });
  return { cues: placed, atPauses, boundaries: items.length - 1 };
}
