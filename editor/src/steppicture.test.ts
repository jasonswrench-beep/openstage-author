// Tests for the names and sizes of step pictures. Taking a picture needs a window, and is tried in the real editor.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_PICTURE_WIDTH, pictureName, pictureSize, screenPath, takeFolderName } from "./steppicture.ts";

test("a take's folder and its screen video are named the way the recorder names them", () => {
  assert.equal(takeFolderName(1), "take-001");
  assert.equal(takeFolderName(12), "take-012");
  assert.equal(takeFolderName(1234), "take-1234");
  assert.equal(screenPath(3, "screen.mp4"), "takes/take-003/screen.mp4");
});

test("a picture is kept at its own size unless it is wider than the course needs", () => {
  assert.deepEqual(pictureSize(1280, 720), { width: 1280, height: 720 });
  assert.deepEqual(pictureSize(MAX_PICTURE_WIDTH, 1080), { width: 1920, height: 1080 });
  assert.deepEqual(pictureSize(3840, 2160), { width: 1920, height: 1080 });
  assert.deepEqual(pictureSize(2560, 1080), { width: 1920, height: 810 });
  assert.deepEqual(pictureSize(10_000, 1), { width: 1920, height: 1 }, "never a picture with no height");
});

test("a picture file is named from the recording and the step", () => {
  assert.equal(pictureName("Week 3.capture", "step-4"), "Week 3-step-4");
  assert.equal(pictureName("Demo", "step-1"), "Demo-step-1");
});
