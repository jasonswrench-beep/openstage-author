import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMMON_LANGUAGES, exportSentences, importDetails, importSentences, isLanguageTag, parseTranslationAnswer, translatedCourseParent,
  translationFileName, type TranslationExported, type TranslationImported,
} from "./translation.ts";

const exported = (over: Partial<TranslationExported> = {}): TranslationExported => ({
  ok: true, path: "C:\\Courses\\Intro-fr-FR.xlf", units: 297, words: 1074, slides: 12, sourceLanguage: "en-US", targetLanguage: "fr-FR", captionFiles: [], ...over,
});
const imported = (over: Partial<TranslationImported> = {}): TranslationImported => ({
  ok: true, out: "C:\\Courses\\Intro-fr-FR.osproj", language: "fr-FR", translated: 290, untranslated: 0, outOfDate: [], rejected: [], unknown: [], narrationToVoice: 0,
  captionFiles: [], validator: { errors: 0, warnings: 0, newErrors: [] }, ...over,
});

test("the tool's answer is read, a refusal keeps its reason, and anything else is refused with a plain message", () => {
  const good = parseTranslationAnswer<TranslationExported>('{"ok":true,"path":"x.xlf","units":3,"words":9,"slides":1,"sourceLanguage":"en-US","targetLanguage":"fr","captionFiles":[]}');
  assert.equal(good.ok, true);
  assert.equal((good as TranslationExported).units, 3);
  assert.deepEqual(parseTranslationAnswer('{"ok":false,"message":"  The course is already in en-US.  "}'), { ok: false, message: "The course is already in en-US." });
  assert.match((parseTranslationAnswer('{"ok":false}') as { message: string }).message, /gave no reason/);
  for (const bad of ["", "not json", "[]", "null", '{"units":2}', '{"ok":"yes"}']) {
    assert.throws(() => parseTranslationAnswer(bad), /could not be read/, bad);
  }
});

test("a language tag is what people type: fr, fr-FR, zh-Hans-CN", () => {
  for (const ok of ["fr", "fr-FR", "es-MX", "zh-Hans-CN", "eng", " de-DE "]) assert.equal(isLanguageTag(ok), true, ok);
  for (const bad of ["", "f", "French", "fr_FR", "fr-", "fr FR", "1234", "fr-F"]) assert.equal(isLanguageTag(bad), false, bad);
  for (const { tag } of COMMON_LANGUAGES) assert.equal(isLanguageTag(tag), true, tag);
  assert.equal(new Set(COMMON_LANGUAGES.map((l) => l.tag)).size, COMMON_LANGUAGES.length);
});

test("the translation file is named after the project and the language, and the translated course is made beside the project", () => {
  assert.equal(translationFileName("C:\\Courses\\Intro.osproj", "fr-FR"), "Intro-fr-FR.xlf");
  assert.equal(translationFileName("/home/jo/Intro.osproj/", " es "), "Intro-es.xlf");
  assert.equal(translationFileName("C:\\Courses\\Plain", "de"), "Plain-de.xlf");
  assert.equal(translatedCourseParent("C:\\Courses\\Intro.osproj"), "C:\\Courses");
  assert.equal(translatedCourseParent("/home/jo/courses/Intro.osproj"), "/home/jo/courses");
  assert.equal(translatedCourseParent("D:\\Intro.osproj"), "D:\\", "the top of a drive keeps its separator");
});

test("a made translation file says what is in it, what to do next, and what it leaves out", () => {
  assert.deepEqual(exportSentences(exported(), false), [
    "Made Intro-fr-FR.xlf: 297 pieces of text, 1074 words, to translate from en-US into fr-FR.",
    "Give it to a translator who works with XLIFF 1.2 files. When it comes back, choose Bring in a translated file.",
    "The player's own words, such as Next and Listen, are in it too, at the end, so the translated course is in its language all the way through.",
  ]);
  const pseudo = exportSentences(exported({ units: 1, words: 1, captionFiles: ["assets/captions/clip.vtt", "assets/captions/b.vtt"] }), true);
  assert.equal(pseudo[0], "Made Intro-fr-FR.xlf: 1 piece of text, 1 word, to translate from en-US into fr-FR.");
  assert.match(pseudo[1]!, /pseudo-translation/);
  assert.equal(pseudo[2], "The captions in clip.vtt, b.vtt are not in it: they are separate files, translated on their own.");
});

test("a made translated course says what was put back and what was not", () => {
  assert.deepEqual(importSentences(imported()), [
    "Made the translated course Intro-fr-FR.osproj, in fr-FR. Your own course is unchanged.",
    "290 pieces of text were put back.",
    "The checker finds 0 errors and 0 warnings in the translated course.",
  ]);
  const messy = importSentences(imported({
    translated: 1, untranslated: 2, outOfDate: ["a"], rejected: [{ id: "slide-001|x", reason: "the tags were changed" }], unknown: ["u1", "u2"], narrationToVoice: 4,
    captionFiles: ["assets/captions/clip.vtt"], validator: { errors: 1, warnings: 3, newErrors: [] },
  }));
  assert.equal(messy[1], "1 piece of text was put back.");
  assert.equal(messy[2], "2 were left in the original language, because the file had no translation for them.");
  assert.equal(messy[3], "1 no longer matches the course, which has changed since the file was made, and was left as it was.");
  assert.equal(messy[4], "1 translation was refused because it changed tags or lost a placeholder. It is listed below.");
  assert.equal(messy[5], "2 pieces in the file are not in this course.");
  assert.equal(messy[6], "The checker finds 1 error and 3 warnings in the translated course.");
  assert.equal(messy[7], "4 narration scripts are now marked fr-FR. Open the translated course and choose a voice for that language before you publish it.");
  assert.equal(messy[8], "Caption files were not translated: clip.vtt.");
});

test("the problems listed under the summary are the refused translations and then any new errors, and are capped", () => {
  assert.deepEqual(importDetails(imported()), []);
  const some = imported({ rejected: [{ id: "s|a", reason: "r1" }, { id: "s|b", reason: "r2" }], validator: { errors: 1, warnings: 0, newErrors: ["slide-001 obj-0002: Needs alt text"] } });
  assert.deepEqual(importDetails(some), ["s|a: r1", "s|b: r2", "New error: slide-001 obj-0002: Needs alt text"]);
  const many = imported({ rejected: Array.from({ length: 50 }, (_, i) => ({ id: `u${i}`, reason: "r" })) });
  assert.equal(importDetails(many).length, 20);
  assert.equal(importDetails(many, 5).length, 5);
});
