import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDraws, drawBanks, drawsFit, newSeed, seededRandom } from "./bank.ts";
import { Runtime } from "./runtime.ts";
import { decodeSuspend, encodeSuspend } from "./scorm.ts";
import { stableShuffle } from "./grading.ts";
import { buildQuestion } from "./questions.ts";
import { examplePackage, newRuntime } from "./test-helpers.ts";
import type { Bank, OSObject } from "./types.ts";

const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `slide-${String(from + i).padStart(3, "0")}`);
const bank = (over: Partial<Bank> = {}): Bank => ({ id: "bank-1", name: "Questions", slides: ids(6, 3), draw: 3, shuffle: false, ...over });
const course = ids(10);

test("the same seed always draws the same slides, and another seed draws others", () => {
  const a = drawBanks([bank()], course, 12345);
  assert.deepEqual(a, drawBanks([bank()], course, 12345));
  const different = new Set<string>();
  for (let seed = 1; seed <= 40; seed++) different.add(JSON.stringify(drawBanks([bank()], course, seed)));
  assert.ok(different.size > 10, `${different.size} different draws in 40 seeds`);
});

test("a draw has the right number of the bank's own slides, none twice, and in the author's order unless the bank mixes", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const d = drawBanks([bank()], course, seed)["bank-1"]!;
    assert.equal(d.length, 3);
    assert.equal(new Set(d).size, 3);
    assert.ok(d.every((id) => bank().slides.includes(id)));
    assert.deepEqual(d, [...d].sort(), "in course order");
  }
});

test("every slide of a bank has about the same chance of being shown, and a mixing bank shows them in all sorts of orders", () => {
  const count = new Map<string, number>();
  const firsts = new Set<string>();
  for (let seed = 1; seed <= 3000; seed++) {
    const d = drawBanks([bank({ shuffle: true })], course, seed * 7919)["bank-1"]!;
    for (const id of d) count.set(id, (count.get(id) ?? 0) + 1);
    firsts.add(d[0]!);
  }
  for (const id of bank().slides) {
    const n = count.get(id) ?? 0;
    assert.ok(n > 1300 && n < 1700, `${id} was shown ${n} times in 3000 (expected about 1500)`);
  }
  assert.equal(firsts.size, 6, "any slide can come first");
});

test("a bank that asks for more than it has shows all it has, and a bank draws only slides that are in the course", () => {
  assert.deepEqual(drawBanks([bank({ draw: 99 })], course, 5)["bank-1"], ids(6, 3));
  const gone = bank({ slides: [...ids(2, 3), "slide-099"], draw: 3 });
  assert.deepEqual(drawBanks([gone], course, 5)["bank-1"], ids(2, 3));
});

test("two banks are drawn separately", () => {
  const two = [bank(), bank({ id: "bank-2", slides: ids(2, 9), draw: 1 })];
  const d = drawBanks(two, course, 99);
  assert.equal(d["bank-1"]!.length, 3);
  assert.equal(d["bank-2"]!.length, 1);
});

test("the slides shown are the slides in no bank, and each bank's draw in the place of the bank", () => {
  const b = bank({ shuffle: true });
  const draws = { "bank-1": ["slide-007", "slide-004", "slide-005"] };
  assert.deepEqual(applyDraws(course.map((id) => ({ id })), [b], draws).map((s) => s.id),
    ["slide-001", "slide-002", "slide-007", "slide-004", "slide-005", "slide-009", "slide-010"]);
  assert.deepEqual(applyDraws(course.map((id) => ({ id })), [], {}).map((s) => s.id), course, "no banks, no change");
});

test("draws are good only for the banks they were made for", () => {
  const b = bank();
  const d = drawBanks([b], course, 3);
  assert.ok(drawsFit([b], d, course));
  assert.ok(!drawsFit([b], undefined, course));
  assert.ok(!drawsFit([b], null, course));
  assert.ok(!drawsFit([b], {}, course), "a bank with no draw");
  assert.ok(!drawsFit([b], { "bank-1": ["slide-003", "slide-003", "slide-004"] }, course), "a slide twice");
  assert.ok(!drawsFit([b], { "bank-1": ["slide-003", "slide-004"] }, course), "too few");
  assert.ok(!drawsFit([b], { "bank-1": ["slide-001", "slide-004", "slide-005"] }, course), "a slide that is not in the bank");
  assert.ok(!drawsFit([b], { "bank-1": [3, 4, 5] }, course), "not slide ids");
  assert.ok(!drawsFit([b], { ...d, "bank-9": [] }, course), "a bank that is gone");
  assert.ok(!drawsFit([bank({ draw: 4 })], d, course), "the author asked for more since");
  assert.ok(!drawsFit([b], d, course.filter((id) => id !== d["bank-1"]![0])), "a drawn slide was deleted");
});

test("a seed is never 0, and the generator gives numbers from 0 to under 1", () => {
  for (let i = 0; i < 50; i++) assert.ok(newSeed() >= 1);
  const r = seededRandom(7);
  for (let i = 0; i < 1000; i++) { const x = r(); assert.ok(x >= 0 && x < 1); }
});

// ---- the course the learner plays

test("the runtime shows only the drawn slides: the position, the next slide and the totals follow", () => {
  const { rt, pkg } = newRuntime();
  const [first, second] = pkg.slides;
  rt.useSlides([second!, first!]);
  assert.deepEqual(pkg.slides.map((s) => s.id), [second!.id, first!.id], "the package itself is what the player and the score see");
  rt.goTo(second!.id);
  assert.equal(rt.slideIndex, 0);
  rt.goTo(first!.id);
  assert.equal(rt.slideIndex, 1);
  rt.useSlides([first!]);
  rt.goTo(second!.id);
  assert.equal(rt.currentSlide?.id, first!.id, "a slide that is not shown cannot be gone to");
});

test("what a learner was drawn is saved with their progress and comes back", () => {
  const { rt } = newRuntime();
  rt.session = { seed: 4242, draws: { "bank-1": ["slide-004", "slide-006"] } };
  rt.goTo(rt.pkg.slides[0]!.id);
  const snap = rt.snapshot();
  assert.equal(snap.seed, 4242);
  assert.deepEqual(snap.draws, { "bank-1": ["slide-004", "slide-006"] });
  const back = decodeSuspend(encodeSuspend(snap))!;
  assert.equal(back.seed, 4242);
  assert.deepEqual(back.draws, { "bank-1": ["slide-004", "slide-006"] });
  const fresh = newRuntime().rt.snapshot();
  assert.equal(fresh.seed, undefined, "a course with no shuffling or banks saves nothing extra");
  assert.equal(fresh.draws, undefined);
});

test("the draws survive the suspend data being cut down to fit", () => {
  const { rt } = newRuntime();
  rt.session = { seed: 77, draws: { "bank-1": ["slide-004", "slide-006"] } };
  rt.goTo(rt.pkg.slides[0]!.id);
  const snap = rt.snapshot();
  snap.vars = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`var-${i}`, "x".repeat(12)]));
  const text = encodeSuspend(snap);
  assert.ok(text.length <= 4096);
  const back = decodeSuspend(text)!;
  assert.equal(back.seed, 77);
  assert.deepEqual(back.draws, { "bank-1": ["slide-004", "slide-006"] });
});

test("progress saved before banks existed still opens, and a damaged draw is ignored", () => {
  assert.equal(decodeSuspend('{"v":1,"s":"slide-001"}')!.seed, undefined);
  assert.equal(decodeSuspend('{"v":1,"s":"slide-001","r":"x","b":[1,2]}')!.seed, undefined);
  assert.equal(decodeSuspend('{"v":1,"s":"slide-001","r":"x","b":[1,2]}')!.draws, undefined);
});

// ---- shuffling answers

interface El { tag: string; className: string; textContent: string; attrs: Map<string, string>; kids: El[]; value: string; checked: boolean; setAttribute(k: string, v: string): void; append(...k: (El | Text)[]): void; appendChild(k: El): El }
const fakeDoc = {
  createElement(tag: string): El {
    const e: El = { tag, className: "", textContent: "", attrs: new Map(), kids: [], value: "", checked: false, setAttribute(k, v) { e.attrs.set(k, v); if (k === "value") e.value = v; }, append(...k) { e.kids.push(...(k as El[])); }, appendChild(k) { e.kids.push(k); return k; } };
    return e;
  },
  createTextNode(t: string) { return { tag: "#text", textContent: t, kids: [], className: "", attrs: new Map() } as unknown as El; },
};
const choiceQuestion = (shuffle?: boolean): OSObject => ({
  id: "obj-0040", type: "quizQuestion", name: "Question", geometry: { x: 0, y: 0, width: 10, height: 10, rotation: 0, z: 0 },
  content: { questionType: "multipleChoice", scoring: { points: 1, attemptsAllowed: 1 }, feedback: { correct: "a", incorrect: "b" }, ...(shuffle === undefined ? {} : { shuffle }),
    choices: ["one", "two", "three", "four", "five"].map((label, i) => ({ id: `c${i + 1}`, label, correct: i === 0 })) },
  style: {}, accessibility: { altText: "Q", role: "group", tabOrder: 1, decorative: false }, states: {}, triggers: [],
  timing: { appear: "time", start: 0, visibleFor: null }, animation: { enter: { effect: "none", duration: 500 }, exit: { effect: "none", duration: 500 } }, narration: null, provenance: null, simulation: null,
}) as unknown as OSObject;
const labels = (obj: OSObject, ctx: { editing: boolean; seed?: string }): string[] => {
  const view = buildQuestion(fakeDoc as unknown as Document, obj, ctx) as unknown as { el: El };
  const out: string[] = [];
  const walk = (e: El) => { if (e.className === "os-choice") out.push(e.kids.map((k) => k.textContent).join("").trim()); e.kids.forEach(walk); };
  walk(view.el);
  return out;
};

test("answers are shuffled for a learner when the question says so, the same way each time, and left alone otherwise", () => {
  const authored = ["one", "two", "three", "four", "five"];
  assert.deepEqual(labels(choiceQuestion(), { editing: false, seed: "5" }), authored, "not asked to shuffle");
  assert.deepEqual(labels(choiceQuestion(false), { editing: false, seed: "5" }), authored);
  const a = labels(choiceQuestion(true), { editing: false, seed: "5" });
  assert.notDeepEqual(a, authored);
  assert.deepEqual([...a].sort(), [...authored].sort(), "the same answers, none lost");
  assert.deepEqual(a, labels(choiceQuestion(true), { editing: false, seed: "5" }), "the same learner sees the same order again");
  const orders = new Set<string>();
  for (let s = 1; s <= 30; s++) orders.add(labels(choiceQuestion(true), { editing: false, seed: String(s) }).join());
  assert.ok(orders.size > 5, "other learners see other orders");
  assert.deepEqual(a.map((l) => l), stableShuffle(authored, "5:obj-0040"), "from the learner's number and the question");
});

test("the editor shows the author's own order, and so does a course with no number to shuffle by", () => {
  const authored = ["one", "two", "three", "four", "five"];
  assert.deepEqual(labels(choiceQuestion(true), { editing: true, seed: "5" }), authored);
  assert.deepEqual(labels(choiceQuestion(true), { editing: false }), authored);
});

test("the example course still plays with no banks", () => {
  const pkg = examplePackage();
  assert.equal(pkg.project.banks, undefined);
  const rt = new Runtime(pkg, { showSlide() {}, setLayerVisible() {}, playMedia() {}, pauseMedia() {}, stopTimer() {}, setObjectState() {} });
  assert.equal(rt.session.seed, 0);
});
