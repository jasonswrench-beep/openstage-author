// File > Publishing style... (and a button in the Publish window): the house rules for what Publish makes, set once for every project.
// The names of the published files are a pattern of parts in braces, with buttons that put a part in at the cursor and a line that shows
// the name the open course would get; the Word review document's slide headings and font are chosen from lists; the hosts a course may report to
// (xAPI and cmi5) are typed in a box, one or more to a line, and a host that is not one is named in the dialog. A native <dialog>, so
// focus moves in, Tab stays inside, Escape closes it and focus goes back. A pattern that cannot be used is said in the dialog, which
// stays open. The style is kept in the editor's settings file (stock.ts); the rules are in publishstyle.ts.

import { errorText, type Backend } from "./backend.ts";
import { checkPattern, DEFAULT_STYLE, FONTS, HEADING_STYLES, isDefaultStyle, NAME_PARTS, publishName, type NameValues, type PublishStyle } from "./publishstyle.ts";
import { parseSettings, serializeSettings } from "./stock.ts";
import { parseHosts } from "../../player/src/lrshosts.ts";

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

/** The style the author has set, or the usual one. */
export async function readPublishStyle(b: Backend): Promise<PublishStyle> {
  try {
    return parseSettings(await b.readSettings()).publishStyle ?? DEFAULT_STYLE;
  } catch {
    return DEFAULT_STYLE;
  }
}

export interface PublishStyleOptions {
  backend: Backend;
  /** The open course's title, code, version and folder, to show the name it would get; null with no course open. */
  values: NameValues | null;
  announce: (message: string) => void;
}

/** Resolves to the style kept, or null if the window was closed without saving. */
export function openPublishStyle(opts: PublishStyleOptions): Promise<PublishStyle | null> {
  const b = opts.backend;
  return new Promise((resolve) => {
    void readPublishStyle(b).then((style) => {
      const dialog = h("dialog", { class: "dialog wide publish-style-dialog", "aria-labelledby": "ps-title", "aria-describedby": "ps-intro" });
      const nameBox = h("input", { id: "ps-name", type: "text", autocomplete: "off", spellcheck: "false", "aria-describedby": "ps-parts-note ps-preview" });
      nameBox.value = style.fileName;
      const preview = h("p", { id: "ps-preview", class: "ps-preview" });
      const nameError = h("p", { class: "error-text", role: "alert" });
      const headings = h("select", { id: "ps-headings" }, ...HEADING_STYLES.map((s) => h("option", { value: s.value, text: `${s.example} (${s.label.toLowerCase()})` })));
      headings.value = style.headings;
      const font = h("select", { id: "ps-font" }, ...FONTS.map((f) => h("option", { value: f, text: f })));
      font.value = style.font;
      const hostsBox = h("textarea", { id: "ps-hosts", rows: "3", autocomplete: "off", spellcheck: "false", "aria-describedby": "ps-hosts-note ps-hosts-error" });
      hostsBox.value = style.lrsHosts.join("\n");
      const hostsError = h("p", { id: "ps-hosts-error", class: "error-text", role: "alert" });
      /** The hosts in the box, or null when one is not a host (which is then said, and the box marked). */
      const readHosts = (): string[] | null => {
        const { hosts, problems } = parseHosts(hostsBox.value);
        hostsError.textContent = problems.join(" ");
        hostsBox.setAttribute("aria-invalid", String(problems.length > 0));
        return problems.length > 0 ? null : hosts;
      };
      hostsBox.addEventListener("change", () => void readHosts());
      const save = h("button", { type: "button", class: "primary", text: "Save style" });
      const usual = h("button", { type: "button", text: "Back to the usual" });
      const cancel = h("button", { type: "button", text: "Cancel" });
      const failure = h("p", { class: "error-text", role: "alert" });

      const showPreview = () => {
        const problem = checkPattern(nameBox.value);
        nameError.textContent = problem ?? "";
        nameBox.setAttribute("aria-invalid", String(problem !== null));
        if (problem !== null) {
          preview.textContent = "";
          return;
        }
        if (!opts.values) {
          preview.textContent = "Open a course to see the name it would get.";
          return;
        }
        const name = nameBox.value.trim() === DEFAULT_STYLE.fileName ? opts.values.folder.replace(/\.osproj$/i, "") : publishName(nameBox.value, opts.values);
        preview.textContent = `This course would be published as ${name}, with ${name}-scorm12.zip and the other packages beside it.`;
      };
      // A button for each part puts it in where the cursor is, so nobody has to type the braces.
      const partButtons = NAME_PARTS.map((part) => {
        const btn = h("button", { type: "button", class: "small", text: part.token, "aria-label": `Put in ${part.token}, ${part.says}` });
        btn.addEventListener("click", () => {
          const at = nameBox.selectionStart ?? nameBox.value.length;
          const end = nameBox.selectionEnd ?? at;
          nameBox.value = nameBox.value.slice(0, at) + part.token + nameBox.value.slice(end);
          nameBox.focus();
          nameBox.setSelectionRange(at + part.token.length, at + part.token.length);
          showPreview();
        });
        return btn;
      });
      nameBox.addEventListener("input", showPreview);

      const close = (kept: PublishStyle | null) => {
        dialog.close();
        dialog.remove();
        resolve(kept);
      };
      save.addEventListener("click", async () => {
        const problem = checkPattern(nameBox.value);
        if (problem !== null) {
          nameError.textContent = problem;
          nameBox.focus();
          return;
        }
        const lrsHosts = readHosts();
        if (lrsHosts === null) {
          hostsBox.focus();
          return;
        }
        const next: PublishStyle = { fileName: nameBox.value.trim(), headings: headings.value as PublishStyle["headings"], font: font.value, lrsHosts };
        try {
          const settings = parseSettings(await b.readSettings());
          if (isDefaultStyle(next)) delete settings.publishStyle;
          else settings.publishStyle = next;
          await b.writeSettings(serializeSettings(settings));
        } catch (err) {
          failure.textContent = `The style could not be saved. ${errorText(err)}`;
          return;
        }
        opts.announce(isDefaultStyle(next) ? "Publishing is back to the usual style." : "Saved your publishing style. Every course you publish on this computer uses it.");
        close(next);
      });
      usual.addEventListener("click", () => {
        nameBox.value = DEFAULT_STYLE.fileName;
        headings.value = DEFAULT_STYLE.headings;
        font.value = DEFAULT_STYLE.font;
        hostsBox.value = "";
        void readHosts();
        showPreview();
        opts.announce("The usual style is filled in. Press Save style to keep it.");
      });
      cancel.addEventListener("click", () => close(null));
      dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(null); });

      dialog.append(
        h("h2", { id: "ps-title", text: "Publishing style" }),
        h("p", { id: "ps-intro", class: "note", text: "Your house rules for what Publish makes, so it fits your institution's standards. They are kept on this computer and used for every course you publish here. Each course's own code and version are in Properties when no object is selected, under Course details." }),
        h("fieldset", {}, h("legend", { text: "Names of the published files" }),
          h("div", { class: "field" }, h("label", { for: "ps-name", text: "Name pattern" }), nameBox),
          h("div", { class: "btn-row", role: "group", "aria-label": "Parts to put in the name" }, ...partButtons),
          h("p", { id: "ps-parts-note", class: "note", text: `The parts are ${NAME_PARTS.map((p) => `${p.token}, ${p.says}`).join("; ")}. For example {code}_{title}_v{version}. Spaces and marks other than dots, hyphens and underscores become hyphens, and a part the course does not have is left out.` }),
          nameError,
          preview),
        h("fieldset", {}, h("legend", { text: "The Word review document" }),
          h("div", { class: "field" }, h("label", { for: "ps-headings", text: "Each slide is headed" }), headings),
          h("p", { class: "note", text: "A course with sections has a heading for each section too, numbered the same way." }),
          h("div", { class: "field" }, h("label", { for: "ps-font", text: "Font" }), font)),
        h("fieldset", {}, h("legend", { text: "Reporting to a learning record store (xAPI and cmi5)" }),
          h("div", { class: "field" }, h("label", { for: "ps-hosts", text: "Hosts a course may report to" }), hostsBox),
          h("p", { id: "ps-hosts-note", class: "note", text: "Leave this empty and a course reports to whatever learning record store it is launched with, as it always has. Write the hosts your learning systems use, such as lrs.example.org, or *.example.org for any host under it, separated by commas or one to a line, and a course launched with any other host runs without reporting anything. For cmi5, list the host the token comes from too. SCORM packages are not affected." }),
          hostsError),
        failure,
        h("div", { class: "dialog-actions" }, save, usual, cancel),
      );
      document.body.appendChild(dialog);
      dialog.showModal();
      showPreview();
      nameBox.focus();
    });
  });
}
