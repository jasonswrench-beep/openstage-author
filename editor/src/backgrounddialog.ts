// The background picker: a dialog to choose a picture to put behind a slide from the packs on this computer, to add a pack from a zip file, and to take away a pack the
// author added. Like the other dialogs it is a native <dialog>, so focus moves in, Tab stays inside and Escape closes it. Every control is a real labelled control. Each
// picture is shown beside the words that describe it, so the picture is decoration here and nothing depends on seeing it. Pictures are fetched as they scroll into view,
// because a pack can hold dozens.

import { averageHex, backgroundGroups } from "./backgrounds.ts";
import { errorText, type Backend } from "./backend.ts";
import { creditLine, NO_PACKS, PACKS_PAGE_FAILED, PACKS_PAGE_OPENED, PACKS_PAGE_URL, packsWithBackgrounds, whereFrom, type Pack, type PackBackground, type PackList } from "./packs.ts";

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

export interface BackgroundChoice {
  pack: Pack;
  background: PackBackground;
}

export interface BackgroundDialogOptions {
  backend: Pick<Backend, "packsList" | "packsFolder" | "pickPackZip" | "packInstall" | "packRemove" | "packPictureUrl" | "revealInFolder" | "openUrl">;
  announce(message: string): void;
}

/** Show the backgrounds. Resolves to the one chosen, or null if the dialog was closed without choosing. */
export function chooseBackgroundPicture(opts: BackgroundDialogOptions): Promise<BackgroundChoice | null> {
  const b = opts.backend;
  return new Promise((resolve) => {
    let state: PackList = NO_PACKS;
    let armed: string | null = null;
    let looker: IntersectionObserver | null = null;

    const dialog = h("dialog", { class: "dialog wide library-dialog", "aria-labelledby": "bg-title" });
    const title = h("h2", { id: "bg-title", text: "Choose a background picture" });
    const intro = h("p", { class: "note", text: "A background picture goes behind everything on the slide. Pictures come in packs: some came with OpenStage Author, and you can get more from the OpenStage Author website and add them here from a zip file. The picture is a decoration, so it needs no description of its own, but the words beside each picture say what it shows. The slide's background colour is set to the picture's average colour, so the checker can still judge your text. Words on a busy picture can be hard to read in places, so put them in a text bubble or on a panel." });
    const status = h("p", { class: "note lib-status", role: "status", "aria-live": "polite" });
    const failure = h("p", { class: "dialog-error", role: "alert" });
    const list = h("div", { class: "lib-list" });
    const add = h("button", { type: "button", id: "bg-add", text: "Add a pack..." });
    const get = h("button", { type: "button", id: "bg-get", text: "Get more packs...", "aria-describedby": "bg-get-note" });
    const getNote = h("span", { id: "bg-get-note", class: "sr-only", text: `Opens ${PACKS_PAGE_URL} in your web browser.` });
    const folder = h("button", { type: "button", id: "bg-folder", text: "Show the packs folder" });
    const close = h("button", { type: "button", id: "bg-close", text: "Close" });

    const finish = (choice: BackgroundChoice | null) => {
      looker?.disconnect();
      dialog.close();
      dialog.remove();
      resolve(choice);
    };

    const card = (pack: Pack, bg: PackBackground): HTMLElement => {
      const img = h("img", { class: "bg-pic", alt: "", "aria-hidden": "true" });
      img.dataset["source"] = pack.source;
      img.dataset["folder"] = pack.folder;
      img.dataset["file"] = bg.file;
      const choose = h("button", { type: "button", class: "lib-choose", text: "Use as the background", "aria-label": `Use ${bg.name} as the background` });
      choose.addEventListener("click", () => finish({ pack, background: bg }));
      return h("li", { class: "bg-card" }, img,
        h("div", { class: "lib-body" }, h("p", {}, h("strong", { text: bg.name })), h("p", { class: "lib-alt", text: bg.alt }), choose));
    };

    const fetchPicture = (img: HTMLImageElement) => {
      if (img.src || img.dataset["loading"]) return;
      img.dataset["loading"] = "1";
      void b.packPictureUrl(img.dataset["source"] === "yours" ? "yours" : "bundled", img.dataset["folder"] ?? "", img.dataset["file"] ?? "").then((u) => { img.src = u; }).catch(() => img.remove());
    };

    const packSection = (pack: Pack, i: number): HTMLElement => {
      const heading = h("h3", { id: `bg-pack-${i}`, text: pack.title });
      const about = h("p", { class: "note", text: `${pack.description ? `${pack.description} ` : ""}${creditLine(pack)} ${whereFrom(pack)}, version ${pack.version}.` });
      const kids: HTMLElement[] = [heading, about];
      backgroundGroups(pack).forEach((g, j) => {
        kids.push(h("h4", { id: `bg-group-${i}-${j}`, text: `${g.group} (${g.items.length})` }));
        kids.push(h("ul", { class: "bg-list", "aria-labelledby": `bg-group-${i}-${j}` }, ...g.items.map((x) => card(pack, x))));
      });
      if (pack.source === "yours") {
        const remove = h("button", { type: "button", class: "lib-remove", text: "Remove this pack", "aria-label": `Remove the pack ${pack.title}` });
        remove.addEventListener("click", async () => {
          if (armed !== pack.id) {
            armed = pack.id;
            remove.textContent = "Press again to remove this pack";
            status.textContent = `Press the button again to take away the pack "${pack.title}". Slides that already use its pictures keep them.`;
            window.setTimeout(() => {
              if (armed === pack.id) {
                armed = null;
                remove.textContent = "Remove this pack";
              }
            }, 8000);
            return;
          }
          armed = null;
          failure.textContent = "";
          try {
            const answer = await b.packRemove(pack.id);
            if (!answer.ok) {
              failure.textContent = answer.message;
              return;
            }
            await refresh("bg-add");
            status.textContent = `Removed the pack "${pack.title}". ${status.textContent}`;
            opts.announce(`Removed the pack ${pack.title}.`);
          } catch (err) {
            failure.textContent = errorText(err);
          }
        });
        kids.push(h("div", { class: "btn-row" }, remove));
      }
      return h("section", { class: "lib-pack", "aria-labelledby": `bg-pack-${i}` }, ...kids);
    };

    const count = () => {
      const shown = packsWithBackgrounds(state.packs);
      const n = shown.reduce((sum, p) => sum + p.backgrounds.length, 0);
      return shown.length === 0
        ? "There are no packs of backgrounds on this computer yet. Add one from a zip file."
        : `${n} ${n === 1 ? "background" : "backgrounds"} in ${shown.length} ${shown.length === 1 ? "pack" : "packs"}.`;
    };

    const draw = (focusId?: string) => {
      looker?.disconnect();
      list.replaceChildren(...packsWithBackgrounds(state.packs).map(packSection));
      if (state.broken.length > 0) {
        list.append(h("div", { class: "lib-broken", role: "group", "aria-label": "Packs that cannot be used" },
          h("h3", { text: "Packs that cannot be used" }),
          h("ul", {}, ...state.broken.map((x) => h("li", { text: `${x.folder}: ${x.message}` })))));
      }
      const pictures = Array.from(list.querySelectorAll<HTMLImageElement>("img.bg-pic"));
      if (typeof IntersectionObserver === "function") {
        looker = new IntersectionObserver((seen) => {
          for (const s of seen) if (s.isIntersecting) { fetchPicture(s.target as HTMLImageElement); looker?.unobserve(s.target); }
        }, { rootMargin: "300px" });
        for (const img of pictures) looker.observe(img);
      } else {
        for (const img of pictures.slice(0, 12)) fetchPicture(img);
      }
      status.textContent = count();
      if (focusId) document.getElementById(focusId)?.focus();
    };

    const refresh = async (focusId?: string): Promise<void> => {
      try {
        state = await b.packsList();
      } catch (err) {
        state = NO_PACKS;
        failure.textContent = errorText(err);
      }
      draw(focusId);
    };

    add.addEventListener("click", async () => {
      failure.textContent = "";
      try {
        const zip = await b.pickPackZip();
        if (!zip) return;
        status.textContent = "Checking the pack...";
        const answer = await b.packInstall(zip);
        if (!answer.ok) {
          failure.textContent = answer.message;
          status.textContent = count();
          return;
        }
        await refresh();
        status.textContent = `${answer.message} ${status.textContent}`;
        opts.announce(answer.message);
      } catch (err) {
        failure.textContent = errorText(err);
        status.textContent = count();
      }
    });
    get.addEventListener("click", async () => {
      failure.textContent = "";
      try {
        await b.openUrl(PACKS_PAGE_URL);
        status.textContent = PACKS_PAGE_OPENED;
      } catch {
        failure.textContent = PACKS_PAGE_FAILED;
      }
    });
    folder.addEventListener("click", async () => {
      failure.textContent = "";
      try {
        await b.revealInFolder(await b.packsFolder());
        status.textContent = "Showing the folder your own packs are kept in.";
      } catch (err) {
        failure.textContent = errorText(err);
      }
    });
    close.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish(null);
    });

    dialog.append(title, intro, status, failure, list, h("div", { class: "dialog-actions" }, add, get, getNote, folder, close));
    document.body.appendChild(dialog);
    status.textContent = "Looking for packs of backgrounds...";
    dialog.showModal();
    add.focus();
    void refresh().then(() => {
      // Put focus on the first picture's button, so choosing is one key away; if there is none, or the author has already moved on, it stays where it is.
      if (document.activeElement === add) (dialog.querySelector(".lib-choose") as HTMLElement | null)?.focus();
    });
  });
}

/** The average colour of a picture, found by drawing it small and averaging what is drawn. Null if the picture cannot be read. */
export async function averageColourOf(url: string): Promise<string | null> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = 48;
    const hgt = 27;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = hgt;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, hgt);
    return averageHex(ctx.getImageData(0, 0, w, hgt).data);
  } catch {
    return null;
  }
}
