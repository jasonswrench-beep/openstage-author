// Tests for making audio from any screen: what is made, what is refused and why, the progress, and how it ends, with a stand-in for the speech tool.
import assert from "node:assert/strict";
import { test } from "node:test";
import { allow, buildVoiceSources, emptyAi, withKey, type AiSettings } from "./aiservices.ts";
import type { Backend } from "./backend.ts";
import { makeAudio, type MakeContext, type MakeEvents } from "./makeaudio.ts";
import { Model } from "./model.ts";
import { keyOf, setVoiceSources, type CachedAudio, type MakeResult, type Narration } from "./narration.ts";
import { newProjectFiles } from "./template.ts";

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-23" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

/** A project with some narrated text objects, and a stand-in speech tool that makes audio for what it is asked, one at a time. */
function setup(over: { scripts?: string[]; kokoro?: boolean; ai?: AiSettings; result?: MakeResult | Error; ask?: (service: string) => boolean } = {}) {
  const m = fresh();
  for (const o of [...m.slide!.baseLayer.objects]) m.deleteObject(o.id);
  const ids = (over.scripts ?? ["First words, long enough to count.", "Second words, a little longer than the first."]).map((script) => {
    const t = m.addObject("text")!;
    m.setNarrationScript(t.id, script);
    return t.id;
  });
  const made = new Map<string, CachedAudio>();
  let cache: ReadonlyMap<string, CachedAudio> = new Map();
  const calls: string[][] = [];
  const asked: string[] = [];
  const backend = {
    narrationCache: async () => [...made.values()],
    makeNarration: async (_dir: string, _files: unknown, keys: string[]): Promise<MakeResult> => {
      calls.push(keys);
      if (over.result instanceof Error) throw over.result;
      if (over.result && !over.result.ok) return over.result;
      for (const n of m.narratedObjects().filter((x) => keys.includes(x.key))) made.set(keyOf(n.narration), { hash: keyOf(n.narration), duration: 12, exactTimings: true });
      return { ok: true };
    },
  } as unknown as Backend;
  const ctx: MakeContext = {
    model: m, backend, ai: () => over.ai ?? emptyAi(), plugins: () => [], kokoro: () => over.kokoro ?? true,
    ask: async (service) => { asked.push(service); return over.ask ? over.ask(service) : true; },
    cache: () => cache,
    refresh: async () => { cache = new Map(made); },
  };
  return { m, ids, ctx, calls, asked, made };
}

test("it makes the audio that is missing, tells the screen how far it has got, and says how it ended", async () => {
  const s = setup();
  const log: string[] = [];
  let lastDone = -1;
  const events: MakeEvents = {
    started: ({ todo, text }) => log.push(`started ${todo.length}: ${text.slice(0, 26)}`),
    progress: (view) => { lastDone = view.done; },
  };
  const outcome = await makeAudio(s.ctx, [], events);
  assert.equal(outcome.state, "done");
  assert.match((outcome as { message: string }).message, /^Done\. 2 narrations\. All have audio\./);
  assert.deepEqual(s.calls, [s.ids], "the speech tool was asked for both");
  assert.equal(log.length, 1);
  assert.match(log[0]!, /^started 2: Making audio for 2 narrat/);
  assert.equal(lastDone, 2, "the last look at the disk saw both");
});

test("asked for one narration, it makes only that one", async () => {
  const s = setup();
  const outcome = await makeAudio(s.ctx, [s.ids[1]!]);
  assert.equal(outcome.state, "done");
  assert.deepEqual(s.calls, [[s.ids[1]!]]);
  assert.match((outcome as { message: string }).message, /^Finished, but 1 narration still has no audio\./);
});

test("when everything has audio there is nothing to make, and the speech tool is not started", async () => {
  const s = setup();
  await makeAudio(s.ctx, []);
  s.calls.length = 0;
  const outcome = await makeAudio(s.ctx, []);
  assert.deepEqual(outcome, { state: "nothing", message: "There is no audio to make." });
  assert.deepEqual(s.calls, []);
});

test("a voice that cannot be made is refused with the reason, and nothing is started", async () => {
  const s = setup({ kokoro: false });
  const outcome = await makeAudio(s.ctx, []);
  assert.equal(outcome.state, "nothing");
  assert.match((outcome as { message: string }).message, /^No audio could be made\. No speech engine is set up on this computer/);
  assert.deepEqual(s.calls, []);
});

test("a service is asked before it is sent anything, and a no leaves its narrations out", async () => {
  const ai = allow(withKey(emptyAi(), "openai", "sk-1"), "openai", "2026-10-23T10:00:00Z");
  setVoiceSources(buildVoiceSources(ai, []));
  const s = setup({ ai: withKey(emptyAi(), "openai", "sk-1"), ask: () => false });
  for (const n of s.m.narratedObjects()) s.m.setNarrationVoice(n.key, "openai:alloy");
  const outcome = await makeAudio(s.ctx, []);
  assert.deepEqual(s.asked, ["openai"], "asked once for the service");
  assert.deepEqual(outcome, { state: "nothing", message: "Nothing was sent, and no audio was made, because you did not allow it." });
  assert.deepEqual(s.calls, []);
});

test("a cancelled run, a failed run and a tool that could not be started each say so", async () => {
  assert.deepEqual(await makeAudio(setup({ result: { ok: false, cancelled: true } }).ctx, []), { state: "cancelled", message: "Making audio was cancelled. Anything it had finished is kept." });
  assert.deepEqual(await makeAudio(setup({ result: { ok: false, message: "The voice stopped." } }).ctx, []), { state: "failed", message: "The voice stopped." });
  assert.deepEqual(await makeAudio(setup({ result: new Error("Could not run the speech engine: gone") }).ctx, []), { state: "failed", message: "Could not run the speech engine: gone" });
});
