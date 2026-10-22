// The Edit text dialog: write and format the words of a text object. A native <dialog>, like the others, with an editing box (a contenteditable
// region the browser provides), a toolbar of what can be done to words (bold, italic, underline, link, lists, how deep a list item is, and the
// kind of paragraph), and, for anyone who would rather write HTML, a box for that. What comes out goes through `cleanHtml` (richtext.ts), so what is
// kept is always the plain kind of HTML the player shows. Everything has a route that needs no pointer: the toolbar is one tab stop that the arrow
// keys move along, the keys people know (Ctrl+B, Ctrl+I, Ctrl+U) work in the box, Ctrl+K makes a link, and Escape asks before throwing work away.

import { cleanHtml } from "./richtext.ts";

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

export interface TextEditorOptions {
  /** The name of the object being edited, for the heading. */
  name: string;
  /** The text as it is now. */
  html: string;
  announce(message: string): void;
}

const STYLES: { value: string; label: string }[] = [
  { value: "p", label: "Paragraph" }, { value: "h1", label: "Heading 1" }, { value: "h2", label: "Heading 2" }, { value: "h3", label: "Heading 3" },
  { value: "h4", label: "Heading 4" }, { value: "h5", label: "Heading 5" }, { value: "h6", label: "Heading 6" },
];

/** A web address an author typed, made usable: a mail or web address as it is, a bare address given https, anything else refused (null). */
export function linkAddress(typed: string): string | null {
  const t = typed.trim();
  if (/^(https?:|mailto:)\S+$/i.test(t)) return t;
  if (/^[^\s@/]+\.[^\s@/]{2,}(\/\S*)?$/.test(t)) return `https://${t}`;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t)) return `mailto:${t}`;
  return null;
}

/** Open the dialog. Resolves to the new HTML when the author chooses Done, or null when they cancel. */
export function openTextEditor(opts: TextEditorOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "dialog wide text-dialog", "aria-labelledby": "te-title" });
    const status = h("p", { class: "as-status", role: "status" });
    const error = h("p", { class: "dialog-error", role: "alert" });
    const say = (text: string) => { status.textContent = text; };

    const box = h("div", { id: "te-box", class: "te-box", contenteditable: "true", tabindex: "0", role: "textbox", "aria-multiline": "true", "aria-labelledby": "te-box-label", spellcheck: "true" });
    const original = cleanHtml(opts.html);
    box.innerHTML = original;
    const current = () => cleanHtml(box.innerHTML);
    const dirty = () => current() !== original;

    // ---- the toolbar
    interface Tool { id: string; label: string; command: string; state?: boolean; listOnly?: boolean; run?: () => void }
    const tools: Tool[] = [
      { id: "bold", label: "Bold", command: "bold", state: true },
      { id: "italic", label: "Italic", command: "italic", state: true },
      { id: "underline", label: "Underline", command: "underline", state: true },
      { id: "link", label: "Link...", command: "" },
      { id: "unlink", label: "Remove link", command: "unlink" },
      { id: "ul", label: "Bulleted list", command: "insertUnorderedList", state: true },
      { id: "ol", label: "Numbered list", command: "insertOrderedList", state: true },
      { id: "indent", label: "Deeper level", command: "indent", listOnly: true },
      { id: "outdent", label: "Shallower level", command: "outdent", listOnly: true },
    ];
    const toolbar = h("div", { class: "te-toolbar", role: "toolbar", "aria-label": "Formatting" });
    const buttons = new Map<string, HTMLButtonElement>();
    for (const t of tools) {
      const b = h("button", { type: "button", id: `te-${t.id}`, text: t.label, tabindex: "-1", ...(t.state ? { "aria-pressed": "false" } : {}) });
      buttons.set(t.id, b);
      toolbar.appendChild(b);
    }
    buttons.get("bold")!.tabIndex = 0;

    const style = h("select", { id: "te-style" }, ...STYLES.map((s) => h("option", { value: s.value, text: s.label })));
    const addressRow = h("div", { class: "te-link", hidden: true },
      h("label", { for: "te-address", text: "Web or mail address" }),
      h("input", { type: "text", id: "te-address", autocomplete: "off", placeholder: "https://example.org" }),
      h("button", { type: "button", id: "te-link-add", text: "Add link" }),
      h("button", { type: "button", id: "te-link-cancel", text: "Cancel" }));
    const address = addressRow.querySelector<HTMLInputElement>("#te-address")!;
    let saved: Range | null = null;

    const inBox = (n: Node | null) => !!n && box.contains(n);
    const keepSelection = () => {
      const sel = document.getSelection();
      if (sel && sel.rangeCount > 0 && inBox(sel.anchorNode)) saved = sel.getRangeAt(0).cloneRange();
    };
    /** Put the author's selection back. `focus` also gives the box the keyboard; a toolbar button used from the keyboard keeps it instead. */
    const restoreSelection = (focus = true) => {
      if (focus) box.focus();
      const sel = document.getSelection();
      if (saved && sel) { sel.removeAllRanges(); sel.addRange(saved); }
    };

    const safeState = (command: string): boolean => { try { return document.queryCommandState(command); } catch { return false; } };
    const inList = () => { try { return document.queryCommandState("insertUnorderedList") || document.queryCommandState("insertOrderedList"); } catch { return false; } };
    /** Show what the words at the cursor are: bold or not, in a list or not, which kind of paragraph. */
    const showState = () => {
      const sel = document.getSelection();
      if (!sel || !inBox(sel.anchorNode)) return;
      for (const t of tools) {
        const b = buttons.get(t.id)!;
        if (t.state) {
          let on = false;
          try { on = document.queryCommandState(t.command); } catch { on = false; }
          b.setAttribute("aria-pressed", String(on));
        }
        if (t.listOnly) {
          if (inList()) b.removeAttribute("aria-disabled"); else b.setAttribute("aria-disabled", "true");
        }
      }
      // The kind of the paragraph the cursor is in: the block of the box that holds it.
      let node: Node | null = sel.anchorNode;
      while (node && node.parentNode !== box) node = node.parentNode;
      const block = node?.nodeName.toLowerCase() ?? "p";
      style.value = STYLES.some((s) => s.value === block) ? block : "p";
    };

    const run = (t: Tool) => {
      error.textContent = "";
      if (t.id === "link") { openLink(); return; }
      if (t.listOnly && !inList()) { say("This works on an item of a list. Make a list first."); return; }
      // Used from the keyboard, the button keeps the keyboard, so a screen reader says the button's new state (pressed or not) where the author is. A browser that will
      // not edit while the box has no focus is given it for the command.
      const button = buttons.get(t.id)!;
      const fromKeyboard = document.activeElement === button;
      const stateBefore = t.state ? safeState(t.command) : false;
      const htmlBefore = box.innerHTML;
      restoreSelection(!fromKeyboard);
      document.execCommand(t.command);
      if (fromKeyboard && (t.state ? safeState(t.command) === stateBefore : box.innerHTML === htmlBefore)) {
        restoreSelection(true);
        document.execCommand(t.command);
      }
      if (fromKeyboard) button.focus(); else box.focus();
      showState();
      if (t.state) say(`${t.label} ${button.getAttribute("aria-pressed") === "true" ? "on" : "off"}.`);
      else if (t.id === "unlink") say("Link removed.");
      else if (t.listOnly) say(t.id === "indent" ? "Deeper level." : "Shallower level.");
    };
    for (const t of tools) buttons.get(t.id)!.addEventListener("click", () => run(t));
    // The buttons keep the box's selection: pressing one must not take it away.
    toolbar.addEventListener("mousedown", (e) => e.preventDefault());
    // One tab stop for the toolbar; the arrow keys, Home and End move along it.
    toolbar.addEventListener("keydown", (e) => {
      const list = [...buttons.values()];
      const at = list.indexOf(document.activeElement as HTMLButtonElement);
      if (at < 0) return;
      const to = e.key === "ArrowRight" ? (at + 1) % list.length : e.key === "ArrowLeft" ? (at - 1 + list.length) % list.length : e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : -1;
      if (to < 0) return;
      e.preventDefault();
      for (const b of list) b.tabIndex = -1;
      list[to]!.tabIndex = 0;
      list[to]!.focus();
    });
    toolbar.addEventListener("focusin", (e) => {
      const b = e.target as HTMLButtonElement;
      if (!(b instanceof HTMLButtonElement)) return;
      for (const x of buttons.values()) x.tabIndex = -1;
      b.tabIndex = 0;
    });

    // Changing the kind of paragraph keeps the keyboard on the drop-down, so the arrow keys can step through the kinds (a browser applies each one as it is chosen). The
    // paragraphs the cursor touches are given the new tag directly; the items of a list are not paragraphs, and are left alone.
    style.addEventListener("change", () => {
      const want = style.value;
      const range = saved;
      const label = STYLES.find((s) => s.value === want)?.label ?? "Paragraph";
      if (!range || !inBox(range.startContainer)) { say("Put the cursor in the text first."); return; }
      const blocks = [...box.children].filter((c) => /^(P|H[1-6])$/.test(c.tagName) && range.intersectsNode(c));
      if (blocks.length === 0) { say("The kind of paragraph is changed for paragraphs and headings, not for the items of a list."); showState(); return; }
      // The words are moved, not copied, so the place the cursor was in them is kept (a range tied to the old paragraph would collapse when it is taken away).
      const [sc, so, ec, eo] = [range.startContainer, range.startOffset, range.endContainer, range.endOffset];
      let first: HTMLElement | null = null;
      for (const b of blocks) {
        if (b.tagName.toLowerCase() === want) { first ??= b as HTMLElement; continue; }
        const made = document.createElement(want);
        while (b.firstChild) made.appendChild(b.firstChild);
        b.replaceWith(made);
        first ??= made;
      }
      const kept = document.createRange();
      if (sc.nodeType === Node.TEXT_NODE && ec.nodeType === Node.TEXT_NODE && box.contains(sc) && box.contains(ec)) { kept.setStart(sc, so); kept.setEnd(ec, eo); }
      else if (first) { kept.selectNodeContents(first); kept.collapse(false); }
      saved = kept;
      say(`${label}.`);
    });

    // ---- a link
    function openLink(): void {
      keepSelection();
      const sel = document.getSelection();
      const words = sel && sel.rangeCount > 0 ? sel.toString() : "";
      addressRow.hidden = false;
      address.value = "";
      address.setAttribute("aria-describedby", "te-link-note");
      say(words === "" ? "Type the address. With no words chosen, the address itself is the link's words." : `Type the address that "${words.slice(0, 40)}" goes to.`);
      address.focus();
    }
    const closeLink = () => { addressRow.hidden = true; restoreSelection(); };
    addressRow.querySelector("#te-link-cancel")!.addEventListener("click", () => { closeLink(); say("No link made."); });
    addressRow.querySelector("#te-link-add")!.addEventListener("click", () => {
      const url = linkAddress(address.value);
      if (!url) { error.textContent = "That is not a web or mail address. Write one that starts with https:// or mailto:, or a plain address such as example.org."; address.focus(); return; }
      error.textContent = "";
      addressRow.hidden = true;
      restoreSelection();
      const sel = document.getSelection();
      if (sel && sel.isCollapsed) document.execCommand("insertHTML", false, `<a href="${url.replace(/"/g, "&quot;")}">${url.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</a>`);
      else document.execCommand("createLink", false, url);
      say(`Link to ${url} made.`);
      showState();
    });
    address.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); (addressRow.querySelector("#te-link-add") as HTMLButtonElement).click(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeLink(); say("No link made."); }
    });

    // ---- the box
    box.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "k") { e.preventDefault(); openLink(); return; }
      // The browser makes the words bold, italic or underlined on its own; a screen reader hears nothing of it, so it is said here once it has happened.
      const marks: Record<string, [string, string]> = { b: ["bold", "Bold"], i: ["italic", "Italic"], u: ["underline", "Underline"] };
      const mark = marks[key];
      if (mark) setTimeout(() => { showState(); say(`${mark[1]} ${safeState(mark[0]) ? "on" : "off"}.`); }, 0);
    });
    // Words pasted or dropped in come in as plain words: formatting from another program is not kept, and nothing it carries gets in.
    box.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (text !== "") document.execCommand("insertText", false, text);
    });
    box.addEventListener("drop", (e) => {
      e.preventDefault();
      const text = e.dataTransfer?.getData("text/plain") ?? "";
      if (text !== "") document.execCommand("insertText", false, text);
    });
    const onSelection = () => { if (inBox(document.getSelection()?.anchorNode ?? null)) { keepSelection(); showState(); } };
    document.addEventListener("selectionchange", onSelection);

    // ---- the HTML, for anyone who would rather write it
    const html = h("textarea", { id: "te-html", class: "te-html", rows: "8", spellcheck: "false", "aria-describedby": "te-html-note" });
    const useHtml = h("button", { type: "button", id: "te-use-html", text: "Use this HTML" });
    const details = h("details", { class: "te-details" },
      h("summary", { text: "Edit the HTML instead" }),
      h("p", { id: "te-html-note", class: "note", text: "Only paragraphs, headings, lists, bold, italic, underline, links, line breaks, superscript and subscript are kept. Anything else is taken out, and its words stay." }),
      h("div", { class: "field" }, h("label", { for: "te-html", text: "HTML" }), html),
      h("div", { class: "btn-row" }, useHtml));
    details.addEventListener("toggle", () => { if (details.open) html.value = current(); });
    useHtml.addEventListener("click", () => {
      box.innerHTML = cleanHtml(html.value);
      html.value = current();
      say("The box now has the HTML you wrote, with anything that is not kept taken out.");
    });

    // ---- finishing
    const done = h("button", { type: "button", class: "primary", id: "te-done", text: "Done" });
    const cancel = h("button", { type: "button", id: "te-cancel", text: "Cancel" });
    const finish = (value: string | null) => {
      document.removeEventListener("selectionchange", onSelection);
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    done.addEventListener("click", () => {
      const out = current();
      if (out === "") { error.textContent = "The text is empty. Write something, or press Cancel to leave it as it was."; box.focus(); return; }
      finish(out);
    });
    cancel.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      if (!addressRow.hidden) return;
      if (dirty()) { error.textContent = "You have changed the text. Press Cancel to throw the changes away, or Done to keep them."; return; }
      finish(null);
    });

    dialog.append(
      h("h2", { id: "te-title", text: `Edit text: ${opts.name}` }),
      h("p", { class: "note", text: "Type in the box. The buttons make words bold, italic or underlined, make lists and links, and change a paragraph into a heading. Ctrl+B, Ctrl+I, Ctrl+U and Ctrl+K do the same from the keyboard." }),
      h("div", { class: "field" }, h("label", { for: "te-style", text: "Kind of paragraph" }), style),
      toolbar,
      addressRow,
      h("p", { id: "te-link-note", class: "note", text: "A link works with a web address (https://) or a mail address (mailto:). Its words are what a screen reader reads, so say where it goes." }),
      h("p", { id: "te-box-label", class: "te-box-label", text: "Text" }),
      box,
      details,
      error,
      status,
      h("div", { class: "dialog-actions" }, done, cancel));
    document.body.appendChild(dialog);
    try { document.execCommand("defaultParagraphSeparator", false, "p"); document.execCommand("styleWithCSS", false, "false"); } catch { /* a browser without them still edits */ }
    dialog.showModal();
    box.focus();
    // The cursor starts at the end of the words, where an author usually wants to carry on.
    const sel = document.getSelection();
    if (sel) { const r = document.createRange(); r.selectNodeContents(box); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
    showState();
  });
}
