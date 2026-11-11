// The Insert gallery's list and search (revamp step 6). The window itself was driven in the browser preview.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ADD_MENU, INPUTS, INTERACTIONS, NAVIGATION_BUTTONS, NEW_OPTIONS } from "./factory.ts";
import { filterGallery, firstSentence, GALLERY_KINDS, galleryItems, galleryMove, galleryStatus, kindLabel, MEDIA_CHOICES } from "./insertgallery.ts";
import { QUIZ_KINDS } from "./questionedit.ts";
import { UI_ICONS } from "./uiicons.gen.ts";

const items = galleryItems();
const values = items.map((i) => i.value);

test("every thing the Add menus and their pickers offer is in the gallery once, so nothing is lost", () => {
  assert.equal(new Set(values).size, values.length, "no value twice");
  const want = [
    "text", "button", "hotspot", "content:table", "content:scrollingText", "timer", "scenario", "course:results", "course:certificate",
    "record", "game", "quizFromFile",
    ...NAVIGATION_BUTTONS.map((b) => `nav:${b.id}`),
    ...MEDIA_CHOICES.map((m) => `media:${m.id}`),
    ...NEW_OPTIONS.filter((o) => o.value.startsWith("shape:") || o.value.startsWith("bubble:")).map((o) => o.value),
    ...QUIZ_KINDS.map((k) => `quiz:${k.id}`),
    ...INPUTS.map((i) => `input:${i.id}`),
    ...INTERACTIONS.map((i) => `interaction:${i.id}`),
  ];
  for (const w of want) assert.ok(values.includes(w), `missing ${w}`);
  assert.equal(values.length, want.length, "nothing more than that either");
  // Every entry of the short Add menu leads to something in the gallery.
  const heads = new Set(values.map((v) => v.split(":")[0]));
  for (const e of ADD_MENU) {
    const g = e.value.replace(/^group:/, "");
    const leads = { button: "button", media: "media", shape: "shape", content: "content", question: "quiz", interaction: "interaction", course: "course" }[g] ?? g;
    assert.ok(heads.has(leads), `${e.label} has nothing in the gallery`);
  }
});

test("each has a name, a word about it, a kind and an icon the editor has", () => {
  for (const i of items) {
    assert.ok(i.label.trim() !== "" && i.description.trim() !== "", i.value);
    assert.ok(GALLERY_KINDS.some((k) => k.id === i.kind), i.value);
    assert.ok(i.icon in UI_ICONS, `${i.value}: icon ${i.icon}`);
    assert.ok(!/—/.test(i.label + i.description), `${i.value} has a long dash`);
  }
  for (const k of GALLERY_KINDS) {
    assert.ok(k.icon in UI_ICONS, k.id);
    assert.ok(items.some((i) => i.kind === k.id), `${k.label} is empty`);
  }
});

test("with nothing typed, a kind shows all of that kind in order, and All shows everything", () => {
  assert.equal(filterGallery(items, "", "all").length, items.length);
  const qs = filterGallery(items, "  ", "questions");
  assert.deepEqual(qs, items.filter((i) => i.kind === "questions"));
  assert.equal(qs[0]!.value, "quiz:mc");
});

test("a search finds by name first, then by kind, group and what it is for, the way the command search does", () => {
  assert.deepEqual(filterGallery(items, "tabs", "all").slice(0, 2).map((i) => i.value), ["interaction:tabs:horizontal", "interaction:tabs:vertical"]);
  assert.equal(filterGallery(items, "multiple choice", "all")[0]!.value, "quiz:mc");
  assert.ok(filterGallery(items, "youtube", "all").some((i) => i.value === "media:youtube"));
  // By its group: "survey" finds the Likert scale.
  assert.ok(filterGallery(items, "survey", "all").some((i) => i.value === "input:likert"));
  // By what it is for: "countdown" finds the timer.
  assert.equal(filterGallery(items, "countdown", "all")[0]!.value, "timer");
  // British and American spellings find each other, as in the command search.
  assert.ok(filterGallery(items, "color", "all").some((i) => i.value === "media:icon"));
  assert.deepEqual(filterGallery(items, "zzzz", "all"), []);
  // A kind narrows a search.
  assert.ok(filterGallery(items, "drop", "questions").every((i) => i.kind === "questions"));
  assert.ok(filterGallery(items, "drop", "all").length >= filterGallery(items, "drop", "questions").length);
});

test("the line under the box says how many, and what to try when nothing fits", () => {
  assert.equal(galleryStatus(80, 80, "", "all"), "80 things you can add, by kind. Type to find one.");
  assert.equal(galleryStatus(26, 80, "", "questions"), "26 things in Questions and surveys.");
  assert.equal(galleryStatus(1, 80, "timer", "all"), "1 thing found, best first.");
  assert.equal(galleryStatus(3, 80, "drop", "questions"), "3 things found in Questions and surveys, best first.");
  assert.match(galleryStatus(0, 80, "zz", "all"), /^Nothing to add has those words\. Try/);
  assert.match(galleryStatus(0, 80, "zz", "media"), /choose All\.$/);
  assert.equal(kindLabel("all"), "All");
});

test("the arrow keys, Home and End move between the choices, and Up from the first goes back to the box", () => {
  assert.equal(galleryMove("ArrowDown", 0, 5), 1);
  assert.equal(galleryMove("ArrowRight", 4, 5), 4);
  assert.equal(galleryMove("ArrowLeft", 0, 5), 0);
  assert.equal(galleryMove("ArrowUp", 0, 5), -1);
  assert.equal(galleryMove("ArrowUp", 3, 5), 2);
  assert.equal(galleryMove("Home", 3, 5), 0);
  assert.equal(galleryMove("End", 0, 5), 4);
  assert.equal(galleryMove("a", 0, 5), null);
  assert.equal(galleryMove("ArrowDown", 0, 0), null);
});

test("a card shows the first sentence of what a choice is for", () => {
  assert.equal(firstSentence("Plays from YouTube. You confirm the captions."), "Plays from YouTube.");
  assert.equal(firstSentence("No full stop here"), "No full stop here");
  assert.equal(firstSentence("Exact, or within a range. Then more."), "Exact, or within a range.");
});
