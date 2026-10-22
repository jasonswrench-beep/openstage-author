// Formatted text, as the editor keeps it. A text object holds a small, plain kind of HTML (paragraphs, headings, lists, bold, italic, underline,
// links, line breaks, superscript and subscript), the same kind the player is willing to show. A browser's own editing box makes messier HTML than that
// (divs, spans with styles, empty lines, lists inside lists the wrong way), so whatever comes out of one goes through `cleanHtml` before it is kept.
//
// Nothing here touches a page. `parseHtml` reads HTML a browser wrote (every tag closed, attributes quoted) or that this editor wrote, into a small
// tree; `cleanHtml` turns what an editing box made into the canonical form; the tests run on both without a browser.

export interface HNode { tag: string; attrs: Record<string, string>; kids: HChild[] }
export type HChild = HNode | string;

const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "wbr"]);
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });
}

const TOKEN = /<!--[\s\S]*?-->|<\/([A-Za-z][A-Za-z0-9-]*)\s*>|<([A-Za-z][A-Za-z0-9-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+|</g;
const ATTR = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/** HTML as a tree. Tags nobody closed are closed at the end; a closing tag with nothing open to match is ignored. Script and style are dropped with what is in them. */
export function parseHtml(html: string): HChild[] {
  const root: HNode = { tag: "", attrs: {}, kids: [] };
  const stack: HNode[] = [root];
  let skipping: string | null = null;
  for (const m of html.matchAll(TOKEN)) {
    const whole = m[0];
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) {
      const tag = m[1].toLowerCase();
      if (skipping !== null) { if (tag === skipping) skipping = null; continue; }
      const at = stack.map((n) => n.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
    } else if (m[2] !== undefined) {
      const tag = m[2].toLowerCase();
      if (skipping !== null) continue;
      if (tag === "script" || tag === "style") { if (m[4] !== "/") skipping = tag; continue; }
      const attrs: Record<string, string> = {};
      for (const a of (m[3] ?? "").matchAll(ATTR)) attrs[a[1]!.toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? "");
      const node: HNode = { tag, attrs, kids: [] };
      top.kids.push(node);
      if (!VOID.has(tag) && m[4] !== "/") stack.push(node);
    } else if (!whole.startsWith("<!--") && skipping === null) {
      top.kids.push(decode(whole));
    }
  }
  return root.kids;
}

// ---- cleaning

const BLOCKS = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "section", "article", "header", "footer", "main", "nav", "aside", "table", "tbody", "thead", "tr", "td", "th", "figure", "figcaption", "address", "dl", "dt", "dd", "center"]);
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const ALIAS: Record<string, string> = { b: "strong", i: "em" };
const KEPT_INLINE = new Set(["strong", "em", "u", "sup", "sub", "a", "abbr", "code"]);
const SAFE_LINK = /^(https?:|mailto:)/i;
const LANG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

const isNode = (c: HChild): c is HNode => typeof c !== "string";

/** What a style attribute says about weight, slant and underline: a browser editing box and text pasted from elsewhere write it instead of a tag. */
function styleMarks(style: string | undefined): string[] {
  if (!style) return [];
  const marks: string[] = [];
  if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) marks.push("strong");
  if (/font-style\s*:\s*italic/i.test(style)) marks.push("em");
  if (/text-decoration[^;]*underline/i.test(style)) marks.push("u");
  return marks;
}

const wrap = (tags: string[], kids: HChild[]): HChild[] => tags.reduceRight<HChild[]>((inner, tag) => [{ tag, attrs: {}, kids: inner }], kids);

/** The words and marks inside a node, with every tag the player does not take unwrapped and every attribute but a link's address and a language dropped. */
function inlineOf(c: HChild): HChild[] {
  if (typeof c === "string") return [c.replace(/ /g, " ")];
  const tag = ALIAS[c.tag] ?? c.tag;
  const inside = () => c.kids.flatMap(inlineOf);
  if (tag === "br") return [{ tag: "br", attrs: {}, kids: [] }];
  if (tag === "a") {
    const href = c.attrs["href"] ?? "";
    return SAFE_LINK.test(href) ? [{ tag: "a", attrs: { href }, kids: inside() }] : inside();
  }
  if (KEPT_INLINE.has(tag)) return [{ tag, attrs: {}, kids: inside() }];
  if (tag === "span" || tag === "font") {
    const lang = c.attrs["lang"];
    const marks = styleMarks(c.attrs["style"]);
    const kids = lang && LANG.test(lang) ? [{ tag: "span", attrs: { lang }, kids: inside() } as HChild] : inside();
    return wrap(marks, kids);
  }
  // A block inside a mark (an editing box sometimes makes one): its words stay, one line after another.
  if (BLOCKS.has(tag)) return [...inside(), { tag: "br", attrs: {}, kids: [] }];
  return inside();
}

const hasWords = (kids: HChild[]): boolean => kids.some((k) => (typeof k === "string" ? k.trim() !== "" : k.tag !== "br" && hasWords(k.kids)));

/** Run together marks of one kind that touch (bold, then bold again), and drop marks with nothing inside. */
function tidy(kids: HChild[]): HChild[] {
  const out: HChild[] = [];
  const addText = (t: string) => {
    if (t === "") return;
    const last = out[out.length - 1];
    if (typeof last === "string") out[out.length - 1] = (last + t).replace(/ {2,}/g, " ");
    else out.push(t);
  };
  for (const k of kids) {
    if (typeof k === "string") { addText(k); continue; }
    const node: HNode = { ...k, kids: tidy(k.kids) };
    if (node.tag !== "br" && node.kids.length === 0) continue;
    const last = out[out.length - 1];
    if (last && isNode(last) && last.tag === node.tag && ["strong", "em", "u", "sup", "sub", "span"].includes(node.tag) && JSON.stringify(last.attrs) === JSON.stringify(node.attrs)) {
      last.kids = tidy([...last.kids, ...node.kids]);
      continue;
    }
    if (node.tag === "br") { out.push(node); continue; }
    // A space at the edge of a mark belongs outside it, so a mark does not underline or embolden the gap before the next word.
    const first = node.kids[0];
    const end = node.kids[node.kids.length - 1];
    const before = typeof first === "string" && first.startsWith(" ");
    const after = typeof end === "string" && end.endsWith(" ");
    if (before) { node.kids[0] = (first as string).slice(1); addText(" "); }
    if (after) node.kids[node.kids.length - 1] = (end as string).replace(/ $/, "");
    const live = tidy(node.kids);
    if (live.length > 0) out.push({ ...node, kids: live });
    if (after) addText(" ");
  }
  return out;
}

/** Spaces at both ends of a line go, a run of spaces is one, and line breaks at the ends go (a browser puts one at the end of an empty line). */
function trimLine(kids: HChild[]): HChild[] {
  const flat = tidy(kids);
  const collapse = (list: HChild[]): HChild[] => list.map((k) => (typeof k === "string" ? k.replace(/[ \t\r\n]+/g, " ") : { ...k, kids: collapse(k.kids) }));
  let list = collapse(flat);
  const edge = (items: HChild[], fromEnd: boolean): void => {
    for (;;) {
      const at = fromEnd ? items.length - 1 : 0;
      const k = items[at];
      if (k === undefined) return;
      if (typeof k === "string") {
        const t = fromEnd ? k.replace(/ +$/, "") : k.replace(/^ +/, "");
        if (t === "") { items.splice(at, 1); continue; }
        items[at] = t;
        return;
      }
      if (k.tag === "br") { items.splice(at, 1); continue; }
      edge(k.kids, fromEnd);
      if (k.kids.length === 0) { items.splice(at, 1); continue; }
      return;
    }
  };
  list = tidy(list);
  edge(list, false);
  edge(list, true);
  return tidy(list);
}

/** The blocks a run of nodes makes: loose words and marks go into paragraphs, divs open into their own blocks, lists and headings stay what they are. */
function blocksOf(children: HChild[]): HNode[] {
  const out: HNode[] = [];
  let run: HChild[] = [];
  const flush = () => {
    const line = trimLine(run);
    run = [];
    if (hasWords(line)) out.push({ tag: "p", attrs: {}, kids: line });
  };
  for (const c of children) {
    if (typeof c === "string") { run.push(c); continue; }
    const tag = c.tag;
    if (tag === "ul" || tag === "ol") { flush(); const list = listOf(c); if (list) out.push(list); continue; }
    if (HEADINGS.has(tag) || tag === "p") {
      flush();
      if (c.kids.some((k) => isNode(k) && BLOCKS.has(k.tag))) {
        // Blocks inside a paragraph (an editing box can make them): each becomes its own, keeping the kind of the outer one for the first.
        const inner = blocksOf(c.kids);
        out.push(...inner.map((b, i) => (i === 0 && HEADINGS.has(tag) && b.tag === "p" ? { ...b, tag } : b)));
      } else {
        const line = trimLine(c.kids.flatMap(inlineOf));
        if (hasWords(line)) out.push({ tag, attrs: {}, kids: line });
      }
      continue;
    }
    if (tag === "blockquote") { flush(); const inner = blocksOf(c.kids); if (inner.length > 0) out.push({ tag, attrs: {}, kids: inner }); continue; }
    if (BLOCKS.has(tag)) { flush(); out.push(...blocksOf(c.kids)); continue; }
    run.push(...inlineOf(c));
  }
  flush();
  return out;
}

/** A list: its items, with any list that sits straight inside it (which is how an editing box shows a deeper level) moved into the item before it. */
function listOf(list: HNode): HNode | null {
  const items: HNode[] = [];
  const item = (): HNode => ({ tag: "li", attrs: {}, kids: [] });
  for (const c of list.kids) {
    if (typeof c === "string") continue;
    if (c.tag === "li") {
      const li = item();
      let run: HChild[] = [];
      const flush = () => {
        const line = trimLine(run);
        run = [];
        if (hasWords(line)) li.kids.push(...line);
      };
      for (const k of c.kids) {
        if (isNode(k) && (k.tag === "ul" || k.tag === "ol")) {
          flush();
          const nested = listOf(k);
          if (nested) li.kids.push(nested);
        } else if (isNode(k) && BLOCKS.has(k.tag)) {
          // A paragraph or heading inside an item: its words are the item's, on a line of their own.
          const inner = k.kids.flatMap(inlineOf);
          if (hasWords(inner) && run.length > 0) run.push({ tag: "br", attrs: {}, kids: [] });
          run.push(...inner);
        } else run.push(...inlineOf(k));
      }
      flush();
      if (li.kids.length > 0) items.push(li);
    } else if (c.tag === "ul" || c.tag === "ol") {
      const nested = listOf(c);
      if (!nested) continue;
      const last = items[items.length - 1] ?? (items.push(item()), items[0]!);
      last.kids.push(nested);
    }
  }
  const real = items.filter((li) => li.kids.length > 0);
  return real.length > 0 ? { tag: list.tag, attrs: {}, kids: real } : null;
}

// ---- writing it out

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

export function serialize(kids: HChild[]): string {
  return kids.map((k) => {
    if (typeof k === "string") return escapeText(k);
    if (k.tag === "br") return "<br>";
    const attrs = Object.entries(k.attrs).map(([a, v]) => ` ${a}="${escapeAttr(v)}"`).join("");
    return `<${k.tag}${attrs}>${serialize(k.kids)}</${k.tag}>`;
  }).join("");
}

/** What an editing box (or any HTML) comes to in the form the editor keeps: paragraphs, headings, lists, and marks. Nothing is kept that the player would not show. */
export function cleanHtml(html: string): string {
  return serialize(blocksOf(parseHtml(html)));
}

/** The words of some HTML, one line for each paragraph, heading or list item, as a screen reader would meet them. */
export function plainLines(html: string): string[] {
  const lines: string[] = [];
  const words = (kids: HChild[]): string => kids.map((k) => (typeof k === "string" ? k : k.tag === "br" ? " " : k.tag === "ul" || k.tag === "ol" ? "" : words(k.kids))).join("");
  const walk = (kids: HChild[]) => {
    for (const k of kids) {
      if (typeof k === "string") continue;
      if (k.tag === "ul" || k.tag === "ol") { for (const li of k.kids) if (isNode(li)) { lines.push(words(li.kids).replace(/\s+/g, " ").trim()); walk(li.kids); } continue; }
      if (k.tag === "blockquote") { walk(k.kids); continue; }
      lines.push(words(k.kids).replace(/\s+/g, " ").trim());
    }
  };
  walk(blocksOf(parseHtml(html)));
  return lines.filter((l) => l !== "");
}
