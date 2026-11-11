// The publishing style: the house rules an author sets once, for every project, so what Publish makes fits their institution's standards
// without tidying it by hand each time (feedback from people who tried Author, 2026-11-10). It covers the names of the published files
// (a pattern of the course's title, code, version and the date) and the Word review document's slide headings, numbering and font.
// It is kept in the editor's own settings on this computer (stock.ts), never in a project. The name is worked out here and handed to the
// desktop program, which checks it again before it writes anything (`safe_publish_name` in lib.rs). The pure parts are tested in
// publishstyle.test.ts.

/** How the Word review document heads each slide. */
export type HeadingStyle = "slide" | "number" | "outline" | "name";

export interface PublishStyle {
  /** The pattern of the published files' names: words, and the parts in braces ({title}, {code}, {version}, {date}, {folder}). */
  fileName: string;
  headings: HeadingStyle;
  /** The font of the Word review document. */
  font: string;
}

export const DEFAULT_STYLE: PublishStyle = { fileName: "{folder}", headings: "slide", font: "Calibri" };

export const HEADING_STYLES: readonly { value: HeadingStyle; label: string; example: string }[] = [
  { value: "slide", label: "Slide and its number", example: "Slide 4: Why it matters" },
  { value: "number", label: "Numbered through the course", example: "4. Why it matters" },
  { value: "outline", label: "Numbered by section and slide", example: "2.1 Why it matters" },
  { value: "name", label: "The slide's name only", example: "Why it matters" },
];

/** Fonts every Windows computer has (Aptos comes with recent Microsoft 365). */
export const FONTS: readonly string[] = ["Calibri", "Aptos", "Arial", "Verdana", "Segoe UI", "Georgia", "Times New Roman"];

/** The parts a name can be made of. */
export const NAME_PARTS: readonly { token: string; says: string }[] = [
  { token: "{title}", says: "the course's title" },
  { token: "{code}", says: "the course code" },
  { token: "{version}", says: "the course's version" },
  { token: "{date}", says: "the day it is published, as 2026-11-10" },
  { token: "{folder}", says: "the project's folder name (what Publish has always used)" },
];

export const FILE_NAME_MAX = 80;

/** The style as kept in the settings file, with anything missing or damaged put back to the usual. */
export function parsePublishStyle(raw: unknown): PublishStyle {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const fileName = typeof d["fileName"] === "string" && checkPattern(d["fileName"]) === null ? d["fileName"] : DEFAULT_STYLE.fileName;
  const headings = HEADING_STYLES.some((h) => h.value === d["headings"]) ? (d["headings"] as HeadingStyle) : DEFAULT_STYLE.headings;
  const font = typeof d["font"] === "string" && FONTS.includes(d["font"]) ? d["font"] : DEFAULT_STYLE.font;
  return { fileName, headings, font };
}

/** Whether a style is the usual one, so the settings file need not keep it. */
export function isDefaultStyle(s: PublishStyle): boolean {
  return s.fileName === DEFAULT_STYLE.fileName && s.headings === DEFAULT_STYLE.headings && s.font === DEFAULT_STYLE.font;
}

/** What is wrong with a pattern, or null. It needs at least one part in braces, and only the parts there are. */
export function checkPattern(pattern: string): string | null {
  const p = pattern.trim();
  if (p === "") return "Write a pattern, such as {code}_{title}_v{version}.";
  if (p.length > 120) return "The pattern is too long. Keep it under 120 letters.";
  if (/[{}]/.test(p.replace(/\{[^{}]*\}/g, ""))) return "A brace is left open. Each part is a word between { and }.";
  const tokens = p.match(/\{[^}]*\}/g) ?? [];
  if (tokens.length === 0) return "Use at least one part in braces, such as {title}, so each course gets its own name.";
  const unknown = tokens.filter((t) => !NAME_PARTS.some((n) => n.token === t.toLowerCase()));
  if (unknown.length > 0) return `${unknown[0]} is not a part a name can have. The parts are ${NAME_PARTS.map((n) => n.token).join(", ")}.`;
  return null;
}

export interface NameValues {
  folder: string;
  title: string;
  code?: string;
  version?: string;
  /** The day, as 2026-11-10. */
  date: string;
}

/**
 * The name of what is published: the pattern with its parts filled in, then made safe for a file name on any computer and in any LMS.
 * Letters, digits, dots, hyphens and underscores stay; anything else (spaces, accents, slashes) becomes a hyphen; runs of the joining marks
 * become one; none is left at either end. A part the course does not have is left out. A name that comes out empty is the folder's.
 */
export function publishName(pattern: string, v: NameValues): string {
  const value: Record<string, string> = { "{folder}": v.folder.replace(/\.osproj$/i, ""), "{title}": v.title, "{code}": v.code ?? "", "{version}": v.version ?? "", "{date}": v.date };
  const filled = (checkPattern(pattern) === null ? pattern.trim() : DEFAULT_STYLE.fileName).replace(/\{[^}]*\}/g, (t) => value[t.toLowerCase()] ?? "");
  const safe = (text: string) => text
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/([._-])[._-]+/g, "$1")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, FILE_NAME_MAX)
    .replace(/[._-]+$/g, "");
  return safe(filled) || safe(v.folder.replace(/\.osproj$/i, "")) || "course";
}

/** The day as it goes in a name: 2026-11-10, in the computer's own time. */
export function dateText(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The next big version after a course's version, for a copy made for a big revision: 1.0 and 1.3 make 2.0, 2 makes 3, none makes 2.0. */
export function nextVersion(version: string | undefined): string {
  const v = (version ?? "").trim();
  if (v === "") return "2.0";
  const m = /^(\D*)(\d+)((?:\.\d+)*)(.*)$/.exec(v);
  if (!m) return `${v} 2`;
  const [, before, major, rest, after] = m;
  const minor = rest ? rest.replace(/\d+/g, "0") : "";
  return `${before}${Number(major) + 1}${minor}${after}`;
}
