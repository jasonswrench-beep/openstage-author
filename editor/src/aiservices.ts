// AI services in the editor: pictures and voices from a service the author has their own key for (OpenAI),
// and voices from plugins the author has installed. Nothing here touches the network or a page: the editor keeps the author's
// settings, works out which voices and which kinds of work are available, wording for the questions it has to ask, and the record
// kept in assets.json for something a service made. The talking to the services is done by tools/generate.py and tools/narrate.py,
// which only do it for a service the author has said yes to (see docs/ai-generation.md), so this file is tested directly.
//
// What is never done, however the author asks: a voice is never made from a recording of a person (voice cloning is out of scope,
// so only each service's ready-made voices are offered), alt text is never filled in from a prompt, and nothing is sent anywhere
// until the author has said yes to that service.

import openaiVoiceList from "../../tools/openai-voices.json" with { type: "json" };
import type { CreditEntry } from "../../player/src/types.ts";
import { engineOf, type Narration, type VoiceSource, type VoiceTraits } from "./narration.ts";

export type ServiceId = "openai";
export type Work = "voice" | "picture";

export interface ServiceInfo {
  id: ServiceId;
  name: string;
  home: string;
  keyUrl: string;
  keyName: string;
  works: Work[];
  /** What leaves the computer for each kind of work, in the words the permission question uses. */
  sends: Partial<Record<Work, string>>;
  /** What the author may change: the model a kind of work uses. The default is used when the box is empty. */
  models: Partial<Record<"speech" | "picture", { label: string; fallback: string }>>;
  blurb: string;
}

export const SERVICES: readonly ServiceInfo[] = [
  {
    id: "openai", name: "OpenAI", home: "https://openai.com/", keyUrl: "https://platform.openai.com/api-keys", keyName: "API key",
    works: ["voice", "picture"],
    sends: { voice: "the words of the narration scripts", picture: "the description of the picture you write" },
    models: { speech: { label: "Voice model", fallback: "gpt-4o-mini-tts" }, picture: { label: "Picture model", fallback: "gpt-image-1" } },
    blurb: "Spoken voices (a fixed set of ready-made ones, in many languages) and pictures. You pay OpenAI for what you use.",
  },
];

export const serviceById = (id: ServiceId): ServiceInfo => SERVICES.find((s) => s.id === id)!;
export const isServiceId = (id: string): id is ServiceId => SERVICES.some((s) => s.id === id);

/** OpenAI's ready-made voices, from tools/openai-voices.json, which the tool that makes them and the validator read too. */
export const OPENAI_VOICES: readonly { id: string; label: string }[] = openaiVoiceList.voices.map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) }));

// ---- the author's settings for all of this: kept with the program, never in a project

export interface AiSettings {
  keys: Record<ServiceId, string>;
  /** When the author said yes to a service sending it their text or descriptions, or "" if they have not. */
  allowed: Record<ServiceId, string>;
  models: Record<ServiceId, { speech: string; picture: string }>;
  /** The plugins switched on, by id. */
  plugins: Record<string, boolean>;
}

export const emptyAi = (): AiSettings => ({
  keys: { openai: "" },
  allowed: { openai: "" },
  models: { openai: { speech: "", picture: "" } },
  plugins: {},
});

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function parseAi(data: unknown): AiSettings {
  const d = record(data);
  const out = emptyAi();
  for (const s of SERVICES) {
    out.keys[s.id] = text(record(d["keys"])[s.id]).trim();
    out.allowed[s.id] = text(record(d["allowed"])[s.id]).trim();
    const models = record(record(d["models"])[s.id]);
    out.models[s.id] = { speech: text(models["speech"]).trim(), picture: text(models["picture"]).trim() };
  }
  for (const [id, on] of Object.entries(record(d["plugins"]))) if (on === true && /^[a-z][a-z0-9-]{1,30}$/.test(id)) out.plugins[id] = true;
  return out;
}

export const hasKey = (ai: AiSettings, id: ServiceId): boolean => ai.keys[id].trim() !== "";
export const isAllowed = (ai: AiSettings, id: ServiceId): boolean => ai.allowed[id] !== "";
/** A service can be used when it has a key and the author has said yes to it. */
export const usable = (ai: AiSettings, id: ServiceId): boolean => hasKey(ai, id) && isAllowed(ai, id);

/** The settings with the author's yes to a service recorded. */
export function allow(ai: AiSettings, id: ServiceId, when: string): AiSettings {
  return { ...ai, allowed: { ...ai.allowed, [id]: when } };
}

/** The settings with the author's yes to a service taken back. */
export function withdraw(ai: AiSettings, id: ServiceId): AiSettings {
  return { ...ai, allowed: { ...ai.allowed, [id]: "" } };
}

/** A different key is a different account, so the yes given to the old one does not carry over. */
export function withKey(ai: AiSettings, id: ServiceId, key: string): AiSettings {
  const next = key.trim();
  if (next === ai.keys[id]) return ai;
  return {
    ...ai,
    keys: { ...ai.keys, [id]: next },
    allowed: { ...ai.allowed, [id]: "" },
  };
}

// ---- voice plugins, as tools/generate.py lists them

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  licence: string;
  /** The plugin's own word that it uses the internet. OpenStage cannot check it. */
  network: boolean;
  description: string;
  pronunciations: boolean;
  wordTimings: boolean;
  voices: { id: string; name: string; lang: string | null; description: string }[];
  enabled: boolean;
}

export interface PluginProblem {
  folder: string;
  problem: string;
}

export interface PluginList {
  plugins: PluginInfo[];
  problems: PluginProblem[];
}

export const noPlugins = (): PluginList => ({ plugins: [], problems: [] });

export function parsePlugins(raw: string): PluginList {
  try {
    const d = record(JSON.parse(raw) as unknown);
    if (d["ok"] !== true) return noPlugins();
    const plugins = (Array.isArray(d["plugins"]) ? d["plugins"] : []).flatMap((p): PluginInfo[] => {
      const r = record(p);
      const voices = (Array.isArray(r["voices"]) ? r["voices"] : []).flatMap((v) => {
        const x = record(v);
        return text(x["id"]) !== "" ? [{ id: text(x["id"]), name: text(x["name"]) || text(x["id"]), lang: typeof x["lang"] === "string" ? x["lang"] : null, description: text(x["description"]) }] : [];
      });
      return text(r["id"]) === "" ? [] : [{
        id: text(r["id"]), name: text(r["name"]) || text(r["id"]), version: text(r["version"]), licence: text(r["licence"]), network: r["network"] === true,
        description: text(r["description"]), pronunciations: r["pronunciations"] === true, wordTimings: r["wordTimings"] === true, voices, enabled: r["enabled"] === true,
      }];
    });
    const problems = (Array.isArray(d["problems"]) ? d["problems"] : []).map((p) => ({ folder: text(record(p)["folder"]), problem: text(record(p)["problem"]) }));
    return { plugins, problems };
  } catch {
    return noPlugins();
  }
}

// ---- which voices can be chosen right now

/** Every engine whose voices can be chosen now: a service that has a key and the author's yes, and each plugin that is switched on. */
export function buildVoiceSources(ai: AiSettings, plugins: readonly PluginInfo[]): VoiceSource[] {
  const out: VoiceSource[] = [];
  if (usable(ai, "openai")) {
    out.push({ engine: "openai", name: "OpenAI", where: "internet", pronunciations: false, speed: null, voices: OPENAI_VOICES.map((v) => ({ id: `openai:${v.id}`, label: v.label, lang: null })) });
  }
  for (const p of plugins) {
    if (!p.enabled || p.voices.length === 0) continue;
    out.push({ engine: p.id, name: p.name, where: p.network ? "internet" : "computer", pronunciations: p.pronunciations, speed: null, voices: p.voices.map((v) => ({ id: v.id, label: v.name, lang: v.lang })) });
  }
  return out;
}

export interface Availability {
  state: "ready" | "needs-permission" | "blocked";
  /** For needs-permission, the service to ask about. */
  service?: ServiceId;
  /** For blocked, what to do about it. */
  reason: string;
  /** The same in a few words, for a row of a list. */
  short: string;
}

/** Whether audio can be made for a narration now, and if not, what stands in the way. */
export function availability(n: Pick<Narration, "voice">, ctx: { ai: AiSettings; kokoro: boolean; plugins: readonly PluginInfo[] }): Availability {
  const colon = n.voice.indexOf(":");
  const engine = colon < 0 ? "kokoro" : n.voice.slice(0, colon);
  if (engine === "kokoro") {
    return ctx.kokoro ? { state: "ready", reason: "", short: "" } : { state: "blocked", short: "Kokoro is not set up on this computer.", reason: "No speech engine is set up on this computer. Choose a voice from a service or a plugin in AI services, or set up Kokoro: OPEN EDITOR.bat looks for it in the Audiobook Studio folder, and OPENSTAGE_KOKORO_PYTHON can name another." };
  }
  if (isServiceId(engine)) {
    const s = serviceById(engine);
    if (!hasKey(ctx.ai, engine)) return { state: "blocked", reason: `Add your ${s.name} key in AI services to make audio with this voice.`, short: `Add your ${s.name} key in AI services.` };
    if (!isAllowed(ctx.ai, engine)) return { state: "needs-permission", service: engine, reason: `${s.name} has not been allowed to receive your narration yet.`, short: "" };
    return { state: "ready", reason: "", short: "" };
  }
  const plugin = ctx.plugins.find((p) => p.id === engine);
  if (!plugin) {
    const reason = `The plugin "${engine}" that makes this voice is not installed here.`;
    return { state: "blocked", reason, short: reason };
  }
  if (!plugin.enabled) {
    const reason = `Switch on the plugin "${plugin.name}" in AI services to make audio with this voice.`;
    return { state: "blocked", reason, short: reason };
  }
  return { state: "ready", reason: "", short: "" };
}

/** Which services would receive text if audio were made for all of these narrations, with how many narrations and characters. */
export function servicesToAsk(items: readonly Pick<Narration, "voice" | "script">[], ai: AiSettings): { service: ServiceId; narrations: number; characters: number }[] {
  const out = new Map<ServiceId, { service: ServiceId; narrations: number; characters: number }>();
  for (const n of items) {
    const colon = n.voice.indexOf(":");
    const engine = colon < 0 ? "" : n.voice.slice(0, colon);
    if (!isServiceId(engine) || isAllowed(ai, engine) || !hasKey(ai, engine)) continue;
    const entry = out.get(engine) ?? { service: engine, narrations: 0, characters: 0 };
    entry.narrations++;
    entry.characters += n.script.length;
    out.set(engine, entry);
  }
  return [...out.values()];
}

/**
 * What making audio for these narrations will do, one sentence for each engine they use: where it is made, whether anything is sent
 * over the internet, and what is in the way. The Narration dialog shows it above the list.
 */
export function audioPlan(items: readonly Pick<Narration, "voice" | "script">[], ctx: { ai: AiSettings; kokoro: boolean; plugins: readonly PluginInfo[] }): string[] {
  const by = new Map<string, { count: number; characters: number; state: Availability }>();
  for (const n of items) {
    const engine = engineOf(n.voice);
    const entry = by.get(engine) ?? { count: 0, characters: 0, state: availability(n, ctx) };
    entry.count++;
    entry.characters += n.script.length;
    by.set(engine, entry);
  }
  const many = (count: number): string => `${count} ${count === 1 ? "narration uses" : "narrations use"}`;
  const out: string[] = [];
  for (const [engine, g] of by) {
    if (engine === "kokoro") {
      out.push(g.state.state === "ready" ? `${many(g.count)} Kokoro voices. The audio is made on this computer, so nothing is sent anywhere.` : g.state.reason);
    } else if (isServiceId(engine)) {
      const name = serviceById(engine).name;
      const sent = `${many(g.count)} ${name} voices. Their words (${g.characters} characters) are sent to ${name} over the internet when you make the audio, and ${name} may charge your account.`;
      out.push(g.state.state === "blocked" ? `${many(g.count)} ${name} voices. ${g.state.reason}` : g.state.state === "needs-permission" ? `${sent} You will be asked before anything is sent.` : sent);
    } else {
      const plugin = ctx.plugins.find((p) => p.id === engine);
      out.push(g.state.state === "blocked" ? `${many(g.count)} voices of the plugin "${plugin?.name ?? engine}". ${g.state.reason}` : `${many(g.count)} voices of the plugin "${plugin?.name ?? engine}"${plugin?.network ? ", which says it uses the internet, so the words may be sent to a service" : ", which says it works on this computer only"}.`);
    }
  }
  return out;
}

// ---- the words the editor uses about it

/** The paragraph that says where a voice's audio is made, under the voice choice. */
export function voiceNote(t: VoiceTraits): string {
  if (t.engine === "kokoro") return "This voice is made on this computer by Kokoro. Nothing is sent anywhere.";
  if (!t.known) {
    return t.where === "internet"
      ? `This voice is made by ${t.engineName} over the internet, but ${t.engineName} is not set up here. Add your key and say yes to it in AI services.`
      : `This voice is not available here. If a plugin makes it, install and switch on the plugin in AI services.`;
  }
  if (t.where === "internet") {
    return `This voice is made by ${t.engineName} over the internet, with your key. The words of the script are sent to ${t.engineName} when you make the audio, and ${t.engineName} may charge your account.`;
  }
  return `This voice comes from the plugin "${t.engineName}", which its author says works on this computer only. A plugin is a program that runs as you, so use only plugins you trust.`;
}

/** What to say when a voice cannot be taught pronunciations, or cannot do every speed. Empty when there is nothing to say. */
export function voiceLimits(t: VoiceTraits): string[] {
  const out: string[] = [];
  if (t.known && !t.pronunciations) out.push(`This voice cannot be taught how to say a word. If it says one wrongly, spell the word as it sounds in the script; the captions will show your spelling.`);
  if (t.speed) out.push(`${t.engineName} keeps the speed between ${t.speed.min} and ${t.speed.max}.`);
  return out;
}

/** The note about telling listeners a voice is AI-made, for a voice from a service and a course whose credits page is off. */
export function disclosureNote(t: VoiceTraits, creditsOn: boolean): string {
  if (creditsOn || !t.known || !isServiceId(t.engine)) return "";
  return `The credits page is off, so listeners are not told this voice is made by an AI service. ${t.engineName}'s rules ask that they are. Turn the credits page on in Assets.`;
}

/** The question asked before a service is sent anything for the first time. */
export function permissionText(service: ServiceInfo, work: Work, detail: { narrations?: number; characters?: number } = {}): string[] {
  const sends = service.sends[work] ?? "what you write";
  const count = work === "voice" && detail.narrations !== undefined
    ? ` To make the audio now, that is ${detail.narrations} ${detail.narrations === 1 ? "narration" : "narrations"}, ${detail.characters ?? 0} characters.`
    : "";
  return [
    `OpenStage will send ${sends} to ${service.name} over the internet, using your ${service.name} key.${count}`,
    `Nothing else from your course is sent. ${service.name} may charge your account for it, and its own terms and privacy rules apply to what you send. OpenStage cannot see or limit what it costs, so always check your charges on ${service.name}'s own account page. That is yours to do, not this software's.`,
    `You are asked once. You can take your permission back, or remove the key, in AI services.`,
  ];
}

// ---- pictures

export const SHAPES: readonly { id: "square" | "wide" | "tall"; label: string }[] = [
  { id: "wide", label: "Wide (3 across, 2 down)" }, { id: "square", label: "Square" }, { id: "tall", label: "Tall (2 across, 3 down)" },
];
export const QUALITIES: readonly { id: "low" | "medium" | "high"; label: string }[] = [
  { id: "low", label: "Quick draft (costs the least)" }, { id: "medium", label: "Standard" }, { id: "high", label: "Best (costs the most)" },
];

/** The longest description of a picture that is sent. */
export const PROMPT_LIMIT = 4000;

/** Why a description cannot be sent, or null if it can. */
export function promptProblem(prompt: string): string | null {
  if (prompt.trim() === "") return "Describe the picture first.";
  if (prompt.length > PROMPT_LIMIT) return `That description is too long. Keep it under ${PROMPT_LIMIT} characters.`;
  return null;
}

/** "2026-10-14T10:30:00Z", the form assets.json keeps. */
export const nowStamp = (d = new Date()): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/** The record kept in assets.json for a picture a service made. It says so on the credits page, and keeps the words that made it. */
export function creditForMade(a: { path: string; title: string; kind: "image"; service: ServiceId; model: string; prompt: string; madeAt: string }): CreditEntry {
  const s = serviceById(a.service);
  return {
    path: a.path, title: a.title, kind: a.kind,
    source: {
      provider: "generated", url: s.home, creator: a.model ? `${s.name} (${a.model})` : s.name, creatorUrl: "",
      licence: "AI-generated; the service's terms of use apply", requiresCredit: true,
      generated: { service: a.service, model: a.model, prompt: a.prompt.trim(), madeAt: a.madeAt },
    },
  };
}

/** A short title for a made picture, from its description. */
export function titleFromPrompt(prompt: string): string {
  const words = prompt.trim().replace(/\s+/g, " ");
  return words.length <= 60 ? words : `${words.slice(0, 57).trimEnd()}...`;
}

/** What tools/generate.py answers for a picture that was made and saved. */
export type MadeAnswer = { ok: true; path: string; service: string; model: string } | { ok: false; message: string; cancelled?: boolean };

export function parseMade(raw: string): MadeAnswer {
  try {
    const d = record(JSON.parse(raw) as unknown);
    if (d["ok"] === true && text(d["path"]) !== "") return { ok: true, path: text(d["path"]), service: text(d["service"]), model: text(d["model"]) };
    return { ok: false, message: text(d["message"]) || "It did not work, and the service did not say why.", ...(d["cancelled"] === true ? { cancelled: true } : {}) };
  } catch {
    return { ok: false, message: "The answer was not understood." };
  }
}

export type ServiceAnswer = { ok: true } | { ok: false; message: string };

export function parseServiceAnswer(raw: string): ServiceAnswer {
  try {
    const d = record(JSON.parse(raw) as unknown);
    if (d["ok"] !== true) return { ok: false, message: text(d["message"]) || "It did not work, and the service did not say why." };
    return { ok: true };
  } catch {
    return { ok: false, message: "The answer was not understood." };
  }
}
