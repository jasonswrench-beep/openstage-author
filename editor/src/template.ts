// What a brand-new project contains. It is a valid project from the first moment: it has a theme,
// and one slide made from the Title Slide layout with the project's title on it.

import type { Theme } from "../../player/src/types.ts";
import { canonical, type FileText } from "./model.ts";
import { buildLayoutSlide, SLIDE_LAYOUTS, type Alloc } from "./factory.ts";
import { DEFAULT_THEME } from "./themes.ts";

export interface NewProjectInput {
  title: string;
  author: string;
  language: string;
  /** YYYY-MM-DD */
  today: string;
  /** The theme to start with. Classic if none is given. */
  theme?: Theme;
}

const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** A message for the author if the details are not usable, otherwise null. */
export function checkNewProject(i: Pick<NewProjectInput, "title" | "language">): string | null {
  if (i.title.trim() === "") return "Enter a title for the project.";
  if (!LANGUAGE.test(i.language.trim())) return "Language must be a code such as en-US or fr-CA.";
  return null;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function newProjectFiles(input: NewProjectInput): FileText[] {
  const title = input.title.trim();
  const author = input.author.trim();
  const theme = input.theme ?? DEFAULT_THEME;
  const project = {
    schemaVersion: "0.47.0",
    meta: { title, author, language: input.language.trim(), created: input.today, modified: input.today },
    stage: { width: 1280, height: 720 },
    variables: [],
    theme: { ref: "theme.json" },
    credits: true,
    completion: { slides: "all" },
    scenes: [{ id: "scene-main", name: "Main", slides: ["slide-001"] }],
  };

  let n = 0;
  const alloc: Alloc = { object: () => `obj-${String(++n).padStart(4, "0")}`, layer: () => "layer-1" };
  const slide = buildLayoutSlide(SLIDE_LAYOUTS.find((l) => l.id === "title")!, "slide-001", alloc);
  slide.name = "Title slide";
  for (const o of slide.baseLayer.objects) {
    if (o.name === "Title") {
      o.content = { html: `<h1>${escapeHtml(title)}</h1>` };
      o.accessibility = { ...o.accessibility, altText: title };
    } else if (o.name === "Subtitle" && author) {
      o.content = { html: `<p>${escapeHtml(author)}</p>` };
      o.accessibility = { ...o.accessibility, altText: author };
    }
  }
  return [
    { path: "project.json", text: canonical(project) },
    { path: "theme.json", text: canonical(theme) },
    { path: "slides/slide-001.json", text: canonical(slide) },
  ];
}
