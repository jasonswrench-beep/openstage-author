// Tests for captions from a recorded voice: reading the recogniser's output, dropping its notes and what it hears in silence, making captions from timed words,
// setting the times of captions an author has by the voice, and the hint of the course's own words. The fixtures are real output of whisper-cli (see recognition.fixtures.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LIMITS, cueWarnings, type Cue } from "./captions.ts";
import {
  MAX_LISTEN_MINUTES, PIECE_MINUTES, cuesFromWords, dropNotes, dropSilent, encodeWav, hasSound, hintFor, hintSourcesOf, joinPieces, megabytes, parseSpeechStatus, parseWhisper, placeByVoice, planPieces, soundEnd, soundMapOf, wordEnds,
  type SoundMap, type Word,
} from "./recognition.ts";
import { KEYBOARD_NOTE, MUSIC_NOTE, SILENCE_BLANK, SILENCE_YOU, SPEECH_SAMPLE } from "./recognition.fixtures.ts";

const words = (spec: [string, number][]): Word[] => spec.map(([text, startMs]) => ({ text, startMs }));
/** Words said at an even pace: `gap` milliseconds from each to the next. */
const paced = (text: string, from: number, gap = 350): Word[] => text.split(" ").map((t, i) => ({ text: t, startMs: from + i * gap }));
const samples = (parts: ("silence" | "tone" | "quiet")[], seconds = 1, rate = 16000): Int16Array => {
  const out = new Int16Array(parts.length * seconds * rate);
  parts.forEach((p, k) => {
    for (let i = 0; i < seconds * rate; i++) out[k * seconds * rate + i] = p === "silence" ? 0 : p === "tone" ? Math.round(9000 * Math.sin(i / 7)) : Math.round(30 * Math.sin(i / 3));
  });
  return out;
};

// ---- the recogniser's output

test("the words are read with their alignment times, their punctuation, and none of the recogniser's own marks", () => {
  const { words: w, problems } = parseWhisper(SPEECH_SAMPLE);
  assert.deepEqual(problems, []);
  assert.deepEqual(w.slice(0, 5).map((x) => [x.text, x.startMs]), [["Welcome", 1240], ["to", 1640], ["this", 1760], ["short", 1980], ["lesson", 2400]]);
  assert.ok(w.some((x) => x.text === "courses."), "a full stop stays with the word before it");
  assert.ok(w.every((x) => !x.text.startsWith("[_") && x.text.trim() === x.text && x.text !== ""));
  assert.ok(w.every((x, i) => i === 0 || x.startMs >= w[i - 1]!.startMs), "the times only go forward");
});

test("a word with no alignment time takes the token's own time, and the author is told how many were rough", () => {
  const doc = JSON.parse(SPEECH_SAMPLE) as { transcription: { tokens: { t_dtw: number }[] }[] };
  doc.transcription[0]!.tokens.forEach((t) => { t.t_dtw = -1; });
  const { words: w, problems } = parseWhisper(JSON.stringify(doc));
  assert.equal(w[0]!.startMs, 0);
  assert.equal(w[2]!.startMs, 1070);
  assert.match(problems[0]!, /^\d+ words have only a rough time/);
});

test("an answer that is not the recogniser's is reported in words, not thrown", () => {
  assert.deepEqual(parseWhisper("not json"), { words: [], problems: ["The recogniser's answer could not be read."] });
  assert.deepEqual(parseWhisper("{}"), { words: [], problems: ["The recogniser's answer had no text in it."] });
});

// ---- notes and silence

test("the recogniser's notes about sounds are not words: brackets, parentheses and music signs", () => {
  for (const note of [SILENCE_BLANK, KEYBOARD_NOTE, MUSIC_NOTE]) {
    const parsed = parseWhisper(note);
    assert.ok(parsed.words.length > 0);
    assert.deepEqual(dropNotes(parsed.words).words, [], parsed.words.map((x) => x.text).join(" "));
  }
  const spoken = words([["Hello", 0], ["[inaudible]", 400], ["there", 900], ["\u266a", 1300], ["(applause", 1500], ["and", 1600], ["cheering)", 1700], ["Thanks.", 2400]]);
  const r = dropNotes(spoken);
  assert.deepEqual(r.words.map((x) => x.text), ["Hello", "there", "Thanks."]);
  assert.equal(r.dropped, 3, "three notes: [inaudible], the music sign, and (applause and cheering) as one");
});

test("a bracket that is never closed is left alone, so a word of the speech is not lost", () => {
  const w = paced("the (see page for details and then some more words go here", 0);
  assert.deepEqual(dropNotes(w).words, w);
});

test("a word heard where the clip is silent is dropped, and the same word is kept where there is sound", () => {
  const you = parseWhisper(SILENCE_YOU).words;
  assert.deepEqual(you.map((x) => x.text), ["You"]);
  assert.deepEqual(dropSilent(you, soundMapOf(samples(["silence", "silence"]))), { words: [], dropped: 1 });
  assert.deepEqual(dropSilent(you, soundMapOf(samples(["tone", "silence"]))).words.map((x) => x.text), ["You"]);
});

test("the gate is a little over the quiet of the recording, so a hum is not sound and a voice is", () => {
  const m = soundMapOf(samples(["quiet", "quiet", "quiet", "tone", "quiet"]));
  assert.ok(m.gateDb > -62 && m.gateDb < -30, String(m.gateDb));
  assert.equal(hasSound(m, 500, 900), false, "the hum alone");
  assert.equal(hasSound(m, 3200, 3600), true, "the voice");
  assert.equal(soundEnd(m, 2500, 5000), 4000, "the voice stops at the end of its second");
  assert.equal(soundEnd(m, 0, 2800), null);
});

test("a word ends where the voice stops, or where the next word begins", () => {
  const map = soundMapOf(samples(["silence", "tone", "silence", "silence", "tone"]));
  const w = words([["Hello", 1000], ["there", 4000]]);
  const ends = wordEnds(w, 5000, map);
  assert.ok(Math.abs(ends[0]! - 2060) <= 40, `Hello ends as the voice stops (${ends[0]})`);
  assert.ok(ends[1]! > 4100 && ends[1]! <= 5000);
  const run = words([["one", 1000], ["two", 1500], ["three", 1900]]);
  assert.deepEqual(wordEnds(run, null, null), [1360, 1860, 2400], "with no map, the length of a word is guessed from its letters, and never runs past the next word");
  assert.deepEqual(wordEnds(words([["slowly", 1000], ["end", 1200]]), null, null)[0], 1200, "or stops at the next word when that is sooner");
});

// ---- captions from words

test("a sentence that fits is one caption, from its first word to where its last stops", () => {
  const { words: w } = parseWhisper(SPEECH_SAMPLE);
  const ends = wordEnds(w, null, null);
  const cues = cuesFromWords(w, ends, null);
  assert.equal(cues.length, 5, "the first sentence fits; the other two are each cut in two");
  assert.equal(cues[0]!.text, "Welcome to this short lesson on making\naccessible online courses.");
  assert.equal(cues[0]!.startMs, 1240);
  assert.ok(cues[0]!.endMs > 4000 && cues[0]!.endMs <= cues[1]!.startMs);
  assert.equal(cues.map((c) => c.text.replace(/\n/g, " ")).join(" "), w.map((x) => x.text).join(" "), "not a word is lost or changed");
  assert.ok(cues.every((c) => c.text.split("\n").length <= 2 && c.text.split("\n").every((l) => l.length <= 42)));
});

test("a long sentence is cut near its middle into captions that each fit, and at a comma when there is one near the middle", () => {
  const w = paced("In this video, I will show you how to build a module for Brightspace that meets the Web Content Accessibility Guidelines.", 1000);
  const cues = cuesFromWords(w, wordEnds(w, null, null), null);
  assert.equal(cues.length, 2);
  assert.ok(cues.every((c) => c.text.replace(/\n/g, " ").length >= 40), "two halves, not a scrap and a long rest");
  const comma = paced("When you finish the first part of the lesson, press the Next button to go on to the quiz at the end.", 1000);
  const commaCues = cuesFromWords(comma, wordEnds(comma, null, null), null);
  assert.equal(commaCues[0]!.text.replace(/\n/g, " ").endsWith("lesson,"), true, commaCues[0]!.text);
  assert.ok(cues.every((c) => cueWarnings(c, { ...DEFAULT_LIMITS, minMs: 0, maxCps: 99 }).length === 0), JSON.stringify(cues.map((c) => cueWarnings(c))));
  assert.equal(cues.map((c) => c.text.replace(/\n/g, " ")).join(" "), w.map((x) => x.text).join(" "), "not a word is lost or changed");
});

test("a long pause ends a caption even where the recogniser wrote no full stop", () => {
  const w = [...paced("so that is the first part", 1000), ...paced("now the second part begins here", 9000)];
  const cues = cuesFromWords(w, wordEnds(w, 12000, null), 12000);
  assert.equal(cues.length, 2);
  assert.equal(cues[1]!.startMs, 9000);
  assert.ok(cues[0]!.endMs < 5000, "the first caption does not hang on through the pause");
});

test("two short sentences with no pause between them share a caption, and one that would be gone in a blink stays on as long as there is room", () => {
  const w = [...words([["Thank", 1000], ["you.", 1300], ["Bye.", 1700]])];
  const cues = cuesFromWords(w, wordEnds(w, 6000, null), 6000);
  assert.equal(cues.length, 1);
  assert.equal(cues[0]!.text, "Thank you. Bye.");
  const lone = cuesFromWords(words([["Hi.", 1000]]), [1250], 6000);
  assert.ok(lone[0]!.endMs - lone[0]!.startMs >= DEFAULT_LIMITS.minMs);
});

test("captions never overlap, and there are none from no words", () => {
  const w = paced("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty", 0, 200);
  const cues = cuesFromWords(w, wordEnds(w, null, null), null);
  cues.forEach((c, i) => assert.ok(i === 0 || c.startMs >= cues[i - 1]!.endMs, `caption ${i + 1} starts after caption ${i} ends`));
  assert.deepEqual(cuesFromWords([], [], null), []);
});

// ---- the captions an author already has, timed by the voice

const mine = (...texts: string[]): Cue[] => texts.map((text, i) => ({ id: `c${i + 1}`, startMs: i * 1000, endMs: i * 1000 + 900, text }));

test("the captions keep their words and take the voice's times, even when the recogniser misheard a word", () => {
  const cues = mine("At Maple Ridge College we use Brightspace.", "Every video needs captions.");
  const heard = words([["At", 4000], ["mable", 4300], ["Ridge", 4700], ["collage", 4900], ["we", 5300], ["use", 5450], ["Brightspace.", 5600], ["Every", 8000], ["video", 8300], ["needs", 8700], ["captions.", 9000]]);
  const r = placeByVoice(cues, heard, wordEnds(heard, 10000, null), 10000);
  assert.ok(typeof r !== "string");
  const p = r as Exclude<typeof r, string>;
  assert.deepEqual(p.cues.map((c) => c.text), cues.map((c) => c.text));
  assert.equal(p.cues[0]!.startMs, 4000);
  assert.equal(p.cues[1]!.startMs, 8000);
  assert.ok(p.cues[0]!.endMs > 5600 && p.cues[0]!.endMs <= 8000);
  assert.ok(p.cues[1]!.endMs >= 9100);
  assert.equal(p.matched, 9, "9 of the 11 words were heard exactly; Maple and College were misheard but keep their places");
  assert.equal(p.total, 11);
});

test("a caption the voice never says takes the gap between its neighbours", () => {
  const cues = mine("First sentence here.", "Nobody says this.", "Last sentence here.");
  const heard = words([["First", 1000], ["sentence", 1400], ["here.", 1800], ["Last", 9000], ["sentence", 9400], ["here.", 9800]]);
  const r = placeByVoice(cues, heard, wordEnds(heard, 11000, null), 11000);
  assert.ok(typeof r !== "string");
  const p = r as Exclude<typeof r, string>;
  assert.ok(p.cues[1]!.startMs >= p.cues[0]!.endMs - 1 && p.cues[1]!.endMs <= p.cues[2]!.startMs);
  assert.equal(p.cues[2]!.startMs, 9000);
});

test("if the voice does not say the captions' words, nothing is changed and the author is told", () => {
  const r = placeByVoice(mine("Completely different words about something else entirely."), paced("the quick brown fox jumps over the lazy dog today", 0), [], null);
  assert.equal(typeof r, "string");
  assert.match(r as string, /does not seem to say these words/);
  assert.match(placeByVoice(mine("Some words."), [], [], null) as string, /No words were heard/);
  assert.match(placeByVoice([], paced("a b c", 0), [], null) as string, /no words to place/);
});

// ---- the hint

test("the hint is the course's names, acronyms and unusual words, most often first, and not the plain words of every heading", () => {
  const hint = hintFor({
    title: "Making Courses Accessible at Maple Ridge College",
    headings: ["Welcome", "Using SCORM packages", "Brightspace", "Introduction"],
    prose: ["Dr. Wrench built OpenStage for this. We upload to Brightspace, then check the Web Content Accessibility Guidelines.", "Brightspace reads a SCORM file."],
  });
  const terms = hint.split(", ");
  for (const t of ["Brightspace", "SCORM", "Maple", "Ridge", "OpenStage", "Wrench"]) assert.ok(terms.includes(t), `${t} is in the hint: ${hint}`);
  for (const t of ["Welcome", "Using", "Introduction", "this", "We"]) assert.ok(!terms.includes(t), `${t} is not: ${hint}`);
  assert.ok(terms.indexOf("Brightspace") < terms.indexOf("Wrench"), "the term used most comes first");
});

test("the hint is short, has no markup, and no more than it is asked for", () => {
  const many = Array.from({ length: 200 }, (_v, i) => `Term${String.fromCharCode(65 + (i % 26))}${i}x`);
  assert.ok(hintFor({ title: "", headings: many.map((t) => t.replace(/^Term/, "Zebra")), prose: [] }, 100).length <= 100);
  assert.equal(hintFor({ title: "", headings: [], prose: ["<p>plain words only here.</p>"] }), "");
  assert.ok(!hintFor({ title: "", headings: [], prose: ["<b>Brightspace</b> &amp; <i>SCORM</i>"] }).includes("<"));
});

// ---- the sound, and what the shell says

test("the sound is written as a 16 kHz mono 16-bit WAV file", () => {
  const wav = encodeWav(Int16Array.from([0, 1, -1, 32767, -32768]));
  const v = new DataView(wav.buffer);
  const tag = (at: number) => String.fromCharCode(...wav.slice(at, at + 4));
  assert.deepEqual([tag(0), tag(8), tag(12), tag(36)], ["RIFF", "WAVE", "fmt ", "data"]);
  assert.equal(wav.length, 44 + 10);
  assert.deepEqual([v.getUint32(4, true), v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint32(28, true), v.getUint16(34, true), v.getUint32(40, true)], [46, 1, 1, 16000, 32000, 16, 10]);
  assert.deepEqual([1, 2, 3, 4].map((i) => v.getInt16(44 + i * 2, true)), [1, -1, 32767, -32768]);
});

test("the shell's answer about the recogniser is read, and an answer that makes no sense says so", () => {
  const s = parseSpeechStatus(JSON.stringify({ ready: true, problem: "", folder: "C:/models", models: [{ id: "small.en", label: "Careful", note: "n", bytes: 487614201, installed: false }, { nonsense: 1 }] }));
  assert.equal(s.ready, true);
  assert.deepEqual(s.models.map((m) => m.id), ["small.en"]);
  const bad = parseSpeechStatus("garbage");
  assert.equal(bad.ready, false);
  assert.match(bad.problem, /could not be checked/);
  assert.equal(megabytes(487614201), "488 MB");
  assert.equal(megabytes(147964211), "148 MB");
  assert.equal(megabytes(1_500_000_000), "1.5 GB");
});

test("the course's words for the hint come from its title, slide names, headings, text and narration, and from nothing else", () => {
  const text = (html: string, role = "paragraph") => ({ type: "text", content: { html }, accessibility: { role }, narration: null }) as never;
  const slide = (name: string, ...objects: unknown[]) => ({ name, baseLayer: { objects }, layers: [{ objects: [{ type: "text", content: { html: "<p>Moodle and Brightspace</p>" }, accessibility: { role: "paragraph" }, narration: { script: "We use SCORM at ACME." } }] }] }) as never;
  const sources = hintSourcesOf({ meta: { title: "Accessible Courses" } }, [
    slide("Welcome to Brightspace", text("<h1>Getting Started</h1>", "heading"), text("<p>Dr. Wrench shows OpenStage.</p>")),
    { name: "Second", baseLayer: { objects: [{ type: "image", content: { src: "assets/images/a.png", alt: "Hidden Words" }, accessibility: { role: "img", altText: "Secret Picture" }, narration: null }] }, layers: [] } as never,
  ]);
  assert.equal(sources.title, "Accessible Courses");
  assert.deepEqual(sources.headings, ["Welcome to Brightspace", "<h1>Getting Started</h1>", "Second"]);
  assert.deepEqual(sources.prose, ["<p>Dr. Wrench shows OpenStage.</p>", "<p>Moodle and Brightspace</p>", "We use SCORM at ACME."]);
  const hint = hintFor(sources);
  for (const t of ["Brightspace", "SCORM", "ACME", "OpenStage", "Wrench"]) assert.ok(hint.split(", ").includes(t), `${t} in ${hint}`);
  assert.ok(!hint.includes("Secret") && !hint.includes("Hidden"), "a picture's description is not part of what is said");
});

// ---- a long clip, listened to in pieces

/** A sound map of `minutes` of loud sound, with the stretches named made quiet (each `[from, to]` in seconds). */
function mapWith(minutes: number, quiet: [number, number][] = []): SoundMap {
  const frameMs = 20;
  const db = new Float32Array(Math.round((minutes * 60_000) / frameMs)).fill(-20);
  for (const [from, to] of quiet) db.fill(-90, Math.round((from * 1000) / frameMs), Math.round((to * 1000) / frameMs));
  return { frameMs, db, gateDb: -62 };
}

test("a clip that is long is listened to in pieces, so the limit is hours and not 45 minutes", () => {
  assert.equal(MAX_LISTEN_MINUTES, 180);
  assert.equal(PIECE_MINUTES, 20);
});

test("a clip no longer than a piece is one piece, with no cut", () => {
  const pieces = planPieces(mapWith(20), 20 * 60 * 16000);
  assert.deepEqual(pieces, [{ fromSample: 0, toSample: 20 * 60 * 16000, fromMs: 0 }]);
});

test("a long clip is cut into equal pieces, each cut in the quietest moment near the even spacing", () => {
  const total = 50 * 60 * 16000;
  // Three pieces of about 16 minutes 40 seconds: the cuts want to fall at 16:40 and 33:20. Pauses are at 16:30 and 33:35 (990 and 2015 seconds).
  const pieces = planPieces(mapWith(50, [[990, 990.5], [2015, 2015.5]]), total);
  assert.equal(pieces.length, 3);
  assert.equal(pieces[0]!.fromSample, 0);
  assert.equal(pieces[2]!.toSample, total);
  for (let i = 1; i < pieces.length; i++) assert.equal(pieces[i]!.fromSample, pieces[i - 1]!.toSample, "no gap and no overlap");
  // The even spacing is 16:40 and 33:20; each cut is somewhere inside its pause, the part of it nearest the even spacing.
  assert.ok(pieces[1]!.fromMs >= 990_000 && pieces[1]!.fromMs <= 990_500, `first cut at ${pieces[1]!.fromMs} ms, in the first pause`);
  assert.ok(pieces[2]!.fromMs >= 2_015_000 && pieces[2]!.fromMs <= 2_015_500, `second cut at ${pieces[2]!.fromMs} ms, in the second pause`);
});

test("no piece is longer than the most allowed, even when every cut moves as far as it can", () => {
  for (const minutes of [20.1, 25, 40, 61, 119, 180]) {
    const total = Math.round(minutes * 60 * 16000);
    const quiet: [number, number][] = [];
    // A pause only at the far end of each cut's reach, so every cut moves the whole way.
    for (let k = 1; k < 12; k++) quiet.push([(minutes * 60 * k) / Math.ceil((minutes * 60) / (PIECE_MINUTES * 60 - 20)) + 19, (minutes * 60 * k) / Math.ceil((minutes * 60) / (PIECE_MINUTES * 60 - 20)) + 19.5]);
    const pieces = planPieces(mapWith(minutes, quiet), total);
    for (const p of pieces) assert.ok((p.toSample - p.fromSample) / 16 <= PIECE_MINUTES * 60_000 + 1, `${minutes} minutes: a piece of ${(p.toSample - p.fromSample) / 16000} s`);
    assert.equal(pieces.reduce((n, p) => n + (p.toSample - p.fromSample), 0), total, "the pieces add up to the whole clip");
  }
});

test("with no pause to be found a cut falls as near the even spacing as it can", () => {
  const total = 45 * 60 * 16000;
  const pieces = planPieces(mapWith(45), total);
  assert.equal(pieces.length, 3);
  assert.ok(Math.abs(pieces[1]!.fromMs - 900_000) <= 100, String(pieces[1]!.fromMs));
});

test("the answers for the pieces are joined with their times moved on, and the rough ones counted together", () => {
  const piece = (words: [string, number][]): string =>
    JSON.stringify({ transcription: [{ tokens: words.map(([text, dtw]) => ({ text, offsets: { from: dtw * 10, to: dtw * 10 + 200 }, t_dtw: dtw })) }] });
  const one = piece([[" Hello", 10], [" there", 60]]);
  const two = piece([[" Again", 5], [" friends", 90]]);
  const joined = joinPieces([one, two], [0, 1_000_000]);
  assert.deepEqual(joined.words, [
    { text: "Hello", startMs: 100 },
    { text: "there", startMs: 600 },
    { text: "Again", startMs: 1_000_050 },
    { text: "friends", startMs: 1_000_900 },
  ]);
  assert.deepEqual(joined.problems, []);
  // A word with no alignment time has only a rough one; the pieces' counts are added.
  const rough = (w: string): string => JSON.stringify({ transcription: [{ tokens: [{ text: ` ${w}`, offsets: { from: 500, to: 900 } }] }] });
  assert.deepEqual(joinPieces([rough("a"), rough("b")], [0, 60_000]).problems, ["2 words have only a rough time, so their captions may start a little early or late."]);
  assert.deepEqual(joinPieces([one], [0]), parseWhisper(one), "one piece is read exactly as it was before pieces");
});

test("if the answer for any piece cannot be used the whole is refused and the part is named", () => {
  const good = JSON.stringify({ transcription: [{ tokens: [{ text: " Hi", offsets: { from: 0, to: 100 }, t_dtw: 0 }] }] });
  assert.throws(() => joinPieces([good, "not json", good], [0, 1, 2]), /^Error: Part 2 of 3: The recogniser's answer could not be read\.$/);
  assert.throws(() => joinPieces(["not json"], [0]), /^Error: The recogniser's answer could not be read\.$/);
});
