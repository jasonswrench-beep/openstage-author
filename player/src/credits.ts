// The credits page: how one credit reads, and the credits the publisher adds for narration. Pure, so it is tested directly; the player
// turns the parts into text and links.

import type { CreditEntry } from "./types.ts";

export type CreditPart = { text: string } | { text: string; href: string };

const SITE_NAMES: Record<string, string> = {
  pixabay: "Pixabay", unsplash: "Unsplash", pexels: "Pexels", openverse: "Openverse", wikimedia: "Wikimedia Commons", freesound: "Freesound",
  mixkit: "Mixkit", svgrepo: "SVG Repo", libreshot: "Libreshot", vecteezy: "Vecteezy",
};

/** A link only if the address is a web address. Anything else, such as a javascript: address in a project that was handed over, is just words. */
const link = (text: string, href: string): CreditPart => (/^https?:\/\//i.test(href) ? { text, href } : { text });

/**
 * One credit as the parts of a sentence. A file from a library reads "Title, by Creator, from Library. Licence." A picture or sound an AI
 * service made reads "Title, made with Service (model). Licence." The words that made it are kept in the project, not shown to learners.
 */
export function creditParts(c: CreditEntry): CreditPart[] {
  const s = c.source;
  const parts: CreditPart[] = [{ text: c.title || c.path.split("/").pop() || c.path }];
  if (s.provider === "generated") {
    parts.push({ text: ", made with " }, link(s.creator || "an AI service", s.url));
  } else {
    if (s.creator) parts.push({ text: ", by " }, link(s.creator, s.creatorUrl));
    const site = SITE_NAMES[s.provider];
    if (site) parts.push({ text: ", from " }, link(site, s.url));
  }
  if (s.licence) parts.push({ text: `. ${s.licence}.` });
  return parts;
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
    title: "Narration",
    kind: "audio" as const,
    source: {
      provider: "generated" as const, url: u.home ?? "", creator: u.name, creatorUrl: "", requiresCredit: true,
      licence: u.where === "computer" ? "Synthetic voices made on this computer, not a person" : u.where === "internet" ? "Synthetic voices from an AI service, not a person" : "Synthetic voices, not a person",
    },
  }));
}
