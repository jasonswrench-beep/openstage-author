// SPDX-License-Identifier: Apache-2.0
/**
 * The editing screens together: the timeline above and the clip list below, on one session, sharing one line of
 * announcements. F6 and Shift+F6 move between the two (region cycling, as OpenStage's own panels do).
 */

import { Announcer } from "./announcer.ts";
import { h } from "./dom.ts";
import { mountCalloutBar, type AddMedia, type CalloutBar } from "./callout-panel.ts";
import { mountItemForm, type ItemFormPanel } from "./item-form.ts";
import { mountClipList, type ClipListPanel } from "./panel.ts";
import { EMPTY_LIBRARY, type MediaLibrary } from "./project.ts";
import { mountPreview, type PreviewPanel } from "./preview-panel.ts";
import type { EditSession } from "./session.ts";
import { mountTimeline, type TimelinePanel } from "./timeline-panel.ts";

export interface EditorOptions {
  /** Also tell this function every message. */
  announce?: (message: string) => void;
  /** How the rows of the clip list are named for a screen reader. */
  rows?: "sentence" | "cells";
  /** The recordings the preview plays. Without it the preview shows placeholders. */
  library?: MediaLibrary;
  /** Start with the clip list and its form open at the side. They are closed by default so the picture and the timeline have the room. */
  listOpen?: boolean;
  /** How a picture, video or sound is chosen and brought into the course. Without it the buttons for files are left out. */
  addMedia?: AddMedia;
}

export interface Editor {
  readonly element: HTMLElement;
  readonly preview: PreviewPanel;
  readonly timeline: TimelinePanel;
  readonly list: ClipListPanel;
  readonly callouts: CalloutBar;
  readonly itemForm: ItemFormPanel;
  readonly announcer: Announcer;
  /** Put keyboard focus on the timeline. */
  focus(): void;
  announce(message: string): void;
  destroy(): void;
}

export function mountEditor(container: HTMLElement, session: EditSession, options: EditorOptions = {}): Editor {
  const announcer = new Announcer(options.announce);
  const previewHost = h("div", { class: "os-ed-preview" });
  const calloutHost = h("div", { class: "os-ed-callouts" });
  const timelineHost = h("div", { class: "os-ed-timeline" });
  const listHost = h("div", { class: "os-ed-list" });
  const propertiesButton = h("button", { type: "button", class: "os-cl-button", "aria-expanded": "false", "aria-controls": "os-ed-list" }, "Properties and clip list");
  const bar = h("div", { class: "os-ed-bar", role: "group", "aria-label": "Editing screens" }, propertiesButton);
  listHost.id = "os-ed-list";
  listHost.hidden = !(options.listOpen ?? false);
  propertiesButton.setAttribute("aria-expanded", listHost.hidden ? "false" : "true");
  const root = h("div", { class: "os-ed" }, announcer.element, bar, previewHost, calloutHost, timelineHost, listHost);
  container.append(root);

  /** Show or hide the clip list and its form. Whatever sends focus to the list opens it first, so focus is never sent to something hidden. */
  const setListOpen = (open: boolean): void => {
    listHost.hidden = !open;
    propertiesButton.setAttribute("aria-expanded", open ? "true" : "false");
  };
  const openList = (): void => { if (listHost.hidden) setListOpen(true); };
  propertiesButton.addEventListener("click", () => {
    const open = Boolean(listHost.hidden); // it is closed now, so this press opens it
    setListOpen(open);
    announcer.say(open ? "Properties and clip list opened." : "Properties and clip list closed.");
    if (open) list.focus();
  });

  // The form for a chosen overlay or zoom sits above the clip list in the same panel.
  const itemHost = h("div", { class: "os-ed-item" });
  listHost.append(itemHost);
  const itemForm = mountItemForm(itemHost, session, { announcer, leave: () => timeline.focus() });
  const list = mountClipList(listHost, session, { announcer, playhead: false, ...(options.rows === undefined ? {} : { rows: options.rows }), title: "Clip list" });
  const timeline = mountTimeline(timelineHost, session, {
    announcer,
    onEdit: () => { openList(); if (!itemForm.focus()) list.focusDetails(); },
    ...(options.library === undefined ? {} : { library: options.library }),
  });
  /** Something was added to the picture: show its form and put focus in the first box that needs filling in. */
  const showAdded = (): void => {
    openList();
    if (!itemForm.focus()) list.focusDetails();
  };
  const preview = mountPreview(previewHost, session, options.library ?? EMPTY_LIBRARY, { announcer, onAdded: showAdded });
  const callouts = mountCalloutBar(calloutHost, session, {
    announcer,
    drawZoom: () => preview.toggleDrawZoom(),
    onDrawingChange: (fn) => preview.onDrawingChange(fn),
    onAdded: showAdded,
    ...(options.addMedia === undefined ? {} : { addMedia: options.addMedia }),
  });

  const regions = [
    { name: "Preview", element: preview.element, focus: () => preview.focus() },
    { name: "Timeline", element: timeline.element, focus: () => timeline.focus() },
    { name: "Clip list", element: list.element, focus: () => { openList(); list.focus(); } },
  ];

  // F6 and Shift+F6 move between the regions, and say which one they arrived in.
  root.addEventListener("keydown", (e) => {
    if (e.key !== "F6" || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    const here = regions.findIndex((r) => r.element.contains(document.activeElement));
    const next = regions[(here + (e.shiftKey ? -1 : 1) + regions.length) % regions.length];
    if (next === undefined) return;
    next.focus();
    announcer.say(`${next.name}.`);
  });

  return {
    element: root,
    preview,
    timeline,
    list,
    callouts,
    itemForm,
    announcer,
    focus: () => timeline.focus(),
    announce: (message) => announcer.say(message),
    destroy(): void {
      preview.destroy();
      callouts.destroy();
      timeline.destroy();
      itemForm.destroy();
      list.destroy();
      announcer.destroy();
      root.remove();
    },
  };
}
