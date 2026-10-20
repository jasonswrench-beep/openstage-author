import assert from "node:assert/strict";
import { test } from "node:test";
import { creditParts, creditsInUse, mergeCredits, narrationCredits, type CreditPart } from "./credits.ts";
import type { CreditEntry } from "./types.ts";

const words = (parts: CreditPart[]): string => parts.map((p) => p.text).join("");

const stock: CreditEntry = {
  path: "assets/images/a.jpg", title: "A flower", kind: "image",
  source: { provider: "unsplash", url: "https://unsplash.com/photos/a", creator: "Jane Doe", creatorUrl: "https://unsplash.com/@jane", licence: "Unsplash Licence", requiresCredit: true },
};

test("a library file reads as title, creator, library and licence, with links", () => {
  const parts = creditParts(stock);
  assert.equal(words(parts), "A flower, by Jane Doe, from Unsplash. Unsplash Licence.");
  assert.deepEqual(parts.filter((p) => "href" in p), [{ text: "Jane Doe", href: "https://unsplash.com/@jane" }, { text: "Unsplash", href: "https://unsplash.com/photos/a" }]);
});

test("a file from somewhere else has no library named", () => {
  const other = { ...stock, source: { ...stock.source, provider: "other" as const } };
  assert.equal(words(creditParts(other)), "A flower, by Jane Doe. Unsplash Licence.");
  assert.equal(words(creditParts({ ...other, title: "" })), "a.jpg, by Jane Doe. Unsplash Licence.");
});

test("a picture an AI service made says so, and links to the service", () => {
  const made: CreditEntry = {
    path: "assets/images/ai-a-red-barn.png", title: "A red barn", kind: "image",
    source: {
      provider: "generated", url: "https://openai.com/", creator: "OpenAI (gpt-image-1)", creatorUrl: "", licence: "AI-generated; the service's terms of use apply", requiresCredit: true,
      generated: { service: "openai", model: "gpt-image-1", prompt: "A red barn in the snow, secret words", madeAt: "2026-10-14T10:30:00Z" },
    },
  };
  const parts = creditParts(made);
  assert.equal(words(parts), "A red barn, made with OpenAI (gpt-image-1). AI-generated; the service's terms of use apply.");
  assert.deepEqual(parts.find((p) => "href" in p), { text: "OpenAI (gpt-image-1)", href: "https://openai.com/" });
  assert.ok(!words(parts).includes("secret words"), "the words that made it are kept in the project, not shown to learners");
});

test("an address that is not a web address is words, not a link", () => {
  const sneaky = { ...stock, source: { ...stock.source, creatorUrl: "javascript:alert(1)", url: "file:///etc/passwd" } };
  assert.ok(creditParts(sneaky).every((p) => !("href" in p)));
});

test("narration is credited once for each engine whose voices speak in the course", () => {
  const credits = narrationCredits([
    { engine: "kokoro", name: "Kokoro", where: "computer", home: "https://huggingface.co/hexgrad/Kokoro-82M" },
    { engine: "openai", name: "OpenAI", where: "internet", home: "https://openai.com/" },
    { engine: "kokoro", name: "Kokoro", where: "computer", home: "https://huggingface.co/hexgrad/Kokoro-82M" },
    { engine: "tone-voice", name: "Tone voice", where: "unknown" },
  ]);
  assert.deepEqual(credits.map((c) => c.path), ["narration/kokoro", "narration/openai", "narration/tone-voice"]);
  assert.equal(words(creditParts(credits[0]!)), "Narration, made with Kokoro. Synthetic voices made on this computer, not a person.");
  assert.equal(words(creditParts(credits[1]!)), "Narration, made with OpenAI. Synthetic voices from an AI service, not a person.");
  assert.equal(words(creditParts(credits[2]!)), "Narration, made with Tone voice. Synthetic voices, not a person.");
  assert.ok(creditParts(credits[2]!).every((p) => !("href" in p)), "no home page, no link");
  assert.deepEqual(narrationCredits([]), []);
});

const person = (name: string, path: string): CreditEntry => ({
  path, title: `${name} (character picture)`, kind: "image",
  source: { provider: "other", url: "https://openstageauthor.com", creator: "Jason S. Wrench", creatorUrl: "", licence: "Free to use in courses made with OpenStage Author", requiresCredit: true },
});

test("a credit is in use if the course names the file, on a slide or in the cast, and only then", () => {
  const recorded = [stock, person("Kathy", "assets/images/kathy.png"), person("Ken", "assets/images/ken.png")];
  const slides = JSON.stringify([{ objects: [{ content: { src: "assets/images/a.jpg" } }] }]);
  const cast = JSON.stringify([{ id: "kathy", picture: { src: "assets/images/kathy.png" } }]);
  assert.deepEqual(creditsInUse(recorded, slides).map((e) => e.path), ["assets/images/a.jpg"], "a person who is not in the course is not credited");
  assert.deepEqual(creditsInUse(recorded, slides + cast).map((e) => e.path), ["assets/images/a.jpg", "assets/images/kathy.png"], "a picture only the cast uses is credited");
});

test("an entry that says nothing about who made it is not on the credits page", () => {
  const nameless: CreditEntry = { ...stock, path: "assets/images/mine.png", source: { ...stock.source, provider: "other", creator: "" } };
  assert.deepEqual(creditsInUse([nameless, stock], "assets/images/mine.png assets/images/a.jpg").map((e) => e.path), ["assets/images/a.jpg"]);
});

test("credits that read the same are one line, and ones that read differently are kept", () => {
  const same = [person("Kathy", "assets/images/kathy.png"), person("Kathy", "assets/images/kathy-wave.png"), person("Ken", "assets/images/ken.png"), stock];
  assert.deepEqual(mergeCredits(same).map((e) => e.path), ["assets/images/kathy.png", "assets/images/ken.png", "assets/images/a.jpg"]);
  assert.deepEqual(mergeCredits([]), []);
});
