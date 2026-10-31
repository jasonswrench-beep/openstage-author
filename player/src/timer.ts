// A countdown on a slide. It is shown as a clock and a bar, never as something that is said every second. A screen reader
// is told when the time left passes a few marks (a minute, half a minute, ten seconds), when time is added, and when it
// runs out. The learner can always add time and always turn the timer off (WCAG 2.2.1), and pausing the timing holds it.
// This file draws the timer and works out the words; the clock itself is in timeline.ts, so every rule can be tested.

import type { OSObject, TimerContent } from "./types.ts";
import { t, tn } from "./playertext.ts";

export const TIMER_MIN_SECONDS = 5;
export const TIMER_MAX_SECONDS = 3600;
export const TIMER_MAX_EXTEND = 600;
export const TIMER_DEFAULT: TimerContent = { seconds: 30, label: "Time left", extendBy: 30 };

/** Seconds left at which a screen reader is told, when the timer started with more than that. */
export const TIMER_MILESTONES: readonly number[] = [60, 30, 10];

/** running: counting down. off: the learner turned it off. stopped: a rule stopped it (the question was answered). done: the time ran out. */
export type TimerState = "running" | "off" | "stopped" | "done";

/** What a timer shows now. `seconds` is what is left, counted up to the next whole second, so it reads 0 only when time is up. */
export interface TimerInfo {
  state: TimerState;
  seconds: number;
  paused: boolean;
}

/** The time as a clock: 0:30, 1:05, 1:00:00. */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}


/** The time in words, for a screen reader: "1 minute 5 seconds". */
export function spokenTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const parts = [h > 0 ? tn("time.hour", h) : "", m > 0 ? tn("time.minute", m) : "", rest > 0 || s === 0 ? tn("time.second", rest) : ""].filter(Boolean);
  return parts.join(" ");
}

/** The words on the button that adds time. */
export function addTimeLabel(extendBy: number): string {
  return t("timer.add", { time: spokenTime(extendBy) });
}

/** Is a content object a timer the player can run? (The validator says why one is not.) */
export function timerContentOf(obj: OSObject): TimerContent {
  const c = obj.content as Partial<TimerContent>;
  const seconds = typeof c.seconds === "number" && Number.isFinite(c.seconds) ? Math.min(TIMER_MAX_SECONDS, Math.max(TIMER_MIN_SECONDS, Math.round(c.seconds))) : TIMER_DEFAULT.seconds;
  const extendBy = typeof c.extendBy === "number" && Number.isFinite(c.extendBy) ? Math.min(TIMER_MAX_EXTEND, Math.max(0, Math.round(c.extendBy))) : TIMER_DEFAULT.extendBy;
  const label = typeof c.label === "string" && c.label.trim() !== "" ? c.label : t("timer.label");
  return { seconds, label, extendBy };
}

/**
 * What a screen reader should be told for a change from one reading of the timer to the next, or null for nothing. `first` is
 * how long the timer started with: a mark is only worth saying if the timer started with more time than that.
 */
export function timerMessage(before: TimerInfo | null, now: TimerInfo, first: number): string | null {
  if (before === null) return null;
  if (now.state === "off") return before.state === "off" ? null : t("timer.isOff");
  if (now.state === "done") return before.state === "done" ? null : t("timer.timeUp");
  if (now.state === "stopped" || before.state !== "running") return null;
  // Time was added: the number went up by more than a second passing could explain.
  if (now.seconds > before.seconds) return t("timer.added", { time: spokenTime(now.seconds) });
  for (const mark of TIMER_MILESTONES) {
    if (mark < first && before.seconds > mark && now.seconds <= mark) return t("timer.left", { time: spokenTime(mark) });
  }
  return null;
}

function make(doc: Document, tag: string, cls: string, text?: string): HTMLElement {
  const e = doc.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface TimerOptions {
  /** In the editor the timer is drawn full and does nothing. */
  editing: boolean;
  /** The learner chose to add time. */
  addTime(): void;
  /** The learner chose to turn the timer off. */
  turnOff(): void;
}

export interface TimerView {
  el: HTMLElement;
  /** Show the timer as it is now. */
  update(info: TimerInfo): void;
}

export function buildTimer(doc: Document, obj: OSObject, options: TimerOptions): TimerView {
  const c = timerContentOf(obj);
  const root = make(doc, "div", "os-timer");
  root.setAttribute("role", "group");
  if (!obj.accessibility.decorative) root.setAttribute("aria-label", obj.accessibility.altText);

  const labelId = `${obj.id}-timer-label`;
  const label = make(doc, "p", "os-timer-label", c.label);
  label.id = labelId;
  const clock = make(doc, "p", "os-timer-clock", clockText(c.seconds));
  // role "timer" is not announced as it changes, which is what is wanted: a screen reader user reads it when they ask.
  clock.setAttribute("role", "timer");
  clock.setAttribute("aria-labelledby", labelId);
  clock.setAttribute("aria-live", "off");
  const bar = make(doc, "div", "os-timer-bar");
  bar.setAttribute("aria-hidden", "true");
  const fill = make(doc, "div", "os-timer-fill");
  fill.style.width = "100%";
  bar.append(fill);
  const note = make(doc, "p", "os-timer-note", "");
  const said = make(doc, "p", "os-sr-only");
  said.setAttribute("role", "status");

  const add = make(doc, options.editing ? "span" : "button", "os-timer-btn os-timer-add", addTimeLabel(c.extendBy));
  const off = make(doc, options.editing ? "span" : "button", "os-timer-btn os-timer-off", t("timer.turnOff"));
  for (const b of [add, off]) if (!options.editing) b.setAttribute("type", "button");
  const buttons = make(doc, "div", "os-timer-buttons");
  if (c.extendBy > 0) buttons.append(add);
  buttons.append(off);
  root.append(label, clock, bar, note, buttons, said);

  if (!options.editing) {
    // A button that cannot be used is dimmed and says so, but stays where focus can rest: if it were disabled, pressing it would drop the focus.
    add.addEventListener("click", () => { if (add.getAttribute("aria-disabled") !== "true") options.addTime(); });
    off.addEventListener("click", () => { if (off.getAttribute("aria-disabled") !== "true") options.turnOff(); });
  }

  let last: TimerInfo | null = null;
  let widest = c.seconds;
  return {
    el: root,
    update(info) {
      const message = timerMessage(last, info, c.seconds);
      last = info;
      widest = Math.max(widest, info.seconds);
      const running = info.state === "running";
      clock.textContent = info.state === "off" ? t("timer.clockOff") : clockText(info.seconds);
      fill.style.width = running ? `${Math.max(0, Math.min(100, (info.seconds / widest) * 100))}%` : "0%";
      note.textContent = info.state === "off" ? t("timer.isOff") : info.state === "done" ? t("timer.timeUp") : info.state === "stopped" ? t("timer.stopped") : info.paused ? t("timer.paused") : "";
      for (const b of [add, off]) b.setAttribute("aria-disabled", String(!running));
      if (message !== null) said.textContent = message;
    },
  };
}
