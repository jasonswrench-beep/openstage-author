// The projects opened lately, for the welcome page. They are kept in the editor's own settings (never in a project), newest first,
// and the author can take one off the list, clear it, or stop the editor keeping one (design spec A01: "local recent-path history,
// opt out/clear control"). Everything here is plain data, so it is tested without a page.

export interface RecentProject {
  /** The project's folder, as it was opened. */
  dir: string;
  /** The course title when it was last opened or saved. */
  title: string;
  /** How many slides it had then. */
  slides: number;
  /** When it was last opened, as an ISO date and time. */
  opened: string;
}

/** The most the list keeps. */
export const RECENT_MAX = 8;

/** The list from the settings file, keeping only entries that make sense, newest first as they were saved. */
export function parseRecent(raw: unknown): RecentProject[] {
  if (!Array.isArray(raw)) return [];
  const out: RecentProject[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const dir = typeof r["dir"] === "string" ? r["dir"].trim() : "";
    if (dir === "" || out.some((p) => sameFolder(p.dir, dir))) continue;
    const slides = typeof r["slides"] === "number" && Number.isFinite(r["slides"]) ? Math.max(0, Math.round(r["slides"])) : 0;
    const opened = typeof r["opened"] === "string" && !Number.isNaN(Date.parse(r["opened"])) ? r["opened"] : "";
    out.push({ dir, title: typeof r["title"] === "string" ? r["title"] : "", slides, opened });
    if (out.length === RECENT_MAX) break;
  }
  return out;
}

/** Whether two paths are the same folder: Windows does not mind the case, which slash, or a slash at the end. */
export function sameFolder(a: string, b: string): boolean {
  const norm = (p: string) => p.trim().replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/** The list with this project first (taking out an older entry for the same folder), cut to the most it keeps. */
export function addRecent(list: readonly RecentProject[], project: RecentProject, max = RECENT_MAX): RecentProject[] {
  return [project, ...list.filter((p) => !sameFolder(p.dir, project.dir))].slice(0, max);
}

/** The list without this folder. */
export function removeRecent(list: readonly RecentProject[], dir: string): RecentProject[] {
  return list.filter((p) => !sameFolder(p.dir, dir));
}

/** The entry for this folder, if it is on the list. */
export function findRecent(list: readonly RecentProject[], dir: string): RecentProject | undefined {
  return list.find((p) => sameFolder(p.dir, dir));
}

/** "1 slide", "12 slides". */
export function slidesText(n: number): string {
  return n === 1 ? "1 slide" : `${n} slides`;
}

/**
 * When it was opened, in words, by the days of the calendar where the author is: "Opened today", "Opened yesterday", "Opened 3 days
 * ago" in the week, then the date. Empty when the date is not known.
 */
export function openedText(iso: string, now: Date = new Date()): string {
  const when = new Date(iso);
  if (iso === "" || Number.isNaN(when.getTime())) return "";
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  const days = day(now) - day(when);
  if (days <= 0) return "Opened today";
  if (days === 1) return "Opened yesterday";
  if (days < 7) return `Opened ${days} days ago`;
  return `Opened ${when.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
}

/** What a recent project's card says under its title: "12 slides, opened today". */
export function recentDetails(p: RecentProject, now: Date = new Date()): string {
  const opened = openedText(p.opened, now);
  return opened === "" ? slidesText(p.slides) : `${slidesText(p.slides)}, ${opened.charAt(0).toLowerCase()}${opened.slice(1)}`;
}

/** The name to show for a project with no title: the last part of its folder. */
export function recentTitle(p: RecentProject): string {
  if (p.title.trim() !== "") return p.title;
  const parts = p.dir.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || p.dir;
}
