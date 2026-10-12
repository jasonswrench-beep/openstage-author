// The Timeline panel: the timing of every object on the slide drawn along a time axis, so a whole slide can be seen at a glance.
// Each object is a row with a bar for when it is showing, and two grips: one for when it appears and one for when it goes. A thin line
// under the bar shows its narration, as long as the audio has been made, so a step can be lined up with the words that introduce it.
//
// Every grip is a real ARIA slider that works from the keyboard, and can also be dragged. The Timing list and the Properties panel
// make the same changes as fields, so nothing here is the only way to do anything. The arithmetic is in timelinemodel.ts.

import type { OSObject, Timing } from "../../player/src/types.ts";
import type { Model } from "./model.ts";
import { describeTiming, isStartingTiming } from "./timing.ts";
import {
  buildTimeline, endText, MIN_STAY_MS, msAtPointer, nudged, percentOf, snapMs, startMax, startText, stayFromValue, stayMax,
  type Bar, type TimelineView,
} from "./timelinemodel.ts";

type Attrs = Record<string, string | boolean>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    if (k === "class") e.className = String(v);
    else if (k === "text") e.textContent = String(v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  e.append(...kids);
  return e;
}

export interface TimelinePanelOptions {
  model: () => Model | null;
  /** How long an object's narration lasts in milliseconds, or null if its audio has not been made. */
  narrationMs: (o: OSObject) => number | null;
  announce: (message: string) => void;
  /** Open the Timing list, which makes the same changes as a table. */
  openList: () => void;
  /** The panel asked to be hidden. */
  onClose: () => void;
}

const seconds = (ms: number): string => String(ms / 1000);

export class TimelinePanel {
  readonly element: HTMLElement;
  private readonly body: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly opts: TimelinePanelOptions;
  /** True while a grip or a bar is being dragged: the panel is not redrawn under the pointer. */
  private dragging = false;

  constructor(opts: TimelinePanelOptions) {
    this.opts = opts;
    this.summary = h("span", { class: "summary" });
    const list = h("button", { type: "button", text: "Timing list..." });
    list.title = "The same timing as a table, with a box for each time";
    list.addEventListener("click", () => opts.openList());
    const close = h("button", { type: "button", text: "Hide timeline" });
    close.addEventListener("click", () => opts.onClose());
    this.body = h("div", { class: "tl-body" });
    this.element = h("section", { class: "panel timeline", "aria-labelledby": "timeline-h", hidden: true },
      h("div", { class: "panel-head" }, h("h2", { id: "timeline-h", text: "Timeline" }), this.summary, list, close),
      this.body);
  }

  get open(): boolean {
    return !this.element.hidden;
  }

  setOpen(open: boolean): void {
    this.element.hidden = !open;
    if (open) this.render();
  }

  /** Draw the timeline again from the model, keeping the grip the author is on. */
  render(): void {
    const m = this.opts.model();
    if (!m || this.element.hidden || this.dragging) return;
    const focused = document.activeElement instanceof HTMLElement && this.body.contains(document.activeElement) ? document.activeElement : null;
    const keep = focused ? { id: focused.closest<HTMLElement>(".tl-row")?.dataset["id"], grip: focused.dataset["grip"], name: focused.classList.contains("tl-name") } : null;

    const view = buildTimeline(m.timingRows(), m.slide?.duration ?? null, this.opts.narrationMs);
    const timed = view.bars.filter((b) => !isStartingTiming(b.timing)).length;
    this.summary.textContent = view.bars.length === 0 ? "Nothing on this slide" : `${view.bars.length} ${view.bars.length === 1 ? "object" : "objects"}, ${timed} timed${view.advanceAt === null ? "" : ", moves on by itself"}`;

    const children: HTMLElement[] = [this.axis(view)];
    let layerId = "";
    for (const bar of view.bars) {
      if (!bar.onBase && bar.layerId !== layerId) children.push(h("p", { class: "tl-layer", text: `Layer ${bar.layerName}: times count from when this layer is shown` }));
      layerId = bar.layerId;
      children.push(this.row(m, view, bar));
    }
    if (view.bars.length === 0) children.push(h("p", { class: "note", text: "Add an object to the slide to give it a time." }));
    children.push(h("p", { class: "note", text: "Each row is an object. Its bar shows when it is showing, and a bar that runs to the edge stays. The thin line under a bar is the object's narration, shown once its audio has been made. Left and Right arrows move a grip a tenth of a second, with Shift a second and with Page Up and Page Down five; Home and End go to the ends. You can also drag. The Timing list makes the same changes in a table." }));
    this.body.replaceChildren(...children);

    if (keep?.id) {
      const row = [...this.body.querySelectorAll<HTMLElement>(".tl-row")].find((r) => r.dataset["id"] === keep.id);
      (keep.name ? row?.querySelector<HTMLElement>(".tl-name") : keep.grip ? row?.querySelector<HTMLElement>(`[data-grip="${keep.grip}"]`) : null)?.focus();
    }
  }

  /** The row of times along the top, and the line where the slide moves on. */
  private axis(view: TimelineView): HTMLElement {
    const track = h("div", { class: "tl-track tl-axis-track", "aria-hidden": "true" });
    for (const t of view.ticks) track.append(h("span", { class: "tl-tick", style: `left:${percentOf(t.ms, view.horizon)}%`, text: t.label }));
    if (view.advanceAt !== null) track.append(h("span", { class: "tl-advance", style: `left:${percentOf(view.advanceAt, view.horizon)}%`, text: "moves on" }));
    return h("div", { class: "tl-row tl-axis" }, h("span", { class: "tl-name tl-name-axis", text: "Seconds" }), track);
  }

  private row(m: Model, view: TimelineView, bar: Bar): HTMLElement {
    const selected = m.sel.objectId === bar.id;
    const guess = bar.approximate ? ". Its narration has no audio yet, so its place on the timeline is only a guess" : "";
    const row = h("div", { class: "tl-row", role: "group", "aria-label": `${bar.name}: ${describeTiming(bar.timing, !bar.onBase)}${guess}`, "data-id": bar.id, ...(selected ? { "aria-current": "true" } : {}) });
    const name = h("button", { type: "button", class: "tl-name", text: bar.name, title: `Select ${bar.name}` });
    name.addEventListener("click", () => { m.reveal(m.sel.slideId, bar.id); });

    const track = h("div", { class: "tl-track" });
    for (const t of view.ticks) track.append(h("span", { class: "tl-line", "aria-hidden": "true", style: `left:${percentOf(t.ms, view.horizon)}%` }));
    const narr = h("div", { class: "tl-narr", "aria-hidden": "true" });
    const barEl = h("div", { class: "tl-bar", "aria-hidden": "true" });
    const start = h("div", { class: "tl-grip tl-grip-start", role: "slider", tabindex: "0", "data-grip": "start" });
    const end = h("div", { class: "tl-grip tl-grip-end", role: "slider", tabindex: "0", "data-grip": "end" });
    track.append(narr, barEl, start, end);
    row.append(name, track);
    this.place(row, bar, view.horizon);

    // keyboard
    start.addEventListener("keydown", (e) => {
      const next = nudged(bar.timing.start, e.key, e.shiftKey, 0, startMax(bar, view.horizon));
      if (next === null) return;
      e.preventDefault();
      this.apply(m, bar.id, { start: next });
    });
    end.addEventListener("keydown", (e) => {
      const room = stayMax(bar, view.horizon);
      if (e.key === "End") { e.preventDefault(); this.apply(m, bar.id, { visibleFor: null }); return; }
      const next = nudged(bar.timing.visibleFor ?? room, e.key, e.shiftKey, MIN_STAY_MS, room);
      if (next === null) return;
      e.preventDefault();
      this.apply(m, bar.id, { visibleFor: stayFromValue(next, bar, view.horizon) });
    });
    // pointer: each grip moves its own time, and the bar moves the whole thing
    const track0 = () => track.getBoundingClientRect();
    const drag = (el: HTMLElement, move: (ms: number, begin: number, initial: Timing) => { start?: number; visibleFor?: number | null }) => {
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        // Before the selection changes, because that would draw the panel again and replace the very grip under the pointer.
        this.dragging = true;
        if (m.sel.objectId !== bar.id) m.reveal(m.sel.slideId, bar.id);
        const rect = track0();
        const begin = msAtPointer(e.clientX, rect.left, rect.width, view.horizon);
        const initial: Timing = { ...bar.timing };
        let message = "";
        // The listeners are on the window, so the drag follows the pointer wherever it goes and does not depend on the pointer being
        // captured by an element that the panel might replace. Escape puts everything back, so a drag can be called off from the keyboard.
        const onMove = (ev: PointerEvent) => {
          const ms = msAtPointer(ev.clientX, rect.left, rect.width, view.horizon);
          const r = m.setTiming(bar.id, move(ms, begin, initial));
          if (r.message) message = r.message;
          const now = buildTimeline(m.timingRows(), m.slide?.duration ?? null, this.opts.narrationMs).bars.find((b) => b.id === bar.id);
          if (now) { Object.assign(bar, now); this.place(row, bar, view.horizon); }
        };
        const finish = (cancelled: boolean) => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onCancel);
          window.removeEventListener("keydown", onKey, true);
          this.dragging = false;
          if (cancelled) {
            m.setTiming(bar.id, { start: initial.start, visibleFor: initial.visibleFor });
            this.opts.announce("Drag cancelled. The timing is back as it was.");
          } else if (message) {
            this.opts.announce(message);
          }
          this.render();
        };
        const onUp = () => finish(false);
        const onCancel = () => finish(true);
        const onKey = (ev: KeyboardEvent) => {
          if (ev.key !== "Escape") return;
          ev.preventDefault();
          ev.stopPropagation();
          finish(true);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
        window.addEventListener("keydown", onKey, true);
      });
    };
    drag(start, (ms) => ({ start: Math.min(startMax(bar, view.horizon), Math.max(0, snapMs(ms - bar.origin))) }));
    drag(end, (ms) => ({ visibleFor: stayFromValue(Math.max(MIN_STAY_MS, ms - bar.from), bar, view.horizon) }));
    drag(barEl, (ms, begin, initial) => ({ start: Math.min(startMax(bar, view.horizon), Math.max(0, snapMs(initial.start + (ms - begin)))) }));
    barEl.addEventListener("click", () => { if (m.sel.objectId !== bar.id) m.reveal(m.sel.slideId, bar.id); });
    return row;
  }

  /** Put a row's bar, narration line and grips where its timing says, and tell a screen reader the values. */
  private place(row: HTMLElement, bar: Bar, horizon: number): void {
    const track = row.querySelector<HTMLElement>(".tl-track")!;
    const [narr, barEl, start, end] = ["tl-narr", "tl-bar", "tl-grip-start", "tl-grip-end"].map((c) => track.querySelector<HTMLElement>(`.${c}`)!) as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    const left = percentOf(bar.from, horizon);
    const right = bar.to === null ? 100 : percentOf(bar.to, horizon);
    barEl.setAttribute("style", `left:${left}%;width:${Math.max(0.4, right - left)}%`);
    barEl.className = `tl-bar${bar.to === null ? " tl-stays" : ""}${isStartingTiming(bar.timing) ? " tl-always" : ""}${bar.timing.appear === "narration" ? " tl-follows" : ""}${bar.approximate ? " tl-guess" : ""}`;
    if (bar.narration) {
      narr.hidden = false;
      narr.setAttribute("style", `left:${percentOf(bar.narration.start, horizon)}%;width:${Math.max(0.4, percentOf(bar.narration.end, horizon) - percentOf(bar.narration.start, horizon))}%`);
    } else {
      narr.hidden = true;
    }
    start.setAttribute("style", `left:${left}%`);
    end.setAttribute("style", `left:${right}%`);

    const room = stayMax(bar, horizon);
    start.setAttribute("aria-label", `${bar.name}: when it appears`);
    start.setAttribute("aria-valuemin", "0");
    start.setAttribute("aria-valuemax", seconds(startMax(bar, horizon)));
    start.setAttribute("aria-valuenow", seconds(bar.timing.start));
    start.setAttribute("aria-valuetext", startText(bar.timing, bar.onBase));
    end.setAttribute("aria-label", `${bar.name}: when it goes`);
    end.setAttribute("aria-valuemin", seconds(MIN_STAY_MS));
    end.setAttribute("aria-valuemax", seconds(room));
    end.setAttribute("aria-valuenow", seconds(bar.timing.visibleFor ?? room));
    end.setAttribute("aria-valuetext", endText(bar.timing));
    row.setAttribute("aria-label", `${bar.name}: ${describeTiming(bar.timing, !bar.onBase)}${bar.approximate ? ". Its narration has no audio yet, so its place on the timeline is only a guess" : ""}`);
  }

  /** Make a change from the keyboard, say what it did, and draw again. */
  private apply(m: Model, id: string, patch: { start?: number; visibleFor?: number | null }): void {
    if (m.sel.objectId !== id) m.reveal(m.sel.slideId, id); // the Properties panel follows the object being changed
    const r = m.setTiming(id, patch);
    if (r.message) this.opts.announce(r.message);
    this.render();
  }
}
