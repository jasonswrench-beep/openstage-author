// The Properties panel's three tabs (design spec, mockup A02: "Content / Style / Behavior tabs are groups of existing property fields, not
// new properties"). Content is what the learner reads, hears and is told: words, pictures, answers, narration, alt text. Style is how it
// looks and where it sits: appearance, looks, position and size, lining up. Behaviour is when it comes and goes and what it does: timing,
// animation, rules, a question's scoring and feedback. A tab with nothing in it is left out. The tab chosen is kept from one object to the
// next, so someone setting the timing of several objects in turn stays on Behaviour. The tabs follow the ARIA tabs pattern: the row is one
// Tab stop, and Left, Right, Home and End move along it and show the tab they reach.
//
// Inside a tab each group is a section that opens and closes (Jason, 2026-11-10: "have all the major headings listed, but you only see
// the parts under when you click on one of the headings"), with an icon beside its name. The first section of a tab starts open; a section
// the person opens or closes stays that way for every object. Which tab and which sections show is pure and tested here (propstabs.test.ts);
// the panel was driven in the browser preview.

import { el, uiIcon } from "./menubar.ts";
import type { UiIconName } from "./uiicons.gen.ts";

export type PropsTab = "content" | "style" | "behaviour";

export const PROPS_TABS: readonly { id: PropsTab; label: string }[] = [
  { id: "content", label: "Content" },
  { id: "style", label: "Style" },
  { id: "behaviour", label: "Behaviour" },
];

/** The tabs that have something in them, in their order. */
export function tabsWith(sections: Partial<Record<PropsTab, readonly unknown[]>>): PropsTab[] {
  return PROPS_TABS.map((t) => t.id).filter((id) => (sections[id]?.length ?? 0) > 0);
}

/** The tab to show: the one chosen, if it is there; otherwise the first there is. Null when there is none. */
export function tabToShow(available: readonly PropsTab[], chosen: PropsTab): PropsTab | null {
  if (available.length === 0) return null;
  return available.includes(chosen) ? chosen : available[0]!;
}

/** The tab a key moves to from `at`, or null for a key that does not move along the row. Left and Right go round, as in the menu row. */
export function tabAfterKey(available: readonly PropsTab[], at: PropsTab, key: string): PropsTab | null {
  const i = available.indexOf(at);
  if (i < 0) return null;
  switch (key) {
    case "ArrowRight": return available[(i + 1) % available.length]!;
    case "ArrowLeft": return available[(i - 1 + available.length) % available.length]!;
    case "Home": return available[0]!;
    case "End": return available[available.length - 1]!;
    default: return null;
  }
}

/** What the badge beside the Properties heading calls an object of each type, in the words of the Insert menu. */
const KIND_NAMES: Record<string, string> = {
  text: "Text box", image: "Image", shape: "Shape", button: "Button", hotspot: "Hotspot", video: "Video", audio: "Audio",
  quizQuestion: "Question", interaction: "Interaction", table: "Table", scrollingText: "Scrolling text", input: "Input",
  embed: "Online video", results: "Results", certificate: "Certificate", download: "File to download", scenario: "Scenario",
  icon: "Icon", timer: "Timer",
};

/** The badge's words for an object's type. A type the list does not know is shown as it is. */
export function kindName(type: string): string {
  return KIND_NAMES[type] ?? type;
}

/** A section's name without its numbers or what follows a colon, so "Situation 2 of 3: Late again" and "Situation 1 of 3: ..." are one. */
export function sectionName(legend: string): string {
  return (legend.split(":")[0] ?? "").replace(/\d+/g, "N").replace(/\s+/g, " ").trim();
}

/** The icon beside each section's heading (design/icons.json, "Properties panel"). A section the list does not know gets a plain list. */
const SECTION_ICONS: Record<string, UiIconName> = {
  // Content
  "Content": "file-text", "Narration": "mic", "Narration on this slide": "mic", "Accessibility": "accessibility",
  "Slide": "presentation", "Layer": "layers", "Picture": "image", "Picture box": "image", "Chart picture box": "image",
  "Video": "video", "YouTube video": "video", "Vimeo video": "video", "Audio": "volume-2", "Audio description": "audio-lines",
  "File to download": "download", "Timer": "timer", "Table": "table", "Results": "chart-column", "Certificate": "award",
  "Icon": "shapes", "Scenario": "messages-square", "Meters": "gauge", "Situations": "git-branch", "Situation N of N": "git-branch",
  "Items": "list", "Place the markers": "map-pin", "Answers": "list-checks", "People to choose between": "users", "Course details": "badge-info",
  // Style
  "Appearance": "palette", "Looks": "swatch-book", "Position and size": "move", "Position and size of the group": "move",
  "Line up with the slide": "align-horizontal-justify-center", "Line up": "align-horizontal-justify-center",
  "Space out evenly": "align-horizontal-space-around", "Group": "group", "Design": "layout-template",
  // Behaviour
  "Timing": "clock", "Timing, for all N": "clock", "Paragraph by paragraph": "pilcrow", "Animation": "sparkles",
  "Animation, for all N": "sparkles", "Slide animation": "sparkles", "Rules": "zap", "Scoring": "badge-check",
  "Feedback layers": "message-square", "Behaviour": "settings-2", "Moving through the course": "route", "Course": "graduation-cap",
};

/** The icon for a section's heading. */
export function sectionIcon(legend: string): UiIconName {
  return SECTION_ICONS[sectionName(legend)] ?? "list";
}

/** Whether a section starts open: as the person left it, if they have opened or closed it; otherwise only the first in its tab. */
export function sectionOpen(remembered: boolean | undefined, index: number): boolean {
  return remembered ?? index === 0;
}

/** How the panel lays out its sections, and what it tells the editor. */
export interface TabbedOptions {
  /** The tab the person chose last. */
  chosen: PropsTab;
  /** The id of the panel's heading, which names the row of tabs. */
  labelledBy: string;
  /** Told when the person chooses another tab with a click or a key. */
  onChoose(tab: PropsTab): void;
  /** Whether the person left a section open (true) or closed (false); undefined if they have not touched it. */
  remembered(key: string): boolean | undefined;
  /** Told when a section is opened or closed, by the person or because focus is sent into it. */
  onToggle(key: string, open: boolean): void;
}

/** The panel's sections laid out under tabs, and ways to show a tab or what is in it. */
export interface TabbedSections {
  /** What goes in the panel: the row of tabs in its strip (when there are two or more tabs) and a panel for each tab. */
  nodes: HTMLElement[];
  /** Show a tab, if it is there. */
  show(tab: PropsTab): void;
  /** Show the tab a node is in and open the section around it, so focus can go there. The tab, or null if the node is in none. */
  reveal(node: Node): PropsTab | null;
}

/**
 * Lay the sections out under tabs. Each group in a tab (a fieldset with its legend) becomes a section that opens and closes: its heading
 * is a button with an icon, its name and a chevron, which says whether it is expanded, and its boxes are hidden while it is closed (the
 * ARIA disclosure pattern; the legend still names the group). Choosing a tab scrolls the panel back to its top, so the new tab is read
 * from its start.
 */
export function tabbedSections(doc: Document, sections: Partial<Record<PropsTab, HTMLElement[]>>, opts: TabbedOptions): TabbedSections {
  const available = tabsWith(sections);
  const first = tabToShow(available, opts.chosen);
  const panels = new Map<PropsTab, HTMLElement>();
  const tabs = new Map<PropsTab, HTMLButtonElement>();
  const folds: { body: HTMLElement; open(): void }[] = [];
  for (const id of available) {
    const panel = el(doc, "div", { class: "props-tabpanel", "data-props-tab": id }, ...sections[id]!);
    folds.push(...foldSections(doc, panel, id, opts));
    panels.set(id, panel);
  }
  const show = (tab: PropsTab) => {
    if (!panels.has(tab)) return;
    for (const [id, panel] of panels) panel.hidden = id !== tab;
    for (const [id, button] of tabs) {
      button.setAttribute("aria-selected", String(id === tab));
      button.tabIndex = id === tab ? 0 : -1;
    }
  };
  const reveal = (node: Node): PropsTab | null => {
    let tab: PropsTab | null = null;
    for (const [id, panel] of panels) if (panel.contains(node)) tab = id;
    if (!tab) return null;
    show(tab);
    for (const f of folds) if (f.body.contains(node)) f.open();
    return tab;
  };
  if (available.length < 2) {
    if (first) show(first);
    return { nodes: [...panels.values()], show, reveal };
  }
  const row = el(doc, "div", { class: "props-tabs", role: "tablist", "aria-labelledby": opts.labelledBy });
  const choose = (tab: PropsTab, focus: boolean) => {
    show(tab);
    if (focus) tabs.get(tab)?.focus();
    const scroller = row.closest<HTMLElement>(".panel");
    if (scroller) scroller.scrollTop = 0;
    opts.onChoose(tab);
  };
  for (const t of PROPS_TABS) {
    const panel = panels.get(t.id);
    if (!panel) continue;
    const tabId = `props-tab-${t.id}`;
    const panelId = `props-panel-${t.id}`;
    panel.id = panelId;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tabId);
    const button = el(doc, "button", { type: "button", class: "props-tab", role: "tab", id: tabId, "aria-controls": panelId, "data-key": `props-tab:${t.id}`, text: t.label });
    button.addEventListener("click", () => choose(t.id, false));
    button.addEventListener("keydown", (e) => {
      const next = tabAfterKey(available, t.id, e.key);
      if (!next || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      choose(next, true);
    });
    tabs.set(t.id, button);
    row.append(button);
  }
  show(first!);
  // The row sits in a strip that stays at the top of the panel while it scrolls.
  const bar = el(doc, "div", { class: "props-tabbar" }, row);
  return { nodes: [bar, ...panels.values()], show, reveal };
}

/** Make each group in a tab's panel a section that opens and closes. Returns a way to open each one. */
function foldSections(doc: Document, panel: HTMLElement, tab: PropsTab, opts: TabbedOptions): { body: HTMLElement; open(): void }[] {
  const out: { body: HTMLElement; open(): void }[] = [];
  for (const group of Array.from(panel.children)) {
    const legend = group.tagName === "FIELDSET" ? group.firstElementChild : null;
    if (!legend || legend.tagName !== "LEGEND") continue;
    const index = out.length;
    const text = legend.textContent ?? "";
    const key = `${tab}:${sectionName(text)}`;
    const body = el(doc, "div", { class: "props-section-body", id: `props-sec-${tab}-${index}` });
    while (legend.nextSibling) body.append(legend.nextSibling);
    group.append(body);
    // A legend with an id is changed in place by the editor (a scenario's situation), so the words keep that id.
    const name = el(doc, "span", { class: "props-section-name", text });
    if (legend.id) {
      name.id = legend.id;
      legend.removeAttribute("id");
    }
    const chevron = uiIcon(doc, "chevron-down");
    chevron.classList.add("props-chevron");
    const button = el(doc, "button", { type: "button", class: "props-section-toggle", "aria-controls": body.id, "data-key": `props-sec:${key}` }, uiIcon(doc, sectionIcon(text)), name, chevron);
    legend.replaceChildren(button);
    group.classList.add("props-section");
    const set = (open: boolean) => {
      body.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      group.classList.toggle("open", open);
    };
    set(sectionOpen(opts.remembered(key), index));
    button.addEventListener("click", () => {
      const open = body.hidden;
      set(open);
      opts.onToggle(key, open);
    });
    out.push({ body, open: () => { if (body.hidden) { set(true); opts.onToggle(key, true); } } });
  }
  return out;
}
