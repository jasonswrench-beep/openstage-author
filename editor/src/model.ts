// The editor's data and every change it can make. No screen code lives here, so all of it
// is tested directly. The view only asks the model to do things and redraws when told.

import { ITEM_LIMITS } from "../../player/src/interactions.ts";
import { readingOrder, SHAPE_KINDS } from "../../player/src/stage.ts";
import { isBubbleKind, isBubbleTail } from "../../player/src/bubble.ts";
import { BACKGROUND_NAME, isBackgroundPicture } from "./backgrounds.ts";
import { referencesVariable, renameReferences } from "./values.ts";
import { importSlides, peopleProblem, type SetRead } from "./slidesets.ts";
import { isThemeRef, themeRefKnown } from "../../player/src/theme.ts";
import type { Bank, CaptureBase, CaptureProvenance, Character, CertificateContent, ChoiceQuiz, Condition, CreditEntry, DescriptionCue, Primitive, InputContent, InteractionContent, InteractionItem, Layer, OSObject, Project, QuizContent, ResultsContent, IconContent, ScenarioContent, ScenarioLine, Slide, Style, TableContent, Theme, Timing, Variable, Effect } from "../../player/src/types.ts";
import { INPUT_VARIABLE_TYPE } from "../../player/src/inputs.ts";
import { cloneTheme, DEFAULT_THEME } from "./themes.ts";
import { isExcluded } from "../../player/src/exclude.ts";
import { BLOCK_SIZES, buildActivation, buildBody, defaultValueFor, eventsFor, operatorsFor, parseVideoAddress, readRules, writeRules, type Rule, type RuleAction, type RuleItem, isCourseAction, buildSimpleText, isFontValue, isHexColor, readActivation, type Activation, type SimpleText, type TextBlock } from "./content.ts";
import { isPictureBox, box, BUBBLE_LOOK, BUBBLE_TEXT_COLOR, buildLayoutSlide, buildQuiz, emptyLayer, emptySlide, interactionById, inputById, layOut, newDownload, newEmbed, newTimer, newInput, newMedia, newInteraction, newInteractionItem, newObject, newScenario, newIcon, newNavigationButton, navigationButtonById, slugOf, SLIDE_LAYOUTS, textRole, toneOf, type Alloc, type NewKind, type QuizType } from "./factory.ts";
import { colorRef, contrastOf } from "./colors.ts";
import { ANNOUNCE_MAX, canHaveLooks, editableLook, isReadyLook, looksOf as looksInfoOf, lookLabel, lookNameProblem, type LookField, type LookInfo } from "./looks.ts";
import type { DeckSource, ObjectState } from "../../player/src/types.ts";
import type { Deck } from "./pptx/deck.ts";
import type { Tones } from "./pptx/convert.ts";
import type { Pkg } from "./pptx/package.ts";
import { prepareImport, type PreparedImport } from "./pptx/import.ts";
import { type StepPicture } from "./stepslides.ts";
import { buildLessonSlide, lessonCapture, LESSON_WORDS, type Lesson, type LessonOptions } from "./steplessons.ts";
import { baseFrom, baseOf, mergeSlide, untouched, type Merge } from "./stepbase.ts";
import type { Step } from "./steps.ts";
import { applyPlan, planResync, type ResyncPlan } from "./pptx/resync.ts";
import { cloneObjects, copyName } from "./clone.ts";
import type { ImportedQuestion } from "./questionimport.ts";
import { fillQuiz } from "./questionfill.ts";
import { applyEdit, quizKind, type QuestionEdit } from "./questionedit.ts";
import { alignBoxes, ALIGNMENTS, bounds, distributeBoxes, type Alignment, type Box } from "./align.ts";
import { expandGroups, groupBox, loneGroups, scaleBoxes, unitsOf, wholeGroup } from "./group.ts";
import { describeAnimation, validDuration, type Phase } from "./animation.ts";
import { EFFECTS } from "../../player/src/animation.ts";
import { TIMER_MAX_EXTEND, TIMER_MAX_SECONDS, TIMER_MIN_SECONDS, timerContentOf } from "../../player/src/timer.ts";
import { describeTiming, MAX_MS, MAX_STEP, plainSeconds } from "./timing.ts";
import { lookOf, withLook, CUSTOM_LOOK } from "./buttonlooks.ts";
import { gameById, gameOptions } from "./gamesets.ts";
import type { GameContent } from "./gameimport.ts";
import { templateById } from "./templates.ts";
import { castUse, cloneCast, draftProblems as castProblems, poseUse, tidyPerson, voiceChanges } from "./characters.ts";
import * as S from "./scenarioedit.ts";
import { downloadScript, isKnownVoice, isValidIpa, itemScript, langAfterVoiceChange, newNarration, questionScript, SPEED_MAX, SPEED_MIN, voiceOption, voiceTraits, type Narration } from "./narration.ts";

/** The format version this editor reads and writes. */
export const FORMAT_VERSION = "0.35.0";

/** A shape that is a speech or thought bubble, or text that sits in one. */
const isBubbleObject = (o: OSObject): boolean => (o.type === "shape" ? isBubbleKind(o.content["shape"]) : o.type === "text" && isBubbleKind(o.content["bubble"]));

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
  /** The interaction item the narration belongs to, or null when it is not an item's. */
  item: InteractionItem | null;
  /** The audio description of a video the narration belongs to, or null when it is not one's. */
  cue: DescriptionCue | null;
  /** The line of a scenario the narration belongs to, or null when it is not one's. */
  line: ScenarioLine | null;
  narration: Narration;
}

export type ChangeKind = "selection" | "geometry" | "content" | "structure" | "saved" | "clipboard";
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
/** The most audio descriptions one video can have (the format's limit). */
export const DESCRIPTION_LIMIT = 60;

/** What making or bringing up to date a lesson of a recording is asked to do. */
export interface LessonInput {
  recording: string;
  lesson?: Lesson;
  steps: readonly Step[];
  /** Pictures just taken and saved, by step id (for steps with no slide, and steps whose picture moment changed). */
  pictures: ReadonlyMap<string, StepPicture>;
  capturedAt?: string;
  /** Whether a slide for a step that is gone, which the author never changed, is taken away. It is not, unless this is true: the author is asked first. */
  removeGone?: boolean;
}

/** What it would come to, for the author to read before saying yes. */
export interface LessonPlan {
  /** The steps that need a new picture taken: those with no slide, and those whose picture moment changed. */
  needPictures: string[];
  make: number;
  update: number;
  remove: number;
  /** Slides with a part the author changed that the steps would also change: the author's stays. */
  kept: number;
  summary: string;
  /** Updating or taking away slides asks first; making slides that are missing does not. */
  needsConfirm: boolean;
}

interface LessonWork {
  lesson: Lesson;
  capture: string;
  make: { step: Step; index: number; slide: Slide; roles: Record<string, string>; picture: CaptureBase["picture"] }[];
  update: { slide: Slide; step: Step; index: number; merge: Merge }[];
  remove: Slide[];
  goneKept: Slide[];
  untracked: Slide[];
  needPictures: string[];
  /** How many steps already had a slide. */
  existing: number;
}

/** What changed on the slides that were brought up to date, in a few words. */
function changeWords(merges: Merge[]): string {
  const count = (parts: string[]): number => merges.filter((m) => [...m.replaced, ...m.added, ...m.removed].some((r) => parts.includes(r))).length;
  const out: string[] = [];
  for (const [parts, what] of [[["words"], "the words"], [["picture"], "the picture"], [["frame", "target", "elsewhere", "question", "answer"], "the place to point at"], [["heading"], "the heading"]] as const) {
    const n = count([...parts]);
    if (n > 0) out.push(`${what} on ${n}`);
  }
  return out.join(", ");
}

/** A time in a video as people write it: 1:05. */
export function clockText(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
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
  /** What Copy and Cut hold: copies of the objects, so editing an original afterwards does not change them. */
  private clip: { objects: OSObject[]; layers: Layer[]; slideId: string; layerId: string; tone: "light" | "dark" | "accent" } | null = null;
  /** How many times the clip has been pasted onto each layer, so pasting again does not land on top of the last paste. */
  private pasted = new Map<string, number>();
  /** Other objects chosen along with the main one. Only valid while the main one is still the one they were chosen with. */
  private more: { primary: string; ids: string[] } | null = null;
  /** Where a range of selected objects began, for Shift and click. */
  private anchor: string | null = null;
  private listeners: ((c: Change) => void)[] = [];
  /** The look the author is working on, for the selected object. Only what is shown: it is not in the course, so it is not undone. */
  private lookEdit: { objectId: string; look: string } | null = null;
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
    this.more = null;
    this.anchor = null;
    this.emit({ kind: "selection" });
  }

  selectLayer(id: string): void {
    if (!this.layers.some((l) => l.id === id) || id === this.sel.layerId) return;
    this.sel = { ...this.sel, layerId: id, objectId: null };
    this.more = null;
    this.anchor = null;
    this.emit({ kind: "selection" });
  }

  selectObject(id: string | null): void {
    if (id !== null && !this.layer?.objects.some((o) => o.id === id)) return;
    // Choosing one object ends a selection of several, even if the one chosen was already the main one.
    const hadMore = this.selected.length > 1;
    this.more = null;
    this.anchor = id;
    if (id === this.sel.objectId && !hadMore) return;
    this.sel = { ...this.sel, objectId: id };
    this.emit({ kind: "selection", ...(id ? { objectId: id } : {}) });
  }

  // ---- choosing several objects

  /** Everything selected on this layer: the main object and any chosen along with it, in reading order. */
  get selected(): OSObject[] {
    const layer = this.layer;
    const main = this.object;
    if (!layer || !main) return [];
    const ids = new Set([main.id, ...(this.more && this.more.primary === main.id ? this.more.ids : [])]);
    return readingOrder(layer.objects).filter((o) => ids.has(o.id));
  }

  /** Make these the selection, with `main` as the main one. */
  private setSelection(ids: string[], main: string): void {
    const unique = [...new Set(ids)];
    this.more = unique.length > 1 ? { primary: main, ids: unique.filter((i) => i !== main) } : null;
    this.sel = { ...this.sel, objectId: main };
    this.emit({ kind: "selection", objectId: main });
  }

  /** What is selected, in words, for announcing. */
  describeSelection(): string {
    const s = this.selected;
    if (s.length === 0) return "Nothing is selected.";
    if (s.length === 1) return `Selected ${this.describe(s[0]!)}`;
    const names = s.map((o) => o.name).join(", ");
    return this.selectedGroup ? `Group of ${s.length} objects selected: ${names}.` : `${s.length} objects selected: ${names}.`;
  }

  /** Add an object to the selection, or take it out if it is already there (Shift or Ctrl and click, Ctrl and Space). */
  toggleSelected(id: string): string | null {
    if (!this.layer?.objects.some((o) => o.id === id)) return null;
    const now = this.selected.map((o) => o.id);
    const had = now.includes(id);
    const ids = had ? now.filter((i) => i !== id) : [...now, id];
    this.anchor = id;
    if (ids.length === 0) {
      this.selectObject(null);
      return this.describeSelection();
    }
    this.setSelection(ids, had ? ids[ids.length - 1]! : id);
    return this.describeSelection();
  }

  /** Select every object from where the selection began, through this one, in reading order (Shift and click, Shift and arrow keys). */
  selectRange(toId: string): string | null {
    const layer = this.layer;
    if (!layer) return null;
    const order = readingOrder(layer.objects).map((o) => o.id);
    const to = order.indexOf(toId);
    if (to === -1) return null;
    const from = order.indexOf(this.anchor ?? this.sel.objectId ?? toId);
    const start = from === -1 ? to : from;
    if (this.anchor === null || !order.includes(this.anchor)) this.anchor = order[start]!;
    this.setSelection(order.slice(Math.min(start, to), Math.max(start, to) + 1), toId);
    return this.describeSelection();
  }

  /** Select exactly these objects (dragging a box round them). The first of them in reading order is the main one. */
  selectIds(ids: string[]): string | null {
    const layer = this.layer;
    if (!layer) return null;
    const chosen = readingOrder(layer.objects).filter((o) => ids.includes(o.id)).map((o) => o.id);
    if (chosen.length === 0) {
      this.selectObject(null);
      return this.describeSelection();
    }
    if (chosen.length === 1) {
      this.selectObject(chosen[0]!);
      return this.describeSelection();
    }
    this.anchor = chosen[0]!;
    this.setSelection(chosen, chosen[0]!);
    return this.describeSelection();
  }

  /** Select every object on the layer (Ctrl+A). */
  selectAll(): string {
    const layer = this.layer;
    const all = layer ? readingOrder(layer.objects).map((o) => o.id) : [];
    if (all.length === 0) return "There is nothing on this layer to select.";
    this.anchor = all[0]!;
    this.setSelection(all, this.sel.objectId && all.includes(this.sel.objectId) ? this.sel.objectId : all[0]!);
    return this.describeSelection();
  }

  /** Add the object after (+1) or before (-1) the selected ones, in reading order, to the selection (Shift and Page Down or Page Up). */
  extendSelection(delta: 1 | -1): string | null {
    const layer = this.layer;
    if (!layer) return null;
    const order = readingOrder(layer.objects);
    if (order.length === 0) return null;
    const now = this.selected;
    if (now.length === 0) {
      this.selectObject(order[delta > 0 ? 0 : order.length - 1]!.id);
      return this.describeSelection();
    }
    const at = now.map((o) => order.indexOf(o));
    const next = delta > 0 ? Math.max(...at) + 1 : Math.min(...at) - 1;
    if (next < 0 || next >= order.length) return delta > 0 ? "The last object is already selected." : "The first object is already selected.";
    this.setSelection([...now.map((o) => o.id), order[next]!.id], order[next]!.id);
    return this.describeSelection();
  }

  /** Select an object wherever it is, switching slide and layer as needed. */
  reveal(slideId: string, objectId: string): boolean {
    const where = this.locate(slideId, objectId);
    if (!where) return false;
    this.sel = { slideId, layerId: where.layerId, objectId };
    this.more = null;
    this.anchor = objectId;
    this.emit({ kind: "selection", objectId });
    return true;
  }

  // ---- groups

  /** The selection, if it is exactly one whole group: all of its members and nothing else. */
  get selectedGroup(): OSObject[] | null {
    const layer = this.layer;
    return layer ? wholeGroup(layer.objects, this.selected) : null;
  }

  /** How many objects are in this object's group, or 0 if it is in none. */
  groupSize(objectId: string): number {
    const tag = this.find(objectId)?.group;
    return tag ? (this.layer?.objects.filter((o) => o.group === tag).length ?? 0) : 0;
  }

  /** These ids, and everything grouped with any of them, on the layer being edited. */
  expandGroups(ids: string[]): string[] {
    return this.layer ? expandGroups(this.layer.objects, ids) : [];
  }

  /** How many things the selection is, counting a whole group as one. Line up and space out work on these. */
  get selectedUnits(): number {
    const layer = this.layer;
    return layer ? unitsOf(layer.objects, this.selected).length : 0;
  }

  /** Whether Group would do anything: two or more are selected and they are not already exactly one group. */
  get canGroup(): boolean {
    return this.selected.length >= 2 && this.selectedGroup === null;
  }

  /** Whether Ungroup would do anything: some selected object is in a group. */
  get canUngroup(): boolean {
    return this.selected.some((o) => o.group !== undefined);
  }

  /** Whether Select group would add anything: some selected object is grouped with one that is not selected. */
  get canSelectGroup(): boolean {
    const sel = this.selected;
    return sel.length > 0 && this.expandGroups(sel.map((o) => o.id)).length > sel.length;
  }

  /** Ids for new groups: ones no other group in the project uses. */
  private groupAllocator(): () => string {
    const used = new Set(this.docs.flatMap((d) => [d.slide.baseLayer, ...d.slide.layers].flatMap((l) => l.objects.flatMap((o) => (o.group ? [o.group] : [])))));
    let next = nextNumber([...used], "group-");
    return () => {
      let id = `group-${next++}`;
      while (used.has(id)) id = `group-${next++}`;
      used.add(id);
      return id;
    };
  }

  /** After objects leave a layer: a group left with one object groups nothing, so its tag is cleared. */
  private pruneGroups(layer: Layer): void {
    const lone = new Set(loneGroups(layer.objects));
    if (lone.size === 0) return;
    for (const o of layer.objects) if (o.group !== undefined && lone.has(o.group)) delete o.group;
  }

  /** Click on the canvas: choose this object and, if it is in a group, the whole group. */
  selectWithGroup(id: string): string | null {
    if (!this.layer?.objects.some((o) => o.id === id)) return null;
    const ids = this.expandGroups([id]);
    if (ids.length < 2) {
      this.selectObject(id);
      return this.describeSelection();
    }
    this.anchor = id;
    this.setSelection(ids, id);
    return this.describeSelection();
  }

  /** Shift or Ctrl and click on the canvas: add this object, with its whole group, to the selection, or take them out if all of them are in it already. */
  toggleGroupSelected(id: string): string | null {
    if (!this.layer?.objects.some((o) => o.id === id)) return null;
    const these = this.expandGroups([id]);
    const now = this.selected.map((o) => o.id);
    const allIn = these.every((i) => now.includes(i));
    const ids = allIn ? now.filter((i) => !these.includes(i)) : [...now, ...these.filter((i) => !now.includes(i))];
    this.anchor = id;
    if (ids.length === 0) {
      this.selectObject(null);
      return this.describeSelection();
    }
    this.setSelection(ids, allIn ? ids[ids.length - 1]! : id);
    return this.describeSelection();
  }

  /** Add to the selection everything grouped with a selected object (the Select group button). */
  selectGroup(): string | null {
    const sel = this.selected;
    if (sel.length === 0) return null;
    if (!sel.some((o) => o.group !== undefined)) return sel.length === 1 ? `${sel[0]!.name} is not in a group.` : "None of the selected objects is in a group.";
    const ids = this.expandGroups(sel.map((o) => o.id));
    if (ids.length === sel.length) return "The whole group is already selected.";
    this.setSelection(ids, this.sel.objectId ?? ids[0]!);
    return this.describeSelection();
  }

  /** Tie the selected objects into one group, as one undo step. An object that was in another group leaves it. */
  group(): string | null {
    const layer = this.layer;
    const sel = this.selected;
    if (!layer || sel.length === 0) return null;
    if (sel.length < 2) return "Choose two or more objects to group them. Shift and click adds an object to the selection.";
    if (this.selectedGroup) return `These ${sel.length} objects are already a group.`;
    this.record("");
    const tag = this.groupAllocator()();
    for (const o of sel) o.group = tag;
    // Leaving a group can leave it with one object, which groups nothing.
    this.pruneGroups(layer);
    this.emit({ kind: "structure", objectId: sel[0]!.id });
    return `Grouped ${sel.length} objects. Clicking one on the slide now chooses them all, and they move, resize, copy and delete together.`;
  }

  /** Break the groups of the selected objects apart, as one undo step. Everything that was in them stays selected. */
  ungroup(): string | null {
    const layer = this.layer;
    const sel = this.selected;
    if (!layer || sel.length === 0) return null;
    const tags = new Set(sel.flatMap((o) => (o.group !== undefined ? [o.group] : [])));
    if (tags.size === 0) return sel.length === 1 ? `${sel[0]!.name} is not in a group.` : "None of the selected objects is in a group.";
    const members = layer.objects.filter((o) => o.group !== undefined && tags.has(o.group));
    this.record("");
    for (const o of members) delete o.group;
    const ids = [...new Set([...sel.map((o) => o.id), ...members.map((o) => o.id)])];
    this.setSelection(ids, this.sel.objectId ?? ids[0]!);
    this.emit({ kind: "structure", objectId: sel[0]!.id });
    return `Ungrouped ${members.length} objects. They are separate again, and still selected.`;
  }

  // ---- changes to one object

  private find(objectId: string): OSObject | undefined {
    return this.layer?.objects.find((o) => o.id === objectId);
  }

  setGeometry(objectId: string, patch: Partial<Geometry>, key = ""): string | null {
    const obj = this.find(objectId);
    if (!obj) return null;
    // Place and size are what a lock protects. Stacking order is not, so it can still change.
    if (obj.locked && Object.keys(patch).some((k) => k !== "z")) return this.lockMessage(objectId);
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

  /**
   * Which of these objects can move. A group moves whole or not at all, so one locked object holds its whole group back. `heldUnits` counts
   * what was held back as the author sees it: a group is one.
   */
  movable(sel: OSObject[] = this.selected): { free: OSObject[]; held: OSObject[]; heldUnits: number; groups: boolean } {
    const layer = this.layer;
    const units = layer ? unitsOf(layer.objects, sel) : sel.map((o) => [o]);
    const free: OSObject[] = [];
    const held: OSObject[] = [];
    let heldUnits = 0;
    for (const unit of units) {
      if (unit.some((o) => o.locked)) {
        held.push(...unit);
        heldUnits++;
      } else {
        free.push(...unit);
      }
    }
    return { free, held, heldUnits, groups: units.some((u) => u.length > 1) };
  }

  /** Move the selected object, or all the selected objects together, by this much. */
  nudge(dx: number, dy: number): string | null {
    const sel = this.selected;
    if (sel.length === 0) return null;
    if (sel.length === 1) {
      const o = sel[0]!;
      return this.setGeometry(o.id, { x: o.geometry.x + dx, y: o.geometry.y + dy }, `move:${o.id}`);
    }
    const { free, held, heldUnits, groups } = this.movable(sel);
    if (free.length === 0) {
      return held.every((o) => o.locked)
        ? `All ${sel.length} selected objects are locked. Unlock them first to move them.`
        : "A locked object holds its group in place, so none of the selected objects can move. Unlock it first.";
    }
    // One key for the whole group, so the moves of one key press, and quick presses after it, are one undo step.
    const key = `move:${free.map((o) => o.id).join("+")}`;
    let moved = 0;
    for (const o of free) if (this.setGeometry(o.id, { x: o.geometry.x + dx, y: o.geometry.y + dy }, key)) moved++;
    if (moved === 0) return null;
    const box = bounds(free.map((o) => o.geometry));
    const layer = this.layer;
    const name = layer && wholeGroup(layer.objects, free) ? `Group of ${free.length} objects` : free.length === 1 ? free[0]!.name : `${free.length} objects`;
    return `${name}, at ${box.x}, ${box.y}${heldUnits > 0 ? `.${this.stayedNote(heldUnits, groups ? "item" : "object")}` : ""}`;
  }

  resizeBy(dw: number, dh: number): string | null {
    const group = this.selectedGroup;
    if (group) {
      const box = groupBox(group);
      return this.setGroupBox({ width: Math.max(1, box.width + dw), height: Math.max(1, box.height + dh) }, `size:${group[0]!.group}`);
    }
    if (this.selected.length > 1) return "Resizing works on one object, or one whole group, at a time. Choose one, or type exact sizes in the Properties panel.";
    const o = this.object;
    if (!o) return null;
    const width = Math.max(1, o.geometry.width + dw);
    const height = Math.max(1, o.geometry.height + dh);
    return this.setGeometry(o.id, { width, height }, `size:${o.id}`);
  }

  /**
   * Place or size the selected group as one thing: its members are moved and scaled together, so each keeps its place and size relative to
   * the rest. Text is not made bigger or smaller, only the boxes. Returns a message when it is refused, and null when nothing changed.
   */
  setGroupBox(patch: Partial<Box>, key = ""): string | null {
    const members = this.selectedGroup;
    if (!members) return null;
    if (members.some((o) => o.locked)) return "The group has a locked object in it. Unlock that object first to move or resize the group.";
    const from = groupBox(members);
    const to: Box = { ...from };
    for (const [k, v] of Object.entries(patch) as [keyof Box, number][]) {
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      to[k] = Math.round(v * 100) / 100;
    }
    if (to.width < 1 || to.height < 1) return null;
    const next = scaleBoxes(members.map((o) => o.geometry), from, to);
    if (members.every((o, i) => o.geometry.x === next[i]!.x && o.geometry.y === next[i]!.y && o.geometry.width === next[i]!.width && o.geometry.height === next[i]!.height)) return null;
    this.record(key);
    members.forEach((o, i) => {
      o.geometry = { ...o.geometry, ...next[i]! };
      this.emit({ kind: "geometry", objectId: o.id });
    });
    const now = groupBox(members);
    return `Group of ${members.length} objects, at ${now.x}, ${now.y}, size ${now.width} by ${now.height}`;
  }

  /** Edits made as one drag: many setGeometry calls, one undo step. */
  beginGesture(): void {
    this.gestureStart = this.snapshot();
  }

  endGesture(): void {
    const before = this.gestureStart;
    this.gestureStart = null;
    if (before !== null && before !== this.snapshot()) {
      this.pushUndo(before);
      this.redoStack = [];
      // The moves of the drag each said "geometry" while the undo step did not exist yet, so the Undo button needs telling now.
      this.emit({ kind: "selection" });
    }
  }

  setAccessibility(objectId: string, patch: Partial<Accessibility>): string | null {
    const obj = this.find(objectId);
    if (!obj) return null;
    const next = { ...obj.accessibility, ...patch };
    if (next.tabOrder !== null && (!Number.isInteger(next.tabOrder) || next.tabOrder < 0)) return null;
    // A suggested description is only waiting for the author to decide. Once they write their own, or say the object is decorative, it has done its job.
    if (next.altSuggestion !== undefined && patch.altSuggestion === undefined && (next.decorative || next.altText.trim() !== "")) delete next.altSuggestion;
    if (JSON.stringify(next) === JSON.stringify(obj.accessibility)) return null;
    this.record(`a11y:${objectId}:${Object.keys(patch).join(",")}`);
    obj.accessibility = next;
    this.emit({ kind: "content", objectId });
    return `${obj.name} updated`;
  }

  /**
   * Use the description that was suggested for an object (worked out from a recording, never approved) as its alt text. The suggestion is taken away, because it has been used.
   * The sentence tells the author to read it against the picture: it is the author's only once they have.
   */
  useAltSuggestion(objectId: string): string | null {
    const obj = this.find(objectId);
    const suggestion = obj?.accessibility.altSuggestion;
    if (!obj || !suggestion) return null;
    this.record(`a11y:${objectId}:use-suggestion`);
    const { altSuggestion: _used, ...rest } = obj.accessibility;
    obj.accessibility = { ...rest, altText: suggestion.text, decorative: false };
    this.emit({ kind: "content", objectId });
    return `Used the suggested description for ${obj.name}. Read it against the picture and change it if it is wrong. Press Control Z to undo.`;
  }

  /** Throw away the suggested description of an object. Its alt text is as it was, which is still asked for if it is empty. */
  dismissAltSuggestion(objectId: string): string | null {
    const obj = this.find(objectId);
    if (!obj || !obj.accessibility.altSuggestion) return null;
    this.record(`a11y:${objectId}:dismiss-suggestion`);
    const { altSuggestion: _gone, ...rest } = obj.accessibility;
    obj.accessibility = rest;
    this.emit({ kind: "content", objectId });
    return `Threw away the suggested description for ${obj.name}.${obj.accessibility.altText.trim() === "" && !obj.accessibility.decorative ? " It still needs alt text, or to be marked decorative." : ""}`;
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
    // A tail goes with a bubble: a shape made into one has its tail on the left, and one made into anything else has no tail.
    const { tail: oldTail, ...rest } = obj.content;
    obj.content = isBubbleKind(shape) ? { ...rest, shape, tail: isBubbleTail(oldTail) ? oldTail : "left" } : { ...rest, shape };
    this.emit({ kind: "structure", objectId });
    return `Shape changed to ${shape}`;
  }

  /** Where the words of a text object sit across its box: "left" (how text starts, so it is not written down), "center" or "right". Justified text is not offered, because the uneven spaces are hard to read. */
  setTextAlign(objectId: string, value: string): string | null {
    const obj = this.find(objectId);
    if (!obj || obj.type !== "text" || !["left", "center", "right"].includes(value)) return null;
    const now = obj.style["textAlign"] ?? "left";
    if (now === value) return null;
    this.record(`align:${objectId}`);
    const { textAlign: _was, ...rest } = obj.style;
    obj.style = value === "left" ? rest : { ...rest, textAlign: value };
    this.emit({ kind: "content", objectId });
    return value === "left" ? "Words on the left" : value === "center" ? "Words in the centre" : "Words on the right";
  }

  /** Where the words of a text object start in its box: "top" (how text starts, so it is not written down), "middle" or "bottom". */
  setTextVertical(objectId: string, value: string): string | null {
    const obj = this.find(objectId);
    if (!obj || obj.type !== "text" || !["top", "middle", "bottom"].includes(value)) return null;
    const now = obj.style["verticalAlign"] === "middle" || obj.style["verticalAlign"] === "bottom" ? String(obj.style["verticalAlign"]) : "top";
    if (now === value) return null;
    this.record(`vertical:${objectId}`);
    const { verticalAlign: _was, ...rest } = obj.style;
    obj.style = value === "top" ? rest : { ...rest, verticalAlign: value };
    this.emit({ kind: "content", objectId });
    return value === "top" ? "Words start at the top of the box" : value === "middle" ? "Words sit in the middle of the box" : "Words sit at the bottom of the box";
  }

  /**
   * How big a list inside a list is, as a percent of the list it is in (50 to 150, one level after another). 100, or blank, is how text starts, so nothing is written.
   * Returns a sentence if it is refused, or says what it did.
   */
  setNestedSize(objectId: string, percent: number | null): { ok: boolean; message: string } {
    const obj = this.find(objectId);
    if (!obj || obj.type !== "text") return { ok: false, message: "" };
    if (percent !== null && !(Number.isFinite(percent) && percent >= 50 && percent <= 150)) return { ok: false, message: "A deeper level of a list is from 50 to 150 percent of the level above it." };
    const next = percent === null || percent === 100 ? null : Math.round(percent) / 100;
    const now = typeof obj.style["nestedSize"] === "number" ? obj.style["nestedSize"] : null;
    if (next === now) return { ok: true, message: "" };
    this.record(`nested:${objectId}`);
    const { nestedSize: _was, ...rest } = obj.style;
    obj.style = next === null ? rest : { ...rest, nestedSize: next };
    this.emit({ kind: "content", objectId });
    return { ok: true, message: next === null ? "Deeper levels of a list are the same size as the level above" : `Each deeper level of a list is ${Math.round(next * 100)} percent of the level above` };
  }

  /** Whether the words of a text object shrink to fit when there are more than its box holds. Off is how text starts, so it is not written down. */
  setTextFit(objectId: string, on: boolean): string | null {
    const obj = this.find(objectId);
    if (!obj || obj.type !== "text" || (obj.style["autoFit"] === "shrink") === on) return null;
    this.record(`fit:${objectId}`);
    const { autoFit: _was, ...rest } = obj.style;
    obj.style = on ? { ...rest, autoFit: "shrink" } : rest;
    this.emit({ kind: "content", objectId });
    return on ? "Words shrink to fit the box, to no less than half their size or 12 pixels" : "Words keep their size, and run past the box if there are too many";
  }

  /** Which side of a bubble (a speech or thought bubble shape, or text in a bubble) its tail is on. */
  setBubbleTail(objectId: string, tail: string): string | null {
    const obj = this.find(objectId);
    if (!obj || !isBubbleTail(tail) || !isBubbleObject(obj) || obj.content["tail"] === tail) return null;
    this.record(`tail:${objectId}`);
    obj.content = { ...obj.content, tail };
    this.emit({ kind: "content", objectId });
    return `Tail on the ${tail}`;
  }

  /**
   * Put the words of a text object in a speech or thought bubble, or take them out ("" is not a bubble). Making one gives it the panel colour and outline a new bubble has and
   * the theme's text colour, unless it has colours of its own; taking it out takes those colours away, so the words are plain text again.
   */
  setTextBubble(objectId: string, kind: string): string | null {
    const obj = this.find(objectId);
    if (!obj || obj.type !== "text") return null;
    const now = isBubbleKind(obj.content["bubble"]) ? obj.content["bubble"] : "";
    if (kind === now || (kind !== "" && !isBubbleKind(kind))) return null;
    this.record(`bubble:${objectId}`);
    const { bubble: _bubble, tail: _tail, ...rest } = obj.content;
    if (kind === "") {
      obj.content = rest;
      const { fill: _fill, stroke: _stroke, strokeWidth: _width, ...style } = obj.style;
      obj.style = style;
      this.emit({ kind: "structure", objectId });
      return "Plain text again, without the bubble";
    }
    obj.content = { ...rest, bubble: kind, tail: isBubbleTail(obj.content["tail"]) ? obj.content["tail"] : "left" };
    if (now === "") {
      const own = obj.style;
      obj.style = { ...own, fill: own["fill"] ?? BUBBLE_LOOK.fill, stroke: own["stroke"] ?? BUBBLE_LOOK.stroke, strokeWidth: own["strokeWidth"] ?? BUBBLE_LOOK.strokeWidth, textAlign: own["textAlign"] ?? "center", ...(own["fill"] === undefined ? { color: BUBBLE_TEXT_COLOR } : {}) };
    }
    this.emit({ kind: "structure", objectId });
    return kind === "speech" ? "In a speech bubble" : "In a thought bubble";
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

  /**
   * Set one style value on the object, or on one of its looks. An empty string removes it (on a look, that means "the same as normal").
   * Returns an explanation if it is refused. How solid an object is (`opacity`) is typed as a percentage from 10 to 100 and kept as 0.1 to 1.
   */
  setStyle(objectId: string, key: LookField, value: string, look = "normal"): { ok: boolean; message: string } {
    const obj = this.find(objectId);
    if (!obj) return { ok: false, message: "" };
    const onLook = look !== "normal";
    if (onLook && !editableLook(obj, look)) return { ok: false, message: "This object has no look with that name." };
    const before: Style = onLook ? obj.states[look]?.style ?? {} : obj.style;
    const style: Style = { ...before };
    const v = value.trim();
    if (v === "") delete style[key];
    else if (isThemeRef(v)) {
      // A reference to the theme: a colour for a colour property, a font for the font, and it must exist.
      const wanted = key === "fontFamily" ? "theme:font." : "theme:color.";
      if (key === "fontSize" || key === "strokeWidth" || key === "opacity" || !v.startsWith(wanted) || !this.knows(v)) {
        return { ok: false, message: "That theme colour or font does not exist in this theme." };
      }
      style[key] = v;
    } else if (key === "strokeWidth") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 40) return { ok: false, message: "Outline width must be a number from 0 to 40." };
      style[key] = n;
    } else if (key === "opacity") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 10 || n > 100) return { ok: false, message: "How solid it is must be a number from 10 to 100. 100 is fully solid." };
      // Fully solid is how every object starts, so on the object itself it is simply "not set". A look keeps it, to undo a fade.
      if (n === 100 && !onLook) delete style[key];
      else style[key] = Math.round(n) / 100;
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
    if (JSON.stringify(style) === JSON.stringify(before)) return { ok: true, message: "" };
    this.record(`style:${objectId}:${look}:${key}`);
    if (onLook) this.writeLook(obj, look, { style });
    else obj.style = style;
    this.emit({ kind: "content", objectId });
    return { ok: true, message: onLook ? "Look updated" : "Style updated" };
  }

  // ---- looks (the format calls them states)

  /** The looks of an object: the three the course applies on its own, then any other it has. */
  looksOf(objectId: string): LookInfo[] {
    const obj = this.find(objectId);
    return obj ? looksInfoOf(obj) : [];
  }

  /** Which look the author is working on for this object. "normal" is its own appearance, in the Appearance box. */
  editingLookOf(objectId: string): string {
    const e = this.lookEdit;
    const obj = this.find(objectId);
    return e && obj && e.objectId === objectId && editableLook(obj, e.look) ? e.look : "normal";
  }

  /** Choose the look to work on. This is only what is shown, not part of the course, so it is not undone. */
  setEditingLook(objectId: string, look: string): void {
    const obj = this.find(objectId);
    if (!obj || !editableLook(obj, look)) return;
    this.lookEdit = look === "normal" ? null : { objectId, look };
    this.emit({ kind: "selection", objectId });
  }

  /** The look to show on the canvas: the selected object in the look being worked on, so the author sees what they are making. */
  get lookPreview(): { objectId: string; look: string } | null {
    const o = this.object;
    const e = this.lookEdit;
    if (!e || !o || this.selected.length !== 1 || o.id !== e.objectId || e.look === "normal" || !editableLook(o, e.look)) return null;
    return { objectId: e.objectId, look: e.look };
  }

  /** Put a look's style or message back. A ready-made look left holding nothing is dropped, so no empty look lingers. */
  private writeLook(obj: OSObject, look: string, patch: { style?: Style; announce?: string }): void {
    const next: ObjectState = { ...(obj.states[look] ?? {}) };
    if (patch.style !== undefined) next.style = patch.style;
    if (patch.announce !== undefined) {
      if (patch.announce === "") delete next.announce;
      else next.announce = patch.announce;
    }
    const empty = Object.keys(next.style ?? {}).length === 0 && next.announce === undefined && next.content === undefined;
    const states = { ...obj.states };
    if (empty && isReadyLook(look)) delete states[look];
    // A look is never an empty object: the format wants something in it, and an author's own look stays until they delete it.
    else states[look] = Object.keys(next).length === 0 ? { style: {} } : next;
    obj.states = states;
  }

  /** Give the object a look of its own. It starts the same as normal, for the author to change. */
  addLook(objectId: string, name: string): { ok: boolean; message: string } {
    const obj = this.find(objectId);
    if (!obj) return { ok: false, message: "" };
    if (!canHaveLooks(obj.type)) return { ok: false, message: `A ${obj.type} object cannot have looks.` };
    const clean = name.trim();
    const problem = lookNameProblem(clean, Object.keys(obj.states));
    if (problem) return { ok: false, message: problem };
    this.record("");
    obj.states = { ...obj.states, [clean]: { style: {} } };
    this.lookEdit = { objectId, look: clean };
    this.emit({ kind: "structure", objectId });
    return { ok: true, message: `Added the look ${clean}. It starts the same as normal: choose what is different below.` };
  }

  /** Rename one of the object's own looks. Rules that apply it follow the new name. */
  renameLook(objectId: string, from: string, to: string): { ok: boolean; message: string } {
    const obj = this.find(objectId);
    if (!obj || !(from in obj.states)) return { ok: false, message: "" };
    if (isReadyLook(from)) return { ok: false, message: `${lookLabel(from)} is a ready-made look, so its name stays.` };
    const clean = to.trim();
    if (clean === from) return { ok: true, message: "" };
    const problem = lookNameProblem(clean, Object.keys(obj.states).filter((n) => n !== from));
    if (problem) return { ok: false, message: problem };
    const moved = this.lookUses(objectId, from);
    this.record("");
    // Keep the looks in the order they were made.
    obj.states = Object.fromEntries(Object.entries(obj.states).map(([name, state]) => [name === from ? clean : name, state]));
    for (const layer of this.layers) {
      for (const o of layer.objects) {
        for (const t of o.triggers) if (t.action === "changeState" && t.target === objectId && String(t.value ?? "normal") === from) t.value = clean;
      }
    }
    if (this.lookEdit?.objectId === objectId && this.lookEdit.look === from) this.lookEdit = { objectId, look: clean };
    this.emit({ kind: "structure", objectId });
    return { ok: true, message: `Renamed the look to ${clean}.${moved > 0 ? ` ${moved} rule${moved === 1 ? " now applies" : "s now apply"} the new name.` : ""}` };
  }

  /** Delete one of the object's own looks, or clear a ready-made one back to "not set". Rules that apply it are left, for the Problems list to name. */
  removeLook(objectId: string, name: string): string | null {
    const obj = this.find(objectId);
    if (!obj || !(name in obj.states)) return null;
    const uses = this.lookUses(objectId, name);
    this.record("");
    const states = { ...obj.states };
    delete states[name];
    obj.states = states;
    if (this.lookEdit?.objectId === objectId && this.lookEdit.look === name && !isReadyLook(name)) this.lookEdit = null;
    this.emit({ kind: "structure", objectId });
    const what = isReadyLook(name) ? `Cleared the ${lookLabel(name)} look` : `Deleted the look ${name}`;
    return uses > 0 ? `${what}. ${uses} rule${uses === 1 ? " still applies" : "s still apply"} it, and the Problems list names ${uses === 1 ? "it" : "them"}.` : `${what}.`;
  }

  /** What a screen reader says when a rule applies this look. Blank removes it. */
  setLookAnnounce(objectId: string, look: string, text: string): { ok: boolean; message: string } {
    const obj = this.find(objectId);
    if (!obj || look === "normal" || !editableLook(obj, look)) return { ok: false, message: "" };
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length > ANNOUNCE_MAX) return { ok: false, message: `A spoken message can be up to ${ANNOUNCE_MAX} characters. Keep it short.` };
    if ((obj.states[look]?.announce ?? "") === clean) return { ok: true, message: "" };
    this.record(`announce:${objectId}:${look}`);
    this.writeLook(obj, look, { announce: clean });
    this.emit({ kind: "content", objectId });
    return { ok: true, message: clean === "" ? "Spoken message removed" : "Spoken message updated" };
  }

  /** An object anywhere on the slide being edited, whichever layer it is on. */
  private slideObject(objectId: string): OSObject | undefined {
    return this.layers.flatMap((l) => l.objects).find((o) => o.id === objectId);
  }

  /** How many rules on this slide apply this look to this object. */
  lookUses(objectId: string, look: string): number {
    let n = 0;
    for (const layer of this.layers) {
      for (const o of layer.objects) {
        for (const item of readRules(o.triggers)) {
          const t = item.kind === "rule" ? { action: item.rule.action as string, target: item.rule.target, value: item.rule.value } : item.triggers[0]!;
          if (t.action === "changeState" && t.target === objectId && String(t.value ?? "normal") === look) n++;
        }
      }
    }
    return n;
  }

  /** The looks a rule can switch an object of this slide to: its own appearance, then each look it has. */
  lookChoices(targetId: string): { value: string; label: string }[] {
    const obj = this.slideObject(targetId);
    if (!obj) return [];
    return [{ value: "normal", label: "Normal (its own appearance)" }, ...Object.keys(obj.states).map((n) => ({ value: n, label: lookLabel(n) }))];
  }

  /** The words a screen reader will say when a rule applies this look, or null if it will say nothing. */
  lookMessage(targetId: string, look: string): string | null {
    const said = this.slideObject(targetId)?.states[look]?.announce;
    return said ? said : null;
  }

  /** Whether a screen reader user would miss a rule's change: the look has no message, it is not "normal" or "disabled" (which say so already), and the object is not decorative. */
  lookIsSilent(targetId: string, look: string): boolean {
    const obj = this.slideObject(targetId);
    return !!obj && look !== "normal" && look !== "disabled" && look in obj.states && !obj.states[look]!.announce && !obj.accessibility.decorative;
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
  addObject(kind: NewKind, opts: { imageSrc?: string; size?: { w: number; h: number }; shape?: string; bubble?: "speech" | "thought" } = {}): OSObject | null {
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
   * Put a picture in a grey picture box from a layout: the box is taken away and the picture takes its place, as large as fits inside the box (in the
   * picture's own proportions) and centred in it. The picture is described by `alt`, which the author is told to check, unless it is decorative.
   * `credit` is the record of where a library picture came from. One undo step. Null if the box is not a picture box on the layer being edited.
   */
  fillPictureBox(boxId: string, picture: { src: string; size?: { w: number; h: number }; name: string; alt: string; decorative?: boolean; credit?: CreditEntry }): OSObject | null {
    const layer = this.layer;
    const at = layer ? layer.objects.findIndex((o) => o.id === boxId) : -1;
    const box = layer && at !== -1 ? layer.objects[at]! : null;
    if (!layer || !box || !isPictureBox(box) || !picture.src.startsWith("assets/")) return null;
    const obj = newObject("image", this.placement(this.allocator().object()), { imageSrc: picture.src, ...(picture.size ? { size: picture.size } : {}) });
    const g = box.geometry;
    const scale = picture.size ? Math.min(g.width / picture.size.w, g.height / picture.size.h) : 1;
    const w = picture.size ? Math.round(picture.size.w * scale) : g.width;
    const h = picture.size ? Math.round(picture.size.h * scale) : g.height;
    obj.geometry = { ...obj.geometry, x: Math.round(g.x + (g.width - w) / 2), y: Math.round(g.y + (g.height - h) / 2), width: w, height: h, z: g.z };
    obj.name = picture.name;
    obj.accessibility = picture.decorative
      ? { ...obj.accessibility, altText: "", role: "presentation", tabOrder: 0, decorative: true }
      : { ...obj.accessibility, altText: picture.alt };
    this.record("");
    layer.objects.splice(at, 1, obj);
    if (picture.credit) {
      const known = this.assets.findIndex((a) => a.path === picture.credit!.path);
      if (known === -1) this.assets.push(picture.credit); else this.assets[known] = picture.credit;
    }
    this.sel = { ...this.sel, objectId: obj.id };
    this.emit({ kind: "structure", objectId: obj.id });
    return obj;
  }

  /**
   * Put a picture from a character pack on the slide as an image, with the pack's words for it as the alt text (the author is told to read them, and can change them or mark the
   * picture decorative) and a record of where it came from. One undo step. `size` is the picture's own size, so it is placed in proportion.
   */
  addPackPicture(picture: { src: string; size?: { w: number; h: number }; name: string; alt: string; credit: CreditEntry }): OSObject | null {
    const layer = this.layer;
    if (!layer || !picture.src.startsWith("assets/")) return null;
    const obj = newObject("image", this.placement(this.allocator().object()), { imageSrc: picture.src, ...(picture.size ? { size: picture.size } : {}) });
    obj.name = picture.name;
    obj.accessibility = { ...obj.accessibility, altText: picture.alt };
    this.record("");
    layer.objects.push(obj);
    const at = this.assets.findIndex((a) => a.path === picture.credit.path);
    if (at === -1) this.assets.push(picture.credit); else this.assets[at] = picture.credit;
    this.sel = { ...this.sel, objectId: obj.id };
    this.emit({ kind: "structure", objectId: obj.id });
    return obj;
  }

  /**
   * Add a question to the layer being edited: its prompt, its answers, and two feedback layers
   * on the slide, all wired together. Selects the question.
   */
  /**
   * Add a slide from a ready-made lesson slide: its text, and the parts that are not text (buttons already wired, a question with its
   * feedback, a scenario). It is added after the slide the author is on, as one undo step, and is an ordinary slide afterwards.
   */
  addTemplateSlide(templateId: string): Slide | null {
    const template = templateById(templateId);
    if (!template) return null;
    const ids = [...this.docs.map((d) => d.id), ...this.project.scenes.flatMap((s) => s.slides)];
    const id = `slide-${String(nextNumber(ids, "slide-")).padStart(3, "0")}`;
    this.record("");
    const alloc = this.allocator(emptySlide(id, ""));
    const built = template.build(alloc);
    const slide: Slide = {
      ...emptySlide(id, template.name),
      background: template.layout.background ?? null,
      baseLayer: { id: "layer-base", name: "Base", objects: built.objects },
      layers: built.layers,
    };
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
   * Add a ready-made game: several slides that jump between each other, and the variables and rules that make it play (see gamesets.ts). The slides
   * go after the one the author is on, in order, and the first is selected. It is one undo step, which takes the slides, the variables and any change
   * to the course's completion setting back together. What it makes is ordinary slides, not tied to the game afterwards.
   * Returns the slides and what to tell the author, or null if there is no such game.
   */
  addGameSet(gameId: string, raw: Record<string, unknown> = {}, content?: GameContent): { slides: Slide[]; notes: string[] } | null {
    const set = gameById(gameId);
    if (!set) return null;
    const options = gameOptions(set, raw);
    // What a table gave the game counts only if it is for this game.
    const given = content && content.kind === set.id ? content : undefined;
    this.record("");
    const built = set.build({
      alloc: this.allocator(emptySlide("", "")),
      slideId: this.slideIdMaker(),
      variable: (type, name) => this.makeVariable(type, name),
      variableNames: () => this.project.variables.map((v) => v.name),
    }, options, given);
    const notes = [...built.notes];
    if (set.completion === "last" && this.completion === "all") {
      this.project.completion = { slides: "last" };
      notes.push("The course now counts as complete when the learner reaches the last slide and has finished every quiz, because learners visit this game's slides in any order. You can change this in the course settings.");
    }
    const scene = this.project.scenes.find((s) => s.slides.includes(this.sel.slideId)) ?? this.project.scenes[0]!;
    const at = scene.slides.indexOf(this.sel.slideId);
    scene.slides.splice(at === -1 ? scene.slides.length : at + 1, 0, ...built.slides.map((s) => s.id));
    for (const slide of built.slides) this.docs.push({ id: slide.id, slide, originalText: "", savedCompact: "" });
    this.syncDocOrder();
    const first = built.slides[0]!;
    this.sel = { slideId: first.id, layerId: first.baseLayer.id, objectId: null };
    this.emit({ kind: "structure" });
    this.emit({ kind: "selection" });
    return { slides: built.slides, notes };
  }

  /**
   * Add the slides of a set (slides handed over as one file; see slidesets.ts) after the slide being edited, as one undo step. Their pictures have already been copied into
   * the project (`pictures` says where each one went). The slides get ids of their own and the set's variables become new variables here, so a set added twice does not share
   * what it remembers; the set's people are added unless the course already has them; where it came from is kept in the credits. Returns the slides and what to tell the
   * author, or words if the set cannot be added (nothing is changed then).
   */
  addSlideSet(read: SetRead, pictures: ReadonlyMap<string, string>): { slides: Slide[]; notes: string[] } | string {
    const problem = peopleProblem(read, this.characters);
    if (problem) return problem;
    this.record("");
    let imported;
    try {
      const alloc = this.allocator(emptySlide("", ""));
      imported = importSlides(read, {
        slide: this.slideIdMaker(),
        object: () => alloc.object(),
        variable: (type, name, initial) => {
          const id = this.makeVariable(type, name);
          const made = this.project.variables.find((v) => v.id === id)!;
          made.initial = initial;
          return id;
        },
        nameOf: (id) => this.variableName(id),
      }, pictures);
    } catch (err) {
      const before = this.undoStack.pop();
      if (before !== undefined) this.restore(before);
      return err instanceof Error ? err.message : String(err);
    }
    const notes: string[] = [];
    const have = new Set(this.characters.map((c) => c.id));
    const people = imported.characters.filter((c) => !have.has(c.id));
    if (people.length > 0) {
      this.project.characters = [...this.characters, ...people];
      notes.push(`${people.length === 1 ? "One person was" : `${people.length} people were`} added to the cast: ${people.map((p) => p.name).join(", ")}.`);
    }
    for (const c of imported.credits) {
      const at = this.assets.findIndex((a) => a.path === c.path);
      if (at === -1) this.assets.push(c); else this.assets[at] = c;
    }
    if (imported.credits.some((c) => c.source.requiresCredit) && !this.project.credits) {
      this.project.credits = true;
      notes.push("The course now shows a credits page, because some of the set's pictures or sounds need to be credited.");
    }
    if (read.set.completion === "last" && this.completion === "all") {
      this.project.completion = { slides: "last" };
      notes.push("The course now counts as complete when the learner reaches the last slide and has finished every quiz, because this set sends learners to its slides in any order. You can change this in the course settings.");
    }
    const stage = this.project.stage;
    if (read.set.stage.width !== stage.width || read.set.stage.height !== stage.height) {
      notes.push(`These slides were made for a stage ${read.set.stage.width} by ${read.set.stage.height} and this course's is ${stage.width} by ${stage.height}, so they may not fit it. Check each slide.`);
    }
    if (read.migrated) notes.push("The set was made with an older version of the format, and has been brought up to date.");
    if (imported.renamed.length > 0) notes.push(`${imported.renamed.length === 1 ? "A variable was" : `${imported.renamed.length} variables were`} renamed because the course already had one with that name: ${imported.renamed.map(([a, b]) => `${a} is now ${b}`).join("; ")}.`);
    notes.push(...read.notes);
    const scene = this.project.scenes.find((s) => s.slides.includes(this.sel.slideId)) ?? this.project.scenes[0]!;
    const at = scene.slides.indexOf(this.sel.slideId);
    scene.slides.splice(at === -1 ? scene.slides.length : at + 1, 0, ...imported.slides.map((s) => s.id));
    for (const slide of imported.slides) this.docs.push({ id: slide.id, slide, originalText: "", savedCompact: "" });
    this.syncDocOrder();
    const first = imported.slides[0]!;
    this.sel = { slideId: first.id, layerId: first.baseLayer.id, objectId: null };
    this.emit({ kind: "structure" });
    this.emit({ kind: "selection" });
    return { slides: imported.slides, notes };
  }

  addQuiz(type: QuizType, opts: { imageSrc?: string } = {}): OSObject | null {
    const layer = this.layer;
    const slide = this.slide;
    const kind = quizKind(type);
    if (!layer || !slide || !kind) return null;
    const alloc = this.allocator();
    const where = this.placement("");
    // Below what is already on the layer, as far as the slide has room: the heading, a gap, and the question.
    const bottom = layer.objects.reduce((m, o) => Math.max(m, o.geometry.y + o.geometry.height), 0);
    const room = this.project.stage.height - 110 - kind.size.h;
    const built = buildQuiz(type, alloc, { tone: this.tone(), y: layer.objects.length === 0 ? Math.min(60, Math.max(20, room)) : Math.max(20, Math.min(bottom + 24, room)), z: where.z, tab: where.tabOrder, ...(opts.imageSrc ? { imageSrc: opts.imageSrc } : {}) });
    this.record("");
    layer.objects.push(...built.objects);
    slide.layers.push(...built.layers);
    const quiz = built.objects[1]!;
    this.sel = { ...this.sel, objectId: quiz.id };
    this.emit({ kind: "structure", objectId: quiz.id });
    return quiz;
  }

  // ---- PowerPoint decks

  /** The decks slides were imported from. */
  get deckSources(): DeckSource[] {
    return this.project.sources ?? [];
  }

  private slideIdMaker(): () => string {
    const used = new Set([...this.docs.map((d) => d.id), ...this.project.scenes.flatMap((s) => s.slides)]);
    return () => {
      const id = `slide-${String(nextNumber([...used], "slide-")).padStart(3, "0")}`;
      used.add(id);
      return id;
    };
  }

  /** Everything needed to bring slides in from a deck, worked out without changing the project. The picture files have to be saved before `commitDeckImport`. */
  prepareDeckImport(deck: Deck, pkg: Pkg, fileName: string, chosen: number[], now: string = new Date().toISOString(), tones?: Tones, options: { notesAsNarration?: boolean } = {}): PreparedImport {
    const alloc = this.allocator();
    // The notes are said in the voice and speed the course already uses.
    let like = this.narratedObjects().at(-1)?.narration;
    return prepareImport({
      deck, pkg, fileName, importedAt: now, chosen, stage: this.project.stage, existingDeckIds: this.deckSources.map((d) => d.id), ...(tones ? { tones } : {}),
      ...(options.notesAsNarration ? { narrate: (script: string) => { like = newNarration(script, like); return like; } } : {}),
      newSlideId: this.slideIdMaker(), newObjectId: () => alloc.object(),
    });
  }

  /** Put the prepared slides into the course, after the slide being edited, as one undo step. */
  commitDeckImport(prepared: PreparedImport): string {
    this.record("");
    const scene = this.project.scenes.find((s) => s.slides.includes(this.sel.slideId)) ?? this.project.scenes[0]!;
    const here = scene.slides.indexOf(this.sel.slideId);
    let at = here === -1 ? scene.slides.length : here + 1;
    for (const slide of prepared.slides) {
      scene.slides.splice(at++, 0, slide.id);
      this.docs.push({ id: slide.id, slide, originalText: "", savedCompact: "" });
    }
    this.syncDocOrder();
    this.project.sources = [...this.deckSources, prepared.source];
    const first = prepared.slides[0];
    if (first) this.sel = { slideId: first.id, layerId: first.baseLayer.id, objectId: null };
    this.emit({ kind: "structure" });
    this.emit({ kind: "selection" });
    return `Brought in ${prepared.slides.length} ${prepared.slides.length === 1 ? "slide" : "slides"} from ${prepared.source.name}. Press Control Z to undo.`;
  }

  // ---- slides made from the steps of a recording

  /** The ids of the steps of a recording (named by its folder) that already have a slide in this course. */
  stepsWithSlides(recording: string): Set<string> {
    return new Set(this.slides.flatMap((s) => { const p = s.provenance; return p && "sourceCapture" in p && p.sourceCapture === recording ? [p.stepId] : []; }));
  }

  /** The number variable that counts a learner's wrong tries in the Practice lesson, if there is one. */
  private existingTries(): string | undefined {
    return this.project.variables.find((v) => v.type === "number" && v.name === "practice tries")?.id;
  }

  /** The number variable that counts a learner's wrong tries in the Practice lesson: the one that is there, or a new one. */
  private triesVariable(): string {
    return this.existingTries() ?? this.makeVariable("number", "practice tries");
  }

  /**
   * What making or bringing up to date a lesson comes to, worked out without changing anything: which steps have no slide, which slides the steps have changed
   * (and which of those the author has also changed), which belong to steps that are gone, and which were made before a lesson could be brought up to date.
   * `tries` is the Practice counter's id, or a stand-in when only a plan is wanted.
   */
  private lessonWork(input: LessonInput, tries: string): LessonWork {
    const lesson = input.lesson ?? "watch";
    const capture = lessonCapture(input.recording, lesson);
    const mine = this.slides.flatMap((slide) => { const p = slide.provenance; return p && "sourceCapture" in p && p.sourceCapture === capture ? [{ slide, stepId: p.stepId, base: baseFrom(slide) }] : []; });
    const have = new Map(mine.map((m) => [m.stepId, m]));
    const known = new Map(input.steps.map((st) => [st.id, st]));
    const newTriggerId = this.triggerAllocator();
    const alloc = this.allocator();
    const newSlideId = this.slideIdMaker();
    let like = this.narratedObjects().at(-1)?.narration;
    const shotOf = (st: Step): number => Math.round(st.shotMs);
    const optionsFor = (slideId: () => string, roles: Record<string, string>, existing: Record<string, string>, picture: StepPicture | null): LessonOptions => ({
      recording: capture, total: input.steps.length, stage: this.project.stage, ...(input.capturedAt === undefined ? {} : { capturedAt: input.capturedAt }),
      newSlideId: slideId, newObjectId: () => alloc.object(), newTriggerId, tries, existing, roles,
      narration: (script) => { like = newNarration(script, like); return like; },
    });
    const work: LessonWork = { lesson, capture, make: [], update: [], remove: [], goneKept: [], untracked: [], needPictures: [], existing: input.steps.filter((st) => have.has(st.id)).length };

    for (const [index, step] of input.steps.entries()) {
      if (have.has(step.id)) continue;
      work.needPictures.push(step.id);
      const picture = input.pictures.get(step.id) ?? null;
      const roles: Record<string, string> = {};
      const slide = buildLessonSlide(lesson, step, index, picture, optionsFor(newSlideId, roles, {}, picture));
      work.make.push({ step, index, slide, roles, picture: picture === null ? null : { src: picture.path, width: picture.width, height: picture.height, take: step.take, shotMs: shotOf(step) } });
    }
    for (const { slide, stepId, base } of mine) {
      const step = known.get(stepId);
      if (base === null) { work.untracked.push(slide); continue; }
      if (step === undefined) { (untouched(slide, base) ? work.remove : work.goneKept).push(slide); continue; }
      const index = input.steps.indexOf(step);
      const was = base.picture;
      const same = was !== null && was.take === step.take && was.shotMs === shotOf(step);
      let picture: StepPicture | null = was === null ? null : { path: was.src, width: was.width, height: was.height };
      let freshPicture = was;
      if (was !== null && !same) {
        work.needPictures.push(step.id);
        // Until the new picture is taken and saved, the slide keeps the picture it has, and says so.
        const taken = input.pictures.get(step.id);
        if (taken !== undefined) {
          picture = taken;
          freshPicture = { src: taken.path, width: taken.width, height: taken.height, take: step.take, shotMs: shotOf(step) };
        }
      }
      const roles: Record<string, string> = {};
      const existing = Object.fromEntries(Object.entries(base.objects).map(([role, o]) => [role, o.id]));
      const fresh = buildLessonSlide(lesson, step, index, picture, optionsFor(() => slide.id, roles, existing, picture));
      work.update.push({ slide, step, index, merge: mergeSlide(slide, base, fresh, roles, freshPicture) });
    }
    return work;
  }

  /** What bringing a lesson up to date comes to, in words and numbers, without changing anything. */
  planStepLesson(input: LessonInput): LessonPlan {
    const work = this.lessonWork(input, this.existingTries() ?? "var-pending");
    const changed = work.update.filter((u) => u.merge.changed);
    const removing = work.remove;
    const sentences = this.lessonSentences(work, "plan");
    const make = work.make.length === 0 ? [] : [`Make ${work.make.length === 1 ? "1 slide" : `${work.make.length} slides`}.`];
    return {
      needPictures: work.needPictures, make: work.make.length, update: changed.length, remove: removing.length,
      kept: work.update.filter((u) => u.merge.kept.length > 0).length,
      summary: [...make, ...sentences].join(" "), needsConfirm: changed.length > 0 || removing.length > 0,
    };
  }

  /**
   * Sentences about what is, or would be, changed in a lesson that already has slides: "plan" (what pressing the button will do), "did" (what it did), or "report" (what it did,
   * when it was not asked to take away slides for steps that are gone, so those are said to be waiting).
   */
  private lessonSentences(work: LessonWork, mode: "plan" | "did" | "report"): string[] {
    const applied = mode !== "plan";
    const many = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
    const names = (slides: Slide[]): string => `${slides.slice(0, 3).map((x) => `"${x.name}"`).join(", ")}${slides.length > 3 ? ` and ${slides.length - 3} more` : ""}`;
    const changed = work.update.filter((u) => u.merge.changed);
    const kept = work.update.filter((u) => u.merge.kept.length > 0);
    const out: string[] = [];
    if (changed.length > 0) {
      const what = changeWords(changed.map((u) => u.merge));
      out.push(`${applied ? "Brought" : "Bring"} ${many(changed.length, "slide")} up to date${what === "" ? "" : ` (${what})`}.`);
    }
    if (work.remove.length > 0) {
      const n = work.remove.length;
      if (mode === "report") out.push(`${many(n, "slide")} ${n === 1 ? "is" : "are"} for ${n === 1 ? "a step that is" : "steps that are"} gone, and you have not changed ${n === 1 ? "it" : "them"}: ${names(work.remove)}. ${n === 1 ? "It is" : "They are"} taken away when you ask.`);
      else out.push(`${applied ? "Took away" : "Take away"} ${many(n, "slide")} for ${n === 1 ? "a step that is" : "steps that are"} gone, which you had not changed: ${names(work.remove)}.`);
    }
    if (kept.length > 0) out.push(`Your own changes ${applied ? "were" : "will be"} kept on ${many(kept.length, "slide")}: ${names(kept.map((u) => u.slide))}.`);
    if (work.goneKept.length > 0) out.push(`${many(work.goneKept.length, "slide")} ${work.goneKept.length === 1 ? "is" : "are"} for ${work.goneKept.length === 1 ? "a step that is" : "steps that are"} gone, but you changed ${work.goneKept.length === 1 ? "it" : "them"}, so ${work.goneKept.length === 1 ? "it stays" : "they stay"}: ${names(work.goneKept)}. Delete ${work.goneKept.length === 1 ? "it" : "them"} if you do not want ${work.goneKept.length === 1 ? "it" : "them"}.`);
    if (work.untracked.length > 0) out.push(`${many(work.untracked.length, "slide")} ${work.untracked.length === 1 ? "was" : "were"} made before a lesson could be brought up to date, so ${work.untracked.length === 1 ? "it is" : "they are"} left as ${work.untracked.length === 1 ? "it is" : "they are"}: ${names(work.untracked)}. Delete one and make the lesson again to bring its step in.`);
    return out;
  }

  /**
   * Make a slide for each step of a lesson (Watch, Practice or Test) that has none, and bring up to date the slides it already has, as one undo step. The Watch slide is a
   * heading, the step's words (with narration made from them), the step's picture and a frame round the place to point at; Practice and Test make the slides described in
   * steplessons.ts. A slide the author never changed is made again from its step; a part the author changed stays as the author left it; what the author added is never touched;
   * a part the author deleted stays deleted (stepbase.ts). A slide for a step that is gone is taken away only if the author never changed it, and only when `removeGone` is true. A picture's description is used only for a step the author has checked.
   */
  makeStepSlides(input: LessonInput): { added: number; skipped: number; updated: number; removed: number; message: string } {
    const lesson = input.lesson ?? "watch";
    const lessonName = lesson === "watch" ? "this course" : `the ${LESSON_WORDS[lesson].short} lesson`;
    // Nothing to do, or nothing but to say: no change is made, and nothing is recorded to undo.
    const trial = this.lessonWork(input, this.existingTries() ?? "var-pending");
    const removing = input.removeGone === true;
    const doing = trial.make.length > 0 || trial.update.some((u) => u.merge.changed) || (removing && trial.remove.length > 0);
    if (!doing) {
      const first = input.steps.length === 0 ? "There are no steps to make slides from." : `Every step already has a slide in ${lessonName}.`;
      return { added: 0, skipped: trial.existing, updated: 0, removed: 0, message: [first, ...this.lessonSentences(trial, removing ? "did" : "report")].join(" ") };
    }

    this.record("");
    const tries = lesson === "practice" ? this.triesVariable() : "";
    const work = this.lessonWork(input, tries);
    const base = (slide: Slide, roles: Record<string, string>, picture: CaptureBase["picture"]): CaptureBase => baseOf(slide, roles, picture);
    const withBase = (slide: Slide, b: CaptureBase): void => {
      slide.provenance = { ...(slide.provenance as CaptureProvenance), base: b };
    };

    // Slides that the steps changed.
    let updated = 0;
    for (const u of work.update) {
      const doc = this.docs.find((d) => d.id === u.slide.id);
      if (doc === undefined) continue;
      const merged = u.merge.slide;
      withBase(merged, u.merge.base);
      if (u.merge.changed || JSON.stringify(u.merge.base) !== JSON.stringify(baseFrom(u.slide))) doc.slide = merged;
      if (u.merge.changed) updated++;
    }

    // Slides for steps that are gone, if the author never changed them.
    const gone = removing ? work.remove : [];
    for (const slide of gone) {
      for (const scene of this.project.scenes) scene.slides = scene.slides.filter((id) => id !== slide.id);
      this.docs = this.docs.filter((d) => d.id !== slide.id);
    }
    if (!this.docs.some((d) => d.id === this.sel.slideId)) {
      const next = this.docs[0]!.slide;
      this.sel = { slideId: next.id, layerId: next.baseLayer.id, objectId: null };
    }

    // New slides, each in its step's place among the slides the lesson already has: after the slide of the step before it, or before the slide of the first step that
    // has one. With none yet, they go after the slide being edited.
    const have = new Map(this.slides.flatMap((sl) => { const p = sl.provenance; return p && "sourceCapture" in p && p.sourceCapture === work.capture ? [[p.stepId, sl.id] as const] : []; }));
    const madeFor = new Map(work.make.map((m) => [m.step.id, m]));
    const homeOf = (id: string) => this.project.scenes.find((sc) => sc.slides.includes(id));
    const firstExisting = input.steps.map((st) => have.get(st.id)).find((id) => id !== undefined);
    let lastId: string | null = null;
    const slides: Slide[] = [];
    for (const step of input.steps) {
      const existing = have.get(step.id);
      if (existing !== undefined) { lastId = existing; continue; }
      const m = madeFor.get(step.id);
      if (m === undefined) continue;
      withBase(m.slide, base(m.slide, m.roles, m.picture));
      if (lastId !== null) {
        const sc = homeOf(lastId)!;
        sc.slides.splice(sc.slides.indexOf(lastId) + 1, 0, m.slide.id);
      } else if (firstExisting !== undefined) {
        const sc = homeOf(firstExisting)!;
        sc.slides.splice(sc.slides.indexOf(firstExisting), 0, m.slide.id);
      } else {
        const sc = homeOf(this.sel.slideId) ?? this.project.scenes[0]!;
        const here = sc.slides.indexOf(this.sel.slideId);
        sc.slides.splice(here === -1 ? sc.slides.length : here + 1, 0, m.slide.id);
      }
      this.docs.push({ id: m.slide.id, slide: m.slide, originalText: "", savedCompact: "" });
      slides.push(m.slide);
      lastId = m.slide.id;
    }
    this.syncDocOrder();
    const first = slides[0];
    if (first !== undefined) this.sel = { slideId: first.id, layerId: first.baseLayer.id, objectId: null };
    this.emit({ kind: "structure" });
    this.emit({ kind: "selection" });

    const noDescription = slides.filter((sl) => sl.baseLayer.objects.some((o) => (o.type === "image" && o.accessibility.altText === "") || (o.type === "quizQuestion" && (o.content["image"] as { alt?: string } | undefined)?.alt === ""))).length;
    const suggested = slides.filter((sl) => sl.baseLayer.objects.some((o) => o.type === "image" && o.accessibility.altText === "" && o.accessibility.altSuggestion !== undefined)).length;
    const where = work.existing === 0 ? "after the slide you were on" : "each in its place";
    const parts: string[] = [];
    if (slides.length > 0) {
      parts.push(lesson === "watch" ? `Made ${slides.length} ${slides.length === 1 ? "slide" : "slides"} from the steps, ${where}.` : `Made ${slides.length} ${slides.length === 1 ? "slide" : "slides"} for the ${LESSON_WORDS[lesson].short} lesson, ${where}.`);
      const upToDate = work.existing - updated;
      if (upToDate > 0 && updated === 0) parts.push(`${upToDate} ${upToDate === 1 ? "step already had a slide that is up to date" : "steps already had slides that are up to date"}.`);
    }
    parts.push(...this.lessonSentences({ ...work, remove: removing ? gone : work.remove }, removing ? "did" : "report"));
    if (noDescription > 0) parts.push(`${noDescription} ${noDescription === 1 ? "picture has" : "pictures have"} no description yet, because ${noDescription === 1 ? "its step has" : "their steps have"} not been checked. ${suggested > 0 ? `${suggested === 1 ? "It has a suggestion" : `${suggested} have suggestions`} worked out from the recording, in the Properties panel under Alt text for you to use or change. ` : ""}The Problems panel asks for ${noDescription === 1 ? "it" : "them"}.`);
    if (lesson === "test" && slides.length > 0) parts.push("Add a results box after the last question to show the learner their score.");
    parts.push("Press Control Z to undo.");
    return { added: slides.length, skipped: work.existing, updated, removed: gone.length, message: parts.filter((x) => x !== "").join(" ") };
  }

  /** What a deck would change in the course, worked out without changing anything. Null if the deck is not one the project lists. */
  prepareDeckResync(sourceId: string, deck: Deck, pkg: Pkg, tones?: Tones): ResyncPlan | null {
    const source = this.deckSources.find((d) => d.id === sourceId);
    return source ? planResync({ source, slides: this.slides, deck, pkg, ...(tones ? { tones } : {}) }) : null;
  }

  /** Bring in the ticked changes, as one undo step. The picture files they need have to be saved first (see `assetsFor`). */
  commitDeckResync(plan: ResyncPlan, accepted: ReadonlySet<string>, deck: Deck, pkg: Pkg, now: string = new Date().toISOString(), tones?: Tones): string {
    const source = this.deckSources.find((d) => d.id === plan.deckId);
    if (!source) return "That deck is not in this project.";
    this.record("");
    const alloc = this.allocator();
    const result = applyPlan(plan, accepted, { slides: this.slides, source, importedAt: now, pkg, deck, ...(tones ? { tones } : {}), newSlideId: this.slideIdMaker(), newObjectId: () => alloc.object() });
    const scene = (id: string) => this.project.scenes.find((s) => s.slides.includes(id));
    for (const { slide, after, before } of result.insert) {
      const home = (after && scene(after)) || (before && scene(before)) || this.project.scenes[0]!;
      const anchor = after ?? before;
      const at = anchor ? home.slides.indexOf(anchor) : -1;
      home.slides.splice(at === -1 ? home.slides.length : after ? at + 1 : at, 0, slide.id);
      this.docs.push({ id: slide.id, slide, originalText: "", savedCompact: "" });
    }
    for (const id of result.remove) {
      if (this.docs.length <= 1) break;
      for (const sc of this.project.scenes) sc.slides = sc.slides.filter((s) => s !== id);
      this.docs = this.docs.filter((d) => d.id !== id);
    }
    this.project.sources = this.deckSources.map((d) => (d.id === plan.deckId ? { ...d, syncedAt: now, seen: plan.seen } : d));
    this.syncDocOrder();
    if (!this.docs.some((d) => d.id === this.sel.slideId)) {
      const next = this.docs[0]!.slide;
      this.sel = { slideId: next.id, layerId: next.baseLayer.id, objectId: null };
    } else if (this.sel.objectId && !this.object) this.sel = { ...this.sel, objectId: null };
    this.emit({ kind: "structure" });
    this.emit({ kind: "selection" });
    const c = result.counts;
    const parts = [
      c.shapesChanged ? `${c.shapesChanged} ${c.shapesChanged === 1 ? "object" : "objects"} updated` : "", c.shapesAdded ? `${c.shapesAdded} added` : "", c.shapesRemoved ? `${c.shapesRemoved} removed` : "",
      c.slidesAdded ? `${c.slidesAdded} ${c.slidesAdded === 1 ? "slide" : "slides"} added` : "", c.slidesRemoved ? `${c.slidesRemoved} ${c.slidesRemoved === 1 ? "slide" : "slides"} deleted` : "", c.fields ? `${c.fields} slide ${c.fields === 1 ? "setting" : "settings"} changed` : "",
    ].filter(Boolean);
    return parts.length ? `Brought up to date: ${parts.join(", ")}. Press Control Z to undo.` : "Nothing was changed.";
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

  /**
   * Leave a folder out of the source/ copy of the project that a published package carries (sourceExclude in project.json), unless it is
   * left out already. Raw recordings and what was noted of an author's mouse and keyboard must never reach learners. This is bookkeeping, not part
   * of the design, so it is not an undo step; the project just needs saving. Returns whether the list changed. A name that is not a plain
   * folder name (a slash at the start, a backslash, ..) is refused.
   */
  excludeFromPackage(name: string): boolean {
    const plain = /^[A-Za-z0-9._ -]+(\/[A-Za-z0-9._ -]+)*$/.test(name) && !name.split("/").some((p) => p === ".." || p === ".");
    if (!plain) return false;
    const list = this.project.sourceExclude ?? [];
    if (isExcluded(`${name}/x`, list)) return false;
    this.project.sourceExclude = [...list, name];
    this.emit({ kind: "content" });
    return true;
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

  // ---- timers

  /** A countdown, selected. It has no rule yet; the author says what happens when the time runs out. */
  addTimer(): OSObject | null {
    const layer = this.layer;
    if (!layer) return null;
    const obj = newTimer(this.placement(this.allocator().object()));
    this.record("");
    layer.objects.push(obj);
    this.sel = { ...this.sel, objectId: obj.id };
    this.emit({ kind: "structure", objectId: obj.id });
    return obj;
  }

  private timerOf(objectId: string): OSObject | null {
    const obj = this.find(objectId);
    return obj && obj.type === "timer" ? obj : null;
  }

  /** How long the timer counts down, in whole seconds. */
  setTimerSeconds(objectId: string, seconds: number): string | null {
    const obj = this.timerOf(objectId);
    if (!obj) return null;
    if (!Number.isFinite(seconds)) return "That needs a number of seconds.";
    const next = Math.min(TIMER_MAX_SECONDS, Math.max(TIMER_MIN_SECONDS, Math.round(seconds)));
    if (timerContentOf(obj).seconds === next && obj.content["seconds"] === next) return null;
    this.record(`timer-seconds:${objectId}`);
    obj.content = { ...obj.content, seconds: next };
    this.emit({ kind: "content", objectId });
    const clamped = Math.round(seconds) !== next ? ` ${Math.round(seconds) < next ? "That is the shortest" : "That is the longest"} a timer can be.` : "";
    return `The timer counts down ${next} ${next === 1 ? "second" : "seconds"}.${clamped}`;
  }

  /** How much time the Add time button gives; 0 takes that button away. The Turn off button is always there. */
  setTimerExtend(objectId: string, seconds: number): string | null {
    const obj = this.timerOf(objectId);
    if (!obj) return null;
    if (!Number.isFinite(seconds)) return "That needs a number of seconds.";
    const rounded = Math.round(seconds);
    const next = rounded <= 0 ? 0 : Math.min(TIMER_MAX_EXTEND, Math.max(TIMER_MIN_SECONDS, rounded));
    if (obj.content["extendBy"] === next) return null;
    this.record(`timer-extend:${objectId}`);
    obj.content = { ...obj.content, extendBy: next };
    this.emit({ kind: "content", objectId });
    return next === 0 ? "The timer has no Add time button now. Learners can still turn it off." : `The Add time button gives ${next} seconds.`;
  }

  /** The words above the clock. If the screen reader name was the old label, it follows. */
  setTimerLabel(objectId: string, label: string): string | null {
    const obj = this.timerOf(objectId);
    if (!obj) return null;
    const next = label.replace(/\s+/g, " ").trim().slice(0, 60);
    const before = timerContentOf(obj).label;
    if (next === "" || obj.content["label"] === next) return next === "" ? "The timer needs a label." : null;
    this.record(`timer-label:${objectId}`);
    obj.content = { ...obj.content, label: next };
    if (obj.accessibility.altText === before) obj.accessibility = { ...obj.accessibility, altText: next };
    this.emit({ kind: "content", objectId });
    return "Label updated";
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

  private narrationOwner(key: string): { obj: OSObject; item: InteractionItem | null; cue: DescriptionCue | null; line: ScenarioLine | null; name: string } | null {
    const [objectId = "", partId, ...rest] = key.split("/");
    if (rest.length > 0) return null;
    const obj = this.find(objectId);
    if (!obj) return null;
    if (partId === undefined) return { obj, item: null, cue: null, line: null, name: obj.name };
    const item = obj.type === "interaction" ? (obj.content as unknown as InteractionContent).items.find((i) => i.id === partId) : undefined;
    if (item) return { obj, item, cue: null, line: null, name: `${obj.name}, ${item.title}` };
    const line = obj.type === "scenario" ? S.lineOf(obj.content as unknown as ScenarioContent, partId) : undefined;
    if (line) return { obj, item: null, cue: null, line: line.line, name: `${obj.name}, ${S.describeLine(line)}` };
    const cue = this.cuesOf(obj).find((c) => c.id === partId);
    return cue ? { obj, item: null, cue, line: null, name: `${obj.name}, audio description at ${clockText(cue.time)}` } : null;
  }

  private narrationAt(owner: { obj: OSObject; item: InteractionItem | null; cue: DescriptionCue | null; line: ScenarioLine | null }): Narration | null {
    return ((owner.item ? owner.item.narration : owner.cue ? owner.cue.narration : owner.line ? owner.line.narration : owner.obj.narration) as Narration | null) ?? null;
  }

  private writeNarration(owner: { obj: OSObject; item: InteractionItem | null; cue: DescriptionCue | null; line: ScenarioLine | null }, n: Narration | null): void {
    if (owner.item) owner.item.narration = n;
    else if (owner.cue) owner.cue.narration = n;
    else if (owner.line) owner.line.narration = n;
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
          if (own) out.push({ ...where, object, key: object.id, item: null, cue: null, line: null, narration: own });
          if (object.type === "video") {
            for (const cue of this.cuesOf(object)) {
              const said = (cue.narration as Narration | null) ?? null;
              if (said) out.push({ ...where, object, key: `${object.id}/${cue.id}`, item: null, cue, line: null, narration: said });
            }
          }
          if (object.type === "scenario") {
            for (const { line } of S.allLines(object.content as unknown as ScenarioContent)) {
              const said = (line.narration as Narration | null) ?? null;
              if (said) out.push({ ...where, object, key: `${object.id}/${line.id}`, item: null, cue: null, line, narration: said });
            }
          }
          if (object.type !== "interaction") continue;
          for (const item of (object.content as unknown as InteractionContent).items) {
            const said = (item.narration as Narration | null) ?? null;
            if (said) out.push({ ...where, object, key: `${object.id}/${item.id}`, item, cue: null, line: null, narration: said });
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
    const last = this.narratedObjects().at(-1)?.narration;
    this.writeNarration(owner, current ? { ...current, script } : owner.line ? S.spokenLine(script, owner.line.speaker, this.characters, last) : newNarration(script, last));
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

  // ---- icons, and buttons that go somewhere

  /** Put an icon on the layer. It has no alt text yet: the author writes it, or marks the icon decorative. */
  addIcon(icon: IconContent): OSObject | null {
    const layer = this.layer;
    if (!layer) return null;
    const obj = newIcon(this.placement(this.allocator().object()), icon);
    this.record("");
    layer.objects.push(obj);
    this.sel = { ...this.sel, objectId: obj.id };
    this.emit({ kind: "structure", objectId: obj.id });
    return obj;
  }

  /** Swap the picture of an icon for another, keeping its size, colour and alt text. */
  changeIcon(objectId: string, icon: IconContent): string | null {
    const obj = this.find(objectId);
    if (!obj || obj.type !== "icon") return null;
    const before = obj.content as unknown as IconContent;
    if (before.name === icon.name && JSON.stringify(before.shapes) === JSON.stringify(icon.shapes)) return null;
    this.record("");
    // A name that was just the old icon's name, made by the editor, follows the new icon. A name the author changed is theirs.
    if (obj.name === `Icon: ${before.name.replace(/-/g, " ")}`) obj.name = `Icon: ${icon.name.replace(/-/g, " ")}`;
    obj.content = { ...icon, shapes: icon.shapes.map((s) => ({ ...s })) } as unknown as Record<string, unknown>;
    this.emit({ kind: "content", objectId });
    return `Now the ${icon.name.replace(/-/g, " ")} icon. Its alt text is unchanged, so check that it still says what the icon shows.`;
  }

  /** Add one of the ready-made buttons that move around the course. The rule is already written, for the mouse and the keyboard. */
  addNavigationButton(kind: string): OSObject | null {
    const layer = this.layer;
    const choice = navigationButtonById(kind);
    if (!layer || !choice) return null;
    const obj = newNavigationButton(choice, this.placement(this.allocator().object()));
    this.record("");
    layer.objects.push(obj);
    this.sel = { ...this.sel, objectId: obj.id };
    this.emit({ kind: "structure", objectId: obj.id });
    return obj;
  }

  private buttonOf(objectId: string): OSObject | null {
    const obj = this.find(objectId);
    return obj && obj.type === "button" ? obj : null;
  }

  /** The look a button has: one of the ready-made ones, or "custom". */
  buttonLook(objectId: string): string {
    const obj = this.buttonOf(objectId);
    return obj ? lookOf(obj.style) : CUSTOM_LOOK;
  }

  /** Put a ready-made look on a button: its colours, outline and roundness. Its words, font, size and rules are left alone. */
  setButtonLook(objectId: string, look: string): string | null {
    const obj = this.buttonOf(objectId);
    const style = obj ? withLook(obj.style, look) : null;
    if (!obj || !style || JSON.stringify(style) === JSON.stringify(obj.style)) return null;
    this.record("");
    obj.style = style;
    this.emit({ kind: "content", objectId });
    return "Button look changed.";
  }

  /** Show an icon beside a button's words, or take it away. The words are still the button's name. */
  setButtonIcon(objectId: string, icon: IconContent | null): string | null {
    const obj = this.buttonOf(objectId);
    if (!obj) return null;
    const content = { ...obj.content } as Record<string, unknown>;
    if (icon === null) {
      if (!("icon" in content)) return null;
      delete content["icon"];
      delete content["iconPlacement"];
    } else {
      const before = content["icon"] as IconContent | undefined;
      if (before && before.name === icon.name) return null;
      content["icon"] = { ...icon, shapes: icon.shapes.map((s) => ({ ...s })) };
    }
    this.record("");
    obj.content = content;
    this.emit({ kind: "structure", objectId });
    return icon === null ? "Took the icon off the button." : `The button now shows the ${icon.name.replace(/-/g, " ")} icon. Its words are still its name for a screen reader.`;
  }

  setButtonIconPlacement(objectId: string, placement: "before" | "after"): string | null {
    const obj = this.buttonOf(objectId);
    if (!obj || !obj.content["icon"]) return null;
    const now = obj.content["iconPlacement"] === "after" ? "after" : "before";
    if (now === placement) return null;
    this.record("");
    const content = { ...obj.content } as Record<string, unknown>;
    if (placement === "after") content["iconPlacement"] = "after"; else delete content["iconPlacement"];
    obj.content = content;
    this.emit({ kind: "content", objectId });
    return `The icon is now ${placement} the words.`;
  }

  // ---- the cast: the people a course can show and give a voice to

  get characters(): Character[] {
    return this.project.characters ?? [];
  }

  /**
   * Replace the cast with the one the author made in the dialog, as one undo step. A person who is still used cannot be taken out;
   * a person whose voice changed has the lines they speak changed to it, so they stay in one voice. `credits` are the records of where
   * pictures from a character pack came from; they are saved in the same step.
   */
  setCharacters(draft: Character[], credits: CreditEntry[] = []): string | null {
    const before = this.characters;
    const problems = castProblems(draft, before, castUse(this.slides), poseUse(this.slides));
    if (problems.length > 0) return problems[0]!;
    const next = cloneCast(draft).map(tidyPerson);
    const newCredits = credits.filter((c) => JSON.stringify(this.creditOf(c.path)) !== JSON.stringify(c));
    if (JSON.stringify(next) === JSON.stringify(before) && newCredits.length === 0) return null;
    this.record("");
    if (next.length === 0) delete this.project.characters;
    else this.project.characters = next;
    for (const c of newCredits) {
      const at = this.assets.findIndex((a) => a.path === c.path);
      if (at === -1) this.assets.push(c); else this.assets[at] = c;
    }
    // A person's lines are read in their voice. Change the voice of every spoken line of someone whose voice changed.
    const changed = voiceChanges(before, next);
    let lines = 0;
    if (changed.size > 0) {
      for (const slide of this.slides) {
        for (const layer of [slide.baseLayer, ...slide.layers]) {
          for (const obj of layer.objects) {
            if (obj.type !== "scenario") continue;
            for (const { line } of S.allLines(obj.content as unknown as ScenarioContent)) {
              const voice = line.speaker ? changed.get(line.speaker) : undefined;
              const n = line.narration as Narration | null;
              if (voice && n && n.voice !== voice) {
                line.narration = { ...n, voice, lang: langAfterVoiceChange(n, voice, this.project.meta.language) };
                lines++;
              }
            }
          }
        }
      }
    }
    this.emit({ kind: "content" });
    const moved = lines > 0 ? ` ${lines} spoken ${lines === 1 ? "line was" : "lines were"} changed to the new voice, so make the audio again.` : "";
    return `The cast has ${next.length} ${next.length === 1 ? "person" : "people"}.${moved}`;
  }

  // ---- scenarios

  private scenarioOf(objectId: string): { obj: OSObject; c: ScenarioContent } | null {
    const obj = this.find(objectId);
    return obj && obj.type === "scenario" ? { obj, c: obj.content as unknown as ScenarioContent } : null;
  }

  /** Add a scenario to the layer, with a small story to write over. */
  addScenario(): OSObject | null {
    const layer = this.layer;
    if (!layer) return null;
    const obj = newScenario(this.placement(this.allocator().object()), S.newScenarioContent());
    this.record("");
    layer.objects.push(obj);
    this.sel = { ...this.sel, objectId: obj.id };
    this.emit({ kind: "structure", objectId: obj.id });
    return obj;
  }

  /**
   * Do one edit to a scenario (see scenarioedit.ts) on a copy, and keep it as one undo step if it changed something. The message is
   * what to tell the author, which is also given when the edit is refused. Null when there is nothing to say.
   */
  private editScenario(objectId: string, edit: (c: ScenarioContent) => S.Edit, structural = false): string | null {
    const hit = this.scenarioOf(objectId);
    if (!hit) return null;
    const next = structuredClone(hit.c);
    const result = edit(next);
    if (result.changed) {
      this.record("");
      hit.obj.content = next as unknown as Record<string, unknown>;
      this.emit({ kind: structural ? "structure" : "content", objectId });
    }
    return result.message === "" ? null : result.message;
  }

  /** Like editScenario, for an edit that makes something and says its id. */
  private makeInScenario(objectId: string, edit: (c: ScenarioContent) => S.Edit & { id?: string }): { message: string | null; id: string | null } {
    let id: string | null = null;
    const message = this.editScenario(objectId, (c) => { const e = edit(c); id = e.changed ? e.id ?? null : null; return e; }, true);
    return { message, id };
  }

  addSituation(objectId: string): { message: string | null; id: string | null } { return this.makeInScenario(objectId, (c) => S.addSituation(c)); }
  deleteSituation(objectId: string, nodeId: string): string | null { return this.editScenario(objectId, (c) => S.deleteSituation(c, nodeId), true); }
  moveSituation(objectId: string, nodeId: string, delta: -1 | 1): string | null { return this.editScenario(objectId, (c) => S.moveSituation(c, nodeId, delta), true); }
  setScenarioStart(objectId: string, nodeId: string): string | null { return this.editScenario(objectId, (c) => S.setStart(c, nodeId), true); }
  setSituationTitle(objectId: string, nodeId: string, title: string): string | null { return this.editScenario(objectId, (c) => S.setTitle(c, nodeId, title)); }
  setSituationPrompt(objectId: string, nodeId: string, prompt: string): string | null { return this.editScenario(objectId, (c) => S.setPrompt(c, nodeId, prompt)); }

  addScenarioLine(objectId: string, where: { nodeId: string } | { choiceId: string }): { message: string | null; id: string | null } { return this.makeInScenario(objectId, (c) => S.addLine(c, where)); }
  deleteScenarioLine(objectId: string, lineId: string): string | null { return this.editScenario(objectId, (c) => S.deleteLine(c, lineId), true); }
  moveScenarioLine(objectId: string, lineId: string, delta: -1 | 1): string | null { return this.editScenario(objectId, (c) => S.moveLine(c, lineId, delta), true); }
  setScenarioLineText(objectId: string, lineId: string, text: string): string | null { return this.editScenario(objectId, (c) => S.setLineText(c, lineId, text)); }
  setScenarioLineSpeaker(objectId: string, lineId: string, speaker: string | null): string | null { return this.editScenario(objectId, (c) => S.setLineSpeaker(c, lineId, speaker, this.characters), true); }
  setScenarioLinePose(objectId: string, lineId: string, pose: string | null): string | null { return this.editScenario(objectId, (c) => S.setLinePose(c, lineId, pose, this.characters)); }
  setScenarioLineSpoken(objectId: string, lineId: string, on: boolean): string | null {
    const like = this.narratedObjects().at(-1)?.narration;
    return this.editScenario(objectId, (c) => S.setLineSpoken(c, lineId, on, this.characters, like), true);
  }

  addScenarioChoice(objectId: string, nodeId: string): { message: string | null; id: string | null } { return this.makeInScenario(objectId, (c) => S.addChoice(c, nodeId)); }
  deleteScenarioChoice(objectId: string, choiceId: string): string | null { return this.editScenario(objectId, (c) => S.deleteChoice(c, choiceId), true); }
  moveScenarioChoice(objectId: string, choiceId: string, delta: -1 | 1): string | null { return this.editScenario(objectId, (c) => S.moveChoice(c, choiceId, delta), true); }
  setScenarioChoiceLabel(objectId: string, choiceId: string, label: string): string | null { return this.editScenario(objectId, (c) => S.setChoiceLabel(c, choiceId, label)); }
  setScenarioChoiceNext(objectId: string, choiceId: string, nodeId: string): string | null { return this.editScenario(objectId, (c) => S.setChoiceNext(c, choiceId, nodeId), true); }

  addScenarioEffect(objectId: string, choiceId: string, variable: string): string | null { return this.editScenario(objectId, (c) => S.addEffect(c, choiceId, variable), true); }
  setScenarioEffect(objectId: string, choiceId: string, index: number, patch: { variable?: string; add?: number }): string | null { return this.editScenario(objectId, (c) => S.setEffect(c, choiceId, index, patch), patch.variable !== undefined); }
  deleteScenarioEffect(objectId: string, choiceId: string, index: number): string | null { return this.editScenario(objectId, (c) => S.deleteEffect(c, choiceId, index), true); }

  /** Add a meter showing the first number variable, or a new one if the project has none, as one undo step. */
  addScenarioMeter(objectId: string): string | null {
    const hit = this.scenarioOf(objectId);
    if (!hit) return null;
    if (hit.c.meters.length >= S.LIMITS.meters) return `A scenario can have at most ${S.LIMITS.meters} meters.`;
    this.record("");
    const variable = this.project.variables.find((v) => v.type === "number")?.id ?? this.makeVariable("number", "score");
    const next = structuredClone(hit.c);
    const e = S.addMeter(next, variable, this.variableName(variable));
    hit.obj.content = next as unknown as Record<string, unknown>;
    this.emit({ kind: "structure", objectId });
    return e.message;
  }
  setScenarioMeter(objectId: string, meterId: string, patch: { label?: string; variable?: string; min?: number; max?: number }): string | null { return this.editScenario(objectId, (c) => S.setMeter(c, meterId, patch), patch.variable !== undefined); }
  deleteScenarioMeter(objectId: string, meterId: string): string | null { return this.editScenario(objectId, (c) => S.deleteMeter(c, meterId), true); }

  setScenarioRetry(objectId: string, on: boolean): string | null { return this.editScenario(objectId, (c) => S.setRetry(c, on), true); }
  setScenarioYou(objectId: string, variable: string | null): string | null { return this.editScenario(objectId, (c) => S.setYou(c, variable), true); }
  setScenarioFinished(objectId: string, variable: string | null): string | null { return this.editScenario(objectId, (c) => S.setFinished(c, variable), true); }
  setScenarioReflection(objectId: string, text: string): string | null { return this.editScenario(objectId, (c) => S.setReflection(c, text)); }

  // ---- audio description: what a video's picture shows, at the times it matters, written and spoken

  /** The audio descriptions on a video, in the order they happen. */
  private cuesOf(obj: OSObject): DescriptionCue[] {
    return obj.type === "video" ? ((obj.content as { description?: { cues?: DescriptionCue[] } }).description?.cues ?? []) : [];
  }

  descriptionOf(objectId: string): DescriptionCue[] {
    const obj = this.find(objectId);
    return obj ? [...this.cuesOf(obj)].sort((a, b) => a.time - b.time) : [];
  }

  private writeCues(obj: OSObject, cues: DescriptionCue[]): void {
    const { description: _gone, ...rest } = obj.content as { description?: unknown } & Record<string, unknown>;
    void _gone;
    // A video with no descriptions has no description at all: the format does not allow an empty list.
    obj.content = cues.length === 0 ? rest : { ...rest, description: { cues: [...cues].sort((a, b) => a.time - b.time) } };
  }

  /** Add a description to a video, five seconds after the last one, with no words yet: the author writes them. */
  addDescription(objectId: string): string | null {
    const obj = this.find(objectId);
    if (!obj || obj.type !== "video") return null;
    const cues = this.cuesOf(obj);
    if (cues.length >= DESCRIPTION_LIMIT) return `A video can have up to ${DESCRIPTION_LIMIT} descriptions.`;
    const id = `ad-${nextNumber(cues.map((c) => c.id), "ad-")}`;
    const time = cues.length === 0 ? 0 : Math.min(Math.max(...cues.map((c) => c.time)) + 5000, 86_400_000);
    this.record("");
    this.writeCues(obj, [...cues, { id, time, text: "", pause: true, narration: null }]);
    this.emit({ kind: "structure", objectId });
    return `Added a description at ${clockText(time)}. Write what the picture shows at that moment.`;
  }

  /** Change when a description happens, what it says, or whether it holds the video. */
  updateDescription(objectId: string, cueId: string, patch: { time?: number; text?: string; pause?: boolean }): { ok: boolean; message: string } {
    const obj = this.find(objectId);
    const cues = obj ? this.cuesOf(obj) : [];
    const cue = cues.find((c) => c.id === cueId);
    if (!obj || !cue) return { ok: false, message: "" };
    const next = { ...cue };
    if (patch.time !== undefined) {
      if (!Number.isInteger(patch.time) || patch.time < 0 || patch.time > 86_400_000) return { ok: false, message: "A description's time must be from 0 to 24 hours into the video." };
      next.time = patch.time;
    }
    if (patch.text !== undefined) {
      if (patch.text.length > 2000) return { ok: false, message: "A description can be up to 2000 letters. Split a long one in two." };
      next.text = patch.text;
    }
    if (patch.pause !== undefined) next.pause = patch.pause;
    if (JSON.stringify(next) === JSON.stringify(cue)) return { ok: true, message: "" };
    this.record(`desc:${objectId}:${cueId}:${Object.keys(patch).join(",")}`);
    this.writeCues(obj, cues.map((c) => (c.id === cueId ? next : c)));
    this.emit({ kind: patch.time !== undefined ? "structure" : "content", objectId });
    return { ok: true, message: patch.pause !== undefined ? (next.pause ? "The video will wait while this is spoken" : "The video will keep playing while this is spoken") : `Description at ${clockText(next.time)} updated` };
  }

  deleteDescription(objectId: string, cueId: string): string | null {
    const obj = this.find(objectId);
    const cues = obj ? this.cuesOf(obj) : [];
    const cue = cues.find((c) => c.id === cueId);
    if (!obj || !cue) return null;
    this.record("");
    this.writeCues(obj, cues.filter((c) => c.id !== cueId));
    this.emit({ kind: "structure", objectId });
    return `Deleted the description at ${clockText(cue.time)}`;
  }

  /** Make a description spoken as it is written. The words are then the voice's own, so a later change to the description does not change them. */
  narrateDescriptionFromText(objectId: string, cueId: string): string | null {
    const cue = this.descriptionOf(objectId).find((c) => c.id === cueId);
    if (!cue) return null;
    if (cue.text.trim() === "") return "Write the description first, then it can be spoken.";
    return this.setNarrationScript(`${objectId}/${cueId}`, cue.text.trim());
  }

  /** Give every description that has no voice a voice that says its words. Ones that already have one are left alone. One undo puts it all back. */
  narrateDescriptionsFromText(objectId: string): { added: number; message: string } {
    const obj = this.find(objectId);
    const cues = obj ? this.cuesOf(obj) : [];
    const todo = cues.filter((c) => !c.narration && c.text.trim() !== "");
    if (!obj || todo.length === 0) return { added: 0, message: cues.length === 0 ? "" : "Every description with words already has a voice." };
    this.record("");
    let like = this.narratedObjects().at(-1)?.narration;
    for (const cue of todo) {
      like = newNarration(cue.text.trim(), like);
      cue.narration = like;
    }
    this.emit({ kind: "content", objectId });
    return { added: todo.length, message: `Gave ${todo.length} ${todo.length === 1 ? "description" : "descriptions"} a voice that says ${todo.length === 1 ? "its" : "their"} words. Make the audio from the Narration button.` };
  }

  /**
   * Add what a recording shows on its screen (the words of its overlays, what its zooms show) to a video as audio descriptions, each with a voice that
   * says its words, as one undo step. This is the audio route for text a learner reads in a recording (story D7). A description that is already there at
   * the same time with the same words is skipped, so pressing it twice adds nothing twice, and the list never goes past the limit. The author reads and
   * changes them afterwards: audio description is for what the voice leaves out, so one the voice already says is theirs to delete.
   */
  describeScreen(objectId: string, items: readonly { atMs: number; text: string }[]): { added: number; message: string } {
    const obj = this.find(objectId);
    if (!obj || obj.type !== "video") return { added: 0, message: "Select a video first." };
    const cues = this.cuesOf(obj);
    const have = new Set(cues.map((c) => `${c.time}|${c.text.trim()}`));
    const wanted = items
      .map((i) => ({ time: Math.min(Math.max(Math.round(i.atMs), 0), 86_400_000), text: i.text.replace(/\s+/g, " ").trim().slice(0, 2000) }))
      .filter((i) => i.text !== "" && !have.has(`${i.time}|${i.text}`));
    if (wanted.length === 0) return { added: 0, message: items.length === 0 ? "Nothing on the screen needs describing: no text, described shapes or zooms were added to this recording." : "Everything on the screen is already described." };
    const room = DESCRIPTION_LIMIT - cues.length;
    const take = wanted.slice(0, Math.max(room, 0));
    if (take.length === 0) return { added: 0, message: `A video can have up to ${DESCRIPTION_LIMIT} descriptions.` };
    this.record("");
    const ids = cues.map((c) => c.id);
    let like = this.narratedObjects().at(-1)?.narration;
    const added: DescriptionCue[] = take.map((i) => {
      const id = `ad-${nextNumber(ids, "ad-")}`;
      ids.push(id);
      like = newNarration(i.text, like);
      return { id, time: i.time, text: i.text, pause: true, narration: like };
    });
    this.writeCues(obj, [...cues, ...added]);
    this.emit({ kind: "structure", objectId });
    const left = wanted.length - take.length;
    return {
      added: added.length,
      message: `Added ${added.length} ${added.length === 1 ? "description" : "descriptions"} from what is on the screen, each with a voice that says its words.${left > 0 ? ` ${left} more did not fit, because a video can have up to ${DESCRIPTION_LIMIT}.` : ""} If your own voice already says one of them, delete it. Make the audio from the Narration button.`,
    };
  }

  /**
   * Change the voice. The language stored beside it follows the voice, except for a voice that speaks many languages, which
   * keeps the language the author set (or the course's language if the voice before it spoke only one).
   */
  setNarrationVoice(key: string, voice: string): string | null {
    const owner = this.narrationOwner(key);
    const n = owner ? this.narrationAt(owner) : null;
    if (!owner || !n || !isKnownVoice(voice) || n.voice === voice) return null;
    this.record("");
    this.writeNarration(owner, { ...n, voice, lang: langAfterVoiceChange(n, voice, this.project.meta.language) });
    this.emit({ kind: "content", objectId: owner.obj.id });
    return `Voice changed to ${voiceOption(voice).label}`;
  }

  /** Say which language the script is in. Only for a voice that speaks many; any other voice has its own language. */
  setNarrationLang(key: string, lang: string): string | null {
    const owner = this.narrationOwner(key);
    const n = owner ? this.narrationAt(owner) : null;
    if (!owner || !n || !voiceTraits(n.voice).multilingual || n.lang === lang || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang)) return null;
    this.record("");
    this.writeNarration(owner, { ...n, lang });
    this.emit({ kind: "content", objectId: owner.obj.id });
    return `Language set to ${lang}`;
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

  /** The videos and audio clips on the slide being edited, which an object can follow, in reading order. */
  mediaSources(): { id: string; name: string; type: "video" | "audio" }[] {
    return this.timingRows()
      .filter((r) => r.object.type === "video" || r.object.type === "audio")
      .map((r) => ({ id: r.object.id, name: r.object.name, type: r.object.type as "video" | "audio" }));
  }

  /** The name of a video or audio clip on the slide, for saying what an object follows. */
  mediaNameOf(id: string | undefined): string | undefined {
    return id === undefined ? undefined : this.timingRows().find((r) => r.object.id === id)?.object.name;
  }

  /** The objects on the slide that follow this video or audio clip. */
  followersOf(mediaId: string): OSObject[] {
    return this.timingRows().map((r) => r.object).filter((o) => o.timing.appear === "media" && o.timing.media === mediaId);
  }

  /**
   * Change when an object appears (a number of milliseconds after the slide opens, after its own narration starts, or into a video or
   * audio clip on the slide) and how long it stays. Times are whole milliseconds from 0 to an hour. An object can only follow its
   * narration if it has some. To follow a clip it needs one on the slide; asking for that without naming one chooses the first.
   */
  setTiming(objectId: string, patch: Partial<Timing>): { ok: boolean; message: string } {
    const row = this.timingRows().find((r) => r.object.id === objectId);
    if (!row) return { ok: false, message: "" };
    const obj = row.object;
    let next: Timing = { ...obj.timing, ...patch };
    const whole = (n: number, min: number) => Number.isInteger(n) && n >= min && n <= MAX_MS;
    if (next.appear !== "time" && next.appear !== "narration" && next.appear !== "media" && next.appear !== "click") return { ok: false, message: "An object appears after the slide opens, after its narration starts, at a moment in a video or audio clip, or when the learner shows the next item." };
    if (next.appear === "media") {
      const clips = this.mediaSources().filter((c) => c.id !== objectId);
      if (patch.media !== undefined && !clips.some((c) => c.id === patch.media)) return { ok: false, message: "That is not a video or audio clip on this slide." };
      const chosen = patch.media ?? (obj.timing.appear === "media" ? obj.timing.media : undefined);
      const media = chosen !== undefined && clips.some((c) => c.id === chosen) ? chosen : clips[0]?.id;
      if (media === undefined) return { ok: false, message: "Add a video or audio file to this slide first, so there is something for it to follow." };
      next = { appear: "media", media, start: next.start, visibleFor: next.visibleFor };
    } else if (next.appear === "click") {
      // A new click step goes after the last one on the layer, unless the author names one.
      const others = this.timingRows().filter((r) => r.layerId === row.layerId && r.object.id !== objectId && r.object.timing.appear === "click");
      const step = patch.step ?? (obj.timing.appear === "click" ? obj.timing.step : undefined) ?? Math.max(0, ...others.map((r) => r.object.timing.step ?? 1)) + 1;
      if (!Number.isInteger(step) || step < 1 || step > MAX_STEP) return { ok: false, message: `The item number must be a whole number from 1 to ${MAX_STEP}.` };
      next = { appear: "click", step, start: next.start, visibleFor: next.visibleFor };
    } else {
      next = { appear: next.appear, start: next.start, visibleFor: next.visibleFor };
    }
    if (!whole(next.start, 0)) return { ok: false, message: "The time must be from 0 to 3600 seconds." };
    if (next.visibleFor !== null && !whole(next.visibleFor, 1)) return { ok: false, message: "How long it stays must be from a thousandth of a second to 3600 seconds, or blank to stay." };
    if (next.appear === "narration" && !obj.narration) return { ok: false, message: "Write this object's narration first, so there is something for it to follow." };
    if (JSON.stringify(next) === JSON.stringify(obj.timing)) return { ok: true, message: "" };
    this.record(`timing:${objectId}:${Object.keys(patch).join(",")}`);
    obj.timing = next;
    this.emit({ kind: "content", objectId });
    return { ok: true, message: `${obj.name}: ${describeTiming(next, !row.onBase, this.mediaNameOf(next.media))}` };
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

  /**
   * Set the same timing on every selected object, as one undo step: the way to time a whole group once. An object that cannot take it (one
   * with no narration to follow) is left as it was, and the message says so.
   */
  setTimingForSelected(patch: Partial<Timing>): { ok: boolean; message: string } {
    const sel = this.selected;
    if (sel.length === 0) return { ok: false, message: "" };
    this.beginGesture();
    const results = sel.map((o) => ({ o, r: this.setTiming(o.id, patch) }));
    this.endGesture();
    return this.settled(results, "Timing");
  }

  /** Set the same arrival or exit effect on every selected object, as one undo step. */
  setAnimationForSelected(phase: Phase, patch: Partial<Effect>): { ok: boolean; message: string } {
    const sel = this.selected;
    if (sel.length === 0) return { ok: false, message: "" };
    this.beginGesture();
    const results = sel.map((o) => ({ o, r: this.setAnimation(o.id, phase, patch) }));
    this.endGesture();
    return this.settled(results, "Animation");
  }

  /** Say what happened when one change was tried on several objects: how many took it, and why any did not. */
  private settled(results: { o: OSObject; r: { ok: boolean; message: string } }[], what: string): { ok: boolean; message: string } {
    const refused = results.filter(({ r }) => !r.ok);
    const changed = results.filter(({ r }) => r.ok && r.message !== "");
    if (refused.length === results.length) return { ok: false, message: refused[0]!.r.message };
    const detail = changed.length > 0 && changed[0]!.r.message.startsWith(`${changed[0]!.o.name}: `) ? changed[0]!.r.message.slice(changed[0]!.o.name.length + 2) : "";
    const lead = changed.length === 0 ? "" : `${what} set on ${changed.length === 1 ? changed[0]!.o.name : `${changed.length} objects`}${detail ? `: ${detail}` : ""}.`;
    if (refused.length === 0) return { ok: true, message: lead };
    return { ok: true, message: `${lead} ${refused.length} ${refused.length === 1 ? "object was" : "objects were"} left as ${refused.length === 1 ? "it was" : "they were"}: ${refused[0]!.r.message}`.trim() };
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

  /**
   * Leave out the course's Back and Next on a slide, or put them back. The learner then leaves the slide only through something on it (a Continue button, a tile),
   * which is how a game keeps its players in the game. One undo step. The message says what it did, and warns when nothing on the slide goes anywhere.
   */
  setHideNavigation(slideId: string, hide: boolean): string | null {
    const doc = this.docs.find((d) => d.id === slideId);
    if (!doc || (doc.slide.hideNavigation === true) === hide) return null;
    this.record("");
    if (hide) doc.slide.hideNavigation = true;
    else delete doc.slide.hideNavigation;
    this.emit({ kind: "structure" });
    if (!hide) return "Back and Next are shown on this slide again.";
    const leaves = doc.slide.duration !== null || [doc.slide.baseLayer, ...doc.slide.layers].some((l) => l.objects.some((o) => o.triggers.some((t) => ["jumpToSlide", "nextSlide", "previousSlide"].includes(t.action))));
    return `Back and Next are left out of this slide.${leaves ? "" : " Nothing on it goes to another slide yet, so a learner would be stuck: add a button with a rule that goes to a slide."}`;
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
    obj.triggers = writeRules(items, this.triggerAllocator());
  }

  /** What a rule on this object may point at for an action: slides, layers of its slide, variables, or media on its slide. */
  targetsFor(objectId: string, action: RuleAction): { value: string; label: string }[] {
    if (isCourseAction(action)) return [];
    if (action === "jumpToSlide") return this.slides.map((s, i) => ({ value: s.id, label: `${i + 1}. ${s.name}` }));
    if (action === "setVariable") return this.project.variables.map((v) => ({ value: v.id, label: v.name }));
    if (action === "addToVariable") return this.project.variables.filter((v) => v.type === "number").map((v) => ({ value: v.id, label: v.name }));
    const slide = this.docs.find((d) => [d.slide.baseLayer, ...d.slide.layers].some((l) => l.objects.some((o) => o.id === objectId)))?.slide;
    if (!slide) return [];
    if (action === "showLayer" || action === "hideLayer") return slide.layers.map((l) => ({ value: l.id, label: l.name }));
    if (action === "stopTimer") return [slide.baseLayer, ...slide.layers].flatMap((l) => l.objects).filter((o) => o.type === "timer").map((o) => ({ value: o.id, label: o.name }));
    // Only an object that has a look can be changed to one.
    if (action === "changeState") return [slide.baseLayer, ...slide.layers].flatMap((l) => l.objects).filter((o) => Object.keys(o.states).length > 0).map((o) => ({ value: o.id, label: o.name }));
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
    if (rule.action === "addToVariable") { if (typeof rule.value !== "number") rule.value = 1; return; }
    if (rule.action === "changeState") {
      // A look the author named is what a rule is most likely after; hover, visited and disabled are applied by the course on its own.
      const names = Object.keys(this.slideObject(rule.target)?.states ?? {});
      rule.value = names.find((n) => !isReadyLook(n)) ?? names[0] ?? "normal";
      return;
    }
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
      if (isCourseAction(patch.action)) {
        // Next, previous and replay act on the course itself: no slide, layer or variable to point at.
        next.action = patch.action;
        next.target = "";
        delete next.value;
      } else {
        const targets = this.targetsFor(objectId, patch.action);
        if (targets.length === 0) {
          return ({ jumpToSlide: "There is no slide to go to.", showLayer: "This slide has no layers. Add a layer first.", hideLayer: "This slide has no layers. Add a layer first.",
            setVariable: "There are no variables yet. Add one first.", addToVariable: "There are no number variables yet. Add a number variable first.", playMedia: "This slide has no video or audio to play.", stopTimer: "This slide has no timer. Add one first.", pauseMedia: "This slide has no video or audio to pause.",
            changeState: "No object on this slide has a look yet. Select an object, and under Looks in its Properties choose Add a look." } as Record<string, string>)[patch.action] ?? null;
        }
        next.action = patch.action;
        next.target = targets[0]!.value;
        this.fixValue(next);
      }
    }
    if (patch.target !== undefined && patch.target !== next.target) {
      if (!this.targetsFor(objectId, next.action).some((t) => t.value === patch.target)) return null;
      next.target = patch.target;
      if (next.action === "setVariable" || next.action === "changeState") this.fixValue(next);
    }
    if (patch.value !== undefined && next.action === "addToVariable") {
      if (typeof patch.value !== "number" || !Number.isFinite(patch.value)) return "That needs a number.";
      next.value = patch.value;
    }
    if (patch.value !== undefined && next.action === "changeState") {
      if (typeof patch.value !== "string" || !this.lookChoices(next.target).some((c) => c.value === patch.value)) return null;
      next.value = patch.value;
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
          const shown = o.type === "text" && referencesVariable(String(o.content["html"] ?? ""), this.variableName(id));
          if (shown || JSON.stringify(o.triggers).includes(`"${id}"`) || JSON.stringify(o.content).includes(`"${id}"`)) out.push({ slide: d.slide.name, object: o.name });
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
    const was = v.name;
    v.name = trimmed;
    // A text that shows this variable (`{{Score}}`) names it, so it is written again with the new name, in the same step.
    let texts = 0;
    for (const d of this.docs) {
      for (const layer of [d.slide.baseLayer, ...d.slide.layers]) {
        for (const o of layer.objects) {
          if (o.type !== "text") continue;
          const html = String(o.content["html"] ?? "");
          if (!referencesVariable(html, was)) continue;
          o.content = { ...o.content, html: renameReferences(html, was, trimmed) };
          texts++;
        }
      }
    }
    this.emit({ kind: texts > 0 ? "structure" : "content" });
    return `Variable renamed to ${trimmed}${texts > 0 ? `. ${texts} ${texts === 1 ? "text that shows" : "texts that show"} it ${texts === 1 ? "was" : "were"} changed to match.` : ""}`;
  }

  // ---- inputs and surveys

  /** Add an input with its own new variables, as one undo step, and select it. */
  addInput(kind: string): OSObject | null {
    const layer = this.layer;
    const choice = inputById(kind);
    if (!layer || !choice) return null;
    // A choice of character needs people to choose between.
    if (choice.id === "character" && this.characters.length < 2) return null;
    this.record("");
    const obj = newInput(choice, this.placement(this.allocator().object()), (type, base) => this.makeVariable(type, base), this.characters);
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

  /** Which people from the cast a choice of character offers, in the order of the cast. */
  setInputCharacters(objectId: string, ids: string[]): string | null {
    const hit = this.inputOf(objectId);
    if (!hit || hit.c.kind !== "character") return null;
    const known = this.characters.map((p) => p.id).filter((id) => ids.includes(id));
    if (known.length < 2) return "A choice of character needs at least two people to choose between.";
    if (known.length > 8) return "A choice of character can show at most eight people.";
    if (JSON.stringify(known) === JSON.stringify(hit.c.characters)) return null;
    this.record("");
    hit.c.characters = known;
    this.emit({ kind: "content", objectId });
    return `${known.length} people to choose between`;
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

  /** A question made of choices (multiple choice or multiple response), or null for any other. */
  private choiceQuizOf(objectId: string): { obj: OSObject; q: ChoiceQuiz } | null {
    const hit = this.quizOf(objectId);
    return hit && (hit.q.questionType === "multipleChoice" || hit.q.questionType === "multipleResponse") ? { obj: hit.obj, q: hit.q } : null;
  }

  /**
   * Change a question in one of the ways questionedit.ts knows. It is done to a copy, so a refused change leaves the question
   * alone, and a real one is a single step for Undo. Returns what to tell the author, the reason for a refusal, or null if
   * nothing changed. `key` lets quick edits to one box count as one step.
   */
  editQuestion(objectId: string, edit: QuestionEdit, key = ""): string | null {
    const hit = this.quizOf(objectId);
    if (!hit) return null;
    const copy = JSON.parse(JSON.stringify(hit.obj.content)) as QuizContent;
    const result = applyEdit(copy, edit);
    if (typeof result !== "string") return result.refuse;
    if (JSON.stringify(copy) === JSON.stringify(hit.obj.content)) return null;
    this.record(key);
    hit.obj.content = copy as unknown as Record<string, unknown>;
    this.emit({ kind: "content", objectId });
    return result;
  }

  /** Give the question narration that says it as written: what to do, then what there is to choose from. Replaces any narration it had. */
  narrateQuestionFromText(objectId: string): string | null {
    const hit = this.quizOf(objectId);
    if (!hit) return null;
    return this.setNarrationScript(objectId, questionScript(hit.q, objectId)) ?? "The narration already says what the question shows.";
  }

  setChoiceLabel(objectId: string, choiceId: string, label: string): string | null {
    const hit = this.choiceQuizOf(objectId);
    const choice = hit?.q.choices.find((c) => c.id === choiceId);
    if (!hit || !choice || label.trim() === "" || label === choice.label) return null;
    this.record(`choice:${objectId}:${choiceId}`);
    choice.label = label;
    this.emit({ kind: "content", objectId });
    return "Answer updated";
  }

  /** Exactly one answer is correct, so choosing one clears the others. */
  setCorrectChoice(objectId: string, choiceId: string): string | null {
    const hit = this.choiceQuizOf(objectId);
    if (!hit || hit.q.questionType !== "multipleChoice" || !hit.q.choices.some((c) => c.id === choiceId)) return null;
    if (hit.q.choices.every((c) => c.correct === (c.id === choiceId))) return null;
    this.record("");
    hit.q.choices.forEach((c) => (c.correct = c.id === choiceId));
    this.emit({ kind: "content", objectId });
    return `${hit.q.choices.find((c) => c.id === choiceId)!.label} is the correct answer`;
  }

  addChoice(objectId: string): string | null {
    const hit = this.choiceQuizOf(objectId);
    if (!hit) return null;
    if (hit.q.choices.length >= 8) return "A question can have at most 8 answers.";
    const id = `c${nextNumber(hit.q.choices.map((c) => c.id), "c")}`;
    this.record("");
    hit.q.choices.push({ id, label: `Answer ${hit.q.choices.length + 1}`, correct: false });
    this.emit({ kind: "structure", objectId });
    return `Added answer ${hit.q.choices.length}`;
  }

  deleteChoice(objectId: string, choiceId: string): string | null {
    const hit = this.choiceQuizOf(objectId);
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
    if (obj.locked) return this.lockMessage(objectId);
    const followers = this.followersOf(objectId).length;
    this.record("");
    layer.objects = layer.objects.filter((o) => o.id !== objectId);
    this.pruneGroups(layer);
    readingOrder(layer.objects)
      .filter((o) => (o.accessibility.tabOrder ?? 0) >= 1)
      .forEach((o, i) => (o.accessibility = { ...o.accessibility, tabOrder: i + 1 }));
    if (this.sel.objectId === objectId) this.sel = { ...this.sel, objectId: null };
    this.emit({ kind: "structure" });
    return `Deleted ${obj.name}${followers > 0 ? `. ${followers} ${followers === 1 ? "object followed" : "objects followed"} it and now ${followers === 1 ? "needs" : "need"} another video or audio file, or a time of ${followers === 1 ? "its" : "their"} own. The Problems list names ${followers === 1 ? "it" : "them"}.` : ""}`;
  }

  /** Remove every selected object, as one undo step. The tab order of what is left is renumbered so it has no gaps. */
  deleteSelected(): string | null {
    const layer = this.layer;
    const sel = this.selected;
    if (!layer || sel.length === 0) return null;
    if (sel.length === 1) return this.deleteObject(sel[0]!.id);
    // A locked object is kept, and stays selected, so the author can unlock it and then delete it if they meant to.
    const kept = sel.filter((o) => o.locked);
    const doomed = sel.filter((o) => !o.locked);
    if (doomed.length === 0) return `All ${sel.length} selected objects are locked, so none were deleted. Unlock them first.`;
    this.record("");
    const gone = new Set(doomed.map((o) => o.id));
    layer.objects = layer.objects.filter((o) => !gone.has(o.id));
    this.pruneGroups(layer);
    readingOrder(layer.objects)
      .filter((o) => (o.accessibility.tabOrder ?? 0) >= 1)
      .forEach((o, i) => (o.accessibility = { ...o.accessibility, tabOrder: i + 1 }));
    this.more = kept.length > 1 ? { primary: kept[0]!.id, ids: kept.slice(1).map((o) => o.id) } : null;
    this.anchor = kept[0]?.id ?? null;
    this.sel = { ...this.sel, objectId: kept[0]?.id ?? null };
    this.emit({ kind: "structure" });
    return `Deleted ${doomed.length === 1 ? doomed[0]!.name : `${doomed.length} objects`}${kept.length > 0 ? `. ${kept.length} locked ${kept.length === 1 ? "object was" : "objects were"} kept.` : ""}`;
  }

  // ---- locking

  /** Why an object cannot be moved, resized, rotated or deleted, or null if it can. */
  lockMessage(objectId: string): string | null {
    const o = this.find(objectId);
    return o?.locked ? `${o.name} is locked. Unlock it first to move, resize, rotate or delete it.` : null;
  }

  /** Whether none, some or all of the selected objects are locked. */
  get selectionLock(): "none" | "some" | "all" {
    const sel = this.selected;
    const locked = sel.filter((o) => o.locked).length;
    return locked === 0 ? "none" : locked === sel.length ? "all" : "some";
  }

  /** Lock or unlock every selected object, as one undo step. An unlocked object has no flag at all, not a false one. */
  setLocked(locked: boolean): string | null {
    const sel = this.selected;
    if (sel.length === 0) return null;
    const change = sel.filter((o) => (o.locked === true) !== locked);
    const name = sel.length === 1 ? sel[0]!.name : `${sel.length} objects`;
    if (change.length === 0) return `${name} ${sel.length === 1 ? "is" : "are"} already ${locked ? "locked" : "unlocked"}.`;
    this.record("");
    for (const o of change) {
      if (locked) o.locked = true; else delete o.locked;
    }
    this.emit({ kind: "structure", objectId: sel[0]!.id });
    return `${locked ? "Locked" : "Unlocked"} ${name}.`;
  }

  /** Lock what is selected, or unlock it if all of it is locked already (Ctrl+L). */
  toggleLock(): string | null {
    return this.setLocked(this.selectionLock !== "all");
  }

  private stayedNote(n: number, noun = "object"): string {
    return n > 0 ? ` ${n} locked ${n === 1 ? `${noun} stayed` : `${noun}s stayed`} where ${n === 1 ? "it was" : "they were"}.` : "";
  }

  private blockedMessage(blocked: number, only: OSObject[] | null, noun = "object"): string {
    if (only) return only.length === 1 ? `${only[0]!.name} is locked. Unlock it first to move it.` : `The group of ${only.length} objects has a locked object in it. Unlock it first to move it.`;
    return `${blocked} locked ${blocked === 1 ? noun : `${noun}s`} would have had to move, so nothing changed. Unlock ${blocked === 1 ? "it" : "them"} first.`;
  }

  // ---- aligning and spacing out

  /** What to call a thing that is lined up or spaced out: an object by its name, a group by how many it holds. */
  private unitName(unit: OSObject[], atStart = false): string {
    if (unit.length === 1) return unit[0]!.name;
    return atStart ? `The group of ${unit.length} objects` : `the group of ${unit.length} objects`;
  }

  /**
   * Line the selected objects up with each other, or, when only one thing is selected, with the slide. A group that is selected whole lines
   * up as one object. One undo step. Only where things sit changes, never their sizes.
   */
  align(how: Alignment): { changed: boolean; message: string } | null {
    const layer = this.layer;
    const sel = this.selected;
    if (!layer || sel.length === 0) return null;
    const units = unitsOf(layer.objects, sel);
    const grouped = units.some((u) => u.length > 1);
    const noun = grouped ? "item" : "object";
    const stage = this.project.stage;
    const within = units.length === 1 ? { x: 0, y: 0, width: stage.width, height: stage.height } : null;
    const how_ = ALIGNMENTS.find((a) => a.value === how)!;
    const boxes = units.map((u) => groupBox(u));
    const r = this.applyUnits(units, boxes, alignBoxes(boxes, how, within));
    if (r.moved === 0) {
      if (r.blocked > 0) return { changed: false, message: this.blockedMessage(r.blocked, units.length === 1 ? units[0]! : null, noun) };
      return { changed: false, message: units.length === 1 ? `${this.unitName(units[0]!, true)} is already there.` : "They are already lined up that way." };
    }
    const done = units.length === 1 ? `Moved ${this.unitName(units[0]!)} ${how_.onSlide}.` : `Lined up ${units.length} ${noun}s by their ${how_.edge}.${grouped ? " Each group counts as one." : ""}`;
    return { changed: true, message: done + this.stayedNote(r.blocked, noun) };
  }

  /** Space three or more selected things evenly, keeping the outer two where they are. A group counts as one. One undo step. */
  distribute(axis: "horizontal" | "vertical"): { changed: boolean; message: string } | null {
    const layer = this.layer;
    const sel = this.selected;
    if (!layer || sel.length === 0) return null;
    const units = unitsOf(layer.objects, sel);
    const grouped = units.some((u) => u.length > 1);
    const noun = grouped ? "item" : "object";
    if (units.length < 3) return { changed: false, message: grouped ? "Choose three or more objects or groups to space them out evenly. Each group counts as one." : "Choose three or more objects to space them out evenly." };
    const boxes = units.map((u) => groupBox(u));
    const r = this.applyUnits(units, boxes, distributeBoxes(boxes, axis));
    if (r.moved === 0) return { changed: false, message: r.blocked > 0 ? this.blockedMessage(r.blocked, null, noun) : "They are already spaced evenly." };
    return { changed: true, message: `Spaced ${units.length} ${noun}s evenly ${axis === "horizontal" ? "across" : "down"} the slide.${grouped ? " Each group counts as one." : ""}${this.stayedNote(r.blocked, noun)}` };
  }

  /**
   * Move each thing (an object, or the members of a group together) from the box it has to the box it should have, as one undo step. A thing
   * with a locked object in it stays where it is. Says how many moved and how many were held back.
   */
  private applyUnits(units: OSObject[][], from: Box[], to: Box[]): { moved: number; blocked: number } {
    const round = (n: number): number => Math.round(n * 100) / 100;
    const wanted = units
      .map((unit, i) => ({ unit, dx: to[i]!.x - from[i]!.x, dy: to[i]!.y - from[i]!.y }))
      .filter(({ dx, dy }) => round(dx) !== 0 || round(dy) !== 0);
    const changes = wanted.filter(({ unit }) => !unit.some((o) => o.locked));
    const blocked = wanted.length - changes.length;
    if (changes.length === 0) return { moved: 0, blocked };
    this.record("");
    for (const { unit, dx, dy } of changes) {
      for (const o of unit) {
        o.geometry = { ...o.geometry, x: round(o.geometry.x + dx), y: round(o.geometry.y + dy) };
        this.emit({ kind: "geometry", objectId: o.id });
      }
    }
    return { moved: changes.length, blocked };
  }

  // ---- duplicate, copy, cut and paste

  /** Make the ids a copy needs from the project as it is now: a trigger id no other trigger in the project uses. */
  private triggerAllocator(): () => string {
    const used = new Set(this.docs.flatMap((d) => [d.slide.baseLayer, ...d.slide.layers].flatMap((l) => l.objects.flatMap((o) => o.triggers.map((t) => t.id)))));
    let next = nextNumber([...used], "trg-");
    return () => {
      let id = `trg-${String(next++).padStart(4, "0")}`;
      while (used.has(id)) id = `trg-${String(next++).padStart(4, "0")}`;
      used.add(id);
      return id;
    };
  }

  /** Whether there is something to paste. */
  get canPaste(): boolean {
    return this.clip !== null;
  }

  /** The feedback layers a quiz question shows, as copies, so a copied question can have layers of its own. */
  private feedbackLayersOf(objects: OSObject[], slide: Slide): Layer[] {
    const ids = new Set<string>();
    for (const o of objects) {
      if (o.type !== "quizQuestion") continue;
      const f = (o.content as unknown as QuizContent).feedback;
      ids.add(f.correct);
      ids.add(f.incorrect);
    }
    return slide.layers.filter((l) => ids.has(l.id)).map((l) => JSON.parse(JSON.stringify(l)) as Layer);
  }

  /** What the selection is called in a message: the object's name, or how many there are. */
  private selectionName(sel: OSObject[]): string {
    return sel.length === 1 ? sel[0]!.name : `${sel.length} objects`;
  }

  /** Remember the selected objects, so Paste can put copies of them here or on another slide. Changes nothing in the course. */
  copy(): string | null {
    const sel = this.selected;
    const slide = this.slide;
    const layer = this.layer;
    if (sel.length === 0 || !slide || !layer) return null;
    this.clip = { objects: JSON.parse(JSON.stringify(sel)) as OSObject[], layers: this.feedbackLayersOf(sel, slide), slideId: slide.id, layerId: layer.id, tone: this.tone() };
    this.pasted.clear();
    this.emit({ kind: "clipboard" });
    return `Copied ${this.selectionName(sel)}.`;
  }

  /** Copy the selected objects and remove them, as one undo step. */
  cut(): string | null {
    const sel = this.selected;
    if (sel.length === 0) return null;
    const locked = sel.filter((o) => o.locked).length;
    if (locked > 0) return `${locked === sel.length && sel.length === 1 ? sel[0]!.name : `${locked} of the selected objects`} ${locked === 1 ? "is" : "are"} locked, so ${locked === 1 ? "it" : "they"} cannot be cut. Copy ${locked === 1 ? "it" : "them"} instead, or unlock first.`;
    const name = this.selectionName(sel);
    this.copy();
    this.deleteSelected();
    return `Cut ${name}.`;
  }

  /** Put copies of the selected objects on this layer, a little to one side and straight after the last of them in reading order, and select the copies. */
  duplicate(): string | null {
    const sel = this.selected;
    const slide = this.slide;
    if (sel.length === 0 || !slide) return null;
    return this.place(JSON.parse(JSON.stringify(sel)) as OSObject[], this.feedbackLayersOf(sel, slide), { steps: 1, after: sel[sel.length - 1]!, renameAlways: true, verb: "Duplicated" });
  }

  /** Put a copy of what was copied or cut on this layer, which may be on another slide, and select it. */
  paste(): string | null {
    const clip = this.clip;
    const slide = this.slide;
    const layer = this.layer;
    if (!slide || !layer) return null;
    if (!clip) return "There is nothing to paste yet. Copy or cut an object first.";
    const key = `${slide.id}/${layer.id}`;
    const earlier = this.pasted.get(key) ?? 0;
    // Moved aside only if it would land on top of the original, or on top of an earlier paste.
    const originalHere = clip.slideId === slide.id && clip.layerId === layer.id && clip.objects.some((c) => layer.objects.some((o) => o.id === c.id));
    const msg = this.place(JSON.parse(JSON.stringify(clip.objects)) as OSObject[], JSON.parse(JSON.stringify(clip.layers)) as Layer[], { steps: earlier + (originalHere ? 1 : 0), after: null, renameAlways: false, verb: "Pasted" });
    if (!msg) return msg;
    this.pasted.set(key, earlier + 1);
    // Text colours were chosen for the slide the object came from. The Problems list will say if one has gone unreadable, but say so now.
    return this.tone() !== clip.tone ? `${msg} This slide has a different background from the one it was copied from, so check that its text is still easy to read.` : msg;
  }

  /** The common work of Duplicate and Paste: copies with their own ids, put on this layer as one undo step. */
  private place(sources: OSObject[], feedback: Layer[], at: { steps: number; after: OSObject | null; renameAlways: boolean; verb: string }): string | null {
    const layer = this.layer;
    const slide = this.slide;
    if (!layer || !slide || sources.length === 0) return null;
    this.record("");
    const alloc = this.allocator();
    const made = cloneObjects(sources, feedback, {
      newObjectId: alloc.object,
      newLayerId: alloc.layer,
      newTriggerId: this.triggerAllocator(),
      newGroupId: this.groupAllocator(),
      newVariable: (type, base) => this.makeVariable(type, base),
      variableOf: (id) => this.project.variables.find((v) => v.id === id),
      layerIds: new Set(slide.layers.map((l) => l.id)),
      objectIds: new Set([slide.baseLayer, ...slide.layers].flatMap((l) => l.objects.map((o) => o.id))),
    });

    // Names: a duplicate always says it is a copy; a paste keeps its name unless this layer already has one like it.
    const taken = layer.objects.map((o) => o.name);
    for (const o of made.objects) {
      if (at.renameAlways || taken.some((n) => n.toLowerCase() === o.name.toLowerCase())) o.name = copyName(o.name, taken);
      taken.push(o.name);
      if (o.type === "quizQuestion") {
        const f = (o.content as unknown as QuizContent).feedback;
        for (const [which, id] of [["Correct", f.correct], ["Incorrect", f.incorrect]] as const) {
          const l = made.layers.find((x) => x.id === id);
          if (l) l.name = `${which} feedback for ${o.name}`;
        }
      }
    }

    // Places: to one side by 20 stage pixels a step, and above everything already on the layer, keeping their order among themselves.
    const top = layer.objects.reduce((m, o) => Math.max(m, o.geometry.z), 0);
    const low = Math.min(...made.objects.map((o) => o.geometry.z));
    for (const o of made.objects) {
      const g = o.geometry;
      o.geometry = { ...g, x: Math.round((g.x + 20 * at.steps) * 100) / 100, y: Math.round((g.y + 20 * at.steps) * 100) / 100, z: top + 10 + (g.z - low) };
    }

    // Reading order: a duplicate goes straight after its original; a paste goes at the end. Only objects that are in the tab order
    // have a place in it, and the tab orders of the layer are renumbered 1, 2, 3 so they have no gaps or repeats.
    const tabbedCopies = made.objects.filter((o) => (o.accessibility.tabOrder ?? 0) >= 1);
    const tabbed = readingOrder(layer.objects).filter((o) => (o.accessibility.tabOrder ?? 0) >= 1);
    const afterAt = at.after ? tabbed.findIndex((o) => o.id === at.after!.id) : -1;
    if (afterAt === -1) tabbed.push(...tabbedCopies); else tabbed.splice(afterAt + 1, 0, ...tabbedCopies);
    tabbed.forEach((o, i) => (o.accessibility = { ...o.accessibility, tabOrder: i + 1 }));

    layer.objects.push(...made.objects);
    slide.layers.push(...made.layers);
    const first = made.objects[0]!;
    this.sel = { ...this.sel, objectId: first.id };
    this.more = made.objects.length > 1 ? { primary: first.id, ids: made.objects.slice(1).map((o) => o.id) } : null;
    this.anchor = first.id;
    this.emit({ kind: "structure", objectId: first.id });

    const parts = [`${at.verb} ${this.selectionName(sources)}.`];
    if (made.objects.length === 1 && first.name !== sources[0]!.name) parts.push(`The copy is called ${first.name}.`);
    if (made.newVariables > 0) parts.push(`It saves to ${made.newVariables === 1 ? "a variable" : "variables"} of its own, so it does not overwrite the original's answers.`);
    if (made.layers.length > 0) parts.push("It has feedback layers of its own, and it counts toward the score as another question.");
    if (made.droppedRules > 0) parts.push(`${made.droppedRules} ${made.droppedRules === 1 ? "rule was" : "rules were"} not copied, because ${made.droppedRules === 1 ? "it points" : "they point"} at a layer or an object on the slide the original is on.`);
    if (made.leftGroup > 0) parts.push(`Only part of a group was copied, so ${made.leftGroup === 1 ? "the copy is" : "the copies are"} not grouped.`);
    if (made.timingsReset > 0) parts.push(`${made.timingsReset} ${made.timingsReset === 1 ? "copy" : "copies"} followed a video or audio clip that did not come too, so ${made.timingsReset === 1 ? "it now appears" : "they now appear"} when the slide opens.`);
    if (made.objects.some((o) => ["image", "video", "audio", "embed", "download"].includes(o.type) && !o.accessibility.decorative && o.accessibility.altText !== "")) {
      parts.push("Its alt text was copied too, so check that it still describes this one.");
    }
    return parts.join(" ");
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
    this.pruneGroups(slide.baseLayer);
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
    const leftBank = this.leaveBanks(slideId);
    this.docs = this.docs.filter((d) => d.id !== slideId);
    if (this.sel.slideId === slideId) {
      const next = this.docs[Math.min(index, this.docs.length - 1)]!.slide;
      this.sel = { slideId: next.id, layerId: next.baseLayer.id, objectId: null };
    }
    this.emit({ kind: "structure" });
    this.emit({ kind: "selection" });
    return `Deleted ${doc.slide.name}${leftBank}`;
  }

  // ---- questions from a spreadsheet (questionimport.ts)

  /**
   * Make a slide for each question read from a spreadsheet, after the slide being edited, as one step to undo. Each slide is what Add > Quiz question
   * makes (the question as a heading, the question itself, and a layer of feedback for a right and a wrong answer), with the table's words in it. The
   * name a screen reader gives a question's answers is the question itself, because it is the author's own words and they will see it in Alt text.
   * With `bank` the new slides become a question bank. `shuffleAnswers` makes each multiple choice and multiple response question mix its answers.
   */
  addQuestionSlides(questions: ImportedQuestion[], opts: { bank: { name: string; draw: number; shuffle: boolean } | null; shuffleAnswers: boolean }): string | null {
    if (questions.length === 0) return "There are no questions to add.";
    const here = this.project.scenes.find((s) => s.slides.includes(this.sel.slideId)) ?? this.project.scenes[0];
    if (!here) return null;
    const blank = SLIDE_LAYOUTS.find((l) => l.id === "blank") ?? SLIDE_LAYOUTS[0]!;
    const alloc = this.allocator(emptySlide("", ""));
    const nextSlideId = this.slideIdMaker();
    this.record("");
    const made: Slide[] = [];
    questions.forEach((q, n) => {
      const slide = buildLayoutSlide(blank, nextSlideId(), alloc);
      slide.name = `Question ${n + 1}`;
      const built = buildQuiz(q.type === "short" ? "short" : q.type, alloc, { tone: "light", y: 60, z: 10, tab: 1 });
      const attempts = q.attempts ?? (q.type === "tf" ? 1 : 2);
      fillQuiz(built, q, { points: q.points ?? 10, attempts, shuffleAnswers: opts.shuffleAnswers, right: "Correct.", wrong: attempts > 1 ? "Not quite. Try again." : "Not quite." });
      slide.baseLayer.objects.push(...built.objects);
      slide.layers.push(...built.layers);
      made.push(slide);
    });
    const at = here.slides.indexOf(this.sel.slideId);
    here.slides.splice(at === -1 ? here.slides.length : at + 1, 0, ...made.map((s) => s.id));
    for (const slide of made) this.docs.push({ id: slide.id, slide, originalText: "", savedCompact: "" });
    this.syncDocOrder();
    let bankNote = "";
    if (opts.bank) {
      if (made.length < 2) bankNote = " A bank needs at least two questions, so no bank was made.";
      else {
        const bank: Bank = {
          id: `bank-${String(nextNumber(this.banks.map((b) => b.id), "bank-")).padStart(4, "0")}`,
          name: opts.bank.name.trim() || `Question bank ${this.banks.length + 1}`,
          slides: made.map((s) => s.id),
          draw: Math.min(made.length, Math.max(1, Math.round(opts.bank.draw))),
          shuffle: opts.bank.shuffle,
        };
        this.writeBanks([...this.banks, bank]);
        bankNote = ` They are the question bank ${bank.name}: each learner is shown ${bank.draw} of them${bank.shuffle ? ", in a mixed order" : ""}.`;
      }
    }
    const first = made[0]!;
    this.sel = { slideId: first.id, layerId: first.baseLayer.id, objectId: null };
    this.more = null;
    this.anchor = null;
    this.emit({ kind: "structure" });
    this.emit({ kind: "selection" });
    const number = this.docs.findIndex((d) => d.id === first.id) + 1;
    return `Added ${made.length === 1 ? "one question" : `${made.length} questions`} as ${made.length === 1 ? `slide ${number}` : `slides ${number} to ${number + made.length - 1}`}.${bankNote} One Undo takes them all away.`;
  }

  // ---- question banks (player/src/bank.ts)

  get banks(): Bank[] {
    return this.project.banks ?? [];
  }

  /** The bank a slide is in, if it is in one. */
  bankOf(slideId: string): Bank | undefined {
    return this.banks.find((b) => b.slides.includes(slideId));
  }

  private writeBanks(next: Bank[]): void {
    if (next.length === 0) delete this.project.banks;
    else this.project.banks = next;
  }

  /** A deleted slide leaves its bank. A bank left with fewer than two slides is taken away, and one asked to show more than it has shows what it has. Says what happened, for the end of a message. */
  private leaveBanks(slideId: string): string {
    const note: string[] = [];
    const next: Bank[] = [];
    for (const bank of this.banks) {
      if (!bank.slides.includes(slideId)) { next.push(bank); continue; }
      const slides = bank.slides.filter((s) => s !== slideId);
      if (slides.length < 2) { note.push(`The question bank ${bank.name} has too few slides left and was taken away.`); continue; }
      next.push({ ...bank, slides, draw: Math.min(bank.draw, slides.length) });
      note.push(`It was one of the slides of the question bank ${bank.name}.`);
    }
    if (note.length > 0) this.writeBanks(next);
    return note.length > 0 ? `. ${note.join(" ")}` : "";
  }

  /** The slides from one slide to another, in course order, or null if either is not in the course. */
  private slideRun(first: string, last: string): string[] | null {
    const order = this.slides.map((s) => s.id);
    const a = order.indexOf(first);
    const b = order.indexOf(last);
    if (a === -1 || b === -1) return null;
    return order.slice(Math.min(a, b), Math.max(a, b) + 1);
  }

  /** Why these slides cannot make a bank (or this bank), or null if they can. */
  private bankProblem(slides: string[], except: string | null): string | null {
    if (slides.length < 2) return "A question bank needs at least two slides: it picks some of them for each learner.";
    const order = this.slides.map((s) => s.id);
    for (const id of slides) {
      const other = this.banks.find((b) => b.id !== except && b.slides.includes(id));
      if (other) return `Slide ${order.indexOf(id) + 1} is already in the question bank ${other.name}. A slide can be in one bank only.`;
    }
    return null;
  }

  /** Make a bank of the slides from the first to the last. It starts by showing half of them, in a mixed order. */
  addBank(first: string, last: string, name = ""): string | null {
    const slides = this.slideRun(first, last);
    if (!slides) return null;
    const problem = this.bankProblem(slides, null);
    if (problem) return problem;
    const bank: Bank = {
      id: `bank-${String(nextNumber(this.banks.map((b) => b.id), "bank-")).padStart(4, "0")}`,
      name: name.trim() || `Question bank ${this.banks.length + 1}`,
      slides,
      draw: Math.max(1, Math.floor(slides.length / 2)),
      shuffle: true,
    };
    this.record("");
    this.writeBanks([...this.banks, bank]);
    this.emit({ kind: "structure" });
    return `Added the question bank ${bank.name}: ${slides.length} slides, showing ${bank.draw} of them to each learner, in a mixed order.`;
  }

  private bankById(id: string): Bank | undefined {
    return this.banks.find((b) => b.id === id);
  }

  private updateBank(id: string, key: string, change: (b: Bank) => Bank): void {
    this.record(key);
    this.writeBanks(this.banks.map((b) => (b.id === id ? change(b) : b)));
    this.emit({ kind: "structure" });
  }

  setBankName(id: string, name: string): string | null {
    const bank = this.bankById(id);
    const next = name.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!bank) return null;
    if (next === "") return "A question bank needs a name.";
    if (next === bank.name) return null;
    this.updateBank(id, `bank-name:${id}`, (b) => ({ ...b, name: next }));
    return "Name updated";
  }

  /** Move the bank to the slides from the first to the last. How many it shows is lowered if it now has fewer. */
  setBankRange(id: string, first: string, last: string): string | null {
    const bank = this.bankById(id);
    const slides = this.slideRun(first, last);
    if (!bank || !slides) return null;
    const problem = this.bankProblem(slides, id);
    if (problem) return problem;
    if (slides.join() === bank.slides.join()) return null;
    this.updateBank(id, "", (b) => ({ ...b, slides, draw: Math.min(b.draw, slides.length) }));
    return `The question bank ${bank.name} now holds ${slides.length} slides.`;
  }

  /** How many of the bank's slides each learner is shown: from 1 to all of them. */
  setBankDraw(id: string, draw: number): string | null {
    const bank = this.bankById(id);
    if (!bank) return null;
    if (!Number.isFinite(draw)) return "That needs a number.";
    const next = Math.min(bank.slides.length, Math.max(1, Math.round(draw)));
    if (next === bank.draw) return Math.round(draw) === next ? null : `A bank shows from 1 to ${bank.slides.length} slides.`;
    this.updateBank(id, `bank-draw:${id}`, (b) => ({ ...b, draw: next }));
    const clamped = Math.round(draw) === next ? "" : ` That is as many as it can.`;
    return `Each learner is shown ${next} of the ${bank.slides.length} slides.${clamped}`;
  }

  setBankMix(id: string, on: boolean): string | null {
    const bank = this.bankById(id);
    if (!bank || bank.shuffle === on) return null;
    this.updateBank(id, "", (b) => ({ ...b, shuffle: on }));
    return on ? "The slides are shown in a mixed order." : "The slides are shown in the order they have in the course.";
  }

  deleteBank(id: string): string | null {
    const bank = this.bankById(id);
    if (!bank) return null;
    this.record("");
    this.writeBanks(this.banks.filter((b) => b.id !== id));
    this.emit({ kind: "structure" });
    return `Deleted the question bank ${bank.name}. Its slides stay in the course, and every learner sees all of them.`;
  }

  /** Mix the answers of a multiple choice or multiple response question for each learner. */
  setShuffleChoices(objectId: string, on: boolean): string | null {
    const obj = this.find(objectId);
    if (!obj || obj.type !== "quizQuestion") return null;
    const type = String(obj.content["questionType"]);
    if (type !== "multipleChoice" && type !== "multipleResponse") return "Only a question with answers to choose from can mix them.";
    if ((obj.content["shuffle"] === true) === on) return null;
    this.record("");
    const content = { ...obj.content };
    if (on) content["shuffle"] = true;
    else delete content["shuffle"];
    obj.content = content;
    this.emit({ kind: "content", objectId });
    return on ? "Each learner will see the answers in a different order. Here you still see your own order." : "The answers are shown in your order.";
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

  /**
   * Make a copy of a slide, straight after it in the same scene, and select it. Everything is copied as it is: layers (with the same ids,
   * because a layer id only has to be unique on its slide), objects (with new ids, because those are unique across the project and name
   * their narration), locks, timing, animation and groups. Rules between the slide's own objects and layers follow to the copy. An input
   * saves to variables of its own, so the copy does not overwrite the original's answers, and the rules that use them follow. Rules that
   * jump to other slides are unchanged, and so are rules on other slides that jump to this one: they still go to the original.
   */
  duplicateSlide(slideId = this.sel.slideId): string | null {
    const doc = this.docs.find((d) => d.id === slideId);
    if (!doc) return null;
    const source = doc.slide;
    const ids = [...this.docs.map((d) => d.id), ...this.project.scenes.flatMap((s) => s.slides)];
    const id = `slide-${String(nextNumber(ids, "slide-")).padStart(3, "0")}`;
    this.record("");
    const layers = [source.baseLayer, ...source.layers];
    const flat = layers.flatMap((l) => l.objects);
    const alloc = this.allocator();
    const made = cloneObjects(flat, [], {
      newObjectId: alloc.object,
      newLayerId: alloc.layer,
      newTriggerId: this.triggerAllocator(),
      newGroupId: this.groupAllocator(),
      newVariable: (type, base) => this.makeVariable(type, base),
      variableOf: (vid) => this.project.variables.find((v) => v.id === vid),
      layerIds: new Set(layers.map((l) => l.id)),
      objectIds: new Set(flat.map((o) => o.id)),
      keepLocks: true,
    });
    const slide = JSON.parse(JSON.stringify(source)) as Slide;
    slide.id = id;
    // A copy is the author's own slide now, not the recorded step it came from, so a changed recording will not reach it.
    delete slide.provenance;
    slide.name = copyName(source.name, this.docs.map((d) => d.slide.name));
    let from = 0;
    for (const layer of [slide.baseLayer, ...slide.layers]) {
      layer.objects = made.objects.slice(from, from + layer.objects.length);
      from += layer.objects.length;
    }
    const scene = this.project.scenes.find((s) => s.slides.includes(slideId)) ?? this.project.scenes[0]!;
    const at = scene.slides.indexOf(slideId);
    scene.slides.splice(at === -1 ? scene.slides.length : at + 1, 0, id);
    // The copy of a slide in a question bank joins the bank, so the bank's slides stay side by side.
    const bank = this.bankOf(slideId);
    if (bank) this.writeBanks(this.banks.map((b) => (b.id === bank.id ? { ...b, slides: [...b.slides.slice(0, b.slides.indexOf(slideId) + 1), id, ...b.slides.slice(b.slides.indexOf(slideId) + 1)] } : b)));
    this.docs.push({ id, slide, originalText: "", savedCompact: "" });
    this.syncDocOrder();
    this.sel = { slideId: id, layerId: slide.baseLayer.id, objectId: null };
    this.more = null;
    this.anchor = null;
    this.emit({ kind: "structure" });
    this.emit({ kind: "selection" });

    const parts = [`Duplicated ${source.name}. The copy is ${slide.name}, slide ${this.docs.findIndex((d) => d.id === id) + 1} of ${this.docs.length}.`];
    if (made.newVariables > 0) parts.push(`Its ${made.newVariables === 1 ? "input saves" : "inputs save"} to ${made.newVariables === 1 ? "a variable" : "variables"} of its own, so the copy does not overwrite the original's answers.`);
    const questions = flat.filter((o) => o.type === "quizQuestion").length;
    if (questions > 0) parts.push(`${questions === 1 ? "Its question counts" : `Its ${questions} questions count`} toward the score again, because the copy has ${questions === 1 ? "one" : "questions"} of its own.`);
    if (bank) parts.push(`The copy is in the question bank ${bank.name} too.`);
    parts.push("Rules on other slides that go to this slide still go to the original.");
    return parts.join(" ");
  }

  /**
   * Make a copy of a layer, straight after it, and select it. The objects are copied as they are, with new ids; a rule inside the layer that
   * points at the layer itself, or at one of its objects, points at the copy. Nothing shows the copy yet: a layer appears only when a rule
   * shows it, so the author adds that rule. A quiz question on the layer brings feedback layers of its own.
   */
  duplicateLayer(layerId = this.sel.layerId): string | null {
    const slide = this.slide;
    const source = this.layers.find((l) => l.id === layerId);
    if (!slide || !source) return null;
    this.record("");
    const everyLayer = [slide.baseLayer, ...slide.layers];
    const alloc = this.allocator();
    const newId = alloc.layer();
    const made = cloneObjects(source.objects, this.feedbackLayersOf(source.objects, slide), {
      newObjectId: alloc.object,
      newLayerId: alloc.layer,
      newTriggerId: this.triggerAllocator(),
      newGroupId: this.groupAllocator(),
      newVariable: (type, base) => this.makeVariable(type, base),
      variableOf: (vid) => this.project.variables.find((v) => v.id === vid),
      layerIds: new Set(everyLayer.map((l) => l.id)),
      objectIds: new Set(everyLayer.flatMap((l) => l.objects.map((o) => o.id))),
      keepLocks: true,
      layerMap: new Map([[source.id, newId]]),
    });
    const names = everyLayer.map((l) => l.name);
    const layer: Layer = { id: newId, name: copyName(source.name, names), objects: made.objects };
    names.push(layer.name);
    // A copied question's feedback layers are copies too, and say which layer they belong to.
    for (const extra of made.layers) {
      extra.name = copyName(extra.name, names);
      names.push(extra.name);
    }
    const at = slide.layers.findIndex((l) => l.id === source.id);
    slide.layers.splice(at + 1, 0, layer, ...made.layers);
    this.sel = { ...this.sel, layerId: layer.id, objectId: null };
    this.more = null;
    this.anchor = null;
    this.emit({ kind: "structure" });
    this.emit({ kind: "selection" });

    const parts = [`Duplicated ${source.name}. The copy is ${layer.name}, and you are now editing it. No rule shows it yet: add one, as for any layer.`];
    if (made.newVariables > 0) parts.push(`Its ${made.newVariables === 1 ? "input saves" : "inputs save"} to ${made.newVariables === 1 ? "a variable" : "variables"} of its own, so the copy does not overwrite the original's answers.`);
    if (made.layers.length > 0) parts.push(`It brought ${made.layers.length === 2 ? "two feedback layers" : `${made.layers.length} feedback layers`}, and its ${made.layers.length === 2 ? "question counts" : "questions count"} toward the score again.`);
    return parts.join(" ");
  }

  /**
   * Move a layer earlier (-1) or later (+1) in the slide's layer order. The base layer stays first. A later layer is drawn in front of an
   * earlier one where they overlap, and is read after it.
   */
  moveLayer(layerId: string, delta: -1 | 1): string | null {
    const slide = this.slide;
    if (!slide) return null;
    if (layerId === slide.baseLayer.id) return "The base layer is always first.";
    const at = slide.layers.findIndex((l) => l.id === layerId);
    if (at === -1) return null;
    const layer = slide.layers[at]!;
    const to = at + delta;
    if (to < 0 || to >= slide.layers.length) return delta < 0 ? `${layer.name} is already the first layer after the base layer.` : `${layer.name} is already the last layer.`;
    this.record("");
    [slide.layers[at], slide.layers[to]] = [slide.layers[to]!, slide.layers[at]!];
    this.emit({ kind: "structure" });
    return `${layer.name} is now layer ${to + 2} of ${slide.layers.length + 1}. A later layer is drawn in front of an earlier one, and is read after it.`;
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

  /**
   * Give the project a different theme. Everything that refers to theme colours changes with it. A logo belongs to the project's
   * design but not to a colour scheme, so when a built-in theme is chosen (`keepLogo`) the logo the project has is kept with it.
   */
  setTheme(theme: Theme, keepLogo = false): string | null {
    const next = cloneTheme(theme);
    const kept = keepLogo && !next.logo && this.theme.logo !== undefined;
    if (kept) next.logo = { ...this.theme.logo! };
    if (JSON.stringify(next) === JSON.stringify(this.theme)) return null;
    this.record("");
    this.theme = next;
    this.project.theme = { ref: "theme.json" };
    this.emit({ kind: "structure" });
    return `Theme changed to ${theme.name}${kept ? ". The logo was kept." : ""}`;
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

  // ---- a picture behind everything on a slide

  /** The file already in the project that was recorded with this credit title, if any, so a picture chosen again is not copied again. */
  pathOfCredit(title: string): string | null {
    return this.assets.find((a) => a.title === title)?.path ?? null;
  }

  /** The picture behind everything on a slide, if it has one (see backgrounds.ts). */
  backgroundPictureOf(slideId: string): OSObject | null {
    return this.docs.find((d) => d.id === slideId)?.slide.baseLayer.objects.find(isBackgroundPicture) ?? null;
  }

  /**
   * Put a picture behind everything on a slide, in place of the one that was there. It is a decorative picture the size of the stage at the back of the base layer, locked so
   * a click on the slide does not move it, and the slide's own background becomes the picture's average colour: the checker judges text against a colour and cannot see a
   * picture, so this is its best guess. Text that follows the theme takes the colour that suits the new background. `credit` says where the picture came from. One undo step.
   */
  setBackgroundPicture(slideId: string, picture: { src: string; color: string | null; credit?: CreditEntry }): string | null {
    const doc = this.docs.find((d) => d.id === slideId);
    if (!doc || !picture.src.startsWith("assets/")) return null;
    const slide = doc.slide;
    this.record("");
    const objects = slide.baseLayer.objects;
    for (let i = objects.length - 1; i >= 0; i--) {
      if (isBackgroundPicture(objects[i]!)) objects.splice(i, 1);
    }
    // Behind everything is z 0. If something already sits at 0 or below, everything moves up together, so the order they were in does not change.
    const lowest = objects.reduce((m, o) => Math.min(m, o.geometry.z), Infinity);
    if (lowest !== Infinity && lowest <= 0) {
      for (const o of objects) o.geometry = { ...o.geometry, z: o.geometry.z + 1 - lowest };
    }
    const stage = this.project.stage;
    objects.unshift({
      ...box(this.allocator().object(), 0, 0, stage.width, stage.height, 0), type: "image", name: BACKGROUND_NAME, locked: true,
      content: { src: picture.src }, style: {},
      accessibility: { altText: "", role: "presentation", tabOrder: 0, decorative: true },
    });
    if (picture.credit) {
      const at = this.assets.findIndex((a) => a.path === picture.credit!.path);
      if (at === -1) this.assets.push(picture.credit); else this.assets[at] = picture.credit;
    }
    if (picture.color && /^#[0-9a-fA-F]{6}$/.test(picture.color)) {
      const was = toneOf(slide.background, (hex) => this.lightBackground(hex));
      slide.background = picture.color;
      this.retone(slide, was, toneOf(picture.color, (hex) => this.lightBackground(hex)));
    }
    this.emit({ kind: "structure" });
    return "Background picture added behind everything on this slide. It is locked, so clicking the slide does not move it.";
  }

  /** Take a slide's background picture away. The slide's background goes back to the theme's. One undo step. */
  removeBackgroundPicture(slideId: string): string | null {
    const doc = this.docs.find((d) => d.id === slideId);
    const at = doc ? doc.slide.baseLayer.objects.findIndex(isBackgroundPicture) : -1;
    if (!doc || at === -1) return null;
    const slide = doc.slide;
    this.record("");
    const [gone] = slide.baseLayer.objects.splice(at, 1);
    if (gone && this.sel.objectId === gone.id) this.sel = { ...this.sel, objectId: null };
    if (slide.background !== null) {
      const was = toneOf(slide.background, (hex) => this.lightBackground(hex));
      slide.background = null;
      this.retone(slide, was, toneOf(null, (hex) => this.lightBackground(hex)));
    }
    this.emit({ kind: "structure" });
    return "Background picture removed. The slide's background is the theme's again.";
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
    return JSON.stringify({ scenes: this.project.scenes, variables: this.project.variables, characters: this.project.characters, banks: this.project.banks, sources: this.project.sources, credits: this.project.credits, completion: this.project.completion, assets: this.assets, theme: this.theme, ref: this.project.theme, slides: this.docs.map((d) => d.slide) });
  }

  private restore(snapshot: string): void {
    const state = JSON.parse(snapshot) as { scenes: Project["scenes"]; variables: Project["variables"]; characters?: Project["characters"]; banks?: Project["banks"]; sources?: Project["sources"]; credits: boolean; completion?: Project["completion"]; assets: CreditEntry[]; theme: Theme; ref: Project["theme"]; slides: Slide[] };
    this.project.scenes = state.scenes;
    this.project.variables = state.variables;
    if (state.characters) this.project.characters = state.characters;
    else delete this.project.characters;
    if (state.banks) this.project.banks = state.banks;
    else delete this.project.banks;
    if (state.sources) this.project.sources = state.sources;
    else delete this.project.sources;
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
