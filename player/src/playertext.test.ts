import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { setPlayerText, t, tn } from "./playertext.ts";

afterEach(() => setPlayerText(undefined));

test("a key says its English until the course says otherwise", () => {
  assert.equal(t("nav.next"), "Next");
  assert.equal(t("nav.back"), "Back");
  setPlayerText({ "nav.next": "Suivant" });
  assert.equal(t("nav.next"), "Suivant");
  assert.equal(t("nav.back"), "Back", "a key the course left out keeps its English");
  setPlayerText(undefined);
  assert.equal(t("nav.next"), "Next", "and undefined goes back to the defaults");
});

test("places in a phrase are filled in, and a place with no value is left alone", () => {
  assert.equal(t("nav.slideOf", { n: 2, total: 9 }), "Slide 2 of 9");
  assert.equal(t("nav.slideOf", { n: 2 }), "Slide 2 of {total}");
  assert.equal(t("nav.slideOf"), "Slide {n} of {total}");
  setPlayerText({ "nav.slideOf": "Diapositive {n} sur {total}" });
  assert.equal(t("nav.slideOf", { n: 2, total: 9 }), "Diapositive 2 sur 9");
  setPlayerText({ "nav.slideOf": "{total} en tout, vous êtes à la {n}e, {n} !" });
  assert.equal(t("nav.slideOf", { n: 2, total: 9 }), "9 en tout, vous êtes à la 2e, 2 !", "a place can come first, or twice");
});

test("a value that looks like a place, or like a pattern, is put in as it is", () => {
  setPlayerText({ "nav.slideOf": "{n}/{total}" });
  assert.equal(t("nav.slideOf", { n: "$&", total: "{n}" }), "$&/{n}");
});

test("keys that are not the player's, and empty phrases, are ignored", () => {
  setPlayerText({ "nav.next": "   ", "nav.nonsense": "x", "__proto__": "y", constructor: "z" } as Record<string, string>);
  assert.equal(t("nav.next"), "Next");
  assert.equal(t("nav.nonsense" as never), "nav.nonsense", "asking for a key that does not exist gives the key, so nothing throws");
  setPlayerText({ "nav.next": 5 } as unknown as Record<string, string>);
  assert.equal(t("nav.next"), "Next");
});

test("setting the words again replaces the earlier ones, not adds to them", () => {
  setPlayerText({ "nav.next": "Suivant", "nav.back": "Retour" });
  setPlayerText({ "nav.back": "Précédent" });
  assert.equal(t("nav.next"), "Next");
  assert.equal(t("nav.back"), "Précédent");
});
