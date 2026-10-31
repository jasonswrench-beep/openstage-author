// The credits page: how one credit reads, and the credits the publisher adds for narration. Pure, so it is tested directly; the player
// turns the parts into text and links.

import type { CreditEntry } from "./types.ts";
import { t } from "./playertext.ts";

export type CreditPart = { text: string } | { text: string; href: string };

const SITE_NAMES: Record<string, string> = {
  pixabay: "Pixabay", unsplash: "Unsplash", pexels: "Pexels", openverse: "Openverse", wikimedia: "Wikimedia Commons", freesound: "Freesound",
  mixkit: "Mixkit", svgrepo: "SVG Repo", libreshot: "Libreshot", vecteezy: "Vecteezy",
};

/** A link only if the address is a web address. Anything else, such as a javascript: address in a project that was handed over, is just words. */
const link = (text: string, href: string): CreditPart => (/^https?:\/\//i.test(href) ? { text, href } : { text });

/** A phrase such as "{title}, by {creator}" as parts: the words between the places are plain text, and each place is the part it is given. */
function fromTemplate(template: string, places: Record<string, CreditPart>): CreditPart[] {
  return template.split(/(\{[A-Za-z0-9_]+\})/).flatMap((piece): CreditPart[] => {
    const name = /^\{([A-Za-z0-9_]+)\}$/.exec(piece)?.[1];
    if (name !== undefined) return Object.hasOwn(places, name) ? [places[name]!] : [{ text: piece }];
    return piece === "" ? [] : [{ text: piece }];
  });
}

/**
 * One credit as the parts of a sentence. A file from a library reads "Title, by Creator, from Library. Licence." A picture or sound an AI
 * service made reads "Title, made with Service (model). Licence." The words that made it are kept in the project, not shown to learners.
 */
export function creditParts(c: CreditEntry): CreditPart[] {
  const s = c.source;
  const title: CreditPart = { text: c.title || c.path.split("/").pop() || c.path };
  const site = SITE_NAMES[s.provider];
  const parts: CreditPart[] =
    s.provider === "generated" ? fromTemplate(t("credits.made"), { title, service: link(s.creator || t("credits.anAiService"), s.url) })
    : s.creator && site ? fromTemplate(t("credits.byFrom"), { title, creator: link(s.creator, s.creatorUrl), site: link(site, s.url) })
    : s.creator ? fromTemplate(t("credits.by"), { title, creator: link(s.creator, s.creatorUrl) })
    : site ? fromTemplate(t("credits.from"), { title, site: link(site, s.url) })
    : [title];
  if (s.licence) parts.push(...fromTemplate(t("credits.licence"), { licence: { text: s.licence } }));
  return parts;
}

/**
 * The recorded credits for the files a course uses. `usedText` is everything in the course that can name a file (its slides, and the cast, whose pictures are not on a slide),
 * written out as text: a file is used if its path is in it. An entry that names no creator and no library tells a learner nothing, so it is left out.
 */
export function creditsInUse(recorded: readonly CreditEntry[], usedText: string): CreditEntry[] {
  return recorded.filter((e) => usedText.includes(e.path) && (e.source.creator || e.source.provider !== "other"));
}

/** Entries that would read the same on the credits page are one line: a person with many pictures is credited once. The first of each is kept. */
export function mergeCredits(list: readonly CreditEntry[]): CreditEntry[] {
  const seen = new Set<string>();
  return list.filter((e) => {
    const key = JSON.stringify(creditParts(e));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A narration voice the course uses, as narrate.py reports it. `where` is "computer", "internet" or "unknown". */
export interface NarrationVoiceUse {
  engine: string;
  name: string;
  where: string;
  home?: string;
}

/**
 * The credits for a course's narration: one for each engine whose voices speak in it. Narration is made by a synthetic voice, and a listener
 * has the right to know that (OpenAI's rules ask for it, and it is plain honesty for the rest), so the credits page says so.
 */
export function narrationCredits(uses: readonly NarrationVoiceUse[]): CreditEntry[] {
  const engines = new Map<string, NarrationVoiceUse>();
  for (const u of uses) if (!engines.has(u.engine)) engines.set(u.engine, u);
  return [...engines.values()].map((u) => ({
    path: `narration/${u.engine}`,
    title: t("credits.narration"),
    kind: "audio" as const,
    source: {
      provider: "generated" as const, url: u.home ?? "", creator: u.name, creatorUrl: "", requiresCredit: true,
      licence: ({ computer: t("credits.voicesComputer"), internet: t("credits.voicesInternet") } as Record<string, string>)[u.where] ?? t("credits.voices"),
    },
  }));
}
