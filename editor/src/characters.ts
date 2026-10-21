// The cast: the people a course can show and give a voice to. This file is the arithmetic and the checks, with no screen in it, so all of it can
// be tested directly. The dialog that uses it is castdialog.ts.
//
// A person is written once, in the project, and used in many places: a scenario shows them speaking, and a choice of character lets the learner
// be one of them. Because they are used, one cannot be taken out of the cast while something still points at them.

import type { Character, InputContent, ScenarioContent, ScenarioLine, Slide } from "../../player/src/types.ts";
import { DEFAULT_VOICE, isKnownVoice, VOICES } from "./narration.ts";

export const CAST_LIMIT = 12;

/** In a scenario, a line spoken by this word is spoken by the learner's own character, so no one in the cast can have it as an id. */
export const YOU = "you";

/** A name turned into an id: lower case letters, digits and hyphens, starting with a letter, and not "you". */
export function personId(name: string, taken: readonly string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^[^a-z]+/, "") || "person";
  let id = base;
  for (let n = 2; taken.includes(id) || id === YOU; n++) id = `${base}-${n}`;
  return id;
}

/** A new person: a name to change, no picture yet, and a voice no one else in the cast has, so they can be told apart by ear. */
export function newPerson(cast: readonly Character[]): Character {
  const used = new Set(cast.map((p) => p.voice));
  const names = new Set(cast.map((p) => p.name.toLowerCase()));
  let n = cast.length + 1;
  while (names.has(`person ${n}`)) n++;
  const voice = VOICES.find((v) => v.startsWith("a") && !used.has(v)) ?? DEFAULT_VOICE;
  const name = `Person ${n}`;
  return { id: personId(name, cast.map((p) => p.id)), name, role: "", voice, picture: null };
}

/** Where each person is used, in words: the lines they speak in scenarios, and the choices of character that offer them. */
export function castUse(slides: readonly Slide[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const note = (id: string, text: string) => out.set(id, [...(out.get(id) ?? []), text]);
  for (const slide of slides) {
    for (const layer of [slide.baseLayer, ...slide.layers]) {
      for (const obj of layer.objects) {
        if (obj.type === "scenario") {
          const c = obj.content as unknown as ScenarioContent;
          const counts = new Map<string, number>();
          for (const node of c.nodes) {
            for (const line of [...node.lines, ...node.choices.flatMap((ch) => ch.response)]) {
              if (line.speaker && line.speaker !== YOU) counts.set(line.speaker, (counts.get(line.speaker) ?? 0) + 1);
            }
          }
          for (const [id, n] of counts) note(id, `${n} ${n === 1 ? "line" : "lines"} in the scenario "${obj.name}"`);
        }
        if (obj.type === "input" && (obj.content as unknown as InputContent).kind === "character") {
          for (const id of (obj.content as unknown as InputContent).characters ?? []) note(id, `the choice of character "${obj.name}"`);
        }
      }
    }
  }
  return out;
}

/** The key of one pose of one person in the map poseUse gives. */
export const poseKey = (personId: string, poseId: string): string => `${personId}/${poseId}`;

/** Where each pose of each person is used, in words: the lines of scenarios that show their speaker in it. The key is poseKey(person, pose). */
export function poseUse(slides: readonly Slide[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const slide of slides) {
    for (const layer of [slide.baseLayer, ...slide.layers]) {
      for (const obj of layer.objects) {
        if (obj.type !== "scenario") continue;
        const c = obj.content as unknown as ScenarioContent;
        const counts = new Map<string, number>();
        for (const node of c.nodes) {
          for (const line of [...node.lines, ...node.choices.flatMap((ch) => ch.response)] as ScenarioLine[]) {
            if (line.speaker && line.speaker !== YOU && line.pose) counts.set(poseKey(line.speaker, line.pose), (counts.get(poseKey(line.speaker, line.pose)) ?? 0) + 1);
          }
        }
        for (const [key, n] of counts) out.set(key, [...(out.get(key) ?? []), `${n} ${n === 1 ? "line" : "lines"} in the scenario "${obj.name}"`]);
      }
    }
  }
  return out;
}

/** What stops a cast being saved. Poor choices (two people with one name) do not: the checker warns about them, and the author decides. */
export function draftProblems(draft: readonly Character[], before: readonly Character[], uses: ReadonlyMap<string, string[]>, poseUses: ReadonlyMap<string, string[]> = new Map()): string[] {
  const out: string[] = [];
  if (draft.length > CAST_LIMIT) out.push(`A cast can have at most ${CAST_LIMIT} people.`);
  draft.forEach((p, i) => {
    const who = p.name.trim() === "" ? `Person ${i + 1}` : p.name.trim();
    if (p.name.trim() === "") out.push(`Person ${i + 1} needs a name.`);
    if (!isKnownVoice(p.voice)) out.push(`${who} has a voice that is not available here. Choose another, or set up the service or plugin it comes from in AI services.`);
    if (p.picture) {
      if (!p.picture.decorative && p.picture.alt.trim() === "") out.push(`${who}'s picture needs alt text, or tick that it is decorative.`);
      if (p.picture.decorative && p.picture.alt.trim() !== "") out.push(`${who}'s picture is decorative, so it has no alt text. Clear the alt text, or untick decorative.`);
    }
  });
  const keep = new Set(draft.map((p) => p.id));
  for (const person of before) {
    const where = uses.get(person.id);
    if (!keep.has(person.id) && where && where.length > 0) {
      out.push(`${person.name} is still used by ${where.join(" and ")}. Change those first, then take ${person.name} out of the cast.`);
    }
  }
  // A pose cannot be taken out while a line shows its speaker in it. (A person who is gone altogether is reported above.)
  for (const person of before) {
    const now = draft.find((p) => p.id === person.id);
    if (!now) continue;
    const kept = new Set((now.poses ?? []).map((x) => x.id));
    for (const pose of person.poses ?? []) {
      const where = poseUses.get(poseKey(person.id, pose.id));
      if (!kept.has(pose.id) && where && where.length > 0) out.push(`${person.name}'s pose "${pose.label}" is still used by ${where.join(" and ")}. Change those lines first, then take the pose out.`);
    }
  }
  return out;
}

/** Things worth saying, that do not stop the cast being saved. */
export function draftNotes(draft: readonly Character[]): string[] {
  const names = draft.map((p) => p.name.trim().replace(/\s+/g, " ").toLowerCase()).filter((n) => n !== "");
  const dup = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  return dup.map((n) => `More than one person is called "${draft.find((p) => p.name.trim().replace(/\s+/g, " ").toLowerCase() === n)!.name.trim()}". A learner cannot tell them apart.`);
}

/** The people whose voice changed, by id, with the voice they have now. */
export function voiceChanges(before: readonly Character[], after: readonly Character[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of after) {
    const was = before.find((q) => q.id === p.id);
    if (was && was.voice !== p.voice) out.set(p.id, p.voice);
  }
  return out;
}

export function cloneCast(cast: readonly Character[]): Character[] {
  return cast.map((p) => {
    const copy: Character = { ...p, picture: p.picture ? { ...p.picture } : null };
    if (p.poses) copy.poses = p.poses.map((x) => ({ ...x }));
    else delete copy.poses;
    if (p.library) copy.library = { ...p.library };
    else delete copy.library;
    return copy;
  });
}

/** A person as it is kept in the project: a name and role without stray spaces, and no empty list of poses. */
export function tidyPerson(p: Character): Character {
  const out: Character = { ...p, name: p.name.trim(), role: p.role.trim() };
  if (!out.poses || out.poses.length === 0) delete out.poses;
  return out;
}

/** The pose of a person by its id. */
export const poseById = (p: Character | undefined, id: string | null | undefined) => (id ? p?.poses?.find((x) => x.id === id) : undefined);
