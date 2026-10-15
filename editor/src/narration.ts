// Narration in the editor: the cache key, the voices, and what to say about an object's audio. The editor never
// makes audio itself. It writes the script and the voice settings into the project, works out the name of the
// audio file that those settings would produce (the cache key, defined in docs/format-spec.md), and asks the
// speech generator for any audio that does not exist yet. Nothing here touches a page or the file system, so
// it is all tested directly.

import voiceList from "../../tools/kokoro-voices.json" with { type: "json" };
import { matchOptions, splitBlanks, stableShuffle } from "../../player/src/grading.ts";
import type { QuizContent } from "../../player/src/types.ts";
import { DOWNLOAD_HELP, fileTypeLabel } from "../../player/src/downloads.ts";

// ---- SHA-256, written out so the key can be worked out on the page without any browser feature

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** The SHA-256 of some bytes, as lowercase hex. */
export function sha256Hex(bytes: Uint8Array): string {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const length = bytes.length;
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((length * 8) / 0x100000000));
  view.setUint32(padded.length - 4, (length * 8) >>> 0);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0; h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0; h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0;
  }
  return [...h].map((x) => x.toString(16).padStart(8, "0")).join("");
}

// ---- the narration of one object

export interface Pronunciation {
  term: string;
  ipa: string;
}

/** The `narration` of an object, exactly as the format stores it. */
export interface Narration {
  script: string;
  voice: string;
  speed: number;
  lang: string;
  pronunciations: Pronunciation[];
  /** Always null when the editor writes it: the cache is found by working out the key, not by remembering it. */
  audioCache: null | { hash: string; path: string };
}

/**
 * The cache key: `sha256:` and the hex SHA-256 of the script, voice, speed (three decimals), language and one line
 * per pronunciation, joined by single newlines. The same text that `narration_hash` in tools/narration_key.py makes.
 */
export function narrationHash(n: Narration): string {
  const parts = [n.script, n.voice, n.speed.toFixed(3), n.lang, ...n.pronunciations.map((p) => `${p.term}\t${p.ipa}`)];
  return `sha256:${sha256Hex(new TextEncoder().encode(parts.join("\n")))}`;
}

/** The part of the key after `sha256:`, which names the audio file. */
export const keyOf = (n: Narration): string => narrationHash(n).slice("sha256:".length);

// ---- voices
//
// A voice is named by one string. A bare name such as af_heart is a voice of Kokoro, the speech model that runs on this
// computer (every project made before other engines existed names its voices that way). Another engine's voices begin with
// the engine's name and a colon: openai:alloy, or <plugin id>:<voice> for a plugin. Which of those can
// be chosen right now depends on what the author has set up (a service key and permission, a plugin switched on), so the
// editor tells this module with setVoiceSources and everything that lists voices follows.

export const VOICES: readonly string[] = voiceList.voices;

const KOKORO = "kokoro";

/** What the engines the editor ships with are called, whether or not they can be used right now. */
export const ENGINE_NAMES: Record<string, string> = { kokoro: "Kokoro", openai: "OpenAI" };
const INTERNET_ENGINES = new Set(["openai"]);

/** A voice of an engine other than Kokoro. `lang` is the language it speaks, or null for a voice that speaks many. */
export interface ExtraVoice {
  id: string;
  label: string;
  lang: string | null;
}

/** The voices one engine offers right now: a service the author has a key for and has allowed, or a plugin that is switched on. */
export interface VoiceSource {
  engine: string;
  name: string;
  where: "computer" | "internet";
  /** Whether the engine can be taught how to say a word. Only Kokoro can be. */
  pronunciations: boolean;
  /** The speeds the engine can do, if narrower than the format's own range. */
  speed: { min: number; max: number } | null;
  voices: ExtraVoice[];
}

let voiceSourceList: readonly VoiceSource[] = [];

export function setVoiceSources(next: readonly VoiceSource[]): void {
  voiceSourceList = next;
}

export const voiceSources = (): readonly VoiceSource[] => voiceSourceList;

/** The engine a voice belongs to: what is before the colon, or Kokoro for a bare name. */
export function engineOf(voice: string): string {
  const colon = voice.indexOf(":");
  return colon < 0 ? KOKORO : voice.slice(0, colon);
}

function extraVoice(voice: string): { source: VoiceSource; voice: ExtraVoice } | undefined {
  for (const source of voiceSourceList) {
    const found = source.voices.find((v) => v.id === voice);
    if (found) return { source, voice: found };
  }
  return undefined;
}

/** Whether a voice can be chosen now. */
export function isKnownVoice(voice: string): boolean {
  return VOICES.includes(voice) || extraVoice(voice) !== undefined;
}

export interface VoiceTraits {
  engine: string;
  engineName: string;
  /** Where the audio is made. Unknown for an engine that is not set up here. */
  where: "computer" | "internet" | "unknown";
  pronunciations: boolean;
  /** The voice speaks many languages, so the author says which one the script is in. */
  multilingual: boolean;
  speed: { min: number; max: number } | null;
  /** Whether the voice can be chosen now. */
  known: boolean;
}

export function voiceTraits(voice: string): VoiceTraits {
  const engine = engineOf(voice);
  if (engine === KOKORO) return { engine, engineName: "Kokoro", where: "computer", pronunciations: true, multilingual: false, speed: null, known: VOICES.includes(voice) };
  const found = extraVoice(voice);
  if (found) {
    return { engine, engineName: found.source.name, where: found.source.where, pronunciations: found.source.pronunciations, multilingual: found.voice.lang === null, speed: found.source.speed, known: true };
  }
  const where = INTERNET_ENGINES.has(engine) ? "internet" : "unknown";
  return { engine, engineName: ENGINE_NAMES[engine] ?? engine, where, pronunciations: false, multilingual: false, speed: null, known: false };
}

const LANGUAGES: Record<string, { name: string; lang: string }> = {
  a: { name: "American English", lang: "en-US" },
  b: { name: "British English", lang: "en-GB" },
  e: { name: "Spanish", lang: "es" },
  f: { name: "French", lang: "fr-FR" },
  h: { name: "Hindi", lang: "hi" },
  i: { name: "Italian", lang: "it" },
  j: { name: "Japanese", lang: "ja" },
  p: { name: "Brazilian Portuguese", lang: "pt-BR" },
  z: { name: "Mandarin Chinese", lang: "zh" },
};

/**
 * The language code a voice speaks, which the format stores beside the voice. A Kokoro voice id starts with a language letter. A voice
 * that speaks many languages has no answer of its own, so `fallback` (the course's language) is used until the author says otherwise.
 */
export function langForVoice(voice: string, fallback = "en-US"): string {
  if (engineOf(voice) === KOKORO) return LANGUAGES[voice[0] ?? ""]?.lang ?? "en-US";
  return extraVoice(voice)?.voice.lang ?? fallback;
}

/** The language for a narration whose voice has just been changed: one the author set is kept when both voices speak many languages. */
export function langAfterVoiceChange(prev: { voice: string; lang: string }, voice: string, fallback = "en-US"): string {
  if (!voiceTraits(voice).multilingual) return langForVoice(voice, fallback);
  return voiceTraits(prev.voice).multilingual ? prev.lang : fallback;
}

/** Languages a script is likely to be in, for a voice that speaks many. A language not listed here that a narration already has is added to the list. */
export const COMMON_LANGUAGES: readonly { lang: string; name: string }[] = [
  { lang: "en-US", name: "English (United States)" }, { lang: "en-GB", name: "English (United Kingdom)" }, { lang: "es", name: "Spanish" },
  { lang: "fr-FR", name: "French" }, { lang: "de", name: "German" }, { lang: "it", name: "Italian" }, { lang: "pt-BR", name: "Portuguese (Brazil)" },
  { lang: "nl", name: "Dutch" }, { lang: "ja", name: "Japanese" }, { lang: "ko", name: "Korean" }, { lang: "zh", name: "Chinese" },
  { lang: "hi", name: "Hindi" }, { lang: "ar", name: "Arabic" }, { lang: "ru", name: "Russian" },
];

export function languageOptions(current: string): { lang: string; name: string }[] {
  const list = [...COMMON_LANGUAGES];
  return list.some((l) => l.lang === current) ? list : [{ lang: current, name: current }, ...list];
}

export interface VoiceOption {
  id: string;
  /** What the author sees: "Heart, woman". */
  label: string;
  /** The group it belongs to: "American English". */
  group: string;
}

const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The name of the group of voices an engine's voices are listed under. */
export function sourceGroup(source: Pick<VoiceSource, "name" | "where">): string {
  return `${source.name}, ${source.where === "internet" ? "over the internet" : "on this computer"}`;
}

/** af_heart is "Heart, woman" in American English; the second letter says woman (f) or man (m). */
export function voiceOption(id: string): VoiceOption {
  const found = extraVoice(id);
  if (found) return { id, label: found.voice.label, group: sourceGroup(found.source) };
  const name = titleCase(id.slice(id.indexOf("_") + 1));
  const person = id[1] === "m" ? "man" : id[1] === "f" ? "woman" : "voice";
  return { id, label: `${name}, ${person}`, group: LANGUAGES[id[0] ?? ""]?.name ?? "Other" };
}

/** Every voice that can be chosen, grouped: Kokoro's by language in the order the languages are listed, then each other engine's, each group sorted by name. */
export function voiceGroups(): { group: string; voices: VoiceOption[] }[] {
  const order = Object.values(LANGUAGES).map((l) => l.name);
  const groups = new Map<string, VoiceOption[]>(order.map((name) => [name, []]));
  for (const id of VOICES) {
    const v = voiceOption(id);
    (groups.get(v.group) ?? groups.set(v.group, []).get(v.group)!).push(v);
  }
  const kokoro = [...groups].filter(([, voices]) => voices.length > 0).map(([group, voices]) => ({ group, voices: voices.sort((a, b) => a.label.localeCompare(b.label)) }));
  const others = voiceSourceList.filter((s) => s.voices.length > 0).map((s) => ({
    group: sourceGroup(s),
    voices: s.voices.map((v) => ({ id: v.id, label: v.label, group: sourceGroup(s) })).sort((a, b) => a.label.localeCompare(b.label)),
  }));
  return [...kokoro, ...others];
}

export const DEFAULT_VOICE = "af_heart";
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2;

/**
 * New narration, with the voice and speed of the narration nearest to hand, so a course keeps one voice. `fallbackLang` is the course's language, for a voice
 * that speaks many; a narration like this one keeps the language it already has.
 */
export function newNarration(script: string, like?: Narration, fallbackLang = "en-US"): Narration {
  const voice = like && isKnownVoice(like.voice) ? like.voice : DEFAULT_VOICE;
  const lang = like && voice === like.voice && voiceTraits(voice).multilingual ? like.lang : langForVoice(voice, fallbackLang);
  return { script, voice, speed: like?.speed ?? 1, lang, pronunciations: [], audioCache: null };
}

// ---- what an interaction item says

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** An item's HTML as plain words a voice can read: one sentence-ending stop per paragraph or list entry, no tags. */
export function htmlToSpeech(html: string): string {
  const lines = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
      if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "");
  return lines.map(endSentence).join(" ");
}

/** Text that ends with a stop, so the voice pauses and the captions break there. */
function endSentence(text: string): string {
  return /[.!?\u2026][\u201d"')\]]*$/.test(text) ? text : `${text}.`;
}

/** What an item says if the author lets the course read it as written: its title, then its text. */
export function itemScript(item: { title: string; body: string }): string {
  const title = item.title.trim();
  const body = htmlToSpeech(item.body);
  return [title === "" ? "" : endSentence(title), body].filter((part) => part !== "").join(" ");
}

/**
 * What a file to download says if the author lets the course read it as written: its name, what it is, what kind of file
 * it is, and how to save it. The words are then the author's to change.
 */
export function downloadScript(c: { title: string; description: string; src: string }): string {
  const described = c.description.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter((line) => line !== "").map(endSentence);
  const title = c.title.trim();
  return [...(title === "" ? [] : [endSentence(title)]), ...described, `Type of file: ${fileTypeLabel(c.src)}.`, DOWNLOAD_HELP].join(" ");
}

/** The words a question says, so the course can read them aloud. A learner who cannot see the screen hears the same words as one who can. */
export function questionScript(q: QuizContent, seed: string): string {
  const stop = (s: string): string => endSentence(s.replace(/\s+/g, " ").trim());
  const each = (items: string[]): string => items.map(stop).join(" ");
  switch (q.questionType) {
    case "multipleChoice": return `Choose one answer. Your choices are: ${each(q.choices.map((c) => c.label))}`;
    case "multipleResponse": return `Choose every answer that is right. Your choices are: ${each(q.choices.map((c) => c.label))}`;
    case "shortAnswer": return "Type your answer.";
    case "numeric": return "Type a number.";
    case "fillBlanks": {
      const numbered = new Map(q.blanks.map((b, i) => [b.id, i + 1]));
      const sentence = splitBlanks(q.text).map((p) => (p.type === "text" ? p.value : `blank ${numbered.get(p.id) ?? p.id}`)).join("");
      const words = q.mode === "typed" ? "Type the missing words." : `Choose a word for each blank. The words are: ${each(stableShuffle(q.wordBank, seed))}`;
      return `${stop(sentence)} ${words}`;
    }
    case "matching": return `Match each item with its match. The items are: ${each(q.pairs.map((p) => p.premise))} The matches are: ${each(stableShuffle(matchOptions(q), seed).map((o) => o.text))}`;
    case "sequencing": return `Put these in the right order. They are: ${each(stableShuffle(q.items.map((i) => i.id), seed).map((id) => q.items.find((i) => i.id === id)!.text))}`;
    case "hotspot": return `Choose an area of the picture. ${q.image.alt.trim() === "" ? "" : `${stop(q.image.alt)} `}The areas are: ${each(q.regions.map((r) => r.label))}`;
  }
}

// ---- pronunciations

/**
 * The characters the validator accepts in a pronunciation (_IPA_OK in tools/validate.py): letters, IPA symbols, stress
 * and length marks, spaces. Written with escapes, because several of them are combining marks that do not show.
 */
const IPA_OK = /^[\sa-zɐ-ʯʰ-˿̀-ͯᴀ-ᶿβθχæðøŋœ‖‿͡.|()↗↘↑↓]+$/;

export const isValidIpa = (ipa: string): boolean => IPA_OK.test(ipa);

// ---- bytes

/** Bytes from base64 text, which is how audio comes over from the program. */
export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---- making audio

/** What the speech generator answered when asked to make audio. */
export interface MakeResult {
  ok: boolean;
  /** The author stopped it. */
  cancelled?: boolean;
  /** Why it did not work, when it did not. */
  message?: string;
}

export function parseMakeResult(text: string): MakeResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("The speech engine gave an answer that could not be read.");
  }
  if (typeof data !== "object" || data === null || typeof (data as { ok?: unknown }).ok !== "boolean") throw new Error("The speech engine gave an answer that could not be read.");
  return data as MakeResult;
}

// ---- audio status

/** What the generator has made, by cache key. */
export interface CachedAudio {
  hash: string;
  duration: number;
  /** True when the captions are timed to the spoken words, false when they were estimated from sentence length. */
  exactTimings: boolean;
  /** The size of the audio file in bytes, when the shell says. */
  size?: number;
}

/**
 * The audio in the cache that no narration in the course names any more. It is left behind when a script, voice, speed or language changes,
 * because the old audio is named by the old words, and is found again if the change is undone. Clearing it saves space.
 */
export function unusedAudio(narrations: readonly Narration[], cache: ReadonlyMap<string, CachedAudio>): CachedAudio[] {
  const used = new Set(narrations.map(keyOf));
  return [...cache.values()].filter((a) => !used.has(a.hash));
}

/** 1536 is "1.5 KB"; 3,400,000 is "3.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type AudioState = "ready" | "missing";

export interface AudioStatus {
  state: AudioState;
  duration: number | null;
  exactTimings: boolean | null;
}

export function audioStatus(n: Narration, cache: ReadonlyMap<string, CachedAudio>): AudioStatus {
  const hit = cache.get(keyOf(n));
  return hit ? { state: "ready", duration: hit.duration, exactTimings: hit.exactTimings } : { state: "missing", duration: null, exactTimings: null };
}

/** 4.0 is "4 seconds"; 75 is "1 minute 15 seconds". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const sec = `${s} ${s === 1 ? "second" : "seconds"}`;
  return m === 0 ? sec : `${m} ${m === 1 ? "minute" : "minutes"}${s === 0 ? "" : ` ${sec}`}`;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** One line about an object's audio, for the Properties panel. */
export function statusLine(s: AudioStatus): string {
  if (s.state === "missing") return "No audio yet for this script. Make it from the Narration button in the toolbar. Until then the course shows the script as a transcript.";
  const timing = s.exactTimings ? "Captions are timed to the spoken words." : "Captions are timed by estimate, because the exact word times could not be matched to the script.";
  return `Audio is ready, ${formatDuration(s.duration ?? 0)}. ${timing}`;
}

export interface NarrationTotals {
  objects: number;
  ready: number;
  missing: number;
  seconds: number;
}

export function totals(items: { narration: Narration }[], cache: ReadonlyMap<string, CachedAudio>): NarrationTotals {
  const t: NarrationTotals = { objects: items.length, ready: 0, missing: 0, seconds: 0 };
  for (const item of items) {
    const s = audioStatus(item.narration, cache);
    if (s.state === "ready") { t.ready++; t.seconds += s.duration ?? 0; } else t.missing++;
  }
  return t;
}

/** The sentence at the top of the Narration dialog. */
export function totalsLine(t: NarrationTotals): string {
  if (t.objects === 0) return "Nothing is narrated yet. Select an object and write its script in the Properties panel.";
  const have = t.ready === 0 ? "None has audio yet" : t.missing === 0 ? "All have audio" : `${t.ready} ${t.ready === 1 ? "has" : "have"} audio and ${t.missing} still ${t.missing === 1 ? "needs" : "need"} it`;
  return `${plural(t.objects, "narration", "narrations")}. ${have}.${t.ready > 0 ? ` The audio made so far lasts ${formatDuration(t.seconds)}.` : ""}`;
}

/** The first words of a script, for a list. */
export function excerpt(script: string, max = 90): string {
  const one = script.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`;
}
