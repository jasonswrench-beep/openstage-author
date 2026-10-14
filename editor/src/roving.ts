// A list of items that is one stop for the Tab key: Tab goes into the list and out of it, and the arrow keys move between the items.
// This is the pure choice of which item the Tab key lands on, so it is tested without a screen.

export interface RovingItem {
  /** The item has the keyboard focus now. */
  focused: boolean;
  /** The item is the current one (the slide being edited, the object chosen). */
  current: boolean;
  /** The item is one of several that are chosen. */
  pressed: boolean;
}

/**
 * The index of the item Tab should land on: the one that has the focus, so that Tab and then Shift and Tab come back to where the
 * person was; otherwise the current one; otherwise the first chosen one; otherwise the first. -1 for an empty list.
 */
export function rovingStop(items: RovingItem[]): number {
  if (items.length === 0) return -1;
  for (const wanted of ["focused", "current", "pressed"] as const) {
    const at = items.findIndex((i) => i[wanted]);
    if (at >= 0) return at;
  }
  return 0;
}
