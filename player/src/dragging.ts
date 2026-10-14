// Dragging, for the questions that offer it: words onto blanks, matches onto items, items into order.
//
// Dragging here is an extra for a mouse or a finger, and never the only way to answer. Every question that can be dragged also has real
// controls (a drop-down for each blank or item, Move up and Move down buttons) which a keyboard and a screen reader use, and dragging
// only ever changes those same controls. The things that are dragged are hidden from assistive technology, because the controls
// already say everything they would.

/** The place an item dropped at this height lands in the list, when `mids` are the middles of the other items, top to bottom. */
export function insertIndexFor(mids: number[], y: number): number {
  return mids.filter((m) => m < y).length;
}

/** `order` with `id` taken out and put back so that it sits at position `to`, counting from 0. A position past either end is the end. */
export function reorder(order: string[], id: string, to: number): string[] {
  if (!order.includes(id)) return order;
  const rest = order.filter((x) => x !== id);
  rest.splice(Math.max(0, Math.min(rest.length, to)), 0, id);
  return rest;
}

export interface DragSpec {
  /** The thing that is picked up. */
  source: HTMLElement;
  /** Show a copy of the source following the pointer. Off when the source is itself moved about. */
  ghost?: boolean;
  /** What, under the pointer, can take the drop: the element itself or one around it, or null. */
  target(under: Element | null): HTMLElement | null;
  /** The pointer is over this target now (or over none), so it can be highlighted. */
  over?(target: HTMLElement | null, pointer: { x: number; y: number }): void;
  /** The pointer was let go over this target, or over none. */
  drop(target: HTMLElement | null, pointer: { x: number; y: number }): void;
  /** The drag began, or ended without a drop. */
  state?(dragging: boolean): void;
}

/** A copy of the source that follows the pointer, in the colours the source has, and the size it has on the screen. */
function makeGhost(source: HTMLElement): { el: HTMLElement; move(x: number, y: number): void } {
  const doc = source.ownerDocument;
  const rect = source.getBoundingClientRect();
  // The stage may be shrunk to fit the window. The copy sits outside it, so it is shrunk the same amount.
  const scale = source.offsetWidth > 0 ? rect.width / source.offsetWidth : 1;
  const el = source.cloneNode(true) as HTMLElement;
  const css = doc.defaultView!.getComputedStyle(source);
  el.classList.add("is-dragging");
  el.removeAttribute("id");
  Object.assign(el.style, {
    backgroundColor: css.backgroundColor, color: css.color, borderColor: css.borderColor, borderStyle: css.borderStyle, borderWidth: css.borderWidth,
    borderRadius: css.borderRadius, padding: css.padding, font: css.font, width: `${source.offsetWidth}px`, transformOrigin: "0 0", transform: `scale(${scale})`,
    position: "fixed", left: "0px", top: "0px", margin: "0", opacity: "1",
  });
  doc.body.appendChild(el);
  const offX = 0;
  const offY = rect.height / 2;
  return {
    el,
    move: (x, y) => {
      el.style.left = `${x - offX}px`;
      el.style.top = `${y - offY}px`;
    },
  };
}

/** Make a source draggable with the mouse or a finger. Escape cancels. */
export function attachDrag(spec: DragSpec): void {
  const source = spec.source;
  source.addEventListener("pointerdown", (down) => {
    if (down.button !== 0 || down.isPrimary === false) return;
    down.preventDefault();
    const doc = source.ownerDocument;
    try { source.setPointerCapture(down.pointerId); } catch { /* a pointer that is gone cannot be captured */ }
    const ghost = spec.ghost === false ? null : makeGhost(source);
    ghost?.move(down.clientX, down.clientY);
    spec.state?.(true);
    let current: HTMLElement | null = null;

    const finish = (up: PointerEvent | null): void => {
      source.removeEventListener("pointermove", move);
      source.removeEventListener("pointerup", release);
      source.removeEventListener("pointercancel", cancel);
      doc.removeEventListener("keydown", key, true);
      try { source.releasePointerCapture(down.pointerId); } catch { /* already released */ }
      ghost?.el.remove();
      spec.over?.(null, { x: down.clientX, y: down.clientY });
      spec.state?.(false);
      if (up) spec.drop(current, { x: up.clientX, y: up.clientY });
    };
    const move = (ev: PointerEvent): void => {
      ghost?.move(ev.clientX, ev.clientY);
      const target = spec.target(doc.elementFromPoint(ev.clientX, ev.clientY));
      current = target;
      spec.over?.(target, { x: ev.clientX, y: ev.clientY });
    };
    const release = (ev: PointerEvent): void => finish(ev);
    const cancel = (): void => finish(null);
    const key = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        finish(null);
      }
    };
    source.addEventListener("pointermove", move);
    source.addEventListener("pointerup", release);
    source.addEventListener("pointercancel", cancel);
    doc.addEventListener("keydown", key, true);
  });
}
