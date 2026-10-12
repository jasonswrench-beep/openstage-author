// The editor's data and every change it can make. No screen code lives here, so all of it
// is tested directly. The view only asks the model to do things and redraws when told.

import { ITEM_LIMITS } from "../../player/src/interactions.ts";
import { readingOrder, SHAPE_KINDS } from "../../player/src/stage.ts";
import { isThemeRef, themeRefKnown } from "../../player/src/theme.ts";
import type { CertificateContent, Condition, CreditEntry, Primitive, InputContent, InteractionContent, InteractionItem, Layer, OSObject, Project, QuizContent, ResultsContent, Slide, Style, TableContent, Theme, Timing, Variable, Effect } from "../../player/src/types.ts";
import { INPUT_VARIABLE_TYPE } from "../../player/src/inputs.ts";
import { cloneTheme, DEFAULT_THEME } from "./themes.ts";
import { BLOCK_SIZES, buildActivation, buildBody, defaultValueFor, eventsFor, operatorsFor, parseVideoAddress, readRules, writeRules, type Rule, type RuleAction, type RuleItem, buildSimpleText, isFontValue, isHexColor, readActivation, type Activation, type SimpleText, type TextBlock } from "./content.ts";
import { buildLayoutSlide, buildQuiz, emptyLayer, emptySlide, interactionById, inputById, layOut, newDownload, newEmbed, newInput, newMedia, newInteraction, newInteractionItem, newObject, slugOf, SLIDE_LAYOUTS, textRole, toneOf, type Alloc, type NewKind, type QuizType } from "./factory.ts";
import { colorRef, contrastOf } from "./colors.ts";
import { describeAnimation, validDuration, type Phase } from "./animation.ts";
import { EFFECTS } from "../../player/src/animation.ts";
import { describeTiming, MAX_MS, plainSeconds } from "./timing.ts";
import { downloadScript, isValidIpa, itemScript, langForVoice, newNarration, SPEED_MAX, SPEED_MIN, VOICES, voiceOption, type Narration } from "./narration.ts";

/** The format version this editor reads and writes. */
export const FORMAT_VERSION = "0.14.0";

export interface OpenedProject {
  dir: string;
  /** project.json as it is on disk. */
  project: string;
  /** theme.json as it is on disk, or null if the project has none. */
  theme: string | null;
  /** assets.json (where assets came from) as it is on disk, or null if the project has none. */
  assets?: string | null;
  slides: { id: string; text: string }[];
}

export interface FileText {
  path: string;
  text: string;
}

export interface Selection {
  slideId: string;
  layerId: string;
  objectId: string | null;
}

/** Something that has narration, with where it is, for the Narration dialog: an object, or one item of an interaction. */
export interface NarratedObject {
  slideId: string;
  slideName: string;
  layerId: string;
  layerName: string;
  object: OSObject;
  /** What the speech tool and the published course call it: the object's id, or "<object id>/<item id>" for an item. */
  key: string;
  /** The interaction item the narration belongs to, or null when it is the object's own. */
  item: InteractionItem | null;
  narration: Narration;
}

export type ChangeKind = "selection" | "geometry" | "content" | "structure" | "saved";
export interface Change {
  kind: ChangeKind;
  objectId?: string;
}

type Geometry = OSObject["geometry"];
type Accessibility = OSObject["accessibility"];

interface Doc {
  id: string;
  slide: Slide;
  /** The file as read from disk, kept so unchanged files are never rewritten. */
  originalText: string;
  /** Compact form of what was last saved, for telling real changes from reformatting. A slide
   *  that has never been saved has "", so it always counts as changed. */
  savedCompact: string;
}

/** The one way every file is written, so a saved project diffs cleanly. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

const MAX_HISTORY = 200;
const COALESCE_MS = 700;

const nextNumber = (ids: string[], prefix: string): number =>
  ids.reduce((max, id) => {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0) + 1;

export class Model {
  readonly dir: string;
  readonly project: Project;
  /** The project's design. Objects can refer to its colours and fonts by name. */
  theme: Theme;
  private projectText: string;
  private projectSaved: string;
  private themeText: string;
  private themeSaved: string;
  private assetsText: string;
  private assetsSaved: string;
  /** Where the project's assets came from, as kept in assets.json. */
  assets: CreditEntry[];
  private docs: Doc[];
  /** Slide ids that have a file on disk right now. */
  private onDisk: Set<string>;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private lastKey = "";
  private lastTime = 0;
  private gestureStart: string | null = null;
  private listeners: ((c: Change) => void)[] = [];
  sel: Selection;

  constructor(opened: OpenedProject) {
    this.dir = opened.dir;
    this.projectText = opened.project;
    this.project = JSON.parse(opened.project) as Project;
    this.projectSaved = JSON.stringify(this.project);
    // A project with no theme file looks like the Classic theme, and only gets a file if the
    // author changes the theme.
    this.theme = opened.theme ? (JSON.parse(opened.theme) as Theme) : cloneTheme(DEFAULT_THEME);
    this.themeText = opened.theme ?? "";
    this.themeSaved = JSON.stringify(this.theme);
    this.assetsText = opened.assets ?? "";
    this.assets = opened.assets ? (JSON.parse(opened.assets) as { assets: CreditEntry[] }).assets : [];
    this.assetsSaved = JSON.stringify(this.assets);
    this.docs = opened.slides.map((s) => {
      const slide = JSON.parse(s.text) as Slide;
      return { id: s.id, slide, originalText: s.text, savedCompact: JSON.stringify(slide) };
    });
    this.onDisk = new Set(this.docs.map((d) => d.id));
    const first = this.docs[0]?.slide;
    this.sel = { slideId: first?.id ?? "", layerId: first?.baseLayer.id ?? "", objectId: null };
  }

  on(listener: (c: Change) => void): void {
    this.listeners.push(listener);
  }

  private emit(c: Change): void {
    for (const l of this.listeners) l(c);
  }

  // ---- reading

  get slides(): Slide[] {
    return this.docs.map((d) => d.slide);
  }

  get slide(): Slide | undefined {
    return this.docs.find((d) => d.slide.id === this.sel.slideId)?.slide;
  }

  get layers(): Layer[] {
    const s = this.slide;
    return s ? [s.baseLayer, ...s.layers] : [];
  }

  get layer(): Layer | undefined {
    return this.layers.find((l) => l.id === this.sel.layerId);
  }

  /** Objects of the layer being edited, in reading (and tab) order. */
  get objects(): OSObject[] {
    return this.layer ? readingOrder(this.layer.objects) : [];
  }

  get object(): OSObject | null {
    return this.layer?.objects.find((o) => o.id === this.sel.objectId) ?? null;
  }

  /** Locate an object anywhere in the project, for jumping from a problem to its source. */
  locate(slideId: string, objectId: string): { layerId: string } | null {
    const slide = this.docs.find((d) => d.slide.id === slideId)?.slide;
    if (!slide) return null;
    for (const layer of [slide.baseLayer, ...slide.layers]) {
      if (layer.objects.some((o) => o.id === objectId)) return { layerId: layer.id };
    }
    return null;
  }

  describe(obj: OSObject): string {
    const g = obj.geometry;
    return `${obj.name}, ${obj.type}, at ${g.x}, ${g.y}, size ${g.width} by ${g.height}`;
  }

  // ---- selection

  selectSlide(id: string): void {
    const slide = this.docs.find((d) => d.slide.id === id)?.slide;
    if (!slide || slide.id === this.sel.slideId) return;
    this.sel = { slideId: id, layerId: slide.baseLayer.id, objectId: null };
    this.emit({ kind: "selection" });
  }

  selectLayer(id: string): void {
    if (!this.layers.some((l) => l.id === id) || id === this.sel.layerId) return;
    this.sel = { ...this.sel, layerId: id, objectId: null };
    this.emit({ kind: "selection" });
  }

  selectObject(id: string | null): void {
    if (id !== null && !this.layer?.objects.some((o) => o.id === id)) return;
    if (id === this.sel.objectId) return;
    this.sel = { ...this.sel, objectId: id };
    this.emit({ kind: "selection", ...(id ? { objectId: id } : {}) });
  }

  /** Select an object wherever it is, switching slide and layer as needed. */
  reveal(slideId: string, objectId: string): boolean {
    const where = this.locate(slideId, objectId);
    if (!where) return false;
    this.sel = { slideId, layerId: where.layerId, objectId };
    this.emit({ kind: "selection", objectId });
    return true;
  }

  // ---- changes to one object

  private find(objectId: string): OSObject | undefined {
    return this.layer?.objects.find((o) => o.id === objectId);
  }

  setGeometry(objectId: string, patch: Partial<Geometry>, key = ""): string | null {
    const obj = this.find(objectId);
    if (!obj) return null;
    const next = { ...obj.geometry };
    for (const [k, v] of Object.entries(patch) as [keyof Geometry, number][]) {
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      next[k] = Math.round(v * 100) / 100;
    }
    if (next.width < 0 || next.height < 0) return null;
    if (JSON.stringify(next) === JSON.stringify(obj.geometry)) return null;
    this.record(key);
    obj.geometry = next;
    this.emit({ kind: "geometry", objectId });
    return this.describe(obj);
  }

  nudge(dx: number, dy: number): string | null {
    const o = this.object;
    return o ? this.setGeometry(o.id, { x: o.geometry.x + dx, y: o.geometry.y + dy }, `move:${o.id}`) : null;
  }

  resizeBy(dw: number, dh: number): string | null {
    const o = this.object;
    if (!o) return null;
    const width = Math.max(1, o.geometry.width + dw);
    const height = Math.max(1, o.geometry.height + dh);
    return this.setGeometry(o.id, { width, height }, `size:${o.id}`);
  }

  /** Edits made as one drag: many setGeometry calls, one undo step. */
  beginGesture(): void {
    this.gestureStart = this.snapshot();
  }

  endGesture(): void {
    const before = this.gestureStart;
    this.gestureStart = null;
    if (before !== null && before !== this.snapshot()) this.pushUndo(before);
  }

  setAccessibility(objectId: string, patch: Partial<Accessibility>): string | null {
    const obj = this.find(objectId);
    if (!obj) return null;
    const next = { ...obj.accessibility, ...patch };
    if (next.tabOrder !== null && (!Number.isInteger(next.tabOrder) || next.tabOrder < 0)) return null;
    if (JSON.stringify(next) === JSON.stringify(obj.accessibility)) return null;
    this.record(`a11y:${objectId}:${Object.keys(patch).join(",")}`);
    obj.accessibility = next;
    this.emit({ kind: "content", objectId });
    return `${obj.name} updated`;
  }

  setName(objectId: string, name: string): string | null {
    const obj = this.find(objectId);
    if (!obj || name.trim() === "" || name === obj.name) return null;
    this.record(`name:${objectId}`);
    obj.name = name;
    this.emit({ kind: "structure", objectId });
    return `Renamed to ${name}`;
  }

  /** Replace the HTML of a text object with a simple block of plain text. */
  setText(objectId: string, text: SimpleText): string | null {
    const obj = this.find(objectId);
    if (!obj || obj.type !== "text") return null;
    const html = buildSimpleText(text);
    if (obj.content["html"] === html) return null;
    this.record(`text:${objectId}`);
    obj.content = { ...obj.content, html };
    this.emit({ kind: "content", objectId });
    return "Text updated";
  }

  /**
   * Change a text object to a paragraph or a heading level. The font size changes with it, to the
   * usual size for that level, as one undo step. The author can change the size afterwards.
   */
  setBlock(objectId: string, block: TextBlock, text: string): string | null {
    const obj = this.find(objectId);
    if (!obj || obj.type !== "text") return null;
    const html = buildSimpleText({ block, text });
    const fontSize = BLOCK_SIZES[block];
    if (obj.content["html"] === html && obj.style["fontSize"] === fontSize) return null;
    this.record(`block:${objectId}`);
    obj.content = { ...obj.content, html };
    // Text that follows the theme's fonts uses the heading font for headings and the body font for paragraphs.
    const font: Style = isThemeRef(obj.style["fontFamily"]) ? { fontFamily: block === "p" ? "theme:font.body" : "theme:font.heading" } : {};
    obj.style = { ...obj.style, fontSize, ...font };
    this.emit({ kind: "content", objectId });
    return `${block === "p" ? "Paragraph" : `Heading ${block.slice(1)}`}, font size ${fontSize}`;
  }

  /** Change which shape a shape object draws. */
  setShape(objectId: string, shape: string): string | null {
    const obj = this.find(objectId);
    if (!obj || obj.type !== "shape" || !SHAPE_KINDS.includes(shape as (typeof SHAPE_KINDS)[number]) || obj.content["shape"] === shape) return null;
    this.record(`shape:${objectId}`);
    obj.content = { ...obj.content, shape };
    this.emit({ kind: "structure", objectId });
    return `Shape changed to ${shape}`;
  }

  /** Replace the HTML of a text object directly, for text with formatting the simple editor cannot handle. */
  setHtml(objectId: string, html: string): string | null {
    const obj = this.find(objectId);
    if (!obj || obj.type !== "text" || html.trim() === "" || obj.content["html"] === html) return null;
    this.record(`html:${objectId}`);
    obj.content = { ...obj.content, html };
    this.emit({ kind: "content", objectId });
    return "Text updated";
  }

  setLabel(objectId: string, label: string): string | null {
    const obj = this.find(objectId);
    if (!obj || obj.type !== "button" || label.trim() === "" || obj.content["label"] === label) return null;
    this.record(`label:${objectId}`);
    obj.content = { ...obj.content, label };
    this.emit({ kind: "content", objectId });
    return "Label updated";
  }

  /** Set one style value. An empty string removes it. Returns an explanation if it is refused. */
  setStyle(objectId: string, key: "color" | "fill" | "fontSize" | "fontFamily" | "stroke" | "strokeWidth", value: string): { ok: boolean; message: string } {
    const obj = this.find(objectId);
    if (!obj) return { ok: false, message: "" };
    const style: Style = { ...obj.style };
    const v = value.trim();
    if (v === "") delete style[key];
    else if (isThemeRef(v)) {
      // A reference to the theme: a colour for a colour property, a font for the font, and it must exist.
      const wanted = key === "fontFamily" ? "theme:font." : "theme:color.";
      if (key === "fontSize" || key === "strokeWidth" || !v.startsWith(wanted) || !this.knows(v)) {
        return { ok: false, message: "That theme colour or font does not exist in this theme." };
      }
      style[key] = v;
    } else if (key === "strokeWidth") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 40) return { ok: false, message: "Outline width must be a number from 0 to 40." };
      style[key] = n;
    } else if (key === "stroke" && v === "none") style[key] = "none";
    else if (key === "fontFamily") {
      if (!isFontValue(v)) return { ok: false, message: "That is not a usable font name." };
      style[key] = v;
    } else if (key === "fontSize") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 6 || n > 200) return { ok: false, message: "Font size must be a number from 6 to 200." };
      style[key] = n;
    } else {
      if (!isHexColor(v)) return { ok: false, message: "Colour must be a hex code such as #1a1a1a." };
      style[key] = v;
    }
    if (JSON.stringify(style) === JSON.stringify(obj.style)) return { ok: true, message: "" };
    this.record(`style:${objectId}:${key}`);
    obj.style = style;
    this.emit({ kind: "content", objectId });
    return { ok: true, message: "Style updated" };
  }

  activationOf(obj: OSObject): Activation {
    return readActivation(obj.triggers);
  }

  /** Set what a button does when activated. Always writes the click and the keyboard trigger together. */
  setActivation(objectId: string, action: Exclude<Activation, { kind: "custom" }>): string | null {
    const obj = this.find(objectId);
    if (!obj || obj.type !== "button") return null;
    if (readActivation(obj.triggers).kind === "custom") return null;
    const triggers = buildActivation(action);
    if (JSON.stringify(triggers) === JSON.stringify(obj.triggers)) return null;
    this.record(`act:${objectId}`);
    obj.triggers = triggers;
    this.emit({ kind: "content", objectId });
    return "Button action updated";
  }

  /**
   * Move an object earlier (-1) or later (+1) in reading order. This is also the tab order,
   * so the tab orders of the layer's tabbable objects are renumbered 1, 2, 3 and so on.
   */
  reorder(objectId: string, delta: -1 | 1): string | null {
    const layer = this.layer;
    const obj = layer?.objects.find((o) => o.id === objectId);
    if (!layer || !obj) return null;
    const tabbed = readingOrder(layer.objects).filter((o) => (o.accessibility.tabOrder ?? 0) >= 1);
    const at = tabbed.findIndex((o) => o.id === objectId);
    if (at === -1) return `${obj.name} is not in the tab order, so it has no place in the reading order.`;
    const to = at + delta;
    if (to < 0 || to >= tabbed.length) return delta < 0 ? `${obj.name} is already first.` : `${obj.name} is already last.`;
    this.record("");
    [tabbed[at], tabbed[to]] = [tabbed[to]!, tabbed[at]!];
    tabbed.forEach((o, i) => (o.accessibility = { ...o.accessibility, tabOrder: i + 1 }));
    this.emit({ kind: "structure", objectId });
    return `${obj.name} is now number ${to + 1} of ${tabbed.length} in reading order`;
  }

  // ---- adding and removing objects

  private allObjectIds(): string[] {
    return this.docs.flatMap((d) => [d.slide.baseLayer, ...d.slide.layers].flatMap((l) => l.objects.map((o) => o.id)));
  }

  /** Ids no one else is using, for objects and for layers on one slide. */
  private allocator(slide?: Slide): Alloc {
    const used = new Set(this.allObjectIds());
    const layers = new Set((slide ? [slide.baseLayer, ...slide.layers] : this.layers).map((l) => l.id));
    return {
      object: () => {
        const id = `obj-${String(nextNumber([...used], "obj-")).padStart(4, "0")}`;
        used.add(id);
        return id;
      },
      layer: () => {
        const id = `layer-${nextNumber([...layers], "layer-")}`;
        layers.add(id);
        return id;
      },
    };
  }

  private placement(id: string) {
    const objs = this.layer?.objects ?? [];
    return {
      id,
      tone: this.tone(),
      count: objs.length,
      z: objs.reduce((m, o) => Math.max(m, o.geometry.z), 0) + 10,
      tabOrder: objs.reduce((m, o) => Math.max(m, o.accessibility.tabOrder ?? 0), 0) + 1,
    };
  }

  /** Add an object to the layer being edited, and select it. */
  addObject(kind: NewKind, opts: { imageSrc?: string; size?: { w: number; h: number }; shape?: string } = {}): OSObject | null {
    const layer = this.layer;
    if (!layer) return null;
    const obj = newObject(kind, this.placement(this.allocator().object()), opts);
    this.record("");
    layer.objects.push(obj);
    this.sel = { ...this.sel, objectId: obj.id };
    this.emit({ kind: "structure", objectId: obj.id });
    return obj;
  }

  /**
   * Add a question to the layer being edited: its prompt, its answers, and two feedback layers
   * on the slide, all wired together. Selects the question.
   */
  addQuiz(type: QuizType): OSObject | null {
    const layer = this.layer;
    const slide = this.slide;
    if (!layer || !slide) return null;
    const alloc = this.allocator();
    const where = this.placement("");
    // Below what is already on the layer, as far as the slide has room. A question needs about 370 of the 720 height.
    const bottom = layer.objects.reduce((m, o) => Math.max(m, o.geometry.y + o.geometry.height), 0);
    const built = buildQuiz(type, alloc, { tone: this.tone(), y: layer.objects.length === 0 ? 60 : Math.min(bottom + 24, this.project.stage.height - 370), z: where.z, tab: where.tabOrder });
    this.record("");
    layer.objects.push(...built.objects);
    slide.layers.push(...built.layers);
    const quiz = built.objects[1]!;
    this.sel = { ...this.sel, objectId: quiz.id };
    this.emit({ kind: "structure", objectId: quiz.id });
    return quiz;
  }

  // ---- the course's own settings

  /** What counts as having seen enough of the slides: every one, or reaching the last one. */
  get completion(): "all" | "last" {
    return this.project.completion?.slides === "last" ? "last" : "all";
  }

  /** Choose what completes the course (besides finishing every quiz). One undo step. */
  setCompletion(slides: "all" | "last"): string | null {
    if (this.completion === slides && this.project.completion?.slides === slides) return null;
    this.record("");
    this.project.completion = { slides };
    this.emit({ kind: "content" });
    return slides === "last"
      ? "The course now counts as complete when the learner reaches the last slide and has finished every quiz."
      : "The course now counts as complete when the learner has seen every slide and finished every quiz.";
  }

  // ---- assets, credits, video and audio

  get credits(): boolean {
    return this.project.credits;
  }

  setCredits(on: boolean): string | null {
    if (this.project.credits === on) return null;
    this.record("");
    this.project.credits = on;
    this.emit({ kind: "content" });
    return on ? "The published course will show a credits page when assets need credit." : "The published course will not show a credits page.";
  }

  creditOf(path: string): CreditEntry | undefined {
    return this.assets.find((a) => a.path === path);
  }

  /** Record where an asset came from, replacing what was recorded for it. One undo step. */
  setCredit(entry: CreditEntry): string | null {
    const at = this.assets.findIndex((a) => a.path === entry.path);
    if (at !== -1 && JSON.stringify(this.assets[at]) === JSON.stringify(entry)) return null;
    this.record(`credit:${entry.path}`);
    if (at === -1) this.assets.push(entry); else this.assets[at] = entry;
    this.emit({ kind: "content" });
    return "Credit saved";
  }

  /** Where an asset is used: the slide and object names. */
  usageOf(path: string): { slide: string; object: string }[] {
    const out: { slide: string; object: string }[] = [];
    for (const d of this.docs) {
      for (const layer of [d.slide.baseLayer, ...d.slide.layers]) {
        for (const o of layer.objects) if (JSON.stringify(o.content).includes(path)) out.push({ slide: d.slide.name, object: o.name });
      }
    }
    return out;
  }

  /** Forget what was recorded about a file that has been removed from the project. */
  dropCredit(path: string): void {
    if (!this.assets.some((a) => a.path === path)) return;
    this.record("");
    this.assets = this.assets.filter((a) => a.path !== path);
    this.emit({ kind: "content" });
  }

  /** Add a video or audio file that is already in the project's assets, and select it. */
  addMedia(kind: "video" | "audio", src: string): OSObject | null {
    const layer = this.layer;
    if (!layer) return null;
    const obj = newMedia(kind, this.placement(this.allocator().object()), src);
    this.record("");
    layer.objects.push(obj);
    this.sel = { ...this.sel, objectId: obj.id };
    this.emit({ kind: "structure", objectId: obj.id });
    return obj;
  }

  /** Add a YouTube or Vimeo video from a pasted address. Null if the address is not one. */
  addEmbed(address: string, provider?: "youtube" | "vimeo"): OSObject | null {
    const layer = this.layer;
    const parsed = parseVideoAddress(address, provider);
    if (!layer || !parsed || (provider && parsed.provider !== provider)) return null;
    const obj = newEmbed(this.placement(this.allocator().object()), parsed);
    this.record("");
    layer.objects.push(obj);
    this.sel = { ...this.sel, objectId: obj.id };
    this.emit({ kind: "structure", objectId: obj.id });
    return obj;
  }

  private mediaOf(objectId: string): OSObject | null {
    const obj = this.find(objectId);
    return obj && (obj.type === "video" || obj.type === "audio") ? obj : null;
  }

  /** Point a video or audio clip at a captions file (or none). */
  setMediaCaptions(objectId: string, path: string | null): string | null {
    const obj = this.mediaOf(objectId);
    if (!obj || (obj.content["captions"] ?? null) === path) return null;
    this.record("");
    obj.content = { ...obj.content, captions: path };
    this.emit({ kind: "content", objectId });
    return path ? "Captions added" : "Captions removed";
  }

  setMediaTranscript(objectId: string, text: string): string | null {
    const obj = this.mediaOf(objectId);
    const html = buildBody(text);
    if (!obj || (obj.content["transcript"] ?? "") === html) return null;
    this.record(`transcript:${objectId}`);
    obj.content = { ...obj.content, transcript: html };
    this.emit({ kind: "content", objectId });
    return "Transcript updated";
  }

  /** Offer a file that is already in the project's assets for download, and select it. */
  addDownload(src: string): OSObject | null {
    const layer = this.layer;
    if (!layer) return null;
    const obj = newDownload(this.placement(this.allocator().object()), src);
    this.record("");
    layer.objects.push(obj);
    this.sel = { ...this.sel, objectId: obj.id };
    this.emit({ kind: "structure", objectId: obj.id });
    return obj;
  }

  private downloadOf(objectId: string): OSObject | null {
    const obj = this.find(objectId);
    return obj && obj.type === "download" ? obj : null;
  }

  /** Offer a different file. The title and the description stay, because they are the author's words. */
  setDownloadFile(objectId: string, src: string): string | null {
    const obj = this.downloadOf(objectId);
    if (!obj || obj.content["src"] === src) return null;
    this.record("");
    obj.content = { ...obj.content, src };
    this.emit({ kind: "content", objectId });
    const said = obj.narration ? " and the narration" : "";
    return `Now offers ${src.split("/").pop()}. Check that the description${said} still ${obj.narration ? "fit" : "fits"} it.`;
  }

  /** What the link is called. Blank is allowed while writing; the validator asks for a name before the course can be published. */
  setDownloadTitle(objectId: string, title: string): string | null {
    const obj = this.downloadOf(objectId);
    if (!obj || obj.content["title"] === title) return null;
    this.record(`dl-title:${objectId}`);
    obj.content = { ...obj.content, title };
    this.emit({ kind: "content", objectId });
    return title.trim() === "" ? "The file has no name now. It needs one." : "Name updated";
  }

  /** What the file is, so a learner knows before downloading it. Required before the course can be published. */
  setDownloadDescription(objectId: string, text: string): string | null {
    const obj = this.downloadOf(objectId);
    const description = text.replace(/\r\n/g, "\n").trim();
    if (!obj || obj.content["description"] === description) return null;
    this.record(`dl-description:${objectId}`);
    obj.content = { ...obj.content, description };
    this.emit({ kind: "content", objectId });
    return description === "" ? "The description is empty. Learners need to know what the file is." : "Description updated";
  }

  setDownloadConfirmed(objectId: string, confirmed: boolean): string | null {
    const obj = this.downloadOf(objectId);
    if (!obj || obj.content["accessibleConfirmed"] === confirmed) return null;
    this.record("");
    obj.content = { ...obj.content, accessibleConfirmed: confirmed };
    this.emit({ kind: "content", objectId });
    return confirmed ? "You have said this file is accessible" : "Accessibility is not confirmed";
  }

  /** Give the file narration that says its name, what it is, its kind and how to save it. Replaces any narration it had. */
  narrateDownloadFromText(objectId: string): string | null {
    const obj = this.downloadOf(objectId);
    if (!obj) return null;
    const c = obj.content as unknown as { title: string; description: string; src: string };
    if (c.description.trim() === "") return "Write the description first. The narration says it.";
    return this.setNarrationScript(objectId, downloadScript(c)) ?? "The narration already says what the file shows.";
  }

  private embedOf(objectId: string): OSObject | null {
    const obj = this.find(objectId);
    return obj && obj.type === "embed" ? obj : null;
  }

  /** Change which video an embed plays, from a pasted address. */
  setEmbedAddress(objectId: string, address: string): string | null {
    const obj = this.embedOf(objectId);
    const parsed = parseVideoAddress(address);
    if (!obj) return null;
    if (!parsed) return "That is not a YouTube or Vimeo video address.";
    const c = obj.content;
    if (c["provider"] === parsed.provider && c["id"] === parsed.id && c["hash"] === parsed.hash) return null;
    this.record("");
    obj.content = { ...c, ...parsed };
    obj.name = parsed.provider === "youtube" ? "YouTube video" : "Vimeo video";
    this.emit({ kind: "structure", objectId });
    return `Now plays the ${parsed.provider === "youtube" ? "YouTube" : "Vimeo"} video ${parsed.id}`;
  }

  setEmbedTranscript(objectId: string, text: string): string | null {
    const obj = this.embedOf(objectId);
    const html = buildBody(text);
    if (!obj || obj.content["transcript"] === html) return null;
    this.record(`transcript:${objectId}`);
    obj.content = { ...obj.content, transcript: html };
    this.emit({ kind: "content", objectId });
    return "Transcript updated";
  }

  setEmbedCaptionsConfirmed(objectId: string, confirmed: boolean): string | null {
    const obj = this.embedOf(objectId);
    if (!obj || obj.content["captionsConfirmed"] === confirmed) return null;
    this.record("");
    obj.content = { ...obj.content, captionsConfirmed: confirmed };
    this.emit({ kind: "content", objectId });
    return confirmed ? "You have said this video has captions" : "Captions are not confirmed";
  }

  // ---- narration: what an object, or one item of an interaction, says, and in which voice
  //
  // A narration is named by its key: an object's id, or "<object id>/<item id>" for an item. The same key is used by the
  // speech tool and by the published course, so the audio made for a key is the audio played for it.

  private narrationOwner(key: string): { obj: OSObject; item: InteractionItem | null; name: string } | null {
    const [objectId = "", itemId, ...rest] = key.split("/");
    if (rest.length > 0) return null;
    const obj = this.find(objectId);
    if (!obj) return null;
    if (itemId === undefined) return { obj, item: null, name: obj.name };
    const item = obj.type === "interaction" ? (obj.content as unknown as InteractionContent).items.find((i) => i.id === itemId) : undefined;
    return item ? { obj, item, name: `${obj.name}, ${item.title}` } : null;
  }

  private narrationAt(owner: { obj: OSObject; item: InteractionItem | null }): Narration | null {
    return ((owner.item ? owner.item.narration : owner.obj.narration) as Narration | null) ?? null;
  }

  private writeNarration(owner: { obj: OSObject; item: InteractionItem | null }, n: Narration | null): void {
    if (owner.item) owner.item.narration = n;
    else owner.obj.narration = n;
  }

  /**
   * Every narration, slide by slide and layer by layer, each layer in reading order, which is also the order they play.
   * An interaction's items come straight after the interaction itself, in the order the items are in.
   */
  narratedObjects(): NarratedObject[] {
    const out: NarratedObject[] = [];
    for (const slide of this.slides) {
      for (const layer of [slide.baseLayer, ...slide.layers]) {
        const where = { slideId: slide.id, slideName: slide.name, layerId: layer.id, layerName: layer.name };
        for (const object of readingOrder(layer.objects)) {
          const own = (object.narration as Narration | null) ?? null;
          if (own) out.push({ ...where, object, key: object.id, item: null, narration: own });
          if (object.type !== "interaction") continue;
          for (const item of (object.content as unknown as InteractionContent).items) {
            const said = (item.narration as Narration | null) ?? null;
            if (said) out.push({ ...where, object, key: `${object.id}/${item.id}`, item, narration: said });
          }
        }
      }
    }
    return out;
  }

  /**
   * Write or change what an object, or an interaction item, says. The first words make narration, in the voice and speed
   * of the narration before it, so a course keeps one voice. Clearing the script removes the narration, which undo brings back.
   */
  setNarrationScript(key: string, text: string): string | null {
    const owner = this.narrationOwner(key);
    if (!owner) return null;
    const script = text.trim();
    const current = this.narrationAt(owner);
    if (script === "") {
      if (!current) return null;
      this.record("");
      this.writeNarration(owner, null);
      this.emit({ kind: "content", objectId: owner.obj.id });
      return `Removed the narration from ${owner.name}`;
    }
    if (current?.script === script) return null;
    this.record(`narration:${key}`);
    this.writeNarration(owner, current ? { ...current, script } : newNarration(script, this.narratedObjects().at(-1)?.narration));
    this.emit({ kind: "content", objectId: owner.obj.id });
    return current ? "Narration updated" : `Added narration to ${owner.name}`;
  }

  /**
   * Make an item say what it shows: its title, then its text. The words are then the author's to change, so a later change
   * to the item's text does not change them. Used on one item, which replaces any words it already had.
   */
  narrateItemFromText(objectId: string, itemId: string): string | null {
    const hit = this.itemOf(objectId, itemId);
    if (!hit) return null;
    return this.setNarrationScript(`${objectId}/${itemId}`, itemScript(hit.item));
  }

  /**
   * Give every item of an interaction that has no narration its own narration, read from its title and text. Items that
   * already have narration are left exactly as they are. One undo puts it all back.
   */
  narrateItemsFromText(objectId: string): { added: number; message: string } {
    const hit = this.interactionOf(objectId);
    if (!hit) return { added: 0, message: "" };
    const todo = hit.c.items.filter((i) => !i.narration);
    if (todo.length === 0) return { added: 0, message: "Every item already has narration." };
    this.record("");
    let like = this.narratedObjects().at(-1)?.narration;
    for (const item of todo) {
      like = newNarration(itemScript(item), like);
      item.narration = like;
    }
    this.emit({ kind: "content", objectId });
    const kept = hit.c.items.length - todo.length;
    return {
      added: todo.length,
      message: `Added narration to ${todo.length} ${todo.length === 1 ? "item" : "items"}, read from ${todo.length === 1 ? "its" : "their"} text.${kept > 0 ? ` ${kept} that already had narration ${kept === 1 ? "was" : "were"} left alone.` : ""} Make the audio from the Narration button.`,
    };
  }

  /** Change the voice. The language stored beside it follows the voice. */
  setNarrationVoice(key: string, voice: string): string | null {
    const owner = this.narrationOwner(key);
    const n = owner ? this.narrationAt(owner) : null;
    if (!owner || !n || !VOICES.includes(voice) || n.voice === voice) return null;
    this.record("");
    this.writeNarration(owner, { ...n, voice, lang: langForVoice(voice) });
    this.emit({ kind: "content", objectId: owner.obj.id });
    return `Voice changed to ${voiceOption(voice).label}`;
  }

  setNarrationSpeed(key: string, speed: number): { ok: boolean; message: string } {
    const owner = this.narrationOwner(key);
    const n = owner ? this.narrationAt(owner) : null;
    if (!owner || !n) return { ok: false, message: "" };
    if (!Number.isFinite(speed) || speed < SPEED_MIN || speed > SPEED_MAX) return { ok: false, message: `Speed must be a number from ${SPEED_MIN} to ${SPEED_MAX}.` };
    // Two decimals, so the key works out the same in every language that reads the format.
    const next = Math.round(speed * 100) / 100;
    if (next === n.speed) return { ok: true, message: "" };
    this.record(`narration-speed:${key}`);
    this.writeNarration(owner, { ...n, speed: next });
    this.emit({ kind: "content", objectId: owner.obj.id });
    return { ok: true, message: `Speed ${next}` };
  }

  /** Why a pronunciation cannot be used, or null if it can. `except` is the one being edited, which may keep its own word. */
  private pronunciationProblem(n: Narration, term: string, ipa: string, except = -1): string | null {
    if (term === "") return "Write the word as it is spelled in the script.";
    if (ipa === "") return "Write how it should sound, in IPA.";
    if (!isValidIpa(ipa)) return `${ipa} has characters that are not IPA. Use IPA letters, stress marks and spaces.`;
    if (n.pronunciations.some((p, i) => i !== except && p.term.toLowerCase() === term.toLowerCase())) return `${term} already has a pronunciation.`;
    return null;
  }

  /** Teach the voice to say one word. IPA is checked here, the same way the validator checks it. */
  addPronunciation(key: string, termText: string, ipaText: string): { ok: boolean; message: string } {
    const owner = this.narrationOwner(key);
    const n = owner ? this.narrationAt(owner) : null;
    if (!owner || !n) return { ok: false, message: "" };
    const term = termText.trim();
    const ipa = ipaText.trim();
    const problem = this.pronunciationProblem(n, term, ipa);
    if (problem) return { ok: false, message: problem };
    this.record("");
    this.writeNarration(owner, { ...n, pronunciations: [...n.pronunciations, { term, ipa }] });
    this.emit({ kind: "content", objectId: owner.obj.id });
    return { ok: true, message: `${term} will be said ${ipa}` };
  }

  updatePronunciation(key: string, index: number, termText: string, ipaText: string): { ok: boolean; message: string } {
    const owner = this.narrationOwner(key);
    const n = owner ? this.narrationAt(owner) : null;
    if (!owner || !n || !n.pronunciations[index]) return { ok: false, message: "" };
    const term = termText.trim();
    const ipa = ipaText.trim();
    const problem = this.pronunciationProblem(n, term, ipa, index);
    if (problem) return { ok: false, message: problem };
    const old = n.pronunciations[index]!;
    if (old.term === term && old.ipa === ipa) return { ok: true, message: "" };
    this.record(`pronunciation:${key}:${index}`);
    this.writeNarration(owner, { ...n, pronunciations: n.pronunciations.map((p, i) => (i === index ? { term, ipa } : p)) });
    this.emit({ kind: "content", objectId: owner.obj.id });
    return { ok: true, message: `${term} will be said ${ipa}` };
  }

  deletePronunciation(key: string, index: number): string | null {
    const owner = this.narrationOwner(key);
    const n = owner ? this.narrationAt(owner) : null;
    const gone = n?.pronunciations[index];
    if (!owner || !n || !gone) return null;
    this.record("");
    this.writeNarration(owner, { ...n, pronunciations: n.pronunciations.filter((_, i) => i !== index) });
    this.emit({ kind: "content", objectId: owner.obj.id });
    return `Removed the pronunciation of ${gone.term}`;
  }

  // ---- timing: when an object appears and disappears, and when the slide moves on by itself

  /**
   * Every object of the slide being edited with where it is, base layer first, each layer in reading order. The Timing
   * list shows these, and any of them can be changed whichever layer is being edited.
   */
  timingRows(): { object: OSObject; layerId: string; layerName: string; onBase: boolean }[] {
    const slide = this.slide;
    if (!slide) return [];
    return this.layers.flatMap((layer) => readingOrder(layer.objects).map((object) => ({ object, layerId: layer.id, layerName: layer.name, onBase: layer === slide.baseLayer })));
  }

  /**
   * Change when an object appears (a number of milliseconds after the slide opens, or after its own narration starts) and
   * how long it stays. Times are whole milliseconds from 0 to an hour. An object can only follow its narration if it has some.
   */
  setTiming(objectId: string, patch: Partial<Timing>): { ok: boolean; message: string } {
    const row = this.timingRows().find((r) => r.object.id === objectId);
    if (!row) return { ok: false, message: "" };
    const obj = row.object;
    const next: Timing = { ...obj.timing, ...patch };
    const whole = (n: number, min: number) => Number.isInteger(n) && n >= min && n <= MAX_MS;
    if (next.appear !== "time" && next.appear !== "narration") return { ok: false, message: "An object appears after the slide opens or after its narration starts." };
    if (!whole(next.start, 0)) return { ok: false, message: "The time must be from 0 to 3600 seconds." };
    if (next.visibleFor !== null && !whole(next.visibleFor, 1)) return { ok: false, message: "How long it stays must be from a thousandth of a second to 3600 seconds, or blank to stay." };
    if (next.appear === "narration" && !obj.narration) return { ok: false, message: "Write this object's narration first, so there is something for it to follow." };
    if (JSON.stringify(next) === JSON.stringify(obj.timing)) return { ok: true, message: "" };
    this.record(`timing:${objectId}:${Object.keys(patch).join(",")}`);
    obj.timing = next;
    this.emit({ kind: "content", objectId });
    return { ok: true, message: `${obj.name}: ${describeTiming(next, !row.onBase)}` };
  }

  /**
   * Change how an object arrives (`enter`, when its timing shows it) or leaves (`exit`, when its timing hides it): which effect, and how
   * long it lasts, from a tenth of a second to two seconds. Short on purpose, because motion is a barrier for some learners.
   */
  setAnimation(objectId: string, phase: Phase, patch: Partial<Effect>): { ok: boolean; message: string } {
    const row = this.timingRows().find((r) => r.object.id === objectId);
    if (!row) return { ok: false, message: "" };
    const obj = row.object;
    const next: Effect = { ...obj.animation[phase], ...patch };
    if (!(EFFECTS as readonly string[]).includes(next.effect)) return { ok: false, message: "That is not an effect this editor knows." };
    if (!validDuration(next.duration)) return { ok: false, message: "An effect lasts from 0.1 to 2 seconds." };
    if (JSON.stringify(next) === JSON.stringify(obj.animation[phase])) return { ok: true, message: "" };
    this.record(`animation:${objectId}:${phase}:${Object.keys(patch).join(",")}`);
    obj.animation = { ...obj.animation, [phase]: next };
    this.emit({ kind: "content", objectId });
    return { ok: true, message: `${obj.name}: ${describeAnimation(obj.animation)}` };
  }

  /** Make the slide being edited move on by itself after this many milliseconds, or wait for the learner (null). */
  setSlideDuration(ms: number | null): { ok: boolean; message: string } {
    const slide = this.slide;
    if (!slide) return { ok: false, message: "" };
    if (ms !== null && !(Number.isInteger(ms) && ms >= 1 && ms <= MAX_MS)) return { ok: false, message: "The time must be from a thousandth of a second to 3600 seconds, or blank to wait for the learner." };
    if (slide.duration === ms) return { ok: true, message: "" };
    this.record(`slide-duration:${slide.id}`);
    slide.duration = ms;
    this.emit({ kind: "structure" });
    const question = ms !== null && slide.baseLayer.objects.some((o) => o.type === "quizQuestion");
    return { ok: true, message: ms === null ? "This slide waits for the learner." : `This slide moves on by itself after ${plainSeconds(ms)}.${question ? " It has a question, and a learner could be moved past it." : ""}` };
  }

  // ---- rules: what an object makes the course do

  private nextTriggerId(): string {
    const ids = this.docs.flatMap((d) => [d.slide.baseLayer, ...d.slide.layers].flatMap((l) => l.objects.flatMap((o) => o.triggers.map((t) => t.id))));
    return `trg-${String(nextNumber(ids, "trg-")).padStart(4, "0")}`;
  }

  /** An object's rules, in order. Triggers the editor cannot show as a rule come back as `raw` items. */
  rulesOf(objectId: string): RuleItem[] {
    const obj = this.find(objectId);
    return obj ? readRules(obj.triggers) : [];
  }

  /** Write rules back, giving any new rule ids no other trigger in the project uses. */
  private writeRulesTo(obj: OSObject, items: RuleItem[]): void {
    const used = new Set(this.docs.flatMap((d) => [d.slide.baseLayer, ...d.slide.layers].flatMap((l) => l.objects.flatMap((o) => o.triggers.map((t) => t.id)))));
    let next = nextNumber([...used], "trg-");
    const fresh = () => {
      let id = `trg-${String(next++).padStart(4, "0")}`;
      while (used.has(id)) id = `trg-${String(next++).padStart(4, "0")}`;
      used.add(id);
      return id;
    };
    obj.triggers = writeRules(items, fresh);
  }

  /** What a rule on this object may point at for an action: slides, layers of its slide, variables, or media on its slide. */
  targetsFor(objectId: string, action: RuleAction): { value: string; label: string }[] {
    if (action === "jumpToSlide") return this.slides.map((s, i) => ({ value: s.id, label: `${i + 1}. ${s.name}` }));
    if (action === "setVariable") return this.project.variables.map((v) => ({ value: v.id, label: v.name }));
    const slide = this.docs.find((d) => [d.slide.baseLayer, ...d.slide.layers].some((l) => l.objects.some((o) => o.id === objectId)))?.slide;
    if (!slide) return [];
    if (action === "showLayer" || action === "hideLayer") return slide.layers.map((l) => ({ value: l.id, label: l.name }));
    return [slide.baseLayer, ...slide.layers].flatMap((l) => l.objects).filter((o) => o.type === "video" || o.type === "audio").map((o) => ({ value: o.id, label: o.name }));
  }

  private variableType(id: string): Variable["type"] | undefined {
    return this.project.variables.find((v) => v.id === id)?.type;
  }

  /** A rule that does something safe to start with, for the author to change. */
  addRule(objectId: string): string | null {
    const obj = this.find(objectId);
    if (!obj) return null;
    const event = eventsFor(obj.type)[0]!;
    // The first thing the course can really do from here: show a layer, otherwise go to another slide.
    const layers = this.targetsFor(objectId, "showLayer");
    const slides = this.targetsFor(objectId, "jumpToSlide");
    const action: RuleAction = layers.length > 0 ? "showLayer" : "jumpToSlide";
    const target = (layers.length > 0 ? layers : slides)[0]?.value;
    if (!target) return null;
    this.record("");
    const items = readRules(obj.triggers);
    items.push({ kind: "rule", rule: { event, action, target, conditions: [] } });
    this.writeRulesTo(obj, items);
    this.emit({ kind: "structure", objectId });
    return `Added rule ${items.length}`;
  }

  private ruleAt(objectId: string, index: number): { obj: OSObject; items: RuleItem[]; rule: Rule } | null {
    const obj = this.find(objectId);
    if (!obj) return null;
    const items = readRules(obj.triggers);
    const item = items[index];
    return item && item.kind === "rule" ? { obj, items, rule: item.rule } : null;
  }

  /**
   * If an input saves to this variable, the answers it can hold, so a rule can pick one instead of typing it.
   * Null for a variable no input saves to.
   */
  valueChoices(variableId: string): { value: Primitive; label: string }[] | null {
    for (const d of this.docs) {
      for (const layer of [d.slide.baseLayer, ...d.slide.layers]) {
        for (const o of layer.objects) {
          if (o.type !== "input") continue;
          const c = o.content as unknown as InputContent;
          if ((c.kind === "radio" || c.kind === "dropdown" || c.kind === "list") && c.variable === variableId) {
            return [{ value: "", label: "Nothing chosen yet" }, ...(c.options ?? []).map((opt) => ({ value: opt.value as Primitive, label: opt.label }))];
          }
          const row = (c.kind === "likert" || c.kind === "semantic" ? c.rows : undefined)?.find((r) => r.variable === variableId);
          if (row && c.kind === "likert") return [{ value: 0, label: "Not answered yet" }, ...(c.scale ?? []).map((l, i) => ({ value: i + 1 as Primitive, label: `${l} (${i + 1})` }))];
          if (row && c.kind === "semantic") {
            const n = c.points ?? 7;
            return [{ value: 0, label: "Not answered yet" }, ...Array.from({ length: n }, (_, i) => ({ value: i + 1 as Primitive, label: i === 0 ? `1 (${row.label})` : i === n - 1 ? `${n} (${row.right ?? ""})` : String(i + 1) }))];
          }
        }
      }
    }
    return null;
  }

  /** The value a variable starts a rule with, or none for a rule that does not set one. */
  private fixValue(rule: Rule): void {
    if (rule.action !== "setVariable") { delete rule.value; return; }
    const type = this.variableType(rule.target);
    if (type) rule.value = defaultValueFor(type);
  }

  /** Change a rule's event, action, target or value. Changing the action picks a target that suits it. */
  updateRule(objectId: string, index: number, patch: { event?: Rule["event"]; action?: RuleAction; target?: string; value?: Rule["value"] }): string | null {
    const hit = this.ruleAt(objectId, index);
    if (!hit) return null;
    const { obj, items, rule } = hit;
    const next: Rule = { ...rule, conditions: rule.conditions };
    if (patch.event !== undefined) {
      if (!eventsFor(obj.type).includes(patch.event)) return `A ${obj.type} object cannot cause that.`;
      next.event = patch.event;
    }
    if (patch.action !== undefined && patch.action !== rule.action) {
      const targets = this.targetsFor(objectId, patch.action);
      if (targets.length === 0) {
        return { jumpToSlide: "There is no slide to go to.", showLayer: "This slide has no layers. Add a layer first.", hideLayer: "This slide has no layers. Add a layer first.",
          setVariable: "There are no variables yet. Add one first.", playMedia: "This slide has no video or audio to play.", pauseMedia: "This slide has no video or audio to pause." }[patch.action];
      }
      next.action = patch.action;
      next.target = targets[0]!.value;
      this.fixValue(next);
    }
    if (patch.target !== undefined && patch.target !== next.target) {
      if (!this.targetsFor(objectId, next.action).some((t) => t.value === patch.target)) return null;
      next.target = patch.target;
      if (next.action === "setVariable") this.fixValue(next);
    }
    if (patch.value !== undefined && next.action === "setVariable") {
      const type = this.variableType(next.target);
      if (type === "number" && (typeof patch.value !== "number" || !Number.isFinite(patch.value))) return "That needs a number.";
      if (type === "boolean" && typeof patch.value !== "boolean") return null;
      if (type === "string" && typeof patch.value !== "string") return null;
      next.value = patch.value;
    }
    if (JSON.stringify({ ...next, ids: undefined }) === JSON.stringify({ ...rule, ids: undefined })) return null;
    this.record(`rule:${objectId}:${index}`);
    items[index] = { kind: "rule", rule: next };
    this.writeRulesTo(obj, items);
    this.emit({ kind: "structure", objectId });
    return "Rule changed";
  }

  deleteRule(objectId: string, index: number): string | null {
    const obj = this.find(objectId);
    const items = obj ? readRules(obj.triggers) : [];
    if (!obj || !items[index]) return null;
    this.record("");
    items.splice(index, 1);
    this.writeRulesTo(obj, items);
    this.emit({ kind: "structure", objectId });
    return `Deleted rule ${index + 1}`;
  }

  /** Rules run in order, and a jump ends the list, so their order matters. */
  moveRule(objectId: string, index: number, delta: -1 | 1): string | null {
    const obj = this.find(objectId);
    const items = obj ? readRules(obj.triggers) : [];
    const to = index + delta;
    if (!obj || !items[index]) return null;
    if (to < 0 || to >= items.length) return delta < 0 ? "That rule is already first." : "That rule is already last.";
    this.record("");
    [items[index], items[to]] = [items[to]!, items[index]!];
    this.writeRulesTo(obj, items);
    this.emit({ kind: "structure", objectId });
    return `Rule ${index + 1} is now rule ${to + 1}`;
  }

  /** A condition on the first variable, for the author to change. */
  addCondition(objectId: string, index: number): string | null {
    const hit = this.ruleAt(objectId, index);
    if (!hit) return null;
    const v = this.project.variables[0];
    if (!v) return "There are no variables yet. Add one first.";
    this.record("");
    hit.rule.conditions = [...hit.rule.conditions, { variable: v.id, operator: "equals", value: defaultValueFor(v.type) === true ? true : defaultValueFor(v.type) }];
    this.writeRulesTo(hit.obj, hit.items);
    this.emit({ kind: "structure", objectId });
    return `Added condition ${hit.rule.conditions.length}`;
  }

  /** Change a condition. Choosing another variable resets the comparison and value to ones that suit its kind. */
  updateCondition(objectId: string, index: number, at: number, patch: { variable?: string; operator?: Condition["operator"]; value?: Condition["value"] }): string | null {
    const hit = this.ruleAt(objectId, index);
    const cond = hit?.rule.conditions[at];
    if (!hit || !cond) return null;
    const next: Condition = { ...cond };
    if (patch.variable !== undefined && patch.variable !== cond.variable) {
      const type = this.variableType(patch.variable);
      if (!type) return null;
      next.variable = patch.variable;
      next.operator = "equals";
      next.value = defaultValueFor(type);
    }
    const type = this.variableType(next.variable);
    if (patch.operator !== undefined) {
      if (!type || !operatorsFor(type).includes(patch.operator)) return null;
      next.operator = patch.operator;
    }
    if (patch.value !== undefined) {
      if (type === "number" && (typeof patch.value !== "number" || !Number.isFinite(patch.value))) return "That needs a number.";
      if ((type === "boolean" && typeof patch.value !== "boolean") || (type === "string" && typeof patch.value !== "string")) return null;
      next.value = patch.value;
    }
    if (JSON.stringify(next) === JSON.stringify(cond)) return null;
    this.record(`cond:${objectId}:${index}:${at}`);
    hit.rule.conditions = hit.rule.conditions.map((c, i) => (i === at ? next : c));
    this.writeRulesTo(hit.obj, hit.items);
    this.emit({ kind: "structure", objectId });
    return "Condition changed";
  }

  deleteCondition(objectId: string, index: number, at: number): string | null {
    const hit = this.ruleAt(objectId, index);
    if (!hit || !hit.rule.conditions[at]) return null;
    this.record("");
    hit.rule.conditions = hit.rule.conditions.filter((_, i) => i !== at);
    this.writeRulesTo(hit.obj, hit.items);
    this.emit({ kind: "structure", objectId });
    return `Deleted condition ${at + 1}`;
  }

  // ---- variables

  /** Where a variable is used: by rules, and by inputs that save to it. */
  variableUsage(id: string): { slide: string; object: string }[] {
    const out: { slide: string; object: string }[] = [];
    for (const d of this.docs) {
      for (const layer of [d.slide.baseLayer, ...d.slide.layers]) {
        for (const o of layer.objects) {
          if (JSON.stringify(o.triggers).includes(`"${id}"`) || JSON.stringify(o.content).includes(`"${id}"`)) out.push({ slide: d.slide.name, object: o.name });
        }
      }
    }
    return out;
  }

  /** The value a variable has when the course starts. It must be of the variable's own kind. */
  setVariableInitial(id: string, value: Variable["initial"]): string | null {
    const v = this.project.variables.find((x) => x.id === id);
    if (!v || v.initial === value) return null;
    if (v.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) return "That needs a number.";
    if ((v.type === "boolean" && typeof value !== "boolean") || (v.type === "string" && typeof value !== "string")) return null;
    this.record(`varinit:${id}`);
    v.initial = value;
    this.emit({ kind: "content" });
    return `${v.name} starts as ${String(value)}`;
  }

  /** Remove a variable nothing uses. */
  deleteVariable(id: string): string | null {
    const v = this.project.variables.find((x) => x.id === id);
    if (!v) return null;
    const uses = this.variableUsage(id);
    if (uses.length > 0) return `${v.name} is used by ${uses[0]!.object} on ${uses[0]!.slide}${uses.length > 1 ? ` and ${uses.length - 1} more` : ""}, so it cannot be deleted.`;
    this.record("");
    this.project.variables = this.project.variables.filter((x) => x.id !== id);
    this.emit({ kind: "structure" });
    return `Deleted ${v.name}`;
  }

  get variables(): Variable[] {
    return this.project.variables;
  }

  variableName(id: string): string {
    return this.project.variables.find((v) => v.id === id)?.name ?? id;
  }

  /** Make a variable and return its id. Callers record the undo step themselves. */
  private makeVariable(type: Variable["type"], base: string): string {
    const vars = this.project.variables;
    const id = `var-${nextNumber(vars.map((v) => v.id), "var-")}`;
    const taken = new Set(vars.map((v) => v.name.toLowerCase()));
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base}${n}`;
    vars.push({ id, name, type, initial: type === "boolean" ? false : type === "number" ? 0 : "" });
    return id;
  }

  /** A new variable, as one undo step. */
  addVariable(type: Variable["type"], base: string): Variable {
    this.record("");
    const id = this.makeVariable(type, base);
    this.emit({ kind: "structure" });
    return this.project.variables.find((v) => v.id === id)!;
  }

  renameVariable(id: string, name: string): string | null {
    const v = this.project.variables.find((x) => x.id === id);
    const trimmed = name.trim();
    if (!v || trimmed === v.name) return null;
    if (trimmed === "") return "A variable needs a name.";
    if (this.project.variables.some((x) => x.id !== id && x.name.toLowerCase() === trimmed.toLowerCase())) return `There is already a variable called ${trimmed}.`;
    this.record(`varname:${id}`);
    v.name = trimmed;
    this.emit({ kind: "content" });
    return `Variable renamed to ${trimmed}`;
  }

  // ---- inputs and surveys

  /** Add an input with its own new variables, as one undo step, and select it. */
  addInput(kind: string): OSObject | null {
    const layer = this.layer;
    const choice = inputById(kind);
    if (!layer || !choice) return null;
    this.record("");
    const obj = newInput(choice, this.placement(this.allocator().object()), (type, base) => this.makeVariable(type, base));
    layer.objects.push(obj);
    this.sel = { ...this.sel, objectId: obj.id };
    this.emit({ kind: "structure", objectId: obj.id });
    return obj;
  }

  private inputOf(objectId: string): { obj: OSObject; c: InputContent } | null {
    const obj = this.find(objectId);
    return obj && obj.type === "input" ? { obj, c: obj.content as unknown as InputContent } : null;
  }

  /** The list of parts the input is made of: its options, its checkboxes or its rows. */
  private partsOf(c: InputContent): { id: string; label: string; value?: string; right?: string; variable?: string }[] {
    return (c.kind === "checkbox" ? c.items : c.kind === "likert" || c.kind === "semantic" ? c.rows : c.options) ?? [];
  }

  setInputPrompt(objectId: string, prompt: string): string | null {
    const hit = this.inputOf(objectId);
    if (!hit || prompt.trim() === "" || prompt === hit.c.prompt) return null;
    this.record(`prompt:${objectId}`);
    // Alt text that still says what the prompt said follows it. Alt text the author has changed is left alone.
    if (hit.obj.accessibility.altText === hit.c.prompt) hit.obj.accessibility = { ...hit.obj.accessibility, altText: prompt };
    hit.c.prompt = prompt;
    this.emit({ kind: "content", objectId });
    return "Prompt updated";
  }

  setInputReport(objectId: string, report: boolean): string | null {
    const hit = this.inputOf(objectId);
    if (!hit || hit.c.report === report) return null;
    this.record("");
    hit.c.report = report;
    this.emit({ kind: "content", objectId });
    return report ? "Answers are sent to the LMS" : "Answers are not sent to the LMS";
  }

  private static readonly PART_LIMITS: Record<string, [number, number]> = { checkbox: [1, 12], radio: [2, 12], dropdown: [2, 12], list: [2, 12], likert: [1, 20], semantic: [1, 20] };

  addInputPart(objectId: string): string | null {
    const hit = this.inputOf(objectId);
    if (!hit) return null;
    const { c } = hit;
    const parts = this.partsOf(c);
    const [, max] = Model.PART_LIMITS[c.kind]!;
    if (parts.length >= max) return `This input can have at most ${max}.`;
    this.record("");
    const ids = parts.map((p) => p.id);
    let n = parts.length + 1;
    while (ids.includes(`${c.kind === "checkbox" ? "box" : c.kind === "likert" || c.kind === "semantic" ? "row" : "opt"}-${n}`)) n++;
    if (c.kind === "checkbox") c.items!.push({ id: `box-${n}`, label: `Option ${parts.length + 1}`, variable: this.makeVariable("boolean", `option${n}`) });
    else if (c.kind === "likert") c.rows!.push({ id: `row-${n}`, label: `Statement ${parts.length + 1}`, variable: this.makeVariable("number", `statement${n}`) });
    else if (c.kind === "semantic") c.rows!.push({ id: `row-${n}`, label: `Word ${parts.length + 1}`, right: `Opposite ${parts.length + 1}`, variable: this.makeVariable("number", `pair${n}`) });
    else c.options!.push({ id: `opt-${n}`, label: `Option ${parts.length + 1}`, value: `option-${n}` });
    this.emit({ kind: "structure", objectId });
    return `Added number ${parts.length + 1}`;
  }

  deleteInputPart(objectId: string, partId: string): string | null {
    const hit = this.inputOf(objectId);
    if (!hit) return null;
    const { c } = hit;
    const list = this.partsOf(c);
    const at = list.findIndex((p) => p.id === partId);
    if (at === -1) return null;
    const [min] = Model.PART_LIMITS[c.kind]!;
    if (list.length <= min) return `This input needs at least ${min}.`;
    this.record("");
    const [gone] = list.splice(at, 1);
    // A checkbox, statement or pair owns the variable it saves to. The options of a radio, drop-down or list
    // share the one variable on the input itself, so they own none and never take it with them.
    const owned = c.kind === "checkbox" || c.kind === "likert" || c.kind === "semantic" ? gone?.variable : undefined;
    const variable = owned === undefined ? undefined : this.project.variables.find((v) => v.id === owned);
    // The part is already out of the input, so it no longer counts as a use. A rule, or another input, still can.
    const freed = variable !== undefined && this.variableUsage(variable.id).length === 0;
    if (freed) this.project.variables = this.project.variables.filter((v) => v.id !== variable.id);
    this.emit({ kind: "structure", objectId });
    return `Deleted number ${at + 1}${freed ? ` and its variable ${variable.name}` : ""}`;
  }

  moveInputPart(objectId: string, partId: string, delta: -1 | 1): string | null {
    const hit = this.inputOf(objectId);
    if (!hit) return null;
    const list = this.partsOf(hit.c);
    const at = list.findIndex((p) => p.id === partId);
    const to = at + delta;
    if (at === -1) return null;
    if (to < 0 || to >= list.length) return delta < 0 ? "That is already first." : "That is already last.";
    this.record("");
    [list[at], list[to]] = [list[to]!, list[at]!];
    this.emit({ kind: "structure", objectId });
    return `Now number ${to + 1} of ${list.length}`;
  }

  /** Change the words of one part: a label, the value an option saves, or the right-hand word of a scale row. */
  setInputPartText(objectId: string, partId: string, field: "label" | "value" | "right", text: string): string | null {
    const hit = this.inputOf(objectId);
    const part = hit && this.partsOf(hit.c).find((p) => p.id === partId);
    if (!hit || !part || part[field] === undefined && field !== "right" || part[field] === text) return null;
    if (field === "label" && text.trim() === "") return "A label cannot be empty.";
    if (field === "value") {
      if (text === "") return "An option's saved value cannot be empty.";
      if (this.partsOf(hit.c).some((p) => p.id !== partId && p.value === text)) return "Another option already saves that value.";
    }
    this.record(`part:${objectId}:${partId}:${field}`);
    // A value that was just the label, slugged, keeps following the label until the author sets their own.
    if (field === "label" && part.value !== undefined && part.value === slugOf(part.label)) part.value = slugOf(text);
    part[field] = text;
    this.emit({ kind: "content", objectId });
    return field === "value" ? "Saved value updated" : "Updated";
  }

  /** Point one part of an input (or, for a radio, drop-down or list, the whole input) at a variable. */
  setInputVariable(objectId: string, partId: string | null, variableId: string): string | null {
    const hit = this.inputOf(objectId);
    if (!hit) return null;
    const v = this.project.variables.find((x) => x.id === variableId);
    if (!v) return null;
    if (v.type !== INPUT_VARIABLE_TYPE[hit.c.kind]) return `A ${hit.c.kind} input saves a ${INPUT_VARIABLE_TYPE[hit.c.kind]}, but ${v.name} is a ${v.type}.`;
    const part = partId === null ? null : this.partsOf(hit.c).find((p) => p.id === partId);
    if (partId !== null && !part) return null;
    const current = part ? part.variable : hit.c.variable;
    if (current === variableId) return null;
    if (part && this.partsOf(hit.c).some((p) => p !== part && p.variable === variableId)) return `${v.name} is already used by another part of this input, so they would overwrite each other.`;
    this.record("");
    if (part) part.variable = variableId; else hit.c.variable = variableId;
    this.emit({ kind: "content", objectId });
    return `Saves to ${v.name}`;
  }

  /** A new variable of the right type for this part, and the part pointed at it, as one undo step. */
  newInputVariable(objectId: string, partId: string | null): string | null {
    const hit = this.inputOf(objectId);
    if (!hit) return null;
    const part = partId === null ? null : this.partsOf(hit.c).find((p) => p.id === partId);
    if (partId !== null && !part) return null;
    this.record("");
    const id = this.makeVariable(INPUT_VARIABLE_TYPE[hit.c.kind], slugOf(part?.label ?? hit.c.prompt, "answer").replace(/-/g, "_").slice(0, 24));
    if (part) part.variable = id; else hit.c.variable = id;
    this.emit({ kind: "structure", objectId });
    return `Saves to the new variable ${this.variableName(id)}`;
  }

  /** The labels of a Likert scale, lowest first. */
  setLikertScale(objectId: string, labels: string[]): string | null {
    const hit = this.inputOf(objectId);
    if (!hit || hit.c.kind !== "likert") return null;
    const clean = labels.map((l) => l.trim()).filter((l) => l !== "");
    if (clean.length < 2 || clean.length > 9) return "A scale needs between 2 and 9 labels, one per line.";
    if (JSON.stringify(clean) === JSON.stringify(hit.c.scale)) return null;
    this.record(`scale:${objectId}`);
    hit.c.scale = clean;
    this.emit({ kind: "content", objectId });
    return `The scale has ${clean.length} points`;
  }

  setSemanticPoints(objectId: string, points: number): string | null {
    const hit = this.inputOf(objectId);
    if (!hit || hit.c.kind !== "semantic" || !Number.isInteger(points) || points < 3 || points > 9) return null;
    if (hit.c.points === points) return null;
    this.record("");
    hit.c.points = points;
    this.emit({ kind: "content", objectId });
    return `${points} points between the words`;
  }

  // ---- tables and scrolling text

  private tableOf(objectId: string): { obj: OSObject; t: TableContent } | null {
    const obj = this.find(objectId);
    return obj && obj.type === "table" ? { obj, t: obj.content as unknown as TableContent } : null;
  }

  setTableCell(objectId: string, row: number, col: number, text: string): string | null {
    const hit = this.tableOf(objectId);
    if (!hit || hit.t.rows[row]?.[col] === undefined || hit.t.rows[row]![col] === text) return null;
    this.record(`cell:${objectId}:${row}:${col}`);
    hit.t.rows[row]![col] = text;
    this.emit({ kind: "content", objectId });
    return "Cell updated";
  }

  setTableCaption(objectId: string, caption: string): string | null {
    const hit = this.tableOf(objectId);
    if (!hit || hit.t.caption === caption) return null;
    this.record(`caption:${objectId}`);
    hit.t.caption = caption;
    this.emit({ kind: "content", objectId });
    return "Caption updated";
  }

  /** A data table needs a header row or a header column, so the last one cannot be switched off. */
  setTableHeaders(objectId: string, patch: { headerRow?: boolean; headerColumn?: boolean }): string | null {
    const hit = this.tableOf(objectId);
    if (!hit) return null;
    const next = { headerRow: patch.headerRow ?? hit.t.headerRow, headerColumn: patch.headerColumn ?? hit.t.headerColumn };
    if (!next.headerRow && !next.headerColumn) return "A table needs a header row or a header column, so a screen reader can say what each cell is about.";
    if (next.headerRow === hit.t.headerRow && next.headerColumn === hit.t.headerColumn) return null;
    this.record("");
    Object.assign(hit.t, next);
    this.emit({ kind: "structure", objectId });
    return `Header row ${next.headerRow ? "on" : "off"}, header column ${next.headerColumn ? "on" : "off"}`;
  }

  addTableRow(objectId: string, after?: number): string | null {
    const hit = this.tableOf(objectId);
    if (!hit) return null;
    if (hit.t.rows.length >= 30) return "A table can have at most 30 rows.";
    this.record("");
    const at = after === undefined ? hit.t.rows.length : after + 1;
    hit.t.rows.splice(at, 0, hit.t.rows[0]!.map(() => ""));
    this.emit({ kind: "structure", objectId });
    return `Added row ${at + 1}`;
  }

  deleteTableRow(objectId: string, row: number): string | null {
    const hit = this.tableOf(objectId);
    if (!hit || hit.t.rows[row] === undefined) return null;
    if (hit.t.rows.length <= 1) return "A table needs at least one row.";
    this.record("");
    hit.t.rows.splice(row, 1);
    this.emit({ kind: "structure", objectId });
    return `Deleted row ${row + 1}`;
  }

  addTableColumn(objectId: string, after?: number): string | null {
    const hit = this.tableOf(objectId);
    if (!hit) return null;
    if (hit.t.rows[0]!.length >= 12) return "A table can have at most 12 columns.";
    this.record("");
    const at = after === undefined ? hit.t.rows[0]!.length : after + 1;
    for (const r of hit.t.rows) r.splice(at, 0, "");
    this.emit({ kind: "structure", objectId });
    return `Added column ${at + 1}`;
  }

  deleteTableColumn(objectId: string, col: number): string | null {
    const hit = this.tableOf(objectId);
    if (!hit || hit.t.rows[0]![col] === undefined) return null;
    if (hit.t.rows[0]!.length <= 1) return "A table needs at least one column.";
    this.record("");
    for (const r of hit.t.rows) r.splice(col, 1);
    this.emit({ kind: "structure", objectId });
    return `Deleted column ${col + 1}`;
  }

  /** The text of a scrolling text box, as plain paragraphs separated by blank lines. */
  setScrollText(objectId: string, text: string): string | null {
    const obj = this.find(objectId);
    if (!obj || obj.type !== "scrollingText") return null;
    const html = buildBody(text);
    if (html === "") return "A scrolling text box cannot be empty.";
    if (obj.content["html"] === html) return null;
    this.record(`scroll:${objectId}`);
    obj.content = { ...obj.content, html };
    this.emit({ kind: "content", objectId });
    return "Text updated";
  }

  // ---- results and certificate

  /** Change the words or the options of a results box. The heading cannot be empty. */
  setResults(objectId: string, patch: Partial<ResultsContent>): string | null {
    const obj = this.find(objectId);
    if (!obj || obj.type !== "results") return null;
    const c = obj.content as unknown as ResultsContent;
    if (patch.heading !== undefined && patch.heading.trim() === "") return "The results box needs a heading.";
    const next: ResultsContent = { ...c, ...patch };
    if (patch.heading !== undefined) next.heading = patch.heading.trim();
    if (patch.passMessage !== undefined) next.passMessage = patch.passMessage.trim();
    if (patch.failMessage !== undefined) next.failMessage = patch.failMessage.trim();
    if (JSON.stringify(next) === JSON.stringify(c)) return null;
    this.record(`results:${objectId}:${Object.keys(patch).join(",")}`);
    obj.content = next as unknown as Record<string, unknown>;
    this.emit({ kind: "content", objectId });
    if (patch.review !== undefined) return patch.review ? "The results will list each question" : "The results will not list the questions";
    return "Results updated";
  }

  /** Change the words or the options of a certificate. The title cannot be empty; the other lines may be left out. */
  setCertificate(objectId: string, patch: Partial<CertificateContent>): string | null {
    const obj = this.find(objectId);
    if (!obj || obj.type !== "certificate") return null;
    const c = obj.content as unknown as CertificateContent;
    if (patch.title !== undefined && patch.title.trim() === "") return "The certificate needs a title.";
    const next: CertificateContent = { ...c, ...patch };
    for (const key of ["title", "statement", "achievement", "issuedBy"] as const) {
      const v = patch[key];
      if (v !== undefined) next[key] = v.trim();
    }
    if (JSON.stringify(next) === JSON.stringify(c)) return null;
    this.record(`certificate:${objectId}:${Object.keys(patch).join(",")}`);
    obj.content = next as unknown as Record<string, unknown>;
    this.emit({ kind: "content", objectId });
    if (patch.showScore !== undefined) return patch.showScore ? "The certificate will show the score" : "The certificate will not show the score";
    if (patch.showDate !== undefined) return patch.showDate ? "The certificate will show the date" : "The certificate will not show the date";
    return "Certificate updated";
  }

  // ---- interactions

  /** Add an interaction from the catalogue to the layer being edited, and select it. */
  addInteraction(choiceId: string): OSObject | null {
    const layer = this.layer;
    const choice = interactionById(choiceId);
    if (!layer || !choice) return null;
    const obj = newInteraction(choice, this.placement(this.allocator().object()));
    this.record("");
    layer.objects.push(obj);
    this.sel = { ...this.sel, objectId: obj.id };
    this.emit({ kind: "structure", objectId: obj.id });
    return obj;
  }

  private interactionOf(objectId: string): { obj: OSObject; c: InteractionContent } | null {
    const obj = this.find(objectId);
    return obj && obj.type === "interaction" ? { obj, c: obj.content as unknown as InteractionContent } : null;
  }

  /** Change how the interaction behaves. The items stay as they are. */
  setInteractionKind(objectId: string, kind: InteractionContent["kind"]): string | null {
    const hit = this.interactionOf(objectId);
    if (!hit || hit.c.kind === kind) return null;
    const { min, max } = ITEM_LIMITS[kind];
    const count = hit.c.items.length;
    if (count < min || count > max) return `That kind needs ${min} to ${max} items and this one has ${count}. ${count > max ? "Delete some" : "Add some"} first.`;
    this.record("");
    hit.c.kind = kind;
    // Only some kinds have these options; the rest keep a sensible value so the file stays complete.
    if (kind !== "clickReveal" && kind !== "flipCards" && kind !== "tabs") hit.c.orientation = kind === "accordion" ? "vertical" : "horizontal";
    hit.c.allowMultiple = kind === "clickReveal";
    this.emit({ kind: "structure", objectId });
    return `Changed to ${kind}`;
  }

  setInteractionOrientation(objectId: string, orientation: "horizontal" | "vertical"): string | null {
    const hit = this.interactionOf(objectId);
    if (!hit || hit.c.orientation === orientation) return null;
    this.record("");
    hit.c.orientation = orientation;
    this.emit({ kind: "content", objectId });
    return `Now ${orientation}`;
  }

  setInteractionMultiple(objectId: string, allowMultiple: boolean): string | null {
    const hit = this.interactionOf(objectId);
    if (!hit || hit.c.allowMultiple === allowMultiple) return null;
    this.record("");
    hit.c.allowMultiple = allowMultiple;
    this.emit({ kind: "content", objectId });
    return allowMultiple ? "Several items can be open at once" : "Only one item is open at a time";
  }

  private itemOf(objectId: string, itemId: string): { hit: { obj: OSObject; c: InteractionContent }; item: InteractionItem } | null {
    const hit = this.interactionOf(objectId);
    const item = hit?.c.items.find((i) => i.id === itemId);
    return hit && item ? { hit, item } : null;
  }

  addItem(objectId: string): string | null {
    const hit = this.interactionOf(objectId);
    if (!hit) return null;
    const max = ITEM_LIMITS[hit.c.kind].max;
    if (hit.c.items.length >= max) return `A ${hit.c.kind} can have at most ${max} items.`;
    this.record("");
    hit.c.items.push(newInteractionItem(hit.c.items.map((i) => i.id), hit.c.kind));
    this.emit({ kind: "structure", objectId });
    return `Added item ${hit.c.items.length}`;
  }

  deleteItem(objectId: string, itemId: string): string | null {
    const hit = this.interactionOf(objectId);
    const at = hit?.c.items.findIndex((i) => i.id === itemId) ?? -1;
    if (!hit || at === -1) return null;
    const min = ITEM_LIMITS[hit.c.kind].min;
    if (hit.c.items.length <= min) return `A ${hit.c.kind} needs at least ${min} ${min === 1 ? "item" : "items"}.`;
    this.record("");
    const [gone] = hit.c.items.splice(at, 1);
    this.emit({ kind: "structure", objectId });
    return `Deleted ${gone!.title}`;
  }

  moveItem(objectId: string, itemId: string, delta: -1 | 1): string | null {
    const hit = this.interactionOf(objectId);
    const at = hit?.c.items.findIndex((i) => i.id === itemId) ?? -1;
    if (!hit || at === -1) return null;
    const to = at + delta;
    if (to < 0 || to >= hit.c.items.length) return delta < 0 ? "That item is already first." : "That item is already last.";
    this.record("");
    [hit.c.items[at], hit.c.items[to]] = [hit.c.items[to]!, hit.c.items[at]!];
    this.emit({ kind: "structure", objectId });
    return `${hit.c.items[to]!.title} is now number ${to + 1} of ${hit.c.items.length}`;
  }

  setItemTitle(objectId: string, itemId: string, title: string): string | null {
    const hit = this.itemOf(objectId, itemId);
    if (!hit || title.trim() === "" || title === hit.item.title) return null;
    this.record(`item-title:${objectId}:${itemId}`);
    hit.item.title = title;
    this.emit({ kind: "content", objectId });
    return "Title updated";
  }

  /** The item's text, as plain paragraphs separated by blank lines. */
  setItemBody(objectId: string, itemId: string, text: string): string | null {
    const hit = this.itemOf(objectId, itemId);
    if (!hit) return null;
    const html = buildBody(text);
    if (html === hit.item.body) return null;
    this.record(`item-body:${objectId}:${itemId}`);
    hit.item.body = html;
    this.emit({ kind: "content", objectId });
    return "Text updated";
  }

  /** Give an item a picture. Its alt text starts empty, and the validator flags it until it is written. */
  setItemImage(objectId: string, itemId: string, src: string | null): string | null {
    const hit = this.itemOf(objectId, itemId);
    if (!hit) return null;
    if (src === null) {
      if (!hit.item.image) return null;
      this.record("");
      hit.item.image = null;
      this.emit({ kind: "structure", objectId });
      return "Picture removed";
    }
    this.record("");
    hit.item.image = { src, alt: "", decorative: false };
    this.emit({ kind: "structure", objectId });
    return "Picture added. Write its alt text, or mark it decorative.";
  }

  setItemImageAlt(objectId: string, itemId: string, patch: { alt?: string; decorative?: boolean }): string | null {
    const hit = this.itemOf(objectId, itemId);
    const image = hit?.item.image;
    if (!hit || !image) return null;
    const next = { ...image, ...patch };
    // A decorative picture has no alt text, and a picture with alt text is not decorative.
    if (patch.decorative === true) next.alt = "";
    if (patch.alt !== undefined && patch.alt.trim() !== "") next.decorative = false;
    if (next.alt === image.alt && next.decorative === image.decorative) return null;
    this.record(`item-alt:${objectId}:${itemId}`);
    hit.item.image = next;
    this.emit({ kind: "content", objectId });
    return next.decorative ? "Picture marked decorative" : "Alt text updated";
  }

  // ---- quiz questions

  private quizOf(objectId: string): { obj: OSObject; q: QuizContent } | null {
    const obj = this.find(objectId);
    return obj && obj.type === "quizQuestion" ? { obj, q: obj.content as unknown as QuizContent } : null;
  }

  setChoiceLabel(objectId: string, choiceId: string, label: string): string | null {
    const hit = this.quizOf(objectId);
    const choice = hit?.q.choices.find((c) => c.id === choiceId);
    if (!hit || !choice || label.trim() === "" || label === choice.label) return null;
    this.record(`choice:${objectId}:${choiceId}`);
    choice.label = label;
    this.emit({ kind: "content", objectId });
    return "Answer updated";
  }

  /** Exactly one answer is correct, so choosing one clears the others. */
  setCorrectChoice(objectId: string, choiceId: string): string | null {
    const hit = this.quizOf(objectId);
    if (!hit || !hit.q.choices.some((c) => c.id === choiceId)) return null;
    if (hit.q.choices.every((c) => c.correct === (c.id === choiceId))) return null;
    this.record("");
    hit.q.choices.forEach((c) => (c.correct = c.id === choiceId));
    this.emit({ kind: "content", objectId });
    return `${hit.q.choices.find((c) => c.id === choiceId)!.label} is the correct answer`;
  }

  addChoice(objectId: string): string | null {
    const hit = this.quizOf(objectId);
    if (!hit) return null;
    if (hit.q.choices.length >= 8) return "A question can have at most 8 answers.";
    const id = `c${nextNumber(hit.q.choices.map((c) => c.id), "c")}`;
    this.record("");
    hit.q.choices.push({ id, label: `Answer ${hit.q.choices.length + 1}`, correct: false });
    this.emit({ kind: "structure", objectId });
    return `Added answer ${hit.q.choices.length}`;
  }

  deleteChoice(objectId: string, choiceId: string): string | null {
    const hit = this.quizOf(objectId);
    const choice = hit?.q.choices.find((c) => c.id === choiceId);
    if (!hit || !choice) return null;
    if (hit.q.choices.length <= 2) return "A question needs at least 2 answers.";
    this.record("");
    hit.q.choices = hit.q.choices.filter((c) => c.id !== choiceId);
    // If the correct answer was deleted, the first one left becomes correct, and the author is told.
    const lostCorrect = !hit.q.choices.some((c) => c.correct);
    if (lostCorrect) hit.q.choices[0]!.correct = true;
    this.emit({ kind: "structure", objectId });
    return lostCorrect ? `Deleted. ${hit.q.choices[0]!.label} is now the correct answer; change it if that is wrong.` : "Deleted the answer";
  }

  setScoring(objectId: string, patch: { points?: number; attemptsAllowed?: number }): string | null {
    const hit = this.quizOf(objectId);
    if (!hit) return null;
    const next = { ...hit.q.scoring, ...patch };
    if (!Number.isFinite(next.points) || next.points < 0) return null;
    if (!Number.isInteger(next.attemptsAllowed) || next.attemptsAllowed < 1 || next.attemptsAllowed > 10) return null;
    if (JSON.stringify(next) === JSON.stringify(hit.q.scoring)) return null;
    this.record(`scoring:${objectId}`);
    hit.q.scoring = next;
    this.emit({ kind: "content", objectId });
    return "Scoring updated";
  }

  /** Choose which layer shows after a right or a wrong answer. It must be a layer of this slide, not the base layer. */
  setFeedbackLayer(objectId: string, which: "correct" | "incorrect", layerId: string): string | null {
    const hit = this.quizOf(objectId);
    const slide = this.slide;
    if (!hit || !slide || !slide.layers.some((l) => l.id === layerId) || hit.q.feedback[which] === layerId) return null;
    this.record("");
    hit.q.feedback = { ...hit.q.feedback, [which]: layerId };
    this.emit({ kind: "content", objectId });
    return `The ${which} feedback now uses ${slide.layers.find((l) => l.id === layerId)!.name}`;
  }

  /** Remove an object. The tab order of what is left is renumbered so it has no gaps. */
  deleteObject(objectId: string): string | null {
    const layer = this.layer;
    const obj = layer?.objects.find((o) => o.id === objectId);
    if (!layer || !obj) return null;
    this.record("");
    layer.objects = layer.objects.filter((o) => o.id !== objectId);
    readingOrder(layer.objects)
      .filter((o) => (o.accessibility.tabOrder ?? 0) >= 1)
      .forEach((o, i) => (o.accessibility = { ...o.accessibility, tabOrder: i + 1 }));
    if (this.sel.objectId === objectId) this.sel = { ...this.sel, objectId: null };
    this.emit({ kind: "structure" });
    return `Deleted ${obj.name}`;
  }

  // ---- slides and layers

  /** Add a slide, from one of the built-in layouts, after the current one in the same scene. Selects it. */
  addSlide(layoutId = "blank"): Slide {
    const layout = SLIDE_LAYOUTS.find((l) => l.id === layoutId) ?? SLIDE_LAYOUTS[0]!;
    const ids = [...this.docs.map((d) => d.id), ...this.project.scenes.flatMap((s) => s.slides)];
    const id = `slide-${String(nextNumber(ids, "slide-")).padStart(3, "0")}`;
    this.record("");
    const slide = buildLayoutSlide(layout, id, this.allocator(emptySlide(id, "")));
    slide.name = layout.id === "blank" ? `Slide ${this.docs.length + 1}` : layout.name;
    const scene = this.project.scenes.find((s) => s.slides.includes(this.sel.slideId)) ?? this.project.scenes[0]!;
    const at = scene.slides.indexOf(this.sel.slideId);
    scene.slides.splice(at === -1 ? scene.slides.length : at + 1, 0, id);
    this.docs.push({ id, slide, originalText: "", savedCompact: "" });
    this.syncDocOrder();
    this.sel = { slideId: id, layerId: slide.baseLayer.id, objectId: null };
    this.emit({ kind: "structure" });
    this.emit({ kind: "selection" });
    return slide;
  }

  /**
   * Change the layout of the slide being edited. The text already written moves into the new
   * layout's places, and nothing is thrown away: text with no place to go stays where it was.
   * Only the base layer changes. One undo step puts everything back.
   */
  applyLayout(layoutId: string): string | null {
    const layout = SLIDE_LAYOUTS.find((l) => l.id === layoutId);
    const slide = this.slide;
    if (!layout || !slide) return null;
    this.record("");
    const result = layOut(layout, this.allocator(slide), slide.baseLayer.objects);
    slide.baseLayer.objects = result.objects;
    slide.layout = layout.id;
    slide.background = layout.background ?? null;
    if (this.sel.layerId === slide.baseLayer.id && this.sel.objectId && !result.objects.some((o) => o.id === this.sel.objectId)) {
      this.sel = { ...this.sel, objectId: null };
    }
    this.emit({ kind: "structure" });
    const parts = [`Applied ${layout.label}.`];
    if (result.moved) parts.push(`${result.moved} text ${result.moved === 1 ? "box" : "boxes"} moved into place.`);
    if (result.added) parts.push(`${result.added} new placeholder${result.added === 1 ? "" : "s"} added.`);
    if (result.cleared) parts.push(`${result.cleared} unused placeholder${result.cleared === 1 ? "" : "s"} from the old layout ${result.cleared === 1 ? "was" : "were"} removed.`);
    if (result.leftover) parts.push(`${result.leftover} text ${result.leftover === 1 ? "box has" : "boxes have"} no place in this layout and ${result.leftover === 1 ? "stays" : "stay"} where ${result.leftover === 1 ? "it was" : "they were"}.`);
    return parts.join(" ");
  }

  /** Delete a slide. The last one cannot be deleted, because a project needs a slide. */
  deleteSlide(slideId: string): string | null {
    const doc = this.docs.find((d) => d.id === slideId);
    if (!doc) return null;
    if (this.docs.length === 1) return "A project needs at least one slide, so this one cannot be deleted.";
    this.record("");
    const index = this.docs.indexOf(doc);
    for (const scene of this.project.scenes) scene.slides = scene.slides.filter((s) => s !== slideId);
    this.docs = this.docs.filter((d) => d.id !== slideId);
    if (this.sel.slideId === slideId) {
      const next = this.docs[Math.min(index, this.docs.length - 1)]!.slide;
      this.sel = { slideId: next.id, layerId: next.baseLayer.id, objectId: null };
    }
    this.emit({ kind: "structure" });
    this.emit({ kind: "selection" });
    return `Deleted ${doc.slide.name}`;
  }

  moveSlide(slideId: string, delta: -1 | 1): string | null {
    const scene = this.project.scenes.find((s) => s.slides.includes(slideId));
    const doc = this.docs.find((d) => d.id === slideId);
    if (!scene || !doc) return null;
    const at = scene.slides.indexOf(slideId);
    const to = at + delta;
    if (to < 0 || to >= scene.slides.length) return delta < 0 ? `${doc.slide.name} is already first.` : `${doc.slide.name} is already last.`;
    this.record("");
    [scene.slides[at], scene.slides[to]] = [scene.slides[to]!, scene.slides[at]!];
    this.syncDocOrder();
    this.emit({ kind: "structure" });
    return `${doc.slide.name} is now slide ${this.docs.findIndex((d) => d.id === slideId) + 1} of ${this.docs.length}`;
  }

  renameSlide(slideId: string, name: string): string | null {
    const doc = this.docs.find((d) => d.id === slideId);
    if (!doc || name.trim() === "" || name === doc.slide.name) return null;
    this.record(`slidename:${slideId}`);
    doc.slide.name = name;
    this.emit({ kind: "structure" });
    return `Renamed to ${name}`;
  }

  addLayer(): Layer | null {
    const slide = this.slide;
    if (!slide) return null;
    const ids = this.layers.map((l) => l.id);
    const n = nextNumber(ids, "layer-");
    const layer = emptyLayer(`layer-${n}`, `Layer ${slide.layers.length + 1}`);
    this.record("");
    slide.layers.push(layer);
    this.sel = { ...this.sel, layerId: layer.id, objectId: null };
    this.emit({ kind: "structure" });
    this.emit({ kind: "selection" });
    return layer;
  }

  /** The base layer cannot be deleted. */
  deleteLayer(layerId: string): string | null {
    const slide = this.slide;
    const layer = slide?.layers.find((l) => l.id === layerId);
    if (!slide || !layer) return layerId === slide?.baseLayer.id ? "The base layer cannot be deleted." : null;
    this.record("");
    slide.layers = slide.layers.filter((l) => l.id !== layerId);
    if (this.sel.layerId === layerId) this.sel = { ...this.sel, layerId: slide.baseLayer.id, objectId: null };
    this.emit({ kind: "structure" });
    this.emit({ kind: "selection" });
    return `Deleted ${layer.name}`;
  }

  renameLayer(layerId: string, name: string): string | null {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer || name.trim() === "" || name === layer.name) return null;
    this.record(`layername:${layerId}`);
    layer.name = name;
    this.emit({ kind: "structure" });
    return `Renamed to ${name}`;
  }

  /** Keep the slide order the same as the order the scenes list them. */
  private syncDocOrder(): void {
    const order = [...new Set(this.project.scenes.flatMap((s) => s.slides))];
    this.docs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }

  // ---- theme

  /** What the slide being edited sits on: light, dark or accent. */
  private tone(): "light" | "dark" | "accent" {
    return toneOf(this.slide?.background ?? null, (hex) => this.lightBackground(hex));
  }

  /** For a plain-colour background: is ordinary text readable on it, or does it need light text? */
  private lightBackground(hex: string): boolean {
    return contrastOf(this.theme.colors.text, hex) >= contrastOf(this.theme.colors.onDark, hex);
  }

  /** Give the project a different theme. Everything that refers to theme colours changes with it. */
  setTheme(theme: Theme): string | null {
    if (JSON.stringify(theme) === JSON.stringify(this.theme)) return null;
    this.record("");
    this.theme = cloneTheme(theme);
    this.project.theme = { ref: "theme.json" };
    this.emit({ kind: "structure" });
    return `Theme changed to ${theme.name}`;
  }

  /**
   * Text that follows the theme should stay readable when the slide's background changes. Text
   * whose colour is one of the theme's text colours (and sits on the slide, not on a fill of its
   * own) takes the text colour for the new background. Colours the author chose are left alone.
   */
  private retone(slide: Slide, from: "light" | "dark" | "accent", to: "light" | "dark" | "accent"): void {
    if (from === to) return;
    const following = new Set(["text", "muted", "good", "bad", "onDark", "onAccentStrong"].map((r) => colorRef(r)));
    for (const layer of [slide.baseLayer, ...slide.layers]) {
      for (const o of layer.objects) {
        const colour = o.style["color"];
        if ((o.type !== "text" && o.type !== "quizQuestion") || o.style["fill"] !== undefined || typeof colour !== "string" || !following.has(colour)) continue;
        // Positive and negative colours keep their meaning on a light slide. Everything else takes
        // the text colour that suits the new background, keeping quiet text quiet where it can.
        if (to === "light" && (colour === colorRef("good") || colour === colorRef("bad"))) continue;
        const role = textRole(to, colour === colorRef("muted"));
        o.style = { ...o.style, color: colorRef(role) };
      }
    }
  }

  /** Is this a colour or font reference the current theme defines? */
  knows(ref: string): boolean {
    return themeRefKnown(this.theme, ref);
  }

  /** Set a slide's background: a theme background such as "theme:bg.dark", a hex colour, or null for the theme's default. */
  setSlideBackground(slideId: string, value: string | null): string | null {
    const doc = this.docs.find((d) => d.id === slideId);
    if (!doc) return null;
    if (value !== null && !/^#[0-9a-fA-F]{6}$/.test(value) && !(value.startsWith("theme:bg.") && value.slice("theme:bg.".length) in this.theme.backgrounds)) return null;
    if (doc.slide.background === value) return null;
    this.record(`bg:${slideId}`);
    const was = toneOf(doc.slide.background, (hex) => this.lightBackground(hex));
    doc.slide.background = value;
    this.retone(doc.slide, was, toneOf(value, (hex) => this.lightBackground(hex)));
    this.emit({ kind: "structure" });
    return "Background updated";
  }

  // ---- history

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const before = this.undoStack.pop();
    if (before === undefined) return false;
    this.redoStack.push(this.snapshot());
    this.restore(before);
    return true;
  }

  redo(): boolean {
    const after = this.redoStack.pop();
    if (after === undefined) return false;
    this.undoStack.push(this.snapshot());
    this.restore(after);
    return true;
  }

  private snapshot(): string {
    return JSON.stringify({ scenes: this.project.scenes, variables: this.project.variables, credits: this.project.credits, completion: this.project.completion, assets: this.assets, theme: this.theme, ref: this.project.theme, slides: this.docs.map((d) => d.slide) });
  }

  private restore(snapshot: string): void {
    const state = JSON.parse(snapshot) as { scenes: Project["scenes"]; variables: Project["variables"]; credits: boolean; completion?: Project["completion"]; assets: CreditEntry[]; theme: Theme; ref: Project["theme"]; slides: Slide[] };
    this.project.scenes = state.scenes;
    this.project.variables = state.variables;
    this.project.credits = state.credits;
    if (state.completion) this.project.completion = state.completion;
    else delete (this.project as { completion?: unknown }).completion;
    this.assets = state.assets;
    this.theme = state.theme;
    this.project.theme = state.ref;
    // Reuse the record for a slide that still exists. A slide that comes back after being
    // deleted is treated as unsaved, so the next save writes its file again.
    this.docs = state.slides.map((slide) => {
      const existing = this.docs.find((d) => d.id === slide.id);
      if (existing) {
        existing.slide = slide;
        return existing;
      }
      return { id: slide.id, slide, originalText: "", savedCompact: "" };
    });
    if (!this.slide) {
      const first = this.docs[0]?.slide;
      this.sel = { slideId: first?.id ?? "", layerId: first?.baseLayer.id ?? "", objectId: null };
    } else if (!this.layer) {
      this.sel = { ...this.sel, layerId: this.slide.baseLayer.id, objectId: null };
    } else if (this.sel.objectId && !this.layer.objects.some((o) => o.id === this.sel.objectId)) {
      this.sel = { ...this.sel, objectId: null };
    }
    this.lastKey = "";
    this.emit({ kind: "structure" });
    this.emit({ kind: "selection" });
  }

  /** Call before changing anything. Changes with the same key in quick succession (holding
   *  an arrow key, typing in a field) share one undo step. */
  private record(key: string): void {
    if (this.gestureStart !== null) return;
    const now = Date.now();
    const coalesce = key !== "" && key === this.lastKey && now - this.lastTime < COALESCE_MS && this.undoStack.length > 0;
    this.lastKey = key;
    this.lastTime = now;
    if (!coalesce) this.pushUndo(this.snapshot());
    this.redoStack = [];
  }

  private pushUndo(snapshot: string): void {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  // ---- saving

  private isDirty(d: Doc): boolean {
    return JSON.stringify(d.slide) !== d.savedCompact;
  }

  private get projectDirty(): boolean {
    return JSON.stringify(this.project) !== this.projectSaved;
  }

  private get assetsDirty(): boolean {
    return JSON.stringify(this.assets) !== this.assetsSaved;
  }

  private get themeDirty(): boolean {
    return JSON.stringify(this.theme) !== this.themeSaved;
  }

  /** Slide files that exist on disk but no longer belong to the project. */
  removedFiles(): string[] {
    const keep = new Set(this.docs.map((d) => d.id));
    return [...this.onDisk].filter((id) => !keep.has(id)).map((id) => `slides/${id}.json`);
  }

  get dirty(): boolean {
    return this.projectDirty || this.themeDirty || this.assetsDirty || this.docs.some((d) => this.isDirty(d)) || this.removedFiles().length > 0;
  }

  /** Only the files that really changed, in the project's one canonical format. */
  dirtyFiles(): FileText[] {
    const files = this.docs.filter((d) => this.isDirty(d)).map((d) => ({ path: `slides/${d.id}.json`, text: canonical(d.slide) }));
    const theme = this.themeDirty && this.project.theme ? [{ path: "theme.json", text: canonical(this.theme) }] : [];
    const assets = this.assetsDirty ? [{ path: "assets.json", text: canonical({ assets: this.assets }) }] : [];
    return this.projectDirty ? [{ path: "project.json", text: canonical(this.project) }, ...theme, ...assets, ...files] : [...theme, ...assets, ...files];
  }

  /** Every file as the editor currently has it, for validating unsaved work. */
  allFiles(): FileText[] {
    return [
      { path: "project.json", text: this.projectDirty ? canonical(this.project) : this.projectText },
      ...(this.assets.length > 0 || this.assetsText ? [{ path: "assets.json", text: this.assetsDirty || !this.assetsText ? canonical({ assets: this.assets }) : this.assetsText }] : []),
      ...(this.project.theme ? [{ path: "theme.json", text: this.themeDirty || !this.themeText ? canonical(this.theme) : this.themeText }] : []),
      ...this.docs.map((d) => ({ path: `slides/${d.id}.json`, text: this.isDirty(d) ? canonical(d.slide) : d.originalText })),
    ];
  }

  /** Call after the files returned by dirtyFiles() and removedFiles() have been written. */
  markSaved(files: FileText[]): void {
    for (const f of files) {
      if (f.path === "project.json") {
        this.projectText = f.text;
        this.projectSaved = JSON.stringify(JSON.parse(f.text));
        continue;
      }
      if (f.path === "assets.json") {
        this.assetsText = f.text;
        this.assetsSaved = JSON.stringify((JSON.parse(f.text) as { assets: CreditEntry[] }).assets);
        continue;
      }
      if (f.path === "theme.json") {
        this.themeText = f.text;
        this.themeSaved = JSON.stringify(JSON.parse(f.text));
        continue;
      }
      const doc = this.docs.find((d) => `slides/${d.id}.json` === f.path);
      if (doc) {
        doc.originalText = f.text;
        doc.savedCompact = JSON.stringify(JSON.parse(f.text));
      }
    }
    this.onDisk = new Set(this.docs.map((d) => d.id));
    this.emit({ kind: "saved" });
  }
}
