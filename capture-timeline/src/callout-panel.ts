// SPDX-License-Identifier: Apache-2.0
/**
 * The callout gallery: a bar of buttons under the picture. Each puts a ready-made callout at the playhead (words, a title,
 * a lower third, a highlight box, a circle, an arrow, a blur, a cover), or a zoom. The new row is chosen and its form opens in
 * the Properties panel with focus in the first box that needs filling in.
 *
 * The bar is one stop in the tab order; Up and Down (or Left and Right), Home and End move along it. "Draw a zoom" is for the mouse (it says
 * so, and what to use instead); "Zoom on a part" does the same without one.
 */

import { CALLOUTS } from "../../capture-edit/src/index.ts";
import type { Announcer } from "./announcer.ts";
import { h, nextId } from "./dom.ts";
import type { EditSession } from "./session.ts";

export interface CalloutBar {
  readonly element: HTMLElement;
  focus(): void;
  destroy(): void;
}

export interface CalloutBarOptions {
  readonly announcer: Announcer;
  /** Start or stop drawing a zoom on the picture. */
  readonly drawZoom: () => { ok: boolean; message: string; drawing: boolean };
  /** Be told when drawing starts or stops, so the button can show it. */
  readonly onDrawingChange: (listener: (drawing: boolean) => void) => void;
  /** A callout or zoom was added: show its form. */
  readonly onAdded: () => void;
}

/** The middle quarter of the picture, in the picture's own shape: where "Zoom on a part" starts. */
const MIDDLE_PART = { x: 2500, y: 2500, width: 5000, height: 5000 };

export function mountCalloutBar(container: HTMLElement, session: EditSession, options: CalloutBarOptions): CalloutBar {
  const id = nextId("os-co");
  const { announcer } = options;
  const buttons: HTMLButtonElement[] = [];

  const add = (label: string, hint: string, run: () => void, pressed?: boolean): HTMLButtonElement => {
    const b = h("button", { type: "button", class: "os-cl-button os-co-button", title: hint, ...(pressed === undefined ? {} : { "aria-pressed": "false" }) }, label);
    b.addEventListener("click", run);
    buttons.push(b);
    return b;
  };

  const afterAdd = (message: string, ok: boolean): void => {
    announcer.say(message);
    if (ok) options.onAdded();
  };

  const bar = h("div", { class: "os-co", role: "toolbar", "aria-label": "Add to the picture at the playhead", "aria-orientation": "vertical", id });
  bar.append(h("span", { class: "os-co-title", "aria-hidden": "true" }, "Add at the playhead"));
  for (const info of CALLOUTS) {
    bar.append(
      add(info.label, `${info.hint}. Added at the playhead.`, () => {
        const outcome = session.addCalloutHere(info.kind);
        afterAdd(outcome.message, outcome.ok);
      }),
    );
  }
  bar.append(h("span", { class: "os-tl-sep", "aria-hidden": "true" }));
  bar.append(
    add("Zoom on a part", "A zoom on the middle of the picture, to place with the form or the frame.", () => {
      const outcome = session.addZoomHere(MIDDLE_PART);
      afterAdd(outcome.message, outcome.ok);
    }),
  );
  const draw = add("Draw a zoom", "Drag a rectangle on the picture to zoom in on that part (mouse). Without a mouse, use Zoom on a part.", () => {
    const outcome = options.drawZoom();
    announcer.say(outcome.message);
  }, false);
  bar.append(draw);
  options.onDrawingChange((drawing) => draw.setAttribute("aria-pressed", drawing ? "true" : "false"));

  let stop = 0;
  const showStop = (index: number): void => {
    stop = index;
    buttons.forEach((b, i) => b.setAttribute("tabindex", i === index ? "0" : "-1"));
  };
  showStop(0);
  bar.addEventListener("focusin", (e) => {
    const at = buttons.indexOf(e.target as HTMLButtonElement);
    if (at >= 0 && at !== stop) showStop(at);
  });
  bar.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const to = e.key === "ArrowDown" || e.key === "ArrowRight" ? stop + 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? stop - 1 : e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : undefined;
    if (to === undefined) return;
    e.preventDefault();
    const next = Math.min(buttons.length - 1, Math.max(0, to));
    showStop(next);
    buttons[next]?.focus();
  });

  container.append(bar);
  return {
    element: bar,
    focus: () => buttons[stop]?.focus(),
    destroy: () => bar.remove(),
  };
}
