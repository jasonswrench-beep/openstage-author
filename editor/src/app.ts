// The editor's window: toolbar, slide list, canvas, properties, objects, problems.
//
// Accessibility rules this file follows (ATAG Part A, and CLAUDE.md):
//  - Everything is reachable and operable by keyboard. The canvas is a convenience; each
//    thing it does can also be done with typed values and lists.
//  - Nothing traps focus. F6 and Shift+F6 move between panels.
//  - Controls that become unavailable use aria-disabled, so focus is not thrown away.
//  - When a panel is redrawn, focus goes back to the same control. Changing a value never
//    drops the author's place.
//  - Changes are announced in a polite live region.
//  - Alt text and the other accessibility fields are never filled in on the author's behalf.

import type { CertificateContent, Condition, DownloadContent, EmbedContent, InputContent, InteractionContent, OSObject, QuizContent, Primitive, ResultsContent, TableContent, Variable } from "../../player/src/types.ts";
import { INPUT_VARIABLE_TYPE } from "../../player/src/inputs.ts";
import { backend, errorText, type Finding } from "./backend.ts";
import { Canvas } from "./canvas.ts";
import { SHAPE_KINDS } from "../../player/src/stage.ts";
import { backgroundColors, isThemeRef, resolveValue } from "../../player/src/theme.ts";
import { COLOR_ROLES, colorRef } from "./colors.ts";
import { BLOCK_SIZES, colorName, eventsFor, operatorsFor, OPERATOR_LABELS, parseBody, parseVideoAddress, type RuleAction, type RuleEvent, contrastNote, contrastRatio, FONT_CHOICES, normalizeHex, PALETTE, parseSimpleText, TEXT_BLOCKS, themeColorLabel, type Activation, type TextBlock } from "./content.ts";
import { fileDetails } from "../../player/src/downloads.ts";
import { ITEM_LIMITS } from "../../player/src/interactions.ts";
import { openAssets } from "./assetsdialog.ts";
import { openVariables } from "./variablesdialog.ts";
import { askText } from "./textprompt.ts";
import { askChoice, interactionPreview, shapePreview } from "./choicepicker.ts";
import { ADD_MENU, groupOptions, INPUTS, INTERACTIONS, SLIDE_LAYOUTS, type QuizType } from "./factory.ts";
import { askLayout } from "./layoutpicker.ts";
import { FORMAT_VERSION, Model, type Change } from "./model.ts";
import { askNewProject } from "./newproject.ts";
import { openNarration } from "./narrationdialog.ts";
import { openTiming } from "./timingdialog.ts";
import { TimelinePanel } from "./timelinepanel.ts";
import { describeTiming, isStartingTiming, parseSeconds, secondsText } from "./timing.ts";
import { describeAnimation, effectChoices, isStartingAnimation, MAX_DURATION, MIN_DURATION, type Phase } from "./animation.ts";
import { audioStatus, keyOf, statusLine, VOICES, voiceGroups, type CachedAudio, type Narration } from "./narration.ts";
import { openPublish } from "./publishdialog.ts";
import { failureText, narrationLine } from "./publishing.ts";
import { newProjectFiles } from "./template.ts";
import { askTheme } from "./themepicker.ts";
import { BUILT_IN_THEMES, COLOR_ROLE_NAMES } from "./themes.ts";

type Attrs = Record<string, string | boolean | number>;

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

const VALIDATE_DELAY_MS = 600;
const SHAPE_LABELS: Record<(typeof SHAPE_KINDS)[number], string> = { rectangle: "Rectangle", rounded: "Rounded rectangle", ellipse: "Ellipse", triangle: "Triangle", diamond: "Diamond", arrow: "Arrow" };
const BLOCK_LABELS: Record<TextBlock, string> = { p: "Paragraph", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", h4: "Heading 4", h5: "Heading 5", h6: "Heading 6" };

/** What decides whether an input's panel has to be rebuilt: its parts, and the variables it can choose between. */
function inputShape(o: OSObject, m: Model): string {
  const c = o.content as unknown as InputContent;
  const parts = c.kind === "checkbox" ? c.items : c.kind === "likert" || c.kind === "semantic" ? c.rows : c.options;
  return `${c.kind}|${(parts ?? []).map((p) => `${p.id}:${(p as { variable?: string }).variable ?? ""}`).join(",")}|${c.variable ?? ""}|${m.variables.map((v) => `${v.id}${v.name}`).join(",")}`;
}

/** What decides whether a table's panel has to be rebuilt: its size and its header options. */
function tableShape(o: OSObject): string {
  const t = o.content as unknown as TableContent;
  return `${t.rows.length}x${t.rows[0]?.length ?? 0}|${t.headerRow}|${t.headerColumn}`;
}

/** What decides whether an interaction's panel has to be rebuilt: its kind, and which items have which parts. */
function interactionShape(o: OSObject): string {
  const c = o.content as unknown as InteractionContent;
  return `${c.kind}|${c.orientation}|${c.items.map((i) => `${i.id}${i.image ? "p" : ""}${parseBody(i.body) === null ? "x" : ""}`).join(",")}`;
}

/** A colour's name for the author: "Theme: Accent (#0b5fff)", "Blue (#0b3fb3)" or the hex code. */
function describeColor(m: Model, v: string): string {
  const hx = normalizeHex(String(resolveValue(m.theme, v)));
  return isThemeRef(v) && hx ? themeColorLabel(v, hx, COLOR_ROLE_NAMES) : colorName(v);
}

export class App {
  private model: Model | null = null;
  private readonly root: HTMLElement;
  private readonly announcer: HTMLElement;
  private readonly canvas: Canvas;

  private readonly newBtn: HTMLButtonElement;
  private readonly openBtn: HTMLButtonElement;
  private readonly themeBtn: HTMLButtonElement;
  private readonly assetsBtn: HTMLButtonElement;
  private readonly variablesBtn: HTMLButtonElement;
  private readonly narrationBtn: HTMLButtonElement;
  private readonly timingBtn: HTMLButtonElement;
  private readonly timelineBtn: HTMLButtonElement;
  private readonly timelinePanel: TimelinePanel;
  private readonly saveBtn: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly previewBtn: HTMLButtonElement;
  private readonly publishBtn: HTMLButtonElement;

  private readonly slideList: HTMLElement;
  private readonly addSlideBtn: HTMLButtonElement;
  private readonly changeLayoutBtn: HTMLButtonElement;
  private readonly deleteSlideBtn: HTMLButtonElement;
  private readonly slideUpBtn: HTMLButtonElement;
  private readonly slideDownBtn: HTMLButtonElement;
  private readonly layerSelect: HTMLSelectElement;
  private readonly addLayerBtn: HTMLButtonElement;
  private readonly deleteLayerBtn: HTMLButtonElement;
  private readonly objectList: HTMLElement;
  private readonly addKind: HTMLSelectElement;
  private readonly addObjectBtn: HTMLButtonElement;
  private readonly deleteObjectBtn: HTMLButtonElement;
  private readonly duplicateBtn: HTMLButtonElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly cutBtn: HTMLButtonElement;
  private readonly pasteBtn: HTMLButtonElement;
  private readonly moveEarlier: HTMLButtonElement;
  private readonly moveLater: HTMLButtonElement;
  private readonly problemList: HTMLElement;
  private readonly problemSummary: HTMLElement;
  private readonly propsBody: HTMLElement;
  private readonly welcome: HTMLElement;
  private readonly workspace: HTMLElement;
  private readonly statusSave: HTMLElement;
  private readonly statusSlide: HTMLElement;
  private readonly statusProblems: HTMLElement;

  private findings: Finding[] = [];
  private validateTimer = 0;
  private validateSeq = 0;
  private lastSummary = "";
  private regions: HTMLElement[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
    this.announcer = h("div", { class: "sr-only", role: "status", "aria-live": "polite" });
    this.canvas = new Canvas(document, () => this.model, backend, (m) => this.announce(m));

    this.newBtn = this.tool("New project", "Make a new project (Ctrl+N)", () => void this.newProject());
    this.openBtn = this.tool("Open project", "Open a project folder (Ctrl+O)", () => void this.open());
    this.themeBtn = this.tool("Themes", "Choose a theme: the colours, fonts and backgrounds of the whole project", () => void this.chooseTheme());
    this.assetsBtn = this.tool("Assets", "The project's images, video and audio, and stock images to add to it", () => void this.openAssetsDialog());
    this.variablesBtn = this.tool("Variables", "The values the course remembers, which rules and inputs use", () => void this.openVariablesDialog());
    this.narrationBtn = this.tool("Narration", "Everything the course says aloud, and making the audio for it", () => void this.openNarrationDialog());
    this.timingBtn = this.tool("Timing", "When things appear and disappear on this slide, and whether it moves on by itself", () => void this.openTimingDialog());
    this.timelineBtn = this.tool("Timeline", "Show or hide a timeline of this slide, which draws when everything appears and goes", () => this.toggleTimeline());
    this.timelineBtn.setAttribute("aria-pressed", "false");
    this.timelinePanel = new TimelinePanel({
      model: () => this.model,
      narrationMs: (o) => this.narrationMs(o),
      announce: (msg) => this.announce(msg),
      openList: () => void this.openTimingDialog(),
      onClose: () => this.toggleTimeline(false),
    });
    this.saveBtn = this.tool("Save", "Save changes (Ctrl+S)", () => void this.save());
    this.undoBtn = this.tool("Undo", "Undo the last change (Ctrl+Z)", () => this.undo());
    this.redoBtn = this.tool("Redo", "Redo (Ctrl+Y)", () => this.redo());
    this.previewBtn = this.tool("Preview", "See the course in your browser as it is now, saved or not (Ctrl+P)", () => void this.preview());
    this.publishBtn = this.tool("Publish", "Make a SCORM package for your LMS (Ctrl+Shift+P)", () => void this.publish());
    const toolbar = h("div", { class: "toolbar", role: "toolbar", "aria-label": "Project" }, this.newBtn, this.openBtn, this.themeBtn, this.assetsBtn, this.variablesBtn, this.narrationBtn, this.timingBtn, this.timelineBtn, this.saveBtn, this.undoBtn, this.redoBtn, this.previewBtn, this.publishBtn);
    const header = h("header", { class: "topbar" }, h("h1", { text: "OpenStage Author" }), toolbar);

    // Slides
    this.slideList = h("ul", { class: "item-list", role: "list" });
    this.addSlideBtn = this.small("Add slide", "Add a slide after this one, choosing its layout", () => void this.addSlide());
    this.changeLayoutBtn = this.small("Change layout", "Choose a different layout for this slide", () => void this.changeLayout());
    this.deleteSlideBtn = this.small("Delete slide", "Delete this slide (Delete key in the list)", () => this.deleteSlide());
    this.slideUpBtn = this.small("Up", "Move this slide earlier (Alt+Up Arrow)", () => this.moveSlide(-1), "Move slide up");
    this.slideDownBtn = this.small("Down", "Move this slide later (Alt+Down Arrow)", () => this.moveSlide(1), "Move slide down");
    const slidesNav = h("nav", { class: "panel slides", "aria-labelledby": "slides-h" },
      h("h2", { id: "slides-h", text: "Slides" }),
      h("div", { class: "btn-row" }, this.addSlideBtn, this.changeLayoutBtn, this.deleteSlideBtn, this.slideUpBtn, this.slideDownBtn),
      this.slideList);

    // Canvas and layers
    this.layerSelect = h("select", { id: "layer-select" });
    this.layerSelect.addEventListener("change", () => this.model?.selectLayer(this.layerSelect.value));
    this.addLayerBtn = this.small("Add layer", "Add a layer to this slide", () => this.addLayer());
    this.deleteLayerBtn = this.small("Delete layer", "Delete this layer and what is on it", () => this.deleteLayer());
    const layerBar = h("div", { class: "layer-bar" }, h("label", { for: "layer-select", text: "Layer being edited" }), this.layerSelect, this.addLayerBtn, this.deleteLayerBtn);
    const main = h("main", { class: "center", "aria-label": "Canvas" }, layerBar, this.canvas.element);

    // Properties
    this.propsBody = h("div", { class: "props-body" });
    const props = h("aside", { class: "panel props", "aria-labelledby": "props-h" }, h("h2", { id: "props-h", text: "Properties" }), this.propsBody);

    // Objects
    this.objectList = h("ul", { class: "item-list", role: "list" });
    this.addKind = h("select", { id: "add-kind" }, ...ADD_MENU.map((k) => h("option", { value: k.value, text: k.label })));
    this.addObjectBtn = this.small("Add object", "Add the chosen kind of object to this layer", () => void this.addObject());
    this.deleteObjectBtn = this.small("Delete object", "Delete the selected object (Delete key)", () => this.deleteObject());
    this.moveEarlier = this.small("Move earlier", "Earlier in reading order (Alt+Up Arrow)", () => this.reorder(-1));
    this.moveLater = this.small("Move later", "Later in reading order (Alt+Down Arrow)", () => this.reorder(1));
    this.duplicateBtn = this.small("Duplicate", "Make a copy of the selected object beside it (Ctrl+D)", () => this.duplicateObject());
    this.copyBtn = this.small("Copy", "Copy the selected object (Ctrl+C)", () => this.copyObject());
    this.cutBtn = this.small("Cut", "Copy the selected object and remove it (Ctrl+X)", () => this.cutObject());
    this.pasteBtn = this.small("Paste", "Paste the copied object on this layer, which may be on another slide (Ctrl+V)", () => this.pasteObject());
    const objects = h("section", { class: "panel objects", "aria-labelledby": "objects-h" },
      h("h2", { id: "objects-h", text: "Objects" }),
      h("div", { class: "btn-row" }, h("label", { for: "add-kind", text: "Add" }), this.addKind, this.addObjectBtn),
      h("div", { class: "btn-row" }, this.deleteObjectBtn, this.moveEarlier, this.moveLater),
      h("div", { class: "btn-row" }, this.duplicateBtn, this.copyBtn, this.cutBtn, this.pasteBtn),
      h("p", { class: "note", text: "In reading order, which is also the tab order." }),
      this.objectList);

    // Problems
    this.problemSummary = h("span", { class: "summary" });
    this.problemList = h("ul", { class: "item-list", role: "list" });
    const problems = h("section", { class: "panel problems", "aria-labelledby": "problems-h" },
      h("div", { class: "panel-head" }, h("h2", { id: "problems-h", text: "Problems" }), this.problemSummary),
      this.problemList);

    this.workspace = h("div", { class: "workspace" }, slidesNav, main, this.timelinePanel.element, props, h("div", { class: "bottom" }, objects, problems));
    this.welcome = h("div", { class: "welcome" },
      h("h2", { text: "Open a project to begin" }),
      h("p", { text: "A project is a folder containing project.json. The examples folder in the OpenStage repository has two to try." }));
    const newWelcome = h("button", { type: "button", text: "New project" });
    newWelcome.addEventListener("click", () => void this.newProject());
    const openWelcome = h("button", { type: "button", text: "Open project" });
    openWelcome.addEventListener("click", () => void this.open());
    this.welcome.append(newWelcome, " ", openWelcome);

    this.statusSave = h("span");
    this.statusSlide = h("span");
    this.statusProblems = h("span");
    const status = h("footer", { class: "statusbar" }, this.statusSave, this.statusSlide, this.statusProblems);

    this.regions = [slidesNav, main, this.timelinePanel.element, props, objects, problems];
    root.append(header, this.welcome, this.workspace, status, this.announcer);
    this.workspace.hidden = true;

    document.addEventListener("keydown", (e) => this.onGlobalKey(e));
    backend.guardClose(() => this.model?.dirty ?? false);
    this.updateChrome();
  }

  // ---- helpers

  private tool(label: string, title: string, fn: () => void): HTMLButtonElement {
    const b = h("button", { type: "button", text: label, title });
    b.addEventListener("click", () => {
      if (b.getAttribute("aria-disabled") !== "true") fn();
    });
    return b;
  }

  /** A small button inside a panel. Its name always contains its visible text. */
  private small(label: string, title: string, fn: () => void, name = ""): HTMLButtonElement {
    const b = this.tool(label, title, fn);
    if (name) b.setAttribute("aria-label", name);
    b.classList.add("small");
    return b;
  }

  private announce(message: string): void {
    this.announcer.textContent = "";
    window.setTimeout(() => (this.announcer.textContent = message), 30);
  }

  private setEnabled(b: HTMLElement, on: boolean): void {
    if (on) b.removeAttribute("aria-disabled");
    else b.setAttribute("aria-disabled", "true");
  }

  // ---- project actions

  async open(): Promise<void> {
    if (this.model?.dirty && !(await backend.confirm("You have unsaved changes. Open another project and lose them?"))) return;
    try {
      const dir = await backend.pickFolder("Open an OpenStage project folder", "open");
      if (!dir) return;
      await this.load(dir);
    } catch (err) {
      this.announce(`Could not open the project. ${errorText(err)}`);
      window.alert(`Could not open the project.\n\n${errorText(err)}`);
    }
  }

  async newProject(): Promise<void> {
    if (this.model?.dirty && !(await backend.confirm("You have unsaved changes. Start a new project and lose them?"))) return;
    let created: string | null = null;
    const made = await askNewProject(backend, async (c) => {
      const theme = BUILT_IN_THEMES.find((t) => t.id === c.themeId);
      await backend.create(c.dir, newProjectFiles({ title: c.title, author: c.author, language: c.language, today: new Date().toISOString().slice(0, 10), ...(theme ? { theme } : {}) }));
      created = c.dir;
    });
    if (!made || !created) return;
    try {
      await this.load(created);
      this.announce("New project created. It has one slide with the title you gave it.");
    } catch (err) {
      window.alert(`The project was created but could not be opened.\n\n${errorText(err)}`);
    }
  }

  private async load(dir: string): Promise<void> {
    let opened = await backend.open(dir);
    let updated = "";
    const version = String(JSON.parse(opened.project)["schemaVersion"]);
    if (version !== FORMAT_VERSION) {
      const newer = version.split(".").map(Number).reduce((r, n, i) => r || n - Number(FORMAT_VERSION.split(".")[i]), 0) > 0;
      if (newer) throw new Error(`This project was made with a newer version of OpenStage (${version}). Update OpenStage to open it.`);
      const go = await backend.confirm(
        `This project was made with an older version of OpenStage (${version}) and has to be updated to ${FORMAT_VERSION} to open. ` +
        "The update gives it a theme and changes nothing you can see. Copies of your old files are kept in a .openstage-backup folder inside the project. Update it now?",
      );
      if (!go) return;
      const report = await backend.migrate(dir);
      opened = await backend.open(dir);
      updated = ` Updated from version ${report.from}. Your old files are in ${report.backup}.`;
    }
    const model = new Model(opened);
    if (model.slides.length === 0) throw new Error("That project has no slide files to edit.");
    this.model = model;
    model.on((c) => this.onChange(c));
    this.welcome.hidden = true;
    this.workspace.hidden = false;
    this.narrationCache = new Map();
    this.renderAll();
    this.scheduleValidate(0);
    void this.refreshNarration();
    this.announce(`Opened ${model.project.meta.title}, ${model.slides.length} slides.${updated}`);
    this.focusSlideList();
  }

  /** Choose a theme for the whole project. */
  private async chooseTheme(): Promise<void> {
    const m = this.model;
    if (!m) return;
    const theme = await askTheme({ current: m.theme.id });
    if (!theme) return;
    const msg = m.setTheme(theme);
    this.announce(msg ? `${msg}. Press Control Z to undo.` : `${theme.name} is already the theme.`);
  }

  async save(): Promise<void> {
    const n = await this.writeChanges();
    if (n === 0) this.announce("Nothing to save");
    else if (n !== null) this.announce(`Saved. ${n} ${n === 1 ? "file" : "files"} written`);
  }

  /** Write what has changed. Returns how many files were written, or null if saving failed (the author has been told). */
  private async writeChanges(): Promise<number | null> {
    const m = this.model;
    if (!m) return 0;
    const files = m.dirtyFiles();
    const removed = m.removedFiles();
    if (files.length === 0 && removed.length === 0) return 0;
    try {
      await backend.save(m.dir, files, removed);
      m.markSaved(files);
      return files.length + removed.length;
    } catch (err) {
      this.announce(`Could not save. ${errorText(err)}`);
      window.alert(`Could not save.\n\n${errorText(err)}`);
      return null;
    }
  }

  private working = false;

  /**
   * Show the course in the author's browser as it is now, saved or not. It is built in a temporary folder, so
   * nothing in the project changes. No problem check and no new narration audio, so it is quick.
   */
  async preview(): Promise<void> {
    const m = this.model;
    if (!m || this.working) return;
    this.working = true;
    this.setEnabled(this.previewBtn, false);
    this.announce("Making the preview. It opens in your browser in a moment.");
    try {
      const result = await backend.preview(m.dir, m.allFiles());
      if (!result.ok || !result.indexHtml) throw new Error(failureText(result));
      await backend.openInBrowser(result.indexHtml);
      const noAudio = narrationLine(result.narration);
      this.announce(`The preview is open in your browser. It shows your project as it is now, saved or not.${noAudio ? ` ${noAudio[0]!.toUpperCase()}${noAudio.slice(1)}` : ""}`);
    } catch (err) {
      this.announce(`Could not make the preview. ${errorText(err)}`);
      window.alert(`Could not make the preview.\n\n${errorText(err)}`);
    } finally {
      this.working = false;
      this.updateChrome();
    }
  }

  /** The Publish dialog: saves the project, checks it, and makes the SCORM package and the web files. */
  async publish(): Promise<void> {
    const m = this.model;
    if (!m || this.working) return;
    this.working = true;
    this.updateChrome();
    try {
      await openPublish({
        backend, dir: m.dir,
        save: async () => (await this.writeChanges()) !== null,
        announce: (msg) => this.announce(msg),
      });
    } finally {
      this.working = false;
      this.updateChrome();
      this.publishBtn.focus();
      void this.refreshNarration(); // a publish makes any audio that was missing
    }
  }

  // ---- narration

  /** The audio the generator has made, by key. Updated from the disk, never guessed. */
  private narrationCache: ReadonlyMap<string, CachedAudio> = new Map();
  private narrationEngineReady = false;
  /** Counts each time the cache is read again, so the Properties panel knows its audio status may have changed. */
  private narrationEpoch = 0;
  private listenUrl = "";

  private async refreshNarration(): Promise<void> {
    const m = this.model;
    if (!m) return;
    try {
      this.narrationCache = new Map((await backend.narrationCache(m.dir)).map((c) => [c.hash, c]));
    } catch {
      // keep what is known: a failure to look is not a reason to say the audio is gone
    }
    this.narrationEngineReady = await backend.narrationEngine().catch(() => false);
    this.narrationEpoch++;
    if (this.model === m) {
      this.renderProps();
      this.timelinePanel.render(); // the lengths of the narration may now be known
    }
  }

  /** How long an object's narration lasts in milliseconds, if its audio has been made. The timeline lines things up with it. */
  private narrationMs(o: OSObject): number | null {
    const n = (o.narration as Narration | null) ?? null;
    if (!n) return null;
    const s = audioStatus(n, this.narrationCache);
    return s.state === "ready" && s.duration !== null ? Math.round(s.duration * 1000) : null;
  }

  /** Show or hide the timeline under the canvas. */
  private toggleTimeline(open = !this.timelinePanel.open): void {
    if (open && !this.model) return;
    this.timelinePanel.setOpen(open);
    this.timelineBtn.setAttribute("aria-pressed", String(open));
    this.announce(open ? "Timeline shown below the canvas." : "Timeline hidden.");
    if (open) this.timelinePanel.element.querySelector<HTMLElement>(".tl-grip, .tl-name")?.focus();
    else this.timelineBtn.focus();
  }

  /** The Narration dialog: all the narration in the course, and making its audio. */
  private async openNarrationDialog(): Promise<void> {
    const m = this.model;
    if (!m || this.working) return;
    this.working = true;
    this.updateChrome();
    await this.refreshNarration();
    let goTo: Awaited<ReturnType<typeof openNarration>>["goTo"] = null;
    try {
      goTo = (await openNarration({
        model: m, backend, engine: this.narrationEngineReady,
        cache: () => this.narrationCache,
        refresh: () => this.refreshNarration(),
        announce: (msg) => this.announce(msg),
      })).goTo;
    } finally {
      this.working = false;
      this.updateChrome();
    }
    if (goTo && m.reveal(goTo.slideId, goTo.object.id)) {
      this.announce(`Selected ${goTo.object.name}${goTo.item ? `, item ${goTo.item.title}` : ""}. Its narration is in the Properties panel.`);
      document.getElementById(goTo.item ? `p-ix-${goTo.item.id}-narration-script` : "p-narration-script")?.focus();
    } else {
      this.narrationBtn.focus();
    }
  }

  /** The Timing list: when everything on this slide appears and disappears. */
  private async openTimingDialog(): Promise<void> {
    const m = this.model;
    if (!m) return;
    await openTiming({ model: m, announce: (msg) => this.announce(msg) });
    this.renderProps(true);
    this.timingBtn.focus();
  }

  /** When the selected object appears and disappears. Left alone, an object is there all the time. */
  private timingFields(m: Model, o: OSObject): HTMLElement[] {
    const onBase = m.layer?.id === m.slide?.baseLayer.id;
    const t = o.timing;
    const done = (r: { ok: boolean; message: string }) => { if (r.message) this.announce(r.message); this.fillValues(o); };
    const afterWhat = t.appear === "narration" ? "its narration starts" : onBase ? "the slide opens" : "its layer is shown";
    return [h("fieldset", {}, h("legend", { text: "Timing" }),
      h("p", { class: "note", text: "Leave this as it is for something that is there all the time. A learner can pause the timing and can show everything at once." }),
      this.selectField("timing-appear", "Appears", [
        { value: "time", label: onBase ? "After the slide opens" : "After its layer is shown" },
        { value: "narration", label: "After its narration starts", disabled: !o.narration },
      ], t.appear, (v) => done(m.setTiming(o.id, { appear: v as typeof t.appear }))),
      this.field("timing-start", `Seconds after ${afterWhat}`, secondsText(t.start), (v) => {
        const ms = parseSeconds(v);
        if (ms === undefined) { this.announce("Write the time in seconds, for example 2 or 0.5, up to 3600."); this.fillValues(o); return; }
        done(m.setTiming(o.id, { start: ms ?? 0 }));
      }, { number: true }),
      this.field("timing-leave", "Stays for, in seconds (blank: until the slide ends)", t.visibleFor === null ? "" : secondsText(t.visibleFor), (v) => {
        const ms = parseSeconds(v);
        if (ms === undefined || ms === 0) { this.announce("Write how long it stays in seconds, for example 6, or leave it blank to stay until the slide ends."); this.fillValues(o); return; }
        done(m.setTiming(o.id, { visibleFor: ms }));
      }, { number: true }),
      h("p", { id: "timing-summary", class: "note", text: describeTiming(t, !onBase) }),
      h("div", { class: "btn-row" }, this.small("Timing list...", "When everything on this slide appears and disappears", () => void this.openTimingDialog())))];
  }

  private previewing = false;

  /** How the selected object arrives and leaves. Left alone, it just appears and goes. */
  private animationFields(m: Model, o: OSObject): HTMLElement[] {
    const a = o.animation;
    const done = (r: { ok: boolean; message: string }) => { if (r.message) this.announce(r.message); this.fillValues(o); };
    const part = (phase: Phase, label: string, secondsLabel: string): HTMLElement[] => [
      this.selectField(`anim-${phase}`, label, effectChoices(phase), a[phase].effect, (v) => done(m.setAnimation(o.id, phase, { effect: v as typeof a.enter.effect }))),
      this.field(`anim-${phase}-time`, secondsLabel, secondsText(a[phase].duration), (v) => {
        const ms = parseSeconds(v);
        if (ms === undefined || ms === null) { this.announce(`Write how long it lasts in seconds, from ${MIN_DURATION / 1000} to ${MAX_DURATION / 1000}, for example 0.5.`); this.fillValues(o); return; }
        done(m.setAnimation(o.id, phase, { duration: ms }));
      }, { number: true }),
    ];
    return [h("fieldset", {}, h("legend", { text: "Animation" }),
      h("p", { class: "note", text: "Motion is a barrier for some learners, so effects are short, never repeat and never flash. A learner whose device asks for less motion sees none, and the course has a button to turn animation off. An arrival plays when the object appears, which includes when the slide opens. A leaving effect plays only when the object disappears at the end of its time, so set Stays for in Timing." }),
      ...part("enter", "Arrives", "Seconds to arrive"),
      ...part("exit", "Leaves", "Seconds to leave"),
      h("p", { id: "animation-summary", class: "note", text: describeAnimation(a) }),
      h("div", { class: "btn-row" }, this.small("Preview animation", "Play how it arrives and leaves, on the canvas, without changing anything", () => void this.previewAnimation(o))))];
  }

  private async previewAnimation(o: OSObject): Promise<void> {
    if (this.previewing) return;
    this.previewing = true;
    try {
      const result = await this.canvas.previewAnimation(o.id, o.animation);
      this.announce(result === "played" ? "Preview finished." : result === "reduced"
        ? "Your device is set to reduce motion, so nothing moves in this preview. Learners with that setting will not see it move either."
        : "This object has no animation to preview. Choose an effect first.");
    } finally {
      this.previewing = false;
    }
  }

  /** Whether the slide being edited moves on by itself. Shown when nothing is selected. */
  private slideTimingFields(m: Model): HTMLElement {
    const slide = m.slide!;
    return h("fieldset", {}, h("legend", { text: "Timing" }),
      this.field("slide-advance", "This slide moves on by itself after, in seconds (blank: it waits for the learner)", slide.duration === null ? "" : secondsText(slide.duration), (v) => {
        const ms = parseSeconds(v);
        if (ms === undefined) { this.announce("Write the time in seconds, for example 8 or 2.5, up to 3600."); this.renderProps(); return; }
        const r = m.setSlideDuration(ms === 0 ? null : ms);
        if (r.message) this.announce(r.message);
      }, { number: true, describedBy: "slide-advance-note" }),
      h("p", { id: "slide-advance-note", class: "note", text: "A slide that moves on by itself takes time away from slow readers, so use it only where it helps and not on a slide with a question. Learners can pause it." }),
      h("div", { class: "btn-row" }, this.small("Timing list...", "When everything on this slide appears and disappears", () => void this.openTimingDialog())));
  }

  /** What the selected object says, in which voice, and how to listen to it. */
  private narrationFields(m: Model, o: OSObject): HTMLElement[] {
    const n = (o.narration as Narration | null) ?? null;
    return [h("fieldset", {}, h("legend", { text: "Narration" }),
      ...this.narrationControls(m, o.id, n, {
        prefix: "narration",
        note: "What the learner hears when this object's slide opens, in reading order. The captions and the transcript come from these words, so they always match. Leave it blank for no narration.",
        audioLabel: "Narration audio for this object",
        rows: 8,
        ...(o.type === "download" ? { extra: [this.small("Use the description as narration", "Write the narration from this file's name, description and how to download it", () => {
          const msg = m.narrateDownloadFromText(o.id);
          if (msg) this.announce(msg);
        })] } : {}),
      }),
      h("div", { class: "btn-row" }, this.small("Narration...", "All the narration in the course, and making its audio", () => void this.openNarrationDialog())))];
  }

  /**
   * The controls for one narration: the words, the voice, the speed, the pronunciations and a way to hear the audio.
   * `key` names what is narrated (an object's id, or "<object id>/<item id>"). `prefix` keeps the ids of the controls
   * apart when several are on the page, as they are when every item of an interaction can be narrated.
   */
  private narrationControls(m: Model, key: string, n: Narration | null, spec: { prefix: string; note: string; audioLabel: string; rows: number; extra?: HTMLElement[] }): HTMLElement[] {
    const { prefix } = spec;
    const parts: HTMLElement[] = [
      h("p", { id: `${prefix}-note`, class: "note", text: spec.note }),
      this.stacked(this.field(`${prefix}-script`, "Narration script", n?.script ?? "", (v) => {
        const msg = m.setNarrationScript(key, v);
        if (msg) this.announce(msg.startsWith("Removed") ? `${msg}. Press Control Z to undo.` : msg);
      }, { area: true, rows: spec.rows, describedBy: `${prefix}-note` })),
      ...(spec.extra ?? []),
    ];
    if (n) {
      const voice = h("select", { id: `p-${prefix}-voice` },
        ...(VOICES.includes(n.voice) ? [] : [h("option", { value: n.voice, text: `${n.voice} (not an available voice)` })]),
        ...voiceGroups().map((g) => h("optgroup", { label: g.group }, ...g.voices.map((v) => h("option", { value: v.id, text: v.label })))));
      voice.value = n.voice;
      voice.dataset["key"] = `prop:${prefix}-voice`;
      voice.addEventListener("change", () => { const msg = m.setNarrationVoice(key, voice.value); if (msg) this.announce(msg); });
      parts.push(h("div", { class: "field" }, h("label", { for: `p-${prefix}-voice`, text: "Voice" }), voice));
      parts.push(this.field(`${prefix}-speed`, "Speed (1 is normal)", n.speed, (v) => {
        const r = m.setNarrationSpeed(key, Number(v));
        if (!r.ok) { this.announce(r.message); const o = m.object; if (o) this.fillValues(o); } else if (r.message) this.announce(r.message);
      }, { number: true }));
      parts.push(this.pronunciationFields(m, key, n, prefix === "narration" ? "pron" : `${prefix}-pron`));
      const state = audioStatus(n, this.narrationCache);
      const holder = h("div", { class: "listen" });
      if (state.state === "ready") holder.append(this.small("Listen to the audio", "Play the audio made for this script", () => void this.listen(n, holder, spec.audioLabel)));
      parts.push(h("p", { class: "note", text: statusLine(state) }), holder);
    }
    return parts;
  }

  /** A field whose box takes the full width, with its label above it. */
  private stacked(f: HTMLElement): HTMLElement {
    f.classList.add("stack");
    return f;
  }

  /** Words the voice gets wrong, taught in IPA. `pron` is the start of the ids of this set of boxes. */
  private pronunciationFields(m: Model, key: string, n: Narration, pron: string): HTMLElement {
    const rows = n.pronunciations.map((p, i) => {
      const term = h("input", { type: "text", id: `p-${pron}-${i}-term`, "aria-label": `Word ${i + 1}`, placeholder: "Word" });
      const ipa = h("input", { type: "text", id: `p-${pron}-${i}-ipa`, "aria-label": `How ${p.term} sounds, in IPA`, placeholder: "Sounds like (IPA)" });
      term.value = p.term;
      ipa.value = p.ipa;
      term.dataset["key"] = `prop:${pron}-${i}-term`;
      ipa.dataset["key"] = `prop:${pron}-${i}-ipa`;
      const save = () => {
        const r = m.updatePronunciation(key, i, term.value, ipa.value);
        if (!r.ok) { this.announce(r.message); term.value = p.term; ipa.value = p.ipa; } else if (r.message) this.announce(r.message);
      };
      term.addEventListener("change", save);
      ipa.addEventListener("change", save);
      const del = this.small("Delete", "Remove this pronunciation", () => { const msg = m.deletePronunciation(key, i); if (msg) this.announce(`${msg}. Press Control Z to undo.`); }, `Delete the pronunciation of ${p.term}`);
      return h("div", { class: "pron-row", role: "group", "aria-label": `Pronunciation of ${p.term}` }, term, ipa, del);
    });
    const newTerm = h("input", { type: "text", id: `p-${pron}-new-term`, "aria-label": "New word, as spelled in the script", placeholder: "Word" });
    const newIpa = h("input", { type: "text", id: `p-${pron}-new-ipa`, "aria-label": "How it sounds, in IPA", placeholder: "Sounds like (IPA)" });
    newTerm.dataset["key"] = `prop:${pron}-new-term`;
    newIpa.dataset["key"] = `prop:${pron}-new-ipa`;
    const add = this.small("Add pronunciation", "Teach the voice how to say this word", () => {
      const r = m.addPronunciation(key, newTerm.value, newIpa.value);
      if (!r.ok) { this.announce(r.message); (newTerm.value.trim() === "" ? newTerm : newIpa).focus(); return; }
      this.announce(r.message);
      document.getElementById(`p-${pron}-new-term`)?.focus(); // the panel was redrawn, with empty boxes
    });
    return h("fieldset", { class: "pron" }, h("legend", { text: "Pronunciations" }),
      h("p", { class: "note", text: "Teach the voice a word it gets wrong. Write the word as it is spelled in the script, then how it sounds in IPA, for example \u02c8l\u026ak\u0259rt for Likert." }),
      ...rows,
      h("div", { class: "pron-row" }, newTerm, newIpa, add));
  }

  /** Load this script's audio into a player the author can use, and start it. */
  private async listen(n: Narration, holder: HTMLElement, label: string): Promise<void> {
    const m = this.model;
    if (!m) return;
    try {
      const bytes = await backend.readNarrationAudio(m.dir, keyOf(n));
      if (this.listenUrl) URL.revokeObjectURL(this.listenUrl);
      this.listenUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      const audio = h("audio", { controls: true, src: this.listenUrl, "aria-label": label });
      holder.replaceChildren(audio);
      audio.focus();
      void audio.play().catch(() => this.announce("The audio is ready. Press play to hear it."));
    } catch (err) {
      this.announce(`Could not play the audio. ${errorText(err)}`);
    }
  }

  private undo(): void {
    if (this.model?.undo()) this.announce("Undone");
  }

  private redo(): void {
    if (this.model?.redo()) this.announce("Redone");
  }

  // ---- slides, layers, objects

  private lastLayout = "content";

  private async addSlide(): Promise<void> {
    const m = this.model;
    if (!m) return;
    const layout = await askLayout({ heading: "Add a slide", confirm: "Add slide", initial: this.lastLayout, theme: m.theme });
    if (!layout) return;
    this.lastLayout = layout;
    const s = m.addSlide(layout);
    this.announce(`Added ${s.name}. It is slide ${m.slides.findIndex((x) => x.id === s.id) + 1} of ${m.slides.length}.`);
    this.refocus(`slide:${s.id}`);
  }

  /** Give the slide being edited a different layout. The text already on it moves into the new places. */
  private async changeLayout(): Promise<void> {
    const m = this.model;
    if (!m) return;
    const layout = await askLayout({
      heading: "Change this slide's layout",
      confirm: "Change layout",
      initial: m.slide?.layout ?? this.lastLayout,
      theme: m.theme,
      note: "The text already on the slide moves into the new layout's places. Nothing is deleted, and you can undo with Ctrl+Z.",
    });
    if (!layout) return;
    const msg = m.applyLayout(layout);
    if (msg) this.announce(`${msg} Press Control Z to undo.`);
    this.refocus(`slide:${m.sel.slideId}`);
  }

  private deleteSlide(): void {
    const m = this.model;
    if (!m) return;
    const msg = m.deleteSlide(m.sel.slideId);
    if (msg) this.announce(msg.startsWith("Deleted") ? `${msg}. Press Control Z to undo.` : msg);
    this.focusSlideList();
  }

  private moveSlide(dir: -1 | 1): void {
    const m = this.model;
    if (!m) return;
    const msg = m.moveSlide(m.sel.slideId, dir);
    if (msg) this.announce(msg);
    this.refocus(`slide:${m.sel.slideId}`);
  }

  private addLayer(): void {
    const l = this.model?.addLayer();
    if (l) this.announce(`Added ${l.name}. You are now editing it. It starts empty.`);
  }

  private deleteLayer(): void {
    const m = this.model;
    if (!m) return;
    const msg = m.deleteLayer(m.sel.layerId);
    if (msg) this.announce(msg.startsWith("Deleted") ? `${msg} and everything on it. Press Control Z to undo.` : msg);
    this.layerSelect.focus();
  }

  private async addObject(): Promise<void> {
    const m = this.model;
    if (!m) return;
    let choice = this.addKind.value;
    if (choice === "image") return this.addImage();
    if (choice.startsWith("group:")) {
      const group = choice.slice(6);
      if (group === "media") {
        const pick = await askChoice({
          heading: "Add an image, video, audio or file", legend: "Kind", confirm: "Add",
          choices: [
            { value: "image", label: "Image", description: "A picture from your computer.", group: "From your computer" },
            { value: "video", label: "Video file", description: "A video from your computer. It needs captions.", group: "From your computer" },
            { value: "audio", label: "Audio file", description: "A sound from your computer. It needs captions or a transcript.", group: "From your computer" },
            { value: "download", label: "File to download", description: "A PDF, Word document or other file learners can save to their own device. You describe what it is, and confirm it is accessible.", group: "From your computer" },
            { value: "youtube", label: "YouTube video", description: "Plays from YouTube. You confirm the captions and add a transcript.", group: "From the web" },
            { value: "vimeo", label: "Vimeo video", description: "Plays from Vimeo. You confirm the captions and add a transcript.", group: "From the web" },
            { value: "library", label: "Browse the assets", description: "The project's own files, and stock images to add to it.", group: "Assets" },
          ],
        });
        this.addKind.focus();
        if (!pick) return;
        if (pick === "image") return this.addImage();
        if (pick === "video" || pick === "audio") return this.addMediaFile(pick);
        if (pick === "download") return this.addDownloadFile();
        if (pick === "library") return this.openAssetsDialog();
        return this.addEmbedVideo(pick as "youtube" | "vimeo");
      }
      if (group === "question") {
        const picked = await askChoice({
          heading: "Add a question, input or survey", legend: "Kind", confirm: "Add",
          choices: [
            ...groupOptions("quiz").map((c) => ({ ...c, group: "Quiz questions", description: c.value === "quiz:tf" ? "A statement the learner marks true or false. Scored." : "One correct answer among several choices. Scored." })),
            ...INPUTS.map((i) => ({ value: `input:${i.id}`, label: i.label, description: i.description, group: i.group === "Inputs" ? "Inputs that save a choice" : "Surveys" })),
          ],
        });
        this.addKind.focus();
        if (!picked) return;
        if (picked.startsWith("input:")) {
          const made = m.addInput(picked.slice(6));
          if (made) this.announce(`Added ${made.name} with its own variables. Write the prompt and the options in the Properties panel.`);
        } else {
          const quiz = m.addQuiz(picked.slice(5) as QuizType);
          if (quiz) this.announce("Added a quiz question with its answers and two feedback layers. One question per slide works best. The first answer starts as the correct one; change it in the Properties panel, and write the question and the feedback.");
        }
        return;
      }
      if (group === "content") {
        const kind = await askChoice({
          heading: "Add a table or scrolling text", legend: "Kind", confirm: "Add",
          choices: [
            { value: "table", label: "Table", description: "Rows and columns of text, with header cells a screen reader can announce." },
            { value: "scrollingText", label: "Scrolling text", description: "A box of text that scrolls when it is long. The keyboard can scroll it." },
          ],
        });
        this.addKind.focus();
        if (!kind) return;
        const o = m.addObject(kind as "table" | "scrollingText");
        if (o) this.announce(`Added ${o.name}. Give it a name in the Alt text field, which a screen reader reads, and write its content in the Properties panel.`);
        return;
      }
      if (group === "course") {
        const kind = await askChoice({
          heading: "Add results or a certificate", legend: "Kind", confirm: "Add",
          choices: [
            { value: "results", label: "Results", description: "Shows the learner's score and whether they passed, and can list each question. It fills itself in from the quiz." },
            { value: "certificate", label: "Certificate", description: "For a learner who passed. They type their own name, then print it or save it as a PDF." },
          ],
        });
        this.addKind.focus();
        if (!kind) return;
        const o = m.addObject(kind as "results" | "certificate");
        if (o) this.announce(`Added ${o.name}. Give it a name in the Alt text field, which a screen reader reads, and set its words in the Properties panel. Put it on a slide after the quiz questions.`);
        return;
      }
      if (group === "interaction") {
        const pickedInteraction = await askChoice({
          heading: "Add an interaction", legend: "Interaction", confirm: "Add interaction",
          choices: INTERACTIONS.map((i) => ({ value: i.id, label: i.label, description: i.description, group: i.group, preview: interactionPreview(i.kind, i.orientation) })),
        });
        this.addKind.focus();
        if (!pickedInteraction) return;
        const made = m.addInteraction(pickedInteraction);
        if (made) this.announce(`Added ${made.name} with three items. Write each item's title and text in the Properties panel, and give the group a name that says what it is about.`);
        return;
      }
      const picked = await askChoice(group === "shape"
        ? { heading: "Add a shape", legend: "Shape", confirm: "Add shape", choices: groupOptions("shape").map((c) => ({ ...c, preview: shapePreview(c.value.slice(6)) })) }
        : { heading: "Add a quiz question", legend: "Kind of question", confirm: "Add question", choices: groupOptions("quiz").map((c) => ({ ...c, description: c.value === "quiz:tf" ? "A statement the learner marks true or false." : "One correct answer among several choices." })) });
      this.addKind.focus();
      if (!picked) return;
      choice = picked;
    }
    if (choice.startsWith("quiz:")) {
      const quiz = m.addQuiz(choice.slice(5) as QuizType);
      if (quiz) this.announce("Added a quiz question with its answers and two feedback layers. One question per slide works best. The first answer starts as the correct one; change it in the Properties panel, and write the question and the feedback.");
      return;
    }
    const o = choice.startsWith("shape:") ? m.addObject("shape", { shape: choice.slice(6) }) : m.addObject(choice as "text" | "button");
    if (o) {
      const n = o.accessibility.tabOrder ?? 0;
      this.announce(`Added ${o.name}${n >= 1 ? `, number ${n} in reading order` : ", decorative"}. Its properties are in the Properties panel.`);
    }
  }

  private async addImage(): Promise<void> {
    const m = this.model;
    if (!m) return;
    try {
      const picked = await backend.pickImage();
      if (!picked) return;
      const src = await backend.importImage(m.dir, picked);
      await this.placeImage(src);
    } catch (err) {
      this.announce(`Could not add the image. ${errorText(err)}`);
      window.alert(`Could not add the image.\n\n${errorText(err)}`);
    }
  }

  /** Put a picture that is already in the project on the slide. `suggestion` is a description a stock service gave, offered but never filled in. */
  private async placeImage(src: string, suggestion?: string): Promise<void> {
    const m = this.model;
    if (!m) return;
    const size = await this.measure(m.dir, src);
    const o = m.addObject("image", { imageSrc: src, size });
    if (o) {
      const tip = suggestion ? ` The service describes it as: "${suggestion}". You can use that as a start.` : "";
      this.announce(`Added image ${src.split("/").pop()}. It needs alt text: describe it in the Alt text field, or mark it decorative.${tip}`);
      document.getElementById("p-alt")?.focus();
    }
  }

  private placeMedia(kind: "video" | "audio", src: string): void {
    const o = this.model?.addMedia(kind, src);
    if (!o) return;
    this.announce(`Added ${kind} ${src.split("/").pop()}. Give it a name in the Alt text field, and ${kind === "video" ? "add a captions file" : "add captions or a transcript"} in the Properties panel.`);
    document.getElementById("p-alt")?.focus();
  }

  private async addMediaFile(kind: "video" | "audio"): Promise<void> {
    const m = this.model;
    if (!m) return;
    try {
      const picked = await backend.pickFile(kind);
      if (!picked) return;
      this.placeMedia(kind, await backend.importAsset(m.dir, picked, kind));
    } catch (err) {
      this.announce(`Could not add the ${kind}. ${errorText(err)}`);
      window.alert(`Could not add the ${kind}.\n\n${errorText(err)}`);
    }
  }

  /** Put a file that is already in the project on the slide as a download. */
  private placeDownload(src: string): void {
    const o = this.model?.addDownload(src);
    if (!o) return;
    this.announce(`Added a file to download, ${src.split("/").pop()}. It needs a name in the Alt text field, a description of what the file is, and your confirmation that it is accessible. All three are in the Properties panel.`);
    document.getElementById("p-dl-description")?.focus();
  }

  private async addDownloadFile(): Promise<void> {
    const m = this.model;
    if (!m) return;
    try {
      const picked = await backend.pickFile("document");
      if (!picked) return;
      this.placeDownload(await backend.importAsset(m.dir, picked, "document"));
    } catch (err) {
      this.announce(`Could not add the file. ${errorText(err)}`);
      window.alert(`Could not add the file.\n\n${errorText(err)}`);
    }
  }

  private async addEmbedVideo(provider: "youtube" | "vimeo"): Promise<void> {
    const m = this.model;
    if (!m) return;
    const name = provider === "youtube" ? "YouTube" : "Vimeo";
    const text = await askText({
      heading: `Add a ${name} video`, label: `${name} address`, confirm: "Add video",
      help: `Paste the address of the video from your browser's address bar. It plays from ${name}, so the learner needs an internet connection.`,
      check: (t) => (parseVideoAddress(t, provider)?.provider === provider ? null : `That is not a ${name} video address. Copy it from the video's page.`),
    });
    this.addKind.focus();
    if (text === null) return;
    const o = m.addEmbed(text, provider);
    if (o) {
      this.announce(`Added a ${name} video. It needs a name in the Alt text field, a transcript, and your confirmation that it has captions. All three are in the Properties panel.`);
      document.getElementById("p-alt")?.focus();
    }
  }

  /** Open the Assets dialog: the project's files, stock search, and the keys for it. */
  private async openAssetsDialog(tab?: "project" | "stock" | "settings"): Promise<void> {
    const m = this.model;
    if (!m) return;
    await openAssets({
      model: m, backend, tab,
      announce: (msg) => this.announce(msg),
      insertImage: (path, suggestion) => this.placeImage(path, suggestion),
      insertMedia: (kind, path) => this.placeMedia(kind, path),
      insertDownload: (path) => this.placeDownload(path),
      useCaptions: (path) => {
        const o = m.object;
        if (!o || (o.type !== "video" && o.type !== "audio")) { this.announce("Select a video or audio clip on the slide first, then choose the captions again."); return; }
        const msg = m.setMediaCaptions(o.id, path);
        if (msg) this.announce(`${msg} for ${o.name}.`);
      },
    });
    this.assetsBtn.focus();
  }

  /** The video or audio clip's captions and transcript. */
  private mediaFields(m: Model, o: OSObject): HTMLElement[] {
    const captions = typeof o.content["captions"] === "string" ? String(o.content["captions"]) : "";
    const choose = this.small("Choose captions file...", "Choose a .vtt captions file from your computer", () => void this.chooseCaptions(o.id));
    const remove = this.small("Remove captions", "Stop using the captions file", () => { const msg = m.setMediaCaptions(o.id, null); if (msg) this.announce(msg); });
    this.setEnabled(remove, captions !== "");
    const transcript = parseBody(String(o.content["transcript"] ?? ""));
    return [h("fieldset", {}, h("legend", { text: o.type === "video" ? "Video" : "Audio" }),
      h("p", { class: "note", text: `File: ${String(o.content["src"] ?? "")}` }),
      h("p", { class: "note", id: "caption-state", text: captions ? `Captions: ${captions}` : "Captions: none" }),
      h("div", { class: "btn-row" }, choose, remove),
      transcript === null
        ? h("p", { class: "note", text: "This transcript has formatting the editor cannot edit yet, so it is left as it is." })
        : this.field("transcript", "Transcript (shown under the player)", transcript, (v) => { const msg = m.setMediaTranscript(o.id, v); if (msg) this.announce(msg); }, { area: true, rows: 5 }),
      h("p", { class: "note", text: o.type === "video"
        ? "A video needs a captions file (.vtt). A transcript is a good addition, but does not replace captions."
        : "An audio clip needs a captions file or a transcript, so someone who cannot hear it can read it." }))];
  }

  private async chooseCaptions(objectId: string): Promise<void> {
    const m = this.model;
    if (!m) return;
    try {
      const picked = await backend.pickFile("captions");
      if (!picked) return;
      const path = await backend.importAsset(m.dir, picked, "captions");
      const msg = m.setMediaCaptions(objectId, path);
      if (msg) this.announce(`${msg}: ${path.split("/").pop()}`);
    } catch (err) {
      this.announce(`Could not add the captions. ${errorText(err)}`);
    }
  }

  /** A file to download: which file, what it is called, what it is, and the author's confirmation that it is accessible. */
  private downloadFields(m: Model, o: OSObject): HTMLElement[] {
    const c = o.content as unknown as DownloadContent;
    const confirm = h("input", { id: "p-dl-confirmed", type: "checkbox", ...(c.accessibleConfirmed ? { checked: true } : {}) });
    confirm.dataset["key"] = "prop:dl-confirmed";
    confirm.addEventListener("change", () => { const msg = m.setDownloadConfirmed(o.id, confirm.checked); if (msg) this.announce(msg); });
    return [h("fieldset", {}, h("legend", { text: "File to download" }),
      h("p", { id: "dl-file", class: "note", text: `File: ${c.src.split("/").pop()}. ${fileDetails(c.src, undefined)}.` }),
      h("div", { class: "btn-row" }, this.small("Use a different file...", "Choose another file from your computer to offer instead", () => void this.changeDownloadFile(o.id))),
      this.field("dl-title", "Name (the link's words)", c.title, (v) => { const msg = m.setDownloadTitle(o.id, v); if (msg) this.announce(msg); }),
      this.stacked(this.field("dl-description", "Description (required: what the file is)", c.description, (v) => { const msg = m.setDownloadDescription(o.id, v); if (msg) this.announce(msg); }, { area: true, rows: 5, describedBy: "dl-note" })),
      h("p", { id: "dl-note", class: "note", text: "Learners read this before they download, so say what is in the file, how long it is and why they might want it. A blank line starts a new paragraph." }),
      h("div", { class: "field check" }, confirm, h("label", { for: "p-dl-confirmed", text: "I have checked that this file is accessible" })),
      h("p", { class: "note", text: "OpenStage cannot see inside a document, so this is your word. A tagged PDF, or a Word file with real headings and descriptions for its pictures, can be read with a screen reader. The file is saved to the learner's device, where they open it with their own programs. Nothing opens in a pop-up." }))];
  }

  private async changeDownloadFile(objectId: string): Promise<void> {
    const m = this.model;
    if (!m) return;
    try {
      const picked = await backend.pickFile("document");
      if (!picked) return;
      const msg = m.setDownloadFile(objectId, await backend.importAsset(m.dir, picked, "document"));
      if (msg) this.announce(msg);
    } catch (err) {
      this.announce(`Could not use that file. ${errorText(err)}`);
    }
  }

  private fillDownload(o: OSObject): void {
    const c = o.content as unknown as DownloadContent;
    const set = (id: string, v: string) => {
      const el = this.propsBody.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#p-${id}`);
      if (el && document.activeElement !== el) el.value = v;
    };
    set("dl-title", c.title);
    set("dl-description", c.description);
    const box = this.propsBody.querySelector<HTMLInputElement>("#p-dl-confirmed");
    if (box) box.checked = c.accessibleConfirmed;
    const file = this.propsBody.querySelector<HTMLElement>("#dl-file");
    if (file) file.textContent = `File: ${c.src.split("/").pop()}. ${fileDetails(c.src, undefined)}.`;
  }

  /** An embedded YouTube or Vimeo video: its address, the transcript, and the author's confirmation that it has captions. */
  private embedFields(m: Model, o: OSObject): HTMLElement[] {
    const c = o.content as unknown as EmbedContent;
    const where = c.provider === "youtube" ? `https://www.youtube.com/watch?v=${c.id}` : `https://vimeo.com/${c.id}${c.hash ? `/${c.hash}` : ""}`;
    const confirm = h("input", { id: "p-embed-captions", type: "checkbox", ...(c.captionsConfirmed ? { checked: true } : {}) });
    confirm.dataset["key"] = "prop:embed-captions";
    confirm.addEventListener("change", () => { const msg = m.setEmbedCaptionsConfirmed(o.id, confirm.checked); if (msg) this.announce(msg); });
    const transcript = parseBody(c.transcript);
    return [h("fieldset", {}, h("legend", { text: c.provider === "youtube" ? "YouTube video" : "Vimeo video" }),
      this.field("embed-address", "Video address", where, (v) => { const msg = m.setEmbedAddress(o.id, v); if (msg) this.announce(msg); this.fillValues(o); }),
      h("div", { class: "field check" }, confirm, h("label", { for: "p-embed-captions", text: "I have checked that this video has accurate captions" })),
      transcript === null
        ? h("p", { class: "note", text: "This transcript has formatting the editor cannot edit yet, so it is left as it is." })
        : this.field("embed-transcript", "Transcript (shown under the video)", transcript, (v) => { const msg = m.setEmbedTranscript(o.id, v); if (msg) this.announce(msg); }, { area: true, rows: 6 }),
      h("p", { class: "note", text: "OpenStage cannot see inside the video, so the captions are your word. In the editor the video is only a placeholder. The learner needs an internet connection, and the LMS must allow embedded players." }))];
  }

  private async measure(dir: string, src: string): Promise<{ w: number; h: number } | undefined> {
    try {
      const img = new Image();
      img.src = await backend.assetUrl(dir, src);
      await img.decode();
      return img.naturalWidth > 0 && img.naturalHeight > 0 ? { w: img.naturalWidth, h: img.naturalHeight } : undefined;
    } catch {
      return undefined; // one the browser cannot size: use a default
    }
  }

  private deleteObject(): void {
    const m = this.model;
    const o = m?.object;
    if (!m || !o) {
      this.announce("Choose an object in the list first.");
      return;
    }
    const before = m.objects.map((x) => x.id);
    const at = before.indexOf(o.id);
    const msg = m.deleteObject(o.id);
    if (!msg) return;
    this.announce(`${msg}. Press Control Z to undo.`);
    const left = m.objects.map((x) => x.id);
    const next = left[Math.min(at, left.length - 1)];
    if (next) this.refocus(`object:${next}`);
    else this.addKind.focus();
  }

  /** Keep the keyboard user's place: if focus was in the Objects list, it goes to the newly selected object. */
  private followSelection(wasInList: boolean): void {
    const id = this.model?.object?.id;
    if (wasInList && id) this.refocus(`object:${id}`);
  }

  private duplicateObject(): void {
    const m = this.model;
    if (!m?.object) {
      this.announce("Choose an object in the list first.");
      return;
    }
    const wasInList = this.objectList.contains(document.activeElement);
    const msg = m.duplicate();
    if (msg) this.announce(`${msg} Press Control Z to undo.`);
    this.followSelection(wasInList);
  }

  private copyObject(): void {
    const m = this.model;
    if (!m?.object) {
      this.announce("Choose an object in the list first.");
      return;
    }
    const msg = m.copy();
    if (msg) this.announce(`${msg} Press Control V to paste it, here or on another slide.`);
  }

  private cutObject(): void {
    const m = this.model;
    const o = m?.object;
    if (!m || !o) {
      this.announce("Choose an object in the list first.");
      return;
    }
    const at = m.objects.findIndex((x) => x.id === o.id);
    const msg = m.cut();
    if (!msg) return;
    this.announce(`${msg} Press Control V to paste it, or Control Z to undo.`);
    // The object is gone, so focus goes to its neighbour, as it does after Delete.
    const left = m.objects.map((x) => x.id);
    const next = left[Math.min(at, left.length - 1)];
    if (next) this.refocus(`object:${next}`);
    else this.addKind.focus();
  }

  private pasteObject(): void {
    const m = this.model;
    if (!m) return;
    const wasInList = this.objectList.contains(document.activeElement);
    const msg = m.paste();
    if (msg) this.announce(m.canPaste && m.object ? `${msg} Press Control Z to undo.` : msg);
    this.followSelection(wasInList);
  }

  private reorder(delta: -1 | 1): void {
    const o = this.model?.object;
    if (!o) {
      this.announce("Choose an object in the list first.");
      return;
    }
    const msg = this.model?.reorder(o.id, delta);
    if (msg) {
      this.announce(msg);
      this.refocus(`object:${o.id}`);
    }
  }

  // ---- reacting to the model

  private onChange(c: Change): void {
    // What is held for Paste is not part of the course: only the Paste button needs to know.
    if (c.kind === "clipboard") {
      this.updateChrome();
      return;
    }
    if (c.kind !== "geometry" && c.kind !== "saved") this.timelinePanel.render();
    if (c.kind === "selection" || c.kind === "structure") {
      this.renderSlides();
      this.renderLayers();
      this.renderObjects();
      this.renderProps();
    } else if (c.kind === "geometry" || c.kind === "content") {
      // Values change in place, so a field the author is in keeps its focus and cursor.
      this.renderObjects();
      this.renderProps(true);
    }
    if (c.kind !== "selection" && c.kind !== "saved") this.scheduleValidate(VALIDATE_DELAY_MS);
    this.canvas.update(c);
    this.updateChrome();
  }

  private renderAll(): void {
    this.timelinePanel.render();
    this.renderSlides();
    this.renderLayers();
    this.renderObjects();
    this.renderProps();
    this.canvas.render();
    this.renderProblems();
    this.updateChrome();
  }

  private updateChrome(): void {
    const m = this.model;
    this.setEnabled(this.saveBtn, !!m?.dirty);
    this.setEnabled(this.undoBtn, !!m?.canUndo);
    this.setEnabled(this.redoBtn, !!m?.canRedo);
    this.setEnabled(this.previewBtn, !!m && !this.working);
    this.setEnabled(this.publishBtn, !!m && !this.working);
    this.statusSave.textContent = !m ? "No project open" : m.dirty ? "Unsaved changes" : "All changes saved";
    const idx = m ? m.slides.findIndex((s) => s.id === m.sel.slideId) : -1;
    this.statusSlide.textContent = m ? `Slide ${idx + 1} of ${m.slides.length}` : "";
    const e = this.findings.filter((f) => f.severity === "error").length;
    const w = this.findings.length - e;
    this.statusProblems.textContent = m ? (this.checkFailure ? "Could not check" : this.summaryText(e, w)) : "";
    void backend.setTitle(m ? `${m.dirty ? "* " : ""}${m.project.meta.title} - OpenStage Author` : "OpenStage Author");
    const hasObject = !!m?.object;
    this.setEnabled(this.moveEarlier, hasObject);
    this.setEnabled(this.moveLater, hasObject);
    this.setEnabled(this.deleteObjectBtn, hasObject);
    this.setEnabled(this.duplicateBtn, hasObject);
    this.setEnabled(this.copyBtn, hasObject);
    this.setEnabled(this.cutBtn, hasObject);
    this.setEnabled(this.pasteBtn, !!m?.canPaste);
    this.setEnabled(this.deleteSlideBtn, !!m && m.slides.length > 1);
    this.setEnabled(this.changeLayoutBtn, !!m);
    this.setEnabled(this.themeBtn, !!m);
    this.setEnabled(this.assetsBtn, !!m);
    this.setEnabled(this.variablesBtn, !!m);
    this.setEnabled(this.narrationBtn, !!m && !this.working);
    this.setEnabled(this.timingBtn, !!m && !this.working);
    this.setEnabled(this.timelineBtn, !!m);
    this.setEnabled(this.slideUpBtn, !!m && idx > 0);
    this.setEnabled(this.slideDownBtn, !!m && idx >= 0 && idx < m.slides.length - 1);
    this.setEnabled(this.deleteLayerBtn, !!m && m.sel.layerId !== m.slide?.baseLayer.id);
  }

  private summaryText(errors: number, warnings: number): string {
    if (errors === 0 && warnings === 0) return "No problems";
    const part = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
    return [errors ? part(errors, "error") : "", warnings ? part(warnings, "warning") : ""].filter(Boolean).join(", ");
  }

  // ---- lists

  /** Redraw part of the window but put focus back on the same control, so keyboard users keep their place. */
  private keepFocus(fn: () => void): void {
    const key = (document.activeElement as HTMLElement | null)?.dataset?.["key"];
    fn();
    if (key) this.refocus(key);
  }

  private refocus(key: string): void {
    const target = Array.from(this.root.querySelectorAll<HTMLElement>("[data-key]")).find((n) => n.dataset["key"] === key);
    target?.focus();
  }

  private item(key: string, label: string, current: boolean, onPick: () => void, extra = ""): HTMLLIElement {
    const b = h("button", { type: "button", class: "item", "data-key": key, text: label, ...(current ? { "aria-current": "true" } : {}) });
    if (extra) b.title = extra;
    b.addEventListener("click", onPick);
    return h("li", {}, b);
  }

  /** Up and Down, Home and End move between the items of a list. */
  private wireArrows(list: HTMLElement, onAltArrow?: (key: string, dir: -1 | 1) => void, onDelete?: (key: string) => void): void {
    list.addEventListener("keydown", (e) => {
      const items = Array.from(list.querySelectorAll<HTMLElement>("button.item"));
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (at === -1) return;
      if (e.key === "Delete" && onDelete) {
        e.preventDefault();
        onDelete(items[at]!.dataset["key"] ?? "");
        return;
      }
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        onAltArrow?.(items[at]!.dataset["key"] ?? "", e.key === "ArrowUp" ? -1 : 1);
        return;
      }
      const to = e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
      if (to >= 0 && to < items.length) {
        e.preventDefault();
        items[to]!.focus();
      }
    });
  }

  private renderSlides(): void {
    const m = this.model;
    if (!m) return;
    this.keepFocus(() => {
      this.slideList.replaceChildren(
        ...m.slides.map((s, i) => this.item(`slide:${s.id}`, `${i + 1}. ${s.name}`, s.id === m.sel.slideId, () => m.selectSlide(s.id))),
      );
    });
  }

  private renderLayers(): void {
    const m = this.model;
    if (!m) return;
    this.layerSelect.replaceChildren(...m.layers.map((l) => h("option", { value: l.id, text: l.name, ...(l.id === m.sel.layerId ? { selected: true } : {}) })));
    this.layerSelect.value = m.sel.layerId;
  }

  private renderObjects(): void {
    const m = this.model;
    if (!m) return;
    this.keepFocus(() => {
      this.objectList.replaceChildren(
        ...m.objects.map((o) => {
          const t = o.accessibility.tabOrder ?? 0;
          const label = `${t >= 1 ? `${t}.` : "-"} ${o.name} (${o.type}${o.accessibility.decorative ? ", decorative" : ""}${t >= 1 ? "" : ", not in tab order"}${isStartingTiming(o.timing) ? "" : ", timed"}${isStartingAnimation(o.animation) ? "" : ", animated"})`;
          return this.item(`object:${o.id}`, label, o.id === m.sel.objectId, () => m.selectObject(o.id));
        }),
      );
      if (m.objects.length === 0) this.objectList.append(h("li", { class: "note", text: "No objects on this layer. Use Add to put one here." }));
    });
  }

  /** Why the last check could not run, if it could not. Shown in the Problems panel. */
  private checkFailure = "";

  private renderProblems(): void {
    const m = this.model;
    if (!m) return;
    const e = this.findings.filter((f) => f.severity === "error").length;
    const summary = this.checkFailure ? "Could not check" : this.summaryText(e, this.findings.length - e);
    this.problemSummary.textContent = summary;
    this.keepFocus(() => {
      this.problemList.replaceChildren(
        ...this.findings.map((f, i) => {
          const where = f.object_id && f.object_id !== "-" ? `${f.object_id}: ` : "";
          const label = `${f.severity === "error" ? "Error" : "Warning"}. ${where}${f.message}`;
          const li = this.item(`problem:${i}`, label, false, () => this.gotoProblem(f), f.detail);
          li.classList.add(f.severity);
          return li;
        }),
      );
      if (this.checkFailure) {
        this.problemList.append(
          h("li", { class: "note error-text", role: "alert", text: `The problem checker could not run. ${this.checkFailure}` }),
          h("li", { class: "note", text: "Your work is not affected. Fix this and the list will fill in." }),
        );
      } else if (this.findings.length === 0) this.problemList.append(h("li", { class: "note", text: "No problems found." }));
    });
    // Tell a screen reader when the count changes, but not on every keystroke.
    if (summary !== this.lastSummary) {
      this.lastSummary = summary;
      this.announce(`Problems: ${summary}`);
    }
  }

  private gotoProblem(f: Finding): void {
    const m = this.model;
    if (!m) return;
    const slideId = f.file.startsWith("slides/") ? f.file.slice("slides/".length).replace(/\.json$/, "") : "";
    if (slideId && m.slides.some((s) => s.id === slideId)) {
      if (!m.reveal(slideId, f.object_id)) m.selectSlide(slideId);
      this.canvas.focus();
      this.announce(m.object ? `Selected ${m.describe(m.object)}. ${f.message}` : `${f.message}`);
    } else {
      this.announce(`${f.message}. ${f.detail}`);
    }
  }

  // ---- validation

  private scheduleValidate(delay: number): void {
    window.clearTimeout(this.validateTimer);
    this.validateTimer = window.setTimeout(() => void this.runValidate(), delay);
  }

  private async runValidate(): Promise<void> {
    const m = this.model;
    if (!m) return;
    const seq = ++this.validateSeq;
    try {
      const findings = await backend.validate(m.dir, m.allFiles());
      if (seq !== this.validateSeq) return; // a newer check is on its way
      this.findings = findings;
      this.checkFailure = "";
    } catch (err) {
      if (seq !== this.validateSeq) return;
      this.findings = [];
      this.checkFailure = errorText(err);
      this.problemSummary.textContent = "Could not check";
      this.renderProblems();
      this.announce(`Could not check for problems. ${this.checkFailure}`);
      return;
    }
    this.renderProblems();
    this.updateChrome();
  }

  // ---- properties

  /** A labelled field. Every field has a stable data-key so focus returns to it after a redraw. */
  private field(id: string, label: string, value: string | number | null, onChange: (v: string) => void, opts: { number?: boolean; area?: boolean; describedBy?: string; rows?: number } = {}): HTMLElement {
    const input = opts.area
      ? h("textarea", { id: `p-${id}`, rows: opts.rows ?? 3 })
      : h("input", { id: `p-${id}`, type: opts.number ? "number" : "text", ...(opts.number ? { step: "any" } : {}) });
    input.value = value === null ? "" : String(value);
    input.dataset["key"] = `prop:${id}`;
    if (opts.describedBy) input.setAttribute("aria-describedby", opts.describedBy);
    input.addEventListener("change", () => onChange(input.value));
    return h("div", { class: "field" }, h("label", { for: `p-${id}`, text: label }), input);
  }

  private selectField(id: string, label: string, options: { value: string; label: string; disabled?: boolean }[], value: string, onChange: (v: string) => void): HTMLElement {
    const sel = h("select", { id: `p-${id}` }, ...options.map((o) => h("option", { value: o.value, text: o.label, ...(o.disabled ? { disabled: true } : {}) })));
    sel.value = value;
    sel.dataset["key"] = `prop:${id}`;
    sel.addEventListener("change", () => onChange(sel.value));
    return h("div", { class: "field" }, h("label", { for: `p-${id}`, text: label }), sel);
  }

  private renderProps(valuesOnly = false): void {
    const m = this.model;
    if (!m) return;
    const o = m.object;
    // The panel is rebuilt only when its shape changes: another object, or a button whose
    // action now needs a different set of controls. Otherwise values change in place.
    const shape = !o ? "" : o.type === "button" ? m.activationOf(o).kind
      : o.type === "text" ? (parseSimpleText(String(o.content["html"] ?? "")) ? "simple" : "raw")
      : o.type === "interaction" ? interactionShape(o)
      : o.type === "video" || o.type === "audio" ? `${String(o.content["captions"] ?? "")}|${parseBody(String(o.content["transcript"] ?? "")) === null}`
      : o.type === "embed" ? `${(o.content as unknown as EmbedContent).provider}|${parseBody((o.content as unknown as EmbedContent).transcript) === null}`
      : o.type === "table" ? tableShape(o)
      : o.type === "input" ? inputShape(o, m)
      : o.type === "scrollingText" ? (parseBody(String(o.content["html"] ?? "")) === null ? "raw" : "simple")
      : o.type === "quizQuestion" ? (o.content["choices"] as { id: string }[]).map((c) => c.id).join(",") + `|${m.slide?.layers.map((l) => l.id).join(",")}`
      : "";
    // Rules can change which controls the panel needs, and the variables and layers they can point at come from the project.
    const rules = o ? `|${JSON.stringify(o.triggers)}|${m.variables.map((v) => `${v.id}${v.name}${v.type}`).join(",")}|${m.slide?.layers.map((l) => l.id).join(",")}` : "";
    // Narration changes which controls the panel needs (pronunciations, the Listen button), and whether its audio exists.
    const narrationSign = (n: unknown): string => (n ? `${keyOf(n as Narration)}:${(n as Narration).pronunciations.length}` : "none");
    const itemNarration = o?.type === "interaction" ? (o.content as unknown as InteractionContent).items.map((i) => narrationSign(i.narration)).join(",") : "";
    const narrated = o ? `|${narrationSign(o.narration)}:${this.narrationEpoch}|${itemNarration}` : "";
    const marker = o ? `object:${o.id}:${shape}${rules}${narrated}|${o.timing.appear}` : `slide:${m.sel.slideId}:${m.sel.layerId}`;
    if (valuesOnly && this.propsBody.dataset["for"] === marker && o) {
      this.fillValues(o);
      return;
    }
    // Keep focus where it is when the panel is redrawn.
    this.keepFocus(() => (o ? this.buildProps(m, o) : this.buildSlideProps(m)));
    this.propsBody.dataset["for"] = marker;
  }

  /** When nothing is selected, the Properties panel is about the slide and layer. */
  private buildSlideProps(m: Model): void {
    const slide = m.slide;
    const layer = m.layer;
    if (!slide || !layer) {
      this.propsBody.replaceChildren();
      return;
    }
    this.propsBody.replaceChildren(
      h("p", { class: "note", text: "No object selected. Choose one in the Objects list, or click it on the canvas." }),
      this.designFields(m, slide.id),
      h("fieldset", {}, h("legend", { text: "Slide" }),
        this.field("slide-name", "Slide name", slide.name, (v) => { const msg = m.renameSlide(slide.id, v); if (msg) this.announce(msg); else (document.getElementById("p-slide-name") as HTMLInputElement).value = slide.name; })),
      h("fieldset", {}, h("legend", { text: "Layer" }),
        this.field("layer-name", "Layer name", layer.name, (v) => { const msg = m.renameLayer(layer.id, v); if (msg) this.announce(msg); else (document.getElementById("p-layer-name") as HTMLInputElement).value = layer.name; })),
      this.slideTimingFields(m),
      this.courseFields(m),
    );
  }

  /** Settings of the whole course, shown when nothing is selected. */
  private courseFields(m: Model): HTMLElement {
    const choice = this.selectField("completion", "Complete when", [
      { value: "all", label: "the learner has seen every slide" },
      { value: "last", label: "the learner reaches the last slide" },
    ], m.completion, (v) => { const msg = m.setCompletion(v === "last" ? "last" : "all"); if (msg) this.announce(msg); });
    choice.querySelector("select")?.setAttribute("aria-describedby", "completion-note");
    return h("fieldset", {}, h("legend", { text: "Course" }),
      choice,
      h("p", { id: "completion-note", class: "note", text: "Every quiz has to be finished as well. Choose \"reaches the last slide\" if a rule can send some learners past some slides, because they would never see every slide and the course would never complete." }));
  }

  /** The slide's layout and background. Both follow the theme. */
  private designFields(m: Model, slideId: string): HTMLElement {
    const slide = m.slides.find((x) => x.id === slideId)!;
    const layout = SLIDE_LAYOUTS.find((l) => l.id === slide.layout);
    const bg = slide.background;
    const kind = bg === null ? "default" : bg.startsWith("theme:bg.") ? bg.slice("theme:bg.".length) : "custom";
    const custom = bg && /^#[0-9a-fA-F]{6}$/.test(bg) ? bg : m.theme.colors.surface;

    const change = this.small("Change layout", "Choose a different layout for this slide", () => void this.changeLayout());
    const reset = this.small("Reset layout", "Put this slide's text back in its layout's places", () => {
      if (!slide.layout) return;
      const msg = m.applyLayout(slide.layout);
      if (msg) this.announce(`${msg} Press Control Z to undo.`);
    });
    this.setEnabled(reset, !!layout);

    const background = this.selectField("slide-bg", "Background", [
      { value: "default", label: "Theme default" },
      { value: "dark", label: "Theme: dark" },
      { value: "accent", label: "Theme: accent" },
      { value: "custom", label: "A colour of your own" },
    ], kind, (v) => {
      const value = v === "default" ? null : v === "custom" ? custom : `theme:bg.${v}`;
      const msg = m.setSlideBackground(slide.id, value);
      if (msg) this.announce(`${msg}. Text that follows the theme was changed to stay readable.`);
    });

    return h("fieldset", {}, h("legend", { text: "Design" }),
      h("p", { class: "note", text: layout ? `Layout: ${layout.label}. ${layout.description}` : "Layout: none. This slide was arranged by hand." }),
      h("div", { class: "btn-row" }, change, reset),
      background,
      ...(kind === "custom" ? [this.field("slide-bg-hex", "Background colour (hex)", custom, (v) => {
        const hx = normalizeHex(v);
        if (!hx) { this.announce("A colour must be a hex code such as #1a1a1a."); (document.getElementById("p-slide-bg-hex") as HTMLInputElement).value = custom; return; }
        const msg = m.setSlideBackground(slide.id, hx);
        if (msg) this.announce(msg);
      })] : []),
      h("p", { class: "note", text: "A slide's layout and background follow the theme, so they change when you change the theme." }));
  }

  /** Update the values of the open panel without rebuilding it. */
  private fillValues(o: OSObject): void {
    const set = (id: string, v: string | number | null) => {
      const input = this.propsBody.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#p-${id}`);
      if (input && document.activeElement !== input) input.value = v === null ? "" : String(v);
    };
    const g = o.geometry;
    const a = o.accessibility;
    set("name", o.name);
    set("x", g.x); set("y", g.y); set("width", g.width); set("height", g.height); set("rotation", g.rotation); set("z", g.z);
    set("alt", a.altText); set("role", a.role); set("tab", a.tabOrder);
    const dec = this.propsBody.querySelector<HTMLInputElement>("#p-decorative");
    if (dec) dec.checked = a.decorative;
    set("label", String(o.content["label"] ?? ""));
    const spoken = (o.narration as Narration | null) ?? null;
    set("narration-script", spoken?.script ?? "");
    for (const phase of ["enter", "exit"] as const) {
      set(`anim-${phase}`, o.animation[phase].effect);
      set(`anim-${phase}-time`, secondsText(o.animation[phase].duration));
    }
    const animationNote = this.propsBody.querySelector<HTMLElement>("#animation-summary");
    if (animationNote) animationNote.textContent = describeAnimation(o.animation);
    set("timing-appear", o.timing.appear);
    set("timing-start", secondsText(o.timing.start));
    set("timing-leave", o.timing.visibleFor === null ? "" : secondsText(o.timing.visibleFor));
    const timingNote = this.propsBody.querySelector<HTMLElement>("#timing-summary");
    if (timingNote) timingNote.textContent = describeTiming(o.timing, !!this.model && this.model.layer?.id !== this.model.slide?.baseLayer.id);
    if (spoken) { set("narration-voice", spoken.voice); set("narration-speed", spoken.speed); }
    set("font", String(o.style["fontFamily"] ?? "system-ui"));
    set("size", o.style["fontSize"] ?? "");
    for (const key of ["color", "fill", "stroke"] as const) this.colorUpdaters.get(key)?.(String(o.style[key] ?? ""));
    set("stroke-width", o.style["strokeWidth"] ?? "");
    set("shape", String(o.content["shape"] ?? "rectangle"));
    this.updateContrast(o);
    if (o.type === "quizQuestion") this.fillQuiz(o);
    if (o.type === "interaction") this.fillInteraction(o);
    if (o.type === "table") this.fillTable(o);
    if (o.type === "results") this.fillResults(o);
    if (o.type === "certificate") this.fillCertificate(o);
    if (o.type === "download") this.fillDownload(o);
    if (o.type === "embed") {
      const c = o.content as unknown as EmbedContent;
      set("embed-address", c.provider === "youtube" ? `https://www.youtube.com/watch?v=${c.id}` : `https://vimeo.com/${c.id}${c.hash ? `/${c.hash}` : ""}`);
      const t = parseBody(c.transcript);
      if (t !== null) set("embed-transcript", t);
      const box = this.propsBody.querySelector<HTMLInputElement>("#p-embed-captions");
      if (box) box.checked = c.captionsConfirmed;
    }
    if (o.type === "video" || o.type === "audio") {
      const t = parseBody(String(o.content["transcript"] ?? ""));
      if (t !== null) set("transcript", t);
    }
    if (o.type === "input") this.fillInput(o);
    if (o.type === "scrollingText") { const body = parseBody(String(o.content["html"] ?? "")); if (body !== null) set("scroll-text", body); }
    const simple = typeof o.content["html"] === "string" ? parseSimpleText(o.content["html"]) : null;
    if (simple) { set("text", simple.text); set("block", simple.block); } else set("html", String(o.content["html"] ?? ""));
  }

  private buildProps(m: Model, o: OSObject): void {
    const a = o.accessibility;
    const num = (key: keyof OSObject["geometry"]) => (v: string) => {
      const msg = v.trim() === "" ? null : m.setGeometry(o.id, { [key]: Number(v) });
      if (msg) this.announce(msg);
      else this.fillValues(o);
    };

    const decorative = h("input", { id: "p-decorative", type: "checkbox", ...(a.decorative ? { checked: true } : {}) });
    decorative.dataset["key"] = "prop:decorative";
    decorative.addEventListener("change", () => {
      m.setAccessibility(o.id, { decorative: decorative.checked });
      this.announce(decorative.checked ? "Marked decorative. Decorative objects must have no alt text." : "No longer decorative. Write alt text for this object.");
    });

    const style = (key: "color" | "fill" | "fontSize", id: string, label: string, number = false) =>
      this.field(id, label, o.style[key] ?? "", (v) => {
        const r = m.setStyle(o.id, key, v);
        if (!r.ok) { this.announce(r.message); this.fillValues(o); } else if (r.message) this.announce(r.message);
      }, { number });

    this.colorUpdaters.clear();
    const content: HTMLElement[] = [];
    if (o.type === "text") content.push(...this.textFields(m, o));
    if (o.type === "button") content.push(this.field("label", "Button label", String(o.content["label"] ?? ""), (v) => {
      const msg = m.setLabel(o.id, v);
      if (msg) this.announce(msg); else this.fillValues(o);
    }));

    const looks: HTMLElement[] = [];
    if (o.type === "text" || o.type === "button") {
      looks.push(this.fontField(m, o), style("fontSize", "size", "Font size", true), this.colorField(m, o, "color", "Text colour", "Default"),
        h("p", { id: "contrast-note", class: "note" }));
    }
    if (o.type === "button") looks.push(this.colorField(m, o, "fill", "Button colour", "Default"));
    if (o.type === "table" || o.type === "scrollingText" || o.type === "input" || o.type === "results" || o.type === "certificate" || o.type === "download") {
      looks.push(this.fontField(m, o), style("fontSize", "size", "Font size", true),
        h("p", { class: "note", text: "A table, a scrolling text box, an input, a results box, a certificate and a file to download use the theme's colours, so they stay readable when you change the theme." }));
    }
    if (o.type === "interaction") {
      looks.push(this.fontField(m, o), style("fontSize", "size", "Font size", true),
        h("p", { class: "note", text: "An interaction uses the theme's colours, so it stays readable when you change the theme." }));
    }
    if (o.type === "shape") {
      looks.push(
        this.selectField("shape", "Shape", SHAPE_KINDS.map((k) => ({ value: k, label: SHAPE_LABELS[k] })), String(o.content["shape"] ?? "rectangle"), (v) => {
          const msg = m.setShape(o.id, v);
          if (msg) this.announce(msg);
        }),
        this.colorField(m, o, "fill", "Fill colour", "No fill"),
        this.colorField(m, o, "stroke", "Outline colour", "No outline"),
        this.field("stroke-width", "Outline width", o.style["strokeWidth"] ?? "", (v) => {
          const r = m.setStyle(o.id, "strokeWidth", v);
          if (!r.ok) { this.announce(r.message); this.fillValues(o); } else if (r.message) this.announce(r.message);
        }, { number: true }),
      );
    }

    this.propsBody.replaceChildren(
      h("p", { class: "identity", text: `${o.type}, id ${o.id}` }),
      this.field("name", "Name", o.name, (v) => { const msg = m.setName(o.id, v); if (msg) this.announce(msg); else this.fillValues(o); }),
      ...(content.length ? [h("fieldset", {}, h("legend", { text: "Content" }), ...content)] : []),
      ...(looks.length ? [h("fieldset", {}, h("legend", { text: "Appearance" }), ...looks)] : []),
      ...this.narrationFields(m, o),
      ...this.timingFields(m, o),
      ...this.animationFields(m, o),
      ...this.ruleFields(m, o),
      ...(o.type === "quizQuestion" ? this.quizFields(m, o) : []),
      ...(o.type === "interaction" ? this.interactionFields(m, o) : []),
      ...(o.type === "video" || o.type === "audio" ? this.mediaFields(m, o) : []),
      ...(o.type === "embed" ? this.embedFields(m, o) : []),
      ...(o.type === "table" ? this.tableFields(m, o) : []),
      ...(o.type === "input" ? this.inputFields(m, o) : []),
      ...(o.type === "scrollingText" ? this.scrollFields(m, o) : []),
      ...(o.type === "results" ? this.resultsFields(m, o) : []),
      ...(o.type === "certificate" ? this.certificateFields(m, o) : []),
      ...(o.type === "download" ? this.downloadFields(m, o) : []),
      h("fieldset", {}, h("legend", { text: "Position and size" }),
        this.field("x", "X", o.geometry.x, num("x"), { number: true }),
        this.field("y", "Y", o.geometry.y, num("y"), { number: true }),
        this.field("width", "Width", o.geometry.width, num("width"), { number: true }),
        this.field("height", "Height", o.geometry.height, num("height"), { number: true }),
        this.field("rotation", "Rotation, degrees", o.geometry.rotation, num("rotation"), { number: true }),
        this.field("z", "Stacking order", o.geometry.z, num("z"), { number: true })),
      h("fieldset", {}, h("legend", { text: "Accessibility" }),
        h("div", { class: "field check" }, decorative, h("label", { for: "p-decorative", text: "Decorative (no meaning, hidden from screen readers)" })),
        this.field("alt", "Alt text", a.altText, (v) => { m.setAccessibility(o.id, { altText: v }); }, { area: true, describedBy: "alt-note" }),
        h("p", { id: "alt-note", class: "note", text: o.type === "video" || o.type === "audio" || o.type === "embed"
          ? `This is the name a screen reader gives the player, for example "Welcome from the instructor". Say what the ${o.type === "audio" ? "clip" : "video"} is.`
          : o.type === "input"
          ? "The prompt is the name a screen reader gives this input. Alt text starts as the same words; add to it only to give extra instructions."
          : o.type === "results"
          ? "This is the name a screen reader gives the box, for example \"Your quiz results\"."
          : o.type === "certificate"
          ? "This is the name a screen reader gives the certificate area, for example \"Certificate of achievement\"."
          : o.type === "download"
          ? "This is the name a screen reader gives the group, for example \"Course handbook, a PDF to download\". Say what the file is and what kind it is."
          : o.type === "table" || o.type === "scrollingText"
          ? `This is the name a screen reader gives the ${o.type === "table" ? "table" : "box"}, for example "Quarterly results". Say what it shows.`
          : o.type === "interaction"
          ? "This is the name a screen reader gives the whole group, for example \"Causes of burnout\". Say what the items are about."
          : o.type === "quizQuestion"
          ? "This is the name a screen reader gives the group of answers. The question itself is the heading before it, so keep that clear."
          : "Required unless the object is decorative. Decorative objects must have no alt text. A screen reader reads a text object's own words, so for text this is kept for tools and checks." }),
        this.field("role", "Role", a.role, (v) => { m.setAccessibility(o.id, { role: v }); }),
        this.field("tab", "Tab order (blank for none)", a.tabOrder, (v) => {
          const n = v.trim() === "" ? null : Number(v);
          if (m.setAccessibility(o.id, { tabOrder: n }) === null) { this.announce("Tab order must be a whole number, 0 or more."); this.fillValues(o); }
        }, { number: true })),
    );
  }

  private colorUpdaters = new Map<string, (v: string) => void>();

  /**
   * A colour chooser that needs no hex code. The theme's own colours come first: choosing one keeps
   * the object following the theme, so it changes when the theme does. Then a palette of named
   * colours, the system colour picker for anything else, a hex box for someone who has a code, and
   * a button for "none". Each group of swatches is one tab stop; the arrow keys move within it.
   */
  private colorField(m: Model, o: OSObject, key: "color" | "fill" | "stroke", label: string, noneLabel: string): HTMLElement {
    const swatch = h("span", { class: "swatch", "aria-hidden": "true" });
    const nameEl = h("span", { class: "color-name" });

    const group = (name: string, items: { name: string; hex: string; value: string; id: string }[]) => {
      const el = h("div", { class: "palette", role: "group", "aria-label": name });
      const btns = items.map((c) => {
        const b = h("button", { type: "button", class: "swatch-btn", "aria-label": c.name, title: `${c.name} ${c.hex}`, "aria-pressed": "false" });
        b.dataset["key"] = `prop:${key}-${c.id}`;
        b.dataset["value"] = c.value;
        b.style.backgroundColor = c.hex;
        b.addEventListener("click", () => apply(c.value));
        return b;
      });
      el.append(...btns);
      el.addEventListener("keydown", (e) => {
        const at = btns.indexOf(document.activeElement as HTMLButtonElement);
        if (at === -1) return;
        const to = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "ArrowDown" ? at + 6 : e.key === "ArrowUp" ? at - 6 : e.key === "Home" ? 0 : e.key === "End" ? btns.length - 1 : -1;
        if (to < 0 || to >= btns.length) return;
        e.preventDefault();
        btns.forEach((x, i) => (x.tabIndex = i === to ? 0 : -1));
        btns[to]!.focus();
      });
      return { el, btns };
    };
    const themed = group(`${label}: theme colours`, COLOR_ROLES.map((r) => ({ name: `Theme colour: ${COLOR_ROLE_NAMES[r] ?? r}`, hex: m.theme.colors[r], value: colorRef(r), id: `theme-${r}` })));
    const fixed = group(`${label}: other colours`, PALETTE.map((c) => ({ name: c.name, hex: c.hex, value: c.hex, id: c.hex })));

    const picker = h("input", { id: `p-${key}-picker`, type: "color" });
    picker.dataset["key"] = `prop:${key}-picker`;
    picker.addEventListener("change", () => apply(picker.value));
    const hex = h("input", { id: `p-${key}`, type: "text", size: 9 });
    hex.dataset["key"] = `prop:${key}`;
    hex.addEventListener("change", () => {
      const raw = hex.value.trim();
      const n = normalizeHex(raw);
      if (raw === "") apply(key === "stroke" ? "none" : "");
      else if (n) apply(n);
      else { this.announce("A colour must be a hex code such as #1a1a1a. You can also pick one from the palettes."); update(String(m.object?.style[key] ?? "")); }
    });
    const none = h("button", { type: "button", class: "small", text: noneLabel });
    none.dataset["key"] = `prop:${key}-none`;
    none.addEventListener("click", () => apply(key === "stroke" ? "none" : ""));

    const describe = (v: string): string => {
      if (v === "" || v === "none") return noneLabel;
      const hx = normalizeHex(String(resolveValue(m.theme, v)));
      return isThemeRef(v) && hx ? themeColorLabel(v, hx, COLOR_ROLE_NAMES) : colorName(v);
    };

    const update = (v: string) => {
      const resolved = isThemeRef(v) ? String(resolveValue(m.theme, v)) : v;
      const hx = normalizeHex(resolved);
      swatch.style.backgroundColor = hx ?? "transparent";
      swatch.classList.toggle("none", !hx);
      nameEl.textContent = describe(v);
      themed.btns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset["value"] === v)));
      fixed.btns.forEach((b) => b.setAttribute("aria-pressed", String(!isThemeRef(v) && b.dataset["value"] === hx)));
      // One tab stop in each group: the chosen colour, or the first.
      for (const g of [themed.btns, fixed.btns]) {
        if (g.some((b) => b === document.activeElement)) continue;
        const current = g.findIndex((b) => b.getAttribute("aria-pressed") === "true");
        g.forEach((b, i) => (b.tabIndex = i === Math.max(0, current) ? 0 : -1));
      }
      picker.value = hx ?? "#000000";
      if (document.activeElement !== hex) hex.value = v === "none" ? "" : hx ?? v;
    };
    const apply = (v: string) => {
      const r = m.setStyle(o.id, key, v);
      if (!r.ok) { this.announce(r.message); update(String(m.object?.style[key] ?? "")); return; }
      this.announce(`${label}: ${describe(v)}`);
    };
    this.colorUpdaters.set(key, update);
    update(String(o.style[key] ?? ""));

    return h("fieldset", { class: "colorfield" }, h("legend", { text: label }),
      h("div", { class: "color-current" }, swatch, nameEl),
      themed.el,
      h("p", { class: "note", text: "Theme colours change when you change the theme. The other colours stay as they are." }),
      fixed.el,
      h("div", { class: "color-row" },
        h("label", { for: `p-${key}-picker`, text: "Custom" }), picker,
        h("label", { for: `p-${key}`, text: "Hex code" }), hex, none));
  }

  /** A sentence about how readable the text colour is on what is behind it, using the theme's real colours. */
  private updateContrast(o: OSObject): void {
    const note = this.propsBody.querySelector<HTMLElement>("#contrast-note");
    const m = this.model;
    if (!note || !m) return;
    const theme = m.theme;
    const own = o.style["color"];
    const text = own === undefined ? (o.type === "button" ? theme.colors.onAccentStrong : theme.colors.text) : normalizeHex(String(resolveValue(theme, String(own))));
    if (!text) { note.textContent = ""; return; }
    const fillValue = o.style["fill"];
    let behind: string[];
    let name: string;
    if (fillValue !== undefined) {
      const hx = normalizeHex(String(resolveValue(theme, String(fillValue))));
      behind = hx ? [hx] : [];
      name = `the ${describeColor(m, String(fillValue))} fill`;
    } else if (o.type === "button") {
      behind = [theme.colors.accentStrong];
      name = "the theme's button colour";
    } else {
      behind = backgroundColors(theme, m.slide?.background ?? null);
      name = m.slide?.background ? "this slide's background" : "the theme's background";
    }
    if (behind.length === 0) { note.textContent = ""; return; }
    // For a gradient, judge against the colour that is hardest to read on.
    const worst = behind.reduce((a, b) => (contrastRatio(text, b) < contrastRatio(text, a) ? b : a));
    const size = typeof o.style["fontSize"] === "number" ? o.style["fontSize"] : 22;
    note.textContent = contrastNote(text, worst, name, size);
  }

  /** The answers, scoring and feedback of a quiz question. */
  private quizFields(m: Model, o: OSObject): HTMLElement[] {
    const q = o.content as unknown as QuizContent;
    const slide = m.slide!;
    const rows = q.choices.map((c, i) => {
      const radio = h("input", { type: "radio", name: `correct-${o.id}`, id: `p-correct-${c.id}`, "aria-label": `Answer ${i + 1} is the correct answer`, ...(c.correct ? { checked: true } : {}) });
      radio.dataset["key"] = `prop:correct-${c.id}`;
      radio.addEventListener("change", () => { const msg = m.setCorrectChoice(o.id, c.id); if (msg) this.announce(msg); });
      const input = h("input", { type: "text", id: `p-choice-${c.id}`, "aria-label": `Answer ${i + 1}`, value: c.label });
      input.dataset["key"] = `prop:choice-${c.id}`;
      input.addEventListener("change", () => { const msg = m.setChoiceLabel(o.id, c.id, input.value); if (msg) this.announce(msg); else input.value = c.label; });
      const del = this.small("Delete", "Delete this answer", () => {
        const msg = m.deleteChoice(o.id, c.id);
        if (msg) this.announce(msg);
      }, `Delete answer ${i + 1}`);
      this.setEnabled(del, q.choices.length > 2);
      return h("div", { class: "choice-row" }, radio, input, del);
    });
    const add = this.small("Add answer", "Add another answer", () => {
      const msg = m.addChoice(o.id);
      if (msg) this.announce(msg);
    });
    this.setEnabled(add, q.choices.length < 8);

    const layers = slide.layers.map((l) => ({ value: l.id, label: l.name }));
    const feedback = layers.length === 0
      ? [h("p", { class: "note", text: "This slide has no layers. Add layers for the feedback, then choose them here." })]
      : [
          this.selectField("fb-correct", "After a right answer", layers, q.feedback.correct, (v) => { const msg = m.setFeedbackLayer(o.id, "correct", v); if (msg) this.announce(msg); }),
          this.selectField("fb-incorrect", "After a wrong answer", layers, q.feedback.incorrect, (v) => { const msg = m.setFeedbackLayer(o.id, "incorrect", v); if (msg) this.announce(msg); }),
        ];

    return [
      h("fieldset", {}, h("legend", { text: "Answers" }),
        h("p", { class: "note", text: "Select the radio button beside the correct answer. Exactly one answer is correct." }),
        ...rows, add),
      h("fieldset", {}, h("legend", { text: "Scoring" }),
        this.field("points", "Points", q.scoring.points, (v) => { const msg = m.setScoring(o.id, { points: Number(v) }); if (msg) this.announce(msg); else this.fillQuiz(o); }, { number: true }),
        this.field("attempts", "Attempts allowed", q.scoring.attemptsAllowed, (v) => { const msg = m.setScoring(o.id, { attemptsAllowed: Number(v) }); if (msg) this.announce(msg); else { this.announce("Attempts must be a whole number from 1 to 10."); this.fillQuiz(o); } }, { number: true })),
      h("fieldset", {}, h("legend", { text: "Feedback layers" }), ...feedback),
    ];
  }

  /** How an interaction behaves, and its items. */
  private interactionFields(m: Model, o: OSObject): HTMLElement[] {
    const c = o.content as unknown as InteractionContent;
    const kinds: { value: InteractionContent["kind"]; label: string }[] = [
      { value: "clickReveal", label: "Click and reveal" }, { value: "accordion", label: "Accordion" }, { value: "flipCards", label: "Flip cards" },
      { value: "tabs", label: "Tabs" }, { value: "steps", label: "Step process" }, { value: "carousel", label: "Content carousel" },
      { value: "glossary", label: "Glossary" }, { value: "timeline", label: "Timeline" }, { value: "processCircle", label: "Process circle" },
      { value: "pyramidStack", label: "Pyramid stack" }, { value: "pyramidMatrix", label: "Pyramid matrix" }, { value: "circleMatrix", label: "Circle matrix" },
    ];
    const behaviour: HTMLElement[] = [
      this.selectField("ix-kind", "Kind", kinds, c.kind, (v) => { const msg = m.setInteractionKind(o.id, v as InteractionContent["kind"]); if (msg) this.announce(msg); this.fillInteraction(o); }),
    ];
    if (c.kind === "clickReveal" || c.kind === "flipCards" || c.kind === "tabs") {
      behaviour.push(this.selectField("ix-orientation", "Arranged", [{ value: "horizontal", label: "Side by side" }, { value: "vertical", label: "One under another" }], c.orientation, (v) => {
        const msg = m.setInteractionOrientation(o.id, v as "horizontal" | "vertical");
        if (msg) this.announce(msg);
      }));
    }
    if (c.kind === "clickReveal" || c.kind === "accordion") {
      const box = h("input", { id: "p-ix-multiple", type: "checkbox", ...(c.allowMultiple ? { checked: true } : {}) });
      box.dataset["key"] = "prop:ix-multiple";
      box.addEventListener("change", () => { const msg = m.setInteractionMultiple(o.id, box.checked); if (msg) this.announce(msg); });
      behaviour.push(h("div", { class: "field check" }, box, h("label", { for: "p-ix-multiple", text: "Several items can be open at once" })));
    }

    const items = c.items.map((item, i) => {
      const body = parseBody(item.body);
      const parts: HTMLElement[] = [
        this.field(`ix-${item.id}-title`, "Title", item.title, (v) => { const msg = m.setItemTitle(o.id, item.id, v); if (msg) this.announce(msg); else this.fillInteraction(o); }),
        body === null
          ? h("p", { class: "note", text: "This item's text has formatting the editor cannot edit yet, so it is left as it is." })
          : this.field(`ix-${item.id}-body`, "Text (a blank line starts a new paragraph)", body, (v) => { const msg = m.setItemBody(o.id, item.id, v); if (msg) this.announce(msg); }, { area: true, rows: 4 }),
      ];
      if (item.image) {
        const dec = h("input", { id: `p-ix-${item.id}-dec`, type: "checkbox", ...(item.image.decorative ? { checked: true } : {}) });
        dec.dataset["key"] = `prop:ix-${item.id}-dec`;
        dec.addEventListener("change", () => { const msg = m.setItemImageAlt(o.id, item.id, { decorative: dec.checked }); if (msg) this.announce(msg); });
        parts.push(
          h("p", { class: "note", text: `Picture: ${item.image.src.split("/").pop()}` }),
          this.field(`ix-${item.id}-alt`, "Picture alt text", item.image.alt, (v) => { const msg = m.setItemImageAlt(o.id, item.id, { alt: v }); if (msg) this.announce(msg); }),
          h("div", { class: "field check" }, dec, h("label", { for: `p-ix-${item.id}-dec`, text: "Picture is decorative" })),
          this.small("Remove picture", "Remove this item's picture", () => { const msg = m.setItemImage(o.id, item.id, null); if (msg) this.announce(msg); }, `Remove picture from item ${i + 1}`),
        );
      } else {
        parts.push(this.small("Add picture...", "Add a picture to this item", () => void this.addItemImage(o.id, item.id), `Add a picture to item ${i + 1}`));
      }
      parts.push(h("fieldset", {}, h("legend", { text: `Narration for item ${i + 1}` }),
        ...this.narrationControls(m, `${o.id}/${item.id}`, (item.narration as Narration | null) ?? null, {
          prefix: `ix-${item.id}-narration`,
          note: "What the learner hears when they open this item. Whatever the item shows as text should have audio too. The words are yours to change, and they do not follow the item's text if you change that later.",
          audioLabel: `Narration audio for item ${i + 1}`,
          rows: 4,
          extra: [this.small("Use the item's text", "Write the narration from this item's title and text", () => {
            const msg = m.narrateItemFromText(o.id, item.id);
            this.announce(msg ?? "The narration already says what the item shows.");
          }, `Use the text of item ${i + 1} as its narration`)],
        })));
      const earlier = this.small("Move earlier", "Move this item earlier", () => { const msg = m.moveItem(o.id, item.id, -1); if (msg) this.announce(msg); }, `Move item ${i + 1} earlier`);
      const later = this.small("Move later", "Move this item later", () => { const msg = m.moveItem(o.id, item.id, 1); if (msg) this.announce(msg); }, `Move item ${i + 1} later`);
      const del = this.small("Delete item", "Delete this item", () => { const msg = m.deleteItem(o.id, item.id); if (msg) this.announce(msg); }, `Delete item ${i + 1}`);
      this.setEnabled(earlier, i > 0);
      this.setEnabled(later, i < c.items.length - 1);
      this.setEnabled(del, c.items.length > ITEM_LIMITS[c.kind].min);
      parts.push(h("div", { class: "btn-row" }, earlier, later, del));
      return h("fieldset", {}, h("legend", { text: `Item ${i + 1} of ${c.items.length}` }), ...parts);
    });
    const add = this.small("Add item", "Add another item", () => { const msg = m.addItem(o.id); if (msg) this.announce(msg); });
    this.setEnabled(add, c.items.length < ITEM_LIMITS[c.kind].max);

    const narrateAll = this.small("Narrate every item from its text", "Give each item that has no narration narration read from its own title and text", () => {
      const r = m.narrateItemsFromText(o.id);
      if (r.message) this.announce(r.message);
    });
    return [
      h("fieldset", {}, h("legend", { text: "Behaviour" }), ...behaviour),
      h("fieldset", {}, h("legend", { text: "Items" }),
        h("p", { class: "note", text: "Each item can say its own words when the learner opens it, and a Listen button in the item plays them again. Text that has no audio is a barrier for some learners, so give every item narration." }),
        h("div", { class: "btn-row" }, add, narrateAll),
        ...items.map((x) => x)),
    ];
  }

  /** A choice of variable of the right type, with the chosen one's name to edit and a way to make a new one. */
  private variableField(m: Model, o: OSObject, key: string, label: string, partId: string | null, current: string | undefined): HTMLElement[] {
    const c = o.content as unknown as InputContent;
    const type: Variable["type"] = INPUT_VARIABLE_TYPE[c.kind];
    const usable = m.variables.filter((v) => v.type === type);
    const NEW = "__new";
    const select = this.selectField(`${key}-var`, `${label}: saves to`, [
      ...(current && !usable.some((v) => v.id === current) ? [{ value: current, label: `${current} (not defined)`, disabled: true }] : []),
      ...usable.map((v) => ({ value: v.id, label: v.name })),
      { value: NEW, label: "A new variable" },
    ], current ?? NEW, (v) => {
      const msg = v === NEW ? m.newInputVariable(o.id, partId) : m.setInputVariable(o.id, partId, v);
      if (msg) this.announce(msg);
      this.fillInput(o);
    });
    const name = this.field(`${key}-varname`, `${label}: variable name`, m.variables.find((v) => v.id === current)?.name ?? "", (v) => {
      if (!current) return;
      const msg = m.renameVariable(current, v);
      if (msg) this.announce(msg); else this.fillInput(o);
    });
    return [select, name];
  }

  /** The prompt, whether answers go to the LMS, and the options, boxes or rows that make up the input. */
  private inputFields(m: Model, o: OSObject): HTMLElement[] {
    const c = o.content as unknown as InputContent;
    const kindName = INPUTS.find((i) => i.id === c.kind)?.label ?? c.kind;
    const report = h("input", { id: "p-in-report", type: "checkbox", ...(c.report ? { checked: true } : {}) });
    report.dataset["key"] = "prop:in-report";
    report.addEventListener("change", () => { const msg = m.setInputReport(o.id, report.checked); if (msg) this.announce(msg); });
    const top = h("fieldset", {}, h("legend", { text: kindName }),
      this.field("in-prompt", "Prompt (the question the learner sees)", c.prompt, (v) => { const msg = m.setInputPrompt(o.id, v); if (msg) this.announce(msg); else this.fillInput(o); }),
      h("div", { class: "field check" }, report, h("label", { for: "p-in-report", text: "Send the answers to the LMS" })),
      h("p", { class: "note", text: "When this is on, each answer is recorded in the LMS as a survey or choice response, so you can read it in the LMS's reports." }));

    const out: HTMLElement[] = [top];
    const parts = c.kind === "checkbox" ? c.items! : c.kind === "likert" || c.kind === "semantic" ? c.rows! : c.options!;
    const noun = c.kind === "checkbox" ? "Checkbox" : c.kind === "likert" ? "Statement" : c.kind === "semantic" ? "Pair of words" : "Option";
    const min = c.kind === "checkbox" || c.kind === "likert" || c.kind === "semantic" ? 1 : 2;

    if (c.kind === "radio" || c.kind === "dropdown" || c.kind === "list") {
      out.push(h("fieldset", {}, h("legend", { text: "Saved answer" }), ...this.variableField(m, o, "in-main", "Choice", null, c.variable),
        h("p", { class: "note", text: "The variable holds the saved value of the option the learner chose, and is empty until they choose." })));
    }
    if (c.kind === "likert") {
      out.push(h("fieldset", {}, h("legend", { text: "Scale" }),
        this.field("in-scale", "Scale labels, one per line, lowest first", (c.scale ?? []).join("\n"), (v) => { const msg = m.setLikertScale(o.id, v.split(/\r?\n/)); if (msg) this.announce(msg); this.fillInput(o); }, { area: true, rows: 5 }),
        h("p", { class: "note", text: "Each statement saves the number of the label chosen, 1 for the first line. It is 0 until the learner answers." })));
    }
    if (c.kind === "semantic") {
      out.push(h("fieldset", {}, h("legend", { text: "Scale" }),
        this.selectField("in-points", "Points between the words", [3, 4, 5, 6, 7, 8, 9].map((n) => ({ value: String(n), label: String(n) })), String(c.points ?? 7), (v) => { const msg = m.setSemanticPoints(o.id, Number(v)); if (msg) this.announce(msg); }),
        h("p", { class: "note", text: "Each pair saves a number from 1 (the left word) up. It is 0 until the learner answers." })));
    }

    const rows = parts.map((p, i) => {
      const fields: HTMLElement[] = [
        this.field(`in-${p.id}-label`, c.kind === "semantic" ? "Left word" : c.kind === "likert" ? "Statement" : "Label", p.label, (v) => { const msg = m.setInputPartText(o.id, p.id, "label", v); if (msg) this.announce(msg); this.fillInput(o); }),
      ];
      if (c.kind === "semantic") fields.push(this.field(`in-${p.id}-right`, "Right word", (p as { right?: string }).right ?? "", (v) => { const msg = m.setInputPartText(o.id, p.id, "right", v); if (msg) this.announce(msg); this.fillInput(o); }));
      if (c.kind === "radio" || c.kind === "dropdown" || c.kind === "list") fields.push(this.field(`in-${p.id}-value`, "Value saved when chosen", (p as { value?: string }).value ?? "", (v) => { const msg = m.setInputPartText(o.id, p.id, "value", v); if (msg) this.announce(msg); this.fillInput(o); }));
      if (c.kind === "checkbox" || c.kind === "likert" || c.kind === "semantic") fields.push(...this.variableField(m, o, `in-${p.id}`, noun, p.id, (p as { variable?: string }).variable));
      const earlier = this.small("Move earlier", `Move this ${noun.toLowerCase()} earlier`, () => { const msg = m.moveInputPart(o.id, p.id, -1); if (msg) this.announce(msg); }, `Move ${noun.toLowerCase()} ${i + 1} earlier`);
      const later = this.small("Move later", `Move this ${noun.toLowerCase()} later`, () => { const msg = m.moveInputPart(o.id, p.id, 1); if (msg) this.announce(msg); }, `Move ${noun.toLowerCase()} ${i + 1} later`);
      const del = this.small("Delete", `Delete this ${noun.toLowerCase()}`, () => { const msg = m.deleteInputPart(o.id, p.id); if (msg) this.announce(msg); }, `Delete ${noun.toLowerCase()} ${i + 1}`);
      this.setEnabled(earlier, i > 0);
      this.setEnabled(later, i < parts.length - 1);
      this.setEnabled(del, parts.length > min);
      return h("fieldset", {}, h("legend", { text: `${noun} ${i + 1} of ${parts.length}` }), ...fields, h("div", { class: "btn-row" }, earlier, later, del));
    });
    const add = this.small(`Add ${noun.toLowerCase()}`, `Add another ${noun.toLowerCase()}`, () => { const msg = m.addInputPart(o.id); if (msg) this.announce(msg); });
    out.push(h("fieldset", {}, h("legend", { text: c.kind === "likert" ? "Statements" : c.kind === "semantic" ? "Pairs of words" : c.kind === "checkbox" ? "Checkboxes" : "Options" }), add, ...rows));
    return out;
  }

  private fillInput(o: OSObject): void {
    const c = o.content as unknown as InputContent;
    const set = (id: string, v: string) => {
      const el = this.propsBody.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#p-${id}`);
      if (el && document.activeElement !== el) el.value = v;
    };
    const m = this.model;
    const varName = (id: string | undefined) => (m && id ? m.variableName(id) : "");
    set("in-prompt", c.prompt);
    set("in-scale", (c.scale ?? []).join("\n"));
    set("in-points", String(c.points ?? 7));
    if (c.variable) { set("in-main-var", c.variable); set("in-main-varname", varName(c.variable)); }
    const parts = c.kind === "checkbox" ? c.items! : c.kind === "likert" || c.kind === "semantic" ? c.rows! : c.options!;
    for (const p of parts) {
      set(`in-${p.id}-label`, p.label);
      set(`in-${p.id}-right`, (p as { right?: string }).right ?? "");
      set(`in-${p.id}-value`, (p as { value?: string }).value ?? "");
      const v = (p as { variable?: string }).variable;
      if (v) { set(`in-${p.id}-var`, v); set(`in-${p.id}-varname`, varName(v)); }
    }
  }

  /** A table's caption, header options and a grid of its cells. */
  private tableFields(m: Model, o: OSObject): HTMLElement[] {
    const t = o.content as unknown as TableContent;
    const check = (id: string, label: string, on: boolean, patch: (v: boolean) => { headerRow?: boolean; headerColumn?: boolean }) => {
      const box = h("input", { id: `p-${id}`, type: "checkbox", ...(on ? { checked: true } : {}) });
      box.dataset["key"] = `prop:${id}`;
      box.addEventListener("change", () => {
        const msg = m.setTableHeaders(o.id, patch(box.checked));
        if (msg) { this.announce(msg); box.checked = !box.checked; }
      });
      return h("div", { class: "field check" }, box, h("label", { for: `p-${id}`, text: label }));
    };
    const cols = t.rows[0]!.length;
    const rows = t.rows.map((row, r) => {
      const cells = row.map((text, c) => {
        const input = h("input", { type: "text", id: `p-cell-${r}-${c}`, "aria-label": `Row ${r + 1}, column ${c + 1}${(t.headerRow && r === 0) || (t.headerColumn && c === 0) ? ", header" : ""}`, value: text });
        input.dataset["key"] = `prop:cell-${r}-${c}`;
        input.addEventListener("change", () => { const msg = m.setTableCell(o.id, r, c, input.value); if (!msg) input.value = text; });
        return input;
      });
      const add = this.small("Insert row below", "Insert a row below this one", () => { const msg = m.addTableRow(o.id, r); if (msg) this.announce(msg); }, `Insert a row below row ${r + 1}`);
      const del = this.small("Delete row", "Delete this row", () => { const msg = m.deleteTableRow(o.id, r); if (msg) this.announce(msg); }, `Delete row ${r + 1}`);
      this.setEnabled(add, t.rows.length < 30);
      this.setEnabled(del, t.rows.length > 1);
      return h("div", { class: "table-row", role: "group", "aria-label": `Row ${r + 1}` }, ...cells, add, del);
    });
    const colButtons = Array.from({ length: cols }, (_, c) => {
      const add = this.small(`Insert column after ${c + 1}`, "Insert a column after this one", () => { const msg = m.addTableColumn(o.id, c); if (msg) this.announce(msg); }, `Insert a column after column ${c + 1}`);
      const del = this.small(`Delete column ${c + 1}`, "Delete this column", () => { const msg = m.deleteTableColumn(o.id, c); if (msg) this.announce(msg); });
      this.setEnabled(add, cols < 12);
      this.setEnabled(del, cols > 1);
      return h("div", { class: "btn-row" }, add, del);
    });
    return [
      h("fieldset", {}, h("legend", { text: "Table" }),
        this.field("caption", "Caption (optional, shown above the table)", t.caption, (v) => { const msg = m.setTableCaption(o.id, v); if (msg) this.announce(msg); }),
        check("hdr-row", "The first row is a header", t.headerRow, (v) => ({ headerRow: v })),
        check("hdr-col", "The first column is a header", t.headerColumn, (v) => ({ headerColumn: v })),
        h("p", { class: "note", text: "A table needs a header row or a header column, so a screen reader can say which column or row each cell belongs to." })),
      h("fieldset", {}, h("legend", { text: "Cells" }), ...rows),
      h("fieldset", {}, h("legend", { text: "Columns" }), ...colButtons,
        this.small("Add column", "Add a column at the end", () => { const msg = m.addTableColumn(o.id); if (msg) this.announce(msg); }),
        this.small("Add row", "Add a row at the end", () => { const msg = m.addTableRow(o.id); if (msg) this.announce(msg); })),
    ];
  }

  /** What the learner sees when the quiz is done. Its words come from the quiz, and these are the author's own. */
  private resultsFields(m: Model, o: OSObject): HTMLElement[] {
    const c = o.content as unknown as ResultsContent;
    const done = (msg: string | null) => { if (msg) this.announce(msg); this.fillResults(o); };
    const review = h("input", { id: "p-res-review", type: "checkbox", ...(c.review ? { checked: true } : {}) });
    review.dataset["key"] = "prop:res-review";
    review.addEventListener("change", () => done(m.setResults(o.id, { review: review.checked })));
    return [h("fieldset", {}, h("legend", { text: "Results" }),
      h("p", { class: "note", text: "The learner sees their score and whether they passed, filled in from the quiz, so put this on a slide after the questions. It also states the pass mark." }),
      this.field("res-heading", "Heading", c.heading, (v) => done(m.setResults(o.id, { heading: v }))),
      this.field("res-pass", "After \"You passed.\"", c.passMessage, (v) => done(m.setResults(o.id, { passMessage: v }))),
      this.field("res-fail", "After \"You did not reach the pass mark.\"", c.failMessage, (v) => done(m.setResults(o.id, { failMessage: v }))),
      h("div", { class: "field check" }, review, h("label", { for: "p-res-review", text: "List each question and how it went" })))];
  }

  /** A certificate for a learner who passed. They type their own name, so there is nothing about them to write here. */
  private certificateFields(m: Model, o: OSObject): HTMLElement[] {
    const c = o.content as unknown as CertificateContent;
    const done = (msg: string | null) => { if (msg) this.announce(msg); this.fillCertificate(o); };
    const check = (id: string, label: string, on: boolean, key: "showScore" | "showDate") => {
      const box = h("input", { id: `p-${id}`, type: "checkbox", ...(on ? { checked: true } : {}) });
      box.dataset["key"] = `prop:${id}`;
      box.addEventListener("change", () => done(m.setCertificate(o.id, { [key]: box.checked })));
      return h("div", { class: "field check" }, box, h("label", { for: `p-${id}`, text: label }));
    };
    return [h("fieldset", {}, h("legend", { text: "Certificate" }),
      h("p", { class: "note", text: "Only a learner who passes the quiz gets it. They type their own name, then print it or save it as a PDF. The course title is added for you. Leave a line blank to leave it out." }),
      this.field("cert-title", "Title", c.title, (v) => done(m.setCertificate(o.id, { title: v }))),
      this.field("cert-statement", "Line before the name", c.statement, (v) => done(m.setCertificate(o.id, { statement: v }))),
      this.field("cert-achievement", "Line after the name", c.achievement, (v) => done(m.setCertificate(o.id, { achievement: v }))),
      this.field("cert-issuer", "Issued by (optional)", c.issuedBy, (v) => done(m.setCertificate(o.id, { issuedBy: v }))),
      check("cert-score", "Show the score", c.showScore, "showScore"),
      check("cert-date", "Show the date", c.showDate, "showDate"))];
  }

  private fillResults(o: OSObject): void {
    const c = o.content as unknown as ResultsContent;
    const set = (id: string, v: string) => {
      const el = this.propsBody.querySelector<HTMLInputElement>(`#p-${id}`);
      if (el && document.activeElement !== el) el.value = v;
    };
    set("res-heading", c.heading); set("res-pass", c.passMessage); set("res-fail", c.failMessage);
    const box = this.propsBody.querySelector<HTMLInputElement>("#p-res-review");
    if (box) box.checked = c.review;
  }

  private fillCertificate(o: OSObject): void {
    const c = o.content as unknown as CertificateContent;
    const set = (id: string, v: string) => {
      const el = this.propsBody.querySelector<HTMLInputElement>(`#p-${id}`);
      if (el && document.activeElement !== el) el.value = v;
    };
    set("cert-title", c.title); set("cert-statement", c.statement); set("cert-achievement", c.achievement); set("cert-issuer", c.issuedBy);
    for (const [id, on] of [["cert-score", c.showScore], ["cert-date", c.showDate]] as const) {
      const box = this.propsBody.querySelector<HTMLInputElement>(`#p-${id}`);
      if (box) box.checked = on;
    }
  }

  private fillTable(o: OSObject): void {
    const t = o.content as unknown as TableContent;
    const set = (id: string, v: string) => {
      const el = this.propsBody.querySelector<HTMLInputElement>(`#p-${id}`);
      if (el && document.activeElement !== el) el.value = v;
    };
    set("caption", t.caption);
    t.rows.forEach((row, r) => row.forEach((text, c) => set(`cell-${r}-${c}`, text)));
    for (const [id, on] of [["hdr-row", t.headerRow], ["hdr-col", t.headerColumn]] as const) {
      const box = this.propsBody.querySelector<HTMLInputElement>(`#p-${id}`);
      if (box) box.checked = on;
    }
  }

  private scrollFields(m: Model, o: OSObject): HTMLElement[] {
    const body = parseBody(String(o.content["html"] ?? ""));
    if (body === null) return [h("fieldset", {}, h("legend", { text: "Content" }), h("p", { class: "note", text: "This text has formatting the editor cannot edit yet, so it is left as it is." }))];
    return [h("fieldset", {}, h("legend", { text: "Content" }),
      this.field("scroll-text", "Text (a blank line starts a new paragraph)", body, (v) => { const msg = m.setScrollText(o.id, v); if (msg) this.announce(msg); else this.fillValues(o); }, { area: true, rows: 8 }))];
  }

  private async addItemImage(objectId: string, itemId: string): Promise<void> {
    const m = this.model;
    if (!m) return;
    try {
      const picked = await backend.pickImage();
      if (!picked) return;
      const src = await backend.importImage(m.dir, picked);
      const msg = m.setItemImage(objectId, itemId, src);
      if (msg) this.announce(msg);
      document.getElementById(`p-ix-${itemId}-alt`)?.focus();
    } catch (err) {
      this.announce(`Could not add the picture. ${errorText(err)}`);
    }
  }

  private fillInteraction(o: OSObject): void {
    const c = o.content as unknown as InteractionContent;
    const set = (id: string, v: string) => {
      const el = this.propsBody.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#p-${id}`);
      if (el && document.activeElement !== el) el.value = v;
    };
    set("ix-kind", c.kind);
    set("ix-orientation", c.orientation);
    for (const item of c.items) {
      set(`ix-${item.id}-title`, item.title);
      set(`ix-${item.id}-body`, parseBody(item.body) ?? "");
      if (item.image) {
        set(`ix-${item.id}-alt`, item.image.alt);
        const dec = this.propsBody.querySelector<HTMLInputElement>(`#p-ix-${item.id}-dec`);
        if (dec) dec.checked = item.image.decorative;
      }
      const said = (item.narration as Narration | null) ?? null;
      set(`ix-${item.id}-narration-script`, said?.script ?? "");
      if (said) { set(`ix-${item.id}-narration-voice`, said.voice); set(`ix-${item.id}-narration-speed`, String(said.speed)); }
    }
  }

  private fillQuiz(o: OSObject): void {
    const q = o.content as unknown as QuizContent;
    const set = (id: string, v: string | number) => {
      const el = this.propsBody.querySelector<HTMLInputElement | HTMLSelectElement>(`#p-${id}`);
      if (el && document.activeElement !== el) el.value = String(v);
    };
    for (const c of q.choices) {
      set(`choice-${c.id}`, c.label);
      const radio = this.propsBody.querySelector<HTMLInputElement>(`#p-correct-${c.id}`);
      if (radio) radio.checked = c.correct;
    }
    set("points", q.scoring.points);
    set("attempts", q.scoring.attemptsAllowed);
    set("fb-correct", q.feedback.correct);
    set("fb-incorrect", q.feedback.incorrect);
  }

  /** A font choice. A font the editor does not list (from an older file) is kept and shown as it is. */
  private fontField(m: Model, o: OSObject): HTMLElement {
    const current = String(o.style["fontFamily"] ?? "system-ui");
    const known = FONT_CHOICES.some((f) => f.value === current);
    const options = [
      ...(known ? [] : [{ value: current, label: `Current: ${current}` }]),
      ...FONT_CHOICES.map((f) => ({ value: f.value, label: f.label })),
    ];
    return this.selectField("font", "Font", options, current, (v) => {
      const r = m.setStyle(o.id, "fontFamily", v);
      this.announce(r.ok ? `Font changed to ${FONT_CHOICES.find((f) => f.value === v)?.label ?? v}` : r.message);
    });
  }

  private textFields(m: Model, o: OSObject): HTMLElement[] {
    const html = String(o.content["html"] ?? "");
    const simple = parseSimpleText(html);
    if (!simple) {
      return [
        h("p", { class: "note", id: "html-note", text: "This text has formatting the editor cannot edit as plain text yet. Its HTML is shown so you can change it by hand." }),
        this.field("html", "HTML", html, (v) => { const msg = m.setHtml(o.id, v); if (msg) this.announce(msg); else this.fillValues(o); }, { area: true, rows: 6, describedBy: "html-note" }),
      ];
    }
    return [
      this.selectField("block", "Style", TEXT_BLOCKS.map((b) => ({ value: b, label: `${BLOCK_LABELS[b]} (size ${BLOCK_SIZES[b]})` })), simple.block, (v) => {
        const cur = parseSimpleText(String(m.object?.content["html"] ?? "")) ?? simple;
        const msg = m.setBlock(o.id, v as TextBlock, cur.text);
        if (msg) this.announce(`${msg}. Change the font size if you want a different one.`);
      }),
      this.field("text", "Text", simple.text, (v) => {
        const cur = parseSimpleText(String(m.object?.content["html"] ?? "")) ?? simple;
        const msg = m.setText(o.id, { block: cur.block, text: v });
        if (msg) this.announce(msg);
      }, { area: true, rows: 4 }),
    ];
  }

  /**
   * The rules an object holds: when something happens, do something, if some conditions hold. Rules run
   * in order, and one that goes to another slide ends the list. A rule can belong to any object; for
   * "when the slide opens" or "when a variable changes", which object holds it makes no difference.
   */
  private ruleFields(m: Model, o: OSObject): HTMLElement[] {
    const items = m.rulesOf(o.id);
    const eventLabel = (e: RuleEvent): string => {
      if (e === "activate") return o.type === "quizQuestion" ? "the learner checks an answer" : "the learner presses it";
      if (e === "mediaComplete") return o.type === "audio" ? "the audio finishes" : "the video finishes";
      return { slideStart: "the slide opens", slideEnd: "the slide closes", variableChange: "any variable changes" }[e];
    };
    const ACTIONS: { value: RuleAction; label: string }[] = [
      { value: "jumpToSlide", label: "Go to a slide" }, { value: "showLayer", label: "Show a layer" }, { value: "hideLayer", label: "Hide a layer" },
      { value: "setVariable", label: "Set a variable" }, { value: "playMedia", label: "Play a video or audio" }, { value: "pauseMedia", label: "Pause a video or audio" },
    ];
    const NEW = "__new";
    const say = (msg: string | null) => { if (msg) this.announce(msg); };

    /** A box for a value that suits the variable's kind. */
    const valueBox = (id: string, label: string, type: Variable["type"] | undefined, value: Primitive | undefined, onChange: (v: Primitive) => void, variableId?: string): HTMLElement => {
      // If an input saves to the variable, the author picks one of its own answers instead of typing one.
      const choices = variableId ? m.valueChoices(variableId) : null;
      if (choices) {
        const known = choices.some((c) => c.value === value);
        return this.selectField(id, label, [...(known ? [] : [{ value: String(value ?? ""), label: `${String(value)} (no answer saves this)`, disabled: true }]), ...choices.map((c) => ({ value: String(c.value), label: c.label }))], String(value ?? ""), (v) => {
          const picked = choices.find((c) => String(c.value) === v);
          if (picked) onChange(picked.value);
        });
      }
      if (type === "boolean") return this.selectField(id, label, [{ value: "true", label: "true" }, { value: "false", label: "false" }], String(value ?? true), (v) => onChange(v === "true"));
      if (type === "number") return this.field(id, label, typeof value === "number" ? value : 0, (v) => onChange(v.trim() === "" ? Number.NaN : Number(v)), { number: true });
      return this.field(id, label, typeof value === "string" ? value : "", (v) => onChange(v));
    };

    const cards = items.map((item, i) => {
      const legend = h("legend", { text: `Rule ${i + 1} of ${items.length}` });
      if (item.kind === "raw") {
        const del = this.small("Delete", "Delete this rule", () => say(m.deleteRule(o.id, i)), `Delete rule ${i + 1}`);
        return h("fieldset", { class: "rule" }, legend, h("p", { class: "note", text: `${item.why} It is left exactly as it is.` }), del);
      }
      const r = item.rule;
      const targets = m.targetsFor(o.id, r.action);
      const type = m.variables.find((v) => v.id === r.target)?.type;
      const parts: HTMLElement[] = [
        this.selectField(`rule-${i}-event`, "When", eventsFor(o.type).map((e) => ({ value: e, label: eventLabel(e) })), r.event, (v) => say(m.updateRule(o.id, i, { event: v as RuleEvent }))),
        this.selectField(`rule-${i}-action`, "Do", ACTIONS, r.action, (v) => say(m.updateRule(o.id, i, { action: v as RuleAction }))),
      ];
      const targetLabel = { jumpToSlide: "Slide", showLayer: "Layer", hideLayer: "Layer", setVariable: "Variable", playMedia: "Which one", pauseMedia: "Which one" }[r.action];
      parts.push(this.selectField(`rule-${i}-target`, targetLabel, [
        ...(targets.some((t) => t.value === r.target) ? [] : [{ value: r.target, label: `${r.target} (missing)`, disabled: true }]),
        ...targets,
        ...(r.action === "setVariable" ? [{ value: NEW, label: "A new variable" }] : []),
      ], r.target, (v) => {
        if (v === NEW) { const nv = m.addVariable("boolean", "flag"); say(m.updateRule(o.id, i, { target: nv.id })); return; }
        say(m.updateRule(o.id, i, { target: v }));
      }));
      if (r.action === "setVariable") parts.push(valueBox(`rule-${i}-value`, "To", type, r.value, (v) => { say(m.updateRule(o.id, i, { value: v })); this.renderProps(); }, r.target));

      const conds = r.conditions.map((c, k) => {
        const vtype = m.variables.find((v) => v.id === c.variable)?.type;
        return h("div", { class: "cond", role: "group", "aria-label": `Condition ${k + 1}` },
          this.selectField(`rule-${i}-c${k}-var`, "Only if", [...(vtype ? [] : [{ value: c.variable, label: `${c.variable} (missing)`, disabled: true }]), ...m.variables.map((v) => ({ value: v.id, label: v.name }))], c.variable, (v) => say(m.updateCondition(o.id, i, k, { variable: v }))),
          this.selectField(`rule-${i}-c${k}-op`, "is", operatorsFor(vtype ?? "string").map((op) => ({ value: op, label: OPERATOR_LABELS[op] })), c.operator, (v) => say(m.updateCondition(o.id, i, k, { operator: v as Condition["operator"] }))),
          valueBox(`rule-${i}-c${k}-value`, "this value", vtype, c.value, (v) => { say(m.updateCondition(o.id, i, k, { value: v })); }, c.variable),
          this.small("Delete condition", "Delete this condition", () => say(m.deleteCondition(o.id, i, k)), `Delete condition ${k + 1} of rule ${i + 1}`));
      });
      const addCond = this.small("Add condition", "Only do this if a variable has a certain value", () => say(m.addCondition(o.id, i)), `Add a condition to rule ${i + 1}`);
      const earlier = this.small("Move earlier", "Run this rule earlier", () => say(m.moveRule(o.id, i, -1)), `Move rule ${i + 1} earlier`);
      const later = this.small("Move later", "Run this rule later", () => say(m.moveRule(o.id, i, 1)), `Move rule ${i + 1} later`);
      const del = this.small("Delete rule", "Delete this rule", () => say(m.deleteRule(o.id, i)), `Delete rule ${i + 1}`);
      this.setEnabled(earlier, i > 0);
      this.setEnabled(later, i < items.length - 1);
      const when = r.event === "variableChange" ? " It is checked each time any variable changes, so it can act as soon as an answer is given." : "";
      return h("fieldset", { class: "rule" }, legend, ...parts,
        ...(conds.length ? [h("div", { class: "conds" }, ...conds)] : []),
        h("p", { class: "note", text: r.conditions.length > 1 ? `All ${r.conditions.length} conditions must hold.` : r.conditions.length === 1 ? "Only when this holds." : `Always, with no conditions.${when}` }),
        h("div", { class: "btn-row" }, addCond, earlier, later, del));
    });

    const add = this.small("Add rule", "Add a rule to this object", () => {
      const msg = m.addRule(o.id);
      if (msg) this.announce(msg);
    });
    const variables = this.small("Variables...", "See, add and change the project's variables", () => void this.openVariablesDialog());
    return [h("fieldset", {}, h("legend", { text: "Rules" }),
      h("p", { class: "note", text: "A rule says what the course does, and when. Rules run in order from the top, and a rule that goes to another slide ends the list. To send the learner different ways, use several rules with different conditions. A rule can belong to any object." }),
      ...(cards.length ? cards : [h("p", { class: "note", text: "No rules yet." })]),
      h("div", { class: "btn-row" }, add, variables))];
  }

  private async openVariablesDialog(): Promise<void> {
    const m = this.model;
    if (!m) return;
    await openVariables(m, (msg) => this.announce(msg));
    this.variablesBtn.focus();
    this.renderProps();
  }

  // ---- keyboard

  private onGlobalKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    const typing = target.matches("input:not([type=checkbox]), textarea, select");
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void this.save(); }
    else if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); void this.open(); }
    else if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); void this.newProject(); }
    else if (mod && e.key.toLowerCase() === "p") { e.preventDefault(); if (e.shiftKey) void this.publish(); else void this.preview(); }
    else if (mod && !typing && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); }
    else if (mod && !typing && e.key.toLowerCase() === "y") { e.preventDefault(); this.redo(); }
    else if (e.key === "F6") { e.preventDefault(); this.cycleRegion(e.shiftKey ? -1 : 1); }
    else if (mod && !typing && !e.shiftKey && !e.altKey && this.model && !document.querySelector("dialog[open]")) {
      // Duplicate, copy, cut and paste work on the selected object. When words are selected on the page, Copy is theirs, not ours.
      const key = e.key.toLowerCase();
      const wordsSelected = (window.getSelection()?.toString() ?? "") !== "";
      if (key === "d") { e.preventDefault(); this.duplicateObject(); }
      else if (key === "c" && !wordsSelected) { e.preventDefault(); this.copyObject(); }
      else if (key === "x" && !wordsSelected) { e.preventDefault(); this.cutObject(); }
      else if (key === "v") { e.preventDefault(); this.pasteObject(); }
    }
  }

  private cycleRegion(dir: 1 | -1): void {
    if (this.workspace.hidden) return;
    const regions = this.regions.filter((r) => !r.hidden);
    const at = regions.findIndex((r) => r.contains(document.activeElement));
    const next = regions[(at + dir + regions.length) % regions.length]!;
    const focusable = next.querySelector<HTMLElement>("[aria-current='true'], button:not([aria-disabled='true']), [tabindex='0'], input, select, textarea");
    focusable?.focus();
    const name = next.getAttribute("aria-label") ?? next.querySelector("h2")?.textContent ?? "";
    this.announce(name);
  }

  private focusSlideList(): void {
    this.slideList.querySelector<HTMLElement>("[aria-current='true']")?.focus();
  }

  /** Arrow keys, Alt+arrows and Delete inside the lists. */
  wire(): void {
    this.wireArrows(
      this.slideList,
      (key, dir) => {
        const id = key.replace(/^slide:/, "");
        this.model?.selectSlide(id);
        this.moveSlide(dir);
      },
      (key) => {
        this.model?.selectSlide(key.replace(/^slide:/, ""));
        this.deleteSlide();
      },
    );
    this.wireArrows(
      this.objectList,
      (key, dir) => {
        const id = key.replace(/^object:/, "");
        const msg = this.model?.reorder(id, dir);
        if (msg) {
          this.announce(msg);
          this.refocus(key);
        }
      },
      (key) => {
        this.model?.selectObject(key.replace(/^object:/, ""));
        this.deleteObject();
      },
    );
    this.wireArrows(this.problemList);
  }
}
