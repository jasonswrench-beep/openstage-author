// Making the audio for some narrations, from wherever the author asks: the Narration window, or the button beside a script in the Properties panel. One
// place decides what is to be made, asks before anything is sent to a service, refuses what cannot be made (and says why), watches the audio appear on the disk
// so the author is told how far it has got and how long is left, and says how it ended. The screens only show what they are told. Nothing here needs a window,
// so it is tested alone with a stand-in for the speech tool (makeaudio.test.ts).

import { availability, servicesToAsk, type AiSettings, type PluginInfo, type ServiceId } from "./aiservices.ts";
import { errorText, type Backend } from "./backend.ts";
import type { Model, NarratedObject } from "./model.ts";
import { audioStatus, engineOf, totals, totalsLine, type CachedAudio } from "./narration.ts";
import { RunProgress, kindOfEngine, loadRates, saveRates, startingText, type Job, type ProgressView } from "./narrationprogress.ts";

export interface MakeContext {
  model: Model;
  backend: Backend;
  ai: () => AiSettings;
  plugins: () => readonly PluginInfo[];
  /** Whether the speech engine that runs on this computer (Kokoro) is set up, as last known. */
  kokoro: () => boolean;
  /** Ask whether a service may be sent the narration. Resolves to true if the author says yes (and the editor keeps the answer). */
  ask: (service: ServiceId, detail: { narrations: number; characters: number }) => Promise<boolean>;
  /** The audio that has been made, as the editor last knew it. */
  cache: () => ReadonlyMap<string, CachedAudio>;
  /** Look at the disk again, and update what `cache` returns. */
  refresh: () => Promise<void>;
}

export interface MakeEvents {
  /** Making is about to begin: what will be made, and the sentence that says how long it may take. */
  started?(info: { todo: readonly NarratedObject[]; text: string }): void;
  /** Some audio has appeared (or the first look, with none yet). `fresh` is the audio on the disk now. */
  progress?(view: ProgressView, todo: readonly NarratedObject[], done: ReadonlySet<string>, fresh: ReadonlyMap<string, CachedAudio>): void;
  /** A quarter of the way, half, three quarters: worth saying aloud. */
  milestone?(text: string): void;
}

export type MakeOutcome =
  /** Nothing was made, and nothing was started: there was nothing to make, the author did not allow a service, or no voice could make it. */
  | { state: "nothing"; message: string }
  /** The speech tool ran to the end. The message says how many narrations now have audio in the whole course; `made` is how many this run was asked to make. */
  | { state: "done"; message: string; made: number }
  | { state: "cancelled"; message: string }
  | { state: "failed"; message: string };

/** How often the disk is looked at while audio is being made. */
export const POLL_MS = 1500;

/**
 * Make the audio that is missing for these narrations (by the keys the Narration window uses: an object's id, or "<object id>/<item id>"), or for every narration that
 * lacks it when `asked` is empty. Resolves when the speech tool has finished, was cancelled, or was never started.
 */
export async function makeAudio(ctx: MakeContext, asked: readonly string[], events: MakeEvents = {}): Promise<MakeOutcome> {
  const { model, backend: b } = ctx;
  const context = () => ({ ai: ctx.ai(), kokoro: ctx.kokoro(), plugins: ctx.plugins() });
  // What would be made: the ones asked for (or all that are missing) that have no audio yet.
  let todo = model.narratedObjects().filter((n) => (asked.length === 0 || asked.includes(n.key)) && audioStatus(n.narration, ctx.cache()).state === "missing");
  // A service is asked before it is sent anything for the first time. A "no" leaves out what would have gone to it.
  const left: string[] = [];
  for (const q of servicesToAsk(todo.map((n) => n.narration), ctx.ai())) {
    if (!(await ctx.ask(q.service, { narrations: q.narrations, characters: q.characters }))) {
      todo = todo.filter((n) => engineOf(n.narration.voice) !== q.service);
      left.push(q.service);
    }
  }
  const blocked = todo.filter((n) => availability(n.narration, context()).state === "blocked");
  todo = todo.filter((n) => !blocked.includes(n));
  if (todo.length === 0) {
    return {
      state: "nothing",
      message: left.length > 0 ? "Nothing was sent, and no audio was made, because you did not allow it."
        : blocked.length > 0 ? `No audio could be made. ${availability(blocked[0]!.narration, context()).reason}`
        : "There is no audio to make.",
    };
  }
  const skipped = left.length + blocked.length > 0 ? " Some were left out: you did not allow a service, or an engine is not set up." : "";

  // The speech engine says nothing until it ends, so what is done is read from the audio that has appeared, and the time left from how fast it came.
  const jobs: Job[] = todo.map((n) => ({ key: n.key, characters: n.narration.script.length, kind: kindOfEngine(engineOf(n.narration.voice)) }));
  const progress = new RunProgress(jobs, loadRates(), Date.now());
  events.started?.({ todo, text: startingText(jobs, loadRates()) });
  events.progress?.(progress.update(new Set(), Date.now()), todo, new Set(), new Map());
  let polling = false;
  let announced = 0;
  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      const fresh = new Map((await b.narrationCache(model.dir)).map((c) => [c.hash, c] as const));
      const done = new Set(todo.filter((n) => audioStatus(n.narration, fresh).state === "ready").map((n) => n.key));
      const view = progress.update(done, Date.now());
      events.progress?.(view, todo, done, fresh);
      // Said aloud now and then, not at every change: a quarter of the way, half, three quarters.
      const quarter = Math.floor((view.done * 4) / view.total);
      if (quarter > announced && view.done < view.total) {
        announced = quarter;
        events.milestone?.(`Making audio: ${view.text}`);
      }
    } catch {
      // a failed look is not a reason to stop: the next one may work
    } finally {
      polling = false;
    }
  };
  const timer = setInterval(() => void poll(), POLL_MS);
  try {
    const result = await b.makeNarration(model.dir, model.allFiles(), todo.map((n) => n.key));
    await poll();
    saveRates(progress.measured());
    await ctx.refresh();
    if (result.ok) {
      const t = totals(model.narratedObjects(), ctx.cache());
      return { state: "done", made: todo.length, message: t.missing === 0 ? `Done. ${totalsLine(t)}` : `Finished, but ${t.missing} ${t.missing === 1 ? "narration still has" : "narrations still have"} no audio.${skipped}` };
    }
    return result.cancelled
      ? { state: "cancelled", message: "Making audio was cancelled. Anything it had finished is kept." }
      : { state: "failed", message: result.message ?? "The speech engine did not finish." };
  } catch (err) {
    await ctx.refresh().catch(() => undefined);
    return { state: "failed", message: errorText(err) };
  } finally {
    clearInterval(timer);
  }
}
