// A text that comes in or goes away one paragraph at a time (a text object's timing.paragraphs, format 0.41.0), in the editor: finding the paragraphs, the words for what
// they do, the changes the model allows, undo, and the real validator.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { blocksOf, blockWords } from "../../player/src/paragraphs.ts";
import type { OSObject } from "../../player/src/types.ts";
import { Model } from "./model.ts";
import { brief, paragraphsOf, partsFor } from "./paragraphs.ts";
import { parseHtml, type HChild } from "./richtext.ts";
import { newProjectFiles } from "./template.ts";
import { describeParagraphs, describeTiming, stepsUsed } from "./timing.ts";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cases = JSON.parse(readFileSync(path.join(repo, "player", "src", "paragraph-cases.json"), "utf-8")) as { html: string; blocks: string[] }[];

function fresh(): Model {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-10-23" });
  return new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
}

const THREE = "<p>One</p><ul><li>Two</li><li>Three</li></ul>";

/** A text with three paragraphs, and a second text, on the first slide. */
function withText(html = THREE): { m: Model; t: OSObject; other: OSObject } {
  const m = fresh();
  const t = m.addObject("text")!;
  m.setName(t.id, "Body");
  m.setHtml(t.id, html);
  const other = m.addObject("text")!;
  m.setName(other.id, "Other");
  return { m, t, other };
}
const find = (m: Model, id: string) => m.slide!.baseLayer.objects.find((o) => o.id === id)!;

// ---- finding the paragraphs

/** Elements as far as the player's rule looks at them, made from the editor's own reading of the same HTML, so the two rules can be set against each other. */
interface Fake { tagName: string; children: Fake[]; textContent: string }
function fakeOf(nodes: HChild[]): Fake {
  const make = (c: HChild): { fake: Fake | null; words: string } => {
    if (typeof c === "string") return { fake: null, words: c };
    const inside = c.kids.map(make);
    const words = inside.map((x) => x.words).join("");
    return { fake: { tagName: c.tag.toUpperCase(), children: inside.flatMap((x) => (x.fake ? [x.fake] : [])), textContent: words }, words };
  };
  const inside = nodes.map(make);
  return { tagName: "DIV", children: inside.flatMap((x) => (x.fake ? [x.fake] : [])), textContent: inside.map((x) => x.words).join("") };
}

test("the paragraphs of a text are found the same way by the editor, by the page, and as the cases say", () => {
  for (const c of cases) {
    assert.deepEqual(paragraphsOf(c.html), c.blocks, `editor: ${c.html}`);
    const page = blocksOf(fakeOf(parseHtml(c.html)) as unknown as Element).map((b) => blockWords(b));
    assert.deepEqual(page, c.blocks, `page: ${c.html}`);
  }
});

test("timing for some paragraphs is cut or filled out to a number of paragraphs with always-there ones, as a copy", () => {
  const given = [{ appear: "click" as const, step: 3, start: 0, visibleFor: null }];
  const more = partsFor(3, given);
  assert.deepEqual(more.map((p) => p.appear), ["click", "time", "time"]);
  more[0]!.step = 9;
  assert.equal(given[0]!.step, 3, "a copy");
  assert.equal(partsFor(0, given).length, 0);
  assert.equal(partsFor(2, undefined).length, 2);
  assert.equal(brief("short"), "short");
  assert.equal(brief("a".repeat(100)).length, 48);
});

// ---- the words for what they do

test("paragraphs that come at items in order are said as one sentence, and anything else one by one", () => {
  const click = (step: number, more: object = {}) => ({ appear: "click" as const, step, start: 0, visibleFor: null, ...more });
  const plain = { appear: "time" as const, start: 0, visibleFor: null };
  assert.equal(describeParagraphs([plain, plain]), "");
  assert.equal(describeParagraphs([click(1), click(2), click(3)]), "Comes in one paragraph at a time, items 1 to 3.");
  assert.equal(describeParagraphs([click(4), click(5)]), "Comes in one paragraph at a time, items 4 to 5.");
  assert.equal(describeParagraphs([click(1), click(1)]), "Paragraph 1 appears when the learner shows item 1, then stays. Paragraph 2 appears when the learner shows item 1, then stays.");
  assert.equal(describeParagraphs([plain, click(2, { until: { step: 3, start: 0 } })]), "Paragraph 2 appears when the learner shows item 2, then goes away when the learner shows item 3. The other paragraphs are always there.");
  assert.equal(describeParagraphs([{ ...plain, until: { step: 1, start: 0 } }, { ...plain, until: { step: 2, start: 0 } }]), "Paragraph 1 shows when the slide opens, then goes away when the learner shows item 1. Paragraph 2 shows when the slide opens, then goes away when the learner shows item 2.");
  const t = { appear: "time" as const, start: 0, visibleFor: null, paragraphs: [click(1), click(2)] };
  assert.equal(describeTiming(t), "Shows when the slide opens, then stays. Comes in one paragraph at a time, items 1 to 2.");
  assert.deepEqual(stepsUsed(t), [1, 2]);
  assert.deepEqual(stepsUsed({ appear: "click", step: 5, start: 0, visibleFor: null, until: { step: 7, start: 0 }, paragraphs: [click(1, { until: { step: 9, start: 0 } })] }), [5, 7, 1, 9]);
});

// ---- the model

test("a text is made to come in one paragraph at a time: each paragraph is the next item after the layer's last, and undo puts it back", () => {
  const { m, t, other } = withText();
  m.setTiming(other.id, { appear: "click", step: 4 });
  const r = m.buildByParagraph(t.id, true);
  assert.equal(r.ok, true);
  assert.match(r.message, /Body: Shows when the slide opens, then stays\. Comes in one paragraph at a time, items 5 to 7\./);
  assert.deepEqual(find(m, t.id).timing.paragraphs?.map((p) => p.step), [5, 6, 7]);
  assert.equal(find(m, t.id).timing.appear, "time", "the box itself is there from the start");
  assert.equal(m.paragraphCount(t.id), 3);
  assert.equal(m.waitingSteps(m.slide!.id), 4, "item 4 and items 5 to 7");
  m.undo();
  assert.equal(find(m, t.id).timing.paragraphs, undefined);
  m.redo();
  assert.equal(find(m, t.id).timing.paragraphs?.length, 3);
  assert.equal(m.buildByParagraph(t.id, false).ok, true);
  assert.equal(find(m, t.id).timing.paragraphs, undefined, "all together again");
  assert.deepEqual(m.buildByParagraph(t.id, false), { ok: true, message: "" }, "nothing to take away");
});

test("only a text can come in a paragraph at a time, and not when it has none", () => {
  const { m } = withText();
  const shape = m.addObject("shape")!;
  assert.match(m.buildByParagraph(shape.id, true).message, /Only a text/);
  assert.match(m.setParagraphTiming(shape.id, 0, { appear: "click" }).message, /Only a text/);
  assert.equal(m.paragraphCount(shape.id), 0);
  const empty = m.addObject("text")!;
  m.setHtml(empty.id, "just loose words");
  assert.match(m.buildByParagraph(empty.id, true).message, /no paragraphs/);
});

test("one paragraph is timed on its own: when it appears, when it goes away, and a paragraph that is always there again has no timing", () => {
  const { m, t } = withText();
  assert.equal(m.setParagraphTiming(t.id, 1, { appear: "click", step: 2 }).ok, true);
  assert.deepEqual(find(m, t.id).timing.paragraphs?.map((p) => p.appear), ["time", "click", "time"]);
  assert.match(m.setParagraphTiming(t.id, 1, { until: { step: 5, start: 500 } }).message, /Paragraph 2 appears when the learner shows item 2, then goes away 0\.5 seconds after the learner shows item 5/);
  assert.deepEqual(find(m, t.id).timing.paragraphs![1], { appear: "click", step: 2, start: 0, visibleFor: null, until: { step: 5, start: 500 } });
  assert.equal(m.setParagraphTiming(t.id, 1, { until: undefined }).ok, true);
  assert.equal(find(m, t.id).timing.paragraphs![1]!.until, undefined, "named away: taken away");
  assert.equal(m.setParagraphTiming(t.id, 2, { appear: "click" }).ok, true);
  assert.equal(find(m, t.id).timing.paragraphs![2]!.step, 3, "a new step goes after the last one on the layer");
  assert.equal(m.setParagraphTiming(t.id, 1, { appear: "time" }).ok, true);
  assert.equal(m.setParagraphTiming(t.id, 2, { appear: "time" }).ok, true);
  assert.equal(find(m, t.id).timing.paragraphs, undefined, "all always there: no timing of its own");
  assert.deepEqual(m.setParagraphTiming(t.id, 1, { appear: "time" }), { ok: true, message: "" });
});

test("a paragraph timing that is not allowed is refused, and nothing changes", () => {
  const { m, t } = withText();
  for (const [patch, say] of [
    [{ appear: "click", step: 0 }, /item number/],
    [{ appear: "click", step: 201 }, /item number/],
    [{ appear: "click", step: 1.5 }, /item number/],
    [{ appear: "narration" }, /after the slide opens, or when/],
    [{ appear: "time", start: -1 }, /from 0 to 3600/],
    [{ appear: "time", visibleFor: 0 }, /thousandth/],
    [{ until: { step: 0, start: 0 } }, /goes away at/],
    [{ until: { step: 2, start: 4_000_000 } }, /time after that item/],
  ] as const) {
    const r = m.setParagraphTiming(t.id, 0, patch as never);
    assert.equal(r.ok, false, JSON.stringify(patch));
    assert.match(r.message, say);
  }
  assert.match(m.setParagraphTiming(t.id, 7, { appear: "click" }).message, /not in the text/);
  assert.equal(find(m, t.id).timing.paragraphs, undefined);
});

test("the timing of the paragraphs is kept through any other change of timing, and is cut or filled out when the words change", () => {
  const { m, t } = withText();
  m.buildByParagraph(t.id, true);
  m.setTiming(t.id, { start: 1000 });
  assert.equal(find(m, t.id).timing.paragraphs?.length, 3, "kept");
  assert.equal(find(m, t.id).timing.start, 1000);
  // A paragraph is added: the timing is filled out with one that is always there.
  const said = m.setHtml(t.id, THREE + "<p>Four</p>");
  assert.match(said ?? "", /The text now has 4 paragraphs, so the timing of its paragraphs was cut or filled out/);
  assert.deepEqual(find(m, t.id).timing.paragraphs?.map((p) => p.appear), ["click", "click", "click", "time"]);
  // Paragraphs are taken away: it is cut.
  assert.match(m.setHtml(t.id, "<p>Only</p>") ?? "", /1 paragraph,/);
  assert.equal(find(m, t.id).timing.paragraphs?.length, 1);
  // Nothing timed is left: no timing of its own.
  m.setParagraphTiming(t.id, 0, { appear: "time" });
  assert.equal(find(m, t.id).timing.paragraphs, undefined);
  assert.equal(m.setHtml(t.id, THREE), "Text updated", "no timing to say anything about");
});

test("a new item for another object goes after the items the paragraphs use", () => {
  const { m, t, other } = withText();
  m.buildByParagraph(t.id, true);
  m.setTiming(other.id, { appear: "click" });
  assert.equal(find(m, other.id).timing.step, 4);
});

test("a text built paragraph by paragraph passes the real validator, and one with the wrong number of timings is warned about", () => {
  const { m, t } = withText();
  m.buildByParagraph(t.id, true);
  const run = () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "os-para-"));
    try {
      for (const f of m.allFiles()) {
        const p = path.join(dir, f.path);
        mkdirSync(path.dirname(p), { recursive: true });
        writeFileSync(p, f.text);
      }
      const r = spawnSync("python", [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf-8" });
      return JSON.parse(r.stdout || "[]") as { rule: string; severity: string }[];
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  assert.deepEqual(run().filter((f) => f.rule.startsWith("timing") || f.rule === "schema").map((f) => f.rule), []);
  // The words are changed outside the editor's own care: three timings for two paragraphs.
  find(m, t.id).content = { ...find(m, t.id).content, html: "<p>One</p><p>Two</p>" };
  assert.deepEqual(run().filter((f) => f.rule.startsWith("timing")).map((f) => f.rule), ["timing-paragraphs-count"]);
});
