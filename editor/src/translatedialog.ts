// The Translate dialog: makes a file a translator can work on (XLIFF 1.2), and brings the translated file back as a new copy of the
// course. The course itself is never changed. It saves the project first, because the translation is made from what is on disk and a
// translated file is checked against it. A native <dialog>, so focus moves in, Tab stays inside, Escape closes it and focus returns
// to where it came from.

import { errorText, type Backend } from "./backend.ts";
import {
  COMMON_LANGUAGES, exportSentences, importDetails, importSentences, isLanguageTag, translatedCourseParent, translationFileName,
} from "./translation.ts";

type Attrs = Record<string, string | boolean>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    if (k === "class") e.className = String(v);
    else if (k === "text") e.textContent = String(v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  e.append(...kids);
  return e;
}

export interface TranslateOptions {
  backend: Backend;
  /** The project folder. */
  dir: string;
  /** Writes what has changed. Resolves false if it could not, after telling the author why. */
  save: () => Promise<boolean>;
  announce: (message: string) => void;
}

export function openTranslate(opts: TranslateOptions): Promise<void> {
  const b = opts.backend;
  return new Promise((resolve) => {
    let running = false;
    /** A file or folder just made, for "Show it in its folder". */
    let made: string | null = null;

    const dialog = h("dialog", { class: "dialog wide translate-dialog", "aria-labelledby": "tr-title" });
    const language = h("input", { id: "tr-language", type: "text", list: "tr-languages", autocomplete: "off", spellcheck: "false", "aria-describedby": "tr-language-help" });
    const suggestions = h("datalist", { id: "tr-languages" }, ...COMMON_LANGUAGES.map((l) => h("option", { value: l.tag, text: l.name })));
    const pseudo = h("input", { id: "tr-pseudo", type: "checkbox" });
    const makeBtn = h("button", { type: "button", text: "Make the translation file..." });
    const bringBtn = h("button", { type: "button", text: "Bring in a translated file..." });
    const status = h("p", { class: "as-status", role: "status" });
    const failure = h("p", { class: "dialog-error", role: "alert" });
    const details = h("ul", { class: "pb-problems", "aria-label": "Translations that could not be put back" });
    const reveal = h("button", { type: "button", text: "Show it in its folder" });
    const after = h("div", { class: "dialog-actions pb-after", hidden: true }, reveal);
    const closeBtn = h("button", { type: "button", text: "Close" });

    const say = (text: string) => { status.textContent = text; };
    const fail = (text: string) => { failure.textContent = text; };

    /** Buttons that cannot be used while the work is running say so, and keep focus where it is. */
    const refresh = () => {
      for (const b2 of [makeBtn, bringBtn]) {
        if (running) b2.setAttribute("aria-disabled", "true");
        else b2.removeAttribute("aria-disabled");
      }
    };

    const clearResults = () => {
      failure.textContent = "";
      details.replaceChildren();
      after.hidden = true;
      made = null;
    };

    /** The work both buttons share: save, ask for a file, do it, say what happened. */
    const work = async (job: () => Promise<void>) => {
      if (running) return;
      clearResults();
      running = true;
      refresh();
      try {
        say("Saving your project first.");
        if (!(await opts.save())) {
          say("");
          fail("Your project could not be saved, so nothing was done.");
          return;
        }
        await job();
      } catch (err) {
        say("");
        fail(errorText(err));
      } finally {
        running = false;
        refresh();
      }
    };

    const makeFile = () => {
      const tag = language.value.trim();
      if (!isLanguageTag(tag)) {
        clearResults();
        fail("Type the language to translate into as a language tag, such as fr-FR for French or es-MX for Mexican Spanish.");
        language.focus();
        return Promise.resolve();
      }
      return work(async () => {
        const dest = await b.pickTranslationSave(translationFileName(opts.dir, tag));
        if (!dest) {
          say("Cancelled. No translation file was made.");
          return;
        }
        say("Making the translation file.");
        const r = await b.translationExport(opts.dir, tag, dest, pseudo.checked);
        say("");
        if (!r.ok) {
          fail(r.message);
          return;
        }
        say(exportSentences(r, pseudo.checked).join(" "));
        made = r.path;
        after.hidden = false;
      });
    };

    const bringIn = () => work(async () => {
      const source = await b.pickTranslationFile();
      if (!source) {
        say("Cancelled. Nothing was changed.");
        return;
      }
      say("Making the translated course.");
      const r = await b.translationImport(opts.dir, source, translatedCourseParent(opts.dir));
      say("");
      if (!r.ok) {
        fail(r.message);
        return;
      }
      say(importSentences(r).join(" "));
      details.replaceChildren(...importDetails(r).map((line) => h("li", { text: line })));
      made = r.out;
      after.hidden = false;
    });

    const leave = () => {
      if (running) return; // the work is short and cannot be cancelled; the dialog stays until it is done
      dialog.close();
      dialog.remove();
      opts.announce("Translate closed.");
      resolve();
    };

    makeBtn.addEventListener("click", () => { if (makeBtn.getAttribute("aria-disabled") !== "true") void makeFile(); });
    bringBtn.addEventListener("click", () => { if (bringBtn.getAttribute("aria-disabled") !== "true") void bringIn(); });
    closeBtn.addEventListener("click", leave);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); leave(); });
    reveal.addEventListener("click", () => {
      if (made) void b.revealInFolder(made).catch((err) => fail(errorText(err)));
    });

    dialog.append(
      h("h2", { id: "tr-title", text: "Translate" }),
      h("p", { class: "note", text: "Translating happens in a tool that reads XLIFF files, such as OmegaT or Weblate. Make the file here, give it to the translator, and bring the translated file back. Your own course is never changed: the translation is made as a new course beside it." }),
      h("div", { class: "field" }, h("label", { for: "tr-language", text: "Translate into this language" }), language, suggestions),
      h("p", { id: "tr-language-help", class: "note", text: "A language tag, such as fr-FR for French or es-MX for Mexican Spanish. Choose one from the list or type your own." }),
      h("div", { class: "field check" }, pseudo, h("label", { for: "tr-pseudo", text: "Make a pseudo-translation to try the course with" })),
      h("p", { class: "note", text: "A pseudo-translation has every word already accented and made longer, with nothing to translate. Bring it back to see where text does not fit and what never reached the file." }),
      h("div", { class: "btn-row" }, makeBtn, bringBtn),
      h("p", { class: "note", text: "The words of caption files are not in the file: they are separate files, translated on their own." }),
      status, failure, details, after,
      h("div", { class: "dialog-actions" }, closeBtn),
    );
    document.body.appendChild(dialog);
    dialog.showModal();
    language.focus();
  });
}
