import assert from "node:assert/strict";
import { test } from "node:test";
import { narrationToPlay, speaksItself } from "./presenter.ts";
import type { NarrationAsset } from "./types.ts";

const asset = (script: string): NarrationAsset => ({ script, lang: "en-US", audio: "narration/x.wav", cues: [] });

test("a video made by the Presenter add-on speaks for itself, and nothing else does", () => {
  assert.equal(speaksItself({ presenter: { id: "lite-guide" } }), true);
  assert.equal(speaksItself({}), false);
});

test("the narration to play leaves out a presenter clip, keeps the order, and skips what has no narration", () => {
  const objects = [{ id: "a" }, { id: "clip", presenter: { id: "lite-guide" } }, { id: "none" }, { id: "b" }];
  const narration = { a: asset("one"), clip: asset("two"), b: asset("three") };
  assert.deepEqual(narrationToPlay(objects, narration).map((n) => n.id), ["a", "b"]);
  assert.deepEqual(narrationToPlay([], narration), []);
});
