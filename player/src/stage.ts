// Draws one slide as real HTML elements, so native semantics (buttons, radio groups,
// headings, images with alt text) do the accessibility work.
//
// This is the single renderer. The published player and the editor's canvas both use it,
// and must never fork it. What differs is the `StageBehavior` each supplies: the player
// wires objects to the course runtime, the editor leaves them inert.

import { buildEmbed, buildMedia, buildScrollingText, buildTable } from "./blocks.ts";
import { buildInput, type InputChange } from "./inputs.ts";
import { Presenter } from "./animation.ts";
import { buildDownload } from "./downloads.ts";
import { buildInteraction, type ItemSound } from "./interactions.ts";
import { buildCertificate, buildResults, type CourseInfo, type CourseResults } from "./results.ts";
import { appendSanitizedHtml } from "./sanitize.ts";
import { backgroundCss, resolveStyle } from "./theme.ts";
import type { Effect, OSObject, QuizContent, Slide, Style, Theme } from "./types.ts";

export type Activation = "click" | "keyActivate";

export interface StageBehavior {
  /** Editing: objects are drawn but do nothing, and live regions are filled straight away. */
  editing?: boolean;
  onActivate?(obj: OSObject, via: Activation): void;
  /** Return null if nothing happened (no answer chosen). */
  onQuizSubmit?(obj: OSObject, choiceId: string, via: Activation): { locked: boolean } | null;
  quizStatus?(objectId: string): { choice: string | null; locked: boolean } | undefined;
  announce?(message: string): void;
  onMediaEnded?(objectId: string): void;
  /** A learner changed an input. */
  onInput?(obj: OSObject, change: InputChange): void;
  /** The current value of a variable, so an input shows what the learner chose before. */
  variableValue?(id: string): number | boolean | string | undefined;
  /** Where the learner stands in the quiz, for a results box and a certificate. */
  results?(): CourseResults | undefined;
  /** The course's title and language, for a certificate. */
  course?(): CourseInfo;
  /** The size in bytes of a file the course offers for download, if the host knows it. */
  fileSize?(path: string): number | undefined;
  /** Does this interaction item have audio the learner can start? */
  itemAudio?(objectId: string, itemId: string): boolean;
  /** A learner opened an interaction item, or asked to hear it: say it now. */
  playItem?(objectId: string, itemId: string): void;
}

const COLOR_PROPS: Record<string, string> = { color: "color", fill: "background-color", background: "background-color" };
const COLOR_VALUE = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([0-9.,%\s/]+\)|[a-z]+)$/i;
const PX_PROPS: Record<string, string> = { fontSize: "font-size", radius: "border-radius", strokeWidth: "border-width", padding: "padding" };
const TEXT_PROPS: Record<string, string> = { fontFamily: "font-family", fontWeight: "font-weight", textAlign: "text-align", lineHeight: "line-height" };
const SAFE_TEXT = /^[\w\s,"'.-]+$/;

/** Roles that make a text object a live region. Other roles are carried by the HTML itself. */
const LIVE_ROLES = new Set(["status", "alert"]);

interface Mounted {
  obj: OSObject;
  el: HTMLElement;
  stateName: string;
  hover: boolean;
  visited: boolean;
}

export class StageRenderer {
  private readonly doc: Document;
  readonly stageEl: HTMLElement;
  private readonly behavior: StageBehavior;
  private theme: Theme;
  private mounted = new Map<string, Mounted>();
  /** Shows and hides objects for their timing, playing an effect when there is one. */
  private readonly presenter = new Presenter();
  private layerEls = new Map<string, HTMLElement>();
  private fillers = new Map<string, { el: HTMLElement; html: string }[]>();
  private section: HTMLElement | null = null;

  constructor(doc: Document, stageEl: HTMLElement, behavior: StageBehavior, theme: Theme) {
    this.doc = doc;
    this.stageEl = stageEl;
    this.behavior = behavior;
    this.theme = theme;
  }

  /** Use a different theme. The next render (or refresh of each object) shows it. */
  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  /** The slide's region element, which takes focus when the player moves to a new slide. */
  get slideElement(): HTMLElement | null {
    return this.section;
  }

  /**
   * Build the slide. `shown` lists the layers on screen; the base layer always is. Returns
   * the slide's region element.
   */
  render(slide: Slide, shown: Set<string> = new Set()): HTMLElement {
    const doc = this.doc;
    this.stageEl.innerHTML = "";
    this.presenter.clear();
    this.mounted.clear();
    this.layerEls.clear();
    this.fillers.clear();

    const section = el(doc, "section", "os-slide");
    section.setAttribute("role", "region");
    section.setAttribute("aria-label", slide.name);
    section.tabIndex = -1;
    // The slide takes its look from the theme: background, and the text colour, font and button
    // colours that anything without its own setting falls back to.
    section.style.background = backgroundCss(this.theme, slide.background);
    section.style.color = this.theme.colors.text;
    section.style.fontFamily = this.theme.fonts.body;
    section.style.setProperty("--os-accent-strong", this.theme.colors.accentStrong);
    section.style.setProperty("--os-on-accent-strong", this.theme.colors.onAccentStrong);
    section.style.setProperty("--os-accent", this.theme.colors.accent);
    section.style.setProperty("--os-surface", this.theme.colors.surface);
    section.style.setProperty("--os-text", this.theme.colors.text);
    section.style.setProperty("--os-muted", this.theme.colors.muted);
    section.style.setProperty("--os-line", this.theme.colors.line);
    section.style.setProperty("--os-bg", this.theme.colors.background);
    section.style.setProperty("--os-dark", this.theme.colors.dark);
    section.style.setProperty("--os-on-dark", this.theme.colors.onDark);
    this.section = section;

    for (const [i, layer] of [slide.baseLayer, ...slide.layers].entries()) {
      const visible = i === 0 || shown.has(layer.id);
      const layerEl = el(doc, "div", "os-layer");
      layerEl.dataset["layerId"] = layer.id;
      layerEl.hidden = !visible;
      this.layerEls.set(layer.id, layerEl);
      for (const obj of readingOrder(layer.objects)) layerEl.appendChild(this.buildObject(obj, layer.id, visible));
      section.appendChild(layerEl);
    }
    this.stageEl.appendChild(section);
    return section;
  }

  /**
   * Hide an object because its time has not come, or has passed, or show it again. A separate switch from its layer and its
   * states, so none of them can undo another. A hidden object is not in the page for assistive technology or the keyboard.
   */
  setObjectTimed(objectId: string, visible: boolean, motion?: Effect): void {
    const el = this.mounted.get(objectId)?.el;
    if (el) this.presenter.set(objectId, el, visible, motion);
  }

  /** Stop every effect that is running now: what was arriving is there, and what was leaving is gone. */
  endAnimations(): void {
    this.presenter.endAll();
  }

  setLayerVisible(layerId: string, visible: boolean): void {
    const layerEl = this.layerEls.get(layerId);
    if (!layerEl) return;
    const fillers = this.fillers.get(layerId) ?? [];
    if (visible) {
      layerEl.hidden = false;
      // Fill live regions after they are on screen, so assistive technology announces them.
      requestAnimationFrame(() => fillers.forEach((f) => appendSanitizedHtml(f.el, f.html)));
    } else {
      layerEl.hidden = true;
      fillers.forEach((f) => (f.el.innerHTML = ""));
    }
  }

  elementFor(objectId: string): HTMLElement | undefined {
    return this.mounted.get(objectId)?.el;
  }

  /** The audio or video element of an object. With a transcript it is inside a box. */
  private mediaOf(objectId: string): HTMLMediaElement | null {
    const m = this.elementFor(objectId);
    if (m instanceof HTMLMediaElement) return m;
    return m?.querySelector<HTMLMediaElement>("video, audio") ?? null;
  }

  playMedia(objectId: string): void {
    const m = this.mediaOf(objectId);
    if (m) void m.play();
  }

  pauseMedia(objectId: string): void {
    this.mediaOf(objectId)?.pause();
  }

  setObjectState(objectId: string, state: string): void {
    const m = this.mounted.get(objectId);
    if (!m) return;
    m.stateName = state;
    this.refresh(m);
  }

  /** Re-apply position, size and style after the object's data changed. */
  refreshObject(objectId: string): void {
    const m = this.mounted.get(objectId);
    if (m) this.refresh(m);
  }

  // ---- building objects

  private buildObject(obj: OSObject, layerId: string, layerVisible: boolean): HTMLElement {
    const doc = this.doc;
    const a = obj.accessibility;
    let node: HTMLElement;

    switch (obj.type) {
      case "text": {
        node = el(doc, "div", "os-text");
        const html = String(obj.content["html"] ?? "");
        if (LIVE_ROLES.has(a.role)) {
          node.setAttribute("role", a.role);
          const list = this.fillers.get(layerId) ?? [];
          list.push({ el: node, html });
          this.fillers.set(layerId, list);
          if (layerVisible || this.behavior.editing) appendSanitizedHtml(node, html);
        } else {
          appendSanitizedHtml(node, html);
        }
        break;
      }
      case "image": {
        const img = el(doc, "img", "os-image") as HTMLImageElement;
        img.src = String(obj.content["src"] ?? "");
        img.alt = a.decorative ? "" : a.altText;
        node = img;
        break;
      }
      case "shape": {
        node = el(doc, "div", "os-shape");
        node.appendChild(shapeFigure(doc, String(obj.content["shape"] ?? "rectangle")));
        if (!a.decorative) {
          node.setAttribute("role", "img");
          node.setAttribute("aria-label", a.altText);
        }
        break;
      }
      case "button":
      case "hotspot": {
        const label = obj.type === "button" ? String(obj.content["label"] ?? "") : "";
        const b = button(doc, label, obj.type === "button" ? "os-button" : "os-hotspot");
        this.nameControl(b, label, a.altText);
        this.wireActivation(b, obj);
        node = b;
        break;
      }
      case "quizQuestion":
        node = this.buildQuiz(obj);
        break;
      case "interaction":
        node = buildInteraction(doc, obj, !!this.behavior.editing, this.itemSound(obj));
        break;
      case "input":
        node = buildInput(doc, obj, {
          editing: !!this.behavior.editing,
          value: (id) => this.behavior.variableValue?.(id),
          onChange: (change) => this.behavior.onInput?.(obj, change),
        });
        break;
      case "table":
        node = buildTable(doc, obj, !!this.behavior.editing);
        break;
      case "scrollingText":
        node = buildScrollingText(doc, obj, !!this.behavior.editing);
        break;
      case "video":
      case "audio":
        node = buildMedia(doc, obj, (id) => this.behavior.onMediaEnded?.(id));
        break;
      case "embed":
        node = buildEmbed(doc, obj, !!this.behavior.editing);
        break;
      case "download":
        node = buildDownload(doc, obj, { editing: !!this.behavior.editing, size: this.behavior.fileSize?.(String(obj.content["src"] ?? "")) });
        break;
      case "results":
      case "certificate": {
        const deps = {
          editing: !!this.behavior.editing,
          results: () => this.behavior.results?.(),
          course: () => this.behavior.course?.() ?? { title: "", language: "en-US" },
        };
        node = obj.type === "results" ? buildResults(doc, obj, deps) : buildCertificate(doc, obj, deps);
        break;
      }
    }

    if (a.decorative) node.setAttribute("aria-hidden", "true");
    const m: Mounted = { obj, el: node, stateName: "normal", hover: false, visited: false };
    this.mounted.set(obj.id, m);

    if (!this.behavior.editing) {
      // Hover look also applies on keyboard focus, so keyboard users get the same feedback.
      const on = (hover: boolean) => () => { m.hover = hover; this.refresh(m); };
      node.addEventListener("pointerenter", on(true));
      node.addEventListener("pointerleave", on(false));
      node.addEventListener("focusin", on(true));
      node.addEventListener("focusout", on(false));
    }
    this.refresh(m);
    return node;
  }

  /** Visible label wins as the accessible name; alt text extends it if it contains the label. */
  private nameControl(b: HTMLElement, label: string, altText: string): void {
    if (!altText) return;
    if (!label || altText.toLowerCase().includes(label.toLowerCase())) {
      b.setAttribute("aria-label", altText);
    } else if (altText !== label) {
      // A name that omits the visible label would break voice control (WCAG 2.5.3),
      // so the visible label stays the name and the alt text becomes the description.
      b.setAttribute("aria-description", altText);
    }
  }

  /**
   * Native buttons already respond to Enter and Space. A click with detail 0 did not come
   * from a pointer (keyboard, or a screen reader's activate), so it is a keyActivate.
   */
  private wireActivation(node: HTMLElement, obj: OSObject): void {
    if (this.behavior.editing) return;
    node.addEventListener("click", (e) => {
      const m = this.mounted.get(obj.id);
      if (!m || node.getAttribute("aria-disabled") === "true") return;
      m.visited = true;
      this.behavior.onActivate?.(obj, activation(e));
      this.refresh(m);
    });
  }

  /** How an interaction speaks its items: nothing in the editor, and nothing where the host cannot play audio. */
  private itemSound(obj: OSObject): ItemSound | undefined {
    const behavior = this.behavior;
    if (behavior.editing || !behavior.playItem) return undefined;
    return {
      has: (itemId) => behavior.itemAudio?.(obj.id, itemId) ?? false,
      play: (itemId) => behavior.playItem?.(obj.id, itemId),
    };
  }

  private buildQuiz(obj: OSObject): HTMLElement {
    const doc = this.doc;
    const q = obj.content as unknown as QuizContent;
    const box = el(doc, "div", "os-quiz");
    const group = el(doc, "div", "os-quiz-group");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", obj.accessibility.altText);
    for (const c of q.choices) {
      const label = el(doc, "label", "os-choice");
      const input = el(doc, "input", "") as HTMLInputElement;
      input.type = "radio";
      input.name = obj.id;
      input.value = c.id;
      label.append(input, doc.createTextNode(` ${c.label}`));
      group.appendChild(label);
    }
    const check = button(doc, "Check answer", "os-button os-quiz-check");
    box.append(group, check);
    if (this.behavior.editing) return box;

    // A resumed attempt shows the answer the learner gave, and stays locked if it was.
    const saved = this.behavior.quizStatus?.(obj.id);
    if (saved) {
      group.querySelectorAll<HTMLInputElement>("input").forEach((i) => {
        i.checked = i.value === saved.choice;
        if (saved.locked) i.disabled = true;
      });
      if (saved.locked) check.setAttribute("aria-disabled", "true");
    }

    check.addEventListener("click", (e) => {
      if (check.getAttribute("aria-disabled") === "true") return;
      const picked = group.querySelector<HTMLInputElement>("input:checked");
      if (!picked) {
        this.behavior.announce?.("Choose an answer first.");
        return;
      }
      const outcome = this.behavior.onQuizSubmit?.(obj, picked.value, activation(e));
      if (outcome?.locked) {
        check.setAttribute("aria-disabled", "true");
        group.querySelectorAll("input").forEach((i) => (i.disabled = true));
      }
    });
    return box;
  }

  // ---- styling

  private refresh(m: Mounted): void {
    const { obj, el: node } = m;
    const g = obj.geometry;
    node.style.cssText = "";
    const set = (k: string, v: string) => node.style.setProperty(k, v);
    set("left", `${g.x}px`);
    set("top", `${g.y}px`);
    set("width", `${g.width}px`);
    set("height", `${g.height}px`);
    set("z-index", String(g.z));
    if (g.rotation) set("transform", `rotate(${g.rotation}deg)`);

    const theme = this.theme;
    const layers: Style[] = [resolveStyle(theme, obj.style)];
    if (m.visited && obj.states["visited"]?.style) layers.push(resolveStyle(theme, obj.states["visited"].style));
    if (m.stateName !== "normal" && obj.states[m.stateName]?.style) layers.push(resolveStyle(theme, obj.states[m.stateName]!.style!));
    if (m.hover && obj.states["hover"]?.style) layers.push(resolveStyle(theme, obj.states["hover"].style));
    if (obj.type === "shape") {
      // Fill and outline belong to the drawn figure. The box around it must stay transparent,
      // or a circle would sit in a square of colour.
      const own = ["fill", "background", "stroke", "strokeWidth", "radius"];
      for (const style of layers) applyStyle(node, Object.fromEntries(Object.entries(style).filter(([k]) => !own.includes(k))));
      applyShapeStyle(node, Object.assign({}, ...layers) as Style);
    } else if (obj.type === "interaction" || obj.type === "table" || obj.type === "scrollingText" || obj.type === "input" || obj.type === "embed" || obj.type === "results" || obj.type === "certificate" || obj.type === "download") {
      // An interaction, table or scrolling text box paints itself in the theme's colours, which are known to read well together,
      // so only the font and its size can be changed.
      for (const style of layers) applyStyle(node, Object.fromEntries(Object.entries(style).filter(([k]) => k === "fontFamily" || k === "fontSize")));
    } else {
      for (const style of layers) applyStyle(node, style);
    }

    const disabled = m.stateName === "disabled";
    if (node instanceof HTMLButtonElement) node.disabled = disabled;
    else if (disabled) node.setAttribute("aria-disabled", "true");
  }
}

// ---- helpers shared with the player and editor

/**
 * DOM order is reading order and tab order. Objects with a tab order come first, in that
 * order. Objects outside the tab sequence (tab order 0, usually decorative) follow.
 * Visual stacking is separate: it comes from `z`, never from DOM position.
 */
export function readingOrder(objects: OSObject[]): OSObject[] {
  const tabbed = objects.filter((o) => (o.accessibility.tabOrder ?? 0) >= 1);
  const rest = objects.filter((o) => (o.accessibility.tabOrder ?? 0) < 1);
  tabbed.sort((a, b) => a.accessibility.tabOrder! - b.accessibility.tabOrder!);
  return [...tabbed, ...rest];
}

function activation(e: MouseEvent): Activation {
  return e.detail === 0 ? "keyActivate" : "click";
}

function applyStyle(node: HTMLElement, style: Style): void {
  for (const [key, raw] of Object.entries(style)) {
    const value = String(raw);
    if (key in COLOR_PROPS) {
      if (COLOR_VALUE.test(value)) node.style.setProperty(COLOR_PROPS[key]!, value);
    } else if (key in PX_PROPS) {
      if (typeof raw === "number") node.style.setProperty(PX_PROPS[key]!, `${raw}px`);
    } else if (key in TEXT_PROPS) {
      if (SAFE_TEXT.test(value)) node.style.setProperty(TEXT_PROPS[key]!, value);
    } else if (key === "opacity" && typeof raw === "number") {
      node.style.setProperty("opacity", String(raw));
    } else if (key === "stroke") {
      if (value === "none") node.style.setProperty("border", "none");
      else if (COLOR_VALUE.test(value)) { node.style.setProperty("border-style", "solid"); node.style.setProperty("border-color", value); }
    }
  }
}

// ---- shapes

/** The shapes an object of type "shape" can be. An unknown name draws a rectangle. */
export const SHAPE_KINDS = ["rectangle", "rounded", "ellipse", "triangle", "diamond", "arrow"] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

const SVG_NS = "http://www.w3.org/2000/svg";

const POINTS: Partial<Record<ShapeKind, string>> = {
  triangle: "50,0 100,100 0,100",
  diamond: "50,0 100,50 50,100 0,50",
  arrow: "0,30 60,30 60,0 100,50 60,100 60,70 0,70",
};

/** The drawn figure, stretched to fill the object's box. Hidden from assistive technology: the
 *  object around it carries the name. */
function shapeFigure(doc: Document, kind: string): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  let fig: SVGElement;
  if (kind === "ellipse") {
    fig = doc.createElementNS(SVG_NS, "ellipse");
    for (const [k, v] of Object.entries({ cx: "50", cy: "50", rx: "50", ry: "50" })) fig.setAttribute(k, v);
  } else if (kind in POINTS) {
    fig = doc.createElementNS(SVG_NS, "polygon");
    fig.setAttribute("points", POINTS[kind as ShapeKind]!);
  } else {
    fig = doc.createElementNS(SVG_NS, "rect");
    for (const [k, v] of Object.entries({ x: "0", y: "0", width: "100", height: "100" })) fig.setAttribute(k, v);
    if (kind === "rounded") { fig.setAttribute("rx", "12"); fig.setAttribute("ry", "12"); }
  }
  fig.setAttribute("class", "os-shape-fig");
  // Keep the outline the same thickness however the shape is stretched.
  fig.setAttribute("vector-effect", "non-scaling-stroke");
  svg.appendChild(fig);
  return svg;
}

function applyShapeStyle(node: HTMLElement, style: Style): void {
  const fig = node.querySelector(".os-shape-fig");
  if (!fig) return;
  const color = (v: unknown) => (typeof v === "string" && COLOR_VALUE.test(v) && v !== "none" ? v : "none");
  fig.setAttribute("fill", color(style["fill"] ?? style["background"]));
  const stroke = color(style["stroke"]);
  fig.setAttribute("stroke", stroke);
  const width = typeof style["strokeWidth"] === "number" ? style["strokeWidth"] : 2;
  fig.setAttribute("stroke-width", stroke === "none" ? "0" : String(Math.max(0, width)));
}

export function el(doc: Document, tag: string, cls: string): HTMLElement {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

export function button(doc: Document, text: string, cls: string): HTMLButtonElement {
  const b = el(doc, "button", cls) as HTMLButtonElement;
  b.type = "button";
  b.textContent = text;
  return b;
}
