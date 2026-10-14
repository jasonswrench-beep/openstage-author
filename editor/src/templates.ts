// Ready-made lesson slides: whole slides with their parts already working, offered beside the layouts when a slide is added. A layout only
// places text. A template also adds the things a lesson slide needs: Next and Back buttons that are already wired, a quiz question with its
// feedback, a scenario, an accordion. Everything an author has to write (the words, the question, the story) is a placeholder, and nothing
// a screen reader depends on is filled in on the author's behalf.
//
// A template is only a way to start. The slide it makes is an ordinary slide: it is not tied to the template afterwards, and no format
// change was needed.

import type { Layer, OSObject } from "../../player/src/types.ts";
import {
  accent, body, buildQuiz, heading, interactionById, layOut, NAVIGATION_BUTTONS, newInteraction, newNavigationButton, newScenario,
  type Alloc, type NavigationButton, type PreviewBlock, type SlideLayout, type Tone,
} from "./factory.ts";
import { newScenarioContent } from "./scenarioedit.ts";

export interface SlideTemplate {
  id: string;
  label: string;
  description: string;
  /** The slide's name when first added. */
  name: string;
  /** The text it holds and what it sits on. It is also what the picker draws, with `extras` for the parts that are not text. */
  layout: SlideLayout;
  /** Boxes the picker draws for the parts that are not text: buttons, a question, a scenario. */
  extras: PreviewBlock[];
  /** Make the parts of the slide. Ids come from the project, so they never clash with anything. */
  build(alloc: Alloc): { objects: OSObject[]; layers: Layer[] };
}

const button = (id: NavigationButton["id"], label?: string): NavigationButton => ({ ...NAVIGATION_BUTTONS.find((b) => b.id === id)!, ...(label ? { label } : {}) });

/** Put a ready-made button on the slide at a place and size. */
function navButton(alloc: Alloc, choice: NavigationButton, rect: [number, number, number, number], z: number): OSObject {
  const o = newNavigationButton(choice, { id: alloc.object(), count: 0, z, tabOrder: 1 });
  o.geometry = { ...o.geometry, x: rect[0], y: rect[1], width: rect[2], height: rect[3] };
  return o;
}

/**
 * Give the objects that can be reached their tab order by where they are on the slide: top to bottom, then left to right. That is the
 * order they are read in, and it is the order the eye takes them in.
 */
export function renumber(objects: OSObject[]): OSObject[] {
  const reachable = objects.filter((o) => !o.accessibility.decorative && (o.accessibility.tabOrder ?? 0) >= 1);
  reachable.sort((a, b) => a.geometry.y - b.geometry.y || a.geometry.x - b.geometry.x);
  reachable.forEach((o, i) => { o.accessibility = { ...o.accessibility, tabOrder: i + 1 }; });
  return objects;
}

const BACK_NEXT = (alloc: Alloc, z = 200): OSObject[] => [
  navButton(alloc, button("previous"), [80, 640, 160, 56], z),
  navButton(alloc, button("next"), [1040, 640, 160, 56], z + 1),
];
const BACK_NEXT_PREVIEW: PreviewBlock[] = [{ kind: "button", rect: [80, 640, 160, 56] }, { kind: "button", rect: [1040, 640, 160, 56] }];

const TITLE_44 = (text: string) => heading("Title", text, [80, 48, 1120, 80], 44);
const RULE = accent([80, 136, 160, 6]);

const welcome: SlideTemplate = {
  id: "welcome", label: "Welcome", name: "Welcome", description: "A title, one line about the course, and a Begin button that goes to the next slide.",
  layout: { id: "template-welcome", group: "Lesson slides", label: "Welcome", description: "", name: "Welcome", tone: "dark", background: "theme:bg.dark",
    slots: [heading("Title", "Welcome to the course", [80, 220, 1120, 110], 56), body("Subtitle", "Say in one sentence what this course is about.", [80, 350, 1120, 70], 28, "p", true)],
    decorations: [accent([80, 190, 160, 8])] },
  extras: [{ kind: "button", rect: [80, 470, 200, 56] }],
  build(alloc) {
    const objects = layOut(this.layout, alloc).objects;
    objects.push(navButton(alloc, button("next", "Begin"), [80, 470, 200, 56], 200));
    return { objects: renumber(objects), layers: [] };
  },
};

const objectives: SlideTemplate = {
  id: "objectives", label: "Objectives", name: "Objectives", description: "What the learner will be able to do, with Back and Next buttons.",
  layout: { id: "template-objectives", group: "Lesson slides", label: "Objectives", description: "", name: "Objectives",
    slots: [TITLE_44("What you will learn"), body("Introduction", "By the end of this lesson you will be able to:", [80, 170, 1120, 60], 26, "p", true), body("Content", "List your objectives here.", [80, 250, 1120, 360], 28)],
    decorations: [RULE] },
  extras: BACK_NEXT_PREVIEW,
  build(alloc) {
    const objects = layOut(this.layout, alloc).objects;
    objects.push(...BACK_NEXT(alloc));
    return { objects: renumber(objects), layers: [] };
  },
};

const knowledgeCheck: SlideTemplate = {
  id: "knowledge-check", label: "Knowledge check", name: "Knowledge check", description: "A multiple choice question with feedback for a right answer and for a wrong one, already wired.",
  layout: { id: "template-check", group: "Lesson slides", label: "Knowledge check", description: "", name: "Knowledge check", slots: [], decorations: [] },
  extras: [{ kind: "title", rect: [80, 60, 1120, 90] }, { kind: "panel", rect: [80, 170, 700, 300] }, { kind: "panel", rect: [840, 170, 360, 160] }],
  build(alloc) {
    const built = buildQuiz("mc", alloc, { y: 60, z: 10, tab: 1, tone: "light" });
    return { objects: renumber(built.objects), layers: built.layers };
  },
};

const scenario: SlideTemplate = {
  id: "scenario", label: "Scenario", name: "Scenario", description: "A heading and a branching story to write, with Back and Next buttons. Add people in Characters to have them speak.",
  layout: { id: "template-scenario", group: "Lesson slides", label: "Scenario", description: "", name: "Scenario",
    slots: [heading("Title", "Try it", [80, 24, 1120, 64], 36)], decorations: [] },
  extras: [{ kind: "panel", rect: [80, 100, 1120, 520] }, ...BACK_NEXT_PREVIEW],
  build(alloc) {
    const objects = layOut(this.layout, alloc).objects;
    const s = newScenario({ id: alloc.object(), count: 0, z: 20, tabOrder: 1 }, newScenarioContent());
    s.geometry = { ...s.geometry, x: 80, y: 100, width: 1120, height: 520 };
    objects.push(s, ...BACK_NEXT(alloc));
    return { objects: renumber(objects), layers: [] };
  },
};

const summary: SlideTemplate = {
  id: "summary", label: "Summary", name: "Summary", description: "The main points to take away, with a Back button.",
  layout: { id: "template-summary", group: "Lesson slides", label: "Summary", description: "", name: "Summary",
    slots: [TITLE_44("Summary"), body("Introduction", "The main points to take away:", [80, 170, 1120, 60], 26, "p", true), body("Key points", "Write the main points here.", [80, 250, 1120, 360], 28)],
    decorations: [RULE] },
  extras: [{ kind: "button", rect: [80, 640, 160, 56] }],
  build(alloc) {
    const objects = layOut(this.layout, alloc).objects;
    objects.push(navButton(alloc, button("previous"), [80, 640, 160, 56], 200));
    return { objects: renumber(objects), layers: [] };
  },
};

const resources: SlideTemplate = {
  id: "resources", label: "Resources", name: "Resources", description: "A heading and an accordion for readings, links and tips, with Back and Next buttons.",
  layout: { id: "template-resources", group: "Lesson slides", label: "Resources", description: "", name: "Resources", slots: [TITLE_44("Resources")], decorations: [RULE] },
  extras: [{ kind: "panel", rect: [80, 170, 1120, 440] }, ...BACK_NEXT_PREVIEW],
  build(alloc) {
    const objects = layOut(this.layout, alloc).objects;
    const choice = interactionById("accordion:vertical")!;
    const a = newInteraction(choice, { id: alloc.object(), count: 0, z: 20, tabOrder: 1 });
    a.geometry = { ...a.geometry, x: 80, y: 170, width: 1120, height: 440 };
    a.accessibility = { ...a.accessibility, altText: "Resources" };
    objects.push(a, ...BACK_NEXT(alloc));
    return { objects: renumber(objects), layers: [] };
  },
};

export const SLIDE_TEMPLATES: SlideTemplate[] = [welcome, objectives, knowledgeCheck, scenario, resources, summary];

export function templateById(id: string): SlideTemplate | undefined {
  return SLIDE_TEMPLATES.find((t) => t.id === id);
}

/** The picker returns "template:<id>" for a template, and a layout's own id for a layout. */
export const TEMPLATE_PREFIX = "template:";

/** What a template's slide sits on, for the preview and for the slide. */
export function templateTone(t: SlideTemplate): Tone {
  return t.layout.tone ?? "light";
}
