// The editing canvas. It draws the slide with the shared StageRenderer in editing mode,
// and adds selection, dragging, resizing and keyboard moves on top.
//
// Keyboard users do not depend on any of this: every move and resize is also available as
// typed numbers in the Properties panel, and every object can be chosen from the Objects
// list. The keys here are a convenience, and each one announces what it did.

import { hasAnimation, play, reducedMotion } from "../../player/src/animation.ts";
import { StageRenderer } from "../../player/src/stage.ts";
import type { ObjectAnimation } from "../../player/src/types.ts";
import type { OSObject } from "../../player/src/types.ts";
import type { Backend } from "./backend.ts";
import type { Change, Model } from "./model.ts";
import { DEFAULT_THEME } from "./themes.ts";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const MIN_DRAG_SIZE = 8;

export const CANVAS_HINT =
  "Arrow keys move the selected objects by 1, or 10 with Shift. Alt with arrow keys resizes one object. " +
  "Page Down and Page Up select the next or previous object, and Shift with them adds to the selection. " +
  "Shift and click adds or removes an object, and dragging a box round objects selects them. Ctrl and A selects everything. " +
  "Escape clears the selection. You can also type exact values in the Properties panel.";

/** A box dragged across empty canvas shorter than this, in stage pixels, was a click, not a box. */
const MIN_MARQUEE = 4;

interface Drag {
  mode: "move" | "marquee" | Handle;
  startX: number;
  startY: number;
  /** Where each object being moved or resized began, by id. */
  geoms: Map<string, OSObject["geometry"]>;
  objectId: string;
  /** The pointer has moved, so this was a drag and not a click. */
  moved: boolean;
  /** A click without a drag on an object in a selection of several narrows the selection to it. */
  collapseTo: string | null;
}

export class Canvas {
  readonly element: HTMLElement;
  private readonly group: HTMLElement;
  private readonly viewport: HTMLElement;
  private readonly wrap: HTMLElement;
  private readonly stageEl: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly box: HTMLElement;
  /** Outlines of the objects selected along with others, when more than one is selected. */
  private marks: HTMLElement[] = [];
  /** The box being dragged across empty canvas to select what it touches. */
  private readonly marquee: HTMLElement;
  private readonly stage: StageRenderer;
  private readonly model: () => Model | null;
  private readonly backend: Backend;
  private readonly announce: (message: string) => void;
  private scale = 1;
  /** Which slide and layer are on the canvas, so a change of either redraws it. */
  private drawn = "";
  private drag: Drag | null = null;
  private announceTimer = 0;
  private readonly assetUrls = new Map<string, string>();
  private readonly failedAssets = new Set<string>();

  constructor(doc: Document, model: () => Model | null, backend: Backend, announce: (m: string) => void) {
    this.model = model;
    this.backend = backend;
    this.announce = announce;

    this.element = doc.createElement("div");
    this.element.className = "canvas-area";

    this.viewport = doc.createElement("div");
    this.viewport.className = "canvas-viewport";

    // The one tab stop for the canvas. Its keys are described by the hint below.
    this.group = doc.createElement("div");
    this.group.className = "canvas-wrap";
    this.group.tabIndex = 0;
    this.group.setAttribute("role", "group");
    this.group.setAttribute("aria-label", "Slide canvas");
    this.group.setAttribute("aria-describedby", "canvas-hint");
    this.wrap = this.group;

    this.stageEl = doc.createElement("div");
    this.stageEl.className = "os-stage os-editing";
    this.overlay = doc.createElement("div");
    this.overlay.className = "edit-overlay";
    this.box = doc.createElement("div");
    this.box.className = "edit-box";
    this.box.hidden = true;
    this.box.setAttribute("aria-hidden", "true");
    for (const h of HANDLES) {
      const handle = doc.createElement("span");
      handle.className = `edit-handle edit-handle-${h}`;
      handle.dataset["handle"] = h;
      this.box.appendChild(handle);
    }
    this.marquee = doc.createElement("div");
    this.marquee.className = "edit-marquee";
    this.marquee.hidden = true;
    this.marquee.setAttribute("aria-hidden", "true");
    this.overlay.append(this.box, this.marquee);
    this.stageEl.appendChild(this.overlay);
    this.wrap.appendChild(this.stageEl);
    this.viewport.appendChild(this.wrap);

    const hint = doc.createElement("p");
    hint.id = "canvas-hint";
    hint.className = "canvas-hint";
    hint.textContent = CANVAS_HINT;
    this.element.append(this.viewport, hint);

    // Editing mode: objects are drawn but inert. The shared renderer draws them.
    this.stage = new StageRenderer(doc, this.stageEl, { editing: true }, DEFAULT_THEME);
    // The stage clears its own children on render, so the overlay is re-attached after.
    this.group.addEventListener("keydown", (e) => this.onKey(e));
    this.overlay.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.overlay.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.overlay.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.overlay.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    new ResizeObserver(() => this.fit()).observe(this.viewport);
  }

  focus(): void {
    this.group.focus();
  }

  /** Redraw the whole slide. */
  render(): void {
    const m = this.model();
    if (!m || !m.slide) {
      this.stageEl.replaceChildren(this.overlay);
      this.group.setAttribute("aria-label", "Slide canvas, no slide open");
      return;
    }
    this.stage.setTheme(m.theme);
    const { width, height } = m.project.stage;
    this.stageEl.style.width = `${width}px`;
    this.stageEl.style.height = `${height}px`;
    this.drawn = `${m.sel.slideId}/${m.sel.layerId}`;
    const shown = new Set([m.sel.layerId]);
    const section = this.stage.render(m.slide, shown);
    // Objects are drawn for the eye. They are not the way to reach them with a keyboard or
    // a screen reader: the Objects list is.
    section.inert = true;
    this.stageEl.appendChild(this.overlay);
    this.group.setAttribute("aria-label", `Slide canvas: ${m.slide.name}, ${m.layer?.name ?? ""} layer`);
    void this.loadAssets(m.dir);
    this.fit();
    this.updateSelection();
  }

  /** Apply a change from the model without rebuilding everything when possible. */
  update(change: Change): void {
    const m = this.model();
    if (!m) return;
    if (change.kind === "geometry" && change.objectId) {
      this.stage.refreshObject(change.objectId);
      this.updateSelection();
    } else if (change.kind === "selection") {
      // Choosing another slide or layer changes what is drawn. Choosing an object does not.
      if (this.drawn !== `${m.sel.slideId}/${m.sel.layerId}`) this.render();
      else this.updateSelection();
    } else {
      this.render();
    }
  }

  private async loadAssets(dir: string): Promise<void> {
    const els = this.stageEl.querySelectorAll<HTMLImageElement | HTMLMediaElement>("img[src], video[src], audio[src]");
    for (const node of Array.from(els)) {
      const raw = node.getAttribute("src") ?? "";
      if (!raw.startsWith("assets/")) continue;
      try {
        let url = this.assetUrls.get(raw);
        if (!url) {
          url = await this.backend.assetUrl(dir, raw);
          this.assetUrls.set(raw, url);
        }
        node.src = url;
      } catch (err) {
        // A missing file is also reported by the validator, but say so here too, once.
        if (!this.failedAssets.has(raw)) {
          this.failedAssets.add(raw);
          this.announce(`Could not load ${raw} for the canvas. ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  private fit(): void {
    const m = this.model();
    if (!m) return;
    const { width, height } = m.project.stage;
    const room = this.viewport;
    const scale = Math.min((room.clientWidth - 32) / width, (room.clientHeight - 32) / height, 1);
    this.scale = Math.max(0.1, Number.isFinite(scale) ? scale : 1);
    this.stageEl.style.transform = `scale(${this.scale})`;
    this.wrap.style.width = `${width * this.scale}px`;
    this.wrap.style.height = `${height * this.scale}px`;
  }

  private updateSelection(): void {
    for (const mark of this.marks) mark.remove();
    this.marks = [];
    const sel = this.model()?.selected ?? [];
    const o = sel[0];
    if (!o) {
      this.box.hidden = true;
      return;
    }
    // Several selected: each is outlined, and there are no handles, because a handle could only resize one of them.
    if (sel.length > 1) {
      this.box.hidden = true;
      for (const each of sel) {
        const mark = this.overlay.ownerDocument.createElement("div");
        mark.className = "edit-box edit-box-multi";
        mark.setAttribute("aria-hidden", "true");
        mark.style.left = `${each.geometry.x}px`;
        mark.style.top = `${each.geometry.y}px`;
        mark.style.width = `${each.geometry.width}px`;
        mark.style.height = `${each.geometry.height}px`;
        mark.style.transform = each.geometry.rotation ? `rotate(${each.geometry.rotation}deg)` : "";
        mark.style.setProperty("--line", `${2 / this.scale}px`);
        this.overlay.appendChild(mark);
        this.marks.push(mark);
      }
      return;
    }
    const g = o.geometry;
    this.box.hidden = false;
    this.box.style.left = `${g.x}px`;
    this.box.style.top = `${g.y}px`;
    this.box.style.width = `${g.width}px`;
    this.box.style.height = `${g.height}px`;
    this.box.style.transform = g.rotation ? `rotate(${g.rotation}deg)` : "";
    // Keep handles a constant size on screen whatever the zoom.
    this.box.style.setProperty("--handle", `${10 / this.scale}px`);
    this.box.style.setProperty("--line", `${2 / this.scale}px`);
  }

  // ---- keyboard

  /**
   * Play an object's arrival, hold a moment, then play its exit and put it back, so the author can see what a learner will see.
   * Nothing is changed in the project. If the author's own device asks for less motion, nothing is played, and that is said, because
   * a learner with that setting would see nothing move either.
   */
  async previewAnimation(objectId: string, animation: ObjectAnimation): Promise<"played" | "none" | "reduced"> {
    const el = this.stage.elementFor(objectId);
    if (!el || !hasAnimation(animation)) return "none";
    if (reducedMotion()) return "reduced";
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const entering = play(el, animation.enter, "enter");
    if (entering) await entering.finished;
    await wait(600);
    const leaving = play(el, animation.exit, "exit");
    if (leaving) {
      await leaving.finished;
      await wait(300);
      leaving.cancel();
    }
    return "played";
  }

  private onKey(e: KeyboardEvent): void {
    const m = this.model();
    if (!m || e.ctrlKey || e.metaKey) return;
    const step = e.shiftKey ? 10 : 1;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const arrow = arrows[e.key];
    if (arrow) {
      e.preventDefault();
      if (m.selected.length === 0) {
        this.say("Nothing is selected. Press Page Down to select an object, or choose one from the Objects list.");
        return;
      }
      const [dx, dy] = arrow;
      const msg = e.altKey ? m.resizeBy(dx * step, dy * step) : m.nudge(dx * step, dy * step);
      if (msg) this.say(msg);
      return;
    }
    if ((e.key === "PageDown" || e.key === "PageUp") && e.shiftKey) {
      e.preventDefault();
      const msg = m.extendSelection(e.key === "PageDown" ? 1 : -1);
      if (msg) this.say(msg);
    } else if (e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      const list = m.objects;
      if (list.length === 0) return;
      const at = list.findIndex((o) => o.id === m.sel.objectId);
      const next = e.key === "PageDown" ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
      const target = list[next]!;
      m.selectObject(target.id);
      this.say(`Selected ${m.describe(target)}`);
    } else if (e.key === "Delete" && m.object) {
      e.preventDefault();
      const msg = m.deleteSelected();
      if (msg) this.say(`${msg}. Press Control Z to undo.`);
    } else if (e.key === "Escape" && m.object) {
      e.preventDefault();
      m.selectObject(null);
      this.say("Selection cleared");
    }
  }

  /** Several quick key presses announce once, with the final position. */
  private say(message: string): void {
    window.clearTimeout(this.announceTimer);
    this.announceTimer = window.setTimeout(() => this.announce(message), 350);
  }

  // ---- pointer

  private toStage(e: PointerEvent): { x: number; y: number } {
    const r = this.wrap.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.scale, y: (e.clientY - r.top) / this.scale };
  }

  private hit(x: number, y: number): OSObject | null {
    const m = this.model();
    if (!m) return null;
    const byZ = [...(m.layer?.objects ?? [])].sort((a, b) => b.geometry.z - a.geometry.z);
    return byZ.find((o) => x >= o.geometry.x && x <= o.geometry.x + o.geometry.width && y >= o.geometry.y && y <= o.geometry.y + o.geometry.height) ?? null;
  }

  private onPointerDown(e: PointerEvent): void {
    const m = this.model();
    if (!m || e.button !== 0) return;
    const p = this.toStage(e);
    const handle = (e.target as HTMLElement).dataset["handle"] as Handle | undefined;
    this.group.focus({ preventScroll: true });
    const start = (mode: Drag["mode"], geoms: Map<string, OSObject["geometry"]>, objectId: string, collapseTo: string | null) => {
      this.drag = { mode, startX: p.x, startY: p.y, geoms, objectId, moved: false, collapseTo };
      this.overlay.setPointerCapture(e.pointerId);
      e.preventDefault();
    };

    // A handle resizes the one selected object. (There are no handles while several are selected.)
    if (handle) {
      const target = m.object;
      if (!target) return;
      m.beginGesture();
      start(handle, new Map([[target.id, { ...target.geometry }]]), target.id, null);
      return;
    }

    const target = this.hit(p.x, p.y);
    // Shift or Ctrl and click adds an object to the selection, or takes it out.
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (target) {
        const msg = m.toggleSelected(target.id);
        if (msg) this.say(msg);
      }
      e.preventDefault();
      return;
    }
    // Empty canvas: clear the selection, and a drag from here draws a box that selects what it touches.
    if (!target) {
      m.selectObject(null);
      start("marquee", new Map(), "", null);
      return;
    }
    // On one of several selected objects, a drag moves them all together. A click without a drag narrows the selection to it.
    const inside = m.selected.length > 1 && m.selected.some((o) => o.id === target.id);
    if (!inside) {
      m.selectObject(target.id);
      this.say(`Selected ${m.describe(target)}`);
    }
    const moving = inside ? m.selected : [target];
    m.beginGesture();
    start("move", new Map(moving.map((o) => [o.id, { ...o.geometry }])), target.id, inside ? target.id : null);
  }

  private onPointerMove(e: PointerEvent): void {
    const m = this.model();
    const d = this.drag;
    if (!m || !d) return;
    const p = this.toStage(e);
    const dx = Math.round(p.x - d.startX);
    const dy = Math.round(p.y - d.startY);
    if (dx !== 0 || dy !== 0) d.moved = true;
    if (d.mode === "marquee") {
      const box = this.marqueeBox(d, p);
      this.marquee.hidden = false;
      this.marquee.style.left = `${box.x}px`;
      this.marquee.style.top = `${box.y}px`;
      this.marquee.style.width = `${box.width}px`;
      this.marquee.style.height = `${box.height}px`;
      this.marquee.style.setProperty("--line", `${2 / this.scale}px`);
      return;
    }
    if (d.mode === "move") {
      for (const [id, g0] of d.geoms) m.setGeometry(id, { x: g0.x + dx, y: g0.y + dy });
      return;
    }
    const g = d.geoms.get(d.objectId)!;
    let { x, y, width, height } = g;
    if (d.mode.includes("e")) width = Math.max(MIN_DRAG_SIZE, g.width + dx);
    if (d.mode.includes("s")) height = Math.max(MIN_DRAG_SIZE, g.height + dy);
    if (d.mode.includes("w")) {
      width = Math.max(MIN_DRAG_SIZE, g.width - dx);
      x = g.x + g.width - width;
    }
    if (d.mode.includes("n")) {
      height = Math.max(MIN_DRAG_SIZE, g.height - dy);
      y = g.y + g.height - height;
    }
    m.setGeometry(d.objectId, { x, y, width, height });
  }

  /** The box dragged across empty canvas, in stage pixels, whichever way it was dragged. */
  private marqueeBox(d: Drag, p: { x: number; y: number }): { x: number; y: number; width: number; height: number } {
    return { x: Math.min(d.startX, p.x), y: Math.min(d.startY, p.y), width: Math.abs(p.x - d.startX), height: Math.abs(p.y - d.startY) };
  }

  private onPointerUp(e: PointerEvent): void {
    const m = this.model();
    const d = this.drag;
    if (!d || !m) return;
    this.drag = null;
    if (this.overlay.hasPointerCapture(e.pointerId)) this.overlay.releasePointerCapture(e.pointerId);
    if (d.mode === "marquee") {
      this.marquee.hidden = true;
      const box = this.marqueeBox(d, this.toStage(e));
      if (box.width < MIN_MARQUEE && box.height < MIN_MARQUEE) return; // a click on empty canvas: the selection was already cleared
      const touched = (m.layer?.objects ?? []).filter((o) => {
        const g = o.geometry;
        return g.x < box.x + box.width && g.x + g.width > box.x && g.y < box.y + box.height && g.y + g.height > box.y;
      });
      const msg = m.selectIds(touched.map((o) => o.id));
      if (msg) this.say(msg);
      return;
    }
    m.endGesture();
    if (d.collapseTo && !d.moved) {
      m.selectObject(d.collapseTo);
      this.say(m.describeSelection());
      return;
    }
    const sel = m.selected;
    if (sel.length === 1) this.say(m.describe(sel[0]!));
    else if (sel.length > 1) this.say(this.model()?.describeSelection() ?? "");
  }
}
