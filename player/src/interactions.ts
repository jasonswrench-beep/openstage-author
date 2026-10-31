// Interactions: ready-made objects that present several items in one place (tabs, an accordion,
// flip cards and so on). Each one is built from real HTML controls and follows the matching pattern
// from the WAI-ARIA Authoring Practices, so the keyboard and screen reader behaviour is the one
// people already know. The renderer calls buildInteraction for an object of type "interaction"; it
// is part of the one shared renderer, so the editor's canvas and the published course look the same.
//
// Nothing here moves by itself, nothing needs a mouse, and every control is a native button.

import { appendSanitizedHtml } from "./sanitize.ts";
import { t, tn } from "./playertext.ts";
import type { InteractionContent, InteractionItem, OSObject } from "./types.ts";

export const INTERACTION_KINDS = [
  "clickReveal", "flipCards", "tabs", "accordion", "carousel", "steps",
  "timeline", "processCircle", "glossary", "pyramidStack", "pyramidMatrix", "circleMatrix", "labeledGraphic",
] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

/** How many items each kind can show. A drawing has only so many places for them. */
export const ITEM_LIMITS: Record<InteractionKind, { min: number; max: number }> = {
  clickReveal: { min: 1, max: 12 }, flipCards: { min: 1, max: 12 }, tabs: { min: 1, max: 12 },
  accordion: { min: 1, max: 20 }, carousel: { min: 1, max: 20 }, steps: { min: 1, max: 12 },
  timeline: { min: 2, max: 12 }, processCircle: { min: 3, max: 8 }, glossary: { min: 1, max: 50 },
  pyramidStack: { min: 3, max: 7 }, pyramidMatrix: { min: 3, max: 6 }, circleMatrix: { min: 3, max: 8 },
  labeledGraphic: { min: 1, max: 12 },
};

type Attrs = Record<string, string>;

function make(doc: Document, tag: string, cls = "", attrs: Attrs = {}): HTMLElement {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function btn(doc: Document, cls: string, attrs: Attrs = {}): HTMLButtonElement {
  const b = make(doc, "button", cls, { type: "button", ...attrs }) as HTMLButtonElement;
  return b;
}

/** An item's picture, with its alt text, or an empty alt if it is decorative. */
function picture(doc: Document, item: InteractionItem): HTMLElement | null {
  if (!item.image) return null;
  const img = make(doc, "img", "os-ix-img") as HTMLImageElement;
  img.src = item.image.src;
  img.alt = item.image.decorative ? "" : item.image.alt;
  return img;
}

function bodyOf(doc: Document, item: InteractionItem): HTMLElement {
  const body = make(doc, "div", "os-ix-body");
  appendSanitizedHtml(body, item.body);
  return body;
}

/** The content of one item as it appears when opened: its picture, then its text, then a Listen button if it has audio. */
function fillPanel(doc: Document, panel: HTMLElement, item: InteractionItem, sound: ItemSound | undefined): void {
  const img = picture(doc, item);
  if (img) panel.appendChild(img);
  panel.appendChild(bodyOf(doc, item));
  const listen = listenButton(doc, item, sound);
  if (listen) panel.appendChild(listen);
}

/**
 * What an interaction needs to speak its items. `has` says whether an item has audio to start, and `play` starts it.
 * Absent in the editor, where nothing speaks.
 */
export interface ItemSound {
  has(itemId: string): boolean;
  play(itemId: string): void;
}

/**
 * A button that plays an item's audio, for the learner who wants to hear it again, or to hear the item that was already
 * showing when the slide opened. Only an item with audio gets one. It is an ordinary button, so the keyboard reaches it.
 */
function listenButton(doc: Document, item: InteractionItem, sound: ItemSound | undefined): HTMLElement | null {
  if (!sound?.has(item.id)) return null;
  const b = btn(doc, "os-ix-listen", { "aria-label": t("ix.listenNamed", { title: item.title }) });
  b.textContent = t("ix.listen");
  b.addEventListener("click", () => sound.play(item.id));
  return b;
}

export function buildInteraction(doc: Document, obj: OSObject, editing: boolean, sound?: ItemSound): HTMLElement {
  const c = obj.content as unknown as InteractionContent;
  const root = make(doc, "div", `os-interaction os-ix-${c.kind} os-ix-${c.orientation}`, { role: "group" });
  if (!obj.accessibility.decorative) root.setAttribute("aria-label", obj.accessibility.altText);
  const ctx: Ctx = { doc, obj, c, root, editing, sound, id: (item, part) => `${obj.id}-${item.id}-${part}` };
  switch (c.kind) {
    case "clickReveal": buildDisclosures(ctx, false); break;
    case "accordion": buildDisclosures(ctx, true); break;
    case "flipCards": buildFlipCards(ctx); break;
    case "tabs": case "timeline": case "processCircle": case "pyramidStack": case "pyramidMatrix": case "circleMatrix": case "labeledGraphic":
      buildSelector(ctx, c.kind);
      break;
    case "glossary": buildGlossary(ctx); break;
    case "carousel": buildCarousel(ctx, false); break;
    case "steps": buildCarousel(ctx, true); break;
  }
  return root;
}

interface Ctx {
  doc: Document;
  obj: OSObject;
  c: InteractionContent;
  root: HTMLElement;
  editing: boolean;
  sound: ItemSound | undefined;
  id(item: InteractionItem, part: string): string;
}

// ---- click to reveal and accordion: a button opens its own panel

function buildDisclosures(ctx: Ctx, accordion: boolean): void {
  const { doc, c, root } = ctx;
  const list = make(doc, "div", "os-ix-list");
  root.appendChild(list);
  const cells = c.items.map((item) => {
    const cell = make(doc, "div", "os-ix-cell");
    const trigger = btn(doc, "os-ix-trigger", { id: ctx.id(item, "b"), "aria-expanded": "false", "aria-controls": ctx.id(item, "p") });
    const img = accordion ? null : picture(doc, item);
    if (img) trigger.appendChild(img);
    trigger.appendChild(make(doc, "span", "os-ix-title"));
    trigger.lastElementChild!.textContent = item.title;
    trigger.appendChild(make(doc, "span", "os-ix-mark", { "aria-hidden": "true" }));
    const panel = make(doc, "div", "os-ix-panel", { id: ctx.id(item, "p"), role: "region", "aria-labelledby": ctx.id(item, "b") });
    panel.hidden = true;
    fillPanel(doc, panel, item, ctx.sound);
    if (accordion) {
      const h = make(doc, "h3", "os-ix-heading");
      h.appendChild(trigger);
      cell.append(h, panel);
    } else {
      cell.append(trigger, panel);
    }
    list.appendChild(cell);
    return { cell, trigger, panel };
  });
  const set = (i: number, open: boolean) => {
    cells[i]!.trigger.setAttribute("aria-expanded", String(open));
    cells[i]!.panel.hidden = !open;
    cells[i]!.cell.classList.toggle("is-open", open);
  };
  // In the editor the first item is shown open, so the author sees what the learner will see.
  if (ctx.editing) { set(0, true); return; }
  cells.forEach((cell, i) => {
    cell.trigger.addEventListener("click", () => {
      const open = cell.trigger.getAttribute("aria-expanded") !== "true";
      if (open && !c.allowMultiple) cells.forEach((_, j) => j !== i && set(j, false));
      set(i, open);
      if (open) ctx.sound?.play(c.items[i]!.id);
    });
  });
  if (accordion) {
    // Up and Down move between the headers, as in the accordion pattern.
    list.addEventListener("keydown", (e) => {
      const at = cells.findIndex((x) => x.trigger === doc.activeElement);
      if (at === -1) return;
      const to = e.key === "ArrowDown" ? (at + 1) % cells.length : e.key === "ArrowUp" ? (at - 1 + cells.length) % cells.length : e.key === "Home" ? 0 : e.key === "End" ? cells.length - 1 : -1;
      if (to < 0) return;
      e.preventDefault();
      cells[to]!.trigger.focus();
    });
  }
}

// ---- flip cards: the front is a button, the back says more and has a button to turn back

function buildFlipCards(ctx: Ctx): void {
  const { doc, c, root } = ctx;
  const list = make(doc, "div", "os-ix-list");
  root.appendChild(list);
  for (const item of c.items) {
    const card = make(doc, "div", "os-ix-card");
    const front = btn(doc, "os-ix-face os-ix-front", { id: ctx.id(item, "b"), "aria-expanded": "false", "aria-controls": ctx.id(item, "p") });
    const img = picture(doc, item);
    if (img) front.appendChild(img);
    const title = make(doc, "span", "os-ix-title");
    title.textContent = item.title;
    front.append(title, make(doc, "span", "os-ix-hint"));
    front.lastElementChild!.textContent = t("ix.selectToFlip");
    const back = make(doc, "div", "os-ix-face os-ix-backface", { id: ctx.id(item, "p"), role: "region", "aria-labelledby": ctx.id(item, "b") });
    back.hidden = true;
    const heading = make(doc, "h3", "os-ix-heading");
    heading.textContent = item.title;
    back.appendChild(heading);
    fillPanel(doc, back, item, ctx.sound);
    const turn = btn(doc, "os-ix-turn");
    turn.textContent = t("ix.flipBack");
    turn.setAttribute("aria-label", t("ix.flipBackNamed", { title: item.title }));
    back.appendChild(turn);
    card.append(front, back);
    list.appendChild(card);
    if (ctx.editing) continue;
    const flip = (toBack: boolean) => {
      front.hidden = toBack;
      back.hidden = !toBack;
      front.setAttribute("aria-expanded", String(toBack));
      const shown = toBack ? back : front;
      shown.classList.remove("os-flip-in");
      void shown.offsetWidth; // restart the turn animation
      shown.classList.add("os-flip-in");
      (toBack ? turn : front).focus();
      if (toBack) ctx.sound?.play(item.id);
    };
    front.addEventListener("click", () => flip(true));
    turn.addEventListener("click", () => flip(false));
  }
}

// ---- one panel at a time, chosen by a row of tabs or by a drawing
//
// Tabs, a timeline, a process circle, a pyramid and a circle matrix are all the same thing to a
// learner using a keyboard or a screen reader: a tablist, where choosing a tab shows its panel. Only
// the drawing differs. So they share one builder and the WAI-ARIA tabs pattern, and the drawing is
// made with CSS around real buttons.

type SelectorKind = "tabs" | "timeline" | "processCircle" | "pyramidStack" | "pyramidMatrix" | "circleMatrix" | "labeledGraphic";

/** The drawn kinds put the tabs in a picture next to the panel. */
const DIAGRAMS = new Set<SelectorKind>(["processCircle", "pyramidStack", "pyramidMatrix", "circleMatrix"]);

type Pt = [number, number];
const pct = (pts: Pt[]) => `polygon(${pts.map(([x, y]) => `${x.toFixed(2)}% ${y.toFixed(2)}%`).join(", ")})`;

/** Pull a polygon a little towards its centre, so neighbouring pieces have a thin gap between them. */
function shrink(pts: Pt[], k: number): Pt[] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
}

/** How many cells each row of a pyramid matrix has, for n items. The top is one cell and rows widen downwards. */
export function pyramidRows(n: number): number[] {
  if (n <= 1) return [1];
  if (n === 2) return [1, 1];
  if (n === 3) return [1, 2];
  if (n === 4) return [1, 2, 1];
  if (n === 5) return [1, 2, 2];
  return [1, 2, 3];
}

/** A piece of a picture: where it is drawn, and where its label sits. Percentages of the picture. */
interface Piece { shape: Pt[]; label: Pt }

function piecesFor(kind: SelectorKind, n: number): Piece[] {
  if (kind === "pyramidStack") {
    return Array.from({ length: n }, (_, i) => {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      return { shape: shrink([[50 - 50 * t0, t0 * 100], [50 + 50 * t0, t0 * 100], [50 + 50 * t1, t1 * 100], [50 - 50 * t1, t1 * 100]], 0.97), label: [50, ((t0 + t1) / 2) * 100] as Pt };
    });
  }
  if (kind === "pyramidMatrix") {
    const rows = pyramidRows(n);
    const out: Piece[] = [];
    rows.forEach((k, r) => {
      const t0 = r / rows.length;
      const t1 = (r + 1) / rows.length;
      for (let j = 0; j < k; j++) {
        if (out.length >= n) return;
        const left = (t: number) => 50 - 50 * t + (100 * t * j) / k;
        const width = (t: number) => (100 * t) / k;
        const shape: Pt[] = [[left(t0), t0 * 100], [left(t0) + width(t0), t0 * 100], [left(t1) + width(t1), t1 * 100], [left(t1), t1 * 100]];
        out.push({ shape: shrink(shape, 0.96), label: [left((t0 + t1) / 2) + width((t0 + t1) / 2) / 2, ((t0 + t1) / 2) * 100] });
      }
    });
    return out;
  }
  if (kind === "circleMatrix") {
    const inner = 24;
    const outer = 49;
    return Array.from({ length: n }, (_, i) => {
      const a0 = (i / n) * 360 - 90;
      const a1 = ((i + 1) / n) * 360 - 90;
      const arc = (r: number, from: number, to: number, steps = 14): Pt[] =>
        Array.from({ length: steps + 1 }, (_, s) => {
          const a = ((from + ((to - from) * s) / steps) * Math.PI) / 180;
          return [50 + r * Math.cos(a), 50 + r * Math.sin(a)] as Pt;
        });
      const shape = [...arc(outer, a0 + 1.5, a1 - 1.5), ...arc(inner, a1 - 1.5, a0 + 1.5)];
      const mid = ((a0 + a1) / 2) * (Math.PI / 180);
      const lr = (inner + outer) / 2;
      return { shape, label: [50 + lr * Math.cos(mid), 50 + lr * Math.sin(mid)] as Pt };
    });
  }
  // processCircle: a node at each position round the circle, starting at the top.
  return Array.from({ length: n }, (_, i) => {
    const a = ((i / n) * 360 - 90) * (Math.PI / 180);
    return { shape: [], label: [50 + 38 * Math.cos(a), 50 + 38 * Math.sin(a)] as Pt };
  });
}

/** The ring of arrows behind a process circle's steps. It carries no meaning of its own. */
function ringArrows(doc: Document, n: number): SVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("class", "os-ix-ring");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const ring = doc.createElementNS(NS, "circle");
  for (const [k, v] of Object.entries({ cx: "50", cy: "50", r: "38", fill: "none", "stroke-width": "1.2", "stroke-dasharray": "2 2" })) ring.setAttribute(k, v);
  ring.setAttribute("class", "os-ix-ring-line");
  svg.appendChild(ring);
  for (let i = 0; i < n; i++) {
    const a = (((i + 0.5) / n) * 360 - 90) * (Math.PI / 180);
    const x = 50 + 38 * Math.cos(a);
    const y = 50 + 38 * Math.sin(a);
    const head = doc.createElementNS(NS, "polygon");
    // A small triangle pointing clockwise along the ring.
    const deg = ((i + 0.5) / n) * 360;
    head.setAttribute("points", "-2.4,-2.2 2.6,0 -2.4,2.2");
    head.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${deg.toFixed(1)})`);
    head.setAttribute("class", "os-ix-ring-head");
    svg.appendChild(head);
  }
  return svg;
}

/**
 * Where marker `i` of `n` sits on a labeled graphic, as percentages of the picture (to the middle of the marker). A marker with
 * no place, or one outside the picture, goes in a row along the bottom, so it can still be found and used.
 */
export function markerAt(item: InteractionItem, i: number, n: number): { x: number; y: number } {
  const inside = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
  if (inside(item.x) && inside(item.y)) return { x: item.x, y: item.y };
  return { x: ((i + 0.5) / n) * 100, y: 92 };
}

/** What the step line of a guided labeled graphic says. After the learner's own action it names the step; when the slide opens it only counts. */
export function stepText(i: number, n: number, title: string, announce: boolean): string {
  const count = t("ix.stepOf", { n: i + 1, total: n });
  return announce ? t("ix.countNamed", { count, title }) : count;
}

/** What a marker is called to a screen reader: its number, which is all it shows, then its title. */
export function markerName(i: number, title: string): string {
  return t("ix.markerName", { n: i + 1, title });
}

function buildSelector(ctx: Ctx, kind: SelectorKind): void {
  const { doc, c, root } = ctx;
  const diagram = DIAGRAMS.has(kind);
  // A labeled graphic is a picture with its tabs laid over it as numbered markers. A guided one also steps through them in order.
  const spatial = kind === "labeledGraphic";
  const guided = spatial && c.guided === true;
  const vertical = kind === "tabs" && c.orientation === "vertical";
  const n = c.items.length;

  const tablist = make(doc, "div", spatial ? "os-ix-tablist os-ix-markers" : diagram ? "os-ix-tablist os-ix-diagram" : "os-ix-tablist", { role: "tablist", "aria-label": ctx.obj.accessibility.altText });
  if (kind === "tabs") tablist.setAttribute("aria-orientation", c.orientation);
  else if (kind === "timeline") tablist.setAttribute("aria-orientation", "horizontal");
  const panels = make(doc, "div", "os-ix-panels");
  // For a guided labeled graphic: Previous, "Step 2 of 5", Next. The same bar as a carousel's, so it works and reads the same way.
  const guideBar = make(doc, "div", "os-ix-bar");
  const guidePrev = btn(doc, "os-ix-nav");
  guidePrev.textContent = t("ix.previousStep");
  const guideNext = btn(doc, "os-ix-nav");
  guideNext.textContent = t("ix.nextStep");
  const guideStatus = make(doc, "span", "os-ix-status", { "aria-live": "polite", "aria-atomic": "true" });
  guideBar.append(guidePrev, guideStatus, guideNext);

  if (kind === "processCircle") tablist.appendChild(ringArrows(doc, n));
  const pieces = diagram ? piecesFor(kind, n) : [];

  const tabs = c.items.map((item, i) => {
    const tab = btn(doc, "os-ix-tab", { role: "tab", id: ctx.id(item, "b"), "aria-controls": ctx.id(item, "p"), "aria-selected": "false", tabindex: "-1" });
    const label = make(doc, "span", "os-ix-label");
    label.textContent = item.title;
    if (diagram) {
      const piece = pieces[i]!;
      tab.classList.add("os-ix-piece");
      if (piece.shape.length) tab.style.setProperty("--os-shape", pct(piece.shape));
      tab.style.setProperty("--os-lx", `${piece.label[0].toFixed(2)}%`);
      tab.style.setProperty("--os-ly", `${piece.label[1].toFixed(2)}%`);
      if (kind === "pyramidStack") {
        // Each layer is a row; its picture is the left part and its label sits to the right.
        const t0 = i / n;
        const t1 = (i + 1) / n;
        tab.style.setProperty("--os-ly", "50%");
        tab.style.top = `${t0 * 100}%`;
        tab.style.height = `${100 / n}%`;
        tab.style.setProperty("--os-shape", pct(shrink([[50 - 50 * t0, 0], [50 + 50 * t0, 0], [50 + 50 * t1, 100], [50 - 50 * t1, 100]], 0.97)));
      }
    } else if (kind === "timeline") {
      tab.appendChild(make(doc, "span", "os-ix-dot", { "aria-hidden": "true" }));
    } else if (spatial) {
      // The marker shows only its number. The title is in its name (and in the panel when it is chosen).
      const at = markerAt(item, i, n);
      tab.classList.add("os-ix-marker");
      tab.style.left = `${at.x}%`;
      tab.style.top = `${at.y}%`;
      tab.setAttribute("aria-label", markerName(i, item.title));
      label.textContent = String(i + 1);
    }
    tab.appendChild(label);
    const panel = make(doc, "div", "os-ix-panel", { role: "tabpanel", id: ctx.id(item, "p"), "aria-labelledby": ctx.id(item, "b"), tabindex: "0" });
    panel.hidden = true;
    if (kind !== "tabs") {
      const h = make(doc, "h3", "os-ix-heading");
      h.textContent = item.title;
      panel.appendChild(h);
    }
    fillPanel(doc, panel, item, ctx.sound);
    tablist.appendChild(tab);
    panels.appendChild(panel);
    return { tab, panel };
  });

  if (diagram) root.classList.add("os-ix-withdiagram");
  if (spatial) {
    // Reading order is the picture (and what it shows), then the markers, then the text of the one chosen.
    const frame = make(doc, "div", "os-ix-graphic");
    if (c.graphic && c.graphic.src !== "") {
      const pic = make(doc, "img", "os-ix-picture") as HTMLImageElement;
      pic.src = c.graphic.src;
      pic.alt = c.graphic.alt;
      frame.appendChild(pic);
    } else {
      const none = make(doc, "p", "os-ix-nopicture");
      none.textContent = t("ix.noPicture");
      frame.appendChild(none);
    }
    frame.appendChild(tablist);
    root.classList.add("os-ix-withgraphic");
    // The text of the chosen marker, and for a guided one the bar that steps through them, sit together beside the picture.
    const side = make(doc, "div", "os-ix-side");
    side.appendChild(panels);
    if (guided) side.appendChild(guideBar);
    root.append(frame, side);
  } else {
    root.append(tablist, panels);
  }

  // Choosing a tab speaks its item, but only when the learner activates it (a click, or Enter or Space). Arrow keys
  // move through the tabs without speaking, so a screen reader can read each name undisturbed; the Listen button is there.
  const select = (i: number, focus: boolean, speak = false, announce = false) => {
    tabs.forEach((t, j) => {
      t.tab.setAttribute("aria-selected", String(j === i));
      t.tab.tabIndex = j === i ? 0 : -1;
      t.panel.hidden = j !== i;
    });
    if (guided) {
      guidePrev.setAttribute("aria-disabled", String(i === 0));
      guideNext.setAttribute("aria-disabled", String(i === n - 1));
      // The live region is only filled by the learner's own action, so opening the slide is not noisy.
      guideStatus.textContent = stepText(i, n, c.items[i]!.title, announce);
    }
    if (focus) tabs[i]!.tab.focus();
    if (speak) ctx.sound?.play(c.items[i]!.id);
  };
  select(0, false);
  if (ctx.editing) return;
  tabs.forEach((t, i) => t.tab.addEventListener("click", () => select(i, false, true, true)));
  if (guided) {
    const current = () => tabs.findIndex((t) => t.tab.getAttribute("aria-selected") === "true");
    const go = (to: number) => { if (to >= 0 && to < n) select(to, false, true, true); };
    guidePrev.addEventListener("click", () => go(current() - 1));
    guideNext.addEventListener("click", () => go(current() + 1));
  }
  tablist.addEventListener("keydown", (e) => {
    const at = tabs.findIndex((t) => t.tab === doc.activeElement);
    if (at === -1) return;
    // A row of tabs uses Left and Right, a column uses Up and Down. A drawing has no single direction,
    // so either pair moves to the next or previous one.
    const forward = vertical ? ["ArrowDown"] : diagram || spatial ? ["ArrowRight", "ArrowDown"] : ["ArrowRight"];
    const backward = vertical ? ["ArrowUp"] : diagram || spatial ? ["ArrowLeft", "ArrowUp"] : ["ArrowLeft"];
    const to = forward.includes(e.key) ? (at + 1) % n : backward.includes(e.key) ? (at - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    select(to, true, false, true);
  });
}

// ---- glossary: terms A to Z with a search box, a letter bar and the definition beside them

function buildGlossary(ctx: Ctx): void {
  const { doc, c, root } = ctx;
  const items = [...c.items].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));

  const side = make(doc, "div", "os-ix-gloss-side");
  const searchId = `${ctx.obj.id}-search`;
  const searchLabel = make(doc, "label", "os-ix-search-label", { for: searchId });
  searchLabel.textContent = t("ix.searchTerms");
  const search = make(doc, "input", "os-ix-search", { id: searchId, type: "search", autocomplete: "off" }) as HTMLInputElement;
  const count = make(doc, "p", "os-ix-gloss-count", { "aria-live": "polite", "aria-atomic": "true" });

  const letters = make(doc, "div", "os-ix-letters", { role: "group", "aria-label": t("ix.jumpToLetter") });
  const listEl = make(doc, "ul", "os-ix-terms", { "aria-label": t("ix.terms") });
  const entries = items.map((item) => {
    const li = make(doc, "li");
    const b = btn(doc, "os-ix-term", { id: ctx.id(item, "b"), "aria-controls": `${ctx.obj.id}-definition` });
    b.textContent = item.title;
    li.appendChild(b);
    listEl.appendChild(li);
    return { item, li, b };
  });
  const first = (item: InteractionItem) => (item.title.trim()[0] ?? "").toUpperCase();
  const present = new Set(entries.map((e) => first(e.item)));
  const letterButtons = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((ch) => {
    const b = btn(doc, "os-ix-letter", { "aria-label": t("ix.termsStarting", { letter: ch }) });
    b.textContent = ch;
    if (!present.has(ch)) b.setAttribute("aria-disabled", "true");
    letters.appendChild(b);
    return { ch, b };
  });

  const definition = make(doc, "div", "os-ix-panel os-ix-definition", { id: `${ctx.obj.id}-definition`, role: "region", "aria-label": t("ix.definition"), "aria-live": "polite", tabindex: "0" });

  side.append(searchLabel, search, count, letters, listEl);
  root.append(side, definition);
  root.classList.add("os-ix-withdiagram");

  const show = (item: InteractionItem) => {
    definition.replaceChildren();
    const h = make(doc, "h3", "os-ix-heading");
    h.textContent = item.title;
    definition.appendChild(h);
    fillPanel(doc, definition, item, ctx.sound);
    entries.forEach((e) => { if (e.item === item) e.b.setAttribute("aria-current", "true"); else e.b.removeAttribute("aria-current"); });
  };
  const shown = () => entries.filter((e) => !e.li.hidden);
  if (entries[0]) show(entries[0].item);
  count.textContent = tn("ix.termCount", entries.length);
  if (ctx.editing) return;

  entries.forEach((e) => e.b.addEventListener("click", () => { show(e.item); ctx.sound?.play(e.item.id); }));
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    entries.forEach((e) => { e.li.hidden = q !== "" && !e.item.title.toLowerCase().includes(q); });
    const k = shown().length;
    count.textContent = k === 0 ? t("ix.noTermsMatch") : tn("ix.termCount", k);
  });
  letterButtons.forEach(({ ch, b }) => b.addEventListener("click", () => {
    if (b.getAttribute("aria-disabled") === "true") return;
    // A letter jumps to its first term, and clears a search that would hide it.
    if (search.value !== "") { search.value = ""; entries.forEach((e) => (e.li.hidden = false)); count.textContent = tn("ix.termCount", entries.length); }
    const hit = entries.find((e) => first(e.item) === ch);
    if (hit) { hit.b.focus(); hit.b.scrollIntoView({ block: "nearest" }); }
  }));
}

// ---- carousel and step process: one item at a time with Previous and Next

function buildCarousel(ctx: Ctx, steps: boolean): void {
  const { doc, c, root } = ctx;
  const n = c.items.length;
  if (!steps) root.setAttribute("aria-roledescription", t("ix.roleCarousel"));

  const stepList = steps ? make(doc, "ol", "os-ix-steps") : null;
  const stepButtons = c.items.map((item, i) => {
    if (!stepList) return null;
    const li = make(doc, "li");
    const b = btn(doc, "os-ix-step", { id: ctx.id(item, "b"), "aria-controls": ctx.id(item, "p") });
    const num = make(doc, "span", "os-ix-num", { "aria-hidden": "true" });
    num.textContent = String(i + 1);
    const label = make(doc, "span", "os-ix-title");
    label.textContent = item.title;
    // "Step 2: Title" for a screen reader, since the visible number is hidden from it.
    b.setAttribute("aria-label", t("ix.stepNamed", { n: i + 1, title: item.title }));
    b.append(num, label);
    li.appendChild(b);
    stepList.appendChild(li);
    return b;
  });

  const stage = make(doc, "div", "os-ix-slides");
  const panels = c.items.map((item, i) => {
    const p = make(doc, "div", "os-ix-panel", { id: ctx.id(item, "p"), role: steps ? "region" : "group", tabindex: "0" });
    if (steps) p.setAttribute("aria-labelledby", ctx.id(item, "b"));
    else { p.setAttribute("aria-roledescription", t("ix.roleSlide")); p.setAttribute("aria-label", t("ix.panelLabel", { n: i + 1, total: n, title: item.title })); }
    p.hidden = true;
    const h = make(doc, "h3", "os-ix-heading");
    h.textContent = item.title;
    p.appendChild(h);
    fillPanel(doc, p, item, ctx.sound);
    stage.appendChild(p);
    return p;
  });

  const bar = make(doc, "div", "os-ix-bar");
  const prev = btn(doc, "os-ix-nav");
  prev.textContent = steps ? t("ix.previousStep") : t("ix.previous");
  const next = btn(doc, "os-ix-nav");
  next.textContent = steps ? t("ix.nextStep") : t("ix.next");
  const status = make(doc, "span", "os-ix-status", { "aria-live": "polite", "aria-atomic": "true" });
  bar.append(prev, status, next);

  let at = 0;
  const show = (i: number, announce: boolean) => {
    at = Math.max(0, Math.min(n - 1, i));
    panels.forEach((p, j) => { p.hidden = j !== at; });
    stepButtons.forEach((b, j) => {
      if (!b) return;
      if (j === at) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
      b.classList.toggle("is-done", j < at);
    });
    prev.setAttribute("aria-disabled", String(at === 0));
    next.setAttribute("aria-disabled", String(at === n - 1));
    const text = steps ? t("ix.stepOf", { n: at + 1, total: n }) : t("ix.itemOf", { n: at + 1, total: n });
    // The live region is only filled by the learner's own action, so opening the slide is not noisy.
    status.textContent = announce ? t("ix.countNamed", { count: text, title: c.items[at]!.title }) : text;
  };

  if (stepList) root.appendChild(stepList);
  root.append(stage, bar);
  show(0, false);
  if (ctx.editing) return;
  const go = (to: number) => {
    if (to < 0 || to >= n) return;
    show(to, true);
    ctx.sound?.play(c.items[to]!.id);
  };
  prev.addEventListener("click", () => go(at - 1));
  next.addEventListener("click", () => go(at + 1));
  stepButtons.forEach((b, i) => b?.addEventListener("click", () => go(i)));
}
