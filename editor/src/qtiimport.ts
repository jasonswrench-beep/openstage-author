// Questions from a QTI file. A learning system or a test-making program saves questions as QTI (a file that ends in .xml, or a .zip package of
// them); this reads one into the same questions the spreadsheet reader makes (`questionimport.ts`), so everything after that is the same: the
// dialog lists what was found row by row, a question with a mistake is left out and said so, and the rest become slides.
//
// What is read: QTI 1.2 (one `questestinterop` file with the items in it, the form Canvas and Brightspace write), QTI 2.1 and 2.2 (a package
// with a file for each `assessmentItem`) and QTI 3.0 (the same with `qti-` names). Multiple choice, true or false, multiple response, short
// answer (one blank) and essay come in. Matching, ordering, hotspot, numeric, several blanks and the like are left out, each named with its
// kind, because they have no form in a table of questions. Pictures and equations are not brought in (a picture is counted and said);
// the words round them are. Feedback comes in when the file ties it to the right or the wrong answer.
//
// Nothing here reads anything outside the file it is given, follows no link, and defines no entity: the XML reader below is the small one
// written for this, which keeps the order of text and elements (the PowerPoint reader does not, and a question's words run through its tags).

import { readZip } from "../../player/src/unzip.ts";
import { decodeEntities } from "./pptx/xml.ts";
import { MAX_ANSWERS, MAX_QUESTIONS, type ImportedQuestion, type ImportProblem, type QuestionRead } from "./questionimport.ts";

// ---- a small XML reader that keeps the order

interface QEl {
  /** The name without its prefix, in lower case with hyphens taken out, so `qti-choice-interaction` and `choiceInteraction` are both `choiceinteraction`. */
  name: string;
  attrs: Record<string, string>;
  kids: (QEl | string)[];
}

const LIMITS = { chars: 20 * 1024 * 1024, nodes: 400_000, depth: 120 };
const norm = (s: string): string => s.replace(/^[^:]*:/, "").replace(/^qti-/i, "").replace(/[-_]/g, "").toLowerCase();

/** Read XML text into a tree. Throws a sentence for XML that is not well formed. A document type is skipped, so no entity is ever defined. */
export function readXml(src: string): QEl {
  if (src.length > LIMITS.chars) throw new Error("A part of this file is too big to read.");
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = src.length;
  const stack: QEl[] = [];
  let root: QEl | null = null;
  let nodes = 0;
  const fail = (what: string): never => { throw new Error(`This file is not well-formed XML (${what}).`); };
  const text = (s: string) => {
    const top = stack[stack.length - 1];
    if (top && s !== "") top.kids.push(s);
  };
  while (i < n) {
    const lt = src.indexOf("<", i);
    const upto = lt === -1 ? n : lt;
    if (upto > i) text(decodeEntities(src.slice(i, upto)));
    if (lt === -1) break;
    i = lt;
    if (src.startsWith("<!--", i)) { const e = src.indexOf("-->", i + 4); if (e === -1) fail("a comment is not closed"); i = e + 3; continue; }
    if (src.startsWith("<![CDATA[", i)) { const e = src.indexOf("]]>", i + 9); if (e === -1) fail("a CDATA section is not closed"); text(src.slice(i + 9, e)); i = e + 3; continue; }
    if (src.startsWith("<?", i)) { const e = src.indexOf("?>", i + 2); if (e === -1) fail("a processing instruction is not closed"); i = e + 2; continue; }
    if (src.startsWith("<!", i)) {
      // A document type may hold a bracketed list of declarations; skip to the closing bracket and then the closing angle.
      let depth = 0; let j = i + 2;
      for (; j < n; j++) { const c = src[j]; if (c === "[") depth++; else if (c === "]") depth--; else if (c === ">" && depth <= 0) break; }
      if (j >= n) fail("a declaration is not closed");
      i = j + 1; continue;
    }
    if (src[i + 1] === "/") {
      const e = src.indexOf(">", i + 2);
      if (e === -1) fail("a closing tag is not closed");
      const open = stack.pop();
      if (!open || open.name !== norm(src.slice(i + 2, e).trim())) fail(`</${src.slice(i + 2, e).trim()}> does not match`);
      i = e + 1; continue;
    }
    i += 1;
    let s = i;
    while (i < n && !/[\s/>]/.test(src[i]!)) i++;
    const rawName = src.slice(s, i);
    if (rawName === "") fail("an element has no name");
    const el: QEl = { name: norm(rawName), attrs: {}, kids: [] };
    let selfClosing = false;
    for (;;) {
      while (i < n && /\s/.test(src[i]!)) i++;
      if (i >= n) fail("a tag is not closed");
      const c = src[i]!;
      if (c === ">") { i++; break; }
      if (c === "/") { if (src[i + 1] !== ">") fail("a tag has a stray slash"); selfClosing = true; i += 2; break; }
      s = i;
      while (i < n && !/[\s=/>]/.test(src[i]!)) i++;
      const attr = src.slice(s, i);
      if (attr === "") fail("an attribute has no name");
      while (i < n && /\s/.test(src[i]!)) i++;
      if (src[i] !== "=") fail(`the attribute ${attr} has no value`);
      i++;
      while (i < n && /\s/.test(src[i]!)) i++;
      const q = src[i];
      if (q !== '"' && q !== "'") fail(`the attribute ${attr} is not quoted`);
      const e = src.indexOf(q!, i + 1);
      if (e === -1) fail(`the attribute ${attr} is not closed`);
      if (!/^xmlns(:|$)/.test(attr)) el.attrs[attr.replace(/^[^:]*:/, "").replace(/[-_]/g, "").toLowerCase()] = decodeEntities(src.slice(i + 1, e));
      i = e + 1;
    }
    if (++nodes > LIMITS.nodes) throw new Error("A part of this file holds too many elements to read.");
    if (stack.length >= LIMITS.depth) throw new Error("A part of this file is nested too deeply to read.");
    const parent = stack[stack.length - 1];
    if (parent) parent.kids.push(el);
    else if (root) fail("there is more than one root element");
    else root = el;
    if (!selfClosing) stack.push(el);
  }
  if (stack.length > 0) fail(`<${stack[stack.length - 1]!.name}> is not closed`);
  if (!root) fail("there is no element");
  return root!;
}

const els = (e: QEl | undefined): QEl[] => (e ? (e.kids.filter((k) => typeof k !== "string") as QEl[]) : []);
const kidsNamed = (e: QEl | undefined, name: string): QEl[] => els(e).filter((k) => k.name === name);
const kid = (e: QEl | undefined, name: string): QEl | undefined => kidsNamed(e, name)[0];
function all(e: QEl | undefined, name: string, into: QEl[] = []): QEl[] {
  for (const k of els(e)) { if (k.name === name) into.push(k); all(k, name, into); }
  return into;
}

// ---- words out of markup

const BLOCKS = new Set(["p", "div", "li", "tr", "br", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "ul", "ol", "table", "prompt"]);

interface Seen { pictures: number; equations: number }

/** The words of an element, with a line break where a paragraph, list item or row ends. Skipped elements are left out. */
function wordsOf(e: QEl | undefined, seen: Seen, skip: (k: QEl) => boolean = () => false): string {
  if (!e) return "";
  const out: string[] = [];
  const walk = (el: QEl) => {
    for (const k of el.kids) {
      if (typeof k === "string") { out.push(k); continue; }
      if (skip(k)) continue;
      if (k.name === "img" || k.name === "object" || k.name === "picture") { seen.pictures++; continue; }
      if (k.name === "math") { seen.equations++; continue; }
      if (BLOCKS.has(k.name)) out.push("\n");
      walk(k);
      if (BLOCKS.has(k.name)) out.push("\n");
    }
  };
  walk(e);
  return out.join("");
}

/** Markup written as text, as QTI 1.2 does for `text/html`: the tags come out, the line ends stay, the usual entities are decoded. */
export function htmlWords(html: string, seen: Seen): string {
  seen.pictures += (html.match(/<img\b/gi) ?? []).length;
  seen.equations += (html.match(/<math\b/gi) ?? []).length;
  return decodeEntities(html
    .replace(/<\s*(?:br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/blockquote|\/pre|\/ul|\/ol|\/table)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " "));
}

/** One line: all runs of white space as one space. */
const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();
/** Paragraphs kept: lines trimmed, runs of blank lines as one break. */
const paragraphs = (s: string): string => s.split(/\r?\n/).map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{2,}/g, "\n").trim();

const attr = (e: QEl | undefined, name: string): string => e?.attrs[name] ?? "";

// ---- what one item is

interface Item {
  type: ImportedQuestion["type"];
  title: string;
  question: string;
  answers: string[];
  correct: number[];
  points: number | null;
  right: string;
  wrong: string;
}
type Result = { item: Item } | { left: string };

const TRUTH = /^(true|false)$/i;
const isTrueFalseLabels = (labels: string[]): boolean => labels.length === 2 && labels.every((l) => TRUTH.test(l.trim())) && labels[0]!.toLowerCase() !== labels[1]!.toLowerCase();

const NAMES_OF_KINDS: Record<string, string> = {
  matching_question: "matching", multiple_dropdowns_question: "dropdown blanks", fill_in_multiple_blanks_question: "several blanks", numerical_question: "numeric",
  calculated_question: "calculated", file_upload_question: "file upload", text_only_question: "text without a question",
  matchinteraction: "matching", gapmatchinteraction: "matching words into blanks", orderinteraction: "putting in order", hotspotinteraction: "hotspot",
  selectpointinteraction: "select a point", graphicgapmatchinteraction: "drag onto a picture", positionobjectinteraction: "position an object",
  sliderinteraction: "slider", inlinechoiceinteraction: "dropdown blanks", hottextinteraction: "choosing words in a text", associateinteraction: "pairing", uploadinteraction: "file upload",
  custominteraction: "a custom kind", mediainteraction: "media",
};

/** Points written as a number, or null. */
const pointsOf = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === "") return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

// ---- QTI 1.2

function readItem12(item: QEl, seen: Seen): Result {
  const title = attr(item, "title") || attr(item, "ident");
  const meta = new Map<string, string>();
  for (const f of all(kid(item, "itemmetadata"), "qtimetadatafield")) meta.set(oneLine(wordsOf(kid(f, "fieldlabel"), seen)).toLowerCase(), oneLine(wordsOf(kid(f, "fieldentry"), seen)));
  const kind = (meta.get("question_type") ?? "").toLowerCase();
  if (NAMES_OF_KINDS[kind]) return { left: `A ${NAMES_OF_KINDS[kind]} question cannot be brought in.` };

  const presentation = kid(item, "presentation");
  const matText = (m: QEl): string => all(m, "mattext").concat(m.name === "mattext" ? [m] : []).map((t) => {
    const raw = wordsOf(t, seen);
    return /html/i.test(attr(t, "texttype")) ? htmlWords(raw, seen) : raw;
  }).join(" ");
  const responses = all(presentation, "responselid");
  const strings = all(presentation, "responsestr");
  if (responses.length > 1) return { left: "A matching question (several choices to match) cannot be brought in." };
  if (responses.length + strings.length === 0) return { left: "There is no answer to give, so there is nothing to ask." };
  if (responses.length > 0 && strings.length > 0) return { left: "A question with a choice and a typed answer cannot be brought in." };
  if (strings.length > 1) return { left: "A question with several blanks cannot be brought in." };

  // The question: the material of the presentation that is not inside a response.
  const stemParts: string[] = [];
  const collect = (e: QEl) => {
    for (const k of els(e)) {
      if (k.name === "responselid" || k.name === "responsestr" || k.name === "responsegrp") continue;
      if (k.name === "material") stemParts.push(matText(k));
      else if (k.name === "flow" || k.name === "flowmat" || k.name === "flowlabel") collect(k);
    }
  };
  if (presentation) collect(presentation);
  const question = oneLine(stemParts.join("\n"));

  // The answers
  const resp = responses[0] ?? strings[0]!;
  const labels = responses[0] ? all(responses[0], "responselabel") : [];
  const identOf = labels.map((l) => attr(l, "ident"));
  const answers = labels.map((l) => oneLine(all(l, "material").map(matText).join(" ")));
  const multiple = /^multiple$/i.test(attr(resp, "rcardinality"));

  // The conditions: which answers earn the points, and where the feedback is
  const processing = kid(item, "resprocessing");
  const decvar = kid(kid(processing, "outcomes"), "decvar");
  const points = pointsOf(meta.get("points_possible")) ?? pointsOf(attr(decvar, "maxvalue"));
  const rights: string[] = [];
  const pairs: { text: string; keep: boolean }[] = [];
  const feedbackOf = (ident: string): string => {
    const fb = all(item, "itemfeedback").find((f) => attr(f, "ident") === ident);
    return fb ? paragraphs(htmlOrPlain(fb)) : "";
  };
  const htmlOrPlain = (e: QEl): string => {
    const parts = all(e, "mattext").map((t) => { const raw = wordsOf(t, seen); return /html/i.test(attr(t, "texttype")) ? htmlWords(raw, seen) : raw; });
    return parts.join("\n");
  };
  let right = "";
  let wrong = "";
  const links = (c: QEl): string[] => all(c, "displayfeedback").map((d) => attr(d, "linkrefid"));
  const conditions = kidsNamed(processing, "respcondition");
  const awarding = (cond: QEl): boolean => all(cond, "setvar").some((s) => { const v = Number(oneLine(wordsOf(s, seen))); return /^(set|add)?$/i.test(attr(s, "action")) && Number.isFinite(v) && v > 0; });
  // First the conditions that earn the points: their equalities are the right answers, and any feedback they show is the feedback for a right answer.
  for (const cond of conditions) {
    const vars = kid(cond, "conditionvar");
    if (!awarding(cond) || !vars) continue;
    const walk = (e: QEl, negated: boolean) => {
      for (const k of els(e)) {
        if (k.name === "varequal") { if (!negated) pairs.push({ text: oneLine(wordsOf(k, seen)), keep: true }); }
        else if (k.name === "not") walk(k, !negated);
        else if (k.name === "and" || k.name === "or") walk(k, negated);
      }
    };
    walk(vars, false);
    if (right === "") right = links(cond).map(feedbackOf).filter(Boolean).join("\n");
  }
  // Then the ones that only show feedback: for a right answer, or for any other.
  for (const cond of conditions) {
    if (awarding(cond) || links(cond).length === 0) continue;
    const text = links(cond).map(feedbackOf).filter(Boolean).join("\n");
    if (text === "") continue;
    const equal = all(kid(cond, "conditionvar"), "varequal").map((v) => oneLine(wordsOf(v, seen)));
    const forRight = equal.length > 0 && equal.every((v) => pairs.some((p) => p.text === v));
    if (forRight) { if (right === "") right = text; } else if (wrong === "") wrong = text;
  }
  for (const f of all(item, "itemfeedback")) {
    const id = attr(f, "ident").toLowerCase();
    const body = paragraphs(htmlOrPlain(f));
    if (body === "") continue;
    if (/incorrect|wrong/.test(id)) { if (wrong === "") wrong = body; }
    else if (/correct|right/.test(id)) { if (right === "") right = body; }
    else if (/general/.test(id)) { if (right === "") right = body; if (wrong === "") wrong = body; }
  }
  for (const p of pairs) rights.push(p.text);

  if (question === "") return { left: "There is no question text." };
  if (responses[0]) {
    if (answers.some((a) => a === "")) return { left: "An answer has no words (it may be a picture), so the question was left out." };
    const correct = [...new Set(rights.map((r) => identOf.indexOf(r)).filter((p) => p >= 0))].sort((a, b) => a - b);
    if (isTrueFalseLabels(answers) && !multiple) {
      if (correct.length !== 1) return { left: "The right answer is not stated in a way that can be read." };
      return { item: { type: "tf", title, question, answers: ["True", "False"], correct: [/^true$/i.test(answers[correct[0]!]!.trim()) ? 0 : 1], points, right, wrong } };
    }
    if (correct.length === 0) return { left: "The right answer is not stated in a way that can be read." };
    if (!multiple && correct.length > 1) return { left: "A question with one choice has more than one right answer." };
    return { item: { type: multiple ? "mr" : "mc", title, question, answers, correct, points, right, wrong } };
  }
  // A typed answer: an essay when it says so, or when nothing in it can be met
  if (kind === "essay_question" || (kind !== "short_answer_question" && rights.length === 0)) return { item: { type: "essay", title, question, answers: [], correct: [], points, right, wrong } };
  const accepted = [...new Set(rights.filter((r) => r !== ""))];
  if (accepted.length === 0) return { left: "No accepted answer is stated." };
  return { item: { type: "short", title, question, answers: accepted, correct: [], points, right, wrong } };
}

// ---- QTI 2.1, 2.2 and 3.0

function readItem2(item: QEl, seen: Seen): Result {
  const title = attr(item, "title") || attr(item, "identifier");
  const body = kid(item, "itembody");
  if (!body) return { left: "The question has no body." };
  const known = ["choiceinteraction", "textentryinteraction", "extendedtextinteraction"];
  const interactions = all(body, "choiceinteraction").concat(all(body, "textentryinteraction"), all(body, "extendedtextinteraction"));
  const anyOther: QEl[] = [];
  const find = (e: QEl) => { for (const k of els(e)) { if (/interaction$/.test(k.name) && !known.includes(k.name)) anyOther.push(k); find(k); } };
  find(body);
  if (anyOther.length > 0) return { left: `A ${NAMES_OF_KINDS[anyOther[0]!.name] ?? "different kind of"} question cannot be brought in.` };
  if (interactions.length === 0) return { left: "The question has nothing to answer." };
  if (interactions.length > 1) return { left: all(body, "textentryinteraction").length > 1 ? "A question with several blanks cannot be brought in." : "A question with more than one thing to answer cannot be brought in." };

  const it = interactions[0]!;
  const skip = (k: QEl): boolean => k.name === "simplechoice";
  // The question: the words of the body outside the choices, with the interaction's prompt, and a blank marked where a typed answer goes.
  const stemWords = (): string => {
    const parts: string[] = [];
    const walk = (e: QEl) => {
      for (const k of e.kids) {
        if (typeof k === "string") { parts.push(k); continue; }
        if (skip(k)) continue;
        if (k.name === "textentryinteraction") { parts.push(" ____ "); continue; }
        if (k.name === "img" || k.name === "object" || k.name === "picture") { seen.pictures++; continue; }
        if (k.name === "math") { seen.equations++; continue; }
        if (BLOCKS.has(k.name)) parts.push("\n");
        walk(k);
        if (BLOCKS.has(k.name)) parts.push("\n");
      }
    };
    walk(body);
    return parts.join("");
  };
  const question = oneLine(stemWords());
  if (question === "") return { left: "There is no question text." };

  // The declared answer
  const declaration = kidsNamed(item, "responsedeclaration").find((d) => attr(d, "identifier") === attr(it, "responseidentifier")) ?? kid(item, "responsedeclaration");
  const correctValues = kidsNamed(kid(declaration, "correctresponse"), "value").map((v) => oneLine(wordsOf(v, seen)));
  const cardinality = attr(declaration, "cardinality").toLowerCase();

  // Points: the declared maximum, or the largest value any outcome is set to start at
  const pts = (() => {
    const outcome = kidsNamed(item, "outcomedeclaration").find((o) => /^max/i.test(attr(o, "identifier")) || /score/i.test(attr(o, "identifier")));
    return pointsOf(oneLine(wordsOf(kid(kid(outcome, "defaultvalue"), "value"), seen))) ?? pointsOf(attr(outcome, "normalmaximum"));
  })();

  // Feedback: a modal feedback tied to an outcome by its identifier
  let right = "";
  let wrong = "";
  for (const f of all(item, "modalfeedback")) {
    const id = `${attr(f, "identifier")} ${attr(f, "outcomeidentifier")}`.toLowerCase();
    const text = paragraphs(wordsOf(f, seen));
    if (text === "") continue;
    if (/incorrect|wrong/.test(id)) { if (wrong === "") wrong = text; }
    else if (/correct|right/.test(id)) { if (right === "") right = text; }
    else if (/general|generic/.test(id)) { if (right === "") right = text; if (wrong === "") wrong = text; }
  }

  if (it.name === "choiceinteraction") {
    const choices = all(it, "simplechoice");
    const ids = choices.map((c) => attr(c, "identifier"));
    const answers = choices.map((c) => oneLine(wordsOf(c, seen)));
    if (answers.some((a) => a === "")) return { left: "An answer has no words (it may be a picture), so the question was left out." };
    const correct = [...new Set(correctValues.map((v) => ids.indexOf(v)).filter((p) => p >= 0))].sort((a, b) => a - b);
    if (correct.length === 0) return { left: "The right answer is not stated in a way that can be read." };
    const max = Number(attr(it, "maxchoices") || "1");
    const multiple = cardinality === "multiple" || max === 0 || max > 1;
    if (!multiple && correct.length > 1) return { left: "A question with one choice has more than one right answer." };
    if (isTrueFalseLabels(answers) && !multiple) return { item: { type: "tf", title, question, answers: ["True", "False"], correct: [/^true$/i.test(answers[correct[0]!]!.trim()) ? 0 : 1], points: pts, right, wrong } };
    return { item: { type: multiple ? "mr" : "mc", title, question, answers, correct, points: pts, right, wrong } };
  }
  if (it.name === "textentryinteraction") {
    const mapped = all(declaration, "mapentry").map((m) => attr(m, "mapkey"));
    const accepted = [...new Set([...correctValues, ...mapped].map((v) => oneLine(v)).filter((v) => v !== ""))];
    if (accepted.length === 0) return { left: "No accepted answer is stated." };
    return { item: { type: "short", title, question, answers: accepted, correct: [], points: pts, right, wrong } };
  }
  return { item: { type: "essay", title, question, answers: [], correct: [], points: pts, right, wrong } };
}

// ---- the file

const ROOT_ITEMS = new Set(["assessmentitem"]);

/** The questions of one XML file: every `item` of a 1.2 file, or the one `assessmentItem` of a 2.x or 3.0 file. */
function readFile(xml: string, seen: Seen, fileLabel: string): { results: Result[]; kinds: string[] } | null {
  let root: QEl;
  try { root = readXml(xml); } catch (e) { throw new Error(`${fileLabel}: ${e instanceof Error ? e.message : String(e)}`); }
  if (root.name === "questestinterop") return { results: all(root, "item").map((i) => readItem12(i, seen)), kinds: ["QTI 1.2"] };
  if (ROOT_ITEMS.has(root.name)) return { results: [readItem2(root, seen)], kinds: ["QTI 2 or 3"] };
  return null;
}

/** The order the manifest lists the files in, when there is one: the question files in the order of its resources. */
function manifestOrder(files: Record<string, Uint8Array>, decoder: TextDecoder): string[] {
  const name = Object.keys(files).find((f) => /(^|\/)imsmanifest\.xml$/i.test(f));
  if (!name) return [];
  try {
    const root = readXml(decoder.decode(files[name]!));
    const base = name.replace(/imsmanifest\.xml$/i, "");
    return all(root, "file").map((f) => (base + attr(f, "href")).replace(/\/\.\//g, "/")).filter((f) => f in files);
  } catch { return []; }
}

export const QTI_EXTENSIONS = /\.(xml|zip|qti)$/i;

/**
 * Read a QTI file (a .xml file, or a .zip package of them) into questions. Everything is checked as the table reader checks a row; a question with a
 * mistake is left out and says what it was. `row` is the question's number in the file, counting from 1.
 */
export function readQti(bytes: Uint8Array, fileName: string): QuestionRead {
  const questions: ImportedQuestion[] = [];
  const problems: ImportProblem[] = [];
  const notes: string[] = [];
  const decoder = new TextDecoder("utf-8");
  const seen: Seen = { pictures: 0, equations: 0 };
  const fail = (message: string): QuestionRead => ({ questions: [], problems: [{ row: 1, severity: "error", message }], unusedColumns: [], rows: 0 });

  if (bytes.length > 60 * 1024 * 1024) return fail("That file is larger than 60 MB, which is far more than a set of questions needs.");
  const zipped = bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const parts: { label: string; xml: string }[] = [];
  if (zipped) {
    let files: Record<string, Uint8Array>;
    try { files = readZip(bytes); } catch (e) { return fail(/zip file/.test(String(e)) ? "That file could not be opened as a zip file." : (e instanceof Error ? e.message : String(e))); }
    const ordered = manifestOrder(files, decoder);
    const names = Object.keys(files).filter((f) => /\.xml$/i.test(f) && !/(^|\/)imsmanifest\.xml$/i.test(f)).sort();
    for (const f of [...ordered.filter((o) => /\.xml$/i.test(o)), ...names.filter((n) => !ordered.includes(n))]) parts.push({ label: f, xml: decoder.decode(files[f]!) });
  } else {
    parts.push({ label: fileName, xml: decoder.decode(bytes) });
  }

  const results: { result: Result; file: string }[] = [];
  const versions = new Set<string>();
  for (const part of parts) {
    let read: ReturnType<typeof readFile>;
    try { read = readFile(part.xml, seen, part.label); } catch (e) { problems.push({ row: results.length + 1, severity: "error", message: e instanceof Error ? e.message : String(e) }); continue; }
    if (!read) continue;
    read.kinds.forEach((k) => versions.add(k));
    for (const r of read.results) results.push({ result: r, file: part.label });
  }
  if (results.length === 0 && problems.length === 0) return fail(zipped ? "No QTI questions were found in that package." : "That file is not a QTI file of questions (it should begin with a questestinterop or assessmentItem element).");

  const seenQuestion = new Map<string, number>();
  results.forEach(({ result }, k) => {
    const row = k + 1;
    if ("left" in result) { problems.push({ row, severity: "error", message: `${result.left}` }); return; }
    const it = result.item;
    const label = it.title && it.title !== it.question ? ` ("${it.title}")` : "";
    if (it.type !== "essay" && it.type !== "short" && it.answers.length > MAX_ANSWERS) { problems.push({ row, severity: "error", message: `The question${label} has more than ${MAX_ANSWERS} answers, so it was left out.` }); return; }
    if (it.type === "short" && it.answers.length > 10) it.answers = it.answers.slice(0, 10);
    if (it.type === "mr" && it.correct.length === it.answers.length) { problems.push({ row, severity: "error", message: `Every answer of the question${label} is right, so there is nothing to choose.` }); return; }
    if (new Set(it.answers.map((a) => a.toLowerCase())).size < it.answers.length && it.type !== "short") problems.push({ row, severity: "warning", message: "Two answers are the same." });
    const key = it.question.toLowerCase();
    if (seenQuestion.has(key)) problems.push({ row, severity: "warning", message: `This is the same question as number ${seenQuestion.get(key)}.` });
    else seenQuestion.set(key, row);
    questions.push({ row, type: it.type, question: it.question, answers: it.answers, correct: it.correct, points: it.points, attempts: null, category: "", value: null, rightFeedback: it.right, wrongFeedback: it.wrong });
  });

  if (seen.pictures > 0) notes.push(`${seen.pictures === 1 ? "A picture" : `${seen.pictures} pictures`} in the questions ${seen.pictures === 1 ? "was" : "were"} not brought in. Add ${seen.pictures === 1 ? "it" : "them"} on the slides afterwards, with a description.`);
  if (seen.equations > 0) notes.push(`${seen.equations === 1 ? "An equation" : `${seen.equations} equations`} in the questions ${seen.equations === 1 ? "was" : "were"} not brought in, so ${seen.equations === 1 ? "its" : "their"} place is empty in the words.`);

  if (questions.length > MAX_QUESTIONS) {
    problems.push({ row: 1, severity: "error", message: `The file holds ${questions.length} questions and at most ${MAX_QUESTIONS} can be added at once. Split it into two files.` });
    return { questions: [], problems, unusedColumns: [], rows: results.length, notes };
  }
  problems.sort((a, b) => a.row - b.row);
  return { questions, problems, unusedColumns: [], rows: results.length, notes: [`Read as ${[...versions].join(" and ")}.`, ...notes] };
}
