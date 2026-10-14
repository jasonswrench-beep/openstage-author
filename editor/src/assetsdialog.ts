// The Assets dialog. Four tabs: "This project" lists everything the project keeps under assets/ (what
// is in the project is also what is exported), "Find media" searches the free libraries with the
// author's own free key, "Make with AI" makes a picture or a sound from words with a service the author has a key for,
// and "Settings" holds the library keys. A native <dialog>, so focus moves in, Tab stays
// inside, Escape closes it and focus returns to the button that opened it. Each tab is a real tab (arrow
// keys move between them) and each list of assets is one group of radio buttons.

import type { CreditEntry } from "../../player/src/types.ts";
import type { AssetFile, AssetKindName, Backend } from "./backend.ts";
import { errorText } from "./backend.ts";
import { creditForMade, hasKey, nowStamp, parseSoundSeconds, PROMPT_LIMIT, promptProblem, QUALITIES, SHAPES, serviceById, titleFromPrompt, type ServiceId, type Work } from "./aiservices.ts";
import { updateSettings } from "./aidialog.ts";
import type { Model } from "./model.ts";
import { clock, creditFor, KEYED, KINDS, LINK_SOURCES, nameFor, parseSettings, searchStock, SOURCES, sourceById, sourcesFor, trackDownload, type KeyedProvider, type MediaKind, type Provider, type Settings, type StockHit } from "./stock.ts";

export interface AssetsContext {
  model: Model;
  backend: Backend;
  announce(message: string): void;
  /** Put a picture on the slide being edited. `suggestion` is what a stock service says it shows, if anything. */
  insertImage(path: string, suggestion?: string, source?: "service" | "prompt"): Promise<void>;
  insertMedia(kind: "video" | "audio", path: string): void;
  /** Offer a file from the project for download on the slide. */
  insertDownload(path: string): void;
  /** Use a captions file for the selected video or audio clip. */
  useCaptions(path: string): void;
  /** Ask whether a service may be sent what is about to be made with it. True if the author says yes, now or before. */
  askToSend(service: ServiceId, work: Work): Promise<boolean>;
  /** Open the AI services dialog, where keys are added. Resolves when it closes. */
  openAiServices(): Promise<void>;
  tab?: "project" | "stock" | "make" | "settings";
}

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

const KIND_LABELS: Record<AssetKindName, string> = { image: "Image", video: "Video", audio: "Audio", captions: "Captions", document: "File to download" };
const ASSET_KINDS: AssetKindName[] = ["image", "video", "audio", "captions", "document"];
const FILTERS: { value: "all" | AssetKindName; label: string }[] = [
  { value: "all", label: "All assets" }, { value: "image", label: "Images" }, { value: "video", label: "Video" }, { value: "audio", label: "Audio" }, { value: "captions", label: "Captions" }, { value: "document", label: "Files to download" },
];

export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The sentence that says where an asset came from. */
export function creditSentence(c: CreditEntry | undefined): string {
  if (!c) return "No credit recorded. OpenStage treats this as your own file.";
  const s = c.source;
  if (s.provider === "generated") {
    const made = s.generated ? ` The words that made it: "${s.generated.prompt}".` : "";
    return `${c.title || "Untitled"}, made with ${s.creator || "an AI service"}. ${s.licence ? `${s.licence}.` : ""}${made}`.trim();
  }
  const where = s.provider === "other" ? "" : ` from ${PROVIDER_NAMES[s.provider] ?? s.provider}`;
  return `${c.title || "Untitled"}${s.creator ? `, by ${s.creator}` : ""}${where}. ${s.licence ? `${s.licence}.` : ""}${s.requiresCredit ? " Credit is required." : ""}`.trim();
}

/** Where an asset can have come from, as the credit editor and the credits page name them. */
export const PROVIDER_NAMES: Record<string, string> = {
  pixabay: "Pixabay", unsplash: "Unsplash", pexels: "Pexels", openverse: "Openverse", wikimedia: "Wikimedia Commons", freesound: "Freesound",
  mixkit: "Mixkit", svgrepo: "SVG Repo", libreshot: "Libreshot", vecteezy: "Vecteezy",
};

/** Ask for the credit details of one asset. Resolves to the entry, or null if cancelled. */
function askCredit(path: string, kind: AssetKindName, current: CreditEntry | undefined): Promise<CreditEntry | null> {
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "dialog", "aria-labelledby": "cr-heading" });
    const field = (id: string, label: string, value: string) => {
      const input = h("input", { id: `cr-${id}`, type: "text" });
      input.value = value;
      return { input, row: h("div", { class: "field" }, h("label", { for: `cr-${id}`, text: label }), input) };
    };
    const s = current?.source;
    const title = field("title", "Title", current?.title ?? "");
    const creator = field("creator", "Creator", s?.creator ?? "");
    const creatorUrl = field("creator-url", "Creator's page", s?.creatorUrl ?? "");
    const url = field("url", "Source link", s?.url ?? "");
    const licence = field("licence", "Licence", s?.licence ?? "");
    const provider = h("select", { id: "cr-provider" }, ...[["other", "Somewhere else"], ...(current?.source.provider === "generated" ? [["generated", "Made by an AI service"]] : []), ...Object.entries(PROVIDER_NAMES).filter(([id]) => id !== "vecteezy" || current?.source.provider === "vecteezy")].map(([v, l]) => h("option", { value: v!, text: l! })));
    provider.value = s?.provider ?? "other";
    const required = h("input", { id: "cr-required", type: "checkbox", ...(s?.requiresCredit ? { checked: true } : {}) });
    const error = h("p", { class: "dialog-error", role: "alert" });
    const ok = h("button", { type: "submit", text: "Save credit" });
    const cancel = h("button", { type: "button", text: "Cancel" });
    const form = h("form", { method: "dialog" },
      h("h2", { id: "cr-heading", text: "Where did this come from?" }),
      h("p", { class: "note", text: `${path}. Leave everything empty for a file that is your own.` }),
      title.row, creator.row, creatorUrl.row, url.row, licence.row,
      h("div", { class: "field" }, h("label", { for: "cr-provider", text: "Found on" }), provider),
      h("div", { class: "field check" }, required, h("label", { for: "cr-required", text: "The licence requires credit" })),
      error, h("div", { class: "dialog-actions" }, ok, cancel));
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    let result: CreditEntry | null = null;
    const finish = () => { dialog.close(); dialog.remove(); resolve(result); };
    cancel.addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (required.checked && !(creator.input.value.trim() && url.input.value.trim() && licence.input.value.trim())) {
        error.textContent = "When credit is required, give the creator, the source link and the licence.";
        creator.input.focus();
        return;
      }
      result = {
        path, kind: kind === "captions" ? "video" : kind, title: title.input.value.trim(),
        source: {
          provider: provider.value as CreditEntry["source"]["provider"], url: url.input.value.trim(), creator: creator.input.value.trim(), creatorUrl: creatorUrl.input.value.trim(), licence: licence.input.value.trim(), requiresCredit: required.checked,
          // The record of what made it stays for as long as it is still called AI-made.
          ...(provider.value === "generated" && s?.generated ? { generated: s.generated } : {}),
        },
      };
      finish();
    });
    dialog.showModal();
    title.input.focus();
  });
}

export function openAssets(ctx: AssetsContext): Promise<void> {
  return new Promise((resolve) => {
    const m = ctx.model;
    const b = ctx.backend;
    const dialog = h("dialog", { class: "dialog wide assets-dialog", "aria-labelledby": "as-title" });

    // ---- tabs
    const tabNames: { id: "project" | "stock" | "make" | "settings"; label: string }[] = [
      { id: "project", label: "This project" }, { id: "stock", label: "Find media" }, { id: "make", label: "Make with AI" }, { id: "settings", label: "Settings" },
    ];
    const tablist = h("div", { class: "as-tabs", role: "tablist", "aria-label": "Assets" });
    const tabs = tabNames.map((t) => h("button", { type: "button", role: "tab", id: `as-tab-${t.id}`, "aria-controls": `as-panel-${t.id}`, text: t.label }));
    tablist.append(...tabs);
    const panels = tabNames.map((t) => h("div", { class: "as-panel", role: "tabpanel", id: `as-panel-${t.id}`, "aria-labelledby": `as-tab-${t.id}` }));
    const select = (i: number, focus: boolean) => {
      tabs.forEach((tab, j) => { tab.setAttribute("aria-selected", String(j === i)); tab.tabIndex = j === i ? 0 : -1; panels[j]!.hidden = j !== i; });
      if (focus) tabs[i]!.focus();
    };
    tabs.forEach((tab, i) => tab.addEventListener("click", () => select(i, false)));
    tablist.addEventListener("keydown", (e) => {
      const at = tabs.findIndex((t) => t === document.activeElement);
      if (at === -1) return;
      const to = e.key === "ArrowRight" ? (at + 1) % tabs.length : e.key === "ArrowLeft" ? (at - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
      if (to < 0) return;
      e.preventDefault();
      select(to, true);
    });

    const status = h("p", { class: "as-status", role: "status" });
    const say = (text: string) => { status.textContent = text; };

    // ================================================================ this project
    let assets: AssetFile[] = [];
    let filter: "all" | AssetKindName = "all";
    let chosen: string | null = null;

    const listEl = h("div", { class: "as-grid", role: "radiogroup", "aria-label": "Project assets" });
    const detail = h("div", { class: "as-detail", "aria-live": "polite" });
    const filterSel = h("select", { id: "as-filter" }, ...FILTERS.map((f) => h("option", { value: f.value, text: f.label })));
    filterSel.addEventListener("change", () => { filter = filterSel.value as typeof filter; renderList(); });

    const addButtons = ASSET_KINDS.map((kind) =>
      h("button", { type: "button", class: "small", text: kind === "document" ? "Add a file to download..." : `Add ${kind === "captions" ? "captions" : kind}...` }));
    addButtons.forEach((btn, i) => btn.addEventListener("click", async () => {
      const kind = ASSET_KINDS[i]!;
      try {
        const picked = await b.pickFile(kind);
        if (!picked) return;
        const path = await b.importAsset(m.dir, picked, kind);
        await reload(path);
        say(`Added ${path.split("/").pop()} to the project. If it came from a website, choose Edit credit to record where.`);
      } catch (err) {
        say(`Could not add the file. ${errorText(err)}`);
      }
    }));

    const creditsBox = h("input", { id: "as-credits", type: "checkbox", ...(m.credits ? { checked: true } : {}) });
    creditsBox.addEventListener("change", () => { const msg = m.setCredits(creditsBox.checked); if (msg) say(msg); });

    async function reload(select_?: string): Promise<void> {
      assets = await b.listAssets(m.dir);
      if (select_) chosen = select_;
      renderList();
    }

    function renderList(): void {
      const shown = assets.filter((a) => filter === "all" || a.kind === filter);
      listEl.replaceChildren();
      if (shown.length === 0) {
        listEl.appendChild(h("p", { class: "note", text: assets.length === 0 ? "Nothing here yet. Add files from your computer, or find stock images." : "Nothing of that kind." }));
      }
      for (const a of shown) {
        const radio = h("input", { type: "radio", name: "as-asset", value: a.path, ...(a.path === chosen ? { checked: true } : {}) });
        radio.addEventListener("change", () => { chosen = a.path; renderDetail(); });
        const thumb = h("span", { class: "as-thumb", "aria-hidden": "true" });
        if (a.kind === "image") {
          const img = h("img", { alt: "" });
          void b.assetUrl(m.dir, a.path).then((url) => { img.src = url; }).catch(() => undefined);
          thumb.appendChild(img);
        } else {
          thumb.textContent = KIND_LABELS[a.kind];
        }
        const name = a.path.split("/").pop() ?? a.path;
        listEl.appendChild(h("label", { class: "layout-card as-card" }, radio, h("span", { class: "card-body" }, thumb, h("span", { class: "card-title", text: name }), h("span", { class: "card-desc", text: `${KIND_LABELS[a.kind]}, ${sizeText(a.size)}` }))));
      }
      renderDetail();
    }

    function renderDetail(): void {
      detail.replaceChildren();
      const a = assets.find((x) => x.path === chosen);
      if (!a) { detail.appendChild(h("p", { class: "note", text: "Select an asset to see where it is used and where it came from." })); return; }
      const uses = m.usageOf(a.path);
      const insertLabel = a.kind === "captions" ? "Use as captions for the selected video or audio" : a.kind === "document" ? "Offer for download on this slide" : "Insert on this slide";
      const insert = h("button", { type: "button", text: insertLabel });
      insert.addEventListener("click", () => {
        close();
        if (a.kind === "image") void ctx.insertImage(a.path);
        else if (a.kind === "captions") ctx.useCaptions(a.path);
        else if (a.kind === "document") ctx.insertDownload(a.path);
        else ctx.insertMedia(a.kind, a.path);
      });
      const edit = h("button", { type: "button", text: "Edit credit..." });
      edit.addEventListener("click", async () => {
        const entry = await askCredit(a.path, a.kind, m.creditOf(a.path));
        if (!entry) return;
        const empty = !entry.title && !entry.source.creator && !entry.source.url && !entry.source.licence && entry.source.provider === "other";
        if (empty) m.dropCredit(a.path); else m.setCredit(entry);
        renderDetail();
      });
      const del = h("button", { type: "button", text: "Delete from project" });
      if (uses.length > 0) { del.setAttribute("aria-disabled", "true"); del.setAttribute("aria-describedby", "as-del-note"); }
      del.addEventListener("click", async () => {
        if (uses.length > 0) { say("This asset is used on a slide, so it cannot be deleted. Remove it from the slide first."); return; }
        if (!(await b.confirm(`Delete ${a.path} from the project? This cannot be undone.`))) return;
        try {
          await b.deleteAsset(m.dir, a.path);
          m.dropCredit(a.path);
          chosen = null;
          await reload();
          say(`Deleted ${a.path}.`);
        } catch (err) {
          say(`Could not delete it. ${errorText(err)}`);
        }
      });
      detail.append(
        h("h3", { text: a.path.split("/").pop() ?? a.path }),
        h("p", { text: `${KIND_LABELS[a.kind]}, ${sizeText(a.size)}. ${a.path}` }),
        h("p", { text: creditSentence(m.creditOf(a.path)) }),
        h("p", { text: uses.length === 0 ? "Not used on any slide." : `Used on: ${uses.map((u) => `${u.object} on ${u.slide}`).join("; ")}.` }),
        h("div", { class: "btn-row" }, insert, edit, del),
        h("p", { id: "as-del-note", class: "note", text: uses.length > 0 ? "It cannot be deleted while a slide uses it." : "" }),
      );
    }

    panels[0]!.append(
      h("div", { class: "as-toolbar" }, h("label", { for: "as-filter", text: "Show" }), filterSel, ...addButtons),
      h("div", { class: "as-split" }, listEl, detail),
      h("div", { class: "field check" }, creditsBox, h("label", { for: "as-credits", text: "Show a credits page in the published course (only for assets that need credit)" })),
      h("p", { class: "note", text: "Everything in this list is part of the project, and is included in the published course and the SCORM package." }),
    );

    // ================================================================ find media
    let settings: Settings = parseSettings("");
    let kind: MediaKind = "image";
    let provider: Provider = "pexels";
    let query = "";
    let page = 0;
    let hits: StockHit[] = [];
    let hasMore = false;
    let picked: StockHit | null = null;

    const kindSel = h("select", { id: "st-kind" }, ...KINDS.map((k) => h("option", { value: k.id, text: k.label })));
    const provSel = h("select", { id: "st-provider" });
    const fillSources = () => {
      provSel.replaceChildren(...sourcesFor(kind).map((src) => h("option", { value: src.id, text: `${src.name} (search needs a key)` })));
      if (!sourcesFor(kind).some((src) => src.id === provider)) provider = sourcesFor(kind)[0]!.id;
      provSel.value = provider;
    };
    const reset = () => { hits = []; picked = null; hasMore = false; renderStock(); keyNote(); renderLinks(); };
    kindSel.addEventListener("change", () => { kind = kindSel.value as MediaKind; fillSources(); reset(); });
    provSel.addEventListener("change", () => { provider = provSel.value as Provider; reset(); });
    const queryInput = h("input", { id: "st-query", type: "search", autocomplete: "off" });
    const searchBtn = h("button", { type: "submit", text: "Search" });
    const form = h("form", { class: "as-toolbar", role: "search" }, h("label", { for: "st-kind", text: "Find" }), kindSel, h("label", { for: "st-provider", text: "On" }), provSel, h("label", { for: "st-query", text: "Search for" }), queryInput, searchBtn);
    const keyMsg = h("p", { class: "note" });
    const stockGrid = h("div", { class: "as-grid", role: "radiogroup", "aria-label": "Search results" });
    const stockDetail = h("div", { class: "as-detail", "aria-live": "polite" });
    const more = h("button", { type: "button", text: "More results" });
    more.hidden = true;
    const links = h("div", {});

    const get = (url: string, headers: [string, string][]) => b.httpGet(url, headers);
    const keyOf = (id: Provider): string => (KEYED as string[]).includes(id) ? settings.keys[id as KeyedProvider] : "";
    function keyNote(): void {
      const src = sourceById(provider);
      keyMsg.textContent = keyOf(provider).trim() === ""
        ? `Searching ${src.name} from here needs its free key, which you add in Settings. Without one, use the button below to open ${src.name} in your browser. ${src.blurb}`
        : src.blurb;
    }
    function renderLinks(): void {
      links.replaceChildren(...LINK_SOURCES.filter((l) => l.kinds.includes(kind)).map((l) => {
        const open = h("button", { type: "button", class: "small", text: `Open ${l.name} in your browser` });
        open.addEventListener("click", () => void b.openUrl(l.url));
        const here = l.searchId === undefined ? "It cannot be searched from here." : keyOf(l.searchId).trim() === "" ? "To search it from here, add its free key in Settings." : "You can search it here too.";
        return h("div", { class: "as-links" }, open, h("span", { class: "note", text: `${l.note} ${here}` }));
      }));
    }

    async function search(next: boolean): Promise<void> {
      try {
        if (!next) { query = queryInput.value; page = 0; hits = []; picked = null; }
        say("Searching...");
        const result = await searchStock(provider, kind, query, page + 1, keyOf(provider), get);
        page = result.page;
        hits = [...hits, ...result.hits];
        hasMore = result.hasMore;
        say(hits.length === 0 ? "Nothing found. Try other words." : `${hits.length} ${hits.length === 1 ? "result" : "results"} shown${hasMore ? ". There are more." : "."}`);
        renderStock();
      } catch (err) {
        say(errorText(err));
      }
    }
    form.addEventListener("submit", (e) => { e.preventDefault(); void search(false); });
    more.addEventListener("click", () => void search(true));

    function renderStock(): void {
      stockGrid.replaceChildren();
      for (const hit of hits) {
        const radio = h("input", { type: "radio", name: "st-hit", value: `${hit.provider}-${hit.id}`, ...(picked === hit ? { checked: true } : {}) });
        radio.addEventListener("change", () => { picked = hit; renderStockDetail(); });
        const thumb = h("span", { class: "as-thumb", "aria-hidden": "true" });
        if (hit.preview) thumb.appendChild(h("img", { alt: "", src: hit.preview, loading: "lazy" }));
        else thumb.textContent = hit.kind === "audio" ? "Sound" : "Video";
        const extra = [hit.creator ? `By ${hit.creator}` : "", hit.duration ? clock(hit.duration) : ""].filter(Boolean).join(", ");
        stockGrid.appendChild(h("label", { class: "layout-card as-card" }, radio, h("span", { class: "card-body" }, thumb, h("span", { class: "card-title", text: hit.title }), h("span", { class: "card-desc", text: extra }))));
      }
      more.hidden = !hasMore;
      renderStockDetail();
    }

    function renderStockDetail(): void {
      stockDetail.replaceChildren();
      if (!picked) { stockDetail.appendChild(h("p", { class: "note", text: hits.length ? "Select a result to see its details." : "Search, then select a result." })); return; }
      const hit = picked;
      const noun = hit.kind === "image" ? "picture" : hit.kind;
      const addOnly = h("button", { type: "button", text: "Add to project" });
      const addInsert = h("button", { type: "button", text: "Add and insert on this slide" });
      const run = async (insert: boolean) => {
        try {
          say(`Adding the ${noun}... a video can take a little while.`);
          const path = await b.downloadAsset(m.dir, hit.downloadUrl, nameFor(hit), hit.kind);
          await trackDownload(hit, keyOf(hit.provider), get);
          m.setCredit({ path, title: hit.title, kind: hit.kind, source: creditFor(hit) });
          await reload(path);
          if (insert) {
            close();
            if (hit.kind === "image") await ctx.insertImage(path, hit.suggestedAlt || undefined);
            else ctx.insertMedia(hit.kind, path);
            return;
          }
          say(`Added to the project as ${path.split("/").pop()}, with its credit saved. Find it in "This project".`);
        } catch (err) {
          say(`Could not add the ${noun}. ${errorText(err)}`);
        }
      };
      addOnly.addEventListener("click", () => void run(false));
      addInsert.addEventListener("click", () => void run(true));
      const web = h("button", { type: "button", class: "small", text: `Open on ${sourceById(hit.provider).name}` });
      web.addEventListener("click", () => void b.openUrl(hit.pageUrl));
      const facts = [hit.creator ? `By ${hit.creator}.` : "", `${hit.licence}.`, hit.requiresCredit ? "Credit is required, and OpenStage will save it and show it on the credits page." : "", hit.duration ? `Length ${clock(hit.duration)}.` : ""].filter(Boolean).join(" ");
      stockDetail.append(
        h("h3", { text: hit.title }),
        ...(hit.kind === "audio" && hit.listenUrl ? [h("audio", { class: "as-listen", controls: true, preload: "none", src: hit.listenUrl, "aria-label": `Listen to ${hit.title}` })] : []),
        ...(hit.preview ? [h("img", { class: "as-preview", alt: "", src: hit.preview })] : []),
        h("p", { text: facts }),
        ...(hit.suggestedAlt && hit.kind !== "audio" ? [h("p", { class: "note", text: `The service describes this as: "${hit.suggestedAlt}". You still write the alt text yourself, and can use this as a start.` })] : []),
        ...(hit.kind !== "image" ? [h("p", { class: "note", text: hit.kind === "video" ? "A video needs captions before the course can be published. You add them after it is in the project." : "A sound needs captions or a transcript. You add one after it is in the project." })] : []),
        h("div", { class: "btn-row" }, addOnly, addInsert, web),
      );
    }

    panels[1]!.append(
      h("p", { class: "note", text: "You do not need a key to use these sites. Open one in your browser (the buttons below), download what you want, then add the file on the \"This project\" tab and use Edit credit to say where it came from. A free key lets you search Pexels, Pixabay, Unsplash and Freesound from here instead." }),
      form, keyMsg,
      h("div", { class: "as-split" }, h("div", {}, stockGrid, more), stockDetail),
      h("p", { class: "note", text: "Files are copied into the project, so the course never depends on the website afterwards." }),
      links,
    );
    fillSources();
    renderLinks();

    // ================================================================ make with AI
    // A picture is made with OpenAI and a sound effect with ElevenLabs. The file is saved in the project as soon as it is made, with a credit that
    // says an AI service made it and the words that made it. Alt text is never written for the author.
    let working = false;
    const makeBody = h("div", {});
    const rereadSettings = async () => { settings = parseSettings(await b.readSettings().catch(() => "")); };

    async function showMade(into: HTMLElement, work: "picture" | "sound", path: string, prompt: string): Promise<void> {
      into.replaceChildren();
      const insert = h("button", { type: "button", text: "Insert on this slide" });
      insert.addEventListener("click", () => {
        close();
        if (work === "picture") void ctx.insertImage(path, prompt, "prompt");
        else ctx.insertMedia("audio", path);
      });
      const player = work === "picture" ? h("img", { class: "as-preview", alt: "Preview of the picture that was made" }) : h("audio", { class: "as-listen", controls: true, "aria-label": "Listen to the sound that was made" });
      try {
        if (player instanceof HTMLImageElement) player.src = await b.assetUrl(m.dir, path);
        else player.src = await b.mediaUrl(m.dir, path);
      } catch {
        player.replaceWith(h("p", { class: "note", text: "A preview needs the desktop app. The file is saved in the project." }));
      }
      into.append(
        h("h4", { text: `Made: ${path.split("/").pop()}` }),
        player,
        h("p", { class: "note", text: `You asked for: "${prompt}". An AI service does not always make what was asked for, so check it before you use it.${work === "picture" ? " You still write its alt text yourself." : " A sound needs captions or a transcript, which you add after it is on the slide."}` }),
        h("div", { class: "btn-row" }, insert),
      );
    }

    function makeSection(work: "picture" | "sound", id: ServiceId): HTMLElement {
      const svc = serviceById(id);
      const prefix = `mk-${work}`;
      const heading = h("h3", { id: `${prefix}-h`, text: work === "picture" ? `Make a picture with ${svc.name}` : `Make a sound effect with ${svc.name}` });
      if (!hasKey(settings.ai, id)) {
        const open = h("button", { type: "button", class: "small", id: `${prefix}-open`, text: "Open AI services" });
        open.addEventListener("click", () => void (async () => {
          await ctx.openAiServices();
          await rereadSettings();
          renderMake();
          // The block was drawn again: put the focus on its new first control, so it is not lost.
          (document.getElementById(`${prefix}-prompt`) ?? document.getElementById(`${prefix}-open`))?.focus();
        })());
        return h("section", { class: "ai-service", "aria-labelledby": `${prefix}-h` }, heading,
          h("p", { class: "note", text: `To make ${work === "picture" ? "pictures" : "sounds"} here, add your ${svc.name} key in AI services. You pay ${svc.name} for what you make; OpenStage does not charge for it.` }), open);
      }
      const prompt = h("textarea", { id: `${prefix}-prompt`, rows: "4", maxlength: String(PROMPT_LIMIT[work]) });
      const hint = work === "picture"
        ? "Say what the picture should show, and the style if you want one. For example: a flat illustration of a teacher greeting a class, bright colours."
        : "Say what the sound should be. For example: a door closing in a quiet hallway.";
      const shape = h("select", { id: `${prefix}-shape` }, ...SHAPES.map((s) => h("option", { value: s.id, text: s.label })));
      const quality = h("select", { id: `${prefix}-quality` }, ...QUALITIES.map((q) => h("option", { value: q.id, text: q.label })));
      quality.value = "medium";
      const secs = h("input", { id: `${prefix}-seconds`, type: "text", inputmode: "decimal", autocomplete: "off" });
      const go = h("button", { type: "button", text: work === "picture" ? "Make the picture" : "Make the sound" });
      const cancel = h("button", { type: "button", class: "small", text: "Cancel" });
      cancel.hidden = true;
      const result = h("div", { class: "as-detail", "aria-live": "polite" });
      go.addEventListener("click", async () => {
        if (working) return;
        const problem = promptProblem(prompt.value, work);
        if (problem) { say(problem); prompt.focus(); return; }
        let seconds: number | null = null;
        if (work === "sound") {
          const parsed = parseSoundSeconds(secs.value);
          if (!parsed.ok) { say(parsed.message); secs.focus(); return; }
          seconds = parsed.seconds;
        }
        if (!(await ctx.askToSend(id, work))) { say(`Nothing was sent to ${svc.name}.`); return; }
        working = true;
        go.setAttribute("aria-disabled", "true");
        cancel.hidden = false;
        say(`Asking ${svc.name} to make the ${work}. This can take up to a minute. You can cancel.`);
        try {
          const words = prompt.value.trim();
          const request = work === "picture" ? { service: id, prompt: words, size: shape.value, quality: quality.value } : { service: id, prompt: words, seconds };
          const answer = await b.aiMake(m.dir, work, request);
          if (!answer.ok) { say(answer.cancelled ? "Cancelled. Nothing was added." : answer.message); return; }
          m.setCredit(creditForMade({ path: answer.path, title: titleFromPrompt(words), kind: work === "picture" ? "image" : "audio", service: id, model: answer.model, prompt: words, madeAt: nowStamp() }));
          await reload(answer.path);
          await showMade(result, work, answer.path, words);
          say(`The ${work} is made and saved in the project as ${answer.path.split("/").pop()}, with a credit that says an AI service made it.`);
        } catch (err) {
          say(errorText(err));
        } finally {
          working = false;
          go.removeAttribute("aria-disabled");
          cancel.hidden = true;
        }
      });
      cancel.addEventListener("click", () => void b.cancelJob());
      return h("section", { class: "ai-service", "aria-labelledby": `${prefix}-h` }, heading,
        h("div", { class: "field" }, h("label", { for: prompt.id, text: work === "picture" ? "Describe the picture" : "Describe the sound" }), prompt, h("p", { class: "note", text: hint })),
        ...(work === "picture"
          ? [h("div", { class: "field" }, h("label", { for: shape.id, text: "Shape" }), shape), h("div", { class: "field" }, h("label", { for: quality.id, text: "Quality" }), quality)]
          : [h("div", { class: "field" }, h("label", { for: secs.id, text: "Length in seconds (0.5 to 30, or empty to let the service decide)" }), secs)]),
        h("div", { class: "btn-row" }, go, cancel),
        h("p", { class: "note", text: `Each time you choose this, ${svc.name} charges your account. Your description is sent to ${svc.name}; nothing else from your course is.` }),
        result);
    }

    function renderMake(): void {
      makeBody.replaceChildren(makeSection("picture", "openai"), makeSection("sound", "elevenlabs"));
    }

    panels[2]!.append(
      h("p", { class: "note", text: "Make a picture or a sound from words, with a service you have your own key for. What you make is saved in your project, with a credit that says an AI service made it and the words you gave. The credit is shown on the credits page, and you still write the alt text yourself." }),
      makeBody,
    );
    renderMake();

    // ================================================================ settings
    const keyField = (id: KeyedProvider) => {
      const src = sourceById(id);
      const input = h("input", { id: `se-${id}`, type: "password", autocomplete: "off", spellcheck: "false" });
      const show = h("button", { type: "button", class: "small", text: "Show" });
      show.addEventListener("click", () => { const shown = input.type === "text"; input.type = shown ? "password" : "text"; show.textContent = shown ? "Show" : "Hide"; });
      const getKey = h("button", { type: "button", class: "small", text: `Get a free ${src.name} key` });
      getKey.addEventListener("click", () => void b.openUrl(src.keyUrl));
      const what = src.kinds.map((k) => (k === "image" ? "images" : k)).join(", ");
      return { id, input, row: h("div", { class: "field" }, h("label", { for: `se-${id}`, text: `${src.name} ${src.keyName} (${what})` }), h("span", { class: "as-keyrow" }, input, show, getKey)) };
    };
    const keyFields = KEYED.map(keyField);
    const save = h("button", { type: "button", text: "Save keys" });
    save.addEventListener("click", async () => {
      try {
        const keys = Object.fromEntries(keyFields.map((k) => [k.id, k.input.value.trim()])) as Settings["keys"];
        settings = await updateSettings(b, (current) => ({ ...current, keys }));
        keyNote();
        say("Keys saved.");
      } catch (err) {
        say(`Could not save the keys. ${errorText(err)}`);
      }
    });
    panels[3]!.append(
      h("p", { text: `To search a library from here you need that library's own free key. Each has a page where you sign up and copy it: ${SOURCES.map((x) => x.name).join(", ")}.` }),
      ...keyFields.map((k) => k.row),
      h("div", { class: "btn-row" }, save),
      h("p", { class: "note", text: "The keys are kept on this computer only, in OpenStage's own settings. They are never saved in a project, so they are not shared when you share one." }),
    );

    // ================================================================ the dialog
    const closeBtn = h("button", { type: "button", text: "Close" });
    const form2 = h("div", {}, h("h2", { id: "as-title", text: "Assets" }), tablist, ...panels, status, h("div", { class: "dialog-actions" }, closeBtn));
    dialog.appendChild(form2);
    document.body.appendChild(dialog);

    const close = () => { if (dialog.open) dialog.close(); dialog.remove(); resolve(); };
    closeBtn.addEventListener("click", close);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });

    select(tabNames.findIndex((t) => t.id === (ctx.tab ?? "project")), false);
    dialog.showModal();
    tabs[tabNames.findIndex((t) => t.id === (ctx.tab ?? "project"))]!.focus();
    keyNote();
    renderStock();
    void (async () => {
      try {
        settings = parseSettings(await b.readSettings());
        for (const k of keyFields) k.input.value = settings.keys[k.id];
        keyNote();
        renderMake();
      } catch {
        // no settings yet
      }
      try {
        await reload();
      } catch (err) {
        say(`Could not list the project's assets. ${errorText(err)}`);
      }
    })();
  });
}
