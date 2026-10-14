// Tests for the AI services settings and wording, and for how other engines' voices join the voice list.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import {
  allow, audioPlan, availability, buildVoiceSources, creditForMade, disclosureNote, emptyAi, hasKey, isAllowed, nowStamp, OPENAI_VOICES, parseAi, parseMade, parsePlugins,
  parseServiceAnswer, permissionText, promptProblem, SERVICES, serviceById, servicesToAsk, titleFromPrompt, usable, voiceLimits, voiceNote,
  withdraw, withKey, type AiSettings, type PluginInfo,
} from "./aiservices.ts";
import {
  engineOf, isKnownVoice, langAfterVoiceChange, langForVoice, languageOptions, newNarration, setVoiceSources, voiceGroups, voiceOption, voiceTraits, VOICES, type Narration,
} from "./narration.ts";
import { parseSettings, serializeSettings } from "./stock.ts";

afterEach(() => setVoiceSources([]));

const plugin = (over: Partial<PluginInfo> = {}): PluginInfo => ({
  id: "tone-voice", name: "Tone voice", version: "1.0.0", licence: "Apache-2.0", network: false, description: "", pronunciations: false, wordTimings: true, enabled: true,
  voices: [{ id: "tone-voice:low", name: "Low beeps", lang: "en-US", description: "" }], ...over,
});

const ready = (): AiSettings => ({
  ...emptyAi(), keys: { openai: "sk-1" }, allowed: { openai: "2026-10-14T10:00:00Z" },
});

const spoken = (voice: string, script = "Hello there."): Narration => ({ script, voice, speed: 1, lang: "en-US", pronunciations: [], audioCache: null });

// ---- settings

test("settings start empty, and anything odd in them is ignored", () => {
  assert.deepEqual(parseAi(undefined), emptyAi());
  assert.deepEqual(parseAi("nonsense"), emptyAi());
  const ai = parseAi({
    keys: { openai: "  sk-1  ", elevenlabs: 5, other: "x" }, allowed: { openai: "2026-10-14T10:00:00Z", elevenlabs: true },
    models: { openai: { speech: " tts-1 ", picture: 3 } }, plugins: { "tone-voice": true, "Bad Id": true, off: false, "x": true },
    voices: { elevenlabs: [{ id: "a1", name: "Ann", hint: "calm" }, { id: "", name: "No id" }, "junk"] },
  });
  assert.equal(ai.keys.openai, "sk-1");
  assert.equal(ai.allowed.openai, "2026-10-14T10:00:00Z");
  assert.deepEqual(ai.models.openai, { speech: "tts-1", picture: "" });
  assert.deepEqual(ai.plugins, { "tone-voice": true });
  // A settings file from when ElevenLabs was part of this, or from anything else OpenStage does not know, is read without it.
  assert.deepEqual(Object.keys(ai.keys), ["openai"]);
  assert.deepEqual(Object.keys(ai.allowed), ["openai"]);
  assert.equal("voices" in ai, false);
});

test("the AI settings travel with the stock keys in the one settings file, and an old file still loads", () => {
  const s = parseSettings("");
  s.ai = allow(withKey(s.ai, "openai", "sk-1"), "openai", "2026-10-14T10:00:00Z");
  const again = parseSettings(serializeSettings({ ...s, publishFolder: "D:\\out" }));
  assert.equal(again.ai.keys.openai, "sk-1");
  assert.equal(again.ai.allowed.openai, "2026-10-14T10:00:00Z");
  assert.equal(again.publishFolder, "D:\\out");
  const old = parseSettings('{"keys":{"pexels":"p"}}');
  assert.equal(old.keys.pexels, "p");
  assert.deepEqual(old.ai, emptyAi());
});

test("a service is used only with a key and the author's yes, and a new key is a new yes", () => {
  let ai = emptyAi();
  assert.equal(usable(ai, "openai"), false);
  ai = withKey(ai, "openai", "  sk-1 ");
  assert.equal(hasKey(ai, "openai"), true);
  assert.equal(usable(ai, "openai"), false, "a key alone is not permission");
  ai = allow(ai, "openai", "2026-10-14T10:00:00Z");
  assert.equal(usable(ai, "openai"), true);
  assert.equal(withKey(ai, "openai", "sk-1"), ai, "the same key changes nothing");
  assert.equal(isAllowed(withKey(ai, "openai", "sk-2"), "openai"), false, "another key may be another account");
  assert.equal(usable(withdraw(ai, "openai"), "openai"), false);
  assert.equal(usable(withKey(ai, "openai", ""), "openai"), false, "removing the key stops it");
});

test("every service says what it sends, and every kind of work it does has words for it", () => {
  for (const s of SERVICES) {
    for (const work of s.works) assert.ok(s.sends[work], `${s.id} ${work}`);
    assert.ok(s.keyUrl.startsWith("https://") && s.home.startsWith("https://"));
  }
  assert.deepEqual(serviceById("openai").works, ["voice", "picture"]);
});

test("OpenAI is the one service, and a voice from one that is not there is simply unavailable", () => {
  assert.deepEqual(SERVICES.map((s) => s.id), ["openai"]);
  const gone = voiceTraits("elevenlabs:21m00Tcm4TlvDq8ikWAM");
  assert.deepEqual([gone.known, gone.where], [false, "unknown"]);
  assert.match(availability(spoken("elevenlabs:21m00Tcm4TlvDq8ikWAM"), { ai: ready(), kokoro: true, plugins: [] }).reason, /not installed/);
});

test("the voices listed for OpenAI are the ones in the shared list, with plain names", () => {
  const shared = JSON.parse(readFileSync(new URL("../../tools/openai-voices.json", import.meta.url), "utf-8")) as { voices: string[] };
  assert.deepEqual(OPENAI_VOICES.map((v) => v.id), shared.voices);
  assert.ok(shared.voices.length >= 11 && shared.voices.every((v) => /^[a-z]+$/.test(v)));
  assert.equal(OPENAI_VOICES[0]!.label, "Alloy");
});

// ---- plugins and the voice list

test("plugins are read from what the tool lists, and a bad answer is no plugins", () => {
  const list = parsePlugins(JSON.stringify({
    ok: true, plugins: [{ id: "tone-voice", name: "Tone", version: "1", licence: "MIT", network: false, description: "d", pronunciations: false, wordTimings: true, enabled: true,
      voices: [{ id: "tone-voice:low", name: "Low", lang: "en-US", description: "" }, { id: "tone-voice:any", name: "Any", lang: null }, { name: "no id" }] }, { name: "no id" }],
    problems: [{ folder: "broken", problem: "plugin.json is not valid JSON." }],
  }));
  assert.equal(list.plugins.length, 1);
  assert.deepEqual(list.plugins[0]!.voices.map((v) => [v.id, v.lang]), [["tone-voice:low", "en-US"], ["tone-voice:any", null]]);
  assert.equal(list.plugins[0]!.enabled, true);
  assert.deepEqual(list.problems, [{ folder: "broken", problem: "plugin.json is not valid JSON." }]);
  for (const bad of ["", "not json", '{"ok":false}', "[]"]) assert.deepEqual(parsePlugins(bad), { plugins: [], problems: [] }, bad);
});

test("a service's voices appear only when it can be used, and a plugin's only when it is switched on", () => {
  assert.deepEqual(buildVoiceSources(emptyAi(), []), []);
  assert.deepEqual(buildVoiceSources({ ...emptyAi(), keys: { openai: "sk-1" } }, []), [], "a key without a yes");
  const sources = buildVoiceSources(ready(), [plugin(), plugin({ id: "off", name: "Off one", enabled: false })]);
  assert.deepEqual(sources.map((s) => s.engine), ["openai", "tone-voice"]);
  assert.equal(sources[0]!.voices.length, OPENAI_VOICES.length);
  assert.equal(sources[0]!.voices[0]!.id, "openai:alloy");
  assert.equal(sources[1]!.where, "computer");
  assert.equal(buildVoiceSources(ready(), [plugin({ network: true })])[1]!.where, "internet");
});

test("once the sources are set, their voices can be chosen, listed in groups and described", () => {
  setVoiceSources(buildVoiceSources(ready(), [plugin()]));
  assert.equal(isKnownVoice("af_heart"), true);
  assert.equal(isKnownVoice("openai:alloy"), true);
  assert.equal(isKnownVoice("openai:nobody"), false);
  assert.equal(isKnownVoice("tone-voice:low"), true);
  const groups = voiceGroups();
  assert.equal(groups.at(0)!.group, "American English", "Kokoro's voices come first, as they always have");
  assert.deepEqual(groups.slice(-2).map((g) => g.group), ["OpenAI, over the internet", "Tone voice, on this computer"]);
  assert.equal(voiceOption("openai:alloy").label, "Alloy");
  assert.equal(voiceOption("tone-voice:low").group, "Tone voice, on this computer");
  const every = groups.flatMap((g) => g.voices.map((v) => v.id));
  assert.equal(new Set(every).size, every.length, "no voice is listed twice");
  assert.ok(VOICES.every((v) => every.includes(v)), "every Kokoro voice is still there");
});

test("what a voice can do depends on its engine", () => {
  setVoiceSources(buildVoiceSources(ready(), [plugin()]));
  assert.deepEqual(voiceTraits("af_heart"), { engine: "kokoro", engineName: "Kokoro", where: "computer", pronunciations: true, multilingual: false, speed: null, known: true });
  const openai = voiceTraits("openai:alloy");
  assert.deepEqual([openai.engineName, openai.where, openai.pronunciations, openai.multilingual, openai.known], ["OpenAI", "internet", false, true, true]);
  const tone = voiceTraits("tone-voice:low");
  assert.deepEqual([tone.where, tone.multilingual], ["computer", false], "a plugin voice with a language is not multilingual");
  setVoiceSources([]);
  const gone = voiceTraits("openai:alloy");
  assert.deepEqual([gone.known, gone.where, gone.engineName], [false, "internet", "OpenAI"], "a voice whose service is not set up is still known to be a service's");
  assert.deepEqual([voiceTraits("mystery:x").known, voiceTraits("mystery:x").where], [false, "unknown"]);
  assert.equal(engineOf("af_heart"), "kokoro");
  assert.equal(engineOf("openai:alloy"), "openai");
});

test("the language follows the voice, except for a voice that speaks many", () => {
  setVoiceSources(buildVoiceSources(ready(), [plugin()]));
  assert.equal(langForVoice("bf_emma"), "en-GB");
  assert.equal(langForVoice("tone-voice:low"), "en-US");
  assert.equal(langForVoice("openai:alloy", "es"), "es", "the course's language, until the author says otherwise");
  assert.equal(langAfterVoiceChange({ voice: "bf_emma", lang: "en-GB" }, "openai:alloy", "fr-FR"), "fr-FR", "from a one-language voice, the course's language");
  assert.equal(langAfterVoiceChange({ voice: "openai:alloy", lang: "es" }, "openai:echo", "fr-FR"), "es", "between voices that speak many, what the author set");
  assert.equal(langAfterVoiceChange({ voice: "openai:alloy", lang: "es" }, "af_heart", "fr-FR"), "en-US");
  assert.deepEqual(languageOptions("es").map((l) => l.lang).includes("es"), true);
  assert.equal(languageOptions("sw")[0]!.lang, "sw", "a language not on the list is kept at the top");
});

test("new narration keeps the voice and language of the narration nearest to hand", () => {
  setVoiceSources(buildVoiceSources(ready(), []));
  const like = { ...spoken("openai:alloy"), lang: "es", speed: 1.1 };
  const n = newNarration("Hola.", like, "en-US");
  assert.deepEqual([n.voice, n.lang, n.speed], ["openai:alloy", "es", 1.1]);
  setVoiceSources([]);
  assert.equal(newNarration("Hola.", like).voice, "af_heart", "a voice that is no longer available is not carried on");
});

// ---- whether audio can be made

test("audio can be made when the engine is there, and what is missing is said", () => {
  const ctx = { ai: ready(), kokoro: true, plugins: [plugin()] };
  assert.equal(availability(spoken("af_heart"), ctx).state, "ready");
  assert.equal(availability(spoken("af_heart"), { ...ctx, kokoro: false }).state, "blocked");
  assert.match(availability(spoken("af_heart"), { ...ctx, kokoro: false }).reason, /No speech engine/);
  assert.equal(availability(spoken("openai:alloy"), ctx).state, "ready");
  const noKey = availability(spoken("openai:alloy"), { ...ctx, ai: emptyAi() });
  assert.equal(noKey.state, "blocked");
  assert.match(noKey.reason, /Add your OpenAI key/);
  assert.equal(noKey.short, "Add your OpenAI key in AI services.");
  assert.ok(availability(spoken("af_heart"), { ...ctx, kokoro: false }).short.length < 60, "a row of a list gets a short reason");
  const noYes = availability(spoken("openai:alloy"), { ...ctx, ai: withdraw(ready(), "openai") });
  assert.deepEqual([noYes.state, noYes.service], ["needs-permission", "openai"]);
  assert.equal(availability(spoken("tone-voice:low"), ctx).state, "ready");
  assert.match(availability(spoken("tone-voice:low"), { ...ctx, plugins: [plugin({ enabled: false })] }).reason, /Switch on the plugin "Tone voice"/);
  assert.match(availability(spoken("tone-voice:low"), { ...ctx, plugins: [] }).reason, /not installed/);
  assert.equal(availability(spoken("openai:alloy"), { ...ctx, kokoro: false }).state, "ready", "a service needs no speech engine of its own");
});

test("the services that must be asked are the ones with a key and no yes, with what would be sent", () => {
  const ai = withdraw(ready(), "openai");
  const items = [spoken("openai:alloy", "Hello there."), spoken("openai:echo", "Again."), spoken("af_heart", "Local."), spoken("elevenlabs:21m00Tcm4TlvDq8ikWAM", "Other.")];
  assert.deepEqual(servicesToAsk(items, ai), [{ service: "openai", narrations: 2, characters: 18 }]);
  assert.deepEqual(servicesToAsk(items, ready()), [], "nothing to ask once they have said yes");
  assert.deepEqual(servicesToAsk(items, emptyAi()), [], "no key is a different problem, not a question");
});

test("the plan says, for each engine, where the audio is made and whether anything is sent", () => {
  const items = [spoken("af_heart", "Local one."), spoken("openai:alloy", "Hello there."), spoken("openai:echo", "Again."), spoken("tone-voice:low", "Beep.")];
  const plan = audioPlan(items, { ai: ready(), kokoro: true, plugins: [plugin()] });
  assert.equal(plan.length, 3);
  assert.match(plan[0]!, /1 narration uses Kokoro voices.*made on this computer, so nothing is sent anywhere/);
  assert.match(plan[1]!, /2 narrations use OpenAI voices.*\(18 characters\) are sent to OpenAI over the internet.*may charge your account/);
  assert.doesNotMatch(plan[1]!, /asked before/);
  assert.match(plan[2]!, /1 narration uses voices of the plugin "Tone voice".*works on this computer only/);
  const unsure = audioPlan(items, { ai: withdraw(ready(), "openai"), kokoro: false, plugins: [plugin({ network: true })] });
  assert.match(unsure[0]!, /No speech engine/);
  assert.match(unsure[1]!, /You will be asked before anything is sent/);
  assert.match(unsure[2]!, /says it uses the internet/);
  const blocked = audioPlan([spoken("openai:alloy")], { ai: emptyAi(), kokoro: true, plugins: [] });
  assert.match(blocked[0]!, /Add your OpenAI key/);
  assert.deepEqual(audioPlan([], { ai: ready(), kokoro: true, plugins: [] }), []);
});

// ---- the words

test("each voice says where it is made and what it cannot do", () => {
  setVoiceSources(buildVoiceSources(ready(), [plugin(), plugin({ id: "net", name: "Net voice", network: true, voices: [{ id: "net:a", name: "A", lang: null, description: "" }] })]));
  assert.match(voiceNote(voiceTraits("af_heart")), /on this computer by Kokoro. Nothing is sent/);
  assert.match(voiceNote(voiceTraits("openai:alloy")), /OpenAI over the internet, with your key.*may charge your account/);
  assert.match(voiceNote(voiceTraits("tone-voice:low")), /plugin "Tone voice".*works on this computer only.*only plugins you trust/);
  assert.match(voiceNote(voiceTraits("openai:gone")), /not set up here|over the internet/);
  assert.match(voiceNote(voiceTraits("mystery:x")), /not available here/);
  assert.deepEqual(voiceLimits(voiceTraits("af_heart")), []);
  assert.match(voiceLimits(voiceTraits("openai:alloy"))[0]!, /^This voice cannot be taught how to say a word.*spell the word as it sounds/);
  assert.equal(voiceLimits(voiceTraits("openai:alloy")).length, 1, "OpenAI takes every speed the editor allows, so only the pronunciation note");
});

test("listeners are told about an AI voice, and the editor says so when the credits page is off", () => {
  setVoiceSources(buildVoiceSources(ready(), [plugin()]));
  assert.equal(disclosureNote(voiceTraits("openai:alloy"), true), "");
  assert.match(disclosureNote(voiceTraits("openai:alloy"), false), /credits page is off.*OpenAI's rules ask/);
  assert.equal(disclosureNote(voiceTraits("af_heart"), false), "", "the note is about services, which have rules about it");
  assert.equal(disclosureNote(voiceTraits("tone-voice:low"), false), "");
});

test("the question before anything is sent says what is sent, to whom, and that it may cost", () => {
  const voice = permissionText(serviceById("openai"), "voice", { narrations: 3, characters: 420 });
  assert.match(voice[0]!, /send the words of the narration scripts to OpenAI over the internet, using your OpenAI key.*3 narrations, 420 characters/);
  assert.match(voice[1]!, /Nothing else from your course is sent.*may charge your account.*cannot see what it costs/);
  assert.match(voice[2]!, /asked once.*take your permission back/);
  assert.match(permissionText(serviceById("openai"), "picture")[0]!, /the description of the picture you write/);
  assert.match(permissionText(serviceById("openai"), "voice", { narrations: 1, characters: 5 })[0]!, /1 narration, 5 characters/);
});

test("a description must be there and not too long", () => {
  assert.equal(promptProblem("a red barn"), null);
  assert.match(promptProblem("   ")!, /Describe the picture first/);
  assert.match(promptProblem("x".repeat(4001))!, /too long/);
});

// ---- the record kept for something a service made

test("a made picture is credited as AI-made, with the words that made it", () => {
  const c = creditForMade({ path: "assets/images/ai-a-red-barn.png", title: "A red barn", kind: "image", service: "openai", model: "gpt-image-1", prompt: "  A red barn in the snow ", madeAt: "2026-10-14T10:30:00Z" });
  assert.deepEqual(c, {
    path: "assets/images/ai-a-red-barn.png", title: "A red barn", kind: "image",
    source: {
      provider: "generated", url: "https://openai.com/", creator: "OpenAI (gpt-image-1)", creatorUrl: "", licence: "AI-generated; the service's terms of use apply", requiresCredit: true,
      generated: { service: "openai", model: "gpt-image-1", prompt: "A red barn in the snow", madeAt: "2026-10-14T10:30:00Z" },
    },
  });
  assert.equal(creditForMade({ path: "assets/images/x.png", title: "Rain", kind: "image", service: "openai", model: "", prompt: "Rain", madeAt: "2026-10-14T10:30:00Z" }).source.creator, "OpenAI", "no model named, no brackets");
});

test("times and titles come out in the forms the format and the lists use", () => {
  assert.equal(nowStamp(new Date(Date.UTC(2026, 9, 14, 10, 30, 5, 123))), "2026-10-14T10:30:05Z");
  assert.equal(titleFromPrompt("  A red barn   in the snow "), "A red barn in the snow");
  assert.ok(titleFromPrompt("word ".repeat(40)).length <= 60);
});

test("what the tools answer is read, and a bad answer is an error, not a crash", () => {
  assert.deepEqual(parseMade('{"ok":true,"path":"assets/images/ai-x.png","service":"openai","model":"gpt-image-1","bytes":5}'), { ok: true, path: "assets/images/ai-x.png", service: "openai", model: "gpt-image-1" });
  assert.deepEqual(parseMade('{"ok":false,"message":"OpenAI did not accept the key."}'), { ok: false, message: "OpenAI did not accept the key." });
  assert.deepEqual(parseMade('{"ok":false,"cancelled":true,"message":"Cancelled."}'), { ok: false, message: "Cancelled.", cancelled: true });
  assert.equal(parseMade("junk").ok, false);
  assert.equal(parseMade('{"ok":true}').ok, false, "a success with no file is not one");
  assert.deepEqual(parseServiceAnswer('{"ok":true}'), { ok: true });
  assert.equal(parseServiceAnswer('{"ok":false,"message":"Nope."}').ok, false);
  assert.equal(parseServiceAnswer("").ok, false);
});
