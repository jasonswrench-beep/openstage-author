import assert from "node:assert/strict";
import { test } from "node:test";
import { blocksOf, blockWords, partId, partOf } from "./paragraphs.ts";

/** Elements as far as the paragraph rule looks at them: a tag, the elements inside, and the words. (The real page, and the editor's reader, are checked on the same cases elsewhere.) */
interface Fake { tagName: string; children: Fake[]; textContent: string }
const el = (tag: string, ...inside: (Fake | string)[]): Fake => {
  const kids = inside.filter((x): x is Fake => typeof x !== "string");
  return { tagName: tag.toUpperCase(), children: kids, textContent: inside.map((x) => (typeof x === "string" ? x : x.textContent)).join("") };
};
const as = (f: Fake) => f as unknown as Element;
const words = (list: HTMLElement[]) => list.map((b) => blockWords(b));

test("a part's id says its object and its number, and nothing else is taken for one", () => {
  assert.equal(partId("obj-0003", 2), "obj-0003#2");
  assert.deepEqual(partOf("obj-0003#2"), { objectId: "obj-0003", index: 2 });
  assert.equal(partOf("obj-0003"), null);
  assert.equal(partOf("obj-0003#x"), null);
  assert.equal(partOf("#2"), null);
});

test("paragraphs, headings and quotations count; a list counts by its items, and a list inside an item goes with it", () => {
  const root = el("div", el("p", "Intro"), el("ul", el("li", "A"), el("li", "B", el("ul", el("li", "B1"), el("li", "B2"))), el("li", "C")), el("h2", "Head"), el("blockquote", "Quote"));
  assert.deepEqual(words(blocksOf(as(root))), ["Intro", "A", "BB1B2", "C", "Head", "Quote"]);
});

test("words outside every paragraph are not one, and a list with something else in it counts only its items", () => {
  const root = el("div", "loose words", el("strong", "bold"), el("ol", el("span", "x"), el("li", "One")));
  assert.deepEqual(words(blocksOf(as(root))), ["One"]);
  assert.deepEqual(blocksOf(as(el("div"))), []);
});

test("what a paragraph says is on one line", () => {
  assert.equal(blockWords(as(el("p", "  spaced \n  out  "))), "spaced out");
});
