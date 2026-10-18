// Tests for the learner's accessibility settings: what is saved and read back, how they reach the page, which voice may read aloud, and how text is cut for a voice.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bandTop, browserStorage, DEFAULTS, describe, isDefault, loadSettings, needsReflow, normalise, pageSettings, pickVoice, RATE, saveSettings, speechChunks, STORAGE_KEY, type A11ySettings,
} from "./a11y.ts";

const fake = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
};
const some = (over: Partial<A11ySettings>): A11ySettings => ({ ...DEFAULTS, ...over });

test("the starting settings are the course's own, and say so", () => {
  assert.equal(isDefault(DEFAULTS), true);
  assert.equal(describe(DEFAULTS), "Everything is as the course has it.");
  assert.deepEqual(pageSettings(DEFAULTS), { attributes: {}, variables: {} }, "nothing is written to the page for the course's own");
  assert.equal(needsReflow(DEFAULTS), false);
});

test("anything saved that is not one of the choices goes back to the course's own", () => {
  assert.deepEqual(normalise(null), DEFAULTS);
  assert.deepEqual(normalise("text"), DEFAULTS);
  assert.deepEqual(normalise({ textSize: 175, lineSpacing: "huge", colours: "pink", readingLine: "yes", speed: 2 }), DEFAULTS);
  assert.deepEqual(normalise({ textSize: 200, lineSpacing: "wide", letterSpacing: "wider", colours: "dark", readingLine: true, speed: "slow", extra: 1 }),
    { textSize: 200, lineSpacing: "wide", letterSpacing: "wider", colours: "dark", readingLine: true, speed: "slow" });
});

test("bigger or more spaced text puts the slide in one column, and colours and the reading line do not", () => {
  assert.equal(needsReflow(some({ textSize: 125 })), true);
  assert.equal(needsReflow(some({ lineSpacing: "wide" })), true);
  assert.equal(needsReflow(some({ letterSpacing: "wider" })), true);
  assert.equal(needsReflow(some({ colours: "yellow", readingLine: true, speed: "fast" })), false);
});

test("what the page is given: attributes the stylesheet reads, and the amounts WCAG 1.4.12 names", () => {
  const p = pageSettings(some({ textSize: 150, lineSpacing: "wide", letterSpacing: "wide", colours: "contrast" }));
  assert.deepEqual(p.attributes, { "data-os-scale": "150", "data-os-lh": "wide", "data-os-ls": "wide", "data-os-colors": "contrast" });
  assert.deepEqual(p.variables, { "--os-a11y-scale": "1.5", "--os-a11y-lh": "1.5", "--os-a11y-ls": "0.12em", "--os-a11y-ws": "0.16em" });
  const q = pageSettings(some({ lineSpacing: "wider", letterSpacing: "wider", textSize: 300 }));
  assert.deepEqual([q.variables["--os-a11y-lh"], q.variables["--os-a11y-ls"], q.variables["--os-a11y-ws"], q.variables["--os-a11y-scale"]], ["2", "0.2em", "0.3em", "3"]);
});

test("what is different from the course's own is said in words", () => {
  assert.equal(describe(some({ textSize: 150, colours: "dark", readingLine: true })), "Now text size 150 percent, colours: dark, reading line on.");
  assert.equal(describe(some({ lineSpacing: "wide", letterSpacing: "wider", speed: "slow" })), "Now line spacing wide, letter and word spacing wider, reading speed slower.");
});

test("settings are kept on this computer and read back; the course's own are not kept at all", () => {
  const store = fake();
  assert.deepEqual(loadSettings(store), DEFAULTS, "nothing saved yet");
  assert.equal(saveSettings(store, some({ textSize: 200, colours: "yellow" })), true);
  assert.ok(store.data.has(STORAGE_KEY));
  assert.deepEqual(loadSettings(store), some({ textSize: 200, colours: "yellow" }));
  assert.equal(saveSettings(store, DEFAULTS), true);
  assert.equal(store.data.size, 0, "putting everything back leaves nothing behind");
});

test("where the browser does not let settings be kept, they last for the visit and nothing breaks", () => {
  assert.equal(saveSettings(null, some({ textSize: 150 })), false);
  assert.deepEqual(loadSettings(null), DEFAULTS);
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  assert.equal(saveSettings(blocked, some({ textSize: 150 })), false);
  assert.deepEqual(loadSettings(blocked), DEFAULTS);
  assert.deepEqual(loadSettings(fake({ [STORAGE_KEY]: "not json" })), DEFAULTS);
  assert.equal(browserStorage(null), null);
  assert.equal(browserStorage({ get localStorage(): Storage { throw new Error("denied"); } } as never), null);
  assert.equal(browserStorage({ localStorage: { setItem: () => { throw new Error("full"); }, removeItem: () => undefined } as never }), null);
  const ok = fake();
  assert.ok(browserStorage({ localStorage: ok as never }));
  assert.equal(ok.data.size, 0, "the check leaves nothing behind");
});

const voice = (name: string, lang: string, localService: boolean, isDefault = false) => ({ name, lang, localService, default: isDefault });

test("only a voice that runs on this computer reads aloud, in the course's language, the computer's default first", () => {
  const voices = [voice("Online English", "en-US", false, true), voice("Zira", "en-US", true), voice("David", "en-US", true, true), voice("Hazel", "en-GB", true), voice("Hortense", "fr-FR", true)];
  assert.equal(pickVoice(voices, "en-US")?.name, "David", "the default of the matching ones");
  assert.equal(pickVoice(voices, "en-GB")?.name, "Hazel", "the same region first");
  assert.equal(pickVoice(voices, "en")?.name, "David", "any English when the course only says en");
  assert.equal(pickVoice(voices, "fr")?.name, "Hortense");
  assert.equal(pickVoice(voices, "de-DE"), null, "no German voice here");
  assert.equal(pickVoice([voice("Online only", "en-US", false)], "en-US"), null, "a voice that sends the words away is never used");
  assert.equal(pickVoice([], "en"), null);
  assert.equal(pickVoice([voice("Zira", "en_US", true)], "en-us")?.name, "Zira", "underscores and capitals do not matter");
});

test("text is cut into pieces a voice can be given one at a time, never in the middle of a word", () => {
  assert.deepEqual(speechChunks("Your score is 8 out of 10. You passed."), ["Your score is 8 out of 10. You passed."]);
  assert.deepEqual(speechChunks("One.\n\nTwo.\nThree."), ["One.", "Two.", "Three."], "a new line is a new piece");
  const long = "This is one sentence. ".repeat(20).trim();
  const chunks = speechChunks(long, 60);
  assert.ok(chunks.length > 5 && chunks.every((c) => c.length <= 60), JSON.stringify(chunks.map((c) => c.length)));
  assert.equal(chunks.join(" "), long, "nothing is lost");
  const words = Array.from({ length: 80 }, (_v, i) => `word${i}`).join(" ");
  const cut = speechChunks(words, 50);
  assert.ok(cut.every((c) => c.length <= 50) && cut.join(" ") === words);
  assert.deepEqual(speechChunks("   \n  "), []);
});

test("reading speeds, and where the reading line sits", () => {
  assert.deepEqual([RATE.slow, RATE.normal, RATE.fast], [0.8, 1, 1.3]);
  assert.equal(bandTop(300, 40, 800), 280);
  assert.equal(bandTop(5, 40, 800), 0, "not above the top of the window");
  assert.equal(bandTop(790, 40, 800), 760, "not below the bottom");
});
