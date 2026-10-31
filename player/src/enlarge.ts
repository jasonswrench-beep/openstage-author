// Enlarging a picture (an image object whose content has `enlargeable: true`, added in 0.43.0). The picture gets an "Enlarge"
// button that opens it in a pop-up as big as the window allows, with a button to see it at its own size and scroll round it.
// It is for a learner who wants a closer look at a diagram or a photograph, and it does not move anything on the slide.
//
// The pop-up is a real <dialog> opened with showModal(), so Escape closes it, focus stays inside it, and focus goes back to the
// Enlarge button when it closes. The button says which picture it is for ("Enlarge picture: Chart of the four channels"), so a
// screen reader's list of buttons is not a list of identical ones.

import type { OSObject } from "./types.ts";

/** What the Enlarge button is called to a screen reader. Its visible words, "Enlarge", are the start of it. */
export function enlargeName(alt: string): string {
  const words = alt.trim();
  return words === "" ? "Enlarge picture" : `Enlarge picture: ${words}`;
}

/** What the pop-up is called to a screen reader. */
export function enlargedName(alt: string): string {
  const words = alt.trim();
  return words === "" ? "Enlarged picture" : `Enlarged picture: ${words}`;
}

function make(doc: Document, tag: string, cls: string, text = ""): HTMLElement {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/**
 * The picture, inside a box that also holds the Enlarge button and its pop-up. The box takes the picture's place on the slide, so
 * the object is positioned, timed and animated as any picture is. `img` is the picture the stage has already made.
 */
export function buildEnlargeablePicture(doc: Document, img: HTMLImageElement, obj: OSObject): HTMLElement {
  const alt = obj.accessibility.altText;
  // The box is the object now; the picture inside it only fills it.
  const box = make(doc, "div", "os-image os-image-box");
  img.className = "os-image-in";

  const open = make(doc, "button", "os-enlarge", "Enlarge") as HTMLButtonElement;
  open.type = "button";
  open.setAttribute("aria-haspopup", "dialog");
  open.setAttribute("aria-label", enlargeName(alt));

  const dialog = make(doc, "dialog", "os-enlarge-dialog") as HTMLDialogElement;
  dialog.setAttribute("aria-label", enlargedName(alt));
  const size = make(doc, "button", "os-nav-btn", "Actual size") as HTMLButtonElement;
  size.type = "button";
  const close = make(doc, "button", "os-nav-btn", "Close") as HTMLButtonElement;
  close.type = "button";
  const bar = make(doc, "div", "os-enlarge-bar");
  bar.append(size, close);

  const view = make(doc, "div", "os-enlarge-view");
  const big = make(doc, "img", "os-enlarge-img") as HTMLImageElement;
  big.alt = alt;
  view.appendChild(big);
  dialog.append(bar, view);

  let actual = false;
  const show = (): void => {
    dialog.classList.toggle("os-enlarge-actual", actual);
    size.textContent = actual ? "Fit to window" : "Actual size";
    // At its own size a picture can be bigger than the window. The scrolling part has to be reachable by the keyboard, and say what it is.
    if (actual) {
      view.tabIndex = 0;
      view.setAttribute("role", "region");
      view.setAttribute("aria-label", "The picture at its own size. Use the arrow keys to move around it.");
    } else {
      view.removeAttribute("tabindex");
      view.removeAttribute("role");
      view.removeAttribute("aria-label");
    }
  };

  open.addEventListener("click", () => {
    big.src = img.src;
    actual = false;
    show();
    dialog.showModal();
  });
  size.addEventListener("click", () => {
    actual = !actual;
    show();
  });
  close.addEventListener("click", () => dialog.close());
  // A click on the dim area round the picture closes it, for a mouse. Escape and the Close button are the routes for everyone else.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  box.append(img, open, dialog);
  return box;
}
