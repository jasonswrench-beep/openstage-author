// Sections of a course: the named groups of slides a project already keeps (`scenes` in project.json; the course plays them one after
// another, so they change nothing a learner sees). The editor shows them in the Slides panel once there are two or more, each with a
// heading that opens and closes, so a long course is easy to find your way round (feedback from people who tried Author, 2026-11-10).
// A section can be made starting at a slide, renamed, moved, removed (its slides join the section before it), and sorted A to Z or by
// the order its slides were made. Everything here works on a copy of the list and says what it did, so it is tested without a screen
// (sections.test.ts); the Model makes each one undo step.

export interface Section {
  id: string;
  name: string;
  slides: string[];
}

/** What a change gives back: the new list and a sentence for the author, or the reason it was not done. */
export type SectionResult = { ok: true; sections: Section[]; message: string } | { ok: false; message: string };

/** The longest name a section can have. */
export const SECTION_NAME_MAX = 80;

const copy = (sections: readonly Section[]): Section[] => sections.map((s) => ({ ...s, slides: [...s.slides] }));

/** The section a slide is in. */
export function sectionOf(sections: readonly Section[], slideId: string): Section | undefined {
  return sections.find((s) => s.slides.includes(slideId));
}

/** A section's name as it is kept: trimmed, with runs of spaces made one. Null if it is empty or too long. */
export function cleanSectionName(name: string): string | null {
  const n = name.replace(/\s+/g, " ").trim();
  return n === "" || n.length > SECTION_NAME_MAX ? null : n;
}

/** An id no section has yet: scene-2, scene-3 and so on. */
export function newSectionId(sections: readonly Section[]): string {
  const used = new Set(sections.map((s) => s.id));
  let n = sections.length + 1;
  while (used.has(`scene-${n}`)) n++;
  return `scene-${n}`;
}

/** "1 slide", "5 slides". */
export function slidesWord(n: number): string {
  return `${n} ${n === 1 ? "slide" : "slides"}`;
}

/**
 * A new section starting at a slide: that slide and the ones after it in its section move to the new section, which comes straight
 * after. A slide that already starts its section cannot start another one there.
 */
export function startSection(sections: readonly Section[], slideId: string, name: string, id: string): SectionResult {
  const clean = cleanSectionName(name);
  if (clean === null) return { ok: false, message: `A section needs a name, of up to ${SECTION_NAME_MAX} letters.` };
  const out = copy(sections);
  const home = out.find((s) => s.slides.includes(slideId));
  if (!home) return { ok: false, message: "That slide is not in the course." };
  const at = home.slides.indexOf(slideId);
  if (at === 0) return { ok: false, message: `This slide already starts the section ${home.name}. Choose a slide further down to start a new section there, or rename ${home.name}.` };
  const moved = home.slides.splice(at);
  out.splice(out.indexOf(home) + 1, 0, { id, name: clean, slides: moved });
  return { ok: true, sections: out, message: `Made the section ${clean}, starting at this slide, with ${slidesWord(moved.length)}. ${home.name} keeps ${slidesWord(home.slides.length)}.` };
}

export function renameSection(sections: readonly Section[], id: string, name: string): SectionResult {
  const clean = cleanSectionName(name);
  if (clean === null) return { ok: false, message: `A section needs a name, of up to ${SECTION_NAME_MAX} letters.` };
  const out = copy(sections);
  const s = out.find((x) => x.id === id);
  if (!s) return { ok: false, message: "That section is not in the course." };
  if (s.name === clean) return { ok: false, message: "" };
  const was = s.name;
  s.name = clean;
  return { ok: true, sections: out, message: `Renamed the section ${was} to ${clean}.` };
}

/** Take a section away and keep its slides: they join the end of the section before it (or, for the first, the start of the next). */
export function removeSection(sections: readonly Section[], id: string): SectionResult {
  if (sections.length < 2) return { ok: false, message: "The course has only this section, so there is nothing to join its slides to." };
  const out = copy(sections);
  const at = out.findIndex((s) => s.id === id);
  if (at === -1) return { ok: false, message: "That section is not in the course." };
  const gone = out[at]!;
  const into = at > 0 ? out[at - 1]! : out[1]!;
  if (at > 0) into.slides.push(...gone.slides);
  else into.slides.unshift(...gone.slides);
  out.splice(at, 1);
  return { ok: true, sections: out, message: gone.slides.length === 0
    ? `Removed the empty section ${gone.name}.`
    : `Removed the section ${gone.name}. Its ${slidesWord(gone.slides.length)} ${gone.slides.length === 1 ? "is" : "are"} now ${at > 0 ? "at the end" : "at the start"} of ${into.name}. No slide was deleted.` };
}

/** Move a whole section, with its slides, one place earlier or later. */
export function moveSection(sections: readonly Section[], id: string, delta: -1 | 1): SectionResult {
  const out = copy(sections);
  const at = out.findIndex((s) => s.id === id);
  if (at === -1) return { ok: false, message: "That section is not in the course." };
  const to = at + delta;
  if (to < 0 || to >= out.length) return { ok: false, message: `${out[at]!.name} is already ${delta < 0 ? "first" : "last"}.` };
  [out[at], out[to]] = [out[to]!, out[at]!];
  return { ok: true, sections: out, message: `${out[to]!.name} is now section ${to + 1} of ${out.length}.` };
}

/** Move slides to the end of a section, in the order the course has them now. */
export function moveSlidesToSection(sections: readonly Section[], slideIds: readonly string[], id: string): SectionResult {
  const out = copy(sections);
  const target = out.find((s) => s.id === id);
  if (!target) return { ok: false, message: "That section is not in the course." };
  const order = out.flatMap((s) => s.slides);
  const moving = order.filter((s) => slideIds.includes(s) && !target.slides.includes(s));
  if (moving.length === 0) return { ok: false, message: `${slideIds.length === 1 ? "That slide is" : "Those slides are"} already in ${target.name}.` };
  for (const s of out) s.slides = s.slides.filter((x) => !moving.includes(x));
  target.slides.push(...moving);
  return { ok: true, sections: out, message: `Moved ${slidesWord(moving.length)} to the end of ${target.name}.` };
}

/**
 * Move a slide one place earlier or later. At the start or end of its section it crosses into the section next to it, so Move slide up
 * and down (and Alt+Up and Alt+Down in the list) can take a slide anywhere.
 */
export function moveSlideAcross(sections: readonly Section[], slideId: string, delta: -1 | 1): SectionResult {
  const out = copy(sections);
  const si = out.findIndex((s) => s.slides.includes(slideId));
  if (si === -1) return { ok: false, message: "That slide is not in the course." };
  const home = out[si]!;
  const at = home.slides.indexOf(slideId);
  const to = at + delta;
  if (to >= 0 && to < home.slides.length) {
    [home.slides[at], home.slides[to]] = [home.slides[to]!, home.slides[at]!];
    return { ok: true, sections: out, message: "" };
  }
  const next = out[si + delta];
  if (!next) return { ok: false, message: delta < 0 ? "It is already the first slide." : "It is already the last slide." };
  home.slides.splice(at, 1);
  if (delta < 0) next.slides.push(slideId);
  else next.slides.unshift(slideId);
  return { ok: true, sections: out, message: `It is now ${delta < 0 ? "the last slide" : "the first slide"} of ${next.name}.` };
}

/** The number in a slide's id. Ids are given in the order slides are made (slide-001, slide-002...), so this is that order. */
export function madeNumber(slideId: string): number {
  const m = /(\d+)\s*$/.exec(slideId);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

export type SortBy = "name" | "made";

/** Sort a section's slides once: A to Z by name (numbers in names in counting order), or in the order they were made. */
export function sortSection(sections: readonly Section[], id: string, by: SortBy, nameOf: (slideId: string) => string, locale = "en"): SectionResult {
  const out = copy(sections);
  const s = out.find((x) => x.id === id);
  if (!s) return { ok: false, message: "That section is not in the course." };
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const before = s.slides.join(",");
  s.slides = [...s.slides].sort((a, b) => (by === "name" ? collator.compare(nameOf(a), nameOf(b)) : madeNumber(a) - madeNumber(b)) || madeNumber(a) - madeNumber(b) || a.localeCompare(b));
  const how = by === "name" ? "A to Z" : "in the order they were made";
  if (s.slides.join(",") === before) return { ok: false, message: `The slides of ${s.name} are already ${how}.` };
  return { ok: true, sections: out, message: `Sorted the ${slidesWord(s.slides.length)} of ${s.name} ${how}. The course plays them in this order now.` };
}
