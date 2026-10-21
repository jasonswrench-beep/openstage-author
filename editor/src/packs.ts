// Packs in the editor: what the shell says about the packs on this computer, and what choosing a person (or a background) from one means. A pack is a folder of
// pictures of people, of backgrounds, or of both, with a pack.json (docs/character-packs.md); tools/charpack.py decides what a good pack is, and the shell passes its answer on as JSON. Nothing
// here needs a window, so all of it is tested alone (packs.test.ts). The dialog that uses it is packdialog.ts.

import type { Character, CreditEntry } from "../../player/src/types.ts";

export type PackSource = "bundled" | "yours";
export type VoiceHint = "female" | "male" | "any";

export interface PackPose {
  id: string;
  label: string;
  alt: string;
  file: string;
}

export interface PackPerson {
  id: string;
  name: string;
  role: string;
  voice: VoiceHint;
  /** What the person looks like, in words: the alt text that comes with their picture. */
  alt: string;
  /** The square head-and-shoulders picture, a place inside the pack. */
  head: string;
  poses: PackPose[];
}

/** A picture to put behind a slide, with the words that describe it. */
export interface PackBackground {
  id: string;
  name: string;
  /** The heading it is listed under, or "". */
  group: string;
  /** What the picture shows, in words, for someone who cannot see it. */
  alt: string;
  file: string;
}

export interface PackCredit {
  creator: string;
  creatorUrl: string;
  licence: string;
  url: string;
}

export interface Pack {
  id: string;
  title: string;
  version: string;
  description: string;
  credit: PackCredit;
  people: PackPerson[];
  backgrounds: PackBackground[];
  source: PackSource;
  /** The pack's folder, to ask the shell for its pictures by. */
  folder: string;
  bytes: number;
}

/** A folder that looks like a pack but cannot be used, with why in words. */
export interface BrokenPack {
  folder: string;
  source: PackSource;
  message: string;
}

export interface PackList {
  packs: Pack[];
  broken: BrokenPack[];
}

export const NO_PACKS: PackList = { packs: [], broken: [] };

/** What the shell says after installing or removing a pack. */
export interface PackAnswer {
  ok: boolean;
  message: string;
}

const text = (v: unknown, otherwise = ""): string => (typeof v === "string" ? v : otherwise);
const source = (v: unknown): PackSource => (v === "yours" ? "yours" : "bundled");
const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

function parsePerson(raw: unknown): PackPerson | null {
  const p = record(raw);
  const id = text(p["id"]);
  const head = text(p["head"]);
  if (!id || !head) return null;
  const voice = p["voice"] === "female" || p["voice"] === "male" ? p["voice"] : "any";
  const poses = (Array.isArray(p["poses"]) ? p["poses"] : []).flatMap((x): PackPose[] => {
    const q = record(x);
    return text(q["id"]) && text(q["file"]) ? [{ id: text(q["id"]), label: text(q["label"], text(q["id"])), alt: text(q["alt"]), file: text(q["file"]) }] : [];
  });
  return { id, name: text(p["name"], id), role: text(p["role"]), voice, alt: text(p["alt"]), head, poses };
}

function parseBackground(raw: unknown): PackBackground | null {
  const b = record(raw);
  const id = text(b["id"]);
  const file = text(b["file"]);
  if (!id || !file) return null;
  return { id, name: text(b["name"], id), group: text(b["group"]), alt: text(b["alt"]), file };
}

/** The shell's JSON as a list of packs. A pack that makes no sense is left out; anything that cannot be read at all is no packs. */
export function parsePackList(raw: string): PackList {
  try {
    const d = record(JSON.parse(raw));
    const packs = (Array.isArray(d["packs"]) ? d["packs"] : []).flatMap((x): Pack[] => {
      const p = record(x);
      const credit = record(p["credit"]);
      const people = (Array.isArray(p["people"]) ? p["people"] : []).map(parsePerson).filter((q): q is PackPerson => q !== null);
      const backgrounds = (Array.isArray(p["backgrounds"]) ? p["backgrounds"] : []).map(parseBackground).filter((q): q is PackBackground => q !== null);
      if (!text(p["id"]) || !text(p["folder"]) || people.length + backgrounds.length === 0) return [];
      return [{
        id: text(p["id"]), title: text(p["title"], text(p["id"])), version: text(p["version"]), description: text(p["description"]),
        credit: { creator: text(credit["creator"]), creatorUrl: text(credit["creatorUrl"]), licence: text(credit["licence"]), url: text(credit["url"]) },
        people, backgrounds, source: source(p["source"]), folder: text(p["folder"]), bytes: typeof p["bytes"] === "number" ? p["bytes"] : 0,
      }];
    });
    const broken = (Array.isArray(d["broken"]) ? d["broken"] : []).flatMap((x): BrokenPack[] => {
      const b = record(x);
      return text(b["folder"]) ? [{ folder: text(b["folder"]), source: source(b["source"]), message: text(b["message"], "It cannot be used.") }] : [];
    });
    return { packs, broken };
  } catch {
    return NO_PACKS;
  }
}

/** The shell's JSON after installing or removing a pack. */
export function parsePackAnswer(raw: string): PackAnswer {
  try {
    const d = record(JSON.parse(raw));
    return { ok: d["ok"] === true, message: text(d["message"], d["ok"] === true ? "Done." : "That did not work.") };
  } catch {
    return { ok: false, message: "The answer could not be read." };
  }
}

/** The packs that have people in them: the ones the library of people shows. */
export const packsWithPeople = (packs: readonly Pack[]): Pack[] => packs.filter((p) => p.people.length > 0);

/** The packs that have backgrounds in them: the ones the background picker shows. */
export const packsWithBackgrounds = (packs: readonly Pack[]): Pack[] => packs.filter((p) => p.backgrounds.length > 0);

/** Where a pack came from, in words. */
export function whereFrom(pack: Pack): string {
  return pack.source === "bundled" ? "Came with OpenStage Author" : "Added by you";
}

/** One line on who made a pack and under what licence, for the dialog. */
export function creditLine(pack: Pack): string {
  const c = pack.credit;
  const licence = c.licence.replace(/\.+$/, "");
  return `By ${c.creator}.${licence ? ` ${licence}.` : ""}`;
}

/** The record for assets.json of a picture copied out of a pack, so the credits page names who made it and says under what terms it may be used. */
export function creditForPicture(pack: Pack, person: PackPerson, path: string): CreditEntry {
  const c = pack.credit;
  return {
    path,
    title: `${person.name} (character picture)`,
    kind: "image",
    source: { provider: "other", url: c.url, creator: c.creator, creatorUrl: c.creatorUrl, licence: c.licence.replace(/\.+$/, ""), requiresCredit: true },
  };
}

/** The record for assets.json of a background copied out of a pack. */
export function creditForBackground(pack: Pack, background: PackBackground, path: string): CreditEntry {
  const c = pack.credit;
  return {
    path,
    title: `${background.name} (background picture)`,
    kind: "image",
    source: { provider: "other", url: c.url, creator: c.creator, creatorUrl: c.creatorUrl, licence: c.licence.replace(/\.+$/, ""), requiresCredit: true },
  };
}

/** A person nobody has named yet, as the cast dialog starts one ("Person 3"): choosing someone from a pack replaces it with their name. */
export function isPlaceholderName(name: string): boolean {
  return /^Person \d+$/.test(name.trim());
}

const kokoroGender = (voice: string): string | undefined => /^[a-z]([fm])_/.exec(voice)?.[1];

/**
 * The voice for a person who came from a pack. A pack only says "female" or "male"; if the voice they already have is of that kind it stays, and if not they get the first
 * American voice of that kind that no one else in the cast has (or any such voice, or what they have if there is none). "any" leaves the voice alone.
 */
export function voiceFor(hint: VoiceHint, cast: readonly Character[], current: string, voices: readonly string[]): string {
  if (hint === "any") return current;
  const want = hint === "female" ? "f" : "m";
  if (kokoroGender(current) === want) return current;
  const used = new Set(cast.map((p) => p.voice));
  const fits = (v: string) => kokoroGender(v) === want && !used.has(v);
  return voices.find((v) => v.startsWith("a") && fits(v)) ?? voices.find(fits) ?? current;
}

/** What to say about how many poses are chosen, and how many the person already has in the course. */
export function chosenCount(n: number, have: number): string {
  const already = have > 0 ? ` ${have} ${have === 1 ? "is" : "are"} in the course already.` : "";
  return n === 0 ? `No new poses chosen.${already}` : `${n} new ${n === 1 ? "pose" : "poses"} chosen.${already}`;
}

/** What to tell a screen reader after someone is chosen from a pack. */
export function chosenMessage(name: string, changed: { name: boolean; voice: boolean }): string {
  const also = [changed.name ? "their name" : "", changed.voice ? "a voice" : ""].filter(Boolean).join(" and ");
  return `${name} chosen from the library: their picture${also ? `, ${also}` : ""} and a description for the alt text were added to the draft. The alt text comes from the library: read it, and change it if it is not right.`;
}
