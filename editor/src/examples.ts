// The example projects the welcome page offers. The program finds which ones came with it (examplesList in backend.ts); this list
// says the order they are shown in, a line about each, and its icon. Opening one makes a copy in a folder the author chooses, so the
// example stays as it came and the author's changes are their own (design spec A01: examples are "clearly labeled examples rather
// than appearing as user-owned files"). A test checks each one is in the examples folder and in the installer's list.

import type { UiIconName } from "./uiicons.gen.ts";

/** What the program says about an example it found: its folder's name, the course title, and how many slides it has. */
export interface ExampleInfo {
  name: string;
  title: string;
  slides: number;
}

export interface ExampleCard {
  /** The example's folder in examples/, for example "question-types.osproj". */
  name: string;
  icon: UiIconName;
  /** One line about what it shows. */
  about: string;
}

/** In the order shown: a whole short lesson first, then one thing each, with the four games together. */
export const EXAMPLE_CARDS: readonly ExampleCard[] = [
  { name: "lesson-parts.osproj", icon: "book-open-text", about: "A short lesson made from the ready-made slides: a welcome, objectives, a conversation, a knowledge check and a summary." },
  { name: "question-types.osproj", icon: "list-checks", about: "One slide for each kind of question, and a slide of results." },
  { name: "interactions.osproj", icon: "mouse-pointer-click", about: "Tabs, flip cards, an accordion, a timeline and the other ready-made interactions." },
  { name: "scenario.osproj", icon: "messages-square", about: "A short scenario: choose who you will be, then talk a late report over with Maya." },
  // Every ready-made game, finished, so there is something to play at once.
  { name: "quiz-board.osproj", icon: "grid-3x3", about: "A board of nine questions in three categories: pick a tile, answer, and come back to the board." },
  { name: "prize-ladder.osproj", icon: "trophy", about: "Eight questions that are worth more as you climb the ladder." },
  { name: "escape-room.osproj", icon: "door-open", about: "Three rooms to search for the clues to the code that opens each door." },
  { name: "order-challenge.osproj", icon: "list-ordered", about: "Four rounds of putting steps in the right order, from a fire drill to a team meeting." },
  { name: "branching.osproj", icon: "split", about: "A choice that leads to a short path or a long one." },
  { name: "timed-media.osproj", icon: "clapperboard", about: "Notes that come and go in time with a video and a sound." },
  { name: "looks.osproj", icon: "wand-sparkles", about: "Buttons and steps that change how they look when the learner does something." },
  { name: "minimal.osproj", icon: "file-text", about: "The smallest course: a welcome slide and a knowledge check." },
];

/** What the program said it found, keeping only entries that make sense. */
export function parseExamples(raw: unknown): ExampleInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): ExampleInfo[] => {
    if (typeof item !== "object" || item === null) return [];
    const r = item as Record<string, unknown>;
    const name = typeof r["name"] === "string" ? r["name"] : "";
    if (!/^[a-z0-9-]+\.osproj$/.test(name)) return [];
    const slides = typeof r["slides"] === "number" && Number.isFinite(r["slides"]) ? Math.max(0, Math.round(r["slides"])) : 0;
    return [{ name, title: typeof r["title"] === "string" ? r["title"] : "", slides }];
  });
}

/** The examples to show: the ones in the list that the program found, in the list's order, with what the program found out. */
export function examplesToShow(found: readonly ExampleInfo[]): (ExampleCard & ExampleInfo)[] {
  return EXAMPLE_CARDS.flatMap((card) => {
    const info = found.find((f) => f.name === card.name);
    return info ? [{ ...card, ...info, title: info.title.trim() === "" ? card.name.replace(/\.osproj$/, "") : info.title }] : [];
  });
}
