// The theme editor: a dialog for changing the project's own copy of a theme. Its twelve colours, its two fonts and a logo. Like the
// other dialogs it is a native <dialog>, so focus moves in, Tab stays inside, and Escape closes it. Everything is a real labelled
// control, a colour can be typed as a hex code or chosen with the system colour picker, and how readable the colours are together is
// said in words (WCAG AA), not only drawn. Nothing is changed in the project until Save theme, and then in one undo step.

import { COLOR_ROLES } from "../../player/src/theme.ts";
import { LOGO_LIMITS } from "../../player/src/logo.ts";
import type { Theme, ThemeLogo } from "../../player/src/types.ts";
import { FONT_CHOICES } from "./content.ts";
import { contrastReport, contrastSummary, draftProblems, LOGO_CORNERS, normaliseHex, resizeLogo, setColor, setFont, startingFrom, themeId } from "./themeedit.ts";
import { themePreviewSvg } from "./themepicker.ts";
import { BUILT_IN_THEMES, COLOR_ROLE_NAMES, cloneTheme } from "./themes.ts";

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

export interface ThemeEditorOptions {
  /** The theme the project has now. */
  current: Theme;
  /** The size of the slide, in stage pixels, so a logo's size can be said as a share of it. */
  stage: { width: number; height: number };
  /** Ask for a logo picture: it is copied into the project, and its path and its own size come back. Null if the author cancelled. */
  chooseLogo(): Promise<{ src: string; width: number; height: number } | null>;
  /** An address the page can show a project picture from. */
  imageUrl(src: string): Promise<string>;
  /** Said to a screen reader, as the editor's other messages are. */
  announce(message: string): void;
}

const CURRENT = "__current";

/** Show the editor. Resolves to the edited theme to apply, or null if it was cancelled. */
export function editTheme(opts: ThemeEditorOptions): Promise<Theme | null> {
  return new Promise((resolve) => {
    let draft = cloneTheme(opts.current);
    let startedFrom = CURRENT;

    const dialog = h("dialog", { class: "dialog wide theme-editor", "aria-labelledby": "te-title" });
    const form = h("form", { method: "dialog" });
    const title = h("h2", { id: "te-title", text: "Edit this theme" });
    const intro = h("p", { class: "note", text: "This changes your project's own copy of the theme, so every slide changes at once. The built-in themes are never changed. Nothing is applied until you choose Save theme, and then you can undo it with Ctrl+Z." });

    // ---- name, and what to start from
    const nameInput = h("input", { id: "te-name", type: "text", value: draft.name });
    const startSelect = h("select", { id: "te-start" },
      h("option", { value: CURRENT, text: `Your current theme (${opts.current.name})` }),
      ...BUILT_IN_THEMES.map((t) => h("option", { value: t.id, text: `Start again from ${t.name}` })));
    const basics = h("fieldset", {}, h("legend", { text: "Name" }),
      h("div", { class: "field" }, h("label", { for: "te-name", text: "Theme name" }), nameInput),
      h("div", { class: "field" }, h("label", { for: "te-start", text: "Start from" }), startSelect),
      h("p", { class: "note", text: "Choosing a built-in theme here replaces the colours and fonts below with its own. Your logo stays." }));

    // ---- the preview, drawn from the draft
    const preview = h("div", { class: "te-preview" });
    const drawPreview = () => preview.replaceChildren(themePreviewSvg(document, draft));

    // ---- colours
    const status = h("p", { class: "te-status", role: "status", "aria-live": "polite" });
    const readability = h("ul", { class: "te-pairs" });
    const textInputs = new Map<string, HTMLInputElement>();
    const wells = new Map<string, HTMLInputElement>();
    const drawReadability = () => {
      readability.replaceChildren(...contrastReport(draft).map((p) =>
        h("li", { text: `${p.label}: ${p.ratio.toFixed(1)} to 1. ${p.ok ? "Easy to read." : "Hard to read."}` })));
    };
    const colourRows = COLOR_ROLES.map((role) => {
      const name = COLOR_ROLE_NAMES[role] ?? role;
      const text = h("input", { id: `te-c-${role}`, type: "text", value: draft.colors[role], size: "9", spellcheck: "false", autocomplete: "off", "aria-describedby": `te-c-${role}-msg` });
      const well = h("input", { type: "color", value: draft.colors[role], "aria-label": `${name}, colour picker` });
      const msg = h("span", { id: `te-c-${role}-msg`, class: "note te-msg" });
      textInputs.set(role, text);
      wells.set(role, well);
      const apply = (value: string, fromWell: boolean) => {
        const hex = normaliseHex(value);
        if (!hex) {
          text.setAttribute("aria-invalid", "true");
          msg.textContent = "Write six hex digits, like #1a1a1a.";
          return;
        }
        text.removeAttribute("aria-invalid");
        msg.textContent = "";
        draft = setColor(draft, role, hex);
        if (fromWell) text.value = hex; else well.value = hex;
        drawPreview();
        drawReadability();
      };
      text.addEventListener("input", () => apply(text.value, false));
      text.addEventListener("change", () => {
        const hex = normaliseHex(text.value);
        if (hex) text.value = hex;
        status.textContent = contrastSummary(draft);
      });
      well.addEventListener("input", () => apply(well.value, true));
      well.addEventListener("change", () => { status.textContent = contrastSummary(draft); });
      return h("div", { class: "te-colour" }, h("label", { for: `te-c-${role}`, text: name }), text, well, msg);
    });
    const colours = h("fieldset", {}, h("legend", { text: "Colours" }),
      h("p", { class: "note", text: "Type a hex code, or use the colour picker beside it. Slide backgrounds are made from these colours too, so they change with them." }),
      h("div", { class: "te-colours" }, ...colourRows));
    const readable = h("fieldset", {}, h("legend", { text: "Are the colours easy to read together?" }),
      h("p", { class: "note", text: "These are the pairs the course uses as text on a background. WCAG AA asks for 4.5 to 1 or more. You can still save a theme that does not meet it, and the Problems list will say so." }),
      readability, status);

    // ---- fonts
    const fontSelect = (which: "heading" | "body", label: string): HTMLElement => {
      const value = draft.fonts[which];
      const known = FONT_CHOICES.some((f) => f.value === value);
      const sel = h("select", { id: `te-f-${which}` },
        ...(known ? [] : [h("option", { value, text: `${value.split(",")[0]!.replace(/['"]/g, "")} (current)` })]),
        ...FONT_CHOICES.map((f) => h("option", { value: f.value, text: f.label })));
      sel.value = value;
      sel.addEventListener("change", () => { draft = setFont(draft, which, sel.value); drawPreview(); });
      return h("div", { class: "field" }, h("label", { for: `te-f-${which}`, text: label }), sel);
    };
    const fonts = h("fieldset", {}, h("legend", { text: "Fonts" }), fontSelect("heading", "Heading font"), fontSelect("body", "Text font"));

    // ---- the logo
    const logoBox = h("fieldset", {}, h("legend", { text: "Logo" }));
    const drawLogo = () => {
      const logo = draft.logo;
      const kids: Node[] = [h("p", { class: "note", text: "One picture in a corner of every slide, such as a school logo. It sits behind the slide's content, so keep that corner free." })];
      if (!logo) {
        kids.push(h("p", { text: "No logo." }));
        const choose = h("button", { type: "button", text: "Choose a logo picture..." });
        choose.addEventListener("click", () => void pick());
        kids.push(choose);
      } else {
        const img = h("img", { class: "te-logo-preview", alt: "", "aria-hidden": "true" });
        void opts.imageUrl(logo.src).then((u) => { img.src = u; }).catch(() => { img.remove(); });
        const alt = h("input", { id: "te-logo-alt", type: "text", value: logo.alt, disabled: logo.decorative });
        const deco = h("input", { id: "te-logo-deco", type: "checkbox", ...(logo.decorative ? { checked: true } : {}) });
        const corner = h("select", { id: "te-logo-corner" }, ...LOGO_CORNERS.map((c) => h("option", { value: c.value, text: c.label })));
        corner.value = logo.corner;
        const width = h("input", { id: "te-logo-width", type: "number", min: String(LOGO_LIMITS.minSize), max: String(LOGO_LIMITS.maxWidth), step: "1", value: String(logo.width) });
        const sizeText = (l: ThemeLogo) => `Its height follows its shape: ${l.height} pixels. The slide is ${opts.stage.width} wide, so ${l.width} pixels is about ${Math.round((l.width / opts.stage.width) * 100)} percent of it.`;
        const size = h("span", { id: "te-logo-size", class: "note", text: sizeText(logo) });
        alt.addEventListener("input", () => { if (draft.logo) draft.logo = { ...draft.logo, alt: alt.value }; });
        deco.addEventListener("change", () => {
          if (!draft.logo) return;
          // A decorative logo has no alt text, so the field is cleared and switched off, and comes back empty if the box is unticked again.
          draft.logo = { ...draft.logo, decorative: deco.checked, alt: deco.checked ? "" : draft.logo.alt };
          alt.disabled = deco.checked;
          if (deco.checked) alt.value = "";
          opts.announce(deco.checked ? "The logo is decorative: hidden from screen readers, with no alt text." : "The logo has alt text again. Write what it is.");
        });
        corner.addEventListener("change", () => { if (draft.logo) draft.logo = { ...draft.logo, corner: corner.value as ThemeLogo["corner"] }; });
        width.addEventListener("change", () => {
          if (!draft.logo) return;
          const n = Number(width.value);
          if (!Number.isFinite(n)) { width.value = String(draft.logo.width); return; }
          draft.logo = resizeLogo(draft.logo, n);
          width.value = String(draft.logo.width);
          size.textContent = sizeText(draft.logo);
        });
        const change = h("button", { type: "button", text: "Choose a different picture..." });
        change.addEventListener("click", () => void pick());
        const remove = h("button", { type: "button", text: "Remove logo" });
        remove.addEventListener("click", () => {
          delete draft.logo;
          drawLogo();
          opts.announce("Logo removed from the draft.");
          (logoBox.querySelector("button") as HTMLElement | null)?.focus();
        });
        kids.push(
          h("div", { class: "te-logo" }, img, h("p", { class: "note", text: `Picture: ${logo.src.split("/").pop() ?? logo.src}` })),
          h("div", { class: "field" }, h("label", { for: "te-logo-alt", text: "Alt text" }), alt),
          h("div", { class: "field check" }, deco, h("label", { for: "te-logo-deco", text: "This logo is decorative (a screen reader skips it)" })),
          h("p", { class: "note", text: "A screen reader user hears the logo on every slide, so say what it is, for example \"School logo\", or mark it decorative." }),
          h("div", { class: "field" }, h("label", { for: "te-logo-corner", text: "Corner" }), corner),
          h("div", { class: "field" }, h("label", { for: "te-logo-width", text: "Width in pixels" }), width),
          size,
          h("div", { class: "dialog-actions" }, change, remove),
        );
      }
      logoBox.replaceChildren(h("legend", { text: "Logo" }), ...kids);
    };
    const pick = async (): Promise<void> => {
      try {
        const picked = await opts.chooseLogo();
        if (!picked) return;
        const keep = draft.logo;
        const fresh: ThemeLogo = { src: picked.src, alt: "", decorative: false, corner: keep?.corner ?? "top-right", width: picked.width, height: picked.height };
        draft.logo = fresh;
        drawLogo();
        opts.announce("Logo added to the draft. Write its alt text, or mark it decorative.");
        document.getElementById("te-logo-alt")?.focus();
      } catch (err) {
        opts.announce(`Could not use that picture. ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    // ---- changing what to start from
    startSelect.addEventListener("change", () => {
      if (startSelect.value === startedFrom) return;
      startedFrom = startSelect.value;
      const base = startSelect.value === CURRENT ? opts.current : BUILT_IN_THEMES.find((t) => t.id === startSelect.value)!;
      // The colours and fonts come from the theme chosen. The logo is the dialog's own, so it is not lost.
      const logoNow = draft.logo;
      draft = startingFrom(base, opts.current);
      if (logoNow) draft.logo = logoNow;
      else delete draft.logo;
      nameInput.value = draft.name;
      for (const role of COLOR_ROLES) {
        textInputs.get(role)!.value = draft.colors[role];
        wells.get(role)!.value = draft.colors[role];
        textInputs.get(role)!.removeAttribute("aria-invalid");
        document.getElementById(`te-c-${role}-msg`)!.textContent = "";
      }
      (document.getElementById("te-f-heading") as HTMLSelectElement).value = draft.fonts.heading;
      (document.getElementById("te-f-body") as HTMLSelectElement).value = draft.fonts.body;
      drawPreview();
      drawReadability();
      status.textContent = contrastSummary(draft);
      opts.announce(`Colours and fonts reset to ${base.name}.`);
    });
    nameInput.addEventListener("input", () => { draft.name = nameInput.value; });

    // ---- finishing
    const problems = h("div", { class: "te-problems", role: "alert" });
    const save = h("button", { type: "submit", text: "Save theme" });
    const cancel = h("button", { type: "button", text: "Cancel" });
    const actions = h("div", { class: "dialog-actions" }, save, cancel);
    form.append(title, intro, basics, preview, colours, readable, fonts, logoBox, problems, actions);
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    drawPreview();
    drawReadability();
    drawLogo();
    status.textContent = contrastSummary(draft);

    let result: Theme | null = null;
    const finish = () => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    cancel.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      draft.name = nameInput.value.trim();
      const found = draftProblems(draft);
      if (found.length > 0) {
        problems.replaceChildren(h("p", { text: "This theme cannot be saved yet:" }), h("ul", {}, ...found.map((p) => h("li", { text: p }))));
        return;
      }
      problems.replaceChildren();
      const next = cloneTheme(draft);
      // The id follows the name, except when the name is the one the project already has: then it is the same theme, edited.
      next.id = next.name === opts.current.name ? opts.current.id : themeId(next.name);
      result = next;
      finish();
    });

    dialog.showModal();
    nameInput.focus();
    nameInput.select();
  });
}
