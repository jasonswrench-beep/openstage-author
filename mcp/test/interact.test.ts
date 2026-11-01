// Interactions, scenarios, themes and the cast, through the real protocol layer. The ones that run the problem check need Python.

import assert from "node:assert/strict";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { png, readSlide, started, read } from "./world.ts";

const havePython = Boolean(process.env["OPENSTAGE_PYTHON"]);

const OBJECT = (folder: string, project: string, slide: number, id: string): any => readSlide(folder, project, slide).baseLayer.objects.find((o: any) => o.id === id);

const THREE = [
  { title: "Email", body: "Written and slow.\n\nGood for a record." },
  { title: "Phone", body: "Spoken and quick." },
  { title: "Meeting", body: "Face to face." },
];

test("an interaction is made from its items, each a title and words, and saved with a name for a screen reader", async () => {
  const w = await started();
  try {
    const r = await w.call("add_interaction", { slide: 1, kind: "tabs", items: THREE, name: "Three channels compared" });
    assert.ok(r.ok, r.text);
    assert.match(r.text, /Added the tabs obj-\d+ to slide 1, with 3 items\..*no narration yet/);
    const saved = OBJECT(w.folder, "Course", 1, r.data.id);
    assert.deepEqual(saved.content.items.map((i: any) => [i.title, i.body]), [["Email", "<p>Written and slow.</p><p>Good for a record.</p>"], ["Phone", "<p>Spoken and quick.</p>"], ["Meeting", "<p>Face to face.</p>"]]);
    assert.equal(saved.accessibility.altText, "Three channels compared");
    assert.deepEqual(r.data.interaction.items.map((i: any) => i.title), ["Email", "Phone", "Meeting"]);
    assert.ok(r.data.interaction.items.every((i: any) => /^item-\d+$/.test(i.id)));
  } finally {
    w.done();
  }
});

test("the items asked for are the items made, whether that is fewer than a kind starts with or more, and a kind's limits are kept", async () => {
  const w = await started();
  try {
    const fewer = await w.call("add_interaction", { slide: 1, kind: "tabs", items: THREE.slice(0, 2) });
    assert.equal(OBJECT(w.folder, "Course", 1, fewer.data.id).content.items.length, 2);
    const more = await w.call("add_interaction", { slide: 1, kind: "accordion", items: Array.from({ length: 6 }, (_, i) => ({ title: `Item ${i + 1}`, body: `Words ${i + 1}` })) });
    assert.deepEqual(OBJECT(w.folder, "Course", 1, more.data.id).content.items.map((i: any) => i.title), ["Item 1", "Item 2", "Item 3", "Item 4", "Item 5", "Item 6"]);
    assert.match((await w.call("add_interaction", { slide: 1, kind: "timeline", items: [THREE[0]] })).text, /needs 2 to 12 items and 1 were given/);
    assert.match((await w.call("add_interaction", { slide: 1, kind: "processCircle", items: Array.from({ length: 9 }, (_, i) => ({ title: `S${i}`, body: "x" })) })).text, /needs 3 to 8 items and 9 were given/);
    assert.ok(!(await w.call("add_interaction", { slide: 1, kind: "tabs", items: [{ title: "No words" }] })).ok);
  } finally {
    w.done();
  }
});

test("orientation, several open at once and a layer are honoured, and an orientation a kind does not have is refused", async () => {
  const w = await started();
  try {
    await w.call("add_layer", { slide: 1, name: "More" });
    const tabs = await w.call("add_interaction", { slide: 1, layer: "More", kind: "tabs", orientation: "vertical", items: THREE });
    assert.equal(tabs.data.layer, "More");
    assert.equal(OBJECT(w.folder, "Course", 1, tabs.data.id) === undefined, true, "it is on the layer, not the base layer");
    assert.equal(readSlide(w.folder, "Course", 1).layers[0].objects.find((o: any) => o.id === tabs.data.id).content.orientation, "vertical");
    const reveal = await w.call("add_interaction", { slide: 1, kind: "clickReveal", multiple: true, items: THREE });
    assert.equal(OBJECT(w.folder, "Course", 1, reveal.data.id).content.allowMultiple, true);
    assert.match((await w.call("add_interaction", { slide: 1, kind: "accordion", orientation: "horizontal", items: THREE })).text, /comes only vertical, not horizontal/);
  } finally {
    w.done();
  }
});

test("a labeled graphic needs its picture, takes markers and a guided order, and only it", async () => {
  const w = await started();
  try {
    writeFileSync(path.join(w.folder, "model.png"), png(800, 400));
    const items = [{ title: "Sender", body: "Who speaks.", x: 10, y: 40 }, { title: "Receiver", body: "Who hears.", x: 85.5, y: 60 }];
    assert.match((await w.call("add_interaction", { slide: 1, kind: "labeledGraphic", items })).text, /needs picture.*and pictureAlt/);
    const r = await w.call("add_interaction", { slide: 1, kind: "labeledGraphic", items, picture: "model.png", pictureAlt: "A sender and a receiver with a message between them", guided: true });
    assert.ok(r.ok, r.text);
    const saved = OBJECT(w.folder, "Course", 1, r.data.id).content;
    assert.deepEqual([saved.graphic.src, saved.graphic.alt, saved.guided], ["assets/images/model.png", "A sender and a receiver with a message between them", true]);
    assert.deepEqual(saved.items.map((i: any) => [i.x, i.y]), [[10, 40], [85.5, 60]]);
    assert.match((await w.call("add_interaction", { slide: 1, kind: "tabs", items: THREE, guided: true })).text, /only for a labeled graphic/);
    assert.match((await w.call("add_interaction", { slide: 1, kind: "tabs", items: [{ ...THREE[0], x: 5, y: 5 }] })).text, /only for a labeled graphic/);
  } finally {
    w.done();
  }
});

test("an interaction that fails part way leaves nothing on the slide", async () => {
  const w = await started();
  try {
    const before = (await w.call("get_slide", { slide: 1 })).data.layers[0].objects.length;
    const missing = await w.call("add_interaction", { slide: 1, kind: "labeledGraphic", items: [{ title: "A", body: "a" }], picture: "not-there.png", pictureAlt: "x" });
    assert.equal(missing.ok, false);
    assert.equal((await w.call("get_slide", { slide: 1 })).data.layers[0].objects.length, before, "the half-made interaction was taken back");
    assert.deepEqual(readdirSync(path.join(w.folder, "Course.osproj", "assets", "images")), []);
  } finally {
    w.done();
  }
});

test("an item is changed, added, narrated and deleted, by number, id or title", async () => {
  const w = await started();
  try {
    const made = (await w.call("add_interaction", { slide: 1, kind: "tabs", items: THREE })).data;
    assert.ok((await w.call("set_item", { object: made.id, item: 2, title: "Telephone", body: "Spoken, and quick." })).ok);
    assert.ok((await w.call("set_item", { object: made.id, item: "Meeting", body: "In person." })).ok);
    assert.match((await w.call("set_item", { object: made.id, item: 9, title: "x" })).text, /no item "9".*1\. Email; 2\. Telephone; 3\. Meeting/);
    assert.match((await w.call("set_item", { object: made.id, item: 1 })).text, /Nothing was changed/);
    assert.match((await w.call("set_item", { object: made.id, item: 1, x: 5 })).text, /Only a labeled graphic has markers/);
    assert.ok((await w.call("add_item", { object: made.id, title: "Letter", body: "On paper." })).ok);
    assert.deepEqual(OBJECT(w.folder, "Course", 1, made.id).content.items.map((i: any) => i.title), ["Email", "Telephone", "Meeting", "Letter"]);
    const narrated = await w.call("narrate_items", { object: made.id });
    assert.match(narrated.text, /Added narration to 4 items/);
    assert.equal((await w.call("get_narration")).data.length, 4);
    assert.match((await w.call("narrate_items", { object: made.id })).text, /already has narration/);
    assert.match((await w.call("delete_item", { object: made.id, item: "Letter", confirm: false })).text, /confirm: true/);
    assert.ok((await w.call("delete_item", { object: made.id, item: "Letter", confirm: true })).ok);
    assert.equal(OBJECT(w.folder, "Course", 1, made.id).content.items.length, 3);
    const text = (await w.call("add_object", { slide: 1, kind: "text", text: "Not an interaction" })).data;
    assert.match((await w.call("add_item", { object: text.id, title: "x", body: "y" })).text, /is a text, not an interaction/);
  } finally {
    w.done();
  }
});

test("an interaction's behaviour is changed: orientation, several open, guided, and its name", async () => {
  const w = await started();
  try {
    const tabs = (await w.call("add_interaction", { slide: 1, kind: "tabs", items: THREE })).data;
    const r = await w.call("set_interaction", { object: tabs.id, orientation: "vertical", name: "Channels" });
    assert.ok(r.ok, r.text);
    assert.match(r.text, /now vertical, named/);
    const saved = OBJECT(w.folder, "Course", 1, tabs.id);
    assert.deepEqual([saved.content.orientation, saved.accessibility.altText], ["vertical", "Channels"]);
    assert.match((await w.call("set_interaction", { object: tabs.id, guided: true })).text, /Only a labeled graphic can be guided/);
    assert.match((await w.call("set_interaction", { object: tabs.id })).text, /Nothing was changed/);
    const reveal = (await w.call("add_interaction", { slide: 1, kind: "clickReveal", items: THREE })).data;
    assert.match((await w.call("set_interaction", { object: reveal.id, multiple: false })).text, /one item open at a time/);
  } finally {
    w.done();
  }
});

const STORY = {
  situations: [
    { title: "At the desk", prompt: "What do you do?", lines: [{ text: "A colleague hands you a late report.", speaker: "Ann" }], choices: [{ label: "Read it now", goesTo: 2, effects: [{ variable: "Trust", add: 10 }], response: [{ text: "Thank you!", speaker: "Ann" }] }, { label: "Say you are busy", goesTo: "The slow ending", effects: [{ variable: "Trust", add: -10 }] }] },
    { title: "The good ending", lines: [{ text: "The report is on time." }] },
    { title: "The slow ending", lines: [{ text: "The report is late." }] },
  ],
  meters: [{ label: "Trust", variable: "Trust" }],
  reflection: "What would you do differently?",
};

test("a scenario is put on a slide whole, with the cast speaking and every line spoken", async () => {
  const w = await started();
  try {
    await w.call("add_variable", { name: "Trust", type: "number", initial: 50 });
    assert.match((await w.call("add_scenario", { slide: 1, ...STORY })).text, /"Ann" is not in the cast.*add_character/);
    const ann = await w.call("add_character", { name: "Ann", role: "a colleague" });
    assert.ok(ann.ok, ann.text);
    const r = await w.call("add_scenario", { slide: 1, name: "The late report", ...STORY });
    assert.ok(r.ok, r.text);
    assert.match(r.text, /with 3 situations and 2 endings.*Every line is spoken/);
    assert.deepEqual(r.data.scenario.situations.map((s: any) => [s.number, s.title, s.choices]), [[1, "At the desk", 2], [2, "The good ending", 0], [3, "The slow ending", 0]]);
    const saved = OBJECT(w.folder, "Course", 1, r.data.id);
    assert.equal(saved.accessibility.altText, "The late report");
    assert.equal(saved.content.meters[0].variable, "var-1");
    assert.equal(saved.content.nodes[0].lines[0].speaker, "ann");
    assert.equal(saved.content.nodes[0].lines[0].narration.voice, ann.data.voiceId, "Ann's lines are in Ann's voice");
    assert.equal((await w.call("get_narration")).data.length, 4, "the four lines are narrations");
    const quiet = await w.call("add_scenario", { slide: 1, spoken: false, ...STORY, situations: [{ title: "A" }] });
    assert.ok(quiet.ok, quiet.text);
    assert.equal((await w.call("get_narration")).data.length, 4, "a scenario that is not spoken adds no narration");
  } finally {
    w.done();
  }
});

test("a scenario that cannot work adds nothing to the slide", async () => {
  const w = await started();
  try {
    const before = (await w.call("get_slide", { slide: 1 })).data.layers[0].objects.length;
    const bad = await w.call("add_scenario", { slide: 1, situations: [{ title: "A", choices: [{ label: "x", goesTo: 7 }] }] });
    assert.equal(bad.ok, false);
    assert.match(bad.text, /there is no situation 7/);
    assert.equal((await w.call("get_slide", { slide: 1 })).data.layers[0].objects.length, before);
  } finally {
    w.done();
  }
});

test("the cast: people are added with a voice of their own, described, changed, and taken out when nothing uses them", async () => {
  const w = await started();
  try {
    writeFileSync(path.join(w.folder, "ann.png"), png(200, 200));
    const ann = await w.call("add_character", { name: "Ann Lee", role: "the manager", picture: "ann.png", altText: "Ann, smiling" });
    assert.ok(ann.ok, ann.text);
    assert.deepEqual([ann.data.id, ann.data.role, ann.data.picture, ann.data.altText], ["ann-lee", "the manager", "assets/images/ann.png", "Ann, smiling"]);
    const bob = await w.call("add_character", { name: "Bob" });
    assert.notEqual(bob.data.voiceId, ann.data.voiceId, "each person has a voice no one else has");
    assert.match(bob.text, /Added Bob to the cast/);
    assert.match((await w.call("add_character", { name: "ann lee" })).text, /already a person called/);
    assert.match((await w.call("add_character", { name: "Cy", voice: "not-a-voice" })).text, /not a voice/);
    assert.match((await w.call("add_character", { name: "Cy", altText: "x" })).text, /for a picture; give picture too/);
    assert.equal((await w.call("get_cast")).data.length, 2);
    const changed = await w.call("set_character", { character: "bob", role: "the new starter", name: "Robert" });
    assert.ok(changed.ok, changed.text);
    assert.deepEqual((await w.call("get_cast")).data.map((p: any) => p.name), ["Ann Lee", "Robert"]);
    assert.match((await w.call("set_character", { character: "Nobody", role: "x" })).text, /no person "Nobody".*Ann Lee, Robert/);
    assert.match((await w.call("set_character", { character: "Robert", altText: "x" })).text, /has no picture to describe/);
    assert.match((await w.call("delete_character", { character: "Robert", confirm: false })).text, /confirm: true/);
    assert.ok((await w.call("delete_character", { character: "Robert", confirm: true })).ok);
    assert.equal(JSON.parse(read(w.folder, "Course", "project.json")).characters.length, 1);
  } finally {
    w.done();
  }
});

test("a person who speaks in a scenario cannot be taken out of the cast", async () => {
  const w = await started();
  try {
    await w.call("add_variable", { name: "Trust", type: "number" });
    await w.call("add_character", { name: "Ann" });
    await w.call("add_scenario", { slide: 1, ...STORY });
    const r = await w.call("delete_character", { character: "Ann", confirm: true });
    assert.equal(r.ok, false);
    assert.match(r.text, /Ann is still used by/);
    assert.equal((await w.call("get_cast")).data.length, 1);
  } finally {
    w.done();
  }
});

test("the theme is listed and changed, with the course keeping its own copy", async () => {
  const w = await started();
  try {
    const listed = await w.call("list_themes");
    assert.equal(listed.data.current.id, "classic");
    assert.ok(listed.data.themes.length >= 8);
    assert.match((await w.call("set_theme", { theme: "classic" })).text, /already has the theme Classic/);
    const r = await w.call("set_theme", { theme: "High contrast" });
    assert.ok(r.ok, r.text);
    assert.equal(JSON.parse(read(w.folder, "Course", "theme.json")).id, "high-contrast");
    assert.equal((await w.call("list_themes")).data.current.name, "High Contrast");
    assert.match((await w.call("set_theme", { theme: "neon" })).text, /no theme "neon".*Classic \(classic\)/);
  } finally {
    w.done();
  }
});

test("a course with an interaction, a scenario, a cast and a new theme passes the check", { skip: !havePython }, async () => {
  const w = await started();
  try {
    mkdirSync(path.join(w.folder, "pics"));
    writeFileSync(path.join(w.folder, "pics", "model.png"), png(600, 300));
    await w.call("set_theme", { theme: "ocean" });
    await w.call("add_slide", { layout: "content", name: "Channels" });
    await w.call("add_interaction", { slide: "Channels", kind: "flipCards", items: THREE, name: "Channels, front and back", narrate: true });
    await w.call("add_slide", { name: "The model" });
    await w.call("add_interaction", { slide: "The model", kind: "labeledGraphic", picture: "pics/model.png", pictureAlt: "Sender, message and receiver", items: [{ title: "Sender", body: "Speaks.", x: 15, y: 50 }, { title: "Receiver", body: "Hears.", x: 85, y: 50 }] });
    await w.call("add_variable", { name: "Trust", type: "number", initial: 50 });
    await w.call("add_character", { name: "Ann" });
    await w.call("add_slide", { name: "Story" });
    await w.call("add_scenario", { slide: "Story", ...STORY });
    const result = await w.call("check_course");
    assert.equal(result.data.errors, 0, JSON.stringify(result.data.findings, null, 1));
  } finally {
    w.done();
  }
});
