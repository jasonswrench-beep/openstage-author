// Tests for narrating the items of an interaction: a glossary term, a flip card, a tab. Each item has its own narration,
// named by the key "<object id>/<item id>", and the editor treats it like an object's own.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { InteractionContent } from "../../player/src/types.ts";
import { Model } from "./model.ts";
import { htmlToSpeech, itemScript, keyOf, totals, type CachedAudio, type Narration } from "./narration.ts";
import { newProjectFiles } from "./template.ts";

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-10" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

/** A glossary with its starting items, and the ids to talk about them. */
function glossary(m: Model) {
  const o = m.addInteraction("glossary:horizontal")!;
  const items = (o.content as unknown as InteractionContent).items;
  return { o, items, key: (i: number) => `${o.id}/${items[i]!.id}` };
}

const itemNarration = (m: Model, objectId: string, itemId: string): Narration | null => {
  const obj = m.objects.find((x) => x.id === objectId)!;
  return ((obj.content as unknown as InteractionContent).items.find((i) => i.id === itemId)!.narration as Narration | null) ?? null;
};

test("a new item starts with no narration", () => {
  const m = fresh();
  const { items } = glossary(m);
  assert.ok(items.length >= 3);
  for (const item of items) assert.equal(item.narration, null);
  assert.deepEqual(m.narratedObjects(), []);
});

test("an item's script makes narration for that item only, named by object and item", () => {
  const m = fresh();
  const { o, items, key } = glossary(m);
  const msg = m.setNarrationScript(key(1), "  A group chat is a shared thread.  ");
  assert.equal(msg, `Added narration to ${o.name}, ${items[1]!.title}`);
  assert.deepEqual(itemNarration(m, o.id, items[1]!.id), { script: "A group chat is a shared thread.", voice: "af_heart", speed: 1, lang: "en-US", pronunciations: [], audioCache: null });
  assert.equal(items[0]!.narration, null, "the other items are untouched");
  assert.equal(o.narration, null, "so is the object itself");
  assert.equal(m.setNarrationScript(key(1), "A group chat is a shared thread."), null, "the same words change nothing");
  assert.equal(m.setNarrationScript(key(1), "A group chat is a shared thread, nothing more."), "Narration updated");
});

test("a key that names nothing changes nothing", () => {
  const m = fresh();
  const { o } = glossary(m);
  for (const bad of [`${o.id}/item-99`, "obj-9999/item-1", `${o.id}/item-1/extra`, "/item-1", `${o.id}/`]) {
    assert.equal(m.setNarrationScript(bad, "Words."), null, bad);
  }
  assert.deepEqual(m.narratedObjects(), []);
  const text = m.addObject("text")!;
  assert.equal(m.setNarrationScript(`${text.id}/item-1`, "Words."), null, "only an interaction has items");
});

test("voice, speed and pronunciations work on an item, and give it its own audio key", () => {
  const m = fresh();
  const { o, items, key } = glossary(m);
  m.setNarrationScript(key(0), "Say Likert.");
  const start = keyOf(itemNarration(m, o.id, items[0]!.id)!);
  assert.equal(m.setNarrationVoice(key(0), "bf_emma"), "Voice changed to Emma, woman");
  assert.equal(itemNarration(m, o.id, items[0]!.id)!.lang, "en-GB");
  assert.equal(m.setNarrationSpeed(key(0), 0.9).ok, true);
  assert.equal(m.setNarrationSpeed(key(0), 9).ok, false);
  assert.equal(m.addPronunciation(key(0), "Likert", "\u02c8l\u026ak\u0259rt").ok, true);
  assert.equal(m.addPronunciation(key(0), "Likert", "x").ok, false, "a word has one pronunciation");
  assert.equal(m.updatePronunciation(key(0), 0, "Likert", "l\u026ak\u0259rt").ok, true);
  assert.notEqual(keyOf(itemNarration(m, o.id, items[0]!.id)!), start);
  assert.equal(m.deletePronunciation(key(0), 0), "Removed the pronunciation of Likert");
  assert.deepEqual(itemNarration(m, o.id, items[0]!.id)!.pronunciations, []);
});

test("a second item takes the voice and speed of the narration before it", () => {
  const m = fresh();
  const { o, items, key } = glossary(m);
  m.setNarrationScript(key(0), "First.");
  m.setNarrationVoice(key(0), "bf_emma");
  m.setNarrationSpeed(key(0), 0.9);
  m.setNarrationScript(key(1), "Second.");
  const n = itemNarration(m, o.id, items[1]!.id)!;
  assert.deepEqual([n.voice, n.speed, n.lang], ["bf_emma", 0.9, "en-GB"]);
});

test("clearing an item's script removes its narration, and undo brings it back", () => {
  const m = fresh();
  const { o, items, key } = glossary(m);
  m.setNarrationScript(key(2), "Some words.");
  const before = JSON.stringify(itemNarration(m, o.id, items[2]!.id));
  assert.equal(m.setNarrationScript(key(2), ""), `Removed the narration from ${o.name}, ${items[2]!.title}`);
  assert.equal(itemNarration(m, o.id, items[2]!.id), null);
  assert.equal(m.undo(), true);
  assert.equal(JSON.stringify(itemNarration(m, o.id, items[2]!.id)), before);
});

test("the narration list has an interaction's own narration, then its items in order, then the next object", () => {
  const m = fresh();
  const { o, items, key } = glossary(m);
  const after = m.addObject("text")!;
  m.setNarrationScript(after.id, "After the glossary.");
  m.setNarrationScript(key(2), "Third item.");
  m.setNarrationScript(key(0), "First item.");
  m.setNarrationScript(o.id, "The glossary itself.");
  const list = m.narratedObjects();
  assert.deepEqual(list.map((n) => n.key), [o.id, key(0), key(2), after.id]);
  assert.deepEqual(list.map((n) => n.item?.id ?? null), [null, items[0]!.id, items[2]!.id, null]);
  assert.ok(list.every((n) => n.slideId === "slide-001"));
  const made = new Map<string, CachedAudio>([[keyOf(list[1]!.narration), { hash: keyOf(list[1]!.narration), duration: 3, exactTimings: true }]]);
  assert.equal(totals(list, made).ready, 1);
  assert.equal(totals(list, made).missing, 3);
});

test("an item's text becomes its narration when asked, and the words are then its own", () => {
  const m = fresh();
  const { o, items, key } = glossary(m);
  m.setItemTitle(o.id, items[0]!.id, "Channel overload");
  m.setItemBody(o.id, items[0]!.id, "Too many places to look for messages.\n\nIt slows everyone down");
  assert.equal(m.narrateItemFromText(o.id, items[0]!.id), `Added narration to ${o.name}, Channel overload`);
  assert.equal(itemNarration(m, o.id, items[0]!.id)!.script, "Channel overload. Too many places to look for messages. It slows everyone down.");
  m.setItemBody(o.id, items[0]!.id, "Changed text.");
  assert.match(itemNarration(m, o.id, items[0]!.id)!.script, /Too many places/, "changing the item's text later does not rewrite the narration");
  assert.equal(m.narrateItemFromText(o.id, items[0]!.id), "Narration updated", "asking again does follow the text");
  assert.equal(itemNarration(m, o.id, items[0]!.id)!.script, "Channel overload. Changed text.");
  assert.equal(m.narrateItemFromText(o.id, items[0]!.id), null, "nothing to change the second time");
  assert.equal(m.narrateItemFromText(o.id, "item-99"), null);
  void key;
});

test("narrating every item reads each one that has none, leaves the rest alone, and is one undo", () => {
  const m = fresh();
  const { o, items, key } = glossary(m);
  m.setNarrationScript(key(1), "My own words for the second.");
  m.setNarrationVoice(key(1), "am_adam");
  const r = m.narrateItemsFromText(o.id);
  assert.equal(r.added, items.length - 1);
  assert.match(r.message, /^Added narration to \d+ items, read from their text\. 1 that already had narration was left alone\./);
  assert.equal(itemNarration(m, o.id, items[1]!.id)!.script, "My own words for the second.", "existing narration is kept exactly");
  for (const [i, item] of items.entries()) {
    const n = itemNarration(m, o.id, item.id)!;
    assert.ok(n, `item ${i + 1} has narration`);
    if (i !== 1) assert.equal(n.script, itemScript(item));
    if (i !== 1) assert.equal(n.voice, "am_adam", "new narration takes the voice of the narration before it");
  }
  assert.deepEqual(m.narrateItemsFromText(o.id), { added: 0, message: "Every item already has narration." });
  assert.equal(m.undo(), true);
  assert.deepEqual(items.map((item) => itemNarration(m, o.id, item.id) !== null), items.map((_, i) => i === 1), "one undo takes back all of them");
});

test("deleting an item takes its narration with it, and moving it keeps the narration with the item", () => {
  const m = fresh();
  const { o, items, key } = glossary(m);
  const [a, b] = [items[0]!.id, items[1]!.id];
  m.setNarrationScript(key(0), "About A.");
  m.setNarrationScript(key(1), "About B.");
  assert.ok(m.moveItem(o.id, a, 1));
  assert.deepEqual(m.narratedObjects().map((n) => n.narration.script), ["About B.", "About A."], "they follow the items, so they play in the item order");
  assert.equal(itemNarration(m, o.id, a)!.script, "About A.");
  assert.ok(m.deleteItem(o.id, b));
  assert.deepEqual(m.narratedObjects().map((n) => n.narration.script), ["About A."]);
});

test("the items' narration is saved in the item and survives a save and reopen", () => {
  const m = fresh();
  const { o, items, key } = glossary(m);
  m.setNarrationScript(key(0), "Saved words.");
  const saved = m.allFiles();
  const slide = JSON.parse(saved.find((f) => f.path === "slides/slide-001.json")!.text) as { baseLayer: { objects: { id: string; content: InteractionContent }[] } };
  const item = slide.baseLayer.objects.find((x) => x.id === o.id)!.content.items.find((i) => i.id === items[0]!.id)!;
  assert.equal((item.narration as Narration).script, "Saved words.");
  assert.equal(slide.baseLayer.objects.find((x) => x.id === o.id)!.content.items.find((i) => i.id === items[1]!.id)!.narration, null, "an item with none says so with null");
});

test("html becomes plain words a voice can read", () => {
  assert.equal(htmlToSpeech("<p>One thing.</p><p>Another thing</p>"), "One thing. Another thing.");
  assert.equal(htmlToSpeech("<p>Line one<br>line two</p>"), "Line one. line two.");
  assert.equal(htmlToSpeech("<ul><li>Red</li><li>Green and blue</li></ul>"), "Red. Green and blue.");
  assert.equal(htmlToSpeech("<p>Q&amp;A &lt;live&gt; &quot;now&quot; &#39;ok&#39; &#x41;&nbsp;b</p>"), "Q&A <live> \"now\" 'ok' A b.");
  assert.equal(htmlToSpeech("<p>Is it? Yes!</p>"), "Is it? Yes!");
  assert.equal(htmlToSpeech(""), "");
  assert.equal(htmlToSpeech("<p>  </p>"), "");
  assert.equal(htmlToSpeech('<p>He said "stop."</p>'), 'He said "stop."', "a stop inside a closing quote counts");
});

test("an item's script is its title, then its text, each ending in a stop", () => {
  assert.equal(itemScript({ title: "Channel overload", body: "<p>Too many places.</p>" }), "Channel overload. Too many places.");
  assert.equal(itemScript({ title: "What now?", body: "<p>Ask.</p>" }), "What now? Ask.");
  assert.equal(itemScript({ title: "Only a title", body: "" }), "Only a title.");
  assert.equal(itemScript({ title: "  ", body: "<p>Only text</p>" }), "Only text.");
});
