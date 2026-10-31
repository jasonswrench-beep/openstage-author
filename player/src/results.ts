// A results box and a certificate. The results box tells a learner their score, whether they passed, and (if the
// author wants) how each question went. The certificate is for a learner who passed: they type their own name,
// then print it or save it as a PDF with the browser's own Print.
//
// Everything that is words lives here as small functions, so it can be tested without a page. The blocks that are
// drawn from them are at the bottom. Like the other blocks they paint themselves in the theme's colours, so only
// the font and its size come from the object's style.

import type { CertificateContent, OSObject, ResultsContent } from "./types.ts";
import { t, tn } from "./playertext.ts";

export type QuestionState = "correct" | "partial" | "incorrect" | "open" | "unanswered";

export interface QuestionResult {
  /** The name of the slide the question is on, which is what the learner knows it by. */
  slideName: string;
  objectId: string;
  points: number;
  /** Points earned: all of them for a right answer on any attempt, none otherwise. */
  earned: number;
  /** open: answered wrongly, but with attempts left. */
  state: QuestionState;
}

/** Where the learner stands in the quiz. */
export interface CourseResults {
  questions: QuestionResult[];
  totalPoints: number;
  earnedPoints: number;
  /** 0 to 100, or null until every question is finished. */
  percent: number | null;
  /** Every question is answered right or out of attempts. */
  finished: boolean;
  /** Null until the quiz is finished. */
  passed: boolean | null;
  passMark: number;
}

export interface CourseInfo {
  title: string;
  language: string;
}

export interface ResultsDeps {
  /** In the editor a box shows an example and does nothing. */
  editing: boolean;
  results(): CourseResults | undefined;
  course(): CourseInfo;
}

// ---- the words

/** 80, 66.67 and 100: no needless decimals. */
export const roundPercent = (n: number): string => String(Math.round(n * 100) / 100);

export function scoreSentence(r: CourseResults): string {
  if (r.questions.length === 0) return t("results.none");
  if (r.finished) return t("results.scored", { earned: r.earnedPoints, total: r.totalPoints, percent: roundPercent(r.percent ?? 0) });
  const done = r.questions.filter((q) => q.state === "correct" || q.state === "partial" || q.state === "incorrect").length;
  return tn("results.progress", r.questions.length, { done });
}

export function verdictSentence(r: CourseResults, c: ResultsContent): string {
  if (r.questions.length === 0) return "";
  if (!r.finished) return t("results.finishFirst");
  const extra = (r.passed ? c.passMessage : c.failMessage).trim();
  return `${r.passed ? t("results.passed") : t("results.failed")}${extra ? ` ${extra}` : ""}`;
}

export const passMarkSentence = (r: CourseResults): string => t("results.passMark", { mark: r.passMark });

/** What one question came to, in words that do not depend on colour. */
export function questionLine(q: QuestionResult): string {
  const how = {
    correct: tn("results.lineCorrect", q.points, { earned: q.earned }),
    partial: tn("results.linePartial", q.points, { earned: q.earned }),
    incorrect: tn("results.lineIncorrect", q.points),
    open: t("results.lineOpen"),
    unanswered: t("results.lineUnanswered"),
  }[q.state];
  return t("results.line", { slide: q.slideName, how });
}

// ---- the certificate's words

/** What the learner typed, with the spaces tidied and a sensible limit. */
export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 100);
}

/** "October 12, 2026", in the course's language. A date the language cannot format falls back to English. */
export function certificateDate(now: Date, language: string, timeZone?: string): string {
  const options: Intl.DateTimeFormatOptions = { dateStyle: "long", ...(timeZone ? { timeZone } : {}) };
  try {
    return new Intl.DateTimeFormat(language, options).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-US", options).format(now);
  }
}

export interface CertificateLine {
  tag: "h2" | "p";
  cls: string;
  text: string;
}

/** The lines of a certificate, top to bottom. A line the author left empty is left out. */
export function certificateLines(c: CertificateContent, name: string, r: CourseResults | undefined, info: CourseInfo, now: Date): CertificateLine[] {
  const lines: CertificateLine[] = [{ tag: "h2", cls: "os-cert-title", text: c.title }];
  const add = (cls: string, text: string) => { if (text.trim() !== "") lines.push({ tag: "p", cls, text: text.trim() }); };
  add("os-cert-statement", c.statement);
  add("os-cert-name", name);
  add("os-cert-achievement", c.achievement);
  add("os-cert-course", info.title);
  if (c.showScore && r && r.percent !== null) add("os-cert-fact", t("certificate.score", { percent: roundPercent(r.percent) }));
  if (c.showDate) add("os-cert-fact", t("certificate.date", { date: certificateDate(now, info.language) }));
  add("os-cert-issuer", c.issuedBy);
  return lines;
}

/** Why there is no certificate yet, for a learner who has not passed. */
export function lockedSentence(r: CourseResults | undefined): string {
  if (!r || r.questions.length === 0) return t("certificate.none");
  if (!r.finished) return t("certificate.locked");
  return t("certificate.notPassed");
}

// ---- drawing

function make(doc: Document, tag: string, cls = ""): HTMLElement {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

/** What the editor shows in place of a real learner's results. */
const SAMPLE: CourseResults = {
  questions: [
    { slideName: "Question 1", objectId: "a", points: 10, earned: 10, state: "correct" },
    { slideName: "Question 2", objectId: "b", points: 10, earned: 0, state: "incorrect" },
    { slideName: "Question 3", objectId: "c", points: 10, earned: 10, state: "correct" },
  ],
  totalPoints: 30, earnedPoints: 20, percent: 66.67, finished: true, passed: false, passMark: 80,
};

/** The score, whether the learner passed, and optionally each question. It is a labelled region, so a screen reader can jump to it. */
export function buildResults(doc: Document, obj: OSObject, deps: ResultsDeps): HTMLElement {
  const c = obj.content as unknown as ResultsContent;
  const box = make(doc, "section", "os-results");
  if (!obj.accessibility.decorative) box.setAttribute("aria-label", obj.accessibility.altText);
  const h = make(doc, "h2");
  h.textContent = c.heading;
  box.appendChild(h);
  const data = deps.editing ? SAMPLE : deps.results();
  if (!data) {
    const p = make(doc, "p");
    p.textContent = t("results.unavailable");
    box.appendChild(p);
    return box;
  }
  const line = (cls: string, text: string) => {
    if (text === "") return;
    const p = make(doc, "p", cls);
    p.textContent = text;
    box.appendChild(p);
  };
  if (deps.editing) line("os-results-sample", t("results.example"));
  line("os-results-score", scoreSentence(data));
  line("os-results-verdict", verdictSentence(data, c));
  if (data.questions.length > 0) line("os-results-mark", passMarkSentence(data));
  if (c.review && data.questions.length > 0) {
    const list = make(doc, "ol", "os-results-review");
    list.setAttribute("aria-label", t("results.reviewLabel"));
    for (const q of data.questions) {
      const li = make(doc, "li", `os-results-${q.state}`);
      li.textContent = questionLine(q);
      list.appendChild(li);
    }
    box.appendChild(list);
  }
  return box;
}

function paperOf(doc: Document, lines: CertificateLine[]): HTMLElement {
  const paper = make(doc, "div", "os-certificate");
  paper.setAttribute("role", "group");
  paper.setAttribute("aria-label", t("certificate.label"));
  for (const l of lines) {
    const e = make(doc, l.tag, l.cls);
    e.textContent = l.text;
    paper.appendChild(e);
  }
  return paper;
}

/**
 * A certificate for a learner who passed. They type their own name, press a button, and the certificate
 * appears with a button to print it or save it as a PDF. Printing shows only the certificate.
 */
export function buildCertificate(doc: Document, obj: OSObject, deps: ResultsDeps): HTMLElement {
  const c = obj.content as unknown as CertificateContent;
  const box = make(doc, "section", "os-certificate-box");
  if (!obj.accessibility.decorative) box.setAttribute("aria-label", obj.accessibility.altText);
  const data = deps.editing ? { ...SAMPLE, passed: true, percent: 100 } : deps.results();
  const info = deps.course();

  if (deps.editing) {
    const note = make(doc, "p", "os-results-sample");
    note.textContent = t("certificate.example");
    box.append(note, paperOf(doc, certificateLines(c, t("certificate.sampleName"), data, info, new Date())));
    return box;
  }
  if (!data || data.passed !== true) {
    const p = make(doc, "p", "os-cert-locked");
    p.textContent = lockedSentence(data);
    box.appendChild(p);
    return box;
  }

  const form = make(doc, "form", "os-cert-form") as HTMLFormElement;
  const id = `os-cert-name-${obj.id}`;
  const label = make(doc, "label") as HTMLLabelElement;
  label.htmlFor = id;
  label.textContent = t("certificate.nameLabel");
  const input = make(doc, "input", "os-cert-input") as HTMLInputElement;
  input.id = id;
  input.type = "text";
  input.maxLength = 100;
  input.autocomplete = "name";
  const makeBtn = make(doc, "button", "os-nav-btn os-cert-make") as HTMLButtonElement;
  makeBtn.type = "submit";
  makeBtn.textContent = t("certificate.make");
  const status = make(doc, "p", "os-cert-status");
  status.setAttribute("role", "status");
  const holder = make(doc, "div", "os-cert-holder");
  const print = make(doc, "button", "os-nav-btn os-cert-print") as HTMLButtonElement;
  print.type = "button";
  print.textContent = t("certificate.print");
  print.hidden = true;
  // The print button sits in the same row as the name, so it is never pushed below the certificate and out of sight.
  form.append(label, input, makeBtn, print);
  box.append(form, status, holder);

  let paper: HTMLElement | null = null;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = cleanName(input.value);
    if (name === "") {
      status.textContent = t("certificate.saidNoName");
      input.focus();
      return;
    }
    paper = paperOf(doc, certificateLines(c, name, data, info, new Date()));
    holder.replaceChildren(paper);
    print.hidden = false;
    status.textContent = t("certificate.saidReady");
  });

  print.addEventListener("click", () => {
    const view = doc.defaultView;
    if (!paper || !view) return;
    // A copy goes straight into the page, outside the scaled and clipped stage, and printing shows only that copy.
    const sheet = make(doc, "div", "os-print-sheet");
    sheet.appendChild(paper.cloneNode(true));
    doc.body.appendChild(sheet);
    doc.documentElement.classList.add("os-printing");
    const done = () => {
      doc.documentElement.classList.remove("os-printing");
      sheet.remove();
      view.removeEventListener("afterprint", done);
    };
    view.addEventListener("afterprint", done);
    view.print();
  });
  return box;
}
