// Which of the Properties panel's tabs are there, which one shows, and where the keys move. The panel itself was driven in the browser preview.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kindName, PROPS_TABS, sectionIcon, sectionName, sectionOpen, tabAfterKey, tabsWith, tabToShow } from "./propstabs.ts";
import { UI_ICONS } from "./uiicons.gen.ts";

test("the tabs are Content, Style and Behaviour, in that order", () => {
  assert.deepEqual(PROPS_TABS.map((t) => t.label), ["Content", "Style", "Behaviour"]);
});

test("a tab with nothing in it is left out, and the rest keep their order", () => {
  assert.deepEqual(tabsWith({ content: [1], style: [1, 2], behaviour: [1] }), ["content", "style", "behaviour"]);
  assert.deepEqual(tabsWith({ behaviour: [1], style: [1] }), ["style", "behaviour"]);
  assert.deepEqual(tabsWith({ content: [], style: [1] }), ["style"]);
  assert.deepEqual(tabsWith({}), []);
});

test("the tab chosen last shows when it is there; otherwise the first there is", () => {
  assert.equal(tabToShow(["content", "style", "behaviour"], "behaviour"), "behaviour");
  // Several objects selected have no Content tab: Style shows, and the choice of Content is kept for the next single object.
  assert.equal(tabToShow(["style", "behaviour"], "content"), "style");
  assert.equal(tabToShow([], "style"), null);
});

test("Left and Right move along the row and go round; Home and End go to the ends; other keys do not move", () => {
  const all = ["content", "style", "behaviour"] as const;
  assert.equal(tabAfterKey(all, "content", "ArrowRight"), "style");
  assert.equal(tabAfterKey(all, "behaviour", "ArrowRight"), "content");
  assert.equal(tabAfterKey(all, "content", "ArrowLeft"), "behaviour");
  assert.equal(tabAfterKey(all, "style", "Home"), "content");
  assert.equal(tabAfterKey(all, "style", "End"), "behaviour");
  assert.equal(tabAfterKey(all, "style", "ArrowDown"), null);
  assert.equal(tabAfterKey(all, "style", "Enter"), null);
  assert.equal(tabAfterKey(["style", "behaviour"], "behaviour", "ArrowRight"), "style");
  assert.equal(tabAfterKey(["style"], "content", "ArrowRight"), null);
});

test("the badge names every object type the format has, in the words of the Insert menu", () => {
  const schema = JSON.parse(readFileSync(new URL("../../schema/object.schema.json", import.meta.url), "utf8")) as { properties: { type: { enum: string[] } } };
  const types = schema.properties.type.enum;
  assert.ok(types.length >= 19);
  for (const t of types) assert.notEqual(kindName(t), t, `${t} has a name of its own`);
  assert.equal(kindName("text"), "Text box");
  assert.equal(kindName("quizQuestion"), "Question");
  assert.equal(kindName("embed"), "Online video");
  assert.equal(kindName("somethingNew"), "somethingNew");
});

test("a section is known by its name without numbers or what follows a colon, so it is opened or closed for every object alike", () => {
  assert.equal(sectionName("Timing"), "Timing");
  assert.equal(sectionName("Timing, for all 3"), "Timing, for all N");
  assert.equal(sectionName("Situation 2 of 5: The report is late"), "Situation N of N");
  assert.equal(sectionName("Situation 1 of 3: Totals"), sectionName("Situation 3 of 3: Another"));
});

test("each section's heading has an icon the editor draws; one the list does not know gets a plain list", () => {
  for (const legend of ["Content", "Narration", "Accessibility", "Appearance", "Looks", "Position and size", "Line up with the slide", "Timing", "Animation", "Rules", "Scoring", "Feedback layers", "Behaviour", "Design", "Slide", "Layer", "Course", "Moving through the course", "Slide animation", "Timing, for all 2", "Situation 1 of 2: A"]) {
    assert.ok(sectionIcon(legend) in UI_ICONS, `${legend}: ${sectionIcon(legend)}`);
    assert.notEqual(sectionIcon(legend), "list", `${legend} has an icon of its own`);
  }
  assert.equal(sectionIcon("Something new"), "list");
  assert.ok("list" in UI_ICONS && "chevron-down" in UI_ICONS);
});

test("a section starts open if it is the first in its tab, unless the person has opened or closed it", () => {
  assert.equal(sectionOpen(undefined, 0), true);
  assert.equal(sectionOpen(undefined, 2), false);
  assert.equal(sectionOpen(false, 0), false);
  assert.equal(sectionOpen(true, 3), true);
});
