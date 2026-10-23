// Text objects carry author-written HTML. Only a small set of tags is allowed through,
// so a project file cannot run script in the published course. A span may carry a colour and a size (spanstyle.ts) and nothing else of a style.

import { safeSpanStyle } from "./spanstyle.ts";

const ALLOWED = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li", "strong", "em", "b", "i",
  "u", "br", "span", "sup", "sub", "blockquote", "a", "abbr", "code",
]);

// Tags whose content is code, not text. Removed entirely.
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript"]);

const SAFE_HREF = /^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i;

/** Append a sanitised copy of `html` to `target`. */
export function appendSanitizedHtml(target: HTMLElement, html: string): void {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const node of Array.from(doc.body.childNodes)) {
    const clean = cleanNode(node, target.ownerDocument);
    if (clean) target.appendChild(clean);
  }
}

function cleanNode(node: Node, out: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return out.createTextNode(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (DROP_WITH_CONTENT.has(tag)) return null;
  if (!ALLOWED.has(tag)) {
    // Drop the tag but keep its text, so nothing the author wrote silently disappears.
    const frag = out.createDocumentFragment();
    for (const child of Array.from(el.childNodes)) {
      const c = cleanNode(child, out);
      if (c) frag.appendChild(c);
    }
    return frag;
  }
  const copy = out.createElement(tag);
  if (tag === "a") {
    const href = el.getAttribute("href") ?? "";
    if (SAFE_HREF.test(href)) copy.setAttribute("href", href);
  }
  const lang = el.getAttribute("lang");
  if (lang && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang)) copy.setAttribute("lang", lang);
  if (tag === "span") {
    const style = safeSpanStyle(el.getAttribute("style"));
    if (style) copy.setAttribute("style", style);
  }
  for (const child of Array.from(el.childNodes)) {
    const c = cleanNode(child, out);
    if (c) copy.appendChild(c);
  }
  return copy;
}
