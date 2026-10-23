import assert from "node:assert/strict";
import { test } from "node:test";
import { clampDuration, EFFECTS, frames, GUARD_MS, HIDDEN_CLASS, hasAnimation, hasSlideTransition, NO_EFFECT, play, Presenter, reducedMotion, SLIDE_DISTANCE, ZOOM_FROM } from "./animation.ts";
import type { Effect } from "./types.ts";

/** An element that records what it is told, and an animation that ends when the test says so. */
interface FakeAnimation { finished: Promise<void>; cancel(): void; finish(): void; end(): void }
function fakeElement(withAnimate = true) {
  const classes = new Set<string>();
  const calls: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] = [];
  const animations: FakeAnimation[] = [];
  const el = {
    classList: {
      add: (c: string) => { classes.add(c); },
      remove: (c: string) => { classes.delete(c); },
      contains: (c: string) => classes.has(c),
    },
    animate: withAnimate ? (keyframes: Keyframe[], options: KeyframeAnimationOptions): FakeAnimation => {
      calls.push({ keyframes, options });
      let done!: () => void;
      let abort!: (e: Error) => void;
      const finished = new Promise<void>((ok, bad) => { done = ok; abort = bad; });
      const a: FakeAnimation = { finished, cancel: () => abort(new Error("AbortError")), finish: () => done(), end: () => done() };
      animations.push(a);
      return a;
    } : undefined,
  } as unknown as HTMLElement;
  return { el, classes, calls, animations };
}
const settle = () => new Promise<void>((r) => setTimeout(r, 0));
const fade: Effect = { effect: "fade", duration: 600 };

test("every effect has a way in and a way out, and none has nothing to play", () => {
  assert.deepEqual([...EFFECTS], ["none", "fade", "slideLeft", "slideRight", "slideTop", "slideBottom", "zoom"]);
  for (const effect of EFFECTS) {
    for (const phase of ["enter", "exit"] as const) {
      const k = frames(effect, phase);
      if (effect === "none") { assert.equal(k, null); continue; }
      assert.equal(k!.length, 2, `${effect} ${phase}`);
      assert.equal(k![phase === "enter" ? 0 : 1]!["opacity"], 0, "it is away, and see-through, at one end");
      assert.equal(k![phase === "enter" ? 1 : 0]!["opacity"], 1, "and fully there at the other");
    }
  }
});

test("an exit is an entrance run backwards", () => {
  for (const effect of EFFECTS.filter((e) => e !== "none")) {
    assert.deepEqual(frames(effect, "exit"), [...frames(effect, "enter")!].reverse(), effect);
  }
});

test("each slide comes from, or goes toward, its own side, by a short distance", () => {
  const from = (e: "slideLeft" | "slideRight" | "slideTop" | "slideBottom") => frames(e, "enter")![0]!["translate"];
  assert.equal(from("slideLeft"), `${-SLIDE_DISTANCE}px 0`);
  assert.equal(from("slideRight"), `${SLIDE_DISTANCE}px 0`);
  assert.equal(from("slideTop"), `0 ${-SLIDE_DISTANCE}px`);
  assert.equal(from("slideBottom"), `0 ${SLIDE_DISTANCE}px`);
  assert.ok(SLIDE_DISTANCE <= 60, "a short move");
  assert.equal(frames("slideLeft", "enter")![1]!["translate"], "0 0");
  assert.equal(frames("zoom", "enter")![0]!["scale"], String(ZOOM_FROM));
  assert.equal(frames("zoom", "enter")![1]!["scale"], "1");
});

test("effects use translate and scale, not transform, so a rotated object keeps its rotation", () => {
  for (const effect of EFFECTS) for (const phase of ["enter", "exit"] as const) {
    for (const k of frames(effect, phase) ?? []) assert.ok(!("transform" in k), `${effect} ${phase}`);
  }
});

test("a duration is kept to what the format allows", () => {
  assert.equal(clampDuration(50), 100);
  assert.equal(clampDuration(100), 100);
  assert.equal(clampDuration(750.4), 750);
  assert.equal(clampDuration(2000), 2000);
  assert.equal(clampDuration(60000), 2000);
});

test("an animation does something only if one of its effects does", () => {
  assert.equal(hasAnimation({ enter: NO_EFFECT, exit: NO_EFFECT }), false);
  assert.equal(hasAnimation({ enter: fade, exit: NO_EFFECT }), true);
  assert.equal(hasAnimation({ enter: NO_EFFECT, exit: fade }), true);
});

test("an entrance holds its first frame, eases out, and leaves the object as it really is when it ends", () => {
  const f = fakeElement();
  const p = play(f.el, fade, "enter")!;
  assert.ok(p);
  assert.deepEqual(f.calls[0]!.options, { duration: 600, easing: "ease-out", fill: "backwards" });
  assert.deepEqual(f.calls[0]!.keyframes, frames("fade", "enter"));
});

test("an exit holds its last frame and eases in", () => {
  const f = fakeElement();
  play(f.el, { effect: "zoom", duration: 300 }, "exit");
  assert.deepEqual(f.calls[0]!.options, { duration: 300, easing: "ease-in", fill: "forwards" });
});

test("a duration outside the format is clamped when it plays", () => {
  const f = fakeElement();
  play(f.el, { effect: "fade", duration: 99999 }, "enter");
  assert.equal(f.calls[0]!.options.duration, 2000);
});

test("nothing plays for no effect, or in a browser that cannot animate", () => {
  const f = fakeElement();
  assert.equal(play(f.el, NO_EFFECT, "enter"), null);
  assert.equal(f.calls.length, 0);
  assert.equal(play(fakeElement(false).el, fade, "enter"), null);
});

test("an effect is over when it ends and also when it is stopped, and stopping is not a failure", async () => {
  const f = fakeElement();
  const p = play(f.el, fade, "enter")!;
  let over = false;
  void p.finished.then(() => { over = true; });
  await settle();
  assert.equal(over, false);
  f.animations[0]!.end();
  await settle();
  assert.equal(over, true);
  const q = play(f.el, fade, "enter")!;
  q.cancel();
  await assert.doesNotReject(q.finished);
});

test("the device's request for less motion is read from the browser, and is no request where there is no way to ask", () => {
  const real = (globalThis as { matchMedia?: unknown }).matchMedia;
  try {
    (globalThis as { matchMedia?: unknown }).matchMedia = undefined;
    assert.equal(reducedMotion(), false);
    (globalThis as { matchMedia?: unknown }).matchMedia = (q: string) => ({ matches: q === "(prefers-reduced-motion: reduce)" });
    assert.equal(reducedMotion(), true);
    (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false });
    assert.equal(reducedMotion(), false);
  } finally {
    (globalThis as { matchMedia?: unknown }).matchMedia = real;
  }
});

test("showing with no effect just puts the object in the page, and hiding takes it out at once", () => {
  const presenter = new Presenter();
  const f = fakeElement();
  presenter.set("a", f.el, false);
  assert.equal(f.classes.has(HIDDEN_CLASS), true);
  presenter.set("a", f.el, true);
  assert.equal(f.classes.has(HIDDEN_CLASS), false);
  assert.equal(f.calls.length, 0);
  presenter.set("a", f.el, false);
  assert.equal(f.classes.has(HIDDEN_CLASS), true);
  assert.equal(presenter.running, 0);
});

test("an entrance puts the object in the page first, and then plays", () => {
  const presenter = new Presenter();
  const f = fakeElement();
  presenter.set("a", f.el, false);
  presenter.set("a", f.el, true, fade);
  assert.equal(f.classes.has(HIDDEN_CLASS), false, "readable from the first moment of the effect");
  assert.equal(f.calls.length, 1);
  assert.equal(presenter.running, 1);
});

test("an exit keeps the object in the page while it plays, then takes it out and clears the effect", async () => {
  const presenter = new Presenter();
  const f = fakeElement();
  presenter.set("a", f.el, true);
  presenter.set("a", f.el, false, fade);
  assert.equal(f.classes.has(HIDDEN_CLASS), false, "still there, so nothing is read or reached out of order, while it leaves");
  assert.equal(f.calls[0]!.options.fill, "forwards");
  f.animations[0]!.end();
  await settle();
  assert.equal(f.classes.has(HIDDEN_CLASS), true);
  assert.equal(presenter.running, 0);
});

test("an object that was never on the page has no exit to play", () => {
  const presenter = new Presenter();
  const f = fakeElement();
  f.classes.add(HIDDEN_CLASS);
  presenter.set("a", f.el, false, fade);
  assert.equal(f.calls.length, 0, "it was already hidden");
  assert.equal(f.classes.has(HIDDEN_CLASS), true);
});

test("a show that comes during an exit stops the exit and leaves the object there", async () => {
  const presenter = new Presenter();
  const f = fakeElement();
  presenter.set("a", f.el, true);
  presenter.set("a", f.el, false, fade);
  presenter.set("a", f.el, true);
  await settle();
  assert.equal(f.classes.has(HIDDEN_CLASS), false, "the cancelled exit must not hide it afterwards");
  assert.equal(presenter.running, 0);
});

test("a hide that comes during an entrance stops it and goes on to hide", async () => {
  const presenter = new Presenter();
  const f = fakeElement();
  presenter.set("a", f.el, true, fade);
  presenter.set("a", f.el, false);
  assert.equal(f.classes.has(HIDDEN_CLASS), true);
  await settle();
  assert.equal(f.classes.has(HIDDEN_CLASS), true);
});

test("ending everything leaves what was arriving there and puts away what was leaving", async () => {
  const presenter = new Presenter();
  const arriving = fakeElement();
  const leaving = fakeElement();
  presenter.set("in", arriving.el, true, fade);
  presenter.set("out", leaving.el, true);
  presenter.set("out", leaving.el, false, fade);
  presenter.endAll();
  await settle();
  assert.equal(arriving.classes.has(HIDDEN_CLASS), false);
  assert.equal(leaving.classes.has(HIDDEN_CLASS), true);
  assert.equal(presenter.running, 0);
});

test("clearing for a new slide stops everything and leaves nothing waiting to hide a thing that is gone", async () => {
  const presenter = new Presenter();
  const f = fakeElement();
  presenter.set("a", f.el, true);
  presenter.set("a", f.el, false, fade);
  presenter.clear();
  await settle();
  assert.equal(presenter.running, 0);
  assert.equal(f.classes.has(HIDDEN_CLASS), false, "the old object is not touched after its slide has gone");
});

/** Let promises that are ready run, without a timer, because timers are held by hand while it is used. */
const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

/** Run a test with the timers held by hand, so a guard can be fired or found cleared. */
function withHeldTimers(test: (timers: { due: () => { ms: number }[]; fire: () => void; cleared: () => number }) => Promise<void> | void): Promise<void> | void {
  const real = { set: globalThis.setTimeout, clear: globalThis.clearTimeout };
  const held: { id: number; ms: number; fn: () => void }[] = [];
  let next = 1;
  let cleared = 0;
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void, ms: number) => { held.push({ id: next, ms, fn }); return next++; }) as unknown;
  (globalThis as { clearTimeout: unknown }).clearTimeout = ((id: number) => { cleared++; const at = held.findIndex((h) => h.id === id); if (at >= 0) held.splice(at, 1); }) as unknown;
  const restore = () => { (globalThis as { setTimeout: unknown }).setTimeout = real.set; (globalThis as { clearTimeout: unknown }).clearTimeout = real.clear; };
  try {
    const result = test({ due: () => held.map((h) => ({ ms: h.ms })), fire: () => held.shift()?.fn(), cleared: () => cleared });
    if (result instanceof Promise) return result.finally(restore);
    restore();
  } catch (e) {
    restore();
    throw e;
  }
}

test("a timer finishes an effect shortly after it should be over, in case the page is not being drawn", () =>
  withHeldTimers(async ({ due, fire }) => {
    const f = fakeElement();
    let over = false;
    const p = play(f.el, { effect: "fade", duration: 600 }, "enter")!;
    void p.finished.then(() => { over = true; });
    assert.deepEqual(due(), [{ ms: 600 + GUARD_MS }], "one timer, a little longer than the effect");
    fire();
    await flush();
    assert.equal(over, true, "the effect is over because the timer finished it");
  }));

test("the timer is put away when the effect ends or is stopped, so nothing is left to finish a later effect", () =>
  withHeldTimers(async ({ due, cleared }) => {
    const f = fakeElement();
    const first = play(f.el, fade, "enter")!;
    f.animations[0]!.end();
    await first.finished;
    assert.equal(due().length, 0);
    const second = play(f.el, fade, "exit")!;
    assert.equal(due().length, 1);
    second.cancel();
    assert.equal(due().length, 0);
    assert.ok(cleared() >= 2);
  }));

test("an object whose effect the page never draws still arrives, and one that was leaving still goes", () =>
  withHeldTimers(async ({ fire }) => {
    const presenter = new Presenter();
    const f = fakeElement();
    presenter.set("a", f.el, true, fade);
    fire();
    await flush();
    assert.equal(presenter.running, 0, "the entrance was finished, so it is no longer holding the object");
    presenter.set("a", f.el, false, fade);
    assert.equal(f.classes.has(HIDDEN_CLASS), false);
    fire();
    await flush();
    assert.equal(f.classes.has(HIDDEN_CLASS), true, "the exit was finished, so the object has gone");
  }));

test("a slide's transition does something only if it has an effect other than none, going in or going out", () => {
  const fade: Effect = { effect: "fade", duration: 500 };
  assert.equal(hasSlideTransition(undefined), false);
  assert.equal(hasSlideTransition({}), false);
  assert.equal(hasSlideTransition({ enter: NO_EFFECT, exit: NO_EFFECT }), false);
  assert.equal(hasSlideTransition({ enter: fade }), true);
  assert.equal(hasSlideTransition({ exit: fade }), true);
  assert.equal(hasSlideTransition({ enter: NO_EFFECT, exit: { effect: "zoom", duration: 300 } }), true);
});
