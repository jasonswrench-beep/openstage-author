// A small reader for the XML inside a PowerPoint file. It needs no library and no browser, so it runs the same in the editor and in tests.
// The parts of a deck are plain, well-formed XML: elements, attributes, text, CDATA and comments. It keeps the prefixes ("p:sp",
// "a:t") as they are written, which is how every PowerPoint file names the same things. It refuses what could cost the editor
// too much to read, so a damaged or hostile file fails with a sentence instead of freezing the window.

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** The text written directly inside this element (not inside its children). */
  text: string;
}

export const XML_LIMITS = { bytes: 40 * 1024 * 1024, nodes: 600_000, depth: 200 };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x")) {
      const n = parseInt(body.slice(2), 16);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    }
    if (body.startsWith("#")) {
      const n = parseInt(body.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[body] ?? whole;
  });
}

// Characters that can be in an element or attribute name: anything but white space and the characters that end one.
const isNameChar = (code: number): boolean => code > 32 && code !== 47 && code !== 62 && code !== 61 && code !== 60 && code !== 34 && code !== 39;
const isSpace = (code: number): boolean => code <= 32;

/** Read XML text into a tree and return its root element. Throws a plain sentence for XML that is not well formed. */
export function parseXml(src: string): XmlNode {
  if (src.length > XML_LIMITS.bytes) throw new Error("A part of this file is too big to read.");
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let nodes = 0;
  const n = src.length;

  const fail = (what: string): never => {
    throw new Error(`A part of this file is not well-formed XML (${what}).`);
  };

  while (i < n) {
    const lt = src.indexOf("<", i);
    const upto = lt === -1 ? n : lt;
    if (upto > i && stack.length > 0) stack[stack.length - 1]!.text += decodeEntities(src.slice(i, upto));
    if (lt === -1) break;
    i = lt;

    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      if (end === -1) fail("a comment is not closed");
      i = end + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i + 9);
      if (end === -1) fail("a CDATA section is not closed");
      if (stack.length > 0) stack[stack.length - 1]!.text += src.slice(i + 9, end);
      i = end + 3;
      continue;
    }
    if (src.startsWith("<?", i)) {
      const end = src.indexOf("?>", i + 2);
      if (end === -1) fail("a processing instruction is not closed");
      i = end + 2;
      continue;
    }
    if (src.startsWith("<!", i)) {
      // A document type: never needed in a deck, and where entity tricks live, so it is skipped and its entities are not defined.
      const end = src.indexOf(">", i + 2);
      if (end === -1) fail("a declaration is not closed");
      i = end + 1;
      continue;
    }
    if (src[i + 1] === "/") {
      const end = src.indexOf(">", i + 2);
      if (end === -1) fail("a closing tag is not closed");
      const name = src.slice(i + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name) fail(`</${name}> does not match`);
      i = end + 1;
      continue;
    }

    // An opening tag.
    i += 1;
    let s = i;
    while (i < n && isNameChar(src.charCodeAt(i))) i += 1;
    const name = src.slice(s, i);
    if (name === "") fail("an element has no name");
    const node: XmlNode = { name, attrs: {}, children: [], text: "" };
    let selfClosing = false;
    for (;;) {
      while (i < n && isSpace(src.charCodeAt(i))) i += 1;
      if (i >= n) fail("a tag is not closed");
      const c = src[i]!;
      if (c === ">") { i += 1; break; }
      if (c === "/") {
        if (src[i + 1] !== ">") fail("a tag has a stray slash");
        selfClosing = true;
        i += 2;
        break;
      }
      s = i;
      while (i < n && isNameChar(src.charCodeAt(i))) i += 1;
      const attr = src.slice(s, i);
      if (attr === "") fail("an attribute has no name");
      while (i < n && isSpace(src.charCodeAt(i))) i += 1;
      if (src[i] !== "=") fail(`the attribute ${attr} has no value`);
      i += 1;
      while (i < n && isSpace(src.charCodeAt(i))) i += 1;
      const quote = src[i];
      if (quote !== '"' && quote !== "'") fail(`the attribute ${attr} is not quoted`);
      const end = src.indexOf(quote!, i + 1);
      if (end === -1) fail(`the attribute ${attr} is not closed`);
      node.attrs[attr] = decodeEntities(src.slice(i + 1, end));
      i = end + 1;
    }

    nodes += 1;
    if (nodes > XML_LIMITS.nodes) throw new Error("A part of this file holds too many elements to read.");
    if (stack.length >= XML_LIMITS.depth) throw new Error("A part of this file is nested too deeply to read.");
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else if (root) fail("there is more than one root element");
    else root = node;
    if (!selfClosing) stack.push(node);
  }
  if (stack.length > 0) fail(`<${stack[stack.length - 1]!.name}> is not closed`);
  if (!root) fail("there is no element");
  return root!;
}

// ---- finding things in the tree

/** The first child with this name, or undefined. */
export const child = (node: XmlNode | undefined, name: string): XmlNode | undefined => node?.children.find((c) => c.name === name);

/** Every child with this name. */
export const kids = (node: XmlNode | undefined, name: string): XmlNode[] => (node ? node.children.filter((c) => c.name === name) : []);

/** Follow a path of child names, such as ["p:cSld", "p:spTree"]. */
export function path(node: XmlNode | undefined, ...names: string[]): XmlNode | undefined {
  let at = node;
  for (const name of names) {
    at = child(at, name);
    if (!at) return undefined;
  }
  return at;
}

/** Every descendant with this name, depth first, in document order. Iterative, so a deep tree cannot overflow the stack. */
export function descendants(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const todo: XmlNode[] = [node];
  while (todo.length > 0) {
    const at = todo.pop()!;
    if (at !== node && at.name === name) out.push(at);
    for (let k = at.children.length - 1; k >= 0; k--) todo.push(at.children[k]!);
  }
  return out;
}

/** An attribute as a number, or undefined if it is missing or not a number. */
export function num(node: XmlNode | undefined, attr: string): number | undefined {
  const v = node?.attrs[attr];
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
