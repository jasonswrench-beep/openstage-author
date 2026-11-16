// A video made by the Presenter add-on (docs/presenter.md) carries its own voice: the clip was made from the narration on the same object, and
// the speech is in the clip. The narration is kept in the project so the clip can be made again when the words change, and it is in the page's
// transcript like any narration, but it is never played a second time beside the clip.

import type { NarrationAsset } from "./types.ts";

/** Whether the clip says what its narration says, so the narration must not be played over it. */
export const speaksItself = (o: { presenter?: unknown }): boolean => Boolean(o.presenter);

/** The narration to play for these objects, in the order given: each with its audio, and none for a presenter clip (it speaks for itself). */
export function narrationToPlay(objects: readonly { id: string; presenter?: unknown }[], narration: Readonly<Record<string, NarrationAsset | undefined>>): { id: string; asset: NarrationAsset }[] {
  return objects.flatMap((o) => {
    const asset = narration[o.id];
    return asset && !speaksItself(o) ? [{ id: o.id, asset }] : [];
  });
}
