// The learner's accessibility settings: what a learner can change about how a published course looks and sounds, and how that is remembered.
//
// These are the learner's, not the author's. Nothing about them is in the course format, nothing is sent anywhere, and they only change how the player draws the course
// on this computer: bigger or more widely spaced text, other colours, a line to read along, and reading aloud. This file holds the decisions that need no page (what the
// choices are, which are the same as the course's own, how they are written to the page, how they are saved, which voice may read aloud, how long text is cut for a
// voice), so they are tested with Node alone. The panel that shows them is in a11ypanel.ts.

export const TEXT_SIZES = [100, 125, 150, 200, 300] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export const SPACINGS = ["normal", "wide", "wider"] as const;
export type Spacing = (typeof SPACINGS)[number];

export const COLOURS = ["course", "dark", "contrast", "yellow"] as const;
export type Colours = (typeof COLOURS)[number];

export const SPEEDS = ["slow", "normal", "fast"] as const;
export type Speed = (typeof SPEEDS)[number];

export interface A11ySettings {
  /** How much bigger text is, in percent. */
  textSize: TextSize;
  /** The space between lines: the course's own, 1.5 times the text size, or twice. */
  lineSpacing: Spacing;
  /** The space between letters and words: the course's own, or the amounts WCAG 1.4.12 names, or more. */
  letterSpacing: Spacing;
  colours: Colours;
  /** A band that follows the pointer or the keyboard, to read along. */
  readingLine: boolean;
  /** How fast reading aloud goes. */
  speed: Speed;
}

export const DEFAULTS: Readonly<A11ySettings> = { textSize: 100, lineSpacing: "normal", letterSpacing: "normal", colours: "course", readingLine: false, speed: "normal" };

export const TEXT_SIZE_LABELS: Record<TextSize, string> = { 100: "100% (the course's own)", 125: "125%", 150: "150%", 200: "200%", 300: "300%" };
export const SPACING_LABELS: Record<Spacing, string> = { normal: "The course's own", wide: "Wide", wider: "Wider" };
export const COLOUR_LABELS: Record<Colours, string> = { course: "The course's own colours", dark: "Dark", contrast: "High contrast: white on black", yellow: "Yellow on black" };
export const SPEED_LABELS: Record<Speed, string> = { slow: "Slower", normal: "Normal", fast: "Faster" };

const oneOf = <T extends string | number>(list: readonly T[], value: unknown, fallback: T): T => (list as readonly unknown[]).includes(value) ? (value as T) : fallback;

/** Settings from whatever was saved: anything that is not one of the choices goes back to the course's own, so a saved value that no longer means anything can do no harm. */
export function normalise(raw: unknown): A11ySettings {
  const v = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    textSize: oneOf(TEXT_SIZES, v["textSize"], DEFAULTS.textSize),
    lineSpacing: oneOf(SPACINGS, v["lineSpacing"], DEFAULTS.lineSpacing),
    letterSpacing: oneOf(SPACINGS, v["letterSpacing"], DEFAULTS.letterSpacing),
    colours: oneOf(COLOURS, v["colours"], DEFAULTS.colours),
    readingLine: v["readingLine"] === true,
    speed: oneOf(SPEEDS, v["speed"], DEFAULTS.speed),
  };
}

export const isDefault = (s: A11ySettings): boolean =>
  s.textSize === DEFAULTS.textSize && s.lineSpacing === DEFAULTS.lineSpacing && s.letterSpacing === DEFAULTS.letterSpacing && s.colours === DEFAULTS.colours && s.readingLine === DEFAULTS.readingLine && s.speed === DEFAULTS.speed;

/**
 * Whether the slide must be shown in one column. A slide is a fixed stage with every object in a box of its own, and bigger or more widely spaced text would run out of
 * those boxes and be cut off or hidden. The one-column layout (reflow.ts) has no boxes to run out of, so it is used whenever the text is made bigger or more spaced.
 */
export const needsReflow = (s: A11ySettings): boolean => s.textSize > 100 || s.lineSpacing !== "normal" || s.letterSpacing !== "normal";

const LINE_HEIGHT: Record<Spacing, string> = { normal: "", wide: "1.5", wider: "2" };
/** Letter spacing, then word spacing, in em: 0.12 and 0.16 are the amounts WCAG 1.4.12 (Text Spacing) names. */
const LETTERS: Record<Spacing, [string, string]> = { normal: ["", ""], wide: ["0.12em", "0.16em"], wider: ["0.2em", "0.3em"] };

/** What the page is given: attributes the stylesheet reads, and variables it uses. Nothing is set for a choice that is the course's own. */
export interface PageSettings {
  attributes: Record<string, string>;
  variables: Record<string, string>;
}

export function pageSettings(s: A11ySettings): PageSettings {
  const attributes: Record<string, string> = {};
  const variables: Record<string, string> = {};
  if (s.textSize > 100) {
    attributes["data-os-scale"] = String(s.textSize);
    variables["--os-a11y-scale"] = String(s.textSize / 100);
  }
  if (s.lineSpacing !== "normal") {
    attributes["data-os-lh"] = s.lineSpacing;
    variables["--os-a11y-lh"] = LINE_HEIGHT[s.lineSpacing];
  }
  if (s.letterSpacing !== "normal") {
    attributes["data-os-ls"] = s.letterSpacing;
    variables["--os-a11y-ls"] = LETTERS[s.letterSpacing][0];
    variables["--os-a11y-ws"] = LETTERS[s.letterSpacing][1];
  }
  if (s.colours !== "course") attributes["data-os-colors"] = s.colours;
  return { attributes, variables };
}

/** In words, for the learner and a screen reader: what is different from the course's own. */
export function describe(s: A11ySettings): string {
  if (isDefault(s)) return "Everything is as the course has it.";
  const parts: string[] = [];
  if (s.textSize !== DEFAULTS.textSize) parts.push(`text size ${s.textSize} percent`);
  if (s.lineSpacing !== "normal") parts.push(`line spacing ${s.lineSpacing}`);
  if (s.letterSpacing !== "normal") parts.push(`letter and word spacing ${s.letterSpacing}`);
  if (s.colours !== "course") parts.push(`colours: ${COLOUR_LABELS[s.colours].toLowerCase()}`);
  if (s.readingLine) parts.push("reading line on");
  if (s.speed !== "normal") parts.push(`reading speed ${SPEED_LABELS[s.speed].toLowerCase()}`);
  return `Now ${parts.join(", ")}.`;
}

// ---- remembering them

export const STORAGE_KEY = "openstage.accessibility.v1";

interface Reader { getItem(key: string): string | null }
interface Writer { setItem(key: string, value: string): void; removeItem(key: string): void }

/** The settings kept on this computer, or the course's own if there are none or they cannot be read. */
export function loadSettings(storage: Reader | null): A11ySettings {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return text ? normalise(JSON.parse(text)) : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Keep the settings on this computer. Returns whether they were kept: a browser that blocks storage (a private window, or a learning system that shows the course in a frame
 * from another site) says no, and then the settings last for this visit only. Settings that are all the course's own are not kept, so nothing is left behind.
 */
export function saveSettings(storage: Writer | null, s: A11ySettings): boolean {
  try {
    if (storage === null) return false;
    if (isDefault(s)) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

/** The page's storage, or null when it may not be used. Even looking at it can throw. */
export function browserStorage(win: { localStorage?: Storage } | null): Storage | null {
  try {
    const s = win?.localStorage;
    if (!s) return null;
    s.setItem("openstage.test", "1");
    s.removeItem("openstage.test");
    return s;
  } catch {
    return null;
  }
}

// ---- reading aloud

export interface VoiceLike {
  name: string;
  lang: string;
  /** True for a voice that runs on this computer; false for one that sends the words to a service. */
  localService: boolean;
  default?: boolean;
}

const base = (lang: string): string => lang.toLowerCase().replace("_", "-").split("-")[0] ?? "";

/**
 * The voice to read aloud with: one that runs on this computer, in the course's language (the same region first, then the same language), the computer's default among them first.
 * A voice that sends the words to a service is never used. None if there is no such voice.
 */
export function pickVoice<T extends VoiceLike>(voices: readonly T[], lang: string): T | null {
  const local = voices.filter((v) => v.localService);
  const want = lang.toLowerCase().replace("_", "-");
  const best = (list: readonly T[]): T | null => list.find((v) => v.default === true) ?? list[0] ?? null;
  const exact = local.filter((v) => v.lang.toLowerCase().replace("_", "-") === want);
  if (exact.length > 0) return best(exact);
  return best(local.filter((v) => base(v.lang) === base(lang)));
}

/** How fast each choice speaks, as the speech engine counts it (1 is its normal pace). */
export const RATE: Record<Speed, number> = { slow: 0.8, normal: 1, fast: 1.3 };

/**
 * Text cut into pieces a voice can be given one at a time. Browsers stop a long utterance part way, so each piece is a few sentences at most, and a piece never ends in
 * the middle of a word.
 */
export function speechChunks(text: string, max = 180): string[] {
  const out: string[] = [];
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n+/)) {
    let current = "";
    const flush = () => {
      if (current.trim() !== "") out.push(current.trim());
      current = "";
    };
    for (const sentence of block.split(/(?<=[.!?…])\s+/)) {
      if (sentence.trim() === "") continue;
      if (current !== "" && current.length + 1 + sentence.length > max) flush();
      if (sentence.length <= max) {
        current = current === "" ? sentence : `${current} ${sentence}`;
        continue;
      }
      // One sentence longer than a piece: cut it between words.
      flush();
      for (const word of sentence.split(/\s+/)) {
        if (current !== "" && current.length + 1 + word.length > max) flush();
        current = current === "" ? word : `${current} ${word}`;
      }
    }
    flush();
  }
  return out;
}

/** Where the top of the reading line goes so that it is centred on `y`, kept inside the window. */
export const bandTop = (y: number, height: number, windowHeight: number): number => Math.max(0, Math.min(windowHeight - height, Math.round(y - height / 2)));
