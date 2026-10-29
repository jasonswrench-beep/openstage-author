// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { addClip, addTrack, createModel, findClip, isRect, setPlacement, webcamChoiceOf, webcamRect, WEBCAM_SIZES, WEBCAM_WHERE, FULL } from "../src/index.ts";

test("the usual place is bottom right and medium, exactly where the video maker draws a webcam when nothing is said", () => {
  // openstage-capture-render's DEFAULT_WEBCAM_PLACE: x 7550, y 7350, 2200 wide and high.
  assert.deepEqual(webcamRect("bottom-right", "medium"), { x: 7550, y: 7350, width: 2200, height: 2200 });
  assert.deepEqual(webcamChoiceOf(undefined), { where: "usual", size: "medium" });
});

test("every corner and size is a rectangle inside the picture, as wide as it is high, and the corners are the corners", () => {
  for (const where of WEBCAM_WHERE) {
    if (where === "usual") continue;
    for (const size of WEBCAM_SIZES) {
      const r = webcamRect(where, size);
      assert.ok(isRect(r), `${where} ${size}`);
      assert.equal(r.width, where === "fill" ? FULL : r.height, "keeps the shape of the frame");
    }
  }
  const small = webcamRect("top-left", "small");
  const large = webcamRect("top-left", "large");
  assert.ok(small.width < webcamRect("top-left", "medium").width && webcamRect("top-left", "medium").width < large.width, "small, medium, large grow");
  assert.deepEqual([webcamRect("top-left", "medium").x < 1000, webcamRect("top-left", "medium").y < 1000], [true, true]);
  assert.deepEqual([webcamRect("top-right", "medium").x > 5000, webcamRect("top-right", "medium").y < 1000], [true, true]);
  assert.deepEqual([webcamRect("bottom-left", "medium").x < 1000, webcamRect("bottom-left", "medium").y > 5000], [true, true]);
  assert.deepEqual(webcamRect("fill", "small"), { x: 0, y: 0, width: FULL, height: FULL }, "a webcam that fills the picture has no size to choose");
});

test("a place is read back as the two choices that made it, and one set another way is 'other'", () => {
  for (const where of WEBCAM_WHERE) {
    if (where === "usual" || where === "fill") continue;
    for (const size of WEBCAM_SIZES) assert.deepEqual(webcamChoiceOf(webcamRect(where, size)), { where, size });
  }
  assert.deepEqual(webcamChoiceOf(webcamRect("fill", "large")), { where: "fill", size: "medium" });
  assert.deepEqual(webcamChoiceOf({ x: 123, y: 456, width: 2000, height: 1500 }), { where: "other", size: "other" });
});

test("the edit model takes a place made this way, and 'the usual place' takes it away again", () => {
  let model = createModel([{ ref: { kind: "take", take: 1, media: "webcam.mp4" }, kind: "webcam", name: "Webcam of take 1", durationMs: 10_000 }]);
  const track = addTrack(model, "webcam");
  model = track.model;
  const added = addClip(model, track.focus?.[0] ?? "", { source: { kind: "take", take: 1, media: "webcam.mp4" }, startMs: 0, name: "Webcam" });
  assert.ok(added.ok);
  const id = added.focus?.[0] ?? "";
  const placed = setPlacement(added.model, id, webcamRect("top-left", "large"));
  assert.ok(placed.ok, placed.message);
  assert.deepEqual(webcamChoiceOf(findClip(placed.model, id)?.clip.placement), { where: "top-left", size: "large" });
  const back = setPlacement(placed.model, id, null);
  assert.ok(back.ok);
  assert.equal(findClip(back.model, id)?.clip.placement, undefined);
});

test("the usual place here is the one the video maker's code names, so the two cannot drift apart", () => {
  const rust = readFileSync(new URL("../../capture/crates/openstage-capture-render/src/compose.rs", import.meta.url), "utf8");
  const found = /DEFAULT_WEBCAM_PLACE: EditRect = EditRect \{ x: (\d+)\.0, y: (\d+)\.0, width: (\d+)\.0, height: (\d+)\.0 \}/.exec(rust);
  assert.ok(found, "the constant is still written the way this test reads it");
  assert.deepEqual(
    { x: Number(found[1]), y: Number(found[2]), width: Number(found[3]), height: Number(found[4]) },
    webcamRect("bottom-right", "medium"),
  );
});
