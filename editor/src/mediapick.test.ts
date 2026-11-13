// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseMedia, extensionOf, friendlyName, type PickBackend } from "./mediapick.ts";

function backend(picked: string | null, imported = "assets/images/logo.png"): PickBackend & { imports: string[] } {
  const imports: string[] = [];
  return {
    imports,
    pickFile: async () => picked,
    importAsset: async (_dir, source) => {
      imports.push(source);
      return imported;
    },
    assetUrl: async (_dir, path) => `asset://${path}`,
    mediaUrl: async (_dir, path) => `media://${path}`,
  };
}

test("names are made from file names", () => {
  assert.equal(friendlyName("C:\\Users\\Example\\Pictures\\course-logo_v2.PNG"), "Course logo v2");
  assert.equal(friendlyName("/tmp/x.mp4"), "X");
  assert.equal(extensionOf("D:\\a b\\Clip.MP4"), "mp4");
  assert.equal(extensionOf("noextension"), "");
});

test("cancelling adds nothing and says so", async () => {
  const r = await chooseMedia(backend(null), "dir", "image", async () => null);
  assert.deepEqual(r, { ok: false, message: "No file was chosen, so nothing was added." });
});

test("a picture is copied in and described by its place inside the course's assets folder", async () => {
  const b = backend("C:\\pics\\Logo.png");
  const r = await chooseMedia(b, "dir", "image", async () => null);
  assert.deepEqual(r, { ok: true, file: { asset: "images/logo.png", kind: "image", name: "Logo", durationMs: null } });
  assert.deepEqual(b.imports, ["C:\\pics\\Logo.png"]);
});

test("a file the video maker cannot use is refused before it is copied", async () => {
  const b = backend("C:\\sound\\song.mp3", "assets/audio/song.mp3");
  const r = await chooseMedia(b, "dir", "audio", async () => 1000);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /song\.mp3 was not added.*WAV sound files/);
  assert.deepEqual(b.imports, [], "nothing was copied");
});

test("a video's length is measured, and one that cannot be read is not added", async () => {
  const ok = await chooseMedia(backend("v.mp4", "assets/video/v.mp4"), "dir", "video", async (url, kind) => (url === "media://assets/video/v.mp4" && kind === "video" ? 12_345 : null));
  assert.deepEqual(ok, { ok: true, file: { asset: "video/v.mp4", kind: "video", name: "V", durationMs: 12_345 } });
  const bad = await chooseMedia(backend("v.mp4", "assets/video/v.mp4"), "dir", "video", async () => null);
  assert.equal(bad.ok, false);
});
