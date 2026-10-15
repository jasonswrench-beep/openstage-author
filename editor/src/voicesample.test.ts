// Tests for hearing a voice before choosing it: the words the editor uses, and reading what the desktop shell answers.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { base64ToBytes, setVoiceSources, voiceTraits } from "./narration.ts";
import { buildVoiceSources, emptyAi, noPlugins, OPENAI_VOICES, type AiSettings, type PluginInfo } from "./aiservices.ts";
import { parseSample, sampleButton, sampleMakingText, sampleNote, samplePlayingText } from "./voicesample.ts";

afterEach(() => setVoiceSources([]));

const ready = (): AiSettings => ({ ...emptyAi(), keys: { openai: "sk-1" }, allowed: { openai: "2026-10-14T10:00:00Z" } });
const plugin = (over: Partial<PluginInfo> = {}): PluginInfo => ({
  id: "tone-voice", name: "Tone voice", version: "1.0.0", licence: "Apache-2.0", network: false, description: "", pronunciations: false, wordTimings: true, enabled: true,
  voices: [{ id: "tone-voice:low", name: "Low beeps", lang: "en-US", description: "" }], ...over,
});

/** A WAV file's bytes: a 44-byte header and some samples. */
function wav(samples = 100): Uint8Array {
  const out = new Uint8Array(44 + samples * 2);
  out.set([82, 73, 70, 70], 0); // RIFF
  out.set([87, 65, 86, 69], 8); // WAVE
  return out;
}
const base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

test("the button says what pressing it will do", () => {
  assert.equal(sampleButton("idle").label, "Hear this voice");
  assert.equal(sampleButton("making").label, "Cancel the sample");
  assert.equal(sampleButton("playing").label, "Stop the sample");
  for (const s of ["idle", "making", "playing"] as const) {
    assert.ok(sampleButton(s).title.length > 0);
    assert.ok(!/[—]/.test(sampleButton(s).label + sampleButton(s).title));
  }
});

test("the note says where a sample is made, and what is sent and charged for a voice of a service", () => {
  assert.match(sampleNote(voiceTraits("af_heart")), /made on this computer/);
  assert.doesNotMatch(sampleNote(voiceTraits("af_heart")), /charge/);

  setVoiceSources(buildVoiceSources(ready(), []));
  const openai = sampleNote(voiceTraits(`openai:${OPENAI_VOICES[0]!.id}`));
  assert.match(openai, /one short sentence/);
  assert.match(openai, /none of your own words/);
  assert.match(openai, /OpenAI may charge your account/);
  assert.match(openai, /kept on this computer/);
  assert.match(openai, /sends nothing and costs nothing/);
  assert.doesNotMatch(openai, /\$|cent|dollar/, "no figure is promised: OpenStage cannot see what it costs");

  setVoiceSources(buildVoiceSources(emptyAi(), [plugin()]));
  assert.match(sampleNote(voiceTraits("tone-voice:low")), /plugin "Tone voice" makes a short sample on this computer/);
  setVoiceSources(buildVoiceSources(emptyAi(), [plugin({ network: true })]));
  assert.match(sampleNote(voiceTraits("tone-voice:low")), /sent to Tone voice over the internet/, "a plugin that uses the internet is told as one that does");
});

test("a voice that cannot be chosen has nothing to hear", () => {
  assert.equal(sampleNote(voiceTraits("openai:alloy")), "", "no key or yes yet: the voice is not on the list");
  assert.equal(sampleNote(voiceTraits("nobody:low")), "");
  assert.equal(sampleNote(voiceTraits("not_a_voice")), "");
});

test("what is said names the voice the way the list does", () => {
  assert.equal(sampleMakingText("af_heart"), "Making a sample of Heart, woman.");
  assert.equal(samplePlayingText("am_adam"), "Playing a sample of Adam, man.");
  setVoiceSources(buildVoiceSources(ready(), []));
  assert.equal(samplePlayingText("openai:alloy"), "Playing a sample of Alloy.");
});

test("a sound that came back is read, with who made it and whether it was kept already", () => {
  const got = parseSample(JSON.stringify({ ok: true, audio: base64(wav()), cached: true, name: "OpenAI", engine: "openai", where: "internet", duration: 2.5 }));
  assert.equal(got.ok, true);
  if (!got.ok) return;
  assert.equal(got.cached, true);
  assert.equal(got.name, "OpenAI");
  assert.equal(got.wav.length, 44 + 200);
  assert.deepEqual(Array.from(got.wav.subarray(0, 4)), [82, 73, 70, 70]);
  const fresh = parseSample(JSON.stringify({ ok: true, audio: base64(wav()) }));
  assert.deepEqual(fresh.ok && [fresh.cached, fresh.name], [false, ""]);
});

test("why there is no sound is passed on in the tool's own words", () => {
  assert.deepEqual(parseSample(JSON.stringify({ ok: false, message: " OpenAI did not accept the key. " })), { ok: false, message: "OpenAI did not accept the key." });
  assert.deepEqual(parseSample(JSON.stringify({ ok: false, cancelled: true, message: "Cancelled." })), { ok: false, message: "Cancelled.", cancelled: true });
  assert.deepEqual(parseSample(JSON.stringify({ ok: false })), { ok: false, message: "The sample could not be made, and nothing said why." });
});

test("an answer that is not a sound is refused, whatever it claims", () => {
  const bad = (raw: string): void => {
    const got = parseSample(raw);
    assert.equal(got.ok, false, raw);
  };
  bad("");
  bad("nonsense");
  bad("null");
  bad("[1]");
  bad(JSON.stringify({ ok: true }));
  bad(JSON.stringify({ ok: true, audio: 5 }));
  bad(JSON.stringify({ ok: true, audio: "!!! not base64 !!!" }));
  assert.equal(parseSample(JSON.stringify({ ok: true, audio: base64(new Uint8Array(100).fill(65)) })).ok, false, "not a WAV file");
  assert.equal(parseSample(JSON.stringify({ ok: true, audio: base64(wav(0).subarray(0, 40)) })).ok, false, "too short to be a WAV file");
  assert.match((parseSample(JSON.stringify({ ok: true, audio: base64(new Uint8Array(100).fill(65)) })) as { message: string }).message, /not a sound/);
});

test("base64 text becomes the same bytes", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
  assert.deepEqual(Array.from(base64ToBytes(base64(bytes))), Array.from(bytes));
  assert.equal(base64ToBytes("").length, 0);
});

test("no plugins and no keys means no extra voices to sample", () => {
  assert.deepEqual(buildVoiceSources(emptyAi(), noPlugins().plugins), []);
});
