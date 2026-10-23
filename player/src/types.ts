// Types for the project format. Hand-written from schema/*.json and docs/format-spec.md.
// If the schema changes, change this file in the same commit.

export type Primitive = number | boolean | string;

export interface Variable {
  id: string;
  name: string;
  type: "number" | "boolean" | "string";
  initial: Primitive;
}

export interface Project {
  schemaVersion: string;
  meta: { title: string; author: string; language: string; created: string; modified: string };
  stage: { width: number; height: number };
  variables: Variable[];
  theme: { ref: string } | null;
  /** Whether the published course shows its credits page. */
  credits: boolean;
  /** Files and folders left out of the source/ copy of the project that a published package carries. See exclude.ts. */
  sourceExclude?: string[];
  /** The cast: people a scenario can show and a learner can choose to be. Absent means none. */
  characters?: Character[];
  /**
   * What counts as completing the course, besides finishing every quiz: "all" is having seen every slide, "last" is
   * having reached the last slide. A course published before format 0.9.0 has no setting and counts every slide.
   */
  completion: { slides: "all" | "last" };
  scenes: { id: string; name: string; slides: string[] }[];
  /** The PowerPoint decks slides were imported from. Absent means none. */
  sources?: DeckSource[];
  /** Question banks: runs of slides of which each learner is shown some. Absent means none. */
  banks?: Bank[];
}

/** A question bank. Each learner is shown `draw` of its slides, picked at random when they begin, in the author's order or mixed. See bank.ts. */
export interface Bank {
  id: string;
  name: string;
  /** The slides it holds, which sit together in the course. */
  slides: string[];
  /** How many of them each learner is shown. */
  draw: number;
  /** Show the ones picked in a random order, not the author's. */
  shuffle: boolean;
}

/** A PowerPoint deck slides were imported from, and how it was laid on the stage, so a changed deck is placed the same way. */
export interface DeckSource {
  id: string;
  /** The deck's file name. */
  name: string;
  importedAt: string;
  syncedAt?: string;
  /** The deck's slide size in its own units (English Metric Units, 914,400 to the inch). */
  slideWidth: number;
  slideHeight: number;
  pixelsPerInch: number;
  offsetX: number;
  offsetY: number;
  /** The deck's own numbers for every slide it had when last imported or brought up to date. */
  seen?: string[];
}

/** One drawn part of an icon. Only these tags and attributes exist. See icon.ts. */
export interface IconShape {
  tag: "path" | "circle" | "rect" | "ellipse" | "line" | "polyline" | "polygon";
  d?: string;
  points?: string;
  cx?: number; cy?: number; r?: number; rx?: number; ry?: number;
  x?: number; y?: number; width?: number; height?: number;
  x1?: number; y1?: number; x2?: number; y2?: number;
  fill?: "none" | "currentColor";
}

/** An icon, kept as its shapes. Used by the icon object, and by a button that shows one before its label. */
export interface IconContent {
  set: "lucide";
  name: string;
  shapes: IconShape[];
}

/** One more picture of a person, in a pose, to show with a line of a scenario. */
export interface CharacterPose {
  id: string;
  /** What a menu says. */
  label: string;
  /** A file under assets/. */
  src: string;
}

/** A person in the project's cast. See docs/format-spec.md. */
export interface Character {
  id: string;
  name: string;
  /** A few words on who they are, or empty. */
  role: string;
  /** The narration voice that reads their lines. */
  voice: string;
  picture: { src: string; alt: string; decorative: boolean } | null;
  /** More pictures of them, each in a pose. Absent means none. */
  poses?: CharacterPose[];
  /** Where they came from in the library of people (a character pack and a person in it), so the editor can offer more poses. The course never uses it. */
  library?: { pack: string; person: string };
}

export type EventName =
  | "click"
  | "keyActivate"
  | "slideStart"
  | "slideEnd"
  | "mediaComplete"
  | "timerEnd"
  | "variableChange";

export type ActionName =
  | "nextSlide"
  | "previousSlide"
  | "replaySlide"
  | "jumpToSlide"
  | "showLayer"
  | "hideLayer"
  | "setVariable"
  | "playMedia"
  | "pauseMedia"
  | "stopTimer"
  | "changeState";

export type Operator =
  | "equals"
  | "notEquals"
  | "lessThan"
  | "lessThanOrEqual"
  | "greaterThan"
  | "greaterThanOrEqual";

export interface Condition {
  variable: string;
  operator: Operator;
  value: Primitive;
}

export interface Trigger {
  id: string;
  event: EventName;
  action: ActionName;
  target: string;
  value?: Primitive;
  /** Only for setVariable. "set" (the default) puts the value in the variable; "add" adds the value (1 if there is none) to a number variable. */
  operation?: "set" | "add";
  conditions: Condition[];
}

export type Style = Record<string, string | number>;

export interface ObjectState {
  style?: Style;
  content?: Record<string, unknown>;
  /** What a screen reader says when a rule applies this look. Not said when the course applies the look on its own. */
  announce?: string;
}

export interface Choice {
  id: string;
  label: string;
  correct: boolean;
}

/** What every kind of question has: how many points it is worth, how many tries, and the layers shown after the answer. */
export interface QuizBase {
  scoring: { points: number; attemptsAllowed: number };
  feedback: { correct: string; incorrect: string };
}

/** Multiple choice (exactly one right answer) and multiple response (one or more, all of which must be ticked). */
export interface ChoiceQuiz extends QuizBase {
  questionType: "multipleChoice" | "multipleResponse";
  choices: Choice[];
  /** Show the answers in a different order to each learner (the same order for the same learner, however often they come back). Absent means the author's order. */
  shuffle?: boolean;
}

/** A typed answer, right if it matches one of the accepted answers. */
export interface ShortAnswerQuiz extends QuizBase {
  questionType: "shortAnswer";
  answers: string[];
  caseSensitive: boolean;
}

/** A typed number, right if it lies from `min` to `max`. An exact answer has the two the same. */
export interface NumericQuiz extends QuizBase {
  questionType: "numeric";
  min: number;
  max: number;
}

export interface Blank {
  id: string;
  /** What is accepted. For a drop-down or dragged word, the first is the right word from the word bank. */
  answers: string[];
}

/** A sentence with blanks, marked {id} in `text`. They are typed, chosen from a drop-down, or filled by dragging words. */
export interface FillBlanksQuiz extends QuizBase {
  questionType: "fillBlanks";
  mode: "typed" | "dropdown" | "drag";
  text: string;
  blanks: Blank[];
  /** dropdown and drag: every word offered, the right ones and the extras. Empty when the blanks are typed. */
  wordBank: string[];
  caseSensitive: boolean;
}

export interface Pair {
  id: string;
  premise: string;
  match: string;
}

/** Each item is matched with one of the options, which are the right matches and any extra wrong ones. */
export interface MatchingQuiz extends QuizBase {
  questionType: "matching";
  /** The options can also be dragged onto the items. The drop-downs are always there. */
  drag: boolean;
  pairs: Pair[];
  extras: string[];
}

export interface SequenceItem {
  id: string;
  text: string;
}

/** Items to put in order. They are listed here in the right order; the learner is shown them in another. */
export interface SequencingQuiz extends QuizBase {
  questionType: "sequencing";
  /** The items can also be dragged into place. The Move up and Move down buttons are always there. */
  drag: boolean;
  items: SequenceItem[];
}

/** An area of a picture, as a rectangle in percent of the picture's width and height. */
export interface Region {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  correct: boolean;
}

/** The learner chooses an area of a picture. Every area is also listed by its label, so the picture is not the only way to answer. */
export interface HotspotQuiz extends QuizBase {
  questionType: "hotspot";
  image: { src: string; alt: string };
  regions: Region[];
}

/** Any kind of question. Code that only needs the scoring and feedback can use this; code that needs more narrows it by `questionType`. */
export type QuizContent = ChoiceQuiz | ShortAnswerQuiz | NumericQuiz | FillBlanksQuiz | MatchingQuiz | SequencingQuiz | HotspotQuiz;

export type QuestionType = QuizContent["questionType"];

/** A YouTube or Vimeo video played from its own site. */
/** One audio description of a video: at this time, say this. See description.ts. */
export interface DescriptionCue {
  id: string;
  /** Milliseconds into the video when it starts. */
  time: number;
  /** What the picture shows, to be read. */
  text: string;
  /** Whether the video waits while it is spoken. */
  pause: boolean;
  /** What the learner hears: the usual narration, or null for a description that can only be read. Its audio is found under itemNarrationKey. */
  narration: unknown;
}

export interface EmbedContent {
  provider: "youtube" | "vimeo";
  id: string;
  /** Vimeo's key for an unlisted video, or empty. */
  hash: string;
  /** Shown under the video. */
  transcript: string;
  /** The author's statement that the video has captions. */
  captionsConfirmed: boolean;
}

/** Where one asset came from, so credit can be given. */
/** Which service and model made a picture or sound, from what words, and when. Kept in assets.json beside the credit. */
export interface GeneratedRecord {
  service: string;
  model: string;
  prompt: string;
  madeAt: string;
}

export interface CreditEntry {
  path: string;
  title: string;
  kind: "image" | "video" | "audio" | "document";
  source: {
    provider: "pixabay" | "unsplash" | "pexels" | "openverse" | "wikimedia" | "freesound" | "mixkit" | "svgrepo" | "libreshot" | "vecteezy" | "generated" | "other";
    url: string; creator: string; creatorUrl: string; licence: string; requiresCredit: boolean;
    /** Only for provider "generated": a picture or sound an AI service made, and from what words. */
    generated?: GeneratedRecord;
  };
}

/** A file the learner can save to their own device, with the author's description of what it is. */
export interface DownloadContent {
  /** Where the file is in the project, such as assets/documents/guide.pdf. */
  src: string;
  /** What the link is called. */
  title: string;
  /** What the file is, so a learner knows before downloading it. */
  description: string;
  /** The author has checked that the file can be read with a screen reader. */
  accessibleConfirmed: boolean;
}

/** A results box: the learner's score, whether they passed, and optionally each question. */
export interface ResultsContent {
  heading: string;
  /** Said after "You passed." */
  passMessage: string;
  /** Said after "You did not reach the pass mark." */
  failMessage: string;
  /** List each question and how it went. */
  review: boolean;
}

/** A certificate for a learner who passed. The learner types their own name. */
export interface CertificateContent {
  title: string;
  /** The line before the name, such as "This certifies that". */
  statement: string;
  /** The line after the name, such as "has successfully completed". */
  achievement: string;
  issuedBy: string;
  showScore: boolean;
  showDate: boolean;
}

export interface InputContent {
  kind: "checkbox" | "radio" | "dropdown" | "list" | "likert" | "semantic" | "character";
  prompt: string;
  /** Whether the answers are sent to the LMS as interactions. */
  report: boolean;
  /** radio, dropdown, list and character: the variable that receives the chosen option's value (for character, the person's id). */
  variable?: string;
  /** character: the people from the cast the learner can choose between. */
  characters?: string[];
  options?: { id: string; label: string; value: string }[];
  /** checkbox: each box has its own true or false variable. */
  items?: { id: string; label: string; variable: string }[];
  /** likert: the labels of the scale, lowest first. */
  scale?: string[];
  /** semantic: how many points lie between the two words. */
  points?: number;
  /** likert: label is the statement. semantic: label is the left word and right is the right word. Each row has its own number variable. */
  rows?: { id: string; label: string; right?: string; variable: string }[];
}

export interface TableContent {
  caption: string;
  headerRow: boolean;
  headerColumn: boolean;
  rows: string[][];
}

/** One thing said or told in a scenario. The speaker is null for the narrator, "you" for the learner's own character, or a person's id. */
export interface ScenarioLine {
  id: string;
  speaker: string | null;
  /** The id of one of the speaker's poses, to show them in it instead of their picture. Absent or null means their picture. */
  pose?: string | null;
  /** Plain text. */
  text: string;
  /** What the learner hears with the line. Its audio is found under itemNarrationKey (the object's id and the line's id). */
  narration: unknown;
}

export interface ScenarioEffect {
  /** A number variable. */
  variable: string;
  /** Added to it when the choice is made. May be negative. */
  add: number;
}

export interface ScenarioChoice {
  id: string;
  label: string;
  /** The situation this choice leads to. */
  next: string;
  effects: ScenarioEffect[];
  /** Lines shown straight after the choice, before the next situation. */
  response: ScenarioLine[];
}

/** A situation. One with no choices is an ending. */
export interface ScenarioNode {
  id: string;
  title: string;
  /** The question above the choices; empty means the title names them. */
  prompt: string;
  lines: ScenarioLine[];
  choices: ScenarioChoice[];
}

export interface ScenarioMeter {
  id: string;
  label: string;
  /** A number variable. */
  variable: string;
  min: number;
  max: number;
}

export interface ScenarioContent {
  start: string;
  /** A string variable that holds the id of the person the learner chose to be, or null. */
  you: string | null;
  nodes: ScenarioNode[];
  meters: ScenarioMeter[];
  allowRetry: boolean;
  /** A boolean variable set to true when the learner reaches an ending, or null. */
  finishedVariable: string | null;
  reflection: string;
}

/** A countdown on a slide. It starts when its layer is shown. When the time runs out, the rules on the timer that answer "timerEnd" run. */
export interface TimerContent {
  /** How long it counts down, in seconds (5 to 3600). */
  seconds: number;
  /** The words shown above the clock, such as "Time left". */
  label: string;
  /** How many seconds the learner's Add time button gives (5 to 600), or 0 for no such button. The Turn off button is always there. */
  extendBy: number;
}

export interface InteractionItem {
  id: string;
  title: string;
  /** Sanitised HTML, like a text object's. */
  body: string;
  image: { src: string; alt: string; decorative: boolean } | null;
  /** What the learner hears when the item is opened. Its audio is found under itemNarrationKey. */
  narration: unknown;
}

export interface InteractionContent {
  kind: "clickReveal" | "flipCards" | "tabs" | "accordion" | "carousel" | "steps" | "timeline" | "processCircle" | "glossary" | "pyramidStack" | "pyramidMatrix" | "circleMatrix";
  orientation: "horizontal" | "vertical";
  allowMultiple: boolean;
  items: InteractionItem[];
}

/**
 * When an object appears and disappears, in milliseconds counted from when its layer is shown. The starting value,
 * `{ appear: "time", start: 0, visibleFor: null }`, means always there. See docs/format-spec.md, Timing.
 */
export interface Timing {
  appear: "time" | "narration" | "media" | "click";
  /** Only with appear "click": which press of Show next item shows this object. Objects with the same step show together; start is the delay after the press. */
  step?: number;
  /** Only with appear "media": the id of the video or audio clip on the same slide whose playing time this follows. Then start and visibleFor count the clip's time. */
  media?: string;
  start: number;
  visibleFor: number | null;
  /** The object goes away when the learner shows this step of Show next item (or it comes by itself), `start` ms after it (added in 0.38.0). If visibleFor is also set, whichever is first. */
  until?: { step: number; start: number };
  /** Only for a text: a timing for each paragraph, in the order they come in the text (see paragraphs.ts), so it can come in or go away one paragraph at a time (added in 0.41.0). */
  paragraphs?: PartTiming[];
}

/** The timing of one paragraph of a text: an object's timing that cannot follow a clip or a narration, and has no paragraphs of its own. */
export type PartTiming = Omit<Timing, "appear" | "media" | "paragraphs"> & { appear: "time" | "click" };

export type EffectName = "none" | "fade" | "slideLeft" | "slideRight" | "slideTop" | "slideBottom" | "wipeLeft" | "wipeRight" | "wipeTop" | "wipeBottom" | "zoom";

/** One effect and how long it lasts, in milliseconds (100 to 2000). */
export interface Effect {
  effect: EffectName;
  duration: number;
}

/**
 * How an object arrives, when its timing shows it, and leaves, when its timing hides it. The starting value, no effect either way,
 * means it just appears and goes. See docs/format-spec.md, Animation.
 */
export interface ObjectAnimation {
  enter: Effect;
  exit: Effect;
}

/** A description the computer worked out that the author has not approved (format 0.28.0). The course never uses it; the editor offers it to the author. */
export interface AltSuggestion {
  text: string;
  /** What it was worked out from, in words the author can read. */
  basis: string;
}

export interface OSObject {
  id: string;
  type: "text" | "image" | "shape" | "button" | "hotspot" | "video" | "audio" | "quizQuestion" | "interaction" | "table" | "scrollingText" | "input" | "embed" | "results" | "certificate" | "download" | "scenario" | "icon" | "timer";
  name: string;
  geometry: { x: number; y: number; width: number; height: number; rotation: number; z: number };
  content: Record<string, unknown>;
  style: Style;
  accessibility: { altText: string; role: string; tabOrder: number | null; decorative: boolean; altSuggestion?: AltSuggestion };
  states: Record<string, ObjectState>;
  triggers: Trigger[];
  timing: Timing;
  animation: ObjectAnimation;
  narration: unknown;
  provenance: unknown;
  simulation: unknown;
  /** Editor only: the editor refuses to move, resize, rotate or delete a locked object. Absent means unlocked. The course ignores it. */
  locked?: boolean;
  /** Editor only: objects on one layer with the same group id are selected, moved, copied and deleted together. Absent means not in a group. The course ignores it. */
  group?: string;
}

export interface Layer {
  id: string;
  name: string;
  objects: OSObject[];
}

export interface ThemeColors {
  background: string; surface: string; text: string; muted: string; accent: string; accentStrong: string;
  onAccentStrong: string; dark: string; onDark: string; good: string; bad: string; line: string;
}

export type ThemeBackground =
  | { type: "solid"; color: string }
  | { type: "gradient"; from: string; to: string; angle: number };

/** One picture shown in a corner of every slide, such as a school's logo. See docs/format-spec.md. */
export interface ThemeLogo {
  /** A file under assets/. */
  src: string;
  /** What a screen reader says. Empty when the logo is decorative. */
  alt: string;
  decorative: boolean;
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Its size on the stage, in stage pixels. */
  width: number;
  height: number;
}

/** A project's design. See docs/format-spec.md. */
export interface Theme {
  schemaVersion: string;
  id: string;
  name: string;
  colors: ThemeColors;
  fonts: { heading: string; body: string };
  backgrounds: { default: ThemeBackground; dark: ThemeBackground; accent: ThemeBackground };
  /** Optional: shown in a corner of every slide. */
  logo?: ThemeLogo;
}

/** An object imported from a shape in a PowerPoint deck. `base` is the object as the import made it. */
export interface ImportProvenance {
  sourceDeck: string;
  slideIndex: number;
  shapeId: string;
  importedAt: string;
  slideId?: string;
  sourceHash?: string;
  base?: {
    type: string;
    name: string;
    geometry: { x: number; y: number; width: number; height: number; rotation: number };
    content: Record<string, unknown>;
    style: Style;
    altText: string;
    decorative: boolean;
  };
}

/** A slide imported from a slide of a PowerPoint deck. */
export interface SlideImportProvenance {
  sourceDeck: string;
  slideId: string;
  slideIndex: number;
  importedAt: string;
  sourceHash?: string;
  base?: {
    name: string;
    background: string | null;
    shapes?: string[];
    /** What the import gave the timing and animation of each shape that has an effect, by the shape's number on the slide (added in 0.39.0). */
    animation?: Record<string, { timing: Timing; animation: ObjectAnimation }>;
    /** Set when the speaker notes were made the narration of a shape: its number on the slide, and the words (added in 0.39.0). */
    notes?: { key: string; script: string };
  };
}

/** Set on a slide or an object the Capture module made from a recorded step, so a changed recording can be brought forward. */
export interface CaptureProvenance {
  sourceCapture: string;
  stepId: string;
  capturedAt?: string;
  /** On a slide: what the Capture module made, so a lesson can be brought up to date. The player ignores it. */
  base?: CaptureBase;
}

/** What the Capture module made for a step's slide: its name, the picture, and an id, layer and a fingerprint of each field for each thing made, by its part. */
export interface CaptureBase {
  name: string;
  picture: { src: string; width: number; height: number; take: number; shotMs: number } | null;
  objects: Record<string, { id: string; layer: string; fields: Record<string, string> }>;
}

export interface Slide {
  id: string;
  name: string;
  /** Present on a slide the Capture module made from a recorded step, or that was imported from a PowerPoint deck. */
  provenance?: CaptureProvenance | SlideImportProvenance | null;
  duration: number | null;
  /** True means the course's own Back and Next are not shown on this slide: the learner leaves it only through something on the slide. Absent means shown. */
  hideNavigation?: true;
  /** How the slide arrives and how it leaves (added in 0.37.0). `enter` plays when the learner arrives, `exit` when the learner leaves, over the slide that follows. Either may be absent: no effect. */
  transition?: { enter?: Effect; exit?: Effect };
  /** Present: the steps of Show next item come by themselves, the first `first` ms after the slide opens and then one every `every` ms (added in 0.36.0). Absent: they wait for the learner. */
  autoSteps?: { first: number; every: number };
  /** The layout the slide was made from, or null. Layouts are built into the editor. */
  layout: string | null;
  /** A theme background such as "theme:bg.dark", a hex colour, or null for the theme's default. */
  background: string | null;
  baseLayer: Layer;
  layers: Layer[];
}

export interface Cue {
  start: number;
  end: number;
  text: string;
}

/** Narration for one object, as the publisher resolves it. */
export interface NarrationAsset {
  script: string;
  lang: string;
  /** Path to the generated audio, or null if it has not been generated. */
  audio: string | null;
  /** Caption cues derived from the script, or null if there is no audio. */
  cues: Cue[] | null;
}

/** What the publisher embeds in index.html. Slides are in scene order. */
export interface CoursePackage {
  /** The assets in use that have credit to give, for the published course's credits page. */
  credits?: CreditEntry[];
  project: Project;
  theme: Theme;
  slides: Slide[];
  /** Narration by object id. */
  narration: Record<string, NarrationAsset>;
  /** The size in bytes of each file a course offers for download, by its path, so learners are told how big it is. */
  fileSizes?: Record<string, number>;
}
