// Sections of a course: making one at a slide, renaming, removing, moving, moving slides between them, and sorting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Model } from "./model.ts";
import { newProjectFiles } from "./template.ts";
import { cleanSectionName, madeNumber, moveSection, moveSlideAcross, moveSlidesToSection, newSectionId, removeSection, renameSection, sectionOf, sortSection, startSection, type Section, type SectionResult } from "./sections.ts";

const course = (): Section[] => [
  { id: "scene-main", name: "Main", slides: ["slide-001", "slide-002", "slide-003", "slide-004", "slide-005"] },
];
const two = (): Section[] => [
  { id: "scene-main", name: "Foundations", slides: ["slide-001", "slide-002"] },
  { id: "scene-2", name: "Contexts", slides: ["slide-003", "slide-004", "slide-005"] },
];
const done = (r: SectionResult): Section[] => {
  assert.ok(r.ok, r.message);
  return (r as { sections: Section[] }).sections;
};
const shape = (s: Section[]) => s.map((x) => `${x.name}:${x.slides.map((id) => id.slice(-1)).join("")}`).join(" | ");

test("a new section starts at the chosen slide and takes the rest of its section, without changing the order the course plays", () => {
  const before = course();
  const r = startSection(before, "slide-003", "  Module   2 ", "scene-2");
  const after = done(r);
  assert.equal(shape(after), "Main:12 | Module 2:345");
  assert.equal(after.flatMap((s) => s.slides).join(), before.flatMap((s) => s.slides).join());
  assert.match(r.message, /Made the section Module 2, starting at this slide, with 3 slides\. Main keeps 2 slides\./);
  assert.equal(shape(before), "Main:12345", "the list given is not changed");
});

test("a slide that already starts its section cannot start another, and a section needs a name", () => {
  const r = startSection(two(), "slide-003", "Again", "scene-3");
  assert.ok(!r.ok);
  assert.match(r.message, /already starts the section Contexts/);
  assert.ok(!startSection(course(), "slide-002", "   ", "scene-2").ok);
  assert.ok(!startSection(course(), "slide-002", "x".repeat(81), "scene-2").ok);
  assert.equal(cleanSectionName("x".repeat(80))?.length, 80);
});

test("a new section's id is one no section has", () => {
  assert.equal(newSectionId(course()), "scene-2");
  assert.equal(newSectionId([...two(), { id: "scene-3", name: "C", slides: [] }]), "scene-4");
});

test("renaming says what it did, and the same name changes nothing", () => {
  const r = renameSection(two(), "scene-2", "Settings");
  assert.equal(shape(done(r)), "Foundations:12 | Settings:345");
  assert.equal(r.message, "Renamed the section Contexts to Settings.");
  assert.ok(!renameSection(two(), "scene-2", "Contexts").ok);
});

test("removing a section keeps its slides: they join the section before it, or the next one for the first", () => {
  const r = removeSection(two(), "scene-2");
  assert.equal(shape(done(r)), "Foundations:12345");
  assert.match(r.message, /Its 3 slides are now at the end of Foundations\. No slide was deleted\./);
  assert.equal(shape(done(removeSection(two(), "scene-main"))), "Contexts:12345");
  assert.ok(!removeSection(course(), "scene-main").ok, "the only section stays");
});

test("a section moves with its slides", () => {
  const r = moveSection(two(), "scene-2", -1);
  assert.equal(shape(done(r)), "Contexts:345 | Foundations:12");
  assert.equal(r.message, "Contexts is now section 1 of 2.");
  assert.ok(!moveSection(two(), "scene-main", -1).ok);
});

test("slides moved to a section go to its end, in course order, and a slide already there is said to be", () => {
  const r = moveSlidesToSection(two(), ["slide-002", "slide-001"], "scene-2");
  assert.equal(shape(done(r)), "Foundations: | Contexts:34512");
  assert.equal(r.message, "Moved 2 slides to the end of Contexts.");
  assert.ok(!moveSlidesToSection(two(), ["slide-004"], "scene-2").ok);
});

test("moving a slide up or down crosses into the next section at the edge of its own", () => {
  assert.equal(shape(done(moveSlideAcross(two(), "slide-004", -1))), "Foundations:12 | Contexts:435");
  const up = moveSlideAcross(two(), "slide-003", -1);
  assert.equal(shape(done(up)), "Foundations:123 | Contexts:45");
  assert.equal(up.message, "It is now the last slide of Foundations.");
  const down = moveSlideAcross(two(), "slide-002", 1);
  assert.equal(shape(done(down)), "Foundations:1 | Contexts:2345");
  assert.equal(down.message, "It is now the first slide of Contexts.");
  assert.ok(!moveSlideAcross(two(), "slide-001", -1).ok);
  assert.ok(!moveSlideAcross(two(), "slide-005", 1).ok);
});

test("sorting A to Z puts numbers in names in counting order; by the order made follows the slides' numbers; already sorted says so", () => {
  const names: Record<string, string> = { "slide-001": "Week 10", "slide-002": "week 2", "slide-003": "Activity", "slide-004": "Week 1", "slide-005": "Zebra" };
  const shuffled: Section[] = [{ id: "scene-main", name: "Main", slides: ["slide-005", "slide-001", "slide-003", "slide-004", "slide-002"] }];
  const az = sortSection(shuffled, "scene-main", "name", (id) => names[id]!);
  assert.deepEqual(done(az)[0]!.slides.map((id) => names[id]), ["Activity", "Week 1", "week 2", "Week 10", "Zebra"]);
  assert.match(az.message, /Sorted the 5 slides of Main A to Z/);
  const made = sortSection(shuffled, "scene-main", "made", (id) => names[id]!);
  assert.deepEqual(done(made)[0]!.slides, ["slide-001", "slide-002", "slide-003", "slide-004", "slide-005"]);
  const again = sortSection(course(), "scene-main", "made", () => "");
  assert.ok(!again.ok);
  assert.match(again.message, /already in the order they were made/);
});

test("only the chosen section is sorted", () => {
  const s: Section[] = [{ id: "a", name: "A", slides: ["slide-002", "slide-001"] }, { id: "b", name: "B", slides: ["slide-004", "slide-003"] }];
  assert.equal(shape(done(sortSection(s, "b", "made", () => ""))), "A:21 | B:34");
});

test("a slide's number is the order it was made in, and the section it is in is found", () => {
  assert.equal(madeNumber("slide-012"), 12);
  assert.ok(madeNumber("intro") > madeNumber("slide-999"));
  assert.equal(sectionOf(two(), "slide-004")?.name, "Contexts");
});

test("through the Model: each change to the sections is one undo step, and the course plays the slides in the sections' order", () => {
  const files = newProjectFiles({ title: "Sections", author: "", language: "en-US", today: "2026-11-10" });
  const text = (p: string) => files.find((f) => f.path === p)!.text;
  const m = new Model({ dir: "sections-test", project: text("project.json"), theme: text("theme.json"), assets: null, slides: [{ id: "slide-001", text: text("slides/slide-001.json") }] });
  for (let i = 0; i < 3; i++) m.duplicateSlide();
  const ids = m.slides.map((s) => s.id);
  assert.equal(ids.length, 4);
  m.selectSlide(ids[2]!);
  const made = m.startSection("Part two");
  assert.ok(made.ok, made.message);
  assert.deepEqual(m.sections.map((s) => s.name), ["Main", "Part two"]);
  assert.deepEqual(m.slides.map((s) => s.id), ids, "the order the course plays is the same");
  assert.ok(m.dirty);
  m.undo();
  assert.equal(m.sections.length, 1);
  m.redo();
  assert.equal(m.sections.length, 2);
  // Moving the first slide of Part two up takes it into Main.
  m.selectSlide(ids[2]!);
  const moved = m.moveSlide(ids[2]!, -1);
  assert.match(moved ?? "", /is now slide 3 of 4\. It is now the last slide of Main\./);
  assert.equal(m.sectionOfSlide(ids[2]!)?.name, "Main");
  // Moving a section moves its slides, and the course's order follows.
  const part = m.sections[1]!.id;
  assert.ok(m.moveSection(part, -1).ok);
  assert.deepEqual(m.slides.map((s) => s.id), [ids[3], ids[0], ids[1], ids[2]]);
  // Sorting by the order made puts them back within a section.
  assert.ok(m.removeSection(part).ok);
  assert.ok(m.sortSection(m.sections[0]!.id, "made").ok);
  assert.deepEqual(m.slides.map((s) => s.id), ids);
  // Renaming the only section works, and an empty name is refused.
  assert.ok(m.renameSection(m.sections[0]!.id, "Everything").ok);
  assert.ok(!m.renameSection(m.sections[0]!.id, "  ").ok);
});
