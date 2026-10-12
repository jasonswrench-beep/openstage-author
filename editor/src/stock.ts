// Searching the free media libraries with the author's own free key: Pexels (pictures and video), Pixabay and
// Unsplash (pictures) and Freesound (sounds). Nothing here touches the network itself: the caller passes in
// `get`, which in the app is a Rust command that may only reach these services. That keeps this file testable
// with canned answers.
//
// What each service sends back is turned into one shape, with the creator, the source link and the licence
// the author must keep, so credit can be given. Descriptions the services provide are kept as suggestions
// only: alt text is always the author's to write.

import type { CreditEntry } from "../../player/src/types.ts";

export type MediaKind = "image" | "video" | "audio";
export type Provider = "pixabay" | "unsplash" | "pexels" | "freesound";
/** Every source that can be searched needs a key of the author's own. */
export type KeyedProvider = Provider;

export interface Source {
  id: Provider;
  name: string;
  kinds: MediaKind[];
  /** What the service calls its key. */
  keyName: string;
  keyUrl: string;
  blurb: string;
}

export const SOURCES: Source[] = [
  { id: "pexels", name: "Pexels", kinds: ["image", "video"], keyName: "API key", keyUrl: "https://www.pexels.com/api/", blurb: "Free photos and videos. Credit to the photographer is welcome but not required." },
  { id: "pixabay", name: "Pixabay", kinds: ["image"], keyName: "API key", keyUrl: "https://pixabay.com/api/docs/", blurb: "Free pictures. Credit is appreciated but not required." },
  { id: "unsplash", name: "Unsplash", kinds: ["image"], keyName: "access key", keyUrl: "https://unsplash.com/oauth/applications", blurb: "Free photographs. Its rules ask for credit to the photographer and to Unsplash." },
  { id: "freesound", name: "Freesound", kinds: ["audio"], keyName: "API key", keyUrl: "https://freesound.org/apiv2/apply/", blurb: "Sounds and recordings by its community. Only the ones free to use in a course are shown; most need credit." },
];

/**
 * Websites to use in a browser. None of them needs a key to use that way: open it, download a file, add the file
 * to the project, and record where it came from. Four of them can also be searched from inside the editor, with a
 * free key of the author's own, because their programming interfaces ask for one; `searchId` says which.
 */
export const LINK_SOURCES: { name: string; url: string; kinds: MediaKind[]; note: string; searchId?: Provider }[] = [
  { name: "Pexels", url: "https://www.pexels.com/", kinds: ["image", "video"], searchId: "pexels", note: "Free photos and videos. Credit to the photographer is welcome." },
  { name: "Pixabay", url: "https://pixabay.com/", kinds: ["image"], searchId: "pixabay", note: "Free pictures." },
  { name: "Unsplash", url: "https://unsplash.com/", kinds: ["image"], searchId: "unsplash", note: "Free photographs. Its rules ask for credit to the photographer." },
  { name: "Freesound", url: "https://freesound.org/", kinds: ["audio"], searchId: "freesound", note: "Sounds by its community. Each has its own licence and some are not for commercial use, so check the licence on the sound's page." },
  { name: "Mixkit", url: "https://mixkit.co/", kinds: ["video", "audio"], note: "Free video clips, music and sound effects, under its own licence." },
  { name: "SVG Repo", url: "https://www.svgrepo.com/", kinds: ["image"], note: "Free icons and vector pictures. Licences differ by file, so check each one." },
  { name: "Libreshot", url: "https://libreshot.com/", kinds: ["image"], note: "Free photographs." },
];

export const KINDS: { id: MediaKind; label: string }[] = [{ id: "image", label: "Images" }, { id: "video", label: "Video" }, { id: "audio", label: "Audio" }];

export const sourcesFor = (kind: MediaKind): Source[] => SOURCES.filter((s) => s.kinds.includes(kind));
export const sourceById = (id: Provider): Source => SOURCES.find((s) => s.id === id)!;

export interface StockHit {
  provider: Provider;
  kind: MediaKind;
  id: string;
  title: string;
  /** A small picture to show in the results. Empty for a sound. */
  preview: string;
  /** What to download into the project. */
  downloadUrl: string;
  /** For a sound, the address to listen to before adding it. */
  listenUrl: string;
  width: number;
  height: number;
  /** Seconds, for video and audio. */
  duration: number;
  /** The file's own page on the service. */
  pageUrl: string;
  creator: string;
  creatorUrl: string;
  licence: string;
  requiresCredit: boolean;
  /** What the service says the file shows. Offered as a starting point for alt text, never filled in. */
  suggestedAlt: string;
  /** Unsplash asks to be told when a picture is downloaded. */
  downloadTrigger?: string;
}

export interface StockPage {
  hits: StockHit[];
  page: number;
  hasMore: boolean;
  total: number;
}

export type Get = (url: string, headers: [string, string][]) => Promise<string>;

export const PAGE_SIZE = 24;
const UTM = "utm_source=OpenStage&utm_medium=referral";
const withUtm = (url: string) => (url ? `${url}${url.includes("?") ? "&" : "?"}${UTM}` : url);

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

function parse(body: string, service: string): Record<string, unknown> {
  try {
    const data = JSON.parse(body) as unknown;
    if (data && typeof data === "object") return data as Record<string, unknown>;
  } catch {
    // fall through to the message below
  }
  // Some services answer a bad key with plain text such as "[ERROR 400] ...".
  throw new Error(`${service} did not answer in a way OpenStage understands. ${body.trim().slice(0, 120)}`.trim());
}

/** A Creative Commons address (as Freesound sends it) as a short name. */
export function ccFromUrl(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("publicdomain/zero") || u.includes("/zero/")) return "CC0 1.0";
  const m = /creativecommons\.org\/licenses\/([a-z-]+)\/([0-9.]+)/.exec(u);
  return m ? `CC ${m[1]!.toUpperCase()} ${m[2]}` : "Creative Commons";
}

export function searchUrl(provider: Provider, kind: MediaKind, query: string, page: number, key: string): string {
  const q = encodeURIComponent(query.trim());
  switch (provider) {
    case "pixabay":
      return `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${q}&image_type=photo&safesearch=true&per_page=${PAGE_SIZE}&page=${page}`;
    case "unsplash":
      return `https://api.unsplash.com/search/photos?query=${q}&per_page=${PAGE_SIZE}&page=${page}&content_filter=high`;
    case "pexels":
      return kind === "video"
        ? `https://api.pexels.com/v1/videos/search?query=${q}&per_page=${PAGE_SIZE}&page=${page}`
        : `https://api.pexels.com/v1/search?query=${q}&per_page=${PAGE_SIZE}&page=${page}`;
    case "freesound":
      return `https://freesound.org/apiv2/search/text/?query=${q}&page=${page}&page_size=${PAGE_SIZE}&fields=id,name,username,license,url,duration,previews,description&filter=${encodeURIComponent('license:("Creative Commons 0" OR "Attribution")')}`;
  }
}

const hit = (h: Partial<StockHit> & Pick<StockHit, "provider" | "kind" | "id" | "title" | "downloadUrl" | "licence" | "requiresCredit">): StockHit => ({
  preview: "", listenUrl: "", width: 0, height: 0, duration: 0, pageUrl: "", creator: "", creatorUrl: "", suggestedAlt: "", ...h,
});

/**
 * Of the video files a service offers, the best for a course: an mp4 as near to 1280 wide as it gets, never
 * above Full HD, which keeps the course a sensible size. If every file is bigger than that, the smallest.
 */
export function pickVideoFile(files: Record<string, unknown>[]): Record<string, unknown> | null {
  const mp4 = files.filter((f) => text(f["file_type"]) === "video/mp4" && text(f["link"]) !== "" && num(f["width"]) > 0);
  if (mp4.length === 0) return null;
  const fits = mp4.filter((f) => num(f["width"]) <= 1920);
  if (fits.length === 0) return [...mp4].sort((a, b) => num(a["width"]) - num(b["width"]))[0]!;
  return [...fits].sort((a, b) => Math.abs(num(a["width"]) - 1280) - Math.abs(num(b["width"]) - 1280))[0]!;
}

export async function searchStock(provider: Provider, kind: MediaKind, query: string, page: number, key: string, get: Get): Promise<StockPage> {
  const source = sourceById(provider);
  if (!source.kinds.includes(kind)) throw new Error(`${source.name} has no ${kind === "image" ? "images" : kind}.`);
  if (key.trim() === "") throw new Error(`Add your free ${source.name} key in Settings to search it here, or open ${source.name} in your browser with the button below.`);
  if (query.trim() === "") throw new Error("Type something to search for.");
  const k = key.trim();
  const headers: [string, string][] =
    provider === "unsplash" ? [["Authorization", `Client-ID ${k}`], ["Accept-Version", "v1"]]
    : provider === "pexels" ? [["Authorization", k]]
    : provider === "freesound" ? [["Authorization", `Token ${k}`]]
    : [];
  const body = await get(searchUrl(provider, kind, query, page, k), headers);

  if (provider === "pixabay") {
    const data = parse(body, "Pixabay");
    const total = num(data["totalHits"]);
    return {
      page, total, hasMore: page * PAGE_SIZE < total,
      hits: list(data["hits"]).map((h) => {
        const user = text(h["user"]);
        return hit({
          provider, kind: "image", id: String(h["id"]), title: text(h["tags"]) || "Picture",
          preview: text(h["webformatURL"]) || text(h["previewURL"]), downloadUrl: text(h["largeImageURL"]) || text(h["webformatURL"]),
          width: num(h["imageWidth"]), height: num(h["imageHeight"]), pageUrl: text(h["pageURL"]),
          creator: user, creatorUrl: user ? `https://pixabay.com/users/${encodeURIComponent(user)}-${String(h["user_id"])}/` : "",
          licence: "Pixabay Content Licence", requiresCredit: false,
        });
      }),
    };
  }

  if (provider === "unsplash") {
    const data = parse(body, "Unsplash");
    return {
      page, total: num(data["total"]), hasMore: page < num(data["total_pages"]),
      hits: list(data["results"]).map((r) => {
        const urls = obj(r["urls"]);
        const links = obj(r["links"]);
        const user = obj(r["user"]);
        const alt = text(r["alt_description"]) || text(r["description"]);
        return hit({
          provider, kind: "image", id: String(r["id"]), title: alt || "Photograph",
          preview: text(urls["small"]), downloadUrl: text(urls["regular"]) || text(urls["full"]),
          width: num(r["width"]), height: num(r["height"]), pageUrl: withUtm(text(links["html"])),
          creator: text(user["name"]), creatorUrl: withUtm(text(obj(user["links"])["html"])),
          licence: "Unsplash Licence", requiresCredit: true, suggestedAlt: alt,
          downloadTrigger: text(links["download_location"]) || undefined,
        });
      }),
    };
  }

  if (provider === "pexels") {
    const data = parse(body, "Pexels");
    const more = typeof data["next_page"] === "string" && data["next_page"] !== "";
    if (kind === "video") {
      const hits: StockHit[] = [];
      for (const v of list(data["videos"])) {
        const file = pickVideoFile(list(v["video_files"]));
        if (!file) continue;
        const user = obj(v["user"]);
        hits.push(hit({
          provider, kind, id: String(v["id"]), title: text(v["url"]).replace(/\/$/, "").split("/").pop()?.replace(/-\d+$/, "").replace(/-/g, " ") || "Video",
          preview: text(v["image"]), downloadUrl: text(file["link"]), width: num(file["width"]), height: num(file["height"]), duration: num(v["duration"]),
          pageUrl: text(v["url"]), creator: text(user["name"]), creatorUrl: text(user["url"]), licence: "Pexels Licence", requiresCredit: false,
        }));
      }
      return { page, total: num(data["total_results"]), hasMore: more, hits };
    }
    return {
      page, total: num(data["total_results"]), hasMore: more,
      hits: list(data["photos"]).map((p) => {
        const src = obj(p["src"]);
        const alt = text(p["alt"]);
        return hit({
          provider, kind, id: String(p["id"]), title: alt || "Photo",
          preview: text(src["medium"]) || text(src["small"]), downloadUrl: text(src["large2x"]) || text(src["large"]) || text(src["original"]),
          width: num(p["width"]), height: num(p["height"]), pageUrl: text(p["url"]),
          creator: text(p["photographer"]), creatorUrl: text(p["photographer_url"]), licence: "Pexels Licence", requiresCredit: false, suggestedAlt: alt,
        });
      }),
    };
  }

  // Freesound
  const data = parse(body, "Freesound");
  const hits: StockHit[] = [];
  for (const r of list(data["results"])) {
    const lic = text(r["license"]);
    // Only what is free to use in a course: CC0 and plain Attribution. Anything else is left out, whatever the filter said.
    if (!/publicdomain\/zero|\/by\/[0-9.]+/i.test(lic)) continue;
    const previews = obj(r["previews"]);
    const mp3 = text(previews["preview-hq-mp3"]) || text(previews["preview-lq-mp3"]);
    if (!mp3) continue;
    const user = text(r["username"]);
    hits.push(hit({
      provider, kind: "audio", id: String(r["id"]), title: text(r["name"]) || "Sound", downloadUrl: mp3, listenUrl: mp3, duration: Math.round(num(r["duration"])),
      pageUrl: text(r["url"]), creator: user, creatorUrl: user ? `https://freesound.org/people/${encodeURIComponent(user)}/` : "",
      licence: ccFromUrl(lic), requiresCredit: !/publicdomain\/zero|\/zero\//i.test(lic),
    }));
  }
  return { page, total: num(data["count"]), hasMore: typeof data["next"] === "string" && data["next"] !== "", hits };
}

/** Unsplash's rules ask to be told when a photo is used. A failure here must not stop the picture being added. */
export async function trackDownload(h: StockHit, key: string, get: Get): Promise<void> {
  if (h.provider !== "unsplash" || !h.downloadTrigger) return;
  try {
    await get(h.downloadTrigger, [["Authorization", `Client-ID ${key.trim()}`], ["Accept-Version", "v1"]]);
  } catch {
    // Not worth interrupting the author for.
  }
}

/** The record kept in assets.json for a file found here. */
export function creditFor(h: StockHit): CreditEntry["source"] {
  return { provider: h.provider, url: h.pageUrl, creator: h.creator, creatorUrl: h.creatorUrl, licence: h.licence, requiresCredit: h.requiresCredit };
}

/** A file name to give a download, from what the service calls it. */
export function nameFor(h: StockHit): string {
  return `${h.provider}-${h.id}-${h.title}`.slice(0, 60);
}

/** "1:05" for sixty-five seconds. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ---- settings: the author's own keys, kept with the program and never in a project

export interface Settings {
  keys: Record<Provider, string>;
  /** The folder the author last published into. Absent until they choose one. */
  publishFolder?: string;
}

export const KEYED: Provider[] = ["pexels", "pixabay", "unsplash", "freesound"];

export function parseSettings(raw: string): Settings {
  const out: Settings = { keys: { pixabay: "", unsplash: "", pexels: "", freesound: "" } };
  try {
    const data = JSON.parse(raw) as { keys?: Record<string, unknown>; publishFolder?: unknown };
    for (const id of KEYED) out.keys[id] = text(data.keys?.[id]);
    if (text(data.publishFolder).trim() !== "") out.publishFolder = text(data.publishFolder);
  } catch {
    // no settings yet, or a damaged file: start empty
  }
  return out;
}

export const serializeSettings = (s: Settings): string => JSON.stringify(s, null, 2) + "\n";
