// Two content objects that are not interactions: a table and a scrolling text box. Like the
// interactions they are built from real HTML and paint themselves in the theme's colours, which are
// pairs the theme already guarantees, so only the font and its size come from the object's style.

import { appendSanitizedHtml } from "./sanitize.ts";
import type { EmbedContent, OSObject, TableContent } from "./types.ts";

function make(doc: Document, tag: string, cls = ""): HTMLElement {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

/**
 * A data table with real header cells: column headers are th scope="col" and row headers are th
 * scope="row", so a screen reader announces the headers as the reader moves through the cells.
 * The caption, if any, is the table's visible title.
 */
export function buildTable(doc: Document, obj: OSObject, editing: boolean): HTMLElement {
  const t = obj.content as unknown as TableContent;
  const wrap = make(doc, "div", "os-table");
  const table = make(doc, "table") as HTMLTableElement;
  if (t.caption.trim() !== "") {
    const cap = make(doc, "caption");
    cap.textContent = t.caption;
    table.appendChild(cap);
  }
  const cell = (tag: "th" | "td", text: string, scope?: string) => {
    const c = make(doc, tag);
    if (scope) c.setAttribute("scope", scope);
    c.textContent = text;
    return c;
  };
  let tbody: HTMLElement | null = null;
  t.rows.forEach((row, r) => {
    const tr = make(doc, "tr");
    row.forEach((text, c) => {
      if (t.headerRow && r === 0) tr.appendChild(cell("th", text, "col"));
      else if (t.headerColumn && c === 0) tr.appendChild(cell("th", text, "row"));
      else tr.appendChild(cell("td", text));
    });
    if (t.headerRow && r === 0) {
      const head = make(doc, "thead");
      head.appendChild(tr);
      table.appendChild(head);
    } else {
      if (!tbody) { tbody = make(doc, "tbody"); table.appendChild(tbody); }
      tbody.appendChild(tr);
    }
  });
  wrap.appendChild(table);
  if (!obj.accessibility.decorative) {
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", obj.accessibility.altText);
  }
  // A table taller or wider than its box scrolls, and then it must be reachable by keyboard. Only the player
  // needs this; the editor's canvas is steered by the editor's own keys.
  if (!editing && typeof requestAnimationFrame === "function") requestAnimationFrame(() => scrollableIfNeeded(wrap));
  return wrap;
}

/** Make a box that scrolls a stop for the keyboard. Called again when the page changes shape, because that changes what overflows. */
export function scrollableIfNeeded(wrap: HTMLElement): void {
  if (wrap.scrollHeight > wrap.clientHeight + 1 || wrap.scrollWidth > wrap.clientWidth + 1) wrap.tabIndex = 0;
}

/** A box of text that scrolls. It is a labelled region and a tab stop, so the keyboard can scroll it. */
export function buildScrollingText(doc: Document, obj: OSObject, editing: boolean): HTMLElement {
  const box = make(doc, "div", "os-scrolltext");
  if (!obj.accessibility.decorative) {
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", obj.accessibility.altText);
  }
  if (!editing) box.tabIndex = 0;
  appendSanitizedHtml(box, String(obj.content["html"] ?? ""));
  return box;
}

/** A transcript under a video, an audio clip or an embedded player: a native disclosure, so it works by keyboard and is announced as one. */
function transcriptOf(doc: Document, html: string): HTMLElement | null {
  if (html.replace(/<[^>]*>/g, "").trim() === "") return null;
  const details = make(doc, "details", "os-transcript");
  const summary = make(doc, "summary");
  summary.textContent = "Transcript";
  const body = make(doc, "div", "os-transcript-body");
  appendSanitizedHtml(body, html);
  details.append(summary, body);
  return details;
}

/**
 * A video or audio file. Captions become a real caption track. If the object has a transcript, the
 * player sits above it in a box and the media element is found inside.
 */
export function buildMedia(doc: Document, obj: OSObject, onEnded: (id: string) => void): HTMLElement {
  const media = make(doc, obj.type, "os-media") as HTMLMediaElement;
  media.controls = true;
  media.src = String(obj.content["src"] ?? "");
  media.setAttribute("aria-label", obj.accessibility.altText);
  media.addEventListener("ended", () => onEnded(obj.id));
  const captions = obj.content["captions"];
  if (typeof captions === "string" && captions !== "") {
    const track = make(doc, "track") as HTMLTrackElement;
    track.kind = "captions";
    track.label = "Captions";
    track.src = captions;
    media.appendChild(track);
  }
  const transcript = transcriptOf(doc, String(obj.content["transcript"] ?? ""));
  if (!transcript) return media;
  const box = make(doc, "div", "os-media os-mediabox");
  media.classList.remove("os-media");
  media.classList.add("os-media-inner");
  box.append(media, transcript);
  return box;
}

/** The address an embedded video plays from. Only a well-formed id is used, so nothing else can reach the iframe. */
export function embedUrl(c: EmbedContent): string | null {
  if (c.provider === "youtube") return /^[A-Za-z0-9_-]{11}$/.test(c.id) ? `https://www.youtube-nocookie.com/embed/${c.id}?rel=0` : null;
  if (!/^[0-9]{1,12}$/.test(c.id) || !/^[A-Za-z0-9]{0,32}$/.test(c.hash)) return null;
  return `https://player.vimeo.com/video/${c.id}?dnt=1${c.hash ? `&h=${c.hash}` : ""}`;
}

/**
 * A YouTube or Vimeo video. The player is an iframe titled by the object's alt text, with the
 * transcript under it. In the editor it is a plain box, so editing never loads anything from the web.
 */
export function buildEmbed(doc: Document, obj: OSObject, editing: boolean): HTMLElement {
  const c = obj.content as unknown as EmbedContent;
  const box = make(doc, "div", "os-embed");
  const name = c.provider === "youtube" ? "YouTube" : "Vimeo";
  const url = embedUrl(c);
  if (editing || !url) {
    const holder = make(doc, "div", "os-embed-placeholder");
    holder.textContent = url ? `${name} video: ${obj.accessibility.altText || c.id}` : `${name} video: the address is not valid`;
    box.appendChild(holder);
  } else {
    const frame = make(doc, "iframe", "os-embed-frame") as HTMLIFrameElement;
    frame.src = url;
    frame.title = obj.accessibility.altText || `${name} video`;
    frame.allowFullscreen = true;
    frame.loading = "lazy";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.setAttribute("allow", "encrypted-media; picture-in-picture; fullscreen");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox");
    box.appendChild(frame);
  }
  const transcript = transcriptOf(doc, c.transcript);
  if (transcript) box.appendChild(transcript);
  return box;
}
