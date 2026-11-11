// The library of people: a dialog to choose a person from a character pack, to add a pack from a zip file, and to take away a pack the author added. Like the other
// dialogs it is a native <dialog>, so focus moves in, Tab stays inside and Escape closes it. Every control is a real labelled control. Each person's picture is shown
// beside the words that describe them (the same words become the alt text), so the picture is decoration here and nothing depends on seeing it.

import { errorText, type Backend } from "./backend.ts";
import { creditLine, NO_PACKS, PACKS_PAGE_FAILED, PACKS_PAGE_OPENED, PACKS_PAGE_URL, packsWithPeople, whereFrom, type Pack, type PackList, type PackPerson } from "./packs.ts";

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

export interface LibraryChoice {
  pack: Pack;
  person: PackPerson;
}

export interface LibraryDialogOptions {
  backend: Pick<Backend, "packsList" | "packsFolder" | "pickPackZip" | "packInstall" | "packRemove" | "packPictureUrl" | "revealInFolder" | "openUrl">;
  announce(message: string): void;
}

/** Show the library. Resolves to the person chosen, or null if the dialog was closed without choosing. */
export function chooseFromLibrary(opts: LibraryDialogOptions): Promise<LibraryChoice | null> {
  const b = opts.backend;
  return new Promise((resolve) => {
    let state: PackList = NO_PACKS;
    /** The pack whose Remove button has been pressed once: it needs a second press. */
    let armed: string | null = null;

    const dialog = h("dialog", { class: "dialog wide library-dialog", "aria-labelledby": "lib-title" });
    const title = h("h2", { id: "lib-title", text: "Choose a person" });
    const intro = h("p", { class: "note", text: "People come in character packs. Some came with OpenStage Author. You can get more from the OpenStage Author website and add them here from a zip file. Choosing someone adds their picture and a description of them to your cast, and their name and a voice if you had not given them yet. You can change all of it afterwards." });
    const status = h("p", { class: "note lib-status", role: "status", "aria-live": "polite" });
    const failure = h("p", { class: "dialog-error", role: "alert" });
    const list = h("div", { class: "lib-list" });
    const add = h("button", { type: "button", id: "lib-add", text: "Add a character pack..." });
    const get = h("button", { type: "button", id: "lib-get", text: "Get more packs...", "aria-describedby": "lib-get-note" });
    const getNote = h("span", { id: "lib-get-note", class: "sr-only", text: `Opens ${PACKS_PAGE_URL} in your web browser.` });
    const folder = h("button", { type: "button", id: "lib-folder", text: "Show the packs folder" });
    const close = h("button", { type: "button", id: "lib-close", text: "Close" });

    const finish = (choice: LibraryChoice | null) => {
      dialog.close();
      dialog.remove();
      resolve(choice);
    };

    const personCard = (pack: Pack, person: PackPerson): HTMLElement => {
      const img = h("img", { class: "lib-pic", alt: "", "aria-hidden": "true" });
      void b.packPictureUrl(pack.source, pack.folder, person.head).then((u) => { img.src = u; }).catch(() => img.remove());
      const choose = h("button", { type: "button", class: "lib-choose", text: "Choose", "aria-label": `Choose ${person.name} from ${pack.title}` });
      choose.addEventListener("click", () => finish({ pack, person }));
      return h("li", { class: "lib-person" }, img,
        h("div", { class: "lib-body" },
          h("p", {}, h("strong", { text: person.name }), person.role ? ` (${person.role})` : ""),
          h("p", { class: "lib-alt", text: person.alt }),
          choose));
    };

    const packSection = (pack: Pack, i: number): HTMLElement => {
      const heading = h("h3", { id: `lib-pack-${i}`, text: `${pack.title}` });
      const about = h("p", { class: "note", text: `${pack.description ? `${pack.description} ` : ""}${creditLine(pack)} ${whereFrom(pack)}, version ${pack.version}.` });
      const people = h("ul", { class: "lib-people", "aria-labelledby": `lib-pack-${i}` }, ...pack.people.map((p) => personCard(pack, p)));
      const kids: HTMLElement[] = [heading, about, people];
      if (pack.source === "yours") {
        const remove = h("button", { type: "button", class: "lib-remove", text: "Remove this pack", "aria-label": `Remove the pack ${pack.title}` });
        remove.addEventListener("click", async () => {
          if (armed !== pack.id) {
            armed = pack.id;
            remove.textContent = "Press again to remove this pack";
            status.textContent = `Press the button again to take away the pack "${pack.title}". People already in your cast keep their pictures.`;
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
            await refresh("lib-add");
            status.textContent = `Removed the pack "${pack.title}". ${status.textContent}`;
            opts.announce(`Removed the pack ${pack.title}.`);
          } catch (err) {
            failure.textContent = errorText(err);
          }
        });
        kids.push(h("div", { class: "btn-row" }, remove));
      }
      return h("section", { class: "lib-pack", "aria-labelledby": `lib-pack-${i}` }, ...kids);
    };

    const count = () => {
      const shown = packsWithPeople(state.packs);
      const people = shown.reduce((n, p) => n + p.people.length, 0);
      return shown.length === 0
        ? "There are no character packs on this computer yet. Add one from a zip file."
        : `${people} ${people === 1 ? "person" : "people"} in ${shown.length} ${shown.length === 1 ? "pack" : "packs"}.`;
    };

    const draw = (focusId?: string) => {
      // A pack of backgrounds alone has no one to choose; it is in the background picker.
      list.replaceChildren(...packsWithPeople(state.packs).map(packSection));
      if (state.broken.length > 0) {
        list.append(h("div", { class: "lib-broken", role: "group", "aria-label": "Packs that cannot be used" },
          h("h3", { text: "Packs that cannot be used" }),
          h("ul", {}, ...state.broken.map((x) => h("li", { text: `${x.folder}: ${x.message}` })))));
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
    status.textContent = "Looking for character packs...";
    dialog.showModal();
    add.focus();
    void refresh().then(() => {
      // Put focus on the first person, so choosing is one key away; if there is none, or the author has already moved on, it stays where it is.
      if (document.activeElement === add) (dialog.querySelector(".lib-choose") as HTMLElement | null)?.focus();
    });
  });
}
