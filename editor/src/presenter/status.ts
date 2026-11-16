// A presenter clip's block in the project (docs/format-spec.md, "Presenter clips"): what a clip is made from, whether it is out of date, and the
// record that says a program made it.

import type { CreditEntry, OSObject, PresenterBlock } from "../../../player/src/types.ts";
import { narrationHash, sha256Hex, type Narration } from "../narration.ts";
import type { PresenterInfo } from "./look.ts";

export type Framing = PresenterBlock["framing"];
export const FRAMINGS: readonly { id: Framing; label: string }[] = [
  { id: "rectangle", label: "A square" },
  { id: "rounded", label: "A square with rounded corners" },
  { id: "circle", label: "A circle" },
];

/** The side of the square the clip is put on the slide at. */
export const CLIP_BOX = 360;

/** The `madeFrom` of a block: the narration's own hash, the presenter, the tier, the framing and the label, joined by newlines. */
export function madeFrom(narration: Narration, block: Omit<PresenterBlock, "madeFrom">): string {
  const parts = [narrationHash(narration), block.id, block.tier, block.framing, String(block.label)];
  return `sha256:${sha256Hex(new TextEncoder().encode(parts.join("\n")))}`;
}

/** The block for a clip made now. */
export function blockFor(narration: Narration, p: { id: string; tier: PresenterBlock["tier"]; framing: Framing; label: boolean }): PresenterBlock {
  const head = { id: p.id, tier: p.tier, framing: p.framing, label: p.label };
  return { ...head, madeFrom: madeFrom(narration, head) };
}

/** What the Model needs to put a presenter clip on the slide, or to put a new clip in place of an old one. */
export interface PresenterClipSpec {
  /** The clip's file and its captions file, both already saved in the project. */
  src: string;
  captions: string;
  altText: string;
  /** The narration the clip was made from (a copy; the audio cache is found by working out its key). */
  narration: Narration;
  block: PresenterBlock;
  /** The record that says a program made the clip. */
  credit: CreditEntry;
  /** The object whose narration the presenter now speaks, so its own narration is taken off and nothing is said twice. Null to leave it. */
  takeNarrationFrom: string | null;
}

export type ClipStatus = "not-a-clip" | "no-narration" | "up-to-date" | "out-of-date";

const isNarration = (n: unknown): n is Narration => typeof n === "object" && n !== null && typeof (n as Narration).script === "string" && Array.isArray((n as Narration).pronunciations);

/** Whether a video is a presenter clip, and whether the clip still says what its narration says. */
export function clipStatus(obj: Pick<OSObject, "type" | "narration" | "presenter">): ClipStatus {
  if (obj.type !== "video" || !obj.presenter) return "not-a-clip";
  if (!isNarration(obj.narration)) return "no-narration";
  return madeFrom(obj.narration, obj.presenter) === obj.presenter.madeFrom ? "up-to-date" : "out-of-date";
}

/** What the picture's object takes for its framing: the shell's own rounding, so the pixels of the clip are always a plain square. */
export function framingStyle(framing: Framing, side = CLIP_BOX): { radius?: number } {
  if (framing === "rounded") return { radius: 28 };
  if (framing === "circle") return { radius: Math.round(side / 2) };
  return {};
}

/** The alt text a clip starts with: the presenter in words and that it speaks. The author reads it and changes it. */
export const startingAltText = (p: PresenterInfo): string => `${p.description}, speaking.`;

/** What assets.json keeps about a clip: that a program made it, so the credits page can say the presenter and its voice are synthetic. */
export function creditForClip(c: { path: string; presenter: PresenterInfo; script: string; madeAt: string }): CreditEntry {
  const words = c.script.trim().replace(/\s+/g, " ");
  return {
    path: c.path,
    title: `${c.presenter.name}, an illustrated presenter`,
    kind: "video",
    source: {
      provider: "generated", url: "https://openstageauthor.com/", creator: `OpenStage Presenter (${c.presenter.id})`, creatorUrl: "",
      licence: "Made by a program from the narration; the voice is synthetic", requiresCredit: true,
      generated: { service: "openstage-presenter", model: c.presenter.id, prompt: words.length <= 200 ? words : `${words.slice(0, 197).trimEnd()}...`, madeAt: c.madeAt },
    },
  } as CreditEntry;
}

/** A short name for the clip's file from what it says. */
export function fileHint(presenter: PresenterInfo, script: string): string {
  const words = script.trim().split(/\s+/).slice(0, 4).join(" ");
  return `${presenter.id} ${words}`.trim();
}
