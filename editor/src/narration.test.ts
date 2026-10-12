import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  audioStatus, base64ToBytes, DEFAULT_VOICE, excerpt, formatDuration, isValidIpa, keyOf, langForVoice, narrationHash, newNarration, parseMakeResult,
  sha256Hex, statusLine, totals, totalsLine, voiceGroups, voiceOption, VOICES, type CachedAudio, type Narration,
} from "./narration.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const utf8 = (s: string) => new TextEncoder().encode(s);

test("SHA-256 gives the standard answers", () => {
  assert.equal(sha256Hex(utf8("")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex(utf8("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256Hex(utf8("a".repeat(1_000_000))), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
});

test("SHA-256 agrees with Node on every length around a block boundary, and on multi-byte text", () => {
  for (const n of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000]) {
    const bytes = utf8("é日本語x".repeat(n)).slice(0, n);
    assert.equal(sha256Hex(bytes), createHash("sha256").update(bytes).digest("hex"), `length ${n}`);
  }
});

const cases: [Narration, string][] = [
  [{ script: "Hello there.", voice: "af_heart", speed: 1, lang: "en-US", pronunciations: [], audioCache: null },
    "sha256:11df0056c282e4b6afe3cc64e7c095c8b17f3ccbd34a52a2cf583d3507b55f8e"],
  [{ script: "Rate it on a Likert scale.\nSecond line, with é and 日本語.", voice: "bf_emma", speed: 0.85, lang: "en-GB",
    pronunciations: [{ term: "Likert", ipa: "ˈlɪkərt" }, { term: "Wrench", ipa: "rɛntʃ" }], audioCache: null },
    "sha256:9db41f159e0b2332d201fe866542ac17efb0fd5310a400d42b643bf321eaeec8"],
  [{ script: "Speed check.", voice: "am_adam", speed: 1.25, lang: "en-US", pronunciations: [], audioCache: null },
    "sha256:d3967c1582489c18054a2372328600b28a5c4a919b0d31ed8c74cff3127c6519"],
  [{ script: "x".repeat(200), voice: "zf_xiaobei", speed: 2, lang: "zh", pronunciations: [], audioCache: null },
    "sha256:3cdc4ae8fc3024ca7572beadca7b3411bfb2c0f017b11da37570912342c261c9"],
];

test("the cache key is the one tools/narration_key.py works out (values taken from that Python)", () => {
  for (const [n, expected] of cases) assert.equal(narrationHash(n), expected, n.script.slice(0, 20));
  assert.equal(keyOf(cases[0]![0]), "11df0056c282e4b6afe3cc64e7c095c8b17f3ccbd34a52a2cf583d3507b55f8e");
});

test("the key follows every input that changes the audio, and nothing else", () => {
  const base = cases[1]![0];
  const key = narrationHash(base);
  assert.notEqual(narrationHash({ ...base, script: `${base.script} ` }), key);
  assert.notEqual(narrationHash({ ...base, voice: "bf_alice" }), key);
  assert.notEqual(narrationHash({ ...base, speed: 0.9 }), key);
  assert.notEqual(narrationHash({ ...base, pronunciations: [] }), key);
  assert.equal(narrationHash({ ...base, audioCache: { hash: "sha256:00", path: ".cache/narration/x.wav" } }), key, "audioCache is bookkeeping");
});

test("the key matches audio the generator really made for the example project", () => {
  const slide = JSON.parse(readFileSync(path.join(repo, "examples", "minimal.osproj", "slides", "slide-001.json"), "utf-8")) as { baseLayer: { objects: { narration: Narration | null }[] } };
  const narrated = slide.baseLayer.objects.filter((o) => o.narration);
  assert.ok(narrated.length > 0);
  for (const o of narrated) {
    const wav = path.join(repo, "examples", "minimal.osproj", ".cache", "narration", `${keyOf(o.narration!)}.wav`);
    assert.ok(existsSync(wav), `the editor works out ${keyOf(o.narration!)}, which the generator should have made`);
  }
});

test("a pronunciation is accepted exactly when the validator accepts it", () => {
  const verdicts: [string, boolean][] = [
    ["ˈlɪkərt", true], ["rɛntʃ", true], ["lik", true], ["<b>", false], ["abc1", false],
    ["ɡɹeɪt", true], ["foo bar", true], ["", false], ["kæt", true], ["ðɪs", true], ["sɪŋ", true],
    ["ab​c", false], ["A", false],
  ];
  for (const [ipa, ok] of verdicts) assert.equal(isValidIpa(ipa), ok, JSON.stringify(ipa));
});

test("and for every character up to U+22FF, when Python is available", { skip: !process.env["OPENSTAGE_PYTHON"] }, () => {
  const code = "import sys; sys.path.insert(0, sys.argv[1]); import validate; print(','.join(str(c) for c in range(0x2300) if validate._IPA_OK.match(chr(c))))";
  const r = spawnSync(process.env["OPENSTAGE_PYTHON"]!, ["-c", code, path.join(repo, "tools")], { encoding: "utf-8" });
  assert.equal(r.status, 0, r.stderr);
  const python = new Set(r.stdout.trim().split(",").map(Number));
  // Python's \s also takes the separators U+001C to U+001F and U+0085; JavaScript's does not. Nobody types them.
  const skip = (c: number) => (c >= 0x1c && c <= 0x1f) || c === 0x85;
  for (let c = 0; c < 0x2300; c++) {
    if (skip(c)) continue;
    assert.equal(isValidIpa(String.fromCharCode(c)), python.has(c), `U+${c.toString(16).padStart(4, "0")}`);
  }
});

test("every voice belongs to a language group, with a plain label", () => {
  assert.equal(VOICES.length, 54);
  const groups = voiceGroups();
  assert.equal(groups.flatMap((g) => g.voices).length, 54);
  assert.ok(!groups.some((g) => g.group === "Other"), "no voice is left without a language");
  assert.deepEqual(groups.map((g) => g.group).slice(0, 2), ["American English", "British English"]);
  assert.deepEqual(voiceOption("af_heart"), { id: "af_heart", label: "Heart, woman", group: "American English" });
  assert.deepEqual(voiceOption("am_adam"), { id: "am_adam", label: "Adam, man", group: "American English" });
  assert.deepEqual(voiceOption("bf_emma"), { id: "bf_emma", label: "Emma, woman", group: "British English" });
  const american = groups[0]!.voices.map((v) => v.label);
  assert.deepEqual([...american].sort((a, b) => a.localeCompare(b)), american, "sorted by name");
});

test("a voice decides the language stored beside it", () => {
  const expected: Record<string, string> = { a: "en-US", b: "en-GB", e: "es", f: "fr-FR", h: "hi", i: "it", j: "ja", p: "pt-BR", z: "zh" };
  for (const v of VOICES) assert.equal(langForVoice(v), expected[v[0]!], v);
  assert.equal(langForVoice("unknown"), "en-US");
});

test("new narration takes its voice and speed from the narration nearest to hand", () => {
  assert.deepEqual(newNarration("Hi."), { script: "Hi.", voice: DEFAULT_VOICE, speed: 1, lang: "en-US", pronunciations: [], audioCache: null });
  const like: Narration = { ...cases[1]![0], voice: "zf_xiaobei", speed: 0.9 };
  const n = newNarration("Hi.", like);
  assert.equal(n.voice, "zf_xiaobei");
  assert.equal(n.speed, 0.9);
  assert.equal(n.lang, "zh", "the language follows the voice");
  assert.deepEqual(n.pronunciations, [], "pronunciations belong to the words, so they are not copied");
  assert.equal(newNarration("Hi.", { ...like, voice: "not-a-voice" }).voice, DEFAULT_VOICE);
});

const cache = (n: Narration, duration: number, exact = true): Map<string, CachedAudio> => new Map([[keyOf(n), { hash: keyOf(n), duration, exactTimings: exact }]]);

test("an object's audio is ready when the generator has made the file its key names", () => {
  const n = cases[0]![0];
  assert.deepEqual(audioStatus(n, cache(n, 3.2)), { state: "ready", duration: 3.2, exactTimings: true });
  assert.deepEqual(audioStatus({ ...n, script: "Hello there!" }, cache(n, 3.2)), { state: "missing", duration: null, exactTimings: null }, "a changed word needs new audio");
  assert.equal(audioStatus(n, new Map()).state, "missing");
});

test("the status line says what to do, and how the captions are timed", () => {
  assert.match(statusLine({ state: "missing", duration: null, exactTimings: null }), /No audio yet.*Narration button.*transcript/);
  assert.equal(statusLine({ state: "ready", duration: 75, exactTimings: true }), "Audio is ready, 1 minute 15 seconds. Captions are timed to the spoken words.");
  assert.match(statusLine({ state: "ready", duration: 4, exactTimings: false }), /Audio is ready, 4 seconds\. Captions are timed by estimate/);
});

test("durations are said in words", () => {
  assert.equal(formatDuration(0), "0 seconds");
  assert.equal(formatDuration(1), "1 second");
  assert.equal(formatDuration(59.6), "1 minute");
  assert.equal(formatDuration(60), "1 minute");
  assert.equal(formatDuration(61), "1 minute 1 second");
  assert.equal(formatDuration(252), "4 minutes 12 seconds");
});

test("the totals count what has audio and what still needs it", () => {
  const [a, b, c] = [cases[0]![0], cases[2]![0], cases[3]![0]];
  const items = [{ narration: a }, { narration: b }, { narration: c }];
  const made = new Map([...cache(a, 10), ...cache(c, 62.4)]);
  assert.deepEqual(totals(items, made), { objects: 3, ready: 2, missing: 1, seconds: 72.4 });
  assert.equal(totalsLine(totals(items, made)), "3 narrations. 2 have audio and 1 still needs it. The audio made so far lasts 1 minute 12 seconds.");
  assert.equal(totalsLine(totals(items, new Map())), "3 narrations. None has audio yet.");
  assert.equal(totalsLine(totals(items, new Map([...cache(a, 1), ...cache(b, 2), ...cache(c, 3)]))), "3 narrations. All have audio. The audio made so far lasts 6 seconds.");
  assert.equal(totalsLine(totals([{ narration: a }], new Map())), "1 narration. None has audio yet.");
  assert.match(totalsLine(totals([], new Map())), /^Nothing is narrated yet\./);
});

test("an excerpt is the start of a script on one line", () => {
  assert.equal(excerpt("Short."), "Short.");
  assert.equal(excerpt("  Two\n\nlines   here  "), "Two lines here");
  const long = excerpt("word ".repeat(40), 30);
  assert.ok(long.length <= 30 && long.endsWith("…"), long);
});

test("the speech engine's answer is read, and anything else is refused with a plain message", () => {
  assert.deepEqual(parseMakeResult('{"ok":true}'), { ok: true });
  assert.deepEqual(parseMakeResult('{"ok":false,"cancelled":true,"message":"Making audio was cancelled."}'), { ok: false, cancelled: true, message: "Making audio was cancelled." });
  for (const bad of ["", "nope", "[]", "null", '{"made":3}', '{"ok":1}']) assert.throws(() => parseMakeResult(bad), /could not be read/, bad);
});

test("audio sent as base64 text comes back as the same bytes", () => {
  assert.deepEqual([...base64ToBytes("")], []);
  assert.deepEqual([...base64ToBytes("AQID")], [1, 2, 3]);
  const wav = Uint8Array.from({ length: 5000 }, (_, i) => (i * 37 + 11) % 256);
  assert.deepEqual([...base64ToBytes(Buffer.from(wav).toString("base64"))], [...wav]);
  assert.equal(String.fromCharCode(...base64ToBytes("UklGRg==")), "RIFF");
});
