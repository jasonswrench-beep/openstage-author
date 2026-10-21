// The About window: what version this is and where things are on this computer, to read, to copy into a message when asking for help, and with buttons to show the guides and the data folder.
// A native <dialog>, so focus moves in, Tab stays inside, Escape closes it and focus returns to where it came from.

import { aboutLines, aboutText, parseAbout, type AboutInfo } from "./about.ts";
import { errorText, type Backend } from "./backend.ts";

type Attrs = Record<string, string | boolean | number>;
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

export interface AboutDialogOptions {
  backend: Backend;
  announce: (message: string) => void;
}

export function openAbout(opts: AboutDialogOptions): Promise<void> {
  const { backend: b } = opts;
  return new Promise((resolve) => {
    let info: AboutInfo = parseAbout("{}");
    const dialog = h("dialog", { class: "dialog wide about-dialog", "aria-labelledby": "ab-title" });
    const facts = h("dl", { class: "about-facts" });
    const copyable = h("textarea", { id: "ab-text", class: "about-text", readonly: true, rows: 13, "aria-label": "The same facts as text, to copy" });
    const status = h("p", { class: "as-status", role: "status" });
    const failure = h("p", { class: "dialog-error", role: "alert" });
    const copy = h("button", { type: "button", id: "ab-copy", text: "Copy these details" });
    const guides = h("button", { type: "button", id: "ab-guides", text: "Show the guides" });
    const data = h("button", { type: "button", id: "ab-data", text: "Show the data folder" });
    const close = h("button", { type: "button", id: "ab-close", text: "Close" });

    const render = () => {
      facts.replaceChildren(...aboutLines(info).flatMap((l) => [h("dt", { text: l.label }), h("dd", { text: l.value })]));
      copyable.value = aboutText(info);
      guides.hidden = info.guidesFile === "";
    };

    copy.addEventListener("click", async () => {
      failure.textContent = "";
      // The clipboard may refuse, or never answer (it can wait for a permission that is not coming), so it is given a moment and no more.
      const copied = await Promise.race([
        navigator.clipboard ? navigator.clipboard.writeText(aboutText(info)).then(() => true, () => false) : Promise.resolve(false),
        new Promise<boolean>((done) => window.setTimeout(() => done(false), 1500)),
      ]);
      if (copied) {
        status.textContent = "The details are copied. Paste them into your message.";
      } else {
        // No clipboard from here: the text is in the box below, selected, for Ctrl+C.
        copyable.focus();
        copyable.select();
        status.textContent = "The details are selected in the box. Press Control C to copy them.";
      }
    });
    const reveal = async (path: string, what: string) => {
      failure.textContent = "";
      try {
        await b.revealInFolder(path);
        status.textContent = `Showing ${what}.`;
      } catch (err) {
        failure.textContent = errorText(err);
      }
    };
    guides.addEventListener("click", () => void reveal(info.guidesFile, "the guides"));
    data.addEventListener("click", () => void reveal(info.data, "the data folder"));
    const finish = () => {
      dialog.close();
      dialog.remove();
      opts.announce("About closed.");
      resolve();
    };
    close.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish();
    });

    dialog.append(
      h("h2", { id: "ab-title", text: "About OpenStage Author" }),
      h("p", { class: "note", text: "A free, open-source tool for making accessible eLearning courses. These are the facts someone helping you will ask for. They hold no key and nothing from your courses." }),
      facts,
      h("div", { class: "field" }, h("label", { for: "ab-text", text: "The same, as text" }), copyable),
      status,
      failure,
      h("div", { class: "dialog-actions" }, copy, guides, data, close),
    );
    document.body.appendChild(dialog);
    render();
    dialog.showModal();
    copy.focus();
    void b
      .aboutInfo()
      .then((found) => {
        info = found;
        render();
      })
      .catch((err) => {
        failure.textContent = errorText(err);
      });
  });
}
