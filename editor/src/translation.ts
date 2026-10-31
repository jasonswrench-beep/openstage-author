// What the Translate dialog says to the author. The translation tool (tools/xliff.py) answers with one line of JSON; this turns
// that into plain sentences, reads a language the author typed, and names the folder a translated course goes into. No page or
// program is needed to use anything here, so it is all tested directly.

import { fileName, parentFolder } from "./publishing.ts";
// (the tool, tools/xliff.py, names the translated course itself: Intro.osproj into fr-FR is made as Intro-fr-FR.osproj)

/** A translation file was made. */
export interface TranslationExported {
  ok: true;
  path: string;
  units: number;
  words: number;
  slides: number;
  sourceLanguage: string;
  targetLanguage: string;
  /** Caption files the course uses. They are separate files and are not in the translation file. */
  captionFiles: string[];
}

/** A translated course was made. */
export interface TranslationImported {
  ok: true;
  out: string;
  language: string;
  /** Pieces of text put back. */
  translated: number;
  /** Left in the original language: the file had nothing for them, or the same words. */
  untranslated: number;
  /** Pieces whose words in the file are not the course's any more. */
  outOfDate: string[];
  /** Pieces whose translation changed tags or placeholders, with why. */
  rejected: { id: string; reason: string }[];
  /** Pieces in the file that the course does not have. */
  unknown: string[];
  /** Narration scripts now marked as being in the new language. */
  narrationToVoice: number;
  captionFiles: string[];
  validator: { errors: number; warnings: number; newErrors: string[] };
}

/** The tool refused, with a reason for the author. */
export interface TranslationFailed {
  ok: false;
  message: string;
}

const UNREADABLE = "The translation tool gave an answer that could not be read.";

/** The tool's one line of JSON. Anything else is the tool failing in a way it could not explain. */
export function parseTranslationAnswer<T extends { ok: true }>(text: string): T | TranslationFailed {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(UNREADABLE);
  }
  if (typeof data !== "object" || data === null || typeof (data as { ok?: unknown }).ok !== "boolean") throw new Error(UNREADABLE);
  const d = data as Record<string, unknown>;
  if (d["ok"] === false) return { ok: false, message: typeof d["message"] === "string" && d["message"].trim() ? d["message"].trim() : "The translation did not work, and the tool gave no reason." };
  return d as unknown as T;
}

/** A language tag in the simple form people type: fr, fr-FR, es-MX, zh-Hans-CN. */
export function isLanguageTag(text: string): boolean {
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(text.trim());
}

/** A few languages offered as suggestions in the dialog. The author can type any tag. */
export const COMMON_LANGUAGES: { tag: string; name: string }[] = [
  { tag: "es-MX", name: "Spanish (Mexico)" },
  { tag: "es-ES", name: "Spanish (Spain)" },
  { tag: "fr-FR", name: "French (France)" },
  { tag: "fr-CA", name: "French (Canada)" },
  { tag: "de-DE", name: "German" },
  { tag: "it-IT", name: "Italian" },
  { tag: "pt-BR", name: "Portuguese (Brazil)" },
  { tag: "nl-NL", name: "Dutch" },
  { tag: "en-GB", name: "English (United Kingdom)" },
  { tag: "ja-JP", name: "Japanese" },
  { tag: "ko-KR", name: "Korean" },
  { tag: "zh-CN", name: "Chinese (Simplified)" },
];

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The file name offered when saving the translation file: Intro.osproj into fr-FR is Intro-fr-FR.xlf. The translated course
 *  is named the same way (Intro-fr-FR.osproj) and made beside the project, by the tool. */
export function translationFileName(projectDir: string, language: string): string {
  const raw = fileName(projectDir);
  const stem = raw.toLowerCase().endsWith(".osproj") ? raw.slice(0, -".osproj".length) : raw;
  return `${stem}-${language.trim()}.xlf`;
}

/** The folder the translated course is made in: beside the project, so it is easy to find. */
export function translatedCourseParent(projectDir: string): string {
  return parentFolder(projectDir);
}

/** What a made translation file holds, and what to do with it. */
export function exportSentences(r: TranslationExported, pseudo: boolean): string[] {
  const lines = [`Made ${fileName(r.path)}: ${plural(r.units, "piece of text", "pieces of text")}, ${plural(r.words, "word", "words")}, to translate from ${r.sourceLanguage} into ${r.targetLanguage}.`];
  if (pseudo) lines.push("This is a pseudo-translation: every word is already accented and made longer, so you can bring it straight back to see where text does not fit and what never reached the file.");
  else lines.push("Give it to a translator who works with XLIFF 1.2 files. When it comes back, choose Bring in a translated file.");
  if (r.captionFiles.length > 0) lines.push(`The captions in ${r.captionFiles.map(fileName).join(", ")} are not in it: they are separate files, translated on their own.`);
  lines.push("The player's own words, such as Next and Listen, are in it too, at the end, so the translated course is in its language all the way through.");
  return lines;
}

/** What a made translated course holds, and what is left to do. */
export function importSentences(r: TranslationImported): string[] {
  const lines = [`Made the translated course ${fileName(r.out)}, in ${r.language}. Your own course is unchanged.`];
  lines.push(`${plural(r.translated, "piece of text was", "pieces of text were")} put back.`);
  if (r.untranslated > 0) lines.push(`${plural(r.untranslated, "was", "were")} left in the original language, because the file had no translation for ${r.untranslated === 1 ? "it" : "them"}.`);
  if (r.outOfDate.length > 0) lines.push(`${plural(r.outOfDate.length, "no longer matches", "no longer match")} the course, which has changed since the file was made, and ${r.outOfDate.length === 1 ? "was" : "were"} left as ${r.outOfDate.length === 1 ? "it was" : "they were"}.`);
  if (r.rejected.length > 0) lines.push(`${plural(r.rejected.length, "translation was", "translations were")} refused because ${r.rejected.length === 1 ? "it" : "they"} changed tags or lost a placeholder. ${r.rejected.length === 1 ? "It is" : "They are"} listed below.`);
  if (r.unknown.length > 0) lines.push(`${plural(r.unknown.length, "piece in the file is", "pieces in the file are")} not in this course.`);
  const { errors, warnings } = r.validator;
  lines.push(`The checker finds ${plural(errors, "error", "errors")} and ${plural(warnings, "warning", "warnings")} in the translated course.`);
  if (r.narrationToVoice > 0) lines.push(`${plural(r.narrationToVoice, "narration script is", "narration scripts are")} now marked ${r.language}. Open the translated course and choose a voice for that language before you publish it.`);
  if (r.captionFiles.length > 0) lines.push(`Caption files were not translated: ${r.captionFiles.map(fileName).join(", ")}.`);
  return lines;
}

/** The problems to list under the summary: refused translations first, then new errors in the checker. At most `limit` lines. */
export function importDetails(r: TranslationImported, limit = 20): string[] {
  const lines = [...r.rejected.map((x) => `${x.id}: ${x.reason}`), ...r.validator.newErrors.map((e) => `New error: ${e}`)];
  return lines.slice(0, limit);
}
