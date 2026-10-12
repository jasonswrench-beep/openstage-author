// The timeline view's arithmetic: where each object's bar goes on a time axis, how long the axis is, where the ticks fall,
// what a key press or a pointer position means as a time, and what a screen reader is told. No page code lives here, so
// all of it is tested directly. The panel (timelinepanel.ts) only draws what this works out and passes edits to the model.

import type { OSObject, Timing } from "../../player/src/types.ts";
import { plainSeconds, secondsText } from "./timing.ts";

/** One arrow press moves a tenth of a second, with Shift a second, with Page Up or Page Down five. */
export const STEP_MS = 100;
export const BIG_STEP_MS = 1000;
export const PAGE_STEP_MS = 5000;
/** How short a time to leave can be on the timeline. */
export const MIN_STAY_MS = 100;

/** An object on the slide, as the model lists it for timing. */
export interface TimelineRow {
  object: OSObject;
  layerId: string;
  layerName: string;
  onBase: boolean;
}

export interface Bar {
  id: string;
  name: string;
  layerId: string;
  layerName: string;
  onBase: boolean;
  timing: Timing;
  hasNarration: boolean;
  /** When its narration plays, counted from when its layer is shown. Null if it has none, or its place cannot be known yet. */
  narration: { start: number; end: number } | null;
  /** The moment `timing.start` counts from: 0 for an object timed from the layer, or when its narration starts. */
  origin: number;
  /** An object that follows its narration, whose narration's place is not known (no audio made yet, or an earlier narration has none). */
  approximate: boolean;
  /** When it appears on the axis, and when it goes (null: it stays). */
  from: number;
  to: number | null;
}

export interface Tick {
  ms: number;
  label: string;
}

export interface TimelineView {
  /** The length of the axis in milliseconds. */
  horizon: number;
  ticks: Tick[];
  bars: Bar[];
  /** When the slide moves on by itself, or null. */
  advanceAt: number | null;
}

const NICE_STEPS = [1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 1800000];

/** The gap between ticks: the smallest friendly one that keeps the axis to twelve ticks or fewer. */
export function tickStep(horizon: number): number {
  return NICE_STEPS.find((s) => horizon / s <= 12) ?? NICE_STEPS[NICE_STEPS.length - 1]!;
}

/** "5 s" for under a minute, "1:30" from a minute on. */
export function tickLabel(ms: number): string {
  if (ms < 60000) return `${secondsText(ms)} s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Work out the whole timeline from the slide's objects. `narrationMs` says how long an object's narration lasts, or null if its
 * audio has not been made yet; it is asked only about objects that have narration. Narration plays one object after another, in
 * reading order, on each layer, so where an object's narration starts is the total of the narration before it. If an earlier
 * narration has no audio, nothing after it can be placed, and those objects are marked approximate.
 */
export function buildTimeline(rows: TimelineRow[], slideDuration: number | null, narrationMs: (o: OSObject) => number | null): TimelineView {
  const cursors = new Map<string, number | null>();
  const bars: Bar[] = rows.map((row) => {
    const o = row.object;
    const hasNarration = o.narration !== null;
    let narration: Bar["narration"] = null;
    if (hasNarration) {
      const cursor = cursors.has(row.layerId) ? cursors.get(row.layerId)! : 0;
      const length = narrationMs(o);
      if (cursor !== null && length !== null) {
        narration = { start: cursor, end: cursor + length };
        cursors.set(row.layerId, cursor + length);
      } else {
        cursors.set(row.layerId, null);
      }
    }
    const follows = o.timing.appear === "narration";
    const approximate = follows && narration === null;
    const origin = follows && narration ? narration.start : 0;
    const from = origin + o.timing.start;
    return {
      id: o.id, name: o.name, layerId: row.layerId, layerName: row.layerName, onBase: row.onBase, timing: o.timing, hasNarration,
      narration, origin, approximate, from, to: o.timing.visibleFor === null ? null : from + o.timing.visibleFor,
    };
  });
  let latest = slideDuration ?? 0;
  for (const b of bars) latest = Math.max(latest, b.to ?? b.from, b.narration?.end ?? 0);
  const roomy = latest + Math.max(3000, Math.round(latest * 0.15));
  const step = tickStep(Math.max(10000, roomy));
  const horizon = Math.ceil(Math.max(10000, roomy) / step) * step;
  const ticks: Tick[] = [];
  for (let ms = 0; ms <= horizon; ms += step) ticks.push({ ms, label: tickLabel(ms) });
  return { horizon, ticks, bars, advanceAt: slideDuration };
}

/** Round a time to the nearest tenth of a second, never below nothing. */
export function snapMs(ms: number, step = STEP_MS): number {
  return Math.max(0, Math.round(ms / step) * step);
}

/**
 * What a key does to a time: Left, Down, Right and Up move it a tenth of a second (a second with Shift), Page Up and Page Down
 * move it five, Home goes to the least and End to the most. Any other key returns null, so it keeps its usual job.
 */
export function nudged(ms: number, key: string, shift: boolean, min: number, max: number): number | null {
  const step = shift ? BIG_STEP_MS : STEP_MS;
  let next: number;
  switch (key) {
    case "ArrowRight": case "ArrowUp": next = ms + step; break;
    case "ArrowLeft": case "ArrowDown": next = ms - step; break;
    case "PageUp": next = ms + PAGE_STEP_MS; break;
    case "PageDown": next = ms - PAGE_STEP_MS; break;
    case "Home": next = min; break;
    case "End": next = max; break;
    default: return null;
  }
  return Math.min(max, Math.max(min, next));
}

/** The time at a pointer position along the track, to the nearest tenth of a second, kept on the axis. */
export function msAtPointer(clientX: number, trackLeft: number, trackWidth: number, horizon: number): number {
  if (trackWidth <= 0) return 0;
  const ms = ((clientX - trackLeft) / trackWidth) * horizon;
  return Math.min(horizon, snapMs(ms));
}

/** A percentage along the axis, for placing something. */
export function percentOf(ms: number, horizon: number): number {
  return Math.max(0, Math.min(100, (ms / horizon) * 100));
}

/** What a screen reader says for the start grip: the delay and what it counts from. */
export function startText(timing: Timing, onBase: boolean): string {
  const from = timing.appear === "narration" ? "its narration starts" : onBase ? "the slide opens" : "its layer is shown";
  return `${plainSeconds(timing.start)} after ${from}`;
}

/** What a screen reader says for the end grip. */
export function endText(timing: Timing): string {
  return timing.visibleFor === null ? "stays until the slide ends" : `disappears ${plainSeconds(timing.visibleFor)} after it appears`;
}

/**
 * The most the start grip can be set to, in milliseconds after its origin, so the object still begins on the axis.
 * An object that follows narration it has no audio for counts from 0.
 */
export function startMax(bar: Bar, horizon: number): number {
  return Math.max(0, horizon - bar.origin);
}

/**
 * What the end grip's value is as a time to stay: the least a time to leave can be, up to the room left on the axis. The value
 * of an object that stays is the room left, which is where its grip sits.
 */
export function stayMax(bar: Bar, horizon: number): number {
  return Math.max(MIN_STAY_MS, horizon - bar.from);
}

/** What setting the end grip to this value means: past the end of the axis is "stays", anything else is a time to stay. */
export function stayFromValue(valueMs: number, bar: Bar, horizon: number): number | null {
  const max = stayMax(bar, horizon);
  if (valueMs >= max) return null;
  return Math.max(MIN_STAY_MS, snapMs(valueMs));
}
