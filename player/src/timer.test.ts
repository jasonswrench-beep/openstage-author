import assert from "node:assert/strict";
import { test } from "node:test";
import { addTimeLabel, buildTimer, clockText, spokenTime, timerContentOf, timerMessage, TIMER_DEFAULT, type TimerInfo } from "./timer.ts";
import type { OSObject } from "./types.ts";

test("the time is shown as a clock", () => {
  assert.equal(clockText(30), "0:30");
  assert.equal(clockText(5), "0:05");
  assert.equal(clockText(65), "1:05");
  assert.equal(clockText(600), "10:00");
  assert.equal(clockText(3600), "1:00:00");
  assert.equal(clockText(3725), "1:02:05");
  assert.equal(clockText(0), "0:00");
  assert.equal(clockText(-4), "0:00", "never below nothing");
  assert.equal(clockText(29.2), "0:30", "a part of a second counts as the whole one");
});

test("the time is said in words", () => {
  assert.equal(spokenTime(1), "1 second");
  assert.equal(spokenTime(30), "30 seconds");
  assert.equal(spokenTime(60), "1 minute");
  assert.equal(spokenTime(65), "1 minute 5 seconds");
  assert.equal(spokenTime(120), "2 minutes");
  assert.equal(spokenTime(3600), "1 hour");
  assert.equal(spokenTime(3661), "1 hour 1 minute 1 second");
  assert.equal(spokenTime(0), "0 seconds");
  assert.equal(addTimeLabel(30), "Add 30 seconds");
  assert.equal(addTimeLabel(60), "Add 1 minute");
});

const make = (content: Record<string, unknown> = {}): OSObject => ({
  id: "obj-0009", type: "timer", name: "Timer", geometry: { x: 0, y: 0, width: 360, height: 220, rotation: 0, z: 1 },
  content: { seconds: 30, label: "Time left", extendBy: 30, ...content }, style: {},
  accessibility: { altText: "Time left to answer", role: "group", tabOrder: 4, decorative: false },
  states: {}, triggers: [], timing: { appear: "time", start: 0, visibleFor: null }, animation: { enter: { effect: "none", duration: 500 }, exit: { effect: "none", duration: 500 } }, narration: null, provenance: null, simulation: null,
});

test("a timer with missing or silly numbers still has sensible ones", () => {
  assert.deepEqual(timerContentOf(make()), { seconds: 30, label: "Time left", extendBy: 30 });
  assert.equal(timerContentOf(make({ seconds: 1 })).seconds, 5);
  assert.equal(timerContentOf(make({ seconds: 99999 })).seconds, 3600);
  assert.equal(timerContentOf(make({ seconds: "ten" })).seconds, TIMER_DEFAULT.seconds);
  assert.equal(timerContentOf(make({ extendBy: 0 })).extendBy, 0, "no add button is allowed");
  assert.equal(timerContentOf(make({ extendBy: 5000 })).extendBy, 600);
  assert.equal(timerContentOf(make({ label: "  " })).label, "Time left");
});

const info = (state: TimerInfo["state"], seconds: number, paused = false): TimerInfo => ({ state, seconds, paused });

test("a screen reader is told at a few marks, when time is added, and when it is over, and not every second", () => {
  const said: string[] = [];
  let before: TimerInfo | null = null;
  for (let s = 90; s >= 0; s--) {
    const now = s === 0 ? info("done", 0) : info("running", s);
    const m = timerMessage(before, now, 90);
    if (m) said.push(`${s}: ${m}`);
    before = now;
  }
  assert.deepEqual(said, ["60: 1 minute left.", "30: 30 seconds left.", "10: 10 seconds left.", "0: Time is up."]);
});

test("a mark is only said if the timer began with more time than that", () => {
  const said: string[] = [];
  let before: TimerInfo | null = null;
  for (let s = 20; s > 0; s--) {
    const now = info("running", s);
    const m = timerMessage(before, now, 20);
    if (m) said.push(`${s}: ${m}`);
    before = now;
  }
  assert.deepEqual(said, ["10: 10 seconds left."], "a 20 second timer does not say 30");
  assert.equal(timerMessage(info("running", 31), info("running", 30), 30), null, "and a 30 second timer does not say 30 at its start");
});

test("adding time, turning off and running out are said once; the first reading is not said", () => {
  assert.equal(timerMessage(null, info("running", 30), 30), null);
  assert.equal(timerMessage(info("running", 12), info("running", 42), 30), "Time added. 42 seconds left.");
  assert.equal(timerMessage(info("running", 12), info("off", 12), 30), "The timer is off.");
  assert.equal(timerMessage(info("off", 12), info("off", 12), 30), null);
  assert.equal(timerMessage(info("running", 1), info("done", 0), 30), "Time is up.");
  assert.equal(timerMessage(info("running", 12), info("stopped", 12), 30), null, "a rule stopping it has its own feedback");
  assert.equal(timerMessage(info("running", 12), info("running", 12, true), 30), null, "pausing is said by the pause button");
});

// ---- the page it draws, on a stand-in for the browser's document

interface El {
  tag: string; className: string; textContent: string; id: string; attrs: Map<string, string>; kids: El[]; style: Record<string, string>; listeners: Map<string, () => void>;
  setAttribute(k: string, v: string): void; getAttribute(k: string): string | null; append(...k: El[]): void; addEventListener(e: string, fn: () => void): void;
}
const fakeDoc = {
  createElement(tag: string): El {
    const e: El = {
      tag, className: "", textContent: "", id: "", attrs: new Map(), kids: [], style: {}, listeners: new Map(),
      setAttribute(k, v) { e.attrs.set(k, v); }, getAttribute(k) { return e.attrs.get(k) ?? null; }, append(...k) { e.kids.push(...k); },
      addEventListener(ev, fn) { e.listeners.set(ev, fn); },
    };
    return e;
  },
};
const find = (e: El, cls: string): El | undefined => (e.className.split(" ").includes(cls) ? e : e.kids.map((k) => find(k, cls)).find(Boolean));
const draw = (obj: OSObject, editing = false) => {
  const calls: string[] = [];
  const view = buildTimer(fakeDoc as unknown as Document, obj, { editing, addTime: () => calls.push("add"), turnOff: () => calls.push("off") });
  return { view, root: view.el as unknown as El, calls };
};

test("the timer is a named group with the label, a clock a screen reader reads on request, and the two buttons", () => {
  const { root } = draw(make());
  assert.equal(root.attrs.get("role"), "group");
  assert.equal(root.attrs.get("aria-label"), "Time left to answer");
  const clock = find(root, "os-timer-clock")!;
  assert.equal(clock.textContent, "0:30");
  assert.equal(clock.attrs.get("role"), "timer");
  assert.equal(clock.attrs.get("aria-live"), "off", "the clock is not read out each second");
  assert.equal(clock.attrs.get("aria-labelledby"), find(root, "os-timer-label")!.id);
  assert.equal(find(root, "os-timer-bar")!.attrs.get("aria-hidden"), "true");
  assert.equal(find(root, "os-timer-add")!.textContent, "Add 30 seconds");
  assert.equal(find(root, "os-timer-off")!.textContent, "Turn off the timer");
  assert.equal(find(root, "os-timer-add")!.tag, "button");
  assert.equal(root.kids.at(-1)!.attrs.get("role"), "status", "milestones are said by a status region of its own");
});

test("a timer with no add-time button still has the turn-off button", () => {
  const { root } = draw(make({ extendBy: 0 }));
  assert.equal(find(root, "os-timer-add"), undefined);
  assert.ok(find(root, "os-timer-off"));
});

test("pressing the buttons asks for time or for the timer to go, and nothing happens once it is over", () => {
  const { view, root, calls } = draw(make());
  const press = (cls: string) => find(root, cls)!.listeners.get("click")!();
  view.update(info("running", 20));
  press("os-timer-add");
  press("os-timer-off");
  assert.deepEqual(calls, ["add", "off"]);
  view.update(info("done", 0));
  press("os-timer-add");
  press("os-timer-off");
  assert.deepEqual(calls, ["add", "off"], "a button that is dimmed does nothing, but keeps the keyboard where it was");
  assert.equal(find(root, "os-timer-add")!.attrs.get("aria-disabled"), "true");
});

test("the clock, the bar and the words follow the timer", () => {
  const { view, root } = draw(make({ seconds: 40 }));
  const clock = find(root, "os-timer-clock")!, fill = find(root, "os-timer-fill")!, note = find(root, "os-timer-note")!, said = root.kids.at(-1)!;
  view.update(info("running", 40));
  assert.equal(fill.style["width"], "100%");
  view.update(info("running", 20));
  assert.equal(clock.textContent, "0:20");
  assert.equal(fill.style["width"], "50%");
  view.update(info("running", 20, true));
  assert.equal(note.textContent, "Paused");
  view.update(info("running", 10));
  assert.equal(said.textContent, "10 seconds left.");
  view.update(info("running", 70));
  assert.equal(said.textContent, "Time added. 1 minute 10 seconds left.");
  assert.equal(fill.style["width"], "100%", "the bar is measured against the most time it has had");
  view.update(info("stopped", 33));
  assert.equal(clock.textContent, "0:33");
  assert.equal(note.textContent, "Stopped.");
  assert.equal(fill.style["width"], "0%");
  view.update(info("off", 33));
  assert.equal(clock.textContent, "Off");
  assert.equal(note.textContent, "The timer is off.");
});

test("in the editor the timer is drawn full and its buttons are not buttons", () => {
  const { root } = draw(make(), true);
  assert.equal(find(root, "os-timer-clock")!.textContent, "0:30");
  assert.equal(find(root, "os-timer-add")!.tag, "span");
  assert.equal(find(root, "os-timer-off")!.tag, "span");
  assert.equal(find(root, "os-timer-off")!.listeners.size, 0);
});
