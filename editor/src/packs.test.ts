// Tests for character packs in the editor: reading what the shell says, the credit a pack's picture earns, and the voice a chosen person gets.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Character } from "../../player/src/types.ts";
import { chosenMessage, creditForPicture, creditLine, isPlaceholderName, PACKS_PAGE_FAILED, PACKS_PAGE_OPENED, PACKS_PAGE_URL, parsePackAnswer, parsePackList, voiceFor, whereFrom, type Pack } from "./packs.ts";

const pack = (over: Record<string, unknown> = {}) => ({
  id: "test-people", title: "Test people", version: "1.0.0", description: "Two people.", bytes: 1234, source: "bundled", folder: "test-people",
  credit: { creator: "A. Maker", creatorUrl: "https://example.org/a", licence: "Free to use in courses made with OpenStage Author.", url: "https://example.org/packs" },
  people: [
    { id: "ann", name: "Ann", role: "Nurse", voice: "female", alt: "Ann, a woman in a blue coat.", head: "ann/head.png", poses: [{ id: "neutral", label: "Standing", alt: "Ann standing.", file: "ann/neutral.png" }] },
    { id: "bob", name: "Bob", voice: "male", alt: "Bob, a man in a grey suit.", head: "bob/head.png", poses: [] },
  ],
  ...over,
});

const list = (packs: unknown[], broken: unknown[] = []) => JSON.stringify({ ok: true, packs, broken });

test("the list the shell gives is read into packs, people and poses", () => {
  const got = parsePackList(list([pack()], [{ folder: "damaged", source: "yours", message: "The picture ann/head.png is not in the pack." }]));
  assert.equal(got.packs.length, 1);
  const p = got.packs[0]!;
  assert.deepEqual([p.id, p.title, p.version, p.source, p.folder, p.bytes], ["test-people", "Test people", "1.0.0", "bundled", "test-people", 1234]);
  assert.deepEqual(p.people.map((x) => [x.id, x.name, x.voice, x.head, x.poses.length]), [["ann", "Ann", "female", "ann/head.png", 1], ["bob", "Bob", "male", "bob/head.png", 0]]);
  assert.equal(p.people[1]!.role, "", "a missing role is empty");
  assert.equal(p.people[0]!.poses[0]!.label, "Standing");
  assert.deepEqual(got.broken, [{ folder: "damaged", source: "yours", message: "The picture ann/head.png is not in the pack." }]);
});

test("nonsense is no packs, and a pack that makes no sense is left out", () => {
  assert.deepEqual(parsePackList("garbage"), { packs: [], broken: [] });
  assert.deepEqual(parsePackList("[]"), { packs: [], broken: [] });
  assert.deepEqual(parsePackList("null"), { packs: [], broken: [] });
  const got = parsePackList(list([pack({ id: "" }), pack({ folder: "" }), pack({ people: [] }), pack({ people: [{ id: "x" }, "no", null] }), pack({ id: "good-one" })]));
  assert.deepEqual(got.packs.map((p) => p.id), ["good-one"]);
  const odd = parsePackList(list([pack({ source: "elsewhere", people: [{ id: "x", head: "x/h.png", voice: "robot" }] })]));
  assert.equal(odd.packs[0]!.source, "bundled");
  assert.equal(odd.packs[0]!.people[0]!.voice, "any", "a voice hint that is not female or male is any");
  assert.equal(odd.packs[0]!.people[0]!.name, "x", "a person with no name is shown by their id");
});

test("the answer after installing or removing is read, whatever it is", () => {
  assert.deepEqual(parsePackAnswer(JSON.stringify({ ok: true, message: "Installed the pack." })), { ok: true, message: "Installed the pack." });
  assert.deepEqual(parsePackAnswer(JSON.stringify({ ok: false, message: "That is not a zip file." })), { ok: false, message: "That is not a zip file." });
  assert.equal(parsePackAnswer(JSON.stringify({ ok: "yes" })).ok, false, "only a real yes counts");
  assert.equal(parsePackAnswer("garbage").ok, false);
  assert.match(parsePackAnswer("garbage").message, /could not be read/);
});

test("a pack says where it came from and who made it", () => {
  const p = parsePackList(list([pack()])).packs[0]! as Pack;
  assert.equal(whereFrom(p), "Came with OpenStage Author");
  assert.equal(whereFrom({ ...p, source: "yours" }), "Added by you");
  assert.equal(creditLine(p), "By A. Maker. Free to use in courses made with OpenStage Author.");
  assert.equal(creditLine({ ...p, credit: { ...p.credit, licence: "" } }), "By A. Maker.");
});

test("a picture from a pack is credited to its maker, with the licence and where it is from, and no double full stop", () => {
  const p = parsePackList(list([pack()])).packs[0]! as Pack;
  const credit = creditForPicture(p, p.people[0]!, "assets/images/ann.png");
  assert.deepEqual(credit, {
    path: "assets/images/ann.png", title: "Ann (character picture)", kind: "image",
    source: { provider: "other", url: "https://example.org/packs", creator: "A. Maker", creatorUrl: "https://example.org/a", licence: "Free to use in courses made with OpenStage Author", requiresCredit: true },
  });
});

test("only a person nobody has named is a placeholder", () => {
  for (const yes of ["Person 1", "Person 12", " Person 3 "]) assert.equal(isPlaceholderName(yes), true, yes);
  for (const no of ["Ann", "Person", "Person A", "Persona 3", "Person 3 Lee", ""]) assert.equal(isPlaceholderName(no), false, no);
});

const VOICES = ["af_heart", "af_bella", "am_adam", "am_eric", "bf_emma", "bm_george"];
const person = (id: string, voice: string): Character => ({ id, name: id, role: "", voice, picture: null });

test("a person from a pack keeps a voice that already fits and otherwise gets an unused one of the right kind", () => {
  assert.equal(voiceFor("female", [person("a", "af_heart")], "af_heart", VOICES), "af_heart", "already right");
  assert.equal(voiceFor("male", [person("a", "af_heart")], "af_heart", VOICES), "am_adam", "the first American man's voice");
  assert.equal(voiceFor("male", [person("a", "af_heart"), person("b", "am_adam")], "af_heart", VOICES), "am_eric", "one no one else has");
  assert.equal(voiceFor("female", [person("a", "am_adam"), person("b", "af_heart")], "am_adam", VOICES), "af_bella");
  assert.equal(voiceFor("any", [person("a", "af_heart")], "af_heart", VOICES), "af_heart", "any leaves it");
  assert.equal(voiceFor("male", [person("a", "af_heart")], "af_heart", ["af_heart", "bm_george"]), "bm_george", "a British voice if there is no American one");
  assert.equal(voiceFor("male", [person("a", "af_heart")], "af_heart", ["af_heart"]), "af_heart", "nothing fits, so nothing changes");
  assert.equal(voiceFor("female", [person("a", "openai:alloy")], "openai:alloy", VOICES), "af_heart", "a voice of another kind of engine has no kind, so it is replaced");
});

test("what is said after choosing a person names what was added", () => {
  assert.match(chosenMessage("Kathy", { name: true, voice: true }), /^Kathy chosen from the library: their picture, their name and a voice and a description/);
  assert.match(chosenMessage("Kathy", { name: false, voice: false }), /^Kathy chosen from the library: their picture and a description for the alt text were added/);
  assert.match(chosenMessage("Kathy", { name: false, voice: true }), /their picture, a voice and a description/);
  assert.match(chosenMessage("Kathy", { name: true, voice: false }), /their picture, their name and a description/);
  assert.match(chosenMessage("Kathy", { name: false, voice: false }), /change it if it is not right\.$/);
});

test("the packs page is a plain https address, and the words after opening it say where to go next", () => {
  assert.match(PACKS_PAGE_URL, /^https:\/\/openstageauthor\.com\/apps\/openstage\/packs$/, "one https address, nothing in it that the author's details could end up in");
  assert.match(PACKS_PAGE_OPENED, /Add a pack/, "it names the button to press once the zip is downloaded");
  assert.ok(PACKS_PAGE_FAILED.includes(PACKS_PAGE_URL), "if the browser cannot be opened, the address is there to type in");
  for (const words of [PACKS_PAGE_OPENED, PACKS_PAGE_FAILED]) assert.ok(!words.includes("—"), "no em dash in what is said");
});
