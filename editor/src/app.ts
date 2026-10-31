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

import type { CertificateContent, ChoiceQuiz, FillBlanksQuiz, HotspotQuiz, MatchingQuiz, NumericQuiz, SequencingQuiz, ShortAnswerQuiz, Condition, DownloadContent, EmbedContent, InputContent, InteractionContent, OSObject, QuizContent, Primitive, ResultsContent, TableContent, Variable, ScenarioContent, ScenarioLine, IconContent } from "../../player/src/types.ts";
import { INPUT_VARIABLE_TYPE } from "../../player/src/inputs.ts";
import { markerAt } from "../../player/src/interactions.ts";
import { backend, errorText, type Finding } from "./backend.ts";
import { Canvas } from "./canvas.ts";
import { SHAPE_KINDS } from "../../player/src/stage.ts";
import { isBubbleKind, tailOf } from "../../player/src/bubble.ts";
import { backgroundColors, isThemeRef, resolveValue } from "../../player/src/theme.ts";
import { COLOR_ROLES, colorRef } from "./colors.ts";
import { BLOCK_SIZES, colorName, eventsFor, operatorsFor, OPERATOR_LABELS, parseBody, parseVideoAddress, type RuleAction, type RuleEvent, isCourseAction, contrastNote, contrastRatio, FONT_CHOICES, normalizeHex, PALETTE, parseSimpleText, TEXT_BLOCKS, themeColorLabel, type Activation, type TextBlock } from "./content.ts";
import { fileDetails } from "../../player/src/downloads.ts";
import { timerContentOf } from "../../player/src/timer.ts";
import { openBanks } from "./bankdialog.ts";
import { askQuestionImport, type QuestionPreset } from "./questiondialog.ts";
import { ITEM_LIMITS } from "../../player/src/interactions.ts";
import { openAssets } from "./assetsdialog.ts";
import { openVariables } from "./variablesdialog.ts";
import { askText } from "./textprompt.ts";
import { openPowerPoint } from "./pptxdialog.ts";
import { rovingStop } from "./roving.ts";
import { canHaveLooks, isReadyLook, lookFieldsFor, lookLabel, lookNameProblem, lookUse, mixHex, percentOf, solidnessOf, type LookField } from "./looks.ts";
import type { CreditEntry, Effect, Style } from "../../player/src/types.ts";
import { askChoice, bubblePreview, interactionPreview, shapePreview } from "./choicepicker.ts";
import { ADD_MENU, bubbleChoice, groupOptions, INPUTS, INTERACTIONS, isPictureBox, NAVIGATION_BUTTONS, SLIDE_LAYOUTS, type QuizType } from "./factory.ts";
import { askLayout, QUIZ_PREFIX } from "./layoutpicker.ts";
import { TEMPLATE_PREFIX } from "./templates.ts";
import { GAME_PREFIX, GAME_SETS, gameById } from "./gamesets.ts";
import { askGame } from "./gamedialog.ts";
import { groupBox } from "./group.ts";
import { ALIGNMENTS } from "./align.ts";
import { extraWordsOf, LIMITS, QUIZ_KINDS, quizKind, type QuestionEdit } from "./questionedit.ts";
import { clockText, FORMAT_VERSION, Model, narratedName, type Change } from "./model.ts";
import { askNewProject } from "./newproject.ts";
import { openNarration } from "./narrationdialog.ts";
import { openTiming } from "./timingdialog.ts";
import { TimelinePanel } from "./timelinepanel.ts";
import { describeTiming, isStartingTiming, MAX_STEP, parseSeconds, secondsText } from "./timing.ts";
import { brief, paragraphsOf } from "./paragraphs.ts";
import { describeAnimation, describeSlideTransition, effectChoices, isStartingAnimation, MAX_DURATION, MIN_DURATION, type Phase } from "./animation.ts";
import { openAbout } from "./aboutdialog.ts";
import { audioRowNote, audioRowText, audioStatus, engineOf, isKnownVoice, keyOf, languageOptions, newNarration, setVoiceSources, soundIgnoresLanguage, voiceGroups, voiceTraits, type CachedAudio, type Narration } from "./narration.ts";
import { makeAudio } from "./makeaudio.ts";
import { availability, buildVoiceSources, disclosureNote, isAllowed, noPlugins, serviceById, voiceLimits, voiceNote, type PluginList, type ServiceId, type Work } from "./aiservices.ts";
import { askPermission, openAiServices } from "./aidialog.ts";
import { openRecorder, recorderDialogOpen } from "./recorderdialog.ts";
import { RecorderController } from "./capturecontroller.ts";
import { openRecordingEditor } from "./editrecording.ts";
import { openCaptions } from "./captionsdialog.ts";
import { hintFor, hintSourcesOf } from "./recognition.ts";
import { openSteps } from "./stepsdialog.ts";
import type { Extra } from "./captions.ts";
import { defaultSettings, type Phase as RecordPhase, type RecordSettings } from "./capturesession.ts";
import { sampleButton, sampleMakingText, sampleNote, samplePlayingText, type SampleAnswer, type SampleState } from "./voicesample.ts";
import { parseSettings, type Settings } from "./stock.ts";
import { openPublish } from "./publishdialog.ts";
import { openTranslate } from "./translatedialog.ts";
import { failureText, narrationLine } from "./publishing.ts";
import { newProjectFiles } from "./template.ts";
import { askTheme } from "./themepicker.ts";
import { editTheme as editThemeDialog } from "./themeeditor.ts";
import { editCast } from "./castdialog.ts";
import { chooseFromLibrary } from "./packdialog.ts";
import { choosePoses as choosePosesDialog } from "./posedialog.ts";
import { creditForBackground, creditForPicture, creditForSlidePicture, slidePictures } from "./packs.ts";
import { insertReference, valueChoices } from "./values.ts";
import { askAddSet, askShare } from "./setdialog.ts";
import { sizeWords } from "./slidesets.ts";
import { referencesIn } from "../../player/src/valuetext.ts";
import { averageColourOf, chooseBackgroundPicture } from "./backgrounddialog.ts";
import { pickIcon } from "./icondialog.ts";
import { openTextEditor } from "./textdialog.ts";
import { chooseMoments } from "./momentdialog.ts";
import { contentOf as iconContent, iconWords, loadIcons } from "./icons.ts";
import { BUTTON_LOOKS, CUSTOM_LOOK } from "./buttonlooks.ts";
import { castUse, poseUse, YOU } from "./characters.ts";
import * as S from "./scenarioedit.ts";
import { logoFromImage } from "./themeedit.ts";
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
const SHAPE_LABELS: Record<(typeof SHAPE_KINDS)[number], string> = { rectangle: "Rectangle", rounded: "Rounded rectangle", ellipse: "Ellipse", triangle: "Triangle", diamond: "Diamond", arrow: "Arrow", speech: "Speech bubble", thought: "Thought bubble" };
const BLOCK_LABELS: Record<TextBlock, string> = { p: "Paragraph", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", h4: "Heading 4", h5: "Heading 5", h6: "Heading 6" };

/** What decides whether an input's panel has to be rebuilt: its parts, and the variables it can choose between. */
function inputShape(o: OSObject, m: Model): string {
  const c = o.content as unknown as InputContent;
  const parts = c.kind === "checkbox" ? c.items : c.kind === "likert" || c.kind === "semantic" ? c.rows : c.options;
  return `${c.kind}|${(parts ?? []).map((p) => `${p.id}:${(p as { variable?: string }).variable ?? ""}`).join(",")}|${c.variable ?? ""}|${m.variables.map((v) => `${v.id}${v.name}`).join(",")}|${(c.characters ?? []).join(",")}|${m.characters.map((p) => `${p.id}${p.name}${p.role}`).join(",")}`;
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

/** A situation in a list: its place, its title, and whether it is the start or an ending. */
function situationLabel(c: ScenarioContent, node: ScenarioContent["nodes"][number], index: number): string {
  return `${index + 1}. ${node.title}${node.id === c.start ? " (start)" : ""}${node.choices.length === 0 ? " (ending)" : ""}`;
}

/** One line about when a look is used, and, for a look that is not set, that choosing anything below makes it. */
function lookUseText(look: string, set: boolean): string {
  return `${lookUse(look)}${set ? "" : " This look is not set yet: choosing anything below makes it."}`;
}

/** What to tell the author about the words a screen reader says when a rule applies this look. */
function announceNoteText(look: string, said: string, uses: number): string {
  const used = uses > 0 ? ` ${uses === 1 ? "1 rule on this slide applies" : `${uses} rules on this slide apply`} this look.` : "";
  if (look === "disabled") return `A disabled control already tells a screen reader it is unavailable, so this message is optional.${used}`;
  const ownAlone = look === "hover" || look === "visited" ? " The course applying the look on its own never says it." : "";
  if (said !== "") return `A screen reader says this when a rule applies the look.${ownAlone}${used}`;
  if (uses > 0) return `A screen reader user is not told when a rule applies this look. Write what it should say, such as "Marked as done". The Problems list keeps warning until you do.${used}`;
  return `What a screen reader says when a rule applies this look, such as "Marked as done". Leave it blank only if the change means nothing without seeing it.${ownAlone}`;
}

/**
 * What decides whether a scenario's panel has to be rebuilt: the shape of the story and the situation being edited. The words in it
 * are left out, so typing in a box never rebuilds the panel under the author; those are put back in place instead.
 */
function scenarioShape(o: OSObject, m: Model, selected: string): string {
  const c = o.content as unknown as ScenarioContent;
  const lines = (list: ScenarioLine[]) => list.map((l) => `${l.id}:${l.speaker ?? "-"}:${l.pose ?? "-"}:${l.narration ? `s${((l.narration as Narration).pronunciations ?? []).length}` : "n"}`).join(",");
  const nodes = c.nodes.map((n) => `${n.id}[${lines(n.lines)}|${n.choices.map((ch) => `${ch.id}>${ch.next}(${ch.effects.map((e) => e.variable).join("+")})<${lines(ch.response)}>`).join(";")}]`).join(" ");
  return `${selected}|${c.start}|${c.you ?? ""}|${c.finishedVariable ?? ""}|${c.allowRetry}|${c.meters.map((x) => `${x.id}:${x.variable}`).join(",")}|${nodes}|${m.variables.map((v) => `${v.id}${v.name}${v.type}`).join(",")}|${m.characters.map((p) => `${p.id}${p.name}${(p.poses ?? []).map((x) => `${x.id}${x.label}`).join("+")}${p.library ? "L" : ""}`).join(",")}`;
}

/** The count of problems is said at least this long after anything else was said, so it never talks over what an edit just did. */
const PROBLEMS_AFTER_MS = 2500;

export class App {
  private model: Model | null = null;
  private readonly root: HTMLElement;
  private readonly announcer: HTMLElement;
  private readonly canvas: Canvas;

  private readonly newBtn: HTMLButtonElement;
  private readonly openBtn: HTMLButtonElement;
  private readonly themeBtn: HTMLButtonElement;
  private readonly castBtn: HTMLButtonElement;
  /** The situation being edited in each scenario's panel, by object id. */
  private readonly scenarioSelect = new Map<string, string>();
  /** The lines whose voice settings are open in the panel. */
  private readonly scenarioOpen = new Set<string>();
  private readonly assetsBtn: HTMLButtonElement;
  private readonly pptxBtn: HTMLButtonElement;
  private readonly variablesBtn: HTMLButtonElement;
  private readonly narrationBtn: HTMLButtonElement;
  private readonly aboutBtn: HTMLButtonElement;
  private readonly aiBtn: HTMLButtonElement;
  private readonly recorderBtn: HTMLButtonElement;
  /** Holds a recording, so it goes on when the dialog is closed. */
  private readonly recorder = new RecorderController(backend);
  private recorderSettings: RecordSettings = defaultSettings();
  /** What is known about videos made from a recording this session, by their path in the course: what is on the screen, and how long they are. For their transcripts. */
  private readonly madeVideos = new Map<string, { extras: Extra[]; lengthMs: number }>();
  private readonly timingBtn: HTMLButtonElement;
  private readonly timelineBtn: HTMLButtonElement;
  private readonly timelinePanel: TimelinePanel;
  private readonly saveBtn: HTMLButtonElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly previewBtn: HTMLButtonElement;
  private readonly publishBtn: HTMLButtonElement;
  private readonly translateBtn: HTMLButtonElement;

  private readonly slideList: HTMLElement;
  private readonly addSlideBtn: HTMLButtonElement;
  private readonly changeLayoutBtn: HTMLButtonElement;
  private readonly deleteSlideBtn: HTMLButtonElement;
  private readonly duplicateSlideBtn: HTMLButtonElement;
  private readonly shareSlidesBtn: HTMLButtonElement;
  private readonly banksBtn: HTMLButtonElement;
  private readonly questionsFileBtn: HTMLButtonElement;
  private readonly gamesBtn: HTMLButtonElement;
  private readonly slidesFromFileBtn: HTMLButtonElement;
  private readonly slideUpBtn: HTMLButtonElement;
  private readonly slideDownBtn: HTMLButtonElement;
  private readonly layerSelect: HTMLSelectElement;
  private readonly addLayerBtn: HTMLButtonElement;
  private readonly deleteLayerBtn: HTMLButtonElement;
  private readonly duplicateLayerBtn: HTMLButtonElement;
  private readonly layerEarlierBtn: HTMLButtonElement;
  private readonly layerLaterBtn: HTMLButtonElement;
  private readonly objectList: HTMLElement;
  private readonly addKind: HTMLSelectElement;
  private readonly addObjectBtn: HTMLButtonElement;
  private readonly deleteObjectBtn: HTMLButtonElement;
  private readonly duplicateBtn: HTMLButtonElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly cutBtn: HTMLButtonElement;
  private readonly pasteBtn: HTMLButtonElement;
  private readonly selectAllBtn: HTMLButtonElement;
  private readonly lockBtn: HTMLButtonElement;
  private readonly groupBtn: HTMLButtonElement;
  private readonly ungroupBtn: HTMLButtonElement;
  private readonly selectGroupBtn: HTMLButtonElement;
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
  /** When something was last said to a screen reader, so the count of problems does not talk over it. */
  private lastSaid = 0;
  private problemSayTimer: number | undefined;
  private regions: HTMLElement[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
    this.announcer = h("div", { class: "sr-only", role: "status", "aria-live": "polite" });
    this.canvas = new Canvas(document, () => this.model, backend, (m) => this.announce(m));
    this.canvas.onEditText = () => void this.editText();

    this.newBtn = this.tool("New project", "Make a new project (Ctrl+N)", () => void this.newProject());
    this.openBtn = this.tool("Open project", "Open a project folder (Ctrl+O)", () => void this.open());
    this.themeBtn = this.tool("Themes", "Choose a theme: the colours, fonts and backgrounds of the whole project", () => void this.chooseTheme());
    this.castBtn = this.tool("Characters", "The cast: the people a scenario can show and a learner can choose to be, with their pictures and voices", () => void this.openCast());
    this.assetsBtn = this.tool("Assets", "The project's images, video and audio, and stock images to add to it", () => void this.openAssetsDialog());
    this.pptxBtn = this.tool("PowerPoint", "Bring slides in from a PowerPoint presentation, or bring slides you brought in earlier up to date after the presentation changed", () => void this.openPowerPointDialog());
    this.variablesBtn = this.tool("Variables", "The values the course remembers, which rules and inputs use", () => void this.openVariablesDialog());
    this.narrationBtn = this.tool("Narration", "Everything the course says aloud, and making the audio for it", () => void this.openNarrationDialog());
    this.recorderBtn = this.tool("OpenScreen", "Record the screen, and check that this computer is ready to record", () => void this.openRecorderDialog());
    this.watchRecorder();
    this.aiBtn = this.tool("AI services", "A key for OpenAI, to make voices and pictures with it, and voice plugins", () => void this.openAiServicesDialog());
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
    this.publishBtn = this.tool("Publish", "Make packages for your LMS: SCORM 1.2, SCORM 2004 and xAPI (Ctrl+Shift+P)", () => void this.publish());
    this.translateBtn = this.tool("Translate", "Make a file for translating the course into another language, and bring the translation back", () => void this.translate());
    this.aboutBtn = this.tool("About", "The version of OpenStage Author, and where things are on this computer (for asking for help)", () => void this.openAboutDialog());
    const toolbar = h("div", { class: "toolbar", role: "group", "aria-label": "Project" }, this.newBtn, this.openBtn, this.themeBtn, this.castBtn, this.assetsBtn, this.pptxBtn, this.variablesBtn, this.narrationBtn, this.aiBtn, this.recorderBtn, this.timingBtn, this.timelineBtn, this.saveBtn, this.undoBtn, this.redoBtn, this.previewBtn, this.publishBtn, this.translateBtn, this.aboutBtn);
    const header = h("header", { class: "topbar" }, h("h1", { text: "OpenStage Author" }), toolbar);

    // Slides
    this.slideList = h("ul", { class: "item-list", role: "list" });
    this.addSlideBtn = this.small("Add slide", "Add a slide after this one, choosing its layout", () => void this.addSlide());
    this.changeLayoutBtn = this.small("Change layout", "Choose a different layout for this slide", () => void this.changeLayout());
    this.deleteSlideBtn = this.small("Delete slide", "Delete this slide (Delete key in the list)", () => this.deleteSlide());
    this.duplicateSlideBtn = this.small("Duplicate slide", "Make a copy of this slide straight after it (Ctrl+D in the list)", () => this.duplicateSlide());
    this.shareSlidesBtn = this.small("Share slides...", "Save slides, with what they need, as one file to give to someone else", () => void this.shareSlides());
    this.slidesFromFileBtn = this.small("Add slides from a file...", "Add slides someone gave you as one file after this slide", () => void this.addSlidesFromFile());
    this.banksBtn = this.small("Question banks...", "Choose which slides each learner is shown: some of a run of questions, picked at random", () => void this.openBanksDialog());
    this.questionsFileBtn = this.small("Quiz from a file...", "Make a slide for each question in a spreadsheet saved as a CSV file, after this slide. Tick the test bank box there to show each learner only some of them", () => void this.addQuestionsFromFile("quiz"));
    this.gamesBtn = this.small("Games...", "Add a ready-made game after this slide: a quiz board, a prize ladder or an escape room", () => void this.addSlide("games"));
    this.slideUpBtn = this.small("Up", "Move this slide earlier (Alt+Up Arrow)", () => this.moveSlide(-1), "Move slide up");
    this.slideDownBtn = this.small("Down", "Move this slide later (Alt+Down Arrow)", () => this.moveSlide(1), "Move slide down");
    // The heading and the buttons stay where they are while a long list of slides scrolls under them, so Add slide is never a long scroll away.
    const slidesNav = h("nav", { class: "panel slides", "aria-labelledby": "slides-h" },
      h("div", { class: "panel-tools" },
        h("h2", { id: "slides-h", text: "Slides" }),
        h("div", { class: "btn-row" }, this.addSlideBtn, this.gamesBtn, this.questionsFileBtn),
        h("div", { class: "btn-row" }, this.duplicateSlideBtn, this.changeLayoutBtn, this.deleteSlideBtn, this.slideUpBtn, this.slideDownBtn),
        h("div", { class: "btn-row" }, this.shareSlidesBtn, this.slidesFromFileBtn, this.banksBtn)),
      this.slideList);

    // Canvas and layers
    this.layerSelect = h("select", { id: "layer-select" });
    this.layerSelect.addEventListener("change", () => this.model?.selectLayer(this.layerSelect.value));
    this.addLayerBtn = this.small("Add layer", "Add a layer to this slide", () => this.addLayer());
    this.deleteLayerBtn = this.small("Delete layer", "Delete this layer and what is on it", () => this.deleteLayer());
    this.duplicateLayerBtn = this.small("Duplicate layer", "Make a copy of this layer and what is on it, straight after it. Nothing shows the copy until you add a rule that does", () => this.duplicateLayer());
    this.layerEarlierBtn = this.small("Earlier", "Move this layer earlier: it is drawn behind, and read before, the layers after it", () => this.moveLayer(-1), "Move layer earlier");
    this.layerLaterBtn = this.small("Later", "Move this layer later: it is drawn in front of, and read after, the layers before it", () => this.moveLayer(1), "Move layer later");
    const layerBar = h("div", { class: "layer-bar" }, h("label", { for: "layer-select", text: "Layer being edited" }), this.layerSelect, this.addLayerBtn, this.duplicateLayerBtn, this.layerEarlierBtn, this.layerLaterBtn, this.deleteLayerBtn);
    const main = h("main", { class: "center", "aria-label": "Canvas" }, layerBar, this.canvas.element);

    // Properties
    this.propsBody = h("div", { class: "props-body" });
    const props = h("aside", { class: "panel props", "aria-labelledby": "props-h" }, h("h2", { id: "props-h", text: "Properties" }), this.propsBody);

    // Objects
    this.objectList = h("ul", { class: "item-list", role: "list" });
    this.addKind = h("select", { id: "add-kind" }, ...ADD_MENU.map((k) => h("option", { value: k.value, text: k.label })));
    this.addObjectBtn = this.small("Add object", "Add the chosen kind of object to this layer", () => void this.addObject());
    this.deleteObjectBtn = this.small("Delete object", "Delete the selected objects (Delete key)", () => this.deleteObject());
    this.moveEarlier = this.small("Move earlier", "Earlier in reading order (Alt+Up Arrow)", () => this.reorder(-1));
    this.moveLater = this.small("Move later", "Later in reading order (Alt+Down Arrow)", () => this.reorder(1));
    this.duplicateBtn = this.small("Duplicate", "Make a copy of the selected object beside it (Ctrl+D)", () => this.duplicateObject());
    this.copyBtn = this.small("Copy", "Copy the selected object (Ctrl+C)", () => this.copyObject());
    this.cutBtn = this.small("Cut", "Copy the selected object and remove it (Ctrl+X)", () => this.cutObject());
    this.pasteBtn = this.small("Paste", "Paste the copied objects on this layer, which may be on another slide (Ctrl+V)", () => this.pasteObject());
    this.selectAllBtn = this.small("Select all", "Select every object on this layer (Ctrl+A)", () => this.selectAllObjects());
    this.lockBtn = this.small("Lock", "Lock the selected objects so they cannot be moved, resized, rotated or deleted by accident (Ctrl+L)", () => this.toggleLockObjects());
    this.groupBtn = this.small("Group", "Tie the selected objects together, so they are chosen, moved, resized, copied and deleted as one (Ctrl+G)", () => this.groupObjects());
    this.ungroupBtn = this.small("Ungroup", "Break the selected objects' groups apart (Ctrl+Shift+G)", () => this.ungroupObjects());
    this.selectGroupBtn = this.small("Select group", "Select everything that is in the same group as the selected objects", () => this.selectGroupObjects());
    const objects = h("section", { class: "panel objects", "aria-labelledby": "objects-h" },
      h("h2", { id: "objects-h", text: "Objects" }),
      h("div", { class: "btn-row" }, h("label", { for: "add-kind", text: "Add" }), this.addKind, this.addObjectBtn),
      h("div", { class: "btn-row" }, this.deleteObjectBtn, this.moveEarlier, this.moveLater),
      h("div", { class: "btn-row" }, this.duplicateBtn, this.copyBtn, this.cutBtn, this.pasteBtn, this.selectAllBtn, this.lockBtn),
      h("div", { class: "btn-row" }, this.groupBtn, this.ungroupBtn, this.selectGroupBtn),
      h("p", { class: "note", text: "In reading order, which is also the tab order." }),
      this.objectList);

    // Problems
    this.problemSummary = h("span", { class: "summary" });
    this.problemList = h("ul", { class: "item-list", role: "list" });
    const problems = h("section", { class: "panel problems", "aria-labelledby": "problems-h" },
      h("div", { class: "panel-head" }, h("h2", { id: "problems-h", text: "Problems" }), this.problemSummary),
      this.problemList);

    this.workspace = h("div", { class: "workspace" }, slidesNav, main, this.timelinePanel.element, props, h("div", { class: "bottom" }, objects, problems));
    this.welcome = h("main", { class: "welcome", "aria-labelledby": "welcome-h" },
      h("h2", { id: "welcome-h", text: "Open a project to begin" }),
      h("p", { id: "welcome-text", text: "A project is a folder containing project.json. Make a new one, or open one you have made." }));
    const newWelcome = h("button", { type: "button", text: "New project" });
    newWelcome.addEventListener("click", () => void this.newProject());
    const openWelcome = h("button", { type: "button", text: "Open project" });
    openWelcome.addEventListener("click", () => void this.open());
    this.welcome.append(newWelcome, " ", openWelcome);
    // Example projects come with the program: say so and show where they are, so a first-time author is not left to look for them.
    const showExamples = h("button", { type: "button", id: "welcome-examples", text: "Show the examples", hidden: true });
    this.welcome.append(" ", showExamples);
    void backend.examplesFolder().then((folder) => {
      if (folder === "") return;
      const note = this.welcome.querySelector("#welcome-text");
      if (note) note.textContent = "A project is a folder containing project.json. Make a new one, open one you have made, or look at the example projects that came with the program: press Show the examples, then Open project and choose one of them.";
      showExamples.hidden = false;
      showExamples.addEventListener("click", () => {
        backend.revealInFolder(folder).then(() => this.announce("Showing the example projects."), (err) => this.announce(errorText(err)));
      });
    }, () => undefined);

    this.statusSave = h("span");
    this.statusSlide = h("span");
    this.statusProblems = h("span");
    const status = h("footer", { class: "statusbar" }, this.statusSave, this.statusSlide, this.statusProblems);

    this.regions = [slidesNav, main, this.timelinePanel.element, props, objects, problems];
    root.append(header, this.welcome, this.workspace, status, this.announcer);
    this.workspace.hidden = true;

    document.addEventListener("keydown", (e) => this.onGlobalKey(e));
    // Remembered so that a redraw that loses focus can put it where Tab was taking it (see keepFocus).
    document.addEventListener("keydown", (e) => { if (e.key === "Tab") this.lastTab = { at: Date.now(), back: e.shiftKey }; }, true);
    document.addEventListener("focusin", (e) => { const k = (e.target as HTMLElement).dataset?.["key"]; if (k) this.lastKey = k; }, true);
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
    this.lastSaid = Date.now();
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
    await this.loadServices();
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
    if (!theme) {
      this.themeBtn.focus();
      return;
    }
    if (theme === "edit") return this.editTheme();
    // A built-in theme brings its own colours and fonts, and the project's logo stays.
    const msg = m.setTheme(theme, true);
    this.announce(msg ? `${msg}${msg.endsWith(".") ? "" : "."} Press Control Z to undo.` : `${theme.name} is already the theme.`);
    this.themeBtn.focus();
  }

  /** Change the project's own theme: its colours, its fonts and a logo. */
  private async editTheme(): Promise<void> {
    const m = this.model;
    if (!m) return;
    const edited = await editThemeDialog({
      current: m.theme,
      stage: m.project.stage,
      chooseLogo: () => this.chooseLogo(),
      imageUrl: (src) => backend.assetUrl(m.dir, src),
      announce: (msg) => this.announce(msg),
    });
    if (edited) {
      const msg = m.setTheme(edited, false);
      this.announce(msg ? `${msg}. Press Control Z to undo.` : "The theme was not changed.");
    }
    this.themeBtn.focus();
  }

  /** Choose a picture for the logo, copy it into the project, and find out how big it is. */
  private async chooseLogo(): Promise<{ src: string; width: number; height: number } | null> {
    const m = this.model;
    if (!m) return null;
    const picked = await backend.pickImage();
    if (!picked) return null;
    const src = await backend.importImage(m.dir, picked);
    const url = await backend.assetUrl(m.dir, src);
    const natural = await new Promise<{ width: number; height: number }>((ok) => {
      const img = new Image();
      img.onload = () => ok({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => ok({ width: 0, height: 0 });
      img.src = url;
    });
    const logo = logoFromImage(src, natural);
    return { src, width: logo.width, height: logo.height };
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

  /** The Translate dialog: makes a file for a translator, and brings the translated file back as a new course. */
  async translate(): Promise<void> {
    const m = this.model;
    if (!m || this.working) return;
    this.working = true;
    this.updateChrome();
    try {
      await openTranslate({
        backend, dir: m.dir,
        save: async () => (await this.writeChanges()) !== null,
        announce: (msg) => this.announce(msg),
      });
    } finally {
      this.working = false;
      this.updateChrome();
      this.translateBtn.focus();
    }
  }

  // ---- AI services and voice plugins

  /** The author's settings (keys, permissions, plugins switched on) as last read from the settings file. */
  private settings: Settings = parseSettings("");
  /** The voice plugins found in the plugins folder. */
  private plugins: PluginList = noPlugins();
  /** Counts each time the voices that can be chosen change, so the Properties panel is built again with the new list. */
  private voiceEpoch = 0;

  /** Read the settings and look for plugins, and make the voices of whatever is set up choosable. A failure leaves only Kokoro's voices. */
  private async loadServices(): Promise<void> {
    try {
      this.settings = parseSettings(await backend.readSettings());
    } catch {
      this.settings = parseSettings("");
    }
    this.plugins = await backend.aiPlugins().catch(() => noPlugins());
    this.applyServices();
  }

  private applyServices(): void {
    setVoiceSources(buildVoiceSources(this.settings.ai, this.plugins.plugins));
    this.voiceEpoch++;
    if (this.model) this.renderProps();
  }

  /** The screen recorder (OpenScreen): choose what to record, record, and check that this computer is ready. */
  private async openRecorderDialog(): Promise<void> {
    const m = this.model;
    await openRecorder({
      backend, controller: this.recorder, dir: m?.dir ?? null, settings: this.recorderSettings,
      keepSettings: (s) => { this.recorderSettings = s; },
      editRecording: async (name, newestTake) => { if (m) await openRecordingEditor({ backend, dir: m.dir, name, newestTake: newestTake === true, placeVideo: (src, facts) => this.putVideoOnSlide(m, src, facts), writeCaptions: () => this.openCaptionsDialog(), describeScreen: (extras) => this.describeScreenOfVideo(m, extras) }); },
      makeSteps: async (name) => {
        if (!m) return;
        const said = await openSteps({
          backend, dir: m.dir, name,
          planLesson: (lesson, steps) => m.planStepLesson({ recording: name, lesson, steps, pictures: new Map() }),
          makeSlides: (lesson, steps, pictures) => m.makeStepSlides({ recording: name, lesson, steps, pictures, capturedAt: new Date().toISOString(), removeGone: true }).message,
        });
        if (said !== "") this.announce(said);
      },
      excludeCaptures: () => (m?.excludeFromPackage("captures") ? "The captures folder is now left out of the published course. Save the project to keep that." : null),
    });
    this.recorderBtn.focus();
  }

  /** Put a finished recording, already copied into the course, on the slide the author is on. It starts with no description and no captions: the author writes them. */
  private putVideoOnSlide(m: Model, src: string, facts?: { extras: Extra[]; lengthMs: number }): string {
    const o = m.addMedia("video", src);
    if (!o) return "There is no slide to put it on. Close this window, choose a slide, and make the video again.";
    if (facts) this.madeVideos.set(src, facts);
    return `The video ${src.split("/").pop() ?? ""} is on the slide. Before the course is ready it needs a description in the Alt text field and captions. Write the captions with the button below, or find them in the Properties panel. Both are listed in the Problems panel.`;
  }

  /** Put what a recording shows on its screen into the selected video's audio description, each with a voice. Says what to do about a missing speech engine. */
  private describeScreenOfVideo(m: Model, extras: Extra[]): string {
    const o = m.object;
    if (!o || o.type !== "video") return "Select the video on the slide first, then describe what is on the screen.";
    const r = m.describeScreen(o.id, extras);
    const engine = r.added > 0 && !this.narrationEngineReady ? " Kokoro, the speech engine on this computer, is not set up yet, so they have words but no sound until it is. Everything else keeps working." : "";
    return `${r.message}${engine}`;
  }

  /**
   * Write, time and check the captions of the video or audio clip that is selected, and make its transcript. Resolves with what to tell the author:
   * the Properties button speaks it through the editor; the recording editor, which is a dialog of its own, shows it in its own words.
   */
  private async openCaptionsDialog(): Promise<string> {
    const m = this.model;
    const o = m?.object;
    if (!m || !o || (o.type !== "video" && o.type !== "audio")) return "Select a video or audio clip on the slide first, then write its captions.";
    const src = String(o.content["src"] ?? "");
    const captions = typeof o.content["captions"] === "string" && o.content["captions"] !== "" ? String(o.content["captions"]) : null;
    const facts = this.madeVideos.get(src);
    const said = await openCaptions({
      backend, dir: m.dir, kind: o.type, mediaPath: src, captions,
      transcript: parseBody(String(o.content["transcript"] ?? "")),
      extras: facts?.extras ?? [], lengthMs: facts?.lengthMs ?? null,
      hint: hintFor(hintSourcesOf(m.project, m.slides)),
      apply: (path, transcript) => {
        m.setMediaCaptions(o.id, path);
        if (transcript !== null) m.setMediaTranscript(o.id, transcript);
      },
    });
    return said;
  }

  /** The toolbar button says when a recording is going on, and the editor speaks its news when the dialog is not open to do it. */
  private watchRecorder(): void {
    const short: Partial<Record<RecordPhase, string>> = { starting: "starting", countdown: "counting down", recording: "recording", paused: "paused", stopping: "stopping" };
    this.recorder.subscribe((session, say) => {
      const word = short[session.phase];
      this.recorderBtn.textContent = word ? `OpenScreen (${word})` : "OpenScreen";
      if (say.length > 0 && !recorderDialogOpen()) this.announce(say.join(" "));
    });
  }

  private async openAiServicesDialog(): Promise<void> {
    const result = await openAiServices({ backend, plugins: this.plugins, announce: (msg) => this.announce(msg) });
    if (result.settings) {
      this.settings = result.settings;
      this.plugins = result.plugins;
      this.applyServices();
    }
    this.aiBtn.focus();
  }

  /** Whether a service may be sent what the author is about to make with it. They are asked the first time, and a yes is kept. */
  private async askToSend(service: ServiceId, work: Work, detail?: { narrations?: number; characters?: number }): Promise<boolean> {
    if (isAllowed(this.settings.ai, service)) return true;
    const yes = await askPermission(backend, { service: serviceById(service), work, ...(detail ? { detail } : {}) });
    if (yes) {
      this.settings = parseSettings(await backend.readSettings().catch(() => ""));
      this.applyServices();
    }
    return yes;
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

  /**
   * The language of a script was changed. The language is part of what names the audio, so the audio would have to be made again; but for a voice that sounds the same in every
   * language (OpenAI's) the sound is the same, so the audio already made is kept under the new name instead, and nothing is paid for twice. Only audio that is there is copied.
   */
  private async keepAudioForNewLanguage(m: Model, before: Narration, lang: string): Promise<void> {
    if (!soundIgnoresLanguage(before.voice)) return;
    const from = keyOf(before);
    const to = keyOf({ ...before, lang });
    if (from === to || this.narrationCache.has(to) || !this.narrationCache.has(from)) return;
    const copied = await backend.reuseNarrationAudio(m.dir, from, to).catch(() => false);
    if (!copied || this.model !== m) return;
    await this.refreshNarration();
    this.announce("The audio you already had is kept for the new language, because this voice sounds the same in every language. Nothing needs to be made again, so nothing is charged.");
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

  /** The About window: the version, and where things are on this computer. */
  private async openAboutDialog(): Promise<void> {
    await openAbout({ backend, announce: (msg) => this.announce(msg) });
    this.aboutBtn.focus();
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
        ai: () => this.settings.ai, plugins: () => this.plugins.plugins,
        ask: (service, detail) => this.askToSend(service, "voice", detail),
        cache: () => this.narrationCache,
        refresh: () => this.refreshNarration(),
        announce: (msg) => this.announce(msg),
      })).goTo;
    } finally {
      this.working = false;
      this.updateChrome();
    }
    // A line of a scenario is in one situation; show that one, with the line's voice settings open.
    const home = goTo?.line ? S.lineOf(goTo.object.content as unknown as ScenarioContent, goTo.line.id) : undefined;
    if (goTo?.line && home) {
      this.scenarioSelect.set(goTo.object.id, home.node.id);
      this.scenarioOpen.add(goTo.line.id);
    }
    if (goTo && m.reveal(goTo.slideId, goTo.object.id)) {
      if (home) this.renderProps();
      this.announce(`Selected ${goTo.object.name}${goTo.item ? `, item ${goTo.item.title}` : goTo.cue ? `, audio description at ${clockText(goTo.cue.time)}` : goTo.line && home ? `, ${S.describeLine(home)}` : ""}. Its narration is in the Properties panel.`);
      document.getElementById(goTo.item ? `p-ix-${goTo.item.id}-narration-script` : goTo.cue ? `p-desc-${goTo.cue.id}-narration-script` : goTo.line ? `p-sc-line-${goTo.line.id}-narration-script` : "p-narration-script")?.focus();
    } else {
      this.narrationBtn.focus();
    }
  }

  /** Save slides, with what they need, as one file to give to someone else (see docs/slide-sets.md). */
  private async shareSlides(): Promise<void> {
    const m = this.model;
    if (!m) return;
    const choice = await askShare({ slides: m.slides.map((s) => ({ id: s.id, name: s.name })), current: m.slide?.id ?? "", author: m.project.meta.author });
    this.shareSlidesBtn.focus();
    if (!choice) return;
    try {
      const out = await backend.pickSetSave(`${choice.title.replace(/[^A-Za-z0-9 _-]+/g, "").trim() || "slides"}.osset`);
      if (!out) return;
      // The set is made from what is saved, so what is on the screen is saved first.
      if ((await this.writeChanges()) === null) return;
      const made = await backend.setMake(m.dir, { slides: choice.slides, title: choice.title, author: choice.author, licence: choice.licence, description: choice.description }, out);
      if (!made.ok) {
        this.announce(`The set could not be made. ${made.message}`);
        window.alert(`The set could not be made.

${made.message}`);
        return;
      }
      const v = made.value;
      this.announce(`Saved ${v.slides} ${v.slides === 1 ? "slide" : "slides"}${v.assets > 0 ? ` and ${v.assets} ${v.assets === 1 ? "file" : "files"}` : ""} as a set, ${sizeWords(v.bytes)}, in ${out}.${v.dropped > 0 ? ` ${v.dropped} ${v.dropped === 1 ? "way" : "ways"} to a slide you did not choose ${v.dropped === 1 ? "was" : "were"} left out.` : ""} Give that one file to someone else, who adds it with Add slides from a file.`);
    } catch (err) {
      this.announce(`The set could not be made. ${errorText(err)}`);
      window.alert(`The set could not be made.

${errorText(err)}`);
    }
  }

  /** Add slides someone gave you as one file, after the slide being edited. Everything is checked first. */
  private async addSlidesFromFile(): Promise<void> {
    const m = this.model;
    if (!m) return;
    let stage = "";
    try {
      const file = await backend.pickSetFile();
      if (!file) {
        this.slidesFromFileBtn.focus();
        return;
      }
      this.announce("Checking the set...");
      const read = await backend.setRead(file);
      if (!read.ok) {
        this.announce(`That set cannot be added. ${read.message}`);
        window.alert(`That set cannot be added.

${read.message}`);
        this.slidesFromFileBtn.focus();
        return;
      }
      stage = read.value.stage;
      const yes = await askAddSet(read.value, m.slide?.name ?? "");
      if (!yes) {
        this.slidesFromFileBtn.focus();
        return;
      }
      const pictures = new Map<string, string>();
      for (const a of read.value.assets) pictures.set(a.path, await backend.setUseAsset(stage, m.dir, a.path));
      const made = m.addSlideSet(read.value, pictures);
      if (typeof made === "string") {
        this.announce(`That set cannot be added. ${made}`);
        window.alert(`That set cannot be added.

${made}`);
        return;
      }
      this.announce(`Added ${read.value.set.title}: ${made.slides.length} ${made.slides.length === 1 ? "slide" : "slides"}, starting with ${made.slides[0]!.name}. ${made.notes.join(" ")} Press Control Z to undo it all at once.`);
      this.refocus(`slide:${made.slides[0]!.id}`);
    } catch (err) {
      this.announce(`That set could not be added. ${errorText(err)}`);
      window.alert(`That set could not be added.

${errorText(err)}`);
    } finally {
      if (stage) void backend.setDiscard(stage).catch(() => undefined);
    }
  }

  /** Put a person from the library on the slide: choose who, then which picture (their head and shoulders, or a pose). */
  /** Ask for a person from the library of people and which picture of them. Null if the author gave up. The picture is copied into the project, once. */
  private async libraryPicture(): Promise<{ src: string; size?: { w: number; h: number }; name: string; alt: string; credit: CreditEntry } | null> {
    const m = this.model;
    if (!m) return null;
    const chosen = await chooseFromLibrary({ backend, announce: (msg) => this.announce(msg) });
    if (!chosen) return null;
    const { pack, person } = chosen;
    const picked = await choosePosesDialog({ backend, pack, person: { ...person, poses: slidePictures(person) }, have: new Set(), single: true, announce: (msg) => this.announce(msg) });
    const pose = picked?.[0];
    if (!pose) return null;
    // A picture the course already has is used again, not copied again.
    const title = creditForSlidePicture(pack, person, pose, "").title;
    const src = m.pathOfCredit(title) ?? await backend.packUsePicture(m.dir, pack.source, pack.folder, pose.file, `${person.id}-${pose.id}`);
    const size = await this.measure(m.dir, src);
    return { src, ...(size ? { size } : {}), name: `${person.name}, ${pose.label.charAt(0).toLowerCase()}${pose.label.slice(1)}`, alt: pose.alt, credit: creditForSlidePicture(pack, person, pose, src) };
  }

  private async addPerson(): Promise<void> {
    const m = this.model;
    if (!m) return;
    try {
      const picture = await this.libraryPicture();
      this.addKind.focus();
      if (!picture) return;
      const o = m.addPackPicture(picture);
      if (o) {
        this.announce(`Added ${o.name}. The description from the library is its alt text: read it, and change it if it is not right, or mark the picture decorative if it only decorates.`);
        document.getElementById("p-alt")?.focus();
      }
    } catch (err) {
      this.announce(`Could not add the person. ${errorText(err)}`);
    }
  }

  /** Ask for one of the people in the project's cast, and which of their pictures. Null if the author gave up, or the cast has no pictures. */
  private async castPicture(): Promise<{ src: string; size?: { w: number; h: number }; name: string; alt: string; decorative: boolean } | null> {
    const m = this.model;
    if (!m) return null;
    const options = m.characters.flatMap((c) => [
      ...(c.picture ? [{ value: `${c.id}|`, label: c.name, description: c.role ? `${c.role}. Their own picture.` : "Their own picture.", src: c.picture.src, alt: c.picture.decorative ? "" : c.picture.alt, decorative: c.picture.decorative, name: c.name }] : []),
      ...(c.poses ?? []).map((pose) => ({ value: `${c.id}|${pose.id}`, label: `${c.name}, ${pose.label.charAt(0).toLowerCase()}${pose.label.slice(1)}`, description: "A pose.", src: pose.src, alt: `${c.name}, ${pose.label.charAt(0).toLowerCase()}${pose.label.slice(1)}`, decorative: false, name: `${c.name}, ${pose.label.charAt(0).toLowerCase()}${pose.label.slice(1)}` })),
    ]);
    if (options.length === 0) {
      this.announce("The cast has no pictures yet. Open Characters in the toolbar and give a person a picture, or choose a person from the library.");
      return null;
    }
    const value = await askChoice({
      heading: "A person from your cast", legend: "Which picture", confirm: "Use this picture",
      choices: options.map((o) => ({ value: o.value, label: o.label, description: o.description })),
    });
    const hit = options.find((o) => o.value === value);
    if (!hit) return null;
    const size = await this.measure(m.dir, hit.src);
    return { src: hit.src, ...(size ? { size } : {}), name: hit.name, alt: hit.alt, decorative: hit.decorative };
  }

  /** The buttons for a grey picture box from a layout: it is filled from a file, the cast or the library, and the picture takes its place. */
  private pictureBoxFields(m: Model, o: OSObject): HTMLElement[] {
    const chart = o.name === "Chart area";
    const done = (put: { name: string; decorative?: boolean } | null) => {
      if (!put) return;
      this.announce(put.decorative ? `${put.name} is in the box. It is marked as decoration.` : `${put.name} is in the box. Read its alt text in the Properties panel, and change it if it is not right.`);
      document.getElementById("p-alt")?.focus();
    };
    const guard = (f: () => Promise<void>) => () => void f().catch((err) => this.announce(`Could not put the picture in. ${errorText(err)}`));
    const fromComputer = guard(async () => {
      const picked = await backend.pickImage();
      if (!picked) return;
      const src = await backend.importImage(m.dir, picked);
      const size = await this.measure(m.dir, src);
      const stem = (src.split("/").pop() ?? src).replace(/\.[^.]*$/, "");
      const put = m.fillPictureBox(o.id, { src, ...(size ? { size } : {}), name: stem, alt: "" });
      if (put) this.announce(`${stem} is in the box. It needs alt text: describe it in the Alt text field, or mark it decorative.`);
      document.getElementById("p-alt")?.focus();
    });
    const fromCast = guard(async () => {
      const pic = await this.castPicture();
      if (!pic) return;
      const put = m.fillPictureBox(o.id, pic);
      done(put ? { name: put.name, decorative: pic.decorative } : null);
    });
    const fromLibrary = guard(async () => {
      const pic = await this.libraryPicture();
      if (!pic) return;
      const put = m.fillPictureBox(o.id, pic);
      done(put ? { name: put.name } : null);
    });
    return [h("fieldset", {}, h("legend", { text: chart ? "Chart picture box" : "Picture box" }),
      h("p", { class: "note", text: `This grey box marks where ${chart ? "a picture of a chart" : "a picture"} goes. Choose where the picture comes from: it takes the box's place and fills it as far as its own shape allows. The picture is described for a screen reader in its Alt text.` }),
      h("div", { class: "btn-row" },
        this.small("Picture from my computer...", "Choose a picture file to put in this box", fromComputer),
        this.small("A person from your cast...", "Put one of the people in the cast, with their pose, in this box", fromCast),
        this.small("A person from the library...", "Put a person from the library of people in this box", fromLibrary)))];
  }

  /** Choose a picture from the packs to put behind everything on a slide. */
  private async chooseBackground(slideId: string): Promise<void> {
    const m = this.model;
    if (!m) return;
    const chosen = await chooseBackgroundPicture({ backend, announce: (msg) => this.announce(msg) });
    document.getElementById("bg-pick")?.focus();
    if (!chosen) return;
    const { pack, background } = chosen;
    try {
      // A picture the course already has is used again, not copied again.
      const known = m.pathOfCredit(creditForBackground(pack, background, "").title);
      const src = known ?? await backend.packUsePicture(m.dir, pack.source, pack.folder, background.file, background.id);
      const color = await averageColourOf(await backend.packPictureUrl(pack.source, pack.folder, background.file));
      const msg = m.setBackgroundPicture(slideId, { src, color, credit: creditForBackground(pack, background, src) });
      if (msg) this.announce(`${background.name}. ${msg}${color ? " Text that follows the theme was changed to stay readable on it." : ""} Press Control Z to undo.`);
      document.getElementById("bg-pick")?.focus();
    } catch (err) {
      this.announce(`The background picture could not be added. ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** The cast: the people a scenario can show and a learner can choose to be. */
  private async openCast(): Promise<void> {
    const m = this.model;
    if (!m) return;
    const next = await editCast({
      current: m.characters,
      uses: castUse(m.slides),
      poseUses: poseUse(m.slides),
      choosePicture: async () => {
        const picked = await backend.pickImage();
        return picked ? backend.importImage(m.dir, picked) : null;
      },
      chooseFromLibrary: async () => {
        const chosen = await chooseFromLibrary({ backend, announce: (msg) => this.announce(msg) });
        if (!chosen) return null;
        const { pack, person } = chosen;
        // The picture is copied into the project at once, as a picture chosen from the computer is, so the cast dialog can show it.
        const src = await backend.packUsePicture(m.dir, pack.source, pack.folder, person.head, person.id);
        return { src, alt: person.alt, name: person.name, role: person.role, voice: person.voice, credit: creditForPicture(pack, person, src), library: { pack: pack.id, person: person.id } };
      },
      choosePoses: async (character) => {
        const link = character.library;
        if (!link) return null;
        const found = (await backend.packsList()).packs.find((x) => x.id === link.pack);
        const who = found?.people.find((x) => x.id === link.person);
        if (!found || !who) {
          this.announce(`The pack "${link.pack}" is not on this computer, so more poses of ${character.name || "this person"} cannot be added. The poses the course has are kept. Add the pack from the library to get more.`);
          return null;
        }
        if (who.poses.length === 0) {
          this.announce(`${who.name} has no poses in the pack "${found.title}".`);
          return null;
        }
        const chosen = await choosePosesDialog({ backend, pack: found, person: who, have: new Set((character.poses ?? []).map((x) => x.id)), announce: (msg) => this.announce(msg) });
        if (!chosen || chosen.length === 0) return null;
        const poses = [];
        const credits = [];
        for (const pose of chosen) {
          const src = await backend.packUsePicture(m.dir, found.source, found.folder, pose.file, `${character.id}-${pose.id}`);
          poses.push({ id: pose.id, label: pose.label, src });
          credits.push(creditForPicture(found, who, src));
        }
        return { poses, credits };
      },
      imageUrl: (src) => backend.assetUrl(m.dir, src),
      discardPicture: (src) => backend.deleteAsset(m.dir, src),
      announce: (msg) => this.announce(msg),
    });
    this.castBtn.focus();
    if (!next) return;
    const msg = m.setCharacters(next.cast, next.credits);
    this.announce(msg ? `${msg} Press Control Z to undo.` : "The cast is as it was.");
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
    const clips = m.mediaSources().filter((c) => c.id !== o.id);
    const afterWhat = t.appear === "narration" ? "its narration starts" : t.appear === "click" ? "the learner shows it" : onBase ? "the slide opens" : "its layer is shown";
    const onClip = t.appear === "media";
    const clipFields: HTMLElement[] = onClip ? [
      this.selectField("timing-media", "Follows", [
        ...(clips.some((c) => c.id === t.media) ? [] : [{ value: t.media ?? "", label: `${t.media ?? "?"} (not on this slide)`, disabled: true }]),
        ...clips.map((c) => ({ value: c.id, label: `${c.name} (${c.type})` })),
      ], t.media ?? "", (v) => done(m.setTiming(o.id, { media: v }))),
      h("div", { class: "btn-row" }, this.small("Choose by playing...", "Play the clip and press a button at the moment you want", () => void this.chooseMoment(m, o))),
      h("p", { class: "note", text: "What shows depends only on where the clip is. If the learner skips ahead or goes back, what belongs to that moment is there, and the rest is not. If the clip cannot play, everything that follows it shows. Pause timing pauses the clip too." }),
    ] : [];
    return [h("fieldset", {}, h("legend", { text: "Timing" }),
      h("p", { class: "note", text: "Leave this as it is for something that is there all the time. A learner can pause the timing and can show everything at once." }),
      this.selectField("timing-appear", "Appears", [
        { value: "time", label: onBase ? "After the slide opens" : "After its layer is shown" },
        { value: "narration", label: "After its narration starts", disabled: !o.narration },
        { value: "media", label: "When a video or audio clip reaches a time", disabled: clips.length === 0 && !onClip },
        { value: "click", label: "When the learner shows the next item" },
      ], t.appear, (v) => done(m.setTiming(o.id, { appear: v as typeof t.appear }))),
      ...(t.appear === "click" ? [
        this.field("timing-step", "Item number", String(t.step ?? 1), (v) => {
          const n = Number(v.trim());
          if (!Number.isInteger(n) || n < 1 || n > MAX_STEP) { this.announce(`Write the item number as a whole number from 1 to ${MAX_STEP}.`); this.fillValues(o); return; }
          done(m.setTiming(o.id, { step: n }));
        }, { number: true, describedBy: "timing-step-note" }),
        h("p", { id: "timing-step-note", class: "note", text: "The learner has a button, Show next item, that shows the items one at a time, in order of their number. Items with the same number show together. Show everything now shows them all. The slide does not move on until the learner does." }),
      ] : []),
      ...(clips.length === 0 && !onClip ? [h("p", { class: "note", text: "To make something appear at a moment in a video or audio clip, add a video or audio file to this slide first." })] : []),
      ...clipFields,
      this.field("timing-start", onClip ? "Seconds into the clip" : `Seconds after ${afterWhat}`, secondsText(t.start), (v) => {
        const ms = parseSeconds(v);
        if (ms === undefined) { this.announce("Write the time in seconds, for example 2 or 0.5, up to 3600."); this.fillValues(o); return; }
        done(m.setTiming(o.id, { start: ms ?? 0 }));
      }, { number: true }),
      this.field("timing-leave", onClip ? "Stays for, in seconds of the clip (blank: until the clip ends)" : "Stays for, in seconds (blank: until the slide ends)", t.visibleFor === null ? "" : secondsText(t.visibleFor), (v) => {
        const ms = parseSeconds(v);
        if (ms === undefined || ms === 0) { this.announce(`Write how long it stays in seconds, for example 6, or leave it blank to stay until the ${onClip ? "clip" : "slide"} ends.`); this.fillValues(o); return; }
        done(m.setTiming(o.id, { visibleFor: ms }));
      }, { number: true }),
      ...(onClip ? [] : [
        this.field("timing-until", "Goes away when the learner shows item number (blank: it does not)", t.until ? String(t.until.step) : "", (v) => {
          const text = v.trim();
          if (text === "") { done(m.setTiming(o.id, { until: undefined })); this.renderProps(); return; }
          const n = Number(text);
          if (!Number.isInteger(n) || n < 1 || n > MAX_STEP) { this.announce(`Write the item number as a whole number from 1 to ${MAX_STEP}, or leave it blank.`); this.fillValues(o); return; }
          done(m.setTiming(o.id, { until: { step: n, start: t.until?.start ?? 0 } }));
          this.renderProps();
        }, { number: true, describedBy: "timing-until-note" }),
        h("p", { id: "timing-until-note", class: "note", text: "For something that is there, or appears, and then goes when the learner presses Show next item. An item that only has things going away is still an item to press. This is how a PowerPoint exit effect that waits for a click comes across." }),
        ...(t.until ? [this.field("timing-until-start", "Seconds after that item", secondsText(t.until.start), (v) => {
          const ms = parseSeconds(v);
          if (ms === undefined || ms === null) { this.announce("Write the time in seconds, for example 0 or 1.5, up to 3600."); this.fillValues(o); return; }
          done(m.setTiming(o.id, { until: { step: t.until!.step, start: ms } }));
        }, { number: true })] : []),
      ]),
      h("p", { id: "timing-summary", class: "note", text: describeTiming(t, !onBase, m.mediaNameOf(t.media)) }),
      h("div", { class: "btn-row" }, this.small("Timing list...", "When everything on this slide appears and disappears", () => void this.openTimingDialog())))];
  }

  /** Showing a text one paragraph at a time: each paragraph is an item of Show next item, or already there, and can go away at an item. */
  private paragraphFields(m: Model, o: OSObject): HTMLElement[] {
    const words = paragraphsOf(String(o.content["html"] ?? ""));
    if (words.length === 0) return [];
    const parts = o.timing.paragraphs;
    const done = (r: { ok: boolean; message: string }) => { if (r.message) this.announce(r.message); this.renderProps(); };
    const itemField = (id: string, label: string, value: number | undefined, change: (n: number | undefined) => void): HTMLElement =>
      this.field(id, label, value === undefined ? "" : String(value), (v) => {
        const text = v.trim();
        if (text === "") { change(undefined); return; }
        const n = Number(text);
        if (!Number.isInteger(n) || n < 1 || n > MAX_STEP) { this.announce(`Write the item number as a whole number from 1 to ${MAX_STEP}, or leave it blank.`); this.renderProps(); return; }
        change(n);
      }, { number: true });
    // The same key for both of the button's states, so the keyboard stays on it when the panel is drawn again with the other one.
    const toggle = parts
      ? this.small("Show all the text together", "Take the timing of the paragraphs away", () => done(m.buildByParagraph(o.id, false)))
      : this.small("Show one paragraph at a time", `Make each of the ${words.length} paragraphs an item`, () => done(m.buildByParagraph(o.id, true)));
    toggle.dataset["key"] = "prop:paragraph-toggle";
    return [h("fieldset", { class: "paragraph-timing" }, h("legend", { text: "Paragraph by paragraph" }),
      h("p", { class: "note", text: parts
        ? "Each paragraph is its own item for the learner's Show next item button, in the order of its number. Paragraphs with the same number show together. The box itself is there from the start, and a paragraph that is not showing keeps its room, so the lines round it do not move."
        : "Show this text one paragraph at a time, each its own item for the learner's Show next item button, as a PowerPoint text does when it builds by paragraph. The box itself is there from the start." }),
      h("div", { class: "btn-row" }, toggle),
      ...(parts ? [
        ...words.map((w, i) => {
          const p = parts[i] ?? { appear: "time" as const, start: 0, visibleFor: null };
          return h("fieldset", { class: "paragraph-row" }, h("legend", { text: `Paragraph ${i + 1}: ${brief(w) || "(empty)"}` }),
            itemField(`para-step-${i}`, "Appears when the learner shows item number (blank: already there)", p.appear === "click" ? p.step : undefined,
              (n) => done(m.setParagraphTiming(o.id, i, n === undefined ? { appear: "time" } : { appear: "click", step: n }))),
            itemField(`para-until-${i}`, "Goes away when the learner shows item number (blank: it stays)", p.until?.step,
              (n) => done(m.setParagraphTiming(o.id, i, { until: n === undefined ? undefined : { step: n, start: p.until?.start ?? 0 } }))));
        }),
        h("p", { class: "note", text: describeTiming(o.timing, m.layer?.id !== m.slide?.baseLayer.id) }),
      ] : [])),
    ];
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
      ...this.autoStepsFields(m),
      h("div", { class: "btn-row" }, this.small("Timing list...", "When everything on this slide appears and disappears", () => void this.openTimingDialog())));
  }

  /**
   * How the slide arrives and how it leaves, listed together under one name so they are easy to find. Each is an effect to choose and, once one is chosen, how long it takes.
   * Shown when nothing is selected.
   */
  private slideTransitionFields(m: Model): HTMLElement {
    const slide = m.slide!;
    const t = slide.transition;
    const done = (r: { ok: boolean; message: string }) => { if (r.message) this.announce(r.message); this.renderProps(); };
    const part = (phase: Phase, label: string, secondsLabel: string): HTMLElement[] => {
      const now = t?.[phase];
      return [
        this.selectField(`slide-anim-${phase}`, label, effectChoices(phase), now?.effect ?? "none", (v) => {
          done(m.setSlideTransition(slide.id, phase, { effect: v as NonNullable<typeof now>["effect"] }));
          document.getElementById(`p-slide-anim-${phase}`)?.focus();
        }),
        ...(now ? [this.field(`slide-anim-${phase}-time`, secondsLabel, secondsText(now.duration), (v) => {
          const ms = parseSeconds(v);
          if (ms === undefined || ms === null) { this.announce(`Write how long it lasts in seconds, from ${MIN_DURATION / 1000} to ${MAX_DURATION / 1000}, for example 0.5.`); this.renderProps(); return; }
          done(m.setSlideTransition(slide.id, phase, { duration: ms }));
        }, { number: true })] : []),
      ];
    };
    return h("fieldset", {}, h("legend", { text: "Slide animation" }),
      h("p", { class: "note", text: "How this slide comes in when a learner arrives at it, and how it goes out when they leave it. Motion is a barrier for some learners, so effects are short, never repeat and never flash. A learner whose device asks for less motion sees none, and the course has a button to turn animation off." }),
      ...part("enter", "Slide animation (in)", "Seconds to come in"),
      ...part("exit", "Slide animation (out)", "Seconds to go out"),
      h("p", { id: "slide-animation-summary", class: "note", text: describeSlideTransition(t) }),
      h("div", { class: "btn-row" }, this.small("Preview slide animation", "Play how this slide comes in and goes out, on the canvas, without changing anything", () => void this.previewSlideAnimation(slide.transition))));
  }

  private async previewSlideAnimation(t: { enter?: Effect; exit?: Effect } | undefined): Promise<void> {
    if (this.previewing) return;
    this.previewing = true;
    try {
      const result = await this.canvas.previewSlideAnimation(t);
      this.announce(result === "played" ? "Preview finished." : result === "reduced"
        ? "Your device is set to reduce motion, so nothing moves in this preview. Learners with that setting will not see it move either."
        : "This slide has no animation to preview. Choose an effect first.");
    } finally {
      this.previewing = false;
    }
  }

  /** For a slide whose items wait for the learner (a PowerPoint click, or an object set to appear when the learner shows the next item): whether they come by themselves, and how fast. */
  private autoStepsFields(m: Model): HTMLElement[] {
    const slide = m.slide!;
    const steps = m.waitingSteps(slide.id);
    if (steps === 0) return [];
    const auto = slide.autoSteps ?? null;
    const box = this.tick("checkbox", "slide-auto-steps", "Show the items one after another by themselves", auto !== null, (on) => {
      const msg = m.setAutoSteps(slide.id, on ? { first: 2000, every: 3000 } : null);
      if (msg) this.announce(msg);
      this.renderProps();
      document.getElementById("p-slide-auto-steps")?.focus();
    });
    const out: HTMLElement[] = [
      h("div", { class: "field check" }, box, h("label", { for: "p-slide-auto-steps", text: "Show the items one after another by themselves" })),
      h("p", { id: "slide-auto-note", class: "note", text: `This slide has ${steps === 1 ? "1 item" : `${steps} items`} that wait for the learner to press Show next item (PowerPoint's clicks). Tick this to have them come one after another instead. The learner can still pause, press Show next item to bring the next one at once, or show everything.` }),
    ];
    box.setAttribute("aria-describedby", "slide-auto-note");
    if (auto) {
      const set = (first: number, every: number) => { const msg = m.setAutoSteps(slide.id, { first, every }); if (msg) this.announce(msg); };
      out.push(
        this.field("slide-auto-first", "The first item comes after, in seconds", secondsText(auto.first), (v) => {
          const ms = parseSeconds(v);
          if (ms == null || ms > 600000) { this.announce("Write the time in seconds, for example 2 or 0.5, up to 600."); this.renderProps(); return; }
          set(ms, auto.every);
        }, { number: true }),
        this.field("slide-auto-every", "Then one every, in seconds", secondsText(auto.every), (v) => {
          const ms = parseSeconds(v);
          if (ms == null || ms < 500 || ms > 600000) { this.announce("Write the time in seconds, for example 3 or 1.5: at least 0.5, up to 600."); this.renderProps(); return; }
          set(auto.first, ms);
        }, { number: true }),
      );
    }
    return out;
  }

  /** Whether the course's Back and Next are shown on the slide being edited. Shown when nothing is selected. */
  private slideNavigationFields(m: Model): HTMLElement {
    const slide = m.slide!;
    const box = this.tick("checkbox", "slide-hide-nav", "Leave out Back and Next on this slide", slide.hideNavigation === true, (on) => { const msg = m.setHideNavigation(slide.id, on); if (msg) this.announce(msg); });
    return h("fieldset", {}, h("legend", { text: "Moving through the course" }),
      h("div", { class: "field check" }, box, h("label", { for: "p-slide-hide-nav", text: "Leave out Back and Next on this slide" })),
      h("p", { class: "note", text: "The learner then leaves this slide only through something on it, such as a Continue button or a tile on a game board. The games use this so players stay in the game, and keep Back and Next on the last slide. The Problems list warns if nothing on the slide goes anywhere." }));
  }

  /**
   * What is said on the slide being edited, in the order it plays, with the words ready to read and change: so the narration does not have to be hunted for through
   * the Narration window and the object that says it. Shown when nothing is selected. A slide with no narration offers one box, said by the object the PowerPoint import
   * would have chosen (its heading).
   */
  private slideNarrationFields(m: Model): HTMLElement {
    const slide = m.slide!;
    const items = m.narratedObjects().filter((n) => n.slideId === slide.id);
    const box = h("fieldset", { class: "slide-narration" }, h("legend", { text: "Narration on this slide" }));
    const more = h("div", { class: "btn-row" }, this.small("Narration...", "All the narration in the course, and making its audio", () => void this.openNarrationDialog()));
    if (items.length === 0) {
      const target = m.narrationTarget(slide.id);
      box.append(h("p", { id: "slide-narration-note", class: "note", text: target
        ? `Nothing on this slide is narrated yet. Write what the learner should hear when it opens, and ${target.name} says it. It plays in reading order, and the captions and the transcript come from these words.`
        : "Nothing on this slide is narrated, and everything on it is decoration, so there is nothing to say it yet. Add a text, then write its narration." }));
      if (target) {
        box.append(this.stacked(this.field("slide-narration-new", "Narration script", "", (v) => {
          const msg = m.setNarrationScript(target.id, v);
          if (msg) this.announce(msg);
        }, { area: true, rows: 6, describedBy: "slide-narration-note" })));
      }
      box.append(more);
      return box;
    }
    box.append(h("p", { id: "slide-narration-note", class: "note", text: `What the learner hears on this slide, in the order it plays${items.length > 1 ? ` (${items.length} parts)` : ""}. Read it and change the words here; each is said by the object named. The captions and the transcript come from these words. To make the audio, use the Narration button.` }));
    if (items.length > 1) {
      const missing = items.filter((n) => audioStatus(n.narration, this.narrationCache).state === "missing");
      const running = this.making !== null && missing.some((n) => this.making!.keys.includes(n.key));
      const line = h("p", { class: `audio-state ${running ? "audio-making" : missing.length === 0 ? "audio-ok" : "audio-missing"}`, id: "slide-narration-audio-state" });
      if (running) { line.dataset["making"] = "1"; line.textContent = this.making!.text; }
      else line.append(h("span", { class: "audio-mark", "aria-hidden": "true", text: missing.length === 0 ? "\u2713" : "!" }), ` ${items.length - missing.length} of ${items.length} parts have audio`);
      const all = running ? this.small("Cancel", "Stop making the audio. What is finished is kept", () => { void backend.cancelJob().catch(() => false); this.announce("Cancelling."); }, "Cancel making audio")
        : missing.length > 0 ? this.small(`Make the missing audio (${missing.length})`, "Make the audio for the parts of this slide that have none", () => void this.makeAudioFor(missing.map((n) => n.key)), `Make the ${missing.length} missing audio files for this slide`)
        : null;
      if (all) all.dataset["key"] = "prop:slide-narration-audio-all";
      box.append(h("div", { class: "audio-row" }, line, ...(all ? [h("div", { class: "btn-row" }, all)] : [])));
    }
    items.forEach((n, i) => {
      const name = narratedName(n, slide.baseLayer.id);
      const part = h("fieldset", { class: "slide-narration-part" }, h("legend", { text: items.length > 1 ? `${i + 1}. ${name}` : `Said by ${name}` }),
        ...this.narrationControls(m, n.key, n.narration, {
          prefix: `slide-narration-${i + 1}`,
          note: `This narration belongs to ${name}.`,
          audioLabel: `Narration audio of ${name}`,
          rows: 8,
        }));
      const go = this.small("Go to " + n.object.name, `Select ${name}, to change anything else about it`, () => {
        if (m.reveal(n.slideId, n.object.id)) this.announce(`Selected ${n.object.name}.`);
      }, `Go to ${name}`);
      part.append(h("div", { class: "btn-row" }, go));
      box.append(part);
    });
    box.append(more);
    return box;
  }

  /** What the selected object says, in which voice, and how to listen to it. */
  private narrationFields(m: Model, o: OSObject): HTMLElement[] {
    const n = (o.narration as Narration | null) ?? null;
    // An object with no narration of its own, on a slide that is narrated by another: say where it is, so an empty box is not taken for "no narration here".
    const elsewhere = n === null && m.slide ? m.narratedObjects().filter((x) => x.slideId === m.slide!.id && x.object.id !== o.id) : [];
    const pointer: HTMLElement[] = elsewhere.length === 0 ? [] : [
      h("p", { class: "note", text: `This object says nothing. This slide's narration is said by ${[...new Set(elsewhere.map((x) => x.object.name))].join(", ")}.` }),
      h("div", { class: "btn-row" }, this.small(`Go to ${elsewhere[0]!.object.name}`, "Select the object that says this slide's narration", () => {
        if (m.reveal(elsewhere[0]!.slideId, elsewhere[0]!.object.id)) this.announce(`Selected ${elsewhere[0]!.object.name}. Its narration is in the Properties panel.`);
        document.getElementById("p-narration-script")?.focus();
      })),
    ];
    return [h("fieldset", {}, h("legend", { text: "Narration" }), ...pointer,
      ...this.narrationControls(m, o.id, n, {
        prefix: "narration",
        note: "What the learner hears when this object's slide opens, in reading order. The captions and the transcript come from these words, so they always match. Leave it blank for no narration.",
        audioLabel: "Narration audio for this object",
        rows: 8,
        ...(o.type === "download" ? { extra: [this.small("Use the description as narration", "Write the narration from this file's name, description and how to download it", () => {
          const msg = m.narrateDownloadFromText(o.id);
          if (msg) this.announce(msg);
        })] } : {}),
        ...(o.type === "quizQuestion" ? { extra: [this.small("Write the narration from the question", "Write the narration from what this question shows: what to do, and what there is to choose from", () => {
          const msg = m.narrateQuestionFromText(o.id);
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
    if (n) parts.push(this.audioRow(m, key, n, spec.prefix, spec.audioLabel));
    if (n) {
      const traits = voiceTraits(n.voice);
      const voice = h("select", { id: `p-${prefix}-voice`, "aria-describedby": `${prefix}-voice-note` },
        ...(isKnownVoice(n.voice) ? [] : [h("option", { value: n.voice, text: `${n.voice} (not an available voice)` })]),
        ...voiceGroups().map((g) => h("optgroup", { label: g.group }, ...g.voices.map((v) => h("option", { value: v.id, text: v.label })))));
      voice.value = n.voice;
      voice.dataset["key"] = `prop:${prefix}-voice`;
      voice.addEventListener("change", () => { const msg = m.setNarrationVoice(key, voice.value); if (msg) this.announce(msg); });
      parts.push(h("div", { class: "field" }, h("label", { for: `p-${prefix}-voice`, text: "Voice" }), voice));
      if (traits.known) parts.push(h("div", { class: "btn-row" }, this.hearButton(n.voice, n.lang, prefix)), h("p", { id: `${prefix}-hear-note`, class: "note", text: sampleNote(traits) }));
      parts.push(h("p", { id: `${prefix}-voice-note`, class: "note", text: voiceNote(traits) }));
      parts.push(...[...voiceLimits(traits), disclosureNote(traits, m.project.credits)].filter((t) => t !== "").map((t) => h("p", { class: "note", text: t })));
      if (traits.multilingual) {
        const lang = h("select", { id: `p-${prefix}-lang` }, ...languageOptions(n.lang).map((l) => h("option", { value: l.lang, text: l.name })));
        lang.value = n.lang;
        lang.dataset["key"] = `prop:${prefix}-lang`;
        lang.addEventListener("change", () => {
          const msg = m.setNarrationLang(key, lang.value);
          if (!msg) return;
          this.announce(msg);
          void this.keepAudioForNewLanguage(m, n, lang.value);
        });
        parts.push(h("div", { class: "field" }, h("label", { for: `p-${prefix}-lang`, text: "Language of the script" }), lang));
      }
      parts.push(this.field(`${prefix}-speed`, "Speed (1 is normal)", n.speed, (v) => {
        const r = m.setNarrationSpeed(key, Number(v));
        if (!r.ok) { this.announce(r.message); const o = m.object; if (o) this.fillValues(o); } else if (r.message) this.announce(r.message);
      }, { number: true }));
      if (traits.pronunciations || n.pronunciations.length > 0) parts.push(this.pronunciationFields(m, key, n, prefix === "narration" ? "pron" : `${prefix}-pron`, traits.pronunciations));
    }
    return parts;
  }

  /** The audio being made from the Properties panel, if any: the narrations it is for, and the sentence about how far it has got. */
  private making: { keys: string[]; text: string } | null = null;

  /**
   * Whether this script has audio, in a few words and a mark, with the one button that fits: make it, listen to it, cancel making it, or (when the voice is not
   * installed) go and set the voice up. It sits right under the words, so the author does not have to open the Narration window to know.
   */
  private audioRow(m: Model, key: string, n: Narration, prefix: string, label: string): HTMLElement {
    const state = audioStatus(n, this.narrationCache);
    const running = this.making?.keys.includes(key) ?? false;
    const av = availability(n, { ai: this.settings.ai, kokoro: this.narrationEngineReady, plugins: this.plugins.plugins });
    const holder = h("div", { class: "listen" });
    const text = h("p", { class: `audio-state ${running ? "audio-making" : state.state === "ready" ? "audio-ok" : "audio-missing"}`, id: `${prefix}-audio-state` });
    if (running) {
      text.dataset["making"] = "1";
      text.textContent = this.making!.text;
    } else {
      text.append(h("span", { class: "audio-mark", "aria-hidden": "true", text: state.state === "ready" ? "\u2713" : "!" }), ` ${audioRowText(state)}`);
    }
    let act: HTMLButtonElement;
    let why: HTMLElement | null = null;
    if (running) {
      act = this.small("Cancel", "Stop making the audio. What is finished is kept", () => { void backend.cancelJob().catch(() => false); this.announce("Cancelling."); }, "Cancel making audio");
    } else if (state.state === "ready") {
      act = this.small("Listen to the audio", "Play the audio made for this script", () => void this.listen(n, holder, label));
    } else if (av.state === "blocked" && engineOf(n.voice) === "kokoro") {
      act = this.small("Set up the narration voice...", "The narration voice is not installed on this computer: set it up in the Narration window", () => void this.openNarrationDialog());
      why = h("p", { class: "note", id: `${prefix}-audio-why`, text: "This voice is made on this computer, and the narration voice is not installed yet." });
      act.setAttribute("aria-describedby", `${prefix}-audio-why`);
    } else {
      act = this.small("Make audio", "Make the audio for this script", () => void this.makeAudioFor([key]), "Make audio for this script");
      if (av.state === "blocked") {
        act.setAttribute("aria-disabled", "true");
        why = h("p", { class: "note", id: `${prefix}-audio-why`, text: av.reason });
        act.setAttribute("aria-describedby", `${prefix}-audio-why`);
        act.addEventListener("click", () => this.announce(av.reason));
      }
    }
    act.dataset["key"] = `prop:${prefix}-audio-act`;
    return h("div", { class: "audio-row" }, text, h("div", { class: "btn-row" }, act), ...(why ? [why] : []), ...(running ? [] : [h("p", { class: "note", text: audioRowNote(state) })]), holder);
  }

  /** Put the sentence about how far the making has got into the places that show it, without redrawing the panel (a redraw would take the author's place in a box). */
  private paintMaking(): void {
    for (const el of Array.from(this.propsBody.querySelectorAll<HTMLElement>("[data-making]"))) el.textContent = this.making?.text ?? "";
  }

  /** Make the audio for these narrations, here in the Properties panel: the same work as the Narration window, one narration or the slide's missing ones. */
  private async makeAudioFor(keys: string[]): Promise<void> {
    const m = this.model;
    if (!m || this.working || this.making) return;
    this.working = true;
    this.making = { keys, text: "" };
    this.updateChrome();
    const outcome = await makeAudio(
      {
        model: m, backend, ai: () => this.settings.ai, plugins: () => this.plugins.plugins, kokoro: () => this.narrationEngineReady,
        ask: (service, detail) => this.askToSend(service, "voice", detail), cache: () => this.narrationCache, refresh: () => this.refreshNarration(),
      },
      keys,
      {
        started: ({ todo, text }) => {
          // Only what is really being made shows as making; what was left out (a service not allowed, a voice not set up) shows as it was.
          this.making = { keys: todo.map((t) => t.key), text };
          this.renderProps();
          this.announce(text);
        },
        progress: (view) => { if (this.making) { this.making.text = view.text; this.paintMaking(); } },
        milestone: (text) => this.announce(text),
      },
    );
    this.making = null;
    this.working = false;
    this.updateChrome();
    this.renderProps();
    // For a script or a slide, what was made is the news; the whole course's count (which may be long) is for the Narration window.
    this.announce(outcome.state === "done" && !outcome.message.includes("left out") ? `Made the audio for ${outcome.made} ${outcome.made === 1 ? "narration" : "narrations"}.` : outcome.message);
  }

  // ---- hearing a voice before choosing it

  /** The sample being made or played, if any. Only one at a time, because making one uses the same slot as a preview or making audio. */
  private hearing: { state: "making" | "playing"; voice: string; audio?: HTMLAudioElement; url?: string } | null = null;

  private hearingState(voice: string): SampleState {
    return this.hearing && this.hearing.voice === voice ? this.hearing.state : "idle";
  }

  /** The button that plays a short sample of the voice shown beside it. It also cancels the making and stops the playing, so the keyboard stays on it. */
  private hearButton(voice: string, lang: string, prefix: string): HTMLButtonElement {
    const view = sampleButton(this.hearingState(voice));
    const b = this.small(view.label, view.title, () => void this.hearVoice(voice, lang));
    b.classList.add("hear-voice");
    b.dataset["voice"] = voice;
    b.dataset["key"] = `prop:${prefix}-hear`;
    b.setAttribute("aria-describedby", `${prefix}-hear-note`);
    return b;
  }

  /** Every Hear button shows what pressing it does now. They are found rather than remembered, because the Properties panel is redrawn from time to time. */
  private paintHearButtons(): void {
    for (const b of Array.from(this.root.querySelectorAll<HTMLButtonElement>("button.hear-voice"))) {
      const view = sampleButton(this.hearingState(b.dataset["voice"] ?? ""));
      b.textContent = view.label;
      b.title = view.title;
    }
  }

  private stopSample(): void {
    const was = this.hearing;
    this.hearing = null;
    was?.audio?.pause();
    if (was?.url) URL.revokeObjectURL(was.url);
    this.paintHearButtons();
  }

  private async hearVoice(voice: string, lang: string): Promise<void> {
    const current = this.hearing;
    if (current?.state === "making") {
      if (current.voice === voice) await backend.cancelJob().catch(() => false); // the answer comes back as "cancelled" and is announced below
      else this.announce("Another sample is being made. Wait for it, or cancel it first.");
      return;
    }
    if (current?.state === "playing") {
      this.stopSample();
      if (current.voice === voice) {
        this.announce("Stopped.");
        return;
      }
    }
    const making = { state: "making" as const, voice };
    this.hearing = making;
    this.paintHearButtons();
    this.announce(sampleMakingText(voice));
    let answer: SampleAnswer;
    try {
      answer = await backend.voiceSample(voice, lang);
    } catch (err) {
      answer = { ok: false, message: errorText(err) };
    }
    if (this.hearing !== making) return;
    if (!answer.ok) {
      this.hearing = null;
      this.paintHearButtons();
      this.announce(answer.cancelled ? "Cancelled." : `No sample. ${answer.message}`);
      return;
    }
    const url = URL.createObjectURL(new Blob([answer.wav], { type: "audio/wav" }));
    const audio = new Audio(url);
    const playing = { state: "playing" as const, voice, audio, url };
    this.hearing = playing;
    audio.addEventListener("ended", () => { if (this.hearing === playing) this.stopSample(); });
    this.paintHearButtons();
    try {
      await audio.play();
      this.announce(samplePlayingText(voice));
    } catch {
      if (this.hearing === playing) this.stopSample();
      this.announce("The sample is ready, but the sound could not be started. Press the button to try again.");
    }
  }

  /** A field whose box takes the full width, with its label above it. */
  private stacked(f: HTMLElement): HTMLElement {
    f.classList.add("stack");
    return f;
  }

  /** Words the voice gets wrong, taught in IPA. `pron` is the start of the ids of this set of boxes. */
  private pronunciationFields(m: Model, key: string, n: Narration, pron: string, active = true): HTMLElement {
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
      ...(active ? [] : [h("p", { class: "note", text: "The voice you chose cannot use these, so they are ignored. They stay here in case you choose a voice that can." })]),
      ...rows,
      ...(active ? [h("div", { class: "pron-row" }, newTerm, newIpa, add)] : []));
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

  private async addSlide(only?: "games" | "quizzes"): Promise<void> {
    const m = this.model;
    if (!m) return;
    const layout = await askLayout(only === "games"
      ? { heading: "Add a game", confirm: "Add game", initial: GAME_PREFIX + (GAME_SETS[0]?.id ?? ""), theme: m.theme, templates: true, only,
          note: "A ready-made game adds several slides at once, with the variables and rules that make it play. The next window asks how big it should be, and a quiz board or a prize ladder can be filled from a spreadsheet of your questions." }
      : { heading: "Add a slide", confirm: "Add slide", initial: this.lastLayout, theme: m.theme, templates: true,
          note: "A layout places text. A ready-made lesson slide also brings the parts a lesson needs, such as Next and Back buttons that are already wired, a question with its feedback, or a story to write. A quiz or a test bank is made from a spreadsheet of your questions. A ready-made game adds several slides at once, with the variables and rules that make it play. The buttons at the top go straight to a group." });
    if (!layout) return;
    if (only !== "games") this.lastLayout = layout;
    if (layout.startsWith(GAME_PREFIX)) {
      await this.addGame(layout.slice(GAME_PREFIX.length));
      return;
    }
    if (layout.startsWith(QUIZ_PREFIX)) {
      await this.addQuestionsFromFile(layout.slice(QUIZ_PREFIX.length) === "bank" ? "bank" : "quiz");
      return;
    }
    const template = layout.startsWith(TEMPLATE_PREFIX) ? m.addTemplateSlide(layout.slice(TEMPLATE_PREFIX.length)) : null;
    const s = template ?? m.addSlide(layout.startsWith(TEMPLATE_PREFIX) ? "blank" : layout);
    this.announce(`Added ${s.name}. It is slide ${m.slides.findIndex((x) => x.id === s.id) + 1} of ${m.slides.length}.${template ? " Its buttons are already wired. Replace the placeholder words with your own." : ""}`);
    this.refocus(`slide:${s.id}`);
  }

  /** Ask how big the game should be, then add its slides after the one being edited. One step for Undo. */
  private async addGame(id: string): Promise<void> {
    const m = this.model;
    const set = gameById(id);
    if (!m || !set) return;
    const choice = await askGame(set, {
      pickFile: () => backend.pickQuestionFile(),
      readFile: (path) => backend.questionFileRead(path),
      pickTemplateSave: (name) => backend.pickQuestionTemplateSave(name),
      writeTemplate: (dest, text) => backend.questionTemplateWrite(dest, text),
    });
    if (!choice) return;
    const made = m.addGameSet(set.id, choice.options, choice.content);
    if (!made) return;
    const first = made.slides[0]!;
    this.announce(`Added ${set.label}: ${made.slides.length} slides, starting with ${first.name}. ${made.notes.join(" ")} Press Control Z to undo it all at once.`);
    this.refocus(`slide:${first.id}`);
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

  private duplicateSlide(): void {
    const m = this.model;
    if (!m) return;
    const msg = m.duplicateSlide();
    if (msg) this.announce(`${msg} Press Control Z to undo.`);
    this.refocus(`slide:${m.sel.slideId}`);
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

  private duplicateLayer(): void {
    const msg = this.model?.duplicateLayer();
    if (msg) this.announce(`${msg} Press Control Z to undo.`);
  }

  private moveLayer(dir: -1 | 1): void {
    const m = this.model;
    if (!m) return;
    const msg = m.moveLayer(m.sel.layerId, dir);
    if (msg) this.announce(msg);
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
      if (group === "button") {
        const kind = await askChoice({
          heading: "Add a button", legend: "Kind of button", confirm: "Add button",
          choices: [
            { value: "plain", label: "Button", description: "A button with words you write. Say what it does in the Rules box.", group: "Your own" },
            ...NAVIGATION_BUTTONS.map((b) => ({ value: b.id, label: b.label, description: b.description, group: "Ready-made, already wired" })),
          ],
        });
        this.addKind.focus();
        if (!kind) return;
        if (kind === "plain") {
          const o = m.addObject("button");
          if (o) this.announce(`Added ${o.name}, number ${o.accessibility.tabOrder ?? 0} in reading order. Write its words in the Properties panel, and say what it does in the Rules box.`);
        } else {
          const o = m.addNavigationButton(kind);
          if (o) this.announce(`Added the ${o.name} button, number ${o.accessibility.tabOrder ?? 0} in reading order. Its rule is already written, and it works from the keyboard. Move it where you want it; you can change its words, look and icon in the Properties panel.`);
        }
        return;
      }
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
            { value: "person", label: "A person from the library", description: "A picture of a person from a character pack, waving, thinking, presenting. Its description becomes the alt text, for you to check.", group: "Assets" },
            { value: "icon", label: "Icon", description: "A simple line picture from the Lucide set, drawn in a colour you choose. Search by what it means.", group: "Assets" },
            { value: "library", label: "Browse the assets", description: "The project's own files, and stock images to add to it.", group: "Assets" },
          ],
        });
        this.addKind.focus();
        if (!pick) return;
        if (pick === "image") return this.addImage();
        if (pick === "video" || pick === "audio") return this.addMediaFile(pick);
        if (pick === "download") return this.addDownloadFile();
        if (pick === "library") return this.openAssetsDialog();
        if (pick === "icon") return this.addIcon();
        if (pick === "person") return this.addPerson();
        return this.addEmbedVideo(pick as "youtube" | "vimeo");
      }
      if (group === "question") {
        const picked = await askChoice({
          heading: "Add a question, input or survey", legend: "Kind", confirm: "Add",
          choices: [
            ...QUIZ_KINDS.map((k) => ({ value: `quiz:${k.id}`, label: k.label, description: k.description, group: `Quiz questions: ${k.group.toLowerCase()}` })),
            ...INPUTS.map((i) => ({ value: `input:${i.id}`, label: i.label, description: i.description, group: i.group === "Inputs" ? "Inputs that save a choice" : "Surveys" })),
          ],
        });
        this.addKind.focus();
        if (!picked) return;
        if (picked === "input:character" && m.characters.length < 2) {
          this.announce("A choice of character needs at least two people in the cast. Open Characters in the toolbar to add them, then add this again.");
          this.castBtn.focus();
          return;
        }
        if (picked.startsWith("input:")) {
          const made = m.addInput(picked.slice(6));
          if (made) this.announce(`Added ${made.name} with its own variables. Write the prompt and the options in the Properties panel.`);
        } else if (picked === "quiz:hotspot") {
          await this.addHotspotQuestion();
        } else {
          const quiz = m.addQuiz(picked.slice(5) as QuizType);
          const kind = quizKind(picked.slice(5));
          if (quiz && kind) this.announce(`Added a ${kind.label.toLowerCase()} question with two feedback layers. Write the question in the heading above it, set its answers in the Properties panel, and write the feedback. One question per slide works best.`);
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
          heading: "Add an interaction, scenario or timer", legend: "Interaction", confirm: "Add",
          choices: [
            ...INTERACTIONS.map((i) => ({ value: i.id, label: i.label, description: i.description, group: i.group, preview: interactionPreview(i.kind, i.orientation) })),
            { value: "timer", label: "Timer", description: "A countdown clock for the slide or its layer. The learner can always add time or turn it off. A rule on the timer says what happens when the time runs out, such as showing a layer, going to another slide or changing a variable.", group: "Time limits" },
            { value: "scenario", label: "Branching scenario", description: "A story the learner steps through by choosing what to do. Each choice leads to another situation, until an ending. Choices can add to a number, and people from the cast can speak.", group: "Stories" },
          ],
        });
        this.addKind.focus();
        if (!pickedInteraction) return;
        if (pickedInteraction === "timer") {
          const made = m.addTimer();
          if (made) this.announce(`Added a timer of 30 seconds, number ${made.accessibility.tabOrder ?? 0} in reading order. It starts when its layer is shown. In the Rules box, add a rule that happens when the time runs out, and set the time in the Properties panel.`);
          return;
        }
        if (pickedInteraction === "scenario") {
          const made = m.addScenario();
          if (made) this.announce(`Added a scenario with a small story to write over: one situation with two choices, each leading to its own ending. Give the scenario a name in the Alt text field, which a screen reader reads, then write the story in the Properties panel.`);
          return;
        }
        const made = m.addInteraction(pickedInteraction);
        if (made && (made.content as unknown as InteractionContent).kind === "labeledGraphic") {
          this.announce(`Added ${made.name} with three markers. Choose the picture they sit on.`);
          await this.chooseGraphic(made.id);
          return;
        }
        if (made) this.announce(`Added ${made.name} with three items. Write each item's title and text in the Properties panel, and give the group a name that says what it is about.`);
        return;
      }
      const picked = await askChoice(group === "shape"
        ? {
          heading: "Add a shape or a bubble", legend: "Shape or bubble", confirm: "Add",
          choices: [
            ...groupOptions("shape").map((c) => ({ ...c, group: "Shapes", preview: shapePreview(c.value.slice(6)) })),
            { value: "bubble:text-speech", label: "Speech bubble, with words", description: "A speech bubble you type in, to say what someone is saying.", group: "Speech and thought bubbles", preview: bubblePreview("speech", true) },
            { value: "bubble:text-thought", label: "Thought bubble, with words", description: "A thought bubble you type in, to say what someone is thinking.", group: "Speech and thought bubbles", preview: bubblePreview("thought", true) },
            { value: "bubble:shape-speech", label: "Speech bubble, empty", description: "A plain speech bubble with no words in it, to put your own words or a picture over.", group: "Speech and thought bubbles", preview: bubblePreview("speech", false) },
            { value: "bubble:shape-thought", label: "Thought bubble, empty", description: "A plain thought bubble with no words in it.", group: "Speech and thought bubbles", preview: bubblePreview("thought", false) },
          ],
        }
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
    if (choice.startsWith("bubble:")) {
      this.addBubble(m, choice);
      return;
    }
    const o = choice.startsWith("shape:") ? m.addObject("shape", { shape: choice.slice(6) }) : m.addObject(choice as "text" | "button" | "hotspot");
    if (o && o.type === "hotspot") {
      this.announce(`Added ${o.name}, number ${o.accessibility.tabOrder ?? 0} in reading order. Move it over the part of the picture to press, make it at least 24 by 24 pixels, and write its name in the Alt text field, for example "The Save button". Then add a rule for what pressing it does.`);
    } else if (o) {
      const n = o.accessibility.tabOrder ?? 0;
      this.announce(`Added ${o.name}${n >= 1 ? `, number ${n} in reading order` : ", decorative"}. Its properties are in the Properties panel.`);
    }
  }

  /** Add a speech or thought bubble, with words to type in or empty. */
  private addBubble(m: Model, choice: string): void {
    const wanted = bubbleChoice(choice);
    if (!wanted) return;
    const { how, which } = wanted;
    const made = how === "text" ? m.addObject("text", { bubble: which }) : m.addObject("shape", { shape: which });
    if (!made) return;
    const n = made.accessibility.tabOrder ?? 0;
    const who = which === "speech" ? "speaking" : "thinking";
    this.announce(how === "text"
      ? `Added a ${which} bubble with words, number ${n} in reading order. Type what it says in the Text box in the Properties panel, and use the Tail setting to put the tail on the side of whoever is ${who}.`
      : `Added an empty ${which} bubble, decorative. Choose its fill and outline in the Properties panel, and use the Tail setting to put the tail on the side of whoever is ${who}.`);
  }

  /** A hotspot question is about a picture, so the author chooses it first. */
  private async addHotspotQuestion(): Promise<void> {
    const m = this.model;
    if (!m) return;
    try {
      const picked = await backend.pickImage();
      if (!picked) return;
      const src = await backend.importImage(m.dir, picked);
      const quiz = m.addQuiz("hotspot", { imageSrc: src });
      if (quiz) {
        this.announce("Added a hotspot question with two areas and two feedback layers. It needs a description of the picture, which a screen reader reads, and the areas need their places and labels. Write them in the Properties panel.");
        document.getElementById("p-hotspot-alt")?.focus();
      }
    } catch (err) {
      this.announce(`Could not add the hotspot question. ${errorText(err)}`);
      window.alert(`Could not add the hotspot question.\n\n${errorText(err)}`);
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
  private async placeImage(src: string, suggestion?: string, source: "service" | "prompt" = "service"): Promise<void> {
    const m = this.model;
    if (!m) return;
    const size = await this.measure(m.dir, src);
    const o = m.addObject("image", { imageSrc: src, size });
    if (o) {
      const tip = !suggestion ? ""
        : source === "prompt" ? ` You asked for: "${suggestion}". Describe what the picture actually shows, which may differ.`
        : ` The service describes it as: "${suggestion}". You can use that as a start.`;
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
  /** Bring slides in from a PowerPoint presentation, or bring slides brought in earlier up to date. */
  private async openPowerPointDialog(): Promise<void> {
    const m = this.model;
    if (!m) return;
    const done = await openPowerPoint({
      model: m, savePicture: (name, bytes) => backend.saveDeckPicture(m.dir, name, bytes), announce: (msg) => this.announce(msg),
      canMakeAudio: async () => {
        await this.refreshNarration();
        // The voice the course already uses, or the usual one for a course with no narration yet.
        const voice = m.narratedObjects().at(-1)?.narration ?? newNarration("");
        return availability(voice, { ai: this.settings.ai, kokoro: this.narrationEngineReady, plugins: this.plugins.plugins }).state !== "blocked";
      },
    });
    if (done.openNarration) await this.openNarrationDialog();
    else this.pptxBtn.focus();
  }

  private async openAssetsDialog(tab?: "project" | "stock" | "settings"): Promise<void> {
    const m = this.model;
    if (!m) return;
    await openAssets({
      model: m, backend, tab,
      announce: (msg) => this.announce(msg),
      insertImage: (path, suggestion, source) => this.placeImage(path, suggestion, source),
      askToSend: (service, work) => this.askToSend(service, work),
      openAiServices: () => this.openAiServicesDialog(),
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
    const write = this.small("Write captions...", "Write, time and check the captions here, or start from a script or a caption file", () => void this.openCaptionsDialog().then((said) => {
      if (said !== "") this.announce(said);
      document.getElementById("p-write-captions")?.focus();
    }));
    write.id = "p-write-captions";
    const choose = this.small("Choose captions file...", "Choose a .vtt captions file from your computer", () => void this.chooseCaptions(o.id));
    const remove = this.small("Remove captions", "Stop using the captions file", () => { const msg = m.setMediaCaptions(o.id, null); if (msg) this.announce(msg); });
    this.setEnabled(remove, captions !== "");
    const transcript = parseBody(String(o.content["transcript"] ?? ""));
    return [h("fieldset", {}, h("legend", { text: o.type === "video" ? "Video" : "Audio" }),
      h("p", { class: "note", text: `File: ${String(o.content["src"] ?? "")}` }),
      h("p", { class: "note", id: "caption-state", text: captions ? `Captions: ${captions}` : "Captions: none" }),
      h("div", { class: "btn-row" }, write, choose, remove),
      transcript === null
        ? h("p", { class: "note", text: "This transcript has formatting the editor cannot edit yet, so it is left as it is." })
        : this.field("transcript", "Transcript (shown under the player)", transcript, (v) => { const msg = m.setMediaTranscript(o.id, v); if (msg) this.announce(msg); }, { area: true, rows: 5 }),
      h("p", { class: "note", text: o.type === "video"
        ? "A video needs a captions file (.vtt). A transcript is a good addition, but does not replace captions."
        : "An audio clip needs a captions file or a transcript, so someone who cannot hear it can read it." }))];
  }

  /** The audio description of a video: what the picture shows, when, written for reading and spoken for hearing. */
  private descriptionFields(m: Model, o: OSObject): HTMLElement[] {
    const cues = m.descriptionOf(o.id);
    const cards = cues.map((cue, i) => {
      const prefix = `desc-${cue.id}`;
      const pause = h("input", { id: `p-${prefix}-pause`, type: "checkbox", ...(cue.pause ? { checked: true } : {}) });
      pause.dataset["key"] = `prop:${prefix}-pause`;
      pause.addEventListener("change", () => { const r = m.updateDescription(o.id, cue.id, { pause: pause.checked }); if (r.message) this.announce(r.message); });
      const spoken = h("fieldset", {}, h("legend", { text: `Voice for description ${i + 1}` }),
        ...this.narrationControls(m, `${o.id}/${cue.id}`, (cue.narration as Narration | null) ?? null, {
          prefix: `${prefix}-narration`,
          note: "What the learner hears at that moment. A description that is only written can be read but not heard, and audio description is something a learner hears with the video (WCAG 2.2, 1.2.5). The words are yours to change, and they do not follow the description if you change that later.",
          audioLabel: `Audio for description ${i + 1}`,
          rows: 3,
          extra: [this.small("Use the description as the voice", "Write the voice's words from this description", () => {
            const msg = m.narrateDescriptionFromText(o.id, cue.id);
            this.announce(msg ?? "The voice already says what the description says.");
          }, `Use description ${i + 1} as its voice`)],
        }));
      return h("fieldset", {}, h("legend", { text: `Description ${i + 1} of ${cues.length}, at ${clockText(cue.time)}` }),
        this.field(`${prefix}-time`, "Seconds into the video", secondsText(cue.time), (v) => {
          const ms = parseSeconds(v);
          if (ms === undefined || ms === null) { this.announce("Write the time in seconds from the start of the video, for example 12 or 12.5."); this.renderProps(); return; }
          const r = m.updateDescription(o.id, cue.id, { time: ms });
          if (r.message) this.announce(r.message);
          if (!r.ok) this.renderProps();
        }, { number: true }),
        this.stacked(this.field(`${prefix}-text`, "What the picture shows", cue.text, (v) => {
          const r = m.updateDescription(o.id, cue.id, { text: v });
          if (r.message) this.announce(r.message);
          if (!r.ok) this.renderProps();
        }, { area: true, rows: 3 })),
        h("div", { class: "field check" }, pause, h("label", { for: `p-${prefix}-pause`, text: "Pause the video while this is spoken" })),
        spoken,
        h("div", { class: "btn-row" }, this.small("Delete description", "Delete this description", () => { const msg = m.deleteDescription(o.id, cue.id); if (msg) this.announce(`${msg}. Press Control Z to undo.`); }, `Delete description ${i + 1}`)));
    });
    const add = this.small("Add description", "Add a description at a time in the video", () => { const msg = m.addDescription(o.id); if (msg) this.announce(msg); });
    const voiceAll = this.small("Give every description a voice", "Give each description that has words and no voice a voice that says its words", () => {
      const r = m.narrateDescriptionsFromText(o.id);
      if (r.message) this.announce(r.message);
    });
    this.setEnabled(voiceAll, cues.some((c) => !c.narration && c.text.trim() !== ""));
    return [h("fieldset", {}, h("legend", { text: "Audio description" }),
      h("p", { class: "note", text: "For a learner who cannot see the video. Write what the picture shows that the sound does not say, at the time it matters, and give it a voice. The course then offers an Audio description button beside the video, where a learner can read the descriptions, listen to them, or play the video with each one spoken at its time. Without any description, there is no button. If everything important on screen is already said in the narration, no description is needed." }),
      h("div", { class: "btn-row" }, add, voiceAll),
      ...(cards.length ? cards : [h("p", { class: "note", text: "No descriptions yet." })]))];
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

  /** A timer: how long, the words above it, and the time the Add time button gives. Turn off is always there, so no learner is held to the clock. */
  private timerFields(m: Model, o: OSObject): HTMLElement[] {
    const c = timerContentOf(o);
    const say = (msg: string | null) => { if (msg) this.announce(msg); };
    return [h("fieldset", {}, h("legend", { text: "Timer" }),
      this.field("timer-seconds", "Seconds to count down (5 to 3600)", c.seconds, (v) => { say(m.setTimerSeconds(o.id, Number(v))); this.fillTimer(o); }, { number: true }),
      this.field("timer-label", "Words above the clock", c.label, (v) => { say(m.setTimerLabel(o.id, v)); this.fillTimer(o); }),
      this.field("timer-extend", "Seconds the Add time button gives (0 for no button)", c.extendBy, (v) => { say(m.setTimerExtend(o.id, Number(v))); this.fillTimer(o); }, { number: true, describedBy: "timer-extend-note" }),
      h("p", { id: "timer-extend-note", class: "note", text: "The Turn off the timer button is always there." }),
      h("p", { id: "timer-note", class: "note", text: "The timer starts when its layer is shown (when the slide opens, for the base layer). It always has a Turn off the timer button: a learner who turns it off has no timer on any later slide in that visit, and pausing the timing or choosing Show everything now holds or ends it too. A rule on the timer that happens when the time runs out says what follows. To stop it when a question is answered, add a rule to the question or its button that stops the timer. The clock is read on request; a screen reader is told at a minute, thirty seconds and ten seconds to go, and when time is added or up." }))];
  }

  private fillTimer(o: OSObject): void {
    const c = timerContentOf(o);
    const set = (id: string, v: string | number) => {
      const el = this.propsBody.querySelector<HTMLInputElement>(`#p-${id}`);
      if (el && document.activeElement !== el) el.value = String(v);
    };
    set("timer-seconds", c.seconds);
    set("timer-label", c.label);
    set("timer-extend", c.extendBy);
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
    const at = Math.min(...m.selected.map((x) => before.indexOf(x.id)));
    const msg = m.deleteSelected();
    if (!msg) return;
    if (!msg.startsWith("Deleted ")) {
      this.announce(msg);
      return;
    }
    this.announce(`${msg.endsWith(".") ? msg : `${msg}.`} Press Control Z to undo.`);
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
    if (!msg.startsWith("Cut ")) {
      this.announce(msg);
      return;
    }
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

  /** A click on an item in the Objects list: Shift extends a range, Ctrl adds or removes one, and a plain click chooses it alone. */
  private pickObject(id: string, e: MouseEvent): void {
    const m = this.model;
    if (!m) return;
    let msg: string | null = null;
    if (e.shiftKey) msg = m.selectRange(id);
    else if (e.ctrlKey || e.metaKey) msg = m.toggleSelected(id);
    else {
      m.selectObject(id);
      const picked = m.object;
      if (picked) msg = `Selected ${picked.name}, ${picked.type}.`;
    }
    if (msg) this.announce(msg);
  }

  private toggleLockObjects(): void {
    const m = this.model;
    if (!m?.object) {
      this.announce("Choose an object in the list first.");
      return;
    }
    const msg = m.toggleLock();
    if (msg) this.announce(`${msg} Press Control Z to undo.`);
  }

  private groupObjects(): void {
    const m = this.model;
    if (!m?.object) {
      this.announce("Choose two or more objects first. Shift and click adds an object to the selection.");
      return;
    }
    const msg = m.group();
    if (msg) this.announce(msg.startsWith("Grouped") ? `${msg} Press Control Z to undo.` : msg);
  }

  private ungroupObjects(): void {
    const m = this.model;
    if (!m?.object) {
      this.announce("Choose a grouped object first.");
      return;
    }
    const msg = m.ungroup();
    if (msg) this.announce(msg.startsWith("Ungrouped") ? `${msg} Press Control Z to undo.` : msg);
  }

  private selectGroupObjects(): void {
    const m = this.model;
    if (!m?.object) {
      this.announce("Choose a grouped object first.");
      return;
    }
    const msg = m.selectGroup();
    if (msg) this.announce(msg);
  }

  private selectAllObjects(): void {
    const m = this.model;
    if (!m) return;
    this.announce(m.selectAll());
  }

  private reorder(delta: -1 | 1): void {
    const o = this.model?.object;
    if (!o) {
      this.announce("Choose an object in the list first.");
      return;
    }
    if ((this.model?.selected.length ?? 0) > 1) {
      this.announce("Reading order is for one object at a time. Choose one object first.");
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
    this.setEnabled(this.translateBtn, !!m && !this.working);
    this.statusSave.textContent = !m ? "No project open" : m.dirty ? "Unsaved changes" : "All changes saved";
    const idx = m ? m.slides.findIndex((s) => s.id === m.sel.slideId) : -1;
    this.statusSlide.textContent = m ? `Slide ${idx + 1} of ${m.slides.length}` : "";
    const e = this.findings.filter((f) => f.severity === "error").length;
    const w = this.findings.length - e;
    this.statusProblems.textContent = m ? (this.checkFailure ? "Could not check" : this.summaryText(e, w)) : "";
    void backend.setTitle(m ? `${m.dirty ? "* " : ""}${m.project.meta.title} - OpenStage Author` : "OpenStage Author");
    const hasObject = !!m?.object;
    // Reading order is one object's place in the order, so it is for one object at a time.
    const one = m?.selected.length === 1;
    this.setEnabled(this.moveEarlier, !!one);
    this.setEnabled(this.moveLater, !!one);
    this.setEnabled(this.selectAllBtn, (m?.objects.length ?? 0) > 0);
    this.lockBtn.textContent = m?.selectionLock === "all" ? "Unlock" : "Lock";
    this.setEnabled(this.lockBtn, hasObject);
    this.setEnabled(this.groupBtn, !!m?.canGroup);
    this.setEnabled(this.ungroupBtn, !!m?.canUngroup);
    this.setEnabled(this.selectGroupBtn, !!m?.canSelectGroup);
    this.setEnabled(this.deleteObjectBtn, hasObject);
    this.setEnabled(this.duplicateBtn, hasObject);
    this.setEnabled(this.copyBtn, hasObject);
    this.setEnabled(this.cutBtn, hasObject);
    this.setEnabled(this.pasteBtn, !!m?.canPaste);
    this.setEnabled(this.deleteSlideBtn, !!m && m.slides.length > 1);
    this.setEnabled(this.changeLayoutBtn, !!m);
    this.setEnabled(this.themeBtn, !!m);
    this.setEnabled(this.castBtn, !!m);
    this.setEnabled(this.assetsBtn, !!m);
    this.setEnabled(this.pptxBtn, !!m);
    this.setEnabled(this.variablesBtn, !!m);
    this.setEnabled(this.narrationBtn, !!m && !this.working);
    this.setEnabled(this.timingBtn, !!m && !this.working);
    this.setEnabled(this.timelineBtn, !!m);
    this.setEnabled(this.slideUpBtn, !!m && idx > 0);
    this.setEnabled(this.slideDownBtn, !!m && idx >= 0 && idx < m.slides.length - 1);
    this.setEnabled(this.deleteLayerBtn, !!m && m.sel.layerId !== m.slide?.baseLayer.id);
    this.setEnabled(this.duplicateSlideBtn, !!m);
    this.setEnabled(this.shareSlidesBtn, !!m);
    this.setEnabled(this.banksBtn, !!m);
    this.setEnabled(this.questionsFileBtn, !!m);
    this.setEnabled(this.gamesBtn, !!m);
    this.setEnabled(this.slidesFromFileBtn, !!m);
    this.setEnabled(this.duplicateLayerBtn, !!m && !!m.layer);
    const layerAt = m?.slide ? m.slide.layers.findIndex((l) => l.id === m.sel.layerId) : -1;
    this.setEnabled(this.layerEarlierBtn, layerAt > 0);
    this.setEnabled(this.layerLaterBtn, !!m?.slide && layerAt !== -1 && layerAt < m.slide.layers.length - 1);
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
    // A text box that is left with Tab changes its value at the moment focus moves on, when the page already says nothing has focus. If that
    // redraws the panel, the place focus was moving to is gone, and focus falls to the top of the page (found with NVDA, 2026-10-21). So the
    // box that was being left is remembered, and once the key press is over, if focus did fall, it goes to the control Tab was heading for.
    const tab = this.lastTab;
    const leaving = tab && Date.now() - tab.at < 600 ? this.lastKey : "";
    fn();
    if (key) this.refocus(key);
    if (leaving && tab) {
      window.setTimeout(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        this.focusBeside(leaving, tab.back);
      }, 0);
    }
  }

  /** The key of the control that last had focus, for the same purpose. */
  private lastKey = "";

  /** The key of a Tab press just made, so a redraw that loses focus can put it where Tab was taking it. */
  private lastTab: { at: number; back: boolean } | null = null;

  private focusBeside(key: string, back: boolean): void {
    const stops = [...this.root.querySelectorAll<HTMLElement>("input, select, textarea, button, [tabindex]")]
      .filter((e) => e.tabIndex >= 0 && !(e as HTMLInputElement).disabled && e.offsetParent !== null && !e.closest("[hidden]"));
    const at = stops.findIndex((e) => e.dataset["key"] === key);
    if (at === -1) return;
    stops[Math.min(stops.length - 1, Math.max(0, at + (back ? -1 : 1)))]?.focus();
  }

  private refocus(key: string): void {
    const target = Array.from(this.root.querySelectorAll<HTMLElement>("[data-key]")).find((n) => n.dataset["key"] === key);
    target?.focus();
  }

  private item(key: string, label: string, current: boolean, onPick: (e: MouseEvent) => void, extra = ""): HTMLLIElement {
    const b = h("button", { type: "button", class: "item", "data-key": key, text: label, ...(current ? { "aria-current": "true" } : {}) });
    if (extra) b.title = extra;
    b.addEventListener("click", onPick);
    return h("li", {}, b);
  }

  /**
   * A list is one tab stop, so a keyboard user does not have to press Tab past every slide or object: the item that was last focused, or else
   * the current one, or else the first. The arrow keys move between the items.
   */
  private rove(list: HTMLElement, focused: Element | null = null): void {
    const items = Array.from(list.querySelectorAll<HTMLElement>("button.item"));
    const stop = rovingStop(items.map((i) => ({ focused: i === focused, current: i.getAttribute("aria-current") === "true", pressed: i.getAttribute("aria-pressed") === "true" })));
    items.forEach((i, at) => (i.tabIndex = at === stop ? 0 : -1));
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
        ...m.slides.map((s, i) => this.item(`slide:${s.id}`, `${i + 1}. ${s.name}${m.bankOf(s.id) ? ` (in the question bank ${m.bankOf(s.id)!.name})` : ""}`, s.id === m.sel.slideId, () => {
          m.selectSlide(s.id);
          this.announce(`Slide ${i + 1} of ${m.slides.length}: ${s.name}.`);
        })),
      );
      this.rove(this.slideList);
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
    // With several selected, each item says whether it is one of them (a pressed button), so a screen reader hears it.
    const picked = new Set(m.selected.map((o) => o.id));
    const several = picked.size > 1;
    this.keepFocus(() => {
      this.objectList.replaceChildren(
        ...m.objects.map((o) => {
          const t = o.accessibility.tabOrder ?? 0;
          const label = `${t >= 1 ? `${t}.` : "-"} ${o.name} (${o.type}${o.accessibility.decorative ? ", decorative" : ""}${o.accessibility.altSuggestion ? ", description suggested" : ""}${o.type === "video" && m.descriptionOf(o.id).length > 0 ? ", described" : ""}${t >= 1 ? "" : ", not in tab order"}${isStartingTiming(o.timing) ? "" : ", timed"}${isStartingAnimation(o.animation) ? "" : ", animated"}${o.locked ? ", locked" : ""}${o.group ? `, in a group of ${m.groupSize(o.id)}` : ""})`;
          const li = this.item(`object:${o.id}`, label, o.id === m.sel.objectId, (e) => this.pickObject(o.id, e));
          if (several) li.querySelector("button")!.setAttribute("aria-pressed", String(picked.has(o.id)));
          return li;
        }),
      );
      if (m.objects.length === 0) this.objectList.append(h("li", { class: "note", text: "No objects on this layer. Use Add to put one here." }));
      this.rove(this.objectList);
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
    // Tell a screen reader when the count changes, but not on every keystroke, and not on top of something just said: the checker
    // finishes a moment after an edit, and what the edit did ("Added a timer...") is what the author wants to hear first.
    window.clearTimeout(this.problemSayTimer);
    this.sayProblems();
  }

  private sayProblems(): void {
    const e = this.findings.filter((f) => f.severity === "error").length;
    const summary = this.checkFailure ? "Could not check" : this.summaryText(e, this.findings.length - e);
    if (summary === this.lastSummary) return;
    const wait = this.lastSaid + PROBLEMS_AFTER_MS - Date.now();
    if (wait > 0) {
      this.problemSayTimer = window.setTimeout(() => this.sayProblems(), wait);
      return;
    }
    this.lastSummary = summary;
    this.announce(`Problems: ${summary}`);
  }

  private gotoProblem(f: Finding): void {
    const m = this.model;
    if (!m) return;
    const slideId = f.file.startsWith("slides/") ? f.file.slice("slides/".length).replace(/\.json$/, "") : "";
    if (slideId && m.slides.some((s) => s.id === slideId)) {
      if (!m.reveal(slideId, f.object_id)) m.selectSlide(slideId);
      const said = m.object ? `Selected ${m.describe(m.object)}. ${f.message}` : `${f.message}`;
      // The canvas is named for the slide it shows, and the browser passes the new name to a screen reader a moment after the page changes. Focus that
      // goes to the canvas at once gets the old slide's name read out (found with NVDA, 2026-10-21), so it waits a moment.
      window.setTimeout(() => { this.canvas.focus(); this.announce(said); }, 120);
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
      : h("input", { id: `p-${id}`, type: opts.number ? "number" : "text", autocomplete: "off", ...(opts.number ? { step: "any" } : {}) });
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
    // Several objects selected: the panel is about lining them up, because their own settings differ.
    if (m.selected.length > 1) {
      const group = m.selectedGroup;
      const marker = `multi:${m.selected.map((x) => x.id).join(",")}|${group ? "group" : ""}|${m.canGroup}${m.canUngroup}${m.canSelectGroup}|${m.selectionLock}`;
      if (valuesOnly && this.propsBody.dataset["for"] === marker) {
        if (group) this.fillGroupValues(group);
        return;
      }
      this.keepFocus(() => this.buildMultiProps(m));
      this.propsBody.dataset["for"] = marker;
      return;
    }
    const o = m.object;
    // The panel is rebuilt only when its shape changes: another object, or a button whose
    // action now needs a different set of controls. Otherwise values change in place.
    const shape = !o ? "" : o.type === "button" ? `${m.activationOf(o).kind}|${o.content["icon"] ? "icon" : ""}`
      : o.type === "text" ? `${parseSimpleText(String(o.content["html"] ?? "")) ? "simple" : "raw"}|${isBubbleKind(o.content["bubble"]) ? o.content["bubble"] : ""}|${referencesIn(String(o.content["html"] ?? "")).length > 0 ? "values" : ""}|${/<(ul|ol)>[\s\S]*<(ul|ol)>/.test(String(o.content["html"] ?? "")) ? "nested" : ""}`
      : o.type === "shape" ? (isBubbleKind(o.content["shape"]) ? "bubble" : "")
      : o.type === "interaction" ? interactionShape(o)
      : o.type === "video" || o.type === "audio" ? `${String(o.content["captions"] ?? "")}|${parseBody(String(o.content["transcript"] ?? "")) === null}`
      : o.type === "embed" ? `${(o.content as unknown as EmbedContent).provider}|${parseBody((o.content as unknown as EmbedContent).transcript) === null}`
      : o.type === "table" ? tableShape(o)
      : o.type === "input" ? inputShape(o, m)
      : o.type === "scenario" ? scenarioShape(o, m, this.scenarioSelected(o.id, o.content as unknown as ScenarioContent))
      : o.type === "scrollingText" ? (parseBody(String(o.content["html"] ?? "")) === null ? "raw" : "simple")
      : o.type === "quizQuestion" ? `${JSON.stringify(o.content)}|${m.slide?.layers.map((l) => l.id).join(",")}`
      : "";
    // Rules can change which controls the panel needs, and the variables and layers they can point at come from the project.
    const rules = o ? `|${JSON.stringify(o.triggers)}|${m.variables.map((v) => `${v.id}${v.name}${v.type}`).join(",")}|${m.slide?.layers.map((l) => l.id).join(",")}` : "";
    // Narration changes which controls the panel needs (pronunciations, the Listen button), and whether its audio exists.
    const narrationSign = (n: unknown): string => (n ? `${keyOf(n as Narration)}:${(n as Narration).pronunciations.length}` : "none");
    const itemNarration = o?.type === "interaction" ? (o.content as unknown as InteractionContent).items.map((i) => narrationSign(i.narration)).join(",")
      : o?.type === "video" ? m.descriptionOf(o.id).map((c) => `${c.id}:${narrationSign(c.narration)}`).join(",") : "";
    const narrated = o ? `|${narrationSign(o.narration)}:${this.narrationEpoch}:${this.voiceEpoch}:${m.project.credits}|${itemNarration}` : "";
    // Which look is open, the looks the author named, and how many rules apply the open one. Whether a ready-made look is set is put back in place instead,
    // because the first thing typed into one makes it, and a panel redrawn under the author's cursor would lose their place.
    const looksSign = o && canHaveLooks(o.type) ? `|looks:${m.editingLookOf(o.id)}:${Object.keys(o.states).filter((n) => !isReadyLook(n)).join("\u0001")}:${m.lookUses(o.id, m.editingLookOf(o.id))}` : "";
    const marker = o ? `object:${o.id}:${shape}${rules}${narrated}|${o.timing.appear}:${o.timing.until ? 1 : 0}:${o.type === "text" ? `${m.paragraphCount(o.id)}/${(o.timing.paragraphs ?? []).map((p) => `${p.appear[0]}${p.step ?? ""}${p.until?.step ?? ""}`).join(",")}` : ""}${looksSign}|alt:${o.accessibility.altSuggestion ? 1 : 0}` : `slide:${m.sel.slideId}:${m.sel.layerId}:${m.slide && m.backgroundPictureOf(m.slide.id) ? "picture" : ""}`;
    if (valuesOnly && this.propsBody.dataset["for"] === marker && o) {
      this.fillValues(o);
      return;
    }
    // Keep focus where it is when the panel is redrawn.
    this.keepFocus(() => (o ? this.buildProps(m, o) : this.buildSlideProps(m)));
    this.propsBody.dataset["for"] = marker;
    // The sentences about readability are filled in as values change; a panel that was just built has them empty until then.
    if (o) this.updateContrast(o);
  }

  /** The buttons that line up what is selected: with each other when there are several, with the slide when there is one. */
  private alignButtons(m: Model): HTMLElement {
    const say = (r: { changed: boolean; message: string } | null) => { if (r) this.announce(r.changed ? `${r.message} Press Control Z to undo.` : r.message); };
    return h("div", { class: "btn-row" }, ...ALIGNMENTS.map((a) =>
      this.small(a.label, `Line up the ${a.edge}`, () => say(m.align(a.value)), `Align ${a.label.toLowerCase()}`)));
  }

  /** Group, Ungroup and Select group, for the Properties panel while several are selected. */
  private groupButtons(m: Model): HTMLElement {
    const group = this.small("Group", "Tie the selected objects together (Ctrl+G)", () => this.groupObjects());
    const ungroup = this.small("Ungroup", "Break the selected objects' groups apart (Ctrl+Shift+G)", () => this.ungroupObjects());
    const all = this.small("Select group", "Select everything in the same group as the selected objects", () => this.selectGroupObjects());
    this.setEnabled(group, m.canGroup);
    this.setEnabled(ungroup, m.canUngroup);
    this.setEnabled(all, m.canSelectGroup);
    return h("div", { class: "btn-row" }, group, ungroup, all);
  }

  /** Set the four numbers of a group's box from where its objects are now, except one the author is in. */
  private fillGroupValues(group: OSObject[]): void {
    const box = groupBox(group);
    for (const [id, v] of [["group-x", box.x], ["group-y", box.y], ["group-width", box.width], ["group-height", box.height]] as const) {
      const input = this.propsBody.querySelector<HTMLInputElement>(`#p-${id}`);
      if (input && document.activeElement !== input) input.value = String(v);
    }
  }

  /** Where a whole group is, and how big. Typing a size scales every object in it together. */
  private groupPlaceFields(m: Model, group: OSObject[]): HTMLElement {
    const box = groupBox(group);
    const tag = group[0]!.group;
    const set = (axis: "x" | "y" | "width" | "height") => (v: string) => {
      const n = Number(v);
      if (v.trim() === "" || !Number.isFinite(n)) {
        this.announce("Write a number.");
        this.fillGroupValues(m.selectedGroup ?? group);
        return;
      }
      const patch = axis === "x" ? { x: n } : axis === "y" ? { y: n } : axis === "width" ? { width: n } : { height: n };
      const msg = m.setGroupBox(patch, `groupbox:${tag}:${axis}`);
      if (msg) this.announce(msg);
      this.fillGroupValues(m.selectedGroup ?? group);
    };
    return h("fieldset", {}, h("legend", { text: "Position and size of the group" }),
      this.field("group-x", "Left edge (X)", box.x, set("x"), { number: true }),
      this.field("group-y", "Top edge (Y)", box.y, set("y"), { number: true }),
      this.field("group-width", "Width", box.width, set("width"), { number: true }),
      this.field("group-height", "Height", box.height, set("height"), { number: true }),
      h("p", { class: "note", text: "A new size scales every object in the group together, so each keeps its place and size relative to the rest. Text is not made bigger or smaller, only the boxes." }));
  }

  /** The value every selected object has for something, or undefined if they differ. */
  private shared<T>(sel: OSObject[], pick: (o: OSObject) => T): T | undefined {
    const first = JSON.stringify(pick(sel[0]!));
    return sel.every((o) => JSON.stringify(pick(o)) === first) ? pick(sel[0]!) : undefined;
  }

  /** Timing for everything selected at once, so a group is timed once. A field is blank when the objects differ. */
  /** Play the clip an object follows and take the times from it. */
  private async chooseMoment(m: Model, o: OSObject): Promise<void> {
    const clip = m.timingRows().map((r) => r.object).find((x) => x.id === o.timing.media);
    const src = clip ? String(clip.content["src"] ?? "") : "";
    if (!clip || src === "") {
      this.announce("The clip this follows has no file yet. Add one to the video or audio object first.");
      return;
    }
    try {
      const url = await backend.mediaUrl(m.dir, src).catch(() => backend.assetUrl(m.dir, src));
      const t = o.timing;
      const picked = await chooseMoments({
        name: clip.name, kind: clip.type as "video" | "audio", url,
        start: t.start, end: t.visibleFor === null ? null : t.start + t.visibleFor,
        announce: (msg) => this.announce(msg),
      });
      if (picked) {
        const r = m.setTiming(o.id, { start: picked.start, visibleFor: picked.end === null ? null : picked.end - picked.start });
        if (r.message) this.announce(r.message);
      }
      // After the change, because a box the author is in is never overwritten while they are in it.
      document.getElementById("p-timing-start")?.focus();
    } catch (err) {
      this.announce(`Could not play the clip. ${errorText(err)}`);
    }
  }

  private multiTimingFields(m: Model, sel: OSObject[]): HTMLElement {
    const onBase = m.layer?.id === m.slide?.baseLayer.id;
    const appear = this.shared(sel, (o) => o.timing.appear);
    const start = this.shared(sel, (o) => o.timing.start);
    const leave = this.shared(sel, (o) => o.timing.visibleFor);
    const done = (r: { ok: boolean; message: string }) => { if (r.message) this.announce(r.message); this.renderProps(); };
    const differ = (el: HTMLElement) => { el.querySelector("input")!.placeholder = "they differ"; return el; };
    const startField = this.field("multi-timing-start", `Seconds after ${onBase ? "the slide opens" : "its layer is shown"}, or after the narration starts`, start === undefined ? "" : secondsText(start), (v) => {
      const ms = parseSeconds(v);
      if (ms === undefined) { this.announce("Write the time in seconds, for example 2 or 0.5, up to 3600."); this.renderProps(); return; }
      done(m.setTimingForSelected({ start: ms ?? 0 }));
    }, { number: true });
    const leaveField = this.field("multi-timing-leave", "Stays for, in seconds (blank: until the slide ends)", leave === undefined || leave === null ? "" : secondsText(leave), (v) => {
      const ms = parseSeconds(v);
      if (ms === undefined || ms === 0) { this.announce("Write how long it stays in seconds, for example 6, or leave it blank to stay until the slide ends."); this.renderProps(); return; }
      done(m.setTimingForSelected({ visibleFor: ms }));
    }, { number: true });
    return h("fieldset", {}, h("legend", { text: `Timing, for all ${sel.length}` }),
      h("p", { class: "note", text: "A value set here is set on every selected object, as one undo step, so a group is timed once. A field is blank when the objects differ." }),
      this.selectField("multi-timing-appear", "Appears", [
        ...(appear === undefined ? [{ value: "", label: "They differ: leave each as it is" }] : []),
        { value: "time", label: onBase ? "After the slide opens" : "After its layer is shown" },
        { value: "narration", label: "After its narration starts", disabled: !sel.some((o) => o.narration) },
        { value: "media", label: "When a video or audio clip reaches a time", disabled: m.mediaSources().length === 0 && appear !== "media" },
        { value: "click", label: "When the learner shows the next item (each gets the next item number)" },
      ], appear ?? "", (v) => { if (v !== "") done(m.setTimingForSelected({ appear: v as "time" | "narration" | "media" | "click" })); }),
      start === undefined ? differ(startField) : startField,
      leave === undefined ? differ(leaveField) : leaveField,
      h("p", { class: "note", text: appear !== undefined && start !== undefined && leave !== undefined ? describeTiming(sel[0]!.timing, !onBase) : "These objects have different timing. Setting a value here makes it the same on all of them." }));
  }

  /** How everything selected arrives and leaves, set once. */
  private multiAnimationFields(m: Model, sel: OSObject[]): HTMLElement {
    const done = (r: { ok: boolean; message: string }) => { if (r.message) this.announce(r.message); this.renderProps(); };
    const part = (phase: Phase, label: string, secondsLabel: string): HTMLElement[] => {
      const effect = this.shared(sel, (o) => o.animation[phase].effect);
      const duration = this.shared(sel, (o) => o.animation[phase].duration);
      const time = this.field(`multi-anim-${phase}-time`, secondsLabel, duration === undefined ? "" : secondsText(duration), (v) => {
        const ms = parseSeconds(v);
        if (ms === undefined || ms === null) { this.announce(`Write how long it lasts in seconds, from ${MIN_DURATION / 1000} to ${MAX_DURATION / 1000}, for example 0.5.`); this.renderProps(); return; }
        done(m.setAnimationForSelected(phase, { duration: ms }));
      }, { number: true });
      if (duration === undefined) time.querySelector("input")!.placeholder = "they differ";
      return [
        this.selectField(`multi-anim-${phase}`, label, [...(effect === undefined ? [{ value: "", label: "They differ: leave each as it is" }] : []), ...effectChoices(phase)], effect ?? "", (v) => {
          if (v !== "") done(m.setAnimationForSelected(phase, { effect: v as typeof sel[0]["animation"]["enter"]["effect"] }));
        }),
        time,
      ];
    };
    return h("fieldset", {}, h("legend", { text: `Animation, for all ${sel.length}` }),
      h("p", { class: "note", text: "Motion is a barrier for some learners, so effects are short, never repeat and never flash. A value set here is set on every selected object, as one undo step." }),
      ...part("enter", "Arrives", "Seconds to arrive"),
      ...part("exit", "Leaves", "Seconds to leave"));
  }

  /** The Properties panel while several objects are selected. */
  private buildMultiProps(m: Model): void {
    const sel = m.selected;
    const group = m.selectedGroup;
    const say = (r: { changed: boolean; message: string } | null) => { if (r) this.announce(r.changed ? `${r.message} Press Control Z to undo.` : r.message); };
    const across = this.small("Across", "Space the selected objects evenly from left to right", () => say(m.distribute("horizontal")), "Space out across");
    const down = this.small("Down", "Space the selected objects evenly from top to bottom", () => say(m.distribute("vertical")), "Space out down");
    this.setEnabled(across, m.selectedUnits >= 3);
    this.setEnabled(down, m.selectedUnits >= 3);
    const names = sel.map((o) => o.name).join(", ");
    this.propsBody.replaceChildren(
      h("p", { class: "note", text: group ? `Group of ${sel.length} objects: ${names}.` : `${sel.length} objects selected: ${names}.` }),
      h("fieldset", {}, h("legend", { text: "Group" }),
        this.groupButtons(m),
        h("p", { class: "note", text: group
          ? "These objects are one group. Clicking one on the slide chooses them all, and they move, resize, copy and delete together. Hold Alt and click to choose just one, or choose it from the Objects list. A group is for editing only: the course looks the same."
          : "Group ties the selected objects together so they are chosen, moved, resized, copied and deleted as one. It is for editing only: the course looks the same." })),
      ...(group ? [this.groupPlaceFields(m, group)] : []),
      h("fieldset", {}, h("legend", { text: "Line up" }),
        this.alignButtons(m),
        h("p", { class: "note", text: "Lines the objects up with each other. A whole group counts as one object. Only where things sit changes, never their sizes." })),
      h("fieldset", {}, h("legend", { text: "Space out evenly" }),
        h("div", { class: "btn-row" }, across, down),
        h("p", { class: "note", text: "Needs three or more objects, counting a whole group as one. The outermost two stay where they are." })),
      this.multiTimingFields(m, sel),
      this.multiAnimationFields(m, sel),
      h("p", { class: "note", text: "The arrow keys, Delete, Duplicate, Copy, Cut and Paste work on all of them. To change one object's text, colours, alt text, rules or narration, choose that object on its own." }));
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
      this.slideNarrationFields(m),
      this.designFields(m, slide.id),
      h("fieldset", {}, h("legend", { text: "Slide" }),
        this.field("slide-name", "Slide name", slide.name, (v) => { const msg = m.renameSlide(slide.id, v); if (msg) this.announce(msg); else (document.getElementById("p-slide-name") as HTMLInputElement).value = slide.name; })),
      h("fieldset", {}, h("legend", { text: "Layer" }),
        this.field("layer-name", "Layer name", layer.name, (v) => { const msg = m.renameLayer(layer.id, v); if (msg) this.announce(msg); else (document.getElementById("p-layer-name") as HTMLInputElement).value = layer.name; })),
      this.slideTimingFields(m),
      this.slideTransitionFields(m),
      this.slideNavigationFields(m),
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

    const pick = this.small("Background picture...", "Choose a picture to put behind everything on this slide", () => void this.chooseBackground(slide.id));
    pick.id = "bg-pick";
    const drop = this.small("Remove background picture", "Take this slide's background picture away", () => {
      if (drop.getAttribute("aria-disabled") === "true") return;
      const msg = m.removeBackgroundPicture(slide.id);
      if (msg) this.announce(`${msg} Press Control Z to undo.`);
    });
    this.setEnabled(drop, m.backgroundPictureOf(slide.id) !== null);

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
      h("div", { class: "btn-row" }, pick, drop),
      ...(m.backgroundPictureOf(slide.id) ? [h("p", { class: "note", text: "This slide has a background picture. It is locked, so clicking the slide does not move it: it is in the Objects list as Background picture, and Unlock lets you move or resize it. The background colour above is the picture's average colour." })] : []),
      ...(kind === "custom" ? [this.field("slide-bg-hex", "Background colour (hex)", custom, (v) => {
        const hx = normalizeHex(v);
        if (!hx) { this.announce("A colour must be a hex code such as #1a1a1a."); (document.getElementById("p-slide-bg-hex") as HTMLInputElement).value = custom; return; }
        const msg = m.setSlideBackground(slide.id, hx);
        if (msg) this.announce(msg);
      })] : []),
      h("p", { class: "note", text: "A slide's layout and background follow the theme, so they change when you change the theme." }));
  }

  /** Update the values of the open panel without rebuilding it. */
  /**
   * The description the computer suggested for the object (from a recording, say), shown beside the alt text it would fill: what it says, what it was worked out from, and
   * two buttons. It is only a suggestion: the course does not use it, and the checker still asks for alt text, until the author uses it or writes their own.
   */
  private altSuggestionBlock(m: Model, o: OSObject): HTMLElement {
    const s = o.accessibility.altSuggestion!;
    const use = h("button", { type: "button", id: "alt-suggestion-use", text: "Use this description" });
    const drop = h("button", { type: "button", id: "alt-suggestion-drop", text: "Throw the suggestion away" });
    use.addEventListener("click", () => {
      const said = m.useAltSuggestion(o.id);
      if (said) this.announce(said);
      this.propsBody.querySelector<HTMLElement>("#p-alt")?.focus();
    });
    drop.addEventListener("click", () => {
      const said = m.dismissAltSuggestion(o.id);
      if (said) this.announce(said);
      this.propsBody.querySelector<HTMLElement>("#p-alt")?.focus();
    });
    return h("div", { id: "alt-suggestion", class: "alt-suggestion", role: "group", "aria-labelledby": "alt-suggestion-title" },
      h("p", { id: "alt-suggestion-title", class: "alt-suggestion-title", text: "A description has been suggested, and not checked yet" }),
      h("p", { id: "alt-suggestion-text", text: s.text }),
      h("p", { class: "note", text: `Worked out from: ${s.basis} It is only a suggestion. The course does not use it, and the Problems panel still asks for alt text, until you use it or write your own. Read it against the picture first.` }),
      h("div", { class: "btn-row" }, use, drop));
  }

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
    const liveBox = this.propsBody.querySelector<HTMLInputElement>("#p-value-live");
    if (liveBox && document.activeElement !== liveBox) liveBox.checked = a.role === "status";
    const dec = this.propsBody.querySelector<HTMLInputElement>("#p-decorative");
    if (dec) dec.checked = a.decorative;
    const lock = this.propsBody.querySelector<HTMLInputElement>("#p-locked");
    if (lock) lock.checked = o.locked === true;
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
    set("timing-step", String(o.timing.step ?? 1));
    set("timing-leave", o.timing.visibleFor === null ? "" : secondsText(o.timing.visibleFor));
    set("timing-until", o.timing.until ? String(o.timing.until.step) : "");
    if (o.timing.until) set("timing-until-start", secondsText(o.timing.until.start));
    const timingNote = this.propsBody.querySelector<HTMLElement>("#timing-summary");
    if (timingNote) timingNote.textContent = describeTiming(o.timing, !!this.model && this.model.layer?.id !== this.model.slide?.baseLayer.id, this.model?.mediaNameOf(o.timing.media));
    set("timing-media", o.timing.media ?? "");
    if (spoken) { set("narration-voice", spoken.voice); set("narration-speed", spoken.speed); }
    set("font", String(o.style["fontFamily"] ?? "system-ui"));
    set("size", o.style["fontSize"] ?? "");
    for (const key of ["color", "fill", "stroke"] as const) this.colorUpdaters.get(key)?.(String(o.style[key] ?? ""));
    set("stroke-width", o.style["strokeWidth"] ?? "");
    set("opacity", typeof o.style["opacity"] === "number" ? percentOf(o.style["opacity"]) : "");
    this.fillLooks(o);
    set("shape", String(o.content["shape"] ?? "rectangle"));
    set("bubble", isBubbleKind(o.content["bubble"]) ? o.content["bubble"] : "");
    set("align", o.style["textAlign"] === "center" || o.style["textAlign"] === "right" ? String(o.style["textAlign"]) : "left");
    set("vertical", o.style["verticalAlign"] === "middle" || o.style["verticalAlign"] === "bottom" ? String(o.style["verticalAlign"]) : "top");
    set("nested", typeof o.style["nestedSize"] === "number" ? Math.round(o.style["nestedSize"] * 100) : 100);
    const fitBox = this.propsBody.querySelector<HTMLInputElement>("#p-fit");
    if (fitBox) fitBox.checked = o.style["autoFit"] === "shrink";
    set("tail", tailOf(o.content["tail"]));
    this.updateContrast(o);
    if (o.type === "quizQuestion") this.fillQuiz(o);
    if (o.type === "interaction") this.fillInteraction(o);
    if (o.type === "table") this.fillTable(o);
    if (o.type === "results") this.fillResults(o);
    if (o.type === "certificate") this.fillCertificate(o);
    if (o.type === "download") this.fillDownload(o);
    if (o.type === "timer") this.fillTimer(o);
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
    if (o.type === "scenario") this.fillScenario(o);
    if (o.type === "button") {
      const lookBox = this.propsBody.querySelector<HTMLSelectElement>("#p-button-look");
      if (lookBox && this.model) lookBox.value = this.model.buttonLook(o.id);
    }
    if (o.type === "icon") set("icon-stroke", o.style["strokeWidth"] ?? 2);
    if (o.type === "scrollingText") { const body = parseBody(String(o.content["html"] ?? "")); if (body !== null) set("scroll-text", body); }
    const simple = typeof o.content["html"] === "string" ? parseSimpleText(o.content["html"]) : null;
    if (simple) { set("text", simple.text); set("block", simple.block); } else set("html", String(o.content["html"] ?? ""));
  }

  private buildProps(m: Model, o: OSObject): void {
    const a = o.accessibility;
    const num = (key: keyof OSObject["geometry"]) => (v: string) => {
      const refused = v.trim() !== "" && key !== "z" ? m.lockMessage(o.id) : null;
      if (refused) {
        this.announce(refused);
        // The box the author typed in is still focused, and a focused box is never overwritten, so put its real value back here.
        const typed = this.propsBody.querySelector<HTMLInputElement>(`#p-${key}`);
        if (typed) typed.value = String(o.geometry[key]);
        this.fillValues(o);
        return;
      }
      const msg = v.trim() === "" ? null : m.setGeometry(o.id, { [key]: Number(v) });
      if (msg) this.announce(msg);
      else this.fillValues(o);
    };

    const locked = h("input", { id: "p-locked", type: "checkbox", ...(o.locked ? { checked: true } : {}) });
    locked.dataset["key"] = "prop:locked";
    locked.addEventListener("change", () => {
      const msg = m.setLocked(locked.checked);
      if (msg) this.announce(`${msg} Press Control Z to undo.`);
    });
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
    if (o.type === "text") content.push(...this.textFields(m, o), ...this.bubbleFields(m, o));
    if (o.type === "button") content.push(this.field("label", "Button label", String(o.content["label"] ?? ""), (v) => {
      const msg = m.setLabel(o.id, v);
      if (msg) this.announce(msg); else this.fillValues(o);
    }));

    const looks: HTMLElement[] = [];
    if (o.type === "text" || o.type === "button") {
      looks.push(this.fontField(m, o), style("fontSize", "size", "Font size", true), this.colorField(m, o, "color", "Text colour", "Default"),
        ...(o.type === "text" ? [this.selectField("align", "Words sit", [{ value: "left", label: "On the left" }, { value: "center", label: "In the centre" }, { value: "right", label: "On the right" }], String(o.style["textAlign"] === "center" || o.style["textAlign"] === "right" ? o.style["textAlign"] : "left"), (v) => {
          const msg = m.setTextAlign(o.id, v);
          if (msg) this.announce(msg);
        })] : []),
        ...(o.type === "text" ? [this.selectField("vertical", "Words start", [{ value: "top", label: "At the top of the box" }, { value: "middle", label: "In the middle of the box" }, { value: "bottom", label: "At the bottom of the box" }], o.style["verticalAlign"] === "middle" || o.style["verticalAlign"] === "bottom" ? String(o.style["verticalAlign"]) : "top", (v) => {
          const msg = m.setTextVertical(o.id, v);
          if (msg) this.announce(msg);
        }),
        h("div", { class: "field check" },
          this.tick("checkbox", "fit", "Shrink the words to fit the box", o.style["autoFit"] === "shrink", (on) => { const msg = m.setTextFit(o.id, on); if (msg) this.announce(msg); }),
          h("label", { for: "p-fit", text: "Shrink the words to fit the box" })),
        h("p", { class: "note", text: "When there are more words than the box holds, they shrink, to no less than half their size or 12 pixels, so they stay inside. Text brought in from PowerPoint has this on if its box did." }),
        ...(/<(ul|ol)>[\s\S]*<(ul|ol)>/.test(String(o.content["html"] ?? "")) ? [this.field("nested", "Deeper list levels, as a percent of the level above", typeof o.style["nestedSize"] === "number" ? Math.round(o.style["nestedSize"] * 100) : 100, (v) => {
          const n = v.trim() === "" ? null : Number(v);
          const r = m.setNestedSize(o.id, n);
          if (r.message) this.announce(r.message);
          this.fillValues(o);
        }, { number: true })] : [])] : []),
        h("p", { id: "contrast-note", class: "note" }));
    }
    if (o.type === "text" && isBubbleKind(o.content["bubble"])) {
      looks.push(
        this.colorField(m, o, "fill", "Bubble colour", "No fill"),
        this.colorField(m, o, "stroke", "Outline colour", "No outline"),
        this.field("stroke-width", "Outline width", o.style["strokeWidth"] ?? "", (v) => {
          const r = m.setStyle(o.id, "strokeWidth", v);
          if (!r.ok) { this.announce(r.message); this.fillValues(o); } else if (r.message) this.announce(r.message);
        }, { number: true }),
      );
    }
    if (o.type === "button") looks.unshift(...this.buttonLookFields(m, o));
    if (o.type === "button") looks.push(this.colorField(m, o, "fill", "Button colour", "Default"));
    if (o.type === "icon") {
      looks.push(
        this.colorField(m, o, "color", "Icon colour", "Default"),
        this.field("icon-stroke", "Line width (0.5 to 4; 2 is normal)", o.style["strokeWidth"] ?? 2, (v) => {
          const r = m.setStyle(o.id, "strokeWidth", v);
          if (!r.ok) { this.announce(r.message); this.fillValues(o); } else if (r.message) this.announce(r.message);
        }, { number: true }),
      );
    }
    if (o.type === "table" || o.type === "scrollingText" || o.type === "input" || o.type === "results" || o.type === "certificate" || o.type === "download" || o.type === "timer") {
      looks.push(this.fontField(m, o), style("fontSize", "size", "Font size", true),
        h("p", { class: "note", text: "A table, a scrolling text box, an input, a results box, a certificate, a file to download and a timer use the theme's colours, so they stay readable when you change the theme." }));
    }
    if (o.type === "interaction") {
      looks.push(this.fontField(m, o), style("fontSize", "size", "Font size", true),
        h("p", { class: "note", text: "An interaction uses the theme's colours, so it stays readable when you change the theme." }));
    }
    if (o.type === "scenario") {
      looks.push(this.fontField(m, o), style("fontSize", "size", "Font size", true),
        h("p", { class: "note", text: "A scenario uses the theme's colours, so it stays readable when you change the theme. Make it large enough for its longest situation: if the text does not fit, the learner can scroll it." }));
    }
    if (o.type === "shape") {
      looks.push(
        this.selectField("shape", "Shape", SHAPE_KINDS.map((k) => ({ value: k, label: SHAPE_LABELS[k] })), String(o.content["shape"] ?? "rectangle"), (v) => {
          const msg = m.setShape(o.id, v);
          if (msg) this.announce(msg);
        }),
        ...(isBubbleKind(o.content["shape"]) ? [this.tailField(m, o)] : []),
        this.colorField(m, o, "fill", "Fill colour", "No fill"),
        this.colorField(m, o, "stroke", "Outline colour", "No outline"),
        this.field("stroke-width", "Outline width", o.style["strokeWidth"] ?? "", (v) => {
          const r = m.setStyle(o.id, "strokeWidth", v);
          if (!r.ok) { this.announce(r.message); this.fillValues(o); } else if (r.message) this.announce(r.message);
        }, { number: true }),
      );
    }

    if (canHaveLooks(o.type)) looks.push(this.solidField(m, o));

    this.propsBody.replaceChildren(
      h("p", { class: "identity", text: `${o.type}, id ${o.id}` }),
      ...(o.group ? [h("p", { class: "note", text: `In a group of ${m.groupSize(o.id)}. Select group chooses all of them, and Ungroup breaks the group apart.` })] : []),
      this.field("name", "Name", o.name, (v) => { const msg = m.setName(o.id, v); if (msg) this.announce(msg); else this.fillValues(o); }),
      ...(content.length ? [h("fieldset", {}, h("legend", { text: "Content" }), ...content)] : []),
      ...(looks.length ? [h("fieldset", {}, h("legend", { text: "Appearance" }), ...looks)] : []),
      ...this.lookFields(m, o),
      ...this.narrationFields(m, o),
      ...this.timingFields(m, o),
      ...(o.type === "text" ? this.paragraphFields(m, o) : []),
      ...this.animationFields(m, o),
      ...this.ruleFields(m, o),
      ...(o.type === "quizQuestion" ? this.quizFields(m, o) : []),
      ...(o.type === "interaction" ? this.interactionFields(m, o) : []),
      ...(o.type === "scenario" ? this.scenarioFields(m, o) : []),
      ...(o.type === "icon" ? this.iconFields(m, o) : []),
      ...(o.type === "video" || o.type === "audio" ? this.mediaFields(m, o) : []),
      ...(o.type === "video" ? this.descriptionFields(m, o) : []),
      ...(o.type === "embed" ? this.embedFields(m, o) : []),
      ...(o.type === "table" ? this.tableFields(m, o) : []),
      ...(o.type === "input" ? this.inputFields(m, o) : []),
      ...(o.type === "image" ? this.imageFields(m, o) : []),
      ...(o.type === "scrollingText" ? this.scrollFields(m, o) : []),
      ...(o.type === "results" ? this.resultsFields(m, o) : []),
      ...(o.type === "certificate" ? this.certificateFields(m, o) : []),
      ...(o.type === "download" ? this.downloadFields(m, o) : []),
      ...(o.type === "timer" ? this.timerFields(m, o) : []),
      ...(isPictureBox(o) ? this.pictureBoxFields(m, o) : []),
      h("fieldset", {}, h("legend", { text: "Position and size" }),
        this.field("x", "Left edge (X)", o.geometry.x, num("x"), { number: true }),
        this.field("y", "Top edge (Y)", o.geometry.y, num("y"), { number: true }),
        this.field("width", "Width", o.geometry.width, num("width"), { number: true }),
        this.field("height", "Height", o.geometry.height, num("height"), { number: true }),
        this.field("rotation", "Rotation, degrees", o.geometry.rotation, num("rotation"), { number: true }),
        this.field("z", "Stacking order", o.geometry.z, num("z"), { number: true }),
        h("div", { class: "field check" }, locked, h("label", { for: "p-locked", text: "Locked (the editor will not move, resize, rotate or delete it)" }))),
      h("fieldset", {}, h("legend", { text: "Line up with the slide" }), this.alignButtons(m)),
      h("fieldset", {}, h("legend", { text: "Accessibility" }),
        h("div", { class: "field check" }, decorative, h("label", { for: "p-decorative", text: "Decorative (no meaning, hidden from screen readers)" })),
        this.field("alt", "Alt text", a.altText, (v) => { m.setAccessibility(o.id, { altText: v }); }, { area: true, describedBy: "alt-note" }),
        h("p", { id: "alt-note", class: "note", text: o.type === "hotspot"
          ? "This is the name a screen reader gives the hotspot, for example \"The Save button\". Say what it is or what pressing it does. The picture it sits over needs alt text of its own."
          : o.type === "video" || o.type === "audio" || o.type === "embed"
          ? `This is the name a screen reader gives the player, for example "Welcome from the instructor". Say what the ${o.type === "audio" ? "clip" : "video"} is.`
          : o.type === "input"
          ? "The prompt is the name a screen reader gives this input. Alt text starts as the same words; add to it only to give extra instructions."
          : o.type === "results"
          ? "This is the name a screen reader gives the box, for example \"Your quiz results\"."
          : o.type === "certificate"
          ? "This is the name a screen reader gives the certificate area, for example \"Certificate of achievement\"."
          : o.type === "download"
          ? "This is the name a screen reader gives the group, for example \"Course handbook, a PDF to download\". Say what the file is and what kind it is."
          : o.type === "timer"
          ? "This is the name a screen reader gives the timer group, for example \"Time left to answer\". It starts as the words above the clock and follows them until you change it."
          : o.type === "table" || o.type === "scrollingText"
          ? `This is the name a screen reader gives the ${o.type === "table" ? "table" : "box"}, for example "Quarterly results". Say what it shows.`
          : o.type === "interaction"
          ? "This is the name a screen reader gives the whole group, for example \"Causes of burnout\". Say what the items are about."
          : o.type === "icon"
          ? "This is what a screen reader says for the icon. Say what it means to the learner, for example \"Next\" or \"Warning\", not what it looks like. If it only decorates something that already has a name, mark it decorative instead."
          : o.type === "scenario"
          ? "This is the name a screen reader gives the scenario, for example \"Telling your team lead that a report is late\". Say what the story is about."
          : o.type === "quizQuestion"
          ? "This is the name a screen reader gives the group of answers. The question itself is the heading before it, so keep that clear."
          : "Required unless the object is decorative. Decorative objects must have no alt text. A screen reader reads a text object's own words, so for text this is kept for tools and checks." }),
        ...(a.altSuggestion ? [this.altSuggestionBlock(m, o)] : []),
        this.field("role", "Role", a.role, (v) => { m.setAccessibility(o.id, { role: v }); }),
        this.field("tab", "Tab order (blank for none)", a.tabOrder, (v) => {
          const n = v.trim() === "" ? null : Number(v);
          if (m.setAccessibility(o.id, { tabOrder: n }) === null) { this.announce("Tab order must be a whole number, 0 or more."); this.fillValues(o); }
        }, { number: true })),
    );
  }

  /** How solid the object, or one of its looks, is painted: 100 is fully solid, less lets what is behind show through. */
  private solidField(m: Model, o: OSObject, look = "normal"): HTMLElement {
    const style = look === "normal" ? o.style : o.states[look]?.style ?? {};
    const v = style["opacity"];
    const label = look === "normal" ? "How solid (10 to 100; blank is fully solid)" : `How solid (${lookLabel(look)}; 10 to 100, blank is the same as normal)`;
    return this.field(look === "normal" ? "opacity" : "look-opacity", label, typeof v === "number" ? percentOf(v) : "", (text) => {
      const r = m.setStyle(o.id, "opacity", text, look);
      if (!r.ok) { this.announce(r.message); this.fillValues(o); } else if (r.message) this.announce(r.message);
    }, { number: true });
  }

  /** The Looks box: the other ways this object can appear, and the one being worked on. */
  private lookFields(m: Model, o: OSObject): HTMLElement[] {
    if (!canHaveLooks(o.type)) return [];
    const looks = m.looksOf(o.id);
    const look = m.editingLookOf(o.id);
    const parts: HTMLElement[] = [
      h("p", { class: "note", text: "A look is another way this object can appear. Hover or focus, Visited and Disabled are used by the course on their own. A look you name yourself is used when a rule says so (under Rules, choose Change an object's look). Choose a look to edit it, and the canvas shows it." }),
      this.selectField("look", "Look to edit", [
        { value: "normal", label: "Normal (the Appearance box above)" },
        ...looks.map((l) => ({ value: l.name, label: l.set ? l.label : `${l.label} (not set)` })),
      ], look, (v) => {
        m.setEditingLook(o.id, v);
        this.announce(v === "normal" ? "Editing the object's own appearance." : `Editing the look ${lookLabel(v)}. The canvas shows it.`);
      }),
    ];
    if (look !== "normal") parts.push(...this.lookEditor(m, o, look));
    const add = this.small("Add a look...", "Give this object a look of its own, such as Correct or Selected", () => void this.addLookDialog(m, o));
    add.dataset["key"] = "prop:look-add";
    parts.push(h("div", { class: "btn-row" }, add));
    return [h("fieldset", { class: "looks" }, h("legend", { text: "Looks" }), ...parts)];
  }

  /** The fields of one look: what is different from normal, the words a screen reader says, and renaming and removing it. */
  private lookEditor(m: Model, o: OSObject, look: string): HTMLElement[] {
    const info = m.looksOf(o.id).find((l) => l.name === look);
    const own = o.states[look]?.style ?? {};
    const name = lookLabel(look);
    const refresh = (r: { ok: boolean; message: string }) => { if (!r.ok) { this.announce(r.message); this.fillValues(o); } else if (r.message) this.announce(r.message); };
    const field = (k: LookField): HTMLElement => {
      switch (k) {
        case "fontFamily": return this.fontField(m, o, look);
        case "fontSize": return this.field("look-size", `Font size (${name}; blank is the same as normal)`, own["fontSize"] ?? "", (v) => refresh(m.setStyle(o.id, "fontSize", v, look)), { number: true });
        case "color": return this.colorField(m, o, "color", `${o.type === "icon" ? "Icon colour" : "Text colour"} (${name})`, "Same as normal", look);
        case "fill": return this.colorField(m, o, "fill", `${o.type === "shape" ? "Fill colour" : "Button colour"} (${name})`, "Same as normal", look);
        case "stroke": return this.colorField(m, o, "stroke", `Outline colour (${name})`, "Same as normal", look);
        case "strokeWidth": return this.field("look-stroke-width", `Outline width (${name}; blank is the same as normal)`, own["strokeWidth"] ?? "", (v) => refresh(m.setStyle(o.id, "strokeWidth", v, look)), { number: true });
        case "opacity": return this.solidField(m, o, look);
      }
    };
    const said = o.states[look]?.announce ?? "";
    const uses = m.lookUses(o.id, look);
    const parts: HTMLElement[] = [
      h("p", { class: "note", id: "look-use", text: lookUseText(look, info?.set ?? false) }),
      ...lookFieldsFor(o.type).map(field),
      ...(o.type === "text" || o.type === "button" ? [h("p", { id: "look-contrast-note", class: "note" })] : []),
      this.field("look-announce", `Spoken message (${name})`, said, (v) => {
        const r = m.setLookAnnounce(o.id, look, v);
        if (r.message) this.announce(r.message);
        if (!r.ok) this.fillValues(o);
      }, { describedBy: "look-announce-note" }),
      h("p", { id: "look-announce-note", class: "note", text: announceNoteText(look, said, uses) }),
    ];
    const buttons: HTMLElement[] = [];
    if (info && !info.ready) {
      const rename = this.small("Rename...", "Give this look another name", () => void this.renameLookDialog(m, o, look), `Rename: the look ${name}`);
      rename.dataset["key"] = "prop:look-rename";
      buttons.push(rename);
    }
    const remove = this.small(info?.ready ? "Clear this look" : "Delete this look", info?.ready ? "Put this look back to not set" : "Delete this look", () => {
      const msg = m.removeLook(o.id, look);
      if (msg) this.announce(msg);
      this.refocus("prop:look");
    }, `${info?.ready ? "Clear this look" : "Delete this look"}: ${name}`);
    remove.id = "look-remove";
    remove.dataset["key"] = "prop:look-remove";
    this.setEnabled(remove, info?.set ?? false);
    buttons.push(remove);
    parts.push(h("div", { class: "btn-row" }, ...buttons));
    return parts;
  }

  private async addLookDialog(m: Model, o: OSObject): Promise<void> {
    const name = await askText({
      heading: "Add a look",
      label: "Name of the look",
      confirm: "Add look",
      help: "A few words, such as Correct, Selected or Done. A rule uses the name to apply the look. It starts the same as normal; you choose what is different.",
      check: (t) => lookNameProblem(t, Object.keys(m.object?.states ?? o.states)),
    });
    if (name === null) { this.refocus("prop:look-add"); return; }
    const r = m.addLook(o.id, name);
    if (r.message) this.announce(r.message);
    this.refocus("prop:look");
  }

  private async renameLookDialog(m: Model, o: OSObject, look: string): Promise<void> {
    const name = await askText({
      heading: `Rename the look ${look}`,
      label: "New name",
      confirm: "Rename",
      initial: look,
      help: "Rules that apply this look follow the new name.",
      check: (t) => (t.trim() === look ? null : lookNameProblem(t, Object.keys(m.object?.states ?? o.states).filter((n) => n !== look))),
    });
    if (name === null) { this.refocus("prop:look-rename"); return; }
    const r = m.renameLook(o.id, look, name);
    if (r.message) this.announce(r.message);
    this.refocus("prop:look");
  }

  /** Put the open look's values, and the words around them, back in place without redrawing the panel. */
  private fillLooks(o: OSObject): void {
    const m = this.model;
    if (!m || !canHaveLooks(o.type)) return;
    const put = (id: string, v: string | number | null) => {
      const input = this.propsBody.querySelector<HTMLInputElement | HTMLSelectElement>(`#p-${id}`);
      if (input && document.activeElement !== input) input.value = v === null ? "" : String(v);
    };
    const infos = m.looksOf(o.id);
    const lookBox = this.propsBody.querySelector<HTMLSelectElement>("#p-look");
    if (lookBox) {
      for (const opt of Array.from(lookBox.options)) {
        const info = infos.find((l) => l.name === opt.value);
        if (info) opt.textContent = info.set ? info.label : `${info.label} (not set)`;
      }
    }
    const look = m.editingLookOf(o.id);
    if (look === "normal") return;
    const info = infos.find((l) => l.name === look);
    const own = o.states[look]?.style ?? {};
    const said = o.states[look]?.announce ?? "";
    put("look-font", String(own["fontFamily"] ?? ""));
    put("look-size", own["fontSize"] ?? "");
    put("look-stroke-width", own["strokeWidth"] ?? "");
    put("look-opacity", typeof own["opacity"] === "number" ? percentOf(own["opacity"]) : "");
    put("look-announce", said);
    for (const key of ["color", "fill", "stroke"] as const) this.colorUpdaters.get(`look-${key}`)?.(String(own[key] ?? ""));
    const use = this.propsBody.querySelector<HTMLElement>("#look-use");
    if (use) use.textContent = lookUseText(look, info?.set ?? false);
    const note = this.propsBody.querySelector<HTMLElement>("#look-announce-note");
    if (note) note.textContent = announceNoteText(look, said, m.lookUses(o.id, look));
    const remove = this.propsBody.querySelector<HTMLElement>("#look-remove");
    if (remove) this.setEnabled(remove, info?.set ?? false);
  }

  private colorUpdaters = new Map<string, (v: string) => void>();

  /**
   * A colour chooser that needs no hex code. The theme's own colours come first: choosing one keeps
   * the object following the theme, so it changes when the theme does. Then a palette of named
   * colours, the system colour picker for anything else, a hex box for someone who has a code, and
   * a button for "none". Each group of swatches is one tab stop; the arrow keys move within it.
   */
  private colorField(m: Model, o: OSObject, key: "color" | "fill" | "stroke", label: string, noneLabel: string, look = "normal"): HTMLElement {
    // On a look the boxes have ids of their own, so the object's own colour and the look's can be on the panel together.
    const idKey = look === "normal" ? key : `look-${key}`;
    const styleNow = (): Style => (look === "normal" ? m.object?.style : m.object?.states[look]?.style) ?? {};
    // "None" is a real choice for an outline on the object itself. On a look, clearing means the same as normal.
    const cleared = look === "normal" && key === "stroke" ? "none" : "";
    const swatch = h("span", { class: "swatch", "aria-hidden": "true" });
    const nameEl = h("span", { class: "color-name" });

    const group = (name: string, items: { name: string; hex: string; value: string; id: string }[]) => {
      const el = h("div", { class: "palette", role: "group", "aria-label": name });
      const btns = items.map((c) => {
        const b = h("button", { type: "button", class: "swatch-btn", "aria-label": c.name, title: `${c.name} ${c.hex}`, "aria-pressed": "false" });
        b.dataset["key"] = `prop:${idKey}-${c.id}`;
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

    // NVDA reads a colour well by its colour alone ("7% red 7% green 7% blue") and drops its label, so the name is put on the control itself.
    const picker = h("input", { id: `p-${idKey}-picker`, type: "color", "aria-label": `${label}: choose any colour with the system colour chooser` });
    picker.dataset["key"] = `prop:${idKey}-picker`;
    picker.addEventListener("change", () => apply(picker.value));
    const hex = h("input", { id: `p-${idKey}`, type: "text", size: 9 });
    hex.dataset["key"] = `prop:${idKey}`;
    hex.addEventListener("change", () => {
      const raw = hex.value.trim();
      const n = normalizeHex(raw);
      if (raw === "") apply(cleared);
      else if (n) apply(n);
      else { this.announce("A colour must be a hex code such as #1a1a1a. You can also pick one from the palettes."); update(String(styleNow()[key] ?? "")); }
    });
    // A bare "Default" is read as "default button", which means something else on a form, so the button says what it is the default of.
    const none = h("button", { type: "button", class: "small", text: noneLabel, "aria-label": `${label}: ${noneLabel.toLowerCase()}` });
    none.dataset["key"] = `prop:${idKey}-none`;
    none.addEventListener("click", () => apply(cleared));

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
      const r = m.setStyle(o.id, key, v, look);
      if (!r.ok) { this.announce(r.message); update(String(styleNow()[key] ?? "")); return; }
      this.announce(`${label}: ${describe(v)}`);
    };
    this.colorUpdaters.set(idKey, update);
    update(String((look === "normal" ? o.style : o.states[look]?.style ?? {})[key] ?? ""));

    return h("fieldset", { class: "colorfield" }, h("legend", { text: label }),
      h("div", { class: "color-current" }, swatch, nameEl),
      themed.el,
      h("p", { class: "note", text: "Theme colours change when you change the theme. The other colours stay as they are." }),
      fixed.el,
      h("div", { class: "color-row" },
        h("label", { for: `p-${idKey}-picker`, text: "Custom" }), picker,
        h("label", { for: `p-${idKey}`, text: "Hex code" }), hex, none));
  }

  /** A sentence about how readable the text colour is on what is behind it, using the theme's real colours: for the object, and for the look being edited. */
  private updateContrast(o: OSObject): void {
    const m = this.model;
    if (!m) return;
    this.contrastNoteFor(o, "normal", this.propsBody.querySelector<HTMLElement>("#contrast-note"));
    const look = m.editingLookOf(o.id);
    if (look !== "normal") this.contrastNoteFor(o, look, this.propsBody.querySelector<HTMLElement>("#look-contrast-note"));
  }

  private contrastNoteFor(o: OSObject, look: string, note: HTMLElement | null): void {
    const m = this.model;
    if (!note || !m) return;
    const theme = m.theme;
    // A look is judged on its own over the object's style, and a look that makes the object see-through fades the text and what is behind it together.
    const style: Style = look === "normal" ? o.style : { ...o.style, ...(o.states[look]?.style ?? {}) };
    const own = style["color"];
    const text = own === undefined ? (o.type === "button" ? theme.colors.onAccentStrong : theme.colors.text) : normalizeHex(String(resolveValue(theme, String(own))));
    if (!text) { note.textContent = ""; return; }
    const fillValue = style["fill"];
    let fill: string | null = null;
    let name: string;
    if (fillValue !== undefined) {
      fill = normalizeHex(String(resolveValue(theme, String(fillValue))));
      if (!fill) { note.textContent = ""; return; }
      name = `the ${describeColor(m, String(fillValue))} fill`;
    } else if (o.type === "button") {
      fill = theme.colors.accentStrong;
      name = "the theme's button colour";
    } else {
      name = m.slide?.background ? "this slide's background" : "the theme's background";
    }
    const behind = backgroundColors(theme, m.slide?.background ?? null);
    const solid = solidnessOf(style, look);
    const pairs: [string, string][] = solid < 1
      ? behind.map((back): [string, string] => [mixHex(text, back, solid), fill ? mixHex(fill, back, solid) : back])
      : fill ? [[text, fill]] : behind.map((back): [string, string] => [text, back]);
    if (pairs.length === 0) { note.textContent = ""; return; }
    // For a gradient, judge against the colour that is hardest to read on.
    const worst = pairs.reduce((a, b) => (contrastRatio(b[0], b[1]) < contrastRatio(a[0], a[1]) ? b : a));
    const size = typeof style["fontSize"] === "number" ? style["fontSize"] : 22;
    note.textContent = contrastNote(worst[0], worst[1], solid < 1 ? `${name}, at ${percentOf(solid)}% solid` : name, size);
  }

  /** The answers, scoring and feedback of a quiz question. */
  /** A change to a question. If it was refused, or changed nothing, the boxes are put back as they were. */
  private questionEdit(m: Model, o: OSObject, edit: QuestionEdit, key = ""): void {
    const before = JSON.stringify(o.content);
    const msg = m.editQuestion(o.id, edit, key);
    if (msg) this.announce(msg);
    if (JSON.stringify(o.content) === before) {
      this.propsBody.dataset["for"] = "";
      this.renderProps();
    }
  }

  /** The Properties of a question: what belongs to its kind, then the scoring and feedback every kind has. */
  private quizFields(m: Model, o: OSObject): HTMLElement[] {
    const q = o.content as unknown as QuizContent;
    const slide = m.slide!;
    const edit = (e: QuestionEdit, key = "") => this.questionEdit(m, o, e, key);
    const kindFields = ((): HTMLElement[] => {
      switch (q.questionType) {
        case "multipleChoice":
        case "multipleResponse": return this.choiceFields(m, o, q, edit);
        case "shortAnswer": return this.shortFields(q, edit);
        case "numeric": return this.numericFields(q, edit);
        case "fillBlanks": return this.blanksFields(q, edit);
        case "matching": return this.matchingFields(q, edit);
        case "sequencing": return this.sequenceFields(q, edit);
        case "hotspot": return this.hotspotFields(m, o, q, edit);
      }
    })();

    const partial = q.questionType === "multipleResponse" || q.questionType === "fillBlanks" || q.questionType === "matching" || q.questionType === "sequencing";
    const layers = slide.layers.map((l) => ({ value: l.id, label: l.name }));
    const feedback = layers.length === 0
      ? [h("p", { class: "note", text: "This slide has no layers. Add layers for the feedback, then choose them here." })]
      : [
          this.selectField("fb-correct", "After a right answer", layers, q.feedback.correct, (v) => { const msg = m.setFeedbackLayer(o.id, "correct", v); if (msg) this.announce(msg); }),
          this.selectField("fb-incorrect", partial ? "After a wrong or partly right answer" : "After a wrong answer", layers, q.feedback.incorrect, (v) => { const msg = m.setFeedbackLayer(o.id, "incorrect", v); if (msg) this.announce(msg); }),
        ];

    return [
      ...kindFields,
      h("fieldset", {}, h("legend", { text: "Scoring" }),
        this.field("points", "Points", q.scoring.points, (v) => { const msg = m.setScoring(o.id, { points: Number(v) }); if (msg) this.announce(msg); else this.fillQuiz(o); }, { number: true }),
        this.field("attempts", "Attempts allowed", q.scoring.attemptsAllowed, (v) => { const msg = m.setScoring(o.id, { attemptsAllowed: Number(v) }); if (msg) this.announce(msg); else { this.announce("Attempts must be a whole number from 1 to 10."); this.fillQuiz(o); } }, { number: true }),
        h("p", { class: "note", text: partial
          ? "A learner earns a share of the points for the parts that are right. The best of the attempts counts, so trying again never takes marks away. The question is finished when every part is right or the attempts are used up."
          : "A right answer earns all the points and a wrong one none. The question is finished when it is right or the attempts are used up." })),
      h("fieldset", {}, h("legend", { text: "Feedback layers" }), ...feedback),
    ];
  }

  /** A check box or a radio button with a name that says what it means. */
  private tick(kind: "checkbox" | "radio", id: string, label: string, checked: boolean, onChange: (on: boolean) => void, name?: string): HTMLInputElement {
    const box = h("input", { type: kind, id: `p-${id}`, "aria-label": label, ...(name ? { name } : {}), ...(checked ? { checked: true } : {}) });
    box.dataset["key"] = `prop:${id}`;
    box.addEventListener("change", () => onChange(box.checked));
    return box;
  }

  /** A line of text with a name for a screen reader, which tells the question when it is changed. */
  private line(id: string, label: string, value: string, onChange: (v: string) => void): HTMLInputElement {
    const box = h("input", { type: "text", id: `p-${id}`, "aria-label": label, value });
    box.dataset["key"] = `prop:${id}`;
    box.addEventListener("change", () => onChange(box.value));
    return box;
  }

  private choiceFields(m: Model, o: OSObject, q: ChoiceQuiz, edit: (e: QuestionEdit, key?: string) => void): HTMLElement[] {
    const multi = q.questionType === "multipleResponse";
    const rows = q.choices.map((c, i) => {
      const mark = this.tick(multi ? "checkbox" : "radio", `correct-${c.id}`, multi ? `Answer ${i + 1} is a right answer` : `Answer ${i + 1} is the correct answer`, c.correct,
        (on) => edit({ op: "choiceCorrect", id: c.id, correct: on }), multi ? undefined : `correct-${o.id}`);
      const text = h("input", { type: "text", id: `p-choice-${c.id}`, "aria-label": `Answer ${i + 1}`, value: c.label });
      text.dataset["key"] = `prop:choice-${c.id}`;
      text.addEventListener("change", () => { const msg = m.setChoiceLabel(o.id, c.id, text.value); if (msg) this.announce(msg); else text.value = c.label; });
      const del = this.small("Delete", "Delete this answer", () => {
        const msg = m.deleteChoice(o.id, c.id);
        if (msg) this.announce(msg);
      }, `Delete answer ${i + 1}`);
      this.setEnabled(del, q.choices.length > 2);
      return h("div", { class: "choice-row" }, mark, text, del);
    });
    const add = this.small("Add answer", "Add another answer", () => {
      const msg = m.addChoice(o.id);
      if (msg) this.announce(msg);
    });
    this.setEnabled(add, q.choices.length < LIMITS.choices);
    const several = this.tick("checkbox", "choice-multiple", "Several answers can be right", multi, (on) => edit({ op: "choiceMode", multiple: on }));
    const mix = this.tick("checkbox", "choice-shuffle", "Show the answers in a different order to each learner", q.shuffle === true, (on) => { const msg = m.setShuffleChoices(o.id, on); if (msg) this.announce(msg); });
    return [
      h("fieldset", {}, h("legend", { text: "Answers" }),
        h("p", { class: "note", text: multi
          ? "Tick every answer that is right. A learner earns part of the points for each right answer ticked, less a share for each wrong one."
          : "Select the radio button beside the correct answer. Exactly one answer is correct." }),
        ...rows, add,
        h("div", { class: "field check" }, several, h("label", { for: "p-choice-multiple", text: "Several answers can be right (multiple response)" })),
        h("div", { class: "field check" }, mix, h("label", { for: "p-choice-shuffle", text: "Show the answers in a different order to each learner" })),
        h("p", { class: "note", text: "Each learner sees their own order, and the same order each time they come back. Here in the editor you always see your own order. Do not write answers that depend on where they stand, such as \"A.\" or \"All of the above\": the Problems list warns about them." })),
    ];
  }

  private shortFields(q: ShortAnswerQuiz, edit: (e: QuestionEdit, key?: string) => void): HTMLElement[] {
    return [
      h("fieldset", {}, h("legend", { text: "Accepted answers" }),
        this.field("short-answers", "Answers that are right, one on each line", q.answers.join("\n"), (v) => edit({ op: "shortAnswers", text: v }), { area: true, rows: 4, describedBy: "short-note" }),
        h("div", { class: "field check" }, this.tick("checkbox", "case", "Capital letters must match", q.caseSensitive, (on) => edit({ op: "caseSensitive", on })), h("label", { for: "p-case", text: "Capital letters must match" })),
        h("p", { id: "short-note", class: "note", text: "A learner's answer is right if it matches any line. Extra spaces never matter. Add every spelling you will accept." })),
    ];
  }

  private numericFields(q: NumericQuiz, edit: (e: QuestionEdit, key?: string) => void): HTMLElement[] {
    const answer = Math.round(((q.min + q.max) / 2) * 1e10) / 1e10;
    const tolerance = Math.round(((q.max - q.min) / 2) * 1e10) / 1e10;
    const apply = () => edit({ op: "numeric", answer: Number((document.getElementById("p-num-answer") as HTMLInputElement).value), tolerance: Number((document.getElementById("p-num-tolerance") as HTMLInputElement).value || "0") });
    return [
      h("fieldset", {}, h("legend", { text: "Correct number" }),
        this.field("num-answer", "The correct number", answer, apply, { number: true }),
        this.field("num-tolerance", "How far off a learner may be, plus or minus", tolerance, apply, { number: true, describedBy: "num-note" }),
        h("p", { id: "num-note", class: "note", text: q.min === q.max ? `Only ${q.min} is right.` : `Any number from ${q.min} to ${q.max} is right. A learner may type 1,234 or 1234, and 1,5 for 1.5.` })),
    ];
  }

  private blanksFields(q: FillBlanksQuiz, edit: (e: QuestionEdit, key?: string) => void): HTMLElement[] {
    const typed = q.mode === "typed";
    const modes = [{ value: "typed", label: "Typed into the blanks" }, { value: "dropdown", label: "Chosen from a drop-down in each blank" }, { value: "drag", label: "Dragged from a word bank, or chosen from the drop-down" }];
    const sentence = this.field("blanks-text", "Sentence, with {1}, {2} and so on where a word is missing", q.text, (v) => edit({ op: "blanksText", text: v }), { area: true, rows: 4, describedBy: "blanks-note" });
    const insert = this.small("Insert a blank", "Put the next blank into the sentence where the cursor was", () => {
      const box = document.getElementById("p-blanks-text") as HTMLTextAreaElement | null;
      edit({ op: "insertBlank", at: box?.selectionStart ?? q.text.length });
    });
    const answers = q.blanks.map((b) => typed
      ? this.field(`blank-${b.id}`, `Blank ${b.id}: answers that are right, one on each line`, b.answers.join("\n"), (v) => edit({ op: "blankAnswers", id: b.id, text: v }), { area: true, rows: 2 })
      : this.field(`blank-${b.id}`, `Blank ${b.id}: the right word`, b.answers[0] ?? "", (v) => edit({ op: "blankAnswers", id: b.id, text: v })));
    const parts: HTMLElement[] = [
      h("fieldset", {}, h("legend", { text: "Sentence" }),
        this.selectField("blanks-mode", "How learners fill the blanks", modes, q.mode, (v) => edit({ op: "blanksMode", mode: v as FillBlanksQuiz["mode"] })),
        sentence, h("div", { class: "btn-row" }, insert),
        h("p", { id: "blanks-note", class: "note", text: "A learner earns a share of the points for each blank that is right. The sentence is read to a screen reader with each blank named, for example Blank 1 of 2." })),
      h("fieldset", {}, h("legend", { text: "Answers" }), ...answers),
    ];
    if (typed) {
      parts.push(h("fieldset", {}, h("legend", { text: "Typed answers" }),
        h("div", { class: "field check" }, this.tick("checkbox", "case", "Capital letters must match", q.caseSensitive, (on) => edit({ op: "caseSensitive", on })), h("label", { for: "p-case", text: "Capital letters must match" })),
        h("p", { class: "note", text: "Extra spaces never matter." })));
    } else {
      parts.push(h("fieldset", {}, h("legend", { text: "Word bank" }),
        this.field("extra-words", "Extra words that are right nowhere, one on each line", extraWordsOf(q).join("\n"), (v) => edit({ op: "extraWords", text: v }), { area: true, rows: 3, describedBy: "bank-note" }),
        h("p", { id: "bank-note", class: "note", text: `Words offered: ${q.wordBank.join(", ")}. The right words are always in the bank. Learners always have a drop-down in each blank, which is how a keyboard answers.` })));
    }
    return parts;
  }

  private matchingFields(q: MatchingQuiz, edit: (e: QuestionEdit, key?: string) => void): HTMLElement[] {
    const rows = q.pairs.map((p, i) => {
      const premise = this.line(`pair-${p.id}-premise`, `Item ${i + 1}`, p.premise, (v) => edit({ op: "pairText", id: p.id, field: "premise", text: v }));
      const match = this.line(`pair-${p.id}-match`, `Match for item ${i + 1}`, p.match, (v) => edit({ op: "pairText", id: p.id, field: "match", text: v }));
      const earlier = this.small("Move earlier", "Move this pair earlier", () => edit({ op: "movePair", id: p.id, delta: -1 }), `Move earlier: pair ${i + 1}`);
      const later = this.small("Move later", "Move this pair later", () => edit({ op: "movePair", id: p.id, delta: 1 }), `Move later: pair ${i + 1}`);
      const del = this.small("Delete", "Delete this pair", () => edit({ op: "deletePair", id: p.id }), `Delete pair ${i + 1}`);
      this.setEnabled(earlier, i > 0);
      this.setEnabled(later, i < q.pairs.length - 1);
      this.setEnabled(del, q.pairs.length > 2);
      return h("div", { class: "pair-row", role: "group", "aria-label": `Pair ${i + 1}` }, premise, match, h("div", { class: "btn-row" }, earlier, later, del));
    });
    const add = this.small("Add pair", "Add another item and its match", () => edit({ op: "addPair" }));
    this.setEnabled(add, q.pairs.length < LIMITS.pairs);
    return [
      h("fieldset", {}, h("legend", { text: "Items and their matches" }),
        h("p", { class: "note", text: "Each row is an item and the match that is right for it. Learners see the matches mixed up, in a list for each item. A learner earns a share of the points for each item matched rightly." }),
        ...rows, add),
      h("fieldset", {}, h("legend", { text: "Extras" }),
        this.field("extras", "Extra matches that fit nothing, one on each line", q.extras.join("\n"), (v) => edit({ op: "extras", text: v }), { area: true, rows: 3 }),
        h("div", { class: "field check" }, this.tick("checkbox", "drag", "Learners can also drag the matches onto the items", q.drag, (on) => edit({ op: "drag", on })), h("label", { for: "p-drag", text: "Learners can also drag the matches onto the items" })),
        h("p", { class: "note", text: "Dragging is an extra. The drop-down for each item is always there, which is how a keyboard and a screen reader answer." })),
    ];
  }

  private sequenceFields(q: SequencingQuiz, edit: (e: QuestionEdit, key?: string) => void): HTMLElement[] {
    const rows = q.items.map((item, i) => {
      const text = this.line(`item-${item.id}`, `Item ${i + 1} in the right order`, item.text, (v) => edit({ op: "itemText", id: item.id, text: v }));
      const earlier = this.small("Move earlier", "Move this item earlier", () => edit({ op: "moveItem", id: item.id, delta: -1 }), `Move earlier: item ${i + 1}`);
      const later = this.small("Move later", "Move this item later", () => edit({ op: "moveItem", id: item.id, delta: 1 }), `Move later: item ${i + 1}`);
      const del = this.small("Delete", "Delete this item", () => edit({ op: "deleteItem", id: item.id }), `Delete item ${i + 1}`);
      this.setEnabled(earlier, i > 0);
      this.setEnabled(later, i < q.items.length - 1);
      this.setEnabled(del, q.items.length > 2);
      return h("div", { class: "pair-row", role: "group", "aria-label": `Item ${i + 1}` }, text, h("div", { class: "btn-row" }, earlier, later, del));
    });
    const add = this.small("Add item", "Add another item", () => edit({ op: "addItem" }));
    this.setEnabled(add, q.items.length < LIMITS.items);
    return [
      h("fieldset", {}, h("legend", { text: "Items, in the right order" }),
        h("p", { class: "note", text: "List the items in the order that is right. Learners see them mixed up and put them in order with Move up and Move down. A learner earns a share of the points for each item in its right place." }),
        ...rows, add,
        h("div", { class: "field check" }, this.tick("checkbox", "drag", "Learners can also drag the items into order", q.drag, (on) => edit({ op: "drag", on })), h("label", { for: "p-drag", text: "Learners can also drag the items into order" })),
        h("p", { class: "note", text: "Dragging is an extra. The buttons are always there, which is how a keyboard and a screen reader answer." })),
    ];
  }

  private hotspotFields(m: Model, o: OSObject, q: HotspotQuiz, edit: (e: QuestionEdit, key?: string) => void): HTMLElement[] {
    const regions = q.regions.map((r, i) => {
      const num = (key: "x" | "y" | "width" | "height", label: string) => this.field(`region-${r.id}-${key}`, `${label}, percent`, r[key], (v) => edit({ op: "regionRect", id: r.id, patch: { [key]: Number(v) } }), { number: true });
      const del = this.small("Delete", "Delete this area", () => edit({ op: "deleteRegion", id: r.id }), `Delete area ${i + 1}`);
      this.setEnabled(del, q.regions.length > 2);
      return h("fieldset", { class: "region" }, h("legend", { text: `Area ${i + 1}` }),
        this.field(`region-${r.id}-label`, "Label, which a screen reader reads in the list", r.label, (v) => edit({ op: "regionLabel", id: r.id, label: v })),
        h("div", { class: "field check" }, this.tick("checkbox", `region-${r.id}-correct`, `${r.label} is a right area`, r.correct, (on) => edit({ op: "regionCorrect", id: r.id, correct: on })), h("label", { for: `p-region-${r.id}-correct`, text: "This is a right area" })),
        num("x", "Left edge"), num("y", "Top edge"), num("width", "Width"), num("height", "Height"), h("div", { class: "btn-row" }, del));
    });
    const add = this.small("Add area", "Add another area to the picture", () => edit({ op: "addRegion" }));
    this.setEnabled(add, q.regions.length < LIMITS.regions);
    return [
      h("fieldset", {}, h("legend", { text: "Picture" }),
        h("p", { class: "note", text: `The picture is ${q.image.src === "" ? "not chosen yet" : q.image.src.split("/").pop()}.` }),
        this.field("hotspot-alt", "What the picture shows (required)", q.image.alt, (v) => edit({ op: "hotspotAlt", alt: v }), { area: true, rows: 3, describedBy: "hotspot-note" }),
        h("div", { class: "btn-row" }, this.small("Choose another picture...", "Pick a picture from your computer to use instead", () => void this.changeHotspotPicture(o, edit))),
        h("p", { id: "hotspot-note", class: "note", text: "This is read to a screen reader, which cannot see the picture. Describe it well enough to choose between the areas." })),
      h("fieldset", {}, h("legend", { text: "Areas" }),
        h("p", { class: "note", text: "Each area is a box on the picture. Places and sizes are percentages of the picture: left and top edges, then width and height. Every area is also listed under the picture by its label, so a keyboard and a screen reader can choose it. The canvas shows the areas as dashed boxes, solid for a right one." }),
        ...regions, add),
    ];
  }

  /** Pick a picture from the computer and use it for a hotspot question. */
  private async changeHotspotPicture(o: OSObject, edit: (e: QuestionEdit, key?: string) => void): Promise<void> {
    const m = this.model;
    if (!m) return;
    try {
      const picked = await backend.pickImage();
      if (!picked) return;
      edit({ op: "hotspotImage", src: await backend.importImage(m.dir, picked) });
    } catch (err) {
      this.announce(`Could not use that picture. ${errorText(err)}`);
    }
    void o;
  }

  /** How an interaction behaves, and its items. */
  private interactionFields(m: Model, o: OSObject): HTMLElement[] {
    const c = o.content as unknown as InteractionContent;
    const kinds: { value: InteractionContent["kind"]; label: string }[] = [
      { value: "clickReveal", label: "Click and reveal" }, { value: "accordion", label: "Accordion" }, { value: "flipCards", label: "Flip cards" },
      { value: "tabs", label: "Tabs" }, { value: "steps", label: "Step process" }, { value: "carousel", label: "Content carousel" },
      { value: "glossary", label: "Glossary" }, { value: "timeline", label: "Timeline" }, { value: "processCircle", label: "Process circle" },
      { value: "pyramidStack", label: "Pyramid stack" }, { value: "pyramidMatrix", label: "Pyramid matrix" }, { value: "circleMatrix", label: "Circle matrix" },
      { value: "labeledGraphic", label: "Labeled graphic" },
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
    if (c.kind === "labeledGraphic") {
      const box = h("input", { id: "p-ix-guided", type: "checkbox", ...(c.guided === true ? { checked: true } : {}) });
      box.dataset["key"] = "prop:ix-guided";
      box.addEventListener("change", () => { const msg = m.setInteractionGuided(o.id, box.checked); if (msg) this.announce(msg); });
      behaviour.push(h("div", { class: "field check" }, box, h("label", { for: "p-ix-guided", text: "Step through the markers in order, with Previous and Next buttons" })));
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
      if (c.kind === "labeledGraphic") {
        // Where the marker sits, as two numbers: the way to place it without a mouse, and a check on what the picture above shows.
        const at = (axis: "x" | "y", label: string) => this.field(`ix-${item.id}-${axis}`, label, item[axis] ?? "", (v) => {
          const n = Number(v);
          const msg = v.trim() === "" || !Number.isFinite(n) ? "Type a number from 0 to 100." : m.setItemPosition(o.id, item.id, axis === "x" ? n : item.x ?? 0, axis === "y" ? n : item.y ?? 0);
          if (msg) this.announce(msg);
          this.fillInteraction(o);
        }, { number: true });
        parts.push(at("x", "Marker: percent across from the left"), at("y", "Marker: percent down from the top"));
      }
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
        parts.push(this.small("Add picture...", "Add a picture to this item", () => void this.addItemImage(o.id, item.id), `Add picture: item ${i + 1}`));
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
          }, `Use the item's text as narration: item ${i + 1}`)],
        })));
      const earlier = this.small("Move earlier", "Move this item earlier", () => { const msg = m.moveItem(o.id, item.id, -1); if (msg) this.announce(msg); }, `Move earlier: item ${i + 1}`);
      const later = this.small("Move later", "Move this item later", () => { const msg = m.moveItem(o.id, item.id, 1); if (msg) this.announce(msg); }, `Move later: item ${i + 1}`);
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
      ...(c.kind === "labeledGraphic" ? this.graphicFields(m, o) : []),
      h("fieldset", {}, h("legend", { text: "Items" }),
        h("p", { class: "note", text: "Each item can say its own words when the learner opens it, and a Listen button in the item plays them again. Text that has no audio is a barrier for some learners, so give every item narration." }),
        h("div", { class: "btn-row" }, add, narrateAll),
        ...items.map((x) => x)),
    ];
  }

  // ---- icons, and buttons that go somewhere

  /** Ask for an icon from the list. Null if the author cancelled. */
  private async chooseIcon(heading: string): Promise<IconContent | null> {
    const entry = await pickIcon({
      heading,
      load: () => loadIcons(async () => {
        const r = await fetch("icons/lucide.json");
        if (!r.ok) throw new Error(`The icon list is missing (${r.status}).`);
        return r.json();
      }),
      announce: (msg) => this.announce(msg),
    });
    return entry ? iconContent(entry) : null;
  }

  private async addIcon(): Promise<void> {
    const m = this.model;
    if (!m) return;
    const icon = await this.chooseIcon("Add an icon");
    this.addKind.focus();
    if (!icon) return;
    const o = m.addIcon(icon);
    if (o) {
      this.announce(`Added the ${iconWords(icon.name)} icon. It needs alt text: say what it means, for example "Next", in the Alt text field, or mark it decorative. The icon set calls it "${iconWords(icon.name)}", which you can use as a start.`);
      document.getElementById("p-alt")?.focus();
    }
  }

  /** What an icon object has in the Properties panel: which icon, how it is drawn, and a way to swap it. */
  private iconFields(m: Model, o: OSObject): HTMLElement[] {
    const icon = o.content as unknown as IconContent;
    return [h("fieldset", {}, h("legend", { text: "Icon" }),
      h("p", { class: "note", text: `The ${iconWords(icon.name)} icon, from Lucide. A course that uses an icon names Lucide on its credits page. The icon is drawn in the colour below and takes the theme's colours; make it 24 pixels or more each way so it can be seen.` }),
      h("div", { class: "btn-row" }, this.small("Change icon...", "Choose a different icon", () => void (async () => {
        const next = await this.chooseIcon("Choose a different icon");
        document.getElementById("p-icon-change")?.focus();
        if (!next) return;
        const msg = m.changeIcon(o.id, next);
        if (msg) this.announce(msg);
      })())),
    )];
  }

  /** A button's look, and the icon beside its words. */
  private buttonLookFields(m: Model, o: OSObject): HTMLElement[] {
    const look = m.buttonLook(o.id);
    const icon = o.content["icon"] as IconContent | undefined;
    const say = (msg: string | null) => { if (msg) this.announce(msg); };
    const out: HTMLElement[] = [
      this.selectField("button-look", "Look", [
        ...BUTTON_LOOKS.map((l) => ({ value: l.id, label: l.label })),
        { value: CUSTOM_LOOK, label: "Your own colours", disabled: true },
      ], look, (v) => say(m.setButtonLook(o.id, v))),
      h("p", { class: "note", text: "A look sets the button's colours, outline and roundness from the theme, so it follows the theme and stays readable. Its words, font and size, and what it does, are not changed. Change the colours below for a look of your own." }),
    ];
    if (!icon) {
      out.push(this.small("Add an icon...", "Show a small picture before or after the button's words", () => void (async () => {
        const chosen = await this.chooseIcon("Choose an icon for the button");
        document.getElementById("p-button-look")?.focus();
        if (chosen) say(m.setButtonIcon(o.id, chosen));
      })()));
    } else {
      out.push(
        h("p", { class: "note", text: `Icon: ${iconWords(icon.name)}. It is decoration: the button's words are its name, so a screen reader never says the icon.` }),
        this.selectField("button-icon-side", "Icon is", [{ value: "before", label: "Before the words" }, { value: "after", label: "After the words" }], o.content["iconPlacement"] === "after" ? "after" : "before", (v) => say(m.setButtonIconPlacement(o.id, v as "before" | "after"))),
        h("div", { class: "btn-row" },
          this.small("Change icon...", "Choose a different icon for this button", () => void (async () => {
            const chosen = await this.chooseIcon("Choose an icon for the button");
            document.getElementById("p-button-look")?.focus();
            if (chosen) say(m.setButtonIcon(o.id, chosen));
          })()),
          this.small("Remove icon", "Take the icon off this button", () => say(m.setButtonIcon(o.id, null)))),
      );
    }
    return out;
  }

  // ---- scenarios

  /** The situation being edited in the panel: the one the author chose, or the start. */
  private scenarioSelected(objectId: string, c: ScenarioContent): string {
    const id = this.scenarioSelect.get(objectId);
    return id && c.nodes.some((n) => n.id === id) ? id : c.start;
  }

  /**
   * A choice of variable of one type, for a scenario: the ones the project has, "A new variable" which is made on the spot, and
   * (where it makes sense) a way to choose none.
   */
  private scenarioVariable(m: Model, id: string, label: string, type: Variable["type"], base: string, current: string | null, none: string | null, onPick: (variable: string | null) => void): HTMLElement {
    const NEW = "__new";
    const usable = m.variables.filter((v) => v.type === type);
    return this.selectField(id, label, [
      ...(none === null ? [] : [{ value: "", label: none }]),
      ...(current && !usable.some((v) => v.id === current) ? [{ value: current, label: `${current} (not defined)`, disabled: true }] : []),
      ...usable.map((v) => ({ value: v.id, label: v.name })),
      { value: NEW, label: "A new variable" },
    ], current ?? "", (v) => {
      if (v === NEW) {
        const made = m.addVariable(type, base);
        this.announce(`Made the variable ${made.name}.`);
        onPick(made.id);
      } else onPick(v === "" ? null : v);
    });
  }

  private scenarioFields(m: Model, o: OSObject): HTMLElement[] {
    const c = o.content as unknown as ScenarioContent;
    const cast = m.characters;
    const say = (msg: string | null) => {
      if (msg) this.announce(msg);
      // A refused change leaves the model as it was, so put the box back to what the model says.
      this.fillScenario(o, true);
    };
    const check = (id: string, label: string, on: boolean, change: (on: boolean) => void): HTMLElement => {
      const box = h("input", { id: `p-${id}`, type: "checkbox", ...(on ? { checked: true } : {}) });
      box.dataset["key"] = `prop:${id}`;
      box.addEventListener("change", () => change(box.checked));
      return h("div", { class: "field check" }, box, h("label", { for: `p-${id}`, text: label }));
    };
    const where = (list: HTMLElement[], empty: string): HTMLElement[] => (list.length > 0 ? list : [h("p", { class: "note", text: empty })]);

    // ---- the whole scenario
    const settings = h("fieldset", {}, h("legend", { text: "Scenario" }),
      h("p", { class: "note", text: "A branching story. The learner reads a situation, chooses what to do, sees what happens, and the story goes on in another situation until an ending (a situation with no choices). It is made of real headings, lists and buttons, so a keyboard and a screen reader work in it." }),
      this.selectField("sc-start", "Starts at", c.nodes.map((n, i) => ({ value: n.id, label: situationLabel(c, n, i) })), c.start, (v) => say(m.setScenarioStart(o.id, v))),
      check("sc-retry", "The learner can take back their last choice", c.allowRetry, (on) => say(m.setScenarioRetry(o.id, on))),
      this.scenarioVariable(m, "sc-you", "Who the learner is", "string", "character", c.you, "Just \"you\"", (v) => say(m.setScenarioYou(o.id, v))),
      h("p", { class: "note", text: "Lines said by \"you\" show the person the learner chose with a Choose a character input (it saves their id in a text variable; pick that variable here). Before a choice is made, or if you pick none, they show just \"You\"." }),
      this.scenarioVariable(m, "sc-finished", "At an ending, set (true or false)", "boolean", "finished", c.finishedVariable, "Nothing", (v) => say(m.setScenarioFinished(o.id, v))),
      h("p", { class: "note", text: "A rule can then carry on from there, for example show a layer or a button when the variable becomes true. It is set the first time the learner reaches an ending." }),
      this.stacked(this.field("sc-reflection", "Something to think about at an ending (optional)", c.reflection, (v) => say(m.setScenarioReflection(o.id, v)), { area: true, rows: 3 })),
    );

    // ---- meters
    const meterRows = c.meters.map((meter, i) => h("fieldset", {}, h("legend", { text: `Meter ${i + 1} of ${c.meters.length}` }),
      this.field(`sc-meter-${meter.id}-label`, "Name", meter.label, (v) => say(m.setScenarioMeter(o.id, meter.id, { label: v }))),
      this.scenarioVariable(m, `sc-meter-${meter.id}-var`, "Shows", "number", "score", meter.variable, null, (v) => { if (v) say(m.setScenarioMeter(o.id, meter.id, { variable: v })); }),
      this.field(`sc-meter-${meter.id}-min`, "Smallest value", meter.min, (v) => say(m.setScenarioMeter(o.id, meter.id, { min: Number(v) })), { number: true }),
      this.field(`sc-meter-${meter.id}-max`, "Largest value", meter.max, (v) => say(m.setScenarioMeter(o.id, meter.id, { max: Number(v) })), { number: true }),
      h("div", { class: "btn-row" }, this.small("Delete meter", "Delete this meter", () => say(m.deleteScenarioMeter(o.id, meter.id)), `Delete meter ${i + 1}, ${meter.label}`))));
    const addMeter = this.small("Add a meter", "Add a bar that shows a number changing", () => { say(m.addScenarioMeter(o.id)); });
    this.setEnabled(addMeter, c.meters.length < S.LIMITS.meters);
    const meters = h("fieldset", {}, h("legend", { text: "Meters" }),
      h("p", { class: "note", text: "A meter shows the learner a number that their choices change, such as trust. Its value is read out when it changes. You do not have to use any: in real life nobody shows you a number, and a story with no meters leaves the learner to judge for themselves." }),
      addMeter, ...meterRows);

    // ---- situations
    const selected = this.scenarioSelected(o.id, c);
    const at = c.nodes.findIndex((n) => n.id === selected);
    const node = c.nodes[at]!;
    const picker = this.selectField("sc-pick", "Edit situation", c.nodes.map((n, i) => ({ value: n.id, label: situationLabel(c, n, i) })), selected, (v) => {
      this.scenarioSelect.set(o.id, v);
      this.renderProps();
      this.announce(`Editing situation ${c.nodes.findIndex((n) => n.id === v) + 1} of ${c.nodes.length}.`);
    });
    const addSituation = this.small("Add situation", "Add another situation", () => {
      const r = m.addSituation(o.id);
      if (r.id) {
        this.scenarioSelect.set(o.id, r.id);
        this.renderProps();
        document.getElementById("p-sc-title")?.focus();
      }
      if (r.message) this.announce(r.message);
    });
    const earlier = this.small("Move earlier", "Move this situation earlier in the list", () => say(m.moveSituation(o.id, node.id, -1)), `Move earlier: situation ${at + 1}`);
    const later = this.small("Move later", "Move this situation later in the list", () => say(m.moveSituation(o.id, node.id, 1)), `Move later: situation ${at + 1}`);
    const remove = this.small("Delete situation", "Delete this situation", () => say(m.deleteSituation(o.id, node.id)), `Delete situation ${at + 1}, ${node.title}`);
    this.setEnabled(addSituation, c.nodes.length < S.LIMITS.nodes);
    this.setEnabled(earlier, at > 0);
    this.setEnabled(later, at < c.nodes.length - 1);
    this.setEnabled(remove, c.nodes.length > 1);

    const lineEditor = (line: ScenarioLine, list: ScenarioLine[], index: number, noun: string, last: boolean): HTMLElement => {
      const k = `sc-line-${line.id}`;
      const said = (line.narration as Narration | null) ?? null;
      const speakers = [
        { value: "", label: "Narrator (no name shown)" },
        { value: YOU, label: "You, the learner's character" },
        ...cast.map((p) => ({ value: p.id, label: p.name })),
        ...(line.speaker && line.speaker !== YOU && !cast.some((p) => p.id === line.speaker) ? [{ value: line.speaker, label: `${line.speaker} (not in the cast)`, disabled: true }] : []),
      ];
      const up = this.small("Move earlier", `Move this ${noun} earlier`, () => say(m.moveScenarioLine(o.id, line.id, -1)), `Move earlier: ${noun} ${index + 1}`);
      const down = this.small("Move later", `Move this ${noun} later`, () => say(m.moveScenarioLine(o.id, line.id, 1)), `Move later: ${noun} ${index + 1}`);
      const del = this.small("Delete", `Delete this ${noun}`, () => say(m.deleteScenarioLine(o.id, line.id)), `Delete ${noun} ${index + 1}`);
      this.setEnabled(up, index > 0);
      this.setEnabled(down, index < list.length - 1);
      this.setEnabled(del, last ? true : list.length > 1);
      const voiceBox = said
        ? (() => {
          const d = h("details", { class: "sc-voice", ...(this.scenarioOpen.has(line.id) ? { open: true } : {}) }, h("summary", { text: "Spoken words, voice and pronunciation" }),
            ...this.narrationControls(m, `${o.id}/${line.id}`, said, {
              prefix: `${k}-narration`,
              note: "What the learner hears with this line. It starts as the line's words and follows them while they are the same. A person's lines are read in their own voice (set in Characters).",
              audioLabel: `Narration audio for ${noun} ${index + 1}`,
              rows: 3,
            }));
          d.addEventListener("toggle", () => { if (d.open) this.scenarioOpen.add(line.id); else this.scenarioOpen.delete(line.id); });
          return d;
        })()
        : h("p", { class: "note", text: "Not spoken: this line can only be read. A learner who cannot read the screen will not hear it. Tick Spoken aloud to give it a voice." });
      // The pose of the person who says it: a picture shown beside the line instead of their face. Only a person from the cast has poses.
      const who = line.speaker && line.speaker !== YOU ? cast.find((p) => p.id === line.speaker) : undefined;
      const poseField = who && (who.poses?.length ?? 0) > 0
        ? this.selectField(`${k}-pose`, "Pose beside the line", [
          { value: "", label: `${who.name}'s picture` },
          ...who.poses!.map((x) => ({ value: x.id, label: x.label })),
          ...(line.pose && !who.poses!.some((x) => x.id === line.pose) ? [{ value: line.pose, label: `${line.pose} (not one of their poses)`, disabled: true }] : []),
        ], line.pose ?? "", (v) => say(m.setScenarioLinePose(o.id, line.id, v === "" ? null : v)))
        : who?.library
          ? h("p", { class: "note", text: `${who.name} has no poses yet. Add some in Characters, then choose one here.` })
          : null;
      return h("fieldset", {}, h("legend", { text: `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${index + 1} of ${list.length}` }),
        this.selectField(`${k}-speaker`, "Said by", speakers, line.speaker ?? "", (v) => say(m.setScenarioLineSpeaker(o.id, line.id, v === "" ? null : v))),
        ...(poseField ? [poseField] : []),
        this.stacked(this.field(`${k}-text`, "Words", line.text, (v) => say(m.setScenarioLineText(o.id, line.id, v)), { area: true, rows: 3 })),
        check(`${k}-spoken`, "Spoken aloud", said !== null, (on) => say(m.setScenarioLineSpoken(o.id, line.id, on))),
        voiceBox,
        h("div", { class: "btn-row" }, up, down, del));
    };
    const addLineButton = (label: string, title: string, target: { nodeId: string } | { choiceId: string }, count: number, limit: number): HTMLElement => {
      const b = this.small(label, title, () => {
        const r = m.addScenarioLine(o.id, target);
        if (r.message) this.announce(r.message);
        if (r.id) document.getElementById(`p-sc-line-${r.id}-text`)?.focus();
      });
      this.setEnabled(b, count < limit);
      return b;
    };

    const choices = node.choices.map((choice, i) => {
      const k = `sc-choice-${choice.id}`;
      const effects = choice.effects.map((effect, j) => h("div", { class: "sc-effect" },
        this.scenarioVariable(m, `${k}-e${j}-var`, "Changes", "number", "score", effect.variable, null, (v) => { if (v) say(m.setScenarioEffect(o.id, choice.id, j, { variable: v })); }),
        this.field(`${k}-e${j}-add`, "Adds (a minus takes away)", effect.add, (v) => say(m.setScenarioEffect(o.id, choice.id, j, { add: Number(v) })), { number: true }),
        h("div", { class: "btn-row" }, this.small("Delete change", "Delete this change", () => say(m.deleteScenarioEffect(o.id, choice.id, j)), `Delete change ${j + 1} of choice ${i + 1}`))));
      const addEffect = this.small("Add a change to a number", "Make this choice add to (or take away from) a number variable", () => {
        const free = m.variables.find((v) => v.type === "number") ?? m.addVariable("number", "score");
        say(m.addScenarioEffect(o.id, choice.id, free.id));
      });
      this.setEnabled(addEffect, choice.effects.length < S.LIMITS.effects);
      const up = this.small("Move earlier", "Move this choice earlier", () => say(m.moveScenarioChoice(o.id, choice.id, -1)), `Move earlier: choice ${i + 1}`);
      const down = this.small("Move later", "Move this choice later", () => say(m.moveScenarioChoice(o.id, choice.id, 1)), `Move later: choice ${i + 1}`);
      const del = this.small("Delete choice", "Delete this choice", () => say(m.deleteScenarioChoice(o.id, choice.id)), `Delete choice ${i + 1}`);
      this.setEnabled(up, i > 0);
      this.setEnabled(down, i < node.choices.length - 1);
      return h("fieldset", { class: "sc-choice" }, h("legend", { text: `Choice ${i + 1} of ${node.choices.length}` }),
        this.stacked(this.field(`${k}-label`, "What the learner does", choice.label, (v) => say(m.setScenarioChoiceLabel(o.id, choice.id, v)), { area: true, rows: 2 })),
        this.selectField(`${k}-next`, "Leads to", c.nodes.map((n, j) => ({ value: n.id, label: situationLabel(c, n, j) })), choice.next, (v) => say(m.setScenarioChoiceNext(o.id, choice.id, v))),
        h("fieldset", {}, h("legend", { text: "Changes to numbers" }),
          h("p", { class: "note", text: "Choosing this can add to a number variable (or take away, with a minus sign). A rule or a meter can read it. It does not change any quiz score." }),
          ...effects, addEffect),
        h("fieldset", {}, h("legend", { text: "What happens straight after (optional)" }),
          h("p", { class: "note", text: "Lines shown right after the choice, before the next situation: a person's reaction, or what it led to. This is where the learner finds out why their choice mattered." }),
          ...choice.response.map((line, j) => lineEditor(line, choice.response, j, "response line", true)),
          addLineButton("Add a response line", "Add a line that is shown straight after this choice", { choiceId: choice.id }, choice.response.length, S.LIMITS.responses)),
        h("div", { class: "btn-row" }, up, down, del));
    });
    const addChoice = this.small("Add a choice", "Add a choice the learner can make here", () => {
      const r = m.addScenarioChoice(o.id, node.id);
      if (r.message) this.announce(r.message);
      if (r.id) document.getElementById(`p-sc-choice-${r.id}-label`)?.focus();
    });
    this.setEnabled(addChoice, node.choices.length < S.LIMITS.choices);

    const situation = h("fieldset", {}, h("legend", { id: "sc-situation-legend", text: `Situation ${at + 1} of ${c.nodes.length}: ${node.title}` }),
      this.field("sc-title", "Title (the heading)", node.title, (v) => say(m.setSituationTitle(o.id, node.id, v))),
      this.stacked(this.field("sc-prompt", "Question above the choices", node.prompt, (v) => say(m.setSituationPrompt(o.id, node.id, v)), { area: true, rows: 2 })),
      h("p", { class: "note", text: "For example \"What do you do?\". Leave it empty and the title names the choices." }),
      h("fieldset", {}, h("legend", { text: "What is happening" }),
        h("p", { class: "note", text: "Lines told by the narrator or said by a person. Each can be spoken aloud. A situation needs at least one." }),
        ...node.lines.map((line, j) => lineEditor(line, node.lines, j, "line", false)),
        addLineButton("Add a line", "Add a line to this situation", { nodeId: node.id }, node.lines.length, S.LIMITS.lines)),
      h("fieldset", {}, h("legend", { text: "Choices" }),
        ...where(choices, "This situation has no choices, so it is an ending: the learner stays here and sees their path. Add a choice to make the story go on from here."),
        addChoice));

    return [
      settings,
      meters,
      h("fieldset", {}, h("legend", { text: "Situations" }),
        h("p", { class: "note", text: `This scenario has ${c.nodes.length} ${c.nodes.length === 1 ? "situation" : "situations"}. Choose one to edit it. The order in the list is only for finding them: the learner follows the choices.` }),
        picker, h("div", { class: "btn-row" }, addSituation, earlier, later, remove)),
      situation,
    ];
  }

  /** Put every box of the scenario panel back to what the model holds, except the one the author is in (unless `force`). */
  private fillScenario(o: OSObject, force = false): void {
    const c = o.content as unknown as ScenarioContent;
    const set = (id: string, v: string | number) => {
      const el = this.propsBody.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#p-${id}`);
      if (el && (force || document.activeElement !== el)) el.value = String(v);
    };
    const tick = (id: string, on: boolean) => {
      const el = this.propsBody.querySelector<HTMLInputElement>(`#p-${id}`);
      if (el) el.checked = on;
    };
    set("sc-reflection", c.reflection);
    tick("sc-retry", c.allowRetry);
    set("sc-start", c.start);
    for (const meter of c.meters) {
      set(`sc-meter-${meter.id}-label`, meter.label);
      set(`sc-meter-${meter.id}-min`, meter.min);
      set(`sc-meter-${meter.id}-max`, meter.max);
    }
    // The situations are named in several lists, and the name is in the title: keep them all in step.
    c.nodes.forEach((n, i) => {
      for (const opt of Array.from(this.propsBody.querySelectorAll<HTMLOptionElement>(`select option[value="${n.id}"]`))) {
        if (opt.closest("select")?.id !== "p-sc-you") opt.textContent = situationLabel(c, n, i);
      }
    });
    const node = c.nodes.find((n) => n.id === this.scenarioSelected(o.id, c));
    if (!node) return;
    const legend = this.propsBody.querySelector<HTMLElement>("#sc-situation-legend");
    if (legend) legend.textContent = `Situation ${c.nodes.indexOf(node) + 1} of ${c.nodes.length}: ${node.title}`;
    set("sc-pick", node.id);
    set("sc-title", node.title);
    set("sc-prompt", node.prompt);
    const lines = [...node.lines, ...node.choices.flatMap((ch) => ch.response)];
    for (const line of lines) {
      const k = `sc-line-${line.id}`;
      const said = (line.narration as Narration | null) ?? null;
      set(`${k}-text`, line.text);
      set(`${k}-speaker`, line.speaker ?? "");
      set(`${k}-pose`, line.pose ?? "");
      tick(`${k}-spoken`, said !== null);
      if (said) { set(`${k}-narration-script`, said.script); set(`${k}-narration-voice`, said.voice); set(`${k}-narration-speed`, said.speed); }
    }
    for (const choice of node.choices) {
      const k = `sc-choice-${choice.id}`;
      set(`${k}-label`, choice.label);
      set(`${k}-next`, choice.next);
      choice.effects.forEach((e, j) => { set(`${k}-e${j}-var`, e.variable); set(`${k}-e${j}-add`, e.add); });
    }
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

  /** What a learner can do with a picture: enlarge it. */
  private imageFields(m: Model, o: OSObject): HTMLElement[] {
    const box = h("input", { id: "p-img-enlarge", type: "checkbox", ...(o.content["enlargeable"] === true ? { checked: true } : {}) });
    box.dataset["key"] = "prop:img-enlarge";
    box.addEventListener("change", () => {
      const msg = m.setImageEnlargeable(o.id, box.checked);
      if (msg) this.announce(msg);
      // A refused change leaves the model as it was, so the box goes back to what the model says.
      box.checked = o.content["enlargeable"] === true;
    });
    return [h("fieldset", {}, h("legend", { text: "Picture" }),
      h("div", { class: "field check" }, box, h("label", { for: "p-img-enlarge", text: "Let the learner enlarge this picture" })),
      h("p", { class: "note", text: "The picture gets an Enlarge button that opens it as big as the window allows, with a button to see it at its own size. The button is named after the picture's alt text, so describe the picture first. Not for a decorative picture." }))];
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
    if (c.kind === "character") {
      const cast = m.characters;
      const chosen = new Set(c.characters ?? []);
      const boxes = cast.map((p) => {
        const id = `in-char-${p.id}`;
        const box = h("input", { id: `p-${id}`, type: "checkbox", ...(chosen.has(p.id) ? { checked: true } : {}) });
        box.dataset["key"] = `prop:${id}`;
        box.addEventListener("change", () => {
          const next = cast.filter((q) => (q.id === p.id ? box.checked : chosen.has(q.id))).map((q) => q.id);
          const msg = m.setInputCharacters(o.id, next);
          if (msg) this.announce(msg);
          // A refused change leaves the model as it was, so the box goes back to what the model says.
          box.checked = ((o.content as unknown as InputContent).characters ?? []).includes(p.id);
        });
        return h("div", { class: "field check" }, box, h("label", { for: `p-${id}`, text: p.role.trim() ? `${p.name}, ${p.role.trim()}` : p.name }));
      });
      out.push(
        h("fieldset", {}, h("legend", { text: "Saved answer" }), ...this.variableField(m, o, "in-main", "Choice", null, c.variable),
          h("p", { class: "note", text: "The variable holds the id of the person the learner chose, and is empty until they choose. A scenario can show that person as \"you\", and a rule can branch on it." })),
        h("fieldset", {}, h("legend", { text: "People to choose between" }),
          h("p", { class: "note", text: "Two to eight people from the cast, shown as picture cards in the order of the cast. The picture's alt text is read once, so a learner who cannot see it still knows who they are choosing." }),
          ...(cast.length > 0 ? boxes : [h("p", { class: "note", text: "The cast is empty." })]),
          this.small("Characters...", "Open the cast: add people, pictures and voices", () => void this.openCast())));
      return out;
    }
    if (c.kind === "slider" || c.kind === "dial") {
      // A number the model refuses (it would leave the scale unusable) goes back to what the model holds, even while the box has focus.
      const scale = (field: "min" | "max" | "step", label: string, value: number | undefined) => {
        const box = this.field(`in-${field}`, label, value ?? "", (v) => {
          const msg = v.trim() === "" || !Number.isFinite(Number(v)) ? "Type a number." : m.setSliderScale(o.id, field, Number(v));
          if (msg) this.announce(msg);
          box.querySelector("input")!.value = String((o.content as unknown as InputContent)[field] ?? "");
        }, { number: true });
        return box;
      };
      const words = (field: "unit" | "startLabel" | "endLabel", label: string, value: string | undefined) =>
        this.field(`in-${field}`, label, value ?? "", (v) => { const msg = m.setSliderText(o.id, field, v); if (msg) this.announce(msg); });
      const show = h("input", { id: "p-in-showvalue", type: "checkbox", ...(c.showValue !== false ? { checked: true } : {}) });
      show.dataset["key"] = "prop:in-showvalue";
      show.addEventListener("change", () => { const msg = m.setSliderShowValue(o.id, show.checked); if (msg) this.announce(msg); });
      out.push(
        h("fieldset", {}, h("legend", { text: "Saved value" }), ...this.variableField(m, o, "in-main", "Value", null, c.variable),
          h("p", { class: "note", text: "The variable holds the number the learner has set, and follows it as they move the control, so a rule can react at once. It starts at the variable's own starting value, shown at the nearest point on the scale." })),
        h("fieldset", {}, h("legend", { text: "Scale" }),
          scale("min", "Lowest value", c.min), scale("max", "Highest value", c.max), scale("step", "Step between values", c.step),
          h("p", { class: "note", text: "The step can have up to 3 decimals, and the scale up to 10000 steps. The keys move one step; Page Up and Page Down move ten; Home and End go to the ends." })),
        h("fieldset", {}, h("legend", { text: "Words" }),
          words("unit", "Unit after the number (such as % or days)", c.unit),
          words("startLabel", "What the lowest end means", c.startLabel),
          words("endLabel", "What the highest end means", c.endLabel),
          h("div", { class: "field check" }, show, h("label", { for: "p-in-showvalue", text: "Show the number beside the control" })),
          h("p", { class: "note", text: "A screen reader says the number, the unit, and at either end what that end means, such as \"0 points, Not at all\"." })));
      return out;
    }
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
      const earlier = this.small("Move earlier", `Move this ${noun.toLowerCase()} earlier`, () => { const msg = m.moveInputPart(o.id, p.id, -1); if (msg) this.announce(msg); }, `Move earlier: ${noun.toLowerCase()} ${i + 1}`);
      const later = this.small("Move later", `Move this ${noun.toLowerCase()} later`, () => { const msg = m.moveInputPart(o.id, p.id, 1); if (msg) this.announce(msg); }, `Move later: ${noun.toLowerCase()} ${i + 1}`);
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
    for (const field of ["min", "max", "step"] as const) set(`in-${field}`, String(c[field] ?? ""));
    for (const field of ["unit", "startLabel", "endLabel"] as const) set(`in-${field}`, c[field] ?? "");
    if (c.variable) { set("in-main-var", c.variable); set("in-main-varname", varName(c.variable)); }
    const parts = (c.kind === "checkbox" ? c.items : c.kind === "likert" || c.kind === "semantic" ? c.rows : c.options) ?? [];
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
      const add = this.small("Insert row below", "Insert a row below this one", () => { const msg = m.addTableRow(o.id, r); if (msg) this.announce(msg); }, `Insert row below: row ${r + 1}`);
      const del = this.small("Delete row", "Delete this row", () => { const msg = m.deleteTableRow(o.id, r); if (msg) this.announce(msg); }, `Delete row ${r + 1}`);
      this.setEnabled(add, t.rows.length < 30);
      this.setEnabled(del, t.rows.length > 1);
      return h("div", { class: "table-row", role: "group", "aria-label": `Row ${r + 1}` }, ...cells, add, del);
    });
    const colButtons = Array.from({ length: cols }, (_, c) => {
      const add = this.small(`Insert column after ${c + 1}`, "Insert a column after this one", () => { const msg = m.addTableColumn(o.id, c); if (msg) this.announce(msg); });
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

  /** The picture a labeled graphic sits on, what it shows, and where each marker goes on it. */
  private graphicFields(m: Model, o: OSObject): HTMLElement[] {
    const c = o.content as unknown as InteractionContent;
    const g = c.graphic ?? { src: "", alt: "" };
    return [
      h("fieldset", {}, h("legend", { text: "Picture" }),
        h("p", { class: "note", text: `The picture is ${g.src === "" ? "not chosen yet" : g.src.split("/").pop()}.` }),
        this.field("ix-graphic-alt", "What the picture shows (required)", g.alt, (v) => { const msg = m.setGraphicAlt(o.id, v); if (msg) this.announce(msg); }, { area: true, rows: 3, describedBy: "ix-graphic-note" }),
        h("div", { class: "btn-row" }, this.small(g.src === "" ? "Choose picture..." : "Choose another picture...", "Pick a picture from your computer for the markers to sit on", () => void this.chooseGraphic(o.id))),
        h("p", { id: "ix-graphic-note", class: "note", text: "This is read to a screen reader, which cannot see the picture. Say what it shows as a whole; each marker's own text says what is at that point." })),
      h("fieldset", {}, h("legend", { text: "Place the markers" }),
        h("p", { class: "note", text: "Choose a marker, then click the picture to move it there. With a marker chosen, the arrow keys move it one percent (five with Shift). Each item below also has its place as two numbers, which is the way to do it without a mouse." }),
        this.placementPreview(m, o)),
    ];
  }

  /** The picture with a button for each marker. Clicking the picture moves the chosen marker; the arrow keys nudge it. */
  private placementPreview(m: Model, o: OSObject): HTMLElement {
    const items = () => (o.content as unknown as InteractionContent).items;
    const frame = h("div", { class: "ix-place" });
    const pic = h("img", { class: "ix-place-img", alt: "" });
    const src = (o.content as unknown as InteractionContent).graphic?.src ?? "";
    if (src !== "") void backend.assetUrl(m.dir, src).then((url) => { pic.src = url; }).catch(() => undefined);
    frame.appendChild(pic);
    let active = items()[0]?.id ?? "";
    for (const [i, item] of items().entries()) {
      const b = h("button", { type: "button", class: "ix-place-marker" });
      b.dataset["item"] = item.id;
      b.textContent = String(i + 1);
      b.addEventListener("click", (e) => { e.stopPropagation(); active = item.id; this.refreshPlacement(o, active); });
      b.addEventListener("keydown", (e) => {
        const step = e.shiftKey ? 5 : 1;
        const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        const d = move[e.key];
        const now = items().find((x) => x.id === item.id);
        if (!d || !now) return;
        e.preventDefault();
        active = item.id;
        m.setItemPosition(o.id, item.id, (now.x ?? 0) + d[0], (now.y ?? 0) + d[1]);
        this.refreshPlacement(o, active);
        this.fillInteraction(o);
      });
      frame.appendChild(b);
    }
    frame.addEventListener("click", (e) => {
      const r = pic.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || !active) return;
      const msg = m.setItemPosition(o.id, active, ((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
      if (msg) this.announce(msg);
      this.refreshPlacement(o, active);
      this.fillInteraction(o);
    });
    this.refreshPlacement(o, active, frame);
    return frame;
  }

  /** Put each marker in the preview where the model says, say where it is to a screen reader, and show which one is chosen. */
  private refreshPlacement(o: OSObject, active: string, within: ParentNode = this.propsBody): void {
    const c = o.content as unknown as InteractionContent;
    c.items.forEach((item, i) => {
      const b = within.querySelector<HTMLElement>(`.ix-place-marker[data-item="${item.id}"]`);
      if (!b) return;
      const at = markerAt(item, i, c.items.length);
      b.style.left = `${at.x}%`;
      b.style.top = `${at.y}%`;
      b.setAttribute("aria-pressed", String(item.id === active));
      b.setAttribute("aria-label", `Marker ${i + 1}, ${item.title}, ${at.x} percent across and ${at.y} percent down. Press an arrow key to move it.`);
    });
  }

  /** Pick a picture from the computer for a labeled graphic's markers to sit on. */
  private async chooseGraphic(objectId: string): Promise<void> {
    const m = this.model;
    if (!m) return;
    try {
      const picked = await backend.pickImage();
      if (!picked) return;
      const msg = m.setGraphic(objectId, await backend.importImage(m.dir, picked));
      if (msg) this.announce(msg);
      document.getElementById("p-ix-graphic-alt")?.focus();
    } catch (err) {
      this.announce(`Could not use that picture. ${errorText(err)}`);
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
    if (c.kind === "labeledGraphic") {
      set("ix-graphic-alt", c.graphic?.alt ?? "");
      for (const item of c.items) { set(`ix-${item.id}-x`, String(item.x ?? "")); set(`ix-${item.id}-y`, String(item.y ?? "")); }
      const chosen = this.propsBody.querySelector<HTMLElement>('.ix-place-marker[aria-pressed="true"]')?.dataset["item"] ?? c.items[0]?.id ?? "";
      this.refreshPlacement(o, chosen);
    }
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
    set("points", q.scoring.points);
    set("attempts", q.scoring.attemptsAllowed);
    set("fb-correct", q.feedback.correct);
    set("fb-incorrect", q.feedback.incorrect);
  }

  /** A font choice. A font the editor does not list (from an older file) is kept and shown as it is. */
  private fontField(m: Model, o: OSObject, look = "normal"): HTMLElement {
    const own = look === "normal" ? o.style : o.states[look]?.style ?? {};
    // A look with no font of its own uses the object's.
    const current = look === "normal" ? String(own["fontFamily"] ?? "system-ui") : String(own["fontFamily"] ?? "");
    const known = current === "" || FONT_CHOICES.some((f) => f.value === current);
    const options = [
      ...(look === "normal" ? [] : [{ value: "", label: "Same as normal" }]),
      ...(known ? [] : [{ value: current, label: `Current: ${current}` }]),
      ...FONT_CHOICES.map((f) => ({ value: f.value, label: f.label })),
    ];
    return this.selectField(look === "normal" ? "font" : "look-font", look === "normal" ? "Font" : `Font (${lookLabel(look)})`, options, current, (v) => {
      const r = m.setStyle(o.id, "fontFamily", v, look);
      this.announce(r.ok ? (v === "" ? "Font is the same as normal" : `Font changed to ${FONT_CHOICES.find((f) => f.value === v)?.label ?? v}`) : r.message);
    });
  }

  /** Edit the words of the chosen text in the Edit text dialog: bold, italic, underline, lists, headings and links. */
  private async editText(): Promise<void> {
    const m = this.model;
    const o = m?.object;
    if (!m || !o || o.type !== "text") return;
    const html = await openTextEditor({ name: o.name, html: String(o.content["html"] ?? ""), announce: (msg) => this.announce(msg) });
    if (html !== null) {
      const msg = m.setHtml(o.id, html);
      this.announce(msg ? `${msg}. Press Control Z to undo.` : "The text is as it was.");
    }
    this.renderProps(true);
    document.getElementById("p-edit-text")?.focus();
  }

  private textFields(m: Model, o: OSObject): HTMLElement[] {
    const html = String(o.content["html"] ?? "");
    const simple = parseSimpleText(html);
    const editButton = this.small("Edit text...", "Edit the words with bold, italic, underline, lists, headings and links (F2, or double click the text)", () => void this.editText());
    editButton.id = "p-edit-text";
    editButton.dataset["key"] = "prop:edit-text";
    const edit = h("div", { class: "btn-row" }, editButton);
    if (!simple) {
      return [
        h("p", { class: "note", id: "html-note", text: "This text has formatting: lists, bold, several paragraphs or the like. Edit text... opens it with buttons for each. Its HTML is shown below too, for changing by hand." }),
        edit,
        this.field("html", "HTML", html, (v) => { const msg = m.setHtml(o.id, v); if (msg) this.announce(msg); else this.fillValues(o); }, { area: true, rows: 6, describedBy: "html-note" }),
      ];
    }
    return [
      edit,
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
      ...this.valueFields(m, o, simple.text),
    ];
  }

  /**
   * Show a value in the words: the points so far, or a variable of the course's. It is written {{Name}} in the text, and the course puts the value there while it is played and
   * changes it when it changes. A text that shows a value can be a live region, so a screen reader says the new value (say the score, not every second of a clock).
   */
  private valueFields(m: Model, o: OSObject, text: string): HTMLElement[] {
    const choices = valueChoices(m.variables);
    const pick = this.selectField("value-pick", "Show a value in the text", [{ value: "", label: "Choose one..." }, ...choices.map((c) => ({ value: c.value, label: c.label }))], "", () => undefined);
    const insert = h("button", { type: "button", id: "value-insert", text: "Put it in the text" });
    insert.addEventListener("click", () => {
      const name = (document.getElementById("p-value-pick") as HTMLSelectElement | null)?.value ?? "";
      const box = document.getElementById("p-text") as HTMLTextAreaElement | null;
      if (!name || !box) {
        this.announce("Choose a value first.");
        return;
      }
      const at = box.selectionStart ?? box.value.length;
      box.value = insertReference(box.value, name, at, box.selectionEnd ?? at);
      box.dispatchEvent(new Event("change", { bubbles: true }));
      this.announce(`Put ${name} in the text. The course shows its value while it is played.`);
      box.focus();
    });
    const shown = referencesIn(text).length > 0;
    const role = o.accessibility.role;
    const out: HTMLElement[] = [pick, h("div", { class: "btn-row" }, insert)];
    if (shown && (role === "paragraph" || role === "status")) {
      const live = h("input", { id: "p-value-live", type: "checkbox", ...(role === "status" ? { checked: true } : {}), "aria-describedby": "value-live-note" });
      live.dataset["key"] = "prop:value-live";
      live.addEventListener("change", () => {
        m.setAccessibility(o.id, { role: live.checked ? "status" : "paragraph" });
        this.announce(live.checked ? "A screen reader will say this text when its value changes." : "A screen reader will not say this text when its value changes.");
      });
      out.push(h("div", { class: "field check" }, live, h("label", { for: "p-value-live", text: "Say changes aloud" })),
        h("p", { id: "value-live-note", class: "note", text: "A screen reader says the whole text again each time a value in it changes. Use it for something that changes now and then, like a score, not for something that changes all the time." }));
    }
    return out;
  }

  /** For text: whether the words sit in a speech or thought bubble, and which side the tail is on. */
  private bubbleFields(m: Model, o: OSObject): HTMLElement[] {
    const kind = isBubbleKind(o.content["bubble"]) ? o.content["bubble"] : "";
    return [
      this.selectField("bubble", "Bubble", [
        { value: "", label: "None (plain text)" }, { value: "speech", label: "Speech bubble" }, { value: "thought", label: "Thought bubble" },
      ], kind, (v) => {
        const msg = m.setTextBubble(o.id, v);
        if (msg) this.announce(msg);
      }),
      ...(kind ? [this.tailField(m, o)] : []),
    ];
  }

  /** Which side of a bubble its tail is on. The tail always hangs below, pointing at whoever is speaking or thinking. */
  private tailField(m: Model, o: OSObject): HTMLElement {
    return this.selectField("tail", "Tail", [{ value: "left", label: "On the left" }, { value: "right", label: "On the right" }], tailOf(o.content["tail"]), (v) => {
      const msg = m.setBubbleTail(o.id, v);
      if (msg) this.announce(msg);
    });
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
      if (e === "timerEnd") return "the time runs out";
      return { slideStart: "the slide opens", slideEnd: "the slide closes", variableChange: "any variable changes" }[e];
    };
    const ACTIONS: { value: RuleAction; label: string }[] = [
      { value: "jumpToSlide", label: "Go to a slide" }, { value: "nextSlide", label: "Go to the next slide" }, { value: "previousSlide", label: "Go to the previous slide" }, { value: "replaySlide", label: "Replay this slide" },
      { value: "showLayer", label: "Show a layer" }, { value: "hideLayer", label: "Hide a layer" },
      { value: "setVariable", label: "Set a variable" }, { value: "addToVariable", label: "Add to a number variable" },
      { value: "playMedia", label: "Play a video or audio" }, { value: "pauseMedia", label: "Pause a video or audio" },
      { value: "stopTimer", label: "Stop a timer" },
      { value: "changeState", label: "Change an object's look" },
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
      const targetLabel = ({ jumpToSlide: "Slide", showLayer: "Layer", hideLayer: "Layer", setVariable: "Variable", addToVariable: "Number variable", playMedia: "Which one", pauseMedia: "Which one", stopTimer: "Which timer", changeState: "Which object" } as Record<string, string>)[r.action] ?? "Target";
      if (isCourseAction(r.action)) {
        parts.push(h("p", { class: "note", text: r.action === "nextSlide" ? "Goes to whichever slide comes next in the course, even if the slides are moved about." : r.action === "previousSlide" ? "Goes to whichever slide comes before this one." : "Shows this slide again from the start: its timing, narration and layers." }));
      } else parts.push(this.selectField(`rule-${i}-target`, targetLabel, [
        ...(targets.some((t) => t.value === r.target) ? [] : [{ value: r.target, label: `${r.target} (missing)`, disabled: true }]),
        ...targets,
        ...(r.action === "setVariable" ? [{ value: NEW, label: "A new variable" }] : []),
        ...(r.action === "addToVariable" ? [{ value: NEW, label: "A new number variable" }] : []),
      ], r.target, (v) => {
        if (v === NEW) { const nv = r.action === "addToVariable" ? m.addVariable("number", "count") : m.addVariable("boolean", "flag"); say(m.updateRule(o.id, i, { target: nv.id })); return; }
        say(m.updateRule(o.id, i, { target: v }));
      }));
      if (r.action === "setVariable") parts.push(valueBox(`rule-${i}-value`, "To", type, r.value, (v) => { say(m.updateRule(o.id, i, { value: v })); this.renderProps(); }, r.target));
      if (r.action === "addToVariable") parts.push(valueBox(`rule-${i}-value`, "Add this much (a negative number takes away)", "number", r.value ?? 1, (v) => { say(m.updateRule(o.id, i, { value: v })); this.renderProps(); }));
      if (r.action === "changeState") {
        const choices = m.lookChoices(r.target);
        const look = String(r.value ?? "normal");
        parts.push(this.selectField(`rule-${i}-value`, "Change it to", [
          ...(choices.some((c) => c.value === look) ? [] : [{ value: look, label: `${look} (missing)`, disabled: true }]),
          ...choices,
        ], look, (v) => say(m.updateRule(o.id, i, { value: v }))));
        const spoken = m.lookMessage(r.target, look);
        parts.push(h("p", { class: "note", text: look === "normal" ? "Goes back to the object's own appearance. A screen reader says nothing."
          : spoken ? `A screen reader says: ${spoken}`
          : m.lookIsSilent(r.target, look) ? "A screen reader user is not told about this change. On that object, under Looks, write a spoken message for this look. The Problems list warns until you do."
          : "" }));
      }

      const conds = r.conditions.map((c, k) => {
        const vtype = m.variables.find((v) => v.id === c.variable)?.type;
        return h("div", { class: "cond", role: "group", "aria-label": `Condition ${k + 1}` },
          this.selectField(`rule-${i}-c${k}-var`, "Only if", [...(vtype ? [] : [{ value: c.variable, label: `${c.variable} (missing)`, disabled: true }]), ...m.variables.map((v) => ({ value: v.id, label: v.name }))], c.variable, (v) => say(m.updateCondition(o.id, i, k, { variable: v }))),
          this.selectField(`rule-${i}-c${k}-op`, "is", operatorsFor(vtype ?? "string").map((op) => ({ value: op, label: OPERATOR_LABELS[op] })), c.operator, (v) => say(m.updateCondition(o.id, i, k, { operator: v as Condition["operator"] }))),
          valueBox(`rule-${i}-c${k}-value`, "this value", vtype, c.value, (v) => { say(m.updateCondition(o.id, i, k, { value: v })); }, c.variable),
          this.small("Delete condition", "Delete this condition", () => say(m.deleteCondition(o.id, i, k)), `Delete condition ${k + 1} of rule ${i + 1}`));
      });
      const addCond = this.small("Add condition", "Only do this if a variable has a certain value", () => say(m.addCondition(o.id, i)), `Add condition: rule ${i + 1}`);
      const earlier = this.small("Move earlier", "Run this rule earlier", () => say(m.moveRule(o.id, i, -1)), `Move earlier: rule ${i + 1}`);
      const later = this.small("Move later", "Run this rule later", () => say(m.moveRule(o.id, i, 1)), `Move later: rule ${i + 1}`);
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

  /** Make a slide for each question in a spreadsheet the author saved as a CSV file (see docs/question-import.md). */
  private async addQuestionsFromFile(preset?: QuestionPreset): Promise<void> {
    const m = this.model;
    if (!m) return;
    const choice = await askQuestionImport(m.slide?.name ?? "", {
      pickFile: () => backend.pickQuestionFile(),
      readFile: (path) => backend.questionFileRead(path),
      pickTemplateSave: () => backend.pickQuestionTemplateSave(),
      writeTemplate: (dest, text) => backend.questionTemplateWrite(dest, text),
    }, preset);
    this.questionsFileBtn.focus();
    if (!choice) return;
    const msg = m.addQuestionSlides(choice.questions, { bank: choice.bank, shuffleAnswers: choice.shuffleAnswers });
    if (msg) this.announce(msg);
  }

  private async openBanksDialog(): Promise<void> {
    const m = this.model;
    if (!m) return;
    await openBanks(m, (msg) => this.announce(msg));
    this.banksBtn.focus();
    this.renderProps();
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
    // Editing a recording has keys of its own (Ctrl+S saves the edit, Ctrl+Z undoes it, F6 moves between its parts). None of them is for the course.
    if (target.closest(".recording-editor") || target.closest(".captions-dialog")) return;
    const typing = target.matches("input:not([type=checkbox]), textarea, select");
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void this.save(); }
    else if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); void this.open(); }
    else if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); void this.newProject(); }
    else if (mod && e.key.toLowerCase() === "p") { e.preventDefault(); if (e.shiftKey) void this.publish(); else void this.preview(); }
    else if (mod && !typing && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); }
    else if (mod && !typing && e.key.toLowerCase() === "y") { e.preventDefault(); this.redo(); }
    else if (mod && !typing && !e.altKey && e.key.toLowerCase() === "g" && this.model && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      if (e.shiftKey) this.ungroupObjects(); else this.groupObjects();
    }
    else if (e.key === "F6") { e.preventDefault(); this.cycleRegion(e.shiftKey ? -1 : 1); }
    else if (mod && !typing && !e.shiftKey && !e.altKey && this.model && !document.querySelector("dialog[open]")) {
      // Duplicate, copy, cut and paste work on the selected object. When words are selected on the page, Copy is theirs, not ours.
      const key = e.key.toLowerCase();
      const wordsSelected = (window.getSelection()?.toString() ?? "") !== "";
      if (key === "l") { e.preventDefault(); this.toggleLockObjects(); }
      else if (key === "a" && !wordsSelected) { e.preventDefault(); this.selectAllObjects(); }
      else if (key === "d") { e.preventDefault(); if (this.slideList.contains(document.activeElement)) this.duplicateSlide(); else this.duplicateObject(); }
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
        const id = key.replace(/^object:/, "");
        // On one of several selected objects, Delete removes them all; on any other it removes that one.
        if (!this.model?.selected.some((x) => x.id === id)) this.model?.selectObject(id);
        this.deleteObject();
      },
    );
    // Shift with the arrow keys stretches the selection to the item the focus moved to, and Ctrl and Space adds or removes the focused one.
    this.objectList.addEventListener("keydown", (e) => {
      const m = this.model;
      const key = (document.activeElement as HTMLElement | null)?.dataset?.["key"];
      if (!m || !key?.startsWith("object:")) return;
      const id = key.replace(/^object:/, "");
      let msg: string | null = null;
      if (e.shiftKey && ["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) msg = m.selectRange(id);
      else if ((e.ctrlKey || e.metaKey) && e.key === " ") { e.preventDefault(); msg = m.toggleSelected(id); }
      if (msg) this.announce(msg);
    });
    this.wireArrows(this.problemList);
    for (const list of [this.slideList, this.objectList, this.problemList]) {
      list.addEventListener("focusin", (e) => { if ((e.target as HTMLElement).matches?.("button.item")) this.rove(list, e.target as Element); });
    }
  }
}
