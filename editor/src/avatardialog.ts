// The avatar maker: a dialog for drawing a simple picture of a person from a few choices, with a preview. Like the other dialogs it is a native
// <dialog>, so focus moves in, Tab stays inside and Escape closes it. Every choice is a real labelled control, and the picture is described in
// words as it changes, so someone who cannot see the preview still knows what they are making. Nothing is saved until Use this picture.

import {
  avatarSvg, BACKGROUND, cleanSpec, DEFAULT_AVATAR, describeAvatar, EXPRESSION, HAIR_COLOUR, HAIR_STYLE, randomSpec, SHIRT_COLOUR, SHIRT_STYLE, SKIN,
  type AvatarSpec, type Choice,
} from "./avatar.ts";

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

export interface AvatarResult {
  spec: AvatarSpec;
  /** The picture, as the text of an SVG file. */
  svg: string;
  /** The picture in words, to offer as a start for alt text. */
  description: string;
}

export interface AvatarDialogOptions {
  /** Whose picture it is, for the heading. */
  name: string;
  /** What to start from: the person's last picture, if it was made here. */
  start?: AvatarSpec;
  announce(message: string): void;
}

/** Show the maker. Resolves to the picture to save, or null if it was cancelled. */
export function makeAvatar(opts: AvatarDialogOptions): Promise<AvatarResult | null> {
  return new Promise((resolve) => {
    let spec = cleanSpec(opts.start ?? DEFAULT_AVATAR);

    const dialog = h("dialog", { class: "dialog wide avatar-dialog", "aria-labelledby": "av-title" });
    const form = h("form", { method: "dialog" });
    const title = h("h2", { id: "av-title", text: opts.name.trim() ? `Make a picture of ${opts.name.trim()}` : "Make a picture of a person" });
    const intro = h("p", { class: "note", text: "Choose how the person looks. The picture is drawn for this course, so it needs no credit. You will write its alt text next; the words below are only a start." });
    const preview = h("div", { class: "av-preview", "aria-hidden": "true" });
    const words = h("p", { class: "av-words", role: "status", "aria-live": "polite" });

    const fields: HTMLElement[] = [];
    const selects = new Map<keyof AvatarSpec, HTMLSelectElement>();
    const select = (key: Exclude<keyof AvatarSpec, "glasses">, label: string, list: Choice[]): HTMLElement => {
      const sel = h("select", { id: `av-${key}` }, ...list.map((c) => h("option", { value: c.id, text: c.label })));
      sel.value = spec[key];
      sel.addEventListener("change", () => { spec = { ...spec, [key]: sel.value }; draw(); });
      selects.set(key, sel);
      return h("div", { class: "field" }, h("label", { for: `av-${key}`, text: label }), sel);
    };
    fields.push(
      select("skin", "Skin tone", SKIN),
      select("hairStyle", "Hair", HAIR_STYLE),
      select("hairColour", "Hair colour", HAIR_COLOUR),
      select("expression", "Expression", EXPRESSION),
      select("shirtStyle", "Shirt", SHIRT_STYLE),
      select("shirtColour", "Shirt colour", SHIRT_COLOUR),
      select("background", "Background", BACKGROUND),
    );
    const glasses = h("input", { id: "av-glasses", type: "checkbox" });
    glasses.addEventListener("change", () => { spec = { ...spec, glasses: glasses.checked }; draw(); });
    fields.push(h("div", { class: "field check" }, glasses, h("label", { for: "av-glasses", text: "Glasses" })));

    const draw = () => {
      preview.innerHTML = avatarSvg(spec);
      glasses.checked = spec.glasses;
      for (const [key, sel] of selects) sel.value = String(spec[key]);
      words.textContent = `Preview: ${describeAvatar(spec)}.`;
    };

    const surprise = h("button", { type: "button", text: "Surprise me" });
    surprise.addEventListener("click", () => { spec = randomSpec(); draw(); });
    const use = h("button", { type: "submit", text: "Use this picture" });
    const cancel = h("button", { type: "button", text: "Cancel" });

    form.append(title, intro, h("div", { class: "av-layout" }, h("div", { class: "av-controls" }, ...fields, h("div", { class: "btn-row" }, surprise)), h("div", { class: "av-side" }, preview, words)), h("div", { class: "dialog-actions" }, use, cancel));
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    draw();

    let result: AvatarResult | null = null;
    const finish = () => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    cancel.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      result = { spec, svg: avatarSvg(spec), description: describeAvatar(spec) };
      finish();
    });
    dialog.showModal();
    selects.get("skin")?.focus();
  });
}
