// Tests for editing narration in the model: writing a script, choosing a voice, speed and pronunciations.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Model } from "./model.ts";
import { buildVoiceSources, emptyAi, allow, withKey } from "./aiservices.ts";
import { audioStatus, keyOf, setVoiceSources, soundIgnoresLanguage, type CachedAudio, type Narration } from "./narration.ts";
import { newProjectFiles } from "./template.ts";

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-10" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const narrationOf = (m: Model, id: string): Narration | null => (m.objects.find((o) => o.id === id)?.narration as Narration | null) ?? null;

test("an object has no narration until a script is written", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  assert.equal(narrationOf(m, t.id), null);
  assert.equal(m.setNarrationScript(t.id, "   "), null, "blank words make nothing");
  assert.equal(narrationOf(m, t.id), null);
  assert.deepEqual(m.narratedObjects(), []);
});

test("the first words make narration with the default voice, and the stored language follows the voice", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  const msg = m.setNarrationScript(t.id, "  Welcome to the course.  ");
  assert.equal(msg, `Added narration to ${t.name}`);
  assert.deepEqual(narrationOf(m, t.id), { script: "Welcome to the course.", voice: "af_heart", speed: 1, lang: "en-US", pronunciations: [], audioCache: null });
  assert.equal(m.setNarrationScript(t.id, "Welcome to the course."), null, "the same words change nothing");
  assert.equal(m.setNarrationScript(t.id, "Welcome to this course."), "Narration updated");
});

test("a second narration takes the voice and speed of the one before, so a course keeps one voice", () => {
  const m = fresh();
  const a = m.addObject("text")!;
  const b = m.addObject("text")!;
  m.setNarrationScript(a.id, "First.");
  m.setNarrationVoice(a.id, "bf_emma");
  assert.equal(m.setNarrationSpeed(a.id, 0.9).ok, true);
  m.addPronunciation(a.id, "First", "f\u025c\u02d0st");
  m.setNarrationScript(b.id, "Second.");
  const n = narrationOf(m, b.id)!;
  assert.equal(n.voice, "bf_emma");
  assert.equal(n.speed, 0.9);
  assert.equal(n.lang, "en-GB");
  assert.deepEqual(n.pronunciations, [], "pronunciations belong to words, not to a voice");
});

test("clearing the script removes the narration, and undo brings all of it back", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  m.setNarrationScript(t.id, "Hello there.");
  m.setNarrationVoice(t.id, "am_adam");
  m.addPronunciation(t.id, "Hello", "h\u0259\u02c8lo\u028a");
  const before = JSON.stringify(narrationOf(m, t.id));
  assert.equal(m.setNarrationScript(t.id, ""), `Removed the narration from ${t.name}`);
  assert.equal(narrationOf(m, t.id), null);
  assert.equal(m.setNarrationScript(t.id, ""), null, "nothing left to remove");
  assert.ok(m.undo());
  assert.equal(JSON.stringify(narrationOf(m, t.id)), before, "voice and pronunciations come back too");
});

test("a voice must be one that exists, and changing it changes the language", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  m.setNarrationScript(t.id, "Bonjour.");
  assert.equal(m.setNarrationVoice(t.id, "nobody_here"), null);
  assert.equal(narrationOf(m, t.id)!.voice, "af_heart");
  assert.equal(m.setNarrationVoice(t.id, "ff_siwis"), "Voice changed to Siwis, woman");
  assert.equal(narrationOf(m, t.id)!.lang, "fr-FR");
  assert.equal(m.setNarrationVoice(t.id, "ff_siwis"), null, "no change");
  assert.equal(m.setNarrationVoice("missing-object", "af_heart"), null);
});

test("speed is limited to 0.5 to 2 and kept to two decimals", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  m.setNarrationScript(t.id, "Slowly.");
  assert.deepEqual(m.setNarrationSpeed(t.id, 0.4), { ok: false, message: "Speed must be a number from 0.5 to 2." });
  assert.deepEqual(m.setNarrationSpeed(t.id, 2.5), { ok: false, message: "Speed must be a number from 0.5 to 2." });
  assert.equal(m.setNarrationSpeed(t.id, Number.NaN).ok, false);
  assert.deepEqual(m.setNarrationSpeed(t.id, 0.857), { ok: true, message: "Speed 0.86" });
  assert.equal(narrationOf(m, t.id)!.speed, 0.86);
  assert.deepEqual(m.setNarrationSpeed(t.id, 0.86), { ok: true, message: "" }, "no change");
  assert.deepEqual(m.setNarrationSpeed(t.id, 0.5), { ok: true, message: "Speed 0.5" });
  assert.deepEqual(m.setNarrationSpeed(t.id, 2), { ok: true, message: "Speed 2" });
});

test("every speed the editor allows is written the same way in Python and here", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  // Two decimals never land on a tie at the third, which is where JavaScript and Python round differently.
  const speeds = Array.from({ length: 151 }, (_, i) => (50 + i) / 100);
  const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, ["-c", "import sys; print(','.join(f'{float(s):.3f}' for s in sys.argv[1:]))", ...speeds.map(String)], { encoding: "utf-8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(speeds.map((s) => s.toFixed(3)), r.stdout.trim().split(","));
});

test("a pronunciation needs a word and valid IPA, and a word is only taught once", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  m.setNarrationScript(t.id, "Rate it on the Likert scale.");
  assert.equal(m.addPronunciation(t.id, "", "lik").ok, false);
  assert.equal(m.addPronunciation(t.id, "Likert", "").ok, false);
  const bad = m.addPronunciation(t.id, "Likert", "<b>lik</b>");
  assert.equal(bad.ok, false);
  assert.match(bad.message, /not IPA/);
  assert.deepEqual(narrationOf(m, t.id)!.pronunciations, [], "nothing was added by the refusals");
  const ok = m.addPronunciation(t.id, "  Likert ", " \u02c8l\u026ak\u0259rt ");
  assert.deepEqual(ok, { ok: true, message: "Likert will be said \u02c8l\u026ak\u0259rt" });
  assert.deepEqual(narrationOf(m, t.id)!.pronunciations, [{ term: "Likert", ipa: "\u02c8l\u026ak\u0259rt" }]);
  assert.match(m.addPronunciation(t.id, "likert", "lik").message, /already has a pronunciation/);
  assert.equal(m.addPronunciation(t.id, "scale", "sk\u00e6l").ok, true, "the ordinary letters of the IPA are fine");
});

test("a pronunciation can be changed or removed, and a word keeps its own name when its sound changes", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  m.setNarrationScript(t.id, "Likert and Wrench.");
  m.addPronunciation(t.id, "Likert", "lik");
  m.addPronunciation(t.id, "Wrench", "r\u025bnt\u0283");
  assert.equal(m.updatePronunciation(t.id, 0, "Likert", "l\u026ak").ok, true, "the same word with a new sound");
  assert.equal(narrationOf(m, t.id)!.pronunciations[0]!.ipa, "l\u026ak");
  const clash = m.updatePronunciation(t.id, 1, "Likert", "x");
  assert.equal(clash.ok, false);
  assert.match(clash.message, /already has a pronunciation/);
  assert.equal(m.updatePronunciation(t.id, 5, "x", "y").ok, false, "no such row");
  assert.equal(m.deletePronunciation(t.id, 0), "Removed the pronunciation of Likert");
  assert.deepEqual(narrationOf(m, t.id)!.pronunciations.map((p) => p.term), ["Wrench"]);
  assert.equal(m.deletePronunciation(t.id, 9), null);
});

test("changing a word, the voice, the speed or a pronunciation changes the audio's key, so new audio is needed", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  m.setNarrationScript(t.id, "Hello.");
  const keys = new Set<string>([keyOf(narrationOf(m, t.id)!)]);
  m.setNarrationVoice(t.id, "af_bella"); keys.add(keyOf(narrationOf(m, t.id)!));
  m.setNarrationSpeed(t.id, 1.1); keys.add(keyOf(narrationOf(m, t.id)!));
  m.addPronunciation(t.id, "Hello", "h\u025blo\u028a"); keys.add(keyOf(narrationOf(m, t.id)!));
  m.setNarrationScript(t.id, "Hello again."); keys.add(keyOf(narrationOf(m, t.id)!));
  assert.equal(keys.size, 5);
});

test("narrated objects are listed slide by slide, layer by layer, in the order they play", () => {
  const m = fresh();
  const first = m.addObject("text")!;
  const second = m.addObject("text")!;
  m.setNarrationScript(second.id, "Second in the list.");
  m.setNarrationScript(first.id, "First in the list.");
  const slide2 = m.addSlide();
  m.selectSlide(slide2.id);
  const third = m.addObject("text")!;
  m.setNarrationScript(third.id, "On slide two.");
  const layer = m.addLayer()!;
  m.selectLayer(layer.id);
  const fourth = m.addObject("text")!;
  m.setNarrationScript(fourth.id, "On a layer.");
  const list = m.narratedObjects();
  assert.deepEqual(list.map((n) => n.narration.script), ["First in the list.", "Second in the list.", "On slide two.", "On a layer."]);
  assert.deepEqual(list.map((n) => n.object.id), [first.id, second.id, third.id, fourth.id]);
  assert.equal(list[3]!.layerId, layer.id);
  assert.equal(list[2]!.slideId, slide2.id);
  assert.equal(list[2]!.slideName, slide2.name);
});

test("narration is saved in the object's file and reads back unchanged", () => {
  const m = fresh();
  const t = m.addObject("text")!;
  m.setNarrationScript(t.id, "Saved words.");
  const file = m.dirtyFiles().find((f) => f.path === `slides/${m.slide!.id}.json`)!;
  const stored = (JSON.parse(file.text) as { baseLayer: { objects: { id: string; narration: Narration }[] } }).baseLayer.objects.find((o) => o.id === t.id)!;
  assert.deepEqual(stored.narration, narrationOf(m, t.id));
  assert.equal(stored.narration.audioCache, null, "the cache is found by its key, not remembered in the file");
});

test("audio is found again by its words, so changing the language of an online voice and changing it back keeps the audio, but a new language is new audio", () => {
  // OpenAI makes the same sound whatever the language box says, but the language is part of what names the audio, so a new language is a new name.
  // The editor keeps the audio already made under the new name (soundIgnoresLanguage, and the shell's reuse_narration_audio), so nothing is paid for twice; this test is about the
  // names: a new language is a new key, and it is found again, with no new charge, when it is changed back.
  setVoiceSources(buildVoiceSources(allow(withKey(emptyAi(), "openai", "sk-1"), "openai", "2026-10-14T10:00:00Z"), []));
  try {
    const m = fresh();
    const t = m.addObject("text")!;
    m.setNarrationScript(t.id, "Welcome to the course.");
    assert.ok(m.setNarrationVoice(t.id, "openai:alloy"));
    const original = narrationOf(m, t.id)!;
    const made = new Map<string, CachedAudio>([[keyOf(original), { hash: keyOf(original), duration: 3, exactTimings: false }]]);
    assert.equal(audioStatus(original, made).state, "ready");
    assert.ok(m.setNarrationLang(t.id, "es"));
    assert.equal(audioStatus(narrationOf(m, t.id)!, made).state, "missing", "a new language is a new name, so the audio has to be made");
    assert.ok(m.setNarrationLang(t.id, original.lang));
    assert.equal(audioStatus(narrationOf(m, t.id)!, made).state, "ready", "back to the first language, the first audio is found again");
  } finally {
    setVoiceSources([]);
  }
});

test("only a voice that sounds the same in every language has its audio kept when the language changes", () => {
  assert.equal(soundIgnoresLanguage("openai:alloy"), true);
  assert.equal(soundIgnoresLanguage("af_heart"), false, "a Kokoro voice has its own language");
  assert.equal(soundIgnoresLanguage("some-plugin:voice"), false, "a plugin's voice is told the language, so it may sound different");
  assert.equal(soundIgnoresLanguage("unknown:thing"), false);
  // The key that the audio would be kept under is the one the narration has after the change, and nothing else about the narration is part of it.
  const before: Narration = { script: "Hello.", voice: "openai:alloy", speed: 1, lang: "en-US", pronunciations: [], audioCache: null };
  assert.notEqual(keyOf(before), keyOf({ ...before, lang: "es" }));
  assert.equal(keyOf({ ...before, lang: "es" }), keyOf({ ...before, lang: "es", audioCache: { hash: "x", path: "y" } }), "the remembered cache is not part of the key");
});
