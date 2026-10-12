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
  /**
   * What counts as completing the course, besides finishing every quiz: "all" is having seen every slide, "last" is
   * having reached the last slide. A course published before format 0.9.0 has no setting and counts every slide.
   */
  completion: { slides: "all" | "last" };
  scenes: { id: string; name: string; slides: string[] }[];
}

export type EventName =
  | "click"
  | "keyActivate"
  | "slideStart"
  | "slideEnd"
  | "mediaComplete"
  | "variableChange";

export type ActionName =
  | "jumpToSlide"
  | "showLayer"
  | "hideLayer"
  | "setVariable"
  | "playMedia"
  | "pauseMedia"
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
  conditions: Condition[];
}

export type Style = Record<string, string | number>;

export interface ObjectState {
  style?: Style;
  content?: Record<string, unknown>;
}

export interface Choice {
  id: string;
  label: string;
  correct: boolean;
}

export interface QuizContent {
  questionType: "multipleChoice";
  choices: Choice[];
  scoring: { points: number; attemptsAllowed: number };
  feedback: { correct: string; incorrect: string };
}

/** A YouTube or Vimeo video played from its own site. */
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
export interface CreditEntry {
  path: string;
  title: string;
  kind: "image" | "video" | "audio" | "document";
  source: { provider: "pixabay" | "unsplash" | "pexels" | "openverse" | "wikimedia" | "freesound" | "mixkit" | "svgrepo" | "libreshot" | "vecteezy" | "other"; url: string; creator: string; creatorUrl: string; licence: string; requiresCredit: boolean };
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
  kind: "checkbox" | "radio" | "dropdown" | "list" | "likert" | "semantic";
  prompt: string;
  /** Whether the answers are sent to the LMS as interactions. */
  report: boolean;
  /** radio, dropdown and list: the variable that receives the chosen option's value. */
  variable?: string;
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
  appear: "time" | "narration";
  start: number;
  visibleFor: number | null;
}

export type EffectName = "none" | "fade" | "slideLeft" | "slideRight" | "slideTop" | "slideBottom" | "zoom";

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

export interface OSObject {
  id: string;
  type: "text" | "image" | "shape" | "button" | "hotspot" | "video" | "audio" | "quizQuestion" | "interaction" | "table" | "scrollingText" | "input" | "embed" | "results" | "certificate" | "download";
  name: string;
  geometry: { x: number; y: number; width: number; height: number; rotation: number; z: number };
  content: Record<string, unknown>;
  style: Style;
  accessibility: { altText: string; role: string; tabOrder: number | null; decorative: boolean };
  states: Record<string, ObjectState>;
  triggers: Trigger[];
  timing: Timing;
  animation: ObjectAnimation;
  narration: unknown;
  provenance: unknown;
  simulation: unknown;
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

/** A project's design. See docs/format-spec.md. */
export interface Theme {
  schemaVersion: string;
  id: string;
  name: string;
  colors: ThemeColors;
  fonts: { heading: string; body: string };
  backgrounds: { default: ThemeBackground; dark: ThemeBackground; accent: ThemeBackground };
}

export interface Slide {
  id: string;
  name: string;
  duration: number | null;
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
