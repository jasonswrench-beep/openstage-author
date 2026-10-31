// Draws one slide as real HTML elements, so native semantics (buttons, radio groups,
// headings, images with alt text) do the accessibility work.
//
// This is the single renderer. The published player and the editor's canvas both use it,
// and must never fork it. What differs is the `StageBehavior` each supplies: the player
// wires objects to the course runtime, the editor leaves them inert.

import { buildEmbed, buildMedia, buildScrollingText, buildTable, scrollableIfNeeded } from "./blocks.ts";
import { t } from "./playertext.ts";
import { buildInput, type InputChange } from "./inputs.ts";
import { HIDDEN_CLASS, Presenter, play, type Playing } from "./animation.ts";
import { blocksOf, blockWords, partOf, PART_HIDDEN_CLASS } from "./paragraphs.ts";
import { buildDownload } from "./downloads.ts";
import { buildTimer, type TimerInfo, type TimerView } from "./timer.ts";
import { buildInteraction, type ItemSound } from "./interactions.ts";
import type { DescriptionHost } from "./description.ts";
import { emptyMessage, isAnswered } from "./grading.ts";
import { buildQuestion } from "./questions.ts";
import { planReflow, seenSize, type ReflowNote } from "./reflow.ts";
import { buildScenario, type Move, type ScenarioSound } from "./scenario.ts";
import { buildCertificate, buildResults, type CourseInfo, type CourseResults } from "./results.ts";
import { buildLogo, logoFirst } from "./logo.ts";
import { bubbleParts, bubblePaddingCss, isBubbleKind, tailOf, type BubbleKind, type BubbleTail } from "./bubble.ts";
import { buildIcon, strokeWidthOf } from "./icon.ts";
import { buildEnlargeablePicture } from "./enlarge.ts";
import { lookLayers, spokenOnChange } from "./looks.ts";
import { appendSanitizedHtml } from "./sanitize.ts";
import { splitReferences, totalsFromResults, valueFor } from "./valuetext.ts";
import { backgroundCss, resolveStyle } from "./theme.ts";
import type { Character, Effect, IconContent, OSObject, QuizContent, Slide, Style, Theme, Variable } from "./types.ts";

export type Activation = "click" | "keyActivate";

export interface StageBehavior {
  /** Editing: objects are drawn but do nothing, and live regions are filled straight away. */
  editing?: boolean;
  onActivate?(obj: OSObject, via: Activation): void;
  /** Return null if nothing happened (no answer chosen). */
  /** A learner checked an answer, in the form grading.ts reads. Return null if nothing was checked. */
  onQuizSubmit?(obj: OSObject, answer: string, via: Activation): { locked: boolean } | null;
  quizStatus?(objectId: string): { choice: string | null; locked: boolean } | undefined;
  announce?(message: string): void;
  onMediaEnded?(objectId: string): void;
  /** A learner changed an input. */
  onInput?(obj: OSObject, change: InputChange): void;
  /** The current value of a variable, so an input shows what the learner chose before. */
  variableValue?(id: string): number | boolean | string | undefined;
  /** The course's variables, so a text that holds `{{Name}}` can show the value (see valuetext.ts). */
  variables?(): readonly Variable[];
  /** Where the learner stands in the quiz, for a results box and a certificate. */
  results?(): CourseResults | undefined;
  /** The course's title and language, for a certificate. */
  course?(): CourseInfo;
  /** The size in bytes of a file the course offers for download, if the host knows it. */
  fileSize?(path: string): number | undefined;
  /** Does this interaction item have audio the learner can start? */
  itemAudio?(objectId: string, itemId: string): boolean;
  /** Where the spoken form of one audio description of a video is, or null if it can only be read. */
  descriptionAudio?(objectId: string, cueId: string): string | null;
  /** A learner opened an interaction item, or asked to hear it: say it now. */
  playItem?(objectId: string, itemId: string): void;
  /** Say several items of one object (the lines of a scenario) one after another, in place of anything already being said. */
  playItems?(objectId: string, itemIds: string[]): void;
  /** The project's cast, for a scenario and a choice of character. */
  characters?(): Character[];
  /** Where the learner is in a scenario: the path saved with their progress, or "". */
  scenarioPath?(objectId: string): string;
  /** A learner made a choice in a scenario, or took one back. */
  onScenarioMove?(obj: OSObject, move: Move): void;
  /** The learner's own number for shuffling answers, as text, or undefined when there is none (the editor). */
  sessionSeed?(): string | undefined;
  /** A learner added time to a timer. */
  onTimerAddTime?(obj: OSObject): void;
  /** A learner turned a timer off. */
  onTimerOff?(obj: OSObject): void;
}

const COLOR_PROPS: Record<string, string> = { color: "color", fill: "background-color", background: "background-color" };
const COLOR_VALUE = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([0-9.,%\s/]+\)|[a-z]+)$/i;
const PX_PROPS: Record<string, string> = { fontSize: "font-size", radius: "border-radius", strokeWidth: "border-width", padding: "padding" };
const TEXT_PROPS: Record<string, string> = { fontFamily: "font-family", fontWeight: "font-weight", textAlign: "text-align", lineHeight: "line-height" };
const SAFE_TEXT = /^[\w\s,"'.-]+$/;

/** How long a layer that has just opened waits before the words in its live regions are put in, so that a screen reader has found the regions first. */
const LIVE_FILL_DELAY_MS = 350;

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
  /** The places in text where a value is shown, so they can be changed when it changes. */
  private valueSpans: { span: HTMLElement; name: string }[] = [];
  /** Shows a scenario's meters and character as they are now, by object id. */
  private scenarios = new Map<string, () => void>();
  /** The timers on the slide, by object id. */
  private timers = new Map<string, TimerView>();
  private section: HTMLElement | null = null;
  /** The slide that is leaving, kept over the new one while its exit plays, and the effect on the new slide's arrival. */
  private leaving: { el: HTMLElement; playing: Playing } | null = null;
  private arriving: Playing | null = null;
  /** The slide is shown in one column instead of on the fixed stage (see reflow.ts). */
  private reflow = false;
  /** What the one-column layout does with objects that sat on top of a panel or picture, by object id. */
  private reflowNotes = new Map<string, ReflowNote>();
  /** Watches the text boxes that shrink their words to fit, so they are fitted when they first have a size (a layer that opens, a box that is resized). */
  private readonly fitObserver: ResizeObserver | null;

  constructor(doc: Document, stageEl: HTMLElement, behavior: StageBehavior, theme: Theme) {
    this.doc = doc;
    this.stageEl = stageEl;
    this.behavior = behavior;
    this.theme = theme;
    const View = doc.defaultView as (Window & typeof globalThis) | null;
    this.fitObserver = View && typeof View.ResizeObserver === "function" ? new View.ResizeObserver((entries) => entries.forEach((e) => fitText(e.target as HTMLElement))) : null;
    // Fonts that arrive late change how much room the words take.
    void doc.fonts?.ready.then(() => { for (const m of this.mounted.values()) if (m.el.dataset["osFit"]) fitText(m.el); });
  }

  /** Use a different theme. The next render (or refresh of each object) shows it. */
  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  /**
   * Show the slide in one column, in reading order, instead of on the fixed stage. The player turns this on when the window is
   * narrow or the page is zoomed in, so nothing has to scroll sideways. The editor never does.
   */
  setReflow(on: boolean): void {
    if (on === this.reflow) return;
    this.reflow = on;
    this.stageEl.classList.toggle("os-reflow", on);
    for (const m of this.mounted.values()) {
      this.refresh(m);
      if (m.obj.type === "table" && !this.behavior.editing) scrollableIfNeeded(m.el);
      if (m.obj.type === "quizQuestion" && !this.behavior.editing) this.scrollRegion(m.el, m.obj.accessibility.altText);
    }
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
    this.valueSpans = [];
    this.scenarios.clear();
    this.timers.clear();
    this.reflowNotes.clear();
    for (const layer of [slide.baseLayer, ...slide.layers]) {
      for (const [id, note] of planReflow(layer.objects, this.theme)) this.reflowNotes.set(id, note);
    }

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

    // The theme's logo, if it has one, behind everything, in the page where the eye would meet it.
    const logo = this.theme.logo;
    if (logo && logoFirst(logo)) section.appendChild(buildLogo(doc, logo));
    for (const [i, layer] of [slide.baseLayer, ...slide.layers].entries()) {
      const visible = i === 0 || shown.has(layer.id);
      const layerEl = el(doc, "div", "os-layer");
      layerEl.dataset["layerId"] = layer.id;
      layerEl.hidden = !visible;
      this.layerEls.set(layer.id, layerEl);
      for (const obj of readingOrder(layer.objects)) layerEl.appendChild(this.buildObject(obj, layer.id, visible));
      section.appendChild(layerEl);
    }
    if (logo && !logoFirst(logo)) section.appendChild(buildLogo(doc, logo));
    this.stageEl.appendChild(section);
    return section;
  }

  /**
   * Hide an object because its time has not come, or has passed, or show it again. A separate switch from its layer and its
   * states, so none of them can undo another. A hidden object is not in the page for assistive technology or the keyboard.
   */
  setObjectTimed(objectId: string, visible: boolean, motion?: Effect): void {
    // A paragraph of a text (see paragraphs.ts) is timed on its own, under an id of its own.
    const part = partOf(objectId);
    if (part) {
      const block = this.paragraphs(part.objectId)[part.index];
      if (block) this.presenter.set(objectId, block, visible, motion, PART_HIDDEN_CLASS);
      return;
    }
    const el = this.mounted.get(objectId)?.el;
    if (el) this.presenter.set(objectId, el, visible, motion);
  }

  /** The paragraphs of a text object that is on the slide, in order (none for anything else). */
  private paragraphs(objectId: string): HTMLElement[] {
    const m = this.mounted.get(objectId);
    if (!m || m.obj.type !== "text") return [];
    return blocksOf(m.el.querySelector(".os-bubble-text") ?? m.el);
  }

  /** How many paragraphs a text object on the slide has, so a timing for more than that is not waited for. */
  paragraphCount(objectId: string): number {
    return this.paragraphs(objectId).length;
  }

  /** What one paragraph of a text says, for telling a learner it came or went. */
  paragraphWords(objectId: string, index: number): string {
    const block = this.paragraphs(objectId)[index];
    return block ? blockWords(block) : "";
  }

  /** Show a timer as it is now. */
  setTimer(objectId: string, info: TimerInfo): void {
    this.timers.get(objectId)?.update(info);
  }

  /** Stop every effect that is running now: what was arriving is there, and what was leaving is gone. */
  endAnimations(): void {
    this.presenter.endAll();
    this.endSlideChange();
  }

  /** The slide on the page now, if there is one: taken before a new slide is drawn, so its exit can play over its successor. */
  get currentSection(): HTMLElement | null {
    return this.section && this.stageEl.contains(this.section) ? this.section : null;
  }

  private endSlideChange(): void {
    this.arriving?.cancel();
    this.arriving = null;
    if (this.leaving) {
      this.leaving.playing.cancel();
      this.leaving.el.remove();
      this.leaving = null;
    }
  }

  /**
   * Play how a slide leaves and how the next one arrives. The slide that was on the page (`leaving`, taken before the new one was drawn) is put back over the new one,
   * with nothing in it to read or press, plays its exit, and is taken away when it is over; the new slide plays its entrance. Nothing waits for either: the new slide is
   * already there and working underneath. In one column there is no stage to move, so nothing plays.
   */
  slideChange(leaving: HTMLElement | null, exit: Effect | undefined, entering: HTMLElement, enter: Effect | undefined): void {
    this.endSlideChange();
    if (this.stageEl.classList.contains("os-reflow")) return;
    if (leaving && exit && exit.effect !== "none" && leaving !== entering) {
      // What is left of the old slide is a picture of it: not for assistive technology, not to be focused, not to be pressed, and silent.
      leaving.setAttribute("aria-hidden", "true");
      leaving.removeAttribute("role");
      leaving.removeAttribute("aria-label");
      leaving.tabIndex = -1;
      leaving.inert = true;
      leaving.style.pointerEvents = "none";
      for (const media of Array.from(leaving.querySelectorAll<HTMLMediaElement>("video, audio"))) media.pause();
      this.stageEl.appendChild(leaving);
      const playing = play(leaving, exit, "exit");
      if (playing) {
        this.leaving = { el: leaving, playing };
        void playing.finished.then(() => {
          if (this.leaving?.playing !== playing) return;
          playing.cancel();
          leaving.remove();
          this.leaving = null;
        });
      } else {
        leaving.remove();
      }
    }
    if (enter && enter.effect !== "none") {
      const playing = play(entering, enter, "enter");
      if (playing) {
        this.arriving = playing;
        void playing.finished.then(() => { if (this.arriving === playing) this.arriving = null; });
      }
    }
  }

  setLayerVisible(layerId: string, visible: boolean): void {
    const layerEl = this.layerEls.get(layerId);
    if (!layerEl) return;
    const fillers = this.fillers.get(layerId) ?? [];
    if (visible) {
      layerEl.hidden = false;
      // In one column a layer comes after the slide's own content, so bring it into view if it opened out of sight.
      if (this.reflow && typeof layerEl.scrollIntoView === "function") layerEl.scrollIntoView({ block: "nearest" });
      // Fill live regions after they are on screen, so assistive technology announces them. A frame is not long enough for the screen reader to
      // find a region that has only just appeared (NVDA 2026.2 said nothing for the feedback after an answer or for what a timer's layer says), so it waits a little.
      setTimeout(() => fillers.forEach((f) => this.fillText(f.el, f.html)), LIVE_FILL_DELAY_MS);
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

  /**
   * Show an object in one of its looks ("normal" is its own). Returns what a screen reader should be told, if the look has a message
   * and the object is there to be told about: nothing is said about something that is hidden, or is not changing.
   */
  setObjectState(objectId: string, state: string): string | null {
    const m = this.mounted.get(objectId);
    if (!m) return null;
    const said = spokenOnChange(m.obj.states, m.stateName, state);
    m.stateName = state;
    this.refresh(m);
    // An object that is not there (its layer is closed, or its timing has it out of the page) is not announced.
    return said !== null && !m.el.closest(`[hidden], .${HIDDEN_CLASS}`) ? said : null;
  }

  /** The video or audio element of a media object, or null if it has none (or is not on the slide). Used to follow the clip's time. */
  mediaElement(objectId: string): HTMLMediaElement | null {
    const node = this.mounted.get(objectId)?.el;
    if (!node) return null;
    if (node instanceof HTMLMediaElement) return node;
    return node.querySelector<HTMLMediaElement>("video, audio");
  }

  /** Put an author's words in a text object, with the values their references stand for (`{{Score}}`) in place of the references. */
  private fillText(host: HTMLElement, html: string): void {
    appendSanitizedHtml(host, html);
    if (!html.includes("{{")) return;
    const doc = this.doc;
    const walker = doc.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const found: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n as Text).data.includes("{{")) found.push(n as Text);
    for (const node of found) {
      const pieces = splitReferences(node.data);
      if (!pieces.some((p) => p.kind === "value")) continue;
      const parts: Node[] = pieces.map((p) => {
        if (p.kind === "words") return doc.createTextNode(p.text);
        const span = doc.createElement("span");
        span.className = "os-value";
        span.dataset["name"] = p.name;
        span.textContent = this.valueText(p.name);
        this.valueSpans.push({ span, name: p.name });
        return span;
      });
      node.replaceWith(...parts);
    }
  }

  /** What to show for one reference: its value now, or the reference itself if there is nothing by that name, so the mistake can be seen. */
  private valueText(name: string): string {
    const variables = this.behavior.variables?.() ?? [];
    const totals = () => totalsFromResults(this.behavior.results?.());
    const shown = valueFor(name, { variables, valueOf: (id) => this.behavior.variableValue?.(id) ?? variables.find((v) => v.id === id)?.initial, totals });
    return shown ?? `{{${name}}}`;
  }

  /** A variable changed, or a question was answered: every value on screen is written again, but only where it is different, so a screen reader hears a change once. */
  refreshValues(): void {
    this.valueSpans = this.valueSpans.filter((v) => v.span.isConnected);
    for (const { span, name } of this.valueSpans) {
      const now = this.valueText(name);
      if (span.textContent !== now) span.textContent = now;
    }
  }

  /** The course's variables changed: a scenario on screen shows its meters, and the character the learner chose, as they are now. */
  refreshScenarios(): void {
    for (const refresh of this.scenarios.values()) refresh();
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
        // A text bubble is words over a drawn bubble: the figure lies behind, and the words are in a box of their own that sits in the bubble's body.
        let host = node;
        const bubble = bubbleOf(obj);
        if (bubble) {
          node.classList.add("os-bubbled");
          node.appendChild(bubbleFigure(doc, bubble.kind, bubble.tail, obj.geometry.width, obj.geometry.height));
          host = el(doc, "div", "os-bubble-text");
          node.appendChild(host);
        }
        if (LIVE_ROLES.has(a.role)) {
          node.setAttribute("role", a.role);
          const list = this.fillers.get(layerId) ?? [];
          list.push({ el: host, html });
          this.fillers.set(layerId, list);
          if (layerVisible || this.behavior.editing) this.fillText(host, html);
        } else {
          this.fillText(host, html);
        }
        break;
      }
      case "image": {
        const img = el(doc, "img", "os-image") as HTMLImageElement;
        img.src = String(obj.content["src"] ?? "");
        img.alt = a.decorative ? "" : a.altText;
        // A picture the author let learners enlarge sits in a box with its button. The editor draws the picture alone, as it always did.
        node = obj.content["enlargeable"] === true && !a.decorative && !this.behavior.editing ? buildEnlargeablePicture(doc, img, obj) : img;
        break;
      }
      case "shape": {
        node = el(doc, "div", "os-shape");
        const bubble = bubbleOf(obj);
        node.appendChild(bubble ? bubbleFigure(doc, bubble.kind, bubble.tail, obj.geometry.width, obj.geometry.height) : shapeFigure(doc, String(obj.content["shape"] ?? "rectangle")));
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
        // A button can show an icon before its words. The words are its name, so the icon says nothing of its own.
        const icon = obj.type === "button" ? (obj.content["icon"] as IconContent | undefined) : undefined;
        if (icon && Array.isArray(icon.shapes)) {
          const svg = buildIcon(doc, icon);
          svg.classList.add("os-button-icon");
          b.classList.add("os-button-has-icon");
          b.textContent = "";
          if (obj.content["iconPlacement"] === "after") b.append(doc.createTextNode(label), svg);
          else b.append(svg, doc.createTextNode(label));
        }
        this.nameControl(b, label, a.altText);
        this.wireActivation(b, obj);
        node = b;
        break;
      }
      case "quizQuestion":
        node = this.buildQuiz(obj);
        break;
      case "icon": {
        // Drawn in the object's colour. A screen reader hears its alt text, or nothing if it is decoration (the generic code below hides it).
        const svg = buildIcon(doc, obj.content as unknown as IconContent, strokeWidthOf(obj.style["strokeWidth"]));
        svg.classList.add("os-icon");
        if (!a.decorative) {
          svg.setAttribute("role", "img");
          svg.setAttribute("aria-label", a.altText);
          svg.removeAttribute("aria-hidden");
        }
        node = svg as unknown as HTMLElement;
        break;
      }
      case "interaction":
        node = buildInteraction(doc, obj, !!this.behavior.editing, this.itemSound(obj));
        break;
      case "input":
        node = buildInput(doc, obj, {
          editing: !!this.behavior.editing,
          value: (id) => this.behavior.variableValue?.(id),
          onChange: (change) => this.behavior.onInput?.(obj, change),
          characters: () => this.behavior.characters?.() ?? [],
        });
        break;
      case "scenario": {
        const built = buildScenario(doc, obj, {
          editing: !!this.behavior.editing,
          cast: this.behavior.characters?.() ?? [],
          value: (id) => this.behavior.variableValue?.(id),
          path: () => this.behavior.scenarioPath?.(obj.id) ?? "",
          onMove: (move) => this.behavior.onScenarioMove?.(obj, move),
          announce: (message) => this.behavior.announce?.(message),
          sound: this.scenarioSound(obj),
        });
        this.scenarios.set(obj.id, built.refresh);
        node = built.el;
        break;
      }
      case "table":
        node = buildTable(doc, obj, !!this.behavior.editing);
        break;
      case "scrollingText":
        node = buildScrollingText(doc, obj, !!this.behavior.editing);
        break;
      case "video":
      case "audio":
        node = buildMedia(doc, obj, (id) => this.behavior.onMediaEnded?.(id), this.descriptionHost(obj));
        break;
      case "embed":
        node = buildEmbed(doc, obj, !!this.behavior.editing);
        break;
      case "timer": {
        const view = buildTimer(doc, obj, { editing: !!this.behavior.editing, addTime: () => this.behavior.onTimerAddTime?.(obj), turnOff: () => this.behavior.onTimerOff?.(obj) });
        this.timers.set(obj.id, view);
        node = view.el;
        break;
      }
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

  /** Where a video's audio descriptions are spoken from: nothing in the editor, and nothing where the host cannot say where the audio is. */
  private descriptionHost(obj: OSObject): DescriptionHost | undefined {
    const behavior = this.behavior;
    if (behavior.editing || !behavior.descriptionAudio || obj.type !== "video") return undefined;
    const doc = this.doc;
    return {
      audioUrl: (cueId) => behavior.descriptionAudio?.(obj.id, cueId) ?? null,
      makeAudio: (url) => {
        const audio = doc.createElement("audio");
        audio.preload = "auto";
        audio.src = url;
        return audio;
      },
    };
  }

  /** How a scenario speaks its lines: nothing in the editor, and nothing where the host cannot play audio. */
  private scenarioSound(obj: OSObject): ScenarioSound | undefined {
    const behavior = this.behavior;
    if (behavior.editing || !behavior.playItems) return undefined;
    return {
      has: (lineId) => behavior.itemAudio?.(obj.id, lineId) ?? false,
      play: (lineIds) => behavior.playItems?.(obj.id, lineIds),
    };
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

  /** A question of any kind: its controls (see questions.ts), and the button that checks them. */
  private buildQuiz(obj: OSObject): HTMLElement {
    const doc = this.doc;
    const q = obj.content as unknown as QuizContent;
    const view = buildQuestion(doc, obj, { editing: !!this.behavior.editing, announce: (m) => this.behavior.announce?.(m), seed: this.behavior.sessionSeed?.() });
    const check = button(doc, t("quiz.check"), "os-button os-quiz-check");
    view.el.appendChild(check);
    if (this.behavior.editing) return view.el;

    // A resumed attempt shows the answer the learner gave, and stays locked if it was.
    const saved = this.behavior.quizStatus?.(obj.id);
    if (saved) {
      if (saved.choice) view.setAnswer(saved.choice);
      if (saved.locked) {
        view.lock();
        check.setAttribute("aria-disabled", "true");
      }
    }

    check.addEventListener("click", (e) => {
      if (check.getAttribute("aria-disabled") === "true") return;
      const answer = view.answer();
      if (answer === null || !isAnswered(q, answer)) {
        this.behavior.announce?.(emptyMessage(q));
        return;
      }
      const outcome = this.behavior.onQuizSubmit?.(obj, answer, activation(e));
      if (outcome?.locked) {
        check.setAttribute("aria-disabled", "true");
        view.lock();
      }
    });
    // A question taller than its box scrolls, and then the keyboard must be able to reach the scrolling.
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => this.scrollRegion(view.el, obj.accessibility.altText));
    return view.el;
  }

  /** Make a box that scrolls a stop for the keyboard, named so a screen reader can say what it is. Looked at again when the page changes shape. */
  private scrollRegion(box: HTMLElement, name: string): void {
    if (box.scrollHeight <= box.clientHeight + 1 && box.scrollWidth <= box.clientWidth + 1) return;
    box.tabIndex = 0;
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", name);
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
    // The size the author gave, for the one-column layout, where a picture or video keeps its shape but fills the width.
    const seen = seenSize(m.obj);
    set("--os-w", `${seen.width}px`);
    set("--os-ar", `${seen.width} / ${Math.max(1, seen.height)}`);

    const theme = this.theme;
    const layers: Style[] = [resolveStyle(theme, obj.style), ...lookLayers(obj.states, { name: m.stateName, visited: m.visited, hover: m.hover }).map((s) => resolveStyle(theme, s))];
    const bubble = bubbleOf(obj);
    if (bubble) {
      // The figure is drawn again at the box's size, so its tail stays the same size and its circles stay round however the box is stretched.
      const fig = Array.from(node.children).find((c) => (c.getAttribute("class") ?? "").split(/\s+/).includes("os-bubble-fig"));
      if (fig) drawBubble(this.doc, fig as SVGSVGElement, bubble.kind, bubble.tail, g.width, g.height);
    }
    if (obj.type === "shape") {
      // Fill and outline belong to the drawn figure. The box around it must stay transparent,
      // or a circle would sit in a square of colour.
      const own = ["fill", "background", "stroke", "strokeWidth", "radius"];
      for (const style of layers) applyStyle(node, Object.fromEntries(Object.entries(style).filter(([k]) => !own.includes(k))));
      applyShapeStyle(node, Object.assign({}, ...layers) as Style);
    } else if (bubble) {
      // A text bubble: the colour behind the words, and the outline, belong to the drawn bubble. The words keep their own colour, font and size.
      // The room round the words is worked out from the bubble, so they sit in its body and not its tail.
      const own = ["fill", "background", "stroke", "strokeWidth", "radius", "padding"];
      for (const style of layers) applyStyle(node, Object.fromEntries(Object.entries(style).filter(([k]) => !own.includes(k))));
      const merged = Object.assign({}, ...layers) as Style;
      applyShapeStyle(node, merged);
      set("padding", bubblePaddingCss(bubble.kind, g.width, g.height));
      // For the one-column layout, which paints a plain rounded box in place of the figure.
      const paint = (v: unknown) => (typeof v === "string" && COLOR_VALUE.test(v) && v !== "none" ? v : "");
      const fill = paint(merged["fill"] ?? merged["background"]);
      const stroke = paint(merged["stroke"]);
      if (fill) set("--os-bubble-fill", fill);
      if (stroke) set("--os-bubble-stroke", stroke);
    } else if (obj.type === "interaction" || obj.type === "table" || obj.type === "scrollingText" || obj.type === "input" || obj.type === "embed" || obj.type === "results" || obj.type === "certificate" || obj.type === "download" || obj.type === "scenario" || obj.type === "timer") {
      // An interaction, table or scrolling text box paints itself in the theme's colours, which are known to read well together,
      // so only the font and its size can be changed.
      for (const style of layers) applyStyle(node, Object.fromEntries(Object.entries(style).filter(([k]) => k === "fontFamily" || k === "fontSize")));
    } else {
      for (const style of layers) applyStyle(node, style);
      if (obj.type === "text") this.applyTextBox(m, Object.assign({}, ...layers) as Style);
    }

    const disabled = m.stateName === "disabled";
    if (node instanceof HTMLButtonElement) node.disabled = disabled;
    else if (disabled) node.setAttribute("aria-disabled", "true");
    this.applyReflow(m);
  }

  /**
   * The parts of a text object's style that are about the box and not the words: the room round them, the line they sit on (top, middle or bottom),
   * the space between paragraphs, and shrinking when they do not fit. Words and their colour, size and font are done by `applyStyle`.
   */
  private applyTextBox(m: Mounted, style: Style): void {
    const node = m.el;
    const number = (key: string) => (typeof style[key] === "number" ? Number(style[key]) : undefined);
    const across = style["verticalAlign"];
    if (across === "middle" || across === "bottom") {
      node.style.setProperty("display", "flex");
      node.style.setProperty("flex-direction", "column");
      node.style.setProperty("justify-content", across === "middle" ? "center" : "flex-end");
    }
    const x = number("paddingX");
    const y = number("paddingY");
    if (x !== undefined || y !== undefined) node.style.setProperty("padding", `${y ?? 0}px ${x ?? 0}px`);
    const gap = number("paragraphSpacing");
    node.classList.toggle("os-spaced", gap !== undefined);
    if (gap !== undefined) node.style.setProperty("--os-gap", `${gap}px`);
    const nest = number("nestedSize");
    node.classList.toggle("os-nested", nest !== undefined && nest > 0);
    if (nest !== undefined && nest > 0) node.style.setProperty("--os-nest", String(nest));
    // A weight the author chose for a text applies to its headings too.
    node.classList.toggle("os-weighted", style["fontWeight"] !== undefined);
    const fit = style["autoFit"] === "shrink" && !this.reflow;
    if (fit) {
      const own = /^([0-9.]+)px$/.exec(node.style.fontSize);
      node.dataset["osFit"] = own ? own[1]! : "";
      this.fitObserver?.observe(node);
      fitText(node);
    } else {
      delete node.dataset["osFit"];
      this.fitObserver?.unobserve(node);
    }
  }

  /** In one column, leave out a decorative backdrop and paint a colour behind text that sat on a panel or picture. */
  private applyReflow(m: Mounted): void {
    const note = this.reflow ? this.reflowNotes.get(m.obj.id) : undefined;
    m.el.classList.toggle("os-reflow-hide", !!note?.hide);
    // An object that has a fill of its own keeps it.
    const backed = !!note?.backdrop && m.el.style.backgroundColor === "" && !m.el.classList.contains("os-bubbled");
    m.el.classList.toggle("os-reflow-backed", backed);
    if (backed) m.el.style.setProperty("background-color", note!.backdrop!);
    // Type drawn for a wide stage is too big for a narrow screen. Titles are capped at about nine hundredths of the window's width and
    // body-sized text at seven, so a heading stays larger than the text under it. Small type is left alone.
    if (this.reflow) {
      const px = /^([0-9.]+)px$/.exec(m.el.style.fontSize);
      if (px && Number(px[1]) > 22) m.el.style.setProperty("font-size", `min(${px[1]}px, ${Number(px[1]) >= 40 ? 9 : 7}vw)`);
    }
  }
}

// ---- helpers shared with the player and editor

/**
 * Shrink a text box's words until they fit its height, as PowerPoint's "shrink text on overflow" does: the size the author chose is the biggest it
 * gets, and it never goes below half that or 12 pixels (whichever is the larger, but never above the size chosen), so the words stay readable.
 * Does nothing while the box has no size (it is on a layer that is not showing); the box is fitted when it gets one.
 */
export function fitText(el: HTMLElement): void {
  const marked = el.dataset["osFit"];
  if (marked === undefined || el.clientHeight === 0) return;
  const view = el.ownerDocument.defaultView;
  const measured = marked === "" ? 0 : Number(marked);
  let base = measured;
  if (!(base > 0)) {
    el.style.removeProperty("font-size");
    base = view ? parseFloat(view.getComputedStyle(el).fontSize) : NaN;
    if (!(base > 0)) return;
    el.dataset["osFit"] = String(base);
  }
  const justify = el.style.getPropertyValue("justify-content");
  // Words that sit in the middle or at the bottom run off both ends when there are too many, so measure them from the top.
  if (justify) el.style.setProperty("justify-content", "flex-start");
  const fits = () => el.scrollHeight <= el.clientHeight + 1;
  el.style.setProperty("font-size", `${base}px`);
  if (!fits()) {
    const floor = Math.min(base, Math.max(base * 0.5, 12));
    let lo = floor;
    let hi = base;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      el.style.setProperty("font-size", `${mid}px`);
      if (fits()) lo = mid; else hi = mid;
    }
    el.style.setProperty("font-size", `${lo}px`);
  }
  if (justify) el.style.setProperty("justify-content", justify);
}

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
export const SHAPE_KINDS = ["rectangle", "rounded", "ellipse", "triangle", "diamond", "arrow", "speech", "thought"] as const;
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

/** The bubble an object draws, if it draws one: a shape that is a speech or thought bubble, or text with a `bubble` in its content. The tail is on the left unless it says right. */
function bubbleOf(obj: OSObject): { kind: BubbleKind; tail: BubbleTail } | null {
  const kind = obj.type === "shape" ? obj.content["shape"] : obj.type === "text" ? obj.content["bubble"] : undefined;
  return isBubbleKind(kind) ? { kind, tail: tailOf(obj.content["tail"]) } : null;
}

/** A bubble, drawn at the size of its box, with a view box the same size so nothing is stretched. */
function bubbleFigure(doc: Document, kind: BubbleKind, tail: BubbleTail, width: number, height: number): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "os-bubble-fig");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  drawBubble(doc, svg, kind, tail, width, height);
  return svg;
}

/** Draw (or draw again) a bubble in its figure. */
function drawBubble(doc: Document, svg: SVGSVGElement, kind: BubbleKind, tail: BubbleTail, width: number, height: number): void {
  const drawing = bubbleParts(kind, tail, width, height);
  svg.setAttribute("viewBox", drawing.viewBox);
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  for (const f of drawing.figures) {
    const part = doc.createElementNS(SVG_NS, f.tag);
    if (f.tag === "path") part.setAttribute("d", f.d);
    else for (const [k, v] of Object.entries(f)) if (k !== "tag") part.setAttribute(k, String(v));
    part.setAttribute("class", "os-shape-fig");
    part.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(part);
  }
}

function applyShapeStyle(node: HTMLElement, style: Style): void {
  const color = (v: unknown) => (typeof v === "string" && COLOR_VALUE.test(v) && v !== "none" ? v : "none");
  const stroke = color(style["stroke"]);
  const width = typeof style["strokeWidth"] === "number" ? style["strokeWidth"] : 2;
  // A bubble is several pieces (a thought bubble's circles), and they are all painted alike.
  for (const fig of Array.from(node.querySelectorAll(".os-shape-fig"))) {
    fig.setAttribute("fill", color(style["fill"] ?? style["background"]));
    fig.setAttribute("stroke", stroke);
    fig.setAttribute("stroke-width", stroke === "none" ? "0" : String(Math.max(0, width)));
  }
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
